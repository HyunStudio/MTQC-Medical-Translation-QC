import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const recorder = readFileSync(new URL('src/web_demo_browser_tests/record_professional.mjs', root), 'utf8');
const composer = readFileSync(new URL('scripts/compose_professional_video.py', root), 'utf8');
const storyboard = JSON.parse(readFileSync(new URL('docs/web-demo/video-storyboard.json', root), 'utf8'));

test('new video requires two genuine completed model stages and a bounded attempt ledger', () => {
  assert.match(recorder, /DEMO_LIVE_TOTAL_ATTEMPTS: '2'/);
  assert.match(recorder, /translationStage\?\.state !== 'completed'/);
  assert.match(recorder, /critiqueStage\?\.state !== 'completed'/);
  assert.match(recorder, /rulesStage\?\.state !== 'completed'/);
  assert.match(recorder, /await scene\(2,[\s\S]*?\}, async \(page, config, until, elapsed\) =>/,
    'live scene has no elapsed-time callback for its adaptive timeline');
  assert.match(recorder, /firstReviewAt = Math\.max\(36, elapsed\(\) \+ 2\)/);
  assert.doesNotMatch(recorder, /providerCalls: 1|\<span class="num"\>46\<\/span\>/);
});

test('new video narration describes the negative pilot and stays under three minutes by minimum durations', () => {
  assert(storyboard.flatMap(scene => scene.sentences).some(line => /did not show extra error detection/.test(line)));
  assert(storyboard.reduce((seconds, scene) => seconds + scene.minimumSeconds, 0) < 180);
  assert.equal(storyboard.find(scene => scene.id === '03-document').minimumSeconds, 70);
  assert.match(composer, /scene\.get\('videoSpeed', 1\)/);
  assert.match(composer, /setpts=\(PTS-STARTPTS\)\/\{speed\}/);
});
