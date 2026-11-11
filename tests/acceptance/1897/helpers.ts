// Test-side tools for the #1897 acceptance tests: `deep-show` built once per Cargo feature set and driven by one JSON
// scenario on stdin (`deep-show run`, #393's convention, as #488's and #501's suites drive it), with the scenario's
// `planted` value (#488's) and the startup `--planted <name>` argument (#501's) for the wrong programs; the boards the
// determinism check runs on; the claim whose requirement is `document.determinism` (#403's verdict path); the evidence
// store; a seeded generator; and the frames criterion 3 hashes. Nothing here stands in for the determinism check, the
// GPU pixel hash, its CPU twin or Vello CPU: each is read from what `deep-show` answers. README: The surface under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1897 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetOf = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));

/** Every `it` passes this: a first cargo build can take many minutes. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #1897.b9031214',
  2: 'AC2 #1897.0cf38b45',
  3: 'AC3 #1897.de2ffa3e',
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
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 600)}`).toBe('string');
  return v as string;
}
/** A SHA-256 in lower-case hex. */
export function sha(v: JsonValue | undefined, what: string): string {
  const s = str(v, what);
  expect(/^[0-9a-f]{64}$/.test(s), `${what} is a SHA-256 in lower-case hex, got ${s}`).toBe(true);
  return s;
}
/** The GPU pixel hash: 128 bits, the 16 bytes read back, in lower-case hex (Determinism: `pixel_hash`). */
export function hash128(v: JsonValue | undefined, what: string): string {
  const s = str(v, what);
  expect(/^[0-9a-f]{32}$/.test(s), `${what} is a 128-bit hash, 16 bytes in lower-case hex, got ${s}`).toBe(true);
  return s;
}

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
/** A reply that says this machine has no GPU to hash on (README: GPU legs). */
export const noGpu = (reply: JsonObject): boolean => reply['outcome'] === 'refused' && /gpu|adapter/.test(String(reply['code']));

// ---------------------------------------------------------------------------------------------------
// Time and seeds

/** Flicks in one second (Time and the flick). */
export const FLICKS = 705_600_000;
export const sec = (s: number): number => Math.round(s * FLICKS);

/** A seeded generator of 32-bit words (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
/** A whole number in [0, n) from the generator. */
export const below = (next: () => number, n: number): number => Math.floor((next() / 4294967296) * n);

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin deep-show --no-default-features --features <set>` once per set per file, with
// incremental builds and debug info off, copied out of the target folder; a test whose build failed fails with cargo's
// error.

export const FULL = 'full';
/** The full set with #488's test canvas module `test.tick` (60 Hz steps, a checkpoint every 0.5 s). */
export const TICK = 'full,test-tick';

function buildTo(features: string, to: string): string {
  const args = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', features];
  const env = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
  const r = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(-4000)}`;
  copyFileSync(join(targetOf(), 'debug', exe(SHOW)), to);
  return '';
}
export function useShow(sets: readonly string[]): { bin: (set: string) => string } {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1897-bins-'));
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
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1897-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (README: The surface under test)

interface Ran { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
function start(bin: string, sc: JsonObject, planted?: string): Ran {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, signal: r.signal, timedOut, lines, stdout, stderr: r.stderr ?? '' };
}
/** `deep-show run [--planted p]`: exit 0, one answer line, ok, one reply per call. */
export function runShow(bin: string, sc: JsonObject, what: string, planted?: string): JsonObject[] {
  const tag = planted ? `${what} (--planted ${planted})` : what;
  const s = start(bin, sc, planted);
  expect(s.timedOut, `${tag}: deep-show run finished within its timeout`).toBe(false);
  expect(s.status, `${tag}: deep-show run exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 800)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${tag}: one answer line`).toBe(1);
  const out = obj(s.lines[0], `${tag}: the answer`);
  expect(out['ok'], `${tag}: deep-show run answers the scenario ok; got ${show(out)}`).toBe(true);
  const replies = arr(out['replies'], `${tag}: replies`).map((r, i) => obj(r, `${tag}: replies[${i}]`));
  expect(replies.length, `${tag}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return replies;
}

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = ulid('01JB1897D', 1);
export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Test agent: determinism', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];
export const CLAIM = `claim:${ulid('01JB1897C', 1)}`;
export const REQ = `req:${ulid('01JB1897Q', 1)}`;

export interface ScenarioExtra { planted?: string | undefined; claims?: JsonObject }
/** A scenario: the evidence store, the agent's session and process tree, the document on its panel, the calls. */
export function scenario(evidence: string, calls: JsonObject[], extra: ScenarioExtra = {}): JsonObject {
  const out: JsonObject = {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { [DOC]: { panel: 'main' } },
    calls,
  };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) out[k] = v as JsonValue;
  return out;
}
/** An agent's deep_show call: a whole revision of `document` (#393). */
export const present = (document: JsonObject): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc: DOC, document, include: ['issues'] });
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${show(reply)}`).toBe('presented');
}

/** The claim whose one requirement is the core's `document.determinism` on the document (#403's form). */
export function determinismClaim(check: JsonObject): JsonObject {
  return { [CLAIM]: { session: ALPHA.id, deliverables: [DOC], requirements: [{ id: REQ, check: { kind: 'document.determinism', ...check } }] } };
}
export const VERDICT: JsonObject = { call: 'verdict', claim: CLAIM };
/** The verdict's row for the requirement. */
export function requirementRow(reply: JsonObject, what: string): JsonObject {
  const rows = arr(reply['requirements'], `${what}: requirements`).map((r, i) => obj(r, `${what}: requirements[${i}]`));
  const row = rows.find((r) => r['id'] === REQ);
  expect(row !== undefined, `${what}: a row for the determinism requirement: ${show(reply)}`).toBe(true);
  return row!;
}

// ---------------------------------------------------------------------------------------------------
// The evidence store (#15's layout: `<2 hex>/<62 hex>`, each file named by its bytes' SHA-256)

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}

// ---------------------------------------------------------------------------------------------------
// Boards, as an agent sends them (#488's forms)

export const SIZE: [number, number] = [320, 200];
const rect = (id: string, box: number[], order: string, role = 'muted', extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'rect@1', name: `Rect ${id}`, order, params: { box, paint: { fill: { role } } }, ...extra });
const label = (id: string, text: string, pos: [number, number], order: string): JsonObject =>
  ({ id, kind: 'text@1', name: `Label ${id}`, order, params: { text, font: 'body', size: 13, box: { w: 160, h: 20 } }, at: { pos: [pos[0], pos[1], 0] } });
function board(title: string, items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, profile: 'board', seed: 1897, title,
    description: `${title}, drawn by a test agent through deep_show for the #1897 acceptance tests.`,
    size: SIZE, items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
/** A clip that slides the rect `item` along x from `from` to `to` over 2 s from 0. */
function slide(item: string, from: number, to: number): JsonObject {
  return {
    clips: { slide: { slots: { target: { type: 'rect@1', required: true } }, span: 'auto', channels: { x: { target: 'slot:target/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: from, interp: 'linear' }, k1: { t: '2s', value: to, interp: 'linear' } } } } } },
    placements: { p: { clip: 'slide', slots: { target: item }, start: '0s' } },
  };
}
const BACK = rect('back', [0, 0, 320, 200], 'a0', 'ground');

/** #488's ticking board: a `test.tick@1` item (60 Hz steps, a checkpoint every 0.5 s), a rect sliding over 2 s and a
 * label; 3 s long. */
export const TICK_BOARD: JsonObject = board('Ticking board', [
  BACK,
  { id: 'tick', kind: 'test.tick@1', name: 'Ticker', order: 'a1', params: { box: [16, 40, 40, 30] } },
  rect('mover', [0, 0, 40, 30], 'a2', 'ink', { at: { pos: [16, 100, 0] } }),
  label('l1', 'Seek equals play', [16, 150], 'a3'),
], { transport: { span: '3s' }, ...slide('mover', 16, 216), requires: { modules: { 'test.tick': '^1' } } });
/** The checkpoint spacing of `test.tick`, its board's span and the slide's last key. */
export const CHECKPOINT = sec(0.5);
export const SPAN = sec(3);
export const LAST_KEY = sec(2);
/** One flick before the second checkpoint: where #488's planted nearest-in-distance restore shows 0.5 s's step early. */
export const BEFORE_SECOND_CHECKPOINT = CHECKPOINT - 1;
/** The ticking board's named times of Determinism's default set: the start, the keys and the flick before each, every
 * checkpoint, the flick before it and the midpoint to the next, and the span's last flick (#488's `namedTimes`). */
export function namedTimes(): number[] {
  const out = new Set<number>([0, LAST_KEY - 1, LAST_KEY, SPAN - 1]);
  for (let c = 0; c < SPAN; c += CHECKPOINT) {
    if (c > 0) { out.add(c - 1); out.add(c); }
    out.add(c + CHECKPOINT / 2);
  }
  return [...out].sort((a, b) => a - b);
}

/** A board of plain 2D items for the cross-machine record: a ground, a rect sliding over 2 s, a still rect and a label;
 * 3 s long. Nothing in it is a test module or GPU work. */
export const SLIDING: JsonObject = board('Sliding rect', [
  BACK, rect('mover', [0, 0, 40, 30], 'a1', 'ink', { at: { pos: [16, 40, 0] } }), rect('r2', [16, 100, 40, 30], 'a2'),
  label('l1', 'Across machines', [16, 150], 'a3'),
], { transport: { span: '3s' }, ...slide('mover', 16, 216) });

// ---------------------------------------------------------------------------------------------------
// Criterion 3's frames: raw pixel buffers, rows top-down without padding (README: `pixel_hash`)

export type Format = 'rgba8' | 'rgba16float';
/** Bytes per pixel: four 8-bit channels, or four little-endian binary16 channels. */
export const BYTES: Record<Format, number> = { rgba8: 4, rgba16float: 8 };
export interface Frame { format: Format; size: [number, number]; bytes: Buffer }
/** A frame of seeded bits: every byte from the generator, so float frames hold every binary16 pattern, NaNs too. */
export function seededFrame(next: () => number, format: Format, size: [number, number]): Frame {
  const bytes = Buffer.alloc(size[0] * size[1] * BYTES[format]);
  for (let i = 0; i < bytes.length; i += 4) bytes.writeUInt32LE(next(), i);
  return { format, size, bytes };
}
export const frameCall = (evidence: string, frames: Frame[]): JsonObject =>
  ({ call: 'pixel_hash', frames: frames.map((f) => ({ size: f.size, format: f.format, bytes: putEvidence(evidence, f.bytes) })) });

export interface Hashed { gpu: string; cpu: string; readback: string }
/** A `pixel_hash` reply: one entry per frame asked, each the GPU's hash, the CPU's hash and the read-back buffer. */
export function hashed(reply: JsonObject, count: number, what: string): Hashed[] {
  if (noGpu(reply)) blocked(`no GPU to hash on here: ${show(reply)}`);
  expect(reply['outcome'], `${what} is hashed: ${show(reply)}`).toBe('hashed');
  const list = arr(reply['hashes'], `${what}: hashes`);
  expect(list.length, `${what}: one entry per frame`).toBe(count);
  return list.map((v, i) => {
    const o = obj(v, `${what}: hashes[${i}]`);
    return { gpu: hash128(o['gpu'], `${what}: hashes[${i}].gpu`), cpu: hash128(o['cpu'], `${what}: hashes[${i}].cpu`), readback: sha(o['readback'], `${what}: hashes[${i}].readback`) };
  });
}
