import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createSelectedPageReviewDraft} from '../web_demo_evaluation/structure-selected-page-intake.mjs';
const require=createRequire(new URL('../web_demo_client/package.json',import.meta.url));
const {createCanvas}=require('@napi-rs/canvas');
const hash=b=>createHash('sha256').update(b).digest('hex');
// Authored originals: hidden text lies inside the page but outside its Form BBox.
function source({mode='hidden',nested=false}={}){
  const content=mode==='shape'?'0 0 10 10 re f':`BT /F1 12 Tf ${mode==='hidden'?70:10} 20 Td (${mode==='hidden'?'FORM TEXT':'OK'}) Tj ET`;
  const stream=(dict,text)=>`<< ${dict} /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  const form=text=>stream('/Type /XObject /Subtype /Form /BBox [0 0 40 40] /Resources << /Font << /F1 3 0 R >> >>',text);
  const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [6 0 R 8 0 R] /Count 2 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',form(content),
    nested?stream('/Type /XObject /Subtype /Form /BBox [0 0 150 150] /Resources << /XObject << /Inner 4 0 R >> >>','q /Inner Do Q'):form(content)];
  for(const [page,contents,formDraw] of [[6,7,false],[8,9,true]]){
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << /Font << /F1 3 0 R >> /XObject << /Fm 5 0 R >> >> /Contents ${contents} 0 R >>`);
    objects.push(stream('',`BT /F1 12 Tf 20 260 Td (OUTER TEXT) Tj ET${formDraw?' q 1 0 0 1 60 80 cm /Fm Do Q':''}`));
  }
  let text='%PDF-1.4\n';const offsets=[0];
  for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(text));text+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(text);text+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
  text+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(text));
}
function selection(bytes,page){
  const canvas=createCanvas(200,300);canvas.getContext('2d').fillRect(0,0,2,2);
  const image=new Uint8Array(canvas.toBuffer('image/png'));
  return {identity:{caseId:`authored-form-${page}`,physicalPage:page,sourceSha256:hash(bytes),pageImageSha256:hash(image)},canonicalImageBytes:image,frame:{viewBox:[0,0,200,300],rotation:0,scale:1,transform:[1,0,0,-1,0,300],width:200,height:300}};
}
const request=(options,pages=[2])=>{const sourceBytes=source(options);return {sourceBytes,selections:pages.map(p=>selection(sourceBytes,p))};};
function refusal(result){assert.equal(result.status,'ABSTAIN');assert.deepEqual(result,{status:'ABSTAIN',reason:'FORM_NATIVE_VISIBILITY_UNASSESSED'});}

test('page-bound text outside an inherited Form clip produces no draft or silently filtered text',async()=>{
  refusal(await createSelectedPageReviewDraft(request({mode:'hidden'})));
});
test('Form-native text remains unassessed even when its page box fits the Form declaration',async()=>{
  refusal(await createSelectedPageReviewDraft(request({mode:'visible'})));
});
test('nested Form text on the last selection rejects the whole two-page request',async()=>{
  refusal(await createSelectedPageReviewDraft(request({mode:'hidden',nested:true},[1,2])));
});
test('shape-only Forms painting after outer text remain unassessed for overpainting',async()=>{
  const value=request({mode:'shape'},[1,2]);const result=await createSelectedPageReviewDraft(value);
  assert.equal(result.status,'ABSTAIN');
  assert.deepEqual(result,{status:'ABSTAIN',reason:'LATE_PAINT_NATIVE_VISIBILITY_UNASSESSED'});
});
