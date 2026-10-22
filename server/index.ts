import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './db.ts';
import { profileRouter } from './routes/profile.ts';
import { jobsRouter } from './routes/jobs.ts';
import { appsRouter } from './routes/applications.ts';
import { docsRouter } from './routes/docs.ts';
import { discoverRouter } from './routes/discover.ts';
import { systemRouter } from './routes/system.ts';
import { errorHandler } from './routes/util.ts';

const app = express();
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';

app.disable('x-powered-by');
app.use(express.json({ limit: '60mb' }));

// A local tool should only answer its own page. This blocks drive-by requests
// from random websites while still allowing curl and the Vite dev server.
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin) {
    try {
      const host = new URL(origin).hostname;
      if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
        return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
      }
    } catch {
      return res.status(403).json({ error: 'Bad origin' });
    }
  }
  if (!req.path.startsWith('/api')) return next();
  next();
});

app.use('/api', profileRouter);
app.use('/api', jobsRouter);
app.use('/api', appsRouter);
app.use('/api', docsRouter);
app.use('/api', discoverRouter);
app.use('/api', systemRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Unknown API endpoint' });
});

const dist = process.env.JOBPILOT_WEB
  ? path.resolve(process.env.JOBPILOT_WEB)
  : path.join(ROOT, 'dist', 'web');
if (existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist, {
    index: false,
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('cache-control', 'no-cache');
    },
  }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('*', (_req, res) => {
    res
      .type('html')
      .send(`<!doctype html><html><body style="font:16px/1.6 system-ui;background:#0b0d10;color:#e6e9ef;padding:48px">
        <h1 style="margin:0 0 8px">JobPilot API is running</h1>
        <p style="color:#9aa4b2">The web app has not been built yet. Run <code>npm run dev</code> (hot reload)
        or <code>npm run build &amp;&amp; npm start</code>.</p>
        <p><a style="color:#6ee7b7" href="/api/health">/api/health</a></p>
      </body></html>`);
  });
}

app.use(errorHandler);

const server = app.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`\n  JobPilot  ${url}\n`);
  if (process.argv.includes('--open')) openBrowser(url);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Set PORT=xxxx and try again.`);
    process.exit(1);
  }
  throw err;
});

function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '""', `"${url}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  } else if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
