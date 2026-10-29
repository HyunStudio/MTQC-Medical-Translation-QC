import {getMappedGlyphPaint,getGlyphPaintCaptureDiagnostic} from './document-glyph-paint.mjs';
import {shareRuleRasterSource} from './document-horizontal-rules.mjs';
import {assessRasterRegion,ruleMetadataStamp} from './document-raster-regions.mjs';
// Native positions and explicit reviewer-declared relationships only. None of
// these DATA objects certify visible ink, semantic math, or human/source review.
const fail=reason=>{throw new RangeError(reason);};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._-]{1,128}$/.test(v);
const integer=(v,max=100000)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const controls=/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
function own(o,k){const d=o&&Object.getOwnPropertyDescriptor(o,k);if(!d||!Object.hasOwn(d,'value'))fail('own-data-required');return d.value;}
function object(o,keys){if(!o||typeof o!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(o)))fail('object-schema');const ks=Reflect.ownKeys(o);if(ks.length!==keys.length||ks.some(k=>!keys.includes(k)))fail('object-fields');return Object.fromEntries(keys.map(k=>[k,own(o,k)]));}
function array(a,max){if(!Array.isArray(a)||Object.getPrototypeOf(a)!==Array.prototype)fail('array-schema');const n=own(a,'length');if(!integer(n,max)||Reflect.ownKeys(a).length!==n+1)fail('array-limit-or-fields');return Array.from({length:n},(_,i)=>own(a,String(i)));}
const sameBox=(a,b)=>['x','y','width','height'].every(k=>a[k]===b[k]);
const contains=(a,b)=>b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width&&b.y+b.height<=a.y+a.height;
const intersects=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
function box(value,frame){const b=object(value,['x','y','width','height']);if(!Object.values(b).every(Number.isFinite)||b.x<0||b.y<0||b.width<=0||b.height<=0||!(b.x+b.width>b.x&&b.y+b.height>b.y)||!contains(frame,b))fail('source-box');return b;}
function inspect(value,binding){
 const l=object(value,['version','frame','sourceBox','literal','tokens','bars','relations','glyphStatus','barStatus']);
 if(l.version!=='native-math-v1')fail('layout-version');
 const dimensions=object(l.frame,['width','height']);if(!Object.values(dimensions).every(v=>Number.isFinite(v)&&v>0&&v<=16384))fail('frame-limit');const frame={x:0,y:0,...dimensions};
 const sourceBox=box(l.sourceBox,frame);let units=0,glyphCount=0;
 const text=v=>{if(typeof v!=='string'||controls.test(v)||/\[\[(?:MTQC:|MATH:|CELL:|NOTE:|\/MTQC\]\])/.test(v)||(units+=v.length)>4096)fail('literal-budget-or-control');return v;};
 const literal=text(l.literal);if(!literal.trim())fail('empty-literal');
 if(!['unknown','mapped-unverified'].includes(l.glyphStatus)||!['unknown','source-bound-unverified'].includes(l.barStatus))fail('inventory-status');
 const ids=new Set(),indices=new Set();const tokens=array(l.tokens,64).map(v=>{
  const t=object(v,['id','sourceIndex','text','box','glyphs']);if(!id(t.id)||ids.has(t.id)||!integer(t.sourceIndex,9999)||indices.has(t.sourceIndex)||!new RegExp('^p[1-9][0-9]*-f'+t.sourceIndex+'$').test(t.id))fail('native-identity');ids.add(t.id);indices.add(t.sourceIndex);
  const b=box(t.box,frame);if(!contains(sourceBox,b))fail('native-source-ownership');const str=text(t.text);if(!str.trim())fail('empty-native-token');
  let glyphs=null;
  if(l.glyphStatus==='unknown'){if(t.glyphs!==null)fail('unknown-glyphs-not-null');}
  else{
   const gs=array(t.glyphs,4096);if(!gs.length||(glyphCount+=gs.length)>4096)fail('glyph-limit');let run=null;
   glyphs=gs.map((raw,index)=>{const g=object(raw,['glyphOrdinal','operatorIndex','unicode','box','painted']);if(g.glyphOrdinal!==index||!integer(g.operatorIndex)||typeof g.unicode!=='string'||g.unicode.length>2||Array.from(g.unicode).length!==1||typeof g.painted!=='boolean')fail('glyph-identity');if(run!==null&&run!==g.operatorIndex)fail('glyph-run');run=g.operatorIndex;const unicode=text(g.unicode);let gb=null;
    if(g.box===null){if(g.painted!==false||unicode!==' ')fail('unknown-glyph-box');}else{gb=box(g.box,frame);if(!contains(sourceBox,gb))fail('glyph-source-ownership');}
    return{glyphOrdinal:g.glyphOrdinal,operatorIndex:g.operatorIndex,unicode,box:gb,painted:g.painted};});
   if(glyphs.map(g=>g.unicode).join('')!==str)fail('glyph-text-conservation');
  }
  return{id:t.id,sourceIndex:t.sourceIndex,text:str,box:b,glyphs};
 });
 if(!tokens.length)fail('empty-native-inventory');
 const barIds=new Set(),ops=new Set();const bars=array(l.bars,32).map(v=>{const b=object(v,['id','operatorIndex','line','box']);if(!id(b.id)||barIds.has(b.id)||!integer(b.operatorIndex)||ops.has(b.operatorIndex))fail('bar-identity');barIds.add(b.id);ops.add(b.operatorIndex);const line=object(b.line,['x1','y1','x2','y2']),bb=box(b.box,frame);if(!Object.values(line).every(Number.isFinite)||line.y1!==line.y2||line.x2<=line.x1||bb.x!==line.x1||bb.width!==line.x2-line.x1||bb.y+bb.height/2!==line.y1||bb.height>2||!contains(sourceBox,bb))fail('bar-source-geometry');return{id:b.id,operatorIndex:b.operatorIndex,line,box:bb};});
 if(l.barStatus==='unknown'&&bars.length)fail('unknown-bars-not-empty');
 const byId=new Map(tokens.map(t=>[t.id,t])),byBar=new Map(bars.map(b=>[b.id,b])),usedBars=new Set(),scriptParent=new Map(),edges=new Map(tokens.map(t=>[t.id,[]]));
 const refs=value=>{const a=array(value,64);if(!a.length||a.some(v=>!id(v)||!byId.has(v))||new Set(a).size!==a.length)fail('relation-token-ids');return a;};
 const takeBar=key=>{if(l.barStatus!=='source-bound-unverified'||!byBar.has(key)||usedBars.has(key))fail('ambiguous-bar-role');usedBars.add(key);return byBar.get(key);};
 const within=(names,b,above)=>names.every(name=>{const t=byId.get(name).box;return t.x>=b.line.x1&&t.x+t.width<=b.line.x2&&(above?t.y+t.height<b.box.y:t.y>b.box.y+b.box.height);});
 const relations=array(l.relations,64).map(raw=>{
  const kind=own(raw,'kind');
  if(kind==='fraction'){const r=object(raw,['kind','barId','numeratorIds','denominatorIds']),b=takeBar(r.barId),n=refs(r.numeratorIds),d=refs(r.denominatorIds);if(n.some(v=>d.includes(v))||!within(n,b,true)||!within(d,b,false))fail('fraction-source-positions');return{kind,barId:r.barId,numeratorIds:n,denominatorIds:d};}
  if(kind==='underbar'||kind==='overbar'){const r=object(raw,['kind','barId','tokenIds']),b=takeBar(r.barId),names=refs(r.tokenIds);if(!within(names,b,kind==='underbar'))fail('bar-source-positions');return{kind,barId:r.barId,tokenIds:names};}
  if(kind==='subscript'||kind==='superscript'){const r=object(raw,['kind','baseId','scriptIds']),names=refs(r.scriptIds);if(!byId.has(r.baseId)||names.includes(r.baseId))fail('script-self-or-base');const base=byId.get(r.baseId).box;for(const name of names){const t=byId.get(name).box;if(scriptParent.has(name)||t.x<base.x||(kind==='subscript'?t.y<=base.y:t.y>=base.y))fail('ambiguous-script-parent-or-position');scriptParent.set(name,r.baseId);edges.get(r.baseId).push(name);}return{kind,baseId:r.baseId,scriptIds:names};}
  fail('unsupported-relation');
 });
 const active=new Set(),done=new Set();function visit(id){if(active.has(id))fail('script-cycle');if(done.has(id))return;active.add(id);for(const child of edges.get(id))visit(child);active.delete(id);done.add(id);}for(const key of ids)visit(key);
 if(binding!==undefined){const f=array(own(binding,'fragmentIds'),64),boundText=own(binding,'text'),boundBox=box(own(binding,'box'),frame);if(f.length!==tokens.length||new Set(f).size!==f.length||f.some(v=>!ids.has(v))||boundText!==literal||!sameBox(sourceBox,boundBox))fail('changed-source-binding');}
 return{version:l.version,frame:dimensions,sourceBox,literal,tokens,bars,relations,glyphStatus:l.glyphStatus,barStatus:l.barStatus};
}
/** Strict ordinary own-DATA validation; not renderer/source authentication. */
export function validateNativeMathLayout(layout,binding){try{return{ok:true,reason:null,layout:freeze(inspect(layout,binding))};}catch(e){return{ok:false,reason:e instanceof Error?e.message:'invalid-layout',layout:null};}}
export function createNativeMathDraft(input={}){
 const unknown=reason=>freeze({status:'unknown',reason,layout:null,counts:null,reviewed:false,sourceReviewed:false,visibility:'unverified'});
 try{
  const record=own(input,'record'),region=own(input,'region'),pageId=own(input,'pageId');if(typeof pageId!=='string'||!/^p[1-9][0-9]*$/.test(pageId)||own(region,'type')!=='equation'||own(region,'provenance')!=='pdf-text')fail('native-equation-required');
  const width=own(record,'width'),height=own(record,'height');if(![width,height].every(v=>Number.isFinite(v)&&v>0&&v<=16384))fail('frame-limit');const frame={x:0,y:0,width,height},sourceBox=box(own(region,'box'),frame),fragments=own(record,'fragments'),native=array(fragments,10000),selected=array(own(region,'fragmentIds'),64);
  if(!selected.length||new Set(selected).size!==selected.length)fail('native-ownership');const chosen=new Set(selected),all=new Map();
  native.forEach((raw,index)=>{const str=own(raw,'text');if(typeof str!=='string')fail('native-text');if(!str.trim())return;const b=box(Object.fromEntries(['x','y','width','height'].map(k=>[k,own(raw,k)])),frame),key=`${pageId}-f${index}`;if(chosen.has(key)){if(!contains(sourceBox,b))fail('crossing-selected-source');all.set(key,{id:key,sourceIndex:index,text:str,box:b,glyphs:null});}else if(intersects(sourceBox,b))fail('crossing-unselected-source');});
  if(selected.some(key=>!all.has(key)))fail('missing-native-source');const tokens=selected.map(key=>all.get(key));
  let glyphDiagnostic=null,glyphStatus='unknown';try{const receipt=Object.getOwnPropertyDescriptor(record,'glyphHints')?.value;glyphDiagnostic=getGlyphPaintCaptureDiagnostic(receipt,{fragments,width,height});const mapped=getMappedGlyphPaint(receipt,{fragments,width,height});if(mapped){const runs=new Map(mapped.fragments.map(f=>[f.sourceIndex,f]));if(tokens.every(t=>runs.get(t.sourceIndex)?.text===t.text)){for(const t of tokens)t.glyphs=runs.get(t.sourceIndex).glyphs.map(g=>({glyphOrdinal:g.glyphOrdinal,operatorIndex:g.operatorIndex,unicode:g.unicode,box:g.box&&{...g.box},painted:g.painted}));glyphStatus='mapped-unverified';}}}catch{}
  let bars=[],barStatus='unknown';try{
   const h=Object.getOwnPropertyDescriptor(record,'ruleHints')?.value,v=Object.getOwnPropertyDescriptor(record,'verticalRuleHints')?.value,raster=Object.getOwnPropertyDescriptor(record,'rasterHints')?.value;
   if(ruleMetadataStamp([h,v])!==null&&h?.width===width&&h?.height===height&&v?.width===width&&v?.height===height&&shareRuleRasterSource(h,v,raster)&&assessRasterRegion(raster,sourceBox).status==='raster-disjoint'){
    const candidates=h.candidates.filter(c=>intersects(sourceBox,c.box));if(candidates.length>32||candidates.some(c=>!contains(sourceBox,c.box)||c.box.height>2||c.stroke.toLowerCase()==='#ffffff')||v.candidates.some(c=>intersects(sourceBox,c.box)))fail('unsupported-math-rule-source');
    bars=candidates.map(c=>({id:`${pageId}-op${c.operatorIndex}`,operatorIndex:c.operatorIndex,line:{...c.line},box:{...c.box}}));barStatus='source-bound-unverified';
   }
  }catch{bars=[];barStatus='unknown';}
  const raw={version:'native-math-v1',frame:{width,height},sourceBox,literal:own(region,'text'),tokens,bars,relations:[],glyphStatus,barStatus};let checked=validateNativeMathLayout(raw,{fragmentIds:selected,text:raw.literal,box:sourceBox});
  // A valid native inventory is still useful if an authentic metric overhang
  // leaves the chosen crop. Do not clamp it or pretend its glyph mapping is complete.
  if(!checked.ok&&glyphStatus==='mapped-unverified'){glyphDiagnostic=freeze({status:'unknown',reason:checked.reason==='glyph-source-ownership'?'glyph-source-ownership':'math-layout-held',phase:'math-region',operatorIndex:null,sourceIndex:null,fact:null,counts:null,sourceReviewed:false,visibility:'unverified'});raw.glyphStatus='unknown';for(const t of tokens)t.glyphs=null;checked=validateNativeMathLayout(raw,{fragmentIds:selected,text:raw.literal,box:sourceBox});}
  if(!checked.ok)fail(checked.reason);
  return freeze({status:'draft',reason:null,layout:checked.layout,diagnostics:{glyph:glyphDiagnostic},counts:{nativeTokens:tokens.length,sourceBars:bars.length},reviewed:false,sourceReviewed:false,visibility:'unverified'});
 }catch(e){return unknown(e instanceof Error?e.message:'unavailable-source');}
}

/** Finite JSON DATA scanner. Detect duplicate members BEFORE JSON.parse; no reviver repair. */
export function parseNativeMathJson(text) {
 try {
  if (typeof text !== 'string' || text.length > 16384) fail('math-json-limit');
  let at=0,nodes=0;
  const ws=()=>{while(/[\t\n\r ]/.test(text[at]??'x'))at++;};
  const string=()=>{const start=at++;for(;at<text.length;at++){if(text[at]==='\\'){at++;continue;}if(text[at]==='"'){at++;return JSON.parse(text.slice(start,at));}}fail('math-json-string');};
  const read=depth=>{if(depth>16||++nodes>4096)fail('math-json-work');ws();const ch=text[at];
   if(ch==='"'){string();return;}
   if(ch==='{'||ch==='['){at++;ws();const end=ch==='{'?'}':']',keys=new Set();if(text[at]===end){at++;return;}
    for(;;){if(ch==='{'){if(text[at]!=='"')fail('math-json-key');const key=string();if(keys.has(key))fail('math-json-duplicate');keys.add(key);ws();if(text[at++]!==':')fail('math-json-colon');}read(depth+1);ws();if(text[at]===end){at++;return;}if(text[at++]!==',')fail('math-json-separator');ws();}
   }
   const m=/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+\-]?[0-9]+)?)/.exec(text.slice(at));if(!m)fail('math-json-value');if(!['true','false','null'].includes(m[0])&&!Number.isFinite(Number(m[0])))fail('math-json-nonfinite');at+=m[0].length;
  };
  read(0);ws();if(at!==text.length)fail('math-json-trailing');return{ok:true,value:JSON.parse(text),reason:null};
 }catch(e){return{ok:false,value:null,reason:e instanceof Error?e.message:'math-json-invalid'};}
}
