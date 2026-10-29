import { partitionQuestionPanels } from './document-panel-order.mjs';
// Geometric reading-order proposal for English PDF text layers. The reviewer can
// override column detection: tables and irregular figure labels need visual review.
import { isTableReferenceText } from './document-table-grid.mjs';
// Band detection recognizes a common count (percentage) display without
// changing the text or claiming a cell grid/clinical interpretation. Keep this
// anchored and percentage-bounded; prose suffixes are not numeric evidence.
function isNumericBandCell(text) {
  const value = text.trim();
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(value) ||
    /^(?:\d+|\d{1,3}(?:,\d{3})+)\s+\((?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%\)$/.test(value);
}

function groupedRows(items) {
  const groups = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = groups.at(-1);
    if (last && Math.abs(last.y - item.y) < Math.min(last.height, item.height) * .45) last.items.push(item);
    else groups.push({ y: item.y, height: item.height, items: [item] });
  }
  return groups;
}

function rows(items, column) {
  return groupedRows(items).map(group => {
    const sorted = group.items.sort((a, b) => a.x - b.x);
    let text = '';
    sorted.forEach((item, index) => {
      const previous = sorted[index - 1];
      const gap = previous ? item.x - previous.x - previous.width : 0;
      text += (index && gap > Math.max(1, item.height * .12) && !/\s$/.test(text) && !/^\s/.test(item.text) ? ' ' : '') + item.text;
    });
    const x = Math.min(...sorted.map(item => item.x));
    const y = Math.min(...sorted.map(item => item.y));
    return { text: text.trim(), x, y, width: Math.max(...sorted.map(item => item.x + item.width)) - x,
      height: Math.max(...sorted.map(item => item.y + item.height)) - y, column,
      fragmentIds: sorted.map(item => item.fragmentId), fragmentCount: sorted.length };
  });
}

// A full-width numeric table can sit above two-column prose. Applying one
// page-wide gutter to its cells breaks row associations, so isolate only
// confidently identified TABLE N regions and keep them in geometric row order.
function numericTableBands(items, width) {
  const groups = groupedRows(items);
  const bands = [];
  for (const marker of items.filter(item => /^TABLE\s+\d+\b/i.test(item.text.trim()) && !isTableReferenceText(item.text)).sort((a, b) => a.y - b.y)) {
    const markerRow = groups.find(group => group.items.includes(marker));
    if (marker.x > Math.min(...markerRow.items.map(item => item.x)) + 2) continue;
    if (isTableReferenceText(rows(markerRow.items, 'full')[0].text)) continue;
    if (bands.some(band => marker.y <= band.end)) continue;
    // Some journals center a single wide data row on a prose page. It has
    // too few rows for the ordinary table detector, but five compact header
    // cells and five horizontally aligned numeric starts are strong evidence
    // of a row that must not be split by an apparent two-column gutter.
    // The >20% left edge distinguishes this case from the established
    // left-aligned long-table path below; the 40% and half-page span guards
    // exclude a table that belongs only to one prose column.
    if (marker.x > width * .2) {
      if (marker.x <= width * .4) {
        const header = groups.find(group => group.y > marker.y && group.y - marker.y < 45 &&
          group.items.length >= 5 && group.items.every(item => item.width < width * .2 && /[A-Za-z]/.test(item.text)) &&
          Math.max(...group.items.map(item => item.x + item.width)) - Math.min(...group.items.map(item => item.x)) > width * .5);
        const data = header && groups.find(group => group.y > header.y && group.y - header.y < 35);
        const numericStarts = data?.items.filter(item => isNumericBandCell(item.text)) ?? [];
        if (data && numericStarts.length >= header.items.length &&
          Math.max(...data.items.map(item => item.x + item.width)) - Math.min(...data.items.map(item => item.x)) > width * .5 &&
          header.items.every(cell => numericStarts.some(value => Math.abs(value.x - cell.x) < width * .03))) {
          let last = data;
          for (const group of groups.filter(group => group.y > data.y)) {
            if (group.y - last.y > 35) break;
            const values = group.items.filter(item => isNumericBandCell(item.text));
            if (values.length < header.items.length ||
              !header.items.every(cell => values.some(value => Math.abs(value.x - cell.x) < width * .03))) break;
            last = group;
          }
          bands.push({ start: marker.y - 1,
            end: Math.max(...last.items.map(item => item.y + item.height)) + 2 });
        }
      }
      continue;
    }
    const numericRows = groups.filter(group => group.y > marker.y && group.items.length >= 3 &&
      group.items.filter(item => isNumericBandCell(item.text)).length >= 2 &&
      Math.max(...group.items.map(item => item.x + item.width)) - Math.min(...group.items.map(item => item.x)) > width * .45);
    if (numericRows.length < 2 || numericRows[0].y - marker.y > 100) continue;
    // A TABLE caption alone may precede two-column equations. Require a
    // separate, wide, multi-cell header before treating later numbers as rows.
    const header = groups.find(group => group.y > marker.y && group.y < numericRows[0].y &&
      group.items.length >= 3 &&
      group.items.filter(item => !isNumericBandCell(item.text)).length >= 3 &&
      group.items.every(item => item.width < width * .25) &&
      Math.max(...group.items.map(item => item.x + item.width)) - Math.min(...group.items.map(item => item.x)) > width * .45);
    if (!header) continue;
    // Once a full-width table is established, inherited blank cells and
    // comma-separated slice lists may leave only one plain numeric cell.
    // Keep contiguous rows aligned to the table columns without using the
    // stricter evidence required to establish the table in the first place.
    const tableColumns = [...header.items, ...numericRows[0].items].map(item => item.x);
    let last = numericRows[0];
    let count = 1;
    for (const group of groups.filter(group => group.y > numericRows[0].y)) {
      if (group.y - last.y > 45) break;
      const aligned = item => tableColumns.some(x => Math.abs(item.x - x) < width * .03);
      const shortCells = group.items.filter(item => item.width < width * .25).length;
      const followsCell = group.items.every((item, index) => aligned(item) || (index > 0 &&
        Math.abs(item.x - group.items[index - 1].x - group.items[index - 1].width) <= Math.max(2, item.height * .3)));
      const numericCell = group.items.some(item => isNumericBandCell(item.text) && aligned(item));
      const span = Math.max(...group.items.map(item => item.x + item.width)) - Math.min(...group.items.map(item => item.x));
      // Keep a contiguous incomplete row in the table too. Discarding it from
      // the band would turn a missing-value table into a misleading full prefix.
      if (group.items.length >= 2 && shortCells >= 2 && followsCell && numericCell && span > width * .25) {
        last = group;
        count++;
        continue;
      }
      // A wrapped table cell can occupy a short line by itself. Keep it
      // within the table band so the next numeric row remains attached.
      const compactWrap = group.items.length <= 4 && span < width * .25 &&
        aligned(group.items[0]) && group.items.every((item, index) => index === 0 || aligned(item) ||
          Math.abs(item.x - group.items[index - 1].x - group.items[index - 1].width) <= Math.max(6, item.height * .6));
      const isSectionHeading = /^\s*(?:(?:\d+(?:\.\d+)+\.?|\d+\.)\s+|(?:Results|Discussion|Conclusion|Methods|Introduction)\b)/i
        .test(group.items.map(item => item.text).join(' '));
      if (group.y - last.y <= 25 && shortCells === group.items.length && compactWrap && !isSectionHeading) {
        last = group;
        continue;
      }
      break;
    }
    if (count < 2) continue;
    // End at the last cell's box, not a full blank-row allowance: prose may
    // resume in two columns only a few pixels below the table rule.
    bands.push({ start: marker.y - 1, end: last.y + last.height + 2 });
  }
  return bands;
}

function findGutter(items, width, preferProse = false) {
  const percentile = (values, fraction) => {
    const sorted = values.sort((a, b) => a - b);
    return sorted[Math.round((sorted.length - 1) * fraction)];
  };
  const pageRows = groupedRows(items);
  const search = (start, end, requireProse = false, proseScore = false) => {
    let best = null;
    for (let fraction = start; fraction <= end; fraction += .01) {
      const cut = width * fraction;
      const left = items.filter(item => item.x + item.width <= cut);
      const right = items.filter(item => item.x >= cut);
      if (left.length < 2 || right.length < 2) continue;
      // Isolated page numbers and short header fragments must not close a real
      // body gutter. Journal gutters can be narrower than 2.5% of page width.
      // Dense equation glyphs must not outvote a sustained pair of body
      // columns. This is still an unverified geometric proposal, not a math
      // transcription or a semantic table/prose distinction.
      const bodyProse = item => item.width > width * .25 &&
        item.text.trim().split(/\s+/).length >= 6;
      const scoredLeft = proseScore ? left.filter(bodyProse) : left;
      const scoredRight = proseScore ? right.filter(bodyProse) : right;
      if (proseScore && (scoredLeft.length < 4 || scoredRight.length < 4)) continue;
      // The preferred gutter must clear EVERY supporting prose fragment;
      // percentiles can return a point inside a longer, valid body line.
      const gapStart = proseScore ? Math.max(...scoredLeft.map(item => item.x + item.width)) :
        percentile(scoredLeft.map(item => item.x + item.width), .9);
      const gapEnd = proseScore ? Math.min(...scoredRight.map(item => item.x)) :
        percentile(scoredRight.map(item => item.x), .1);
      if (gapEnd - gapStart < width * .015) continue;
      const overlap = Math.min(Math.max(...left.map(i => i.y)), Math.max(...right.map(i => i.y))) -
        Math.max(Math.min(...left.map(i => i.y)), Math.min(...right.map(i => i.y)));
      if (overlap <= 0) continue;
      if (requireProse) {
        // Without sustained paragraphs on both sides, the same whitespace can
        // describe label/value rows. Preserve their old row-wise proposal.
        const substantialProse = item => item.width > width * .12 &&
          item.text.trim().split(/\s+/).length >= 6;
        if (left.filter(substantialProse).length < 4 || right.filter(substantialProse).length < 4) continue;
      }
      const crossingItems = items.filter(item => item.x < cut && item.x + item.width > cut && item.width < width * .65);
      const proseLine = item => item.width > width * .25 && item.text.trim().split(/\s+/).length >= 6;
      const spanningProse = pageRows.filter(group => {
        const qualifies = run => run.length && run[0].x < cut &&
          run.at(-1).x + run.at(-1).width > cut &&
          run.at(-1).x + run.at(-1).width - run[0].x > width * .4 &&
          run.reduce((words, item) => words + item.text.trim().split(/\s+/).length, 0) >= 6;
        let run = [];
        for (const item of [...group.items].sort((a, b) => a.x - b.x)) {
          const previous = run.at(-1);
          if (previous && item.x - previous.x - previous.width > Math.max(2, Math.min(item.height, previous.height) * .3)) {
            if (qualifies(run)) return true;
            run = [];
          }
          run.push(item);
        }
        return qualifies(run);
      }).length;
      // Scattered equation glyphs on a one-column page can look like two
      // columns. Sustained prose crossing the proposed gutter is stronger
      // evidence than isolated glyph fragments on either side of it.
      if (spanningProse >= 5 && spanningProse > left.filter(proseLine).length + right.filter(proseLine).length)
        continue;
      const crossing = proseScore ? crossingItems.filter(bodyProse).length : crossingItems.length;
      const score = Math.min(scoredLeft.length, scoredRight.length) * 2 - crossing * 3;
      if (score > 0 && (!best || score > best.score)) best = { score, cut: (gapStart + gapEnd) / 2 };
    }
    return best?.cut;
  };
  // Keep a valid ordinary-column gutter before considering asymmetric ones:
  // an internal table-column gap must not outrank the established body split.
  return (preferProse ? search(.35, .65, false, true) : undefined) ??
    search(.35, .65) ?? search(.25, .75, true);
}

export function recoverReadingOrder(fragments, pageWidth, mode = 'auto', vectorHints = null) {
  const partition = mode === 'auto' ? partitionQuestionPanels(fragments,pageWidth,vectorHints) : null;
  if (partition) {
    const groups = partition.segments.map(segment => {
      const recovered = recoverReadingOrder(segment.items,pageWidth,'auto');
      return { ...recovered, lines: recovered.lines.map(line=>({...line,
        fragmentIds:line.fragmentIds.map(id=>segment.items[id].fragmentId),
        panelRole:segment.role,panelIndex:segment.panel??null})) };
    });
    const lines = groups.flatMap(group=>group.lines);
    return {columns:Math.max(...groups.map(group=>group.columns)),lines,text:lines.map(line=>line.text).join('\n'),
      fragmentCount:lines.reduce((n,line)=>n+line.fragmentIds.length,0),tableRegions:groups.reduce((n,g)=>n+g.tableRegions,0),
      panelDraft:{panels:partition.panels,status:'unverified',occlusion:'unknown'}};
  }
  const items = fragments.map((item, fragmentId) => ({ ...item, fragmentId })).filter(item => item.text?.trim() &&
    [item.x, item.y, item.width, item.height].every(Number.isFinite))
    .map(item => ({ ...item, height: Math.max(1, item.height) }));
  const tableBands = mode === 'auto' ? numericTableBands(items, pageWidth) : [];
  const bodyItems = items.filter(item => !tableBands.some(band => item.y >= band.start && item.y <= band.end));
  const detected = mode === 'single' ? null : findGutter(bodyItems, pageWidth, mode === 'auto');
  const cut = mode === 'two' ? detected ?? pageWidth / 2 : detected;
  const orderedLines = segment => {
    if (!cut) return rows(segment, 'full');
    // A PDF text layer may split one word into separate glyph fragments. If
    // one fragment crosses the gutter, carry its touching neighbors with it;
    // otherwise words such as "workflow" are split across reading bands.
    const spanningItems = new Set(segment.filter(item => item.x < cut && item.x + item.width > cut));
    const pending = [...spanningItems];
    while (pending.length) {
      const other = pending.pop();
      for (const item of segment) {
        if (spanningItems.has(item)) continue;
        const sameLine = Math.abs(item.y - other.y) < Math.min(item.height, other.height) * .45;
        const gap = Math.min(Math.abs(item.x - other.x - other.width), Math.abs(other.x - item.x - item.width));
        if (sameLine && gap <= Math.max(1, Math.min(item.height, other.height) * .12)) {
          spanningItems.add(item);
          pending.push(item);
        }
      }
    }
    const spanning = rows([...spanningItems], 'full');
    let remaining = segment.filter(item => !spanningItems.has(item));
    const lines = [];
    const appendBand = band => {
      lines.push(...rows(band.filter(item => item.x < cut), 'left'), ...rows(band.filter(item => item.x >= cut), 'right'));
    };
    for (const separator of spanning) {
      // The crossing fragment may be only a row's right-hand suffix. Keep
      // its same-baseline prefix with that row before dividing prose bands;
      // the glyph-touching rule above is not a whole-row boundary test.
      // Reuse the existing row-grouping criterion, without widening gaps.
      const separatorIds = new Set(separator.fragmentIds);
      const anchor = segment.filter(item => separatorIds.has(item.fragmentId)).sort((a, b) => a.y - b.y || a.x - b.x)[0];
      const sameBaseline = item => Math.abs(item.y - anchor.y) < Math.min(item.height, anchor.height) * .45;
      const peers = remaining.filter(sameBaseline);
      appendBand(remaining.filter(item => item.y < separator.y && !sameBaseline(item)));
      remaining = remaining.filter(item => item.y >= separator.y && !sameBaseline(item));
      // Preserve separate runs (for example metadata beside an abstract).
      // Correct their order without inventing a shared caption/paragraph box.
      lines.push(...[
        ...rows(peers.filter(item => item.x < cut), 'left'), separator,
        ...rows(peers.filter(item => item.x >= cut), 'right')
      ].sort((a, b) => a.x - b.x));
    }
    appendBand(remaining);
    return lines;
  };
  const lines = [];
  let after = -Infinity;
  for (const band of tableBands) {
    lines.push(...orderedLines(items.filter(item => item.y > after && item.y < band.start)));
    lines.push(...rows(items.filter(item => item.y >= band.start && item.y <= band.end), 'table'));
    after = band.end;
  }
  lines.push(...orderedLines(items.filter(item => item.y > after)));
  return { columns: cut ? 2 : 1, lines, text: lines.map(line => line.text).join('\n'),
    fragmentCount: lines.reduce((total, line) => total + line.fragmentIds.length, 0), tableRegions: tableBands.length };
}
