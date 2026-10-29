// Browser port of the desktop image-label overlay path. Source and derived pixels
// are separate; neither OCR confidence nor a successful fit is source review.
import {createFigureTranslationSheet,readFigureTranslationSheet,figureLabelLiterals as literals} from './document-figure-translation-sheet.mjs';
const MAX_LABELS = 200;
const MAX_PIXELS = 12_000_000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
function validBox(box, frame) {
  return box && ['x','y','width','height'].every(k => finite(box[k])) &&
    box.x >= 0 && box.y >= 0 && box.width >= 1 && box.height >= 1 &&
    box.x + box.width <= frame.width && box.y + box.height <= frame.height;
}
function parseBox(text, frame) {
  const parts = text.split(',').map(x => x.trim());
  if (parts.length !== 4 || parts.some(x => !/^\d+(?:\.\d+)?$/.test(x))) return null;
  const [x,y,width,height] = parts.map(Number), box = {x,y,width,height};
  return validBox(box,frame) ? box : null;
}
const boxText = b => `${b.x}, ${b.y}, ${b.width}, ${b.height}`;
function validText(text) {
  return typeof text === 'string' && text.trim().length > 0 &&
    Array.from(text).length <= 3000 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(text);
}

/** OCR positions are relative to the selected crop, never the displayed CSS size. */
export function normalizeFigureOcr(data, crop, frame, rotation=0, onHold=()=>{}) {
  const hold=message=>{onHold(message);return [];};
  if (!validBox(crop,frame))return hold('Invalid source crop geometry.');
  if (!Array.isArray(data?.blocks))return hold('OCR returned no blocks array.');
  if (![0,90,180,270].includes(rotation))return hold('Unsupported OCR rotation.');
  const ocrFrame=rotation%180?{width:crop.height,height:crop.width}:crop;
  const result = [];
  for (const block of data.blocks) {
    if (!Array.isArray(block?.paragraphs))return hold('An OCR block has no paragraphs array.');
    for (const paragraph of block.paragraphs) {
      if (!Array.isArray(paragraph?.lines))return hold('An OCR paragraph has no lines array.');
      for (const line of paragraph.lines) {
        const b=line?.bbox;
        if (!validText(line?.text))return hold('An OCR line has empty or unsupported text.');
        if (!b || ![b.x0,b.y0,b.x1,b.y1].every(finite))return hold('An OCR line has missing or nonfinite coordinates.');
        const local={x:b.x0,y:b.y0,width:b.x1-b.x0,height:b.y1-b.y0};
        if (!validBox(local,ocrFrame))return hold('An OCR line box is outside the selected crop.');
        const {x,y,width:w,height:h}=local,W=crop.width,H=crop.height;
        const mapped=rotation===90?{x:y,y:H-x-w,width:h,height:w}:rotation===180?{x:W-x-w,y:H-y-h,width:w,height:h}:rotation===270?{x:W-y-h,y:x,width:h,height:w}:local;
        const sourceBox={...mapped,x:crop.x+mapped.x,y:crop.y+mapped.y};
        if(!validBox(sourceBox,frame))return hold('An OCR line box is outside the source page.');
        result.push({id:`label-${result.length+1}`,sourceText:line.text.trim(),targetText:'',sourceBox,
          figureCrop:Object.freeze({...crop}),targetBox:{...sourceBox},targetRotation:(360-rotation)%360,reviewed:false,revision:0,
          confidence:finite(line.confidence)?line.confidence:null});
        if (result.length > MAX_LABELS)return hold('OCR exceeds the 200-label limit.');
      }
    }
  }
  return result;
}

export function diagnoseFigureOcr(data,crop,frame,rotation=0) {
  let issue=null;
  const labels=normalizeFigureOcr(data,crop,frame,rotation,message=>{issue=message;});
  return {labels,issue:issue||(!labels.length?'OCR returned no positioned lines.':null)};
}

/** Keep exact selected crop regions; no guessed expansion of OCR/native boxes. */
export function figureExportRegions(labels,frame) {
  if(!Array.isArray(labels)||!labels.length||labels.length>MAX_LABELS)throw Error('Missing figure labels.');
  if(labels.some(l=>!validBox(l.figureCrop,frame)||!validBox(l.sourceBox,frame)||!validBox(l.targetBox,frame)))
    throw Error('Missing or invalid selected figure crop geometry.');
  const boxes=[...labels.map(l=>l.figureCrop),...labels.flatMap(l=>[l.sourceBox,l.targetBox])];
  const contains=(a,b)=>a.x<=b.x&&a.y<=b.y&&a.x+a.width>=b.x+b.width&&a.y+a.height>=b.y+b.height;
  const same=(a,b)=>['x','y','width','height'].every(k=>a[k]===b[k]);
  const output=boxes.filter((b,i)=>!boxes.some((a,j)=>i!==j&&contains(a,b)&&(!same(a,b)||j<i)));
  if(output.length>400)throw Error('Too many figure output regions.');
  return output.map(b=>({...b}));
}

function copyCanvas(source, doc) {
  const canvas=doc.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
  canvas.getContext('2d').drawImage(source,0,0);return canvas;
}
function background(context, box) {
  // Dominant inset colour, as in the desktop implementation. Always sample the
  // immutable source so an earlier translated label cannot colour a later mask.
  const buckets=new Map();
  for(let y=1;y<=7;y++)for(let x=1;x<=7;x++) {
    const px=Math.min(context.canvas.width-1,Math.floor(box.x+box.width*x/8));
    const py=Math.min(context.canvas.height-1,Math.floor(box.y+box.height*y/8));
    const d=context.getImageData(px,py,1,1).data;
    const key=[d[0],d[1],d[2]].map(v=>Math.floor(v/12)).join(',');
    const item=buckets.get(key)||{n:0,r:0,g:0,b:0};item.n++;item.r+=d[0];item.g+=d[1];item.b+=d[2];buckets.set(key,item);
  }
  const best=[...buckets.values()].sort((a,b)=>b.n-a.n||(b.r+b.g+b.b)/b.n-(a.r+a.g+a.b)/a.n)[0];
  return [best.r,best.g,best.b].map(v=>Math.round(v/best.n));
}
function wrapText(ctx,text,width) {
  const lines=[];
  for(const paragraph of text.split(/\r?\n/u)) {
    let current='';
    // Glyph-by-glyph wrapping works for CJK labels without word-space assumptions.
    for(const glyph of Array.from(paragraph)) {
      if(ctx.measureText(glyph).width>width)return null;
      if(current&&ctx.measureText(current+glyph).width>width){lines.push(current);current=glyph;}
      else current+=glyph;
    }
    lines.push(current);
  }
  return lines;
}
function fit(ctx,text,box) {
  const inset=2,width=box.width-inset*2,height=box.height-inset*2;
  if(width<=0||height<=0)return null;
  for(let size=Math.min(32,box.height*.82);size>=5.5;size-=.5) {
    ctx.font=`${size}px "Malgun Gothic", sans-serif`;
    const lines=wrapText(ctx,text,width);
    if(lines&&lines.length*size*1.25<=height)return {size,lines,lineHeight:size*1.25};
  }
  return null;
}
// Ordered finite literal profile, not equation parsing or semantic clearance.
// Keep scripts distinct from ordinary digits; NFKC would erase that distinction.
// Prose may be translated. Only a hyphen joining ASCII letters is ignored.
// Marked Latin bases stay bound to signed ASCII scripts or common Unicode
// super/subscripts. Unmarked variables and units outside this profile are not
// assessed; a matching signature is never a full equation verification.

// The controller marks OCR proposals with cropKey. A tight OCR box may omit
// antialiased source pixels. Hold uncertain coverage; never grow its mask.
function assertOcrSourceCoverage(source,labels) {
  const groups=new Map(),backgrounds=new Map(),keys=['x','y','width','height'];
  const hold=()=>{throw Error('OCR source coverage is uncertain. Preview held; compare the original.');};
  for(const label of labels) {
    if(!Object.hasOwn(label,'cropKey'))continue;
    const crop=label.figureCrop,box=label.sourceBox;
    if(!validBox(crop,source)||!validBox(box,source)||
      !keys.every(k=>Number.isInteger(crop[k])&&Number.isInteger(box[k]))||
      box.x<crop.x||box.y<crop.y||box.x+box.width>crop.x+crop.width||box.y+box.height>crop.y+crop.height)hold();
    const key=keys.map(k=>crop[k]).join(',');
    if(!groups.has(key))groups.set(key,{crop,boxes:[],labels:[]});
    groups.get(key).boxes.push(box);groups.get(key).labels.push(label);
  }
  if([...groups.values()].reduce((n,{crop})=>n+crop.width*crop.height,0)>MAX_PIXELS)hold();
  if(!groups.size)return backgrounds;
  const context=source.getContext('2d');
  for(const {crop,boxes,labels:groupLabels} of groups.values()) {
    const {width,height}=crop,pixels=context.getImageData(crop.x,crop.y,width,height).data;
    const rgb=[pixels[0],pixels[1],pixels[2]];
    for(let y=0;y<height;y++) {
      const row=boxes.filter(b=>crop.y+y>=b.y&&crop.y+y<b.y+b.height)
        .map(b=>[b.x-crop.x,b.x-crop.x+b.width]).sort((a,b)=>a[0]-b[0]);
      let interval=0;
      for(let x=0;x<width;x++) {
        while(interval<row.length&&row[interval][1]<=x)interval++;
        const covered=interval<row.length&&row[interval][0]<=x;
        const i=(y*width+x)*4;
        if(pixels[i+3]!==255)hold();
        if((!covered||x===0||y===0||x===width-1||y===height-1)&&
          (pixels[i]!==rgb[0]||pixels[i+1]!==rgb[1]||pixels[i+2]!==rgb[2]))hold();
      }
    }
    for(const label of groupLabels)backgrounds.set(label,rgb);
  }
  const masks=[...backgrounds];
  for(let i=0;i<masks.length;i++)for(let j=i+1;j<masks.length;j++) {
    const [left,leftRgb]=masks[i],[right,rightRgb]=masks[j],a=left.sourceBox,b=right.sourceBox;
    if(a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height&&
      leftRgb.some((value,k)=>value!==rightRgb[k]))
      throw Error('Overlapping OCR source masks have conflicting validated backgrounds. Preview held.');
  }
  return backgrounds;
}

/** All-or-nothing derived page. No source canvas edits, clipping or ellipsis. */
export function renderFigureOverlay(source,labels,doc=source.ownerDocument) {
  if(!Array.isArray(labels)||!labels.length||labels.length>MAX_LABELS)throw new Error('Run OCR or add a label first.');
  const ocrBackgrounds=assertOcrSourceCoverage(source,labels);
  const output=copyCanvas(source,doc),ctx=output.getContext('2d'),sourceContext=source.getContext('2d'),plans=[];
  for(const label of labels) {
    if(!label.reviewed||!validText(label.sourceText)||!validText(label.targetText))throw new Error('Check each source label and enter its translation.');
    if(!validBox(label.sourceBox,source)||!validBox(label.targetBox,source))throw new Error('A source or target box is outside this page.');
    if(literals(label.sourceText)!==literals(label.targetText))throw new Error('Source and translation numbers, mathematical notation or literal units differ. Check this label.');
    const angle=label.targetRotation??0;
    if(![0,90,180,270].includes(angle))throw new Error('Unsupported target label rotation.');
    const fitted=fit(ctx,label.targetText,angle%180?{width:label.targetBox.height,height:label.targetBox.width}:label.targetBox);
    if(!fitted)throw new Error('A translation does not fit. Correct its target box or wording.');
    // OCR masks use the exact crop RGB already checked above; ink inside a
    // tight source box must not replace that evidence with a sampled colour.
    const rgb=ocrBackgrounds.get(label)??background(sourceContext,label.sourceBox);plans.push({label,fitted,rgb});
  }
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++) {
    const a=labels[i].targetBox,b=labels[j].targetBox;
    if(a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height)
      throw new Error('Target label boxes overlap. Correct their positions before preview.');
  }
  // Erase all old labels before painting any targets, including relocated ones.
  for(const {label,rgb} of plans){const b=label.sourceBox;ctx.fillStyle=`rgb(${rgb.join(',')})`;ctx.fillRect(b.x,b.y,b.width,b.height);}
  const foregrounds=plans.map(({label})=>background(ctx,label.targetBox));
  for(const [index,{label,fitted}] of plans.entries()) {
    const rgb=foregrounds[index];
    const b=label.targetBox;ctx.font=`${fitted.size}px "Malgun Gothic", sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle=(rgb[0]*.299+rgb[1]*.587+rgb[2]*.114)>140?'#000':'#fff';
    const first=-(fitted.lines.length-1)*fitted.lineHeight/2;
    ctx.save();ctx.translate(b.x+b.width/2,b.y+b.height/2);ctx.rotate((label.targetRotation??0)*Math.PI/180);
    fitted.lines.forEach((line,i)=>ctx.fillText(line,0,first+i*fitted.lineHeight));ctx.restore();
  }
  return output;
}

export function mountFigureOverlay({host,recognize,translate,available=()=>false,targetLanguage=()=> 'ko',
  createPdf=async payload=>(await import('./document-figure-pdf.mjs')).exportFigurePdf(payload),
  createDocx=async payload=>(await import('./document-figure-docx.mjs')).exportDocxCanvases(payload.session,payload.images)}) {
  if(!host)return null;
  const doc=host.ownerDocument,el=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const action=(name,title)=>{const b=el('button',title);b.type='button';b.dataset.figureAction=name;return b;};
  const field=(key,title,tag='input')=>{const label=el('label',title),input=el(tag);input.dataset.figureField=key;label.append(input);return{label,input};};
  host.replaceChildren();host.hidden=true;host.classList.add('figure-overlay-workbench');
  host.append(el('h3','Figure OCR → translation → original-position overlay'));
  const introduction=el('p','Select a figure crop, check its OCR labels and translate each label. Page and crop changes retain your drafts. Adjust target positions while keeping original lines, symbols and images. Selected crop regions are rasterized in the PDF; content outside those regions is preserved in its source language. Original text may remain searchable underneath; this is not redaction.');const pageIntroduction=introduction.textContent;host.append(introduction);
  const pageField=field('page','Page','select'),cropField=field('crop','Figure crop · x, y, width, height');
  const rotationField=field('ocr-rotation','Rotate crop for OCR','select'),targetRotationField=field('target-rotation','Target label rotation','select');
  for(const angle of [0,90,180,270])for(const f of [rotationField,targetRotationField]){const o=el('option',`${angle}° clockwise`);o.value=String(angle);f.input.append(o);}
  const profileField=field('ocr-profile','OCR label layout','select');
  for(const [value,title]of [['diagram','Boxed or aligned labels'],['visual','Scattered labels'],['page','Whole-crop layout']]){const o=el('option',title);o.value=value;profileField.input.append(o);}
  const ocr=action('ocr','Read figure labels locally'),add=action('add','Add missing label'),discard=action('discard','Discard selected label proposal');
  const list=el('select');list.dataset.figureField='label';list.setAttribute('aria-label','Figure label');
  const sourceField=field('source','Source label','textarea'),sourceBoxField=field('source-box','Original label box · x, y, width, height');
  const targetField=field('target','Translation','textarea'),targetBoxField=field('target-box','Target position · x, y, width, height');
  const checked=field('reviewed','I checked this source label and its original box.');checked.input.type='checkbox';
  const send=action('translate','Translate selected label'),preview=action('preview','Restore translated figure preview'),download=action('download','Download derived page PNG'),pdf=action('pdf','Download figure-region draft PDF'),docx=action('docx','Download figure draft DOCX');docx.hidden=true;
  const sheetDownload=action('sheet-download','Download label translation sheet'),sheetImport=action('sheet-import','Import label translation sheet');
  const sheetFile=el('input');sheetFile.type='file';sheetFile.accept='.json,application/json';sheetFile.hidden=true;sheetFile.dataset.figureField='translation-sheet-file';
  const sheetHelp=el('p','Edit targetText in the local JSON sheet to translate labels together. Import requires the same image, source labels and language. It does not verify OCR or approve the translation.');
  const status=el('p');status.setAttribute('role','status');status.dataset.figureStatus='';
  const before=el('canvas'),after=el('canvas');before.dataset.figureSource='';after.dataset.figureOutput='';
  before.setAttribute('aria-label','Original figure crop and label positions');after.setAttribute('aria-label','Derived translated page draft');
  for(const canvas of [before,after]){canvas.style.maxWidth='100%';canvas.style.height='auto';}
  const controls=el('div');controls.style.display='grid';controls.style.gap='.5rem';
  controls.append(pageField.label,cropField.label,rotationField.label,profileField.label,ocr,add,list,discard,sourceField.label,sourceBoxField.label,targetField.label,targetBoxField.label,targetRotationField.label,checked.label,send,sheetHelp,sheetDownload,sheetImport,sheetFile,preview,download,pdf,docx);
  const diagnostic=el('details'),summary=el('summary','OCR text and coordinate issues'),raw=el('pre');raw.dataset.figureOcrDiagnostic='';raw.style.maxHeight='16rem';raw.style.overflow='auto';diagnostic.append(summary,raw);
  host.append(controls,status,diagnostic,before,after);
  let records=[],active=null,source=null,labels=[],selected=0,epoch=0,editSerial=0,nextId=0,ocrBusy=false,sendBusy=false,pdfBusy=false,docxBusy=false,docxJob=0,docxSession=null,ready=false,drag=null,sheetBusy=false,sheetIntent=null;
  const current=()=>labels[selected];
  const allReady=()=>records.some(r=>r.labels.length)&&records.every(r=>!r.labels.length||r.output);
  function invalidate(){if(active)active.output=null;ready=false;download.disabled=true;pdf.disabled=true;docx.disabled=true;after.hidden=true;after.width=1;after.height=1;}
  function refreshAvailability(){const label=current();send.disabled=!label?.reviewed||!validText(label?.sourceText)||!available()||sendBusy||ocrBusy;ocr.disabled=!source||ocrBusy||sendBusy;add.disabled=!source||ocrBusy||sendBusy||labels.length>=MAX_LABELS;discard.disabled=!label;preview.disabled=!labels.length||ocrBusy||sendBusy;download.disabled=!ready;pdf.disabled=!!docxSession||!allReady()||ocrBusy||sendBusy||pdfBusy;docx.disabled=!docxSession||!allReady()||ocrBusy||sendBusy||docxBusy;sheetDownload.disabled=sheetImport.disabled=!labels.length||ocrBusy||sendBusy||sheetBusy;}
  function paintSource(){if(!source)return;before.width=source.width;before.height=source.height;const c=before.getContext('2d');c.drawImage(source,0,0);const crop=parseBox(cropField.input.value,source);c.lineWidth=2;c.strokeStyle='#cf2870';if(crop)c.strokeRect(crop.x,crop.y,crop.width,crop.height);for(const l of labels){c.strokeStyle=l===current()?'#f00000':'#1a7194';c.strokeRect(l.sourceBox.x,l.sourceBox.y,l.sourceBox.width,l.sourceBox.height);}}
  function showLabel(){const l=current();if(active)active.selected=selected;sourceField.input.value=l?.sourceText||'';targetField.input.value=l?.targetText||'';sourceBoxField.input.value=l?boxText(l.sourceBox):'';targetBoxField.input.value=l?boxText(l.targetBox):'';checked.input.checked=!!l?.reviewed;targetRotationField.input.value=String(l?.targetRotation??0);for(const f of [sourceField,sourceBoxField,targetField,targetBoxField,targetRotationField,checked])f.input.disabled=!l;list.value=String(selected);paintSource();refreshAvailability();}
  function listLabels(){list.replaceChildren();labels.forEach((l,i)=>{const o=el('option',`${i+1}. ${l.sourceText}`);o.value=String(i);list.append(o);});list.disabled=!labels.length;showLabel();}
  function selectPage(){epoch++;ocrBusy=false;sendBusy=false;pdfBusy=false;drag=null;active=records[Number(pageField.input.value)]||null;source=active?.canvas||null;labels=active?.labels||[];selected=active?.selected||0;cropField.input.value=active?.crop||'';rotationField.input.value=String(active?.rotation??0);profileField.input.value=active?.profile||'diagram';ready=!!active?.output;after.hidden=!ready;if(ready){after.width=active.output.width;after.height=active.output.height;after.getContext('2d').drawImage(active.output,0,0);}else{after.width=1;after.height=1;}status.textContent='Draw a crop or enter its pixel coordinates. Existing page drafts are retained.';listLabels();}
  pageField.input.addEventListener('change',selectPage);list.addEventListener('change',()=>{selected=Number(list.value);showLabel();});
  cropField.input.addEventListener('input',()=>{epoch++;ocrBusy=false;sendBusy=false;pdfBusy=false;drag=null;if(active)active.crop=cropField.input.value;paintSource();refreshAvailability();});
  rotationField.input.addEventListener('change',()=>{epoch++;ocrBusy=false;sendBusy=false;pdfBusy=false;if(active)active.rotation=Number(rotationField.input.value);refreshAvailability();});
  profileField.input.addEventListener('change',()=>{epoch++;ocrBusy=false;sendBusy=false;pdfBusy=false;if(active)active.profile=profileField.input.value;refreshAvailability();});
  targetRotationField.input.addEventListener('change',()=>{const l=current();if(!l)return;l.targetRotation=Number(targetRotationField.input.value);l.revision++;editSerial++;invalidate();refreshAvailability();});
  before.style.touchAction='none';
  const point=e=>{const r=before.getBoundingClientRect();return{x:Math.max(0,Math.min(before.width,Math.round((e.clientX-r.left)*before.width/r.width))),y:Math.max(0,Math.min(before.height,Math.round((e.clientY-r.top)*before.height/r.height)))};};
  before.addEventListener('pointerdown',e=>{if(!source)return;drag=point(e);before.setPointerCapture(e.pointerId);});
  before.addEventListener('pointerup',e=>{if(!drag)return;const end=point(e),box={x:Math.min(drag.x,end.x),y:Math.min(drag.y,end.y),width:Math.abs(drag.x-end.x),height:Math.abs(drag.y-end.y)};drag=null;if(validBox(box,source)){cropField.input.value=boxText(box);cropField.input.dispatchEvent(new Event('input',{bubbles:true}));}});
  before.addEventListener('pointercancel',()=>{drag=null;});
  for(const [f,key,isSource] of [[sourceField,'sourceText',true],[targetField,'targetText',false],[sourceBoxField,'sourceBox',true],[targetBoxField,'targetBox',false]])f.input.addEventListener('input',()=>{
    const l=current();if(!l)return;l.revision++;editSerial++;invalidate();
    if(key.endsWith('Box')){const b=parseBox(f.input.value,source);l[key]=b||{x:NaN,y:NaN,width:NaN,height:NaN};}else l[key]=f.input.value;
    if(isSource){l.reviewed=false;l.targetText='';targetField.input.value='';checked.input.checked=false;}
    paintSource();refreshAvailability();
  });
  checked.input.addEventListener('change',()=>{const l=current();if(l){l.revision++;editSerial++;l.reviewed=checked.input.checked&&validText(l.sourceText)&&validBox(l.sourceBox,source);checked.input.checked=l.reviewed;invalidate();refreshAvailability();}});
  add.addEventListener('click',()=>{const crop=source&&parseBox(cropField.input.value,source);if(!crop||labels.length>=MAX_LABELS)return;epoch++;editSerial++;ocrBusy=false;sendBusy=false;labels.push({id:`manual-${++nextId}`,sourceText:'',targetText:'',sourceBox:{...crop},figureCrop:Object.freeze({...crop}),targetBox:{...crop},reviewed:false,revision:0,confidence:null});selected=labels.length-1;invalidate();listLabels();});
  discard.addEventListener('click',()=>{if(!current())return;epoch++;editSerial++;ocrBusy=false;sendBusy=false;labels.splice(selected,1);selected=Math.max(0,selected-1);invalidate();listLabels();status.textContent='Label proposal discarded. Original page content is retained.';});
  ocr.addEventListener('click',async()=>{
    const crop=source&&parseBox(cropField.input.value,source);if(!crop||ocrBusy||sendBusy){status.textContent='Enter a crop inside this page.';return;}
    const angle=Number(rotationField.input.value),profile=profileField.input.value;if(![0,90,180,270].includes(angle)||!['diagram','visual','page'].includes(profile))return;
    if(angle&&![crop.x,crop.y,crop.width,crop.height].every(Number.isInteger)){status.textContent='Use integer pixel crop coordinates for quarter-turn OCR.';return;}
    const cropKey=boxText(crop);
    if(labels.some(l=>l.cropKey===cropKey)){status.textContent='This crop already has OCR proposals. Keep them or discard its proposals before reading it again.';return;}
    const ticket=++epoch,revision=editSerial;ocrBusy=true;refreshAvailability();status.textContent='Reading figure labels locally…';
    try{const canvas=doc.createElement('canvas');canvas.width=Math.ceil(crop.width);canvas.height=Math.ceil(crop.height);canvas.getContext('2d').drawImage(source,crop.x,crop.y,crop.width,crop.height,0,0,crop.width,crop.height);
      let oriented=canvas;
      if(angle){oriented=doc.createElement('canvas');oriented.width=angle%180?canvas.height:canvas.width;oriented.height=angle%180?canvas.width:canvas.height;const ctx=oriented.getContext('2d');ctx.translate(oriented.width/2,oriented.height/2);ctx.rotate(angle*Math.PI/180);ctx.drawImage(canvas,-canvas.width/2,-canvas.height/2);}
      const data=await recognize(oriented,profile);if(ticket!==epoch)return;
      if(revision!==editSerial){status.textContent='Edits made during OCR were retained. No OCR labels were added.';return;}
      const report=diagnoseFigureOcr(data,crop,source,angle),incoming=report.labels;
      const observed=JSON.stringify({page:Number(pageField.input.value)+1,crop,rotation:angle,profile,issue:report.issue,text:data?.text,blocks:data?.blocks},null,2);raw.textContent=observed.length<=200000?observed:observed.slice(0,200000)+'\n[Diagnostic display truncated; label admission still uses the full OCR result.]';
      if(labels.length+incoming.length>MAX_LABELS){status.textContent='This page exceeds the 200-label limit. Existing drafts were retained.';return;}
      if(incoming.length){selected=labels.length;for(const l of incoming)labels.push({...l,id:`ocr-${++nextId}`,cropKey});editSerial++;invalidate();}
      status.textContent=incoming.length?`${incoming.length} OCR label(s) added. Check each source and rectangle before translation.`:`${report.issue} Existing drafts were retained; inspect the OCR details or add missing labels.`;listLabels();
    }catch{if(ticket===epoch)status.textContent='Local OCR failed. The original image is unchanged; add labels manually.';}
    finally{if(ticket===epoch){ocrBusy=false;refreshAvailability();}}
  });
  send.addEventListener('click',async()=>{
    const l=current();if(send.disabled||!l?.reviewed||!validBox(l.sourceBox,source))return;
    const ticket=epoch,revision=l.revision,language=targetLanguage();sendBusy=true;refreshAvailability();status.textContent='Translating the selected reviewed label…';
    try{const result=await translate({sourceText:l.sourceText,targetLanguage:language,includeExperimentalCritique:false});
      if(ticket!==epoch||revision!==l.revision||!labels.includes(l)||language!==targetLanguage())return;
      if(!result?.complete||!validText(result.translation)){status.textContent='Translation did not complete. No label was replaced.';return;}
      l.targetText=result.translation;l.revision++;editSerial++;invalidate();showLabel();status.textContent='Translation draft placed at the original coordinates. Check or adjust the target position.';
    }catch{if(ticket===epoch)status.textContent='Translation unavailable. No label was replaced.';}
    finally{if(ticket===epoch){sendBusy=false;refreshAvailability();}}
  });
  preview.addEventListener('click',()=>{
    invalidate();try{const output=renderFigureOverlay(source,labels,doc);active.output=output;after.width=output.width;after.height=output.height;after.getContext('2d').drawImage(output,0,0);after.hidden=false;ready=true;status.textContent='Derived page preview ready. Inspect label fit, masks, lines and symbols. Other content remains in its source language.';}catch(e){status.textContent=e.message;}refreshAvailability();
  });
  function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  const sheetCapture=()=>({record:active,ticket:epoch,version:editSerial,language:targetLanguage()});
  const sheetCurrent=s=>s.record===active&&s.ticket===epoch&&s.version===editSerial&&s.language===targetLanguage();
  async function sheetBinding(record,language){
    if(!record.sourceDigest){const pixels=record.canvas.getContext('2d').getImageData(0,0,record.canvas.width,record.canvas.height).data;
      record.sourceDigest=crypto.subtle.digest('SHA-256',pixels).then(b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join(''));}
    return{sourceSha256:await record.sourceDigest,width:record.canvas.width,height:record.canvas.height,targetLanguage:language};
  }
  sheetDownload.addEventListener('click',async()=>{
    if(sheetDownload.disabled)return;const state=sheetCapture();sheetBusy=true;refreshAvailability();
    try{const binding=await sheetBinding(state.record,state.language);if(!sheetCurrent(state))return;
      const sheet=createFigureTranslationSheet(binding,labels);
      saveBlob(new Blob([JSON.stringify(sheet,null,2)],{type:'application/json;charset=utf-8'}),`mtqc-figure-labels-${Number(pageField.input.value)+1}-${state.language}.json`);
      status.textContent='Local translation sheet downloaded. Edit targetText only, then import it. Source review is unchanged.';
    }catch(e){if(sheetCurrent(state))status.textContent=`Translation sheet held: ${e.message}`;}
    finally{sheetBusy=false;refreshAvailability();}
  });
  sheetImport.addEventListener('click',()=>{if(sheetImport.disabled)return;sheetIntent=sheetCapture();sheetFile.value='';sheetFile.click();});
  sheetFile.addEventListener('change',async()=>{
    const file=sheetFile.files?.[0],state=sheetIntent;sheetIntent=null;
    if(!file||!state)return;
    if(!sheetCurrent(state)){status.textContent='Source or draft changed. Import was not applied.';return;}
    sheetBusy=true;refreshAvailability();
    try{if(file.size>8*1024*1024)throw Error('Translation sheet exceeds 8 MiB.');
      const content=await file.text(),binding=await sheetBinding(state.record,state.language);
      if(!sheetCurrent(state)){status.textContent='Source or draft changed during import. No translations were replaced.';return;}
      const targets=readFigureTranslationSheet(JSON.parse(content),binding,labels);
      labels.forEach((label,i)=>{label.targetText=targets[i];label.revision++;});editSerial++;invalidate();showLabel();
      status.textContent=`${targets.length} local translation draft(s) imported. Source review is unchanged. Inspect labels, masks and fit before exporting.`;
    }catch(e){if(sheetCurrent(state))status.textContent=`Translation sheet held: ${e.message}`;}
    finally{sheetBusy=false;refreshAvailability();}
  });
  download.addEventListener('click',async()=>{
    if(!ready)return;const ticket=epoch,version=editSerial;
    const blob=await new Promise(r=>after.toBlob(r,'image/png'));
    if(!blob||!ready||ticket!==epoch||version!==editSerial)return;
    saveBlob(blob,`mtqc-figure-page-${Number(pageField.input.value)+1}-draft.png`);
  });
  pdf.addEventListener('click',async()=>{
    if(pdf.disabled||!allReady())return;const ticket=epoch,version=editSerial;pdfBusy=true;refreshAvailability();status.textContent='Building figure-label PDF draft locally…';
    try{
      const result=await createPdf({sourceBytes:records[0].pdfBytes||null,pages:records.map(r=>({sourceCanvas:r.canvas,derivedCanvas:r.output,transform:r.pdfTransform,boxes:r.labels.length?figureExportRegions(r.labels,r.canvas):[]}))});
      if(ticket!==epoch||version!==editSerial||!allReady())return;
      saveBlob(new Blob([result.bytes],{type:'application/pdf'}),'mtqc-figure-region-draft.pdf');
      status.textContent=`PDF draft downloaded: ${result.changedPages} of ${result.sourcePages} page(s) have figure-label overlays. Other content is unchanged; inspect the result.`;
    }catch(e){if(ticket===epoch)status.textContent=`PDF export held: ${e.message}`;}
    finally{if(ticket===epoch){pdfBusy=false;refreshAvailability();}}
  });
  docx.addEventListener('click',async()=>{
    if(docx.disabled||!docxSession||!allReady())return;const ticket=epoch,version=editSerial,session=docxSession,job=++docxJob;docxBusy=true;refreshAvailability();status.textContent='Building a separate DOCX with selected figure edits locally…';
    try{
      const result=await createDocx({session,images:records.filter(r=>r.labels.length).map(r=>({handle:r.docxHandle,canvas:r.output}))});
      if(ticket!==epoch||version!==editSerial||session!==docxSession||!allReady())return;
      if(!(result?.bytes instanceof Uint8Array)||!result.bytes.length)throw Error('Missing derived DOCX bytes.');
      saveBlob(new Blob([result.bytes],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),'mtqc-figure-draft.docx');
      status.textContent=`DOCX draft downloaded: ${result.changedImages} of ${result.sourceImages} main-body image(s) changed. Repeated references use the same edited image. ${result.convertedImages?`${result.convertedImages} BMP image(s) saved as PNG. `:''}${result.changedText?`${result.changedText} selected document text target(s) included. `:'Body text retained. '}Native equations, table structure and drawing placement parts are retained; inspect the document and page layout.`;
    }catch(e){if(ticket===epoch)status.textContent=`DOCX export held: ${e.message}`;}
    finally{if(job===docxJob){docxBusy=false;refreshAvailability();}}
  });
  function clear(){epoch++;editSerial++;docxJob++;records=[];active=null;source=null;labels=[];selected=0;ocrBusy=false;sendBusy=false;pdfBusy=false;docxBusy=false;docxSession=null;docx.hidden=true;pdf.hidden=false;introduction.textContent=pageIntroduction;download.textContent='Download derived page PNG';drag=null;invalidate();before.width=1;before.height=1;host.hidden=true;raw.textContent='';pageField.input.replaceChildren();listLabels();}
  function setPages(pages,options={}){clear();if(!Array.isArray(pages)||!pages.length||pages.length>32)return;
    if(pages.some(r=>!r?.canvas||!Number.isInteger(r.width)||!Number.isInteger(r.height)||r.width<1||r.height<1||r.width>32767||r.height>32767||r.width*r.height>MAX_PIXELS||r.canvas.width!==r.width||r.canvas.height!==r.height))return;
    if(options.docx){if(!Array.isArray(options.docx.figures)||options.docx.figures.length!==pages.length||pages.some((r,i)=>r.docxHandle!==options.docx.figures[i].handle||r.width!==options.docx.figures[i].width||r.height!==options.docx.figures[i].height))return;docxSession=options.docx;docx.hidden=false;}
    if(docxSession){pdf.hidden=true;download.textContent='Download edited image PNG';introduction.textContent='Check and translate labels in the selected embedded image, then inspect the preview. Save a separate DOCX with the reviewed image edits. Edited BMP images are saved as PNG. Main-body reference counts are shown; repeated references use the same edited image. Original text, native equations, tables and image placement parts are retained. Other images and body text remain in their source language. This is a draft for review.';}
    pageField.label.firstChild.textContent=docxSession?'Embedded image':'Page';
    const bytes=pages[0].pdfBytes?.slice();
    records=pages.map(r=>({canvas:copyCanvas(r.canvas,doc),pdfBytes:bytes,pdfTransform:r.pdfTransform?.slice(),docxHandle:r.docxHandle,labels:[],selected:0,output:null,rotation:0,profile:'diagram',crop:boxText({x:0,y:0,width:r.width,height:r.height})}));records.forEach((r,i)=>{const o=el('option',docxSession?pages[i].label:`Page ${i+1}`);o.value=String(i);pageField.input.append(o);});host.hidden=false;selectPage();
  }
  clear();return Object.freeze({setPages,clear,refreshAvailability,snapshot:()=>({labels:labels.map(l=>({...l,sourceBox:{...l.sourceBox},targetBox:{...l.targetBox}}))})});
}
