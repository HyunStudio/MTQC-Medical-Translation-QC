import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { restoreRegisteredSourceStructure } from '../web_demo/wwwroot/document-registered-source.mjs';

// Authored contract controls, not an independently adjudicated real PDF.
const bytes = new TextEncoder().encode('operator-pinned synthetic source bytes');
const hash = createHash('sha256').update(bytes).digest('hex');
const request = () => ({ key: 'source-a', version: '1', sourceBytes: bytes.slice() });
function graph() {
  const region = (id, type, text, y) => ({ id, type, text,
    box: { x: 20, y, width: 120, height: 20 }, fragmentIds: [id+'-f'],
    provenance: 'manual-visual-transcription', status: 'verified' });
  const regions = [region('body','paragraph','Observed body',20),region('table','table','Table 1',50),
    region('figure','figure','Figure 1',80)];
  regions[1].table = { rowCount: 1, columnCount: 1, reviewed: true, cells: [
    { id: 'c1', row: 0, column: 0, rowSpan: 1, colSpan: 1, role: 'value', text: '12', headerCellIds: [] }] };
  regions[2].figureReview = { sourceChecked: true, decision: 'labels-transcribed',
    labels: [{ id: 'label1', text: 'Artery', box: { x: 25, y: 82, width: 30, height: 10 } }] };
  return { schemaVersion: 1, selectedRegionIds: [], pages: [{ id: 'p1', width: 600, height: 800,
    fragmentIds: regions.flatMap(r=>r.fragmentIds), regions,
    edges: [{ id:'e1', type:'reading-next',from:'body',to:'table',status:'verified' },
      { id:'e2',type:'reading-next',from:'table',to:'figure',status:'verified' }],
    issues: [], visualInventoryConfirmed: true }] };
}
const record = () => ({ version: '1', sourceSha256: hash, document: graph() });
const resolver = value => async (key,version) => key==='source-a' && version==='1' ? value : null;
function abstains(result, reason) {
  assert.equal(result.status,'ABSTAIN');
  assert.equal(result.reason,reason);
  assert(!Object.hasOwn(result,'document'));
  assert(!Object.hasOwn(result,'output'));
}
test('missing registered provider returns a concrete abstention without output',async()=>{
  abstains(await restoreRegisteredSourceStructure(request()),'SOURCE_PROVIDER_UNAVAILABLE');
});
test('unknown source, stale version, and changed actual bytes cannot emit output',async()=>{
  abstains(await restoreRegisteredSourceStructure(request(),resolver(null)),'SOURCE_NOT_REGISTERED');
  const old=record();old.version='0';
  abstains(await restoreRegisteredSourceStructure(request(),resolver(old)),'SOURCE_VERSION_MISMATCH');
  const wrong=request();wrong.sourceBytes[0]^=1;
  abstains(await restoreRegisteredSourceStructure(wrong,resolver(record())),'SOURCE_HASH_MISMATCH');
});
test('resolver errors fail closed without returning a partial artifact',async()=>{
  abstains(await restoreRegisteredSourceStructure(request(),async()=>{throw new Error('offline');}),'SOURCE_PROVIDER_ERROR');
});
test('complete registered graph preserves table cells, figure labels and reading edges',async()=>{
  const source=record();const result=await restoreRegisteredSourceStructure(request(),resolver(source));
  assert.equal(result.status,'RESTORED');
  assert.deepEqual(result.document,source.document);
  assert.equal(result.sourceSha256,hash);
  result.document.pages[0].regions[1].table.cells[0].text='changed';
  assert.equal(source.document.pages[0].regions[1].table.cells[0].text,'12');
});
test('unverified table, figure labels, or reading edge return no artifact',async()=>{
  for(const mutate of [g=>g.pages[0].regions[1].table.reviewed=false,
    g=>g.pages[0].regions[2].figureReview.sourceChecked=false,
    g=>g.pages[0].edges[0].status='proposed']){
    const source=record();mutate(source.document);
    abstains(await restoreRegisteredSourceStructure(request(),resolver(source)),'REGISTERED_STRUCTURE_UNVERIFIED');
  }
});
test('nonfinite geometry and duplicate cross-page identity are not serialized away',async()=>{
  const invalid=record();invalid.document.pages[0].regions[0].box.x=NaN;
  abstains(await restoreRegisteredSourceStructure(request(),resolver(invalid)),'REGISTERED_STRUCTURE_INVALID');
  const duplicate=record();const p=structuredClone(duplicate.document.pages[0]);p.id='p2';
  p.edges.forEach(edge=>{edge.id+='-p2';});duplicate.document.pages.push(p);
  abstains(await restoreRegisteredSourceStructure(request(),resolver(duplicate)),'REGISTERED_STRUCTURE_UNVERIFIED');
});
test('source bytes and requested identity are snapshotted before resolver awaits',{ timeout: 2000 },async()=>{
  const input=request();let release;const wait=new Promise(resolve=>{release=resolve;});let arrived;
  const ready=new Promise(resolve=>{arrived=resolve;});
  const pending=restoreRegisteredSourceStructure(input,async(key,version)=>{arrived();await wait;assert.equal(key,'source-a');assert.equal(version,'1');return record();});
  await ready;input.sourceBytes.fill(0);input.key='other';input.version='9';release();
  const result=await pending;assert.equal(result.status,'RESTORED');assert.equal(result.sourceSha256,hash);
});

test('truthy non-boolean review flags cannot establish source verification',async()=>{
  for(const mutate of [g=>g.pages[0].regions[1].table.reviewed=1,
    g=>g.pages[0].regions[2].figureReview.sourceChecked='false']){
    const source=record();mutate(source.document);
    abstains(await restoreRegisteredSourceStructure(request(),resolver(source)),'REGISTERED_STRUCTURE_UNVERIFIED');
  }
});
test('requests with no actual bytes or more than two registered pages fail closed',async()=>{
  const empty=request();empty.sourceBytes=new Uint8Array();
  abstains(await restoreRegisteredSourceStructure(empty,resolver(record())),'INVALID_SOURCE_REQUEST');
  const source=record();source.document.pages.push({...graph().pages[0],id:'p2'},{...graph().pages[0],id:'p3'});
  abstains(await restoreRegisteredSourceStructure(request(),resolver(source)),'REGISTERED_STRUCTURE_INVALID');
});

test('caller slice and iterator overrides cannot substitute different source bytes',async()=>{
  const input=request(); input.sourceBytes[0]^=1;
  input.sourceBytes.slice=()=>bytes.slice();
  input.sourceBytes[Symbol.iterator]=bytes[Symbol.iterator].bind(bytes);
  abstains(await restoreRegisteredSourceStructure(input,resolver(record())),'SOURCE_HASH_MISMATCH');
});
test('unknown region and edge schemas cannot receive a restored artifact',async()=>{
  for(const mutate of [g=>g.pages[0].regions[0].type='table-unknown',
    g=>delete g.pages[0].regions[0].type,g=>g.pages[0].regions[0].id=7,
    g=>g.pages[0].regions[0].text=42,
    g=>g.pages[0].edges.push({id:'bad',type:'made-up',from:'body',to:'body',status:'verified'})]){
    const source=record();mutate(source.document);
    abstains(await restoreRegisteredSourceStructure(request(),resolver(source)),'REGISTERED_STRUCTURE_INVALID');
  }
});
test('returned selection must be a unique array of known region identities',async()=>{
  for(const selection of [['absent'],{id:'body'},['body','body'],[7]]){
    const source=record();source.document.selectedRegionIds=selection;
    abstains(await restoreRegisteredSourceStructure(request(),resolver(source)),'REGISTERED_STRUCTURE_INVALID');
  }
});
test('registered page dimensions must fit the actual rounded canvas limit',async()=>{
  const source=record();source.document.pages[0].width=3000.1;source.document.pages[0].height=3999.8;
  abstains(await restoreRegisteredSourceStructure(request(),resolver(source)),'REGISTERED_STRUCTURE_INVALID');
});

test('nested table and figure payloads require typed unique identities',async()=>{
  for(const mutate of [g=>{const t=g.pages[0].regions[1].table;t.columnCount=2;
      t.cells[0].column=1;t.cells[0].headerCellIds='h';
      t.cells.push({id:'h',row:0,column:0,rowSpan:1,colSpan:1,role:'header',text:'Value',headerCellIds:[]});},
    g=>g.pages[0].regions[2].figureReview.labels[0].id=7,
    g=>g.pages[0].regions[2].figureReview.labels.push({...g.pages[0].regions[2].figureReview.labels[0]}),
    g=>{g.pages[0].regions[2].figureReview={sourceChecked:true,decision:'no-internal-text',labels:''};}]){
    const source=record();mutate(source.document);
    abstains(await restoreRegisteredSourceStructure(request(),resolver(source)),'REGISTERED_STRUCTURE_INVALID');
  }
});
test('duplicate relationship IDs cannot create an ambiguously editable result',async()=>{
  const source=record();source.document.pages[0].edges[1].id='e1';
  abstains(await restoreRegisteredSourceStructure(request(),resolver(source)),'REGISTERED_STRUCTURE_INVALID');
});
