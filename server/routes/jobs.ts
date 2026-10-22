import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import {
  JOB_SELECT,
  all,
  get,
  getProfile,
  nowIso,
  run,
  rowToJob,
  type JobRow,
} from '../db.ts';
import { scoreJob } from '../match.ts';
import { ingestJobs, type NormalizedJob } from '../sources.ts';
import { scrapeJobUrl } from '../scrape.ts';
import { tailorDocuments } from '../tailor.ts';
import type { QueueJob } from '../../shared/types.ts';
import { asBool, asNumber, asString, fail, wrap } from './util.ts';

export const jobsRouter = Router();

function idParam(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid job id');
  return id;
}

jobsRouter.get(
  '/jobs',
  wrap((req, res) => {
    const q = asString(req.query.query, 200).trim();
    const source = asString(req.query.source, 30).trim();
    const remote = req.query.remote === 'true';
    const minScore = asNumber(req.query.minScore);
    const saved = req.query.saved === 'true';
    const includeHidden = req.query.includeHidden === 'true';
    const sort = asString(req.query.sort, 20) || 'score';
    const limit = Math.max(1, Math.min(200, asNumber(req.query.limit) ?? 60));
    const offset = Math.max(0, asNumber(req.query.offset) ?? 0);

    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];

    if (!includeHidden) where.push('j.hidden = 0');
    if (saved) where.push('j.saved = 1');
    if (remote) where.push('j.remote = 1');
    if (source) {
      where.push('j.source = ?');
      params.push(source);
    }
    if (minScore != null) {
      where.push('j.score >= ?');
      params.push(minScore);
    }
    if (q) {
      where.push('(j.title LIKE ? OR j.company LIKE ? OR j.description LIKE ? OR j.tags LIKE ? OR j.location LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }

    const order =
      sort === 'newest'
        ? 'COALESCE(j.posted_at, j.fetched_at) DESC'
        : sort === 'salary'
          ? 'COALESCE(j.salary_max, j.salary_min, 0) DESC'
          : sort === 'company'
            ? 'j.company COLLATE NOCASE ASC'
            : 'j.score DESC, COALESCE(j.posted_at, j.fetched_at) DESC';

    const whereSql = where.join(' AND ');
    const rows = all<JobRow>(`${JOB_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, limit, offset);
    const total = get<{ c: number }>(`SELECT COUNT(*) AS c FROM jobs j WHERE ${whereSql}`, ...params);

    res.json({ jobs: rows.map(rowToJob), total: Number(total?.c ?? 0), limit, offset });
  }),
);

jobsRouter.get(
  '/jobs/:id',
  wrap((req, res) => {
    const id = idParam(req.params.id);
    const row = get<JobRow>(`${JOB_SELECT} WHERE j.id = ?`, id);
    if (!row) return fail(res, 404, 'Job not found');
    const application = get<{ id: number; status: string; notes: string; next_action_at: string | null }>(
      'SELECT id, status, notes, next_action_at FROM applications WHERE job_id = ?',
      id,
    );
    const docs = all<{ id: number; kind: string; title: string }>(
      'SELECT id, kind, title FROM docs WHERE job_id = ? ORDER BY id DESC',
      id,
    );
    res.json({
      job: rowToJob(row),
      application: application
        ? {
            id: Number(application.id),
            status: application.status,
            notes: application.notes,
            nextActionAt: application.next_action_at,
          }
        : null,
      docs: docs.map((d) => ({ id: Number(d.id), kind: d.kind, title: d.title })),
    });
  }),
);

jobsRouter.post(
  '/jobs/prepare-queue',
  wrap((req, res) => {
    const minScore = Math.max(0, Math.min(100, asNumber(req.body?.minScore) ?? 75));
    const limit = Math.max(1, Math.min(20, asNumber(req.body?.limit) ?? 10));
    const rows = all<JobRow>(
      `${JOB_SELECT}
       WHERE j.hidden = 0 AND j.score >= ? AND a.id IS NULL
       ORDER BY j.score DESC, COALESCE(j.posted_at, j.fetched_at) DESC
       LIMIT ?`,
      minScore,
      limit,
    );

    const profile = getProfile();
    const now = nowIso();
    const prepared: QueueJob[] = [];

    for (const row of rows) {
      const job = rowToJob(row);
      run('UPDATE jobs SET saved = 1 WHERE id = ?', job.id);

      const application = run(
        `INSERT INTO applications (job_id, status, applied_at, created_at, updated_at, notes, next_action, next_action_at)
         VALUES (?, 'saved', NULL, ?, ?, ?, '', NULL)`,
        job.id,
        now,
        now,
        `Prepared from the ${minScore}+ review queue. Review the documents, open the application, and submit manually.`,
      );
      run(
        'INSERT INTO events (application_id, kind, body, created_at) VALUES (?, ?, ?, ?)',
        application.lastId,
        'created',
        `Prepared ${job.title} at ${job.company} for review (fit ${job.score})`,
        now,
      );

      const docs = tailorDocuments(profile, job, { maxBullets: 4 });
      const label = `${job.company || 'Company'} · ${job.title}`;
      run(
        'INSERT INTO docs (job_id, kind, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        job.id,
        'resume',
        `Resume — ${label}`,
        docs.resume,
        now,
        now,
      );
      run(
        'INSERT INTO docs (job_id, kind, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        job.id,
        'cover',
        `Cover letter — ${label}`,
        docs.cover,
        now,
        now,
      );
      run(
        'INSERT INTO events (application_id, kind, body, created_at) VALUES (?, ?, ?, ?)',
        application.lastId,
        'document',
        `Tailored resume and cover letter for ${job.title}`,
        now,
      );

      prepared.push({
        id: job.id,
        title: job.title,
        company: job.company,
        score: job.score,
        applyUrl: job.applyUrl || job.url,
        applicationId: application.lastId,
        docs: 2,
      });
    }

    res.status(201).json({
      prepared: prepared.length,
      minScore,
      jobs: prepared,
      note: 'Added as Saved with tailored documents. Nothing was submitted.',
    });
  }),
);

jobsRouter.patch(
  '/jobs/:id',
  wrap((req, res) => {
    const id = idParam(req.params.id);
    const existing = get<JobRow>('SELECT * FROM jobs WHERE id = ?', id);
    if (!existing) return fail(res, 404, 'Job not found');
    if (req.body?.saved !== undefined) {
      run('UPDATE jobs SET saved = ? WHERE id = ?', asBool(req.body.saved) ? 1 : 0, id);
    }
    if (req.body?.hidden !== undefined) {
      run('UPDATE jobs SET hidden = ? WHERE id = ?', asBool(req.body.hidden) ? 1 : 0, id);
    }
    const row = get<JobRow>(`${JOB_SELECT} WHERE j.id = ?`, id);
    res.json({ job: row ? rowToJob(row) : null });
  }),
);

jobsRouter.delete(
  '/jobs/:id',
  wrap((req, res) => {
    run('DELETE FROM jobs WHERE id = ?', idParam(req.params.id));
    res.json({ ok: true });
  }),
);

jobsRouter.post(
  '/jobs/import',
  wrap(async (req, res) => {
    const url = asString(req.body?.url, 2000).trim();
    if (!/^https?:\/\//i.test(url)) return fail(res, 400, 'Paste a full job URL starting with http:// or https://');
    const scraped = await scrapeJobUrl(url);
    const { inserted, updated } = ingestJobs([scraped]);
    if (!inserted && !updated) {
      return fail(res, 409, 'That job is already in your list (matched an existing company, title and location)');
    }
    const row = get<JobRow>(`${JOB_SELECT} WHERE j.source = ? AND j.source_id = ?`, scraped.source, scraped.sourceId);
    res.status(201).json({ job: row ? rowToJob(row) : null, warning: scraped.warning ?? null });
  }),
);

jobsRouter.post(
  '/jobs/manual',
  wrap((req, res) => {
    const title = asString(req.body?.title, 200).trim();
    if (!title) return fail(res, 400, 'A job title is required');
    const profile = getProfile();
    const job: NormalizedJob = {
      source: 'manual',
      sourceId: `manual-${randomUUID()}`,
      url: asString(req.body?.url, 2000).trim(),
      applyUrl: asString(req.body?.url, 2000).trim(),
      company: asString(req.body?.company, 200).trim() || 'Unknown company',
      title,
      location: asString(req.body?.location, 200).trim(),
      remote: asBool(req.body?.remote),
      salaryMin: asNumber(req.body?.salaryMin),
      salaryMax: asNumber(req.body?.salaryMax),
      salaryCurrency: asString(req.body?.salaryCurrency, 8).toUpperCase() || profile.salaryCurrency,
      description: asString(req.body?.description, 20_000).trim(),
      tags: [],
      postedAt: nowIso(),
    };
    ingestJobs([job]);
    const row = get<JobRow>(`${JOB_SELECT} WHERE j.source = ? AND j.source_id = ?`, job.source, job.sourceId);
    res.status(201).json({ job: row ? rowToJob(row) : null });
  }),
);

jobsRouter.post(
  '/jobs/:id/rescore',
  wrap((req, res) => {
    const id = idParam(req.params.id);
    const row = get<JobRow>('SELECT * FROM jobs WHERE id = ?', id);
    if (!row) return fail(res, 404, 'Job not found');
    const match = scoreJob(getProfile(), rowToJob(row));
    run('UPDATE jobs SET score = ?, reasons = ? WHERE id = ?', match.score, JSON.stringify(match.reasons), id);
    const fresh = get<JobRow>(`${JOB_SELECT} WHERE j.id = ?`, id);
    res.json({ job: fresh ? rowToJob(fresh) : null });
  }),
);
