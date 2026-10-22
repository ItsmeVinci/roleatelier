import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.SMOKE_PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(path.join(tmpdir(), 'jobpilot-smoke-'));

const resume = readFileSync(path.join(ROOT, 'samples', 'resume.txt'), 'utf8');

let child: ChildProcess | null = null;
let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function api(method: string, endpoint: string, body?: unknown): Promise<any> {
  const res = await fetch(BASE + endpoint, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${endpoint} -> ${res.status}: ${typeof json === 'string' ? json.slice(0, 300) : JSON.stringify(json)}`);
  return json;
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 150; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Server did not start within 22s');
}

function stopServer(): void {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

try {
  const tsxBin = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!existsSync(tsxBin)) throw new Error(`tsx CLI not found at ${tsxBin}`);
  console.log(`\nJobPilot smoke test  (port ${PORT})\n`);
  child = spawn(process.execPath, [tsxBin, 'server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), JOBPILOT_DATA: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout?.on('data', (d) => (serverLog += String(d)));
  child.stderr?.on('data', (d) => (serverLog += String(d)));

  await waitForServer();
  check('server starts and answers /api/health', true);

  const health = await api('GET', '/api/health');
  check('health payload', health.ok === true);

  const prof = await api('PUT', '/api/profile', {
    fullName: 'Vinod Kumar',
    email: 'vinod@example.com',
    phone: '+1 415 555 0134',
    location: 'San Francisco, CA',
    headline: 'Senior Backend Engineer',
    summary: 'Backend engineer with 8 years building distributed systems and data pipelines.',
    skills: ['Rust', 'TypeScript', 'Go', 'PostgreSQL', 'Kafka', 'AWS', 'Kubernetes', 'gRPC', 'React'],
    targetTitles: ['Backend Engineer', 'Platform Engineer'],
    yearsExperience: 8,
    salaryFloor: 150000,
    salaryCurrency: 'USD',
    remoteOk: true,
    preferredLocations: ['San Francisco', 'Remote'],
    workAuth: 'US citizen',
    workAuthStatus: 'authorized',
    links: { linkedin: 'https://linkedin.com/in/vinodkumar', github: 'https://github.com/vinodk', website: '', portfolio: '' },
    resumeText: resume,
    resumeFile: 'resume.txt',
  });
  check('profile saves', prof.profile.fullName === 'Vinod Kumar' && prof.profile.skills.length === 9);

  const answers = await api('POST', '/api/answers', {
    question: 'Are you authorized to work in the United States?',
    answer: 'Yes',
    category: 'eeo',
  });
  check('saved answer created', answers.answer.id > 0);

  // --- live ingestion (network) -------------------------------------------
  let jobs: any[] = [];
  try {
    const discovered = await api('POST', '/api/discover', {
      sources: ['remotive'],
      limitPerSource: 25,
      pages: 1,
    });
    const r = discovered.results?.[0];
    check('remotive ingestion', !!r && !r.error && r.fetched > 0, r?.error ?? 'no results');
    if (r?.error) console.log(`        ↳ ${r.error}`);
  } catch (err) {
    check('remotive ingestion', false, err instanceof Error ? err.message : String(err));
  }

  const list = await api('GET', '/api/jobs?sort=score&limit=50');
  jobs = list.jobs ?? [];
  check('jobs list is non-empty', jobs.length > 0, `${jobs.length} jobs`);
  check('jobs are scored', jobs.every((j: any) => typeof j.score === 'number' && j.score >= 0 && j.score <= 100));

  if (jobs.length) {
    const best = [...jobs].sort((a, b) => b.score - a.score)[0];
    check('best match has reasons', Array.isArray(best.reasons) && best.reasons.length > 0);
    check('best match has description text', typeof best.description === 'string' && best.description.length > 20);

    const detail = await api('GET', `/api/jobs/${best.id}`);
    check('job detail loads', detail.job?.id === best.id);

    const saved = await api('PATCH', `/api/jobs/${best.id}`, { saved: true });
    check('job can be saved', saved.job?.saved === true);

    const tailored = await api('POST', `/api/jobs/${best.id}/tailor`, { maxBullets: 4 });
    check('resume tailored', typeof tailored.resume?.content === 'string' && tailored.resume.content.includes('# Vinod Kumar'));
    check('cover letter tailored', typeof tailored.cover?.content === 'string' && tailored.cover.content.length > 150);
    check(
      'tailored resume keeps relevant bullets',
      /Rust ingestion pipeline|billing service|PostgreSQL/.test(tailored.resume.content),
      tailored.resume.content.slice(0, 200),
    );

    const render = await fetch(`${BASE}/api/docs/${tailored.resume.id}/render`);
    const html = await render.text();
    check('resume renders to printable HTML', render.ok && html.includes('<html') && html.includes('Vinod Kumar'));

    const md = await fetch(`${BASE}/api/docs/${tailored.resume.id}/download?format=md`);
    check('resume downloads as markdown', md.ok && (await md.text()).includes('## Summary'));

    const app = await api('POST', '/api/applications', { jobId: best.id, status: 'applied' });
    check('application created', app.application?.status === 'applied' && app.application.appliedAt);

    const moved = await api('PATCH', `/api/applications/${app.application.id}`, { status: 'interview', nextAction: 'Send thank-you note' });
    check('status advances', moved.application?.status === 'interview');
    check('status change logged', moved.application?.events?.some((e: any) => e.kind === 'status'));

    await api('POST', `/api/applications/${app.application.id}/events`, { kind: 'note', body: 'Recruiter call booked.' });
    await api('POST', `/api/applications/${app.application.id}/contacts`, { name: 'Dana Reed', role: 'Recruiter', email: 'dana@example.com' });
    const withBits = await api('GET', `/api/applications/${app.application.id}`);
    check('notes and contacts persist', withBits.application?.events?.length >= 3 && withBits.application?.contacts?.length === 1);

    const bookmarklet = await (await fetch(`${BASE}/api/autofill/bookmarklet?jobId=${best.id}`)).text();
    check('bookmarklet generated', bookmarklet.startsWith('javascript:') && bookmarklet.length > 2000);
    const decoded = decodeURIComponent(bookmarklet.slice('javascript:'.length));
    const embedded = /var B64 = '([A-Za-z0-9+/=]+)'/.exec(decoded)?.[1] ?? '';
    let payload: any = null;
    try {
      payload = JSON.parse(Buffer.from(embedded, 'base64').toString('utf8'));
    } catch {
      payload = null;
    }
    check(
      'bookmarklet embeds profile and job cover letter',
      payload?.profile?.email === 'vinod@example.com' &&
        payload?.job?.id === best.id &&
        typeof payload?.coverLetter === 'string' &&
        payload.coverLetter.length > 100,
      embedded ? `payload keys: ${Object.keys(payload ?? {}).join(',')}` : 'no payload found',
    );
    check('bookmarklet leaves a template placeholder unused', !decoded.includes('__PAYLOAD__'));

    const prompt = await (await fetch(`${BASE}/api/docs/${tailored.cover.id}/prompt`)).text();
    check('AI prompt includes job and resume', prompt.includes(best.title) && prompt.includes('Northwind Systems'));
  }

  const stats = await api('GET', '/api/stats');
  check('stats computed', stats.stats.totalApplications === 1 && stats.stats.byStatus.interview === 1);

  const sources = await api('GET', '/api/sources');
  check('sources listed', sources.sources.length >= 6);

  const backup = await api('GET', '/api/export');
  check('backup export', backup.app === 'jobpilot' && backup.jobs.length === jobs.length);

  const csv = await (await fetch(`${BASE}/api/applications.csv`)).text();
  check('csv export', csv.startsWith('id,company,title'));

  const settings = await api('PUT', '/api/settings', { adzuna_country: 'gb' });
  check('settings persist', settings.settings.adzuna_country === 'gb');

  const workday = await api('PUT', '/api/settings', {
    workday_boards: 'NVIDIA | https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
  });
  check('workday career site saved', workday.settings.has_workday === 'true');

  const searchLinks = await api('GET', '/api/search-links?q=backend%20engineer');
  const searchIds = new Set((searchLinks.links ?? []).map((link: any) => link.id));
  check(
    'targeted board search links built',
    ['linkedin', 'indeed', 'glassdoor'].every((id) => searchIds.has(id)),
  );
  check(
    'workday search link uses saved board',
    (searchLinks.links ?? []).some((link: any) => String(link.id).startsWith('workday-') && String(link.name).includes('NVIDIA')),
  );

  const manual = await api('POST', '/api/jobs/manual', {
    title: 'Senior Backend Engineer',
    company: 'Queue Test Co',
    location: 'Remote',
    remote: true,
    description:
      'Rust TypeScript Go PostgreSQL Kafka AWS Kubernetes gRPC React distributed systems data pipelines services.',
    url: 'https://example.com/queue-test',
    salaryMin: 180000,
    salaryMax: 220000,
    salaryCurrency: 'USD',
  });
  check('queue test job scores 75+', manual.job?.score >= 75, `score ${manual.job?.score}`);

  const queue = await api('POST', '/api/jobs/prepare-queue', { minScore: 90, limit: 5 });
  const queued = (queue.jobs ?? []).find((job: any) => job.id === manual.job.id);
  check('75+ queue prepares the job', !!queued && queued.docs === 2);
  check('75+ queue never submits', queue.note?.includes('Nothing was submitted'));
  if (queued) {
    const queuedApp = await api('GET', `/api/applications/${queued.applicationId}`);
    check('queued application stays saved', queuedApp.application?.status === 'saved');
    const queuedDocs = await api('GET', `/api/docs?jobId=${manual.job.id}`);
    check('queue creates tailored documents', queuedDocs.docs?.length >= 2);
  }

  const missing = await fetch(`${BASE}/api/nope`);
  check('unknown api returns 404 json', missing.status === 404);
} catch (err) {
  failures++;
  console.error('\n  FATAL:', err instanceof Error ? err.stack ?? err.message : err);
} finally {
  stopServer();
  try {
    await new Promise((r) => setTimeout(r, 400));
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // temp dir cleanup is best-effort on Windows
  }
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);
