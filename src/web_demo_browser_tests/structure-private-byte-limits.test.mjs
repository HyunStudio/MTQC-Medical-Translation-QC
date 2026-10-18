import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {authoredHostRequest} from './private-host-controls.mjs';
import {loadPrivateReviewConfig,startPrivateReviewHost} from '../web_demo_evaluation/structure-private-review-host.mjs';
import {createSelectedPageReviewDraft} from '../web_demo_evaluation/structure-selected-page-intake.mjs';
import {createReviewedArtifactDraft,createReviewedBundleDraft} from '../web_demo_evaluation/structure-artifact-authoring.mjs';
import {createPrivateInteractionJournal} from '../web_demo/wwwroot/document-private-interaction-journal.mjs';
const MiB=1024*1024,hash=b=>createHash('sha256').update(b).digest('hex');

// Authored one-page PDF: unused uncompressed stream grows the whole original.
// Correct xref offsets; no original corpus pages, compressed resource stress or human truth.
function fullPdf(size){
  const content='BT /F1 12 Tf 30 200 Td (FULL ORIGINAL) Tj ET';
  function build(padding){
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${padding} >>\nstream\n${' '.repeat(padding)}\nendstream`];
    let text='%PDF-1.4\n';const offsets=[];
    objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${o}\nendobj\n`;});
    const xref=Buffer.byteLength(text);
    text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Uint8Array(Buffer.from(text));
  }
  let padding=size-1000,bytes;
  for(let i=0;i<4;i++){bytes=build(padding);if(bytes.length===size)return bytes;padding+=size-bytes.length;}
  throw Error('Authored PDF size did not settle');
}
function request(size){const r=authoredHostRequest();r.sourceBytes=fullPdf(size);r.selections[0].identity.sourceSha256=hash(r.sourceBytes);return r;}
const config=r=>({sourceFile:'source.pdf',selections:[{identity:r.selections[0].identity,frame:r.selections[0].frame,imageFile:'page.png'}]});
function noOutput(r){assert.equal(r.status,'ABSTAIN');for(const key of ['document','sourceBytes','pages','artifact','artifacts','observations','bundle','json'])assert.equal(Object.hasOwn(r,key),false,key);}
async function withFiles(r,run){
  const directory=await mkdtemp(path.join(tmpdir(),'mtqc-byte-control-'));
  try{await writeFile(path.join(directory,'source.pdf'),r.sourceBytes);await writeFile(path.join(directory,'page.png'),r.selections[0].canonicalImageBytes);
    const file=path.join(directory,'selection.json');await writeFile(file,JSON.stringify(config(r)));await run(file,directory);
  }finally{await rm(directory,{recursive:true,force:true});}
}
function artifactInput(r,document){return {selection:r.selections[0].identity,sourceBytes:r.sourceBytes,pageImageBytes:r.selections[0].canonicalImageBytes,pageId:'p1',document,
  checklist:[{id:'coverage',kind:'fragment-coverage'}],bindings:[{id:'coverage',reviewed:false}]};}

test('private whole original above10MiB is parsed and mapped from the same bytes without partial or authority claims',async()=>{
  const r=request(11*MiB),before=hash(r.sourceBytes);
  const intake=await createSelectedPageReviewDraft(r);assert.equal(intake.status,'DRAFT');
  assert.equal(intake.pages[0].nativeFragments[0].text,'FULL ORIGINAL');assert.equal(hash(intake.sourceBytes),before);
  const artifact=createReviewedArtifactDraft(artifactInput(r,intake.document));assert.equal(artifact.status,'DRAFT');
  assert.equal(artifact.artifact.sourceSha256,before);assert.equal(artifact.manualEditCount,null);
  await withFiles(r,async file=>assert.equal(hash((await loadPrivateReviewConfig(file)).sourceBytes),before));
  const host=await startPrivateReviewHost(r);
  try{
    const data=await (await fetch(host.url+'bootstrap')).json(),journal=createPrivateInteractionJournal({now:()=>1});journal.reset(1);
    const snapshot={status:'DRAFT',sourceGeneration:1,document:data.document,sourcePages:data.sourcePages,manualReview:data.manualReview,interactionJournal:journal.snapshot()};
    const mappings=[{caseId:r.selections[0].identity.caseId,checklist:[{id:'coverage',kind:'fragment-coverage'}],bindings:[{id:'coverage',reviewed:false}]}];
    const response=await fetch(host.url+'mapped-export',{method:'POST',headers:{Origin:new URL(host.url).origin,'Content-Type':'application/json'},body:JSON.stringify({snapshot,mappings})});
    assert.equal(response.status,200);const result=await response.json();assert.equal(result.status,'DRAFT');
    assert.equal(result.artifacts[0].sourceSha256,before);assert.equal(result.actorAuthentication,'unavailable');
    assert.equal(result.sourceEvidence.sourcePages[0].sourceRenderEquivalence,'unverified');assert.equal(result.manualEditCount,null);
    assert.ok(result.observations[0].items.every(i=>i.status==='unresolved'));
  }finally{await host.close();}
});

test('16MiB whole originals are inclusive;16MiB+1 is rejected by loader, intake and authoring with no output',async()=>{
  const r=request(16*MiB),small=request(1024),parsed=await createSelectedPageReviewDraft(small);assert.equal(parsed.status,'DRAFT');
  assert.equal(createReviewedArtifactDraft(artifactInput(r,parsed.document)).status,'DRAFT');
  await withFiles(r,async file=>assert.equal((await loadPrivateReviewConfig(file)).sourceBytes.length,16*MiB));
  assert.equal((await createSelectedPageReviewDraft(r)).status,'DRAFT');
  r.sourceBytes=fullPdf(16*MiB+1);r.selections[0].identity.sourceSha256=hash(r.sourceBytes);
  noOutput(await createSelectedPageReviewDraft(r));noOutput(createReviewedArtifactDraft(artifactInput(r,parsed.document)));
  await withFiles(r,async file=>assert.rejects(loadPrivateReviewConfig(file),{message:'Invalid local file size'}));
  await assert.rejects(startPrivateReviewHost(r));
});

test('canonical PNG bytes above10MiB remain refused even for the enlarged whole-PDF private boundary',async()=>{
  const r=request(1024),parsed=await createSelectedPageReviewDraft(r);assert.equal(parsed.status,'DRAFT');
  const padded=new Uint8Array(10*MiB+1);padded.set(r.selections[0].canonicalImageBytes);
  r.selections[0].canonicalImageBytes=padded;r.selections[0].identity.pageImageSha256=hash(padded);
  noOutput(await createSelectedPageReviewDraft(r));noOutput(createReviewedArtifactDraft(artifactInput(r,parsed.document)));
  await withFiles(r,async file=>assert.rejects(loadPrivateReviewConfig(file),{message:'Invalid local file size'}));
});

test('bundle truth bytes retain their10MiB bound rather than inheriting the PDF allowance',()=>{
  // Over-limit but otherwise valid authored JSON makes the byte cap observable.
  const small=request(1024),r=artifactInput(small,{schemaVersion:1,selectedRegionIds:[],pages:[{id:'p1',width:300,height:300,fragmentIds:[],regions:[],edges:[],issues:[]}]});
  const truth={status:'locked',cases:[{...r.selection,visualReview:{pass1Complete:true,pass2Complete:true},items:[{id:'coverage',kind:'fragment-coverage',expected:{fragmentCount:0}}]}]};
  const prefix=Buffer.from(JSON.stringify(truth)),truthBytes=new Uint8Array(10*MiB+1);truthBytes.fill(32);truthBytes.set(prefix);
  const manifest={status:'locked',truthSha256:hash(truthBytes),cases:[{caseId:r.selection.caseId,page:1,sourceSha256:r.selection.sourceSha256,pageImageSha256:r.selection.pageImageSha256}]};
  assert.equal(createReviewedBundleDraft({manifest:{...manifest,truthSha256:hash(prefix)},truthBytes:new Uint8Array(prefix),requests:[r]}).status,'DRAFT');
  noOutput(createReviewedBundleDraft({manifest,truthBytes,requests:[r]}));
});
