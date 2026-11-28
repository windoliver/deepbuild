import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Box = [number, number, number, number];
export type Size = [number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
const NODE = process.execPath;
const CLI = join(REPO, 'packages', 'cli', 'dist', 'main.js');

export const AC1 = 'AC1 #3517.6be4cfad';
export const AC2 = 'AC2 #3517.1021b920';
export const AC3 = 'AC3 #3517.234b03aa';
export const AC4 = 'AC4 #3517.a6d46379';
export const AC5 = 'AC5 #3517.5a0bce0e';
export const AC6 = 'AC6 #3517.1933faf6';
export const AC7 = 'AC7 #3517.514071e2';

const FLICKS_A_SECOND = 705_600_000;
export const flicks = (seconds: number): number => Math.round(seconds * FLICKS_A_SECOND);
export const seconds = (t: number): string => `${(t / FLICKS_A_SECOND).toFixed(3)} s`;
export const docId = (n: number): string => `01JB3517D${String(n).padStart(17, '0')}`;

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const quietly = (step: () => void): void => { try { step(); } catch { return; } };
const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

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
export function count(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isInteger(value) && value >= 0, `${what} is a whole number at or above 0, got ${short(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value === 'string' && value !== '', `${what} is text, got ${short(value)}`).toBe(true);
  return value as string;
}

export const blocked = (why: string): Error => Error(`BLOCKED: ${why}`);

const NOT_MACOS = `BLOCKED: the app's window and its GPU-layer views draw on macOS's Metal device; this is ${process.platform}, with no GPU to draw on`;
export function onMacos(ctx: TestContext): void {
  if (process.platform !== 'darwin') ctx.skip(NOT_MACOS);
}

interface Machine { model: string | null; chip: string | null; memoryBytes: number | null }
let machineJudged: Promise<string> | undefined;
async function whyFramesAreNotJudgedHere(): Promise<string> {
  if (process.platform !== 'darwin') return NOT_MACOS;
  const bench = (await import(pathToFileURL(join(REPO, 'scripts', 'benchmark.mjs')).href)) as { fingerprint(): Machine; references: (Machine & { name: string })[] };
  const here = bench.fingerprint();
  const known = bench.references.some((r) => r.model === here.model && r.chip === here.chip && r.memoryBytes === here.memoryBytes);
  return known ? '' : `INCONCLUSIVE: a frame is judged on a Mac of a reference model (${bench.references.map((r) => r.name).join(' or ')}); this is ${here.model ?? 'an unknown model'} (${here.chip ?? 'unknown chip'}), where it is a reading`;
}
export async function onAReferenceMac(ctx: TestContext): Promise<void> {
  const why = await (machineJudged ??= whyFramesAreNotJudgedHere());
  if (why !== '') ctx.skip(why);
}

const PROOF_DIR = join(tmpdir(), 'deep-3517-proof');
export function proof(name: string, value: JsonValue | Buffer): string {
  mkdirSync(PROOF_DIR, { recursive: true });
  const file = join(PROOF_DIR, name);
  writeFileSync(file, Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 1)}\n`);
  return file;
}
export const said = (line: string): void => console.log(`PROOF #3517 ${line}`);

const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh3517-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
async function stopOwnedAndRemoveFolders(): Promise<void> {
  for (const pid of owned) quietly(() => process.kill(pid, 'SIGTERM'));
  const deadline = Date.now() + 15_000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) quietly(() => process.kill(pid, 'SIGKILL'));
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const GPU_LEASE = join(homedir(), '.cache', 'deepbuild-gpu', 'lease');
const GPU_LEASE_WAIT_MS = 600_000;
function gpuLeaseHolder(): number {
  try { return Number(readFileSync(GPU_LEASE, 'utf8').trim()); } catch { return NaN; }
}
function whyTheGpuLeaseIsNotTaken(): string {
  try { mkdirSync(dirname(GPU_LEASE), { recursive: true }); } catch (error) { return `its folder can't be made: ${(error as Error).message}`; }
  for (let tries = 0; tries < 3; tries++) {
    try {
      const fd = openSync(GPU_LEASE, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return '';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return `the file can't be made: ${(error as Error).message}`;
      const by = gpuLeaseHolder();
      if (by === process.pid) return '';
      if (Number.isInteger(by) && by > 0 && alive(by)) return `process ${by} holds it`;
      quietly(() => unlinkSync(GPU_LEASE));
    }
  }
  return 'it could not be taken';
}
export async function underTheGpuLease<T>(ctx: TestContext, draws: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + GPU_LEASE_WAIT_MS;
  let why = whyTheGpuLeaseIsNotTaken();
  while (why !== '' && Date.now() < deadline) {
    await sleep(2000);
    why = whyTheGpuLeaseIsNotTaken();
  }
  if (why !== '') ctx.skip(`BLOCKED: a frame is drawn under the machine's GPU lease (~/.cache/deepbuild-gpu/lease), and after ${GPU_LEASE_WAIT_MS / 60_000} minutes ${why}; nothing was drawn`);
  try {
    return await draws();
  } finally {
    if (gpuLeaseHolder() === process.pid) quietly(() => unlinkSync(GPU_LEASE));
  }
}

export const buildEnv = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
});
function cargo(args: string[]): string {
  const r = spawnSync('cargo', args, { cwd: REPO, env: buildEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status === 0) return '';
  const told = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading|Finished/.test(l)).join('\n');
  return `cargo ${args.join(' ')} failed:\n${told.slice(0, 4000)}`;
}
const targetDir = (): string => resolve(REPO, process.env['CARGO_TARGET_DIR'] ?? 'target');
const APP_BUILD = ['build', '--locked', '--release', '-p', 'deep-app', '--bin', 'deep-app', '--features', 'canvas-fixture'];
const HUB_BUILDS = [['build', '--locked', '--bin', 'deep-show'], ['build', '--locked', '-p', 'deep-hook', '--bin', 'deep-hook']];
const HUB_PARTS = ['deep-show', 'deep-hook'];

export function useApp(): () => string {
  let dir = '';
  let error = 'not built here';
  beforeAll(() => {
    if (process.platform !== 'darwin') return;
    dir = mkdtempSync(join(tmpdir(), 'deep-3517-bin-'));
    error = cargo(APP_BUILD);
    if (error === '') copyFileSync(join(targetDir(), 'release', 'deep-app'), join(dir, 'deep-app'));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    expect(error, `it builds: cargo ${APP_BUILD.join(' ')}`).toBe('');
    return join(dir, 'deep-app');
  };
}

export function cleanUpAfterTheFile(): void {
  afterAll(stopOwnedAndRemoveFolders, 120_000);
}

function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('TMUX') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key.startsWith('GIT_') || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env['PATH'] ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}

function appEnv(home: string, planted: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('DEEP_') && !key.startsWith('GIT_')) env[key] = value;
  return { ...env, HOME: home, ...(planted ? { DEEP_CANVAS_PLANT: planted } : {}) };
}

interface Ran { code: number | null; stdout: string; stderr: string; timedOut: boolean }
function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Ran> {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr = (stderr + d).slice(-4000)));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); done({ code: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); if (child.pid) owned.delete(child.pid); done({ code, stdout, stderr, timedOut }); });
  });
}

export interface Hub { pid: number; home: string; socket: string; evidence: string; output(): string }
export interface Placed { doc: string; panel: string; rect: Box }

let hubsPartsBuilt: string | undefined;
function requireTheHubsParts(): void {
  hubsPartsBuilt ??= HUB_BUILDS.map(cargo).find((error) => error !== '') ?? '';
  if (hubsPartsBuilt !== '') throw blocked(`what the hub runs didn't build: ${hubsPartsBuilt}`);
  const real = (path: string): string => { try { return realpathSync(path); } catch { return path; } };
  const missing = HUB_PARTS.filter((part) => !existsSync(join(REPO, 'target', 'debug', part)));
  if (real(targetDir()) !== real(join(REPO, 'target')) || missing.length > 0) {
    throw blocked(`the hub looks for ${HUB_PARTS.join(' and ')} under ${join(REPO, 'target')} (packages/hub/src/canvas.ts, paths.ts) and cargo built under ${targetDir()}, where ${missing.join(' and ') || 'neither'} is missing there; run without CARGO_TARGET_DIR`);
  }
  if (!existsSync(CLI)) throw blocked(`the built CLI isn't at ${CLI}; run npm run build --workspaces first`);
}

export async function hubShowing(placed: readonly Placed[], kept: readonly Buffer[] = []): Promise<Hub> {
  requireTheHubsParts();
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home);
  const world = join(tmp, 'world.json');
  const panels = Object.fromEntries(placed.map((p) => [p.panel, { rect: p.rect }]));
  const docs = Object.fromEntries(placed.map((p) => [p.doc, { panel: p.panel }]));
  writeFileSync(world, `${JSON.stringify({ panels, docs })}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const env = childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_SHOW: world });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
  let out = '';
  child.stderr.setEncoding('utf8').on('data', (d: string) => (out = (out + d).slice(-8000)));
  const ready = await new Promise<boolean>((done) => {
    let first = '';
    const timer = setTimeout(() => done(false), 120_000);
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      out = (out + d).slice(-8000);
      if (first.includes('\n')) return;
      first += d;
      if (!first.includes('\n')) return;
      clearTimeout(timer);
      try { done((JSON.parse(first.split('\n')[0]!) as JsonObject)['ready'] === true); } catch { done(false); }
    });
    child.on('error', () => { clearTimeout(timer); done(false); });
    child.on('exit', () => { clearTimeout(timer); done(false); });
  });
  if (!ready || !child.pid) throw blocked(`the hub didn't start: ${out.slice(0, 2000)}`);
  const root = join(home, '.deepbuild');
  const evidence = join(root, 'evidence');
  for (const bytes of kept) {
    const name = sha256(bytes);
    mkdirSync(join(evidence, name.slice(0, 2)), { recursive: true });
    writeFileSync(join(evidence, name.slice(0, 2), name.slice(2)), bytes);
  }
  return { pid: child.pid, home, socket: join(root, 'hub.sock'), evidence, output: () => out };
}

export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { owned.delete(hub.pid); return; }
  const deadline = Date.now() + 15_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) quietly(() => process.kill(hub.pid, 'SIGKILL'));
  while (alive(hub.pid)) await sleep(20);
  owned.delete(hub.pid);
}

let calls = 0;
export function asTheApp(hub: Hub, method: string, params: JsonObject): Promise<JsonObject> {
  const token = readFileSync(join(hub.home, '.deepbuild', 'control.token'), 'utf8').trim();
  return new Promise((done, fail) => {
    const sock = connect(hub.socket);
    const id = `t3517#${++calls}`;
    let buffer = '';
    const end = (error: Error | undefined, value?: JsonObject): void => {
      clearTimeout(timer);
      sock.destroy();
      if (error) fail(error);
      else done(value ?? {});
    };
    const timer = setTimeout(() => end(blocked(`the hub gave no reply to ${method} as the app within 300 s`)), 300_000);
    sock.setEncoding('utf8');
    sock.on('error', (error) => end(blocked(`the hub's socket: ${error.message}`)));
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line: JsonObject;
        try { line = JSON.parse(buffer.slice(0, i)) as JsonObject; } catch { line = {}; }
        buffer = buffer.slice(i + 1);
        if (line['hello'] === 'deep-hub') sock.write(`${JSON.stringify({ v: 1, hello: 'app', token })}\n`);
        else if (line['role'] === 'app') sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
        else if (line['id'] === id && isObject(line['result'])) return end(undefined, line['result']);
        else if (line['id'] === id || 'error' in line) return end(blocked(`the hub refused ${method} as the app: ${short(line)}`));
      }
    });
  });
}

export const asYouOnTheCanvas = (hub: Hub, call: JsonObject): Promise<JsonObject> => asTheApp(hub, 'canvas.user', { call });
export const input = (hub: Hub, panel: string, event: JsonObject): Promise<JsonObject> => asYouOnTheCanvas(hub, { call: 'input', panel, event });
export const playheadAt = (hub: Hub, panel: string, t: number): Promise<JsonObject> => input(hub, panel, { type: 'control', control: 'playhead', value: t });

export interface RecordedEvent { kind: string; subject: string | null; data: JsonObject }
export async function recordedEvents(hub: Hub): Promise<RecordedEvent[]> {
  const all: RecordedEvent[] = [];
  for (let after = 0; ;) {
    const page = arr((await asTheApp(hub, 'events.read', { after, limit: 1000 }))['events'], 'events.read: events').map((e, i) => obj(e, `events.read: events[${i}]`));
    if (page.length === 0) return all;
    for (const e of page) all.push({ kind: String(e['kind']), subject: typeof e['subject'] === 'string' ? e['subject'] : null, data: isObject(e['data']) ? e['data'] : {} });
    after = num(page.at(-1)!['log_pos'], 'events.read: the last event\'s log_pos');
  }
}

export async function recordedEventsOnce(hub: Hub, kind: string, withinMs: number): Promise<RecordedEvent[]> {
  const deadline = Date.now() + withinMs;
  let all = await recordedEvents(hub);
  while (!all.some((e) => e.kind === kind) && Date.now() < deadline) {
    await sleep(250);
    all = await recordedEvents(hub);
  }
  return all;
}

export interface Shot { t?: string; size?: Size }
export async function deepShow(hub: Hub, doc: string, file: string, shot: Shot = {}): Promise<JsonObject> {
  const args = [
    CLI, 'show', '--doc', doc, '--document', file,
    ...(shot.t ? ['--t', shot.t] : []), ...(shot.size ? ['--size', `${shot.size[0]}x${shot.size[1]}`, '--snap'] : []), '--json',
  ];
  let reply: JsonObject | undefined;
  let told = '';
  for (let attempt = 0; attempt < 5 && (reply === undefined || /not ready/i.test(short(reply))); attempt++) {
    if (attempt > 0) await sleep(2000);
    const ran = await run(NODE, args, childEnv(hub.home), 900_000);
    const last = ran.stdout.trim().split('\n').filter((l) => l.startsWith('{')).at(-1);
    told = `exit ${ran.code}; stdout: ${ran.stdout.slice(0, 400)}; stderr: ${ran.stderr.slice(0, 800)}`;
    try { reply = last === undefined ? undefined : (JSON.parse(last) as JsonObject); } catch { reply = undefined; }
  }
  if (reply === undefined) throw blocked(`deep show printed no JSON reply (${told}); the hub said: ${hub.output().slice(-800)}`);
  const errors = (Array.isArray(reply['issues']) ? reply['issues'] : []).filter((i) => isObject(i) && i['severity'] === 'error');
  expect(reply['outcome'], `deep show of ${file} says presented; it answered ${short(reply, 1500)}`).toBe('presented');
  expect(errors, `deep show of ${file} names no error`).toEqual([]);
  return reply;
}

export interface Presentation { doc: string; presented: JsonObject; rev: number; rect: Box; layer: string }
export async function presentationOf(hub: Hub, doc: string): Promise<Presentation> {
  const drawn = (await asTheApp(hub, 'canvas.drawn', {}))['presented'];
  const ours = (Array.isArray(drawn) ? drawn : []).filter((p): p is JsonObject => isObject(p) && String(p['doc']).toLowerCase() === doc.toLowerCase());
  const presented = ours.at(-1);
  expect(presented, `the hub presents the document's revision to the app (canvas.drawn); it presented ${short(drawn, 1500)}`).toBeDefined();
  const p = presented!;
  const rect = arr(p['rect'], 'the presented revision\'s rect').map((n, i) => num(n, `rect[${i}]`));
  expect(rect.length, `the presented revision's rect is [x, y, w, h], got ${short(p['rect'])}`).toBe(4);
  const layers = arr(p['layers'], 'the presented revision\'s layers').map((l, i) => obj(l, `layers[${i}]`));
  const own = layers.filter((l) => String(l['doc']).toLowerCase() === doc.toLowerCase());
  expect(own.length, `one presented layer is the document's own, its 3D writer layer; the layers are ${short(layers, 1500)}`).toBe(1);
  return { doc, presented: p, rev: count(p['rev'], 'the presented revision\'s rev'), rect: [rect[0]!, rect[1]!, rect[2]!, rect[3]!], layer: str(own[0]!['layer'], 'the 3D writer layer\'s ID') };
}

export interface Image { width: number; height: number; rgba: Uint8Array }
export interface Picture { image: Image; bytes: Buffer; pixelHash: string }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function decodePng(file: Buffer): Image {
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

export function pixelHash(image: Image): string {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(image.width, 0);
  head.writeUInt32BE(image.height, 4);
  return createHash('sha256').update(head).update(image.rgba).digest('hex');
}

export function picture(path: string, what: string): Picture {
  expect(existsSync(path), `${what} is a file: ${path}`).toBe(true);
  const bytes = readFileSync(path);
  try {
    const image = decodePng(bytes);
    return { image, bytes, pixelHash: pixelHash(image) };
  } catch (e) {
    return expect.fail(`${what} (${path}) is an 8-bit RGB or RGBA PNG, not interlaced: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function renderBackOf(hub: Hub, reply: JsonObject, size: Size, what: string): Picture {
  const first = arr(reply['snapshots'], `${what}: the reply's snapshots`)[0];
  const name = str(obj(first, `${what}: the reply's first snapshot`)['sha256'], `${what}: the snapshot's sha256`);
  const drawn = picture(join(hub.evidence, name.slice(0, 2), name.slice(2)), `${what}: render-back's snapshot`);
  expect(sha256(drawn.bytes), `${what}: the evidence store holds the snapshot under its hash`).toBe(name);
  expect([drawn.image.width, drawn.image.height], `${what}: render-back drew at the size asked`).toEqual(size);
  expectNotBlank(drawn.image, `${what}: render-back's snapshot`);
  return drawn;
}

const BLANK_LUMA = 0.06;
const BLANK_COVERAGE = 0.98;
export const luma = (image: Image, pixel: number): number => 0.2126 * image.rgba[pixel * 4]! + 0.7152 * image.rgba[pixel * 4 + 1]! + 0.0722 * image.rgba[pixel * 4 + 2]!;
export function expectNotBlank(image: Image, what: string): void {
  const pixels = image.width * image.height;
  let dark = 0;
  for (let i = 0; i < pixels; i++) if (luma(image, i) / 255 <= BLANK_LUMA) dark++;
  const share = pixels === 0 ? 1 : dark / pixels;
  expect(share < BLANK_COVERAGE, `BLOCKED: ${what} is blank or black (${(share * 100).toFixed(2)}% of its ${image.width} × ${image.height} pixels at luma ≤ ${BLANK_LUMA}), so it can't be compared`).toBe(true);
}

export function howTheyDiffer(a: Image, b: Image): string {
  if (a.width !== b.width || a.height !== b.height) return `the sizes differ, ${a.width} × ${a.height} px against ${b.width} × ${b.height}`;
  let off = 0;
  let worst = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    const d = Math.max(Math.abs(a.rgba[i]! - b.rgba[i]!), Math.abs(a.rgba[i + 1]! - b.rgba[i + 1]!), Math.abs(a.rgba[i + 2]! - b.rgba[i + 2]!), Math.abs(a.rgba[i + 3]! - b.rgba[i + 3]!));
    if (d > 0) off++;
    worst = Math.max(worst, d);
  }
  return `${off} of ${a.width * a.height} pixels differ, by up to ${worst} codes`;
}

export interface Slot { layer: string; frameSeq: number; path: string; t: number | null; pixels: string | null }
export interface Reason { layer: string; reason: string }
export interface Frame { frame: number; atMs: number; slots: Slot[]; reasons: Reason[] | null; capture: string | null }
export interface Report { scale: number; frames: Frame[]; raw: JsonObject }

function parseReport(line: string, what: string): Report {
  const raw = obj(JSON.parse(line) as JsonValue, `${what}: its report line`);
  const frames = arr(raw['frames'], `${what}: frames`).map((f, k) => {
    const at = `${what}: frames[${k}]`;
    const x = obj(f, at);
    const slots = x['slots'] === undefined ? [] : arr(x['slots'], `${at}.slots`).map((s, i) => {
      const y = obj(s, `${at}.slots[${i}]`);
      return {
        layer: str(y['layer'], `${at}.slots[${i}].layer`),
        frameSeq: count(y['frame_seq'], `${at}.slots[${i}].frame_seq`),
        path: str(y['path'], `${at}.slots[${i}].path`),
        t: y['t'] === undefined ? null : count(y['t'], `${at}.slots[${i}].t`),
        pixels: y['pixels'] === undefined ? null : str(y['pixels'], `${at}.slots[${i}].pixels`),
      };
    });
    const reasons = x['reasons'] === undefined ? null : arr(x['reasons'], `${at}.reasons`).map((r, i) => {
      const y = obj(r, `${at}.reasons[${i}]`);
      return { layer: str(y['layer'], `${at}.reasons[${i}].layer`), reason: str(y['reason'], `${at}.reasons[${i}].reason`) };
    });
    return { frame: k, atMs: num(x['at_ms'], `${at}.at_ms`), slots, reasons, capture: x['capture'] === undefined ? null : str(x['capture'], `${at}.capture`) };
  });
  const scale = num(raw['scale'], `${what}: scale`);
  expect(scale, `${what}: scale is the window's display scale`).toBeGreaterThan(0);
  return { scale, frames, raw };
}

type AppRun = { kind: 'report'; line: string } | { kind: 'ended'; how: string };
let scenarios = 0;
async function runTheApp(bin: string, home: string, scenario: JsonObject, timeoutMs: number, planted?: string): Promise<AppRun> {
  const file = join(home, `scenario-${++scenarios}.json`);
  writeFileSync(file, JSON.stringify(scenario));
  const ran = await run(bin, ['--canvas', file], appEnv(home, planted), timeoutMs);
  const line = ran.stdout.split('\n').reverse().find((l) => l.startsWith('{'));
  if (ran.code === 0 && line !== undefined) return { kind: 'report', line };
  return { kind: 'ended', how: `${ran.timedOut ? `it printed no report within ${Math.round(timeoutMs / 1000)} s` : `it exited ${ran.code}`}: ${ran.stderr.slice(-1500)}` };
}

async function whyTheWindowDrawsNothing(bin: string): Promise<{ scale: number } | string> {
  const home = mkdtempSync(join(tmpdir(), 'deep-3517-probe-'));
  try {
    mkdirSync(join(home, 'evidence'));
    const ran = await runTheApp(bin, home, { evidence: join(home, 'evidence'), window: [480, 360], decode_ms: 0, run_ms: 300, revisions: [] }, 90_000);
    if (ran.kind === 'ended') return `the app's window drew no frame with nothing to show (no display, a locked screen, a hidden window or no Metal device): ${ran.how}`;
    const report = JSON.parse(ran.line) as JsonObject;
    const drew = Array.isArray(report['frames']) && report['frames'].length > 0 && typeof report['scale'] === 'number';
    return drew ? { scale: report['scale'] as number } : 'the app\'s window reported no frame with nothing to show';
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

let scaleRead: Promise<{ scale: number } | string> | undefined;
export async function screenScale(ctx: TestContext, bin: string): Promise<number> {
  const read = await (scaleRead ??= whyTheWindowDrawsNothing(bin));
  if (typeof read === 'string') ctx.skip(`BLOCKED: ${read}`);
  return (read as { scale: number }).scale;
}

export function slotSize(document: Size, rect: Box, scale: number): Size {
  const room: Size = [Math.max(1, Math.round(rect[2] * scale)), Math.max(1, Math.round(rect[3] * scale))];
  const fit = Math.min(room[0] / document[0], room[1] / document[1]);
  return [Math.min(room[0], Math.max(1, Math.round(document[0] * fit))), Math.min(room[1], Math.max(1, Math.round(document[1] * fit)))];
}

export interface Showing {
  hub: Hub;
  window: Size;
  runMs: number;
  revisions: readonly Presentation[];
  replies?: readonly { atMs: number; reply: JsonObject }[];
  captureMs?: readonly number[];
  follow?: boolean;
  planted?: string;
}

export async function appShowing(ctx: TestContext, bin: string, o: Showing): Promise<Report> {
  const what = `deep-app --canvas${o.planted ? ` with DEEP_CANVAS_PLANT=${o.planted}` : ''}`;
  const out = join(o.hub.home, `captures-${scenarios + 1}`);
  mkdirSync(out, { recursive: true });
  const scenario: JsonObject = {
    evidence: o.hub.evidence, window: o.window, decode_ms: 0, run_ms: o.runMs,
    revisions: o.revisions.map((p) => ({ at_ms: 0, presented: p.presented })),
    ...(o.replies ? { replies: o.replies.map((r) => ({ at_ms: r.atMs, reply: r.reply })) } : {}),
    ...(o.captureMs ? { capture_ms: [...o.captureMs], out } : {}),
    ...(o.follow ? { follow: true } : {}),
  };
  const ran = await runTheApp(bin, o.hub.home, scenario, o.runMs + 240_000, o.planted);
  if (ran.kind === 'ended') {
    const now = await whyTheWindowDrawsNothing(bin);
    if (typeof now === 'string') ctx.skip(`BLOCKED: ${what} ended without a report and the window no longer draws: ${now}`);
    expect.fail(`${what} ended without a report on a machine whose window draws: ${ran.how}`);
  }
  const report = parseReport(ran.line, what);
  if (report.frames.length === 0) ctx.skip(`BLOCKED: ${what} reported no frame`);
  return report;
}

export const framesPainting = (report: Report, layer: string): Frame[] => report.frames.filter((f) => f.slots.some((s) => s.layer === layer));
export const reasonsPainted = (report: Report, layer: string): string => {
  if (report.frames.every((f) => f.reasons === null)) return 'the report gives no reasons';
  const painted = [...new Set(report.frames.flatMap((f) => (f.reasons ?? []).filter((r) => r.layer === layer).map((r) => r.reason)))];
  return painted.length === 0 ? 'no reason' : painted.map((r) => `"${r}"`).join(', ');
};
export const capturedFrames = (report: Report): Frame[] => report.frames.filter((f) => f.capture !== null);

export interface OnScreen { frame: Frame; slot: Slot; shown: Picture }
export function slotOnScreen(frame: Frame | undefined, layer: string, what: string): OnScreen | string {
  if (frame === undefined) return `${what}: no frame was captured`;
  const slot = frame.slots.find((s) => s.layer === layer);
  if (slot === undefined) return `${what}: window frame ${frame.frame}, captured ${frame.atMs.toFixed(0)} ms into the run, painted no GPU-layer slot for layer "${layer}"; its slots: ${JSON.stringify(frame.slots)}`;
  if (slot.pixels === null) return `${what}: window frame ${frame.frame} gives no bytes of its slot (slots[].pixels)`;
  return { frame, slot, shown: picture(slot.pixels, `${what}: the slot's frame`) };
}

export interface Staged { reply: JsonObject; back: Picture; p: Presentation }
export async function shownWithItsRenderBack(hub: Hub, doc: string, file: string, shot: { t?: string; size: Size }, what: string): Promise<Staged> {
  const reply = await deepShow(hub, doc, file, shot);
  const back = renderBackOf(hub, reply, shot.size, what);
  const p = await presentationOf(hub, doc);
  expect(reply['rev'], `${what}: the revision render-back drew is the one the hub presented to the app`).toBe(p.rev);
  return { reply, back, p };
}
