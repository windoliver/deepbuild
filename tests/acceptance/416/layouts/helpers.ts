// Test-side tools for the #416 layouts acceptance tests (README: The surface), cut down from #415's, #192's and #238's
// suites (nothing imported from them). They assemble this suite's programs with its own assembler (wat/), run a fixture
// in Node's own WebAssembly where a test needs what the program itself computes, build deep-show (and, for the budgets,
// the merge base's) and drive `deep-show run`. Nothing here stands in for a validator run, the pack check, the document
// check or the listing: every verdict, refusal, count and row a test judges is the implementation's own.

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/416/layouts is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
const MIB = 1024 * 1024;
/** Each test's own timeout: deep-show's first build takes long on a loaded Mac; the budgets also build the merge base. */
export const TIMEOUT = 10_800_000;
export const BASE_TIMEOUT = 14_400_000;
/** Homebrew's rustup first on PATH when it's there, as the repo's other suites run cargo. */
const RUSTUP = '/opt/homebrew/opt/rustup/bin';
if (existsSync(RUSTUP) && !(process.env['PATH'] ?? '').split(':').includes(RUSTUP)) process.env['PATH'] = `${RUSTUP}:${process.env['PATH'] ?? ''}`;
/** Debug builds as the other deep-show suites make them, unless the caller set these. */
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
};

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
/** A reading this machine can't give cleanly: the test fails with this message, never passes. */
export const inconclusive = (why: string): never => { throw Error(`INCONCLUSIVE: ${why}`); };

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
/** An asset ID: a sha256 as 64 lowercase hex digits. */
export const DIGEST = /^[0-9a-f]{64}$/;
/** Whether some object anywhere in `v` holds `key` with exactly `want` (how a refusal names something, README: Naming). */
export function holds(v: JsonValue | undefined, key: string, want: JsonValue): boolean {
  if (Array.isArray(v)) return v.some((x) => holds(x, key, want));
  if (!isObject(v)) return false;
  if (key in v && JSON.stringify(v[key]) === JSON.stringify(want)) return true;
  return Object.values(v).some((x) => holds(x, key, want));
}

// ---------------------------------------------------------------------------------------------------
// The assembler (wat/): WebAssembly text to a validated module.

export interface Program { name: string; bytes: Buffer; sha: string }
const WAT_DIR = join(HERE, 'wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const target = join(REPO, 'target', 'acceptance-416-layouts-wat');
  const run = spawnSync('cargo', ['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], {
    cwd: WAT_DIR, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, CARGO_TARGET_DIR: target },
  });
  if (run.error) blocked(`cargo could not run (${run.error.message}); this suite's assembler is built with it`);
  if (run.status !== 0) blocked(`this suite's fixture assembler (tests/acceptance/416/layouts/wat) didn't build: ${run.stderr.slice(-3000)}`);
  watBin = join(target, 'debug', 'acceptance-416-layouts-wat');
  return watBin;
}
const assembled = new Map<string, Program>();
/** `text` assembled into a module, once per process. */
export function assemble(name: string, text: string): Program {
  const known = assembled.get(text);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-416-wat-'));
  try {
    writeFileSync(join(dir, `${name}.wat`), text);
    const run = spawnSync(assembler(), [dir, join(dir, `${name}.wat`)], { encoding: 'utf8', maxBuffer: 64 * MIB });
    if (run.status !== 0) throw Error(`the assembler refused this suite's ${name}.wat: ${run.stderr.slice(-2000)}`);
    const bytes = readFileSync(join(dir, `${name}.wasm`));
    const p = { name, bytes, sha: sha256(bytes) };
    assembled.set(text, p);
    return p;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// A fixture run in Node's own WebAssembly (unmetered, unrewritten): what the program itself computes.

const globalOf = (inst: WebAssembly.Instance, name: string): number => (inst.exports[name] as WebAssembly.Global).value as number;
const instance = (p: Program): { inst: WebAssembly.Instance; mem: Buffer } => {
  const inst = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(p.bytes)), {});
  return { inst, mem: Buffer.from((inst.exports['memory'] as WebAssembly.Memory).buffer) };
};
/** A validator on `asset`: the asset copied in at in_at, then validate(len): −1, or the first bad byte's offset. */
export function validateInNode(p: Program, asset: Buffer): number {
  const { inst, mem } = instance(p);
  asset.copy(mem, globalOf(inst, 'in_at'));
  return Number((inst.exports['validate'] as (len: bigint) => bigint)(BigInt(asset.length)));
}
/** A provider: `params` (each an i64) at params_at, gen(0) once, the data asset read after its u32 length at out_at. */
export function provideInNode(p: Program, params: bigint[]): Buffer {
  const { inst, mem } = instance(p);
  params.forEach((v, i) => mem.writeBigInt64LE(v, globalOf(inst, 'params_at') + 8 * i));
  (inst.exports['gen'] as (seed: bigint) => number)(0n);
  const out = globalOf(inst, 'out_at');
  return Buffer.from(mem.subarray(out + 4, out + 4 + mem.readUInt32LE(out)));
}

// ---------------------------------------------------------------------------------------------------
// deep-show `full`, built once per process and copied out; the merge base's, built in its own kept folder.

function buildShow(root: string, to: string, env: NodeJS.ProcessEnv): string {
  const args = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];
  const run = spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) blocked(`cargo could not run: ${run.error.message} (put Homebrew's rustup on PATH: PATH=/opt/homebrew/opt/rustup/bin:$PATH)`);
  if (run.status !== 0) {
    return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  }
  const target = env['CARGO_TARGET_DIR'] ?? (process.env['CARGO_TARGET_DIR'] ? resolve(root, process.env['CARGO_TARGET_DIR']) : join(root, 'target'));
  copyFileSync(join(target, 'debug', 'deep-show'), to);
  return '';
}
let binsDir = '';
let built: { bin: string; error: string } | undefined;
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built = undefined; });
/** deep-show of `full` in this checkout; the test fails with cargo's error when it doesn't build. */
export function deepShow(): string {
  if (!built) {
    binsDir = mkdtempSync(join(tmpdir(), 'deep-416-layouts-bins-'));
    const bin = join(binsDir, 'deep-show-full');
    built = { bin, error: buildShow(REPO, bin, {}) };
  }
  expect(built.error, 'deep-show builds (cargo build --locked --bin deep-show --no-default-features --features full)').toBe('');
  return built.bin;
}
/**
 * The merge base (`git merge-base HEAD origin/main`) exported whole by `git archive` into the folder #238's and #192's
 * suites keep it in, and its deep-show of `full` built there with its own target folder, kept so later runs build warm.
 */
export function baseDeepShow(): { sha: string; bin: string } {
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
  const bin = join(dir, 'deep-show-full');
  if (!existsSync(bin)) expect(buildShow(dir, bin, { CARGO_TARGET_DIR: join(dir, 'target') }), `the merge base ${sha.slice(0, 12)}'s deep-show builds with --features full`).toBe('');
  return { sha, bin };
}

// ---------------------------------------------------------------------------------------------------
// deep-show run: one scenario on stdin, one answer `{ok, replies}` (#238's and #393's form).

export const SESSION = 'sess-alpha';
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB416L${String(n).padStart(18, '0')}`;
export function scenario(evidence: string, docs: string[], calls: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: layouts', process: { pid: 4100, start: 1_000 } } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1280, 720] } },
    docs: Object.fromEntries(docs.map((d) => [d, { panel: 'main' }])),
    ...extra,
    calls,
  };
}
/** `deep-show run` with `bin`: exit 0, one answer line, ok, one reply per call. */
export function runShow(bin: string, sc: JsonObject): JsonObject[] {
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: 3_600_000, killSignal: 'SIGKILL' });
  expect(run.error, `deep-show run ran and finished within its timeout`).toBeUndefined();
  expect(run.status, `deep-show run exits 0 (${run.signal ?? 'no signal'}); stdout: ${run.stdout.slice(0, 1500)}; stderr: ${run.stderr.slice(-1500)}`).toBe(0);
  const lines = run.stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `deep-show run answers one line: ${run.stdout.slice(0, 800)}`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-show run: its answer');
  expect(out['ok'], `deep-show run took the scenario: ${show(out)}`).toBe(true);
  const replies = arr(out['replies'], 'deep-show run: replies').map((r, i) => obj(r, `deep-show run: replies[${i}]`));
  expect(replies.length, 'deep-show run: one reply per call').toBe(arr(sc['calls'], 'the calls').length);
  return replies;
}

export interface PackDir { id: string; version: string; dir: string }
export const installPack = (p: PackDir): JsonObject => ({ call: 'install_pack', id: p.id, dir: p.dir });
/** The working agent's deep_show of a whole revision, with its issues. */
export const showDoc = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });
/** #415's check-time validation of one data asset in a layout. */
export const validate = (layout: string, path: string): JsonObject => ({ call: 'validate', layout, path });
/** #238's counts of the sandbox module's check-time work in the process. */
export const SANDBOX: JsonObject = { call: 'sandbox' };
/** `count` frames of the document's session from frame 0, at 60 per second. */
export const frames = (doc: string, count: number): JsonObject => ({ call: 'frames', doc, count, from: '0f', step: '1f' });
/** #412's deep_kinds list of one registry, from `cursor` when given. */
export const kindsList = (registry: string, cursor?: string): JsonObject => ({ call: 'deep_kinds', op: 'list', registry, ...(cursor ? { cursor } : {}) });

export interface Counts { checks: number; links: number; rewrites: number; runs: number }
export const countsOf = (reply: JsonObject, what: string): Counts => ({
  checks: num(reply['checks'], `${what}.checks`), links: num(reply['links'], `${what}.links`),
  rewrites: num(reply['rewrites'], `${what}.rewrites`), runs: num(reply['runs'], `${what}.runs`),
});
export const minus = (a: Counts, b: Counts): Counts => ({ checks: a.checks - b.checks, links: a.links - b.links, rewrites: a.rewrites - b.rewrites, runs: a.runs - b.runs });

export interface Issue { code: string; severity: string; path: string; raw: JsonObject }
export function errorsOf(reply: JsonObject, what: string): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), path: String(o['path'] ?? ''), raw: o };
  }).filter((i) => i.severity === 'error');
}
/** A deep_show that presented its document with no error. */
export function presented(reply: JsonObject, what: string): void {
  expect(errorsOf(reply, what).map((i) => show(i.raw, 600)), `${what} raises no error at check`).toEqual([]);
  expect(reply['outcome'], `${what} is presented: ${show(reply, 2000)}`).toBe('presented');
}

// ---------------------------------------------------------------------------------------------------
// Packs, the evidence store and temporary folders.

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
/** The evidence store (`<2 hex>/<62 hex>`, each file named by its bytes' sha256), where a logic item's program and assets are read. */
export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
/** A fresh folder per test (evidence store, packs, assets), deleted after it. */
export function useTemp(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-416-layouts-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
export function sub(root: string, name: string): string {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  return d;
}

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timings (as #238's suite; mains never gates).

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why a timing here would be a reading, not a budget result; null on a reference Mac fit to judge. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (lpm && lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const [one] = loadavg();
  if (one! > availableParallelism()) return `loaded past its core count: 1-minute load ${one!.toFixed(1)} on ${availableParallelism()} cores`;
  return null;
}
export type Judged = { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; shown: string };
/** Five runs after a warm-up: PASS all within the limit, FAIL all over it by more than the margin (the larger of 5% and their spread), else INCONCLUSIVE. */
export function judgeRuns(name: string, runs: number[], limit: number): Judged {
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit.toFixed(3)} (margin ${(margin * 100).toFixed(0)}%)`;
  if (runs.length !== 5) return { status: 'INCONCLUSIVE', shown: `${shown}: not five runs` };
  if (runs.every((r) => r <= limit)) return { status: 'PASS', shown };
  if (runs.every((r) => r > limit * (1 + margin))) return { status: 'FAIL', shown };
  return { status: 'INCONCLUSIVE', shown };
}
