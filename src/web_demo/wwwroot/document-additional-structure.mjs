import {recoverReadingOrder} from './document-layout.mjs';
import {analyzeMultipleRuledTables} from './document-multiple-ruled-tables.mjs';
import {collectCompoundFigureEnvelopes,getCompoundFigureCandidatesForPage} from './document-vector-figure-envelope.mjs';
import {collectRasterFigureEnvelopes,getRasterFigureCandidatesForPage} from './document-raster-figure-envelope.mjs';
import {isTableReferenceText} from './document-table-grid.mjs';

const union=items=>{const x=Math.min(...items.map(p=>p.x)),y=Math.min(...items.map(p=>p.y));return {x,y,width:Math.max(...items.map(p=>p.x+p.width))-x,height:Math.max(...items.map(p=>p.y+p.height))-y};};
const sourceIds=(page,indices)=>indices.map(i=>`${page.id}-f${i}`);
const ownedRegions=(page,ids,held=()=>{})=>{
 const hold=phase=>{held(phase);return null;};
 const set=new Set(ids),regions=page.regions.filter(r=>r.fragmentIds.some(id=>set.has(id)));
 if(!regions.length)return hold('region-ownership');
 if(regions.some(r=>r.status==='verified'||r.table?.cells?.length))return hold('protected');
 if(regions.some(r=>r.fragmentIds.some(id=>!set.has(id))))return hold('region-ownership');
 const assigned=regions.flatMap(r=>r.fragmentIds);
 if(assigned.length!==ids.length||new Set(assigned).size!==ids.length||ids.some(id=>!assigned.includes(id)))return hold('region-ownership');
 const regionIds=new Set(regions.map(r=>r.id));
 if(page.edges.some(e=>e.type!=='reading-next'&&(regionIds.has(e.from)||regionIds.has(e.to))))return hold('protected');
 return regions;
};
function finish(page,regions,removed,newEdges,newIssues){
 const removedIds=new Set(removed.map(r=>r.id));
 const semantic=page.edges.filter(e=>e.type!=='reading-next'&&!removedIds.has(e.from)&&!removedIds.has(e.to));
 const reading=regions.slice(1).map((r,i)=>({id:`${page.id}-source-reading-${i}`,type:'reading-next',from:regions[i].id,to:r.id,status:'proposed'}));
 if(new Set(regions.map(r=>r.id)).size!==regions.length||new Set([...reading,...semantic,...newEdges].map(e=>e.id)).size!==reading.length+semantic.length+newEdges.length)return page;
 return {...page,regions,edges:[...reading,...semantic,...newEdges],issues:[...page.issues.filter(i=>!removedIds.has(i.regionId)),...newIssues],visualInventoryConfirmed:false};
}
export function collectPageCompoundFigureHints({OPS,operatorList,viewport,pdfjsVersion,fragments,width,height}){
 const nativeRegions=recoverReadingOrder(fragments,width,'auto').lines.map((line,index)=>{
  const fragmentIndices=[...line.fragmentIds],parts=fragmentIndices.map(i=>fragments[i]),text=parts.map(p=>p.text).join(' ');
  return {id:`native-line-${index}`,kind:/^\s*TABLE\s+\d+\b/i.test(text)?'table':/^\s*(?:FIGURE\s*\d+\b|Fig\.\s*\d+\b)/i.test(text)?'caption':'text',text,box:union(parts),fragmentIndices};
 });
 return collectCompoundFigureEnvelopes({OPS,operatorList,viewport,pdfjsVersion,nativeRegions,pageSource:{fragments,width,height}});
}
export function collectPageRasterFigureHints(input){
 const {fragments,width,height}=input;
 const nativeRegions=recoverReadingOrder(fragments,width,'auto').lines.map((line,index)=>{
  const fragmentIndices=[...line.fragmentIds],parts=fragmentIndices.map(i=>fragments[i]),text=parts.map(p=>p.text).join(' ');
  return{id:`native-line-${index}`,kind:/^\s*TABLE\s+\d+\b/i.test(text)&&!isTableReferenceText(text)?'table':'text',text,box:union(parts),fragmentIndices};
 });
 return collectRasterFigureEnvelopes({...input,nativeRegions,pageSource:{fragments,width,height}});
}
const issue=(code,pageId,regionId,message)=>({code,pageId,regionId,message});
function caption(page,input,indices,id){
 const parts=indices.map(i=>input.fragments[i]);
 return {id,type:'caption',box:union(parts),fragmentIds:sourceIds(page,indices),text:parts.map(p=>p.text).join(' '),provenance:'pdf-text',status:'unresolved',exclusionReason:''};
}

/** Initial source proposals only. New geometry cannot overwrite existing
 * cell-bearing grids, verified regions, foreign fragments or semantic links. */
export function extendPageWithSourceDrafts(page,input,trace=null){
 const step=(helper,outcome,phase)=>{if(typeof trace==='function')trace(helper,outcome,phase);};
 if(!page||!input||!Array.isArray(page.regions)||!Array.isArray(page.edges)||!Array.isArray(page.issues)||!Array.isArray(input.fragments)||page.edges.some(e=>e.type==='reading-next'&&e.status==='verified')){step('multiple-assembly','null','protected');return page;}
 let result=page;
 const lines=recoverReadingOrder(input.fragments,input.width,'auto',input.hasImages===false?input.vectorHints:null).lines;
 const analysis=analyzeMultipleRuledTables({...input,lines,pageId:page.id}),tables=analysis.drafts;
 for(const attempt of analysis.attempts)step('multiple',attempt.outcome,attempt.phase);
 if(analysis.overflow)step('multiple','overflow','complete'); // Existing private trace cap withholds publication.
 for(const draft of tables){
  const indices=[...draft.fragmentIndices,...draft.captionFragmentIndices];
  if(new Set(indices).size!==indices.length){step('multiple-assembly','null','region-ownership');continue;}
  const removed=ownedRegions(result,sourceIds(page,indices),phase=>step('multiple-assembly','null',phase));if(!removed)continue;
  const removedIds=new Set(removed.map(r=>r.id)),at=result.regions.findIndex(r=>removedIds.has(r.id));
  const id=`${page.id}-source-table-${draft.table.cells[0]?.id}-${draft.fragmentIndices[0]}`;
  const table={id,type:'table',box:{...draft.box},fragmentIds:sourceIds(page,draft.fragmentIndices),text:draft.table.cells.map(c=>c.text).join('\n'),provenance:'pdf-text',status:'unresolved',exclusionReason:'',table:draft.table};
  const cap=caption(page,input,draft.captionFragmentIndices,`${id}-caption`);
  const remaining=result.regions.filter(r=>!removedIds.has(r.id));remaining.splice(at,0,table,cap);
  const prior=result;
  result=finish(result,remaining,removed,[{id:`${id}-caption-link`,type:'caption-of',from:cap.id,to:id,status:'proposed'}],[
   issue('table-grid-unverified',page.id,id,'Source-ruled geometry draft: compare every literal, cell boundary, geometric span and header association with the original. Text uses source item order; superscripts and line layout require review.'),
   issue('caption-link-unresolved',page.id,cap.id,'The source caption is proposed below its table for the requested natural output flow. The link and wording require review.')]);
  step('multiple-assembly',result===prior?'null':'draft',result===prior?'collision':'complete');
 }
 const figures=getCompoundFigureCandidatesForPage(input.compoundFigureHints,{fragments:input.fragments,width:input.width,height:input.height});
 for(const draft of figures){
  const ids=sourceIds(page,draft.captionFragmentIndices),removed=ownedRegions(result,ids);if(!removed)continue;
  const removedIds=new Set(removed.map(r=>r.id)),remaining=result.regions.filter(r=>!removedIds.has(r.id)),above=[],below=[];
  let ambiguous=false;
  for(const r of remaining){if(r.box.y+r.box.height<=draft.frameBox.y)above.push(r);else if(r.box.y>=draft.frameBox.y+draft.frameBox.height)below.push(r);else{ambiguous=true;break;}}
  if(ambiguous)continue; // Parallel/crossing text needs a separate reading-order policy.
  const id=`${page.id}-source-figure-${draft.frameOperatorIndex}`;
  const figure={id,type:'figure',box:{...draft.bodyBox},fragmentIds:[],text:'',provenance:'pdf-vector-envelope',status:'unresolved',exclusionReason:''};
  const cap=caption(page,input,draft.captionFragmentIndices,`${id}-caption`);
  result=finish(result,[...above,figure,cap,...below],removed,[{id:`${id}-caption-link`,type:'caption-of',from:cap.id,to:id,status:'proposed'}],[
   issue('figure-unassessed',page.id,id,'Compound vector appearance is proposed as one source envelope. Internal label text, node/arrow semantics and visible completeness remain unverified.'),
   issue('caption-link-unresolved',page.id,cap.id,'Source-bottom caption correspondence is proposed and requires review.')]);
 }
 for(const draft of getRasterFigureCandidatesForPage(input.rasterFigureHints,{fragments:input.fragments,width:input.width,height:input.height})){
  const removed=ownedRegions(result,sourceIds(page,draft.captionFragmentIndices));if(!removed)continue;
  const removedIds=new Set(removed.map(r=>r.id)),positions=result.regions.flatMap((r,i)=>removedIds.has(r.id)?[i]:[]);
  if(positions.some((p,i)=>i&&p!==positions[i-1]+1))continue;
  const id=`${page.id}-source-raster-figure-${draft.frameOperatorIndex}`;
  const figure={id,type:'figure',box:{...draft.bodyBox},fragmentIds:[],text:'',provenance:'pdf-raster-frame-envelope',status:'unresolved',exclusionReason:''};
  const cap=caption(page,input,draft.captionFragmentIndices,`${id}-caption`),remaining=result.regions.filter(r=>!removedIds.has(r.id));remaining.splice(positions[0],0,figure,cap);
  result=finish(result,remaining,removed,[{id:`${id}-caption-link`,type:'caption-of',from:cap.id,to:id,status:'proposed'}],[issue('figure-unassessed',page.id,id,'Raster source enclosure is proposed. Plot labels, relationships and visible completeness remain unverified.'),issue('caption-link-unresolved',page.id,cap.id,'Source-bottom native caption correspondence requires review.')]);
 }
 return result;
}
