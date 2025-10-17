/*!
 * ImgCollage Lite v3 — simple, stable, and user-friendly
 * Class:      .img_collage
 * Features:   drag (overlay + pointer capture), resize (Shift=keep ratio), snap, pack
 *             paste URL to add, hover actions (Replace/Duplicate/Delete), double-click to change URL
 *             autosave indicator + textarea JSON + 'imgcollagechange' event for DB integration
 */
;(function(){
  "use strict";
  const CLASS='img_collage', STYLE_ID='img-collage-lite-v3-style';

  // ---------- Styles (scoped + CSS custom properties for easy theming) ----------
  const CSS = `
  .${CLASS}{
    --ic-border:#e5e7eb; --ic-radius:12px; --ic-gap:6px;
    --ic-shadow:0 10px 30px rgba(0,0,0,.08);
    --ic-btn:#fff; --ic-btn-bd:#d0d7de; --ic-btn-h:#f1f5f9;
    position:relative; background:#fff; border:1px solid var(--ic-border); border-radius:var(--ic-radius);
    overflow:auto; box-shadow:var(--ic-shadow); font-family:ui-sans-serif,system-ui,Arial,sans-serif;
  }
  .${CLASS} ._bar{
    position:absolute; left:8px; top:8px; z-index:30; display:flex; gap:6px; background:rgba(255,255,255,.9);
    padding:6px; border:1px solid var(--ic-btn-bd); border-radius:10px; backdrop-filter: blur(4px);
  }
  .${CLASS} ._btn{
    border:1px solid var(--ic-btn-bd); background:var(--ic-btn); padding:6px 10px; border-radius:8px; cursor:pointer; font-size:12px;
  }
  .${CLASS} ._btn:active{ transform:translateY(1px); }
  .${CLASS} ._grid{
    position:absolute; inset:0; display:grid; gap:var(--ic-gap); padding:var(--ic-gap); grid-auto-flow:dense;
  }
  .${CLASS}.dragover ._grid{ outline:2px dashed #94a3b8; outline-offset:-8px; }
  .${CLASS} ._tile{
    position:relative; display:grid; border-radius:10px; overflow:hidden; user-select:none;
    box-shadow:0 6px 18px rgba(0,0,0,.16); background:#f8fafc;
  }
  .${CLASS} ._tile img{ width:100%; height:100%; object-fit:cover; display:block; pointer-events:none; }
  .${CLASS} ._tile._sel{ outline:2px solid #2563eb; }

  /* resize handle (SE only for simplicity) */
  .${CLASS} ._rz{ position:absolute; width:12px; height:12px; background:#fff; border:2px solid #2563eb; border-radius:4px;
    right:-6px; bottom:-6px; cursor:nwse-resize; box-shadow:0 1px 4px rgba(0,0,0,.15); }

  /* move handle */
  .${CLASS} ._move{
    position:absolute; right:8px; bottom:8px; font-size:12px; color:#334155; background:rgba(255,255,255,.9);
    border:1px solid #cbd5e1; border-radius:6px; padding:2px 6px; cursor:grab; box-shadow:0 1px 4px rgba(0,0,0,.12);
  }
  .${CLASS} ._move:active{ cursor:grabbing; }

  /* hover actions (Replace / Duplicate / Delete) */
  .${CLASS} ._actions{
    position:absolute; left:8px; top:8px; display:flex; gap:6px; opacity:0; transition:opacity .15s;
  }
  .${CLASS} ._tile:hover ._actions{ opacity:1; }
  .${CLASS} ._chip{
    background:#fff; border:1px solid #cbd5e1; border-radius:6px; padding:2px 6px; font-size:12px; cursor:pointer;
  }

  /* data panel + textarea */
  .${CLASS} ._panel{
    position:absolute; right:8px; top:8px; z-index:35; width:min(420px,60%); display:none; flex-direction:column; gap:6px;
    padding:8px; border:1px solid var(--ic-btn-bd); border-radius:10px; background:#fff; box-shadow:0 10px 30px rgba(0,0,0,.18);
  }
  .${CLASS} ._panel.show{ display:flex; }
  .${CLASS} ._data{ width:100%; height:220px; font:12px/1.4 ui-monospace,Menlo,Consolas,monospace; }

  /* saved tick */
  .${CLASS} ._saved{
    position:absolute; right:8px; bottom:8px; z-index:40; background:#10b981; color:#fff; font-size:12px;
    border-radius:999px; padding:4px 10px; opacity:0; transform:translateY(6px); transition:.25s;
  }
  .${CLASS} ._saved.show{ opacity:1; transform:none; }
  `;
  if(!document.getElementById(STYLE_ID)){ const s=document.createElement('style'); s.id=STYLE_ID; s.textContent=CSS; document.head.appendChild(s); }

  // ---------- Utils ----------
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

  // ---------- Core ----------
  class Box{
    constructor(root){
      this.root=root;
      this.id=root.dataset.id||('board_'+uid()); root.dataset.id=this.id;

      // Config (tweak via data-attrs)
      this.cols=+root.dataset.cols||24;
      this.rowH=+root.dataset.row ||24;
      this.gap =+root.dataset.gap ||6;
      this.minSpan=1; this.maxSpan=200; // guardrails
      this.selected=null; this.drag=null; this.rz=null;
      this.savedTickTimer=null;

      // Toolbar
      this.bar=document.createElement('div'); this.bar.className='_bar';
      this.bar.innerHTML=`
        <label class="_btn">Add <input type="file" accept="image/*" multiple hidden></label>
        <button class="_btn" data-pack>Pack</button>
        <button class="_btn" data-data>Data</button>
      `;

      // Grid
      this.grid=document.createElement('div'); this.grid.className='_grid';
      this.grid.style.gridTemplateColumns=`repeat(${this.cols},1fr)`;
      this.grid.style.gridAutoRows=this.rowH+'px';
      this.grid.style.gap=`${this.gap}px`; this.grid.style.padding=`${this.gap}px`;

      // Overlay (for dragging ghosts)
      this.layer=document.createElement('div');
      this.layer.style.position='absolute';
      this.layer.style.inset='0';
      this.layer.style.pointerEvents='none';
      this.layer.style.zIndex='99';

      // Data panel + textarea (DB interface)
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

      // Saved ✓ badge
      this.saved=document.createElement('div'); this.saved.className='_saved'; this.saved.textContent='Saved ✓';

      // Empty-state hint
      this.hint=document.createElement('div');
      this.hint.style.cssText='position:absolute;inset:auto auto 12px 12px;color:#64748b;font-size:12px;background:rgba(255,255,255,.9);border:1px solid #cbd5e1;border-radius:8px;padding:6px 8px';
      this.hint.textContent='Drop images here or click Add';

      root.append(this.bar,this.grid,this.layer,this.panel,this.saved,this.hint);

      // refs
      this.input=this.bar.querySelector('input[type=file]');
      this.btnPack=this.bar.querySelector('[data-pack]');
      this.btnData=this.bar.querySelector('[data-data]');
      this.btnClose=this.panel.querySelector('[data-close]');
      this.btnImport=this.panel.querySelector('[data-import]');
      this.btnCopy=this.panel.querySelector('[data-copy]');

      // bind + initialize
      this.bind();

      // If textarea had JSON (pre-filled from DB), load it, else show seed
      if((this.textarea.value||'').trim()) this.loadSafe(this.textarea.value);
      else { this.seed(); this.syncTextarea(true); }
      this.updateHint();
    }

    // ---------- Events / bindings ----------
    bind(){
      // Toolbar buttons
      this.input.addEventListener('change', async e=>{
        const files=[...e.target.files].filter(f=>/^image\//.test(f.type));
        await this.addFiles(files); this.syncTextarea(); this.input.value='';
      });
      this.btnPack.addEventListener('click', ()=>{ this.pack(); this.syncTextarea(); });
      this.btnData.addEventListener('click', ()=> this.panel.classList.toggle('show'));
      this.btnClose.addEventListener('click', ()=> this.panel.classList.remove('show'));
      this.btnImport.addEventListener('click', ()=>{
        const raw = prompt('Paste JSON:', this.textarea.value||'');
        if(raw && this.loadSafe(raw)) this.syncTextarea(true);
      });
      this.btnCopy.addEventListener('click', async ()=>{
        try{ await navigator.clipboard.writeText(this.textarea.value||''); this.flashSaved('Copied'); }catch(_){ alert('Copy failed'); }
      });

      // Drag & drop files
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

      // Paste URL to add image
      this.root.addEventListener('paste', e=>{
        const text = (e.clipboardData||window.clipboardData)?.getData('text') || '';
        if(/^https?:\/\//i.test(text)){ this.addImage(text,6,6); this.syncTextarea(); }
      });

      // Keyboard (simple)
      window.addEventListener('keydown', e=>{
        if(!this.selected || !this.root.contains(this.selected)) return;
        const c=parseGrid(this.selected.style.gridColumn), r=parseGrid(this.selected.style.gridRow);
        if(e.key==='Delete'){ this.selected.remove(); this.selected=null; this.syncTextarea(); return; }
        if(e.key==='=' || (e.key==='+' && e.shiftKey)){ setGrid(this.selected,c.start,clamp(c.span+1,this.minSpan,this.maxSpan),r.start,r.span,this.cols); this.syncTextarea(); }
        else if(e.key==='-'){ setGrid(this.selected,c.start,clamp(c.span-1,this.minSpan,this.maxSpan),r.start,r.span,this.cols); this.syncTextarea(); }
        else if(e.key.toLowerCase()==='h'){ setGrid(this.selected,c.start,c.span,r.start,clamp(r.span+1,this.minSpan,this.maxSpan),this.cols); this.syncTextarea(); }
        else if(e.key.toLowerCase()==='l'){ setGrid(this.selected,c.start,c.span,r.start,clamp(r.span-1,this.minSpan,this.maxSpan),this.cols); this.syncTextarea(); }
        else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
          e.preventDefault();
          const dx=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0;
          const dy=e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0;
          setGrid(this.selected,Math.max(1,(c.start||1)+dx),c.span,Math.max(1,(r.start||1)+dy),r.span,this.cols);
          this.syncTextarea();
        }
      });

      // pointer cancel safety
      window.addEventListener('pointercancel', ()=>{ if(this.drag) this.endMove({pointerId:undefined}); });

      // debounced saving + change event
      const rawSync = this.syncTextarea.bind(this);
      this.syncTextarea = debounce((silent)=>{ rawSync(silent); this.emitChange(); },160);
    }

    // ---------- Change event + Saved tick ----------
    emitChange(){
      const ev = new CustomEvent('imgcollagechange', { detail: this.toJSON() });
      this.root.dispatchEvent(ev);
    }
    flashSaved(text){
      if(text) this.saved.textContent = text;
      this.saved.classList.add('show');
      clearTimeout(this.savedTickTimer);
      this.savedTickTimer = setTimeout(()=>{ this.saved.classList.remove('show'); this.saved.textContent='Saved ✓'; }, 900);
    }

    // ---------- Public-ish ----------
    toJSON(){
      return {
        version:1,id:this.id,cols:this.cols,row:this.rowH,gap:this.gap,
        items:[...this.grid.querySelectorAll('._tile')].map(t=>{
          const c=parseGrid(t.style.gridColumn), r=parseGrid(t.style.gridRow);
          return { id:t.dataset.id, src:t.dataset.src, colStart:c.start, colSpan:c.span, rowStart:r.start, rowSpan:r.span };
        })
      };
    }
    load(data){
      if(!data || !data.items) return;
      this.cols=data.cols||this.cols; this.rowH=data.row||this.rowH; this.gap=data.gap||this.gap;
      this.grid.style.gridTemplateColumns=`repeat(${this.cols},1fr)`;
      this.grid.style.gridAutoRows=this.rowH+'px';
      this.grid.style.gap=`${this.gap}px`; this.grid.style.padding=`${this.gap}px`;
      this.grid.innerHTML='';
      data.items.forEach(it=> this.addImage(it.src,it.colSpan,it.rowSpan,it.colStart,it.rowStart,it.id));
      this.updateHint();
    }
    loadSafe(raw){ try{ this.load(typeof raw==='string'?JSON.parse(raw):raw); return true; }catch(_){ alert('Invalid JSON'); return false; } }
    getJSON(){ return JSON.stringify(this.toJSON()); }
    setJSON(obj){ this.load(obj); this.syncTextarea(true); }

    syncTextarea(silent){
      try{ this.textarea.value=this.getJSON(); }catch(_){}
      this.updateHint();
      if(!silent) this.flashSaved('Saved ✓');
    }
    updateHint(){
      const hasTiles = this.grid.querySelector('._tile');
      this.hint.style.display = hasTiles ? 'none' : 'block';
    }

    // ---------- Core actions ----------
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
      const se=document.createElement('div'); se.className='_rz';
      const actions=document.createElement('div'); actions.className='_actions';
      const btnReplace=document.createElement('button'); btnReplace.className='_chip'; btnReplace.type='button'; btnReplace.textContent='Replace';
      const btnDup=document.createElement('button'); btnDup.className='_chip'; btnDup.type='button'; btnDup.textContent='Duplicate';
      const btnDel=document.createElement('button'); btnDel.className='_chip'; btnDel.type='button'; btnDel.textContent='Delete';
      actions.append(btnReplace, btnDup, btnDel);

      t.append(img,actions,mv,se);

      // select
      t.addEventListener('pointerdown',()=>this.select(t));
      // double-click to change URL
      t.addEventListener('dblclick', ()=>{
        const url = prompt('New image URL:', t.dataset.src||'https://');
        if(url){ t.dataset.src=url; img.src=url; this.syncTextarea(); }
      });

      // inline actions
      btnReplace.addEventListener('click', (e)=>{ e.stopPropagation();
        const url = prompt('New image URL:', t.dataset.src||'https://');
        if(url){ t.dataset.src=url; img.src=url; this.syncTextarea(); }
      });
      btnDup.addEventListener('click', (e)=>{ e.stopPropagation();
        const c=parseGrid(t.style.gridColumn), r=parseGrid(t.style.gridRow);
        const nt=this.addImage(t.dataset.src, c.span, r.span, (c.start||1)+1, (r.start||1), undefined);
        this.select(nt); this.syncTextarea();
      });
      btnDel.addEventListener('click', (e)=>{ e.stopPropagation(); t.remove(); if(this.selected===t) this.selected=null; this.syncTextarea(); });

      // move + resize
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

    // ---------- Selection ----------
    select(el){ if(this.selected) this.selected.classList.remove('_sel'); this.selected=el; if(el) el.classList.add('_sel'); }

    // ---------- MOVE (overlay + padding-aware + pointer capture + edge-scroll) ----------
    startMove(e){
      e.preventDefault(); e.stopPropagation();
      const tile = e.currentTarget.parentElement; this.select(tile);
      e.currentTarget.setPointerCapture?.(e.pointerId);

      const gridRect = this.grid.getBoundingClientRect();
      const rect = tile.getBoundingClientRect();
      const pad = this.gap;

      const startLeft = rect.left - gridRect.left + this.grid.scrollLeft - pad;
      const startTop  = rect.top  - gridRect.top  + this.grid.scrollTop  - pad;

      const ghost = tile.cloneNode(true);
      ghost.style.position='absolute';
      ghost.style.left = startLeft + 'px';
      ghost.style.top  = startTop  + 'px';
      ghost.style.width  = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      ghost.style.pointerEvents='none';
      this.layer.appendChild(ghost);

      tile.style.visibility='hidden'; tile.dataset._hidden='1';

      this.drag = { target:e.currentTarget, ghost, tile, pad, startX:e.clientX, startY:e.clientY };

      window.addEventListener('pointermove', this.onMoveBound = this.onMove.bind(this), { passive:false });
      window.addEventListener('pointerup',   this.endMoveBound = this.endMove.bind(this), { once:true });
    }
    onMove(e){
      if(!this.drag) return; e.preventDefault();
      const s = this.drag;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;

      let curLeft = parseFloat(s.ghost.style.left) + dx;
      let curTop  = parseFloat(s.ghost.style.top)  + dy;

      const contentW = this.grid.scrollWidth  - s.pad*2;
      const contentH = this.grid.scrollHeight - s.pad*2;
      const maxX = Math.max(0, contentW - s.ghost.offsetWidth);
      const maxY = Math.max(0, contentH - s.ghost.offsetHeight);

      // edge auto-scroll while dragging
      const margin = 24;
      const r = this.root.getBoundingClientRect();
      // horizontal
      if(e.clientX > r.right - margin) this.grid.scrollLeft += 20;
      if(e.clientX < r.left  + margin) this.grid.scrollLeft -= 20;
      // vertical
      if(e.clientY > r.bottom - margin) this.grid.scrollTop += 20;
      if(e.clientY < r.top    + margin) this.grid.scrollTop -= 20;

      s.ghost.style.left = clamp(curLeft, 0, maxX) + 'px';
      s.ghost.style.top  = clamp(curTop,  0, maxY) + 'px';

      s.startX = e.clientX; s.startY = e.clientY;
    }
    endMove(e){
      if(!this.drag) return;
      this.drag.target.releasePointerCapture?.(e.pointerId);
      const { ghost, tile, pad } = this.drag;

      const left = parseFloat(ghost.style.left) + pad;
      const top  = parseFloat(ghost.style.top)  + pad;

      const cStart = this.px2col(left);
      const rStart = this.px2row(top);

      const c=parseGrid(tile.style.gridColumn), r=parseGrid(tile.style.gridRow);

      tile.style.visibility=''; delete tile.dataset._hidden;
      this.layer.removeChild(ghost);
      this.drag=null;

      setGrid(tile, cStart, c.span, rStart, r.span, this.cols);

      window.removeEventListener('pointermove', this.onMoveBound);
      this.syncTextarea();
    }

    // ---------- RESIZE (Shift = keep ratio) ----------
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
      let spanC=clamp(s.col.span+dC,this.minSpan,Math.min(this.maxSpan,this.cols));
      let spanR=clamp(s.row.span+dR,this.minSpan,this.maxSpan);
      if(s.keep){
        const ratio=s.height/(s.width||1);
        const rowPerCol=ratio*(this.grid.clientWidth/this.cols)/this.rowH;
        spanR=clamp(Math.round(spanC*rowPerCol),this.minSpan,this.maxSpan);
      }
      setGrid(s.tile,s.col.start,spanC,s.row.start,spanR,this.cols);
    }
    endResize(){ this.rz=null; window.removeEventListener('pointermove', this.onResizeBound); this.syncTextarea(); }

    // ---------- px <-> grid ----------
    px2col(px){ const W=this.grid.clientWidth-this.gap*2; const colW=(W-this.gap*(this.cols-1))/this.cols;
      return Math.max(1,Math.round((px-this.gap)/(colW+this.gap))+1); }
    px2row(px){ return Math.max(1,Math.round((px-this.gap)/(this.rowH+this.gap))+1); }
    px2colW(px){ const W=this.grid.clientWidth-this.gap*2; const colW=(W-this.gap*(this.cols-1))/this.cols; return Math.round(px/(colW+this.gap)); }
    px2rowH(px){ return Math.round(px/(this.rowH+this.gap)); }

    // ---------- Demo tiles (remove if not needed) ----------
    seed(){
      const svgs=[
        'data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>'),
        'data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#f97316"/></svg>')
      ];
      this.addImage(svgs[0],10,10,1,1);
      this.addImage(svgs[1],7,6,12,1);
    }
  }

  const ImgCollage = {
    init(selector='.'+CLASS){
      return Array.from(document.querySelectorAll(selector)).map(n=>new Box(n));
    }
  };
  window.ImgCollage = ImgCollage;
})();
