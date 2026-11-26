// The criteria's fixtures (README: Fixtures): the eight-seat test piece, its one logic program as WebAssembly bytes
// written here (reading `net.seats` with the issue's `joined` state, writing the piece's `open` and `finish` arrays),
// each player's seeded script, the criteria's numbers and the planted names. Nothing here steps a match, hashes a
// state or draws anything; no vitest import, so a scratch script can run the program in Node's own WebAssembly.

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
export const TIMEOUT_S = 5;
/** The piece's seats, and "`players {min: 2, max: 8}`" (criterion 1). */
export const SEATS = 8;
export const MIN = 2;
export const MAX = 8;
/** "Three copies joined" (criterion 1): players 1, 2 and 3 play seats 1, 2 and 3, and the piece's bot the other five. */
export const JOINED = 3;
/** The logic item, the net item, the arrays the logic item names as `open` and `finish`, and the relay every
 * in-process piece declares (it never joins one). */
export const LOGIC = 'rules';
export const NET = 'match';
export const OPEN_ARRAY = 'lobby';
export const FINISH_ARRAY = 'done';
export const RELAY = 'https://relay.test/278';

/** Criterion 2: "a fourth copy that joins at match step 600". */
export const JOINER = 4;
export const JOIN_STEP = 600;
/** Criteria 2 and 3's closed lobby: the piece's `open` array is true for steps 0 to 299 and false from step 300, so it
 * is false at steps 600 and 1,500. */
export const CLOSED_FROM = 300;
/** Criterion 3: "copy 3, killed at step 900 and stamped `left` as #277 stamps it": its last message is for step 902
 * (it sends its message for k + delay when it first runs k), and the agreed `left` entry is stamped at 903, the step
 * after it (#277's criteria 1 and 2). "Joins again at step 1,500". */
export const KILLED = 3;
export const KILL_STEP = 900;
export const LEFT_AT = KILL_STEP + DELAY + 1;
export const REJOIN_STEP = 1500;
/** Criterion 4: "writes 1 to `finish` at step 3,000". */
export const FINISH_AT = 3000;
/** Criterion 4's late entry: player 2 makes a `stay` entry when step 2,998 is the first its copy hasn't run, so it is
 * stamped at step 3,000, and the test relay hands copy 1 player 2's message for step 3,000 only once copy 1 has run
 * step 3,004 (#551's `relay.deliver`): copy 1 runs step 3,000 on a prediction that writes `finish`, and the corrected
 * run doesn't. */
export const LATE = { player: 2, madeAt: FINISH_AT - DELAY, to: 1, at: FINISH_AT + 4 } as const;
/** Criterion 4's next match: 600 steps, short of the step that finishes. */
export const NEXT_STEPS = 600;
/** The live matches' timeout (criteria 1 and 4): long, so a loaded machine never turns a slow copy into a leave. */
export const LIVE_TIMEOUT_S = 120;
/** Criterion 5's match of a piece without `open`, `finish` or a `{min, max}` count: four copies, 1,800 steps on their
 * seeded scripts, the test relay holding each frame back a seeded 0 to 8 steps (#551's `relay.back`), its log kept. */
export const WORK_PEOPLE = 4;
export const WORK_STEPS = 1800;
export const WORK_RELAY = { seed: 278, back: { up_to: WINDOW }, log: true };
/** What the merge base (7a256fd4b) counts for that match, read by this suite's run there, twice, alike
 * (BASE-FAILURE.txt): the frames the test relay carried (a row a frame and copy), their bytes and messages, the
 * copies' rollbacks and the steps those ran again, and the steps the copies ran. */
export const BASE_WORK = { frames: 21_612, bytes: 1_352_496, messages: 179_565, rollbacks: 1_001, rerun: 1_939, ran: 7_200 };

/** A seat entry's states, as the program reads them from `net.seats`: #277's three, then the issue's `joined`. */
export const STATE = { left: 1, absent: 2, back: 3, joined: 4 } as const;
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
  add: [0x6a], sub: [0x6b], mul: [0x6c], and: [0x71], shl: [0x74],
  fadd: [0xa0], fsub: [0xa1], fmul: [0xa2], fmin: [0xa4], fmax: [0xa5],
  wrap: [0xa7], truncS: [0xaa], convertS: [0xb7], select: [0x1b],
} as const;
const code = (...parts: (readonly number[])[]): number[] => parts.flatMap((p) => [...p]);

export interface Program { name: string; bytes: Buffer; sha: string }

/** One entry slot of the read region: a u32 count and 4 zero bytes, then at most 16 rows of 16 B (Logic `logic@1`). */
export const SLOT = 264;
/** The read region, in the reads' order: `net.seats`, `aim`, `stay`. */
const SEATS_AT = 0;
const AIM_AT = SLOT;
const STAY_AT = 2 * SLOT;
/** The write region, each array in declaration order on an 8-byte boundary (alphabetical too, so either order lays
 * them out alike): `done` i32, `ema` f64 × 8, `gone` i32 × 8, `held` i32, `lobby` bool (4 B), `owner` i32 × 8, `pos`
 * f64 × 8, `tally` i32. Each seat's goal (f64 × 8) lives in memory past it, which every checkpoint and full-state
 * hash holds. */
export const WRITES_AT = 4096;
const DONE = WRITES_AT;
const EMA = WRITES_AT + 8;
const GONE = WRITES_AT + 72;
const HELD = WRITES_AT + 104;
const LOBBY = WRITES_AT + 112;
const OWNER = WRITES_AT + 120;
const POS = WRITES_AT + 152;
const TALLY = WRITES_AT + 216;
const GOAL = 8192;
export const RULES_WRITES: JsonObject = {
  [FINISH_ARRAY]: { type: 'i32' }, ema: { type: 'f64', count: SEATS }, gone: { type: 'i32', count: SEATS }, held: { type: 'i32' },
  [OPEN_ARRAY]: { type: 'bool' }, owner: { type: 'i32', count: SEATS }, pos: { type: 'f64', count: SEATS }, tally: { type: 'i32' },
};

/** How a program variant plays (README: The rules). */
export interface Rules {
  /** Seats 1 … `people` start played by their players. 0 in a piece with a `{min, max}` count, whose seats are given
   * by the `joined` rows of `net.seats`; criterion 5's piece with one count gives its players their seats itself. */
  people: number;
  /** `lobby` is true while the step is below this: always (null), or up to a step. */
  openUntil: number | null;
  /** The step at which the rules write 1 to `done`, unless a player asked to stay; never (null). */
  finishAt: number | null;
}

// Locals of `step`: 0 the step (i64); i32 1 n, 2 e, 3 q, 4 s, 5 unused, 6 st; f64 7 v, 8 x.
const [N, E, Q, S, ST, V, X] = [1, 2, 3, 4, 6, 7, 8];
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
/** 2s − 7, a seat's place at the start. */
const home = code(I.get(S), I.convertS, I.f64(2), I.fmul, I.f64(-7), I.fadd);

/**
 * `rules`, the eight-seat piece's logic (README: The rules). Seat s (1 … 8) is played by `owner[s]`: a player, or 0,
 * the piece's bot. Each step reads, in its reads' order:
 *   - `net.seats` (#277's `{player, state, step}`, with the issue's `joined`): `joined` gives player q seat q, its old
 *     seat when it comes back; `left` or `absent` hands the player's seat to the bot (gone = 1 or 2); `back` gives an
 *     absent player's seat back;
 *   - `aim`: an entry sets the goal of every seat its player plays, and no other (the rules validate the player);
 *   - `stay`: an entry from a player who plays its own seat sets `held`, so the match isn't finished;
 * folding each row into `tally` in the order read, so the order of a step's entries changes the state. Then the bot
 * sets the goal of every seat it plays from the state (−0.75 × the place of the seat across the arena, plus the seat's
 * offset, within ±8), every seat moves at most 0.25 a step toward its goal, and `ema` follows `pos` (× 0.999 + pos ×
 * 0.001), so the state holds numbers no entry carries. Last, `lobby` is whether the step is below `openUntil`, and at
 * step `finishAt` the rules write 1 to `done` unless `held` is set. Its whole state lives in its memory: the write
 * region, read back each step, and the goals past it.
 */
export function rulesProgram(r: Rules): Program {
  // tally = tally × 31 + x (i32, wrapping): every seat row and entry, in the order the step reads them.
  const fold1 = (x: readonly number[]): number[] => code(I.i32(TALLY), I.i32(TALLY), I.load(0), I.i32(31), I.mul, x, I.add, I.store(0));
  const seatRow = code(
    rowAt(SEATS_AT), I.load(8), I.set(Q),
    rowAt(SEATS_AT), I.load(12), I.set(ST),
    fold1(code(I.get(Q), I.i32(100), I.mul, I.get(ST), I.add)),
    qIndex, I.i32(SEATS), I.ltU, I.if,
    I.get(ST), I.i32(STATE.joined), I.eq, I.if,
    at4(OWNER, qIndex), I.get(Q), I.store(0),
    at4(GONE, qIndex), I.i32(0), I.store(0),
    I.else,
    I.get(ST), I.i32(STATE.back), I.eq, I.if,
    at4(GONE, qIndex), I.load(0), I.i32(STATE.absent), I.eq, I.if,
    at4(OWNER, qIndex), I.get(Q), I.store(0),
    at4(GONE, qIndex), I.i32(0), I.store(0),
    I.end,
    I.else,
    at4(GONE, qIndex), I.get(ST), I.store(0),
    at4(OWNER, qIndex), I.load(0), I.get(Q), I.eq, I.if,
    at4(OWNER, qIndex), I.i32(0), I.store(0),
    I.end,
    I.end,
    I.end,
    I.end,
  );
  const aimRow = code(
    rowAt(AIM_AT), I.load(8), I.set(Q),
    rowAt(AIM_AT), I.f64load(16), I.set(V),
    fold1(code(I.get(Q), I.i32(1000), I.mul, I.get(V), I.f64(2), I.fmul, I.truncS, I.add, I.i32(17), I.add)),
    eachSeat(code(
      at4(OWNER, I.get(S)), I.load(0), I.get(Q), I.eq, I.if,
      at8(GOAL, I.get(S)), I.get(V), I.f64store(0),
      I.end,
    )),
  );
  const stayRow = code(
    rowAt(STAY_AT), I.load(8), I.set(Q),
    fold1(code(I.get(Q), I.i32(10_000), I.mul, I.i32(7), I.add)),
    qIndex, I.i32(SEATS), I.ltU, I.if,
    at4(OWNER, qIndex), I.load(0), I.get(Q), I.eq, I.if,
    I.i32(HELD), I.i32(1), I.store(0),
    I.end,
    I.end,
  );
  const bots = eachSeat(code(
    at4(OWNER, I.get(S)), I.load(0), I.eqz, I.if,
    at8(GOAL, I.get(S)),
    I.i32(POS), I.get(S), I.i32(4), I.add, I.i32(7), I.and, I.i32(3), I.shl, I.add, I.f64load(0), I.f64(-0.75), I.fmul,
    I.get(S), I.convertS, I.f64(0.5), I.fmul, I.f64(-1.75), I.fadd, I.fadd,
    I.f64(-8), I.fmax, I.f64(8), I.fmin,
    I.f64store(0),
    I.end,
  ));
  const move = eachSeat(code(
    at8(GOAL, I.get(S)), I.f64load(0), at8(POS, I.get(S)), I.f64load(0), I.fsub,
    I.f64(-0.25), I.fmax, I.f64(0.25), I.fmin, I.set(X),
    at8(POS, I.get(S)), at8(POS, I.get(S)), I.f64load(0), I.get(X), I.fadd, I.f64store(0),
    at8(EMA, I.get(S)), at8(EMA, I.get(S)), I.f64load(0), I.f64(0.999), I.fmul, at8(POS, I.get(S)), I.f64load(0), I.f64(0.001), I.fmul, I.fadd, I.f64store(0),
  ));
  const lobby = code(I.i32(LOBBY), r.openUntil === null ? I.i32(1) : code(I.get(0), I.wrap, I.i32(r.openUntil), I.ltU), I.store(0));
  const finish = r.finishAt === null ? [] : code(
    I.get(0), I.wrap, I.i32(r.finishAt), I.eq, I.i32(HELD), I.load(0), I.eqz, I.and, I.if,
    I.i32(DONE), I.i32(1), I.store(0),
    I.end,
  );
  const step = code(eachRow(SEATS_AT, seatRow), eachRow(AIM_AT, aimRow), eachRow(STAY_AT, stayRow), bots, move, lobby, finish);
  // init: owner[s] = s + 1 for s < people, else 0; goal, pos and ema of seat s at 2s − 7; the lobby as at step 0.
  const init = code(
    eachSeat(code(
      at4(OWNER, I.get(S)), I.get(S), I.i32(1), I.add, I.i32(0), I.get(S), I.i32(r.people), I.ltU, I.select, I.store(0),
      at8(GOAL, I.get(S)), home, I.f64store(0),
      at8(POS, I.get(S)), home, I.f64store(0),
      at8(EMA, I.get(S)), home, I.f64store(0),
    )),
    I.i32(LOBBY), I.i32(r.openUntil === null || r.openUntil > 0 ? 1 : 0), I.store(0),
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
  return { name: `rules_${r.people}p_${r.openUntil ?? 'open'}_${r.finishAt ?? 'on'}`, bytes, sha: sha256(bytes) };
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
 * drawn from `seed` + the player. `stay`: that player also makes a `stay` entry at that step.
 */
export function roomPlays(people: number, steps: number, o: { seed?: number; stay?: { player: number; step: number } } = {}): Plays {
  const out: Plays = {};
  for (let p = 1; p <= people; p++) {
    const draw = rng((o.seed ?? 278) + p);
    const list: Play[] = [];
    for (let g = 0; g + DELAY < steps; g++) {
      if (g % 10 === 0) list.push({ step: g, control: 'aim', value: AIMS[Math.floor(draw() * AIMS.length)]! });
      if (o.stay?.player === p && o.stay.step === g) list.push({ step: g, control: 'stay', value: 1 });
    }
    out[String(p)] = list;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The planted names (README: Planted twins). Each is one criterion's wrong program, reachable only through the
// scenario's `planted`, and changes nothing else.

export type Planted =
  | 'net_starts_on_third_join'
  | 'relay_sends_joiner_state'
  | 'relay_sends_old_seat_state'
  | 'net_finishes_on_predicted_step';

// ---------------------------------------------------------------------------------------------------
// Documents (#391's envelope as you send it, as #549's to #277's suites write them). IDs are 26 Crockford characters.

const ulid = (k: number): string => `01JB278D${String(k).padStart(18, '0')}`;
export const DOC = { room: ulid(1), closed: ulid(2), finish: ulid(3), live: ulid(4), liveFinish: ulid(5), base: ulid(6), decoy: ulid(7) } as const;
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #278 acceptance tests.' };
const order = (k: number): string => `a${String(k).padStart(4, '0')}`;
export const SIZE: [number, number] = [640, 360];
/** The keys a person presses on the web player for `aim` (Control: `keys`). */
export const AIM_KEYS: Record<string, number> = { 1: -6, 2: -4, 3: -2, 4: 0, 5: 2, 6: 4, 7: 6 };

export interface NetFields { relay?: JsonValue; players?: JsonValue; step_rate?: number; delay?: number; window?: number; hash_every?: number; timeout?: number }
const slider = (label: string, range: [number, number], increment: number, dflt: number, keys?: Record<string, number>): JsonObject => ({
  kind: 'slider', class: 'document', label, role: 'slider', range, default: dflt, increment, ...(keys ? { keys } : {}),
});
export interface Piece { doc: JsonObject; program: Program }

export interface RoomAsk {
  id?: string;
  /** The lobby: open at every step (the default), closed from a step, or no `open` field at all (false). */
  open?: true | false | { until: number };
  /** The finish: the step the rules write 1 to `done` at, with the logic item's `finish` field; none by default. */
  finishAt?: number;
  /** One player count, today's meaning (criterion 5's piece): the net item declares it, and the rules give seats 1 to
   * that many to their players. Without it the net item declares `{min: 2, max: 8}`. */
  count?: number;
  net?: NetFields;
  /** Criterion 1's piece that tries to start by itself: a press control `start` labelled Start, and a tour that
   * presses it at 2 s and 3 s. */
  decoy?: boolean;
}

/**
 * The eight-seat test piece (README: The eight-seat piece): eight seats; its net item declares `players: {min: 2, max:
 * 8}` (or one count), at net@1's defaults (60 Hz, delay 2, window 8, a hash every 60 steps, timeout 5 s) and what
 * `net` sets; its logic item `rules` reads `net.seats`, `aim` and `stay`, and names `lobby` as `open` and `done` as
 * `finish` (each left out when asked).
 */
export function roomPiece(o: RoomAsk = {}): Piece {
  const open = o.open ?? true;
  const program = rulesProgram({ people: o.count ?? 0, openUntil: typeof open === 'object' ? open.until : null, finishAt: o.finishAt ?? null });
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 30, 26], target: [0, 0, 0], fov: 50 } },
    table: { kind: 'mark.box@1', params: { size: [40, 0.2, 22] }, at: { pos: [0, -0.1, 0] } },
    [LOGIC]: {
      kind: 'logic@1',
      params: {
        program: program.sha, step_rate: RATE, reads: ['net.seats', 'aim', 'stay'], writes: RULES_WRITES, checkpoint: { every: 60 },
        ...(open === false ? {} : { open: OPEN_ARRAY }), ...(o.finishAt === undefined ? {} : { finish: FINISH_ARRAY }),
      },
    },
    [NET]: {
      kind: 'net@1',
      params: { relay: RELAY, players: o.count ?? { min: MIN, max: MAX }, step_rate: RATE, delay: DELAY, window: WINDOW, hash_every: HASH_EVERY, timeout: TIMEOUT_S, ...o.net } as JsonObject,
    },
  };
  const withIds: JsonObject = {};
  let k = 0;
  for (const [itemId, item] of Object.entries(items)) withIds[itemId] = { id: itemId, name: itemId, order: order(k++), ...item };
  const controls: JsonObject = {
    aim: slider('Aim', [-8, 8], 0.5, 0, AIM_KEYS), stay: slider('Stay', [0, 1], 1, 0),
    ...(o.decoy ? { start: { kind: 'press', class: 'document', label: 'Start', role: 'button' } } : {}),
  };
  return {
    program,
    doc: {
      format: 1, id: o.id ?? DOC.room, profile: 'scene', title: 'An eight-seat room', description: 'A piece the #278 acceptance tests play.', size: SIZE, camera: 'cam', seed: 278,
      transport: { span: '600s', frame_rate: [60, 1] },
      requires: { modules: { scene3d: '^1', input: '^1', logic: '^1', net: '^1' } },
      budget: { class: 'showpiece' },
      controls,
      ...(o.decoy ? { tour: { keys: { start: [[2, 1], [3, 1]] }, idle_after: 1.4, resume_after: 3.6, loop: true } } : {}),
      assets: { rules_program: { sha256: program.sha, license: LICENSE } },
      items: withIds,
    },
  };
}
/** A tour's entry on the piece's own `start` control, as the input track holds one (#504's form, as #549's suite
 * writes its tour's entry on `join`). */
export const tourEntry = (seconds: number): JsonObject => ({ t: Math.round(seconds * FLICKS), seq: 0, control: 'start', value: 1, writer: 'tour', player: 1 });
