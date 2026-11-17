// Test-side tools for the #192 voxel acceptance tests (README: The surface). They build `deep-show` per Cargo
// feature set (here and at the merge base), drive `deep-show run` scenarios as #238's suite does, write this
// suite's packs, run its own WebAssembly fixtures in Node's WebAssembly engine to know what each writes, and read
// a mesh by the closed rule an upstream mesh library's tests hold (after welding, every edge joins exactly two
// faces). Nothing here stands in for the sandbox module, the provider's content key, geometry.shading, the check
// or the cache: every run count, key, mesh, refusal and frame hash read here is the implementation's own.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import {
  DIGEST, arr, blocked, cargoBuild, isObject, num, obj, replies, sha256, show, start, str, useTemp,
  type JsonObject, type JsonValue, type PackDir,
} from '../../238/helpers.ts';

export { DIGEST, arr, blocked, isObject, num, obj, sha256, show, str, useTemp, type JsonObject, type JsonValue, type PackDir };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/192/voxel is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

// ---------------------------------------------------------------------------------------------------
// deep-show per feature set (README: Test builds), built once per process and copied out under its own name.

/** The feature sets these tests build: `full` with #238's `test-mesh-item`, and this suite's two version bumps. */
export type Feature = 'full' | 'test-mesh-item' | 'test-logic-version-bump' | 'test-sandbox-version-bump';
export const MESH_BUILD: Feature[] = ['full', 'test-mesh-item'];
export const LOGIC_BUMP: Feature[] = [...MESH_BUILD, 'test-logic-version-bump'];
export const SANDBOX_BUMP: Feature[] = [...MESH_BUILD, 'test-sandbox-version-bump'];

let binsDir = '';
const built = new Map<string, { bin: string; error: string }>();
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built.clear(); });

/** `cargo build --locked --bin deep-show --no-default-features --features <set>` in `root`, copied to `to`; '' or cargo's error. */
function buildShow(root: string, features: string[], to: string, env: NodeJS.ProcessEnv = {}): string {
  const error = cargoBuild(root, 'deep-show', features, env);
  if (error.startsWith('cargo could not run')) blocked(`${error} (put Homebrew's rustup on PATH: PATH=/opt/homebrew/opt/rustup/bin:$PATH)`);
  if (error === '') {
    const target = env['CARGO_TARGET_DIR'] ?? (process.env['CARGO_TARGET_DIR'] ? resolve(root, process.env['CARGO_TARGET_DIR']) : join(root, 'target'));
    copyFileSync(join(target, 'debug', exe('deep-show')), to);
  }
  return error;
}
/** deep-show of `features` in this checkout; the test fails with cargo's error when it doesn't build. */
export function deepShow(features: Feature[]): string {
  const name = features.join('+');
  let made = built.get(name);
  if (!made) {
    if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-192-voxel-bins-'));
    const bin = join(binsDir, `deep-show-${name}`);
    made = { bin, error: buildShow(REPO, features, bin) };
    built.set(name, made);
  }
  expect(made.error, `deep-show builds with --features ${features.join(',')}`).toBe('');
  return made.bin;
}

/** The merge base (`git merge-base HEAD origin/main`) exported whole by `git archive` (as #238's suite does, into the
 * same kept folder), and its deep-show of `features` built there with its own target folder, kept for later runs. */
export function baseDeepShow(features: Feature[]): { sha: string; bin: string } {
  const sha = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
  const dir = join(REPO, 'target', 'acceptance-238-base', sha.slice(0, 12));
  if (!existsSync(join(dir, '.exported'))) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const tar = join(dir, '..', `${sha.slice(0, 12)}.tar`);
    execFileSync('git', ['archive', '--format=tar', '-o', tar, sha], { cwd: REPO });
    execFileSync('tar', ['-xf', tar, '-C', dir]);
    rmSync(tar, { force: true });
    writeFileSync(join(dir, '.exported'), sha);
  }
  const bin = join(dir, `deep-show-${features.join('+')}`);
  if (!existsSync(bin)) {
    expect(buildShow(dir, features, bin, { CARGO_TARGET_DIR: join(dir, 'target') }), `the merge base ${sha.slice(0, 12)}'s deep-show builds with --features ${features.join(',')}`).toBe('');
  }
  return { sha, bin };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run` scenarios (#238's README: deep-show; #393's convention): one scenario line in, one answer out.

const ulid = (n: number): string => `01JB192V${String(n).padStart(18, '0')}`;
export const DOC = { a: ulid(1), b: ulid(2), c: ulid(3), d: ulid(4) } as const;
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: providers', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** The planted twins of deep-show this suite names (README: Planted twins), given as the scenario's `planted`. */
export type Planted = 'provider_key_omits_params' | 'provider_key_names_logic';
/** A scenario: the evidence store, your session and shell, one visible panel holding every document, the calls. */
export function scenario(evidence: string, calls: JsonObject[], planted?: Planted): JsonObject {
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: Object.fromEntries(Object.values(DOC).map((id) => [id, { panel: 'main' }])),
    ...(planted ? { planted } : {}),
    calls,
  };
}
/** `deep-show run [--cache <dir>]` on one scenario: exit 0, the scenario taken, one reply per call. */
export function runShow(bin: string, sc: JsonObject, cache?: string): JsonObject[] {
  const args = ['run', ...(cache ? ['--cache', cache] : [])];
  const what = `deep-show ${args.join(' ')}${typeof sc['planted'] === 'string' ? ` (planted ${sc['planted']})` : ''}`;
  const [out] = replies(start(bin, args, [sc], 3_600_000), [sc], what);
  expect(out!['ok'], `${what} took the scenario: ${show(out)}`).toBe(true);
  const rs = arr(out!['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  expect(rs.length, `${what}: one reply per call`).toBe(arr(sc['calls'], 'the calls').length);
  return rs;
}

export const REGISTRY: JsonObject = { call: 'registry' };
export const SANDBOX: JsonObject = { call: 'sandbox' };
export const installPack = (p: PackDir): JsonObject => ({ call: 'install_pack', id: p.id, dir: p.dir });
export const provided = (doc: string): JsonObject => ({ call: 'provided', doc });
/** A whole revision from your shell (`deep show`), with its issues. */
export const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues'] });
/** `count` frames of the document's session from `from` (frames at 60 per second), each with its pixel hash. */
export const frames = (doc: string, count: number, fromFrame = 0): JsonObject =>
  ({ call: 'frames', doc, count, from: `${fromFrame}f`, step: '1f', pixels: true });

/** The sandbox module's counts of check-time work in the process (#238's `sandbox` call). */
export interface Counts { checks: number; rewrites: number; runs: number }
export const countsOf = (reply: JsonObject, what: string): Counts =>
  ({ checks: num(reply['checks'], `${what}.checks`), rewrites: num(reply['rewrites'], `${what}.rewrites`), runs: num(reply['runs'], `${what}.runs`) });
/** Each module's version in the build (`registry`'s `versions`). */
export const versionOf = (reply: JsonObject, module: string): string => str(obj(reply['versions'], 'registry: versions')[module], `registry: versions.${module}`);

export interface Issue { code: string; severity: string; path: string; actual: JsonValue; raw: JsonObject }
export function issuesOf(reply: JsonObject, what: string): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), path: typeof o['path'] === 'string' ? o['path'] : '', actual: o['actual'] ?? null, raw: o };
  });
}
export const errors = (reply: JsonObject, what: string): Issue[] => issuesOf(reply, what).filter((i) => i.severity === 'error');
/** Every object anywhere in `v` (itself included), depth first. */
export function objectsIn(v: JsonValue | undefined): JsonObject[] {
  if (Array.isArray(v)) return v.flatMap((x) => objectsIn(x));
  if (!isObject(v)) return [];
  return [v, ...Object.values(v).flatMap((x) => objectsIn(x))];
}

// ---------------------------------------------------------------------------------------------------
// What a check's providers left (README: The surface: `provided`).

export interface Mesh { positions: number[][]; normals: number[][]; uv0: number[][]; indices: number[]; bounds: number[][] }
export interface Provided { item: string; provider: string; key: string; trap: JsonObject | null; out: JsonObject | null; ms: JsonValue | undefined; shading: JsonValue | undefined; raw: JsonObject }
export function providedRows(reply: JsonObject, what: string): Provided[] {
  return arr(reply['provided'], `${what}: provided`).map((v, i) => {
    const o = obj(v, `${what}: provided[${i}]`);
    return {
      item: String(o['item']), provider: String(o['provider']), key: String(o['key']),
      trap: isObject(o['trap']) ? o['trap'] : null, out: isObject(o['out']) ? o['out'] : null, ms: o['ms'], shading: o['shading'], raw: o,
    };
  });
}
/** The one row of `item` in a `provided` reply. */
export function rowOf(reply: JsonObject, item: string, what: string): Provided {
  const rows = providedRows(reply, what).filter((r) => r.item === item);
  expect(rows.length, `${what}: one provided row for item ${item}: ${show(reply)}`).toBe(1);
  return rows[0]!;
}
const points = (v: JsonValue | undefined, width: number, what: string): number[][] =>
  arr(v, what).map((p, i) => { const a = arr(p, `${what}[${i}]`).map((x, k) => num(x, `${what}[${i}][${k}]`)); expect(a.length, `${what}[${i}] has ${width} numbers`).toBe(width); return a; });
/** A provided row's mesh (the builder's output shape: positions, normals, uv0, indices, parts and bounds). */
export function meshOf(row: Provided, what: string): Mesh {
  expect(row.out, `${what}: the provider kept a mesh (out is not null): ${show(row.raw)}`).not.toBeNull();
  const m = obj(row.out!['mesh'], `${what}: out.mesh`);
  return {
    positions: points(m['positions'], 3, `${what}: positions`), normals: points(m['normals'], 3, `${what}: normals`),
    uv0: points(m['uv0'], 2, `${what}: uv0`), indices: arr(m['indices'], `${what}: indices`).map((x, i) => num(x, `${what}: indices[${i}]`)),
    bounds: points(m['bounds'], 3, `${what}: bounds`),
  };
}

// ---------------------------------------------------------------------------------------------------
// The closed rule, ported from an upstream mesh library's tests (Oracle page, criterion 1): positions are welded
// (within the design's geometry.shading default of 0.00001 m), and a mesh is closed when every welded edge joins
// exactly two faces.

export const WELD = 0.00001;
export type Point = [number, number, number];
export interface OpenEdge { edge: [Point, Point]; faces: number }
export function openEdges(positions: number[][], indices: number[]): OpenEdge[] {
  const ids = new Map<string, number>();
  const at: Point[] = [];
  const welded = positions.map((p) => {
    const key = p.map((x) => Math.round(x / WELD)).join(',');
    let id = ids.get(key);
    if (id === undefined) { id = at.length; ids.set(key, id); at.push([p[0]!, p[1]!, p[2]!]); }
    return id;
  });
  const faces = new Map<string, number>();
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const tri = [welded[indices[t]!]!, welded[indices[t + 1]!]!, welded[indices[t + 2]!]!];
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!, b = tri[(e + 1) % 3]!;
      const key = a < b ? `${a}/${b}` : `${b}/${a}`;
      faces.set(key, (faces.get(key) ?? 0) + 1);
    }
  }
  return [...faces].filter(([, n]) => n !== 2).map(([key, n]) => {
    const [a, b] = key.split('/').map(Number);
    return { edge: [at[a!]!, at[b!]!], faces: n };
  });
}
/** Whether `v` is `[[x, y, z], [x, y, z]]` naming one of `open` (either way round) within `tol` m. */
export function namesEdge(v: JsonValue | undefined, open: OpenEdge[], tol = 1e-6): boolean {
  if (!Array.isArray(v) || v.length !== 2) return false;
  const p = v.map((q) => (Array.isArray(q) && q.length === 3 && q.every((x) => typeof x === 'number') ? (q as number[]) : null));
  if (!p[0] || !p[1]) return false;
  const near = (a: number[], b: number[]): boolean => a.every((x, k) => Math.abs(x - b[k]!) <= tol);
  return open.some(({ edge: [a, b] }) => (near(p[0]!, a) && near(p[1]!, b)) || (near(p[0]!, b) && near(p[1]!, a)));
}

// ---------------------------------------------------------------------------------------------------
// The fixture assembler: #238's (tests/acceptance/238/wat, the `wat` crate), its sources copied to a temporary folder
// outside the checkout and built there, so the checkout's .cargo/config.toml patches (which its lockfile predates)
// don't reach it; offline from cargo's cache first, else fetching its two crates.

export interface Fixture { name: string; bytes: Buffer }
const WAT_TARGET = join(REPO, 'target', 'acceptance-192-voxel-wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const dir = mkdtempSync(join(tmpdir(), 'deep-192-voxel-wat-'));
  try {
    mkdirSync(join(dir, 'src'));
    const from = join(REPO, 'tests', 'acceptance', '238', 'wat');
    for (const f of ['Cargo.toml', 'Cargo.lock', join('src', 'main.rs')]) copyFileSync(join(from, f), join(dir, f));
    const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0', CARGO_TARGET_DIR: WAT_TARGET };
    let run = spawnSync('cargo', ['build', '--offline'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    if (run.error) blocked(`cargo could not run: ${run.error.message} (put Homebrew's rustup on PATH: PATH=/opt/homebrew/opt/rustup/bin:$PATH)`);
    if (run.status !== 0) run = spawnSync('cargo', ['build'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    if (run.status !== 0) blocked(`#238's fixture assembler didn't build: ${run.stderr.slice(-3000)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  watBin = join(WAT_TARGET, 'debug', exe('acceptance-238-wat'));
  return watBin;
}
/** Assembles WebAssembly text into a fixture; a text that doesn't assemble fails the test. */
export function assemble(name: string, text: string): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'deep-192-voxel-fx-'));
  try {
    writeFileSync(join(dir, `${name}.wat`), text);
    const run = spawnSync(assembler(), [dir, join(dir, `${name}.wat`)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(run.status, `fixture ${name}.wat assembles: ${run.stderr.slice(-2000)}`).toBe(0);
    return { name, bytes: readFileSync(join(dir, `${name}.wasm`)) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// A fixture run in Node's own WebAssembly engine (unrewritten, unmetered): what the program writes when its params
// and assets are copied in as the README's layout says. Used only to know a fixture's output, never as a verdict.

interface WasmExports { [name: string]: unknown }
interface WasmApi { instantiate(bytes: Uint8Array, imports: object): Promise<{ instance: { exports: WasmExports } }> }
const wasm = (globalThis as unknown as { WebAssembly: WasmApi }).WebAssembly;

export type ParamType = 'i32' | 'i64' | 'u32' | 'u64' | 'bool' | 'f32' | 'f64';
export interface ParamSpec { type: ParamType; unit: string; default: number; range: [number, number] }
/** Params at `params_at`: every param of the schema, names sorted by byte, 8 bytes each, little-endian; integer and
 * bool types as i64, float types as f64; a param the document leaves out takes its default. */
export function paramBytes(schema: Record<string, ParamSpec>, given: Record<string, number>): Buffer {
  const names = Object.keys(schema).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const out = Buffer.alloc(8 * names.length);
  names.forEach((name, i) => {
    const spec = schema[name]!;
    const value = given[name] ?? spec.default;
    if (spec.type === 'f32' || spec.type === 'f64') out.writeDoubleLE(value, 8 * i);
    else out.writeBigInt64LE(BigInt(value), 8 * i);
  });
  return out;
}
/** A mesh output at `out_at`: u32 vertex_count, u32 index_count, f32 positions[3n], normals[3n], uv0[2n], u32 indices. */
export function decodeMesh(memory: Buffer, at: number): Omit<Mesh, 'bounds'> & { vertexCount: number } {
  const n = memory.readUInt32LE(at);
  const ni = memory.readUInt32LE(at + 4);
  let p = at + 8;
  const take = (width: number): number[][] => Array.from({ length: n }, () => Array.from({ length: width }, () => { const x = memory.readFloatLE(p); p += 4; return x; }));
  const positions = take(3);
  const normals = take(3);
  const uv0 = take(2);
  const indices = Array.from({ length: ni }, () => { const x = memory.readUInt32LE(p); p += 4; return x; });
  return { vertexCount: n, positions, normals, uv0, indices };
}
/** Runs `bytes` as a provider in Node: params at `params_at`, each asset as a u32 length and its bytes from `assets_at`, then `gen(seed)`. */
export async function runInNode(bytes: Buffer, params: Buffer, assets: Buffer[], seed: bigint): Promise<{ result: number; memory: Buffer; outAt: number }> {
  const { instance } = await wasm.instantiate(new Uint8Array(bytes), {});
  const e = instance.exports;
  const memory = (): Buffer => Buffer.from((e['memory'] as { buffer: ArrayBuffer }).buffer);
  const global = (name: string): number => (e[name] as { value: number }).value;
  params.copy(memory(), global('params_at'));
  let at = global('assets_at');
  for (const a of assets) { memory().writeUInt32LE(a.length, at); a.copy(memory(), at + 4); at += 4 + a.length; }
  const result = (e['gen'] as (seed: bigint) => number)(seed);
  return { result, memory: Buffer.from(memory()), outAt: global('out_at') };
}

// ---------------------------------------------------------------------------------------------------
// Pack folders (#238's form): pack.json with its assets listed by sha256 and size, and the asset files.

export function writePack(root: string, manifest: JsonObject, assets: Record<string, Buffer>): PackDir {
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
  return { id: `test/${name}`, version, dir };
}
/** Keeps `bytes` in the evidence store by their sha256 (`<first 2 hex>/<other 62 hex>`), where a logic item's program is read. */
export function keep(evidence: string, bytes: Buffer): string {
  const sha = sha256(bytes);
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}

/** A new empty folder `name` inside the test's temporary folder (#238's `useTemp`, deleted after each test). */
export function sub(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}
