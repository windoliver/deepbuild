// The criteria's fixtures (README: Fixtures): the paddle piece and its logic program as WebAssembly bytes written here,
// the planted piece that traps at match step 400, each player's scripted entries, the plants the criteria name and the
// planted names. Nothing here steps a match, hashes a state or draws anything; no vitest import, so a scratch script
// can run the programs in Node's own WebAssembly.

import { createHash } from 'node:crypto';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------------------------------------------
// The match the criteria play: 20 Hz, window 0 (lockstep, #549's), delay 4, a full-state hash every 60 match steps.

export const FLICKS = 705_600_000;
export const RATE = 20;
/** One match step: 1/20 s, 35,280,000 flicks. */
export const STEP = FLICKS / RATE;
export const DELAY = 4;
/** "With hashes every 60 match steps" (criteria 1, 5, 7, 8). */
export const HASH_EVERY = 60;
/** "At match step 310", "caught at the hash for step 360" (criteria 1, 5, 7, 8, 9). */
export const PLANT_STEP = 310;
export const CAUGHT_AT = 360;
/** The last hash both copies still share before the plant. */
export const LAST_MATCH = 300;
/** "Over 3,600 match steps" (criterion 10). */
export const STEPS_LONG = 3600;
/** The logic item, the net item, and the relay every in-process piece declares (it never joins one). */
export const LOGIC = 'court';
export const NET = 'match';
export const RELAY = 'https://relay.test/550';

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
/** Instructions, each a list of bytes. */
const I = {
  get: (l: number): number[] => [0x20, ...uleb(l)],
  set: (l: number): number[] => [0x21, ...uleb(l)],
  i32: (n: number): number[] => [0x41, ...sleb(n)],
  i64: (n: number): number[] => [0x42, ...sleb(n)],
  f64: (x: number): number[] => [0x44, ...f64bytes(x)],
  load: (offset = 0): number[] => [0x28, 0x02, ...uleb(offset)],
  store: (offset = 0): number[] => [0x36, 0x02, ...uleb(offset)],
  f64load: (offset = 0): number[] => [0x2b, 0x03, ...uleb(offset)],
  f64store: (offset = 0): number[] => [0x39, 0x03, ...uleb(offset)],
  block: [0x02, 0x40], loop: [0x03, 0x40], if: [0x04, 0x40], else: [0x05], end: [0x0b],
  br: (d: number): number[] => [0x0c, ...uleb(d)],
  brIf: (d: number): number[] => [0x0d, ...uleb(d)],
  add: [0x6a], shl: [0x74], eq: [0x46], ne: [0x47], ltU: [0x49], geU: [0x4f],
  i64eq: [0x51],
  fabs: [0x99], fneg: [0x9a], fadd: [0xa0], fsub: [0xa1], fmul: [0xa2], flt: [0x63], fgt: [0x64], fle: [0x65], fge: [0x66],
  select: [0x1b], unreachable: [0x00],
} as const;
const code = (...parts: (readonly number[])[]): number[] => parts.flatMap((p) => [...p]);

export interface Program { name: string; bytes: Buffer; sha: string }

// The read region (Logic `logic@1`): the controls the item reads, in declaration order, each a slider's slot of a u32
// count and 4 zero bytes, then at most 16 entries of a u32 player, 4 zero bytes and the f64 value: 8 + 16 × 16 = 264 B.
export const READS = ['paddle1', 'paddle2', 'serve', 'spin'] as const;
const SLOT = 264;
const slotOf = (control: (typeof READS)[number]): number => READS.indexOf(control) * SLOT;
/** The write region: each array in declaration order on an 8-byte boundary (alphabetical too, so either order lays
 * them out alike). */
export const WRITES_AT = 4096;
export const COURT_WRITES: JsonObject = {
  ball_vx: { type: 'f64' }, ball_vy: { type: 'f64' }, ball_x: { type: 'f64' }, ball_y: { type: 'f64' },
  in_play: { type: 'i32' }, paddle: { type: 'f64', count: 2 }, refused: { type: 'i32', count: 16 }, serving: { type: 'i32' },
};
const BALL_VX = WRITES_AT;
const BALL_VY = WRITES_AT + 8;
const BALL_X = WRITES_AT + 16;
const BALL_Y = WRITES_AT + 24;
const IN_PLAY = WRITES_AT + 32;
const PADDLE = WRITES_AT + 40;
const REFUSED = WRITES_AT + 56;
const SERVING = WRITES_AT + 120;
/** A byte of logic memory outside every region, which no step reads or writes (criterion 5). */
export const UNREAD_BYTE = 0xf000;

/** The piece's rules, as its program numbers them in `refused` (README: The paddle piece). */
export const RULE = { own_paddle: 1, not_serving: 2, wall: 3, in_play: 4 } as const;
export type Rule = keyof typeof RULE;
/** The court: the ball bounces at y = ±10 and at the ends x = ±19; a paddle's centre stays within ±8 of the middle. */
export const WALL = 8;
/** The sliders' declared ranges: the module refuses a value outside these (criterion 2); the rules refuse a paddle past
 * the wall inside them (criterion 3). */
export const PADDLE_RANGE: [number, number] = [-10, 10];
export const SPIN_RANGE: [number, number] = [-1, 1];
/** The serve's velocity, toward the other player, and its rise. */
export const SERVE_VX = 0.3;
export const SERVE_VY = 0.17;

// Locals of `step`: 0 the step (i64); i32 1 n, 2 e, 3 p, 4 r; f64 5 v, 6 x, 7 y, 8 vx, 9 vy.
const [N, E, P, R, V, X, Y, VX, VY] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Records a refusal: `refused` holds up to 8 (player, rule) pairs a step, cleared at the step's start. */
const refuse = (rule: number): number[] => code(
  I.get(R), I.i32(8), I.ltU, I.if,
  I.i32(REFUSED), I.get(R), I.i32(3), I.shl, I.add, I.get(P), I.store(0),
  I.i32(REFUSED), I.get(R), I.i32(3), I.shl, I.add, I.i32(rule), I.store(4),
  I.get(R), I.i32(1), I.add, I.set(R),
  I.end,
);
/** Each entry of `control` this step, in the read region's order: its player in `p`, its value in `v`, then `body`. */
const eachEntry = (control: (typeof READS)[number], body: number[]): number[] => {
  const s = slotOf(control);
  return code(
    I.i32(s), I.load(0), I.set(N), I.i32(0), I.set(E),
    I.block, I.loop,
    I.get(E), I.get(N), I.geU, I.brIf(1),
    I.i32(s), I.get(E), I.i32(4), I.shl, I.add, I.load(8), I.set(P),
    I.i32(s), I.get(E), I.i32(4), I.shl, I.add, I.f64load(16), I.set(V),
    body,
    I.get(E), I.i32(1), I.add, I.set(E),
    I.br(0),
    I.end, I.end,
  );
};
/** A paddle entry: only its owner moves it (own_paddle), and never past the wall (wall). */
const paddleEntry = (owner: 1 | 2): number[] => code(
  I.get(P), I.i32(owner), I.ne, I.if,
  refuse(RULE.own_paddle),
  I.else,
  I.get(V), I.fabs, I.f64(WALL), I.fgt, I.if,
  refuse(RULE.wall),
  I.else,
  I.i32(PADDLE + 8 * (owner - 1)), I.get(V), I.f64store(0),
  I.end,
  I.end,
);
/** A serve: only from the serving player (not_serving), and only while the ball waits (in_play). */
const serveEntry = code(
  I.get(P), I.i32(SERVING), I.load(0), I.ne, I.if,
  refuse(RULE.not_serving),
  I.else,
  I.i32(IN_PLAY), I.load(0), I.if,
  refuse(RULE.in_play),
  I.else,
  I.i32(IN_PLAY), I.i32(1), I.store(0),
  I.i32(BALL_X), I.f64(0), I.f64store(0), I.i32(BALL_Y), I.f64(0), I.f64store(0),
  I.i32(BALL_VX), I.f64(SERVE_VX), I.f64(-SERVE_VX), I.i32(SERVING), I.load(0), I.i32(1), I.eq, I.select, I.f64store(0),
  I.i32(BALL_VY), I.f64(SERVE_VY), I.f64store(0),
  I.end,
  I.end,
);
/** Spin, from any player while the ball is in play: it bends the ball's rise. */
const spinEntry = code(
  I.i32(IN_PLAY), I.load(0), I.if,
  I.i32(BALL_VY), I.i32(BALL_VY), I.f64load(0), I.get(V), I.f64(0.05), I.fmul, I.fadd, I.f64store(0),
  I.end,
);
/** At an end, a paddle within 2 of the ball adds english: the rise gains a twentieth of the ball's offset from it. */
const english = (paddle: number): number[] => code(
  I.get(Y), I.i32(paddle), I.f64load(0), I.fsub, I.fabs, I.f64(2), I.fle, I.if,
  I.get(VY), I.get(Y), I.i32(paddle), I.f64load(0), I.fsub, I.f64(0.05), I.fmul, I.fadd, I.set(VY),
  I.end,
);
const moveBall = code(
  I.i32(IN_PLAY), I.load(0), I.if,
  I.i32(BALL_VX), I.f64load(0), I.set(VX), I.i32(BALL_VY), I.f64load(0), I.set(VY),
  I.i32(BALL_X), I.f64load(0), I.get(VX), I.fadd, I.set(X),
  I.i32(BALL_Y), I.f64load(0), I.get(VY), I.fadd, I.set(Y),
  I.get(Y), I.f64(10), I.fgt, I.if, I.f64(20), I.get(Y), I.fsub, I.set(Y), I.get(VY), I.fneg, I.set(VY), I.end,
  I.get(Y), I.f64(-10), I.flt, I.if, I.f64(-20), I.get(Y), I.fsub, I.set(Y), I.get(VY), I.fneg, I.set(VY), I.end,
  I.get(X), I.f64(19), I.fge, I.if, I.f64(38), I.get(X), I.fsub, I.set(X), I.get(VX), I.fneg, I.set(VX), english(PADDLE + 8), I.end,
  I.get(X), I.f64(-19), I.fle, I.if, I.f64(-38), I.get(X), I.fsub, I.set(X), I.get(VX), I.fneg, I.set(VX), english(PADDLE), I.end,
  I.i32(BALL_X), I.get(X), I.f64store(0), I.i32(BALL_Y), I.get(Y), I.f64store(0),
  I.i32(BALL_VX), I.get(VX), I.f64store(0), I.i32(BALL_VY), I.get(VY), I.f64store(0),
  I.end,
);

/**
 * `court`, the paddle piece's logic (README: The paddle piece). `init` makes player 1 the server. Each step clears
 * `refused`, then takes the step's entries control by control in the read region's order: a paddle entry moves its
 * owner's paddle to its value, a serve puts the ball in play from the middle toward the other player, and spin bends
 * the ball's rise; the rules refuse an entry on another player's paddle, a paddle past the wall, a serve from a player
 * who isn't serving and a serve while the ball is in play, each as a (player, rule) pair in `refused`. Then the ball
 * moves by its velocity and bounces off the top, the bottom and the ends, where a paddle within reach adds english.
 * Its whole state lives in the write region, read back each step. With `trapAt`, the step traps with `unreachable`
 * when it runs that step (criterion 4's planted piece), on every copy alike.
 */
export function courtProgram(o: { trapAt?: number } = {}): Program {
  const init = code(I.i32(SERVING), I.i32(1), I.store(0));
  const clear = Array.from({ length: 16 }, (_, i) => code(I.i32(REFUSED + 4 * i), I.i32(0), I.store(0))).flat();
  const trap = o.trapAt === undefined ? [] : code(I.get(0), I.i64(o.trapAt), I.i64eq, I.if, I.unreachable, I.end);
  const step = code(
    trap, clear,
    eachEntry('paddle1', paddleEntry(1)),
    eachEntry('paddle2', paddleEntry(2)),
    eachEntry('serve', serveEntry),
    eachEntry('spin', spinEntry),
    moveBall,
  );
  const body = (locals: number[], b: number[]): number[] => { const f = [...locals, ...b, 0x0b]; return [...uleb(f.length), ...f]; };
  const bytes = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, 0x01, 0x01]])),
    ...section(6, vec([[0x7f, 0x00, ...I.i32(0), 0x0b], [0x7f, 0x00, ...I.i32(WRITES_AT), 0x0b]])),
    ...section(7, vec([[...name('memory'), 0x02, 0x00], [...name('reads_at'), 0x03, 0x00], [...name('writes_at'), 0x03, 0x01], [...name('init'), 0x00, 0x00], [...name('step'), 0x00, 0x01]])),
    ...section(10, vec([body([0x00], init), body([0x02, 0x04, 0x7f, 0x05, 0x7c], step)])),
  ]);
  return { name: o.trapAt === undefined ? 'court' : `court-traps-at-${o.trapAt}`, bytes, sha: sha256(bytes) };
}
/** Criterion 4's planted piece: the paddle piece whose logic traps with kind unreachable at match step 400. */
export const TRAP_STEP = 400;

// ---------------------------------------------------------------------------------------------------
// Scripts: what each player does, by match step.

/** One scripted entry: the player sets `control` to `value` when match step `step` is the first its copy hasn't run,
 * so it is stamped `delay` steps later (Net `net@1`, #549's suite). `to`: only copy 3's planted entries carry it
 * (criterion 8; README: `match`). */
export interface Play { step: number; control: string; value: number; to?: number[] }
export type Plays = Record<string, Play[]>;

const PADDLE_AT = [-6, -3.5, -1, 0.5, 2, 4.5, 7, 8, -8, 3, -2.5, 6];
/**
 * An honest rally for `players` copies over `steps` match steps: player 1 serves at `serveAt` (step 10 by default);
 * players 1 and 2 each move their own paddle every 20 steps, inside the wall; player 1 spins every 50 steps, player 2
 * every 70, and player 3, where there is one, every 30. `from`: the first step each player makes an entry at.
 */
export function rally(players: number, steps: number, o: { serveAt?: number; from?: Record<number, number> } = {}): Plays {
  const out: Plays = {};
  const fits = (g: number, p: number): boolean => g + DELAY < steps && g >= (o.from?.[p] ?? 0);
  for (let p = 1; p <= players; p++) {
    const list: Play[] = [];
    for (let g = 0; g + DELAY < steps; g++) {
      if (!fits(g, p)) continue;
      if (p === 1 && g === (o.serveAt ?? 10)) list.push({ step: g, control: 'serve', value: 1 });
      if (p <= 2 && g % 20 === 5 * p) list.push({ step: g, control: `paddle${p}`, value: PADDLE_AT[(Math.floor(g / 20) + p) % PADDLE_AT.length]! });
      if (p === 1 && g % 50 === 25) list.push({ step: g, control: 'spin', value: g % 100 === 25 ? 0.25 : -0.25 });
      if (p === 2 && g % 70 === 35) list.push({ step: g, control: 'spin', value: -0.5 });
      if (p === 3 && g % 30 === 15) list.push({ step: g, control: 'spin', value: g % 60 === 15 ? 0.5 : -0.25 });
    }
    out[String(p)] = list;
  }
  return out;
}
/** `plays` with `extra` entries added to player `player`'s script, in step order. */
export function withEntries(plays: Plays, player: number, extra: Play[]): Plays {
  const list = [...(plays[String(player)] ?? []), ...extra].sort((a, b) => a.step - b.step);
  return { ...plays, [String(player)]: list };
}

// ---------------------------------------------------------------------------------------------------
// The plants and planted names (README: Planted twins and plants).

/** A change to one copy's state, made right after that copy runs match step `step`, each time it runs it (README:
 * `match`'s `plant`). `field`: an array as `<logic>.<array>`, or `<logic>.memory` with `at`, a byte offset. */
export interface Plant { player: number; step: number; field: string; add?: number; flip?: number; at?: number }
/** Criterion 1 (and 9): a one-unit shift in the ball's x velocity in copy 2 at match step 310. */
export const UNIT_SHIFT: Plant = { player: 2, step: PLANT_STEP, field: `${LOGIC}.ball_vx`, add: 1 };
/** Criterion 7: a one-ulp change, the lowest mantissa bit, to the ball's x velocity in copy 2 at match step 310. */
export const ONE_ULP: Plant = { player: 2, step: PLANT_STEP, field: `${LOGIC}.ball_vx`, flip: 0 };
/** Criterion 5: 1 added to a byte of logic memory no step reads, each time copy 2 runs match step 310. */
export const MEMORY_BYTE: Plant = { player: 2, step: PLANT_STEP, field: `${LOGIC}.memory`, at: UNREAD_BYTE, add: 1 };
/** The ball's x velocity, as net.desync names its field. */
export const BALL_VX_FIELD = /^(?:logic[.:/])?court[.:/]ball_vx(?:\[0\])?$/;
/** Logic's memory, as net.desync names its field. */
export const MEMORY_FIELD = /^(?:logic[.:/])?court[.:/]memory(?:\[\d+\])?$/;

/** The scenario's `planted` names this suite adds, each one criterion's wrong program (README: Planted twins). */
export type Planted =
  | 'net_stamps_own_player'
  | 'net_plays_on_past_trap'
  | 'net_locates_by_step_hashes'
  | 'net_hash_rounds_floats'
  | 'net_locates_by_state_alone';

// ---------------------------------------------------------------------------------------------------
// Documents (#391's envelope as you send it, as #549's suite writes them). IDs are 26 Crockford characters.

const ulid = (k: number): string => `01JB550D${String(k).padStart(18, '0')}`;
export const DOC = { court: ulid(1), trio: ulid(2), trap: ulid(3) } as const;
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #550 acceptance tests.' };
const order = (k: number): string => `a${String(k).padStart(4, '0')}`;
export const SIZE: [number, number] = [640, 360];

export interface NetFields { relay?: JsonValue; players?: number; step_rate?: number; delay?: number; window?: number; hash_every?: number; timeout?: number }
const slider = (label: string, range: [number, number], increment: number): JsonObject => ({ kind: 'slider', class: 'document', label, role: 'slider', range, default: 0, increment });

/**
 * The paddle piece (README: The paddle piece): a 3D scene with the logic item `court` (20 Hz) reading the sliders
 * `paddle1`, `paddle2`, `serve` and `spin`, and the net item `match`: 20 Hz, window 0, delay 4, a hash every 60
 * match steps, `players` copies (2, or 3 for criterion 8), and what `net` adds. `span` covers the longest match
 * played (3,600 steps: 180 s).
 */
export function courtDoc(program: Program, net: NetFields = {}, id: string = DOC.court): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 3, 30], target: [0, 0, 0], fov: 50 } },
    table: { kind: 'mark.box@1', params: { size: [40, 0.2, 20] }, at: { pos: [0, -0.1, 0] } },
    [LOGIC]: { kind: 'logic@1', params: { program: program.sha, step_rate: RATE, reads: [...READS], writes: COURT_WRITES } },
    [NET]: { kind: 'net@1', params: { relay: RELAY, players: 2, step_rate: RATE, delay: DELAY, window: 0, hash_every: HASH_EVERY, ...net } as JsonObject },
  };
  const withIds: JsonObject = {};
  let k = 0;
  for (const [itemId, item] of Object.entries(items)) withIds[itemId] = { id: itemId, name: itemId, order: order(k++), ...item };
  return {
    format: 1, id, profile: 'scene', title: 'A paddle match', description: 'A paddle piece the #550 acceptance tests play.', size: SIZE, camera: 'cam', seed: 550,
    transport: { span: '200s', frame_rate: [60, 1] },
    requires: { modules: { scene3d: '^1', input: '^1', logic: '^1', net: '^1' } },
    controls: { paddle1: slider('Paddle 1', PADDLE_RANGE, 0.5), paddle2: slider('Paddle 2', PADDLE_RANGE, 0.5), serve: slider('Serve', [0, 1], 1), spin: slider('Spin', SPIN_RANGE, 0.25) },
    assets: { court_program: { sha256: program.sha, license: LICENSE } },
    items: withIds,
  };
}
