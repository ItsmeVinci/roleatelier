# RoleAtelier

A local-first job search cockpit: aggregate listings, score them against your profile, tailor a resume and cover letter, autofill application forms, and track every application from first click to offer.

Everything runs on your machine. There is no account, no cloud sync, and no auto-apply bot. **You review and submit every application yourself.**

## Why no auto-submit

Most job boards and applicant tracking systems prohibit automated submissions. Bots also produce low-quality applications that get accounts and domains banned. RoleAtelier fills what it can, leaves file uploads and custom widgets for you, and stops before Submit.

## Features

- **Job aggregation** from five free public sources, Workday company boards, and manual URL import:
  - Remote OK
  - Remotive
  - Arbeitnow
  - Jobicy
  - Hacker News "Who is hiring?" (latest monthly thread)
  - Adzuna (optional, requires a free developer app id and key)
  - Workday company career sites you add in Settings
  - Manual import of any posting URL with JSON-LD structured data
- **Targeted board search** for LinkedIn, Indeed, Glassdoor and your saved Workday boards. These sites do not offer free public job APIs, so RoleAtelier opens a prefilled search in your browser instead of scraping them.
- **75+ prep queue** that adds up to ten unstarted 75+ matches to your pipeline as Saved, generates a tailored resume and cover letter for each, and leaves every Submit button to you.
- **Explainable fit score** from skills, title, seniority, salary, location and freshness. Every score shows its reasons, not just a number.
- **Resume tailoring**: parses your resume into sections and bullets, ranks bullets by relevance to the job, and generates a focused version without inventing experience.
- **Cover letter generation**: uses the job description, your resume summary and matched skills. Every document is editable before you use it.
- **AI refinement prompt**: copy a ready-made prompt into any assistant if you want a second pass, then paste the result back.
- **Bookmarklet autofill** for Greenhouse, Lever, Ashby, SmartRecruiters, Workday and most in-house forms. Matches labels, names, ids, aria attributes and saved answers. Never fills file inputs and never submits.
- **Application pipeline**: kanban stages, notes, contacts, next-action dates and a timestamped event timeline.
- **Export/backup**: JSON backup, CSV pipeline export, Markdown/HTML documents.

## Requirements

- Node.js 22.12 or newer for development/building (Node 24 recommended; the app uses the built-in `node:sqlite` module)
- npm
- A modern browser for the web app and the autofill bookmarklet
- Windows 10/11 (x64), macOS 12+ (x64 or Apple silicon), or a modern x64 Linux distribution for the prebuilt desktop app
- The prebuilt desktop app does not require Node.js

## Quick start

### Desktop app downloads

Release builds are published on [GitHub Releases](https://github.com/ItsmeVinci/roleatelier/releases):

- Windows x64: `RoleAtelier-0.1.0-x64.exe` installer and `RoleAtelier-0.1.0-portable.exe`.
- macOS x64/arm64: `RoleAtelier-0.1.0-x64.dmg`, `RoleAtelier-0.1.0-arm64.dmg`, and matching `.zip` builds.
- Linux x64: `RoleAtelier-0.1.0-*.AppImage` and `RoleAtelier-0.1.0-*.deb`.

macOS: open the `.dmg` and drag RoleAtelier into Applications. Linux: `chmod +x RoleAtelier-*.AppImage` and run it, or install the `.deb` with `sudo apt install ./RoleAtelier-*.deb`.

The desktop app opens its own window and starts a private local server on a random `127.0.0.1` port. Application links open in your default browser so the autofill bookmarklet keeps working.

Desktop data is stored in the platform app-data directory:

- Windows: `%APPDATA%\RoleAtelier\data`
- macOS: `~/Library/Application Support/RoleAtelier/data`
- Linux: `~/.config/RoleAtelier/data`

Use **File → Open data folder** or **File → Open log file** inside the app.

To build the desktop app yourself:

```bash
cd roleatelier
npm install
npm run desktop     # build and launch unpackaged
npm run dist        # Windows installer + portable exe
npm run dist:mac    # macOS dmg + zip (run on macOS)
npm run dist:linux  # Linux AppImage + deb (run on Linux)
```

Linux `.deb` builds need `fpm` (`sudo gem install fpm`); the AppImage target does not.

If the Electron runtime was not downloaded during `npm install`, run:

```bash
node node_modules/electron/install.js
```

The generated installers are unsigned. Windows SmartScreen may ask you to confirm the first launch. On macOS, right-click the app and choose **Open** the first time. Code-sign Windows and notarize macOS builds with your own certificates before distributing widely.

### Browser version

```bash
cd roleatelier
npm install
npm run app
```

`npm run app` builds the frontend and starts the web version at <http://127.0.0.1:8787>. It opens the browser automatically.

For development with hot reload:

```bash
npm run dev
```

The Vite dev server runs on <http://127.0.0.1:5173> and proxies `/api` to the backend on port 8787.

## First-run checklist

1. Open **Profile** and fill in your name, email, phone, location, headline, skills, target titles and salary floor.
2. Paste your resume text, or upload a PDF/DOCX. Plain text gives the best tailoring results.
3. Add a few **saved answers** for recurring questions (work authorization, sponsorship, "Why this company?", EEO questions).
4. Open **Jobs** and click **Fetch new** or **Sync sources**.
5. Optionally click **Prep 75+ queue** to prepare the top ten unstarted 75+ matches with tailored documents.
6. Open a promising role, review the score reasons, and click **Tailor resume** / **Tailor cover letter**.
7. Move the role to **Saved** or **Applied** and set a next-action date.
8. On the real application page, run the **Fill with RoleAtelier** bookmarklet, review every field, attach your resume, and submit yourself.

## Job sources

| Source | Key needed | Notes |
| --- | --- | --- |
| Remote OK | No | Public API, broad tech/non-tech remote roles. |
| Remotive | No | Curated remote roles, mostly product/engineering/support. |
| Arbeitnow | No | Europe-heavy board with a free public API. |
| Jobicy | No | Remote and hybrid roles across industries. |
| HN Who is hiring | No | Parses the latest monthly thread via the Algolia API. |
| Adzuna | Yes | Free developer key; add app id + key in Settings. |
| Workday | No | Per-employer career sites. Add one Workday URL per line in Settings, optionally prefixed with `Company \\|`. |
| LinkedIn Jobs | No | Search-only link. LinkedIn has no free public jobs API; import individual postings with **Add by URL**. |
| Indeed | No | Search-only link. Indeed's publisher API is partner-only; import individual postings with **Add by URL**. |
| Glassdoor | No | Search-only link. Glassdoor's API is partner-only; import individual postings with **Add by URL**. |
| Manual URL | No | Reads the posting's JSON-LD job data. |

Source availability is outside RoleAtelier's control. A failing source shows an error in the sync result without blocking the others. Respect each site's terms and rate limits.

### Workday setup

Workday does not have a global job board; each employer runs its own career site. In **Settings → Workday company boards**, paste the public career-site URL, one per line:

```text
NVIDIA | https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite
Salesforce | https://salesforce.wd12.myworkdayjobs.com/External_Career_Site
```

Then select **Workday company boards** in the source list and fetch. RoleAtelier reads the same public job feed the career site uses, pulls descriptions for scoring, and links every result back to the employer's application page.

## How the fit score works

The score is deterministic and deliberately simple to explain:

| Component | Weight |
| --- | --- |
| Skill overlap | 50 |
| Title match | 22 |
| Seniority match | 8 |
| Salary fit | 6 |
| Location/remote fit | 8 |
| Freshness | 6 |

Hard filters: a missing must-include term multiplies the score by `0.55`; a must-exclude term caps it at 12. The skill denominator is softened to `max(4, min(9, round(skills.length * 0.55)))` so a long skill list does not make every role look weak.

Scores are guidance, not a verdict. Read the reasons in the job drawer and use your judgment.

## 75+ prep queue

**Jobs → Prep 75+ queue** takes up to ten unstarted roles scoring 75 or higher, adds them to the pipeline as **Saved**, and generates a tailored resume and cover letter for each. The result dialog links to the prepared roles and to the pipeline.

This is a preparation queue, not an auto-apply bot. RoleAtelier never opens an employer form, fills it, or submits it without you. You review every document, run the bookmarklet on the employer's page, attach your files, and click Submit yourself. That keeps applications accurate and avoids the account bans that automated submissions cause.

## Autofill bookmarklet

1. Open **Autofill** and optionally choose an application to embed that role's cover letter.
2. Drag **Fill with RoleAtelier** to your bookmarks bar.
3. Open the employer's application form.
4. Click the bookmarklet. A toast reports how many fields were filled and what was left alone.
5. Review every value, attach your resume manually, and submit.

What it can fill:

- First/last/full name, email, phone, city/location
- LinkedIn, GitHub, portfolio
- Years of experience, desired salary, work authorization/sponsorship
- Cover letter and professional summary
- Saved answers matched by question text (70% word overlap)

What it cannot fill reliably:

- File uploads (browser security blocks scripts from setting file inputs)
- Cross-origin iframes (open the form in its own tab)
- Custom React/ARIA dropdowns that are not native `<select>` elements
- Questions whose wording differs substantially from your saved answers

The bookmarklet payload is embedded in the bookmark URL, so re-drag it after changing your profile or saved answers.

## Data and privacy

- Browser version: the database lives at `data/roleatelier.db` by default.
- Windows app: the database lives at `%APPDATA%\RoleAtelier\data\roleatelier.db`.
- macOS app: the database lives at `~/Library/Application Support/RoleAtelier/data/roleatelier.db`.
- Linux app: the database lives at `~/.config/RoleAtelier/data/roleatelier.db`.
- Set `ROLEATELIER_DATA` to use a different directory.
- Set `PORT` or `HOST` to change the listen address (defaults: `127.0.0.1:8787`).
- The server rejects cross-origin requests from non-local origins.
- Adzuna credentials, profile data, resumes and application notes never leave the machine except when RoleAtelier calls a job source API.
- Backups/export are explicit actions; nothing is uploaded automatically.
- Release assets are built from tracked source and `dist/` output only. The local `data/`, `release/`, log, backup and app-data directories are excluded from Git, release assets and the npm package.

## Releases and packages

`.github/workflows/release.yml` builds Windows, macOS and Linux on native GitHub runners when a `v*` tag is pushed. It publishes the platform installers to GitHub Releases and the source package to GitHub Packages as `@itsmevinci/roleatelier`. The GitHub package is a source distribution; use GitHub Releases for the desktop installers. Install it with `npm install @itsmevinci/roleatelier --registry=https://npm.pkg.github.com` after authenticating to GitHub Packages.

The workflow and the package `files` allowlist exclude `data/`, `release/`, logs, backups and the local app-data directories. It also runs `npm run verify:package` and `npm run verify:npm`: the first opens each packaged `app.asar`, and the second inspects the npm tarball. Both fail the build if a database, log, backup or local data directory is present. Publishing never uploads a local database.

## Scripts

```bash
npm run dev        # Vite + API with hot reload
npm run build      # build the frontend into dist/web
npm start          # start the browser version (build first)
npm run app        # build, start, and open the browser
npm run desktop    # build and launch the Electron desktop app
npm run dist       # build Windows installer + portable exe
npm run dist:portable  # build only the portable exe
npm run dist:mac   # build macOS dmg + zip (run on macOS)
npm run dist:linux # build Linux AppImage + deb (run on Linux)
npm run icons      # regenerate build/icon.ico and build/icon.icns
npm run verify:package  # fail if a packaged app.asar contains local data
npm run verify:npm      # fail if the npm package contains local data
npm run typecheck  # TypeScript check
npm run smoke      # end-to-end smoke test on a temporary database and port
```

## Project layout

```text
roleatelier/
  server/            Express API, SQLite, scoring, tailoring, autofill
  web/               Vite + React frontend
  electron/          Desktop shell (Electron main process)
  shared/            Shared TypeScript types
  scripts/           Dev runner, smoke test, icon conversion
  build/             App icon and desktop build resources
  samples/           Demo resume
  data/              Browser-version database (gitignored)
  dist/              Built web/server/Electron files (gitignored)
  release/           Packaged installers for all platforms (gitignored)
```

## Limits and disclaimers

- Job descriptions and source APIs change; scraping or parsing can break without notice.
- Salary parsing is heuristic. Check the original posting before relying on a number.
- Document tailoring reorders and reframes your real experience. It does not invent employers, titles or achievements.
- Workday career-site markup and feed behavior vary by employer and can change without notice.
- LinkedIn, Indeed and Glassdoor are search-only. RoleAtelier does not scrape them, and their APIs require partner agreements.
- RoleAtelier is a personal productivity tool, not legal or immigration advice. Work-authorization answers are yours to verify.
- RoleAtelier is an independent project and is not affiliated with any job board, employer, or applicant tracking system.
- Use the tool in line with each job board's terms of service. Automated submission is intentionally not supported.
