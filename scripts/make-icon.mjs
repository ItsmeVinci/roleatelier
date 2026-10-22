import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import png2icons from 'png2icons';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const input = readFileSync(path.join(ROOT, 'build', 'icon-1024.png'));

const icns = png2icons.createICNS(input, png2icons.RESIZE_BICUBIC, 0);
if (!icns) throw new Error('Could not generate build/icon.icns');
writeFileSync(path.join(ROOT, 'build', 'icon.icns'), icns);

const ico = png2icons.createICO(input, png2icons.RESIZE_BICUBIC, 0, false, true);
if (!ico) throw new Error('Could not generate build/icon.ico');
writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico);

console.log(`Wrote build/icon.icns (${icns.length} bytes) and build/icon.ico (${ico.length} bytes)`);
