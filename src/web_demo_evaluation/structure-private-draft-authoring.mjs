import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {capturePrivateReviewDraft} from './structure-private-draft-envelope.mjs';
import {createSelectedPageReviewDraft} from './structure-selected-page-intake.mjs';
import {createReviewedArtifactDraft} from './structure-artifact-authoring.mjs';
const abstain=reason=>({status:'ABSTAIN',reason});
const nonempty=v=>typeof v==='string'&&!!v.trim();
/** Source-linked target inventory and blank ID bindings; declared status is not human authority. */
export async function createPrivateDraftMappingReview(input){
  try{
    const request=fields(input,['draftBytes','intakeRequest','checklists']);
    if(!dataOnly(request.checklists)||JSON.stringify(request.checklists).length>262144)return abstain('INVALID_PRIVATE_REVIEW_CHECKLISTS');
    const checklists=structuredClone(request.checklists);
    if(!Array.isArray(checklists)||!checklists.length||checklists.length>2)return abstain('INVALID_PRIVATE_REVIEW_CHECKLISTS');
    const mappings=checklists.map(raw=>{
      const c=fields(raw,['caseId','checklist']);
      if(!Array.isArray(c.checklist)||!c.checklist.length||c.checklist.length>128)throw Error('Bounded checklist required');
      return {caseId:c.caseId,checklist:c.checklist,bindings:c.checklist.map(item=>({id:item.id,reviewed:false}))};
    });
    // Existing importer synchronously captures draft/mapping/C1 bytes before its first await.
    const reviewed=await createReviewedArtifactsFromPrivateDraft({draftBytes:request.draftBytes,intakeRequest:request.intakeRequest,mappings});
    if(reviewed.status!=='DRAFT')return abstain(`PRIVATE_MAPPING_REVIEW_REJECTED:${reviewed.reason}`);
    const cases=reviewed.artifacts.map(artifact=>{
      const page=artifact.document.pages.find(p=>p.id===artifact.pageId);
      const checklist=mappings.find(m=>m.caseId===artifact.caseId).checklist;
      return {caseId:artifact.caseId,physicalPage:artifact.physicalPage,pageId:artifact.pageId,
        width:page.width,height:page.height,nativeFragmentIds:page.fragmentIds,
        regions:page.regions.map(region=>({regionId:region.id,type:region.type,declaredStatus:region.status,
          box:region.box,text:region.text,fragmentIds:region.fragmentIds,
          tableCells:region.table?.cells||[],declaredTableReviewed:region.table?.reviewed??null,
          figureLabels:region.figureReview?.labels||[],declaredFigureSourceChecked:region.figureReview?.sourceChecked??null})),
        edges:page.edges,issues:page.issues,checklist,bindings:artifact.bindings};
    });
    const result={status:'DRAFT',cases,observations:reviewed.observations,sourceEvidence:reviewed.sourceEvidence,
      privateDraftSha256:reviewed.privateDraftSha256,actorAuthentication:'unavailable',manualEditCount:null,manualReviewSeconds:null};
    const json=JSON.stringify(result);
    if(json.length>1048576||Buffer.byteLength(json)>1048576)return abstain('OVERSIZE_PRIVATE_MAPPING_REVIEW');
    return structuredClone(result);
  }catch{return abstain('INVALID_PRIVATE_MAPPING_REVIEW_INPUT');}
}
function fields(value,keys){
  if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Plain request required');
  const ds=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(ds).length!==keys.length||!keys.every(k=>ds[k]?.enumerable&&Object.hasOwn(ds[k],'value')))throw Error('Exact data fields required');
  return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
}
function dataOnly(value,seen=new Set(),budget={nodes:0},depth=0){
  if(++budget.nodes>32768||depth>64)return false;
  if(value===null||['string','boolean'].includes(typeof value))return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(typeof value!=='object'||seen.has(value))return false;
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(!(array?[Array.prototype,null]:[Object.prototype,null]).includes(prototype))return false;
  const ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(ds),length=array?ds.length?.value:0;
  if(array&&(!Number.isSafeInteger(length)||length>32768||keys.length!==length+1||keys.some(k=>k!=='length'&&(typeof k!=='string'||!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=length))))return false;
  seen.add(value);const ok=keys.every(k=>typeof k==='string'&&Object.hasOwn(ds[k],'value')&&(ds[k].enumerable||(array&&k==='length'))&&dataOnly(ds[k].value,seen,budget,depth+1));seen.delete(value);return ok;
}

/** Memory-only reparse and mapped Task A DRAFTs; no source/human authority or score. */
export async function createReviewedArtifactsFromPrivateDraft(input){
  try{
    const request=fields(input,['draftBytes','intakeRequest','mappings']);
    // Capture every portable/mapping value before the C1 parser's first await.
    const {bytes,draft}=capturePrivateReviewDraft(request.draftBytes);
    if(!dataOnly(request.mappings)||JSON.stringify(request.mappings).length>262144)return abstain('INVALID_PRIVATE_DRAFT_MAPPINGS');
    const mappings=structuredClone(request.mappings);
    if(!Array.isArray(mappings)||mappings.length!==draft.sourcePages.length)return abstain('PRIVATE_DRAFT_CASE_SET_MISMATCH');
    let work=0;const documentLength=JSON.stringify(draft.document).length;
    const cases=new Map();
    for(const raw of mappings){
      const m=fields(raw,['caseId','checklist','bindings']);
      if(!nonempty(m.caseId)||cases.has(m.caseId)||!draft.sourcePages.some(p=>p.caseId===m.caseId)||!Array.isArray(m.checklist)||!m.checklist.length||!Array.isArray(m.bindings))return abstain('PRIVATE_DRAFT_CASE_SET_MISMATCH');
      if(m.checklist.length>128)return abstain('OVERSIZE_PRIVATE_DRAFT_MAPPINGS');
      work+=m.checklist.length*(documentLength+JSON.stringify(m.bindings).length+512);
      if(work>8388608)return abstain('OBSERVATION_MATERIALIZATION_LIMIT');cases.set(m.caseId,m);
    }
    const intake=await createSelectedPageReviewDraft(request.intakeRequest);
    if(intake.status!=='DRAFT')return abstain(`PRIVATE_DRAFT_INTAKE_REJECTED:${intake.reason}`);
    const sources=intake.pages.map(p=>({...p.identity,pageId:p.pageId,pdfUserUnit:p.pdfUserUnit,frame:p.frame,nativeFragmentIds:p.nativeFragments.map(f=>f.id),sourceRenderEquivalence:p.sourceRenderEquivalence,canonicalFragmentCrosswalk:p.canonicalFragmentCrosswalk}));
    const previews=intake.pages.map(p=>({pageId:p.pageId,previewSha256:p.previewSha256}));
    if(intake.sourcePageCount!==draft.sourcePageCount||!isDeepStrictEqual(intake.renderer,draft.renderer)||
      !isDeepStrictEqual(sources,draft.sourcePages)||!isDeepStrictEqual(previews,draft.previews))return abstain('PRIVATE_DRAFT_SOURCE_REPARSE_MISMATCH');
    const artifacts=[],observations=[];
    for(let i=0;i<intake.pages.length;i++){
      const p=intake.pages[i],m=cases.get(p.identity.caseId);if(!m)return abstain('PRIVATE_DRAFT_CASE_SET_MISMATCH');
      const result=createReviewedArtifactDraft({selection:p.identity,sourceBytes:intake.sourceBytes,pageImageBytes:p.canonicalImageBytes,
        pageId:p.pageId,document:draft.document,checklist:m.checklist,bindings:m.bindings});
      if(result.status!=='DRAFT')return abstain(`PRIVATE_DRAFT_MAPPING_REJECTED:${i}:${result.reason}`);
      artifacts.push(result.artifact);observations.push({caseId:p.identity.caseId,items:result.observations});
    }
    const result={status:'DRAFT',artifacts,observations,actorAuthentication:'unavailable',manualEditCount:null,manualReviewSeconds:null,
      privateDraftSha256:createHash('sha256').update(bytes).digest('hex'),sourceEvidence:{sourcePages:sources,previews,renderer:intake.renderer,sourcePageCount:intake.sourcePageCount,interactionJournal:draft.interactionJournal}};
    const json=JSON.stringify(result);if(json.length>1048576||Buffer.byteLength(json)>1048576)return abstain('OVERSIZE_PRIVATE_DRAFT_ARTIFACTS');
    return structuredClone(result);
  }catch{return abstain('INVALID_PRIVATE_DRAFT_INPUT_OR_MAPPING');}
}
