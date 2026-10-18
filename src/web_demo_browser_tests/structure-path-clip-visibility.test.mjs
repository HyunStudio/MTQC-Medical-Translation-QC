import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createSelectedPageReviewDraft} from '../web_demo_evaluation/structure-selected-page-intake.mjs';
const require=createRequire(new URL('../web_demo_client/package.json',import.meta.url));
const {createCanvas}=require('@napi-rs/canvas');
const hash=b=>createHash('sha256').update(b).digest('hex');
// Authored full originals; clip paths are independent of page bounds and Forms.
function source({visible=false,nested=false,evenOdd=false,restored=false}={}){
  const stream=s=>`<< /Length ${Buffer.byteLength(s)} >>\nstream\n${s}\nendstream`;
  const outer='BT /F1 12 Tf 20 260 Td (OUTER TEXT) Tj ET';
  const text=`BT /F1 12 Tf ${visible?70:130} 100 Td (${visible?'OK':'CLIPPED'}) Tj ET`;
  const clipped=`q 60 80 40 40 re ${evenOdd?'W*':'W'} n ${nested?'q ':''}${restored?'1 g 0 0 10 10 re f':text}${nested?' Q':''} Q`;
  const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for(const [contents,body] of [[5,outer],[7,clipped+(restored?' '+outer:'')]]){
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contents} 0 R >>`);
    objects.push(stream(body));
  }
  let pdf='%PDF-1.4\n';const offsets=[0];
  for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
  pdf+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf));
}
function request(options,pages=[2]){
  const sourceBytes=source(options),canvas=createCanvas(200,300);
  canvas.getContext('2d').fillRect(0,0,2,2);
  const png=new Uint8Array(canvas.toBuffer('image/png'));
  return {sourceBytes,selections:pages.map(page=>({identity:{caseId:`authored-path-clip-${page}`,physicalPage:page,sourceSha256:hash(sourceBytes),pageImageSha256:hash(png)},canonicalImageBytes:png,frame:{viewBox:[0,0,200,300],rotation:0,scale:1,transform:[1,0,0,-1,0,300],width:200,height:300}}))};
}
function refusal(result){assert.equal(result.status,'ABSTAIN');assert.deepEqual(result,{status:'ABSTAIN',reason:'PATH_CLIP_NATIVE_VISIBILITY_UNASSESSED'});}
test('ordinary clip hides page-bound text without exposing a native draft or silently filtering it',async()=>{
  refusal(await createSelectedPageReviewDraft(request({})));
});
test('text geometrically inside a declared path clip remains conservatively unassessed',async()=>{
  refusal(await createSelectedPageReviewDraft(request({visible:true})));
});
test('inherited even-odd clipping on the late selection refuses the whole two-page request',async()=>{
  refusal(await createSelectedPageReviewDraft(request({nested:true,evenOdd:true},[1,2])));
});
test('restoring nested shape-only clipping preserves later outer text without visibility certification',async()=>{
  const value=request({nested:true,evenOdd:true,restored:true},[1,2]);
  const result=await createSelectedPageReviewDraft(value);
  assert.equal(result.status,'DRAFT');assert.equal(hash(result.sourceBytes),hash(value.sourceBytes));
  assert.deepEqual(result.pages.map(p=>p.record.fragments.map(f=>f.text)),[['OUTER TEXT'],['OUTER TEXT']]);
  assert.ok(result.pages.every(p=>p.sourceRenderEquivalence==='unverified'&&p.canonicalFragmentCrosswalk==='unavailable'));
});
