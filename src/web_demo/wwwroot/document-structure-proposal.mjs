import { recoverReadingOrder } from './document-layout.mjs';

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

function proposedType(line) {
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
export function proposePageStructure({ pageIndex, width, height, fragments, hasImages, ocrText }) {
  const pageId = `p${pageIndex + 1}`;
  const sourceIds = fragments.flatMap((fragment, index) => fragment.text?.trim() ? [`${pageId}-f${index}`] : []);
  const page = { id: pageId, width, height, fragmentIds: sourceIds,
    regions: [], edges: [], issues: [], visualInventoryConfirmed: false };
  const ordered = recoverReadingOrder(fragments, width, 'auto');
  const toSourceId = index => `${pageId}-f${index}`;
  const addRegion = (lines, type) => {
    if (!lines.length) return;
    const id = `${pageId}-r${page.regions.length}`;
    const fragmentIds = lines.flatMap(line => line.fragmentIds.map(toSourceId));
    const text = lines.map(line => line.text).join('\n');
    const status = type === 'table' || type === 'equation' ? 'unresolved' : 'proposed';
    page.regions.push({ id, type, box: unionBox(lines), fragmentIds, text,
      provenance: 'pdf-text', status, exclusionReason: '' });
    if (type === 'table') page.issues.push(issue('table-grid-unverified', pageId,
      'Table rows and header/value cell associations need visual review.', id));
    if (type === 'equation') page.issues.push(issue('equation-unverified', pageId,
      'Mathematical notation and grouping need visual transcription.', id));
    if (type === 'caption') page.issues.push(issue('caption-link-unresolved', pageId,
      'Caption has not been linked to a verified source figure.', id));
  };
  let tableLines = [];
  for (const line of ordered.lines) {
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
