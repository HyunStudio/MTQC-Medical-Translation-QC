const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_EXCERPT_CODEPOINTS = 3000;

function refreshButton(text, reviewed, translate) {
  const length = Array.from(text.value.trim()).length;
  translate.disabled = !reviewed.checked || length === 0 || length > MAX_EXCERPT_CODEPOINTS;
}

async function readSignature(file) {
  return new Uint8Array(await file.slice(0, 8).arrayBuffer());
}

function imageKind(bytes) {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((part, index) => bytes[index] === part)) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  return null;
}

function isPdf(bytes) {
  return bytes.length >= 5 && [37, 80, 68, 70, 45].every((part, index) => bytes[index] === part);
}

async function recognizeEnglish(blobs) {
  let worker;
  try {
    const { default: Tesseract } = await import('/vendor/tesseract/tesseract.esm.min.js');
    worker = await Tesseract.createWorker('eng', 1, {
      workerPath: `${location.origin}/vendor/tesseract/worker.min.js`,
      corePath: `${location.origin}/vendor/tesseract/core/`,
      langPath: `${location.origin}/vendor/tesseract/lang/`,
      workerBlobURL: false,
      cacheMethod: 'none',
      gzip: true
    });
    const parts = [];
    const confidences = [];
    for (const blob of blobs) {
      const result = await worker.recognize(blob);
      parts.push(result.data.text.trim());
      if (Number.isFinite(result.data.confidence)) confidences.push(result.data.confidence);
    }
    return { text: parts.filter(Boolean).join('\n\n'), confidence: confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : null };
  } finally {
    await worker?.terminate().catch(() => {});
  }
}

async function readImageWithOcr(file, status, text, token, isCurrent) {
  try {
    const result = await recognizeEnglish([file]);
    if (!isCurrent(token)) return;
    if (!text.value.trim()) text.value = result.text;
    status.textContent = `Local English OCR ${result.confidence === null ? 'completed' : `confidence ${result.confidence}%`}. Review and correct all text; OCR order and accuracy are unverified.`;
  } catch {
    if (isCurrent(token)) status.textContent = 'Local OCR could not read this image. Type the English excerpt manually and review it before sending.';
  }
}

async function readPdf(file, preview, status, text, reviewed, token, isCurrent) {
  let pdf;
  try {
    const pdfjs = await import('/vendor/pdfjs/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
    pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    if (!isCurrent(token)) return;
    if (pdf.numPages > 2) {
      status.textContent = 'PDF exceeds the 2-page limit. Choose only one or two pages.';
      return;
    }
    const extracted = [];
    const canvases = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      if (!isCurrent(token)) return;
      const viewport = page.getViewport({ scale: 1.25 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute('aria-label', `Source PDF page ${index}`);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      if (!isCurrent(token)) return;
      canvases.push(canvas);
      const content = await page.getTextContent();
      extracted.push(content.items.map(item => item.str ?? '').join(' ').trim());
    }
    preview.replaceChildren(...canvases);
    preview.hidden = false;
    text.value = extracted.filter(Boolean).join('\n\n');
    text.disabled = false;
    reviewed.disabled = false;
    if (text.value.trim()) {
      status.textContent = `Text layer extracted locally from ${pdf.numPages} PDF page(s). Check reading order and correct the excerpt before sending.`;
      return;
    }
    status.textContent = 'No PDF text layer found. Running local English OCR; review the result before sending.';
    const blobs = await Promise.all(canvases.map(canvas => new Promise(resolve => canvas.toBlob(resolve, 'image/png'))));
    const result = await recognizeEnglish(blobs);
    if (!isCurrent(token)) return;
    if (!text.value.trim()) text.value = result.text;
    status.textContent = 'Scanned PDF OCR completed locally. Text and reading order are unverified; correct the excerpt before sending.';
  } catch {
    if (isCurrent(token)) status.textContent = 'This PDF could not be read locally. Choose a valid PDF or an image.';
  } finally {
    await pdf?.destroy().catch(() => {});
  }
}

let liveController;
let liveRequestId = 0;
let liveTimer;

function updateDocumentProgress(percent, elapsedSeconds) {
  const track = document.querySelector('#document-progress-track');
  track.setAttribute('aria-valuenow', String(percent));
  track.setAttribute('aria-valuetext', percent === 100 ? 'Completed 100 percent' : `Estimated ${percent} percent; model progress is unavailable`);
  document.querySelector('#document-progress-fill').style.width = `${percent}%`;
  document.querySelector('#document-progress-percent').textContent = `${percent}%`;
  document.querySelector('#document-progress-elapsed').textContent = `Elapsed ${elapsedSeconds}s · Estimated, not model telemetry`;
}

function clearLiveDocument() {
  liveRequestId++;
  liveController?.abort();
  liveController = null;
  clearInterval(liveTimer);
  document.querySelector('#document-progress').hidden = true;
  document.querySelector('#document-result').hidden = true;
  document.querySelector('#document-live-status').textContent = 'No document excerpt sent.';
}

function showDocumentResult(sourceText, targetLanguage, data, successful) {
  const result = document.querySelector('#document-result');
  const grid = document.querySelector('#document-result-grid');
  const error = document.querySelector('#document-result-error');
  result.hidden = false;
  grid.hidden = !successful;
  error.hidden = successful;
  if (!successful) {
    error.textContent = data.message || 'The model did not complete this excerpt.';
    document.querySelector('#document-result-model').textContent = '';
    document.querySelector('#document-result-usage').textContent = '';
    document.querySelector('#document-result-qc').textContent = 'No translation was completed. The source remains available for review.';
    return;
  }
  document.querySelector('#document-result-source').textContent = sourceText;
  const translated = document.querySelector('#document-result-translation');
  translated.textContent = data.translation;
  translated.dir = targetLanguage === 'ar' ? 'rtl' : 'auto';
  document.querySelector('#document-result-model').textContent = `Model: ${data.model || 'not reported'}`;
  document.querySelector('#document-result-usage').textContent = Number.isFinite(data.promptTokens) && Number.isFinite(data.completionTokens)
    ? `Usage: ${data.promptTokens} input · ${data.completionTokens} output tokens`
    : 'Token usage not reported';
  document.querySelector('#document-result-qc').textContent = data.qcSummary || 'Automated checks unavailable; independent medical and linguistic review required.';
}

async function runLiveDocument({ sourceText, targetLanguage }) {
  clearLiveDocument();
  const requestId = liveRequestId;
  liveController = new AbortController();
  const progress = document.querySelector('#document-progress');
  progress.hidden = false;
  document.querySelector('#document-progress-title').textContent = 'Nebius model request in progress';
  document.querySelector('#document-live-status').textContent = 'Sending only the reviewed text and target language to the model server.';
  const started = performance.now();
  updateDocumentProgress(1, 0);
  liveTimer = setInterval(() => {
    const elapsed = Math.floor((performance.now() - started) / 1000);
    updateDocumentProgress(Math.min(95, 1 + Math.floor((performance.now() - started) / 180)), elapsed);
  }, 200);
  try {
    const response = await fetch('/api/live/document-excerpt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceText, targetLanguage }),
      signal: liveController.signal
    });
    const data = await response.json();
    if (requestId !== liveRequestId) return;
    clearInterval(liveTimer);
    if (response.ok && data.status === 'ok' && data.translation) {
      updateDocumentProgress(100, Math.floor((performance.now() - started) / 1000));
      document.querySelector('#document-progress-title').textContent = 'Request completed · draft ready';
      document.querySelector('#document-live-status').textContent = 'AI draft returned. Automated warnings are not medical approval.';
      showDocumentResult(sourceText, targetLanguage, data, true);
    } else {
      progress.hidden = true;
      document.querySelector('#document-live-status').textContent = 'Live request did not complete; no draft was produced.';
      showDocumentResult(sourceText, targetLanguage, data, false);
    }
  } catch (error) {
    if (requestId !== liveRequestId || error.name === 'AbortError') return;
    clearInterval(liveTimer);
    progress.hidden = true;
    document.querySelector('#document-live-status').textContent = 'Live request did not complete; no draft was produced.';
    showDocumentResult(sourceText, targetLanguage, { message: 'Network or model service unavailable. Review the source and try again later.' }, false);
  } finally {
    if (requestId === liveRequestId) liveController = null;
  }
}

export function mountDocumentWorkbench({ onTranslate }) {
  const input = document.querySelector('#document-file');
  const fileTrigger = document.querySelector('#document-file-trigger');
  const fileSelected = document.querySelector('#document-file-selected');
  const status = document.querySelector('#document-status');
  const text = document.querySelector('#document-text');
  const reviewed = document.querySelector('#document-reviewed');
  const translate = document.querySelector('#document-translate');
  const language = document.querySelector('#document-language');
  const preview = document.querySelector('#document-preview');
  if (!input || !fileTrigger || !fileSelected || !status || !text || !reviewed || !translate || !language || !preview) return;
  let generation = 0;
  let objectUrl;
  fileTrigger.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    clearLiveDocument();
    const current = ++generation;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    preview.replaceChildren();
    preview.hidden = true;
    text.value = '';
    text.disabled = true;
    reviewed.checked = false;
    reviewed.disabled = true;
    translate.disabled = true;
    const file = input.files?.[0];
    fileSelected.textContent = file ? '1 file selected' : 'No file selected';
    if (!file) {
      status.textContent = 'Choose a PDF or image to begin.';
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      status.textContent = 'File exceeds the 10 MiB limit. Choose a smaller PDF or image.';
      return;
    }
    const signature = await readSignature(file);
    if (current !== generation) return;
    const kind = imageKind(signature);
    if (!kind && !isPdf(signature)) {
      status.textContent = 'Unsupported or invalid file. Choose a genuine PDF, PNG, or JPEG.';
      return;
    }
    if (isPdf(signature)) {
      status.textContent = 'Reading PDF locally…';
      readPdf(file, preview, status, text, reviewed, current, value => value === generation);
      return;
    }
    objectUrl = URL.createObjectURL(file);
    const image = document.createElement('img');
    image.src = objectUrl;
    image.alt = 'Your source image, held in this browser';
    preview.append(image);
    preview.hidden = false;
    text.disabled = false;
    reviewed.disabled = false;
    status.textContent = 'Source image loaded locally. Running English OCR; review and correct its text.';
    readImageWithOcr(file, status, text, current, value => value === generation);
  });

  text.addEventListener('input', () => {
    clearLiveDocument();
    reviewed.checked = false;
    refreshButton(text, reviewed, translate);
  });
  reviewed.addEventListener('change', () => refreshButton(text, reviewed, translate));
  language.addEventListener('change', clearLiveDocument);

  translate.addEventListener('click', () => {
    if (translate.disabled || !reviewed.checked) return;
    onTranslate({ sourceText: text.value.trim(), targetLanguage: language.value });
  });
}

mountDocumentWorkbench({
  onTranslate: payload => {
    document.dispatchEvent(new CustomEvent('document-excerpt-selected', { detail: payload }));
    runLiveDocument(payload);
  }
});
