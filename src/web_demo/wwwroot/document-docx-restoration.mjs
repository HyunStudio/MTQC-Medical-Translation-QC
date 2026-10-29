const local = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
const encode = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(s); };
const decode = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

export function mountDocxRestoration({host, onUse}) {
  host.hidden = true;
  const heading = document.createElement('h3'); heading.textContent = 'Restore source equations, structure and layout';
  const limits = document.createElement('p'); limits.textContent = 'Choose a saved translation of this original DOCX. Restore original native equations, reading order, formatting and layout settings while keeping corresponding translated text and draft images. Missing paragraphs with retained document identity are restored from the original and still need translation review. Ambiguous document pairs are held. Review Word rendering and image OCR before publication.';
  const label = document.createElement('label'); label.textContent = 'Saved translated DOCX ';
  const picker = document.createElement('input'); picker.type = 'file'; picker.accept = '.docx'; picker.dataset.restorationRole = 'draft'; label.append(picker);
  const restore = document.createElement('button'); restore.type = 'button'; restore.textContent = 'Restore from this original'; restore.disabled = true; restore.dataset.restorationAction = 'restore';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.dataset.restorationRole = 'status';
  const provenance = document.createElement('ul'); provenance.dataset.restorationRole = 'restored-source';
  const download = document.createElement('button'); download.type = 'button'; download.textContent = 'Download restored DOCX'; download.disabled = true; download.dataset.restorationAction = 'download';
  const report = document.createElement('button'); report.type = 'button'; report.textContent = 'Download restoration report'; report.disabled = true; report.dataset.restorationAction = 'report';
  const use = document.createElement('button'); use.type = 'button'; use.textContent = 'Use restored draft for editing'; use.disabled = true; use.dataset.restorationAction = 'use';
  const useNote = document.createElement('p'); useNote.textContent = 'Using this draft replaces current working edits and selects it for Word review and an explicit OCR audit. The original remains the Word review reference. Neither review starts automatically.';
  host.append(heading, limits, label, restore, status, provenance, download, report, use, useNote);
  let epoch = 0, source = null, draft = null, available = false, busy = false, result = null;
  const reset = () => { result = null; provenance.replaceChildren(); download.disabled = report.disabled = use.disabled = true; };
  const ready = () => { restore.disabled = !(local() && available && source && draft && !busy); use.disabled = !(local() && result && !busy && typeof onUse === 'function'); };
  const request = async (path, options) => { if (!local()) throw Error('Use the explicit local MTQC app.'); const response = await fetch(path, options); if (!response.ok) { let message = `Restoration held (${response.status}).`; try { message = (await response.json()).error || message; } catch {} throw Error(message); } return response; };
  picker.addEventListener('change', async () => {
    const token = ++epoch; draft = null; busy = false; reset(); ready(); status.textContent = '';
    const file = picker.files?.[0]; if (!file || !source || !local()) return;
    if (!file.name.toLowerCase().endsWith('.docx') || file.size > 10 * 1024 * 1024) { status.textContent = 'Choose a DOCX within 10 MiB.'; return; }
    try { const bytes = new Uint8Array(await file.arrayBuffer()); if (token === epoch) { draft = bytes; ready(); } }
    catch (error) { if (token === epoch) status.textContent = error.message; }
  });
  restore.addEventListener('click', async () => {
    if (restore.disabled) return;
    const token = ++epoch, original = source.slice(), translation = draft.slice(); busy = true; reset(); ready(); status.textContent = 'Restoring from the selected original…';
    try {
      const [sourceSha256, draftSha256] = await Promise.all([hash(original), hash(translation)]);
      if (token !== epoch) return;
      const response = await request('/api/local/docx/restoration/restore', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({sourceBase64: encode(original), draftBase64: encode(translation), sourceSha256, draftSha256})});
      const value = await response.json(); if (token !== epoch) return;
      const bytes = decode(value.documentBase64);
      if (value.report.sourceSha256 !== sourceSha256 || value.report.draftSha256 !== draftSha256 || value.report.outputSha256 !== await hash(bytes)) throw Error('Restoration document binding changed.');
      if (token !== epoch) return;
      result = {bytes, original: original.slice(), report: value.report}; download.disabled = report.disabled = false;
      status.textContent = `Source structure restored with ${value.report.nativeEquations} native equation(s); ${value.report.preservedMedia} draft image file(s) retained. Word rendering, overflow and OCR still require review.`;
      if (value.report.restoredParagraphs > 0) status.textContent += ` ${value.report.restoredParagraphs} missing source paragraph(s) restored with original text, not translated. Translation review required.`;
      for (const item of value.report.restoredSourceParagraphs || []) {
        const row = document.createElement('li'); row.textContent = `${item.part} · ${item.paragraphId}: ${item.sourceTextPreview || '[No ordinary source text]'} — restored source; translation review required.`; provenance.append(row);
      }
    } catch (error) { if (token === epoch) status.textContent = error.message; }
    finally { if (token === epoch) { busy = false; ready(); } }
  });
  const save = (bytes, type, name) => { const url = URL.createObjectURL(new Blob([bytes], {type})); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  download.addEventListener('click', () => { if (result && local()) save(result.bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'mtqc-source-restored-draft.docx'); });
  report.addEventListener('click', () => { if (result && local()) save(JSON.stringify(result.report, null, 2), 'application/json', 'mtqc-source-restoration-report.json'); });
  use.addEventListener('click', async () => {
    if (use.disabled || !result) return;
    const token = epoch, bytes = result.bytes.slice(), context = {sourceBytes: result.original.slice(), sourceSha256: result.report.sourceSha256, outputSha256: result.report.outputSha256}; busy = true; ready();
    try { await onUse(bytes, context); }
    catch (error) { if (token === epoch) status.textContent = error.message; }
    finally { if (token === epoch) { busy = false; ready(); } }
  });
  return {
    clear() { epoch++; source = draft = null; available = busy = false; picker.value = ''; reset(); status.textContent = ''; host.hidden = true; ready(); },
    setFile(bytes) { this.clear(); source = new Uint8Array(bytes); const token = epoch; if (!local()) return; request('/api/local/docx/restoration/status').then(r => r.json()).then(value => { if (token === epoch) { available = value.available === true; host.hidden = !available; ready(); } }).catch(() => {}); }
  };
}
