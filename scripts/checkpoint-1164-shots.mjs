#!/usr/bin/env node
// #1164 AC7, the check run's pictures: the tic-tac-toe game sent by `deep show` from a test agent's process and played
// hot-seat with keys in the app, one key a second from 1 s (X 1, O 1 on a taken cell, O 4, X 2, O 5, X 3 for the win,
// O 9 after the end), drawn by the app at the reference window (1512 × 982 points at 2×, technical design: the
// reference window). Writes into docs/evidence/1164/, where the acceptance suite's ac7-shown.test.ts reads them:
//   x-and-o.png     the window at 3.5 s, after O 4: an X on cell 1 and an O on cell 4
//   taken-cell.png  the window at 2.5 s, after O's press on the taken cell 1: still the one X
//   win.png         the window at 6.5 s, after X 3: X across the top row, O on 4 and 5
//   game-keys.mp4   the window every 1/15 s from 0 to 8 s: the game as the keys play it
// Usage: node scripts/checkpoint-1164-shots.mjs  (builds deep-show and the rules program if they aren't built; needs
// macOS and ffmpeg). The game is the suite's (tests/acceptance/1164/helpers.ts `game`), rebuilt here because those
// helpers register vitest hooks when imported.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = process.env.CARGO_TARGET_DIR ?? join(REPO, 'target');
const RULES = join(REPO, 'tests/acceptance/1164/rules');
const KEEP = join(REPO, 'docs/evidence/1164');
const FLICKS = 705_600_000;
const sec = (s) => Math.round(s * FLICKS);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const env = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0', PATH: `/opt/homebrew/opt/rustup/bin:${process.env.PATH}` };
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, env, ...opts });
  if (r.status !== 0) throw Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr ?? '').slice(-2000)}`);
  return r.stdout;
};
/** A build through the machine's throttle and lease, as the suite's README runs it. */
const build = (args, cwd = REPO, extra = {}) =>
  run('node', [join(REPO, 'scripts/throttle.mjs'), 'build', '--wait', '240', '--', join(REPO, 'scripts/lease'), 'cargo', ...args], { cwd, env: { ...env, ...extra }, stdio: ['ignore', 'ignore', 'pipe'] });

const showBin = join(TARGET, 'debug', 'deep-show');
if (!existsSync(showBin)) build(['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full']);
const rulesOut = join(TARGET, 'acceptance-1164-rules', 'rules');
const wasm = join(rulesOut, 'wasm32-unknown-unknown', 'release', 'acceptance_1164_rules.wasm');
if (!existsSync(wasm)) build(['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown'], RULES, { CARGO_TARGET_DIR: rulesOut });

const work = mkdtempSync(join(tmpdir(), 'deep-1164-shots-'));
const bin = join(work, 'deep-show');
copyFileSync(showBin, bin);
const program = readFileSync(wasm);
const evidence = join(work, 'evidence');
mkdirSync(join(evidence, sha(program).slice(0, 2)), { recursive: true });
writeFileSync(join(evidence, sha(program).slice(0, 2), sha(program).slice(2)), program);

// The game (the suite's `game`): nine cells, each an X and an O path whose opacity a driver reads from rules.board.
const CELLS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const centre = (n) => [100 + 200 * ((n - 1) % 3), 100 + 200 * Math.floor((n - 1) / 3)];
const xPath = ([x, y]) => `M ${x - 60} ${y - 60} L ${x + 60} ${y + 60} M ${x - 60} ${y + 60} L ${x + 60} ${y - 60}`;
const oPath = ([x, y]) => {
  const pts = Array.from({ length: 16 }, (_, i) => [x + 60 * Math.cos((i * Math.PI) / 8), y + 60 * Math.sin((i * Math.PI) / 8)].map((v) => Math.round(v * 100) / 100).join(' '));
  return `M ${pts[0]} ${pts.slice(1).map((p) => `L ${p}`).join(' ')} Z`;
};
const items = {
  cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [300, 300, 0], view_width: 600 } },
  grid: { id: 'grid', kind: 'path@1', name: 'Grid', order: 'a1', params: { d: 'M 200 0 L 200 600 M 400 0 L 400 600 M 0 200 L 600 200 M 0 400 L 600 400', paint: { stroke: { role: 'ink', width: 6 } } } },
  rules: {
    id: 'rules', kind: 'logic@1', name: 'Rules', order: 'a9',
    params: { program: sha(program), step_rate: 30, reads: CELLS.map((n) => `c${n}`), writes: { board: { type: 'i32', count: 9 }, winner: { type: 'i32' } }, budget: { fuel: 1_000_000 } },
  },
};
const drivers = {};
for (const n of CELLS) {
  items[`x${n}`] = { id: `x${n}`, kind: 'path@1', name: `X ${n}`, order: `b${n}`, params: { d: xPath(centre(n)), paint: { stroke: { role: 'ink', width: 12 } } }, adjust: { opacity: 0 } };
  items[`o${n}`] = { id: `o${n}`, kind: 'path@1', name: `O ${n}`, order: `c${n}`, params: { d: oPath(centre(n)), paint: { stroke: { role: 'accent', width: 12 } } }, adjust: { opacity: 0 } };
  drivers[`x${n}_shown`] = { target: `items/x${n}/adjust/opacity`, expr: 'max(0, 1 - abs(b - 1))', vars: { b: `rules.board[${n - 1}]` } };
  drivers[`o${n}_shown`] = { target: `items/o${n}/adjust/opacity`, expr: 'max(0, 1 - abs(b - 2))', vars: { b: `rules.board[${n - 1}]` } };
}
const game = {
  format: 1, profile: 'figure', title: 'Tic-tac-toe', description: 'Hot-seat tic-tac-toe whose rules run as a logic item at 30 steps a second.',
  size: [600, 600], seed: 1164, camera: 'cam', transport: { span: '12s', frame_rate: [30, 1] }, requires: { modules: { input: '^1', logic: '^1' } },
  controls: Object.fromEntries(CELLS.map((n) => [`c${n}`, { kind: 'press', class: 'document', label: `Cell ${n}`, role: 'button', keys: { [String(n)]: 1 } }])),
  items, drivers,
  assets: { rules_program: { sha256: sha(program), license: { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #1164 acceptance tests.' } } },
};

// The suite's world at the reference window: the agent (4100), its tool shell (4101) and the test process (4102) that
// runs `deep show`; the scope's virtual clock; a click that gives the panel the keys, then one key a second from 1 s.
const DOC = '01JB1164D00000000000000001';
const panel = { pid: 4102, start: 1200 };
const keys = [['1', 1], ['1', 2], ['4', 3], ['2', 4], ['5', 5], ['3', 6], ['9', 7]];
const world = {
  evidence,
  sessions: { 'sess-game': { thread: 'thread-game', name: 'Test agent: tic-tac-toe', process: { pid: 4100, start: 1000 } } },
  processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1000 },
    { pid: 4101, ppid: 4100, start: 1100 }, { pid: 4102, ppid: 4101, start: 1200 }],
  window: [1512, 982],
  panels: { main: { rect: [0, 0, 1512, 982] } },
  docs: { [DOC]: { panel: 'main' } },
  clock: { refresh_hz: 120, lead: sec(0.002), check: sec(0.0005) },
  display: [1600, 900],
  calls: [
    { call: 'deep show', peer: panel, doc: DOC, document: game, at: 2 },
    { call: 'input', panel: 'main', event: { type: 'down', pos: [1500, 970] }, at: sec(0.5) },
    { call: 'input', panel: 'main', event: { type: 'up', pos: [1500, 970] }, at: sec(0.56) },
    ...keys.map(([key, s]) => ({ call: 'input', panel: 'main', event: { type: 'key', key }, at: sec(s) })),
  ],
};

// Each press must reach its control: the played run's replies, read once before any picture.
const played = JSON.parse(run(bin, ['run'], { input: `${JSON.stringify(world)}\n` }));
const replies = played.replies ?? [];
if (!played.ok || replies[0]?.outcome !== 'presented') throw Error(`the game isn't presented: ${JSON.stringify(replies[0] ?? played).slice(0, 800)}`);
keys.forEach(([key], i) => {
  const appended = replies[3 + i]?.appended ?? [];
  if (appended.length !== 1 || appended[0].control !== `c${key}`) throw Error(`key ${key} didn't press c${key}: ${JSON.stringify(replies[3 + i]).slice(0, 600)}`);
});

/** The window at document time `t` (flicks), at 2×. */
const screen = (t, out) => {
  const reply = JSON.parse(run(bin, ['screen'], { input: `${JSON.stringify({ ...world, out, t, scale: 2 })}\n` }));
  if (!reply.ok || reply.width !== 3024 || reply.height !== 1964) throw Error(`screen at ${t}: ${JSON.stringify(reply).slice(0, 600)}`);
};

mkdirSync(KEEP, { recursive: true });
screen(sec(3.5), join(KEEP, 'x-and-o.png'));
screen(sec(2.5), join(KEEP, 'taken-cell.png'));
screen(sec(6.5), join(KEEP, 'win.png'));

// The recording: the window every 1/15 s from 0 to 8 s, encoded H.264.
const frames = join(work, 'frames');
mkdirSync(frames);
for (let k = 0; k <= 120; k++) screen(Math.round((k * FLICKS) / 15), join(frames, `f${String(k).padStart(4, '0')}.png`));
run('ffmpeg', ['-v', 'error', '-y', '-framerate', '15', '-i', join(frames, 'f%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', join(KEEP, 'game-keys.mp4')]);

rmSync(work, { recursive: true, force: true });
const names = ['x-and-o.png', 'taken-cell.png', 'win.png', 'game-keys.mp4'];
console.log(JSON.stringify(Object.fromEntries(names.map((n) => [n, sha(readFileSync(join(KEEP, n)))])), null, 2));
