import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

app.setName('RoleAtelier');
app.setAppUserModelId('com.roleatelier.local');

const APP_TITLE = 'RoleAtelier';
const isWindows = process.platform === 'win32';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let logStream: ReturnType<typeof createWriteStream> | null = null;
let logPath = '';
let appUrl = '';
let quitting = false;
let serverFailed = false;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(boot).catch(fatal);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void boot();
    else mainWindow?.focus();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    stopServer();
  });
}

async function boot(): Promise<void> {
  if (mainWindow) {
    mainWindow.focus();
    return;
  }

  Menu.setApplicationMenu(buildMenu());
  const window = createWindow('data:text/html;charset=utf-8,' + encodeURIComponent(splashHtml()));

  try {
    const port = await freePort();
    const dataDir = process.env.ROLEATELIER_DATA
      ? path.resolve(process.env.ROLEATELIER_DATA)
      : path.join(app.getPath('userData'), 'data');
    mkdirSync(dataDir, { recursive: true });

    const paths = packagedPaths();
    await startServer({ port, dataDir, serverEntry: paths.server, webDir: paths.web });

    appUrl = `http://127.0.0.1:${port}/`;
    await window.loadURL(appUrl);
    window.show();
    window.focus();
  } catch (err) {
    fatal(err);
  }
}

function createWindow(initialUrl: string): BrowserWindow {
  const icon = iconPath();

  const window = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: APP_TITLE,
    backgroundColor: '#0b0e13',
    show: false,
    autoHideMenuBar: true,
    icon: icon && existsSync(icon) ? icon : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  mainWindow = window;
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!appUrl) return;
    try {
      if (new URL(url).origin === new URL(appUrl).origin) return;
    } catch {
      // fall through to block
    }
    event.preventDefault();
    void openExternal(url);
  });

  void window.loadURL(initialUrl);
  return window;
}

async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  try {
    await shell.openExternal(url);
  } catch {
    // A blocked or malformed URL should never take down the app.
  }
}

function packagedPaths(): { server: string; web: string } {
  if (app.isPackaged) {
    const base = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist');
    return {
      server: path.join(base, 'server', 'index.mjs'),
      web: path.join(base, 'web'),
    };
  }
  const base = path.join(app.getAppPath(), 'dist');
  return {
    server: path.join(base, 'server', 'index.mjs'),
    web: path.join(base, 'web'),
  };
}

function iconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(app.getAppPath(), 'build', 'icon.ico');
}

function logFile(): string {
  if (!logPath) {
    logPath = path.join(app.getPath('userData'), 'roleatelier.log');
    mkdirSync(path.dirname(logPath), { recursive: true });
  }
  return logPath;
}

async function startServer(opts: { port: number; dataDir: string; serverEntry: string; webDir: string }): Promise<void> {
  if (!existsSync(opts.serverEntry)) {
    throw new Error(`The packaged server is missing:\n${opts.serverEntry}\n\nRun "npm run build:app" first.`);
  }
  if (!existsSync(path.join(opts.webDir, 'index.html'))) {
    throw new Error(`The built web app is missing:\n${opts.webDir}\n\nRun "npm run build:web" first.`);
  }

  const log = logFile();
  writeFileSync(
    log,
    `\n[${new Date().toISOString()}] Starting RoleAtelier ${app.getVersion()} on port ${opts.port}\n`,
    { flag: 'a' },
  );
  logStream = createWriteStream(log, { flags: 'a' });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(opts.port),
    HOST: '127.0.0.1',
    ROLEATELIER_DATA: opts.dataDir,
    ROLEATELIER_ROOT: app.getAppPath(),
    ROLEATELIER_WEB: opts.webDir,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
  };

  serverProcess = spawn(process.execPath, [opts.serverEntry], {
    cwd: opts.dataDir,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout?.on('data', (chunk: Buffer) => logStream?.write(chunk));
  serverProcess.stderr?.on('data', (chunk: Buffer) => logStream?.write(chunk));

  serverProcess.on('exit', (code, signal) => {
    logStream?.write(`[${new Date().toISOString()}] Server exited (code=${code}, signal=${signal})\n`);
    if (quitting || serverFailed) return;
    serverFailed = true;
    dialog.showErrorBox(
      'RoleAtelier server stopped',
      `The local server exited unexpectedly (code ${code ?? 'unknown'}).\n\nLog file:\n${log}`,
    );
    app.quit();
  });

  await waitForHealth(`http://127.0.0.1:${opts.port}/api/health`, 30_000);
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';

  while (Date.now() < deadline) {
    if (serverFailed) throw new Error('The local server exited during startup.');
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`The local server did not answer within 30 seconds (${lastError}).\n\nLog file:\n${logFile()}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('Could not reserve a local port'))));
    });
  });
}

function stopServer(): void {
  if (!serverProcess) return;
  const pid = serverProcess.pid;
  serverProcess = null;
  if (!pid) return;
  if (isWindows) {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  logStream?.end();
  logStream = null;
}

function buildMenu(): Menu {
  const dataDir = process.env.ROLEATELIER_DATA
    ? path.resolve(process.env.ROLEATELIER_DATA)
    : path.join(app.getPath('userData'), 'data');

  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'Open data folder',
          click: () => {
            mkdirSync(dataDir, { recursive: true });
            void shell.openPath(dataDir);
          },
        },
        {
          label: 'Open log file',
          click: () => {
            const log = logFile();
            if (existsSync(log)) shell.showItemInFolder(log);
            else void shell.openPath(path.dirname(log));
          },
        },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About RoleAtelier',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'About RoleAtelier',
              message: `RoleAtelier ${app.getVersion()}`,
              detail:
                'A local-first job search cockpit.\n\nAll profile, job and application data stays on this machine.\n\nRoleAtelier never submits applications for you.',
              buttons: ['OK'],
            });
          },
        },
        {
          label: 'Open project folder',
          click: () => {
            if (!app.isPackaged) void shell.openPath(app.getAppPath());
          },
        },
      ],
    },
  ]);
}

function fatal(err: unknown): void {
  serverFailed = true;
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  try {
    dialog.showErrorBox('RoleAtelier could not start', message);
  } finally {
    app.quit();
  }
}

function splashHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: grid; place-items: center; background: #0b0e13; color: #e7ecf3;
    font: 14px/1.5 "Segoe UI", system-ui, sans-serif;
  }
  .box { text-align: center; }
  .mark {
    width: 56px; height: 56px; margin: 0 auto 18px; border-radius: 16px;
    display: grid; place-items: center; background: rgba(110,231,183,.1);
    border: 1px solid rgba(110,231,183,.28); color: #6ee7b7;
    font-size: 28px; font-weight: 700;
  }
  .name { font-size: 20px; font-weight: 650; letter-spacing: -.4px; }
  .hint { color: #8490a3; margin-top: 6px; }
</style>
</head>
<body>
  <div class="box">
    <div class="mark">⚡</div>
    <div class="name">RoleAtelier</div>
    <div class="hint">Starting your local workspace…</div>
  </div>
</body>
</html>`;
}
