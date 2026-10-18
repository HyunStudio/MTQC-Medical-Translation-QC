import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSelectedPageReviewDraft} from '../web_demo_evaluation/structure-selected-page-intake.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
// Authored PDF1.7 originals: each selected page has its own renderer PNG.
// White on dark is held as unassessed too; these are not canonical truth.
function original({setup='',prefix=''}={}){
  const stream=(s,extra='')=>`<< ${extra} /Length ${Buffer.byteLength(s)} >>\nstream\n${s}\nendstream`;
  const resources='/Resources << /Font << /F1 3 0 R >> /Pattern << /Tile 8 0 R >> /XObject << /Shape 9 0 R >> >>';
  const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] ${resources} /Contents 5 0 R >>`,stream('BT /F1 12 Tf 20 260 Td (OUTER) Tj ET'),
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] ${resources} /Contents 7 0 R >>`,stream(`${prefix} BT /F1 12 Tf ${setup} 20 100 Td (PAINT) Tj ET`),
    stream('1 g 0 0 10 10 re f','/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 10 10] /XStep 10 /YStep 10 /Resources << >>'),
    stream('1 g 20 20 10 10 re f','/Type /XObject /Subtype /Form /BBox [0 0 200 300] /Resources << >>')];
  let pdf='%PDF-1.7\n';const offsets=[0];
  for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
  return new Uint8Array(Buffer.from(pdf+`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
}
async function request(options){
  const sourceBytes=original(options),selections=[];
  const pdfjs=await import('../web_demo_client/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const task=pdfjs.getDocument({data:new Uint8Array(sourceBytes),useSystemFonts:true,isEvalSupported:false,stopAtErrors:true});
  try{const pdf=await task.promise;
    for(const physicalPage of [1,2]){
      const page=await pdf.getPage(physicalPage),viewport=page.getViewport({scale:1}),canvas=pdf.canvasFactory.create(200,300);let png;
      try{await page.render({canvasContext:canvas.context,viewport}).promise;png=new Uint8Array(canvas.canvas.toBuffer('image/png'));}
      finally{pdf.canvasFactory.destroy(canvas);}
      selections.push({identity:{caseId:`authored-fill-${physicalPage}`,physicalPage,sourceSha256:hash(sourceBytes),pageImageSha256:hash(png)},canonicalImageBytes:png,
        frame:{viewBox:[0,0,200,300],rotation:0,scale:1,transform:[1,0,0,-1,0,300],width:200,height:300}});
    }
  }finally{await task.destroy();}
  return {sourceBytes,selections};
}
async function refusal(options,reason='WHITE_FILL_NATIVE_VISIBILITY_UNASSESSED'){
  const result=await createSelectedPageReviewDraft(await request(options));
  assert.equal(result.status,'ABSTAIN');assert.deepEqual(result,{status:'ABSTAIN',reason});
}
for(const [name,options] of [
  ['gray white',{setup:'1 g'}],['RGB white',{setup:'1 1 1 rg'}],['CMYK white',{setup:'0 0 0 0 k'}],
  ['white on a dark backdrop',{prefix:'0 g 0 0 200 300 re f',setup:'1 g'}],
  ['font reselection does not reset inherited white fill',{prefix:'1 g'}],
])test(`${name} on the late page refuses the entire selection as unassessed`,async()=>{await refusal(options);});
test('a pattern fill replaces direct RGB state and remains unassessed at text',async()=>{
  await refusal({setup:'1 g /Pattern cs /Tile scn'},'FILL_COLOR_NATIVE_VISIBILITY_UNASSESSED');
});
test('emitted transparent fill cannot keep a stale direct black color at text',async()=>{
  await refusal({setup:'/NotAColor scn'},'FILL_COLOR_NATIVE_VISIBILITY_UNASSESSED');
});
for(const [name,options] of [
  ['explicit gray black reset',{prefix:'1 g',setup:'0 g'}],
  ['explicit RGB black reset',{prefix:'1 1 1 rg',setup:'0 0 0 rg'}],
  ['nested q/Q restoration',{prefix:'q 1 g q 20 20 10 10 re f Q Q'}],
  ['textless Form white fill restoration',{prefix:'/Shape Do'}],
  ['direct black reset after a pattern',{prefix:'/Pattern cs /Tile scn',setup:'0 g'}],
  ['direct black reset after emitted transparency',{prefix:'/NotAColor scn',setup:'0 g'}],
])test(`${name} retains an ordinary unverified draft`,async()=>{
  const input=await request(options),result=await createSelectedPageReviewDraft(input);
  assert.equal(result.status,'DRAFT');assert.equal(hash(result.sourceBytes),hash(input.sourceBytes));
  assert.deepEqual(result.pages.map(p=>p.record.fragments.map(f=>f.text)),[['OUTER'],['PAINT']]);
  assert.ok(result.pages.every(p=>p.sourceRenderEquivalence==='unverified'&&p.canonicalFragmentCrosswalk==='unavailable'));
});
test('ordinary clip reason retains priority over white fill uncertainty',async()=>{
  await refusal({prefix:'0 0 200 300 re W n',setup:'1 g'},'PATH_CLIP_NATIVE_VISIBILITY_UNASSESSED');
});
