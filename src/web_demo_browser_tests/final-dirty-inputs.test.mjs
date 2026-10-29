import test from 'node:test';
import assert from 'node:assert/strict';
import {createFigureTranslationSheet, readFigureTranslationSheet} from '../web_demo/wwwroot/document-figure-translation-sheet.mjs';
import {handoffRestoredReview} from '../web_demo/wwwroot/document-restored-review.mjs';

const binding = {sourceSha256:'a'.repeat(64), width:100, height:100, targetLanguage:'ko'};
const labels = [{id:'label-1', sourceText:'Dose 2 mg', sourceBox:{x:1,y:1,width:20,height:10},
  figureCrop:{x:0,y:0,width:100,height:100}, targetText:''}];
const translated = () => {
  const sheet = createFigureTranslationSheet(binding, labels);
  sheet.labels[0].targetText = '용량 2 mg';
  return sheet;
};

test('figure sheet refuses stale source identity, reordered or injected fields without changing existing labels', () => {
  const original = structuredClone(labels);
  for (const change of [s=>s.source.sourceSha256='b'.repeat(64), s=>s.targetLanguage='es',
    s=>s.labels[0].sourceText='Dose 3 mg', s=>s.labels[0].sourceBox.x=2,
    s=>s.labels[0].figureCrop.width=99, s=>s.labels[0].reviewed=true,
    s=>s.labels.push(structuredClone(s.labels[0])), s=>s.extra=true]) {
    const sheet = translated(); change(sheet);
    assert.throws(()=>readFigureTranslationSheet(sheet,binding,labels));
    assert.deepEqual(labels,original);
  }
});

test('figure sheet rejects empty, control, oversized, literal-changing and ill-formed Unicode targets', () => {
  for (const target of ['', ' ', '용량 2 mg\u0000', 'x'.repeat(3001)+' 2 mg',
    '용량 3 mg', '용량 2 kg', '용량 2 mg\uD800', '\uDC00용량 2 mg']) {
    const sheet=translated();sheet.labels[0].targetText=target;
    assert.throws(()=>readFigureTranslationSheet(sheet,binding,labels), `Accepted invalid target ${JSON.stringify(target)}`);
  }
});

test('figure sheet preserves readable Unicode and markup as literal target data, never grants source review', () => {
  const input=structuredClone(labels);input[0].sourceText='<img onerror="alert()"> Dose 2 mg';
  const sheet=createFigureTranslationSheet(binding,input);sheet.labels[0].targetText='<img onerror="alert()"> 용량 2 mg 🧪';
  assert.deepEqual(readFigureTranslationSheet(sheet,binding,input), ['<img onerror="alert()"> 용량 2 mg 🧪']);
  assert.equal(Object.hasOwn(labels[0],'reviewed'),false);
  assert.equal(labels[0].targetText,'');
});

test('figure sheet refuses duplicate labels and out-of-frame or nonfinite source geometry', () => {
  for (const change of [ls=>ls.push(structuredClone(ls[0])), ls=>ls[0].sourceBox.x=-1,
    ls=>ls[0].sourceBox.width=Infinity, ls=>ls[0].figureCrop.width=101]) {
    const input=structuredClone(labels);change(input);
    assert.throws(()=>createFigureTranslationSheet(binding,input));
  }
});

test('restored review copies both documents and never overwrites a later manual selection', async () => {
  const source=new Uint8Array([1,2]),draft=new Uint8Array([3,4]);let callbacks,release;
  let selections=0,current=true;
  const pending=handoffRestoredReview({bytes:draft,originalBytes:source,
    current:()=>current, selectPair:(s,d)=>{selections++;assert.deepEqual([...s],[1,2]);assert.deepEqual([...d],[3,4]);},
    load:async (bytes,reserve)=>{callbacks=reserve;assert.deepEqual([...bytes],[3,4]);reserve();await new Promise(r=>release=r);},
    audit:async ()=>{}});
  source.fill(9);draft.fill(9);callbacks();assert.equal(selections,1);
  current=false;release();assert.equal(await pending,false);assert.equal(selections,1);
});

test('failed restored review decoding does not claim a successful handoff', async () => {
  let selected=false;
  await assert.rejects(handoffRestoredReview({bytes:new Uint8Array([3]),originalBytes:new Uint8Array([1]),
    current:()=>true,selectPair:()=>selected=true,load:async()=>{throw Error('invalid DOCX');},audit:async()=>{}}), /invalid DOCX/);
  assert.equal(selected,false);
});

test('fulfilled loader refusal cannot select a Word review pair or claim a completed handoff', async () => {
  for (const result of [false, undefined]) {
    let selected=false;
    await assert.rejects(handoffRestoredReview({bytes:new Uint8Array([3]),originalBytes:new Uint8Array([1]),
      current:()=>true,selectPair:()=>selected=true,load:async()=>result,audit:async()=>{}}), /held|load/i);
    assert.equal(selected,false);
  }
});

test('explicit successful loading selects the original and draft exactly once', async () => {
  let count=0;
  assert.equal(await handoffRestoredReview({bytes:new Uint8Array([3]),originalBytes:new Uint8Array([1]),
    current:()=>true,selectPair:()=>count++,load:async()=>true,audit:async()=>{}}),true);
  assert.equal(count,1);
});
