import {getRasterFrameSourceEvidence,isRasterFrameSourceEvidenceCurrent} from './document-horizontal-rules.mjs';
import {ruleMetadataStamp} from './document-raster-regions.mjs';
import {isTableReferenceText} from './document-table-grid.mjs';
const bindings=new WeakMap(),version='pdfjs-raster-caption-envelope-v1';
const valid=b=>b&&[b.x,b.y,b.width,b.height].every(Number.isFinite)&&b.width>0&&b.height>0;
const contains=(a,b)=>valid(a)&&valid(b)&&b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width&&b.y+b.height<=a.y+a.height;
const touches=(a,b)=>a.x<=b.x+b.width&&a.x+a.width>=b.x&&a.y<=b.y+b.height&&a.y+a.height>=b.y;
const union=parts=>{const x=Math.min(...parts.map(p=>p.x)),y=Math.min(...parts.map(p=>p.y));return{x,y,width:Math.max(...parts.map(p=>p.x+p.width))-x,height:Math.max(...parts.map(p=>p.y+p.height))-y};};
const marker=r=>/^\s*(?:FIGURE\s*\d+\b|Fig\.\s*\d+\b)/i.test(r.text);
// Only tentative source correspondence. Neither source ink completeness nor
// label/plot semantics or native reading authority is inferred here.
export function collectRasterFigureEnvelopes({OPS,operatorList,viewport,ruleHints,verticalRuleHints,regionalRasterHints,nativeRegions,pageSource}={}){
 const fail=()=>({version,candidates:[],unsupported:['unresolved-source-frame']});
 try{
  const evidence=getRasterFrameSourceEvidence(ruleHints,verticalRuleHints,regionalRasterHints,{OPS,operatorList,viewport});
  if(!evidence||!pageSource||pageSource.width!==Math.ceil(evidence.width)||pageSource.height!==Math.ceil(evidence.height)||!Array.isArray(pageSource.fragments)||!Array.isArray(nativeRegions)||!nativeRegions.length)return fail();
  const snapshot=ruleMetadataStamp([pageSource.fragments,pageSource.width,pageSource.height]),nativeStamp=ruleMetadataStamp(nativeRegions);if(snapshot===null||nativeStamp===null)return fail();
  const assigned=new Set();
  if(!nativeRegions.every(r=>{
   if(!r||typeof r.id!=='string'||!Array.isArray(r.fragmentIndices)||!r.fragmentIndices.length||!valid(r.box))return false;
   const parts=[];for(const i of r.fragmentIndices){if(!Number.isSafeInteger(i)||i<0||i>=pageSource.fragments.length||assigned.has(i))return false;const p=pageSource.fragments[i];if(!valid(p)||typeof p.text!=='string')return false;assigned.add(i);parts.push(p);}
   const b=union(parts);return r.text===parts.map(p=>p.text).join(' ')&&['x','y','width','height'].every(k=>r.box[k]===b[k]);
  })||assigned.size!==pageSource.fragments.length||new Set(nativeRegions.map(r=>r.id)).size!==nativeRegions.length)return fail();
  const drafts=[];
  for(const frame of evidence.frames){
   const images=regionalRasterHints.placements.filter(p=>touches(frame.box,p.box));if(images.length!==1||!contains(frame.box,images[0].box))continue;
   const image=images[0],native=nativeRegions.filter(r=>touches(frame.box,r.box)),markers=native.filter(marker);
   if(markers.length!==1||!native.length||native.some(r=>!contains(frame.box,r.box)||r.kind==='table'||(/^\s*TABLE\s+\d+\b/i.test(r.text)&&!isTableReferenceText(r.text))))continue;
   const first=markers[0],ordered=[...native].sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x);
   if(ordered[0]!==first||native.some(r=>r.box.y<image.box.y+image.box.height))continue;
   let ambiguous=false;
   for(let i=1;i<ordered.length;i++){const a=ordered[i-1].box,b=ordered[i].box;if(b.y<a.y+a.height||b.x>=a.x+a.width||a.x>=b.x+b.width)ambiguous=true;}
   const positions=ordered.map(r=>nativeRegions.indexOf(r));if(positions.some((p,i)=>i&&p!==positions[i-1]+1))ambiguous=true;
   // Every other touching paint must abstain, including another frame. Unknown
   // spatial paint cannot be safely excluded, even if it might be elsewhere.
   if(ambiguous||evidence.paints.some(p=>p.operatorIndex!==frame.operatorIndex&&(!p.box||touches(frame.box,p.box))))continue;
   drafts.push({frameOperatorIndex:frame.operatorIndex,imageOperatorIndex:image.operatorIndex,frameBox:{...frame.box},bodyBox:{...image.projectedPaintBox},rawSourceBox:{...image.rawSourceBox},clipBox:{...image.clipBox},captionFragmentIndices:ordered.flatMap(r=>r.fragmentIndices),captionRegionIds:ordered.map(r=>r.id),status:'unresolved',sourceReviewed:false,visibleInk:'unverified',labelSemantics:'unrecovered'});
  }
  // Any shared image or caption ownership makes competing envelopes ambiguous.
  const candidates=drafts.filter(d=>!drafts.some(other=>other!==d&&(other.imageOperatorIndex===d.imageOperatorIndex||other.captionFragmentIndices.some(i=>d.captionFragmentIndices.includes(i)))));
  const result={version,candidates,unsupported:[]};bindings.set(result,{evidence,pageSource:{...pageSource},snapshot,nativeRegions,nativeStamp,result:ruleMetadataStamp(result)});return result;
 }catch{return fail();}
}
export function getRasterFigureCandidatesForPage(result,{fragments,width,height}={}){
 try{const b=bindings.get(result);if(!b||!isRasterFrameSourceEvidenceCurrent(b.evidence)||b.pageSource.fragments!==fragments||b.pageSource.width!==width||b.pageSource.height!==height||b.snapshot!==ruleMetadataStamp([fragments,width,height])||b.nativeStamp!==ruleMetadataStamp(b.nativeRegions)||b.result!==ruleMetadataStamp(result))return[];return structuredClone(result.candidates);}catch{return[];}
}
