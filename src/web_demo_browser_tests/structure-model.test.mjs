import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDocumentStructure,
  applyStructureEdit,
  validateDocumentStructure
} from '../web_demo/wwwroot/document-structure.mjs';

function region(id, fragmentId, text, x) {
  return { id, type: 'paragraph', box: { x, y: 20, width: 120, height: 16 },
    fragmentIds: [fragmentId], text, provenance: 'pdf-text', status: 'verified', exclusionReason: '' };
}

function page() {
  return { id: 'p1', width: 600, height: 800, fragmentIds: ['f1', 'f2'],
    regions: [region('r1', 'f1', 'The artery', 20), region('r2', 'f2', 'measures 2 mm.', 20)],
    edges: [{ id: 'e1', type: 'reading-next', from: 'r1', to: 'r2', status: 'verified' }],
    issues: [], visualInventoryConfirmed: true };
}

function documentWith(change = () => {}) {
  const source = page();
  change(source);
  return createDocumentStructure([source]);
}

function codes(result) { return result.issues.map(issue => issue.code); }

const concern = code => ({ code, pageId: 'p1', message: 'Inspect original visual content.' });
const reviewedNote = (source, targetRegionIds = ['r1'], decision = 'linked', standaloneReason = '') =>
  applyStructureEdit(source, { kind: 'set-footnote-review', pageId: 'p1', regionId: 'r2',
    sourceChecked: true, decision, targetRegionIds, standaloneReason });

test('footnote cannot complete a page or excerpt before its association is assessed', () => {
  const source = documentWith(p => { p.regions[1].type = 'footnote'; p.regions[1].text = '* Only subgroup A.'; });
  for (const options of [{ scope: 'page', pageId: 'p1' }, { scope: 'excerpt', selectedRegionIds: ['r2'] }])
    assert(codes(validateDocumentStructure(source, options)).includes('footnote-unassessed'));
});

test('linked footnote requires reviewed target relationships before completion', () => {
  const source = documentWith(p => { p.regions[1].type = 'footnote'; });
  let next = reviewedNote(source);
  assert.equal(next.pages[0].regions[1].status, 'proposed');
  const edge = next.pages[0].edges.find(edge => edge.type === 'footnote-of');
  assert.equal(edge.to, 'r1');
  assert.equal(edge.status, 'proposed');
  next = applyStructureEdit(next, { kind: 'update-region', pageId: 'p1', regionId: 'r2', changes: { status: 'verified' } });
  assert.equal(validateDocumentStructure(next, { scope: 'excerpt', selectedRegionIds: ['r2'] }).ok, false);
  next = applyStructureEdit(next, { kind: 'update-edge', pageId: 'p1', edgeId: edge.id, changes: { status: 'verified' } });
  assert.equal(validateDocumentStructure(next, { scope: 'excerpt', selectedRegionIds: ['r2'] }).ok, true);
  assert.equal(source.pages[0].regions[1].footnoteReview, undefined);
  next.pages[0].regions[0].status = 'unresolved';
  assert(codes(validateDocumentStructure(next, { scope: 'excerpt', selectedRegionIds: ['r2'] })).includes('invalid-footnote-target'));
});

test('a standalone note needs an explicit original-source check and reason', () => {
  const source = documentWith(p => { p.regions[1].type = 'footnote'; });
  let next = reviewedNote(source, [], 'standalone', 'Correspondence details are independent of body measurements.');
  next = applyStructureEdit(next, { kind: 'update-region', pageId: 'p1', regionId: 'r2', changes: { status: 'verified' } });
  assert.equal(validateDocumentStructure(next, { scope: 'excerpt', selectedRegionIds: ['r2'] }).ok, true);
  next.pages[0].regions[1].footnoteReview.standaloneReason = '';
  assert(codes(validateDocumentStructure(next, { scope: 'excerpt', selectedRegionIds: ['r2'] })).includes('footnote-unassessed'));
  next.pages[0].regions[1].footnoteReview.standaloneReason = 'Independent note';
  next.pages[0].regions[1].footnoteReview.sourceChecked = false;
  assert.equal(validateDocumentStructure(next, { scope: 'excerpt', selectedRegionIds: ['r2'] }).ok, false);
});

test('editing note transcription invalidates its source association assessment', () => {
  const source = reviewedNote(documentWith(p => { p.regions[1].type = 'footnote'; }));
  const next = applyStructureEdit(source, { kind: 'update-region', pageId: 'p1', regionId: 'r2',
    changes: { text: '* Applies only to subgroup B.' } });
  assert.equal(next.pages[0].regions[1].footnoteReview.sourceChecked, false);
  assert.equal(next.pages[0].visualInventoryConfirmed, false);
  assert(next.pages[0].edges.filter(edge => edge.from === 'r2' || edge.to === 'r2').every(edge => edge.status === 'proposed'));
  assert.equal(source.pages[0].regions[1].footnoteReview.sourceChecked, true);
});

test('footnote decisions reject absent, self and duplicate targets without changing the graph', () => {
  const source = documentWith(p => { p.regions[1].type = 'footnote'; });
  for (const ids of [[], ['missing'], ['r2'], ['r1', 'r1']])
    assert.throws(() => reviewedNote(source, ids), /target regions|duplicate|self/i);
  assert.equal(source.pages[0].regions[1].status, 'verified');
});
const assess = (source, code, regionIds = ['r1', 'r2'], decision = 'regions-recorded') =>
  applyStructureEdit(source, { kind: 'assess-page-concern', pageId: 'p1', code,
    assessment: { sourceChecked: true, decision, regionIds } });

test('explicit visual concern assessment enables completion only after fresh inventory', () => {
  for (const code of ['raster-content-unassessed', 'empty-page-unassessed', 'visual-ocr-unverified']) {
    const source = documentWith(p => { p.issues = [concern(code)]; });
    assert.equal(validateDocumentStructure(source, { scope: 'page', pageId: 'p1' }).ok, false);
    let next = assess(source, code);
    assert.equal(validateDocumentStructure(next, { scope: 'page', pageId: 'p1' }).ok, false);
    next = applyStructureEdit(next, { kind: 'set-page-inventory', pageId: 'p1', confirmed: true });
    assert.equal(validateDocumentStructure(next, { scope: 'page', pageId: 'p1' }).ok, true);
    assert.equal(source.pages[0].visualConcernReviews, undefined);
  }
});

test('visual concern references must be assessed against recorded verified regions', () => {
  const source = documentWith(p => { p.issues = [concern('raster-content-unassessed')]; });
  for (const assessment of [
    { sourceChecked: false, decision: 'regions-recorded', regionIds: ['r1'] },
    { sourceChecked: true, decision: 'regions-recorded', regionIds: [] },
    { sourceChecked: true, decision: 'regions-recorded', regionIds: ['missing'] },
    { sourceChecked: true, decision: 'regions-recorded', regionIds: ['r1', 'r1'] },
    { sourceChecked: true, decision: 'no-visible-content', regionIds: [] }
  ]) assert.throws(() => applyStructureEdit(source, { kind: 'assess-page-concern', pageId: 'p1',
    code: 'raster-content-unassessed', assessment }), /assessment|recorded|visible/i);
  source.pages[0].regions[0].status = 'unresolved';
  const next = applyStructureEdit(assess(source, 'raster-content-unassessed'),
    { kind: 'set-page-inventory', pageId: 'p1', confirmed: true });
  assert.equal(validateDocumentStructure(next, { scope: 'page', pageId: 'p1' }).ok, false);
  assert(codes(validateDocumentStructure(next, { scope: 'page', pageId: 'p1' })).includes('raster-content-unassessed'));
});

test('an explicitly inspected blank page can complete without inventing a region', () => {
  const source = documentWith(p => { p.regions = []; p.edges = []; p.fragmentIds = [];
    p.issues = [concern('empty-page-unassessed')]; });
  let next = assess(source, 'empty-page-unassessed', [], 'no-visible-content');
  next = applyStructureEdit(next, { kind: 'set-page-inventory', pageId: 'p1', confirmed: true });
  assert.equal(validateDocumentStructure(next, { scope: 'page', pageId: 'p1' }).ok, true);
});

test('source and relationship edits invalidate visual concern assessments', () => {
  const source = assess(documentWith(p => { p.issues = [concern('raster-content-unassessed')]; }), 'raster-content-unassessed');
  for (const edit of [
    { kind: 'update-region', regionId: 'r1', changes: { text: 'Corrected artery' } },
    { kind: 'update-region', regionId: 'r1', changes: { status: 'excluded', exclusionReason: 'scope' } },
    { kind: 'update-edge', edgeId: 'e1', changes: { status: 'verified' } },
    { kind: 'reorder', regionIds: ['r2', 'r1'] },
    { kind: 'add-region', region: { ...region('new', '', 'Figure label', 30), fragmentIds: [] } }
  ]) {
    let next = applyStructureEdit(source, { ...edit, pageId: 'p1' });
    next = applyStructureEdit(next, { kind: 'set-page-inventory', pageId: 'p1', confirmed: true });
    assert(codes(validateDocumentStructure(next, { scope: 'page', pageId: 'p1' })).includes('raster-content-unassessed'));
  }
});

test('visual assessments cannot retire unknown or unplaced source warnings', () => {
  let next = assess(documentWith(p => { p.issues = [concern('raster-content-unassessed'), concern('unplaced-fragment')]; }), 'raster-content-unassessed');
  next = applyStructureEdit(next, { kind: 'set-page-inventory', pageId: 'p1', confirmed: true });
  assert.deepEqual(codes(validateDocumentStructure(next, { scope: 'page', pageId: 'p1' })), ['unplaced-fragment']);
  assert.throws(() => assess(next, 'unplaced-fragment'), /concern/i);
});

test('merging adjacent text preserves fragment ownership and invalidates source review', () => {
  const source = documentWith(p => {
    p.regions.push(region('r3', 'f3', 'Continue.', 20));
    p.fragmentIds.push('f3');
    p.edges.push({ id: 'e2', type: 'reading-next', from: 'r2', to: 'r3', status: 'verified' });
  });
  source.selectedRegionIds = ['r1', 'r2'];
  const next = applyStructureEdit(source, { kind: 'replace-text-regions', pageId: 'p1', regionIds: ['r1', 'r2'],
    regions: [{ ...source.pages[0].regions[0], text: 'The artery\nmeasures 2 mm.', fragmentIds: ['f1', 'f2'] }] });
  assert.equal(next.pages[0].regions.length, 2);
  assert.deepEqual(next.pages[0].regions[0].fragmentIds, ['f1', 'f2']);
  assert.equal(next.pages[0].regions[0].status, 'proposed');
  assert.equal(next.pages[0].visualInventoryConfirmed, false);
  assert.deepEqual(next.selectedRegionIds, ['r1']);
  assert.deepEqual(next.pages[0].edges.map(e => [e.from, e.to, e.status]), [['r1', 'r3', 'proposed']]);
  assert.equal(source.pages[0].regions.length, 3);
  assert(codes(validateDocumentStructure(next, { scope: 'excerpt' })).includes('unresolved-selection'));
});

test('splitting text preserves each source fragment exactly once and proposes its new reading edge', () => {
  const source = documentWith(p => {
    p.regions[0].text = 'The artery measures 2 mm.';
    p.regions[0].fragmentIds = ['f1', 'f2'];
    p.regions = p.regions.slice(0, 1);
    p.edges = [];
  });
  source.selectedRegionIds = ['r1'];
  const parts = [region('r1', 'f1', 'The artery', 20), region('r1-part2', 'f2', 'measures 2 mm.', 20)];
  const next = applyStructureEdit(source, { kind: 'replace-text-regions', pageId: 'p1', regionIds: ['r1'], regions: parts });
  assert.deepEqual(next.pages[0].regions.flatMap(r => r.fragmentIds), ['f1', 'f2']);
  assert(next.pages[0].regions.every(r => r.status === 'proposed'));
  assert.deepEqual(next.pages[0].edges.map(e => [e.from, e.to, e.status]), [['r1', 'r1-part2', 'proposed']]);
  assert.deepEqual(next.selectedRegionIds, ['r1', 'r1-part2']);
});

test('text restructuring refuses missing, duplicated or foreign source fragments', () => {
  const source = documentWith();
  for (const fragmentIds of [['f1'], ['f1', 'f1', 'f2'], ['f1', 'f2', 'foreign']]) {
    assert.throws(() => applyStructureEdit(source, { kind: 'replace-text-regions', pageId: 'p1', regionIds: ['r1', 'r2'],
      regions: [{ ...source.pages[0].regions[0], text: 'The artery measures 2 mm.', fragmentIds }] }), /fragment/i);
  }
});

test('text restructuring refuses silent transcription loss and nonadjacent reading regions', () => {
  const source = documentWith(p => {
    p.regions.push(region('r3', 'f3', 'Continue.', 20));
    p.fragmentIds.push('f3');
    p.edges.push({ id: 'e2', type: 'reading-next', from: 'r2', to: 'r3', status: 'verified' });
  });
  assert.throws(() => applyStructureEdit(source, { kind: 'replace-text-regions', pageId: 'p1', regionIds: ['r1', 'r2'],
    regions: [{ ...source.pages[0].regions[0], text: 'The artery', fragmentIds: ['f1', 'f2'] }] }), /transcription/i);
  assert.throws(() => applyStructureEdit(source, { kind: 'replace-text-regions', pageId: 'p1', regionIds: ['r1', 'r3'],
    regions: [{ ...source.pages[0].regions[0], text: 'The artery Continue.', fragmentIds: ['f1', 'f3'] }] }), /adjacent/i);
});

test('text restructuring cannot discard specialized content or semantic relationships', () => {
  for (const change of [p => { p.regions[0].type = 'equation'; },
    p => { p.edges.push({ id: 'note', type: 'footnote-of', from: 'r2', to: 'r1', status: 'verified' }); }]) {
    const source = documentWith(change);
    assert.throws(() => applyStructureEdit(source, { kind: 'replace-text-regions', pageId: 'p1', regionIds: ['r1', 'r2'],
      regions: [{ ...source.pages[0].regions[0], text: 'The artery measures 2 mm.', fragmentIds: ['f1', 'f2'] }] }), /text regions|relationships/i);
  }
});

test('verified table cells cannot hide unreadable control glyphs behind clean region text', () => {
  const source = documentWith(p => {
    p.regions[0] = { ...p.regions[0], type: 'table', text: 'Dose table', table: {
      rowCount: 1, columnCount: 1, reviewed: true, cells: [
        { id: 'v', row: 0, column: 0, rowSpan: 1, colSpan: 1, role: 'value', text: '10\u0010mg', headerCellIds: [] }
      ]
    } };
  });
  assert.equal(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1'] }).ok, false);
  assert(codes(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1'] })).includes('unreadable-glyph'));
});

test('verified figure labels cannot hide unreadable control glyphs behind clean region text', () => {
  const source = documentWith(p => {
    p.regions[0] = { ...p.regions[0], type: 'figure', text: 'MRI diagram', figureReview: {
      decision: 'labels-transcribed', sourceChecked: true, labels: [{ id: 'l1', text: 'T1\u0010w' }]
    } };
  });
  assert(codes(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1'] })).includes('unreadable-glyph'));
});

test('a multi-region excerpt cannot be verified without a connecting reading order', () => {
  const source = documentWith(p => { p.edges = []; });
  assert.equal(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1', 'r2'] }).ok, false);
  assert.equal(validateDocumentStructure(source, { scope: 'page', pageId: 'p1' }).ok, false);
});

test('branching reading order cannot be marked complete', () => {
  const source = documentWith(p => {
    p.fragmentIds.push('f3');
    p.regions.push(region('r3', 'f3', 'Follow-up.', 30));
    p.edges.push({ id: 'e2', type: 'reading-next', from: 'r1', to: 'r3', status: 'verified' });
  });
  assert.equal(validateDocumentStructure(source, { scope: 'page', pageId: 'p1' }).ok, false);
  assert.equal(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1', 'r3'] }).ok, false);
});

test('skipping a region does not bypass verification of the reading path', () => {
  const source = documentWith(p => {
    p.fragmentIds.push('f3');
    p.regions.push(region('r3', 'f3', 'Follow-up.', 30));
    p.edges.push({ id: 'e2', type: 'reading-next', from: 'r2', to: 'r3', status: 'proposed' });
  });
  assert.equal(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1', 'r3'] }).ok, false);
  source.pages[0].edges[1].status = 'verified';
  assert.equal(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1', 'r3'] }).ok, true);
});

test('a visually blank table cell cannot emit a measurement', () => {
  const source = documentWith(p => {
    p.regions[0] = { ...p.regions[0], type: 'table', table: {
      rowCount: 1, columnCount: 1, reviewed: true, cells: [
        { id: 'b', row: 0, column: 0, rowSpan: 1, colSpan: 1, role: 'blank', text: '42', blankReason: 'visually blank', headerCellIds: [] }
      ]
    } };
  });
  assert(codes(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1'] })).includes('invalid-cell'));
  source.pages[0].regions[0].table.cells[0].text = '';
  assert.equal(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1'] }).ok, true);
});

test('table dimensions above the editor limit fail before scanning the grid', () => {
  for (const [rowCount, columnCount] of [[21, 1], [1, 21]]) {
    const source = documentWith(p => {
      p.regions[0] = { ...p.regions[0], type: 'table', table: {
        rowCount, columnCount, reviewed: true, cells: [
          { id: 'v', row: 0, column: 0, rowSpan: rowCount, colSpan: columnCount, role: 'value', text: '2 mm', headerCellIds: [] }
        ]
      } };
    });
    assert(codes(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1'] })).includes('invalid-cell'));
  }
});

test('page and excerpt completion are distinct', () => {
  const source = documentWith(p => { p.regions[1].status = 'unresolved'; p.visualInventoryConfirmed = false; });
  assert.equal(validateDocumentStructure(source, { scope: 'page', pageId: 'p1' }).ok, false);
  assert.equal(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1'] }).ok, true);
  assert.deepEqual(codes(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r2'] })), ['unresolved-selection']);
});

test('unsupported schema never passes validation', () => {
  const source = documentWith();
  source.schemaVersion = 2;
  assert(codes(validateDocumentStructure(source, { scope: 'page', pageId: 'p1' })).includes('unsupported-schema'));
});

test('duplicate or omitted PDF fragments cannot be called complete', () => {
  const duplicate = documentWith(p => { p.regions[1].fragmentIds = ['f1']; });
  const result = codes(validateDocumentStructure(duplicate, { scope: 'page', pageId: 'p1' }));
  assert(result.includes('duplicate-fragment'));
  assert(result.includes('missing-fragment'));
});

test('dangling and cyclic reading edges are rejected', () => {
  const dangling = documentWith(p => { p.edges[0].to = 'absent'; });
  assert(codes(validateDocumentStructure(dangling, { scope: 'page', pageId: 'p1' })).includes('dangling-edge'));
  const cycle = documentWith(p => { p.edges.push({ id: 'e2', type: 'reading-next', from: 'r2', to: 'r1', status: 'verified' }); });
  assert(codes(validateDocumentStructure(cycle, { scope: 'page', pageId: 'p1' })).includes('reading-cycle'));
});

test('unverified reading relation blocks a multi-region excerpt', () => {
  const source = documentWith(p => { p.edges[0].status = 'proposed'; });
  assert(codes(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1', 'r2'] })).includes('unverified-edge'));
});

test('out-of-page geometry and invalid table ownership are rejected', () => {
  const source = documentWith(p => {
    p.regions[0].box.x = 590;
    p.regions[0].box.width = 20;
    p.regions[1] = { ...p.regions[1], type: 'table', table: { rowCount: 1, columnCount: 1,
      cells: [{ id: 'c1', row: 0, column: 2, rowSpan: 1, colSpan: 1, text: '2 mm' }] } };
  });
  const found = codes(validateDocumentStructure(source, { scope: 'page', pageId: 'p1' }));
  assert(found.includes('invalid-box'));
  assert(found.includes('invalid-cell'));
});

test('unreadable formula glyph and unreasoned exclusion cannot pass', () => {
  const source = documentWith(p => {
    p.regions[0] = { ...p.regions[0], type: 'equation', text: 'D\u001095%' };
    p.regions[1].status = 'excluded';
  });
  const found = codes(validateDocumentStructure(source, { scope: 'page', pageId: 'p1' }));
  assert(found.includes('unreadable-glyph'));
  assert(found.includes('unreasoned-exclusion'));
  assert(codes(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1'] })).includes('unreadable-glyph'));
});

test('whole-page completion requires explicit visual inventory confirmation', () => {
  const source = documentWith(p => { p.visualInventoryConfirmed = false; });
  assert.deepEqual(codes(validateDocumentStructure(source, { scope: 'page', pageId: 'p1' })), ['inventory-unconfirmed']);
});

test('editing a verified region is immutable and invalidates attached relation and page inventory', () => {
  const source = documentWith();
  const changed = applyStructureEdit(source, { kind: 'update-region', pageId: 'p1', regionId: 'r1', changes: { text: 'Corrected artery' } });
  assert.equal(source.pages[0].regions[0].text, 'The artery');
  assert.equal(source.pages[0].visualInventoryConfirmed, true);
  assert.equal(changed.pages[0].regions[0].text, 'Corrected artery');
  assert.equal(changed.pages[0].regions[0].status, 'proposed');
  assert.equal(changed.pages[0].edges[0].status, 'proposed');
  assert.equal(changed.pages[0].visualInventoryConfirmed, false);
});

test('table review rejects missing cells and dangling header associations, including inherited blanks', () => {
  const source = documentWith(p => {
    p.regions[0] = { ...p.regions[0], type: 'table', table: { rowCount: 2, columnCount: 2, reviewed: true,
      cells: [
        { id: 'h', row: 0, column: 0, rowSpan: 1, colSpan: 2, text: 'Measure', role: 'header', headerCellIds: [] },
        { id: 'v', row: 1, column: 0, rowSpan: 1, colSpan: 1, text: '2 mm', role: 'value', headerCellIds: ['missing'] }
      ] } };
  });
  const found = codes(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1'] }));
  assert(found.includes('missing-cell'), 'Unrepresented blank/inherited cell was silently accepted');
  assert(found.includes('invalid-header-binding'), 'Value with a missing header target was accepted');
  const corrected = applyStructureEdit(source, { kind: 'set-cells', pageId: 'p1', regionId: 'r1', table: {
    rowCount: 2, columnCount: 2, reviewed: true,
    cells: [
      { id: 'h', row: 0, column: 0, rowSpan: 1, colSpan: 2, text: 'Measure', role: 'header', headerCellIds: [] },
      { id: 'v', row: 1, column: 0, rowSpan: 1, colSpan: 1, text: '2 mm', role: 'value', headerCellIds: ['h'] },
      { id: 'blank', row: 1, column: 1, rowSpan: 1, colSpan: 1, text: '', role: 'blank', blankReason: 'inherited', headerCellIds: ['h'] }
    ] } });
  assert.equal(corrected.pages[0].regions[0].status, 'proposed');
  assert.equal(corrected.pages[0].edges[0].status, 'proposed');
  const reverified = applyStructureEdit(corrected, { kind: 'update-region', pageId: 'p1', regionId: 'r1', changes: { status: 'verified' } });
  assert.equal(validateDocumentStructure(reverified, { scope: 'excerpt', selectedRegionIds: ['r1'] }).ok, true);
});

test('equation glyph corruption and absent explicit source review cannot be verified by status alone', () => {
  const source = documentWith(p => { p.regions[0] = { ...p.regions[0], type: 'equation', text: 'D\u001095%', equationReview: null }; });
  const initial = codes(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1'] }));
  assert(initial.includes('unreadable-glyph'));
  assert(initial.includes('equation-unreviewed'));
  const changed = applyStructureEdit(source, { kind: 'set-equation', pageId: 'p1', regionId: 'r1',
    transcription: 'D₉₅%', sourceChecked: true });
  assert.equal(changed.pages[0].regions[0].status, 'proposed');
  const verified = applyStructureEdit(changed, { kind: 'update-region', pageId: 'p1', regionId: 'r1', changes: { status: 'verified' } });
  assert.equal(validateDocumentStructure(verified, { scope: 'excerpt', selectedRegionIds: ['r1'] }).ok, true);
});

test('raster figure requires reviewed labels or an explicit no-internal-text decision', () => {
  const source = documentWith(p => { p.regions[0] = { ...p.regions[0], type: 'figure', text: '', figureReview: null }; });
  assert(codes(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1'] })).includes('figure-unassessed'));
  const changed = applyStructureEdit(source, { kind: 'set-figure-labels', pageId: 'p1', regionId: 'r1',
    decision: 'no-internal-text', labels: [], sourceChecked: true });
  assert.equal(changed.pages[0].regions[0].status, 'proposed');
  const verified = applyStructureEdit(changed, { kind: 'update-region', pageId: 'p1', regionId: 'r1', changes: { status: 'verified' } });
  assert.equal(validateDocumentStructure(verified, { scope: 'excerpt', selectedRegionIds: ['r1'] }).ok, true);
  const invalid = applyStructureEdit(verified, { kind: 'set-figure-labels', pageId: 'p1', regionId: 'r1',
    decision: 'labels-transcribed', labels: [], sourceChecked: true });
  assert(codes(validateDocumentStructure(invalid, { scope: 'excerpt', selectedRegionIds: ['r1'] })).includes('figure-unassessed'));
});

function tableCaptionDocument() {
  return documentWith(p => {
    p.regions[0].type = 'caption'; p.regions[0].text = 'Table 1. Measures.';
    p.regions[1].type = 'table';
    p.regions[1].table = { rowCount: 2, columnCount: 1, reviewed: true, cells: [
      { id: 'header', row: 0, column: 0, rowSpan: 1, colSpan: 1, text: 'Measure', role: 'header', headerCellIds: [] },
      { id: 'value', row: 1, column: 0, rowSpan: 1, colSpan: 1, text: '2 mm', role: 'value', headerCellIds: ['header'] }
    ] };
    p.edges.push({ id: 'table-caption', type: 'caption-of', from: 'r1', to: 'r2', status: 'verified' });
  });
}

function twoPageRelationships(targetType = 'table') {
  const target = { ...tableCaptionDocument().pages[0].regions[1], id: 'origin', fragmentIds: ['origin-f'] };
  if (targetType === 'figure') {
    delete target.table;
    target.type = 'figure';
    target.figureReview = { sourceChecked: true, decision: 'no-internal-text', labels: [] };
  }
  const caption = { ...region('caption', 'caption-f', 'Table or figure 1 continued.', 20), type: 'caption' };
  const note = { ...region('note', 'note-f', '* Applies to the preceding source.', 20), type: 'footnote',
    footnoteReview: { sourceChecked: true, decision: 'linked', standaloneReason: '' } };
  const makePage = (id, regions, edges = []) => ({ id, width: 600, height: 800,
    fragmentIds: regions.flatMap(item => item.fragmentIds), regions, edges, issues: [], visualInventoryConfirmed: true });
  return createDocumentStructure([makePage('p1', [target]), makePage('p2', [caption, note], [
    { id: 'caption-link', type: 'caption-of', from: 'caption', to: 'origin', status: 'verified' },
    { id: 'note-link', type: 'footnote-of', from: 'note', to: 'origin', status: 'verified' },
    { id: 'sequence', type: 'reading-next', from: 'caption', to: 'note', status: 'verified' }
  ])]);
}

test('selected two-page caption and footnote relationships use the recorded source page', () => {
  for (const type of ['table', 'figure']) {
    const source = twoPageRelationships(type);
    for (const options of [{ scope: 'page', pageId: 'p2' },
      { scope: 'excerpt', selectedRegionIds: ['caption'] }, { scope: 'excerpt', selectedRegionIds: ['note'] }])
      assert.deepEqual(validateDocumentStructure(source, options), { ok: true, issues: [] });
    const linked = applyStructureEdit(source, { kind: 'set-caption-link', pageId: 'p2', captionId: 'caption', targetId: 'origin' });
    assert.equal(linked.pages[1].edges.find(edge => edge.type === 'caption-of').status, 'proposed');
    const noted = applyStructureEdit(source, { kind: 'set-footnote-review', pageId: 'p2', regionId: 'note',
      decision: 'linked', sourceChecked: true, targetRegionIds: ['origin'], standaloneReason: '' });
    assert.equal(noted.pages[1].edges.find(edge => edge.type === 'footnote-of').status, 'proposed');
    assert.equal(source.pages[1].edges[0].status, 'verified');
  }
});

test('two-page relationships reject absent, ambiguous and unverified targets and foreign reading edges', () => {
  for (const change of [
    source => { source.pages[0].regions = []; },
    source => { source.pages[0].regions[0].status = 'proposed'; },
    source => { source.pages[1].regions.push(structuredClone(source.pages[0].regions[0])); }
  ]) {
    const source = twoPageRelationships(); change(source);
    assert(codes(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['caption'] })).includes('invalid-caption-target'));
    assert(codes(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['note'] })).includes('invalid-footnote-target'));
  }
  const source = twoPageRelationships();
  source.pages[1].edges.push({ id: 'foreign-order', type: 'reading-next', from: 'note', to: 'origin', status: 'verified' });
  assert(codes(validateDocumentStructure(source, { scope: 'page', pageId: 'p2' })).includes('dangling-edge'));
  for (const targets of [['missing'], ['note'], ['origin', 'origin']])
    assert.throws(() => applyStructureEdit(source, { kind: 'set-footnote-review', pageId: 'p2', regionId: 'note',
      decision: 'linked', sourceChecked: true, targetRegionIds: targets, standaloneReason: '' }), /target regions/);
});

test('editing or excluding a target invalidates incoming reviews on both selected pages', () => {
  for (const change of [
    { kind: 'update-region', changes: { text: 'Corrected source title' } },
    { kind: 'update-region', changes: { status: 'excluded', exclusionReason: 'Narrower excerpt' } },
    { kind: 'set-cells', table: twoPageRelationships().pages[0].regions[0].table }
  ]) {
    const source = twoPageRelationships();
    const next = applyStructureEdit(source, { ...change, pageId: 'p1', regionId: 'origin' });
    assert.equal(next.pages[1].visualInventoryConfirmed, false);
    assert(next.pages[1].edges.filter(edge => edge.to === 'origin').every(edge => edge.status === 'proposed'));
    assert.equal(next.pages[1].regions.find(item => item.id === 'note').footnoteReview.sourceChecked, false);
    const again = applyStructureEdit(next, { kind: 'update-region', pageId: 'p1', regionId: 'origin', changes: { status: 'verified' } });
    for (const id of ['caption', 'note'])
      assert.equal(validateDocumentStructure(again, { scope: 'excerpt', selectedRegionIds: [id] }).ok, false);
    assert.equal(source.pages[1].visualInventoryConfirmed, true);
    assert.equal(source.pages[1].regions[1].footnoteReview.sourceChecked, true);
  }
});

test('two-page target edits invalidate transitive caption-to-note proof', () => {
  const source = twoPageRelationships('figure');
  source.pages[1].edges.find(edge => edge.id === 'note-link').to = 'caption';
  assert.equal(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['note'] }).ok, true);
  const next = applyStructureEdit(source, { kind: 'set-figure-labels', pageId: 'p1', regionId: 'origin',
    sourceChecked: true, decision: 'no-internal-text', labels: [] });
  assert.equal(next.pages[1].edges.find(edge => edge.id === 'note-link').status, 'proposed');
  assert.equal(next.pages[1].regions[1].footnoteReview.sourceChecked, false);
});

test('reassociating a reviewed relationship needs a fresh source decision for its dependent note', () => {
  const source = twoPageRelationships();
  source.pages[1].edges.find(edge => edge.id === 'note-link').to = 'caption';
  const next = applyStructureEdit(source, { kind: 'update-edge', pageId: 'p2', edgeId: 'caption-link',
    changes: { to: 'origin' } });
  assert.equal(next.pages[1].edges.find(edge => edge.id === 'note-link').status, 'proposed');
  assert.equal(next.pages[1].regions[1].footnoteReview.sourceChecked, false);
  const noted = applyStructureEdit(source, { kind: 'update-edge', pageId: 'p2', edgeId: 'note-link', changes: { to: 'origin' } });
  assert.equal(noted.pages[1].regions[1].footnoteReview.sourceChecked, false);
});

test('text replacement preserves incoming relationships from the other selected page', () => {
  const source = twoPageRelationships();
  const target = source.pages[0].regions[0]; target.type = 'paragraph'; delete target.table;
  assert.throws(() => applyStructureEdit(source, { kind: 'replace-text-regions', pageId: 'p1', regionIds: ['origin'],
    regions: [{ ...target, id: 'replacement' }] }), /specialized relationships/);
  assert.equal(source.pages[0].regions[0].id, 'origin');
});

test('a note target must pass its own caption relationship validation after ordinary edits', () => {
  const source = twoPageRelationships();
  const caption = source.pages[1].regions.shift();
  source.pages[0].regions.push(caption);
  source.pages[0].fragmentIds.push(...caption.fragmentIds);
  source.pages[1].fragmentIds = source.pages[1].regions.flatMap(item => item.fragmentIds);
  source.pages[0].edges = [{ id: 'caption-link', type: 'caption-of', from: 'caption', to: 'origin', status: 'verified' },
    { id: 'source-order', type: 'reading-next', from: 'origin', to: 'caption', status: 'verified' }];
  source.pages[1].edges = [{ id: 'note-link', type: 'footnote-of', from: 'note', to: 'caption', status: 'verified' }];
  assert.equal(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['note'] }).ok, true);
  let next = applyStructureEdit(source, { kind: 'set-caption-link', pageId: 'p1', captionId: 'caption', targetId: 'origin' });
  next = applyStructureEdit(next, { kind: 'set-footnote-review', pageId: 'p2', regionId: 'note', sourceChecked: true,
    decision: 'linked', targetRegionIds: ['caption'], standaloneReason: '' });
  const noteLink = next.pages[1].edges.find(edge => edge.type === 'footnote-of');
  next = applyStructureEdit(next, { kind: 'update-edge', pageId: 'p2', edgeId: noteLink.id, changes: { status: 'verified' } });
  next = applyStructureEdit(next, { kind: 'update-region', pageId: 'p2', regionId: 'note', changes: { status: 'verified' } });
  assert.equal(validateDocumentStructure(next, { scope: 'excerpt', selectedRegionIds: ['caption'] }).ok, false);
  assert(codes(validateDocumentStructure(next, { scope: 'excerpt', selectedRegionIds: ['note'] })).includes('invalid-footnote-target'));
  const capLink = next.pages[0].edges.find(edge => edge.type === 'caption-of');
  next = applyStructureEdit(next, { kind: 'update-edge', pageId: 'p1', edgeId: capLink.id, changes: { status: 'verified' } });
  assert.equal(validateDocumentStructure(next, { scope: 'excerpt', selectedRegionIds: ['note'] }).ok, true);
});

test('caption and note targets require complete typed proof and valid own-page source boxes', () => {
  for (const [type, change] of [
    ['table', target => { target.box.x = 700; }],
    ['table', target => { target.table.cells = []; }],
    ['figure', target => { target.figureReview.decision = 'labels-transcribed'; }],
    ['figure', target => { target.figureReview = { sourceChecked: true, decision: 'labels-transcribed', labels: [{ id: 'label', text: '\u0000' }] }; }],
    ['figure', target => { target.figureReview = { sourceChecked: true, decision: 'labels-transcribed', labels: [{ id: 'label', text: 'Artery', box: { x: 700, y: 20, width: 10, height: 10 } }] }; }]
  ]) {
    const source = twoPageRelationships(type); change(source.pages[0].regions[0]);
    for (const id of ['origin', 'caption', 'note'])
      assert.equal(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: [id] }).ok, false, `${type} target proof leaked into ${id}`);
  }
});

test('a source-reviewed table caption can complete its page and caption-only excerpt', () => {
  const source = tableCaptionDocument();
  assert.equal(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r2'] }).ok, true);
  for (const options of [{ scope: 'page', pageId: 'p1' }, { scope: 'excerpt', selectedRegionIds: ['r1'] }])
    assert.equal(validateDocumentStructure(source, options).ok, true);
});

test('caption-only review rejects an unverified, unreviewed or invalid target table', () => {
  for (const change of [
    target => { target.status = 'proposed'; },
    target => { target.table.reviewed = false; },
    target => { target.table.cells.pop(); },
    target => { target.table.cells[1].headerCellIds = ['absent-header']; },
    target => { target.type = 'paragraph'; }
  ]) {
    const source = tableCaptionDocument(); change(source.pages[0].regions[1]);
    assert(codes(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1'] })).includes('invalid-caption-target'));
  }
});

test('generic table caption edits remain proposed and table corrections invalidate them', () => {
  const source = tableCaptionDocument();
  let next = applyStructureEdit(source, { kind: 'set-caption-link', pageId: 'p1', captionId: 'r1', targetId: 'r2' });
  const edge = next.pages[0].edges.find(edge => edge.type === 'caption-of');
  assert.equal(edge.to, 'r2'); assert.equal(edge.status, 'proposed');
  assert.equal(next.pages[0].visualInventoryConfirmed, false);
  assert.equal(validateDocumentStructure(next, { scope: 'excerpt', selectedRegionIds: ['r1'] }).ok, false);
  next = applyStructureEdit(next, { kind: 'update-edge', pageId: 'p1', edgeId: edge.id, changes: { status: 'verified' } });
  assert.equal(validateDocumentStructure(next, { scope: 'excerpt', selectedRegionIds: ['r1'] }).ok, true);
  const table = structuredClone(next.pages[0].regions[1].table); table.cells[1].text = '3 mm';
  next = applyStructureEdit(next, { kind: 'set-cells', pageId: 'p1', regionId: 'r2', table });
  assert.equal(next.pages[0].regions[1].status, 'proposed');
  assert.equal(next.pages[0].edges.find(edge => edge.type === 'caption-of').status, 'proposed');
  assert.equal(validateDocumentStructure(next, { scope: 'excerpt', selectedRegionIds: ['r1'] }).ok, false);
  assert.equal(source.pages[0].edges.find(edge => edge.type === 'caption-of').status, 'verified');
});

test('caption must target a verified figure, not adjacent prose', () => {
  const source = documentWith(p => { p.regions[0].type = 'caption'; });
  assert(codes(validateDocumentStructure(source, { scope: 'excerpt', selectedRegionIds: ['r1'] })).includes('caption-link-unresolved'));
  const wrong = applyStructureEdit(source, { kind: 'set-caption-link', pageId: 'p1', captionId: 'r1', figureId: 'r2' });
  assert(codes(validateDocumentStructure(wrong, { scope: 'excerpt', selectedRegionIds: ['r1'] })).includes('invalid-caption-target'));
  const figure = applyStructureEdit(wrong, { kind: 'update-region', pageId: 'p1', regionId: 'r2', changes: {
    type: 'figure', figureReview: { decision: 'no-internal-text', labels: [], sourceChecked: true }
  } });
  const reviewedFigure = applyStructureEdit(figure, { kind: 'update-region', pageId: 'p1', regionId: 'r2', changes: { status: 'verified' } });
  const linked = applyStructureEdit(reviewedFigure, { kind: 'set-caption-link', pageId: 'p1', captionId: 'r1', figureId: 'r2' });
  assert(codes(validateDocumentStructure(linked, { scope: 'excerpt', selectedRegionIds: ['r1'] })).includes('caption-link-unresolved'));
  const captionEdge = linked.pages[0].edges.find(edge => edge.type === 'caption-of');
  const verified = applyStructureEdit(linked, { kind: 'update-edge', pageId: 'p1', edgeId: captionEdge.id, changes: { status: 'verified' } });
  const reviewedCaption = applyStructureEdit(verified, { kind: 'update-region', pageId: 'p1', regionId: 'r1', changes: { status: 'verified' } });
  assert.equal(validateDocumentStructure(reviewedCaption, { scope: 'excerpt', selectedRegionIds: ['r1'] }).ok, true);
});

test('changing a proposed caption to a reviewed figure retires its stale caption warning', () => {
  const source = documentWith(p => {
    p.regions[0].type = 'caption';
    p.issues.push({ code: 'caption-link-unresolved', pageId: 'p1', regionId: 'r1', message: 'Original caption proposal' });
  });
  const changed = applyStructureEdit(source, { kind: 'update-region', pageId: 'p1', regionId: 'r1', changes: {
    type: 'figure', figureReview: { decision: 'no-internal-text', labels: [], sourceChecked: true }
  } });
  const verified = applyStructureEdit(changed, { kind: 'update-region', pageId: 'p1', regionId: 'r1', changes: { status: 'verified' } });
  assert.equal(validateDocumentStructure(verified, { scope: 'excerpt', selectedRegionIds: ['r1'] }).ok, true);
});
