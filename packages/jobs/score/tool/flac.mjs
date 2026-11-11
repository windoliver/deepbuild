// FLAC as the score renderer writes and reads it (#154; canvas primitives: Score, As built): a stem is 48 kHz stereo
// 24-bit, blocks of 4,096 samples, each channel's subframe the constant, or the fixed predictor of order 0 to 4 whose
// Rice-coded residual is shortest, with the MD5 of the samples in STREAMINFO and the loop region in the Vorbis comment
// as LOOPSTART and LOOPLENGTH. The reader decodes any FLAC stream (fixed and LPC predictors, the stereo modes, wasted
// bits), so a library's takes may be FLAC too.
import { createHash } from 'node:crypto';

const BLOCK = 4096;
const POW = Array.from({ length: 33 }, (_, i) => 2 ** i);

// ---------------------------------------------------------------------------------------------------- bits out
class Writer {
  constructor() { this.buf = new Uint8Array(1 << 16); this.len = 0; this.acc = 0; this.n = 0; }
  byte(v) {
    if (this.len === this.buf.length) { const b = new Uint8Array(this.buf.length * 2); b.set(this.buf); this.buf = b; }
    this.buf[this.len++] = v;
  }
  /** Writes `bits` bits of the non-negative whole `v` (below 2^53), most significant first. */
  put(v, bits) {
    if (bits > 24) {
      const high = Math.floor(v / 16777216);
      this.put(high, bits - 24);
      v -= high * 16777216;
      bits = 24;
    }
    // Fewer than 8 bits held and at most 24 added: below 2^32, so `& 0xff` reads its bytes exactly.
    let acc = this.acc * POW[bits] + v;
    let n = this.n + bits;
    while (n >= 8) {
      n -= 8;
      this.byte((acc / POW[n]) & 0xff);
    }
    this.acc = acc % POW[n];
    this.n = n;
  }
  signed(v, bits) { this.put(v < 0 ? v + 2 ** bits : v, bits); }
  unary(q) { while (q > 24) { this.put(0, 24); q -= 24; } this.put(1, q + 1); }
  align() { if (this.n) this.put(0, 8 - this.n); }
  get length() { return this.len; }
  get bytes() { return this.buf.subarray(0, this.len); }
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
const crc8 = (b, from, to) => { let c = 0; for (let i = from; i < to; i++) c = CRC8[c ^ b[i]]; return c; };
const crc16 = (b, from, to) => { let c = 0; for (let i = from; i < to; i++) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ b[i]]; return c; };

/** The UTF-8-like coding of a frame number. */
function utf8Number(w, v) {
  if (v < 0x80) return w.put(v, 8);
  let bytes = 2;
  while (v >= 2 ** (5 * bytes + 1)) bytes++;
  const lead = (0xff << (8 - bytes)) & 0xff;
  w.put(lead | Math.floor(v / 2 ** (6 * (bytes - 1))), 8);
  for (let i = bytes - 2; i >= 0; i--) w.put(0x80 | (Math.floor(v / 2 ** (6 * i)) & 0x3f), 8);
}

/** The zigzagged residual of the fixed predictor of `order` over `x`, from sample `order` on. */
function residual(x, order) {
  const n = x.length;
  const u = new Float64Array(n - order);
  for (let i = order; i < n; i++) {
    let p = 0;
    if (order === 1) p = x[i - 1];
    else if (order === 2) p = 2 * x[i - 1] - x[i - 2];
    else if (order === 3) p = 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3];
    else if (order === 4) p = 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4];
    const r = x[i] - p;
    u[i - order] = r >= 0 ? 2 * r : -2 * r - 1;
  }
  return u;
}

/** The Rice parameter for `count` values summing to `sum`, chosen in whole numbers only, and its estimated bits. */
function rice(count, sum) {
  let k = 0;
  while (k < 30 && count * 2 ** (k + 1) <= sum) k++;
  return { k, bits: count * (k + 1) + Math.floor(sum / 2 ** k) };
}

/** The partition order and parameters that code the residual `u` of an `n`-sample block shortest, by estimate. */
function partitions(u, n, order) {
  let max = 0;
  while (max < 6 && n % 2 ** (max + 1) === 0 && n / 2 ** (max + 1) > order) max++;
  let sums = [];
  let counts = [];
  const size = n / 2 ** max;
  for (let k = 0, at = 0; k < 2 ** max; k++) {
    const end = (k + 1) * size - order;
    let s = 0;
    for (let i = at; i < end; i++) s += u[i];
    sums.push(s); counts.push(end - at); at = end;
  }
  let best;
  for (let p = max; p >= 0; p--) {
    const params = sums.map((s, k) => rice(counts[k], s));
    const bits = 6 + params.reduce((a, r) => a + 5 + r.bits, 0);
    if (!best || bits < best.bits) best = { p, ks: params.map((r) => r.k), bits };
    sums = sums.flatMap((s, k) => (k % 2 ? [] : [s + sums[k + 1]])).filter((v) => v !== undefined);
    counts = counts.flatMap((c, k) => (k % 2 ? [] : [c + counts[k + 1]])).filter((v) => v !== undefined);
  }
  return best;
}

/** The cheapest coding of one channel's block: constant, verbatim, or a fixed predictor, with its cost in bits. */
function plan(x, bps) {
  const n = x.length;
  if (x.every((v) => v === x[0])) return { kind: 'constant', bits: 8 + bps };
  let best;
  for (let order = 0; order <= 4 && order < n; order++) {
    const u = residual(x, order);
    const coded = partitions(u, n, order);
    const bits = 8 + order * bps + coded.bits;
    if (!best || bits < best.bits) best = { kind: 'fixed', order, u, coded, bits };
  }
  return best.bits >= 8 + n * bps ? { kind: 'verbatim', bits: 8 + n * bps } : best;
}

function subframe(w, x, bps, p) {
  const n = x.length;
  if (p.kind === 'constant') {
    w.put(0, 8);
    return w.signed(x[0], bps);
  }
  if (p.kind === 'verbatim') {
    w.put(2, 8);
    for (const v of x) w.signed(v, bps);
    return;
  }
  w.put((8 | p.order) << 1, 8);
  for (let i = 0; i < p.order; i++) w.signed(x[i], bps);
  w.put(1, 2); // RICE2
  w.put(p.coded.p, 4);
  const parts = 2 ** p.coded.p;
  const size = n / parts;
  for (let k = 0, at = 0; k < parts; k++) {
    const end = (k + 1) * size - p.order;
    const param = p.coded.ks[k];
    w.put(param, 5);
    const unit = 2 ** param;
    for (let i = at; i < end; i++) {
      const q = Math.floor(p.u[i] / unit);
      w.unary(q);
      w.put(p.u[i] - q * unit, param);
    }
    at = end;
  }
}

/**
 * A stereo block's cheapest channel assignment: left and right, left and side, side and right, or mid and side
 * (side = left − right at one more bit, mid = ⌊(left + right) ÷ 2⌋), each channel with its own coding.
 */
function stereo(l, r, bps) {
  const n = l.length;
  const side = new Float64Array(n);
  const mid = new Float64Array(n);
  for (let i = 0; i < n; i++) { side[i] = l[i] - r[i]; mid[i] = Math.floor((l[i] + r[i]) / 2); }
  const L = plan(l, bps), R = plan(r, bps), S = plan(side, bps + 1), M = plan(mid, bps);
  const options = [
    { code: 1, subs: [[l, bps, L], [r, bps, R]] },
    { code: 8, subs: [[l, bps, L], [side, bps + 1, S]] },
    { code: 9, subs: [[side, bps + 1, S], [r, bps, R]] },
    { code: 10, subs: [[mid, bps, M], [side, bps + 1, S]] },
  ];
  let best = options[0];
  const cost = (o) => o.subs[0][2].bits + o.subs[1][2].bits;
  for (const o of options) if (cost(o) < cost(best)) best = o;
  return best;
}

/** The bytes of a Vorbis comment block's body: vendor and `KEY=value` comments. */
function comment(tags) {
  const enc = new TextEncoder();
  const vendor = enc.encode('deepbuild score-render');
  const list = Object.entries(tags).map(([k, v]) => enc.encode(`${k}=${v}`));
  const out = [];
  const le32 = (v) => out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  le32(vendor.length); out.push(...vendor);
  le32(list.length);
  for (const c of list) { le32(c.length); out.push(...c); }
  return out;
}

/**
 * A FLAC file of `channels` (arrays of whole samples, `bps` bits each) at `rate`, its loop region `{start, end}` in
 * the Vorbis comment when given.
 */
export function encode(channels, rate, bps, loop) {
  const total = channels[0].length;
  const nch = channels.length;
  // MD5 of the samples, interleaved, little-endian, ceil(bps/8) bytes each.
  const width = Math.ceil(bps / 8);
  const raw = Buffer.alloc(total * nch * width);
  let o = 0;
  for (let i = 0; i < total; i++) {
    for (let c = 0; c < nch; c++) o = raw.writeIntLE(channels[c][i], o, width);
  }
  const md5 = createHash('md5').update(raw).digest();

  const out = new Writer();
  for (const v of [0x66, 0x4c, 0x61, 0x43]) out.byte(v); // fLaC
  const tags = loop ? { LOOPSTART: loop.start, LOOPLENGTH: loop.end - loop.start } : {};
  const body = comment(tags);
  // STREAMINFO
  const si = new Writer();
  si.put(BLOCK, 16); si.put(BLOCK, 16); si.put(0, 24); si.put(0, 24);
  si.put(rate, 20); si.put(nch - 1, 3); si.put(bps - 1, 5); si.put(total, 36);
  for (const v of [0x00, 0, 0, 34, ...si.bytes, ...md5]) out.byte(v);
  for (const v of [0x84, (body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff, ...body]) out.byte(v);

  const rateCode = rate === 48000 ? 10 : rate === 44100 ? 9 : 0;
  const bpsCode = bps === 24 ? 6 : bps === 16 ? 4 : 0;
  for (let f = 0, start = 0; start < total; f++, start += BLOCK) {
    const n = Math.min(BLOCK, total - start);
    const w = new Writer();
    w.put(0x3ffe, 14); w.put(0, 1); w.put(0, 1);
    w.put(n === BLOCK ? 12 : 7, 4); // 4096, or 16 bits of n − 1 at the end
    w.put(rateCode || 12, 4);
    const block = channels.map((c) => c.subarray(start, start + n));
    const coded = nch === 2 ? stereo(block[0], block[1], bps) : { code: nch - 1, subs: block.map((x) => [x, bps, plan(x, bps)]) };
    w.put(coded.code, 4);
    w.put(bpsCode, 3); w.put(0, 1);
    utf8Number(w, f);
    if (n !== BLOCK) w.put(n - 1, 16);
    if (!rateCode) w.put(rate / 1000, 8);
    w.put(crc8(w.bytes, 0, w.length), 8);
    for (const [x, b, p] of coded.subs) subframe(w, x, b, p);
    w.align();
    const c16 = crc16(w.bytes, 0, w.length);
    w.put(c16, 16);
    for (const v of w.bytes) out.byte(v);
  }
  return out.bytes.slice();
}

// ---------------------------------------------------------------------------------------------------- bits in
class Reader {
  constructor(b, at) { this.b = b; this.pos = at * 8; }
  get(bits) {
    let v = 0;
    for (let i = 0; i < bits; i++) {
      const byte = this.b[this.pos >> 3];
      if (byte === undefined) throw Error('the FLAC stream ends inside a frame');
      v = v * 2 + ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }
  signed(bits) { if (!bits) return 0; const v = this.get(bits); return v >= 2 ** (bits - 1) ? v - 2 ** bits : v; }
  unary() { let q = 0; while (this.get(1) === 0) q++; return q; }
  align() { this.pos = (this.pos + 7) & ~7; }
}

function readResidual(r, n, order, out) {
  const method = r.get(2);
  const pbits = method === 1 ? 5 : 4;
  const escape = method === 1 ? 31 : 15;
  const p = r.get(4);
  const parts = 2 ** p;
  let at = order;
  for (let k = 0; k < parts; k++) {
    const count = k === 0 ? n / parts - order : n / parts;
    const param = r.get(pbits);
    if (param === escape) {
      const bits = r.get(5);
      for (let i = 0; i < count; i++) out[at++] = r.signed(bits);
    } else {
      for (let i = 0; i < count; i++) {
        const u = r.unary() * 2 ** param + r.get(param);
        out[at++] = u % 2 ? -(u + 1) / 2 : u / 2;
      }
    }
  }
}

function readSubframe(r, n, bps) {
  r.get(1);
  const type = r.get(6);
  let wasted = 0;
  if (r.get(1)) { wasted = 1; while (r.get(1) === 0) wasted++; }
  const b = bps - wasted;
  const x = new Float64Array(n);
  if (type === 0) x.fill(r.signed(b));
  else if (type === 1) for (let i = 0; i < n; i++) x[i] = r.signed(b);
  else if (type >= 8 && type <= 12) {
    const order = type - 8;
    for (let i = 0; i < order; i++) x[i] = r.signed(b);
    readResidual(r, n, order, x);
    const C = [[], [1], [2, -1], [3, -3, 1], [4, -6, 4, -1]][order];
    for (let i = order; i < n; i++) { let p = 0; for (let j = 0; j < order; j++) p += C[j] * x[i - 1 - j]; x[i] += p; }
  } else if (type >= 32) {
    const order = type - 31;
    for (let i = 0; i < order; i++) x[i] = r.signed(b);
    const precision = r.get(4) + 1;
    const shift = r.signed(5);
    const coef = [];
    for (let i = 0; i < order; i++) coef.push(r.signed(precision));
    readResidual(r, n, order, x);
    for (let i = order; i < n; i++) {
      let p = 0;
      for (let j = 0; j < order; j++) p += coef[j] * x[i - 1 - j];
      x[i] += Math.floor(p / 2 ** shift);
    }
  } else throw Error(`a FLAC subframe of reserved type ${type}`);
  if (wasted) for (let i = 0; i < n; i++) x[i] *= 2 ** wasted;
  return x;
}

/** A FLAC file's `{rate, bps, channels: Float64Array[] of whole samples, loop: {start, end} | null}`. */
export function decode(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] !== 0x66 || b[1] !== 0x4c || b[2] !== 0x61 || b[3] !== 0x43) throw Error('not a FLAC file');
  let at = 4;
  let rate = 0, nch = 0, bps = 0, total = 0;
  const tags = {};
  for (;;) {
    const last = b[at] & 0x80;
    const type = b[at] & 0x7f;
    const len = (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3];
    const body = at + 4;
    if (type === 0) {
      const r = new Reader(b, body + 10);
      rate = r.get(20); nch = r.get(3) + 1; bps = r.get(5) + 1; total = r.get(36);
    } else if (type === 4) {
      const le = (p) => b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] * 2 ** 24);
      let p = body;
      p += 4 + le(p);
      const count = le(p); p += 4;
      for (let i = 0; i < count; i++) {
        const l = le(p); p += 4;
        const text = new TextDecoder().decode(b.subarray(p, p + l)); p += l;
        const eq = text.indexOf('=');
        if (eq > 0) tags[text.slice(0, eq).toUpperCase()] = text.slice(eq + 1);
      }
    }
    at = body + len;
    if (last) break;
  }
  const channels = Array.from({ length: nch }, () => new Float64Array(total));
  let filled = 0;
  while (filled < total && at < b.length) {
    const r = new Reader(b, at);
    if (r.get(14) !== 0x3ffe) throw Error('a FLAC frame without its sync code');
    r.get(2);
    const bsCode = r.get(4);
    const rCode = r.get(4);
    const chCode = r.get(4);
    const sCode = r.get(3);
    r.get(1);
    let lead = r.get(8);
    while (lead & 0x80) { lead = (lead << 1) & 0xff; if (lead & 0x80) r.get(8); }
    let n;
    if (bsCode === 1) n = 192;
    else if (bsCode >= 2 && bsCode <= 5) n = 576 * 2 ** (bsCode - 2);
    else if (bsCode === 6) n = r.get(8) + 1;
    else if (bsCode === 7) n = r.get(16) + 1;
    else n = 256 * 2 ** (bsCode - 8);
    if (rCode === 12) r.get(8); else if (rCode === 13 || rCode === 14) r.get(16);
    r.get(8);
    const fbps = [bps, 8, 12, 0, 16, 20, 24, 32][sCode] || bps;
    const side = chCode >= 8 ? chCode : -1;
    const subs = [];
    for (let c = 0; c < nch; c++) {
      const extra = (side === 8 && c === 1) || (side === 9 && c === 0) || (side === 10 && c === 1) ? 1 : 0;
      subs.push(readSubframe(r, n, fbps + extra));
    }
    if (side === 8) for (let i = 0; i < n; i++) subs[1][i] = subs[0][i] - subs[1][i];
    else if (side === 9) for (let i = 0; i < n; i++) subs[0][i] = subs[0][i] + subs[1][i];
    else if (side === 10) {
      for (let i = 0; i < n; i++) {
        const s = subs[1][i];
        const m = subs[0][i] * 2 + (s & 1);
        subs[0][i] = (m + s) / 2;
        subs[1][i] = (m - s) / 2;
      }
    }
    for (let c = 0; c < nch; c++) channels[c].set(subs[c].subarray(0, Math.min(n, total - filled)), filled);
    filled += n;
    r.align();
    r.get(16);
    at = r.pos >> 3;
  }
  const start = Number(tags.LOOPSTART);
  const length = Number(tags.LOOPLENGTH);
  const loop = Number.isSafeInteger(start) && Number.isSafeInteger(length) && length > 0 ? { start, end: start + length } : null;
  return { rate, bps, channels, loop };
}
