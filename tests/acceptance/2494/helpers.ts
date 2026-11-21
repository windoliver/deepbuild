// Test-side tools for the #2494 acceptance tests (README: The surface under test): the two builds; a real hub
// (`deep hub run`) in a temporary home that takes the fixture's 3D document through `deep show` and says what it
// presents to the app (`canvas.drawn`, read as the app reads it); the app's canvas panel in the app's real window
// (`deep-app --canvas`, #1485's fixture mode) fed that presentation as it came; the report's parser; the PNG reader
// and the comparison of a slot's frame with the window's pixels; and the count of read-back buffers over the frames
// a view played. Nothing here stands in for the hub's canvas side, the panel, a GPU-layer view or the counted device.
// Patterns copied from #26's, #806's and #1485's helpers, since suites don't import each other.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rgb = [number, number, number];
export type Box = [number, number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root: tests/acceptance/2494 is three levels down. */
export const REPO = join(HERE, '..', '..', '..');
const NODE = process.execPath;
/** The built CLI: `deep hub run` and `deep show` (`npm run build --workspaces`). */
const CLI = join(REPO, 'packages', 'cli', 'dist', 'main.js');

/** Each criterion's tag: `AC<n> #2494.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC2 = 'AC2 #2494.99fbfc41';
export const AC3 = 'AC3 #2494.b45bba38';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const short = (value: JsonValue | undefined, n = 600): string => JSON.stringify(value)?.slice(0, n) ?? 'undefined';
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
/** A count: a whole number at or above 0. */
export function count(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isInteger(value) && value >= 0, `${what} is a count (a whole number ≥ 0), got ${short(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value === 'string' && value !== '', `${what} is text, got ${short(value)}`).toBe(true);
  return value as string;
}

// ---------------------------------------------------------------------------------------------------
// Where a test can't be judged: it skips with a note starting INCONCLUSIVE, never passing (#1485's, #1487's form).

export function onlyOnMacos(ctx: TestContext): void {
  if (process.platform !== 'darwin') ctx.skip(`INCONCLUSIVE: the app's window and its GPU-layer views draw on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The proof (the issue's Proof line: the app's frame, the counts): written under the OS temp folder, rewritten on
// each run and never read back.

export const PROOF_DIR = join(tmpdir(), 'deep-2494-proof');
export function proof(name: string, value: JsonValue | Buffer): string {
  mkdirSync(PROOF_DIR, { recursive: true });
  const file = join(PROOF_DIR, name);
  writeFileSync(file, Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 1)}\n`);
  return file;
}

// ---------------------------------------------------------------------------------------------------
// Temporary folders (short: a socket path must fit in 104 bytes on macOS) and the processes this suite started,
// which it alone stops, by PID.

const made: string[] = [];
function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh2494-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
/** Stops what this suite started, by PID (SIGTERM, then SIGKILL after 15 s), and removes its folders. */
async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 15_000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------------
// Builds: each file builds what it uses once and fails each test that needs a build that failed, with cargo's
// error. `cargo` comes from PATH.

const CARGO_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
};
function cargo(args: string[]): string {
  const r = spawnSync('cargo', args, { cwd: REPO, env: CARGO_ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status === 0) return '';
  const said = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading|Finished/.test(l)).join('\n');
  return `cargo ${args.join(' ')} failed:\n${said.slice(0, 4000)}`;
}
/** Where cargo, run in the checkout, puts what it builds. */
const targetDir = (): string => resolve(REPO, process.env['CARGO_TARGET_DIR'] ?? 'target');

/** The app as #1485 builds it: the shipped app's binary in a build with the `canvas-fixture` feature, in release. */
const APP_BUILD = ['build', '--locked', '--release', '-p', 'deep-app', '--bin', 'deep-app', '--features', 'canvas-fixture'];
/** The hub's canvas core, `deep-show canvas`, which the hub finds under the checkout's `target/` (packages/hub/src/canvas.ts). */
const SHOW_BUILD = ['build', '--locked', '--bin', 'deep-show'];

/**
 * Builds the app once before the file's tests (on macOS only) and copies the binary out of `target/`, so a sibling
 * file's build can't replace it mid-run. Returns a getter: the copied binary's path, or a failed test naming cargo's
 * error.
 */
export function useApp(): () => string {
  let dir = '';
  let error = 'not built here';
  beforeAll(() => {
    if (process.platform !== 'darwin') return;
    dir = mkdtempSync(join(tmpdir(), 'deep-2494-bin-'));
    error = cargo(APP_BUILD);
    if (error === '') copyFileSync(join(targetDir(), 'release', 'deep-app'), join(dir, 'deep-app'));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    expect(error, `it builds: cargo ${APP_BUILD.join(' ')}`).toBe('');
    return join(dir, 'deep-app');
  };
}

// ---------------------------------------------------------------------------------------------------
// The hub: `deep hub run` with HOME at a temporary home, so its root is <home>/.deepbuild and it never touches the
// real one; `deep show` run by you; and one call made as the app makes it.

/** This environment with HOME moved to the test's home and none of the hub's settings, plus `extra` (#26's). */
function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('TMUX') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env['PATH'] ?? '/usr/bin:/bin'}`, LC_ALL: 'C' });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

interface Ran { code: number | null; stdout: string; stderr: string }
function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}\n${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); if (child.pid) owned.delete(child.pid); resolve({ code, stdout, stderr }); });
  });
}

interface Hub { pid: number; home: string; socket: string; child: ChildProcess; output(): string }
const rootOf = (home: string): string => join(home, '.deepbuild');

/** `deep hub run` with the world file (#806's DEEP_HUB_TEST_SHOW); throws BLOCKED when it doesn't say ready. */
async function startHub(home: string, world: string): Promise<Hub> {
  const confirm = join(dirname(home), 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const env = childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_SHOW: world });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
  let out = '';
  child.stderr.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 120_000);
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) {
        clearTimeout(timer);
        try { resolve((JSON.parse(first.split('\n')[0]!) as JsonObject)['ready'] === true); } catch { resolve(false); }
      }
    });
    child.on('error', () => { clearTimeout(timer); resolve(false); });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready || !child.pid) throw Error(`BLOCKED: the hub didn't start: ${out.slice(0, 2000)}`);
  return { pid: child.pid, home, socket: join(rootOf(home), 'hub.sock'), child, output: () => out };
}

/** SIGTERM to the hub, by its PID, and waits for it to exit. */
async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { owned.delete(hub.pid); return; }
  const deadline = Date.now() + 15_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  while (alive(hub.pid)) await sleep(20);
  owned.delete(hub.pid);
}

/**
 * One method call on a connection that presented the control token as the app (`{v: 1, hello: "app", token}`), the
 * way crates/deep-app/src/hub.rs makes it: the call's result. Throws BLOCKED when the hub refuses the hello or the
 * call.
 */
function callAsApp(hub: Hub, method: string, params: JsonObject): Promise<JsonObject> {
  const token = readFileSync(join(rootOf(hub.home), 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = connect(hub.socket);
    const id = 't2494#1';
    let buffer = '';
    const end = (error: Error | undefined, value?: JsonObject): void => {
      clearTimeout(timer);
      sock.destroy();
      if (error) reject(error);
      else resolve(value ?? {});
    };
    const timer = setTimeout(() => end(Error(`BLOCKED: the hub gave no reply to ${method} as the app within 60 s`)), 60_000);
    sock.setEncoding('utf8');
    sock.on('error', (error) => end(Error(`BLOCKED: the hub's socket: ${error.message}`)));
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line: JsonObject;
        try { line = JSON.parse(buffer.slice(0, i)) as JsonObject; } catch { line = {}; }
        buffer = buffer.slice(i + 1);
        if (line['hello'] === 'deep-hub') sock.write(`${JSON.stringify({ v: 1, hello: 'app', token })}\n`);
        else if (line['role'] === 'app') sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
        else if (line['id'] === id && isObject(line['result'])) return end(undefined, line['result']);
        else if (line['id'] === id || 'error' in line) return end(Error(`BLOCKED: the hub refused ${method} as the app: ${short(line)}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------------------------------
// The fixture: a red box sliding across a blue sky for the whole of its 60 s span (README: Fixtures), shown on a
// panel of its own size, which is the app window's size too, so the panel's rect is the whole window.

/** The document, as a writer sends it to `deep show`: no `id`, no `layers`, no item `layer`. */
export const FIXTURE = join(HERE, 'fixtures', 'sliding-box.json');
/** The panel's rect and the app's window, in points. */
export const PANEL: Box = [0, 0, 480, 360];
/** A doc ID the hub minted (the world file names it with its panel): a ULID. */
export const DOC = `01JB2494D${'1'.padStart(17, '0')}`;

/** What the hub did with the document: `deep show`'s reply, and everything it presented to the app, in order. */
export interface Shown {
  /** The hub's home; its evidence store is the one the app's panel reads. */
  home: string;
  evidence: string;
  reply: JsonObject;
  drawn: JsonValue[];
}

async function showFixture(): Promise<Shown> {
  const built = cargo(SHOW_BUILD);
  if (built !== '') throw Error(`BLOCKED: the hub's canvas core didn't build: ${built}`);
  const real = (path: string): string => { try { return realpathSync(path); } catch { return path; } };
  if (real(targetDir()) !== real(join(REPO, 'target')) || !existsSync(join(REPO, 'target', 'debug', 'deep-show'))) {
    throw Error(`BLOCKED: the hub looks for its canvas core under ${join(REPO, 'target')} (packages/hub/src/canvas.ts) and cargo built it under ${targetDir()}; run without CARGO_TARGET_DIR`);
  }
  if (!existsSync(CLI)) throw Error(`BLOCKED: the built CLI isn't at ${CLI}; run npm run build --workspaces first`);
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home);
  const world = join(tmp, 'world.json');
  writeFileSync(world, `${JSON.stringify({ panels: { main: { rect: PANEL } }, docs: { [DOC]: { panel: 'main' } } })}\n`);
  const hub = await startHub(home, world);
  try {
    // `deep show`, run by you: a child of this test process, under no agent. A first call can meet a hub still
    // starting its canvas core, so one that printed no reply, or says it isn't ready, is made again.
    let reply: JsonObject | undefined;
    let said = '';
    for (let attempt = 0; attempt < 5 && (reply === undefined || /not ready/i.test(short(reply))); attempt++) {
      if (attempt > 0) await sleep(2000);
      const ran = await run(NODE, [CLI, 'show', '--doc', DOC, '--document', FIXTURE, '--json'], childEnv(home), 300_000);
      const last = ran.stdout.trim().split('\n').filter((l) => l.startsWith('{')).at(-1);
      said = `exit ${ran.code}; stdout: ${ran.stdout.slice(0, 400)}; stderr: ${ran.stderr.slice(0, 800)}`;
      try { reply = last === undefined ? undefined : (JSON.parse(last) as JsonObject); } catch { reply = undefined; }
    }
    if (reply === undefined) throw Error(`BLOCKED: deep show printed no JSON reply (${said}); the hub said: ${hub.output().slice(-800)}`);
    const taken = await callAsApp(hub, 'canvas.drawn', {});
    return { home, evidence: join(rootOf(home), 'evidence'), reply, drawn: Array.isArray(taken['presented']) ? taken['presented'] : [] };
  } finally {
    await stopHub(hub);
  }
}

/**
 * Shows the fixture's document through a hub once before the file's tests (on macOS only) and keeps what the hub
 * presented to the app. Returns a getter, which throws BLOCKED where the hub couldn't be run.
 */
export function useShown(): () => Shown {
  let shown: Shown | undefined;
  let error = 'the hub was not run here';
  beforeAll(async () => {
    if (process.platform !== 'darwin') return;
    try { shown = await showFixture(); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  }, 3_600_000);
  afterAll(cleanup, 120_000);
  return () => {
    if (!shown) throw Error(error.startsWith('BLOCKED') ? error : `BLOCKED: ${error}`);
    return shown;
  };
}

/**
 * The revision the hub presented to the app for the fixture's document, as it came; the rect of its panel, in
 * points; and its 3D writer layer's ID.
 */
export interface Presentation { presented: JsonObject; rev: number; rect: Box; layer: string }

/**
 * Reads what the hub presented: `deep show` said presented, `canvas.drawn` holds the document's revision with its
 * panel's rect, and one of its layers is the document's own. That layer is the 3D writer layer.
 */
export function presentation(shown: Shown): Presentation {
  const errors = (Array.isArray(shown.reply['issues']) ? shown.reply['issues'] : []).filter((i) => isObject(i) && i['severity'] === 'error');
  expect(shown.reply['outcome'], `deep show of the fixture's 3D document says presented; it answered ${short(shown.reply, 1500)}`).toBe('presented');
  expect(errors, 'the fixture\'s document has no error').toEqual([]);
  const ours = shown.drawn.filter((p): p is JsonObject => isObject(p) && String(p['doc']).toLowerCase() === DOC.toLowerCase());
  const presented = ours.at(-1);
  expect(presented, `the hub presents the document's revision to the app (canvas.drawn); it presented ${short(shown.drawn, 1500)}`).toBeDefined();
  const p = presented!;
  const rect = arr(p['rect'], 'the presented revision\'s rect').map((n, i) => num(n, `rect[${i}]`));
  expect(rect.length === 4 && rect[2]! > 0 && rect[3]! > 0, `the presented revision's rect is [x, y, w, h], got ${short(p['rect'])}`).toBe(true);
  const layers = arr(p['layers'], 'the presented revision\'s layers').map((l, i) => obj(l, `layers[${i}]`));
  const own = layers.filter((l) => String(l['doc']).toLowerCase() === DOC.toLowerCase());
  expect(own.length, `one presented layer is the document's own, its 3D writer layer; the layers are ${short(layers, 1500)}`).toBe(1);
  return {
    presented: p, rev: count(p['rev'], 'the presented revision\'s rev'), rect: [rect[0]!, rect[1]!, rect[2]!, rect[3]!],
    layer: str(own[0]!['layer'], 'the 3D writer layer\'s ID'),
  };
}

/** The app window that holds the panel whole, in points: the panel draws at its place from the window's corner, never shrunk. */
export const windowOf = (p: Presentation): [number, number] => [p.rect[0] + p.rect[2], p.rect[1] + p.rect[3]];

// ---------------------------------------------------------------------------------------------------
// `deep-app --canvas <scenario.json>` (README: The surface under test): #1485's fixture mode, with what this suite
// adds to the scenario and reads from the report.

/** A GPU-layer slot the panel painted in a frame. */
export interface Painted {
  /** The presented layer it painted for. */
  layer: string;
  /** The view frame the slot holds: `gpu_view::paint`'s. */
  frameSeq: number;
  /** The slot's handoff, `zero_copy` or `copy`. */
  path: string;
  /** On a captured frame: the PNG of the slot's own bytes. */
  pixels: string | null;
}
export interface Frame {
  frame: number;
  atMs: number;
  /** The pictures decoded from the evidence store that the panel painted (#1485's field). */
  pictures: string[];
  slots: Painted[];
  /** Read-back buffers the app's device has made since the app started, read at the frame's start; null when the report gives none. */
  readbackBuffers: number | null;
  /** On a captured frame: the PNG of the window as the compositor received it. */
  capture: string | null;
}
export interface Report { scale: number; frames: Frame[]; handed: Map<number, number>; raw: JsonObject }

function parseReport(line: string, what: string): Report {
  const raw = obj(JSON.parse(line) as JsonValue, `${what}: its report line`);
  const frames = arr(raw['frames'], `${what}: frames`).map((f, k) => {
    const x = obj(f, `${what}: frames[${k}]`);
    const at = `${what}: frames[${k}]`;
    expect(x['frame'], `${at}.frame`).toBe(k);
    const pictures = arr(x['pictures'], `${at}.pictures`).map((p, i) => str(p, `${at}.pictures[${i}]`));
    // A report with no `slots` painted none: the merge base's, whose panel has no GPU-layer view.
    const slots = x['slots'] === undefined ? [] : arr(x['slots'], `${at}.slots`).map((s, i) => {
      const y = obj(s, `${at}.slots[${i}]`);
      return {
        layer: str(y['layer'], `${at}.slots[${i}].layer`),
        frameSeq: count(y['frame_seq'], `${at}.slots[${i}].frame_seq`),
        path: str(y['path'], `${at}.slots[${i}].path`),
        pixels: y['pixels'] === undefined ? null : str(y['pixels'], `${at}.slots[${i}].pixels`),
      };
    });
    return {
      frame: k, atMs: num(x['at_ms'], `${at}.at_ms`), pictures, slots,
      readbackBuffers: x['readback_buffers'] === undefined ? null : count(x['readback_buffers'], `${at}.readback_buffers`),
      capture: x['capture'] === undefined ? null : str(x['capture'], `${at}.capture`),
    };
  });
  const handed = new Map<number, number>();
  for (const [i, h] of arr(raw['handed'], `${what}: handed`).entries()) {
    const x = obj(h, `${what}: handed[${i}]`);
    handed.set(count(x['rev'], `${what}: handed[${i}].rev`), count(x['frame'], `${what}: handed[${i}].frame`));
  }
  const scale = num(raw['scale'], `${what}: scale`);
  expect(scale, `${what}: scale is the window's display scale`).toBeGreaterThan(0);
  return { scale, frames, handed, raw };
}

type AppRun =
  | { kind: 'report'; line: string }
  | { kind: 'timeout'; stderr: string }
  | { kind: 'exit'; status: number | null; signal: string | null; stderr: string };

/** One run of the app's window over `scenario`, HOME at `home`: its report line, or how it ended without one. */
function runCanvas(bin: string, home: string, scenario: JsonObject, timeoutMs: number, planted?: string): AppRun {
  const file = join(home, `scenario-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(scenario));
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env['DEEP_CANVAS_PLANT'];
  if (planted) env['DEEP_CANVAS_PLANT'] = planted;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const r = spawnSync(bin, ['--canvas', file], { env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const stderr = (r.stderr ?? '').slice(-2000);
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') return { kind: 'timeout', stderr };
  if (r.error) throw Error(`BLOCKED: deep-app --canvas could not run: ${r.error.message}`);
  const line = (r.stdout ?? '').split('\n').reverse().find((l) => l.startsWith('{'));
  if (r.status !== 0 || line === undefined) return { kind: 'exit', status: r.status, signal: r.signal, stderr };
  return { kind: 'report', line };
}

/**
 * Whether the app's window draws frames on this machine: the fixture mode on a scenario with no revision, which is
 * the merge base's own path. Returns '' when it does, else why not (no display, a locked screen, a hidden window,
 * no Metal device).
 */
function windowDraws(bin: string): string {
  const home = mkdtempSync(join(tmpdir(), 'deep-2494-probe-'));
  try {
    mkdirSync(join(home, 'evidence'));
    const ran = runCanvas(bin, home, { evidence: join(home, 'evidence'), window: [PANEL[2], PANEL[3]], decode_ms: 0, run_ms: 300, revisions: [] }, 90_000);
    if (ran.kind === 'timeout') return `the app's window drew no frame in 90 s with nothing to show (no display, a locked screen or a hidden window): ${ran.stderr.slice(-300)}`;
    if (ran.kind === 'exit') return `the app couldn't open its window with nothing to show (exit ${ran.status}${ran.signal ? `, ${ran.signal}` : ''}): ${ran.stderr.slice(-300)}`;
    const frames = (JSON.parse(ran.line) as JsonObject)['frames'];
    return Array.isArray(frames) && frames.length > 0 ? '' : 'the app\'s window reported no frame with nothing to show';
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export interface CanvasOptions {
  runMs: number;
  /** Times, in ms from the first frame's start, at which a frame is captured; the report's files go under `out`. */
  capture?: { atMs: number[]; out: string };
  /** DEEP_CANVAS_PLANT: a planted wrong program (README: Planted programs). */
  planted?: string;
}

/**
 * The app's canvas panel in the app's real window, handed the hub's presentation as it came, right after the first
 * frame: the run's report. Where the window can't draw on this machine the test skips INCONCLUSIVE; a run that ends
 * without a report on a machine whose window draws fails.
 */
export function canvas(ctx: TestContext, bin: string, shown: Shown, p: Presentation, o: CanvasOptions): Report {
  const what = `deep-app --canvas${o.planted ? ` with DEEP_CANVAS_PLANT=${o.planted}` : ''}`;
  const unseen = windowDraws(bin);
  if (unseen !== '') ctx.skip(`INCONCLUSIVE: ${unseen}`);
  const scenario: JsonObject = {
    evidence: shown.evidence, window: windowOf(p), decode_ms: 0, run_ms: o.runMs,
    revisions: [{ at_ms: 0, presented: p.presented }],
    ...(o.capture ? { capture_ms: o.capture.atMs, out: o.capture.out } : {}),
  };
  const ran = runCanvas(bin, shown.home, scenario, o.runMs + 180_000, o.planted);
  if (ran.kind !== 'report') {
    // The window drew before this run; if it no longer does, the machine changed under the run.
    const now = windowDraws(bin);
    if (now !== '') ctx.skip(`INCONCLUSIVE: ${what} ended without a report and the window no longer draws: ${now}`);
    expect.fail(ran.kind === 'timeout'
      ? `${what} printed no report within ${Math.round((o.runMs + 180_000) / 1000)} s of a ${o.runMs} ms run, on a machine whose window draws: ${ran.stderr}`
      : `${what} exited ${ran.status}${ran.signal ? ` (${ran.signal})` : ''} without a report: ${ran.stderr}`);
  }
  const report = parseReport(ran.line, what);
  if (report.frames.length === 0) ctx.skip(`INCONCLUSIVE: ${what} reported no frame`);
  expect(report.handed.has(p.rev), `${what}: revision ${p.rev} was handed to the panel; handed: ${short(report.raw['handed'])}`).toBe(true);
  return report;
}

// ---------------------------------------------------------------------------------------------------
// PNG, read back (8-bit RGB or RGBA, no interlace; #674's reader).

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8;
  let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!;
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB or RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0;
      const b = previous[i]!;
      const c = i >= channels ? previous[i - channels]! : 0;
      const x = line[i]!;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw Error(`PNG filter ${filter}`);
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!;
      rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}

/** A PNG the report names, decoded; the test fails naming the file when it can't be read. */
export function readPng(path: string, what: string): { image: Image; bytes: Buffer } {
  expect(existsSync(path), `${what} is a file the app wrote: ${path}`).toBe(true);
  const bytes = readFileSync(path);
  try {
    return { image: decodePng(bytes), bytes };
  } catch (e) {
    return expect.fail(`${what} (${path}) is an 8-bit RGB or RGBA PNG, not interlaced: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------------------------------------------
// A slot's frame against the window's pixels.

/** The design's blank guard: a frame is blank or black when at least 98% of its pixels are at most luma 0.06. */
const BLANK_LUMA = 0.06;
const BLANK_COVERAGE = 0.98;

/** A frame that is blank or black can't be compared: BLOCKED, never PASS (Rec. 709 weights on the 8-bit values, #377's). */
export function expectNotBlank(image: Image, what: string): void {
  let dark = 0;
  const pixels = image.width * image.height;
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    if ((0.2126 * image.rgba[o]! + 0.7152 * image.rgba[o + 1]! + 0.0722 * image.rgba[o + 2]!) / 255 <= BLANK_LUMA) dark++;
  }
  const share = pixels === 0 ? 1 : dark / pixels;
  expect(share < BLANK_COVERAGE, `BLOCKED: ${what} is blank or black (${(share * 100).toFixed(2)}% of its ${image.width} × ${image.height} pixels at luma ≤ ${BLANK_LUMA}), so it can't be compared`).toBe(true);
}

/**
 * A sample is judged only where the slot's frame is flat: every pixel within RADIUS of it opaque and within FLAT
 * codes of it. A look's deband moves a pixel by at most 2 codes either way (`DEBAND_MAX_LSB`), so one flat color
 * stays within 4.
 */
const RADIUS = 3;
const FLAT = 4;
/** A flat sample's color in the window is within NEAR codes of the slot's: FLAT, and one code each for the composite and a resample. */
const NEAR = 6;
/** The samples: a grid over the frame, less a margin at each edge, where a layer's outline and name tab draw over it. */
const GRID: [number, number] = [48, 36];
const MARGIN = 0.08;

/** The color of `image` at the fraction (u, v) of its size when it is flat and opaque there, else null. */
export function flatAt(image: Image, u: number, v: number): Rgb | null {
  const x = Math.min(image.width - 1, Math.floor(u * image.width));
  const y = Math.min(image.height - 1, Math.floor(v * image.height));
  if (x - RADIUS < 0 || y - RADIUS < 0 || x + RADIUS >= image.width || y + RADIUS >= image.height) return null;
  const o = (y * image.width + x) * 4;
  const center: Rgb = [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
  for (let dy = -RADIUS; dy <= RADIUS; dy++) {
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      const p = ((y + dy) * image.width + x + dx) * 4;
      if (image.rgba[p + 3] !== 255) return null;
      for (let c = 0; c < 3; c++) if (Math.abs(image.rgba[p + c]! - center[c]!) > FLAT) return null;
    }
  }
  return center;
}

export interface Seen {
  /** Samples where the slot's frame is flat, and so judged. */
  judged: number;
  /** The judged samples the window shows in another color, as sentences. */
  off: string[];
}

/**
 * The slot's frame read on screen: at each grid sample where the slot's frame is flat, the window's pixel at the
 * same fraction of `rect` (the layer's panel, in the capture's px) against the slot's.
 */
export function onScreen(slot: Image, screen: Image, rect: Box): Seen {
  const seen: Seen = { judged: 0, off: [] };
  for (let gy = 0; gy < GRID[1]; gy++) {
    for (let gx = 0; gx < GRID[0]; gx++) {
      const u = (gx + 0.5) / GRID[0];
      const v = (gy + 0.5) / GRID[1];
      if (u < MARGIN || u > 1 - MARGIN || v < MARGIN || v > 1 - MARGIN) continue;
      const want = flatAt(slot, u, v);
      if (!want) continue;
      seen.judged++;
      const x = Math.min(screen.width - 1, Math.max(0, rect[0] + Math.floor(u * rect[2])));
      const y = Math.min(screen.height - 1, Math.max(0, rect[1] + Math.floor(v * rect[3])));
      const o = (y * screen.width + x) * 4;
      const got: Rgb = [screen.rgba[o]!, screen.rgba[o + 1]!, screen.rgba[o + 2]!];
      if (got.some((c, i) => Math.abs(c - want[i]!) > NEAR)) {
        seen.off.push(`at (${u.toFixed(3)}, ${v.toFixed(3)}) of the layer the slot holds ${JSON.stringify(want)} and the window shows ${JSON.stringify(got)} at px (${x}, ${y})`);
      }
    }
  }
  return seen;
}

/** A channel leads the other two by at least this many codes where the fixture's box or its sky shows. */
const LEADS = 40;

/**
 * What the fixture's frame must show whatever the time it plays at: its red box over the middle (the box is 8 m
 * wide and slides 3 m in all, so it always covers the frame's center) and its blue sky at the top left corner
 * (the box is 4 m of the frame's 9.4 m of height). Returns what is missing, as sentences.
 */
export function showsFixture(frame: Image): string[] {
  const missing: string[] = [];
  const middle = flatAt(frame, 0.5, 0.5);
  const corner = flatAt(frame, 0.1, 0.1);
  if (!middle || middle[0] - Math.max(middle[1], middle[2]) < LEADS) missing.push(`the red box at the frame's center: it reads ${JSON.stringify(middle)} (null: not one flat opaque color)`);
  if (!corner || corner[2] - Math.max(corner[0], corner[1]) < LEADS) missing.push(`the blue sky at the frame's top left: it reads ${JSON.stringify(corner)} (null: not one flat opaque color)`);
  return missing;
}

// ---------------------------------------------------------------------------------------------------
// The frames a view played, and the read-back buffers the app's device made while it played them.

export interface Played {
  /** The first frame of the window that painted a slot for the layer, or null when none did. */
  first: number | null;
  /** The frames the count is read over: from the frame after `first` to the report's last frame. */
  from: number;
  to: number;
  /** The view frames the window showed in them, each once. */
  seqs: number[];
  /** The handoff paths of the slots painted in them. */
  paths: string[];
}

/**
 * The 3D frames the panel played for `layer`. The count starts at the frame after the first that painted its slot:
 * by then the view is built, and what the device made to build it (a renderer holds one mappable buffer from its
 * start) is behind it.
 */
export function played(report: Report, layer: string): Played {
  const first = report.frames.find((f) => f.slots.some((s) => s.layer === layer))?.frame ?? null;
  const from = first === null ? report.frames.length : first + 1;
  const to = report.frames.length - 1;
  const slots = report.frames.slice(from).flatMap((f) => f.slots.filter((s) => s.layer === layer));
  return { first, from, to, seqs: [...new Set(slots.map((s) => s.frameSeq))], paths: [...new Set(slots.map((s) => s.path))] };
}

/** The read-back buffers the app's device made from frame `from`'s start to frame `to`'s start, by the report's count. */
export function readbacksMade(report: Report, p: Played): number {
  const reading = (k: number): number => {
    const value = report.frames[k]?.readbackBuffers;
    expect(typeof value === 'number', `frames[${k}].readback_buffers, the count of read-back buffers the app's device has made (README: The surface under test), is in the report`).toBe(true);
    return value as number;
  };
  const made = reading(p.to) - reading(p.from);
  expect(made, `the count never falls: frames[${p.from}].readback_buffers is ${reading(p.from)} and frames[${p.to}].readback_buffers is ${reading(p.to)}`).toBeGreaterThanOrEqual(0);
  return made;
}

/** The criterion's check: no read-back buffer made while the frames played, on the zero-copy handoff. Failures name the count. */
export function readbackFailures(report: Report, p: Played): string[] {
  const failures: string[] = [];
  const made = readbacksMade(report, p);
  if (made !== 0) {
    failures.push(`the app's device made ${made} read-back buffers while ${p.seqs.length} 3D frames played (window frames ${p.from} to ${p.to}: readback_buffers ${report.frames[p.from]!.readbackBuffers} to ${report.frames[p.to]!.readbackBuffers})`);
  }
  for (const path of p.paths.filter((path) => path !== 'zero_copy')) {
    failures.push(`the slot was handed off on the ${path} path, which reads each frame back through memory (GPU surface: path)`);
  }
  return failures;
}
