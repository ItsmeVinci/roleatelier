import { spawn } from 'node:child_process';

const procs = [
  spawn('npm', ['run', 'dev:web'], { stdio: 'inherit', shell: true }),
  spawn('npm', ['run', 'dev:server'], { stdio: 'inherit', shell: true }),
];

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const p of procs) {
    if (p.pid && !p.killed) {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        p.kill('SIGTERM');
      }
    }
  }
  setTimeout(() => process.exit(code), 400);
}

for (const p of procs) {
  p.on('exit', (code) => {
    if (!closing) shutdown(code ?? 0);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
