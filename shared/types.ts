export type SourceId =
  | 'remoteok'
  | 'remotive'
  | 'arbeitnow'
  | 'jobicy'
  | 'hn'
  | 'adzuna'
  | 'workday'
  | 'linkedin'
  | 'indeed'
  | 'glassdoor'
  | 'manual';

export type AppStatus =
  | 'saved'
  | 'applied'
  | 'screening'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn';

export interface Profile {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  summary: string;
  skills: string[];
  targetTitles: string[];
  yearsExperience: number;
  workAuth: string;
  workAuthStatus: 'authorized' | 'needs-sponsorship' | '';
  salaryFloor: number | null;
  salaryCurrency: string;
  remoteOk: boolean;
  preferredLocations: string[];
  mustInclude: string[];
  mustExclude: string[];
  links: { linkedin: string; github: string; website: string; portfolio: string };
  resumeText: string;
  resumeFile: string;
  updatedAt: string;
}

export interface Reason {
  kind: 'match' | 'gap' | 'info';
  text: string;
}

export interface Job {
  id: number;
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
  fetchedAt: string;
  saved: boolean;
  hidden: boolean;
  score: number;
  reasons: Reason[];
  applicationId: number | null;
  applicationStatus: AppStatus | null;
}

export interface JobQuery {
  query?: string;
  source?: string;
  remote?: boolean;
  minScore?: number;
  saved?: boolean;
  includeHidden?: boolean;
  sort?: 'score' | 'newest' | 'salary' | 'company';
  limit?: number;
  offset?: number;
}

export interface AppEvent {
  id: number;
  applicationId: number;
  kind: 'status' | 'note' | 'document' | 'contact' | 'created';
  body: string;
  createdAt: string;
}

export interface Contact {
  id: number;
  applicationId: number;
  name: string;
  role: string;
  email: string;
  notes: string;
}

export interface Application {
  id: number;
  jobId: number | null;
  status: AppStatus;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
  notes: string;
  nextAction: string;
  nextActionAt: string | null;
  job: Job | null;
  events: AppEvent[];
  contacts: Contact[];
  docs: DocMeta[];
}

export interface DocMeta {
  id: number;
  jobId: number | null;
  kind: 'resume' | 'cover';
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Doc extends DocMeta {
  content: string;
}

export interface SavedAnswer {
  id: number;
  question: string;
  answer: string;
  category: string;
}

export interface SourceInfo {
  id: SourceId;
  name: string;
  homepage: string;
  requiresKey: boolean;
  requiresConfig?: boolean;
  searchOnly?: boolean;
  configured?: boolean;
  description: string;
  count: number;
  lastFetched: string | null;
}

export interface SearchLink {
  id: string;
  name: string;
  url: string;
  note: string;
  searchOnly: boolean;
}

export interface QueueJob {
  id: number;
  title: string;
  company: string;
  score: number;
  applyUrl: string;
  applicationId: number | null;
  docs: number;
}

export interface Stats {
  jobs: number;
  saved: number;
  byStatus: Record<AppStatus, number>;
  totalApplications: number;
  responseRate: number;
  interviewRate: number;
  offers: number;
  thisWeek: number;
  bySource: { source: string; applied: number; responded: number }[];
  dueActions: { applicationId: number; company: string; title: string; nextAction: string; nextActionAt: string }[];
}

export interface DiscoverResult {
  source: SourceId;
  name: string;
  fetched: number;
  inserted: number;
  updated: number;
  error: string | null;
  ms: number;
}

export const STATUSES: { id: AppStatus; label: string; tone: string }[] = [
  { id: 'saved', label: 'Saved', tone: 'slate' },
  { id: 'applied', label: 'Applied', tone: 'blue' },
  { id: 'screening', label: 'Screening', tone: 'violet' },
  { id: 'interview', label: 'Interview', tone: 'amber' },
  { id: 'offer', label: 'Offer', tone: 'green' },
  { id: 'rejected', label: 'Rejected', tone: 'red' },
  { id: 'withdrawn', label: 'Withdrawn', tone: 'zinc' },
];
