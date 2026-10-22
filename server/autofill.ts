import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, getProfile, jsonParse } from './db.ts';
import type { SavedAnswer } from '../shared/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export interface AutofillPayload {
  v: 1;
  profile: {
    fullName: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    location: string;
    headline: string;
    summary: string;
    linkedin: string;
    github: string;
    website: string;
    years: string;
    salary: string;
    workAuth: string;
    authorized: string;
    sponsor: string;
    skills: string[];
  };
  answers: { question: string; answer: string }[];
  coverLetter: string;
  job: { id: number; title: string; company: string } | null;
}

export function buildPayload(jobId?: number): AutofillPayload {
  const p = getProfile();
  const nameParts = p.fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? '';
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

  const answers = all<{ question: string; answer: string }>(
    "SELECT question, answer FROM answers ORDER BY (category = 'eeo') ASC, id ASC",
  ).filter((a) => a.question.trim() && a.answer.trim());

  let coverLetter = '';
  let job: AutofillPayload['job'] = null;
  if (jobId) {
    const row = get<{ content: string }>(
      'SELECT content FROM docs WHERE job_id = ? AND kind = ? ORDER BY id DESC LIMIT 1',
      jobId,
      'cover',
    );
    coverLetter = row?.content ?? '';
    const j = get<{ id: number; title: string; company: string }>(
      'SELECT id, title, company FROM jobs WHERE id = ?',
      jobId,
    );
    if (j) job = { id: Number(j.id), title: j.title, company: j.company };
  } else {
    const row = get<{ content: string }>('SELECT content FROM docs WHERE kind = ? ORDER BY id DESC LIMIT 1', 'cover');
    coverLetter = row?.content ?? '';
  }

  const salary = p.salaryFloor == null ? '' : String(p.salaryFloor);

  return {
    v: 1,
    profile: {
      fullName: p.fullName,
      firstName,
      lastName,
      email: p.email,
      phone: p.phone,
      location: p.location,
      headline: p.headline,
      summary: p.summary,
      linkedin: p.links.linkedin,
      github: p.links.github,
      website: p.links.website || p.links.portfolio,
      years: String(p.yearsExperience),
      salary,
      workAuth: p.workAuth,
      authorized: p.workAuthStatus === 'authorized' ? 'Yes' : p.workAuthStatus === 'needs-sponsorship' ? 'No' : '',
      sponsor: p.workAuthStatus === 'needs-sponsorship' ? 'Yes' : p.workAuthStatus === 'authorized' ? 'No' : '',
      skills: p.skills,
    },
    answers,
    coverLetter,
    job,
  };
}

export function buildBookmarklet(jobId?: number): string {
  const payload = buildPayload(jobId);
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const source = readFileSync(path.join(HERE, 'autofill.client.js'), 'utf8');
  if (!source.includes("'__PAYLOAD__'")) throw new Error('autofill client template is missing the payload slot');
  const code = source.replace("'__PAYLOAD__'", `'${b64}'`);
  const encoded = encodeURIComponent(code).replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `javascript:${encoded}`;
}

export function answersForExport(): SavedAnswer[] {
  return all<AnswerRow>('SELECT id, question, answer, category FROM answers ORDER BY id').map((a) => ({
    id: Number(a.id),
    question: a.question,
    answer: a.answer,
    category: a.category,
  }));
}

interface AnswerRow {
  id: number;
  question: string;
  answer: string;
  category: string;
}

export function parseAnswersJson(raw: string): { question: string; answer: string; category?: string }[] {
  const parsed = jsonParse<{ question: string; answer: string; category?: string }[]>(raw, []);
  return parsed.filter((a) => typeof a.question === 'string' && typeof a.answer === 'string');
}
