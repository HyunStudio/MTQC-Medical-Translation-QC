// A browser-local description of the source page. Proposal code may populate
// this graph, but only an explicit reviewer action can mark content verified.

/** @typedef {{x:number,y:number,width:number,height:number}} SourceBox */
/** @typedef {{id:string,row:number,column:number,rowSpan:number,colSpan:number,text:string,role:'header'|'value'|'blank',headerCellIds:string[],blankReason?:string}} TableCell */
/** @typedef {{rowCount:number,columnCount:number,cells:TableCell[],reviewed:boolean}} TableGrid */
/** @typedef {'heading'|'paragraph'|'table'|'equation'|'figure'|'caption'|'footnote'|'other'} RegionType */
/** @typedef {'proposed'|'verified'|'excluded'|'unresolved'} RegionStatus */
/** @typedef {{id:string,type:RegionType,box:SourceBox,fragmentIds:string[],text:string,provenance:string,status:RegionStatus,exclusionReason?:string,table?:TableGrid,equationReview?:{sourceChecked:boolean},figureReview?:{decision:'labels-transcribed'|'no-internal-text',labels:Array<{id:string,text:string,box?:SourceBox}>,sourceChecked:boolean},footnoteReview?:{decision:'linked'|'standalone',sourceChecked:boolean,standaloneReason:string}}} Region */
/** @typedef {{id:string,type:'reading-next'|'caption-of'|'footnote-of'|'cell-of'|'label-in-figure',from:string,to:string,status:'proposed'|'verified'}} Edge */
/** @typedef {{code:string,pageId:string,regionId?:string,message:string}} Issue */
/** @typedef {{sourceChecked:boolean,decision:'regions-recorded'|'no-visible-content',regionIds:string[]}} VisualConcernReview */
/** @typedef {{id:string,width:number,height:number,fragmentIds:string[],regions:Region[],edges:Edge[],issues:Issue[],visualInventoryConfirmed:boolean,visualConcernReviews?:Object<string,VisualConcernReview>}} Page */
/** @typedef {{schemaVersion:1,pages:Page[],selectedRegionIds:string[]}} DocumentStructure */

const unreadableGlyph = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
export const VISUAL_PAGE_CONCERNS = Object.freeze(['raster-content-unassessed', 'empty-page-unassessed', 'visual-ocr-unverified']);

function invalidatePageReview(page) {
  page.visualInventoryConfirmed = false;
  page.visualConcernReviews = {};
}

function validVisualAssessment(page, code, assessment) {
  if (!VISUAL_PAGE_CONCERNS.includes(code) || assessment?.sourceChecked !== true ||
      !Array.isArray(assessment.regionIds) || new Set(assessment.regionIds).size !== assessment.regionIds.length) return false;
  if (assessment.decision === 'no-visible-content') return code === 'empty-page-unassessed' &&
    !page.regions.length && !page.fragmentIds.length && !assessment.regionIds.length;
  return assessment.decision === 'regions-recorded' && assessment.regionIds.length > 0 &&
    assessment.regionIds.every(id => page.regions.some(region => region.id === id));
}

function visualConcernResolved(page, code) {
  const assessment = page.visualConcernReviews?.[code];
  return page.visualInventoryConfirmed === true && validVisualAssessment(page, code, assessment) &&
    assessment.regionIds.every(id => page.regions.some(region => region.id === id && region.status === 'verified'));
}

export const MAX_TABLE_DIMENSION = 20;
export function validTableDimensions(rows, columns) {
  return [rows, columns].every(value => Number.isInteger(value) && value >= 1 && value <= MAX_TABLE_DIMENSION);
}

function copy(value) { return structuredClone(value); }

/** @param {Page[]} pages @returns {DocumentStructure} */
export function createDocumentStructure(pages) {
  return { schemaVersion: 1, pages: copy(pages), selectedRegionIds: [] };
}

function findPage(document, pageId) {
  const page = document.pages.find(candidate => candidate.id === pageId);
  if (!page) throw new RangeError(`Unknown page: ${pageId}`);
  return page;
}

function findRegion(page, regionId) {
  const region = page.regions.find(candidate => candidate.id === regionId);
  if (!region) throw new RangeError(`Unknown region: ${regionId}`);
  return region;
}

// IDs are document-local; boxes and review decisions belong to the source page.
export function sourceRegion(document, regionId) {
  const matches = document.pages.flatMap(page => page.regions
    .filter(region => region.id === regionId).map(region => ({ page, region })));
  return matches.length === 1 ? matches[0] : null;
}

function invalidateRegionRelationships(document, regionId) {
  const pending = [regionId];
  const visited = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    for (const page of document.pages) {
      for (const edge of page.edges.filter(edge => edge.from === id || edge.to === id)) {
        edge.status = 'proposed';
        invalidatePageReview(page);
        if (edge.to !== id || edge.from === id || !['caption-of', 'footnote-of'].includes(edge.type)) continue;
        const dependent = page.regions.find(region => region.id === edge.from);
        if (!dependent) continue;
        dependent.status = 'proposed';
        if (dependent.footnoteReview) dependent.footnoteReview.sourceChecked = false;
        pending.push(dependent.id);
      }
    }
  }
}

function replaceTextRegions(document, page, edit) {
  const ids = edit.regionIds;
  const replacements = edit.regions;
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length ||
      !Array.isArray(replacements) || ![1, 2].includes(replacements.length))
    throw new RangeError('Choose adjacent text regions and one or two replacements.');
  const originals = ids.map(id => findRegion(page, id));
  const textTypes = ['paragraph', 'heading'];
  if (originals.some(region => !textTypes.includes(region.type) || region.table || region.figureReview || region.equationReview))
    throw new RangeError('Only ordinary text regions can be split or merged.');
  const replaced = new Set(ids);
  const affected = page.edges.filter(edge => replaced.has(edge.from) || replaced.has(edge.to));
  if (document.pages.flatMap(item => item.edges).some(edge =>
    (replaced.has(edge.from) || replaced.has(edge.to)) && edge.type !== 'reading-next'))
    throw new RangeError('Resolve specialized relationships before restructuring text.');
  for (const id of ids) if (affected.filter(edge => edge.from === id).length > 1 || affected.filter(edge => edge.to === id).length > 1)
    throw new RangeError('Choose text regions in one unambiguous adjacent sequence.');
  for (let index = 1; index < ids.length; index++) {
    if (!affected.some(edge => edge.from === ids[index - 1] && edge.to === ids[index]))
      throw new RangeError('Choose adjacent text regions in reading order.');
  }
  const externalIds = new Set(document.pages.flatMap(item => item.regions.filter(region =>
    item.id !== page.id || !replaced.has(region.id)).map(region => region.id)));
  const replacementIds = new Set();
  for (const region of replacements) {
    if (!region?.id || typeof region.id !== 'string' || replacementIds.has(region.id) || externalIds.has(region.id) ||
        !textTypes.includes(region.type) || typeof region.text !== 'string' || !region.text.trim() ||
        !validBox(region.box, page) || !Array.isArray(region.fragmentIds))
      throw new RangeError('Replacement text regions need unique IDs, text and valid source boxes.');
    replacementIds.add(region.id);
  }
  const oldFragments = originals.flatMap(region => region.fragmentIds);
  const newFragments = replacements.flatMap(region => region.fragmentIds);
  if (replacements.length === 2 && oldFragments.length && replacements.some(region => !region.fragmentIds.length))
    throw new RangeError('Split native text at a fragment boundary leaving source fragments in both parts.');
  if (new Set(oldFragments).size !== oldFragments.length || new Set(newFragments).size !== newFragments.length ||
      JSON.stringify([...oldFragments].sort()) !== JSON.stringify([...newFragments].sort()))
    throw new RangeError('Preserve every original source fragment exactly once.');
  const content = regions => regions.map(region => region.text).join('').replace(/\s/gu, '');
  if (content(originals) !== content(replacements))
    throw new RangeError('Preserve transcription when restructuring; correct its text separately against the source.');
  const first = replacements[0].id;
  const last = replacements.at(-1).id;
  const retainedEdges = page.edges.filter(edge => !affected.includes(edge));
  for (const edge of affected) {
    if (!replaced.has(edge.from)) retainedEdges.push({ ...edge, to: first, status: 'proposed' });
    else if (!replaced.has(edge.to)) retainedEdges.push({ ...edge, from: last, status: 'proposed' });
  }
  const edgeIds = new Set(retainedEdges.map(edge => edge.id));
  for (let index = 1; index < replacements.length; index++) {
    const base = `reading-${replacements[index - 1].id}-${replacements[index].id}`;
    let id = base;
    for (let suffix = 1; edgeIds.has(id); suffix++) id = `${base}-${suffix}`;
    edgeIds.add(id);
    retainedEdges.push({ id, type: 'reading-next', from: replacements[index - 1].id,
      to: replacements[index].id, status: 'proposed' });
  }
  const position = page.regions.findIndex(region => replaced.has(region.id));
  page.regions = page.regions.filter(region => !replaced.has(region.id));
  page.regions.splice(position, 0, ...replacements.map(region => ({
    id: region.id, type: region.type, text: region.text, box: copy(region.box), fragmentIds: [...region.fragmentIds],
    provenance: originals.every(original => original.provenance === originals[0].provenance) ? originals[0].provenance : 'mixed',
    status: 'proposed', exclusionReason: ''
  })));
  page.edges = retainedEdges;
  page.issues = (page.issues || []).flatMap(issue => replaced.has(issue.regionId)
    ? replacements.map(region => ({ ...issue, regionId: region.id })) : [issue]);
  invalidatePageReview(page);
  if (document.selectedRegionIds.some(id => replaced.has(id)))
    document.selectedRegionIds = [...document.selectedRegionIds.filter(id => !replaced.has(id)), ...replacementIds];
}

/**
 * Apply a reviewer edit without mutating the previous graph. Semantic edits
 * clear page inventory and the approval state of the affected relationships.
 * @param {DocumentStructure} document
 * @param {object} edit
 * @returns {DocumentStructure}
 */
export function applyStructureEdit(document, edit) {
  if (edit.kind === 'replace-document') return createDocumentStructure(edit.pages);
  const next = copy(document);
  if (edit.kind === 'set-selection') {
    next.selectedRegionIds = [...edit.regionIds];
    return next;
  }
  const page = findPage(next, edit.pageId);
  if (edit.kind === 'replace-text-regions') {
    replaceTextRegions(next, page, edit);
    return next;
  }
  if (edit.kind === 'set-page-inventory') {
    page.visualInventoryConfirmed = Boolean(edit.confirmed);
    return next;
  }
  if (edit.kind === 'assess-page-concern') {
    if (!page.issues?.some(issue => !issue.regionId && issue.code === edit.code) ||
        !validVisualAssessment(page, edit.code, edit.assessment))
      throw new RangeError('Visual concern assessment needs an original-page check and valid recorded regions or an inspected empty page.');
    page.visualConcernReviews ??= {};
    page.visualConcernReviews[edit.code] = copy(edit.assessment);
    page.visualInventoryConfirmed = false;
    return next;
  }
  if (edit.kind === 'add-region') {
    if (page.regions.some(region => region.id === edit.region.id)) throw new RangeError(`Duplicate region: ${edit.region.id}`);
    page.regions.push({ ...copy(edit.region), status: 'proposed' });
    invalidatePageReview(page);
    return next;
  }
  if (edit.kind === 'update-region') {
    const region = findRegion(page, edit.regionId);
    const semanticKeys = ['text', 'type', 'box', 'fragmentIds', 'table', 'equationReview', 'figureReview', 'footnoteReview', 'provenance'];
    const semanticChange = semanticKeys.some(key => Object.hasOwn(edit.changes, key));
    Object.assign(region, copy(edit.changes));
    if (semanticChange) {
      region.status = 'proposed';
      if (region.footnoteReview) region.footnoteReview.sourceChecked = false;
    }
    if (semanticChange || (Object.hasOwn(edit.changes, 'status') && region.status !== 'verified'))
      invalidateRegionRelationships(next, region.id);
    invalidatePageReview(page);
    return next;
  }
  if (edit.kind === 'update-edge') {
    const edge = page.edges.find(candidate => candidate.id === edit.edgeId);
    if (!edge) throw new RangeError(`Unknown edge: ${edit.edgeId}`);
    const semanticChange = ['type', 'from', 'to'].some(key => Object.hasOwn(edit.changes, key));
    const origins = new Set([edge.from, edit.changes.from ?? edge.from]);
    Object.assign(edge, copy(edit.changes));
    if (semanticChange) {
      edge.status = 'proposed';
      for (const id of origins) {
        const origin = sourceRegion(next, id)?.region;
        if (origin && ['caption', 'footnote'].includes(origin.type)) {
          origin.status = 'proposed';
          if (origin.footnoteReview) origin.footnoteReview.sourceChecked = false;
        }
        invalidateRegionRelationships(next, id);
      }
    }
    invalidatePageReview(page);
    return next;
  }
  if (edit.kind === 'reorder') {
    const expected = page.regions.map(region => region.id).sort();
    if (JSON.stringify([...edit.regionIds].sort()) !== JSON.stringify(expected)) throw new RangeError('Reorder must include every region once');
    page.edges = page.edges.filter(edge => edge.type !== 'reading-next');
    for (let index = 1; index < edit.regionIds.length; index++) {
      page.edges.push({ id: `reading-${edit.regionIds[index - 1]}-${edit.regionIds[index]}`,
        type: 'reading-next', from: edit.regionIds[index - 1], to: edit.regionIds[index], status: 'proposed' });
    }
    invalidatePageReview(page);
    return next;
  }
  if (edit.kind === 'set-cells' || edit.kind === 'set-equation' || edit.kind === 'set-figure-labels') {
    const region = findRegion(page, edit.regionId);
    if (edit.kind === 'set-cells') {
      if (region.type !== 'table') throw new RangeError('Cell edits require a table region');
      region.table = copy(edit.table);
    } else if (edit.kind === 'set-equation') {
      if (region.type !== 'equation') throw new RangeError('Equation edits require an equation region');
      region.text = edit.transcription;
      region.equationReview = { sourceChecked: Boolean(edit.sourceChecked) };
    } else {
      if (region.type !== 'figure') throw new RangeError('Figure labels require a figure region');
      region.figureReview = { decision: edit.decision, labels: copy(edit.labels || []), sourceChecked: Boolean(edit.sourceChecked) };
    }
    region.status = 'proposed';
    invalidateRegionRelationships(next, region.id);
    invalidatePageReview(page);
    return next;
  }
  if (edit.kind === 'set-caption-link') {
    const caption = findRegion(page, edit.captionId);
    const targetId = edit.targetId ?? edit.figureId;
    if (!sourceRegion(next, targetId)) throw new RangeError(`Unknown or ambiguous region: ${targetId}`);
    if (caption.type !== 'caption') throw new RangeError('Caption link requires a caption region');
    invalidateRegionRelationships(next, caption.id);
    page.edges = page.edges.filter(edge => !(edge.type === 'caption-of' && edge.from === caption.id));
    page.edges.push({ id: `caption-${caption.id}-${targetId}`, type: 'caption-of',
      from: caption.id, to: targetId, status: 'proposed' });
    invalidatePageReview(page);
    return next;
  }
  if (edit.kind === 'set-footnote-review') {
    const region = findRegion(page, edit.regionId);
    const ids = edit.targetRegionIds;
    if (region.type !== 'footnote' || !['linked', 'standalone'].includes(edit.decision) || !Array.isArray(ids))
      throw new RangeError('Choose a footnote and a visual association decision.');
    if (edit.decision === 'linked' && (!ids.length || new Set(ids).size !== ids.length ||
        ids.some(id => {
          const target = sourceRegion(next, id)?.region;
          return !target || target.id === region.id || target.type === 'footnote';
        })))
      throw new RangeError('Footnote target regions must exist and exclude self and duplicates.');
    if (edit.decision === 'standalone' && (ids.length || !edit.standaloneReason?.trim()))
      throw new RangeError('A standalone footnote needs a visible reason and no target regions.');
    region.footnoteReview = { sourceChecked: edit.sourceChecked === true, decision: edit.decision,
      standaloneReason: edit.standaloneReason || '' };
    region.status = 'proposed';
    invalidateRegionRelationships(next, region.id);
    page.edges = page.edges.filter(edge => !(edge.type === 'footnote-of' && edge.from === region.id));
    if (edit.decision === 'linked') for (const id of ids) page.edges.push({ id: `footnote-${region.id}-${id}`,
      type: 'footnote-of', from: region.id, to: id, status: 'proposed' });
    invalidatePageReview(page);
    return next;
  }
  throw new RangeError(`Unknown structure edit: ${edit.kind}`);
}

function addIssue(issues, code, pageId, regionId, message) {
  issues.push({ code, pageId, ...(regionId ? { regionId } : {}), message });
}

function validBox(box, page) {
  return box && [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
    box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 &&
    box.x + box.width <= page.width && box.y + box.height <= page.height;
}

function validateTable(region, page, issues) {
  if (region.type !== 'table') return;
  const table = region.table;
  if (!table || !validTableDimensions(table.rowCount, table.columnCount) || !Array.isArray(table.cells) || !table.cells.length) {
    addIssue(issues, 'invalid-cell', page.id, region.id, 'Table grid is missing or empty.');
    return;
  }
  const ids = new Set();
  const occupied = new Set();
  for (const cell of table.cells) {
    const shape = cell && typeof cell.id === 'string' && cell.id &&
      [cell.row, cell.column, cell.rowSpan, cell.colSpan].every(Number.isInteger) &&
      cell.row >= 0 && cell.column >= 0 && cell.rowSpan > 0 && cell.colSpan > 0 &&
      cell.row + cell.rowSpan <= table.rowCount && cell.column + cell.colSpan <= table.columnCount;
    if (!shape || ids.has(cell.id)) {
      addIssue(issues, 'invalid-cell', page.id, region.id, 'A table cell has an invalid ID or span.');
      continue;
    }
    ids.add(cell.id);
    if (unreadableGlyph.test(cell.text || '') || unreadableGlyph.test(cell.blankReason || ''))
      addIssue(issues, 'unreadable-glyph', page.id, region.id, 'Unreadable table cell glyph must be corrected.');
    if (!['header', 'value', 'blank'].includes(cell.role))
      addIssue(issues, 'invalid-cell', page.id, region.id, 'Table cell role is missing or invalid.');
    if (cell.role === 'blank' && !(cell.blankReason || '').trim())
      addIssue(issues, 'invalid-cell', page.id, region.id, 'Blank cell needs an inherited or visually blank reason.');
    if (cell.role === 'blank' && (cell.text || '').trim())
      addIssue(issues, 'invalid-cell', page.id, region.id, 'Blank cell cannot contain transcribed content.');
    if (cell.role !== 'blank' && !(cell.text || '').trim())
      addIssue(issues, 'invalid-cell', page.id, region.id, 'Nonblank cell needs transcription.');
    for (let row = cell.row; row < cell.row + cell.rowSpan; row++) {
      for (let column = cell.column; column < cell.column + cell.colSpan; column++) {
        const position = `${row}:${column}`;
        if (occupied.has(position)) addIssue(issues, 'invalid-cell', page.id, region.id, 'Table cells overlap.');
        occupied.add(position);
      }
    }
  }
  for (let row = 0; row < table.rowCount; row++) for (let column = 0; column < table.columnCount; column++) {
    if (!occupied.has(`${row}:${column}`)) addIssue(issues, 'missing-cell', page.id, region.id, `Table cell ${row + 1}:${column + 1} is not represented.`);
  }
  const byId = new Map(table.cells.map(cell => [cell.id, cell]));
  for (const cell of table.cells) {
    for (const headerId of cell.headerCellIds || []) if (byId.get(headerId)?.role !== 'header')
      addIssue(issues, 'invalid-header-binding', page.id, region.id, `Cell ${cell.id} has an absent or non-header association.`);
  }
  if (!table.reviewed) addIssue(issues, 'table-unreviewed', page.id, region.id, 'Table cell ownership has not been checked against the source.');
}

export function isVerifiedCaptionTarget(region, page) {
  if (region?.status !== 'verified' || !['figure', 'table'].includes(region.type) ||
      !validBox(region.box, page) || unreadableGlyph.test(region.text || '')) return false;
  const issues = [];
  validateTable(region, page, issues);
  validateFigure(region, page, issues);
  return issues.length === 0;
}

// Notes may refer to a caption, whose own table/figure relation must be valid.
// Footnote-to-footnote links are forbidden, so this follows only bounded typed
// dependencies instead of accepting an otherwise unresolved verified flag.
export function isVerifiedFootnoteTarget(document, noteId, targetId) {
  const target = sourceRegion(document, targetId)?.region;
  return Boolean(target && target.id !== noteId && target.type !== 'footnote' &&
    validateDocumentStructure(document, { scope: 'excerpt', selectedRegionIds: [targetId] }).ok);
}

function validateFigure(region, page, issues) {
  if (region.type !== 'figure') return;
  const review = region.figureReview;
  if ((review?.labels || []).some(label => unreadableGlyph.test(label.text || '')))
    addIssue(issues, 'unreadable-glyph', page.id, region.id, 'Unreadable figure label glyph must be corrected.');
  const validNoText = review?.decision === 'no-internal-text' && review.labels?.length === 0;
  const validLabels = review?.decision === 'labels-transcribed' && review.labels?.length > 0 &&
    review.labels.every(label => label.id && label.text?.trim() && (!label.box || validBox(label.box, page)));
  if (!review?.sourceChecked || (!validNoText && !validLabels))
    addIssue(issues, 'figure-unassessed', page.id, region.id, 'Figure internal text needs reviewed labels or an explicit no-text decision.');
}

function validateSpecialRegion(region, page, issues, edges, document) {
  if (region.type === 'footnote') {
    const review = region.footnoteReview;
    const links = edges.filter(edge => edge.type === 'footnote-of' && edge.from === region.id);
    const standalone = review?.decision === 'standalone' && review.standaloneReason?.trim() && !links.length;
    const linked = review?.decision === 'linked' && links.length > 0 &&
      new Set(links.map(edge => edge.to)).size === links.length && links.every(edge => edge.status === 'verified');
    if (review?.sourceChecked !== true || (!standalone && !linked))
      addIssue(issues, 'footnote-unassessed', page.id, region.id, 'Footnote needs source-reviewed target links or an explicit standalone reason.');
    for (const link of links) {
      if (!isVerifiedFootnoteTarget(document, region.id, link.to))
        addIssue(issues, 'invalid-footnote-target', page.id, region.id, 'Footnote target is not a verified source region.');
    }
  }
  if (region.type === 'equation' && (!region.equationReview?.sourceChecked || !region.text?.trim()))
    addIssue(issues, 'equation-unreviewed', page.id, region.id, 'Equation transcription was not checked against its source crop.');
  validateFigure(region, page, issues);
  if (region.type === 'caption') {
    const links = edges.filter(edge => edge.type === 'caption-of' && edge.from === region.id);
    if (links.length !== 1 || links[0].status !== 'verified')
      addIssue(issues, 'caption-link-unresolved', page.id, region.id, 'Caption needs one verified table or figure link.');
    for (const link of links) {
      const target = sourceRegion(document, link.to);
      if (!target || !isVerifiedCaptionTarget(target.region, target.page))
        addIssue(issues, 'invalid-caption-target', page.id, region.id, 'Caption target is not a source-reviewed table or figure.');
    }
  }
}

function hasReadingCycle(edges) {
  const graph = new Map();
  for (const edge of edges.filter(edge => edge.type === 'reading-next')) {
    if (!graph.has(edge.from)) graph.set(edge.from, []);
    graph.get(edge.from).push(edge.to);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const to of graph.get(id) || []) if (visit(to)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  return [...graph.keys()].some(visit);
}

// Excerpt assembly must not invent sequence from region array order. Selected
// regions may skip content, but the connecting path still needs source review.
function validateReadingPath(page, targets, issues) {
  if (targets.size < 2) return;
  const edges = (page.edges || []).filter(edge => edge.type === 'reading-next');
  const next = new Map();
  const incoming = new Set();
  const ids = new Set((page.regions || []).map(region => region.id));
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    if (next.has(edge.from) || incoming.has(edge.to)) {
      addIssue(issues, 'ambiguous-reading-order', page.id, null, 'Reading order branches or has repeated transitions.');
      return;
    }
    next.set(edge.from, edge);
    incoming.add(edge.to);
  }
  for (const root of ids) {
    if (incoming.has(root)) continue;
    const chain = [];
    const seen = new Set();
    let id = root;
    while (id && !seen.has(id)) {
      seen.add(id);
      chain.push(id);
      id = next.get(id)?.to;
    }
    if (![...targets].every(target => seen.has(target))) continue;
    const positions = chain.flatMap((regionId, index) => targets.has(regionId) ? [index] : []);
    for (let index = positions[0]; index < positions.at(-1); index++) {
      if (next.get(chain[index])?.status !== 'verified') {
        addIssue(issues, 'unverified-edge', page.id, null, 'Selected reading path has an unverified transition.');
        break;
      }
    }
    return;
  }
  addIssue(issues, 'disconnected-reading-order', page.id, null, 'Selected regions have no single connecting reading path.');
}

/**
 * Validate either a whole page or the selected excerpt. Unresolved material
 * outside an excerpt may remain visible without falsely completing the page.
 * @param {DocumentStructure} document
 * @param {{scope:'page'|'excerpt',pageId?:string,selectedRegionIds?:string[]}} options
 * @returns {{ok:boolean,issues:Issue[]}}
 */
export function validateDocumentStructure(document, options) {
  const issues = [];
  if (document?.schemaVersion !== 1 || !Array.isArray(document.pages)) {
    addIssue(issues, 'unsupported-schema', '', null, 'Unsupported document structure schema.');
    return { ok: false, issues };
  }
  if (options?.scope !== 'page' && options?.scope !== 'excerpt') {
    addIssue(issues, 'invalid-scope', '', null, 'Choose a page or excerpt validation scope.');
    return { ok: false, issues };
  }
  const isPage = options.scope === 'page';
  const selected = new Set(isPage ? [] : options.selectedRegionIds ?? document.selectedRegionIds ?? []);
  if (!isPage && !selected.size) addIssue(issues, 'empty-selection', '', null, 'Select a source region.');
  const pages = isPage ? document.pages.filter(page => page.id === options.pageId) : document.pages;
  if (isPage && !pages.length) addIssue(issues, 'unknown-page', options.pageId ?? '', null, 'Page was not found.');
  const selectedFound = new Set();
  const globalIds = new Set();
  for (const page of pages) {
    const regionIds = new Set();
    const fragmentOwners = new Map();
    for (const region of page.regions || []) {
      if (globalIds.has(region.id)) addIssue(issues, 'duplicate-region', page.id, region.id, 'Region ID is repeated.');
      globalIds.add(region.id);
      regionIds.add(region.id);
      if (!isPage && selected.has(region.id)) selectedFound.add(region.id);
      const relevant = isPage || selected.has(region.id);
      for (const fragmentId of region.fragmentIds || []) {
        const owner = fragmentOwners.get(fragmentId);
        if (owner && (isPage || selected.has(owner) || selected.has(region.id)))
          addIssue(issues, 'duplicate-fragment', page.id, region.id, 'A PDF fragment belongs to multiple regions.');
        fragmentOwners.set(fragmentId, region.id);
      }
      if (!relevant) continue;
      if (!validBox(region.box, page)) addIssue(issues, 'invalid-box', page.id, region.id, 'Region bounds are outside the source page.');
      if (unreadableGlyph.test(region.text || '')) addIssue(issues, 'unreadable-glyph', page.id, region.id, 'Unreadable control glyph must be corrected.');
      validateTable(region, page, issues);
      validateSpecialRegion(region, page, issues, page.edges || [], document);
      if (region.status === 'excluded' && !(region.exclusionReason || '').trim())
        addIssue(issues, 'unreasoned-exclusion', page.id, region.id, 'Excluded content needs a visible reason.');
      if (isPage && region.status !== 'verified') addIssue(issues, 'unverified-region', page.id, region.id, 'Region is not verified.');
      if (!isPage && region.status !== 'verified') addIssue(issues, 'unresolved-selection', page.id, region.id, 'Selected region is not verified.');
    }
    if (isPage) {
      const expected = new Set(page.fragmentIds || []);
      for (const fragmentId of expected) if (!fragmentOwners.has(fragmentId))
        addIssue(issues, 'missing-fragment', page.id, null, `PDF fragment ${fragmentId} is not assigned.`);
      for (const fragmentId of fragmentOwners.keys()) if (!expected.has(fragmentId))
        addIssue(issues, 'foreign-fragment', page.id, null, `Unknown PDF fragment ${fragmentId} is assigned.`);
      if (!page.visualInventoryConfirmed) addIssue(issues, 'inventory-unconfirmed', page.id, null, 'Visual page inventory was not confirmed.');
    }
    const relevantEdges = (page.edges || []).filter(edge => isPage || (selected.has(edge.from) && selected.has(edge.to)));
    for (const edge of relevantEdges) {
      const semanticTarget = ['caption-of', 'footnote-of'].includes(edge.type);
      if (!regionIds.has(edge.from) || (semanticTarget ? !sourceRegion(document, edge.to) : !regionIds.has(edge.to)))
        addIssue(issues, 'dangling-edge', page.id, null, 'Relationship points to an absent region.');
      if (edge.status !== 'verified') addIssue(issues, 'unverified-edge', page.id, null, 'Relationship is not verified.');
    }
    if (hasReadingCycle(relevantEdges)) addIssue(issues, 'reading-cycle', page.id, null, 'Reading order contains a cycle.');
    validateReadingPath(page, isPage ? regionIds : new Set([...selected].filter(id => regionIds.has(id))), issues);
    for (const issue of page.issues || []) {
      if (!isPage && !(issue.regionId && selected.has(issue.regionId))) continue;
      if (!issue.regionId && visualConcernResolved(page, issue.code)) continue;
      const region = page.regions.find(candidate => candidate.id === issue.regionId);
      if (issue.code === 'table-grid-unverified' && region?.type !== 'table') continue;
      if (issue.code === 'equation-unverified' && region?.type !== 'equation') continue;
      if (issue.code === 'caption-link-unresolved' && region?.type !== 'caption') continue;
      if (issue.code === 'table-grid-unverified' && region?.type === 'table' && region.status === 'verified' && region.table?.reviewed) continue;
      if (issue.code === 'equation-unverified' && region?.type === 'equation' && region.status === 'verified' && region.equationReview?.sourceChecked) continue;
      if (issue.code === 'caption-link-unresolved' && region?.type === 'caption' &&
        page.edges.some(edge => edge.type === 'caption-of' && edge.from === region.id && edge.status === 'verified')) continue;
      if (issue.code === 'ocr-order-unverified' && region?.status === 'verified') continue;
      issues.push(copy(issue));
    }
  }
  if (!isPage) for (const id of selected) if (!selectedFound.has(id))
    addIssue(issues, 'unknown-selection', '', id, 'Selected source region is absent.');
  return { ok: issues.length === 0, issues };
}
