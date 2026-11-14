// Test-side tools for the #522 acceptance tests (README: The surface under test). They extend #2009's, #2010's and
// #1918's surface, imported read only through ../1918/helpers.ts: the same `deep-physics` binary (#2009's build, once
// per file), asked this suite's calls (`seek`, `view`, `frame`, `record`, `determinism`) and fields (`track`, a world's
// `inputs`, a bake's `ring`) and run under this suite's `--planted` twins, one process at a time or, for a live view,
// one process a test drives line by line; `deep-show run` (#1918's scenario helpers) built with this suite's cargo
// features, for the seal, documents, a test canvas module's inputs and the conformance kit's late-entry part (#138's
// `kit` call, ../138/helpers.ts). Nothing here stands in for the physics module: every hash, key, state, row, frame,
// verdict, ring and refusal read here is the program's own; the expected values come from the issue's text, computed
// here, and from the program's own straight runs of the same world and track.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect } from 'vitest';
import {
  REPO, TARGET, TIMEOUT, arr, ballAndGoal, box, cargoError, dynamic, floor, isObject, num, obj, physics, physicsBin, rowText, rowsOf,
  show, sphere, statesOf, str, world, type JsonObject, type JsonValue, type PhysicsPlanted, type Row, type State,
} from '../1918/helpers.ts';

export * from '../1918/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = {
  1: '#522.e8dd3a56',
  2: '#522.07ad2783',
  3: '#522.80128e91',
  4: '#522.ef486477',
  5: '#522.cc560b9c',
  6: '#522.ab65f8d2',
  7: '#522.5a2c866e',
  8: '#522.dfeb8487',
  9: '#522.c32bed6d',
} as const;

/** A body's canonical fields in canonical order (Checkpoint ring: `hash`), as #2010's reports name them. */
export const FIELDS = [
  'pos.x', 'pos.y', 'pos.z', 'rot.x', 'rot.y', 'rot.z', 'rot.w', 'linear.x', 'linear.y', 'linear.z', 'angular.x', 'angular.y', 'angular.z',
] as const;
/** The render worker's CPU a frame (Render worker; the budget class's 4 ms of frame CPU). */
export const FRAME_CPU_NS = 4_000_000;
/** The UI thread's bound a frame (Render worker: Cost). */
export const UI_NS = 2_000_000;
/** A seek that never lands stops here, failing, rather than looping. */
export const FRAME_CAP = 20_000;

/** A test that can't be judged on this machine fails with this, never passes (invariant 2). */
export function inconclusive(why: string): never {
  throw Error(`INCONCLUSIVE: ${why}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// `deep-physics` under this suite's planted twins (README: Planted twins), through #1918's runner.

export type Planted =
  | 'checkpoint_poses_only' | 'fork_on_scrub' | 'restore_keeps_replaced_occurrences' | 'late_entry_forks'
  | 'ring_drops_oldest' | 'restore_without_warm_start' | 'simulate_runs_all_steps';
export interface Run { planted?: Planted; where?: string }
/** Runs `calls` through one deep-physics process: exit 0, one JSON reply per call, in order. */
export function ask(calls: JsonObject[], o: Run = {}): JsonObject[] {
  return physics(calls, {
    ...(o.planted ? { planted: o.planted as unknown as PhysicsPlanted } : {}),
    ...(o.where ? { where: o.where } : {}),
  });
}

/** One deep-physics process the test drives line by line (a live view's frames): stopped by its own PID. */
export interface Live { call: (c: JsonObject) => Promise<JsonObject>; stop: () => void }
export function live(planted?: Planted): Live {
  const args = planted ? ['--planted', planted] : [];
  const child: ChildProcessWithoutNullStreams = spawn(physicsBin(), args, { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  let stderr = '';
  const waiting: ((line: string) => void)[] = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d: string) => {
    buffer += d;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      waiting.shift()?.(line);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => { stderr += d; });
  child.stdin.on('error', () => {});
  if (child.pid === undefined) throw Error('deep-physics didn\'t start');
  const pid = child.pid;
  const exited = new Promise<string>((res) => child.once('exit', (code) => res(`{"ok":false,"code":"exited","status":${code ?? 'null'},"stderr":${JSON.stringify(stderr.slice(-1500))}}`)));
  return {
    call: async (c) => {
      const got = new Promise<string>((res) => waiting.push(res));
      child.stdin.write(`${JSON.stringify(c)}\n`);
      const text = await Promise.race([got, exited]);
      let parsed: JsonValue;
      try { parsed = JSON.parse(text) as JsonValue; } catch { parsed = text; }
      return obj(parsed, `deep-physics${args.length ? ` ${args.join(' ')}` : ''}'s reply to ${show(c).slice(0, 160)}`);
    },
    stop: () => { if (child.exitCode === null) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } } },
  };
}

// ---------------------------------------------------------------------------------------------------
// The input track (README: Entries and `track`). An entry stamped `step: k` applies at the start of the step from the
// state after k steps to the state after k + 1: it first shows in `step_hashes[k + 1]`, and the checkpoint at step k
// (the state after k steps, #2009's) holds the state before it applies.

export type V3 = [number, number, number];
export const entry = (step: number, kind: string, target: string, data?: JsonObject): JsonObject =>
  ({ step, kind, target, ...(data ? { data } : {}) });
export const grabAt = (step: number): JsonObject => entry(step, 'grab', 'ball', { point: [0, 0, 0], plane: 'ground' });
export const releaseAt = (step: number): JsonObject => entry(step, 'release', 'ball', { keeps_velocity: true });
export const pokeAt = (step: number, push: V3, target = 'ball'): JsonObject => entry(step, 'poke', target, { push });
export const launchAt = (step: number, linear: V3, target = 'ball'): JsonObject => entry(step, 'launch', target, { linear });
/** An entry as text, for messages. */
export const entryText = (e: JsonValue | undefined): string => {
  const o = isObject(e) ? e : {};
  return `${String(o['kind'])} of ${String(o['target'])} at step ${String(o['step'])}`;
};

// ---------------------------------------------------------------------------------------------------
// Worlds. Fields are #2009's (its README: The world document); `inputs` and `checkpoint.budget` this suite's.

const MATERIALS: JsonObject = {
  crate: { friction: 0.6, restitution: 0, density: 500 },
  ground: { friction: 0.6, restitution: 0, density: 1000 },
  rubber: { friction: 0.5, restitution: 0, density: 1000 },
};
const HALF = 0.25;
const GAP = 0.002;
const pad = (n: number): string => String(n).padStart(2, '0');
/**
 * A resting stack: nx × ny × nz boxes 0.5 m on a side on a floor whose top is y = 0, each layer resting on the one
 * below (the lowest on the floor), 2 mm apart sideways, so nothing falls and every box is in contact from its first step.
 */
export function stack(nx: number, ny: number, nz: number, parts: JsonObject = {}): JsonObject {
  const bodies: JsonObject = { floor: floor('ground') };
  const pitch = 2 * HALF + GAP;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    bodies[`box_${pad(i)}_${pad(j)}_${pad(k)}`] = dynamic('crate', 'crate', [(i - (nx - 1) / 2) * pitch, HALF + 2 * HALF * j, (k - (nz - 1) / 2) * pitch]);
  }
  const n = nx * ny * nz;
  return world({
    capacity: { bodies: n + 1, shapes: n + 1, joints: 0, contacts: 16 * n, particles: 0 },
    contact_materials: MATERIALS,
    shapes: { floor: box([30, 0.1, 30]), crate: box([HALF, HALF, HALF]) },
    bodies,
    checkpoint: { every: 60 },
    ...parts,
  });
}

/** The ball-and-goal lab's inputs: a grab of the ball and its release (Input track entries' kinds and defaults). */
export const LAB_INPUTS: JsonObject = {
  grab: { kind: 'grab', targets: ['ball'], point: [0, 0, 0], plane: 'ground' },
  release: { kind: 'release', targets: ['ball'], keeps_velocity: true },
};
/** #2010's ball-and-goal lab (../2010/helpers.ts), taking a grab and a release of its ball, a checkpoint every 60 steps. */
export function lab(): JsonObject {
  return { ...ballAndGoal(), checkpoint: { every: 60 }, inputs: LAB_INPUTS };
}
/** 10 s at 120 Hz: the lab's run in criteria 4 and 8. */
export const LAB_STEPS = 1200;
/** The steps of the eight recorded grabs; each is released 24 steps (0.2 s) later. */
export const GRAB_STEPS = [60, 180, 300, 420, 540, 660, 780, 900] as const;
export const EIGHT_GRABS: JsonObject[] = GRAB_STEPS.flatMap((g) => [grabAt(g), releaseAt(g + 24)]);

/**
 * Criterion 5's drop: a 0.1 m ball of 1 kg at rest with its centre `DROP_Y` m above a floor whose top is y = 0, which it
 * first touches at step 250, taking pokes. Checked at the base (README): from 21.08 m to 21.26 m up its first
 * contact_begin with the floor is at step 250 (21.07 m: 249; 21.27 m: 251); 21.16 m is the middle.
 */
export const DROP_Y = 21.16;
export function drop(): JsonObject {
  return world({
    contact_materials: MATERIALS,
    shapes: { floor: box([30, 0.1, 30]), ball: sphere(0.1) },
    bodies: { floor: floor('ground'), ball: dynamic('ball', 'rubber', [0, DROP_Y, 0], { mass: 1 }) },
    inputs: { poke: { kind: 'poke', targets: ['ball'] } },
    checkpoint: { every: 60 },
  });
}

// ---------------------------------------------------------------------------------------------------
// Calls (README: deep-physics, what this suite adds)

export const bakeCall = (w: JsonObject, track: JsonObject[], steps: number, extra: JsonObject = {}): JsonObject => ({ call: 'bake', world: w, track, steps, ...extra });
export const seekCall = (w: JsonObject, track: JsonObject[], steps: number, store: string, to: number, play = 0): JsonObject =>
  ({ call: 'seek', world: w, track, steps, store, to, play });
export const viewCall = (w: JsonObject, track: JsonObject[], span: number, store?: string): JsonObject =>
  ({ call: 'view', world: w, track, span, ...(store ? { store } : {}) });
export interface Act { seek?: number; scrub?: number; input?: JsonObject; late?: JsonObject }
export const frameCall = (session: string, act: Act = {}): JsonObject => ({ call: 'frame', session, ...(act as JsonObject) });
export const recordCall = (session: string): JsonObject => ({ call: 'record', session });
export const determinismCall = (w: JsonObject, track: JsonObject[], steps: number, atTimes: number[]): JsonObject =>
  ({ call: 'determinism', world: w, track, steps, at_times: atTimes });

// ---------------------------------------------------------------------------------------------------
// Reading replies

const HEX16 = /^[0-9a-f]{16}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const int = (v: JsonValue | undefined, what: string): number => {
  expect(Number.isSafeInteger(v), `${what} is a whole number, got ${show(v)}`).toBe(true);
  return v as number;
};
const intOrNull = (v: JsonValue | undefined, what: string): number | null => (v === null || v === undefined ? null : int(v, what));
const hashes = (v: JsonValue | undefined, what: string): string[] => arr(v, what).map((h, i) => {
  expect(typeof h === 'string' && HEX16.test(h), `${what}[${i}] is a u64 as 16 hex, got ${show(h)}`).toBe(true);
  return h as string;
});

/** A bake's step hashes, any count (index k: the state after k steps). */
export function hashesOf(reply: JsonObject | undefined, what: string): string[] {
  expect(reply?.['ok'], `${what} answers ok: ${show(reply)}`).toBe(true);
  return hashes(reply!['step_hashes'], `${what}: step_hashes`);
}
/** The first index at or after `from` where two lists of step hashes differ (by position), or null. */
export function firstDiffering(a: readonly string[], b: readonly string[], from = 0): number | null {
  for (let k = from; k < Math.max(a.length, b.length); k++) if (a[k] !== b[k]) return k;
  return null;
}

export interface Seek { key: string; from: number; hashes: string[]; bodies: Record<string, State[]>; raw: JsonObject }
/** A `seek` reply: from, its step hashes and states from index `from` through the seek's last. */
export function seekOf(reply: JsonObject | undefined, count: number, what: string): Seek {
  expect(reply?.['ok'], `${what}: the seek ran (ok: true): ${show(reply)}`).toBe(true);
  const key = str(reply!['key'], `${what}: key`);
  expect(key, `${what}: key is a sha256`).toMatch(HEX64);
  const from = int(reply!['from'], `${what}: from`);
  const h = hashes(reply!['step_hashes'], `${what}: step_hashes`);
  expect(h.length, `${what}: step_hashes holds ${count} hashes, from the restored state on`).toBe(count);
  const bodies: Record<string, State[]> = {};
  for (const id of Object.keys(obj(reply!['bodies'], `${what}: bodies`))) bodies[id] = statesOf(reply!, id, count, what);
  return { key, from, hashes: h, bodies, raw: reply! };
}
/** A bake's states of every body, by ID (index k: the state after k steps). */
export function allStates(reply: JsonObject, count: number, what: string): Record<string, State[]> {
  const out: Record<string, State[]> = {};
  for (const id of Object.keys(obj(reply['bodies'], `${what}: bodies`))) out[id] = statesOf(reply, id, count, what);
  return out;
}
/** A state's value of one canonical field (FIELDS' order: pose, then velocity; angular as the state reads it). */
const fieldOf = (s: State, field: string): number => {
  const [part, axis] = field.split('.') as [string, string];
  const i = ['x', 'y', 'z', 'w'].indexOf(axis);
  const v = part === 'pos' ? s.pos : part === 'rot' ? s.rot : part === 'linear' ? s.linear : s.angular;
  return v[i]!;
};
/**
 * Where a run's states first differ from a straight run's: the first step k (from `from`) at which any body's state
 * differs, and at it the first body by ID and the first field in canonical order. Names them, or null when none does.
 */
export function firstStateDifference(straight: Record<string, State[]>, other: Record<string, State[]>, from: number, offset: number): string | null {
  const ids = Object.keys(straight).sort();
  const n = Math.max(...ids.map((id) => (other[id]?.length ?? 0)));
  for (let i = 0; i < n; i++) {
    const k = offset + i;
    if (k < from) continue;
    for (const id of ids) {
      const a = straight[id]?.[k];
      const b = other[id]?.[i];
      if (!a || !b) return `step ${k}: ${id} has no state in ${a ? 'the seek' : 'the straight run'}`;
      for (const field of FIELDS) {
        const [x, y] = [fieldOf(a, field), fieldOf(b, field)];
        if (!Object.is(x, y)) return `step ${k}: ${id} ${field} is ${y} after the seek and ${x} in the straight run`;
      }
    }
  }
  return null;
}

/** A bake's checkpoint ring (README: `ring`), and the checkpoints it keeps. */
export interface Ring { every: number; budget: number; bytes: number; peak: number }
export function ringOf(reply: JsonObject | undefined, what: string): Ring {
  expect(reply?.['ok'], `${what} is baked: ${show(reply)}`).toBe(true);
  const r = obj(reply!['ring'], `${what}: ring (the checkpoint ring as the bake leaves it)`);
  return { every: int(r['every'], `${what}: ring.every`), budget: int(r['budget'], `${what}: ring.budget`), bytes: int(r['bytes'], `${what}: ring.bytes`), peak: int(r['peak'], `${what}: ring.peak`) };
}
export interface Kept { step: number; deepHash: string; bytes: number }
export function checkpointsOf(reply: JsonObject | undefined, what: string): Kept[] {
  expect(reply?.['ok'], `${what} is baked: ${show(reply)}`).toBe(true);
  return arr(reply!['checkpoints'], `${what}: checkpoints`).map((c, i) => {
    const o = obj(c, `${what}: checkpoints[${i}]`);
    const deepHash = str(o['deep_hash'], `${what}: checkpoints[${i}].deep_hash`);
    expect(deepHash, `${what}: checkpoints[${i}].deep_hash is a u64 as 16 hex (Checkpoint ring: deep_hash: u64)`).toMatch(HEX16);
    return { step: int(o['step'], `${what}: checkpoints[${i}].step`), deepHash, bytes: Buffer.from(str(o['state'], `${what}: checkpoints[${i}].state`), 'base64').length };
  });
}

/** One live or baked frame (README: `frame`). */
export interface Frame {
  frame: number; t: number; want: number; at: number; stale: boolean; steps: number; evalNs: number; uiNs: number;
  stepHash: string; key: string; trackHash: string; track: JsonObject[]; stamped: JsonObject | null; forkAt: number | null;
  dropped: JsonObject[]; restored: number | null; raw: JsonObject;
}
export function frameOf(reply: JsonObject | undefined, what: string): Frame {
  expect(reply?.['ok'], `${what} ran (ok: true): ${show(reply)}`).toBe(true);
  const r = reply!;
  const stepHash = str(r['step_hash'], `${what}.step_hash`);
  expect(stepHash, `${what}.step_hash is a u64 as 16 hex`).toMatch(HEX16);
  const key = str(r['key'], `${what}.key`);
  expect(key, `${what}.key is a sha256`).toMatch(HEX64);
  expect(typeof r['stale'], `${what}.stale is a bool`).toBe('boolean');
  return {
    frame: int(r['frame'], `${what}.frame`), t: int(r['t'], `${what}.t`), want: int(r['want'], `${what}.want`), at: int(r['at'], `${what}.at`),
    stale: r['stale'] as boolean, steps: int(r['steps'], `${what}.steps`), evalNs: num(r['eval_ns'], `${what}.eval_ns`), uiNs: num(r['ui_ns'], `${what}.ui_ns`),
    stepHash, key, trackHash: str(r['track_hash'], `${what}.track_hash`),
    track: arr(r['track'], `${what}.track`).map((e, i) => obj(e, `${what}.track[${i}]`)),
    stamped: r['stamped'] === null || r['stamped'] === undefined ? null : obj(r['stamped'], `${what}.stamped`),
    forkAt: intOrNull(r['fork_at'], `${what}.fork_at`),
    dropped: arr(r['dropped'] ?? [], `${what}.dropped`).map((e, i) => obj(e, `${what}.dropped[${i}]`)),
    restored: intOrNull(r['restored'], `${what}.restored`),
    raw: r,
  };
}
/** A view's opening reply. */
export interface Opened { session: string; key: string; baked: boolean; trackHash: string; track: JsonObject[] }
export function openedOf(reply: JsonObject | undefined, what: string): Opened {
  expect(reply?.['ok'], `${what}: the view opened (ok: true): ${show(reply)}`).toBe(true);
  const r = reply!;
  expect(typeof r['baked'], `${what}.baked is a bool`).toBe('boolean');
  return {
    session: str(r['session'], `${what}.session`), key: str(r['key'], `${what}.key`), baked: r['baked'] as boolean,
    trackHash: str(r['track_hash'], `${what}.track_hash`), track: arr(r['track'], `${what}.track`).map((e, i) => obj(e, `${what}.track[${i}]`)),
  };
}
/** A session's frames, driven one call at a time. */
export class Session {
  readonly frames: Frame[] = [];
  constructor(readonly l: Live, readonly id: string) {}
  async frame(act: Act = {}): Promise<Frame> {
    const f = frameOf(await this.l.call(frameCall(this.id, act)), `frame ${this.frames.length + 1}`);
    this.frames.push(f);
    return f;
  }
  /** Frames with no new act until one isn't stale (or `until` holds, or the cap): that frame, or null at the cap. */
  async land(first: Frame, until: (f: Frame) => boolean = () => false): Promise<Frame | null> {
    let f = first;
    for (let n = 0; f.stale && n < FRAME_CAP; n++) {
      if (until(f)) return f;
      f = await this.frame();
    }
    return f.stale ? null : f;
  }
}
/** Opens a view on `l` and returns its session. */
export async function open(l: Live, w: JsonObject, track: JsonObject[], span: number, store?: string): Promise<{ s: Session; opened: Opened }> {
  const opened = openedOf(await l.call(viewCall(w, track, span, store)), 'view');
  return { s: new Session(l, opened.session), opened };
}
/** A session's `record`: its step hashes from 0 through `at`, its occurrence list and its track. */
export interface Recorded { at: number; hashes: string[]; rows: Row[]; track: JsonObject[] }
export function recordOf(reply: JsonObject | undefined, what: string): Recorded {
  expect(reply?.['ok'], `${what} answers ok: ${show(reply)}`).toBe(true);
  const at = int(reply!['at'], `${what}.at`);
  const h = hashes(reply!['step_hashes'], `${what}.step_hashes`);
  expect(h.length, `${what}: step_hashes holds the states 0 to ${at}`).toBe(at + 1);
  return { at, hashes: h, rows: rowsOf(reply, what), track: arr(reply!['track'], `${what}.track`).map((e, i) => obj(e, `${what}.track[${i}]`)) };
}

/** physics.determinism's reply (README: `determinism`). */
export interface DetFailure { run: string; from: number | null; at: number | null; input: string | null; step: number | null; field: string | null; raw: JsonObject }
export interface Determinism { verdict: string; failures: DetFailure[]; raw: JsonObject }
export function determinismOf(reply: JsonObject | undefined, what: string): Determinism {
  expect(reply?.['ok'], `${what}: the check ran (ok: true): ${show(reply)}`).toBe(true);
  expect(reply!['kind'], `${what}: the check kind`).toBe('physics.determinism');
  const verdict = str(reply!['verdict'], `${what}: verdict`);
  expect(['PASS', 'FAIL', 'BLOCKED'], `${what}: verdict is PASS, FAIL or BLOCKED`).toContain(verdict);
  const failures = arr(reply!['failures'], `${what}: failures`).map((f, i) => {
    const o = obj(f, `${what}: failures[${i}]`);
    const s = (k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null);
    return { run: s('run') ?? '', from: intOrNull(o['from'], `failures[${i}].from`), at: intOrNull(o['at'], `failures[${i}].at`), input: s('input'), step: intOrNull(o['step'], `failures[${i}].step`), field: s('field'), raw: o };
  });
  return { verdict, failures, raw: reply! };
}

/** A list of rows as text, for messages and comparisons. */
export const rowsText = (rows: readonly Row[]): string[] => rows.map(rowText);
/** Rows of `a` not in `b` (as text, multiset), in `a`'s order. */
export function extraRows(a: readonly Row[], b: readonly Row[]): Row[] {
  const left = new Map<string, number>();
  for (const r of b) left.set(rowText(r), (left.get(rowText(r)) ?? 0) + 1);
  return a.filter((r) => {
    const n = left.get(rowText(r)) ?? 0;
    if (n === 0) return true;
    left.set(rowText(r), n - 1);
    return false;
  });
}
/** The first contact_begin of the two IDs, or null. */
export const firstContact = (rows: readonly Row[], a: string, b: string): Row | null =>
  rows.find((r) => r.kind === 'contact_begin' && [r.a, r.b].sort().join() === [a, b].sort().join()) ?? null;

// ---------------------------------------------------------------------------------------------------
// Timing (criterion 9): the perf lane's rule, scripts/benchmark.mjs judgeLimit, read for the machine and the load
// alone (five zero readings against a limit of 1): PASS only on a reference Mac on mains power, Low Power Mode off,
// thermal state nominal, with the load at the start and end under the core count; otherwise INCONCLUSIVE with why.

export const load = (): number => loadavg()[0]!;
export async function standing(loads: { start: number; end: number }): Promise<{ status: string; reason: string }> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => unknown; judgeLimit: (o: unknown) => { status: string; reason?: string } };
  const r = bench.judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint: bench.fingerprint(), loads: Array.from({ length: 5 }, () => loads) });
  return { status: r.status, reason: r.reason ?? '' };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show` builds with this suite's cargo features (README: deep-show), each once per file, copied out.

interface Built { bin: string; error: string }
const shows = new Map<string, Built>();
const showDirs: string[] = [];
const featureList = (features: readonly string[]): string => features.join(',');
const showLine = (features: readonly string[]): string => `cargo build --locked -p deep-show --bin deep-show${features.length ? ` --features ${featureList(features)}` : ''}`;
function showBuild(features: readonly string[]): Built {
  const key = featureList(features);
  const known = shows.get(key);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-522-show-'));
  showDirs.push(dir);
  const out = { bin: join(dir, 'deep-show'), error: cargoError(['build', '--locked', '-p', 'deep-show', '--bin', 'deep-show', ...(features.length ? ['--features', key] : [])]) };
  if (out.error === '') copyFileSync(join(TARGET, 'debug', 'deep-show'), out.bin);
  shows.set(key, out);
  return out;
}
/** Builds each feature set before a file's tests (the slow part); each test then reports its own build's failure. */
export function prebuildShows(list: ReadonlyArray<readonly string[]>): void {
  beforeAll(() => { for (const f of list) showBuild(f); }, TIMEOUT * Math.max(1, list.length));
  afterAll(() => { for (const d of showDirs.splice(0)) rmSync(d, { recursive: true, force: true }); shows.clear(); });
}
/** A built deep-show; a test that asks for a build that failed fails, naming cargo's error. */
export function showWith(features: readonly string[]): string {
  const b = showBuild(features);
  expect(b.error, `deep-show builds (${showLine(features)})`).toBe('');
  return b.bin;
}

/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB0522D0${String(n).padStart(16, '0')}`;
/** An issue's own fields, not its prose, as text: whether one of them is `word` or names it as a whole word. */
export function names(issue: JsonObject, word: string): boolean {
  const re = new RegExp(`(^|[^A-Za-z0-9_.])${word.replace(/[.]/g, '\\.')}($|[^A-Za-z0-9_])`);
  return ['module', 'modules', 'ids', 'actual', 'path', 'what', 'code'].some((k) => {
    const v = issue[k];
    return v !== undefined && re.test(typeof v === 'string' ? v : JSON.stringify(v));
  });
}
/** A `deep_show` reply's issues. */
export function issuesIn(reply: JsonObject | undefined, what: string): JsonObject[] {
  return arr(reply?.['issues'] ?? [], `${what}: issues`).map((v, i) => obj(v, `${what}: issues[${i}]`));
}
