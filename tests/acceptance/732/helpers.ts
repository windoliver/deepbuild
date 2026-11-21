// Test-side tools for the #732 acceptance tests: `deep-show` built once per Cargo feature set (#501's `useShow`) and
// driven by one JSON scenario on stdin (`deep-show run`), its `planted` key naming the wrong writers; the world the
// documents are shown in (the agent's tree, its record holding the verdict a status chip reads and the reading a bound
// value reads, as #162's and #169's suites have it); the fixture documents, made at test time; the `export` call with
// `video.codec: pptx` and the readers of what it answers (the receipt's `slides`) and of the file it writes (this
// suite's own Office Open XML reader, ooxml.ts); `eval` for the texts each stage draws and its text items' evaluated
// boxes; `still {marker}` exports for the stages' settled frames; LibreOffice, found on this Mac and run headless with
// a throwaway profile, rendering each slide to a 1920 × 1080 PNG; and the comparisons the criteria name (the
// export.fidelity floor outside boxes, the text boxes' runs, the receipt's pictures). Nothing here stands in for the
// writer, the export or LibreOffice: every value a test judges is read from what deep-show answers or writes, from the
// file it writes, or from LibreOffice's render of it. README: The surface under test.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { expect } from 'vitest';
import {
  FLICKS, REPO, blocked, decodePng, filesUnder, isObject, putEvidence, runShow, sha256, show, type Image, type JsonObject, type JsonValue,
} from '../501/helpers.ts';
import { onlySlide, readDeck, type Deck, type Shape } from './ooxml.ts';

export {
  FLICKS, FULL, REPO, TIMEOUT, arr, blocked, filesUnder, inconclusive, int, isObject, none, num, obj, referenceMacProblem, sha256, show, str, useShow,
  useTemp, type Image, type JsonObject, type JsonValue,
} from '../501/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #732.d05596c6',
  2: 'AC2 #732.3c7fee5e',
  3: 'AC3 #732.c0dd433b',
  4: 'AC4 #732.9492d8fd',
  5: 'AC5 #732.35428855',
  6: 'AC6 #732.a31af211',
  7: 'AC7 #732.87ae4836',
  8: 'AC8 #732.6a9b72a2',
  9: 'AC9 #732.b38a3ba1',
  10: 'AC10 #732.bbcc6582',
  11: 'AC11 #732.1b8af42a',
} as const;

/** The build with #157's test canvas module `test.guards` (its `test.device_loss@1 {frame}`), for criterion 9. */
export const GUARDS = 'full,test-export-guards';

/** The wrong writers the issue names, each chosen by the scenario's `planted` (README: The planted writers). */
export type Planted = 'pptx_title_as_picture' | 'pptx_drops_picture' | 'pptx_flattens_behind_text' | 'pptx_chip_as_shape' | 'pptx_receipt_lists_fewer';

// ---------------------------------------------------------------------------------------------------
// Time

/** Seconds as whole flicks. */
export const fl = (seconds: number): number => Math.round(seconds * FLICKS);
const lit = (seconds: number): string => `${seconds}s`;

// ---------------------------------------------------------------------------------------------------
// The world: your shell and an agent's tree (#162's and #169's), the agent's record holding the verdict the status chip
// reads and the reading the bound value reads. Every document is shown from the agent's tree, so its writer can read
// both handles.

const AGENT = { id: 'sess-732', thread: 'thread-732', name: 'Test agent: the deck', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 }, { pid: 4101, ppid: 4100, start: 1_100 }, { pid: 4102, ppid: 4101, start: 1_200 },
];
const AGENT_PEER: JsonObject = { pid: 4102, start: 1_200 };
/** The verdict the status chip is bound to, failed in the agent's record. */
export const VERDICT = 'verdict:01JB732V000000000000000001';
/** The reading the bound value shows, 42 as of 2026-11-12T09:30:00Z (ms since the epoch, as #169's world has it). */
export const READING = 'reading:01JB732R000000000000000001';
export const READING_VALUE = 42;
export const AS_OF = Date.UTC(2026, 10, 12, 9, 30, 0);
const RECORD: JsonObject = {
  [VERDICT]: { session: AGENT.id, state: 'fail' },
  [READING]: { session: AGENT.id, value: READING_VALUE, as_of: AS_OF },
};
const ulid = (k: number): string => `01JB732D${String(k).padStart(18, '0')}`;
/** The documents' IDs. */
export const DOC = { four: ulid(1), twin: ulid(2), chip: ulid(3), inset: ulid(4), named: ulid(5), twenty: ulid(6), lost: ulid(7) } as const;

/** One `deep-show run`: each document shown from the agent's tree, each on a panel of its own, then `calls`; the
 * replies to `calls`. Each document must be presented. */
export function showRun(bin: string, evidence: string, documents: [string, JsonObject][], calls: JsonObject[], what: string, planted?: Planted): JsonObject[] {
  const panels: JsonObject = {}; const docs: JsonObject = {};
  documents.forEach(([id], k) => {
    const panel = k === 0 ? 'main' : `side-${k}`;
    docs[id] = { panel };
    panels[panel] = { rect: k === 0 ? [0, 0, 1280, 720] : [0, 720, 640, 360] };
  });
  const shows = documents.map(([doc, document]): JsonObject => ({ call: 'deep show', peer: AGENT_PEER, doc, document: JSON.parse(JSON.stringify(document)) as JsonObject, include: ['issues'] }));
  const sc: JsonObject = {
    evidence, sessions: { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: { ...AGENT.process } } }, processes: PROCESSES, panels, docs,
    record: RECORD, ...(planted ? { planted } : {}), calls: [...shows, ...calls],
  };
  const label = planted ? `${what} (planted ${planted})` : what;
  const replies = runShow(bin, sc, label);
  documents.forEach(([id], k) => expect(replies[k]!['outcome'], `${label}: the document ${id} is presented: ${show(replies[k], 2000)}`).toBe('presented'));
  return replies.slice(documents.length);
}

// ---------------------------------------------------------------------------------------------------
// The look: the shipped clean look, named by asset (`look-732`), so the colours and families the tests expect are the
// ones the documents name. Criterion 8's look is the same with its body face recorded as one whose licence doesn't
// allow embedding (README: Fixtures).

const CLEAN = JSON.parse(readFileSync(join(REPO, 'crates', 'deep-canvas-marks', 'looks', 'clean.json'), 'utf8')) as JsonObject;
const CC0: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made at test time by the #732 acceptance tests.' };
interface LookAsset { id: string; bytes: Buffer; def: JsonObject }
function lookAsset(named: boolean): LookAsset {
  const def = JSON.parse(JSON.stringify(CLEAN)) as JsonObject;
  const id = named ? 'look-732-named' : 'look-732';
  def['id'] = id;
  if (named) {
    const fonts = def['fonts'] as JsonObject;
    fonts['body'] = { ...(fonts['body'] as JsonObject), license: 'LicenseRef-no-embedding', embed: false };
  }
  return { id, bytes: Buffer.from(`${JSON.stringify(def, null, 1)}\n`), def };
}
const LOOK = lookAsset(false);
/** A role's colour in the clean look's light palette, `#rrggbb`. */
export function roleColor(role: string): string {
  const roles = LOOK.def['roles'] as JsonObject; const palette = LOOK.def['palette'] as JsonObject;
  const name = roles[role];
  const hex = typeof name === 'string' ? palette[name] ?? name : undefined;
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}/i.test(hex)) throw Error(`harness: the clean look gives role ${role} no colour`);
  return hex.slice(0, 7).toLowerCase();
}
/** The family the look's font `name` sets text in. */
export function familyOf(name: string): string {
  const font = (LOOK.def['fonts'] as JsonObject)[name];
  if (!isObject(font) || typeof font['family'] !== 'string') throw Error(`harness: the clean look has no font ${name}`);
  return font['family'];
}
/** The look's nine status colours (its light status map), `#rrggbb`. */
export const STATUS_COLORS: Record<string, string> = Object.fromEntries(Object.entries(LOOK.def['status'] as JsonObject).map(([k, v]) => [k, String(v).slice(0, 7).toLowerCase()]));

// ---------------------------------------------------------------------------------------------------
// Documents (README: Fixtures). 1920 × 1080 u, so a document unit is a slide pixel; y down.

let order = 0;
const nextOrder = (): string => `a${String(order++).padStart(3, '0')}`;
const item = (id: string, kind: string, params: JsonObject, extra: JsonObject = {}): JsonObject => ({ id, kind, name: id, order: nextOrder(), params, ...extra });
const holdKeys = (target: string, keys: [number, number][]): JsonObject =>
  ({ target, type: 'f32', keys: Object.fromEntries(keys.map(([t, v], i) => [`k${String(i).padStart(2, '0')}`, { t: lit(t), value: v, interp: 'hold' }])) });
function envelope(evidence: string, id: string, title: string, items: JsonObject[], extra: JsonObject, look: LookAsset = LOOK): JsonObject {
  putEvidence(evidence, look.bytes);
  const assets = { [look.id]: { sha256: sha256(look.bytes), license: CC0 }, ...((extra['assets'] as JsonObject | undefined) ?? {}) };
  return {
    format: 1, id, profile: 'film', title, description: `${title}: a piece the #732 acceptance tests export as a deck.`, size: [1920, 1080], camera: 'cam',
    look: { asset: `${look.id}@1`, theme: 'light' }, ...extra, assets, items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
  };
}
const camera2d = (): JsonObject => item('cam', 'camera@1', { projection: 'orthographic', target: [960, 540, 0], view_width: 1920 });
const ground = (): JsonObject => item('back', 'rect@1', { box: [0, 0, 1920, 1080], paint: { fill: { role: 'ground' } } });

/** A text item as the tests read it back: its string (null for a bound value's), font role, colour role, and its
 * styled runs over grapheme indices. Its size, weight and box are read from `eval` at each stage. */
export interface TextSpec { id: string; text: string | null; font: string; role: string; runs: { from: number; to: number; weight?: number; role?: string; font?: string }[] }
function textItem(spec: TextSpec, size: number, weight: number, box: [number, number], pos: [number, number]): JsonObject {
  const runs = spec.runs.map((r) => ({ ...r }));
  return item(spec.id, 'text@1', {
    text: spec.text ?? '', font: spec.font, size, weight, box: { w: box[0], h: box[1] }, autosize: 'none', paint: { fill: { role: spec.role } }, ...(runs.length ? { runs } : {}),
  }, { at: { pos: [pos[0], pos[1], 0] } });
}

/** A stage marker of the pieces: its marker ID, time (s), name and notes. */
export interface Stage { marker: string; t: number; name: string; notes: string }

/** The four-stage piece (criteria 1, 2, 4, 6, 7, 9 and 11): 1920 × 1080 at 30 fps for 8 s, stages at 0, 2, 4 and 6 s,
 * each with notes. Native shapes: the ground, a rounded card with a stroke, a circle, a line and a path with a
 * linear gradient. Pictures: an image (`checker`, every stage) and a noise-filled panel (`grain_panel`, opacity 0 at the
 * first stage and 1 from the second, so the first slide it shows on is the second). Text: the title `tide_title` (bold,
 * moving right at each stage), the lede with styled runs (a bold word, a word in the accent role, a word in the mono
 * face) and the bound value's text `price` (the reading, 42). */
export const FOUR = {
  stages: [
    { marker: 's1', t: 0, name: 'Harbour', notes: 'Open on the harbour at dawn.' },
    { marker: 's2', t: 2, name: 'Texture', notes: 'Point at the grain of the rock.' },
    { marker: 's3', t: 4, name: 'Cliff', notes: 'Walk along the cliff path slowly.' },
    { marker: 's4', t: 6, name: 'Close', notes: 'Close with the tide coming in.' },
  ] as Stage[],
  title: 'Stone Tide',
  /** The title's string after criterion 7's edit: the same letters, so no face needs a glyph the deck lacks. */
  edited: 'Tide Stone',
  /** The items each stage draws as pictures (README: what becomes a picture), by stage marker. */
  pictures: { s1: ['checker'], s2: ['checker', 'grain_panel'], s3: ['checker', 'grain_panel'], s4: ['checker', 'grain_panel'] } as Record<string, string[]>,
  /** The bound value's ID and its item. */
  bound: { id: 'price_now', item: 'price' },
  /** The rate's frame index of stage 3, where criterion 9's device is lost. */
  lostFrame: 120,
} as const;
export const FOUR_TEXTS: TextSpec[] = [
  { id: 'tide_title', text: FOUR.title, font: 'body', role: 'ink', runs: [] },
  { id: 'lede', text: 'Waves shape the cliff by night', font: 'body', role: 'ink', runs: [{ from: 6, to: 11, weight: 700 }, { from: 16, to: 21, role: 'accent' }, { from: 25, to: 30, font: 'mono' }] },
  { id: 'price', text: null, font: 'body', role: 'ink', runs: [] },
];
/** A PNG of RGB rows. */
export function encodePng(img: Image): Buffer {
  const raw = Buffer.alloc((img.width * 3 + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    const row = y * (img.width * 3 + 1);
    for (let x = 0; x < img.width; x++) for (let c = 0; c < 3; c++) raw[row + 1 + x * 3 + c] = img.rgba[(y * img.width + x) * 4 + c]!;
  }
  const chunk = (type: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32of(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(img.width, 0); ihdr.writeUInt32BE(img.height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32of = (b: Buffer): number => { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** The image `checker` shows: a 360 × 240 checker of two colours in 60 u squares, made here (CC0). */
const photoPng = (): Buffer => {
  const rgba = new Uint8Array(360 * 240 * 4);
  for (let y = 0; y < 240; y++) for (let x = 0; x < 360; x++) rgba.set((Math.floor(x / 60) + Math.floor(y / 60)) % 2 ? [40, 110, 200, 255] : [240, 200, 60, 255], (y * 360 + x) * 4);
  return encodePng({ width: 360, height: 240, rgba });
};
export interface FourOptions { id?: string; title?: string; loss?: boolean }
export function fourStages(evidence: string, o: FourOptions = {}): JsonObject {
  order = 0;
  const photo = putEvidence(evidence, photoPng());
  const [title, lede, price] = FOUR_TEXTS as [TextSpec, TextSpec, TextSpec];
  const items = [
    camera2d(), ground(),
    item('card', 'rect@1', { box: [80, 520, 760, 380], radius: 32, paint: { fill: { role: 'raised' }, stroke: { role: 'divider', width: 4 } } }),
    item('dot', 'circle@1', { center: [1600, 260], r: 120, paint: { fill: { role: 'accent' } } }),
    item('rule', 'path@1', { d: 'M 120 440 L 1800 440', paint: { stroke: { role: 'ink', width: 6 } } }),
    item('checker', 'image@1', { asset: photo, box: [900, 540, 360, 240], fit: 'fill', alt: 'A checker of two colours' }),
    item('wave', 'path@1', { d: 'M 900 1000 C 1100 880 1300 1080 1500 960 L 1500 1040 L 900 1040 Z', paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'accent' }, { at: 1, role: 'ink' }] } } } }),
    item('grain_panel', 'rect@1', { box: [1340, 540, 480, 320], paint: { fill: { noise: { kind: 'fractal', scale: 100, stops: [{ at: 0, role: 'accent' }, { at: 1, role: 'ink' }], seed: 7 } } } }),
    textItem({ ...title, text: o.title ?? FOUR.title }, 96, 700, [1100, 140], [120, 80]),
    textItem(lede, 48, 400, [1400, 90], [120, 260]),
    textItem(price, 64, 700, [400, 100], [120, 940]),
    ...(o.loss ? [item('loss', 'test.device_loss@1', { frame: FOUR.lostFrame })] : []),
  ];
  return envelope(evidence, o.id ?? 'four-stages', 'Four stages', items, {
    transport: { span: '8s', frame_rate: [30, 1] },
    ...(o.loss ? { requires: { modules: { 'test.guards': '^1' } } } : {}),
    assets: { photo: { sha256: photo, license: CC0 } },
    bound_values: { [FOUR.bound.id]: { target: `items/${FOUR.bound.item}/params/text`, source: READING } },
    markers: Object.fromEntries(FOUR.stages.map((s) => [s.marker, { kind: 'stage', name: s.name, t: lit(s.t), notes: s.notes }])),
    channels: {
      show_grain: holdKeys('items/grain_panel/adjust/opacity', [[0, 0], [2, 1]]),
      title_x: holdKeys('items/tide_title/at/pos/0', [[0, 120], [2, 200], [4, 280], [6, 360]]),
    },
  });
}

/** The status piece (criterion 5): one stage; a panel, its label and the chip `gate_chip`, a rect whose fill is bound to
 * the failed verdict (drawn in the fail colour with its glyph and word inside it, and the legend). */
export const CHIP = { item: 'gate_chip', box: [180, 520, 320, 96] as [number, number, number, number], stage: { marker: 's1', t: 0, name: 'Gate', notes: 'The gate before the release.' } as Stage } as const;
export function chipPiece(evidence: string): JsonObject {
  order = 0;
  return envelope(evidence, 'status-chip', 'A status chip', [
    camera2d(), ground(),
    item('panel', 'rect@1', { box: [120, 300, 900, 400], radius: 24, paint: { fill: { role: 'raised' }, stroke: { role: 'divider', width: 4 } } }),
    textItem({ id: 'label', text: 'Release gate', font: 'body', role: 'ink', runs: [] }, 64, 700, [800, 100], [180, 360]),
    item(CHIP.item, 'rect@1', { box: [...CHIP.box] }),
  ], {
    transport: { span: '2s', frame_rate: [30, 1] },
    status_bindings: { gate_state: { target: `items/${CHIP.item}/params/paint/fill`, source: VERDICT } },
    markers: { [CHIP.stage.marker]: { kind: 'stage', name: CHIP.stage.name, t: lit(CHIP.stage.t), notes: CHIP.stage.notes } },
  });
}

/** The inset piece (criterion 3): one stage that draws, in this order, a 3D display whose screen carries an inset (the
 * 3D layer draws first), the caption, then a group running the shipped blur pass over a translucent band that lies
 * across both. */
export const INSET = { caption: 'wall_caption', captionText: 'The harbour wall at low tide', pass: 'veil_pass', band: 'veil_band', inset: 'screen-inset', display: 'screen' } as const;
const SKY: JsonObject = { top: [0.9, 0.92, 0.95, 1], low: [0.9, 0.92, 0.95, 1], ambient_top: [0.6, 0.6, 0.6], ambient_low: [0.6, 0.6, 0.6] };
function display(y: number): JsonObject[] {
  return [
    item('sky', 'sky@1', { ...SKY }),
    item('white-mat', 'material@1', { base_color: [0.8, 0.8, 0.8, 1], unlit: true, double_sided: true }),
    item(INSET.display, 'display@1', { size: [1.6, 1.0], bezel: 0.04 }, { at: { pos: [0, y, 0] }, material: 'white-mat' }),
    item(INSET.inset, 'inset@1', {
      face: `${INSET.display}#screen`, size: [1.52, 0.92], px_per_unit: 400, overflow: 'mask',
      content: {
        ground: { kind: 'rect@1', order: 'a0', params: { box: [0, 0, 608, 368], paint: { fill: { role: 'accent' } } } },
        bar: { kind: 'rect@1', order: 'a1', params: { box: [60, 120, 300, 80], paint: { fill: { role: 'ink' } } } },
      },
    }),
  ];
}
const camera3d = (): JsonObject => item('cam', 'camera@1', { projection: 'perspective', position: [0, 0, 3], target: [0, 0, 0], fov: 40 });
const MODULES3D: JsonObject = { modules: { scene3d: '^1', marks2d: '^1', effects: '^1' } };
export function insetPiece(evidence: string): JsonObject {
  order = 0;
  return envelope(evidence, 'inset-caption-pass', 'An inset, a caption and a pass', [
    camera3d(), ...display(0),
    textItem({ id: INSET.caption, text: INSET.captionText, font: 'body', role: 'ink', runs: [] }, 56, 700, [1300, 90], [300, 900]),
    item(INSET.pass, 'group@1', { passes: [{ op: 'blur@1', params: { radius: 12 } }] }),
    item(INSET.band, 'rect@1', { box: [200, 820, 1500, 220], paint: { fill: { role: 'accent' }, opacity: 0.35 } }, { parent: INSET.pass }),
  ], {
    requires: MODULES3D, transport: { span: '2s', frame_rate: [30, 1] },
    markers: { s1: { kind: 'stage', name: 'Wall', t: '0s', notes: 'Point at the wall behind the caption.' } },
  });
}

/** The named-font piece (criterion 8): one stage, one text in the body face, under the look whose body face is recorded
 * with a licence that doesn't allow embedding (`embed: false`). */
export const NAMED = { family: 'Inter', text: 'Harbour lights' } as const;
export function namedFontPiece(evidence: string): JsonObject {
  order = 0;
  return envelope(evidence, 'named-font', 'A face that is only named', [
    camera2d(), ground(),
    textItem({ id: 'name', text: NAMED.text, font: 'body', role: 'ink', runs: [] }, 72, 700, [1200, 120], [120, 120]),
    item('bar', 'rect@1', { box: [120, 320, 900, 40], paint: { fill: { role: 'accent' } } }),
  ], { transport: { span: '2s', frame_rate: [30, 1] }, markers: { s1: { kind: 'stage', name: 'Lights', t: '0s', notes: 'Name the lights one by one.' } } }, lookAsset(true));
}

/** The twenty-stage piece (criterion 10): 20 stages 0.5 s apart over 3D; the display with its inset is in view only at
 * stages 7 and 14 (the two 3D stages) and far above the camera at the others, where a heading and a card that moves at
 * each stage are what shows. */
export const TWENTY = { stages: 20, step: 0.5, threeD: [7, 14] } as const;
export function twentyStages(evidence: string): JsonObject {
  order = 0;
  const letters = (k: number): string => String.fromCharCode(64 + k);
  const markers: JsonObject = {};
  for (let k = 1; k <= TWENTY.stages; k++) markers[`s${k}`] = { kind: 'stage', name: `Stop ${letters(k)}`, t: lit((k - 1) * TWENTY.step), notes: `Talk through stop ${letters(k)} here.` };
  const at = (k: number): number => (k - 1) * TWENTY.step;
  return envelope(evidence, 'twenty-stages', 'Twenty stages', [
    camera3d(), ...display(20),
    item('card', 'rect@1', { box: [0, 760, 360, 200], radius: 24, paint: { fill: { role: 'muted' } } }),
    textItem({ id: 'heading', text: 'Field walk', font: 'body', role: 'ink', runs: [] }, 72, 700, [900, 110], [120, 80]),
  ], {
    requires: MODULES3D, transport: { span: lit(TWENTY.stages * TWENTY.step), frame_rate: [30, 1] }, markers,
    channels: {
      card_x: holdKeys('items/card/at/pos/0', Array.from({ length: TWENTY.stages }, (_, i): [number, number] => [at(i + 1), 80 + 70 * i])),
      display_y: holdKeys(`items/${INSET.display}/at/pos/1`, Array.from({ length: TWENTY.stages }, (_, i): [number, number] => [at(i + 1), (TWENTY.threeD as readonly number[]).includes(i + 1) ? 0 : 20])),
    },
  });
}

// ---------------------------------------------------------------------------------------------------
// The export (README: `export` with `video.codec: pptx`)

/** The pptx export of `doc` to `out`, one slide per stage, at 1920 × 1080, with notes and the default fonts rule. */
export const pptxExport = (doc: string, out: string, pptx: JsonObject = {}): JsonObject =>
  ({ call: 'export', doc, out, range: 'stages', video: { codec: 'pptx' }, pptx: { slide: [1920, 1080], notes: true, fonts: 'embed_allowed', ...pptx } });
/** A `still {marker}` export (#501, #507): the stage's settled frame, as a PNG in the folder `out`. */
export const stillExport = (doc: string, out: string, marker: string): JsonObject =>
  ({ call: 'export', doc, out, range: { still: { marker } }, video: { codec: 'png_seq' } });
/** `eval` at a stage's time: the texts the frame draws, and each text item's evaluated position, box, size and weight. */
export const stageEval = (doc: string, t: number, ids: string[]): JsonObject => ({
  call: 'eval', doc, t: fl(t), texts: true,
  paths: ids.flatMap((id) => ['at/pos/0', 'at/pos/1', 'params/box/w', 'params/box/h', 'params/size', 'params/weight'].map((f) => `items/${id}/${f}`)),
});

/** One slide's entry in the receipt's `slides` (the issue's shape). */
export interface ReceiptSlide { stage: JsonValue; native: string[]; pictures: { items: string[]; why: JsonValue }[]; fonts: { family: string; embedded: boolean }[] }
export interface Delivered { receipt: JsonObject; slides: ReceiptSlide[] }
/** A delivered pptx export: its receipt and its `slides`, each read strictly. The base's answer for a codec no target
 * writes (`no_encode_tool`) is missing behaviour and fails as such; any other BLOCKED answer is BLOCKED, never a pass. */
export function deliveredOf(reply: JsonObject | undefined, what: string): Delivered {
  const r = reply ?? {};
  if (r['outcome'] === 'blocked' && r['code'] === 'no_encode_tool') expect.fail(`${what}: the export doesn't write pptx: no export.target@1 entry names it, so it answers ${show(r, 600)}`);
  if (r['outcome'] === 'blocked') blocked(`${what}: the export is blocked (a fidelity reader it needs is missing?): ${show(r, 1500)}`);
  expect(r['outcome'], `${what} is exported: ${show(r, 2000)}`).toBe('exported');
  const receipt = r['receipt'];
  expect(isObject(receipt), `${what}: the reply has a receipt`).toBe(true);
  const list = (receipt as JsonObject)['slides'];
  expect(Array.isArray(list), `${what}: receipt.slides is a list: ${show(list ?? null, 800)}`).toBe(true);
  const strings = (v: JsonValue | undefined): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
  const slides = (list as JsonValue[]).map((s, i): ReceiptSlide => {
    const o = isObject(s) ? s : {};
    const pics = o['pictures']; const fonts = o['fonts'];
    expect(isObject(s) && 'stage' in o && strings(o['native']) && Array.isArray(pics) && Array.isArray(fonts),
      `${what}: receipt.slides[${i}] is {stage, native: [item], pictures, fonts}: ${show(s ?? null, 800)}`).toBe(true);
    const pictures = (pics as JsonValue[]).map((p, j) => {
      expect(isObject(p) && strings(p['items']) && 'why' in p, `${what}: receipt.slides[${i}].pictures[${j}] is {items: [item], why}: ${show(p ?? null, 400)}`).toBe(true);
      return { items: (p as JsonObject)['items'] as string[], why: (p as JsonObject)['why']! };
    });
    const faces = (fonts as JsonValue[]).map((f, j) => {
      expect(isObject(f) && typeof f['family'] === 'string' && typeof f['embedded'] === 'boolean', `${what}: receipt.slides[${i}].fonts[${j}] is {family, embedded: bool}: ${show(f ?? null, 400)}`).toBe(true);
      return { family: (f as JsonObject)['family'] as string, embedded: (f as JsonObject)['embedded'] as boolean };
    });
    return { stage: o['stage']!, native: o['native'] as string[], pictures, fonts: faces };
  });
  return { receipt: receipt as JsonObject, slides };
}
/** Whether a receipt's `stage` is the stage marker `marker`, the `n`th: its marker ID or its number. */
export const isStage = (v: JsonValue, marker: string, n: number): boolean => v === marker || v === n;
/** Whether a picture's `why` says something: a non-empty string, or a non-empty list of them. */
export const saysWhy = (why: JsonValue): boolean =>
  (typeof why === 'string' && why.trim() !== '') || (Array.isArray(why) && why.length > 0 && why.every((w) => typeof w === 'string' && w.trim() !== ''));

/** The file a delivered export wrote, read by this suite's reader. */
export function deckAt(path: string, what: string): Deck {
  expect(existsSync(path), `${what}: the export wrote ${path}`).toBe(true);
  try { return readDeck(readFileSync(path)); } catch (e) { return expect.fail(`${what}: ${path} isn't a deck this reader reads: ${(e as Error).message}`); }
}
/** The one PNG a still export wrote into the folder `out`. */
export function stillOf(out: string, what: string): Image {
  expect(existsSync(out), `${what}: the still export wrote ${out}`).toBe(true);
  const pngs = readdirSync(out).filter((f) => f.toLowerCase().endsWith('.png')).sort();
  expect(pngs.length, `${what}: one PNG at ${out}`).toBe(1);
  return decodePng(readFileSync(join(out, pngs[0]!)));
}

/** A planted writer's export: refused or failed by the export's own fidelity check (not delivered, nothing left beside
 * `out`, and its answer names what `names` asks), or delivered and failed by the criterion's own judge, with a failure
 * naming it. README: The planted writers. */
export function plantedFails(reply: JsonObject | undefined, dir: string, out: string, judge: (deck: Deck) => string[], names: (s: string) => boolean, what: string): void {
  const r = reply ?? {};
  if (r['outcome'] === 'blocked' && r['code'] !== 'no_encode_tool') blocked(`${what}: the export is blocked: ${show(r, 1500)}`);
  if (r['outcome'] === 'exported') {
    const failures = judge(deckAt(out, what));
    expect(failures.length, `${what}: the criterion's judge fails the planted writer's deck`).toBeGreaterThan(0);
    expect(failures.some(names), `${what}: a failure names what the criterion says; the failures:\n  ${failures.slice(0, 12).join('\n  ')}`).toBe(true);
    return;
  }
  expect(r['outcome'] === 'failed' || r['outcome'] === 'refused' || r['outcome'] === 'stopped', `${what}: the planted writer's export is refused or failed by its own check: ${show(r, 1500)}`).toBe(true);
  expect(filesUnder(dir).map(([p]) => p), `${what}: nothing is left beside out, at its name or a temporary one`).toEqual([]);
  expect(names(JSON.stringify(r)), `${what}: the export's answer names what the criterion says: ${show(r, 2000)}`).toBe(true);
}
/** Whether a text names slide `n` (1-based) of a deck whose stages are `stages`: `slide n`, `"slide": n`, or its marker. */
export const namesSlide = (s: string, n: number, stages: readonly Stage[]): boolean =>
  new RegExp(`\\bslide ${n}\\b|"slide":\\s*${n}\\b|"${stages[n - 1]?.marker ?? '\u0000'}"|\\bstage ${n}\\b`, 'i').test(s);
/** Whether a text names the item `id`. */
export const namesItem = (s: string, id: string): boolean => new RegExp(`\`${id}\`|"${id}"|\\b${id}\\b`).test(s);

// ---------------------------------------------------------------------------------------------------
// Slides, pixels and points: a document unit is a slide pixel (the pieces are 1920 × 1080 u), and the slide is the
// export's 1920 × 1080 px, so its EMU per pixel is `p:sldSz`'s width over 1920 (README: readings).

export const SLIDE_PX: [number, number] = [1920, 1080];
const EMU_PER_PT = 12_700;
/** EMU per slide pixel, after checking the slide is 16:9 (within one pixel). */
export function emuPerPx(deck: Deck, what: string): number {
  const [cx, cy] = deck.size;
  expect(cx > 0 && Math.abs(cy - (cx * SLIDE_PX[1]) / SLIDE_PX[0]) <= cx / SLIDE_PX[0], `${what}: the slide is 16:9 (p:sldSz ${cx} × ${cy} EMU)`).toBe(true);
  return cx / SLIDE_PX[0];
}
export const ptPerPx = (emu: number): number => emu / EMU_PER_PT;
/** A box in EMU as slide pixels [x0, y0, x1, y1]. */
export const pxBox = (b: [number, number, number, number], emu: number): Box => [b[0] / emu, b[1] / emu, (b[0] + b[2]) / emu, (b[1] + b[3]) / emu];
export type Box = [number, number, number, number];
export const grow = (b: Box, by: number): Box => [b[0] - by, b[1] - by, b[2] + by, b[3] + by];
/** The boxes of a slide's text boxes, in slide pixels. */
export const textBoxes = (shapes: Shape[], emu: number): Box[] => shapes.filter((s) => s.kind === 'text' && s.box).map((s) => pxBox(s.box!, emu));

/** A text item as a stage draws it: its string, and its evaluated box (u), size and weight. */
export interface Drawn { id: string; text: string; box: [number, number, number, number]; size: number; weight: number }
/** The text items an `eval` reply says the frame draws (its `texts`), among `ids`, with their evaluated fields. */
export function drawnTexts(reply: JsonObject | undefined, ids: string[], what: string): Map<string, Drawn> {
  const r = reply ?? {};
  expect(r['outcome'], `${what}: eval answers evaluated: ${show(r, 800)}`).toBe('evaluated');
  const texts = r['texts']; const values = r['values'];
  expect(isObject(texts) && isObject(values), `${what}: eval's texts and values: ${show(r, 800)}`).toBe(true);
  const out = new Map<string, Drawn>();
  for (const id of ids) {
    const text = (texts as JsonObject)[id];
    if (typeof text !== 'string') continue;
    const v = (f: string, fallback?: number): number => {
      const x = (values as JsonObject)[`items/${id}/${f}`];
      if (x === null && fallback !== undefined) return fallback;
      expect(typeof x === 'number' && Number.isFinite(x), `${what}: eval reads items/${id}/${f} as a number, got ${show(x ?? null)}`).toBe(true);
      return x as number;
    };
    out.set(id, { id, text, box: [v('at/pos/0'), v('at/pos/1'), v('params/box/w'), v('params/box/h')], size: v('params/size', 13), weight: v('params/weight', 400) });
  }
  return out;
}

/** What one grapheme of a text item should be in its text box: family, size (pt), bold and colour. */
interface Expected { family: string; size: number; bold: boolean; color: string }
function expectedAt(spec: TextSpec, drawn: Drawn, i: number, ptPx: number): Expected {
  let weight = drawn.weight; let role = spec.role; let font = spec.font;
  for (const r of spec.runs) if (i >= r.from && i < r.to) { weight = r.weight ?? weight; role = r.role ?? role; font = r.font ?? font; }
  return { family: familyOf(font), size: drawn.size * ptPx, bold: weight >= 600, color: roleColor(role) };
}
const near = (a: string | null, b: string, by: number): boolean =>
  a !== null && [1, 3, 5].every((k) => Math.abs(parseInt(a.slice(k, k + 2), 16) - parseInt(b.slice(k, k + 2), 16)) <= by);
/** Criterion 1's judge on one slide: one text box per text item the stage draws, holding its string, at its evaluated box
 * within 0.5 pt, each grapheme in its family, size, weight and role colour; and no other text box. Each failure names
 * the slide and the item. */
export function textBoxFailures(slideN: number, shapes: Shape[], drawn: Map<string, Drawn>, specs: TextSpec[], emu: number): string[] {
  const out: string[] = [];
  const ptPx = ptPerPx(emu);
  const texts = shapes.filter((s) => s.kind === 'text');
  const used = new Set<Shape>();
  for (const d of drawn.values()) {
    const spec = specs.find((s) => s.id === d.id);
    if (!spec) continue;
    const where = `slide ${slideN}: the text item \`${d.id}\` (${JSON.stringify(d.text)})`;
    const boxes = texts.filter((s) => s.text === d.text);
    if (boxes.length !== 1) { out.push(`${where} is in ${boxes.length} text boxes, not one (the slide's text boxes say ${JSON.stringify(texts.map((t) => t.text))})`); continue; }
    const box = boxes[0]!; used.add(box);
    if (!box.box) out.push(`${where}: its text box has no a:xfrm of its own`);
    else {
      const got = box.box.map((v) => v / EMU_PER_PT);
      const want = [d.box[0], d.box[1], d.box[2], d.box[3]].map((v) => v * ptPx);
      const edges = [[got[0]!, want[0]!], [got[1]!, want[1]!], [got[0]! + got[2]!, want[0]! + want[2]!], [got[1]! + got[3]!, want[1]! + want[3]!]];
      if (edges.some(([g, w]) => Math.abs(g! - w!) > 0.5)) out.push(`${where}: its text box is [${got.map((v) => v.toFixed(2)).join(', ')}] pt, not within 0.5 pt of the evaluated box [${want.map((v) => v.toFixed(2)).join(', ')}] pt`);
    }
    const chars: { ch: string; run: (typeof box.runs)[number] }[] = box.runs.flatMap((run) => [...run.text].map((ch) => ({ ch, run })));
    const seen = new Set<string>();
    chars.forEach(({ ch, run }, i) => {
      if (/\s/.test(ch)) return;
      const want = expectedAt(spec, d, i, ptPx);
      const miss = (what: string, got: JsonValue, w: JsonValue): void => {
        if (seen.has(what)) return;
        seen.add(what);
        out.push(`${where}: ${JSON.stringify(ch)} (grapheme ${i}) is ${what} ${JSON.stringify(got)}, not ${JSON.stringify(w)}`);
      };
      if ((run.family ?? '').toLowerCase() !== want.family.toLowerCase()) miss('in the family', run.family, want.family);
      if (run.size === null || Math.abs(run.size - want.size) > 0.01) miss('at the size (pt)', run.size, Number(want.size.toFixed(2)));
      if (run.bold !== want.bold) miss('bold', run.bold, want.bold);
      if (!near(run.color, want.color, 1)) miss('in the colour', run.color, want.color);
    });
  }
  for (const t of texts) if (!used.has(t)) out.push(`slide ${slideN}: a text box says ${JSON.stringify(t.text)}, which no text item the stage draws says`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// LibreOffice: found on this Mac (Homebrew's cask) or on PATH, run headless with a throwaway profile; each slide is
// rendered by LibreOffice's own PNG export of a copy of the deck that lists only that slide, at 1920 × 1080 px.

const SOFFICE = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
const PNG_FILTER = `png:impress_png_Export:${JSON.stringify({ PixelWidth: { type: 'long', value: String(SLIDE_PX[0]) }, PixelHeight: { type: 'long', value: String(SLIDE_PX[1]) } })}`;
let found: { soffice: string; version: string } | null | undefined;
/** LibreOffice, or BLOCKED with the one unblock line. Its version is logged. */
export function office(): { soffice: string; version: string } {
  if (found === undefined) {
    const onPath = (process.env['PATH'] ?? '').split(delimiter).flatMap((d) => ['soffice', 'libreoffice'].map((n) => join(d, n)));
    const soffice = [SOFFICE, ...onPath].find((p) => p && existsSync(p));
    if (!soffice) found = null;
    else {
      const profile = mkdtempSync(join(tmpdir(), 'deep-732-lo-'));
      try {
        const v = spawnSync(soffice, [`-env:UserInstallation=${pathToFileURL(profile).href}`, '--headless', '--version'], { encoding: 'utf8', timeout: 300_000, killSignal: 'SIGKILL' });
        found = { soffice, version: `${v.stdout ?? ''}`.split('\n').find((l) => /LibreOffice/i.test(l))?.trim() ?? `unknown (${(v.stderr ?? '').trim().slice(0, 200)})` };
      } finally { rmSync(profile, { recursive: true, force: true }); }
    }
  }
  if (!found) return expect.fail(`BLOCKED: the slides are rendered by LibreOffice, which isn't at ${SOFFICE} or on PATH (soffice, libreoffice); this is not a pass.\nUnblock: brew install --cask libreoffice`);
  return found;
}
/** Slides `ns` of the deck, each rendered by LibreOffice to a 1920 × 1080 picture. */
export function renderSlides(deck: Deck, ns: number[], what: string): Map<number, Image> {
  const lo = office();
  console.log(`${what}: rendered by ${lo.version} (${lo.soffice})`);
  const dir = mkdtempSync(join(tmpdir(), 'deep-732-render-'));
  try {
    const files = ns.map((n) => { const f = join(dir, `slide-${n}.pptx`); writeFileSync(f, onlySlide(deck, n)); return f; });
    const outdir = join(dir, 'png');
    mkdirSync(outdir);
    const args = [`-env:UserInstallation=${pathToFileURL(join(dir, 'profile')).href}`, '--headless', '--invisible', '--nologo', '--norestore', '--nolockcheck', '--convert-to', PNG_FILTER, '--outdir', outdir, ...files];
    const r = spawnSync(lo.soffice, args, { encoding: 'utf8', timeout: 900_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
    const said = `${(r.stdout ?? '').slice(-1500)} ${(r.stderr ?? '').slice(-1500)}`;
    expect(r.error?.message ?? '', `${what}: LibreOffice ran: ${said}`).toBe('');
    expect(r.status, `${what}: LibreOffice exits 0: ${said}`).toBe(0);
    const out = new Map<number, Image>();
    for (const n of ns) {
      const png = join(outdir, `slide-${n}.png`);
      expect(existsSync(png), `${what}: LibreOffice rendered slide ${n}: ${said}`).toBe(true);
      const img = decodeAnyPng(readFileSync(png));
      expect([img.width, img.height], `${what}: LibreOffice rendered slide ${n} at 1920 × 1080`).toEqual(SLIDE_PX);
      out.set(n, img);
    }
    return out;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** A PNG of 8-bit grey, grey and alpha, RGB, palette or RGBA, not interlaced, as RGBA rows. */
export function decodeAnyPng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let p = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  let palette: Buffer = Buffer.alloc(0); let trns: Buffer = Buffer.alloc(0);
  const data: Buffer[] = [];
  while (p < file.length) {
    const len = file.readUInt32BE(p); const type = file.toString('latin1', p + 4, p + 8); const body = file.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'PLTE') palette = body; else if (type === 'tRNS') trns = body; else if (type === 'IDAT') data.push(body); else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  if (depth !== 8 || ch === undefined || interlace !== 0) throw Error(`PNG is depth ${depth}, colour type ${color}, interlace ${interlace}`);
  const stride = width * ch; const raw = inflateSync(Buffer.concat(data)); const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!; const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch]! : 0; const b = prev[i]!; const c = i >= ch ? prev[i - ch]! : 0;
      const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c);
      line[i] = (line[i]! + (f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0)) & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4; const s = x * ch;
      if (color === 3) { const k = line[s]!; rgba.set([palette[k * 3] ?? 0, palette[k * 3 + 1] ?? 0, palette[k * 3 + 2] ?? 0, trns[k] ?? 255], o); }
      else if (ch <= 2) rgba.set([line[s]!, line[s]!, line[s]!, ch === 2 ? line[s + 1]! : 255], o);
      else rgba.set([line[s]!, line[s + 1]!, line[s + 2]!, ch === 4 ? line[s + 3]! : 255], o);
    }
    prev = line;
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------------------------------
// Comparisons

/** export.fidelity's floor at the default quality, standard: PSNR-Y 40 dB, or SSIM 0.98 (Check input: export kinds). */
export const FLOOR = { psnr: 40, ssim: 0.98 } as const;
export interface Fidelity { psnr: number; ssim: number; pixels: number }
export const meets = (f: Fidelity): boolean => f.psnr >= FLOOR.psnr || f.ssim >= FLOOR.ssim;
/** BT.709 luma of a pixel's encoded values, over white where it isn't opaque. */
const lumaAt = (img: Image, i: number): number => {
  const a = img.rgba[i + 3]! / 255;
  const c = (k: number): number => img.rgba[i + k]! * a + 255 * (1 - a);
  return 0.2126 * c(0) + 0.7152 * c(1) + 0.0722 * c(2);
};
/** Two pictures of one size compared on luma over the pixels inside `within` (the whole picture when null) and outside
 * every box of `skip` (a pixel counts by its centre): PSNR-Y, and the mean SSIM of 8 × 8 windows 4 apart whose centre
 * counts, as export.fidelity's floor reads them (the export's own comparison, deep-show's export/lottie.rs `compare`). */
export function fidelity(a: Image, b: Image, skip: Box[], within: Box | null = null): Fidelity {
  expect([b.width, b.height], 'the two pictures compared are one size').toEqual([a.width, a.height]);
  const { width: w, height: h } = a;
  const counts = (x: number, y: number): boolean => {
    const cx = x + 0.5; const cy = y + 0.5;
    if (within && !(cx >= within[0] && cx <= within[2] && cy >= within[1] && cy <= within[3])) return false;
    return !skip.some((s) => cx >= s[0] && cx <= s[2] && cy >= s[1] && cy <= s[3]);
  };
  const la = new Float64Array(w * h); const lb = new Float64Array(w * h); const on = new Uint8Array(w * h);
  let sum = 0; let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    la[i] = lumaAt(a, i * 4);
    on[i] = counts(x, y) ? 1 : 0;
    lb[i] = on[i] ? lumaAt(b, i * 4) : la[i]!;
    if (on[i]) { sum += (la[i]! - lb[i]!) ** 2; n++; }
  }
  const psnr = n === 0 || sum === 0 ? Infinity : 10 * Math.log10((255 * 255) / (sum / n));
  const c1 = (0.01 * 255) ** 2; const c2 = (0.03 * 255) ** 2;
  let total = 0; let windows = 0;
  for (let y = 0; y + 8 <= h; y += 4) for (let x = 0; x + 8 <= w; x += 4) {
    if (!on[(y + 4) * w + x + 4]) continue;
    let ma = 0; let mb = 0;
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { ma += la[(y + v) * w + x + u]!; mb += lb[(y + v) * w + x + u]!; }
    ma /= 64; mb /= 64;
    let va = 0; let vb = 0; let cov = 0;
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { const da = la[(y + v) * w + x + u]! - ma; const db = lb[(y + v) * w + x + u]! - mb; va += da * da; vb += db * db; cov += da * db; }
    va /= 63; vb /= 63; cov /= 63;
    total += ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
    windows++;
  }
  return { psnr, ssim: windows === 0 ? 1 : total / windows, pixels: n };
}
export const shown = (f: Fidelity): string => `PSNR-Y ${Number.isFinite(f.psnr) ? f.psnr.toFixed(2) : 'inf'} dB, SSIM ${f.ssim.toFixed(4)} over ${f.pixels} px (floor ${FLOOR.psnr} dB or ${FLOOR.ssim})`;
/** How many pixels of two pictures of one size differ, `inside` or outside `box` (a pixel counts by its centre). */
export function differing(a: Image, b: Image, box: Box, inside: boolean): number {
  expect([b.width, b.height], 'the two pictures compared are one size').toEqual([a.width, a.height]);
  let n = 0;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const cx = x + 0.5; const cy = y + 0.5;
    if ((cx >= box[0] && cx <= box[2] && cy >= box[1] && cy <= box[3]) !== inside) continue;
    const i = (y * a.width + x) * 4;
    if (a.rgba[i] !== b.rgba[i] || a.rgba[i + 1] !== b.rgba[i + 1] || a.rgba[i + 2] !== b.rgba[i + 2] || a.rgba[i + 3] !== b.rgba[i + 3]) n++;
  }
  return n;
}
/** Two pictures side by side on a grey gutter: what the taste call is shown. */
export function beside(left: Image, right: Image, gap = 16): Image {
  const width = left.width + gap + right.width; const height = Math.max(left.height, right.height);
  const rgba = new Uint8Array(width * height * 4).fill(128);
  for (const [img, x0] of [[left, 0], [right, left.width + gap]] as const) {
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4; const o = (y * width + x0 + x) * 4; const a = img.rgba[i + 3]! / 255;
      for (let c = 0; c < 3; c++) rgba[o + c] = Math.round(img.rgba[i + c]! * a + 255 * (1 - a));
      rgba[o + 3] = 255;
    }
  }
  return { width, height, rgba };
}

/** Status colours an editable shape carries, as `state #rrggbb` (within two code values of the look's status map). */
export function statusColorsOf(s: Shape): string[] {
  return s.colors.flatMap((c) => Object.entries(STATUS_COLORS).filter(([, v]) => near(c, v, 2)).map(([state, v]) => `${state} ${v}`));
}
/** Glyph ink in a box: pixels at least 96 code values of luma above the status colour's, with their centroid. */
export function inkIn(img: Image, box: [number, number, number, number], state: string): { count: number; at: [number, number] } {
  const status = STATUS_COLORS[state]!;
  const base = 0.2126 * parseInt(status.slice(1, 3), 16) + 0.7152 * parseInt(status.slice(3, 5), 16) + 0.0722 * parseInt(status.slice(5, 7), 16);
  let count = 0; let sx = 0; let sy = 0;
  for (let y = box[1]; y < box[1] + box[3]; y++) for (let x = box[0]; x < box[0] + box[2]; x++) {
    if (lumaAt(img, (y * img.width + x) * 4) > base + 96) { count++; sx += x; sy += y; }
  }
  return { count, at: count ? [sx / count, sy / count] : [NaN, NaN] };
}

/** The pictures the taste call is shown, written under docs/evidence/732/ (each kept when its bytes are the same). */
export function writeEvidence(files: Record<string, Buffer>): Record<string, string> {
  const dir = join(REPO, 'docs', 'evidence', '732');
  mkdirSync(dir, { recursive: true });
  const hashes: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) {
    hashes[name] = sha256(bytes);
    const path = join(dir, name);
    if (!existsSync(path) || sha256(readFileSync(path)) !== hashes[name]) writeFileSync(path, bytes);
  }
  return hashes;
}
