import {isRasterDecodeReceipt} from './document-raster-operators.mjs';
// Conservative source envelopes, not visible-image or semantic certification.
const VERSION='pdfjs-raster-envelope-v1',REGIONAL_VERSION='pdfjs-regional-raster-envelope-v1',evidence=new WeakSet(),sourceLists=new WeakMap();
// Bounded own-data source stamp for the additional ruled-grid consumer only.
// Unknown prototypes/accessors/resources hold that consumer, without changing legacy raster assessments.
export function ruleSourceStamp(OPS,list,viewport){
 try {
  let nodes=0,properties=0,strings=0;const seen=new Map();
  const string=s=>{if((strings+=s.length)>1048576)throw 0;return s;};
  const visit=(v,depth=0)=>{
   if(++nodes>200000||depth>24)throw 0;
   if(v===null)return ['null'];
   if(typeof v==='number')return ['number',Object.is(v,-0)?'-0':String(v)];
   if(typeof v==='string')return ['string',string(v)];
   if(typeof v==='boolean'||typeof v==='undefined')return [typeof v,v??null];
   if(typeof v!=='object')throw 0;
   if(seen.has(v))return ['ref',seen.get(v)];const id=seen.size;seen.set(v,id);
   const proto=Object.getPrototypeOf(v),typed=[Uint8Array,Uint8ClampedArray,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array].find(t=>proto===t.prototype);
   if(!typed&&proto!==Object.prototype&&proto!==null&&proto!==Array.prototype)throw 0;
   const keys=Reflect.ownKeys(v);if((properties+=keys.length)>300000)throw 0;
   for(const k of keys){if(typeof k!=='string')throw 0;string(k);}keys.sort();
   return [typed?typed.name:(Array.isArray(v)?'array':proto===null?'null-object':'object'),id,keys.map(k=>{
    const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!Object.hasOwn(d,'value'))throw 0;
    return [k,d.enumerable,d.configurable,d.writable,visit(d.value,depth+1)];
   })];
  };
  const own=(o,k)=>{const d=Object.getOwnPropertyDescriptor(o,k);if(!d||!Object.hasOwn(d,'value'))throw 0;return d.value;};
  const value=visit([OPS,own(list,'fnArray'),own(list,'argsArray'),own(viewport,'width'),own(viewport,'height'),own(viewport,'transform')]);
  return JSON.stringify(value);
 }catch{return null;}
}
// Reuse the bounded own-data encoder; never invoke metadata toJSON/getters.
export const ruleMetadataStamp=value=>ruleSourceStamp({}, {fnArray:[],argsArray:value}, {width:0,height:0,transform:[]});
export const isRasterEvidenceForSource=(source,list,ops,stamp)=>{
 const bound=sourceLists.get(source);
 return Boolean(source&&evidence.has(source)&&source.complete&&bound&&bound.list===list&&bound.ops===ops&&stamp!==null&&bound.stamp===stamp);
};
const rasterNames=['paintImageXObject','paintInlineImageXObject','paintImageMaskXObject','paintImageXObjectRepeat',
 'paintImageMaskXObjectRepeat','paintImageMaskXObjectGroup','paintInlineImageXObjectGroup','paintSolidColorImageMask'];
const numericArray=a=>Array.isArray(a)||(ArrayBuffer.isView(a)&&typeof a.BYTES_PER_ELEMENT==='number');
const numbers=(a,n)=>numericArray(a)&&a.length===n&&[...a].every(Number.isFinite);
const axis=m=>numbers(m,6)&&m[0]>0&&m[3]>0&&m[1]===0&&m[2]===0;
const valid=b=>b&&[b.x,b.y,b.width,b.height].every(Number.isFinite)&&b.width>0&&b.height>0&&b.x+b.width>b.x&&b.y+b.height>b.y;
const contains=(a,b)=>valid(a)&&valid(b)&&b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width&&b.y+b.height<=a.y+a.height;
const compose=(a,b)=>[a[0]*b[0],0,0,a[3]*b[3],a[0]*b[4]+a[4],a[3]*b[5]+a[5]];
function project(b,m,v){
 const x=[b[0],b[2]].map(n=>(m[0]*n+m[4])*v[0]+v[4]),y=[b[1],b[3]].map(n=>(m[3]*n+m[5])*v[3]+v[5]);
 return {x:Math.min(...x),y:Math.min(...y),width:Math.abs(x[1]-x[0]),height:Math.abs(y[1]-y[0])};
}
function intersect(a,b){if(!a||!b)return null;const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
 return {x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)};}
function rectangle(data,b){
 if(!Array.isArray(data)||data.length!==1||!numbers(data[0],13)||!numbers(b,4)||!(b[2]>b[0]&&b[3]>b[1]))return null;
 const p=data[0];if(p[0]!==0||p[3]!==1||p[6]!==1||p[9]!==1||p[12]!==4)return null;
 const points=[[p[1],p[2]],[p[4],p[5]],[p[7],p[8]],[p[10],p[11]]],set=new Set(points.map(([x,y])=>`${x}:${y}`));
 return set.size===4&&[[b[0],b[1]],[b[0],b[3]],[b[2],b[1]],[b[2],b[3]]].every(([x,y])=>set.has(`${x}:${y}`))&&
 points.every((a,i)=>{const c=points[(i+1)%4];return (a[0]===c[0])!==(a[1]===c[1]);})?[...b]:null;
}
const ignored=new Set(('dependency setLineWidth setLineCap setLineJoin setMiterLimit setDash setRenderingIntent setFlatness '+
 'setStrokeRGBColor setStrokeTransparent setStrokeColor setStrokeColorN setStrokeGray setStrokeCMYKColor '+
 'setFillRGBColor setFillTransparent setFillColor setFillColorN setFillGray setFillCMYKColor '+
 'setCharSpacing setWordSpacing setHScale setLeading setFont setTextRise moveText setLeadingMoveText setTextMatrix '+
 'nextLine showText showSpacedText nextLineShowText nextLineSetSpacingShowText markPoint markPointProps').split(' '));

export function collectRasterPlacements(input){
 return collectRasterPlacementsCore(input,false);
}
// Opt-in paint envelopes for regional source assessments. Legacy callers retain
// their strict whole-image policy; an intersection is not a visibility approval.
export function collectRegionalRasterPlacements(input){
 return collectRasterPlacementsCore(input,true);
}
function collectRasterPlacementsCore(input,regional){
 const freezeRegional=p=>Object.freeze({...p,box:Object.freeze({...p.box}),
  rawSourceBox:Object.freeze({...p.rawSourceBox}),clipBox:Object.freeze({...p.clipBox}),
  projectedPaintBox:Object.freeze({...p.projectedPaintBox})});
 const placements=[],clippedAway=[],finish=(complete,reason,width=0,height=0)=>{
  const out=Object.freeze({version:regional?REGIONAL_VERSION:VERSION,width,height,complete,status:'unverified',occlusion:'unknown',
   placements:Object.freeze(placements.map(p=>regional?freezeRegional(p):Object.freeze({...p,box:Object.freeze({...p.box})}))),
   ...(regional?{clippedAway:Object.freeze(clippedAway.map(freezeRegional)),sourceReviewed:false,visibility:'unverified'}:{}),
   unsupported:Object.freeze(reason?[reason]:[])});evidence.add(out);sourceLists.set(out,{list:input?.operatorList,ops:input?.OPS,stamp:ruleSourceStamp(input?.OPS,input?.operatorList,input?.viewport)});return out;
 };
 if(!input||typeof input!=='object')return finish(false,'invalid-input');
 const {OPS,operatorList,viewport,pdfjsVersion,decodedImages}=input;
 if(pdfjsVersion!=='6.3.289')return finish(false,'unsupported-pdfjs-version');
 if(!OPS||rasterNames.some(n=>!Number.isInteger(OPS[n]))||!operatorList||!Array.isArray(operatorList.fnArray)||!Array.isArray(operatorList.argsArray)||
  operatorList.fnArray.length!==operatorList.argsArray.length||operatorList.fnArray.length>100000)return finish(false,'invalid-operator-inventory');
 if(!viewport||!numbers(viewport.transform,6)||!(viewport.width>0&&viewport.height>0)||!Number.isFinite(viewport.width)||!Number.isFinite(viewport.height)||
  viewport.transform[0]<=0||viewport.transform[3]>=0||viewport.transform[1]!==0||viewport.transform[2]!==0)return finish(false,'unsupported-viewport');
 const page={x:0,y:0,width:viewport.width,height:viewport.height};
 const fail=reason=>finish(false,reason,page.width,page.height);
 if(!isRasterDecodeReceipt(decodedImages,OPS,operatorList))return fail('unbound-decode-receipt');
 if(!decodedImages.fontInventoryComplete||decodedImages.fonts.some(f=>f.kind==='type3'))return fail('unassessed-font-resource');
 const decoded=new Map(decodedImages.images.map(i=>[i.id,i])),placed=new Set(),dependencies=new Set();
 const names=new Map(Object.entries(OPS).filter(([,n])=>Number.isInteger(n)).map(([n,v])=>[v,n]));
 let state={matrix:[1,0,0,1,0,0],clip:page,alpha:1,blend:'source-over',mask:false,transfer:false,known:true};
 let pending=false,marked=0,textOpen=false,annotationsStarted=false;const stack=[],scopes=[];
 for(let index=0;index<operatorList.fnArray.length;index++){
  const name=names.get(operatorList.fnArray[index]),args=operatorList.argsArray[index];
  if(!name)return fail('unknown-operator');
  if(name==='dependency'){
   if(!Array.isArray(args))return fail('invalid-dependency');
   for(const id of args)if(typeof id==='string'&&/(?:^|_)(?:img|mask)_/.test(id))dependencies.add(id);
  }else if(name==='save'){
   if(pending||stack.length>=128)return fail('unsupported-state-nesting');stack.push({...state,matrix:[...state.matrix]});
  }else if(name==='restore'){
   if(pending||stack.length<=(scopes.at(-1)?.depth??0))return fail('unbalanced-graphics-state');state=stack.pop();
  }else if(name==='transform'){
   if(!axis(args))return fail('unsupported-transform');state.matrix=compose(state.matrix,args);if(!axis(state.matrix))return fail('invalid-composed-transform');
  }else if(name==='setGState'){
   if(!Array.isArray(args?.[0]))return fail('invalid-graphics-state');
   for(const e of args[0]){if(!Array.isArray(e)||e.length!==2)return fail('invalid-graphics-state');const [k,v]=e;
    if(k==='ca')state.alpha=v;else if(k==='BM')state.blend=v;else if(k==='SMask')state.mask=v!==false;else if(k==='TR')state.transfer=v!==null;
    else if(!['CA','LW','LC','LJ','ML','D','RI','FL','Font'].includes(k))state.known=false;}
   if(!state.known||state.alpha!==1||state.blend!=='source-over'||state.mask||state.transfer)return fail('unsupported-graphics-resource');
  }else if(name==='setFillColorN'||name==='setStrokeColorN')return fail('unassessed-pattern-resource');
  else if(name==='clip'||name==='eoClip'){if(pending)return fail('duplicate-pending-clip');pending=true;
  }else if(name==='constructPath'){
   if(pending){const bounds=args?.[0]===OPS.endPath&&rectangle(args?.[1],args?.[2]);
    state.clip=bounds&&state.known?intersect(state.clip,project(bounds,state.matrix,viewport.transform)):null;pending=false;}
  }else if(name==='paintImageXObject'){
   if(annotationsStarted||scopes.some(s=>s.kind==='annotation'))return fail('unsupported-annotation-raster');
   if(!Array.isArray(args)||typeof args[0]!=='string'||!Number.isSafeInteger(args[1])||!Number.isSafeInteger(args[2])||args[1]<=0||args[2]<=0)return fail('invalid-image-reference');
   const d=decoded.get(args[0]);if(!d||d.width!==args[1]||d.height!==args[2])return fail('image-decode-dimension-mismatch');
   const box=project([0,0,1,1],state.matrix,viewport.transform);
   if(!regional){
    if(!state.known||state.alpha!==1||state.blend!=='source-over'||state.mask||state.transfer||pending||!contains(page,box)||!contains(state.clip,box))return fail('unsupported-image-paint');
    if(placements.length>=256)return fail('image-placement-limit');placed.add(args[0]);
    placements.push({operatorIndex:index,id:args[0],width:d.width,height:d.height,box,status:'unverified',occlusion:'unknown'});
   }else{
    // A null clip is unknown. An exact rectangular clip may instead have zero
    // area after prior intersections, and then accounts for an absent paint.
    const knownClip=state.clip&&[state.clip.x,state.clip.y,state.clip.width,state.clip.height].every(Number.isFinite)&&state.clip.width>=0&&state.clip.height>=0;
    if(!state.known||state.alpha!==1||state.blend!=='source-over'||state.mask||state.transfer||pending||!valid(box)||!knownClip)return fail('unsupported-image-paint');
    if(placements.length+clippedAway.length>=256)return fail('image-placement-limit');
    const paint=intersect(intersect(box,state.clip),page);
    const item={operatorIndex:index,id:args[0],width:d.width,height:d.height,box:paint,
     rawSourceBox:box,clipBox:{...state.clip},projectedPaintBox:paint,
     provenance:'exact-axis-image-rectangular-clip-envelope',status:'unverified',occlusion:'unknown',sourceReviewed:false,visibility:'unverified'};
    placed.add(args[0]);
    if(paint.width===0||paint.height===0)clippedAway.push({...item,reason:'fully-clipped'});
    else placements.push(item);
   }
  }else if(rasterNames.includes(name))return fail('unsupported-raster-operator');
  else if(name==='paintFormXObjectBegin'||name==='beginAnnotation'){
   if(pending||textOpen||scopes.length>=32)return fail('unsupported-resource-scope');
   const kind=name==='beginAnnotation'?'annotation':'form',before=state;state={...state,matrix:[...state.matrix]};
   if(kind==='form'){const m=args?.[0]??[1,0,0,1,0,0],b=args?.[1];
    if(!axis(m)||!numbers(b,4)||!(b[2]>b[0]&&b[3]>b[1]))return fail('unsupported-form-scope');
    state.matrix=compose(state.matrix,m);if(!axis(state.matrix))return fail('invalid-form-transform');state.clip=intersect(state.clip,project(b,state.matrix,viewport.transform));
   }else annotationsStarted=true;
   scopes.push({kind,before,depth:stack.length,marked});
  }else if(name==='paintFormXObjectEnd'||name==='endAnnotation'){
   const s=scopes.pop();if(!s||s.kind!==(name==='endAnnotation'?'annotation':'form')||s.depth!==stack.length||s.marked!==marked||textOpen||pending)return fail('unbalanced-resource-scope');state=s.before;
  }else if(name==='beginMarkedContent'||name==='beginMarkedContentProps'){
   if(!Array.isArray(args)||typeof args[0]!=='string'||args[0]==='OC'||(name==='beginMarkedContentProps'&&args[1]!=null&&(!Number.isSafeInteger(args[1])||args[1]<0)))return fail('unsupported-optional-content');
   if(++marked>128)return fail('marked-content-limit');
  }else if(name==='endMarkedContent'){if(marked<=(scopes.at(-1)?.marked??0))return fail('unbalanced-marked-content');marked--;
  }else if(name==='beginText'){if(textOpen)return fail('unbalanced-text-scope');textOpen=true;
  }else if(name==='endText'){if(!textOpen)return fail('unbalanced-text-scope');textOpen=false;
  }else if(name==='setTextRenderingMode'){if(!Number.isInteger(args?.[0])||args[0]<0||args[0]>3)return fail('unsupported-text-clip');
  }else if(!ignored.has(name))return fail('unsupported-operator');
 }
 if(stack.length||scopes.length||marked||pending||textOpen)return fail('unbalanced-source-state');
 if([...decoded.keys(),...dependencies].some(id=>!placed.has(id))||[...placed].some(id=>!decoded.has(id)))return fail('unplaced-raster-dependency');
 return finish(true,null,page.width,page.height);
}

export function assessRasterRegion(source,region){
 if(!source||!evidence.has(source)||!source.complete||!contains({x:0,y:0,width:source.width,height:source.height},region))return {status:'unknown',sourceReviewed:false};
 const overlap=source.placements.filter(p=>region.x<=p.box.x+p.box.width&&region.x+region.width>=p.box.x&&region.y<=p.box.y+p.box.height&&region.y+region.height>=p.box.y);
 return {status:overlap.length?'raster-overlap':'raster-disjoint',sourceReviewed:false,operatorIndices:overlap.map(p=>p.operatorIndex)};
}


// UNUSED data-only draft session. Neither visibility nor figure/caption authority.
import {validRenderDimensions} from './document-render-limits.mjs';
const rdObject=v=>v!==null&&typeof v==='object'&&
 (Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
function rdFields(value,keys,exact=false,enumerable=false){
 if(!rdObject(value))return null;
 if(exact){const own=Reflect.ownKeys(value);if(own.length!==keys.length||own.some(k=>!keys.includes(k)))return null;}
 const out=Object.create(null);
 for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);
  if(!d||!Object.hasOwn(d,'value')||(enumerable&&!d.enumerable))return null;out[key]=d.value;}
 return out;
}
function rdArray(value){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)return null;
 const length=Object.getOwnPropertyDescriptor(value,'length');
 if(!length||!Object.hasOwn(length,'value')||!Number.isSafeInteger(length.value)||length.value<0||length.value>4096)return null;
 const n=length.value,keys=Reflect.ownKeys(value);if(keys.length!==n+1)return null;
 const out=[];
 for(let i=0;i<n;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));
  if(!d||!Object.hasOwn(d,'value')||!d.enumerable)return null;out.push(d.value);}
 return out;
}
const rdPage=v=>typeof v==='string'&&v.length>0&&v.length<=128;
const rdGeneration=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
const rdUnknown=reason=>Object.freeze({status:'unknown',reason,placementCount:null,drafts:null,sourceReviewed:false,visibility:'unverified'});
const rdTouch=(a,b)=>a.x<=b.x+b.width&&a.x+a.width>=b.x&&a.y<=b.y+b.height&&a.y+a.height>=b.y;
function rdSnapshot(record){
 const r=rdFields(record,['width','height','fragments','canvas','rasterHints']);if(!r)return null;
 const source=r.rasterHints;
 if(!source||!evidence.has(source)||!source.complete||source.placements.length>64||
  !Number.isInteger(r.width)||!Number.isInteger(r.height)||r.width!==Math.ceil(source.width)||r.height!==Math.ceil(source.height)||
  !validRenderDimensions(r.width,r.height)||r.canvas===null||typeof r.canvas!=='object')return null;
 const items=rdArray(r.fragments);if(!items)return null;
 const page={x:0,y:0,width:source.width,height:source.height},natives=[];let textLength=0;
 for(const ref of items){const data=rdFields(ref,['text','x','y','width','height'],true,true);
  if(!data||typeof data.text!=='string'||data.text.length===0||!contains(page,data))return null;
  textLength+=data.text.length;if(textLength>65536)return null;natives.push({ref,data});}
 return {width:r.width,height:r.height,fragments:r.fragments,canvas:r.canvas,source,natives};
}
function rdSame(a,b){
 if(!b||a.width!==b.width||a.height!==b.height||a.fragments!==b.fragments||a.canvas!==b.canvas||a.source!==b.source||a.natives.length!==b.natives.length)return false;
 for(let i=0;i<a.natives.length;i++){
  const x=a.natives[i],y=b.natives[i];if(x.ref!==y.ref)return false;
  for(const key of ['text','x','y','width','height'])if(!Object.is(x.data[key],y.data[key]))return false;
 }
 return true;
}
function rdEligible(bound){
 const p=bound.source.placements,n=bound.natives;
 // Reserve all pair work BEFORE either pair loop; never salvage a partial list.
 if(p.length*n.length+p.length*(p.length-1)/2>200000)return false;
 for(let i=0;i<p.length;i++){
  for(let j=0;j<i;j++)if(rdTouch(p[i].box,p[j].box))return false;
  for(const native of n)if(rdTouch(p[i].box,native.data))return false;
 }
 return true;
}
function rdDrafts(bound,pageId){
 const drafts=bound.source.placements.map(p=>Object.freeze({kind:'raster-source-envelope',id:pageId+'-raster-draft-'+p.operatorIndex,
  operatorIndex:p.operatorIndex,resourceId:p.id,decodedWidth:p.width,decodedHeight:p.height,
  box:Object.freeze({...p.box}),fragmentIds:Object.freeze([]),text:'',status:'unresolved',captionTarget:false}));
 return Object.freeze({status:'drafts',reason:null,placementCount:drafts.length,drafts:Object.freeze(drafts),sourceReviewed:false,visibility:'unverified'});
}
export function createRasterSourceDraftSession(config){
 let record=null,current=null,bound=null,pageId=null,generation=null,held='invalid-setup',busy=false;
 try{
  const c=rdFields(config,['record','pageId','sourceGeneration','getCurrent'],true);
  if(c&&rdPage(c.pageId)&&rdGeneration(c.sourceGeneration)&&typeof c.getCurrent==='function'){
   const snapshot=rdSnapshot(c.record);
   if(snapshot&&rdEligible(snapshot)){record=c.record;current=c.getCurrent;bound=snapshot;pageId=c.pageId;generation=c.sourceGeneration;held=null;}
  }
 }catch{/* Ordinary reflection failures conservatively leave setup unknown. */}
 return Object.freeze({
  read(){
   if(held)return rdUnknown(held);
   if(busy){held='reentrant-read';return rdUnknown(held);}busy=true;
   try{
    let context;try{context=rdFields(current(),['record','pageId','sourceGeneration'],true);}catch{return rdUnknown('unavailable-current');}
    if(held)return rdUnknown(held);
    if(!context||!rdPage(context.pageId)||!rdGeneration(context.sourceGeneration))return rdUnknown('invalid-current');
    if(context.sourceGeneration!==generation){held='stale-generation';return rdUnknown(held);}
    // Validate bound data even when the user is temporarily on another page.
    if(!rdSame(bound,rdSnapshot(record))){held='changed-source';return rdUnknown(held);}
    if(context.pageId!==pageId)return rdUnknown('not-current-page');
    if(context.record!==record){held='foreign-record';return rdUnknown(held);}
    return rdDrafts(bound,pageId);
   }catch{held='unavailable-source';return rdUnknown(held);}finally{busy=false;}
  },
  invalidate(){if(held!=='disposed')held='invalidated';},
  dispose(){held='disposed';record=null;current=null;bound=null;pageId=null;generation=null;}
 });
}
