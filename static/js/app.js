/* RetinaGuard workspace controller — consumes GET /health and POST /analyze only. */
(function () {
  'use strict';

  var CLASS_ORDER = ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative'];
  var VIEW_TITLES = {
    overview: 'Overview', screening: 'New Screening', history: 'Screening History',
    insights: 'AI Insights', simulink: 'Simulink Telemedicine', model: 'Model Information', status: 'System Status', settings: 'Settings'
  };

  var state = {
    view: 'overview',
    file: null,
    fileURL: null,
    result: null,
    lastFileMeta: null,
    history: [],
    caseCounter: 0,
    zoom: 1,
    analyzing: false,
    health: null,
    healthOk: false
  };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function esc(s) { return String(s == null ? '' : s); }
  function fmtBytes(b) {
    if (b == null) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }
  function gradeKey(g) {
    return String(g || '').toLowerCase().replace(/[^a-z]/g, '');
  }
  function nowLabel() {
    var d = new Date();
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- Toasts ---------- */
  function toast(msg, kind) {
    var stack = $('toastStack');
    if (!stack) { return; }
    var t = el('div', 'toast ' + (kind || 'info'));
    t.setAttribute('role', 'status');
    t.appendChild(el('span', '', msg));
    stack.appendChild(t);
    setTimeout(function () {
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 300);
    }, 4200);
  }

  /* ---------- Router ---------- */
  function showView(name) {
    if (!VIEW_TITLES[name]) name = 'overview';
    state.view = name;
    document.querySelectorAll('.view').forEach(function (v) {
      var active = v.id === 'view-' + name;
      v.hidden = !active;
      v.classList.toggle('is-visible', active);
    });
    document.querySelectorAll('.nav-item').forEach(function (b) {
      var on = b.dataset.view === name;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    var crumb = $('crumbCurrent');
    if (crumb) crumb.textContent = VIEW_TITLES[name];
    document.body.classList.remove('nav-open');
    var main = $('mainContent');
    if (main && window.matchMedia('(max-width: 880px)').matches) main.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- Health ---------- */
  function setDots(ok) {
    [['sidebarDot'], ['topbarDot'], ['statSysDot'], ['dotApi'], ['dotModel'], ['dotInfer']].forEach(function (ids) {
      var n = $(ids[0]);
      if (n) { n.classList.remove('dot-live', 'dot-off'); n.classList.add(ok ? 'dot-live' : 'dot-off'); }
    });
  }

  function fetchHealth() {
    return fetch('/health', { cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        state.health = res.body;
        state.healthOk = !!(res.ok && res.body && (res.body.status === 'healthy' || res.body.service));
        applyHealth();
        return res.body;
      })
      .catch(function () {
        state.healthOk = false;
        state.health = null;
        applyHealth();
        return null;
      });
  }

  function applyHealth() {
    var ok = state.healthOk, h = state.health || {};
    setDots(ok);
    var online = ok ? 'Online' : 'Offline';
    if ($('sidebarSysText')) $('sidebarSysText').textContent = ok ? 'System Online' : 'System Offline';
    if ($('topbarStatusText')) $('topbarStatusText').textContent = online;
    if ($('statSysValue')) $('statSysValue').textContent = online;
    if ($('statSysHint')) $('statSysHint').textContent = ok ? 'Live status from /health.' : 'Could not reach /health.';
    if ($('valApi')) $('valApi').textContent = online;
    if ($('hintApi')) $('hintApi').textContent = ok ? 'GET /health responding.' : 'GET /health unreachable.';
    if ($('valModel')) $('valModel').textContent = h.model || (ok ? 'Loaded' : 'Unknown');
    if ($('valInfer')) $('valInfer').textContent = ok ? 'Ready' : 'Unavailable';
    if ($('valInput')) $('valInput').textContent = h.input_size || h.inputSize || '224x224';
    if ($('detService')) $('detService').textContent = h.service || 'RetinaGuard';
    if ($('detVersion')) $('detVersion').textContent = h.model || 'B0_CLASSWEIGHTED_FINETUNED_224';
    if ($('detClasses')) $('detClasses').textContent = (h.classes != null ? h.classes : 5) + ' — No DR · Mild · Moderate · Severe · Proliferative';
    if ($('detChecked')) $('detChecked').textContent = new Date().toLocaleString();
    if ($('healthRaw')) $('healthRaw').textContent = h && Object.keys(h).length ? JSON.stringify(h, null, 2) : 'No response from /health.';
  }

  /* ---------- Upload ---------- */
  function validFile(f) {
    var okTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    var ext = (f.name || '').toLowerCase().split('.').pop();
    var okExt = ['jpg', 'jpeg', 'png'].indexOf(ext) >= 0;
    if (okTypes.indexOf(f.type) < 0 && !okExt) { toast('Please upload a valid JPG or PNG image.', 'error'); return false; }
    if (f.size > 10 * 1024 * 1024) { toast('File exceeds the 10 MB limit.', 'error'); return false; }
    return true;
  }

  function selectFile(f) {
    if (!f || !validFile(f)) return;
    if (state.fileURL) URL.revokeObjectURL(state.fileURL);
    state.file = f;
    state.fileURL = URL.createObjectURL(f);
    state.lastFileMeta = { name: f.name, type: f.type || 'image', size: f.size };
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
      state.lastFileMeta.width = img.naturalWidth;
      state.lastFileMeta.height = img.naturalHeight;
    };
    img.onerror = function () { $('metaDims').textContent = 'Unavailable'; };
    img.src = state.fileURL;
    setSteps('upload');
    toast('Image ready. Review details, then run analysis.', 'success');
  }

  function resetUpload() {
    state.file = null;
    if (state.fileURL) { URL.revokeObjectURL(state.fileURL); state.fileURL = null; }
    var fi = $('fileInput'); if (fi) fi.value = '';
    $('previewWrap').classList.add('hidden');
    $('dropZone').classList.remove('hidden');
  }

  function setSteps(stage) {
    var order = ['upload', 'quality', 'screen', 'review'];
    var idx = order.indexOf(stage);
    document.querySelectorAll('.steps-mini li').forEach(function (li) {
      var i = order.indexOf(li.dataset.step);
      li.classList.toggle('is-active', i === idx);
      li.classList.toggle('is-done', i < idx);
    });
  }

  /* ---------- Timeline ---------- */
  var timelineTimer = null;
  function timelineStart() {
    var items = Array.prototype.slice.call(document.querySelectorAll('#timelineList li'));
    var bar = $('timelineProgress');
    items.forEach(function (li, i) {
      li.classList.remove('active', 'done');
      var icon = li.querySelector('.tl-icon');
      if (i < 2) { li.classList.add('done'); icon.textContent = '✓'; }
      else if (i === 2) { li.classList.add('active'); icon.textContent = '●'; }
      else icon.textContent = '○';
    });
    if (bar) bar.style.width = '35%';
    if ($('timelineSub')) $('timelineSub').textContent = 'Communicating with the inference service…';
    var step = 2, pct = 35;
    clearInterval(timelineTimer);
    timelineTimer = setInterval(function () {
      step += 1; pct = Math.min(92, pct + 14);
      if (step >= items.length) { clearInterval(timelineTimer); return; }
      items.forEach(function (li, i) {
        var icon = li.querySelector('.tl-icon');
        li.classList.remove('active');
        if (i < step) { li.classList.add('done'); icon.textContent = '✓'; }
        else if (i === step) { li.classList.add('active'); icon.textContent = '●'; }
      });
      if (bar) bar.style.width = pct + '%';
      var labels = ['Processing retinal features…', 'Classifying DR severity…', 'Preparing screening result…'];
      if ($('timelineSub')) $('timelineSub').textContent = labels[Math.min(step - 2, 2)] || 'Working…';
    }, 900);
  }
  function timelineFinish() {
    clearInterval(timelineTimer);
    document.querySelectorAll('#timelineList li').forEach(function (li) {
      li.classList.add('done'); li.classList.remove('active');
      li.querySelector('.tl-icon').textContent = '✓';
    });
    if ($('timelineProgress')) $('timelineProgress').style.width = '100%';
  }

  /* ---------- Analysis ---------- */
  function analyze() {
    if (state.analyzing) return;
    if (!state.file) { toast('Select an image first.', 'error'); return; }
    state.analyzing = true;
    var btn = $('analyzeBtn');
    if (btn) btn.disabled = true;
    $('uploadWorkspace').classList.add('hidden');
    $('resultWorkspace').classList.add('hidden');
    $('loadingCard').classList.remove('hidden');
    timelineStart();
    setSteps('screen');

    var fd = new FormData();
    fd.append('image', state.file, state.file.name);
    fetch('/analyze', { method: 'POST', body: fd })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        state.analyzing = false;
        if (btn) btn.disabled = false;
        if (!res.ok || !res.body || res.body.success !== true) {
          throw new Error((res.body && res.body.error) || 'Analysis failed.');
        }
        timelineFinish();
        setTimeout(function () { renderResult(res.body); }, 450);
      })
      .catch(function (err) {
        state.analyzing = false;
        if (btn) btn.disabled = false;
        clearInterval(timelineTimer);
        $('loadingCard').classList.add('hidden');
        $('uploadWorkspace').classList.remove('hidden');
        setSteps('upload');
        toast('Error: ' + err.message, 'error');
      });
  }

  /* ---------- Render results ---------- */
  function barRow(label, pct, highlight) {
    var row = el('div', 'bar-row' + (highlight ? ' hl' : ''));
    row.appendChild(el('span', 'lbl', label));
    var track = el('div', 'bar');
    var fill = el('div', '');
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('span', 'pct', pct.toFixed(1) + '%'));
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { fill.style.width = pct + '%'; });
    });
    return row;
  }

  function setQualityPill(status) {
    var s = String(status || '').toLowerCase();
    var map = { acceptable: ['Acceptable', 'dot-live'], review: ['Review advised', 'dot-pulse'], ungradable: ['Ungradable', 'dot-off'] };
    var m = map[s] || [s || '—', ''];
    var pill = $('resultQualityPill');
    if (pill) {
      var dot = pill.querySelector('.dot');
      if (dot) dot.className = 'dot ' + m[1];
      $('resultQualityPillText').textContent = 'Quality: ' + m[0];
    }
    var badge = $('qualityStatus');
    if (badge) { badge.textContent = m[0]; badge.className = 'status-badge status-' + (map[s] ? s : 'review'); }
  }

  function renderResult(data) {
    $('loadingCard').classList.add('hidden');
    $('resultWorkspace').classList.remove('hidden');
    state.result = data;
    state.zoom = 1;
    applyZoom();
    setSteps('review');

    var pred = data.prediction || {};
    var grade = pred.grade || pred.prediction || '—';
    var conf = Number(pred.confidence || 0);
    var probs = pred.probabilities || pred.probs || [];
    var classes = (data.model && data.model.classes) || CLASS_ORDER;

    var badge = $('gradeBadge');
    badge.textContent = /DR$/.test(grade) || grade === 'No DR' ? grade : grade + (grade === 'No DR' ? '' : '');
    badge.className = 'grade-badge grade-' + gradeKey(grade);
    $('gradeSub').textContent = 'Predicted severity grade · ' + classes.length + '-class model';

    var pct = Math.max(0, Math.min(100, conf * 100));
    $('confidenceValue').textContent = pct.toFixed(1) + '%';
    var C = 2 * Math.PI * 52;
    var ring = $('ringFill');
    ring.style.strokeDasharray = String(C);
    ring.style.strokeDashoffset = String(C);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { ring.style.strokeDashoffset = String(C * (1 - conf)); });
    });
    $('ringA11y').setAttribute('aria-label', 'Model confidence ' + pct.toFixed(1) + ' percent for ' + grade);

    var imgURL = state.fileURL;
    if (imgURL) {
      $('resultImage').src = imgURL;
      $('resultFileName').textContent = (state.lastFileMeta && state.lastFileMeta.name) || 'Uploaded fundus photograph';
    }
    setImgTab('original');

    var bars = $('probabilityBars');
    bars.innerHTML = '';
    var maxIdx = 0;
    probs.forEach(function (p, i) { if (p > probs[maxIdx]) maxIdx = i; });
    probs.forEach(function (p, i) {
      bars.appendChild(barRow(classes[i] || CLASS_ORDER[i] || ('Class ' + i), Number(p) * 100, i === maxIdx));
    });
    if ($('ctxModel')) $('ctxModel').textContent = (data.model && data.model.name) || 'B0_CLASSWEIGHTED_FINETUNED_224';
    if ($('ctxArch')) $('ctxArch').textContent = (data.model && data.model.architecture) || 'EfficientNetB0';

    var q = data.quality || {};
    setQualityPill(q.status);
    var score = Number(q.score || 0);
    $('qualityScoreVal').textContent = (score * 100).toFixed(0) + '%';
    $('qualityScoreFill').style.width = '0%';
    $('brightnessVal').textContent = Number(q.brightness || 0).toFixed(2);
    $('brightnessFill').style.width = '0%';
    $('contrastVal').textContent = Number(q.contrast || 0).toFixed(2);
    $('contrastFill').style.width = '0%';
    var fov = Number(q.fov_fraction != null ? q.fov_fraction : q.fovFraction || 0);
    $('fovVal').textContent = (fov * 100).toFixed(0) + '%';
    $('fovFill').style.width = '0%';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        $('qualityScoreFill').style.width = (score * 100) + '%';
        $('brightnessFill').style.width = Math.min(100, Number(q.brightness || 0) * 100) + '%';
        $('contrastFill').style.width = Math.min(100, Number(q.contrast || 0) * 100) + '%';
        $('fovFill').style.width = (fov * 100) + '%';
      });
    });
    $('qDims').textContent = (q.width && q.height) ? (q.width + ' × ' + q.height + ' px') : '—';
    var bf = q.black_background_fraction;
    $('qBlack').textContent = (bf != null) ? ((Number(bf) * 100).toFixed(1) + '%') : '—';

    var flags = $('qualityFlags');
    flags.innerHTML = '';
    var list = q.flags || [];
    if (!list.length) flags.appendChild(el('span', 'flag ok', 'No quality flags'));
    list.forEach(function (f) { flags.appendChild(el('span', 'flag', String(f).replace(/_/g, ' '))); });

    var advice = $('qualityAdvice');
    if (String(q.status).toLowerCase() === 'acceptable') {
      advice.classList.add('hidden');
    } else {
      advice.classList.remove('hidden');
      advice.className = 'callout ' + (String(q.status).toLowerCase() === 'ungradable' ? 'bad' : 'warn');
      $('qualityAdviceTitle').textContent = String(q.status).toLowerCase() === 'ungradable' ? 'Ungradable — recapture advised' : 'Review required';
      var issues = list.length ? list.map(function (f) { return String(f).replace(/_/g, ' '); }).join('; ') : 'suboptimal illumination or field coverage';
      $('qualityAdviceBody').textContent = 'Potential issues: ' + issues + '. Recommendation: capture another fundus image with improved illumination and retinal field coverage.';
    }

    var g = data.gradcam || {};
    if ($('gradcamAvail')) $('gradcamAvail').textContent = g.available ? 'Available' : 'Unavailable';
    if ($('gMethod')) $('gMethod').textContent = g.method || 'Grad-CAM';
    if ($('gLayer')) $('gLayer').textContent = g.target_layer || g.targetLayer || 'top_conv';
    if ($('gNote')) $('gNote').textContent = g.note || 'Model explainability metadata. Not clinical evidence.';

    var pp = $('preprocessChips');
    pp.innerHTML = '';
    var pre = data.preprocessing || {};
    var chips = [
      pre.rgb === false ? null : 'RGB',
      pre.resize ? ('Resize ' + pre.resize) : 'Resize 224×224',
      pre.normalization ? ('Normalize ' + pre.normalization) : 'Normalize [0,1]',
      pre.augmentation ? 'Augmentation on' : 'No augmentation'
    ].filter(Boolean);
    chips.forEach(function (c) { pp.appendChild(el('span', 'meta-chip', c)); });

    pushHistory(data);
    toast('Screening complete: ' + grade + ' (' + pct.toFixed(1) + '%).', 'success');
    $('resultWorkspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- History / insights ---------- */
  function pushHistory(data) {
    state.caseCounter += 1;
    var entry = {
      id: state.caseCounter,
      when: nowLabel(),
      file: (state.lastFileMeta && state.lastFileMeta.name) || ('case-' + state.caseCounter),
      grade: (data.prediction && data.prediction.grade) || '—',
      conf: Number((data.prediction && data.prediction.confidence) || 0),
      quality: ((data.quality && data.quality.status) || '—'),
      probs: (data.prediction && data.prediction.probabilities) || []
    };
    state.history.unshift(entry);
    renderHistory();
    renderOverview();
    renderInsights();
  }

  function statusPillText(s) {
    var k = String(s).toLowerCase();
    if (k === 'acceptable') return 'Reviewed';
    if (k === 'review') return 'Needs review';
    if (k === 'ungradable') return 'Recapture';
    return esc(s);
  }

  function renderHistory() {
    var body = $('historyBody');
    var empty = $('historyEmpty');
    if (!body) return;
    body.innerHTML = '';
    var n = state.history.length;
    if ($('navHistoryCount')) $('navHistoryCount').textContent = String(n);
    if (!n) { if (empty) empty.classList.remove('hidden'); return; }
    if (empty) empty.classList.add('hidden');
    state.history.forEach(function (h) {
      var tr = document.createElement('tr');
      var cells = [
        esc(h.when), 'Case #' + h.id + ' · ' + esc(h.file),
        esc(h.grade), (h.conf * 100).toFixed(1) + '%',
        String(h.quality).charAt(0).toUpperCase() + String(h.quality).slice(1),
        statusPillText(h.quality)
      ];
      cells.forEach(function (c, i) {
        var td = document.createElement('td');
        if (i === 5) {
          var s = el('span', 'pill', c);
          td.appendChild(s);
        } else td.textContent = c;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  function renderOverview() {
    var n = state.history.length;
    if ($('statSessionCount')) $('statSessionCount').textContent = String(n);
    if ($('statSessionHint')) $('statSessionHint').textContent = n ? (n + (n === 1 ? ' screening' : ' screenings') + ' this session.') : 'No screenings yet this session.';
    if (n) {
      var last = state.history[0];
      if ($('statLastGrade')) $('statLastGrade').textContent = last.grade;
      if ($('statLastConf')) $('statLastConf').textContent = (last.conf * 100).toFixed(1) + '% confidence · ' + last.when;
    }
    var box = $('overviewRecent');
    if (!box) return;
    box.innerHTML = '';
    if (!n) {
      box.innerHTML = '<div class="empty-state"><div class="empty-icon" aria-hidden="true">▦</div>' +
        '<p class="empty-title">No screenings yet</p>' +
        '<p class="empty-sub">Start a new screening to begin building your session history.</p>' +
        '<button class="btn btn-primary btn-sm" data-goto="screening"><span>Start screening</span></button></div>';
      bindGoto(box);
      return;
    }
    state.history.slice(0, 3).forEach(function (h) {
      var row = el('div', 'bar-row' + '');
      row.style.gridTemplateColumns = '1fr auto';
      row.style.padding = '.5rem 0';
      row.style.borderTop = '1px solid var(--border-soft)';
      var left = el('div', '', '');
      left.innerHTML = '<strong></strong><div class="fine-print"></div>';
      left.querySelector('strong').textContent = 'Case #' + h.id + ' — ' + h.grade;
      left.querySelector('.fine-print').textContent = h.when + ' · ' + (h.conf * 100).toFixed(1) + '% · Quality: ' + h.quality;
      var pill = el('span', 'pill', statusPillText(h.quality));
      row.appendChild(left); row.appendChild(pill);
      box.appendChild(row);
    });
  }

  function renderInsights() {
    var n = state.history.length;
    if ($('insCount')) $('insCount').textContent = String(n);
    if (!n) {
      if ($('insAvgConf')) $('insAvgConf').textContent = '—';
      if ($('insTopGrade')) $('insTopGrade').textContent = '—';
      if ($('insQuality')) $('insQuality').textContent = '—';
      if ($('insightsDist')) $('insightsDist').innerHTML = '';
      if ($('insightsEmpty')) $('insightsEmpty').classList.remove('hidden');
      return;
    }
    if ($('insightsEmpty')) $('insightsEmpty').classList.add('hidden');
    var avg = state.history.reduce(function (a, h) { return a + h.conf; }, 0) / n;
    if ($('insAvgConf')) $('insAvgConf').textContent = (avg * 100).toFixed(1) + '%';
    var counts = {};
    state.history.forEach(function (h) { counts[h.grade] = (counts[h.grade] || 0) + 1; });
    var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
    if ($('insTopGrade')) $('insTopGrade').textContent = top;
    var pass = state.history.filter(function (h) { return String(h.quality).toLowerCase() === 'acceptable'; }).length;
    if ($('insQuality')) $('insQuality').textContent = ((pass / n) * 100).toFixed(0) + '%';
    var dist = $('insightsDist');
    dist.innerHTML = '';
    CLASS_ORDER.forEach(function (c) {
      var k = counts[c] || 0;
      dist.appendChild(barRow(c, (k / n) * 100, c === top));
    });
  }

  /* ---------- Image viewer ---------- */
  function applyZoom() {
    var img = $('resultImage');
    if (img) img.style.transform = 'scale(' + state.zoom + ')';
  }
  function setImgTab(tab) {
    document.querySelectorAll('[data-imgtab]').forEach(function (b) {
      var on = b.dataset.imgtab === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var img = $('resultImage');
    var notice = $('viewerNotice');
    if (!img || !state.result) return;

    var g = state.result.gradcam || {};
    var s = state.result.structures || {};
    var l = state.result.lesions || {};

    var targetSrc = state.fileURL;
    var noteMsg = '';

    if (tab === 'attention' && g.heatmap_png_base64) {
      targetSrc = 'data:image/png;base64,' + g.heatmap_png_base64;
      noteMsg = 'Grad-CAM Attention Heatmap (JET Colormap)';
    } else if (tab === 'overlay' && g.overlay_png_base64) {
      targetSrc = 'data:image/png;base64,' + g.overlay_png_base64;
      noteMsg = 'Grad-CAM Heatmap Overlay (Blended Fundus + Attention)';
    } else if (tab === 'vessel' && s.vessel_png_base64) {
      targetSrc = 'data:image/png;base64,' + s.vessel_png_base64;
      noteMsg = 'Retinal Vessel Segmentation Mask (DRIVE UNet / Proxy)';
    } else if (tab === 'exudate' && l.exudate_png_base64) {
      targetSrc = 'data:image/png;base64,' + l.exudate_png_base64;
      noteMsg = 'Exudate Lesion Segmentation Mask (IDRiD UNet / Proxy)';
    } else {
      targetSrc = state.fileURL;
      noteMsg = 'Original fundus image';
    }

    img.src = targetSrc;
    if (notice) notice.classList.add('hidden');
    if (noteMsg) toast(noteMsg, 'info');
  }

  function downloadPdfReport() {
    toast('Generating vector PDF clinical report...', 'info');
    if (state.file) {
      var fd = new FormData();
      fd.append('image', state.file);
      fetch('/download-pdf-report', { method: 'POST', body: fd })
        .then(function (res) {
          if (!res.ok) throw new Error('PDF generation failed');
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
          setTimeout(function() { URL.revokeObjectURL(u); }, 2000);
          toast('PDF report downloaded successfully.', 'success');
        })
        .catch(function (e) {
          toast('Error generating PDF: ' + e.message, 'error');
        });
    } else {
      window.open('/download-pdf-report-sample', '_blank');
      toast('Sample PDF report downloaded.', 'success');
    }
  }

  /* ---------- Goto buttons / drawer ---------- */
  function bindGoto(root) {
    (root || document).querySelectorAll('[data-goto]').forEach(function (b) {
      if (b.dataset.bound) return;
      b.dataset.bound = '1';
      b.addEventListener('click', function () { showView(b.dataset.goto); });
    });
  }

  function copySummary() {
    if (!state.result) { toast('No result to copy yet.', 'error'); return; }
    var p = state.result.prediction || {}, q = state.result.quality || {};
    var text = 'RetinaGuard screening summary\n' +
      'Prediction: ' + (p.grade || '—') + ' (' + (Number(p.confidence || 0) * 100).toFixed(1) + '% model confidence)\n' +
      'Quality: ' + (q.status || '—') + ' (score ' + (Number(q.score || 0) * 100).toFixed(0) + '%)\n' +
      'Model: B0_CLASSWEIGHTED_FINETUNED_224 (EfficientNetB0, 224x224)\n' +
      'Screening support only — not a medical diagnosis. Professional review required.';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast('Summary copied to clipboard.', 'success'); },
        function () { toast('Could not copy summary.', 'error'); });
    } else toast('Clipboard unavailable in this browser.', 'error');
  }

  /* ---------- Init ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    bindGoto(document);

    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.addEventListener('click', function () { showView(b.dataset.view); });
    });
    $('menuBtn').addEventListener('click', function () { document.body.classList.add('nav-open'); });
    $('sidebarClose').addEventListener('click', function () { document.body.classList.remove('nav-open'); });
    $('sidebarScrim').addEventListener('click', function () { document.body.classList.remove('nav-open'); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') document.body.classList.remove('nav-open');
    });

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

    $('changeBtn').addEventListener('click', resetUpload);
    $('analyzeBtn').addEventListener('click', analyze);
    $('newAnalysisBtn').addEventListener('click', function () {
      var needConfirm = $('setConfirm') && $('setConfirm').checked;
      if (needConfirm && !window.confirm('Discard this result and start a new analysis?')) return;
      resetUpload();
      $('resultWorkspace').classList.add('hidden');
      $('uploadWorkspace').classList.remove('hidden');
      setSteps('upload');
      showView('screening');
    });
    $('copySummaryBtn').addEventListener('click', copySummary);

    var btnPdf = $('downloadPdfBtn');
    if (btnPdf) btnPdf.addEventListener('click', downloadPdfReport);
    var btnPdfHeader = $('downloadPdfBtnHeader');
    if (btnPdfHeader) btnPdfHeader.addEventListener('click', downloadPdfReport);

    document.querySelectorAll('[data-imgtab]').forEach(function (b) {
      b.addEventListener('click', function () { setImgTab(b.dataset.imgtab); });
    });
    $('fitBtn').addEventListener('click', function () { state.zoom = 1; applyZoom(); });
    $('zoomInBtn').addEventListener('click', function () { state.zoom = Math.min(3, state.zoom + 0.25); applyZoom(); });
    $('zoomOutBtn').addEventListener('click', function () { state.zoom = Math.max(0.5, state.zoom - 0.25); applyZoom(); });
    $('resetZoomBtn').addEventListener('click', function () { state.zoom = 1; applyZoom(); });
    $('fitBtn').addEventListener('click', function () { state.zoom = 1; applyZoom(); });
    $('zoomInBtn').addEventListener('click', function () { state.zoom = Math.min(3, state.zoom + 0.25); applyZoom(); });
    $('zoomOutBtn').addEventListener('click', function () { state.zoom = Math.max(0.5, state.zoom - 0.25); applyZoom(); });
    $('resetZoomBtn').addEventListener('click', function () { state.zoom = 1; applyZoom(); });

    var refresh = $('refreshHealthBtn');
    if (refresh) refresh.addEventListener('click', function () {
      toast('Refreshing system status…', 'info');
      fetchHealth().then(function () { toast('Status updated from /health.', 'success'); });
    });

    var motion = $('setMotion');
    if (motion) motion.addEventListener('change', function () {
      document.body.classList.toggle('reduce-motion', motion.checked);
    });
    var compact = $('setCompact');
    if (compact) compact.addEventListener('change', function () {
      document.body.classList.toggle('compact', compact.checked);
    });

    renderHistory();
    renderOverview();
    renderInsights();
    fetchHealth();
    setInterval(fetchHealth, 30000);
    showView('overview');
  });
})();
