// Tiny deterministic PNGs and a reader for what `deep export` writes: solid red and solid blue pictures, and the mean
// color of an exported still. Pure node (zlib, crypto); no image library.
import { deflateSync, inflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Buffer): number => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer): Buffer => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};

/** A solid `size`×`size` 8-bit RGB PNG of one color. Same inputs, same bytes. */
export function solid(rgb: [number, number, number], size: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
export const RED = (size: number) => solid([255, 0, 0], size);
export const BLUE = (size: number) => solid([0, 0, 255], size);

export interface Mean { r: number; g: number; b: number; width: number; height: number }
/** The mean color of a PNG (8 or 16 bit, RGB or RGBA, not interlaced), or the reason it isn't one this reads. */
export function mean(png: Buffer): Mean | string {
  if (png.length < 33 || png.readUInt32BE(0) !== 0x89504e47) return 'not a PNG (no signature)';
  let at = 8; let width = 0; let height = 0; let depth = 0; let type = 0; let interlace = 0; const idat: Buffer[] = [];
  while (at + 8 <= png.length) {
    const len = png.readUInt32BE(at); const name = png.toString('latin1', at + 4, at + 8); const data = png.subarray(at + 8, at + 8 + len);
    if (name === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]!; type = data[9]!; interlace = data[12]!; }
    if (name === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  if (interlace !== 0 || (type !== 2 && type !== 6) || (depth !== 8 && depth !== 16)) return `unsupported PNG layout (color type ${type}, depth ${depth}, interlace ${interlace})`;
  const bpp = (type === 2 ? 3 : 4) * (depth / 8);
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= bpp ? px[y * stride + x - bpp]! : 0; const b = y > 0 ? px[(y - 1) * stride + x]! : 0; const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp]! : 0;
      const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
      px[y * stride + x] = (v + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
    }
  }
  const sum = [0, 0, 0]; const step = depth / 8;
  for (let i = 0; i < width * height; i++) for (let k = 0; k < 3; k++) sum[k]! += px[i * bpp + k * step]!;
  const n = width * height;
  return { r: sum[0]! / n, g: sum[1]! / n, b: sum[2]! / n, width, height };
}
export const isRed = (m: Mean): boolean => m.r >= 180 && m.g <= 80 && m.b <= 80;
export const isBlue = (m: Mean): boolean => m.b >= 180 && m.r <= 80 && m.g <= 80;
