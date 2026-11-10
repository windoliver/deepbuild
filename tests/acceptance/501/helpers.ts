// Test-side tools for the #501 acceptance tests: `deep-show` built once per Cargo feature set and driven by one JSON
// scenario on stdin (`deep-show run`, #393's convention, as #488's and #499's suites drive it), with the startup
// `--planted <name>` argument (#200's) for the wrong programs; the seal's startup refusal; the fixture documents and
// sound assets; flick, sample-span and timecode arithmetic in integers; BLAKE3 (a port of the reference
// implementation, checked against the published vectors before it judges anything); a PNG reader; the evidence store;
// the reference-Mac gate; and the Linux x86_64 leg in a linux/amd64 container. Nothing here stands in for the export,
// its targets, the seal, the decode worker, the film viewer or a check: each is read from what `deep-show` answers or
// writes. README: The surface under test.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/501 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetOf = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));

/** Every `it` passes this: a first cargo build can take many minutes. */
export const TIMEOUT = 3_600_000;
/** A startup the seal refuses exits with this status, after one JSON line (#305). */
export const REFUSED_EXIT = 2;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #501.b64babc3',
  2: 'AC2 #501.c0a30641',
  3: 'AC3 #501.db25650c',
  4: 'AC4 #501.20b3a55a',
  5: 'AC5 #501.51510fec',
  6: 'AC6 #501.bf5a3338',
  7: 'AC7 #501.bc463962',
  8: 'AC8 #501.c24595f7',
  9: 'AC9 #501.d9bb8d6a',
  10: 'AC10 #501.187057b7',
  11: 'AC11 #501.ce90a876',
  12: 'AC12 #501.b80fff7d',
  13: 'AC13 #501.65512eef',
  14: 'AC14 #501.dfbf3d0b',
  15: 'AC15 #501.4abc923a',
  16: 'AC16 #501.8065fd70',
  17: 'AC17 #501.73117ad9',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and verdict prefixes

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function int(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isSafeInteger(v), `${what} is a whole number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 600)}`).toBe('string');
  return v as string;
}
export function hex64(v: JsonValue | undefined, what: string): string {
  const s = str(v, what);
  expect(/^[0-9a-f]{64}$/.test(s), `${what} is 32 bytes in lower-case hex, got ${s}`).toBe(true);
  return s;
}
export const hexes = (v: JsonValue | undefined, what: string): string[] => arr(v, what).map((h, i) => hex64(h, `${what}[${i}]`));
export const n = (x: number): string => x.toLocaleString('en-US');

/** The criterion stays open, whatever the reason: never a pass (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A platform need is missing here: never a pass. */
export function blocked(reason: string): never {
  return expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.slice(0, 8).join(' | ')}`).toEqual([]);
}
/** A planted program's run: this suite's own check must fail on it, and some failure must name `named`. */
export function failsNaming(failures: readonly string[], named: RegExp, what: string): void {
  expect(failures.length, `${what}: the check fails the planted program`).toBeGreaterThan(0);
  expect(failures.some((f) => named.test(f)), `${what}: a failure names ${named}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Time: flicks (1/705,600,000 s) as integers; sample spans and labels in BigInt.

export const FLICKS = 705_600_000;
const BF = BigInt(FLICKS);
/** Whole seconds (or a fraction that is a whole number of flicks) as flicks. */
export function fl(seconds: number): number {
  const f = Math.round(seconds * FLICKS);
  if (Math.abs(f - seconds * FLICKS) > 1e-3) throw Error(`${seconds} s is not a whole number of flicks`);
  return f;
}
export type Rate = [number, number];
/** A frame rate's frame in flicks, or null when it isn't a whole number (the valid-rates rule). */
export function frameLength([p, q]: Rate): bigint | null {
  const num = BF * BigInt(q);
  return num % BigInt(p) === 0n ? num / BigInt(p) : null;
}
/** Frame k's audio start: ⌊k·Δ × sr ÷ 705,600,000⌋ (Time and the flick), exactly. */
export function spanStart(k: number, rate: Rate, sr: number): number {
  const d = frameLength(rate);
  if (d === null) throw Error(`${rate.join('/')} is not a valid frame rate`);
  return Number((BigInt(k) * d * BigInt(sr)) / BF);
}
/** The design's valid frame rates (Time and the flick: the valid-rates rule), whole and their ×1000/1001 forms. */
export const FRAME_RATES: Rate[] = [8, 12, 15, 16, 18, 20, 24, 25, 30, 48, 50, 60, 72, 75, 90, 96, 100, 120, 144, 240]
  .flatMap((r): Rate[] => [[r, 1], [r * 1000, 1001]]);
/** The design's common sample rates. */
export const SAMPLE_RATES = [8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000, 176400, 192000, 352800];

/** SMPTE labels: frame k's label from the start label and the rate, in closed form (README: Timecode). */
export function nominalFps([p, q]: Rate): number { return Math.round(p / q); }
export function labelToFrames(label: string, rate: Rate): number {
  const m = /^(\d\d):(\d\d):(\d\d)[:;](\d\d)$/.exec(label);
  if (!m) throw Error(`${label} is not HH:MM:SS:FF`);
  const fps = nominalFps(rate);
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * fps + Number(m[4]);
}
/** The label of frame `k` after the start label, non-drop or drop-frame (2 frame numbers a minute at 30000/1001, 4 at
 * 60000/1001, none in each tenth minute: SMPTE ST 12-1's rule). */
export function label(k: number, rate: Rate, start = '00:00:00:00', dropFrame = false): string {
  const fps = nominalFps(rate);
  let f = labelToFrames(start, rate) + k;
  if (dropFrame) {
    const drop = fps === 30 ? 2 : fps === 60 ? 4 : NaN;
    if (Number.isNaN(drop)) throw Error(`no drop-frame count at ${rate.join('/')}`);
    const per10 = 10 * 60 * fps - 9 * drop;
    const perMin = 60 * fps - drop;
    const d = Math.floor(f / per10); const m = f % per10;
    f += 9 * drop * d + (m > drop ? drop * Math.floor((m - drop) / perMin) : 0);
  }
  const ff = f % fps; const s = Math.floor(f / fps);
  const two = (x: number): string => String(x).padStart(2, '0');
  return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}${dropFrame ? ';' : ':'}${two(ff)}`;
}

/** A seeded generator in [0, 1) (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------
// BLAKE3: hash mode, 32-byte output. Ported from BLAKE3's reference implementation (reference_impl/reference_impl.rs
// at BLAKE3-team/BLAKE3 f3149ec5bb, by Jack O'Connor and Samuel Neves; CC0-1.0 OR Apache-2.0, license notice kept
// here). It is the CPU side the criteria name, and it is checked against the published test vectors before use.

const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const PERM = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const CHUNK_START = 1; const CHUNK_END = 2; const PARENT = 4; const ROOT = 8;
const rotr = (x: number, k: number): number => ((x >>> k) | (x << (32 - k))) >>> 0;
function g(s: number[], a: number, b: number, c: number, d: number, x: number, y: number): void {
  s[a] = (s[a]! + s[b]! + x) >>> 0; s[d] = rotr(s[d]! ^ s[a]!, 16);
  s[c] = (s[c]! + s[d]!) >>> 0; s[b] = rotr(s[b]! ^ s[c]!, 12);
  s[a] = (s[a]! + s[b]! + y) >>> 0; s[d] = rotr(s[d]! ^ s[a]!, 8);
  s[c] = (s[c]! + s[d]!) >>> 0; s[b] = rotr(s[b]! ^ s[c]!, 7);
}
function compress(cv: number[], m: number[], counter: number, len: number, flags: number): number[] {
  const s = [...cv, IV[0]!, IV[1]!, IV[2]!, IV[3]!, counter >>> 0, Math.floor(counter / 2 ** 32) >>> 0, len, flags];
  let w = [...m];
  for (let r = 0; r < 7; r++) {
    g(s, 0, 4, 8, 12, w[0]!, w[1]!); g(s, 1, 5, 9, 13, w[2]!, w[3]!); g(s, 2, 6, 10, 14, w[4]!, w[5]!); g(s, 3, 7, 11, 15, w[6]!, w[7]!);
    g(s, 0, 5, 10, 15, w[8]!, w[9]!); g(s, 1, 6, 11, 12, w[10]!, w[11]!); g(s, 2, 7, 8, 13, w[12]!, w[13]!); g(s, 3, 4, 9, 14, w[14]!, w[15]!);
    if (r < 6) w = PERM.map((p) => w[p]!);
  }
  for (let i = 0; i < 8; i++) { s[i] = (s[i]! ^ s[i + 8]!) >>> 0; s[i + 8] = (s[i + 8]! ^ cv[i]!) >>> 0; }
  return s;
}
const blockWords = (b: Uint8Array): number[] => Array.from({ length: 16 }, (_, i) => (b[4 * i]! | (b[4 * i + 1]! << 8) | (b[4 * i + 2]! << 16) | (b[4 * i + 3]! << 24)) >>> 0);
interface Out { cv: number[]; m: number[]; counter: number; len: number; flags: number }
const chaining = (o: Out): number[] => compress(o.cv, o.m, o.counter, o.len, o.flags).slice(0, 8);
function blake3Raw(input: Uint8Array): string {
  const stack: number[][] = [];
  const chunks = Math.max(1, Math.ceil(input.length / 1024));
  let last: Out | null = null;
  for (let c = 0; c < chunks; c++) {
    const start = c * 1024; const end = Math.min(input.length, start + 1024);
    const blocks = Math.max(1, Math.ceil((end - start) / 64));
    let cv = IV; let out: Out | null = null;
    for (let b = 0; b < blocks; b++) {
      const o = start + 64 * b; const len = Math.min(64, end - o);
      const block = new Uint8Array(64); block.set(input.subarray(o, o + len));
      const flags = (b === 0 ? CHUNK_START : 0) | (b === blocks - 1 ? CHUNK_END : 0);
      if (b === blocks - 1) out = { cv, m: blockWords(block), counter: c, len, flags };
      else cv = compress(cv, blockWords(block), c, 64, flags).slice(0, 8);
    }
    if (c === chunks - 1) { last = out; break; }
    let chunkCv = chaining(out!);
    let total = c + 1;
    while ((total & 1) === 0) { chunkCv = compress(IV, [...stack.pop()!, ...chunkCv], 0, 64, PARENT).slice(0, 8); total >>= 1; }
    stack.push(chunkCv);
  }
  let out = last!;
  for (let i = stack.length - 1; i >= 0; i--) out = { cv: IV, m: [...stack[i]!, ...chaining(out)], counter: 0, len: 64, flags: PARENT };
  const s = compress(out.cv, out.m, 0, out.len, out.flags | ROOT);
  const bytes = Buffer.alloc(32);
  for (let i = 0; i < 8; i++) bytes.writeUInt32LE(s[i]!, 4 * i);
  return bytes.toString('hex');
}
/** BLAKE3's published vectors (test_vectors/test_vectors.json at f3149ec5bb: the input is 0, 1, …, 250 repeating) that
 * criterion 11 names, with their 32-byte digests, and the frames they load as (BGRA8, 4 bytes a pixel). */
export const VECTORS = [
  { bytes: 1024, size: [16, 16] as [number, number], digest: '42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7' },
  { bytes: 4096, size: [32, 32] as [number, number], digest: '015094013f57a5277b59d8475c0501042c0b642e531b0a1c8f58d2163229e969' },
  { bytes: 102400, size: [160, 160] as [number, number], digest: 'bc3e3d41a1146b069abffad3c0d44860cf664390afce4d9661f7902e7943e085' },
];
export const vectorInput = (len: number): Buffer => Buffer.from(Array.from({ length: len }, (_, i) => i % 251));
let verified = false;
/** BLAKE3 of `input` on the CPU; the first call checks the port against the published vectors. */
export function blake3(input: Uint8Array): string {
  if (!verified) {
    for (const v of [{ bytes: 0, digest: 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262' }, ...VECTORS]) {
      const got = blake3Raw(vectorInput(v.bytes));
      if (got !== v.digest) throw Error(`the test's BLAKE3 port gives ${got} for the ${v.bytes}-byte vector, not ${v.digest}`);
    }
    verified = true;
  }
  return blake3Raw(input);
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin deep-show --no-default-features --features <set>` once per set per file, copied
// out of the target folder; a test that uses a build that failed fails with cargo's error.

export const FULL = 'full';
export const NO_MEDIA = 'full,test-leave-out-media,test-export-target';
export const NO_MEDIA_PLANTED = 'full,test-leave-out-media,test-export-target,test-export-target-in-media';

function buildTo(features: string, to: string): string {
  const args = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', features];
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(-4000)}`;
  copyFileSync(join(targetOf(), 'debug', exe(SHOW)), to);
  return '';
}
export function useShow(sets: readonly string[]): { bin: (set: string) => string } {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-501-bins-'));
    for (const s of sets) if (!made.has(s)) { const bin = join(dir, `${SHOW}-${s.replace(/,/g, '+')}`); made.set(s, { bin, error: buildTo(s, bin) }); }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(s: string): string {
      const e = made.get(s);
      if (!e) throw Error(`the file didn't list the build ${s} in useShow`);
      expect(e.error, `the binary builds: ${SHOW} with features ${s}`).toBe('');
      return e.bin;
    },
  };
}

/** A fresh folder per call, deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-501-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (README: The surface under test)

interface Ran { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
export const plantedArgs = (planted?: string): string[] => (planted ? ['--planted', planted] : []);
export function start(bin: string, sc: JsonObject, planted?: string): Ran {
  const r = spawnSync(bin, ['run', ...plantedArgs(planted)], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, signal: r.signal, timedOut, lines, stdout, stderr: r.stderr ?? '' };
}
/** `deep-show run [--planted p]`: exit 0, one answer line, ok, one reply per call. */
export function runShow(bin: string, sc: JsonObject, what: string, planted?: string): JsonObject[] {
  const tag = planted ? `${what} (--planted ${planted})` : what;
  return repliesOf(start(bin, sc, planted), sc, tag);
}
export function repliesOf(s: Ran, sc: JsonObject, what: string): JsonObject[] {
  expect(s.timedOut, `${what}: deep-show run finished within its timeout`).toBe(false);
  expect(s.status, `${what}: deep-show run exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 800)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${what}: one answer line`).toBe(1);
  const out = obj(s.lines[0], `${what}: the answer`);
  expect(out['ok'], `${what}: deep-show run answers the scenario ok; got ${show(out)}`).toBe(true);
  const replies = arr(out['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return replies;
}
/** #305's startup refusal: `{"ok": false, "code": "seal_refused", "reason", "modules", "registry"?, "entries"?, …}` and exit 2. */
export function startupRefusal(bin: string, planted?: string): JsonObject {
  const s = start(bin, { evidence: tmpdir(), calls: [{ call: 'registry' }] }, planted);
  const what = `${SHOW} run${planted ? ` --planted ${planted}` : ''}`;
  expect(s.timedOut, `${what} finished within its timeout`).toBe(false);
  expect(s.status, `${what} refuses to start (exit ${REFUSED_EXIT}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1000)}`).toBe(REFUSED_EXIT);
  expect(s.lines.length, `${what}: the refusal is one JSON line, with no reply: ${s.stdout.slice(0, 1500)}`).toBe(1);
  const raw = obj(s.lines[0], `${what}: the refusal line`);
  expect([raw['ok'], raw['code']], `${what}: the line is the seal's refusal: ${show(raw)}`).toEqual([false, 'seal_refused']);
  return raw;
}

const ulid = (k: number): string => `01JB501E${String(k).padStart(18, '0')}`;
export const DOC = { a: ulid(1), b: ulid(2), c: ulid(3) } as const;
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
export const PANEL = 'main';
/** A scenario: the evidence store, your shell's process tree, one panel showing document a, the calls. */
export function scenario(evidence: string, calls: JsonObject[], extra: JsonObject = {}): JsonObject {
  const docs: JsonObject = {};
  for (const id of Object.values(DOC)) docs[id] = { panel: id === DOC.a ? PANEL : `side-${id.slice(-1)}` };
  const panels: JsonObject = { [PANEL]: { rect: [0, 0, 1280, 720] } };
  for (const id of Object.values(DOC)) if (id !== DOC.a) panels[`side-${id.slice(-1)}`] = { rect: [0, 720, 640, 360] };
  return { evidence, sessions: {}, processes: PROCESSES, panels, docs, ...extra, calls };
}
/** `deep show` of a whole document from your shell; the hub stamps the writer layer, so the payload has none. */
export function present(doc: string, document: JsonObject): JsonObject {
  const payload = JSON.parse(JSON.stringify(document)) as JsonObject;
  delete payload['layers'];
  for (const item of Object.values(isObject(payload['items']) ? payload['items'] : {})) if (isObject(item)) delete item['layer'];
  return { call: 'deep show', peer: YOU_PEER, doc, document: payload, include: ['issues'] };
}
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${show(reply)}`).toBe('presented');
}

// ---------------------------------------------------------------------------------------------------
// The export call (README: `export`)

export interface ExportAsk {
  doc: string; out?: string; range?: JsonValue; frame_rate?: Rate; size?: [number, number];
  video?: JsonObject; audio?: JsonObject; timecode?: JsonObject; shards?: number; adapter?: 'software'; readback?: boolean; frames?: number[];
}
export const exportCall = (e: ExportAsk): JsonObject => ({ call: 'export', ...(e as unknown as JsonObject) });
export interface Receipt {
  size: [number, number]; frame_rate: Rate; duration: number; frame_hashes: string[]; pcm_hashes: string[];
  timecode: { start: string; last: string } | null; adapter: { name: string; software: boolean } | null; raw: JsonObject;
}
/** A delivered export's receipt; a missing field fails, naming it. */
export function receiptOf(reply: JsonObject, what: string): Receipt {
  expect(reply['outcome'], `${what} is exported: ${show(reply)}`).toBe('exported');
  const r = obj(reply['receipt'], `${what}: receipt`);
  const size = arr(r['size'], `${what}: receipt.size`).map((v, i) => int(v, `${what}: receipt.size[${i}]`)) as [number, number];
  const rate = arr(r['frame_rate'], `${what}: receipt.frame_rate`).map((v, i) => int(v, `${what}: receipt.frame_rate[${i}]`)) as Rate;
  const tc = r['timecode'] === undefined || r['timecode'] === null ? null : obj(r['timecode'], `${what}: receipt.timecode`);
  const ad = r['adapter'] === undefined || r['adapter'] === null ? null : obj(r['adapter'], `${what}: receipt.adapter`);
  return {
    size, frame_rate: rate, duration: int(r['duration'], `${what}: receipt.duration (flicks)`),
    frame_hashes: hexes(r['frame_hashes'], `${what}: receipt.frame_hashes`),
    pcm_hashes: r['pcm_hashes'] === undefined ? [] : hexes(r['pcm_hashes'], `${what}: receipt.pcm_hashes`),
    timecode: tc ? { start: str(tc['start'], `${what}: receipt.timecode.start`), last: str(tc['last'], `${what}: receipt.timecode.last`) } : null,
    adapter: ad ? { name: str(ad['name'], `${what}: receipt.adapter.name`), software: ad['software'] === true } : null,
    raw: r,
  };
}
/** The plan form's frames: each asked frame's audio samples [first, end) and, with `timecode`, its label. */
export interface Planned { frame: number; samples: [number, number]; timecode: string | null }
export function plannedFrames(reply: JsonObject, asked: number[], what: string): Planned[] {
  expect(reply['outcome'], `${what} is planned: ${show(reply)}`).toBe('planned');
  const list = arr(reply['frames'], `${what}: frames`);
  expect(list.length, `${what}: one entry per frame asked`).toBe(asked.length);
  return list.map((v, i) => {
    const o = obj(v, `${what}: frames[${i}]`);
    const s = arr(o['samples'], `${what}: frames[${i}].samples`);
    expect(s.length, `${what}: frames[${i}].samples is [first, end)`).toBe(2);
    const frame = int(o['frame'], `${what}: frames[${i}].frame`);
    expect(frame, `${what}: frames[${i}] is the frame asked`).toBe(asked[i]);
    return { frame, samples: [int(s[0], `${what}: frames[${i}].samples[0]`), int(s[1], `${what}: frames[${i}].samples[1]`)], timecode: o['timecode'] === undefined ? null : str(o['timecode'], `${what}: frames[${i}].timecode`) };
  });
}

/** Every file under `dir` (relative path → SHA-256 of its bytes), sorted by path. */
export function filesUnder(dir: string): [string, string][] {
  if (!existsSync(dir)) return [];
  const out: [string, string][] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p); else out.push([relative(dir, p), sha256(readFileSync(p))]);
    }
  };
  walk(dir);
  return out;
}
/** A png_seq export's frames: the PNG files under `out`, in name order (README: png_seq files). */
export function pngFrames(out: string, what: string): Buffer[] {
  expect(existsSync(out), `${what}: the export wrote ${out}`).toBe(true);
  const names = readdirSync(out).filter((f) => f.toLowerCase().endsWith('.png')).sort();
  return names.map((f) => readFileSync(join(out, f)));
}

// ---------------------------------------------------------------------------------------------------
// The evidence store (#15's layout: `<2 hex>/<62 hex>`, each file named by its bytes' SHA-256)

export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
export function getEvidence(evidence: string, h: string, what: string): Buffer {
  const path = join(evidence, h.slice(0, 2), h.slice(2));
  expect(existsSync(path), `${what}: the evidence store holds ${h}`).toBe(true);
  const bytes = readFileSync(path);
  expect(sha256(bytes), `${what}: the stored file hashes to its name`).toBe(h);
  return bytes;
}

// ---------------------------------------------------------------------------------------------------
// Sound: 16-bit WAV assets written here; float WAVs read back.

export function wav16(channels: Float32Array[], rate = 48_000): Buffer {
  const nch = channels.length; const frames = channels[0]!.length; const data = frames * nch * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(nch, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * nch * 2, 28); b.writeUInt16LE(nch * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) for (const c of channels) { b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, c[i]!)) * 32767), o); o += 2; }
  return b;
}
export function tone(hz: number, frames: number, amp: number, rate = 48_000): Float32Array {
  const x = new Float32Array(frames);
  for (let i = 0; i < frames; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  return x;
}
/** A float or 16-bit PCM WAV's samples per channel. */
export function readWav(bytes: Buffer, what: string): { rate: number; channels: Float32Array[] } {
  expect(bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE', `${what} is a RIFF WAVE file`).toBe(true);
  let fmt: { tag: number; nch: number; rate: number; bits: number } | null = null; let data: Buffer | null = null;
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', o, o + 4); const size = bytes.readUInt32LE(o + 4); const body = bytes.subarray(o + 8, Math.min(bytes.length, o + 8 + size));
    if (id === 'fmt ') { let tag = body.readUInt16LE(0); if (tag === 0xfffe && body.length >= 26) tag = body.readUInt16LE(24); fmt = { tag, nch: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) }; } else if (id === 'data') data = body;
    o += 8 + size + (size % 2);
  }
  expect(fmt !== null && data !== null, `${what} has fmt and data chunks`).toBe(true);
  const { tag, nch, rate, bits } = fmt!;
  expect((tag === 3 && bits === 32) || (tag === 1 && bits === 16), `${what} is float 32-bit or PCM 16-bit, got format ${tag} at ${bits} bits`).toBe(true);
  const width = bits / 8; const frames = Math.floor(data!.length / (width * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++) { const o = (i * nch + c) * width; channels[c]![i] = tag === 3 ? data!.readFloatLE(o) : data!.readInt16LE(o) / 32768; }
  return { rate, channels };
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: Fixtures). Every time in a document is a literal or flicks.

export const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #501 acceptance tests.' };
const LAYER = 'main';
const LAYERS: JsonObject = { [LAYER]: { writer: 'agent-a', title: 'Main', order: 'a0' } };
export function rect(id: string, box: [number, number, number, number], role: string, order: string, extra: JsonObject = {}): JsonObject {
  return { id, kind: 'rect@1', layer: LAYER, name: `Rect ${id}`, order, params: { box, paint: { fill: { role } } }, ...extra };
}
export function camera2d(size: [number, number]): JsonObject {
  return { id: 'cam', kind: 'camera@1', layer: LAYER, name: 'Camera cam', order: 'a0cam', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] } };
}
const linear = (target: string, a: number, b: number, from: string, to: string): JsonObject =>
  ({ target, type: 'f32', keys: { k0: { t: from, value: a, interp: 'linear' }, k1: { t: to, value: b, interp: 'linear' } } });
function envelope(id: string, profile: string, size: [number, number], items: JsonObject[], extra: JsonObject): JsonObject {
  return {
    format: 1, id, profile, title: `#501 ${id}`, description: `The #501 export acceptance tests' document ${id}.`, size, layers: LAYERS,
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}

/** The film (README: Fixtures): 320 × 180 at 24 fps for 10 s (240 frames), a block sliding across so every frame
 * differs, section markers at 0 s, 4 s and 7 s, and one sound strip, a 10 s stereo tone. */
export const FILM = { size: [320, 180] as [number, number], rate: [24, 1] as Rate, frames: 240, frame: 29_400_000, sections: { s1: 0, s2: 96, s3: 168 } } as const;
export const toneWav = (): Buffer => wav16([tone(440, 480_000, 0.25), tone(660, 480_000, 0.2)]);
export function film(toneSha: string, opts: { missing?: string } = {}): JsonObject {
  const strips: JsonObject = { tone: { track: 1, src: toneSha, start: '0s', in: 0, out: fl(10), rate: 1 } };
  const assets: JsonObject = { tone: { sha256: toneSha, license: LICENSE } };
  if (opts.missing) {
    strips['gap'] = { track: 2, src: opts.missing, start: '1s', in: 0, out: fl(2), rate: 1 };
    assets['gap'] = { sha256: opts.missing, license: LICENSE };
  }
  return envelope('film', 'film', FILM.size, [
    camera2d(FILM.size),
    rect('back', [0, 0, 320, 180], 'ground', 'a1'),
    rect('mover', [0, 60, 40, 60], 'accent', 'a2'),
    rect('bar', [0, 150, 8, 12], 'ink', 'a3'),
  ], {
    camera: 'cam', transport: { span: '10s', frame_rate: [24, 1], sample_rate: 48_000 },
    channels: { slide: linear('items/mover/params/box/0', 0, 280, '0s', '10s'), grow: linear('items/bar/params/box/2', 8, 312, '0s', '10s') },
    markers: { s1: { kind: 'section', t: '0s', name: 'Open' }, s2: { kind: 'section', t: '4s', name: 'Middle' }, s3: { kind: 'section', t: '7s', name: 'End' } },
    strips, assets,
  });
}
/** A figure on the same display (criterion 7): a block that slides for 2 s, with no frame rate of its own. */
export function figure(): JsonObject {
  return envelope('figure', 'figure', [160, 90], [rect('back', [0, 0, 160, 90], 'ground', 'a1'), rect('dot', [0, 30, 20, 20], 'accent', 'a2')], {
    transport: { span: '2s' }, channels: { slide: linear('items/dot/params/box/0', 0, 140, '0s', '2s') },
  });
}
/** 64 × 64 at 24 fps for 1 s with no ground: a block at 50% alpha (`adjust.opacity`) and an opaque one sliding over a
 * transparent frame (criterion 9). */
export function alphaFilm(): JsonObject {
  return envelope('alpha', 'film', [64, 64], [
    camera2d([64, 64]),
    rect('half', [8, 8, 48, 48], 'accent', 'a1', { adjust: { opacity: 0.5 } }),
    rect('solid', [0, 52, 8, 8], 'ink', 'a2'),
  ], { camera: 'cam', transport: { span: '1s', frame_rate: [24, 1] }, channels: { slide: linear('items/solid/params/box/0', 0, 56, '0s', '1s') } });
}
/** The scope fixture (criterion 3): a 3D film, 160 × 90 at 24 fps for 1 s, with a selected box `sel`, a hidden box
 * `ghost` (`visible: false`), a turning box `core` and a cutaway `cut` (view class, cutting nothing by default). */
export function scopeFilm(withGhost = true): JsonObject {
  const box = (id: string, pos: [number, number, number], role: string, order: string, extra: JsonObject = {}): JsonObject =>
    ({ id, kind: 'mark.box@1', layer: LAYER, name: `Box ${id}`, order, params: { size: [1, 1, 1], paint: { fill: { role } } }, at: { pos }, ...extra });
  const items = [
    { id: 'cam', kind: 'camera@1', layer: LAYER, name: 'Camera cam', order: 'a0', params: { projection: 'perspective', position: [0, 1.5, 6], target: [0, 0, 0], fov: 40 } },
    box('sel', [-1.6, 0, 0], 'accent', 'a1'),
    box('core', [0, 0, 0], 'ink', 'a2'),
    ...(withGhost ? [box('ghost', [1.6, 0, 0], 'live', 'a3', { visible: false })] : []),
    { id: 'cut', kind: 'cutaway@1', layer: LAYER, name: 'Cutaway cut', order: 'a4', params: { planes: [{ normal: [1, 0, 0], offset: 100 }], class: 'view' } },
  ];
  return envelope('scope', 'film', [160, 90], items, {
    camera: 'cam', transport: { span: '1s', frame_rate: [24, 1] }, requires: { modules: { scene3d: '^1' } },
    channels: { turn: linear('items/core/at/rot/1', 0, 90, '0s', '1s') },
  });
}
/** The session state criterion 3 sets: `sel` selected, and the cutaway's view input moved to cut through `core`. */
export const SESSION_STATE: JsonObject = { selection: ['sel'], view: { cut: { planes: [{ normal: [1, 0, 0], offset: 0 }] } } };

/** The fixture film's sound as a media document (criterion 10; #499's `media_mix` document): two tones, panned. */
export function filmSound(a: string, b: string): JsonObject {
  return {
    transport: { sample_rate: 48_000, span: fl(4) },
    strips: {
      left: { track: 1, src: { asset: a }, start: 0, in: 0, out: fl(4), pan: -0.4 },
      right: { track: 2, src: { asset: b }, start: fl(0.5), in: 0, out: fl(3), pan: 0.6 },
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// PNG (8-bit RGB or RGBA, no interlace)

export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let p = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (p < file.length) {
    const len = file.readUInt32BE(p); const type = file.toString('latin1', p + 4, p + 8); const body = file.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; } else if (type === 'IDAT') data.push(body); else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const ch = color === 6 ? 4 : 3; const stride = width * ch;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch]! : 0; const b = prev[i]!; const c = i >= ch ? prev[i - ch]! : 0; const x = line[i]!;
      line[i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) rgba[(y * width + x) * 4 + k] = line[x * ch + k]!;
      rgba[(y * width + x) * 4 + 3] = ch === 4 ? line[x * ch + 3]! : 255;
    }
    prev = line;
  }
  return { width, height, rgba };
}
/** The canonical raw buffer of a decoded picture: BGRA8 rows top-down without padding (Export: Semantics). */
export function bgra(img: Image): Buffer {
  const b = Buffer.alloc(img.rgba.length);
  for (let i = 0; i < img.rgba.length; i += 4) { b[i] = img.rgba[i + 2]!; b[i + 1] = img.rgba[i + 1]!; b[i + 2] = img.rgba[i]!; b[i + 3] = img.rgba[i + 3]!; }
  return b;
}
/** An `eval` reply's one snapshot, read as a picture from the evidence store by its SHA-256. */
export function snapshotPicture(evidence: string, reply: JsonObject, what: string): Image {
  expect(reply['outcome'], `${what} is evaluated: ${show(reply)}`).toBe('evaluated');
  const list = arr(reply['snapshots'], `${what}: snapshots`);
  expect(list.length, `${what}: one snapshot`).toBe(1);
  return decodePng(getEvidence(evidence, hex64(obj(list[0], `${what}: snapshots[0]`)['sha256'], `${what}: snapshots[0].sha256`), `${what}: the snapshot`));
}

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate (docs/technical-design.md: The reference Macs), read through the perf lane's own fingerprint.

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
  { model: 'Mac17,10', chip: 'Apple M5 Max', gib: 64 },
];
interface Fingerprint { model: string | null; chip: string | null; memoryBytes: number | null; power: string | null; lowPowerMode: boolean | null; thermalState: string | null }
/** Why this machine isn't a reference Mac, or (with `fit`) isn't on mains power with Low Power Mode off and the thermal
 * state nominal; null when it is. */
export async function referenceMacProblem(fit: boolean): Promise<string | null> {
  if (process.platform !== 'darwin') return `platform ${process.platform}, not a reference Mac`;
  const { fingerprint } = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint(): Fingerprint };
  const m = fingerprint();
  const gib = m.memoryBytes === null ? null : Math.round(m.memoryBytes / 2 ** 30);
  if (!REFERENCE_MACS.some((r) => r.model === m.model && r.chip === m.chip && r.gib === gib)) return `not a reference Mac: ${m.model} / ${m.chip} / ${gib} GiB`;
  if (!fit) return null;
  if (m.power !== 'ac') return `not on mains power (${m.power ?? 'unknown'})`;
  if (m.lowPowerMode !== false) return `Low Power Mode is ${m.lowPowerMode === null ? 'unknown' : 'on'}`;
  if (m.thermalState !== 'nominal') return `the thermal state is ${m.thermalState ?? 'unknown'}, not nominal`;
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Linux x86_64: the same checkout built for linux/amd64 in Docker with the rust image of rust-toolchain.toml's channel,
// its caches under target/acceptance-501-linux/ (#532's leg). Nothing is pulled: a missing image is BLOCKED. The design
// counts this container as the other architecture for CPU checks, recorded as emulated.

export const LINUX = join(REPO, 'target', 'acceptance-501-linux');
export function linuxImage(): string {
  const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1];
  if (!channel) throw Error('rust-toolchain.toml names no channel');
  return `rust:${channel}-slim-bookworm`;
}
function docker(args: string[], input?: string, timeoutMs = 600_000): { status: number | null; stdout: string; stderr: string; timedOut: boolean } {
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) return { status: null, stdout: '', stderr: r.error.message, timedOut };
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut };
}
let linuxBuilt: string | undefined;
/** Builds `deep-show` for linux/amd64 once per process; BLOCKED without Docker or the image, FAIL when cargo fails. */
function linuxShow(): void {
  if (linuxBuilt === undefined) {
    const info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 30_000);
    if (info.status !== 0) blocked(`Docker is unreachable (docker info: ${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); Linux x86_64 runs in a linux/amd64 container`);
    const image = linuxImage();
    const arch = docker(['image', 'inspect', '--format', '{{.Architecture}}', image], undefined, 30_000);
    if (arch.status !== 0 || arch.stdout.trim() !== 'amd64') blocked(`Docker has no linux/amd64 image ${image} here and this suite pulls nothing; run: docker pull --platform linux/amd64 ${image}`);
    for (const d of ['target', 'registry', 'git']) mkdirSync(join(LINUX, d), { recursive: true });
    const build = docker([
      'run', '--rm', '--platform', 'linux/amd64', '-v', `${REPO}:/src:ro`, '-v', `${join(LINUX, 'target')}:/target`,
      '-v', `${join(LINUX, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(LINUX, 'git')}:/usr/local/cargo/git`,
      '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', image, 'cargo', 'build', '--locked', '--bin', SHOW,
    ], undefined, TIMEOUT - 600_000);
    linuxBuilt = build.status === 0 ? '' : `cargo build --locked --bin ${SHOW} in ${image} (linux/amd64) failed${build.timedOut ? ' (timed out)' : ''}:\n${build.stderr.slice(-4000)}`;
  }
  expect(linuxBuilt, `${SHOW} builds for Linux x86_64`).toBe('');
}
/** Runs one scenario through `deep-show run [--planted p]` in a linux/amd64 container, its evidence store at `evidence`
 * (mounted read-write at /evidence, so the files it writes land in the same store). */
export function onLinux(sc: JsonObject, evidence: string, what: string, planted?: string): JsonObject[] {
  linuxShow();
  const inner = { ...sc, evidence: '/evidence' };
  const r = docker(['run', '--rm', '-i', '--platform', 'linux/amd64', '-v', `${join(LINUX, 'target')}:/target:ro`, '-v', `${evidence}:/evidence`,
    linuxImage(), `/target/debug/${SHOW}`, 'run', ...plantedArgs(planted)], `${JSON.stringify(inner)}\n`, 1_800_000);
  const lines = r.stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return repliesOf({ status: r.status, signal: null, timedOut: r.timedOut, lines, stdout: r.stdout, stderr: r.stderr }, inner, `${what} on linux/amd64`);
}

// ---------------------------------------------------------------------------------------------------
// A long run watched from outside (criterion 4): `deep-show run` started asynchronously, and the resident memory of
// every media worker it starts (a descendant whose command line names the decode or media worker) read with `ps` once
// a second. Stopped only by its own PID on timeout.

export interface Watched { status: number | null; stdout: string; stderr: string; workerPeakBytes: number | null; workers: string[] }
export function watchRun(bin: string, sc: JsonObject, timeoutMs: number): Promise<Watched> {
  return new Promise((done) => {
    const child = spawn(bin, ['run'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let peak: number | null = null; const seen = new Set<string>();
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(`${JSON.stringify(sc)}\n`);
    const poll = setInterval(() => {
      let table = '';
      try { table = execFileSync('ps', ['-ax', '-o', 'pid=,ppid=,rss=,command='], { encoding: 'utf8' }); } catch { return; }
      const rows = table.split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => m !== null)
        .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]) * 1024, command: m[4]! }));
      const ours = new Set<number>([child.pid!]);
      for (let grew = true; grew;) { grew = false; for (const r of rows) if (!ours.has(r.pid) && ours.has(r.ppid)) { ours.add(r.pid); grew = true; } }
      for (const r of rows) if (r.pid !== child.pid && ours.has(r.pid) && /(decode|media)[-_]worker/.test(r.command)) { seen.add(`${r.pid} ${r.command.slice(0, 80)}`); peak = Math.max(peak ?? 0, r.rss); }
    }, 1000);
    const timer = setTimeout(() => { if (child.pid) process.kill(child.pid, 'SIGKILL'); }, timeoutMs);
    child.on('close', (status) => { clearInterval(poll); clearTimeout(timer); done({ status, stdout, stderr, workerPeakBytes: peak, workers: [...seen] }); });
  });
}
