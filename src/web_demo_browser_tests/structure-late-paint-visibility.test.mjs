import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSelectedPageReviewDraft} from '../web_demo_evaluation/structure-selected-page-intake.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
// Authored PDF1.7 originals: each selected page has its own renderer PNG.
// Later shapes remain unassessed even when disjoint, transparent or nonwhite.
function original({setup='',prefix='',suffix=''}={}){
  const stream=(s,extra='')=>`<< ${extra} /Length ${Buffer.byteLength(s)} >>\nstream\n${s}\nendstream`;
  const resources='/Resources << /Font << /F1 3 0 R >> /Pattern << /Tile 8 0 R >> /XObject << /Shape 9 0 R >> /ExtGState << /Transparent 10 0 R >> >>';
  const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] ${resources} /Contents 5 0 R >>`,stream('BT /F1 12 Tf 20 260 Td (OUTER) Tj ET'),
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] ${resources} /Contents 7 0 R >>`,stream(`${prefix} BT /F1 12 Tf ${setup} 20 100 Td (PAINT) Tj ET ${suffix}`),
    stream('1 g 0 0 10 10 re f','/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 10 10] /XStep 10 /YStep 10 /Resources << >>'),
    stream('1 g 20 20 10 10 re f','/Type /XObject /Subtype /Form /BBox [0 0 200 300] /Resources << >>'), '<< /Type /ExtGState /ca 0 >>'];
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
      selections.push({identity:{caseId:`authored-late-paint-${physicalPage}`,physicalPage,sourceSha256:hash(sourceBytes),pageImageSha256:hash(png)},canonicalImageBytes:png,
        frame:{viewBox:[0,0,200,300],rotation:0,scale:1,transform:[1,0,0,-1,0,300],width:200,height:300}});
    }
  }finally{await task.destroy();}
  return {sourceBytes,selections};
}
async function refusal(options){
  const result=await createSelectedPageReviewDraft(await request(options));
  assert.equal(result.status,'ABSTAIN');
  assert.deepEqual(result,{status:'ABSTAIN',reason:'LATE_PAINT_NATIVE_VISIBILITY_UNASSESSED'});
}
test('opaque white painting after text survives q/Q and refuses the entire late selection',async()=>{
  await refusal({suffix:'q 1 g 10 80 130 50 re f Q'});
});
for(const paint of ['f','f*','S','s','B','B*','b','b*'])test(`late path painting ${paint} is unassessed regardless of color`,async()=>{
  await refusal({suffix:`q 0 g 0 G 10 80 130 50 re ${paint} Q`});
});
for(const [name,suffix] of [
  ['disjoint white shape','q 1 g 20 20 10 10 re f Q'],
  ['transparent overlapping shape','q /Transparent gs 0 g 10 80 130 50 re f Q'],
  ['textless Form painting','q /Shape Do Q'],
  ['white cover followed by another visible text','q 1 g 10 80 130 50 re f Q BT /F1 12 Tf 20 170 Td (TAIL) Tj ET'],
])test(`${name} cannot certify earlier native text visibility`,async()=>{await refusal({suffix});});
for(const [name,options] of [
  ['no later paint',{}],
  ['white shape before text',{prefix:'q 1 g 10 80 130 50 re f Q'}],
  ['textless Form painting before text',{prefix:'q /Shape Do Q'}],
  ['later color and saved state without painting',{suffix:'q 1 g Q'}],
  ['discarded later path',{suffix:'10 80 130 50 re n'}],
])test(`${name} retains an ordinary unverified draft`,async()=>{
  const input=await request(options),result=await createSelectedPageReviewDraft(input);
  assert.equal(result.status,'DRAFT');assert.equal(hash(result.sourceBytes),hash(input.sourceBytes));
  assert.deepEqual(result.pages.map(p=>p.record.fragments.map(f=>f.text)),[['OUTER'],['PAINT']]);
  assert.ok(result.pages.every(p=>p.sourceRenderEquivalence==='unverified'&&p.canonicalFragmentCrosswalk==='unavailable'));
});
