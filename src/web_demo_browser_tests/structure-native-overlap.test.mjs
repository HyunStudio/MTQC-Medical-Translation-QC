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
   selections.push({identity:{caseId:`authored-overlap-${physicalPage}`,physicalPage,sourceSha256:hash(sourceBytes),pageImageSha256:hash(png)},canonicalImageBytes:png,frame:{viewBox:[0,0,200,300],rotation:0,scale:1,transform:[1,0,0,-1,0,300],width:200,height:300}});
  }
 }finally{await task.destroy();}
 return {sourceBytes,selections};
}
// Advance-box controls only; no painted glyph/canonical/source-authority proof.
const offset='BT /F1 12 Tf 0 g 20.25 100 Td (PAINT) Tj ET';
async function refusal(draws,reason='OVERLAPPING_NATIVE_TEXT_UNASSESSED'){
 const result=await createSelectedPageReviewDraft(await request(draws));assert.deepEqual(result,{status:'ABSTAIN',reason});
}
for(const [name,draws] of [
 ['quarter horizontal',[black,offset]],
 ['quarter vertical',[black,'BT /F1 12 Tf 0 g 20 100.25 Td (PAINT) Tj ET']],
 ['different strings',[black,'BT /F1 12 Tf 0 g 20.25 100 Td (COVER) Tj ET']],
 ['larger text',[black,'BT /F1 18 Tf 0 g 20.25 100 Td (PAINT) Tj ET']],
 ['rotated text',[black,'BT /F1 12 Tf 0 g 0 1 -1 0 20.25 100 Tm (PAINT) Tj ET']],
 ['narrow contained text',[black,'BT /F1 12 Tf 0 g 24 100 Td (I) Tj ET']],
 ['wide text',[black,'BT /F1 12 Tf 0 g 20.25 100 Td (WWWWW) Tj ET']],
 ['empty follow-up',[black,offset,'BT /F1 12 Tf 0 g 20.25 100 Td () Tj ET']],
])test(`${name} positive native advance-box overlap holds the entire selection`,async()=>{await refusal(draws);});
function unverified(result){assert.equal(result.status,'DRAFT');assert.equal(result.pages.length,2);assert.ok(result.pages.every(p=>p.sourceRenderEquivalence==='unverified'&&p.canonicalFragmentCrosswalk==='unavailable'));}
for(const [name,draws] of [
 ['horizontal disjoint',[black,'BT /F1 12 Tf 0 g 70 100 Td (PAINT) Tj ET']],
 ['vertical disjoint',[black,'BT /F1 12 Tf 0 g 20 80 Td (PAINT) Tj ET']],
])test(`${name} stays unverified without deleting source text`,async()=>{
 const input=await request(draws),result=await createSelectedPageReviewDraft(input);unverified(result);assert.equal(hash(result.sourceBytes),hash(input.sourceBytes));
 assert.deepEqual(result.pages[1].nativeFragments.map(f=>f.text),['PAINT','PAINT']);
});
test('merged source draws are now held by the bounded operator cursor guard',async()=>{
 await refusal([black,'BT /F1 12 Tf 0 g 53.336 100 Td (PAINT) Tj ET'],'OVERLAPPING_OPERATOR_TEXT_RUN_UNASSESSED');
});

test('equal boxes on different selected pages stay page-local',async()=>{unverified(await createSelectedPageReviewDraft(await request([black],black)));});
async function observe(input,replace=null){
 const pdfjs=await import('../web_demo_client/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
 const task=pdfjs.getDocument({data:new Uint8Array(input.sourceBytes),useSystemFonts:true,isEvalSupported:false,stopAtErrors:true});let proto;
 try{proto=Object.getPrototypeOf(await(await task.promise).getPage(1));}finally{await task.destroy();}
 const native=proto.getTextContent,render=proto.render;let nativeCalls=0,renderCalls=0;
 proto.getTextContent=async function(...args){nativeCalls++;const content=await native.apply(this,args);return replace?{...content,items:replace(content.items,this.pageNumber)}:content;};
 proto.render=function(...args){renderCalls++;return render.apply(this,args);};
 try{return {result:await createSelectedPageReviewDraft(input),counts:{nativeCalls,renderCalls}};}finally{proto.getTextContent=native;proto.render=render;}
}
const item=(str,x,y,width=10)=>({str,dir:'ltr',width,height:12,transform:[12,0,0,12,x,y],fontName:'injected',hasEOL:true});
for(const [name,items] of [
 ['horizontal shared edge',[item('left',20,100),item('right',30,100)]],
 ['vertical shared edge',[item('lower',20,100),item('upper',20,112)]],
 ['shared corner',[item('lower',20,100),item('upper',30,112)]],
 ['sort-copy preserves reversed original IDs/order',[item('right',30,100),item('left',20,100)]],
])test(`${name} remains unverified under native-item injection`,async()=>{
 const {result}=await observe(await request([black]),(old,p)=>p===2?items:old);unverified(result);
 assert.deepEqual(result.pages[1].nativeFragments.map(f=>f.text),items.map(i=>i.str));assert.deepEqual(result.pages[1].nativeFragments.map(f=>f.id),['p2-f0','p2-f1']);
});
test('late-page overlap never renders an earlier selection',async()=>{
 const {result,counts}=await observe(await request([black,offset]));assert.deepEqual(counts,{nativeCalls:2,renderCalls:0});assert.deepEqual(result,{status:'ABSTAIN',reason:'OVERLAPPING_NATIVE_TEXT_UNASSESSED'});
});
const rows=n=>Array.from({length:n},(_,i)=>({str:'TABLE 1',dir:'ltr',width:1,height:0.25,transform:[0.25,0,0,0.25,10,20+i*0.5],fontName:'injected',hasEOL:true}));
test('more than65536 candidate pairs hold before any selected preview',async()=>{
 const injected=rows(400),{result,counts}=await observe(await request([black]),(old,p)=>p===2?injected:old);
 assert.deepEqual(result,{status:'ABSTAIN',reason:'NATIVE_OVERLAP_CHECK_LIMIT'});assert.deepEqual(counts,{nativeCalls:2,renderCalls:0});
});
test('64620 nonintersecting candidate pairs stay inside the page budget',async()=>{
 const injected=rows(360),{result}=await observe(await request([black]),(old,p)=>p===2?injected:old);unverified(result);assert.equal(result.pages[1].nativeFragments.length,360);
});
test('candidate budget resets on each selected page',async()=>{
 const injected=rows(360),{result}=await observe(await request([black]),()=>injected);unverified(result);assert.ok(result.pages.every(p=>p.nativeFragments.length===360));
});
test('exact coincident origin retains priority over exhausted overlap candidates',async()=>{
 const injected=rows(400);injected.push({...injected[0]});
 const {result,counts}=await observe(await request([black]),(old,p)=>p===2?injected:old);assert.deepEqual(result,{status:'ABSTAIN',reason:'COINCIDENT_NATIVE_TEXT_UNASSESSED'});assert.deepEqual(counts,{nativeCalls:2,renderCalls:0});
});
test('white operator refusal stays before native-item overlap checks',async()=>{
 const {result,counts}=await observe(await request([black,'BT /F1 12 Tf 1 g 20.25 100 Td (PAINT) Tj ET']));assert.deepEqual(result,{status:'ABSTAIN',reason:'WHITE_FILL_NATIVE_VISIBILITY_UNASSESSED'});assert.deepEqual(counts,{nativeCalls:0,renderCalls:0});
});
test('native payload refusal stays before overlap candidate allocation',async()=>{
 const {result,counts}=await observe(await request([black]),(old,p)=>p===2?[item('X'.repeat(270000),20,100)]:old);assert.deepEqual(result,{status:'ABSTAIN',reason:'NATIVE_PAYLOAD_LIMIT'});assert.deepEqual(counts,{nativeCalls:2,renderCalls:0});
});
test('invalid geometry stays before overlap and renders no selected page',async()=>{
 const {result,counts}=await observe(await request([black]),(old,p)=>p===2?[item('X',20,100,0)]:old);assert.deepEqual(result,{status:'ABSTAIN',reason:'INVALID_SELECTED_PAGE_INPUT_OR_RENDER'});assert.deepEqual(counts,{nativeCalls:2,renderCalls:0});
});
