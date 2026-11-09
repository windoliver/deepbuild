// Test-side tools for the #190 acceptance tests (README: The surface under test), after #532's suite (copied and cut
// down, nothing imported). They assemble this suite's WebAssembly programs and relocatable objects with its own
// assembler (wat/), build and drive the logic module's runner `deep-logic` on this host, at the merge base and,
// through Docker, on Linux x86_64, and run the logic module's web runner in headless Chrome. Nothing here stands in
// for the logic module or its linker: every merged program, hash, key, receipt, refusal and verdict read here is the
// implementation's own; the expected values come from the issue's text and this suite's own computations.

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
/** The checkout root (tests/acceptance/190 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on a Mac (Homebrew's rustup keeps it off the default PATH) and in a user's home. */
const RUSTUP_BINS = ['/opt/homebrew/opt/rustup/bin', join(process.env['HOME'] ?? '', '.cargo', 'bin')].filter((d) => existsSync(d));
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(RUSTUP_BINS.length ? { PATH: `${RUSTUP_BINS.join(':')}:${process.env['PATH'] ?? ''}` } : {}),
};

/** Every test passes this timeout: first builds of deep-logic (here and at the merge base), and its Linux build under emulation, take many minutes. */
export const TIMEOUT = 5_400_000;
/** Builds before a file's tests (the slow part), so each test's own time is its own. */
export function prebuild(fn: () => void): void { beforeAll(() => { try { fn(); } catch { /* each test reports its own build failure */ } }, TIMEOUT); }

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
/** Criteria 4 and 10 name macOS arm64 ("the reference Mac"): anywhere else the test is BLOCKED. */
export function requireMacArm64(what: string): void {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') blocked(`${what} runs on macOS arm64 (the reference Mac); this host is ${process.platform}/${process.arch}`);
}

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: '#190.e0980599', 2: '#190.c4868d76', 3: '#190.ea25cdd0', 4: '#190.2d5bb5ea', 5: '#190.99970527',
  6: '#190.949568c9', 7: '#190.2d024832', 8: '#190.26483cb7', 9: '#190.67822510', 10: '#190.29b58f9e',
} as const;

export const FLICKS = 705_600_000;
export const STEP_60 = FLICKS / 60;
export const MIB = 1024 * 1024;
/** The one subset's largest program (Logic: sandbox). */
export const MAX_PROGRAM = 4 * MIB;
export const HASH64 = /^[0-9a-f]{16}$/;
export const DIGEST = /^[0-9a-f]{64}$/;

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
const intOrNull = (v: JsonValue | undefined, what: string): number | null => (v === null || v === undefined ? null : int(v, what));
const hexMap = (v: JsonValue | undefined, what: string, re = HASH64): Record<string, string> =>
  Object.fromEntries(Object.entries(obj(v, what)).map(([id, h]) => { const s = str(h, `${what}.${id}`); expect(s, `${what}.${id}`).toMatch(re); return [id, s]; }));
export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** The first line two lists differ at, or null. */
export function firstDiff(a: readonly string[], b: readonly string[]): string | null {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `#${i}: ${(a[i] ?? '(none)').slice(0, 200)} against ${(b[i] ?? '(none)').slice(0, 200)}`;
  return null;
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
export const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };

// ---------------------------------------------------------------------------------------------------
// Programs: WebAssembly text assembled by this suite's own assembler (wat/: the `wat` crate, outside the workspace).

export interface Program { name: string; bytes: Buffer; b64: string; sha: string }
/** `module`: a whole module (no links). `program` and `library`: a relocatable object (README: Relocatable objects). */
export type Form = 'module' | 'program' | 'library';

function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|was not used|^help:|^\s{6}/.test(l)).join('\n').slice(-4000)}`;
  return '';
}

const WAT_DIR = join(HERE, 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-190-wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const error = cargo(['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR, { CARGO_TARGET_DIR: WAT_TARGET });
  if (error) blocked(`this suite's assembler (tests/acceptance/190/wat) didn't build: ${error}`);
  watBin = join(WAT_TARGET, 'debug', exe('acceptance-190-wat'));
  return watBin;
}
const assembled = new Map<string, Program>();
/** Assembles WebAssembly text into a Program, as a whole module or a relocatable object. */
export function assemble(name: string, text: string, form: Form = 'module'): Program {
  const key = `${form}\n${name}\n${text}`;
  const known = assembled.get(key);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-190-wat-'));
  try {
    const file = join(dir, `${name}.wat`);
    writeFileSync(file, text);
    const run = spawnSync(assembler(), [dir, ...(form === 'module' ? [] : [`--${form}`]), file], { encoding: 'utf8', maxBuffer: 64 * MIB });
    if (run.status !== 0) throw Error(`the assembler refused ${name}: ${run.stderr.slice(-2000)}`);
    const bytes = readFileSync(join(dir, `${name}.wasm`));
    const p = { name, bytes, b64: bytes.toString('base64'), sha: sha256(bytes) };
    assembled.set(key, p);
    return p;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// The runner `deep-logic` (README: deep-logic), JSON lines in, one reply per line.

export const LOGIC_BIN = 'deep-logic';
/** `deep-logic --planted <name>`: each one criterion's wrong program (README: Planted twins). */
export type Planted = 'linker_adds_linking_section' | 'pack_check_skips_library_subset' | 'linker_links_in_listing_order';
const plantedArgs = (planted: Planted[]): string[] => planted.flatMap((p) => ['--planted', p]);

export interface Started { status: number | null; signal: NodeJS.Signals | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string; ms: number }
function parseLines(stdout: string): JsonValue[] {
  return stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
}
export function start(cmd: string, args: string[], inputs: JsonValue[], timeoutMs = 3_600_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const t0 = performance.now();
  const run = spawnSync(cmd, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const ms = performance.now() - t0;
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  // A process that exits before reading its input (an unknown --planted name) is EPIPE here: its status says why.
  if (run.error && !timedOut && (run.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${cmd} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  return { status: run.status, signal: run.signal, timedOut, lines: parseLines(stdout), stdout, stderr: run.stderr ?? '', ms };
}
/** One reply per call from a run that exited 0; each failure names the host. */
export function replies(s: Started, calls: JsonValue[], what: string): JsonObject[] {
  expect(s.timedOut, `${what} finished within its timeout`).toBe(false);
  expect(s.status, `${what} exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${what}: one reply per call (stdout: ${s.stdout.slice(0, 600)})`).toBe(calls.length);
  return s.lines.map((l, i) => obj(l, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 160)})`));
}

let binsDir = '';
const bins = (): string => (binsDir ||= mkdtempSync(join(tmpdir(), 'deep-190-bins-')));
let builtLogic: { bin: string; error: string } | undefined;
/** `cargo build --locked --bin deep-logic` in the checkout, copied out, once per process. */
export function logicBin(): string {
  if (!builtLogic) {
    const bin = join(bins(), exe(LOGIC_BIN));
    const error = cargo(['build', '--locked', '--bin', LOGIC_BIN], REPO, {});
    if (error === '') copyFileSync(join(TARGET, 'debug', exe(LOGIC_BIN)), bin);
    builtLogic = { bin, error };
  }
  expect(builtLogic.error, `${LOGIC_BIN} builds on this host (cargo build --locked --bin ${LOGIC_BIN})`).toBe('');
  return builtLogic.bin;
}

// The merge base (criteria 7 and 10): `git merge-base HEAD main`, its tree exported with `git archive` (no worktree
// is added), built the same way into target/acceptance-190-base/.
let builtBase: { bin: string; error: string; rev: string } | undefined;
export function baseBin(): { bin: string; rev: string } {
  if (!builtBase) {
    const mb = spawnSync('git', ['merge-base', 'HEAD', 'main'], { cwd: REPO, encoding: 'utf8' });
    const rev = mb.stdout.trim();
    let error = mb.status === 0 && rev ? '' : `git merge-base HEAD main failed: ${mb.stderr}`;
    const bin = join(bins(), exe(`${LOGIC_BIN}-base`));
    if (!error) {
      const src = mkdtempSync(join(tmpdir(), 'deep-190-base-'));
      try {
        const tar = join(src, '..', `${src.split('/').pop()}.tar`);
        const a = spawnSync('git', ['archive', '--format=tar', '-o', tar, rev], { cwd: REPO, encoding: 'utf8' });
        const x = a.status === 0 ? spawnSync('tar', ['-xf', tar, '-C', src], { encoding: 'utf8' }) : a;
        rmSync(tar, { force: true });
        if (x.status !== 0) error = `exporting the merge base ${rev} failed: ${x.stderr}`;
        else {
          const target = join(TARGET, 'acceptance-190-base');
          error = cargo(['build', '--locked', '--bin', LOGIC_BIN], src, { CARGO_TARGET_DIR: target });
          if (error === '') copyFileSync(join(target, 'debug', exe(LOGIC_BIN)), bin);
        }
      } finally {
        rmSync(src, { recursive: true, force: true });
      }
    }
    builtBase = { bin, error, rev };
  }
  expect(builtBase.error, `${LOGIC_BIN} builds at the merge base ${builtBase.rev}`).toBe('');
  return { bin: builtBase.bin, rev: builtBase.rev };
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; builtLogic = undefined; builtBase = undefined; });

const hostName = `${process.platform}/${process.arch}`;
/** Runs `calls` through one `deep-logic [--planted p]...` process on this host. */
export function onHost(calls: JsonObject[], planted: Planted[] = []): JsonObject[] {
  const args = plantedArgs(planted);
  return replies(start(logicBin(), args, calls), calls, `${LOGIC_BIN} ${args.join(' ')} on ${hostName}`);
}
/** The same through one process of the merge base's `deep-logic`, with its wall time. */
export function onBase(calls: JsonObject[]): JsonObject[] {
  const { bin, rev } = baseBin();
  return replies(start(bin, [], calls), calls, `${LOGIC_BIN} at the merge base ${rev.slice(0, 8)} on ${hostName}`);
}
/** One process's wall time for `calls` (criterion 10), from the checkout's or the merge base's binary. */
export function timed(which: 'head' | 'base', calls: JsonObject[]): number {
  const s = start(which === 'head' ? logicBin() : baseBin().bin, [], calls);
  replies(s, calls, `${LOGIC_BIN} (${which}) timed`);
  return s.ms;
}

// Linux x86_64: the same checkout built for linux/amd64 in Docker with the rust image of the toolchain
// rust-toolchain.toml names, its caches under target/acceptance-190-linux/. Nothing is pulled: a missing image, or a
// Docker that can't run linux/amd64 here, is BLOCKED.
const LINUX = join(TARGET, 'acceptance-190-linux');
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
/** Builds `deep-logic` for linux/amd64 once per process; BLOCKED without Docker, the image or amd64 emulation, FAIL when cargo fails. */
function linuxLogic(): void {
  if (linuxBuilt === undefined) {
    const info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 30_000);
    if (info.status !== 0) blocked(`Docker is unreachable (docker info: ${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); Linux x86_64 runs in a linux/amd64 container`);
    const image = linuxImage();
    if (!hasAmd64(image)) blocked(`Docker has no linux/amd64 image ${image} here and this suite pulls nothing; run: docker pull --platform linux/amd64 ${image}`);
    const arch = docker(['run', '--rm', '--platform', 'linux/amd64', image, 'uname', '-m'], undefined, 120_000);
    if (arch.status !== 0 || arch.stdout.trim() !== 'x86_64') blocked(`this Docker can't run linux/amd64 (uname -m in ${image}: ${(arch.stdout + arch.stderr).trim().slice(-300)}); it needs amd64 emulation (binfmt) or an x86_64 host`);
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
  const s: Started = { status: r.status, signal: null, timedOut: r.timedOut, lines: parseLines(r.stdout), stdout: r.stdout, stderr: r.stderr, ms: 0 };
  return replies(s, calls, `${LOGIC_BIN} on linux/amd64`);
}

/** A long-lived `deep-logic` process (criterion 10's frames): one call, one awaited reply. Stopped by its PID. */
export interface Live { call: (c: JsonObject) => Promise<JsonObject>; stop: () => void }
export function live(bin: string): Live {
  const child: ChildProcessWithoutNullStreams = spawn(bin, [], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
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
// Libraries, fixtures, packs and pieces (README: Piece, Pack, Library, Fixture).

export type WriteType = 'bool' | 'i32' | 'f64' | 'vec2' | 'vec3' | 'quat';
export type Writes = Record<string, { type: WriteType; count?: number }>;
/** A library as its pack carries it: its object, its exports, its fixtures and the libraries it needs. */
export interface Lib { name: string; program: Program; exports: string[]; fixtures: FixtureSpec[]; needs?: Lib[] }
/** A fixture: a logic item that links only its library (added when it is written), its track, its steps and the arrays expected at steps. */
export interface FixtureSpec { program: Program; writes: Writes; budget?: { fuel?: number; memory?: number; stack?: number }; track?: Entry[]; steps: number; expect: Record<string, Record<string, JsonValue[]>> }
export interface PackSpec { name: string; version: string; origin?: 'installed' | 'agent'; libs: Lib[] }
export interface Link { name: string; asset: string }
export interface ItemSpec { program: Program; reads?: string[]; writes: Writes; links?: (Lib | Link)[]; budget?: { fuel?: number; memory?: number; stack?: number } }
export interface PieceSpec { seed: number; items: Record<string, ItemSpec>; packs?: PackSpec[]; controls?: string[]; class?: string; override?: Record<string, Buffer> }

export type Assets = Record<string, string>;
const put = (assets: Assets, bytes: Buffer): string => { const s = sha256(bytes); assets[s] = bytes.toString('base64'); return s; };
export const packId = (p: PackSpec): string => `${p.name}@${p.version}`;
const linkOf = (l: Lib | Link): Link => ('program' in l ? { name: l.name, asset: l.program.sha } : l);
const linksJson = (links: (Lib | Link)[]): JsonValue => links.map((l) => ({ ...linkOf(l) }));
/** A logic item's params, its programs' bytes put in `assets`. */
function paramsOf(spec: ItemSpec, assets: Assets): JsonObject {
  put(assets, spec.program.bytes);
  const params: JsonObject = { program: spec.program.sha, writes: spec.writes as unknown as JsonObject };
  if (spec.reads) params['reads'] = spec.reads;
  if (spec.links) {
    params['links'] = linksJson(spec.links);
    for (const l of spec.links) if ('program' in l) put(assets, l.program.bytes);
  }
  if (spec.budget) params['budget'] = spec.budget as JsonObject;
  return params;
}
/** A fixture as its asset holds it (README: Fixture): its JSON's bytes. */
export function fixtureBytes(lib: Lib, f: FixtureSpec, assets: Assets): Buffer {
  const item = { kind: 'logic@1', params: paramsOf({ program: f.program, writes: f.writes, links: [lib], ...(f.budget ? { budget: f.budget } : {}) }, assets) };
  return Buffer.from(JSON.stringify({ item, track: f.track ?? [], steps: f.steps, expect: { arrays: f.expect } }));
}
/** A fixture's asset ID. */
export const fixtureId = (lib: Lib, f: FixtureSpec): string => sha256(fixtureBytes(lib, f, {}));
function libEntry(lib: Lib, assets: Assets): JsonObject {
  put(assets, lib.program.bytes);
  const entry: JsonObject = { asset: lib.program.sha, exports: lib.exports, fixtures: lib.fixtures.map((f) => put(assets, fixtureBytes(lib, f, assets))) };
  if (lib.needs) {
    entry['needs'] = linksJson(lib.needs);
    for (const n of lib.needs) put(assets, n.program.bytes);
  }
  return entry;
}
/** A pack as `deep-logic` takes it (README: Pack). */
export function packJson(p: PackSpec, assets: Assets): JsonObject {
  return { name: p.name, version: p.version, origin: p.origin ?? 'installed', libs: Object.fromEntries(p.libs.map((l) => [l.name, libEntry(l, assets)])) };
}
/** A piece as `deep-logic` takes it: the document's seed, its controls, its installed packs, its logic items and every asset they name. */
export function piece(p: PieceSpec): JsonObject {
  const assets: Assets = {};
  const items: JsonObject = {};
  for (const [id, spec] of Object.entries(p.items)) items[id] = { kind: 'logic@1', params: paramsOf(spec, assets) };
  const packs = (p.packs ?? []).map((k) => packJson(k, assets));
  for (const [sha, bytes] of Object.entries(p.override ?? {})) assets[sha] = bytes.toString('base64');
  return {
    seed: p.seed,
    ...(p.class ? { class: p.class } : {}),
    ...(p.controls ? { controls: Object.fromEntries(p.controls.map((c) => [c, { kind: 'slider' }])) } : {}),
    ...(p.packs ? { packs } : {}),
    items, assets,
  };
}
/** The piece a library's fixture runs as (README: Fixture): seed 0, its one item `fixture`, the packs given. */
export function fixturePiece(lib: Lib, f: FixtureSpec, packs: PackSpec[]): JsonObject {
  return piece({ seed: 0, packs, items: { fixture: { program: f.program, writes: f.writes, links: [lib], ...(f.budget ? { budget: f.budget } : {}) } } });
}

export interface Entry { t: number; seq: number; control: string; value: number; writer: 'you' | 'tour'; player: number }

// The calls.
export const ABOUT: JsonObject = { call: 'about' };
export const WEB_RUNNER: JsonObject = { call: 'web_runner' };
export const checkCall = (p: JsonObject): JsonObject => ({ call: 'check', piece: p });
export const queryCall = (p: JsonObject): JsonObject => ({ call: 'query', piece: p });
export const bakeCall = (p: JsonObject, steps: number, track: Entry[] = []): JsonObject => ({ call: 'bake', piece: p, track: track as unknown as JsonValue, steps });
export const webPlanCall = (p: JsonObject, steps: number, track: Entry[] = []): JsonObject => ({ call: 'web_plan', piece: p, track: track as unknown as JsonValue, steps });
export const goldenCall = (p: JsonObject, steps: number): JsonObject => ({ call: 'golden', piece: p, track: [], steps });
export function packCheckCall(p: PackSpec): JsonObject { const assets: Assets = {}; const pack = packJson(p, assets); return { call: 'pack_check', pack, assets }; }
export const claimCall = (p: JsonObject, library: string): JsonObject => ({ call: 'claim', piece: p, library });
export const viewCall = (p: JsonObject, span: number): JsonObject => ({ call: 'view', piece: p, track: [], span });
export const frameCall = (session: string, seek: number): JsonObject => ({ call: 'frame', session, seek });

// Replies.

export interface Layout { digest: string; entries: { region: string; name: string; offset: number; size: number }[] }
function layoutOf(v: JsonValue | undefined, what: string): Layout {
  const o = obj(v, what);
  const entries = arr(o['entries'], `${what}.entries`).map((e, i) => {
    const x = obj(e, `${what}.entries[${i}]`);
    return { region: str(x['region'], `${what}.entries[${i}].region`), name: str(x['name'], `${what}.entries[${i}].name`), offset: int(x['offset'], `${what}.entries[${i}].offset`), size: int(x['size'], `${what}.entries[${i}].size`) };
  });
  return { digest: str(o['digest'], `${what}.digest`), entries };
}
/** Where an item's region entry sits: its offset in its region. */
export function entryAt(l: Layout, region: 'reads' | 'writes', name: string): number {
  const e = l.entries.find((x) => x.region === region && x.name === name);
  if (!e) throw Error(`the layout has no ${region} entry ${name}: ${JSON.stringify(l.entries)}`);
  return e.offset;
}
/** The layout `check` gives an item of these writes (built from a whole module that only names them). */
export function layoutFor(probe: Program, writes: Writes): Layout {
  const [reply] = onHost([checkCall(piece({ seed: 190, items: { probe: { program: probe, writes } } }))]);
  expect(reply!['ok'], `check of the layout probe admits it: ${show(reply)}`).toBe(true);
  return layoutOf(obj(obj(reply!['items'], 'items')['probe'], 'items.probe')['layout'], 'the probe\'s layout');
}

/** A fixture's run, as a library's receipt holds it. */
export interface FixtureRun { fixture: string; verdict: string; ran: boolean; ns: number; deep_hashes: Record<string, string> }
/** A linked library, as a receipt names it. */
export interface LibRecord { name: string; hash: string; pack: string; fixtures: FixtureRun[] }
/** An item's receipt: `check`'s Checked (README: Checked). */
export interface Checked { program: string; hash: string; linked: { sha256: string; size: number; bytes: Buffer } | null; libraries: LibRecord[]; link_ns: number }
export function checkedOf(v: JsonValue | undefined, what: string): Checked {
  const o = obj(v, what);
  const l = o['linked'];
  let linked: Checked['linked'] = null;
  if (l !== null && l !== undefined) {
    const x = obj(l, `${what}.linked`);
    const bytes = Buffer.from(str(x['bytes'], `${what}.linked.bytes`), 'base64');
    linked = { sha256: str(x['sha256'], `${what}.linked.sha256`), size: int(x['size'], `${what}.linked.size`), bytes };
  }
  const libraries = arr(o['libraries'], `${what}.libraries`).map((x, i) => {
    const w = `${what}.libraries[${i}]`;
    const r = obj(x, w);
    return {
      name: str(r['name'], `${w}.name`), hash: str(r['hash'], `${w}.hash`), pack: str(r['pack'], `${w}.pack`),
      fixtures: arr(r['fixtures'], `${w}.fixtures`).map((f, j) => {
        const z = obj(f, `${w}.fixtures[${j}]`);
        return { fixture: str(z['fixture'], `${w}.fixtures[${j}].fixture`), verdict: str(z['verdict'], `${w}.fixtures[${j}].verdict`), ran: z['ran'] === true, ns: num(z['ns'], `${w}.fixtures[${j}].ns`), deep_hashes: hexMap(z['deep_hashes'], `${w}.fixtures[${j}].deep_hashes`) };
      }),
    };
  });
  return { program: str(o['program'], `${what}.program`), hash: str(o['hash'], `${what}.hash`), linked, libraries, link_ns: num(o['link_ns'], `${what}.link_ns`) };
}
/** A `check` reply's receipts, after it admitted the piece. */
export function admitted(reply: JsonObject, what: string): Record<string, Checked> {
  expect(reply['ok'], `${what} admits the piece (ok: true): ${show(reply)}`).toBe(true);
  return Object.fromEntries(Object.entries(obj(reply['items'], `${what}.items`)).map(([id, v]) => [id, checkedOf(v, `${what}.items.${id}`)]));
}
/** A refusal reply (README: Refusals). */
export interface Refused { code: string; item: string | null; pack: string | null; refusals: JsonObject[] }
export function refusedOf(reply: JsonObject, what: string): Refused {
  expect(reply['ok'], `${what} is refused (ok: false): ${show(reply)}`).toBe(false);
  return {
    code: str(reply['code'], `${what}.code`),
    item: typeof reply['item'] === 'string' ? reply['item'] : null,
    pack: typeof reply['pack'] === 'string' ? reply['pack'] : null,
    refusals: arr(reply['refusals'], `${what}.refusals`).map((r, i) => obj(r, `${what}.refusals[${i}]`)),
  };
}
/** A refusal's import, as `module.name`. */
export function importOf(r: JsonObject): string | null {
  const i = r['import'];
  return isObject(i) && typeof i['module'] === 'string' && typeof i['name'] === 'string' ? `${i['module']}.${i['name']}` : null;
}

export interface Trap { item: string; step: number | null; kind: string; function: number; offset: number; library: { name: string; hash: string; function: string } | null }
export interface StepRecord { step: number; items: Record<string, { hash: string | null; fuel: number; failed: boolean }>; arrays: Record<string, JsonValue[]> }
export interface Checkpoint { step: number; deep_hash: string }
export interface Bake { items: Record<string, Checked> | null; keys: Record<string, string>; steps: StepRecord[]; checkpoints: Record<string, Checkpoint[]>; traps: Trap[]; raw: JsonObject }
function checkpointsOf(v: JsonValue | undefined, what: string): Record<string, Checkpoint[]> {
  return Object.fromEntries(Object.entries(obj(v ?? {}, what)).map(([id, list]) => [id, arr(list, `${what}.${id}`).map((c, i) => {
    const o = obj(c, `${what}.${id}[${i}]`);
    const deep = str(o['deep_hash'], `${what}.${id}[${i}].deep_hash`);
    expect(deep, `${what}.${id}[${i}].deep_hash is 16 hex digits`).toMatch(HASH64);
    return { step: int(o['step'], `${what}.${id}[${i}].step`), deep_hash: deep };
  })]));
}
/** A `bake` reply (or the web runner's `bake`): the fields this suite reads, typed. `keys` and `items` may be left out by the web runner. */
export function bakeOf(reply: JsonObject, what: string, web = false): Bake {
  expect(reply['ok'], `${what} baked the piece (ok: true): ${show(reply)}`).toBe(true);
  const steps = arr(reply['steps'], `${what}.steps`).map((s, i) => {
    const o = obj(s, `${what}.steps[${i}]`);
    const items = Object.fromEntries(Object.entries(obj(o['items'], `${what}.steps[${i}].items`)).map(([id, x]) => {
      const it = obj(x, `${what}.steps[${i}].items.${id}`);
      return [id, { hash: typeof it['hash'] === 'string' ? it['hash'] : null, fuel: int(it['fuel'], `${what}.steps[${i}].items.${id}.fuel`), failed: it['failed'] === true }];
    }));
    const arrays = Object.fromEntries(Object.entries(obj(o['arrays'] ?? {}, `${what}.steps[${i}].arrays`)).map(([k, x]) => [k, arr(x, `${what}.steps[${i}].arrays.${k}`)]));
    return { step: int(o['step'], `${what}.steps[${i}].step`), items, arrays };
  });
  const traps = arr(reply['traps'] ?? [], `${what}.traps`).map((t, i) => {
    const o = obj(t, `${what}.traps[${i}]`);
    const w = `${what}.traps[${i}]`;
    const l = o['library'];
    const library = isObject(l) ? { name: str(l['name'], `${w}.library.name`), hash: str(l['hash'], `${w}.library.hash`), function: str(l['function'], `${w}.library.function`) } : null;
    return { item: str(o['item'], `${w}.item`), step: intOrNull(o['step'], `${w}.step`), kind: str(o['kind'], `${w}.kind`), function: int(o['function'], `${w}.function`), offset: int(o['offset'], `${w}.offset`), library };
  });
  const items = web && reply['items'] === undefined ? null : Object.fromEntries(Object.entries(obj(reply['items'], `${what}.items`)).map(([id, v]) => [id, checkedOf(v, `${what}.items.${id}`)]));
  const keys = web && reply['keys'] === undefined ? {} : hexMap(reply['keys'], `${what}.keys`, DIGEST);
  return { items, keys, steps, checkpoints: checkpointsOf(reply['checkpoints'], `${what}.checkpoints`), traps, raw: reply };
}
/** The item's checkpoints as `step hash` lines. */
export const cps = (b: Bake, id: string): string[] => (b.checkpoints[id] ?? []).map((c) => `${c.step} ${c.deep_hash}`);
/** A golden's fields criterion 7 compares (532's golden). */
export function goldenOf(reply: JsonObject, what: string): { bake_key: Record<string, string>; step_hashes: Record<string, JsonValue>; checkpoint_hashes: Record<string, JsonValue> } {
  expect(reply['ok'], `${what} recorded a golden (ok: true): ${show(reply)}`).toBe(true);
  const g = obj(reply['golden'], `${what}.golden`);
  return { bake_key: hexMap(g['bake_key'], `${what}.golden.bake_key`, DIGEST), step_hashes: obj(g['step_hashes'], `${what}.golden.step_hashes`), checkpoint_hashes: obj(g['checkpoint_hashes'], `${what}.golden.checkpoint_hashes`) };
}
/** deep_query's row for each logic item (README: query). */
export function queriedOf(reply: JsonObject, what: string): Record<string, { hash: string; libraries: { name: string; hash: string }[] }> {
  expect(reply['ok'], `${what} answered (ok: true): ${show(reply)}`).toBe(true);
  return Object.fromEntries(Object.entries(obj(reply['items'], `${what}.items`)).map(([id, v]) => {
    const o = obj(v, `${what}.items.${id}`);
    return [id, { hash: str(o['hash'], `${what}.items.${id}.hash`), libraries: arr(o['libraries'], `${what}.items.${id}.libraries`).map((l, i) => { const x = obj(l, `${what}.items.${id}.libraries[${i}]`); return { name: str(x['name'], `${what}.items.${id}.libraries[${i}].name`), hash: str(x['hash'], `${what}.items.${id}.libraries[${i}].hash`) }; }) }];
  }));
}
/** The arrays of an item at a step of a bake. */
export function arraysAt(b: Bake, id: string, step: number): Record<string, JsonValue[]> {
  const s = b.steps.find((x) => x.step === step);
  expect(s, `the bake has step ${step}`).toBeDefined();
  return Object.fromEntries(Object.entries(s!.arrays).filter(([k]) => k.startsWith(`${id}.`)).map(([k, v]) => [k.slice(id.length + 1), v]));
}

// ---------------------------------------------------------------------------------------------------
// Headless Chrome: a page this test serves imports the logic module's web runner (`web_runner`'s source) and runs
// each request through its `bake` in Chrome's own WebAssembly engine, posting the replies back.

const CHROMES = [process.env['CHROME_BIN'], '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter((c): c is string => !!c);
const PAGE = `<!doctype html><meta charset="utf-8"><title>#190 web runner</title><script type="module">
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
  const chromeBin = CHROMES.find((c) => existsSync(c)) ?? blocked(`no headless Chrome at ${CHROMES.join(' or ')} (set CHROME_BIN); the web player's engine runs there`);
  const profile = mkdtempSync(join(tmpdir(), 'deep-190-chrome-'));
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
  const chrome = spawn(chromeBin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
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
