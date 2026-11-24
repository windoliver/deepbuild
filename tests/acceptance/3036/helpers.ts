// Test-side tools for the #3036 acceptance tests: `deep-show` (#393's scenario binary, the full set) and `deep-gpu`
// (#377's binary, with #378's `view3d`), each built once per file and driven by JSON lines, and the readers that turn
// a reply into what a judge takes. The numbers and the judges are in judges.ts and the documents and calls in
// fixtures.ts, neither of which holds anything of the test runner; both are exported again from here. Nothing in the
// three files stands in for the plate, its tracks, the physics module or the renderer: every height, step hash, body
// state, issue and pixel hash a test compares comes from a binary, every expected value from the issue's text and the
// fixtures' own numbers. Suites don't import each other, so the build and the runners repeat what #2014's, #2017's and
// #166's helpers do.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect, vi } from 'vitest';
import { scenarioOf, type GpuPlanted, type ShowPlanted } from './fixtures.ts';
import type { Height, JsonObject, JsonValue, Probe, V3 } from './judges.ts';

export * from './judges.ts';
export * from './fixtures.ts';

vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/3036 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Every `it` passes a timeout: a first build takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON and verdict words

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${brief(v)}`).toBe(true);
  return v as number;
}
export function v3(v: JsonValue | undefined, what: string): V3 {
  const a = arr(v, what);
  expect(a.length, `${what} holds three numbers`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[0-9a-f]{64}$/;
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 12).join('\n  ')}`).toEqual([]);
}
/** A planted program's check: the judge its shipped twin passes found failures, and every word the criterion says a failure names is in them. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails the check its shipped twin passes`).toBeGreaterThan(0);
  const text = failures.join('\n');
  for (const n of names) expect(text, `${what}'s failure names ${n}`).toContain(n);
}
/** What can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** What the suite needs and the machine lacks fails with this, never passes (the issue's Runs on line). */
export function blocked(reason: string): never {
  return expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// The machine (the issue's Runs on line): the drawn surface's heights read on any machine; the pixel hashes on a Mac
// of a reference model; without a GPU those read BLOCKED.

/** The frames are drawn on macOS's GPU device: anywhere else, BLOCKED. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') blocked(`the frames are drawn on macOS's GPU device, and this is ${process.platform}: no GPU to draw them on`);
}
/**
 * The pixel hashes count on a Mac of a reference model, as the perf lane's own scripts/benchmark.mjs lists them and
 * reads this machine (in a child process: the suite imports nothing of the lane). With no GPU, BLOCKED; on any other
 * Mac the hashes are a reading, INCONCLUSIVE.
 */
export function requireReferenceMac(): void {
  requireGpu();
  const script = `import * as b from ${JSON.stringify(join(REPO, 'scripts', 'benchmark.mjs'))};\nprocess.stdout.write(JSON.stringify({ model: b.fingerprint().model, models: b.references.map((r) => r.model) }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) inconclusive(`this machine's model couldn't be read through scripts/benchmark.mjs: ${(r.stderr ?? '').slice(-600)}`);
  const read = JSON.parse(r.stdout) as { model: string | null; models: string[] };
  if (read.model === null || !read.models.includes(read.model)) inconclusive(`the pixel hashes count on a Mac of a reference model (${read.models.join(', ')}), and this is ${String(read.model)}`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file and copied out of the target folder.

export type Bin = 'deep-show' | 'deep-gpu';
const FEATURES: Record<Bin, string[]> = { 'deep-show': ['--no-default-features', '--features', 'full'], 'deep-gpu': [] };
const cargoArgs = (bin: Bin): string[] => ['build', '--locked', '--bin', bin, ...FEATURES[bin]];
const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
const targetDir = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));

/**
 * Builds the listed binaries before the file's tests (debug info and incremental builds off unless the caller set
 * them); a test whose build failed fails with cargo's error, and with no cargo at all it is BLOCKED.
 */
export function useBins(bins: readonly Bin[]): (bin: Bin) => string {
  let dir = '';
  const made = new Map<Bin, { path: string; error: string; missing: boolean }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-3036-bin-'));
    const path = [...(existsSync(TOOLCHAIN) ? [TOOLCHAIN] : []), ...(existsSync('/opt/homebrew/opt/rustup/bin') ? ['/opt/homebrew/opt/rustup/bin'] : []), process.env['PATH'] ?? ''].join(delimiter);
    const env = { ...process.env, PATH: path, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
    for (const bin of bins) {
      const args = cargoArgs(bin);
      const r = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (r.error) { made.set(bin, { path: '', error: `cargo could not run: ${r.error.message}`, missing: true }); continue; }
      if (r.status !== 0) {
        const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
        made.set(bin, { path: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}`, missing: false });
        continue;
      }
      const out = join(dir, bin);
      copyFileSync(join(targetDir(), 'debug', bin), out);
      made.set(bin, { path: out, error: '', missing: false });
    }
  }, 2 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (bin: Bin): string => {
    const m = made.get(bin);
    if (!m) throw Error(`the file didn't list ${bin} in useBins`);
    if (m.missing) blocked(m.error);
    expect(m.error, `the binary builds: cargo ${cargoArgs(bin).join(' ')}`).toBe('');
    return m.path;
  };
}
/** Fresh folders for a test (evidence stores, a renderer's output), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-3036-')); made.push(d); return d; };
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** One `deep-show run` process: the documents on the panel (each shown by a call), the calls, and a planted program; its replies, one per call. */
export function runShow(bin: string, evidence: string, docs: readonly string[], calls: JsonObject[], planted?: ShowPlanted): JsonObject[] {
  const names = calls.map((c) => String(c['call']));
  const label = `deep-show run (its calls ${names.join(', ')}${planted ? `, its planted program ${planted}` : ''})`;
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenarioOf(evidence, docs, calls, planted))}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within 3,000 s`);
  if (r.error) throw Error(`${label}: ${r.error.message}`);
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${label}: one output line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${label}: the answer`);
  expect(out['ok'], `${label} accepted the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${label}: replies`).map((v, i) => obj(v, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(calls.length);
  return replies;
}

/** Why a show isn't presented: an item skipped as a kind the build doesn't know, an error the check raised, or another outcome. */
export function presentedFailures(reply: JsonObject): string[] {
  const notices = Array.isArray(reply['notices']) ? reply['notices'].filter(isObject) : [];
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  return [
    ...[...notices, ...issues].filter((n) => n['code'] === 'unknown_kind').map((n) => `an item is skipped as a kind the build doesn't know: ${brief(n, 600)}`),
    ...issues.filter((i) => i['severity'] === 'error').map((i) => `the check raises an error: ${brief(i, 600)}`),
    ...(reply['outcome'] === 'presented' ? [] : [`the show's outcome is ${brief(reply['outcome'])}, not presented: ${brief(reply, 1500)}`]),
  ];
}
/** The show was presented: no error issue, and no item skipped. */
export const presented = (reply: JsonObject, what: string): void => none(presentedFailures(reply), `${what} is presented`);

/** One ray's answers: the heights it met the drawn surface and the physics shape at, each null when it met nothing. */
export interface Met { drawn: number | null; physics: number | null }
/** A `terrain_rays` reply's rays, one per probe, in order; a point a ray met lies on the ray (within 1e-6 m in x and z). */
export function metOf(reply: JsonObject, probes: readonly Probe[], what: string): Met[] {
  expect(reply['code'], `${what}: terrain_rays answers: ${brief(reply)}`).toBeUndefined();
  const rays = arr(reply['rays'], `${what}: rays`);
  expect(rays.length, `${what}: one answer per ray`).toBe(probes.length);
  return rays.map((v, k) => {
    const o = obj(v, `${what}: rays[${k}]`);
    const y = (key: 'drawn' | 'physics'): number | null => {
      expect(key in o, `${what}: rays[${k}] has ${key} (a point, or null)`).toBe(true);
      if (o[key] === null) return null;
      const p = v3(o[key], `${what}: rays[${k}].${key}`);
      expect(Math.abs(p[0] - probes[k]!.x) <= 1e-6 && Math.abs(p[2] - probes[k]!.z) <= 1e-6, `${what}: rays[${k}].${key} (${p.join(', ')}) lies on the ray down through (${probes[k]!.x}, ${probes[k]!.z})`).toBe(true);
      return p[1];
    };
    return { drawn: y('drawn'), physics: y('physics') };
  });
}
/** The drawn surface's height at each probe. */
export const drawnOf = (met: readonly Met[], probes: readonly Probe[]): Height[] => probes.map((p, k) => ({ ...p, y: met[k]!.drawn }));

/** An item's evaluated places from a deep_query reply, one per time asked. */
export function placesOf(reply: JsonObject, path: string, count: number): V3[] {
  expect(reply['code'], `the query answers: ${brief(reply)}`).toBeUndefined();
  const rows = arr(obj(reply['values'], 'the query\'s values')[path], `values[${path}]`);
  expect(rows.length, `${path}: one place per time asked`).toBe(count);
  return rows.map((v, k) => v3(v, `${path} at time ${k}`));
}

/** A `world` reply: the bake's step hashes, index k after k steps, and each body's position after each step. */
export interface Bake { hashes: string[]; paths: Record<string, V3[]> }
export function bakeOf(reply: JsonObject, bodies: readonly string[], what: string): Bake {
  expect(reply['ok'], `${what}: the world bakes: ${brief(reply)}`).toBe(true);
  const hashes = arr(reply['step_hashes'], `${what}: step_hashes`).map((h, k) => { expect(typeof h, `${what}: step_hashes[${k}] is a string`).toBe('string'); return h as string; });
  const all = obj(reply['bodies'], `${what}: bodies`);
  const paths: Record<string, V3[]> = {};
  for (const id of bodies) paths[id] = arr(all[id], `${what}: bodies.${id}`).map((s, k) => v3(obj(s, `${what}: bodies.${id}[${k}]`)['pos'], `${what}: bodies.${id}[${k}].pos`));
  return { hashes, paths };
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario `{out, calls}` in, one line out, one reply per call (#377).

export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: GpuPlanted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const label = `deep-gpu ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within 3,000 s`);
  // A binary that refuses its arguments (an unknown --planted) exits before reading its input: its exit is judged below.
  if (r.error && (r.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${label}: ${r.error.message}`);
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${label}: one output line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${label}: its line is JSON: ${lines[0]!.slice(0, 1500)}`); }
  const a = obj(answer, `${label}: the answer`);
  expect(a['ok'], `${label} accepted the scenario: ${brief(a, 3000)}`).toBe(true);
  const replies = arr(a['replies'], `${label}: replies`).map((x, i) => obj(x, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(calls.length);
  return replies;
}
/** A `view3d` reply's frames by index: each one's pixel hash. A reply that says the platform has no GPU to draw on is BLOCKED; any other refusal fails. */
export function hashesOf(reply: JsonObject, what: string): Map<number, string> {
  if (reply['code'] === 'unsupported_platform' || reply['code'] === 'gpu_unavailable') blocked(`${what}: view3d answers ${String(reply['code'])}: no GPU to draw on`);
  expect(reply['code'], `${what}: view3d is answered, not refused: ${brief(reply)}`).toBeUndefined();
  const out = new Map<number, string>();
  arr(reply['frames'], `${what}: frames`).forEach((v, i) => {
    const row = obj(v, `${what}: frames[${i}]`);
    expect(row['pixel_hash'], `${what}: frames[${i}].pixel_hash is a SHA-256`).toMatch(SHA);
    out.set(num(row['frame'], `${what}: frames[${i}].frame`), row['pixel_hash'] as string);
  });
  expect(out.size, `${what}: the reply holds frames`).toBeGreaterThan(0);
  return out;
}
/** One frame's pixel hash. */
export function hashAt(reply: JsonObject, n: number, what: string): string {
  const h = hashesOf(reply, what).get(n);
  expect(h, `${what}: frame ${n} is in the reply`).toBeDefined();
  return h!;
}
/** A captured frame's final target: the PNG the renderer wrote under `out`, named by its SHA-256, byte for byte. */
export function finalOf(reply: JsonObject, out: string, n: number, what: string): Buffer {
  hashesOf(reply, what);
  const row = arr(reply['frames'], `${what}: frames`).filter(isObject).find((r) => r['frame'] === n);
  expect(row, `${what}: frame ${n} is in the reply`).toBeDefined();
  expect(row!['final'], `${what}: frame ${n}'s final target is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${String(row!['final'])}.png`));
  expect(sha256(file), `${what}: the final target's file hashes to its name`).toBe(row!['final']);
  return file;
}
