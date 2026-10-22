import { useCallback, useEffect, useState } from 'react';
import type { DiscoverResult, SearchLink, SourceId, SourceInfo } from '@shared/types';
import { api, download } from '../api';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { Modal, Spinner } from '../components/ui';
import { relativeTime } from '../lib';

const FREE: SourceId[] = ['remoteok', 'remotive', 'arbeitnow', 'jobicy', 'hn'];

export default function Settings({ version, onChanged }: { version: number; onChanged: () => void }) {
  const toast = useToast();
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [selected, setSelected] = useState<SourceId[]>([...FREE]);
  const [pages, setPages] = useState(2);
  const [results, setResults] = useState<DiscoverResult[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [adzuna, setAdzuna] = useState({ adzuna_app_id: '', adzuna_app_key: '', adzuna_country: 'us' });
  const [savingKeys, setSavingKeys] = useState(false);
  const [workdayBoards, setWorkdayBoards] = useState('');
  const [savingWorkday, setSavingWorkday] = useState(false);
  const [searchLinks, setSearchLinks] = useState<SearchLink[]>([]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, cfg, links] = await Promise.all([
        api.get<{ sources: SourceInfo[] }>('/sources'),
        api.get<{ settings: Record<string, string> }>('/settings'),
        api.get<{ links: SearchLink[] }>('/search-links'),
      ]);
      setSources(s.sources);
      setSearchLinks(links.links);
      setAdzuna({
        adzuna_app_id: cfg.settings.adzuna_app_id ?? '',
        adzuna_app_key: cfg.settings.adzuna_app_key ?? '',
        adzuna_country: cfg.settings.adzuna_country || 'us',
      });
      setWorkdayBoards(cfg.settings.workday_boards ?? '');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load settings', 'err');
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load, version]);

  function toggle(id: SourceId) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function fetchSelected() {
    if (!selected.length) {
      toast('Pick at least one source', 'err');
      return;
    }
    setFetching(true);
    setResults(null);
    try {
      const res = await api.post<{ results: DiscoverResult[] }>('/discover', {
        sources: selected,
        pages,
        limitPerSource: 100,
      });
      setResults(res.results);
      const inserted = res.results.reduce((s, r) => s + r.inserted, 0);
      const failed = res.results.filter((r) => r.error).length;
      toast(`Fetched ${inserted} new roles${failed ? ` · ${failed} failed` : ''}`, failed === res.results.length ? 'err' : 'ok');
      await load();
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sync failed', 'err');
    } finally {
      setFetching(false);
    }
  }

  async function saveKeys() {
    setSavingKeys(true);
    try {
      await api.put('/settings', adzuna);
      toast('Adzuna credentials saved locally');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save', 'err');
    } finally {
      setSavingKeys(false);
    }
  }

  async function saveWorkday() {
    setSavingWorkday(true);
    try {
      await api.put('/settings', { workday_boards: workdayBoards });
      toast('Workday career sites saved locally');
      await load();
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save Workday boards', 'err');
    } finally {
      setSavingWorkday(false);
    }
  }

  async function doImport() {
    if (!importFile) return;
    setImporting(true);
    try {
      const text = await importFile.text();
      const data = JSON.parse(text);
      await api.post('/import', data);
      toast('Backup restored');
      setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Import failed — the file may not be a JobPilot backup', 'err');
      setImporting(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Sources, credentials, backups. Everything is stored in one local SQLite file — no accounts, no cloud sync.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        <div className="col" style={{ gap: 16 }}>
          <section className="card">
            <div className="card-head">
              <h3>Job sources</h3>
              <div className="spacer" />
              <span className="badge badge-mint">5 free APIs · Workday · 3 search links</span>
            </div>
            <div style={{ padding: '4px 20px 16px' }}>
              {sources.map((s) => {
                const selectable = !!s.id && !s.searchOnly && s.id !== 'manual';
                const link = searchLinks.find((entry) => entry.id === s.id);
                return (
                  <div className="source-row" key={s.id}>
                    {selectable ? (
                      <label className="checkbox" style={{ marginRight: 2 }}>
                        <input
                          type="checkbox"
                          checked={selected.includes(s.id)}
                          onChange={() => toggle(s.id)}
                        />
                      </label>
                    ) : (
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--muted-2)',
                        }}
                      >
                        <Icon name={s.searchOnly ? 'search' : 'link'} size={12} />
                      </span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="source-name">
                        {s.name}
                        {s.requiresKey && <span className="badge">API key</span>}
                        {s.requiresConfig && <span className="badge">Setup</span>}
                        {s.searchOnly && <span className="badge">Search only</span>}
                      </div>
                      <div className="source-desc">{s.description}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {s.searchOnly ? (
                        <a className="btn btn-ghost btn-sm" href={link?.url ?? s.homepage} target="_blank" rel="noreferrer">
                          Search <Icon name="external" size={11} />
                        </a>
                      ) : (
                        <>
                          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.count}</div>
                          <div className="hint">{s.lastFetched ? relativeTime(s.lastFetched) : 'never'}</div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
                <div className="field" style={{ width: 130 }}>
                  <label>Pages</label>
                  <select className="select" value={pages} onChange={(e) => setPages(Number(e.target.value))}>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </div>
                <div className="spacer" />
                <button className="btn btn-primary" onClick={fetchSelected} disabled={fetching}>
                  {fetching ? <Spinner /> : <Icon name="refresh" size={15} />}
                  {fetching ? 'Fetching…' : `Fetch ${selected.length} source${selected.length === 1 ? '' : 's'}`}
                </button>
              </div>

              {results && (
                <div style={{ marginTop: 16 }}>
                  {results.map((r) => (
                    <div className="row" key={r.source} style={{ padding: '7px 0', borderTop: '1px solid rgba(255,255,255,.05)', fontSize: 12.5 }}>
                      <Icon name={r.error ? 'alert' : 'check'} size={13} style={{ color: r.error ? 'var(--red)' : 'var(--accent)' }} />
                      <span style={{ fontWeight: 550 }}>{r.name}</span>
                      <span className="hint">
                        {r.error ? r.error : `${r.fetched} read · ${r.inserted} new · ${r.updated} refreshed`}
                      </span>
                      <div className="spacer" />
                      <span className="hint">{(r.ms / 1000).toFixed(1)}s</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="card card-pad">
            <div className="row" style={{ marginBottom: 6 }}>
              <div className="section-title" style={{ margin: 0 }}>Adzuna (optional)</div>
              <div className="spacer" />
              <a className="btn btn-ghost btn-sm" href="https://developer.adzuna.com" target="_blank" rel="noreferrer">
                Get a free key <Icon name="external" size={12} />
              </a>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              Adzuna aggregates millions of listings across 20 countries. The free developer tier is enough for a personal
              search. Keys stay in your local database.
            </p>
            <div className="grid-2">
              <div className="field">
                <label>App ID</label>
                <input className="input" value={adzuna.adzuna_app_id} onChange={(e) => setAdzuna({ ...adzuna, adzuna_app_id: e.target.value })} placeholder="a1b2c3d4" />
              </div>
              <div className="field">
                <label>App key</label>
                <input className="input" type="password" value={adzuna.adzuna_app_key} onChange={(e) => setAdzuna({ ...adzuna, adzuna_app_key: e.target.value })} placeholder="••••••••" />
              </div>
              <div className="field">
                <label>Country</label>
                <select className="select" value={adzuna.adzuna_country} onChange={(e) => setAdzuna({ ...adzuna, adzuna_country: e.target.value })}>
                  {['us', 'gb', 'de', 'fr', 'nl', 'ca', 'au', 'in', 'sg', 'es', 'it', 'br'].map((c) => (
                    <option key={c} value={c}>{c.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button className="btn btn-block" onClick={saveKeys} disabled={savingKeys}>
                  {savingKeys ? <Spinner /> : <Icon name="check" size={14} />} Save credentials
                </button>
              </div>
            </div>
          </section>

          <section className="card card-pad">
            <div className="row" style={{ marginBottom: 6 }}>
              <div className="section-title" style={{ margin: 0 }}>Workday company boards</div>
              <div className="spacer" />
              <span className="badge">per-employer</span>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              Workday has no global job board. Paste one career-site URL per line. Add an optional label before a pipe:
              <br />
              <code>NVIDIA | https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite</code>
            </p>
            <textarea
              className="input"
              rows={5}
              value={workdayBoards}
              onChange={(e) => setWorkdayBoards(e.target.value)}
              placeholder={'NVIDIA | https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite\nSalesforce | https://salesforce.wd12.myworkdayjobs.com/External_Career_Site'}
              style={{ minHeight: 120, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.55 }}
            />
            <div className="row" style={{ marginTop: 10 }}>
              <div className="hint">
                Workday sync reads the public job feed used by each employer’s career site. Add the companies you actually
                want to track.
              </div>
              <div className="spacer" />
              <button className="btn" onClick={saveWorkday} disabled={savingWorkday}>
                {savingWorkday ? <Spinner /> : <Icon name="check" size={14} />}
                Save Workday boards
              </button>
            </div>
          </section>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <section className="card card-pad">
            <div className="section-title">Your data</div>
            <div className="col" style={{ gap: 9 }}>
              <button className="btn btn-block" onClick={() => download('/export')} style={{ justifyContent: 'space-between' }}>
                <span className="row" style={{ gap: 8 }}>
                  <Icon name="download" size={15} /> Export full backup
                </span>
                <span className="hint">JSON</span>
              </button>
              <button className="btn btn-block" onClick={() => download('/applications.csv')} style={{ justifyContent: 'space-between' }}>
                <span className="row" style={{ gap: 8 }}>
                  <Icon name="file" size={15} /> Applications
                </span>
                <span className="hint">CSV</span>
              </button>
              <label className="btn btn-block" style={{ cursor: 'pointer', justifyContent: 'space-between' }}>
                <span className="row" style={{ gap: 8 }}>
                  <Icon name="upload" size={15} /> Restore a backup
                </span>
                <span className="hint">JSON</span>
                <input
                  type="file"
                  accept="application/json,.json"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setImportFile(f);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
            <div className="alert" style={{ marginTop: 14 }}>
              <Icon name="alert" size={14} />
              <div>Restoring replaces every profile, job, application and document on this machine. Export first if you are unsure.</div>
            </div>
          </section>

          <section className="card card-pad">
            <div className="section-title">How scoring works</div>
            <div className="col" style={{ gap: 9, fontSize: 12.5, color: 'var(--muted)' }}>
              <div><strong style={{ color: 'var(--text)' }}>50 pts · skills</strong> — how many of your skills appear in the posting.</div>
              <div><strong style={{ color: 'var(--text)' }}>22 pts · title</strong> — overlap with your target titles.</div>
              <div><strong style={{ color: 'var(--text)' }}>8 pts · seniority</strong> — distance between the role’s level and your years.</div>
              <div><strong style={{ color: 'var(--text)' }}>6 pts · pay</strong> — listed range versus your floor.</div>
              <div><strong style={{ color: 'var(--text)' }}>8 pts · location</strong> — remote preference or preferred cities.</div>
              <div><strong style={{ color: 'var(--text)' }}>6 pts · freshness</strong> — recency of the posting.</div>
            </div>
            <div className="hint" style={{ marginTop: 10 }}>
              Must-include terms multiply the score by 0.55; must-exclude terms cap it at 12. Everything is explainable on the
              job card.
            </div>
            <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => (window.location.hash = '/profile')}>
              <Icon name="settings" size={13} /> Tune in profile
            </button>
          </section>

          <section className="card card-pad">
            <div className="section-title">About</div>
            <div className="col" style={{ gap: 6, fontSize: 12.5, color: 'var(--muted)' }}>
              <div className="row"><span style={{ width: 90 }}>App</span><span style={{ color: 'var(--text)' }}>JobPilot 0.1.0</span></div>
              <div className="row"><span style={{ width: 90 }}>Storage</span><span style={{ color: 'var(--text)' }}>SQLite, local</span></div>
              <div className="row"><span style={{ width: 90 }}>Network</span><span style={{ color: 'var(--text)' }}>Job boards only</span></div>
            </div>
            <div className="hint" style={{ marginTop: 12 }}>
              JobPilot never submits an application for you. It is a reading-and-organising tool: fetch listings, score fit,
              tailor documents, prefill forms, track replies.
            </div>
          </section>
        </div>
      </div>

      {importFile && (
        <Modal
          title="Restore this backup?"
          onClose={() => setImportFile(null)}
          footer={
            <>
              <button className="btn" onClick={() => setImportFile(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={doImport} disabled={importing}>
                {importing ? <Spinner /> : <Icon name="upload" size={14} />}
                {importing ? 'Restoring…' : 'Replace all data'}
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            <strong>{importFile.name}</strong> ({(importFile.size / 1024).toFixed(1)} KB)
          </p>
          <div className="alert">
            <Icon name="alert" size={15} />
            <div>
              This deletes the current profile, jobs, applications and documents, then loads the backup. This cannot be undone.
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
