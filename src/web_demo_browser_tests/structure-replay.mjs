import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { recoverReadingOrder } from '../web_demo/wwwroot/document-layout.mjs';
import { proposePageStructure } from '../web_demo/wwwroot/document-structure-proposal.mjs';
import { scoreCandidateArms, aggregateCandidateReports, projectReviewedObservations } from '../web_demo_evaluation/structure-projection.mjs';
import { scoreStructure } from '../web_demo_evaluation/structure-scoring.mjs';

/** Validate all declarations before generating any PDF candidate or output. */
export function validateReviewedCases(bundle, truthCases, truthSha256) {
  if (bundle?.schemaVersion !== 1 || !/^[a-f0-9]{64}$/i.test(truthSha256 || '') ||
    bundle.truthSha256?.toLowerCase() !== truthSha256.toLowerCase() || !Array.isArray(bundle.cases))
    throw new Error('Reviewed bundle schema or visual-truth hash does not match the lock');
  const truths = new Map();
  if (!Array.isArray(truthCases) || !truthCases.length) throw new Error('Reviewed replay has no locked cases');
  for (const truth of truthCases) {
    if (!truth?.caseId || truths.has(truth.caseId)) throw new Error('Reviewed replay has duplicate truth cases');
    truths.set(truth.caseId, truth);
  }
  const cases = new Map();
  for (const artifact of bundle.cases) {
    if (!truths.has(artifact?.caseId) || cases.has(artifact.caseId))
      throw new Error(`Reviewed bundle has extra, missing or duplicate case ID: ${artifact?.caseId}`);
    const caseTruth = truths.get(artifact.caseId);
    const reviewed = projectReviewedObservations({ truth: caseTruth, artifact });
    // Validate scoring shape across the complete corpus now; a malformed last
    // checklist must not fail only after earlier candidate files were written.
    scoreStructure({ truth: caseTruth, proposal: [], reviewed });
    cases.set(artifact.caseId, artifact);
  }
  if (cases.size !== truths.size) throw new Error('Reviewed bundle is missing locked physical cases');
  return cases;
}

/** Raw, deliberately unscored candidate arms for one physical source page. */
export function summarizeExtractedPage({ pageIndex, width, height, fragments, hasImages, ocrText = '' }) {
  const native = { text: fragments.map(fragment => fragment.text).join(' '),
    fragmentIds: fragments.map((_, index) => `p${pageIndex + 1}-f${index}`) };
  const flat = recoverReadingOrder(fragments, width, 'auto');
  const graph = proposePageStructure({ pageIndex, width, height, fragments, hasImages, ocrText });
  return { native, flat, graph };
}

function parseArgs(argv) {
  const manifest = argv.indexOf('--manifest');
  const out = argv.indexOf('--out');
  if (manifest < 0 || out < 0 || !argv[manifest + 1] || !argv[out + 1])
    throw new Error('Usage: node structure-replay.mjs --manifest <locked-local-manifest.json> --out <ignored-local-output-dir>');
  return { manifest: path.resolve(argv[manifest + 1]), out: path.resolve(argv[out + 1]) };
}

export function resolveManifestSourcePath(manifestPath, sourcePath) {
  if (typeof sourcePath !== 'string' || !sourcePath.trim() || path.isAbsolute(sourcePath))
    throw new Error('Source path is outside manifest directory');
  const base = path.dirname(manifestPath);
  const resolved = path.resolve(base, sourcePath);
  const relative = path.relative(base, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error('Source path is outside manifest directory');
  return resolved;
}

export function assertSha256(bytes, expected, label) {
  if (!/^[a-f0-9]{64}$/i.test(expected || ''))
    throw new Error(`${label} hash is missing or invalid`);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual.toLowerCase() !== expected.toLowerCase())
    throw new Error(`${label} hash differs from selection lock`);
  return actual;
}

export function validateTruthCases(manifestCases, truthCases) {
  if (!Array.isArray(manifestCases) || !Array.isArray(truthCases))
    throw new Error('Locked manifest and visual truth cases must be arrays');
  const expected = new Map();
  for (const item of manifestCases) {
    if (!item?.caseId || expected.has(item.caseId))
      throw new Error(`Duplicate or missing manifest case ID: ${item?.caseId}`);
    expected.set(item.caseId, item);
  }
  const seen = new Set();
  for (const item of truthCases) {
    if (!item?.caseId || seen.has(item.caseId))
      throw new Error(`Duplicate or missing visual truth case ID: ${item?.caseId}`);
    if (!expected.has(item.caseId)) throw new Error(`Extra visual truth case: ${item.caseId}`);
    if (!Array.isArray(item.items) || item.items.length < 1)
      throw new Error(`${item.caseId}: visual truth has no scored items`);
    const locked = expected.get(item.caseId);
    if (locked.page !== undefined && item.physicalPage !== locked.page)
      throw new Error(`${item.caseId}: visual truth physical page differs from selection lock`);
    if (locked.sourceSha256 && item.sourceSha256?.toLowerCase() !== locked.sourceSha256.toLowerCase())
      throw new Error(`${item.caseId}: visual truth source PDF hash differs from selection lock`);
    if (locked.pageImageSha256 && item.pageImageSha256?.toLowerCase() !== locked.pageImageSha256.toLowerCase())
      throw new Error(`${item.caseId}: visual truth page image hash differs from selection lock`);
    if (locked.fragmentCount !== undefined) {
      const coverage = item.items.filter(entry => entry.kind === 'fragment-coverage');
      if (coverage.length !== 1 || coverage[0].expected?.fragmentCount !== locked.fragmentCount)
        throw new Error(`${item.caseId}: visual truth fragment count differs from selection lock`);
    }
    if (locked.requiredKinds !== undefined) {
      if (!Array.isArray(locked.requiredKinds) || !locked.requiredKinds.length)
        throw new Error(`${item.caseId}: required visual-truth kinds are invalid`);
      for (const kind of locked.requiredKinds)
        if (!item.items.some(entry => entry.kind === kind))
          throw new Error(`${item.caseId}: visual truth missing required ${kind} item`);
    }
    seen.add(item.caseId);
  }
  const missing = [...expected.keys()].filter(caseId => !seen.has(caseId));
  if (missing.length) throw new Error(`Visual truth missing locked pages: ${missing.join(', ')}`);
}

export function validateTruthLock(manifest, truth) {
  if (manifest?.status !== 'locked')
    throw new Error('Replay manifest is not locked');
  if (truth?.status !== 'locked')
    throw new Error('Visual truth is not locked');
  if (!Array.isArray(truth.cases) || !truth.cases.length)
    throw new Error('Locked visual truth has no cases');
  for (const item of truth.cases) {
    if (item.visualReview?.pass1Complete !== true)
      throw new Error(`${item.caseId}: visual pass 1 is incomplete`);
    if (item.visualReview?.pass2Complete !== true)
      throw new Error(`${item.caseId}: visual pass 2 is incomplete`);
  }
}

export async function preflightReplayInputs(manifestPath, cases) {
  const sources = new Map();
  const ids = new Set();
  for (const item of cases) {
    if (!/^[A-Za-z0-9_.-]+$/.test(item.caseId || '') || ids.has(item.caseId))
      throw new Error(`Duplicate or unsafe case ID: ${item.caseId}`);
    ids.add(item.caseId);
    if (!Number.isInteger(item.page) || item.page < 1)
      throw new Error(`${item.caseId}: invalid physical page`);
    const pageImageName = `${path.parse(item.sourcePath).name}-page-${item.page}.png`;
    const imageBytes = await readFile(resolveManifestSourcePath(manifestPath, pageImageName));
    assertSha256(imageBytes, item.pageImageSha256, `${item.caseId} visual page`);
    const bytes = await readFile(resolveManifestSourcePath(manifestPath, item.sourcePath));
    const sourceSha256 = assertSha256(bytes, item.sourceSha256, `${item.caseId} source PDF`);
    sources.set(item.caseId, { bytes, sourceSha256 });
  }
  return sources;
}

async function main(argv) {
  const { manifest: manifestPath, out } = parseArgs(argv);
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (!Array.isArray(manifest.cases) || manifest.cases.length < 1)
    throw new Error('Locked replay manifest has no cases');
  if (manifest.status !== 'locked') throw new Error('Replay manifest is not locked');
  if (!manifest.truthSha256 || !/^[a-f0-9]{64}$/i.test(manifest.truthSha256))
    throw new Error('Visual truth must be hashed and locked before replay');
  if (!manifest.truthPath) throw new Error('Locked visual truth path is missing');
  const truthBytes = await readFile(resolveManifestSourcePath(manifestPath, manifest.truthPath));
  assertSha256(truthBytes, manifest.truthSha256, 'visual truth');
  const truth = JSON.parse(truthBytes.toString('utf8'));
  validateTruthLock(manifest, truth);
  validateTruthCases(manifest.cases, truth.cases);
  let reviewedCases, reviewedArtifactSha256;
  if (Object.hasOwn(manifest, 'reviewedPath') || Object.hasOwn(manifest, 'reviewedSha256')) {
    if (!manifest.reviewedPath || !manifest.reviewedSha256)
      throw new Error('Reviewed replay requires both reviewedPath and reviewedSha256');
    const reviewedBytes = await readFile(resolveManifestSourcePath(manifestPath, manifest.reviewedPath));
    reviewedArtifactSha256 = assertSha256(reviewedBytes, manifest.reviewedSha256, 'reviewed artifact');
    reviewedCases = validateReviewedCases(JSON.parse(reviewedBytes.toString('utf8')), truth.cases, manifest.truthSha256);
  }
  const sources = await preflightReplayInputs(manifestPath, manifest.cases);
  const truthById = new Map(truth.cases.map(item => [item.caseId, item]));
  const codeHash = createHash('sha256');
  for (const relative of [
    '../web_demo/wwwroot/document-layout.mjs',
    '../web_demo/wwwroot/document-structure-proposal.mjs',
    '../web_demo_evaluation/structure-projection.mjs',
    '../web_demo_evaluation/structure-scoring.mjs',
    './structure-replay.mjs'
  ]) {
    codeHash.update(relative).update('\0').update(await readFile(new URL(relative, import.meta.url))).update('\0');
  }
  const candidateCodeSha256 = codeHash.digest('hex');
  const pdfjs = await import('../web_demo_client/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const caseReports = [];
  for (const item of manifest.cases) {
    const { bytes, sourceSha256 } = sources.get(item.caseId);
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    try {
      const pdf = await task.promise;
      if (item.page > pdf.numPages) throw new Error(`${item.caseId}: selected page exceeds PDF`);
      const page = await pdf.getPage(item.page);
      const content = await page.getTextContent();
      const sourceItems = content.items.filter(fragment => fragment.str?.trim());
      const viewport = page.getViewport({ scale: sourceItems.length ? 1.25 : 3 });
      const fragments = sourceItems.map(fragment => {
        const transform = pdfjs.Util.transform(viewport.transform, fragment.transform);
        const height = Math.hypot(transform[2], transform[3]);
        return { text: fragment.str, x: transform[4], y: transform[5] - height,
          width: fragment.width * viewport.scale, height };
      });
      const operators = await page.getOperatorList();
      const imageIds = ['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject',
        'paintImageXObjectRepeat', 'paintImageMaskXObjectRepeat'].map(name => pdfjs.OPS[name]);
      const hasImages = operators.fnArray.some(operator => imageIds.includes(operator));
      const arms = summarizeExtractedPage({ pageIndex: 0, width: Math.ceil(viewport.width),
        height: Math.ceil(viewport.height), fragments, hasImages, ocrText: '' });
      const reviewedArtifact = reviewedCases?.get(item.caseId);
      const scores = scoreCandidateArms({ truth: truthById.get(item.caseId), candidate: arms, reviewedArtifact });
      caseReports.push(scores);
      const result = { caseId: item.caseId, sourceSha256, physicalPage: item.page,
        truthSha256: manifest.truthSha256, candidateCodeSha256,
        width: viewport.width, height: viewport.height,
        hasImages, sourceFragments: fragments, ...arms,
        ...(reviewedCases ? { reviewedArtifact, reviewedArtifactSha256 } : {}) };
      await mkdir(out, { recursive: true });
      await writeFile(path.join(out, `${item.caseId}.raw.json`), JSON.stringify(result, null, 2));
      await writeFile(path.join(out, `${item.caseId}.scores.json`), JSON.stringify({
        ...scores, truthSha256: manifest.truthSha256, candidateCodeSha256,
        ...(reviewedCases ? { reviewedArtifactSha256 } : {})
      }, null, 2));
      process.stdout.write(`${item.caseId}: ${fragments.length} fragments, ${arms.graph.regions.length} proposed regions\n`);
    } finally {
      await task.destroy().catch(() => {});
    }
  }
  const summary = aggregateCandidateReports(caseReports);
  await writeFile(path.join(out, 'summary.scores.json'), JSON.stringify({
    ...summary, truthSha256: manifest.truthSha256, candidateCodeSha256,
    physicalPageCount: manifest.cases.length,
    reviewedArmStatus: reviewedCases ? 'scored-not-source-certified' : 'not-yet-scored',
    ...(reviewedCases ? { reviewedArtifactSha256 } : {})
  }, null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
