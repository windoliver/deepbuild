// Issue #1457: counts the file-system calls in a frame of the shell, on this Mac. Builds scripts/frame-fs-calls/counter.c,
// launches a debug deep-app with it in a fresh home (where the first launch shows Set up), lets it settle, resizes its
// window to draw frames, quits it by PID, and prints one JSON line: {"frames","fs_in_frames","fs_per_frame","calls"}.
// `node scripts/frame-fs-calls.mjs [BINARY]`; the binary defaults to target/debug/deep-app. Needs Accessibility for
// osascript's resize. A run that drew no frame is BLOCKED (exit 2), never a count of 0.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('./', import.meta.url));
const binary = process.argv[2] ?? join(here, '../target/debug/deep-app');
if (!existsSync(binary)) {
  console.log(`BLOCKED frame-fs: no binary at ${binary}\n  Fix: cargo build -p deep-app --bin deep-app`);
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), 'frame-fs-'));
const lib = join(dir, 'counter.dylib');
execFileSync('clang', ['-dynamiclib', '-O1', '-o', lib, join(here, 'frame-fs-calls/counter.c'), '-lobjc']);
const home = join(dir, 'home');
execFileSync('mkdir', ['-p', home]);
const log = join(dir, 'events');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const app = spawn(binary, [], {
  cwd: dir,
  env: { PATH: process.env.PATH, HOME: home, DYLD_INSERT_LIBRARIES: lib, FRAME_FS_OUT: log },
  stdio: 'ignore',
});
await sleep(6000);
const resize = (w, h) => execFileSync('osascript', ['-e', `tell application "System Events" to tell (first process whose unix id is ${app.pid}) to set size of window 1 to {${w}, ${h}}`], { stdio: 'ignore' });
let resized = true;
try {
  for (let i = 0; i < 30; i++) { resize(900 + (i % 2) * 120, 640 + (i % 3) * 40); await sleep(150); }
} catch { resized = false; }
await sleep(1000);
app.kill('SIGTERM');
await sleep(500);
const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
const frames = lines.filter((l) => l === 'F').length;
const inFrames = lines.filter((l) => l.startsWith('D '));
if (frames === 0) {
  console.log(`BLOCKED frame-fs: the app drew no frame the counter saw${lines.includes('X no CAMetalLayer nextDrawable') ? ' (no CAMetalLayer nextDrawable)' : ''}`);
  process.exit(2);
}
const calls = {};
for (const l of inFrames) calls[l.slice(2)] = (calls[l.slice(2)] ?? 0) + 1;
console.log(JSON.stringify({ binary, frames, resized, fs_in_frames: inFrames.length, fs_per_frame: +(inFrames.length / frames).toFixed(2), calls }));
