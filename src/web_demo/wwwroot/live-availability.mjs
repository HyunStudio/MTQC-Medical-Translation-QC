const listeners = new Set();
let state = { available: false, reason: 'Checking live availability…' };
let revision = 0;

export function subscribeLiveAvailability(listener) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

function publish(next) {
  state = Object.freeze(next);
  for (const listener of listeners) listener(state);
}

// Status GETs never dispatch inference or retry a failed model request.
export async function refreshLiveAvailability() {
  const current = ++revision;
  publish({ available: false, reason: 'Checking live availability…' });
  let next;
  try {
    const response = await fetch('/api/live/status', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Status unavailable');
    const status = await response.json();
    if (typeof status?.available !== 'boolean' || typeof status.reason !== 'string' || !status.reason.trim())
      throw new Error('Invalid status');
    next = { available: status.available, reason: status.reason };
  } catch {
    next = { available: false, reason: 'Live availability could not be confirmed. Saved examples remain available without a model call.' };
  }
  if (current === revision) publish(next);
}
