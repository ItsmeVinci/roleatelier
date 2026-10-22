import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const png = readFileSync(path.join(ROOT, 'build', 'icon.png'));

// ICO with one 256x256 PNG frame. Windows Vista+ supports PNG-compressed frames.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // icon
header.writeUInt16LE(1, 4); // one image

const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0); // 256px
entry.writeUInt8(0, 1); // 256px
entry.writeUInt8(0, 2); // palette
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(header.length + entry.length, 12);

const out = path.join(ROOT, 'build', 'icon.ico');
writeFileSync(out, Buffer.concat([header, entry, png]));
console.log(`Wrote ${out} (${png.length + 22} bytes)`);
