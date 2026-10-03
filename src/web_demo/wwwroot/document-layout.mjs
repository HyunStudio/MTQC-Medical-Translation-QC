// Geometric reading-order proposal for English PDF text layers. The reviewer can
// override column detection: tables and irregular figure labels need visual review.
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
  for (const marker of items.filter(item => /^TABLE\s+\d+\b/i.test(item.text.trim())).sort((a, b) => a.y - b.y)) {
    if (bands.some(band => marker.y <= band.end)) continue;
    const numericRows = groups.filter(group => group.y > marker.y &&
      group.y - marker.y < width * .55 && group.items.length >= 3 &&
      group.items.filter(item => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(item.text.trim())).length >= 2 &&
      Math.max(...group.items.map(item => item.x + item.width)) - Math.min(...group.items.map(item => item.x)) > width * .45);
    if (numericRows.length < 2 || numericRows[0].y - marker.y > 100) continue;
    let last = numericRows[0];
    let count = 1;
    for (const group of numericRows.slice(1)) {
      if (group.y - last.y > 45) break;
      last = group;
      count++;
    }
    if (count < 2) continue;
    bands.push({ start: marker.y - 1, end: last.y + Math.max(25, last.height * 2.3) });
  }
  return bands;
}

function findGutter(items, width) {
  const percentile = (values, fraction) => {
    const sorted = values.sort((a, b) => a - b);
    return sorted[Math.round((sorted.length - 1) * fraction)];
  };
  let best = null;
  for (let fraction = .35; fraction <= .65; fraction += .01) {
    const cut = width * fraction;
    const left = items.filter(item => item.x + item.width <= cut);
    const right = items.filter(item => item.x >= cut);
    if (left.length < 2 || right.length < 2) continue;
    // Isolated page numbers and short header fragments must not close a real
    // body gutter. Journal gutters can be narrower than 2.5% of page width.
    const gapStart = percentile(left.map(item => item.x + item.width), .9);
    const gapEnd = percentile(right.map(item => item.x), .1);
    if (gapEnd - gapStart < width * .015) continue;
    const overlap = Math.min(Math.max(...left.map(i => i.y)), Math.max(...right.map(i => i.y))) -
      Math.max(Math.min(...left.map(i => i.y)), Math.min(...right.map(i => i.y)));
    if (overlap <= 0) continue;
    const crossing = items.filter(item => item.x < cut && item.x + item.width > cut && item.width < width * .65).length;
    const score = Math.min(left.length, right.length) * 2 - crossing * 3;
    if (score > 0 && (!best || score > best.score)) best = { score, cut: (gapStart + gapEnd) / 2 };
  }
  return best?.cut;
}

export function recoverReadingOrder(fragments, pageWidth, mode = 'auto') {
  const items = fragments.map((item, fragmentId) => ({ ...item, fragmentId })).filter(item => item.text?.trim() &&
    [item.x, item.y, item.width, item.height].every(Number.isFinite))
    .map(item => ({ ...item, height: Math.max(1, item.height) }));
  const tableBands = mode === 'auto' ? numericTableBands(items, pageWidth) : [];
  const bodyItems = items.filter(item => !tableBands.some(band => item.y >= band.start && item.y <= band.end));
  const detected = mode === 'single' ? null : findGutter(bodyItems, pageWidth);
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
      appendBand(remaining.filter(item => item.y < separator.y));
      remaining = remaining.filter(item => item.y >= separator.y);
      lines.push(separator);
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
