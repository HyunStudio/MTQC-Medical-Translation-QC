// Figure-label draft export. Original searchable text remains under opaque
// patches; this is a visual translation draft, never a redaction mechanism.
const finite = v => typeof v === 'number' && Number.isFinite(v);
function boxValid(b, c) {
  return b && ['x','y','width','height'].every(k=>finite(b[k])) &&
    b.x>=0 && b.y>=0 && b.width>=1 && b.height>=1 &&
    b.x+b.width<=c.width && b.y+b.height<=c.height;
}
export function figurePatchPlacement(box, transform) {
  if(!box || !['x','y','width','height'].every(k=>finite(box[k])) || box.width<=0 || box.height<=0 ||
    !Array.isArray(transform) || transform.length!==6 || !transform.every(finite))
    throw Error('Missing or invalid PDF source transform geometry.');
  const [a,b,c,d,e,f]=transform,det=a*d-b*c;
  if(Math.abs(det)<1e-9)throw Error('Singular PDF transform geometry.');
  const A=d/det,B=-b/det,C=-c/det,D=a/det;
  const u={x:A*box.width,y:B*box.width},v={x:-C*box.height,y:-D*box.height};
  const width=Math.hypot(u.x,u.y),height=Math.hypot(v.x,v.y);
  if(!finite(width)||!finite(height)||width<=0||height<=0 ||
    Math.abs(u.x*v.x+u.y*v.y)>1e-7*width*height || u.x*v.y-u.y*v.x<=0)
    throw Error('Unsupported skew or reflected PDF transform geometry.');
  const px=box.x-e,py=box.y+box.height-f;
  return {x:A*px+C*py,y:B*px+D*py,width,height,rotation:Math.atan2(u.y,u.x)*180/Math.PI};
}
const png = canvas => new Promise((resolve,reject)=>canvas.toBlob(async blob=>{
  try { if(!blob)throw Error('Could not encode figure patch.');resolve(new Uint8Array(await blob.arrayBuffer())); }
  catch(e){reject(e);}
},'image/png'));
export async function exportFigurePdf({sourceBytes=null,pages}) {
  if(!Array.isArray(pages)||!pages.length||pages.length>32)throw Error('Missing source pages.');
  let patchWork=0;
  for(const p of pages) {
    const c=p?.sourceCanvas;
    if(!c || !Number.isInteger(c.width)||!Number.isInteger(c.height)||c.width<1||c.height<1||c.width*c.height>12_000_000 ||
      !Array.isArray(p.boxes)||p.boxes.length>400 || (p.boxes.length &&
      (!p.derivedCanvas||p.derivedCanvas.width!==c.width||p.derivedCanvas.height!==c.height||p.boxes.some(b=>!boxValid(b,c)))))
      throw Error('Invalid source or derived page geometry.');
    let work=0;
    for(const b of p.boxes)work+=(Math.ceil(b.x+b.width)-Math.floor(b.x))*(Math.ceil(b.y+b.height)-Math.floor(b.y));
    patchWork+=work;
    if(work>2*c.width*c.height||patchWork>24_000_000)throw Error('Figure patch export work limit exceeded. Use smaller label regions.');
    if(sourceBytes!==null && p.boxes.length)figurePatchPlacement(p.boxes[0],p.transform);
  }
  const {PDFDocument,PDFName,PDFDict,degrees}=await import('/vendor/pdf-lib/pdf-lib.esm.min.mjs');
  if(sourceBytes!==null && (!(sourceBytes instanceof Uint8Array)||!sourceBytes.length||sourceBytes.length>10*1024*1024))
    throw Error('Invalid original PDF bytes.');
  const pdf=sourceBytes===null?await PDFDocument.create():await PDFDocument.load(sourceBytes.slice(),{updateMetadata:false});
  if(pdf.isEncrypted)throw Error('Encrypted PDF export is unsupported.');
  for(const [,object] of pdf.context.enumerateIndirectObjects()) {
    if(object instanceof PDFDict && (object.has(PDFName.of('ByteRange'))||object.get(PDFName.of('FT'))===PDFName.of('Sig')||object.get(PDFName.of('Type'))===PDFName.of('Sig')))
      throw Error('Signed PDF export is unsupported. Export an unsigned review copy first.');
  }
  if(sourceBytes!==null&&pdf.getPageCount()!==pages.length)throw Error('Original PDF page ownership mismatch.');
  let changedPages=0;
  for(const [index,p] of pages.entries()) {
    const c=p.sourceCanvas;
    const page=sourceBytes===null?pdf.addPage([c.width*.75,c.height*.75]):pdf.getPage(index);
    const transform=sourceBytes===null?[4/3,0,0,-4/3,0,c.height]:p.transform;
    if(sourceBytes===null)page.drawImage(await pdf.embedPng(await png(c)),{x:0,y:0,width:c.width*.75,height:c.height*.75});
    if(!p.boxes.length)continue;
    if(sourceBytes!==null && page.node.Annots()?.size())throw Error('Annotations on an edited PDF page are unsupported. Use an annotation-free review copy or the PNG export.');
    changedPages++;
    // Embed only the dirty mask/target rectangles from the final preview.
    // Floor/ceil explicitly defines the affected source-pixel envelope.
    for(const b of p.boxes) {
      const x=Math.floor(b.x),y=Math.floor(b.y),width=Math.ceil(b.x+b.width)-x,height=Math.ceil(b.y+b.height)-y;
      const patch=c.ownerDocument.createElement('canvas');patch.width=width;patch.height=height;
      patch.getContext('2d').drawImage(p.derivedCanvas,x,y,width,height,0,0,width,height);
      const placement=figurePatchPlacement({x,y,width,height},transform);
      page.drawImage(await pdf.embedPng(await png(patch)),{...placement,rotate:degrees(placement.rotation)});
    }
  }
  if(!changedPages)throw Error('No reviewed figure-label previews to export.');
  return {bytes:await pdf.save({updateFieldAppearances:false}),changedPages,sourcePages:pages.length};
}
