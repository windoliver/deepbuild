// Test-side tools for the #853 acceptance tests (README: The surface under test): `deep-gpu` (#377's binary, with
// #378's `view3d`, #380's `golden` and `decide`, #483's `read`, #484's `seeks`, #252's `carried` rows and #537's logic
// items) built once per file and driven by JSON lines; the fixture documents, written here from judges.ts's numbers
// so every file judges the same ones (the pour, the flood, the lift, the corridor and the drops, each around one
// `particles.stepped@1` item); a logic program written as WebAssembly bytes; the reply readers; the reference-Mac
// gate; and an animated PNG built from the canvas's own PNGs. Nothing here stands in for the particles, the ring,
// the bake, the logic module or the renderer: every buffer, row, hash, issue and timing read is the program's own.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import {
  CORRIDOR, DROPS, FLOOD, G, LIFT, POUR, POUR_SEED, SHA, STEP_RATE, plantedSetFailures, tallyBytes, type GoldenRead, type RingRow, type Tray, type V3,
} from './judges.ts';

vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/853 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const BIN = 'deep-gpu';
export const TIMEOUT = 3_600_000;

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (README). */
export const CRITERIA = {
  1: '#853.fe931abe', 2: '#853.22cd6328', 3: '#853.a87d0063', 4: '#853.8a18357d', 5: '#853.efbe6335', 6: '#853.a7fb57f6',
} as const;
/** A test title's prefix: `AC<n> #853.<id>`. */
export const ac = (n: keyof typeof CRITERIA): string => `AC${n} ${CRITERIA[n]}`;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${shown(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${shown(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${shown(v)}`).toBe(true);
  return v as number;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** No problem: the right program's check. */
export function none(problems: readonly string[], what: string): void {
  expect(problems, what).toEqual([]);
}
/** A planted twin's check: it found problems, and they name what the criterion says they name. */
export function failsNaming(problems: readonly string[], names: readonly (string | RegExp)[], what: string): void {
  expect(problems.length, `${what} fails the check`).toBeGreaterThan(0);
  const text = problems.join('\n');
  for (const n of names) {
    if (typeof n === 'string') expect(text, `${what}'s failure names ${n}`).toContain(n);
    else expect(text, `${what}'s failure names ${String(n)}`).toMatch(n);
  }
}
/** Every judge passes its right set and fails its planted wrong sets (judges.ts), read once a file, before any
 * binary is asked for. */
let judged: string[] | null = null;
export function judgesHold(): void {
  judged ??= plantedSetFailures();
  expect(judged, 'each judge passes a right set of numbers and fails its planted wrong sets, naming what its criterion names').toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-gpu`, built once per file and copied out of the target folder.

function cargoBuild(): string {
  const args = ['build', '--locked', '--bin', BIN];
  const env: NodeJS.ProcessEnv = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
  // The rustup a Mac keeps here reads rust-toolchain.toml's pin; elsewhere cargo is the PATH's.
  const rustup = '/opt/homebrew/opt/rustup/bin';
  if (existsSync(rustup)) env['PATH'] = `${rustup}${delimiter}${env['PATH'] ?? ''}`;
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
export function useBin(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-853-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', BIN), join(dir, BIN));
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${BIN}`).toBe('');
    return join(dir, BIN);
  };
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-853-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario per line in, one line out (#377).

/** The wrong programs this suite adds to the binary, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'particles_step_by_frame_time' | 'particles_collide_at_end';

export function run(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT - 600_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const name = `${BIN} ${args.join(' ')}`;
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  expect(r.status, `${name} exited 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${name}: the answer is JSON: ${lines[0]!.slice(0, 1500)}`); }
  const a = obj(answer, `${name}: the answer`);
  expect(a['ok'], `${name} refused the scenario: ${shown(a)}`).toBe(true);
  const replies = arr(a['replies'], 'run: replies').map((x, i) => obj(x, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The machine: Metal on macOS for anything the GPU runs; a reference Mac for a timing.

const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer runs on macOS's Metal device, the reference platform; this is ${process.platform}`);
}
/** The design's reference Macs (technical design: The reference Macs). */
const REFERENCE_MACS = ['Mac15,7', 'Mac15,12', 'Mac17,10'];
/** The reference Mac this is, or INCONCLUSIVE. Power and Low Power Mode aren't gated here, as #252's and #1993's
 * budgets aren't; the load is read by the judge. */
export function requireReferenceMac(): string {
  requireGpu();
  let model = '';
  try { model = sh('sysctl', '-n', 'hw.model'); } catch { /* unread */ }
  if (!REFERENCE_MACS.includes(model)) inconclusive(`not a reference Mac (${REFERENCE_MACS.join(', ')}): hw.model is ${model || 'unread'}`);
  return model;
}
/** The one-minute load per CPU core: above 1 the machine is loaded, and a timing is a reading. */
export const loadPerCore = (): number => loadavg()[0]! / cpus().length;

// ---------------------------------------------------------------------------------------------------
// Documents. Each is a scene as a session holds it (#378): an `id`, one writer layer, the camera `cam`, a showpiece
// (a count past 65,536 needs one), with a 60 Hz frame rate; its worlds are `physics.world@1` documents on the pinned
// physics backend (no `backend` field: the one that runs 3 dimensions), baked over the transport's span when `view3d`
// reads the document (#1921). `requires.modules` names only modules the base has; nothing here names the module that
// registers `particles.stepped@1`.

export const LOOK: JsonObject = JSON.parse(readFileSync(join(HERE, 'fixtures', 'look.json'), 'utf8')) as JsonObject;
/** The look with one sample a pixel live and in an export, so an export's frame is the live frame's picture (the
 * look's default is 1 live and 16 in an export). */
export const LOOK_ONE_SAMPLE: JsonObject = { ...LOOK, samples: { live: 1, export: 1 } };
const WRITER = 'agent:alpha';

export function sceneDoc(name: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let n = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(n++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id: `${name}-853`, profile: 'scene', title: name, description: `${name}: a #853 acceptance fixture.`, size: [64, 64], seed: POUR_SEED, camera: 'cam',
    requires: { modules: { scene3d: '^1', effects: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } },
    ...extra,
    items: withIds,
  };
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value));
  return p;
}
const camera = (position: V3, target: V3, fov = 40): JsonObject => ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov } });
const markBox = (size: V3, pos: V3, role: string): JsonObject => ({ kind: 'mark.box@1', params: { size, paint: { fill: { role } } }, at: { pos } });
/** A world of static and kinematic boxes: every body one shape use, on the world's one contact material. */
function world(shapes: JsonObject, bodies: Record<string, JsonObject>): JsonObject {
  const n = Object.keys(bodies).length;
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: 120, substeps: 4, gravity: [0, -G, 0], seed: POUR_SEED, mode: 'dynamic',
    capacity: { bodies: n, shapes: n, joints: 0, contacts: 64, particles: 0 },
    contact_materials: { plain: { friction: 0.5, restitution: 0 } }, shapes, bodies,
  };
}
const fixed = (shape: string, pos: V3): JsonObject => ({ kind: 'static', shapes: [{ shape, contact_material: 'plain' }], pose: { pos } });
/** How every fixture draws its particles (`particles@1`'s draw fields, as #449's fixtures write them). */
const DOTS: JsonObject = { draw: 'dot', size: 3, opacity: 1, color: [{ at: 0, role: 'sand' }] };
/** The design's checkpoint ring defaults (Checkpoint ring: every 60 steps, 16 MiB), for the small fixtures. */
const DEFAULT_RING: JsonObject = { every: 60, budget: 16 * 1024 * 1024 };
const stepped = (pos: V3, params: JsonObject): JsonObject => ({ kind: 'particles.stepped@1', at: { pos }, params: { step_rate: STEP_RATE, ...params, ...DOTS } });

/** The buffer's name wherever a carried output is named (README: The buffer). */
export const bufferOf = (item: string): string => `${item}.buffer`;

/**
 * A tray of sand (judges.ts: Tray): the world `pit` holds a static floor box whose top is y = 0 and four static wall
 * boxes whose inner faces stand at x = ±half and z = ±half; the item `item` pours `count` particles from its emit box
 * at `rate` a second for `span` s, each leaving at `velocity`, under gravity, colliding with `pit` and kept `spacing`
 * apart. The floor and the two far walls are drawn.
 */
function trayDoc(name: string, item: string, t: Tray, seed: number, span: string, cam: JsonObject): JsonObject {
  const [outer, h] = [t.half + t.wall, t.wallHeight];
  const side = t.half + t.wall / 2;
  const pit = world({
    slab: { kind: 'box', half: [outer, t.floor / 2, outer] },
    side_x: { kind: 'box', half: [t.wall / 2, h / 2, outer] },
    side_z: { kind: 'box', half: [outer, h / 2, t.wall / 2] },
  }, {
    floor: fixed('slab', [0, -t.floor / 2, 0]),
    east: fixed('side_x', [side, h / 2, 0]), west: fixed('side_x', [-side, h / 2, 0]),
    north: fixed('side_z', [0, h / 2, -side]), south: fixed('side_z', [0, h / 2, side]),
  });
  return sceneDoc(name, {
    cam,
    floor: markBox([2 * outer, t.floor, 2 * outer], [0, -t.floor / 2, 0], 'floor'),
    west: markBox([t.wall, h, 2 * outer], [-side, h / 2, 0], 'muted'),
    north: markBox([2 * outer, h, t.wall], [0, h / 2, -side], 'muted'),
    [item]: stepped(t.emitAt, {
      count: t.count, emit: { shape: { box: { size: t.emitSize } }, rate: t.rate, span: t.span, velocity: t.velocity },
      forces: { gravity: [0, -G, 0] }, collide: { world: 'pit' }, spacing: t.spacing, checkpoint: { every: t.every, budget: t.budget },
    }),
  }, { seed, transport: { span, frame_rate: [60, 1] }, worlds: { pit } });
}
/** The pour (criteria 1, 3 and 6): 100,000 grains into a tray 0.8 m square; the item is `sand`. */
export const SAND = bufferOf('sand');
export const pourDoc = (seed: number = POUR_SEED): JsonObject => trayDoc('pour', 'sand', POUR, seed, '11s', camera([2.6, 2, 3.3], [0, 0.8, 0]));
/** The flood (criterion 5): 1,000,000 grains into a tray 2 m square; the item is `flood`. */
export const FLOODED = bufferOf('flood');
export const floodDoc = (): JsonObject => trayDoc('flood', 'flood', FLOOD, POUR_SEED, '6s', camera([4.2, 2.6, 5.2], [0, 0.3, 0]));

/**
 * The lift (criteria 2 and 6; judges.ts: LIFT): the world `stage` holds one kinematic box, `lift`, 2 × 0.2 × 2 m,
 * following the channel `lift` on the drawn box's position: its top at y = 0 until 1 s, rising 1.2 m/s to 1.2 m at
 * 2 s, then held. The item `beads` bursts 1,024 particles at 0 s in a square 1 m across, 1 cm above the floor, under
 * gravity, colliding with `stage`, with no spacing.
 */
export const BEADS = bufferOf('beads');
export const LIFT_PATH = 'items/lift/at/pos';
export function liftDoc(): JsonObject {
  const [from, to] = [-LIFT.half[1], (LIFT.speed * (LIFT.stopsAt - LIFT.movesAt)) / STEP_RATE - LIFT.half[1]];
  const stage = world({ deck: { kind: 'box', half: [...LIFT.half] } }, {
    lift: { kind: 'kinematic', shapes: [{ shape: 'deck', contact_material: 'plain' }], pose: { pos: [0, from, 0] }, follow: LIFT_PATH },
  });
  const keys: JsonObject = {
    k0: { t: '0s', value: [0, from, 0], interp: 'hold' },
    k1: { t: `${LIFT.movesAt / STEP_RATE}s`, value: [0, from, 0], interp: 'linear' },
    k2: { t: `${LIFT.stopsAt / STEP_RATE}s`, value: [0, to, 0], interp: 'hold' },
  };
  return sceneDoc('lift', {
    cam: camera([2.6, 1.6, 4.2], [0, 0.7, 0]),
    lift: markBox([2 * LIFT.half[0], 2 * LIFT.half[1], 2 * LIFT.half[2]], [0, from, 0], 'floor'),
    beads: stepped([0, LIFT.emitAbove, 0], {
      count: LIFT.count, emit: { shape: { box: { size: [...LIFT.emitSize] } }, bursts: [{ t: '0s', count: LIFT.count }] },
      forces: { gravity: [0, -G, 0] }, collide: { world: 'stage' }, checkpoint: DEFAULT_RING,
    }),
  }, { transport: { span: '4s', frame_rate: [60, 1] }, worlds: { stage }, channels: { lift: { target: LIFT_PATH, type: 'vec3', keys } } });
}

/**
 * The corridor (criterion 2; judges.ts: CORRIDOR): the world `room` holds two static walls 2 cm thick and 4 m square,
 * their near faces at x = ±3 m. The item `shots` bursts 1,024 particles at 0 s in a cube 1 m across at the origin,
 * each leaving at 24 m/s along +x, with no gravity, colliding with `room`.
 */
export const SHOTS = bufferOf('shots');
export function corridorDoc(): JsonObject {
  const at = CORRIDOR.near + CORRIDOR.thick / 2;
  const size: V3 = [CORRIDOR.thick, 2 * CORRIDOR.wallHalf, 2 * CORRIDOR.wallHalf];
  const room = world({ wall: { kind: 'box', half: [CORRIDOR.thick / 2, CORRIDOR.wallHalf, CORRIDOR.wallHalf] } }, { east: fixed('wall', [at, 0, 0]), west: fixed('wall', [-at, 0, 0]) });
  return sceneDoc('corridor', {
    cam: camera([0, 3, 13], [0, 0, 0]),
    east: markBox(size, [at, 0, 0], 'muted'), west: markBox(size, [-at, 0, 0], 'muted'),
    shots: stepped([0, 0, 0], {
      count: CORRIDOR.count, emit: { shape: { box: { size: [...CORRIDOR.emitSize] } }, bursts: [{ t: '0s', count: CORRIDOR.count }], velocity: [CORRIDOR.speed, 0, 0] },
      forces: { gravity: [0, 0, 0] }, collide: { world: 'room' }, checkpoint: DEFAULT_RING,
    }),
  }, { transport: { span: '11s', frame_rate: [60, 1] }, worlds: { room } });
}

// The drops, and the logic item that counts them --------------------------------------------------------

export interface Program { bytes: Buffer; sha: string }
/** The tally (judges.ts: tallyBytes): a logic program that writes the i32 it reads into its array `seen`, as an f64. */
export function tallyProgram(): Program {
  const bytes = Buffer.from(tallyBytes());
  return { bytes, sha: sha256(bytes) };
}
/** The program's file under `dir`, as `view3d`'s `assets` entry `{sha256: path}` (#537). */
export function putProgram(dir: string, p: Program): JsonObject {
  const path = join(dir, `${p.sha}.wasm`);
  writeFileSync(path, p.bytes);
  return { [p.sha]: path };
}

/**
 * The drops (criterion 4; judges.ts: DROPS): the item `drops` bursts 1,024 particles at 0 s in a box 0.5 × 1 × 0.5 m
 * centred at (0, 2.5, 0), at rest, under gravity, with nothing to hit, and publishes the reading `in_gate`: its count
 * of particles in the box from (0, 0, −1) to (1, 1.9, 1) m. The logic item `tally` runs the tally program at 60 Hz
 * on its one read, `drops.in_gate`, and writes `seen`; a driver sets the x of the box `gauge` to `tally.seen`, as
 * #265's drivers read a logic item's scalar f64 array, so `evaluate: ["items/gauge/at/pos"]` reads what the logic
 * item wrote at each frame's step. `namesBuffer`: the planted logic item, whose read is `drops.buffer`.
 */
export const DROPPED = bufferOf('drops');
export const READING = 'drops.in_gate';
export const GAUGE_PATH = 'items/gauge/at/pos';
export function dropsDoc(p: Program, o: { namesBuffer?: boolean } = {}): JsonObject {
  return sceneDoc(o.namesBuffer ? 'drops-buffer' : 'drops', {
    cam: camera([3, 2, 6], [0, 1.5, 0]),
    drops: stepped([...DROPS.emitAt], {
      count: DROPS.count, emit: { shape: { box: { size: [...DROPS.emitSize] } }, bursts: [{ t: '0s', count: DROPS.count }] },
      forces: { gravity: [0, -G, 0] }, readings: { in_gate: { count: { box: [[...DROPS.gate[0]], [...DROPS.gate[1]]] } } }, checkpoint: DEFAULT_RING,
    }),
    tally: { kind: 'logic@1', params: { program: p.sha, step_rate: STEP_RATE, reads: [o.namesBuffer ? DROPPED : READING], writes: { seen: { type: 'f64', count: 1, interpolate: 'hold' } } } },
    gauge: markBox([0.1, 0.1, 0.1], [0, -1, 0], 'accent'),
  }, {
    requires: { modules: { scene3d: '^1', effects: '^1', logic: '^1' } }, transport: { span: '2s', frame_rate: [60, 1] },
    drivers: { 'gauge-x': { target: `${GAUGE_PATH}/0`, expr: 'v', vars: { v: 'tally.seen' } } },
  });
}

// ---------------------------------------------------------------------------------------------------
// `view3d` (#378's, with #380's `from` and `timings`, #483's `read`, #484's `seeks`, #252's `carried`, #429's
// `evaluate`, #537's `assets`), and this suite's `bakes` (README).

export const view3dCall = (spec: JsonObject): JsonObject => ({ call: 'view3d', look: LOOK, size: [64, 64], fps: 60, ...spec });

/** A carried output's row on a frame (#252's `carried`). */
export interface Carried { step: number; ringBytes: number; budget: number; checkpoints: number[]; restored: { from: number; steps: number } | null }
export interface V3Frame {
  index: number; frame: number; pixelHash: string | null; final: string | null;
  /** Each output read back: the SHA-256 naming `<sha>.u32` under `out`. */
  read: Map<string, string>;
  carried: Map<string, Carried>;
  passesMs: Map<string, number> | null;
  values: JsonObject | null;
}
/** Why a reply drew nothing, as the binary says it. */
export const refusal = (reply: JsonObject): string => (reply['code'] === undefined ? 'it has no frames' : `${String(reply['code'])}: ${shown(reply['issues'] ?? reply['reason'] ?? reply['message'] ?? reply['what'] ?? reply)}`);
/** A drawn reply's frames; a refusal fails here, saying what the binary answered. */
export function view3dFrames(reply: JsonObject, what: string): V3Frame[] {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'] === undefined && Array.isArray(reply['frames']) ? '' : refusal(reply), `${what}: view3d drew its frames`).toBe('');
  return arr(reply['frames'], `${what}: frames`).map((x, index) => {
    const at = `${what}: frames[${index}]`;
    const f = obj(x, at);
    const read = new Map<string, string>();
    for (const [k, v] of Object.entries(isObject(f['read']) ? f['read'] : {})) if (isObject(v) && typeof v['file'] === 'string') read.set(k, v['file']);
    const carried = new Map(Object.entries(isObject(f['carried']) ? f['carried'] : {}).map(([k, v]) => {
      const c = obj(v, `${at}.carried.${k}`);
      const ring = obj(c['ring'], `${at}.carried.${k}.ring`);
      const restored = isObject(c['restored']) ? c['restored'] : null;
      return [k, {
        step: num(c['step'], `${at}.carried.${k}.step`), ringBytes: num(ring['bytes'], `${at}.carried.${k}.ring.bytes`), budget: num(ring['budget'], `${at}.carried.${k}.ring.budget`),
        checkpoints: arr(ring['checkpoints'], `${at}.carried.${k}.ring.checkpoints`).map((s, j) => num(s, `${at}.carried.${k}.ring.checkpoints[${j}]`)),
        restored: restored ? { from: num(restored['from'], `${at}.carried.${k}.restored.from`), steps: num(restored['steps'], `${at}.carried.${k}.restored.steps`) } : null,
      }] as [string, Carried];
    }));
    const passes = isObject(f['passes_ms']) ? new Map(Object.entries(f['passes_ms']).flatMap(([k, v]): [string, number][] => (typeof v === 'number' ? [[k, v]] : []))) : null;
    return {
      index, frame: num(f['frame'], `${at}.frame`), pixelHash: typeof f['pixel_hash'] === 'string' ? f['pixel_hash'] : null, final: typeof f['final'] === 'string' ? f['final'] : null,
      read, carried, passesMs: passes, values: isObject(f['values']) ? f['values'] : null,
    };
  });
}
/** The frames numbered `n`, in the order drawn (a seek draws a number again). */
export const framesNumbered = (frames: readonly V3Frame[], n: number): V3Frame[] => frames.filter((f) => f.frame === n);
/** The one frame numbered `n`, or a failure naming it. */
export function frameAt(frames: readonly V3Frame[], n: number, what: string): V3Frame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what} drew frame ${n}`).toBeDefined();
  return f!;
}
/** The carried row `key` on a frame, or a failure naming the frame and what it reports. */
export function carriedOn(f: V3Frame, key: string, what: string): Carried {
  const c = f.carried.get(key);
  expect(c, `${what}: frame ${f.frame} (reply entry ${f.index}) reports carried.${key}; it reports ${[...f.carried.keys()].join(', ') || 'no carried output'}`).toBeDefined();
  return c!;
}
/** The ring's rows of `key` over every frame of a play, for judges.ts's ringProblems. */
export const ringRows = (frames: readonly V3Frame[], key: string, what: string): RingRow[] =>
  frames.map((f) => { const c = carriedOn(f, key, what); return { frame: f.frame, step: c.step, bytes: c.ringBytes, budget: c.budget, checkpoints: c.checkpoints }; });
/** Every checkpoint step a play's frames report for `key`, in order. */
export function checkpointsTaken(frames: readonly V3Frame[], key: string, what: string): number[] {
  const taken = new Set<number>();
  for (const f of frames) for (const s of carriedOn(f, key, what).checkpoints) taken.add(s);
  return [...taken].sort((a, b) => a - b);
}
/** A buffer as a frame read it (#483's `read`): its SHA-256, which names its file, and its f32 words. */
export interface Buffered { hash: string; words: Float32Array; bytes: Buffer }
export function bufferOn(out: string, f: V3Frame, key: string, what: string): Buffered {
  const file = f.read.get(key);
  expect(file, `${what}: frame ${f.frame} (reply entry ${f.index}) read ${key}; it read ${[...f.read.keys()].join(', ') || 'nothing'}`).toBeDefined();
  expect(file!, `${what}: ${key}'s file is named by its SHA-256`).toMatch(SHA);
  const b = readFileSync(join(out, `${file!}.u32`));
  expect(sha256(b), `${what}: the SHA-256 of ${key}'s file is its name`).toBe(file!);
  expect(b.byteLength % 4, `${what}: ${key} is whole 32-bit words`).toBe(0);
  return { hash: file!, words: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), bytes: b };
}
/** The GPU time of an item's steps in a frame (README: `timings`): the sum of `passes_ms`'s `op.<item>` and
 * `op.<item>.…` entries, or null when the frame holds none. */
export function stepMs(f: V3Frame, item: string): number | null {
  const own = [...(f.passesMs ?? [])].filter(([k]) => k === `op.${item}` || k.startsWith(`op.${item}.`));
  return own.length ? own.reduce((sum, [, ms]) => sum + ms, 0) : null;
}
/** The key a reply names the buffer's bake by (README: `bakes`), or null. */
export function bakeKey(reply: JsonObject, key: string): string | null {
  const b = isObject(reply['bakes']) ? reply['bakes'][key] : undefined;
  return isObject(b) && typeof b['key'] === 'string' ? b['key'] : null;
}

// ---------------------------------------------------------------------------------------------------
// `golden` and `decide` (#380's, with #252's `read`, `state` and `class`).

export const blessState = (store: string, fixture: string, state: string): JsonObject =>
  ({ call: 'decide', via: 'you', store, decision: { bless: { fixture, state } } });
export const goldenState = (store: string, fixture: string, view3d: JsonObject, key: string, environment?: JsonObject): JsonObject =>
  ({ call: 'golden', store, fixture, oracle: 'hash', view3d, read: key, ...(environment ? { environment } : {}) });
/** A golden reply, as judges.ts's secondMachineProblems reads it. */
export function goldenRead(reply: JsonObject): GoldenRead & { raw: JsonObject } {
  const text = (v: JsonValue | undefined): string | null => (typeof v === 'string' ? v : null);
  const fp = isObject(reply['fingerprint']) ? reply['fingerprint'] : {};
  const g = isObject(reply['golden']) && isObject(reply['golden']['fingerprint']) ? reply['golden']['fingerprint'] : {};
  return {
    verdict: text(reply['verdict']), reason: text(reply['reason']), cls: text(reply['class']), gpu: text(fp['gpu']), recordedGpu: text(g['gpu']),
    numbers: isObject(reply['numbers']), text: JSON.stringify(reply), raw: reply,
  };
}

// ---------------------------------------------------------------------------------------------------
// A recording: the canvas's own PNG frames, all of one IHDR, put into an animated PNG as they are, their compressed
// image data moved into fdAT chunks unchanged, so the recording holds exactly the frames the canvas wrote (#252's).

function chunks(png: Buffer, what: string): { type: string; data: Buffer }[] {
  expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${what} is a PNG`).toBe(true);
  const out: { type: string; data: Buffer }[] = [];
  for (let o = 8; o < png.length;) {
    const len = png.readUInt32BE(o);
    out.push({ type: png.toString('latin1', o + 4, o + 8), data: png.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
  }
  return out;
}
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
/** An animated PNG of the canvas's PNG frames at `fps`, looping. */
export function apng(frames: Buffer[], fps: number, what: string): Buffer {
  expect(frames.length, `${what} holds frames`).toBeGreaterThan(0);
  const parsed = frames.map((f, i) => chunks(f, `${what}: frame ${i}`));
  const ihdr = parsed[0]!.find((c) => c.type === 'IHDR')!.data;
  parsed.forEach((p, i) => expect(p.find((c) => c.type === 'IHDR')?.data.equals(ihdr), `${what}: frame ${i} has the first frame's size and format`).toBe(true));
  const width = ihdr.readUInt32BE(0); const height = ihdr.readUInt32BE(4);
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0);
  const extra = parsed[0]!.filter((c) => !['IHDR', 'IDAT', 'IEND', 'acTL', 'fcTL', 'fdAT'].includes(c.type)).map((c) => chunk(c.type, c.data));
  const parts: Buffer[] = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra, chunk('acTL', actl)];
  let seq = 0;
  parsed.forEach((p, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(width, 4); fctl.writeUInt32BE(height, 8); fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22);
    parts.push(chunk('fcTL', fctl));
    const data = Buffer.concat(p.filter((c) => c.type === 'IDAT').map((c) => c.data));
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++, 0); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
/** A frame's final PNG as the canvas wrote it, named by its SHA-256 under `out`. */
export function finalPng(out: string, f: V3Frame, what: string): Buffer {
  expect(f.final ?? '', `${what}: frame ${f.frame}'s final PNG is named by its SHA-256`).toMatch(SHA);
  const b = readFileSync(join(out, `${f.final!}.png`));
  expect(sha256(b), `${what}: the PNG's SHA-256 is its name`).toBe(f.final);
  return b;
}
