// Test-side tools for the #213 acceptance tests (README: The surface under test). They build and drive the three
// binaries that hold the modules the criteria name: `deep-show run` (the full build set, the only binary that links the
// logic and physics modules together) for between-step services and the registry, `deep-logic` (#531's runner) for
// mirror reads, and `deep-physics` (#2009's, through ../2009/helpers.ts, imported read only) for physics.query and the
// world's own bake. Programs are WebAssembly text (programs.ts) assembled by #544's assembler (read only). Nothing here
// stands in for a module: every hit, range list, hash, trap, fuel count, refusal, verdict and time read here is the
// program's own; every expected value comes from the issue's text, the design and this suite's programs, computed here.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { REPO, TARGET, arr, cargoError, isObject, num, obj, show, type JsonObject, type JsonValue, type Vec3 } from '../2009/helpers.ts';

export { REPO, arr, isObject, num, obj, show, type JsonObject, type JsonValue, type Vec3 };
export { box, physics, prebuild as prebuildPhysics, sphere, statesOf, world } from '../2009/helpers.ts';

const MIB = 1024 * 1024;
/** Each test's own timeout; the builds in `beforeAll` have their own. */
export const TIMEOUT = 3_600_000;
/** A build's timeout: a cold deep-show takes about 25 minutes on a loaded Mac. */
export const BUILD_TIMEOUT = 5_400_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = {
  1: '#213.170f7e56',
  2: '#213.1361c0e3',
  3: '#213.b4f8dc3a',
  4: '#213.f2c2a3f9',
  5: '#213.38e13b08',
  6: '#213.8ba60177',
  7: '#213.62c17765',
  8: '#213.16543e66',
} as const;

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };
/** A reading this machine can't judge: the test fails with this message, never passes. */
export const inconclusive = (why: string): never => { throw Error(`INCONCLUSIVE: ${why}; this is not a pass`); };

// ---------------------------------------------------------------------------------------------------
// JSON and judging

export function int(v: JsonValue | undefined, what: string): number {
  expect(Number.isSafeInteger(v), `${what} is a whole number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v)}`).toBe('string');
  return v as string;
}
export const mentions = (v: JsonValue | undefined, needle: string): boolean => (JSON.stringify(v) ?? '').includes(needle);
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A planted twin is caught: the judge that passes the real program fails on it, and a failure names each of `named`. */
export function failsNaming(failures: readonly string[], named: readonly RegExp[], what: string): void {
  expect(failures.length, `${what}: the judge that passes the real program finds nothing wrong with the planted twin`).toBeGreaterThan(0);
  for (const re of named) expect(failures.some((f) => re.test(f)), `${what}: a failure names ${re}: ${failures.slice(0, 10).join(' | ')}`).toBe(true);
}
/** mulberry32: a fixed-seed generator of numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
/** `count` distinct whole numbers in [lo, hi], in the order a generator seeded with `seed` draws them. */
export function seededSteps(seed: number, count: number, lo: number, hi: number): number[] {
  const next = rng(seed);
  const out: number[] = [];
  while (out.length < count) {
    const s = lo + Math.floor(next() * (hi - lo + 1));
    if (!out.includes(s)) out.push(s);
  }
  return out;
}
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

// ---------------------------------------------------------------------------------------------------
// Builds: each binary once per file, in `beforeAll`, copied out of the target folder (README: Run them).

export type Build = 'logic' | 'show' | 'show-sorts-by-id' | 'logic-release' | 'show-release';
const CARGO_ARGS: Record<Build, string[]> = {
  logic: ['build', '--locked', '--bin', 'deep-logic'],
  show: ['build', '--locked', '-p', 'deep-show', '--bin', 'deep-show'],
  'show-sorts-by-id': ['build', '--locked', '-p', 'deep-show', '--bin', 'deep-show', '--features', 'test-cast-sorts-by-id'],
  'logic-release': ['build', '--locked', '--release', '--bin', 'deep-logic'],
  'show-release': ['build', '--locked', '--release', '-p', 'deep-show', '--bin', 'deep-show'],
};
const OUT: Record<Build, [string, string]> = {
  logic: ['debug', 'deep-logic'], show: ['debug', 'deep-show'], 'show-sorts-by-id': ['debug', 'deep-show'],
  'logic-release': ['release', 'deep-logic'], 'show-release': ['release', 'deep-show'],
};
let binsDir = '';
const built = new Map<Build, { bin: string; error: string }>();
function build(b: Build): { bin: string; error: string } {
  const known = built.get(b);
  if (known) return known;
  if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-213-bins-'));
  const [profile, name] = OUT[b];
  const bin = join(binsDir, `${name}-${b}`);
  const error = cargoError(CARGO_ARGS[b]);
  if (error === '') copyFileSync(join(TARGET, profile, name), bin);
  const out = { bin, error };
  built.set(b, out);
  return out;
}
/** Builds `list` before a file's tests (the slow part), so each test's own time is its own. */
export function useBuilds(list: Build[]): void {
  beforeAll(() => { for (const b of list) { try { build(b); } catch { /* the test that uses it reports it */ } } }, BUILD_TIMEOUT * Math.max(1, list.length));
  afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built.clear(); });
}
/** The built binary; a test that uses a build that failed fails here, naming cargo's command and error. */
export function binOf(b: Build): string {
  const out = build(b);
  expect(out.error, `${b} builds on this host (cargo ${CARGO_ARGS[b].join(' ')})`).toBe('');
  return out.bin;
}

// ---------------------------------------------------------------------------------------------------
// Programs: WebAssembly text assembled by #544's assembler (tests/acceptance/544/wat, read only), into its own target.

export interface Program { name: string; bytes: Buffer; b64: string; sha: string }
const WAT_DIR = join(REPO, 'tests', 'acceptance', '544', 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-544-wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const error = cargoError(['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], { CARGO_TARGET_DIR: WAT_TARGET });
  if (error) blocked(`the assembler this suite uses (tests/acceptance/544/wat) didn't build: ${error}`);
  watBin = join(WAT_TARGET, 'debug', 'acceptance-544-wat');
  return watBin;
}
const assembled = new Map<string, Program>();
/** Assembles WebAssembly text into a Program (its bytes, base64 and SHA-256). */
export function assemble(name: string, text: string): Program {
  const key = sha256(`${name}\n${text}`);
  const known = assembled.get(key);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-213-wat-'));
  try {
    const file = join(dir, `${name}.wat`);
    writeFileSync(file, text);
    const run = spawnSync(assembler(), [dir, file], { encoding: 'utf8', maxBuffer: 64 * MIB });
    if (run.status !== 0) throw Error(`the assembler refused ${name}: ${(run.stderr ?? '').slice(-2000)}`);
    const bytes = readFileSync(join(dir, `${name}.wasm`));
    const p = { name, bytes, b64: bytes.toString('base64'), sha: sha256(bytes) };
    assembled.set(key, p);
    return p;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A fresh folder per call (an evidence store, a bake store, a pack), deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-213-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// physics.cast@1's layouts (README: The services region). Little-endian; a u32 before an 8-byte value is followed by 4
// zero bytes, as a control's slot in the read region is; vec3 is three f64, quat four.

export const REQUEST_BYTES = 160;
export const RESULT_BYTES = 520;
export const HIT_BYTES = 64;
export const MAX_HITS = 8;
/** The service block of one service with `max_per_step` m: a u32 count, m requests, a u32 count, m results. */
export const blockBytes = (m: number): number => 16 + (REQUEST_BYTES + RESULT_BYTES) * m;
export const requestAt = (s: number, i: number): number => s + 8 + REQUEST_BYTES * i;
export const resultCountAt = (s: number, m: number): number => s + 8 + REQUEST_BYTES * m;
export const resultAt = (s: number, m: number, i: number): number => s + 16 + REQUEST_BYTES * m + RESULT_BYTES * i;
export const hitAt = (s: number, m: number, i: number, h: number): number => resultAt(s, m, i) + 8 + HIT_BYTES * h;
/** A ray request's 160 bytes: kind 0, its world's handle, the group mask, max m, from and dir. */
export function rayBytes(worldHandle: number, groups: number, max: number, from: Vec3, dir: Vec3): Buffer {
  const b = Buffer.alloc(REQUEST_BYTES);
  b.writeUInt32LE(0, 0);
  b.writeUInt32LE(worldHandle >>> 0, 4);
  b.writeUInt32LE(groups >>> 0, 8);
  b.writeUInt32LE(0, 12);
  b.writeDoubleLE(max, 16);
  from.forEach((v, i) => b.writeDoubleLE(v, 24 + 8 * i));
  dir.forEach((v, i) => b.writeDoubleLE(v, 48 + 8 * i));
  return b;
}
export interface Hit { id: number; address: number; point: Vec3; normal: Vec3; distance: number }
export interface Answer { hits: Hit[] }
/** The results half of a service block read from its bytes (a step's `regions.<item>.services` hex). */
export function resultsOf(hex: string, m: number, what: string): { count: number; answers: Answer[] } {
  const b = Buffer.from(hex, 'hex');
  expect(b.length, `${what}: the services region of max_per_step ${m} holds ${blockBytes(m)} bytes (README: The services region)`).toBeGreaterThanOrEqual(blockBytes(m));
  const count = b.readUInt32LE(resultCountAt(0, m));
  const answers: Answer[] = [];
  for (let i = 0; i < Math.min(count, m); i++) {
    const n = b.readUInt32LE(resultAt(0, m, i));
    const hits: Hit[] = [];
    for (let h = 0; h < Math.min(n, MAX_HITS); h++) {
      const at = hitAt(0, m, i, h);
      const v3 = (o: number): Vec3 => [b.readDoubleLE(at + o), b.readDoubleLE(at + o + 8), b.readDoubleLE(at + o + 16)];
      hits.push({ id: b.readUInt32LE(at), address: b.readUInt32LE(at + 4), point: v3(8), normal: v3(32), distance: b.readDoubleLE(at + 56) });
    }
    answers.push({ hits });
  }
  return { count, answers };
}

// ---------------------------------------------------------------------------------------------------
// Mirror lists (README: The read region): a u32 count, then up to 256 ranges {first: u32, count: u32}, or the count
// 0xFFFFFFFF for a whole copy. LIST_BYTES is the list's whole size: 4 + 256 × 8.

export const LIST_BYTES = 4 + 256 * 8;
export const WHOLE = 0xffffffff;
export interface RangeList { count: number; ranges: [number, number][] }
/** A range list from u32 words (an i32 array a program copied out of its read region). */
export function rangeList(words: readonly number[], what: string): RangeList {
  expect(words.length, `${what}: the list's words`).toBeGreaterThanOrEqual(1);
  const u = words.map((w) => w >>> 0);
  const count = u[0]!;
  const ranges: [number, number][] = [];
  if (count !== WHOLE) for (let i = 0; i < Math.min(count, 256); i++) ranges.push([u[1 + 2 * i]!, u[2 + 2 * i]!]);
  return { count, ranges };
}
export const listText = (l: RangeList): string => (l.count === WHOLE ? 'the whole copy (0xFFFFFFFF)' : `${l.count} [${l.ranges.map(([f, c]) => `${f}+${c}`).join(', ')}]`);
/** Numbers of an i32 array in a step record. */
export const ints = (v: JsonValue[] | undefined, what: string): number[] => arr(v, what).map((x, i) => int(x, `${what}[${i}]`));

// ---------------------------------------------------------------------------------------------------
// deep-logic (#531's runner, JSON lines in, one reply per line), and its pieces.

/** `deep-logic --planted <name>` (README: Planted twins). */
export type LogicPlanted = 'mirror_whole_after_restore' | 'mirror_lists_before_reads';
export function logic(calls: JsonObject[], o: { planted?: LogicPlanted; bin?: string } = {}): JsonObject[] {
  const bin = o.bin ?? binOf('logic');
  const args = o.planted ? ['--planted', o.planted] : [];
  const what = `deep-logic${args.length ? ` ${args.join(' ')}` : ''}`;
  const run = spawnSync(bin, args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 4096 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what} finished in time`).toBe('');
  if (run.error && code !== 'EPIPE') throw Error(`${what}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(run.status, `${what} exits 0; stdout: ${stdout.slice(0, 1000)}; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one reply per call`).toBe(calls.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 120)})`));
}

export type WriteType = 'bool' | 'i32' | 'f64' | 'vec2' | 'vec3' | 'quat';
export interface Mirror { array: string; at: string }
export interface ItemSpec {
  program: Program;
  reads?: string[];
  writes: Record<string, { type: WriteType; count?: number }>;
  mirrors?: Mirror[];
  budget?: { fuel?: number; memory?: number };
  checkpoint?: { every?: number; budget?: number };
}
/** A piece as `deep-logic` takes it (#531's README: Piece), with this suite's `mirrors`. */
export function piece(p: { seed: number; items: Record<string, ItemSpec>; controls?: string[] }): JsonObject {
  const assets: JsonObject = {};
  const items: JsonObject = {};
  for (const [id, s] of Object.entries(p.items)) {
    assets[s.program.sha] = s.program.b64;
    const params: JsonObject = { program: s.program.sha, step_rate: 60, writes: s.writes as unknown as JsonObject };
    if (s.reads) params['reads'] = s.reads;
    if (s.mirrors) params['mirrors'] = s.mirrors as unknown as JsonValue;
    if (s.budget) params['budget'] = s.budget as JsonObject;
    if (s.checkpoint) params['checkpoint'] = s.checkpoint as JsonObject;
    items[id] = { kind: 'logic@1', params };
  }
  return { seed: p.seed, ...(p.controls ? { controls: Object.fromEntries(p.controls.map((c) => [c, { kind: 'slider' }])) } : {}), items, assets };
}
export interface Entry { t: number; seq: number; control: string; value: number; writer: 'you'; player: number }
export const FLICKS = 705_600_000;
/** An entry on the input track exactly at step `k` of a 60 Hz item. */
export const entryAt = (control: string, k: number, value: number, seq = 0): Entry => ({ t: (k * FLICKS) / 60, seq, control, value, writer: 'you', player: 1 });

export const checkCall = (p: JsonObject): JsonObject => ({ call: 'check', piece: p });
export interface BakeOptions { track?: Entry[]; restores?: { from: number; steps: number }[]; arrays?: string[] }
/** #531's bake, with this suite's `arrays`: the arrays its step records (and its restores') hold. */
export const bakeCall = (p: JsonObject, steps: number, o: BakeOptions = {}): JsonObject => ({
  call: 'bake', piece: p, steps, track: (o.track ?? []) as unknown as JsonValue,
  ...(o.restores ? { restores: o.restores as unknown as JsonValue } : {}),
  ...(o.arrays ? { arrays: o.arrays } : {}),
});
/** #532's logic.determinism, `at_times` in seconds. */
export const determinismCall = (p: JsonObject, steps: number, atTimes: number[], o: BakeOptions = {}): JsonObject =>
  ({ ...bakeCall(p, steps, o), call: 'determinism', at_times: atTimes, compare: 'same_machine' });

export interface LayoutEntry { region: string; name: string; offset: number; size: number; type: string }
export interface Layout { digest: string; entries: LayoutEntry[] }
/** An item's layout in a `check` reply that admitted the piece. */
export function layoutOf(reply: JsonObject, item: string, what: string): Layout {
  expect(reply['ok'], `${what}: check admits the piece (ok: true): ${show(reply)}`).toBe(true);
  const l = obj(obj(obj(reply['items'], `${what}: items`)[item], `${what}: items.${item}`)['layout'], `${what}: items.${item}.layout`);
  const digest = str(l['digest'], `${what}: layout.digest`);
  expect(digest, `${what}: the layout digest is a u64 as 16 hex`).toMatch(/^[0-9a-f]{16}$/);
  const entries = arr(l['entries'], `${what}: layout.entries`).map((e, i) => {
    const o = obj(e, `${what}: layout.entries[${i}]`);
    return { region: String(o['region']), name: String(o['name']), offset: int(o['offset'], `${what}: entries[${i}].offset`), size: int(o['size'], `${what}: entries[${i}].size`), type: String(o['type']) };
  });
  return { digest, entries };
}
/** A read-region entry by name (and, for a mirror's list, type `ranges`). */
export function readEntry(l: Layout, name: string, type: string | null, what: string): LayoutEntry {
  const e = l.entries.find((x) => x.region === 'reads' && x.name === name && (type === null || x.type === type));
  expect(e, `${what}: the layout's read region has an entry ${name}${type ? ` of type ${type}` : ''}: ${l.entries.map((x) => `${x.region}/${x.name}:${x.type}@${x.offset}`).join(', ')}`).toBeDefined();
  return e!;
}

export interface LogicStep { step: number; items: Record<string, JsonObject>; arrays: Record<string, JsonValue[]> }
export function stepsOf(v: JsonValue | undefined, what: string): LogicStep[] {
  return arr(v, what).map((s, i) => {
    const o = obj(s, `${what}[${i}]`);
    const arrays = obj(o['arrays'], `${what}[${i}].arrays`);
    return {
      step: int(o['step'], `${what}[${i}].step`),
      items: Object.fromEntries(Object.entries(obj(o['items'], `${what}[${i}].items`)).map(([k, x]) => [k, obj(x, `${what}[${i}].items.${k}`)])),
      arrays: Object.fromEntries(Object.entries(arrays).map(([k, x]) => [k, arr(x, `${what}[${i}].arrays.${k}`)])),
    };
  });
}
/** A bake's step records, checked to run 0 … n − 1 in order. */
export function bakeSteps(reply: JsonObject, n: number, what: string): LogicStep[] {
  expect(reply['ok'], `${what}: the bake ran (ok: true): ${show(reply)}`).toBe(true);
  const steps = stepsOf(reply['steps'], `${what}: steps`);
  expect(steps.map((s) => s.step), `${what}: step records 0 … ${n - 1}`).toEqual(Array.from({ length: n }, (_, k) => k));
  return steps;
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (#393's convention): one scenario line on stdin, one answer `{ok, replies}`.

/** The scenario's `planted` names this suite adds (README: Planted twins). */
export type ShowPlanted = 'cast_answers_after_next_step' | 'results_after_checkpoint';
export const SESSION = 'sess-213';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-213', name: 'Claude Code: hit-scan lab', process: { pid: 4213, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4213, ppid: 1, start: 1_000 }];
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB213D${String(n).padStart(18, '0')}`;
export interface ScenarioExtra { planted?: ShowPlanted; packs?: { id: string; dir: string }[]; plugin_entries?: JsonObject[] }
/** A scenario: the agent's session, the process table, each document in a visible panel of its own, the calls. */
export function scenario(evidence: string, docs: string[], calls: JsonObject[], x: ScenarioExtra = {}): JsonObject {
  const panels: JsonObject = {};
  const docMap: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect: [0, 0, 800, 600] }; docMap[d] = { panel: `p${i + 1}` }; });
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs: docMap,
    ...(x.planted ? { planted: x.planted } : {}),
    ...(x.packs ? { packs: x.packs as unknown as JsonValue } : {}),
    ...(x.plugin_entries ? { plugin_entries: x.plugin_entries } : {}),
    calls,
  };
}
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const tag = typeof sc['planted'] === 'string' ? `${what} (planted ${sc['planted']})` : what;
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 4096 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${tag}: deep-show run did not finish within its timeout`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${tag}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${tag}: one answer line`).toBe(1);
  let parsed: JsonValue;
  try { parsed = JSON.parse(lines[0]!) as JsonValue; } catch { parsed = lines[0]!; }
  const out = obj(parsed, `${tag}: the answer`);
  expect(out['ok'], `${tag}: deep-show run answers the scenario ok${typeof sc['planted'] === 'string' ? ` (it takes the planted ${sc['planted']})` : ''}; got ${show(out)}`).toBe(true);
  const list = arr(out['replies'], `${tag}: replies`).map((x, i) => obj(x, `${tag}: replies[${i}]`));
  expect(list.length, `${tag}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return list;
}
/** A deep-show start the seal may refuse: its exit status and its stdout lines. */
export interface Started { status: number | null; stdout: string; stderr: string; lines: JsonValue[] }
export function startShow(bin: string, sc: JsonObject): Started {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 256 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ETIMEDOUT') expect.fail('deep-show run did not finish within its timeout');
  if (r.error && code !== 'EPIPE') throw Error(`deep-show run: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, stdout, stderr: r.stderr ?? '', lines };
}

/** The evidence store (#15's layout: `<2 hex>/<62 hex>`), where a document's programs are found by SHA-256. */
export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
export const showCall = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });
export function presented(reply: JsonObject | undefined, what: string): void {
  expect(reply?.['outcome'], `${what} is presented: ${show(reply?.['issues'] ?? reply)}`).toBe('presented');
  const errors = arr(reply!['issues'] ?? [], `${what}: issues`).filter((i) => isObject(i) && i['severity'] === 'error');
  expect(errors, `${what} is presented with no error`).toEqual([]);
}

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #213 acceptance tests.' };
export interface LogicItem { program: Program; params: JsonObject }
export const camera = (position: Vec3, target: Vec3): JsonObject => ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov: 40 } });
export const markBox = (size: Vec3, pos?: Vec3): JsonObject => ({ kind: 'mark.box@1', params: { size }, ...(pos ? { at: { pos } } : {}) });
/**
 * A scene (#1918's form) whose logic items step at 60 Hz beside the worlds it lists. Each program goes into the evidence
 * store and the document's `assets`; `items` are the scene's other items, `extra` its other sections (channels).
 */
export function sceneDoc(evidence: string, o: { title: string; span: string; worlds?: JsonObject; logic: Record<string, LogicItem>; items?: Record<string, JsonObject>; extra?: JsonObject }): JsonObject {
  const items: JsonObject = {};
  const assets: JsonObject = {};
  let order = 0;
  const add = (id: string, item: JsonObject): void => { items[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...item }; };
  add('cam', camera([5, 6, 18], [5, 0, 0]));
  for (const [id, item] of Object.entries(o.items ?? {})) add(id, item);
  for (const [id, l] of Object.entries(o.logic)) {
    const sha = putEvidence(evidence, l.program.bytes);
    add(id, { kind: 'logic@1', params: { program: sha, step_rate: 60, ...l.params } });
    assets[`${id}_program`] = { sha256: sha, license: LICENSE };
  }
  return {
    format: 1, profile: 'scene', title: o.title, description: `${o.title}: a #213 acceptance fixture.`, size: [640, 360], camera: 'cam', seed: 213,
    transport: { span: o.span, frame_rate: [60, 1] }, requires: { modules: { scene3d: '^1', logic: '^1' } },
    ...(o.worlds ? { worlds: o.worlds } : {}), ...(o.extra ?? {}), items, assets,
  };
}

/** The `logic` call (#539's), with this suite's fields (README: deep-show run: `logic`). */
export interface LogicCallOptions { seeks?: number[]; check?: boolean; atTimes?: number[]; regions?: boolean }
export const logicCall = (doc: string, steps: number, o: LogicCallOptions = {}): JsonObject => ({
  call: 'logic', doc, steps,
  ...(o.seeks ? { seeks: o.seeks.map((to) => ({ to })) } : {}),
  ...(o.check ? { check: 'logic.determinism' } : {}),
  ...(o.atTimes ? { at_times: o.atTimes } : {}),
  ...(o.regions ? { regions: true } : {}),
});
/** A `logic` reply that ran: its step records, each checked for its step number. */
export function showSteps(reply: JsonObject | undefined, n: number, what: string): JsonObject[] {
  expect(reply?.['code'], `${what}: the logic call answers, not refuses: ${show(reply)}`).toBeUndefined();
  const steps = arr(reply!['steps'], `${what}: steps`).map((s, i) => obj(s, `${what}: steps[${i}]`));
  expect(steps.map((s) => s['step']), `${what}: steps 0 … ${n - 1}`).toEqual(Array.from({ length: n }, (_, k) => k));
  return steps;
}
/** One item's value in a step record's per-item map (`hash`, `fuel`, `service_ns`, `mirror_ns`, `regions`). */
export function perItem(step: JsonObject, field: string, item: string, what: string): JsonValue {
  const m = obj(step[field], `${what}: step ${String(step['step'])}'s ${field}`);
  expect(item in m, `${what}: step ${String(step['step'])}'s ${field} has ${item}: ${show(m)}`).toBe(true);
  return m[item]!;
}
/** An array of a step record (`<item>.<name>`). */
export function arrayOf(step: JsonObject, path: string, what: string): JsonValue[] {
  return arr(obj(step['arrays'], `${what}: step ${String(step['step'])}'s arrays`)[path], `${what}: step ${String(step['step'])}'s ${path}`);
}
export const one = (step: JsonObject, path: string, what: string): number => num(arrayOf(step, path, what)[0], `${what}: step ${String(step['step'])}'s ${path}[0]`);
/** The reply's `handles`: the u32 each world and each of its bodies is interned to (README: handles). */
export interface Handles { worlds: Record<string, number>; bodies: Record<string, Record<string, number>> }
export function handlesOf(reply: JsonObject | undefined, what: string): Handles {
  expect(reply?.['code'], `${what}: the logic call answers, not refuses: ${show(reply)}`).toBeUndefined();
  const h = obj(reply!['handles'], `${what}: handles`);
  const worlds = obj(h['worlds'], `${what}: handles.worlds`);
  const bodies = obj(h['bodies'], `${what}: handles.bodies`);
  return {
    worlds: Object.fromEntries(Object.entries(worlds).map(([k, v]) => [k, int(v, `${what}: handles.worlds.${k}`)])),
    bodies: Object.fromEntries(Object.entries(bodies).map(([w, m]) => [w, Object.fromEntries(Object.entries(obj(m, `${what}: handles.bodies.${w}`)).map(([b, v]) => [b, int(v, `${what}: handles.bodies.${w}.${b}`)]))])),
  };
}
export function handleOf(h: Handles, worldId: string, body: string | null, what: string): number {
  const v = body === null ? h.worlds[worldId] : h.bodies[worldId]?.[body];
  expect(v, `${what}: handles name ${body === null ? `world ${worldId}` : `body ${body} of ${worldId}`}: ${JSON.stringify(h)}`).toBeDefined();
  return v!;
}

// ---------------------------------------------------------------------------------------------------
// Timing, judged by the perf lane's own rule (scripts/benchmark.mjs: judgeLimit on fingerprint()), imported, not copied.

export interface Judged { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string; runs: number[] }
export interface Bench { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => Judged; validateBudgets: (c: unknown, b: unknown) => void }
export async function bench(): Promise<Bench> {
  return (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
}
export const load = (): number => loadavg()[0] ?? Number.NaN;
export const readJson = (path: string): JsonValue => JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
