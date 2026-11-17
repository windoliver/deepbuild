// Which syscall each Node sync API makes, and what it costs. Run under the interposer: markers on stderr bracket each call.
import { closeSync, fdatasyncSync, fsync, fsyncSync, openSync, writeSync, mkdtempSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'ffs-'));
const file = join(dir, 'f');
const mark = (s) => process.stderr.write(`MARK ${s}\n`);
const time = async (label, fn, n = 20) => {
  const ms = [];
  for (let i = 0; i < n; i++) { const fd = openSync(file, 'w'); writeSync(fd, `x${i}`.repeat(4096)); const t = performance.now(); if (i === 0) mark(`${label} begin`); await fn(fd); if (i === 0) mark(`${label} end`); ms.push(performance.now() - t); closeSync(fd); }
  ms.sort((a, b) => a - b);
  console.log(`${label}: median ${ms[n >> 1].toFixed(2)} ms, min ${ms[0].toFixed(2)}, max ${ms[n - 1].toFixed(2)}`);
};
console.log(`node ${process.version} ${process.platform} ${process.arch} libuv ${process.versions.uv}`);
await time('fs.fsyncSync', (fd) => fsyncSync(fd));
await time('fs.fdatasyncSync', (fd) => fdatasyncSync(fd));
await time('fs.fsync (callback)', (fd) => new Promise((r, j) => fsync(fd, (e) => (e ? j(e) : r()))));
mark('FileHandle.sync begin');
{ const h = await open(file, 'r+'); await h.write('y'); await h.sync(); await h.close(); }
mark('FileHandle.sync end');
mark('folder fsyncSync begin');
{ const fd = openSync(dir, 'r'); fsyncSync(fd); closeSync(fd); }
mark('folder fsyncSync end');
rmSync(dir, { recursive: true, force: true });
