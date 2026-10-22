import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppStatus, Doc, Job, QueueJob, SearchLink, SourceInfo } from '@shared/types';
import { api } from '../api';
import { DocViewer, loadJobDocs } from '../components/DocViewer';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { Empty, Modal, ScoreRing, Spinner } from '../components/ui';
import {
  STATUS_META,
  cls,
  initials,
  jobMoney,
  relativeTime,
  sourceLabel,
  truncate,
} from '../lib';

interface Detail {
  job: Job;
  application: { id: number; status: AppStatus; notes: string; nextActionAt: string | null } | null;
  docs: { id: number; kind: string; title: string }[];
}

const PAGE = 50;

export default function Jobs({ version, onChanged }: { version: number; onChanged: () => void }) {
  const toast = useToast();

  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [sort, setSort] = useState('score');
  const [minScore, setMinScore] = useState('');
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tick, setTick] = useState(0);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [tailoring, setTailoring] = useState(false);
  const [docSet, setDocSet] = useState<{ resume?: Doc; cover?: Doc } | null>(null);

  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [addError, setAddError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLinks, setSearchLinks] = useState<SearchLink[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [queueOpen, setQueueOpen] = useState(false);
  const [queuePreparing, setQueuePreparing] = useState(false);
  const [queueResult, setQueueResult] = useState<{ prepared: number; jobs: QueueJob[] } | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(q.trim()), 260);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    void api.get<{ sources: SourceInfo[] }>('/sources').then((r) => setSources(r.sources)).catch(() => {});
  }, []);

  const load = useCallback(
    async (nextOffset: number) => {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(nextOffset), sort });
      if (query) params.set('query', query);
      if (source) params.set('source', source);
      if (minScore) params.set('minScore', minScore);
      if (remoteOnly) params.set('remote', 'true');
      if (savedOnly) params.set('saved', 'true');
      const res = await api.get<{ jobs: Job[]; total: number }>(`/jobs?${params}`);
      setTotal(res.total);
      setOffset(nextOffset);
      setJobs((prev) => (nextOffset === 0 ? res.jobs : [...prev, ...res.jobs]));
      return res;
    },
    [query, source, minScore, remoteOnly, savedOnly, sort],
  );

  useEffect(() => {
    setLoading(true);
    load(0)
      .catch((err) => toast(err instanceof Error ? err.message : 'Could not load jobs', 'err'))
      .finally(() => setLoading(false));
  }, [load, version, tick, toast]);

  // Open a job when the dashboard links here with #/jobs?job=12
  useEffect(() => {
    const readHash = () => {
      const param = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('job');
      const id = param ? Number(param) : null;
      if (id && Number.isFinite(id)) setSelectedId(id);
    };
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, []);

  const loadDetail = useCallback(
    async (id: number) => {
      setDetailLoading(true);
      try {
        const res = await api.get<Detail>(`/jobs/${id}`);
        setDetail(res);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not load that job', 'err');
        setSelectedId(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (selectedId) {
      setShowFull(false);
      void loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  function openJob(id: number) {
    setSelectedId(id);
    history.replaceState(null, '', `#/jobs?job=${id}`);
  }

  function closeDrawer() {
    setSelectedId(null);
    history.replaceState(null, '', '#/jobs');
  }

  async function toggleSaved(job: Job) {
    try {
      const res = await api.patch<{ job: Job }>(`/jobs/${job.id}`, { saved: !job.saved });
      toast(res.job.saved ? 'Saved for later' : 'Removed from saved');
      setDetail((d) => (d ? { ...d, job: res.job } : d));
      setTick((t) => t + 1);
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update', 'err');
    }
  }

  async function hideJob(job: Job) {
    try {
      await api.patch(`/jobs/${job.id}`, { hidden: true });
      toast('Hidden from the feed');
      closeDrawer();
      setTick((t) => t + 1);
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not hide', 'err');
    }
  }

  async function track(job: Job, status: AppStatus) {
    try {
      const res = await api.post<{ application: { id: number }; existed?: boolean }>('/applications', {
        jobId: job.id,
        status,
      });
      toast(res.existed ? 'Already in your pipeline' : status === 'applied' ? 'Marked as applied' : 'Added to pipeline');
      await loadDetail(job.id);
      setTick((t) => t + 1);
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update the pipeline', 'err');
    }
  }

  async function changeStatus(applicationId: number, status: AppStatus) {
    try {
      await api.patch(`/applications/${applicationId}`, { status });
      toast(`Moved to ${STATUS_META[status].label}`);
      if (selectedId) await loadDetail(selectedId);
      setTick((t) => t + 1);
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not change status', 'err');
    }
  }

  async function tailor(job: Job) {
    setTailoring(true);
    try {
      const res = await api.post<{ resume: Doc; cover: Doc; warnings: string[] }>(`/jobs/${job.id}/tailor`, {
        maxBullets: 4,
      });
      setDocSet({ resume: res.resume, cover: res.cover });
      if (res.warnings?.length) toast(res.warnings[0], 'err');
      else toast('Tailored resume and cover letter ready');
      setTick((t) => t + 1);
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not tailor documents', 'err');
    } finally {
      setTailoring(false);
    }
  }

  async function viewDocs(job: Job) {
    try {
      const loaded = await loadJobDocs(job.id);
      if (!loaded.resume && !loaded.cover) {
        toast('No documents for this role yet — tailor some first', 'err');
        return;
      }
      setDocSet(loaded);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load documents', 'err');
    }
  }

  async function importUrl() {
    setImporting(true);
    setAddError('');
    try {
      const res = await api.post<{ job: Job; warning: string | null }>('/jobs/import', { url });
      setAddOpen(false);
      setUrl('');
      toast(res.warning ?? `Imported ${res.job.title}`, res.warning ? 'err' : 'ok');
      setTick((t) => t + 1);
      if (res.job) openJob(res.job.id);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not import that URL');
    } finally {
      setImporting(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const usable = sources
        .filter((s) => !s.searchOnly && s.id !== 'manual' && s.configured !== false)
        .map((s) => s.id);
      const res = await api.post<{ results: { error: string | null; inserted: number }[] }>('/discover', {
        sources: usable,
        pages: 2,
        limitPerSource: 100,
      });
      const inserted = res.results.reduce((sum, r) => sum + r.inserted, 0);
      const failed = res.results.filter((r) => r.error).length;
      toast(`Fetched ${inserted} new roles${failed ? ` · ${failed} source(s) failed` : ''}`, failed === res.results.length ? 'err' : 'ok');
      setTick((t) => t + 1);
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sync failed', 'err');
    } finally {
      setSyncing(false);
    }
  }

  async function openSearch() {
    setSearchOpen(true);
    setSearchLoading(true);
    setSearchError('');
    try {
      const params = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
      const res = await api.get<{ links: SearchLink[] }>(`/search-links${params}`);
      setSearchLinks(res.links);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Could not build search links');
    } finally {
      setSearchLoading(false);
    }
  }

  async function prepareQueue() {
    setQueuePreparing(true);
    try {
      const res = await api.post<{ prepared: number; jobs: QueueJob[] }>('/jobs/prepare-queue', {
        minScore: 75,
        limit: 10,
      });
      setQueueOpen(false);
      setTick((t) => t + 1);
      onChanged();
      if (!res.prepared) {
        toast('No unstarted roles at 75+ right now. Fetch new jobs first.', 'err');
        return;
      }
      setQueueResult(res);
      toast(`Prepared ${res.prepared} role${res.prepared === 1 ? '' : 's'} for review`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not prepare the queue', 'err');
    } finally {
      setQueuePreparing(false);
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      await load(offset + PAGE);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load more', 'err');
    } finally {
      setLoadingMore(false);
    }
  }

  const activeFilters = useMemo(
    () => [source, minScore, remoteOnly ? 'remote' : '', savedOnly ? 'saved' : ''].filter(Boolean).length,
    [source, minScore, remoteOnly, savedOnly],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Job feed</h1>
          <p>
            {total} roles scored against your profile. The score blends skill overlap, title fit, seniority, pay, location and
            freshness — open a role to see exactly why.
          </p>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={openSearch}>
          <Icon name="search" size={15} /> Search boards
        </button>
        <button className="btn" onClick={() => setQueueOpen(true)}>
          <Icon name="pipeline" size={15} /> Prep 75+ queue
        </button>
        <button className="btn" onClick={() => setAddOpen(true)}>
          <Icon name="link" size={15} /> Add by URL
        </button>
        <button className="btn" onClick={syncNow} disabled={syncing}>
          {syncing ? <Spinner /> : <Icon name="refresh" size={15} />}
          {syncing ? 'Fetching…' : 'Fetch new'}
        </button>
      </div>

      <div className="job-toolbar">
        <div className="search input-icon">
          <Icon name="search" size={15} />
          <input
            className="input"
            placeholder="Search title, company, stack, location…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {sources
            .filter((s) => !s.searchOnly && (s.count > 0 || s.id !== 'manual'))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
        <select className="select" value={minScore} onChange={(e) => setMinScore(e.target.value)}>
          <option value="">Any score</option>
          <option value="50">50+</option>
          <option value="75">75+</option>
          <option value="85">85+</option>
        </select>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="score">Best fit</option>
          <option value="newest">Newest</option>
          <option value="salary">Salary</option>
          <option value="company">Company</option>
        </select>
        <button className={`toggle ${remoteOnly ? 'on' : ''}`} onClick={() => setRemoteOnly((v) => !v)}>
          <Icon name="pin" size={13} /> Remote
        </button>
        <button className={`toggle ${savedOnly ? 'on' : ''}`} onClick={() => setSavedOnly((v) => !v)}>
          <Icon name="star" size={13} /> Saved
        </button>
        {activeFilters > 0 && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSource('');
              setMinScore('');
              setRemoteOnly(false);
              setSavedOnly(false);
              setQ('');
            }}
          >
            Clear {activeFilters}
          </button>
        )}
      </div>

      {loading ? (
        <div className="col" style={{ gap: 8 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div className="skeleton" key={i} />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <Empty icon="search" title={query || activeFilters ? 'No roles match those filters' : 'Your feed is empty'}>
          <p>
            {query || activeFilters
              ? 'Try widening the score range, clearing the source filter, or searching a broader term.'
              : 'Fetch roles from the free sources, add Workday career sites in Settings, or paste any job URL to add it manually.'}
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={syncNow} disabled={syncing}>
              {syncing ? <Spinner /> : <Icon name="refresh" size={15} />} Fetch jobs
            </button>
            <button className="btn" onClick={() => setAddOpen(true)}>
              <Icon name="link" size={15} /> Add by URL
            </button>
          </div>
        </Empty>
      ) : (
        <>
          <div className="job-list">
            {jobs.map((job) => (
              <div
                key={job.id}
                className={cls('job-row', selectedId === job.id && 'active')}
                onClick={() => openJob(job.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && openJob(job.id)}
              >
                <div className="logo">{initials(job.company)}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="job-title">
                    <span className="truncate">{job.title}</span>
                    {job.saved && <Icon name="star" size={12} style={{ color: 'var(--amber)' }} />}
                    {job.applicationStatus && (
                      <span className={`badge badge-${STATUS_META[job.applicationStatus].tone}`}>
                        {STATUS_META[job.applicationStatus].label}
                      </span>
                    )}
                  </div>
                  <div className="job-meta">
                    <span>{job.company}</span>
                    {job.location && <span className="dot">{truncate(job.location, 40)}</span>}
                    {job.remote && <span className="dot">Remote</span>}
                    {jobMoney(job) && <span className="dot">{jobMoney(job)}</span>}
                    <span className="dot">{relativeTime(job.postedAt ?? job.fetchedAt)}</span>
                  </div>
                  {job.tags.length > 0 && (
                    <div className="job-tags">
                      {job.tags.slice(0, 5).map((t) => (
                        <span className="tag" key={t}>
                          {truncate(t, 22)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="job-side meta-only">
                  <span className="badge badge-slate">{sourceLabel(job.source)}</span>
                  {job.reasons.find((r) => r.kind === 'match') && (
                    <span className="hint" style={{ maxWidth: 190, textAlign: 'right' }}>
                      {truncate(job.reasons.find((r) => r.kind === 'match')!.text, 44)}
                    </span>
                  )}
                </div>
                <ScoreRing score={job.score} />
              </div>
            ))}
          </div>
          {jobs.length < total && (
            <div style={{ textAlign: 'center', marginTop: 18 }}>
              <button className="btn" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <Spinner /> : <Icon name="chevron-down" size={15} />}
                Load {Math.min(PAGE, total - jobs.length)} more
              </button>
            </div>
          )}
        </>
      )}

      {selectedId && (
        <>
          <div className="overlay" onClick={closeDrawer} />
          <aside className="drawer" role="dialog" aria-modal="true">
            {detailLoading || !detail ? (
              <div className="card-pad">
                <div className="skeleton" style={{ height: 80, marginBottom: 12 }} />
                <div className="skeleton" style={{ height: 220 }} />
              </div>
            ) : (
              <>
                <div className="drawer-head">
                  <div className="logo" style={{ width: 48, height: 48, borderRadius: 13 }}>
                    {initials(detail.job.company)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 660, letterSpacing: '-0.35px' }}>{detail.job.title}</div>
                    <div className="job-meta" style={{ marginTop: 4 }}>
                      <span style={{ color: 'var(--text)' }}>{detail.job.company}</span>
                      {detail.job.location && <span className="dot">{detail.job.location}</span>}
                      {detail.job.remote && <span className="dot">Remote</span>}
                      {jobMoney(detail.job) && <span className="dot">{jobMoney(detail.job)}</span>}
                    </div>
                    <div className="row" style={{ marginTop: 8, gap: 6 }}>
                      <span className="badge badge-slate">{sourceLabel(detail.job.source)}</span>
                      <span className="badge">Posted {relativeTime(detail.job.postedAt ?? detail.job.fetchedAt)}</span>
                      {detail.application && (
                        <span className={`badge badge-${STATUS_META[detail.application.status].tone}`}>
                          {STATUS_META[detail.application.status].label}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <ScoreRing score={detail.job.score} />
                    <span className="hint">fit</span>
                  </div>
                  <button className="btn btn-ghost btn-icon" onClick={closeDrawer} aria-label="Close">
                    <Icon name="x" size={17} />
                  </button>
                </div>

                <div className="drawer-body">
                  <div className="card card-pad" style={{ padding: 15, marginBottom: 16 }}>
                    <div className="section-title" style={{ marginBottom: 4 }}>Why this score</div>
                    {detail.job.reasons.length === 0 && <div className="hint">No signals yet — add skills and target titles to your profile.</div>}
                    {detail.job.reasons.map((r, i) => (
                      <div className={`reason ${r.kind}`} key={i}>
                        <Icon name={r.kind === 'match' ? 'check' : r.kind === 'gap' ? 'alert' : 'clock'} size={13} />
                        <span>{r.text}</span>
                      </div>
                    ))}
                  </div>

                  {detail.application && (
                    <div className="row" style={{ marginBottom: 16, gap: 10 }}>
                      <span className="label" style={{ margin: 0 }}>Pipeline stage</span>
                      <select
                        className="select"
                        style={{ width: 180 }}
                        value={detail.application.status}
                        onChange={(e) => changeStatus(detail.application!.id, e.target.value as AppStatus)}
                      >
                        {(Object.keys(STATUS_META) as AppStatus[]).map((s) => (
                          <option key={s} value={s}>
                            {STATUS_META[s].label}
                          </option>
                        ))}
                      </select>
                      <span className="hint">Changes are logged on the application timeline.</span>
                    </div>
                  )}

                  <div className="row" style={{ marginBottom: 8 }}>
                    <div className="section-title" style={{ margin: 0 }}>The posting</div>
                    <div className="spacer" />
                    {detail.job.url && (
                      <a className="btn btn-ghost btn-sm" href={detail.job.url} target="_blank" rel="noreferrer">
                        <Icon name="link" size={12} /> Original
                      </a>
                    )}
                  </div>
                  <div className={cls('job-desc', !showFull && 'desc-collapse')}>{detail.job.description || 'No description stored.'}</div>
                  {detail.job.description.length > 1200 && (
                    <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => setShowFull((v) => !v)}>
                      {showFull ? 'Show less' : 'Show full posting'}
                      <Icon name={showFull ? 'chevron-down' : 'chevron-right'} size={12} style={{ transform: showFull ? 'rotate(180deg)' : undefined }} />
                    </button>
                  )}

                  {detail.docs.length > 0 && (
                    <div style={{ marginTop: 22 }}>
                      <div className="section-title">Your documents</div>
                      <div className="col" style={{ gap: 6 }}>
                        {detail.docs.map((d) => (
                          <button key={d.id} className="row" style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--line)', borderRadius: 10, padding: '9px 12px', cursor: 'pointer', textAlign: 'left', color: 'inherit' }} onClick={() => viewDocs(detail.job)}>
                            <Icon name="file" size={14} />
                            <span style={{ fontSize: 12.5 }}>{d.title}</span>
                            <div className="spacer" />
                            <Icon name="chevron-right" size={13} style={{ color: 'var(--muted-2)' }} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="alert info" style={{ marginTop: 22 }}>
                    <Icon name="alert" size={15} />
                    <div>
                      Apply in your own browser session. JobPilot prefills the form with the bookmarklet — you review and submit.
                      Never auto-submit; most boards ban it and it burns your account.
                    </div>
                  </div>
                </div>

                <div className="drawer-foot">
                  <button className="btn btn-primary" onClick={() => window.open(detail.job.applyUrl || detail.job.url, '_blank', 'noopener')}>
                    <Icon name="external" size={14} /> Open application
                  </button>
                  {!detail.application || detail.application.status === 'saved' ? (
                    <button className="btn" onClick={() => track(detail.job, 'applied')}>
                      <Icon name="check" size={14} /> Mark applied
                    </button>
                  ) : null}
                  {!detail.application && (
                    <button className="btn" onClick={() => track(detail.job, 'saved')}>
                      <Icon name="pipeline" size={14} /> Add to pipeline
                    </button>
                  )}
                  <button className="btn" onClick={() => tailor(detail.job)} disabled={tailoring}>
                    {tailoring ? <Spinner /> : <Icon name="sparkles" size={14} />}
                    {tailoring ? 'Tailoring…' : 'Tailor resume'}
                  </button>
                  <div className="spacer" />
                  <button className="btn btn-ghost btn-icon" title={detail.job.saved ? 'Remove bookmark' : 'Save for later'} onClick={() => toggleSaved(detail.job)} style={{ color: detail.job.saved ? 'var(--amber)' : undefined }}>
                    <Icon name="star" size={16} />
                  </button>
                  <button className="btn btn-ghost btn-icon" title="Hide this role" onClick={() => hideJob(detail.job)}>
                    <Icon name="eye-off" size={16} />
                  </button>
                </div>
              </>
            )}
          </aside>
        </>
      )}

      {docSet && <DocViewer docs={docSet} onClose={() => setDocSet(null)} onChanged={() => setTick((t) => t + 1)} />}

      {addOpen && (
        <Modal
          title="Add a job by URL"
          onClose={() => setAddOpen(false)}
          width={620}
          footer={
            <>
              <button className="btn" onClick={() => setAddOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={importUrl} disabled={importing || !url.trim()}>
                {importing ? <Spinner /> : <Icon name="download" size={14} />}
                {importing ? 'Reading page…' : 'Import job'}
              </button>
            </>
          }
        >
          <div className="field">
            <label>Job posting URL</label>
            <input
              className="input"
              placeholder="https://company.com/careers/backend-engineer"
              value={url}
              autoFocus
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && url.trim() && importUrl()}
            />
            <div className="hint">
              JobPilot reads the page’s structured job data (JSON-LD, used by most ATSs). Pages without it still import the title
              and description — check the details after adding.
            </div>
          </div>
          {addError && (
            <div className="alert" style={{ marginTop: 12 }}>
              <Icon name="alert" size={15} /> {addError}
            </div>
          )}
        </Modal>
      )}

      {searchOpen && (
        <Modal
          title="Search job boards"
          onClose={() => setSearchOpen(false)}
          width={680}
          footer={
            <>
              <button className="btn" onClick={() => setSearchOpen(false)}>Close</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setSearchOpen(false);
                  setAddOpen(true);
                }}
              >
                <Icon name="link" size={14} /> Import a job URL
              </button>
            </>
          }
        >
          <p className="hint" style={{ marginTop: 0 }}>
            Search LinkedIn, Indeed, Glassdoor and your configured Workday boards in a normal browser session. These sites
            do not offer free public job APIs, so JobPilot opens a targeted search; paste an individual posting URL back
            into <strong>Add by URL</strong> to score and tailor it.
          </p>

          {searchLoading ? (
            <div className="row" style={{ justifyContent: 'center', padding: 24 }}>
              <Spinner /> <span className="hint">Building search links…</span>
            </div>
          ) : searchError ? (
            <div className="alert">
              <Icon name="alert" size={15} /> {searchError}
            </div>
          ) : (
            <div className="col" style={{ gap: 8 }}>
              {searchLinks.map((link) => (
                <a
                  key={link.id}
                  className="row"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    background: 'rgba(255,255,255,.03)',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    padding: '11px 13px',
                    color: 'inherit',
                    textDecoration: 'none',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 620 }}>{link.name}</div>
                    <div className="hint" style={{ marginTop: 2 }}>{link.note}</div>
                  </div>
                  <Icon name="external" size={14} style={{ color: 'var(--muted-2)' }} />
                </a>
              ))}
            </div>
          )}

          <div className="alert info" style={{ marginTop: 16 }}>
            <Icon name="alert" size={15} />
            <div>
              JobPilot does not scrape these sites or submit applications for you. Open a role in your browser, then use the
              bookmarklet to prefill the form.
            </div>
          </div>
        </Modal>
      )}

      {queueOpen && (
        <Modal
          title="Prepare the 75+ review queue?"
          onClose={() => setQueueOpen(false)}
          width={600}
          footer={
            <>
              <button className="btn" onClick={() => setQueueOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={prepareQueue} disabled={queuePreparing}>
                {queuePreparing ? <Spinner /> : <Icon name="pipeline" size={14} />}
                {queuePreparing ? 'Preparing…' : 'Prepare top 10'}
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            JobPilot will take up to <strong>10 unstarted roles scoring 75 or higher</strong>, add them to your pipeline as{' '}
            <strong>Saved</strong>, and generate a tailored resume and cover letter for each one.
          </p>
          <div className="alert">
            <Icon name="alert" size={15} />
            <div>
              Nothing is submitted automatically. You still open every application, review the documents, and click Submit
              yourself.
            </div>
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            This is a preparation queue, not an auto-apply bot. It keeps your accounts safe and your applications accurate.
          </p>
        </Modal>
      )}

      {queueResult && (
        <Modal
          title={`${queueResult.prepared} role${queueResult.prepared === 1 ? '' : 's'} prepared`}
          onClose={() => setQueueResult(null)}
          width={680}
          footer={
            <>
              <button className="btn" onClick={() => setQueueResult(null)}>Close</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setQueueResult(null);
                  window.location.hash = '/applications';
                }}
              >
                <Icon name="pipeline" size={14} /> Open pipeline
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            These roles are now in your pipeline as <strong>Saved</strong>, with tailored documents. Nothing was submitted.
          </p>
          <div className="col" style={{ gap: 8 }}>
            {queueResult.jobs.map((job) => (
              <div
                key={job.id}
                className="row"
                style={{ gap: 10, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10 }}
              >
                <ScoreRing score={job.score} small />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="truncate" style={{ fontSize: 13, fontWeight: 600 }}>{job.title}</div>
                  <div className="hint">{job.company} · {job.docs} documents</div>
                </div>
                <a className="btn btn-sm" href={job.applyUrl} target="_blank" rel="noreferrer">
                  <Icon name="external" size={12} /> Open
                </a>
              </div>
            ))}
          </div>
          <div className="alert info" style={{ marginTop: 14 }}>
            <Icon name="alert" size={15} />
            <div>Review each document, prefill the form with the bookmarklet, then submit manually.</div>
          </div>
        </Modal>
      )}
    </>
  );
}
