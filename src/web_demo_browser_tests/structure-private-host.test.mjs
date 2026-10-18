import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {authoredHostRequest,authoredSecondPageRequest} from './private-host-controls.mjs';
import {startPrivateReviewHost,loadPrivateReviewConfig} from '../web_demo_evaluation/structure-private-review-host.mjs';
import {createPrivateInteractionJournal} from '../web_demo/wwwroot/document-private-interaction-journal.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function snapshot(bootstrap){const journal=createPrivateInteractionJournal({now:()=>1});journal.reset(1);
  return {status:'DRAFT',document:bootstrap.document,sourcePages:bootstrap.sourcePages,sourceGeneration:1,
    manualReview:{eventCapture:'unavailable',editCount:null,durationSeconds:null},interactionJournal:journal.snapshot()};}
async function withHost(run){const host=await startPrivateReviewHost(authoredHostRequest());try{await run(host);}finally{await host.close();}}
async function bootstrap(host){return (await fetch(host.url+'bootstrap')).json();}
async function post(host,value,headers={}){return fetch(host.url+'export',{method:'POST',headers:{Origin:new URL(host.url).origin,'Content-Type':'application/json',...headers},body:JSON.stringify(value)});}
async function mappedPost(host,route,value,headers={}){return fetch(host.url+route,{method:'POST',headers:{Origin:new URL(host.url).origin,'Content-Type':'application/json',...headers},body:JSON.stringify(value)});}
function noArtifact(v){assert.equal(v.status,'ABSTAIN');assert.equal(Object.hasOwn(v,'document'),false);assert.equal(Object.hasOwn(v,'artifact'),false);}
test('private HTTP inventory and mapped export use held originals and complete explicit IDs only',async()=>withHost(async host=>{
  const data=await bootstrap(host),value=snapshot(data);value.document.pages[0].regions[0].text='Wrong operator content';
  const checklist=[{id:'coverage',kind:'fragment-coverage'}],checklists=[{caseId:'authored-vector-caption',checklist}];
  const review=await mappedPost(host,'mapping-review',{snapshot:value,checklists});assert.equal(review.status,200);const inventory=await review.json();
  assert.equal(inventory.cases[0].regions[0].text,'Wrong operator content');assert.deepEqual(inventory.cases[0].bindings,[{id:'coverage',reviewed:false}]);
  const mappings=[{caseId:'authored-vector-caption',checklist,bindings:inventory.cases[0].bindings}];
  const response=await mappedPost(host,'mapped-export',{snapshot:value,mappings});assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/private-mapped-review-DRAFT.json/);
  const result=await response.json();assert.equal(result.artifactKind,'private-mapped-operator-review-draft');assert.equal(result.artifacts[0].document.pages[0].regions[0].text,'Wrong operator content');assert.equal(result.manualEditCount,null);assert.equal(result.actorAuthentication,'unavailable');assert.equal(result.observations[0].items[0].status,'unresolved');
}));
test('private mapped routes reject late case/mapping/authority errors and foreign origins without partial inventories',async()=>{
  const request=authoredSecondPageRequest(),second=structuredClone(request.selections[0]);second.identity.caseId='authored-page1';second.identity.physicalPage=1;request.selections.push(second);
  const host=await startPrivateReviewHost(request);try{request.sourceBytes.fill(0);request.selections[0].canonicalImageBytes.fill(0);
    const data=await bootstrap(host),value=snapshot(data),checklist=[{id:'coverage',kind:'fragment-coverage'}];
    const mappings=[{caseId:'authored-page2',checklist,bindings:[{id:'coverage',reviewed:false}]},{caseId:'authored-page1',checklist,bindings:[{id:'coverage',reviewed:false}]}];
    assert.equal((await mappedPost(host,'mapped-export',{snapshot:value,mappings})).status,200);
    for(const change of [r=>r.mappings[1].caseId='foreign',r=>r.mappings[1].bindings[0].expected='answer',r=>r.snapshot.sourcePages[1].sourceRenderEquivalence='verified',r=>r.extra=true]){
      const payload=structuredClone({snapshot:value,mappings});change(payload);const response=await mappedPost(host,'mapped-export',payload);assert.equal(response.status,422);const result=await response.json();noArtifact(result);for(const key of ['cases','artifacts','observations','sourceEvidence'])assert.equal(Object.hasOwn(result,key),false);
    }
    for(const route of ['mapping-review','mapped-export']){const response=await mappedPost(host,route,{snapshot:value,mappings},{Origin:'https://foreign.invalid'});assert.equal(response.status,403);noArtifact(await response.json());}
  }finally{await host.close();}
});
test('loopback host serves only capability-scoped editor assets and actual parsed PNG bytes',async()=>withHost(async host=>{
  assert.equal(new URL(host.url).hostname,'127.0.0.1');
  const html=await fetch(host.url);assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/default-src 'none'/);
  assert.match(await html.text(),/private-export/);
  const data=await bootstrap(host);assert.equal(data.status,'DRAFT');assert.equal(data.sourcePages[0].pageId,'p1');assert.equal(data.sourcePages[0].physicalPage,1);
  assert.equal(data.sourcePages[0].sourceRenderEquivalence,'unverified');assert.equal(data.sourcePages[0].canonicalFragmentCrosswalk,'unavailable');
  const png=await fetch(host.url+'preview/p1.png');assert.equal(png.headers.get('content-type'),'image/png');
  assert.equal(hash(new Uint8Array(await png.arrayBuffer())),data.previews[0].previewSha256);
  assert.notEqual(data.previews[0].previewSha256,data.sourcePages[0].pageImageSha256);
  for(const route of ['../bootstrap','../../index.html','api/live','preview/p2.png','document-workbench.mjs','%2e%2e/ORDERS.md'])assert.equal((await fetch(host.url+route)).status,404,route);
}));
test('DRAFT export rechecks held bytes and selection while retaining unknown human metrics and observations',async()=>withHost(async host=>{
  const data=await bootstrap(host),value=snapshot(data);value.document.pages[0].regions[0].text='operator draft';
  const response=await post(host,value);assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);
  const draft=await response.json();assert.equal(draft.status,'DRAFT');assert.equal(draft.artifactKind,'private-operator-review-draft');
  assert.equal(draft.document.pages[0].regions[0].text,'operator draft');assert.equal(draft.manualReview.editCount,null);
  assert.equal(draft.actorAuthentication,'unavailable');assert.equal(draft.interactionJournal.recordedStructuralActionCount,0);
  assert.equal(draft.sourcePages[0].sourceSha256,hash(authoredHostRequest().sourceBytes));
  assert.equal(Object.hasOwn(draft,'score'),false);assert.equal(Object.hasOwn(draft,'truth'),false);
}));
test('foreign source metadata, authority claims, unbound or oversized posts fail with no partial output',async()=>withHost(async host=>{
  const data=await bootstrap(host);
  for(const change of [v=>v.sourcePages[0].caseId='foreign',v=>v.sourcePages[0].nativeFragmentIds=[],v=>v.sourcePages[0].sourceRenderEquivalence='verified',
    v=>v.manualReview.editCount=1,v=>v.sourceGeneration=2,v=>v.interactionJournal.actorAuthentication='human',
    v=>v.interactionJournal.events=[{sequence:1,kind:'select',origin:'review-ui',pageIds:['p1'],offsetMs:0}],v=>v.document.pages[0].regions[0].box.x=-1]){
    const v=snapshot(structuredClone(data));change(v);const r=await post(host,v);assert.equal(r.status,422);noArtifact(await r.json());
  }
  const inactive=await post(host,{status:'ABSTAIN'});assert.equal(inactive.status,422);noArtifact(await inactive.json());
  const huge=await post(host,{text:'x'.repeat(800000)});assert.equal(huge.status,413);noArtifact(await huge.json());
}));
test('cross-origin, missing origin and unrecognized HTTP methods cannot read or export private source data',async()=>withHost(async host=>{
  const data=await bootstrap(host);
  const foreign=await fetch(host.url+'bootstrap',{headers:{Origin:'https://foreign.invalid'}});assert.equal(foreign.status,403);
  const r=await post(host,snapshot(data),{Origin:'https://foreign.invalid'});assert.equal(r.status,403);noArtifact(await r.json());
  const missing=await fetch(host.url+'export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot(data))});assert.equal(missing.status,403);
  assert.equal((await fetch(host.url+'bootstrap',{method:'PUT'})).status,405);
}));
test('operator config loads bounded relative local files and rejects escapes and extra configuration fields',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'mtqc-private-host-'));
  try{
    const value=authoredHostRequest(),file=path.join(directory,'selection.json');
    await writeFile(path.join(directory,'source.pdf'),value.sourceBytes);await writeFile(path.join(directory,'canonical.png'),value.selections[0].canonicalImageBytes);
    const config={sourceFile:'source.pdf',selections:[{identity:value.selections[0].identity,frame:value.selections[0].frame,imageFile:'canonical.png'}]};
    await writeFile(file,JSON.stringify(config));const loaded=await loadPrivateReviewConfig(file);assert.equal(hash(loaded.sourceBytes),hash(value.sourceBytes));
    for(const mutate of [c=>c.sourceFile='../source.pdf',c=>c.sourceFile='https://foreign.invalid/a.pdf',c=>c.extra=true,c=>c.selections[0].imageFile=path.resolve(directory,'canonical.png')]){
      const c=structuredClone(config);mutate(c);await writeFile(file,JSON.stringify(c));await assert.rejects(loadPrivateReviewConfig(file));
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('invalid later intake page never opens a listening private host',async()=>{
  const request=authoredHostRequest();request.selections.push({...structuredClone(request.selections[0]),identity:{...request.selections[0].identity,caseId:'later',physicalPage:2}});
  await assert.rejects(startPrivateReviewHost(request),/intake/i);
});
test('private physical page2 remains local p1 and cannot export a physical-page alias',async()=>{
  const host=await startPrivateReviewHost(authoredSecondPageRequest());try{
    const data=await bootstrap(host);assert.equal(data.sourcePageCount,2);assert.equal(data.sourcePages[0].physicalPage,2);
    assert.equal(data.sourcePages[0].pageId,'p1');assert.equal(data.records[0].fragments[0].text,'PAGE 2');
    const accepted=await post(host,snapshot(data));assert.equal(accepted.status,200);
    const changed=snapshot(data);changed.sourcePages[0].physicalPage=1;const r=await post(host,changed);assert.equal(r.status,422);noArtifact(await r.json());
  }finally{await host.close();}
});
test('malformed UTF8 and journal sequence/time/extra fields are refused without source output',async()=>withHost(async host=>{
  const invalid=await fetch(host.url+'export',{method:'POST',headers:{Origin:new URL(host.url).origin,'Content-Type':'application/json'},body:new Uint8Array([0xff])});
  assert.equal(invalid.status,422);noArtifact(await invalid.json());
  const data=await bootstrap(host);
  for(const mutate of [j=>j.events[0].sequence=2,j=>j.events[0].offsetMs=-1,j=>j.events[0].pageIds=['p2'],j=>j.events[0].extra=true,
    j=>j.droppedStructuralActionCount=1,j=>j.recordedStructuralActionCount=0]){
    const value=snapshot(structuredClone(data));value.interactionJournal.events=[{sequence:1,kind:'update-region',origin:'review-ui',pageIds:['p1'],offsetMs:0}];
    value.interactionJournal.recordedStructuralActionCount=1;mutate(value.interactionJournal);const r=await post(host,value);assert.equal(r.status,422);noArtifact(await r.json());
  }
}));
test('malformed typed graph selections, relationships and nested reviews never become downloadable DRAFTs',async()=>withHost(async host=>{
  const data=await bootstrap(host);
  for(const mutate of [d=>d.selectedRegionIds=[{}],d=>d.selectedRegionIds=['missing'],
    d=>d.pages[0].edges=[{id:'x',type:'caption-of',from:'unknown',to:'unknown',status:'verified'}],
    d=>d.pages[0].edges=[{id:1,type:'alien',from:{},to:[],status:7}],
    d=>d.pages[0].regions[0].table={rowCount:-1,columnCount:null,cells:[{}],reviewed:true},
    d=>d.pages[0].regions[0].equationReview={sourceChecked:'yes'},
    d=>d.pages[0].regions[0].figureReview={decision:'labels-transcribed',labels:[{id:'label',text:1}],sourceChecked:true},
    d=>d.pages[0].regions[0].footnoteReview={decision:'alien',sourceChecked:true,standaloneReason:''},
    d=>d.pages[0].visualConcernReviews={'alien':{sourceChecked:true,decision:'regions-recorded',regionIds:['missing']}},
    d=>d.pages[0].issues=[{code:1,pageId:'p1',message:{}}]
  ]){const value=snapshot(structuredClone(data));mutate(value.document);const r=await post(host,value);assert.equal(r.status,422);noArtifact(await r.json());}
}));
test('well-formed incomplete nested reviews and incomplete observed journal retain DRAFT rather than invent readiness',async()=>withHost(async host=>{
  const value=snapshot(await bootstrap(host)),r=value.document.pages[0].regions[0];value.document.selectedRegionIds=[r.id];
  r.type='table';r.status='unresolved';r.table={rowCount:2,columnCount:2,reviewed:false,cells:[{id:'cell',row:0,column:0,rowSpan:1,colSpan:1,text:'',role:'blank',headerCellIds:[],blankReason:''}]};
  r.equationReview={sourceChecked:false};r.figureReview={decision:'labels-transcribed',labels:[{id:'label',text:''}],sourceChecked:false};
  r.footnoteReview={decision:'standalone',sourceChecked:false,standaloneReason:''};
  value.interactionJournal.captureStatus='incomplete';value.interactionJournal.droppedStructuralActionCount=2;
  const response=await post(host,value);assert.equal(response.status,200);const draft=await response.json();
  assert.equal(draft.document.pages[0].regions[0].status,'unresolved');assert.equal(draft.document.pages[0].regions[0].table.reviewed,false);
  assert.equal(draft.interactionJournal.captureStatus,'incomplete');assert.equal(draft.interactionJournal.droppedStructuralActionCount,2);assert.equal(draft.manualReview.durationSeconds,null);
}));
test('two draft tables preserve table-local c1-1 cell IDs and resolve cell-of within their target table',async()=>withHost(async host=>{
  const value=snapshot(await bootstrap(host)),p=value.document.pages[0],first=p.regions[0];first.type='table';first.status='unresolved';
  first.table={rowCount:1,columnCount:1,reviewed:false,cells:[{id:'c1-1',row:0,column:0,rowSpan:1,colSpan:1,text:'',role:'value',headerCellIds:[]}]};
  const second={...structuredClone(first),id:'p1-manual-table',fragmentIds:[],provenance:'manual-visual-transcription'};p.regions.push(second);
  p.edges=[first,second].map((r,i)=>({id:'cell-edge-'+i,type:'cell-of',from:'c1-1',to:r.id,status:'proposed'}));
  const response=await post(host,value);assert.equal(response.status,200);const draft=await response.json();
  assert.deepEqual(draft.document.pages[0].regions.map(r=>r.table.cells[0].id),['c1-1','c1-1']);
}));
