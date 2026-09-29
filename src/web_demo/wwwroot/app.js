const $ = (selector) => document.querySelector(selector);
const languageNames = { ko: 'Korean', es: 'Spanish', ar: 'Arabic', 'zh-CN': 'Chinese (Simplified)', 'zh-TW': 'Chinese (Traditional)', ja: 'Japanese', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian', hi: 'Hindi', id: 'Indonesian', nl: 'Dutch', pl: 'Polish', th: 'Thai', tr: 'Turkish', vi: 'Vietnamese' };
const root = document.documentElement;
const themeButton = $('#theme-toggle');
const storedTheme = localStorage.getItem('medical-qc-theme');
root.dataset.theme = storedTheme === 'light' || storedTheme === 'dark'
  ? storedTheme
  : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
themeButton.setAttribute('aria-label', `Switch to ${root.dataset.theme === 'dark' ? 'light' : 'dark'} theme`);
themeButton.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('medical-qc-theme', root.dataset.theme);
  themeButton.setAttribute('aria-label', `Switch to ${root.dataset.theme === 'dark' ? 'light' : 'dark'} theme`);
});

let demoCase;
let liveAvailable = false;
let liveRequestId = 0;
let liveController = null;
let livePending = false;
let liveElapsedTimer = null;
let liveStartedAt = 0;
let preferredLanguage = new URLSearchParams(location.search).get('lang');
const caseSelect = $('#case-select');
const languageSelect = $('#language-select');
languageSelect.disabled = true;
languageSelect.addEventListener('change', () => {
  preferredLanguage = languageSelect.value;
  clearLiveResult();
  renderTranslation(languageSelect.value);
});
caseSelect.addEventListener('change', () => {
  clearLiveResult();
  demoCase = null;
  languageSelect.disabled = true;
  updateLiveAvailability();
  loadCase(caseSelect.value);
});

fetch('/api/cases')
  .then(response => {
    if (!response.ok) throw new Error('Recorded cases could not be listed.');
    return response.json();
  })
  .then(cases => {
    caseSelect.replaceChildren(...cases.map(item => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.title;
      return option;
    }));
    const requested = new URLSearchParams(location.search).get('case');
    caseSelect.value = requested && cases.some(item => item.id === requested) ? requested : 'servier-visual';
    return loadCase(caseSelect.value);
  })
  .catch(showCaseError);

function loadCase(id) {
  return fetch(`/api/cases/${encodeURIComponent(id)}`)
    .then(response => {
      if (!response.ok) throw new Error('Recorded case could not be loaded.');
      return response.json();
    })
    .then(data => {
    if (caseSelect.value !== id) return;
    demoCase = data;
    languageSelect.disabled = false;
    const isPaper = data.id === 'mueller-figure1';
    $('#workflow-prepared').textContent = isPaper ? 'Figure 1 draft prepared' : '18 target slides prepared';
    $('#workflow-qc').textContent = isPaper ? 'Figure-layout checks recorded' : 'Visible-text and layout checks recorded';
    $('#workflow-review').textContent = isPaper ? 'Full-paper and medical review pending' : 'Medical review pending';
    $('#scope-note').textContent = data.scope;
    $('#format-title').textContent = isPaper ? 'Medical article figure' : 'Anatomical chart';
    $('#format-sub').textContent = isPaper ? 'Two-column source · anatomy' : 'Editable PowerPoint · eye anatomy';
    $('#case-count').textContent = isPaper ? '3 draft previews' : '18 target decks';
    $('#case-languages').textContent = isPaper ? 'Korean · Spanish · Arabic' : 'Real slides and editable files';
    $('#quality-title').textContent = isPaper ? 'Visual QA passed' : 'Structure verified';
    $('#source-type').textContent = isPaper ? 'PDF / PAGE 04' : 'PPTX / SLIDE 01';
    $('#target-type').textContent = isPaper ? 'DRAFT / FIGURE 01' : 'DRAFT / SLIDE 01';
    $('#source-caption').textContent = isPaper ? 'Publisher source · unchanged English body' : 'Servier Medical Art · original chart';
    $('#target-caption').textContent = isPaper ? 'Figure title, caption & labels only' : 'Translated title, overview & labels';
    $('#download-description').textContent = isPaper ? 'Three-page PDF · source and translations side by side' : 'Editable translated PowerPoint slide';
    $('#download-heading').textContent = isPaper ? 'Open comparison PDF' : 'Open translated PPTX';
    $('#gate-visual-detail').textContent = isPaper ? 'Three comparison pages reviewed for clipping and overlap' : 'Native PowerPoint renderings reviewed across the batch';
    $('#gate-complete-title').textContent = isPaper ? 'Full-paper completeness' : 'Visible-text coverage';
    $('#gate-complete-detail').textContent = isPaper ? 'Two-column English body is not translated in this specimen' : 'All 14 visible strings accounted for in this slide';
    $('#gate-complete-icon').className = isPaper ? 'gate-icon blocked' : 'gate-icon passed';
    $('#gate-complete-icon').textContent = isPaper ? '×' : '✓';
    $('#gate-complete-state').className = isPaper ? 'gate-state blocked-text' : 'gate-state passed-text';
    $('#gate-complete-state').textContent = isPaper ? 'Blocked' : 'Passed';
    $('#source-preview').src = data.source.preview;
    $('#source-full-link').href = data.source.preview;
    $('#source-preview').alt = isPaper ? 'Original article page containing Figure 1' : 'Original Servier Medical Art visual-system chart';
    $('#source-citation').textContent = data.source.citation;
    $('#source-link').href = data.source.url;
    $('#source-license').textContent = data.source.license;
    $('#source-modifications').textContent = data.source.modifications;
    $('#generator-note').textContent = `${data.generator}. No clinical terminology review has been completed.`;
    $('#case-date').textContent = `Prepared ${new Date(data.generatedUtc).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
    renderSections($('#source-sections'), data.source.sections, 'source', 'en');
    languageSelect.replaceChildren(...data.translations.map(translation => {
      const option = document.createElement('option');
      option.value = translation.language;
      option.textContent = languageNames[translation.language] || translation.language;
      return option;
    }));
    if (preferredLanguage && data.translations.some(item => item.language === preferredLanguage)) languageSelect.value = preferredLanguage;
    renderTranslation(languageSelect.value);
    updateLiveAvailability();
  })
  .catch(showCaseError);
}

function showCaseError(error) {
  $('#case-error').textContent = error.message;
  $('#case-error').hidden = false;
}

function renderTranslation(language) {
  const translation = demoCase.translations.find(item => item.language === language);
  if (!translation) return;
  $('#target-code').textContent = language.toUpperCase();
  $('#target-preview').src = translation.preview;
  $('#target-full-link').href = translation.preview;
  $('#target-preview').alt = `${languageNames[language] || language} recorded translation preview`;
  $('#download-link').href = translation.download;
  renderSections($('#target-sections'), translation.sections, 'target', language);
  const list = $('#finding-list');
  list.replaceChildren(...translation.findings.map(finding => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'finding-button';
    button.setAttribute('aria-label', `Locate ${finding.title} in source and translation`);
    const indicator = document.createElement('span');
    indicator.className = `finding-indicator ${finding.status === 'passed' ? 'passed' : ''}`;
    indicator.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = `${finding.title} · ${finding.status === 'passed' ? 'Passed' : finding.status === 'blocked' ? 'Blocked' : 'Needs review'}`;
    const detail = document.createElement('small');
    detail.textContent = finding.basis;
    copy.append(title, detail);
    const arrow = document.createElement('span');
    arrow.className = 'finding-arrow';
    arrow.textContent = '↗';
    arrow.setAttribute('aria-hidden', 'true');
    button.append(indicator, copy, arrow);
    button.addEventListener('click', () => locateFinding(finding));
    return button;
  }));
}

function renderSections(host, sections, prefix, language) {
  host.replaceChildren(...sections.map(section => {
    const item = document.createElement('section');
    item.className = 'text-section';
    item.id = `${prefix}-${section.id}`;
    if (language === 'ar') item.dir = 'rtl';
    const label = document.createElement('strong');
    label.textContent = section.label;
    const text = document.createElement('p');
    text.lang = language;
    text.textContent = section.text;
    item.append(label, text);
    return item;
  }));
}

function locateFinding(finding) {
  document.querySelectorAll('.text-section.highlighted').forEach(item => item.classList.remove('highlighted'));
  const source = document.getElementById(`source-${finding.sourceSection}`);
  const target = document.getElementById(`target-${finding.targetSection}`);
  for (const item of [source, target]) if (item) item.classList.add('highlighted');
  document.getElementById('workbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
  source?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

const liveButton = $('#live-run');
fetch('/api/live/status')
  .then(response => response.json())
  .then(status => {
    liveAvailable = status.available;
    if (!status.available) $('#live-status').textContent = status.reason;
    updateLiveAvailability();
  })
  .catch(() => { $('#live-status').textContent = 'Live excerpt status is unavailable; the recorded case still works.'; });

liveButton.addEventListener('click', async () => {
  if (!demoCase) return;
  const requestId = ++liveRequestId;
  const caseId = demoCase.id;
  const language = languageSelect.value;
  let completed = false;
  liveController = new AbortController();
  livePending = true;
  startLiveProgress();
  updateLiveAvailability();
  const output = $('#live-result');
  output.hidden = false;
  output.replaceChildren();
  const pending = document.createElement('p');
  pending.textContent = 'Requesting one fixed caption excerpt…';
  output.append(pending);
  try {
    const response = await fetch('/api/live/excerpt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId, targetLanguage: language }),
      signal: liveController.signal
    });
    const result = await response.json();
    if (requestId !== liveRequestId || demoCase?.id !== caseId || languageSelect.value !== language) return;
    output.replaceChildren();
    output.dir = result.status === 'ok' && language === 'ar' ? 'rtl' : 'ltr';
    const title = document.createElement('strong');
    title.textContent = result.status === 'ok' ? 'Live model excerpt · unreviewed' : 'Live excerpt unavailable';
    const message = document.createElement('p');
    message.textContent = result.status === 'ok' ? result.translation : result.message;
    output.append(title, message);
    if (result.status === 'ok') {
      completed = true;
      const meta = document.createElement('small');
      meta.textContent = `${result.model} · ${result.promptTokens ?? '?'} input tokens · ${result.completionTokens ?? '?'} output tokens. ${result.qcSummary}`;
      output.append(meta);
    }
  } catch {
    if (requestId !== liveRequestId) return;
    output.replaceChildren();
    const message = document.createElement('p');
    message.textContent = 'The live request could not complete. The recorded case remains available.';
    output.append(message);
  } finally {
    if (requestId === liveRequestId) {
      if (completed) completeLiveProgress();
      else stopLiveProgress();
      liveController = null;
      livePending = false;
      updateLiveAvailability();
    }
  }
});

function clearLiveResult() {
  liveRequestId++;
  stopLiveProgress();
  liveController?.abort();
  liveController = null;
  livePending = false;
  const output = $('#live-result');
  output.hidden = true;
  output.dir = 'ltr';
  output.replaceChildren();
  updateLiveAvailability();
}

function startLiveProgress() {
  stopLiveProgress();
  const panel = $('#live-progress');
  liveStartedAt = performance.now();
  panel.hidden = false;
  $('#live-progress-title').textContent = 'Model request in progress';
  const updateElapsed = () => {
    const elapsed = performance.now() - liveStartedAt;
    const seconds = Math.floor(elapsed / 1000);
    const percent = Math.min(95, 1 + Math.floor(elapsed * 94 / 20000));
    setLivePercent(percent, true);
    $('#live-elapsed').textContent = `Elapsed ${seconds}s · Estimated from time, not model telemetry · 20s timeout`;
  };
  updateElapsed();
  liveElapsedTimer = setInterval(updateElapsed, 250);
}

function setLivePercent(percent, estimated) {
  $('#live-percent').textContent = `${percent}%`;
  $('#live-progress-fill').style.width = `${percent}%`;
  const track = $('#live-progress-track');
  track.setAttribute('aria-valuenow', String(percent));
  track.setAttribute('aria-valuetext', estimated
    ? `Estimated ${percent} percent; model progress is unavailable`
    : 'Request completed');
}

function completeLiveProgress() {
  if (liveElapsedTimer !== null) clearInterval(liveElapsedTimer);
  liveElapsedTimer = null;
  setLivePercent(100, false);
  $('#live-progress-title').textContent = 'Request completed';
  $('#live-elapsed').textContent = 'Model response received · human review still required';
}

function stopLiveProgress() {
  if (liveElapsedTimer !== null) clearInterval(liveElapsedTimer);
  liveElapsedTimer = null;
  $('#live-progress').hidden = true;
}

function updateLiveAvailability() {
  liveButton.disabled = livePending || !liveAvailable || demoCase?.id !== 'mueller-figure1';
  if (liveAvailable) $('#live-status').textContent = demoCase?.id === 'mueller-figure1'
    ? 'Ready for a bounded model call. Human review is still required.'
    : 'Configured for a bounded model call. Select the Müller case to run it.';
}
