import { applyStructureEdit, createDocumentStructure, validateDocumentStructure, validTableDimensions, MAX_TABLE_DIMENSION, VISUAL_PAGE_CONCERNS, isVerifiedCaptionTarget, isVerifiedFootnoteTarget, sourceRegion } from './document-structure.mjs';
import { proposePageStructure } from './document-structure-proposal.mjs';
import { fitSourceCrop } from './document-render-limits.mjs';
import { capturePrivateSourcePages, createPrivateReviewSnapshot } from './document-private-review-snapshot.mjs';
import { createPrivateInteractionJournal } from './document-private-interaction-journal.mjs';

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
  const interactionJournal = createPrivateInteractionJournal();
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

  function activatePage(pageId) {
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
    if (!before) return;
    const pageIds = graph.pages.filter(page => before.get(page.id) !== JSON.stringify(page)).map(page => page.id);
    if (pageIds.length) interactionJournal.record({kind,origin,pageIds});
  }

  function edit(change, nextSelectedId = selectedId, origin = 'review-ui') {
    const before = structuralState();
    graph = applyStructureEdit(graph, change);
    recordStructuralChange(before,change.kind,origin);
    selectedId = nextSelectedId;
    if (['reorder', 'add-region', 'update-region', 'set-cells', 'set-equation', 'set-figure-labels', 'set-footnote-review', 'replace-text-regions'].includes(change.kind)) orderChecked.checked = false;
    pendingSplit = null;
    splitPanel.hidden = true;
    render();
    notifyChange();
  }

  function getVerifiedExcerpt() {
    const selected = graph.selectedRegionIds;
    if (!selected?.length) return null;
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
    return { sourceText, regionIds: ordered.map(item => item.region.id),
      sourceBoxes: ordered.map(({ page, region }) => ({ pageId: page.id, box: structuredClone(region.box) })) };
  }

  function renderSourceCrop(page, region) {
    sourceCrop.hidden = true;
    if (!page || !region || !validBox(region.box, page)) return;
    const frame = preview.querySelector(`[data-structure-page="${page.id}"]`);
    const source = frame?.querySelector('canvas, img');
    if (!source) return;
    const size = fitSourceCrop(region.box.width, region.box.height);
    if (!size) return;
    sourceCrop.width = size.width;
    sourceCrop.height = size.height;
    sourceCrop.getContext('2d').drawImage(source, region.box.x, region.box.y,
      region.box.width, region.box.height, 0, 0, sourceCrop.width, sourceCrop.height);
    sourceCrop.hidden = false;
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
        ['text', 'Text', cell.text || '', 'text'], ['rowSpan', 'Row span', cell.rowSpan, 'number'],
        ['colSpan', 'Column span', cell.colSpan, 'number'],
        ['headerCellIds', 'Header IDs, comma separated', (cell.headerCellIds || []).join(', '), 'text'],
        ['blankReason', 'Blank reason', cell.blankReason || '', 'text']
      ]) {
        const field = document.createElement('label');
        field.textContent = label;
        const input = document.createElement('input');
        input.dataset.field = name;
        input.type = type;
        if (type === 'number') input.min = '1';
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
      remove.addEventListener('click', () => row.remove());
      row.append(remove);
      container.append(row);
    }
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
    renderSourceCrop(page, region);
    if (type === 'table') {
      const table = region.table || { rowCount: 1, columnCount: 1, cells: [] };
      host.querySelector('#structure-table-rows').value = String(table.rowCount);
      host.querySelector('#structure-table-columns').value = String(table.columnCount);
      host.querySelector('#structure-table-checked').checked = Boolean(table.reviewed);
      renderTableCells(table);
    }
    if (type === 'equation') {
      host.querySelector('#structure-equation-text').value = region.text;
      host.querySelector('#structure-equation-checked').checked = Boolean(region.equationReview?.sourceChecked);
    }
    if (type === 'figure') {
      host.querySelector('#structure-figure-decision').value = region.figureReview?.decision || '';
      host.querySelector('#structure-figure-labels').value = (region.figureReview?.labels || []).map(label => label.text).join('\n');
      host.querySelector('#structure-figure-checked').checked = Boolean(region.figureReview?.sourceChecked);
    }
    if (type === 'caption') {
      const target = host.querySelector('#structure-caption-target');
      target.replaceChildren(...graph.pages.flatMap(sourcePage => sourcePage.regions
        .filter(candidate => ['figure', 'table'].includes(candidate.type)).map(candidate => {
        const option = document.createElement('option');
        option.value = candidate.id;
        option.textContent = `${sourcePage.id} · ${candidate.id} · ${candidate.text.slice(0, 60) || candidate.type}`;
        return option;
      })));
      const existing = page.edges.find(edge => edge.type === 'caption-of' && edge.from === region.id);
      if (existing && [...target.options].some(option => option.value === existing.to)) target.value = existing.to;
      host.querySelector('#structure-caption-link').disabled = !target.options.length;
      host.querySelector('#structure-caption-verify').disabled = !existing;
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
        option.selected = links.some(edge => edge.to === candidate.id);
        return option;
      })));
      targets.disabled = decision.value === 'standalone';
      host.querySelector('#structure-footnote-verify').disabled = region.footnoteReview?.sourceChecked !== true ||
        decision.value !== 'linked' || !links.length || links.some(edge => !isVerifiedFootnoteTarget(graph, region.id, edge.to));
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

  function render() {
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
    splitText.disabled = !ordinaryText(region) || region.fragmentIds.length === 1;
    const readingPosition = readingIds(page).indexOf(selectedId);
    host.querySelector('#structure-move-up').disabled = readingPosition <= 0;
    host.querySelector('#structure-move-down').disabled = readingPosition < 0 || readingPosition >= page.regions.length - 1;
    for (const control of [regionText, regionType, regionBox, regionSave, regionVerify, reason, exclude]) control.disabled = !canEdit;
    regionText.value = region?.text || '';
    regionType.value = region?.type || 'paragraph';
    regionBox.value = region ? boxText(region.box) : '';
    reason.value = region?.exclusionReason || '';
    renderSpecialized(page, region);
    renderVisualConcerns(page);
    inventory.checked = Boolean(page?.visualInventoryConfirmed);
    inventory.disabled = !page;
    orderChecked.disabled = !page;
    orderVerify.disabled = !page || !orderChecked.checked || !page.edges.some(edge => edge.type === 'reading-next');
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
  }

  function select(regionId, pageId) {
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
  orderVerify.addEventListener('click', () => {
    if (!orderChecked.checked || !currentPage()) return;
    const before = structuralState();
    for (const edge of currentPage().edges.filter(item => item.type === 'reading-next'))
      graph = applyStructureEdit(graph, { kind: 'update-edge', pageId: activePageId,
        edgeId: edge.id, changes: { status: 'verified' } });
    recordStructuralChange(before,'verify-reading-order');
    render();
    notifyChange();
  });
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
    const validation = validateDocumentStructure(candidate, { scope: 'excerpt', selectedRegionIds: [selectedId] });
    if (!validation.ok) {
      status.textContent = `Region cannot be verified: ${validation.issues.map(issue => issue.message).join(' ')}`;
      return;
    }
    edit({ kind: 'update-region', pageId: activePageId, regionId: selectedId,
      changes: { status: 'verified' } });
  });
  host.querySelector('#structure-table-build').addEventListener('click', () => {
    const rows = Number(host.querySelector('#structure-table-rows').value);
    const columns = Number(host.querySelector('#structure-table-columns').value);
    if (!validTableDimensions(rows, columns)) {
      status.textContent = `Table grid must have 1–${MAX_TABLE_DIMENSION} rows and columns.`;
      return;
    }
    renderTableCells({ cells: Array.from({ length: rows * columns }, (_, index) => ({
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
    const cells = [...host.querySelectorAll('.structure-table-cell')].map(row => {
      const field = name => row.querySelector(`[data-field="${name}"]`).value;
      return { id: row.dataset.cellId,
        row: Number(row.dataset.row), column: Number(row.dataset.column),
        rowSpan: Number(field('rowSpan')), colSpan: Number(field('colSpan')),
        text: field('text'), role: field('role'), blankReason: field('blankReason'),
        headerCellIds: field('headerCellIds').split(',').map(value => value.trim()).filter(Boolean) };
    });
    edit({ kind: 'set-cells', pageId: activePageId, regionId: selectedId,
      table: { rowCount: rows, columnCount: columns, cells,
        reviewed: host.querySelector('#structure-table-checked').checked } });
  });
  host.querySelector('#structure-equation-apply').addEventListener('click', () => edit({
    kind: 'set-equation', pageId: activePageId, regionId: selectedId,
    transcription: host.querySelector('#structure-equation-text').value,
    sourceChecked: host.querySelector('#structure-equation-checked').checked
  }));
  host.querySelector('#structure-figure-apply').addEventListener('click', () => {
    const labels = host.querySelector('#structure-figure-labels').value.split('\n').map(value => value.trim())
      .filter(Boolean).map((text, index) => ({ id: `${selectedId}-label-${index + 1}`, text }));
    edit({ kind: 'set-figure-labels', pageId: activePageId, regionId: selectedId,
      decision: host.querySelector('#structure-figure-decision').value, labels,
      sourceChecked: host.querySelector('#structure-figure-checked').checked });
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
        links.some(edge => !isVerifiedFootnoteTarget(graph, region.id, edge.to))) {
      status.textContent = 'Compare the note and verify every target source region before its links.';
      return;
    }
    const before = structuralState();
    for (const edge of links) graph = applyStructureEdit(graph, { kind: 'update-edge', pageId: page.id, edgeId: edge.id, changes: { status: 'verified' } });
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
      const nextGraph = createDocumentStructure(records.map((record, pageIndex) => proposePageStructure({ pageIndex,
        width: record.width, height: record.height, fragments: record.fragments || [],
        hasImages: Boolean(record.hasImages), ocrText: record.ocrText || '' })));
      // Validate/copy every declared page before replacing any live review state.
      const nextSources = declaredSourcePages === null ? null : capturePrivateSourcePages(declaredSourcePages,nextGraph.pages);
      if (!Number.isSafeInteger(sourceGeneration+1)) throw new RangeError('Source generation limit');
      pendingSplit = null;
      splitPanel.hidden = true;
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
      if (!Number.isSafeInteger(sourceGeneration+1)) throw new RangeError('Source generation limit');
      pendingSplit = null;
      splitPanel.hidden = true;
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
