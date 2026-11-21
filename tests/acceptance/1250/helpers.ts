// Test-side tools for the #1250 acceptance tests: `deep-show` built once per file and driven by one JSON scenario on
// stdin (`deep-show run`, #393's convention, as #501's and #549's suites drive it), with the scenario's `planted` key for
// the wrong programs; the fixture pieces (a 256 × 192 indexed game on a 16-colour palette with a dithered gradient, the
// same game under a drawing look with sound, and a bright sidebar document), its logic program written here as
// WebAssembly bytes, and the scripted play; the readers of what the app answers (the clip cards, the live play's
// presented index frames) and of the files it writes; this suite's own GIF and PNG decoders, which no writer controls;
// and the judges the tests share. Nothing here stands in for the live play, the replica, the export path or a writer:
// each is read from what `deep-show` answers or writes. JSON readers, the build, the evidence store and the PNG reader
// for RGB frames are #501's; the drawing look, FFmpeg and the luma readers are #157's. README: The surface under test.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { expect } from 'vitest';
import { CC0, floatWav, lookOf, type Look } from '../157/helpers.ts';
import {
  FLICKS, REPO, arr, fl, getEvidence, hex64, int, isObject, n, obj, present, putEvidence, repliesOf, sha256, show, start, str, type JsonObject,
} from '../501/helpers.ts';

export {
  FLICKS, FULL, REPO, TIMEOUT, arr, blocked, decodePng, bgra, fl, getEvidence, hex64, inconclusive, int, isObject, n, none, num, obj,
  pngFrames, present, presented, putEvidence, referenceMacProblem, sha256, show, str, useShow, useTemp, type JsonObject, type JsonValue,
} from '../501/helpers.ts';
export { ffAudioStream, ffLuma, ffPcm, ffVideoFrames, ffprobeJson, ffmpegTools, lumaOf, mse } from '../157/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs `criterionId`: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #1250.a789fb24',
  2: 'AC2 #1250.fb20b3cc',
  3: 'AC3 #1250.ba96e86c',
  4: 'AC4 #1250.60cb9b00',
  5: 'AC5 #1250.d8e39d5f',
  6: 'AC6 #1250.5ed3407b',
  7: 'AC7 #1250.7b1c7063',
} as const;

/** The wrong programs the criteria name, each chosen by the scenario's `planted` (README: Planted programs). */
export type Planted = 'clip_requantizes_median_cut' | 'clip_gif_every_frame' | 'logic_reads_wall_clock';

// ---------------------------------------------------------------------------------------------------
// Time

/** One step and one frame of the fixtures, at 60 a second: 11,760,000 flicks. */
export const STEP = FLICKS / 60;
/** A GIF frame at 30 a second: 23,520,000 flicks. */
export const GIF_FRAME = FLICKS / 30;
/** The step a time falls on, at 60 a second. */
export const stepAt = (t: number): number => Math.floor(t / STEP);

// ---------------------------------------------------------------------------------------------------
// The scenario (README: The scenario): your shell's process tree, the panels, the documents on them, the evidence store,
// the app's state folder, #383's clock at 60 Hz, the calls (each with its `at`), and the wrong program.

const ulid = (k: number): string => `01JB1250${String(k).padStart(18, '0')}`;
export const DOC = { game: ulid(1), tone: ulid(2), side: ulid(3), long: ulid(4) } as const;
export const PANEL = 'main';
export const SIDE_PANEL = 'side';
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];

export interface World { evidence: string; state: string; doc: string; sidebar?: boolean; planted?: Planted }
/** The scenario: `doc` on panel `main` (512 × 384 at the origin), with `sidebar` the bright document on panel `side` right
 * beside it, and `calls`. */
export function scenario(w: World, calls: JsonObject[]): JsonObject {
  const panels: JsonObject = { [PANEL]: { rect: [0, 0, 512, 384] } };
  const docs: JsonObject = { [w.doc]: { panel: PANEL } };
  if (w.sidebar) { panels[SIDE_PANEL] = { rect: [512, 0, 256, 384] }; docs[DOC.side] = { panel: SIDE_PANEL }; }
  return {
    evidence: w.evidence, state: w.state, sessions: {}, processes: PROCESSES, panels, docs, clock: { refresh_hz: 60, lead: 0, check: 0 },
    ...(w.planted ? { planted: w.planted } : {}), calls,
  };
}
/** `deep-show run` with the scenario: exit 0, one answer line, ok, one reply per call. */
export function runApp(bin: string, w: World, calls: JsonObject[], what: string): JsonObject[] {
  const sc = scenario(w, calls);
  const tag = w.planted ? `${what} (planted ${w.planted})` : what;
  return repliesOf(start(bin, sc), sc, tag);
}
/** `deep show` of a whole document from your shell, at 0 on the scenario's clock. */
export const showAt = (doc: string, document: JsonObject, at = 0): JsonObject => ({ ...present(doc, document), at });

/** The piece's exports folder (README: Files): `<state>/exports/<doc ID>/`. */
export const exportsDir = (state: string, doc: string): string => join(state, 'exports', doc);
/** Every file under `dir`, by path relative to it. */
export function filesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, rel: string): void => { for (const e of readdirSync(d).sort()) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p, `${rel}${e}/`); else out.push(`${rel}${e}`); } };
  walk(dir, '');
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The calls (README: Calls)

/** The scripted play's one control: `move`, a slider from −2 to 2 in whole steps (the hero's speed along x). */
export const CONTROL = 'move';
/** The scripted play: a `control` input of yours on panel `main` every 0.75 s from 0.5 s up to (not at) `to`, its values
 * cycling 1, 2, −1, 0, −2, so the hero turns back and forth; every time a whole step. */
export function scriptedPlay(to: number, panel = PANEL): JsonObject[] {
  const values = [1, 2, -1, 0, -2];
  const out: JsonObject[] = [];
  for (let k = 0, t = fl(0.5); t < to; k++, t += fl(0.75)) out.push({ call: 'input', at: t, panel, event: { type: 'control', control: CONTROL, value: values[k % values.length]! } });
  return out;
}
/** ⌘⇧C, Save clip's default key, in panel `main`. */
export const saveClipKey = (at: number, panel = PANEL): JsonObject => ({ call: 'input', at, panel, event: { type: 'key', key: 'c', mods: ['cmd', 'shift'] } });
/** Save still, run as the app's player-control action (it has no default key). */
export const saveStill = (at: number, panel = PANEL): JsonObject => ({ call: 'input', at, panel, event: { type: 'action', action: 'save_still' } });
/** `clips`: the panel's clip cards, once every clip job the panel started has ended. */
export const clipsCall = (at: number, panel = PANEL): JsonObject => ({ call: 'clips', at, panel });
/** `presented` with each frame's index target from `from` on. */
export const presentedCall = (at: number, from: number, panel = PANEL): JsonObject => ({ call: 'presented', at, panel, indices: { from } });
/** `track`: the document's input track as the hub holds it (#1164), loading `load` first when given. */
export const trackCall = (doc: string, at: number, load?: JsonObject[]): JsonObject => ({ call: 'track', at, doc, ...(load ? { load } : {}) });

// ---------------------------------------------------------------------------------------------------
// Readers

/** A clip card (README: `clips`). */
export interface Clip {
  action: string; at: number; outcome: string; format: string | null; file: string | null; range: [number, number] | null; code: string | null;
  desync: { first_step: number; module: string; field: string } | null; text: string; wall: number | null; raw: JsonObject;
}
export function clipsOf(reply: JsonObject, what: string): Clip[] {
  return arr(reply['clips'], `${what}: clips`).map((c, i) => {
    const o = obj(c, `${what}: clips[${i}]`);
    const w = `${what}: clips[${i}]`;
    const range = o['range'] === undefined || o['range'] === null ? null : arr(o['range'], `${w}.range`).map((t, k) => int(t, `${w}.range[${k}]`)) as [number, number];
    const d = o['desync'];
    const desync = isObject(d) ? { first_step: int(d['first_step'], `${w}.desync.first_step`), module: str(d['module'], `${w}.desync.module`), field: str(d['field'], `${w}.desync.field`) } : null;
    const timing = o['timing'];
    return {
      action: str(o['action'], `${w}.action`), at: int(o['at'], `${w}.at`), outcome: str(o['outcome'], `${w}.outcome`),
      format: typeof o['format'] === 'string' ? o['format'] : null, file: typeof o['file'] === 'string' ? o['file'] : null, range,
      code: typeof o['code'] === 'string' ? o['code'] : null, desync, text: typeof o['text'] === 'string' ? o['text'] : '',
      wall: isObject(timing) && typeof timing['wall'] === 'number' ? timing['wall'] : null, raw: o,
    };
  });
}
/** The one card a run's clips reply holds, of `action`. */
export function oneClip(reply: JsonObject, action: string, what: string): Clip {
  const list = clipsOf(reply, what);
  expect(list.map((c) => c.action), `${what}: one card, for ${action}: ${show(reply)}`).toEqual([action]);
  return list[0]!;
}
/** A written clip's file: in the piece's exports folder, of `format`; its bytes. */
export function writtenFile(c: Clip, state: string, doc: string, format: string, what: string): Buffer {
  expect([c.outcome, c.format], `${what}: the card says the clip was written as ${format}: ${show(c.raw)}`).toEqual(['written', format]);
  expect(c.file, `${what}: the card names the file`).not.toBeNull();
  const dir = exportsDir(state, doc);
  expect(c.file!.startsWith(`${dir}/`) && !c.file!.slice(dir.length + 1).includes('/'), `${what}: the file ${c.file} is in the piece's exports folder ${dir}`).toBe(true);
  expect(existsSync(c.file!), `${what}: ${c.file} exists`).toBe(true);
  return readFileSync(c.file!);
}

/** The live play's presented frames with their index targets: each frame's time and its indices (one byte a target
 * pixel), in presentation order. */
export interface LiveFrame { t: number; indices: Uint8Array }
export function liveFrames(evidence: string, reply: JsonObject, from: number, what: string): LiveFrame[] {
  const frames = arr(reply['frames'], `${what}: frames`).map((f, i) => obj(f, `${what}: frames[${i}]`));
  const out: LiveFrame[] = [];
  for (const [i, f] of frames.entries()) {
    const t = int(f['t'], `${what}: frames[${i}].t`);
    if (t < from) continue;
    const bytes = getEvidence(evidence, hex64(f['indices'], `${what}: frames[${i}].indices`), `${what}: frames[${i}]'s index target`);
    expect(bytes.length, `${what}: frames[${i}]'s index target is ${TARGET[0]} × ${TARGET[1]} bytes`).toBe(TARGET[0] * TARGET[1]);
    out.push({ t, indices: new Uint8Array(bytes) });
  }
  return out;
}
/** The frame on screen at `t`: the last presented frame at or before it. */
export function shownAt(live: LiveFrame[], t: number): LiveFrame | null {
  let best: LiveFrame | null = null;
  for (const f of live) if (f.t <= t && (!best || f.t >= best.t)) best = f;
  return best;
}

// ---------------------------------------------------------------------------------------------------
// The indexed look (README: Fixtures): 16 colours, index i palette[i], a 256 × 192 target at scale 2.

export const TARGET: [number, number] = [256, 192];
export const LOOK_SCALE = 2;
export const SIZE: [number, number] = [TARGET[0] * LOOK_SCALE, TARGET[1] * LOOK_SCALE];
/** The palette in index order: a gradient from night to cream, no two alike. */
export const PALETTE_HEX = [
  '#140c1c', '#30123b', '#44234e', '#4c2f6e', '#3e4a8c', '#2f6aa0', '#2c8bb0', '#3aa8b4',
  '#5cc2a8', '#86d79a', '#b4e48c', '#dcea84', '#f0d87a', '#f4b870', '#f09870', '#f6f0e8',
] as const;
export type Rgb = [number, number, number];
export const rgbOf = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
export const PALETTE: Rgb[] = PALETTE_HEX.map(rgbOf);
export const hexOf = (c: readonly number[]): string => `#${c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
/** Role i of the palette, `p<i>`. The look's own `ground` stays as #157's look gives it, since the guard holds the ink
 * to its contrast on the ground. */
export const roleOf = (i: number): string => `p${i}`;
/** The game's indexed look, as #464's suite writes one: #157's drawing look with each palette colour as a palette entry
 * and a role, and the indexed basis over it. */
export function indexedLook(): Look {
  const base = lookOf('game-1250');
  const def = JSON.parse(base.bytes.toString('utf8')) as JsonObject;
  const palette = { ...obj(def['palette'], 'palette') };
  const roles = { ...obj(def['roles'], 'roles') };
  PALETTE_HEX.forEach((hex, i) => { palette[`c-${roleOf(i)}`] = hex; roles[roleOf(i)] = `c-${roleOf(i)}`; });
  const look = {
    ...def, id: 'game-1250', description: 'The #1250 acceptance look: a 16-colour indexed basis on a 256 × 192 target.', palette, roles,
    basis: { indexed: { size: TARGET, scale: LOOK_SCALE, palette: PALETTE_HEX.map((_, i) => roleOf(i)), tables: {}, protected: [], snap: 'integer' } },
  };
  const bytes = Buffer.from(`${JSON.stringify(look, null, 1)}\n`);
  return { id: 'game-1250', sha: sha256(bytes), bytes };
}

// ---------------------------------------------------------------------------------------------------
// The game's logic program, as WebAssembly bytes (Logic `logic@1`: one memory whose maximum is its minimum, immutable i32
// globals `reads_at` and `writes_at`, `init(seed: i64)`, `step(k: i64)`, no imports), written as #549's suite writes one.

const uleb = (v0: number): number[] => { const o: number[] = []; let v = v0 >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const sleb = (v0: number): number[] => {
  const o: number[] = [];
  let v = v0 | 0;
  for (;;) { const b = v & 0x7f; v >>= 7; if ((v === 0 && !(b & 0x40)) || (v === -1 && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); }
};
const name = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'latin1')];
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
const I = {
  get: (l: number): number[] => [0x20, ...uleb(l)], set: (l: number): number[] => [0x21, ...uleb(l)], i32: (v: number): number[] => [0x41, ...sleb(v)],
  load: (off = 0): number[] => [0x28, 0x02, ...uleb(off)], store: (off = 0): number[] => [0x36, 0x02, ...uleb(off)],
  f64load: (off = 0): number[] => [0x2b, 0x03, ...uleb(off)], f64store: (off = 0): number[] => [0x39, 0x03, ...uleb(off)],
  block: [0x02, 0x40], loop: [0x03, 0x40], end: [0x0b], br: (d: number): number[] => [0x0c, ...uleb(d)], brIf: (d: number): number[] => [0x0d, ...uleb(d)],
  add: [0x6a], remU: [0x70], shl: [0x74], geU: [0x4f], trunc: [0xaa], toF64: [0xb7],
} as const;
const code = (...parts: (readonly number[])[]): number[] => parts.flatMap((p) => [...p]);

/** The read region: the slider's slot, a u32 count and 4 zero bytes, then each entry as a u32 player, 4 zero bytes and
 * its f64 value (16 B an entry). The write region from 4,096: the arrays in declaration order, each f64 × 1. */
const WRITES_AT = 4096;
/** Cells the program keeps between steps, outside every region: the hero's x and y in target px, and its speed. */
const PX = 8192; const PY = 8196; const VEL = 8200;
/** The arrays `game` writes, in declaration order (alphabetical too). */
export const GAME_WRITES: JsonObject = { x: { type: 'f64', count: 1 }, x2: { type: 'f64', count: 1 }, y: { type: 'f64', count: 1 }, y2: { type: 'f64', count: 1 } };
export interface Program { bytes: Buffer; sha: string }
/**
 * `game`: the hero, a 16 × 16 target-pixel block. `init` puts it at (100, 80) with speed 1. Each step takes the speed
 * from the step's last `move` entry, moves the hero along x by it (wrapping in 0 to 239) and one pixel down (wrapping in
 * 0 to 175), and writes its box in document units (target px × 2): x, x2 = x + 32, y, y2 = y + 32. So every step changes
 * the frame, and an entry changes every later one.
 */
export function gameProgram(): Program {
  const [nn, e, px, py, vel] = [1, 2, 3, 4, 5];
  const init = code(I.i32(PX), I.i32(100), I.store(), I.i32(PY), I.i32(80), I.store(), I.i32(VEL), I.i32(1), I.store());
  const box = (cell: number, add: number, off: number): number[] => code(I.i32(WRITES_AT), I.get(cell), I.i32(add), I.add, I.i32(1), I.shl, I.toF64, I.f64store(off));
  const step = code(
    I.i32(0), I.load(), I.set(nn),
    I.i32(VEL), I.load(), I.set(vel),
    I.block, I.loop,
    I.get(e), I.get(nn), I.geU, I.brIf(1),
    I.get(e), I.i32(4), I.shl, I.f64load(16), I.trunc, I.set(vel),
    I.get(e), I.i32(1), I.add, I.set(e),
    I.br(0),
    I.end, I.end,
    I.i32(VEL), I.get(vel), I.store(),
    I.i32(PX), I.load(), I.get(vel), I.add, I.i32(240), I.add, I.i32(240), I.remU, I.set(px),
    I.i32(PX), I.get(px), I.store(),
    I.i32(PY), I.load(), I.i32(1), I.add, I.i32(176), I.remU, I.set(py),
    I.i32(PY), I.get(py), I.store(),
    box(px, 0, 0), box(px, 16, 8), box(py, 0, 16), box(py, 16, 24),
  );
  const fn = (locals: number, body: number[]): number[] => { const b = [...(locals ? [0x01, ...uleb(locals), 0x7f] : [0x00]), ...body, 0x0b]; return [...uleb(b.length), ...b]; };
  const bytes = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, 0x01, 0x01]])),
    ...section(6, vec([[0x7f, 0x00, ...I.i32(0), 0x0b], [0x7f, 0x00, ...I.i32(WRITES_AT), 0x0b]])),
    ...section(7, vec([[...name('memory'), 0x02, 0x00], [...name('reads_at'), 0x03, 0x00], [...name('writes_at'), 0x03, 0x01], [...name('init'), 0x00, 0x00], [...name('step'), 0x00, 0x01]])),
    ...section(10, vec([fn(0, init), fn(5, step)])),
  ]);
  return { bytes, sha: sha256(bytes) };
}

// ---------------------------------------------------------------------------------------------------
// The documents (README: Fixtures). A 2D scene: a 2D orthographic camera over the page, document units = target px × 2.

const order = (k: number): string => `a${String(k).padStart(4, '0')}`;
const item = (id: string, kind: string, k: number, params: JsonObject, extra: JsonObject = {}): JsonObject => ({ id, kind, name: id, order: order(k), params, ...extra });
const rectItem = (id: string, k: number, box: [number, number, number, number], role: string, extra: JsonObject = {}): JsonObject =>
  item(id, 'rect@1', k, { box, paint: { fill: { role } } }, extra);
const camera = (size: [number, number]): JsonObject => item('cam', 'camera@1', 0, { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] });
const logicColumn = (array: string): JsonObject => ({ array: `game.${array}`, as: 'f32' });
/** The hero: a mark set of one rect row whose box is the logic item's four arrays (Mark set: logic columns). */
const hero = (k: number, role: string): JsonObject => item('hero', 'marks@1', k, {
  mark: 'rect', paint: { fill: { role } },
  columns: { x: logicColumn('x'), x2: logicColumn('x2'), y: logicColumn('y'), y2: logicColumn('y2') },
  encode: { x: { column: 'x' }, x2: { column: 'x2' }, y: { column: 'y' }, y2: { column: 'y2' } },
});
/**
 * The dithered gradient over the whole frame: band i (0 to 15) of palette colour i, 16 target px wide and full height;
 * over each boundary an 8 px strip of the next colour at opacity 0.5, which the indexed basis draws as its 4 × 4 ordered
 * threshold (`see_through: dither`), so every frame holds all 16 colours with dithered steps between them.
 */
function gradient(): JsonObject[] {
  const out: JsonObject[] = [];
  for (let i = 0; i < 16; i++) out.push(rectItem(`band${i}`, 1 + i, [32 * i, 0, 32, SIZE[1]], roleOf(i)));
  for (let i = 0; i < 15; i++) out.push(rectItem(`step${i}`, 20 + i, [32 * (i + 1) - 8, 0, 16, SIZE[1]], roleOf(i + 1), { adjust: { opacity: 0.5 } }));
  return out;
}
const slider: JsonObject = { kind: 'slider', class: 'document', label: 'Move', role: 'slider', range: [-2, 2], default: 0, increment: 1 };
function pieceDoc(id: string, title: string, size: [number, number], look: Look, program: Program, spanSeconds: number, items: JsonObject[], extra: JsonObject = {}): JsonObject {
  const all = [camera(size), ...items, item('game', 'logic@1', 90, { program: program.sha, step_rate: 60, reads: [CONTROL], writes: GAME_WRITES })];
  const assets = { ...(isObject(extra['assets']) ? extra['assets'] : {}), [look.id]: { sha256: look.sha, license: CC0 }, game_program: { sha256: program.sha, license: CC0 } };
  return {
    format: 1, id, profile: 'scene', title, description: `${title}: a piece the #1250 acceptance tests play and clip.`, size, camera: 'cam', seed: 1250,
    look: { asset: `${look.id}@1`, theme: 'light' }, transport: { span: `${spanSeconds}s`, frame_rate: [60, 1] },
    requires: { modules: { input: '^1', logic: '^1' } }, controls: { [CONTROL]: slider },
    ...extra, items: Object.fromEntries(all.map((i) => [String(i['id']), i])), assets,
  };
}
/** The indexed fixture game, its look and program put in the evidence store. `span` covers the longest play. */
export function gameDoc(evidence: string, spanSeconds = 60, id: string = DOC.game): JsonObject {
  const look = indexedLook(); const program = gameProgram();
  putEvidence(evidence, look.bytes); putEvidence(evidence, program.bytes);
  return pieceDoc(id, 'An indexed fixture game', SIZE, look, program, spanSeconds, [...gradient(), hero(40, roleOf(15))]);
}

/** The non-indexed piece's sound: stereo, 48 kHz, 16 s; in second s a tone at 300 + 40 s Hz (0.25 in each channel). */
export const SR = 48_000;
export const TONE_SECONDS = 16;
export const toneHz = (s: number): number => 300 + 40 * s;
export function toneSound(): Float32Array[] {
  const ch = new Float32Array(TONE_SECONDS * SR);
  for (let i = 0; i < ch.length; i++) ch[i] = 0.25 * Math.sin((2 * Math.PI * toneHz(Math.floor(i / SR)) * (i % SR)) / SR);
  return [ch, Float32Array.from(ch)];
}
/** The same game under #157's drawing look (not indexed), 160 × 90, with the sound as its one strip. */
export const TONE_SIZE: [number, number] = [160, 90];
export function toneDoc(evidence: string): JsonObject {
  const look = lookOf('tone-1250'); const program = gameProgram();
  putEvidence(evidence, look.bytes); putEvidence(evidence, program.bytes);
  const sound = putEvidence(evidence, floatWav(toneSound(), SR));
  const doc = pieceDoc(DOC.tone, 'A fixture game with a drawing look and sound', TONE_SIZE, look, program, TONE_SECONDS, [
    rectItem('back', 1, [0, 0, TONE_SIZE[0], TONE_SIZE[1]], 'ground'), rectItem('side', 2, [0, 0, 48, TONE_SIZE[1]], 'muted'), hero(3, 'accent'),
  ], { assets: { sound: { sha256: sound, license: CC0 } }, strips: { sound: { track: 1, src: sound, start: 0, in: 0, out: fl(TONE_SECONDS), rate: 1 } } });
  doc['transport'] = { ...obj(doc['transport'], 'transport'), sample_rate: SR };
  return doc;
}

/** The bright sidebar: a 256 × 384 figure of magenta and lime, neither in the game's palette. */
export const SIDEBAR_HEX = ['#ff00ff', '#00ff40'] as const;
export function sidebarDoc(evidence: string): JsonObject {
  const look = lookOf('sidebar-1250', { ground: SIDEBAR_HEX[0], accent: SIDEBAR_HEX[1] });
  putEvidence(evidence, look.bytes);
  const size: [number, number] = [256, 384];
  const items = [camera(size), rectItem('back', 1, [0, 0, 256, 384], 'ground'), rectItem('stripe', 2, [0, 96, 256, 96], 'accent'), rectItem('stripe2', 3, [64, 240, 128, 96], 'accent')];
  return {
    format: 1, id: DOC.side, profile: 'figure', title: 'A bright sidebar', description: 'Bright colours beside the game panel, in no palette of the game.', size, camera: 'cam',
    look: { asset: `${look.id}@1`, theme: 'light' }, items: Object.fromEntries(items.map((i) => [String(i['id']), i])), assets: { [look.id]: { sha256: look.sha, license: CC0 } },
  };
}

/** A 60-minute play's track as a held key writes it: one `move` entry of yours at every step, 216,000 in all. */
export function heldTrack(minutes: number): JsonObject[] {
  const steps = minutes * 60 * 60;
  return Array.from({ length: steps }, (_, k) => ({ t: k * STEP, control: CONTROL, value: (Math.floor(k / 60) % 5) - 2, writer: 'you' }));
}

// ---------------------------------------------------------------------------------------------------
// GIF: this suite's own decoder (GIF87a and GIF89a: the logical screen, colour tables, graphic control and application
// extensions, LZW, interlace) and compositor, apart from every writer.

export interface GifFrame { delay: number; disposal: number; transparent: number | null; rect: [number, number, number, number]; local: Rgb[] | null; interlaced: boolean }
export interface Gif { width: number; height: number; global: Rgb[] | null; background: number; loop: number | null; frames: GifFrame[] }
/** Called with each frame as a viewer shows it, composited onto the logical screen (disposal and transparency applied):
 * each pixel's colour (3 bytes) and whether any frame so far drew it and nothing has cleared it since. */
export type GifVisit = (j: number, rgb: Uint8Array, drawn: Uint8Array, width: number) => void;

/** GIF's variable-width LZW: `pixels` colour indices from an image's data sub-blocks. */
function lzw(data: Uint8Array, minSize: number, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels);
  const clear = 1 << minSize; const eoi = clear + 1;
  const prefix = new Int32Array(4096); const suffix = new Uint8Array(4096); const head = new Uint8Array(4096);
  for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; head[i] = i; }
  const stack = new Uint8Array(4097);
  let size = minSize + 1; let next = eoi + 1; let prev = -1;
  let acc = 0; let bits = 0; let p = 0; let o = 0;
  const emit = (code: number): void => {
    let sp = 0;
    for (let c = code; c >= 0; c = prefix[c]!) stack[sp++] = suffix[c]!;
    while (sp > 0 && o < pixels) out[o++] = stack[--sp]!;
  };
  while (o < pixels) {
    while (bits < size) { if (p >= data.length) return out; acc |= data[p++]! << bits; bits += 8; }
    const code = acc & ((1 << size) - 1); acc >>>= size; bits -= size;
    if (code === clear) { size = minSize + 1; next = eoi + 1; prev = -1; continue; }
    if (code === eoi) break;
    if (prev < 0) { emit(code); prev = code; continue; }
    let first: number;
    if (code < next) { emit(code); first = head[code]!; } else { emit(prev); if (o < pixels) out[o++] = head[prev]!; first = head[prev]!; }
    if (next < 4096) {
      prefix[next] = prev; suffix[next] = first; head[next] = head[prev]!; next++;
      if (next === 1 << size && size < 12) size++;
    }
    prev = code;
  }
  return out;
}
/** A GIF's screen, tables, loop and frames; with `visit`, each frame as a viewer shows it. */
export function decodeGif(b: Buffer, visit?: GifVisit): Gif {
  const sig = b.toString('latin1', 0, 6);
  if (sig !== 'GIF89a' && sig !== 'GIF87a') throw Error(`not a GIF: it starts ${JSON.stringify(sig)}`);
  const width = b.readUInt16LE(6); const height = b.readUInt16LE(8); const packed = b[10]!; const background = b[11]!;
  let p = 13;
  const table = (bits: number): Rgb[] => { const k = 1 << (bits + 1); const t: Rgb[] = []; for (let i = 0; i < k; i++) t.push([b[p + 3 * i]!, b[p + 3 * i + 1]!, b[p + 3 * i + 2]!]); p += 3 * k; return t; };
  const global = packed & 0x80 ? table(packed & 7) : null;
  const subBlocks = (): Buffer => { const parts: Buffer[] = []; for (;;) { const len = b[p++]!; if (!len) break; parts.push(b.subarray(p, p + len)); p += len; } return Buffer.concat(parts); };
  let loop: number | null = null;
  let gce = { delay: 0, disposal: 0, transparent: null as number | null };
  const frames: GifFrame[] = [];
  const rgb = new Uint8Array(width * height * 3); const drawn = new Uint8Array(width * height);
  let undo: (() => void) | null = null;
  while (p < b.length) {
    const kind = b[p++]!;
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      const label = b[p++]!;
      if (label === 0xf9) {
        const size = b[p]!; const f = b[p + 1]!;
        gce = { delay: b.readUInt16LE(p + 2), disposal: (f >> 2) & 7, transparent: f & 1 ? b[p + 4]! : null };
        p += 1 + size; subBlocks();
      } else if (label === 0xff) {
        const size = b[p]!; const ident = b.toString('latin1', p + 1, p + 1 + size); p += 1 + size;
        const data = subBlocks();
        if ((ident === 'NETSCAPE2.0' || ident === 'ANIMEXTS1.0') && data.length >= 3 && data[0] === 1) loop = data.readUInt16LE(1);
      } else subBlocks();
      continue;
    }
    if (kind !== 0x2c) throw Error(`GIF: an unknown block 0x${kind.toString(16)} at byte ${p - 1}`);
    if (undo) { undo(); undo = null; }
    const left = b.readUInt16LE(p); const top = b.readUInt16LE(p + 2); const w = b.readUInt16LE(p + 4); const h = b.readUInt16LE(p + 6); const f = b[p + 8]!; p += 9;
    const local = f & 0x80 ? table(f & 7) : null; const interlaced = (f & 0x40) !== 0;
    const minSize = b[p++]!;
    const idx = lzw(subBlocks(), minSize, w * h);
    const colours = local ?? global;
    if (!colours) throw Error(`GIF: frame ${frames.length} has no colour table`);
    const before = gce.disposal === 3 ? { rgb: rgb.slice(), drawn: drawn.slice() } : null;
    const rows: number[] = [];
    if (interlaced) { for (const [s, d] of [[0, 8], [4, 8], [2, 4], [1, 2]] as const) for (let y = s; y < h; y += d) rows.push(y); } else for (let y = 0; y < h; y++) rows.push(y);
    rows.forEach((y, r) => {
      for (let x = 0; x < w; x++) {
        const i = idx[r * w + x]!; const X = left + x; const Y = top + y;
        if (X >= width || Y >= height || (gce.transparent !== null && i === gce.transparent)) continue;
        const c = colours[i];
        const q = Y * width + X;
        if (!c) { drawn[q] = 0; continue; }
        rgb[3 * q] = c[0]; rgb[3 * q + 1] = c[1]; rgb[3 * q + 2] = c[2]; drawn[q] = 1;
      }
    });
    visit?.(frames.length, rgb, drawn, width);
    frames.push({ delay: gce.delay, disposal: gce.disposal, transparent: gce.transparent, rect: [left, top, w, h], local, interlaced });
    if (gce.disposal === 2) undo = () => { for (let y = top; y < Math.min(top + h, height); y++) for (let x = left; x < Math.min(left + w, width); x++) drawn[y * width + x] = 0; };
    else if (before) undo = () => { rgb.set(before.rgb); drawn.set(before.drawn); };
    gce = { delay: 0, disposal: 0, transparent: null };
  }
  return { width, height, global, background, loop, frames };
}

/** The delays the rule gives (Fields: a frame's delay in hundredths with the remainder carried): ⌊100 (k + 1) ÷ rate⌋ −
 * ⌊100 k ÷ rate⌋ for frame k. At 30 a second: 3, 3, 4 repeated. */
export const carriedDelays = (frames: number, rate: number): number[] => Array.from({ length: frames }, (_, k) => Math.floor((100 * (k + 1)) / rate) - Math.floor((100 * k) / rate));

export interface GifExpect {
  frames: number; delays: number[];
  /** The live index frame each GIF frame must show (one byte a target pixel), or null to leave the pixels unjudged. */
  live: ((j: number) => Uint8Array | null) | null;
}
const sameRgb = (a: readonly number[], b: readonly number[]): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const at = (rgb: Uint8Array, q: number): Rgb => [rgb[3 * q]!, rgb[3 * q + 1]!, rgb[3 * q + 2]!];
/**
 * This suite's check of a clip GIF of the indexed game (README: The GIF check). Each failure names what it found: the
 * size, the colour table, the loop, the frame count, `frame j: delay d hundredths, under 2` (the first such), the first
 * delay off the rule, the sum, and for each frame (at most 20 named) the first pixel whose colour isn't the live index
 * frame's at its target pixel (X ÷ 2, Y ÷ 2): `frame j pixel (X, Y): …`.
 */
export function checkGif(bytes: Buffer, e: GifExpect): { gif: Gif; failures: string[] } {
  const pixels: string[] = [];
  const gif = decodeGif(bytes, e.live ? (j, rgb, drawn) => {
    if (pixels.length >= 20 || rgb.length !== SIZE[0] * SIZE[1] * 3) return;
    const live = e.live!(j);
    if (!live) { pixels.push(`frame ${j}: the live play presented no frame to compare it with`); return; }
    for (let q = 0; q < SIZE[0] * SIZE[1]; q++) {
      const X = q % SIZE[0]; const Y = Math.floor(q / SIZE[0]);
      const index = live[(Y >> 1) * TARGET[0] + (X >> 1)]!; const want = PALETTE[index];
      const where = `the live frame shows index ${index} (${want ? hexOf(want) : 'off the palette'}) at target pixel (${X >> 1}, ${Y >> 1})`;
      if (!drawn[q]) { pixels.push(`frame ${j} pixel (${X}, ${Y}): nothing drawn there, where ${where}`); return; }
      if (!want || !sameRgb(at(rgb, q), want)) { pixels.push(`frame ${j} pixel (${X}, ${Y}): decoded ${hexOf(at(rgb, q))}, where ${where}`); return; }
    }
  } : undefined);
  const f: string[] = [];
  if (gif.width !== SIZE[0] || gif.height !== SIZE[1]) f.push(`size: the GIF is ${gif.width} × ${gif.height}, not ${SIZE[0]} × ${SIZE[1]}`);
  if (!gif.global) f.push('colour table: the GIF has no global colour table');
  else {
    const off = PALETTE.findIndex((c, i) => !gif.global![i] || !sameRgb(gif.global![i]!, c));
    if (off >= 0) f.push(`colour table: entry ${off} is ${gif.global[off] ? hexOf(gif.global[off]!) : 'missing'}, not the palette's ${PALETTE_HEX[off]} (the table: ${gif.global.slice(0, 16).map(hexOf).join(' ')})`);
  }
  const local = gif.frames.findIndex((fr) => fr.local !== null && PALETTE.some((c, i) => !fr.local![i] || !sameRgb(fr.local![i]!, c)));
  if (local >= 0) f.push(`colour table: frame ${local} carries a local colour table that isn't the palette`);
  if (gif.loop !== 0) f.push(`loop: the GIF ${gif.loop === null ? 'has no loop extension' : `loops ${gif.loop} times`}, not forever (a NETSCAPE2.0 count of 0)`);
  if (gif.frames.length !== e.frames) f.push(`frames: the GIF holds ${n(gif.frames.length)} frames, not ${n(e.frames)}`);
  const delays = gif.frames.map((fr) => fr.delay);
  const under = delays.findIndex((d) => d < 2);
  if (under >= 0) f.push(`frame ${under}: delay ${delays[under]} hundredths, under 2 (the first delay under 2)`);
  const offRule = delays.findIndex((d, k) => d !== e.delays[k]);
  if (offRule >= 0) f.push(`delays: frame ${offRule}'s delay is ${delays[offRule]}, not the rule's ${e.delays[offRule] ?? 'none'} (the first off the rule; the GIF's first twelve: ${delays.slice(0, 12).join(', ')})`);
  const sum = delays.reduce((a, d) => a + d, 0); const want = e.delays.reduce((a, d) => a + d, 0);
  if (sum !== want) f.push(`delays: they sum to ${n(sum)} hundredths, not ${n(want)}`);
  return { gif, failures: [...f, ...pixels] };
}
/** Every frame holding a pixel whose colour isn't one of the palette's 16, or where nothing is drawn: the first such
 * pixel of each (at most 20 named). */
export function offPalette(bytes: Buffer): { gif: Gif; failures: string[] } {
  const keys = new Set(PALETTE.map((c) => (c[0] << 16) | (c[1] << 8) | c[2]));
  const f: string[] = [];
  const gif = decodeGif(bytes, (j, rgb, drawn, width) => {
    if (f.length >= 20) return;
    for (let q = 0; q < drawn.length; q++) {
      const c = at(rgb, q);
      if (!drawn[q] || !keys.has((c[0] << 16) | (c[1] << 8) | c[2])) { f.push(`frame ${j} pixel (${q % width}, ${Math.floor(q / width)}): ${drawn[q] ? hexOf(c) : 'nothing drawn'}, not a palette colour`); return; }
    }
  });
  return { gif, failures: f };
}

// ---------------------------------------------------------------------------------------------------
// PNG with a palette: this suite's own reader of an indexed PNG (colour type 3, bit depths 1 to 8, no interlace).

export interface IndexedPng { width: number; height: number; depth: number; colourType: number; interlace: number; palette: Rgb[]; indices: Uint8Array | null }
export function decodeIndexedPng(file: Buffer): IndexedPng {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let p = 8; let width = 0; let height = 0; let depth = 0; let colourType = 0; let interlace = 0;
  const palette: Rgb[] = []; const data: Buffer[] = [];
  while (p < file.length) {
    const len = file.readUInt32BE(p); const type = file.toString('latin1', p + 4, p + 8); const body = file.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; colourType = body[9]!; interlace = body[12]!; }
    else if (type === 'PLTE') for (let i = 0; i + 2 < body.length; i += 3) palette.push([body[i]!, body[i + 1]!, body[i + 2]!]);
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (colourType !== 3 || interlace !== 0 || ![1, 2, 4, 8].includes(depth)) return { width, height, depth, colourType, interlace, palette, indices: null };
  const stride = Math.ceil((width * depth) / 8);
  const raw = inflateSync(Buffer.concat(data));
  const indices = new Uint8Array(width * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= 1 ? line[i - 1]! : 0; const b = prev[i]!; const c = i >= 1 ? prev[i - 1]! : 0; const x = line[i]!;
      const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      line[i] = (filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : x + paeth) & 255;
    }
    for (let x = 0; x < width; x++) {
      const bit = x * depth; const byte = line[bit >> 3]!;
      indices[y * width + x] = depth === 8 ? byte : (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    }
    prev = line;
  }
  return { width, height, depth, colourType, interlace, palette, indices };
}

// ---------------------------------------------------------------------------------------------------
// Sound

/** The power of `hz` in `x[from, to)` (Goertzel). */
export function goertzel(x: Float32Array, from: number, to: number, hz: number, sr = SR): number {
  const w = (2 * Math.PI * hz) / sr; const c = 2 * Math.cos(w);
  let s1 = 0; let s2 = 0;
  for (let i = from; i < to; i++) { const s0 = x[i]! + c * s1 - s2; s2 = s1; s1 = s0; }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

// ---------------------------------------------------------------------------------------------------
// Budgets (docs/technical-design.md: Every task carries its own budgets; The reference Macs): five runs after warm-up,
// judged by the perf lane's own judgeLimit, with the one-minute load read at each run's start and end.

export interface Judged { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; limit: number; runs: number[]; margin?: number; reason?: string }
export async function judge(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<Judged> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as {
    fingerprint(): unknown; judgeLimit(a: { limit: number; runs: number[]; fingerprint: unknown; loads: { start: number; end: number }[] }): Judged;
  };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}
export const load1 = (): number => loadavg()[0]!;
export const CORES = cpus().length;
/** The 95th percentile (nearest rank) of `xs`. */
export function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)]!;
}

