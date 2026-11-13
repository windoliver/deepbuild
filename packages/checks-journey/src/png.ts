// Screens as pixels (#37, design: Screens). A small PNG codec (8-bit RGB and RGBA, non-interlaced, which is what
// Playwright writes), an exact comparison outside painted masks, a size difference as a difference, and the
// highlighted copy: the frame untouched, each changed box marked in a strip beside it, never over it.
import { deflateSync, inflateSync } from 'node:zlib';

export interface Image { width: number; height: number; /** RGBA, 4 bytes per pixel. */ data: Uint8Array }
export interface Box { x: number; y: number; width: number; height: number }
type Compared =
  | { same: true }
  | { same: false; reason: 'size'; head: { width: number; height: number }; base: { width: number; height: number } }
  | { same: false; reason: 'pixels'; differing: number; boxes: Box[] };

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(...parts: Uint8Array[]): number {
  let c = -1;
  for (const part of parts) for (const b of part) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
const paeth = (a: number, b: number, c: number): number => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

/** Decodes a PNG Playwright wrote; refuses what it doesn't read (interlace, palettes, 16-bit, grayscale). */
export function decodePng(bytes: Uint8Array): Image {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!b.subarray(0, 8).equals(SIGNATURE)) throw Error('not a PNG');
  let width = 0, height = 0, depth = 0, color = 0, interlace = 0;
  const idat: Buffer[] = [];
  for (let at = 8; at < b.length;) {
    const length = b.readUInt32BE(at);
    const type = b.toString('latin1', at + 4, at + 8);
    const data = b.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]!; color = data[9]!; interlace = data[12]!; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 6 && color !== 2) || interlace !== 0) throw Error(`a PNG this reader doesn't decode: depth ${depth}, color type ${color}, interlace ${interlace}`);
  const channels = color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0, up = prev[i]!, c = i >= channels ? prev[i - channels]! : 0;
      const x = line[i]!;
      line[i] = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + up : filter === 3 ? x + ((a + up) >> 1) : x + paeth(a, up, c);
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, i = x * channels;
      out[o] = line[i]!; out[o + 1] = line[i + 1]!; out[o + 2] = line[i + 2]!; out[o + 3] = channels === 4 ? line[i + 3]! : 255;
    }
    prev = line;
  }
  return { width, height, data: out };
}

export function encodePng(image: Image): Uint8Array {
  const { width, height, data } = image;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1); }
  const chunk = (type: string, body: Buffer): Buffer => {
    const t = Buffer.from(type, 'latin1');
    const head = Buffer.alloc(4); head.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(t, body));
    return Buffer.concat([head, t, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Paints each mask's box the same flat color on a copy, so a mask that moves or grows is itself a difference. */
export function paintMasks(image: Image, masks: readonly Box[]): Image {
  const data = new Uint8Array(image.data);
  for (const m of masks) {
    for (let y = Math.max(0, m.y); y < Math.min(image.height, m.y + m.height); y++) {
      for (let x = Math.max(0, m.x); x < Math.min(image.width, m.x + m.width); x++) { const o = (y * image.width + x) * 4; data[o] = 255; data[o + 1] = 0; data[o + 2] = 255; data[o + 3] = 255; }
    }
  }
  return { ...image, data };
}

/**
 * Exact: the two match only when every pixel is equal; a size change is a difference. `tolerance` is the planted
 * comparator's (tests only): pixels it lets differ, which the real comparison never does.
 */
export function comparePixels(head: Image, base: Image, options: { tolerance?: number } = {}): Compared {
  if (head.width !== base.width || head.height !== base.height) return { same: false, reason: 'size', head: { width: head.width, height: head.height }, base: { width: base.width, height: base.height } };
  let differing = 0;
  let minX = head.width, minY = head.height, maxX = -1, maxY = -1;
  const rows = new Set<number>();
  for (let y = 0; y < head.height; y++) {
    for (let x = 0; x < head.width; x++) {
      const o = (y * head.width + x) * 4;
      if (head.data[o] !== base.data[o] || head.data[o + 1] !== base.data[o + 1] || head.data[o + 2] !== base.data[o + 2] || head.data[o + 3] !== base.data[o + 3]) {
        differing++; rows.add(y);
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (differing <= (options.tolerance ?? 0)) return { same: true };
  return { same: false, reason: 'pixels', differing, boxes: boxesOf(head, base, rows) };
}
/** The changed regions as boxes: runs of changed rows, each spanning its changed columns, so a moved button shows as its two boxes' union. */
function boxesOf(head: Image, base: Image, rows: Set<number>): Box[] {
  const boxes: Box[] = [];
  const sorted = [...rows].sort((a, b) => a - b);
  let start = -1, last = -1;
  const flush = (): void => {
    if (start < 0) return;
    let minX = head.width, maxX = -1;
    for (let y = start; y <= last; y++) for (let x = 0; x < head.width; x++) {
      const o = (y * head.width + x) * 4;
      if (head.data[o] !== base.data[o] || head.data[o + 1] !== base.data[o + 1] || head.data[o + 2] !== base.data[o + 2] || head.data[o + 3] !== base.data[o + 3]) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
    boxes.push({ x: minX, y: start, width: maxX - minX + 1, height: last - start + 1 });
  };
  for (const y of sorted) {
    if (start >= 0 && y <= last + 2) { last = y; continue; }
    flush(); start = y; last = y;
  }
  flush();
  return boxes;
}

/** The frame as it was, with a strip beside it (to the right) carrying one marker per box, at the box's rows, and its outline drawn in the strip's copy of that row band. */
export function highlight(image: Image, boxes: readonly Box[]): Image {
  const strip = 24;
  const width = image.width + strip;
  const data = new Uint8Array(width * image.height * 4);
  for (let y = 0; y < image.height; y++) {
    data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), y * width * 4);
    for (let x = image.width; x < width; x++) { const o = (y * width + x) * 4; data[o] = 255; data[o + 1] = 255; data[o + 2] = 255; data[o + 3] = 255; }
  }
  for (const b of boxes) {
    for (let y = Math.max(0, b.y); y < Math.min(image.height, b.y + b.height); y++) {
      for (let x = image.width + 4; x < width - 4; x++) { const o = (y * width + x) * 4; data[o] = 220; data[o + 1] = 30; data[o + 2] = 30; data[o + 3] = 255; }
    }
  }
  return { width, height: image.height, data };
}
