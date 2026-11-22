// The criteria's fixtures (README: Fixtures): the duel (criteria 2 and 3) and the co-op piece (criterion 5), their
// logic programs as WebAssembly bytes written here, the players' scripted entries and the relay's late deliveries; and,
// from the neighbouring suites, the paddle piece (#551's: criteria 1 and 4), the 300-unit lockstep piece (#549's) and
// the dice piece (#552's). Nothing here steps a match, renders a sample or hashes a state; no vitest import, so a
// scratch script can run the programs in Node's own WebAssembly (README: Fixtures, the scratch run).

import { createHash } from 'node:crypto';
import { DELAY, FLICKS, WINDOW, type JsonObject, type Plays, type Program } from '../551/fixtures.ts';

export { DELAY, FLICKS, WINDOW };
export type { JsonObject, JsonValue, Play, Plays, Program } from '../551/fixtures.ts';
export { PADDLE2_KEYS, paddleDoc, rally, rulesProgram } from '../551/fixtures.ts';
export { armyProgram, lockstepDoc, scripts as armyScripts } from '../549/fixtures.ts';
export { MATCH_STEPS as DICE_STEPS, SAMPLE_RATE, attacks, diceDoc, diceProgram, toneWav } from '../552/fixtures.ts';

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------------------------------------------
// The matches here: 60 Hz, delay 2, window 8 (#551's numbers), a full-state hash at every match step.

export const RATE = 60;
/** One match step: 1/60 s, 11,760,000 flicks. */
export const STEP = FLICKS / RATE;
export const EVERY_STEP = 1;
/** The relay every piece declares; `match` plays its copies in one process, so nothing reaches it. */
export const RELAY = 'https://relay.test/553';
export const NET = 'match';
/** The output's sample rate (the pieces' transport) and a voice's fade-out after a rollback drops its occurrence. */
export const OUT_RATE = 48_000;
export const FADE_MS = 5;
/** Output samples a match step spans: 800. */
export const SAMPLES_PER_STEP = OUT_RATE / RATE;

// ---------------------------------------------------------------------------------------------------
// WebAssembly written as bytes (Logic `logic@1`: one memory whose maximum is its minimum, the immutable i32 globals
// `reads_at`, `writes_at` and, with emits, `emits_at`; `init(seed: i64)` and `step(k: i64)`; no imports; MVP only).

const uleb = (n: number): number[] => { const o: number[] = []; let v = n >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const sleb = (n: number): number[] => {
  const o: number[] = [];
  let v = BigInt(n);
  for (;;) { const b = Number(v & 0x7fn); v >>= 7n; if ((v === 0n && !(b & 0x40)) || (v === -1n && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); }
};
const f64bytes = (x: number): number[] => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return [...b]; };
const name = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'latin1')];
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
/** Instructions, each a list of bytes; `local 1` is the step number as an i32 in every step function here. */
const I = {
  k: [0x20, 0x00, 0xa7, 0x21, 0x01], // local.get 0; i32.wrap_i64; local.set 1
  kk: [0x20, 0x01],
  i32: (n: number): number[] => [0x41, ...sleb(n)],
  f64: (x: number): number[] => [0x44, ...f64bytes(x)],
  load: [0x28, 0x02, 0x00], store: [0x36, 0x02, 0x00], f64load: [0x2b, 0x03, 0x00], f64store: [0x39, 0x03, 0x00],
  if: [0x04, 0x40], end: [0x0b], unreachable: [0x00],
  eq: [0x46], gtS: [0x4a], geS: [0x4e], add: [0x6a], f64gt: [0x64],
} as const;
const code = (...parts: (readonly number[])[]): number[] => parts.flatMap((p) => [...p]);
/** `memory[at]` as an i32. */
const at = (addr: number): number[] => code(I.i32(addr), I.load);
/** `memory[addr] = <value>`. */
const put = (addr: number, ...value: (readonly number[])[]): number[] => code(I.i32(addr), ...value, I.store);

interface Fn { locals: [number, number][]; body: number[] }
const I32 = 0x7f;
/** A logic program: one memory of one page, `reads_at` 0, `writes_at` 4096, `emits_at` when given. */
function logicModule(label: string, emitsAt: number | null, init: Fn, step: Fn): Program {
  const fn = (f: Fn): number[] => { const b = [...vec(f.locals.map(([n, t]) => [...uleb(n), t])), ...f.body, 0x0b]; return [...uleb(b.length), ...b]; };
  const globals = [[I32, 0x00, ...I.i32(0), 0x0b], [I32, 0x00, ...I.i32(WRITES_AT), 0x0b], ...(emitsAt === null ? [] : [[I32, 0x00, ...I.i32(emitsAt), 0x0b]])];
  const exports = [
    [...name('memory'), 0x02, 0x00], [...name('reads_at'), 0x03, 0x00], [...name('writes_at'), 0x03, 0x01],
    ...(emitsAt === null ? [] : [[...name('emits_at'), 0x03, 0x02]]), [...name('init'), 0x00, 0x00], [...name('step'), 0x00, 0x01],
  ];
  const bytes = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, 0x01, 0x01]])),
    ...section(6, vec(globals)),
    ...section(7, vec(exports)),
    ...section(10, vec([fn(init), fn(step)])),
  ]);
  return { name: label, bytes, sha: sha256(bytes) };
}
const NONE: Fn = { locals: [], body: [] };

/** The read region (Logic `logic@1`): each read slider's slot in declaration order, a u32 count and 4 zero bytes, then
 * up to 16 entries of a u32 player, 4 zero bytes and the f64 value (264 B); so the first entry's value is at the
 * slot's offset + 16. Every piece here reads two sliders, named in alphabetical order. */
export const SLOT = 264;
const firstValue = (slot: number): number => slot + 16;
/** The write region; each array an i32 on an 8-byte boundary, in declaration order (alphabetical here too). */
export const WRITES_AT = 4096;
/** Memory no region holds: a program's own words. */
const OWN = 8192;

// ---------------------------------------------------------------------------------------------------
// The duel (criteria 2 and 3; README: The duel). Player 1 is the shooter: each `fire` entry it makes is a shot unless
// its turn is over. Player 2's `turn` entry at or above 0.5 ends the shooter's turn for 10 steps; one below it changes
// nothing. A shot emits one `shot` row {a: the step, b: 1, power: the entry's value} and counts into `shots`.

export const DUEL = 'duel';
export const SHOT = 'shot';
export const FIRE = 'fire';
export const TURN = 'turn';
export const DUEL_WRITES: JsonObject = { blocked: { type: 'i32' }, shots: { type: 'i32' } };
/** The emit region follows the program's own words: one kind, `shot {power: f64}`, at most 16 rows of a u32 a, a u32
 * b and the f64 power (16 B a row) after a u32 count. */
export const EMITS_AT = 12_288;
export function duelProgram(): Program {
  const [fire, turn] = [0, SLOT];
  const blocked = WRITES_AT;
  const shots = WRITES_AT + 8;
  const step = code(
    I.k,
    // A turn entry at or above 0.5 ends the shooter's turn: blocked = k + 10.
    at(turn), I.if,
    I.i32(firstValue(turn)), I.f64load, I.f64(0.5), I.f64gt, I.if,
    put(blocked, I.kk, I.i32(10), I.add),
    I.end, I.end,
    // A fire entry at or after `blocked` is a shot.
    at(fire), I.if,
    I.kk, at(blocked), I.geS, I.if,
    put(EMITS_AT, I.i32(1)),
    put(EMITS_AT + 4, I.kk),
    put(EMITS_AT + 8, I.i32(1)),
    I.i32(EMITS_AT + 12), I.i32(firstValue(fire)), I.f64load, I.f64store,
    put(shots, at(shots), I.i32(1), I.add),
    I.end, I.end,
  );
  return logicModule(DUEL, EMITS_AT, NONE, { locals: [[1, I32]], body: step });
}

/** Cycle n's shot: player 1's fire lands at step 60 + 30n; player 2's turn entry lands 5 steps before it, ending the
 * turn in every fourth cycle (n ≡ 0 mod 4), so that cycle's shot isn't made. Shots are 0.5 s apart and each voice is a
 * 0.25 s tone, so no two voices overlap. */
export const shotStep = (n: number): number => 60 + 30 * n;
export const turnStep = (n: number): number => shotStep(n) - 5;
export const endsTurn = (n: number): boolean => n % 4 === 0;
/** Criterion 2's cycle: player 2's entry at step 295 ends the turn, and player 1's shot at step 300 isn't made. */
export const CYCLE_300 = 8;
export const SHOT_300 = shotStep(CYCLE_300);
export const TURN_295 = turnStep(CYCLE_300);
/** Each player's entries for cycles 0 … `cycles` − 1, made `delay` steps before they land. */
export function duelPlays(cycles: number): Plays {
  const out: Plays = { '1': [], '2': [] };
  for (let n = 0; n < cycles; n++) {
    out['1']!.push({ step: shotStep(n) - DELAY, control: FIRE, value: n % 2 === 0 ? 1 : 0.5 });
    out['2']!.push({ step: turnStep(n) - DELAY, control: TURN, value: endsTurn(n) ? 1 : n % 2 === 0 ? 0 : 0.25 });
  }
  return out;
}
/** The relay's late deliveries: player 2's message for cycle n's turn step reaches copy 1 only once copy 1 has run that
 * cycle's shot step (551's `relay.deliver`), so copy 1 runs the shot step on a prediction first. */
export const lateTurns = (cycles: readonly number[]): { player: number; step: number; to: number; at: number }[] =>
  cycles.map((n) => ({ player: 2, step: turnStep(n), to: 1, at: shotStep(n) }));
/** Criterion 3's 50 cycles, the last shot at step 1,530, in a match of 1,600 steps. */
export const CYCLES = 50;
export const DUEL_STEPS = 1600;
/** Criterion 2's match: cycles 0 … 10, the last shot at step 360. */
export const CYCLES_SHORT = 11;
export const SHORT_STEPS = 400;

// ---------------------------------------------------------------------------------------------------
// The co-op piece (criterion 5; README: The co-op piece). One hero both players keep alive, 100 hp. Player 2's `shield`
// entry shields the hero for 10 steps. At step 300 an unshielded hero dies: hp 0, and slot 1 written into `ends`. At
// step 700 an unshielded hero meets the trap: the program traps (`unreachable`). Step 119 writes slot 1 into `request`
// (the save at step 120, #534's numbering). Player 1's `go` entries count into a word of its own.

export const COOP = 'coop';
export const SAVE_SLOT = 1;
export const SAVE_STEP = 120;
export const DEATH_STEP = 300;
export const TRAP_STEP = 700;
export const SHIELDS = [DEATH_STEP - 5, TRAP_STEP - 5] as const;
export const COOP_STEPS = 900;
export const COOP_WRITES: JsonObject = { ends: { type: 'i32' }, hp: { type: 'i32' }, request: { type: 'i32' } };
export function coopProgram(): Program {
  const [go, shield] = [0, SLOT];
  const [ends, hp, request] = [WRITES_AT, WRITES_AT + 8, WRITES_AT + 16];
  const [shieldUntil, moves] = [OWN, OWN + 4];
  const unshielded = code(I.kk, at(shieldUntil), I.gtS);
  const step = code(
    I.k,
    put(ends, I.i32(0)),
    put(request, I.i32(0)),
    put(moves, at(moves), at(go), I.add),
    at(shield), I.if,
    I.i32(firstValue(shield)), I.f64load, I.f64(0.5), I.f64gt, I.if,
    put(shieldUntil, I.kk, I.i32(10), I.add),
    I.end, I.end,
    I.kk, I.i32(SAVE_STEP - 1), I.eq, I.if, put(request, I.i32(SAVE_SLOT)), I.end,
    I.kk, I.i32(DEATH_STEP), I.eq, I.if, unshielded, I.if, at(hp), I.i32(0), I.gtS, I.if,
    put(hp, I.i32(0)), put(ends, I.i32(SAVE_SLOT)),
    I.end, I.end, I.end,
    I.kk, I.i32(TRAP_STEP), I.eq, I.if, unshielded, I.if, I.unreachable, I.end, I.end,
  );
  return logicModule(COOP, null, { locals: [], body: put(hp, I.i32(100)) }, { locals: [[1, I32]], body: step });
}
/** Player 1 moves every 50 steps from step 10; player 2 shields at steps 295 and 695. */
export function coopPlays(): Plays {
  const one = Array.from({ length: 17 }, (_, i) => ({ step: 10 + 50 * i - DELAY, control: 'go', value: i % 2 }));
  return { '1': one.filter((e) => e.step >= 0), '2': SHIELDS.map((s) => ({ step: s - DELAY, control: 'shield', value: 1 })) };
}
/** Player 2's shields reach copy 1 only once it has run the step they guard: the death's and the trap's. */
export const lateShields = (): { player: number; step: number; to: number; at: number }[] =>
  [{ player: 2, step: SHIELDS[0], to: 1, at: DEATH_STEP }, { player: 2, step: SHIELDS[1], to: 1, at: TRAP_STEP }];

// ---------------------------------------------------------------------------------------------------
// Documents (#391's envelope as you send it, as the neighbouring suites write them). IDs are 26 Crockford characters.

const ulid = (k: number): string => `01JB553D${String(k).padStart(18, '0')}`;
export const DOC = { duel: ulid(1), coop: ulid(2), plain: ulid(3) } as const;
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #553 acceptance tests.' };
const slider = (label: string, range: [number, number], increment: number): JsonObject =>
  ({ kind: 'slider', class: 'document', label, role: 'slider', range, default: 0, increment });
const netItem = (): JsonObject =>
  ({ kind: 'net@1', params: { relay: RELAY, players: 2, step_rate: RATE, delay: DELAY, window: WINDOW, hash_every: EVERY_STEP } });
function scene(id: string, title: string, items: Record<string, JsonObject>, extra: JsonObject): JsonObject {
  const all: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 3, 12], target: [0, 0.5, 0], fov: 40 } },
    table: { kind: 'mark.box@1', params: { size: [8, 0.2, 4] }, at: { pos: [0, -0.1, 0] } },
    ...items,
    [NET]: netItem(),
  };
  const withIds: JsonObject = {};
  Object.entries(all).forEach(([itemId, item], k) => { withIds[itemId] = { id: itemId, name: itemId, order: `a${String(k).padStart(4, '0')}`, ...item }; });
  return {
    format: 1, id, profile: 'scene', title, description: `${title}: a piece the #553 acceptance tests play.`, size: [640, 360], camera: 'cam', seed: 553,
    transport: { span: '40s', frame_rate: [60, 1], sample_rate: OUT_RATE }, ...extra, items: withIds,
  };
}
/** The duel (README: The duel): the logic item `duel` (60 Hz, reading `fire` and `turn`, emitting `shot`), the spawn
 * `bang` on its shots playing the 0.25 s tone, and the net item `match`. */
export const SPAWN = 'bang';
export function duelDoc(program: Program, toneSha: string): JsonObject {
  return scene(DOC.duel, 'A duel', {
    [DUEL]: { kind: 'logic@1', params: { program: program.sha, step_rate: RATE, reads: [FIRE, TURN], writes: DUEL_WRITES, emits: { [SHOT]: { fields: { power: 'f64' } } } } },
  }, {
    requires: { modules: { scene3d: '^1', input: '^1', logic: '^1', net: '^1', media: '^1' } },
    controls: { [FIRE]: slider('Fire', [0, 1], 0.5), [TURN]: slider('Turn', [0, 1], 0.25) },
    assets: { duel_program: { sha256: program.sha, license: LICENSE }, bang_tone: { sha256: toneSha, license: LICENSE } },
    spawns: { [SPAWN]: { on: { list: `${DUEL}.occurrences`, kinds: [SHOT] }, play: { src: { asset: toneSha }, in: 0, out: FLICKS / 4 } } },
  });
}
/** The co-op piece (README: The co-op piece): the logic item `coop` (60 Hz, reading `go` and `shield`) with one save
 * slot, its `request` and its `ends`, and the net item `match`. */
export function coopDoc(program: Program): JsonObject {
  return scene(DOC.coop, 'A co-op piece', {
    [COOP]: { kind: 'logic@1', params: { program: program.sha, step_rate: RATE, reads: ['go', 'shield'], writes: COOP_WRITES, saves: { slots: SAVE_SLOT, request: 'request', ends: 'ends' } } },
  }, {
    requires: { modules: { scene3d: '^1', input: '^1', logic: '^1', net: '^1' } },
    controls: { go: slider('Go', [0, 1], 1), shield: slider('Shield', [0, 1], 1) },
    assets: { coop_program: { sha256: program.sha, license: LICENSE } },
  });
}
/** A piece without the net module (criterion 4): `document` with its net item and the module taken out. */
export function withoutNet(document: JsonObject, id: string = DOC.plain): JsonObject {
  const copy = JSON.parse(JSON.stringify(document)) as JsonObject;
  delete (copy['items'] as JsonObject)[NET];
  delete ((copy['requires'] as JsonObject)['modules'] as JsonObject)['net'];
  return { ...copy, id, title: 'A piece without the net module' };
}

// ---------------------------------------------------------------------------------------------------
// The planted names (README: Planted twins): the scenario's `planted`, and the interop part's `--planted`.

export type Planted = 'net_keeps_replaced_rows' | 'media_restores_checkpoint' | 'net_hash_covers_media' | 'net_saves_predicted';
export const WEB_BIG_ENDIAN = 'web_writes_step_big_endian';
