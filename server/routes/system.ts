import { Router } from 'express';
import { all, db, getProfile, getSetting, nowIso, run, saveProfile, setSetting } from '../db.ts';
import { configuredWorkdayBoards, rescoreAll } from '../sources.ts';
import type { Profile } from '../../shared/types.ts';
import { asString, fail, wrap } from './util.ts';

export const systemRouter = Router();

const SETTINGS_KEYS = new Set(['adzuna_app_id', 'adzuna_app_key', 'adzuna_country', 'default_pages', 'workday_boards']);

systemRouter.get(
  '/health',
  wrap((_req, res) => {
    res.json({ ok: true, time: nowIso() });
  }),
);systemRouter.get(
  '/settings',
  wrap((_req, res) => {
    const settings: Record<string, string> = {};
    for (const key of SETTINGS_KEYS) settings[key] = getSetting(key);
    settings.adzuna_country = settings.adzuna_country || 'us';
    settings.has_adzuna = String(!!(settings.adzuna_app_id && settings.adzuna_app_key));
    settings.has_workday = String(configuredWorkdayBoards().length > 0);
    settings.workday_boards = settings.workday_boards || '';
    res.json({ settings });
  }),
);

systemRouter.put(
  '/settings',
  wrap((req, res) => {
    for (const [key, value] of Object.entries(req.body ?? {})) {
      if (!SETTINGS_KEYS.has(key)) continue;
      setSetting(key, asString(value, key === 'workday_boards' ? 5000 : 300).trim());
    }
    const settings: Record<string, string> = {};
    for (const key of SETTINGS_KEYS) settings[key] = getSetting(key);
    settings.has_adzuna = String(!!(settings.adzuna_app_id && settings.adzuna_app_key));
    settings.has_workday = String(configuredWorkdayBoards().length > 0);
    res.json({ settings });
  }),
);

systemRouter.get(
  '/export',
  wrap((_req, res) => {
    const payload = {
      app: 'jobpilot',
      version: 1,
      exportedAt: nowIso(),
      profile: getProfile(),
      answers: all('SELECT * FROM answers ORDER BY id'),
      jobs: all('SELECT * FROM jobs ORDER BY id'),
      applications: all('SELECT * FROM applications ORDER BY id'),
      events: all('SELECT * FROM events ORDER BY id'),
      contacts: all('SELECT * FROM contacts ORDER BY id'),
      docs: all('SELECT * FROM docs ORDER BY id'),
    };
    res.setHeader('content-disposition', `attachment; filename="jobpilot-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.type('application/json').send(JSON.stringify(payload, null, 2));
  }),
);

systemRouter.post(
  '/import',
  wrap((req, res) => {
    const data = req.body;
    if (!data || data.app !== 'jobpilot') return fail(res, 400, 'That is not a JobPilot backup file');
    for (const key of ['jobs', 'applications', 'answers', 'events', 'contacts', 'docs']) {
      if (data[key] !== undefined && !Array.isArray(data[key])) return fail(res, 400, `Field “${key}” must be an array`);
    }

    const profileIn = data.profile as Partial<Profile> | undefined;
    db.exec('BEGIN');
    try {
      db.exec('DELETE FROM events; DELETE FROM contacts; DELETE FROM docs; DELETE FROM applications;');
      db.exec('DELETE FROM jobs; DELETE FROM answers; DELETE FROM profile;');

      if (profileIn && typeof profileIn === 'object') {
        saveProfile({ ...getProfile(), ...profileIn, updatedAt: nowIso() });
      }

      for (const a of data.answers ?? []) {
        run(
          'INSERT INTO answers (id, question, answer, category, updated_at) VALUES (?, ?, ?, ?, ?)',
          Number(a.id) || null,
          asString(a.question, 500),
          asString(a.answer, 5000),
          asString(a.category, 40) || 'general',
          asString(a.updated_at, 40) || nowIso(),
        );
      }

      for (const j of data.jobs ?? []) {
        run(
          `INSERT INTO jobs (id, source, source_id, url, apply_url, company, title, location, remote,
             salary_min, salary_max, salary_currency, description, tags, posted_at, fetched_at,
             canonical_key, saved, hidden, score, reasons)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          Number(j.id),
          asString(j.source, 20) || 'manual',
          asString(j.source_id, 200),
          asString(j.url, 2000),
          asString(j.apply_url, 2000),
          asString(j.company, 300),
          asString(j.title, 300),
          asString(j.location, 300),
          Number(j.remote) ? 1 : 0,
          j.salary_min == null ? null : Number(j.salary_min),
          j.salary_max == null ? null : Number(j.salary_max),
          asString(j.salary_currency, 8),
          asString(j.description, 60_000),
          asString(j.tags, 5000) || '[]',
          asString(j.posted_at, 40) || null,
          asString(j.fetched_at, 40) || nowIso(),
          asString(j.canonical_key, 500) || `imported|${j.id}`,
          Number(j.saved) ? 1 : 0,
          Number(j.hidden) ? 1 : 0,
          Number(j.score) || 0,
          asString(j.reasons, 5000) || '[]',
        );
      }

      for (const a of data.applications ?? []) {
        run(
          `INSERT INTO applications (id, job_id, status, applied_at, created_at, updated_at, notes, next_action, next_action_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          Number(a.id),
          a.job_id == null ? null : Number(a.job_id),
          asString(a.status, 20) || 'saved',
          asString(a.applied_at, 40) || null,
          asString(a.created_at, 40) || nowIso(),
          asString(a.updated_at, 40) || nowIso(),
          asString(a.notes, 20_000),
          asString(a.next_action, 500),
          asString(a.next_action_at, 40) || null,
        );
      }

      for (const e of data.events ?? []) {
        run(
          'INSERT INTO events (id, application_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)',
          Number(e.id),
          Number(e.application_id),
          asString(e.kind, 20) || 'note',
          asString(e.body, 5000),
          asString(e.created_at, 40) || nowIso(),
        );
      }

      for (const c of data.contacts ?? []) {
        run(
          'INSERT INTO contacts (id, application_id, name, role, email, notes) VALUES (?, ?, ?, ?, ?, ?)',
          Number(c.id),
          Number(c.application_id),
          asString(c.name, 200),
          asString(c.role, 200),
          asString(c.email, 200),
          asString(c.notes, 2000),
        );
      }

      for (const d of data.docs ?? []) {
        run(
          'INSERT INTO docs (id, job_id, kind, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          Number(d.id),
          d.job_id == null ? null : Number(d.job_id),
          asString(d.kind, 20) || 'resume',
          asString(d.title, 300),
          asString(d.content, 60_000),
          asString(d.created_at, 40) || nowIso(),
          asString(d.updated_at, 40) || nowIso(),
        );
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    rescoreAll();
    res.json({ ok: true, restored: true });
  }),
);

systemRouter.get(
  '/applications.csv',
  wrap((_req, res) => {    const rows = all<Record<string, unknown>>(`
      SELECT a.id, j.company, j.title, j.source, j.location, a.status, a.applied_at, a.updated_at,
             a.next_action, a.next_action_at, j.apply_url, a.notes
      FROM applications a LEFT JOIN jobs j ON j.id = a.job_id ORDER BY a.id
    `);
    const cols = [
      'id',
      'company',
      'title',
      'source',
      'location',
      'status',
      'applied_at',
      'updated_at',
      'next_action',
      'next_action_at',
      'apply_url',
      'notes',
    ];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
    res.setHeader('content-disposition', `attachment; filename="jobpilot-applications-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.type('text/csv').send(csv);
  }),
);
