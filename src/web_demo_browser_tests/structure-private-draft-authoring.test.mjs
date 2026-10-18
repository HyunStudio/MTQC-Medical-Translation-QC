import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {startPrivateReviewHost} from '../web_demo_evaluation/structure-private-review-host.mjs';
import {createReviewedArtifactsFromPrivateDraft,createPrivateDraftMappingReview} from '../web_demo_evaluation/structure-private-draft-authoring.mjs';
import {authoredHostRequest,authoredSecondPageRequest} from './private-host-controls.mjs';
import {createPrivateInteractionJournal} from '../web_demo/wwwroot/document-private-interaction-journal.mjs';
const encode=v=>new TextEncoder().encode(JSON.stringify(v)),hash=b=>createHash('sha256').update(b).digest('hex');
const mapping=caseId=>({caseId,checklist:[{id:'coverage',kind:'fragment-coverage'},{id:'formula',kind:'formula-grouping'}],bindings:[{id:'coverage',reviewed:false},{id:'formula',reviewed:false}]});
async function input(two=false){
  const intakeRequest=authoredSecondPageRequest();if(two){const s=structuredClone(intakeRequest.selections[0]);s.identity.caseId='authored-page1';s.identity.physicalPage=1;intakeRequest.selections.push(s);}
  const host=await startPrivateReviewHost(intakeRequest);
  try{const data=await (await fetch(host.url+'bootstrap')).json();const journal=createPrivateInteractionJournal({now:()=>1});journal.reset(1);
    const response=await fetch(host.url+'export',{method:'POST',headers:{Origin:new URL(host.url).origin,'Content-Type':'application/json'},body:JSON.stringify({status:'DRAFT',sourceGeneration:1,sourcePages:data.sourcePages,document:data.document,manualReview:data.manualReview,interactionJournal:journal.snapshot()})});
    assert.equal(response.status,200);return {draftBytes:new Uint8Array(await response.arrayBuffer()),intakeRequest,mappings:intakeRequest.selections.map(s=>mapping(s.identity.caseId))};
  }finally{await host.close();}
}
function noOutput(result){assert.equal(result.status,'ABSTAIN');for(const k of ['artifacts','observations','document','sourceEvidence','json'])assert.equal(Object.hasOwn(result,k),false);}
function changeDraft(request,mutate){const value=JSON.parse(new TextDecoder().decode(request.draftBytes));mutate(value);request.draftBytes=encode(value);}
test('actual exported private DRAFT reparses selected physical page2 as local p1 and preserves unknown authority',async()=>{
  const request=await input(),result=await createReviewedArtifactsFromPrivateDraft(request);assert.equal(result.status,'DRAFT');
  assert.equal(result.artifacts.length,1);assert.equal(result.artifacts[0].physicalPage,2);assert.equal(result.artifacts[0].pageId,'p1');
  assert.equal(result.artifacts[0].document.pages[0].regions[0].text,'PAGE 2');assert.equal(result.actorAuthentication,'unavailable');
  assert.equal(result.manualEditCount,null);assert.equal(result.manualReviewSeconds,null);assert.equal(result.privateDraftSha256,hash(request.draftBytes));
  assert.equal(result.sourceEvidence.sourcePages[0].sourceRenderEquivalence,'unverified');assert.equal(result.sourceEvidence.sourcePages[0].canonicalFragmentCrosswalk,'unavailable');
  assert.ok(result.observations[0].items.every(o=>o.status==='unresolved'));assert.equal(Object.hasOwn(result,'score'),false);
});
test('whole physical source/frame/native/render binding must match separately selected actual bytes',async()=>{
  const base=await input();for(const mutate of [d=>d.sourcePages[0].physicalPage=1,d=>d.sourcePages[0].caseId='alias',d=>d.sourcePageCount=3,
    d=>d.previews[0].previewSha256='a'.repeat(64),d=>d.renderer.version='999',d=>d.sourcePages[0].nativeFragmentIds=['p1-f100'],
    d=>d.sourcePages[0].frame.viewBox=[0,0,301,300]]){const request=structuredClone(base);changeDraft(request,mutate);noOutput(await createReviewedArtifactsFromPrivateDraft(request));}
  for(const key of ['sourceBytes','canonicalImageBytes']){const request=structuredClone(base);if(key==='sourceBytes')request.intakeRequest.sourceBytes[0]=0;else request.intakeRequest.selections[0].canonicalImageBytes[0]=0;noOutput(await createReviewedArtifactsFromPrivateDraft(request));}
});
test('missing/extra/duplicate/invalid later ID-only mappings reject the complete two-page result',async()=>{
  const base=await input(true);for(const mutate of [r=>r.mappings.pop(),r=>r.mappings.push(mapping('foreign')),r=>r.mappings[1].caseId=r.mappings[0].caseId,
    r=>r.mappings[1].checklist[0].expected={fragmentCount:1},r=>r.mappings[1].bindings[0].expected='answer',r=>r.mappings[1].bindings[0].id='foreign']){
    const request=structuredClone(base);mutate(request);noOutput(await createReviewedArtifactsFromPrivateDraft(request));}
  const valid=await createReviewedArtifactsFromPrivateDraft(base);assert.equal(valid.status,'DRAFT');assert.deepEqual(valid.artifacts.map(a=>[a.physicalPage,a.pageId]),[[2,'p1'],[1,'p2']]);
});
test('bytes and ID mappings are captured before parse awaits and result copies isolate later edits',async()=>{
  const request=await input(),original=hash(request.draftBytes);const pending=createReviewedArtifactsFromPrivateDraft(request);
  request.draftBytes.fill(0);request.intakeRequest.sourceBytes.fill(0);request.intakeRequest.selections[0].canonicalImageBytes.fill(0);
  request.mappings[0].caseId='changed';request.mappings[0].bindings[0].reviewed=true;
  const result=await pending;assert.equal(result.status,'DRAFT');assert.equal(result.privateDraftSha256,original);assert.equal(result.artifacts[0].caseId,'authored-page2');assert.equal(result.artifacts[0].bindings[0].reviewed,false);
  result.artifacts[0].document.pages[0].regions[0].text='later';assert.equal(result.sourceEvidence.sourcePages[0].caseId,'authored-page2');
});
test('unknown authority or malformed private schema/journal/UTF8/oversized draft emits no output',async()=>{
  const base=await input();for(const mutate of [d=>d.actorAuthentication='human',d=>d.manualReview.editCount=5,d=>d.interactionJournal.actorAuthentication='human',
    d=>d.interactionJournal.events=[{sequence:1,kind:'select',origin:'review-ui',pageIds:['p1'],offsetMs:0}],d=>d.document.selectedRegionIds=[{}],d=>d.extra=true]){
    const r=structuredClone(base);changeDraft(r,mutate);noOutput(await createReviewedArtifactsFromPrivateDraft(r));}
  for(const bytes of [new Uint8Array([0xff]),new Uint8Array(1048577)])noOutput(await createReviewedArtifactsFromPrivateDraft({...base,draftBytes:bytes}));
});
test('mapping accessors/hidden or sparse fields are rejected without executing getters',async()=>{
  const base=await input();let reads=0;
  for(const mutate of [r=>Object.defineProperty(r,'mappings',{enumerable:true,get(){reads++;return base.mappings;}}),
    r=>Object.defineProperty(r.mappings[0].checklist[0],'expected',{get(){reads++;return 'answer';}}),
    r=>delete r.mappings[0].bindings[0],r=>Object.defineProperty(r.mappings[0],'hidden',{value:true})]){
    const r=structuredClone(base);mutate(r);noOutput(await createReviewedArtifactsFromPrivateDraft(r));}
  assert.equal(reads,0);
});
test('review declarations cannot repair verified wrong graph text or invent formula grouping',async()=>{
  const r=await input();changeDraft(r,d=>{d.document.pages[0].regions[0].text='Wrong operator content';d.document.pages[0].regions[0].status='verified';d.interactionJournal.captureStatus='incomplete';d.interactionJournal.droppedStructuralActionCount=2;});
  r.mappings[0].bindings[0].reviewed=true;r.mappings[0].bindings[1].reviewed=true;
  const result=await createReviewedArtifactsFromPrivateDraft(r);assert.equal(result.status,'DRAFT');assert.equal(result.artifacts[0].document.pages[0].regions[0].text,'Wrong operator content');
  assert.equal(result.observations[0].items[0].status,'verified');assert.equal(result.observations[0].items[1].status,'unresolved');
  assert.equal(result.sourceEvidence.interactionJournal.captureStatus,'incomplete');assert.equal(result.sourceEvidence.interactionJournal.droppedStructuralActionCount,2);
});
test('mapping and projected value materialization are bounded before authoring artifacts',async()=>{
  for(const count of [129,128]){const r=await input();r.mappings[0].checklist=Array.from({length:count},(_,i)=>({id:'x'+i,kind:'formula-grouping'}));r.mappings[0].bindings=r.mappings[0].checklist.map(i=>({id:i.id,reviewed:false}));
    if(count===128)changeDraft(r,d=>d.document.pages[0].regions[0].text='x'.repeat(200000));
    const result=await createReviewedArtifactsFromPrivateDraft(r);noOutput(result);assert.equal(result.reason,count===129?'OVERSIZE_PRIVATE_DRAFT_MAPPINGS':'OBSERVATION_MATERIALIZATION_LIMIT');}
});

const reviewInput=r=>({draftBytes:r.draftBytes,intakeRequest:r.intakeRequest,checklists:r.mappings.map(({caseId,checklist})=>({caseId,checklist}))});
function noReviewOutput(result){assert.equal(result.status,'ABSTAIN');for(const k of ['cases','sourceEvidence','mappings','observations','artifacts'])assert.equal(Object.hasOwn(result,k),false);}
test('mapping review supplies source-bound targets and unreviewed ID-only templates without inventing canonical IDs',async()=>{
  const r=await input();changeDraft(r,d=>{const p=d.document.pages[0];p.regions[0].id='body';p.regions[0].text='Wrong operator content';p.regions[0].status='verified';p.edges=[];p.issues=[];d.document.selectedRegionIds=[];});
  const result=await createPrivateDraftMappingReview(reviewInput(r));assert.equal(result.status,'DRAFT');
  assert.equal(result.cases.length,1);const c=result.cases[0];assert.equal(c.caseId,'authored-page2');assert.equal(c.physicalPage,2);assert.equal(c.pageId,'p1');
  assert.equal(c.regions[0].regionId,'body');assert.equal(c.regions[0].declaredStatus,'verified');assert.equal(c.regions[0].text,'Wrong operator content');
  assert.deepEqual(c.bindings,[{id:'coverage',reviewed:false},{id:'formula',reviewed:false}]);
  assert.ok(result.observations[0].items.every(o=>o.status==='unresolved'));assert.equal(result.actorAuthentication,'unavailable');assert.equal(result.manualEditCount,null);assert.equal(result.manualReviewSeconds,null);
  assert.equal(result.sourceEvidence.sourcePages[0].sourceRenderEquivalence,'unverified');assert.equal(result.sourceEvidence.sourcePages[0].canonicalFragmentCrosswalk,'unavailable');
  for(const key of ['score','artifacts','truth','locked','humanReviewPasses'])assert.equal(Object.hasOwn(result,key),false);
});
test('mapping inventory preserves target-local reused cell/label IDs, headers and cross-page edges',async()=>{
  const r=await input(true);changeDraft(r,d=>{const p=d.document.pages[0],base=p.regions[0];p.regions=[{...base,id:'tableA',type:'table',table:{rowCount:2,columnCount:1,reviewed:false,cells:[{id:'h',row:0,column:0,rowSpan:1,colSpan:1,text:'Header',role:'header',headerCellIds:[]},{id:'v',row:1,column:0,rowSpan:1,colSpan:1,text:'11 mm',role:'value',headerCellIds:['h']}]}},{...base,id:'tableB',type:'table',table:{rowCount:1,columnCount:1,reviewed:false,cells:[{id:'h',row:0,column:0,rowSpan:1,colSpan:1,text:'Other header',role:'header',headerCellIds:[]}]}},{...base,id:'figureA',type:'figure',figureReview:{decision:'labels-transcribed',sourceChecked:false,labels:[{id:'h',text:'Label μ'}]}}];d.document.pages[1].regions[0].id='otherPage';p.edges=[{id:'cross',type:'reading-next',from:'tableA',to:'otherPage',status:'proposed'}];p.issues=[];d.document.selectedRegionIds=[];});
  const result=await createPrivateDraftMappingReview(reviewInput(r));assert.equal(result.status,'DRAFT');assert.deepEqual(result.cases.map(c=>[c.caseId,c.pageId,c.physicalPage]),[['authored-page2','p1',2],['authored-page1','p2',1]]);
  const targets=result.cases[0].regions;assert.equal(targets[0].tableCells[0].id,'h');assert.deepEqual(targets[0].tableCells[1].headerCellIds,['h']);assert.equal(targets[1].tableCells[0].id,'h');assert.equal(targets[2].figureLabels[0].id,'h');assert.equal(targets[2].figureLabels[0].text,'Label μ');assert.equal(result.cases[0].edges[0].to,'otherPage');
  result.cases[0].regions[0].tableCells[0].text='later';assert.equal(result.cases[0].regions[1].tableCells[0].text,'Other header');
});
test('mapping review captures values before await and rejects whole result for later source or checklist substitutions',async()=>{
  const r=await input(true),request=reviewInput(r);const pending=createPrivateDraftMappingReview(request);request.checklists[0].caseId='mutated';request.draftBytes.fill(0);request.intakeRequest.sourceBytes.fill(0);
  const result=await pending;assert.equal(result.status,'DRAFT');assert.equal(result.cases[0].caseId,'authored-page2');
  const base=await input(true);for(const mutate of [v=>v.checklists[1].checklist[0].expected='answer',v=>v.checklists[1].caseId='foreign',v=>v.checklists[1].checklist[0].kind='invented']){const request=reviewInput(structuredClone(base));mutate(request);noReviewOutput(await createPrivateDraftMappingReview(request));}
  const wrong=structuredClone(base);changeDraft(wrong,d=>d.previews[1].previewSha256='a'.repeat(64));noReviewOutput(await createPrivateDraftMappingReview(reviewInput(wrong)));
});
test('mapping review rejects accessor, hidden, sparse and over-budget checklists without getter execution',async()=>{
  const base=await input();let reads=0;for(const mutate of [r=>Object.defineProperty(r,'checklists',{enumerable:true,get(){reads++;return [];}}),r=>Object.defineProperty(r.checklists[0].checklist[0],'expected',{get(){reads++;return 'answer';}}),r=>r.checklists[0].extra=true,r=>delete r.checklists[0],r=>r.checklists[0].checklist=Array.from({length:129},(_,i)=>({id:'x'+i,kind:'formula-grouping'}))]){const request=reviewInput(structuredClone(base));mutate(request);noReviewOutput(await createPrivateDraftMappingReview(request));}assert.equal(reads,0);
});
