/*!
 * XCollage Lite — simple & intuitive; single class (.x-collage) + textarea JSON
 * Features: drag, resize (Shift = keep ratio), snap, auto-pack, tiny Data panel
 */
;(function(){
  "use strict";
  const CLASS='x-collage', STYLE_ID='x-collage-lite-style';

  const CSS = `
  .${CLASS}{position:relative;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:auto;
    box-shadow:0 10px 30px rgba(0,0,0,.08);font-family:ui-sans-serif,system-ui,Arial,sans-serif}
  .${CLASS} ._bar{position:absolute;left:8px;top:8px;z-index:20;display:flex;gap:6px;background:rgba(255,255,255,.9);
    padding:6px;border:1px solid #d0d7de;border-radius:10px}
  .${CLASS} ._btn{border:1px solid #d0d7de;background:#fff;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12px}
  .${CLASS} ._btn:active{transform:translateY(1px)}
  .${CLASS} ._grid{position:absolute;inset:0;display:grid;gap:6px;padding:6px;grid-auto-flow:dense}
  .${CLASS}.dragover ._grid{outline:2px dashed #94a3b8;outline-offset:-8px}
  .${CLASS} ._tile{position:relative;display:grid;border-radius:10px;overflow:hidden;user-select:none;box-shadow:0 6px 18px rgba(0,0,0,.16)}
  .${CLASS} ._tile img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
  .${CLASS} ._tile._sel{outline:2px solid #2563eb}
  .${CLASS} ._rz{position:absolute;width:12px;height:12px;background:#fff;border:2px solid #2563eb;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.15)}
  .${CLASS} ._rz.se{right:-6px;bottom:-6px;cursor:nwse-resize}
  .${CLASS} ._move{position:absolute;right:8px;bottom:8px;font-size:12px;color:#334155;background:rgba(255,255,255,.85);
    border:1px solid #cbd5e1;border-radius:6px;padding:2px 6px;cursor:grab}
  .${CLASS} ._panel{position:absolute;right:8px;top:8px;z-index:25;width:min(420px,60%);display:none;flex-direction:column;gap:6px;
    padding:8px;border:1px solid #d0d7de;border-radius:10px;background:#fff;box-shadow:0 10px 30px rgba(0,0,0,.18)}
  .${CLASS} ._panel.show{display:flex}
  .${CLASS} ._data{width:100%;height:220px;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace}
  `;
  if(!document.getElementById(STYLE_ID)){ const s=document.createElement('style'); s.id=STYLE_ID; s.textContent=CSS; document.head.appendChild(s); }

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const uid=()=> 't_'+Math.random().toString(36).slice(2,9);
  const debounce=(fn,ms=160)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};};
  const parseGrid=v=>{
    if(!v) return {start:null,span:1};
    let m=/^(\d+)\s*\/\s*span\s*(\d+)$/.exec(v); if(m) return {start:+m[1],span:+m[2]};
    m=/^span\s*(\d+)$/.exec(v); if(m) return {start:null,span:+m[1]};
    return {start:null,span:1};
  };
  const setGrid=(el,cs,cspan,rs,rspan,cols)=>{
    el.style.gridColumn = cs ? `${clamp(cs,1,cols)} / span ${clamp(cspan,1,cols)}` : `span ${clamp(cspan,1,cols)}`;
    el.style.gridRow    = rs ? `${Math.max(1,rs)} / span ${Math.max(1,rspan)}` : `span ${Math.max(1,rspan)}`;
  };

  class Box{
    constructor(root){
      this.root=root;
      this.id=root.dataset.id||('box_'+uid()); root.dataset.id=this.id;
      this.cols=+root.dataset.cols||24; this.rowH=+root.dataset.row||24; this.gap=+root.dataset.gap||6;
      this.selected=null; this.drag=null; this.rz=null;

      // UI
      this.bar=document.createElement('div'); this.bar.className='_bar';
      this.bar.innerHTML=`
        <label class="_btn">Add <input type="file" accept="image/*" multiple hidden></label>
        <button class="_btn" data-pack>Pack</button>
        <button class="_btn" data-data>Data</button>
      `;
      this.grid=document.createElement('div'); this.grid.className='_grid';
      this.grid.style.gridTemplateColumns=`repeat(${this.cols},1fr)`;
      this.grid.style.gridAutoRows=this.rowH+'px';
      this.grid.style.gap=this.gap+'px'; this.grid.style.padding=this.gap+'px';

      this.panel=document.createElement('div'); this.panel.className='_panel';
      this.panel.innerHTML=`
        <textarea class="_data" name="${this.id}_layout"></textarea>
        <div style="display:flex;gap:6px;justify-content:flex-end">
          <button class="_btn" data-close>Close</button>
          <button class="_btn" data-import>Import</button>
          <button class="_btn" data-copy>Copy</button>
        </div>
      `;
      this.textarea=this.panel.querySelector('._data');

      root.append(this.bar,this.grid,this.panel);

      // refs
      this.input=this.bar.querySelector('input[type=file]');
      this.btnPack=this.bar.querySelector('[data-pack]');
      this.btnData=this.bar.querySelector('[data-data]');
      this.btnClose=this.panel.querySelector('[data-close]');
      this.btnImport=this.panel.querySelector('[data-import]');
      this.btnCopy=this.panel.querySelector('[data-copy]');

      // bind
      this.bind();

      // preload from textarea (you can pre-fill from DB)
      if((this.textarea.value||'').trim()) this.loadSafe(this.textarea.value);
      else { this.seed(); this.syncTextarea(); }
    }

    bind(){
      this.input.addEventListener('change', async e=>{
        const files=[...e.target.files].filter(f=>/^image\//.test(f.type));
        await this.addFiles(files); this.syncTextarea(); this.input.value='';
      });
      this.btnPack.addEventListener('click', ()=>{ this.pack(); this.syncTextarea(); });
      this.btnData.addEventListener('click', ()=> this.panel.classList.toggle('show'));
      this.btnClose.addEventListener('click', ()=> this.panel.classList.remove('show'));
      this.btnImport.addEventListener('click', ()=>{
        const raw = prompt('Paste JSON:', this.textarea.value||'');
        if(raw && this.loadSafe(raw)) this.syncTextarea();
      });
      this.btnCopy.addEventListener('click', async ()=>{
        try{ await navigator.clipboard.writeText(this.textarea.value||''); alert('Copied'); }catch(_){ alert('Copy failed'); }
      });

      // drag & drop
      ['dragenter','dragover'].forEach(t=>{
        this.root.addEventListener(t, e=>{ e.preventDefault(); this.root.classList.add('dragover'); });
      });
      ['dragleave','drop'].forEach(t=>{
        this.root.addEventListener(t, e=>{ e.preventDefault(); this.root.classList.remove('dragover'); });
      });
      this.root.addEventListener('drop', async e=>{
        const files=[...e.dataTransfer.files].filter(f=>/^image\//.test(f.type));
        if(files.length){ await this.addFiles(files); this.syncTextarea(); }
      });

      // keyboard
      window.addEventListener('keydown', e=>{
        if(!this.selected || !this.root.contains(this.selected)) return;
        const c=parseGrid(this.selected.style.gridColumn), r=parseGrid(this.selected.style.gridRow);
        if(e.key==='Delete'){ this.selected.remove(); this.selected=null; this.syncTextarea(); return; }
        if(e.key==='=' || (e.key==='+' && e.shiftKey)){ setGrid(this.selected,c.start,c.span+1,r.start,r.span,this.cols); this.syncTextarea(); }
        else if(e.key==='-'){ setGrid(this.selected,c.start,Math.max(1,c.span-1),r.start,r.span,this.cols); this.syncTextarea(); }
        else if(e.key.toLowerCase()==='h'){ setGrid(this.selected,c.start,c.span,r.start,r.span+1,this.cols); this.syncTextarea(); }
        else if(e.key.toLowerCase()==='l'){ setGrid(this.selected,c.start,c.span,r.start,Math.max(1,r.span-1),this.cols); this.syncTextarea(); }
        else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
          e.preventDefault();
          const dx=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0;
          const dy=e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0;
          setGrid(this.selected,Math.max(1,(c.start||1)+dx),c.span,Math.max(1,(r.start||1)+dy),r.span,this.cols);
          this.syncTextarea();
        }
      });

      // debounced saving
      this.syncTextarea = debounce(this.syncTextarea.bind(this),150);
    }

    // core
    async addFiles(files){
      for(const f of files){
        const url=URL.createObjectURL(f);
        const t=this.addImage(url,6,6);
        t.querySelector('img').addEventListener('load',()=>URL.revokeObjectURL(url),{once:true});
      }
    }
    addImage(src,colSpan=6,rowSpan=6,colStart=null,rowStart=null,id){
      const t=document.createElement('div'); t.className='_tile';
      t.dataset.id=id||uid(); t.dataset.src=src;
      setGrid(t,colStart,colSpan,rowStart,rowSpan,this.cols);

      const img=document.createElement('img'); img.src=src; img.alt='image';
      const mv=document.createElement('div'); mv.className='_move'; mv.textContent='move';
      const se=document.createElement('div'); se.className='_rz se';
      t.append(img,mv,se);

      t.addEventListener('pointerdown',()=>this.select(t));
      mv.addEventListener('pointerdown', this.startMove.bind(this));
      se.addEventListener('pointerdown', this.startResize.bind(this));

      this.grid.appendChild(t);
      return t;
    }
    pack(){
      this.grid.querySelectorAll('._tile').forEach(t=>{
        const c=parseGrid(t.style.gridColumn), r=parseGrid(t.style.gridRow);
        setGrid(t,null,c.span,null,r.span,this.cols);
      });
    }
    toJSON(){
      return {
        version:1,id:this.id,cols:this.cols,row:this.rowH,gap:this.gap,
        items:[...this.grid.querySelectorAll('._tile')].map(t=>{
          const c=parseGrid(t.style.gridColumn), r=parseGrid(t.style.gridRow);
          return {id:t.dataset.id,src:t.dataset.src,colStart:c.start,colSpan:c.span,rowStart:r.start,rowSpan:r.span};
        })
      };
    }
    load(data){
      if(!data||!data.items) return;
      this.cols=data.cols||this.cols; this.rowH=data.row||this.rowH; this.gap=data.gap||this.gap;
      this.grid.style.gridTemplateColumns=`repeat(${this.cols},1fr)`;
      this.grid.style.gridAutoRows=this.rowH+'px';
      this.grid.style.gap=this.gap+'px';
      this.grid.innerHTML='';
      data.items.forEach(it=> this.addImage(it.src,it.colSpan,it.rowSpan,it.colStart,it.rowStart,it.id));
    }
    loadSafe(raw){ try{ this.load(typeof raw==='string'?JSON.parse(raw):raw); return true; }catch(_){ alert('Invalid JSON'); return false; } }
    getJSON(){ return JSON.stringify(this.toJSON()); }
    setJSON(obj){ this.load(obj); this.syncTextarea(); }
    syncTextarea(){ try{ this.textarea.value=this.getJSON(); }catch(_){ } }

    select(el){ if(this.selected) this.selected.classList.remove('_sel'); this.selected=el; if(el) el.classList.add('_sel'); }

    // move
    startMove(e){
      e.stopPropagation();
      const tile=e.currentTarget.parentElement; this.select(tile);
      const rect=tile.getBoundingClientRect(), gridRect=this.grid.getBoundingClientRect();
      const offX=e.clientX-rect.left, offY=e.clientY-rect.top;

      const ghost=tile.cloneNode(true);
      ghost.style.position='absolute';
      ghost.style.left=(rect.left-gridRect.left+this.grid.scrollLeft)+'px';
      ghost.style.top =(rect.top -gridRect.top +this.grid.scrollTop )+'px';
      ghost.style.width=rect.width+'px'; ghost.style.height=rect.height+'px';
      ghost.style.zIndex=99; this.grid.appendChild(ghost);

      tile.style.visibility='hidden'; tile.dataset._hidden='1';
      this.drag={ghost,tile,offX,offY};

      window.addEventListener('pointermove', this.onMoveBound=this.onMove.bind(this));
      window.addEventListener('pointerup', this.endMoveBound=this.endMove.bind(this), {once:true});
    }
    onMove(e){
      const s=this.drag; if(!s) return;
      const gridRect=this.grid.getBoundingClientRect();
      const maxX=this.grid.scrollWidth - s.ghost.offsetWidth - this.gap;
      const maxY=this.grid.scrollHeight- s.ghost.offsetHeight- this.gap;
      const x=e.clientX-gridRect.left+this.grid.scrollLeft-s.offX;
      const y=e.clientY-gridRect.top +this.grid.scrollTop -s.offY;
      s.ghost.style.left=clamp(x,this.gap,maxX)+'px';
      s.ghost.style.top =clamp(y,this.gap,maxY)+'px';
    }
    endMove(){
      const s=this.drag; if(!s) return;
      const left=parseFloat(s.ghost.style.left)||0, top=parseFloat(s.ghost.style.top)||0;
      const cStart=this.px2col(left), rStart=this.px2row(top); // snap
      const c=parseGrid(s.tile.style.gridColumn), r=parseGrid(s.tile.style.gridRow);
      setGrid(s.tile,cStart,c.span,rStart,r.span,this.cols);
      s.tile.style.visibility=''; delete s.tile.dataset._hidden;
      this.grid.removeChild(s.ghost); this.drag=null;
      window.removeEventListener('pointermove', this.onMoveBound);
      this.syncTextarea();
    }

    // resize
    startResize(e){
      e.stopPropagation();
      const tile=e.currentTarget.parentElement; this.select(tile);
      const rect=tile.getBoundingClientRect(); const c=parseGrid(tile.style.gridColumn), r=parseGrid(tile.style.gridRow);
      this.rz={tile,startX:e.clientX,startY:e.clientY,col:c,row:r,width:rect.width,height:rect.height,keep:e.shiftKey};
      window.addEventListener('pointermove', this.onResizeBound=this.onResize.bind(this));
      window.addEventListener('pointerup', this.endResizeBound=this.endResize.bind(this), {once:true});
    }
    onResize(e){
      const s=this.rz; if(!s) return;
      let dC=this.px2colW(e.clientX-s.startX);
      let dR=this.px2rowH(e.clientY-s.startY);
      let spanC=clamp(s.col.span+dC,1,this.cols);
      let spanR=Math.max(1,s.row.span+dR);
      if(s.keep){
        const ratio=s.height/(s.width||1);
        const rowPerCol=ratio*(this.grid.clientWidth/this.cols)/this.rowH;
        spanR=Math.max(1,Math.round(spanC*rowPerCol));
      }
      setGrid(s.tile,s.col.start,spanC,s.row.start,spanR,this.cols);
    }
    endResize(){ this.rz=null; window.removeEventListener('pointermove', this.onResizeBound); this.syncTextarea(); }

    // px <-> grid
    px2col(px){ const W=this.grid.clientWidth-this.gap*2; const colW=(W-this.gap*(this.cols-1))/this.cols;
      return Math.max(1,Math.round((px-this.gap)/(colW+this.gap))+1); }
    px2row(px){ return Math.max(1,Math.round((px-this.gap)/(this.rowH+this.gap))+1); }
    px2colW(px){ const W=this.grid.clientWidth-this.gap*2; const colW=(W-this.gap*(this.cols-1))/this.cols; return Math.round(px/(colW+this.gap)); }
    px2rowH(px){ return Math.round(px/(this.rowH+this.gap)); }

    // demo
    seed(){
      const svgs=[
        'data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>'),
        'data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#f97316"/></svg>')
      ];
      this.addImage(svgs[0],10,10,1,1);
      this.addImage(svgs[1],7,6,12,1);
    }
  }

  const XCollage = {
    init(selector='.'+CLASS){
      return Array.from(document.querySelectorAll(selector)).map(n=>new Box(n));
    }
  };
  window.XCollage = XCollage;
})();
XCollage.init('.x-collage');  // activate all