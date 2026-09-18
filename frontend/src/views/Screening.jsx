import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CLASS_ORDER, formatBytes, gradeKey, postAnalyze } from '../api.js';
import { AnalysisTimeline, ProbBars, QualityCard } from '../components/cards.jsx';

const STEPS = ['upload', 'quality', 'screen', 'review'];
const STEP_LABELS = { upload: 'Upload', quality: 'Quality', screen: 'AI screening', review: 'Review' };

function validFile(f) {
  const ext = (f.name || '').toLowerCase().split('.').pop();
  if (!['jpg', 'jpeg', 'png'].includes(ext)) return 'Please upload a valid JPG or PNG image.';
  if (f.size > 10 * 1024 * 1024) return 'File exceeds the 10 MB limit.';
  return null;
}

export default function Screening({ onResult, notify }) {
  const [file, setFile] = useState(null);
  const [previewURL, setPreviewURL] = useState(null);
  const [dims, setDims] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | preview | analyzing | done
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [imgTab, setImgTab] = useState('original');
  const inputRef = useRef(null);
  const progressTimer = useRef(null);

  useEffect(() => () => {
    if (previewURL) URL.revokeObjectURL(previewURL);
    clearInterval(progressTimer.current);
  }, [previewURL]);

  const select = useCallback((f) => {
    if (!f) return;
    const err = validFile(f);
    if (err) { notify(err, 'error'); return; }
    setPreviewURL((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(f); });
    setFile(f);
    setDims(null);
    setResult(null);
    setPhase('preview');
    setZoom(1);
    const img = new Image();
    img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setDims(null);
    img.src = URL.createObjectURL(f);
    notify('Image ready. Review details, then run analysis.', 'success');
  }, [notify]);

  const reset = useCallback(() => {
    setFile(null);
    setPreviewURL((old) => { if (old) URL.revokeObjectURL(old); return null; });
    setDims(null);
    setResult(null);
    setPhase('idle');
    setProgress(0);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const analyze = useCallback(async () => {
    if (!file || phase === 'analyzing') return;
    setPhase('analyzing');
    setProgress(8);
    clearInterval(progressTimer.current);
    progressTimer.current = setInterval(() => {
      setProgress((p) => Math.min(92, p + 9));
    }, 450);

    try {
      const data = await postAnalyze(file);
      clearInterval(progressTimer.current);
      setProgress(100);
      setTimeout(() => {
        setResult(data);
        setPhase('done');
        onResult(data, file.name);
        notify(`Screening complete: ${data.prediction?.grade} (${(Number(data.prediction?.confidence || 0) * 100).toFixed(1)}%).`, 'success');
      }, 400);
    } catch (e) {
      clearInterval(progressTimer.current);
      setPhase('preview');
      setProgress(0);
      notify(`Error: ${e.message}`, 'error');
    }
  }, [file, phase, onResult, notify]);

  const stepIndex = phase === 'idle' || phase === 'preview' ? 0 : phase === 'analyzing' ? 2 : 3;

  return (
    <section aria-labelledby="screeningTitle">
      <div className="page-head">
        <div>
          <h1 id="screeningTitle">New Screening</h1>
          <p className="page-sub">Upload a retinal fundus image to begin AI-assisted screening.</p>
        </div>
        <ol className="steps-mini" aria-label="Workflow progress">
          {STEPS.map((s, i) => (
            <li key={s} className={i === stepIndex ? 'is-active' : i < stepIndex ? 'is-done' : ''}>
              {STEP_LABELS[s]}
            </li>
          ))}
        </ol>
      </div>

      {(phase === 'idle' || phase === 'preview') && (
        <article className="card upload-card">
          {!file ? (
            <div
              className={`drop-zone${dragOver ? ' dragover' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="Upload retinal image. Drag and drop or press Enter to browse."
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
              onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) select(e.dataTransfer.files[0]); }}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                hidden
                onChange={(e) => { if (e.target.files?.length) select(e.target.files[0]); }}
              />
              <div className="drop-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <p className="drop-title">Upload retinal image</p>
              <p className="drop-sub">Drag &amp; drop your fundus image here or <span className="linklike">browse files</span></p>
              <div className="drop-meta">
                <span className="meta-chip">JPG / JPEG / PNG</span>
                <span className="meta-chip">Maximum 10 MB</span>
                <span className="meta-chip">Fundus photo</span>
              </div>
            </div>
          ) : (
            <div className="preview-wrap">
              <div className="preview-media">
                <img src={previewURL} alt="Selected fundus image preview" />
                <span className="readiness-pill"><span className="dot dot-live" /> Image ready</span>
              </div>
              <div className="preview-info">
                <h2 className="card-title">Image ready for screening</h2>
                <dl className="file-meta">
                  <div><dt>File</dt><dd>{file.name}</dd></div>
                  <div><dt>Type</dt><dd>{file.type || 'Unknown'}</dd></div>
                  <div><dt>Size</dt><dd>{formatBytes(file.size)}</dd></div>
                  <div><dt>Dimensions</dt><dd>{dims ? `${dims.w} × ${dims.h} px` : 'Reading…'}</dd></div>
                </dl>
                <div className="preview-actions">
                  <button className="btn btn-secondary" onClick={reset}><span>Change image</span></button>
                  <button className="btn btn-primary" onClick={analyze}><span>Analyze image →</span></button>
                </div>
                <p className="fine-print">Quality is assessed automatically after upload. Advisory only — not a diagnostic gate.</p>
              </div>
            </div>
          )}
        </article>
      )}

      {phase === 'analyzing' && <AnalysisTimeline progress={progress} />}

      {phase === 'done' && result && (
        <ResultView
          data={result}
          fileName={file?.name}
          imgURL={previewURL}
          zoom={zoom}
          setZoom={setZoom}
          imgTab={imgTab}
          setImgTab={setImgTab}
          onNew={reset}
          notify={notify}
        />
      )}
    </section>
  );
}

function ResultView({ data, fileName, imgURL, zoom, setZoom, imgTab, setImgTab, onNew, notify }) {
  const pred = data.prediction || {};
  const grade = pred.grade || '—';
  const conf = Number(pred.confidence || 0);
  const probs = pred.probabilities || [];
  const classes = (data.model && data.model.classes) || CLASS_ORDER;
  const maxIdx = probs.reduce((a, p, i) => (p > probs[a] ? i : a), 0);
  const q = data.quality || {};
  const g = data.gradcam || {};
  const pre = data.preprocessing || {};
  const C = 2 * Math.PI * 52;

  const copySummary = async () => {
    const text =
      `RetinaGuard screening summary\n` +
      `Prediction: ${grade} (${(conf * 100).toFixed(1)}% model confidence)\n` +
      `Quality: ${q.status || '—'} (score ${(Number(q.score || 0) * 100).toFixed(0)}%)\n` +
      `Model: B0_CLASSWEIGHTED_FINETUNED_224 (EfficientNetB0, 224x224)\n` +
      `Screening support only — not a medical diagnosis. Professional review required.`;
    try {
      await navigator.clipboard.writeText(text);
      notify('Summary copied to clipboard.', 'success');
    } catch { notify('Could not copy summary.', 'error'); }
  };

  return (
    <div>
      <article className="card result-hero">
        <div className="result-hero-top">
          <span className="eyebrow">Screening result</span>
          <span className="status-pill glass">
            <span className={`dot ${String(q.status).toLowerCase() === 'acceptable' ? 'dot-live' : 'dot-pulse'}`} />
            Quality: {q.status}
          </span>
        </div>
        <div className="result-hero-grid">
          <div>
            <div className={`grade-badge grade-${gradeKey(grade)}`}>{grade}</div>
            <p className="grade-sub">Predicted severity grade · {classes.length}-class model</p>
            <div className="safety-inline" role="note">
              <strong>Screening support only.</strong> This result is not a medical diagnosis and
              requires review by a qualified healthcare professional.
            </div>
          </div>
          <div className="confidence-block">
            <div className="ring-wrap" role="img" aria-label={`Model confidence ${(conf * 100).toFixed(1)} percent for ${grade}`}>
              <svg className="ring" viewBox="0 0 120 120" aria-hidden="true">
                <circle cx="60" cy="60" r="52" className="ring-track" />
                <circle cx="60" cy="60" r="52" className="ring-fill" strokeDasharray={C} strokeDashoffset={C * (1 - conf)} />
              </svg>
              <div className="ring-center">
                <span className="ring-val">{(conf * 100).toFixed(1)}%</span>
                <span className="ring-label">Model confidence</span>
              </div>
            </div>
            <p className="fine-print center">Confidence reflects model output strength, not clinical probability.</p>
          </div>
        </div>
      </article>

      <div className="two-col result-grid">
        <article className="card">
          <div className="card-head">
            <div><h2 className="card-title">Retinal image</h2><p className="card-sub">{fileName || 'Uploaded fundus photograph'}</p></div>
            <div className="seg" role="tablist" aria-label="Image view">
              {['original', 'attention', 'overlay'].map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={imgTab === t}
                  className={`seg-btn${imgTab === t ? ' is-active' : ''}`}
                  onClick={() => { setImgTab(t); if (t !== 'original') notify('Only Grad-CAM metadata is available — no heatmap is rendered.', 'info'); }}
                >
                  {t === 'original' ? 'Original' : t === 'attention' ? 'AI attention' : 'Overlay'}
                </button>
              ))}
            </div>
          </div>
          <div className="viewer">
            {imgURL && <img src={imgURL} alt="Uploaded retinal fundus image used for screening" style={{ transform: `scale(${zoom})` }} />}
            {imgTab !== 'original' && (
              <div className="viewer-overlay glass">
                <strong>No heatmap image provided</strong>
                <p>The backend returns Grad-CAM metadata only (method + target layer). No attention visualization is fabricated.</p>
              </div>
            )}
          </div>
          <div className="viewer-controls">
            <button className="btn btn-ghost btn-sm" onClick={() => setZoom(1)}><span>Fit</span></button>
            <button className="btn btn-ghost btn-sm" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}><span>Zoom +</span></button>
            <button className="btn btn-ghost btn-sm" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}><span>Zoom −</span></button>
            <button className="btn btn-ghost btn-sm" onClick={() => setZoom(1)}><span>Reset</span></button>
          </div>
        </article>

        <article className="card">
          <div className="card-head">
            <div><h2 className="card-title">Prediction probabilities</h2><p className="card-sub">All five severity classes · predicted class highlighted.</p></div>
          </div>
          <ProbBars classes={classes} probabilities={probs} highlightIndex={maxIdx} />
          <div className="divider" />
          <h3 className="mini-title">Model context</h3>
          <dl className="kv">
            <div><dt>Model</dt><dd className="mono">{data.model?.name || 'B0_CLASSWEIGHTED_FINETUNED_224'}</dd></div>
            <div><dt>Architecture</dt><dd>{data.model?.architecture || 'EfficientNetB0'}</dd></div>
            <div><dt>Input</dt><dd className="mono">224 × 224</dd></div>
          </dl>
        </article>
      </div>

      <div className="two-col">
        <QualityCard quality={q} />
        <article className="card">
          <div className="card-head">
            <div><h2 className="card-title">AI explanation</h2><p className="card-sub">How to interpret this prediction.</p></div>
            <span className="meta-chip">Grad-CAM · {g.available ? 'Available' : 'Unavailable'}</span>
          </div>
          <dl className="kv">
            <div><dt>Method</dt><dd>{g.method || 'Grad-CAM'}</dd></div>
            <div><dt>Target layer</dt><dd className="mono">{g.target_layer || 'top_conv'}</dd></div>
            <div><dt>Status</dt><dd>{g.note || 'Model explainability metadata. Not clinical evidence.'}</dd></div>
          </dl>
          <div className="callout neutral">
            <strong>AI attention visualization is not clinical evidence.</strong>
            <p>Only metadata is currently provided by the backend, so no heatmap is rendered. Lesion localisation must be confirmed by a clinician.</p>
          </div>
          <div className="divider" />
          <h3 className="mini-title">Preprocessing</h3>
          <div className="chip-row">
            <span className="meta-chip">RGB</span>
            <span className="meta-chip">Resize {pre.resize || '224×224'}</span>
            <span className="meta-chip">Normalize {pre.normalization || '[0,1]'}</span>
            <span className="meta-chip">{pre.augmentation ? 'Augmentation on' : 'No augmentation'}</span>
          </div>
        </article>
      </div>

      <div className="result-actions">
        <button className="btn btn-secondary" onClick={onNew}><span>Start new analysis</span></button>
        <button className="btn btn-ghost" onClick={copySummary}><span>Copy summary</span></button>
      </div>
    </div>
  );
}
