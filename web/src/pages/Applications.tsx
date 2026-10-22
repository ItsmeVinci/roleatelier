import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppStatus, Application, Doc } from '@shared/types';
import { STATUSES } from '@shared/types';
import { api } from '../api';
import { DocViewer, loadJobDocs } from '../components/DocViewer';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { ConfirmButton, Empty, Modal, ScoreRing, Spinner } from '../components/ui';
import {
  STATUS_META,
  dateInputValue,
  daysFromToday,
  formatDate,
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

export default function Applications({ version, onChanged }: { version: number; onChanged: () => void }) {
  const toast = useToast();
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overCol, setOverCol] = useState<AppStatus | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [showClosed, setShowClosed] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ applications: Application[] }>('/applications');
      setApps(res.applications);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load the pipeline', 'err');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apps.filter((a) => {
      if (!showClosed && (a.status === 'rejected' || a.status === 'withdrawn')) return false;
      if (!q) return true;
      return `${a.job?.title ?? ''} ${a.job?.company ?? ''}`.toLowerCase().includes(q);
    });
  }, [apps, query, showClosed]);

  const byStatus = useMemo(() => {
    const map = new Map<AppStatus, Application[]>();
    for (const s of STATUSES) map.set(s.id, []);
    for (const a of filtered) map.get(a.status)?.push(a);
    return map;
  }, [filtered]);

  async function move(app: Application, status: AppStatus) {
    if (app.status === status) return;
    const previous = app.status;
    setApps((prev) => prev.map((a) => (a.id === app.id ? { ...a, status } : a)));
    try {
      await api.patch(`/applications/${app.id}`, { status });
      toast(`${app.job?.title ?? 'Application'} → ${STATUS_META[status].label}`);
      onChanged();
      void load();
    } catch (err) {
      setApps((prev) => prev.map((a) => (a.id === app.id ? { ...a, status: previous } : a)));
      toast(err instanceof Error ? err.message : 'Could not move that card', 'err');
    }
  }

  const open = apps.find((a) => a.id === openId) ?? null;

  async function removeApp(id: number) {
    try {
      await api.del(`/applications/${id}`);
      toast('Application removed');
      setOpenId(null);
      onChanged();
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not remove', 'err');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Application pipeline</h1>
          <p>Drag a card between columns to move it. Every change is timestamped, so you can see how long each stage takes.</p>
        </div>
        <div className="spacer" />
        <div className="input-icon" style={{ minWidth: 210 }}>
          <Icon name="search" size={15} />
          <input className="input" placeholder="Filter applications…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className={`btn btn-sm ${showClosed ? '' : 'btn-ghost'}`} onClick={() => setShowClosed((v) => !v)}>
          <Icon name={showClosed ? 'eye' : 'eye-off'} size={14} /> Closed
        </button>
        <a className="btn btn-sm" href="/api/applications.csv">
          <Icon name="download" size={14} /> CSV
        </a>
        <button className="btn btn-primary btn-sm" onClick={() => (window.location.hash = '/jobs')}>
          <Icon name="plus" size={14} /> Add from jobs
        </button>
      </div>

      {loading ? (
        <div className="kanban">
          {[0, 1, 2, 3].map((i) => (
            <div className="kcol" key={i}>
              <div className="skeleton" style={{ height: 44, marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 70 }} />
            </div>
          ))}
        </div>
      ) : apps.length === 0 ? (
        <Empty icon="pipeline" title="No applications yet">
          <p>Open a job in the feed, tailor the documents, then mark it applied. It lands here so you can track every reply.</p>
          <button className="btn btn-primary" onClick={() => (window.location.hash = '/jobs')}>
            <Icon name="briefcase" size={15} /> Find roles
          </button>
        </Empty>
      ) : (
        <div className="kanban">
          {STATUSES.map((col) => {
            const items = byStatus.get(col.id) ?? [];
            return (
              <div
                key={col.id}
                className={`kcol ${overCol === col.id ? 'drag-over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverCol(col.id);
                }}
                onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverCol(null);
                  const app = apps.find((a) => a.id === dragId);
                  setDragId(null);
                  if (app) void move(app, col.id);
                }}
              >
                <div className="kcol-head">
                  <span className="dot" style={{ background: TONE_COLOR[col.tone] }} />
                  {col.label}
                  <span className="count">{items.length}</span>
                </div>
                <div style={{ minHeight: 44 }}>
                  {items.map((app) => {
                    const due = daysFromToday(app.nextActionAt);
                    return (
                      <div
                        key={app.id}
                        className={`kcard ${dragId === app.id ? 'dragging' : ''}`}
                        draggable
                        onDragStart={() => setDragId(app.id)}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverCol(null);
                        }}
                        onClick={() => setOpenId(app.id)}
                      >
                        <div className="kcard-title">{truncate(app.job?.title ?? 'Role removed', 74)}</div>
                        <div className="kcard-company">
                          {app.job?.company ?? '—'}
                          {app.job?.source ? <span className="muted"> · {sourceLabel(app.job.source)}</span> : null}
                        </div>
                        <div className="kcard-foot">
                          {app.job?.score != null && <ScoreRing score={app.job.score} small />}
                          <div className="spacer" />
                          {due != null && (
                            <span className={`kcard-due ${due < 0 ? 'overdue' : ''}`}>
                              <Icon name="clock" size={10} />
                              {due < 0 ? `${Math.abs(due)}d late` : due === 0 ? 'today' : `in ${due}d`}
                            </span>
                          )}
                          {due == null && <span className="hint">{relativeTime(app.updatedAt)}</span>}
                        </div>
                      </div>
                    );
                  })}
                  {items.length === 0 && (
                    <div className="hint" style={{ padding: '10px 6px', textAlign: 'center', border: '1px dashed var(--line)', borderRadius: 9 }}>
                      Drop here
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <AppDetail
          app={open}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            onChanged();
            void load();
          }}
          onDelete={() => removeApp(open.id)}
        />
      )}
    </>
  );
}

function AppDetail({
  app,
  onClose,
  onChanged,
  onDelete,
}: {
  app: Application;
  onClose: () => void;
  onChanged: () => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const [fresh, setFresh] = useState<Application>(app);
  const [notes, setNotes] = useState(app.notes);
  const [nextAction, setNextAction] = useState(app.nextAction);
  const [nextActionAt, setNextActionAt] = useState(dateInputValue(app.nextActionAt));
  const [saving, setSaving] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [contact, setContact] = useState({ name: '', role: '', email: '' });
  const [showContact, setShowContact] = useState(false);
  const [docSet, setDocSet] = useState<{ resume?: Doc; cover?: Doc } | null>(null);

  useEffect(() => {
    void api
      .get<{ application: Application }>(`/applications/${app.id}`)
      .then((r) => {
        setFresh(r.application);
        setNotes(r.application.notes);
        setNextAction(r.application.nextAction);
        setNextActionAt(dateInputValue(r.application.nextActionAt));
      })
      .catch(() => {});
  }, [app.id]);

  async function save() {
    setSaving(true);
    try {
      const res = await api.patch<{ application: Application }>(`/applications/${app.id}`, {
        notes,
        nextAction,
        nextActionAt,
      });
      setFresh(res.application);
      toast('Application updated');
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save', 'err');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(status: AppStatus) {
    try {
      const res = await api.patch<{ application: Application }>(`/applications/${app.id}`, { status });
      setFresh(res.application);
      toast(`Moved to ${STATUS_META[status].label}`);
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not change status', 'err');
    }
  }

  async function addNote() {
    if (!noteDraft.trim()) return;
    try {
      await api.post(`/applications/${app.id}/events`, { kind: 'note', body: noteDraft.trim() });
      setNoteDraft('');
      const res = await api.get<{ application: Application }>(`/applications/${app.id}`);
      setFresh(res.application);
      toast('Note added');
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add note', 'err');
    }
  }

  async function addContact() {
    if (!contact.name.trim()) return;
    try {
      await api.post(`/applications/${app.id}/contacts`, contact);
      setContact({ name: '', role: '', email: '' });
      setShowContact(false);
      const res = await api.get<{ application: Application }>(`/applications/${app.id}`);
      setFresh(res.application);
      toast('Contact saved');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add contact', 'err');
    }
  }

  async function deleteContact(id: number) {
    try {
      await api.del(`/applications/${app.id}/contacts/${id}`);
      setFresh((f) => ({ ...f, contacts: f.contacts.filter((c) => c.id !== id) }));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not remove contact', 'err');
    }
  }

  async function openDocs() {
    if (!app.jobId) return;
    try {
      const docs = await loadJobDocs(app.jobId);
      if (!docs.resume && !docs.cover) {
        toast('No documents yet — tailor them from the job feed', 'err');
        return;
      }
      setDocSet(docs);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load documents', 'err');
    }
  }

  const meta = STATUS_META[fresh.status];

  return (
    <>
      <Modal
        title={
          <span className="row" style={{ gap: 9 }}>
            <Icon name="pipeline" size={16} />
            <span>{truncate(fresh.job?.title ?? 'Application', 52)}</span>
            <span className={`badge badge-${meta.tone}`}>{meta.label}</span>
          </span>
        }
        onClose={onClose}
        width={760}
        footer={
          <>
            <ConfirmButton onConfirm={onDelete} label="Delete" confirmLabel="Delete application?" />
            <div className="spacer" />
            <button className="btn" onClick={openDocs}>
              <Icon name="file" size={14} /> Documents
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <Spinner /> : <Icon name="check" size={14} />} Save details
            </button>
          </>
        }
      >
        <div className="row" style={{ marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{fresh.job?.company ?? '—'}</div>
            <div className="hint">
              {fresh.job?.location ? `${fresh.job.location} · ` : ''}
              {fresh.job?.source ? sourceLabel(fresh.job.source) : ''}
              {fresh.appliedAt ? ` · applied ${formatDate(fresh.appliedAt)}` : ' · not submitted yet'}
            </div>
          </div>
          <div className="spacer" />
          {fresh.job && fresh.job.score != null && <ScoreRing score={fresh.job.score} small />}
          {fresh.job?.applyUrl && (
            <a className="btn btn-sm" href={fresh.job.applyUrl} target="_blank" rel="noreferrer">
              <Icon name="external" size={13} /> Posting
            </a>
          )}
        </div>

        <div className="grid-2" style={{ marginBottom: 16 }}>
          <div className="field">
            <label>Stage</label>
            <select className="select" value={fresh.status} onChange={(e) => setStatus(e.target.value as AppStatus)}>
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} — {STATUS_META[s.id].hint}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Next action on</label>
            <input className="input" type="date" value={nextActionAt} onChange={(e) => setNextActionAt(e.target.value)} />
          </div>
        </div>

        <div className="field" style={{ marginBottom: 14 }}>
          <label>Next action</label>
          <input
            className="input"
            placeholder="e.g. Follow up with the recruiter, prep system design"
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
          />
        </div>

        <div className="field" style={{ marginBottom: 18 }}>
          <label>Private notes</label>
          <textarea
            className="textarea"
            placeholder="Interviewers, salary discussed, questions to ask…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="divider" />

        <div className="row" style={{ marginBottom: 10 }}>
          <div className="section-title" style={{ margin: 0 }}>Timeline</div>
          <div className="spacer" />
          <span className="hint">{fresh.events.length} event{fresh.events.length === 1 ? '' : 's'}</span>
        </div>
        <div className="row" style={{ marginBottom: 14 }}>
          <input
            className="input"
            placeholder="Log a note — call, email, take-home sent…"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addNote()}
          />
          <button className="btn" onClick={addNote} disabled={!noteDraft.trim()}>
            <Icon name="plus" size={14} /> Log
          </button>
        </div>
        <div className="timeline">
          {[...fresh.events].reverse().map((e) => (
            <div className={`tl-item ${e.kind === 'status' ? 'status' : ''}`} key={e.id}>
              <div className="tl-dot" />
              <div>
                <div className="tl-body">{e.body}</div>
                <div className="tl-time">
                  {formatDate(e.createdAt)} · {relativeTime(e.createdAt)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="divider" />

        <div className="row" style={{ marginBottom: 10 }}>
          <div className="section-title" style={{ margin: 0 }}>Contacts</div>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => setShowContact((v) => !v)}>
            <Icon name={showContact ? 'x' : 'plus'} size={13} /> {showContact ? 'Cancel' : 'Add contact'}
          </button>
        </div>

        {showContact && (
          <div className="grid-3" style={{ marginBottom: 12 }}>
            <input className="input" placeholder="Name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
            <input className="input" placeholder="Role" value={contact.role} onChange={(e) => setContact({ ...contact, role: e.target.value })} />
            <div className="row" style={{ gap: 6 }}>
              <input className="input" placeholder="Email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
              <button className="btn btn-icon" onClick={addContact} disabled={!contact.name.trim()}>
                <Icon name="check" size={15} />
              </button>
            </div>
          </div>
        )}

        {fresh.contacts.length === 0 ? (
          <div className="hint">No contacts yet. Recruiter names and emails are the highest-value notes in a job search.</div>
        ) : (
          <div className="col" style={{ gap: 6 }}>
            {fresh.contacts.map((c) => (
              <div key={c.id} className="row" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px' }}>
                <Icon name="user" size={14} style={{ color: 'var(--muted)' }} />
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 550 }}>{c.name}</div>
                  <div className="hint">
                    {c.role}
                    {c.email ? ` · ${c.email}` : ''}
                  </div>
                </div>
                <div className="spacer" />
                {c.email && (
                  <a className="btn btn-ghost btn-icon" href={`mailto:${c.email}`} title="Email">
                    <Icon name="mail" size={14} />
                  </a>
                )}
                <button className="btn btn-ghost btn-icon" onClick={() => deleteContact(c.id)} title="Remove">
                  <Icon name="trash" size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="alert" style={{ marginTop: 18 }}>
          <Icon name="alert" size={15} />
          <div>
            Keep the next action dated. Applications with a scheduled follow-up get replies far more often than ones left to drift.
          </div>
        </div>
      </Modal>

      {docSet && (
        <DocViewer
          docs={docSet}
          subtitle={fresh.job ? `Tailored for ${fresh.job.title} at ${fresh.job.company}` : undefined}
          onClose={() => setDocSet(null)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
