import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateInteractionJournal} from '../web_demo/wwwroot/document-private-interaction-journal.mjs';
const action=()=>({kind:'update-region',origin:'review-ui',pageIds:['p1']});

test('observed structural actions retain generation, origin, monotonic offsets and unknown human authority',()=>{
  let now=100;const journal=createPrivateInteractionJournal({now:()=>now});
  journal.reset(2);now=125;journal.record(action());
  now=150;journal.record({kind:'reorder',origin:'programmatic-order-preview',pageIds:['p1','p2']});
  const snapshot=journal.snapshot();
  assert.equal(snapshot.captureStatus,'complete');assert.equal(snapshot.sourceGeneration,2);
  assert.equal(snapshot.actorAuthentication,'unavailable');
  assert.equal(snapshot.recordedStructuralActionCount,2);assert.equal(snapshot.droppedStructuralActionCount,0);
  assert.deepEqual(snapshot.events,[{sequence:1,kind:'update-region',origin:'review-ui',pageIds:['p1'],offsetMs:25},
    {sequence:2,kind:'reorder',origin:'programmatic-order-preview',pageIds:['p1','p2'],offsetMs:50}]);
  assert.equal(Object.hasOwn(snapshot,'manualEditCount'),false);
  assert.equal(Object.hasOwn(snapshot,'manualReviewSeconds'),false);
});
test('caller packet and returned snapshot cannot substitute journal history',()=>{
  const journal=createPrivateInteractionJournal({now:()=>1});journal.reset(1);
  const packet=action();journal.record(packet);packet.pageIds[0]='p2';packet.kind='reorder';
  const result=journal.snapshot();assert.equal(result.events.length,1);
  result.events[0].pageIds[0]='p2';result.events[0].kind='reorder';
  assert.equal(journal.snapshot().events[0].pageIds[0],'p1');
  assert.equal(journal.snapshot().events[0].kind,'update-region');
});
test('source retirement and replacement reset generation-scoped history rather than counting initialization',()=>{
  const journal=createPrivateInteractionJournal({now:()=>1});journal.reset(1);journal.record(action());
  journal.reset(null);journal.record(action());
  assert.equal(journal.snapshot().captureStatus,'inactive');assert.equal(journal.snapshot().sourceGeneration,null);
  journal.reset(3);const result=journal.snapshot();
  assert.equal(result.captureStatus,'complete');assert.equal(result.recordedStructuralActionCount,0);
  assert.equal(result.sourceGeneration,3);assert.deepEqual(result.events,[]);
});
test('clock exception, nonfinite or reversed offsets mark incomplete capture without throwing into editing',()=>{
  for(const fault of ['throw',NaN,Infinity,99]){
    let now=100;const journal=createPrivateInteractionJournal({now:()=>{if(now==='throw')throw Error('clock');return now;}});
    journal.reset(1);now=fault;assert.doesNotThrow(()=>journal.record(action()));
    const result=journal.snapshot();assert.equal(result.captureStatus,'incomplete');
    assert.equal(result.droppedStructuralActionCount,1);assert.deepEqual(result.events,[]);
  }
});
test('bounded history preserves a disclosed partial trace instead of silently reporting complete zero work',()=>{
  const journal=createPrivateInteractionJournal({now:()=>1});journal.reset(1);
  for(let n=0;n<300;n++)journal.record(action());
  const result=journal.snapshot();assert.equal(result.captureStatus,'incomplete');
  assert.equal(result.recordedStructuralActionCount,256);assert.equal(result.droppedStructuralActionCount,44);
  assert.equal(result.events[0].sequence,1);assert.equal(result.events.at(-1).sequence,256);
  assert.ok(JSON.stringify(result).length<=65536);
});
test('getters, hidden packet fields, foreign origins/pages and selection kinds cannot manufacture structural records',()=>{
  let reads=0;
  for(const mutate of [
    value=>Object.defineProperty(value,'kind',{enumerable:true,get(){reads++;return 'update-region';}}),
    value=>Object.defineProperty(value.pageIds,'0',{enumerable:true,get(){reads++;return 'p1';}}),
    value=>Object.defineProperty(value,'human',{value:true}),
    value=>{value.pageIds.extra='lossy';},value=>{value.origin='human-certified';},
    value=>{value.pageIds=['p3'];},value=>{value.pageIds=['p1','p1'];},value=>{value.kind='set-selection';}
  ]){const journal=createPrivateInteractionJournal({now:()=>1});journal.reset(1);
    const value=action();mutate(value);journal.record(value);
    const result=journal.snapshot();assert.equal(result.captureStatus,'incomplete');assert.equal(result.events.length,0);
  }
  assert.equal(reads,0);
});
