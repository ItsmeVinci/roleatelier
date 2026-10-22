import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Job, Profile, SourceInfo, Stats, AppStatus } from '@shared/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, ScoreRing, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import {
  STATUS_META,
  daysFromToday,
  formatDate,
  initials,
  jobMoney,
  plural,
  relativeTime,
  sourceLabel,
  truncate,
} from '../lib';

const TONE_COLOR: Record<string, string> = {
  slate: '#94a3b8',
  blue: '#60a5fa',
  violet: '#a78bfa',
  amber: '#fbbf24',
  green: '#4ade80',
  red: '#f87171',
  zinc: '#a1a1aa',
};

export default function Dashboard({ version, navigate }: { version: number; navigate: (path: string) => void }) {
  const toast = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [matches, setMatches] = useState<Job[]>([]);
  const [matchTotal, setMatchTotal] = useState(0);
  const [newTotal, setNewTotal] = useState(0);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, p, m, n, src] = await Promise.all([
        api.get<{ stats: Stats }>('/stats'),
        api.get<{ profile: Profile }>('/profile'),
        api.get<{ jobs: Job[]; total: number }>('/jobs?minScore=55&limit=6&sort=score'),
        api.get<{ total: number }>('/jobs?minScore=70&limit=1'),
        api.get<{ sources: SourceInfo[] }>('/sources'),
      ]);
      setStats(s.stats);
      setProfile(p.profile);
      setMatches(m.jobs);
      setMatchTotal(m.total);
      setNewTotal(n.total);
      setSources(src.sources);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load the dashboard', 'err');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const checklist = useMemo(() => {
    if (!profile) return [];
    return [
      { label: 'Add your name, email and location', done: !!profile.fullName && !!profile.email, path: '/profile' },
      { label: 'List at least three skills', done: profile.skills.length >= 3, path: '/profile' },
      { label: 'Import or paste your resume', done: profile.resumeText.length > 200, path: '/profile' },
      { label: 'Set the roles you are targeting', done: profile.targetTitles.length > 0, path: '/profile' },
      { label: 'Sync a job source', done: (stats?.jobs ?? 0) > 0, path: '/settings' },
      { label: 'Move your first job into the pipeline', done: (stats?.totalApplications ?? 0) > 0, path: '/jobs' },
    ];
  }, [profile, stats]);

  const doneCount = checklist.filter((c) => c.done).length;
  const showOnboarding = checklist.length > 0 && doneCount < checklist.length;

  async function syncNow() {
    setSyncing(true);
    try {
      const list = await api.get<{ sources: SourceInfo[] }>('/sources');
      const sources = list.sources
        .filter((s) => !s.searchOnly && s.id !== 'manual' && s.configured !== false)
        .map((s) => s.id);
      const res = await api.post<{ results: { error: string | null; inserted: number }[] }>('/discover', {
        sources,
        pages: 2,
        limitPerSource: 100,
      });
      const inserted = res.results.reduce((sum, r) => sum + r.inserted, 0);
      const failed = res.results.filter((r) => r.error).length;
      toast(`Fetched ${plural(inserted, 'new role')}${failed ? ` · ${failed} source(s) failed` : ''}`, failed === res.results.length ? 'err' : 'ok');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sync failed', 'err');
    } finally {
      setSyncing(false);
    }
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = profile?.fullName.trim().split(/\s+/)[0] ?? '';
  const applied = stats ? stats.totalApplications - stats.byStatus.saved : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            {greeting}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p>
            {stats && stats.jobs > 0
              ? `${plural(stats.jobs, 'open role')} tracked · ${plural(applied, 'application')} submitted · ${stats.byStatus.interview} in interview`
              : 'Your job search, in one place. Sync sources, score fit, tailor the documents, then track every reply.'}
          </p>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={syncNow} disabled={syncing}>
          {syncing ? <Spinner /> : <Icon name="refresh" size={15} />}
          {syncing ? 'Fetching…' : 'Fetch new jobs'}
        </button>
        <button className="btn btn-primary" onClick={() => navigate('/jobs')}>
          <Icon name="briefcase" size={15} />
          Browse matches
        </button>
      </div>

      {showOnboarding && (
        <div className="card card-pad" style={{ marginBottom: 18, borderColor: 'rgba(110,231,183,.22)' }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <Icon name="sparkles" size={17} style={{ color: 'var(--accent)' }} />
            <strong style={{ fontSize: 14 }}>Finish setting up — {doneCount} of {checklist.length} done</strong>
            <div className="spacer" />
            <span className="hint">A complete profile makes every fit score sharper</span>
          </div>
          <div className="grid-2" style={{ gap: '4px 28px' }}>
            {checklist.map((c) => (
              <button
                key={c.label}
                className={`check-item ${c.done ? 'done' : ''}`}
                style={{ background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,.04)', cursor: 'pointer', textAlign: 'left', width: '100%' }}
                onClick={() => navigate(c.path)}
              >
                <span className="check-dot">
                  {c.done ? <Icon name="check" size={11} /> : <Icon name="chevron-right" size={11} />}
                </span>
                {c.label}
                {!c.done && <Icon name="arrow-right" size={13} style={{ marginLeft: 'auto', opacity: 0.4 }} />}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 18 }}>
        <StatCard icon="sparkles" label="Strong matches" value={newTotal} hint="Scored 70+ and not yet applied" onClick={() => navigate('/jobs')} accent />
        <StatCard icon="pipeline" label="In pipeline" value={stats?.totalApplications ?? 0} hint={`${stats?.byStatus.saved ?? 0} saved, not submitted`} onClick={() => navigate('/applications')} />
        <StatCard icon="mail" label="Response rate" value={`${stats?.responseRate ?? 0}%`} hint="Any reply after applying" onClick={() => navigate('/applications')} />
        <StatCard icon="calendar" label="Interviews" value={stats?.byStatus.interview ?? 0} hint={`${stats?.offers ?? 0} offer${stats?.offers === 1 ? '' : 's'} so far`} onClick={() => navigate('/applications')} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.7fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <div className="card-head">
            <h3>Top matches</h3>
            <span className="badge badge-mint">{matchTotal} scored 55+</span>
            <div className="spacer" />
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/jobs')}>
              View all <Icon name="arrow-right" size={13} />
            </button>
          </div>
          <div style={{ padding: 10 }}>
            {loading ? (
              <div className="col" style={{ padding: 8 }}>
                <div className="skeleton" />
                <div className="skeleton" />
                <div className="skeleton" />
              </div>
            ) : matches.length === 0 ? (
              <Empty icon="briefcase" title="No scored jobs yet">
                <p>Sync a source or add a job by URL. Fit scores appear here as soon as there is something to compare.</p>
                <button className="btn btn-primary btn-sm" onClick={() => navigate('/settings')}>
                  <Icon name="refresh" size={14} /> Set up sources
                </button>
              </Empty>
            ) : (
              matches.map((job) => <MatchRow key={job.id} job={job} onOpen={() => navigate(`/jobs?job=${job.id}`)} />)
            )}
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card card-pad">
            <div className="row" style={{ marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 13.5 }}>Pipeline</h3>
              <div className="spacer" />
              <span className="hint">{stats ? `${stats.thisWeek} added this week` : ''}</span>
            </div>
            {stats ? (
              <div className="funnel">
                {(['saved', 'applied', 'screening', 'interview', 'offer', 'rejected'] as AppStatus[]).map((status) => {
                  const count = stats.byStatus[status] ?? 0;
                  const max = Math.max(1, ...Object.values(stats.byStatus));
                  const meta = STATUS_META[status];
                  return (
                    <div className="funnel-row" key={status}>
                      <span style={{ color: 'var(--muted)' }}>{meta.label}</span>
                      <div className="funnel-track">
                        <div
                          className="funnel-bar"
                          style={{ width: `${(count / max) * 100}%`, background: TONE_COLOR[meta.tone] ?? 'var(--accent)' }}
                        />
                      </div>
                      <span className="n">{count}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="hint">Loading…</div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Follow-ups</h3>
              <div className="spacer" />
              <Icon name="clock" size={14} style={{ color: 'var(--muted-2)' }} />
            </div>
            <div style={{ padding: '6px 16px 12px' }}>
              {!stats?.dueActions.length ? (
                <div className="hint" style={{ padding: '10px 0' }}>
                  Nothing scheduled. Add a next action on an application to see it here.
                </div>
              ) : (
                stats.dueActions.map((d) => {
                  const days = daysFromToday(d.nextActionAt);
                  const overdue = days != null && days < 0;
                  return (
                    <button
                      key={`${d.applicationId}-${d.nextActionAt}`}
                      onClick={() => navigate('/applications')}
                      style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid rgba(255,255,255,.05)', padding: '10px 0', cursor: 'pointer' }}
                    >
                      <div className="row" style={{ gap: 8 }}>
                        <span style={{ fontSize: 12.6, fontWeight: 550 }}>{truncate(d.nextAction, 46)}</span>
                        <div className="spacer" />
                        <span className="badge" style={overdue ? { color: '#fca5a5', borderColor: 'rgba(248,113,113,.3)' } : undefined}>
                          {days == null ? formatDate(d.nextActionAt) : overdue ? `${Math.abs(days)}d late` : days === 0 ? 'today' : `in ${days}d`}
                        </span>
                      </div>
                      <div className="hint" style={{ marginTop: 2 }}>
                        {d.title} · {d.company}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h3>Source performance</h3>
          <span className="hint">Only counts applications you actually submitted</span>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/settings')}>
            Manage sources
          </button>
        </div>
        <div style={{ padding: '4px 8px 8px' }}>
          {stats?.bySource.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Applied</th>
                  <th>Replied</th>
                  <th>Response rate</th>
                  <th>Last sync</th>
                </tr>
              </thead>
              <tbody>
                {stats.bySource.map((row) => {
                  const src = sources.find((s) => s.id === row.source);
                  const rate = row.applied ? Math.round((row.responded / row.applied) * 100) : 0;
                  return (
                    <tr key={row.source}>
                      <td style={{ fontWeight: 550 }}>{sourceLabel(row.source)}</td>
                      <td>{row.applied}</td>
                      <td>{row.responded}</td>
                      <td>
                        <span className={`badge ${rate >= 20 ? 'badge-green' : rate > 0 ? 'badge-amber' : 'badge-slate'}`}>{rate}%</span>
                      </td>
                      <td className="muted">{src?.lastFetched ? relativeTime(src.lastFetched) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="hint" style={{ padding: 16 }}>
              No applications yet. Once you apply, this table shows which boards actually convert.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  onClick,
  accent,
}: {
  icon: 'sparkles' | 'pipeline' | 'mail' | 'calendar';
  label: string;
  value: number | string;
  hint: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      className={`card stat ${accent ? 'accent' : ''}`}
      onClick={onClick}
      style={{ textAlign: 'left', cursor: 'pointer', color: 'inherit' }}
    >
      <div className="stat-ico">
        <Icon name={icon} size={15} />
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-hint">{hint}</div>
    </button>
  );
}

function MatchRow({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const money = jobMoney(job);
  return (
    <div className="job-row" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="logo">{initials(job.company)}</div>
      <div style={{ minWidth: 0 }}>
        <div className="job-title">
          <span className="truncate">{job.title}</span>
          {job.applicationStatus && <span className={`badge badge-${STATUS_META[job.applicationStatus].tone}`}>{STATUS_META[job.applicationStatus].label}</span>}
        </div>
        <div className="job-meta">
          <span>{job.company}</span>
          {job.location && <span className="dot">{truncate(job.location, 34)}</span>}
          {money && <span className="dot">{money}</span>}
          <span className="dot">{relativeTime(job.postedAt ?? job.fetchedAt)}</span>
        </div>
      </div>
      <div className="job-side meta-only">
        <span className="badge badge-slate">{sourceLabel(job.source)}</span>
      </div>
      <ScoreRing score={job.score} />
    </div>
  );
}
