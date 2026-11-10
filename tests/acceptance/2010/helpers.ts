// Test-side tools for the #2010 acceptance tests (README: The surface under test). They extend #2009's surface: the
// same `deep-physics` binary, built once per file through ../2009/helpers.ts, asked for this suite's calls (runtime,
// play, golden, golden_verify, golden_cross) and fields (bake keys, step hashes, outputs, stores); the same binary built
// under a planted lockfile; the same binary built for Linux x86_64 in a linux/amd64 container; the build preflight
// `scripts/physics-build.mjs`; and cargo's own reading of the dependency tree and the build flags. Nothing here stands
// in for the physics module: every key, digest, hash, output, golden, report and verdict read here is the program's own;
// the expected values come from the issue's text, cargo, and the bodies' states the program bakes.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect } from 'vitest';
import {
  CARGO_ENV, REPO, TARGET, TIMEOUT, arr, blocked, box, dynamic, floor, num, obj, physicsBin, show, sphere, world, type JsonObject,
  type JsonValue, type State,
} from '../2009/helpers.ts';

export * from '../2009/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = { 1: '#2010.9300a915', 2: '#2010.fa073c97', 3: '#2010.45fbb8dc', 4: '#2010.61aa2e8e', 5: '#2010.bf531cb7' } as const;

const MIB = 1024 * 1024;
export const HEX64 = /^[0-9a-f]{64}$/;
export const HEX16 = /^[0-9a-f]{16}$/;
/** A runtime digest: hex, at least 64 bits of it. */
export const DIGEST = /^[0-9a-f]{16,128}$/;

/** This machine's CPU architecture as Rust names it, and the target a golden recorded here verifies on (Golden: the other architecture). */
export const ARCH = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : process.arch;
export const OTHER = ARCH === 'aarch64' ? 'x86_64-unknown-linux-gnu' : 'aarch64-apple-darwin';
/** The floating-point control register a step's guard reads on this machine (FPCR on arm64, MXCSR on x86_64). */
export const FP_REGISTER = ARCH === 'aarch64' ? 'FPCR' : 'MXCSR';

/** This host's target triple, as rustc names it (`rustc -vV`'s host line). */
export function hostTriple(): string {
  const r = spawnSync('rustc', ['-vV'], { cwd: REPO, encoding: 'utf8', env: { ...process.env, ...CARGO_ENV } });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') blocked('rustc isn\'t on this machine');
  const host = /^host:\s*(\S+)$/m.exec(r.stdout ?? '')?.[1];
  expect(host, `rustc -vV names its host: ${r.stdout}${r.stderr}`).toBeDefined();
  return host!;
}

// ---------------------------------------------------------------------------------------------------
// Running deep-physics: the checkout's build (../2009/helpers.ts builds it once per file), or another build of it.

/** `deep-physics --planted <name>`: each one criterion's wrong program (README: Planted twins). */
export type Planted = 'hash_rounds_1e6' | 'key_omits_frame_rate';

export interface Ask { planted?: Planted; bin?: string; where?: string }
/** Runs `calls` through one deep-physics process: exit 0, one JSON reply per call, in order. */
export function ask(calls: JsonObject[], opts: Ask = {}): JsonObject[] {
  const bin = opts.bin ?? physicsBin();
  const args = opts.planted ? ['--planted', opts.planted] : [];
  const what = `deep-physics ${args.join(' ')}${opts.where ? ` (${opts.where})` : ''}`.trim();
  const run = spawnSync(bin, args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 4096 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what} finished in time`).toBe('');
  if (run.error && code !== 'EPIPE') throw Error(`${what}: ${run.error.message}`);
  return replies(run.status, run.stdout ?? '', run.stderr ?? '', calls, what);
}
function replies(status: number | null, stdout: string, stderr: string, calls: JsonObject[], what: string): JsonObject[] {
  expect(status, `${what} exits 0; stdout: ${stdout.slice(0, 1000)}; stderr: ${stderr.slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one reply per call`).toBe(calls.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 120)})`));
}

// ---------------------------------------------------------------------------------------------------
// Calls (README: deep-physics, what this suite adds)

export const runtime = (): JsonObject => ({ call: 'runtime' });
export const play = (w: JsonObject, steps: number, frameRate: string, store: string): JsonObject => ({ call: 'play', world: w, steps, frame_rate: frameRate, store });
export const recordGolden = (w: JsonObject, steps: number, store: string, verifyOn: string[]): JsonObject => ({ call: 'golden', world: w, steps, store, verify_on: verifyOn });
export const verifyGolden = (golden: JsonObject, w: JsonObject, steps: number, extra: JsonObject = {}): JsonObject => ({ call: 'golden_verify', golden, world: w, steps, ...extra });
export const crossGolden = (golden: JsonObject, machines: JsonObject[], runs: JsonObject[]): JsonObject => ({ call: 'golden_cross', golden, machines, runs });
export const restore = (w: JsonObject, checkpoint: JsonObject, steps: number, extra: JsonObject = {}): JsonObject => ({ call: 'restore', world: w, checkpoint, steps, ...extra });
/** A one-ulp change to one body's field at a step (README: golden_verify's `shift`). */
export const shift = (step: number, id: string, field: string, ulps = 1): JsonObject => ({ step, id, field, ulps });

// ---------------------------------------------------------------------------------------------------
// Reading replies

export function answered(reply: JsonObject | undefined, what: string): JsonObject {
  expect(reply?.['ok'], `${what} answers ok: ${show(reply)}`).toBe(true);
  return reply!;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v)}`).toBe('string');
  return v as string;
}
/** A bake's key: sha256, 64 hex. */
export function keyOf(reply: JsonObject, what: string): string {
  const key = str(answered(reply, what)['key'], `${what}: key`);
  expect(key, `${what}: the bake key is a sha256`).toMatch(HEX64);
  return key;
}
/** A run's step hashes: `count` of them, index k the state after k steps (0: as built), each a u64 as 16 hex. */
export function stepHashes(reply: JsonObject, count: number, what: string): string[] {
  const hashes = arr(answered(reply, what)['step_hashes'], `${what}: step_hashes`);
  expect(hashes.length, `${what}: step_hashes holds ${count} hashes (the built state, then one per step)`).toBe(count);
  return hashes.map((h, i) => {
    expect(typeof h === 'string' && HEX16.test(h), `${what}: step_hashes[${i}] is a u64 as 16 hex, got ${show(h)}`).toBe(true);
    return h as string;
  });
}
export function goldenOf(reply: JsonObject, what: string): JsonObject {
  return obj(answered(reply, what)['golden'], `${what}: golden`);
}
export function digestOf(v: JsonValue | undefined, what: string): string {
  const d = str(v, what);
  expect(d, `${what} is a hex digest`).toMatch(DIGEST);
  return d;
}

export interface Outputs { frameRate: JsonValue | undefined; frames: number; hash: string; series: number[][] }
/** A bake's or playback's outputs, and output `id`'s series (one vec3 per frame). */
export function outputsOf(reply: JsonObject, id: string, what: string): Outputs {
  const o = obj(answered(reply, what)['outputs'], `${what}: outputs`);
  const frames = num(o['frames'], `${what}: outputs.frames`);
  const hash = str(o['hash'], `${what}: outputs.hash`);
  expect(hash.length, `${what}: outputs.hash isn't empty`).toBeGreaterThan(0);
  const series = arr(obj(o['series'], `${what}: outputs.series`)[id], `${what}: outputs.series.${id}`).map((v, k) => {
    const a = arr(v, `${what}: outputs.series.${id}[${k}]`);
    expect(a.length, `${what}: outputs.series.${id}[${k}] is a position, 3 numbers`).toBe(3);
    return a.map((x, i) => num(x, `${what}: outputs.series.${id}[${k}][${i}]`));
  });
  return { frameRate: o['frame_rate'], frames, hash, series };
}

// ---------------------------------------------------------------------------------------------------
// f32 bits

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);
export const isF32 = (x: number): boolean => Math.fround(x) === x;
export function f32Bits(x: number): number { F32[0] = x; return U32[0]!; }
/** The f32 one unit in the last place above `x` (toward +∞). */
export function nextUp(x: number): number {
  F32[0] = x;
  const b = U32[0]!;
  U32[0] = x === 0 ? 1 : x > 0 ? b + 1 : b - 1;
  return F32[0]!;
}
/** How many f32 values apart a and b are. */
export function ulpDistance(a: number, b: number): number {
  const ordered = (x: number): number => { const bits = f32Bits(x); return bits & 0x80000000 ? -(bits & 0x7fffffff) : bits; };
  return Math.abs(ordered(a) - ordered(b));
}

// ---------------------------------------------------------------------------------------------------
// Scratch folders (bake stores), removed after the file's tests.

const scratchDirs: string[] = [];
afterAll(() => { for (const d of scratchDirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
export function scratch(name: string): string {
  const d = mkdtempSync(join(tmpdir(), `deep-2010-${name}-`));
  scratchDirs.push(d);
  return d;
}

// ---------------------------------------------------------------------------------------------------
// Worlds. Fields are #2009's (its README: The world document); `outputs` is this suite's (README).

const MATERIALS = {
  block: { friction: 0.5, restitution: 0.2, density: 500 },
  ground: { friction: 0.6, restitution: 0.1, density: 1000 },
};
export const FLYER_VX = 1.5;
/**
 * Criterion 2's world: twelve 0.5 m boxes dropped in a ragged tower onto a floor, where they collide and pile up, and
 * `ball`, a flyer far from them with gravity_scale 0 moving at 1.5 m/s along +x, whose x velocity nothing changes.
 */
export function pileAndFlyer(): JsonObject {
  const bodies: JsonObject = { floor: floor('ground') };
  for (let i = 0; i < 12; i++) {
    const id = `box${String(i).padStart(2, '0')}`;
    bodies[id] = dynamic('cube', 'block', [0.04 * ((i % 3) - 1), 0.3 + 0.55 * i, 0.03 * ((i % 4) - 1.5)], { mass: 1 });
  }
  bodies['ball'] = dynamic('ball', 'block', [-20, 5, 0], { mass: 1, gravity_scale: 0, velocity: { linear: [FLYER_VX, 0, 0] } });
  return world({
    checkpoint: { every: 60 },
    contact_materials: MATERIALS,
    shapes: { floor: box([30, 0.1, 30]), cube: box([0.25, 0.25, 0.25]), ball: sphere(0.1) },
    bodies,
  });
}
/** The same world with its bodies written in reverse order (canonical creation must not see it). */
export function reversedBodies(w: JsonObject): JsonObject {
  const bodies = obj(w['bodies'], 'bodies');
  return { ...w, bodies: Object.fromEntries(Object.entries(bodies).reverse()) };
}

/**
 * Criterion 5's ball-and-goal lab (none exists in the repo; built here from #2009's shapes): a 0.11 m ball kicked from the
 * origin at (6, 3, 0.4) m/s toward a goal 8 m down +x (two posts and a crossbar, static), with one output, the ball's
 * position (Physics output: `from`, `read`).
 */
export function ballAndGoal(): JsonObject {
  const post = (z: number): JsonObject => ({ kind: 'static', shapes: [{ shape: 'post', contact_material: 'ground' }], pose: { pos: [8, 1.0, z] } });
  return world({
    contact_materials: { ...MATERIALS, leather: { friction: 0.5, restitution: 0.4, density: 80 } },
    shapes: { floor: box([30, 0.1, 30]), ball: sphere(0.11), post: box([0.06, 1.0, 0.06]), bar: box([0.06, 0.06, 1.56]) },
    bodies: {
      floor: floor('ground'),
      post_left: post(-1.5),
      post_right: post(1.5),
      crossbar: { kind: 'static', shapes: [{ shape: 'bar', contact_material: 'ground' }], pose: { pos: [8, 2.06, 0] } },
      ball: dynamic('ball', 'leather', [0, 0.11, 0], { mass: 0.43, velocity: { linear: [6, 3, 0.4] } }),
    },
    outputs: { ball: { from: 'ball', read: 'position' } },
  });
}

/** Linear interpolation of a body's position at step s + α (Physics output: positions lerp between the two steps). */
export function lerpPos(states: State[], s: number, alpha: number): number[] {
  const a = states[s]!.pos;
  if (alpha === 0) return [...a];
  const b = states[s + 1]!.pos;
  return a.map((x, i) => x + alpha * (b[i]! - x));
}

// ---------------------------------------------------------------------------------------------------
// cargo's own reading of the build (criterion 1)

/** Environment with the caller's shell flags removed: the build's flags are the checkout's and this machine's config. */
export function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...CARGO_ENV, ...extra };
  for (const k of Object.keys(env)) if (/RUSTFLAGS$/.test(k) && !(k in extra)) delete env[k];
  return env;
}
export function cargo(args: string[], env: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * MIB, env: cleanEnv(env), timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') blocked('cargo isn\'t on this machine (looked on PATH and in Homebrew\'s rustup)');
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const quiet = (stderr: string): string => stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Checking|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n').slice(-4000);

export interface Resolved { name: string; version: string; features: string[] }
/** The physics crate's resolved normal dependency tree with each package's features (`cargo tree -e normal -f '{p}|{f}'`). */
export function resolvedTree(env: NodeJS.ProcessEnv = {}): Resolved[] {
  const r = cargo(['tree', '--locked', '-p', 'deep-physics-rapier', '-e', 'normal', '--prefix', 'none', '-f', '{p}|{f}'], env);
  expect(r.status, `cargo tree runs: ${quiet(r.stderr)}`).toBe(0);
  const seen = new Map<string, Resolved>();
  for (const line of r.stdout.split('\n')) {
    const m = /^(\S+) v(\S+)(?: \([^)]*\))?\|([^ ]*)(?: \(\*\))?$/.exec(line.trim());
    if (!m) continue;
    const features = m[3] === '' ? [] : m[3]!.split(',').sort();
    seen.set(`${m[1]}@${m[2]}`, { name: m[1]!, version: m[2]!, features });
  }
  return [...seen.values()];
}
export const PINNED = ['parry3d', 'wide', 'glam', 'glamx', 'simba', 'libm'] as const;
/** The resolved versions and features of the crates the key and digest pin, sorted by name then version. */
export function pinnedOf(tree: Resolved[]): Resolved[] {
  return tree.filter((p) => (PINNED as readonly string[]).includes(p.name)).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}
/** A crate's own feature table, from `cargo metadata`. */
export function featureTable(name: string, version: string): Record<string, string[]> {
  const r = cargo(['metadata', '--locked', '--format-version', '1']);
  expect(r.status, `cargo metadata --locked runs: ${quiet(r.stderr)}`).toBe(0);
  const pkg = (JSON.parse(r.stdout) as { packages: { name: string; version: string; features: Record<string, string[]> }[] }).packages.find((p) => p.name === name && p.version === version);
  expect(pkg, `cargo metadata holds ${name} ${version}`).toBeDefined();
  return pkg!.features;
}
/** The features `start` turns on in a crate's own table (entries naming a dependency, `dep:x` or `x/f`, are the dependency's). */
export function closure(table: Record<string, string[]>, start: string[]): string[] {
  const on = new Set<string>();
  const add = (f: string): void => {
    if (on.has(f) || !(f in table)) return;
    on.add(f);
    for (const e of table[f]!) if (!e.includes('/') && !e.startsWith('dep:')) add(e);
  };
  start.forEach(add);
  return [...on].sort();
}
/** Every `rustflags` value in cargo's merged configuration for this checkout and machine (`cargo config get`). */
export function configuredRustflags(): string[] {
  const r = cargo(['-Zunstable-options', 'config', 'get', '--format', 'json'], { RUSTC_BOOTSTRAP: '1' });
  expect(r.status, `cargo config get runs (RUSTC_BOOTSTRAP=1 admits -Zunstable-options on stable): ${quiet(r.stderr)}`).toBe(0);
  const found: string[] = [];
  const walk = (v: unknown, key: string): void => {
    if (key === 'rustflags') { found.push(Array.isArray(v) ? v.join(' ') : String(v)); return; }
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(JSON.parse(r.stdout.trim() === '' ? '{}' : r.stdout), '');
  return found;
}

// ---------------------------------------------------------------------------------------------------
// The build preflight (README: scripts/physics-build.mjs)

export function preflight(args: string[] = []): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'physics-build.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * MIB, env: cleanEnv(), timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ---------------------------------------------------------------------------------------------------
// The planted lockfile (criterion 1): the checkout's Cargo.lock with wide moved one release, kept apart from the checkout's
// own lockfile and read through cargo's `resolver.lockfile-path`, given as CARGO_RESOLVER_LOCKFILE_PATH so the build's
// own build scripts and the cargo they run see it too, and deep-physics built from it in its own target folder.

export const LOCK_DIR = join(TARGET, 'acceptance-2010-lock');
export const lockEnv = (lock: string): NodeJS.ProcessEnv => ({ CARGO_RESOLVER_LOCKFILE_PATH: lock });
/** Writes the planted lockfile with wide at `version`; BLOCKED when crates.io can't be reached to move it. */
export function plantLockfile(version: string): string {
  mkdirSync(LOCK_DIR, { recursive: true });
  const lock = join(LOCK_DIR, 'Cargo.lock');
  copyFileSync(join(REPO, 'Cargo.lock'), lock);
  const r = cargo(['update', '-p', 'wide', '--precise', version], lockEnv(lock));
  if (r.status !== 0) blocked(`the planted lockfile moves wide to ${version} through crates.io's index, which cargo couldn't reach or resolve: ${quiet(r.stderr)}`);
  return lock;
}
/** Builds deep-physics from `lock` into its own target folder and copies the binary out. */
export function buildFromLock(lock: string): string {
  const target = join(LOCK_DIR, 'target');
  const r = cargo(['build', '--locked', '--bin', 'deep-physics'], { ...lockEnv(lock), CARGO_TARGET_DIR: target });
  expect(r.status, `deep-physics builds from the planted lockfile: ${quiet(r.stderr)}`).toBe(0);
  const out = scratch('lock-bin');
  copyFileSync(join(target, 'debug', 'deep-physics'), join(out, 'deep-physics'));
  return join(out, 'deep-physics');
}

// ---------------------------------------------------------------------------------------------------
// The second machine (criterion 3): the same checkout built for linux/amd64 in Docker with the rust image of the
// toolchain rust-toolchain.toml names, its caches under target/acceptance-2010-linux/, as #532's suite does. Nothing is
// pulled: a missing Docker or image is BLOCKED; a build that fails is a failure.

/** An emulated Linux build of Rapier and its math crates takes long; this test's own timeout. */
export const LINUX_TIMEOUT = 3 * 3_600_000;
const LINUX = join(TARGET, 'acceptance-2010-linux');
export function linuxImage(): string {
  const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1];
  if (!channel) throw Error('rust-toolchain.toml names no channel');
  return `rust:${channel}-slim-bookworm`;
}
function docker(args: string[], input?: string, timeoutMs = 600_000): { status: number | null; stdout: string; stderr: string; timedOut: boolean } {
  const run = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) });
  const timedOut = (run.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  if (run.error && !timedOut) return { status: null, stdout: '', stderr: run.error.message, timedOut };
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '', timedOut };
}
function hasAmd64(image: string): boolean {
  const perPlatform = docker(['image', 'inspect', '--platform', 'linux/amd64', '--format', '{{.Architecture}}', image], undefined, 30_000);
  if (perPlatform.status === 0 && perPlatform.stdout.trim() === 'amd64') return true;
  return docker(['image', 'inspect', '--format', '{{.Architecture}}', image], undefined, 30_000).stdout.trim() === 'amd64';
}
let linuxBuilt: string | undefined;
function linuxPhysics(): void {
  if (linuxBuilt === undefined) {
    const info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 30_000);
    if (info.status !== 0) blocked(`Docker is unreachable (docker info: ${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); the second machine, Linux x86_64, runs in a linux/amd64 container`);
    const image = linuxImage();
    if (!hasAmd64(image)) blocked(`Docker has no linux/amd64 image ${image} here and this suite pulls nothing; run: docker pull --platform linux/amd64 ${image}`);
    for (const d of ['target', 'registry', 'git']) mkdirSync(join(LINUX, d), { recursive: true });
    const build = docker([
      'run', '--rm', '--platform', 'linux/amd64',
      '-v', `${REPO}:/src:ro`, '-v', `${join(LINUX, 'target')}:/target`,
      '-v', `${join(LINUX, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(LINUX, 'git')}:/usr/local/cargo/git`,
      '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${image.replace(/^rust:/, '').replace(/-slim-bookworm$/, '')}`,
      '-e', `CARGO_INCREMENTAL=${CARGO_ENV['CARGO_INCREMENTAL']}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${CARGO_ENV['CARGO_PROFILE_DEV_DEBUG']}`,
      image, 'cargo', 'build', '--locked', '--bin', 'deep-physics',
    ], undefined, LINUX_TIMEOUT - 1_200_000);
    linuxBuilt = build.status === 0 ? '' : `cargo build --locked --bin deep-physics in ${image} (linux/amd64) failed${build.timedOut ? ' (timed out)' : ''}:\n${build.stderr.slice(-4000)}`;
  }
  expect(linuxBuilt, 'deep-physics builds for Linux x86_64').toBe('');
}
/** Runs `calls` through one deep-physics process in a linux/amd64 container. */
export function onLinux(calls: JsonObject[]): JsonObject[] {
  linuxPhysics();
  const text = `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`;
  const r = docker(['run', '--rm', '-i', '--platform', 'linux/amd64', '-v', `${join(LINUX, 'target')}:/target:ro`, linuxImage(), '/target/debug/deep-physics'], text, 1_800_000);
  expect(r.timedOut ? 'timed out' : '', 'deep-physics on linux/amd64 finished in time').toBe('');
  return replies(r.status, r.stdout, r.stderr, calls, 'deep-physics on linux/amd64');
}

