// This suite's own FLAC reader (test code): a stem's samples, its STREAMINFO and its Vorbis comments, read from the
// bytes score.render@1 wrote, so no reading of a stem goes through the product's decoder. It follows the FLAC format
// as published (RFC 9639): STREAMINFO, VORBIS_COMMENT, frames with CONSTANT, VERBATIM, FIXED and LPC subframes, Rice
// residuals (both parameter widths, escapes), wasted bits and the three stereo decorrelations. Every frame's CRC-8 and
// CRC-16 is checked, and the stream's MD5 when it states one; a stream that breaks any of these is refused, naming
// where, so a stem that isn't valid FLAC fails the test that reads it.
import { createHash } from 'node:crypto';

export interface Flac {
  rate: number;
  channels: number;
  bits: number;
  /** Sample frames, as STREAMINFO states them (0 when unknown) and as decoded. */
  stated: number;
  frames: number;
  /** One array per channel, the integer samples. */
  samples: Int32Array[];
  /** Vorbis comments, each key upper case; a key given twice keeps its first value. */
  comments: Record<string, string>;
}

class Bits {
  pos = 0;
  private readonly b: Uint8Array;
  constructor(b: Uint8Array) { this.b = b; }
  get byte(): number { return this.pos >> 3; }
  left(): number { return this.b.length * 8 - this.pos; }
  read(n: number): number {
    if (n === 0) return 0;
    if (n > this.left()) throw Error('the stream ends inside a frame');
    let v = 0;
    while (n > 0) {
      const at = this.pos >> 3;
      const avail = 8 - (this.pos & 7);
      const take = Math.min(avail, n);
      const bits = (this.b[at]! >> (avail - take)) & ((1 << take) - 1);
      v = v * (1 << take) + bits;
      this.pos += take;
      n -= take;
    }
    return v;
  }
  signed(n: number): number {
    if (n === 0) return 0;
    const u = this.read(n);
    return u >= 2 ** (n - 1) ? u - 2 ** n : u;
  }
  unary(): number {
    let n = 0;
    for (;;) {
      if (this.pos >= this.b.length * 8) throw Error('the stream ends inside a unary code');
      const at = this.pos >> 3;
      const shift = this.pos & 7;
      const rest = (this.b[at]! << shift) & 0xff;
      if (rest === 0) { n += 8 - shift; this.pos += 8 - shift; continue; }
      const z = Math.clz32(rest) - 24;
      n += z;
      this.pos += z + 1;
      return n;
    }
  }
  align(): void { this.pos = (this.pos + 7) & ~7; }
}

const CRC8 = new Uint8Array(256);
const CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  CRC8[i] = c;
  let d = i << 8;
  for (let k = 0; k < 8; k++) d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xffff : (d << 1) & 0xffff;
  CRC16[i] = d;
}
const crc8 = (b: Uint8Array, from: number, to: number): number => { let c = 0; for (let i = from; i < to; i++) c = CRC8[c ^ b[i]!]!; return c; };
const crc16 = (b: Uint8Array, from: number, to: number): number => { let c = 0; for (let i = from; i < to; i++) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ b[i]!]!; return c; };

const RATES = [0, 88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000];
const SIZES = [0, 8, 12, 0, 16, 20, 24, 32];
const FIXED: number[][] = [[], [1], [2, -1], [3, -3, 1], [4, -6, 4, -1]];

function residual(r: Bits, out: Int32Array, order: number, block: number): void {
  const method = r.read(2);
  if (method > 1) throw Error(`reserved residual coding method ${method}`);
  const width = method === 0 ? 4 : 5;
  const escape = (1 << width) - 1;
  const partitions = r.read(4);
  const per = block >> partitions;
  if ((per << partitions) !== block || per < order) throw Error(`partition order ${partitions} doesn't fit a block of ${block}`);
  let i = order;
  for (let p = 0; p < 1 << partitions; p++) {
    const k = r.read(width);
    const end = (p + 1) * per;
    if (k === escape) {
      const n = r.read(5);
      for (; i < end; i++) out[i] = r.signed(n);
      continue;
    }
    for (; i < end; i++) {
      const u = r.unary() * 2 ** k + r.read(k);
      out[i] = u % 2 === 0 ? u / 2 : -(u + 1) / 2;
    }
  }
}

function subframe(r: Bits, block: number, bps: number): Int32Array {
  if (r.read(1) !== 0) throw Error('a subframe header must start with a zero bit');
  const type = r.read(6);
  let wasted = 0;
  if (r.read(1) === 1) wasted = r.unary() + 1;
  const bits = bps - wasted;
  const out = new Int32Array(block);
  if (type === 0) {
    out.fill(r.signed(bits));
  } else if (type === 1) {
    for (let i = 0; i < block; i++) out[i] = r.signed(bits);
  } else if (type >= 8 && type <= 12) {
    const order = type - 8;
    for (let i = 0; i < order; i++) out[i] = r.signed(bits);
    residual(r, out, order, block);
    const c = FIXED[order]!;
    for (let i = order; i < block; i++) {
      let s = 0;
      for (let j = 0; j < order; j++) s += c[j]! * out[i - 1 - j]!;
      out[i] = out[i]! + s;
    }
  } else if (type >= 32) {
    const order = type - 31;
    for (let i = 0; i < order; i++) out[i] = r.signed(bits);
    const precision = r.read(4) + 1;
    if (precision === 16) throw Error('invalid LPC coefficient precision');
    const shift = r.signed(5);
    if (shift < 0) throw Error('negative LPC shift');
    const coef: number[] = [];
    for (let j = 0; j < order; j++) coef.push(r.signed(precision));
    residual(r, out, order, block);
    const div = 2 ** shift;
    for (let i = order; i < block; i++) {
      let s = 0;
      for (let j = 0; j < order; j++) s += coef[j]! * out[i - 1 - j]!;
      out[i] = out[i]! + Math.floor(s / div);
    }
  } else {
    throw Error(`reserved subframe type ${type}`);
  }
  if (wasted) for (let i = 0; i < block; i++) out[i] = out[i]! * 2 ** wasted;
  return out;
}

/** Decodes a whole FLAC stream; throws, naming what is wrong, on anything that isn't valid FLAC. */
export function readFlac(bytes: Uint8Array): Flac {
  const b = bytes;
  if (b.length < 42 || String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) !== 'fLaC') throw Error('not a FLAC stream: no fLaC marker');
  let at = 4;
  let info: { rate: number; channels: number; bits: number; stated: number; md5: string } | null = null;
  const comments: Record<string, string> = {};
  for (let last = false; !last;) {
    if (at + 4 > b.length) throw Error('the stream ends inside its metadata');
    last = (b[at]! & 0x80) !== 0;
    const type = b[at]! & 0x7f;
    const len = (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!;
    const body = b.subarray(at + 4, at + 4 + len);
    if (body.length !== len) throw Error('a metadata block runs past the stream');
    if (type === 0) {
      const r = new Bits(body);
      r.read(16); r.read(16); r.read(24); r.read(24);
      const rate = r.read(20);
      const channels = r.read(3) + 1;
      const bits = r.read(5) + 1;
      const stated = r.read(36);
      const md5 = Buffer.from(body.subarray(18, 34)).toString('hex');
      info = { rate, channels, bits, stated, md5 };
    } else if (type === 4) {
      const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
      let o = 0;
      const vendor = dv.getUint32(o, true); o += 4 + vendor;
      const count = dv.getUint32(o, true); o += 4;
      for (let k = 0; k < count; k++) {
        const n = dv.getUint32(o, true); o += 4;
        const text = Buffer.from(body.subarray(o, o + n)).toString('utf8'); o += n;
        const eq = text.indexOf('=');
        if (eq <= 0) continue;
        const key = text.slice(0, eq).toUpperCase();
        if (!(key in comments)) comments[key] = text.slice(eq + 1);
      }
    }
    at += 4 + len;
  }
  if (!info) throw Error('no STREAMINFO block');
  const chans: Int32Array[][] = Array.from({ length: info.channels }, () => []);
  let frames = 0;
  const r = new Bits(b);
  r.pos = at * 8;
  while (r.left() >= 8 * 8) {
    const start = r.byte;
    if (r.read(14) !== 0x3ffe) throw Error(`no frame sync at byte ${start}`);
    if (r.read(1) !== 0) throw Error(`reserved bit set in the frame at byte ${start}`);
    r.read(1);
    const bsCode = r.read(4);
    const srCode = r.read(4);
    const chCode = r.read(4);
    const ssCode = r.read(3);
    r.read(1);
    // The frame or sample number, UTF-8 coded.
    const first = r.read(8);
    let more = 0;
    for (let m = 0x80; first & m && m > 1; m >>= 1) more++;
    for (let k = 1; k < more; k++) r.read(8);
    let block = 0;
    if (bsCode === 1) block = 192;
    else if (bsCode >= 2 && bsCode <= 5) block = 576 << (bsCode - 2);
    else if (bsCode === 6) block = r.read(8) + 1;
    else if (bsCode === 7) block = r.read(16) + 1;
    else if (bsCode >= 8) block = 256 << (bsCode - 8);
    else throw Error(`reserved block size in the frame at byte ${start}`);
    let rate = info.rate;
    if (srCode >= 1 && srCode <= 11) rate = RATES[srCode]!;
    else if (srCode === 12) rate = r.read(8) * 1000;
    else if (srCode === 13) rate = r.read(16);
    else if (srCode === 14) rate = r.read(16) * 10;
    else if (srCode === 15) throw Error(`invalid sample rate code in the frame at byte ${start}`);
    if (rate !== info.rate) throw Error(`the frame at byte ${start} is at ${rate} Hz, the stream at ${info.rate}`);
    const bps = ssCode === 0 ? info.bits : SIZES[ssCode]!;
    if (!bps) throw Error(`reserved sample size in the frame at byte ${start}`);
    const headerEnd = r.byte;
    const crc = r.read(8);
    if (crc !== crc8(b, start, headerEnd)) throw Error(`the frame header at byte ${start} fails its CRC-8`);
    const n = chCode < 8 ? chCode + 1 : 2;
    if (chCode > 10) throw Error(`reserved channel assignment in the frame at byte ${start}`);
    if (n !== info.channels) throw Error(`the frame at byte ${start} has ${n} channels, the stream ${info.channels}`);
    const subs: Int32Array[] = [];
    for (let c = 0; c < n; c++) {
      const side = (chCode === 8 && c === 1) || (chCode === 9 && c === 0) || (chCode === 10 && c === 1);
      subs.push(subframe(r, block, bps + (side ? 1 : 0)));
    }
    r.align();
    const footer = r.read(16);
    if (footer !== crc16(b, start, r.byte - 2)) throw Error(`the frame at byte ${start} fails its CRC-16`);
    if (chCode >= 8) {
      const [a, s] = [subs[0]!, subs[1]!];
      for (let i = 0; i < block; i++) {
        if (chCode === 8) s[i] = a[i]! - s[i]!;
        else if (chCode === 9) a[i] = a[i]! + s[i]!;
        else {
          const mid = a[i]! * 2 + (s[i]! & 1);
          a[i] = (mid + s[i]!) >> 1;
          s[i] = (mid - s[i]!) >> 1;
        }
      }
    }
    subs.forEach((s, c) => chans[c]!.push(s));
    frames += block;
  }
  const samples = chans.map((parts) => {
    const out = new Int32Array(frames);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  });
  if (info.stated && info.stated !== frames) throw Error(`STREAMINFO states ${info.stated} sample frames and the frames hold ${frames}`);
  if (!/^0+$/.test(info.md5)) {
    const width = Math.ceil(info.bits / 8);
    const buf = Buffer.alloc(frames * info.channels * width);
    let o = 0;
    for (let i = 0; i < frames; i++) for (const ch of samples) { buf.writeIntLE(ch[i]!, o, width); o += width; }
    const md5 = createHash('md5').update(buf).digest('hex');
    if (md5 !== info.md5) throw Error(`the decoded samples' MD5 ${md5} isn't the ${info.md5} STREAMINFO states`);
  }
  return { rate: info.rate, channels: info.channels, bits: info.bits, stated: info.stated, frames, samples, comments };
}

/** A sample as a fraction of full scale, for a stream of `bits` bits. */
export const full = (bits: number): number => 2 ** (bits - 1);
