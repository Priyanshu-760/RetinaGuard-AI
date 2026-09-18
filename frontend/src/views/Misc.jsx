import React from 'react';
import { CLASS_ORDER } from '../api.js';
import { EmptyState } from '../components/chrome.jsx';
import { ProbBars } from '../components/cards.jsx';

export function History({ history, onNav }) {
  return (
    <section aria-labelledby="historyTitle">
      <div className="page-head">
        <div>
          <h1 id="historyTitle">Screening History</h1>
          <p className="page-sub">Session-local record. No persistent storage or patient data is fabricated.</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => onNav('screening')}><span>+ New screening</span></button>
      </div>
      <article className="card">
        <div className="table-wrap">
          {history.length === 0 ? (
            <EmptyState
              title="No saved screenings yet."
              sub="Start a new screening to begin building your history."
              actionLabel="Start a new screening"
              onAction={() => onNav('screening')}
            />
          ) : (
            <table className="table">
              <thead>
                <tr><th scope="col">Date</th><th scope="col">Case</th><th scope="col">Prediction</th><th scope="col">Confidence</th><th scope="col">Image quality</th><th scope="col">Status</th></tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.when}</td>
                    <td>Case #{h.id} · {h.file}</td>
                    <td>{h.grade}</td>
                    <td>{(h.conf * 100).toFixed(1)}%</td>
                    <td style={{ textTransform: 'capitalize' }}>{h.quality}</td>
                    <td><span className="pill">{h.quality === 'acceptable' ? 'Reviewed' : h.quality === 'review' ? 'Needs review' : 'Recapture'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </article>
    </section>
  );
}

export function Insights({ history }) {
  const n = history.length;
  const avg = n ? history.reduce((a, h) => a + h.conf, 0) / n : 0;
  const counts = {};
  history.forEach((h) => { counts[h.grade] = (counts[h.grade] || 0) + 1; });
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const pass = history.filter((h) => String(h.quality).toLowerCase() === 'acceptable').length;

  return (
    <section aria-labelledby="insightsTitle">
      <div className="page-head">
        <div>
          <h1 id="insightsTitle">AI Insights</h1>
          <p className="page-sub">Aggregates computed only from screenings run in this session. No clinical statistics are fabricated.</p>
        </div>
      </div>
      <div className="stat-grid">
        <article className="card stat-card"><div className="stat-top"><span className="stat-label">Screenings this session</span></div><div className="stat-value">{n}</div><p className="stat-hint">Local session only.</p></article>
        <article className="card stat-card"><div className="stat-top"><span className="stat-label">Average confidence</span></div><div className="stat-value">{n ? `${(avg * 100).toFixed(1)}%` : '—'}</div><p className="stat-hint">Mean model confidence.</p></article>
        <article className="card stat-card"><div className="stat-top"><span className="stat-label">Most frequent grade</span></div><div className="stat-value">{top || '—'}</div><p className="stat-hint">Session distribution.</p></article>
        <article className="card stat-card"><div className="stat-top"><span className="stat-label">Quality pass rate</span></div><div className="stat-value">{n ? `${((pass / n) * 100).toFixed(0)}%` : '—'}</div><p className="stat-hint">Share marked acceptable.</p></article>
      </div>
      <article className="card">
        <div className="card-head"><div><h2 className="card-title">Grade distribution (this session)</h2><p className="card-sub">Live from your session history.</p></div></div>
        {n === 0 ? (
          <EmptyState title="No data yet" sub="Run at least one screening to populate insights." />
        ) : (
          <ProbBars
            classes={CLASS_ORDER}
            probabilities={CLASS_ORDER.map((c) => (counts[c] || 0) / n)}
            highlightIndex={CLASS_ORDER.indexOf(top)}
          />
        )}
      </article>
    </section>
  );
}

export function ModelInfo() {
  const steps = [
    ['Fundus image', 'JPG / PNG · ≤10 MB'],
    ['Image quality assessment', 'Advisory score + flags'],
    ['Preprocessing', 'Crop · resize · normalize'],
    ['EfficientNetB0', 'Frozen weights'],
    ['5-class prediction', 'Probabilities + confidence'],
    ['Explainability', 'Grad-CAM metadata'],
    ['Screening result', 'Clinical review required'],
  ];
  return (
    <section aria-labelledby="modelTitle">
      <div className="page-head">
        <div><h1 id="modelTitle">Model Information</h1><p className="page-sub">Frozen champion model · auditable inference path.</p></div>
        <span className="meta-chip">TensorFlow / Keras</span>
      </div>
      <div className="two-col">
        <article className="card">
          <h2 className="card-title">Champion model</h2>
          <dl className="kv big">
            <div><dt>Model</dt><dd className="mono">B0_CLASSWEIGHTED_FINETUNED_224</dd></div>
            <div><dt>Architecture</dt><dd>EfficientNetB0</dd></div>
            <div><dt>Input</dt><dd className="mono">224 × 224 · RGB · [0,1]</dd></div>
            <div><dt>Classes</dt><dd>5 — No DR · Mild · Moderate · Severe · Proliferative</dd></div>
            <div><dt>Framework</dt><dd>TensorFlow / Keras</dd></div>
            <div><dt>Inference</dt><dd>Frozen champion · softmax output · no re-normalization</dd></div>
          </dl>
          <div className="divider" />
          <h3 className="mini-title">Preprocessing</h3>
          <div className="chip-row">
            <span className="meta-chip">RGB</span><span className="meta-chip">Crop (thr 10 · pad 10)</span>
            <span className="meta-chip">Resize 224×224</span><span className="meta-chip">Normalize [0,1]</span>
            <span className="meta-chip">No augmentation</span>
          </div>
        </article>
        <article className="card">
          <h2 className="card-title">Inference pipeline</h2>
          <ol className="pipeline vertical">
            {steps.map(([t, s], i) => (
              <li key={t}><span className="pipe-n">{i + 1}</span><div><strong>{t}</strong><p>{s}</p></div></li>
            ))}
          </ol>
        </article>
      </div>
    </section>
  );
}

export function Status({ health, online, checkedAt, onRefresh }) {
  const h = health || {};
  return (
    <section aria-labelledby="statusTitle">
      <div className="page-head">
        <div><h1 id="statusTitle">System Status</h1><p className="page-sub">Live values from <span className="mono">GET /health</span>. State is never hardcoded.</p></div>
        <button className="btn btn-secondary btn-sm" onClick={onRefresh}><span>Refresh status</span></button>
      </div>
      <div className="stat-grid">
        <article className="card stat-card"><div className="stat-top"><span className="stat-label">API status</span><span className={`dot ${online ? 'dot-live' : 'dot-off'}`} /></div><div className="stat-value small">{online ? 'Online' : 'Offline'}</div><p className="stat-hint">{online ? 'GET /health responding.' : 'GET /health unreachable.'}</p></article>
        <article className="card stat-card"><div className="stat-top"><span className="stat-label">Model status</span><span className={`dot ${online ? 'dot-live' : 'dot-off'}`} /></div><div className="stat-value small">{h.model || (online ? 'Loaded' : 'Unknown')}</div><p className="stat-hint">Champion weights.</p></article>
        <article className="card stat-card"><div className="stat-top"><span className="stat-label">Inference service</span><span className={`dot ${online ? 'dot-live' : 'dot-off'}`} /></div><div className="stat-value small">{online ? 'Ready' : 'Unavailable'}</div><p className="stat-hint">POST /analyze readiness.</p></article>
        <article className="card stat-card"><div className="stat-top"><span className="stat-label">Input size</span></div><div className="stat-value small mono">{h.input_size || '224x224'}</div><p className="stat-hint">Expected model input.</p></article>
      </div>
      <article className="card">
        <h2 className="card-title">Service details</h2>
        <dl className="kv big">
          <div><dt>Service</dt><dd className="mono">{h.service || 'RetinaGuard'}</dd></div>
          <div><dt>Model version</dt><dd className="mono">{h.model || 'B0_CLASSWEIGHTED_FINETUNED_224'}</dd></div>
          <div><dt>Supported classes</dt><dd>{h.classes ?? 5} — No DR · Mild · Moderate · Severe · Proliferative</dd></div>
          <div><dt>Last checked</dt><dd className="mono">{checkedAt || '—'}</dd></div>
        </dl>
        <pre className="code" aria-label="Raw health response">{Object.keys(h).length ? JSON.stringify(h, null, 2) : 'No response from /health.'}</pre>
      </article>
    </section>
  );
}

export function Settings({ prefs, onPrefs }) {
  const row = (key, title, sub) => (
    <label className="setting-row">
      <div><strong>{title}</strong><p>{sub}</p></div>
      <input type="checkbox" className="switch" checked={!!prefs[key]} onChange={(e) => onPrefs({ ...prefs, [key]: e.target.checked })} />
    </label>
  );
  return (
    <section aria-labelledby="settingsTitle">
      <div className="page-head"><div><h1 id="settingsTitle">Settings</h1><p className="page-sub">Local display preferences. No backend or model behaviour is changed.</p></div></div>
      <div className="two-col">
        <article className="card">
          <h2 className="card-title">Display</h2>
          {row('reduceMotion', 'Reduce motion', 'Minimise animations and transitions.')}
          {row('compact', 'Compact tables', 'Denser history rows.')}
        </article>
        <article className="card">
          <h2 className="card-title">About this workspace</h2>
          <p className="card-sub">RetinaGuard is a screening-assistance demo. Image-quality assessment is advisory. Predictions require professional clinical review and are not a medical diagnosis.</p>
          <div className="chip-row"><span className="meta-chip">SIH-ready demo</span><span className="meta-chip">Rural / PHC workflow</span><span className="meta-chip">No patient data stored</span></div>
        </article>
      </div>
    </section>
  );
}
