import {isRasterEvidenceForSource,ruleSourceStamp,ruleMetadataStamp,assessRasterRegion} from './document-raster-regions.mjs';
const ruleSources=new WeakMap();
const frameSources=new WeakMap();
// Separate from regional disjoint-paint evidence: only strict, complete source
// rectangle strokes may witness a tentative raster/caption enclosure.
export function getRasterFrameSourceEvidence(horizontal,vertical,raster,source){
 try{
  const h=ruleSources.get(horizontal?.candidates),v=ruleSources.get(vertical?.candidates),metadata=r=>ruleMetadataStamp([r.candidates,r.unsupported,r.excludedScopes]);
  if(!source||h?.list!==source.operatorList||h?.ops!==source.OPS||h?.viewport!==source.viewport||v?.viewport!==source.viewport)return null;
  if(!h||!v||h.metadata!==metadata(horizontal)||v.metadata!==metadata(vertical)||h.list!==v.list||h.ops!==v.ops||h.frame!==v.frame||h.source===null||h.source!==v.source||h.source!==ruleSourceStamp(h.ops,h.list,h.viewport)||h.snapshot!==JSON.stringify(horizontal.candidates)||v.snapshot!==JSON.stringify(vertical.candidates)||JSON.stringify(h.paintCoverage)!==JSON.stringify(v.paintCoverage)||JSON.stringify(h.frames)!==JSON.stringify(v.frames)||!isRasterEvidenceForSource(raster,h.list,h.ops,h.source)||raster.version!=='pdfjs-regional-raster-envelope-v1')return null;
  // Complete accepted H/V strokes have a supported conservative footprint even
  // though the legacy rectangular-paint inventory deliberately calls segments
  // unknown. Retain their bounds here: a raster consumer must still hold any
  // touching rule, rather than silently skipping accepted operators.
  const paints=h.paintCoverage.map(p=>{
   const rules=[...horizontal.candidates,...vertical.candidates].filter(c=>c.operatorIndex===p.operatorIndex);if(!rules.length)return p;
   const x=Math.min(...rules.map(c=>c.box.x)),y=Math.min(...rules.map(c=>c.box.y));
   return{operatorIndex:p.operatorIndex,kind:'axis-rule-envelope',box:{x,y,width:Math.max(...rules.map(c=>c.box.x+c.box.width))-x,height:Math.max(...rules.map(c=>c.box.y+c.box.height))-y},sourceReviewed:false};
  });
  const result=JSON.parse(JSON.stringify({frames:h.frames,paints,width:h.viewport.width,height:h.viewport.height,sourceReviewed:false}));
  frameSources.set(result,{horizontal,vertical,raster,source:{...source},stamp:ruleMetadataStamp(result)});return result;
 }catch{return null;}
}
export function isRasterFrameSourceEvidenceCurrent(result){
 const b=frameSources.get(result);return Boolean(b&&b.stamp===ruleMetadataStamp(result)&&getRasterFrameSourceEvidence(b.horizontal,b.vertical,b.raster,b.source));
}
export function shareRuleRasterSource(horizontal,vertical,raster){
 try{if(ruleMetadataStamp([horizontal,vertical])===null)return false;const h=ruleSources.get(horizontal?.candidates),v=ruleSources.get(vertical?.candidates);
 const metadata=r=>ruleMetadataStamp([r.candidates,r.unsupported,r.excludedScopes]);
 if(!h||!v||h.metadata!==metadata(horizontal)||v.metadata!==metadata(vertical))return false;
 const accepted=new Set([...horizontal.candidates,...vertical.candidates].map(c=>c.operatorIndex));
 if(h.paintIndices.some(i=>!accepted.has(i))||v.paintIndices.some(i=>!accepted.has(i)))return false;
 return Boolean(h&&v&&h.list===v.list&&h.ops===v.ops&&h.frame===v.frame&&h.source!==null&&h.source===v.source&&h.source===ruleSourceStamp(h.ops,h.list,h.viewport)&&h.snapshot===JSON.stringify(horizontal.candidates)&&v.snapshot===JSON.stringify(vertical.candidates)&&isRasterEvidenceForSource(raster,h.list,h.ops,h.source));}catch{return false;}
}
// A spatial consumer may exclude a PROVEN disjoint source paint, never an
// unknown one. Header fills remain explicit paints for topology/order review.
// This does not change the original whole-page admission above.
export function getRegionalRuleSourceEvidence(horizontal,vertical,raster,box){
 try {
  if(!validBox(box)||ruleMetadataStamp([horizontal,vertical])===null)return null;
  const h=ruleSources.get(horizontal?.candidates),v=ruleSources.get(vertical?.candidates);
  const metadata=r=>ruleMetadataStamp([r.candidates,r.unsupported,r.excludedScopes]);
  if(!h||!v||h.metadata!==metadata(horizontal)||v.metadata!==metadata(vertical)||h.list!==v.list||h.ops!==v.ops||h.frame!==v.frame||
   h.source===null||h.source!==v.source||h.source!==ruleSourceStamp(h.ops,h.list,h.viewport)||
   h.snapshot!==JSON.stringify(horizontal.candidates)||v.snapshot!==JSON.stringify(vertical.candidates)||
   JSON.stringify(h.paintCoverage)!==JSON.stringify(v.paintCoverage)||
   !isRasterEvidenceForSource(raster,h.list,h.ops,h.source)||
   !contains({x:0,y:0,width:h.viewport.width,height:h.viewport.height},box)||assessRasterRegion(raster,box).status!=='raster-disjoint')return null;
  const accepted=new Set([...horizontal.candidates,...vertical.candidates].map(c=>c.operatorIndex)),otherPaints=[];
  const touches=(a,b)=>a.x<=b.x+b.width&&a.x+a.width>=b.x&&a.y<=b.y+b.height&&a.y+a.height>=b.y;
  for(const p of h.paintCoverage){
   if(accepted.has(p.operatorIndex))continue;
   if(!p.box)return null;
   if(!touches(p.box,box))continue;
   if(p.kind!=='filled-rectangles'||!contains(box,p.box)||!p.rectangles.every(r=>contains(box,r)))return null;
   otherPaints.push(Object.freeze({...p,box:Object.freeze({...p.box}),rectangles:Object.freeze(p.rectangles.map(r=>Object.freeze({...r})))}));
  }
  return Object.freeze({otherPaints:Object.freeze(otherPaints),sourceReviewed:false,visibility:'unverified'});
 }catch{return null;}
}
// Immediate source paint evidence only. This module is deliberately not wired
// to a table proposer: later occlusion, raster overlap and cell semantics remain
// unknown even for a candidate whose complete stroke footprint is supported.
const VERSION = 'pdfjs-horizontal-rule-evidence-v1';
const numericArray = a => Array.isArray(a) || (ArrayBuffer.isView(a) && typeof a.BYTES_PER_ELEMENT === 'number');
const numbers = (a,n) => numericArray(a) && a.length === n && [...a].every(Number.isFinite);
const axis = m => numbers(m,6) && m[0]>0 && m[3]>0 && m[1]===0 && m[2]===0;
const validBox = b => b && [b.x,b.y,b.width,b.height].every(Number.isFinite) && b.width>0 && b.height>0 &&
  b.x+b.width>b.x && b.y+b.height>b.y;
const contains = (a,b) => validBox(a) && validBox(b) && b.x>=a.x && b.y>=a.y &&
  b.x+b.width<=a.x+a.width && b.y+b.height<=a.y+a.height;
const compose = (a,b) => [a[0]*b[0],0,0,a[3]*b[3],a[0]*b[4]+a[4],a[3]*b[5]+a[5]];
const rgb = v => typeof v==='string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
function project(bounds,m,v) {
  const xs=[bounds[0],bounds[2]].map(x=>(m[0]*x+m[4])*v[0]+v[4]);
  const ys=[bounds[1],bounds[3]].map(y=>(m[3]*y+m[5])*v[3]+v[5]);
  return {x:Math.min(...xs),y:Math.min(...ys),width:Math.abs(xs[1]-xs[0]),height:Math.abs(ys[1]-ys[0])};
}
function intersection(a,b) {
  if(!a||!b)return null;
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
  return {x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)};
}
function segment(data,bounds,vertical=false) {
  if(!Array.isArray(data)||data.length!==1||!numbers(data[0],6)||!numbers(bounds,4))return null;
  const p=data[0];
  if(p[0]!==0||p[3]!==1||(vertical?(p[1]!==p[4]||p[2]===p[5]):(p[2]!==p[5]||p[1]===p[4])))return null;
  const exact=vertical?[p[1],Math.min(p[2],p[5]),p[1],Math.max(p[2],p[5])]:[Math.min(p[1],p[4]),p[2],Math.max(p[1],p[4]),p[2]];
  return exact.every((n,i)=>n===bounds[i]) ? exact : null;
}
function clipRectangle(data,bounds) {
  if(!Array.isArray(data)||data.length!==1||!numbers(data[0],13)||!numbers(bounds,4))return null;
  const p=data[0], [x0,y0,x1,y1]=bounds;
  if(!(x1>x0&&y1>y0)||p[0]!==0||p[3]!==1||p[6]!==1||p[9]!==1||p[12]!==4)return null;
  const points=[[p[1],p[2]],[p[4],p[5]],[p[7],p[8]],[p[10],p[11]]];
  const corners=new Set(points.map(([x,y])=>`${x},${y}`));
  if(corners.size!==4||![[x0,y0],[x0,y1],[x1,y0],[x1,y1]].every(([x,y])=>corners.has(`${x},${y}`)))return null;
  return points.every((a,i)=>{const b=points[(i+1)%4];return (a[0]===b[0])!==(a[1]===b[1]);}) ? [...bounds] : null;
}
function rectangleParts(data,bounds){
 if(!Array.isArray(data)||data.length!==1||!numericArray(data[0])||!data[0].length||data[0].length%13||data[0].length>13312||!numbers(bounds,4))return null;
 const parts=[];
 for(let i=0;i<data[0].length;i+=13){
  const p=Array.from(data[0].slice(i,i+13));
  if(!p.every(Number.isFinite)||p[0]!==0||p[3]!==1||p[6]!==1||p[9]!==1||p[12]!==4)return null;
  const xs=[p[1],p[4],p[7],p[10]],ys=[p[2],p[5],p[8],p[11]],b=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
  if(!clipRectangle([p],b))return null;parts.push(b);
 }
 const union=[Math.min(...parts.map(p=>p[0])),Math.min(...parts.map(p=>p[1])),Math.max(...parts.map(p=>p[2])),Math.max(...parts.map(p=>p[3]))];
 return union.every((n,i)=>n===bounds[i])?parts:null;
}
function regionalPaint(index,args,state,viewport,OPS,scoped,pending){
 const unknown={operatorIndex:index,kind:'unknown',box:null};
 if(scoped||pending||!state.known||!axis(state.matrix)||!state.clip)return unknown;
 const parts=rectangleParts(args?.[1],args?.[2]);
 if(args?.[0]===OPS.fill&&parts&&state.fillKnown&&state.fillAlpha===1&&state.blend==='source-over'&&!state.mask&&!state.transfer){
  const rectangles=parts.map(p=>project(p,state.matrix,viewport.transform));
  if(rectangles.some(r=>!validBox(r)||!contains(state.clip,r)))return unknown;
  const x=Math.min(...rectangles.map(r=>r.x)),y=Math.min(...rectangles.map(r=>r.y));
  return {operatorIndex:index,kind:'filled-rectangles',box:{x,y,width:Math.max(...rectangles.map(r=>r.x+r.width))-x,height:Math.max(...rectangles.map(r=>r.y+r.height))-y},rectangles,fill:state.fill};
 }
 if(args?.[0]===OPS.stroke&&parts&&state.width&&state.cap===0&&state.dash){
  const b=project(args[2],state.matrix,viewport.transform),dx=Math.max(1,state.width*state.matrix[0]*Math.abs(viewport.transform[0])),dy=Math.max(1,state.width*state.matrix[3]*Math.abs(viewport.transform[3]));
  // Two widths conservatively enclose the rectangular join footprint. This
  // envelope can only exclude disjoint paint, never certify a visible border.
  return {operatorIndex:index,kind:'bounded-stroke',box:{x:b.x-dx,y:b.y-dy,width:b.width+2*dx,height:b.height+2*dy}};
 }
 return unknown;
}
function frameWitness(index,args,state,viewport,OPS,scoped,pending){
 if(scoped||pending||!state.known||!axis(state.matrix)||!state.clip||args?.[0]!==OPS.stroke||!state.width||state.cap!==0||!state.dash||!state.stroke||state.alpha!==1||state.blend!=='source-over'||state.mask||state.transfer)return null;
 const bounds=clipRectangle(args?.[1],args?.[2]);if(!bounds)return null;
 const box=project(bounds,state.matrix,viewport.transform),dx=Math.max(1,state.width*state.matrix[0]*Math.abs(viewport.transform[0])),dy=Math.max(1,state.width*state.matrix[3]*Math.abs(viewport.transform[3]));
 const footprint={x:box.x-dx,y:box.y-dy,width:box.width+2*dx,height:box.height+2*dy};
 if(!contains({x:0,y:0,width:viewport.width,height:viewport.height},footprint)||!contains(state.clip,footprint))return null;
 return {operatorIndex:index,box,footprint,clipBox:{...state.clip},sourceReviewed:false,visibility:'unverified'};
}
const ignored = new Set(('dependency setLineJoin setMiterLimit setRenderingIntent setFlatness '+
 'setFillRGBColor setFillTransparent setFillColor setFillColorN setFillGray setFillCMYKColor setFillColorSpace '+
 'beginText endText setCharSpacing setWordSpacing setHScale setLeading setFont setTextRise moveText '+
 'setLeadingMoveText setTextMatrix nextLine showText showSpacedText nextLineShowText nextLineSetSpacingShowText '+
 'markPoint markPointProps paintImageXObject paintInlineImageXObject paintImageMaskXObject paintSolidColorImageMask '+
 'paintImageXObjectRepeat paintImageMaskXObjectRepeat paintImageMaskXObjectGroup paintInlineImageXObjectGroup').split(' '));

export const collectHorizontalRules=input=>collectRules(input,false);
export const collectVerticalRules=input=>collectRules(input,true);
function collectRules(input,vertical) {
  const version=vertical?'pdfjs-vertical-rule-evidence-v1':VERSION;
  const fail=reason=>({version,candidates:[],excludedScopes:[],unsupported:[reason]});
  if(!input||typeof input!=='object')return fail('invalid-input');
  const {OPS,operatorList,viewport,pdfjsVersion}=input;
  if(pdfjsVersion!=='6.3.289')return fail('unsupported-pdfjs-version');
  if(!viewport||!numbers(viewport.transform,6)||!(viewport.width>0&&viewport.height>0)||
    !Number.isFinite(viewport.width)||!Number.isFinite(viewport.height)||viewport.transform[0]<=0||
    viewport.transform[3]>=0||viewport.transform[1]!==0||viewport.transform[2]!==0)return fail('unsupported-viewport');
  if(!OPS||typeof OPS!=='object'||!operatorList||!Array.isArray(operatorList.fnArray)||!Array.isArray(operatorList.argsArray)||
    operatorList.fnArray.length!==operatorList.argsArray.length||operatorList.fnArray.length>100000)return fail('invalid-operator-list');
  const names=new Map(Object.entries(OPS).filter(([,n])=>Number.isInteger(n)).map(([name,n])=>[n,name]));
  const page={x:0,y:0,width:viewport.width,height:viewport.height};
  let state={matrix:[1,0,0,1,0,0],clip:page,width:1,cap:0,dash:true,stroke:'#000000',alpha:1,fill:'#000000',fillKnown:true,fillAlpha:1,
    blend:'source-over',mask:false,transfer:false,known:true};
  let pendingClip=false,marked=0,mainEnded=false,textOpen=false;
  const stack=[],scopes=[],candidates=[],excludedScopes=[],unsupported=[],paintIndices=[],paintCoverage=[],frames=[];
  const setWidth=v=>{state.width=Number.isFinite(v)&&v>0?v:null;};
  const setCap=v=>{state.cap=Number.isInteger(v)?v:null;};
  const setDash=a=>{state.dash=Array.isArray(a)&&a.length===2&&numericArray(a[0])&&a[0].length===0&&Number.isFinite(a[1]);};
  for(let index=0;index<operatorList.fnArray.length;index++) {
    const name=names.get(operatorList.fnArray[index]),args=operatorList.argsArray[index];
    if(!name)return fail('unknown-operator');
    if(name==='save') {
      if(pendingClip||stack.length>=128)return fail('unsupported-state-nesting');
      stack.push({...state,matrix:[...state.matrix]});
    } else if(name==='restore') {
      const floor=scopes.at(-1)?.stackDepth??0;
      if(pendingClip||stack.length<=floor)return fail('unbalanced-graphics-state');
      state=stack.pop();
    } else if(name==='transform') {
      if(!axis(args))state.known=false;
      else {state.matrix=compose(state.matrix,args);if(!axis(state.matrix))state.known=false;}
    } else if(name==='setLineWidth')setWidth(args?.[0]);
    else if(name==='setLineCap')setCap(args?.[0]);
    else if(name==='setDash')setDash(args);
    else if(name==='setStrokeRGBColor')state.stroke=rgb(args?.[0]);
    else if(name==='setFillRGBColor'){state.fill=rgb(args?.[0]);state.fillKnown=state.fill!==null;}
    else if(['setFillTransparent','setFillColor','setFillColorN','setFillGray','setFillCMYKColor','setFillColorSpace'].includes(name))state.fillKnown=false;
    else if(['setStrokeTransparent','setStrokeColorN','setStrokeColor','setStrokeGray','setStrokeCMYKColor','setStrokeColorSpace'].includes(name))state.stroke=null;
    else if(name==='setGState') {
      if(!Array.isArray(args?.[0]))return fail('invalid-graphics-state');
      for(const entry of args[0]) {
        if(!Array.isArray(entry)||entry.length!==2)return fail('invalid-graphics-state');
        const [key,value]=entry;
        if(key==='CA')state.alpha=value;
        else if(key==='ca')state.fillAlpha=value;
        else if(key==='BM')state.blend=value;
        else if(key==='SMask')state.mask=value!==false;
        else if(key==='TR')state.transfer=value!==null;
        else if(key==='LW')setWidth(value);
        else if(key==='LC')setCap(value);
        else if(key==='D')setDash(value);
        else if(!['ca','LJ','ML','RI','FL','Font'].includes(key))state.known=false;
      }
    } else if(name==='clip'||name==='eoClip') {
      if(pendingClip)return fail('duplicate-pending-clip');
      pendingClip=true;
    } else if(name==='constructPath') {
      // Every visible path paint must be accounted for by one supported axis.
      // Fill/compound/unknown modes are held, not silently treated as absent seams.
      if(args?.[0]!==OPS.endPath){paintIndices.push(index);paintCoverage.push(regionalPaint(index,args,state,viewport,OPS,scopes.length||mainEnded||textOpen,pendingClip));const frame=frameWitness(index,args,state,viewport,OPS,scopes.length||mainEnded||textOpen,pendingClip);if(frame)frames.push(frame);}
      if(pendingClip) {
        const bounds=args?.[0]===OPS.endPath&&clipRectangle(args?.[1],args?.[2]);
        const box=bounds&&state.known&&project(bounds,state.matrix,viewport.transform);
        state.clip=box&&validBox(box)?intersection(state.clip,box):null;pendingClip=false;
      } else if(args?.[0]===OPS.stroke) {
        const bounds=segment(args?.[1],args?.[2],vertical);
        if(bounds&&state.known&&state.width&&state.cap===0&&state.dash&&state.stroke&&state.alpha===1&&
          state.blend==='source-over'&&!state.mask&&!state.transfer&&!scopes.length&&!mainEnded&&!textOpen) {
          const center=project(bounds,state.matrix,viewport.transform);
          // Pinned CanvasGraphics.rescaleAndStroke enforces a one-pixel minimum
          // on the intrinsic viewport canvas. External output transforms are
          // outside this evidence protocol.
          const thickness=Math.max(1,state.width*state.matrix[vertical?0:3]*Math.abs(viewport.transform[vertical?0:3]));
          const box=vertical?{x:center.x-thickness/2,y:center.y,width:thickness,height:center.height}:{x:center.x,y:center.y-thickness/2,width:center.width,height:thickness};
          if(contains(page,box)&&contains(state.clip,box)) {
            if(candidates.length>=256)return fail('candidate-limit');
            candidates.push({operatorIndex:index,line:{x1:center.x,y1:center.y,x2:center.x+center.width,y2:center.y+center.height},box,
              stroke:state.stroke,status:'unverified',occlusion:'unknown',semanticRole:'unknown'});
            continue;
          }
        }
        unsupported.push(index);
      }
    } else if(name==='beginMarkedContentProps'||name==='beginMarkedContent') {
      if(!Array.isArray(args)||typeof args[0]!=='string'||args[0]==='OC'||
        (name==='beginMarkedContentProps'&&args[1]!=null&&(!Number.isSafeInteger(args[1])||args[1]<0)))return fail('unsupported-optional-content');
      if(++marked>128)return fail('marked-content-limit');
    } else if(name==='endMarkedContent') {
      const floor=scopes.at(-1)?.markedDepth??0;
      if(marked<=floor)return fail('unbalanced-marked-content');
      marked--;
    } else if(name==='paintFormXObjectBegin'||name==='beginAnnotation') {
      if(pendingClip||textOpen||scopes.length>=32)return fail('unsupported-resource-scope');
      const kind=name==='beginAnnotation'?'annotation':'form';
      const before=state;
      state={...state,matrix:[...state.matrix]};
      if(kind==='form') {
        const m=args?.[0]??[1,0,0,1,0,0],b=args?.[1];
        if(!axis(m)||!numbers(b,4)||!(b[2]>b[0]&&b[3]>b[1]))return fail('unsupported-form-scope');
        state.matrix=compose(state.matrix,m);
        if(!axis(state.matrix))return fail('unsupported-form-scope');
        state.clip=intersection(state.clip,project(b,state.matrix,viewport.transform));
      } else mainEnded=true;
      scopes.push({kind,before,stackDepth:stack.length,markedDepth:marked});
      excludedScopes.push({kind,operatorIndex:index,status:'excluded',occlusion:'unknown'});
    } else if(name==='paintFormXObjectEnd'||name==='endAnnotation') {
      const s=scopes.pop(),kind=name==='endAnnotation'?'annotation':'form';
      if(!s||s.kind!==kind||pendingClip||textOpen||stack.length!==s.stackDepth||marked!==s.markedDepth)return fail('unbalanced-resource-scope');
      state=s.before;
    } else if(name==='beginText') {
      if(textOpen)return fail('unbalanced-text-scope');textOpen=true;
    } else if(name==='endText') {
      if(!textOpen)return fail('unbalanced-text-scope');textOpen=false;
    } else if(name==='setTextRenderingMode') {
      // pendingTextPaths survives graphics restore and clips at endText.
      // Fail the whole source, rather than allowing a restore to erase it.
      if(!Number.isInteger(args?.[0])||args[0]<0||args[0]>3)return fail('unsupported-text-clip');
    } else if(!ignored.has(name))return fail('unsupported-operator');
  }
  if(stack.length||scopes.length||marked||pendingClip||textOpen)return fail('unbalanced-source-state');
  const result={version,candidates,excludedScopes,unsupported};
  ruleSources.set(candidates,{metadata:ruleMetadataStamp([candidates,unsupported,excludedScopes]),paintIndices:[...paintIndices],paintCoverage,frames,list:operatorList,ops:OPS,frame:JSON.stringify([viewport.width,viewport.height,viewport.transform]),viewport,source:ruleSourceStamp(OPS,operatorList,viewport),snapshot:JSON.stringify(candidates)});
  return result;
}
