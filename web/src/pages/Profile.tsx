import { useCallback, useEffect, useRef, useState } from 'react';
import type { Profile, SavedAnswer } from '@shared/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { ConfirmButton, Field, Spinner, TagInput } from '../components/ui';

const EMPTY: Profile = {
  fullName: '',
  email: '',
  phone: '',
  location: '',
  headline: '',
  summary: '',
  skills: [],
  targetTitles: [],
  yearsExperience: 0,
  workAuth: '',
  workAuthStatus: '',
  salaryFloor: null,
  salaryCurrency: 'USD',
  remoteOk: true,
  preferredLocations: [],
  mustInclude: [],
  mustExclude: [],
  links: { linkedin: '', github: '', website: '', portfolio: '' },
  resumeText: '',
  resumeFile: '',
  updatedAt: '',
};

export default function ProfilePage({ onSaved }: { onSaved: () => void }) {
  const toast = useToast();
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [answers, setAnswers] = useState<SavedAnswer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newAnswer, setNewAnswer] = useState({ question: '', answer: '', category: 'general' });
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        api.get<{ profile: Profile }>('/profile'),
        api.get<{ answers: SavedAnswer[] }>('/answers'),
      ]);
      setProfile({ ...EMPTY, ...p.profile });
      setAnswers(a.answers);
      setDirty(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load your profile', 'err');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((p) => ({ ...p, [key]: value }));
    setDirty(true);
  }

  function setLink(key: keyof Profile['links'], value: string) {
    setProfile((p) => ({ ...p, links: { ...p.links, [key]: value } }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await api.put<{ profile: Profile; rescored: number }>('/profile', profile);
      setProfile(res.profile);
      setDirty(false);
      toast(`Profile saved · ${res.rescored} role${res.rescored === 1 ? '' : 's'} rescored`);
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save your profile', 'err');
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append('resume', file);
      const res = await fetch('/api/profile/resume', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Upload failed');
      setProfile(data.profile);
      setDirty(false);
      toast(`Read ${data.characters.toLocaleString()} characters from ${data.filename}`);
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not read that file', 'err');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function addAnswer() {
    if (!newAnswer.question.trim() || !newAnswer.answer.trim()) return;
    try {
      const res = await api.post<{ answer: SavedAnswer }>('/answers', newAnswer);
      setAnswers((a) => [...a, res.answer]);
      setNewAnswer({ question: '', answer: '', category: newAnswer.category });
      toast('Answer saved — autofill will use it');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save that answer', 'err');
    }
  }

  async function deleteAnswer(id: number) {
    try {
      await api.del(`/answers/${id}`);
      setAnswers((a) => a.filter((x) => x.id !== id));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete', 'err');
    }
  }

  const completeness = [
    !!profile.fullName,
    !!profile.email,
    profile.skills.length >= 3,
    profile.targetTitles.length > 0,
    profile.resumeText.length > 200,
    !!profile.location,
    profile.yearsExperience > 0,
    !!profile.summary,
  ];
  const done = completeness.filter(Boolean).length;

  if (loading) {
    return (
      <div className="col" style={{ gap: 14 }}>
        <div className="skeleton" style={{ height: 90 }} />
        <div className="skeleton" style={{ height: 260 }} />
        <div className="skeleton" style={{ height: 180 }} />
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Your profile</h1>
          <p>
            This is the source of truth for scoring and tailoring. The more precise the skills and target titles, the better
            the fit ranking gets.
          </p>
        </div>
        <div className="spacer" />
        <div className="row" style={{ gap: 8 }}>
          <div style={{ minWidth: 130 }}>
            <div className="hint" style={{ marginBottom: 4 }}>
              {done}/8 complete
            </div>
            <div className="funnel-track">
              <div className="funnel-bar" style={{ width: `${(done / 8) * 100}%`, background: 'var(--accent)' }} />
            </div>
          </div>
          <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
            {saving ? <Spinner /> : <Icon name="check" size={15} />}
            {saving ? 'Saving…' : dirty ? 'Save profile' : 'Saved'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        <div className="col" style={{ gap: 16 }}>
          <section className="card card-pad">
            <div className="section-title">Identity</div>
            <div className="grid-2">
              <Field label="Full name">
                <input className="input" value={profile.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="Ada Lovelace" />
              </Field>
              <Field label="Headline">
                <input className="input" value={profile.headline} onChange={(e) => set('headline', e.target.value)} placeholder="Senior Backend Engineer" />
              </Field>
              <Field label="Email">
                <input className="input" type="email" value={profile.email} onChange={(e) => set('email', e.target.value)} placeholder="you@example.com" />
              </Field>
              <Field label="Phone">
                <input className="input" value={profile.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+1 555 000 0000" />
              </Field>
              <Field label="Location" hint="City, region — used for location fit">
                <input className="input" value={profile.location} onChange={(e) => set('location', e.target.value)} placeholder="Berlin, Germany" />
              </Field>
              <Field label="Years of experience">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={60}
                  value={profile.yearsExperience}
                  onChange={(e) => set('yearsExperience', Number(e.target.value) || 0)}
                />
              </Field>
            </div>
            <div className="grid-2" style={{ marginTop: 14 }}>
              <Field label="LinkedIn">
                <input className="input" value={profile.links.linkedin} onChange={(e) => setLink('linkedin', e.target.value)} placeholder="linkedin.com/in/you" />
              </Field>
              <Field label="GitHub">
                <input className="input" value={profile.links.github} onChange={(e) => setLink('github', e.target.value)} placeholder="github.com/you" />
              </Field>
              <Field label="Website">
                <input className="input" value={profile.links.website} onChange={(e) => setLink('website', e.target.value)} placeholder="you.dev" />
              </Field>
              <Field label="Portfolio">
                <input className="input" value={profile.links.portfolio} onChange={(e) => setLink('portfolio', e.target.value)} placeholder="behance.net/you" />
              </Field>
            </div>
          </section>

          <section className="card card-pad">
            <div className="section-title">Targeting</div>
            <div className="grid-2">
              <Field label="Target titles" hint="Roles you actually want. Used for title fit.">
                <TagInput value={profile.targetTitles} onChange={(v) => set('targetTitles', v)} placeholder="Backend Engineer, Platform Engineer" />
              </Field>
              <Field label="Preferred locations" hint="Leave empty for anywhere.">
                <TagInput value={profile.preferredLocations} onChange={(v) => set('preferredLocations', v)} placeholder="Berlin, Remote EU" />
              </Field>
            </div>

            <div className="grid-2" style={{ marginTop: 14 }}>
              <Field label="Skills" hint="Be specific — 'Rust', 'PostgreSQL', 'Kubernetes'. These drive the score.">
                <TagInput value={profile.skills} onChange={(v) => set('skills', v)} placeholder="Add a skill" />
              </Field>
              <div className="col" style={{ gap: 14 }}>
                <Field label="Work authorisation">
                  <select
                    className="select"
                    value={profile.workAuthStatus}
                    onChange={(e) => set('workAuthStatus', e.target.value as Profile['workAuthStatus'])}
                  >
                    <option value="">Prefer not to say (won’t autofill)</option>
                    <option value="authorized">Authorised to work — no sponsorship</option>
                    <option value="needs-sponsorship">Needs visa sponsorship</option>
                  </select>
                </Field>
                <Field label="Details" hint="Shown to you, and used in the autofill payload.">
                  <input
                    className="input"
                    value={profile.workAuth}
                    onChange={(e) => set('workAuth', e.target.value)}
                    placeholder="US citizen · EU Blue Card"
                  />
                </Field>
              </div>
            </div>

            <div className="grid-3" style={{ marginTop: 14 }}>
              <Field label="Salary floor" hint="Annual. Jobs below it score lower.">
                <input
                  className="input"
                  type="number"
                  value={profile.salaryFloor ?? ''}
                  onChange={(e) => set('salaryFloor', e.target.value ? Number(e.target.value) : null)}
                  placeholder="120000"
                />
              </Field>
              <Field label="Currency">
                <select className="select" value={profile.salaryCurrency} onChange={(e) => set('salaryCurrency', e.target.value)}>
                  <option>USD</option>
                  <option>EUR</option>
                  <option>GBP</option>
                  <option>INR</option>
                  <option>CAD</option>
                  <option>AUD</option>
                </select>
              </Field>
              <Field label="Remote">
                <label className="checkbox" style={{ height: 38 }}>
                  <input type="checkbox" checked={profile.remoteOk} onChange={(e) => set('remoteOk', e.target.checked)} />
                  Open to remote roles
                </label>
              </Field>
            </div>

            <div className="grid-2" style={{ marginTop: 14 }}>
              <Field label="Must include" hint="Jobs missing these score much lower.">
                <TagInput value={profile.mustInclude} onChange={(v) => set('mustInclude', v)} placeholder="remote, python" />
              </Field>
              <Field label="Must exclude" hint="Any hit buries the job at the bottom.">
                <TagInput value={profile.mustExclude} onChange={(v) => set('mustExclude', v)} placeholder="unpaid, commission only" />
              </Field>
            </div>

            <Field label="Professional summary" style={{ marginTop: 14 }} hint="Two or three sentences. Used as the base of every tailored summary.">
              <textarea className="textarea" value={profile.summary} onChange={(e) => set('summary', e.target.value)} placeholder="Backend engineer with 8 years building distributed systems…" />
            </Field>
          </section>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <section className="card card-pad">
            <div className="row" style={{ marginBottom: 4 }}>
              <div className="section-title" style={{ margin: 0 }}>Resume</div>
              <div className="spacer" />
              {profile.resumeFile && <span className="badge">{profile.resumeFile}</span>}
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              Upload PDF, DOCX, TXT or Markdown. Tailoring reads bullets and re-orders them per job — the raw text is never sent
              anywhere.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.markdown"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            <div className="row" style={{ marginBottom: 10 }}>
              <button className="btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Spinner /> : <Icon name="upload" size={15} />}
                {uploading ? 'Reading…' : 'Upload resume'}
              </button>
              {profile.resumeText && (
                <ConfirmButton
                  label="Clear text"
                  confirmLabel="Clear resume text?"
                  icon="trash"
                  className="btn btn-ghost btn-sm"
                  onConfirm={() => {
                    set('resumeText', '');
                    set('resumeFile', '');
                  }}
                />
              )}
            </div>
            <textarea
              className="textarea"
              style={{ minHeight: 260, fontFamily: 'var(--mono)', fontSize: 11.5 }}
              value={profile.resumeText}
              onChange={(e) => set('resumeText', e.target.value)}
              placeholder="Paste your resume text here if you prefer. Keep the original structure — headings, role lines, and bullets."
            />
            <div className="hint" style={{ marginTop: 6 }}>
              {profile.resumeText.length.toLocaleString()} characters
              {profile.resumeText.length < 200 && ' · paste or upload to unlock real tailoring'}
            </div>
          </section>

          <section className="card card-pad">
            <div className="section-title">Saved answers</div>
            <p className="hint" style={{ marginTop: 0 }}>
              Reused by the autofill bookmarklet when it sees a matching question. Add EEO answers here so you never type them
              again.
            </p>

            <div className="col" style={{ gap: 8, marginBottom: 14 }}>
              {answers.length === 0 && <div className="hint">No saved answers yet.</div>}
              {answers.map((a) => (
                <div key={a.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '9px 11px' }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span style={{ fontSize: 12.3, fontWeight: 550 }}>{a.question}</span>
                    <div className="spacer" />
                    <span className="tag">{a.category}</span>
                    <button className="btn btn-ghost btn-icon" style={{ width: 24, height: 24 }} onClick={() => deleteAnswer(a.id)}>
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                  <div className="hint" style={{ marginTop: 2 }}>
                    {a.answer}
                  </div>
                </div>
              ))}
            </div>

            <div className="col" style={{ gap: 8, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
              <input
                className="input"
                placeholder="Question, e.g. Are you authorised to work in the US?"
                value={newAnswer.question}
                onChange={(e) => setNewAnswer({ ...newAnswer, question: e.target.value })}
              />
              <div className="row" style={{ gap: 8 }}>
                <input
                  className="input"
                  placeholder="Answer"
                  value={newAnswer.answer}
                  onChange={(e) => setNewAnswer({ ...newAnswer, answer: e.target.value })}
                />
                <select
                  className="select"
                  style={{ width: 120 }}
                  value={newAnswer.category}
                  onChange={(e) => setNewAnswer({ ...newAnswer, category: e.target.value })}
                >
                  <option value="general">General</option>
                  <option value="logistics">Logistics</option>
                  <option value="eeo">EEO</option>
                  <option value="custom">Custom</option>
                </select>
                <button className="btn btn-icon" onClick={addAnswer} disabled={!newAnswer.question.trim() || !newAnswer.answer.trim()}>
                  <Icon name="plus" size={15} />
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      {dirty && (
        <div
          style={{
            position: 'sticky',
            bottom: 12,
            marginTop: 18,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 14px',
            background: 'rgba(16,20,27,.92)',
            border: '1px solid var(--line-strong)',
            borderRadius: 12,
            backdropFilter: 'blur(12px)',
          }}
        >
          <span className="hint">Unsaved changes — save to rescore your whole feed.</span>
          <div className="spacer" />
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              void load();
            }}
          >
            Discard
          </button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
            {saving ? <Spinner /> : <Icon name="check" size={14} />} Save profile
          </button>
        </div>
      )}
    </>
  );
}
