import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Job, Profile, SourceId } from '../shared/types.ts';

export const ROOT = process.env.ROLEATELIER_ROOT
  ? path.resolve(process.env.ROLEATELIER_ROOT)
  : path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DATA_DIR = process.env.ROLEATELIER_DATA
  ? path.resolve(process.env.ROLEATELIER_DATA)
  : path.join(ROOT, 'data');

mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'roleatelier.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '[]',
  target_titles TEXT NOT NULL DEFAULT '[]',
  years_experience REAL NOT NULL DEFAULT 0,
  work_auth TEXT NOT NULL DEFAULT '',
  work_auth_status TEXT NOT NULL DEFAULT '',
  salary_floor REAL,
  salary_currency TEXT NOT NULL DEFAULT 'USD',
  remote_ok INTEGER NOT NULL DEFAULT 1,
  preferred_locations TEXT NOT NULL DEFAULT '[]',
  must_include TEXT NOT NULL DEFAULT '[]',
  must_exclude TEXT NOT NULL DEFAULT '[]',
  links TEXT NOT NULL DEFAULT '{}',
  resume_text TEXT NOT NULL DEFAULT '',
  resume_file TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  apply_url TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  remote INTEGER NOT NULL DEFAULT 0,
  salary_min REAL,
  salary_max REAL,
  salary_currency TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  posted_at TEXT,
  fetched_at TEXT NOT NULL,
  canonical_key TEXT NOT NULL DEFAULT '',
  saved INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  reasons TEXT NOT NULL DEFAULT '[]',
  UNIQUE(source, source_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_canonical_idx ON jobs(canonical_key);
CREATE INDEX IF NOT EXISTS jobs_score_idx ON jobs(score DESC);
CREATE INDEX IF NOT EXISTS jobs_source_idx ON jobs(source);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'saved',
  applied_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  next_action_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'note',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'resume',
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL DEFAULT '',
  answer TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS apps_job_idx ON applications(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_app_idx ON events(application_id, id);
CREATE INDEX IF NOT EXISTS contacts_app_idx ON contacts(application_id);
CREATE INDEX IF NOT EXISTS docs_job_idx ON docs(job_id, kind);
`);

export const nowIso = (): string => new Date().toISOString();
export const bool = (v: unknown): number => (v ? 1 : 0);

export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined;
}

export function run(sql: string, ...params: unknown[]): { changes: number; lastId: number } {
  const r = db.prepare(sql).run(...(params as never[]));
  return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
}

export function jsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export interface ProfileRow {
  full_name: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  summary: string;
  skills: string;
  target_titles: string;
  years_experience: number;
  work_auth: string;
  work_auth_status: string;
  salary_floor: number | null;
  salary_currency: string;
  remote_ok: number;
  preferred_locations: string;
  must_include: string;
  must_exclude: string;
  links: string;
  resume_text: string;
  resume_file: string;
  updated_at: string;
}

export const EMPTY_PROFILE: Profile = {
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

export function getProfile(): Profile {
  const row = get<ProfileRow>('SELECT * FROM profile WHERE id = 1');
  if (!row) return { ...EMPTY_PROFILE };
  return {
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    location: row.location,
    headline: row.headline,
    summary: row.summary,
    skills: jsonParse<string[]>(row.skills, []),
    targetTitles: jsonParse<string[]>(row.target_titles, []),
    yearsExperience: Number(row.years_experience) || 0,
    workAuth: row.work_auth,
    workAuthStatus: (row.work_auth_status as Profile['workAuthStatus']) || '',
    salaryFloor: row.salary_floor == null ? null : Number(row.salary_floor),
    salaryCurrency: row.salary_currency || 'USD',
    remoteOk: !!row.remote_ok,
    preferredLocations: jsonParse<string[]>(row.preferred_locations, []),
    mustInclude: jsonParse<string[]>(row.must_include, []),
    mustExclude: jsonParse<string[]>(row.must_exclude, []),
    links: jsonParse(row.links, { linkedin: '', github: '', website: '', portfolio: '' }),
    resumeText: row.resume_text,
    resumeFile: row.resume_file,
    updatedAt: row.updated_at,
  };
}

export function saveProfile(p: Profile): Profile {
  run(
    `INSERT INTO profile (id, full_name, email, phone, location, headline, summary, skills,
       target_titles, years_experience, work_auth, work_auth_status, salary_floor, salary_currency, remote_ok,
       preferred_locations, must_include, must_exclude, links, resume_text, resume_file, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       full_name = excluded.full_name, email = excluded.email, phone = excluded.phone,
       location = excluded.location, headline = excluded.headline, summary = excluded.summary,
       skills = excluded.skills, target_titles = excluded.target_titles,
       years_experience = excluded.years_experience, work_auth = excluded.work_auth,
       work_auth_status = excluded.work_auth_status,
       salary_floor = excluded.salary_floor, salary_currency = excluded.salary_currency,
       remote_ok = excluded.remote_ok, preferred_locations = excluded.preferred_locations,
       must_include = excluded.must_include, must_exclude = excluded.must_exclude,
       links = excluded.links, resume_text = excluded.resume_text,
       resume_file = excluded.resume_file, updated_at = excluded.updated_at`,
    p.fullName,
    p.email,
    p.phone,
    p.location,
    p.headline,
    p.summary,
    JSON.stringify(p.skills),
    JSON.stringify(p.targetTitles),
    p.yearsExperience,
    p.workAuth,
    p.workAuthStatus,
    p.salaryFloor,
    p.salaryCurrency,
    bool(p.remoteOk),
    JSON.stringify(p.preferredLocations),
    JSON.stringify(p.mustInclude),
    JSON.stringify(p.mustExclude),
    JSON.stringify(p.links),
    p.resumeText,
    p.resumeFile,
    nowIso(),
  );
  return getProfile();
}

export function getSetting(key: string, fallback = ''): string {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

export function getSettingJson<T>(key: string, fallback: T): T {
  return jsonParse<T>(getSetting(key, ''), fallback);
}

export interface JobRow {
  id: number;
  source: SourceId;
  source_id: string;
  url: string;
  apply_url: string;
  company: string;
  title: string;
  location: string;
  remote: number;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  description: string;
  tags: string;
  posted_at: string | null;
  fetched_at: string;
  saved: number;
  hidden: number;
  score: number;
  reasons: string;
  application_id?: number | null;
  application_status?: string | null;
}

export function rowToJob(r: JobRow): Job {
  return {
    id: Number(r.id),
    source: r.source,
    sourceId: r.source_id,
    url: r.url,
    applyUrl: r.apply_url,
    company: r.company,
    title: r.title,
    location: r.location,
    remote: !!r.remote,
    salaryMin: r.salary_min == null ? null : Number(r.salary_min),
    salaryMax: r.salary_max == null ? null : Number(r.salary_max),
    salaryCurrency: r.salary_currency || '',
    description: r.description,
    tags: jsonParse<string[]>(r.tags, []),
    postedAt: r.posted_at,
    fetchedAt: r.fetched_at,
    saved: !!r.saved,
    hidden: !!r.hidden,
    score: Number(r.score) || 0,
    reasons: jsonParse(r.reasons, []),
    applicationId: r.application_id == null ? null : Number(r.application_id),
    applicationStatus: (r.application_status as Job['applicationStatus']) ?? null,
  };
}

export const JOB_SELECT = `
  SELECT j.*, a.id AS application_id, a.status AS application_status
  FROM jobs j
  LEFT JOIN applications a ON a.job_id = j.id
`;
