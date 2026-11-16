// Test-side tools for the #1164 checkpoint (README: The surface under test). They build the merged hub `deep-show`
// (the `full` set), sandbox@1's runner `deep-sandbox` (#238) and this suite's Rust rules program (rules/, one build
// per wrong program), put the programs in the evidence store by hash, write the game's document, play it with keys in
// the app's world on the virtual clock, read the replies, and judge them by the issue's expected values. Nothing here
// stands in for the hub, the logic module, sandbox@1, deep_query or the checks: every hash, array, trap, verdict and
// picture read here is the implementation's own. Patterns are copied from #1162's, #539's, #548's and #531's suites,
// since suites don't import each other.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1164 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
const MIB = 1024 * 1024;

/** Every test passes this timeout (90 minutes): a first build of deep-show takes many minutes on a loaded Mac. */
export const TIMEOUT = 5_400_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first 8 hex digits of the SHA-256 of its text as the issue states it). */
export const AC = {
  1: 'AC1 #1164.29c6a1db',
  2: 'AC2 #1164.fb851e24',
  3: 'AC3 #1164.636499d1',
  4: 'AC4 #1164.bfcc143f',
  5: 'AC5 #1164.535ab8f5',
  6: 'AC6 #1164.9ffde386',
  7: 'AC7 #1164.6ccc5166',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and judging

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 800)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 800)}`).toBe(true);
  return v as JsonValue[];
}
export function int(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isSafeInteger(v), `${what} is an integer, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 800)}`).toBe('string');
  return v as string;
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A wrong program's run: the criterion's judgement fails it, and one failure starts with the criterion's ID and matches every one of `named`. */
export function failsNaming(failures: readonly string[], ac: string, named: RegExp[], what: string): void {
  expect(failures.length, `${what}: the criterion's judgement fails the wrong program, but it found nothing wrong`).toBeGreaterThan(0);
  expect(failures.some((f) => f.startsWith(ac) && named.every((n) => n.test(f))), `${what}: a failure starts with ${ac} and names ${named.join(' and ')}; the failures:\n  ${failures.slice(0, 20).join('\n  ')}`).toBe(true);
}
/** A test that can't be judged here fails with this, never passes (AGENTS.md, invariant 2). */
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
/** A host or tool this machine lacks: the test fails with this, never passes. */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };
/** A seeded generator (mulberry32), so a failing run replays. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The issue's Proof line: each test writes what it read under $TMPDIR/deep-1164-proof/, never read back. */
export const PROOF_DIR = join(tmpdir(), 'deep-1164-proof');
export function keepProof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

// ---------------------------------------------------------------------------------------------------
// Time

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000;
export const sec = (s: number): number => Math.round(s * FLICKS);
/** The step rate and length of `rules` (30 Hz: 23,520,000 flicks). */
export const STEP_RATE = 30;
export const STEP = FLICKS / STEP_RATE;
/** The first step at or after flick `t`. */
export const stepOf = (t: number): number => Math.ceil(t / STEP);
/** The steps a run reads: the transport's 12 s (README: Readings). */
export const STEPS = 12 * STEP_RATE;

// ---------------------------------------------------------------------------------------------------
// Builds: cargo with rustup's PATH, CARGO_INCREMENTAL=0 and CARGO_PROFILE_DEV_DEBUG=0 unless set.

function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${(run.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|was not used|patch/.test(l)).join('\n').slice(-6000)}`;
  return '';
}
let binsDir = '';
const dirOfBins = (): string => { if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-1164-bins-')); return binsDir; };
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built.clear(); });
const built = new Map<string, { bin: string; error: string }>();
const BINS = {
  'deep-show': ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'],
  'deep-sandbox': ['build', '--locked', '--bin', 'deep-sandbox'],
} as const;
/** A workspace binary built once per file in the checkout and copied out under its own name; a failed build fails the test using it. */
function binOf(name: keyof typeof BINS): string {
  let b = built.get(name);
  if (!b) {
    const bin = join(dirOfBins(), exe(name));
    const error = cargo([...BINS[name]], REPO);
    if (error === '') copyFileSync(join(TARGET, 'debug', exe(name)), bin);
    b = { bin, error };
    built.set(name, b);
  }
  if (/cargo could not run/.test(b.error)) blocked(`${b.error}: this machine lacks the Rust toolchain`);
  expect(b.error, `${name} builds (cargo ${BINS[name].join(' ')})`).toBe('');
  return b.bin;
}
export const showBin = (): string => binOf('deep-show');
export const sandboxBin = (): string => binOf('deep-sandbox');
/** Builds before a file's tests (the slow part), so each test's own time is its own and each reports its own failure. */
export function prebuild(fn: () => void): void { beforeAll(() => { try { fn(); } catch { /* each test reports its own build failure */ } }, TIMEOUT); }

/** The rules program (rules/) and its wrong programs, one cargo feature each (README: Planted wrong programs). */
export type Rules = 'rules' | 'imports_function' | 'takes_taken_cell' | 'loops_on_9';
export interface Program { name: Rules; bytes: Buffer; sha: string; b64: string }
const programs = new Map<Rules, Program | string>();
/** `cargo build --locked --release --target wasm32-unknown-unknown [--features f]` in rules/, into target/acceptance-1164-rules/<tag>/. */
export function program(name: Rules): Program {
  let p = programs.get(name);
  if (p === undefined) {
    const features = name === 'rules' ? [] : ['--features', name];
    const out = join(TARGET, 'acceptance-1164-rules', name);
    const error = cargo(['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', ...features], join(HERE, 'rules'), { CARGO_TARGET_DIR: out });
    const wasm = join(out, 'wasm32-unknown-unknown', 'release', 'acceptance_1164_rules.wasm');
    if (error === '' && existsSync(wasm)) {
      const bytes = readFileSync(wasm);
      p = { name, bytes, sha: sha256(bytes), b64: bytes.toString('base64') };
    } else {
      p = error || `cargo wrote no ${wasm}`;
    }
    programs.set(name, p);
  }
  if (typeof p === 'string') {
    if (/cargo could not run/.test(p)) blocked(`${p}: this machine lacks the Rust toolchain`);
    expect.fail(`BLOCKED: the rules program ${name} doesn't build: ${p}`);
  }
  return p as Program;
}

/** A fresh temporary folder per test (the evidence store), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1164-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
/** The evidence store (#15's layout: `<2 hex>/<62 hex>`, each file named by its bytes' SHA-256). */
export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}

// ---------------------------------------------------------------------------------------------------
// The world (#1162's): one test agent, its tool shell and the test process that runs `deep show`; one panel showing
// the document; the claim with the two logic checks.

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = ulid('01JB1164D', 1);
export const sameDoc = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const AGENT = { id: 'sess-game', thread: 'thread-game', name: 'Test agent: tic-tac-toe', process: { pid: 4100, start: 1_000 } };
const SESSIONS: JsonObject = { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: AGENT.process } };
/** The agent (4100), its tool shell (4101) and the test process that runs `deep show` (4102). */
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 },
  { pid: 4101, ppid: 4100, start: 1_100 }, { pid: 4102, ppid: 4101, start: 1_200 },
];
const IN_AGENT: JsonObject = { pid: 4102, start: 1_200 };
export const PANEL = 'main';
export const CLAIM = `claim:${ulid('01JB1164C', 1)}`;
export const REQ = { determinism: `req:${ulid('01JB1164Q', 1)}`, budget: `req:${ulid('01JB1164Q', 2)}` } as const;
/** The claim (#403's form): the game is the deliverable; logic.determinism and logic.budget are its requirements (Check input: logic kinds). */
const CLAIMS: JsonObject = {
  [CLAIM]: {
    session: AGENT.id, deliverables: [DOC],
    requirements: [
      { id: REQ.determinism, check: { kind: 'logic.determinism', at_times: ['1s', '2s', '3s', '4s', '5s', '6s', '7s', '7.5s'], compare: 'same_machine' } },
      { id: REQ.budget, check: { kind: 'logic.budget', fuel_share: 0.5, on: ['app'] } },
    ],
  },
};

// ---------------------------------------------------------------------------------------------------
// The document (README: The document): a 600 × 600 u figure, 12 s at 30 frames a second; the logic item `rules` at
// step_rate 30 reading nine press controls c1 to c9 on keys 1 to 9 and writing `board` and `winner`; nine cells, each
// an X path and an O path whose opacity a driver reads from the cell's entry in `rules.board`.

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #1164 acceptance tests.' };
export const SIZE: [number, number] = [600, 600];
export const FUEL = 1_000_000;
const centre = (cell: number): [number, number] => [100 + 200 * ((cell - 1) % 3), 100 + 200 * Math.floor((cell - 1) / 3)];
const xPath = ([x, y]: [number, number]): string => `M ${x - 60} ${y - 60} L ${x + 60} ${y + 60} M ${x - 60} ${y + 60} L ${x + 60} ${y - 60}`;
const oPath = ([x, y]: [number, number]): string => {
  const pts = Array.from({ length: 16 }, (_, i) => [x + 60 * Math.cos((i * Math.PI) / 8), y + 60 * Math.sin((i * Math.PI) / 8)].map((v) => Math.round(v * 100) / 100).join(' '));
  return `M ${pts[0]} ${pts.slice(1).map((p) => `L ${p}`).join(' ')} Z`;
};
/** The game as the agent sends it (no `id`, no `layers`, no item `layer`), its program by SHA-256. */
export function game(sha: string): JsonObject {
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [SIZE[0] / 2, SIZE[1] / 2, 0], view_width: SIZE[0] } },
    grid: { id: 'grid', kind: 'path@1', name: 'Grid', order: 'a1', params: { d: 'M 200 0 L 200 600 M 400 0 L 400 600 M 0 200 L 600 200 M 0 400 L 600 400', paint: { stroke: { role: 'ink', width: 6 } } } },
    rules: {
      id: 'rules', kind: 'logic@1', name: 'Rules', order: 'a9',
      params: {
        program: sha, step_rate: STEP_RATE, reads: CELLS.map((n) => `c${n}`),
        writes: { board: { type: 'i32', count: 9 }, winner: { type: 'i32' } }, budget: { fuel: FUEL },
      },
    },
  };
  const drivers: JsonObject = {};
  for (const n of CELLS) {
    items[`x${n}`] = { id: `x${n}`, kind: 'path@1', name: `X ${n}`, order: `b${n}`, params: { d: xPath(centre(n)), paint: { stroke: { role: 'ink', width: 12 } } }, adjust: { opacity: 0 } };
    items[`o${n}`] = { id: `o${n}`, kind: 'path@1', name: `O ${n}`, order: `c${n}`, params: { d: oPath(centre(n)), paint: { stroke: { role: 'accent', width: 12 } } }, adjust: { opacity: 0 } };
    drivers[`x${n}_shown`] = { target: `items/x${n}/adjust/opacity`, expr: 'max(0, 1 - abs(b - 1))', vars: { b: `rules.board[${n - 1}]` } };
    drivers[`o${n}_shown`] = { target: `items/o${n}/adjust/opacity`, expr: 'max(0, 1 - abs(b - 2))', vars: { b: `rules.board[${n - 1}]` } };
  }
  const controls: JsonObject = Object.fromEntries(CELLS.map((n) => [`c${n}`, { kind: 'press', class: 'document', label: `Cell ${n}`, role: 'button', keys: { [String(n)]: 1 } }]));
  return {
    format: 1, profile: 'figure', title: 'Tic-tac-toe', description: 'Hot-seat tic-tac-toe whose rules run as a logic item at 30 steps a second.',
    size: SIZE, seed: 1164, camera: 'cam', transport: { span: '12s', frame_rate: [30, 1] }, requires: { modules: { input: '^1', logic: '^1' } },
    controls, items, drivers, assets: { rules_program: { sha256: sha, license: LICENSE } },
  };
}
export const CELLS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

// ---------------------------------------------------------------------------------------------------
// The play (the issue's Scope): one key a second from 1 s, hot-seat. Each press's expected board and winner at its
// step; `same` marks a press that must change nothing.

export interface Press { key: string; s: number; who: 'X' | 'O'; board: number[]; winner: number; same?: 'taken' | 'after the end' }
export const PRESSES: Press[] = [
  { key: '1', s: 1, who: 'X', board: [1, 0, 0, 0, 0, 0, 0, 0, 0], winner: 0 },
  { key: '1', s: 2, who: 'O', board: [1, 0, 0, 0, 0, 0, 0, 0, 0], winner: 0, same: 'taken' },
  { key: '4', s: 3, who: 'O', board: [1, 0, 0, 2, 0, 0, 0, 0, 0], winner: 0 },
  { key: '2', s: 4, who: 'X', board: [1, 1, 0, 2, 0, 0, 0, 0, 0], winner: 0 },
  { key: '5', s: 5, who: 'O', board: [1, 1, 0, 2, 2, 0, 0, 0, 0], winner: 0 },
  { key: '3', s: 6, who: 'X', board: [1, 1, 1, 2, 2, 0, 0, 0, 0], winner: 1 },
  { key: '9', s: 7, who: 'O', board: [1, 1, 1, 2, 2, 0, 0, 0, 0], winner: 1, same: 'after the end' },
];
export const FINAL = [1, 1, 1, 2, 2, 0, 0, 0, 0];
export const pressName = (p: Press): string => `${p.who} ${p.key}${p.same ? ` (${p.same})` : ''} at ${p.s} s`;

// ---------------------------------------------------------------------------------------------------
// Calls (README: The surface under test). Every call carries `at`, in flicks on the scope's virtual clock.

export const showCall = (document: JsonObject, at: number): JsonObject =>
  ({ call: 'deep show', peer: IN_AGENT, doc: DOC, document, check: true, claim: CLAIM, include: ['issues'], at });
export const input = (at: number, event: JsonObject): JsonObject => ({ call: 'input', at, panel: PANEL, event });
export const keyCall = (key: string, at: number): JsonObject => input(at, { type: 'key', key });
/** A seek: the panel's playhead moved to `t` (#384's `playhead` control). */
export const seekCall = (t: number, at: number): JsonObject => input(at, { type: 'control', control: 'playhead', value: t });
/** README: `track` (chosen). With `load`, a fresh process replays a recorded track: the hub's track for the document becomes exactly these entries. */
export const trackCall = (at: number, load?: JsonValue[]): JsonObject => ({ call: 'track', doc: DOC, ...(load ? { load } : {}), at });
/** #539's `logic`, with #213's `seeks` and #548's `check`. */
export const logicCall = (at: number, o: { seeks?: number[]; check?: boolean; atTimes?: number[] } = {}): JsonObject => ({
  call: 'logic', doc: DOC, steps: STEPS, at,
  ...(o.seeks ? { seeks: o.seeks.map((to) => ({ to })) } : {}),
  ...(o.check ? { check: 'logic.determinism' } : {}), ...(o.atTimes ? { at_times: o.atTimes } : {}),
});
/** #548's deep_query logic read of `rules` at `steps`. */
export const queryCall = (at: number, steps: number[]): JsonObject => ({ call: 'deep_query', session: AGENT.id, doc: DOC, what: 'logic', items: ['rules'], steps, at });
/** Render-back of the document's own frame at `t` (#387's `eval` with pixels). */
export const evalCall = (t: number, at: number): JsonObject => ({ call: 'eval', doc: DOC, t, pixels: true, at });
/** #488's `determinism`: each time played to and seeked to, as frames. */
export const determinismCall = (times: number[], at: number): JsonObject => ({ call: 'determinism', doc: DOC, display_hz: 60, at_times: times, at });
export const verdictCall = (at: number): JsonObject => ({ call: 'verdict', claim: CLAIM, at });
export const revisionsCall = (at: number): JsonObject => ({ call: 'revisions', doc: DOC, at });

/** A scenario's `planted` (README: Planted wrong programs): one name, or several applied together (chosen). */
export type Planted = 'restore_zeroes_move_count' | 'check_compares_step_hashes';
/**
 * The app's world (#539's and #1162's): the scope's virtual clock and a display, the agent, the panel, the claim.
 * Headless (a fresh process replaying a recording) leaves out the clock and the display, and with them each call's
 * `at`, which only a clock reads (#393's scenarios without one take calls in order).
 */
export function scenario(evidence: string, calls: JsonObject[], o: { headless?: boolean; planted?: Planted[] } = {}): JsonObject {
  if (o.headless) calls = calls.map(({ at: _at, ...c }) => c);
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: { [PANEL]: { rect: [0, 0, SIZE[0], SIZE[1]] } }, docs: { [DOC]: { panel: PANEL } },
    claims: CLAIMS, ...(o.headless ? {} : { clock: { refresh_hz: 120, lead: 2 * MS, check: MS / 2 }, display: [1600, 900] }),
    ...(o.planted?.length ? { planted: o.planted.length === 1 ? o.planted[0]! : o.planted } : {}), calls,
  };
}
/** `deep-show run` on one scenario (#393): exit 0, one answer line, ok, one reply per call, in call order. */
export function runShow(sc: JsonObject, what: string): JsonObject[] {
  const tag = sc['planted'] ? `${what} (planted ${show(sc['planted'])})` : what;
  const r = spawnSync(showBin(), ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${tag}: deep-show run did not finish within its timeout`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${tag}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${tag}: one answer line`).toBe(1);
  let parsed: JsonValue;
  try { parsed = JSON.parse(lines[0]!) as JsonValue; } catch { parsed = lines[0]!; }
  const out = obj(parsed, `${tag}: the answer`);
  expect(out['ok'], `${tag}: deep-show run answers the scenario ok; got ${show(out)}`).toBe(true);
  const list = arr(out['replies'], `${tag}: replies`).map((x, i) => obj(x, `${tag}: replies[${i}]`));
  expect(list.length, `${tag}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return list;
}

/**
 * A script of one run's calls: the game presented by `deep show` at flick 2, then (with `play`) a click on the board at
 * 0.5 s, so the panel holds the keys, and one key a second from 1 s; then the reads, each a millisecond apart from 9 s.
 * Each method gives the index of its call's reply.
 */
export class Script {
  readonly calls: JsonObject[] = [];
  readonly presses: number[] = [];
  private t = sec(9);
  constructor(document: JsonObject, o: { play?: boolean } = {}) {
    this.calls.push(showCall(document, 2));
    if (o.play !== false) {
      this.calls.push(input(sec(0.5), { type: 'down', pos: [590, 590] }), input(sec(0.5) + 60 * MS, { type: 'up', pos: [590, 590] }));
      for (const p of PRESSES) { this.presses.push(this.calls.length); this.calls.push(keyCall(p.key, sec(p.s))); }
    }
  }
  /** The next call's `at`, a millisecond after the one before. */
  next(): number { this.t += MS; return this.t; }
  add(c: (at: number) => JsonObject): number { this.calls.push(c(this.next())); return this.calls.length - 1; }
}

// ---------------------------------------------------------------------------------------------------
// Reading replies

export interface Issue { code: string; severity: string; raw: JsonObject }
export const issuesOf = (reply: JsonObject): Issue[] =>
  (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject).map((i) => ({ code: String(i['code']), severity: String(i['severity']), raw: i }));
/** The issue names item `id`: its `ids` hold it, or its `path` is `items/<id>` or under it, or its own fields name it. */
export function namesItem(issue: JsonObject, id: string): boolean {
  const ids = Array.isArray(issue['ids']) ? issue['ids'].map(String) : [];
  const path = typeof issue['path'] === 'string' ? issue['path'] : '';
  return ids.includes(id) || path === `items/${id}` || path.startsWith(`items/${id}/`) || issue['item'] === id;
}
/** Every array named `key` anywhere inside `v`. */
export function findAll(v: JsonValue | undefined, key: string): JsonValue[] {
  if (Array.isArray(v)) return v.flatMap((x) => findAll(x, key));
  if (!isObject(v)) return [];
  return Object.entries(v).flatMap(([k, x]) => [...(k === key ? [x] : []), ...findAll(x, key)]);
}

export interface Entry { t: number; control: string; value: JsonValue; raw: JsonObject }
const entryOf = (v: JsonValue | undefined, what: string): Entry => {
  const o = obj(v, what);
  return { t: int(o['t'], `${what}.t`), control: str(o['control'], `${what}.control`), value: o['value'] ?? null, raw: o };
};
/** The one entry a key press appended (#504's `appended`). */
export function appendedOf(reply: JsonObject, what: string): Entry {
  const list = arr(reply['appended'] ?? null, `${what}: appended (${show(reply, 600)})`);
  expect(list.length, `${what}: the press appends exactly one entry to the input track: ${show(list)}`).toBe(1);
  return entryOf(list[0], `${what}: appended[0]`);
}
/** A played run's presentation (with no error) and each press's one entry, in the order played. */
export function playedOf(r: JsonObject[], s: Script, what: string): Entry[] {
  expect(r[0]!['outcome'], `${what}: the game is presented: ${show(r[0]!['issues'] ?? r[0], 1500)}`).toBe('presented');
  return s.presses.map((i, n) => {
    const e = appendedOf(r[i]!, `${what}: ${pressName(PRESSES[n]!)}`);
    expect(e.control, `${what}: key ${PRESSES[n]!.key} presses the control c${PRESSES[n]!.key}`).toBe(`c${PRESSES[n]!.key}`);
    return e;
  });
}
/** README: `track` (chosen): `{track: [Entry], hash, fork_at}`. */
export interface Track { entries: Entry[]; hash: string; forkAt: number | null; raw: JsonValue[] }
export function trackOf(reply: JsonObject, what: string): Track {
  expect(reply['code'], `${what}: the track call answers, not refuses: ${show(reply, 600)}`).toBeUndefined();
  const raw = arr(reply['track'] ?? null, `${what}: track`);
  const f = reply['fork_at'];
  expect(f === null || (typeof f === 'number' && Number.isSafeInteger(f)), `${what}: fork_at is a flick or null, got ${show(f)}`).toBe(true);
  return { entries: raw.map((e, i) => entryOf(e, `${what}: track[${i}]`)), hash: str(reply['hash'], `${what}: hash`), forkAt: f as number | null, raw };
}

/** `logic`'s reply (#539, #213, #548): each step's hash and arrays, each checkpoint's full-state hash, each seek. */
export interface StepRow { step: number; hash: string | null; arrays: Record<string, JsonValue> }
export interface Seek { to: number; from: number; steps: StepRow[]; checkpoint: { step: number; deep: string } | null }
export interface Logic { steps: StepRow[]; checkpoints: { step: number; deep: string }[]; seeks: Seek[]; check: JsonObject | null; raw: JsonObject }
const rowOf = (v: JsonValue | undefined, what: string): StepRow => {
  const o = obj(v, what);
  const h = isObject(o['hash']) ? o['hash']['rules'] : undefined;
  return { step: int(o['step'], `${what}.step`), hash: typeof h === 'string' ? h : null, arrays: isObject(o['arrays']) ? o['arrays'] : {} };
};
export function logicOf(reply: JsonObject, what: string): Logic {
  expect(reply['code'], `${what}: the logic call answers, not refuses: ${show(reply, 800)}`).toBeUndefined();
  const steps = arr(reply['steps'] ?? null, `${what}: steps`).map((s, i) => rowOf(s, `${what}: steps[${i}]`));
  const checkpoints = arr(obj(reply['checkpoints'] ?? null, `${what}: checkpoints`)['rules'] ?? null, `${what}: checkpoints.rules`).map((c, i) => {
    const o = obj(c, `${what}: checkpoints.rules[${i}]`);
    return { step: int(o['step'], `${what}: checkpoints.rules[${i}].step`), deep: str(o['deep_hash'], `${what}: checkpoints.rules[${i}].deep_hash`) };
  });
  const seeks = (Array.isArray(reply['seeks']) ? reply['seeks'] : []).map((s, i) => {
    const o = obj(s, `${what}: seeks[${i}]`);
    const c = isObject(o['checkpoint']) ? o['checkpoint'] : null;
    const deep = c && isObject(c['deep_hash']) ? c['deep_hash']['rules'] : undefined;
    return {
      to: int(o['to'], `${what}: seeks[${i}].to`), from: int(o['from'], `${what}: seeks[${i}].from`),
      steps: arr(o['steps'] ?? null, `${what}: seeks[${i}].steps (README: chosen)`).map((r, j) => rowOf(r, `${what}: seeks[${i}].steps[${j}]`)),
      checkpoint: c ? { step: int(c['step'], `${what}: seeks[${i}].checkpoint.step`), deep: str(deep, `${what}: seeks[${i}].checkpoint.deep_hash.rules`) } : null,
    };
  });
  return { steps, checkpoints, seeks, check: isObject(reply['check']) ? reply['check'] : null, raw: reply };
}

/** deep_query's logic read of `rules` (#548), with `hash` (chosen): the SHA-256 of the bytes the engine runs. */
export interface Read { hash: string | undefined; regionMap: JsonObject; steps: Map<number, { board: JsonValue; winner: JsonValue; fuel: number | null }>; trap: JsonObject | null }
export function readOf(reply: JsonObject, what: string): Read {
  expect(reply['code'] ?? reply['error'], `${what}: deep_query answers, not refuses: ${show(reply, 1200)}`).toBeUndefined();
  const it = obj(obj(reply['logic'] ?? null, `${what}: logic (${show(reply, 600)})`)['rules'], `${what}: logic.rules`);
  const steps = new Map<number, { board: JsonValue; winner: JsonValue; fuel: number | null }>();
  arr(it['steps'] ?? null, `${what}: logic.rules.steps`).forEach((s, i) => {
    const o = obj(s, `${what}: steps[${i}]`);
    const a = isObject(o['arrays']) ? o['arrays'] : {};
    steps.set(int(o['step'], `${what}: steps[${i}].step`), { board: a['rules.board'] ?? null, winner: a['rules.winner'] ?? null, fuel: typeof o['fuel'] === 'number' ? o['fuel'] : null });
  });
  return { hash: typeof it['hash'] === 'string' ? it['hash'] : undefined, regionMap: isObject(it['region_map']) ? it['region_map'] : {}, steps, trap: isObject(it['trap']) ? it['trap'] : null };
}
/** A scalar array read as one number: `[v]` or `v`. */
export const scalar = (v: JsonValue | undefined): JsonValue | undefined => (Array.isArray(v) && v.length === 1 ? v[0] : v);

/** The region map the program is built for (rules/src/lib.rs): c1 … c9 at 264 B apart from 0, `board` at 0, `winner` at 40. */
export function layoutFailures(map: JsonObject, ac: string): string[] {
  const entries = (Array.isArray(map['entries']) ? map['entries'] : []).filter(isObject);
  const at = (region: string, name: string): JsonValue | undefined => entries.find((e) => e['region'] === region && e['name'] === name)?.['offset'];
  const want: [string, string, number][] = [...CELLS.map((n): [string, string, number] => ['reads', `c${n}`, 264 * (n - 1)]), ['writes', 'board', 0], ['writes', 'winner', 40]];
  return want.filter(([r, n, o]) => at(r, n) !== o).map(([r, n, o]) => `${ac} the region map puts ${r} ${n} at ${show(at(r, n))}, not ${o} as the rules program reads it: ${show(map, 600)}`);
}

/** `render`'s snapshot: the PNG's SHA-256 (#387). */
export function snapshotOf(reply: JsonObject, what: string): string {
  const s = obj(arr(reply['snapshots'] ?? null, `${what}: snapshots (${show(reply, 600)})`)[0], `${what}: snapshots[0]`);
  return str(s['sha256'], `${what}: snapshots[0].sha256`);
}
/** The current revision's hash (#393's `revisions`). */
export function currentHash(reply: JsonObject, what: string): string {
  const now = arr(reply['revisions'] ?? null, `${what}: revisions`).filter(isObject).filter((r) => r['state'] === 'current');
  expect(now.length, `${what}: exactly one revision is current: ${show(reply['revisions'])}`).toBe(1);
  return str(now[0]!['hash'], `${what}: the current revision's hash`);
}
/** #403's verdict on the claim: its result, the revisions it is keyed to, each requirement's row. */
export interface Verdict { result: string; key: { doc: string; hash: string | undefined }[]; rows: Map<string, JsonObject>; raw: JsonObject }
export function verdictOf(reply: JsonObject, what: string): Verdict {
  const v = isObject(reply['verdict']) ? reply['verdict'] : reply;
  expect(v['code'], `${what}: the verdict call answers, not refuses: ${show(reply, 800)}`).toBeUndefined();
  const key =isObject(v['key']) && Array.isArray(v['key']['revisions']) ? v['key']['revisions'].filter(isObject) : [];
  const rows = new Map<string, JsonObject>();
  for (const r of (Array.isArray(v['requirements']) ? v['requirements'] : []).filter(isObject)) rows.set(String(r['id']), r);
  return { result: String(v['result']), key: key.map((k) => ({ doc: String(k['doc']), hash: typeof k['hash'] === 'string' ? k['hash'] : undefined })), rows, raw: v };
}
