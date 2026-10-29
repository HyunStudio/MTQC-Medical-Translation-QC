import { proposeRuledTableGrid, proposeOpenFirstRowTablePositions, getRuledTableAttempt, captureTableProposalSource, isTableProposalSourceCurrent } from './document-ruled-table-grid.mjs';
import { recoverReadingOrder } from './document-layout.mjs';
import { isTableReferenceText, proposeNativeTableGrid } from './document-table-grid.mjs';
import { proposeRuleTableScaffold } from './document-rule-table-scaffold.mjs';
import {extendPageWithSourceDrafts} from './document-additional-structure.mjs';

function issue(code, pageId, message, regionId) {
  return { code, pageId, ...(regionId ? { regionId } : {}), message };
}

function unionBox(lines) {
  const x = Math.min(...lines.map(line => line.x));
  const y = Math.min(...lines.map(line => line.y));
  return { x, y,
    width: Math.max(...lines.map(line => line.x + line.width)) - x,
    height: Math.max(...lines.map(line => line.y + line.height)) - y };
}

function isTableReferenceCandidate(line) {
  // A reference verb is evidence of prose, but a caption can use one too.
  // Keep that ambiguity visible instead of demanding invented table cells.
  return line.column !== 'table' && isTableReferenceText(line.text);
}

function proposedType(line) {
  if (isTableReferenceCandidate(line)) return 'paragraph';
  if (line.column === 'table' || /^\s*TABLE\s+\d+\b/i.test(line.text)) return 'table';
  if (/^\s*(?:Figure|Fig\.)\s*\d+\b/i.test(line.text)) return 'caption';
  if (/^[\s\S]*[=∑∫ψασ][\s\S]*$/u.test(line.text) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(line.text)) return 'equation';
  if (/^\s*\d+(?:\.\d+)*\.?\s+[A-Z][\w\s-]{2,}$/u.test(line.text) && line.text.length < 100) return 'heading';
  return 'paragraph';
}

/**
 * Make a source-linked proposal from one locally rendered PDF page. This is
 * geometry evidence, not a verified transcription or table/figure analysis.
 * @param {{pageIndex:number,width:number,height:number,fragments:Array<{text:string,x:number,y:number,width:number,height:number}>,hasImages:boolean,ocrText:string}} input
 * @returns {import('./document-structure.mjs').Page}
 */
const pageTableEvidence=new WeakMap();
function tableStep(trace,helper,outcome,phase=null){if(trace.attempts.length>=32){trace.overflow=true;return;}trace.attempts.push(Object.freeze({helper,outcome,phase}));}
function ruleStep(trace,input,positions,attempted){const helper=positions?'open':'closed',d=attempted?getRuledTableAttempt(input,positions):null;tableStep(trace,helper,attempted?(d?.outcome||'unavailable'):'skipped',d?.phase||null);}
export function getTableProposalDiagnostic(page,input){const entry=pageTableEvidence.get(page);return entry&&entry.input===input&&isTableProposalSourceCurrent(entry.source,input)&&isTableProposalSourceCurrent(entry.pageSource,page)?entry.report:null;}
export function proposePageStructure(input){
 const source=captureTableProposalSource(input),trace={attempts:[],overflow:false,assembly:'ordinary'};
 const page=extendPageWithSourceDrafts(proposePageStructureCore(input,trace),input,(helper,outcome,phase)=>tableStep(trace,helper,outcome,phase)),pageSource=captureTableProposalSource(page);
 if(source&&pageSource&&!trace.overflow&&isTableProposalSourceCurrent(source,input)){
  const own=(value,key)=>{const d=value&&Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
  const hint=(h,version)=>{const candidates=own(h,'candidates');return Object.freeze({present:h!=null,versionKnown:own(h,'version')===version,candidates:Array.isArray(candidates)&&candidates.length<=256?candidates.length:null});};
  // Parent metadata is a diagnostic only; private source custody is still
  // assessed by the producer. Never publish arbitrary unsupported strings.
  const knownRasterReasons=new Set(('invalid-input unsupported-pdfjs-version invalid-operator-inventory unsupported-viewport unbound-decode-receipt unassessed-font-resource unknown-operator invalid-dependency unsupported-state-nesting unbalanced-graphics-state unsupported-transform invalid-composed-transform invalid-graphics-state unsupported-graphics-resource unassessed-pattern-resource duplicate-pending-clip unsupported-annotation-raster invalid-image-reference image-decode-dimension-mismatch unsupported-image-paint image-placement-limit unsupported-raster-operator unsupported-resource-scope unsupported-form-scope invalid-form-transform unbalanced-resource-scope unsupported-optional-content marked-content-limit unbalanced-marked-content unbalanced-text-scope unsupported-text-clip unsupported-operator unbalanced-source-state unplaced-raster-dependency').split(' '));
  const regional=own(input,'regionalRasterHints'),legacy=own(input,'rasterHints'),raster=regional??legacy,unsupported=own(raster,'unsupported'),reason=Array.isArray(unsupported)&&unsupported.length===0?null:Array.isArray(unsupported)&&unsupported.length===1&&knownRasterReasons.has(own(unsupported,'0'))?own(unsupported,'0'):'unknown';
  const rasterParent=Object.freeze({selected:regional!=null?'regional':legacy!=null?'legacy':'absent',complete:typeof own(raster,'complete')==='boolean'?own(raster,'complete'):null,reason});
  const report=Object.freeze({version:'table-proposal-evidence-v1',kind:'initial-proposal',nativeFragments:input.fragments.length,
   horizontal:hint(input.ruleHints,'pdfjs-horizontal-rule-evidence-v1'),vertical:hint(input.verticalRuleHints,'pdfjs-vertical-rule-evidence-v1'),rasterPresent:input.rasterHints!=null,rasterParent,
   attempts:Object.freeze(trace.attempts),assembly:trace.assembly,tables:page.regions.filter(r=>r.table).length,sourceReviewed:false,visibility:'unverified'});
  pageTableEvidence.set(page,{input,source,pageSource,report});
 }
 return page;
}
function proposePageStructureCore({ pageIndex, width, height, fragments, hasImages, ocrText, vectorHints = null, ruleHints = null, verticalRuleHints = null, rasterHints = null },trace) {
  const pageId = `p${pageIndex + 1}`;
  const sourceIds = fragments.flatMap((fragment, index) => fragment.text?.trim() ? [`${pageId}-f${index}`] : []);
  const page = { id: pageId, width, height, fragmentIds: sourceIds,
    regions: [], edges: [], issues: [], visualInventoryConfirmed: false };
  const hints = hasImages === false && vectorHints?.height === height ? vectorHints : null;
  const ordered = recoverReadingOrder(fragments, width, 'auto', hints);
  if (ordered.panelDraft) page.issues.push(issue('panel-order-unverified', pageId,
    'Question-panel/glossary grouping is a tentative source-geometry draft. Later paint visibility and all reading order require comparison with the original.'));
  const toSourceId = index => `${pageId}-f${index}`;
  const addRegion = (lines, type) => {
    if (!lines.length) return;
    const id = `${pageId}-r${page.regions.length}`;
    const fragmentIds = lines.flatMap(line => line.fragmentIds.map(toSourceId));
    const text = lines.map(line => line.text).join('\n');
    const referenceCandidate = lines.some(isTableReferenceCandidate);
    const status = type === 'table' || type === 'equation' || referenceCandidate ? 'unresolved' : 'proposed';
    page.regions.push({ id, type, box: unionBox(lines), fragmentIds, text,
      provenance: 'pdf-text', status, exclusionReason: '' });
    if (type === 'table') {
      const native=proposeNativeTableGrid(lines, fragments, width, height, pageId);tableStep(trace,'native',native?'draft':'null');
      const fallback=native?null:proposeRuleTableScaffold({lines,fragments,width,height,pageId,ruleHints,rasterHints});tableStep(trace,'scaffold-region',native?'skipped':fallback?'draft':'null');
      const table=native||fallback?.table;
      if (table) page.regions.at(-1).table = table;
    }
    if (referenceCandidate) page.issues.push(issue('table-reference-or-caption-unverified', pageId,
      'This may be a prose reference or a table caption. Compare the original before confirming its type.', id));
    if (type === 'table') page.issues.push(issue('table-grid-unverified', pageId,
      page.regions.at(-1).table?.scaffold
        ? 'Unresolved table positions: empty value cells and header/merged associations require comparison with the original. Fill or merge each position before confirming the table.'
        : 'Table rows and header/value cell associations need visual review.', id));
    if (type === 'equation') page.issues.push(issue('equation-unverified', pageId,
      'Mathematical notation and grouping need visual transcription.', id));
    if (type === 'caption') page.issues.push(issue('caption-link-unresolved', pageId,
      'Caption has not been linked to a verified source figure.', id));
  };
  // A rule scaffold may contain labels that the text-only band classifier
  // treats as prose/equations. Try the complete single-caption tail first;
  // the helper rejects any extra, missing, crossing, or nonnumeric body row.
  // No hint means this path cannot alter the previous region classification.
  const captionIndices=ordered.lines.flatMap((line,index)=>
    /^\s*TABLE\s+\d+\b/i.test(line.text)&&!isTableReferenceCandidate(line)?[index]:[]);
  const scaffoldStart=captionIndices.length===1?captionIndices[0]:-1;
  const scaffoldLines=scaffoldStart>=0?ordered.lines.slice(scaffoldStart):[];
  const scaffold=ruleHints && proposeRuleTableScaffold({lines:scaffoldLines,fragments,width,height,pageId,ruleHints,rasterHints});
  const ruledInput={lines:ordered.lines,fragments,width,height,pageId,ruleHints,verticalRuleHints,rasterHints};
  tableStep(trace,'scaffold-tail',ruleHints?(scaffold?'draft':'null'):'skipped');
  const closed=verticalRuleHints&&proposeRuledTableGrid(ruledInput);ruleStep(trace,ruledInput,false,Boolean(verticalRuleHints));
  const opened=verticalRuleHints&&!closed&&proposeOpenFirstRowTablePositions(ruledInput);ruleStep(trace,ruledInput,true,Boolean(verticalRuleHints&&!closed));
  const ruled=closed||opened;
  if(ruled){
    // Exactly one unchanged no-vertical pass preserves every existing accepted
    // native/scaffold table, including its header bindings and region ownership.
    const legacy=proposePageStructure({pageIndex,width,height,fragments,hasImages,ocrText,vectorHints,ruleHints,rasterHints});
    const body=new Set(ruled.fragmentIndices.map(toSourceId));
    if(legacy.regions.some(r=>r.table&&r.table.cells?.some(c=>c.sourceFragmentIds?.some(id=>body.has(id))))){trace.assembly='legacy-priority';return legacy;}
  }
  const ruledIds=new Set(ruled?.fragmentIndices||[]),ruledCaptionIds=new Set(ruled?.captionFragmentIndices||[]);
  let ruledAdded=false;
  let tableLines = [];
  for (const [index,line] of ordered.lines.entries()) {
    if(ruled && line.fragmentIds.some(id=>ruledIds.has(id))){
      if(tableLines.length){addRegion(tableLines,'table');tableLines=[];}
      if(!ruledAdded){trace.assembly='ruled-attached';const id=`${pageId}-r${page.regions.length}`;page.regions.push({id,type:'table',box:ruled.box,fragmentIds:ruled.fragmentIndices.map(toSourceId),text:ruled.table.cells.map(c=>c.text).join('\n'),provenance:'pdf-text',status:'unresolved',exclusionReason:'',table:ruled.table});page.issues.push(issue('table-grid-unverified',pageId,'Source-ruled geometry draft: confirm cell boundaries, intentional spans, row/column headers and notes against the original.',id));if(ruled.table.boundaryEvidence==='partial-first-row-source-positions')page.issues.push(issue('table-first-row-positions-unverified',pageId,'First-row source dividers are open: these native positions are incomplete geometry, not closed boundaries or confirmed headers. Compare every position with the original.',id));ruledAdded=true;}
      continue;
    }
    if(ruled && line.fragmentIds.some(id=>ruledCaptionIds.has(id))){if(tableLines.length){addRegion(tableLines,'table');tableLines=[];}addRegion([line],'paragraph');continue;}
    if (!ruled && scaffold && index===scaffoldStart) {
      trace.assembly='scaffold-tail';
      if (tableLines.length) { addRegion(tableLines,'table'); tableLines=[]; }
      addRegion(scaffoldLines,'table');
      break;
    }
    const type = proposedType(line);
    if (type === 'table') {
      tableLines.push(line);
      continue;
    }
    if (tableLines.length) {
      addRegion(tableLines, 'table');
      tableLines = [];
    }
    addRegion([line], type);
  }
  if (tableLines.length) addRegion(tableLines, 'table');
  for (let index = 1; index < page.regions.length; index++) {
    page.edges.push({ id: `${pageId}-e${index - 1}`, type: 'reading-next',
      from: page.regions[index - 1].id, to: page.regions[index].id, status: 'proposed' });
  }
  const assigned = new Set(page.regions.flatMap(region => region.fragmentIds));
  for (const id of sourceIds) if (!assigned.has(id))
    page.issues.push(issue('unplaced-fragment', pageId, `Selectable PDF fragment ${id} has no reliable position.`));
  if (hasImages) page.issues.push(issue('raster-content-unassessed', pageId,
    'Image-internal labels or other raster content need visual inventory.'));
  if (ocrText?.trim() && sourceIds.length) page.issues.push(issue('visual-ocr-unverified', pageId,
    'Local visual OCR is a separate clue and was not merged into PDF text.'));
  if (!sourceIds.length && ocrText?.trim()) {
    page.regions.push({ id: `${pageId}-r0`, type: 'paragraph',
      box: { x: 0, y: 0, width, height }, fragmentIds: [], text: ocrText.trim(),
      provenance: 'local-ocr', status: 'unresolved', exclusionReason: '' });
    page.issues.push(issue('ocr-order-unverified', pageId,
      'OCR text and reading order need comparison with the source page.', `${pageId}-r0`));
  }
  if (!sourceIds.length && !ocrText?.trim()) page.issues.push(issue('empty-page-unassessed', pageId,
    'No source text was recovered; compare the original page visually.'));
  return page;
}
