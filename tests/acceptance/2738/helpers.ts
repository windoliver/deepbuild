// Test-side tools for the #2738 acceptance tests (README): cargo's own reading of the dependency graph on this machine
// (criterion 2); the checkout built in a linux/amd64 container of the rust image rust-toolchain.toml names (criterion
// 1); and the GPU layer's `deep-gpu` drawing a scene through `view3d` (criterion 3). Nothing here stands in for the
// build, the graph or the renderer: every exit status, tree, row and pixel hash read here is cargo's or the program's
// own, and every expected value comes from the issue's text.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2738 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
export const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
const MIB = 1024 * 1024;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const AC = { 1: 'AC1 #2738.a13e05b2', 2: 'AC2 #2738.4e863912', 3: 'AC3 #2738.99312f73' } as const;

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
/** A test that can't be judged here fails with this, never passes. */
export const inconclusive = (why: string): never => { throw Error(`INCONCLUSIVE: ${why}; this is not a pass`); };
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** cargo's and docker's output without progress lines and QEMU's jemalloc notices, its tail. */
const quiet = (text: string, keep = 4000): string =>
  text.split('\n').filter((l) => !/^\s*(Blocking waiting|Compiling|Checking|Finished|Downloaded|Downloading|Updating|Locking|Fetching|Adding|Skipping|<jemalloc>)\b|^<jemalloc>/.test(l)).join('\n').slice(-keep);

// ---------------------------------------------------------------------------------------------------
// Criterion 2: `cargo tree --locked -e normal,build -i meshopt`, run on this machine in the checkout.

export interface Run { status: number | null; stdout: string; stderr: string }
export function cargo(args: string[]): Run {
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * MIB, env: { ...process.env, ...CARGO_ENV }, timeout: 1_800_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') blocked(`cargo isn't on this machine (looked on PATH and in ${RUSTUP_BIN})`);
  if (r.error) throw Error(`cargo ${args.join(' ')}: ${r.error.message}`);
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
/** cargo's answer when the package `-i` names isn't in the selected graph at all: no path from anything. */
const NOT_IN_GRAPH = /package ID specification `meshopt` did not match any packages/;
/**
 * What's wrong with one `cargo tree -i meshopt` run: the inverted tree names deep-physics-rapier (a path from it to
 * meshopt), or cargo failed for any reason but meshopt being absent from the graph. Empty when there is no path.
 */
export function pathsFromPhysics(r: Run, command: string): string[] {
  if (r.status !== 0) return NOT_IN_GRAPH.test(r.stderr) ? [] : [`${command} failed (exit ${r.status}), so it shows nothing: ${quiet(r.stderr)}`];
  const tree = r.stdout.split('\n').map((l) => l.replace(/ \(\/[^)]*\)/, ''));
  const hits = tree.filter((l) => /(^|[\s─│├└])deep-physics-rapier v/.test(l));
  return hits.length === 0 ? [] : [`${command} shows a path from deep-physics-rapier to meshopt:\n${tree.join('\n').trim()}`];
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1: the checkout built in a linux/amd64 container of `rust:<rust-toolchain.toml's channel>-slim-bookworm`,
// mounted read-only, its caches under target/acceptance-2738-linux/, one job at a time (the emulated VM has 4 CPUs and
// about 6 GB, which other sessions' containers share). Nothing is pulled: no Docker or no linux/amd64 image is BLOCKED;
// a build that fails is a failure.

/** Two emulated cold builds of Rapier and its math crates take hours under QEMU on this Mac; the test's own timeout. */
export const LINUX_TIMEOUT = 6 * 3_600_000;
const BUILD_TIMEOUT = 2.75 * 3_600_000;
const LINUX = join(TARGET, 'acceptance-2738-linux');
export const channel = (): string => {
  const c = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1];
  if (!c) throw Error('rust-toolchain.toml names no channel');
  return c;
};
export const linuxImage = (): string => `rust:${channel()}-slim-bookworm`;

function docker(args: string[], timeoutMs: number, name?: string): Run & { timedOut: boolean } {
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  // A killed client leaves its container running: remove the one this run named.
  if (timedOut && name) spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8', timeout: 120_000 });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') blocked('docker isn\'t on this machine; the build runs in a linux/amd64 container');
  if (r.error && !timedOut) return { status: null, stdout: '', stderr: r.error.message, timedOut };
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut };
}
/** The image, after checking Docker answers and holds its linux/amd64 variant; BLOCKED otherwise, naming the pull. */
export function linuxReady(): string {
  const info = docker(['info', '--format', '{{.ServerVersion}}'], 60_000);
  if (info.status !== 0) blocked(`Docker is unreachable (docker info: ${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); the builds run in a linux/amd64 container`);
  const image = linuxImage();
  const arch = docker(['image', 'inspect', '--platform', 'linux/amd64', '--format', '{{.Architecture}}', image], 60_000);
  if (arch.status !== 0 || arch.stdout.trim() !== 'amd64') blocked(`Docker has no linux/amd64 image ${image} here and this suite pulls nothing; run: docker pull --platform linux/amd64 ${image}`);
  return image;
}
const RUN = ['run', '--rm', '--pull', 'never', '--platform', 'linux/amd64'];
/** The C++ compilers the image holds: the criterion's premise is that it holds none. */
export function cxxIn(image: string): string[] {
  const r = docker([...RUN, image, 'sh', '-c', 'for t in c++ g++ clang++; do command -v "$t" || true; done'], 600_000);
  expect(r.status, `the image answers which compilers it holds: ${quiet(r.stderr)}`).toBe(0);
  return r.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('/'));
}
let runs = 0;
/** `cargo <args>` in /src, the checkout, inside the container; '' when it succeeds, else what failed. */
export function linuxCargo(image: string, args: string[]): string {
  for (const d of ['target', 'registry', 'git']) mkdirSync(join(LINUX, d), { recursive: true });
  const name = `deep-2738-${process.pid}-${runs++}`;
  const command = `cargo ${args.join(' ')}`;
  const r = docker([
    ...RUN, '--name', name,
    '-v', `${REPO}:/src:ro`, '-v', `${join(LINUX, 'target')}:/target`,
    '-v', `${join(LINUX, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(LINUX, 'git')}:/usr/local/cargo/git`,
    '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${channel()}`, '-e', 'CARGO_BUILD_JOBS=1',
    '-e', `CARGO_INCREMENTAL=${CARGO_ENV['CARGO_INCREMENTAL']}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${CARGO_ENV['CARGO_PROFILE_DEV_DEBUG']}`,
    image, 'cargo', ...args,
  ], BUILD_TIMEOUT, name);
  if (r.status === 0) return '';
  if (/Could(n't| not) resolve host|failed to download|network failure|spurious network error/i.test(r.stderr)) {
    blocked(`${command} in ${image} couldn't reach crates.io or a git source: ${quiet(r.stderr, 1500)}`);
  }
  // The emulated toolchain killed (137: the VM's memory) or crashing says nothing of the program; still not a pass.
  const crashed = r.status === 137 || /internal compiler error: Segmentation fault|signal: (9, SIGKILL|11, SIGSEGV)/.test(r.stderr);
  return `${crashed ? 'INCONCLUSIVE: the emulated toolchain was killed or crashed; ' : ''}${command} in ${image} (linux/amd64) failed${r.timedOut ? ` (timed out after ${BUILD_TIMEOUT / 3_600_000} h)` : ` (exit ${r.status})`}:\n${quiet(r.stderr)}`;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: `deep-gpu run`, the GPU layer's scenario runner (#377), drawing a scene document through `view3d` (#378)
// with `lod: true` (#425's level-of-detail rows), built once per file and copied out of the target folder.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const GPU_BUILD = ['build', '--locked', '--bin', 'deep-gpu'];
/** Builds deep-gpu before the file's tests; a test that uses it after a failed build fails with cargo's error. */
export function useGpu(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2738-bin-'));
    const r = cargo(GPU_BUILD);
    if (r.status === 0) copyFileSync(join(TARGET, 'debug', exe('deep-gpu')), join(dir, exe('deep-gpu')));
    else error = `cargo ${GPU_BUILD.join(' ')} failed:\n${quiet(r.stderr)}`;
  }, 3 * 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    expect(error, 'deep-gpu builds').toBe('');
    return join(dir, exe('deep-gpu'));
  };
}
/** A fresh temporary folder per test (documents, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-2738-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
/** The renderer draws on macOS's Metal device here; elsewhere this suite can't judge it. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws on macOS's Metal device; this is ${process.platform}`);
}

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${shown(v)}`).toBe(true);
  return v as JsonObject;
}
function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${shown(v)}`).toBe(true);
  return v as JsonValue[];
}
/** One `deep-gpu run` process: the calls in order, one reply per call, each answered (not refused). */
export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 512 * MIB, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = (run.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`deep-gpu run: ${run.error.message}`);
  expect(timedOut, 'deep-gpu run finished within its timeout').toBe(false);
  const stdout = run.stdout ?? '';
  expect(run.status, `deep-gpu run exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-gpu run: one output line per input line').toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-gpu run: the answer');
  expect(answer['ok'], `deep-gpu run refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'deep-gpu run: replies').map((r, i) => obj(r, `deep-gpu run: replies[${i}]`));
  expect(replies.length, 'deep-gpu run: one reply per call').toBe(calls.length);
  for (const [i, r] of replies.entries()) {
    if (r['code'] === 'unsupported_platform') inconclusive(`view3d call ${i} reports unsupported_platform`);
    expect(r['code'], `view3d call ${i} was answered, not refused: ${shown(r)}`).toBeUndefined();
  }
  return replies;
}
/** One drawn frame's pixel hash and its `lod` row for `item`, as view3d reports them. */
export interface Drawn { pixelHash: JsonValue | undefined; row: JsonObject | undefined; frame: JsonObject }
export function drawnItem(reply: JsonObject, item: string, what: string): Drawn {
  const frames = arr(reply['frames'], `${what}: frames`);
  expect(frames.length, `${what}: one frame`).toBe(1);
  const frame = obj(frames[0], `${what}: frame 0`);
  const rows = frame['lod'] === undefined ? [] : arr(frame['lod'], `${what}: frame 0's lod`);
  const row = rows.find((r) => isObject(r) && r['item'] === item) as JsonObject | undefined;
  return { pixelHash: frame['pixel_hash'], row, frame };
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

/** A physical-basis `look@1`, filmic at exposure 0 (the shape #425's suite draws its scenes with). */
export const LOOK: JsonObject = {
  id: 'look-2738', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'The #2738 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
  status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
  min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};
export const SIZE: [number, number] = [320, 240];

/**
 * The criterion's scene: a 64-segment `ball@1` of radius 1 m at the origin, 4 m from a 40° camera (about 165 px
 * across), lit by a sun, whose `lod` has one band, `show: proxy` with `ratio` 0.25, below `belowPx`. With a threshold
 * far above its size the ball draws its proxy band; far below it, its full band. Nothing else differs.
 */
export function ballScene(belowPx: number): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 0.5, 4], target: [0, 0, 0], fov: 40, near: 0.1, far: 100 } },
    clay: { kind: 'material@1', params: { base_color: [0.8, 0.35, 0.2, 1], roughness: 0.5 } },
    ball: {
      kind: 'ball@1', params: { radius: 1, segments: 64 }, at: { pos: [0, 0, 0] }, material: 'clay',
      lod: { bands: [{ below_px: belowPx, show: 'proxy', params: { ratio: 0.25 } }] },
    },
    sun: { kind: 'light.sun@1', params: { illuminance: 1, color: [1, 1, 1], shadow: false }, at: { rot: [-45, 30, 0] } },
  };
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${order++}`, layer: 'main', ...item };
  return {
    format: 1, id: 'proxy-2738', profile: 'scene', title: 'proxy-2738', description: 'A #2738 acceptance fixture.', size: SIZE,
    camera: 'cam', transport: { span: '1s' }, requires: { modules: { scene3d: '^1' } }, budget: { class: 'work_product' },
    layers: { main: { writer: 'agent:sess-alpha', title: 'main', order: 'a0' } }, items: withIds,
  };
}
export const view3d = (doc: string): JsonObject => ({ call: 'view3d', doc, look: LOOK, size: SIZE, frames: 1, lod: true });
