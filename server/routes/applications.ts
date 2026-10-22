import { Router } from 'express';
import { all, get, nowIso, run } from '../db.ts';
import type { AppStatus, Stats } from '../../shared/types.ts';
import { STATUSES } from '../../shared/types.ts';
import { asString, fail, wrap } from './util.ts';

export const appsRouter = Router();

const VALID = new Set(STATUSES.map((s) => s.id));

function appId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid application id');
  return id;
}

interface AppRow {
  id: number;
  job_id: number | null;
  status: string;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
  notes: string;
  next_action: string;
  next_action_at: string | null;
  title: string | null;
  company: string | null;
  source: string | null;
  score: number | null;
  apply_url: string | null;
  job_location: string | null;
  job_remote: number | null;
}

const APP_SELECT = `
  SELECT a.*, j.title, j.company, j.source, j.score, j.apply_url, j.location AS job_location, j.remote AS job_remote
  FROM applications a LEFT JOIN jobs j ON j.id = a.job_id
`;

function toApp(r: AppRow) {
  return {
    id: Number(r.id),
    jobId: r.job_id == null ? null : Number(r.job_id),
    status: r.status as AppStatus,
    appliedAt: r.applied_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    notes: r.notes,
    nextAction: r.next_action,
    nextActionAt: r.next_action_at,
    job: r.job_id == null
      ? null
      : {
          id: Number(r.job_id),
          title: r.title ?? '',
          company: r.company ?? '',
          source: r.source ?? '',
          score: Number(r.score ?? 0),
          applyUrl: r.apply_url ?? '',
          location: r.job_location ?? '',
          remote: !!r.job_remote,
        },
    events: all('SELECT id, application_id, kind, body, created_at FROM events WHERE application_id = ? ORDER BY id ASC', r.id).map(
      (e: any) => ({ id: Number(e.id), applicationId: Number(e.application_id), kind: e.kind, body: e.body, createdAt: e.created_at }),
    ),
    contacts: all('SELECT id, application_id, name, role, email, notes FROM contacts WHERE application_id = ? ORDER BY id', r.id).map(
      (c: any) => ({
        id: Number(c.id),
        applicationId: Number(c.application_id),
        name: c.name,
        role: c.role,
        email: c.email,
        notes: c.notes,
      }),
    ),
    docs: all('SELECT id, job_id, kind, title, created_at, updated_at FROM docs WHERE job_id = ? ORDER BY id DESC', r.job_id).map(
      (d: any) => ({
        id: Number(d.id),
        jobId: d.job_id == null ? null : Number(d.job_id),
        kind: d.kind,
        title: d.title,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      }),
    ),
  };
}

appsRouter.get(
  '/applications',
  wrap((req, res) => {
    const status = asString(req.query.status, 30);
    const where = status && VALID.has(status as AppStatus) ? 'WHERE a.status = ?' : '';
    const rows = all<AppRow>(`${APP_SELECT} ${where} ORDER BY a.updated_at DESC`, ...(where ? [status] : []));
    res.json({ applications: rows.map(toApp) });
  }),
);

appsRouter.get(
  '/applications/:id',
  wrap((req, res) => {
    const row = get<AppRow>(`${APP_SELECT} WHERE a.id = ?`, appId(req.params.id));
    if (!row) return fail(res, 404, 'Application not found');
    res.json({ application: toApp(row) });
  }),
);

appsRouter.post(
  '/applications',
  wrap((req, res) => {
    const jobId = Number(req.body?.jobId);
    if (!Number.isInteger(jobId) || jobId <= 0) return fail(res, 400, 'A valid jobId is required');
    const job = get<{ id: number; title: string; company: string }>('SELECT id, title, company FROM jobs WHERE id = ?', jobId);
    if (!job) return fail(res, 404, 'Job not found');

    const requested = asString(req.body?.status, 30) as AppStatus;
    const status: AppStatus = VALID.has(requested) ? requested : 'saved';
    const existing = get<AppRow>(`${APP_SELECT} WHERE a.job_id = ?`, jobId);
    if (existing) return res.json({ application: toApp(existing), existed: true });

    const now = nowIso();
    const { lastId } = run(
      `INSERT INTO applications (job_id, status, applied_at, created_at, updated_at, notes, next_action, next_action_at)
       VALUES (?, ?, ?, ?, ?, ?, '', NULL)`,
      jobId,
      status,
      status === 'saved' ? null : now,
      now,
      now,
      asString(req.body?.notes, 4000),
    );
    run(
      'INSERT INTO events (application_id, kind, body, created_at) VALUES (?, ?, ?, ?)',
      lastId,
      'created',
      `Added ${job.title} at ${job.company} to the pipeline`,
      now,
    );
    const row = get<AppRow>(`${APP_SELECT} WHERE a.id = ?`, lastId);
    res.status(201).json({ application: row ? toApp(row) : null });
  }),
);

appsRouter.patch(
  '/applications/:id',
  wrap((req, res) => {
    const id = appId(req.params.id);
    const existing = get<AppRow>(`${APP_SELECT} WHERE a.id = ?`, id);
    if (!existing) return fail(res, 404, 'Application not found');

    const now = nowIso();
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];
    let statusChanged: AppStatus | null = null;

    if (req.body?.status !== undefined) {
      const next = asString(req.body.status, 30) as AppStatus;
      if (!VALID.has(next)) return fail(res, 400, `Unknown status “${next}”`);
      if (next !== existing.status) {
        statusChanged = next;
        sets.push('status = ?');
        params.push(next);
        if (next !== 'saved' && !existing.applied_at) {
          sets.push('applied_at = ?');
          params.push(now);
        }
      }
    }
    if (req.body?.notes !== undefined) {
      sets.push('notes = ?');
      params.push(asString(req.body.notes, 20_000));
    }
    if (req.body?.nextAction !== undefined) {
      sets.push('next_action = ?');
      params.push(asString(req.body.nextAction, 500));
    }
    if (req.body?.nextActionAt !== undefined) {
      const raw = asString(req.body.nextActionAt, 40).trim();
      sets.push('next_action_at = ?');
      params.push(raw || null);
    }

    run(`UPDATE applications SET ${sets.join(', ')} WHERE id = ?`, ...params, id);

    if (statusChanged) {
      const label = (s: string) => STATUSES.find((x) => x.id === s)?.label ?? s;
      run(
        'INSERT INTO events (application_id, kind, body, created_at) VALUES (?, ?, ?, ?)',
        id,
        'status',
        `Status: ${label(existing.status)} → ${label(statusChanged)}`,
        now,
      );
    }

    const row = get<AppRow>(`${APP_SELECT} WHERE a.id = ?`, id);
    res.json({ application: row ? toApp(row) : null });
  }),
);

appsRouter.delete(
  '/applications/:id',
  wrap((req, res) => {
    run('DELETE FROM applications WHERE id = ?', appId(req.params.id));
    res.json({ ok: true });
  }),
);

appsRouter.post(
  '/applications/:id/events',
  wrap((req, res) => {
    const id = appId(req.params.id);
    const body = asString(req.body?.body, 5000).trim();
    if (!body) return fail(res, 400, 'Event body is required');
    const { lastId } = run(
      'INSERT INTO events (application_id, kind, body, created_at) VALUES (?, ?, ?, ?)',
      id,
      asString(req.body?.kind, 20) || 'note',
      body,
      nowIso(),
    );
    run('UPDATE applications SET updated_at = ? WHERE id = ?', nowIso(), id);
    res.status(201).json({ id: lastId });
  }),
);

appsRouter.post(
  '/applications/:id/contacts',
  wrap((req, res) => {
    const id = appId(req.params.id);
    const name = asString(req.body?.name, 200).trim();
    if (!name) return fail(res, 400, 'A contact name is required');
    const { lastId } = run(
      'INSERT INTO contacts (application_id, name, role, email, notes) VALUES (?, ?, ?, ?, ?)',
      id,
      name,
      asString(req.body?.role, 200),
      asString(req.body?.email, 200),
      asString(req.body?.notes, 2000),
    );
    res.status(201).json({ ok: true, id: lastId });
  }),
);

appsRouter.delete(
  '/applications/:id/contacts/:contactId',
  wrap((req, res) => {
    run('DELETE FROM contacts WHERE id = ? AND application_id = ?', Number(req.params.contactId), appId(req.params.id));
    res.json({ ok: true });
  }),
);

appsRouter.get(
  '/stats',
  wrap((_req, res) => {
    const rows = all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM applications GROUP BY status');
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s.id, 0])) as Record<AppStatus, number>;
    for (const r of rows) {
      if (r.status in byStatus) byStatus[r.status as AppStatus] = Number(r.n);
    }

    const totalApplications = get<{ n: number }>('SELECT COUNT(*) AS n FROM applications')?.n ?? 0;
    const appliedTotal =
      get<{ n: number }>('SELECT COUNT(*) AS n FROM applications WHERE applied_at IS NOT NULL')?.n ?? 0;
    const responded =
      (byStatus.screening ?? 0) + (byStatus.interview ?? 0) + (byStatus.offer ?? 0) + (byStatus.rejected ?? 0);
    const interviews = (byStatus.interview ?? 0) + (byStatus.offer ?? 0);

    const bySourceRows = all<{ source: string; applied: number; responded: number }>(`
      SELECT COALESCE(j.source, 'manual') AS source,
             COUNT(*) AS applied,
             SUM(CASE WHEN a.status IN ('screening','interview','offer','rejected') THEN 1 ELSE 0 END) AS responded
      FROM applications a LEFT JOIN jobs j ON j.id = a.job_id
      WHERE a.applied_at IS NOT NULL
      GROUP BY COALESCE(j.source, 'manual')
      ORDER BY applied DESC
    `);

    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const thisWeek = get<{ n: number }>('SELECT COUNT(*) AS n FROM applications WHERE created_at >= ?', weekAgo)?.n ?? 0;

    const dueRows = all<{
      application_id: number;
      company: string | null;
      title: string | null;
      next_action: string;
      next_action_at: string;
    }>(
      `SELECT a.id AS application_id, j.company, j.title, a.next_action, a.next_action_at
       FROM applications a LEFT JOIN jobs j ON j.id = a.job_id
       WHERE a.next_action_at IS NOT NULL AND a.next_action_at != ''
         AND a.status NOT IN ('offer','rejected','withdrawn')
       ORDER BY a.next_action_at ASC LIMIT 8`,
    );

    const stats: Stats = {
      jobs: Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM jobs WHERE hidden = 0')?.n ?? 0),
      saved: Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM jobs WHERE saved = 1')?.n ?? 0),
      byStatus,
      totalApplications: Number(totalApplications),
      responseRate: appliedTotal ? Math.round((responded / appliedTotal) * 100) : 0,
      interviewRate: appliedTotal ? Math.round((interviews / appliedTotal) * 100) : 0,
      offers: byStatus.offer ?? 0,
      thisWeek: Number(thisWeek),
      bySource: bySourceRows.map((r) => ({
        source: r.source,
        applied: Number(r.applied),
        responded: Number(r.responded),
      })),
      dueActions: dueRows.map((r) => ({
        applicationId: Number(r.application_id),
        company: r.company ?? '',
        title: r.title ?? '',
        nextAction: r.next_action,
        nextActionAt: r.next_action_at,
      })),
    };
    res.json({ stats });
  }),
);
