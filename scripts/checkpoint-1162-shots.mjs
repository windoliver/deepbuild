#!/usr/bin/env node
// #1162 AC7, the check run's pictures: the checkpoint piece sent by `deep show` from a test agent's
// process and drawn by the app at the reference window (1512 × 982 points at 2×, technical design:
// the reference window). Writes into $TMPDIR/deep-1162-proof/ac7/, where the acceptance suite's
// shown.test.ts reads them, and copies them to docs/evidence/1162/:
//   chart-formula.png  the replica's window at 4 s: the bar chart with its formula beside it
//   frame-3d.png       the GPU layer's view3d of the stored piece in its finished look (tone map,
//                      AO, deband, bloom), at the reference window's pixel size
//   spring.png         the replica's window at 0.2 s: the badge mid-spring
//   spring-sweep.mp4   the window from 0 to 4 s at 30 fps: the spring and the swept frame
// Usage: node scripts/checkpoint-1162-shots.mjs  (builds deep-show and deep-gpu; needs macOS and ffmpeg)

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(REPO, 'tests/acceptance/1162/fixtures');
const OUT = join(tmpdir(), 'deep-1162-proof', 'ac7');
const KEEP = join(REPO, 'docs/evidence/1162');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
  if (r.status !== 0) throw Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr ?? '').slice(-2000)}`);
  return r.stdout;
};

for (const bin of ['deep-show', 'deep-gpu']) run('cargo', ['build', '--locked', '--bin', bin], { cwd: REPO, stdio: ['ignore', 'ignore', 'pipe'] });
const bins = mkdtempSync(join(tmpdir(), 'deep-1162-shots-'));
for (const bin of ['deep-show', 'deep-gpu']) copyFileSync(join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', bin), join(bins, bin));

// The world of the acceptance suite: the agent, its tool shell and the test process that runs
// `deep show`; the piece and its assets in the evidence store, the table imported by the agent.
const evidence = join(bins, 'evidence');
for (const f of ['formula.svg', 'look.json']) {
  const b = readFileSync(join(FIX, f));
  mkdirSync(join(evidence, sha(b).slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha(b).slice(0, 2), sha(b).slice(2)), b);
}
const piece = JSON.parse(readFileSync(join(FIX, 'piece.json'), 'utf8'));
for (const [id, item] of Object.entries(piece.items)) item.id = id;
const DOC = '01JB1162D00000000000000001';
const world = {
  evidence,
  sessions: { 'sess-piece': { thread: 'thread-piece', name: 'Test agent: checkpoint piece', process: { pid: 4100, start: 1000 } } },
  processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1000 },
    { pid: 4101, ppid: 4100, start: 1100 }, { pid: 4102, ppid: 4101, start: 1200 }],
  window: [1512, 982],
  panels: { main: { rect: [0, 0, 1512, 982] } },
  docs: { [DOC]: { panel: 'main' } },
  calls: [
    { call: 'table_import', path: join(FIX, 'table.csv'), key: 'key', session: 'sess-piece' },
    { call: 'deep show', peer: { pid: 4102, start: 1200 }, doc: DOC, document: piece },
  ],
};
/** The replica's window at `t`, at 2×. */
const screen = (t, out) => {
  const reply = JSON.parse(run(join(bins, 'deep-show'), ['screen'], { input: `${JSON.stringify({ ...world, out, t, scale: 2 })}\n` }));
  if (!reply.ok || reply.width !== 3024 || reply.height !== 1964) throw Error(`screen at ${t}: ${JSON.stringify(reply).slice(0, 600)}`);
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
screen('4s', join(OUT, 'chart-formula.png'));
screen('0.2s', join(OUT, 'spring.png'));

// The stored piece as `read` gives it, opened by the GPU layer's view3d in the piece's look.
const [[, , read]] = [JSON.parse(run(join(bins, 'deep-show'), ['run'], { input: `${JSON.stringify({ ...world, calls: [...world.calls, { call: 'read', doc: DOC, session: 'sess-piece' }] })}\n` })).replies];
const stored = join(bins, 'stored.json');
writeFileSync(stored, JSON.stringify(read.document));
const assets = {};
for (const f of ['formula.svg', 'look.json', 'table.csv']) { const s = sha(readFileSync(join(FIX, f))); assets[s] = join(evidence, s.slice(0, 2), s.slice(2)); }
const look = JSON.parse(readFileSync(join(FIX, 'look.json'), 'utf8'));
const gpu = JSON.parse(run(join(bins, 'deep-gpu'), ['run'], {
  input: `${JSON.stringify({ out: bins, calls: [{ call: 'view3d', doc: stored, look, size: [3024, 1964], frames: 1, capture: [0], targets: ['final'], assets }] })}\n`,
}));
const final = gpu.replies?.[0]?.frames?.[0]?.final;
if (!gpu.ok || !final) throw Error(`view3d: ${JSON.stringify(gpu).slice(0, 600)}`);
copyFileSync(join(bins, `${final}.png`), join(OUT, 'frame-3d.png'));

// The recording: the window every 1/30 s from 0 to 4 s, encoded H.264.
const frames = join(bins, 'frames');
mkdirSync(frames);
for (let k = 0; k <= 120; k++) screen(Math.round((k * 705_600_000) / 30), join(frames, `f${String(k).padStart(4, '0')}.png`));
run('ffmpeg', ['-v', 'error', '-y', '-framerate', '30', '-i', join(frames, 'f%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', join(OUT, 'spring-sweep.mp4')]);

mkdirSync(KEEP, { recursive: true });
const names = ['chart-formula.png', 'frame-3d.png', 'spring.png', 'spring-sweep.mp4'];
for (const n of names) copyFileSync(join(OUT, n), join(KEEP, n));
rmSync(bins, { recursive: true, force: true });
console.log(JSON.stringify(Object.fromEntries(names.map((n) => [n, sha(readFileSync(join(OUT, n)))])), null, 2));
