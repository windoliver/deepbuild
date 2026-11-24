// Test-side tools for the #2039 acceptance tests (README: The surface under test). JSON judging, PNG reading and
// writing, the look and `deep-canvas-render`'s driver come from ../467/helpers.ts by import; its raster lines and flat
// asset store from ../1653/helpers.ts; `deep-show run`'s driver and the evidence store from ../535/helpers.ts (all read
// only, as #2386's and #536's suites import them). This file adds the two builds with their BLOCKED gate, this suite's
// scenario for `deep-show run`, the fixture's two pictures as PNGs, and the perf lane's judge for the budget. The
// fixtures (fixtures.ts), the planted programs (planted.ts) and the judges (judges.ts) import no test runner. Nothing
// here stands in for the check or the renderer: every pixel, issue and batch read is the binary's own, and every
// expected value comes from the issue's text.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { LOOK, REPO, encodeRgbaPng, errorsOf, issuesOf, obj, render, shown, type Image, type Issue, type JsonObject, type JsonValue } from '../467/helpers.ts';
import { pngOf, presented, shownSnapshot } from '../535/helpers.ts';
import { ATLAS, atlasTexel, underTexel, type Box, type Pt } from './fixtures.ts';

export { REPO, describeErrors, none, num, shown, type Image, type Issue, type JsonObject, type JsonValue } from '../467/helpers.ts';
export { putAssets, rasterLine, rasterLines } from '../1653/helpers.ts';
export { failsNaming, framesOf, presented, putEvidence, runShow } from '../535/helpers.ts';

/** Each criterion's ID: `#2039.` + the first 8 hex digits of the SHA-256 of its text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #2039.31be1538',
  2: 'AC2 #2039.18a89663',
  3: 'AC3 #2039.87a8de22',
  4: 'AC4 #2039.2e193c48',
} as const;
/** Every test passes this explicit timeout: a spawned process can take tens of seconds to start on a loaded machine. */
export const TIMEOUT = 1_800_000;

/** A reading that can't count here fails with this, never passes (invariant 2). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** Runs `make` once per file, the first time a test asks: the tests of one clause share one run. */
export function once<T>(make: () => T): () => T {
  let done: { value: T } | null = null;
  return () => (done ??= { value: make() }).value;
}

// ---------------------------------------------------------------------------------------------------
// The builds: each binary built once per file and copied out of the target folder. No cargo is BLOCKED, never a pass.

export type Bin = 'deep-canvas-render' | 'deep-show';
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const copies: string[] = [];
afterAll(() => { for (const d of copies.splice(0)) rmSync(d, { recursive: true, force: true }); });

interface Built { path: string; blocked: string; error: string }
function build(bin: Bin, release: boolean): Built {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
    CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
    ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
  };
  const args = ['build', '--locked', ...(release ? ['--release'] : []), '--bin', bin];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return { path: '', error: '', blocked: `cargo could not run (${run.error.message}); this machine lacks the Rust toolchain` };
  if (run.status !== 0) {
    const said = run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(-4000);
    return { path: '', blocked: '', error: `cargo ${args.join(' ')} failed:\n${said}` };
  }
  const dir = mkdtempSync(join(tmpdir(), 'deep-2039-bin-'));
  copies.push(dir);
  copyFileSync(join(TARGET, release ? 'release' : 'debug', exe(bin)), join(dir, exe(bin)));
  return { path: join(dir, exe(bin)), blocked: '', error: '' };
}
function built(b: Built, what: string): string {
  if (b.blocked) expect.fail(`BLOCKED: ${b.blocked}; this is not a pass`);
  expect(b.error, `${what} builds`).toBe('');
  return b.path;
}
/** `bin` built once for this file (debug, the default features); the returned function gives its path, failing the test if it can't. */
export function useBin(bin: Bin): () => string {
  let b: Built = { path: '', blocked: '', error: 'the build did not run' };
  beforeAll(() => { b = build(bin, false); }, 3_600_000);
  return () => built(b, `${bin} (cargo build --locked --bin ${bin})`);
}
/** `bin`'s release build, made when a test asks: the budget's timing alone, on a machine that can judge it. */
export const releaseBin = (bin: Bin): string => built(build(bin, true), `${bin} (cargo build --locked --release --bin ${bin})`);

/** A fresh temporary folder per call, deleted after the test that asked. */
export function useTemp(): () => string {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-2039-')); dirs.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// The fixture's pictures as PNGs (fixtures.ts holds their texels)

/** The atlas: nine 24 × 24 px cells, the frame in the middle. */
export const atlasPng = (): Buffer => encodeRgbaPng(ATLAS[0], ATLAS[1], atlasTexel);
/** The picture under the first row, `size` px. */
export const underPng = (size: Pt): Buffer => encodeRgbaPng(size[0], size[1], underTexel);
/** A one-cell atlas `cell` px in one opaque color: what a check that reads no pixel needs. */
export const plainPng = (cell: Pt): Buffer => encodeRgbaPng(cell[0], cell[1], () => [96, 128, 64, 255]);

// ---------------------------------------------------------------------------------------------------
// `deep-canvas-render check`: the document check, one line a document, every platform (#373; ../467/helpers.ts `render`).

/** One document's answer: whether it passed, and its error issues (what judges.ts reads as `Checked`). */
export interface Answer { ok: boolean; errors: Issue[] }
/** Each of `docs` through one `check` process, with the asset store: whether it passed, and its error issues. */
export function checked(bin: string, docs: JsonObject[], store: string): Answer[] {
  return render(bin, 'check', docs.map((doc) => ({ doc, look: LOOK, store }))).map((answer, i) => {
    expect(typeof answer['ok'], `check answers document ${i} with ok: ${shown(answer)}`).toBe('boolean');
    return { ok: answer['ok'] === true, errors: errorsOf(issuesOf(answer, 'check')) };
  });
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line on stdin, one answer `{ok, replies}` (../535/helpers.ts `runShow`).

export const SESSION = 'sess-2039';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-2039', name: 'Agent: nine-part frames', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }];
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB2039D${String(n).padStart(17, '0')}`;

/** A scenario: the agent's session, the process table, each document in a visible panel of its own (`p1`, `p2`, … in the order given, each `rect` in window px), and the calls. It names no `planted` value: this suite's wrong programs are test code. */
export function scenario(evidence: string, docs: string[], calls: JsonObject[], rect: Box = [0, 0, 800, 600]): JsonObject {
  const panels: JsonObject = {};
  const map: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect }; map[d] = { panel: `p${i + 1}` }; });
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs: map, calls };
}
/** The agent's `deep_show` of a whole document (#393), with its issues and, with `pixels`, a snapshot and `batches`. */
export const showCall = (doc: string, document: JsonObject, pixels = false): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc, document, include: pixels ? ['issues', 'pixels'] : ['issues'] });
/** `frames` (#387): `count` frames of the live session one 60 fps frame apart from 0, each with its `frame_ms`. */
export const framesCall = (doc: string, count: number, pixels = false): JsonObject => ({ call: 'frames', doc, count, step: '1f', pixels });
/** A `deep_show` reply that presented its document, and its snapshot: the picture at the document's own size, which through the film's camera is the page at zoom 1 and scale factor 1. */
export function snapshotOf(evidence: string, reply: JsonObject, what: string): Image {
  presented(reply, what);
  return pngOf(evidence, shownSnapshot(reply, what), `${what}: its snapshot`);
}

// ---------------------------------------------------------------------------------------------------
// The budget: the perf lane's own judge (scripts/benchmark.mjs), run in a child process, as #2386's suite reads it.

/** Runs scripts/benchmark.mjs in a child process (its `fingerprint`, `judgeLimit` and `validateBudgets`). */
export function lane(code: string, input: JsonValue = null): JsonValue {
  const script = `import * as b from ${JSON.stringify(join(REPO, 'scripts', 'benchmark.mjs'))};\nconst input = JSON.parse(process.argv[1]);\nconst out = await (async () => { ${code} })();\nprocess.stdout.write(JSON.stringify(out ?? null));`;
  // deadline: the ten minutes only bound the wait for the lane's judge, which reads the machine and answers.
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(input)], { cwd: REPO, encoding: 'utf8', timeout: 600_000 });
  expect(r.status, `scripts/benchmark.mjs ran: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  return JSON.parse(r.stdout) as JsonValue;
}
/** A run's one-minute load average, read at its start and at its end. */
export type Load = { start: number; end: number };
export const loadNow = (): number => loadavg()[0]!;
const judgeLimit = (limit: number, runs: number[], loads: Load[]): JsonObject =>
  obj(lane('return b.judgeLimit({ limit: input.limit, runs: input.runs, fingerprint: b.fingerprint(), loads: input.loads });', { limit, runs, loads }), 'judgeLimit');
/**
 * Why a timing can't count on this machine now, or '' when it can: the lane's judge on five empty readings with the
 * load read now, so the machine (a reference Mac, mains power, Low Power Mode off, thermal state nominal) and the load
 * are read as a run's would be.
 */
export function timingProblem(): string {
  const now = loadNow();
  const v = judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: 5 }, () => ({ start: now, end: now })));
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}
/** One limit judged by the lane's rule on five runs after a warm-up, each with its load: PASS passes, FAIL fails, anything else is INCONCLUSIVE. */
export function judge(name: string, limit: number, runs: number[], loads: Load[]): void {
  const v = judgeLimit(limit, runs, loads);
  const line = `${name}: ${String(v['status'])} ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit}, the load at each run's start and end ${loads.map((l) => `${l.start.toFixed(2)}-${l.end.toFixed(2)}`).join(', ')}${v['reason'] ? ` (${String(v['reason'])})` : ''}`;
  console.log(line);
  if (v['status'] === 'PASS') return;
  expect(v['status'], `FAIL: ${line}`).not.toBe('FAIL');
  inconclusive(line);
}
export const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
