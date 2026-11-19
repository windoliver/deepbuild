// Test-side tools for #1431's acceptance tests (README: The surface under test). They reach the change only through
// what the README names: the reading each process answers (`footprint` on the replica `deep-drive` and on `deep-show
// run`, `readings` in the app's canvas fixture `deep-app --canvas`), the replica's planted programs, and `node
// scripts/cache-lint.mjs`. Nothing here stands in for a reader, a gauge, a cache or the lint under test: this file holds
// the builds, the drivers, the fixtures the tests make and the judges each criterion's wrong program must fail.
// Copied in part from #124's, #1482's, #1485's, #1729's and #1830's helpers, since suites don't import each other.

import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root: tests/acceptance/1431 is three levels down. */
export const REPO = realpathSync(join(HERE, '..', '..', '..'));

/** Each criterion's ID: `#1431.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const ID = {
  ac1: '#1431.aea056b4',
  ac2: '#1431.aa066358',
  ac3: '#1431.ee4481cb',
  ac4: '#1431.415d33d4',
  ac5: '#1431.77e19bb8',
  ac6: '#1431.46593b19',
  ac7: '#1431.c01cc90e',
} as const;

/** MB as the design writes it: 10^6 bytes. */
export const MB = 1_000_000;
export const mb = (bytes: number): string => `${(bytes / MB).toFixed(1)} MB`;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const short = (value: unknown, n = 800): string => JSON.stringify(value)?.slice(0, n) ?? 'undefined';
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${short(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${short(value)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${short(value)}`).toBe(true);
  return value as number;
}
/** No problems; the message lists them, each naming what failed. */
export function none(problems: readonly string[], what: string): void {
  expect(problems, `${what}:\n  ${problems.join('\n  ')}`).toEqual([]);
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The replica, the app's window and 3D render-back draw with Metal, on macOS only. */
export function requireMacos(what: string): void {
  if (process.platform !== 'darwin') inconclusive(`${what} draws with Metal, on macOS only; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The reading (README: The reading). A value that can't be read is null, with its row in `unknown`; never 0.

export interface Gauge { name: string; on: string; bytes: number | null; entries?: number | null; bound?: { entries: number | null; bytes: number | null } }
export interface Unknown { field: string; read: string; error: string }
export interface Reading {
  footprint: number | null;
  heap: number | null;
  gauges: Gauge[];
  unaccounted: number | null;
  device: number | null;
  unknown: Unknown[];
  gauges_ms: number;
}

const bytesOrNull = (v: JsonValue | undefined): v is number | null => v === null || (typeof v === 'number' && Number.isInteger(v));

/** Reads a reading's shape; every problem names the field. `what` names where it came from. */
export function readingOf(value: JsonValue | undefined, what: string): Reading {
  const r = obj(value, `${what}: the reading`);
  const problems: string[] = [];
  for (const field of ['footprint', 'heap', 'unaccounted', 'device']) {
    if (!(field in r) || !bytesOrNull(r[field])) problems.push(`${field} is bytes (a whole number) or null when it couldn't be read, got ${short(r[field])}`);
  }
  const gauges: Gauge[] = [];
  if (!Array.isArray(r['gauges'])) problems.push(`gauges is a list of gauges, got ${short(r['gauges'])}`);
  else {
    for (const [i, g] of r['gauges'].entries()) {
      if (!isObject(g) || typeof g['name'] !== 'string' || !['device', 'heap', 'other'].includes(String(g['on'])) || !bytesOrNull(g['bytes'])) {
        problems.push(`gauges[${i}] is {name, on: device | heap | other, bytes}, got ${short(g)}`);
        continue;
      }
      const gauge: Gauge = { name: g['name'], on: String(g['on']), bytes: g['bytes'] as number | null };
      if ('entries' in g) {
        if (!bytesOrNull(g['entries'])) problems.push(`gauges[${i}] (${gauge.name}).entries is a count or null, got ${short(g['entries'])}`);
        gauge.entries = g['entries'] as number | null;
      }
      if ('bound' in g) {
        const b = g['bound'];
        if (!isObject(b) || !bytesOrNull(b['entries']) || !bytesOrNull(b['bytes'])) problems.push(`gauges[${i}] (${gauge.name}).bound is {entries, bytes}, got ${short(b)}`);
        else gauge.bound = { entries: b['entries'] as number | null, bytes: b['bytes'] as number | null };
      }
      gauges.push(gauge);
    }
  }
  const unknown: Unknown[] = [];
  if (!Array.isArray(r['unknown'])) problems.push(`unknown is a list of {field, read, error}, got ${short(r['unknown'])}`);
  else {
    for (const [i, u] of r['unknown'].entries()) {
      if (!isObject(u) || typeof u['field'] !== 'string' || typeof u['read'] !== 'string' || typeof u['error'] !== 'string') problems.push(`unknown[${i}] is {field, read, error}, got ${short(u)}`);
      else unknown.push({ field: u['field'], read: u['read'], error: u['error'] });
    }
  }
  if (typeof r['gauges_ms'] !== 'number' || !Number.isFinite(r['gauges_ms']) || r['gauges_ms'] < 0) problems.push(`gauges_ms is the time the gauges took to read, in ms, got ${short(r['gauges_ms'])}`);
  none(problems, `${what}: the reading's shape`);
  return {
    footprint: r['footprint'] as number | null, heap: r['heap'] as number | null, gauges, unaccounted: r['unaccounted'] as number | null,
    device: r['device'] as number | null, unknown, gauges_ms: r['gauges_ms'] as number,
  };
}

/**
 * The Scope's arithmetic, as a list of problems: `unaccounted` is footprint less heap less every gauge's bytes, exactly,
 * when all of them are known, and null (unknown) when any of them isn't.
 */
export function arithmeticProblems(r: Reading, what: string): string[] {
  const parts = [r.footprint, r.heap, ...r.gauges.map((g) => g.bytes)];
  if (parts.some((p) => p === null)) {
    return r.unaccounted === null ? [] : [`${what}: unaccounted is ${r.unaccounted} B though ${[r.footprint === null ? 'footprint' : '', r.heap === null ? 'heap' : '', ...r.gauges.filter((g) => g.bytes === null).map((g) => `gauge ${g.name}`)].filter(Boolean).join(', ')} couldn't be read`];
  }
  const expected = r.footprint! - r.heap! - r.gauges.reduce((s, g) => s + g.bytes!, 0);
  return r.unaccounted === expected ? [] : [`${what}: unaccounted is ${r.unaccounted} B, not footprint ${r.footprint} less heap ${r.heap} less the gauges' ${r.gauges.reduce((s, g) => s + g.bytes!, 0)} B, ${expected} B`];
}

/** The gauges whose bytes are on the GPU device, summed. */
export const onDevice = (r: Reading): number => r.gauges.filter((g) => g.on === 'device').reduce((s, g) => s + (g.bytes ?? 0), 0);

// ---------------------------------------------------------------------------------------------------
// Builds: each file builds what it uses once, before its test, copies the binary out of target/ (so another file's
// build can't replace it mid-run) and fails the test that needs a build that failed, with cargo's own words.

const CARGO_ENV = (): NodeJS.ProcessEnv => ({
  ...process.env,
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
});
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');

/** AC1, AC2 and AC3: the replica with its planted programs (#124's build; a release build refuses env-plants). */
export const DRIVE_BUILD = { args: ['build', '--locked', '-p', 'deep-replica', '--bin', 'deep-drive', '--features', 'env-plants'], name: 'deep-drive', profile: 'debug' } as const;
/** AC5 and AC6: the app's own binary in its canvas fixture, in release, as the app ships (#1485's build). */
export const APP_BUILD = { args: ['build', '--locked', '--release', '-p', 'deep-app', '--bin', 'deep-app', '--features', 'canvas-fixture'], name: 'deep-app', profile: 'release' } as const;
/** AC7: deep-show, the hub's canvas core, in its shipped build set (#1729's build). */
export const SHOW_BUILD = { args: ['build', '--locked', '--bin', 'deep-show'], name: 'deep-show', profile: 'debug' } as const;

type Build = typeof DRIVE_BUILD | typeof APP_BUILD | typeof SHOW_BUILD;

/** Builds once before the file's test (macOS only); the getter returns the copied binary or fails naming cargo's error. */
export function useBuild(build: Build): () => string {
  let dir = '';
  let error = 'not built: the binaries are built on macOS only';
  beforeAll(() => {
    if (process.platform !== 'darwin') return;
    const r = spawnSync('cargo', [...build.args], { cwd: REPO, env: CARGO_ENV(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) error = `cargo could not run: ${r.error.message}`;
    else if (r.status !== 0) error = `cargo ${build.args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading|Finished/.test(l)).join('\n').slice(0, 4000)}`;
    else {
      dir = mkdtempSync(join(tmpdir(), 'deep-1431-bin-'));
      copyFileSync(join(targetDir(), build.profile, build.name), join(dir, build.name));
      error = '';
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    expect(error, `it builds: cargo ${build.args.join(' ')}`).toBe('');
    return join(dir, build.name);
  };
}

// ---------------------------------------------------------------------------------------------------
// Scratch folders and the processes this suite starts. Every process is stopped by its PID, never by name or port.

const made: string[] = [];
/** A scratch folder, removed after the file's tests. Short, under /tmp: a socket path must fit in 104 bytes. */
export function scratch(prefix = 'd1431-'): string {
  const dir = realpathSync(mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), prefix)));
  made.push(dir);
  return dir;
}
const owned = new Set<ChildProcess>();
afterEach(() => {
  for (const child of owned) if (child.exitCode === null && child.signalCode === null && child.pid) try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
});
afterAll(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** This environment with HOME moved to `home`, none of DeepBuild's own variables, plus `extra`. */
function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('DEEP_') && key !== 'NODE_OPTIONS') env[key] = value;
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config') });
  for (const [key, value] of Object.entries(extra)) if (value !== undefined) env[key] = value;
  return env;
}

// ---------------------------------------------------------------------------------------------------
// The replica: `deep-drive --out <dir>` (#124), one JSON call a line on stdin, one JSON reply a line on stdout.

export type Obj = { [key: string]: any };
/** The replica's planted programs (README: Planted programs), read only in an env-plants build. */
export const DRIVE_PLANT = {
  readFails: 'footprint-read-fails',
  readsZero: 'footprint-reads-zero',
  leaks: 'leaks-ungauged-buffer',
} as const;

export class Replica {
  private buffer = '';
  private readonly waiting: ((line: Obj) => void)[] = [];
  private stderr = '';
  private exited = false;
  private constructor(private readonly child: ChildProcess, readonly label: string) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const text = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let line: Obj;
        try { line = JSON.parse(text) as Obj; } catch { line = { unparsed: text.slice(0, 2000) }; }
        this.waiting.shift()?.(line);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.stderr = (this.stderr + d).slice(-4000); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true, stderr: this.stderr }); });
  }

  /** A replica process (a planted one when `plant` names it) with a replica launched in it. */
  static async start(bin: string, launch: Obj, plant?: string): Promise<Replica> {
    const dir = scratch();
    const out = join(dir, 'out');
    const home = join(dir, 'h');
    mkdirSync(out, { recursive: true });
    mkdirSync(home, { recursive: true });
    const child = spawn(bin, ['--out', out], { cwd: REPO, env: childEnv(home, { DEEP_DRIVE_PLANT: plant }), stdio: ['pipe', 'pipe', 'pipe'] });
    owned.add(child);
    const replica = new Replica(child, plant ? `the planted replica ${plant}` : 'the replica');
    const ready = await replica.next(600_000);
    expect(ready['ready'], `${replica.label} starts and says {"ready": true}: ${short(ready)}`).toBe(true);
    await replica.must({ call: 'launch', launch }, `launch ${short(launch)}`);
    return replica;
  }
  private next(timeoutMs: number): Promise<Obj> {
    if (this.exited) return Promise.resolve({ exited: true, stderr: this.stderr });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: timeoutMs }), timeoutMs);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  /** One call and its reply, whatever it says; a replica that answers nothing fails the test. */
  async call(args: Obj, timeoutMs = 600_000): Promise<Obj> {
    const answer = this.next(timeoutMs);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const reply = await answer;
    if (reply['exited'] || reply['timedOut'] || reply['unparsed'] !== undefined) expect.fail(`${this.label} gave no JSON reply to ${String(args['call'])}: ${short(reply)}`);
    return reply;
  }
  /** One call that must answer ok. */
  async must(args: Obj, what = String(args['call'])): Promise<Obj> {
    const reply = await this.call(args);
    expect(reply['ok'], `${this.label}: ${what}: ${short(reply)}`).toBe(true);
    return reply;
  }
  /** The process's reading, taken now: `{"call": "footprint"}` (README: The replica). */
  async reading(what: string): Promise<Reading> {
    const reply = await this.call({ call: 'footprint' });
    expect(reply['ok'], `${this.label} answers {"call": "footprint"} with the process's reading (${what}): ${short(reply)}`).toBe(true);
    return readingOf(reply['reading'], `${this.label} (${what})`);
  }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 15_000;
    while (!this.exited && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    if (!this.exited && this.child.pid) try { process.kill(this.child.pid, 'SIGKILL'); } catch { /* gone */ }
  }
}

// ---------------------------------------------------------------------------------------------------
// PNGs written in code, and the evidence store the app's canvas panel reads (`<dir>/<sha[0..2]>/<sha[2..]>`).

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Buffer): number { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(4); head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, tail]);
}
/**
 * An opaque 8-bit RGBA PNG of `w` × `h` px: one color, and one row of `n`'s 32 bits as black and white texels, so each
 * `n` is a picture of its own. It decodes to w × h × 4 bytes; one flat color makes it a small file.
 */
export function picturePng(w: number, h: number, n: number): Buffer {
  const rgb = [40 + ((n * 53) % 176), 40 + ((n * 97) % 176), 40 + ((n * 29) % 176)];
  const stride = 1 + w * 4;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([rgb[0]!, rgb[1]!, rgb[2]!, 255], y * stride + 1 + x * 4);
  for (let bit = 0; bit < 32 && bit < w; bit++) { const v = (n >>> bit) & 1 ? 255 : 0; raw.set([v, v, v, 255], 1 + bit * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
/** Writes `bytes` into the evidence store `dir` as the canvas panel reads it; returns the hash. */
export function putEvidence(dir: string, bytes: Uint8Array): string {
  const hash = sha256(bytes);
  mkdirSync(join(dir, hash.slice(0, 2)), { recursive: true });
  writeFileSync(join(dir, hash.slice(0, 2), hash.slice(2)), bytes);
  return hash;
}

// ---------------------------------------------------------------------------------------------------
// The app's canvas fixture: `deep-app --canvas <scenario.json>` (#1485), its report one JSON line on stdout.

/** One revision as the hub presents it (`canvas.drawn`, #995's shape): one agent layer holding one picture. */
export const presented = (rev: number, picture: string, window: [number, number]): JsonObject => ({
  doc: 'fig-1431', rev, rect: [0, 0, window[0], window[1]],
  layers: [{ layer: 'plot', owner: { session: 's-1431' }, band: 'agent', outline: false, items: ['figure'], picture }],
});

export interface CanvasFrame { frame: number; at_ms: number; pictures: string[]; held: number | null }
export interface CanvasReading { at_ms: number; frame: number; reading: Reading }
export interface CanvasReport { frames: CanvasFrame[]; handed: { rev: number; frame: number }[]; readings: CanvasReading[] | null; raw: JsonObject }

/**
 * Runs the app's canvas fixture over `scenario` (README: The app's canvas fixture) with a fresh HOME, and reads its
 * report. `onSecond` runs once a second while it runs (the timing test reads the load with it).
 */
export async function runCanvas(bin: string, scenario: JsonObject, what: string, onSecond?: (ms: number) => void): Promise<CanvasReport> {
  const dir = scratch();
  const file = join(dir, 'scenario.json');
  writeFileSync(file, JSON.stringify(scenario));
  const runMs = num(scenario['run_ms'], 'the scenario\'s run_ms');
  const child = spawn(bin, ['--canvas', file], { cwd: REPO, env: childEnv(join(dir)), stdio: ['ignore', 'pipe', 'pipe'] });
  owned.add(child);
  let stdout = '';
  let stderr = '';
  child.stdout!.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { stderr = (stderr + d).slice(-4000); });
  const started = Date.now();
  const ticker = onSecond ? setInterval(() => onSecond(Date.now() - started), 1_000) : undefined;
  const killer = setTimeout(() => { if (child.pid) try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ } }, runMs + 300_000);
  const status = await new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  clearTimeout(killer);
  if (ticker) clearInterval(ticker);
  expect(status, `${what}: deep-app --canvas exits 0 within its run and 5 minutes; stderr: ${stderr.slice(-2000)}`).toBe(0);
  const line = stdout.split('\n').reverse().find((l) => l.startsWith('{'));
  const raw = obj(line === undefined ? undefined : (JSON.parse(line) as JsonValue), `${what}: its report line`);
  const frames = arr(raw['frames'], `${what}: frames`).map((f, k) => {
    const x = obj(f, `${what}: frames[${k}]`);
    const pictures = arr(x['pictures'], `${what}: frames[${k}].pictures`).map(String);
    const held = x['held'];
    return { frame: k, at_ms: num(x['at_ms'], `${what}: frames[${k}].at_ms`), pictures, held: typeof held === 'number' ? held : null };
  });
  const handed = arr(raw['handed'], `${what}: handed`).map((h, i) => {
    const x = obj(h, `${what}: handed[${i}]`);
    return { rev: num(x['rev'], `${what}: handed[${i}].rev`), frame: num(x['frame'], `${what}: handed[${i}].frame`) };
  });
  const readings = Array.isArray(raw['readings'])
    ? raw['readings'].map((r, i) => {
      const x = obj(r, `${what}: readings[${i}]`);
      return { at_ms: num(x['at_ms'], `${what}: readings[${i}].at_ms`), frame: num(x['frame'], `${what}: readings[${i}].frame`), reading: readingOf(x['reading'], `${what}: readings[${i}]`) };
    })
    : null;
  return { frames, handed, readings, raw };
}

/**
 * A short run of the fixture with one picture and a reading a second, so a build without the readings fails fast:
 * its report must carry `readings` and each frame its `held` count (README: The app's canvas fixture).
 */
export async function probeCanvas(bin: string, evidence: string, what: string): Promise<void> {
  const window: [number, number] = [400, 400];
  const picture = putEvidence(evidence, picturePng(100, 100, 7));
  const report = await runCanvas(bin, { evidence, window, decode_ms: 0, run_ms: 2_500, read_every_ms: 1_000, revisions: [{ at_ms: 0, presented: presented(1, picture, window) }] }, `${what}: a 2.5 s probe`);
  expect(report.readings, `${what}: the canvas fixture's report carries readings, one at each whole read_every_ms (the scenario asked for one a second): ${short(report.raw['readings'] ?? Object.keys(report.raw))}`).not.toBeNull();
  expect(report.readings!.length, `${what}: a 2.5 s run with a reading a second carries at least 2 readings`).toBeGreaterThanOrEqual(2);
  expect(report.frames.every((f) => f.held !== null), `${what}: each frame row carries held, the pictures CanvasPanel.pictures holds: ${short(report.frames[0])}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (#393): one scenario line in, one answer line out. One line is one hub, and its one 3D renderer.

/** The agent's session and its process (#393), as #1729's suite gives them. */
export const SESSION = 'sess-1431';
/** A document ID the hub minted (26 Crockford characters). */
export const DOC = '01JB1431D00000000000000001';
/** A scenario: the agent's session, one document in a visible panel, then `calls`. */
export function showScenario(evidence: string, calls: JsonObject[]): JsonObject {
  return {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-1431', name: 'Test agent: meshes', process: { pid: 4131, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 4131, ppid: 1, start: 1_000 }],
    panels: { p1: { rect: [0, 0, 320, 240] } },
    docs: { [DOC]: { panel: 'p1' } },
    calls,
  };
}
/** `deep-show run` on one scenario: its one answer line, whatever it says. */
export function runShow(bin: string, scenario: JsonObject, what: string): JsonObject {
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 3_600_000, killSignal: 'SIGKILL' });
  if (run.error) expect.fail(`${what}: deep-show run: ${run.error.message}`);
  expect(run.status, `${what}: deep-show run exits 0 (${run.signal ?? 'no signal'}); stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
  const lines = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line for the one scenario line`).toBe(1);
  return obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
}

// ---------------------------------------------------------------------------------------------------
// The cache lint: `node scripts/cache-lint.mjs [--root <checkout>]` (README: The cache lint).

export const LINT = 'scripts/cache-lint.mjs';
export interface Lint { status: number | null; fails: { path: string; line: number; message: string }[]; passes: number; output: string }

const shown = (r: SpawnSyncReturns<string>): string => `exit ${r.status}${r.signal ? ` (${r.signal})` : ''}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;

/** Runs this checkout's cache lint, over `root` when given; each FAIL line read as `FAIL cache: <path>:<line>: <message>`. */
export function lint(root?: string): Lint {
  expect(existsSync(join(REPO, LINT)), `${LINT} is missing: no lint finds a long-lived cache that declares one bound and not the other`).toBe(true);
  const r = spawnSync(process.execPath, [join(REPO, LINT), ...(root === undefined ? [] : ['--root', root])], { cwd: REPO, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  const output = shown(r);
  const lines = (r.stdout ?? '').split('\n').map((l) => l.trimEnd());
  const fails = lines.filter((l) => l.startsWith('FAIL')).map((l) => {
    const m = /^FAIL cache: (\S+?):(\d+): (.+)$/.exec(l);
    expect(m, `a FAIL line in the form "FAIL cache: <path>:<line>: <message>": ${l}\n${output}`).not.toBeNull();
    return { path: m![1]!, line: Number(m![2]), message: m![3]! };
  });
  return { status: r.status, fails, passes: lines.filter((l) => l === 'PASS cache' || l.startsWith('PASS cache:')).length, output };
}
/** A scratch checkout holding only `files` (repo-relative path → text), for the lint's --root. */
export function lintRoot(files: Record<string, string>): string {
  const root = scratch('d1431-lint-');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
/** A copy of this checkout's file at `path` into the scratch checkout `root`. */
export function copyInto(root: string, path: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  cpSync(join(REPO, path), join(root, path));
}
/** scripts/lanes.mjs as this checkout has it. */
export const lanes = async (): Promise<{ checks: { name: string; commands: string[][] }[] }> => import(pathToFileURL(join(REPO, 'scripts', 'lanes.mjs')).href);

/** A cache declaration (README: The cache lint): a `//` or `///` comment `cache: <part>, <part>`, each `entries <bound>` or `bytes <bound>`. */
export const DECLARATION = /^(\s*\/\/\/?\s*cache:\s*)(.+?)\s*$/;
const parts = (text: string): string[] => text.split(',').map((p) => p.trim()).filter(Boolean);
/** The parts of the declaration on `line` (what follows `cache:`), or none. */
const declared = (line: string): string[] => {
  const m = line.includes('//') ? DECLARATION.exec(line.slice(line.indexOf('//'))) : null;
  return m ? parts(m[2]!) : [];
};
/** Whether the declaration on `line` holds an `entries` or a `bytes` part. */
export const declares = (line: string, bound: 'entries' | 'bytes'): boolean => declared(line).some((p) => new RegExp(`^${bound}\\s+\\S`).test(p));

/**
 * Where `lines` declare the cache held at line `at` (0-based): its own line, after the code, or a line of the unbroken
 * run of comment and attribute lines just above it. Returns that line's index, or -1.
 */
export function declarationOf(lines: string[], at: number): number {
  const own = lines[at]!.indexOf('//');
  if (own >= 0 && DECLARATION.test(lines[at]!.slice(own))) return at;
  for (let i = at - 1; i >= 0 && /^\s*(\/\/|#\[|#!\[)/.test(lines[i]!); i--) if (DECLARATION.test(lines[i]!)) return i;
  return -1;
}
/** The declaration on line `i` with its entry bound taken out, the byte bound kept. */
export function withoutEntryBound(line: string): string {
  const own = line.indexOf('//');
  const head = line.slice(0, own);
  const m = DECLARATION.exec(line.slice(own))!;
  return `${head}${m[1]}${parts(m[2]!).filter((p) => !/^entries\s/.test(p)).join(', ')}`;
}

// ---------------------------------------------------------------------------------------------------
// Timing (README: AC5). The lane's rule is scripts/benchmark.mjs's judgeLimit, imported, never copied: off a reference
// Mac (Mac15,7, Mac15,12 or Mac17,10), off mains power, in Low Power Mode, with the thermal state not nominal or a load
// above the cores at a run's start or end, a result is a reading and INCONCLUSIVE, never PASS.

interface Bench {
  judgeLimit(a: { limit: number; runs: number[]; fingerprint: unknown; loads: { start: number; end: number }[] }): { status: string; reason?: string; margin?: number };
  fingerprint(): Obj;
}
export const benchmark = async (): Promise<Bench> => (await import(pathToFileURL(join(REPO, 'scripts', 'benchmark.mjs')).href)) as Bench;
export const load = (): number => loadavg()[0]!;
export const CORES = availableParallelism();
