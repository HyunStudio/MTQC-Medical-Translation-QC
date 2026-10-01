import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const project = new URL('../../', import.meta.url);
const release = readFileSync(new URL('scripts/web_demo_release.ps1', project), 'utf8');
const workflowPath = new URL('docs/web-demo/public-source-workflows/mtqc.yml', project);

test('scoped export includes evaluator and a public CI workflow', () => {
  assert(existsSync(workflowPath), 'public workflow template missing');
  assert.match(release, /src\/web_demo_evaluation/, 'evaluation source is omitted from public export');
  assert.match(release, /public-source-workflows\/mtqc\.yml/, 'workflow is not copied into the public export');
});

test('public workflow exercises both OSes without a live secret', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /MedicalQcWebDemoTests\.csproj/);
  assert.match(workflow, /src\/web_demo_evaluation/);
  assert.match(workflow, /src\/web_demo_browser_tests/);
  assert.match(workflow, /DEMO_LIVE_ENABLED:\s*['"]?false/);
  assert.doesNotMatch(workflow, /secrets\.|NEBIUS_API_KEY/);
});
