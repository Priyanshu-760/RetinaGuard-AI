import React, { useEffect, useRef } from 'react';

export function ProbBars({ classes, probabilities, highlightIndex }) {
  const refs = useRef([]);
  useEffect(() => {
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        refs.current.forEach((n, i) => {
          if (n) n.style.width = `${Number(probabilities[i] || 0) * 100}%`;
        });
      }),
    );
    return () => cancelAnimationFrame(raf);
  }, [probabilities]);

  return (
    <div className="bars">
      {probabilities.map((p, i) => (
        <div key={classes[i] || i} className={`bar-row${i === highlightIndex ? ' hl' : ''}`}>
          <span className="lbl">{classes[i]}</span>
          <div className="bar">
            <div ref={(n) => { refs.current[i] = n; }} />
          </div>
          <span className="pct">{(Number(p) * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

const STAGES = [
  { id: 'received', title: 'Image received', sub: 'Upload validated · format & size checked' },
  { id: 'quality', title: 'Assessing image quality', sub: 'Brightness · contrast · field of view' },
  { id: 'features', title: 'Processing retinal features', sub: 'EfficientNetB0 · 224×224 preprocessing' },
  { id: 'classify', title: 'Classifying DR severity', sub: '5-class probability distribution' },
  { id: 'report', title: 'Preparing screening result', sub: 'Quality · prediction · explainability metadata' },
];

/** Honest client-side staging display: advances on a timer while the real
 *  single POST /analyze request is in flight. Does not claim to mirror
 *  backend internals beyond the documented pipeline. */
export function AnalysisTimeline({ progress }) {
  const step = Math.min(STAGES.length - 1, Math.floor((progress / 100) * STAGES.length));
  return (
    <article className="card timeline-card" aria-live="polite">
      <div className="timeline-head">
        <div className="spinner" aria-hidden="true" />
        <div>
          <h2 className="card-title">Analyzing retinal image</h2>
          <p className="card-sub">{STAGES[step].title}…</p>
        </div>
        <span className="status-pill glass">
          <span className="dot dot-pulse" /> Processing
        </span>
      </div>
      <ol className="timeline">
        {STAGES.map((s, i) => (
          <li key={s.id} className={i < step ? 'done' : i === step ? 'active' : ''}>
            <span className="tl-icon">{i < step ? '✓' : i === step ? '●' : '○'}</span>
            <div>
              <strong>{s.title}</strong>
              <p>{s.sub}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="progress-track" aria-hidden="true">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
    </article>
  );
}

export function QualityCard({ quality }) {
  const q = quality || {};
  const status = String(q.status || '—').toLowerCase();
  const score = Number(q.score || 0);
  const fov = Number(q.fov_fraction ?? 0);
  const flags = q.flags || [];
  const needsReview = status !== 'acceptable';

  const rows = [
    { label: 'Quality score', val: `${(score * 100).toFixed(0)}%`, w: score * 100 },
    { label: 'Brightness', val: Number(q.brightness || 0).toFixed(2), w: Math.min(100, Number(q.brightness || 0) * 100) },
    { label: 'Contrast', val: Number(q.contrast || 0).toFixed(2), w: Math.min(100, Number(q.contrast || 0) * 100) },
    { label: 'Field of view', val: `${(fov * 100).toFixed(0)}%`, w: fov * 100 },
  ];

  return (
    <article className="card">
      <div className="card-head">
        <div>
          <h2 className="card-title">Image quality</h2>
          <p className="card-sub">Automated advisory assessment · not clinical validation.</p>
        </div>
        <span className={`status-badge status-${status}`}>
          {status === 'acceptable' ? 'Acceptable' : status === 'review' ? 'Review advised' : status === 'ungradable' ? 'Ungradable' : q.status}
        </span>
      </div>
      <div className="q-rows">
        {rows.map((r) => (
          <div className="q-row" key={r.label}>
            <span>{r.label}</span>
            <div className="bar"><div style={{ width: `${r.w}%` }} /></div>
            <strong>{r.val}</strong>
          </div>
        ))}
      </div>
      <dl className="kv">
        <div><dt>Dimensions</dt><dd className="mono">{q.width && q.height ? `${q.width} × ${q.height} px` : '—'}</dd></div>
        <div><dt>Black background</dt><dd className="mono">{q.black_background_fraction != null ? `${(Number(q.black_background_fraction) * 100).toFixed(1)}%` : '—'}</dd></div>
      </dl>
      <div className="flags">
        {flags.length === 0 && <span className="flag ok">No quality flags</span>}
        {flags.map((f) => (
          <span key={f} className="flag">{String(f).replace(/_/g, ' ')}</span>
        ))}
      </div>
      {needsReview && (
        <div className={`callout ${status === 'ungradable' ? 'bad' : 'warn'}`}>
          <strong>{status === 'ungradable' ? 'Ungradable — recapture advised' : 'Review required'}</strong>
          <p>
            Potential issues: {flags.length ? flags.map((f) => String(f).replace(/_/g, ' ')).join('; ') : 'suboptimal illumination or field coverage'}.
            Recommendation: capture another fundus image with improved illumination and retinal field coverage.
          </p>
        </div>
      )}
    </article>
  );
}
