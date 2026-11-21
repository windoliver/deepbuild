// Test-side tools for the #189 lab acceptance tests, redrafted (README: The surface under test). They build `deep-show` in the
// full set and in this suite's two test builds of the physics implementation (#1920's mechanism: a test feature of
// deep-show), drive `deep-show run` (one scenario line in, one answer line out), write the lab's document with its
// logic program as WebAssembly bytes, and read the save files the app writes. Nothing here stands in for the logic
// module, the physics module or the app: every hash, save, notice and refusal read here is the implementation's own;
// the expected values come from the issue's text and this suite's lab, and each judge is run on planted output it
// must fail.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Vec3 = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/189/lab-redraft is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on a Mac (Homebrew's rustup keeps it off the default PATH); ~/.cargo/bin elsewhere. */
const RUST_BINS = ['/opt/homebrew/opt/rustup/bin', join(process.env['HOME'] ?? '/', '.cargo', 'bin')].filter((d) => existsSync(d));
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(RUST_BINS.length ? { PATH: `${RUST_BINS.join(':')}:${process.env['PATH'] ?? ''}` } : {}),
};
const MIB = 1024 * 1024;

/** Every test passes this timeout. */
export const TIMEOUT = 3_600_000;
/** A file's builds, before its tests: a first full deep-show build on a shared machine takes long. */
export const BUILD_TIMEOUT = 4 * TIMEOUT;

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = { 8: '#189.4e3f31a0', 10: '#189.dfd0da6e', 11: '#189.9badbff7' } as const;

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v)}`).toBe('string');
  return v as string;
}
export const vec3 = (v: JsonValue | undefined, what: string): Vec3 => {
  const a = arr(v, what);
  expect(a.length, `${what} holds three numbers`).toBe(3);
  return a.map((x, i) => num(x, `${what}[${i}]`)) as Vec3;
};
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** Two JSON values with object keys sorted, so equal values print equal. */
export const canonical = (v: JsonValue | undefined): string => JSON.stringify(v, (_, x: JsonValue) => (isObject(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A planted twin is caught: the judge that passes the real program finds something wrong, and a failure names every one of `names`. */
export function caughtNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what}: the judge finds the planted program wrong (it found nothing)`).toBeGreaterThan(0);
  expect(failures.some((f) => names.every((n) => f.includes(n))), `${what}: a failure names ${names.join(' and ')}; failures:\n  ${failures.slice(0, 20).join('\n  ')}`).toBe(true);
}
const DIGEST = /^[0-9a-f]{64}$/;
const HASH16 = /^[0-9a-f]{16}$/;
export function digest(v: JsonValue | undefined, what: string): string {
  const s = str(v, what);
  expect(s, `${what} is a d1 digest (64 lowercase hex)`).toMatch(DIGEST);
  return s;
}
function hash16(v: JsonValue | undefined, what: string): string {
  const s = str(v, what);
  expect(s, `${what} is a full-state hash (16 lowercase hex)`).toMatch(HASH16);
  return s;
}

// ---------------------------------------------------------------------------------------------------
// The builds (README: Builds): deep-show's full set, and #1920's mechanism for a test build of the physics module.

export type Build = 'full' | 'drift' | 'heavy';
/** This suite's two test features of deep-show (README: Builds), each built beside the default `full` set. */
export const FEATURE = { drift: 'test-physics-rapier-patch-drift', heavy: 'test-physics-rapier-patch-heavy' } as const;
const argsOf = (b: Build): string[] => ['build', '--locked', '-p', 'deep-show', '--bin', 'deep-show', ...(b === 'full' ? [] : ['--features', FEATURE[b]])];
export const buildName = (b: Build): string => `deep-show ${b === 'full' ? 'full' : `full,${FEATURE[b]}`}`;

/** `cargo build` for `b` in the checkout, the binary copied to `to`; '' or why not. */
function buildTo(b: Build, to: string): string {
  const args = argsOf(b);
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return (r.error as NodeJS.ErrnoException).code === 'ENOENT' ? `BLOCKED: cargo isn't on this machine (looked on PATH and in ${RUST_BINS.join(', ') || 'no rustup folder'}), so ${buildName(b)} can't be built; this is not a pass` : `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Checking|Finished|Download|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  copyFileSync(join(TARGET, 'debug', 'deep-show'), to);
  return '';
}

/** Builds each listed set once, in the file's beforeAll, each copied out under its own name; a test that asks for one
 * that failed fails at "the binary builds", with cargo's error. */
export function useBuilds(builds: readonly Build[]): (b: Build) => string {
  let dir = '';
  const made = new Map<Build, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-189-lab-redraft-bins-'));
    for (const b of builds) {
      const bin = join(dir, `deep-show-${b}`);
      made.set(b, { bin, error: buildTo(b, bin) });
    }
  }, BUILD_TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (b: Build): string => {
    const m = made.get(b);
    if (!m) throw Error(`the file didn't list ${buildName(b)} in useBuilds`);
    expect(m.error, `the binary builds: ${buildName(b)}`).toBe('');
    return m.bin;
  };
}

/** Folders that live as long as the file (an evidence store, saves folders), deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-189-lab-redraft-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run [--planted <name>]` (#393's convention): one scenario line on stdin, one answer `{ok, replies}`.

export const SESSION = 'sess-189-lab';
/** The lab's document ID, as the hub mints one (26 Crockford characters). */
export const DOC = '01JB189LAB0000000000000001';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-189-lab', name: 'Test agent: the lab with a world', process: { pid: 4189, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4189, ppid: 1, start: 1_000 }];

/** This suite's planted names (README: Planted twins), each reachable only through the startup `--planted <name>`. */
export type Planted = 'restore_loads_old_world' | 'content_leaves_out_worlds';

/** Runs `calls` through one `deep-show run [--planted p]` process of `bin` on the evidence store `evidence`: it starts,
 * exits 0 and answers each call. */
export function runShow(bin: string, evidence: string, calls: JsonObject[], what: string, planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const sc = { evidence, sessions: SESSIONS, processes: PROCESSES, panels: { p1: { rect: [0, 0, 800, 600] } }, docs: { [DOC]: { panel: 'p1' } }, calls };
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 4096 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what}: deep-show ${args.join(' ')} finished within its timeout`).toBe('');
  if (r.error && code !== 'EPIPE') throw Error(`${what}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-show ${args.join(' ')} starts and exits 0; stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(out['ok'], `${what}: deep-show run takes the scenario: ${show(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${what}: replies`).map((x, i) => obj(x, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(calls.length);
  return replies;
}

const present = (document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc: DOC, document, include: ['issues'] });
function presented(reply: JsonObject | undefined, what: string): void {
  const r = obj(reply, what);
  expect(r['outcome'], `${what} is presented: ${show(r['issues'] ?? r, 3000)}`).toBe('presented');
  const errors = arr(r['issues'] ?? [], `${what}: issues`).filter((i) => isObject(i) && i['severity'] === 'error');
  expect(errors, `${what} is presented with no error`).toEqual([]);
}
/** Keeps bytes in the scenario's evidence store under their SHA-256 (`<2 hex>/<62 hex>`), where a document's asset is read. */
function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}

// ---------------------------------------------------------------------------------------------------
// The lab (README: The lab): a world at 60 Hz with a character `hero`, two floors over a pit, a static `wall` and a
// dynamic `crate`, beside the logic item `rules`, which reads the hero's grounded reading and declares one save slot.

export const FLICKS = 705_600_000;
export const RATE = 60;
/** One step's flicks at 60 Hz, the world's and the logic item's. */
export const STEP = FLICKS / RATE;
export const WORLD = 'lab';
export const LOGIC = 'rules';
export const HERO = 'hero';
export const WALL = 'wall';
/** The arrays the logic item writes, in declaration order. */
export const ALIVE = `${LOGIC}.alive`;
export const REQUEST = `${LOGIC}.request`;
/** The grounded reading the logic item reads (`<world ID>.<body ID>.<read>`, as #182 names it): the world declares it
 * as its output `footing`, since a logic item reads only the character readings its piece's worlds output. */
export const GROUNDED = `${WORLD}.${HERO}.grounded`;
export const SLOT = 1;
/** "Saved at step 1,800": the logic writes slot 1 into `request` at the end of step 1,799 (#534's numbering). */
export const SAVE_STEP = 1800;
/** "The next 600 steps": the open plays on to step 2,399, so it reaches the checkpoint at 2,400. */
export const END = SAVE_STEP + 600;
/** Checkpoints every 60 steps (the world's and the logic item's default): those from the save's step to END. */
export const EVERY = 60;
export const COMPARED_STEPS = Array.from({ length: (END - SAVE_STEP) / EVERY + 1 }, (_, i) => SAVE_STEP + i * EVERY);
/** The steps the presses land on: walk at 0, launch over the pit at 87, turn back at 1,900 (after the save). */
export const HOP_STEP = 87;
export const BACK_STEP = 1900;
/** The hero dies when it has been off the ground for more than this many logic steps in a row. */
export const DEATH_AIR = 70;
/** The wall's centre x before and after the fix that moves it (criterion 10). */
export const WALL_X = 12.2;
export const MOVED_WALL_X = 12.7;

const press = (control: string, step: number, seq: number): JsonObject => ({ t: step * STEP, seq, control, value: 1, writer: 'you', player: 1 });
/** The lab's input track from step 0: three presses. */
export const TRACK: JsonObject[] = [press('go', 0, 0), press('hop', HOP_STEP, 1), press('back', BACK_STEP, 2)];
/** What the viewer hands an open: the track's entries after the save's last step only. The save's own track, by its
 * hash, is what a re-derivation replays (README: open_save). */
export const AFTER_SAVE: JsonObject[] = TRACK.filter((e) => (e['t'] as number) > (SAVE_STEP - 1) * STEP);

const RADIUS = 0.3;
const HALF_HEIGHT = 0.6;
const OFFSET = 0.01;
const use = (shape: string): JsonObject => ({ shape, contact_material: 'm' });
const box = (half: Vec3): JsonObject => ({ kind: 'box', half });
/** A static box spanning x0…x1, y0…y1 and −2…2 in z: its shape's halves and its body's centre. */
const slab = (x0: number, x1: number, y0: number, y1: number): { half: Vec3; pos: Vec3 } => ({ half: [(x1 - x0) / 2, (y1 - y0) / 2, 2], pos: [(x0 + x1) / 2, (y0 + y1) / 2, 0] });

/**
 * The lab's world. `near` (top at y 0, x −2 to 3), a pit 1.4 m wide, `far` (x 4.4 to 16), the pit's floor 20 m down (to x 100),
 * the static `wall` (0.4 m thick, 2 m tall) standing on `far` with its centre at `wallX`, the crate (a 0.5 m dynamic box
 * dropped from 2 m beside the path, which settles on `near`), and the hero: #182's capsule (radius 0.3 m, half height
 * 0.6 m) standing at x 0. Its inputs: `go` walks it +x at 2 m/s, `hop` launches it at 4 m/s up, `back` walks it −x at
 * 2 m/s. Its one output, `footing`, reads the hero's grounded state, which is what lets the logic item read
 * `lab.hero.grounded` (the base builds a piece's world reads from its worlds' character outputs, #182). Launched at
 * x 2.9, it is off the ground about 50 steps and lands on `far` 0.13 m past its edge; under twice the gravity it falls
 * short into the pit and is off the ground about 99 steps; walked back off `far`, about 121.
 */
export function labWorld(wallX = WALL_X): JsonObject {
  const statics: Record<string, { half: Vec3; pos: Vec3 }> = {
    near: slab(-2, 3, -1, 0), far: slab(4.4, 16, -1, 0), pit: slab(-10, 100, -21, -20),
    [WALL]: { half: [0.2, 1, 2], pos: [wallX, 1, 0] },
  };
  const shapes: JsonObject = { capsule: { kind: 'capsule', half_height: HALF_HEIGHT, radius: RADIUS }, crate: box([0.25, 0.25, 0.25]) };
  const bodies: JsonObject = {};
  for (const [id, s] of Object.entries(statics)) {
    shapes[id] = box(s.half);
    bodies[id] = { kind: 'static', shapes: [use(id)], pose: { pos: s.pos } };
  }
  bodies['crate'] = { kind: 'dynamic', shapes: [use('crate')], pose: { pos: [1, 2, -1.4] } };
  bodies[HERO] = { kind: 'character', shapes: [use('capsule')], pose: { pos: [0, OFFSET + HALF_HEIGHT + RADIUS, 0] }, character: {} };
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: RATE, substeps: 4, gravity: [0, -9.81, 0], seed: 189, mode: 'dynamic',
    capacity: { bodies: 16, shapes: 16, joints: 0, contacts: 256, particles: 0 },
    contact_materials: { m: { friction: 0.5, restitution: 0, density: 1000 } },
    shapes, bodies,
    outputs: { footing: { from: HERO, read: 'grounded' } },
    inputs: {
      walk: { kind: 'move', targets: [HERO], on: { control: 'go', each: 'entry' }, data: { velocity: [2, 0, 0] } },
      turn: { kind: 'move', targets: [HERO], on: { control: 'back', each: 'entry' }, data: { velocity: [-2, 0, 0] } },
      hop: { kind: 'launch', targets: [HERO], on: { control: 'hop', each: 'entry' }, data: { vertical: 4 } },
    },
  };
}

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #189 acceptance tests.' };
/** The lab as a 41 s scene at 60 frames a second: its three press controls, the world, a camera and the logic item. */
function labDocument(program: string, wallX: number): JsonObject {
  const item = (id: string, order: string, rest: JsonObject): JsonObject => ({ id, name: id, order, ...rest });
  const pressControl = (label: string): JsonObject => ({ kind: 'press', class: 'document', label, role: 'button' });
  return {
    format: 1, profile: 'scene', title: 'The lab', description: 'A world and its rules, with one save slot: a #189 acceptance fixture.',
    size: [640, 360], camera: 'cam', seed: 189, transport: { span: '41s', frame_rate: [60, 1] },
    requires: { modules: { scene3d: '^1', logic: '^1', physics: '^1' } },
    controls: { go: pressControl('Go'), hop: pressControl('Hop'), back: pressControl('Back') },
    worlds: { [WORLD]: labWorld(wallX) },
    items: {
      cam: item('cam', 'a000', { kind: 'camera@1', params: { projection: 'perspective', position: [6, 4, 18], target: [6, 0, 0], fov: 50 } }),
      [LOGIC]: item(LOGIC, 'a001', {
        kind: 'logic@1',
        params: { program, step_rate: RATE, reads: [GROUNDED], writes: { alive: { type: 'i32' }, request: { type: 'i32' } }, saves: { slots: SLOT, request: 'request' } },
      }),
    },
    assets: { rules_program: { sha256: program, license: LICENSE } },
  };
}

// The logic program, as an agent would write it, assembled here as WebAssembly bytes (no assembler is built): one
// memory of one page whose maximum is its minimum, the immutable i32 globals `reads_at` 0 and `writes_at` 4096,
// `init(seed: i64)` and `step(k: i64)`, no imports. Its state is in memory at 8192: steps off the ground in a row,
// dead, landings, steps on the ground and the last step's reading. Each step reads `lab.hero.grounded`; on the ground
// it counts a landing after a step off it, clears the run off the ground and counts the step; off it, it adds one to
// the run; a run past DEATH_AIR marks the hero dead for good. It writes alive (1 until dead) and request (1 at the end
// of step 1,799 only, so slot 1 is saved at step 1,800). Without offsets it's the layout probe, whose step is empty.
interface Offsets { grounded: number; alive: number; request: number }
const uleb = (n: number): number[] => { const o: number[] = []; let v = n >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
function sleb(n: number): number[] {
  const o: number[] = [];
  let v = BigInt(n);
  for (;;) {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    const done = (v === 0n && (b & 0x40) === 0) || (v === -1n && (b & 0x40) !== 0);
    o.push(done ? b : b | 0x80);
    if (done) return o;
  }
}
function rulesBytes(at: Offsets | null): Buffer {
  const name = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'utf8')];
  const vec = (xs: number[][]): number[] => [...uleb(xs.length), ...xs.flat()];
  const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
  const fn = (locals: number[][], code: number[]): number[] => { const b = [...vec(locals), ...code, 0x0b]; return [...uleb(b.length), ...b]; };
  const i32 = (n: number): number[] => [0x41, ...sleb(n)];
  const i64 = (n: number): number[] => [0x42, ...sleb(n)];
  const load = (a: number): number[] => [...i32(a), 0x28, 0x02, 0x00];
  const store = (a: number, value: number[]): number[] => [...i32(a), ...value, 0x36, 0x02, 0x00];
  const inc = (a: number): number[] => store(a, [...load(a), ...i32(1), 0x6a]);
  const W = 4096;
  const [AIR, DEAD, LANDINGS, GROUND, PREV] = [8192, 8196, 8200, 8204, 8208];
  const G = 1; // local: this step's reading (local 0 is k)
  const step = at === null ? [] : [
    ...load(at.grounded), ...i32(0), 0x47, 0x21, G, // g = grounded != 0
    0x20, G, 0x04, 0x40, // if g
    ...load(PREV), 0x45, 0x04, 0x40, ...inc(LANDINGS), 0x0b, // a landing after a step off the ground
    ...store(AIR, i32(0)), ...inc(GROUND),
    0x05, // else
    ...inc(AIR),
    0x0b,
    ...load(AIR), ...i32(DEATH_AIR), 0x4b, 0x04, 0x40, ...store(DEAD, i32(1)), 0x0b, // air > DEATH_AIR (unsigned): dead
    ...store(PREV, [0x20, G]),
    ...store(W + at.alive, [...load(DEAD), 0x45]),
    ...store(W + at.request, [0x20, 0x00, ...i64(SAVE_STEP - 1), 0x51]),
  ];
  return Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, 0x01, 0x01]])),
    ...section(6, vec([[0x7f, 0x00, ...i32(0), 0x0b], [0x7f, 0x00, ...i32(W), 0x0b]])),
    ...section(7, vec([[...name('memory'), 0x02, 0x00], [...name('reads_at'), 0x03, 0x00], [...name('writes_at'), 0x03, 0x01], [...name('init'), 0x00, 0x00], [...name('step'), 0x00, 0x01]])),
    ...section(10, vec([fn([], []), fn([[1, 0x7f]], step)])),
  ]);
}

/** The item's region map as `deep_query`'s logic read reports it for the layout probe (Logic `logic@1`: Region map), once per file. */
let offsets: Offsets | undefined;
function offsetsOf(bin: string, evidence: string): Offsets {
  if (offsets) return offsets;
  const r = runShow(bin, evidence, [
    present(labDocument(putEvidence(evidence, rulesBytes(null)), WALL_X)),
    { call: 'deep_query', session: SESSION, doc: DOC, what: 'logic', items: [LOGIC], steps: [] },
  ], 'the layout probe');
  presented(r[0], 'the lab with the layout probe as its program');
  const read = obj(obj(obj(r[1], 'deep_query')['logic'], `deep_query's logic read: ${show(r[1], 800)}`)[LOGIC], `deep_query: logic.${LOGIC}`);
  const entries = arr(obj(read['region_map'], 'the region map')['entries'], 'the region map\'s entries').map((e, i) => obj(e, `the region map's entry ${i}`));
  const at = (region: string, name: string): number => {
    const e = entries.find((x) => x['region'] === region && x['name'] === name);
    expect(e, `the region map has the ${region} entry ${name}: ${show(entries, 800)}`).toBeTruthy();
    return num(e!['offset'], `the ${region} entry ${name}'s offset`);
  };
  offsets = { grounded: at('reads', GROUNDED), alive: at('writes', 'alive'), request: at('writes', 'request') };
  return offsets;
}
/** The lab's document, its program built against the item's region map and kept in `evidence`; `wallX` the wall's centre. */
export function labDoc(bin: string, evidence: string, wallX = WALL_X): JsonObject {
  return labDocument(putEvidence(evidence, rulesBytes(offsetsOf(bin, evidence))), wallX);
}

// ---------------------------------------------------------------------------------------------------
// Replies (README: The surface under test).

/** The sealed plan's digests and the physics implementation, as `schedule` publishes them (#1920). */
export interface Plan { runtime: string; set: string; physics: string }
export function planOf(reply: JsonObject | undefined, what: string): Plan {
  const s = obj(reply, `${what}: schedule`);
  const physics = obj(obj(obj(s['interfaces'], `${what}: schedule.interfaces`)['physics@1'], `${what}: schedule.interfaces["physics@1"]`)['implementation'], `${what}: physics@1's implementation`);
  return { runtime: digest(s['runtime_digest'], `${what}: runtime_digest`), set: digest(s['set_digest'], `${what}: set_digest`), physics: str(physics['name'], `${what}: physics@1's implementation name`) };
}

/** Full-state hashes by carried state (`rules`, `lab`), then by step. */
export type Checkpoints = Map<string, Map<number, string>>;
function checkpointsOf(v: JsonValue | undefined, what: string): Checkpoints {
  const all = obj(v, `${what}: checkpoints`);
  const out: Checkpoints = new Map();
  for (const id of [LOGIC, WORLD]) {
    const list = arr(all[id], `${what}: checkpoints.${id} (README: each carried state's checkpoints, the world's beside the logic item's)`);
    out.set(id, new Map(list.map((c, i) => {
      const o = obj(c, `${what}: checkpoints.${id}[${i}]`);
      return [num(o['step'], `${what}: checkpoints.${id}[${i}].step`), hash16(o['deep_hash'], `${what}: checkpoints.${id}[${i}].deep_hash`)] as const;
    })));
  }
  return out;
}

/** The full-state hash of carried state `id` at checkpoint `step`, which must be there. */
export function hashAt(c: Checkpoints, id: string, step: number, what: string): string {
  const h = c.get(id)?.get(step);
  expect(h, `${what}: ${id} has a checkpoint at step ${step}`).toBeDefined();
  return h!;
}

/** A `logic` call's reply: each carried state's checkpoints and each step's arrays. */
export interface Run { checkpoints: Checkpoints; arrays: (step: number, name: string) => number[] }
export function runOf(reply: JsonObject | undefined, what: string): Run {
  const r = obj(reply, `${what}: logic`);
  expect(r['code'], `${what}: the logic call runs: ${show(r)}`).toBeUndefined();
  expect(r['trap'] ?? null, `${what}: no item trapped`).toBeNull();
  const steps = arr(r['steps'], `${what}: steps`).map((s, i) => obj(s, `${what}: steps[${i}]`));
  return {
    checkpoints: checkpointsOf(r['checkpoints'], what),
    arrays: (step, name) => arr(obj(steps[step]?.['arrays'], `${what}: step ${step}'s arrays`)[name], `${what}: step ${step}: ${name}`).map((x, i) => num(x, `${what}: step ${step}: ${name}[${i}]`)),
  };
}

/** Every kept save in a saves folder, `<sha256>.save`, with its bytes. */
export function saveFiles(dir: string): Map<string, Buffer> {
  return new Map(readdirSync(dir).filter((f) => /^[0-9a-f]{64}\.save$/.test(f)).map((f) => [f.slice(0, 64), readFileSync(join(dir, f))] as const));
}
/** A save file's header: its first line, JSON (README: Save files, #534's format). */
export function headerOf(bytes: Buffer, what: string): JsonObject {
  const nl = bytes.indexOf(0x0a);
  expect(nl, `${what}: the save holds a header line`).toBeGreaterThan(0);
  return obj(JSON.parse(bytes.subarray(0, nl).toString('utf8')) as JsonValue, `${what}: the header`);
}

/** The save the lab wrote at step 1,800 in a folder of its own, with what its run reported. */
export interface Written { dir: string; hash: string; bytes: Buffer; header: JsonObject; plan: Plan; run: Run }
/** One process of `bin`: the lab presented and run on its track to a step past the save, into a fresh saves folder. */
export function writeSave(bin: string, evidence: string, document: JsonObject, dir: string, what: string, planted?: Planted): Written {
  const r = runShow(bin, evidence, [{ call: 'schedule' }, present(document), { call: 'logic', doc: DOC, steps: SAVE_STEP + 1, track: TRACK, saves_dir: dir }], what, planted);
  const plan = planOf(r[0], what);
  presented(r[1], `${what}: the lab`);
  expect(r[2]!['code'], `${what}: the logic call runs: ${show(r[2])}`).toBeUndefined();
  const saves = arr(r[2]!['saves'], `${what}: the logic call's saves (README: logic, saves_dir)`).map((s, i) => obj(s, `${what}: saves[${i}]`));
  expect(saves.length, `${what}: the logic call lists the one save its steps asked for: ${show(saves as JsonValue)}`).toBe(1);
  const s = saves[0]!;
  expect([s['item'], s['slot'], s['step'], s['ended']], `${what}: the save is the logic item's slot ${SLOT} at step ${SAVE_STEP}, not ended`).toEqual([LOGIC, SLOT, SAVE_STEP, false]);
  const files = saveFiles(dir);
  expect([...files.keys()], `${what}: the saves folder keeps that one save as <sha256>.save`).toEqual([str(s['hash'], `${what}: the save's hash`)]);
  const [hash, bytes] = [...files][0]!;
  expect(sha256(bytes), `${what}: the save is named by its sha256`).toBe(hash);
  const header = headerOf(bytes, what);
  expect([header['slot'], header['step']], `${what}: the header names slot ${SLOT} and step ${SAVE_STEP}`).toEqual([SLOT, SAVE_STEP]);
  return { dir, hash, bytes, header, plan, run: runOf(r[2], what) };
}

/** A fresh run of the lab's track from step 0 in `bin`'s build, to END: its plan and run. */
export function freshRun(bin: string, evidence: string, document: JsonObject, what: string): { plan: Plan; run: Run } {
  const r = runShow(bin, evidence, [{ call: 'schedule' }, present(document), { call: 'logic', doc: DOC, steps: END, track: TRACK }], what);
  presented(r[1], `${what}: the lab`);
  return { plan: planOf(r[0], what), run: runOf(r[2], what) };
}

/** A copy of a saves folder, so each open starts from the same files. */
export function copyOf(dir: string, to: string): string {
  cpSync(dir, to, { recursive: true });
  return to;
}

/** One process of `bin`: the plan, the lab presented, and the viewer's open of slot 1 in `dir`, played on to END. */
export function openSave(bin: string, evidence: string, document: JsonObject, dir: string, what: string, planted?: Planted): { plan: Plan; reply: JsonObject } {
  const r = runShow(bin, evidence, [{ call: 'schedule' }, present(document), { call: 'open_save', doc: DOC, saves_dir: dir, slot: SLOT, track: AFTER_SAVE, steps: END }], what, planted);
  presented(r[1], `${what}: the lab`);
  return { plan: planOf(r[0], what), reply: obj(r[2], `${what}: open_save`) };
}

/** An open that opened (README: Opened): how, its notices, its checkpoints and each world's bodies as it restored them. */
export interface Opened { hash: string; via: string; from: string | null; step: number; notices: JsonObject[]; checkpoints: Checkpoints; worlds: JsonObject; reply: JsonObject }
export function openedOf(reply: JsonObject, what: string): Opened {
  expect(reply['ok'], `${what}: the save opens: ${show(reply, 2500)}`).toBe(true);
  const o = obj(reply['opened'], `${what}: opened`);
  return {
    hash: str(o['hash'], `${what}: opened.hash`), via: str(o['via'], `${what}: opened.via`),
    from: o['from'] === undefined || o['from'] === null ? null : str(o['from'], `${what}: opened.from`),
    step: num(o['step'], `${what}: opened.step`),
    notices: arr(reply['notices'], `${what}: notices`).map((n, i) => obj(n, `${what}: notices[${i}]`)),
    checkpoints: checkpointsOf(reply['checkpoints'], what), worlds: obj(reply['worlds'], `${what}: worlds`), reply,
  };
}

/** The one notice an open shows, read as the README fixes it: its kind, the save, what changed, whether it replays the same. */
export function oneNotice(notices: JsonObject[], what: string): JsonObject {
  expect(notices.length, `${what}: one notice: ${show(notices as JsonValue, 2500)}`).toBe(1);
  return notices[0]!;
}
/** The notice names the physics implementation: `physics@1` and its implementation's name, in `changed` and its words. */
export function namesImplementation(n: JsonObject, implementation: string, what: string): void {
  const changed = arr(n['changed'], `${what}: the notice's changed`).map((c, i) => obj(c, `${what}: changed[${i}]`));
  expect(changed.map((c) => [c['interface'], c['implementation']]), `${what}: the notice names the physics implementation, ${implementation} of physics@1, as what changed`).toEqual([['physics@1', implementation]]);
  expect(str(n['text'], `${what}: the notice's text`), `${what}: the notice's words name ${implementation}`).toContain(implementation);
}

// ---------------------------------------------------------------------------------------------------
// Judges, computed here, each run on planted output it must fail.

/**
 * The re-derived save against a fresh run (criterion 8): every checkpoint of the logic item and the world from the
 * save's step to END equals the fresh run's of the same track in this build. A failure names the save and the
 * implementation it was opened under.
 */
export function judgeRederived(opened: Checkpoints, fresh: Checkpoints, save: string, implementation: string): string[] {
  const out: string[] = [];
  for (const id of [LOGIC, WORLD]) {
    for (const k of COMPARED_STEPS) {
      const want = fresh.get(id)?.get(k);
      const got = opened.get(id)?.get(k);
      if (want === undefined) out.push(`the fresh run holds no checkpoint of ${id} at step ${k}`);
      else if (got !== want) out.push(`save ${save} opened under ${implementation}: ${id}'s full-state hash at step ${k} is ${got ?? 'missing'}, and a fresh run of the same track in this build gives ${want}`);
    }
  }
  return out;
}

/**
 * Each static body of `document`'s world `world` where the opened world holds it (criterion 10): at the pose the
 * document draws it at, within 0.1 mm. A failure names the world and the body.
 */
export function judgeStatics(worlds: JsonObject, document: JsonObject, world: string): string[] {
  const bodies = obj(obj(obj(document['worlds'], 'the document\'s worlds')[world], `the document's world ${world}`)['bodies'], `${world}.bodies`);
  const held = isObject(worlds[world]) ? worlds[world] as JsonObject : {};
  const out: string[] = [];
  for (const [id, b] of Object.entries(bodies)) {
    if (!isObject(b) || b['kind'] !== 'static') continue;
    const want = vec3(obj(b['pose'], `${world}.${id}.pose`)['pos'], `${world}.${id}.pose.pos`);
    const at = held[id];
    if (!isObject(at)) { out.push(`world ${world}: the opened world holds no static body ${id}`); continue; }
    const got = vec3(at['pos'], `the opened ${world}.${id}.pos`);
    if (got.some((x, i) => Math.abs(x - want[i]!) > 1e-4)) out.push(`world ${world}: the opened world holds ${id} at (${got.map((x) => x.toFixed(4)).join(', ')}), where the document draws it at (${want.join(', ')})`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Budgets on the reference Mac (scripts/benchmark.mjs's judgeLimit, as #534's criterion 4 judges its budgets).

/** The reference Mac's legs: BLOCKED on any other host, before they measure, never skipped. */
export function onReferenceMacOnly(leg: string): void {
  if (process.platform !== 'darwin') blocked(`${leg} is pinned to the reference Mac; this host is ${process.platform}/${process.arch}`);
}
type Judge = (a: { limit: number; runs: number[]; fingerprint: JsonValue; loads: { start: number; end: number }[] }) => { status: string; reason?: string };
/** The repo's budget judge on five readings after a warm-up; anything but PASS fails, naming the judge's reason. */
export async function judgeBudget(limit: number, reading: () => number, what: string): Promise<void> {
  const bench = await import(pathToFileURL(join(REPO, 'scripts', 'benchmark.mjs')).href) as { fingerprint: () => JsonValue; judgeLimit: Judge };
  reading(); // warm-up, not judged
  const runs: number[] = [];
  const loads: { start: number; end: number }[] = [];
  for (let i = 0; i < 5; i++) { const start = loadavg()[0]!; runs.push(reading()); loads.push({ start, end: loadavg()[0]! }); }
  const verdict = bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
  expect(verdict.status, `${what}: ${verdict.status} under ${limit} (runs ${JSON.stringify(runs)}, ${availableParallelism()} cores): ${verdict.reason ?? ''}`).toBe('PASS');
}
