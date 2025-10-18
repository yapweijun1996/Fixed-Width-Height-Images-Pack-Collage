/*!
 * ImgCollage Lite v4.2 — Auto-pack + toolbar always on top
 * Fix: resizing no longer snaps tile to (1,1) when grid-start is implicit.
 * - Fixed height (no scroll), keep ratio (contain)
 * - Click-to-front for tiles
 * - Per-tile handles only when selected
 * - Toolbar always visible & above tiles
 * - Capacity-aware PACK
 * - Robust add/replace preload + error handling
 * - Multi-board, unique data-id ensured
 */
;(function(){
  "use strict";
  const CLASS='img_collage', STYLE_ID='img-collage-lite-v4_2-style';
  const usedIds = new Set();
  // Layer constants (toolbar > panel > toast > layer > tiles)
  const Z_BAR   = 100000;
  const Z_PANEL = 100020;
  const Z_TOAST = 100040;
  const Z_LAYER = 100060;

  // ---------- Styles ----------
  const CSS = `
  .${CLASS}{
    --ic-border:#e5e7eb; --ic-radius:12px; --ic-gap:6px;
    --ic-shadow:0 10px 30px rgba(0,0,0,.08);
    --ic-toast-ok:#10b981; --ic-toast-err:#ef4444;
    position:relative; background:#fff; border:1px solid var(--ic-border); border-radius:var(--ic-radius);
    overflow:hidden; /* fixed-height board, no scroll */
    box-shadow:var(--ic-shadow); font-family:ui-sans-serif,system-ui,Arial,sans-serif;
  }
  .${CLASS} ._bar{
    position:absolute; left:8px; top:8px; z-index:${Z_BAR};
    display:flex; gap:6px; background:rgba(255,255,255,.92);
    padding:6px; border:1px solid #d0d7de; border-radius:10px; backdrop-filter: blur(4px);
  }
  .${CLASS} ._btn{ border:1px solid #d0d7de; background:#fff; padding:6px 10px; border-radius:8px; cursor:pointer; font-size:12px; }
  .${CLASS} ._btn:active{ transform:translateY(1px); }

  .${CLASS} ._grid{ position:absolute; inset:0; display:grid; gap:var(--ic-gap); padding:var(--ic-gap); grid-auto-flow:dense; }

  .${CLASS} ._tile{
    position:relative; display:grid; border-radius:10px; overflow:hidden; user-select:none;
    box-shadow:0 6px 18px rgba(0,0,0,.16); background:#f8fafc; place-items:center;
  }
  .${CLASS} ._tile img{ width:100%; height:100%; object-fit:contain; object-position:center; background:#fff; display:block; pointer-events:none; }
  .${CLASS} ._tile._sel{ outline:2px solid #2563eb; }

  /* Handles visible only when selected */
  .${CLASS} ._tile ._move, .${CLASS} ._tile ._rz{ opacity:0; pointer-events:none; transition:opacity .12s ease; }
  .${CLASS} ._tile._sel ._move, .${CLASS} ._tile._sel ._rz{ opacity:1; pointer-events:auto; }

  .${CLASS} ._rz{ position:absolute; width:12px; height:12px; background:#fff; border:2px solid #2563eb; border-radius:4px;
    right:-6px; bottom:-6px; cursor:nwse-resize; box-shadow:0 1px 4px rgba(0,0,0,.15); z-index:3; }
  .${CLASS} ._move{
    position:absolute; right:8px; bottom:8px; font-size:12px; color:#334155; background:rgba(255,255,255,.95);
    border:1px solid #cbd5e1; border-radius:6px; padding:2px 6px; cursor:grab; box-shadow:0 1px 4px rgba(0,0,0,.12); z-index:3;
  }

  .${CLASS} ._panel{
    position:absolute; right:8px; top:8px; z-index:${Z_PANEL}; width:min(420px,60%); display:none; flex-direction:column; gap:6px;
    padding:8px; border:1px solid #d0d7de; border-radius:10px; background:#fff; box-shadow:0 10px 30px rgba(0,0,0,.18);
  }
  .${CLASS} ._panel.show{ display:flex; }
  .${CLASS} ._data{ width:100%; height:220px; font:12px/1.4 ui-monospace,Menlo,Consolas,monospace; }

  .${CLASS} ._toast{
    position:absolute; right:8px; bottom:8px; z-index:${Z_TOAST}; color:#fff; font-size:12px;
    border-radius:999px; padding:4px 10px; opacity:0; transform:translateY(6px); transition:.25s;
    background:var(--ic-toast-ok);
  }
  .${CLASS} ._toast.err{ background:var(--ic-toast-err); }
  .${CLASS} ._toast.show{ opacity:1; transform:none; }

  .${CLASS} ._hint{
    position:absolute; left:12px; bottom:12px; color:#64748b; font-size:12px; background:rgba(255,255,255,.9);
    border:1px solid #cbd5e1; border-radius:8px; padding:6px 8px; z-index:1;
  }
  `;
  if(!document.getElementById(STYLE_ID)){
    const s=document.createElement('style'); s.id=STYLE_ID; s.textContent=CSS; document.head.appendChild(s);
  }

  // ---------- Utils ----------
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const uid=()=> 't_'+Math.random().toString(36).slice(2,9);
  const debounce=(fn,ms=160)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};};
  const px=(v)=>{ const n=parseFloat(v); return Number.isFinite(n)?n:0; };

  function parseGrid(v){
    if(!v) return {start:null,span:1};
    let m=/^(\d+)\s*\/\s*span\s*(\d+)$/.exec(v); if(m) return {start:+m[1],span:+m[2]};
    m=/^span\s*(\d+)$/.exec(v); if(m) return {start:null,span:+m[1]};
    return {start:null,span:1};
  }
  function setGrid(el,cs,cspan,rs,rspan,cols){
    el.style.gridColumn = cs ? `${clamp(cs,1,cols)} / span ${clamp(cspan,1,cols)}` : `span ${clamp(cspan,1,cols)}`;
    el.style.gridRow    = rs ? `${Math.max(1,rs)} / span ${Math.max(1,rspan)}` : `span ${Math.max(1,rspan)}`;
  }
  function isSafeUrl(str){
    if(!str || typeof str!=='string') return false;
    try{
      if(/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(str)) return true;
      if(/^blob:/.test(str)) return true;
      const u = new URL(str, window.location.origin);
      const p = u.protocol.toLowerCase();
      return p==='http:' || p==='https:';
    }catch(_){ return false; }
  }
  function metricsOf(grid, cols, rowH, gapFallback){
    const cs = getComputedStyle(grid);
    const padL = px(cs.paddingLeft), padR=px(cs.paddingRight), padT=px(cs.paddingTop), padB=px(cs.paddingBottom);
    const gap = (()=>{ const g=px(cs.gap); return Number.isFinite(g)&&g>=0?g:(gapFallback||0); })();
    const rect = grid.getBoundingClientRect();
    const innerW = Math.max(0, rect.width  - padL - padR);
    const innerH = Math.max(0, rect.height - padT - padB);
    const colW = cols>0 ? (innerW - gap*(cols-1)) / cols : 0;
    const unitX = colW + gap;
    const unitY = rowH + gap;
    return { padL, padR, padT, padB, gap, innerW, innerH, colW, unitX, unitY };
  }

  class Box{
    constructor(root){
      // Ensure unique id even if duplicated across boards
      const wantedId = root.dataset.id;
      let id = wantedId || ('board_'+uid());
      while(usedIds.has(id)) id = wantedId ? (wantedId + '_' + uid()) : ('board_'+uid());
      usedIds.add(id);
      this.root=root; this.id=id; root.dataset.id=this.id;

      this.cols=+root.dataset.cols||24;
      this.rowH=+root.dataset.row ||24;
      this.gap =+root.dataset.gap ||6;
      this.DEFAULT_COL_SPAN = +root.dataset.defaultColspan || 6;

      this.selected=null; this.drag=null; this.rz=null;
      this.toastTimer=null;
      this.zTop=1; // tile z-index counter (toolbar stays above)

      // Capture initial <img>s
      const initialImgs = Array.from(root.querySelectorAll('img')).map(img=>({
        src: img.getAttribute('src'),
        alt: img.getAttribute('alt') || '',
        colSpan: +(img.dataset.colspan||''), 
        rowSpan:  +(img.dataset.rowspan||''),
        colStart: +(img.dataset.colstart||'')||null,
        rowStart: +(img.dataset.rowstart||'')||null
      }));
      root.innerHTML='';

      // UI
      this.bar=document.createElement('div'); this.bar.className='_bar';
      this.bar.innerHTML=`
        <label class="_btn">Add <input type="file" accept="image/*" multiple hidden></label>
        <button class="_btn" data-pack>Pack</button>
        <button class="_btn" data-data>Data</button>`;
      this.grid=document.createElement('div'); this.grid.className='_grid';
      this.grid.style.gridTemplateColumns=`repeat(${this.cols},1fr)`;
      this.grid.style.gridAutoRows=this.rowH+'px';
      this.grid.style.gap=`${this.gap}px`; this.grid.style.padding=`${this.gap}px`;
      this.layer=document.createElement('div'); Object.assign(this.layer.style,{position:'absolute',inset:'0',pointerEvents:'none',zIndex:String(Z_LAYER)});
      this.panel=document.createElement('div'); this.panel.className='_panel';
      this.panel.innerHTML=`
        <textarea class="_data" name="${this.id}_layout"></textarea>
        <div style="display:flex;gap:6px;justify-content:flex-end">
          <button class="_btn" data-close>Close</button>
          <button class="_btn" data-import>Import</button>
          <button class="_btn" data-copy>Copy</button>
        </div>`;
      this.textarea=this.panel.querySelector('._data');
      this.toast=document.createElement('div'); this.toast.className='_toast'; this.toast.textContent='Saved ✓';
      this.hint=document.createElement('div'); this.hint.className='_hint'; this.hint.textContent='Drop images here or click Add';
      root.append(this.bar,this.grid,this.layer,this.panel,this.toast,this.hint);

      // Refs
      this.input=this.bar.querySelector('input[type=file]');
      this.btnPack=this.bar.querySelector('[data-pack]');
      this.btnData=this.bar.querySelector('[data-data]');
      this.btnClose=this.panel.querySelector('[data-close]');
      this.btnImport=this.panel.querySelector('[data-import]');
      this.btnCopy=this.panel.querySelector('[data-copy]');

      this.bind();

      // Init: JSON > inline <img>
      if((this.textarea.value||'').trim()){
        this.loadSafe(this.textarea.value);
      }else if(initialImgs.length){
        initialImgs.forEach(info=>{
          const cs = info.colSpan > 0 ? info.colSpan : this.DEFAULT_COL_SPAN;
          const rs = info.rowSpan > 0 ? info.rowSpan : null;
          this.addByUrl(info.src, {colSpan:cs, rowSpan:rs, colStart:info.colStart, rowStart:info.rowStart, silent:true});
        });
        // Wait for images, then auto-pack
        this.autoPackAfterLoad();
      }
      this.updateHint();
    }

    // ---------- Auto-pack after images load ----------
    async autoPackAfterLoad(){
      const imgs = Array.from(this.grid.querySelectorAll('img'));
      await Promise.all(imgs.map(img=>{
        if(img.complete && img.naturalWidth>0) return Promise.resolve();
        return new Promise(res=>{
          const done=()=>{ img.removeEventListener('load',done); img.removeEventListener('error',done); res(); };
          img.addEventListener('load',done,{once:true});
          img.addEventListener('error',done,{once:true});
        });
      }));
      this.packFitWithinCapacity();
      this.syncTextarea(true);
    }

    // ---------- Board constraints ----------
    maxRows(){
      const M = metricsOf(this.grid, this.cols, this.rowH, this.gap);
      return Math.max(1, Math.floor((this.root.clientHeight - (M.padT+M.padB)) / M.unitY));
    }
    cellsCapacity(){ return this.cols * this.maxRows(); }
    cellsUsed(){
      let s=0;
      this.grid.querySelectorAll('._tile').forEach(t=>{
        const c=parseGrid(t.style.gridColumn), r=parseGrid(t.style.gridRow);
        s += (c.span||1) * (r.span||1);
      });
      return s;
    }

    // ---------- Toast ----------
    toastMsg(text, ok=true){
      this.toast.textContent = text;
      this.toast.classList.toggle('err', !ok);
      this.toast.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(()=> this.toast.classList.remove('show'), 1400);
    }

    // ---------- Metrics & mapping ----------
    colWidthPx(){ const M=metricsOf(this.grid,this.cols,this.rowH,this.gap); return M.colW; }
    spanRForC(tile, colSpan){
      const M = metricsOf(this.grid,this.cols,this.rowH,this.gap);
      const raw = parseFloat(tile.dataset.ar || '1');
      const ar  = Number.isFinite(raw) && raw > 0 ? raw : 1;
      const pxH = colSpan * M.colW * ar;
      return Math.max(1, Math.round(pxH / M.unitY));
    }
    setSpanKeepRatio(tile, colStart, colSpan, rowStart){
      const fit = this.fitWithinRows(tile, colStart, colSpan, rowStart);
      setGrid(tile, fit.cStart, fit.cSpan, fit.rStart, fit.rSpan, this.cols);
    }
    fitWithinRows(tile, colStart, colSpan, rowStart){
      const M = metricsOf(this.grid,this.cols,this.rowH,this.gap);
      const maxR = this.maxRows();
      const arRaw = parseFloat(tile.dataset.ar||'1');
      const ar = Number.isFinite(arRaw)&&arRaw>0?arRaw:1;
      const rowSpanFromC = (cs)=> Math.max(1, Math.round((cs * M.colW * ar) / M.unitY));
      let cs = Math.max(1, Math.round(colSpan));
      let rsStart = Math.max(1, rowStart || 1);
      let rs = rowSpanFromC(cs);

      while (rsStart + rs - 1 > maxR && cs > 1){ cs -= 1; rs = rowSpanFromC(cs); }
      if (rsStart + rs - 1 > maxR){ rsStart = Math.max(1, maxR - rs + 1); }
      const cStart = clamp(colStart || 1, 1, this.cols);
      return { cStart, cSpan: cs, rStart: rsStart, rSpan: rs };
    }
    px2col(pxVal, M){
      const m = M || metricsOf(this.grid,this.cols,this.rowH,this.gap);
      const idx = Math.floor( (pxVal + 0.0001) / (m.colW + m.gap) ) + 1;
      return clamp(idx, 1, this.cols);
    }
    px2row(pxVal, M){
      const m = M || metricsOf(this.grid,this.cols,this.rowH,this.gap);
      const idx = Math.floor( (pxVal + 0.0001) / (this.rowH + m.gap) ) + 1;
      return clamp(idx, 1, this.maxRows());
    }
    px2colW(dx, M){ const m=M||metricsOf(this.grid,this.cols,this.rowH,this.gap); return Math.round(dx / (m.colW + m.gap)); }

    // ---------- Preload helpers ----------
    preloadImg(src){
      return new Promise(res=>{
        const img = new Image();
        let done=false, timer=null;
        const finish=(ok)=>{ if(done) return; done=true; if(timer) clearTimeout(timer); res({ok, img}); };
        img.onload = ()=>finish(true);
        img.onerror= ()=>finish(false);
        timer = setTimeout(()=>finish(false), 15000);
        img.src = src;
      });
    }

    // ---------- Add / Replace ----------
    async addByUrl(src, {colSpan=null,rowSpan=null,colStart=null,rowStart=null,revokeOnDone=false,silent=false}={}){
      if(!isSafeUrl(src)){ if(!silent) this.toastMsg('Invalid URL', false); return null; }
      const {ok, img} = await this.preloadImg(src);
      if(!ok){ if(!silent) this.toastMsg('Image load error', false); if(revokeOnDone && /^blob:/.test(src)) try{URL.revokeObjectURL(src);}catch{} return null; }

      const ar = (img.naturalHeight && img.naturalWidth) ? (img.naturalHeight / img.naturalWidth) : 1;
      const t=document.createElement('div'); t.className='_tile'; t.style.zIndex = (++this.zTop).toString();
      t.dataset.id=uid(); t.dataset.src=src; t.dataset.ar=String(Number.isFinite(ar)&&ar>0?ar:1);

      // capacity
      const cs = Math.max(1, Math.round((colSpan||this.DEFAULT_COL_SPAN)));
      const rs = rowSpan==null ? this.spanRForC(t, cs) : Math.max(1, rowSpan);
      const need = cs*rs;
      if(this.cellsUsed() + need > this.cellsCapacity()){
        if(!silent) this.toastMsg('Board full (height limit)', false);
        if(revokeOnDone && /^blob:/.test(src)) try{URL.revokeObjectURL(src);}catch{}
        return null;
      }

      const imgEl=document.createElement('img'); imgEl.src=src; imgEl.alt='image';
      const mv=document.createElement('div'); mv.className='_move'; mv.textContent='move';
      const se=document.createElement('div'); se.className='_rz';
      t.append(imgEl,mv,se);
      this.grid.appendChild(t);

      const fit = this.fitWithinRows(t, colStart||1, cs, rowStart||1);
      setGrid(t, fit.cStart, fit.cSpan, fit.rStart, fit.rSpan, this.cols);

      // interactions
      t.addEventListener('pointerdown', (ev)=>{ ev.stopPropagation(); this.select(t); });
      t.addEventListener('dblclick', ()=>{ const current=t.dataset.src||'https://'; const url=prompt('New image URL:', current); if(url) this.replaceImage(t, url); });
      mv.addEventListener('pointerdown', this.startMove.bind(this));
      se.addEventListener('pointerdown', this.startResize.bind(this));

      if(revokeOnDone && /^blob:/.test(src)) try{URL.revokeObjectURL(src);}catch{}
      if(!silent) this.syncTextarea(); else this.syncTextarea(true);
      return t;
    }

    async replaceImage(tile, newUrl){
      if(!isSafeUrl(newUrl)){ this.toastMsg('Invalid URL', false); return; }
      const {ok, img} = await this.preloadImg(newUrl);
      if(!ok){ this.toastMsg('Image load error', false); return; }
      const ar = (img.naturalHeight && img.naturalWidth) ? (img.naturalHeight / img.naturalWidth) : 1;
      tile.dataset.ar = String(Number.isFinite(ar)&&ar>0?ar:1);
      tile.dataset.src = newUrl;
      const imgEl = tile.querySelector('img'); imgEl.src=newUrl;

      const c=parseGrid(tile.style.gridColumn), r=parseGrid(tile.style.gridRow);
      // If no explicit start (after PACK), infer from current pixel position
      const M = metricsOf(this.grid,this.cols,this.rowH,this.gap);
      const rect = tile.getBoundingClientRect();
      const gridRect = this.grid.getBoundingClientRect();
      const offLeft = rect.left - gridRect.left - M.padL;
      const offTop  = rect.top  - gridRect.top  - M.padT;
      const startC = c.start || this.px2col(offLeft, M);
      const startR = r.start || this.px2row(offTop,  M);

      this.setSpanKeepRatio(tile, startC, c.span, startR);
      this.syncTextarea();
    }

    // ---------- PACK ----------
    packFitWithinCapacity(){
      const tiles = [...this.grid.querySelectorAll('._tile')];
      if(!tiles.length) return;

      const items = tiles.map(t=>{
        const c=parseGrid(t.style.gridColumn);
        const colSpan = Math.max(1, c.span||1);
        const rowSpan = this.spanRForC(t, colSpan);
        return { t, colSpan, rowSpan };
      });

      const cap = this.cellsCapacity();
      const area = () => items.reduce((s,i)=>s + i.colSpan*i.rowSpan, 0);

      let guard = 20000;
      while(area() > cap && guard--){
        items.sort((a,b)=> (b.colSpan*b.rowSpan - a.colSpan*a.rowSpan) || (b.colSpan - a.colSpan));
        const big = items.find(i=> i.colSpan > 1);
        if(!big) break;
        big.colSpan -= 1;
        big.rowSpan = this.spanRForC(big.t, big.colSpan);
      }
      if(area() > cap){ this.toastMsg('Cannot pack: reduce sizes or images', false); }

      items.forEach(i=>{
        i.colSpan = clamp(i.colSpan, 1, this.cols);
        i.rowSpan = clamp(i.rowSpan, 1, this.maxRows());
        i.t.style.gridColumn = `span ${i.colSpan}`;
        i.t.style.gridRow    = `span ${i.rowSpan}`;
        i.t.style.zIndex = (++this.zTop).toString(); // raise order; toolbar still above due to huge z
      });
    }

    // ---------- Selection ----------
    select(el){
      if(this.selected && this.selected!==el) this.selected.classList.remove('_sel');
      this.selected = el || null;
      if(el){
        el.classList.add('_sel');
        el.style.zIndex = (++this.zTop).toString(); // bring tile above others (below toolbar)
      }
    }

    // ---------- Binding ----------
    bind(){
      // Deselect when clicking empty grid area
      this.grid.addEventListener('pointerdown', (e)=>{
        if(e.target === this.grid){ this.select(null); }
      });
      this.bar.addEventListener('pointerdown', e=>e.stopPropagation());
      this.panel.addEventListener('pointerdown', e=>e.stopPropagation());

      // Add files
      this.input.addEventListener('change', async e=>{
        const files=[...e.target.files].filter(f=>/^image\//.test(f.type));
        for(const f of files){
          const url = URL.createObjectURL(f);
          await this.addByUrl(url, { revokeOnDone:true });
        }
        this.input.value='';
      });

      // PACK
      this.btnPack.addEventListener('click', ()=>{ this.packFitWithinCapacity(); this.syncTextarea(); });

      // Data panel
      this.btnData.addEventListener('click', ()=> this.panel.classList.toggle('show'));
      this.btnClose.addEventListener('click', ()=> this.panel.classList.remove('show'));
      this.btnImport.addEventListener('click', ()=>{
        const raw = prompt('Paste JSON:', this.textarea.value||'');
        if(!raw) return;
        if(this.loadSafe(raw)){ this.packFitWithinCapacity(); this.syncTextarea(true); }
      });
      this.btnCopy.addEventListener('click', async ()=>{
        try{ await navigator.clipboard.writeText(this.textarea.value||''); this.toastMsg('Copied', true); }
        catch(_){ this.toastMsg('Copy failed', false); }
      });

      // Drag & drop add
      ['dragenter','dragover'].forEach(t=>{
        this.root.addEventListener(t, e=>{ e.preventDefault(); this.root.classList.add('dragover'); });
      });
      ['dragleave','drop'].forEach(t=>{
        this.root.addEventListener(t, e=>{ e.preventDefault(); this.root.classList.remove('dragover'); });
      });
      this.root.addEventListener('drop', async e=>{
        const files=[...e.dataTransfer.files].filter(f=>/^image\//.test(f.type));
        for(const f of files){
          const url = URL.createObjectURL(f);
          await this.addByUrl(url, { revokeOnDone:true });
        }
      });

      // Paste URL to add
      this.root.addEventListener('paste', async e=>{
        const text=(e.clipboardData||window.clipboardData)?.getData('text')||'';
        if(text) await this.addByUrl(text);
      });

      window.addEventListener('pointercancel', ()=>{ if(this.drag) this.endMove({pointerId:undefined}); });

      // debounced save + change event
      const rawSync=this.syncTextarea.bind(this);
      this.syncTextarea=debounce((silent)=>{ rawSync(silent); this.emitChange(); },160);
    }

    // ---------- Change event ----------
    emitChange(){
      const ev = new CustomEvent('imgcollagechange', { detail: this.toJSON() });
      this.root.dispatchEvent(ev);
    }
    updateHint(){ const hasTiles=this.grid.querySelector('._tile'); this.hint.style.display=hasTiles?'none':'block'; }

    // ---------- Data I/O ----------
    toJSON(){
      return {
        version:1,id:this.id,cols:this.cols,row:this.rowH,gap:this.gap,defaultColSpan:this.DEFAULT_COL_SPAN,
        items:[...this.grid.querySelectorAll('._tile')].map(t=>{
          const c=parseGrid(t.style.gridColumn), r=parseGrid(t.style.gridRow);
          const raw = parseFloat(t.dataset.ar||'1'); const ar = Number.isFinite(raw)&&raw>0?raw:1;
          return { id:t.dataset.id, src:t.dataset.src, colStart:c.start, colSpan:c.span, rowStart:r.start, rowSpan:r.span, ar };
        })
      };
    }
    load(data){
      if(!data||!data.items) return;
      this.cols=data.cols||this.cols; this.rowH=data.row||this.rowH; this.gap=data.gap||this.gap;
      if(data.defaultColSpan) this.DEFAULT_COL_SPAN = +data.defaultColSpan || this.DEFAULT_COL_SPAN;
      this.grid.style.gridTemplateColumns=`repeat(${this.cols},1fr)`;
      this.grid.style.gridAutoRows=this.rowH+'px';
      this.grid.style.gap=`${this.gap}px`; this.grid.style.padding=`${this.gap}px`;
      this.grid.innerHTML='';
      data.items.forEach(it=> this.addByUrl(it.src, { colSpan:it.colSpan, rowSpan:it.rowSpan, colStart:it.colStart, rowStart:it.rowStart, silent:true }));
      this.updateHint();
      // Respect explicit JSON layouts (no auto-pack here)
    }
    loadSafe(raw){
      try{ const obj = typeof raw==='string'? JSON.parse(raw) : raw; this.load(obj); return true; }
      catch(_){ this.toastMsg('Invalid JSON', false); return false; }
    }
    getJSON(){ return JSON.stringify(this.toJSON()); }
    setJSON(obj){ this.load(obj); this.syncTextarea(true); }
    syncTextarea(silent){
      try{ this.textarea.value=this.getJSON(); }catch(_){}
      this.updateHint();
      if(!silent) this.toastMsg('Saved ✓', true);
    }

    // ---------- MOVE ----------
    startMove(e){
      e.preventDefault(); e.stopPropagation();
      const tile = e.currentTarget.parentElement;
      this.select(tile);
      if(e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);

      const gridRect = this.grid.getBoundingClientRect();
      const rect = tile.getBoundingClientRect();
      const M = metricsOf(this.grid,this.cols,this.rowH,this.gap);

      const startLeft = rect.left - gridRect.left - M.padL;
      const startTop  = rect.top  - gridRect.top  - M.padT;

      const ghost = tile.cloneNode(true);
      Object.assign(ghost.style,{position:'absolute',left:startLeft+'px',top:startTop+'px',width:rect.width+'px',height:rect.height+'px',pointerEvents:'none',zIndex:String(Z_LAYER-1)});
      this.layer.appendChild(ghost);

      tile.style.visibility='hidden'; tile.dataset._hidden='1';
      this.drag = { target:e.currentTarget, ghost, tile, M, startX:e.clientX, startY:e.clientY };

      window.addEventListener('pointermove', this.onMoveBound = this.onMove.bind(this), { passive:false });
      window.addEventListener('pointerup',   this.endMoveBound = this.endMove.bind(this), { once:true });
    }
    onMove(e){
      if(!this.drag) return; e.preventDefault();
      const s = this.drag;
      const dx = e.clientX - s.startX, dy = e.clientY - s.startY;
      const curLeft = parseFloat(s.ghost.style.left) + dx;
      const curTop  = parseFloat(s.ghost.style.top)  + dy;

      const maxX = Math.max(0, s.M.innerW - s.ghost.offsetWidth);
      const maxY = Math.max(0, s.M.innerH - s.ghost.offsetHeight);

      s.ghost.style.left = clamp(curLeft, 0, maxX) + 'px';
      s.ghost.style.top  = clamp(curTop,  0, maxY) + 'px';

      s.startX = e.clientX; s.startY = e.clientY;
    }
    endMove(e){
      if(!this.drag) return;
      if(this.drag.target.releasePointerCapture) this.drag.target.releasePointerCapture(e.pointerId);
      const { ghost, tile, M } = this.drag;

      const left = parseFloat(ghost.style.left);
      const top  = parseFloat(ghost.style.top);

      const cStart = this.px2col(left, M);
      const rStart = this.px2row(top,  M);

      const c=parseGrid(tile.style.gridColumn);

      tile.style.visibility=''; delete tile.dataset._hidden;
      this.layer.removeChild(ghost);
      this.drag=null;

      this.setSpanKeepRatio(tile, cStart, c.span, rStart);
      window.removeEventListener('pointermove', this.onMoveBound);
      this.syncTextarea();
    }

    // ---------- RESIZE (Fix: preserve current start even if implicit) ----------
    startResize(e){
      e.stopPropagation();
      const tile=e.currentTarget.parentElement;
      this.select(tile);

      // Read current spans from style
      const c=parseGrid(tile.style.gridColumn), r=parseGrid(tile.style.gridRow);
      const M = metricsOf(this.grid,this.cols,this.rowH,this.gap);

      // If grid-start isn't explicitly set (after PACK it's "span N"), infer the current start from pixel position
      const gridRect = this.grid.getBoundingClientRect();
      const rect = tile.getBoundingClientRect();
      const offLeft = rect.left - gridRect.left - M.padL;
      const offTop  = rect.top  - gridRect.top  - M.padT;

      const inferredCStart = this.px2col(offLeft, M);
      const inferredRStart = this.px2row(offTop,  M);

      const startC = c.start || inferredCStart;
      const startR = r.start || inferredRStart;

      // Store inferred starts so resizing keeps position instead of snapping to (1,1)
      this.rz={tile,startX:e.clientX,startY:e.clientY,col:{start:startC,span:c.span},row:{start:startR,span:r.span},M};
      window.addEventListener('pointermove', this.onResizeBound=this.onResize.bind(this));
      window.addEventListener('pointerup', this.endResizeBound=this.endResize.bind(this), {once:true});
    }
    onResize(e){
      const s=this.rz; if(!s) return;
      const dC=this.px2colW(e.clientX-s.startX, s.M);
      const newC=clamp(s.col.span+dC,1,this.cols);
      this.setSpanKeepRatio(s.tile, s.col.start, newC, s.row.start);
    }
    endResize(){ this.rz=null; window.removeEventListener('pointermove', this.onResizeBound); this.syncTextarea(); }
  }

  const ImgCollage = {
    init(selector='.'+CLASS){
      return Array.from(document.querySelectorAll(selector)).map(n=>new Box(n));
    }
  };
  window.ImgCollage = ImgCollage;
})();

  // Auto init & auto-pack (handled inside constructor for inline <img>)
  ImgCollage.init('.img_collage');