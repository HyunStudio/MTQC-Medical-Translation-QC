import {createNativeMathDraft,validateNativeMathLayout,parseNativeMathJson} from './document-native-math.mjs';
import {captureNativeTableSource,bindNativeTableCells} from './document-table-source.mjs';
import {createNativeTableGroupSession,hasNativeTableGroup} from './document-native-table-group.mjs';
import {createStructureComparisonSource} from './document-structure-correspondence.mjs';
import { applyStructureEdit, createDocumentStructure, validateDocumentStructure, validTableDimensions, MAX_TABLE_DIMENSION, VISUAL_PAGE_CONCERNS, isVerifiedCaptionTarget, isVerifiedFootnoteTarget, footnoteCellOptions, footnoteEdgeTarget, parseFootnoteTarget, sourceRegion } from './document-structure.mjs';
import { proposePageStructure, getTableProposalDiagnostic } from './document-structure-proposal.mjs';
import { fitSourceCrop } from './document-render-limits.mjs';
import { capturePrivateSourcePages, createPrivateReviewSnapshot } from './document-private-review-snapshot.mjs';
import { createPrivateInteractionJournal } from './document-private-interaction-journal.mjs';
import { createGlyphReviewRelay } from './document-glyph-review-relay.mjs';
import { createRasterSourceDraftSession } from './document-raster-regions.mjs';

const boxText = box => `${Math.round(box.x)}, ${Math.round(box.y)}, ${Math.round(box.width)}, ${Math.round(box.height)}`;

function parseBox(value) {
  const numbers = value.split(',').map(part => Number(part.trim()));
  if (numbers.length !== 4 || numbers.some(number => !Number.isFinite(number))) return null;
  const [x, y, width, height] = numbers;
  return { x, y, width, height };
}

function validBox(box, page) {
  return box && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 &&
    box.x + box.width <= page.width && box.y + box.height <= page.height;
}

/** Keep source geometry and reviewer decisions in one browser-local graph. */
export function mountStructureReview({ host, preview, onChange = () => {} }) {
  let graph = createDocumentStructure([]);
  let sourcePages = null;
  let sourceGeneration = 0;
  let tableProposalEvidence = [];
  const tableProposalDiagnostic = document.createElement('pre');
  tableProposalDiagnostic.id = 'structure-table-proposal-diagnostic';
  tableProposalDiagnostic.hidden = true;
  host.append(tableProposalDiagnostic);
  let glyphRelay = null;
  let glyphDirty = false;
  let glyphCropSource = null;
  // Original source records stay private; graph/snapshot clones never supply raster authority.
  let rasterRecords = [], rasterSessions = [], rasterChoices = [], rasterChosen = null;
  let rasterCropSource = null;
  const rasterList = host.querySelector('#structure-raster-list');
  const rasterStatus = host.querySelector('#structure-raster-status');
  const rasterPreview = host.querySelector('#structure-raster-preview');
  const rasterAdd = host.querySelector('#structure-raster-add');
  const interactionJournal = createPrivateInteractionJournal();
  let mathPending = null, tablePending = null;
  let selectedId = null;
  let activePageId = null;
  let drawingStart = null;
  const status = host.querySelector('#structure-status');
  const regionList = host.querySelector('#structure-region-list');
  const order = host.querySelector('#structure-reading-order');
  const regionText = host.querySelector('#structure-region-text');
  const regionType = host.querySelector('#structure-region-type');
  const regionBox = host.querySelector('#structure-region-box');
  const regionSave = host.querySelector('#structure-region-save');
  const regionVerify = host.querySelector('#structure-region-verify');
  const reason = host.querySelector('#structure-exclude-reason');
  const exclude = host.querySelector('#structure-region-exclude');
  const inventory = host.querySelector('#structure-inventory');
  const visualConcerns = host.querySelector('#structure-visual-concerns');
  const issues = host.querySelector('#structure-issues');
  const newPanel = host.querySelector('#structure-new-panel');
  const newText = host.querySelector('#structure-new-text');
  const newBox = host.querySelector('#structure-new-box');
  const specialized = host.querySelector('#structure-specialized');
  const sourceCrop = host.querySelector('#structure-source-crop');
  const glyphDiagnostic = host.querySelector('#structure-glyph-diagnostic');
  const tableEditor = host.querySelector('#structure-table-editor');
  const equationEditor = host.querySelector('#structure-equation-editor');
  const figureEditor = host.querySelector('#structure-figure-editor');
  const captionEditor = host.querySelector('#structure-caption-editor');
  const footnoteEditor = host.querySelector('#structure-footnote-editor');
  const orderChecked = host.querySelector('#structure-order-checked');
  const orderVerify = host.querySelector('#structure-order-verify');
  const mergeText = host.querySelector('#structure-merge-text');
  const splitText = host.querySelector('#structure-split-text');
  const splitPanel = host.querySelector('#structure-split-panel');
  let pendingSplit = null;

  const currentPage = () => graph.pages.find(page => page.id === activePageId);
  const currentRegion = () => currentPage()?.regions.find(region => region.id === selectedId);
  const tableGrouping=createNativeTableGroupSession({getCurrent:tableGroupingCurrent,makeDraft:(document,change)=>applyStructureEdit(document,change)});

  function tableGroupingCurrent(pageId = activePageId) {
    const page = graph.pages.find(p=>p.id===pageId);
    if(!page)return null;
    return {graph,pageId,record:rasterRecords[Number(pageId.slice(1))-1],canvas:sourceCanvas(pageId),generation:sourceGeneration,
      regionIds:readingIds(page).filter(id=>graph.selectedRegionIds.includes(id)),box:parseBox(host.querySelector('#structure-table-group-box').value)};
  }

  function tableGroupOrderPending(page) {
    return Boolean(page?.regions.some(r=>hasNativeTableGroup(r)&&Object.getOwnPropertyDescriptor(r,'nativeTableGroup')?.value?.orderReviewed!==true));
  }

  function captureTableGrouping() {
    const result=tableGrouping.capture();
    renderTableGrouping();
    status.textContent=result.status==='draft'?'Compare the original native inventory and explicit crop, then check and create an unreviewed table draft.':'Native table grouping held. Use current same-page native regions and an unambiguous reading sequence.';
  }

  function applyTableGrouping() {
    const result=tableGrouping.commit({sourceChecked:host.querySelector('#structure-table-group-checked').checked});
    if(!result.ok){renderTableGrouping();status.textContent='Native table grouping held. Capture and explicitly compare the current source again.';return;}
    const before=structuralState();mathPending=null;tablePending=null;graph=result.document;selectedId=result.regionId;
    glyphRelay?.invalidate(activePageId);invalidateRaster(activePageId);recordStructuralChange(before,'group-native-table');render();notifyChange();
  }

  function renderTableGrouping() {
    const page=currentPage(), ids=page?readingIds(page).filter(id=>graph.selectedRegionIds.includes(id)):[],regions=ids.map(id=>page.regions.find(r=>r.id===id));
    const input=host.querySelector('#structure-table-group-box'),capture=host.querySelector('#structure-table-group-capture');
    const eligible=ids.length>=2&&ids.length<=32&&ids.length===graph.selectedRegionIds.length&&regions.every(r=>r.provenance==='pdf-text'&&['paragraph','heading'].includes(r.type)&&['proposed','unresolved'].includes(r.status));
    capture.disabled=!eligible;input.disabled=!eligible;const key=(page?.id||'')+'|'+ids.join('|');
    if(input.dataset.selectionKey!==key){const previous=Object.hasOwn(input.dataset,'selectionKey');if(previous)tableGrouping.invalidatePending();input.dataset.selectionKey=key;if(eligible&&(previous||!input.value)){const x=Math.min(...regions.map(r=>r.box.x)),y=Math.min(...regions.map(r=>r.box.y));input.value=[x,y,Math.max(...regions.map(r=>r.box.x+r.box.width))-x,Math.max(...regions.map(r=>r.box.y+r.box.height))-y].join(', ');}else if(!eligible)input.value='';}
    const draft=tableGrouping.peek();host.querySelector('#structure-table-group-checked').checked=false;
    host.querySelector('#structure-table-group-apply').disabled=draft.status!=='draft';
    host.querySelector('#structure-table-group-inventory').textContent=draft.status==='draft'?JSON.stringify({source:draft.source,sourceReviewed:false,visibility:'unverified'},null,2):'Native table grouping unknown. Include source regions, set the explicit crop, and capture. Cells and headers remain unassigned.';
  }

  function reviewTableGroupingOrder() {
    if (!orderChecked.checked || !currentPage()) return;
    const before = structuralState();
    for (const edge of currentPage().edges.filter(item => item.type === 'reading-next'))
      graph = applyStructureEdit(graph, { kind: 'update-edge', pageId: activePageId,
        edgeId: edge.id, changes: { status: 'verified' } });
    if(currentPage().regions.some(hasNativeTableGroup)) {
      try { graph=applyStructureEdit(graph,{kind:'review-table-group-order',pageId:activePageId,sourceChecked:true}); }
      catch {status.textContent='Review the grouped native cell sources before confirming reading order.';render();notifyChange();return;}
    }
    glyphRelay?.invalidate(activePageId);
    invalidateRaster(activePageId);
    recordStructuralChange(before,'verify-reading-order');
    render();
    notifyChange();
  }


  function activatePage(pageId) {
    mathPending = null; tablePending = null;
    if (activePageId !== pageId) {
      orderChecked.checked = false;
      selectedId = null;
      pendingSplit = null;
      splitPanel.hidden = true;
      graph = applyStructureEdit(graph, { kind: 'set-selection', regionIds: [] });
    }
    activePageId = pageId;
  }

  const ordinaryText = region => region && ['paragraph', 'heading'].includes(region.type) &&
    !region.table && !region.figureReview && !region.equationReview;

  function readingIds(page) {
    if (!page) return [];
    const next = new Map(page.edges.filter(edge => edge.type === 'reading-next').map(edge => [edge.from, edge.to]));
    const incoming = new Set(next.values());
    const ids = [];
    const seen = new Set();
    for (const region of page.regions) {
      if (incoming.has(region.id)) continue;
      let id = region.id;
      while (id && !seen.has(id)) { ids.push(id); seen.add(id); id = next.get(id); }
    }
    for (const region of page.regions) if (!seen.has(region.id)) ids.push(region.id);
    return ids;
  }

  function notifyChange() {
    onChange({ document: structuredClone(graph), excerpt: getVerifiedExcerpt() });
  }

  function structuralState() {
    return sourcePages === null ? null : new Map(graph.pages.map(page => [page.id,JSON.stringify(page)]));
  }

  function recordStructuralChange(before, kind, origin = 'review-ui') {
    tablePending = null;
    if (!before) return;
    const pageIds = graph.pages.filter(page => before.get(page.id) !== JSON.stringify(page)).map(page => page.id);
    if (pageIds.length) interactionJournal.record({kind,origin,pageIds});
  }

  function edit(change, nextSelectedId = selectedId, origin = 'review-ui') {
    mathPending = null; tablePending = null;
    const before = structuralState();
    graph = applyStructureEdit(graph, change);
    glyphRelay?.invalidate(change.pageId);
    invalidateRaster(change.pageId);
    recordStructuralChange(before,change.kind,origin);
    selectedId = nextSelectedId;
    if (['reorder', 'add-region', 'update-region', 'set-cells', 'set-equation', 'set-figure-labels', 'set-footnote-review', 'replace-text-regions', 'group-equation', 'set-table-source'].includes(change.kind)) orderChecked.checked = false;
    pendingSplit = null;
    splitPanel.hidden = true;
    render();
    notifyChange();
  }

  function getVerifiedExcerpt() {
    const selected = graph.selectedRegionIds;
    if (!selected?.length) return null;
    // Typed caption/note dependencies may be outside the selected excerpt.
    const pending=[...selected], seen=new Set(), dependencies=graph.pages.flatMap(page=>page.edges);
    while(pending.length) {
      const id=pending.pop(); if(seen.has(id))continue; seen.add(id);
      const region=sourceRegion(graph,id)?.region;
      if((hasNativeTableGroup(region)||tableGrouping.has(id))&&!tableGrouping.isCurrent(id))return null;
      for(const edge of dependencies)if(edge.from===id&&['caption-of','footnote-of'].includes(edge.type))pending.push(edge.to);
    }
    const validation = validateDocumentStructure(graph, { scope: 'excerpt', selectedRegionIds: selected });
    if (!validation.ok) return null;
    const ordered = graph.pages.flatMap(page => readingIds(page).filter(id => selected.includes(id))
      .map(id => ({ page, region: page.regions.find(item => item.id === id) })));
    if (ordered.length !== selected.length) return null;
    const sourceText = ordered.map(({ region }) => {
      if (region.type === 'figure') {
        const labels = region.figureReview?.labels?.map(label => label.text.trim()).filter(Boolean) || [];
        return labels.length
          ? `FIGURE${region.text.trim() ? ` · ${region.text.trim()}` : ''}\nVISIBLE LABELS:\n${labels.join('\n')}`
          : region.text.trim();
      }
      if (region.type !== 'table') return region.text.trim();
      const rows = Array.from({ length: region.table.rowCount }, (_, index) =>
        region.table.cells.filter(cell => cell.row === index).sort((a, b) => a.column - b.column)
          .map(cell => `${cell.id}[r${cell.row + 1}c${cell.column + 1};${cell.rowSpan}x${cell.colSpan};${cell.role}${cell.headerCellIds?.length ? `→${cell.headerCellIds.join(',')}` : ''}]: ${cell.text || `[${cell.blankReason}]`}`).join(' | '));
      return `TABLE · ${region.text.trim()}\n${rows.join('\n')}`;
    }).filter(Boolean).join('\n\n');
    if (!sourceText) return null;
    return { sourceText, comparisonSource:createStructureComparisonSource({regions:ordered.map(item=>item.region),edges:graph.pages.flatMap(page=>page.edges),sourceText}), regionIds: ordered.map(item => item.region.id),
      sourceBoxes: ordered.map(({ page, region }) => ({ pageId: page.id, box: structuredClone(region.box) })) };
  }

  function renderSourceCrop(page, region) {
    // A failed or unavailable crop cannot leave the previous diagnostic current.
    glyphCropSource = null;
    sourceCrop.hidden = true;
    try {
      if (!page || !region || !validBox(region.box, page)) return;
      const frame = preview.querySelector(`[data-structure-page="${page.id}"]`);
      const source = frame?.querySelector('canvas, img');
      if (!source) return;
      if (source.tagName === 'IMG' && (!source.complete || source.naturalWidth <= 0 || source.naturalHeight <= 0)) return;
      if (source.tagName === 'CANVAS' && (source.width <= 0 || source.height <= 0)) return;
      const size = fitSourceCrop(region.box.width, region.box.height);
      if (!size) return;
      sourceCrop.width = size.width;
      sourceCrop.height = size.height;
      const context = sourceCrop.getContext('2d');
      if (!context) return;
      context.drawImage(source, region.box.x, region.box.y,
        region.box.width, region.box.height, 0, 0, sourceCrop.width, sourceCrop.height);
      sourceCrop.hidden = false;
      glyphCropSource = source;
    } catch {
      // Crop availability is a manual-review display boundary, not graph approval.
      sourceCrop.hidden = true;
    }
  }

  function renderTableCells(table) {
    const container = host.querySelector('#structure-table-cells');
    container.replaceChildren();
    for (const cell of table.cells || []) {
      const row = document.createElement('fieldset');
      row.className = 'structure-table-cell';
      row.dataset.cellId = cell.id;
      row.dataset.row = String(cell.row);
      row.dataset.column = String(cell.column);
      const heading = document.createElement('legend');
      heading.textContent = `Cell ${cell.id} · row ${cell.row + 1}, column ${cell.column + 1}`;
      row.append(heading);
      for (const [name, label, value, type] of [
        ['row', 'Row', cell.row + 1, 'number'], ['column', 'Column', cell.column + 1, 'number'],
        ['text', 'Text', cell.text || '', 'text'], ['rowSpan', 'Row span', cell.rowSpan, 'number'],
        ['colSpan', 'Column span', cell.colSpan, 'number'],
        ['headerCellIds', 'Header IDs, comma separated', (cell.headerCellIds || []).join(', '), 'text'],
        ['blankReason', 'Blank reason', cell.blankReason || '', 'text']
      ]) {
        const field = document.createElement('label');
        field.textContent = label;
        const input = document.createElement(name === 'text' ? 'textarea' : 'input');
        input.dataset.field = name;
        if (name === 'text') input.rows = 2; else input.type = type;
        if (type === 'number') { input.min = '1'; input.step = '1'; }
        if (name === 'row') input.max = String(table.rowCount);
        if (name === 'column') input.max = String(table.columnCount);
        input.value = String(value);
        field.append(input);
        row.append(field);
      }
      const roleLabel = document.createElement('label');
      roleLabel.textContent = 'Role';
      const role = document.createElement('select');
      role.dataset.field = 'role';
      for (const value of ['header', 'value', 'blank']) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        role.append(option);
      }
      role.value = cell.role || 'value';
      roleLabel.append(role);
      row.append(roleLabel);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove this cell';
      remove.addEventListener('click', () => {
        row.remove();
        host.querySelector('#structure-table-checked').checked = false;
      });
      row.append(remove);
      container.append(row);
    }
  }

  function sourceCanvas(pageId) {
    return preview.querySelector(`[data-structure-page="${pageId}"]`)?.querySelector('canvas') || null;
  }

  function readTableEditor() {
    const position = value => {
      const text = value.trim(), number = /^[0-9]+$/.test(text) ? Number(text) : NaN;
      return Number.isInteger(number) && number >= 1 && number <= MAX_TABLE_DIMENSION ? number - 1 : NaN;
    };
    const cells = [...host.querySelectorAll('.structure-table-cell')].map(row => {
      const field = name => row.querySelector(`[data-field="${name}"]`).value;
      return {id:row.dataset.cellId,row:position(field('row')),column:position(field('column')),
        rowSpan:Number(field('rowSpan')),colSpan:Number(field('colSpan')),text:field('text'),role:field('role'),
        blankReason:field('blankReason'),headerCellIds:field('headerCellIds').split(',').map(s => s.trim()).filter(Boolean)};
    });
    return {rowCount:Number(host.querySelector('#structure-table-rows').value),columnCount:Number(host.querySelector('#structure-table-columns').value),cells,reviewed:host.querySelector('#structure-table-checked').checked};
  }

  function tableEditorMatches(table) {
    if (!table) return false;
    const current = readTableEditor();
    return current.rowCount === table.rowCount && current.columnCount === table.columnCount &&
      current.cells.length === table.cells.length && current.cells.every((cell,i) => {
        const old = table.cells[i];
        return ['id','row','column','rowSpan','colSpan','text','role'].every(key => Object.is(cell[key],old[key])) &&
          cell.blankReason === (old.blankReason || '') && JSON.stringify(cell.headerCellIds) === JSON.stringify(old.headerCellIds || []);
      });
  }

  function captureTableSource() {
    tablePending = null;
    try {
      const page = currentPage(), region = currentRegion(), record = rasterRecords[Number(page?.id.slice(1))-1];
      const canvas = record && Object.getOwnPropertyDescriptor(record,'canvas')?.value;
      if (!page || region?.type !== 'table' || !canvas || canvas !== sourceCanvas(page.id) || canvas.isConnected !== true ||
          canvas.tagName !== 'CANVAS' || canvas.width !== Object.getOwnPropertyDescriptor(record,'width')?.value ||
          canvas.height !== Object.getOwnPropertyDescriptor(record,'height')?.value || !tableEditorMatches(region.table)) {
        status.textContent = 'Save current table edits and use its original connected source canvas before capture.'; return;
      }
      const result = captureNativeTableSource({record,pageId:page.id,region});
      if (result.status !== 'draft') { status.textContent = 'Native table source held: '+result.reason; return; }
      tablePending = {generation:sourceGeneration,regionId:region.id,record,canvas,source:result.source};
      renderTableSourceFields();
    } catch { status.textContent = 'Native table source held. Save and capture the current source again.'; }
  }

  function renderTableSourceFields() {
    const region = currentRegion(), pending = tablePending?.generation === sourceGeneration && tablePending.regionId === region?.id ? tablePending : null;
    const container = host.querySelector('#structure-table-source-assignments'), checked = host.querySelector('#structure-table-source-checked');
    const source = pending?.source || region?.table?.sourceReview?.source;
    host.querySelector('#structure-table-source-inventory').textContent = source ? JSON.stringify({fragments:source.fragments,sourceBox:source.sourceBox,visibility:'unverified',sourceReviewed:false},null,2) : 'Native source association unknown. Save table edits, then capture the current selectable fragments.';
    container.replaceChildren(); checked.checked = false;
    host.querySelector('#structure-table-source-apply').disabled = !pending;
    if (!pending || !region?.table) return;
    if (region.table.cells.length * source.fragments.length > 8192) {
      host.querySelector('#structure-table-source-apply').disabled = true;
      status.textContent = 'Native cell choices exceed the supported bound; associations remain unassigned.'; return;
    }
    for (const cell of region.table.cells) {
      const row = document.createElement('fieldset'); row.dataset.sourceCell = cell.id;
      const legend = document.createElement('legend'); legend.textContent = `Cell ${cell.id} · ${cell.text.slice(0,80)}`; row.append(legend);
      const label = document.createElement('label'); label.textContent = 'Original selectable fragments, in their recorded order';
      const select = document.createElement('select'); select.multiple = true; select.size = 3; select.dataset.field = 'fragments';
      for (const fragment of source.fragments) {
        const option = document.createElement('option'); option.value = fragment.id; option.selected = false;
        option.textContent = `${fragment.id} · ${fragment.text.slice(0,60)} · ${fragment.box.x}, ${fragment.box.y}`; select.append(option);
      }
      select.addEventListener('change', () => { checked.checked = false; }); label.append(select); row.append(label);
      const joinLabel = document.createElement('label'); joinLabel.textContent = 'Separator between original fragments';
      const joiner = document.createElement('select'); joiner.dataset.field = 'joiner';
      for (const [value,text] of [['','No separator'],[' ','Space'],['\n','Line break']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; joiner.append(option);
      }
      joiner.addEventListener('change', () => { checked.checked = false; }); joinLabel.append(joiner); row.append(joinLabel); container.append(row);
    }
  }

  function applyTableSourceReview() {
    try {
      const page = currentPage(), region = currentRegion(), record = rasterRecords[Number(page?.id.slice(1))-1], pending = tablePending;
      const canvas = record && Object.getOwnPropertyDescriptor(record,'canvas')?.value;
      if (!host.querySelector('#structure-table-source-checked').checked || !pending || !page || region?.type !== 'table' ||
          pending.generation !== sourceGeneration || pending.regionId !== region.id || pending.record !== record || pending.canvas !== canvas ||
          !canvas || canvas !== sourceCanvas(page.id) || canvas.isConnected !== true || canvas.tagName !== 'CANVAS' ||
          canvas.width !== Object.getOwnPropertyDescriptor(record,'width')?.value || canvas.height !== Object.getOwnPropertyDescriptor(record,'height')?.value || !tableEditorMatches(region.table)) {
        status.textContent = 'Save, capture and explicitly compare the current native cell sources again.'; return;
      }
      const fresh = captureNativeTableSource({record,pageId:page.id,region});
      const same = (a,b) => Object.is(a,b) || (a && b && typeof a === 'object' && typeof b === 'object' &&
        Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b,key) && same(a[key],b[key])));
      if (fresh.status !== 'draft' || !same(fresh.source,pending.source)) { status.textContent = 'Native inventory changed. Capture and compare the current source again.'; return; }
      const assignments = [...host.querySelector('#structure-table-source-assignments').querySelectorAll('fieldset')].map(row => ({
        cellId:row.dataset.sourceCell,fragmentIds:[...row.querySelector('[data-field="fragments"]').selectedOptions].map(option => option.value),joiner:row.querySelector('[data-field="joiner"]').value}));
      const result = bindNativeTableCells(fresh.source,region.table,assignments);
      if (!result.ok) { status.textContent = 'Cell-source association held: '+result.reason; return; }
      edit({kind:'set-table-source',pageId:page.id,regionId:region.id,review:result.review,sourceChecked:true});
    } catch { status.textContent = 'Cell-source association held. Save, capture and compare the source again.'; }
  }

  function mathSourceCanvas(page, record) {
    if (!page || !record) return null;
    const canvas = Object.getOwnPropertyDescriptor(record,'canvas')?.value;
    return canvas && canvas === sourceCanvas(page.id) && canvas.isConnected === true && canvas.tagName === 'CANVAS' &&
      canvas.width === Object.getOwnPropertyDescriptor(record,'width')?.value &&
      canvas.height === Object.getOwnPropertyDescriptor(record,'height')?.value ? canvas : null;
  }

  function captureMathDraft() {
    mathPending = null; tablePending = null;
    const page = currentPage(), region = currentRegion(), record = rasterRecords[Number(page?.id.slice(1))-1];
    const canvas = mathSourceCanvas(page,record);
    if (!canvas || !region) {
      status.textContent = 'Current original connected canvas is required for native math capture.'; return;
    }
    const result = createNativeMathDraft({record,pageId:page.id,region});
    if (result.status !== 'draft') { status.textContent = 'Native math held: '+result.reason; return; }
    mathPending = {generation:sourceGeneration,regionId:region.id,record,canvas,layout:result.layout,glyphDiagnostic:result.diagnostics?.glyph||null,layoutChecked:false};
    renderMathFields();
  }

  function renderMathFields() {
    const region = currentRegion();
    const pending = mathPending?.generation === sourceGeneration && mathPending.regionId === region?.id ? mathPending : null;
    const layout = pending?.layout || region?.equationReview?.layout || null;
    host.querySelector('#structure-math-inventory').textContent = layout ? JSON.stringify({tokens:layout.tokens,bars:layout.bars,glyphStatus:layout.glyphStatus,barStatus:layout.barStatus,glyphDiagnostic:pending?.glyphDiagnostic||null},null,2) : 'Native positions unknown. Capture the current source before declaring relationships.';
    host.querySelector('#structure-math-relations').value = JSON.stringify(layout?.relations || [],null,2);
    host.querySelector('#structure-math-checked').checked = false;
    if (pending?.glyphDiagnostic?.fontProfile === 'system-css-measured-unverified') status.textContent = 'System font substitution: Canvas positions only; original font ink and selected OS face are unknown/unverified. Compare the original manually.';
  }

  function applyMathReview() {
    const page = currentPage(), region = currentRegion();
    if (!page || !region) return;
    const transcription = host.querySelector('#structure-equation-text').value;
    const sourceChecked = host.querySelector('#structure-equation-checked').checked;
    if (!mathPending && !region.equationReview?.layout) {
      edit({kind:'set-equation',pageId:page.id,regionId:region.id,transcription,sourceChecked});return;
    }
    const record = rasterRecords[Number(page.id.slice(1))-1], canvas = mathSourceCanvas(page,record);
    if (!mathPending || mathPending.generation !== sourceGeneration || mathPending.regionId !== region.id ||
        mathPending.record !== record || !canvas || mathPending.canvas !== canvas ||
        transcription !== mathPending.layout.literal) {
      status.textContent = 'Math source or transcription changed. Save literal corrections, then capture and review the current source again.';return;
    }
    const current = createNativeMathDraft({record,pageId:page.id,region});
    if (current.status !== 'draft' || JSON.stringify({...current.layout,relations:[]}) !== JSON.stringify({...mathPending.layout,relations:[]})) {
      status.textContent = 'Native source inventory changed. Capture and review the current source again.';return;
    }
    const parsed = parseNativeMathJson(host.querySelector('#structure-math-relations').value);
    if (!parsed.ok) { status.textContent = 'Relationship JSON held: '+parsed.reason;return; }
    const layout = {...mathPending.layout,relations:parsed.value};
    const checked = validateNativeMathLayout(layout,{fragmentIds:region.fragmentIds,text:transcription,box:region.box});
    if (!checked.ok) { status.textContent = 'Math relationship held: '+checked.reason;return; }
    edit({kind:'set-equation',pageId:page.id,regionId:region.id,transcription,sourceChecked,
      layout:checked.layout,layoutChecked:host.querySelector('#structure-math-checked').checked});
  }

  function renderSpecialized(page, region) {
    const type = region?.type;
    specialized.hidden = !['table', 'equation', 'figure', 'caption', 'footnote'].includes(type);
    tableEditor.hidden = type !== 'table';
    equationEditor.hidden = type !== 'equation';
    figureEditor.hidden = type !== 'figure';
    captionEditor.hidden = type !== 'caption';
    footnoteEditor.hidden = type !== 'footnote';
    if (specialized.hidden) return;
    if (type === 'table') {
      const table = region.table || { rowCount: 1, columnCount: 1, cells: [] };
      const proposalNote = host.querySelector('#structure-table-proposal-note');
      if (proposalNote) proposalNote.hidden = !table.cells.some(cell => cell.sourceFragmentIds?.length);
      host.querySelector('#structure-table-rows').value = String(table.rowCount);
      host.querySelector('#structure-table-columns').value = String(table.columnCount);
      host.querySelector('#structure-table-checked').checked = Boolean(table.reviewed);
      renderTableCells(table);
      renderTableSourceFields();
    }
    if (type === 'equation') {
      host.querySelector('#structure-equation-text').value = region.text;
      host.querySelector('#structure-equation-checked').checked = Boolean(region.equationReview?.sourceChecked);
      renderMathFields();
    }
    if (type === 'figure') {
      host.querySelector('#structure-figure-decision').value = region.figureReview?.decision || '';
      host.querySelector('#structure-figure-labels').value = (region.figureReview?.labels || []).map(label => label.text).join('\n');
      host.querySelector('#structure-figure-checked').checked = Boolean(region.figureReview?.sourceChecked);
    }
    if (type === 'caption') {
      const target = host.querySelector('#structure-caption-target');
      const choose = document.createElement('option');
      choose.value = '';
      choose.textContent = 'Choose the source table or figure';
      target.replaceChildren(choose, ...graph.pages.flatMap(sourcePage => sourcePage.regions
        .filter(candidate => ['figure', 'table'].includes(candidate.type)).map(candidate => {
        const option = document.createElement('option');
        option.value = candidate.id;
        option.textContent = `${sourcePage.id} · ${candidate.id} · ${candidate.text.slice(0, 60) || candidate.type}`;
        return option;
      })));
      const existing = page.edges.find(edge => edge.type === 'caption-of' && edge.from === region.id);
      if (existing && [...target.options].some(option => option.value === existing.to)) target.value = existing.to;
      host.querySelector('#structure-caption-link').disabled = !target.value;
      host.querySelector('#structure-caption-verify').disabled = !existing || existing.to !== target.value;
    }
    if (type === 'footnote') {
      const links = page.edges.filter(edge => edge.type === 'footnote-of' && edge.from === region.id);
      const decision = host.querySelector('#structure-footnote-decision');
      decision.value = region.footnoteReview?.decision || '';
      host.querySelector('#structure-footnote-checked').checked = region.footnoteReview?.sourceChecked === true;
      host.querySelector('#structure-footnote-reason').value = region.footnoteReview?.standaloneReason || '';
      const targets = host.querySelector('#structure-footnote-targets');
      targets.replaceChildren(...graph.pages.flatMap(sourcePage => sourcePage.regions
        .filter(candidate => candidate.id !== region.id && candidate.type !== 'footnote').map(candidate => {
        const option = document.createElement('option');
        option.value = candidate.id;
        option.textContent = `${sourcePage.id} · ${candidate.type} · ${candidate.status} · ${candidate.text.slice(0, 60)}`;
        option.selected = links.some(edge => footnoteEdgeTarget(edge) === candidate.id);
        return option;
      })));
      const cellOptions = footnoteCellOptions(graph, region.id);
      for (const choice of cellOptions.options) {
        const option = document.createElement('option'); option.value = choice.value; option.textContent = choice.label;
        option.selected = links.some(edge => footnoteEdgeTarget(edge) === choice.value); targets.append(option);
      }
      if (cellOptions.held) { const option = document.createElement('option'); option.disabled = true; option.textContent = 'Cell choices held: current source tables exceed the supported editor bound.'; targets.append(option); }
      targets.disabled = decision.value === 'standalone';
      host.querySelector('#structure-footnote-verify').disabled = region.footnoteReview?.sourceChecked !== true ||
        decision.value !== 'linked' || !links.length || links.some(edge => { const ref = parseFootnoteTarget(footnoteEdgeTarget(edge)); return !ref || !isVerifiedFootnoteTarget(graph, region.id, ref.regionId, ref.cellId ?? undefined); });
    }
  }

  function renderOverlay() {
    preview.querySelectorAll('.structure-source-box, .structure-drawing-layer').forEach(node => node.remove());
    for (const page of graph.pages) {
      const frame = preview.querySelector(`[data-structure-page="${page.id}"]`);
      if (!frame) continue;
      const drawing = document.createElement('div');
      drawing.className = 'structure-drawing-layer';
      drawing.style.pointerEvents = newPanel.hidden ? 'none' : 'auto';
      drawing.setAttribute('aria-label', `Draw a missing region on source ${page.id}`);
      drawing.addEventListener('pointerdown', event => {
        if (!newPanel.hidden && event.target === drawing) {
          const bounds = drawing.getBoundingClientRect();
          drawingStart = { pageId: page.id, x: (event.clientX - bounds.left) * page.width / bounds.width,
            y: (event.clientY - bounds.top) * page.height / bounds.height };
          drawing.setPointerCapture(event.pointerId);
        }
      });
      drawing.addEventListener('pointerup', event => {
        if (!drawingStart || drawingStart.pageId !== page.id) return;
        const bounds = drawing.getBoundingClientRect();
        const endX = (event.clientX - bounds.left) * page.width / bounds.width;
        const endY = (event.clientY - bounds.top) * page.height / bounds.height;
        const box = { x: Math.max(0, Math.min(drawingStart.x, endX)), y: Math.max(0, Math.min(drawingStart.y, endY)),
          width: Math.abs(endX - drawingStart.x), height: Math.abs(endY - drawingStart.y) };
        drawingStart = null;
        if (!validBox(box, page)) return;
        activatePage(page.id);
        newBox.value = boxText(box);
        host.querySelector('#structure-page').value = page.id;
        render();
        notifyChange();
        newText.focus();
      });
      frame.append(drawing);
      for (const region of page.regions) {
        if (!validBox(region.box, page)) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `structure-source-box${region.id === selectedId ? ' selected' : ''}`;
        button.dataset.regionId = region.id;
        button.style.left = `${100 * region.box.x / page.width}%`;
        button.style.top = `${100 * region.box.y / page.height}%`;
        button.style.width = `${100 * region.box.width / page.width}%`;
        button.style.height = `${100 * region.box.height / page.height}%`;
        button.setAttribute('aria-label', `${page.id} ${region.type}: ${region.text.slice(0, 100)}; ${region.status}`);
        button.title = `${region.type} · ${region.status} · ${region.text}`;
        button.addEventListener('click', () => select(region.id, page.id));
        frame.append(button);
      }
    }
  }

  function renderVisualConcerns(page) {
    visualConcerns.replaceChildren();
    const concerns = (page?.issues || []).filter(issue => !issue.regionId && VISUAL_PAGE_CONCERNS.includes(issue.code));
    visualConcerns.hidden = !concerns.length;
    for (const issue of concerns) {
      const assessment = page.visualConcernReviews?.[issue.code];
      const row = document.createElement('fieldset');
      row.dataset.concern = issue.code;
      const legend = document.createElement('legend');
      legend.textContent = issue.code === 'raster-content-unassessed' ? 'Images and internal text' :
        issue.code === 'visual-ocr-unverified' ? 'Visual OCR compared with source' : 'Page with no recovered text';
      const hint = document.createElement('p');
      hint.textContent = 'Compare the entire original page. Record every visible region before confirming inventory. This records your review, not automatic recovery.';
      const decisionLabel = document.createElement('label');
      decisionLabel.textContent = 'VISUAL DECISION';
      const decision = document.createElement('select');
      decision.dataset.field = 'decision';
      const recordedOption = document.createElement('option');
      recordedOption.value = 'regions-recorded';
      recordedOption.textContent = 'Visible content recorded in regions';
      decision.append(recordedOption);
      if (issue.code === 'empty-page-unassessed' && !page.regions.length && !page.fragmentIds.length) {
        const blankOption = document.createElement('option');
        blankOption.value = 'no-visible-content';
        blankOption.textContent = 'Original page has no visible content after inspection';
        decision.append(blankOption);
      }
      decision.value = assessment?.decision || 'regions-recorded';
      decisionLabel.append(decision);
      const regionsLabel = document.createElement('label');
      regionsLabel.textContent = 'RECORDED REGIONS · CHOOSE ALL THAT ADDRESS THIS CONCERN';
      const references = document.createElement('select');
      references.multiple = true;
      references.size = Math.max(2, Math.min(5, page.regions.length));
      references.dataset.field = 'regions';
      for (const region of page.regions) {
        const option = document.createElement('option');
        option.value = region.id;
        option.textContent = `${region.type} · ${region.status} · ${region.text.slice(0, 80) || '[no text]'}`;
        option.selected = assessment?.regionIds.includes(region.id) || false;
        references.append(option);
      }
      references.disabled = decision.value === 'no-visible-content';
      decision.addEventListener('change', () => { references.disabled = decision.value === 'no-visible-content'; });
      regionsLabel.append(references);
      const checkedLabel = document.createElement('label');
      const checked = document.createElement('input');
      checked.type = 'checkbox';
      checked.dataset.field = 'source-checked';
      checked.checked = assessment?.sourceChecked === true;
      checkedLabel.append(checked, document.createTextNode(' I compared this concern and its recorded content with the original page.'));
      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = 'Record visual assessment';
      save.addEventListener('click', () => {
        try {
          edit({ kind: 'assess-page-concern', pageId: page.id, code: issue.code,
            assessment: { sourceChecked: checked.checked, decision: decision.value,
              regionIds: decision.value === 'no-visible-content' ? [] : [...references.selectedOptions].map(option => option.value) } });
        } catch (error) { status.textContent = error.message; }
      });
      row.append(legend, hint, decisionLabel, regionsLabel, checkedLabel, save);
      visualConcerns.append(row);
    }
  }

  // Neutral, manually selected source envelopes. No figure/caption/order/approval inference.
  const rasterTouch = (a,b) => a.x <= b.x+b.width && a.x+a.width >= b.x &&
    a.y <= b.y+b.height && a.y+a.height >= b.y;
  function invalidateRaster(pageId) {
    for (const entry of rasterSessions) if (!pageId || entry.pageId === pageId) entry.session.invalidate();
    rasterChosen = null;
  }
  function rasterSource(record,pageId) {
    const frame = preview.querySelector(`[data-structure-page="${pageId}"]`);
    const node = frame?.querySelector('canvas, img');
    return preview.isConnected && frame?.isConnected && node?.isConnected &&
      node === record?.canvas && node?.tagName === 'CANVAS' &&
      node.width === record.width && node.height === record.height && node.width > 0 && node.height > 0 ? node : null;
  }
  function rasterRead() {
    // Read ALL bound sessions, so observed inactive-page mutations also latch.
    let active = null;
    for (const entry of rasterSessions) {
      const result = entry.session.read();
      if (entry.pageId === activePageId) active = {entry,result};
    }
    if (!active || glyphDirty || !newPanel.hidden || pendingSplit || !splitPanel.hidden) return null;
    const {entry,result} = active, page = currentPage();
    if (result.status !== 'drafts' || !page || !rasterSource(entry.record,entry.pageId)) return null;
    // The factory deliberately returns fresh frozen data per read. Retain the FIRST private
    // draft objects, and require byte-identical frozen factory values on every fresh read.
    if (entry.inventory === null) entry.inventory = result;
    if (JSON.stringify(result) !== JSON.stringify(entry.inventory)) return null;
    if (page.regions.some(region => !region.fragmentIds.length &&
        result.drafts.some(draft => rasterTouch(region.box,draft.box)))) return null;
    return {entry,page,inventory:entry.inventory};
  }
  function hideRasterCrop() {
    rasterCropSource = null;
    if (rasterPreview) rasterPreview.hidden = true;
    if (rasterAdd) rasterAdd.disabled = true;
  }
  function rasterHeld() {
    hideRasterCrop();
    if (rasterStatus) {
      rasterStatus.dataset.status = 'unknown'; rasterStatus.dataset.placementCount = 'null';
      rasterStatus.textContent = 'Raster source drafts unavailable. Compare the original page manually; no source review or figure relationship is inferred.';
    }
  }
  function renderRaster() {
    if (!rasterList || !rasterStatus || !rasterPreview || !rasterAdd) return;
    hideRasterCrop(); rasterChosen = null; rasterChoices = []; rasterList.replaceChildren();
    const current = rasterRead();
    if (!current) { rasterHeld(); return; }
    rasterStatus.dataset.status = 'drafts';
    rasterStatus.dataset.placementCount = String(current.inventory.placementCount);
    rasterStatus.textContent = `Raster source envelopes: ${current.inventory.placementCount}. Select a neutral draft to preview; addition requires a separate action. Source review and visible content remain unverified.`;
    rasterChoices = current.inventory.drafts;
    for (const draft of rasterChoices) {
      const button = document.createElement('button'); button.type = 'button';
      button.dataset.rasterDraftId = draft.id;
      button.textContent = `Preview source envelope ${draft.operatorIndex}`;
      button.addEventListener('click', () => {
        hideRasterCrop(); rasterChosen = null;
        const fresh = rasterRead();
        if (!fresh || !fresh.inventory.drafts.includes(draft) || !rasterChoices.includes(draft)) { rasterHeld(); return; }
        const source = rasterSource(fresh.entry.record,fresh.page.id), size = fitSourceCrop(draft.box.width,draft.box.height);
        if (!source || !size) { rasterHeld(); return; }
        try {
          rasterPreview.width = size.width; rasterPreview.height = size.height;
          const context = rasterPreview.getContext('2d');
          if (!context) { rasterHeld(); return; }
          context.drawImage(source,draft.box.x,draft.box.y,draft.box.width,draft.box.height,0,0,size.width,size.height);
          rasterPreview.hidden = false; rasterCropSource = source; rasterChosen = draft;
          rasterStatus.dataset.status = 'drafts'; rasterStatus.dataset.placementCount = String(fresh.inventory.placementCount);
          rasterStatus.textContent = 'Neutral source envelope preview. This does not identify a figure or verify visible content.';
          rasterAdd.disabled = !rasterCandidate(fresh,draft);
        } catch { rasterHeld(); }
      });
      rasterList.append(button);
    }
  }
  function rasterCandidate(current,draft) {
    const {page} = current;
    if (graph.pages.length > 2 || graph.pages.reduce((n,p) => n+p.regions.length,0) >= 256 ||
        graph.pages.reduce((n,p) => n+p.edges.length,0) > 1024 || graph.pages.some(p => p.regions.some(r => r.id === draft.id))) return null;
    const region = {id:draft.id,type:'other',text:'',fragmentIds:[],box:{...draft.box},provenance:'pdf-raster-source-envelope'};
    const candidate = applyStructureEdit(graph,{kind:'add-region',pageId:page.id,region});
    if (JSON.stringify({document:candidate,sourcePages,sourceGeneration}).length > 262144) return null;
    if (sourcePages !== null && createPrivateReviewSnapshot({document:candidate,sourcePages,sourceGeneration}).status !== 'DRAFT') return null;
    return region;
  }
  rasterAdd?.addEventListener('click', () => {
    const draft = rasterChosen, current = rasterRead();
    if (!draft || !current || !current.inventory.drafts.includes(draft) || !rasterChoices.includes(draft) ||
        rasterPreview.hidden || rasterCropSource !== rasterSource(current.entry.record,current.page.id)) { rasterHeld(); return; }
    const region = rasterCandidate(current,draft);
    if (!region) { rasterHeld(); return; }
    hideRasterCrop(); rasterChosen = null;
    edit({kind:'add-region',pageId:current.page.id,region});
  });

  // A live, synchronous view of original source geometry. Never an approval input.
  function glyphCurrent() {
    const page = currentPage();
    const source = page ? preview.querySelector(`[data-structure-page="${page.id}"]`)?.querySelector('canvas, img') : null;
    return { page, selectedId, selectionIds: graph.selectedRegionIds, dirty: glyphDirty,
      sourceCanvas: source && source === glyphCropSource && !sourceCrop.hidden ? source : null };
  }

  function renderGlyphDiagnostic() {
    if (!glyphDiagnostic) return;
    const result = glyphRelay?.read();
    const known = result && result.status !== 'unknown';
    let hint = 'Select one unchanged native region; edited or incomplete source evidence remains unavailable.';
    if (!known) {
      const descriptor = result && typeof result === 'object'
        ? Object.getOwnPropertyDescriptor(result, 'reason') : null;
      const reason = descriptor && 'value' in descriptor ? descriptor.value : null;
      switch (reason) {
        case 'glyph-region-boundary': case 'native-region-boundary':
        case 'rule-region-boundary': case 'omitted-region-source':
          hint = 'Required source geometry lies outside this region or is missing from its source selection. Compare the full source page manually; counts are unavailable for this crop.'; break;
        case 'changed-review-page':
          hint = 'This page has changed since intake. Its previous geometric evidence is unavailable.'; break;
        case 'unsaved-editor':
          hint = 'An editor draft is open or changed. Reload the source or clear it before using this diagnostic again.'; break;
        case 'source-crop-mismatch':
          hint = 'The current source crop is unavailable or does not match the loaded page. Compare the original page manually.'; break;
        case 'unbound-source': case 'unavailable-source': case 'disposed-source':
          hint = 'Complete source-bound glyph evidence is unavailable for this page.'; break;
        case 'no-current-region': case 'select-one-current-region':
          hint = 'Select exactly one unchanged native region on the current page.'; break;
      }
    }
    glyphDiagnostic.dataset.status = known ? result.status : 'unknown';
    glyphDiagnostic.textContent = known
      ? `Glyph/rule geometry · ${result.status.replace('geometric-', '')}. Positions ${result.mappedGlyphPositions}; boxes ${result.paintedGlyphBoxes}; skipped spaces ${result.skippedSpaces}; rules ${result.ruleCount}; pairs ${result.pairDenominator}; crossing ${result.crossingPairs}; touching ${result.touchingPairs}.`
      : `Glyph/rule geometry · unknown. Counts unavailable (null). ${hint}`;
    glyphDiagnostic.append(document.createTextNode(' Geometric diagnostic only; visible ink and source review remain unverified. Compare the original manually.'));
  }
  // Input immediately hides old evidence while edits are still unsaved, including specialized editors.
  // Conservative draft latch: rerendering may preserve unsaved specialized/new-region fields.
  // Reintake or clear is required to release it; routing must never revive a pending draft.
  host.addEventListener('input', event => {
    if (event.target.id === 'structure-page' || regionList.contains(event.target)) return;
    glyphDirty = true; renderGlyphDiagnostic(); renderRaster();
  });
  host.addEventListener('click', event => {
    if (event.target.closest('#structure-add-region, #structure-table-build, #structure-split-text')) {
      glyphDirty = true; renderGlyphDiagnostic(); renderRaster();
    }
  });

  function renderTableProposalDiagnostic() {
    tableProposalDiagnostic.textContent = ''; tableProposalDiagnostic.hidden = true;
    try {
      const page=currentPage(),index=Number(page?.id.slice(1))-1,entry=tableProposalEvidence[index],record=rasterRecords[index];
      const own=(value,key)=>{const d=value&&Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
      const canvas=own(record,'canvas');
      if(!entry||entry.generation!==sourceGeneration||entry.record!==record||entry.proposal.id!==page.id||canvas!==entry.canvas||
        !canvas||canvas!==sourceCanvas(page.id)||canvas.isConnected!==true||canvas.tagName!=='CANVAS'||canvas.width!==own(record,'width')||canvas.height!==own(record,'height')||
        entry.input.width!==own(record,'width')||entry.input.height!==own(record,'height')||entry.input.fragments!==own(record,'fragments')||
        entry.input.hasImages!==Boolean(own(record,'hasImages'))||entry.input.ocrText!==(own(record,'ocrText')||'')||
        ['vectorHints','ruleHints','verticalRuleHints','rasterHints'].some(key=>entry.input[key]!==(own(record,key)||null)))return;
      const report=getTableProposalDiagnostic(entry.proposal,entry.input);if(!report)return;
      tableProposalDiagnostic.textContent='Initial table proposal evidence (not current review): '+JSON.stringify(report);tableProposalDiagnostic.hidden=false;
    } catch { /* Unknown source/evidence remains hidden; raw errors are private. */ }
  }

  function render() {
    renderTableProposalDiagnostic();
    renderTableGrouping();
    const pageSelect = host.querySelector('#structure-page');
    pageSelect.replaceChildren(...graph.pages.map(page => {
      const option = document.createElement('option');
      option.value = page.id;
      option.textContent = `Page ${page.id.slice(1)}`;
      return option;
    }));
    if (!currentPage()) activePageId = graph.pages[0]?.id || null;
    if (activePageId) pageSelect.value = activePageId;
    const page = currentPage();
    const region = currentRegion();
    if (!region) selectedId = null;
    regionList.replaceChildren();
    if (page) for (const id of readingIds(page)) {
      const item = page.regions.find(candidate => candidate.id === id);
      const row = document.createElement('div');
      row.className = 'structure-region-entry';
      const include = document.createElement('input');
      include.type = 'checkbox';
      include.checked = graph.selectedRegionIds.includes(item.id);
      include.setAttribute('aria-label', `Include ${item.id} in verified excerpt`);
      include.addEventListener('change', () => {
        mathPending = null; tablePending = null;
        const selected = new Set(graph.selectedRegionIds);
        if (include.checked) selected.add(item.id); else selected.delete(item.id);
        graph = applyStructureEdit(graph, { kind: 'set-selection', regionIds: [...selected] });
        selectedId = item.id;
        render();
        notifyChange();
      });
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.regionId = item.id;
      button.className = `structure-region-row${item.id === selectedId ? ' selected' : ''}`;
      button.setAttribute('aria-pressed', String(item.id === selectedId));
      button.textContent = `${item.type} · ${item.status} · ${item.text.slice(0, 100) || '[no text]'}`;
      button.addEventListener('click', () => select(item.id, page.id));
      row.append(include, button);
      regionList.append(row);
    }
    order.textContent = page ? page.edges.filter(edge => edge.type === 'reading-next')
      .map(edge => `${edge.from} → ${edge.to} (${edge.status})`).join(' · ') || 'No sequence proposed.' : 'No page loaded.';
    const canEdit = Boolean(region);
    const included = page?.regions.filter(item => graph.selectedRegionIds.includes(item.id)) || [];
    mergeText.disabled = included.length < 2 || !included.every(ordinaryText);
    const mathGroup = host.querySelector('#structure-group-math');
    mathGroup.disabled = !included.length || included.length>16 || !included.every(r=>r.provenance==='pdf-text'&&['paragraph','heading','equation'].includes(r.type));
    const mathCrop = host.querySelector('#structure-math-group-box');
    mathCrop.disabled = mathGroup.disabled;
    if(!mathGroup.disabled){const x=Math.min(...included.map(r=>r.box.x)),y=Math.min(...included.map(r=>r.box.y));mathCrop.value=[x,y,Math.max(...included.map(r=>r.box.x+r.box.width))-x,Math.max(...included.map(r=>r.box.y+r.box.height))-y].join(', ');}else mathCrop.value='';

    splitText.disabled = !ordinaryText(region) || region.fragmentIds.length === 1;
    const readingPosition = readingIds(page).indexOf(selectedId);
    host.querySelector('#structure-move-up').disabled = readingPosition <= 0;
    host.querySelector('#structure-move-down').disabled = readingPosition < 0 || readingPosition >= page.regions.length - 1;
    for (const control of [regionText, regionType, regionBox, regionSave, regionVerify, reason, exclude]) control.disabled = !canEdit;
    regionText.value = region?.text || '';
    regionType.value = region?.type || 'paragraph';
    regionBox.value = region ? [region.box.x,region.box.y,region.box.width,region.box.height].join(', ') : '';
    reason.value = region?.exclusionReason || '';
    renderSourceCrop(page, region);
    renderSpecialized(page, region);
    renderVisualConcerns(page);
    inventory.checked = Boolean(page?.visualInventoryConfirmed);
    inventory.disabled = !page;
    orderChecked.disabled = !page;
    orderVerify.disabled = !page || !orderChecked.checked || (!page.edges.some(edge => edge.type === 'reading-next')&&!tableGroupOrderPending(page));
    const pageResult = page ? validateDocumentStructure(graph, { scope: 'page', pageId: page.id }) : null;
    const excerpt = getVerifiedExcerpt();
    status.textContent = !page ? 'No source structure proposed.' :
      `Proposed structure · ${page.regions.length} regions. ${excerpt ? 'Excerpt review-ready.' : 'Excerpt unresolved.'} ${pageResult.ok ? 'Whole-page complete.' : `Whole-page unresolved (${pageResult.issues.length} checks).`}`;
    issues.replaceChildren();
    if (pageResult) for (const issue of pageResult.issues) {
      const row = document.createElement('li');
      row.textContent = `${issue.code}: ${issue.message}`;
      issues.append(row);
    }
    renderOverlay();
    renderGlyphDiagnostic();
    renderRaster();
  }

  function select(regionId, pageId) {
    mathPending = null; tablePending = null;
    activatePage(pageId);
    pendingSplit = null;
    splitPanel.hidden = true;
    selectedId = regionId;
    graph = applyStructureEdit(graph, { kind: 'set-selection', regionIds: [regionId] });
    render();
    notifyChange();
  }

  host.querySelector('#structure-page').addEventListener('change', event => {
    activatePage(event.target.value);
    selectedId = null;
    graph = applyStructureEdit(graph, { kind: 'set-selection', regionIds: [] });
    render();
    notifyChange();
  });
  orderChecked.addEventListener('change', render);
  orderVerify.addEventListener('click', reviewTableGroupingOrder);
  for (const [selector, delta] of [['#structure-move-up', -1], ['#structure-move-down', 1]]) {
    host.querySelector(selector).addEventListener('click', () => {
      const ids = readingIds(currentPage());
      const from = ids.indexOf(selectedId);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to], ids[from]];
      edit({ kind: 'reorder', pageId: activePageId, regionIds: ids });
    });
  }
  regionSave.addEventListener('click', () => {
    const page = currentPage();
    const box = parseBox(regionBox.value);
    if (!validBox(box, page)) { status.textContent = 'Source box must fit within the rendered page.'; return; }
    edit({ kind: 'update-region', pageId: page.id, regionId: selectedId,
      changes: { text: regionText.value, type: regionType.value, box } });
  });
  mergeText.addEventListener('click', () => {
    const page = currentPage();
    const ids = readingIds(page).filter(id => graph.selectedRegionIds.includes(id));
    const regions = ids.map(id => page.regions.find(region => region.id === id));
    if (regions.length < 2 || !regions.every(ordinaryText)) return;
    const x = Math.min(...regions.map(region => region.box.x));
    const y = Math.min(...regions.map(region => region.box.y));
    const replacement = { id: ids[0], type: 'paragraph', text: regions.map(region => region.text).join('\n'),
      fragmentIds: regions.flatMap(region => region.fragmentIds),
      box: { x, y, width: Math.max(...regions.map(region => region.box.x + region.box.width)) - x,
        height: Math.max(...regions.map(region => region.box.y + region.box.height)) - y } };
    try {
      edit({ kind: 'replace-text-regions', pageId: page.id, regionIds: ids, regions: [replacement] }, replacement.id);
    } catch (error) { status.textContent = error.message; }
  });
  splitText.addEventListener('click', () => {
    const region = currentRegion();
    if (!ordinaryText(region) || region.fragmentIds.length === 1) return;
    const cut = regionText.selectionStart;
    if (regionText.value !== region.text || !region.text.slice(0, cut).trim() || !region.text.slice(cut).trim() ||
        (/[\uD800-\uDBFF]/u.test(region.text[cut - 1] || '') && /[\uDC00-\uDFFF]/u.test(region.text[cut] || ''))) {
      status.textContent = 'Save corrections first, then place the cursor between source text for the two parts.';
      return;
    }
    pendingSplit = { pageId: activePageId, regionId: region.id, first: region.text.slice(0, cut), second: region.text.slice(cut) };
    const box = region.box;
    const horizontal = !region.text.includes('\n') && box.width > 3 * box.height;
    const fraction = cut / region.text.length;
    const firstBox = horizontal ? { ...box, width: box.width * fraction } : { ...box, height: box.height * fraction };
    const secondBox = horizontal ? { ...box, x: box.x + firstBox.width, width: box.width - firstBox.width }
      : { ...box, y: box.y + firstBox.height, height: box.height - firstBox.height };
    const preciseBox = value => [value.x, value.y, value.width, value.height].join(', ');
    host.querySelector('#structure-split-first-box').value = preciseBox(firstBox);
    host.querySelector('#structure-split-second-box').value = preciseBox(secondBox);
    host.querySelector('#structure-split-first-text').value = pendingSplit.first;
    host.querySelector('#structure-split-second-text').value = pendingSplit.second;
    const count = host.querySelector('#structure-split-fragment-count');
    count.min = region.fragmentIds.length ? '1' : '0';
    count.max = String(Math.max(0, region.fragmentIds.length - 1));
    count.value = String(Math.floor(region.fragmentIds.length / 2));
    count.disabled = !region.fragmentIds.length;
    splitPanel.hidden = false;
  });
  host.querySelector('#structure-split-apply').addEventListener('click', () => {
    const region = currentRegion();
    if (!pendingSplit || pendingSplit.pageId !== activePageId || pendingSplit.regionId !== region?.id) return;
    const count = Number(host.querySelector('#structure-split-fragment-count').value);
    if (!Number.isInteger(count) || (region.fragmentIds.length ? count < 1 || count >= region.fragmentIds.length : count !== 0)) {
      status.textContent = 'Choose a source-fragment boundary leaving native fragments in both parts.';
      return;
    }
    let secondId = `${region.id}-part2`;
    for (let suffix = 1; graph.pages.some(page => page.regions.some(item => item.id === secondId)); suffix++)
      secondId = `${region.id}-part2-${suffix}`;
    const regions = [
      { id: region.id, type: region.type, text: pendingSplit.first, fragmentIds: region.fragmentIds.slice(0, count),
        box: parseBox(host.querySelector('#structure-split-first-box').value) },
      { id: secondId, type: region.type, text: pendingSplit.second, fragmentIds: region.fragmentIds.slice(count),
        box: parseBox(host.querySelector('#structure-split-second-box').value) }
    ];
    try { edit({ kind: 'replace-text-regions', pageId: activePageId, regionIds: [region.id], regions }); }
    catch (error) { status.textContent = error.message; }
  });
  regionVerify.addEventListener('click', () => {
    const region = currentRegion();
    if (!region || (region.type !== 'figure' && !region.text.trim()) || !validBox(region.box, currentPage())) {
      status.textContent = 'Correct the source text and box before verification.';
      return;
    }
    const candidate = applyStructureEdit(graph, { kind: 'update-region', pageId: activePageId, regionId: selectedId,
      changes: { status: 'verified' } });
    const cellNote = region.type === 'footnote' && currentPage().edges.some(edge =>
      edge.type === 'footnote-of' && edge.from === region.id && parseFootnoteTarget(footnoteEdgeTarget(edge))?.cellId != null);
    // Cell-note verification uses the reviewer's actual selected source context.
    // It never adds an unselected table or waives the excerpt parent guard.
    const verificationIds = cellNote ? [...new Set([...(graph.selectedRegionIds || []), selectedId])] : [selectedId];
    const validation = validateDocumentStructure(candidate, { scope: 'excerpt', selectedRegionIds: verificationIds });
    if (!validation.ok) {
      status.textContent = `Region cannot be verified: ${validation.issues.map(issue => issue.message).join(' ')}`;
      return;
    }
    edit({ kind: 'update-region', pageId: activePageId, regionId: selectedId,
      changes: { status: 'verified' } });
  });
  for (const eventName of ['input','change']) tableEditor.addEventListener(eventName, event => {
    if (event.target.closest('.structure-table-cell') ||
        ['structure-table-rows','structure-table-columns'].includes(event.target.id))
      { host.querySelector('#structure-table-checked').checked = false;
        tablePending = null; host.querySelector('#structure-table-source-checked').checked = false;
        host.querySelector('#structure-table-source-apply').disabled = true; }
  });
  host.querySelector('#structure-table-build').addEventListener('click', () => {
    tablePending = null; host.querySelector('#structure-table-source-checked').checked = false; host.querySelector('#structure-table-source-apply').disabled = true;
    const rows = Number(host.querySelector('#structure-table-rows').value);
    const columns = Number(host.querySelector('#structure-table-columns').value);
    if (!validTableDimensions(rows, columns)) {
      status.textContent = `Table grid must have 1–${MAX_TABLE_DIMENSION} rows and columns.`;
      return;
    }
    renderTableCells({ rowCount:rows, columnCount:columns, cells: Array.from({ length: rows * columns }, (_, index) => ({
      id: `c${Math.floor(index / columns) + 1}-${index % columns + 1}`,
      row: Math.floor(index / columns), column: index % columns, rowSpan: 1, colSpan: 1,
      text: '', role: 'value', headerCellIds: []
    })) });
    host.querySelector('#structure-table-checked').checked = false;
  });
  host.querySelector('#structure-table-apply').addEventListener('click', () => {
    const rows = Number(host.querySelector('#structure-table-rows').value);
    const columns = Number(host.querySelector('#structure-table-columns').value);
    if (!validTableDimensions(rows, columns)) {
      status.textContent = `Table grid must have 1–${MAX_TABLE_DIMENSION} rows and columns.`;
      return;
    }
    const table = readTableEditor();
    if (table.cells.some(cell => ![cell.row,cell.column,cell.rowSpan,cell.colSpan].every(Number.isInteger) ||
        cell.row < 0 || cell.column < 0 || cell.rowSpan < 1 || cell.colSpan < 1 ||
        cell.row + cell.rowSpan > rows || cell.column + cell.colSpan > columns)) {
      status.textContent = 'Cell rows and columns must be whole numbers inside the grid, with spans that fit.';
      return;
    }
    edit({ kind: 'set-cells', pageId: activePageId, regionId: selectedId, table });
  });
  host.querySelector('#structure-table-group-capture').addEventListener('click', captureTableGrouping);
  host.querySelector('#structure-table-group-apply').addEventListener('click', applyTableGrouping);
  host.querySelector('#structure-table-group-box').addEventListener('input', () => {
    tableGrouping.invalidatePending();renderTableGrouping();
  });
  host.querySelector('#structure-table-source-capture').addEventListener('click', captureTableSource);
  host.querySelector('#structure-table-source-apply').addEventListener('click', applyTableSourceReview);
  host.querySelector('#structure-equation-apply').addEventListener('click', applyMathReview);
  host.querySelector('#structure-math-capture').addEventListener('click', captureMathDraft);
  for (const selector of ['#structure-equation-text','#structure-math-relations'])
    host.querySelector(selector).addEventListener('input', () => {host.querySelector('#structure-math-checked').checked=false;host.querySelector('#structure-equation-checked').checked=false;});
  host.querySelector('#structure-group-math').addEventListener('click', () => {
    const page=currentPage();if(!page)return;
    const ids=readingIds(page).filter(id=>graph.selectedRegionIds.includes(id));
    const box=parseBox(host.querySelector('#structure-math-group-box').value);
    const id=`${page.id}-math-${crypto.randomUUID()}`;
    try {edit({kind:'group-equation',pageId:page.id,regionIds:ids,newRegionId:id,box},id);}catch(error){status.textContent=error.message;}
  });
  host.querySelector('#structure-figure-apply').addEventListener('click', () => {
    const labels = host.querySelector('#structure-figure-labels').value.split('\n').map(value => value.trim())
      .filter(Boolean).map((text, index) => ({ id: `${selectedId}-label-${index + 1}`, text }));
    edit({ kind: 'set-figure-labels', pageId: activePageId, regionId: selectedId,
      decision: host.querySelector('#structure-figure-decision').value, labels,
      sourceChecked: host.querySelector('#structure-figure-checked').checked });
  });
  host.querySelector('#structure-caption-target').addEventListener('change', () => {
    const targetId = host.querySelector('#structure-caption-target').value;
    const edge = currentPage()?.edges.find(item => item.type === 'caption-of' && item.from === selectedId);
    host.querySelector('#structure-caption-link').disabled = !targetId;
    host.querySelector('#structure-caption-verify').disabled = !edge || edge.to !== targetId;
  });
  host.querySelector('#structure-caption-link').addEventListener('click', () => {
    const targetId = host.querySelector('#structure-caption-target').value;
    if (targetId) edit({ kind: 'set-caption-link', pageId: activePageId, captionId: selectedId, targetId });
  });
  host.querySelector('#structure-footnote-decision').addEventListener('change', event => {
    host.querySelector('#structure-footnote-targets').disabled = event.target.value === 'standalone';
  });
  for (const selector of ['#structure-footnote-decision', '#structure-footnote-targets', '#structure-footnote-reason'])
    host.querySelector(selector).addEventListener('change', () => {
      host.querySelector('#structure-footnote-checked').checked = false;
      host.querySelector('#structure-footnote-verify').disabled = true;
    });
  host.querySelector('#structure-footnote-apply').addEventListener('click', () => {
    const decision = host.querySelector('#structure-footnote-decision').value;
    try {
      edit({ kind: 'set-footnote-review', pageId: activePageId, regionId: selectedId, decision,
        sourceChecked: host.querySelector('#structure-footnote-checked').checked,
        standaloneReason: host.querySelector('#structure-footnote-reason').value,
        targetRegionIds: decision === 'standalone' ? [] : [...host.querySelector('#structure-footnote-targets').selectedOptions].map(option => option.value) });
    } catch (error) { status.textContent = error.message; }
  });
  host.querySelector('#structure-footnote-verify').addEventListener('click', () => {
    const region = currentRegion();
    const page = currentPage();
    const links = page?.edges.filter(edge => edge.type === 'footnote-of' && edge.from === region?.id) || [];
    if (region?.footnoteReview?.sourceChecked !== true || region.footnoteReview.decision !== 'linked' || !links.length ||
        links.some(edge => { const ref = parseFootnoteTarget(footnoteEdgeTarget(edge)); return !ref || !isVerifiedFootnoteTarget(graph, region.id, ref.regionId, ref.cellId ?? undefined); })) {
      status.textContent = 'Compare the note and verify every target source region before its links.';
      return;
    }
    const before = structuralState();
    for (const edge of links) graph = applyStructureEdit(graph, { kind: 'update-edge', pageId: page.id, edgeId: edge.id, changes: { status: 'verified' } });
    glyphRelay?.invalidate(page.id);
    invalidateRaster(page.id);
    recordStructuralChange(before,'verify-footnote-links');
    render();
    notifyChange();
  });
  host.querySelector('#structure-caption-verify').addEventListener('click', () => {
    const target = host.querySelector('#structure-caption-target').value;
    const edge = currentPage().edges.find(item => item.type === 'caption-of' && item.from === selectedId);
    if (!edge || edge.to !== target) { status.textContent = 'Propose the selected table or figure link before verification.'; return; }
    const source = sourceRegion(graph, target);
    if (!source || !isVerifiedCaptionTarget(source.region, source.page)) {
      status.textContent = 'Verify the target table cells or figure text against the source before linking the caption.';
      return;
    }
    edit({ kind: 'update-edge', pageId: activePageId, edgeId: edge.id, changes: { status: 'verified' } });
  });
  exclude.addEventListener('click', () => {
    if (!reason.value.trim()) { status.textContent = 'Enter a visible exclusion reason first.'; return; }
    edit({ kind: 'update-region', pageId: activePageId, regionId: selectedId,
      changes: { status: 'excluded', exclusionReason: reason.value.trim() } });
  });
  inventory.addEventListener('change', () => edit({ kind: 'set-page-inventory', pageId: activePageId, confirmed: inventory.checked }));
  host.querySelector('#structure-add-region').addEventListener('click', () => {
    newPanel.hidden = false;
    renderOverlay();
    newText.focus();
  });
  host.querySelector('#structure-new-save').addEventListener('click', () => {
    const page = currentPage();
    const box = parseBox(newBox.value);
    if (!validBox(box, page) || !newText.value.trim()) {
      status.textContent = 'Enter a transcription and source box within the page.';
      return;
    }
    const id = `${page.id}-manual-${crypto.randomUUID()}`;
    edit({ kind: 'add-region', pageId: page.id, region: { id, type: 'other', box, fragmentIds: [],
      text: newText.value.trim(), provenance: 'manual-visual-transcription', status: 'proposed', exclusionReason: '' } });
    select(id, page.id);
    newPanel.hidden = true;
    newText.value = '';
    newBox.value = '';
  });

  return {
    setPages(records, declaredSourcePages = null) {
      tableGrouping.reset();
      mathPending = null; tablePending = null;
      const inputs=records.map((record,pageIndex)=>({pageIndex,width:record.width,height:record.height,fragments:record.fragments||[],
        hasImages:Boolean(record.hasImages),ocrText:record.ocrText||'',vectorHints:record.vectorHints||null,
        ruleHints:record.ruleHints||null,verticalRuleHints:record.verticalRuleHints||null,rasterHints:record.rasterHints||null,regionalRasterHints:record.regionalRasterHints||null,compoundFigureHints:record.compoundFigureHints||null,rasterFigureHints:record.rasterFigureHints||null}));
      const proposals=inputs.map(input=>proposePageStructure(input));
      const nextGraph = createDocumentStructure(proposals);
      // Validate/copy every declared page before replacing any live review state.
      const nextSources = declaredSourcePages === null ? null : capturePrivateSourcePages(declaredSourcePages,nextGraph.pages);
      if (!Number.isSafeInteger(sourceGeneration+1)) throw new RangeError('Source generation limit');
      const nextGlyphRelay = createGlyphReviewRelay({records, pages: nextGraph.pages, getCurrent: glyphCurrent});
      const nextRecords = records.slice();
      const nextRasterSessions = (nextGraph.pages.length <= 2 ? nextGraph.pages : []).map((page,index) => ({pageId:page.id,record:nextRecords[index],inventory:null,
        session:createRasterSourceDraftSession({record:nextRecords[index],pageId:page.id,sourceGeneration:sourceGeneration+1,
          getCurrent:() => ({record:rasterRecords[index],pageId:activePageId,sourceGeneration})})}));
      glyphRelay?.dispose();
      for (const entry of rasterSessions) entry.session.dispose();
      rasterRecords = nextRecords; rasterSessions = nextRasterSessions;
      rasterChosen = null; rasterChoices = []; hideRasterCrop();
      glyphRelay = nextGlyphRelay;
      glyphDirty = false;
      pendingSplit = null;
      splitPanel.hidden = true;
      tableProposalEvidence=records.map((record,index)=>({generation:sourceGeneration+1,record,canvas:Object.getOwnPropertyDescriptor(record,'canvas')?.value,input:inputs[index],proposal:proposals[index]}));
      graph = nextGraph;
      sourcePages = nextSources;
      sourceGeneration++;
      interactionJournal.reset(sourcePages === null ? null : sourceGeneration);
      activePageId = graph.pages[0]?.id || null;
      selectedId = null;
      orderChecked.checked = false;
      host.hidden = !graph.pages.length;
      newPanel.hidden = true;
      render();
      notifyChange();
    },
    clear() {
      tableGrouping.reset();
      mathPending = null; tablePending = null;
      if (!Number.isSafeInteger(sourceGeneration+1)) throw new RangeError('Source generation limit');
      pendingSplit = null;
      splitPanel.hidden = true;
      glyphRelay?.dispose();
      glyphRelay = null;
      for (const entry of rasterSessions) entry.session.dispose();
      rasterRecords = []; rasterSessions = []; rasterChoices = []; rasterChosen = null; hideRasterCrop();
      glyphDirty = false;
      tableProposalEvidence=[];
      graph = createDocumentStructure([]);
      sourcePages = null;
      sourceGeneration++;
      interactionJournal.reset(null);
      activePageId = null;
      selectedId = null;
      orderChecked.checked = false;
      host.hidden = true;
      render();
      notifyChange();
    },
    renderOverlay,
    getDocument: () => structuredClone(graph),
    getReviewSnapshot: () => {
      const result = createPrivateReviewSnapshot({document:graph,sourcePages,sourceGeneration});
      if (result.status === 'DRAFT') result.interactionJournal = interactionJournal.snapshot();
      return result;
    },
    getVerifiedExcerpt,
    applyReadingOrderFromLines(pageId, lines) {
      const page = graph.pages.find(item => item.id === pageId);
      if (!page) return;
      const ordered = [];
      for (const line of lines) for (const index of line.fragmentIds || []) {
        const owner = page.regions.find(region => region.fragmentIds.includes(`${pageId}-f${index}`));
        if (owner && !ordered.includes(owner.id)) ordered.push(owner.id);
      }
      for (const id of readingIds(page)) if (!ordered.includes(id)) ordered.push(id);
      edit({ kind: 'reorder', pageId, regionIds: ordered },selectedId,'programmatic-order-preview');
    }
  };
}
