import {createPrivateReviewSnapshot} from '../web_demo/wwwroot/document-private-review-snapshot.mjs';
import {validPrivateDraftSchema} from './structure-private-draft-schema.mjs';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const typedLength=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'length').get;
const actions=new Set(['update-region','replace-text-regions','reorder','set-cells','set-equation','set-figure-labels','set-caption-link','set-footnote-review','update-edge','set-page-inventory','assess-page-concern','add-region','verify-reading-order','verify-footnote-links']);

// JSON-parsed bounded input only. These observations do not authenticate custody.
export function validPrivateDraftJournal(journal,pageIds){
  if(!exact(journal,['schemaVersion','sourceGeneration','actorAuthentication','timestampMeaning','captureStatus','recordedStructuralActionCount','droppedStructuralActionCount','events'])||
    journal.schemaVersion!==1||journal.sourceGeneration!==1||journal.actorAuthentication!=='unavailable'||
    journal.timestampMeaning!=='controller-monotonic-offset-ms'||!['complete','incomplete'].includes(journal.captureStatus)||
    !Array.isArray(journal.events)||journal.events.length>256||journal.recordedStructuralActionCount!==journal.events.length||
    !Number.isSafeInteger(journal.droppedStructuralActionCount)||journal.droppedStructuralActionCount<0||
    (journal.captureStatus==='complete'&&journal.droppedStructuralActionCount!==0)||JSON.stringify(journal).length>65536)return false;
  let previous=0;
  return journal.events.every((e,i)=>{
    if(!exact(e,['sequence','kind','origin','pageIds','offsetMs'])||e.sequence!==i+1||!actions.has(e.kind)||
      !['review-ui','programmatic-order-preview'].includes(e.origin)||!Array.isArray(e.pageIds)||e.pageIds.length<1||e.pageIds.length>2||
      new Set(e.pageIds).size!==e.pageIds.length||!e.pageIds.every(id=>pageIds.includes(id))||!Number.isFinite(e.offsetMs)||e.offsetMs<previous)return false;
    previous=e.offsetMs;return true;
  });
}

/** Capture actual portable JSON bytes, never a trusted registry/review receipt. */
export function capturePrivateReviewDraft(input){
  if(!(input instanceof Uint8Array))throw Error('Actual private draft bytes required');
  const length=typedLength.call(input);if(!length||length>1048576)throw Error('Private draft byte limit');
  const bytes=new Uint8Array(length);for(let i=0;i<length;i++)bytes[i]=input[i];
  const draft=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!exact(draft,['schemaVersion','artifactKind','status','actorAuthentication','sourcePageCount','renderer','sourcePages','previews','document','sourceGeneration','manualReview','interactionJournal'])||
    draft.schemaVersion!==1||draft.artifactKind!=='private-operator-review-draft'||draft.status!=='DRAFT'||draft.actorAuthentication!=='unavailable'||
    !Number.isSafeInteger(draft.sourcePageCount)||draft.sourcePageCount<1||draft.sourcePageCount>512||draft.sourceGeneration!==1||
    !exact(draft.renderer,['name','version','fragmentIds'])||draft.renderer.name!=='pdfjs-dist'||typeof draft.renderer.version!=='string'||
    draft.renderer.fragmentIds!=='pdfjs-native-items-local-v1'||
    !exact(draft.manualReview,['eventCapture','editCount','durationSeconds'])||draft.manualReview.eventCapture!=='unavailable'||draft.manualReview.editCount!==null||draft.manualReview.durationSeconds!==null)
    throw Error('Invalid private draft envelope');
  const captured=createPrivateReviewSnapshot({document:draft.document,sourcePages:draft.sourcePages,sourceGeneration:draft.sourceGeneration});
  if(captured.status!=='DRAFT'||!validPrivateDraftSchema(captured.document)||!validPrivateDraftJournal(draft.interactionJournal,captured.sourcePages.map(p=>p.pageId))||
    !Array.isArray(draft.previews)||draft.previews.length!==captured.sourcePages.length||
    !draft.previews.every((p,i)=>exact(p,['pageId','previewSha256'])&&p.pageId===captured.sourcePages[i].pageId&&digest(p.previewSha256)))throw Error('Invalid private draft content');
  return {bytes,draft};
}
