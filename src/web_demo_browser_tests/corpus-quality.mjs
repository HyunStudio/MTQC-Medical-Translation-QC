// Test-runner policy only: allow individual documented failures, never an entire specimen.
export function evaluateQuality(record, allowances = {}) {
  const issues = [];
  if (!Number.isFinite(record.characters) || record.characters <= 0) issues.push('Empty extraction');
  if (!Array.isArray(record.anchors) || record.anchors.length === 0 || !Array.isArray(record.order)) {
    issues.push('Missing source annotations');
    return issues;
  }
  const allowed = allowances[record.id] || { anchors: [], order: [] };
  for (const anchor of record.anchors) {
    if (!anchor.found && !(allowed.anchors || []).includes(anchor.anchor)) issues.push(`Missing anchor: ${anchor.anchor}`);
  }
  for (const edge of record.order) {
    if (!edge.pass && !(allowed.order || []).some(([a, b]) => a === edge.before && b === edge.after))
      issues.push(`Reading order: ${edge.before} -> ${edge.after}`);
  }
  return issues;
}

export function fragmentCoverage(expectedIds, outputIds) {
  const counts = new Map();
  outputIds.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
  const expected = new Set(expectedIds);
  return {
    missing: expectedIds.filter(id => !counts.has(id)),
    duplicates: [...counts].filter(([, count]) => count > 1).map(([id]) => id),
    unexpected: [...counts.keys()].filter(id => !expected.has(id))
  };
}
