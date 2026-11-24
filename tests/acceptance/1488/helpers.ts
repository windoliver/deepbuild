// Test-side tools for the #1488 acceptance tests (README: The surface under test). What is new here: the fixtures (a
// 200 × 100 JPEG with a hand-built EXIF orientation 6, a plain JPEG, a lossless WebP by cwebp, an MP4 whose track
// header turns it a quarter clockwise, by ffmpeg, and the taste call's phone-like scene), a PNG reader for whatever
// PNG the intake writes, the corner reading of a drawn picture, `deep-show run` and `deep-canvas-render` driven
// without stopping at the first failure, and the sweep's seeded mutants.
//
// Reused by import, unchanged: #1486's baseline JPEG encoder and PNG writer (tests/acceptance/1486/helpers.ts), and
// #499's builds, scenarios, documents, evidence store, ffmpeg finder and seeded generator
// (tests/acceptance/499/video/helpers.ts). Nothing here stands in for a decoder, the worker or a draw path: each is
// read from what a binary answers or writes.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { expect } from 'vitest';
import { jpeg, pngRgb } from '../1486/helpers.ts';
import {
  DOC, REPO, asset, blocked, documentOf, ffmpeg, isObject, present, scenario, sha256, show, videoItem, type JsonObject, type JsonValue,
} from '../499/video/helpers.ts';

export { REPO, sha256, show, type JsonObject, type JsonValue };

/** Each criterion's ID (scripts/proof-change.mjs's `criterionId`: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #1488.a31e7537',
  2: 'AC2 #1488.3ac65184',
  3: 'AC3 #1488.b1cba5dc',
  4: 'AC4 #1488.5b4cd96d',
  5: 'AC5 #1488.a52e928a',
  6: 'AC6 #1488.0776f3d0',
} as const;

/** AC1's wrong program *(chosen name)*: every still decoder (the worker's and the image service's) ignores the tag. */
export const PLANT = 'decoder_ignores_orientation';

// ---------------------------------------------------------------------------------------------------
// The quadrant picture: four flat colors, one to a quarter, so every corner is unambiguous.

export type Rgb = [number, number, number];
export type Name = 'red' | 'green' | 'blue' | 'yellow';
export const COLORS: Record<Name, Rgb> = { red: [220, 50, 50], green: [50, 180, 70], blue: [50, 80, 220], yellow: [235, 205, 40] };
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
/** The stored picture's quarters. */
export const STORED: Record<Corner, Name> = { 'top-left': 'red', 'top-right': 'green', 'bottom-left': 'blue', 'bottom-right': 'yellow' };
/**
 * The same picture turned a quarter clockwise (EXIF orientation 6; the track matrix (0, 1, −1, 0)): the stored top row
 * becomes the right edge, so the stored top-left lands top-right and the stored bottom-left top-left.
 */
export const UPRIGHT: Record<Corner, Name> = { 'top-left': 'blue', 'top-right': 'red', 'bottom-right': 'green', 'bottom-left': 'yellow' };

/** 8-bit RGB of `w` × `h` quarters, padded with each edge's quarter to `pw` × `ph` (a JPEG's whole 16 px blocks). */
export function quadrants(w: number, h: number, pw = w, ph = h): Uint8Array {
  const rgb = new Uint8Array(pw * ph * 3);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const corner: Corner = `${y < h / 2 ? 'top' : 'bottom'}-${x < w / 2 ? 'left' : 'right'}`;
      rgb.set(COLORS[STORED[corner]], (y * pw + x) * 3);
    }
  }
  return rgb;
}

// ---------------------------------------------------------------------------------------------------
// JPEGs: #1486's baseline encoder (4:2:0, quality 90, whole 16 px blocks), then, for a phone photo, its JFIF APP0
// swapped for an EXIF APP1 that holds one IFD0 entry, Orientation (0x0112, SHORT) = 6, and its frame header's size set
// to the stored size: the blocks past it are the padding every decoder crops.

function exifApp1(orientation: number): Buffer {
  const body = Buffer.from([
    0x45, 0x78, 0x69, 0x66, 0, 0, // "Exif\0\0"
    0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, // big-endian TIFF header, IFD0 at 8
    0, 1, // one entry
    0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, // Orientation, SHORT, 1, value
    0, 0, 0, 0, // no next IFD
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
}

/** A baseline JPEG of `rgb` (padded to whole blocks) whose stored size is `w` × `h` and which carries EXIF `orientation`. */
export function orientedJpeg(w: number, h: number, rgb: Uint8Array, orientation: number): Buffer {
  const pw = Math.ceil(w / 16) * 16;
  const ph = Math.ceil(h / 16) * 16;
  const file = jpeg(pw, ph, rgb);
  const parts: Buffer[] = [file.subarray(0, 2), exifApp1(orientation)];
  let at = 2;
  while (at < file.length) {
    const marker = file[at + 1]!;
    const length = file.readUInt16BE(at + 2);
    if (marker === 0xda) { parts.push(file.subarray(at)); break; }
    const segment = Buffer.from(file.subarray(at, at + 2 + length));
    if (marker === 0xc0) { segment.writeUInt16BE(h, 5); segment.writeUInt16BE(w, 7); }
    if (marker !== 0xe0) parts.push(segment);
    at += 2 + length;
  }
  return Buffer.concat(parts);
}

/** AC1's phone photo: 200 × 100 stored, orientation 6, the quadrants. */
export const PHOTO = { w: 200, h: 100 } as const;
export const photoJpeg = (): Buffer => orientedJpeg(PHOTO.w, PHOTO.h, quadrants(PHOTO.w, PHOTO.h, 208, 112), 6);
/** AC2's plain JPEG: 160 × 96, JFIF, no EXIF, the quadrants. */
export const PLAIN = { w: 160, h: 96 } as const;
export const plainJpeg = (): Buffer => jpeg(PLAIN.w, PLAIN.h, quadrants(PLAIN.w, PLAIN.h));

// ---------------------------------------------------------------------------------------------------
// Fixture checks by tools on this Mac (fixtures only, never the code under test): ffmpeg reads the photo, and its
// display rotation, as this suite means them.

/** ffmpeg's own decode of a still or a clip's first frame to RGB, its rotation applied (or not). */
export function ffmpegRgb(path: string, autorotate: boolean): Buffer {
  return ffmpeg([...(autorotate ? [] : ['-noautorotate']), '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
}

/** The four corner names of an RGB picture read `inset` px in from each corner, by nearest color. */
export function rgbCorners(rgb: Uint8Array, w: number, h: number, inset: number): Record<Corner, string> {
  const at = (x: number, y: number): Rgb => [rgb[(y * w + x) * 3]!, rgb[(y * w + x) * 3 + 1]!, rgb[(y * w + x) * 3 + 2]!];
  return {
    'top-left': nearest(at(inset, inset)).name,
    'top-right': nearest(at(w - 1 - inset, inset)).name,
    'bottom-left': nearest(at(inset, h - 1 - inset)).name,
    'bottom-right': nearest(at(w - 1 - inset, h - 1 - inset)).name,
  };
}

/** Checks that ffmpeg reads `path` as `w` × `h` stored quadrants and, turned by its tag, as the upright quadrants. */
export function checkFixtureTurns(path: string, w: number, h: number, what: string): void {
  const stored = ffmpegRgb(path, false);
  expect(stored.length, `fixture ${what}: ffmpeg decodes ${w} × ${h} stored (the recipe broke if not)`).toBe(w * h * 3);
  expect(rgbCorners(stored, w, h, 6), `fixture ${what}: the stored quarters (the recipe broke if not)`).toEqual(STORED);
  const turned = ffmpegRgb(path, true);
  expect(turned.length, `fixture ${what}: ffmpeg shows it ${h} × ${w} by its tag (the recipe broke if not)`).toBe(w * h * 3);
  expect(rgbCorners(turned, h, w, 6), `fixture ${what}: ffmpeg turns it a quarter clockwise by its tag (the recipe broke if not)`).toEqual(UPRIGHT);
}

// ---------------------------------------------------------------------------------------------------
// WebP: 8-bit RGB quadrants as a PNG (#1486's writer), made lossless by cwebp. Missing, the test is BLOCKED.

function findCwebp(): string | null {
  for (const c of [process.env['DEEP_CWEBP'], 'cwebp', '/opt/homebrew/bin/cwebp', '/usr/local/bin/cwebp'].filter((x): x is string => !!x)) {
    const r = spawnSync(c, ['-version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return c;
  }
  return null;
}
export const WEBP = { w: 120, h: 80 } as const;
/** AC3's WebP, lossless, 120 × 80 quadrants, written to `dir/still.webp`; its path. */
export function webpFixture(dir: string): string {
  const cwebp = findCwebp();
  if (!cwebp) blocked('the WebP fixture is made by cwebp (libwebp), found neither on PATH, in /opt/homebrew/bin or /usr/local/bin, nor by DEEP_CWEBP. Unblock: brew install webp');
  const png = join(dir, 'still-source.png');
  writeFileSync(png, pngRgb(WEBP.w, WEBP.h, quadrants(WEBP.w, WEBP.h)));
  const out = join(dir, 'still.webp');
  execFileSync(cwebp, ['-quiet', '-lossless', '-metadata', 'none', png, '-o', out], { stdio: ['ignore', 'pipe', 'pipe'] });
  const bytes = readFileSync(out);
  expect(bytes.subarray(0, 4).toString('latin1') + bytes.subarray(8, 12).toString('latin1'), `fixture ${out}: a RIFF WEBP file`).toBe('RIFFWEBP');
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The clip: I420 frames of a picture converted here to limited-range BT.709, encoded by libx264 (QP 10, no B-frames)
// with BT.709 tags and the sRGB transfer, then copied with ffmpeg's `-display_rotation -90`, which writes the track
// header's matrix (0, 1, −1, 0): a quarter turn clockwise, the turn a phone writes for a portrait recording (the
// legacy `rotate` tag calls it 90; ffmpeg's display matrix, which counts counter-clockwise, calls it −90).

/** Limited-range BT.709 I420 of an 8-bit RGB picture (both sides even), chroma the mean of each 2 × 2 square. */
export function i420(rgb: Uint8Array, w: number, h: number): Buffer {
  const Y = Buffer.alloc(w * h); const U = Buffer.alloc((w * h) / 4); const V = Buffer.alloc((w * h) / 4);
  const cb = new Float64Array(w * h); const cr = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3]! / 255; const g = rgb[i * 3 + 1]! / 255; const b = rgb[i * 3 + 2]! / 255;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    Y[i] = Math.round(16 + 219 * y);
    cb[i] = 128 + (224 * (b - y)) / 1.8556;
    cr[i] = 128 + (224 * (r - y)) / 1.5748;
  }
  for (let y = 0; y < h / 2; y++) {
    for (let x = 0; x < w / 2; x++) {
      const o = 2 * y * w + 2 * x;
      U[y * (w / 2) + x] = Math.round((cb[o]! + cb[o + 1]! + cb[o + w]! + cb[o + w + 1]!) / 4);
      V[y * (w / 2) + x] = Math.round((cr[o]! + cr[o + 1]! + cr[o + w]! + cr[o + w + 1]!) / 4);
    }
  }
  return Buffer.concat([Y, U, V]);
}

/** The video track header's matrix (a, b, u, c, d, v, x, y, w) and its width and height, read from the file's first `tkhd`. */
export function trackMatrix(file: Buffer): { matrix: number[]; size: [number, number] } {
  const at = file.indexOf(Buffer.from('tkhd', 'latin1'));
  expect(at, 'the clip has a track header').toBeGreaterThan(0);
  const m = at + 8 + (file[at + 4] === 1 ? 32 : 20) + 16;
  return { matrix: Array.from({ length: 9 }, (_, i) => file.readInt32BE(m + 4 * i)), size: [file.readUInt32BE(m + 36) / 65536, file.readUInt32BE(m + 40) / 65536] };
}
/** (a, b, c, d) = (0, 1, −1, 0) in 16.16: x′ = −y, y′ = x, a quarter turn clockwise on screen (y down). */
export const QUARTER_CLOCKWISE = [0, 0x10000, -0x10000, 0];

/** A clip of `frames` (8-bit RGB pictures, `w` × `h`, both even) at `fps`, tagged to turn a quarter clockwise, at `path`. */
export function turnedClip(path: string, w: number, h: number, frames: Uint8Array[], fps: number): void {
  const plain = `${path}.plain.mp4`;
  ffmpeg(['-y', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${w}x${h}`, '-r', String(fps), '-i', '-',
    '-vf', 'setparams=color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709:range=tv',
    '-c:v', 'libx264', '-qp', '10', '-bf', '0', '-g', String(fps), '-pix_fmt', 'yuv420p', '-threads', '1', plain], Buffer.concat(frames.map((f) => i420(f, w, h))));
  ffmpeg(['-y', '-display_rotation:v:0', '-90', '-i', plain, '-c', 'copy', path]);
  const { matrix, size } = trackMatrix(readFileSync(path));
  expect([matrix[0], matrix[1], matrix[3], matrix[4]], `fixture ${path}: the track matrix is (0, 1, −1, 0), a quarter turn clockwise (the recipe broke if not)`).toEqual(QUARTER_CLOCKWISE);
  expect(size, `fixture ${path}: the track header keeps the coded ${w} × ${h}`).toEqual([w, h]);
}

/** AC5's clip (and AC4's MP4): 160 × 96 coded, the quadrants in every one of 10 frames at 10 fps, turned a quarter clockwise. */
export const CLIP = { w: 160, h: 96, frames: 10, fps: 10 } as const;
export function quadrantClip(path: string): void {
  const f = quadrants(CLIP.w, CLIP.h);
  turnedClip(path, CLIP.w, CLIP.h, Array.from({ length: CLIP.frames }, () => f), CLIP.fps);
}

// ---------------------------------------------------------------------------------------------------
// PNG: any non-interlaced PNG (bit depth 1 to 16, grey, RGB, palette, grey with alpha, RGBA) read to 8-bit RGBA, so
// whatever PNG the intake writes can be read here. 16-bit samples keep their high byte.

export interface Image { width: number; height: number; rgba: Uint8Array }
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const isPng = (bytes: Buffer): boolean => bytes.length >= 33 && bytes.subarray(0, 8).equals(SIGNATURE) && bytes.toString('latin1', 12, 16) === 'IHDR';
/** A PNG's size from its IHDR. */
export const pngSize = (bytes: Buffer): [number, number] => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];

export function readPng(file: Buffer): Image {
  if (!isPng(file)) throw Error('not a PNG (no signature and IHDR)');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  let palette: Buffer = Buffer.alloc(0); let alpha: Buffer = Buffer.alloc(0);
  const data: Buffer[] = [];
  while (at + 8 <= file.length) {
    const length = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') alpha = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (interlace !== 0) throw Error('an interlaced PNG; this reader takes none');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  if (!channels) throw Error(`PNG color type ${color}`);
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const raw = inflateSync(Buffer.concat(data));
  const rows: Uint8Array[] = [];
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp]! : 0; const b = previous[i]!; const c = i >= bpp ? previous[i - bpp]! : 0;
      const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      line[i] = (filter === 0 ? line[i]! : filter === 1 ? line[i]! + a : filter === 2 ? line[i]! + b : filter === 3 ? line[i]! + ((a + b) >> 1) : line[i]! + paeth) & 255;
    }
    rows.push(line);
    previous = line;
  }
  const sample = (row: Uint8Array, index: number): number => {
    if (depth === 8) return row[index]!;
    if (depth === 16) return row[index * 2]!;
    const per = 8 / depth; const byte = row[Math.floor(index / per)]!; const shift = 8 - depth * ((index % per) + 1);
    const v = (byte >> shift) & ((1 << depth) - 1);
    return color === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (k: number): number => sample(rows[y]!, x * channels + k);
      const o = (y * width + x) * 4;
      if (color === 3) {
        const i = depth === 8 ? rows[y]![x]! : s(0);
        rgba.set([palette[i * 3]!, palette[i * 3 + 1]!, palette[i * 3 + 2]!, i < alpha.length ? alpha[i]! : 255], o);
      } else if (color === 0 || color === 4) rgba.set([s(0), s(0), s(0), color === 4 ? s(1) : 255], o);
      else rgba.set([s(0), s(1), s(2), color === 6 ? s(3) : 255], o);
    }
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------------------------------
// Reading a drawn picture: each corner of where the picture should be, by its nearest quadrant color.

export function pixel(img: Image, x: number, y: number): Rgb {
  const o = (y * img.width + x) * 4;
  return [img.rgba[o]!, img.rgba[o + 1]!, img.rgba[o + 2]!];
}
/** The mean of the 3 × 3 square at (x, y). */
export function patch(img: Image, x: number, y: number): Rgb {
  const sum: Rgb = [0, 0, 0];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const p = pixel(img, x + dx, y + dy); for (const c of [0, 1, 2] as const) sum[c] += p[c]; }
  return sum.map((v) => Math.round(v / 9)) as Rgb;
}
const distance = (a: Rgb, b: Rgb): number => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
/** The quadrant color nearest `c`, and how far it is (the largest channel difference). */
export function nearest(c: Rgb): { name: Name; off: number } {
  let best: Name = 'red'; let off = Infinity;
  for (const name of Object.keys(COLORS) as Name[]) { const d = distance(c, COLORS[name]); if (d < off) { off = d; best = name; } }
  return { name: best, off };
}
/** A drawn color reads as a quadrant's when it is that one's nearest and within this many code values per channel. */
export const TOLERANCE = 48;

export type Box = [number, number, number, number];
/** Each corner's sample point `inset` px inside `rect` (device px). */
export function cornerPoints([x, y, w, h]: Box, inset: number): Record<Corner, [number, number]> {
  return {
    'top-left': [x + inset, y + inset], 'top-right': [x + w - 1 - inset, y + inset],
    'bottom-left': [x + inset, y + h - 1 - inset], 'bottom-right': [x + w - 1 - inset, y + h - 1 - inset],
  };
}
/**
 * The corner-pixel failures of `img` where the upright picture should fill `rect`: each corner's color, by its nearest
 * quadrant, against the upright picture's. Each failure names the corner, its pixel and what it shows.
 */
export function cornerFailures(img: Image, rect: Box, what: string, inset = 8): string[] {
  const out: string[] = [];
  for (const [corner, [x, y]] of Object.entries(cornerPoints(rect, inset)) as [Corner, [number, number]][]) {
    if (x < 1 || y < 1 || x >= img.width - 1 || y >= img.height - 1) { out.push(`${what}: the corner pixel ${corner} (${x}, ${y}) is outside its ${img.width} × ${img.height} picture`); continue; }
    const got = patch(img, x, y);
    const n = nearest(got);
    const want = UPRIGHT[corner];
    if (n.name !== want || n.off > TOLERANCE) {
      const stored = (Object.keys(STORED) as Corner[]).find((k) => STORED[k] === n.name);
      out.push(`${what}: the corner pixel ${corner} (${x}, ${y}) is (${got.join(', ')}), ${n.off <= TOLERANCE ? `${n.name}, the stored ${stored} quarter` : 'none of the four quarters'}, where the upright picture has ${want} (the stored ${(Object.keys(STORED) as Corner[]).find((k) => STORED[k] === want)})`);
    }
  }
  return out;
}
/** Whether the picture fills `rect` and not past it: each point in `margins` shows the board's ground, read at (3, 3). */
export function marginFailures(img: Image, margins: [number, number][], what: string): string[] {
  const ground = patch(img, 3, 3);
  return margins.flatMap(([x, y]) => {
    const got = patch(img, x, y);
    return distance(got, ground) > 24 ? [`${what}: (${x}, ${y}) is (${got.join(', ')}), not the ground (${ground.join(', ')}): the picture is drawn wider than the upright size, so its width and height aren't swapped`] : [];
  });
}

// ---------------------------------------------------------------------------------------------------
// The board both drawing binaries read: 240 × 240 u, one item in the box [20, 20, 200, 200], `fit: contain`. A picture
// shown 100 × 200 (or 96 × 160 scaled to 120 × 200) stands centred in it with ground to its left and right; drawn
// unturned it would lie across the box instead.

export const BOARD: [number, number] = [240, 240];
export const ITEM_BOX: Box = [20, 20, 200, 200];
/** Where a `w` × `h` picture lands in ITEM_BOX under `fit: contain`. */
export function contained(w: number, h: number): Box {
  const s = Math.min(ITEM_BOX[2] / w, ITEM_BOX[3] / h);
  return [ITEM_BOX[0] + (ITEM_BOX[2] - w * s) / 2, ITEM_BOX[1] + (ITEM_BOX[3] - h * s) / 2, w * s, h * s];
}
/** Points of ITEM_BOX left and right of a portrait picture at `rect`, halfway down, which must show the ground. */
export const sideMargins = (rect: Box): [number, number][] => [[Math.round((ITEM_BOX[0] + rect[0]) / 2), 120], [Math.round((rect[0] + rect[2] + ITEM_BOX[0] + ITEM_BOX[2]) / 2), 120]];

export function stillItem(id: string, sha: string, box: Box): JsonObject {
  return { id, kind: 'image@1', layer: 'main', name: `Photo ${id}`, order: `a${id}`, params: { asset: sha, box, fit: 'contain', alt: `The #1488 suite's phone photo ${id}` } };
}
export function clipItem(id: string, sha: string, box: Box, fit: 'contain' | 'fill' = 'contain'): JsonObject {
  const item = videoItem(id, sha, box, { start: '0s', in: 0, rate: [1, 1] }, { fit }, `b${id}`);
  (item['params'] as JsonObject)['alt'] = `The #1488 suite's phone clip ${id}`;
  return item;
}
/** A board of `items` with their assets named, as both `deep-show` and `deep-canvas-render` read it. */
export function boardOf(id: string, size: [number, number], items: JsonObject[], assets: Record<string, string>): JsonObject {
  return documentOf(id, 'board', size, items, Object.fromEntries(Object.entries(assets).map(([k, v]) => [k, asset(v)])), {}, { span: '2s', frame_rate: [10, 1] });
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (README: The surface under test). Read without stopping at the first failure, so one run reports
// every path that fails.

export interface ShowRun { ok: boolean; replies: JsonObject[]; why: string; status: number | null; signal: string | null }
/** One `deep-show run`; `ok` when it exits 0 with one line answering ok with one reply per call, else `why`. */
export function showRun(bin: string, sc: JsonObject, timeoutMs = 3_600_000): ShowRun {
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const status = run.status; const signal = run.signal;
  const fail = (why: string): ShowRun => ({ ok: false, replies: [], why, status, signal });
  if (run.error) return fail(`deep-show run did not finish (${run.error.message})`);
  if (status !== 0) return fail(`deep-show run exited ${status ?? signal}; stderr: ${(run.stderr ?? '').slice(-1500)}`);
  const lines = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  if (lines.length !== 1) return fail(`deep-show run wrote ${lines.length} lines, not one`);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return fail(`deep-show run's line isn't JSON: ${lines[0]!.slice(0, 400)}`); }
  if (!isObject(answer) || answer['ok'] !== true) return fail(`deep-show run answers ${show(answer)}${sc['planted'] ? ` (planted ${String(sc['planted'])})` : ''}`);
  const replies = Array.isArray(answer['replies']) ? answer['replies'] : [];
  const calls = Array.isArray(sc['calls']) ? sc['calls'] : [];
  if (replies.length !== calls.length || !replies.every(isObject)) return fail(`deep-show run answers ${replies.length} replies to ${calls.length} calls`);
  return { ok: true, replies: replies as JsonObject[], why: '', status, signal };
}
/** The run must answer: else the test fails here, naming why. */
export function answered(r: ShowRun, what: string): JsonObject[] {
  expect(r.ok, `${what}: ${r.why}`).toBe(true);
  return r.replies;
}
export const withCaps = (sc: JsonObject, caps: JsonObject): JsonObject => ({ ...sc, decode_caps: caps });
export { DOC, present, scenario };
export const importCall = (path: string): JsonObject => ({ call: 'media_import', path });
export const decodeCall = (path: string, out: string, more: JsonObject = {}): JsonObject => ({ call: 'media_decode', path, out, format: 'bgra', ...more });
export const evalPixels = (doc: string, t: number): JsonObject => ({ call: 'eval', doc, t, pixels: true });

/** A reply's refusal code, if it is a refusal (`{"refused": {"code"}}`). */
export function refusal(reply: JsonValue | undefined): string | null {
  return isObject(reply) && isObject(reply['refused']) && typeof reply['refused']['code'] === 'string' ? reply['refused']['code'] : null;
}
/** The first stream of a probe reply's asset, or why there is none. */
export function firstStream(reply: JsonObject, kind: string): JsonObject | string {
  const r = refusal(reply);
  if (r) return `refused ${r}: ${show(reply['refused'])}`;
  const a = reply['asset'];
  if (!isObject(a) || !isObject(a['probe']) || !Array.isArray(a['probe']['streams'])) return `no asset with a probe: ${show(reply)}`;
  const s = a['probe']['streams'].find((x) => isObject(x) && x['type'] === kind);
  return isObject(s) ? s : `no ${kind} stream in the probe: ${show(a['probe'])}`;
}

/** A BGRA frame file the worker wrote, as RGBA, or why it can't be read. */
export function bgraFrame(out: string, reply: JsonObject): { image: Image; size: [number, number] } | string {
  const r = refusal(reply);
  if (r) return `refused ${r}: ${show(reply['refused'])}`;
  const d = reply['decoded'];
  const s = isObject(d) && Array.isArray(d['streams']) ? d['streams'].find(isObject) : undefined;
  if (!isObject(s)) return `no decoded stream: ${show(reply)}`;
  const size = s['size']; const frames = s['frames'];
  if (!Array.isArray(size) || size.length !== 2 || !size.every((n) => typeof n === 'number' && Number.isInteger(n) && n > 0)) return `the decoded stream has no size: ${show(s)}`;
  if (!Array.isArray(frames) || !isObject(frames[0]) || typeof frames[0]['file'] !== 'string') return `the decoded stream has no frame file: ${show(s)}`;
  const [w, h] = size as [number, number];
  const path = join(out, frames[0]['file']);
  if (!existsSync(path)) return `the frame file ${frames[0]['file']} isn't in ${out}`;
  const bytes = readFileSync(path);
  if (bytes.length !== w * h * 4) return `the frame file holds ${bytes.length} B, not ${w} × ${h} BGRA (${w * h * 4} B)`;
  const rgba = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 4) rgba.set([bytes[i + 2]!, bytes[i + 1]!, bytes[i]!, bytes[i + 3]!], i);
  return { image: { width: w, height: h, rgba }, size: [w, h] };
}

/** The picture an `eval` with `pixels` drew, read from the run's evidence store, or why there is none. */
export function snapshot(evidence: string, reply: JsonObject): Image | string {
  if (reply['outcome'] !== 'evaluated') return `eval answers ${show(reply)}`;
  const list = reply['snapshots'];
  const s = Array.isArray(list) ? list[0] : undefined;
  if (!isObject(s) || typeof s['sha256'] !== 'string') return `eval wrote no snapshot: ${show(reply)}`;
  const path = join(evidence, s['sha256'].slice(0, 2), s['sha256'].slice(2));
  if (!existsSync(path)) return `the snapshot ${s['sha256']} isn't in the evidence store`;
  return readPng(readFileSync(path));
}
/** The snapshot's stored bytes (a PNG), for the taste call's pictures. */
export function snapshotBytes(evidence: string, reply: JsonObject, what: string): Buffer {
  expect(reply['outcome'], `${what}: eval answers ${show(reply)}`).toBe('evaluated');
  const s = Array.isArray(reply['snapshots']) ? reply['snapshots'][0] : undefined;
  expect(isObject(s) && typeof s['sha256'] === 'string', `${what}: eval wrote a snapshot: ${show(reply)}`).toBe(true);
  const h = (s as JsonObject)['sha256'] as string;
  return readFileSync(join(evidence, h.slice(0, 2), h.slice(2)));
}

// ---------------------------------------------------------------------------------------------------
// deep-canvas-render: one JSON line in per request, one out per line, read without throwing so a crash names its line.

export interface Drawn { answers: JsonObject[]; crash: string | null }
export function drawLines(bin: string, sub: 'raster' | 'render', inputs: JsonValue[], timeoutMs = 1_800_000): Drawn {
  const run = spawnSync(bin, [sub], { cwd: REPO, input: `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const answers: JsonObject[] = [];
  for (const line of (run.stdout ?? '').split('\n').filter((l) => l !== '')) {
    try { const v = JSON.parse(line) as JsonValue; answers.push(isObject(v) ? v : { line }); } catch { answers.push({ line }); }
  }
  const crash = run.error ? `deep-canvas-render ${sub} did not finish (${run.error.message})`
    : run.status !== 0 ? `deep-canvas-render ${sub} exited ${run.status ?? run.signal}; stderr: ${(run.stderr ?? '').slice(-1200)}`
      : answers.length !== inputs.length ? `deep-canvas-render ${sub} answered ${answers.length} of ${inputs.length} lines` : null;
  return { answers, crash };
}
/** The live renderer's look (#391's form), as #499's live tests use it. */
export const LOOK: JsonObject = { light: { ground: [250, 250, 248], ink: [28, 28, 30], muted: [120, 120, 128], accent: [40, 90, 200], live: [200, 120, 40] } };

// ---------------------------------------------------------------------------------------------------
// The taste call's fixture document (AC6): a phone-like scene, drawn upright here and stored a quarter turn the other
// way, as a phone stores a portrait picture: a sky, a sun to the top right, green ground, a red arrow pointing up, and
// in the clip a white ball that rises.

/** The upright scene, `w` × `h` (portrait), at `rise` (0 to 1) of the ball's climb (no ball when null). */
export function scene(w: number, h: number, rise: number | null): Uint8Array {
  const rgb = new Uint8Array(w * h * 3);
  const horizon = Math.round(h * 0.68);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c: Rgb = y < horizon ? [Math.round(90 + (100 * y) / horizon), Math.round(150 + (70 * y) / horizon), 235] : [60, Math.round(150 - (40 * (y - horizon)) / (h - horizon)), 60];
      const sun = Math.hypot(x - w * 0.78, y - h * 0.14) < w * 0.11;
      if (sun) c = [250, 210, 60];
      const ax = x - w / 2; const head = h * 0.3; const tip = h * 0.18; const tail = h * 0.6;
      if (y >= tip && y < head && Math.abs(ax) <= ((y - tip) / (head - tip)) * w * 0.16) c = [210, 40, 40];
      if (y >= head && y < tail && Math.abs(ax) <= w * 0.05) c = [210, 40, 40];
      if (rise !== null && Math.hypot(x - w * 0.22, y - (h * 0.9 - rise * h * 0.75)) < w * 0.07) c = [250, 250, 250];
      rgb.set(c, (y * w + x) * 3);
    }
  }
  return rgb;
}
/** An upright `w` × `h` picture stored a quarter turn counter-clockwise (`h` × `w`), so a quarter turn clockwise shows it upright. */
export function storedSideways(up: Uint8Array, w: number, h: number): Uint8Array {
  const sw = h; const sh = w;
  const out = new Uint8Array(sw * sh * 3);
  // Shown (x′, y′) = (sh − 1 − y, x) for stored (x, y).
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const xs = sh - 1 - y; const ys = x; out.set(up.subarray((ys * w + xs) * 3, (ys * w + xs) * 3 + 3), (y * sw + x) * 3); }
  return out;
}
/** The taste photo: 240 × 320 upright, stored 320 × 240 with orientation 6. */
export const TASTE_PHOTO = { w: 240, h: 320 } as const;
export const tastePhoto = (): Buffer => orientedJpeg(TASTE_PHOTO.h, TASTE_PHOTO.w, storedSideways(scene(TASTE_PHOTO.w, TASTE_PHOTO.h, null), TASTE_PHOTO.w, TASTE_PHOTO.h), 6);
/** The taste clip: 192 × 256 upright, stored 256 × 192, 10 frames at 10 fps, the ball rising a tenth a frame. */
export const TASTE_CLIP = { w: 192, h: 256, frames: 10, fps: 10 } as const;
export function tasteClip(path: string): void {
  const { w, h, frames, fps } = TASTE_CLIP;
  turnedClip(path, h, w, Array.from({ length: frames }, (_, k) => storedSideways(scene(w, h, k / (frames - 1)), w, h)), fps);
}

/** Writes `bytes` under `dir`, making it; returns the path. */
export function writeInto(dir: string, name: string, bytes: Uint8Array): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
}
