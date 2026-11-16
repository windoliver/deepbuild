// Test-side tools for the #458 acceptance tests, pairs group (criteria 7, 9 and 11): the three binaries built once per
// file and copied out of the target folder (`deep-show`, `deep-gpu`, `deep-sandbox`), each driven as the suites before
// this one drive it; the scenario `deep-show run` takes, with the test pack and an empty golden store; raw pixels read
// back from the files the binaries write; and the two comparisons a pair is held to: bit for bit, naming the first pixel
// that differs, and #138's tolerance class as `compare_images` judges it. Nothing here stands in for a renderer, the
// expansion, the sandbox or an engine: every value compared comes from a binary's answer or a file it wrote.
// README: The surface under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { PACK, type Box, type JsonObject, type JsonValue } from './generate.ts';

export type { JsonObject, JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/458/pairs is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');

/** Every `it` passes this: a first cargo build can take many minutes. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  7: 'AC7 #458.89f8a711',
  9: 'AC9 #458.4ebd041e',
  11: 'AC11 #458.0b2667d3',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and verdict prefixes

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 600)}`).toBe('string');
  return v as string;
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const SHA = /^[0-9a-f]{64}$/;

/** A need this machine can't meet: never a pass (AGENTS.md: the four invariants). */
export function blocked(reason: string): never {
  return expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
/** GPUI's offscreen renderer and the GPU layer draw on macOS's Metal device, the reference platform. */
export function needsMetal(what: string): void {
  if (process.platform !== 'darwin') blocked(`${what} draws on macOS's Metal device; this is ${process.platform}`);
}
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.slice(0, 8).join(' | ')}`).toEqual([]);
}
/** A planted program's run: this suite's own check must fail on it, and some failure must match `named`; that failure. */
export function failsNaming(failures: readonly string[], named: RegExp, what: string): string {
  expect(failures.length, `${what}: the check fails the planted program`).toBeGreaterThan(0);
  const hit = failures.find((f) => named.test(f));
  expect(hit, `${what}: a failure matches ${named}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBeDefined();
  return hit!;
}

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin <bin>` once per file, incremental builds and debug info off, copied out of the
// target folder (CARGO_TARGET_DIR when set); a test whose build failed fails with cargo's error.

export type Bin = 'deep-show' | 'deep-gpu' | 'deep-sandbox';
const FEATURES: Record<Bin, string[]> = { 'deep-show': ['--no-default-features', '--features', 'full'], 'deep-gpu': [], 'deep-sandbox': [] };
const cargoArgs = (bin: Bin): string[] => ['build', '--locked', '--bin', bin, ...FEATURES[bin]];
function build(bin: Bin, to: string): string {
  const env = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
  const r = spawnSync('cargo', cargoArgs(bin), { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${cargoArgs(bin).join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  copyFileSync(join(TARGET, 'debug', exe(bin)), to);
  return '';
}
export function useBins(bins: readonly Bin[]): (bin: Bin) => string {
  let dir = '';
  const made = new Map<Bin, { path: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-458-pairs-bins-'));
    for (const b of bins) { const path = join(dir, exe(b)); made.set(b, { path, error: build(b, path) }); }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (bin) => {
    const m = made.get(bin);
    if (!m) throw Error(`the file didn't list ${bin} in useBins`);
    expect(m.error, `the binary builds: cargo ${cargoArgs(bin).join(' ')}`).toBe('');
    return m.path;
  };
}
/** A fresh folder per call, deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-458-pairs-')); made.push(d); return d; };
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// Running a binary: JSON lines in, one JSON line out per line in.

interface Ran { status: number | null; signal: string | null; lines: JsonValue[]; stdout: string; stderr: string }
function start(bin: string, args: string[], inputs: JsonValue[]): Ran {
  const r = spawnSync(bin, args, { cwd: REPO, input: inputs.map((v) => `${JSON.stringify(v)}\n`).join(''), encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`${bin} ${args.join(' ')}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, signal: r.signal, lines, stdout, stderr: r.stderr ?? '' };
}
/** A scenario binary's answer (`deep-show run`, `deep-gpu run`): one line, `ok: true`, exit 0, one reply per call.
 * The answer is read before the exit code, so a refusal (an unknown planted name, say) fails naming what it said. */
function scenarioReplies(s: Ran, calls: number, what: string): JsonObject[] {
  expect(s.lines.length, `${what}: one answer line; exit ${String(s.status)} (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 800)}; stderr: ${s.stderr.slice(-1500)}`).toBe(1);
  const out = obj(s.lines[0], `${what}: the answer`);
  expect(out['ok'], `${what}: the scenario is answered ok; got ${show(out)}`).toBe(true);
  expect(s.status, `${what}: exits 0 (${s.signal ?? 'no signal'}); stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  const replies = arr(out['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(calls);
  return replies;
}
/** `deep-show run`: one scenario (#393's convention); its `planted` key carries a wrong program (#488's). */
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const tag = typeof sc['planted'] === 'string' ? `${what} (planted ${sc['planted']})` : what;
  return scenarioReplies(start(bin, ['run'], [sc]), arr(sc['calls'], 'calls').length, `deep-show run, ${tag}`);
}
/** `deep-gpu run [--planted <name>]`: one scenario `{out, calls}` (#377's convention). */
export function runGpu(bin: string, out: string, calls: JsonObject[], what: string, planted?: string): JsonObject[] {
  return scenarioReplies(start(bin, ['run', ...(planted ? ['--planted', planted] : [])], [{ out, calls }]), calls.length, `deep-gpu run${planted ? ` --planted ${planted}` : ''}, ${what}`);
}
/** `deep-sandbox [--planted <name>]`: one answer line per call line (#238's convention). */
export function runSandbox(bin: string, calls: JsonObject[], what: string, planted?: string): JsonObject[] {
  const tag = `deep-sandbox${planted ? ` --planted ${planted}` : ''}, ${what}`;
  const s = start(bin, planted ? ['--planted', planted] : [], calls);
  const first = s.lines[0];
  if (isObject(first) && first['ok'] === false && first['code'] === 'bad_input') expect.fail(`${tag}: answered ${show(first)} (exit ${String(s.status)})`);
  expect(s.status, `${tag}: exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 800)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${tag}: one answer per call`).toBe(calls.length);
  return s.lines.map((l, i) => obj(l, `${tag}: answer ${i}`));
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`'s scenario (#393's, with #306's `packs` and #138's `goldens`)

const ulid = (n: number): string => `01JB458D${String(n).padStart(18, '0')}`;
/** Document n of a scenario (ULIDs the hub would have minted). */
export const docId = (n: number): string => ulid(n);
/** `deep show` from your shell: its process is outside every agent's tree (#96's peer check). */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
export const PACK_DIR = join(HERE, 'fixtures', 'packs', PACK.folder);
/** `docs`: one entry per document, in `docId` order from 1: a document the hub already stored, or null for none yet. */
export interface World { evidence: string; goldens: string; docs: (JsonObject | null)[]; packs?: boolean; planted?: string | undefined }
/** A scenario: the evidence store, an empty golden store, an agent's session and the process table, the documents
 * on one panel, the test pack installed when asked, and the calls. */
export function scenario(w: World, calls: JsonObject[]): JsonObject {
  return {
    evidence: w.evidence, goldens: w.goldens,
    sessions: { 'sess-alpha': { thread: 'thread-alpha', name: 'Test agent: pairs', process: { pid: 4100, start: 1_000 } } },
    processes: PROCESSES, panels: { main: { rect: [0, 0, 800, 600] } },
    docs: Object.fromEntries(w.docs.map((document, i) => [docId(i + 1), { panel: 'main', ...(document ? { document } : {}) }])),
    ...(w.packs ? { packs: [{ id: PACK.id, dir: PACK_DIR }] } : {}),
    ...(w.planted ? { planted: w.planted } : {}),
    calls,
  };
}
/** A whole revision from your shell (`deep show`), with its issues and a snapshot of `size` px. */
export const showCall = (doc: string, document: JsonObject, size: readonly [number, number]): JsonObject =>
  ({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues', 'pixels'], size: [...size] });
/** A patch from your shell (#96's form). */
export const patchCall = (doc: string, n: number, base: number, ops: JsonObject[]): JsonObject =>
  ({ call: 'deep show', peer: YOU_PEER, doc, patch: { patch: `01JB458P${String(n).padStart(18, '0')}`, doc, base, reason: 'a generated patch', ops } });
export const readCall = (doc: string): JsonObject => ({ call: 'read', doc, peer: YOU_PEER });
/** A presented revision with no error and nothing skipped. */
export function presented(reply: JsonObject, what: string): void {
  const issues = (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject);
  const notices = (Array.isArray(reply['notices']) ? reply['notices'] : []).filter(isObject);
  const bad = [
    ...issues.filter((i) => i['severity'] === 'error').map((i) => `the check raises an error: ${show(i, 400)}`),
    ...[...issues, ...notices].filter((n) => n['code'] === 'unknown_kind').map((n) => `an item is skipped: ${show(n, 400)}`),
    ...(reply['outcome'] === 'presented' ? [] : [`the outcome is ${show(reply['outcome'])}: ${show(reply, 800)}`]),
  ];
  expect(bad, `${what} is presented: ${bad.join('; ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// Pixels: files a binary wrote, read back whole

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }
/** A file in the evidence store (#15's layout: `<2 hex>/<62 hex>`, named by its bytes' SHA-256). */
export function evidenceFile(evidence: string, hash: JsonValue | undefined, what: string): Buffer {
  const h = str(hash, `${what}: its hash`);
  expect(h, `${what} is named by a SHA-256`).toMatch(SHA);
  const bytes = readFileSync(join(evidence, h.slice(0, 2), h.slice(2)));
  expect(sha256(bytes), `${what}: the file hashes to its name`).toBe(h);
  return bytes;
}
/** A file `deep-gpu` wrote under `out`, named `<sha256>.<ext>` (#378). */
export function outFile(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  const h = str(hash, `${what}: its hash`);
  expect(h, `${what} is named by a SHA-256`).toMatch(SHA);
  const bytes = readFileSync(join(out, `${h}.${ext}`));
  expect(sha256(bytes), `${what}: the file hashes to its name`).toBe(h);
  return bytes;
}
type Rgba = [number, number, number, number];
const at = (im: Image, i: number): Rgba => [im.rgba[4 * i]!, im.rgba[4 * i + 1]!, im.rgba[4 * i + 2]!, im.rgba[4 * i + 3]!];
/** How many distinct colors an image holds, up to `cap`: a side that is one flat color compares nothing. */
export function colors(im: Image, cap = 64): number {
  const seen = new Set<number>();
  for (let i = 0; i < im.width * im.height && seen.size < cap; i++) seen.add(new DataView(im.rgba.buffer, im.rgba.byteOffset + 4 * i, 4).getUint32(0));
  return seen.size;
}

export interface Pixel { x: number; y: number; a: number[]; b: number[] }
/** Bit for bit: the first pixel, in row-major order, where two images of one size differ, or null. */
export function firstDifference(a: Image, b: Image, what: string): Pixel | null {
  expect([a.width, a.height], `${what}: the two sides are the same size`).toEqual([b.width, b.height]);
  for (let i = 0; i < a.width * a.height; i++) {
    const [pa, pb] = [at(a, i), at(b, i)];
    if (pa.some((v, c) => v !== pb[c])) return { x: i % a.width, y: Math.floor(i / a.width), a: pa, b: pb };
  }
  return null;
}
/** Every pixel where two images differ, as indexes in row-major order. */
export function differing(a: Image, b: Image): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.width * a.height; i++) if (at(a, i).some((v, c) => v !== at(b, i)[c])) out.push(i);
  return out;
}
/** Bit for bit over a raw target of `width` × `height` pixels (any whole number of bytes a pixel): the first pixel, in
 * row-major order, whose bytes differ, or null. */
export function firstDifferentPixel(a: Buffer, b: Buffer, size: readonly [number, number], what: string): { x: number; y: number } | null {
  expect(a.length, `${what}: the two sides hold the same number of bytes`).toBe(b.length);
  const per = a.length / (size[0] * size[1]);
  expect(Number.isInteger(per) && per > 0, `${what}: ${a.length} bytes are a whole number of bytes for each of ${size[0]} × ${size[1]} pixels`).toBe(true);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { const p = Math.floor(i / per); return { x: p % size[0], y: Math.floor(p / size[0]) }; }
  return null;
}

/** #138's tolerance class: at least `on` percent of the pixels within `within` code values on every channel, no pixel
 * past `ceiling`, and no `window.size` square holding more than `window.off` pixels off; each with its reason. */
export interface Tolerance { within: number; on: number; ceiling: number; window: { size: number; off: number }; reason: string }
export interface Judged { pass: boolean; off: number; allowed: number; first: Pixel | null; pastCeiling: Pixel | null; window: { x: number; y: number; off: number } | null }
/** Two images against a tolerance class, as #138's `compare_images` judges one (its README): a pixel is off when any
 * channel differs by more than `within`; it fails when more than the floor of (100 − `on`)% of the pixels are off, when
 * any channel differs by more than `ceiling`, or when a window holds more than its bound. `first` is the first pixel
 * off, in row-major order. */
export function judge(a: Image, b: Image, t: Tolerance, what: string): Judged {
  expect([a.width, a.height], `${what}: the two sides are the same size`).toEqual([b.width, b.height]);
  const [w, h] = [a.width, a.height];
  const offAt = new Uint8Array(w * h);
  let off = 0; let first: Pixel | null = null; let pastCeiling: Pixel | null = null;
  for (let i = 0; i < w * h; i++) {
    const [pa, pb] = [at(a, i), at(b, i)];
    const d = Math.max(...pa.map((v, c) => Math.abs(v - pb[c]!)));
    if (d <= t.within) continue;
    off++;
    offAt[i] = 1;
    const p = { x: i % w, y: Math.floor(i / w), a: pa, b: pb };
    first ??= p;
    if (d > t.ceiling) pastCeiling ??= p;
  }
  // Counts of off pixels over every size × size window, by a summed-area table.
  const sum = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) sum[(y + 1) * (w + 1) + x + 1] = offAt[y * w + x]! + sum[y * (w + 1) + x + 1]! + sum[(y + 1) * (w + 1) + x]! - sum[y * (w + 1) + x]!;
  let window: Judged['window'] = null;
  const n = t.window.size;
  for (let y = 0; y + n <= h && !window; y++) for (let x = 0; x + n <= w; x++) {
    const count = sum[(y + n) * (w + 1) + x + n]! - sum[y * (w + 1) + x + n]! - sum[(y + n) * (w + 1) + x]! + sum[y * (w + 1) + x]!;
    if (count > t.window.off) { window = { x, y, off: count }; break; }
  }
  const allowed = Math.floor(((100 - t.on) / 100) * w * h);
  return { pass: off <= allowed && !pastCeiling && !window, off, allowed, first, pastCeiling, window };
}

/** The pixels a 2-unit stroke centred on `box`'s edge can touch: one pixel either side of the edge. */
export function onStrokeRing(box: Box, x: number, y: number): boolean {
  const [bx, by, bw, bh] = box;
  const inOuter = x >= bx - 1 && x < bx + bw + 1 && y >= by - 1 && y < by + bh + 1;
  const inInner = x >= bx + 1 && x < bx + bw - 1 && y >= by + 1 && y < by + bh - 1;
  return inOuter && !inInner;
}
