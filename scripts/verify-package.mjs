import { existsSync, lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import * as asar from '@electron/asar';

const ROOT = process.cwd();
const RELEASE = path.join(ROOT, 'release');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

if (!existsSync(RELEASE)) {
  throw new Error('release/ does not exist; package the app first.');
}

const archives = walk(RELEASE).filter((file) => file.endsWith('app.asar'));
if (archives.length === 0) {
  throw new Error('No packaged app.asar found under release/.');
}

const dataPatterns = [
  /(^|\/)data\//i,
  /(^|\/)release\//i,
  /\.(db|db-wal|db-shm|sqlite|sqlite3|log)$/i,
  /\.backup\.json$/i,
  /roleatelier-backup-.*\.json$/i,
  /roleatelier-applications-.*\.csv$/i,
];

let failed = false;

for (const archive of archives) {
  const entries = asar
    .listPackage(archive)
    .map((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, ''));

  const ownFiles = entries.filter((entry) => !entry.startsWith('node_modules/'));
  const leaks = ownFiles.filter((entry) => dataPatterns.some((pattern) => pattern.test(entry)));

  console.log(`${path.relative(ROOT, archive)}: ${entries.length} entries, ${ownFiles.length} app entries`);
  if (leaks.length > 0) {
    failed = true;
    console.error('  Local data paths found in the packaged app:');
    for (const leak of leaks) console.error(`  - ${leak}`);
  } else {
    console.log('  no local data paths found');
  }
}

if (failed) process.exit(1);
