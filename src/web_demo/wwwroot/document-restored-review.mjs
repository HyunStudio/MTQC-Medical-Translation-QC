const copyDocx = value => {
  if (!(value instanceof Uint8Array) || !value.length || value.length > 10 * 1024 * 1024)
    throw Error('A nonempty DOCX within 10 MiB is required.');
  return value.slice();
};

// Reserve both selections before awaiting figure decoding. The caller's source
// generation decides whether this handoff still owns the editor afterwards.
export async function handoffRestoredReview({bytes, originalBytes, load, audit, current, selectPair}) {
  const original = copyDocx(originalBytes), restored = copyDocx(bytes);
  let installed = false;
  const reservePair = () => {
    if (installed || !current()) return;
    selectPair(original.slice(), restored.slice()); installed = true;
  };
  // A DOCX loader may expose its layout controls before figure decoding ends.
  // Reserve there once, so a later manual draft choice is never overwritten.
  await Promise.all([load(restored.slice(), reservePair), audit(restored.slice())]);
  if (!current()) return false;
  if (!installed) reservePair();
  return true;
}
