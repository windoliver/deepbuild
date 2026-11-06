// Test-side tools for the #990 acceptance tests. They lean on #402's suite for the one long-lived hub on the wall clock
// (`deep-show serve`, real PTYs, a panel host of its own) and its calls (`install`, `terminal_open`, `seam`, `input`,
// `cells`), and add: the real programs these tests run in terminals (each logs what it reads to files in its own folder),
// the calls and fields #990 adds (README: The surface under test), and the checks each criterion's wrong program must
// fail. Nothing here stands in for the encoder, the paste, the emulator's answers, the record or the mode reset: each is
// read from what a real program received, what a real shell did, or what `deep-show` and the record answer.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  ALPHA, REPO, SESSIONS, SLOTS, alive, centre, gridOf, installCall, openCall, openedOf, readBytes, readText, setupOf, sleep, terminalPlugin, tmp,
  useShow, waitFor, withServe, type Grid, type JsonObject, type JsonValue, type Rect, type Serve,
} from '../402/helpers.ts';

export {
  ALPHA, REPO, SESSIONS, SLOTS, alive, centre, gridOf, installCall, openCall, openedOf, readBytes, readText, setupOf, sleep, terminalPlugin, tmp,
  useShow, waitFor, withServe, type Grid, type JsonObject, type JsonValue, type Rect, type Serve,
};

export const ESC = '\u001b';
/** Bytes as a readable string: printable ASCII as is, everything else as \xNN. */
export function shown(b: Buffer | string): string {
  const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b;
  let s = '';
  for (const c of buf) s += c >= 0x20 && c < 0x7f && c !== 0x5c ? String.fromCharCode(c) : `\\x${c.toString(16).padStart(2, '0')}`;
  return s;
}

/** A test that can't be judged here fails with this, never passes (README: INCONCLUSIVE). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
export const REFERENCE_MODELS = ['Mac15,7', 'Mac15,12'];
/** Why this machine is not the reference Mac, or null when it is. */
export function referenceMacProblem(): string | null {
  if (process.platform !== 'darwin') return `this is ${process.platform}, not macOS`;
  let model = '';
  try { model = execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* unknown */ }
  return REFERENCE_MODELS.includes(model) ? null : `not a reference Mac (Mac15,7 or Mac15,12): hw.model is ${model || 'unknown'}`;
}

// ---------------------------------------------------------------------------------------------------
// The programs: real Node scripts run on a real PTY by the hub, with this Node (`process.execPath`). Each touches only
// its own folder; none uses the network or a clipboard.

const COMMON = `
const fs = require('node:fs');
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function writeAll(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  let off = 0;
  while (off < buf.length) {
    try { off += fs.writeSync(1, buf, off); }
    catch (e) { if (e.code === 'EAGAIN') { sleepMs(1); continue; } throw e; }
  }
}
const [log, cfgPath] = process.argv.slice(2);
const cfg = cfgPath ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
`;

/** Reads its terminal raw and appends every byte to its log; first writes \`cfg.out\` (escapes, a marker), then waits. */
const RECORDER = `${COMMON}
if (process.stdin.isTTY) process.stdin.setRawMode(true);
fs.writeFileSync(log, '');
process.stdin.on('data', (b) => fs.appendFileSync(log, b));
process.stdin.resume();
if (cfg.out) writeAll(cfg.out);
fs.writeFileSync(log + '.ready', '1');
setInterval(() => {}, 1000);
`;

/**
 * Writes optionally \`cfg.filler\` lines, then \`cfg.pre\` (place the cursor, set modes), then every query of \`cfg.query\`
 * in ONE write, and logs each chunk it reads with its time in ms since that write, as JSON lines. After \`cfg.wait_ms\` it
 * matches what it read against \`cfg.answers\` (regex sources, in order) and prints "timeout" if any is missing.
 */
const ASKER = `${COMMON}
if (process.stdin.isTTY) process.stdin.setRawMode(true);
fs.writeFileSync(log, '');
let t0 = null;
let all = Buffer.alloc(0);
process.stdin.on('data', (b) => {
  const ms = t0 === null ? -1 : Number(process.hrtime.bigint() - t0) / 1e6;
  all = Buffer.concat([all, b]);
  fs.appendFileSync(log, JSON.stringify({ ms, hex: b.toString('hex') }) + '\\n');
});
process.stdin.resume();
(async () => {
  // Filler first, so the cursor is where \`pre\` puts it when the queries are read.
  if (cfg.filler) { let s = ''; for (let i = 1; i <= cfg.filler; i++) s += 'filler line ' + i + ' ' + 'x'.repeat(60) + '\\r\\n'; writeAll(s); }
  writeAll(cfg.pre || '');
  if (!cfg.filler) await wait(400);
  const q = Buffer.from(cfg.query, 'latin1');
  t0 = process.hrtime.bigint();
  const n = fs.writeSync(1, q);
  if (n !== q.length) writeAll(q.subarray(n));
  fs.writeFileSync(log + '.asked', String(n === q.length ? 'one write' : 'split write'));
  await wait(cfg.wait_ms || 2000);
  let text = all.toString('latin1');
  let found = 0;
  for (const src of cfg.answers) { const m = new RegExp('^' + src).exec(text); if (!m) break; text = text.slice(m[0].length); found++; }
  if (found < cfg.answers.length) { writeAll('\\r\\ntimeout\\r\\n'); fs.writeFileSync(log + '.timeout', String(found)); }
  else writeAll('\\r\\nanswered\\r\\n');
  fs.writeFileSync(log + '.done', '1');
  setInterval(() => {}, 1000);
})();
`;

/** Sends the program-status query, waits up to 2 s for its answer (logged), then reports each of \`cfg.reports\`. */
const STATUS = `${COMMON}
if (process.stdin.isTTY) process.stdin.setRawMode(true);
fs.writeFileSync(log, '');
let all = Buffer.alloc(0);
process.stdin.on('data', (b) => { all = Buffer.concat([all, b]); fs.appendFileSync(log, b); });
process.stdin.resume();
(async () => {
  writeAll(cfg.query);
  const until = Date.now() + 2000;
  while (Date.now() < until && !/\\x1b\\]7501;[^\\x07\\x1b]*(\\x07|\\x1b\\\\)/.test(all.toString('latin1'))) await wait(10);
  fs.writeFileSync(log + '.answered', /\\x1b\\]7501;/.test(all.toString('latin1')) ? 'yes' : 'no');
  for (const r of cfg.reports) { writeAll(r); await wait(cfg.gap_ms || 400); }
  fs.writeFileSync(log + '.done', '1');
  setInterval(() => {}, 1000);
})();
`;

/** Turns modes on (\`cfg.out\`), holds them \`cfg.hold_ms\`, notes that it is leaving, and exits 0. */
const MODES = `${COMMON}
writeAll(cfg.out);
sleepMs(cfg.hold_ms || 500);
fs.writeFileSync(log, 'exiting');
process.exit(0);
`;

export type ProgramName = 'recorder' | 'asker' | 'status' | 'modes';
const SOURCES: Record<ProgramName, string> = { recorder: RECORDER, asker: ASKER, status: STATUS, modes: MODES };

/** The environment of every program: a HOME of its own (its folder), a minimal PATH, a UTF-8 locale. */
export function progEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  return { HOME: home, PATH: '/usr/bin:/bin', TERM: 'xterm-256color', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', ...extra };
}
export type Program = { argv: string[]; env: Record<string, string>; cwd: string };
/** The script `name` written into `dir`, with its log and config; `{argv, env, cwd}` for `terminal_open`. */
export function script(dir: string, name: ProgramName, log: string, config: JsonObject = {}): Program {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.cjs`);
  if (!existsSync(path)) writeFileSync(path, SOURCES[name]);
  const cfg = `${log}.config.json`;
  writeFileSync(cfg, JSON.stringify(config));
  return { argv: [process.execPath, path, log, cfg], env: progEnv(dir), cwd: dir };
}
/** The path of a script in `dir` (written if missing), for a shell to run. */
export function scriptPath(dir: string, name: ProgramName): string {
  const path = join(dir, `${name}.cjs`);
  if (!existsSync(path)) writeFileSync(path, SOURCES[name]);
  return path;
}

// ---------------------------------------------------------------------------------------------------
// One terminal in one plug-in panel, focused by your click: the frame most tests share.

export const PANEL = 'term';
export const SLOT: Rect = SLOTS[0]!;
export const TERMINAL = 'T1';

export async function click(s: Serve, panel: string, slot: Rect): Promise<void> {
  const pos = centre(slot);
  await s.ok({ call: 'input', panel, event: { type: 'down', pos } }, `your press in ${panel}`);
  await s.ok({ call: 'input', panel, event: { type: 'up', pos } }, `your release in ${panel}`);
}

/** Opens `program` in terminal T1 of panel `term` (plus `extra` open fields), notes its PIDs and gives the panel focus. */
export async function openFocused(s: Serve, program: Program, extra: JsonObject = {}, cols = 120, rows = 36): Promise<void> {
  await s.ok(installCall(0, 'terminals', terminalPlugin({ [PANEL]: TERMINAL })), 'the terminals plug-in installs');
  const o = openedOf(await s.call({ ...openCall(0, TERMINAL, { panel: PANEL, cols, rows, program }), ...extra }, 120_000), TERMINAL);
  for (const p of [o.host, o.program]) if (p) s.known.add(p.pid);
  await click(s, PANEL, SLOT);
}

export async function grid(s: Serve, what: string, terminal = TERMINAL): Promise<Grid> {
  return gridOf(await s.ok({ call: 'cells', terminal }, what), what);
}
/** Waits until the grid's text holds `marker` on some row, so every byte the program wrote before it is applied. */
export async function waitScreen(s: Serve, test: (rows: string[]) => boolean, what: string, ms = 30_000): Promise<Grid> {
  const g = await waitFor(() => grid(s, what), (x) => test(x.text), ms, 100);
  expect(test(g.text), `${what}: the screen shows it within ${ms} ms; the screen: ${JSON.stringify(g.text.filter((r) => r !== '').slice(-8))}`).toBe(true);
  return g;
}

/** The setup for one serve with the one panel (and the given planted fault, and more setup fields). */
export function setup(dir: string, planted?: string, more: JsonObject = {}): JsonObject {
  return { ...setupOf({ evidence: dir, panels: { [PANEL]: SLOT }, ...(planted ? { planted } : {}) }), ...more };
}

/** A key from the input seam's test backend: its key name, its physical key code (W3C UI Events `code`), its modifiers. */
export const keyEvent = (key: string, mods: readonly string[] = [], code?: string): JsonObject => ({ call: 'seam', event: { type: 'key', key, phase: 'press', mods: [...mods], ...(code ? { code } : {}) } });
export const seam = (event: JsonObject): JsonObject => ({ call: 'seam', event });

/** Waits until the log at `path` has grown past `from` bytes and stopped growing; returns the bytes after `from`. */
export async function newBytes(path: string, from: number, ms = 1500): Promise<Buffer> {
  const until = Date.now() + ms;
  let size = readBytes(path).length;
  while (size <= from && Date.now() < until) { await sleep(5); size = readBytes(path).length; }
  // Settle: the key's bytes may come in more than one read.
  for (;;) {
    await sleep(30);
    const now = readBytes(path).length;
    if (now === size) break;
    size = now;
  }
  return readBytes(path).subarray(from);
}

/** bash 5.1 or newer, which has bracketed paste in readline: its path, or why there is none. */
export function modernBash(): { path: string } | { why: string } {
  for (const p of ['/bin/bash', '/usr/bin/bash', '/opt/homebrew/bin/bash', '/usr/local/bin/bash']) {
    if (!existsSync(p)) continue;
    const r = spawnSync(p, ['-c', 'echo "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"'], { encoding: 'utf8' });
    const [maj, min] = (r.stdout ?? '').trim().split('.').map(Number) as [number, number];
    if (maj > 5 || (maj === 5 && min >= 1)) return { path: p };
  }
  return { why: 'no bash 5.1 or newer (readline with bracketed paste) at /bin, /usr/bin, /opt/homebrew/bin or /usr/local/bin' };
}

export const readJsonLines = (path: string): JsonObject[] => readText(path).split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as JsonObject);
export const fileText = (path: string): string => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };
