/* ============================================================
   RetinaGuard — Frontend Application Logic v5
   Liquid Glass Medical AI Workstation
   ============================================================ */

'use strict';

/* ── Confidence ring constant ─────────────────────────────── */
const RING_CIRCUMFERENCE = 314.16; // 2 * π * r(50)

/* ── Grade configuration ──────────────────────────────────── */
const GRADE_CONFIG = {
    'No DR': { cls: 'badge-no-dr', color: '#34d399', sevColor: 'rgba(52,211,153,0.6)', gradient: 'linear-gradient(90deg,#34d399,#38bdf8)' },
    'Mild': { cls: 'badge-mild', color: '#38bdf8', sevColor: 'rgba(56,189,248,0.6)', gradient: 'linear-gradient(90deg,#38bdf8,#818cf8)' },
    'Moderate': { cls: 'badge-moderate', color: '#f59e0b', sevColor: 'rgba(245,158,11,0.6)', gradient: 'linear-gradient(90deg,#fbbf24,#f59e0b)' },
    'Severe': { cls: 'badge-severe', color: '#fb923c', sevColor: 'rgba(251,146,60,0.6)', gradient: 'linear-gradient(90deg,#fb923c,#f87171)' },
    'Proliferative': { cls: 'badge-proliferative', color: '#f87171', sevColor: 'rgba(248,113,113,0.6)', gradient: 'linear-gradient(90deg,#f87171,#ec4899)' },
};

const CLASS_NAMES = ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative'];

/* ── Element references ───────────────────────────────────── */
// Upload
const dropZone = document.getElementById('drop-zone');
const dropIdle = document.getElementById('drop-idle');
const dropPreview = document.getElementById('drop-preview');
const previewImg = document.getElementById('preview-img');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const removeBtn = document.getElementById('remove-btn');
const fileInfo = document.getElementById('file-info');
const fileNameEl = document.getElementById('file-name');
const fileDimsEl = document.getElementById('file-dims');
const fileSizeEl = document.getElementById('file-size');
const zoomControls = document.getElementById('zoom-controls');
const zoomIn = document.getElementById('zoom-in');
const zoomOut = document.getElementById('zoom-out');
const zoomReset = document.getElementById('zoom-reset');

// Analyze button and its states
const analyzeBtn = document.getElementById('analyze-btn');
const btnDefault = analyzeBtn.querySelector('.btn-default');
const btnLoadingEl = analyzeBtn.querySelector('.btn-loading');
const btnSuccessEl = analyzeBtn.querySelector('.btn-success');

// Results states
const resultsIdle = document.getElementById('results-idle');
const resultsLoading = document.getElementById('results-loading');
const resultsError = document.getElementById('results-error');
const resultsContent = document.getElementById('results-content');
const errorMsgEl = document.getElementById('error-msg');
const retryBtn = document.getElementById('retry-btn');
const newAnalysisBtn = document.getElementById('new-analysis-btn');

// Result elements
const gradeNameEl = document.getElementById('grade-name');
const gradeBadgeEl = document.getElementById('grade-badge');
const severityScale = document.getElementById('severity-scale');
const ringFill = document.getElementById('ring-fill');
const confValueEl = document.getElementById('conf-value');
const probBarsEl = document.getElementById('prob-bars');
const qualityBadgeEl = document.getElementById('quality-badge');
const qualityScoreEl = document.getElementById('quality-score');
const qualityMetrics = document.getElementById('quality-metrics');
const qualityFlags = document.getElementById('quality-flags');
const gradcamInfoEl = document.getElementById('gradcam-info');
const metaGridEl = document.getElementById('meta-grid');
const preprocGridEl = document.getElementById('preproc-grid');

// Header
const healthBadge = document.getElementById('health-badge');
const badgeDot = document.getElementById('badge-dot');
const badgeLabel = document.getElementById('badge-label');
const navModelLabel = document.getElementById('nav-model-label');

// Toast
const toastContainer = document.getElementById('toast-container');

/* ── State ────────────────────────────────────────────────── */
let currentFile = null;
let currentZoom = 1.0;
const ZOOM_STEP = 0.25;
const ZOOM_MAX = 3.0;
const ZOOM_MIN = 0.5;

/* ── Utility helpers ──────────────────────────────────────── */
function formatBytes(b) {
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1048576).toFixed(2)} MB`;
}

function pct(v) { return `${(v * 100).toFixed(1)}%`; }
function fixed3(v) { return parseFloat(v).toFixed(3); }

function createEl(tag, cls, html = '') {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html) el.innerHTML = html;
    return el;
}

function show(el) { if (el) el.hidden = false; }
function hide(el) { if (el) el.hidden = true; }

/* ── Toast notifications ──────────────────────────────────── */
const TOAST_ICONS = {
    success: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><path d="M8 12l3 3 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    error: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v5M12 15.5v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    info: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><path d="M12 11v6M12 8v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
};

function showToast(message, type = 'info', duration = 4000) {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `${TOAST_ICONS[type] || TOAST_ICONS.info}<span>${message}</span>`;
    toastContainer.appendChild(t);
    setTimeout(() => {
        t.classList.add('toast-hiding');
        t.addEventListener('animationend', () => t.remove(), { once: true });
    }, duration);
}

/* ── Health check ─────────────────────────────────────────── */
async function checkHealth() {
    try {
        const res = await fetch('/health');
        if (!res.ok) throw new Error('not ok');
        const data = await res.json();

        // Online state
        badgeDot.style.background = '#34d399';
        badgeDot.style.boxShadow = '0 0 0 2px rgba(52,211,153,0.2)';
        badgeLabel.textContent = 'Service Online';
        healthBadge.className = 'nav-badge';

        if (data.model) {
            navModelLabel.textContent = `${data.model} · ${data.input_size}`;
        }
    } catch {
        badgeDot.style.background = '#f87171';
        badgeDot.style.boxShadow = '0 0 6px rgba(248,113,113,0.5)';
        badgeDot.style.animation = 'none';
        badgeLabel.textContent = 'Service Offline';
        healthBadge.style.color = '#f87171';
        healthBadge.style.background = 'rgba(248,113,113,0.08)';
        healthBadge.style.borderColor = 'rgba(248,113,113,0.25)';
        showToast('Service health check failed. The model server may be unavailable.', 'error', 7000);
    }
}

/* ── File validation ──────────────────────────────────────── */
function validateFile(file) {
    const allowed = ['image/png', 'image/jpeg', 'image/jpg'];
    if (!allowed.includes(file.type)) {
        showToast('Unsupported file type. Please upload a PNG or JPEG fundus image.', 'error');
        return false;
    }
    if (file.size > 10 * 1024 * 1024) {
        showToast('File too large. Maximum allowed size is 10 MB.', 'error');
        return false;
    }
    return true;
}

/* ── Image preview + dimension extraction ─────────────────── */
function showPreview(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        previewImg.src = e.target.result;
        hide(dropIdle);
        show(dropPreview);

        // Get natural dimensions once image loads
        const tmpImg = new Image();
        tmpImg.onload = () => {
            if (fileDimsEl) {
                fileDimsEl.textContent = `· ${tmpImg.naturalWidth}×${tmpImg.naturalHeight}`;
            }
        };
        tmpImg.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

/* ── Handle file selection ────────────────────────────────── */
function handleFile(file) {
    if (!file) return;
    if (!validateFile(file)) return;

    currentFile = file;
    resetZoom();
    showPreview(file);

    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = `· ${formatBytes(file.size)}`;
    if (fileDimsEl) fileDimsEl.textContent = ''; // will populate after image loads
    show(fileInfo);
    show(zoomControls);

    setAnalyzeState('default');
    analyzeBtn.disabled = false;
    showIdle();
    showToast(`Image loaded: ${file.name}`, 'info', 2500);
}

/* ── Clear file ───────────────────────────────────────────── */
function clearFile() {
    currentFile = null;
    fileInput.value = '';
    previewImg.src = '';
    hide(dropPreview);
    show(dropIdle);
    hide(fileInfo);
    hide(zoomControls);
    resetZoom();
    analyzeBtn.disabled = true;
    setAnalyzeState('default');
    showIdle();
}

/* ── Zoom controls ────────────────────────────────────────── */
function applyZoom(z) {
    currentZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    previewImg.style.transform = `scale(${currentZoom})`;
}

function resetZoom() {
    currentZoom = 1.0;
    if (previewImg) previewImg.style.transform = 'scale(1)';
}

if (zoomIn) zoomIn.addEventListener('click', () => applyZoom(currentZoom + ZOOM_STEP));
if (zoomOut) zoomOut.addEventListener('click', () => applyZoom(currentZoom - ZOOM_STEP));
if (zoomReset) zoomReset.addEventListener('click', () => applyZoom(1.0));

/* ── Drop zone event wiring ───────────────────────────────── */
browseBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
dropZone.addEventListener('click', () => { if (!currentFile) fileInput.click(); });
dropZone.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !currentFile) { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
removeBtn.addEventListener('click', (e) => { e.stopPropagation(); clearFile(); });

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', (e) => {
    if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
});

/* ── Analyze button state machine ─────────────────────────── */
function setAnalyzeState(state) {
    // 'default' | 'loading' | 'success'
    if (!btnDefault || !btnLoadingEl || !btnSuccessEl) return;

    btnDefault.hidden = (state !== 'default');
    btnLoadingEl.hidden = (state !== 'loading');
    btnSuccessEl.hidden = (state !== 'success');
}

/* ── Results panel state helpers ──────────────────────────── */
function showIdle() {
    show(resultsIdle);
    hide(resultsLoading);
    hide(resultsError);
    hide(resultsContent);
}

function showLoading() {
    hide(resultsIdle);
    show(resultsLoading);
    hide(resultsError);
    hide(resultsContent);
}

function showError(msg) {
    hide(resultsIdle);
    hide(resultsLoading);
    show(resultsError);
    hide(resultsContent);
    if (errorMsgEl) errorMsgEl.textContent = msg;
}

function showResults() {
    hide(resultsIdle);
    hide(resultsLoading);
    hide(resultsError);
    show(resultsContent);
    if (window.innerWidth < 900) {
        resultsContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/* ── Button events ────────────────────────────────────────── */
if (retryBtn) retryBtn.addEventListener('click', showIdle);

if (newAnalysisBtn) {
    newAnalysisBtn.addEventListener('click', () => {
        clearFile();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

/* ── Analyze request ──────────────────────────────────────── */
analyzeBtn.addEventListener('click', async () => {
    if (!currentFile) return;

    // Lock UI
    analyzeBtn.disabled = true;
    setAnalyzeState('loading');
    showLoading();

    try {
        const formData = new FormData();
        formData.append('image', currentFile);

        const res = await fetch('/analyze', { method: 'POST', body: formData });
        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(data.error || `Server error (${res.status})`);
        }

        renderResults(data);

        // Brief success state before re-enabling
        setAnalyzeState('success');
        setTimeout(() => {
            setAnalyzeState('default');
            analyzeBtn.disabled = false;
        }, 2000);

        showResults();
        showToast(
            `Analysis complete — ${data.prediction.grade} · ${Math.round(data.prediction.confidence * 100)}% confidence`,
            'success'
        );

    } catch (err) {
        const rawErr = (err && err.message) ? err.message : String(err);
        const trace = err.stack ? err.stack : '';
        const fullMsg = `ERROR: ${rawErr}\n${trace}`;

        showError(fullMsg);
        showToast('Failed. See error card for details.', 'error');
        setAnalyzeState('default');
        analyzeBtn.disabled = false;
    }
});

/* ── Master render function ───────────────────────────────── */
function renderResults(data) {
    const { prediction, quality, model, gradcam, preprocessing } = data;
    renderPrediction(prediction);
    renderConfidenceRing(prediction.confidence);
    renderSeverityScale(prediction.class_index);
    renderProbabilities(prediction);
    renderQuality(quality);
    renderExplainability(gradcam);
    renderModelInfo(model);
    renderPreprocessing(preprocessing);
}

/* ── Grade / Prediction ───────────────────────────────────── */
function renderPrediction(pred) {
    const { grade, confidence } = pred;
    const cfg = GRADE_CONFIG[grade] || { cls: 'badge-mild', color: '#a78bfa', gradient: 'linear-gradient(90deg,#a78bfa,#38bdf8)' };

    // Large grade name with gradient text
    if (gradeNameEl) {
        gradeNameEl.textContent = grade;
        Object.assign(gradeNameEl.style, {
            background: cfg.gradient,
            webkitBackgroundClip: 'text',
            webkitTextFillColor: 'transparent',
            backgroundClip: 'text',
        });
    }

    // Badge
    if (gradeBadgeEl) {
        gradeBadgeEl.textContent = grade;
        gradeBadgeEl.className = `grade-badge ${cfg.cls}`;
    }
}

/* ── Confidence ring ──────────────────────────────────────── */
function renderConfidenceRing(confidence) {
    const pctVal = (confidence * 100).toFixed(2);
    const offset = RING_CIRCUMFERENCE * (1 - confidence);

    if (confValueEl) confValueEl.textContent = `${Math.round(confidence * 100)}%`;
    if (ringFill)
        document.getElementById('conf-ring-wrap')
            ?.setAttribute('aria-label', `Model confidence: ${pctVal}%`);

    // Animate after paint
    requestAnimationFrame(() => {
        if (ringFill) ringFill.style.strokeDashoffset = offset.toFixed(3);
    });
}

/* ── Severity scale ───────────────────────────────────────── */
function renderSeverityScale(classIndex) {
    if (!severityScale) return;
    const steps = severityScale.querySelectorAll('.sev-step');
    steps.forEach((step, i) => {
        const cfg = GRADE_CONFIG[CLASS_NAMES[i]];
        const isActive = i === classIndex;

        step.classList.toggle('is-active', isActive);
        if (isActive && cfg) {
            step.style.setProperty('--sev-clr', cfg.sevColor);
        } else {
            step.style.removeProperty('--sev-clr');
        }
    });
}

/* ── Probability bars ─────────────────────────────────────── */
function renderProbabilities(pred) {
    const { probabilities, class_index } = pred;
    probBarsEl.innerHTML = '';

    CLASS_NAMES.forEach((name, i) => {
        const prob = probabilities[i] ?? 0;
        const isTop = i === class_index;
        const cfg = GRADE_CONFIG[name] || { gradient: 'linear-gradient(90deg,#a78bfa,#38bdf8)', color: '#a78bfa' };

        const row = createEl('div', `prob-row${isTop ? ' is-top' : ''}`, `
      <div class="prob-label-row" role="listitem">
        <span class="prob-class-name">${name}</span>
        <span class="prob-pct">${pct(prob)}</span>
      </div>
      <div class="prob-track" role="progressbar"
           aria-valuemin="0" aria-valuemax="100"
           aria-valuenow="${Math.round(prob * 100)}"
           aria-label="${name}: ${pct(prob)}">
        <div class="prob-fill" style="width:0%;background:${cfg.gradient};${isTop ? `box-shadow:0 0 8px ${cfg.color}55` : ''}"></div>
      </div>
    `);

        probBarsEl.appendChild(row);
        requestAnimationFrame(() => {
            row.querySelector('.prob-fill').style.width = `${(prob * 100).toFixed(2)}%`;
        });
    });
}

/* ── Image Quality ────────────────────────────────────────── */
function renderQuality(q) {
    const { status, score, brightness, contrast, black_background_fraction, fov_fraction, width, height, flags } = q;

    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
    qualityBadgeEl.textContent = statusLabel;
    qualityBadgeEl.className = `quality-badge quality-${status.toLowerCase()}`;
    qualityScoreEl.textContent = `${(score * 100).toFixed(0)} / 100`;

    const scoreColors = { acceptable: '#34d399', review: '#f59e0b', ungradable: '#f87171' };
    qualityScoreEl.style.color = scoreColors[status] ?? '#a78bfa';

    qualityMetrics.innerHTML = '';
    [
        { label: 'Resolution', value: `${width}×${height}` },
        { label: 'Brightness', value: fixed3(brightness) },
        { label: 'Contrast', value: fixed3(contrast) },
        { label: 'Black BG', value: pct(black_background_fraction) },
        { label: 'FOV', value: pct(fov_fraction) },
        { label: 'Score', value: `${(score * 100).toFixed(1)}%` },
    ].forEach(({ label, value }) => {
        qualityMetrics.appendChild(
            createEl('div', 'metric-chip',
                `<span class="metric-label">${label}</span><span class="metric-value">${value}</span>`)
        );
    });

    if (flags && flags.length > 0) {
        qualityFlags.innerHTML = '';
        flags.forEach(f => {
            qualityFlags.appendChild(createEl('span', 'flag-tag', f.replace(/_/g, ' ')));
        });
        show(qualityFlags);

        if (status === 'ungradable') {
            showToast('Image quality is ungradable. Screening results may be unreliable.', 'error', 6000);
        } else if (status === 'review') {
            showToast('Image quality flagged for review. Consider re-uploading a clearer photograph.', 'info', 5000);
        }
    } else {
        hide(qualityFlags);
    }
}

/* ── Explainability metadata ──────────────────────────────── */
function renderExplainability(gradcam) {
    gradcamInfoEl.innerHTML = '';
    if (!gradcam) {
        gradcamInfoEl.innerHTML = '<span style="color:var(--clr-muted);font-size:0.8rem">Not available</span>';
        return;
    }

    [
        { label: 'Status', value: gradcam.available ? 'Available' : 'Unavailable' },
        { label: 'Method', value: gradcam.method || 'Grad-CAM' },
        { label: 'Target Layer', value: gradcam.target_layer || '—' },
        { label: 'Type', value: 'Metadata only' },
    ].forEach(({ label, value }) => {
        gradcamInfoEl.appendChild(
            createEl('div', 'metric-chip',
                `<span class="metric-label">${label}</span><span class="metric-value">${value}</span>`)
        );
    });
}

/* ── Model information ────────────────────────────────────── */
function renderModelInfo(model) {
    metaGridEl.innerHTML = '';
    if (!model) return;

    [
        { label: 'Architecture', value: model.architecture ?? '—' },
        { label: 'Name', value: model.name ?? '—' },
        { label: 'Input', value: model.input_size ?? '—' },
        { label: 'Classes', value: model.classes ? model.classes.length : '—' },
        { label: 'Frozen Base', value: model.frozen ? 'Yes' : 'No' },
        { label: 'Task', value: 'Classification' },
    ].forEach(({ label, value }) => {
        metaGridEl.appendChild(
            createEl('div', 'meta-chip',
                `<span class="meta-label">${label}</span><span class="meta-value">${value}</span>`)
        );
    });
}

/* ── Preprocessing details ────────────────────────────────── */
function renderPreprocessing(preprocessing) {
    preprocGridEl.innerHTML = '';
    if (!preprocessing) return;

    [
        { label: 'Color Space', value: preprocessing.rgb ? 'RGB' : 'BGR' },
        { label: 'Resize', value: preprocessing.resize ?? '—' },
        { label: 'Normalisation', value: preprocessing.normalization ?? '[0,1]' },
        { label: 'Crop Threshold', value: preprocessing.crop_threshold ?? '—' },
        { label: 'Crop Padding', value: preprocessing.crop_padding ?? '—' },
        { label: 'Augmentation', value: preprocessing.augmentation ? 'Enabled' : 'Disabled (inference)' },
    ].forEach(({ label, value }) => {
        preprocGridEl.appendChild(
            createEl('div', 'preproc-chip',
                `<span class="preproc-label">${label}</span><span class="preproc-value">${value}</span>`)
        );
    });
}

/* ── Reset (new analysis) ─────────────────────────────────── */
function resetAnalysis() {
    clearFile();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── Initialise ───────────────────────────────────────────── */
checkHealth();
showIdle();
