/* ============================================================
   RetinaGuard workspace controller (canonical served UI).
   Backend is the source of truth. No fabricated data.
   Endpoints used (existing contract, unchanged):
     GET  /health, GET /validation, GET /simulink-stats,
     POST /analyze (multipart `image`, optional ?force=1),
     POST /download-pdf-report (multipart `image`),
     POST /feedback (JSON {rating, case_id, comment})
   ============================================================ */
(function () {
  'use strict';

  var CLASS_ORDER = ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative'];
  var VIEWS = ['home', 'how', 'screening', 'about'];
  var MAX_BYTES = 10 * 1024 * 1024;

  var state = {
    view: 'home',
    file: null,
    fileURL: null,
    fileMeta: null,
    result: null,
    views: {},       // tabKey -> {label, src, caption, meta}
    activeTab: 'original',
    zoom: 1,
    analyzing: false,
    forceDemo: false,
    fbRating: null,
    history: [],
    caseCounter: 0,
    healthOk: false,
    aboutLoaded: false,
  };

  /* ---------------- helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmtBytes(b) {
    if (b == null) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }
  function gradeKey(g) { return String(g || '').toLowerCase().replace(/[^a-z]/g, ''); }
  function pct(x, digits) {
    if (x == null || isNaN(Number(x))) return '—';
    return (Number(x) * 100).toFixed(digits == null ? 1 : digits) + '%';
  }
  function num(x, digits) {
    if (x == null || isNaN(Number(x))) return '—';
    return Number(x).toFixed(digits == null ? 2 : digits);
  }
  function nowLabel() {
    return new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function toast(msg, kind) {
    var stack = $('toastStack');
    if (!stack) return;
    var t = el('div', 'toast ' + (kind || 'info'));
    t.setAttribute('role', 'status');
    t.appendChild(el('span', '', msg));
    stack.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 320); }, 4200);
  }
  function show(sel, on) {
    var n = typeof sel === 'string' ? $(sel) : sel;
    if (n) n.classList.toggle('hidden', !on);
  }
  function setSteps(stage) {
    var order = ['upload', 'quality', 'screen', 'review'];
    var idx = order.indexOf(stage);
    document.querySelectorAll('#stepsMini li').forEach(function (li) {
      var i = order.indexOf(li.dataset.step);
      li.classList.toggle('is-active', i === idx);
      li.classList.toggle('is-done', i < idx);
    });
  }

  /* ---------------- API layer ---------------- */
  function parseBody(res) {
    var ct = res.headers.get('content-type') || '';
    if (ct.indexOf('application/json') >= 0) {
      return res.json().catch(function () { return null; }).then(function (j) { return { res: res, body: j }; });
    }
    return res.text().then(function (t) { return { res: res, body: t }; });
  }
  function apiAnalyze(file, force) {
    var fd = new FormData();
    fd.append('image', file, file.name);
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 120000);
    return fetch('/analyze' + (force ? '?force=1' : ''), { method: 'POST', body: fd, signal: ctrl.signal })
      .then(parseBody)
      .then(function (out) { clearTimeout(timer); return out; },
        function (err) { clearTimeout(timer); throw err; });
  }

  /* ---------------- router ---------------- */
  function showView(name) {
    if (VIEWS.indexOf(name) < 0) name = 'home';
    state.view = name;
    VIEWS.forEach(function (v) {
      var s = $('view-' + v);
      var on = v === name;
      if (s) { s.hidden = !on; s.classList.toggle('is-visible', on); }
    });
    document.querySelectorAll('.nav-link').forEach(function (b) {
      var on = b.dataset.view === name;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.body.classList.remove('nav-open');
    var t = $('navToggle');
    if (t) t.setAttribute('aria-expanded', 'false');
    if (name === 'about' && !state.aboutLoaded) loadAbout();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- health / about data ---------------- */
  function fetchHealth() {
    return fetch('/health', { cache: 'no-store' })
      .then(parseBody)
      .then(function (out) {
        var ok = out.res.ok && out.body && (out.body.status === 'healthy' || !!out.body.service);
        state.healthOk = !!ok;
        applyHealth(ok ? out.body : null);
        return out.body;
      })
      .catch(function () { state.healthOk = false; applyHealth(null); return null; });
  }
  function applyHealth(h) {
    var ok = state.healthOk;
    var dot = $('sysDot'), txt = $('sysText');
    if (dot) { dot.classList.remove('dot-live', 'dot-off'); dot.classList.add(ok ? 'dot-live' : 'dot-off'); }
    if (txt) txt.textContent = ok ? 'ONLINE' : 'OFFLINE';
    h = h || {};
    if ($('stStatus')) $('stStatus').textContent = ok ? 'Online' : 'Offline';
    if ($('stService')) $('stService').textContent = h.service || 'RetinaGuard';
    if ($('stModel')) $('stModel').textContent = h.model || 'B0_CLASSWEIGHTED_FINETUNED_224';
    if ($('stInput')) $('stInput').textContent = h.input_size || '224x224';
    if ($('stClasses')) $('stClasses').textContent = (h.classes != null ? h.classes : 5) + ' — No DR · Mild · Moderate · Severe · Proliferative';
    if ($('healthRaw')) $('healthRaw').textContent = Object.keys(h).length ? JSON.stringify(h, null, 2) : 'No response from /health.';
  }
  function valCard(title, lines, status) {
    var d = el('div', 'val-card');
    d.appendChild(el('h4', '', title));
    lines.forEach(function (ln) { d.appendChild(el('div', 'mono', ln)); });
    if (status) d.appendChild(el('div', 'mono status-' + status.cls, status.text));
    return d;
  }
  function loadAbout() {
    state.aboutLoaded = true;
    fetchHealth();
    fetch('/validation', { cache: 'no-store' }).then(parseBody).then(function (out) {
      var g = $('valGrid');
      if (!g) return;
      g.innerHTML = '';
      var b = out.body || {};
      function row(key, label) {
        var v = b[key] || {};
        var parts = [];
        ['roc', 'sens', 'spec', 'dice', 't', 'thresh'].forEach(function (k) {
          if (v[k] != null) parts.push(k.toUpperCase() + ' ' + v[k]);
        });
        var st = String(v.status || '');
        var cls = /PASS/i.test(st) && !/FAIL/i.test(st) ? 'pass' : /FAIL/i.test(st) ? 'fail' : 'warn';
        g.appendChild(valCard(label || key, parts.length ? parts : [st || '—'], { cls: cls, text: st || '—' }));
      }
      row('aptos_val_733', 'APTOS validation (733)');
      row('messidor2_frozen_1744', 'Messidor-2 frozen (1744)');
      row('messidor2_adapted_val_524', 'Messidor-2 adapted val (524)');
      row('drive_vessel', 'DRIVE vessels');
      row('idrid_exudate', 'IDRiD exudates');
      row('idrid_od', 'IDRiD optic disc');
      row('idrid_he_ma', 'IDRiD HE/MA');
      if (b.integrated_vs_single) g.appendChild(valCard('Pipeline note', [String(b.integrated_vs_single)]));
    }).catch(function () {
      var g = $('valGrid');
      if (g) g.innerHTML = '<p class="fine-print">Validation endpoint unreachable.</p>';
    });
    fetch('/simulink-stats', { cache: 'no-store' }).then(parseBody).then(function (out) {
      var g = $('simGrid');
      if (!g) return;
      g.innerHTML = '';
      var s = out.body || {};
      function card(t, v) { g.appendChild(valCard(t, [String(v)])); }
      card('Annual target', s.district_target);
      card('PHC centers', s.phc_centers_connected);
      card('Daily throughput', s.daily_throughput_target);
      card('Review speedup', (s.review_capacity && s.review_capacity.throughput_multiplier) || '—');
      card('Queue latency', s.expected_queue_latency_min != null ? s.expected_queue_latency_min + ' min' : '—');
      card('Ophthalmologist nodes', s.recommended_ophthalmologist_nodes);
      if (s.quality_distribution) card('Quality split', Object.keys(s.quality_distribution).map(function (k) { return k + ': ' + s.quality_distribution[k]; }).join(' · '));
    }).catch(function () {
      var g = $('simGrid');
      if (g) g.innerHTML = '<p class="fine-print">Telemedicine endpoint unreachable.</p>';
    });
  }

  /* ---------------- upload ---------------- */
  function validFile(f) {
    var ext = (f.name || '').toLowerCase().split('.').pop();
    if (['jpg', 'jpeg', 'png'].indexOf(ext) < 0) { toast('Unsupported format. Use JPG, JPEG or PNG.', 'error'); return false; }
    if (f.size > MAX_BYTES) { toast('File exceeds the 10 MB limit.', 'error'); return false; }
    return true;
  }
  function selectFile(f) {
    if (!f || !validFile(f)) return;
    resetResultViews();
    if (state.fileURL) URL.revokeObjectURL(state.fileURL);
    state.file = f;
    state.fileURL = URL.createObjectURL(f);
    state.fileMeta = { name: f.name, type: f.type || 'Unknown', size: f.size };
    $('imagePreview').src = state.fileURL;
    $('dropZone').classList.add('hidden');
    $('previewWrap').classList.remove('hidden');
    $('metaName').textContent = f.name;
    $('metaType').textContent = f.type || 'Unknown';
    $('metaSize').textContent = fmtBytes(f.size);
    $('metaDims').textContent = 'Reading…';
    var img = new Image();
    img.onload = function () {
      $('metaDims').textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' px';
      state.fileMeta.width = img.naturalWidth;
      state.fileMeta.height = img.naturalHeight;
    };
    img.onerror = function () { $('metaDims').textContent = 'Unavailable'; };
    img.src = state.fileURL;
    setSteps('upload');
    toast('Image ready. Review details, then run analysis.', 'success');
  }
  function resetUpload() {
    state.file = null;
    state.fileMeta = null;
    state.forceDemo = false;
    if (state.fileURL) { URL.revokeObjectURL(state.fileURL); state.fileURL = null; }
    var fi = $('fileInput');
    if (fi) fi.value = '';
    $('previewWrap').classList.add('hidden');
    $('dropZone').classList.remove('hidden');
  }
  function resetResultViews() {
    show('resultWorkspace', false);
    show('recaptureCard', false);
    show('errorCard', false);
    state.result = null;
    state.views = {};
  }
  function newScreening() {
    state.analyzing = false;
    show('loadingCard', false);
    resetResultViews();
    resetUpload();
    show('uploadCard', true);
    setSteps('upload');
  }

  /* ---------------- analysis ---------------- */
  var stageTimer = null;
  function stageStart() {
    var items = Array.prototype.slice.call(document.querySelectorAll('#stageList li'));
    items.forEach(function (li, i) {
      li.classList.remove('active', 'done');
      li.querySelector('.st-ic').textContent = i === 0 ? '●' : '○';
      if (i === 0) li.classList.add('active');
    });
    var step = 0;
    clearInterval(stageTimer);
    // Illustrative rotation only — advances at most to the last stage and
    // holds there until the single /analyze request resolves.
    stageTimer = setInterval(function () {
      if (step >= items.length - 1) return;
      items[step].classList.remove('active');
      items[step].classList.add('done');
      items[step].querySelector('.st-ic').textContent = '✓';
      step += 1;
      items[step].classList.add('active');
      items[step].querySelector('.st-ic').textContent = '●';
    }, 2600);
  }
  function stageStop() { clearInterval(stageTimer); }

  function analyze(force) {
    if (state.analyzing) return;
    if (!state.file) { toast('Select an image first.', 'error'); return; }
    state.analyzing = true;
    resetResultViews();
    show('uploadCard', false);
    show('loadingCard', true);
    setSteps('screen');
    stageStart();
    var btn = $('analyzeBtn');
    if (btn) btn.disabled = true;

    apiAnalyze(state.file, force).then(function (out) {
      state.analyzing = false;
      stageStop();
      if (btn) btn.disabled = false;
      show('loadingCard', false);
      var status = out.res.status, body = out.body || {};
      if (status === 422 || body.rejected === true) { renderRecapture(body); return; }
      if (!out.res.ok || body.success !== true) { renderError(status, body); return; }
      renderResult(body);
    }).catch(function (err) {
      state.analyzing = false;
      stageStop();
      if (btn) btn.disabled = false;
      show('loadingCard', false);
      var aborted = err && err.name === 'AbortError';
      renderError(0, { error: aborted ? 'Request timed out after 120 seconds.' : 'Network error: could not reach the inference service. Is Flask running?' });
    });
  }

  /* ---------------- error states ---------------- */
  var ERR_COPY = {
    400: ['Invalid image', 'The server rejected the upload. Use a JPG, JPEG or PNG file with a valid filename.'],
    413: ['File too large', 'The image exceeds the 10 MB server limit. Compress or resize it and try again.'],
    500: ['Analysis failed', 'The inference service reported an internal error. Try again, or try a different image.'],
    0: ['Service unreachable', 'Could not reach the backend. Start Flask (python app.py) and retry.']
  };
  function renderError(status, body) {
    show('uploadCard', true);
    setSteps('upload');
    var copy = ERR_COPY[status] || ['Request failed', 'Unexpected response from the server.'];
    $('errTitle').textContent = copy[0] + (status ? ' · HTTP ' + status : '');
    var msg = (body && body.error) ? String(body.error) : copy[1];
    $('errMsg').textContent = status === 0 ? copy[1] + ' ' + msg : msg;
    $('errDetail').textContent = typeof body === 'string' ? body.slice(0, 2000) : JSON.stringify(body, null, 2).slice(0, 2000);
    show('errorCard', true);
    $('errorCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast(copy[0] + '. See details on screen.', 'error');
  }

  /* ---------------- 422 recapture ---------------- */
  function renderRecapture(body) {
    show('uploadCard', false);
    show('recaptureCard', true);
    setSteps('quality');
    var q = body.quality || {};
    var st = String(q.status || 'ungradable');
    var badge = $('rcStatus');
    badge.textContent = st.toUpperCase();
    badge.className = 'badge ' + (st === 'review' ? 'warn' : 'bad');
    $('rcScore').textContent = q.score != null ? pct(q.score, 0) + ' · ' + st : st;
    $('rcFeedback').textContent = body.recapture_feedback || q.action || 'Re-acquire the image and try again.';
    var fl = $('rcFlags');
    fl.innerHTML = '';
    (q.flags || []).forEach(function (f) { fl.appendChild(el('span', 'flag', String(f).replace(/_/g, ' '))); });
    if (!(q.flags || []).length) fl.appendChild(el('span', 'flag ok', 'No specific flags — general quality below threshold'));
    $('rcHint').textContent = body.hint || '';
    $('recaptureCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- results ---------------- */
  function probBars(probs, classes, highlight) {
    var box = el('div', '');
    probs.forEach(function (p, i) {
      var row = el('div', 'prob-row' + (i === highlight ? ' hl' : ''));
      row.appendChild(el('span', 'lbl', classes[i] || CLASS_ORDER[i] || ('Class ' + i)));
      var track = el('div', 'bar');
      var fill = el('div', '');
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('span', 'pct', pct(p)));
      box.appendChild(row);
      (function (f, v) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { f.style.width = (Number(v || 0) * 100) + '%'; });
        });
      })(fill, p);
    });
    return box;
  }
  function metricRow(label, display, frac, cool) {
    var row = el('div', 'metric-row');
    row.appendChild(el('span', '', label));
    var track = el('div', 'bar' + (cool ? ' cool' : ''));
    var fill = el('div', '');
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('strong', '', display));
    var w = Math.max(0, Math.min(100, Number(frac) || 0));
    requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.width = w + '%'; }); });
    return row;
  }
  function kvRow(dt, dd, mono) {
    var d = el('div', '');
    d.appendChild(el('dt', '', dt));
    var v = el('dd', mono ? 'mono' : '', '');
    v.textContent = dd;
    d.appendChild(v);
    return d;
  }

  function renderResult(data) {
    state.result = data;
    state.zoom = 1;
    setSteps('review');

    var pred = data.prediction || {};
    var grade = pred.grade || '—';
    var conf = Number(pred.confidence || 0);
    var probs = pred.probabilities || [];
    var classes = (data.model && data.model.classes) || CLASS_ORDER;
    var maxIdx = 0;
    probs.forEach(function (p, i) { if (p > probs[maxIdx]) maxIdx = i; });

    /* hero */
    var badge = $('gradeBadge');
    badge.textContent = grade;
    badge.className = 'grade-badge grade-' + gradeKey(grade);
    $('gradeSub').textContent = 'AI screening result · ' + classes.length + '-class model';
    $('confValue').textContent = pct(conf);
    var C = 2 * Math.PI * 52, ring = $('ringFill');
    ring.style.strokeDasharray = String(C);
    ring.style.strokeDashoffset = String(C);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { ring.style.strokeDashoffset = String(C * (1 - Math.max(0, Math.min(1, conf)))); });
    });
    $('ringA11y').setAttribute('aria-label', 'Model confidence ' + pct(conf) + ' for ' + grade);
    var exp = data.explainability || {};
    $('caseId').textContent = exp.case_id || '—';
    $('elapsedTime').textContent = exp.elapsed_sec != null ? Number(exp.elapsed_sec).toFixed(2) + ' s' : '—';

    /* referable — backend value is authoritative */
    var ref = data.referable || {};
    var refPill = $('refStatus');
    if (ref.referable === true) { refPill.textContent = 'REFERABLE'; refPill.className = 'badge bad'; }
    else if (ref.referable === false) { refPill.textContent = 'NON-REFERABLE'; refPill.className = 'badge ok'; }
    else { refPill.textContent = '—'; refPill.className = 'badge'; }
    $('refLabel').textContent = ref.referable === true ? 'Referable (Level 2+)' : ref.referable === false ? 'Non-referable (Level < 2)' : '—';
    $('refScore').textContent = ref.score_raw != null ? Number(ref.score_raw).toFixed(3) + (ref.score_calibrated != null ? '  ·  calibrated ' + Number(ref.score_calibrated).toFixed(3) : '') : '—';
    $('refThreshold').textContent = ref.threshold != null ? '≥ ' + Number(ref.threshold).toFixed(2) : '—';
    $('refNote').textContent = ref.definition ? String(ref.definition) + '. A non-referable result does not mean absence of disease.' : '';

    /* probabilities */
    var pb = $('probBars');
    pb.innerHTML = '';
    pb.appendChild(probBars(probs, classes, maxIdx));

    /* quality */
    var q = data.quality || {};
    var qs = $('qStatus');
    var qk = String(q.status || '').toLowerCase();
    qs.textContent = qk === 'acceptable' ? 'ACCEPTABLE' : qk === 'review' ? 'REVIEW ADVISED' : qk === 'ungradable' ? 'UNGRADABLE' : (q.status || '—');
    qs.className = 'badge ' + (qk === 'acceptable' ? 'ok' : qk === 'review' ? 'warn' : qk === 'ungradable' ? 'bad' : '');
    var qb = $('qualityBody');
    qb.innerHTML = '';
    var rows = el('div', 'metric-rows');
    rows.appendChild(metricRow('Quality score', q.score != null ? pct(q.score, 0) : '—', (Number(q.score) || 0) * 100));
    rows.appendChild(metricRow('Brightness', num(q.brightness), (Number(q.brightness) || 0) * 100, true));
    rows.appendChild(metricRow('Contrast', num(q.contrast), Math.min(100, (Number(q.contrast) || 0) * 100), true));
    rows.appendChild(metricRow('Field of view', q.fov_fraction != null ? pct(q.fov_fraction, 0) : '—', (Number(q.fov_fraction) || 0) * 100));
    qb.appendChild(rows);
    var qkv = el('dl', 'kv');
    if (q.width && q.height) qkv.appendChild(kvRow('Image', q.width + ' × ' + q.height + ' px', true));
    if (q.black_background_fraction != null) qkv.appendChild(kvRow('Background', pct(q.black_background_fraction), true));
    if (q.blur_variance != null) qkv.appendChild(kvRow('Blur variance', Number(q.blur_variance).toFixed(1), true));
    if (q.action) qkv.appendChild(kvRow('Action', String(q.action), false));
    qb.appendChild(qkv);
    var fl = el('div', 'flags');
    (q.flags || []).forEach(function (f) { fl.appendChild(el('span', 'flag', String(f).replace(/_/g, ' '))); });
    if (!(q.flags || []).length) fl.appendChild(el('span', 'flag ok', 'No quality flags'));
    qb.appendChild(fl);

    /* viewer tabs — only for data that actually exists */
    buildViewer(data);

    /* explainability */
    var g = data.gradcam || {};
    var gm = $('gcamMeta');
    gm.innerHTML = '';
    var gkv = el('dl', 'kv');
    gkv.appendChild(kvRow('Method', g.method || 'Grad-CAM', false));
    gkv.appendChild(kvRow('Target layer', g.target_layer || 'efficientnetb0/top_conv', true));
    gkv.appendChild(kvRow('Status', g.available ? 'Available' : 'Unavailable', false));
    if (g.note) gkv.appendChild(kvRow('Note', String(g.note), false));
    gm.appendChild(gkv);
    $('corrText').textContent = exp.lesion_grade_correlation || 'Not available from the current analysis pipeline.';
    var cl = $('checkList');
    cl.innerHTML = '';
    (exp.validation_checklist_30s || []).forEach(function (c) {
      var li = el('li', '');
      li.appendChild(el('span', 'box', ''));
      li.appendChild(el('span', '', String(c)));
      cl.appendChild(li);
    });
    if (!(exp.validation_checklist_30s || []).length) cl.appendChild(el('li', '', 'Not available from the current analysis pipeline.'));

    /* technical */
    var pre = data.preprocessing || {}, mdl = data.model || {};
    var tb = $('techBody');
    tb.innerHTML = '';
    var tkv = el('dl', 'kv');
    if (mdl.name) tkv.appendChild(kvRow('Model', String(mdl.name), true));
    if (mdl.architecture) tkv.appendChild(kvRow('Architecture', String(mdl.architecture), false));
    if (mdl.input_size) tkv.appendChild(kvRow('Input', String(mdl.input_size), true));
    if (mdl.classes) tkv.appendChild(kvRow('Classes', mdl.classes.length + ' — ' + mdl.classes.join(' · '), false));
    tkv.appendChild(kvRow('RGB', pre.rgb === false ? 'No' : 'Yes', false));
    if (pre.crop_threshold != null) tkv.appendChild(kvRow('Crop threshold', String(pre.crop_threshold), true));
    if (pre.crop_padding != null) tkv.appendChild(kvRow('Crop padding', String(pre.crop_padding), true));
    if (pre.resize) tkv.appendChild(kvRow('Resize', String(pre.resize), true));
    if (pre.normalization) tkv.appendChild(kvRow('Normalization', String(pre.normalization), true));
    if (pre.augmentation != null) tkv.appendChild(kvRow('Augmentation', pre.augmentation ? 'On' : 'Off', false));
    if (pre.enhancement_applied != null) tkv.appendChild(kvRow('Enhancement applied', pre.enhancement_applied ? 'Yes' : 'No', false));
    if (pre.enhancement) tkv.appendChild(kvRow('Enhancement', String(pre.enhancement), false));
    if (exp.elapsed_sec != null) tkv.appendChild(kvRow('Elapsed', Number(exp.elapsed_sec).toFixed(2) + ' s', true));
    if (exp.case_id) tkv.appendChild(kvRow('Case ID', String(exp.case_id), true));
    tb.appendChild(tkv);
    var det = el('details', 'tech');
    det.appendChild(el('summary', '', 'Preprocessing chips'));
    var chips = el('div', 'chip-row');
    [pre.rgb === false ? null : 'RGB',
     pre.resize ? 'Resize ' + pre.resize : 'Resize 224×224',
     pre.normalization ? 'Normalize ' + pre.normalization : 'Normalize [0,1]',
     pre.augmentation ? 'Augmentation on' : 'No augmentation',
     pre.enhancement_applied ? 'Enhanced' : null].filter(Boolean).forEach(function (c) { chips.appendChild(el('span', 'meta-chip', c)); });
    det.appendChild(chips);
    tb.appendChild(det);

    /* feedback reset */
    state.fbRating = null;
    document.querySelectorAll('.fb-btn').forEach(function (b) { b.classList.remove('is-sel'); });
    var fc = $('fbComment');
    if (fc) fc.value = '';
    if ($('fbCount')) $('fbCount').textContent = '0';
    if ($('fbMsg')) $('fbMsg').textContent = '';
    if ($('reportMsg')) $('reportMsg').textContent = '';

    pushHistory(data);
    show('resultWorkspace', true);
    toast('Screening complete: ' + grade + ' (' + pct(conf) + ').', 'success');
    $('resultWorkspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- viewer (lazy base64) ---------------- */
  function buildViewer(data) {
    var tabs = $('viewerTabs');
    tabs.innerHTML = '';
    state.views = {};
    function add(key, label, b64, caption, meta) {
      if (!b64) return;
      state.views[key] = { label: label, src: 'data:image/png;base64,' + b64, caption: caption, meta: meta || '' };
    }
    var g = data.gradcam || {}, s = data.structures || {}, l = data.lesions || {};
    if (state.fileURL) state.views.original = { label: 'ORIGINAL', src: state.fileURL, caption: 'Uploaded fundus photograph', meta: (state.fileMeta && state.fileMeta.name) || '' };
    if (g.available && g.heatmap_png_base64) add('heatmap', 'GRAD-CAM HEATMAP', g.heatmap_png_base64, 'Grad-CAM attention heatmap (JET). Attention only — not a lesion detector.', 'Method: ' + (g.method || 'Grad-CAM') + ' · Target: ' + (g.target_layer || 'efficientnetb0/top_conv'));
    if (g.available && g.overlay_png_base64) add('overlay', 'GRAD-CAM OVERLAY', g.overlay_png_base64, 'Attention blended with the retinal image (α = 0.45).', 'Method: ' + (g.method || 'Grad-CAM'));
    if (s.vessel_png_base64) add('vessel', 'VESSELS', s.vessel_png_base64, 'Vessel structure visualization.', 'Method: ' + (s.vessel_method || '—') + ' · ' + (s.dataset || ''));
    if (l.exudate_png_base64) add('exudate', 'EXUDATES', l.exudate_png_base64, 'Exudate analysis visualization — model evidence, not a diagnosis.', 'Method: ' + (l.lesion_method || '—') + ' · ' + (l.dataset || '') + (l.note ? ' · ' + l.note : ''));
    if (s.od_mask_png_base64) {
      var odMeta = 'Dataset: ' + (s.od_dataset || '—');
      if (s.od_centroid_xy_256) odMeta += ' · Centroid (256px): ' + s.od_centroid_xy_256.join(', ');
      if (s.disc_fovea) odMeta += ' · Disc: ' + (s.disc_fovea.disc_xy_256 || []).join(', ') + ' · Fovea: ' + (s.disc_fovea.fovea_xy_256 || []).join(', ') + ' (' + (s.disc_fovea.method || '') + ')';
      add('od', 'OPTIC DISC', s.od_mask_png_base64, 'Optic-disc segmentation overlay — structural reference only.', odMeta);
    }
    var keys = Object.keys(state.views);
    keys.forEach(function (k) {
      var b = el('button', 'seg-btn', state.views[k].label);
      b.setAttribute('role', 'tab');
      b.dataset.tab = k;
      b.setAttribute('aria-selected', k === 'original' ? 'true' : 'false');
      if (k === 'original') b.classList.add('is-active');
      b.addEventListener('click', function () { setTab(k); });
      tabs.appendChild(b);
    });
    setTab(keys.indexOf('original') >= 0 ? 'original' : keys[0]);
  }
  function setTab(key) {
    if (!state.views[key]) return;
    state.activeTab = key;
    document.querySelectorAll('#viewerTabs .seg-btn').forEach(function (b) {
      var on = b.dataset.tab === key;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var v = state.views[key];
    var img = $('viewerImage');
    img.style.transform = 'scale(' + state.zoom + ')';
    img.src = v.src;
    img.alt = v.label + ' — retinal visualization';
    $('viewerCaption').textContent = v.caption;
    $('viewerMeta').textContent = v.meta;
  }
  function applyZoom() {
    var img = $('viewerImage');
    if (img) img.style.transform = 'scale(' + state.zoom + ')';
  }

  /* ---------------- history / insights ---------------- */
  function pushHistory(data) {
    state.caseCounter += 1;
    state.history.unshift({
      id: state.caseCounter,
      when: nowLabel(),
      file: (state.fileMeta && state.fileMeta.name) || ('case-' + state.caseCounter),
      caseId: (data.explainability && data.explainability.case_id) || '—',
      grade: (data.prediction && data.prediction.grade) || '—',
      conf: Number((data.prediction && data.prediction.confidence) || 0),
      quality: (data.quality && data.quality.status) || '—'
    });
    renderHistory();
  }
  function statusPill(s) {
    var k = String(s).toLowerCase();
    if (k === 'acceptable') return 'Reviewed';
    if (k === 'review') return 'Needs review';
    if (k === 'ungradable') return 'Recapture';
    return String(s);
  }
  function renderHistory() {
    var body = $('historyBody'), empty = $('historyEmpty');
    if (!body) return;
    body.innerHTML = '';
    var n = state.history.length;
    if (!n) { if (empty) show(empty, true); }
    else {
      if (empty) show(empty, false);
      state.history.forEach(function (h) {
        var tr = document.createElement('tr');
        [[h.when], ['Case #' + h.id + ' · ' + h.caseId], [h.grade], [(h.conf * 100).toFixed(1) + '%'],
         [String(h.quality).charAt(0).toUpperCase() + String(h.quality).slice(1)]].forEach(function (c) {
          var td = document.createElement('td');
          td.textContent = c[0];
          tr.appendChild(td);
        });
        var td = document.createElement('td');
        td.appendChild(el('span', 'pill', statusPill(h.quality)));
        tr.appendChild(td);
        body.appendChild(tr);
      });
    }
    if ($('insCount')) $('insCount').textContent = String(n);
    if (!n) {
      if ($('insAvg')) $('insAvg').textContent = '—';
      if ($('insTop')) $('insTop').textContent = '—';
      if ($('insQuality')) $('insQuality').textContent = '—';
      return;
    }
    var avg = state.history.reduce(function (a, h) { return a + h.conf; }, 0) / n;
    if ($('insAvg')) $('insAvg').textContent = (avg * 100).toFixed(1) + '%';
    var counts = {};
    state.history.forEach(function (h) { counts[h.grade] = (counts[h.grade] || 0) + 1; });
    if ($('insTop')) $('insTop').textContent = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
    var pass = state.history.filter(function (h) { return String(h.quality).toLowerCase() === 'acceptable'; }).length;
    if ($('insQuality')) $('insQuality').textContent = ((pass / n) * 100).toFixed(0) + '%';
  }

  /* ---------------- feedback ---------------- */
  function sendFeedback() {
    if (!state.result) { toast('No result to rate yet.', 'error'); return; }
    if (!state.fbRating) { if ($('fbMsg')) $('fbMsg').textContent = 'Select a rating first.'; return; }
    var comment = $('fbComment') ? $('fbComment').value.slice(0, 500) : '';
    var payload = {
      rating: state.fbRating,
      case_id: ((state.result.explainability || {}).case_id) || '',
      comment: comment
    };
    fetch('/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(parseBody)
      .then(function (out) {
        if (out.res.ok && out.body && out.body.success === true) {
          if ($('fbMsg')) $('fbMsg').textContent = 'Feedback recorded. Thank you.';
          toast('Feedback recorded.', 'success');
        } else {
          if ($('fbMsg')) $('fbMsg').textContent = (out.body && out.body.error) || 'Could not record feedback.';
        }
      })
      .catch(function () { if ($('fbMsg')) $('fbMsg').textContent = 'Network error. Feedback not recorded.'; });
  }

  /* ---------------- report ---------------- */
  function downloadReport() {
    var msg = $('reportMsg');
    if (!state.file) {
      window.open('/download-pdf-report-sample', '_blank');
      if (msg) msg.textContent = 'No screening image held — opened the sample report instead.';
      return;
    }
    if (msg) msg.textContent = 'Generating screening report…';
    toast('Generating vector PDF screening report…', 'info');
    var fd = new FormData();
    fd.append('image', state.file, state.file.name);
    fetch('/download-pdf-report', { method: 'POST', body: fd })
      .then(function (res) {
        if (!res.ok) throw new Error('Report generation failed (HTTP ' + res.status + ').');
        return res.blob();
      })
      .then(function (blob) {
        var u = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = u;
        a.download = 'RetinaGuard_Clinical_Screening_Report.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 2000);
        if (msg) msg.textContent = 'Report downloaded. Note: the PDF pipeline re-runs inference on the uploaded image (see report header).';
        toast('PDF report downloaded.', 'success');
      })
      .catch(function (e) {
        if (msg) msg.textContent = 'Error generating PDF: ' + e.message;
        toast('Error generating PDF: ' + e.message, 'error');
      });
  }

  /* ---------------- copy summary ---------------- */
  function copySummary() {
    if (!state.result) { toast('No result to copy yet.', 'error'); return; }
    var p = state.result.prediction || {}, q = state.result.quality || {}, r = state.result.referable || {};
    var text = 'RetinaGuard screening summary\n' +
      'Prediction: ' + (p.grade || '—') + ' (' + (Number(p.confidence || 0) * 100).toFixed(1) + '% model confidence)\n' +
      'Referable: ' + (r.referable === true ? 'referable' : r.referable === false ? 'non-referable' : '—') + '\n' +
      'Quality: ' + (q.status || '—') + ' (score ' + (Number(q.score || 0) * 100).toFixed(0) + '%)\n' +
      'Case: ' + (((state.result.explainability || {}).case_id) || '—') + '\n' +
      'Model: B0_CLASSWEIGHTED_FINETUNED_224 (EfficientNetB0, 224x224)\n' +
      'Screening support only — not a medical diagnosis. Professional review required.';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast('Summary copied to clipboard.', 'success'); },
        function () { toast('Could not copy summary.', 'error'); });
    } else toast('Clipboard unavailable in this browser.', 'error');
  }

  /* ---------------- init ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { showView(b.dataset.goto); });
    });
    document.querySelectorAll('.nav-link').forEach(function (b) {
      b.addEventListener('click', function () { showView(b.dataset.view); });
    });
    var t = $('navToggle');
    if (t) t.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      t.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    fetchHealth();

    var dz = $('dropZone'), fi = $('fileInput');
    dz.addEventListener('click', function () { fi.click(); });
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); }
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('dragover'); });
    });
    dz.addEventListener('drop', function (e) {
      var fs = e.dataTransfer && e.dataTransfer.files;
      if (fs && fs.length) selectFile(fs[0]);
    });
    fi.addEventListener('change', function () { if (fi.files && fi.files.length) selectFile(fi.files[0]); });

    $('changeBtn').addEventListener('click', function () { resetUpload(); });
    $('analyzeBtn').addEventListener('click', function () { analyze(false); });

    $('newUploadBtn').addEventListener('click', function () { newScreening(); });
    $('retryDemoBtn').addEventListener('click', function () {
      state.forceDemo = true;
      show('recaptureCard', false);
      toast('Demo mode: retrying with the quality gate bypassed (?force=1).', 'info');
      analyze(true);
    });
    $('errRetry').addEventListener('click', function () { show('errorCard', false); analyze(state.forceDemo); });
    $('errNew').addEventListener('click', function () { newScreening(); });
    $('newBtn').addEventListener('click', function () { newScreening(); });
    $('copyBtn').addEventListener('click', copySummary);
    $('reportBtn').addEventListener('click', downloadReport);

    $('zoomFit').addEventListener('click', function () { state.zoom = 1; applyZoom(); });
    $('zoomIn').addEventListener('click', function () { state.zoom = Math.min(3, +(state.zoom + 0.25).toFixed(2)); applyZoom(); });
    $('zoomOut').addEventListener('click', function () { state.zoom = Math.max(0.5, +(state.zoom - 0.25).toFixed(2)); applyZoom(); });
    $('zoomReset').addEventListener('click', function () { state.zoom = 1; applyZoom(); });

    document.querySelectorAll('.fb-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        state.fbRating = b.dataset.rating;
        document.querySelectorAll('.fb-btn').forEach(function (x) { x.classList.toggle('is-sel', x === b); });
      });
    });
    var fc = $('fbComment');
    if (fc) fc.addEventListener('input', function () { if ($('fbCount')) $('fbCount').textContent = String(fc.value.length); });
    $('fbSend').addEventListener('click', sendFeedback);

    var rh = $('refreshHealth');
    if (rh) rh.addEventListener('click', function () {
      toast('Refreshing system status…', 'info');
      fetchHealth().then(function () { toast('Status updated from /health.', 'success'); });
    });

    renderHistory();
  });
})();
