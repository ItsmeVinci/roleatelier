import type { SourceId, SourceInfo } from '../shared/types.ts';
import {
  getProfile,
  getSetting,
  get,
  all,
  run,
  nowIso,
  rowToJob,
  type JobRow,
} from './db.ts';
import { scoreJob } from './match.ts';
import { htmlToText, parseSalary, clamp } from './text.ts';

export interface NormalizedJob {
  source: SourceId;
  sourceId: string;
  url: string;
  applyUrl: string;
  company: string;
  title: string;
  location: string;
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  description: string;
  tags: string[];
  postedAt: string | null;
}

export interface DiscoverOptions {
  pages?: number;
  limitPerSource?: number;
  query?: string;
  country?: string;
}

const UA = 'JobPilot/0.1 (+local job search tool; contact: local user)';

export const SOURCE_META: Omit<SourceInfo, 'count' | 'lastFetched'>[] = [
  {
    id: 'remoteok',
    name: 'Remote OK',
    homepage: 'https://remoteok.com',
    requiresKey: false,
    description: 'Public remote-job API. Broad tech and non-tech roles.',
  },
  {
    id: 'remotive',
    name: 'Remotive',
    homepage: 'https://remotive.com',
    requiresKey: false,
    description: 'Curated remote jobs, mostly product/engineering/support.',
  },
  {
    id: 'arbeitnow',
    name: 'Arbeitnow',
    homepage: 'https://www.arbeitnow.com',
    requiresKey: false,
    description: 'Europe-heavy board with a free public API (visa jobs included).',
  },
  {
    id: 'jobicy',
    name: 'Jobicy',
    homepage: 'https://jobicy.com',
    requiresKey: false,
    description: 'Remote and hybrid roles across industries.',
  },
  {
    id: 'hn',
    name: 'HN Who is hiring',
    homepage: 'https://news.ycombinator.com',
    requiresKey: false,
    description: 'Parses the monthly "Who is hiring?" thread. Great for startups.',
  },
  {
    id: 'adzuna',
    name: 'Adzuna',
    homepage: 'https://developer.adzuna.com',
    requiresKey: true,
    description: 'Large aggregator with a free developer key (app id + app key).',
  },
  {
    id: 'workday',
    name: 'Workday company boards',
    homepage: 'https://www.workday.com',
    requiresKey: false,
    requiresConfig: true,
    description: 'Read open roles directly from Workday career sites you add in Settings. No account needed.',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn Jobs',
    homepage: 'https://www.linkedin.com/jobs',
    requiresKey: false,
    searchOnly: true,
    description: 'Opens a targeted LinkedIn search. LinkedIn has no free public jobs API, so results are not imported automatically.',
  },
  {
    id: 'indeed',
    name: 'Indeed',
    homepage: 'https://www.indeed.com',
    requiresKey: false,
    searchOnly: true,
    description: 'Opens a targeted Indeed search. Indeed’s publisher API is partner-only; use Add by URL to import a posting.',
  },
  {
    id: 'glassdoor',
    name: 'Glassdoor',
    homepage: 'https://www.glassdoor.com',
    requiresKey: false,
    searchOnly: true,
    description: 'Opens a targeted Glassdoor search. Glassdoor’s API is partner-only; use Add by URL to import a posting.',
  },
  {
    id: 'manual',
    name: 'Manual / URL import',
    homepage: '',
    requiresKey: false,
    description: 'Paste any job URL; JobPilot reads the posting’s structured data.',
  },
];

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

async function fetchJsonPost(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'user-agent': UA,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface WorkdayBoard {
  label: string;
  baseUrl: string;
  host: string;
  tenant: string;
  site: string;
}

function prettifyWorkdaySite(site: string): string {
  return site
    .replace(/(External)?Career(Site)?/gi, ' ')
    .replace(/\b(careers?|jobs?|site|external)\b/gi, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Workday is per-employer, not a single global board. Users add one career-site
 * URL per line in Settings, optionally prefixed with "Company |" to label it.
 */
export function parseWorkdayBoards(raw: string): WorkdayBoard[] {
  const out: WorkdayBoard[] = [];
  const seen = new Set<string>();

  for (const original of raw.split(/\r?\n/)) {
    let line = original.trim();
    if (!line || line.startsWith('#')) continue;

    let label = '';
    const pipe = line.indexOf('|');
    if (pipe > 0) {
      label = line.slice(0, pipe).trim();
      line = line.slice(pipe + 1).trim();
    }
    if (!/^https?:\/\//i.test(line)) line = `https://${line}`;

    let url: URL;
    try {
      url = new URL(line);
    } catch {
      continue;
    }

    const hostMatch = url.hostname.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i);
    if (!hostMatch) continue;

    const site = url.pathname
      .split('/')
      .filter(Boolean)
      .find((segment) => !/^[a-z]{2}(-[a-z]{2})?$/i.test(segment));
    if (!site) continue;

    const key = `${url.hostname}/${site}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      label: label || prettifyWorkdaySite(site) || hostMatch[1],
      baseUrl: `https://${url.hostname}/${site}`,
      host: url.hostname,
      tenant: hostMatch[1],
      site,
    });
  }

  return out;
}

export function configuredWorkdayBoards(): WorkdayBoard[] {
  return parseWorkdayBoards(getSetting('workday_boards'));
}

function workdayPostedOn(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const now = Date.now();
  if (/today/i.test(text)) return new Date(now).toISOString();
  if (/yesterday/i.test(text)) return new Date(now - 86_400_000).toISOString();

  const days = text.match(/(\d+)\+?\s*days?\s*ago/i);
  if (days) return new Date(now - Number(days[1]) * 86_400_000).toISOString();
  const hours = text.match(/(\d+)\+?\s*hours?\s*ago/i);
  if (hours) return new Date(now - Number(hours[1]) * 3_600_000).toISOString();
  return null;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return fallback;
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function iso(v: unknown): string | null {
  if (typeof v === 'number' && v > 0) return new Date(v * 1000).toISOString();
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}
function tagsOf(v: unknown): string[] {
  return arr(v)
    .map((t) => str(t).trim())
    .filter(Boolean);
}
function annualise(n: number | null, period: string): number | null {
  if (n == null) return null;
  const p = period.toLowerCase();
  if (p.includes('hour') || p === 'hourly') return Math.round(n * 2080);
  if (p.includes('month')) return Math.round(n * 12);
  if (p.includes('day')) return Math.round(n * 240);
  return n;
}

async function fetchRemoteOk(opts: DiscoverOptions): Promise<NormalizedJob[]> {
  void opts;
  const data = arr(await fetchJson('https://remoteok.com/api'));
  return data
    .map(rec)
    .filter((j) => j.id && j.position)
    .map((j) => {
      const desc = htmlToText(str(j.description));
      return {
        source: 'remoteok' as const,
        sourceId: str(j.id) || str(j.slug),
        url: str(j.url),
        applyUrl: str(j.apply_url) || str(j.url),
        company: str(j.company),
        title: str(j.position),
        location: str(j.location) || 'Remote',
        remote: true,
        salaryMin: num(j.salary_min),
        salaryMax: num(j.salary_max),
        salaryCurrency: 'USD',
        description: desc,
        tags: tagsOf(j.tags),
        postedAt: iso(j.epoch) ?? iso(j.date),
      };
    });
}

async function fetchRemotive(opts: DiscoverOptions): Promise<NormalizedJob[]> {
  const limit = opts.limitPerSource ?? 100;
  const data = rec(await fetchJson(`https://remotive.com/api/remote-jobs?limit=${limit}`));
  return arr(data.jobs)
    .map(rec)
    .filter((j) => j.id && j.title)
    .map((j) => {
      const salary = parseSalary(str(j.salary));
      return {
        source: 'remotive' as const,
        sourceId: str(j.id),
        url: str(j.url),
        applyUrl: str(j.url),
        company: str(j.company_name),
        title: str(j.title),
        location: str(j.candidate_required_location) || 'Remote',
        remote: true,
        salaryMin: salary.min,
        salaryMax: salary.max,
        salaryCurrency: salary.currency || 'USD',
        description: htmlToText(str(j.description)),
        tags: [...tagsOf(j.tags), str(j.category), str(j.job_type)].filter(Boolean),
        postedAt: iso(j.publication_date),
      };
    });
}

async function fetchArbeitnow(opts: DiscoverOptions): Promise<NormalizedJob[]> {
  const pages = Math.max(1, Math.min(3, opts.pages ?? 2));
  const out: NormalizedJob[] = [];
  for (let page = 1; page <= pages; page++) {
    const data = rec(await fetchJson(`https://www.arbeitnow.com/api/job-board-api?page=${page}`));
    const items = arr(data.data);
    for (const item of items) {
      const j = rec(item);
      if (!j.title) continue;
      const salary = parseSalary(str(j.salary));
      out.push({
        source: 'arbeitnow',
        sourceId: str(j.slug) || str(j.url),
        url: str(j.url),
        applyUrl: str(j.url),
        company: str(j.company_name),
        title: str(j.title),
        location: str(j.location) || (j.remote ? 'Remote' : ''),
        remote: j.remote === true || /remote/i.test(str(j.location)),
        salaryMin: salary.min,
        salaryMax: salary.max,
        salaryCurrency: salary.currency || 'EUR',
        description: htmlToText(str(j.description)),
        tags: [...tagsOf(j.tags), ...tagsOf(j.job_types)].filter(Boolean),
        postedAt: iso(j.created_at),
      });
    }
    if (!items.length) break;
  }
  return out;
}

async function fetchJobicy(opts: DiscoverOptions): Promise<NormalizedJob[]> {
  const count = Math.min(50, opts.limitPerSource ?? 50);
  const data = rec(await fetchJson(`https://jobicy.com/api/v2/remote-jobs?count=${count}`));
  return arr(data.jobs)
    .map(rec)
    .filter((j) => j.id && j.jobTitle)
    .map((j) => {
      const period = str(j.salaryPeriod, 'yearly');
      return {
        source: 'jobicy' as const,
        sourceId: str(j.id),
        url: str(j.url),
        applyUrl: str(j.url),
        company: str(j.companyName),
        title: str(j.jobTitle),
        location: str(j.jobGeo) || 'Remote',
        remote: true,
        salaryMin: annualise(num(j.salaryMin), period),
        salaryMax: annualise(num(j.salaryMax), period),
        salaryCurrency: str(j.salaryCurrency) || 'USD',
        description: htmlToText(str(j.jobDescription)),
        tags: [...tagsOf(j.jobIndustry), ...tagsOf(j.jobType), str(j.jobLevel)].filter(Boolean),
        postedAt: iso(j.pubDate),
      };
    });
}

const HN_ROLE_WORDS =
  /\b(engineer|engineering|developer|designer|manager|director|scientist|analyst|architect|lead|head|writer|editor|researcher|recruiter|marketer|marketing|sales|support|operations|ops|product|devops|sre|security|accountant|consultant|intern|founder|cto|ceo|vp|systems|infrastructure|platform|backend|frontend|full[\s-]?stack|data)\b/i;
const HN_NON_ROLE = /^(remote|on-?site|hybrid|full[\s-]?time|part[\s-]?time|contract|internship|visa|equity|\$|€|£|\d)/i;

function hnCompany(segment: string): string {
  return segment
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\([^)]*(remote|on-?site|hybrid|yc|series|https?|w\d\d)[^)]*\)/gi, ' ')
    .replace(/\s+(is\s+)?hiring.*$/i, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s|—–\-]+|[\s|—–(]+$/g, '')
    .trim();
}

function hnTitle(segs: string[], text: string, company: string): string {
  const candidates = segs.filter((s) => s && s !== company && !HN_NON_ROLE.test(s));
  const hit = candidates.find((s) => HN_ROLE_WORDS.test(s));
  if (hit) return clamp(hit.replace(/\s+/g, ' ').trim(), 120);

  const m = text
    .slice(0, 600)
    .replace(/\s+/g, ' ')
    .match(/\b(?:hiring|looking for|seeking)\s+(?:an?\s+|a\s+)?([^.|—–]{3,90})/i);
  if (m && HN_ROLE_WORDS.test(m[1])) return clamp(m[1].trim(), 120);
  return 'Multiple roles';
}

async function fetchHn(opts: DiscoverOptions): Promise<NormalizedJob[]> {
  const max = Math.min(300, opts.limitPerSource ?? 120);
  const search = rec(
    await fetchJson(
      'https://hn.algolia.com/api/v1/search_by_date?query=%22who%20is%20hiring%22&tags=story&hitsPerPage=30',
    ),
  );
  const stories = arr(search.hits)
    .map(rec)
    .filter((h) => /who is hiring\?/i.test(str(h.title)) && !/^show hn/i.test(str(h.title)));
  if (!stories.length) return [];
  stories.sort((a, b) => (num(b.created_at_i) ?? 0) - (num(a.created_at_i) ?? 0));
  const story = stories[0];
  const root = rec(await fetchJson(`https://hn.algolia.com/api/v1/items/${str(story.objectID)}`));
  const out: NormalizedJob[] = [];

  for (const child of arr(root.children).map(rec)) {
    if (out.length >= max) break;
    const text = htmlToText(str(child.text));
    if (text.length < 60) continue;
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const first = clamp(lines[0] ?? '', 240);
    const segs = first
      .split(/\s*\|\s*|\s+[—–]\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const company = segs.length ? hnCompany(segs[0]) : hnCompany(first.split(/[,—–]/)[0]);
    const title = hnTitle(segs, text, company);
    const placeSegments = segs.slice(1).filter((s) => s !== title && s.length <= 90);
    const location =
      placeSegments.find(
        (s) =>
          !HN_ROLE_WORDS.test(s) &&
          /,|usa|u\.s|europe|canada|uk|london|berlin|york|francisco|germany|netherlands|amsterdam|worldwide/i.test(
            s,
          ),
      ) ??
      placeSegments.find((s) => /remote|on-?site|hybrid/i.test(s)) ??
      '';
    const remote = /remote|anywhere|distributed/i.test(`${first} ${text.slice(0, 400)}`);
    out.push({
      source: 'hn',
      sourceId: `hn-${str(child.id)}`,
      url: `https://news.ycombinator.com/item?id=${str(child.id)}`,
      applyUrl: `https://news.ycombinator.com/item?id=${str(child.id)}`,
      company: company || 'HN post',
      title,
      location: location || (remote ? 'Remote' : ''),
      remote,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: '',
      description: clamp(text, 8000),
      tags: ['hackernews', 'startup'],
      postedAt: iso(child.created_at),
    });
  }
  return out;
}

async function fetchAdzuna(opts: DiscoverOptions): Promise<NormalizedJob[]> {
  const appId = getSetting('adzuna_app_id');
  const appKey = getSetting('adzuna_app_key');
  if (!appId || !appKey) throw new Error('Add your Adzuna app id and app key in Settings first');
  const country = (opts.country || getSetting('adzuna_country', 'us')).toLowerCase();
  const profile = getProfile();
  const what = opts.query || profile.targetTitles[0] || profile.headline;
  const pages = Math.max(1, Math.min(3, opts.pages ?? 1));
  const out: NormalizedJob[] = [];
  for (let page = 1; page <= pages; page++) {
    const q = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: '50',
      'content-type': 'application/json',
    });
    if (what) q.set('what', what);
    const data = rec(await fetchJson(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${q}`));
    for (const item of arr(data.results)) {
      const j = rec(item);
      out.push({
        source: 'adzuna',
        sourceId: str(j.id),
        url: str(j.redirect_url),
        applyUrl: str(j.redirect_url),
        company: str(rec(j.company).display_name),
        title: str(j.title),
        location: str(rec(j.location).display_name),
        remote: /remote/i.test(str(j.title) + str(rec(j.location).display_name)),
        salaryMin: num(j.salary_min),
        salaryMax: num(j.salary_max),
        salaryCurrency: 'USD',
        description: htmlToText(str(j.description)),
        tags: [str(j.category && rec(j.category).label), str(j.contract_time), str(j.contract_type)].filter(Boolean),
        postedAt: iso(j.created),
      });
    }
  }
  return out;
}

async function fetchWorkday(opts: DiscoverOptions): Promise<NormalizedJob[]> {
  const boards = configuredWorkdayBoards();
  if (!boards.length) {
    throw new Error('Add at least one Workday career-site URL in Settings first (for example nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite)');
  }

  const profile = getProfile();
  const query = (opts.query || profile.targetTitles[0] || profile.headline || '').trim();
  const limit = Math.min(20, Math.max(1, opts.limitPerSource ?? 20));
  const pages = Math.max(1, Math.min(3, opts.pages ?? 1));
  const out: NormalizedJob[] = [];
  const errors: string[] = [];

  for (const board of boards) {
    try {
      for (let page = 1; page <= pages; page++) {
        const endpoint = `https://${board.host}/wday/cxs/${encodeURIComponent(board.tenant)}/${encodeURIComponent(board.site)}/jobs`;
        const data = rec(
          await fetchJsonPost(endpoint, {
            appliedFacets: {},
            limit,
            offset: (page - 1) * limit,
            searchText: query,
          }),
        );
        const posts = arr(data.jobPostings).map(rec);
        if (!posts.length) break;

        const details = await mapLimit(posts, 4, async (post) => {
          const externalPath = str(post.externalPath);
          if (!externalPath) return null;
          try {
            const detailEndpoint = `https://${board.host}/wday/cxs/${encodeURIComponent(board.tenant)}/${encodeURIComponent(board.site)}${externalPath}`;
            return rec(await fetchJson(detailEndpoint));
          } catch {
            return null;
          }
        });

        posts.forEach((post, index) => {
          const info = rec(rec(details[index]).jobPostingInfo);
          const title = str(info.title) || str(post.title);
          if (!title) return;

          const externalPath = str(post.externalPath);
          const sourceId =
            str(info.jobPostingId) ||
            str(arr(post.bulletFields)[0]) ||
            externalPath.split('/').filter(Boolean).pop() ||
            '';
          if (!sourceId) return;

          const description = htmlToText(str(info.jobDescription));
          const salary = parseSalary(description);
          const location = str(info.location) || str(post.locationsText);
          const remote = /remote|anywhere|work from home/i.test(
            `${title} ${location} ${description.slice(0, 700)}`,
          );
          const applyUrl = str(info.externalUrl) || `https://${board.host}/${board.site}${externalPath}`;

          out.push({
            source: 'workday',
            sourceId: `workday-${board.tenant}-${board.site}-${sourceId}`,
            url: applyUrl,
            applyUrl,
            company: board.label,
            title,
            location: location || (remote ? 'Remote' : ''),
            remote,
            salaryMin: salary.min,
            salaryMax: salary.max,
            salaryCurrency: salary.currency || profile.salaryCurrency,
            description,
            tags: ['workday', board.label, str(info.timeType)].filter(Boolean),
            postedAt: iso(info.startDate) ?? workdayPostedOn(str(post.postedOn)),
          });
        });

        if (posts.length < limit) break;
      }
    } catch (err) {
      errors.push(`${board.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!out.length && errors.length) throw new Error(errors.join(' · '));
  return out;
}

export async function fetchSource(id: SourceId, opts: DiscoverOptions = {}): Promise<NormalizedJob[]> {
  switch (id) {
    case 'remoteok':
      return fetchRemoteOk(opts);
    case 'remotive':
      return fetchRemotive(opts);
    case 'arbeitnow':
      return fetchArbeitnow(opts);
    case 'jobicy':
      return fetchJobicy(opts);
    case 'hn':
      return fetchHn(opts);
    case 'adzuna':
      return fetchAdzuna(opts);
    case 'workday':
      return fetchWorkday(opts);
    default:
      return [];
  }
}

const COMPANY_SUFFIX = /\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|plc|ag|bv|s\.a|sa|oy|ab)\b\.?/g;

export function canonicalKey(j: NormalizedJob): string {
  const company = j.company
    .toLowerCase()
    .replace(COMPANY_SUFFIX, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const title = j.title
    .toLowerCase()
    .replace(/\(?(remote|hybrid|on-?site)\)?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const location = j.location
    .toLowerCase()
    .split(',')[0]
    .replace(/remote|anywhere|worldwide/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${company}|${title}|${location || 'any'}`;
}

export function ingestJobs(jobs: NormalizedJob[]): { inserted: number; updated: number } {
  const profile = getProfile();
  let inserted = 0;
  let updated = 0;
  const seen = new Set<string>();

  for (const j of jobs) {
    if (!j.title || !j.sourceId) continue;
    const dedupe = `${j.source}:${j.sourceId}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const match = scoreJob(profile, j);
    const existing = get<{ id: number }>(
      'SELECT id FROM jobs WHERE source = ? AND source_id = ?',
      j.source,
      j.sourceId,
    );

    if (existing) {
      run(
        `UPDATE jobs SET url = ?, apply_url = ?, company = ?, title = ?, location = ?, remote = ?,
           salary_min = ?, salary_max = ?, salary_currency = ?, description = ?, tags = ?,
           posted_at = ?, fetched_at = ?, score = ?, reasons = ?
         WHERE id = ?`,
        j.url,
        j.applyUrl,
        j.company,
        j.title,
        j.location,
        j.remote ? 1 : 0,
        j.salaryMin,
        j.salaryMax,
        j.salaryCurrency,
        j.description,
        JSON.stringify(j.tags),
        j.postedAt,
        nowIso(),
        match.score,
        JSON.stringify(match.reasons),
        existing.id,
      );
      updated++;
      continue;
    }

    const res = run(
      `INSERT OR IGNORE INTO jobs
        (source, source_id, url, apply_url, company, title, location, remote, salary_min, salary_max,
         salary_currency, description, tags, posted_at, fetched_at, canonical_key, saved, hidden, score, reasons)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      j.source,
      j.sourceId,
      j.url,
      j.applyUrl,
      j.company,
      j.title,
      j.location,
      j.remote ? 1 : 0,
      j.salaryMin,
      j.salaryMax,
      j.salaryCurrency,
      j.description,
      JSON.stringify(j.tags),
      j.postedAt,
      nowIso(),
      canonicalKey(j),
      match.score,
      JSON.stringify(match.reasons),
    );
    if (res.changes > 0) inserted++;
  }

  return { inserted, updated };
}

export function rescoreAll(): number {
  const profile = getProfile();
  const rows = all<JobRow>('SELECT * FROM jobs');
  for (const row of rows) {
    const match = scoreJob(profile, rowToJob(row));
    run('UPDATE jobs SET score = ?, reasons = ? WHERE id = ?', match.score, JSON.stringify(match.reasons), row.id);
  }
  return rows.length;
}
