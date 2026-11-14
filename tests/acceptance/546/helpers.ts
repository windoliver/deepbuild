// Test-side tools for the #546 acceptance tests (README: The surface under test), after #532's suite (copied and cut
// down; only #532's assembler crate is reused, built from a copy outside the checkout). They build and drive the
// logic module's runner `deep-logic` on this Mac and, through Docker, on Linux x86_64, and `deep-show run` for
// deep_kinds' step ceilings and the logic module's guide. Nothing here stands in for the logic module or deep_kinds:
// every ceiling, fuel, verdict, hash and frame read here is the implementation's own; the expected values come from
// the issue's text, the design's budget table and this suite's programs.

import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/546 is three levels down). */
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
const MIB = 1024 * 1024;

/** Every test passes this timeout: a first build, and criterion 2's Linux build under emulation, take many minutes. */
export const TIMEOUT = 5_400_000;
/** Builds before a file's tests (the slow part), so each test's own time is its own. */
export function prebuild(fn: () => void): void { beforeAll(() => { try { fn(); } catch { /* each test reports its own build failure */ } }, TIMEOUT); }

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = { 1: '#546.9988cce1', 2: '#546.73b1f110', 3: '#546.a29a5ebb', 4: '#546.21066ef8', 5: '#546.d7e6a2fc' } as const;

export const FLICKS = 705_600_000;
/** A step's length in flicks at `hz`. */
export const stepLength = (hz: number): number => FLICKS / hz;
/** One 60 Hz frame, in flicks. */
export const FRAME = FLICKS / 60;
/** The fuel budget's cap (Logic `logic@1`: budget.fuel at most 10,000,000). */
export const FUEL_CAP = 10_000_000;
/** The budget classes, the closed list (canvas primitives: Budget classes). */
export const CLASSES = ['core_view', 'data_view', 'figure', 'work_product', 'showpiece', 'export'] as const;
export type Class = (typeof CLASSES)[number];
/** Each class's frame CPU in ns, from the design's table; export has no frame cap (README: Readings). */
export const FRAME_CPU_NS: Record<Class, number | null> = {
  core_view: 2_000_000, data_view: 2_000_000, figure: 4_000_000, work_product: 4_000_000, showpiece: 4_000_000, export: null,
};
export const LIVE_CLASSES = CLASSES.filter((c) => FRAME_CPU_NS[c] !== null);
export const HOSTS = ['app', 'web'] as const;
export type Host = (typeof HOSTS)[number];
/** The step rates the criteria name. */
export const RATES = [30, 60, 120] as const;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const show = (v: JsonValue | undefined, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
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
export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
/** No problems; the message lists them. */
export function none(problems: readonly string[], what: string): void {
  expect(problems, `${what}:\n  ${problems.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one problem, and one naming each of `names`: what a planted twin must give. */
export function failsNaming(problems: readonly string[], names: readonly string[], what: string): void {
  expect(problems.length, `${what} fails this criterion, but the criterion's check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(problems.some((p) => p.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${problems.join('\n  ')}`).toBe(true);
  }
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

// ---------------------------------------------------------------------------------------------------
// Builds: deep-logic and deep-show from the checkout, and #532's assembler from a copy outside it.

function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|was not used|^help:|^\s{6}/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
/** The toolchain rust-toolchain.toml names. */
function channel(): string {
  const c = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1];
  if (!c) throw Error('rust-toolchain.toml names no channel');
  return c;
}

let binsDir = '';
let built: { logic: string; show: string; error: string } | undefined;
/** `cargo build --locked --bin deep-logic --bin deep-show` in the checkout (deep-show's default features), copied out, once per process. */
export function bins(): { logic: string; show: string } {
  if (!built) {
    if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-546-bins-'));
    const logic = join(binsDir, exe('deep-logic'));
    const showBin = join(binsDir, exe('deep-show'));
    const error = cargo(['build', '--locked', '--bin', 'deep-logic', '--bin', 'deep-show'], REPO, {});
    if (error === '') {
      copyFileSync(join(TARGET, 'debug', exe('deep-logic')), logic);
      copyFileSync(join(TARGET, 'debug', exe('deep-show')), showBin);
    }
    built = { logic, show: showBin, error };
  }
  expect(built.error, 'deep-logic and deep-show build on this host (cargo build --locked --bin deep-logic --bin deep-show)').toBe('');
  return built;
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built = undefined; });

// Programs: WebAssembly text assembled by #532's assembler (tests/acceptance/532/wat: the `wat` crate, validated by
// `wasmparser`). It is copied outside the checkout and built there, so the checkout's .cargo/config.toml patches don't
// reach its lockfile and nothing in the checkout changes; its versions stay the ones its lockfile pins.

export interface Program { name: string; bytes: Buffer; b64: string; sha: string }
const WAT_SOURCE = join(REPO, 'tests', 'acceptance', '532', 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-546-wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const copy = mkdtempSync(join(tmpdir(), 'deep-546-wat-src-'));
  try {
    for (const f of ['Cargo.toml', 'Cargo.lock', 'src']) cpSync(join(WAT_SOURCE, f), join(copy, f), { recursive: true });
    const error = cargo(['build'], copy, { CARGO_TARGET_DIR: WAT_TARGET, RUSTUP_TOOLCHAIN: channel() });
    if (error) blocked(`#532's assembler (tests/acceptance/532/wat) didn't build: ${error}`);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
  watBin = join(WAT_TARGET, 'debug', exe('acceptance-532-wat'));
  return watBin;
}
const assembled = new Map<string, Program>();
/** Assembles WebAssembly text into a Program. */
export function assemble(name: string, text: string): Program {
  const known = assembled.get(`${name}\n${text}`);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-546-wat-'));
  try {
    const file = join(dir, `${name}.wat`);
    writeFileSync(file, text);
    const run = spawnSync(assembler(), [dir, file], { encoding: 'utf8', maxBuffer: 64 * MIB });
    if (run.status !== 0) expect.fail(`the WebAssembly text ${name} doesn't assemble or validate: ${run.stderr.slice(-2000)}`);
    const bytes = readFileSync(join(dir, `${name}.wasm`));
    const p = { name, bytes, b64: bytes.toString('base64'), sha: sha256(bytes) };
    assembled.set(`${name}\n${text}`, p);
    return p;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// Processes: JSON lines in, one reply per line.

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
function replies(s: Started, count: number, what: string): JsonObject[] {
  expect(s.timedOut, `${what} finished within its timeout`).toBe(false);
  expect(s.status, `${what} exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${what}: one reply per call (stdout: ${s.stdout.slice(0, 600)})`).toBe(count);
  return s.lines.map((l, i) => obj(l, `${what}: reply ${i}`));
}

/** `deep-logic --planted <name>`: each one criterion's wrong program (README: Planted twins). */
export type LogicPlanted = 'budget_holds_steps_to_fuel_budget' | 'budget_web_passes_from_fuel' | 'pipeline_draws_before_step_ends';
/** `deep-show run --planted <name>` (README: Planted twins). */
export type ShowPlanted = 'step_ceilings_publish_fuel_cap' | 'guide_dice_rolls_from_step_seed';
const plantedArgs = (planted: readonly string[]): string[] => planted.flatMap((p) => ['--planted', p]);

/** Runs `calls` through one `deep-logic [--planted p]` process on this Mac. */
export function onMac(calls: JsonObject[], planted: LogicPlanted[] = []): JsonObject[] {
  const args = plantedArgs(planted);
  return replies(start(bins().logic, args, calls), calls.length, `deep-logic ${args.join(' ')} on ${process.platform}/${process.arch}`);
}

// Linux x86_64: the same checkout built for linux/amd64 in Docker with the rust image of the toolchain
// rust-toolchain.toml names, its caches under target/acceptance-546-linux/. Nothing is pulled: a missing image is BLOCKED.
const LINUX = join(TARGET, 'acceptance-546-linux');
const linuxImage = (): string => `rust:${channel()}-slim-bookworm`;
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
      '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${channel()}`,
      '-e', `CARGO_INCREMENTAL=${CARGO_ENV['CARGO_INCREMENTAL']}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${CARGO_ENV['CARGO_PROFILE_DEV_DEBUG']}`,
      image, 'cargo', 'build', '--locked', '--bin', 'deep-logic',
    ], undefined, TIMEOUT - 600_000);
    linuxBuilt = build.status === 0 ? '' : `cargo build --locked --bin deep-logic in ${image} (linux/amd64) failed${build.timedOut ? ' (timed out)' : ''}:\n${build.stderr.slice(-4000)}`;
  }
  expect(linuxBuilt, 'deep-logic builds for Linux x86_64').toBe('');
}
/** Runs `calls` through one `deep-logic` process in a linux/amd64 container. */
export function onLinux(calls: JsonObject[]): JsonObject[] {
  linuxLogic();
  const text = `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`;
  const r = docker(['run', '--rm', '-i', '--platform', 'linux/amd64', '-v', `${join(LINUX, 'target')}:/target:ro`, linuxImage(), '/target/debug/deep-logic'], text, 1_800_000);
  const s: Started = { status: r.status, signal: null, timedOut: r.timedOut, lines: parseLines(r.stdout), stdout: r.stdout, stderr: r.stderr };
  return replies(s, calls.length, 'deep-logic on linux/amd64');
}

/** A long-lived `deep-logic` process (criterion 5): one call, one awaited reply, so a test drives a view frame by frame. Stopped by its PID. */
export interface Live { call: (c: JsonObject) => Promise<JsonObject>; stop: () => void }
export function live(planted: LogicPlanted[] = []): Live {
  const child: ChildProcessWithoutNullStreams = spawn(bins().logic, plantedArgs(planted), { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
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
  if (child.pid === undefined) throw Error('deep-logic didn\'t start');
  const pid = child.pid;
  const exited = new Promise<string>((res) => child.once('exit', () => res(`{"ok":false,"code":"exited","stderr":${JSON.stringify(stderr.slice(-1500))}}`)));
  return {
    call: async (c) => {
      const got = new Promise<string>((res) => waiting.push(res));
      child.stdin.write(`${JSON.stringify(c)}\n`);
      const text = await Promise.race([got, exited]);
      let parsed: JsonValue;
      try { parsed = JSON.parse(text) as JsonValue; } catch { parsed = text; }
      return obj(parsed, `deep-logic's reply to ${show(c, 120)}`);
    },
    stop: () => { if (child.exitCode === null) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } } },
  };
}

// ---------------------------------------------------------------------------------------------------
// deep_kinds (README: deep_kinds), through `deep-show run [--planted <name>]` with a scenario of an evidence folder and calls.

export const kindsCall = (op: string, fields: JsonObject = {}): JsonObject => ({ call: 'deep_kinds', op, ...fields });
export function kinds(calls: JsonObject[], planted?: ShowPlanted): JsonObject[] {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-546-ev-'));
  try {
    const args = ['run', ...plantedArgs(planted ? [planted] : [])];
    const s = start(bins().show, args, [{ evidence, calls }]);
    const [out] = replies(s, 1, `deep-show ${args.join(' ')}`);
    expect(out!['ok'], `deep-show run took the scenario: ${show(out)}`).toBe(true);
    const list = arr(out!['replies'], 'deep-show run: replies').map((r, i) => obj(r, `deep-show run: replies[${i}]`));
    expect(list.length, 'deep-show run: one reply per call').toBe(calls.length);
    return list;
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}
/** A deep_kinds answer, never a refusal. */
export function answer(reply: JsonObject, what: string): JsonObject {
  expect(reply['error'], `${what} answers, not refuses: ${show(reply)}`).toBeUndefined();
  return reply;
}

/** deep_kinds' step ceilings: `{rate → {class → {app, web}}}` (README: step_ceilings). */
export type Table = Record<string, Record<string, Record<string, number>>>;
export function stepTable(planted?: ShowPlanted): Table {
  const [reply] = kinds([kindsCall('step_ceilings')], planted);
  const a = answer(reply!, 'deep_kinds step_ceilings');
  const table = obj(a['step_ceilings'], 'deep_kinds step_ceilings: step_ceilings');
  const out: Table = {};
  for (const [rate, classes] of Object.entries(table)) {
    out[rate] = {};
    for (const [cls, hosts] of Object.entries(obj(classes, `step_ceilings.${rate}`))) {
      out[rate]![cls] = Object.fromEntries(Object.entries(obj(hosts, `step_ceilings.${rate}.${cls}`)).map(([h, v]) => [h, int(v, `step_ceilings.${rate}.${cls}.${h}`)]));
    }
  }
  return out;
}
/** One ceiling the table gives, failing the test with a message when it lacks it. */
export function ceilingOf(t: Table, rate: number, cls: string, host: Host): number {
  const v = t[String(rate)]?.[cls]?.[host];
  if (v === undefined) expect.fail(`deep_kinds' step ceilings hold ${rate} Hz, ${cls}, ${host}: ${JSON.stringify(t).slice(0, 600)}`);
  return v;
}

/** The logic module's guide (README: The logic module's guide), read page by page through deep_kinds `read`. */
export function guideText(planted?: ShowPlanted): string {
  let text = '';
  let offset = 0;
  for (let page = 0; page < 64; page++) {
    const [reply] = kinds([kindsCall('read', { guide: 'logic', offset })], planted);
    const a = answer(reply!, `deep_kinds read of the guide logic at offset ${offset}`);
    text += str(a['text'], 'the guide page\'s text');
    if (a['truncated'] !== true) return text;
    offset = int(a['next'], 'the guide page\'s next');
  }
  return expect.fail('the logic guide runs past 64 pages');
}
/** The body of the guide's one fenced block whose info string is `<lang> <name>`. */
export function block(text: string, lang: 'wat' | 'json', name: string): string {
  const re = new RegExp(`^\`\`\`${lang} ${name}[ \\t]*\\n([\\s\\S]*?)^\`\`\`[ \\t]*$`, 'gm');
  const found = [...text.matchAll(re)];
  expect(found.length, `the logic guide holds exactly one fenced block \`\`\`${lang} ${name}`).toBe(1);
  return found[0]![1]!;
}
/** One of the guide's examples: its program assembled and its logic item's params (README: The guide's examples). */
export interface Example { name: string; program: Program; params: JsonObject }
export function example(text: string, name: string): Example {
  const program = assemble(name, block(text, 'wat', name));
  let params: JsonValue;
  try { params = JSON.parse(block(text, 'json', name)) as JsonValue; } catch (e) { return expect.fail(`the guide's json ${name} block is JSON: ${String(e)}`); }
  return { name, program, params: obj(params, `the guide's json ${name} block`) };
}
/** An example's step rate, from its params (60 Hz when it names none, as logic@1's default). */
export const rateOf = (params: JsonObject): number => (params['step_rate'] === undefined ? 60 : num(params['step_rate'], 'step_rate'));

// ---------------------------------------------------------------------------------------------------
// Pieces and deep-logic's calls (README: deep-logic).

export interface ItemSpec { program: Program; params: JsonObject; assets?: Buffer[] }
export interface PieceSpec { seed: number; class: string; items: Record<string, ItemSpec>; controls?: string[] }
/** A piece as `deep-logic` takes it: its seed and budget class, its controls, its logic items and the assets they name. */
export function piece(p: PieceSpec): JsonObject {
  const assets: JsonObject = {};
  const items: JsonObject = {};
  for (const [id, spec] of Object.entries(p.items)) {
    assets[spec.program.sha] = spec.program.b64;
    const params: JsonObject = { ...spec.params, program: spec.program.sha };
    if (spec.assets) params['assets'] = spec.assets.map((b) => { const s = sha256(b); assets[s] = b.toString('base64'); return s; });
    items[id] = { kind: 'logic@1', params };
  }
  return {
    seed: p.seed, class: p.class,
    ...(p.controls ? { controls: Object.fromEntries(p.controls.map((c) => [c, { kind: 'button' }])) } : {}),
    items, assets,
  };
}
export interface Entry { t: number; seq: number; control: string; value: number; writer: 'you'; player: number }
/** An entry of yours at step `k` of an item stepping at `hz` (its flick exactly on the step). */
export const entryAt = (control: string, k: number, hz: number, value = 1): Entry => ({ t: k * stepLength(hz), seq: 0, control, value, writer: 'you', player: 1 });

export const ABOUT: JsonObject = { call: 'about' };
export const checkCall = (p: JsonObject): JsonObject => ({ call: 'check', piece: p });
export interface BakeSpec { steps: number; track?: Entry[]; seeks?: { to: number }[] }
const bakeFields = (p: JsonObject, b: BakeSpec): JsonObject => ({
  piece: p, track: (b.track ?? []) as unknown as JsonValue, steps: b.steps, ...(b.seeks ? { seeks: b.seeks as unknown as JsonValue } : {}),
});
export const bakeCall = (p: JsonObject, b: BakeSpec): JsonObject => ({ call: 'bake', ...bakeFields(p, b) });
/** logic.budget (Check input: logic kinds); `fuel_share` 1 sets the share rule aside (README: Readings). */
export const budgetCall = (p: JsonObject, b: BakeSpec, on: Host[]): JsonObject => ({ call: 'budget', ...bakeFields(p, b), fuel_share: 1, on });

/** `about`'s ns per fuel unit (README: deep-logic). */
export function nsPerFuel(reply: JsonObject): Record<Host, number> {
  const o = obj(reply['ns_per_fuel'], 'about.ns_per_fuel');
  return { app: num(o['app'], 'about.ns_per_fuel.app'), web: num(o['web'], 'about.ns_per_fuel.web') };
}

export interface ItemStep { hash: string | null; fuel: number; failed: boolean }
export interface StepRecord { step: number; items: Record<string, ItemStep>; arrays: Record<string, JsonValue[]> }
export interface Checkpoint { step: number; deep_hash: string }
export interface SeekResult { to: number; from: number; hashes: Record<string, string[]>; checkpoint: { step: number; deep_hash: Record<string, string> } }
export interface Bake { steps: StepRecord[]; checkpoints: Record<string, Checkpoint[]>; traps: JsonObject[]; seeks: SeekResult[] }
export function bakeOf(reply: JsonObject, what: string): Bake {
  expect(reply['ok'], `${what} baked the piece (ok: true): ${show(reply, 800)}`).toBe(true);
  const steps = arr(reply['steps'], `${what}.steps`).map((s, i) => {
    const o = obj(s, `${what}.steps[${i}]`);
    const items = Object.fromEntries(Object.entries(obj(o['items'], `${what}.steps[${i}].items`)).map(([id, x]) => {
      const it = obj(x, `${what}.steps[${i}].items.${id}`);
      return [id, { hash: strOrNull(it['hash'], `${what}.steps[${i}].items.${id}.hash`), fuel: int(it['fuel'], `${what}.steps[${i}].items.${id}.fuel`), failed: it['failed'] === true }];
    }));
    const arrays = Object.fromEntries(Object.entries(obj(o['arrays'] ?? {}, `${what}.steps[${i}].arrays`)).map(([k, x]) => [k, arr(x, `${what}.steps[${i}].arrays.${k}`)]));
    return { step: int(o['step'], `${what}.steps[${i}].step`), items, arrays };
  });
  const checkpoints = Object.fromEntries(Object.entries(obj(reply['checkpoints'] ?? {}, `${what}.checkpoints`)).map(([id, list]) => [id, arr(list, `${what}.checkpoints.${id}`).map((c, i) => {
    const o = obj(c, `${what}.checkpoints.${id}[${i}]`);
    return { step: int(o['step'], `${what}.checkpoints.${id}[${i}].step`), deep_hash: str(o['deep_hash'], `${what}.checkpoints.${id}[${i}].deep_hash`) };
  })]));
  const seeks = arr(reply['seeks'] ?? [], `${what}.seeks`).map((s, i) => {
    const o = obj(s, `${what}.seeks[${i}]`);
    const c = obj(o['checkpoint'], `${what}.seeks[${i}].checkpoint`);
    const hashes = Object.fromEntries(Object.entries(obj(o['hashes'], `${what}.seeks[${i}].hashes`)).map(([id, l]) => [id, arr(l, `${what}.seeks[${i}].hashes.${id}`).map((h, j) => str(h, `${what}.seeks[${i}].hashes.${id}[${j}]`))]));
    const deep = Object.fromEntries(Object.entries(obj(c['deep_hash'], `${what}.seeks[${i}].checkpoint.deep_hash`)).map(([id, h]) => [id, str(h, `${what}.seeks[${i}].checkpoint.deep_hash.${id}`)]));
    return { to: int(o['to'], `${what}.seeks[${i}].to`), from: int(o['from'], `${what}.seeks[${i}].from`), hashes, checkpoint: { step: int(c['step'], `${what}.seeks[${i}].checkpoint.step`), deep_hash: deep } };
  });
  return { steps, checkpoints, traps: arr(reply['traps'] ?? [], `${what}.traps`).map((t, i) => obj(t, `${what}.traps[${i}]`)), seeks };
}
/** Each step's fuel for an item, by step. */
export const fuelOf = (b: Bake, id: string): Map<number, number> => new Map(b.steps.map((s) => [s.step, s.items[id]?.fuel ?? -1]));

/** A logic.budget failure (README: logic.budget). */
export interface BudgetFailure { rule: string; item: string | null; step: number | null; host: string | null; ceiling: number | null; raw: JsonObject }
export interface Budget {
  verdict: string; failures: BudgetFailure[]; blocked: { host: string | null; ask: string | null }[];
  items: Record<string, { ceiling: Record<string, number>; pipelined: boolean | null }>; raw: JsonObject;
}
export function budgetOf(reply: JsonObject, what: string): Budget {
  expect(reply['ok'], `${what} ran (ok: true): ${show(reply, 600)}`).toBe(true);
  expect(reply['kind'], `${what} is logic.budget`).toBe('logic.budget');
  const failures = arr(reply['failures'], `${what}.failures`).map((f, i) => {
    const o = obj(f, `${what}.failures[${i}]`);
    const w = `${what}.failures[${i}]`;
    return { rule: str(o['rule'], `${w}.rule`), item: strOrNull(o['item'], `${w}.item`), step: intOrNull(o['step'], `${w}.step`), host: strOrNull(o['host'], `${w}.host`), ceiling: intOrNull(o['ceiling'], `${w}.ceiling`), raw: o };
  });
  const blockedList = arr(reply['blocked'] ?? [], `${what}.blocked`).map((b, i) => {
    const o = obj(b, `${what}.blocked[${i}]`);
    return { host: strOrNull(o['host'], `${what}.blocked[${i}].host`), ask: strOrNull(o['ask'], `${what}.blocked[${i}].ask`) };
  });
  const report = isObject(reply['report']) ? reply['report'] : {};
  const items = Object.fromEntries(Object.entries(isObject(report['items']) ? report['items'] : {}).map(([id, v]) => {
    const o = isObject(v) ? v : {};
    const c = isObject(o['ceiling']) ? o['ceiling'] : {};
    return [id, { ceiling: Object.fromEntries(Object.entries(c).filter(([, x]) => typeof x === 'number').map(([h, x]) => [h, x as number])), pipelined: typeof o['pipelined'] === 'boolean' ? o['pipelined'] : null }];
  }));
  return { verdict: str(reply['verdict'], `${what}.verdict`), failures, blocked: blockedList, items, raw: reply };
}
/** A failure, in one line, for messages. */
export const line = (f: BudgetFailure): string => JSON.stringify(f.raw);

// ---------------------------------------------------------------------------------------------------
// Live views (README: view and frame).

export const viewCall = (p: JsonObject, span: number): JsonObject => ({ call: 'view', piece: p, track: [], span });
export const frameCall = (session: string, play: boolean): JsonObject => ({ call: 'frame', session, ...(play ? { play: true } : {}) });
export interface Frame {
  frame: number; t: number; eval_ns: number;
  ended: Record<string, { step: number; deep_hash: string }[]>;
  drawn: Record<string, { step: number; hash: string }>;
}
export function frameOf(reply: JsonObject, what: string): Frame {
  expect(reply['ok'], `${what} ran (ok: true): ${show(reply, 600)}`).toBe(true);
  const ended = Object.fromEntries(Object.entries(obj(reply['ended'], `${what}.ended`)).map(([id, l]) => [id, arr(l, `${what}.ended.${id}`).map((e, i) => {
    const o = obj(e, `${what}.ended.${id}[${i}]`);
    return { step: int(o['step'], `${what}.ended.${id}[${i}].step`), deep_hash: str(o['deep_hash'], `${what}.ended.${id}[${i}].deep_hash`) };
  })]));
  const drawn = Object.fromEntries(Object.entries(obj(reply['drawn'], `${what}.drawn`)).map(([name, d]) => {
    const o = obj(d, `${what}.drawn.${name}`);
    return [name, { step: int(o['step'], `${what}.drawn.${name}.step`), hash: str(o['hash'], `${what}.drawn.${name}.hash`) }];
  }));
  return { frame: int(reply['frame'], `${what}.frame`), t: int(reply['t'], `${what}.t`), eval_ns: num(reply['eval_ns'], `${what}.eval_ns`), ended, drawn };
}

/** The first 16 hex digits of the SHA-256 of an array's values as its write region lays them out (README: drawn). */
export function arrayHash(values: JsonValue[], type: 'bool' | 'i32' | 'f64' | 'vec2' | 'vec3' | 'quat'): string {
  const parts: Buffer[] = [];
  for (const v of values) {
    if (type === 'bool') { const b = Buffer.alloc(4); b.writeUInt32LE(v === true ? 1 : 0); parts.push(b); }
    else if (type === 'i32') { const b = Buffer.alloc(4); b.writeInt32LE(v as number); parts.push(b); }
    else {
      const comps = type === 'f64' ? [v as number] : (v as number[]);
      for (const c of comps) { const b = Buffer.alloc(8); b.writeDoubleLE(c); parts.push(b); }
    }
  }
  return sha256(Buffer.concat(parts)).slice(0, 16);
}
