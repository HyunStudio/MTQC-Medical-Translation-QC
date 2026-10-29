import {assessGlyphRuleGeometry} from './document-glyph-paint.mjs';
import {encodeDiagnosticValue} from './document-diagnostic-value.mjs';

const unknown=reason=>Object.freeze({status:'unknown',reason,visibility:'unverified',sourceReviewed:false,
 mappedGlyphPositions:null,paintedGlyphBoxes:null,skippedSpaces:null,ruleCount:null,pairDenominator:null,
 crossingPairs:null,touchingPairs:null,sourceIndices:Object.freeze([]),pairs:Object.freeze([])});
function own(object,key){const d=object&&Object.getOwnPropertyDescriptor(object,key);if(!d||!('value'in d))throw Error('schema');return d.value;}
function array(value,max){if(!Array.isArray(value))throw Error('schema');const n=own(value,'length');if(!Number.isSafeInteger(n)||n<0||n>max)throw Error('budget');return Array.from({length:n},(_,i)=>own(value,String(i)));}
function signature(page){const encoded=encodeDiagnosticValue(page);if(encoded.status!=='complete')throw Error('page-budget-or-schema');return JSON.stringify(encoded.value);}

/** Manual source-review context only. No approval, visibility, table or model admission API.
 * Current state is read synchronously; caller-supplied read arguments cannot replay a past selection.
 * Ordinary non-Proxy objects only. Native reflection and Canvas pixel mutation are outside this custody claim.
 */
export function createGlyphReviewRelay({records,pages,getCurrent}={}){
 const bindings=new Map(),invalidated=new Set();let disposed=false,setup=false;
 try{
  const sources=array(records,2),initial=array(pages,2);if(!sources.length||sources.length!==initial.length||typeof getCurrent!=='function')throw Error('intake');
  for(let i=0;i<initial.length;i++){
   const page=initial[i],stamp=signature(page),record=sources[i],id=own(page,'id');
   if(id!==`p${i+1}`)throw Error('page-id');
   const fragments=own(record,'fragments'),source=array(fragments,8192);
   if(encodeDiagnosticValue(fragments).status!=='complete')throw Error('source-schema');
   const width=own(record,'width'),height=own(record,'height'),canvas=own(record,'canvas');
   if(!canvas||width!==own(page,'width')||height!==own(page,'height'))throw Error('page-frame');
   const ids=new Map();source.forEach((f,index)=>{const text=own(f,'text');if(typeof text!=='string')throw Error('text');if(text.trim())ids.set(`${id}-f${index}`,index);});
   const inventory=array(own(page,'fragmentIds'),8192);if(inventory.length!==ids.size||new Set(inventory).size!==inventory.length||inventory.some(key=>!ids.has(key)))throw Error('inventory');
   const owners=new Set();for(const region of array(own(page,'regions'),8192))for(const key of array(own(region,'fragmentIds'),8192)){if(!ids.has(key)||owners.has(key))throw Error('ownership');owners.add(key);}
   if(owners.size!==ids.size)throw Error('unplaced-source');
   bindings.set(id,{stamp,fragments,width,height,canvas,receipt:own(record,'glyphHints'),ids});
  }
  setup=true;
 }catch{bindings.clear();}
 return Object.freeze({
  read(){
   if(disposed)return unknown('disposed-source');if(!setup)return unknown('unavailable-source');
   try{
    const current=getCurrent(),page=own(current,'page');if(!page)return unknown('no-current-region');
    const id=own(page,'id'),bound=bindings.get(id);if(!bound||invalidated.has(id))return unknown('changed-review-page');
    const regionId=own(current,'selectedId'),selection=array(own(current,'selectionIds'),8192);
    if(typeof regionId!=='string'||selection.length!==1||selection[0]!==regionId)return unknown('select-one-current-region');
    if(own(current,'dirty')===true)return unknown('unsaved-editor');
    if(own(current,'sourceCanvas')!==bound.canvas)return unknown('source-crop-mismatch');
    if(signature(page)!==bound.stamp)return unknown('changed-review-page');
    const matches=page.regions.filter(r=>r.id===regionId);if(matches.length!==1)return unknown('no-current-region');
    const region=matches[0];if(region.provenance!=='pdf-text'||!region.fragmentIds.length)return unknown('non-native-region');
    const indices=region.fragmentIds.map(key=>bound.ids.get(key));if(indices.some(index=>index===undefined)||new Set(indices).size!==indices.length)return unknown('native-ownership');
    return assessGlyphRuleGeometry(bound.receipt,{fragments:bound.fragments,width:bound.width,height:bound.height,region:region.box,sourceIndices:indices});
   }catch{return unknown('relay-unavailable');}
  },
  invalidate(pageId){if(typeof pageId==='string'&&bindings.has(pageId))invalidated.add(pageId);},
  dispose(){disposed=true;bindings.clear();invalidated.clear();}
 });
}
