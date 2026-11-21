// The criteria's fixtures (README: Fixtures): this suite's two logic programs, the look with no fallback faces, and the
// documents, each a figure with a transport in #542's form (a 2D camera over a 480 × 240 u page, 60 frames a second),
// with the issue's fields: the text control `name`, entry texts on text items and on a mark set's text column, and a
// two-seat net item. Nothing here types, commits, steps a match or draws anything.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { I, REPO, logicModule, type JsonObject, type JsonValue, type Program } from './helpers.ts';

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #297 acceptance tests.' };
export const SEED = 297;
/** Every fixture's page: 480 × 240 u, shown in a 480 × 240 px panel. */
export const PAGE: [number, number] = [480, 240];

// ---------------------------------------------------------------------------------------------------
// The text control and the entry texts, as the issue's Fields write them.

/** The criteria's control: `name`, a one-line text control with `max_bytes` 16 (criterion 1), its default "Player". */
export const NAME = 'name';
export const DEFAULT_NAME = 'Player';
export const nameControl = (maxBytes = 16): JsonObject => ({ kind: 'text', class: 'document', label: 'Name', role: 'textbox', default: DEFAULT_NAME, text: { max_bytes: maxBytes, lines: 'one' } });

/** The text size every entry text is set at, in u. */
export const SIZE = 16;
/** "A box sized for 10 of the widest glyph": 10 advances of W, the widest glyph of the body face (Inter: 2018 of 2048
 * units an em), at 16 u: 157.66 u, rounded up. Every entry text's box but criterion 10's narrow one. */
export const TEN_W = 158;
/** The `widest` every entry text declares: six W, 94.6 u at 16 u, and 120.5 u with " (2)", inside `TEN_W`. */
export const WIDEST = 'WWWWWW';
/** Criterion 10's box that fits `WIDEST` alone (94.6 u) and not `WIDEST` with " (2)" (120.5 u). */
export const NARROW = 105;

export interface EntryOpts { pos: [number, number]; order: string; w?: number; widest?: string | null }
/** A text item showing `name`'s entries for `player` (a seat number, or a logic array path): `{entry, player, widest}`,
 * one line in a box of `w` × 24 u, ellipsized when it overflows (the default `overflow`, written out). */
export function entryText(id: string, player: number | string, o: EntryOpts): JsonObject {
  const text: JsonObject = { entry: NAME, player };
  if (o.widest !== null) text['widest'] = o.widest ?? WIDEST;
  return {
    id, kind: 'text@1', name: `Name ${id}`, order: o.order, at: { pos: [o.pos[0], o.pos[1], 0] },
    params: { text, size: SIZE, box: { w: o.w ?? TEN_W, h: 24 }, max_lines: 1, overflow: 'ellipsis' },
  };
}
/** Seat 1's and seat 2's nameplates, one above the other. */
export const plate = (n: 1 | 2, w = TEN_W): JsonObject => entryText(`plate${n}`, n, { pos: [16, n === 1 ? 40 : 120], order: `a${n}`, w });

// ---------------------------------------------------------------------------------------------------
// The logic programs (Logic `logic@1`): arrays in declaration order on 8-byte boundaries from `writes_at`, each written
// every step; declared in alphabetical order too, so either order lays them out alike.

export const WRITES_AT = 4096;
/** `seats`: `spot` f64 × 2 = [1, 2], then `who` i32 × 2 = [1, 2]: each seat's number, as a float and as an integer. */
export const SEATS_WRITES: JsonObject = { spot: { type: 'f64', count: 2 }, who: { type: 'i32', count: 2 } };
export function seatsProgram(): Program {
  return logicModule('seats', 0, WRITES_AT, [
    ...I.i32(WRITES_AT), ...I.f64(1), ...I.f64store(0),
    ...I.i32(WRITES_AT), ...I.f64(2), ...I.f64store(8),
    ...I.i32(WRITES_AT), ...I.i32(1), ...I.store(16),
    ...I.i32(WRITES_AT), ...I.i32(2), ...I.store(20),
  ]);
}
/** `echo`: reads `name` at `reads_at` 0 and writes the read region's first 24 bytes (`max_bytes` 16's whole slot:
 * 4 + 16 rounded up to 8) as six u32 words, `head`, every step. */
export const ECHO_WRITES: JsonObject = { head: { type: 'i32', count: 6 } };
export function echoProgram(): Program {
  const step: number[] = [];
  for (let i = 0; i < 6; i++) step.push(...I.i32(WRITES_AT + 4 * i), ...I.i32(4 * i), ...I.load(0), ...I.store(0));
  return logicModule('echo', 0, WRITES_AT, step);
}
/** Six u32 words, little-endian, as their 24 bytes. */
export const wordsToBytes = (words: number[]): Buffer => { const b = Buffer.alloc(4 * words.length); words.forEach((w, i) => b.writeUInt32LE(w >>> 0, 4 * i)); return b; };

// ---------------------------------------------------------------------------------------------------
// The look of criterion 4: the shipped clean look as it stands, under another ID and with no fallback faces, so a text
// is set in the body face (Inter: Latin, Greek and Cyrillic) alone and nothing draws Han.

export const LATIN_LOOK = 'latin-297';
export function latinLook(): Buffer {
  const clean = JSON.parse(readFileSync(join(REPO, 'crates', 'deep-canvas-marks', 'looks', 'clean.json'), 'utf8')) as JsonObject;
  return Buffer.from(JSON.stringify({ ...clean, id: LATIN_LOOK, description: 'The clean look with no fallback faces: the #297 acceptance tests\' Latin fonts.', fallback: [] }));
}

// ---------------------------------------------------------------------------------------------------
// Documents

function camera2d(): JsonObject {
  return { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [PAGE[0] / 2, PAGE[1] / 2, 0], view_width: PAGE[0] } };
}
/** The two-seat net item: 60 Hz, lockstep (window 0), delay 2, a relay no test joins. */
export const DELAY = 2;
const netItem = (): JsonObject => ({
  id: 'match', kind: 'net@1', name: 'Match', order: 'a8', params: { relay: 'https://relay.test/297', players: 2, step_rate: 60, delay: DELAY, window: 0 },
});
const logicItem = (id: string, p: Program, writes: JsonObject, reads: string[] = []): JsonObject =>
  ({ id, kind: 'logic@1', name: `Logic ${id}`, order: id === 'seats' ? 'a9' : 'b9', params: { program: p.sha, step_rate: 60, ...(reads.length ? { reads } : {}), writes } });

/** `look`: the SHA-256 of `latinLook()`; `echo`: the reader of criterion 7; `span` and `maxBytes` (the Oracle lane's
 * long tracks and longer strings): the transport's span and `name`'s `max_bytes`. */
export interface PieceOpts { look?: string; echo?: Program; span?: string; maxBytes?: number }
/**
 * A two-seat piece: the 2D camera, `seats`, the net item and `items`, the control `name`, each program in `assets`
 * with a license, and with `look` (the SHA-256 of `latinLook()`) the look by asset.
 */
export function piece(id: string, seats: Program, items: JsonObject[], o: PieceOpts = {}): JsonObject {
  const assets: JsonObject = { seats_program: { sha256: seats.sha, license: LICENSE } };
  if (o.echo) assets['echo_program'] = { sha256: o.echo.sha, license: LICENSE };
  if (o.look) assets[LATIN_LOOK] = { sha256: o.look, license: { id: 'Apache-2.0', terms: 'The repository\'s own look, renamed.', shareable: true, credit: 'The clean look, with no fallback faces.' } };
  const all: JsonObject[] = [camera2d(), logicItem('seats', seats, SEATS_WRITES), netItem(), ...items];
  if (o.echo) all.push(logicItem('echo', o.echo, ECHO_WRITES, [NAME]));
  return {
    format: 1, id, profile: 'figure', title: `#297 ${id}`, description: `The #297 acceptance tests' document ${id}.`, size: PAGE, seed: SEED, camera: 'cam',
    transport: { span: o.span ?? '10s', frame_rate: [60, 1] }, requires: { modules: { input: '^1', logic: '^1', net: '^1' } },
    ...(o.look ? { look: { asset: `${LATIN_LOOK}@1`, theme: 'light' } } : {}),
    controls: { [NAME]: nameControl(o.maxBytes) },
    items: Object.fromEntries(all.map((i) => [String(i['id']), i])),
    assets,
  };
}
/** Seat 1's and seat 2's nameplates (criteria 1, 4, 6, 8, 9, 10): `plate1` in a box of `w1`. */
export const namesDoc = (seats: Program, o: PieceOpts & { w1?: number; more?: JsonObject[] } = {}): JsonObject =>
  piece('names', seats, [plate(1, o.w1), plate(2), ...(o.more ?? [])], o);

/** A typed data column `{dtype, len, data: base64}` (Mark set and columns). */
function f32Column(values: number[]): JsonObject {
  const b = Buffer.alloc(4 * values.length);
  values.forEach((v, i) => b.writeFloatLE(v, 4 * i));
  return { dtype: 'f32', len: values.length, data: b.toString('base64') };
}
/** The nameplate mark set (criteria 2 and 7): two text rows at (16, 60) and (16, 150), the player column `column` (a
 * logic array read through the column view) and the entry text column. */
export function plates(column: JsonObject): JsonObject {
  return {
    id: 'plates', kind: 'marks@1', name: 'Nameplates', order: 'a3',
    params: {
      mark: 'text', encode: { x: { column: 'x' }, y: { column: 'y' }, text: { column: 'text' } },
      columns: { x: f32Column([16, 16]), y: f32Column([60, 150]), seat: column, text: { entry: NAME, player: 'seat', widest: WIDEST } },
    },
  };
}
/** Criterion 2's piece: the nameplate mark set whose player column `seats.who` writes, as u8. */
export const platesDoc = (seats: Program): JsonObject => piece('plates', seats, [plates({ array: 'seats.who', as: 'u8' })]);

/** Criterion 3's piece: `long`, seat 1's name in a box of `TEN_W`, with `widest` or (null) without it. */
export const fitDoc = (seats: Program, widest: string | null): JsonObject =>
  piece('fit', seats, [entryText('long', 1, { pos: [16, 80], order: 'a1', widest })]);

/** Criterion 5's piece: the nameplates and `ghost`, an entry text bound to player 5 of a two-seat match. */
export const seat5Doc = (seats: Program): JsonObject =>
  namesDoc(seats, { more: [entryText('ghost', 5, { pos: [240, 80], order: 'a4' })] });

export type Binding = 'f64_item' | 'i32_item' | 'f64_column' | 'i32_column';
/** Criterion 7's pieces: an entry text whose `player` reads `seats.spot` (f64) or `seats.who` (i32), on a text item
 * (`bound`, at index 0) or as a mark set's player column (`plates`, the column read `as` f64 or u8). */
export function bindingDoc(seats: Program, b: Binding): JsonObject {
  const items: Record<Binding, JsonObject> = {
    f64_item: entryText('bound', 'seats.spot[0]', { pos: [16, 80], order: 'a1' }),
    i32_item: entryText('bound', 'seats.who[0]', { pos: [16, 80], order: 'a1' }),
    f64_column: plates({ array: 'seats.spot', as: 'f64' }),
    i32_column: plates({ array: 'seats.who', as: 'u8' }),
  };
  return piece(`binding-${b}`, seats, [items[b]]);
}
/** Criterion 7's reader: the nameplates and `echo`, a logic item that declares `name` as a read. */
export const echoDoc = (seats: Program, echo: Program): JsonObject => namesDoc(seats, { echo });

export type { JsonValue };
