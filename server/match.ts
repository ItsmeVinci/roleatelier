import type { Profile, Reason } from '../shared/types.ts';

const STOPWORDS = new Set(
  `a an the and or but if then than that this these those to of in on at by for with from as is are was were be been being
   you your we our they their he she it its i me my us them who whom which what when where why how all any both each few
   more most other some such no nor not only own same so too very can will just should now about into over after before
   between out up down off again further once here there also has have had do does did doing would could may might must
   role team work working experience years year job company candidate candidates applicant applicants please apply position
   positions responsibilities requirements required preferred plus benefits opportunity opportunities ideal strong ability
   able new using use used across within per etc via`
    .split(/\s+/)
    .filter(Boolean),
);

export interface JobLike {
  title: string;
  company: string;
  location: string;
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  description: string;
  tags: string[];
  postedAt: string | null;
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(' ')
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function termPresent(haystackTokens: Set<string>, term: string): boolean {
  const parts = normalize(term)
    .split(' ')
    .filter((t) => t.length > 0);
  if (parts.length === 0) return false;
  return parts.every((p) => haystackTokens.has(p));
}

export function uniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const t = raw.trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** The words that best describe a posting: explicit tags first, then the titles, then frequent description terms. */
export function jobKeywords(job: JobLike): string[] {
  const counts = new Map<string, number>();
  for (const t of tokenize(job.description)) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const titleTokens = tokenize(`${job.title} ${job.tags.join(' ')}`);

  for (const t of titleTokens) counts.set(t, (counts.get(t) ?? 0) + 6);
  for (const tag of job.tags) {
    const n = normalize(tag);
    if (n) counts.set(n, (counts.get(n) ?? 0) + 8);
    for (const t of tokenize(tag)) counts.set(t, (counts.get(t) ?? 0) + 4);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([t]) => t);
}

interface Seniority {
  label: string;
  years: number;
}

function detectSeniority(title: string, years: number): Seniority {
  const t = normalize(title);
  const has = (word: string) => new RegExp(`(^|\\s)${word}(\\s|$)`).test(t);
  if (has('intern') || has('internship')) return { label: 'internship', years: 0 };
  if (has('junior') || has('entry') || has('graduate') || has('trainee')) return { label: 'junior', years: 1 };
  if (has('principal') || has('distinguished')) return { label: 'principal', years: 12 };
  if (has('staff')) return { label: 'staff', years: 9 };
  if (has('director') || has('vp') || has('head') || has('chief') || has('cto')) return { label: 'leadership', years: 12 };
  if (has('manager')) return { label: 'management', years: 8 };
  if (has('senior') || has('sr')) return { label: 'senior', years: 6 };
  if (has('lead')) return { label: 'lead', years: 7 };
  if (has('mid') || has('intermediate')) return { label: 'mid-level', years: 3 };
  return { label: '', years: Math.max(3, Math.min(6, years + 1)) };
}

const MONTH = 30 * 24 * 60 * 60 * 1000;

function recencyScore(postedAt: string | null): number {
  if (!postedAt) return 3;
  const ts = Date.parse(postedAt);
  if (Number.isNaN(ts)) return 3;
  const days = (Date.now() - ts) / (24 * 60 * 60 * 1000);
  if (days < 0) return 6;
  if (days < 3) return 6;
  if (days < 10) return 5;
  if (days < 21) return 3;
  if (days < 45) return 2;
  return 1;
}

function money(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${Math.round(n)}`;
}

export interface MatchResult {
  score: number;
  reasons: Reason[];
  matchedSkills: string[];
  keywords: string[];
}

export function scoreJob(profile: Profile, job: JobLike): MatchResult {
  const text = normalize(`${job.title} ${job.company} ${job.location} ${job.tags.join(' ')} ${job.description}`);
  const tokens = new Set(text.split(' ').filter(Boolean));
  const reasons: Reason[] = [];

  // --- Skills: the strongest signal -------------------------------------
  const skills = uniqueTerms(profile.skills).filter((s) => s.length > 1);
  const matched = skills.filter((s) => termPresent(tokens, s));
  // A posting rarely lists every skill you have. Expect roughly half of them,
  // capped, so a typical strong match lands in the 70–90 band rather than the 50s.
  const denom = Math.max(4, Math.min(9, Math.round(skills.length * 0.55)));
  const skillScore = skills.length === 0 ? 18 : Math.min(1, matched.length / denom) * 50;
  if (skills.length === 0) {
    reasons.push({ kind: 'info', text: 'Add skills to your profile to unlock fit scoring' });
  } else if (matched.length > 0) {
    reasons.push({
      kind: 'match',
      text: `Covers ${matched.length}/${skills.length} of your skills — ${matched.slice(0, 5).join(', ')}`,
    });
  } else {
    reasons.push({ kind: 'gap', text: 'No overlap with the skills on your profile' });
  }

  // --- Title alignment ---------------------------------------------------
  const titleTokens = new Set(tokenize(job.title));
  let titleScore = 0;
  let bestTitle = '';
  for (const target of profile.targetTitles.length ? profile.targetTitles : [profile.headline]) {
    const tt = new Set(tokenize(target || ''));
    if (tt.size === 0) continue;
    let hit = 0;
    for (const t of tt) if (titleTokens.has(t)) hit++;
    const containment = hit / tt.size;
    if (containment > titleScore) {
      titleScore = containment;
      bestTitle = target;
    }
  }
  const titlePoints = titleScore * 22;
  if (titleScore >= 0.6 && bestTitle) {
    reasons.push({ kind: 'match', text: `Title aligns with your target: ${bestTitle}` });
  } else if (profile.targetTitles.length && titleScore < 0.25) {
    reasons.push({ kind: 'gap', text: `Title is outside your target roles (${profile.targetTitles.slice(0, 3).join(', ')})` });
  }

  // --- Seniority ---------------------------------------------------------
  const seniority = detectSeniority(job.title, profile.yearsExperience);
  const gap = Math.abs(seniority.years - profile.yearsExperience);
  const seniorityPoints = gap <= 1 ? 8 : gap <= 3 ? 7 : gap <= 5 ? 4 : gap <= 8 ? 2 : 0;
  if (seniority.label && gap > 5) {
    reasons.push({
      kind: 'gap',
      text: `${seniority.label} role is a stretch for ${profile.yearsExperience} years of experience`,
    });
  }

  // --- Pay ---------------------------------------------------------------
  let payPoints = 4;
  const floor = profile.salaryFloor;
  const jmin = job.salaryMin;
  const jmax = job.salaryMax;
  if (floor != null && floor > 0 && (jmin || jmax)) {
    const top = jmax ?? jmin ?? 0;
    const bottom = jmin ?? jmax ?? 0;
    if (top < floor) {
      payPoints = 0;
      reasons.push({ kind: 'gap', text: `Pay tops out near ${money(top)}, below your ${money(floor)} floor` });
    } else if (bottom >= floor) {
      payPoints = 6;
      reasons.push({ kind: 'match', text: `Pay (${money(bottom)}–${money(top)}) clears your floor` });
    } else {
      payPoints = 4;
      reasons.push({ kind: 'info', text: `Pay range ${money(bottom)}–${money(top)} straddles your floor` });
    }
  } else if (jmin || jmax) {
    payPoints = 5;
    reasons.push({ kind: 'info', text: `Listed pay ${money(jmin ?? jmax ?? 0)}–${money(jmax ?? jmin ?? 0)}` });
  }

  // --- Location / remote -------------------------------------------------
  let locationPoints = 4;
  const loc = normalize(job.location);
  const prefLoc = profile.preferredLocations.map(normalize).filter(Boolean);
  const matchesPref =
    !!loc && (prefLoc.some((p) => loc.includes(p) || p.includes(loc)) || loc.includes(normalize(profile.location)));
  if (job.remote && profile.remoteOk) {
    locationPoints = 8;
    reasons.push({ kind: 'match', text: 'Remote — matches your preference' });
  } else if (job.remote && !profile.remoteOk) {
    locationPoints = 2;
    reasons.push({ kind: 'gap', text: 'Remote role, but you prefer on-site' });
  } else if (matchesPref) {
    locationPoints = 8;
    reasons.push({ kind: 'match', text: `Location fits: ${job.location}` });
  } else if (loc) {
    locationPoints = 2;
    reasons.push({ kind: 'gap', text: `Location (${job.location}) is outside your preferred area` });
  }

  // --- Freshness ---------------------------------------------------------
  const freshPoints = recencyScore(job.postedAt);
  const days = job.postedAt ? Math.round((Date.now() - Date.parse(job.postedAt)) / (24 * 60 * 60 * 1000)) : null;
  if (days != null && days >= 0 && days < 10) {
    reasons.push({ kind: 'info', text: days <= 1 ? 'Posted today' : `Posted ${days} days ago` });
  }

  let score = skillScore + titlePoints + seniorityPoints + payPoints + locationPoints + freshPoints;

  // --- Hard filters ------------------------------------------------------
  const mustExclude = profile.mustExclude.map(normalize).filter(Boolean);
  const excluded = mustExclude.find((t) => text.includes(t));
  if (excluded) {
    score = Math.min(score, 12);
    reasons.unshift({ kind: 'gap', text: `Contains your excluded term “${excluded}”` });
  }
  const mustInclude = profile.mustInclude.map(normalize).filter(Boolean);
  if (mustInclude.length) {
    const missing = mustInclude.filter((t) => !text.includes(t));
    if (missing.length) {
      score *= 0.55;
      reasons.push({ kind: 'gap', text: `Missing required term(s): ${missing.join(', ')}` });
    }
  }

  const keywords = jobKeywords(job);
  const reasonsOut: Reason[] = [
    ...reasons.filter((r) => r.kind === 'match'),
    ...reasons.filter((r) => r.kind === 'gap'),
    ...reasons.filter((r) => r.kind === 'info'),
  ].slice(0, 6);

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons: reasonsOut,
    matchedSkills: matched,
    keywords,
  };
}

export function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / MONTH)}mo ago`;
}
