import {pdfDocumentOptions, assertPageRasterDecoded} from './document-raster-operators.mjs';
import {validRenderDimensions} from './document-render-limits.mjs';

export function reviewPageOverlays(report, pageNumber, frame, scale) {
  const held = reason => ({available:false,reason,rectangles:[]});
  const pages = report?.pages?.filter(p => p.page === pageNumber) || [];
  if (pages.length !== 1 || pages[0].assessed !== true) return held('No unique assessed report page.');
  const page = pages[0], view = frame?.view;
  if (!Array.isArray(view) || view.length !== 4 || !view.every(Number.isFinite) || view[0] !== 0 || view[1] !== 0 ||
      frame.rotate !== 0 || frame.userUnit !== 1 || !(scale > 0) || !Number.isFinite(scale) ||
      view[2] !== page.width || view[3] !== page.height || !(page.width > 0 && page.height > 0))
    return held('PDF/report page frames differ or use an unsupported transform.');
  const rectangles = [];
  for (const finding of report.findings || []) {
    if (finding.page !== pageNumber) continue;
    const values = finding.type === 'IMAGE_TEXT_RECTANGLE_OVERLAP'
      ? [['image',finding.image_rectangle],['text',finding.character_rectangle]]
      : finding.rectangle ? [['review',finding.rectangle]] : [];
    for (const [kind,r] of values) {
      if (!r || ![r.x0,r.top,r.x1,r.bottom].every(Number.isFinite) || r.x1 <= r.x0 || r.bottom <= r.top)
        return held('A reported rectangle is unavailable or invalid.');
      rectangles.push({kind,type:String(finding.type),x:r.x0*scale,y:r.top*scale,width:(r.x1-r.x0)*scale,height:(r.bottom-r.top)*scale});
    }
  }
  return {available:true,reason:'Reported rectangles only; not glyph ink or proven occlusion.',rectangles};
}

const defaultLoader = async () => {
  const pdfjs = await import('/vendor/pdfjs/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
  return pdfjs;
};

export function mountNaturalPreview({host, loader = defaultLoader}) {
  host.hidden = true;
  const title = document.createElement('h4'); title.textContent = 'Rendered draft — visual review';
  const legend = document.createElement('p'); legend.textContent = 'Orange: reported image rectangle. Teal: reported character rectangle. Markers are review locations, not glyph ink or proven occlusion. Publication remains blocked.';
  const select = document.createElement('select'); select.dataset.naturalPreview = 'page'; select.setAttribute('aria-label','Reviewed PDF page');
  const status = document.createElement('p'); status.dataset.naturalPreview = 'status'; status.setAttribute('role','status');
  const viewport = document.createElement('div'); viewport.dataset.naturalPreview = 'viewport'; viewport.style.overflow = 'auto';
  host.append(title,legend,select,status,viewport);
  let epoch=0, task=null, pdf=null, pkg=null, report=null, render=null, active=Promise.resolve(), release=Promise.resolve(true), pageToken=0;
  const retire = () => {
    pageToken++;
    try { render?.cancel(); } catch { /* Destroy below remains required. */ }
    const owned=task; task=null; pdf=null; report=null;
    release=release.then(async ok=>{
      let released=true;
      try { if(owned) await owned.destroy(); } catch { released=false; }
      try { await active; } catch { /* Render failures do not waive destroy. */ }
      return ok && released;
    });
    return release;
  };
  const paint = async (number, token) => {
    const point=++pageToken;
    try { render?.cancel(); } catch { }
    const previous=active;
    active=(async()=>{
      await previous.catch(()=>{});
      if(token!==epoch || point!==pageToken || !pdf) return;
      viewport.replaceChildren(); status.textContent='Rendering selected page…';
      const ownedPdf=pdf, ownedReport=report, page=await ownedPdf.getPage(number);
      if(token!==epoch || point!==pageToken) return;
      try {
        const frame=page.getViewport({scale:1});
        if(!validRenderDimensions(frame.width,frame.height)) throw Error('Page exceeds the bounded preview canvas.');
        const canvas=document.createElement('canvas'); canvas.width=Math.ceil(frame.width); canvas.height=Math.ceil(frame.height);
        canvas.style.width=`${frame.width}px`; canvas.style.height=`${frame.height}px`;
        render=page.render({canvasContext:canvas.getContext('2d'),viewport:frame});
        await render.promise;
        if(token!==epoch || point!==pageToken) return;
        await assertPageRasterDecoded(page,pkg.OPS,await page.getOperatorList());
        if(token!==epoch || point!==pageToken) return;
        const marks=reviewPageOverlays(ownedReport,number,page,1);
        const sheet=document.createElement('div'); sheet.style.position='relative';sheet.style.width=`${frame.width}px`;sheet.style.height=`${frame.height}px`;
        sheet.append(canvas);
        if(marks.available) {
          const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
          svg.setAttribute('width',frame.width);svg.setAttribute('height',frame.height);svg.setAttribute('viewBox',`0 0 ${frame.width} ${frame.height}`);
          svg.style.position='absolute';svg.style.left='0';svg.style.top='0';svg.style.pointerEvents='none';svg.style.overflow='visible';
          for(const r of marks.rectangles) {
            const box=document.createElementNS('http://www.w3.org/2000/svg','rect');
            for(const k of ['x','y','width','height'])box.setAttribute(k,r[k]);
            box.setAttribute('fill','none');box.setAttribute('stroke',r.kind==='image'?'#c65c00':'#007f80');box.setAttribute('stroke-width','1');
            const label=document.createElementNS('http://www.w3.org/2000/svg','title');label.textContent=`${r.type}: ${r.kind} rectangle`;box.append(label);svg.append(box);
          }
          sheet.append(svg);
        }
        viewport.append(sheet);status.textContent=`Page ${number} of ${ownedPdf.numPages}. ${marks.available ? `${marks.rectangles.length} rectangle marker(s). ${marks.reason}` : `Overlays unavailable: ${marks.reason}`}`;
      } finally { render=null;page.cleanup(); }
    })();
    try { await active; } catch(error) { if(token===epoch && point===pageToken) {viewport.replaceChildren();status.textContent=`Preview held: ${error.message}`;} }
  };
  select.addEventListener('change',()=>paint(Number(select.value),epoch));
  return {
    async clear() {epoch++;host.hidden=true;viewport.replaceChildren();select.replaceChildren();status.textContent='';return retire();},
    async show(value) {
      const token=++epoch;host.hidden=false;viewport.replaceChildren();select.replaceChildren();status.textContent='Opening the bound reviewed PDF…';
      if(!await retire()) {if(token===epoch)status.textContent='Preview held: prior PDF cleanup could not be confirmed.';return;}
      if(token!==epoch)return;
      try {
        pkg=await loader();if(token!==epoch)return;
        const owned=pkg.getDocument(pdfDocumentOptions(value.pdfBytes.slice()));task=owned;
        const loaded=await owned.promise;if(token!==epoch)return;
        pdf=loaded;report=value.report;
        for(let n=1;n<=pdf.numPages;n++){const option=document.createElement('option');option.value=String(n);option.textContent=`Page ${n}`;select.append(option);}
        select.value='1';await paint(1,token);
      } catch(error) { if(token===epoch) {status.textContent=`Preview held: ${error.message}`;await retire();} }
    }
  };
}
