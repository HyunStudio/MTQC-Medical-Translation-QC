import { scoreStructure } from './structure-scoring.mjs';

const REVIEWED_KINDS = new Set(['fragment-coverage', 'reading-edge', 'table-binding',
  'formula-grouping', 'figure-label', 'caption-link', 'unresolved-zone']);
const nonempty = value => typeof value === 'string' && !!value.trim();

function uniqueIds(values, name) {
  if (!Array.isArray(values)) throw new TypeError(`${name} must be an array`);
  const index = new Map();
  for (const value of values) {
    if (!nonempty(value?.id)) throw new TypeError(`${name}: missing ID`);
    if (index.has(value.id)) throw new RangeError(`${name}: duplicate ID ${value.id}`);
    index.set(value.id, value);
  }
  return index;
}

function canonicalIds(values, name) {
  const index = uniqueIds(values, name);
  const used = new Set();
  for (const value of index.values()) {
    if (!nonempty(value.canonicalId)) throw new TypeError(`${name}: missing canonical ID`);
    if (used.has(value.canonicalId)) throw new RangeError(`${name}: ambiguous canonical ID ${value.canonicalId}`);
    used.add(value.canonicalId);
  }
  return new Map([...index].map(([id, value]) => [id, value.canonicalId]));
}

function bindCanonical(namespace, actualId, canonicalId) {
  if (!nonempty(actualId) || !nonempty(canonicalId)) throw new TypeError('Canonical binding needs two IDs');
  const previous = namespace.actual.get(actualId), owner = namespace.canonical.get(canonicalId);
  if ((previous !== undefined && previous !== canonicalId) || (owner !== undefined && owner !== actualId))
    throw new RangeError('Ambiguous canonical source entity across checklist bindings');
  namespace.actual.set(actualId, canonicalId);
  namespace.canonical.set(canonicalId, actualId);
}

function unambiguousReadingRelations(regions, edges) {
  const next = new Map(), incoming = new Set();
  for (const edge of edges.values()) {
    if (edge.type !== 'reading-next') continue;
    if (!regions.has(edge.from) || !regions.has(edge.to) || next.has(edge.from) || incoming.has(edge.to)) return false;
    next.set(edge.from, edge.to);
    incoming.add(edge.to);
  }
  for (const start of next.keys()) {
    const seen = new Set();
    for (let current = start; current !== undefined; current = next.get(current)) {
      if (seen.has(current)) return false;
      seen.add(current);
    }
  }
  return true;
}

/**
 * Read-only offline projection of an explicitly mapped reviewer artifact.
 * Only checklist IDs/kinds and source identity are read from truth: observed
 * text, coordinates, headers and edges come from the graph. A declaration of
 * review or a matching digest is NOT independent visual verification; callers
 * must establish that authority and lock the actual human truth before replay.
 * This adapter neither certifies export readiness nor repairs source content.
 */
export function projectReviewedObservations({ truth, artifact }) {
  const sameSource = truth && artifact && nonempty(truth.caseId) &&
    Number.isInteger(truth.physicalPage) && truth.physicalPage > 0 &&
    ['sourceSha256', 'pageImageSha256'].every(key => /^[a-f0-9]{64}$/i.test(truth[key] || '')) &&
    ['caseId', 'sourceSha256', 'pageImageSha256', 'physicalPage'].every(key => artifact[key] === truth[key]);
  if (!sameSource) throw new TypeError('Reviewed artifact source identity does not match the checklist');
  const items = uniqueIds(truth.items, 'checklist');
  for (const item of items.values()) if (!REVIEWED_KINDS.has(item.kind))
    throw new TypeError(`Unknown reviewed checklist kind: ${item.kind}`);
  if (artifact.document?.schemaVersion !== 1) throw new TypeError('Reviewed artifact needs graph schema 1');
  const pages = uniqueIds(artifact.document.pages, 'pages');
  const page = pages.get(artifact.pageId);
  if (!page) throw new TypeError('Reviewed artifact page is missing');
  // Global uniqueness prevents an endpoint ID on another page from silently
  // aliasing a selected-page region. Nested cell/label namespaces stay local.
  uniqueIds([...pages.values()].flatMap(value => value.regions), 'document regions');
  uniqueIds([...pages.values()].flatMap(value => value.edges), 'document edges');
  const regions = uniqueIds(page.regions, 'regions');
  const edges = uniqueIds(page.edges, 'edges');
  const bindings = uniqueIds(artifact.bindings, 'bindings');
  const cellMaps = new Map(), regionMaps = new Map();
  const regionNamespace = { actual: new Map(), canonical: new Map() };
  const cellNamespaces = new Map();
  for (const [id, binding] of bindings) {
    if (!items.has(id)) throw new RangeError(`Unknown checklist binding ${id}`);
    if (binding.canonicalCellIds !== undefined)
      cellMaps.set(id, canonicalIds(binding.canonicalCellIds, 'cell mapping'));
    if (binding.canonicalRegionIds !== undefined)
      regionMaps.set(id, canonicalIds(binding.canonicalRegionIds, 'region mapping'));
    for (const [actualId, canonicalId] of regionMaps.get(id) || []) {
      if (!regions.has(actualId)) throw new RangeError('Unknown graph region in canonical mapping');
      bindCanonical(regionNamespace, actualId, canonicalId);
    }
    if (binding.canonicalRegionId !== undefined && regions.has(binding.regionId))
      bindCanonical(regionNamespace, binding.regionId, binding.canonicalRegionId);
    if (cellMaps.has(id)) {
      const cells = uniqueIds(regions.get(binding.regionId)?.table?.cells, 'mapped table cells');
      if (!cellNamespaces.has(binding.regionId))
        cellNamespaces.set(binding.regionId, { actual: new Map(), canonical: new Map() });
      for (const [actualId, canonicalId] of cellMaps.get(id)) {
        if (!cells.has(actualId)) throw new RangeError('Unknown table cell in canonical mapping');
        bindCanonical(cellNamespaces.get(binding.regionId), actualId, canonicalId);
      }
    }
  }
  for (const region of regions.values()) {
    if (region.table?.cells !== undefined) uniqueIds(region.table.cells, 'table cells');
    if (region.figureReview?.labels !== undefined) uniqueIds(region.figureReview.labels, 'figure labels');
  }
  const verified = region => region?.status === 'verified';
  const readingRelationsUnambiguous = unambiguousReadingRelations(regions, edges);
  return [...items.values()].map(item => {
    const binding = bindings.get(item.id);
    const unresolved = reason => ({ id: item.id, status: 'unresolved', reason });
    const observed = value => ({ id: item.id, status: 'verified', value });
    if (!binding) return unresolved('missing-binding');
    if (binding.reviewed !== true) return unresolved('binding-not-reviewed');
    const region = regions.get(binding.regionId);
    const edge = edges.get(binding.edgeId);
    switch (item.kind) {
      case 'fragment-coverage': {
        if (![...regions.values()].every(value => verified(value) && Array.isArray(value.fragmentIds) &&
          value.fragmentIds.every(nonempty))) return unresolved('region-fragments-not-reviewed');
        return observed({ fragmentIds: [...regions.values()].flatMap(value => value.fragmentIds) });
      }
      case 'reading-edge': {
        if (!readingRelationsUnambiguous) return unresolved('reading-relations-ambiguous');
        const from = regions.get(edge?.from), to = regions.get(edge?.to);
        if (edge?.type !== 'reading-next' || edge.status !== 'verified' || !verified(from) || !verified(to) ||
          !nonempty(from.text) || !nonempty(to.text)) return unresolved('reading-edge-not-reviewed');
        if ([from, to].some(endpoint => [...regions.values()].filter(value => value.text === endpoint.text).length !== 1))
          return unresolved('reading-text-ambiguous');
        return observed({ from: from.text, to: to.text });
      }
      case 'table-binding': {
        const table = region?.table;
        const cell = table?.cells?.find(value => value.id === binding.cellId);
        const ids = cellMaps.get(item.id);
        if (!verified(region) || region.type !== 'table' || table?.reviewed !== true || cell?.role !== 'value' ||
          !nonempty(cell.text) || !Number.isInteger(cell.row) || !Number.isInteger(cell.column) ||
          cell.row < 0 || cell.column < 0 || !Array.isArray(cell.headerCellIds) ||
          !ids?.has(cell.id) || !cell.headerCellIds.every(id => ids.has(id) &&
            table.cells.some(value => value.id === id && value.role === 'header')))
          return unresolved('table-cell-or-header-not-mapped');
        return observed({ valueCellId: ids.get(cell.id), headerCellIds: cell.headerCellIds.map(id => ids.get(id)),
          row: cell.row, column: cell.column, text: cell.text });
      }
      case 'figure-label': {
        const review = region?.figureReview;
        const label = review?.labels?.find(value => value.id === binding.labelId);
        if (!verified(region) || region.type !== 'figure' || review?.sourceChecked !== true ||
          review.decision !== 'labels-transcribed' || !nonempty(label?.text) || !nonempty(binding.canonicalRegionId))
          return unresolved('figure-label-not-reviewed');
        return observed({ figureId: binding.canonicalRegionId, text: label.text });
      }
      case 'caption-link': {
        const from = regions.get(edge?.from), to = regions.get(edge?.to);
        const ids = regionMaps.get(item.id);
        if (edge?.type !== 'caption-of' || edge.status !== 'verified' || !verified(from) || !verified(to) ||
          from.type !== 'caption' || to.type !== 'figure' || !ids?.has(from.id) || !ids.has(to.id) ||
          [...edges.values()].filter(value => value.type === 'caption-of' && value.from === from.id).length !== 1)
          return unresolved('caption-target-not-mapped');
        return observed({ captionId: ids.get(from.id), figureId: ids.get(to.id) });
      }
      case 'unresolved-zone': {
        if (!region || !nonempty(binding.canonicalRegionId) || !nonempty(binding.issueCode) ||
          !page.issues?.some(issue => issue.pageId === page.id && issue.regionId === region.id &&
            issue.code === binding.issueCode)) return unresolved('specific-region-issue-missing');
        return observed({ regionId: binding.canonicalRegionId, flagged: true });
      }
      // The runtime stores checked transcription, but no canonical math groups.
      // Do not fabricate grouping observations from expected answers or text.
      case 'formula-grouping': return unresolved('formula-grouping-not-represented');
    }
  });
}

function uniqueAnchor(text, anchor) {
  if (typeof anchor !== 'string' || !anchor.trim()) return -1;
  const normalized = anchor.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const first = text.indexOf(normalized);
  return first >= 0 && text.indexOf(normalized, first + 1) < 0 ? first : -1;
}

function adjacentAnchors(text, from, to) {
  const normalizedText = String(text || '').normalize('NFC').replace(/\s+/gu, ' ');
  const normalizedFrom = String(from || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
  const normalizedTo = String(to || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
  const first = uniqueAnchor(normalizedText, normalizedFrom);
  const second = uniqueAnchor(normalizedText, normalizedTo);
  if (first < 0 || second < first + normalizedFrom.length) return false;
  return /^\s*$/u.test(normalizedText.slice(first + normalizedFrom.length, second));
}

/**
 * Conservative, machine-observable subset of frozen checklist items. A
 * missing observation is scored as a failure; unimplemented table/figure/
 * formula reconstruction never receives synthetic automatic credit.
 * Truth strings locate reading anchors but do not replace candidate content.
 */
export function projectAutomaticObservations({ truth, arm, candidate }) {
  if (!['native', 'flat', 'graph'].includes(arm)) throw new RangeError(`Unknown candidate arm: ${arm}`);
  if (!truth || !Array.isArray(truth.items) || !candidate?.[arm])
    throw new TypeError('Frozen truth and selected candidate arm are required');
  const selected = candidate[arm];
  const fragmentIds = arm === 'native' ? selected.fragmentIds
    : arm === 'flat' ? selected.lines?.flatMap(line => line.fragmentIds.map(index => `p1-f${index}`))
      : selected.regions?.flatMap(region => region.fragmentIds);
  const text = arm === 'graph' ? selected.regions?.map(region => region.text).join('\n') : selected.text;
  const pageRasterWarningCount = truth.items.filter(item => item.kind === 'unresolved-zone' &&
    item.expected?.regionId === 'page').length;
  const observations = [];
  for (const item of truth.items) {
    if (item.kind === 'fragment-coverage' && Array.isArray(fragmentIds))
      observations.push({ id: item.id, status: 'proposed', value: { fragmentIds } });
    else if (item.kind === 'reading-edge' && adjacentAnchors(text, item.expected?.from, item.expected?.to))
      observations.push({ id: item.id, status: 'proposed', value: {
        from: item.expected.from, to: item.expected.to } });
    else if (item.kind === 'unresolved-zone' && arm === 'graph' && pageRasterWarningCount === 1 &&
      item.expected?.regionId === 'page' && item.expected.flagged === true &&
      selected.issues?.some(issue => issue.code === 'raster-content-unassessed'))
      observations.push({ id: item.id, status: 'proposed', value: {
        regionId: item.expected.regionId, flagged: true } });
  }
  return observations;
}

export function scoreCandidateArms({ truth, candidate, reviewedArtifact }) {
  const arms = {};
  let denominators;
  for (const arm of ['native', 'flat', 'graph']) {
    const score = scoreStructure({ truth,
      proposal: projectAutomaticObservations({ truth, arm, candidate }), reviewed: [] });
    denominators = score.denominators;
    arms[arm] = { ...score.automatic, failures: score.failures.automatic };
  }
  const report = { caseId: truth.caseId, denominators, arms };
  if (reviewedArtifact !== undefined) {
    const score = scoreStructure({ truth, proposal: [],
      reviewed: projectReviewedObservations({ truth, artifact: reviewedArtifact }) });
    report.reviewed = { ...score.reviewed, failures: score.failures.reviewed };
  }
  return report;
}

export function aggregateCandidateReports(reports) {
  if (!Array.isArray(reports) || !reports.length)
    throw new TypeError('Candidate reports must be a nonempty array');
  const arms = Object.fromEntries(['native', 'flat', 'graph'].map(name => [name,
    { correct: 0, total: 0, byKind: {}, failures: [] }]));
  const reviewedCount = reports.filter(report => Object.hasOwn(report || {}, 'reviewed')).length;
  if (reviewedCount && reviewedCount !== reports.length)
    throw new TypeError('Partial reviewed corpus: reviewed scores are required for all cases');
  const reviewed = reviewedCount ? { correct: 0, total: 0, byKind: {}, silentErrors: 0, failures: [] } : null;
  const seen = new Set();
  for (const report of reports) {
    if (!report?.caseId || seen.has(report.caseId))
      throw new RangeError(`Duplicate or missing candidate report case: ${report?.caseId}`);
    seen.add(report.caseId);
    const denominators = Object.entries(report.denominators || {});
    if (!denominators.length || denominators.some(([kind, total]) => !REVIEWED_KINDS.has(kind) ||
      !Number.isInteger(total) || total < 1)) throw new TypeError(`${report.caseId}: invalid denominator`);
    const total = denominators.reduce((sum, [, count]) => sum + count, 0);
    for (const [name, summary] of Object.entries(arms)) {
      const source = report.arms?.[name];
      const counts = Object.entries(source?.byKind || {});
      if (!source || !Number.isInteger(source.correct) || !Number.isInteger(source.total) ||
        source.correct < 0 || source.correct > source.total || !source.byKind || !Array.isArray(source.failures) ||
        source.total !== total || counts.length !== denominators.length || counts.some(([kind, count]) =>
          count?.total !== report.denominators[kind] || !Number.isInteger(count.correct) ||
          count.correct < 0 || count.correct > count.total) ||
        counts.reduce((sum, [, count]) => sum + count.correct, 0) !== source.correct)
        throw new TypeError(`${report.caseId}: invalid ${name} candidate score`);
      summary.correct += source.correct;
      summary.total += source.total;
      for (const [kind, count] of Object.entries(source.byKind)) {
        summary.byKind[kind] ??= { correct: 0, total: 0 };
        summary.byKind[kind].correct += count.correct;
        summary.byKind[kind].total += count.total;
      }
      summary.failures.push(...source.failures.map(failure => ({ caseId: report.caseId, ...failure })));
    }
    if (reviewed) {
      const source = report.reviewed;
      const counts = Object.entries(source?.byKind || {});
      const denominatorKinds = Object.keys(report.denominators || {});
      if (!source || !Number.isInteger(source.correct) || !Number.isInteger(source.total) ||
        source.correct < 0 || source.correct > source.total || !Number.isInteger(source.silentErrors) ||
        source.silentErrors < 0 || source.silentErrors > source.total - source.correct ||
        !Array.isArray(source.failures) || source.failures.length !== source.total - source.correct ||
        source.failures.filter(value => value.reason === 'mismatch').length !== source.silentErrors ||
        counts.length !== denominatorKinds.length || counts.some(([kind, count]) =>
          !Number.isInteger(count?.correct) || !Number.isInteger(count?.total) || count.correct < 0 ||
          count.correct > count.total || count.total !== report.denominators[kind]) ||
        counts.reduce((sum, [, count]) => sum + count.total, 0) !== source.total ||
        counts.reduce((sum, [, count]) => sum + count.correct, 0) !== source.correct)
        throw new TypeError(`${report.caseId}: invalid reviewed score or denominator`);
      reviewed.correct += source.correct;
      reviewed.total += source.total;
      reviewed.silentErrors += source.silentErrors;
      for (const [kind, count] of counts) {
        reviewed.byKind[kind] ??= { correct: 0, total: 0 };
        reviewed.byKind[kind].correct += count.correct;
        reviewed.byKind[kind].total += count.total;
      }
      reviewed.failures.push(...source.failures.map(value => ({ caseId: report.caseId, ...value })));
    }
  }
  return { cases: [...seen], arms, ...(reviewed ? { reviewed } : {}) };
}
