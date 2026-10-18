import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {imageMaskControlPdf,vectorCaptionControlPdf} from './authored-pdf-controls.mjs';
const require=createRequire(new URL('../web_demo_client/package.json',import.meta.url));
const {createCanvas}=require('@napi-rs/canvas');
const hash=b=>createHash('sha256').update(b).digest('hex');
export function authoredHostRequest(control='vector-caption'){
  if(!['vector-caption','original-mask'].includes(control))throw Error('Unknown authored control');
  const sourceBytes=control==='original-mask'?imageMaskControlPdf():vectorCaptionControlPdf(),canonicalImageBytes=new Uint8Array(createCanvas(300,300).toBuffer('image/png'));
  return {sourceBytes,selections:[{identity:{caseId:control==='original-mask'?'authored-mask':'authored-vector-caption',physicalPage:1,sourceSha256:hash(sourceBytes),pageImageSha256:hash(canonicalImageBytes)},canonicalImageBytes,
    frame:{viewBox:[0,0,300,300],rotation:0,scale:1,transform:[1,0,0,-1,0,300],width:300,height:300}}]};
}
export function authoredSecondPageRequest(){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>'];
  for(let n=1;n<=2;n++){
    const content=`BT /F1 12 Tf 30 200 Td (PAGE ${n}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 7 0 R >> >> /Contents ${n*2+2} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let text='%PDF-1.4\n';const offsets=[];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const xref=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const result=authoredHostRequest();result.sourceBytes=new Uint8Array(Buffer.from(text));result.selections[0].identity={...result.selections[0].identity,caseId:'authored-page2',physicalPage:2,sourceSha256:hash(result.sourceBytes)};
  return result;
}
