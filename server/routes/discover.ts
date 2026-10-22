import { Router } from 'express';
import { SOURCE_META, configuredWorkdayBoards, fetchSource, ingestJobs, rescoreAll } from '../sources.ts';
import { all, get, getProfile, getSetting } from '../db.ts';
import type { DiscoverResult, SearchLink, SourceId, SourceInfo } from '../../shared/types.ts';
import { asNumber, asString, fail, wrap } from './util.ts';

export const discoverRouter = Router();

const VALID = new Set(SOURCE_META.filter((s) => !s.searchOnly && s.id !== 'manual').map((s) => s.id));

discoverRouter.get(
  '/sources',
  wrap((_req, res) => {
    const counts = new Map<string, number>();
    for (const row of all<{ source: string; n: number }>('SELECT source, COUNT(*) AS n FROM jobs GROUP BY source')) {
      counts.set(row.source, Number(row.n));
    }
    const last = new Map<string, string>();
    for (const row of all<{ source: string; last: string }>(
      'SELECT source, MAX(fetched_at) AS last FROM jobs GROUP BY source',
    )) {
      last.set(row.source, row.last);
    }
    const hasAdzuna = !!(getSetting('adzuna_app_id') && getSetting('adzuna_app_key'));
    const hasWorkday = configuredWorkdayBoards().length > 0;
    const sources: SourceInfo[] = SOURCE_META.map((s) => ({
      ...s,
      count: counts.get(s.id) ?? 0,
      lastFetched: last.get(s.id) ?? null,
      configured:
        s.searchOnly || s.id === 'manual'
          ? false
          : s.id === 'workday'
            ? hasWorkday
            : s.id === 'adzuna'
              ? hasAdzuna
              : true,
    }));
    res.json({ sources });
  }),
);

discoverRouter.post(
  '/rescore',
  wrap((_req, res) => {
    res.json({ rescored: rescoreAll() });
  }),
);

discoverRouter.get(
  '/search-links',
  wrap((req, res) => {
    const profile = getProfile();
    const query =
      asString(req.query.q, 160).trim() ||
      profile.targetTitles[0] ||
      profile.headline ||
      'software engineer';
    const location =
      asString(req.query.location, 160).trim() ||
      profile.location ||
      profile.preferredLocations[0] ||
      '';

    const q = encodeURIComponent(query);
    const l = encodeURIComponent(location);
    const links: SearchLink[] = [
      {
        id: 'linkedin',
        name: 'LinkedIn Jobs',
        url: `https://www.linkedin.com/jobs/search/?keywords=${q}${location ? `&location=${l}` : ''}&f_TPR=r604800&sortBy=DD`,
        note: 'Recent roles, sorted by date. Open and apply in your own session.',
        searchOnly: true,
      },
      {
        id: 'indeed',
        name: 'Indeed',
        url: `https://www.indeed.com/jobs?q=${q}${location ? `&l=${l}` : ''}&fromage=7&sort=date`,
        note: 'Past-week results. Use Add by URL to import a posting.',
        searchOnly: true,
      },
      {
        id: 'glassdoor',
        name: 'Glassdoor',
        url: `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${q}${location ? `&locKeyword=${l}` : ''}`,
        note: 'Search plus company reviews. Use Add by URL to import a posting.',
        searchOnly: true,
      },
    ];

    for (const board of configuredWorkdayBoards()) {
      links.push({
        id: `workday-${board.tenant}-${board.site}`,
        name: `Workday · ${board.label}`,
        url: `${board.baseUrl}?q=${q}`,
        note: 'Open this employer’s Workday search, or sync it from Settings.',
        searchOnly: true,
      });
    }

    res.json({ query, location, links });
  }),
);

discoverRouter.post(
  '/discover',
  wrap(async (req, res) => {
    const raw = Array.isArray(req.body?.sources) ? req.body.sources : [];
    const ids = raw
      .filter((s: unknown): s is SourceId => typeof s === 'string' && VALID.has(s as SourceId) && s !== 'manual')
      .slice(0, 10);
    if (!ids.length) return fail(res, 400, 'Pick at least one source to refresh');

    const pages = Math.max(1, Math.min(3, asNumber(req.body?.pages) ?? 2));
    const limitPerSource = Math.max(10, Math.min(300, asNumber(req.body?.limitPerSource) ?? 100));
    const query = asString(req.body?.query, 200).trim() || undefined;
    const country = asString(req.body?.country, 4).trim() || undefined;

    const results: DiscoverResult[] = await Promise.all(
      ids.map(async (id: SourceId): Promise<DiscoverResult> => {
        const started = Date.now();
        const meta = SOURCE_META.find((s) => s.id === id);
        try {
          const jobs = await fetchSource(id, { pages, limitPerSource, query, country });
          const { inserted, updated } = ingestJobs(jobs);
          return {
            source: id,
            name: meta?.name ?? id,
            fetched: jobs.length,
            inserted,
            updated,
            error: null,
            ms: Date.now() - started,
          };
        } catch (err) {
          return {
            source: id,
            name: meta?.name ?? id,
            fetched: 0,
            inserted: 0,
            updated: 0,
            error: err instanceof Error ? err.message : String(err),
            ms: Date.now() - started,
          };
        }
      }),
    );

    res.json({ results, total: get<{ n: number }>('SELECT COUNT(*) AS n FROM jobs')?.n ?? 0 });
  }),
);
