// The criteria's fixtures (README: Fixtures): the pieces, their logic programs as WebAssembly bytes written here, each
// player's scripted entries, and this suite's own mirror of the program, which gives the arrays every copy must hold.
// Nothing here steps a match, joins a relay, hashes a state or draws anything; no vitest import, so a scratch script
// can run the programs in Node's own WebAssembly.

import { createHash } from 'node:crypto';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------------------------------------------
// The match the criteria play: 20 Hz, window 0 (lockstep), delay 4 (criterion 4's numbers).

export const FLICKS = 705_600_000;
export const RATE = 20;
/** One match step: 1/20 s, 35,280,000 flicks. */
export const STEP = FLICKS / RATE;
export const DELAY = 4;
export const UNITS = 300;
/** The slider every player's entries are on, and the logic item that reads it. */
export const CONTROL = 'push';
export const LOGIC = 'army';

// ---------------------------------------------------------------------------------------------------
// WebAssembly, written as bytes (Logic `logic@1`: one memory whose maximum is its minimum, immutable i32 globals
// `reads_at` and `writes_at`, `init(seed: i64)`, `step(k: i64)`, no imports).

const uleb = (n: number): number[] => { const o: number[] = []; let v = n >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const sleb = (n: number): number[] => {
  const o: number[] = [];
  let v = n | 0;
  for (;;) { const b = v & 0x7f; v >>= 7; if ((v === 0 && !(b & 0x40)) || (v === -1 && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); }
};
const name = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'latin1')];
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
/** Instructions, each a list of bytes. */
const I = {
  get: (l: number): number[] => [0x20, ...uleb(l)],
  set: (l: number): number[] => [0x21, ...uleb(l)],
  i32: (n: number): number[] => [0x41, ...sleb(n)],
  load: (offset = 0): number[] => [0x28, 0x02, ...uleb(offset)],
  f64load: (offset = 0): number[] => [0x2b, 0x03, ...uleb(offset)],
  store: (offset = 0): number[] => [0x36, 0x02, ...uleb(offset)],
  block: [0x02, 0x40], loop: [0x03, 0x40], end: [0x0b], if: [0x04, 0x40], else: [0x05],
  br: (d: number): number[] => [0x0c, ...uleb(d)],
  brIf: (d: number): number[] => [0x0d, ...uleb(d)],
  add: [0x6a], sub: [0x6b], mul: [0x6c], remS: [0x6f], remU: [0x70], and: [0x71], shl: [0x74], geU: [0x4f], ltU: [0x49], eqz: [0x45],
  trunc: [0xaa],
} as const;
const code = (...parts: (readonly number[])[]): number[] => parts.flatMap((p) => [...p]);

export interface Program { name: string; bytes: Buffer; sha: string }
/** A logic program: `init` and `step`, each with `locals` i32 locals after its i64 parameter (local 0). */
function logicModule(label: string, writesAt: number, init: { locals: number; body: number[] }, step: { locals: number; body: number[] }): Program {
  const body = (f: { locals: number; body: number[] }): number[] => {
    const b = [...(f.locals ? [0x01, ...uleb(f.locals), 0x7f] : [0x00]), ...f.body, 0x0b];
    return [...uleb(b.length), ...b];
  };
  const bytes = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, 0x01, 0x01]])),
    ...section(6, vec([[0x7f, 0x00, ...I.i32(0), 0x0b], [0x7f, 0x00, ...I.i32(writesAt), 0x0b]])),
    ...section(7, vec([[...name('memory'), 0x02, 0x00], [...name('reads_at'), 0x03, 0x00], [...name('writes_at'), 0x03, 0x01], [...name('init'), 0x00, 0x00], [...name('step'), 0x00, 0x01]])),
    ...section(10, vec([body(init), body(step)])),
  ]);
  return { name: label, bytes, sha: sha256(bytes) };
}

// The read region (Logic `logic@1`): the one control read is a slider, whose slot is a u32 count and 4 zero bytes, then
// each entry as a u32 player, 4 zero bytes and the slider's f64 value: 16 B an entry, at most 16 a step.
const COUNT = 0;
const PLAYER = 8;
const VALUE = 16;
const ENTRY = 16;
/** The write region: each array in declaration order on an 8-byte boundary, an i32 4 bytes. */
export const WRITES_AT = 4096;
const POS = WRITES_AT;
const VEL = WRITES_AT + 4 * UNITS;
/** A cell the program keeps between steps, outside every region: carried state no array shows. */
const ACC = 8192;

/** The arrays `army` writes, in declaration order (alphabetical too, so either order lays them out alike). */
export const ARMY_WRITES: JsonObject = { pos: { type: 'i32', count: UNITS }, vel: { type: 'i32', count: UNITS } };
/** The slider's range: whole numbers −8 to 8. */
export const RANGE: [number, number] = [-8, 8];

/**
 * `army`: 300 units, each a position and a velocity. `init` lines them up 16 apart in rows of 20. Each step folds the
 * step's entries, in the order the read region gives them, into a running word (`acc = acc × 31 + player × 1000 +
 * value + 8`), and each entry changes the velocity of the unit the word names (`vel[acc mod 300] = (vel × 3 + value ×
 * player) rem 17`); then every unit moves by its velocity. So an entry dropped, applied at another step, given another
 * player or read in another order leaves other arrays, and the running word is carried state outside the arrays.
 */
export function armyProgram(): Program {
  const [n, e, p, val, acc, a, i] = [1, 2, 3, 4, 5, 6, 7];
  const init = code(
    I.loop,
    I.i32(POS), I.get(1), I.i32(2), I.shl, I.add, I.get(1), I.i32(20), I.remU, I.i32(16), I.mul, I.store(),
    I.get(1), I.i32(1), I.add, I.set(1),
    I.get(1), I.i32(UNITS), I.ltU, I.brIf(0),
    I.end,
  );
  const step = code(
    I.i32(COUNT), I.load(), I.set(n),
    I.i32(ACC), I.load(), I.set(acc),
    I.block, I.loop,
    I.get(e), I.get(n), I.geU, I.brIf(1),
    I.get(e), I.i32(4), I.shl, I.load(PLAYER), I.set(p),
    I.get(e), I.i32(4), I.shl, I.f64load(VALUE), I.trunc, I.set(val),
    I.get(acc), I.i32(31), I.mul, I.get(p), I.i32(1000), I.mul, I.add, I.get(val), I.add, I.i32(8), I.add, I.set(acc),
    I.i32(VEL), I.get(acc), I.i32(UNITS), I.remU, I.i32(2), I.shl, I.add, I.set(a),
    I.get(a), I.get(a), I.load(), I.i32(3), I.mul, I.get(val), I.get(p), I.mul, I.add, I.i32(17), I.remS, I.store(),
    I.get(e), I.i32(1), I.add, I.set(e),
    I.br(0),
    I.end, I.end,
    I.i32(ACC), I.get(acc), I.store(),
    I.loop,
    I.get(i), I.i32(2), I.shl, I.set(a),
    I.get(a), I.get(a), I.load(POS), I.get(a), I.load(VEL), I.add, I.store(POS),
    I.get(i), I.i32(1), I.add, I.set(i),
    I.get(i), I.i32(UNITS), I.ltU, I.brIf(0),
    I.end,
  );
  return logicModule('army', WRITES_AT, { locals: 1, body: init }, { locals: 7, body: step });
}
/** How many bytes one read-region entry takes, for a scratch check of the program. */
export const ENTRY_BYTES = ENTRY;

/** The Oracle lane's stub game (its README): `frame` counts steps; `state` gains 2 on a step whose entries' values sum
 * to an even number and loses 1 otherwise. Writes `frame` then `state`, an i32 each on its own 8-byte boundary. */
export const STUB_WRITES: JsonObject = { frame: { type: 'i32', count: 1 }, state: { type: 'i32', count: 1 } };
export function stubProgram(): Program {
  const [n, e, sum] = [1, 2, 3];
  const FRAME = WRITES_AT;
  const STATE = WRITES_AT + 8;
  const step = code(
    I.i32(COUNT), I.load(), I.set(n),
    I.block, I.loop,
    I.get(e), I.get(n), I.geU, I.brIf(1),
    I.get(sum), I.get(e), I.i32(4), I.shl, I.f64load(VALUE), I.trunc, I.add, I.set(sum),
    I.get(e), I.i32(1), I.add, I.set(e),
    I.br(0),
    I.end, I.end,
    I.get(sum), I.i32(1), I.and, I.eqz,
    I.if, I.i32(STATE), I.i32(STATE), I.load(), I.i32(2), I.add, I.store(),
    I.else, I.i32(STATE), I.i32(STATE), I.load(), I.i32(1), I.sub, I.store(),
    I.end,
    I.i32(FRAME), I.i32(FRAME), I.load(), I.i32(1), I.add, I.store(),
  );
  return logicModule('stub', WRITES_AT, { locals: 0, body: [] }, { locals: 3, body: step });
}

// ---------------------------------------------------------------------------------------------------
// Scripts: what each player does, by match step, and this suite's mirror of `army` on them.

/** One scripted entry: the player sets `control` to `value` when match step `step` is the first its copy hasn't run,
 * so the entry is stamped `delay` steps later (Net `net@1`). */
export interface Play { step: number; control: string; value: number }
/** A player's script: one entry at every match step from 0 until `delay` steps before `steps`, values −8 … 8. */
export function script(player: number, steps: number, delay = DELAY): Play[] {
  const out: Play[] = [];
  for (let g = 0; g + delay < steps; g++) out.push({ step: g, control: CONTROL, value: ((g * 7 + player * 3) % 17) - 8 });
  return out;
}
export type Plays = Record<string, Play[]>;
/** Every player's script for a match of `players` over `steps` match steps. */
export function scripts(players: number, steps: number, delay = DELAY): Plays {
  return Object.fromEntries(Array.from({ length: players }, (_, k) => [String(k + 1), script(k + 1, steps, delay)]));
}

/** `army`'s arrays after match steps 0 … `steps` − 1 on `plays`, each entry applied at its step plus `delay`, a step's
 * entries in player order (one entry a player a step here, so seq never decides): what every copy must hold. */
export function armyAfter(plays: Plays, steps: number, delay = DELAY): { pos: number[]; vel: number[] } {
  const pos = Array.from({ length: UNITS }, (_, i) => (i % 20) * 16);
  const vel = new Array<number>(UNITS).fill(0);
  const at = new Map<number, { player: number; value: number }[]>();
  for (const [player, list] of Object.entries(plays)) for (const e of list) at.set(e.step + delay, [...(at.get(e.step + delay) ?? []), { player: Number(player), value: e.value }]);
  let acc = 0;
  for (let k = 0; k < steps; k++) {
    for (const e of (at.get(k) ?? []).sort((x, y) => x.player - y.player)) {
      acc = (Math.imul(acc, 31) + e.player * 1000 + e.value + 8) | 0;
      const idx = (acc >>> 0) % UNITS;
      vel[idx] = ((Math.imul(vel[idx]!, 3) + e.value * e.player) | 0) % 17;
    }
    for (let i = 0; i < UNITS; i++) pos[i] = (pos[i]! + vel[i]!) | 0;
  }
  return { pos, vel };
}

// ---------------------------------------------------------------------------------------------------
// Documents (#391's envelope as you send it, as #172's suite writes them). IDs are 26 Crockford characters.

const ulid = (k: number): string => `01JB549D${String(k).padStart(18, '0')}`;
export const DOC = { lockstep: ulid(1), plain: ulid(2), decoy: ulid(3), noRelay: ulid(4), httpRelay: ulid(5), twoHosts: ulid(6), stub: ulid(7) } as const;
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #549 acceptance tests.' };
const order = (k: number): string => `a${String(k).padStart(4, '0')}`;
export const SIZE: [number, number] = [640, 360];

function sceneDoc(id: string, title: string, span: string, items: Record<string, JsonObject>, extra: JsonObject): JsonObject {
  const withIds: JsonObject = {};
  let k = 0;
  for (const [itemId, item] of Object.entries(items)) withIds[itemId] = { id: itemId, name: itemId, order: order(k++), ...item };
  return {
    format: 1, id, profile: 'scene', title, description: `${title}: a piece the #549 acceptance tests play.`, size: SIZE, camera: 'cam', seed: 549,
    transport: { span, frame_rate: [60, 1] }, ...extra, items: withIds,
  };
}
const camera: JsonObject = { kind: 'camera@1', params: { projection: 'perspective', position: [0, 3, 12], target: [0, 0.5, 0], fov: 40 } };
const box: JsonObject = { kind: 'mark.box@1', params: { size: [1, 1, 1] }, at: { pos: [0, 0.5, 0] } };
const slider = (label: string): JsonObject => ({ kind: 'slider', class: 'document', label, role: 'slider', range: RANGE, default: 0, increment: 1 });
const logicItem = (program: Program, writes: JsonObject, reads: string[]): JsonObject =>
  ({ kind: 'logic@1', params: { program: program.sha, step_rate: RATE, reads, writes } });

export interface NetFields { relay?: JsonValue; players?: number; step_rate?: number; delay?: number; window?: number; hash_every?: number; timeout?: number }
/** A `net@1` item with exactly the fields given. */
export const netItem = (fields: NetFields): JsonObject => ({ kind: 'net@1', params: { ...fields } as JsonObject });

/**
 * The lockstep piece (criteria 2 to 8): a 3D scene with the logic item `army` (300 units, 20 Hz) reading the slider
 * `push`, and the net item `match`: 20 Hz, window 0, delay 4, and what `net` adds (the relay, `hash_every`, `timeout`).
 * `span` covers the longest match played (3,600 steps: 180 s).
 */
export function lockstepDoc(program: Program, net: NetFields, id: string = DOC.lockstep): JsonObject {
  return sceneDoc(id, 'A lockstep army', '200s', {
    cam: camera,
    block: box,
    [LOGIC]: logicItem(program, ARMY_WRITES, [CONTROL]),
    match: netItem({ players: 2, step_rate: RATE, delay: DELAY, window: 0, ...net }),
  }, {
    requires: { modules: { scene3d: '^1', input: '^1', logic: '^1', net: '^1' } },
    controls: { [CONTROL]: slider('Push') },
    assets: { army_program: { sha256: program.sha, license: LICENSE } },
  });
}
/** The Oracle lane's piece: the stub game on the slider `inp` (0 to 255), with the delay given. */
export function stubDoc(program: Program, net: NetFields): JsonObject {
  return sceneDoc(DOC.stub, 'A stub game in lockstep', '20s', {
    cam: camera,
    block: box,
    game: logicItem(program, STUB_WRITES, ['inp']),
    match: netItem({ players: 2, step_rate: RATE, window: 0, ...net }),
  }, {
    requires: { modules: { scene3d: '^1', input: '^1', logic: '^1', net: '^1' } },
    controls: { inp: { kind: 'slider', class: 'document', label: 'Input', role: 'slider', range: [0, 255], default: 0, increment: 1 } },
    assets: { stub_program: { sha256: program.sha, license: LICENSE } },
  });
}
/** Criterion 1's piece without a net item: the same scene and logic, played alone. */
export function plainDoc(program: Program): JsonObject {
  return sceneDoc(DOC.plain, 'An army played alone', '12s', { cam: camera, block: box, [LOGIC]: logicItem(program, ARMY_WRITES, [CONTROL]) }, {
    requires: { modules: { scene3d: '^1', input: '^1', logic: '^1' } },
    controls: { [CONTROL]: slider('Push') },
    assets: { army_program: { sha256: program.sha, license: LICENSE } },
  });
}
/**
 * Criterion 2's piece: the lockstep piece with everything a piece itself could try a Join with. A press control named
 * `join` and labelled "Join"; a tour that presses it at 2 s and 3 s and moves the slider; and the logic, which steps
 * from the start. None of them is a person's click on the app's or the player's own prompt.
 */
export function decoyDoc(program: Program, net: NetFields): JsonObject {
  const doc = lockstepDoc(program, net, DOC.decoy);
  return {
    ...doc,
    title: 'A piece that tries to join by itself',
    controls: { ...(doc['controls'] as JsonObject), join: { kind: 'press', class: 'document', label: 'Join', role: 'button' } },
    tour: { keys: { join: [[2, 1], [3, 1]], [CONTROL]: [[2.5, 3]] }, idle_after: 1.4, resume_after: 3.6, loop: true },
  };
}
/** A tour's entry on the piece's own `join` control, as the input track holds one (#504's form). */
export const tourEntry = (seconds: number): JsonObject => ({ t: Math.round(seconds * FLICKS), seq: 0, control: 'join', value: 1, writer: 'tour', player: 1 });
