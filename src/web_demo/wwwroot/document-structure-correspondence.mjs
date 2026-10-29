import {validateTableStructure,validTableDimensions,footnoteTargets,footnoteEdgeTarget} from './document-structure.mjs';
import {validateNativeMathLayout,parseNativeMathJson} from './document-native-math.mjs';
import {validateNativeTableBinding} from './document-table-source.mjs';
import {hasNativeTableGroup,nativeTableGroupReviewReady} from './document-native-table-group.mjs';
// Scoped format/data correspondence only. This is not source-render, semantic
// translation, human review or clinical authority; no graph approval is changed.
const presentations=new WeakMap();
const contexts=new WeakMap(),VERSION='mtqc-structure-correspondence-v1';
const id=value=>typeof value==='string'&&/^[A-Za-z0-9._-]{1,128}$/.test(value);
const reserved=value=>/\[\[(?:MTQC:|\/MTQC\]\]|CELL:|NOTE:|MATH:)/.test(value);
const controls=value=>/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value);
const issue=(code,regionId,cellId)=>({code,...(regionId?{regionId}:{}),...(cellId?{cellId}:{})});
function context(status,reason,expected=null,text=null,counts=null){
 const result=Object.freeze({version:VERSION,status,reason,text,counts:counts&&Object.freeze({...counts}),sourceReviewed:false});
 contexts.set(result,{status,reason,expected});return result;
}
const unknown=reason=>context('unknown',reason);
const numericPattern=/[+\-−]?(?:\p{N}+(?:[.,]\p{N}+)?|\.\p{N}+)(?:[eE][+\-]?\p{N}+)?/gu;
const numeric=text=>text.match(numericPattern)||[];
const supportedUnits=new Set(['mcg','mg','kg','mL','μL','µL','μg','µg','g','L','mm','cm','m','%']);
// Finite literal unit profile. Other number-following words are unassessed,
// including translated names and compound units, never semantic clearance.
const notation=text=>text.match(/[+\-−⁺⁻₊₋≤≥<>≈=±×÷/^]/gu)||[];
const timeUnits=new Set(['h','min','s']);
// New time symbols require a complete bounded ASCII numeric pair. Standalone
// h/min/s labels are wording; no unit conversion or clinical meaning is inferred.
const timeNumber=String.raw`[+\-−]?(?:[0-9]+(?:[.,][0-9]+)?|\.[0-9]+)(?:[eE][+\-]?[0-9]+)?`;
const timePattern=new RegExp(String.raw`(?<![\p{L}\p{M}\p{N}_.,\u066B\u066C+\-−±⁺⁻₊₋])(${timeNumber})\s*(h|min|s)(?![\p{L}\p{M}\p{N}_])`,'gu');
const timePairs=text=>[...text.matchAll(timePattern)];
const timeWord=/(?<!\p{L})(?:h|min|s)(?!\p{L})/iu;
const unsupportedUnit=text=>{
 const pairs=timePairs(text);let candidates=0;
 for(const m of text.replace(numericPattern,'#').matchAll(/#\s*([\p{L}μµ][\p{L}μµ/²³⁻¹]*)/gu)){
  if(timeUnits.has(m[1]))candidates++;else if(!supportedUnits.has(m[1]))return true;
 }
 return candidates!==pairs.length||(units(text).length>0&&/[\/·×*^]/u.test(text))||(timeWord.test(text)&&/[\/·×*^]/u.test(text));
};
const normalizeLines=text=>text.replace(/\r\n?/g,'\n');
const units=text=>[...(text.match(/(?<![\p{L}])(?:mcg|mg|kg|mL|μL|µL|μg|µg|mm|cm|g|L|m|%)(?![\p{L}])/gu)||[]),...timePairs(text).map(m=>m[2])];
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const cellMarker=c=>`[[CELL:${c.id};${c.row},${c.column};${c.rowSpan},${c.colSpan};${c.role};${c.headers.join(',')}]]`;
/** Input is ordinary committed model DATA, never renderer/receipt identity. */
export function createStructureComparisonSource(input){
 try{
  const regions=input?.regions,edges=input?.edges??[];
  if(!Array.isArray(regions)||!regions.length||regions.length>32||!Array.isArray(edges)||edges.length>1024)return unknown('source-region-limit');
  if(!regions.some(r=>['table','equation','footnote'].includes(r?.type)))return context('not-applicable','no-supported-structure');
  const ids=new Set(),expected=[];let sourceLength=0,cells=0,references=0;
  const text=value=>{if(typeof value!=='string'||reserved(value)||controls(value))throw Error('source-literal-unsupported');sourceLength+=value.length;if(sourceLength>32768)throw Error('source-text-limit');return value;};
  // Reserve aggregate list work before model validation or serializing any table.
  for(const r of regions){
   if(!r||!id(r.id)||ids.has(r.id)||r.status!=='verified'||!['table','equation','footnote','paragraph','heading','caption','figure','other'].includes(r.type))return unknown('source-region-invalid');
   ids.add(r.id);text(r.text);
   if(r.type==='table'){
    if(!Array.isArray(r.table?.cells)||(cells+=r.table.cells.length)>400)return unknown('source-cell-limit');
    for(const c of r.table.cells){
     if(!c||!id(c.id)||!Array.isArray(c.headerCellIds??[])||(c.headerCellIds??[]).some(h=>!id(h)))return unknown('source-cell-invalid');
     references+=(c.headerCellIds??[]).length;if(references>40000)return unknown('source-reference-limit');
     text(c.text);if(c.blankReason!==undefined)text(c.blankReason);
    }
   }
   if(r.type==='footnote'&&r.footnoteReview?.standaloneReason)text(r.footnoteReview.standaloneReason);
   if(r.type==='figure')for(const label of r.figureReview?.labels||[])text(label.text);
  }
  for(const r of regions){
   const entry={id:r.id,type:r.type,text:normalizeLines(r.text).trim()};
   if(r.type==='table'){
    if(hasNativeTableGroup(r)&&!nativeTableGroupReviewReady(r,true))return unknown('source-native-table-held');
    if(!validateTableStructure(r.table).ok)return unknown('source-table-invalid');
    const nativeSource=Object.getOwnPropertyDescriptor(r.table,'sourceReview');
    if(nativeSource&&(!Object.hasOwn(nativeSource,'value')||Object.getOwnPropertyDescriptor(r.table,'sourceReviewChecked')?.value!==true||!validateNativeTableBinding(nativeSource.value,{region:r,table:r.table}).ok))return unknown('source-native-table-held');
    entry.cells=r.table.cells.map(c=>({id:c.id,row:c.row,column:c.column,rowSpan:c.rowSpan,colSpan:c.colSpan,role:c.role,headers:[...(c.headerCellIds||[])].sort(),text:c.role==='blank'?'':normalizeLines(c.text).trim()}));
   }
   if(r.type==='equation'&&r.equationReview?.sourceChecked!==true)return unknown('source-equation-unreviewed');
   if(r.type==='equation'&&r.equationReview?.layout!==undefined){
    if(r.equationReview.layoutChecked!==true)return unknown('source-math-unreviewed');
    const checked=validateNativeMathLayout(r.equationReview.layout,{fragmentIds:r.fragmentIds,text:r.text,box:r.box});
    if(!checked.ok)return unknown('source-math-invalid');
    const transport=parseNativeMathJson(JSON.stringify(checked.layout));
    if(!transport.ok)return unknown('source-'+transport.reason);
    entry.math=checked.layout;
   }
   if(r.type==='footnote'){
    const review=r.footnoteReview,links=edges.filter(e=>e.type==='footnote-of'&&e.from===r.id);
    if(!review||review.sourceChecked!==true||!['linked','standalone'].includes(review.decision)||links.some(e=>e.status!=='verified'||!id(e.to)))return unknown('source-footnote-invalid');
    entry.targets=links.map(footnoteEdgeTarget).sort();const refs=footnoteTargets(entry.targets);entry.decision=review.decision;
    for(const ref of refs)if(ref.cellId!==null){const target=regions.find(item=>item.id===ref.regionId);if(target?.type!=='table'||target.status!=='verified'||!validateTableStructure(target.table).ok||target.table.cells.filter(c=>c.id===ref.cellId).length!==1)return unknown('source-footnote-cell-invalid');}
    if(new Set(entry.targets).size!==entry.targets.length||(entry.decision==='linked'?!links.length:links.length||!review.standaloneReason?.trim()))return unknown('source-footnote-invalid');
   }
   if(r.type==='figure'){
    const labels=r.figureReview?.labels?.map(l=>l.text.trim()).filter(Boolean)||[];
    entry.text=labels.length?`FIGURE${r.text.trim()?` · ${r.text.trim()}`:''}\nVISIBLE LABELS:\n${labels.join('\n')}`:r.text.trim();
   }
   expected.push(entry);
  }
  let output='';const add=value=>{const next=output.length+value.length+1;if(next>65536)throw Error('projection-text-limit');output+=value+'\n';};
  for(const r of expected){
   add(`[[MTQC:${r.id}:${r.type}]]`);
   if(r.type==='table'){add(`TABLE · ${r.text}`);for(const c of r.cells){add(cellMarker(c));add(c.text);}}
   else{if(r.math)add('[[MATH:'+JSON.stringify(r.math)+']]');if(r.type==='footnote')add(`[[NOTE:${r.decision};${r.targets.join(',')}]]`);add(r.text);}
   add('[[/MTQC]]');
  }
  const projection=output.trimEnd();
  if(projection.length>10000)return unknown('projection-text-limit');
  return context('ready',null,expected,projection,{regions:expected.length,cells,tables:expected.filter(r=>r.type==='table').length,equations:expected.filter(r=>r.type==='equation').length,notes:expected.filter(r=>r.type==='footnote').length});
 }catch(e){return unknown(e instanceof Error?e.message:'source-unsupported');}
}
function parseTarget(value){
 const regions=[],seen=new Set();let current=null,activeCell=null,totalCells=0;
 const fail=code=>({error:issue(code,current?.id,activeCell?.id)});
 for(const raw of value.replace(/\r\n?/g,'\n').split('\n')){
  const line=raw.trim();let match;
  if((match=/^\[\[MTQC:([A-Za-z0-9._-]{1,128}):(table|equation|footnote|paragraph|heading|caption|figure|other)\]\]$/.exec(line))){
   if(current||seen.has(match[1])||regions.length>=32)return fail('duplicate-or-nested-region');
   seen.add(match[1]);current={id:match[1],type:match[2],body:[],cells:[],note:null,math:null};activeCell=null;regions.push(current);continue;
  }
  if(line==='[[/MTQC]]'){if(!current)return fail('unmatched-region-end');if(current.type==='footnote'&&!current.note)return fail('missing-note');current=null;activeCell=null;continue;}
  if((match=/^\[\[CELL:([A-Za-z0-9._-]{1,128});(\d{1,3}),(\d{1,3});(\d{1,3}),(\d{1,3});(header|value|blank);([A-Za-z0-9._,-]*)\]\]$/.exec(line))){
   if(current?.type!=='table')return fail('unexpected-cell');
   if(current.cells.length>=400||++totalCells>400)return fail('target-cell-limit');
   if(current.cells.some(c=>c.id===match[1]))return {error:issue('duplicate-cell',current.id,match[1])};
   const headers=match[7]?match[7].split(','):[];
   if(headers.some(h=>!id(h))||new Set(headers).size!==headers.length)return fail('malformed-header-list');
   const [row,column,rowSpan,colSpan]=match.slice(2,6).map(Number);
   if(rowSpan<1||colSpan<1||!validTableDimensions(row+rowSpan,column+colSpan))return fail('malformed-cell');
   activeCell={id:match[1],row,column,rowSpan,colSpan,role:match[6],headers:headers.sort(),body:[]};current.cells.push(activeCell);continue;
  }
  if((match=/^\[\[NOTE:(linked|standalone);([A-Za-z0-9._,@-]*)\]\]$/.exec(line))){
   if(current?.type!=='footnote'||current.note)return fail('unexpected-note');
   const targets=match[2]?match[2].split(','):[];try{footnoteTargets(targets);}catch{return fail('malformed-note');}
   if(match[1]==='linked'?!targets.length:targets.length)return fail('malformed-note');
   current.note={decision:match[1],targets:targets.sort()};continue;
  }
  if(line.startsWith('[[MATH:')&&line.endsWith(']]')){
   if(current?.type!=='equation'||current.math!==null||current.body.length!==0)return fail('unexpected-math');
   const parsed=parseNativeMathJson(line.slice(7,-2));if(!parsed.ok)return fail('malformed-math-json');
   const checked=validateNativeMathLayout(parsed.value);if(!checked.ok)return fail('malformed-math-layout');
   current.math=parsed.value;continue;
  }
  if(reserved(line))return fail('malformed-marker');
  if(!current){if(line)return fail('unscoped-text');continue;}
  (activeCell?.body??current.body).push(raw);
 }
 if(current)return fail('missing-region-end');
 for(const r of regions){r.text=r.body.join('\n').trim();if(r.math&&normalizeLines(r.math.literal).trim()!==r.text)return {error:issue('equation-math-body-unbound',r.id)};for(const c of r.cells)c.text=c.body.join('\n').trim();}
 return {regions};
}
/** Exact scoped metadata/literal comparison; never semantic translation clearance. */
export function compareStructureTranslation(source,translation){
 const bound=contexts.get(source),fail=(reason,issues=[])=>({status:'unknown',reason,comparisonPerformed:false,counts:null,issues,sourceReviewed:false,scope:'table-metadata/finite-cell-literal-numeric-unit/equation-literal/native-position-relationship-DATA/note-targets'});
 if(!bound)return fail('unbound-source');
 if(bound.status==='not-applicable')return {...fail(bound.reason),status:'not-applicable'};
 if(bound.status!=='ready')return fail(bound.reason);
 if(typeof translation!=='string'||translation.length>10000)return fail('target-text-limit');
 if(controls(translation))return fail('target-literal-unsupported');
 const parsed=parseTarget(translation);if(parsed.error)return fail('target-ambiguous',[parsed.error]);
 const expected=bound.expected,actual=parsed.regions,issues=[];
 const displayText=actual.map(r=>r.type==='table'?[r.text,...r.cells.map(c=>`Row ${c.row+1}, column ${c.column+1}${c.rowSpan>1||c.colSpan>1?` (span ${c.rowSpan}×${c.colSpan})`:''}: ${c.text}`)].join('\n'):r.text).join('\n\n');
 if(actual.length!==expected.length||expected.some(e=>!actual.some(a=>a.id===e.id&&a.type===e.type)))return fail('region-correspondence-missing',[issue('missing-or-extra-region')]);
 if(!equal(actual.map(r=>r.id),expected.map(r=>r.id)))issues.push(issue('region-order-changed'));
 const counts={sourceRegions:expected.length,sourceCells:expected.reduce((n,r)=>n+(r.cells?.length||0),0),tablesCompared:0,cellsCompared:0,equationsCompared:0,notesCompared:0};
 for(const e of expected){const a=actual.find(a=>a.id===e.id);
  if(e.type==='table'){
   counts.tablesCompared++;if(!equal(e.cells.map(c=>c.id),a.cells.map(c=>c.id)))issues.push(issue('cell-order-changed',e.id));const byId=new Map(a.cells.map(c=>[c.id,c]));
   for(const c of e.cells){const other=byId.get(c.id);if(!other){issues.push(issue('missing-cell',e.id,c.id));continue;}counts.cellsCompared++;
    if(!['row','column','rowSpan','colSpan'].every(k=>c[k]===other[k]))issues.push(issue('cell-topology-changed',e.id,c.id));
    if(c.role!==other.role)issues.push(issue('cell-role-changed',e.id,c.id));
    if(!equal(c.headers,other.headers))issues.push(issue('header-links-changed',e.id,c.id));
    if(c.role==='blank'){if(other.text)issues.push(issue('blank-content-changed',e.id,c.id));}
    else{if(!other.text)issues.push(issue('missing-cell-content',e.id,c.id));if(unsupportedUnit(c.text)||unsupportedUnit(other.text))return {...fail('unsupported-cell-unit',issues),displayText};if(!equal(notation(c.text),notation(other.text)))issues.push(issue('cell-notation-changed',e.id,c.id));if(!equal(numeric(c.text),numeric(other.text)))issues.push(issue('cell-numeric-changed',e.id,c.id));if(!equal(units(c.text),units(other.text))||!equal(timePairs(c.text).map(m=>m[1]+' '+m[2]),timePairs(other.text).map(m=>m[1]+' '+m[2])))issues.push(issue('cell-unit-changed',e.id,c.id));}
   }
   for(const c of a.cells)if(!e.cells.some(s=>s.id===c.id))issues.push(issue('extra-cell',e.id,c.id));
  }
  if(e.type==='equation'){
   if(Boolean(e.math)!==Boolean(a.math))return fail('equation-math-correspondence-missing',[issue('equation-math-missing',e.id)]);
   if(e.math){
    const expectedIds=e.math.tokens.map(t=>t.id),actualIds=a.math.tokens.map(t=>t.id);
    if(expectedIds.length!==actualIds.length||expectedIds.some(id=>!actualIds.includes(id)))return fail('equation-native-correspondence-missing',[issue('equation-native-missing',e.id)]);
    if(JSON.stringify(validateNativeMathLayout(e.math).layout)!==JSON.stringify(validateNativeMathLayout(a.math).layout))issues.push(issue('equation-native-layout-changed',e.id));
   }
   counts.equationsCompared++;if(a.text!==e.text)issues.push(issue('equation-literal-changed',e.id));
  }
  if(e.type==='footnote'){counts.notesCompared++;if(!a.note||e.decision!==a.note.decision||!equal(e.targets,a.note.targets))issues.push(issue('footnote-links-changed',e.id));}
 }
 const result={status:issues.length?'changed':'matched',reason:null,comparisonPerformed:true,counts,issues,sourceReviewed:false,displayText,scope:'table-metadata/finite-cell-literal-numeric-unit/equation-literal/native-position-relationship-DATA/note-targets'};
 const view=makePresentation(expected,actual,result);if(view)presentations.set(result,view);return result;
}

// Process-local data view only. Copies of comparison DATA cannot carry this
// association, and this view grants no source-render or review authority.
export function getStructurePresentation(comparison){return presentations.get(comparison)??null;}
const freezeView=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freezeView(child);Object.freeze(value);}return value;};
function makePresentation(source,target,result){
 // Reserve aggregate work/content across BOTH sides before grid traversal or
 // creating DOM. Slot work counts every declared span, including overlaps.
 let cells=0,refs=0,work=0,content=0;
 for(const regions of [source,target]){
  if(regions.length>32)return null;let sideCells=0;
  for(const r of regions){content+=r.text.length+(r.math?JSON.stringify(r.math).length:0);
   for(const c of r.cells??[]){sideCells++;cells++;refs+=c.headers.length;work+=c.rowSpan*c.colSpan;content+=c.text.length;}
  }
  if(sideCells>400)return null;
 }
 if(refs>4096||work>40000||content>98304)return null;
 const side=regions=>({regions:regions.map(r=>{
  const entry={id:r.id,type:r.type,text:r.text};
  if(r.type==='table'){
   entry.cells=r.cells.map(c=>({id:c.id,row:c.row,column:c.column,rowSpan:c.rowSpan,colSpan:c.colSpan,role:c.role,headers:[...c.headers],text:c.text}));
   Object.assign(entry,tableLayout(entry.cells));
  }
  if(r.type==='equation'&&r.math)entry.math=structuredClone(r.math);
  if(r.type==='footnote'){entry.targets=[...(r.targets??r.note?.targets??[])];entry.decision=r.decision??r.note?.decision??'unreported';}
  return entry;
 })});
 return freezeView({status:result.status,sourceReviewed:false,issues:result.issues.map(i=>({...i})),source:side(source),target:side(target)});
}
function tableLayout(cells){
 const held=reason=>({layout:'cells',layoutReason:reason});
 if(!cells.length)return held('no received cells');
 const rows=Math.max(...cells.map(c=>c.row+c.rowSpan)),columns=Math.max(...cells.map(c=>c.column+c.colSpan));
 if(!validTableDimensions(rows,columns))return held('unsupported dimensions');
 const ids=new Map(cells.map(c=>[c.id,c])),slots=new Set();
 for(const c of cells){
  if(c.headers.some(h=>h===c.id||ids.get(h)?.role!=='header'))return held('invalid header reference');
  for(let row=c.row;row<c.row+c.rowSpan;row++)for(let col=c.column;col<c.column+c.colSpan;col++){
   const key=row*columns+col;if(slots.has(key))return held('overlap in received positions');slots.add(key);
  }
 }
 if(slots.size!==rows*columns)return held('gap in received positions');
 const active=new Set(),done=new Set();
 const visit=c=>{if(active.has(c.id))return false;if(done.has(c.id))return true;active.add(c.id);for(const h of c.headers)if(!visit(ids.get(h)))return false;active.delete(c.id);done.add(c.id);return true;};
 if(cells.some(c=>!visit(c)))return held('cyclic header references');
 return {layout:'grid',rowCount:rows,columnCount:columns,layoutReason:null};
}
