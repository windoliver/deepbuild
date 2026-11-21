// The criteria's fixtures (README: Fixtures): the two-player paddle piece (a physics world with a ball and a paddle for
// each player, and a logic item that keeps score in a 4 MiB memory of 64 pages), its three-player form, the 20 Hz match
// with a 1 Hz economy item, the pieces whose steps burn a known CPU time (criteria 3, 9 and 10), each player's scripted
// entries, and the planted names. Programs are WebAssembly written here as bytes. Nothing here steps a match, hashes a
// state or draws anything; no vitest import, so a scratch script can run the programs in Node's own WebAssembly.

import { createHash } from 'node:crypto';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------------------------------------------
// The match the criteria play: the net item's defaults (Net `net@1`): 60 Hz, delay 2, window 8.

export const FLICKS = 705_600_000;
/** The paddle piece's match step rate (criterion 4: "at 60 Hz"). */
export const RATE = 60;
export const DELAY = 2;
export const WINDOW = 8;
/** A full-state hash at every match step, where a criterion reads one at every confirmed step. */
export const EVERY_STEP = 1;
export const HASH_EVERY = 60;
export const LOGIC = 'rules';
export const WORLD = 'court';
export const NET = 'match';
/** Declared by every piece played in process, which never joins one (`match` plays every copy with no network). */
export const RELAY = 'https://relay.test/551';

/** A step's length in flicks at `hz` (criterion 5 names step lengths: 1/7 s is 100,800,000 flicks, 1/20 s 35,280,000). */
export const stepFlicks = (hz: number): number => FLICKS / hz;

// ---------------------------------------------------------------------------------------------------
// WebAssembly, written as bytes (Logic `logic@1`: one memory whose maximum is its minimum, immutable i32 globals
// `reads_at` and `writes_at`, `init(seed: i64)`, `step(k: i64)`, no imports; WebAssembly 2.0 without vector
// instructions, so `memory.fill` is in the subset: Logic: sandbox).

const uleb = (n: number): number[] => { const o: number[] = []; let v = n >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const slebBig = (n: bigint): number[] => {
  const o: number[] = [];
  let v = BigInt.asIntN(64, n);
  for (;;) {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    if ((v === 0n && !(b & 0x40)) || (v === -1n && (b & 0x40))) { o.push(b); return o; }
    o.push(b | 0x80);
  }
};
const sleb = (n: number): number[] => slebBig(BigInt(n | 0));
const f64bytes = (x: number): number[] => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return [...b]; };
const name = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'latin1')];
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
/** Instructions, each a list of bytes. */
const I = {
  get: (l: number): number[] => [0x20, ...uleb(l)],
  set: (l: number): number[] => [0x21, ...uleb(l)],
  i32: (n: number): number[] => [0x41, ...sleb(n)],
  i64: (n: bigint): number[] => [0x42, ...slebBig(n)],
  f64: (x: number): number[] => [0x44, ...f64bytes(x)],
  load: (offset = 0): number[] => [0x28, 0x02, ...uleb(offset)],
  store: (offset = 0): number[] => [0x36, 0x02, ...uleb(offset)],
  load64: (offset = 0): number[] => [0x29, 0x03, ...uleb(offset)],
  store64: (offset = 0): number[] => [0x37, 0x03, ...uleb(offset)],
  f64load: (offset = 0): number[] => [0x2b, 0x03, ...uleb(offset)],
  block: [0x02, 0x40], loop: [0x03, 0x40], if: [0x04, 0x40], else: [0x05], end: [0x0b],
  br: (d: number): number[] => [0x0c, ...uleb(d)],
  brIf: (d: number): number[] => [0x0d, ...uleb(d)],
  add: [0x6a], sub: [0x6b], mul: [0x6c], and: [0x71], or: [0x72], shl: [0x74], eq: [0x46], ne: [0x47], ltU: [0x49], geU: [0x4f],
  i64eq: [0x51], i64ltU: [0x54], i64add: [0x7c], i64mul: [0x7e], i64divU: [0x80], i64remU: [0x82], i64and: [0x83], i64or: [0x84],
  wrap: [0xa7], fmul: [0xa2], truncS: [0xaa],
  memoryFill: [0xfc, 0x0b, 0x00],
} as const;
const code = (...parts: (readonly number[])[]): number[] => parts.flatMap((p) => [...p]);

export interface Program { name: string; bytes: Buffer; sha: string }

/** A module of `pages` 64 KiB pages exporting `init` and `step` (both `(i64) -> ()`), whose read region starts at 0 and
 * write region at 4096. `locals`: `step`'s local declarations, as the code section writes them. */
function module(o: { pages: number; init: number[]; step: number[]; initLocals?: number[]; stepLocals: number[] }): Buffer {
  const body = (locals: number[], b: number[]): number[] => { const f = [...locals, ...b, 0x0b]; return [...uleb(f.length), ...f]; };
  return Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, ...uleb(o.pages), ...uleb(o.pages)]])),
    ...section(6, vec([[0x7f, 0x00, ...I.i32(0), 0x0b], [0x7f, 0x00, ...I.i32(WRITES_AT), 0x0b]])),
    ...section(7, vec([[...name('memory'), 0x02, 0x00], [...name('reads_at'), 0x03, 0x00], [...name('writes_at'), 0x03, 0x01], [...name('init'), 0x00, 0x00], [...name('step'), 0x00, 0x01]])),
    ...section(10, vec([body(o.initLocals ?? [0x00], o.init), body(o.stepLocals, o.step)])),
  ]);
}

// The read region (Logic `logic@1`): the controls the item reads, in declaration order, each a slider's slot of a u32
// count and 4 zero bytes, then at most 16 entries of a u32 player, 4 zero bytes and the f64 value: 8 + 16 × 16 = 264 B.
export const READS = ['paddle1', 'paddle2', 'serve', 'spin'] as const;
export type Control = (typeof READS)[number];
const SLOT = 264;
const slotOf = (control: Control): number => READS.indexOf(control) * SLOT;
/** The write region: each array in declaration order on an 8-byte boundary (alphabetical too, so either order lays
 * them out alike). */
export const WRITES_AT = 4096;
export const RULES_WRITES: JsonObject = { score: { type: 'i32', count: 2 }, serving: { type: 'i32' }, tally: { type: 'i32' } };
const SCORE = WRITES_AT;
const SERVING = WRITES_AT + 8;
const TALLY = WRITES_AT + 16;

/** 64 KiB, the page a rollback ring keeps (Net: rollback). */
export const PAGE = 65_536;
/** The paddle piece's logic memory: 64 pages, 4 MiB (criterion 4). */
export const PAGES = 64;
/** A page the program writes with `memory.fill` alone, at every step k with k mod 10 = 3 (criterion 4's plant misses it). */
export const FILL_PAGE = 50;
export const FILL_EVERY = 10;
export const FILL_AT = 3;
/** A page the program writes with stores alone, at every step k with k mod 60 = 10 or 27: steps 610 and 627 among them
 * (criterion 6). Nothing else writes it. */
export const MARK_PAGE = 40;
export const MARK_AT = [10, 27] as const;
/** Logic's own checkpoints (Logic: checkpoints and bake: `checkpoint.every`), at steps 600 and 660 among them. */
export const CHECKPOINT_EVERY = 60;

// Locals of the paddle piece's `step`: 0 the step (i64); i32 1 n, 2 e, 3 p, 4 t (tally), 5 s (serving), 6 a; f64 7 v.
const [N, E, P, T, S, A, V] = [1, 2, 3, 4, 5, 6, 7];

/** Each entry of `control` this step, in the read region's order: its player in `p`, its value in `v`, then `body`. */
const eachEntry = (control: Control, b: number[]): number[] => {
  const s = slotOf(control);
  return code(
    I.i32(s), I.load(0), I.set(N), I.i32(0), I.set(E),
    I.block, I.loop,
    I.get(E), I.get(N), I.geU, I.brIf(1),
    I.i32(s), I.get(E), I.i32(4), I.shl, I.add, I.load(8), I.set(P),
    I.i32(s), I.get(E), I.i32(4), I.shl, I.add, I.f64load(16), I.set(V),
    b,
    I.get(E), I.i32(1), I.add, I.set(E),
    I.br(0),
    I.end, I.end,
  );
};
/** The tally takes in an entry: t = t × 31 + player × 1000 + ⌊value × scale⌋ + c (wrapping), so an entry applied at
 * another step, by another player or in another order leaves another tally. */
const mix = (scale: number, c: number): number[] => code(
  I.get(T), I.i32(31), I.mul, I.get(P), I.i32(1000), I.mul, I.add, I.get(V), I.f64(scale), I.fmul, I.truncS, I.add, I.i32(c), I.add, I.set(T),
);
/** A serve from the serving player scores them a point and passes the serve; any other serve is no point. */
const serveEntry = code(
  I.get(P), I.get(S), I.eq, I.if,
  I.get(P), I.i32(2), I.shl, I.i32(SCORE - 4), I.add, I.set(A),
  I.get(A), I.get(A), I.load(0), I.i32(1), I.add, I.store(0),
  I.i32(3), I.get(S), I.sub, I.set(S),
  I.end,
);
/** `k mod m == r` for the i64 step. */
const stepIs = (m: number, r: number): number[] => code(I.get(0), I.i64(BigInt(m)), I.i64remU, I.i64(BigInt(r)), I.i64eq);

/**
 * `rules`, the paddle piece's logic (README: The paddle piece): its score, whose serve it is and a tally of every
 * paddle and spin entry, kept in its write region and read back each step, in a memory of 64 pages (4 MiB). Each step
 * writes page 0 (its regions); at k mod 10 = 3 it fills page 50 whole with `memory.fill`, its byte taken from the
 * tally and the step, which nothing else writes; at k mod 60 = 10 or 27 it stores the step and the tally at the start
 * of page 40, which nothing else writes. So no step writes more than 3 of its 64 pages.
 */
export function rulesProgram(): Program {
  const init = code(I.i32(SERVING), I.i32(1), I.store(0), I.i32(TALLY), I.i32(7), I.store(0));
  const step = code(
    I.i32(TALLY), I.load(0), I.set(T), I.i32(SERVING), I.load(0), I.set(S),
    eachEntry('paddle1', mix(2, 17)),
    eachEntry('paddle2', mix(2, 17)),
    eachEntry('serve', serveEntry),
    eachEntry('spin', mix(4, 29)),
    I.i32(TALLY), I.get(T), I.store(0), I.i32(SERVING), I.get(S), I.store(0),
    stepIs(FILL_EVERY, FILL_AT), I.if,
    I.i32(FILL_PAGE * PAGE), I.get(T), I.get(0), I.wrap, I.add, I.i32(0xff), I.and, I.i32(PAGE), I.memoryFill,
    I.end,
    stepIs(CHECKPOINT_EVERY, MARK_AT[0]), stepIs(CHECKPOINT_EVERY, MARK_AT[1]), I.or, I.if,
    I.i32(MARK_PAGE * PAGE), I.get(0), I.wrap, I.store(0),
    I.i32(MARK_PAGE * PAGE), I.get(T), I.store(4),
    I.end,
  );
  const bytes = module({ pages: PAGES, init, step, stepLocals: [0x02, 0x06, 0x7f, 0x01, 0x7c] });
  return { name: 'rules', bytes, sha: sha256(bytes) };
}

/** The burning item's one array: a word it folds each iteration into (an i64, kept as two i32s). */
export const BURN_WRITES: JsonObject = { acc: { type: 'i32', count: 2 } };
/** A step's iterations: `heavy` at each step k with k mod `every` = `every` − 1, else `light`. */
export interface Burn { every: number; heavy: number; light: number }
/**
 * `burn`: a logic item whose step costs a known CPU time and nothing else (criteria 3, 9 and 10). Each iteration folds
 * four dependent 64-bit divisions into its word, so its time is the divider's and fuel stays well under its budget; it
 * reads `spin` (and never uses it) and keeps its word in one page.
 */
export function burnProgram(b: Burn): Program {
  // Locals of `step`: 0 the step; i64 1 a, 2 i, 3 n.
  const [Aw, Iw, Nw] = [1, 2, 3];
  const fold = code(I.get(Aw), I.get(Aw), I.get(Aw), I.i64(255n), I.i64and, I.i64(3n), I.i64or, I.i64divU, I.i64add, I.set(Aw));
  const step = code(
    stepIs(b.every, b.every - 1), I.if, I.i64(BigInt(b.heavy)), I.set(Nw), I.else, I.i64(BigInt(b.light)), I.set(Nw), I.end,
    I.i32(WRITES_AT), I.load64(0), I.i64(1n), I.i64or, I.set(Aw),
    I.i64(0n), I.set(Iw),
    I.block, I.loop,
    I.get(Iw), I.get(Nw), I.i64ltU, [0x45], I.brIf(1),
    fold, fold, fold, fold,
    I.get(Aw), I.i64(6364136223846793005n), I.i64mul, I.i64(1442695040888963407n), I.i64add, I.set(Aw),
    I.get(Iw), I.i64(1n), I.i64add, I.set(Iw),
    I.br(0),
    I.end, I.end,
    I.i32(WRITES_AT), I.get(Aw), I.store64(0),
  );
  const bytes = module({ pages: 1, init: [], step, stepLocals: [0x01, 0x03, 0x7e] });
  return { name: `burn-${b.every}-${b.heavy}-${b.light}`, bytes, sha: sha256(bytes) };
}

// ---------------------------------------------------------------------------------------------------
// Calibration (README: The burning pieces): iterations of `burn` for a step of about the named CPU time on the reference
// Mac this job ran on (an M5 Max), read off `match`'s net.budget at the base in lockstep (`busiest.ms`, #549's), so a
// slower reference Mac stays inside each criterion's margins.

/** About 1 ms of CPU a step: at the base, 50,000, 100,000 and 150,000 iterations read 0.74, 1.45 and 2.18 ms. */
export const ITERATIONS_PER_MS = 68_000;
/** Criterion 10's test piece: its busiest match step, one in every 10, costs about 3 ms. */
export const BUSIEST_MS = 2.6;
/** Criterion 3's planted piece: every step about 0.8 ms, so the step fits 4 ms but a window of 8 steps again doesn't. */
export const WINDOW_STEP_MS = 0.8;
/** Criterion 9's planted piece: every step about 2.4 ms with window 1, so the step with its checkpoints fits 4 ms and so
 * does the window restored and stepped again, but not both. */
export const TOGETHER_STEP_MS = 2.4;
export const iterations = (ms: number): number => Math.round(ms * ITERATIONS_PER_MS);

// ---------------------------------------------------------------------------------------------------
// The court: a physics world of a ball, two paddles and two walls, on the core's input track (Input track entries).

/** The court: the ball bounces between walls at z = ±11 (its centre turns at ±10) and meets paddle 1 at x = −18 and
 * paddle 2 at x = 18, each 6 m long; past a paddle it leaves the court. */
export const COURT = { wall: 10, paddleX: 18, reach: 17.2, half: 3, ball: 0.5, serve: [9, 5] as [number, number] };
/** The paddle positions a player picks from (inside the slider's range, a whole number of increments). */
export const PADDLE_RANGE: [number, number] = [-10, 10];
/** The keys a person presses on the web player's copy to move paddle 2 (Control: `keys`), each to its position. */
export const PADDLE2_KEYS: Record<string, number> = { 1: -7.5, 2: -5, 3: -2.5, 4: 0, 5: 2.5, 6: 5, 7: 7.5 };

export function courtWorld(o: { stepRate?: number } = {}): JsonObject {
  const bouncy = { friction: 0, restitution: 1, density: 1000 };
  const locked = { linear: [true, true, true], angular: [true, true, true] };
  const paddle = (x: number): JsonObject => ({
    kind: 'dynamic', shapes: [{ shape: 'paddle', contact_material: 'bouncy' }], pose: { pos: [x, 0.5, 0] }, mass: 50, gravity_scale: 0, sleep: false, locks: locked,
  });
  const wall = (z: number): JsonObject => ({ kind: 'static', shapes: [{ shape: 'wall', contact_material: 'bouncy' }], pose: { pos: [0, 0.5, z] } });
  const move = (body: string, control: string, x: number): JsonObject => ({
    kind: 'launch', targets: [body], on: { control, each: 'entry' }, from: 'pose', data: { 'from.pos': `vec3(${x}, 0.5, ${control})`, linear: 'vec3(0, 0, 0)' },
  });
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: o.stepRate ?? 120, substeps: 4, gravity: [0, 0, 0], seed: 551, mode: 'dynamic',
    capacity: { bodies: 5, shapes: 3, joints: 0, contacts: 32, particles: 0 },
    backend: { name: 'rapier3d', version: '=0.36.1' },
    contact_materials: { bouncy },
    shapes: { ball: { kind: 'sphere', radius: COURT.ball }, paddle: { kind: 'box', half: [0.3, 0.5, COURT.half] }, wall: { kind: 'box', half: [20, 0.5, 0.5] } },
    bodies: {
      ball: {
        kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'bouncy' }], pose: { pos: [0, 0.5, 0] }, mass: 1, gravity_scale: 0, sleep: false, ccd: true,
        locks: { linear: [false, true, false], angular: [true, true, true] },
      },
      paddle_1: paddle(-COURT.paddleX), paddle_2: paddle(COURT.paddleX), wall_n: wall(-11), wall_s: wall(11),
    },
    inputs: {
      move_1: move('paddle_1', 'paddle1', -COURT.paddleX),
      move_2: move('paddle_2', 'paddle2', COURT.paddleX),
      serve: { kind: 'launch', targets: ['ball'], on: { control: 'serve', each: 'entry' }, from: 'pose', data: { 'from.pos': 'vec3(0, 0.5, 0)', linear: `vec3(${COURT.serve[0]} * serve, 0, ${COURT.serve[1]})` } },
    },
    outputs: {
      ball: { from: 'ball', read: 'pose', to: 'items/ball/at' },
      pad1: { from: 'paddle_1', read: 'pose', to: 'items/pad1/at' },
      pad2: { from: 'paddle_2', read: 'pose', to: 'items/pad2/at' },
    },
  };
}
/** A world that costs nothing much: one ball at rest on a floor (the burning pieces' second canvas module). */
export function restWorld(): JsonObject {
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: 120, substeps: 4, gravity: [0, -9.81, 0], seed: 551, mode: 'dynamic',
    capacity: { bodies: 2, shapes: 2, joints: 0, contacts: 4, particles: 0 },
    backend: { name: 'rapier3d', version: '=0.36.1' },
    contact_materials: { m: { friction: 0.5, restitution: 0, density: 1000 } },
    shapes: { floor: { kind: 'box', half: [5, 0.1, 5] }, ball: { kind: 'sphere', radius: 0.5 } },
    bodies: {
      floor: { kind: 'static', shapes: [{ shape: 'floor', contact_material: 'm' }], pose: { pos: [0, -0.1, 0] } },
      ball: { kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'm' }], pose: { pos: [0, 0.5, 0] }, mass: 1 },
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Scripts: what each player does, by match step.

/** One scripted entry: the player sets `control` to `value` when match step `step` is the first its copy hasn't run,
 * so it is stamped `delay` steps later (Net `net@1`, #549's suite). */
export interface Play { step: number; control: string; value: number }
export type Plays = Record<string, Play[]>;

const quantize = (z: number): number => Math.max(-7.5, Math.min(7.5, Math.round(z * 2) / 2));
/**
 * An honest rally of `players` over `steps` match steps at `rate` Hz, each entry stamped `delay` steps after it is made.
 * Serves alternate every 240 match steps from step 30, player 1's toward player 2 (+1), player 2's back (−1). Every 12
 * steps each of players 1 and 2 aims its paddle at where this file's own model of the court (a ball that turns at the
 * walls and at a paddle within reach, no spin) says the ball next reaches its paddle, half a step of the slider either
 * side in turn, so its paddle hits the ball and its entries keep changing. A third player spins every 7 steps. The
 * model is only a script's aim: no test reads it as an expected value.
 */
export function rally(players: number, steps: number, o: { rate?: number; delay?: number } = {}): Plays {
  const rate = o.rate ?? RATE;
  const delay = o.delay ?? DELAY;
  const sub = 120 / rate;
  const dt = 1 / 120;
  const out: Plays = Object.fromEntries(Array.from({ length: players }, (_, i) => [String(i + 1), [] as Play[]]));
  const paddle = [0, 0];
  let ball: { x: number; z: number; vx: number; vz: number } | null = null;
  const pending: { at: number; f: () => void }[] = [];
  /** Where the ball next reaches `side`'s paddle line (x = ∓reach), on the model, or null. */
  const aim = (side: 0 | 1): number | null => {
    if (!ball) return null;
    if ((side === 0 && ball.vx >= 0) || (side === 1 && ball.vx <= 0)) return null;
    let { x, z, vz } = ball;
    for (let i = 0; i < 12_000; i++) {
      x += ball.vx * dt; z += vz * dt;
      if (z > COURT.wall) { z = 2 * COURT.wall - z; vz = -vz; }
      if (z < -COURT.wall) { z = -2 * COURT.wall - z; vz = -vz; }
      if (Math.abs(x) >= COURT.reach) return z;
    }
    return null;
  };
  for (let g = 0; g < steps; g++) {
    // What lands at step g (made at g − delay) takes effect on the model as the world takes it.
    for (const p of pending.filter((x) => x.at === g)) p.f();
    for (let k = 0; k < sub && ball; k++) {
      const b: { x: number; z: number; vx: number; vz: number } = ball;
      b.x += b.vx * dt; b.z += b.vz * dt;
      if (b.z > COURT.wall) { b.z = 2 * COURT.wall - b.z; b.vz = -b.vz; }
      if (b.z < -COURT.wall) { b.z = -2 * COURT.wall - b.z; b.vz = -b.vz; }
      for (const side of [0, 1] as const) {
        const line = side === 0 ? -COURT.reach : COURT.reach;
        const toward = side === 0 ? b.vx < 0 : b.vx > 0;
        if (toward && (side === 0 ? b.x <= line : b.x >= line) && Math.abs(b.z - paddle[side]!) <= COURT.half + COURT.ball) { b.x = 2 * line - b.x; b.vx = -b.vx; }
      }
      if (Math.abs(b.x) > 40) ball = null;
    }
    if (g + delay >= steps) continue;
    const make = (p: number, control: string, value: number, f?: () => void): void => {
      out[String(p)]!.push({ step: g, control, value });
      if (f) pending.push({ at: g + delay, f });
    };
    if (g >= 30 && (g - 30) % 240 === 0) {
      const p = ((g - 30) / 240) % 2 === 0 ? 1 : 2;
      if (p <= players) {
        const dir = p === 1 ? 1 : -1;
        make(p, 'serve', dir, () => { ball = { x: 0, z: 0, vx: COURT.serve[0] * dir, vz: COURT.serve[1] }; });
      }
    }
    for (const side of [0, 1] as const) {
      const p = side + 1;
      if (p > players || g % 12 !== 6 * side) continue;
      const z = aim(side) ?? 0;
      const value = quantize(z + (Math.floor(g / 12) % 2 === 0 ? 0.5 : -0.5));
      const last = out[String(p)]!.filter((e) => e.control === `paddle${p}`).at(-1)?.value;
      if (value !== last) make(p, `paddle${p}`, value, () => { paddle[side] = value; });
    }
    if (players >= 3 && g % 7 === 3) make(3, 'spin', Math.floor(g / 7) % 2 === 0 ? 0.5 : -0.5);
  }
  return out;
}
/** `plays` with `player`'s entries made from `from` to `to` (inclusive) taken out and `extra` put in, in step order: a
 * quiet stretch around a criterion's own late entry, so it is that player's only entry there. */
export function withOnly(plays: Plays, player: number, from: number, to: number, extra: Play[]): Plays {
  const list = [...(plays[String(player)] ?? []).filter((e) => e.step < from || e.step > to), ...extra].sort((a, b) => a.step - b.step);
  return { ...plays, [String(player)]: list };
}
/** A player's paddle value just before step `g` in `plays` (0 before any). */
export function lastValue(plays: Plays, player: number, control: string, g: number): number {
  return (plays[String(player)] ?? []).filter((e) => e.control === control && e.step < g).at(-1)?.value ?? 0;
}

// ---------------------------------------------------------------------------------------------------
// The planted names (README: Planted twins). Each is one criterion's wrong program, reachable only through the
// scenario's `planted`, and changes nothing else.

export type Planted =
  | 'net_applies_at_arrival'
  | 'net_records_predicted'
  | 'net_ring_misses_fill'
  | 'net_rate_faster_only'
  | 'net_ring_keeps_after'
  | 'net_keeps_replaced_checkpoint'
  | 'net_ignores_lead_rule'
  | 'net_rewinds_to_last_read';

// ---------------------------------------------------------------------------------------------------
// Documents (#391's envelope as you send it, as #549's and #550's suites write them). IDs are 26 Crockford characters.

const ulid = (k: number): string => `01JB551D${String(k).padStart(18, '0')}`;
export const DOC = {
  paddle: ulid(1), trio: ulid(2), economy: ulid(3), seven: ulid(4), window: ulid(5), together: ulid(6), busiest: ulid(7),
  delay31: ulid(8), window17: ulid(9), delay30: ulid(10),
} as const;
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #551 acceptance tests.' };
const order = (k: number): string => `a${String(k).padStart(4, '0')}`;
export const SIZE: [number, number] = [640, 360];
/** Every piece's transport frame rate; a time `"<n>f"` counts these frames (the canvas time grammar). */
export const DOC_FRAME_RATE: [number, number] = [60, 1];

export interface NetFields { relay?: JsonValue; players?: number; step_rate?: number; delay?: number; window?: number; hash_every?: number; timeout?: number }
const slider = (label: string, range: [number, number], increment: number, keys?: Record<string, number>): JsonObject => ({
  kind: 'slider', class: 'document', label, role: 'slider', range, default: 0, increment, ...(keys ? { keys } : {}),
});
export interface LogicItem { id: string; program: Program; stepRate: number; reads: readonly string[]; writes: JsonObject; budget?: JsonObject }
const logicItem = (l: LogicItem): JsonObject => ({
  kind: 'logic@1',
  params: { program: l.program.sha, step_rate: l.stepRate, reads: [...l.reads], writes: l.writes, checkpoint: { every: CHECKPOINT_EVERY }, ...(l.budget ? { budget: l.budget } : {}) },
});
export const rulesItem = (program: Program, stepRate = RATE, id = LOGIC): LogicItem => ({ id, program, stepRate, reads: READS, writes: RULES_WRITES });

/**
 * A piece of the paddle family (README: The paddle piece): a 3D scene of 640 × 360 in the showpiece class, seed 551,
 * span 70 s, with a camera, a table, the ball and the two paddles drawn where the world puts them, the sliders `paddle1`
 * and `paddle2` (−10 to 10 by 0.5; paddle 2 also on the keys 1 to 7), `serve` (−1 to 1 by 1) and `spin` (−1 to 1 by
 * 0.25), the world `court` (or `world`), the logic items `logic`, and the net item `match`: 2 players, 60 Hz, delay 2,
 * window 8, a full-state hash every 60 match steps, and what `net` changes.
 */
export function pieceDoc(o: { id: string; logic: LogicItem[]; net?: NetFields; world?: JsonObject; title?: string }): JsonObject {
  const programs = new Map(o.logic.map((l) => [l.program.sha, l.program]));
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 30, 26], target: [0, 0, 0], fov: 50 } },
    table: { kind: 'mark.box@1', params: { size: [40, 0.2, 22] }, at: { pos: [0, -0.1, 0] } },
    ball: { kind: 'mark.box@1', params: { size: [1, 1, 1] }, at: { pos: [0, 0.5, 0] } },
    pad1: { kind: 'mark.box@1', params: { size: [0.6, 1, 2 * COURT.half] }, at: { pos: [-COURT.paddleX, 0.5, 0] } },
    pad2: { kind: 'mark.box@1', params: { size: [0.6, 1, 2 * COURT.half] }, at: { pos: [COURT.paddleX, 0.5, 0] } },
    ...Object.fromEntries(o.logic.map((l) => [l.id, logicItem(l)])),
    [NET]: { kind: 'net@1', params: { relay: RELAY, players: 2, step_rate: RATE, delay: DELAY, window: WINDOW, hash_every: HASH_EVERY, ...o.net } as JsonObject },
  };
  const withIds: JsonObject = {};
  let k = 0;
  for (const [itemId, item] of Object.entries(items)) withIds[itemId] = { id: itemId, name: itemId, order: order(k++), ...item };
  return {
    format: 1, id: o.id, profile: 'scene', title: o.title ?? 'A paddle match', description: 'A paddle piece the #551 acceptance tests play.', size: SIZE, camera: 'cam', seed: 551,
    transport: { span: '70s', frame_rate: DOC_FRAME_RATE },
    requires: { modules: { scene3d: '^1', input: '^1', logic: '^1', physics: '^1', net: '^1' } },
    budget: { class: 'showpiece' },
    controls: {
      paddle1: slider('Paddle 1', PADDLE_RANGE, 0.5), paddle2: slider('Paddle 2', PADDLE_RANGE, 0.5, PADDLE2_KEYS),
      serve: slider('Serve', [-1, 1], 1), spin: slider('Spin', [-1, 1], 0.25),
    },
    assets: Object.fromEntries([...programs.values()].map((p) => [`${p.name}_program`, { sha256: p.sha, license: LICENSE }])),
    worlds: { [WORLD]: o.world ?? courtWorld() },
    items: withIds,
  };
}
/** The two-player paddle piece (criteria 1 to 4, 6 to 9), or its three-player form (criterion 11). */
export function paddleDoc(net: NetFields = {}, id: string = DOC.paddle): JsonObject {
  return pieceDoc({ id, logic: [rulesItem(rulesProgram())], net });
}
/** Criterion 5's match: 20 Hz, its 120 Hz court and the 1 Hz economy item (the rules' program, stepping once a second);
 * `seven` adds the logic item `market` at 7 Hz. */
export const ECONOMY = 'economy';
export const MARKET = 'market';
export function economyDoc(o: { seven?: boolean } = {}): JsonObject {
  const program = rulesProgram();
  const logic = [rulesItem(program, 1, ECONOMY), ...(o.seven ? [rulesItem(program, 7, MARKET)] : [])];
  return pieceDoc({ id: o.seven ? DOC.seven : DOC.economy, logic, net: { step_rate: 20, hash_every: EVERY_STEP }, title: 'A 20 Hz match with an economy' });
}
/** The most iterations one `burn` item takes a step: about 60 fuel each, under its 10,000,000 fuel a step. */
export const ITERATIONS_PER_ITEM = 150_000;
/** A burning piece's step, in CPU time: `heavyMs` at each step k with k mod `every` = `every` − 1, else `lightMs`. */
export interface BurnMs { every: number; heavyMs: number; lightMs: number }
/** The `burn` items a burning piece needs, each its share of the step, and their one program. */
export function burnItems(b: BurnMs): { items: number; program: Program } {
  const heavy = iterations(b.heavyMs);
  const items = Math.max(1, Math.ceil(heavy / ITERATIONS_PER_ITEM));
  return { items, program: burnProgram({ every: b.every, heavy: Math.ceil(heavy / items), light: Math.ceil(iterations(b.lightMs) / items) }) };
}
/** A burning piece (criteria 3, 9, 10): `burn_1` … `burn_n`, which together spend the step's time, beside a world at
 * rest, and the net item as `net` sets it. */
export function burnDoc(id: string, b: BurnMs, net: NetFields): JsonObject {
  const { items, program } = burnItems(b);
  const logic = Array.from({ length: items }, (_, i) => ({ id: `burn_${i + 1}`, program, stepRate: RATE, reads: ['spin'], writes: BURN_WRITES, budget: { fuel: 10_000_000 } }));
  return pieceDoc({ id, logic, net, world: restWorld(), title: 'A burning piece' });
}
/** Spin entries, one from each player every 30 steps, so a burning piece's match has entries to roll back. */
export function spins(steps: number): Plays {
  const out: Plays = { '1': [], '2': [] };
  for (let g = 0; g + DELAY < steps; g++) for (const p of [1, 2]) if (g % 30 === 15 * (p - 1)) out[String(p)]!.push({ step: g, control: 'spin', value: Math.floor(g / 30) % 2 === 0 ? 0.25 : -0.25 });
  return out;
}
