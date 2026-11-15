// SHA-256's FIPS 180-4 compression, with a serializable continuation for verified transcript parts.
// OpenSSL's Hash cannot export its state. Persisting these eight words and at most 63 redacted bytes avoids
// decompressing an old transcript at every hub restart. Intake still checks ordinary bytes with node:crypto.
export interface DigestState { words: number[]; bytes: number; tail: string }
const INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotate = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export class Digest {
  private h = Uint32Array.from(INITIAL);
  private w = new Uint32Array(64);
  private tail: Buffer = Buffer.alloc(0);
  private bytes = 0;
  constructor(state?: DigestState) {
    if (!state) return;
    if (!Array.isArray(state.words) || state.words.length !== 8 || state.words.some((v) => !Number.isInteger(v) || v < 0 || v > 0xffffffff)
      || !Number.isSafeInteger(state.bytes) || state.bytes < 0 || typeof state.tail !== 'string') throw Error('invalid SHA-256 continuation');
    this.tail = Buffer.from(state.tail, 'base64');
    if (this.tail.length !== state.bytes % 64 || this.tail.toString('base64') !== state.tail) throw Error('invalid SHA-256 continuation tail');
    this.h.set(state.words); this.bytes = state.bytes;
  }
  private block(b: Uint8Array, at: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++, at += 4) w[i] = b[at]! << 24 | b[at + 1]! << 16 | b[at + 2]! << 8 | b[at + 3]!;
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!, y = w[i - 2]!;
      w[i] = w[i - 16]! + (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) + w[i - 7]! + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10));
    }
    const state = this.h;
    let a = state[0]!, b0 = state[1]!, c = state[2]!, d = state[3]!, e = state[4]!, f = state[5]!, g = state[6]!, h = state[7]!;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0;
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b0) ^ (a & c) ^ (b0 & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b0; b0 = a; a = (t1 + t2) | 0;
    }
    state[0] = state[0]! + a; state[1] = state[1]! + b0; state[2] = state[2]! + c; state[3] = state[3]! + d;
    state[4] = state[4]! + e; state[5] = state[5]! + f; state[6] = state[6]! + g; state[7] = state[7]! + h;
  }
  update(bytes: Uint8Array): this {
    this.bytes += bytes.length;
    if (!Number.isSafeInteger(this.bytes)) throw Error('SHA-256 input exceeds the exact byte-count range');
    let at = 0;
    if (this.tail.length) {
      at = Math.min(64 - this.tail.length, bytes.length);
      this.tail = Buffer.concat([this.tail, bytes.subarray(0, at)]);
      if (this.tail.length < 64) return this;
      this.block(this.tail, 0); this.tail = Buffer.alloc(0);
    }
    for (; at + 64 <= bytes.length; at += 64) this.block(bytes, at);
    this.tail = Buffer.from(bytes.subarray(at));
    return this;
  }
  state(): DigestState { return { words: [...this.h], bytes: this.bytes, tail: this.tail.toString('base64') }; }
  hex(): string {
    const copy = new Digest(this.state());
    const padding = Buffer.alloc(this.tail.length < 56 ? 64 - this.tail.length : 128 - this.tail.length);
    padding[0] = 0x80;
    padding.writeBigUInt64BE(BigInt(this.bytes) * 8n, padding.length - 8);
    copy.update(padding);
    return [...copy.h].map((word) => word.toString(16).padStart(8, '0')).join('');
  }
}
