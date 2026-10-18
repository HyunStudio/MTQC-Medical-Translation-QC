import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSelectedPageReviewDraft} from '../web_demo_evaluation/structure-selected-page-intake.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
// Authored whole PDF1.7 originals. Each selected PNG comes from its own page.
// Same-renderer PNGs still confer no independent source/canonical/human authority.
function original({setup='',gs='',prefix='',oc=false,ocOn=false}={}){
  const stream=(s,extra='')=>`<< ${extra} /Length ${Buffer.byteLength(s)} >>\nstream\n${s}\nendstream`;
  const outer='BT /F1 12 Tf 20 260 Td (OUTER) Tj ET';
  let paint=`${prefix} BT /F1 12 Tf ${setup} 20 100 Td (PAINT) Tj ET`;
  if(oc)paint='/OC /Hidden BDC /Artifact BMC '+paint+' EMC EMC';
  const objects=[null,`<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [10 0 R] /D << /BaseState /ON ${ocOn?'':'/OFF [10 0 R]'} >> >> >>`,
    '<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',stream(outer),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << /Font << /F1 3 0 R >> /ExtGState << /Paint 8 0 R /Reset 9 0 R >> /Properties << /Hidden 10 0 R >> >> /Contents 7 0 R >>',stream(paint),
    `<< /Type /ExtGState ${gs} >>`,'<< /Type /ExtGState /ca 1 /CA 1 /BM /Normal /SMask /None /TR /Identity >>',
    '<< /Type /OCG /Name (Authored visibility layer) >>',
    stream('0 g 0 0 200 300 re f','/Type /XObject /Subtype /Form /BBox [0 0 200 300] /Group << /S /Transparency /CS /DeviceGray >> /Resources << >>')];
  let pdf='%PDF-1.7\n';const offsets=[0];
  for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
  return new Uint8Array(Buffer.from(pdf+`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
}
async function request(options,pages=[1,2]){
  const sourceBytes=original(options);
  const pdfjs=await import('../web_demo_client/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const task=pdfjs.getDocument({data:new Uint8Array(sourceBytes),useSystemFonts:true,isEvalSupported:false,stopAtErrors:true});
  const selections=[];
  try{
    const pdf=await task.promise;
    for(const physicalPage of pages){
      const page=await pdf.getPage(physicalPage),viewport=page.getViewport({scale:1});
      const canvas=pdf.canvasFactory.create(200,300);let png;
      try{await page.render({canvasContext:canvas.context,viewport}).promise;png=new Uint8Array(canvas.canvas.toBuffer('image/png'));}
      finally{pdf.canvasFactory.destroy(canvas);}
      selections.push({identity:{caseId:`authored-paint-${physicalPage}`,physicalPage,sourceSha256:hash(sourceBytes),pageImageSha256:hash(png)},canonicalImageBytes:png,
        frame:{viewBox:[0,0,200,300],rotation:0,scale:1,transform:[1,0,0,-1,0,300],width:200,height:300}});
    }
  }finally{await task.destroy();}
  return {sourceBytes,selections};
}
function refusal(result,reason='TEXT_PAINT_NATIVE_VISIBILITY_UNASSESSED'){
  assert.equal(result.status,'ABSTAIN');assert.deepEqual(result,{status:'ABSTAIN',reason});
}
// Ignoring effective Tr or ExtGState at the late text draw would expose a draft.
for(const mode of [1,2,3,4,5,6,7])test(`nondefault text mode ${mode} on a late page refuses the whole selection`,async()=>{
  refusal(await createSelectedPageReviewDraft(await request({setup:`${mode} Tr`})));
});
for(const alpha of [0,0.5])test(`nondefault fill alpha ${alpha} retains a whole-request unassessed hold`,async()=>{
  refusal(await createSelectedPageReviewDraft(await request({setup:'/Paint gs',gs:`/ca ${alpha}`})));
});
test('nondefault stroke alpha is conservatively held even with default fill text',async()=>{
  refusal(await createSelectedPageReviewDraft(await request({setup:'/Paint gs',gs:'/CA 0'})));
});
test('nondefault blending before text is unassessed rather than certified visible',async()=>{
  refusal(await createSelectedPageReviewDraft(await request({setup:'/Paint gs',gs:'/BM /Multiply'})));
});
test('a text transfer function cannot leak an unverified native graph',async()=>{
  refusal(await createSelectedPageReviewDraft(await request({setup:'/Paint gs',gs:'/TR << /FunctionType 2 /Domain [0 1] /C0 [1] /C1 [0] /N 1 >>'})));
});
test('a black luminosity mask suppressing text retains whole refusal',async()=>{
  refusal(await createSelectedPageReviewDraft(await request({setup:'/Paint gs',gs:'/SMask << /S /Luminosity /G 11 0 R >>'})));
});
for(const ocOn of [false,true])test(`optional-content text nested inside an Artifact remains unassessed (ON=${ocOn})`,async()=>{
  refusal(await createSelectedPageReviewDraft(await request({oc:true,ocOn})),'OPTIONAL_CONTENT_NATIVE_VISIBILITY_UNASSESSED');
});
// Rejecting any earlier declaration, instead of its state at text draw, breaks these.
for(const [name,options] of [
  ['explicit defaults',{setup:'0 Tr /Reset gs'}],
  ['nested q/Q restoration',{gs:'/ca 0',prefix:'q /Paint gs 3 Tr q 1 g 20 20 10 10 re f Q Q'}],
  ['explicit reset before text',{gs:'/ca 0',prefix:'3 Tr /Paint gs',setup:'0 Tr /Reset gs'}],
  ['ended optional shape scope',{prefix:'/OC /Hidden BDC /Artifact BMC q 1 g 20 20 10 10 re f Q EMC EMC'}],
])test(`${name} preserves later default text and unverified draft metadata`,async()=>{
  const input=await request(options),result=await createSelectedPageReviewDraft(input);
  assert.equal(result.status,'DRAFT');assert.equal(hash(result.sourceBytes),hash(input.sourceBytes));
  assert.deepEqual(result.pages.map(p=>p.record.fragments.map(f=>f.text)),[['OUTER'],['PAINT']]);
  assert.ok(result.pages.every(p=>p.sourceRenderEquivalence==='unverified'&&p.canonicalFragmentCrosswalk==='unavailable'));
});
