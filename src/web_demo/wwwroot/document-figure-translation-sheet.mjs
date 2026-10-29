// Local bulk target entry only. A sheet never supplies source review or geometry.
const schema='mtqc-figure-translation-sheet-v1';
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===expected.length&&expected.every(k=>Object.hasOwn(value,k));
const text=value=>typeof value==='string'&&value.trim().length>0&&Array.from(value).length<=3000&&
 !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uD800-\uDFFF]/u.test(value);
const boxKeys=['x','y','width','height'];
const box=(b,frame)=>keys(b,boxKeys)&&boxKeys.every(k=>Number.isFinite(b[k]))&&
 b.x>=0&&b.y>=0&&b.width>=1&&b.height>=1&&b.x+b.width<=frame.width&&b.y+b.height<=frame.height;
const sameBox=(a,b)=>keys(a,boxKeys)&&boxKeys.every(k=>a[k]===b[k]);
// Same ordered finite literal profile used by the existing pixel renderer.
// This is not equation parsing or clinical clearance. NFKC would erase scripts.
const literalPattern=new RegExp([
 String.raw`(?<![\p{L}\p{N}_])[A-Za-z][A-Za-z0-9]*[_^](?:\{[+\-−]?[A-Za-z0-9]+\}|[+\-−]?[A-Za-z0-9]+)`,
 String.raw`(?<![\p{L}\p{N}_])[A-Za-z][A-Za-z0-9]*(?=[¹²³\u2070-\u209F])`,
 String.raw`(?<![\p{L}\p{M}])(?:mcg|mg|kg|mL|μL|µL|μg|µg|mm|cm|min|g|L|m|h|s)(?![\p{L}\p{M}])`,
 String.raw`(?:[0-9]+(?:[.,][0-9]+)*|[.,][0-9]+)(?:[eE][+\-−]?[0-9]+)?`,
 String.raw`[\p{N}\p{Sm}\p{Script=Greek}\u2070-\u209F_/^%]`,
 String.raw`(?<![A-Za-z])-|-(?![A-Za-z])`
].join('|'),'gu');
export function figureLabelLiterals(value){return(value.match(literalPattern)||[]).join('|');}
function check(binding,labels){
 if(!binding||!/^[a-f0-9]{64}$/.test(binding.sourceSha256)||
 !Number.isInteger(binding.width)||!Number.isInteger(binding.height)||binding.width<1||binding.height<1||
 binding.width*binding.height>12_000_000||typeof binding.targetLanguage!=='string'||
 !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(binding.targetLanguage))throw Error('Missing source image or target language identity.');
 if(!Array.isArray(labels)||!labels.length||labels.length>200||new Set(labels.map(l=>l?.id)).size!==labels.length||
 labels.some(l=>!text(l?.id)||!text(l.sourceText)||!box(l.sourceBox,binding)||!box(l.figureCrop,binding)))
 throw Error('Correct the OCR source labels and boxes before preparing a translation sheet.');
}
export function createFigureTranslationSheet(binding,labels){
 check(binding,labels);
 return{schema,source:{sourceSha256:binding.sourceSha256,width:binding.width,height:binding.height},
 targetLanguage:binding.targetLanguage,labels:labels.map(l=>({id:l.id,sourceText:l.sourceText,
 sourceBox:{...l.sourceBox},figureCrop:{...l.figureCrop},targetText:l.targetText||''}))};
}
export function readFigureTranslationSheet(sheet,binding,labels){
 check(binding,labels);
 const mismatch=()=>{throw Error('Translation sheet does not match the current source image, labels or language. Export a fresh sheet.');};
 if(!keys(sheet,['schema','source','targetLanguage','labels'])||sheet.schema!==schema||
 !keys(sheet.source,['sourceSha256','width','height'])||
 ['sourceSha256','width','height'].some(k=>sheet.source[k]!==binding[k])||sheet.targetLanguage!==binding.targetLanguage||
 !Array.isArray(sheet.labels)||sheet.labels.length!==labels.length)mismatch();
 const targets=[];
 for(let i=0;i<labels.length;i++){
  const current=labels[i],item=sheet.labels[i];
  if(!keys(item,['id','sourceText','sourceBox','figureCrop','targetText'])||item.id!==current.id||
   item.sourceText!==current.sourceText||!sameBox(item.sourceBox,current.sourceBox)||!sameBox(item.figureCrop,current.figureCrop))mismatch();
  if(!text(item.targetText))throw Error('Enter a valid translation for every label in this sheet. No drafts were replaced.');
  if(figureLabelLiterals(current.sourceText)!==figureLabelLiterals(item.targetText))
   throw Error('Source and translation numbers, mathematical notation or literal units differ. No drafts were replaced.');
  targets.push(item.targetText);
 }
 return targets;
}
