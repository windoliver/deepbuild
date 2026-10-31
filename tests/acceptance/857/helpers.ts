// Test-side tools for the #857 acceptance tests: parallel nodes in a phase. They drive #387's `deep-show run`
// (its scenario, calls, documents and `eval` parsing are imported from tests/acceptance/387/helpers.ts) with
// what this issue adds (README: Surfaces this suite defines): the scenario's `threads` and `background`, the
// replies' `threads`, per-node `thread` and `frame_ms`, the registry's `thread_safe`, the planted programs and
// the `test-threads` canvas modules. Here: builds per feature set, debug or release; parsing of the new fields;
// the checks the planted programs must fail, each returning sentences that name what failed; and the
// reference-Mac gate with the design's judge for timing results. Nothing here stands in for the scheduler, its
// pool, its merge or the priority of a job's threads.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, type TestContext } from 'vitest';
import {
  REPO, SHOW_NAME, arr, byId, evaluated, nodeId, num, obj, str,
  type Evaluated, type JsonObject, type JsonValue, type Node,
} from '../387/helpers.ts';

export {
  DOC, FLICKS, REGISTRY, arr, board, byId, edit, evalCall, evaluated, framesCall, isObject, label, nodeId, num, obj, presented, rect, registry,
  requires, run, scenario, show, snapshotOf, sorted, str, useEvidence,
  type Evaluated, type JsonObject, type JsonValue, type Node, type Registry,
} from '../387/helpers.ts';

/** The thread counts the criteria name. */
export const THREAD_COUNTS = [1, 2, 4, 8] as const;
/** A work-product view's frame CPU limit (budget class table: work product, Frame CPU 4 ms). */
export const WORK_PRODUCT_CPU_MS = 4;
/** A work product's pool (the issue's scope: "work product and showpiece 4"). */
export const WORK_PRODUCT_THREADS = 4;
/** The scheduler's own thread, as a node's `thread` names it. */
export const SCHEDULER_THREAD = 0;

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-show` per Cargo feature set and profile, built once per file, each kept under its own name.

/** This suite's test canvas modules (README: Surfaces this suite defines, The test canvas modules). */
export type TestFeature = 'test-threads';
export interface Build { set: 'full'; with?: TestFeature[]; release?: boolean }

const featuresOf = (build: Build): string[] => [build.set, ...(build.with ?? [])];
const buildName = (build: Build): string => [...featuresOf(build), build.release ? 'release' : 'debug'].join('+');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

function cargoBuild(build: Build): string {
  const args = ['build', '--locked', ...(build.release ? ['--release'] : []), '--bin', SHOW_NAME, '--no-default-features', '--features', featuresOf(build).join(',')];
  const done = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (done.error) return `cargo could not run: ${done.error.message}`;
  if (done.status !== 0) return `cargo ${args.join(' ')} failed:\n${done.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished/.test(l)).join('\n')}`;
  return '';
}

export interface Builds { bin: (build: Build) => string }

/** Builds every listed set once, before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): Builds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-857-bins-'));
    for (const build of builds) {
      const name = buildName(build);
      if (made.has(name)) continue;
      const error = cargoBuild(build);
      const bin = join(dir, `${SHOW_NAME}-${name.replace(/[^a-z0-9+.-]/g, '_')}`);
      if (error === '') copyFileSync(join(REPO, 'target', build.release ? 'release' : 'debug', exe(SHOW_NAME)), bin);
      made.set(name, { bin, error });
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(build: Build): string {
      const entry = made.get(buildName(build));
      if (!entry) throw Error(`the file didn't list the build ${buildName(build)} in useBuilds`);
      expect(entry.error, `the binary builds: ${SHOW_NAME} ${build.release ? '--release ' : ''}with features ${featuresOf(build).join(',')}`).toBe('');
      return entry.bin;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// The scenario's new fields (README: Surfaces this suite defines)

/** A background job: a playtest batch of `replicas` copies of `document`, or a bake of `document`. */
export type Job = { job: 'playtest'; replicas: number; document: JsonObject } | { job: 'bake'; document: JsonObject };
export interface ParallelExtra { threads?: number | undefined; shuffle?: number | undefined; planted?: string | undefined; background?: Job[] | undefined }

/** `scenario` (#387's) with this suite's fields set on it. */
export function withExtra(sc: JsonObject, extra: ParallelExtra): JsonObject {
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) sc[k] = v as unknown as JsonValue;
  return sc;
}

// ---------------------------------------------------------------------------------------------------
// `eval` and `frames` replies, with this issue's fields

export interface ThreadedNode extends Node { thread: number | null }
export interface Threaded { e: Evaluated; threads: number; frame_ms: number; nodes: ThreadedNode[] }

/**
 * An `eval` reply that evaluated, with `threads` (the pool the frame ran on), `frame_ms` and each node's
 * `thread`: an integer from 0 (the scheduler's own thread) to `threads` on a node that ran, null on one that
 * didn't.
 */
export function threaded(reply: JsonObject, what: string): Threaded {
  const e = evaluated(reply, what);
  const threads = num(reply['threads'], `${what}: threads`);
  expect(Number.isInteger(threads) && threads >= 1, `${what}: threads ${threads} is a pool size, a whole number from 1`).toBe(true);
  const frameMs = num(reply['frame_ms'], `${what}: frame_ms`);
  expect(frameMs, `${what}: frame_ms is a duration`).toBeGreaterThanOrEqual(0);
  const raw = arr(reply['nodes'], `${what}: nodes`);
  const nodes = e.nodes.map((n, i): ThreadedNode => {
    const t = obj(raw[i], `${what}: nodes[${i}]`)['thread'];
    if (n.run === 'ran') {
      expect(typeof t === 'number' && Number.isInteger(t) && t >= 0 && t <= threads, `${what}: ${nodeId(n)} ran, so it names the thread it ran on, 0 to ${threads}; got ${JSON.stringify(t)}`).toBe(true);
    } else {
      expect(t, `${what}: ${nodeId(n)} didn't run (${n.run}), so it names no thread`).toBeNull();
    }
    return { ...n, thread: t === null || t === undefined ? null : (t as number) };
  });
  return { e, threads, frame_ms: frameMs, nodes };
}

export interface FrameRow { t: number; ran: number; frame_ms: number }
export interface Progress { job: string; replica: number | null; frames: number }
export interface FramesReply { threads: number; frames: FrameRow[]; background: Progress[] }

/** A `frames` reply with `threads`, each frame's `frame_ms`, and each background job's progress during the call. */
export function framesOf(reply: JsonObject, what: string): FramesReply {
  const threads = num(reply['threads'], `${what}: threads`);
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i): FrameRow => {
    const f = obj(v, `${what}: frames[${i}]`);
    return { t: num(f['t'], `${what}: frames[${i}].t`), ran: num(f['ran'], `${what}: frames[${i}].ran`), frame_ms: num(f['frame_ms'], `${what}: frames[${i}].frame_ms`) };
  });
  const background = arr(reply['background'] ?? [], `${what}: background`).map((v, i): Progress => {
    const b = obj(v, `${what}: background[${i}]`);
    return { job: str(b['job'], `${what}: background[${i}].job`), replica: b['replica'] === undefined || b['replica'] === null ? null : num(b['replica'], `${what}: background[${i}].replica`), frames: num(b['frames'], `${what}: background[${i}].frames`) };
  });
  return { threads, frames, background };
}

// ---------------------------------------------------------------------------------------------------
// The checks

/**
 * Criterion 1: `other`'s frame against `base`'s (the frame at one thread), node by node in `base`'s order (the
 * plan's): every node is in both with the same key and the same write (`result`), and the frames raise the
 * same issues. The first node whose write differs is named first.
 */
export function frameFailures(base: Evaluated, other: Evaluated, what: string): string[] {
  const failures: string[] = [];
  const right = byId(other);
  const differing: string[] = [];
  for (const n of base.nodes) {
    const m = right.get(nodeId(n));
    if (!m) { failures.push(`${what}: node ${nodeId(n)} is missing`); continue; }
    if (m.key !== n.key) failures.push(`${what}: node ${nodeId(n)} has key ${n.key} at one thread and ${m.key} here`);
    if (m.result !== n.result) differing.push(nodeId(n));
  }
  const left = byId(base);
  for (const id of right.keys()) if (!left.has(id)) failures.push(`${what}: node ${id} isn't in the frame at one thread`);
  if (differing.length) failures.unshift(`${what}: the first node whose write differs is ${differing[0]} (${differing.length} nodes' writes differ)`);
  const issuesOf = (e: Evaluated): string[] => e.issues.map((i) => JSON.stringify(i, Object.keys(i).sort())).sort();
  if (JSON.stringify(issuesOf(base)) !== JSON.stringify(issuesOf(other))) failures.push(`${what}: the issues differ from the frame at one thread: ${JSON.stringify(other.issues).slice(0, 600)}`);
  return failures;
}

/** The operators of the nodes whose key or write differs between two frames. */
export function differingOperators(base: Evaluated, other: Evaluated): string[] {
  const right = byId(other);
  const out = new Set<string>();
  for (const n of base.nodes) {
    const m = right.get(nodeId(n));
    if (!m || m.key !== n.key || m.result !== n.result) out.add(n.operator);
  }
  return [...out].sort();
}

/** The frames over `limit` ms, each named by its index and time: what a frame budget's failure names. */
export function framesOver(frames: readonly FrameRow[], limit: number): string[] {
  return frames.flatMap((f, i) => (f.frame_ms > limit ? [`frame ${i} at t ${f.t} took ${f.frame_ms.toFixed(3)} ms`] : []));
}

export function p95(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
}
export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results.

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/**
 * Why this machine can't judge a timing, or null on a reference Mac. As #379's gate, power, Low Power Mode,
 * heat and load aren't gated (the owner's rule); they're printed beside each result as a reading.
 */
export function referenceMacProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  return null;
}
/** Power, Low Power Mode, heat and load, printed beside a timing result. */
export function machineReading(): string {
  const read = (cmd: string, ...args: string[]): string => { try { return sh(cmd, ...args).replace(/\s+/g, ' '); } catch { return 'unknown'; } };
  return `power: ${read('pmset', '-g', 'batt').split(';')[0]}; ${/lowpowermode\s+\d/.exec(read('pmset', '-g'))?.[0] ?? 'lowpowermode unknown'}; therm: ${read('pmset', '-g', 'therm')}; load: ${read('sysctl', '-n', 'vm.loadavg')}`;
}

const marginOf = (runs: readonly number[]): number => Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
const shownOf = (name: string, runs: readonly number[], limit: number, margin: number): string =>
  `${name}: ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%); ${machineReading()}`;

/** The design's rule: PASS when all five runs are within the limit; FAIL when all five are over it by more than the margin; else INCONCLUSIVE (a skip that says so, never a pass). */
export function judge(ctx: TestContext, name: string, runs: readonly number[], limit: number): void {
  expect(runs.length, `${name}: five runs`).toBe(5);
  const margin = marginOf(runs);
  const shown = shownOf(name, runs, limit, margin);
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}

/**
 * The same rule for a planted program that must push a timing past its limit: caught when all five runs are
 * over it by more than the margin; the test FAILS when all five are within it (the plant wasn't caught); else
 * INCONCLUSIVE.
 */
export function judgeOver(ctx: TestContext, name: string, runs: readonly number[], limit: number): void {
  expect(runs.length, `${name}: five runs`).toBe(5);
  const margin = marginOf(runs);
  const shown = shownOf(name, runs, limit, margin);
  console.log(shown);
  if (runs.every((r) => r > limit * (1 + margin))) return;
  expect(runs.every((r) => r <= limit), `FAIL (the planted program stayed within the limit) ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}

// ---------------------------------------------------------------------------------------------------
// Documents as an agent sends them

/** Every test document names its seed, so one document under two doc IDs keys the same (#387's rule). */
export const SEED_OF_DOCS = 857;
export const BOARD_SIZE: [number, number] = [320, 200];

/** A board of `items` (each with an `id`), with more envelope fields in `extra`. */
export function boardOf(title: string, items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, profile: 'board', seed: SEED_OF_DOCS, title,
    description: `${title}, drawn by a test agent through deep_show for the #857 acceptance tests.`,
    size: BOARD_SIZE, items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}

const ROLES = ['muted', 'ink', 'ground'] as const;
const pad = (i: number): string => String(i).padStart(5, '0');
/** A whole number spelled in letters (0 → a, 1 → b, …): a label shows no number without a source (`number_unsourced`). */
const word = (i: number): string => [...String(i)].map((d) => String.fromCharCode(97 + Number(d))).join("");
/** The big board's items: 10,000 on a 100 × 100 grid, every 20th a label, the rest rects. */
export const BIG_ITEMS = 10_000;
export const isLabelSlot = (i: number): boolean => i % 20 === 19;
export const bigId = (i: number): string => (isLabelSlot(i) ? `l${pad(i)}` : `r${pad(i)}`);

/**
 * The 10,000-item board in its `variant`: from one variant to the next every item changes (each rect moves a
 * quarter unit and changes its fill role; each label changes its text and moves), so a frame after a revision
 * from one variant to the next is a frame with every item changed.
 */
export function bigBoard(variant: number): JsonObject {
  const items: JsonObject[] = [];
  for (let i = 0; i < BIG_ITEMS; i++) {
    const x = (i % 100) * 3.2 + variant * 0.25;
    const y = Math.floor(i / 100) * 2;
    if (isLabelSlot(i)) {
      items.push({
        id: bigId(i), kind: 'text@1', name: `Label ${i}`, order: `a${pad(i)}`,
        params: { text: `Item ${word(i)}, version ${word(variant)}`, font: 'body', size: 9, box: { w: 60, h: 12 } }, at: { pos: [x, y + (variant % 2), 0] },
      });
    } else {
      items.push({ id: bigId(i), kind: 'rect@1', name: `Rect ${i}`, order: `a${pad(i)}`, params: { box: [x, y, 2.4, 1.5], paint: { fill: { role: ROLES[(i + variant) % 3]! } } } });
    }
  }
  return boardOf('Ten thousand items', items);
}

/** The big board in variant 0 with only `r00000` moved to `x`: a revision that changes one item. */
export function bigBoardOneMoved(x: number): JsonObject {
  const doc = bigBoard(0);
  const items = doc['items'] as JsonObject;
  const r0 = items['r00000'] as JsonObject;
  items['r00000'] = { ...r0, params: { ...(r0['params'] as JsonObject), box: [x, 0, 2.4, 1.5] } };
  return doc;
}

/**
 * A board in budget class `cls` (none when null): `moving` rects that each slide along x over its 60 s span (a
 * channel per rect, so every frame changes each of them), beside `still` rects and `labels` labels that don't
 * move. A board that names a live class must fit it by the check's estimate (#379: about 45 µs a moving rect,
 * 22 µs a still one, 32.5 µs a glyph shaped), or the check refuses it with `over_budget`.
 */
export function movingBoard(title: string, cls: string | null, moving: number, still: number, labels: number): JsonObject {
  const items: JsonObject[] = [];
  const channels: JsonObject = {};
  for (let i = 0; i < moving; i++) {
    const id = `m${pad(i)}`;
    items.push({ id, kind: 'rect@1', name: `Moving ${i}`, order: `b${pad(i)}`, params: { box: [0, 0, 3, 2], paint: { fill: { role: ROLES[i % 3]! } } }, at: { pos: [0, (i % 50) * 4, 0] } });
    channels[`slide-${id}`] = { target: `items/${id}/at/pos/0`, type: 'f32', keys: { k0: { t: '0s', value: (i % 7) * 4, interp: 'linear' }, k1: { t: '60s', value: 300 - (i % 7) * 4, interp: 'linear' } } };
  }
  for (let i = 0; i < still; i++) {
    items.push({ id: `s${pad(i)}`, kind: 'rect@1', name: `Still ${i}`, order: `a${pad(i)}`, params: { box: [(i % 100) * 3.2, Math.floor(i / 100) * 2, 2.4, 1.5], paint: { fill: { role: ROLES[i % 3]! } } } });
  }
  for (let i = 0; i < labels; i++) {
    items.push({ id: `t${pad(i)}`, kind: 'text@1', name: `Text ${i}`, order: `c${pad(i)}`, params: { text: `Part ${word(i)}`, font: 'body', size: 11, box: { w: 80, h: 14 } }, at: { pos: [(i % 4) * 80, Math.floor(i / 4) * 16 % 200, 0] } });
  }
  return boardOf(title, items, { ...(cls === null ? {} : { budget: { class: cls } }), transport: { span: '60s' }, channels });
}

/** `n` items of a `test-threads` kind (`test.serial@1` or `test.racy@1`), each a small box, added to `document` with its module required. */
export function withTestItems(document: JsonObject, module: 'test.serial' | 'test.racy', n: number): JsonObject {
  const out = JSON.parse(JSON.stringify(document)) as JsonObject;
  const items = out['items'] as JsonObject;
  for (let i = 0; i < n; i++) {
    const id = `${module.slice(5)}-${pad(i)}`;
    items[id] = { id, kind: `${module}@1`, name: `${module} ${i}`, order: `d${pad(i)}`, params: { box: [(i % 20) * 16, Math.floor(i / 20) * 10 % 200, 4 + (i % 5), 3] } };
  }
  const req = (out['requires'] ?? {}) as JsonObject;
  out['requires'] = { ...req, modules: { ...((req['modules'] ?? {}) as JsonObject), [module]: '^1' } };
  return out;
}

