// Test-side tools for the #1857 acceptance tests: the base's two binaries, each built once per file (`deep-show` in
// the `full` build set as #2015's suite builds it, `deep-gpu` as #149's does); every child run through `bounded.mjs`,
// under a deadline and a memory limit, stopped by PID when it passes either; the scenario `deep-show run` takes
// (#393, #306) with this suite's packs and `planted` values; boards, instances and the agent's `deep_show`; the
// `layers` call of `deep-gpu run` with a look passed inline (#149); the machine gate and the design's rule for a
// timing. The judges are in `judge.ts`. Nothing here stands in for the check, the expansion or the draw.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi, type TestContext } from 'vitest';
import { type Bounded, type JsonObject, type JsonValue, type Verdict } from './judge.ts';

// Vitest's 5 s default stays out, under any root: every test here starts a build or a bounded child.
vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1857 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');

/** No failures; the message lists them, each naming what failed. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that `is` what the criterion says a planted program fails by. */
export function failsBy(failures: readonly string[], is: (failure: string) => boolean, by: string, what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  expect(failures.some(is), `${what} fails by ${by}; the failures were:\n  ${failures.slice(0, 40).join('\n  ')}`).toBe(true);
}
/** The design file the issue links, read whole. */
export const design = (): string => readFileSync(join(REPO, 'docs', 'canvas-primitives.md'), 'utf8');
export const fixtureJson = (...parts: string[]): JsonValue => JSON.parse(readFileSync(join(FIXTURES, ...parts), 'utf8')) as JsonValue;

// ---------------------------------------------------------------------------------------------------
// The binaries: each built once per file and copied out of the target folder under its own name. Every argument is
// written out, so a run that builds test binaries ahead of its tests builds these (docs/parallel-proof.md, section 5).

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const SHOW_BUILD = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];
const GPU_BUILD = ['build', '--locked', '--bin', 'deep-gpu'];

function useBin(name: string, cargo: string[]): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1857-bin-'));
    const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
    const run = spawnSync('cargo', cargo, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo ${cargo.join(' ')} failed:\n${(run.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
    else copyFileSync(join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', exe(name)), join(dir, exe(name)));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `BLOCKED: the binary builds: cargo ${cargo.join(' ')}`).toBe('');
    return join(dir, exe(name));
  };
}
/** `deep-show` in the `full` build set. */
export const useShow = (): (() => string) => useBin('deep-show', SHOW_BUILD);
/** `deep-gpu`, the GPU layer's binary. */
export const useGpu = (): (() => string) => useBin('deep-gpu', GPU_BUILD);

/** A folder `name` under `dir`, made if it isn't there. */
export function sub(dir: string, name: string): string {
  const path = join(dir, name);
  mkdirSync(path, { recursive: true });
  return path;
}
/** A fresh temporary folder per test (the scenario's evidence store, a run's `out`, the runner's files), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1857-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// A bounded child (README: What bounds each child).

/** How a child is bounded: `answerMs` to answer its one line, `limitBytes` of resident memory, read by PID. */
export interface Limits { answerMs: number; limitBytes: number }
const GIB = 1024 * 1024 * 1024;
/** A `deep-show run` child given a board of one instance: the base's refuses a small board at about 120 MB resident. */
export const SHOW_LIMITS: Limits = { answerMs: 60_000, limitBytes: GIB };
/** The same for the board of 5,000 items and for the castle, which are checked whole. */
export const WHOLE_LIMITS: Limits = { answerMs: 300_000, limitBytes: 4 * GIB };
/** A `deep-gpu run` child, which opens the GPU before it reads its line. */
export const GPU_LIMITS: Limits = { answerMs: 120_000, limitBytes: 4 * GIB };
/** How often the limit is read. */
const SAMPLE_MS = 25;
/** How long a child has to end once its input is closed. */
const EXIT_MS = 15_000;

let runs = 0;
/**
 * One child of `bin` with `args`, given `line` on stdin, under `bounded.mjs`: at most `answerMs` to answer it and
 * `limitBytes` of resident memory, stopped by PID past either. The runner itself is one synchronous child of this
 * test, with a last deadline of its own. The runner's two files are written in `dir` and removed.
 */
export function bounded(dir: string, bin: string, args: string[], line: JsonValue, limits: Limits): Bounded {
  const spec = join(dir, `spec-${++runs}.json`);
  const result = join(dir, `result-${runs}.json`);
  const { answerMs } = limits;
  writeFileSync(spec, JSON.stringify({ command: bin, args, cwd: REPO, lines: [{ text: JSON.stringify(line), deadlineMs: answerMs }], exitMs: EXIT_MS, limitBytes: limits.limitBytes, sampleMs: SAMPLE_MS }));
  // deadline: the runner stops its child by itself; this only bounds the runner, well past every deadline it holds.
  const run = spawnSync(process.execPath, [join(HERE, 'bounded.mjs'), spec, result], { encoding: 'utf8', timeout: answerMs + EXIT_MS + 120_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
  let text = '';
  try { text = readFileSync(result, 'utf8'); } catch { /* the runner wrote nothing: reported below */ }
  expect(text, `BLOCKED: the runner bounded.mjs gave a result (exit ${run.status ?? 'none'}, ${run.signal ?? 'no signal'}): ${(run.stderr ?? '').slice(-1500)}`).not.toBe('');
  rmSync(spec, { force: true });
  rmSync(result, { force: true });
  return JSON.parse(text) as Bounded;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: the scenario (#393, #306), boards and the agent's `deep_show`.

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: caps', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
/** A document ID the hub minted. */
export const DOC = '01JB1857D00000000000000001';

/** A test pack of `fixtures/packs/`, `{id: owner/name, dir}` as the scenario's `packs` takes it (#306). */
export interface PackFixture { id: string; version: string; dir: string }
const pack = (name: string): PackFixture => ({ id: `test/${name}`, version: '1.0.0', dir: join(FIXTURES, 'packs', `test-${name}-1.0.0`) });
/** test/tower@1.0.0: criterion 1's four recipes (README: Fixtures). */
export const TOWER = pack('tower');
/** test/dial@1.0.0: criterion 2's recipes, whose repeat counts are the input `per_side`. */
export const DIAL = pack('dial');
/** test/weave@1.0.0: criterion 3's recipe, whose step param holds three `{repeat}` lists, one in the other. */
export const WEAVE = pack('weave');
/** test/rows@1.0.0: criterion 4's recipes, a step that repeats a nested recipe 1,024 times. */
export const ROWS = pack('rows');
export const packAt = (p: PackFixture): string => `${p.id}@${p.version}`;

/** Scenario `planted` values this suite adds, each a wrong program reachable only there (README: Planted programs). */
export type Planted = 'expansion_counts_after' | 'expansion_copies_items';

/** A scenario: its evidence store under `dir`, the agent's session, the process table, one panel for `DOC`, `packs` installed before the first call, an optional `planted`, and the calls. */
export function scenario(dir: string, packs: readonly PackFixture[], calls: JsonObject[], planted?: Planted): JsonObject {
  const out: JsonObject = {
    evidence: sub(dir, 'evidence'),
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { [DOC]: { panel: 'main' } },
    packs: packs.map((p) => ({ id: p.id, dir: p.dir })),
    calls,
  };
  if (planted) out['planted'] = planted;
  return out;
}

/** A plain 2D item, as #306's boards hold them. */
export const rect = (id: string, box: number[], order: string): JsonObject =>
  ({ id, kind: 'rect@1', name: id, order, params: { box, paint: { fill: { role: 'muted' } } } });
/** A recipe instance: its recipe's kind with the recipe's inputs as params. */
export const instance = (id: string, kind: string, params: JsonObject, order: string): JsonObject =>
  ({ id, kind, name: id, order, params, at: { pos: [40, 40, 0] } });
/** A board as an agent sends it: no `id`, no `layers`; `packs` names each pack version it uses. */
export function board(title: string, packs: readonly PackFixture[], items: JsonObject[]): JsonObject {
  return {
    format: 1, profile: 'board', title, description: `${title}, a board of the #1857 acceptance suite.`, size: [640, 360],
    packs: packs.map(packAt), items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
  };
}
/** The agent's `deep_show`: a whole revision of `document` with its issues and the check's own time (#393, #306). */
export const show = (document: JsonObject): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc: DOC, document, include: ['issues', 'timing'] });

/** #306's `packs` call: each pack version the store was offered, with its state. */
export const PACKS: JsonObject = { call: 'packs' };
/** One bounded `deep-show run` of one scenario. */
export const runShow = (dir: string, bin: string, sc: JsonObject, limits: Limits = SHOW_LIMITS): Bounded => bounded(dir, bin, ['run'], sc, limits);

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]` (#377) with a look@1 passed inline to `layers` (#149).

/** The GPU layer draws on macOS's Metal device; anywhere else a test that needs it ends INCONCLUSIVE, as a skip that says so, never a pass. */
export function requireMetal(ctx: TestContext): void {
  if (process.platform !== 'darwin') ctx.skip(`INCONCLUSIVE: deep-gpu checks and draws a look on macOS's Metal device, and this is ${process.platform}; this is not a pass`);
}
/** `--planted` values this suite adds (README: Planted programs). */
export type GpuPlanted = 'profile_admits_zero_breaks';
/** The suite's sound look: `fixtures/look.json`, a `basis: drawing` look@1, with `fields` over it. */
export const look = (fields: JsonObject): JsonObject => ({ ...(fixtureJson('look.json') as JsonObject), ...fields });
/** A figure of one writer layer `main` (as #149's figures). */
export function figure(id: string, size: readonly [number, number], items: JsonObject): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: id, description: `${id}: a #1857 acceptance figure.`, size: [...size], transport: { span: '4s' },
    requires: { modules: { effects: '^1' } }, budget: { class: 'figure' }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } }, items,
  };
}
/** One stroked path on `main`, drawn with the look's line `line`. */
export const stroked = (id: string, d: string, line: string): JsonObject =>
  ({ id, kind: 'path@1', layer: 'main', name: id, order: 'a0', params: { d, paint: { stroke: { role: 'ink', line } } } });
/** #385's `layers` call on the GPU layer, the look inline. */
export const layersCall = (doc: JsonObject, lk: JsonValue): JsonObject => ({ call: 'layers', doc, look: lk, by: ['gpu_layer'], float: true });
/** One bounded `deep-gpu run` of `calls`, its files written under `<dir>/out`. */
export function runGpu(dir: string, bin: string, calls: JsonObject[], planted?: GpuPlanted, limits: Limits = GPU_LIMITS): Bounded {
  return bounded(dir, bin, ['run', ...(planted ? ['--planted', planted] : [])], { out: sub(dir, 'out'), calls }, limits);
}

// ---------------------------------------------------------------------------------------------------
// The machine: where a time or a peak counts (The reference Macs), and how a verdict ends a test.

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
  { model: 'Mac17,10', chip: 'Apple M5 Max', gib: 64 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why a time or a peak read here is a reading and no result; null on a reference Mac fit to judge. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string; let chip: string; let gib: number; let power: string; let therm: string; let source: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
    source = sh('pmset', '-g', 'batt');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  if (!/Now drawing from 'AC Power'/.test(source)) return `not on mains power: ${source.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const [one] = loadavg();
  if (one! >= availableParallelism()) return `loaded to its core count or past it: 1-minute load ${one!.toFixed(1)} on ${availableParallelism()} cores`;
  return null;
}

/** Ends the test INCONCLUSIVE, as a skip that says so, where a time or a peak is only a reading; `left` says what was not judged. */
export function fitOrSkip(ctx: TestContext, left: string): void {
  const problem = environmentProblem();
  if (problem) ctx.skip(`INCONCLUSIVE (a reading only): ${problem}; ${left}; this is not a pass`);
}

/** Any FAIL fails the test; else any INCONCLUSIVE skips it as INCONCLUSIVE, never a pass; else it passes. */
export function settle(ctx: TestContext, verdicts: readonly Verdict[]): void {
  for (const v of verdicts) console.log(`${v.status} ${v.shown}`);
  expect(verdicts.filter((v) => v.status === 'FAIL').map((v) => v.shown), 'no limit is judged FAIL').toEqual([]);
  const open = verdicts.filter((v) => v.status === 'INCONCLUSIVE');
  if (open.length) ctx.skip(`INCONCLUSIVE ${open.map((v) => v.shown).join('; ')}; this is not a pass`);
}
