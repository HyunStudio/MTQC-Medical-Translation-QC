import test from 'node:test';
import assert from 'node:assert/strict';

async function withStatus(action) {
  const original = globalThis.fetch;
  const api = await import(`../web_demo/wwwroot/live-availability.mjs?test=${Math.random()}`);
  const states = [];
  const unsubscribe = api.subscribeLiveAvailability(state => states.push(state));
  try { await action(api, states); }
  finally { unsubscribe(); globalThis.fetch = original; }
}

test('a newer billing hold wins over a late earlier available response', async () => {
  await withStatus(async (api, states) => {
    const responses = [];
    globalThis.fetch = () => new Promise(resolve => responses.push(resolve));
    const older = api.refreshLiveAvailability();
    const newer = api.refreshLiveAvailability();
    responses[1](Response.json({ available: false, reason: 'Billing pending' }));
    await newer;
    responses[0](Response.json({ available: true, reason: 'Old admission' }));
    await older;
    assert.deepEqual(states.at(-1), { available: false, reason: 'Billing pending' });
  });
});

test('status checking immediately withholds a previously available action', async () => {
  await withStatus(async (api, states) => {
    globalThis.fetch = async () => Response.json({ available: true, reason: 'Ready' });
    await api.refreshLiveAvailability();
    assert.equal(states.at(-1).available, true);
    let finish;
    globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
    const pending = api.refreshLiveAvailability();
    assert.equal(states.at(-1).available, false);
    finish(Response.json({ available: false, reason: 'Paused' }));
    await pending;
  });
});

test('HTTP errors and malformed status never enable inference or retry', async () => {
  await withStatus(async (api, states) => {
    for (const response of [new Response('{}', { status: 503 }), Response.json({ available: 'true', reason: 'Wrong type' }), Response.json({ available: true }), Response.json({ available: true, reason: ' ' })]) {
      let requests = 0;
      globalThis.fetch = async (url, options) => {
        requests++;
        assert.equal(url, '/api/live/status');
        assert.equal(options.cache, 'no-store');
        return response;
      };
      await api.refreshLiveAvailability();
      assert.equal(states.at(-1).available, false);
      assert.match(states.at(-1).reason, /Saved examples/);
      assert.equal(requests, 1);
    }
  });
});

test('connection failure is held without retry and recovers on an explicit refresh', async () => {
  await withStatus(async (api, states) => {
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new TypeError('offline'); };
    await api.refreshLiveAvailability();
    assert.equal(states.at(-1).available, false);
    assert.equal(requests, 1);
    globalThis.fetch = async () => Response.json({ available: true, reason: 'Reconciled' });
    await api.refreshLiveAvailability();
    assert.equal(states.at(-1).available, true);
  });
});
