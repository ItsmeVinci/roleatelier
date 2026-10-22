import type { Job, Profile } from '../shared/types.ts';
import { scoreJob, termPresent, tokenize } from './match.ts';
import { clamp } from './text.ts';

const SECTION_PATTERNS: { re: RegExp; key: string; label: string }[] = [
  { re: /^(professional\s+)?summary$|^profile$|^objective$|^about( me)?$/i, key: 'summary', label: 'Summary' },
  {
    re: /^(work\s+|professional\s+|relevant\s+)?experience$|^employment(\s+history)?$|^work\s+history$/i,
    key: 'experience',
    label: 'Experience',
  },
  { re: /^(technical\s+|core\s+)?skills$|^technologies$|^tech\s+stack$/i, key: 'skills', label: 'Skills' },
  { re: /^projects?$/i, key: 'projects', label: 'Projects' },
  { re: /^education$|^education\s+and\s+training$/i, key: 'education', label: 'Education' },
  { re: /^certifications?$|^licenses?$/i, key: 'certifications', label: 'Certifications' },
  { re: /^awards?$|^honors?$/i, key: 'awards', label: 'Awards' },
  { re: /^publications?$/i, key: 'publications', label: 'Publications' },
  { re: /^languages?$/i, key: 'languages', label: 'Languages' },
  { re: /^volunteer(ing)?$/i, key: 'other', label: 'Volunteering' },
];

interface Section {
  key: string;
  title: string;
  lines: string[];
}

interface RoleGroup {
  header: string;
  bullets: string[];
}

const BULLET_RE = /^\s*(?:[-•*–—·▪◦]|\d{1,2}[.)])\s+/;

function isBullet(line: string): boolean {
  return BULLET_RE.test(line);
}

function cleanBullet(line: string): string {
  return line.replace(BULLET_RE, '').trim();
}

function detectHeading(line: string): { key: string; title: string } | null {
  const raw = line.trim().replace(/^#{1,6}\s*/, '').replace(/[*_]/g, '');
  const stripped = raw.replace(/[:.]+$/, '').trim();
  if (!stripped || stripped.length > 48) return null;
  if (/[.!?]$/.test(stripped)) return null;
  for (const p of SECTION_PATTERNS) {
    if (p.re.test(stripped)) return { key: p.key, title: p.label };
  }
  return null;
}

export function parseResume(resumeText: string): Section[] {
  const lines = (resumeText || '').replace(/\r\n?/g, '\n').split('\n');
  const sections: Section[] = [{ key: 'header', title: 'Header', lines: [] }];
  let current = sections[0];
  for (const line of lines) {
    const heading = detectHeading(line);
    if (heading) {
      current = { key: heading.key, title: heading.title, lines: [] };
      sections.push(current);
      continue;
    }
    current.lines.push(line.replace(/\s+$/, ''));
  }
  return sections.map((s) => ({ ...s, lines: trimBlank(s.lines) }));
}

function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end);
}

/** Group an experience/projects section into role headers + bullets. */
function roleGroups(lines: string[]): RoleGroup[] {
  const groups: RoleGroup[] = [];
  let current: RoleGroup = { header: '', bullets: [] };
  for (const line of lines) {
    if (!line.trim()) continue;
    if (isBullet(line)) {
      current.bullets.push(cleanBullet(line));
    } else {
      if (current.header || current.bullets.length) groups.push(current);
      current = { header: line.trim(), bullets: [] };
    }
  }
  if (current.header || current.bullets.length) groups.push(current);
  return groups.filter((g) => g.header || g.bullets.length);
}

function relevance(text: string, keywords: string[], matchedSkills: string[]): number {
  const toks = new Set(tokenize(text));
  let score = 0;
  keywords.forEach((k, i) => {
    if (termPresent(toks, k)) score += Math.max(1, 20 - i * 0.7);
  });
  for (const skill of matchedSkills) {
    if (termPresent(toks, skill)) score += 9;
  }
  const words = Math.max(5, text.split(/\s+/).filter(Boolean).length);
  // Long bullets look impressive but should not win purely on length.
  return score / Math.pow(words, 0.35);
}

function pickBullets(bullets: string[], keywords: string[], skills: string[], max: number): string[] {
  if (bullets.length <= 2) return bullets;
  const ranked = bullets
    .map((text, index) => ({ text, index, score: relevance(text, keywords, skills) }))
    .sort((a, b) => b.score - a.score);
  const keep = new Set(ranked.slice(0, Math.min(max, bullets.length)).map((r) => r.index));
  return bullets.filter((_, i) => keep.has(i));
}

export interface TailorResult {
  resume: string;
  cover: string;
  matchedSkills: string[];
  keywords: string[];
  warnings: string[];
}

function bulletsFromSections(sections: Section[], keys: string[]): string[] {
  const out: string[] = [];
  for (const s of sections) {
    if (!keys.includes(s.key)) continue;
    for (const line of s.lines) if (isBullet(line)) out.push(cleanBullet(line));
  }
  return out;
}

function sectionsAsMarkdown(sections: Section[], keys: string[]): string[] {
  return sections
    .filter((s) => keys.includes(s.key) && s.lines.some((l) => l.trim()))
    .map((s) => `## ${s.title}\n\n${s.lines.join('\n').trim()}`);
}

export function tailorDocuments(profile: Profile, job: Job, options: { maxBullets?: number } = {}): TailorResult {
  const match = scoreJob(profile, job);
  const keywords = match.keywords;
  const matchedSkills = match.matchedSkills;
  const maxBullets = Math.max(2, Math.min(8, options.maxBullets ?? 4));
  const warnings: string[] = [];

  const sections = parseResume(profile.resumeText);
  const experienceSections = sections.filter((s) => s.key === 'experience');
  const projectSections = sections.filter((s) => s.key === 'projects');
  const allRoles = [
    ...experienceSections.flatMap((s) => roleGroups(s.lines)),
    ...projectSections.flatMap((s) => roleGroups(s.lines)),
  ];

  const hasResume = profile.resumeText.trim().length > 0;
  if (!hasResume) {
    warnings.push('Your profile has no resume text yet. The draft uses profile fields only — add or import a resume for stronger tailoring.');
  }

  const summarySource = profile.summary.trim();
  const targetTitle = profile.targetTitles[0] || profile.headline || job.title;
  const skillLine = [...new Set([...matchedSkills, ...profile.skills])].filter(Boolean);

  const summaryBits: string[] = [];
  if (summarySource) summaryBits.push(clamp(summarySource.replace(/\s+/g, ' '), 320));
  else summaryBits.push(`${targetTitle || 'Professional'} with ${profile.yearsExperience} years of experience.`);
  if (matchedSkills.length) {
    summaryBits.push(
      `Direct overlap with this ${job.title} role at ${job.company}: ${matchedSkills.slice(0, 5).join(', ')}.`,
    );
  } else if (keywords.length) {
    summaryBits.push(`Focused on ${keywords.slice(0, 5).join(', ')}.`);
  }

  const heading = [`# ${profile.fullName || 'Your Name'}`, profile.headline ? `${profile.headline}` : '']
    .filter(Boolean)
    .join('\n');

  const contact = [
    profile.email,
    profile.phone,
    profile.location,
    profile.links.linkedin,
    profile.links.github,
    profile.links.website || profile.links.portfolio,
  ]
    .filter(Boolean)
    .join(' · ');

  const parts: string[] = [heading];
  if (contact) parts.push(contact);

  parts.push(`## Summary\n\n${summaryBits.join(' ')}`);
  if (skillLine.length) parts.push(`## Core skills\n\n${skillLine.join(' · ')}`);

  if (allRoles.length) {
    parts.push('## Experience');
    const roleLimit = 4;
    const chosen = allRoles.slice(0, roleLimit);
    for (const role of chosen) {
      const isProject = !experienceSections.some((s) => s.lines.includes(role.header));
      const header = role.header || (isProject ? 'Project' : 'Selected highlights');
      const bullets = pickBullets(role.bullets, keywords, matchedSkills, maxBullets);
      const block = [`### ${header}`, ...bullets.map((b) => `- ${b}`)].join('\n');
      parts.push(block);
    }
    if (allRoles.length > roleLimit) {
      parts.push(`_Earlier roles and full history available on request._`);
    }
  } else if (hasResume) {
    const fallback = bulletsFromSections(sections, ['experience', 'projects']);
    if (fallback.length) {
      parts.push(`## Experience\n\n${pickBullets(fallback, keywords, matchedSkills, 6).map((b) => `- ${b}`).join('\n')}`);
    }
  }

  const extra = sectionsAsMarkdown(sections, ['education', 'certifications', 'awards', 'publications', 'languages']);
  if (extra.length) parts.push(...extra);

  if (!allRoles.length && !hasResume) {
    parts.push(
      [
        '## Experience',
        '',
        '- **Role title — Company** (year–year)',
        '  - Replace this with an achievement: action, scope, measurable result.',
        '- **Role title — Company** (year–year)',
        '  - Replace this with an achievement that matches the posting.',
      ].join('\n'),
    );
    parts.push('## Education\n\n- Degree — Institution (year)');
  }

  const resume = parts.join('\n\n').replace(/\n{3,}/g, '\n\n');

  // ---- Cover letter -----------------------------------------------------
  const evidence: string[] = [];
  for (const role of allRoles) {
    for (const b of pickBullets(role.bullets, keywords, matchedSkills, 2)) {
      if (b.length > 40) evidence.push(b);
      if (evidence.length >= 3) break;
    }
    if (evidence.length >= 3) break;
  }

  const roleName = job.title;
  const company = job.company;
  const topSkills = (matchedSkills.length ? matchedSkills : profile.skills).slice(0, 3);
  const skillPhrase =
    topSkills.length >= 2
      ? `${topSkills.slice(0, -1).join(', ')} and ${topSkills[topSkills.length - 1]}`
      : topSkills[0] || targetTitle;

  const letter: string[] = [];
  letter.push(`Dear ${company} hiring team,`);
  letter.push(
    `I'm applying for the ${roleName} role. I'm a ${targetTitle.toLowerCase()} with ${profile.yearsExperience} years of experience, and my work centres on ${skillPhrase}.`,
  );
  if (profile.summary.trim()) letter.push(clamp(profile.summary.trim(), 420));
  if (evidence.length) {
    letter.push('A few results that map directly to this role:');
    for (const e of evidence) letter.push(`- ${e}`);
  }
  if (profile.location && job.remote) {
    letter.push(`I work remotely from ${profile.location} and am set up to collaborate across time zones.`);
  }
  letter.push(
    `I'd welcome the chance to talk about how I can help ${company} with ${keywords.slice(0, 3).join(', ') || roleName}. Thank you for your time.`,
  );
  letter.push(`Sincerely,\n${profile.fullName || 'Your Name'}`);
  const cover = letter.join('\n\n');

  return { resume, cover, matchedSkills, keywords, warnings };
}

export function aiPrompt(profile: Profile, job: Job, draft: { resume: string; cover: string }): string {
  return `You are helping me tailor a job application. Do not invent employers, dates, degrees or metrics.
Only rephrase and reorder facts that appear in my profile or resume.

# Target role
${job.title} at ${job.company}
Location: ${job.location}${job.remote ? ' (remote)' : ''}
Source: ${job.source} — ${job.applyUrl || job.url}

# Job description
${clamp(job.description, 9000)}

# My profile
Name: ${profile.fullName}
Headline: ${profile.headline}
Years of experience: ${profile.yearsExperience}
Location: ${profile.location}
Skills: ${profile.skills.join(', ')}
Work authorisation: ${profile.workAuth}
Summary: ${profile.summary}

# My resume (source of truth)
${clamp(profile.resumeText, 9000)}

# Current draft resume
${clone(draft.resume)}

# Current draft cover letter
${clone(draft.cover)}

# What I want
1. Rewrite the resume so the most relevant experience appears first, using only facts from my resume. Keep it ATS-friendly: no tables, no columns, plain headings.
2. Tighten the summary to 2–3 sentences that name the overlap with this specific role.
3. Rewrite the cover letter in a confident, specific, non-flowery voice. 200–280 words. Reference only what is in my resume. No generic filler like "I am passionate about".
4. Flag any requirement in the job description that my resume does not evidence, as a short "Gaps" list at the end.
Return the resume and cover letter as markdown.
`;
}

function clone(s: string): string {
  return s.replace(/\r/g, '');
}

/** Escape + minimal markdown (headings, bullets, bold, italics, hr). */
export function markdownToHtml(md: string): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      out.push('</ul>');
      listOpen = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      if (!listOpen) {
        out.push('<ul>');
        listOpen = true;
      }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      closeList();
      out.push('<hr />');
      continue;
    }
    closeList();
    out.push(`<p>${inline(line.trim())}</p>`);
  }
  closeList();
  return out.join('\n');
}

export function renderDocumentHtml(opts: {
  kind: 'resume' | 'cover';
  title: string;
  content: string;
  meta: string;
}): string {
  const body = markdownToHtml(opts.content);
  const isLetter = opts.kind === 'cover';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${opts.title.replace(/[<>&]/g, '')}</title>
<style>
  @page { size: A4; margin: 18mm 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font: 11.2pt/1.5 "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
    color: #14161a; max-width: 190mm; margin: 0 auto; padding: 16mm 10mm;
    ${isLetter ? '' : ''}
  }
  h1 { font-size: 22pt; margin: 0 0 2mm; letter-spacing: -0.4pt; }
  h1 + p { margin: 0 0 1mm; color: #444a55; font-size: 10.5pt; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 1.2pt; margin: 7mm 0 2mm;
       padding-bottom: 1mm; border-bottom: 0.6pt solid #cfd4dc; }
  h3 { font-size: 11pt; margin: 4mm 0 1mm; }
  p { margin: 0 0 2.4mm; }
  ul { margin: 0 0 3mm; padding-left: 5mm; }
  li { margin: 0 0 1.4mm; }
  code { font-family: "JetBrains Mono", monospace; font-size: 9.5pt; }
  hr { border: 0; border-top: 0.6pt solid #d8dce3; margin: 6mm 0; }
  .doc-meta { font-size: 8.5pt; color: #8a909b; margin-bottom: 6mm; }
  .letter p { margin: 0 0 3.4mm; }
  @media print { .doc-meta { display: none; } body { padding: 0; } }
</style>
</head>
<body class="${isLetter ? 'letter' : 'resume'}">
${opts.meta ? `<div class="doc-meta">${opts.meta.replace(/[<>&]/g, '')}</div>` : ''}
${body}
</body>
</html>`;
}
