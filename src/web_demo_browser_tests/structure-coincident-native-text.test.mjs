import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSelectedPageReviewDraft} from '../web_demo_evaluation/structure-selected-page-intake.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const black='BT /F1 12 Tf 0 g 20 100 Td (PAINT) Tj ET';
const blue='BT /F1 12 Tf 0 0 1 rg 20 100 Td (PAINT) Tj ET';
function original(fixture){
 const stream=s=>`<< /Length ${Buffer.byteLength(s)} >>\nstream\n${s}\nendstream`;
 const resources='/Resources << /Font << /F1 3 0 R >> >>';
 const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] ${resources} /Contents 5 0 R >>`,stream(fixture.firstDraw??'BT /F1 12 Tf 20 260 Td (OUTER) Tj ET'),
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] ${resources} /Contents 7 0 R >>`,stream(fixture.draws.join('\n'))];
 let pdf='%PDF-1.7\n';const offsets=[0];
 for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
 return new Uint8Array(Buffer.from(pdf+`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
}
async function request(draws,firstDraw='BT /F1 12 Tf 20 260 Td (OUTER) Tj ET'){
 const sourceBytes=original({draws,firstDraw}),selections=[];
 const pdfjs=await import('../web_demo_client/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
 const task=pdfjs.getDocument({data:new Uint8Array(sourceBytes),useSystemFonts:true,isEvalSupported:false,stopAtErrors:true});
 try{const pdf=await task.promise;
  for(const physicalPage of [1,2]){
   const page=await pdf.getPage(physicalPage),viewport=page.getViewport({scale:1}),canvas=pdf.canvasFactory.create(200,300);let png;
   try{await page.render({canvasContext:canvas.context,viewport}).promise;png=new Uint8Array(canvas.canvas.toBuffer('image/png'));}finally{pdf.canvasFactory.destroy(canvas);}
   selections.push({identity:{caseId:`authored-coincident-${physicalPage}`,physicalPage,sourceSha256:hash(sourceBytes),pageImageSha256:hash(png)},canonicalImageBytes:png,frame:{viewBox:[0,0,200,300],rotation:0,scale:1,transform:[1,0,0,-1,0,300],width:200,height:300}});
  }
 }finally{await task.destroy();}
 return {sourceBytes,selections};
}
async function refusal(draws,reason='COINCIDENT_NATIVE_TEXT_UNASSESSED'){
 const result=await createSelectedPageReviewDraft(await request(draws));
 assert.equal(result.status,'ABSTAIN');assert.deepEqual(result,{status:'ABSTAIN',reason});
}
for(const [name,draws] of [
 ['exact black repetition',[black,black]],
 ['exact triple repetition',[black,black,black]],
 ['exact blue repetition',[blue,blue]],
 ['different overlapping source strings',[black,'BT /F1 12 Tf 0 g 20 100 Td (COVER) Tj ET']],
 ['black then blue source draws',[black,blue]],
 ['blue then black source draws',[blue,black]],
 ['different text sizes at the same start',[black,'BT /F1 18 Tf 0 g 20 100 Td (PAINT) Tj ET']],
 ['different orientation at the same start',[black,'BT /F1 12 Tf 0 g 0 1 -1 0 20 100 Tm (PAINT) Tj ET']],
 ['q restoration between coincident draws',[black,'q '+black+' Q']],
 ['empty draw between coincident draws',[black,'BT /F1 12 Tf 20 100 Td () Tj ET',black]],
])test(`${name} refuses the entire late-page selection`,async()=>{await refusal(draws);});
for(const [name,draws,first] of [
 ['one black draw',[black]],
 ['one blue draw',[blue]],
 ['identical text at separate starts',[black,'BT /F1 12 Tf 0 g 20 80 Td (PAINT) Tj ET']],
 ['different adjacent starts',[black,'BT /F1 12 Tf 0 g 70 100 Td (COVER) Tj ET']],
 ['empty follow-up has no second native item',[black,'BT /F1 12 Tf 0 g 20 100 Td () Tj ET']],
 ['the same start on different physical pages is page-local',[black],black],
])test(`${name} retains a complete unverified draft`,async()=>{
 const input=await request(draws,first),result=await createSelectedPageReviewDraft(input);
 assert.equal(result.status,'DRAFT');assert.equal(hash(result.sourceBytes),hash(input.sourceBytes));
 assert.equal(result.pages.length,2);assert.ok(result.pages.every(p=>p.sourceRenderEquivalence==='unverified'&&p.canonicalFragmentCrosswalk==='unavailable'));
 if(name==='identical text at separate starts')assert.deepEqual(result.pages[1].record.fragments.map(f=>f.text),['PAINT','PAINT']);
});
test('earlier white text paint still refuses before native geometry',async()=>{
 await refusal([black,'BT /F1 12 Tf 1 g 20 100 Td (PAINT) Tj ET'],'WHITE_FILL_NATIVE_VISIBILITY_UNASSESSED');
});
test('late vector paint keeps its earlier operator preflight priority',async()=>{
 await refusal([black,black,'1 g 0 0 200 300 re f'],'LATE_PAINT_NATIVE_VISIBILITY_UNASSESSED');
});
test('coincident late-page native items never render an earlier selection',async()=>{
 const input=await request([black,black]),pdfjs=await import('../web_demo_client/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
 const task=pdfjs.getDocument({data:new Uint8Array(input.sourceBytes),useSystemFonts:true,isEvalSupported:false,stopAtErrors:true});
 let prototype;
 try{prototype=Object.getPrototypeOf(await(await task.promise).getPage(1));}finally{await task.destroy();}
 const native=prototype.getTextContent,render=prototype.render;let nativeCalls=0,renderCalls=0;
 prototype.getTextContent=function(...args){nativeCalls++;return native.apply(this,args);};
 prototype.render=function(...args){renderCalls++;return render.apply(this,args);};
 try{const result=await createSelectedPageReviewDraft(input);assert.equal(renderCalls,0);assert.equal(nativeCalls,2);assert.deepEqual(result,{status:'ABSTAIN',reason:'COINCIDENT_NATIVE_TEXT_UNASSESSED'});}
 finally{prototype.getTextContent=native;prototype.render=render;}
});
