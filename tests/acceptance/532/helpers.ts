// Test-side tools for the #532 acceptance tests (README: The surface under test), after #531's suite. They
// assemble this suite's WebAssembly programs with its own assembler (wat/), build and drive the logic module's
// runner `deep-logic` on this Mac and, through Docker, on Linux x86_64, and run the logic module's web runner in
// headless Chrome. Nothing here stands in for the logic module: every hash, key, verdict, report and frame read
// here is the implementation's own; the expected values come from the issue's text and this suite's programs.

import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/532 is three levels down). */
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

/** Every test passes this timeout: a first build of deep-logic, and its Linux build under emulation, take many minutes. */
export const TIMEOUT = 5_400_000;
/** Builds before a file's tests (the slow part), so each test's own time is its own. */
export function prebuild(fn: () => void): void { beforeAll(() => { try { fn(); } catch { /* each test reports its own build failure */ } }, TIMEOUT); }

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = { 1: '#532.9d44e928', 2: '#532.635473e1', 3: '#532.09272844', 4: '#532.fb0103f2', 5: '#532.67c825d1', 6: '#532.de739d63' } as const;

export const FLICKS = 705_600_000;
export const STEP_60 = FLICKS / 60;
/** checkpoint.every's default (Logic `logic@1`): one checkpoint spacing. */
export const EVERY = 60;
export const MIB = 1024 * 1024;
export const HASH64 = /^[0-9a-f]{16}$/;
export const DIGEST = /^[0-9a-f]{64}$/;
/** The figure class's frame CPU (Budget classes), which the render worker's simulate phase must keep to. */
export const FRAME_CPU_NS = 4_000_000;
/** The UI thread's bound a frame (Render worker: Cost). */
export const UI_NS = 2_000_000;

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
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${show(value)}`).toBe(true);
  return value as number;
}
export function int(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isSafeInteger(value), `${what} is an integer, got ${show(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${show(value)}`).toBe('string');
  return value as string;
}
const strOrNull = (v: JsonValue | undefined, what: string): string | null => (v === null || v === undefined ? null : str(v, what));
const intOrNull = (v: JsonValue | undefined, what: string): number | null => (v === null || v === undefined ? null : int(v, what));
const hexMap = (v: JsonValue | undefined, what: string, re = HASH64): Record<string, string> =>
  Object.fromEntries(Object.entries(obj(v, what)).map(([id, h]) => { const s = str(h, `${what}.${id}`); expect(s, `${what}.${id}`).toMatch(re); return [id, s]; }));
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
/** `n` seeded bytes. */
export function bytesOf(seed: number, n: number): Buffer {
  const r = seeded(seed);
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = Math.floor(r() * 256);
  return b;
}

// ---------------------------------------------------------------------------------------------------
// Programs: WebAssembly text assembled by this suite's own assembler (wat/: the `wat` crate, outside the workspace).

export interface Program { name: string; bytes: Buffer; b64: string; sha: string }

function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|was not used|^help:|^\s{6}/.test(l)).join('\n').slice(-4000)}`;
  return '';
}

const WAT_DIR = join(HERE, 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-532-wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const error = cargo(['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR, { CARGO_TARGET_DIR: WAT_TARGET });
  if (error) blocked(`this suite's assembler (tests/acceptance/532/wat) didn't build: ${error}`);
  watBin = join(WAT_TARGET, 'debug', exe('acceptance-532-wat'));
  return watBin;
}
const assembled = new Map<string, Program>();
/** Assembles WebAssembly text into a Program. */
export function assemble(name: string, text: string): Program {
  const known = assembled.get(`${name}\n${text}`);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-532-wat-'));
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
/** `deep-logic --planted <name>`: each one criterion's wrong program (README: Planted twins). */
export type Planted =
  | 'checkpoint_drops_globals' | 'restore_keeps_regions_only' | 'check_compares_step_hashes'
  | 'restore_copies_assets' | 'simulate_runs_all_steps' | 'budget_sums_fuel_only';
const plantedArgs = (planted: Planted[]): string[] => planted.flatMap((p) => ['--planted', p]);

export interface Started { status: number | null; signal: NodeJS.Signals | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
function parseLines(stdout: string): JsonValue[] {
  return stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
}
export function start(cmd: string, args: string[], inputs: JsonValue[], timeoutMs = 3_600_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(cmd, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  // A process that exits before reading its input (an unknown --planted name) is EPIPE here: its status says why.
  if (run.error && !timedOut && (run.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${cmd} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  return { status: run.status, signal: run.signal, timedOut, lines: parseLines(stdout), stdout, stderr: run.stderr ?? '' };
}
/** One reply per call from a run that exited 0; each failure names the host. */
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
    if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-532-bins-'));
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

// Linux x86_64: the same checkout built for linux/amd64 in Docker with the rust image of the toolchain
// rust-toolchain.toml names, its caches under target/acceptance-532-linux/. Nothing is pulled: a missing image is BLOCKED.
const LINUX = join(TARGET, 'acceptance-532-linux');
export function linuxImage(): string {
  const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1];
  if (!channel) throw Error('rust-toolchain.toml names no channel');
  return `rust:${channel}-slim-bookworm`;
}
function docker(args: string[], input?: string, timeoutMs = 600_000): { status: number | null; stdout: string; stderr: string; timedOut: boolean } {
  const run = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) return { status: null, stdout: '', stderr: run.error.message, timedOut };
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '', timedOut };
}
function hasAmd64(image: string): boolean {
  const perPlatform = docker(['image', 'inspect', '--platform', 'linux/amd64', '--format', '{{.Architecture}}', image], undefined, 30_000);
  if (perPlatform.status === 0 && perPlatform.stdout.trim() === 'amd64') return true;
  return docker(['image', 'inspect', '--format', '{{.Architecture}}', image], undefined, 30_000).stdout.trim() === 'amd64';
}
let linuxBuilt: string | undefined;
/** Builds `deep-logic` for linux/amd64 once per process; BLOCKED without Docker or the image, FAIL when cargo fails. */
function linuxLogic(): void {
  if (linuxBuilt === undefined) {
    const info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 30_000);
    if (info.status !== 0) blocked(`Docker is unreachable (docker info: ${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); Linux x86_64 runs in a linux/amd64 container`);
    const image = linuxImage();
    if (!hasAmd64(image)) blocked(`Docker has no linux/amd64 image ${image} here and this suite pulls nothing; run: docker pull --platform linux/amd64 ${image}`);
    for (const d of ['target', 'registry', 'git']) mkdirSync(join(LINUX, d), { recursive: true });
    const build = docker([
      'run', '--rm', '--platform', 'linux/amd64',
      '-v', `${REPO}:/src:ro`, '-v', `${join(LINUX, 'target')}:/target`,
      '-v', `${join(LINUX, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(LINUX, 'git')}:/usr/local/cargo/git`,
      '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${image.replace(/^rust:/, '').replace(/-slim-bookworm$/, '')}`,
      '-e', `CARGO_INCREMENTAL=${CARGO_ENV['CARGO_INCREMENTAL']}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${CARGO_ENV['CARGO_PROFILE_DEV_DEBUG']}`,
      image, 'cargo', 'build', '--locked', '--bin', LOGIC_BIN,
    ], undefined, TIMEOUT - 600_000);
    linuxBuilt = build.status === 0 ? '' : `cargo build --locked --bin ${LOGIC_BIN} in ${image} (linux/amd64) failed${build.timedOut ? ' (timed out)' : ''}:\n${build.stderr.slice(-4000)}`;
  }
  expect(linuxBuilt, `${LOGIC_BIN} builds for Linux x86_64`).toBe('');
}
/** Runs `calls` through one `deep-logic` process in a linux/amd64 container. */
export function onLinux(calls: JsonObject[]): JsonObject[] {
  linuxLogic();
  const text = `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`;
  const r = docker(['run', '--rm', '-i', '--platform', 'linux/amd64', '-v', `${join(LINUX, 'target')}:/target:ro`, linuxImage(), `/target/debug/${LOGIC_BIN}`], text, 1_800_000);
  const s: Started = { status: r.status, signal: null, timedOut: r.timedOut, lines: parseLines(r.stdout), stdout: r.stdout, stderr: r.stderr };
  return replies(s, calls, `${LOGIC_BIN} on linux/amd64`);
}

/** A long-lived `deep-logic` process (criterion 5): one call, one awaited reply, so a test drives a view frame by frame. Stopped by its PID. */
export interface Live { call: (c: JsonObject) => Promise<JsonObject>; stop: () => void }
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
  child.stderr.on('data', (d: string) => { stderr += d; });
  // A process that has exited (an unknown --planted name) answers as `exited` below, not as a write error.
  child.stdin.on('error', () => {});
  if (child.pid === undefined) throw Error(`${LOGIC_BIN} didn't start`);
  const pid = child.pid;
  const exited = new Promise<string>((res) => child.once('exit', () => res(`{"ok":false,"code":"exited","stderr":${JSON.stringify(stderr.slice(-1500))}}`)));
  return {
    call: async (c) => {
      const got = new Promise<string>((res) => waiting.push(res));
      child.stdin.write(`${JSON.stringify(c)}\n`);
      const text = await Promise.race([got, exited]);
      let parsed: JsonValue;
      try { parsed = JSON.parse(text) as JsonValue; } catch { parsed = text; }
      return obj(parsed, `${LOGIC_BIN}'s reply to ${show(c).slice(0, 120)}`);
    },
    stop: () => { if (child.exitCode === null) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } } },
  };
}

// ---------------------------------------------------------------------------------------------------
// Pieces (README: Piece) and the calls.

export type WriteType = 'bool' | 'i32' | 'f64' | 'vec2' | 'vec3' | 'quat';
export interface ItemSpec {
  program: Program;
  reads?: string[];
  writes: Record<string, { type: WriteType; count?: number }>;
  /** Data assets the item names, in order: by sha256, their bytes carried in the piece's `assets`. */
  assets?: Buffer[];
  budget?: { fuel?: number; memory?: number; stack?: number };
  checkpoint?: { every?: number; budget?: number };
}
export interface PieceSpec { seed: number; items: Record<string, ItemSpec>; controls?: string[]; class?: string }
/** A piece as `deep-logic` takes it: the document's seed and budget class, its controls, its logic items and the assets they name. */
export function piece(p: PieceSpec): JsonObject {
  const assets: JsonObject = {};
  const items: JsonObject = {};
  for (const [id, spec] of Object.entries(p.items)) {
    assets[spec.program.sha] = spec.program.b64;
    const params: JsonObject = { program: spec.program.sha, writes: spec.writes as unknown as JsonObject };
    if (spec.reads) params['reads'] = spec.reads;
    if (spec.assets) params['assets'] = spec.assets.map((b) => { const s = sha256(b); assets[s] = b.toString('base64'); return s; });
    if (spec.budget) params['budget'] = spec.budget as JsonObject;
    if (spec.checkpoint) params['checkpoint'] = spec.checkpoint as JsonObject;
    items[id] = { kind: 'logic@1', params };
  }
  return {
    seed: p.seed,
    ...(p.class ? { class: p.class } : {}),
    ...(p.controls ? { controls: Object.fromEntries(p.controls.map((c) => [c, { kind: 'slider' }])) } : {}),
    items, assets,
  };
}
export interface Entry { t: number; seq: number; control: string; value: number; writer: 'you' | 'tour'; player: number }
/** An entry of yours on the input track at step `k` of a 60 Hz item (its flick exactly on the step). */
export const yours = (control: string, k: number, value: number, seq = 0): Entry => ({ t: k * STEP_60, seq, control, value, writer: 'you', player: 1 });

export const ABOUT: JsonObject = { call: 'about' };
export const WEB_RUNNER: JsonObject = { call: 'web_runner' };
export const checkCall = (p: JsonObject): JsonObject => ({ call: 'check', piece: p });
export interface Restore { from: number; steps: number; probe?: { entries: Entry[]; steps: number } }
export interface ProbeSpec { at: number; entries: Entry[]; steps: number }
export interface SeekSpec { to: number; probe?: { entries: Entry[]; steps: number } }
export interface BakeSpec { track?: Entry[]; steps: number; restores?: Restore[]; probes?: ProbeSpec[]; seeks?: SeekSpec[] }
const bakeFields = (p: JsonObject, b: BakeSpec): JsonObject => ({
  piece: p, track: (b.track ?? []) as unknown as JsonValue, steps: b.steps,
  ...(b.restores ? { restores: b.restores as unknown as JsonValue } : {}),
  ...(b.probes ? { probes: b.probes as unknown as JsonValue } : {}),
  ...(b.seeks ? { seeks: b.seeks as unknown as JsonValue } : {}),
});
export const bakeCall = (p: JsonObject, b: BakeSpec): JsonObject => ({ call: 'bake', ...bakeFields(p, b) });
export const webPlanCall = (p: JsonObject, b: BakeSpec): JsonObject => ({ call: 'web_plan', ...bakeFields(p, b) });
export const goldenCall = (p: JsonObject, b: BakeSpec): JsonObject => ({ call: 'golden', ...bakeFields(p, b) });
export const goldenVerifyCall = (p: JsonObject, b: BakeSpec, golden: JsonObject): JsonObject => ({ call: 'golden_verify', ...bakeFields(p, b), golden });
/** logic.determinism (Check input: logic kinds): `at_times` in seconds. */
export const determinismCall = (p: JsonObject, b: BakeSpec, atTimes: number[]): JsonObject =>
  ({ call: 'determinism', ...bakeFields(p, b), at_times: atTimes, compare: 'same_machine' });
/** logic.budget (Check input: logic kinds). */
export const budgetCall = (p: JsonObject, b: BakeSpec, on: ('app' | 'web')[] = ['app'], fuelShare = 0.5): JsonObject =>
  ({ call: 'budget', ...bakeFields(p, b), fuel_share: fuelShare, on });

// Replies.

export interface Layout { digest: string; entries: { region: string; name: string; offset: number; size: number }[] }
export function layoutOf(v: JsonValue | undefined, what: string): Layout {
  const o = obj(v, what);
  const entries = arr(o['entries'], `${what}.entries`).map((e, i) => {
    const x = obj(e, `${what}.entries[${i}]`);
    return { region: str(x['region'], `${what}.entries[${i}].region`), name: str(x['name'], `${what}.entries[${i}].name`), offset: int(x['offset'], `${what}.entries[${i}].offset`), size: int(x['size'], `${what}.entries[${i}].size`) };
  });
  return { digest: str(o['digest'], `${what}.digest`), entries };
}
/** A `check` reply's admitted items' layouts: `{ok: true, items: {id: {program, hash, layout}}}`. */
export function admitted(reply: JsonObject, what: string): Record<string, Layout> {
  expect(reply['ok'], `${what} admits the piece (ok: true): ${show(reply)}`).toBe(true);
  return Object.fromEntries(Object.entries(obj(reply['items'], `${what}.items`)).map(([id, v]) => [id, layoutOf(obj(v, `${what}.items.${id}`)['layout'], `${what}.items.${id}.layout`)]));
}
/** Where an item's region entry sits: its offset in its region. */
export function entryAt(l: Layout, region: 'reads' | 'writes', name: string): { offset: number; size: number } {
  const e = l.entries.find((x) => x.region === region && x.name === name);
  if (!e) throw Error(`the layout has no ${region} entry ${name}: ${JSON.stringify(l.entries)}`);
  return { offset: e.offset, size: e.size };
}
/** The layout `check` gives an item built from `layoutProbe` with these reads and writes. */
export function layoutFor(spec: Omit<ItemSpec, 'program'> & { program: Program }, controls: string[] = []): Layout {
  const [reply] = onMac([checkCall(piece({ seed: 532, controls, items: { probe: spec } }))]);
  return admitted(reply!, 'check of the layout probe')['probe']!;
}

export interface ItemStep { hash: string | null; fuel: number; failed: boolean }
export interface StepRecord { step: number; items: Record<string, ItemStep>; arrays: Record<string, JsonValue[]> }
export interface Checkpoint { step: number; deep_hash: string }
export interface ProbeResult { at: number; steps: StepRecord[]; deep_hash: Record<string, string> }
export interface RestoreResult { from: number; checkpoints: Record<string, Checkpoint[]>; steps: StepRecord[]; probe: ProbeResult | null }
export interface SeekResult {
  to: number; from: number; hashes: Record<string, string[]>; checkpoint: { step: number; deep_hash: Record<string, string> };
  probe: { hashes: Record<string, string[]>; deep_hash: Record<string, string> } | null;
}
export interface Bake {
  keys: Record<string, string> | null; steps: StepRecord[]; checkpoints: Record<string, Checkpoint[]>; traps: JsonObject[];
  restores: RestoreResult[]; probes: ProbeResult[]; seeks: SeekResult[]; raw: JsonObject;
}
function stepsOf(v: JsonValue | undefined, what: string): StepRecord[] {
  return arr(v, what).map((s, i) => {
    const o = obj(s, `${what}[${i}]`);
    const items = Object.fromEntries(Object.entries(obj(o['items'], `${what}[${i}].items`)).map(([id, x]) => {
      const it = obj(x, `${what}[${i}].items.${id}`);
      const hash = strOrNull(it['hash'], `${what}[${i}].items.${id}.hash`);
      if (hash !== null) expect(hash, `${what}[${i}].items.${id}.hash is 16 hex digits`).toMatch(HASH64);
      return [id, { hash, fuel: int(it['fuel'], `${what}[${i}].items.${id}.fuel`), failed: it['failed'] === true }];
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
function probeOf(v: JsonValue | undefined, what: string): ProbeResult {
  const o = obj(v, what);
  return { at: int(o['at'], `${what}.at`), steps: stepsOf(o['steps'], `${what}.steps`), deep_hash: hexMap(o['deep_hash'], `${what}.deep_hash`) };
}
const hashLists = (v: JsonValue | undefined, what: string): Record<string, string[]> =>
  Object.fromEntries(Object.entries(obj(v, what)).map(([id, l]) => [id, arr(l, `${what}.${id}`).map((h, i) => str(h, `${what}.${id}[${i}]`))]));
function seekOf(v: JsonValue, what: string): SeekResult {
  const o = obj(v, what);
  const c = obj(o['checkpoint'], `${what}.checkpoint`);
  const p = o['probe'];
  return {
    to: int(o['to'], `${what}.to`), from: int(o['from'], `${what}.from`), hashes: hashLists(o['hashes'], `${what}.hashes`),
    checkpoint: { step: int(c['step'], `${what}.checkpoint.step`), deep_hash: hexMap(c['deep_hash'], `${what}.checkpoint.deep_hash`) },
    probe: p === null || p === undefined ? null : { hashes: hashLists(obj(p, `${what}.probe`)['hashes'], `${what}.probe.hashes`), deep_hash: hexMap(obj(p, `${what}.probe`)['deep_hash'], `${what}.probe.deep_hash`) },
  };
}
/** A `bake` reply (or the web runner's `bake`): the fields this suite reads, typed. */
export function bakeOf(reply: JsonObject, what: string): Bake {
  expect(reply['ok'], `${what} baked the piece (ok: true): ${show(reply)}`).toBe(true);
  return {
    keys: reply['keys'] === undefined ? null : hexMap(reply['keys'], `${what}.keys`, DIGEST),
    steps: stepsOf(reply['steps'], `${what}.steps`),
    checkpoints: checkpointsOf(reply['checkpoints'], `${what}.checkpoints`),
    traps: arr(reply['traps'] ?? [], `${what}.traps`).map((t, i) => obj(t, `${what}.traps[${i}]`)),
    restores: arr(reply['restores'] ?? [], `${what}.restores`).map((r, i) => {
      const o = obj(r, `${what}.restores[${i}]`);
      return { from: int(o['from'], `${what}.restores[${i}].from`), checkpoints: checkpointsOf(o['checkpoints'], `${what}.restores[${i}].checkpoints`), steps: stepsOf(o['steps'], `${what}.restores[${i}].steps`), probe: o['probe'] ? probeOf(o['probe'], `${what}.restores[${i}].probe`) : null };
    }),
    probes: arr(reply['probes'] ?? [], `${what}.probes`).map((p, i) => probeOf(p, `${what}.probes[${i}]`)),
    seeks: arr(reply['seeks'] ?? [], `${what}.seeks`).map((s, i) => seekOf(s, `${what}.seeks[${i}]`)),
    raw: reply,
  };
}
/** The item's step hash at each step, from `from` on. */
export const hashesOf = (steps: StepRecord[], id: string): string[] => steps.map((s) => s.items[id]?.hash ?? 'null');
/** One line per step: its hash and every array, for comparing runs. */
export const rows = (steps: StepRecord[], id: string): string[] => steps.map((s) => JSON.stringify([s.step, s.items[id]?.hash ?? null, Object.entries(s.arrays).sort()]));
/** The first line two lists differ at, or null. */
export function firstDiff(a: readonly string[], b: readonly string[]): string | null {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `#${i}: ${(a[i] ?? '(none)').slice(0, 200)} against ${(b[i] ?? '(none)').slice(0, 200)}`;
  return null;
}
/** The first step whose step hash differs between two runs' records, or null. */
export function firstStepDiff(a: StepRecord[], b: StepRecord[], id: string): number | null {
  const byStep = new Map(b.map((s) => [s.step, s.items[id]?.hash ?? null]));
  for (const s of a) if ((s.items[id]?.hash ?? null) !== byStep.get(s.step)) return s.step;
  return null;
}

/** A logic.determinism failure (README: determinism). */
export interface DetFailure { item: string; run: string; from: number | null; at: number | null; checkpoint: number | null; step: number | null; field: string; array: string | null; control: string | null }
export interface Verdict<F> { verdict: string; failures: F[]; raw: JsonObject }
export function determinismOf(reply: JsonObject, what: string): Verdict<DetFailure> {
  expect(reply['ok'], `${what} ran (ok: true): ${show(reply)}`).toBe(true);
  expect(reply['kind'], `${what} is logic.determinism`).toBe('logic.determinism');
  const verdict = str(reply['verdict'], `${what}.verdict`);
  const failures = arr(reply['failures'], `${what}.failures`).map((f, i) => {
    const o = obj(f, `${what}.failures[${i}]`);
    const w = `${what}.failures[${i}]`;
    return {
      item: str(o['item'], `${w}.item`), run: str(o['run'], `${w}.run`), from: intOrNull(o['from'], `${w}.from`), at: intOrNull(o['at'], `${w}.at`),
      checkpoint: intOrNull(o['checkpoint'], `${w}.checkpoint`), step: intOrNull(o['step'], `${w}.step`), field: str(o['field'], `${w}.field`),
      array: strOrNull(o['array'], `${w}.array`), control: strOrNull(o['control'], `${w}.control`),
    };
  });
  return { verdict, failures, raw: reply };
}

/** A logic.budget failure and report (README: budget). */
export interface BudgetFailure { rule: string; item: string | null; step: number | null; host: string | null; items: number | null; per_item_ns: number | null }
export interface BudgetReport { items: Record<string, { step: number; fuel: number; share: number }>; fixed: Record<string, { at: Record<string, number>; per_item_ns: number }> }
export function budgetOf(reply: JsonObject, what: string): Verdict<BudgetFailure> & { report: BudgetReport } {
  expect(reply['ok'], `${what} ran (ok: true): ${show(reply).slice(0, 600)}`).toBe(true);
  expect(reply['kind'], `${what} is logic.budget`).toBe('logic.budget');
  const verdict = str(reply['verdict'], `${what}.verdict`);
  const failures = arr(reply['failures'], `${what}.failures`).map((f, i) => {
    const o = obj(f, `${what}.failures[${i}]`);
    const w = `${what}.failures[${i}]`;
    return {
      rule: str(o['rule'], `${w}.rule`), item: strOrNull(o['item'], `${w}.item`), step: intOrNull(o['step'], `${w}.step`), host: strOrNull(o['host'], `${w}.host`),
      items: intOrNull(o['items'], `${w}.items`), per_item_ns: o['per_item_ns'] === null || o['per_item_ns'] === undefined ? null : num(o['per_item_ns'], `${w}.per_item_ns`),
    };
  });
  const r = obj(reply['report'], `${what}.report`);
  const items = Object.fromEntries(Object.entries(obj(r['items'], `${what}.report.items`)).map(([id, v]) => {
    const o = obj(v, `${what}.report.items.${id}`);
    return [id, { step: int(o['step'], `${what}.report.items.${id}.step`), fuel: int(o['fuel'], `${what}.report.items.${id}.fuel`), share: num(o['share'], `${what}.report.items.${id}.share`) }];
  }));
  const fixed = Object.fromEntries(Object.entries(obj(r['fixed'], `${what}.report.fixed`)).map(([host, v]) => {
    const o = obj(v, `${what}.report.fixed.${host}`);
    return [host, { at: Object.fromEntries(Object.entries(obj(o['at'], `${what}.report.fixed.${host}.at`)).map(([n, ns]) => [n, num(ns, `${what}.report.fixed.${host}.at.${n}`)])), per_item_ns: num(o['per_item_ns'], `${what}.report.fixed.${host}.per_item_ns`) }];
  }));
  return { verdict, failures, raw: reply, report: { items, fixed } };
}

/** A golden (README: golden): the fields this suite reads, and the object as the runner gave it. */
export interface Golden { bake_key: Record<string, string>; machine: { os: string; arch: string }; step_hashes: Record<string, string[]>; checkpoint_hashes: Record<string, Checkpoint[]>; raw: JsonObject }
export function goldenOf(reply: JsonObject, what: string): Golden {
  expect(reply['ok'], `${what} recorded a golden (ok: true): ${show(reply)}`).toBe(true);
  const g = obj(reply['golden'], `${what}.golden`);
  const m = obj(g['machine'], `${what}.golden.machine`);
  return { bake_key: hexMap(g['bake_key'], `${what}.golden.bake_key`, DIGEST), machine: { os: str(m['os'], `${what}.golden.machine.os`), arch: str(m['arch'], `${what}.golden.machine.arch`) }, step_hashes: hashLists(g['step_hashes'], `${what}.golden.step_hashes`), checkpoint_hashes: checkpointsOf(g['checkpoint_hashes'], `${what}.golden.checkpoint_hashes`), raw: g };
}
export interface GoldenCheck { verdict: string; machines: string; first_step: number | null; raw: JsonObject }
export function goldenCheckOf(reply: JsonObject, what: string): GoldenCheck {
  expect(reply['ok'], `${what} ran (ok: true): ${show(reply)}`).toBe(true);
  return { verdict: str(reply['verdict'], `${what}.verdict`), machines: str(reply['machines'], `${what}.machines`), first_step: intOrNull(reply['first_step'], `${what}.first_step`), raw: reply };
}

/** A live view of a piece with no bake (README: view and frame). */
export const viewCall = (p: JsonObject, track: Entry[], span: number): JsonObject => ({ call: 'view', piece: p, track: track as unknown as JsonValue, span });
export const frameCall = (session: string, act: { seek?: number; set?: { control: string; value: number } } = {}): JsonObject =>
  ({ call: 'frame', session, ...(act.seek !== undefined ? { seek: act.seek } : {}), ...(act.set ? { set: act.set } : {}) });

/** One live frame of a view (README: view and frame). */
export interface Frame { frame: number; t: number; want: number; at: number; stale: boolean; steps: number; eval_ns: number; ui_ns: number; deep_hash: Record<string, string>; stamped: JsonObject | null; fork_at: number | null }
export function frameOf(reply: JsonObject, what: string): Frame {
  expect(reply['ok'], `${what} ran (ok: true): ${show(reply)}`).toBe(true);
  return {
    frame: int(reply['frame'], `${what}.frame`), t: int(reply['t'], `${what}.t`), want: int(reply['want'], `${what}.want`), at: int(reply['at'], `${what}.at`),
    stale: reply['stale'] === true, steps: int(reply['steps'], `${what}.steps`), eval_ns: num(reply['eval_ns'], `${what}.eval_ns`), ui_ns: num(reply['ui_ns'], `${what}.ui_ns`),
    deep_hash: hexMap(reply['deep_hash'], `${what}.deep_hash`),
    stamped: reply['stamped'] === null || reply['stamped'] === undefined ? null : obj(reply['stamped'], `${what}.stamped`),
    fork_at: intOrNull(reply['fork_at'], `${what}.fork_at`),
  };
}

// ---------------------------------------------------------------------------------------------------
// Headless Chrome: a page this test serves imports the logic module's web runner (`web_runner`'s source) and runs
// each request through its `bake` in Chrome's own WebAssembly engine, posting the replies back.

export const CHROME = process.env['CHROME_BIN'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = `<!doctype html><meta charset="utf-8"><title>#532 web runner</title><script type="module">
const post = (body) => fetch('/results', { method: 'POST', body: JSON.stringify(body) });
try {
  const runner = await import('/runner.mjs');
  const requests = await (await fetch('/requests.json')).json();
  const replies = [];
  for (const request of requests) {
    try { replies.push(await runner.bake(request)); }
    catch (e) { replies.push({ ok: false, code: 'runner_threw', message: String((e && e.stack) || e) }); }
  }
  await post({ userAgent: navigator.userAgent, replies });
} catch (e) { await post({ userAgent: navigator.userAgent, error: String((e && e.stack) || e) }); }
</script>`;
/** Runs `requests` through the web runner `source` in headless Chrome; BLOCKED without Chrome. */
export async function inChrome(source: string, requests: JsonValue[], timeoutMs = 1_200_000): Promise<{ userAgent: string; replies: JsonValue[] }> {
  if (!existsSync(CHROME)) blocked(`no headless Chrome at ${CHROME} (set CHROME_BIN); the web player's engine runs there`);
  const profile = mkdtempSync(join(tmpdir(), 'deep-532-chrome-'));
  let settle: (v: JsonObject) => void = () => {};
  const posted = new Promise<JsonObject>((res) => { settle = res; });
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (req.method === 'POST' && url === '/results') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c: string) => { body += c; });
      req.on('end', () => { res.end('ok'); try { settle(JSON.parse(body) as JsonObject); } catch { settle({ error: `unreadable post: ${body.slice(0, 500)}` }); } });
      return;
    }
    const send = (type: string, text: string): void => { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(text); };
    if (url === '/' || url === '/index.html') send('text/html', PAGE);
    else if (url === '/runner.mjs') send('text/javascript', source);
    else if (url === '/requests.json') send('application/json', JSON.stringify(requests));
    else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
  const port = (server.address() as AddressInfo).port;
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--use-mock-keychain', '--password-store=basic', '--disable-background-networking', '--disable-component-update',
    `--user-data-dir=${profile}`, `http://127.0.0.1:${port}/`], { detached: true, stdio: 'ignore' });
  let timer: NodeJS.Timeout | undefined;
  try {
    const out = await Promise.race([posted, new Promise<JsonObject>((res) => { timer = setTimeout(() => res({ error: `no reply from the page within ${timeoutMs} ms` }), timeoutMs); })]);
    if (typeof out['error'] === 'string') expect.fail(`headless Chrome: the web runner page failed: ${out['error']}`);
    return { userAgent: str(out['userAgent'], 'the page\'s userAgent'), replies: arr(out['replies'], 'the page\'s replies') };
  } finally {
    if (timer) clearTimeout(timer);
    // Chrome and its helpers are this test's own process group (a detached child): stopped by its PID.
    if (chrome.pid) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* already gone */ } }
    await new Promise<void>((res) => server.close(() => res()));
    rmSync(profile, { recursive: true, force: true });
  }
}
