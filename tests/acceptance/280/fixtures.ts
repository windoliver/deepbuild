// The criteria's fixtures (README: Fixtures): the eight-seat fixture the issue describes (eight movers driven by seeded
// entries, 100 projectiles each tested against 64 boxes, and a 128 × 128 grid stamped 3 times a step), its form with one
// mover per seat at 10 m/s (criterion 5), the same piece without its net item (criterion 8), net.feel's check inputs
// (its profiles, items and bounds, from the issue), each player's entries, and the planted names. The logic program is
// WebAssembly written here as bytes. Nothing here steps a match, measures a stall, hashes a state or draws anything; no
// vitest import, so a scratch script can run the program in Node's own WebAssembly.

import { createHash } from 'node:crypto';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------------------------------------------
// The match the criteria play (criteria 3, 4, 9: "window 8, delay 2 and 60 Hz"), eight seats.

export const FLICKS = 705_600_000;
export const RATE = 60;
/** One match step at 60 Hz, in ms: 16.67 (criterion 3's "10 steps (166.7 ms)"). */
export const STEP_MS = 1000 / RATE;
export const DELAY = 2;
export const WINDOW = 8;
export const SEATS = 8;
export const HASH_EVERY = 60;
/** net.feel's default run: 3,600 match steps, a minute at 60 Hz (the Fields line's `steps: u32 = 3,600`). */
export const FEEL_STEPS = 3600;
export const NET = 'match';
export const LOGIC = 'field';
export const WORLD = 'arena';
/** Declared by every piece played in process, which never joins one (`match` plays every copy with no network). */
export const RELAY = 'https://relay.test/280';
/** The movers' speed: criterion 5's "one mover per seat at 10 m/s". */
export const SPEED = 10;
export const moverOf = (seat: number): string => `mover_${seat}`;
export const controlOf = (seat: number): string => `move${seat}`;
/** net.feel's `items` name an item by its path (README: Choices): `items/<id>`. */
export const itemPath = (seat: number): string => `items/${moverOf(seat)}`;
export const SEAT_LIST = Array.from({ length: SEATS }, (_, i) => i + 1);

// ---------------------------------------------------------------------------------------------------
// WebAssembly, written as bytes (Logic `logic@1`: one memory whose maximum is its minimum, immutable i32 globals
// `reads_at` and `writes_at`, `init(seed: i64)`, `step(k: i64)`, no imports; active data segments only).

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
  f64: (x: number): number[] => [0x44, ...f64bytes(x)],
  load: (offset = 0): number[] => [0x28, 0x02, ...uleb(offset)],
  store: (offset = 0): number[] => [0x36, 0x02, ...uleb(offset)],
  f64load: (offset = 0): number[] => [0x2b, 0x03, ...uleb(offset)],
  f64store: (offset = 0): number[] => [0x39, 0x03, ...uleb(offset)],
  block: [0x02, 0x40], loop: [0x03, 0x40], if: [0x04, 0x40], end: [0x0b],
  br: (d: number): number[] => [0x0c, ...uleb(d)],
  brIf: (d: number): number[] => [0x0d, ...uleb(d)],
  add: [0x6a], sub: [0x6b], mul: [0x6c], and: [0x71], or: [0x72], shl: [0x74], shrS: [0x75], eq: [0x46], geU: [0x4f],
  wrap: [0xa7], truncS: [0xaa],
  fadd: [0xa0], fsub: [0xa1], fmul: [0xa2], fdiv: [0xa3], fmin: [0xa4], fmax: [0xa5], fneg: [0x9a], flt: [0x63], fgt: [0x64], fle: [0x65],
} as const;
const code = (...parts: (readonly number[])[]): number[] => parts.flatMap((p) => [...p]);

export interface Program { name: string; bytes: Buffer; sha: string }

// The read region (Logic `logic@1`): the controls the item reads, in declaration order, each a slider's slot of a u32
// count and 4 zero bytes, then at most 16 entries of a u32 player, 4 zero bytes and the f64 value: 8 + 16 × 16 = 264 B.
export const READS = SEAT_LIST.map(controlOf);
const SLOT = 264;
/** The write region: `hits` then `tally`, each on an 8-byte boundary (declaration order and alphabetical alike). */
export const WRITES_AT = 4096;
export const FIELD_WRITES: JsonObject = { hits: { type: 'i32' }, tally: { type: 'i32' } };
const HITS = WRITES_AT;
const TALLY = WRITES_AT + 8;
/** 100 projectiles, each `(x, y, vx, vy)` in f64 on a 128 × 128 field, `(vx, vy)` its move a sub-step. */
export const PROJECTILES = 100;
const PROJ = 8192;
/** Each step moves a projectile in 8 sub-steps, testing each sub-step's move against every box. */
export const SUBSTEPS = 8;
/** 64 boxes, each `(x0, y0, x1, y1)` in f64: an 8 × 8 lattice of 9 × 9 boxes 16 apart. */
export const BOXES = 64;
const BOX = 12288;
/** The grid: 128 × 128 cells of 128 B (2 MiB, 32 of the memory's 64 KiB pages), from page 2; a cell's first i32 is its
 * value. */
export const GRID_SIDE = 128;
const CELL = 128;
const ROW = GRID_SIDE * CELL;
const GRID = 2 * 65_536;
/** Stamps a step: each passes over every cell, letting its value decay by an eighth and stamping one column. */
export const STAMPS = 3;
export const PAGES = 2 + (GRID_SIDE * ROW) / 65_536;
/** The fuel a step of `field` may spend: the logic budget's most (Logic `logic@1`), since a step spends about 3 million. */
export const FIELD_FUEL = 10_000_000;

/** The projectiles' and boxes' starting values (the program's active data segment at PROJ): none moves at 0 on an
 * axis, so the slab test never divides by 0. */
function startBytes(): number[] {
  const out = new Array<number>(BOX + BOXES * 32 - PROJ).fill(0);
  const put = (at: number, x: number): void => { f64bytes(x).forEach((b, i) => { out[at - PROJ + i] = b; }); };
  for (let i = 0; i < PROJECTILES; i++) {
    const a = PROJ + i * 32;
    put(a, ((i * 37) % 128) + 0.5);
    put(a + 8, ((i * 91) % 128) + 0.5);
    put(a + 16, ((((i * 13) % 7) - 3) * 0.25 + 0.125) / SUBSTEPS);
    put(a + 24, ((((i * 29) % 5) - 2) * 0.375 + 0.1875) / SUBSTEPS);
  }
  for (let j = 0; j < BOXES; j++) {
    const b = BOX + j * 32;
    const [x0, y0] = [(j % 8) * 16 + 2, Math.floor(j / 8) * 16 + 2];
    put(b, x0); put(b + 8, y0); put(b + 16, x0 + 9); put(b + 24, y0 + 9);
  }
  return out;
}

// Locals of `step`: 0 the step (i64); i32 1 n, 2 e, 3 p, 4 t (tally), 5 i, 6 j, 7 a, 8 b, 9 h (hits), 10 c, 11 r, 12 s,
// 13 q (sub-step), 14 u (column), 15 w (a cell's address); f64 16 v, 17 x, 18 y, 19 vx, 20 vy, 21 tmin, 22 tmax, 23 t1,
// 24 t2.
const [N, E, P, T, II, J, A, B, H, C, R, S, Q, U, W] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const [V, X, Y, VX, VY, TMIN, TMAX, T1, T2] = [16, 17, 18, 19, 20, 21, 22, 23, 24];

/** Each entry of the control in slot `slot` this step: its player in `p`, its value in `v`, then `body`. */
const eachEntry = (slot: number, b: number[]): number[] => {
  const s = slot * SLOT;
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
/** The tally takes in an entry: t = t × 31 + player × 1000 + ⌊value × 2⌋ + 17 (wrapping). */
const fold = code(I.get(T), I.i32(31), I.mul, I.get(P), I.i32(1000), I.mul, I.add, I.get(V), I.f64(2), I.fmul, I.truncS, I.add, I.i32(17), I.add, I.set(T));
/** `for (local = 0; local < n; local++) body`. */
const loop = (local: number, n: number, body: number[]): number[] => code(
  I.i32(0), I.set(local),
  I.block, I.loop,
  I.get(local), I.i32(n), I.geU, I.brIf(1),
  body,
  I.get(local), I.i32(1), I.add, I.set(local),
  I.br(0),
  I.end, I.end,
);
/** One axis of the slab test of the move (x, y) → (x + vx, y + vy) against the box at `b`: `lo`, `hi` its bounds' offsets. */
const slab = (pos: number, vel: number, lo: number, hi: number, first: boolean): number[] => code(
  I.get(B), I.f64load(lo), I.get(pos), I.fsub, I.get(vel), I.fdiv, I.set(T1),
  I.get(B), I.f64load(hi), I.get(pos), I.fsub, I.get(vel), I.fdiv, I.set(T2),
  first
    ? code(I.get(T1), I.get(T2), I.fmin, I.set(TMIN), I.get(T1), I.get(T2), I.fmax, I.set(TMAX))
    : code(I.get(TMIN), I.get(T1), I.get(T2), I.fmin, I.fmax, I.set(TMIN), I.get(TMAX), I.get(T1), I.get(T2), I.fmax, I.fmin, I.set(TMAX)),
);
/** A velocity turns where the move would leave the 128 × 128 field. */
const bounce = (pos: number, vel: number): number[] => code(
  I.get(pos), I.get(vel), I.fadd, I.f64(0), I.flt, I.get(pos), I.get(vel), I.fadd, I.f64(GRID_SIDE), I.fgt, I.or, I.if,
  I.get(vel), I.fneg, I.set(vel),
  I.end,
);

/**
 * `field`, the eight-seat fixture's logic (README: Fixtures): each step it folds every move entry into its tally; moves
 * each of its 100 projectiles in 8 sub-steps, testing each sub-step's move against each of its 64 boxes (a slab test,
 * four divisions) and counting the hits; and stamps its 128 × 128 grid 3 times, each stamp a pass over every cell that
 * lets its value decay by an eighth and adds the step to one column, picked from the tally and the step, so all 32 grid
 * pages are written every step. It keeps `hits` and `tally` in its write region, and spends about 3 million fuel a step.
 */
export function fieldProgram(): Program {
  const subStep = code(
    bounce(X, VX), bounce(Y, VY),
    loop(J, BOXES, code(
      I.get(J), I.i32(5), I.shl, I.i32(BOX), I.add, I.set(B),
      slab(X, VX, 0, 16, true), slab(Y, VY, 8, 24, false),
      I.get(TMIN), I.f64(0), I.fmax, I.set(TMIN), I.get(TMAX), I.f64(1), I.fmin, I.set(TMAX),
      I.get(TMIN), I.get(TMAX), I.fle, I.if, I.get(H), I.i32(1), I.add, I.set(H), I.end,
    )),
    I.get(X), I.get(VX), I.fadd, I.set(X),
    I.get(Y), I.get(VY), I.fadd, I.set(Y),
  );
  const projectile = code(
    I.get(II), I.i32(5), I.shl, I.i32(PROJ), I.add, I.set(A),
    I.get(A), I.f64load(0), I.set(X), I.get(A), I.f64load(8), I.set(Y), I.get(A), I.f64load(16), I.set(VX), I.get(A), I.f64load(24), I.set(VY),
    loop(Q, SUBSTEPS, subStep),
    I.get(A), I.get(X), I.f64store(0),
    I.get(A), I.get(Y), I.f64store(8),
    I.get(A), I.get(VX), I.f64store(16),
    I.get(A), I.get(VY), I.f64store(24),
  );
  // value = value − value >> 3 + (column == c) × (k + s)
  const cell = code(
    I.get(R), I.i32(ROW), I.mul, I.get(U), I.i32(CELL), I.mul, I.add, I.i32(GRID), I.add, I.set(W),
    I.get(W),
    I.get(W), I.load(0), I.get(W), I.load(0), I.i32(3), I.shrS, I.sub,
    I.get(U), I.get(C), I.eq, I.get(0), I.wrap, I.get(S), I.add, I.mul, I.add,
    I.store(0),
  );
  const stamp = code(
    I.get(T), I.get(0), I.wrap, I.i32(7), I.mul, I.add, I.get(S), I.i32(43), I.mul, I.add, I.i32(GRID_SIDE - 1), I.and, I.set(C),
    loop(R, GRID_SIDE, loop(U, GRID_SIDE, cell)),
  );
  const step = code(
    I.i32(TALLY), I.load(0), I.set(T), I.i32(HITS), I.load(0), I.set(H),
    ...READS.map((_, slot) => eachEntry(slot, fold)),
    loop(II, PROJECTILES, projectile),
    loop(S, STAMPS, stamp),
    I.i32(TALLY), I.get(T), I.store(0), I.i32(HITS), I.get(H), I.store(0),
  );
  const body = (locals: number[], b: number[]): number[] => { const f = [...locals, ...b, 0x0b]; return [...uleb(f.length), ...f]; };
  const start = startBytes();
  const bytes = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, ...uleb(PAGES), ...uleb(PAGES)]])),
    ...section(6, vec([[0x7f, 0x00, ...I.i32(0), 0x0b], [0x7f, 0x00, ...I.i32(WRITES_AT), 0x0b]])),
    ...section(7, vec([[...name('memory'), 0x02, 0x00], [...name('reads_at'), 0x03, 0x00], [...name('writes_at'), 0x03, 0x01], [...name('init'), 0x00, 0x00], [...name('step'), 0x00, 0x01]])),
    ...section(10, vec([body([0x00], []), body([0x02, 0x0f, 0x7f, 0x09, 0x7c], step)])),
    ...section(11, vec([[0x00, ...I.i32(PROJ), 0x0b, ...uleb(start.length), ...start]])),
  ]);
  return { name: 'field', bytes, sha: sha256(bytes) };
}

// ---------------------------------------------------------------------------------------------------
// The arena: a physics world of one mover per seat, each in its own lane, moved by its player's entries.

/** Lane z of seat `seat`'s mover: 3 m apart, so no two movers ever touch. */
export const laneOf = (seat: number): number => (seat - 4.5) * 3;
/**
 * `arena` (physics.world@1, 120 Hz, no gravity, no damping): mover_1 … mover_8, each a 0.5 m sphere free along x only,
 * in its own lane. Each player's `move<n>` entry launches its mover at 10 m/s × the entry's value along x (−1, 0 or 1),
 * keeping where it is, so the mover's velocity is the last entry's. `moving`: every mover starts at 10 m/s (criterion 5's
 * form, whose movers reverse on their players' entries). Its outputs put each mover's pose at `items/mover_<n>/at`.
 */
export function arenaWorld(o: { moving?: boolean } = {}): JsonObject {
  const bodies: JsonObject = {};
  const inputs: JsonObject = {};
  const outputs: JsonObject = {};
  for (const seat of SEAT_LIST) {
    bodies[moverOf(seat)] = {
      kind: 'dynamic', shapes: [{ shape: 'mover', contact_material: 'slick' }], pose: { pos: [0, 0.5, laneOf(seat)] }, mass: 1, gravity_scale: 0, sleep: false,
      locks: { linear: [false, true, true], angular: [true, true, true] }, ...(o.moving ? { velocity: { linear: [SPEED, 0, 0] } } : {}),
    };
    inputs[`move_${seat}`] = { kind: 'launch', targets: [moverOf(seat)], on: { control: controlOf(seat), each: 'entry' }, data: { linear: `vec3(${SPEED} * ${controlOf(seat)}, 0, 0)` } };
    outputs[moverOf(seat)] = { from: moverOf(seat), read: 'pose', to: `items/${moverOf(seat)}/at` };
  }
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: 120, substeps: 1, gravity: [0, 0, 0], seed: 280, mode: 'dynamic',
    capacity: { bodies: SEATS, shapes: 1, joints: 0, contacts: 16, particles: 0 },
    backend: { name: 'rapier3d', version: '=0.36.1' },
    contact_materials: { slick: { friction: 0, restitution: 0, density: 1000 } },
    shapes: { mover: { kind: 'sphere', radius: 0.5 } },
    bodies, inputs, outputs,
  };
}

// ---------------------------------------------------------------------------------------------------
// Documents (#391's envelope as you send it, as #549's to #551's suites write them). IDs are 26 Crockford characters.

const ulid = (k: number): string => `01JB280D${String(k).padStart(18, '0')}`;
export const DOC = { eight: ulid(1), moving: ulid(2), noNet: ulid(3), burn: ulid(4) } as const;
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #280 acceptance tests.' };
const order = (k: number): string => `a${String(k).padStart(4, '0')}`;
export const SIZE: [number, number] = [640, 360];

export interface NetFields { relay?: JsonValue; players?: number; step_rate?: number; delay?: number; window?: number; hash_every?: number; timeout?: number }
const slider = (label: string): JsonObject => ({ kind: 'slider', class: 'document', label, role: 'slider', range: [-1, 1], default: 0, increment: 1 });

/**
 * The eight-seat fixture (README: Fixtures): a 3D scene of 640 × 360 in the showpiece class (4 ms of frame CPU), seed
 * 280, span 70 s; a camera, a floor and the eight movers drawn where the arena puts them; the sliders `move1` … `move8`
 * (−1 to 1 by 1), one a seat; the world `arena`; the logic item `field`; and the net item `match`: 8 players, 60 Hz,
 * delay 2, window 8, a hash every 60 steps, a timeout of 5 s, and what `net` changes. `moving`: criterion 5's form.
 * `net: false`: the same piece without its net item and without the net module (criterion 8).
 */
export function eightDoc(o: { id?: string; net?: NetFields | false; moving?: boolean } = {}): JsonObject {
  const program = fieldProgram();
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 40, 30], target: [0, 0, 0], fov: 50 } },
    floor: { kind: 'mark.box@1', params: { size: [60, 0.2, 30] }, at: { pos: [0, -0.1, 0] } },
    ...Object.fromEntries(SEAT_LIST.map((seat) => [moverOf(seat), { kind: 'mark.box@1', params: { size: [1, 1, 1] }, at: { pos: [0, 0.5, laneOf(seat)] } }])),
    [LOGIC]: { kind: 'logic@1', params: { program: program.sha, step_rate: RATE, reads: [...READS], writes: FIELD_WRITES, checkpoint: { every: 60 }, budget: { fuel: FIELD_FUEL } } },
    ...(o.net === false ? {} : {
      [NET]: { kind: 'net@1', params: { relay: RELAY, players: SEATS, step_rate: RATE, delay: DELAY, window: WINDOW, hash_every: HASH_EVERY, timeout: 5, ...o.net } as JsonObject },
    }),
  };
  const withIds: JsonObject = {};
  let k = 0;
  for (const [itemId, item] of Object.entries(items)) withIds[itemId] = { id: itemId, name: itemId, order: order(k++), ...item };
  const modules: JsonObject = { scene3d: '^1', input: '^1', logic: '^1', physics: '^1', ...(o.net === false ? {} : { net: '^1' }) };
  return {
    format: 1, id: o.id ?? (o.net === false ? DOC.noNet : o.moving ? DOC.moving : DOC.eight), profile: 'scene',
    title: o.moving ? 'Eight seats, movers at 10 m/s' : 'Eight seats', description: 'The eight-seat fixture the #280 acceptance tests play.',
    size: SIZE, camera: 'cam', seed: 280,
    transport: { span: '70s', frame_rate: [60, 1] },
    requires: { modules },
    budget: { class: 'showpiece' },
    controls: Object.fromEntries(SEAT_LIST.map((seat) => [controlOf(seat), slider(`Seat ${seat}'s mover`)])),
    assets: { field_program: { sha256: program.sha, license: LICENSE } },
    worlds: { [WORLD]: arenaWorld({ moving: o.moving === true }) },
    items: withIds,
  };
}

// ---------------------------------------------------------------------------------------------------
// Entries: what each player does, by match step (#549's `plays`: an entry `{step: g}` is made when step g is the first
// its copy hasn't run, stamped `delay` steps later).

export interface Play { step: number; control: string; value: number }
export type Plays = Record<string, Play[]>;

/** mulberry32: a fixed-seed generator of numbers in [0, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Seeded entries (the issue's "eight movers driven by seeded entries"): each player moves its own mover, first within
 * 30 steps, then every 20 to 79 steps, each time to another of −1, 0 and 1. */
export function seededMoves(steps: number, seed = 280): Plays {
  const out: Plays = {};
  for (const seat of SEAT_LIST) {
    const next = rng(seed * 31 + seat);
    const list: Play[] = [];
    let last = 0;
    for (let g = Math.floor(next() * 30); g + DELAY < steps; g += 20 + Math.floor(next() * 60)) {
      const others = [-1, 0, 1].filter((v) => v !== last);
      last = others[Math.floor(next() * others.length)]!;
      list.push({ step: g, control: controlOf(seat), value: last });
    }
    out[String(seat)] = list;
  }
  return out;
}
/** Criterion 4's "every player's input changing every step": each player's entry flips its mover between 1 and −1 at
 * every step. */
export function everyStep(steps: number): Plays {
  const out: Plays = {};
  for (const seat of SEAT_LIST) out[String(seat)] = Array.from({ length: steps - DELAY }, (_, g) => ({ step: g, control: controlOf(seat), value: (g + seat) % 2 === 0 ? 1 : -1 }));
  return out;
}
/** Criterion 5: the reversing player. */
export const REVERSER = 2;
/** Criterion 5: the copy its messages reach late, and how many steps past their step. */
export const LATE_COPY = 1;
export const LATE_BY = 5;
/** Criterion 5's 60 reversals, one a second: player 2's entries reach the match at steps 30, 90, …, 3,570 (made 2 steps
 * before), −1, 1, −1, … from its mover's start at +10 m/s; no other player makes an entry. */
export const REVERSALS = 60;
export function reversals(): Plays {
  const out: Plays = Object.fromEntries(SEAT_LIST.map((seat) => [String(seat), [] as Play[]]));
  out[String(REVERSER)] = Array.from({ length: REVERSALS }, (_, s) => ({ step: 30 + 60 * s - DELAY, control: controlOf(REVERSER), value: s % 2 === 0 ? -1 : 1 }));
  return out;
}
/** Criterion 5's relay (README: `relay.late`): each of player 2's messages, for match step k, reaches copy 1 once copy
 * 1 has run step k + 5, and not before; every other message is on time. */
export const LATE: JsonObject = { player: REVERSER, to: LATE_COPY, steps: LATE_BY };

// ---------------------------------------------------------------------------------------------------
// net.feel's check input (the Fields line): `{players, steps, profile: {latency, jitter, spikes, loss}, seed, items,
// bounds: {stall, depth_p99, correction_p99}}`, from the issue's criteria.

export interface Spikes { every: number; hold: number; player?: number; first?: number }
export interface Profile { latency: number[]; jitter: number; spikes?: Spikes; loss?: { rate: number; seed: number } }
export interface Bounds { stall: number; depth_p99: number; correction_p99: number }
export interface Feel { players?: number; profile: Profile; seed: number; items: string[]; bounds: Bounds }
const every = (ms: number): number[] => SEAT_LIST.map(() => ms);
/** Criterion 3, first half: every player at 40 ms one-way latency, 10 ms jitter, no spikes. */
export const QUIET: Profile = { latency: every(40), jitter: 10 };
/** Criteria 3 and 6: no jitter and spikes that hold player 1's messages for 250 ms at 5, 15, …, 55 s. */
export const SPIKED: Profile = { latency: every(40), jitter: 0, spikes: { every: 10, hold: 250, player: 1, first: 5 } };
/** Criterion 4: a fixed 80 ms one-way latency, no jitter. */
export const FIXED_80: Profile = { latency: every(80), jitter: 0 };
/** Criterion 5: the relay's own delays are 0; its late deliveries are `lateDeliveries`. */
export const ON_TIME: Profile = { latency: every(0), jitter: 0 };
/** Criterion 9: 40 ms, no jitter, with and without `loss {rate: 0.01, seed: 7}`. */
export const LOSSLESS: Profile = { latency: every(40), jitter: 0 };
export const LOSSY: Profile = { ...LOSSLESS, loss: { rate: 0.01, seed: 7 } };
/** Criterion 6's repeat: every seeded part of a profile at once, seeded jitter and seeded spikes. */
export const SEEDED: Profile = { latency: every(40), jitter: 10, spikes: { every: 10, hold: 250 } };
/** Bounds that hold no criterion's reading to anything (a stall of a whole minute, the largest window, 1 km). */
export const OPEN: Bounds = { stall: 60_000, depth_p99: 16, correction_p99: 1000 };
export const FEEL_SEED = 280;
export const feel = (profile: Profile, o: { bounds?: Partial<Bounds>; items?: string[]; seed?: number; players?: number } = {}): Feel => ({
  ...(o.players ? { players: o.players } : {}), profile, seed: o.seed ?? FEEL_SEED, items: o.items ?? [itemPath(1)], bounds: { ...OPEN, ...o.bounds },
});

// ---------------------------------------------------------------------------------------------------
// The criteria's expected values, from the issue.

/** Criterion 3: 6 spikes × (250 + 40 − 166.7) ms = 740 ms a minute, within one step length per spike. */
export const SPIKES_A_MINUTE = 6;
export const SPIKED_STALL = SPIKES_A_MINUTE * (250 + 40 - 10 * STEP_MS);
export const STALL_TOLERANCE = SPIKES_A_MINUTE * STEP_MS;
/** Criterion 3's planted meter: 290 ms a spike, 1,740 ms a minute. */
export const WHOLE_DELAY_STALL = SPIKES_A_MINUTE * (250 + 40);
/** Criterion 4: ⌊(80 ms − 2 step lengths) ÷ the step length⌋ + 1 = 3, within one step. */
export const DEPTH = Math.floor((80 - 2 * STEP_MS) / STEP_MS) + 1;
/** Criterion 5: 2 × 10 m/s × 5 × the step length = 1.67 m, within 1 cm; the planted meter 1.5 m at p99, 0.17 m at p50. */
export const CORRECTION = 2 * SPEED * LATE_BY * (STEP_MS / 1000);
export const FRAME_TO_FRAME_P99 = 1.5;
export const FRAME_TO_FRAME_P50 = SPEED * (STEP_MS / 1000);
export const CM = 0.01;
/** Criterion 6's bounds: 500 ms of stall a minute fails, 1,000 passes. */
export const TIGHT_STALL = 500;
export const LOOSE_STALL = 1000;

// ---------------------------------------------------------------------------------------------------
// The planted names (README: Planted twins). Each is one criterion's wrong program, reachable only through the
// scenario's `planted`, and changes nothing else.

export type Planted =
  | 'net_budget_window_without_checkpoints'
  | 'net_feel_stall_whole_delay'
  | 'net_feel_depth_from_arrival'
  | 'net_feel_correction_frame_to_frame'
  | 'net_feel_wall_clock'
  | 'net_resends_from_newest';
