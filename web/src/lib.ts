import type { AppStatus, SourceId } from '@shared/types';

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function fmtSalary(min: number | null, max: number | null, currency: string): string {
  if (!min && !max) return '';
  const sym = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  if (min && max && min !== max) return `${sym}${k(min)}–${sym}${k(max)}`;
  return `${sym}${k((min ?? max) as number)}`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function dateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysFromToday(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export const SOURCE_LABEL: Record<string, string> = {
  remoteok: 'Remote OK',
  remotive: 'Remotive',
  arbeitnow: 'Arbeitnow',
  jobicy: 'Jobicy',
  hn: 'HN',
  adzuna: 'Adzuna',
  workday: 'Workday',
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  glassdoor: 'Glassdoor',
  manual: 'Manual',
};

export function sourceLabel(source: SourceId | string): string {
  return SOURCE_LABEL[source] ?? source;
}

export const STATUS_META: Record<AppStatus, { label: string; tone: string; hint: string }> = {
  saved: { label: 'Saved', tone: 'slate', hint: 'Shortlisted, not submitted yet' },
  applied: { label: 'Applied', tone: 'blue', hint: 'Submitted, waiting to hear back' },
  screening: { label: 'Screening', tone: 'violet', hint: 'Recruiter screen or take-home' },
  interview: { label: 'Interview', tone: 'amber', hint: 'In the interview loop' },
  offer: { label: 'Offer', tone: 'green', hint: 'Offer received' },
  rejected: { label: 'Rejected', tone: 'red', hint: 'Closed — not moving forward' },
  withdrawn: { label: 'Withdrawn', tone: 'zinc', hint: 'You stepped away' },
};

export function scoreTone(score: number): 'high' | 'mid' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 45) return 'mid';
  return 'low';
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

export function jobMoney(job: { salaryMin: number | null; salaryMax: number | null; salaryCurrency: string }): string {
  return fmtSalary(job.salaryMin, job.salaryMax, job.salaryCurrency);
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
