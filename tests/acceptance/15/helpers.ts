// Shared test-side tools for the issue #15 acceptance tests. They build inputs and read what landed on
// disk; none of them stands in for the store.

import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import type { License, PutResult, TextRequest, Writer } from '../../../packages/evidence/src/index.ts';

export const DAY = 86_400_000;
/** 2026-10-01 12:00 UTC: every test starts its fake clock here. */
export const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);

export const anyUse: License = { name: 'CC0-1.0', allows: ['export', 'report', 'post'] };

export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function word(rng: Rng, length: number, alphabet = ALNUM): string {
  let s = '';
  for (let i = 0; i < length; i++) s += alphabet[Math.floor(rng() * alphabet.length)];
  return s;
}

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export const utf8 = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));
export const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');

const roots: string[] = [];
/** A fresh store root under the OS temp folder; removeRoots() deletes every one made. */
export function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'deep-evidence-15-'));
  roots.push(dir);
  return dir;
}
export function removeRoots(): void {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}
/** Every file under root whose bytes contain needle. */
export function filesContaining(root: string, needle: Uint8Array | string): string[] {
  const n = Buffer.from(needle);
  return walk(root).filter((path) => readFileSync(path).includes(n));
}
/** Every file under root whose bytes are exactly these. */
export function filesEqual(root: string, bytes: Uint8Array): string[] {
  const b = Buffer.from(bytes);
  return walk(root).filter((path) => readFileSync(path).equals(b));
}
/** Files at the layout <root>/ab/cdef… for this hash, with or without an extension after the name. */
export function layoutFiles(root: string, hash: string): string[] {
  let names: string[];
  try {
    names = readdirSync(join(root, hash.slice(0, 2)));
  } catch {
    return [];
  }
  const rest = hash.slice(2);
  return names.filter((name) => name === rest || name.startsWith(`${rest}.`)).map((name) => join(root, hash.slice(0, 2), name));
}

// ---- Media.
function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}
/** A valid RGB PNG of seeded noise. level 0 stores the pixels uncompressed, for a file of a known size. */
export function png(width: number, height: number, seed: number, level = 6): Uint8Array {
  const rng = mulberry32(seed);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width * 3; x++) raw[y * (width * 3 + 1) + 1 + x] = Math.floor(rng() * 256);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level })),
    chunk('IEND', new Uint8Array()),
  ]));
}
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
/** A 64×64 baseline JPEG made by ffmpeg 8.1 (testsrc, -bitexact): SOI … EOI. */
export const jpegFixture = () => fixture('sample.jpg');
/** A one-second 64×64 MPEG-4 file made by ffmpeg 8.1 (testsrc, -bitexact): ftyp, free, mdat, then moov. */
export const mp4Fixture = () => fixture('sample.mp4');

// ---- The forms a scrub-list value can be printed in.
const pct = (bytes: Uint8Array, upper: boolean) => {
  let s = '';
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    if (/[A-Za-z0-9\-_.~]/.test(ch)) s += ch;
    else { const h = b.toString(16).padStart(2, '0'); s += `%${upper ? h.toUpperCase() : h}`; }
  }
  return s;
};
export const urlEncode = (value: string, upper = true) => pct(utf8(value), upper);
const toUrlSafe = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Base64 of `lead + value`, and its core: the characters that depend on the value's bytes alone, which
 * appear in any base64 stream that carries the value after a number of bytes ≡ lead.length (mod 3).
 */
export function base64Form(value: Uint8Array, lead: Uint8Array, alphabet: 'standard' | 'url-safe'): { printed: string; core: string } {
  const k = lead.length;
  const n = value.length;
  const std = Buffer.concat([lead, value]).toString('base64');
  const start = Math.ceil((8 * k) / 6);
  const end = Math.floor((8 * (k + n)) / 6);
  const pick = alphabet === 'standard' ? (s: string) => s : toUrlSafe;
  return { printed: pick(std), core: pick(std.slice(start, end)) };
}

export interface Form { name: string; printed: string; core: string }
/** Raw, URL-encoded in both hex cases, and base64 after 0, 1 and 2 leading bytes in both alphabets. */
export function everyForm(value: string): Form[] {
  const bytes = utf8(value);
  const forms: Form[] = [
    { name: 'raw', printed: value, core: value },
    { name: 'URL-encoded, upper-case hex', printed: urlEncode(value, true), core: urlEncode(value, true) },
    { name: 'URL-encoded, lower-case hex', printed: urlEncode(value, false), core: urlEncode(value, false) },
  ];
  for (const alphabet of ['standard', 'url-safe'] as const) {
    for (const k of [0, 1, 2]) {
      const lead = utf8('user:'.slice(5 - k)); // '', ':', 'r:'
      forms.push({ name: `base64 ${alphabet} at offset ${k}`, ...base64Form(bytes, lead, alphabet) });
    }
  }
  return forms;
}

/** Writes chunks to a new text sink and closes it. */
export async function storeText(writer: Writer, request: TextRequest, chunks: (string | Uint8Array)[]): Promise<PutResult> {
  const sink = writer.text(request);
  for (const c of chunks) await sink.write(c);
  return sink.close();
}
/** Cuts bytes at the given offsets (any order, duplicates and out-of-range offsets dropped). */
export function cut(bytes: Uint8Array, offsets: number[]): Uint8Array[] {
  const points = [...new Set(offsets.filter((o) => o > 0 && o < bytes.length))].sort((a, b) => a - b);
  const out: Uint8Array[] = [];
  let at = 0;
  for (const p of [...points, bytes.length]) { out.push(bytes.slice(at, p)); at = p; }
  return out;
}
export function stored(result: PutResult): string {
  if (result.status !== 'stored') throw Error(`expected the text to be stored, but it was refused: ${result.reason}`);
  return result.evidence.sha256;
}
