import { createHash } from 'node:crypto';
import { htmlToText, decodeEntities, parseSalary, clamp } from './text.ts';
import type { NormalizedJob } from './sources.ts';

interface LdJob {
  [key: string]: unknown;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}
function obj(v: unknown): LdJob {
  return v && typeof v === 'object' ? (v as LdJob) : {};
}
function text(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object') {
    const o = obj(v);
    if (typeof o.name === 'string') return o.name;
    if (typeof o['@value'] === 'string') return o['@value'] as string;
  }
  return '';
}

function looksLikeJobPosting(node: LdJob): boolean {
  const t = node['@type'];
  const types = asArray(t).map((x) => String(x));
  return types.some((x) => x.toLowerCase() === 'jobposting');
}

function collectJobPostings(node: unknown, depth = 0): LdJob[] {
  if (depth > 8 || !node) return [];
  if (Array.isArray(node)) return node.flatMap((n) => collectJobPostings(n, depth + 1));
  if (typeof node !== 'object') return [];
  const o = obj(node);
  const found: LdJob[] = [];
  if (looksLikeJobPosting(o)) found.push(o);
  for (const key of ['@graph', 'itemListElement', 'mainEntity', 'item']) {
    if (o[key]) found.push(...collectJobPostings(o[key], depth + 1));
  }
  return found;
}

function locationText(loc: unknown): string {
  const parts: string[] = [];
  for (const l of asArray(loc)) {
    const o = obj(l);
    const address = obj(o.address);
    const bits = [
      text(address.addressLocality),
      text(address.addressRegion),
      text(address.addressCountry),
    ].filter(Boolean);
    if (bits.length) parts.push([...new Set(bits)].join(', '));
    else if (text(o.name)) parts.push(text(o.name));
  }
  return [...new Set(parts)].join(' · ');
}

function salaryFromLd(v: unknown): { min: number | null; max: number | null; currency: string } {
  const o = obj(v);
  const value = obj(o.value);
  const min = typeof value.minValue === 'number' ? value.minValue : Number(value.minValue) || null;
  const max = typeof value.maxValue === 'number' ? value.maxValue : Number(value.maxValue) || null;
  const unit = String(value.unitText ?? '').toUpperCase();
  const mult = unit.includes('HOUR') ? 2080 : unit.includes('MONTH') ? 12 : unit.includes('DAY') ? 240 : 1;
  return {
    min: min == null ? null : Math.round(min * mult),
    max: max == null ? null : Math.round(max * mult),
    currency: text(o.currency) || 'USD',
  };
}

export interface ScrapedJob extends NormalizedJob {
  warning?: string;
}

export async function scrapeJobUrl(input: string): Promise<ScrapedJob> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('That does not look like a valid URL');
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) URLs are supported');

  const res = await fetch(url.href, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 JobPilot/0.1',
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'en',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`The page returned HTTP ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  if (!/html|xml|text/i.test(ct)) throw new Error(`Unsupported content type: ${ct}`);
  const html = (await res.text()).slice(0, 2_000_000);
  const finalUrl = res.url || url.href;

  const blocks: LdJob[] = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      blocks.push(...collectJobPostings(JSON.parse(m[1].trim())));
    } catch {
      // Ignore malformed JSON-LD blocks; plenty of sites ship one broken block.
    }
  }

  const ld = blocks[0];
  const host = url.hostname.replace(/^www\./, '');
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const ogTitle = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];
  const ogDesc = /<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];

  const sourceId = createHash('sha1').update(finalUrl).digest('hex').slice(0, 16);
  const ldSalary = ld ? salaryFromLd(ld.baseSalary) : { min: null, max: null, currency: '' };
  const salaryText = parseSalary(
    [ld?.baseSalary, ld?.estimatedSalary].map((s) => JSON.stringify(s ?? '')).join(' '),
  );
  const loc = ld ? locationText(ld.jobLocation) : '';
  const locationType = ld ? text(ld.jobLocationType) : '';

  const job: ScrapedJob = {
    source: 'manual',
    sourceId: `manual-${sourceId}`,
    url: finalUrl,
    applyUrl: finalUrl,
    company: ld ? text(ld.hiringOrganization) || host : host,
    title: clamp(
      (ld ? text(ld.title) : '') || decodeEntities(ogTitle || titleTag || '').split(/[|–—]\s*/)[0] || 'Untitled role',
      140,
    ),
    location: loc || (locationType ? 'Remote' : ''),
    remote: /TELECOMMUTE|remote/i.test(locationType) || /remote/i.test(loc),
    salaryMin: ldSalary.min ?? salaryText.min,
    salaryMax: ldSalary.max ?? salaryText.max,
    salaryCurrency: ldSalary.currency || salaryText.currency,
    description: htmlToText(ld ? text(ld.description) : ogDesc || ''),
    tags: ld
      ? asArray(ld.employmentType)
          .map((t) => String(t))
          .filter(Boolean)
      : [],
    postedAt: ld && text(ld.datePosted) ? new Date(text(ld.datePosted)).toISOString() : null,
  };

  if (!ld) {
    job.warning =
      'No structured job data (JSON-LD) found on that page. Title and description were read from meta tags, so check the details.';
  }
  if (job.description.length < 40) {
    job.description = [
      job.description,
      `Imported from ${host}. JobPilot could not read the description from this page — open the posting for the full text.`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }
  return job;
}
