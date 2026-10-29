// Explicit native region grouping. Geometry is never inferred or adjusted.
// These DATA/change seals do not authenticate original ink or human review.
import {captureTableProposalSource,isTableProposalSourceCurrent} from './document-ruled-table-grid.mjs';
import {captureNativeTableSource,validateNativeTableBinding} from './document-table-source.mjs';
const own=(v,k)=>{const d=v&&Object.getOwnPropertyDescriptor(v,k);if(!d||!Object.hasOwn(d,'value'))throw 0;return d.value;};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._-]{1,128}$/.test(v);
const box=(b,p)=>b&&[b.x,b.y,b.width,b.height,p.width,p.height].every(Number.isFinite)&&p.width>0&&p.height>0&&p.width<=16384&&p.height<=16384&&b.x>=0&&b.y>=0&&b.width>0&&b.height>0&&b.x+b.width>b.x&&b.y+b.height>b.y&&b.x+b.width<=p.width&&b.y+b.height<=p.height;
const contains=(a,b)=>b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width&&b.y+b.height<=a.y+a.height;
const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
const fail=()=>{throw new RangeError('Native table grouping requires bounded current source regions and one explicit reading chain.');};
export const hasNativeTableGroup=r=>Boolean(r&&Object.getOwnPropertyDescriptor(r,'nativeTableGroup'));
export function nativeTableGroupReviewReady(region,requireOrder=true){
 try{
  if(!hasNativeTableGroup(region))return true;
  const marker=own(region,'nativeTableGroup');if(!captureTableProposalSource(marker)||Reflect.ownKeys(marker).length!==2||own(marker,'version')!=='native-table-group-v1'||(requireOrder&&own(marker,'orderReviewed')!==true))return false;
  if(typeof own(marker,'orderReviewed')!=='boolean')return false;
  const table=own(region,'table');return own(table,'sourceReviewChecked')===true&&validateNativeTableBinding(own(table,'sourceReview'),{region,table}).ok;
 }catch{return false;}
}
export function nativeTableGroupDataSafe(document,edit){return Boolean(captureTableProposalSource(document)&&captureTableProposalSource(edit));}
export function nativeTableReadingOrder(page){
 if(!Array.isArray(page.regions)||!page.regions.length||page.regions.length>256||!Array.isArray(page.edges)||page.edges.length>1024)return fail();
 const ids=new Set(page.regions.map(r=>r.id)),next=new Map(),incoming=new Set();if(ids.size!==page.regions.length||[...ids].some(x=>!id(x)))return fail();
 const reading=page.edges.filter(e=>e.type==='reading-next');if(reading.length!==ids.size-1)return fail();
 for(const e of reading){if(!ids.has(e.from)||!ids.has(e.to)||next.has(e.from)||incoming.has(e.to))return fail();next.set(e.from,e.to);incoming.add(e.to);}
 const roots=[...ids].filter(x=>!incoming.has(x));if(roots.length!==1)return fail();
 const order=[],seen=new Set();let at=roots[0];while(at&&!seen.has(at)){order.push(at);seen.add(at);at=next.get(at);}if(at||seen.size!==ids.size)return fail();return order;
}
export function nativeTableGroupPlan(document,edit){
 try{
  if(!nativeTableGroupDataSafe(document,edit)||Reflect.ownKeys(edit).some(k=>!['kind','pageId','regionIds','newRegionId','box'].includes(k)))return fail();
  if(typeof edit.pageId!=='string'||!/^p[1-9][0-9]*$/.test(edit.pageId))return fail();
  const matches=document.pages.filter(p=>p.id===edit.pageId);if(matches.length!==1)return fail();const page=matches[0],ids=edit.regionIds;
  if(!Array.isArray(ids)||ids.length<2||ids.length>32||ids.some(x=>!id(x))||new Set(ids).size!==ids.length||!id(edit.newRegionId)||!box(edit.box,page))return fail();
  const order=nativeTableReadingOrder(page),selected=new Set(ids);if(JSON.stringify(order.filter(x=>selected.has(x)))!==JSON.stringify(ids))return fail();
  const originals=ids.map(key=>page.regions.find(r=>r.id===key));if(originals.some(r=>!r||!['paragraph','heading'].includes(r.type)||r.provenance!=='pdf-text'||!['proposed','unresolved'].includes(r.status)||r.table||r.equationReview||r.figureReview||r.footnoteReview||hasNativeTableGroup(r)||!box(r.box,page)||!contains(edit.box,r.box)||typeof r.text!=='string'||!r.text.trim()||!Array.isArray(r.fragmentIds)||!r.fragmentIds.length))return fail();
  const all=document.pages.flatMap(p=>p.regions);if(new Set(all.map(r=>r.id)).size!==all.length||all.some(r=>r.id===edit.newRegionId&&!selected.has(r.id)))return fail();
  if(document.pages.flatMap(p=>p.edges).some(e=>e.type!=='reading-next'&&(selected.has(e.from)||selected.has(e.to))))return fail();
  if(page.regions.some(r=>!selected.has(r.id)&&box(r.box,page)&&overlap(edit.box,r.box)))return fail();
  const fragments=originals.flatMap(r=>r.fragmentIds),literal=originals.map(r=>r.text).join('\n');
  if(!Array.isArray(page.fragmentIds)||page.fragmentIds.length>10000||new Set(page.fragmentIds).size!==page.fragmentIds.length||!fragments.length||fragments.length>400||new Set(fragments).size!==fragments.length||literal.length>65536||fragments.some(x=>typeof x!=='string'||x.length>128||!new RegExp('^'+page.id+'-f(?:0|[1-9][0-9]*)$').test(x)||!page.fragmentIds.includes(x))||all.some(r=>!selected.has(r.id)&&r.fragmentIds?.some(x=>fragments.includes(x))))return fail();
  const region={id:edit.newRegionId,type:'table',provenance:'pdf-text',status:'proposed',exclusionReason:'',box:structuredClone(edit.box),fragmentIds:[...fragments],text:literal,table:{rowCount:1,columnCount:1,cells:[],reviewed:false},nativeTableGroup:{version:'native-table-group-v1',orderReviewed:false}};
  const collapsed=order.filter(x=>!selected.has(x)||x===ids[0]).map(x=>x===ids[0]?region.id:x);return{region,order:collapsed,selected:ids};
 }catch{return fail();}
}
function canvasFacts(canvas){
 try{
  const keys=['isConnected','tagName','width','height'];if(!canvas)return null;
  if(Object.getPrototypeOf(canvas)===Object.prototype){const facts=Object.fromEntries(keys.map(k=>[k,own(canvas,k)]));return facts;}
  const C=globalThis.HTMLCanvasElement,N=globalThis.Node,E=globalThis.Element;
  if(typeof C!=='function'||typeof N!=='function'||typeof E!=='function'||!C.prototype.isPrototypeOf(canvas)||keys.some(k=>Object.getOwnPropertyDescriptor(canvas,k)))return null;
  const getter=(p,k)=>{const d=Object.getOwnPropertyDescriptor(p,k);if(typeof d?.get!=='function'||!Function.prototype.toString.call(d.get).includes('[native code]'))throw 0;return Reflect.apply(d.get,canvas,[]);};
  return{isConnected:getter(N.prototype,'isConnected'),tagName:getter(E.prototype,'tagName'),width:getter(C.prototype,'width'),height:getter(C.prototype,'height')};
 }catch{return null;}
}
export function createNativeTableGroupSession({getCurrent,makeDraft}){
 if(typeof getCurrent!=='function'||typeof makeDraft!=='function')throw new TypeError('Current source ownership callbacks are required.');
 let pending=null;const origins=new Map();
 const held=()=>freeze({status:'held',reason:'native-table-group-held',source:null,counts:null,sourceReviewed:false,visibility:'unverified'});
 function current(scopeId){
  const raw=getCurrent(scopeId),graph=own(raw,'graph'),pageId=own(raw,'pageId'),record=own(raw,'record'),canvas=own(raw,'canvas'),generation=own(raw,'generation');
  const graphSeal=captureTableProposalSource(graph);if(!graphSeal||!Number.isSafeInteger(generation)||generation<0||!/^p[1-9][0-9]*$/.test(pageId)||own(record,'canvas')!==canvas)throw 0;
  const pages=graph.pages.filter(p=>p.id===pageId);if(pages.length!==1)throw 0;const page=pages[0],width=own(record,'width'),height=own(record,'height'),facts=canvasFacts(canvas),native=own(record,'fragments');
  if(!facts||facts.isConnected!==true||facts.tagName!=='CANVAS'||facts.width!==width||facts.height!==height||page.width!==width||page.height!==height||!Array.isArray(native)||native.length!==page.fragmentIds.length||native.length>10000)throw 0;
  const nativeSeal=captureTableProposalSource(native);if(!nativeSeal)throw 0;
  return{raw,graph,pageId,page,record,canvas,generation,width,height,native,nativeSeal,graphSeal};
 }
 function candidate(c){
  const regionIds=own(c.raw,'regionIds'),crop=own(c.raw,'box');if(!captureTableProposalSource(regionIds)||!captureTableProposalSource(crop)||JSON.stringify(c.graph.selectedRegionIds)!==JSON.stringify(regionIds))throw 0;
  const edit={kind:'group-native-table',pageId:c.pageId,regionIds:[...regionIds],newRegionId:regionIds[0],box:structuredClone(crop)};
  const plan=nativeTableGroupPlan(c.graph,edit),region=plan.region;
  const result=captureNativeTableSource({record:c.record,pageId:c.pageId,region});if(result.status!=='draft')throw 0;
  const byId=new Map(result.source.fragments.map(f=>[f.id,f]));for(const id of regionIds){const r=c.page.regions.find(r=>r.id===id);if(r.fragmentIds.map(id=>byId.get(id)?.text??'').join('').replace(/\s/gu,'')!==r.text.replace(/\s/gu,''))throw 0;}
  return{edit,source:result.source};
 }
 const same=(p,c)=>p.generation===c.generation&&p.record===c.record&&p.canvas===c.canvas&&p.width===c.width&&p.height===c.height&&isTableProposalSourceCurrent(p.nativeSeal,c.native)&&isTableProposalSourceCurrent(p.graphSeal,c.graph);
 return Object.freeze({
  capture(){pending=null;try{const c=current(),draft=candidate(c);pending={...c,...draft};return freeze({status:'draft',source:draft.source,sourceReviewed:false,visibility:'unverified'});}catch{return held();}},
  peek(){try{if(pending&&same(pending,current()))return freeze({status:'draft',source:pending.source,sourceReviewed:false,visibility:'unverified'});}catch{}pending=null;return held();},
  commit(input){try{if(!input||own(input,'sourceChecked')!==true||!pending)return{ok:false,reason:'native-table-group-held'};const c=current(),draft=candidate(c),p=pending;if(!same(p,c)||JSON.stringify(draft.edit)!==JSON.stringify(p.edit)||JSON.stringify(draft.source)!==JSON.stringify(p.source))throw 0;const document=makeDraft(c.graph,draft.edit);origins.set(draft.edit.newRegionId,{record:c.record,canvas:c.canvas,generation:c.generation,width:c.width,height:c.height,nativeSeal:c.nativeSeal,pageId:c.pageId});pending=null;return{ok:true,document,regionId:draft.edit.newRegionId};}catch{pending=null;return{ok:false,reason:'native-table-group-held'};}},
  has(id){return origins.has(id);},
  isCurrent(id){const old=origins.get(id);if(!old)return false;try{const c=current(old.pageId),region=c.graph.pages.flatMap(p=>p.regions).find(r=>r.id===id);if(old.pageId!==c.pageId||!hasNativeTableGroup(region)||old.record!==c.record||old.canvas!==c.canvas||old.generation!==c.generation||old.width!==c.width||old.height!==c.height||!isTableProposalSourceCurrent(old.nativeSeal,c.native))throw 0;return true;}catch{origins.delete(id);return false;}},
  invalidatePending(){pending=null;},reset(){pending=null;origins.clear();}
 });
}
