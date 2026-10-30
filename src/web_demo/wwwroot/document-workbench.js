import {mountFigureOverlay} from './document-figure-overlay.mjs';
import {mountDocxBody} from './document-docx-body.mjs';
import {mountDocxLayout} from './document-docx-layout.mjs';
import {handoffRestoredReview} from './document-restored-review.mjs';
import {mountDocxRestoration} from './document-docx-restoration.mjs';
import {mountDocxVisualAudit} from './document-docx-visual-audit.mjs';
import {compareStructureTranslation, createStructureComparisonSource} from './document-structure-correspondence.mjs';
import {renderStructurePresentation, clearStructurePresentation} from './document-structure-presentation.mjs';
import { collectFilledRectangles } from './document-vector-rects.mjs';
import { collectRasterPlacements, collectRegionalRasterPlacements } from './document-raster-regions.mjs';
import { collectHorizontalRules, collectVerticalRules } from './document-horizontal-rules.mjs';
import {collectPageCompoundFigureHints,collectPageRasterFigureHints} from './document-additional-structure.mjs';
import { beginGlyphPaintCapture } from './document-glyph-paint.mjs';
import { recoverReadingOrder } from './document-layout.mjs';
import { mountStructureReview } from './document-structure-review.mjs';
import { validRenderDimensions } from './document-render-limits.mjs';
import { pageHasRasterImages, pdfDocumentOptions, assertPageRasterDecoded } from './document-raster-operators.mjs';
import { subscribeLiveAvailability, refreshLiveAvailability } from './live-availability.mjs';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_EXCERPT_CODEPOINTS = 3000;
let structureController;
let figureOverlayController;
let documentLiveAvailable = false;

export function createPdfSourceLifetime() {
  let current = null;
  let cleanup = Promise.resolve(true);
  let ready = true;
  return Object.freeze({
    claim(release) {
      if (typeof release !== 'function' || current || !ready) return false;
      current = release;
      return true;
    },
    clear() {
      const release = current;
      current = null;
      if (release) {
        ready = false;
        cleanup = cleanup.then(async ok => {
          let released = false;
          try { released = await release() === true; } catch {}
          return ok && released;
        }).then(ok => { ready = ok; return ok; });
      }
      return cleanup;
    }
  });
}

function refreshButton(text, reviewed, translate) {
  const excerpt = structureController?.getVerifiedExcerpt();
  const structureHeld = excerpt?.comparisonSource?.status === 'unknown';
  const source = excerpt?.comparisonSource?.text ?? excerpt?.sourceText ?? '';
  const length = Array.from(source).length;
  const unreadableGlyphs = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(source);
  translate.disabled = !documentLiveAvailable || Boolean(liveController) || !excerpt || structureHeld || !reviewed.checked || length === 0 || length > MAX_EXCERPT_CODEPOINTS || unreadableGlyphs;
  const counter = document.querySelector('#document-text-count');
  if (counter) counter.textContent = `${length.toLocaleString()} / 3,000 characters including structure information${length > MAX_EXCERPT_CODEPOINTS ? ' · Select a shorter excerpt before translation.' : ''}${unreadableGlyphs ? ' · Correct unreadable PDF glyphs against the original before translation.' : ''}${structureHeld ? ' · Structure cannot be checked. Select a smaller excerpt or review the source.' : ''}`;
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

async function recognizeEnglish(blobs, profile = 'page', geometry = false) {
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
    // The default single-block segmentation merges facing prose columns.
    // Automatic page segmentation proposes column order; it remains review-only.
    await worker.setParameters({ tessedit_pageseg_mode: profile === 'visual' ? Tesseract.PSM.SPARSE_TEXT : profile === 'diagram' ? Tesseract.PSM.SINGLE_BLOCK : Tesseract.PSM.AUTO });
    const parts = [];
    const confidences = [];
    let positionedBlocks = [];
    for (const blob of blobs) {
      const result = geometry ? await worker.recognize(blob, {}, { text: true, blocks: true }) : await worker.recognize(blob);
      if (geometry) positionedBlocks = result.data.blocks;
      parts.push(result.data.text.trim());
      if (Number.isFinite(result.data.confidence)) confidences.push(result.data.confidence);
    }
    return { text: parts.filter(Boolean).join('\n\n'), confidence: confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : null, ...(geometry ? { blocks: positionedBlocks } : {}) };
  } finally {
    await worker?.terminate().catch(() => {});
  }
}

async function readImageWithOcr(file, status, token, isCurrent, profile) {
  try {
    const result = await recognizeEnglish([file], profile);
    if (!isCurrent(token)) return;
    status.textContent = result.text.trim()
      ? `Local English OCR ${result.confidence === null ? 'completed' : `confidence ${result.confidence}%`}. Review and correct all text; OCR order and accuracy are unverified.`
      : 'Local English OCR found no text. Compare the original image; use Add missing visual region to draw a source box and transcribe only what is visible.';
    return result;
  } catch {
    if (isCurrent(token)) status.textContent = 'Local OCR could not read this image. Compare the original; use Add missing visual region to draw a source box and transcribe only what is visible.';
  }
}

export async function readPdf(file, preview, status, text, reviewed, token, isCurrent, onPages, profile, retainSource) {
  let pdf;
  let loadingTask;
  let releasePromise;
  let retained = false;
  let completed = false;
  const canvases = [];
  const releaseSource = () => releasePromise ??= (async () => {
    try { await loadingTask?.destroy(); return true; } catch { return false; }
  })();
  try {
    const pdfjs = await import('/vendor/pdfjs/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
    if (!isCurrent(token)) return;
    const sourceBytes = new Uint8Array(await file.arrayBuffer());
    if (!isCurrent(token)) return;
    // PDF.js may transfer its buffer; retain a separate immutable export source.
    const exportBytes = sourceBytes.slice();
    loadingTask = pdfjs.getDocument(pdfDocumentOptions(sourceBytes));
    void loadingTask.promise.catch(() => {});
    if (typeof retainSource === 'function') {
      retained = retainSource(releaseSource) === true;
      if (!retained) return;
    }
    pdf = await loadingTask.promise;
    if (!isCurrent(token)) return;
    if (pdf.numPages > 2) {
      status.textContent = 'PDF exceeds the 2-page limit. Choose only one or two pages.';
      return;
    }
    const records = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      if (!isCurrent(token)) return;
      const minimumViewport = page.getViewport({ scale: 1.25 });
      if (!validRenderDimensions(minimumViewport.width, minimumViewport.height)) {
        status.textContent = 'Page dimensions exceed the local rendering limit. Choose a smaller or cropped page.';
        return;
      }
      const content = await page.getTextContent();
      if (!isCurrent(token)) return;
      // Keep searchable-page geometry stable; scan OCR benefits from ~216 dpi.
      const hasText = content.items.some(item => item.str?.trim());
      const viewport = page.getViewport({ scale: hasText ? 1.25 : 3 });
      if (!validRenderDimensions(viewport.width, viewport.height)) {
        status.textContent = 'Page dimensions exceed the local rendering limit. Choose a smaller or cropped page.';
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute('aria-label', `Source PDF page ${index}`);
      const fragments = content.items.filter(item => item.str?.trim()).map(item => {
        const transform = pdfjs.Util.transform(viewport.transform, item.transform);
        const height = Math.hypot(transform[2], transform[3]);
        return { text: item.str, x: transform[4], y: transform[5] - height,
          width: item.width * viewport.scale, height };
      });
      const operators = await page.getOperatorList();
      if (!isCurrent(token)) return;
      // Paint under the current source parent; staged pages remain unreviewed and hidden.
      canvas.hidden = true;
      canvases.push(canvas);
      preview.append?.(canvas);
      const context=canvas.getContext('2d');
      let renderTask;
      // Pinned private task access is diagnostic only; absence or optimization mismatch holds hints.
      const glyphCapture=beginGlyphPaintCapture({fontMetadata:Object.freeze({capture:pdfjs.captureGlyphFontMetadata,read:pdfjs.readGlyphFontMetadata}),page,OPS:pdfjs.OPS,operatorList:operators,viewport,content,fragments,context,pdfjsVersion:pdfjs.version,
        renderOperatorList:()=>renderTask?._internalRenderTask?.operatorList,renderGraphics:()=>renderTask?._internalRenderTask?.gfx});
      let rendered=false,glyphHints;
      try {
        renderTask=page.render({canvasContext:context,viewport,operationsFilter:glyphCapture.operationsFilter});
        await renderTask.promise;
        rendered=true;
      } finally { glyphHints=glyphCapture.finish(rendered); }
      if (!isCurrent(token)) return;
      const decodedImages = await assertPageRasterDecoded(page, pdfjs.OPS, operators);
      if (!isCurrent(token)) return;
      const rasterHints = collectRasterPlacements({ OPS:pdfjs.OPS, operatorList:operators, viewport, pdfjsVersion:pdfjs.version, decodedImages });
      const regionalRasterHints = collectRegionalRasterPlacements({ OPS:pdfjs.OPS, operatorList:operators, viewport, pdfjsVersion:pdfjs.version, decodedImages });
      const ruleHints = { ...collectHorizontalRules({ OPS:pdfjs.OPS, operatorList:operators, viewport, pdfjsVersion:pdfjs.version }),
        width:canvas.width, height:canvas.height };
      const verticalRuleHints = { ...collectVerticalRules({ OPS:pdfjs.OPS, operatorList:operators, viewport, pdfjsVersion:pdfjs.version }), width:canvas.width,height:canvas.height };
      const hasImages = pageHasRasterImages(pdfjs.OPS,operators.fnArray,operators.argsArray,decodedImages);
      const vectorHints = hasImages ? null : {
        ...collectFilledRectangles({ OPS:pdfjs.OPS, operatorList:operators, viewport, pdfjsVersion:pdfjs.version }),
        width:canvas.width, height:canvas.height, hasImages:false
      };
      const compoundFigureHints=collectPageCompoundFigureHints({OPS:pdfjs.OPS,operatorList:operators,viewport,pdfjsVersion:pdfjs.version,fragments,width:canvas.width,height:canvas.height});
      const rasterFigureHints=collectPageRasterFigureHints({OPS:pdfjs.OPS,operatorList:operators,viewport,fragments,width:canvas.width,height:canvas.height,ruleHints,verticalRuleHints,regionalRasterHints});
      records.push({ canvas, width: canvas.width, height: canvas.height, fragments, hasImages, ocrText: '', vectorHints, rasterHints, regionalRasterHints, ruleHints, verticalRuleHints,compoundFigureHints,rasterFigureHints,glyphHints,pdfBytes:exportBytes,pdfTransform:[...viewport.transform] });
    }
    if (!isCurrent(token)) return;
    let ocrPages = 0;
    for (const record of records) {
      if (record.fragments.length) continue;
      status.textContent = 'A page has no PDF text layer. Running local English OCR for that page…';
      const blob = await new Promise(resolve => record.canvas.toBlob(resolve, 'image/png'));
      const result = await recognizeEnglish([blob], profile);
      if (!isCurrent(token)) return;
      record.ocrText = result.text;
      ocrPages++;
    }
    if (!isCurrent(token)) return;
    preview.replaceChildren(...canvases);
    onPages(records);
    if (!isCurrent(token)) return;
    for (const canvas of canvases) canvas.hidden = false;
    preview.hidden = false;
    text.disabled = false;
    reviewed.disabled = false;
    status.textContent = ocrPages
      ? `Scanned PDF OCR completed locally for ${ocrPages} page(s); other text layers retained. Check every page before sending.`
      : `Text layer extracted locally from ${pdf.numPages} PDF page(s). Review the numbered reading order below.`;
    const emptyPages = records.flatMap((record, index) => !record.fragments.length && !record.ocrText.trim() ? [index + 1] : []);
    if (emptyPages.length) status.textContent += ` No text recovered from page(s): ${emptyPages.join(', ')}. They may be blank or unreadable; compare the source and use Add missing visual region for any visible content.`;
    if (records.some(record => record.fragments.length && record.hasImages)) {
      status.textContent += ' Figure labels inside images are not included in the text layer. Compare each diagram and enter any needed labels manually; this is not complete page transcription.';
    }
    completed = true;
  } catch {
    if (isCurrent(token)) status.textContent = 'This PDF could not be read locally in full, including its images. No structure proposal was accepted. Choose a valid PDF or an image and compare it with the original.';
  } finally {
    if (!completed) {
      // A newer generation may already own the preview: remove only this call's nodes.
      for (const canvas of canvases) if (preview.contains?.(canvas)) canvas.remove?.();
      if (isCurrent(token)) {
        preview.hidden = true;
        text.disabled = true;
        reviewed.checked = false;
        reviewed.disabled = true;
      }
    }
    if (!completed || !retained || !isCurrent(token)) await releaseSource();
  }
}

async function inspectPdfImageLabels(file, pageNumbers, token, isCurrent, onProgress) {
  let loadingTask;
  try {
    const pdfjs = await import('/vendor/pdfjs/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
    loadingTask = pdfjs.getDocument(pdfDocumentOptions(new Uint8Array(await file.arrayBuffer())));
    const pdf = await loadingTask.promise;
    const transcripts = [];
    for (const number of pageNumbers) {
      if (!isCurrent(token)) return null;
      const page = await pdf.getPage(number);
      await assertPageRasterDecoded(page, pdfjs.OPS, await page.getOperatorList());
      // Raster labels are inspected at about 216 dpi, independently of the PDF text layer.
      const viewport = page.getViewport({ scale: 3 });
      if (!validRenderDimensions(viewport.width, viewport.height)) {
        transcripts.push(`Page ${number}: too large for the local visual OCR limit; inspect the original image manually.`);
        continue;
      }
      onProgress(number);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      if (!isCurrent(token)) return null;
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not rasterize PDF page');
      const result = await recognizeEnglish([blob], 'visual');
      if (!isCurrent(token)) return null;
      transcripts.push(`Page ${number} · unverified visual OCR${result.confidence === null ? '' : ` · reported confidence ${result.confidence}%`}\n${result.text || '[No labels recognized]'}`);
    }
    return transcripts.join('\n\n');
  } finally {
    await loadingTask?.destroy().catch(() => {});
  }
}

let liveController;
let liveRequestId = 0;
let liveTimer;
let currentReview;

function refreshRequestControls() {
  refreshButton(document.querySelector('#document-text'), document.querySelector('#document-reviewed'), document.querySelector('#document-translate'));
  document.querySelector('#document-cancel').hidden = !liveController;
  figureOverlayController?.refreshAvailability();
}

function updateDocumentProgress(percent, elapsedSeconds) {
  const track = document.querySelector('#document-progress-track');
  track.setAttribute('aria-valuenow', String(percent));
  track.setAttribute('aria-valuetext', percent === 100 ? 'Completed 100 percent' : `Estimated ${percent} percent; model progress is unavailable`);
  document.querySelector('#document-progress-fill').style.width = `${percent}%`;
  document.querySelector('#document-progress-percent').textContent = `${percent}%`;
  document.querySelector('#document-progress-elapsed').textContent = `Elapsed ${elapsedSeconds}s · Estimated, not model telemetry`;
}

function clearLiveDocument() {
  clearStructurePresentation(document.querySelector('#document-structure-presentation'));
  liveRequestId++;
  liveController?.abort();
  liveController = null;
  currentReview = null;
  clearInterval(liveTimer);
  document.querySelector('#document-progress').hidden = true;
  document.querySelector('#document-result').hidden = true;
  document.querySelector('#document-human-acknowledge').checked = false;
  document.querySelector('#document-export-fingerprints').checked = false;
  document.querySelector('#document-audit-export').disabled = true;
  document.querySelector('#document-live-status').textContent = 'No document excerpt sent.';
  refreshRequestControls();
}

function renderReview(review, localStructureComparison=null) {
  const stages = document.querySelector('#document-review-stages');
  const modelFindings = document.querySelector('#document-model-findings');
  const ruleFindings = document.querySelector('#document-rule-findings');
  const coverage = document.querySelector('#document-coverage');
  stages.replaceChildren();
  modelFindings.replaceChildren();
  ruleFindings.replaceChildren();
  coverage.replaceChildren();
  if (!review) {
    stages.textContent = 'Stage provenance unavailable; treat this draft as incomplete.';
    coverage.textContent = 'No rule categories assessed.';
    if(!localStructureComparison)return;
    review={structureComparison:localStructureComparison};
  }
  for (const [label, stage] of [['Translation', review.translationStage], ['AI critique', review.critiqueStage], ['Rules', review.rulesStage]]) {
    const row = document.createElement('p');
    const usage = Number.isFinite(stage?.promptTokens) && Number.isFinite(stage?.completionTokens)
      ? ` · ${stage.promptTokens} input / ${stage.completionTokens} output tokens` : '';
    const elapsed = Number.isFinite(stage?.elapsedMs) ? ` · ${(stage.elapsedMs / 1000).toFixed(1)}s` : '';
    row.textContent = `${label}: ${stage?.state || 'not reported'}${stage?.model ? ` · ${stage.model}` : ''}${usage}${elapsed}`;
    stages.append(row);
  }
  const appendFindings = (container, items, formatter) => {
    if (!Array.isArray(items) || items.length === 0) {
      container.textContent = 'No findings returned. This is not medical clearance.';
      return;
    }
    for (const item of items) {
      const row = document.createElement('p');
      row.className = 'document-finding';
      row.textContent = formatter(item);
      container.append(row);
    }
  };
  if (review.critiqueStage?.state === 'skipped') {
    modelFindings.textContent = 'Experimental AI critique was not requested. No additional model review was performed.';
  } else {
    appendFindings(modelFindings, review.modelFindings, item =>
      `UNVERIFIED MODEL SUGGESTION · ${item.category} · ${item.sourceSpan && item.draftSpan ? `${item.sourceSpan} → ${item.draftSpan}` : 'evidence span incomplete'} · interpretation unverified: ${item.rationale}`);
  }
  appendFindings(ruleFindings, review.ruleFindings, item =>
    `RULE · ${item.category} · ${item.severity}: ${item.message} · Source span: ${item.sourceSpan || 'unavailable'} · Draft span: ${item.draftSpan || 'unavailable'}`);
  if(review.structureComparison){
    const compared=review.structureComparison,row=document.createElement('p');row.className='document-finding';row.dataset.structureComparison=compared.status;
    row.textContent=`Source/translation structure: ${compared.status}. ${compared.counts?`${compared.counts.cellsCompared}/${compared.counts.sourceCells} cell positions, ${compared.counts.equationsCompared} literal equations, ${compared.counts.notesCompared} note targets compared.`:'Correspondence could not be established; counts are unavailable.'} Table metadata, finite literal numeric/notation/unit tokens, equation text and note links only; wording, original visibility and clinical correctness require independent review.`;
    ruleFindings.append(row);
    for(const finding of compared.issues.slice(0,64)){const detail=document.createElement('p');detail.className='document-finding';detail.textContent=`STRUCTURE · ${finding.code}${finding.regionId?` · ${finding.regionId}`:''}${finding.cellId?` · ${finding.cellId}`:''}`;ruleFindings.append(detail);}
    if(compared.issues.length>64){const detail=document.createElement('p');detail.textContent=`${compared.issues.length-64} additional structure findings retained in this local comparison.`;ruleFindings.append(detail);}
  }
  for (const item of review.coverage || []) {
    const badge = document.createElement('span');
    badge.className = `document-coverage-badge ${item.state === 'warning' ? 'warning' : item.state === 'checked' ? 'checked' : 'unassessed'}`;
    badge.textContent = `${item.category === 'identifier' ? 'identifier (bounded literal)' : item.category === 'negation' ? 'negation (marker presence only)' : item.category}: ${item.state}`;
    coverage.append(badge);
  }
  if ((review.coverage || []).some(item => item.category === 'negation')) {
    const limit = document.createElement('p');
    limit.className = 'document-finding';
    limit.textContent = 'Negation marker presence does not verify each clause. Another negative phrase can mask an omitted negation; compare the source and draft sentence by sentence.';
    coverage.append(limit);
  }
}

function showDocumentResult(sourceText, targetLanguage, data, successful, structureComparison=null, presentationComparison=null) {
  const result = document.querySelector('#document-result');
  const grid = document.querySelector('#document-result-grid');
  const error = document.querySelector('#document-result-error');
  const transcript=document.querySelector('#document-result-transcript');
  transcript.hidden=!successful;
  clearStructurePresentation(document.querySelector('#document-structure-presentation'));
  result.hidden = false;
  grid.hidden = !successful;
  error.hidden = successful;
  if (!successful) {
    error.textContent = data.message || 'The model did not complete this excerpt.';
    document.querySelector('#document-result-model').textContent = '';
    document.querySelector('#document-result-usage').textContent = '';
    document.querySelector('#document-result-qc').textContent = 'No translation was completed. The source remains available for review.';
    document.querySelector('.document-review-evidence').hidden = true;
    return;
  }
  document.querySelector('.document-review-evidence').hidden = false;
  document.querySelector('#document-result-source').textContent = sourceText;
  const translated = document.querySelector('#document-result-translation');
  translated.textContent = structureComparison?.displayText ?? data.translation;
  translated.dir = targetLanguage === 'ar' ? 'rtl' : 'auto';
  transcript.open=!renderStructurePresentation(document.querySelector('#document-structure-presentation'),presentationComparison,{targetDirection:translated.dir});
  document.querySelector('#document-result-model').textContent = `Model: ${data.model || 'not reported'}`;
  document.querySelector('#document-result-usage').textContent = Number.isFinite(data.promptTokens) && Number.isFinite(data.completionTokens)
    ? `Usage: ${data.promptTokens} input · ${data.completionTokens} output tokens`
    : 'Token usage not reported';
  document.querySelector('#document-result-qc').textContent = data.qcSummary || 'Automated checks unavailable; independent medical and linguistic review required.';
  currentReview = data.review ? {...data.review,structureComparison} : null;
  document.querySelector('#document-human-acknowledge').checked = false;
  document.querySelector('#document-audit-export').disabled = !currentReview;
  renderReview(currentReview, structureComparison);
}

async function runLiveDocument({ sourceText, displaySourceText=sourceText, comparisonSource=null, targetLanguage, includeExperimentalCritique }) {
  if (liveController || comparisonSource?.status === 'unknown') return;
  clearLiveDocument();
  const requestId = liveRequestId;
  liveController = new AbortController();
  refreshRequestControls();
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
      body: JSON.stringify({ sourceText, targetLanguage, includeExperimentalCritique }),
      signal: liveController.signal
    });
    const data = await response.json();
    if (requestId !== liveRequestId) return;
    clearInterval(liveTimer);
    if (response.ok && data.translation && (data.status === 'ok' || data.status === 'partial')) {
      const presentationComparison=compareStructureTranslation(comparisonSource,data.translation);
      const structureComparison={...presentationComparison,sourceFormat:comparisonSource?.status==='ready'?comparisonSource.version:'plain-reviewed-text'};
      const complete = ['matched','not-applicable'].includes(structureComparison.status) && data.status === 'ok' && data.review?.translationStage?.state === 'completed' &&
        (data.review?.critiqueStage?.state === 'completed' || data.review?.critiqueStage?.state === 'skipped') &&
        data.review?.rulesStage?.state === 'completed';
      if (complete) updateDocumentProgress(100, Math.floor((performance.now() - started) / 1000));
      else {
        updateDocumentProgress(Math.min(95, Number(document.querySelector('#document-progress-track').getAttribute('aria-valuenow')) || 1), Math.floor((performance.now() - started) / 1000));
        document.querySelector('#document-progress-track').setAttribute('aria-valuetext', 'Review incomplete; the workflow did not reach 100 percent');
      }
      document.querySelector('#document-progress-title').textContent = complete ? 'Draft and scoped checks completed' : 'Review incomplete · draft only';
      document.querySelector('#document-live-status').textContent = complete
        ? 'AI draft and automated checks returned. Human medical and linguistic review remains essential.'
        : 'AI draft returned, but automated review is incomplete. Do not treat this as an approved translation.';
      showDocumentResult(displaySourceText, targetLanguage, data, true, structureComparison, presentationComparison);
      return { translation: data.translation, complete };
    } else {
      progress.hidden = true;
      document.querySelector('#document-live-status').textContent = 'Live request did not complete; no draft was produced.';
      showDocumentResult(displaySourceText, targetLanguage, data, false);
    }
  } catch (error) {
    if (requestId !== liveRequestId || error.name === 'AbortError') return;
    clearInterval(liveTimer);
    progress.hidden = true;
    document.querySelector('#document-live-status').textContent = 'Live request did not complete; no draft was produced.';
    showDocumentResult(displaySourceText, targetLanguage, { message: 'Network or model service unavailable. Review the source and try again later.' }, false);
  } finally {
    if (requestId === liveRequestId) {
      liveController = null;
      refreshRequestControls();
    }
    void refreshLiveAvailability();
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
  const experimentalCritique = document.querySelector('#document-experimental-critique');
  const preview = document.querySelector('#document-preview');
  if (!input || !fileTrigger || !fileSelected || !status || !text || !reviewed || !translate || !language || !preview) return;
  text.readOnly = true;
  let sourceRevision = 0;
  const structureHost = document.querySelector('#structure-review');
  const structure = mountStructureReview({ host: structureHost, preview,
    onDraftChange: () => {
      // Pending edits revoke consent without cancelling a paid request already
      // in flight. A future request still needs saved, verified source text.
      text.value = structureController?.getVerifiedExcerpt()?.sourceText || '';
      reviewed.checked = false;
      refreshButton(text, reviewed, translate);
    },
    onChange: ({ excerpt }) => {
      sourceRevision++;
      text.value = excerpt?.sourceText || '';
      reviewed.checked = false;
      clearLiveDocument();
      refreshButton(text, reviewed, translate);
    } });
  // Draft fields have not reached the structure graph yet, but must survive OCR too.
  structureHost.addEventListener('input', () => sourceRevision++);
  structureHost.addEventListener('click', event => {
    if (event.target.closest('#structure-add-region, #structure-table-build, #structure-split-text')) sourceRevision++;
  });
  structureController = structure;
  const figureHost = document.createElement('section');
  figureHost.id = 'document-figure-overlay';
  preview.after(figureHost);
  const bodyHost=document.createElement('section');
  bodyHost.id='document-docx-body';
  figureHost.after(bodyHost);
  const layoutHost=document.createElement('section');
  layoutHost.id='document-docx-layout';
  bodyHost.after(layoutHost);
  const docxLayout=mountDocxLayout({host:layoutHost});
  const restorationHost=document.createElement('section');
  restorationHost.id='document-docx-restoration';
  layoutHost.after(restorationHost);
  const docxRestoration=mountDocxRestoration({host:restorationHost,onUse:async (bytes, context)=>{
    const expectedGeneration=generation+1, name='mtqc-source-restored-draft.docx';
    input.value='';
    await handoffRestoredReview({bytes,originalBytes:context.sourceBytes,
      load:(value,reservePair)=>loadFile(new File([value],name,{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),reservePair),
      audit:value=>docxVisualAudit.setDraft(value,name),
      current:()=>generation===expectedGeneration,
      selectPair:(original,draft)=>docxLayout.setPair(original,draft)});
  }});
  const visualAuditHost=document.createElement('section');
  visualAuditHost.id='document-docx-visual-audit';
  restorationHost.after(visualAuditHost);
  const docxVisualAudit=mountDocxVisualAudit({host:visualAuditHost,targetLanguage:()=>language.value,languageElement:language});
  const docxBody=mountDocxBody({host:bodyHost,
    translate:payload=>runLiveDocument({...payload,
      // Only the selected prose runs enter this request. Native document
      // objects stay outside the text comparison and retain their own guards.
      comparisonSource:createStructureComparisonSource({regions:[{
        id:'selected-docx-text',type:'paragraph',status:'verified',text:payload.sourceText
      }],edges:[]})}),
    available:()=>documentLiveAvailable&&!liveController,
    targetLanguage:()=>language.value});
  // Figure interaction owns its source too: late whole-image OCR must not
  // reintake the graph and abort a reviewed figure-label request.
  figureHost.addEventListener('input', () => sourceRevision++);
  figureHost.addEventListener('change', () => sourceRevision++);
  figureHost.addEventListener('click', event => {
    if (event.target.closest('[data-figure-action]')) sourceRevision++;
  });
  figureOverlayController = mountFigureOverlay({
    host: figureHost,
    recognize: async (canvas, profile = 'diagram') => {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not read figure crop');
      return recognizeEnglish([blob], profile, true);
    },
    translate: payload => runLiveDocument({ ...payload,
      // This is the explicitly checked local figure label, not a table/math
      // graph or native-render identity. Bind the existing no-supported-
      // structure context instead of passing an unbound null source.
      comparisonSource: createStructureComparisonSource({ regions: [{
        id: 'selected-figure-label', type: 'figure', status: 'verified', text: payload.sourceText
      }], edges: [] })
    }),
    available: () => documentLiveAvailable && !liveController,
    createDocx:async payload=>{
      const {exportDocxCanvases}=await import('./document-figure-docx.mjs');
      const figures=await exportDocxCanvases(payload.session,payload.images);
      return {...figures,...await docxBody.applyTo(figures.bytes)};
    },
    targetLanguage: () => language.value
  });
  let generation = 0;
  const pdfSourceLifetime = createPdfSourceLifetime();
  let objectUrl;
  let pdfPages = [];
  const layout = document.querySelector('#document-layout');
  const orderMode = document.querySelector('#document-order-mode');
  const layoutSummary = document.querySelector('#document-layout-summary');
  const overlayToggle = document.querySelector('#document-show-order');
  const applyOrder = document.querySelector('#document-apply-order');
  const visualOcr = document.querySelector('#document-visual-ocr');
  const visualOcrPanel = document.querySelector('#document-visual-ocr-panel');
  const visualOcrResult = document.querySelector('#document-visual-ocr-result');
  const visualOcrStatus = document.querySelector('#document-visual-ocr-status');
  let selectedPdf;
  function renderOrder(applyText = false) {
    const summaries = [];
    const frames = [];
    const recoveredPages = [];
    let tableRegions = 0;
    let panelDrafts = 0;
    pdfPages.forEach((record, pageIndex) => {
      const recovered = recoverReadingOrder(record.fragments, record.width, orderMode.value, record.vectorHints);
      recoveredPages.push(recovered);
      tableRegions += recovered.tableRegions;
      panelDrafts += recovered.panelDraft?.panels || 0;
      summaries.push(`Page ${pageIndex + 1}: ${record.fragments.length ? `${recovered.columns} column(s), ${recovered.lines.length} lines` : 'OCR · review order manually'}`);
      const frame = document.createElement('div');
      frame.className = 'document-page-frame';
      frame.dataset.structurePage = `p${pageIndex + 1}`;
      frame.style.width = `${record.width}px`;
      frame.append(record.canvas);
      recovered.lines.forEach((line, index) => {
        const box = document.createElement('span');
        box.className = 'document-order-box';
        box.style.left = `${100 * line.x / record.width}%`;
        box.style.top = `${100 * line.y / record.height}%`;
        box.style.width = `${100 * line.width / record.width}%`;
        box.style.height = `${100 * line.height / record.height}%`;
        box.title = `${index + 1}. ${line.text}`;
        box.textContent = String(index + 1);
        frame.append(box);
      });
      frames.push(frame);
    });
    preview.replaceChildren(...frames);
    structure.renderOverlay();
    preview.classList.toggle('show-reading-order', overlayToggle.checked);
    layoutSummary.textContent = `${summaries.join(' · ')}. ${applyText ? 'Applied to structure proposal; review approval reset. ' : 'Preview only; structure and review approval are unchanged. Select Apply reading order to propose a new sequence. '}${tableRegions ? 'Numeric table region detected; row alignment is an approximation, not verified column semantics. Check every value against the original. ' : ''}${panelDrafts ? 'Question-panel/glossary draft grouping is unverified; check source boundaries, reading order and later paint visibility. ' : ''}Numbers propose reading sequence; check tables and figure labels against the original.`;
    if (applyText) {
      if (structure.getDocument().pages.length) recoveredPages.forEach((recovered, index) =>
        structure.applyReadingOrderFromLines(`p${index + 1}`, recovered.lines));
      reviewed.checked = false;
      clearLiveDocument();
      refreshButton(text, reviewed, translate);
    }
  }
  orderMode.addEventListener('change', () => renderOrder());
  overlayToggle.addEventListener('change', () => preview.classList.toggle('show-reading-order', overlayToggle.checked));
  applyOrder.addEventListener('click', () => renderOrder(true));
  visualOcr.addEventListener('click', async () => {
    if (!selectedPdf || visualOcr.disabled) return;
    const current = generation;
    const pageNumbers = pdfPages.flatMap((record, index) => record.hasImages && record.fragments.length ? [index + 1] : []);
    if (!pageNumbers.length) return;
    visualOcr.disabled = true;
    visualOcrPanel.hidden = false;
    visualOcrResult.value = '';
    visualOcrStatus.textContent = 'Reading image labels locally. The extracted source and review approval are unchanged…';
    try {
      const result = await inspectPdfImageLabels(selectedPdf, pageNumbers, current,
        value => value === generation, number => { if (current === generation) visualOcrStatus.textContent = `Reading visual labels on page ${number} locally…`; });
      if (current !== generation) return;
      visualOcrResult.value = result || '';
      visualOcrStatus.textContent = 'Full-page visual OCR may repeat body text and miss figure labels. It is an unverified clue, not a restored figure or validated transcription. Compare each label with the source and manually correct the excerpt if needed.';
    } catch {
      if (current === generation) visualOcrStatus.textContent = 'Visual OCR could not read the image labels. Inspect the original page and enter needed labels manually.';
    } finally {
      if (current === generation) visualOcr.disabled = false;
    }
  });
  fileTrigger.addEventListener('click', () => input.click());

  input.addEventListener('change', () => { void loadFile(input.files?.[0]); });
  async function loadFile(file, onLayoutReady) {
    clearLiveDocument();
    pdfPages = [];
    figureOverlayController?.clear();
    docxBody.clear();
    docxLayout.clear();
    docxRestoration.clear();
    docxVisualAudit.clear();
    selectedPdf = null;
    layout.hidden = true;
    visualOcr.hidden = true;
    visualOcr.disabled = true;
    visualOcrPanel.hidden = true;
    visualOcrResult.value = '';
    orderMode.value = 'auto';
    const current = ++generation;
    const ocrProfile = document.querySelector('#document-ocr-profile')?.value || 'page';
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    preview.replaceChildren();
    preview.hidden = true;
    structure.clear();
    text.value = '';
    refreshButton(text, reviewed, translate);
    text.disabled = true;
    reviewed.checked = false;
    reviewed.disabled = true;
    translate.disabled = true;
    const sourceReleased = await pdfSourceLifetime.clear();
    if (current !== generation) return;
    if (!sourceReleased) {
      status.textContent = 'Source cleanup could not complete. Reload this page before loading another source.';
      return;
    }
    fileSelected.textContent = file ? file.name : 'No file selected';
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
    const docxFile = file.name.toLowerCase().endsWith('.docx') && signature[0]===0x50 && signature[1]===0x4b && signature[2]===0x03 && signature[3]===0x04;
    if (!kind && !isPdf(signature) && !docxFile) {
      status.textContent = 'Unsupported or invalid file. Choose a genuine PDF, PNG, or JPEG.';
      return;
    }
    if (docxFile) {
      const docxBytes=new Uint8Array(await file.arrayBuffer());
      if(current!==generation)return;
      await docxBody.setFile(docxBytes);
      if(current!==generation)return;
      docxLayout.setFile(docxBytes);
      onLayoutReady?.();
      docxRestoration.setFile(docxBytes);
      status.textContent = 'Reading embedded DOCX figures locally…';
      try {
        const {readDocxFigures,decodeDocxFigures} = await import('./document-figure-docx.mjs');
        if (current !== generation) return;
        const session = await readDocxFigures(docxBytes);
        if (current !== generation) return;
        const records = await decodeDocxFigures(session,document);
        if (current !== generation) return;
        for (const [index,record] of records.entries()) {
          const frame=document.createElement('div'),label=document.createElement('p');frame.className='document-page-frame';label.textContent=record.label;record.canvas.style.maxWidth='100%';record.canvas.style.height='auto';frame.append(label,record.canvas);frame.dataset.documentImage=String(index+1);preview.append(frame);
        }
        preview.hidden=false;
        figureOverlayController?.setPages(records,{docx:session});
        status.textContent = `${records.length} embedded main-body image(s) loaded locally. Review figure labels below. Use Document text and native equations to select body targets; figure DOCX export includes those selected targets.`;
      } catch (error) {
        if (current === generation) {preview.replaceChildren();preview.hidden=true;figureOverlayController?.clear();status.textContent=`DOCX figure intake held: ${error.message} Document text can be reviewed separately using the local app below.`;}
      }
      return current===generation;
    }
    if (isPdf(signature)) {
      selectedPdf = file;
      status.textContent = 'Reading PDF locally…';
      readPdf(file, preview, status, text, reviewed, current, value => value === generation, records => {
        pdfPages = records;
        layout.hidden = false;
        visualOcr.hidden = !records.some(record => record.hasImages && record.fragments.length);
        visualOcr.disabled = visualOcr.hidden;
        renderOrder(true);
        structure.setPages(records);
        figureOverlayController?.setPages(records);
      }, ocrProfile, release => current === generation && pdfSourceLifetime.claim(release));
      return;
    }
    const sourceImageUrl = URL.createObjectURL(file);
    objectUrl = sourceImageUrl;
    const image = document.createElement('img');
    image.src = sourceImageUrl;
    image.alt = 'Your source image, held in this browser';
    const imageFrame = document.createElement('div');
    imageFrame.className = 'document-page-frame';
    imageFrame.dataset.structurePage = 'p1';
    imageFrame.append(image);
    preview.append(imageFrame);
    preview.hidden = false;
    const imageDecoded = await image.decode().then(() => true, () => false);
    if (current !== generation) return;
    if (!imageDecoded || !image.naturalWidth || !image.naturalHeight) {
      preview.replaceChildren();
      preview.hidden = true;
      URL.revokeObjectURL(sourceImageUrl);
      if (objectUrl === sourceImageUrl) objectUrl = null;
      status.textContent = 'Image could not be decoded locally. Choose a readable PNG or JPEG.';
      return;
    }
    if (image.naturalWidth && image.naturalHeight) {
      imageFrame.style.width = `${image.naturalWidth}px`;
      if (validRenderDimensions(image.naturalWidth, image.naturalHeight)) {
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = image.naturalWidth; sourceCanvas.height = image.naturalHeight;
        sourceCanvas.getContext('2d').drawImage(image, 0, 0);
        figureOverlayController?.setPages([{ canvas: sourceCanvas, width: sourceCanvas.width, height: sourceCanvas.height }]);
      }
      structure.setPages([{ width: image.naturalWidth, height: image.naturalHeight,
        fragments: [], hasImages: true, ocrText: '' }]);
    }
    text.disabled = false;
    reviewed.disabled = false;
    status.textContent = 'Source image loaded locally. Running English OCR; review and correct its text.';
    const imageRevision = sourceRevision;
    const result = await readImageWithOcr(file, status, current, value => value === generation, ocrProfile);
    if (current === generation && result) {
      if (sourceRevision === imageRevision) {
        structure.setPages([{ width: image.naturalWidth, height: image.naturalHeight,
          fragments: [], hasImages: true, ocrText: result.text }]);
      } else {
        // Never reintake a graph or discard a pending transcription after editing begins.
        // The panel normally lives inside PDF-only controls, which are hidden for images.
        layout.after(visualOcrPanel);
        visualOcrPanel.hidden = false;
        visualOcrResult.value = result.text;
        visualOcrStatus.textContent = 'Unverified image OCR clue only; manual source edits and pending transcriptions were retained. Compare the original and copy only corrections you have checked into the source regions.';
        status.textContent += ' Manual source edits retained; OCR shown separately below.';
      }
    }
    if (current === generation) refreshButton(text, reviewed, translate);
  }

  text.addEventListener('input', () => {
    sourceRevision++;
    clearLiveDocument();
    reviewed.checked = false;
    refreshButton(text, reviewed, translate);
  });
  reviewed.addEventListener('change', () => {
    if (!reviewed.checked) {
      clearLiveDocument();
      document.querySelector('#document-live-status').textContent = 'Source review withdrawn; no draft accepted. Any in-flight provider usage may already have occurred.';
    }
    refreshButton(text, reviewed, translate);
  });
  language.addEventListener('change', clearLiveDocument);
  experimentalCritique.addEventListener('change', clearLiveDocument);
  document.querySelector('#document-cancel').addEventListener('click', () => {
    clearLiveDocument();
    document.querySelector('#document-live-status').textContent = 'Request cancelled; no draft accepted. The provider may already have incurred usage.';
  });
  document.querySelector('#document-audit-export').addEventListener('click', () => {
    if (!currentReview) return;
    const stage = value => ({ state: value?.state || 'not reported', model: value?.model || null,
      promptTokens: value?.promptTokens ?? null, completionTokens: value?.completionTokens ?? null,
      elapsedMs: value?.elapsedMs ?? null });
    const audit = {
      runId: currentReview.runId,
      translationStage: stage(currentReview.translationStage), critiqueStage: stage(currentReview.critiqueStage),
      rulesStage: stage(currentReview.rulesStage), elapsedMs: currentReview.elapsedMs,
      modelFindings: (currentReview.modelFindings || []).map(item => ({ category: item.category, severity: item.severity })),
      ruleFindings: (currentReview.ruleFindings || []).map(item => ({ category: item.category, severity: item.severity })),
      coverage: (currentReview.coverage || []).map(item => ({ category: item.category, state: item.state })),
      humanInspectionAcknowledged: document.querySelector('#document-human-acknowledge').checked,
      note: 'Metadata-only audit. Human inspection is not medical certification.'
    };
    if(currentReview.structureComparison){const comparison=currentReview.structureComparison;audit.structureComparison={status:comparison.status,scope:comparison.scope,sourceFormat:comparison.sourceFormat,counts:comparison.counts,issueCodes:[...new Set(comparison.issues.map(item=>item.code))],note:'Local format/literal correspondence only. Source and optional raw draft fingerprints refer to transport serialization; displayed text omits recognized markers without repairing content. No source/draft text or anchors included.'};}
    const identity = currentReview.identity;
    if (identity) {
      audit.identity = { targetLanguage: identity.targetLanguage, ruleVersion: identity.ruleVersion,
        appVersion: identity.appVersion };
      if (document.querySelector('#document-export-fingerprints').checked &&
          /^[a-f0-9]{64}$/.test(identity.sourceSha256) && /^[a-f0-9]{64}$/.test(identity.draftSha256)) {
        Object.assign(audit.identity, { sourceSha256: identity.sourceSha256, draftSha256: identity.draftSha256,
          textNormalization: identity.textNormalization });
      }
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `mtqc-review-${String(currentReview.runId || 'run').replace(/[^a-zA-Z0-9-]/g, '')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  translate.addEventListener('click', () => {
    if (translate.disabled || !reviewed.checked) return;
    const excerpt = structure.getVerifiedExcerpt();
    if (!excerpt || excerpt.comparisonSource?.status === 'unknown' || excerpt.sourceText !== text.value) return;
    onTranslate({ sourceText: excerpt.comparisonSource?.text ?? excerpt.sourceText, displaySourceText:excerpt.sourceText, comparisonSource:excerpt.comparisonSource, targetLanguage: language.value,
      includeExperimentalCritique: experimentalCritique.checked });
  });
}

mountDocumentWorkbench({
  onTranslate: payload => {
    document.dispatchEvent(new CustomEvent('document-excerpt-selected', { detail: payload }));
    runLiveDocument(payload);
  }
});

subscribeLiveAvailability(status => {
  documentLiveAvailable = status.available;
  document.querySelector('#document-availability').textContent = status.available
    ? 'Live requests are available. Source review is required before sending.' : status.reason;
  document.querySelector('#document-saved-examples').hidden = status.available;
  refreshRequestControls();
});
