// Test-side tools for the #547 acceptance tests (README: The surface under test), after #532's suite. They
// assemble this suite's WebAssembly programs with #544's assembler (read-only; README: Run them), build and drive
// the logic module's runner `deep-logic` on this Mac, and judge wall-clock readings with the perf lane's own rule
// (scripts/benchmark.mjs). Nothing here stands in for the logic module: every hash, ring, size, verdict and
// array read here is the implementation's own; the expected values come from the issue's text and this suite's
// programs.

import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/547 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};

/** Every test passes this timeout: the 108,000-step and 72,000-step legs take many minutes on a loaded Mac. */
export const TIMEOUT = 5_400_000;
/** Builds before a file's tests (the slow part), so each test's own time is its own. */
export function prebuild(fn: () => void): void { beforeAll(() => { try { fn(); } catch { /* each test reports its own build failure */ } }, TIMEOUT); }

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = { 1: '#547.7471f558', 2: '#547.1bfe7240', 3: '#547.afa00681', 4: '#547.636c1d36', 5: '#547.cb4a7b2c' } as const;

export const FLICKS = 705_600_000;
export const KIB = 1024;
export const MIB = 1024 * KIB;
/** A WebAssembly page, the unit a checkpoint keeps (Logic: checkpoints and bake). */
export const PAGE = 65_536;
export const HASH64 = /^[0-9a-f]{16}$/;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${show(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${show(value)}`).toBe(true);
  return value as JsonValue[];
}
export function int(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isSafeInteger(value), `${what} is an integer, got ${show(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${show(value)}`).toBe('string');
  return value as string;
}
const intOrNull = (v: JsonValue | undefined, what: string): number | null => (v === null || v === undefined ? null : int(v, what));
const strOrNull = (v: JsonValue | undefined, what: string): string | null => (v === null || v === undefined ? null : str(v, what));
function hexMap(v: JsonValue | undefined, what: string): Record<string, string> {
  return Object.fromEntries(Object.entries(obj(v, what)).map(([id, h]) => { const s = str(h, `${what}.${id}`); expect(s, `${what}.${id}`).toMatch(HASH64); return [id, s]; }));
}
const hashLists = (v: JsonValue | undefined, what: string): Record<string, string[]> =>
  Object.fromEntries(Object.entries(obj(v, what)).map(([id, l]) => [id, arr(l, `${what}.${id}`).map((h, i) => str(h, `${what}.${id}[${i}]`))]));
export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A seeded generator (mulberry32), so a failing run replays. */
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
/** The first line two lists differ at, or null. */
export function firstDiff(a: readonly string[], b: readonly string[]): string | null {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `#${i}: ${(a[i] ?? '(none)').slice(0, 200)} against ${(b[i] ?? '(none)').slice(0, 200)}`;
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Programs: WebAssembly text assembled by #544's assembler (tests/acceptance/544/wat, used read-only: the `wat`
// crate, outside the workspace, its own lockfile). #532's has the same source but its lockfile predates
// .cargo/config.toml's later patches, so `--locked` refuses it at this base.

export interface Program { name: string; bytes: Buffer; b64: string; sha: string }

function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|was not used|^help:|^\s{6}/.test(l)).join('\n').slice(-4000)}`;
  return '';
}

const WAT_DIR = join(REPO, 'tests', 'acceptance', '544', 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-544-wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const error = cargo(['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], REPO, { CARGO_TARGET_DIR: WAT_TARGET });
  if (error) blocked(`the assembler this suite uses (tests/acceptance/544/wat) didn't build: ${error}`);
  watBin = join(WAT_TARGET, 'debug', exe('acceptance-544-wat'));
  return watBin;
}
const assembled = new Map<string, Program>();
/** Assembles WebAssembly text into a Program. */
export function assemble(name: string, text: string): Program {
  const known = assembled.get(`${name}\n${text}`);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-547-wat-'));
  try {
    const file = join(dir, `${name}.wat`);
    writeFileSync(file, text);
    const run = spawnSync(assembler(), [dir, file], { encoding: 'utf8', maxBuffer: 64 * MIB });
    if (run.status !== 0) throw Error(`the assembler refused ${name}: ${run.stderr.slice(-2000)}`);
    const bytes = readFileSync(join(dir, `${name}.wasm`));
    const p = { name, bytes, b64: bytes.toString('base64'), sha: sha256(bytes) };
    assembled.set(`${name}\n${text}`, p);
    return p;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// The runner `deep-logic` (README: deep-logic), JSON lines in, one reply per line.

export const LOGIC_BIN = 'deep-logic';
/** `deep-logic --planted <name>`: each one criterion's wrong program, or criterion 5's failing store (README: Planted). */
export type Planted =
  | 'tracker_skips_memory_fill' | 'ranges_drop_second_at_step_5000' | 'ring_drops_oldest'
  | 'keyframes_held_in_ring' | 'store_fails_at_step_120';
const plantedArgs = (planted: Planted[]): string[] => planted.flatMap((p) => ['--planted', p]);

export interface Started { status: number | null; signal: NodeJS.Signals | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
function parseLines(stdout: string): JsonValue[] {
  return stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
}
export function start(cmd: string, args: string[], inputs: JsonValue[], timeoutMs = 4_800_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(cmd, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  // A process that exits before reading its input (an unknown --planted name) is EPIPE here: its status says why.
  if (run.error && !timedOut && (run.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${cmd} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  return { status: run.status, signal: run.signal, timedOut, lines: parseLines(stdout), stdout, stderr: run.stderr ?? '' };
}
/** One reply per call from a run that exited 0. */
export function replies(s: Started, calls: JsonValue[], what: string): JsonObject[] {
  expect(s.timedOut, `${what} finished within its timeout`).toBe(false);
  expect(s.status, `${what} exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${what}: one reply per call (stdout: ${s.stdout.slice(0, 600)})`).toBe(calls.length);
  return s.lines.map((l, i) => obj(l, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 160)})`));
}

let binsDir = '';
let builtLogic: { bin: string; error: string } | undefined;
/** `cargo build --locked --bin deep-logic` in the checkout, copied out, once per process. */
export function logicBin(): string {
  if (!builtLogic) {
    if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-547-bins-'));
    const bin = join(binsDir, exe(LOGIC_BIN));
    const error = cargo(['build', '--locked', '--bin', LOGIC_BIN], REPO, {});
    if (error === '') copyFileSync(join(TARGET, 'debug', exe(LOGIC_BIN)), bin);
    builtLogic = { bin, error };
  }
  expect(builtLogic.error, `${LOGIC_BIN} builds on this host (cargo build --locked --bin ${LOGIC_BIN})`).toBe('');
  return builtLogic.bin;
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; builtLogic = undefined; });

/** Runs `calls` through one `deep-logic [--planted p]...` process on this Mac. */
export function onMac(calls: JsonObject[], planted: Planted[] = []): JsonObject[] {
  const args = plantedArgs(planted);
  return replies(start(logicBin(), args, calls), calls, `${LOGIC_BIN} ${args.join(' ')} on ${process.platform}/${process.arch}`);
}

/**
 * A long-lived `deep-logic` process (criterion 4): one call, one awaited reply, so a test drives a session call by
 * call and times each on its own clock (`ms`: from the line written to its reply read). Stopped by its PID.
 */
export interface Live { call: (c: JsonObject) => Promise<{ reply: JsonObject; ms: number }>; stop: () => void }
export function live(planted: Planted[] = []): Live {
  const child: ChildProcessWithoutNullStreams = spawn(logicBin(), plantedArgs(planted), { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = ''; let stderr = '';
  const waiting: ((line: string) => void)[] = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d: string) => {
    buffer += d;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1); waiting.shift()?.(line); }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => { stderr += d; if (stderr.length > 100_000) stderr = stderr.slice(-50_000); });
  // A process that has exited (an unknown --planted name) answers as `exited` below, not as a write error.
  child.stdin.on('error', () => {});
  if (child.pid === undefined) throw Error(`${LOGIC_BIN} didn't start`);
  const pid = child.pid;
  const exited = new Promise<string>((res) => child.once('exit', (code) => res(`{"ok":false,"code":"exited","status":${JSON.stringify(code)},"stderr":${JSON.stringify(stderr.slice(-1500))}}`)));
  return {
    call: async (c) => {
      const got = new Promise<string>((res) => waiting.push(res));
      const started = performance.now();
      child.stdin.write(`${JSON.stringify(c)}\n`);
      const text = await Promise.race([got, exited]);
      const ms = performance.now() - started;
      let parsed: JsonValue;
      try { parsed = JSON.parse(text) as JsonValue; } catch { parsed = text; }
      return { reply: obj(parsed, `${LOGIC_BIN}'s reply to ${show(c).slice(0, 120)}`), ms };
    },
    stop: () => { if (child.exitCode === null) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } } },
  };
}

// ---------------------------------------------------------------------------------------------------
// Pieces (#531's README: Piece) and the calls.

export type WriteType = 'bool' | 'i32' | 'f64' | 'vec2' | 'vec3' | 'quat';
export interface ItemSpec {
  program: Program;
  stepRate?: number;
  reads?: string[];
  writes: Record<string, { type: WriteType; count?: number }>;
  budget?: { fuel?: number; memory?: number; stack?: number };
  checkpoint?: { every?: number; budget?: number };
}
export interface PieceSpec { seed: number; items: Record<string, ItemSpec>; controls?: string[] }
/** A piece as `deep-logic` takes it: the document's seed, its controls, its logic items and the programs they name. */
export function piece(p: PieceSpec): JsonObject {
  const assets: JsonObject = {};
  const items: JsonObject = {};
  for (const [id, spec] of Object.entries(p.items)) {
    assets[spec.program.sha] = spec.program.b64;
    const params: JsonObject = { program: spec.program.sha, writes: spec.writes as unknown as JsonObject };
    if (spec.stepRate) params['step_rate'] = spec.stepRate;
    if (spec.reads) params['reads'] = spec.reads;
    if (spec.budget) params['budget'] = spec.budget as JsonObject;
    if (spec.checkpoint) params['checkpoint'] = spec.checkpoint as JsonObject;
    items[id] = { kind: 'logic@1', params };
  }
  return {
    seed: p.seed,
    ...(p.controls ? { controls: Object.fromEntries(p.controls.map((c) => [c, { kind: 'slider' }])) } : {}),
    items, assets,
  };
}
export interface Entry { t: number; seq: number; control: string; value: number; writer: 'you' | 'tour'; player: number }
/** An entry on the input track at step `k` of an item stepping at `rate` Hz (its flick exactly on the step). */
export const entryAt = (control: string, k: number, value: number, rate = 60, player = 1, seq = 0): Entry =>
  ({ t: k * (FLICKS / rate), seq, control, value, writer: 'you', player });

export const checkCall = (p: JsonObject): JsonObject => ({ call: 'check', piece: p });
export interface RestoreSpec { from: number; steps: number }
export interface ProbeSpec { at: number; entries: Entry[]; steps: number }
export interface SeekSpec { to: number; probe?: { entries: Entry[]; steps: number } }
export interface BakeSpec { track?: Entry[]; steps: number; restores?: RestoreSpec[]; probes?: ProbeSpec[]; seeks?: SeekSpec[] }
const bakeFields = (p: JsonObject, b: BakeSpec): JsonObject => ({
  piece: p, track: (b.track ?? []) as unknown as JsonValue, steps: b.steps,
  ...(b.restores ? { restores: b.restores as unknown as JsonValue } : {}),
  ...(b.probes ? { probes: b.probes as unknown as JsonValue } : {}),
  ...(b.seeks ? { seeks: b.seeks as unknown as JsonValue } : {}),
});
export const bakeCall = (p: JsonObject, b: BakeSpec): JsonObject => ({ call: 'bake', ...bakeFields(p, b) });
/** Seeks to `targets`, each with a continuation probe, and the straight run's same probes from the same steps, in one order. */
export function seeksAndProbes(targets: number[], entries: (s: number) => Entry[], steps: number): Pick<BakeSpec, 'seeks' | 'probes'> {
  return { seeks: targets.map((to) => ({ to, probe: { entries: entries(to), steps } })), probes: targets.map((at) => ({ at, entries: entries(at), steps })) };
}
/** A track of one slider: an entry every `gap` to 2 × `gap` steps, each a seeded integer below `values`. */
export function sliderTrack(control: string, seed: number, steps: number, gap: number, values: number, rate = 60): Entry[] {
  const r = seeded(seed);
  const out: Entry[] = [];
  for (let k = Math.floor(r() * gap); k < steps; k += gap + Math.floor(r() * gap)) out.push(entryAt(control, k, Math.floor(r() * values), rate));
  return out;
}
/** This suite's `playback` (README): the bake's sizes and each array rebuilt from the bake alone at the steps `at`. */
export const playbackCall = (p: JsonObject, b: BakeSpec, at: number[]): JsonObject => ({ call: 'playback', ...bakeFields(p, b), at });
/** logic.determinism (#532's README: determinism): `at_times` in seconds. */
export const determinismCall = (p: JsonObject, b: BakeSpec, atTimes: number[]): JsonObject =>
  ({ call: 'determinism', ...bakeFields(p, b), at_times: atTimes, compare: 'same_machine' });
/** #531's `open`, with this suite's `cache` (README: sessions). */
export const openCall = (p: JsonObject, track: Entry[], cache?: { dir: string; budget: number }): JsonObject =>
  ({ call: 'open', piece: p, track: track as unknown as JsonValue, ...(cache ? { cache } : {}) });
export const stepCall = (session: string, to: number): JsonObject => ({ call: 'step', session, to });
export const seekCall = (session: string, to: number): JsonObject => ({ call: 'seek', session, to });

// Replies.

/** The offset of a region entry in a `check` reply's layout. */
export function offsetOf(reply: JsonObject, item: string, region: 'reads' | 'writes', name: string): number {
  expect(reply['ok'], `check admits the piece (ok: true): ${show(reply)}`).toBe(true);
  const layout = obj(obj(obj(reply['items'], 'check.items')[item], `check.items.${item}`)['layout'], `check.items.${item}.layout`);
  const e = arr(layout['entries'], 'layout.entries').map((x) => obj(x, 'layout entry')).find((x) => x['region'] === region && x['name'] === name);
  expect(e, `the layout has a ${region} entry ${name}: ${show(layout)}`).toBeDefined();
  return int(e!['offset'], `${region}.${name}.offset`);
}

export interface ItemStep { hash: string | null; fuel: number; pages: number[] }
export interface StepRecord { step: number; items: Record<string, ItemStep>; arrays: Record<string, JsonValue[]> }
export interface Checkpoint { step: number; deep_hash: string }
export interface ProbeResult { at: number; steps: StepRecord[]; deep_hash: Record<string, string> }
export interface RestoreResult { from: number; checkpoints: Record<string, Checkpoint[]>; steps: StepRecord[] }
export interface SeekResult {
  to: number; from: number | null; error: string | null; hashes: Record<string, string[]>;
  checkpoint: { step: number; deep_hash: Record<string, string> } | null;
  probe: { hashes: Record<string, string[]>; deep_hash: Record<string, string> } | null;
}
/** A checkpoint as the ring keeps it when the bake ends (README: the ring). */
export interface Kept { step: number; whole: boolean; pages: number[]; memory: number; globals: number; bytes: number }
export interface Ring { budget: number; bytes: number; spacing: number; checkpoints: Kept[] }
export interface Bake {
  steps: StepRecord[]; checkpoints: Record<string, Checkpoint[]>; traps: JsonObject[]; restores: RestoreResult[];
  probes: ProbeResult[]; seeks: SeekResult[]; ring: Record<string, Ring>; raw: JsonObject;
}
function stepsOf(v: JsonValue | undefined, what: string): StepRecord[] {
  return arr(v, what).map((s, i) => {
    const o = obj(s, `${what}[${i}]`);
    const items = Object.fromEntries(Object.entries(obj(o['items'], `${what}[${i}].items`)).map(([id, x]) => {
      const it = obj(x, `${what}[${i}].items.${id}`);
      const hash = strOrNull(it['hash'], `${what}[${i}].items.${id}.hash`);
      if (hash !== null) expect(hash, `${what}[${i}].items.${id}.hash is 16 hex digits`).toMatch(HASH64);
      return [id, { hash, fuel: int(it['fuel'], `${what}[${i}].items.${id}.fuel`), pages: arr(it['pages'] ?? [], `${what}[${i}].items.${id}.pages`).map((p, j) => int(p, `${what}[${i}].items.${id}.pages[${j}]`)) }];
    }));
    const arrays = Object.fromEntries(Object.entries(obj(o['arrays'] ?? {}, `${what}[${i}].arrays`)).map(([k, x]) => [k, arr(x, `${what}[${i}].arrays.${k}`)]));
    return { step: int(o['step'], `${what}[${i}].step`), items, arrays };
  });
}
function checkpointsOf(v: JsonValue | undefined, what: string): Record<string, Checkpoint[]> {
  return Object.fromEntries(Object.entries(obj(v ?? {}, what)).map(([id, list]) => [id, arr(list, `${what}.${id}`).map((c, i) => {
    const o = obj(c, `${what}.${id}[${i}]`);
    const deep = str(o['deep_hash'], `${what}.${id}[${i}].deep_hash`);
    expect(deep, `${what}.${id}[${i}].deep_hash is 16 hex digits`).toMatch(HASH64);
    return { step: int(o['step'], `${what}.${id}[${i}].step`), deep_hash: deep };
  })]));
}
function seekOf(v: JsonValue, what: string): SeekResult {
  const o = obj(v, what);
  const to = int(o['to'], `${what}.to`);
  const error = strOrNull(o['error'], `${what}.error`);
  if (error !== null) return { to, from: intOrNull(o['from'], `${what}.from`), error, hashes: {}, checkpoint: null, probe: null };
  const c = obj(o['checkpoint'], `${what}.checkpoint`);
  const p = o['probe'];
  return {
    to, from: int(o['from'], `${what}.from`), error, hashes: hashLists(o['hashes'], `${what}.hashes`),
    checkpoint: { step: int(c['step'], `${what}.checkpoint.step`), deep_hash: hexMap(c['deep_hash'], `${what}.checkpoint.deep_hash`) },
    probe: p === null || p === undefined ? null : { hashes: hashLists(obj(p, `${what}.probe`)['hashes'], `${what}.probe.hashes`), deep_hash: hexMap(obj(p, `${what}.probe`)['deep_hash'], `${what}.probe.deep_hash`) },
  };
}
/** The bake's `ring` (README: the ring): each item's checkpoints as its ring keeps them. */
export function ringOf(reply: JsonObject, what: string): Record<string, Ring> {
  return Object.fromEntries(Object.entries(obj(reply['ring'], `${what}.ring (each item's checkpoint ring as the bake leaves it)`)).map(([id, v]) => {
    const w = `${what}.ring.${id}`;
    const r = obj(v, w);
    const checkpoints = arr(r['checkpoints'], `${w}.checkpoints`).map((c, i) => {
      const o = obj(c, `${w}.checkpoints[${i}]`);
      expect(typeof o['whole'], `${w}.checkpoints[${i}].whole is a bool`).toBe('boolean');
      return {
        step: int(o['step'], `${w}.checkpoints[${i}].step`), whole: o['whole'] === true,
        pages: arr(o['pages'], `${w}.checkpoints[${i}].pages`).map((p, j) => int(p, `${w}.checkpoints[${i}].pages[${j}]`)),
        memory: int(o['memory'], `${w}.checkpoints[${i}].memory`), globals: int(o['globals'], `${w}.checkpoints[${i}].globals`),
        bytes: int(o['bytes'], `${w}.checkpoints[${i}].bytes`),
      };
    });
    return [id, { budget: int(r['budget'], `${w}.budget`), bytes: int(r['bytes'], `${w}.bytes`), spacing: int(r['spacing'], `${w}.spacing`), checkpoints }];
  }));
}
/** A `bake` reply: the fields this suite reads, typed. The ring is read first: the base has none. */
export function bakeOf(reply: JsonObject, what: string): Bake {
  expect(reply['ok'], `${what} baked the piece (ok: true): ${show(reply)}`).toBe(true);
  const ring = ringOf(reply, what);
  return {
    ring,
    steps: stepsOf(reply['steps'], `${what}.steps`),
    checkpoints: checkpointsOf(reply['checkpoints'], `${what}.checkpoints`),
    traps: arr(reply['traps'] ?? [], `${what}.traps`).map((t, i) => obj(t, `${what}.traps[${i}]`)),
    restores: arr(reply['restores'] ?? [], `${what}.restores`).map((r, i) => {
      const o = obj(r, `${what}.restores[${i}]`);
      return { from: int(o['from'], `${what}.restores[${i}].from`), checkpoints: checkpointsOf(o['checkpoints'], `${what}.restores[${i}].checkpoints`), steps: stepsOf(o['steps'], `${what}.restores[${i}].steps`) };
    }),
    probes: arr(reply['probes'] ?? [], `${what}.probes`).map((p, i) => {
      const o = obj(p, `${what}.probes[${i}]`);
      return { at: int(o['at'], `${what}.probes[${i}].at`), steps: stepsOf(o['steps'], `${what}.probes[${i}].steps`), deep_hash: hexMap(o['deep_hash'], `${what}.probes[${i}].deep_hash`) };
    }),
    seeks: arr(reply['seeks'] ?? [], `${what}.seeks`).map((s, i) => seekOf(s, `${what}.seeks[${i}]`)),
    raw: reply,
  };
}
/** The item's step hash at each step. */
export const hashesOf = (steps: StepRecord[], id: string): string[] => steps.map((s) => s.items[id]?.hash ?? 'null');
/** One line per step: its hash and every array, for comparing runs. */
export const rows = (steps: StepRecord[], id: string): string[] => steps.map((s) => JSON.stringify([s.step, s.items[id]?.hash ?? null, Object.entries(s.arrays).sort()]));
/** The straight run's full-state hash at checkpoint `step`. */
export const deepAt = (b: Bake, id: string, step: number): string | undefined => (b.checkpoints[id] ?? []).find((c) => c.step === step)?.deep_hash;

/**
 * Each seek of a bake against playing (#532's README: Seeks): it restored a checkpoint the ring holds at most
 * `back` steps before it, and gives playing's step hashes up to the first ring checkpoint after it, that
 * checkpoint's full-state hash, and its continuation probe (the straight run's probe from the same step, the
 * bake's probe `i` for seek `i`). Each failure names the seek's step.
 */
export function judgeSeeks(b: Bake, id: string, targets: number[], back: number): string[] {
  const failures: string[] = [];
  expect(b.seeks.map((s) => s.to), 'one seek result per seek, in the order asked').toEqual(targets);
  expect(b.probes.map((p) => p.at), 'one straight probe per seek, from the step it seeks to').toEqual(targets);
  const ring = (b.ring[id]?.checkpoints ?? []).map((c) => c.step);
  const straight = hashesOf(b.steps, id);
  for (const [i, s] of b.seeks.entries()) {
    if (s.error !== null || s.from === null) { failures.push(`seek to ${s.to}: it restored no checkpoint (${s.error ?? 'from is null'})`); continue; }
    if (s.from > s.to || s.to - s.from > back) { failures.push(`seek to ${s.to}: it restored checkpoint ${s.from}, more than ${back} steps back`); continue; }
    if (!ring.includes(s.from)) failures.push(`seek to ${s.to}: it restored step ${s.from}, which the ring doesn't hold (${ring.join(', ')})`);
    const next = ring.find((c) => c > s.to);
    if (s.checkpoint === null || s.checkpoint.step !== next) { failures.push(`seek to ${s.to}: it reports checkpoint ${s.checkpoint?.step ?? 'none'}, not ${next ?? 'none'}, the first the ring holds after it`); continue; }
    if (s.checkpoint.deep_hash[id] !== deepAt(b, id, next)) failures.push(`seek to ${s.to}: the full-state hash of checkpoint ${next}, the first after the seek, differs from playing`);
    const d = firstDiff(s.hashes[id] ?? [], straight.slice(s.to, next));
    if (d) failures.push(`seek to ${s.to}: step hashes differ from playing at ${d}`);
    const p = b.probes[i];
    if (!s.probe || !p || firstDiff([...(s.probe.hashes[id] ?? []), s.probe.deep_hash[id] ?? ''], [...hashesOf(p.steps, id), p.deep_hash[id] ?? ''])) failures.push(`seek to ${s.to}: its continuation probe differs from playing's`);
  }
  return failures;
}

/** A logic.determinism failure (#532's README: determinism, with this suite's `run: "playback"` and `element`). */
export interface DetFailure { item: string; run: string; from: number | null; at: number | null; checkpoint: number | null; step: number | null; field: string; array: string | null; element: number | null }
export interface Verdict { verdict: string; failures: DetFailure[]; raw: JsonObject }
export function determinismOf(reply: JsonObject, what: string): Verdict {
  expect(reply['ok'], `${what} ran (ok: true): ${show(reply)}`).toBe(true);
  expect(reply['kind'], `${what} is logic.determinism`).toBe('logic.determinism');
  const verdict = str(reply['verdict'], `${what}.verdict`);
  const failures = arr(reply['failures'], `${what}.failures`).map((f, i) => {
    const o = obj(f, `${what}.failures[${i}]`);
    const w = `${what}.failures[${i}]`;
    return {
      item: str(o['item'], `${w}.item`), run: str(o['run'], `${w}.run`), from: intOrNull(o['from'], `${w}.from`), at: intOrNull(o['at'], `${w}.at`),
      checkpoint: intOrNull(o['checkpoint'], `${w}.checkpoint`), step: intOrNull(o['step'], `${w}.step`), field: str(o['field'], `${w}.field`),
      array: strOrNull(o['array'], `${w}.array`), element: intOrNull(o['element'], `${w}.element`),
    };
  });
  return { verdict, failures, raw: reply };
}

/** A `playback` reply (README: playback). */
export interface Playback { stored: Record<string, number>; arrays: { step: number; arrays: Record<string, JsonValue[]> }[] }
export function playbackOf(reply: JsonObject, what: string): Playback {
  expect(reply['ok'], `${what} ran (ok: true): ${show(reply)}`).toBe(true);
  const stored = Object.fromEntries(Object.entries(obj(reply['stored'], `${what}.stored`)).map(([id, v]) => [id, int(obj(v, `${what}.stored.${id}`)['arrays'], `${what}.stored.${id}.arrays`)]));
  const arrays = arr(reply['arrays'], `${what}.arrays`).map((x, i) => {
    const o = obj(x, `${what}.arrays[${i}]`);
    return { step: int(o['step'], `${what}.arrays[${i}].step`), arrays: Object.fromEntries(Object.entries(obj(o['arrays'], `${what}.arrays[${i}].arrays`)).map(([k, v]) => [k, arr(v, `${what}.arrays[${i}].arrays.${k}`)])) };
  });
  return { stored, arrays };
}

// ---------------------------------------------------------------------------------------------------
// Sessions and the cache (criterion 4).

/** A temporary folder for a session's cache; removed by the caller. */
export const cacheDir = (): string => mkdtempSync(join(tmpdir(), 'deep-547-cache-'));
/** Bytes the files under `dir` hold (their sizes), and how many there are. */
export function diskUse(dir: string): { bytes: number; files: number } {
  let bytes = 0; let files = 0;
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else { bytes += s.size; files += 1; }
    }
  };
  walk(dir);
  return { bytes, files };
}

// ---------------------------------------------------------------------------------------------------
// Wall-clock readings, judged by the perf lane's own rule: `judgeLimit` on `fingerprint()` in scripts/benchmark.mjs
// (design: Numbers version 0 has to hold; The reference Mac), imported, not copied. PASS when all five readings are
// within the limit, FAIL when all five are over it by more than the margin (the larger of 5% and their spread), and
// INCONCLUSIVE off a reference Mac, off mains power, in Low Power Mode, at a thermal state other than nominal, with
// the one-minute load at a run's start or end above the core count, or with readings on both sides.

export interface Judged { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string; runs: number[]; margin?: number }
export interface Bench { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => Judged }
export async function bench(): Promise<Bench> {
  return (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
}
export const load = (): number => loadavg()[0] ?? Number.NaN;
export const cores = (): number => availableParallelism();
