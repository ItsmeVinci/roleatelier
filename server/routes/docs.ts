import { Router } from 'express';
import { all, get, getProfile, nowIso, run, rowToJob, type JobRow } from '../db.ts';
import { aiPrompt, renderDocumentHtml, tailorDocuments } from '../tailor.ts';
import { buildBookmarklet, buildPayload } from '../autofill.ts';
import type { Doc } from '../../shared/types.ts';
import { asNumber, asString, fail, wrap } from './util.ts';

export const docsRouter = Router();

interface DocRow {
  id: number;
  job_id: number | null;
  kind: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

function docId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid document id');
  return id;
}

function toDoc(r: DocRow): Doc {
  return {
    id: Number(r.id),
    jobId: r.job_id == null ? null : Number(r.job_id),
    kind: r.kind as Doc['kind'],
    title: r.title,
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function jobForDoc(jobId: number | null) {
  if (!jobId) return null;
  const row = get<JobRow>('SELECT * FROM jobs WHERE id = ?', jobId);
  return row ? rowToJob(row) : null;
}

docsRouter.post(
  '/jobs/:id/tailor',
  wrap((req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid job id');
    const row = get<JobRow>('SELECT * FROM jobs WHERE id = ?', id);
    if (!row) return fail(res, 404, 'Job not found');
    const job = rowToJob(row);
    const profile = getProfile();
    const maxBullets = asNumber(req.body?.maxBullets) ?? 4;
    const result = tailorDocuments(profile, job, { maxBullets: Math.round(maxBullets) });
    const now = nowIso();
    const label = `${job.company || 'Company'} · ${job.title}`;

    const resumeIns = run(
      'INSERT INTO docs (job_id, kind, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      'resume',
      `Resume — ${label}`,
      result.resume,
      now,
      now,
    );
    const coverIns = run(
      'INSERT INTO docs (job_id, kind, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      'cover',
      `Cover letter — ${label}`,
      result.cover,
      now,
      now,
    );
    run(
      "INSERT INTO events (application_id, kind, body, created_at) SELECT id, 'document', ?, ? FROM applications WHERE job_id = ?",
      `Tailored resume and cover letter for ${job.title}`,
      now,
      id,
    );

    const resume = get<DocRow>('SELECT * FROM docs WHERE id = ?', resumeIns.lastId);
    const cover = get<DocRow>('SELECT * FROM docs WHERE id = ?', coverIns.lastId);
    res.status(201).json({
      resume: resume ? toDoc(resume) : null,
      cover: cover ? toDoc(cover) : null,
      warnings: result.warnings,
      matchedSkills: result.matchedSkills,
    });
  }),
);

docsRouter.get(
  '/docs',
  wrap((req, res) => {
    const jobId = asNumber(req.query.jobId);
    const rows = all<DocRow>(
      jobId
        ? 'SELECT * FROM docs WHERE job_id = ? ORDER BY id DESC'
        : 'SELECT * FROM docs ORDER BY id DESC LIMIT 100',
      ...(jobId ? [jobId] : []),
    );
    res.json({
      docs: rows.map((r) => ({
        id: Number(r.id),
        jobId: r.job_id == null ? null : Number(r.job_id),
        kind: r.kind,
        title: r.title,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  }),
);

docsRouter.get(
  '/docs/:id',
  wrap((req, res) => {
    const row = get<DocRow>('SELECT * FROM docs WHERE id = ?', docId(req.params.id));
    if (!row) return fail(res, 404, 'Document not found');
    res.json({ doc: toDoc(row) });
  }),
);

docsRouter.put(
  '/docs/:id',
  wrap((req, res) => {
    const id = docId(req.params.id);
    const row = get<DocRow>('SELECT * FROM docs WHERE id = ?', id);
    if (!row) return fail(res, 404, 'Document not found');
    run(
      'UPDATE docs SET content = ?, title = ?, updated_at = ? WHERE id = ?',
      asString(req.body?.content, 60_000) || row.content,
      asString(req.body?.title, 300) || row.title,
      nowIso(),
      id,
    );
    const fresh = get<DocRow>('SELECT * FROM docs WHERE id = ?', id);
    res.json({ doc: fresh ? toDoc(fresh) : null });
  }),
);

docsRouter.delete(
  '/docs/:id',
  wrap((req, res) => {
    run('DELETE FROM docs WHERE id = ?', docId(req.params.id));
    res.json({ ok: true });
  }),
);

docsRouter.get(
  '/docs/:id/render',
  wrap((req, res) => {
    const row = get<DocRow>('SELECT * FROM docs WHERE id = ?', docId(req.params.id));
    if (!row) return fail(res, 404, 'Document not found');
    const job = jobForDoc(row.job_id);
    const html = renderDocumentHtml({
      kind: row.kind === 'cover' ? 'cover' : 'resume',
      title: row.title,
      content: row.content,
      meta: job ? `Tailored for ${job.title} at ${job.company} · ${job.applyUrl || job.url}` : '',
    });
    res.type('html').send(html);
  }),
);

docsRouter.get(
  '/docs/:id/download',
  wrap((req, res) => {
    const row = get<DocRow>('SELECT * FROM docs WHERE id = ?', docId(req.params.id));
    if (!row) return fail(res, 404, 'Document not found');
    const format = asString(req.query.format, 10) || 'md';
    const safe = row.title.replace(/[^a-zA-Z0-9 _.-]/g, '').replace(/\s+/g, '-').slice(0, 80);
    if (format === 'html' || format === 'pdf') {
      const job = jobForDoc(row.job_id);
      const html = renderDocumentHtml({
        kind: row.kind === 'cover' ? 'cover' : 'resume',
        title: row.title,
        content: row.content,
        meta: job ? `Tailored for ${job.title} at ${job.company}` : '',
      });
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="${safe}.html"`);
      return res.send(html);
    }
    res.setHeader('content-type', 'text/markdown; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${safe}.md"`);
    res.send(row.content);
  }),
);

docsRouter.get(
  '/docs/:id/prompt',
  wrap((req, res) => {
    const row = get<DocRow>('SELECT * FROM docs WHERE id = ?', docId(req.params.id));
    if (!row) return fail(res, 404, 'Document not found');
    const job = jobForDoc(row.job_id);
    if (!job) return fail(res, 400, 'This document is not linked to a job');
    const resume = get<DocRow>("SELECT * FROM docs WHERE job_id = ? AND kind = 'resume' ORDER BY id DESC LIMIT 1", job.id);
    const prompt = aiPrompt(getProfile(), job, {
      resume: resume?.content ?? row.content,
      cover: row.kind === 'cover' ? row.content : '',
    });
    res.type('text/plain').send(prompt);
  }),
);

docsRouter.get(
  '/autofill/payload',
  wrap((req, res) => {
    const jobId = asNumber(req.query.jobId);
    res.json(buildPayload(jobId ?? undefined));
  }),
);

docsRouter.get(
  '/autofill/bookmarklet',
  wrap((req, res) => {
    const jobId = asNumber(req.query.jobId);
    res.type('text/plain').send(buildBookmarklet(jobId ?? undefined));
  }),
);
