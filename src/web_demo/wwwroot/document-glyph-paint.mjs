import { collectHorizontalRules } from './document-horizontal-rules.mjs';
import { install as installPathCustody } from './document-render-path-custody.mjs';

const receipts=new WeakMap(), captureDiagnostics=new WeakMap(), ownedErrors=new WeakMap(), EPS=1e-5;
const finite=(a,n)=>(Array.isArray(a)||ArrayBuffer.isView(a))&&a.length===n&&Array.from(a).every(Number.isFinite);
const exact=(a,b)=>finite(a,b.length)&&b.every((v,i)=>a[i]===v);
const close=(a,b)=>Number.isFinite(a)&&Math.abs(a-b)<=EPS;
const identity=()=>[1,0,0,1,0,0];
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
const fail=reason=>{const error=Error(reason);ownedErrors.set(error,reason);throw error;};
const safeReason=(error,fallback)=>{
  try{const d=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'message'):null;
    return d&&'value'in d&&typeof d.value==='string'&&d.value.length&&d.value.length<=256?d.value:fallback;
  }catch{return fallback;}
};
const sameCallback=(a,b)=>!!a&&!!b&&'value'in a&&'value'in b&&a.value===b.value&&
  a.writable===b.writable&&a.enumerable===b.enumerable&&a.configurable===b.configurable;
// Bounded data snapshot: no accessors, cycles or unbounded nested inventories.
function stamp(value) {
  let nodes=0,characters=0;const active=new Set();
  function visit(v,depth=0){
    if(++nodes>300000||depth>12)fail('source-snapshot-budget');
    if(v===undefined)return ['undefined'];
    if(v===null)return ['null'];
    if(typeof v==='boolean')return ['boolean',v];
    if(typeof v==='number'){if(!Number.isFinite(v))fail('source-snapshot-number');return ['number',v];}
    if(typeof v==='string'){characters+=v.length;if(v.length>4096||characters>2000000)fail('source-snapshot-string');return ['string',v];}
    if(typeof v!=='object'||active.has(v))fail('source-snapshot-type');
    active.add(v);let out;
    if(Array.isArray(v)||ArrayBuffer.isView(v)){
      if(!Number.isSafeInteger(v.length)||v.length>100000)fail('source-snapshot-array');
      const keys=Object.getOwnPropertyNames(v);
      if(Object.getOwnPropertySymbols(v).length||keys.length!==v.length+(Array.isArray(v)?1:0))fail('source-snapshot-array-properties');
      out=['array',[]];for(let i=0;i<v.length;i++)out[1].push(visit(data(v,String(i)),depth+1));
    }else{
      if(![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('source-snapshot-record');
      const keys=Object.getOwnPropertyNames(v);if(keys.length>32||Object.getOwnPropertySymbols(v).length)fail('source-snapshot-record-budget');
      out=['record',[]];for(const key of keys.sort()){if(key.length>256)fail('source-snapshot-key');out[1].push([key,visit(data(v,key),depth+1)]);}
    }
    active.delete(v);return out;
  }
  return JSON.stringify(visit(value));
}
function data(object,key){
  if(!object||typeof object!=='object')fail('source-snapshot-record');
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  if(!descriptor||!('value'in descriptor))fail('source-snapshot-accessor');
  return descriptor.value;
}
// Serialized equality does not establish custody of mutable operand containers.
// Bind descriptor values once; validate only at seal/lookup, with root arrays
// also checked at every dispatch. Unproven renderer cache changes remain held.
function bindContainers(operatorList){
  const links=[],seen=new Set();let nodes=0;
  const visit=(object,depth=0)=>{
    if(!object||typeof object!=='object'||seen.has(object))return;
    if(++nodes>300000||depth>12)fail('source-container-budget');seen.add(object);
    for(const key of Object.getOwnPropertyNames(object)){
      const value=data(object,key);
      if(value&&typeof value==='object'){links.push([object,key,value]);visit(value,depth+1);}
    }
  };
  const fnArray=data(operatorList,'fnArray'),argsArray=data(operatorList,'argsArray');
  visit(fnArray);visit(argsArray);
  return ()=>data(operatorList,'fnArray')===fnArray&&data(operatorList,'argsArray')===argsArray&&
    links.every(([parent,key,value])=>data(parent,key)===value);
}
function sourceFacts(input){
  const OPS=data(input,'OPS'),operatorList=data(input,'operatorList'),content=data(input,'content'),viewport=data(input,'viewport');
  const fnArray=data(operatorList,'fnArray'),argsArray=data(operatorList,'argsArray'),items=data(content,'items'),styles=data(content,'styles');
  const keys=Object.getOwnPropertyNames(OPS);
  if(keys.length>512||Object.getOwnPropertySymbols(OPS).length||!Array.isArray(fnArray)||fnArray.length>100000||
    !Array.isArray(argsArray)||argsArray.length!==fnArray.length||!Array.isArray(items)||items.length>8192)fail('source-snapshot-inventory');
  const ops=keys.sort().map(k=>[k,data(OPS,k)]);
  return stamp({ops,operators:{fnArray,argsArray},native:{items,styles},
    viewport:{width:data(viewport,'width'),height:data(viewport,'height'),transform:data(viewport,'transform')}});
}
const fontKeys=['loadedName','isType3Font','vertical','missingFile','disableFontFace','remeasure','isInvalidPDFjsFont','systemFontInfo','fontMatrix'];
// These are pinned FontFaceObject metadata getters; binary font data is never traversed.
const fontFacts=(font,trace=null)=>{
  if(!trace)return stamp(Object.fromEntries(fontKeys.map(k=>[k,font[k]])));
  const facts={};
  for(const key of fontKeys){trace.fact=key;const value=font[key];stamp(value);facts[key]=value;}
  trace.fact=null;return stamp(facts);
};
function prepare({page,OPS,operatorList,viewport,content,fragments,pdfjsVersion},trace) {
  if(pdfjsVersion!=='6.3.289'||!page?.commonObjs||!OPS||!operatorList||
    !Array.isArray(operatorList.fnArray)||!Array.isArray(operatorList.argsArray)||operatorList.fnArray.length>100000||
    operatorList.fnArray.length!==operatorList.argsArray.length||!Array.isArray(content?.items)||content.items.length>8192||
    !Array.isArray(fragments)||fragments.length>8192)fail('unsupported-input');
  const {width,height,transform:t}=viewport||{};
  if(![width,height].every(n=>Number.isFinite(n)&&n>0)||!finite(t,6)||t[0]<=0||!exact(t,[t[0],0,0,-t[0],0,height]))fail('unsupported-viewport');
  const names=new Map(Object.entries(OPS).filter(([,v])=>Number.isInteger(v)).map(([n,v])=>[v,n]));
  const items=content.items.filter(p=>typeof p?.str==='string'&&p.str.trim());
  if(!items.length||items.length!==fragments.length)fail('native-inventory-mismatch');
  const source=items.map((p,i)=>{
    trace.sourceIndex=i;
    if(!finite(p.transform,6)||p.transform[0]<=0||p.transform[3]<=0||p.transform[1]!==0||p.transform[2]!==0||
      !Number.isFinite(p.width)||p.width<=0||p.dir!=='ltr'||content.styles?.[p.fontName]?.vertical!==false)fail('unsupported-native-item');
    const m=p.transform,s=t[0],f={text:p.str,x:m[4]*s,y:height-m[5]*s-m[3]*s,width:p.width*s,height:m[3]*s};
    if(!sameFragment(f,fragments[i]))fail('native-geometry-mismatch');
    return f;
  });
  trace.sourceIndex=null;
  let s={font:null,size:0,tm:identity(),x:0,y:0,lineX:0,lineY:0,leading:0,text:false};
  const stack=[],expected=new Map(),emptyPaths=[];let itemIndex=0,glyphCount=0,pathCount=0;
  const move=(x,y)=>{if(!Number.isFinite(x)||!Number.isFinite(y))fail('bad-text-position');s.x=s.lineX+=x;s.y=s.lineY+=y;if(!Number.isFinite(s.x)||!Number.isFinite(s.y))fail('bad-text-position');};
  const setFont=a=>{if(!Array.isArray(a)||a.length!==2||typeof a[0]!=='string'||!a[0]||!Number.isFinite(a[1])||a[1]<=0)fail('bad-font-reference');[s.font,s.size]=a;};
  for(let index=0;index<operatorList.fnArray.length;index++) {
    const name=names.get(operatorList.fnArray[index]);
    trace.operatorIndex=index;trace.sourceIndex=null;
    const raw=operatorList.argsArray[index];
    const a=raw==null&&['save','restore','beginText','endText','nextLine'].includes(name)?[]:raw;
    if(!name||!Array.isArray(a))fail('unsupported-operator');
    if(name==='save'){if(s.text||stack.length>=128)fail('unsupported-save');stack.push({...s,tm:[...s.tm]});}
    else if(name==='restore'){if(s.text||!stack.length)fail('unbalanced-graphics');s=stack.pop();}
    else if(name==='transform'){if(!exact(a,identity()))fail('unsupported-source-transform');}
    else if(name==='beginText'){if(s.text)fail('unbalanced-text');s.text=true;s.tm=identity();s.x=s.y=s.lineX=s.lineY=0;}
    else if(name==='endText'){if(!s.text)fail('unbalanced-text');s.text=false;}
    else if(name==='setFont')setFont(a);
    else if(name==='setTextMatrix'){if(a.length!==1||!finite(a[0],6)||!exact(Array.from(a[0]).slice(0,4),[1,0,0,1]))fail('unsupported-text-matrix');s.tm=Array.from(a[0]);s.x=s.y=s.lineX=s.lineY=0;}
    else if(name==='moveText'||name==='setLeadingMoveText'){if(!finite(a,2))fail('bad-text-position');if(name==='setLeadingMoveText')s.leading=-a[1];move(...a);}
    else if(name==='nextLine')move(0,-s.leading);
    else if(name==='setLeading'){if(!finite(a,1))fail('bad-leading');s.leading=a[0];}
    else if(['setCharSpacing','setWordSpacing','setTextRise','setHScale'].includes(name)){if(!finite(a,1)||a[0]!== (name==='setHScale'?100:0))fail('unsupported-text-spacing');}
    else if(name==='setTextRenderingMode'){if(a.length!==1||a[0]!==0)fail('unsupported-text-paint-mode');}
    else if(name==='setGState'){
      if(!Array.isArray(a[0]))fail('bad-graphics-state');
      for(const entry of a[0]){if(!Array.isArray(entry)||entry.length!==2)fail('bad-graphics-state');const[k,v]=entry;
        if(k==='Font')setFont(v);
        else if(['ca','CA'].includes(k)){if(v!==1)fail('unsupported-alpha');}
        else if(k==='BM'){if(v!=='source-over')fail('unsupported-blend');}
        else if(k==='SMask'){if(v!==false)fail('unsupported-mask');}
        else if(k==='TR'){if(v!==null)fail('unsupported-transfer');}
        else if(!['LW','LC','LJ','ML','D','RI','FL'].includes(k))fail('unsupported-graphics-state');
      }
    } else if(name==='showText'){
      if(!s.text||!s.font||!s.size||a.length!==1||!Array.isArray(a[0])||!a[0].length||a[0].length>32768-glyphCount)fail('unsupported-glyph-run');
      const glyphs=[];let advance=0;
      for(const g of a[0]){
        if(!g||typeof g!=='object')fail('unsupported-glyph-record');
        if(typeof g.unicode!=='string'||Array.from(g.unicode).length!==1)fail('unsupported-glyph-unicode');
        if(typeof g.fontChar!=='string'||Array.from(g.fontChar).length!==1)fail('unsupported-font-char');
        if(!Number.isFinite(g.width)||g.width<0||(!g.isSpace&&g.width===0))fail('unsupported-glyph-width');
        if(g.isInFont!==true&&!(g.isInFont===false&&g.isSpace===true&&g.unicode===' '))fail('glyph-not-in-font');
        if(g.accent)fail('unsupported-glyph-accent');
        if(g.vmetric)fail('unsupported-glyph-vmetric');
        glyphs.push({unicode:g.unicode,fontChar:g.fontChar,paintExpected:g.isInFont===true,isSpace:g.isSpace===true,x:(s.tm[4]+s.x+advance)*t[0],y:height-(s.tm[5]+s.y)*t[0]});
        advance+=g.width*(s.size*.001);if(!Number.isFinite(advance))fail('glyph-advance-overflow');
      }
      const item=items[itemIndex];
      if(!item||item.str!==glyphs.map(g=>g.unicode).join('')||item.fontName!==s.font||
        !close(item.transform[0],s.size)||!close(item.transform[3],s.size)||!close(item.transform[4],s.tm[4]+s.x)||
        !close(item.transform[5],s.tm[5]+s.y)||!close(item.width,advance))fail('native-run-mismatch');
      trace.sourceIndex=itemIndex;
      expected.set(index,{fontSize:s.size,fontId:s.font,sourceIndex:itemIndex++,glyphs,seen:0,observed:[]});glyphCount+=glyphs.length;s.x+=advance;
    } else if(name==='constructPath'){
      if(++pathCount>256)fail('unsupported-path');
      if(a[0]===OPS.endPath){
        // Only an exact empty discard immediately preceding a stroke. No
        // nonempty discarded paths, clipping, text scope, or cache exception.
        const next=operatorList.argsArray[index+1];
        if(s.text||a.length!==3||!Array.isArray(a[1])||a[1].length!==1||a[1][0]!==null||a[2]!==null||
          operatorList.fnArray[index+1]!==OPS.constructPath||!Array.isArray(next)||next[0]!==OPS.stroke)fail('unsupported-path');
        emptyPaths.push(index);
      }else if(a[0]!==OPS.stroke)fail('unsupported-path');
    }
    else if(['dependency','setFillRGBColor','setStrokeRGBColor','setLineWidth','setLineCap','setLineJoin','setMiterLimit','setDash','setRenderingIntent'].includes(name)){
      // These do not advance text. Any path's actual state is checked by the
      // independent pinned horizontal-rule collector below. No visibility claim.
    } else fail('unsupported-source-profile');
  }
  trace.operatorIndex=null;trace.sourceIndex=null;
  if(stack.length||s.text||itemIndex!==items.length)fail('incomplete-source-inventory');
  let rules=[];
  if(pathCount){
    // Derived collector-only no-op slots preserve original stroke indices;
    // the raw source/render arrays and their custody bindings stay unchanged.
    let ruleOperators=operatorList;
    if(emptyPaths.length){
      ruleOperators={fnArray:[...operatorList.fnArray],argsArray:[...operatorList.argsArray]};
      for(const index of emptyPaths){ruleOperators.fnArray[index]=OPS.dependency;ruleOperators.argsArray[index]=[];}
    }
    const h=collectHorizontalRules({OPS,operatorList:ruleOperators,viewport,pdfjsVersion});
    if(h.candidates.length!==pathCount-emptyPaths.length||h.unsupported.length)fail('unsupported-rule-paint');rules=freeze(h.candidates);
  }
  return {expected,source,width:Math.ceil(width),height:Math.ceil(height),glyphCount,pathCount,rules};
}
function sameFragment(a,b){return b&&a.text===b.text&&['x','y','width','height'].every(k=>close(a[k],b[k]));}
function fontIsSupported(font){return font&&font.isType3Font===false&&font.vertical===false&&font.missingFile===false&&
  font.disableFontFace===false&&font.remeasure!==true&&font.isInvalidPDFjsFont!==true&&!font.systemFontInfo&&
  typeof font.loadedName==='string'&&!!font.loadedName&&(font.fontMatrix===undefined||exact(font.fontMatrix,[.001,0,0,.001,0,0]));}

// Optional trusted application adapter. Absence retains legacy proof/holds.
function metadataAdapter(input) {
  const descriptor=Object.getOwnPropertyDescriptor(input,'fontMetadata');if(!descriptor)return null;
  const object=data(input,'fontMetadata');if(!object||typeof object!=='object'||Object.getOwnPropertyNames(object).sort().join(',')!=='capture,read'||Object.getOwnPropertySymbols(object).length)fail('unsupported-font-adapter');
  const capture=Object.getOwnPropertyDescriptor(object,'capture'),read=Object.getOwnPropertyDescriptor(object,'read');
  if(!capture||!read||!('value'in capture)||!('value'in read)||typeof capture.value!=='function'||typeof read.value!=='function')fail('unsupported-font-adapter');
  return {capture:font=>Reflect.apply(capture.value,object,[font]),read:(receipt,font)=>Reflect.apply(read.value,object,[receipt,font]),valid:()=>sameCallback(Object.getOwnPropertyDescriptor(input,'fontMetadata'),descriptor)&&sameCallback(Object.getOwnPropertyDescriptor(object,'capture'),capture)&&sameCallback(Object.getOwnPropertyDescriptor(object,'read'),read)};
}
function cssFamilies(text){
  if(typeof text!=='string'||text.length>512||/[\\;{}()\n\r]/.test(text))fail('unsupported-system-css');
  const parts=text.match(/"[A-Za-z0-9_ -]+"|'[A-Za-z0-9_ -]+'|[A-Za-z0-9_-]+(?: +[A-Za-z0-9_-]+)*/g);
  if(!parts?.length||parts.length>16||parts.join(',').replace(/ /g,'')!==text.replace(/ /g,''))fail('unsupported-system-css');
  return parts.map(x=>x.replace(/^["']|["']$/g,'').trim());
}
const weightName=value=>value==='400'?'normal':value==='700'?'bold':value;
function systemCanvasFont(ctx,font,run,viewport){
  const m=/^(.*?)\b(\d+(?:\.\d+)?)px\s+(.+)$/.exec(ctx.font);if(!m)fail('unsupported-system-css');
  const prefix=m[1].trim().split(/\s+/).filter(Boolean);if(prefix.length>3||prefix.some(p=>!['normal','italic','bold','900'].includes(p)))fail('unsupported-system-css');
  const italic=prefix.includes('italic')?'italic':'normal',weight=prefix.includes('900')?'900':prefix.includes('bold')?'bold':'normal';
  if(italic!==(font.italic?'italic':'normal')||weight!==(font.black?'900':font.bold?'bold':'normal')||
    italic!==font.system.style||weightName(font.system.weight)!==weight||
    !close(Number(m[2]),Math.max(16,Math.min(100,run.fontSize)))||JSON.stringify(cssFamilies(m[3]))!==JSON.stringify(cssFamilies(font.system.css)))fail('unsupported-system-css');
  const t=ctx.getTransform();if(!close(Number(m[2])*t.a,run.fontSize*viewport.transform[0])||!close(Number(m[2])*t.d,run.fontSize*viewport.transform[0]))fail('unsupported-system-font-scale');
}
// Only realm FontFace/FontFaceSet prototype getters/methods and own DATA are
// allowed. Replacing instance accessors never grants a callback into capture.
const fontPrototypeIncludes=Object.prototype.isPrototypeOf;
const equalFontDescriptor=(a,b)=>!a||!b?a===b:['get','set','value','writable','enumerable','configurable'].every(k=>a[k]===b[k]);
function fontRegistrationReaders(){
  const pinned=[],chains=new Map();
  const chain=object=>{const path=[];let current=object;while(current){if(path.length>=8)fail('unsupported-font-registration');path.push(current);current=Object.getPrototypeOf(current);}return path;};
  const pathValid=(object,path)=>{const current=chain(object);return current.length===path.length&&current.every((value,i)=>value===path[i]);};
  const bindPath=object=>{const path=chains.get(object);if(path){if(!pathValid(object,path))fail('changed-font-registration');}else{if(chains.size>=512)fail('unsupported-font-registration');chains.set(object,chain(object));}};
  const bind=(owner,key)=>{
    const current=Object.getOwnPropertyDescriptor(owner,key),prior=pinned.find(p=>p.owner===owner&&p.key===key);
    if(prior){if(!equalFontDescriptor(current,prior.descriptor))fail('changed-font-registration');}
    else pinned.push({owner,key,descriptor:current});return current;
  };
  const valid=()=>[...chains].every(([object,path])=>pathValid(object,path))&&pinned.every(p=>equalFontDescriptor(Object.getOwnPropertyDescriptor(p.owner,p.key),p.descriptor));
  const locate=(object,key)=>{let proto=Object.getPrototypeOf(object),depth=0;while(proto&&++depth<=4){const d=Object.getOwnPropertyDescriptor(proto,key);if(d)return{owner:proto,descriptor:d};proto=Object.getPrototypeOf(proto);}return null;};
  const member=(object,Type,key,method=false)=>{
    if(!Type?.prototype||!object||typeof object!=='object'||!Reflect.apply(fontPrototypeIncludes,Type.prototype,[object]))fail('unsupported-font-registration');
    bindPath(object);bind(Type.prototype,'isPrototypeOf');const own=bind(object,key),located=locate(object,key);
    if(own){
      // Real platform getter facts cannot be fabricated by own DATA shadows.
      // The simulated fixture's getter-less optional DATA remains only SOFTWARE.
      if(!('value'in own)||method||located?.descriptor?.get||typeof own.value!=='string'||own.value.length>512)fail('unsupported-font-registration');
      return own.value;
    }
    if(!located||located.owner!==Type.prototype)fail('unsupported-font-registration');const d=bind(located.owner,key);
    if(method){if(!('value'in d)||typeof d.value!=='function')fail('unsupported-font-registration');return Reflect.apply(d.value,object,[]);}
    if(typeof d.get!=='function')fail('unsupported-font-registration');const value=Reflect.apply(d.get,object,[]);
    if(typeof value!=='string'||value.length>512)fail('unsupported-font-registration');return value;
  };
  let iteratorPrototype=null,iteratorNext=null,nextOwner=null,nextDescriptor=null;
  const enumerate=iterator=>{
    if(!iterator||typeof iterator!=='object'||Object.getOwnPropertyDescriptor(iterator,'next'))fail('unsupported-font-registration');
    const proto=Object.getPrototypeOf(iterator),located=locate(iterator,'next');
    if(!located||!('value'in located.descriptor)||typeof located.descriptor.value!=='function')fail('unsupported-font-registration');
    if(!iteratorNext){iteratorPrototype=proto;iteratorNext=located.descriptor.value;nextOwner=located.owner;nextDescriptor=bind(nextOwner,'next');}
    if(proto!==iteratorPrototype||located.owner!==nextOwner||!equalFontDescriptor(located.descriptor,nextDescriptor)||!valid())fail('changed-font-registration');
    const all=[];for(;;){if(!valid())fail('changed-font-registration');const item=Reflect.apply(iteratorNext,iterator,[]);if(!item||typeof item!=='object')fail('unsupported-font-registration');if(item.done)return all;if(all.length>=128)fail('unsupported-font-registration');all.push(item.value);}
  };
  return {member,enumerate,valid};
}
function registeredSystemProfile(ctx,font,viewport){
  const canvas=ctx.canvas,document=canvas?.ownerDocument,fontset=document?.fonts,Face=document?.defaultView?.FontFace,Faces=document?.defaultView?.FontFaceSet;
  if(!canvas||canvas.isConnected!==true||!fontset||!Face||!Faces||font.system.guessFallback!==false||!cssFamilies(font.system.css).includes(font.system.loadedName))fail('unsupported-font-registration');
  const facePrototype=Face.prototype,setPrototype=Faces.prototype,width=canvas.width,height=canvas.height;
  // Mock SOFTWARE canvases have no backing dimensions; real provided dimensions
  // must match the exact viewport frame and never change. No crop adjustment.
  if((width!==undefined||height!==undefined)&&(width!==Math.ceil(viewport.width)||height!==Math.ceil(viewport.height)))fail('unsupported-font-frame');
  const fields=['family','status','style','weight','unicodeRange','stretch','featureSettings','variationSettings'],readers=fontRegistrationReaders();
  let members=null;
  const collect=()=>{
    if(ctx.canvas!==canvas||canvas.ownerDocument!==document||document.fonts!==fontset||document.defaultView?.FontFace!==Face||document.defaultView?.FontFaceSet!==Faces||Face.prototype!==facePrototype||Faces.prototype!==setPrototype||canvas.isConnected!==true||canvas.width!==width||canvas.height!==height||!readers.valid())fail('changed-font-registration');
    const all=readers.enumerate(readers.member(fontset,Faces,'values',true)),matches=[];
    if(members&&(all.length!==members.length||all.some((face,i)=>face!==members[i])))fail('changed-font-registration');
    if(!members)members=[...all];
    for(const face of all){const family=readers.member(face,Face,'family');if(family.replace(/^["']|["']$/g,'')===font.system.loadedName)matches.push(face);}
    if(matches.length!==1)fail('unsupported-font-registration');const face=matches[0],facts=Object.fromEntries(fields.map(k=>[k,readers.member(face,Face,k)]));
    if(facts.status!=='loaded'||facts.style!==font.system.style||weightName(facts.weight)!==weightName(font.system.weight)||facts.unicodeRange.toUpperCase()!=='U+0-10FFFF'||['stretch','featureSettings','variationSettings'].some(k=>facts[k]!=='normal'))fail('unsupported-font-registration');
    return {face,snapshot:stamp(facts)};
  };
  const original=collect();return {valid:()=>{const current=collect();return current.face===original.face&&current.snapshot===original.snapshot;}};
}
function supportedSystemMetadata(font){
  return font&&font.isType3Font===false&&font.vertical===false&&font.disableFontFace===false&&font.remeasure!==true&&font.isInvalidPDFjsFont!==true&&
    typeof font.loadedName==='string'&&!!font.loadedName&&font.system&&typeof font.system.loadedName==='string'&&!!font.system.loadedName&&
    (font.fontMatrix===undefined||exact(font.fontMatrix,[.001,0,0,.001,0,0]));
}

/** Additive diagnostic mapping only. No caller may use these Canvas geometric
 * metrics as a visibility, pixel-coverage, source-review or application gate. */
export function beginGlyphPaintCapture(input={}) {
  let prepared,sourceStamp,opStamps,sourceContainers,sourceList,renderContainers,renderFns,renderArgs,
    reason=null,current=-1,done=false,result,renderList,strictPaths=false,pathHandle,pathState,
    graphics,graphicsCallback,listCallback,numericShadow,adapter=null,usedSystem=false;
  const fonts=new Map(),seenOps=new Set();
  const trace={phase:'snapshot',operatorIndex:null,sourceIndex:null,fact:null};let failure=null;
  const reject=(message,location,code)=>{
    if(reason!==null)return;
    reason=message;failure={...location,code,fact:fontKeys.includes(location.fact)?location.fact:null};
  };
  const caught=(error,fallback,location)=>reject(safeReason(error,fallback),location,ownedErrors.get(error)||null);
  const at=(phase,index=null)=>{
    const operatorIndex=Number.isSafeInteger(index)&&index>=0&&index<(opStamps?.length||0)?index:null;
    return {phase,operatorIndex,sourceIndex:operatorIndex===null?null:prepared?.expected.get(operatorIndex)?.sourceIndex??null,fact:null};
  };
  const bad=(message,phase='paint',index=current)=>reject(message,at(phase,index),message);
  // Capture diagnostics confer no mapping or review authority. Bind only the
  // exact caller fragment object/snapshot and frame, independently of prepare.
  let diagnosticSource=null;
  try {
    const fragments=data(input,'fragments'),viewport=data(input,'viewport'),width=data(viewport,'width'),height=data(viewport,'height');
    if(Array.isArray(fragments)&&fragments.length<=8192&&[width,height].every(n=>Number.isFinite(n)&&n>0&&n<=16384))
      diagnosticSource={fragments,width:Math.ceil(width),height:Math.ceil(height),snapshot:stamp(fragments)};
  } catch {}
  const common=input.page?.commonObjs,get=common?.get,has=common?.has;
  try{adapter=metadataAdapter(input);sourceStamp=sourceFacts(input);trace.phase='prepare';prepared=prepare(input,trace);sourceList=input.operatorList;sourceContainers=bindContainers(sourceList);opStamps=input.operatorList.fnArray.map((fn,i)=>stamp([fn,input.operatorList.argsArray[i]]));
    // Own option presence selects strict proof; text-only pages need no gfx.
    strictPaths=prepared.pathCount>0&&Object.hasOwn(input,'renderGraphics');
  }catch(e){caught(e,'unsupported-input',trace);}
  const ctx=input.context,descriptors={},installed=[];
  const restore=()=>{for(const key of installed){try{if(descriptors[key])Object.defineProperty(ctx,key,descriptors[key]);else delete ctx[key];}catch{bad('context-restore-failed','cleanup',null);}}};
  // The first-failure recorder is initialized before source preparation.
  const callbacksValid=()=>sameCallback(Object.getOwnPropertyDescriptor(input,'renderGraphics'),graphicsCallback)&&
    sameCallback(Object.getOwnPropertyDescriptor(input,'renderOperatorList'),listCallback);
  const bindCallbacks=()=>{
    graphicsCallback=Object.getOwnPropertyDescriptor(input,'renderGraphics');listCallback=Object.getOwnPropertyDescriptor(input,'renderOperatorList');
    if(!graphicsCallback||!('value'in graphicsCallback)||typeof graphicsCallback.value!=='function'||
      !listCallback||!('value'in listCallback)||typeof listCallback.value!=='function')fail('path-custody-observation-failed');
    for(const [key,value]of Object.entries({constructPath:91,stroke:20,endPath:28,save:10,restore:11,beginText:31,endText:32}))
      if(data(input.OPS,key)!==value)fail('unsupported-path-ops');
  };
  const currentActual=()=>{
    if(!callbacksValid())fail('changed-path-callback');
    return Reflect.apply(listCallback.value,input,[]);
  };
  const currentGraphics=()=>{
    if(!callbacksValid())fail('changed-path-callback');
    const value=Reflect.apply(graphicsCallback.value,input,[]);
    if(!value||typeof value!=='object')fail('missing-render-graphics');
    if(graphics&&value!==graphics)fail('changed-render-graphics');
    return value;
  };
  const resourcesValid=()=>input.page?.commonObjs===common&&common?.get===get&&common?.has===has&&(!adapter||adapter.valid())&&[...fonts.values()].every(f=>
    (adapter?stamp(adapter.read(f.receipt,f.object)):fontFacts(f.object))===f.stamp&&(!f.profile||f.profile.valid()));
  // Lookup checks descriptors without invoking private task getters after seal.
  const sourceBindingsValid=()=>(!strictPaths||callbacksValid())&&input.operatorList===sourceList&&sourceContainers()&&renderContainers?.()&&
    sourceFacts(input)===sourceStamp&&resourcesValid()&&renderList&&stamp({fnArray:renderList.fnArray,argsArray:renderList.argsArray})===stamp({fnArray:input.operatorList.fnArray,argsArray:input.operatorList.argsArray});
  const skipSpaces=(run,index)=>{while(run&&run.seen<run.glyphs.length&&!run.glyphs[run.seen].paintExpected){const g=run.glyphs[run.seen];run.observed.push({unicode:g.unicode,fontChar:g.fontChar,operatorIndex:index,glyphOrdinal:run.seen,box:null,painted:false});run.seen++;}};
  if(prepared)try{
    for(const key of ['fillText','strokeText']){if(typeof ctx?.[key]!=='function')fail('missing-context-method');descriptors[key]=Object.getOwnPropertyDescriptor(ctx,key);}
    const originalFill=ctx.fillText,originalStroke=ctx.strokeText;
    ctx.fillText=function(text,x,y,...rest){
      if(!done&&!reason)try{
        Object.assign(trace,at('paint',current));
        const run=prepared.expected.get(current);skipSpaces(run,current);const g=run?.glyphs[run.seen];
        if(!g||text!==g.fontChar||rest.length||!Number.isFinite(x)||!Number.isFinite(y))fail('paint-call-mismatch');
        if(!input.page.commonObjs.has(run.fontId))fail('unresolved-painted-font');
        const font=input.page.commonObjs.get(run.fontId);
        const known=fonts.get(run.fontId);let facts=font,snapshot,receipt=known?.receipt,profile=known?.profile;
        if(adapter){
          if(!adapter.valid())fail('changed-font-adapter');
          if(!known)receipt=adapter.capture(font);
          facts=adapter.read(receipt,font);if(!facts)fail('unsupported-font-metadata');snapshot=stamp(facts);
          if(facts.system){
            if(!supportedSystemMetadata(facts))fail('unsupported-painted-font');
            systemCanvasFont(this,facts,run,input.viewport);
            if(!profile)profile=registeredSystemProfile(this,facts,input.viewport);else if(!profile.valid())fail('changed-font-registration');
            usedSystem=true;
          }else if(!fontIsSupported(facts)||!this.font.split(/[\s,"']+/).includes(facts.loadedName))fail('unsupported-painted-font');
        }else{snapshot=fontFacts(font,trace);if(!fontIsSupported(font)||!this.font.split(/[\s,"']+/).includes(font.loadedName))fail('unsupported-painted-font');}
        if(known&&(known.object!==font||known.stamp!==snapshot))fail('changed-painted-font');fonts.set(run.fontId,{object:font,stamp:snapshot,receipt,profile});
        let direction=this.direction;
        if(direction==='inherit'&&typeof getComputedStyle==='function'&&this.canvas?.ownerDocument?.documentElement)direction=getComputedStyle(this.canvas.ownerDocument.documentElement).direction;
        if(direction!=='ltr'||!['start','left'].includes(this.textAlign)||this.textBaseline!=='alphabetic'||this.globalAlpha!==1||
          this.globalCompositeOperation!=='source-over'||this.filter!=='none'||this.shadowBlur!==0||this.shadowOffsetX!==0||this.shadowOffsetY!==0)fail('unsupported-context-state');
        const t=this.getTransform(),matrix=[t.a,t.b,t.c,t.d,t.e,t.f];
        if(!finite(matrix,6)||t.a<=0||t.d<=0||t.b!==0||t.c!==0||!close(t.a*x+t.e,g.x)||!close(t.d*y+t.f,g.y))fail('paint-position-mismatch');
        const m=this.measureText(text),values=[m.actualBoundingBoxLeft,m.actualBoundingBoxRight,m.actualBoundingBoxAscent,m.actualBoundingBoxDescent];
        if(!values.every(Number.isFinite))fail('unsupported-text-metrics');
        const left=t.a*(x-values[0])+t.e,right=t.a*(x+values[1])+t.e,top=t.d*(y-values[2])+t.f,bottom=t.d*(y+values[3])+t.f;
        let box=null;
        if(left<right&&top<bottom)box={x:left,y:top,width:right-left,height:bottom-top};
        else if(!g.isSpace||left!==right||top!==bottom)fail('empty-nonspace-metrics');
        if(box&&(!Object.values(box).every(Number.isFinite)||box.x<0||box.y<0||box.x+box.width>prepared.width||box.y+box.height>prepared.height))fail('paint-metrics-out-of-frame');
        run.observed.push({unicode:g.unicode,fontChar:g.fontChar,operatorIndex:current,glyphOrdinal:run.seen,box,painted:true});run.seen++;
      }catch(e){caught(e,'paint-observation-failed',trace);}
      try{return originalFill.call(this,text,x,y,...rest);}catch(e){bad('original-draw-failed');throw e;}
    };installed.push('fillText');
    ctx.strokeText=function(...args){bad('unsupported-stroke-text');return originalStroke.apply(this,args);};installed.push('strokeText');
  }catch(e){caught(e,'context-install-failed',at('install'));restore();}
  return {
    operationsFilter(index){
      if(!done&&!reason)try{
        if(!Number.isInteger(index)||index<0||index>=opStamps.length)fail('unbound-operator-index');
        if(strictPaths){if(!listCallback)bindCallbacks();else if(!callbacksValid())fail('changed-path-callback');}
        const actual=strictPaths?currentActual():input.renderOperatorList?.();
        if(!actual||!Array.isArray(actual.fnArray)||!Array.isArray(actual.argsArray)||actual.fnArray.length>100000||actual.argsArray.length!==actual.fnArray.length)fail('missing-render-list-proof');
        // A streamed partial inventory cannot bind containers that have not
        // arrived yet. Keep that diagnostic unknown rather than bind lazily.
        if(actual.fnArray.length!==opStamps.length)fail('incomplete-render-list');
        if(renderList&&renderList!==actual)fail('changed-render-list');
        if(!renderList){
          stamp({fnArray:actual.fnArray,argsArray:actual.argsArray});
          renderList=actual;renderFns=actual.fnArray;renderArgs=actual.argsArray;renderContainers=bindContainers(actual);
        }
        if(actual.fnArray!==renderFns||actual.argsArray!==renderArgs)fail('changed-render-containers');
        if(stamp([actual.fnArray[index],actual.argsArray[index]])!==opStamps[index])fail('render-operator-mismatch');
        if(strictPaths){
          const live=currentGraphics();
          if(!pathHandle){
            graphics=live;
            pathHandle=installPathCustody({graphics,prepared:sourceList,actual:renderList,getActual:currentActual});
            numericShadow=Object.getOwnPropertyDescriptor(graphics,'91');
            if(!numericShadow||!('value'in numericShadow)||typeof numericShadow.value!=='function')fail('path-custody-incomplete');
          }else if(!sameCallback(Object.getOwnPropertyDescriptor(graphics,'91'),numericShadow))fail('changed-path-hook');
        }
        seenOps.add(index);
      }catch(e){caught(e,strictPaths?'path-custody-observation-failed':'render-list-proof-failed',at('dispatch',index));}
      current=index;return true;
    },
    finish(renderSucceeded){
      if(done)return result;done=true;
      if(strictPaths){
        // Dispose after every success/failure/hold; never leak a helper lease.
        try{if(!reason&&pathHandle)currentGraphics();}catch(e){caught(e,'path-custody-observation-failed',at('seal'));}
        try{pathState=pathHandle?.dispose();}catch{bad('path-custody-cleanup-failed','cleanup',null);}
        pathState||={complete:false,methodRestored:false,calls:[],problems:['no-path-custody']};
        if(!pathState.complete||!pathState.methodRestored)bad('path-custody-incomplete','seal',null);
      }
      restore();
      if(renderSucceeded!==true)bad('render-not-complete','seal',null);
      if(prepared&&!reason)try{if(seenOps.size!==opStamps.length||!sourceBindingsValid())bad('changed-source-binding','seal',null);}catch(e){caught(e,'changed-source-binding',at('seal'));}
      if(prepared)for(const [index,run]of prepared.expected)skipSpaces(run,index);
      if(prepared&&[...prepared.expected.values()].some(r=>r.seen!==r.glyphs.length))bad('missing-glyph-observation','seal',null);
      const fragments=!reason&&prepared?[...prepared.expected.values()].map(r=>({sourceIndex:r.sourceIndex,text:prepared.source[r.sourceIndex].text,operatorIndex:r.observed[0]?.operatorIndex,glyphs:r.observed})):[];
      result=freeze({version:'pdfjs-simple-glyph-map-v1',complete:!reason,visibility:'unverified',sourceReviewed:false,paddingPx:0,
        boundsKind:'canvas-measured-geometric',...(usedSystem?{fontProfile:'system-css-measured-unverified'}:{}),fragments,unsupported:reason?[reason]:[],...(strictPaths?{pathCustody:pathState}:{})});
      if(diagnosticSource)captureDiagnostics.set(result,{...diagnosticSource,complete:!reason,reason:captureDiagnosticReason(reason,failure?.code),phase:failure?.phase??null,operatorIndex:failure?.operatorIndex??null,sourceIndex:failure?.sourceIndex??null,fact:failure?.fact??null});
      if(!reason)receipts.set(result,{fragments:input.fragments,source:prepared.source,width:prepared.width,height:prepared.height,
        bindingsValid:sourceBindingsValid,rules:prepared.rules});
      return result;
    }
  };
}

export function getMappedGlyphPaint(receipt,{fragments,width,height}={}) {
  const bound=receipt&&typeof receipt==='object'?receipts.get(receipt):null;
  if(!bound||receipt.complete!==true||fragments!==bound.fragments||width!==bound.width||height!==bound.height||
    fragments.length!==bound.source.length||!bound.source.every((f,i)=>sameFragment(f,fragments[i])))return null;
  try{if(!bound.bindingsValid())return null;}catch{return null;}
  return freeze({status:'mapped-unverified',sourceReviewed:false,visibility:'unverified',...(receipt.fontProfile?{fontProfile:receipt.fontProfile}:{}),fragments:receipt.fragments});
}

const captureDiagnosticReason=(reason,code)=>reason===null?null:typeof code==='string'&&/^[a-z][a-z0-9-]{0,95}$/.test(code)?code:'capture-held';
/** Renderer-produced refusal/status DATA only, never source or mapping authority.
 * A serialized receipt or a changed caller inventory cannot supply this hint. */
export function getGlyphPaintCaptureDiagnostic(receipt,args={}) {
  try {
    const bound=receipt&&typeof receipt==='object'?captureDiagnostics.get(receipt):null;
    if(!bound)return null;
    const fragments=data(args,'fragments'),width=data(args,'width'),height=data(args,'height');
    if(fragments!==bound.fragments||width!==bound.width||height!==bound.height||stamp(fragments)!==bound.snapshot)return null;
    const mapped=bound.complete?getMappedGlyphPaint(receipt,{fragments,width,height}):null;
    return freeze({status:mapped?'mapped-unverified':'unknown',reason:bound.complete?(mapped?null:'source-binding-unavailable'):bound.reason,
      phase:bound.complete?(mapped?null:'lookup'):bound.phase,operatorIndex:bound.complete?null:bound.operatorIndex,sourceIndex:bound.complete?null:bound.sourceIndex,fact:bound.complete?null:bound.fact,
      counts:null,sourceReviewed:false,visibility:'unverified',...(mapped?.fontProfile?{fontProfile:mapped.fontProfile}:{})});
  } catch {return null;}
}

/** Geometric diagnostic only. These labels never clear source review, original
 * native-box holds, table admission, or unknown visible/antialias paint. */
export function assessGlyphRuleGeometry(receipt,args={}) {
  const unknown=reason=>freeze({status:'unknown',reason,visibility:'unverified',sourceReviewed:false,
    mappedGlyphPositions:null,paintedGlyphBoxes:null,skippedSpaces:null,ruleCount:null,pairDenominator:null,
    crossingPairs:null,touchingPairs:null,sourceIndices:[],pairs:[]});
  try {
    const fragments=data(args,'fragments'),width=data(args,'width'),height=data(args,'height'),
      region=data(args,'region'),indices=data(args,'sourceIndices');
    if(!Array.isArray(fragments)||fragments.length>8192||!Array.isArray(indices)||!indices.length||indices.length>8192)fail('selection-schema');
    // Descriptor-safe snapshot validation precedes all source/selection access.
    stamp(fragments);stamp(indices);
    if(!region||Object.getOwnPropertyNames(region).length!==4||Object.getOwnPropertySymbols(region).length)fail('region-schema');
    const box=Object.fromEntries(['x','y','width','height'].map(k=>[k,data(region,k)]));
    if(![width,height].every(n=>Number.isFinite(n)&&n>0)||!Object.values(box).every(Number.isFinite)||
      box.x<0||box.y<0||box.width<=0||box.height<=0||box.x+box.width>width||box.y+box.height>height)fail('region-bounds');
    const selected=new Set();for(const id of indices){if(!Number.isInteger(id)||id<0||id>=fragments.length||selected.has(id))fail('source-selection');selected.add(id);}
    const mapped=getMappedGlyphPaint(receipt,{fragments,width,height}),bound=receipts.get(receipt);
    if(!mapped||!bound)fail('unbound-source');
    const contains=(outer,inner)=>inner.x>=outer.x&&inner.y>=outer.y&&inner.x+inner.width<=outer.x+outer.width&&inner.y+inner.height<=outer.y+outer.height;
    const contact=(a,b)=>a.x<=b.x+b.width&&a.x+a.width>=b.x&&a.y<=b.y+b.height&&a.y+a.height>=b.y;
    const positive=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
    const glyphs=[];let positions=0,spaces=0;
    for(const fragment of mapped.fragments){
      if(fragment.glyphs.some(g=>!g.box&&!(g.painted===false&&g.unicode===' ')))fail('unknown-glyph-geometry');
      const native=bound.source[fragment.sourceIndex],chosen=selected.has(fragment.sourceIndex);
      // A glyph may extend beyond nominal font height. Include those boundary
      // intrusions as well as original native boxes in region custody checks.
      const enters=contact(native,box)||fragment.glyphs.some(g=>g.box&&contact(g.box,box));
      if(enters&&!chosen)fail('omitted-region-source');
      if(!chosen)continue;
      if(!contains(box,native))fail('native-region-boundary');
      for(const g of fragment.glyphs){positions++;
        if(g.painted===false&&g.unicode===' '&&g.box===null){spaces++;continue;}
        if(!g.box)fail('unknown-glyph-geometry');
        if(!contains(box,g.box))fail('glyph-region-boundary');
        glyphs.push({sourceIndex:fragment.sourceIndex,glyphOrdinal:g.glyphOrdinal,glyphOperatorIndex:g.operatorIndex,box:g.box});
      }
    }
    const rules=[];for(const rule of bound.rules){if(!contact(box,rule.box))continue;if(!contains(box,rule.box))fail('rule-region-boundary');rules.push(rule);}
    if(!glyphs.length||!rules.length)fail('no-positive-inventory');
    const denominator=glyphs.length*rules.length;if(denominator>200000)fail('pair-budget');
    let crossing=0,touching=0;const pairs=[];
    for(const glyph of glyphs)for(const rule of rules){
      const kind=positive(glyph.box,rule.box)?'crossing':contact(glyph.box,rule.box)?'touching':null;
      if(!kind)continue;
      if(kind==='crossing')crossing++;else touching++;
      pairs.push({sourceIndex:glyph.sourceIndex,glyphOrdinal:glyph.glyphOrdinal,glyphOperatorIndex:glyph.glyphOperatorIndex,ruleOperatorIndex:rule.operatorIndex,kind});
    }
    return freeze({status:crossing?'geometric-crossing':touching?'geometric-touching':'geometric-disjoint',visibility:'unverified',sourceReviewed:false,
      mappedGlyphPositions:positions,paintedGlyphBoxes:glyphs.length,skippedSpaces:spaces,ruleCount:rules.length,
      pairDenominator:denominator,crossingPairs:crossing,touchingPairs:touching,sourceIndices:[...selected].sort((a,b)=>a-b),pairs});
  }catch(e){return unknown(e.message||'invalid-source');}
}
