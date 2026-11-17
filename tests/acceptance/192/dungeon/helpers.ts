// Test-side tools for the #192 dungeon acceptance tests (README: The surface), copied and cut down from #238's and
// #190's suites (nothing imported from them). They assemble this suite's programs with its own assembler (wat/), run
// a fixture in Node's own WebAssembly where a test needs the bytes the program itself computes, build and drive
// `deep-show run` and the sandbox module's runner `deep-sandbox` on this Mac and, through Docker, on Linux x86_64.
// Nothing here stands in for the sandbox module, the logic module, the pack check or the document check: every key,
// asset, array, refusal and byte a test judges is the implementation's own.

import { createHash } from 'node:crypto';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/192/dungeon is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
const MIB = 1024 * 1024;
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
/** Homebrew's rustup first on PATH when it's there, as the repo's other suites run cargo. */
const RUSTUP = '/opt/homebrew/opt/rustup/bin';
if (existsSync(RUSTUP) && !(process.env['PATH'] ?? '').split(':').includes(RUSTUP)) process.env['PATH'] = `${RUSTUP}:${process.env['PATH'] ?? ''}`;
/** Debug builds as the other deep-show suites make them, unless the caller set these. */
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
};
const targetOf = (env: NodeJS.ProcessEnv): string => (env['CARGO_TARGET_DIR'] ? resolve(REPO, env['CARGO_TARGET_DIR']) : join(REPO, 'target'));

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
/** Not the host a criterion names: the test fails, saying so first, and never passes. */
export const inconclusive = (why: string): never => { throw Error(`INCONCLUSIVE: ${why}`); };
/** Every test here runs on macOS (criterion 5 on macOS arm64): elsewhere it fails INCONCLUSIVE before anything runs. */
export function onMacOS(arm64 = false): void {
  if (process.platform !== 'darwin') inconclusive(`this suite runs on macOS; this host is ${process.platform}/${process.arch}`);
  if (arm64 && process.arch !== 'arm64') inconclusive(`criterion 5 compares macOS arm64 with Linux x86_64; this Mac is ${process.arch}`);
}

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const show = (v: JsonValue | undefined, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v)}`).toBe('string');
  return v as string;
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
export const DIGEST = /^[0-9a-f]{64}$/;
/** Whether some object anywhere in `v` holds `key` with exactly `want` (a naming field, README: Naming). */
export function holds(v: JsonValue | undefined, key: string, want: JsonValue): boolean {
  if (Array.isArray(v)) return v.some((x) => holds(x, key, want));
  if (!isObject(v)) return false;
  if (key in v && JSON.stringify(v[key]) === JSON.stringify(want)) return true;
  return Object.values(v).some((x) => holds(x, key, want));
}
/** The first byte where two outputs differ, or the shorter's length when one is the other's start; -1 when equal. */
export function firstDiff(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : Math.min(a.length, b.length);
}

// ---------------------------------------------------------------------------------------------------
// The assembler (wat/, #190's): WebAssembly text to a module, or with a mode to a relocatable object.

export interface Program { name: string; bytes: Buffer; b64: string; sha: string }
const programOf = (name: string, bytes: Buffer): Program => ({ name, bytes, b64: bytes.toString('base64'), sha: sha256(bytes) });
const WAT_DIR = join(HERE, 'wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const target = join(REPO, 'target', 'acceptance-192-dungeon-wat');
  const run = spawnSync('cargo', ['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], {
    cwd: WAT_DIR, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, CARGO_TARGET_DIR: target },
  });
  if (run.error) blocked(`cargo could not run (${run.error.message}); this suite's assembler is built with it`);
  if (run.status !== 0) blocked(`this suite's fixture assembler (tests/acceptance/192/dungeon/wat) didn't build: ${run.stderr.slice(-3000)}`);
  watBin = join(target, 'debug', exe('acceptance-192-dungeon-wat'));
  return watBin;
}
const assembled = new Map<string, Program>();
/** `text` assembled: a whole module, or a relocatable object (`library` or `program`, README: Relocatable objects). */
export function assemble(name: string, text: string, mode?: 'library' | 'program'): Program {
  const key = `${mode ?? 'module'}:${sha256(text)}`;
  const known = assembled.get(key);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-192-dungeon-wat-'));
  try {
    writeFileSync(join(dir, `${name}.wat`), text);
    const run = spawnSync(assembler(), [dir, ...(mode ? [`--${mode}`] : []), join(dir, `${name}.wat`)], { encoding: 'utf8', maxBuffer: 64 * MIB });
    if (run.status !== 0) throw Error(`the assembler refused this suite's ${name}.wat: ${run.stderr.slice(-2000)}`);
    const p = programOf(name, readFileSync(join(dir, `${name}.wasm`)));
    assembled.set(key, p);
    return p;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// A fixture run in Node's own WebAssembly (unmetered, unrewritten): what the program itself computes, which the
// implementation's run of the same program with the same seed and params must give byte for byte.

/** Params in the coordinated layout: each value 8 bytes, in the order of the names sorted by byte; integers as i64. */
export function intParams(values: Record<string, number>): Buffer {
  const names = Object.keys(values).sort((a, b) => (Buffer.compare(Buffer.from(a), Buffer.from(b))));
  const b = Buffer.alloc(8 * names.length);
  names.forEach((n, i) => b.writeBigInt64LE(BigInt(values[n]!), 8 * i));
  return b;
}
const exported = (inst: WebAssembly.Instance, name: string): number => (inst.exports[name] as WebAssembly.Global).value as number;
/** A provider (a whole module): params written at params_at, gen(seed) called once, the data asset read at out_at. */
export function providedInNode(p: Program, seed: bigint, params: Buffer): Buffer {
  const inst = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(p.bytes)), {});
  const mem = Buffer.from((inst.exports['memory'] as WebAssembly.Memory).buffer);
  params.copy(mem, exported(inst, 'params_at'));
  (inst.exports['gen'] as (s: bigint) => number)(seed);
  const out = exported(inst, 'out_at');
  return Buffer.from(mem.subarray(out + 4, out + 4 + mem.readUInt32LE(out)));
}
/** A library form (assembled as a module importing env.__linear_memory): gen(seed, 1024, 4096) until it returns 0. */
export function libraryInNode(p: Program, seed: bigint, params: Buffer): Buffer {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
  const inst = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(p.bytes)), { env: { __linear_memory: memory } });
  const mem = Buffer.from(memory.buffer);
  params.copy(mem, 1024);
  for (let calls = 1; (inst.exports['gen'] as (s: bigint, a: number, o: number) => number)(seed, 1024, 4096) !== 0; calls++) {
    if (calls > 64) throw Error(`${p.name} wasn't whole after 64 calls`);
  }
  return Buffer.from(mem.subarray(4100, 4100 + mem.readUInt32LE(4096)));
}

// ---------------------------------------------------------------------------------------------------
// Builds: deep-show (full with test.mesh) and deep-sandbox on this Mac, deep-sandbox for Linux x86_64 in Docker.

/** `cargo build --locked --bin <bin> [features]` in the checkout: '' or cargo's error. */
function cargoBuild(binName: string, features: string[] | null): string {
  const args = ['build', '--locked', '--bin', binName, ...(features ? ['--no-default-features', '--features', features.join(',')] : [])];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV } });
  if (run.error) blocked(`cargo could not run: ${run.error.message}`);
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
let binsDir = '';
const built = new Map<string, { bin: string; error: string }>();
/** A binary built once per process and copied out under its own name; the test fails with cargo's error. */
function binary(binName: string, features: string[] | null): string {
  const name = `${binName}${features ? `-${features.join('+')}` : ''}`;
  let made = built.get(name);
  if (!made) {
    if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-192-dungeon-bins-'));
    const to = join(binsDir, exe(name));
    const error = cargoBuild(binName, features);
    if (error === '') copyFileSync(join(targetOf({ ...process.env, ...CARGO_ENV }), 'debug', exe(binName)), to);
    made = { bin: to, error };
    built.set(name, made);
  }
  expect(made.error, `${binName} builds (cargo build --locked --bin ${binName}${features ? ` --no-default-features --features ${features.join(',')}` : ''})`).toBe('');
  return made.bin;
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built.clear(); });
/** deep-show of `full` with #238's test module test.mesh (feature test-mesh-item). */
export const deepShow = (): string => binary('deep-show', ['full', 'test-mesh-item']);

interface Ran { status: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string }
function ranOf(run: SpawnSyncReturns<string>): Ran {
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(run.error.message);
  return { status: run.status, signal: run.signal, timedOut, stdout: String(run.stdout ?? ''), stderr: String(run.stderr ?? '') };
}
/** JSON lines, one reply per call, from a process that exited 0. */
function lines(r: Ran, count: number, what: string): JsonObject[] {
  expect(r.timedOut, `${what} finished within its timeout`).toBe(false);
  expect(r.status, `${what} exits 0 (${r.signal ?? 'no signal'}); stdout: ${r.stdout.slice(0, 1500)}; stderr: ${r.stderr.slice(-1500)}`).toBe(0);
  const out = r.stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  expect(out.length, `${what}: one reply per line in (stdout: ${r.stdout.slice(0, 800)})`).toBe(count);
  return out.map((l, i) => obj(l, `${what}: reply ${i}`));
}

// deep-sandbox (#238's runner; README: deep-sandbox's `provide`).
export const deepSandbox = (): string => binary('deep-sandbox', null);
export function onMac(calls: JsonObject[]): JsonObject[] {
  const r = ranOf(spawnSync(deepSandbox(), [], { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 256 * MIB, timeout: 1_800_000, killSignal: 'SIGKILL' }));
  return lines(r, calls.length, `deep-sandbox on ${process.platform}/${process.arch}`);
}

// Linux x86_64: the same checkout built for linux/amd64 in Docker with the rust image of the toolchain
// rust-toolchain.toml names, its target and cargo caches kept under target/acceptance-192-dungeon-linux/ so later
// runs build warm. Nothing is pulled: a missing image is BLOCKED.
const LINUX = join(REPO, 'target', 'acceptance-192-dungeon-linux');
const channel = (): string => /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1] ?? blocked('rust-toolchain.toml names no channel');
export const linuxImage = (): string => `rust:${channel()}-slim-bookworm`;
function docker(args: string[], input: string | undefined, timeoutMs: number): Ran {
  return ranOf(spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 256 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) }));
}
let linuxBuilt: string | undefined;
/** deep-sandbox for linux/amd64, built once per process: BLOCKED without Docker or the image, failed when cargo fails. */
function linuxSandbox(): void {
  if (linuxBuilt === undefined) {
    let info: Ran;
    try { info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 60_000); } catch (e) { return blocked(`Docker can't run here (${(e as Error).message}); Linux x86_64 runs in a linux/amd64 container`); }
    if (info.status !== 0) blocked(`Docker is unreachable (docker info: ${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); Linux x86_64 runs in a linux/amd64 container`);
    const image = linuxImage();
    if (docker(['image', 'inspect', '--format', '{{.Architecture}}', image], undefined, 60_000).stdout.trim() !== 'amd64') {
      blocked(`Docker has no linux/amd64 image ${image} here and this suite pulls nothing; run: docker pull --platform linux/amd64 ${image}`);
    }
    for (const d of ['target', 'registry', 'git']) mkdirSync(join(LINUX, d), { recursive: true });
    const build = docker([
      'run', '--rm', '--pull', 'never', '--platform', 'linux/amd64',
      '-v', `${REPO}:/src:ro`, '-v', `${join(LINUX, 'target')}:/target`,
      '-v', `${join(LINUX, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(LINUX, 'git')}:/usr/local/cargo/git`,
      '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${channel()}`,
      '-e', `CARGO_INCREMENTAL=${CARGO_ENV['CARGO_INCREMENTAL']}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${CARGO_ENV['CARGO_PROFILE_DEV_DEBUG']}`,
      image, 'cargo', 'build', '--locked', '--bin', 'deep-sandbox',
    ], undefined, 7_200_000);
    linuxBuilt = build.status === 0 ? '' : `cargo build --locked --bin deep-sandbox in ${image} (linux/amd64) failed${build.timedOut ? ' (timed out)' : ''}:\n${build.stderr.slice(-4000)}`;
  }
  expect(linuxBuilt, 'deep-sandbox builds for Linux x86_64').toBe('');
}
/** Runs `calls` through one deep-sandbox process in a linux/amd64 container with no network. */
export function onLinux(calls: JsonObject[]): JsonObject[] {
  linuxSandbox();
  const r = docker(['run', '--rm', '-i', '--pull', 'never', '--platform', 'linux/amd64', '--network', 'none', '-v', `${join(LINUX, 'target')}:/target:ro`, linuxImage(), '/target/debug/deep-sandbox'],
    `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, 1_800_000);
  return lines(r, calls.length, 'deep-sandbox on linux/amd64');
}
export const ABOUT: JsonObject = { call: 'about' };
/** README: deep-sandbox's `provide`: one provider run as a check runs it, with its output's bytes. */
export const provideCall = (provider: JsonObject, params: JsonObject, seed: number): JsonObject => ({ call: 'provide', provider, params, seed });
/** A `provide` reply's bytes: `{ok: true, trap: null, bytes: base64}`. */
export function providedBytes(reply: JsonObject, what: string): Buffer {
  expect(reply['ok'], `${what}: provide ran the provider (ok: true): ${show(reply)}`).toBe(true);
  expect(reply['trap'] ?? null, `${what}: the provider didn't trap`).toBeNull();
  return Buffer.from(str(reply['bytes'], `${what}: bytes`), 'base64');
}

// ---------------------------------------------------------------------------------------------------
// deep-show run: one scenario on stdin, one answer `{ok, replies}` (#238's and #548's form).

export const SESSION = 'sess-alpha';
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB192D${String(n).padStart(18, '0')}`;
export function scenario(evidence: string, docs: string[], calls: JsonObject[]): JsonObject {
  return {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: dungeon', process: { pid: 4100, start: 1_000 } } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1280, 720] } },
    docs: Object.fromEntries(docs.map((d) => [d, { panel: 'main' }])),
    calls,
  };
}
/** `deep-show run`: exit 0, one answer line, ok, one reply per call. */
export function runShow(sc: JsonObject): JsonObject[] {
  const r = ranOf(spawnSync(deepShow(), ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: 3_600_000, killSignal: 'SIGKILL' }));
  const [out] = lines(r, 1, 'deep-show run');
  expect(out!['ok'], `deep-show run took the scenario: ${show(out)}`).toBe(true);
  const rs = arr(out!['replies'], 'run: replies').map((x, i) => obj(x, `run: replies[${i}]`));
  expect(rs.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the calls').length);
  return rs;
}
export const installPack = (p: PackDir): JsonObject => ({ call: 'install_pack', id: p.id, dir: p.dir });
/** The working agent's deep_show of a whole revision, with its issues. */
export const showDoc = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });
export const provided = (doc: string): JsonObject => ({ call: 'provided', doc });
export const SANDBOX_COUNTS: JsonObject = { call: 'sandbox' };
/** deep_query's logic read (#548): each item's bake as the hub plays the document, its arrays at each step asked. */
export const queryLogic = (doc: string, items: string[], steps: number[]): JsonObject => ({ call: 'deep_query', session: SESSION, doc, what: 'logic', items, steps, at: 0 });

export interface Issue { code: string; severity: string; path: string; ids: string[]; raw: JsonObject }
export function issuesOf(reply: JsonObject, what: string): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), path: String(o['path'] ?? ''), ids: Array.isArray(o['ids']) ? o['ids'].map(String) : [], raw: o };
  });
}
export const errorsOf = (reply: JsonObject, what: string): Issue[] => issuesOf(reply, what).filter((i) => i.severity === 'error');
/** A deep_show that presented its document with no error; the message lists the errors when it didn't. */
export function presented(reply: JsonObject, what: string): void {
  expect(errorsOf(reply, what).map((i) => show(i.raw, 600)), `${what} raises no error at check`).toEqual([]);
  expect(reply['outcome'], `${what} is presented: ${show(reply, 2000)}`).toBe('presented');
}
/** The `provided` row of `item` (#238's: `{item, provider, key, trap, out}`), or undefined. */
export function providedRow(reply: JsonObject, item: string, what: string): JsonObject | undefined {
  const rows = arr(reply['provided'], `${what}: provided`).map((r, i) => obj(r, `${what}: provided[${i}]`)).filter((r) => r['item'] === item);
  expect(rows.length, `${what}: at most one provided row for ${item}: ${show(reply)}`).toBeLessThanOrEqual(1);
  return rows[0];
}
/** The data asset a provided row holds: `out.data {layout, asset, size}`, after no trap. */
export function dataOf(row: JsonObject | undefined, what: string): { key: string; layout: string; asset: string; size: number } {
  const r = obj(row, `${what}: the provided row`);
  expect(r['trap'] ?? null, `${what}: the provider didn't trap: ${show(r)}`).toBeNull();
  const d = obj(obj(r['out'], `${what}: out`)['data'], `${what}: out.data`);
  return { key: str(r['key'], `${what}: key`), layout: str(d['layout'], `${what}: layout`), asset: str(d['asset'], `${what}: asset`), size: num(d['size'], `${what}: size`) };
}
/** The mesh a provided row holds: `out.mesh {positions, indices, bounds, …}`, after no trap. */
export function meshOf(row: JsonObject | undefined, what: string): { key: string; positions: number[][]; indices: number[]; bounds: number[][]; raw: JsonObject } {
  const r = obj(row, `${what}: the provided row`);
  expect(r['trap'] ?? null, `${what}: the provider didn't trap: ${show(r)}`).toBeNull();
  const m = obj(obj(r['out'], `${what}: out`)['mesh'], `${what}: out.mesh`);
  const triples = (v: JsonValue | undefined, w: string): number[][] => arr(v, w).map((p, i) => arr(p, `${w}[${i}]`).map((x, k) => num(x, `${w}[${i}][${k}]`)));
  return {
    key: str(r['key'], `${what}: key`), positions: triples(m['positions'], `${what}: positions`),
    indices: arr(m['indices'], `${what}: indices`).map((x, i) => num(x, `${what}: indices[${i}]`)), bounds: triples(m['bounds'], `${what}: bounds`), raw: m,
  };
}
/** deep_query's logic read of `item`: each asked step's arrays and fuel, and its trap. */
export function logicRead(reply: JsonObject, item: string, what: string): { steps: Map<number, { arrays: Record<string, number[]>; fuel: number | null }>; trap: JsonValue } {
  expect(reply['code'] ?? null, `${what}: deep_query answers, not refuses: ${show(reply, 2500)}`).toBeNull();
  const it = obj(obj(reply['logic'], `${what}: logic`)[item], `${what}: logic.${item}`);
  const steps = new Map<number, { arrays: Record<string, number[]>; fuel: number | null }>();
  for (const [i, s] of arr(it['steps'], `${what}: steps`).entries()) {
    const o = obj(s, `${what}: steps[${i}]`);
    const arrays = Object.fromEntries(Object.entries(obj(o['arrays'], `${what}: steps[${i}].arrays`)).map(([k, v]) => [k, arr(v, `${what}: ${k}`).map((x, j) => num(x, `${what}: ${k}[${j}]`))]));
    steps.set(num(o['step'], `${what}: steps[${i}].step`), { arrays, fuel: typeof o['fuel'] === 'number' ? o['fuel'] : null });
  }
  return { steps, trap: it['trap'] ?? null };
}
/** i32 values back to their little-endian bytes. */
export function wordsToBytes(words: number[]): Buffer {
  const b = Buffer.alloc(4 * words.length);
  words.forEach((w, i) => b.writeInt32LE(w | 0, 4 * i));
  return b;
}

// ---------------------------------------------------------------------------------------------------
// Packs, the evidence store and temporary folders.

export interface PackDir { id: string; version: string; dir: string }
/** Writes a pack folder: `pack.json` with `assets` listed by sha256 and size, and the asset files. */
export function writePack(root: string, owner: string, manifest: JsonObject, assets: Record<string, Buffer>): PackDir {
  const name = str(manifest['name'], 'pack name');
  const version = str(manifest['version'], 'pack version');
  const dir = join(root, `${name}-${version}`);
  mkdirSync(dir, { recursive: true });
  const listed: JsonObject[] = [];
  for (const [path, bytes] of Object.entries(assets)) {
    writeFileSync(join(dir, path), bytes);
    listed.push({ path, sha256: sha256(bytes), size: bytes.length, license: 'MIT' });
  }
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify({ ...manifest, assets: listed }, null, 2)}\n`);
  return { id: `${owner}/${name}`, version, dir };
}
/** The evidence store (`<2 hex>/<62 hex>`, each file named by its bytes' sha256), where a logic item's program is read. */
export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
/** A fresh folder per test (evidence store, packs), deleted after it. */
export function useTemp(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-192-dungeon-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
