import React from 'react';

export const VIEW_TITLES = {
  overview: 'Overview',
  screening: 'New Screening',
  history: 'Screening History',
  insights: 'AI Insights',
  model: 'Model Information',
  status: 'System Status',
  settings: 'Settings',
};

const NAV_GROUPS = [
  {
    label: 'Workspace',
    items: [
      { id: 'overview', label: 'Overview', icon: '▦' },
      { id: 'screening', label: 'New Screening', icon: '+' },
      { id: 'history', label: 'Screening History', icon: '◔', count: true },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { id: 'insights', label: 'AI Insights', icon: '↗' },
      { id: 'model', label: 'Model Information', icon: '⬡' },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'status', label: 'System Status', icon: '◉' },
      { id: 'settings', label: 'Settings', icon: '⚙' },
    ],
  },
];

export function Sidebar({ view, onNav, online, historyCount, open, onClose }) {
  return (
    <>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <div className="brand-text">
            <span className="brand-name">RetinaGuard</span>
            <span className="brand-sub">AI screening platform</span>
          </div>
          <button className="icon-btn sidebar-close" onClick={onClose} aria-label="Close navigation">
            ✕
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_GROUPS.map((g) => (
            <React.Fragment key={g.label}>
              <p className="nav-group-label">{g.label}</p>
              {g.items.map((item) => (
                <button
                  key={item.id}
                  className={`nav-item${view === item.id ? ' is-active' : ''}`}
                  onClick={() => onNav(item.id)}
                  aria-current={view === item.id ? 'page' : undefined}
                >
                  <span className="nav-glyph" aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                  {item.count && <span className="nav-count">{historyCount}</span>}
                </button>
              ))}
            </React.Fragment>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sys-pill" role="status">
            <span className={`dot ${online ? 'dot-live' : 'dot-off'}`} />
            <span>{online ? 'System Online' : 'System Offline'}</span>
          </div>
          <div className="model-chip">
            <span className="mono">EfficientNetB0</span>
            <span className="mono muted">B0_CLASSWEIGHTED_FINETUNED_224</span>
          </div>
        </div>
      </aside>
      <div
        className={`sidebar-scrim${open ? ' is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
    </>
  );
}

export function Topbar({ view, online, onNav, onMenu }) {
  return (
    <header className="topbar glass-sticky">
      <div className="topbar-left">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open navigation">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="crumbs">
          <span className="crumb-root">RetinaGuard</span>
          <span className="crumb-sep" aria-hidden="true">/</span>
          <span className="crumb-current">{VIEW_TITLES[view]}</span>
        </div>
      </div>
      <div className="topbar-right">
        <span className="status-pill" role="status">
          <span className={`dot ${online ? 'dot-live' : 'dot-off'}`} />
          <span>{online ? 'Online' : 'Offline'}</span>
        </span>
        <button className="btn btn-primary btn-sm" onClick={() => onNav('screening')}>
          <span>+ New Screening</span>
        </button>
      </div>
    </header>
  );
}

export function Toasts({ toasts }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role="status">
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

export function SafetyStrip() {
  return (
    <div className="safety-strip" role="note">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <p>
        <strong>Screening support only.</strong> This result is not a medical diagnosis and
        requires review by a qualified healthcare professional.
      </p>
    </div>
  );
}

export function EmptyState({ title, sub, actionLabel, onAction }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">▦</div>
      <p className="empty-title">{title}</p>
      <p className="empty-sub">{sub}</p>
      {actionLabel && (
        <button className="btn btn-primary btn-sm" onClick={onAction}>
          <span>{actionLabel}</span>
        </button>
      )}
    </div>
  );
}
