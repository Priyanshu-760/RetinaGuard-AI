import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getHealth } from './api.js';
import { Sidebar, Topbar, Toasts } from './components/chrome.jsx';
import Overview from './views/Overview.jsx';
import Screening from './views/Screening.jsx';
import { History, Insights, ModelInfo, Status, Settings } from './views/Misc.jsx';

let toastId = 0;
let caseId = 0;

export default function App() {
  const [view, setView] = useState('overview');
  const [navOpen, setNavOpen] = useState(false);
  const [health, setHealth] = useState(null);
  const [online, setOnline] = useState(false);
  const [checkedAt, setCheckedAt] = useState(null);
  const [history, setHistory] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [prefs, setPrefs] = useState({ reduceMotion: false, compact: false });

  const notify = useCallback((msg, kind = 'info') => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const refreshHealth = useCallback(async (silent = false) => {
    try {
      const body = await getHealth();
      setHealth(body);
      setOnline(body.status === 'healthy' || !!body.service);
      setCheckedAt(new Date().toLocaleString());
      if (!silent) notify('Status updated from /health.', 'success');
    } catch {
      setHealth(null);
      setOnline(false);
      setCheckedAt(new Date().toLocaleString());
      if (!silent) notify('Could not reach /health.', 'error');
    }
  }, [notify]);

  useEffect(() => {
    refreshHealth(true);
    const t = setInterval(() => refreshHealth(true), 30000);
    return () => clearInterval(t);
  }, [refreshHealth]);

  const handleResult = useCallback((data, fileName) => {
    caseId += 1;
    const entry = {
      id: caseId,
      when: new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      file: fileName || `case-${caseId}`,
      grade: data.prediction?.grade || '—',
      conf: Number(data.prediction?.confidence || 0),
      quality: data.quality?.status || '—',
    };
    setHistory((h) => [entry, ...h]);
  }, []);

  const go = useCallback((v) => {
    setView(v);
    setNavOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    document.body.classList.toggle('reduce-motion', prefs.reduceMotion);
    document.body.classList.toggle('compact', prefs.compact);
  }, [prefs]);

  useEffect(() => {
    document.body.classList.toggle('nav-open', navOpen);
  }, [navOpen]);

  return (
    <div className="app-shell">
      <div className={`sidebar-holder${navOpen ? ' is-open' : ''}`}>
        <Sidebar view={view} onNav={go} online={online} historyCount={history.length} open={navOpen} onClose={() => setNavOpen(false)} />
      </div>

      <div className="main-col">
        <Topbar view={view} online={online} onNav={go} onMenu={() => setNavOpen(true)} />

        <main className="workspace" id="mainContent" tabIndex={-1}>
          {view === 'overview' && <Overview history={history} online={online} onNav={go} />}
          {view === 'screening' && <Screening onResult={handleResult} notify={notify} />}
          {view === 'history' && <History history={history} onNav={go} />}
          {view === 'insights' && <Insights history={history} />}
          {view === 'model' && <ModelInfo />}
          {view === 'status' && <Status health={health} online={online} checkedAt={checkedAt} onRefresh={() => refreshHealth(false)} />}
          {view === 'settings' && <Settings prefs={prefs} onPrefs={setPrefs} />}

          <footer className="foot">
            <p>RetinaGuard · Screening support only — not a medical diagnosis · Professional clinical review required · Image-quality assessment is advisory.</p>
          </footer>
        </main>
      </div>

      <Toasts toasts={toasts} />
    </div>
  );
}
