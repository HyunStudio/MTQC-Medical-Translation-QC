import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSelectedPageReviewDraft} from '../web_demo_evaluation/structure-selected-page-intake.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
// Whole authored PDF1.7 originals; Type3 charprocs may encode text without ink.
// Page PNGs are separate renderer observations, not independent canonical truth.
function original({body='BT /F2 12 Tf 20 100 Td (PAINT) Tj ET',painted=false}={}){
  const stream=s=>`<< /Length ${Buffer.byteLength(s)} >>\nstream\n${s}\nendstream`;
  const font='<< /Type /Font /Subtype /Type3 /FontBBox [0 0 500 700] /FontMatrix [0.001 0 0 0.001 0 0] /FirstChar 32 /LastChar 84 /Widths ['+Array(53).fill(500).join(' ')+'] /Encoding << /Type /Encoding /Differences [65 /A 73 /I 78 /N 80 /P 84 /T] >> /CharProcs << /P 9 0 R /A 9 0 R /I 9 0 R /N 9 0 R /T 9 0 R >> /Resources << >> >>';
  const resources='/Resources << /Font << /F1 3 0 R /F2 8 0 R >> /ExtGState << /Type3 10 0 R >> >>';
  const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] ${resources} /Contents 5 0 R >>`,stream('BT /F1 12 Tf 20 260 Td (OUTER) Tj ET'),
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] ${resources} /Contents 7 0 R >>`,stream(body),font,
    stream(painted?'500 0 d0 0 g 0 0 500 700 re f':'500 0 d0'),'<< /Type /ExtGState /Font [8 0 R 12] >>'];
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
      selections.push({identity:{caseId:`authored-type3-${physicalPage}`,physicalPage,sourceSha256:hash(sourceBytes),pageImageSha256:hash(png)},canonicalImageBytes:png,
        frame:{viewBox:[0,0,200,300],rotation:0,scale:1,transform:[1,0,0,-1,0,300],width:200,height:300}});
    }
  }finally{await task.destroy();}
  return {sourceBytes,selections};
}
for(const painted of [false,true])test(`Type3 charproc text on the late selected page stays unassessed (painted=${painted})`,async()=>{
  assert.deepEqual(await createSelectedPageReviewDraft(await request({painted})),{status:'ABSTAIN',reason:'TYPE3_NATIVE_VISIBILITY_UNASSESSED'});
});
test('ExtGState Font can select a Type3 font before a text draw',async()=>{
  assert.deepEqual(await createSelectedPageReviewDraft(await request({body:'BT /Type3 gs 20 100 Td (PAINT) Tj ET'})),{status:'ABSTAIN',reason:'TYPE3_NATIVE_VISIBILITY_UNASSESSED'});
});
const defaultText='BT /F1 12 Tf 20 100 Td (PAINT) Tj ET';
for(const [name,body] of [
  ['uninvoked Type3 resources',defaultText],
  ['textless Type3 declaration followed by explicit ordinary selection','BT /F2 12 Tf ET '+defaultText],
  ['ordinary font restored across nested q/Q','/F1 12 Tf q /F2 12 Tf q 1 g 20 20 10 10 re f Q Q BT 20 100 Td (PAINT) Tj ET'],
  ['ExtGState Type3 restored before later ordinary text','/F1 12 Tf q /Type3 gs Q BT 20 100 Td (PAINT) Tj ET'],
])test(`${name} retains an explicitly unverified ordinary-font draft`,async()=>{
  const input=await request({body}),result=await createSelectedPageReviewDraft(input);
  assert.equal(result.status,'DRAFT');assert.equal(hash(result.sourceBytes),hash(input.sourceBytes));
  assert.deepEqual(result.pages.map(p=>p.record.fragments.map(f=>f.text)),[['OUTER'],['PAINT']]);
  assert.ok(result.pages.every(p=>p.sourceRenderEquivalence==='unverified'&&p.canonicalFragmentCrosswalk==='unavailable'));
});
test('ordinary path clip reason remains prior to Type3 uncertainty',async()=>{
  assert.deepEqual(await createSelectedPageReviewDraft(await request({body:'0 0 200 300 re W n BT /F2 12 Tf 20 100 Td (PAINT) Tj ET'})),{status:'ABSTAIN',reason:'PATH_CLIP_NATIVE_VISIBILITY_UNASSESSED'});
});

test('original nested Type3 restoration with earlier black fill remains unassessed',async()=>{
  assert.deepEqual(await createSelectedPageReviewDraft(await request({body:'/F1 12 Tf q /F2 12 Tf q 20 20 10 10 re f Q Q BT 20 100 Td (PAINT) Tj ET'})),{status:'ABSTAIN',reason:'BACKGROUND_NATIVE_VISIBILITY_UNASSESSED'});
});
