import { Router } from 'express';
import multer from 'multer';
import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import {
  EMPTY_PROFILE,
  all,
  getProfile,
  nowIso,
  run,
  saveProfile,
  get,
} from '../db.ts';
import { rescoreAll } from '../sources.ts';
import type { Profile, SavedAnswer } from '../../shared/types.ts';
import { asNumber, asString, asStringArray, fail, wrap } from './util.ts';

export const profileRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

profileRouter.get(
  '/profile',
  wrap((_req, res) => {
    res.json({ profile: getProfile() });
  }),
);

profileRouter.put(
  '/profile',
  wrap((req, res) => {
    const body = req.body ?? {};
    const current = getProfile();
    const base: Profile = { ...EMPTY_PROFILE, ...current };

    const profile: Profile = {
      ...base,
      fullName: body.fullName !== undefined ? asString(body.fullName, 120) : base.fullName,
      email: body.email !== undefined ? asString(body.email, 160) : base.email,
      phone: body.phone !== undefined ? asString(body.phone, 60) : base.phone,
      location: body.location !== undefined ? asString(body.location, 160) : base.location,
      headline: body.headline !== undefined ? asString(body.headline, 200) : base.headline,
      summary: body.summary !== undefined ? asString(body.summary, 4000) : base.summary,
      skills: body.skills !== undefined ? asStringArray(body.skills, 80) : base.skills,
      targetTitles: body.targetTitles !== undefined ? asStringArray(body.targetTitles, 12) : base.targetTitles,
      yearsExperience:
        body.yearsExperience !== undefined ? Math.max(0, Math.min(60, asNumber(body.yearsExperience) ?? 0)) : base.yearsExperience,
      workAuth: body.workAuth !== undefined ? asString(body.workAuth, 300) : base.workAuth,
      workAuthStatus:
        body.workAuthStatus === 'authorized' || body.workAuthStatus === 'needs-sponsorship'
          ? body.workAuthStatus
          : body.workAuthStatus === ''
            ? ''
            : base.workAuthStatus,
      salaryFloor: body.salaryFloor !== undefined ? asNumber(body.salaryFloor) : base.salaryFloor,
      salaryCurrency: body.salaryCurrency !== undefined ? asString(body.salaryCurrency, 8).toUpperCase() : base.salaryCurrency,
      remoteOk: body.remoteOk !== undefined ? !!body.remoteOk : base.remoteOk,
      preferredLocations:
        body.preferredLocations !== undefined ? asStringArray(body.preferredLocations, 20) : base.preferredLocations,
      mustInclude: body.mustInclude !== undefined ? asStringArray(body.mustInclude, 20) : base.mustInclude,
      mustExclude: body.mustExclude !== undefined ? asStringArray(body.mustExclude, 20) : base.mustExclude,
      links: {
        linkedin: asString(body.links?.linkedin ?? base.links.linkedin, 300),
        github: asString(body.links?.github ?? base.links.github, 300),
        website: asString(body.links?.website ?? base.links.website, 300),
        portfolio: asString(body.links?.portfolio ?? base.links.portfolio, 300),
      },
      resumeText: body.resumeText !== undefined ? asString(body.resumeText, 60_000) : base.resumeText,
      resumeFile: body.resumeFile !== undefined ? asString(body.resumeFile, 300) : base.resumeFile,
      updatedAt: nowIso(),
    };

    const saved = saveProfile(profile);
    const rescored = rescoreAll();
    res.json({ profile: saved, rescored });
  }),
);

profileRouter.post(
  '/profile/resume',
  upload.single('resume'),
  wrap(async (req, res) => {
    const file = req.file;
    if (!file) return fail(res, 400, 'No file uploaded');
    const name = file.originalname || 'resume';
    const ext = name.toLowerCase().split('.').pop() ?? '';
    let text = '';

    if (ext === 'pdf' || file.mimetype === 'application/pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(file.buffer));
      const result = await extractText(pdf, { mergePages: true });
      text = Array.isArray(result.text) ? result.text.join('\n\n') : result.text;
    } else if (ext === 'docx' || file.mimetype.includes('wordprocessingml')) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = result.value;
    } else if (ext === 'txt' || ext === 'md' || ext === 'markdown' || file.mimetype.startsWith('text/')) {
      text = file.buffer.toString('utf8');
    } else if (ext === 'doc') {
      return fail(res, 400, 'Legacy .doc files are not supported. Save as PDF or .docx and try again.');
    } else {
      return fail(res, 400, `Unsupported file type “.${ext}”. Use PDF, DOCX, TXT or Markdown.`);
    }

    text = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 30) {
      return fail(res, 400, 'Could not read meaningful text from that file. Is it a scanned image PDF?');
    }

    const profile = getProfile();
    const saved = saveProfile({ ...profile, resumeText: text.slice(0, 60_000), resumeFile: name });
    res.json({ profile: saved, filename: name, characters: text.length });
  }),
);

profileRouter.get(
  '/answers',
  wrap((_req, res) => {
    const answers = all<SavedAnswer>('SELECT id, question, answer, category FROM answers ORDER BY category, id');
    res.json({ answers });
  }),
);

profileRouter.post(
  '/answers',
  wrap((req, res) => {
    const question = asString(req.body?.question, 500).trim();
    const answer = asString(req.body?.answer, 5000).trim();
    const category = asString(req.body?.category, 40).trim() || 'general';
    if (!question || !answer) return fail(res, 400, 'Both a question and an answer are required');
    const { lastId } = run(
      'INSERT INTO answers (question, answer, category, updated_at) VALUES (?, ?, ?, ?)',
      question,
      answer,
      category,
      nowIso(),
    );
    res.status(201).json({ answer: { id: lastId, question, answer, category } });
  }),
);

profileRouter.put(
  '/answers/:id',
  wrap((req, res) => {
    const id = Number(req.params.id);
    const existing = get<SavedAnswer>('SELECT id, question, answer, category FROM answers WHERE id = ?', id);
    if (!existing) return fail(res, 404, 'Answer not found');
    const question = asString(req.body?.question, 500) || existing.question;
    const answer = asString(req.body?.answer, 5000) || existing.answer;
    const category = asString(req.body?.category, 40) || existing.category;
    run(
      'UPDATE answers SET question = ?, answer = ?, category = ?, updated_at = ? WHERE id = ?',
      question,
      answer,
      category,
      nowIso(),
      id,
    );
    res.json({ answer: { id, question, answer, category } });
  }),
);

profileRouter.delete(
  '/answers/:id',
  wrap((req, res) => {
    run('DELETE FROM answers WHERE id = ?', Number(req.params.id));
    res.json({ ok: true });
  }),
);
