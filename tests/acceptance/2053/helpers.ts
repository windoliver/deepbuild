// Test-side tools for the #2053 acceptance tests. The builds, the JSON-lines drivers of `deep-canvas-render` and
// `deep-gpu run`, PNG reading and writing and the keyed channels come from ../467/helpers.ts, and the documents'
// envelope, the reading of a pixel against a code, the merge base's binaries and the perf lane's judge from
// ../2031/helpers.ts, by import. This file adds the pictures the tests draw (a white image and its normal pages, PNGs
// made here in code into a content-addressed store), the paged image's documents, the frames with that store, and
// the closed form the issue states for a pixel of a paged image (#2031's reach times max(0, N·L) ÷ L.z, summed in
// linear light, clamped and encoded once), computed here in f64 from the page's own bytes. Nothing here stands in for
// the renderer. README: The surface under test.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  answered, arr, decodePng, encodeRgbaPng, hasFile, item, obj, render, runGpu, sha256, shown, str,
  type Image, type JsonObject, type Planted as Planted467,
} from '../467/helpers.ts';
import { doc as doc2031, LOOK, offBy, reach, WHITE } from '../2031/helpers.ts';

export {
  arr, errorsOf, failsNaming, fl, inconclusive, issuesOf, item, keyed, keyedAt, none, num, obj, px, render, requireMetal,
  shown, str, useBin, useDir,
  type Image, type Issue, type JsonObject, type JsonValue,
} from '../467/helpers.ts';
export {
  framesOf, group, judge, light, LOOK, median, offBy, parityFixtures, rect, timingProblem, unlitTwin, useMergeBase, WHITE, type Light,
} from '../2031/helpers.ts';

/** Each criterion's ID: `#2053.` + the first 8 hex digits of SHA-256 of its text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #2053.2bd7063d',
  2: 'AC2 #2053.9e8b1c74',
  3: 'AC3 #2053.dca1cc61',
  4: 'AC4 #2053.07ff75d0',
  5: 'AC5 #2053.cf7f4bb1',
  6: 'AC6 #2053.a3831a78',
  7: 'AC7 #2053.1e05370b',
} as const;

/** The wrong programs this suite plants (README: Planted programs); any other name stays `bad_input`. */
export type Planted = 'normal_flipped_green' | 'normal_dot_alone' | 'normal_unturned' | 'light_stale_height' | 'normal_accepts_smaller_page';

// ---------------------------------------------------------------------------------------------------
// Pictures: PNGs made here, kept in a flat store whose files are named by their SHA-256 (as `deep-canvas-render`'s
// `store` is, #674), so a document names each by hash.

/** A fresh store folder under `dir`. */
export function storeIn(dir: string): string {
  const store = join(dir, 'store');
  mkdirSync(store, { recursive: true });
  return store;
}
/** An 8-bit RGBA PNG of `w` × `h` written into `store` under its SHA-256; its hash and its bytes. */
export function putPng(store: string, w: number, h: number, value: (x: number, y: number) => [number, number, number, number]): { hash: string; png: Buffer } {
  const png = encodeRgbaPng(w, h, value);
  const hash = sha256(png);
  writeFileSync(join(store, hash), png);
  return { hash, png };
}
/** A white image, every pixel (255, 255, 255, 255). */
export const whiteImage = (store: string, w: number, h: number): string => putPng(store, w, h, () => [255, 255, 255, 255]).hash;
/**
 * A normal page whose every texel holds `rg` in red and green. Blue is 0, since z is rebuilt and never read, and alpha
 * 255. Returns the hash and the page as its PNG decodes, the bytes the closed form reads.
 */
export function uniformPage(store: string, w: number, h: number, rg: [number, number]): { hash: string; page: Image } {
  const { hash, png } = putPng(store, w, h, () => [rg[0], rg[1], 0, 255]);
  return { hash, page: decodePng(png) };
}

// ---------------------------------------------------------------------------------------------------
// The closed form the issue states, in f64 (README: Readings, "The CPU f64 form")

const decode = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const encode = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
/** A white light as the tests write it: `{at, color: white, energy, range, height}`. */
export interface Lamp { at: [number, number]; energy: number; range: number; height: number }
/** The normal a texel's red and green hold, read as stored: c ÷ 255 × 2 − 1 each, as on a material's normal map; z rebuilt. */
export function normalOf(r: number, g: number): [number, number, number] {
  const x = (r / 255) * 2 - 1; const y = (g / 255) * 2 - 1;
  return [x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))];
}
/** How a planted program reads a page, for the form's own copy of what each criterion says it reads. */
export type FormPlant = 'none' | 'flipped_green' | 'dot_alone' | 'unturned';
/**
 * The code a pixel (x, y) of a white paged image shows: N from `page`'s texel under it (the image's box at `box`,
 * 1 px a unit, unturned, its texel (x − box x, y − box y)) in the image's frame, +y toward its top edge, turned
 * `turn` degrees with the image (as `at.rot`'s z turns it, y down); for each lamp, L the unit vector from the pixel's
 * centre (x + 0.5, y + 0.5) to (at, height), and its term energy × reach(d) × max(0, N·L) ÷ L.z with d the 2D distance;
 * white (1 in linear light) × (ambient + Σ terms), clamped to 1, encoded once, × 255, rounded. With no page, N = (0, 0, 1)
 * and every factor is 1: #2031's form.
 */
export function pagedLit(ambient: number, lamps: Lamp[], x: number, y: number, o: { page?: Image; box?: [number, number]; turn?: number; plant?: FormPlant } = {}): number {
  let n: [number, number, number] = [0, 0, 1];
  if (o.page) {
    const [bx, by] = o.box ?? [0, 0];
    const turned = o.turn ?? 0;
    // The texel under (x, y): at 180°, the image's own pixel mirrored through its centre.
    const [tx, ty] = turned === 180 ? [o.page.width - 1 - (x - bx), o.page.height - 1 - (y - by)] : [x - bx, y - by];
    const at = (ty * o.page.width + tx) * 4;
    const g = o.page.rgba[at + 1]!;
    n = normalOf(o.page.rgba[at]!, o.plant === 'flipped_green' ? 255 - g : g);
  }
  // The image's frame (+y up) to the document's (y down), turned with the image.
  const turn = o.plant === 'unturned' ? 0 : (o.turn ?? 0);
  const c = Math.cos((turn * Math.PI) / 180); const s = Math.sin((turn * Math.PI) / 180);
  const [ix, iy] = [n[0], -n[1]];
  const N = [c * ix - s * iy, s * ix + c * iy, n[2]];
  let sum = ambient;
  for (const l of lamps) {
    const v = [l.at[0] - (x + 0.5), l.at[1] - (y + 0.5), l.height];
    const len = Math.hypot(v[0]!, v[1]!, v[2]!);
    const L = v.map((k) => k / len);
    const dot = Math.max(0, N[0]! * L[0]! + N[1]! * L[1]! + N[2]! * L[2]!);
    sum += l.energy * reach(Math.hypot(v[0]!, v[1]!), l.range) * (o.plant === 'dot_alone' ? dot : dot / L[2]!);
  }
  return Math.round(255 * encode(Math.min(1, decode(1) * sum)));
}

// ---------------------------------------------------------------------------------------------------
// The paged image's documents (README: Documents)

/** The documents of AC1 to AC5: 320 × 320, the 64 × 64 image `wall` centred on (160, 160), 1 px a unit. */
export const SIZE: [number, number] = [320, 320];
export const CENTRE: [number, number] = [160, 160];
/** The image's box in the frame, unturned: [128, 128] to [192, 192). */
export const BOX: [number, number, number, number] = [128, 128, 64, 64];
/** "The centre pixel": (160, 160), whose top-left corner is the image's centre (README: Readings). */
export const MID: [number, number] = [160, 160];
/** The first criterion's lights: white, energy 0.5, range 400 u, height 100 u, 100 u from the centre toward the top edge, or the bottom. */
export const UP: Lamp = { at: [160, 60], energy: 0.5, range: 400, height: 100 };
export const DOWN: Lamp = { at: [160, 260], energy: 0.5, range: 400, height: 100 };
/** The texel of the first criterion's page, (0, 0.6, 0.8), and a flat page's. */
export const LEANING: [number, number] = [128, 204];
export const FLAT: [number, number] = [128, 128];

/** A light as the issue writes it, with `height`; white unless named. */
export const lamp = (l: Lamp, color = WHITE): JsonObject => ({ at: [...l.at], color, energy: l.energy, range: l.range, height: l.height });
/** The envelope, as #2031's suite writes it, titled for this suite. */
export const doc = (id: string, size: [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject =>
  ({ ...doc2031(id, size, items, extra), title: `Normal pages ${id}`, description: `An acceptance document for normal pages on images: ${id}.` });
/**
 * The image `wall`: `asset` and `normal` (when given) by hash, its 64 × 64 box centred on its origin, placed at
 * (160, 160) and turned `turn` degrees about it by `at.rot`'s z (#535), a child of `parent`.
 */
export function wall(asset: string, parent: string, o: { normal?: string; turn?: number; order?: string; size?: [number, number]; at?: [number, number] } = {}): JsonObject {
  const [w, h] = o.size ?? [64, 64];
  const [x, y] = o.at ?? CENTRE;
  return item('wall', 'image@1', o.order ?? 'a1', {
    asset, box: [-w / 2, -h / 2, w, h], fit: 'fill', sampling: 'linear', alt: 'A white wall.', ...(o.normal ? { normal: o.normal } : {}),
  }, { parent, at: { pos: [x, y, 0], rot: [0, 0, o.turn ?? 0] } });
}
/** A lit group `lamps` (ambient 0 and the lamps given) holding the image `wall`. */
export function litWall(id: string, asset: string, lamps: Lamp[], o: { normal?: string; turn?: number } = {}): JsonObject {
  return doc(id, SIZE, [
    item('lamps', 'group@1', 'a0', { light: { ambient: 0, lights: lamps.map((l) => lamp(l)) } }),
    wall(asset, 'lamps', o),
  ]);
}

// ---------------------------------------------------------------------------------------------------
// Frames: `deep-gpu run` (macOS, Metal), each call given the store its images are read from

/** Each of `docs` as the app's window shows it (`window2d` with `store`), its PNG read back; one process. */
export function windows(bin: string, out: string, store: string, docs: JsonObject[], planted?: Planted): { image: Image; hash: string }[] {
  const replies = runGpu(bin, out, docs.map((d) => ({ call: 'window2d', doc: d, look: LOOK, store })), planted as Planted467 | undefined);
  return replies.map((r, i) => {
    const what = `window2d of ${String(docs[i]!['id'])}${planted ? ` under ${planted}` : ''}`;
    const hash = str(answered(r, what)['window'], `${what}: window`);
    return { image: decodePng(hasFile(out, hash, 'png', what)), hash };
  });
}
/** `film2d` with `from`, `hash` and `store`: each of `docs` in one process, each one's rows by frame. */
export function films(bin: string, out: string, store: string, docs: JsonObject[], o: { fps: number; from: number; frames: number; planted?: Planted | undefined }): Map<number, JsonObject>[] {
  const calls = docs.map((d) => ({ call: 'film2d', doc: d, look: LOOK, store, fps: o.fps, from: o.from, frames: o.frames, hash: true }));
  const replies = runGpu(bin, out, calls, o.planted as Planted467 | undefined);
  return replies.map((r, i) => {
    const what = `film2d of ${String(docs[i]!['id'])} from frame ${o.from}${o.planted ? ` under ${o.planted}` : ''}`;
    const rows = arr(answered(r, what)['frames'], `${what}: frames`).map((f) => obj(f, `${what}: a frame`));
    expect(rows.length, `${what}: one row per frame drawn`).toBe(o.frames);
    return new Map(rows.map((f) => [f['frame'] as number, f]));
  });
}

/** Every pixel of the image's box more than 1 code off `want(x, y)` on R, G or B, named `<what>: pixel (x, y) …`. */
export function offInBox(im: Image, want: (x: number, y: number) => number, what: string, box: [number, number, number, number] = BOX): string[] {
  expect([im.width, im.height], `${what}: the frame is ${SIZE.join(' × ')} px, 1 px a unit`).toEqual(SIZE);
  const failures: string[] = [];
  for (let y = box[1]; y < box[1] + box[3]; y++) for (let x = box[0]; x < box[0] + box[2]; x++) {
    const code = want(x, y);
    if (offBy(im, x, y, code) > 1) failures.push(`${what}: pixel (${x}, ${y}) reads ${[...im.rgba.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 3)].join(', ')}, not ${code} within 1 code`);
  }
  return failures;
}

/** `deep-canvas-render check {doc, look, store, planted?}`; the check must take the line (never `bad_input`). */
export function checked(bin: string, d: JsonObject, store: string, planted?: Planted): JsonObject {
  const [answer] = render(bin, 'check', [{ doc: d, look: LOOK, store, ...(planted ? { planted } : {}) }]);
  expect(answer!['code'], `check takes the line${planted ? ` with planted ${planted}` : ''}: ${shown(answer)}`).not.toBe('bad_input');
  return answer!;
}
