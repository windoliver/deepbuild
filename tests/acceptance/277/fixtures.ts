// The criteria's fixtures (README: Fixtures): the eight-seat test piece and the 8-seat strategy fixture, their one
// logic program as WebAssembly bytes written here (reading `net.seats` as the issue's Fields say), each player's seeded
// script, the criteria's numbers and the planted names. Nothing here steps a match, hashes a state or draws anything;
// no vitest import, so a scratch script can run the program in Node's own WebAssembly.

import { createHash } from 'node:crypto';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------------------------------------------
// The eight-seat piece's match, at net@1's defaults (Net `net@1`): 60 Hz, delay 2, window 8, a full-state hash every
// 60 match steps, a timeout of 5 s.

export const FLICKS = 705_600_000;
export const RATE = 60;
/** One match step at 60 Hz: 11,760,000 flicks. */
export const STEP = FLICKS / RATE;
export const DELAY = 2;
export const WINDOW = 8;
export const HASH_EVERY = 60;
/** "Four times the 5 s timeout" (criterion 3): net@1's default. */
export const TIMEOUT_S = 5;
/** The piece's seats, and the players its net item declares ("`players: 4`"). */
export const SEATS = 8;
export const PEOPLE = 4;
/** The logic item, the net item, and the relay every in-process piece declares (it never joins one). */
export const LOGIC = 'rules';
export const NET = 'match';
export const RELAY = 'https://relay.test/277';

/** Criteria 1 and 2: copy 3 is killed right after it runs match step 900, so its last message is for step 902 (it sends
 * its message for k + delay when it first runs k), and the agreed `left` entry is stamped at 903, the step after the
 * highest step any copy holds its message for. */
export const KILLED = 3;
export const KILL_STEP = 900;
export const LAST_SENT = KILL_STEP + DELAY;
export const LEFT_AT = LAST_SENT + 1;
/** Criterion 1: "play on for 3,600 steps". */
export const PLAY_ON = 3600;
/** Criterion 2: the relay holds copy 3's last 4 messages back from copy 2 alone. */
export const HELD_FROM = 2;
export const HELD_LAST = 4;
/** Criteria 3 and 5: hidden at match step 1,200 for 20 s, four times the timeout. */
export const HIDE_STEP = 1200;
export const HIDE_S = 20;
/** Criterion 3: the hidden (and the frozen) copy. Its `absent` rides on its next unsent step's message, step + delay + 1. */
export const HIDDEN = 4;
export const ABSENT_AT = HIDE_STEP + DELAY + 1;
/** Criterion 1's planted run: copy 1's frames wait at the relay for 0.5 s from 12 steps before the kill (#549's
 * `relay.hold`), so copies 2 and 4 stand at their window when the close comes and notice it at other steps than copy 1. */
export const NOTICE_HOLD = { player: 1, at: (KILL_STEP - 12) / RATE, for: 0.5 };
/** The live matches' timeout (criteria 1 and 5): long, so a loaded machine never turns a slow copy into a leave; the
 * kill comes by the relay's `closed`, and the hidden copy says `absent`. */
export const LIVE_TIMEOUT_S = 120;
/** Criterion 5: the showpiece class's frame CPU (Frame budget; "4 ms in the showpiece class"), and the five hides whose
 * catch-ups logic.budget's five runs read, one every 1,800 match steps from step 1,200. */
export const FRAME_CPU_MS = 4;
export const RUNS = 5;
export const HIDE_EVERY = 1800;
/** Criterion 4's match whose seats never change: the eight-seat piece's four copies for 1,800 steps on their seeded
 * scripts, the test relay holding each frame back a seeded 0 to 8 steps (#551's `relay.back`), its log kept. */
export const WORK_STEPS = 1800;
export const WORK_RELAY = { seed: 277, back: { up_to: WINDOW }, log: true };
/** What the merge base (e575a47af) counts for that match, the piece without its `net.seats` read (`arenaPiece({seats:
 * false})`, the one form it presents), read by this suite's run there, twice, alike (BASE-FAILURE.txt): the frames the
 * test relay carried (a row a frame and copy), their bytes and messages, the copies' rollbacks and the steps those ran
 * again, and the steps the copies ran. */
export const BASE_WORK = { frames: 21_612, bytes: 1_339_872, messages: 176_544, rollbacks: 971, rerun: 1_886, ran: 7_200 };

// The 8-seat strategy fixture (criterion 6): 30 Hz, lockstep (Net: lockstep, the mode for a strategy game), delay 4,
// a full-state hash every 60 match steps, 8 players.
export const S_RATE = 30;
export const S_STEP = FLICKS / S_RATE;
export const S_DELAY = 4;
export const S_PLAYERS = 8;
/** "Killing copy 3 at step 27,000 … the other copies play 9,000 more steps". */
export const S_KILL_STEP = 27_000;
export const S_MORE = 9_000;
export const S_LEFT_AT = S_KILL_STEP + S_DELAY + 1;
/** Player 4's `take` of seat 3, made at this step (stamped `S_DELAY` later), after the leave. */
export const S_TAKER = 4;
export const S_TAKE_STEP = 27_300;
export const S_TAKE_AT = S_TAKE_STEP + S_DELAY;

/** A seat entry's states, as the program reads them from `net.seats` (README: `net.seats` in the read region). */
export const STATE = { left: 1, absent: 2, back: 3 } as const;
export type SeatState = keyof typeof STATE;

// ---------------------------------------------------------------------------------------------------
// WebAssembly, written as bytes (Logic `logic@1`: one memory whose maximum is its minimum, immutable i32 globals
// `reads_at` and `writes_at`, `init(seed: i64)`, `step(k: i64)`, no imports; MVP instructions only).

const uleb = (n: number): number[] => { const o: number[] = []; let v = n >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const sleb = (n: number): number[] => {
  const o: number[] = [];
  let v = n | 0;
  for (;;) { const b = v & 0x7f; v >>= 7; if ((v === 0 && !(b & 0x40)) || (v === -1 && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); }
};
const f64bytes = (x: number): number[] => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return [...b]; };
const name = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'latin1')];
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
const I = {
  get: (l: number): number[] => [0x20, ...uleb(l)],
  set: (l: number): number[] => [0x21, ...uleb(l)],
  i32: (n: number): number[] => [0x41, ...sleb(n)],
  f64: (x: number): number[] => [0x44, ...f64bytes(x)],
  load: (offset = 0): number[] => [0x28, 0x02, ...uleb(offset)],
  store: (offset = 0): number[] => [0x36, 0x02, ...uleb(offset)],
  f64load: (offset = 0): number[] => [0x2b, 0x03, ...uleb(offset)],
  f64store: (offset = 0): number[] => [0x39, 0x03, ...uleb(offset)],
  block: [0x02, 0x40], loop: [0x03, 0x40], if: [0x04, 0x40], else: [0x05], end: [0x0b],
  br: (d: number): number[] => [0x0c, ...uleb(d)],
  brIf: (d: number): number[] => [0x0d, ...uleb(d)],
  eqz: [0x45], eq: [0x46], ne: [0x47], ltU: [0x49], geU: [0x4f],
  add: [0x6a], sub: [0x6b], mul: [0x6c], and: [0x71], shl: [0x74], shrU: [0x76],
  fadd: [0xa0], fsub: [0xa1], fmul: [0xa2], fmin: [0xa4], fmax: [0xa5],
  truncS: [0xaa], convertS: [0xb7], select: [0x1b],
} as const;
const code = (...parts: (readonly number[])[]): number[] => parts.flatMap((p) => [...p]);

export interface Program { name: string; bytes: Buffer; sha: string }

/** One entry slot of the read region: a u32 count and 4 zero bytes, then at most 16 rows of 16 B (Logic `logic@1`). */
export const SLOT = 264;
/** The write region, each array in declaration order on an 8-byte boundary (alphabetical too, so either order lays
 * them out alike): `gone` i32 × 8, `owner` i32 × 8, `tally` i32. Each seat's goal (f64 × 8) and its units' positions
 * (f64 × 8 × units) live in memory past it, which every checkpoint and full-state hash holds, so a row stays small. */
export const WRITES_AT = 4096;
const GONE = WRITES_AT;
const OWNER = WRITES_AT + 32;
const TALLY = WRITES_AT + 64;
export const GOAL = 8192;
export const POS = 8256;
export const RULES_WRITES: JsonObject = { gone: { type: 'i32', count: SEATS }, owner: { type: 'i32', count: SEATS }, tally: { type: 'i32' } };

/** How a program variant reads and plays (README: The rules). */
export interface Rules {
  /** Seats 1 … `people` start played by their players; the rest are the bot's from the start. */
  people: number;
  /** Units a seat has: 1 in the eight-seat piece, 2 in the strategy fixture. */
  units: 1 | 2;
  /** Whether the item reads `net.seats` (first in its reads). Only criterion 4's merge-base reference leaves it out. */
  seats: boolean;
  /** Whether it reads the `take` control (the strategy fixture). */
  take: boolean;
}

// Locals of `step`: 0 the step (i64); i32 1 n, 2 e, 3 q, 4 s, 5 i, 6 st; f64 7 v, 8 x.
const [N, E, Q, S, U, ST, V, X] = [1, 2, 3, 4, 5, 6, 7, 8];
/** base + idx × 4, and base + idx × 8: an i32's and an f64's address in an array. */
const at4 = (base: number, idx: readonly number[]): number[] => code(I.i32(base), idx, I.i32(2), I.shl, I.add);
const at8 = (base: number, idx: readonly number[]): number[] => code(I.i32(base), idx, I.i32(3), I.shl, I.add);
const qIndex = code(I.get(Q), I.i32(1), I.sub);
/** Each row of a read slot in order: `e` its index, `n` the slot's count; `body` reads the row at `rowAt`. */
const eachRow = (slot: number, body: readonly number[]): number[] => code(
  I.i32(slot), I.load(0), I.set(N), I.i32(0), I.set(E),
  I.block, I.loop,
  I.get(E), I.get(N), I.geU, I.brIf(1),
  body,
  I.get(E), I.i32(1), I.add, I.set(E),
  I.br(0),
  I.end, I.end,
);
/** The address of row `e` of a slot, less 8 (so a row's field at byte f is `load(8 + f)`). */
const rowAt = (slot: number): number[] => code(I.i32(slot), I.get(E), I.i32(4), I.shl, I.add);
/** For each seat s from 0 to 7: `body`. */
const eachSeat = (body: readonly number[]): number[] => code(
  I.i32(0), I.set(S),
  I.block, I.loop,
  I.get(S), I.i32(SEATS), I.geU, I.brIf(1),
  body,
  I.get(S), I.i32(1), I.add, I.set(S),
  I.br(0),
  I.end, I.end,
);

/**
 * `rules`, the eight-seat piece's and the strategy fixture's logic (README: The rules). Seat s (1 … 8) is played by
 * `owner[s]`: a player, or 0, the piece's bot. `init` gives seats 1 … people to their players and the rest to the bot.
 * Each step reads, in its reads' order:
 *   - `net.seats` (the issue's `{player, state, step}`): `left` or `absent` hands the player's seat to the bot (gone[s]
 *     = 1 or 2); `back` gives an absent player's seat back to them;
 *   - `aim`: an entry sets the goal of every seat its player plays, and no other (the rules validate the player);
 *   - `take` (strategy only): a player takes a seat whose player has left and the bot plays, when the seat is on their
 *     team (seats 1–4, 5–8) and they still play their own;
 * folding each row into `tally` in the order read, so the order of a step's entries changes the state. Then the bot
 * sets the goal of every seat it plays from the state (−0.75 × the first unit of the seat across the arena, plus the
 * seat's offset, within ±8), and every unit moves at most 0.25 a step toward its seat's goal (plus 0.5 for a seat's
 * second unit). Its whole state lives in its memory: the write region, read back each step, and the goals and
 * positions past it.
 */
export function rulesProgram(r: Rules): Program {
  const seatsAt = 0;
  const aimAt = r.seats ? SLOT : 0;
  const takeAt = aimAt + SLOT;
  const shift = r.units === 2 ? 1 : 0;
  // tally = tally × 31 + x (i32, wrapping): every seat row and entry, in the order the step reads them.
  const fold1 = (x: readonly number[]): number[] => code(I.i32(TALLY), I.i32(TALLY), I.load(0), I.i32(31), I.mul, x, I.add, I.store(0));
  const seatRow = code(
    rowAt(seatsAt), I.load(8), I.set(Q),
    rowAt(seatsAt), I.load(12), I.set(ST),
    fold1(code(I.get(Q), I.i32(100), I.mul, I.get(ST), I.add)),
    qIndex, I.i32(SEATS), I.ltU, I.if,
    I.get(ST), I.i32(STATE.back), I.ne, I.if,
    at4(GONE, qIndex), I.get(ST), I.store(0),
    at4(OWNER, qIndex), I.load(0), I.get(Q), I.eq, I.if,
    at4(OWNER, qIndex), I.i32(0), I.store(0),
    I.end,
    I.else,
    at4(GONE, qIndex), I.load(0), I.i32(STATE.absent), I.eq, I.if,
    at4(OWNER, qIndex), I.get(Q), I.store(0),
    at4(GONE, qIndex), I.i32(0), I.store(0),
    I.end,
    I.end,
    I.end,
  );
  const aimRow = code(
    rowAt(aimAt), I.load(8), I.set(Q),
    rowAt(aimAt), I.f64load(16), I.set(V),
    fold1(code(I.get(Q), I.i32(1000), I.mul, I.get(V), I.f64(2), I.fmul, I.truncS, I.add, I.i32(17), I.add)),
    eachSeat(code(
      at4(OWNER, I.get(S)), I.load(0), I.get(Q), I.eq, I.if,
      at8(GOAL, I.get(S)), I.get(V), I.f64store(0),
      I.end,
    )),
  );
  const takeRow = code(
    rowAt(takeAt), I.load(8), I.set(Q),
    rowAt(takeAt), I.f64load(16), I.truncS, I.i32(1), I.sub, I.set(S),
    fold1(code(I.get(Q), I.i32(10_000), I.mul, I.get(S), I.add)),
    I.get(S), I.i32(SEATS), I.ltU, qIndex, I.i32(SEATS), I.ltU, I.and, I.if,
    at4(GONE, I.get(S)), I.load(0), I.i32(STATE.left), I.eq,
    at4(OWNER, I.get(S)), I.load(0), I.eqz, I.and,
    I.get(S), I.i32(2), I.shrU, qIndex, I.i32(2), I.shrU, I.eq, I.and,
    at4(GONE, qIndex), I.load(0), I.eqz, I.and,
    I.if,
    at4(OWNER, I.get(S)), I.get(Q), I.store(0),
    I.end,
    I.end,
  );
  const bots = eachSeat(code(
    at4(OWNER, I.get(S)), I.load(0), I.eqz, I.if,
    at8(GOAL, I.get(S)),
    I.i32(POS), I.get(S), I.i32(4), I.add, I.i32(7), I.and, I.i32(3 + shift), I.shl, I.add, I.f64load(0), I.f64(-0.75), I.fmul,
    I.get(S), I.convertS, I.f64(0.5), I.fmul, I.f64(-1.75), I.fadd, I.fadd,
    I.f64(-8), I.fmax, I.f64(8), I.fmin,
    I.f64store(0),
    I.end,
  ));
  const move = code(
    I.i32(0), I.set(U),
    I.block, I.loop,
    I.get(U), I.i32(SEATS * r.units), I.geU, I.brIf(1),
    at8(GOAL, code(I.get(U), I.i32(shift), I.shrU)), I.f64load(0),
    I.get(U), I.i32(r.units - 1), I.and, I.convertS, I.f64(0.5), I.fmul, I.fadd,
    at8(POS, I.get(U)), I.f64load(0), I.fsub,
    I.f64(-0.25), I.fmax, I.f64(0.25), I.fmin, I.set(X),
    at8(POS, I.get(U)), at8(POS, I.get(U)), I.f64load(0), I.get(X), I.fadd, I.f64store(0),
    I.get(U), I.i32(1), I.add, I.set(U),
    I.br(0),
    I.end, I.end,
  );
  const step = code(
    r.seats ? eachRow(seatsAt, seatRow) : [],
    eachRow(aimAt, aimRow),
    r.take ? eachRow(takeAt, takeRow) : [],
    bots,
    move,
  );
  // init: owner[s] = s + 1 for s < people, else 0; goal[s] = 2s − 7; unit i at its seat's goal plus (i mod units) × 0.5.
  const init = code(
    eachSeat(code(
      at4(OWNER, I.get(S)), I.get(S), I.i32(1), I.add, I.i32(0), I.get(S), I.i32(r.people), I.ltU, I.select, I.store(0),
      at8(GOAL, I.get(S)), I.get(S), I.convertS, I.f64(2), I.fmul, I.f64(-7), I.fadd, I.f64store(0),
    )),
    I.i32(0), I.set(U),
    I.block, I.loop,
    I.get(U), I.i32(SEATS * r.units), I.geU, I.brIf(1),
    at8(POS, I.get(U)),
    I.get(U), I.i32(shift), I.shrU, I.convertS, I.f64(2), I.fmul, I.f64(-7), I.fadd,
    I.get(U), I.i32(r.units - 1), I.and, I.convertS, I.f64(0.5), I.fmul, I.fadd,
    I.f64store(0),
    I.get(U), I.i32(1), I.add, I.set(U),
    I.br(0),
    I.end, I.end,
  );
  const body = (locals: number[], b: number[]): number[] => { const f = [...locals, ...b, 0x0b]; return [...uleb(f.length), ...f]; };
  // Both functions take the i64 and share the locals' layout: 6 × i32, then 2 × f64.
  const locals = [0x02, 0x06, 0x7f, 0x02, 0x7c];
  const bytes = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, 0x01, 0x01]])),
    ...section(6, vec([[0x7f, 0x00, ...I.i32(0), 0x0b], [0x7f, 0x00, ...I.i32(WRITES_AT), 0x0b]])),
    ...section(7, vec([[...name('memory'), 0x02, 0x00], [...name('reads_at'), 0x03, 0x00], [...name('writes_at'), 0x03, 0x01], [...name('init'), 0x00, 0x00], [...name('step'), 0x00, 0x01]])),
    ...section(10, vec([body(locals, init), body(locals, step)])),
  ]);
  const tag = `${r.people}p-${r.units}u${r.seats ? '' : '-noseats'}${r.take ? '-take' : ''}`;
  return { name: `rules_${tag.replace(/-/g, '_')}`, bytes, sha: sha256(bytes) };
}

// ---------------------------------------------------------------------------------------------------
// Scripts: what each player does, by match step.

/** One scripted entry: the player sets `control` to `value` when match step `step` is the first its copy hasn't run,
 * so it is stamped `delay` steps later (Net `net@1`; #549's suite). */
export interface Play { step: number; control: string; value: number }
export type Plays = Record<string, Play[]>;

/** The aim values a script picks from: every one a multiple of 0.5 inside the slider's −8 … 8. */
const AIMS = [-6, -3.5, -1, 0.5, 2, 4.5, 7, -7.5, 3, -2.5, 6, -4, 1.5, -5.5, 5, 0];
/** mulberry32: a fixed-seed generator of numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The eight-seat piece's seeded scripts for players 1 … `people` over `steps` match steps: every player sets `aim`
 * every 10 steps, all at the same steps (k ≡ 0 mod 10), so most stamped steps hold several players' entries, a value
 * drawn from seed 277 + the player. `dense`: that player also sets `aim` at every step from `from` to `to`.
 */
export function arenaPlays(people: number, steps: number, o: { dense?: { player: number; from: number; to: number } } = {}): Plays {
  const out: Plays = {};
  for (let p = 1; p <= people; p++) {
    const draw = rng(277 + p);
    const list: Play[] = [];
    for (let g = 0; g + DELAY < steps; g++) {
      const dense = o.dense?.player === p && g >= o.dense.from && g <= o.dense.to;
      if (g % 10 === 0 || dense) list.push({ step: g, control: 'aim', value: AIMS[Math.floor(draw() * AIMS.length)]! });
    }
    out[String(p)] = list;
  }
  return out;
}

/** The strategy fixture's seeded scripts: each player sets `aim` every 30 steps (one a second), player p at k ≡ 3p mod
 * 30, and player 4 takes seat 3 at `S_TAKE_STEP`. */
export function strategyPlays(steps: number): Plays {
  const out: Plays = {};
  for (let p = 1; p <= S_PLAYERS; p++) {
    const draw = rng(2770 + p);
    const list: Play[] = [];
    for (let g = 0; g + S_DELAY < steps; g++) {
      if (g % 30 === (3 * p) % 30) list.push({ step: g, control: 'aim', value: AIMS[Math.floor(draw() * AIMS.length)]! });
      if (p === S_TAKER && g === S_TAKE_STEP) list.push({ step: g, control: 'take', value: KILLED });
    }
    out[String(p)] = list;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The planted names (README: Planted twins). Each is one criterion's wrong program, reachable only through the
// scenario's `planted`, and changes nothing else.

export type Planted =
  | 'net_leave_at_notice'
  | 'net_skips_last_exchange'
  | 'net_catch_up_in_arrival_order'
  | 'web_catch_up_jumps';

// ---------------------------------------------------------------------------------------------------
// Documents (#391's envelope as you send it, as #549's to #551's suites write them). IDs are 26 Crockford characters.

const ulid = (k: number): string => `01JB277D${String(k).padStart(18, '0')}`;
export const DOC = { arena: ulid(1), arenaEvery: ulid(2), arenaLive: ulid(3), arenaPair: ulid(4), arenaBase: ulid(5), strategy: ulid(6) } as const;
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #277 acceptance tests.' };
const order = (k: number): string => `a${String(k).padStart(4, '0')}`;
export const SIZE: [number, number] = [640, 360];
/** The keys a person presses on the web player for `aim` (Control: `keys`). */
export const AIM_KEYS: Record<string, number> = { 1: -6, 2: -4, 3: -2, 4: 0, 5: 2, 6: 4, 7: 6 };

export interface NetFields { relay?: JsonValue; players?: number; step_rate?: number; delay?: number; window?: number; hash_every?: number; timeout?: number }
const slider = (label: string, range: [number, number], increment: number, dflt: number, keys?: Record<string, number>): JsonObject => ({
  kind: 'slider', class: 'document', label, role: 'slider', range, default: dflt, increment, ...(keys ? { keys } : {}),
});
export interface Piece { doc: JsonObject; program: Program }

function pieceOf(o: { id: string; title: string; rules: Rules; rate: number; net: JsonObject; span: string }): Piece {
  const program = rulesProgram(o.rules);
  const reads = [...(o.rules.seats ? ['net.seats'] : []), 'aim', ...(o.rules.take ? ['take'] : [])];
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 30, 26], target: [0, 0, 0], fov: 50 } },
    table: { kind: 'mark.box@1', params: { size: [40, 0.2, 22] }, at: { pos: [0, -0.1, 0] } },
    [LOGIC]: { kind: 'logic@1', params: { program: program.sha, step_rate: o.rate, reads, writes: RULES_WRITES, checkpoint: { every: 60 } } },
    [NET]: { kind: 'net@1', params: o.net },
  };
  const withIds: JsonObject = {};
  let k = 0;
  for (const [itemId, item] of Object.entries(items)) withIds[itemId] = { id: itemId, name: itemId, order: order(k++), ...item };
  const controls: JsonObject = { aim: slider('Aim', [-8, 8], 0.5, 0, AIM_KEYS), ...(o.rules.take ? { take: slider('Take a seat', [1, 8], 1, 1) } : {}) };
  return {
    program,
    doc: {
      format: 1, id: o.id, profile: 'scene', title: o.title, description: 'A piece the #277 acceptance tests play.', size: SIZE, camera: 'cam', seed: 277,
      transport: { span: o.span, frame_rate: [60, 1] },
      requires: { modules: { scene3d: '^1', input: '^1', logic: '^1', net: '^1' } },
      budget: { class: 'showpiece' },
      controls,
      assets: { rules_program: { sha256: program.sha, license: LICENSE } },
      items: withIds,
    },
  };
}

/**
 * The eight-seat test piece (README: The eight-seat piece): eight seats, `people` of them played by the players its
 * net item declares (4; criterion 5's two-copy match 2) and the rest by the piece's bot, as is any left or absent seat;
 * the net item at net@1's defaults (60 Hz, delay 2, window 8, a hash every 60 steps, timeout 5 s) and what `net` sets.
 * `seats: false` is criterion 4's merge-base reference: the same piece with no `net.seats` read.
 */
export function arenaPiece(o: { id?: string; people?: number; net?: NetFields; seats?: boolean } = {}): Piece {
  const people = o.people ?? PEOPLE;
  return pieceOf({
    id: o.id ?? DOC.arena, title: 'An eight-seat arena', rules: { people, units: 1, seats: o.seats ?? true, take: false }, rate: RATE, span: '600s',
    net: { relay: RELAY, players: people, step_rate: RATE, delay: DELAY, window: WINDOW, hash_every: HASH_EVERY, timeout: TIMEOUT_S, ...o.net } as JsonObject,
  });
}

/** The 8-seat strategy fixture (README: The strategy fixture): 8 players, 30 Hz, lockstep, delay 4, two units a seat,
 * and the `take` control. */
export function strategyPiece(): Piece {
  return pieceOf({
    id: DOC.strategy, title: 'An eight-seat strategy match', rules: { people: S_PLAYERS, units: 2, seats: true, take: true }, rate: S_RATE, span: '1300s',
    net: { relay: RELAY, players: S_PLAYERS, step_rate: S_RATE, delay: S_DELAY, window: 0, hash_every: HASH_EVERY, timeout: TIMEOUT_S },
  });
}
