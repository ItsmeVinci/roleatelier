import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Application, Profile } from '@shared/types';
import { api, apiText } from '../api';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { Spinner } from '../components/ui';
import { sourceLabel, truncate } from '../lib';

const FIELDS: { group: string; items: string[] }[] = [
  { group: 'Identity', items: ['First name', 'Last name', 'Full name', 'Email', 'Phone', 'City', 'Location'] },
  { group: 'Links', items: ['LinkedIn', 'GitHub', 'Portfolio / website'] },
  { group: 'Professional', items: ['Years of experience', 'Desired salary', 'Work authorisation (yes/no)', 'Professional summary'] },
  { group: 'Application', items: ['Cover letter (for the selected job)', 'Your saved answers, matched by question text'] },
];

export default function Autofill() {
  const toast = useToast();
  const [apps, setApps] = useState<Application[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [answersCount, setAnswersCount] = useState(0);
  const [jobId, setJobId] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<{ applications: Application[] }>('/applications'),
      api.get<{ profile: Profile }>('/profile'),
      api.get<{ answers: unknown[] }>('/answers'),
    ])
      .then(([a, p, s]) => {
        setApps(a.applications.filter((x) => x.jobId));
        setProfile(p.profile);
        setAnswersCount(s.answers.length);
      })
      .catch((err) => toast(err instanceof Error ? err.message : 'Could not load autofill data', 'err'))
      .finally(() => setLoading(false));
  }, [toast]);

  const jobs = useMemo(() => {
    const seen = new Set<number>();
    return apps.filter((a) => {
      if (!a.jobId || seen.has(a.jobId)) return false;
      seen.add(a.jobId);
      return true;
    });
  }, [apps]);

  const selected = jobs.find((a) => String(a.jobId) === jobId) ?? null;

  const generate = useCallback(async () => {
    setGenerating(true);
    try {
      const text = await apiText(`/autofill/bookmarklet${jobId ? `?jobId=${jobId}` : ''}`);
      setCode(text);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not generate the bookmarklet', 'err');
    } finally {
      setGenerating(false);
    }
  }, [jobId, toast]);

  useEffect(() => {
    void generate();
  }, [generate]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      toast('Bookmarklet code copied');
    } catch {
      toast('Clipboard blocked — select the code and copy manually', 'err');
    }
  }

  const completeness = profile
    ? [
        { label: 'Email', ok: !!profile.email },
        { label: 'Phone', ok: !!profile.phone },
        { label: 'Location', ok: !!profile.location },
        { label: 'Skills', ok: profile.skills.length > 0 },
        { label: 'Resume', ok: profile.resumeText.length > 200 },
        { label: 'Saved answers', ok: answersCount > 0 },
      ]
    : [];
  const missing = completeness.filter((c) => !c.ok);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Autofill applications</h1>
          <p>
            One bookmarklet that works on Greenhouse, Lever, Ashby, SmartRecruiters, Workday and most in-house forms. It fills
            what it can, tells you what is left, and never submits.
          </p>
        </div>
        <div className="spacer" />
        <a className="btn" href="/demo-form.html" target="_blank" rel="noreferrer">
          <Icon name="eye" size={15} /> Test form
        </a>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        <div className="col" style={{ gap: 16 }}>
          <section className="card card-pad">
            <div className="section-title">1 · Pick the application</div>
            <p className="hint" style={{ marginTop: 0 }}>
              Choosing a job embeds that role’s tailored cover letter. Without a job, the most recent cover letter is used.
            </p>
            <select className="select" value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">Profile only (no job-specific letter)</option>
              {jobs.map((a) => (
                <option key={a.id} value={a.jobId ?? ''}>
                  {a.job?.title} — {a.job?.company} ({a.status})
                </option>
              ))}
            </select>
            {jobs.length === 0 && (
              <div className="hint" style={{ marginTop: 8 }}>
                No applications yet. Tailor documents from the job feed to unlock job-specific cover letters.
              </div>
            )}
          </section>

          <section className="card card-pad">
            <div className="section-title">2 · Drag this to your bookmarks bar</div>
            {loading || generating || !code ? (
              <div className="row" style={{ padding: '18px 0' }}>
                <Spinner /> <span className="hint">Building your payload…</span>
              </div>
            ) : (
              <>
                <a
                  className="bookmarklet"
                  href={code}
                  draggable
                  onClick={(e) => {
                    e.preventDefault();
                    toast('Drag it to your bookmarks bar — clicking runs it on this page');
                  }}
                >
                  <Icon name="zap" size={16} />
                  Fill with RoleAtelier
                </a>
                <div className="row" style={{ marginTop: 12, gap: 8 }}>
                  <button className="btn btn-sm" onClick={generate} disabled={generating}>
                    <Icon name="refresh" size={13} /> Regenerate
                  </button>
                  <button className="btn btn-sm" onClick={copyCode}>
                    <Icon name="copy" size={13} /> Copy code
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowCode((v) => !v)}>
                    {showCode ? 'Hide' : 'Show'} raw
                  </button>
                </div>
                <div className="hint" style={{ marginTop: 10 }}>
                  Chrome/Edge: drag to the bar under the address field. Firefox: right-click the bar → “New bookmark” and paste
                  the copied code as the URL. Safari: add any bookmark, then edit its address.
                </div>
                {showCode && (
                  <textarea
                    readOnly
                    className="textarea mono"
                    style={{ marginTop: 10, minHeight: 120, fontSize: 10 }}
                    value={code}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                )}
              </>
            )}
          </section>

          <section className="card card-pad">
            <div className="section-title">3 · On the application page</div>
            <div className="steps">
              <div className="step">Fill in your profile, skills and resume in RoleAtelier — the bookmarklet reads that saved data.</div>
              <div className="step">Open the real application form in a new tab, ideally before typing anything.</div>
              <div className="step">Click <strong>Fill with RoleAtelier</strong> in your bookmarks bar. A toast reports how many fields were filled.</div>
              <div className="step">Review every field, attach your resume (browsers block scripts from setting file inputs), then submit yourself.</div>
            </div>
            <div className="alert" style={{ marginTop: 16 }}>
              <Icon name="alert" size={15} />
              <div>
                RoleAtelier deliberately does not auto-submit. Automated submissions violate the terms of most boards and get
                accounts and domains banned — the one-click review is the part that keeps you employable.
              </div>
            </div>
          </section>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <section className="card card-pad">
            <div className="row" style={{ marginBottom: 12 }}>
              <div className="section-title" style={{ margin: 0 }}>What it fills</div>
              <div className="spacer" />
              <span className="badge badge-mint">label matching</span>
            </div>
            <div className="col" style={{ gap: 14 }}>
              {FIELDS.map((f) => (
                <div key={f.group}>
                  <div className="label" style={{ marginBottom: 6 }}>{f.group}</div>
                  <div className="chips">
                    {f.items.map((i) => (
                      <span className="chip" key={i} style={{ fontSize: 11.2 }}>
                        {i}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 14 }}>
              It matches on <span className="kbd">name</span>, <span className="kbd">id</span>,{' '}
              <span className="kbd">label</span>, <span className="kbd">placeholder</span>,{' '}
              <span className="kbd">autocomplete</span> and <span className="kbd">aria-label</span> — not on pixels, so it
              survives redesigns.
            </div>
          </section>

          <section className="card card-pad">
            <div className="section-title">Payload readiness</div>
            {!profile ? (
              <div className="hint">Loading…</div>
            ) : (
              <>
                <div className="col" style={{ gap: 6 }}>
                  {completeness.map((c) => (
                    <div key={c.label} className="row" style={{ gap: 8, fontSize: 12.5 }}>
                      <span className={c.ok ? 'badge badge-green' : 'badge'} style={{ width: 20, justifyContent: 'center', padding: 2 }}>
                        {c.ok ? <Icon name="check" size={11} /> : <Icon name="x" size={10} />}
                      </span>
                      <span style={{ color: c.ok ? 'var(--text)' : 'var(--muted)' }}>{c.label}</span>
                    </div>
                  ))}
                </div>
                {missing.length > 0 && (
                  <div className="alert info" style={{ marginTop: 12 }}>
                    <Icon name="alert" size={14} />
                    <div>
                      Missing {missing.map((m) => m.label).join(', ')}. The bookmarklet will skip those fields instead of
                      guessing.
                    </div>
                  </div>
                )}
              </>
            )}
            {selected?.job && (
              <div className="hint" style={{ marginTop: 12 }}>
                Cover letter source: <strong>{truncate(selected.job.title, 40)}</strong> at {selected.job.company}
                {selected.job.source ? ` · ${sourceLabel(selected.job.source)}` : ''}
              </div>
            )}
          </section>

          <section className="card card-pad">
            <div className="section-title">When a field does not fill</div>
            <div className="col" style={{ gap: 10, fontSize: 12.5, color: 'var(--muted)' }}>
              <div>
                <strong style={{ color: 'var(--text)' }}>Custom dropdowns.</strong> Many ATSs use React select menus, not native
                selects. Pick those manually.
              </div>
              <div>
                <strong style={{ color: 'var(--text)' }}>Inside an iframe.</strong> Some embedded forms run in a cross-origin
                frame, which no bookmarklet can reach. Open the form in its own tab.
              </div>
              <div>
                <strong style={{ color: 'var(--text)' }}>Yes/no questions.</strong> Add them as saved answers with the exact
                wording — RoleAtelier matches at 70% word overlap.
              </div>
            </div>
            <button className="btn btn-sm" style={{ marginTop: 14 }} onClick={() => (window.location.hash = '/profile')}>
              <Icon name="user" size={14} /> Edit profile &amp; answers
            </button>
          </section>
        </div>
      </div>
    </>
  );
}
