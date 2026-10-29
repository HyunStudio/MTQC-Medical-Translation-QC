import {ruleSourceStamp,ruleMetadataStamp} from './document-raster-regions.mjs';

// Source geometry only: neither visible-ink certification nor recovered diagram
// semantics. Native regions must come from the same page and viewport; callers
// retain responsibility for document generation and captured-canvas correspondence.
const VERSION='pdfjs-compound-vector-envelope-v1',bindings=new WeakMap();
const numeric=a=>Array.isArray(a)||(ArrayBuffer.isView(a)&&typeof a.BYTES_PER_ELEMENT==='number');
const numbers=(a,n)=>numeric(a)&&a.length===n&&[...a].every(Number.isFinite);
const valid=b=>b&&[b.x,b.y,b.width,b.height].every(Number.isFinite)&&b.width>0&&b.height>0;
const contains=(a,b)=>valid(a)&&valid(b)&&b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width&&b.y+b.height<=a.y+a.height;
const overlaps=(a,b)=>valid(a)&&valid(b)&&a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
const horizontalOverlap=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width;
const affine=m=>numbers(m,6)&&Number.isFinite(m[0]*m[3]-m[1]*m[2])&&m[0]*m[3]-m[1]*m[2]!==0;
const axis=m=>affine(m)&&m[1]===0&&m[2]===0;
const compose=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const union=boxes=>{const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return {x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};};
const intersection=(a,b)=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);return {x,y,width:Math.min(a.x+a.width,b.x+b.width)-x,height:Math.min(a.y+a.height,b.y+b.height)-y};};
function project(bounds,matrix){
 const points=[[bounds[0],bounds[1]],[bounds[0],bounds[3]],[bounds[2],bounds[1]],[bounds[2],bounds[3]]].map(([x,y])=>({x:matrix[0]*x+matrix[2]*y+matrix[4],y:matrix[1]*x+matrix[3]*y+matrix[5]}));
 const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));return {x,y,width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y};
}
function pathShape(parts,bounds){
 if(!Array.isArray(parts)||!parts.length||!numbers(bounds,4)||!(bounds[2]>bounds[0]&&bounds[3]>bounds[1]))return null;
 let rectangle=false,subpaths=0;
 for(const p of parts){
  if(!numeric(p)||p.length>100000||![...p].every(Number.isFinite))return null;
  let current=false,points=[];
  const endpoint=(x,y)=>x>=bounds[0]&&x<=bounds[2]&&y>=bounds[1]&&y<=bounds[3];
  for(let i=0;i<p.length;){
   const op=p[i++];
   if(op===0){if(i+2>p.length||!endpoint(p[i],p[i+1]))return null;points.push([p[i++],p[i++]]);current=true;subpaths++;}
   else if(op===1){if(!current||i+2>p.length||!endpoint(p[i],p[i+1]))return null;points.push([p[i++],p[i++]]);}
   else if(op===2){if(!current||i+6>p.length||!endpoint(p[i+4],p[i+5]))return null;i+=6;}
   else if(op===4){if(!current)return null;current=false;}
   else return null;
  }
  // A frame/clip must be an exact complete four-corner closed rectangle.
  if(parts.length===1&&p.length===13&&p[0]===0&&p[3]===1&&p[6]===1&&p[9]===1&&p[12]===4&&points.length===4){
   const corners=new Set(points.map(([x,y])=>`${x}:${y}`));
   rectangle=corners.size===4&&[[bounds[0],bounds[1]],[bounds[0],bounds[3]],[bounds[2],bounds[1]],[bounds[2],bounds[3]]].every(([x,y])=>corners.has(`${x}:${y}`))&&points.every((p,i)=>{const q=points[(i+1)%4];return (p[0]===q[0])!==(p[1]===q[1]);});
  }
 }
 // PDF.js's source min/max bounds are retained, not guessed from control-point
 // hulls (which can exceed Bezier ink). Grammar/endpoints are checked here;
 // this is not a second renderer or a claim to exact visible glyph pixels.
 return subpaths?{rectangle,subpaths}:null;
}
const ignored=new Set(('dependency setCharSpacing setWordSpacing setHScale setLeading setFont setTextRise moveText setLeadingMoveText setTextMatrix nextLine showText showSpacedText nextLineShowText nextLineSetSpacingShowText setRenderingIntent setFlatness markPoint markPointProps').split(' '));
const solid=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);

/** Deterministic current-data assessment. Rendering may mutate an operator list;
 * if so, retain the pre-render receipt rather than claiming that a new list is
 * current. No cached receipt is admitted by value or after source mutation. */
export function isCompoundFigureEvidenceForSource(result,input){
 try {const b=bindings.get(result);return Boolean(b&&b.list===input.operatorList&&b.ops===input.OPS&&b.viewport===input.viewport&&b.native===input.nativeRegions&&b.source===ruleSourceStamp(input.OPS,input.operatorList,input.viewport)&&b.regions===ruleMetadataStamp(input.nativeRegions)&&b.result===ruleMetadataStamp(result));}catch{return false;}
}

/** Page consumers receive plain hints only after checking the private source
 * receipt and exact current fragment array. Copies/serialized receipts confer
 * no source authority; no raw operators or canvas are exposed to consumers. */
export function getCompoundFigureCandidatesForPage(result,pageSource){
 try {
  const b=bindings.get(result),p=b?.page;
  if(!p||ruleMetadataStamp(pageSource)===null||pageSource.fragments!==p.fragments||pageSource.width!==p.width||pageSource.height!==p.height||p.snapshot!==ruleMetadataStamp([pageSource.fragments,pageSource.width,pageSource.height])||
   !isCompoundFigureEvidenceForSource(result,{OPS:b.ops,operatorList:b.list,viewport:b.viewport,nativeRegions:b.native}))return [];
  const native=new Map(b.native.map(r=>[r.id,r])),out=[];
  for(const c of result.candidates){
   const captionFragmentIndices=[];
   for(const id of c.captionRegionIds){
    const indices=native.get(id)?.fragmentIndices;
    if(!Array.isArray(indices)||!indices.length||indices.some(n=>!Number.isSafeInteger(n)||n<0||n>=p.fragments.length))return [];
    captionFragmentIndices.push(...indices);
   }
   if(new Set(captionFragmentIndices).size!==captionFragmentIndices.length)return [];
   out.push({...c,frameBox:{...c.frameBox},bodyBox:{...c.bodyBox},captionBox:{...c.captionBox},bodyOperatorIndices:[...c.bodyOperatorIndices],bodyPaintEnvelopes:c.bodyPaintEnvelopes.map(p=>({...p,sourceBox:{...p.sourceBox},clipBox:{...p.clipBox},box:{...p.box}})),captionRegionIds:[...c.captionRegionIds],captionFragmentIndices});
  }
  return out;
 }catch{return [];}
}

export function collectCompoundFigureEnvelopes(input={}){
 const fail=reason=>({version:VERSION,candidates:[],unsupported:[reason]});
 const {OPS,operatorList,viewport,pdfjsVersion,nativeRegions,pageSource}=input;
 if(pdfjsVersion!=='6.3.289')return fail('unsupported-pdfjs-version');
 if(!OPS||!operatorList||!Array.isArray(operatorList.fnArray)||!Array.isArray(operatorList.argsArray)||operatorList.fnArray.length!==operatorList.argsArray.length||operatorList.fnArray.length>100000)return fail('invalid-operator-list');
 if(!viewport||!numbers(viewport.transform,6)||!axis(viewport.transform)||viewport.transform[0]<=0||viewport.transform[3]>=0||!Number.isFinite(viewport.width)||!Number.isFinite(viewport.height)||!(viewport.width>0&&viewport.height>0))return fail('unsupported-viewport');
 if(!Array.isArray(nativeRegions)||nativeRegions.some(r=>!r||typeof r.id!=='string'||typeof r.text!=='string'||!valid(r.box))||new Set(nativeRegions.map(r=>r.id)).size!==nativeRegions.length)return fail('invalid-native-regions');
 const source=ruleSourceStamp(OPS,operatorList,viewport),regions=ruleMetadataStamp(nativeRegions);if(source===null||regions===null)return fail('unsupported-source-data');
 const names=new Map(Object.entries(OPS).map(([name,value])=>[value,name]));
 if(names.size!==Object.keys(OPS).length)return fail('ambiguous-operators');
 const page={x:0,y:0,width:viewport.width,height:viewport.height},paints=[],frames=[],stack=[];
 let state={matrix:[1,0,0,1,0,0],clip:page,fill:'#000000',stroke:'#000000',width:1,dash:false},pending=false,textOpen=false,marked=0;
 for(let index=0;index<operatorList.fnArray.length;index++){
  const name=names.get(operatorList.fnArray[index]),args=operatorList.argsArray[index];
  if(name==='save'){if(pending||stack.length>=128)return fail('unsupported-state-nesting');stack.push({...state,matrix:[...state.matrix]});}
  else if(name==='restore'){if(pending||!stack.length)return fail('unbalanced-source-state');state=stack.pop();}
  else if(name==='transform'){if(!affine(args))return fail('unsupported-transform');state.matrix=compose(state.matrix,args);if(!affine(state.matrix))return fail('unsupported-transform');}
  else if(name==='setFillRGBColor'){if(!solid(args?.[0]))return fail('unsupported-fill');state.fill=args[0];}
  else if(name==='setStrokeRGBColor'){if(!solid(args?.[0]))return fail('unsupported-stroke');state.stroke=args[0];}
  else if(name==='setLineWidth'){if(!Number.isFinite(args?.[0])||args[0]<0)return fail('unsupported-stroke');state.width=args[0];}
  else if(name==='setLineCap'||name==='setLineJoin'||name==='setMiterLimit'){if(!Number.isFinite(args?.[0]))return fail('unsupported-stroke');}
  else if(name==='setDash'){if(!Array.isArray(args)||!numeric(args[0])||args[0].length||!Number.isFinite(args[1]))return fail('unsupported-stroke');}
  else if(name==='setGState'){
   if(!Array.isArray(args?.[0]))return fail('unsupported-graphics-state');
   for(const entry of args[0]){
    if(!Array.isArray(entry)||entry.length!==2)return fail('unsupported-graphics-state');
    const [k,v]=entry;
    if((k==='ca'||k==='CA')&&v===1||k==='BM'&&v==='source-over'||k==='SMask'&&v===false||k==='TR'&&v===null)continue;
    if(k==='LW'&&Number.isFinite(v)&&v>=0){state.width=v;continue;}
    if(['LC','LJ','ML','RI','FL'].includes(k)&&Number.isFinite(v))continue;
    return fail('unsupported-graphics-state');
   }
  }else if(name==='clip'||name==='eoClip'){if(pending)return fail('unsupported-clip');pending=true;}
  else if(name==='constructPath'){
   const shape=pathShape(args?.[1],args?.[2]);if(!shape)return fail('invalid-path-bounds');
   const matrix=compose(viewport.transform,state.matrix),box=project(args[2],matrix);
   if(!valid(box))return fail('invalid-path-bounds');
   if(pending){if(args[0]!==OPS.endPath||!shape.rectangle||!axis(matrix))return fail('unsupported-clip');state.clip=intersection(state.clip,box);pending=false;continue;}
   if(args[0]===OPS.endPath)continue;
   if(args[0]===OPS.fill||args[0]===OPS.eoFill){
    if(textOpen)return fail('unsupported-text-path');
    // A supported rectangular source clip may cut a glyph's bounding box.
    // Its exact intersection is a conservative envelope, not visible-ink
    // recovery. Do not enlarge the clip or retain a fully clipped paint.
    const clipped=intersection(intersection(box,state.clip),page);
    if(valid(clipped))paints.push({operatorIndex:index,sourceBox:box,clipBox:{...state.clip},box:clipped,kind:'fill-envelope',visibility:'unverified'});
   }
   else if(args[0]===OPS.stroke){
    if(textOpen||!shape.rectangle||!axis(matrix))return fail('unsupported-stroke');
    if(!contains(page,box)||!contains(state.clip,box))return fail('incomplete-path-paint');
    const dx=Math.max(1,Math.abs(matrix[0])*state.width)/2,dy=Math.max(1,Math.abs(matrix[3])*state.width)/2;
    const footprint={x:box.x-dx,y:box.y-dy,width:box.width+2*dx,height:box.height+2*dy};
    if(!contains(page,footprint)||!contains(state.clip,footprint))return fail('incomplete-path-paint');
    frames.push({operatorIndex:index,box});paints.push({operatorIndex:index,sourceBox:box,clipBox:{...state.clip},box:footprint,kind:'stroke-envelope',visibility:'unverified'});
   }else return fail('unsupported-path-paint');
  }else if(name==='beginText'){if(textOpen)return fail('unbalanced-source-state');textOpen=true;}
  else if(name==='endText'){if(!textOpen)return fail('unbalanced-source-state');textOpen=false;}
  else if(name==='setTextRenderingMode'){if(!Number.isInteger(args?.[0])||args[0]<0||args[0]>3)return fail('unsupported-text-clip');}
  else if(name==='beginMarkedContent'||name==='beginMarkedContentProps'){
   if(!Array.isArray(args)||typeof args[0]!=='string'||args[0]==='OC'||(name==='beginMarkedContentProps'&&args[1]!=null&&(!Number.isSafeInteger(args[1])||args[1]<0)))return fail('unsupported-resource-scope');marked++;
  }else if(name==='endMarkedContent'){if(!marked)return fail('unbalanced-source-state');marked--;}
  else if(!ignored.has(name))return fail('unsupported-operator');
 }
 if(stack.length||pending||textOpen||marked)return fail('unbalanced-source-state');
 const markers=nativeRegions.filter(r=>/^\s*(?:FIGURE\s*\d+\b|Fig\.\s*\d+\b)/i.test(r.text));
 const enclosing=frames.filter(f=>paints.some(p=>p.operatorIndex!==f.operatorIndex&&contains(f.box,p.box))&&markers.some(r=>contains(f.box,r.box)));
 if(enclosing.length>1)return fail('ambiguous-enclosing-frame');
 if(!enclosing.length){if(!markers.some(r=>frames.some(f=>contains(f.box,r.box))))return fail('missing-caption');return fail('missing-compound-body');}
 const frame=enclosing[0],interiorPaints=paints.filter(p=>p.operatorIndex!==frame.operatorIndex),inside=interiorPaints.filter(p=>contains(frame.box,p.box));
 if(interiorPaints.some(p=>overlaps(frame.box,p.box)&&!contains(frame.box,p.box)))return fail('path-crosses-frame');
 if(inside.length<2)return fail('missing-compound-body');
 const intersecting=nativeRegions.filter(r=>overlaps(frame.box,r.box));
 if(intersecting.some(r=>!contains(frame.box,r.box)))return fail('native-region-crosses-frame');
 if(intersecting.some(r=>r.kind==='table'))return fail('table-overlap');
 const captions=markers.filter(r=>contains(frame.box,r.box));if(captions.length!==1)return fail('ambiguous-caption');
 const marker=captions[0],bodyBox=union(inside.map(p=>p.box));
 if(intersecting.some(r=>r.box.y<bodyBox.y+bodyBox.height||r.box.y<marker.box.y))return fail('native-body-intrusion');
 const captionRegions=[...intersecting].sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x);
 for(let i=1;i<captionRegions.length;i++)if(!horizontalOverlap(captionRegions[i-1].box,captionRegions[i].box)||captionRegions[i].box.y<captionRegions[i-1].box.y+captionRegions[i-1].box.height)return fail('ambiguous-caption');
 const candidate={frameBox:{...frame.box},bodyBox,captionBox:union(captionRegions.map(r=>r.box)),frameOperatorIndex:frame.operatorIndex,bodyOperatorIndices:inside.map(p=>p.operatorIndex),bodyPaintEnvelopes:inside.map(p=>({...p,sourceBox:{...p.sourceBox},clipBox:{...p.clipBox},box:{...p.box}})),captionRegionIds:captionRegions.map(r=>r.id),captionOwnership:'tentative-source-bottom-band',status:'unresolved',sourceReviewed:false,labelSemantics:'unrecovered',visibleInk:'unverified'};
 const result={version:VERSION,candidates:[candidate],unsupported:[]};
 let pageBinding=null;
 if(pageSource&&ruleMetadataStamp(pageSource)!==null&&Array.isArray(pageSource.fragments)&&pageSource.width===Math.ceil(viewport.width)&&pageSource.height===Math.ceil(viewport.height)){
  const snapshot=ruleMetadataStamp([pageSource.fragments,pageSource.width,pageSource.height]);
  const assigned=new Set();
  const exactNative=nativeRegions.every(region=>{
   if(!Array.isArray(region.fragmentIndices)||!region.fragmentIndices.length)return false;
   const parts=[];
   for(const n of region.fragmentIndices){
    if(!Number.isSafeInteger(n)||n<0||n>=pageSource.fragments.length||assigned.has(n))return false;
    const p=pageSource.fragments[n];if(!p||typeof p.text!=='string'||!valid(p))return false;
    assigned.add(n);parts.push(p);
   }
   const box=union(parts);
   return region.text===parts.map(p=>p.text).join(' ')&&['x','y','width','height'].every(k=>box[k]===region.box[k]);
  });
  if(snapshot!==null&&exactNative)pageBinding={fragments:pageSource.fragments,width:pageSource.width,height:pageSource.height,snapshot};
 }
 bindings.set(result,{list:operatorList,ops:OPS,viewport,native:nativeRegions,source,regions,result:ruleMetadataStamp(result),page:pageBinding});return result;
}
