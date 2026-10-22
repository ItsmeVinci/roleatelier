import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const npmCli = process.env.npm_execpath;
const args = ['pack', '--dry-run', '--json'];

const raw = npmCli
  ? execFileSync(process.execPath, [npmCli, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  : execFileSync('npm', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

const pack = JSON.parse(raw);
const files = (pack[0]?.files ?? []).map((file) => file.path.replace(/\\/g, '/'));
if (files.length === 0) throw new Error('npm pack returned no files.');

const dataPatterns = [
  /(^|\/)(data|release)\//i,
  /\.(db|db-wal|db-shm|sqlite|sqlite3|log)$/i,
  /\.backup\.json$/i,
  /roleatelier-backup-.*\.json$/i,
  /roleatelier-applications-.*\.csv$/i,
];

const leaks = files.filter((file) => dataPatterns.some((pattern) => pattern.test(file)));
console.log(`npm package: ${files.length} files, ${(pack[0].size / 1024).toFixed(1)} KiB`);
if (leaks.length > 0) {
  console.error('Local data paths found in the npm package:');
  for (const leak of leaks) console.error(`- ${leak}`);
  process.exit(1);
}
console.log('no local data paths found');
