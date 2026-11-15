// Test-side tools for the #466 acceptance tests (README: The surface under test). They reuse the merged suites'
// helpers by import: #493's for `deep-show run` (builds, scenarios, `deep show`, `eval` with pixels and the film block,
// the evidence store, PNG reading, the shipped clean look) and `deep-motion eval`; #501's for the `export` call's
// receipt and its PNG frames; #502's for a receipt's captions and the .srt reader; #500's spawn suite for float WAVs
// in the evidence store; #407's for claims judged by `verdict`. This file adds the criterion IDs, the planted names,
// the films' envelope, the looks built from the clean look, and the small judges every file shares. Nothing here
// stands in for a transition, a boil, a motif, a reveal, a caption or a blur: every value a test compares comes from a
// binary, every expected value from the issue's text computed here.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  DOC, LAYER, LAYERS, cleanLook, clone, evalCall, isObject, pictureOf, present, presented, putStore, runShow, scenario, snapshotOf,
  type Image, type JsonObject, type Rgb,
} from '../493/helpers.ts';

export {
  DOC, arr, camera2d, clone, decodePng, evalCall, evalOk, evaluated, failsNaming, fl, inconclusive, none, num, obj, pixel, present, presented, rect,
  sameRgb, seededTimes, show, shuffled, snapshotOf, str, useEvidence, useMotion, useShow, type Image, type JsonObject, type JsonValue, type Rgb,
} from '../493/helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/466 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
/** Every `it` passes this timeout: a first cargo build on the shared Mac takes many minutes. */
export const TIMEOUT = 1_800_000;
/** The one `deep-show` build every file uses (#305's feature set). */
export const FULL = 'full';

/** Each criterion's ID (scripts/proof-change.mjs: `#466.` and the first 8 hex digits of SHA-256 of its text). */
export const AC = {
  1: 'AC1 #466.409171e5',
  2: 'AC2 #466.95cafa31',
  3: 'AC3 #466.4f5a25b8',
  4: 'AC4 #466.3b9b126d',
  5: 'AC5 #466.d3ce896d',
  6: 'AC6 #466.84cc08bc',
  7: 'AC7 #466.e1124907',
  8: 'AC8 #466.5255a50c',
  9: 'AC9 #466.9163b880',
} as const;

/** The wrong programs this suite adds (README: Planted programs), each reachable only through its binary's door. */
export type Planted =
  | 'mosaic_reveal_by_progress' | 'iris_center_at_window_start' | 'boil_ignores_cycle' | 'boil_seed_follows_playback'
  | 'motif_beats_at_first_tempo' | 'reveal_emits_at_unit_start' | 'designed_caption_after_entrance' | 'shown_by_ignored'
  | 'caption_plate_in_text_role' | 'blur_quantizes_samples' | 'dip_cross_fades_under_ink';

// ---------------------------------------------------------------------------------------------------
// Time

export const FLICKS_PER_S = 705_600_000;
/** Whole flicks of a 60 fps frame and of a 24 fps frame. */
export const FRAME60 = FLICKS_PER_S / 60;
export const FRAME24 = FLICKS_PER_S / 24;
/** Seconds as text, at most 6 decimals: a failure's way of naming a time. */
export const sOf = (flicks: number): string => `${Number((flicks / FLICKS_PER_S).toFixed(6))} s`;

// ---------------------------------------------------------------------------------------------------
// Documents (README: Fixtures). A film is #391's envelope with one writer layer; no visible text holds a number.

/** A 2D film of `size` u (1 u = 1 px), its camera `cam`, its items in order. */
export function film(id: string, items: JsonObject[], extra: JsonObject = {}, transport: JsonObject = { span: '4s' }, size: [number, number] = [480, 270]): JsonObject {
  return {
    format: 1, id, profile: 'film', title: `Films in time: ${id}`, description: `A film the films-in-time acceptance tests draw: ${id}.`,
    size, safe: 24, locale: 'en', camera: 'cam', layers: LAYERS, transport,
    items: Object.fromEntries(items.map((i) => [String(i['id']), { layer: LAYER, ...i }])), ...extra,
  };
}
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made by the films-in-time acceptance tests.' };
/** The shipped clean look with `change` merged in at its top level, named `id`. */
export function lookFrom(id: string, change: JsonObject = {}): JsonObject {
  return { ...cleanLook(), id, description: `The clean look as the films-in-time acceptance tests change it: ${id}.`, ...clone(change) };
}
/** A film with its look stored by hash in the evidence store and named by the document, as #1162's documents do. */
export function withLook(evidence: string, doc: JsonObject, looks: Record<string, JsonObject>, own: string): JsonObject {
  const assets: JsonObject = isObject(doc['assets']) ? clone(doc['assets']) : {};
  for (const [name, look] of Object.entries(looks)) assets[name] = { sha256: putStore(evidence, Buffer.from(JSON.stringify(look))), license: LICENSE };
  return { ...doc, assets, look: { asset: `${own}@1`, theme: 'light' } };
}
/** A 2D shot `[start, end)` in seconds on `cam`, holding the given framing. */
export function shot2d(start: number, end: number, target: [number, number], viewWidth: number, fields: JsonObject = {}): JsonObject {
  return { start: `${start}s`, end: `${end}s`, camera: 'cam', move: 'hold', target: [target[0], target[1], 0], view_width: viewWidth, ...fields };
}

/** A film as a claim's stored deliverable (#407's verdict scenarios): its ID the doc ID, its one layer yours. */
export const asStored = (doc: JsonObject, id: string): JsonObject => ({ ...doc, id, layers: { [LAYER]: { writer: 'you:you', title: 'You', order: 'a0' } } });

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: #493's scenario with this suite's planted name in the scenario's `planted`.

/** One scenario; the replies, one per call. */
export function show1(bin: string, evidence: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const sc = scenario(evidence, calls);
  return runShow(bin, planted ? { ...sc, planted } : sc);
}
/** Presents each document at its own doc ID (#493's DOC a to d), then draws each at each time with `pixels`; the
 * pictures per document, per time. */
export function draw(bin: string, evidence: string, docs: JsonObject[], times: readonly number[], planted?: Planted): Image[][] {
  const ids = [DOC.a, DOC.b, DOC.c, DOC.d];
  expect(docs.length, 'at most four documents a scenario').toBeLessThanOrEqual(4);
  const calls = [...docs.map((d, i) => present(ids[i]!, d)), ...times.flatMap((t) => docs.map((_, i) => evalCall(ids[i]!, t, { pixels: true })))];
  const replies = show1(bin, evidence, calls, planted);
  docs.forEach((_, i) => presented(replies[i]!, `document ${String(docs[i]!['id'])}`));
  return docs.map((d, i) => times.map((t, k) => {
    const what = `${String(d['id'])} at ${sOf(t)}`;
    return pictureOf(evidence, snapshotOf(replies[docs.length + k * docs.length + i]!, what), what);
  }));
}

// ---------------------------------------------------------------------------------------------------
// Pixels

/** IEC 61966-2-1's decode of an 8-bit code to linear light. */
export const linear = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
/** The worst channel difference between a pixel and a wanted color (8-bit codes, the wanted one unrounded). */
export const offBy = (got: Rgb, want: readonly number[]): number => Math.max(...got.map((v, i) => Math.abs(v - want[i]!)));
/** a·(1 − w) + b·w per channel, unrounded. */
export const mixRgb = (a: Rgb, b: Rgb, w: number): number[] => a.map((v, i) => v * (1 - w) + b[i]! * w);
export const rgbText = (c: readonly number[]): string => `(${c.map((v) => Number(v.toFixed(2))).join(', ')})`;
/** The one color every pixel of a picture is, or null when it holds more than one. */
export function flat(img: Image): Rgb | null {
  const first: Rgb = [img.rgba[0]!, img.rgba[1]!, img.rgba[2]!];
  for (let o = 0; o < img.rgba.length; o += 4) if (img.rgba[o] !== first[0] || img.rgba[o + 1] !== first[1] || img.rgba[o + 2] !== first[2]) return null;
  return first;
}
