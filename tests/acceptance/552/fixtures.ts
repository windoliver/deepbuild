// The criteria's fixtures (README: Fixtures): the three pieces (the fog piece, the dice piece, the war piece), their
// logic programs as WebAssembly bytes written here, the players' scripted entries, the spawn's tone and the planted
// names. Nothing here steps a match, draws, hashes or draws a roll; no vitest import, so a scratch script can run the
// programs in Node's own WebAssembly (README: Fixtures, the scratch run).

import { createHash } from 'node:crypto';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------------------------------------------
// The matches: 20 Hz, window 0 (lockstep), delay 4, a full-state hash every 60 match steps (#549's and #550's numbers).

export const FLICKS = 705_600_000;
export const RATE = 20;
/** One match step (and one logic step): 1/20 s, 35,280,000 flicks. */
export const STEP = FLICKS / RATE;
export const DELAY = 4;
export const HASH_EVERY = 60;
/** The relay every piece declares; `match` plays its copies in one process, so nothing reaches it. */
export const RELAY = 'https://relay.test/552';
export const NET = 'match';

// ---------------------------------------------------------------------------------------------------
// WebAssembly written as bytes (Logic `logic@1`: one memory whose maximum is its minimum, immutable i32 globals
// `reads_at`, `writes_at` and, with emits, `emits_at`; `init(seed: i64)` and `step(k: i64)`; no imports; MVP only).

const uleb = (n: number): number[] => { const o: number[] = []; let v = n >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const sleb = (n: number | bigint): number[] => {
  const o: number[] = [];
  let v = BigInt(n);
  for (;;) { const b = Number(v & 0x7fn); v >>= 7n; if ((v === 0n && !(b & 0x40)) || (v === -1n && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); }
};
const f64bytes = (x: number): number[] => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return [...b]; };
const name = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'latin1')];
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
/** Instructions, each a list of bytes. */
const I = {
  get: (l: number): number[] => [0x20, ...uleb(l)],
  set: (l: number): number[] => [0x21, ...uleb(l)],
  i32: (n: number): number[] => [0x41, ...sleb(n)],
  i64: (n: number | bigint): number[] => [0x42, ...sleb(n)],
  f64: (x: number): number[] => [0x44, ...f64bytes(x)],
  load: [0x28, 0x02, 0x00], i64load: [0x29, 0x03, 0x00], store: [0x36, 0x02, 0x00], f64store: [0x39, 0x03, 0x00],
  block: [0x02, 0x40], loop: [0x03, 0x40], if: [0x04, 0x40], end: [0x0b],
  br: (d: number): number[] => [0x0c, ...uleb(d)],
  brIf: (d: number): number[] => [0x0d, ...uleb(d)],
  eqz: [0x45], eq: [0x46], ltU: [0x49], geU: [0x4f],
  add: [0x6a], and: [0x71], or: [0x72], shl: [0x74], shrU: [0x76],
  i64eq: [0x51], i64ltS: [0x53], i64remU: [0x82], i64shrU: [0x88], wrap: [0xa7],
  select: [0x1b],
} as const;
const code = (...parts: (readonly number[])[]): number[] => parts.flatMap((p) => [...p]);

export interface Program { name: string; bytes: Buffer; sha: string }
interface Fn { locals: [number, number][]; body: number[] }
/** A logic program: one memory of `pages` (maximum = minimum), `reads_at` 0, `writes_at` 4096, `emits_at` when given. */
function logicModule(label: string, pages: number, emitsAt: number | null, init: Fn, step: Fn): Program {
  const fn = (f: Fn): number[] => { const b = [...vec(f.locals.map(([n, t]) => [...uleb(n), t])), ...f.body, 0x0b]; return [...uleb(b.length), ...b]; };
  const globals = [[0x7f, 0x00, ...I.i32(0), 0x0b], [0x7f, 0x00, ...I.i32(WRITES_AT), 0x0b], ...(emitsAt === null ? [] : [[0x7f, 0x00, ...I.i32(emitsAt), 0x0b]])];
  const exports = [
    [...name('memory'), 0x02, 0x00], [...name('reads_at'), 0x03, 0x00], [...name('writes_at'), 0x03, 0x01],
    ...(emitsAt === null ? [] : [[...name('emits_at'), 0x03, 0x02]]), [...name('init'), 0x00, 0x00], [...name('step'), 0x00, 0x01],
  ];
  const bytes = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, ...uleb(pages), ...uleb(pages)]])),
    ...section(6, vec(globals)),
    ...section(7, vec(exports)),
    ...section(10, vec([fn(init), fn(step)])),
  ]);
  return { name: label, bytes, sha: sha256(bytes) };
}
const NONE: Fn = { locals: [], body: [] };
const I32 = 0x7f;
const I64 = 0x7e;

/** The write region starts here in every program; each array in declaration order on an 8-byte boundary (the names
 * are alphabetical in declaration order too, so either order lays them out alike); a bool or an i32 4 B, a vec3 24 B. */
export const WRITES_AT = 4096;

// ---------------------------------------------------------------------------------------------------
// The fog piece (criteria 1, 2, 7): `sight` writes four enemies and each player's sight of them.

export const SIGHT = 'sight';
export const ENEMIES = 'enemies';
export const ENEMY_COUNT = 4;
/** Enemy i stands at x = −6 + 4i, z = −3 (m), a 1.6 × 1 × 1.6 m box on the ground. */
export const enemyX = (i: number): number => -6 + 4 * i;
export const ENEMY_Z = -3;
/** The step from which enemy 1 is in player 1's sight too. */
export const SIGHT_CHANGE = 200;
/**
 * `seen[i]` after step k: bit p − 1 set where player p sees enemy i. Enemy 0: both; enemy 1: player 2 only before step
 * 200, both from it; enemy 2: player 1 only; enemy 3: neither.
 */
export const seenAt = (i: number, k: number): number => [3, k < SIGHT_CHANGE ? 2 : 3, 1, 0][i]!;
export const SIGHT_WRITES: JsonObject = { gen: { type: 'i32', count: 4 }, live: { type: 'bool', count: 4 }, pos: { type: 'vec3', count: 4 }, seen: { type: 'i32', count: 4 } };
const GEN = WRITES_AT; const LIVE = WRITES_AT + 16; const POS = WRITES_AT + 32; const SEEN = WRITES_AT + 128;
/** `sight`: each step every enemy is live, generation 1, at its place, and `seen` holds `seenAt`. It reads nothing. */
export function sightProgram(): Program {
  const enemy = (i: number): number[] => code(
    I.i32(GEN + 4 * i), I.i32(1), I.store,
    I.i32(LIVE + 4 * i), I.i32(1), I.store,
    I.i32(POS + 24 * i), I.f64(enemyX(i)), I.f64store,
    I.i32(POS + 24 * i + 8), I.f64(0.5), I.f64store,
    I.i32(POS + 24 * i + 16), I.f64(ENEMY_Z), I.f64store,
  );
  const step = code(
    enemy(0), enemy(1), enemy(2), enemy(3),
    I.i32(SEEN), I.i32(3), I.store,
    I.i32(SEEN + 4), I.i32(2), I.i32(3), I.get(0), I.i64(SIGHT_CHANGE), I.i64ltS, I.select, I.store,
    I.i32(SEEN + 8), I.i32(1), I.store,
    I.i32(SEEN + 12), I.i32(0), I.store,
  );
  return logicModule('sight', 1, null, NONE, { locals: [], body: step });
}

// ---------------------------------------------------------------------------------------------------
// The dice piece (criteria 3, 4, 5): `dice` reads the slider `attack` and `net.draws`, and resolves each attack.

export const DICE = 'dice';
export const ATTACK = 'attack';
export const ATTACKS = 200;
/** The read region (Logic `logic@1`, in declaration order): `attack`, a slider's slot (a u32 count, 4 zero bytes, then
 * up to 16 entries of a u32 player, 4 zero bytes and the f64 value: 264 B); `net.draws` (README: `net.draws` in the read
 * region: a u32 count, 4 zero bytes, then up to 16 draws of a u32 step, 4 zero bytes and the u64 value: 264 B); then
 * the step's seed, an i64. */
export const DRAWS_AT = 264;
export const SEED_AT = 528;
export const DICE_WRITES: JsonObject = {
  count: { type: 'i32', count: 1 }, drawn: { type: 'i32', count: ATTACKS }, hi: { type: 'i32', count: ATTACKS },
  lo: { type: 'i32', count: ATTACKS }, roll: { type: 'i32', count: ATTACKS }, step: { type: 'i32', count: ATTACKS },
};
const COUNT = WRITES_AT; const DRAWN = WRITES_AT + 8; const HI = WRITES_AT + 808; const LO = WRITES_AT + 1608; const ROLL = WRITES_AT + 2408; const STEPS_AT = WRITES_AT + 3208;
/**
 * `dice` (README: The dice piece). Each `attack` entry the step reads becomes attack n (n counting from 0, up to 200):
 * `step[n]` the step that read it, `roll[n]` 1 + (the step's seed as a u64, mod 6), `drawn[n]` 0. Each draw the step
 * reads in `net.draws` resolves the first attack not yet drawn whose `step` is the draw's step: `roll` 1 + (the draw's
 * value mod 6), `lo` and `hi` its low and high 32 bits, `drawn` 1. So with draw_after every roll ends drawn, and
 * without it (no draw ever comes) every roll is the step's seed's: the same program serves both pieces.
 */
export function diceProgram(): Program {
  const [K, N, E, C, M, D, DS, J, SEED, V] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const at = (base: number, idx: number): number[] => code(I.i32(base), I.get(idx), I.i32(2), I.shl, I.add);
  const step = code(
    I.i32(SEED_AT), I.i64load, I.set(SEED),
    // The attacks this step read.
    I.i32(0), I.load, I.set(N), I.i32(0), I.set(E),
    I.block, I.loop,
    I.get(E), I.get(N), I.geU, I.brIf(1),
    I.i32(COUNT), I.load, I.set(C),
    I.get(C), I.i32(ATTACKS), I.ltU, I.if,
    at(STEPS_AT, C), I.get(K), I.wrap, I.store,
    at(ROLL, C), I.get(SEED), I.i64(6), I.i64remU, I.wrap, I.i32(1), I.add, I.store,
    I.i32(COUNT), I.get(C), I.i32(1), I.add, I.store,
    I.end,
    I.get(E), I.i32(1), I.add, I.set(E),
    I.br(0),
    I.end, I.end,
    // The draws this step read.
    I.i32(DRAWS_AT), I.load, I.set(M), I.i32(0), I.set(D),
    I.block, I.loop,
    I.get(D), I.get(M), I.geU, I.brIf(1),
    I.i32(DRAWS_AT + 8), I.get(D), I.i32(4), I.shl, I.add, I.load, I.set(DS),
    I.i32(DRAWS_AT + 16), I.get(D), I.i32(4), I.shl, I.add, I.i64load, I.set(V),
    I.i32(COUNT), I.load, I.set(C), I.i32(0), I.set(J),
    I.block, I.loop,
    I.get(J), I.get(C), I.geU, I.brIf(1),
    at(STEPS_AT, J), I.load, I.get(DS), I.eq, at(DRAWN, J), I.load, I.eqz, I.and, I.if,
    at(ROLL, J), I.get(V), I.i64(6), I.i64remU, I.wrap, I.i32(1), I.add, I.store,
    at(LO, J), I.get(V), I.wrap, I.store,
    at(HI, J), I.get(V), I.i64(32), I.i64shrU, I.wrap, I.store,
    at(DRAWN, J), I.i32(1), I.store,
    I.br(2),
    I.end,
    I.get(J), I.i32(1), I.add, I.set(J),
    I.br(0),
    I.end, I.end,
    I.get(D), I.i32(1), I.add, I.set(D),
    I.br(0),
    I.end, I.end,
  );
  return logicModule('dice', 1, null, NONE, { locals: [[7, I32], [2, I64]], body: step });
}

/** One scripted entry, #549's form: the player sets `control` to `value` when match step `step` is the first its copy
 * hasn't run, so it lands `delay` steps later. */
export interface Play { step: number; control: string; value: number }
export type Plays = Record<string, Play[]>;
/** Criteria 3 and 4: attack n is made at match step 10 + 3n by player 1 for even n and player 2 for odd n, so it lands
 * at 14 + 3n (one attack a step at most); 200 attacks, the last landing at step 611. */
export const MATCH_STEPS = 700;
export const attackStep = (n: number): number => 10 + 3 * n;
export function attacks(): Plays {
  const out: Plays = { '1': [], '2': [] };
  for (let n = 0; n < ATTACKS; n++) out[String((n % 2) + 1)]!.push({ step: attackStep(n), control: ATTACK, value: 1 });
  return out;
}
/** The first attack's step on the track: the first drawn step. */
export const FIRST_DRAWN = attackStep(0) + DELAY;
/** Criterion 5: the piece played alone in a replica, attack n stamped at step 10 + 4n by player 1 (its bits at the next
 * step), over 900 steps; `moved`: the 50th attack and every later one stamped one step later. */
export const ALONE_STEPS = 900;
export const MOVED_FROM = 50;
export const aloneStep = (n: number): number => 10 + 4 * n;
export function aloneTrack(o: { moved?: boolean } = {}): JsonObject[] {
  return Array.from({ length: ATTACKS }, (_, n) => ({ t: (aloneStep(n) + (o.moved && n + 1 >= MOVED_FROM ? 1 : 0)) * STEP, seq: 0, control: ATTACK, value: 1, writer: 'you', player: 1 }));
}

// ---------------------------------------------------------------------------------------------------
// The war piece (criteria 6, 7): `war` writes a 128 × 128 fog grid, two bits a player, and emits two grenades.

export const WAR = 'war';
export const GRID = 128;
/** A player's two bits at a cell: 0 unseen, 1 radar, 2 seen. */
export const UNSEEN = 0;
export const RADAR = 1;
export const SEEN_STATE = 2;
/**
 * Player p's state at cell (cx, cz). Rows cz < 16: both see. Rows 16 to 103: player 1 sees cx < 48, has radar on
 * 48 to 63 and nothing from 64; player 2 sees cx ≥ 80, has radar on 64 to 79 and nothing below 64. Rows 104 to 111:
 * radar for both. Rows from 112: neither.
 */
export function cellState(p: 1 | 2, cx: number, cz: number): number {
  if (cz < 16) return SEEN_STATE;
  if (cz >= 112) return UNSEEN;
  if (cz >= 104) return RADAR;
  if (p === 1) return cx < 48 ? SEEN_STATE : cx < 64 ? RADAR : UNSEEN;
  return cx >= 80 ? SEEN_STATE : cx >= 64 ? RADAR : UNSEEN;
}
/** The grid's value at a cell: player 1's two bits, then player 2's. */
export const cellValue = (cx: number, cz: number): number => cellState(1, cx, cz) | (cellState(2, cx, cz) << 2);
/** `war` writes grid row cz = k at step k < 128, so the whole grid stands from step 127. */
export const GRID_DONE = GRID - 1;
/** The grenades: kind `grenade`, a = 1 at step 150 at cell (100, 64), in player 1's fog and in player 2's sight; a = 2
 * at step 170 at cell (20, 8), which both see. A cell (cx, cz) spans x from −64 + cx, z from −64 + cz (m). */
export interface Grenade { a: number; step: number; cell: [number, number] }
export const GRENADES: readonly Grenade[] = [{ a: 1, step: 150, cell: [100, 64] }, { a: 2, step: 170, cell: [20, 8] }];
export const cellCentre = (c: [number, number]): [number, number, number] => [-GRID / 2 + c[0] + 0.5, 0, -GRID / 2 + c[1] + 0.5];
export const WAR_STEPS = 300;
/** The frames criterion 6 reads: after the whole grid stands, before the first grenade. */
export const WAR_VIEW_STEP = 140;
export const WAR_WRITES: JsonObject = { fog: { type: 'i32', count: GRID * GRID } };
/** The emit region follows the write region: one kind, `grenade {point: vec3}`, at most 16 rows of a u32 a, a u32 b
 * and the point (3 × f64): a u32 count, then 32 B a row. */
export const EMITS_AT = WRITES_AT + 4 * GRID * GRID;
/** `war` (README: The war piece). Step k < 128 writes row k of `fog` with `cellValue`; steps 150 and 170 each emit
 * one grenade row. Two pages of memory. */
export function warProgram(): Program {
  const [K, CX, V] = [0, 1, 2];
  const lt = (n: number): number[] => code(I.get(CX), I.i32(n), I.ltU);
  // The value of cell (CX, k): picked by the row's band, as cellValue gives it.
  const middle = code(
    I.i32(2), I.i32(1), I.i32(0), lt(64), I.select, lt(48), I.select,
    I.i32(2), I.i32(1), I.i32(0), lt(64), I.eqz, I.select, lt(80), I.eqz, I.select, I.i32(2), I.shl,
    I.or,
  );
  const row = (k: number): number[] => code(I.get(K), I.i64(k), I.i64ltS);
  const value = code(
    I.i32(10), I.i32(0), I.i32(5), middle, row(104), I.eqz, I.select, row(112), I.eqz, I.select, row(16), I.select,
  );
  const grenade = (g: Grenade): number[] => {
    const [x, y, z] = cellCentre(g.cell);
    return code(
      I.get(K), I.i64(g.step), I.i64eq, I.if,
      I.i32(EMITS_AT), I.i32(1), I.store,
      I.i32(EMITS_AT + 4), I.i32(g.a), I.store,
      I.i32(EMITS_AT + 8), I.i32(0), I.store,
      I.i32(EMITS_AT + 12), I.f64(x), I.f64store,
      I.i32(EMITS_AT + 20), I.f64(y), I.f64store,
      I.i32(EMITS_AT + 28), I.f64(z), I.f64store,
      I.end,
    );
  };
  const step = code(
    row(GRID), I.if,
    I.i32(0), I.set(CX),
    I.block, I.loop,
    I.get(CX), I.i32(GRID), I.geU, I.brIf(1),
    value, I.set(V),
    // fog[128 k + cx] at writes_at + 4 (128 k + cx)
    I.i32(WRITES_AT), I.get(K), I.wrap, I.i32(GRID), [0x6c], I.get(CX), I.add, I.i32(2), I.shl, I.add, I.get(V), I.store,
    I.get(CX), I.i32(1), I.add, I.set(CX),
    I.br(0),
    I.end, I.end,
    I.end,
    ...GRENADES.map(grenade),
  );
  return logicModule('war', 2, EMITS_AT, NONE, { locals: [[2, I32]], body: step });
}

// ---------------------------------------------------------------------------------------------------
// The spawn's tone (Spawn: `play.src`): 0.25 s of a mono 1 kHz cosine at 0.5, 16-bit, 48 kHz (#544's template).

export const SAMPLE_RATE = 48_000;
export function toneWav(): Buffer {
  const frames = SAMPLE_RATE / 4;
  const b = Buffer.alloc(44 + frames * 2);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + frames * 2, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SAMPLE_RATE, 24); b.writeUInt32LE(SAMPLE_RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) b.writeInt16LE(Math.round(0.5 * Math.cos((2 * Math.PI * 1000 * i) / SAMPLE_RATE) * 32767), 44 + 2 * i);
  return b;
}

// ---------------------------------------------------------------------------------------------------
// Documents (#391's envelope as you send it, as #549's and #550's suites write them). IDs are 26 Crockford characters.

const ulid = (k: number): string => `01JB552D${String(k).padStart(18, '0')}`;
export const DOC = { fog: ulid(1), dice: ulid(2), war: ulid(3), court: ulid(4), probe: ulid(5) } as const;
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #552 acceptance tests.' };
const order = (k: number): string => `a${String(k).padStart(4, '0')}`;
export type Size = [number, number];
type V3 = [number, number, number];

/** An orthographic camera straight above `target`, `width` m across the frame; +X right, +Z down (#537's). */
export const topDown = (target: V3, width: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'orthographic', position: [target[0], target[1] + 50, target[2]], target, view_width: width, near: 1, far: 200 } });
/** The pixel (fractional) of world point (x, z) under `topDown([0, 0, 0], width)` at `size`. */
export const topDownPx = (size: Size, width: number, x: number, z: number): [number, number] =>
  [size[0] / 2 + x * (size[0] / width), size[1] / 2 + z * (size[0] / width)];
const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
const column = (path: string, as: string): JsonObject => ({ array: path, as });
const netItem = (extra: JsonObject = {}): JsonObject =>
  ({ kind: 'net@1', params: { relay: RELAY, players: 2, step_rate: RATE, delay: DELAY, window: 0, hash_every: HASH_EVERY, ...extra } });
function envelope(id: string, title: string, size: Size, span: string, modules: JsonObject, items: Record<string, JsonObject>, assets: JsonObject, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let k = 0;
  for (const [itemId, item] of Object.entries(items)) withIds[itemId] = { id: itemId, name: itemId, order: order(k++), ...item };
  return {
    format: 1, id, profile: 'scene', title, description: `${title}: a piece the #552 acceptance tests play.`, size, camera: 'cam', seed: 552,
    transport: { span, frame_rate: [60, 1] }, requires: { modules }, ...extra, assets, items: withIds,
  };
}

/** The fog piece's frame: 640 × 360, 20 m across (32 px a metre). Enemy i's centre is at px (128 i + 128, 84). */
export const FOG_SIZE: Size = [640, 360];
export const FOG_WIDTH = 20;
export const enemyPx = (i: number, size: Size = FOG_SIZE): [number, number] => topDownPx(size, FOG_WIDTH, enemyX(i), ENEMY_Z).map(Math.round) as [number, number];
/** An empty spot of sky beside the enemies, the frame's background. */
export const SKY_PX: [number, number] = [320, 20];
/**
 * The fog piece (README: The fog piece): seen from straight above, four enemy boxes (an unlit orange) on a black sky
 * above a floor (an unlit grey band over the frame's lower part, so an export's frame is never blank); the logic item
 * `sight` (20 Hz) and the instancer `enemies` fed by it, whose `seen` column reads `sight.seen`; the net item `match`.
 * `reads`: the planted logic item's reads (criterion 1: `['match.me']`). `relay`: the relay the net item declares.
 */
export function fogDoc(program: Program, o: { reads?: string[]; relay?: string; size?: Size; id?: string } = {}): JsonObject {
  const size = o.size ?? FOG_SIZE;
  return envelope(o.id ?? DOC.fog, 'A fog piece', size, '60s', { scene3d: '^1', logic: '^1', net: '^1' }, {
    cam: topDown([0, 0, 0], FOG_WIDTH),
    sky: DARK_SKY,
    paint: material({ base_color: [0.9, 0.35, 0.1, 1], unlit: true }),
    stone: material({ base_color: [0.35, 0.35, 0.35, 1], unlit: true }),
    floor: { kind: 'mark.box@1', params: { size: [40, 0.2, 5] }, material: 'stone', at: { pos: [0, -0.1, 3.5] } },
    unit: { kind: 'mark.box@1', params: { size: [1.6, 1, 1.6] }, material: 'paint', visible: false },
    [SIGHT]: { kind: 'logic@1', params: { program: program.sha, step_rate: RATE, reads: o.reads ?? [], writes: SIGHT_WRITES } },
    [ENEMIES]: {
      kind: 'instance@1',
      params: { of: ['unit'], live: column(`${SIGHT}.live`, 'bool'), gen: column(`${SIGHT}.gen`, 'u32'), pos: column(`${SIGHT}.pos`, 'f32'), seen: column(`${SIGHT}.seen`, 'i32') },
    },
    [NET]: netItem(o.relay ? { relay: o.relay } : {}),
  }, { sight_program: { sha256: program.sha, license: LICENSE } });
}

/** The dice piece (README: The dice piece): a camera and a table; the slider `attack` (0 to 1 by 1); the logic item
 * `dice` (20 Hz, reading `attack` and `net.draws`); the net item `match`, with `draw_after: ["attack"]` unless
 * `drawAfter` is false. */
export function diceDoc(program: Program, o: { drawAfter?: boolean } = {}): JsonObject {
  return envelope(DOC.dice, o.drawAfter === false ? 'A dice piece rolled from the step' : 'A dice piece', FOG_SIZE, '60s', { scene3d: '^1', input: '^1', logic: '^1', net: '^1' }, {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 3, 30], target: [0, 0, 0], fov: 50 } },
    table: { kind: 'mark.box@1', params: { size: [40, 0.2, 20] }, at: { pos: [0, -0.1, 0] } },
    [DICE]: { kind: 'logic@1', params: { program: program.sha, step_rate: RATE, reads: [ATTACK, 'net.draws'], writes: DICE_WRITES } },
    [NET]: netItem(o.drawAfter === false ? {} : { draw_after: [ATTACK] }),
  }, { dice_program: { sha256: program.sha, license: LICENSE } }, {
    controls: { [ATTACK]: { kind: 'slider', class: 'document', label: 'Attack', role: 'slider', range: [0, 1], default: 0, increment: 1 } },
  });
}

/** The war piece's frame: 1,024 × 1,024, the 128 m plate across it (8 px a cell); cell (cx, cz)'s centre is at px
 * (8 cx + 4, 8 cz + 4). */
export const WAR_SIZE: Size = [1024, 1024];
export const cellPx = (cx: number, cz: number): [number, number] => [8 * cx + 4, 8 * cz + 4];
/** The overlay's roles, in the shipped look: unseen draws `ink`, radar `muted`, seen the plate's own cover. */
export const FOG_ROLES = ['ink', 'muted', 'none'] as const;
/**
 * The war piece (README: The war piece): a 128 × 128 m flat terrain plate seen from straight above, lit by one sun, its
 * overlay reading `war.fog` through `match.me`; the logic item `war` (20 Hz) declaring `fog: {grid: "war.fog", …}` and
 * emitting `grenade {point: vec3}`; the burst `sparks` and the spawn `boom` on `war.occurrences`, both filtered to
 * grenade; the net item `match`. `size`, `width`: the frame and the camera's view width (criterion 7's window).
 */
export function warDoc(program: Program, toneSha: string, o: { size?: Size; width?: number } = {}): JsonObject {
  const grid = `${WAR}.fog`;
  const at = { size: [GRID, GRID], origin: [-GRID / 2, -GRID / 2], cell: 1 };
  return envelope(DOC.war, 'A war piece', o.size ?? WAR_SIZE, '60s', { scene3d: '^1', logic: '^1', net: '^1', effects: '^1', media: '^1' }, {
    cam: topDown([0, 0, 0], o.width ?? GRID),
    sky: DARK_SKY,
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-60, 20, 0] } },
    soil: material({ base_color: [0.4, 0.6, 0.25, 1], metallic: 0, roughness: 1 }),
    ground: {
      kind: 'plate@1',
      params: { terrain: { height: '0', size: [GRID, GRID], spacing: 1, tile: 64, lod_levels: 1 }, overlays: [{ grid, size: [GRID, GRID], roles: [...FOG_ROLES], opacity: 1, player: 'match.me' }] },
      material: 'soil',
    },
    [WAR]: {
      kind: 'logic@1',
      params: { program: program.sha, step_rate: RATE, reads: [], writes: WAR_WRITES, emits: { grenade: { fields: { point: 'vec3' } } }, fog: { grid, ...at } },
    },
    sparks: {
      kind: 'particles@1',
      params: {
        count: 256, emit: { shape: 'point', on: { list: `${WAR}.occurrences`, kinds: ['grenade'], count: 16 } }, life: [0.5, 0.5],
        motion: { ballistic: { v0: [1, 2], gravity: [0, -9.81, 0], drag: 0 } }, draw: 'spark', size: 4, opacity: 1,
        color: [{ at: 0, role: 'accent' }, { at: 1, role: 'muted' }],
      },
    },
    [NET]: netItem(),
  }, { war_program: { sha256: program.sha, license: LICENSE }, boom_tone: { sha256: toneSha, license: LICENSE } }, {
    transport: { span: '60s', frame_rate: [60, 1], sample_rate: SAMPLE_RATE },
    spawns: { boom: { on: { list: `${WAR}.occurrences`, kinds: ['grenade'] }, play: { src: { asset: toneSha }, in: 0, out: FLICKS / 4 } } },
  });
}
/** The readers of the grenades: the burst and the spawn. */
export const BURST = 'sparks';
export const VOICE = 'boom';

// ---------------------------------------------------------------------------------------------------
// The planted names (README: Planted twins): the scenario's `planted`, and deep-drive's DEEP_DRIVE_PLANT.

export type Planted =
  | 'net_sends_match_me'
  | 'seen_reads_player_one'
  | 'net_guesses_from_seed'
  | 'net_reveals_other_bits'
  | 'net_withholds_bits'
  | 'draws_from_first_bits'
  | 'fog_overlay_reads_player_one'
  | 'burst_ignores_fog';
export type DrivePlant = 'alone-bits-from-secure' | 'draw-hashes-step';
