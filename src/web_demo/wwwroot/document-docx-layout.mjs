import {mountNaturalPreview} from './document-natural-preview.mjs';
const localHost = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
const base64 = bytes => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
};

export function mountDocxLayout({host}) {
  host.hidden = true;
  const heading = document.createElement('h3'); heading.textContent = 'Review a saved DOCX draft in Word';
  const limits = document.createElement('p');
  limits.textContent = 'Limited comparison: read-only Word snapshots sample paragraph pages and horizontal starts, tables and floating frames. Paragraph vertical positions, inline frames, exact positions and overflow clearance are not verified. No text is applied automatically. An admitted job continues if this page closes.';
  const label = document.createElement('label'); label.textContent = 'Choose a separately saved DOCX draft ';
  const picker = document.createElement('input'); picker.type = 'file'; picker.accept = '.docx'; picker.dataset.layoutRole = 'draft'; label.append(picker);
  const compare = document.createElement('button'); compare.type = 'button'; compare.textContent = 'Compare in Word'; compare.dataset.layoutAction = 'compare'; compare.disabled = true;
  const natural = document.createElement('button'); natural.type = 'button'; natural.textContent = 'Review natural layout'; natural.dataset.layoutAction = 'natural'; natural.disabled = true;
  const naturalLimits = document.createElement('p'); naturalLimits.textContent = 'Natural layout preserves the saved draft’s inline flow and text. An explicit review renders the draft and checks reported image/text rectangles. Intersections need visual review; they do not prove visible occlusion. No findings is not acceptance. DOCX content and image positions are never rewritten. Full layout, fonts, OCR, math and clinical correctness remain unverified.';
  const selection = document.createElement('p'); selection.dataset.layoutRole = 'selection';
  const inspect = document.createElement('button'); inspect.type='button'; inspect.textContent='Inspect rendered page'; inspect.dataset.layoutAction='inspect'; inspect.disabled=true;
  const previewHost=document.createElement('section'); previewHost.dataset.layoutRole='preview';
  const preview=mountNaturalPreview({host:previewHost});
  const status = document.createElement('p'); status.dataset.layoutRole = 'status'; status.dataset.state = 'idle'; status.setAttribute('role', 'status');
  const result = document.createElement('div'); result.dataset.layoutRole = 'result';
  const report = document.createElement('button'); report.type = 'button'; report.textContent = 'Download comparison report'; report.dataset.layoutAction = 'report'; report.disabled = true;
  const pdf = document.createElement('button'); pdf.type = 'button'; pdf.textContent = 'Download reviewed PDF'; pdf.dataset.layoutAction = 'pdf'; pdf.disabled = true;
  host.append(heading, naturalLimits, limits, label, natural, compare, selection, status, result, inspect, pdf, report, previewHost);
  let epoch = 0, source = null, target = null, available = false, naturalAvailable = false, running = false, reportId = null, reportSha = null, pdfSha = null, pairTargetSha = null;
  const readiness = () => { compare.disabled = !(localHost() && available && source && target && !running); natural.disabled = !(localHost() && naturalAvailable && source && target && !running); };
  const resetResult = () => { result.replaceChildren(); report.disabled = pdf.disabled = inspect.disabled = true; void preview.clear(); reportId = reportSha = pdfSha = pairTargetSha = null; };
  const say = (state, message) => { status.dataset.state = state; status.textContent = message; };
  const current = value => value === epoch && source !== null && localHost();
  const request = async (path, options) => {
    if (!localHost()) throw Error('Word comparison requires the explicit local app.');
    const response = await fetch(path, options);
    if (!response.ok) {
      let message = `Local comparison held (${response.status}).`;
      try { const body = await response.json(); message = body.error || message; } catch { }
      throw Error(message);
    }
    return response;
  };
  const show = view => {
    resetResult();
    const summary = document.createElement('p');
    summary.textContent = view.reviewMode === 'natural'
      ? `Natural layout review ${view.state}: ${view.engineStatus || 'no bound result'}. Publication remains blocked. Review the rectangle findings and retained PDF; full rendered layout verification remains open.`
      : `Limited comparison ${view.state}: ${view.engineStatus || 'no accepted engine result'}. Word ${view.wordVersion || 'version unconfirmed'}. Full rendered layout verification remains open.`;
    result.append(summary);
    for (const [title, values] of [['Findings', view.issues], ['Warnings', view.warnings]]) {
      const items = Array.isArray(values) ? values : [];
      const heading = document.createElement('p'); heading.textContent = `${title}: ${items.length}${items.length > 50 ? ' (first 50 below; full list in report)' : ''}`; result.append(heading);
      const list = document.createElement('ul');
      for (const value of items.slice(0, 50)) { const item = document.createElement('li'); item.textContent = String(value).slice(0, 4000); list.append(item); }
      result.append(list);
    }
    if (view.reportSha256) { reportId = view.id; reportSha = view.reportSha256; report.disabled = false; }
    if (view.reviewMode === 'natural' && view.pdfSha256 && view.reportSha256) { pdfSha = view.pdfSha256; pairTargetSha=view.targetSha256; pdf.disabled = inspect.disabled = false; }
  };
  picker.addEventListener('change', async () => {
    const token = ++epoch; selection.textContent=''; target = null; running = false; resetResult(); say('idle', 'Choose a draft, then explicitly start a review.'); readiness();
    const file = picker.files?.[0]; if (!file || !source || !localHost()) return;
    if (!file.name.toLowerCase().endsWith('.docx') || file.size > 10 * 1024 * 1024) { say('held', 'Choose a DOCX draft within 10 MiB.'); return; }
    try { const bytes = new Uint8Array(await file.arrayBuffer()); if (current(token)) { target = bytes; readiness(); } }
    catch (error) { if (current(token)) say('held', error.message); }
  });
  const startReview = async isNatural => {
    if ((isNatural ? natural : compare).disabled || !source || !target || !localHost()) return;
    const original = source.slice(), draft = target.slice(), token = ++epoch;
    running = true; readiness(); resetResult(); say('running', isNatural ? 'Starting explicit natural layout review. The draft is rendered without rewriting its content. Save and close other Word sessions first.' : 'Starting explicit limited comparison. Save and close other Word sessions first.');
    try {
      const [sourceSha256, targetSha256] = await Promise.all([digest(original), digest(draft)]);
      if (!current(token)) return;
      const response = await request(isNatural ? '/api/local/docx/layout/flow/jobs' : '/api/local/docx/layout/jobs', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({sourceBase64: base64(original), targetBase64: base64(draft), sourceSha256, targetSha256})});
      const accepted = await response.json();
      while (current(token)) {
        const view = await request(`/api/local/docx/layout/jobs/${encodeURIComponent(accepted.id)}`).then(r => r.json());
        if (!current(token)) return;
        if (view.sourceSha256 !== sourceSha256 || view.targetSha256 !== targetSha256) throw Error('Returned document pair changed.');
        if ((view.reviewMode === 'natural') !== isNatural) throw Error('Returned review mode changed.');
        if (view.state !== 'running') { show(view); say(view.state, isNatural ? `Natural layout review ${view.state}. Findings remain review-required; publication is blocked.` : `Limited comparison ${view.state}. Read the findings and sampling limits.`); return; }
        say('running', 'Word comparison is running. Closing this page stops polling; the owned job continues.');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) { if (current(token)) say('held', error.message); }
    finally { if (current(token)) { running = false; readiness(); } }
  };
  compare.addEventListener('click', () => startReview(false));
  natural.addEventListener('click', () => startReview(true));
  report.addEventListener('click', async () => {
    if (!reportId || !localHost()) return;
    const id = reportId, expectedSha = reportSha, token = epoch;
    try {
      const response = await request(`/api/local/docx/layout/jobs/${encodeURIComponent(id)}/report`);
      const bytes = await response.arrayBuffer(); if (!current(token) || reportId !== id) return;
      if (await digest(bytes) !== expectedSha) throw Error('Downloaded report binding changed.');
      if (!current(token) || reportId !== id) return;
      const url = URL.createObjectURL(new Blob([bytes], {type: 'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = 'mtqc-word-layout-report.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { if (current(token)) say('held', error.message); }
  });
  pdf.addEventListener('click', async () => {
    if (!reportId || !pdfSha || !localHost()) return;
    const id = reportId, expectedSha = pdfSha, token = epoch;
    try {
      const response = await request(`/api/local/docx/layout/jobs/${encodeURIComponent(id)}/pdf`);
      const bytes = await response.arrayBuffer();
      if (!current(token) || reportId !== id) return;
      if (await digest(bytes) !== expectedSha) throw Error('Downloaded PDF binding changed.');
      if (!current(token) || reportId !== id) return;
      const url = URL.createObjectURL(new Blob([bytes], {type: 'application/pdf'}));
      const link = document.createElement('a'); link.href = url; link.download = 'mtqc-natural-layout.pdf'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { if (current(token)) say('held', error.message); }
  });
  inspect.addEventListener('click', async () => {
    if (inspect.disabled || !reportId || !pdfSha || !localHost()) return;
    const id=reportId, expectedReport=reportSha, expectedPdf=pdfSha, expectedTarget=pairTargetSha, token=epoch;
    inspect.disabled=true;
    try {
      const [pdfBytes,reportBytes]=await Promise.all(['pdf','report'].map(kind=>request(`/api/local/docx/layout/jobs/${encodeURIComponent(id)}/${kind}`).then(r=>r.arrayBuffer())));
      const [actualPdf,actualReport]=await Promise.all([digest(pdfBytes),digest(reportBytes)]);
      if(!current(token) || reportId!==id)return;
      if(actualPdf!==expectedPdf || actualReport!==expectedReport)throw Error('Preview PDF/report binding changed.');
      const value=JSON.parse(new TextDecoder().decode(reportBytes));
      if(value.contract!=='natural-flow-rectangle-review-v1' || value.policy!=='preserve-source-inline-flow' ||
         value.publication_blocked!==true || value.full_rendered_layout_verified!==false ||
         value.inputs?.[0]?.sha256!==expectedTarget || value.inputs?.[1]?.sha256!==expectedPdf)
        throw Error('Preview report does not bind the reviewed draft and PDF.');
      await preview.show({pdfBytes:new Uint8Array(pdfBytes),report:value});
    } catch(error) {if(current(token))say('held',error.message);}
    finally {if(current(token) && reportId===id)inspect.disabled=false;}
  });
  return {
    setPair(original,draft) {
      for(const value of [original,draft])if(!(value instanceof Uint8Array) || !value.length || value.length>10*1024*1024)throw Error('Choose two nonempty DOCX files within 10 MiB.');
      this.setFile(original); target=draft.slice();
      selection.textContent='Restored draft selected for Word review. The original used for restoration is retained as the reference.';readiness();
    },
    clear() { selection.textContent=''; epoch++; source = target = null; available = naturalAvailable = running = false; picker.value = ''; resetResult(); say('idle', ''); host.hidden = true; readiness(); },
    setFile(bytes) {
      selection.textContent=''; epoch++; source = new Uint8Array(bytes).slice(); target = null; picker.value = ''; available = naturalAvailable = running = false; resetResult(); readiness();
      host.hidden = !localHost(); if (!localHost()) return;
      const capturedSource = source; say('idle', 'Checking the explicitly configured local Word runtime.');
      Promise.allSettled(['/api/local/docx/layout/status', '/api/local/docx/layout/flow/status'].map(path => request(path).then(r => r.json()))).then(views => {
        if (source !== capturedSource || !localHost()) return;
        available = views[0].status === 'fulfilled' && views[0].value.available === true;
        naturalAvailable = views[1].status === 'fulfilled' && views[1].value.available === true;
        say(available || naturalAvailable ? 'idle' : 'held', naturalAvailable ? views[1].value.message : available ? views[0].value.message : 'Local Word review is held; an explicitly configured runtime is required.'); readiness();
      }).catch(error => { if (source === capturedSource && localHost()) say('held', error.message); });
    }
  };
}
