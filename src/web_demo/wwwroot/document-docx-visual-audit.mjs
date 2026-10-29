const languages = new Set(['ko','es','ar','zh-CN','zh-TW','ja','fr','de','it','pt','ru','hi','id','nl','pl','th','tr','vi']);
const maxDraft = 10 * 1024 * 1024;
const api = '/api/local/docx/visual';

function element(tag, text, attributes = {}) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}
async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
function base64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
async function jsonResponse(response) {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Local audit request held (${response.status}).`);
  return value;
}

// This section owns a copy of one explicitly selected saved or generated draft.
export function mountDocxVisualAudit({ host, targetLanguage, languageElement }) {
  host.id = 'document-docx-visual-audit';
  host.classList.add('document-local-tool');
  host.replaceChildren();
  const title = element('h3', 'DOCX draft · embedded visual-text audit');
  const limits = element('p', 'Read-only audit of finite source-language visual text in embedded images and known drawing XML. Image coordinates only. OCR does not verify math semantics, translation completion, page positions or full rendered Word layout. Existing source-language policy is asymmetric. No automatic translation or apply.');
  const label = element('label', 'Choose a draft DOCX, or use the restored draft above ');
  const picker = element('input', undefined, {type:'file', accept:'.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'data-visual-role':'draft'});
  label.append(picker);
  const scan = element('button', 'Audit saved draft', {type:'button', 'data-visual-action':'scan'});
  const report = element('button', 'Download bound audit JSON', {type:'button', 'data-visual-action':'report'});
  const clear = element('button', 'Clear saved draft', {type:'button', 'data-visual-action':'clear'});
  const status = element('p', 'Checking local audit availability…', {'data-visual-role':'status', role:'status', 'aria-live':'polite'});
  const result = element('div', undefined, {'data-visual-role':'result'});
  status.dataset.state = 'idle'; scan.disabled = true; report.disabled = true;
  host.append(title, limits, label, scan, report, clear, status, result);
  if (!['localhost','127.0.0.1','[::1]'].includes(location.hostname)) {
    host.hidden = true; picker.disabled = true; clear.disabled = true;
    return {clear() {}, async setDraft() {}};
  }
  host.hidden = false;
  let epoch = 0, draft = null, bound = null, running = false, available = false;
  const language = () => typeof targetLanguage === 'function' ? targetLanguage() : targetLanguage;
  const controls = () => {
    scan.disabled = !available || !draft || running || !languages.has(language());
    report.disabled = !bound || running;
  };
  function invalidate(message, clearPicker = false) {
    ++epoch; draft = null; bound = null; running = false; result.replaceChildren();
    if (clearPicker) picker.value = '';
    status.dataset.state = 'idle'; status.textContent = message; controls();
  }
  async function availability() {
    try {
      const value = await jsonResponse(await fetch(`${api}/status`, {credentials:'same-origin', cache:'no-store'}));
      available = value.available === true;
      if (!draft && !running) status.textContent = value.message || 'Select a saved draft for an explicit audit.';
    } catch (error) {
      available = false;
      if (!running) status.textContent = String(error.message || error);
    }
    controls();
  }
  void availability();
  async function selectDraft(file, bytesInput) {
    invalidate('Reading the chosen DOCX draft…'); // Invalidate before either Promise.
    const ticket = epoch;
    if (!file) { status.textContent = 'Choose a saved draft DOCX.'; return; }
    if (!file.name.toLowerCase().endsWith('.docx') || file.size <= 0 || file.size > maxDraft) {
      status.textContent = 'Choose a saved DOCX of at most 10 MiB.'; return;
    }
    try {
      const bytes = bytesInput || new Uint8Array(await file.arrayBuffer());
      if (ticket !== epoch) return;
      if (bytes.length <= 0 || bytes.length > maxDraft) throw new Error('Saved draft exceeds the local limit.');
      const hash = await sha256(bytes);
      if (ticket !== epoch) return;
      draft = {bytes, hash};
      status.textContent = `${file.name} selected. Click Audit saved draft to start.`;
      controls();
    } catch (error) {
      if (ticket !== epoch) return;
      status.textContent = String(error.message || error); controls();
    }
  }
  picker.addEventListener('change', () => { void selectDraft(picker.files?.[0]); });
  languageElement?.addEventListener('change', () => {
    // The saved bytes can be reused, but an admitted result can never cross a language change.
    const previous = draft;
    invalidate('Target language changed. Click Audit saved draft for a new explicit audit.');
    draft = previous; controls();
  });
  clear.addEventListener('click', () => invalidate('Saved draft cleared.', true));

  function isBound(view, captured) {
    return view && view.id === captured.id && view.draftSha256?.toLowerCase() === captured.hash &&
      view.targetLanguage === captured.target;
  }
  function render(view) {
    result.replaceChildren();
    result.append(element('p', `Engine status: ${view.engineStatus || 'unavailable'} · exit: ${view.exitCode ?? 'unknown'} · capability: ${view.capability || 'unknown'}`));
    result.append(element('p', `Embedded media: ${view.embeddedMediaCount ?? 0}; review items: ${view.reviewItemCount ?? 0}; OCR evidence: ${view.ocrEvidenceCount ?? 0}; NO_TEXT_DETECTED: ${view.noTextDetectedCount ?? 0}; unsupported media: ${view.unsupportedMediaCount ?? 0}.`));
    if (view.noTextDetectedCount > 0)
      result.append(element('p', 'NO_TEXT_DETECTED is an OCR limitation. It does not verify that an image contains no text.'));
    for (const warning of view.warnings || []) result.append(element('p', String(warning)));
    for (const finding of view.findings || []) {
      const item = element('div');
      item.append(element('p', String(finding.text ?? '')));
      item.append(element('p', `${finding.part ?? ''} · ${finding.locator ?? ''} · ${finding.reason ?? ''}`));
      if ([finding.x, finding.y, finding.width, finding.height].every(Number.isFinite))
        item.append(element('p', `Embedded image pixels: x=${finding.x}, y=${finding.y}, width=${finding.width}, height=${finding.height}.`));
      result.append(item);
    }
  }
  scan.addEventListener('click', async () => {
    if (scan.disabled || !draft) return;
    const bytes = draft.bytes.slice(), chosenTarget = language(), expectedHash = draft.hash;
    const ticket = ++epoch; // Explicit starts have their own immutable snapshot and epoch.
    bound = null; running = true; result.replaceChildren(); status.dataset.state = 'running';
    status.textContent = 'Binding and submitting the selected saved draft…'; controls();
    try {
      if (!languages.has(chosenTarget)) throw new Error('Choose a supported target language.');
      const hash = await sha256(bytes);
      if (ticket !== epoch) return;
      if (hash !== expectedHash) throw new Error('Saved draft binding changed.');
      const accepted = await jsonResponse(await fetch(`${api}/jobs`, {
        method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({savedDraftBase64:base64(bytes), draftSha256:hash, targetLanguage:chosenTarget})
      }));
      if (ticket !== epoch) return;
      const captured = {id:accepted.id, hash, target:chosenTarget};
      if (typeof captured.id !== 'string' || !isBound(accepted, captured)) throw new Error('Admitted job binding differs.');
      let view = accepted;
      while (view.state === 'running') {
        status.textContent = 'Owned audit running. Changing this selection hides its result; the server continues observing it.';
        await new Promise(resolve => setTimeout(resolve, 250));
        if (ticket !== epoch) return;
        view = await jsonResponse(await fetch(`${api}/jobs/${encodeURIComponent(captured.id)}`, {credentials:'same-origin', cache:'no-store'}));
        if (ticket !== epoch) return;
        if (!isBound(view, captured)) throw new Error('Audit result binding differs.');
      }
      if (!['completed','held'].includes(view.state)) throw new Error('Unknown audit state.');
      render(view); running = false; status.dataset.state = view.state;
      status.textContent = view.state === 'completed' ? 'Limited visual audit completed. Review findings and scope limits.' : 'Visual audit held. Review the diagnostic and scope limits.';
      if (/^[0-9a-f]{64}$/.test(view.reportSha256 || '')) bound = {...captured, reportSha256:view.reportSha256};
      controls();
    } catch (error) {
      if (ticket !== epoch) return;
      running = false; bound = null; status.dataset.state = 'held'; status.textContent = String(error.message || error); controls();
    }
  });
  report.addEventListener('click', async () => {
    if (report.disabled || !bound) return;
    const captured = {...bound}, ticket = epoch;
    report.disabled = true;
    try {
      const response = await fetch(`${api}/jobs/${encodeURIComponent(captured.id)}/report`, {credentials:'same-origin', cache:'no-store'});
      if (!response.ok) throw new Error(`Bound report unavailable (${response.status}).`);
      const bytes = await response.arrayBuffer();
      if (ticket !== epoch) return;
      const hash = await sha256(bytes);
      if (ticket !== epoch) return;
      if (hash !== captured.reportSha256) throw new Error('Downloaded report SHA-256 differs from the terminal binding.');
      const url = URL.createObjectURL(new Blob([bytes], {type:'application/json'}));
      const link = element('a', 'Download audit JSON', {href:url, download:'mtqc-visual-audit-report.json'});
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (ticket !== epoch) return;
      status.textContent = String(error.message || error);
    } finally { if (ticket === epoch) controls(); }
  });
  return {
    clear() { invalidate('Saved draft cleared.', true); },
    async setDraft(input, name = 'mtqc-working-draft.docx') {
      // Capture mutable callers before hashing; this does not submit an audit.
      picker.value = '';
      if (!(input instanceof Uint8Array)) { invalidate('Choose valid DOCX draft bytes.', true); return; }
      const bytes = input.slice();
      await selectDraft({name, size: bytes.length}, bytes);
    }
  };
}
