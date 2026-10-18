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
   selections.push({identity:{caseId:`authored-operator-run-${physicalPage}`,physicalPage,sourceSha256:hash(sourceBytes),pageImageSha256:hash(png)},canonicalImageBytes:png,frame:{viewBox:[0,0,200,300],rotation:0,scale:1,transform:[1,0,0,-1,0,300],width:200,height:300}});
  }
 }finally{await task.destroy();}
 return {sourceBytes,selections};
}

const merged='BT /F1 12 Tf 0 g 53.336 100 Td (PAINT) Tj ET';
const overlapReason='OVERLAPPING_OPERATOR_TEXT_RUN_UNASSESSED';
const unsupported='TEXT_RUN_POSITIONING_UNASSESSED';
async function observe(input,changeOps=null,changeNative=null){
 const pdfjs=await import('../web_demo_client/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
 const task=pdfjs.getDocument({data:new Uint8Array(input.sourceBytes),useSystemFonts:true,isEvalSupported:false,stopAtErrors:true});let proto;
 try{proto=Object.getPrototypeOf(await(await task.promise).getPage(1));}finally{await task.destroy();}
 const native=proto.getTextContent,render=proto.render,operators=proto.getOperatorList;let nativeCalls=0,renderCalls=0;
 proto.getTextContent=async function(...args){nativeCalls++;const content=await native.apply(this,args);return changeNative?{...content,items:changeNative(content.items,this.pageNumber)}:content;};
 proto.getOperatorList=async function(...args){const o=await operators.apply(this,args);return changeOps?changeOps(o,this,pdfjs):o;};
 proto.render=function(...args){renderCalls++;return render.apply(this,args);};
 try{return {result:await createSelectedPageReviewDraft(input),counts:{nativeCalls,renderCalls}};}finally{proto.getTextContent=native;proto.render=render;proto.getOperatorList=operators;}
}
async function hold(draws,reason=overlapReason,changeOps=null,changeNative=null){const {result,counts}=await observe(await request(draws),changeOps,changeNative);assert.equal(result.status,'ABSTAIN');assert.deepEqual(result,{status:'ABSTAIN',reason});assert.deepEqual(counts,{nativeCalls:2,renderCalls:0});}
function draft(result){assert.equal(result.status,'DRAFT');assert.ok(result.pages.every(p=>p.sourceRenderEquivalence==='unverified'&&p.canonicalFragmentCrosswalk==='unavailable'));}
for(const [name,draws] of [
 ['preserved small backward merge',[black,merged]],
 ['different strings small backward merge',[black,merged.replace('(PAINT)','(COVER)')]],
 ['same text object absolute reposition',['BT /F1 12 Tf 0 g 20 100 Td (PAINT) Tj 1 0 0 1 53.336 100 Tm (PAINT) Tj ET']],
 ['empty draw between merged runs',[black,'BT /F1 12 Tf 0 g 53.336 100 Td () Tj ET',merged]],
 ['consecutive empty draws preserve history',[black,'BT /F1 12 Tf 0 g 53.336 100 Td () Tj () Tj ET',merged]],
 ['saved state does not erase run history',[black,'q',merged,'Q']],
 ['restored state does not erase painted history',['q',black,'Q',merged]],
 ['nondefault spacing declaration reset before new draw',[black,'1 Tc 0 Tc',merged]],
])test(name+' holds before any selected-page preview',async()=>{await hold(draws);});
test('all prior runs survive an intervening disjoint run under explicit native injection',async()=>{
 await hold([black,'BT /F1 12 Tf 0 g 140 100 Td (PAINT) Tj ET',merged],overlapReason,null,(items,p)=>p===2?[{...items[0],str:'PAINTPAINTPAINT',width:100}]:items);
});
for(const [name,draws] of [
 ['one literal PAINTPAINT draw',[black.replace('(PAINT)','(PAINTPAINT)')]],
 ['actual advance end contact',[black,'BT /F1 12 Tf 0 g 55.34 100 Td (PAINT) Tj ET']],
 ['exact per-glyph runtime advance end contact',[black,'BT /F1 12 Tf 0 g 55.339999999999996 100 Td (PAINT) Tj ET']],
 ['positive horizontal gap',[black,'BT /F1 12 Tf 0 g 70 100 Td (PAINT) Tj ET']],
 ['fully disjoint run to the left',['BT /F1 12 Tf 0 g 100 100 Td (PAINT) Tj ET',black]],
 ['different baselines',[black,'BT /F1 12 Tf 0 g 20 80 Td (PAINT) Tj ET']],
 ['state reset before drawing',['1 Tc 1 Tw 90 Tz 1 Ts 0 Tc 0 Tw 100 Tz 0 Ts',black]],
 ['q restores unsupported state before drawing',['q 1 Tc 90 Tz 1 Ts Q',black]],
 ['empty glyph draws do not create intervals',[black,'BT /F1 12 Tf 0 g 53.336 100 Td () Tj ET']],
])test(name+' remains an unverified draft without deleting text',async()=>{const input=await request(draws),{result}=await observe(input);draft(result);assert.equal(hash(result.sourceBytes),hash(input.sourceBytes));});
for(const [name,line] of [
 ['character spacing','1 Tc'],['word spacing','1 Tw'],['horizontal scaling','90 Tz'],['text rise','1 Ts'],
 ['nonunit CTM','2 0 0 2 0 0 cm'],['translated CTM','1 0 0 1 1 0 cm'],
 ['rotated text basis','0 1 -1 0 120 100 Tm'],
])test(name+' is explicitly unassessed for a nonempty draw',async()=>{
 const text=line.endsWith('Tm')?`BT /F1 12 Tf 0 g ${line} (PAINT) Tj ET`:line.endsWith('cm')?`${line} BT /F1 12 Tf 0 g 20 100 Td (PAINT) Tj ET`:`BT /F1 12 Tf 0 g ${line} 20 100 Td (PAINT) Tj ET`;
 await hold([text],unsupported);
});
test('numeric TJ adjustments are explicitly unassessed',async()=>{await hold(['BT /F1 12 Tf 0 g 20 100 Td [(PAINT) 10 (X)] TJ ET'],unsupported);});
function fontOverride(field,value,throws=false){return (o,page,pdfjs)=>{
 const original=page.commonObjs.get.bind(page.commonObjs),fontId=o.argsArray[o.fnArray.indexOf(pdfjs.OPS.setFont)][0];
 page.commonObjs.get=id=>{const f=original(id);return id===fontId?new Proxy(f,{get(target,key){if(key===field){if(throws)throw new Error('injected font getter');return value;}return Reflect.get(target,key,target);}}):f;};return o;
};}
for(const [name,field,value,throws] of [
 ['null matrix','fontMatrix',null],['bad matrix','fontMatrix',[.002,0,0,.001,0,0]],
 ['matrix getter failure','fontMatrix',null,true],['invalid font','isInvalidPDFjsFont',true],['invalid flag type','isInvalidPDFjsFont','false'],['vertical font metadata','vertical',true],
])test(name+' refuses instead of assuming identity metrics',async()=>{await hold([black],unsupported,fontOverride(field,value,throws));});
for(const [name,field,value] of [
 ['explicit identity matrix','fontMatrix',[.001,0,0,.001,0,0]],['explicit valid flag','isInvalidPDFjsFont',false],['undefined valid flag','isInvalidPDFjsFont',undefined],
])test(name+' follows the pinned runtime cursor advance contract',async()=>{const {result}=await observe(await request([black]),fontOverride(field,value));draft(result);});
function glyphOverride(value){return(o,page,pdfjs)=>{if(page.pageNumber!==2)return o;const args=o.argsArray.map((a,i)=>o.fnArray[i]===pdfjs.OPS.showText?[Array.from({length:value===Number.MAX_VALUE?2:1},()=>({...a[0][0],width:value}))]:a);return {...o,argsArray:args};};}
for(const [name,width] of [['negative width',-1],['nonfinite width',NaN],['nonempty zero advance',0],['overflow advance',Number.MAX_VALUE]])test(name+' is explicitly unassessed',async()=>{await hold([black],unsupported,glyphOverride(width));});
function injectedRuns(n,{sameBaseline=false,both=false,glyphCount=1}={}){return(o,page,pdfjs)=>{
 if(!both&&page.pageNumber!==2)return o;const font=o.argsArray[o.fnArray.indexOf(pdfjs.OPS.setFont)][0],fnArray=[],argsArray=[];
 const add=(name,args)=>{fnArray.push(pdfjs.OPS[name]);argsArray.push(args);};
 for(let i=0;i<n;i++){add('beginText',[]);add('setFont',[font,12]);add('moveText',[sameBaseline?1+i*.02:20,sameBaseline?100:1+i*.01]);add('showText',[Array.from({length:glyphCount},()=>({unicode:'I',width:1,isSpace:false,fontChar:'I'}))]);add('endText',[]);}
 return {...o,fnArray,argsArray};
};}
for(const [name,change,reason] of [
 ['glyph entries',injectedRuns(1,{glyphCount:32769}),'TEXT_RUN_GLYPH_LIMIT'],
 ['stored runs',injectedRuns(8193),'TEXT_RUN_LIMIT'],
 ['same-baseline comparisons',injectedRuns(363,{sameBaseline:true}),'TEXT_RUN_CHECK_LIMIT'],
])test(name+' budget holds after native checks and before previews',async()=>{await hold([black],reason,change);});
test('65341 disjoint same-baseline comparisons remain within policy',async()=>{const {result}=await observe(await request([black]),injectedRuns(362,{sameBaseline:true}));draft(result);});
test('operator run comparison budget resets on each selected page',async()=>{const {result}=await observe(await request([black]),injectedRuns(362,{sameBaseline:true,both:true}));draft(result);});
test('old coincident native reason retains priority over numeric TJ positioning',async()=>{await hold([black,black], 'COINCIDENT_NATIVE_TEXT_UNASSESSED',injectedRuns(1,{glyphCount:32769}));});
test('old native overlap reason retains priority over numeric TJ positioning',async()=>{await hold([black,'BT /F1 12 Tf 0 g 20.25 100 Td (PAINT) Tj ET'],'OVERLAPPING_NATIVE_TEXT_UNASSESSED',injectedRuns(1,{glyphCount:32769}));});
test('later invalid selected native geometry precedes earlier operator-run refusal',async()=>{
 const input=await request([black]);const {result,counts}=await observe(input,injectedRuns(1,{both:true,glyphCount:32769}),(items,p)=>p===2?[{...items[0],width:0}]:items);
 assert.deepEqual(result,{status:'ABSTAIN',reason:'INVALID_SELECTED_PAGE_INPUT_OR_RENDER'});assert.deepEqual(counts,{nativeCalls:2,renderCalls:0});
});
test('old white fill reason precedes all native and operator-run metric work',async()=>{
 const {result,counts}=await observe(await request(['BT /F1 12 Tf 1 g 20 100 Td (PAINT) Tj ET']),fontOverride('fontMatrix',null));
 assert.deepEqual(result,{status:'ABSTAIN',reason:'WHITE_FILL_NATIVE_VISIBILITY_UNASSESSED'});assert.deepEqual(counts,{nativeCalls:0,renderCalls:0});
});

test('injected exact per-glyph runtime endpoint preserves strict touching intervals',async()=>{
 const input=await request([black,'BT /F1 12 Tf 0 g 55.34 100 Td (PAINT) Tj ET']);
 const {result}=await observe(input,(o,page,pdfjs)=>{
  if(page.pageNumber!==2)return o;
  let draws=0;
  const argsArray=o.argsArray.map((a,i)=>{
   if(o.fnArray[i]===pdfjs.OPS.showText)draws++;
   if(draws===1&&o.fnArray[i]===pdfjs.OPS.moveText)return [55.339999999999996,100];
   return a;
  });return {...o,argsArray};
 });draft(result);
});

test('injected fixed text matrix keeps local cursor rounding separate across repeated draws',async()=>{
 const {result}=await observe(await request([black]),(o,page,pdfjs)=>{
  if(page.pageNumber!==2)return o;
  const font=o.argsArray[o.fnArray.indexOf(pdfjs.OPS.setFont)][0];
  const glyphs=o.argsArray[o.fnArray.indexOf(pdfjs.OPS.showText)][0];
  const advance=glyphs.reduce((sum,g)=>sum+g.width*(12*.001),0);
  let local=0;for(let i=0;i<3;i++)local+=advance;
  const fnArray=[],argsArray=[];const add=(name,args)=>{fnArray.push(pdfjs.OPS[name]);argsArray.push(args);};
  add('beginText',[]);add('setFont',[font,12]);add('setTextMatrix',[new Float32Array([1,0,0,1,40,100])]);
  for(let i=0;i<3;i++)add('showText',[glyphs]);add('endText',[]);
  add('beginText',[]);add('setFont',[font,12]);add('moveText',[40+local,100]);add('showText',[glyphs]);add('endText',[]);
  return {...o,fnArray,argsArray};
 });draft(result);
});


// Source18 residuals: logical advance rectangles, never glyph ink truth.
const rectDraw=(x,y,text='PAINT',size=12)=>`BT /F1 ${size} Tf 0 g ${x} ${y} Td (${text}) Tj ET`;
for(const dy of [.01,-.01,.25,-.25,1,-1,6,-6])test(`rectangle residual baseline ${dy} holds before previews`,async()=>{await hold([black,rectDraw(53.336,100+dy)]);});
test('rectangle different-string residual holds without deduplicating',async()=>{await hold([black,rectDraw(53.336,100.25,'COVER')]);});
test('rectangle saved-state residual preserves history',async()=>{await hold([black,'q',rectDraw(53.336,100.25),'Q']);});
for(const [name,x,y] of [['vertical edge',53.336,112],['vertical gap',53.336,120],['horizontal edge',55.34,100.25],['horizontal gap',70,100.25],['shared corner',55.34,112]])test(`rectangle ${name} remains an unverified draft`,async()=>{const input=await request([black,rectDraw(x,y)]);const {result}=await observe(input);draft(result);assert.equal(hash(result.sourceBytes),hash(input.sourceBytes));});
const oneNative=(items,p)=>p===2?[{...items[0],str:'CONTROL',width:50}]:items;
for(const reverse of [false,true])test(`rectangle mixed-size containment order ${reverse} holds`,async()=>{const draws=[black,rectDraw(40,102,'PAINT',6)];await hold(reverse?draws.reverse():draws,overlapReason,null,oneNative);});
for(const reverse of [false,true])test(`rectangle mixed-size vertical edge order ${reverse} stays draft`,async()=>{const draws=[black,rectDraw(40,112,'PAINT',6)];const {result}=await observe(await request(reverse?draws.reverse():draws),null,oneNative);draft(result);});
test('rectangle reversed residual holds under explicit native injection',async()=>{await hold([rectDraw(53.336,100.25),black],overlapReason,null,oneNative);});
test('rectangle history survives an intervening disjoint run',async()=>{await hold([black,rectDraw(130,160),rectDraw(53.336,100.25)],overlapReason,null,oneNative);});
test('rectangle q restore does not erase earlier off-baseline draw',async()=>{await hold(['q',black,'Q',rectDraw(53.336,100.25)],overlapReason,null,oneNative);});
function verticalRunMetrics({y,size=12}){return(o,page,pdfjs)=>{if(page.pageNumber!==2)return o;return {...o,argsArray:o.argsArray.map((a,i)=>o.fnArray[i]===pdfjs.OPS.setFont?[a[0],size]:o.fnArray[i]===pdfjs.OPS.moveText?[20,y]:o.fnArray[i]===pdfjs.OPS.showText?[[{...a[0][0],width:1}]]:a)};};}
test('rectangle collapsed positive-size vertical interval is unsupported',async()=>{await hold([black],unsupported,verticalRunMetrics({y:1e20}));});
test('rectangle overflowing top is unsupported',async()=>{await hold([black],unsupported,verticalRunMetrics({y:Number.MAX_VALUE,size:Number.MAX_VALUE}));});
function rectangleCandidates(n,upperCount=0){const inject=injectedRuns(n,{sameBaseline:true});return(o,page,pdfjs)=>{o=inject(o,page,pdfjs);if(page.pageNumber!==2)return o;let cursor=0;return {...o,argsArray:o.argsArray.map((a,i)=>{if(o.fnArray[i]!==pdfjs.OPS.moveText)return a;const j=cursor++;return [a[0],j===362?117:j>=362-upperCount?106:100];})};};}
test('rectangle exactly65536 candidates remains a draft',async()=>{const {result}=await observe(await request([black]),rectangleCandidates(363,195));draft(result);});
test('rectangle candidate65537 holds before previews',async()=>{await hold([black],'TEXT_RUN_CHECK_LIMIT',rectangleCandidates(363,196));});
test('rectangle many vertically disjoint runs stay within candidate policy',async()=>{const inject=injectedRuns(1000);const {result}=await observe(await request([black]),(o,page,pdfjs)=>{o=inject(o,page,pdfjs);if(page.pageNumber!==2)return o;let j=0;return {...o,argsArray:o.argsArray.map((a,i)=>o.fnArray[i]===pdfjs.OPS.moveText?[20,20*(j++)]:a)};});draft(result);});

// Faults are injected at the resolved font/path boundary; real intake, native
// validation and preview dispatch remain active. Bounds below are hand-derived.
const glyphPathReason='GLYPH_PATH_NATIVE_VISIBILITY_UNASSESSED';
const glyphOverlapReason='OVERLAPPING_GLYPH_ENVELOPE_UNASSESSED';
const outline=()=>new Float32Array([0,0,-.2,1,.05,-.2,1,.05,1.2,1,0,1.2,4]);
function acquiredPaths(path=outline(),{missing=false,throws=false,fontField=null,fontValue=null}={}){
 return(o,page,pdfjs)=>{
  if(page.pageNumber!==2)return o;
  const get=page.commonObjs.get.bind(page.commonObjs),has=page.commonObjs.has.bind(page.commonObjs);
  const fontId=o.argsArray[o.fnArray.indexOf(pdfjs.OPS.setFont)][0],font=get(fontId),alias=fontId+'-acquired',loadedName='injected-acquired-page2';
  const keys=new Set(o.argsArray.flatMap((a,i)=>o.fnArray[i]===pdfjs.OPS.showText?a[0].map(g=>`${loadedName}_path_${g.fontChar}`):[]));
  page.commonObjs.has=id=>id===alias?true:keys.has(id)?!missing:has(id);
  page.commonObjs.get=id=>{
   if(keys.has(id))return {get path(){if(throws)throw new Error('injected path getter');return path;}};
   if(id===alias)return new Proxy(font,{get(t,k){if(k===fontField)return fontValue;if(k==='loadedName')return loadedName;if(k==='missingFile'||k==='remeasure'||k==='disableFontFace')return false;return Reflect.get(t,k,t);}});
   return get(id);
  };return {...o,argsArray:o.argsArray.map((a,i)=>o.fnArray[i]===pdfjs.OPS.setFont?[alias,a[1]]:o.fnArray[i]===pdfjs.OPS.showText?[a[0].map(g=>({...g,isInFont:true}))]:a)};
 };
}
for(const reversed of [false,true])test(`glyph envelope crosses logical vertical edge order ${reversed} before previews`,async()=>{
 const draws=[black,rectDraw(20,112)];await hold(reversed?draws.reverse():draws,glyphOverlapReason,acquiredPaths());
});
test('glyph envelope saved-state history survives restore',async()=>{await hold(['q',black,'Q',rectDraw(20,112)],glyphOverlapReason,acquiredPaths());});
for(const [name,draws] of [['single',[black]],['wide gap',[black,rectDraw(20,120)]],['horizontal gap',[black,rectDraw(80,112)]]])test(`glyph envelope ${name} remains unverified`,async()=>{const {result}=await observe(await request(draws),acquiredPaths());draft(result);});
for(const [name,path,options] of [
 ['missing key',outline(),{missing:true}],['getter failure',outline(),{throws:true}],
 ['nonfinite',new Float32Array([0,0,NaN]),{}],['unknown opcode',new Float32Array([5]),{}],
 ['truncated curve',new Float32Array([0,0,0,2,1,2]),{}],['line before move',new Float32Array([1,0,0]),{}],
 ['wrong typed array',new Uint8Array([0,0,0]),{}],['plain list',[0,0,0],{}],
 ['remeasured font',outline(),{fontField:'remeasure',fontValue:true}],
])test(`glyph path ${name} holds without a preview`,async()=>{await hold([black],glyphPathReason,acquiredPaths(path,options));});
test('empty acquired nonspace glyph path holds before previews',async()=>{await hold([black],glyphPathReason,acquiredPaths(new Float32Array()));});
test('empty acquired space path preserves unverified draft',async()=>{const paths=acquiredPaths(new Float32Array());const {result}=await observe(await request([black]),(o,p,pdfjs)=>{o=paths(o,p,pdfjs);return {...o,argsArray:o.argsArray.map((a,i)=>o.fnArray[i]===pdfjs.OPS.showText?[a[0].map(g=>({...g,isSpace:true}))]:a)};});draft(result);});
test('glyph path matrix is already normalized and must not shrink by .001 again',async()=>{await hold([black,rectDraw(20,112)],glyphOverlapReason,acquiredPaths());});
test('later selected native geometry failure retains priority over glyph overlap',async()=>{
 const input=await request([black,rectDraw(20,112)]);input.selections.reverse();
 const {result,counts}=await observe(input,acquiredPaths(),(items,p)=>p===1?[{...items[0],width:0}]:items);
 assert.deepEqual(result,{status:'ABSTAIN',reason:'INVALID_SELECTED_PAGE_INPUT_OR_RENDER'});assert.equal(counts.renderCalls,0);
});
test('later logical positioning failure retains priority over earlier glyph overlap',async()=>{
 const input=await request([black,rectDraw(20,112)]);input.selections.reverse();
 const paths=acquiredPaths();const {result,counts}=await observe(input,(o,p,pdfjs)=>p.pageNumber===2?paths(o,p,pdfjs):fontOverride('fontMatrix',null)(o,p,pdfjs));
 assert.deepEqual(result,{status:'ABSTAIN',reason:unsupported});assert.equal(counts.renderCalls,0);
});
function scalarPath(length){const values=[0,0,0,1,.001,0,1,.001,.001,1,0,.001,4];while(values.length+3<=length)values.push(1,0,0);while(values.length<length)values.push(4);return new Float32Array(values);}
test('glyph path exactly4096 scalars is decoded within policy',async()=>{const {result}=await observe(await request([black]),acquiredPaths(scalarPath(4096)));draft(result);});
test('glyph path scalar4097 holds before any preview',async()=>{await hold([black],'GLYPH_PATH_SCALAR_LIMIT',acquiredPaths(scalarPath(4097)));});
for(const [name,path] of [['point',new Float32Array([0,0,0,1,0,0,4])],['horizontal line',new Float32Array([0,0,0,1,1,0,4])]])test(`glyph nonspace degenerate ${name} holds`,async()=>{await hold([black],glyphPathReason,acquiredPaths(path));});
function pathPopulation(n,{length=13,shared=false,width=1000,spaces=false}={}){return(o,p,pdfjs)=>{
 if(p.pageNumber!==2)return o;
 const argsArray=o.argsArray.map((a,i)=>o.fnArray[i]===pdfjs.OPS.showText?[[...Array.from({length:n},(_,j)=>({...a[0][0],width,isSpace:spaces,fontChar:shared?'one':`k${j}`}))]]:a);
 return acquiredPaths(spaces?new Float32Array():scalarPath(length))({...o,argsArray},p,pdfjs);
};}
test('glyph unique4096 empty space paths within key policy remains unverified',async()=>{const {result}=await observe(await request([black]),pathPopulation(4096,{spaces:true}));draft(result);});
test('glyph unique4097 empty space paths exceeds key policy before preview',async()=>{await hold([black],'GLYPH_PATH_KEY_LIMIT',pathPopulation(4097,{spaces:true}));});
test('glyph total262144 scalars within page policy',async()=>{const {result}=await observe(await request([black]),pathPopulation(64,{length:4096}));draft(result);});
test('glyph total scalar overflow holds before preview',async()=>{await hold([black],'GLYPH_PATH_TOTAL_SCALAR_LIMIT',pathPopulation(65,{length:4096}));});
test('glyph repeated path counts placements for pair budget',async()=>{await hold([black],'GLYPH_ENVELOPE_CHECK_LIMIT',pathPopulation(363,{shared:true}));});
test('glyph 65341 candidate comparisons remain within page policy',async()=>{const {result}=await observe(await request([black]),pathPopulation(362,{shared:true}));draft(result);});
test('glyph later selected missing path precedes earlier envelope overlap',async()=>{
 const input=await request([black,rectDraw(20,112)]);input.selections.reverse();
 const paths=acquiredPaths();const {result,counts}=await observe(input,(o,p,pdfjs)=>{o=paths(o,p,pdfjs);if(p.pageNumber===1){const a=o.argsArray[o.fnArray.indexOf(pdfjs.OPS.setFont)],get=p.commonObjs.get.bind(p.commonObjs);p.commonObjs.get=id=>id===a[0]?new Proxy(get(id),{get(t,k){if(k==='missingFile')return false;if(k==='remeasure')return false;return Reflect.get(t,k,t);}}):get(id);}return o;});
 assert.deepEqual(result,{status:'ABSTAIN',reason:glyphPathReason});assert.equal(counts.renderCalls,0);
});
test('glyph positive local envelope collapsed at placed coordinates holds',async()=>{await hold([black],glyphPathReason,acquiredPaths(new Float32Array([0,0,0,1,1e-20,0,1,1e-20,1e-20,1,0,1e-20,4])));});
for(const [name,field,value] of [['accent','accent',{fontChar:'x',offset:{x:0,y:0}}],['font mapping refusal','isInFont',false]])test(`glyph acquired ${name} is explicitly unassessed`,async()=>{const paths=acquiredPaths();await hold([black],glyphPathReason,(o,p,pdfjs)=>{o=paths(o,p,pdfjs);return {...o,argsArray:o.argsArray.map((a,i)=>p.pageNumber===2&&o.fnArray[i]===pdfjs.OPS.showText?[a[0].map(g=>({...g,[field]:value}))]:a)};});});
test('glyph quadratic and cubic control envelopes conservatively hold',async()=>{await hold([black,rectDraw(20,112)],glyphOverlapReason,acquiredPaths(new Float32Array([0,0,0,3,.01,1.2,.02,0,2,.03,1.2,.04,1.2,.05,0,4])));});
