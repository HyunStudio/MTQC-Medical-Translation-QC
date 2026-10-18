import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSelectedPageReviewDraft} from '../web_demo_evaluation/structure-selected-page-intake.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
// Authored PDF1.7 originals: each selected page has its own renderer PNG.
// Prior matching solid RGB fills remain conservatively unassessed at text.
function original({setup='',prefix='',suffix='',shape='1 g 20 20 10 10 re f'}={}){
  const stream=(s,extra='')=>`<< ${extra} /Length ${Buffer.byteLength(s)} >>\nstream\n${s}\nendstream`;
  const resources='/Resources << /Font << /F1 3 0 R >> /Pattern << /Tile 8 0 R >> /XObject << /Shape 9 0 R >> /ExtGState << /Transparent 10 0 R >> >>';
  const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] ${resources} /Contents 5 0 R >>`,stream('BT /F1 12 Tf 20 260 Td (OUTER) Tj ET'),
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] ${resources} /Contents 7 0 R >>`,stream(`${prefix} BT /F1 12 Tf ${setup} 20 100 Td (PAINT) Tj ET ${suffix}`),
    stream('1 g 0 0 10 10 re f','/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 10 10] /XStep 10 /YStep 10 /Resources << >>'),
    stream(shape,'/Type /XObject /Subtype /Form /BBox [0 0 200 300] /Resources << >>'), '<< /Type /ExtGState /CA 0 >>'];
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
      selections.push({identity:{caseId:`authored-stroke-${physicalPage}`,physicalPage,sourceSha256:hash(sourceBytes),pageImageSha256:hash(png)},canonicalImageBytes:png,
        frame:{viewBox:[0,0,200,300],rotation:0,scale:1,transform:[1,0,0,-1,0,300],width:200,height:300}});
    }
  }finally{await task.destroy();}
  return {sourceBytes,selections};
}
async function refusal(options,reason='BACKGROUND_NATIVE_VISIBILITY_UNASSESSED'){
  assert.deepEqual(await createSelectedPageReviewDraft(await request(options)),{status:'ABSTAIN',reason});
}
for(const paint of ['S','s','B','B*','b','b*'])test(`preceding white-fill black-stroke ${paint} leaves matching native ink unassessed`,async()=>{
  await refusal({prefix:`q 1 g 0 G 50 w 10 105 m 140 105 l ${paint} Q`});
});
for(const [name,options] of [
  ['matching blue stroke',{prefix:'q 0 0 1 RG 50 w 10 105 m 140 105 l S Q',setup:'0 0 1 rg'}],
  ['default black stroke',{prefix:'q 50 w 10 105 m 140 105 l S Q'}],
  ['q/Q restores stroke state without erasing black ink',{prefix:'q 0 G q 50 w 10 105 m 140 105 l S Q 1 G Q'}],
  ['textless Form stroke history',{prefix:'q /Shape Do Q',shape:'0 G 50 w 10 105 m 140 105 l S'}],
  ['exact previous disjoint black stroke positive retained as negative',{prefix:'q 0 G 20 20 10 10 re S Q'}],
  ['transparent stroke requires a conservative hold',{prefix:'q /Transparent gs 0 G 50 w 10 105 m 140 105 l S Q'}],
])test(`${name} holds the whole selection`,async()=>{await refusal(options);});
for(const [name,options] of [
  ['no prior stroke',{}],
  ['stroke color declaration alone',{prefix:'q 0 G 0 0 1 RG Q'}],
  ['discarded prior black path',{prefix:'q 0 G 10 105 m 140 105 l n Q'}],
  ['prior white stroke before black text',{prefix:'q 1 G 50 w 10 105 m 140 105 l S Q'}],
  ['prior blue stroke before black text',{prefix:'q 0 0 1 RG 50 w 10 105 m 140 105 l S Q'}],
  ['textless white stroke Form before black text',{prefix:'q /Shape Do Q',shape:'1 G 50 w 10 105 m 140 105 l S'}],
])test(`${name} retains an explicitly unverified draft`,async()=>{
  const input=await request(options),result=await createSelectedPageReviewDraft(input);
  assert.equal(result.status,'DRAFT');assert.equal(hash(result.sourceBytes),hash(input.sourceBytes));
  assert.deepEqual(result.pages.map(p=>p.record.fragments.map(f=>f.text)),[['OUTER'],['PAINT']]);
  assert.ok(result.pages.every(p=>p.sourceRenderEquivalence==='unverified'&&p.canonicalFragmentCrosswalk==='unavailable'));
});
test('path clip remains prior to matching stroke uncertainty',async()=>{
  await refusal({prefix:'q 0 G 50 w 10 105 m 140 105 l S Q 0 0 200 300 re W n'},'PATH_CLIP_NATIVE_VISIBILITY_UNASSESSED');
});
