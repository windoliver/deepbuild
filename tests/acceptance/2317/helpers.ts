// Test-side tools for the #2317 acceptance tests (README: The surface under test). They drive the physics runner
// `deep-physics` (JSON lines in, one reply per line) through #191's builds, its wasm32 script and the merge base's
// build, and #2011's step-budget check, as #2308's, #2309's, #2306's and #1921's suites do, and add only this issue's
// worlds, its two planted names and its judges. Nothing here stands in for the solver, the wrapper, the behavior kit or
// the budget check: every body state, kit row and timing read here is the implementation's own, and every expected
// value is the issue's, copied or worked here from its words.
//
// No function here asserts. What a program answers and what a judge finds wrong with it both come back as text, so
// each test's failing assertion is in its own file; a reply that can't be read comes back as a sentence starting
// `INCONCLUSIVE:`, which fails its test like any other. Only a process that can't be run at all throws, `BLOCKED:` or
// `INCONCLUSIVE:` first, as the base's suites do: nothing unrun or unread passes.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import {
  CARGO_ENV, G, REPO, TIMEOUT, WASM32_SCRIPT, isObject, mergeBase, mergeBasePhysics, physicsBin, show,
  type JsonObject, type JsonValue,
} from '../191/helpers.ts';
import { BUDGET_SCRIPT } from '../2011/helpers.ts';
import {
  CUBE, EDGE_SPEED, EDGE_START, SIDE, STACK_TOP, STACK_WITHIN, TOP, differences, edge, kitOf, rowFailures, speedOf,
  stack, statesOf, type KitRow, type Small, type State,
} from '../2308/helpers.ts';
import { cube, stackWorld } from '../2309/helpers.ts';

export { G, REFERENCE, TIMEOUT, WASM32, kitCall, prebuild, show, type JsonObject, type JsonValue } from '../191/helpers.ts';
export { CUBE, SIDE, TOP, edgeRead, type EdgeRead } from '../2308/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = { 1: '#2317.0a959d8a', 2: '#2317.74dfcf37', 3: '#2317.ebf76689', 4: '#2317.122f57d7', 5: '#2317.c14f39c6' } as const;

/** This suite's planted names (`deep-physics --planted <name>`), each a wrong wrapper its criteria name (README). */
export type Planted = 'wrapper_leaves_contact_reuse_on' | 'wrapper_turns_contact_reuse_off';
/** The wrapper that leaves the backend's contact reuse on, as the merge base's does (criteria 1 and 3). */
export const REUSE_ON: Planted = 'wrapper_leaves_contact_reuse_on';
/** The wrapper that turns the backend's contact reuse off for every world (criterion 3). */
export const REUSE_OFF: Planted = 'wrapper_turns_contact_reuse_off';

/** A test that reads the merge base's build, which may have to be built first. */
export const BASE_TIMEOUT = 4 * TIMEOUT;

// ---------------------------------------------------------------------------------------------------
// The runner: this checkout's release build (#191's `release`), its wasm32 build and the merge base's release build.

/**
 * What one process answered: `problem` is '' and `replies` holds one object per call, or `problem` says what the
 * program did instead (a planted name it doesn't know exits 2 with `bad_input`).
 */
export interface Asked { what: string; problem: string; replies: JsonObject[] }

const MINUTES = (TIMEOUT - 300_000) / 60_000;
function runOn(bin: string, args: string[], calls: JsonObject[], what: string, env?: NodeJS.ProcessEnv): Asked {
  const run = spawnSync(bin, args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL', ...(env ? { env } : {}) });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  const no = (problem: string): Asked => ({ what, problem, replies: [] });
  if (code === 'ETIMEDOUT') throw Error(`INCONCLUSIVE: ${what} didn't finish within ${MINUTES} minutes`);
  if (run.error && code !== 'EPIPE') throw Error(`BLOCKED: ${what} couldn't be run: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  if (run.status !== 0) return no(`${what} exits ${String(run.status)}, not 0; stdout: ${stdout.trim().slice(0, 600)}; stderr: ${(run.stderr ?? '').trim().slice(-600)}`);
  const lines = stdout.split('\n').filter((l) => l !== '');
  if (lines.length !== calls.length) return no(`${what} wrote ${lines.length} replies to ${calls.length} calls; stdout: ${stdout.slice(0, 600)}`);
  const replies: JsonObject[] = [];
  for (const [i, line] of lines.entries()) {
    let v: JsonValue;
    try { v = JSON.parse(line) as JsonValue; } catch { return no(`${what}: reply ${i} isn't JSON: ${line.slice(0, 300)}`); }
    if (!isObject(v)) return no(`${what}: reply ${i} isn't an object: ${line.slice(0, 300)}`);
    replies.push(v);
  }
  return { what, problem: '', replies };
}

/**
 * Runs `calls` through one `deep-physics [--planted p]` process of this checkout's release build. A planted name the
 * build doesn't know comes back as `problem`, never a throw.
 */
export function ask(calls: JsonObject[], planted?: Planted): Asked {
  const args = planted ? ['--planted', planted] : [];
  return runOn(physicsBin('release'), args, calls, `deep-physics ${args.join(' ')}`.trim());
}

/** Runs `calls` through this checkout's physics crate built for wasm32 (`node scripts/physics-wasm32.mjs`, as #191's first criterion runs the kit there). */
export function askWasm32(calls: JsonObject[]): Asked {
  return runOn(process.execPath, [WASM32_SCRIPT], calls, 'deep-physics on wasm32 (node scripts/physics-wasm32.mjs)', { ...process.env, ...CARGO_ENV });
}

let baseDir = '';
let base: { sha: string; bin: string; problem: string } | undefined;
/** A file that reads the merge base calls this once: its copy of the merge base's binary goes when the file ends. */
export function withBase(): void {
  afterAll(() => { if (baseDir) rmSync(baseDir, { recursive: true, force: true }); baseDir = ''; base = undefined; }, TIMEOUT);
}
/**
 * The merge base (`git merge-base HEAD origin/main`) and its release `deep-physics`, built as #191's
 * `mergeBasePhysics` builds it, once for the file. With no merge base to name, or none that builds, nothing can be
 * compared with it: it throws `BLOCKED:`.
 */
export function baseBin(): { sha: string; bin: string } {
  if (!base) {
    let sha = '';
    let problem = '';
    try { sha = mergeBase(); } catch (e) { problem = `git merge-base HEAD origin/main names no merge base: ${(e as Error).message.split('\n')[0] ?? ''}`; }
    let bin = '';
    if (sha !== '') {
      baseDir = mkdtempSync(join(tmpdir(), 'deep-2317-base-'));
      bin = join(baseDir, 'deep-physics-base');
      let error: string;
      try { error = mergeBasePhysics(sha, bin); } catch (e) { error = (e as Error).message; }
      if (error !== '') problem = `the merge base ${sha.slice(0, 12)} gives no release deep-physics: ${error.replace(/^BLOCKED: /, '')}`;
    }
    base = { sha, bin, problem };
  }
  if (base.problem !== '') throw Error(`BLOCKED: ${base.problem}`);
  return { sha: base.sha, bin: base.bin };
}
/** Runs `calls` through the merge base's release deep-physics. */
export function askBase(calls: JsonObject[]): Asked & { sha: string } {
  const { sha, bin } = baseBin();
  return { ...runOn(bin, [], calls, `the merge base's deep-physics (${sha.slice(0, 12)})`), sha };
}

// ---------------------------------------------------------------------------------------------------
// Worlds. Criteria 1, 2 and 5's are at the behavior kit's own settings (crates/deep-canvas-physics/src/kit/fixtures.rs):
// 120 Hz, 4 substeps, g = 9.81 m/s², its capacity, a dynamic body with `sleep: false`, and no `solver` written.

export type Vec3 = [number, number, number];
export const RATE = 120;
/** "Every step of the 6 s": the states after steps 1 to 720, and the built one before them. */
export const STEPS = 6 * RATE;
const kitWorld = (parts: JsonObject): JsonObject => ({
  kind: 'physics.world@1', dimensions: 3, step_rate: RATE, substeps: 4, gravity: [0, -G, 0], mode: 'dynamic',
  capacity: { bodies: 32, shapes: 32, joints: 4, contacts: 128, particles: 0 },
  contact_materials: { m: { friction: 0.5, restitution: 0, density: 1000 } },
  ...parts,
});
const uses = (shape: string): JsonObject[] => [{ shape, contact_material: 'm' }];
/** A scene holding `worlds`, its items by ID (each gets its `id`, `name` and `order`), 6 s long. */
function scene(title: string, items: Record<string, JsonObject>, extra: JsonObject): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(items)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: an acceptance scene of issue #2317.`, size: [640, 360], camera: 'cam',
    transport: { span: '6s', frame_rate: [60, 1] }, requires: { modules: { scene3d: '^1' } }, ...extra, items: withIds,
  };
}
const CAMERA: JsonObject = { kind: 'camera@1', params: { projection: 'perspective', position: [0, 12, 24], target: [0, 0, 0], fov: 40 } };
const mark = (size: Vec3, pos: Vec3): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos } });

/** The box of criteria 1 and 2: 1 kg, half extent 0.25 m, friction 0.5, resting on a top face at y = 0 at (x, ·, 0). */
export const BOX = 'box';
const BOX_SHAPE: JsonObject = { kind: 'box', half: [0.25, 0.25, 0.25] };
const boxAt = (x: number): JsonObject => ({ kind: 'dynamic', shapes: uses('box'), pose: { pos: [x, 0.25, 0] }, sleep: false, mass: 1 });

// --- The turntable (criteria 1 and 5) ---
/** The world's ID in its scene, the disc, its hinge, and the item path its motor's target reads. */
export const TABLE = 'table';
export const DISC = 'disc';
export const AXLE = 'axle';
export const DIAL = 'items/dial/at/pos/0';
/** The motor's target rises from 0 over the first 2 s, 240 steps, and is held 4 s: to 90°/s, or to 30°/s. */
export const RISE = 2 * RATE;
export const FAST = 90;
export const SLOW = 30;
/** "Set 1 m from the axis": the axis is the vertical through the origin, the box's centre at (1, 0.25, 0). */
export const FROM_AXIS = 1;
/**
 * The turntable's world, which the kit's `turntable` holds field for field: a dynamic disc of 20,000 kg, radius 30 m
 * and 0.2 m thick, its top face y = 0, on a hinge to the world about +Y through its centre, whose velocity motor
 * reads its target, deg/s, from the item path `items/dial/at/pos/0`; and the box set on it 1 m from the axis.
 */
export function turntableWorld(): JsonObject {
  return kitWorld({
    shapes: { disc: { kind: 'cylinder', half_height: 0.1, radius: 30 }, box: BOX_SHAPE },
    bodies: {
      [DISC]: { kind: 'dynamic', shapes: uses('disc'), pose: { pos: [0, -0.1, 0] }, sleep: false, mass: 20000 },
      [BOX]: boxAt(FROM_AXIS),
    },
    joints: {
      [AXLE]: {
        kind: 'hinge', a: 'world', b: DISC, frame_a: { anchor: [0, -0.1, 0], axis: [0, 1, 0] }, frame_b: { anchor: [0, 0, 0], axis: [0, 1, 0] },
        motor: { mode: 'velocity', target: DIAL, max_torque: 100000000, hz: 30, damping_ratio: 1 },
      },
    },
  });
}
/** The scene that lists the turntable's world as `table`: its channel `dial` rises linearly from 0 at 0 s to `top` at 2 s and holds it. */
export function turntableScene(top: number): JsonObject {
  return scene('A box on a turntable', { cam: CAMERA, dial: mark([0.1, 0.1, 0.1], [0, 0, 5]) }, {
    channels: { dial: { target: DIAL, type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '2s', value: top, interp: 'hold' } } } },
    worlds: { [TABLE]: turntableWorld() },
  });
}
export const turntableBake = (top: number): JsonObject => ({ call: 'bake', scene: turntableScene(top), world: TABLE, steps: STEPS, read: [BOX, DISC] });
/** The turntable as the behavior kit holds it (README: The fixture in the behavior kit). */
export const TURNTABLE: Small = { name: 'turntable', world: turntableWorld(), steps: STEPS };
export const TURNTABLE_RAMPS: JsonObject = { [AXLE]: { to: FAST, steps: RISE } };
export const TURNTABLE_ANSWER = FROM_AXIS;
/** "Within 0.06 m of 1 m from the axis"; "with 30°/s in place of 90°/s it is within 0.01 m". */
export const WITHIN_FAST = 0.06;
export const WITHIN_SLOW = 0.01;

// --- The straight platform (criterion 2) ---
export const RIDE = 'ride';
export const PLATFORM = 'platform';
const FLICKS = 705_600_000;
/** Where the platform's channel puts it along x after step k: t² m through the first second (2 m/s² to 2 m/s), then 2 m/s; 11 m at 6 s. */
export const platformAt = (k: number): number => (k <= RATE ? (k / RATE) ** 2 : 1 + (2 * (k - RATE)) / RATE);
/**
 * The scene that lists the platform's world as `ride`: a kinematic platform 4 × 0.2 × 4 m of friction 0.5, its top
 * face y = 0, following the channel `deck` along +x, a key at every step of the first second and one at 6 s, linear
 * between (as #2306's platform ramps); and the box set on its middle.
 */
export function platformScene(): JsonObject {
  const keys: JsonObject = {};
  const key = (k: number): void => { keys[`k${String(Object.keys(keys).length).padStart(3, '0')}`] = { t: (k * FLICKS) / RATE, value: [platformAt(k), -0.1, 0], interp: 'linear' }; };
  for (let k = 0; k <= RATE; k += 1) key(k);
  key(STEPS);
  const ride = kitWorld({
    shapes: { deck: { kind: 'box', half: [2, 0.1, 2] }, box: BOX_SHAPE },
    bodies: {
      [PLATFORM]: { kind: 'kinematic', shapes: uses('deck'), pose: { pos: [0, -0.1, 0] }, follow: 'items/platform/at/pos' },
      [BOX]: boxAt(0),
    },
  });
  return scene('A box on a platform that moves in a straight line', { cam: CAMERA, platform: mark([4, 0.2, 4], [0, -0.1, 0]) }, {
    channels: { deck: { target: 'items/platform/at/pos', type: 'vec3', keys } },
    worlds: { [RIDE]: ride },
  });
}
export const platformBake = (): JsonObject => ({ call: 'bake', scene: platformScene(), world: RIDE, steps: STEPS, read: [BOX, PLATFORM] });

// --- What rested (criterion 3) ---
/** #2309's stacks of 1 m cubes, baked 6 s: at the world's default contact frequency, or at `contact_hz: 80`. */
export const bigStackBake = (n: number, contactHz?: number): JsonObject =>
  ({ call: 'bake', world: stackWorld(n, contactHz === undefined ? {} : { contactHz }), steps: STEPS });
/**
 * The edge: #2308's 1 cm cube of friction 0 and its static table at `step_rate: 480` with no `solver` written, so
 * contacts at the default 30 Hz and a solver length of 1 m. The cube starts 11 steps of its slide before #2308's start
 * (four sides before the edge), so it passes that start after step 11 and every later position is #2308's (README:
 * The worlds, the edge).
 */
export const EDGE_LEAD = 11;
export const EDGE_STEPS = 120;
export function edgeWorld(): JsonObject {
  const w = edge({ contactHz: null, lengthUnit: null }).world;
  const bodies = isObject(w['bodies']) ? w['bodies'] : {};
  const body = isObject(bodies[CUBE]) ? bodies[CUBE] : {};
  body['pose'] = { pos: [EDGE_START - (EDGE_LEAD * EDGE_SPEED) / 480, SIDE / 2, 0] };
  return w;
}
export const edgeBake = (): JsonObject => ({ call: 'bake', world: edgeWorld(), steps: EDGE_STEPS, read: [CUBE] });
/** #2308's stack of five 1 cm cubes at `step_rate: 480`, `contact_hz: 240` and `length_unit: 0.01`, baked its 3 s. */
export const SMALL_STACK = stack();
export const smallStackBake = (): JsonObject => ({ call: 'bake', world: SMALL_STACK.world, steps: SMALL_STACK.steps });

// ---------------------------------------------------------------------------------------------------
// The judges. Each reads one bake and returns what the criterion's words read of it (printed by the tests) and
// everything wrong with it as sentences, each starting with what its criterion says a failure names.

export interface Judged { failures: string[]; measured: number | null }
const mm = (m: number): string => `${(m * 1000).toFixed(3)} mm`;
/** A point's distance from the vertical through the origin, m. */
const fromAxis = (p: readonly number[]): number => Math.hypot(p[0]!, p[2]!);
/** A point's angle about +Y, deg (`atan2(−z, x)`), so a turn about +Y adds to it. */
const around = (p: readonly number[]): number => (Math.atan2(-p[2]!, p[0]!) * 180) / Math.PI;
/** Where a unit quaternion [x, y, z, w] turns the body's own +X. */
const ownX = (q: readonly number[]): Vec3 => {
  const [x, y, z, w] = [q[0]!, q[1]!, q[2]!, q[3]!];
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)];
};
/** The whole turn a series of angles makes, deg: each step's change taken within (−180°, 180°], summed. */
function turned(angles: readonly number[]): number {
  let sum = 0;
  for (let k = 1; k < angles.length; k += 1) {
    let d = angles[k]! - angles[k - 1]!;
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    sum += d;
  }
  return sum;
}

// --- The turntable (criterion 1) ---
export interface RideRead extends Judged {
  /** The first step after which the box's centre is more than the bound from 1 m from the axis; null when none is. */
  first: number | null;
  /** The box's distance from the axis after each whole second, 0 s to 6 s, m. */
  seconds: number[];
  /** How far the box has gone around the axis, and how far the disc has turned, over the 6 s, deg. */
  boxTurn: number | null;
  discTurn: number | null;
}
/**
 * "The box's centre is within `bound` m of 1 m from the axis at every step of the 6 s", read from the box's states:
 * its distance from the axis (x and z) after each step. A failure names the box and the first step past the bound.
 * The run's premises are judged too, so a disc that never turned, or a box left where it was built, can't pass: the
 * disc turns at half its target at 1 s and at its target at 2 s and at 6 s, each within 1% of the target (the kit's
 * hinge motor), and the box has gone around the axis more than half the disc's own turn. `measured` is the distance
 * at the step farthest from 1 m, which the kit's row lists.
 */
export function rideRead(reply: JsonObject, top: number, bound: number, what: string): RideRead {
  const none = (why: string): RideRead => ({ failures: [why], measured: null, first: null, seconds: [], boxTurn: null, discTurn: null });
  const box = statesOf(reply, BOX, STEPS, what);
  if (typeof box === 'string') return none(box);
  const disc = statesOf(reply, DISC, STEPS, what);
  if (typeof disc === 'string') return none(disc);
  const far = box.map((s) => fromAxis(s.pos));
  const off = (k: number): number => Math.abs(far[k]! - FROM_AXIS);
  const first = far.findIndex((_, k) => !(off(k) <= bound));
  let worst = 0;
  for (let k = 1; k <= STEPS; k += 1) if (off(k) > off(worst)) worst = k;
  const [boxTurn, discTurn] = [turned(box.map((s) => around(s.pos))), turned(disc.map((s) => around(ownX(s.rot))))];
  const failures: string[] = [];
  if (first >= 0) failures.push(`${BOX}: ${what}: its centre is ${far[first]!.toFixed(4)} m from the axis after step ${first}, the first step past ${bound} m of ${FROM_AXIS} m; after step ${STEPS}, at 6 s, it is ${far[STEPS]!.toFixed(3)} m from it`);
  for (const [k, want] of [[RATE, top / 2], [RISE, top], [STEPS, top]] as const) {
    const rate = disc[k]!.angular[1];
    if (!(Math.abs(rate - want) <= 0.01 * top)) failures.push(`${DISC}: ${what}: it turns at ${rate.toFixed(3)} deg/s about +Y after step ${k}, not ${want} deg/s within 1% of its motor's ${top} deg/s`);
  }
  if (!(Math.abs(boxTurn) > Math.abs(discTurn) / 2 && boxTurn * discTurn > 0)) failures.push(`${BOX}: ${what}: it has gone ${boxTurn.toFixed(2)}° around the axis where the disc has turned ${discTurn.toFixed(2)}°, not more than half of it, so the disc didn't carry it`);
  return { failures, measured: far[worst]!, first: first < 0 ? null : first, seconds: [0, 1, 2, 3, 4, 5, 6].map((s) => far[s * RATE]!), boxTurn, discTurn };
}
export const shownSeconds = (r: RideRead): string => r.seconds.map((d, s) => `${s} s ${d.toFixed(3)} m`).join(', ');

// --- The straight platform (criterion 2) ---
/** "Within 1 mm of its place on it". */
export const PLACE_WITHIN = 0.001;
export interface PlaceRead extends Judged { step: number | null }
/**
 * "Within 1 mm of its place on it at every step": the box's offset from the platform, along the platform (x and z),
 * against that offset as built, after each step. A failure names the box and the first step past 1 mm. The premise is
 * judged too: the platform is where its channel puts it after every step (1 m at 1 s, 11 m at 6 s), within 0.01 mm.
 */
export function placeRead(reply: JsonObject, what: string): PlaceRead {
  const box = statesOf(reply, BOX, STEPS, what);
  if (typeof box === 'string') return { failures: [box], measured: null, step: null };
  const deck = statesOf(reply, PLATFORM, STEPS, what);
  if (typeof deck === 'string') return { failures: [deck], measured: null, step: null };
  const place = (k: number): number => Math.hypot(box[k]!.pos[0] - deck[k]!.pos[0] - (box[0]!.pos[0] - deck[0]!.pos[0]), box[k]!.pos[2] - deck[k]!.pos[2] - (box[0]!.pos[2] - deck[0]!.pos[2]));
  const failures: string[] = [];
  const stray = deck.findIndex((s, k) => !(Math.hypot(s.pos[0] - platformAt(k), s.pos[1] - deck[0]!.pos[1], s.pos[2]) <= 1e-5));
  if (stray >= 0) failures.push(`${PLATFORM}: ${what}: after step ${stray} it is at ${show(deck[stray]!.pos)}, where its channel puts it ${platformAt(stray)} m along x`);
  const first = box.findIndex((_, k) => !(place(k) <= PLACE_WITHIN));
  let worst = 0;
  for (let k = 1; k <= STEPS; k += 1) if (place(k) > place(worst)) worst = k;
  if (first >= 0) failures.push(`${BOX}: ${what}: it is ${mm(place(first))} from its place on the platform after step ${first}, the first step past 1 mm; its farthest is ${mm(place(worst))}, after step ${worst}`);
  return { failures, measured: place(worst), step: first < 0 ? null : first };
}
/** The same bake with the box left where it was built at every step: what a platform that carried nothing would leave. */
export function leftBehind(reply: JsonObject): JsonObject {
  const bodies = isObject(reply['bodies']) ? reply['bodies'] : {};
  const series = Array.isArray(bodies[BOX]) ? bodies[BOX] : [];
  return { ...reply, bodies: { ...bodies, [BOX]: series.map(() => series[0] ?? null) } };
}

// --- The stacks of 1 m cubes (criterion 3) ---
/** "Slower than 1 mm/s throughout the sixth second": the states after steps 601 to 720. */
export const STILL = 0.001;
/** "The top one ends 5.87 mm below 4.5 m within 0.3 mm". */
export const SINK = 0.00587;
export const SINK_WITHIN = 0.0003;
export interface RestRead { failures: string[]; fastest: number | null; low: number | null }
/**
 * A stack of `n` 1 m cubes at rest: every cube moves slower than 1 mm/s in every state of the sixth second, and, when
 * `sinks`, the top one's centre ends 5.87 mm below where it was built within 0.3 mm. Each failure names its cube.
 */
export function restRead(reply: JsonObject, n: number, sinks: boolean, what: string): RestRead {
  const all: State[][] = [];
  for (let k = 1; k <= n; k += 1) {
    const s = statesOf(reply, cube(k), STEPS, what);
    if (typeof s === 'string') return { failures: [s], fastest: null, low: null };
    all.push(s);
  }
  const failures: string[] = [];
  let fastest = 0;
  all.forEach((s, i) => {
    let [speed, step] = [-1, 5 * RATE + 1];
    for (let k = 5 * RATE + 1; k <= STEPS; k += 1) if (speedOf(s[k]!) > speed) [speed, step] = [speedOf(s[k]!), k];
    fastest = Math.max(fastest, speed);
    if (!(speed < STILL)) failures.push(`${cube(i + 1)}: ${what}: it moves ${(speed * 1000).toFixed(3)} mm/s after step ${step}, in the sixth second, not slower than 1 mm/s`);
  });
  const top = all[n - 1]!;
  const low = top[0]!.pos[1] - top[STEPS]!.pos[1];
  if (sinks && !(Math.abs(low - SINK) <= SINK_WITHIN)) failures.push(`${cube(n)}: ${what}: the top one ends ${mm(low)} below ${top[0]!.pos[1]} m, not ${mm(SINK)} within ${mm(SINK_WITHIN)}`);
  return { failures, fastest, low };
}

// --- The stack of five 1 cm cubes (criterion 3) ---
export interface SmallRead { failures: string[]; low: number | null }
/**
 * "End with the top one's centre within 2% of a side of 4.5 sides up": where the top cube's centre is after the last
 * step of #2308's 3 s. Each failure names the top body.
 */
export function smallStackRead(reply: JsonObject, what: string): SmallRead {
  const top = statesOf(reply, TOP, SMALL_STACK.steps, what);
  if (typeof top === 'string') return { failures: [top], low: null };
  const y = top[SMALL_STACK.steps]!.pos[1];
  const low = STACK_TOP - y;
  const failures = Math.abs(low) <= STACK_WITHIN ? [] : [`${TOP}: ${what}: the top cube's centre ends ${(y / SIDE).toFixed(4)} sides up, ${((Math.abs(low) / SIDE) * 100).toFixed(1)}% of a side ${low > 0 ? 'below' : 'above'} 4.5 sides, not within 2% of a side`];
  return { failures, low };
}

// ---------------------------------------------------------------------------------------------------
// The turntable in the behavior kit's data (README: The fixture in the behavior kit), read from the base's
// `behavior_fixtures` and `behavior_kit` calls.

export const TURNTABLE_TOLERANCE: JsonObject = { m: WITHIN_FAST };
/**
 * The kit's part of criteria 1 and 5: everything wrong with its data for the turntable (held once, with this suite's
 * world, its 720 steps, its ramp, the answer 1 m and the tolerance 0.06 m) and with its one row read as `result` on
 * the reference backend, whose `measured` is held within a micrometre of `measured`, this suite's reading of the same
 * world's bake on the same program; and the row, for what the criterion says a fail names.
 */
export function kitFailures(fixtures: JsonObject, report: JsonObject, result: 'pass' | 'fail', measured: number | null, backend: string, on: string): { failures: string[]; row: KitRow | null } {
  const k = kitOf(fixtures, report, TURNTABLE, on);
  if (typeof k === 'string') return { failures: [k], row: null };
  const out: string[] = [];
  const name = TURNTABLE.name;
  const world = differences(k.data['world'], TURNTABLE.world);
  if (world.length) out.push(`${name}: the kit's world isn't the criterion's world as this suite builds it (README: The worlds); it differs at ${world.slice(0, 8).join('; ')}${world.length > 8 ? `; and ${world.length - 8} more` : ''}`);
  if (k.data['steps'] !== STEPS) out.push(`${name}: the kit runs it ${show(k.data['steps'])} steps, not ${STEPS}`);
  if (differences(k.data['ramps'], TURNTABLE_RAMPS).length) out.push(`${name}: the kit's ramps are ${show(k.data['ramps'])}, not ${show(TURNTABLE_RAMPS)}: the motor of ${AXLE} rising to ${FAST} deg/s over its first ${RISE} steps`);
  if (differences(k.data['answer'], TURNTABLE_ANSWER).length) out.push(`${name}: the kit's answer is ${show(k.data['answer'])}, not ${TURNTABLE_ANSWER}`);
  if (differences(k.data['tolerance'], TURNTABLE_TOLERANCE).length) out.push(`${name}: the kit's tolerance is ${show(k.data['tolerance'])}, not ${show(TURNTABLE_TOLERANCE)}`);
  return { failures: [...out, ...rowFailures(k, TURNTABLE, result, measured, backend)], row: k.row };
}

// ---------------------------------------------------------------------------------------------------
// The step budget (#2011's `node scripts/physics-budget.mjs`), asked for #1921's 800-body world with the merge base's
// build to compare with (README: The budget report).

export interface BudgetRequest { scene: JsonObject; world: string; steps: number; reference_mac: { app: boolean; web: boolean }; before: string }
/** Runs the check on `request`: its one JSON report, or, as text, why there is none. */
export function budget(request: BudgetRequest): { problem: string; report: JsonObject } {
  const what = 'node scripts/physics-budget.mjs';
  const r = spawnSync(process.execPath, [BUDGET_SCRIPT], { cwd: REPO, input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, ...CARGO_ENV }, timeout: 2 * TIMEOUT, killSignal: 'SIGKILL' });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ETIMEDOUT') throw Error(`INCONCLUSIVE: ${what} didn't finish within ${(2 * TIMEOUT) / 60_000} minutes`);
  if (r.error && code !== 'EPIPE') throw Error(`BLOCKED: ${what} couldn't be run: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const no = (problem: string): { problem: string; report: JsonObject } => ({ problem, report: {} });
  if (r.status !== 0) return no(`${what} exits ${String(r.status)}, not 0; stdout: ${stdout.trim().slice(0, 600)}; stderr: ${(r.stderr ?? '').trim().slice(-1500)}`);
  const lines = stdout.split('\n').filter((l) => l.trim() !== '');
  if (lines.length !== 1) return no(`${what} wrote ${lines.length} report lines, not one: ${stdout.slice(0, 600)}`);
  let v: JsonValue;
  try { v = JSON.parse(lines[0]!) as JsonValue; } catch { return no(`${what}: its report isn't JSON: ${lines[0]!.slice(0, 300)}`); }
  if (!isObject(v) || v['ok'] !== true) return no(`${what}: the check didn't run (ok: true): ${show(v).slice(0, 600)}`);
  return { problem: '', report: v };
}
const fiveMs = (v: JsonValue | undefined): v is number[] => Array.isArray(v) && v.length === 5 && v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0);
/** The app host of a report, and its step's p50 and p95 before and after, five runs each, ms; null where the report lists none. */
export function stepTimes(report: JsonObject): { app: JsonObject; before: { p50: number[]; p95: number[] } | null; after: { p50: number[]; p95: number[] } | null } {
  const hosts = isObject(report['hosts']) ? report['hosts'] : {};
  const app = isObject(hosts['app']) ? hosts['app'] : {};
  const of = (v: JsonValue | undefined): { p50: number[]; p95: number[] } | null => (isObject(v) && fiveMs(v['p50']) && fiveMs(v['p95']) ? { p50: v['p50'], p95: v['p95'] } : null);
  return { app, before: of(app['before']), after: of(app['after']) };
}
/**
 * Everything wrong with "the report lists the step's p50 and p95 before and after": `hosts.app.before` and
 * `hosts.app.after` each `{p50, p95}`, five runs' medians and 95th percentiles of a step, ms; a run's p50 over its
 * p95; `after.p95` anything but the runs the verdict is judged on; or `before` a copy of `after`, so nothing was
 * timed on the merge base's build.
 */
export function comparedFailures(report: JsonObject): string[] {
  const { app, before, after } = stepTimes(report);
  const out: string[] = [];
  for (const [name, side] of [['before', before], ['after', after]] as const) {
    if (!side) { out.push(`hosts.app.${name} is ${show(app[name])}, not {p50, p95}: five runs' step p50s and five runs' step p95s, ms`); continue; }
    side.p50.forEach((p, i) => { if (!(p <= side.p95[i]!)) out.push(`hosts.app.${name}: run ${i + 1}'s p50, ${p} ms, is over its p95, ${side.p95[i]!} ms`); });
  }
  if (after && differences(after.p95, app['runs']).length) out.push(`hosts.app.after.p95 is ${show(after.p95)}, not hosts.app.runs, ${show(app['runs'])}, the five runs the verdict is judged on`);
  if (before && after && JSON.stringify(before) === JSON.stringify(after)) out.push(`hosts.app.before is hosts.app.after, ${show(before)}: the merge base's build wasn't timed on its own`);
  return out;
}
