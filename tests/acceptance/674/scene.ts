// Pure test-side data for the #674 acceptance tests: a PNG writer and reader, the 4 × 4 checker and a
// 5 × 3 sprite built in code, the look, the documents, and the pixel each device pixel of the nearest
// checker must read. It imports nothing from vitest, so `fixtures/make-base.ts` can run it under plain node.
// Nothing here stands in for a renderer, the document check or a cache.

import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rgb = [number, number, number];
export type Box = [number, number, number, number];

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------------------------------
// PNG: 8-bit RGBA written with node's zlib; 8-bit RGB or RGBA read, no interlace.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(4); head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, tail]);
}

/** An 8-bit RGBA PNG of `rgba` (row-major, straight alpha). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8;
  let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!;
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB/RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0;
      const b = previous[i]!;
      const c = i >= channels ? previous[i - channels]! : 0;
      const x = line[i]!;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw Error(`PNG filter ${filter}`);
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!;
      rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}

export function pixel(image: Image, x: number, y: number): Rgb {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) throw Error(`(${x}, ${y}) is outside the ${image.width} × ${image.height} image`);
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}

const rgbaAt = (image: Image, x: number, y: number): number[] => Array.from(image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

/** null when the two images are equal byte for byte (RGBA), else a sentence naming the first pixel that differs. */
export function firstDifference(got: Image, want: Image): string | null {
  if (got.width !== want.width || got.height !== want.height) return `the image is ${got.width} × ${got.height}, the base's is ${want.width} × ${want.height}`;
  for (let y = 0; y < got.height; y++) for (let x = 0; x < got.width; x++) {
    const a = rgbaAt(got, x, y); const b = rgbaAt(want, x, y);
    if (a.some((v, i) => v !== b[i])) return `pixel (${x}, ${y}) reads RGBA ${JSON.stringify(a)}, the base commit's draw reads ${JSON.stringify(b)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// The assets: a 4 × 4 checker of single black and white texels, and a 5 × 3 sprite with alpha.

export const BLACK: Rgb = [0, 0, 0];
export const WHITE: Rgb = [255, 255, 255];
export const TEXELS = 4;

/** Texel (column i, row j) is white when i + j is even, so the top left texel is white. */
export const texelColor = (i: number, j: number): Rgb => ((i + j) % 2 === 0 ? WHITE : BLACK);

export function checkerPng(): Buffer {
  const rgba = new Uint8Array(TEXELS * TEXELS * 4);
  for (let j = 0; j < TEXELS; j++) for (let i = 0; i < TEXELS; i++) rgba.set([...texelColor(i, j), 255], (j * TEXELS + i) * 4);
  return encodePng(TEXELS, TEXELS, rgba);
}

/** A 5 × 3 picture of smooth colors, its right column half transparent: what a linear image does with alpha, a crop and an opacity. */
export function spritePng(): Buffer {
  const rgba = new Uint8Array(5 * 3 * 4);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) rgba.set([40 + 50 * x, 30 + 90 * y, 200 - 30 * x - 20 * y, x === 4 ? 160 : 255], (y * 5 + x) * 4);
  return encodePng(5, 3, rgba);
}

// ---------------------------------------------------------------------------------------------------
// The look and the documents (as `deep-canvas-render` reads them; render-back's are made by `forShow`).

/** The ground is a blue no texel, no grey and no mix of black and white can be mistaken for. */
export const GROUND: Rgb = [60, 120, 200];
export const LOOK: JsonObject = { light: { ground: GROUND, ink: [0, 0, 0] } };

export interface ImageSpec {
  id: string;
  asset: string;
  box: Box;
  fit?: string;
  /** Written as given, so a wrong value can be tried; omitted when undefined. */
  sampling?: JsonValue | undefined;
  opacity?: number;
  crop?: number[];
  at?: JsonObject;
}

export function imageDoc(size: [number, number], images: ImageSpec[]): JsonObject {
  const items: JsonObject = {};
  images.forEach((spec, i) => {
    items[spec.id] = {
      id: spec.id, kind: 'image@1', layer: 'main', name: spec.id, order: `a${i}`,
      params: {
        asset: spec.asset, box: spec.box, fit: spec.fit ?? 'fill', alt: 'A picture for the sampling test',
        ...(spec.sampling === undefined ? {} : { sampling: spec.sampling }),
        ...(spec.opacity === undefined ? {} : { opacity: spec.opacity }),
        ...(spec.crop === undefined ? {} : { crop: spec.crop }),
      },
      ...(spec.at === undefined ? {} : { at: spec.at }),
    };
  });
  return {
    format: 1, id: 'sampling-674', profile: 'figure', title: 'Sampling', description: 'Images drawn with the sampler their sampling field names.', size,
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, items,
  };
}

/** The checker's document: doc 24 × 24 u, the image fit fill into a 16 × 16 box at (4, 4), so every texel is 4 u. */
export const CHECKER_SIZE: [number, number] = [24, 24];
export const CHECKER_BOX: Box = [4, 4, 16, 16];
export const checkerDoc = (asset: string, extra: Partial<ImageSpec> = {}): JsonObject =>
  imageDoc(CHECKER_SIZE, [{ id: 'checker', asset, box: CHECKER_BOX, ...extra }]);

/** The second base-commit document: a cropped, half-opaque sprite, fit contain, in a box at fractions of a unit. */
export const SPRITE_SIZE: [number, number] = [32, 24];
export const spriteDoc = (asset: string): JsonObject =>
  imageDoc(SPRITE_SIZE, [{ id: 'sprite', asset, box: [3.5, 2.25, 17, 11.5], fit: 'contain', opacity: 0.6, crop: [0, 0, 4, 3] }]);

/** The same document as a deep_show payload: no `id`, no `layers`, no item `layer`; the asset declared (#393's form). */
export function forShow(doc: JsonObject, asset: string): JsonObject {
  const items = Object.fromEntries(Object.entries(doc['items'] as JsonObject).map(([id, item]) => {
    const { layer: _layer, ...rest } = item as JsonObject;
    return [id, rest];
  }));
  return {
    format: 1, profile: 'board', title: String(doc['title']), description: String(doc['description']), size: doc['size']!, items,
    assets: { picture: { sha256: asset, license: 'CC0-1.0' } },
  };
}

// ---------------------------------------------------------------------------------------------------
// What the nearest checker must read.

/**
 * The first device pixel, in row-major order, that isn't exactly what the nearest checker reads there, or null.
 * `size` and `box` are in u and `zoom` is device px per u; a device pixel inside the box reads the color of the
 * texel its center falls in (pure black or pure white), and one outside reads the ground (the test look's, unless
 * `ground` says what the path's own look paints).
 */
export function firstWrongPixel(image: Image, size: [number, number], box: Box, zoom: number, ground: Rgb = GROUND): string | null {
  const w = Math.round(size[0] * zoom); const h = Math.round(size[1] * zoom);
  if (image.width !== w || image.height !== h) return `the image is ${image.width} × ${image.height}, not the document's ${w} × ${h} device pixels`;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x + 0.5) / zoom; const v = (y + 0.5) / zoom;
    const inside = u >= box[0] && u < box[0] + box[2] && v >= box[1] && v < box[1] + box[3];
    const texel = inside ? [Math.floor(((u - box[0]) / box[2]) * TEXELS), Math.floor(((v - box[1]) / box[3]) * TEXELS)] as const : null;
    const want = texel === null ? ground : texelColor(texel[0], texel[1]);
    const got = pixel(image, x, y);
    if (got.some((c, i) => c !== want[i])) {
      return `device pixel (${x}, ${y}) reads ${JSON.stringify(got)}, expected ${JSON.stringify(want)}${texel === null ? ' (the ground)' : ` (texel ${texel[0]}, ${texel[1]}: exactly 0 or 255)`}`;
    }
  }
  return null;
}

/** The most any channel of any pixel differs between two images of one size, and where. */
export function largestDifference(a: Image, b: Image): { levels: number; at: [number, number] } {
  if (a.width !== b.width || a.height !== b.height) throw Error(`the images are ${a.width} × ${a.height} and ${b.width} × ${b.height}`);
  let levels = -1; let at: [number, number] = [0, 0];
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const p = rgbaAt(a, x, y); const q = rgbaAt(b, x, y);
    for (let i = 0; i < 3; i++) {
      const d = Math.abs(p[i]! - q[i]!);
      if (d > levels) { levels = d; at = [x, y]; }
    }
  }
  return { levels, at };
}

/** The first pixel, in row-major order, where any channel differs by more than `levels`, or null. */
export function firstBeyond(a: Image, b: Image, levels: number): string | null {
  if (a.width !== b.width || a.height !== b.height) return `the images are ${a.width} × ${a.height} and ${b.width} × ${b.height}`;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const p = rgbaAt(a, x, y); const q = rgbaAt(b, x, y);
    for (let i = 0; i < 3; i++) {
      if (Math.abs(p[i]! - q[i]!) > levels) return `device pixel (${x}, ${y}) reads ${JSON.stringify(p.slice(0, 3))} on one path and ${JSON.stringify(q.slice(0, 3))} on the other, more than ${levels} levels apart in channel ${'RGB'[i]}`;
    }
  }
  return null;
}
