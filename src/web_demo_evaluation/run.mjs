import { readFile, writeFile } from 'node:fs/promises';
import { evaluateRuns } from './evaluator.mjs';

if (process.argv.length !== 6) {
  console.error('Usage: node run.mjs cases.json runs.json gold.json report.json');
  process.exit(2);
}
const [, , casesPath, runsPath, goldPath, reportPath] = process.argv;
const casesFile = JSON.parse(await readFile(casesPath, 'utf8'));
const runsFile = JSON.parse(await readFile(runsPath, 'utf8'));
const goldFile = JSON.parse(await readFile(goldPath, 'utf8'));
const report = evaluateRuns(casesFile.cases, runsFile.runs, goldFile.gold);
await writeFile(reportPath, JSON.stringify({
  generatedUtc: new Date().toISOString(),
  corpusVersion: casesFile.version,
  runSet: runsFile.runSet,
  ...report
}, null, 2) + '\n', { flag: 'wx' });
console.log(`${report.sampleCount} paired runs; seeded ${report.seededCount}; controls ${report.controlCount}`);
console.log(`baseline TP/FN ${report.baseline.truePositive}/${report.baseline.falseNegative}; enhanced TP/FN ${report.enhanced.truePositive}/${report.enhanced.falseNegative}`);
console.log(`Report: ${reportPath}`);
