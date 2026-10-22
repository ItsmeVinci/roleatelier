import { useCallback, useEffect, useState } from 'react';
import type { DiscoverResult, SourceId, SourceInfo, Stats } from '@shared/types';
import { api } from './api';
import { Icon, type IconName } from './components/Icon';
import { ToastProvider, useToast } from './components/Toast';
import { Spinner } from './components/ui';
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import Applications from './pages/Applications';
import ProfilePage from './pages/Profile';
import Autofill from './pages/Autofill';
import Settings from './pages/Settings';
import { plural } from './lib';

type Route = '/dashboard' | '/jobs' | '/applications' | '/profile' | '/autofill' | '/settings';

const NAV: { path: Route; label: string; icon: IconName; title: string }[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard', title: 'Dashboard' },
  { path: '/jobs', label: 'Jobs', icon: 'briefcase', title: 'Job feed' },
  { path: '/applications', label: 'Pipeline', icon: 'pipeline', title: 'Application pipeline' },
  { path: '/profile', label: 'Profile', icon: 'user', title: 'Your profile' },
  { path: '/autofill', label: 'Autofill', icon: 'wand', title: 'Autofill applications' },
  { path: '/settings', label: 'Settings', icon: 'settings', title: 'Settings' },
];

function currentRoute(): Route {
  const hash = window.location.hash.replace(/^#/, '').split('?')[0];
  return (NAV.find((n) => n.path === hash)?.path ?? '/dashboard') as Route;
}

function Shell() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [version, setVersion] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const toast = useToast();

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res = await api.get<{ stats: Stats }>('/stats');
      setStats(res.stats);
    } catch {
      // The dashboard will surface a real error; nav counts are cosmetic.
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats, version, route]);

  function navigate(path: string) {
    window.location.hash = path;
    setRoute(currentRoute());
  }

  async function syncSources() {
    setSyncing(true);
    try {
      const list = await api.get<{ sources: SourceInfo[] }>('/sources');
      const sources: SourceId[] = list.sources
        .filter((s) => !s.searchOnly && s.id !== 'manual' && s.configured !== false)
        .map((s) => s.id);
      const res = await api.post<{ results: DiscoverResult[] }>('/discover', {
        sources,
        pages: 2,
        limitPerSource: 100,
      });
      const ok = res.results.filter((r) => !r.error);
      const inserted = ok.reduce((sum, r) => sum + r.inserted, 0);
      const failed = res.results.filter((r) => r.error);
      if (!ok.length) {
        toast(failed[0]?.error ?? 'Sync failed', 'err');
      } else {
        toast(
          `Synced ${plural(ok.length, 'source')} · ${plural(inserted, 'new role')}${failed.length ? ` · ${failed.length} failed` : ''}`,
          failed.length ? 'err' : 'ok',
        );
        setVersion((v) => v + 1);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sync failed', 'err');
    } finally {
      setSyncing(false);
    }
  }

  const active = NAV.find((n) => n.path === route) ?? NAV[0];
  const counts: Partial<Record<Route, number>> = {
    '/jobs': stats?.jobs ?? 0,
    '/applications': stats?.totalApplications ?? 0,
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Icon name="zap" size={18} />
          </div>
          <div>
            <div className="brand-name">JobPilot</div>
            <div className="brand-sub">Local cockpit</div>
          </div>
        </div>

        <nav className="nav" aria-label="Main">
          <div className="nav-label">Workspace</div>
          {NAV.map((item) => (
            <a
              key={item.path}
              href={`#${item.path}`}
              className={`nav-item ${route === item.path ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(item.path);
              }}
            >
              <Icon name={item.icon} size={17} />
              {item.label}
              {counts[item.path] ? <span className="nav-count">{counts[item.path]}</span> : null}
            </a>
          ))}
        </nav>

        <div className="nav-foot">
          <div className="row" style={{ gap: 6, marginBottom: 4 }}>
            <Icon name="pin" size={12} />
            Local-first
          </div>
          Your data never leaves this machine.
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">{active.title}</div>
          <div className="topbar-spacer" />
          <span className="badge badge-mint" title="This app runs entirely on your machine">
            <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--accent)' }} />
            Local
          </span>
          <button className="btn btn-sm" onClick={syncSources} disabled={syncing} title="Fetch new jobs from every configured source">
            {syncing ? <Spinner /> : <Icon name="refresh" size={14} />}
            {syncing ? 'Syncing…' : 'Sync sources'}
          </button>
        </header>

        <main className="page" key={route}>
          {route === '/dashboard' && <Dashboard version={version} navigate={navigate} />}
          {route === '/jobs' && <Jobs version={version} onChanged={() => setVersion((v) => v + 1)} />}
          {route === '/applications' && <Applications version={version} onChanged={() => setVersion((v) => v + 1)} />}
          {route === '/profile' && <ProfilePage onSaved={() => setVersion((v) => v + 1)} />}
          {route === '/autofill' && <Autofill />}
          {route === '/settings' && <Settings version={version} onChanged={() => setVersion((v) => v + 1)} />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
