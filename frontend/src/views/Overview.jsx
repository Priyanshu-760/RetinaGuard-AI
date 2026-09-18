import React from 'react';
import { SafetyStrip, EmptyState } from '../components/chrome.jsx';

const PIPELINE = [
  ['Upload', 'Fundus image · JPG / PNG · ≤10 MB'],
  ['Quality check', 'Brightness · contrast · field of view · flags'],
  ['AI screening', 'EfficientNetB0 feature analysis'],
  ['Prediction', '5-class severity + confidence'],
  ['Explainability', 'Grad-CAM metadata · advisory only'],
  ['Clinical review', 'Professional review required'],
];

export default function Overview({ history, online, onNav }) {
  const n = history.length;
  const last = history[0];

  return (
    <section aria-labelledby="overviewTitle">
      <div className="page-head">
        <div>
          <h1 id="overviewTitle">Retinal Screening Workspace</h1>
          <p className="page-sub">
            AI-assisted diabetic retinopathy screening with automated image quality
            assessment and explainable analysis.
          </p>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-primary" onClick={() => onNav('screening')}>
            <span>+ New Screening</span>
          </button>
          <button className="btn btn-secondary" onClick={() => onNav('model')}>
            <span>How it works</span>
          </button>
        </div>
      </div>

      <SafetyStrip />

      <div className="stat-grid">
        <article className="card stat-card">
          <div className="stat-top"><span className="stat-label">Session screenings</span><span className="stat-icon">◈</span></div>
          <div className="stat-value">{n}</div>
          <p className="stat-hint">{n ? `${n} screening${n === 1 ? '' : 's'} this session.` : 'No screenings yet this session.'}</p>
        </article>
        <article className="card stat-card">
          <div className="stat-top"><span className="stat-label">Last prediction</span><span className="stat-icon">◎</span></div>
          <div className="stat-value">{last ? last.grade : '—'}</div>
          <p className="stat-hint">{last ? `${(last.conf * 100).toFixed(1)}% confidence · ${last.when}` : 'Run a screening to see results here.'}</p>
        </article>
        <article className="card stat-card">
          <div className="stat-top"><span className="stat-label">Model</span><span className="stat-icon">⬡</span></div>
          <div className="stat-value small mono">B0_CLASSWEIGHTED…</div>
          <p className="stat-hint">EfficientNetB0 · 224×224 · 5 classes · frozen</p>
        </article>
        <article className="card stat-card">
          <div className="stat-top"><span className="stat-label">Inference service</span><span className={`dot ${online ? 'dot-live' : 'dot-off'}`} /></div>
          <div className="stat-value small">{online ? 'Online' : 'Offline'}</div>
          <p className="stat-hint">Live status from /health.</p>
        </article>
      </div>

      <div className="two-col">
        <article className="card">
          <div className="card-head">
            <div><h2 className="card-title">Screening pipeline</h2><p className="card-sub">Every image follows the same auditable path.</p></div>
            <button className="btn btn-ghost btn-sm" onClick={() => onNav('screening')}><span>Start upload →</span></button>
          </div>
          <ol className="pipeline">
            {PIPELINE.map(([t, s], i) => (
              <li key={t}><span className="pipe-n">{i + 1}</span><div><strong>{t}</strong><p>{s}</p></div></li>
            ))}
          </ol>
        </article>

        <article className="card">
          <div className="card-head">
            <div><h2 className="card-title">Recent session activity</h2><p className="card-sub">Stored locally for this session only.</p></div>
            <button className="btn btn-ghost btn-sm" onClick={() => onNav('history')}><span>View all →</span></button>
          </div>
          {n === 0 ? (
            <EmptyState
              title="No screenings yet"
              sub="Start a new screening to begin building your session history."
              actionLabel="Start screening"
              onAction={() => onNav('screening')}
            />
          ) : (
            history.slice(0, 3).map((h) => (
              <div key={h.id} className="recent-row">
                <div>
                  <strong>Case #{h.id} — {h.grade}</strong>
                  <div className="fine-print">{h.when} · {(h.conf * 100).toFixed(1)}% · Quality: {h.quality}</div>
                </div>
                <span className="pill">{h.quality}</span>
              </div>
            ))
          )}
        </article>
      </div>
    </section>
  );
}
