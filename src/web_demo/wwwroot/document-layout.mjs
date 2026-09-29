// Geometric reading-order proposal for English PDF text layers. The reviewer can
// override column detection: tables and irregular figure labels need visual review.
function rows(items, column) {
  const groups = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = groups.at(-1);
    if (last && Math.abs(last.y - item.y) < Math.min(last.height, item.height) * .45) last.items.push(item);
    else groups.push({ y: item.y, height: item.height, items: [item] });
  }
  return groups.map(group => {
    const sorted = group.items.sort((a, b) => a.x - b.x);
    let text = '';
    sorted.forEach((item, index) => {
      const previous = sorted[index - 1];
      const gap = previous ? item.x - previous.x - previous.width : 0;
      text += (index && gap > Math.max(1, item.height * .12) ? ' ' : '') + item.text;
    });
    const x = Math.min(...sorted.map(item => item.x));
    const y = Math.min(...sorted.map(item => item.y));
    return { text, x, y, width: Math.max(...sorted.map(item => item.x + item.width)) - x,
      height: Math.max(...sorted.map(item => item.y + item.height)) - y, column, fragmentCount: sorted.length };
  });
}

function findGutter(items, width) {
  let best = null;
  for (let fraction = .35; fraction <= .65; fraction += .01) {
    const cut = width * fraction;
    const left = items.filter(item => item.x + item.width <= cut);
    const right = items.filter(item => item.x >= cut);
    if (left.length < 2 || right.length < 2) continue;
    const gapStart = Math.max(...left.map(item => item.x + item.width));
    const gapEnd = Math.min(...right.map(item => item.x));
    if (gapEnd - gapStart < width * .025) continue;
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
  const items = fragments.filter(item => item.text?.trim() &&
    [item.x, item.y, item.width, item.height].every(Number.isFinite))
    .map(item => ({ ...item, text: item.text.trim(), height: Math.max(1, item.height) }));
  const detected = mode === 'single' ? null : findGutter(items, pageWidth);
  const cut = mode === 'two' ? detected ?? pageWidth / 2 : detected;
  let lines;
  if (!cut) lines = rows(items, 'full');
  else {
    const spanning = rows(items.filter(item => item.x < cut && item.x + item.width > cut), 'full');
    let remaining = items.filter(item => item.x + item.width <= cut || item.x >= cut);
    lines = [];
    const appendBand = band => {
      lines.push(...rows(band.filter(item => item.x < cut), 'left'), ...rows(band.filter(item => item.x >= cut), 'right'));
    };
    for (const separator of spanning) {
      appendBand(remaining.filter(item => item.y < separator.y));
      remaining = remaining.filter(item => item.y >= separator.y);
      lines.push(separator);
    }
    appendBand(remaining);
  }
  return { columns: cut ? 2 : 1, lines, text: lines.map(line => line.text).join('\n'),
    fragmentCount: items.length };
}
