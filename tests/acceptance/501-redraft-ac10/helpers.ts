// Test-side tools for the blind redraft of #501's AC10: `deep-show` built once with `full` on this Mac and driven by
// one JSON scenario on stdin (`deep-show run`, #393's convention), with the startup `--planted <name>` argument (#200's);
// the evidence store; 16-bit WAV assets written here and float WAVs read back; the fixture film's sound; and the Linux
// x86_64 leg in a linux/amd64 container. Copied from the first draft (tests/acceptance/501/helpers.ts at c8542532) where
// it still applies; the Linux leg is redrafted (README: What changed). Nothing here stands in for the mixer or the check.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/501-redraft-ac10 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const targetOf = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));

/** Every `it` passes this: a first cargo build, and one under emulation, can take many minutes. */
export const TIMEOUT = 7_200_000;
/** The criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC10 = 'AC10 #501.187057b7';

// ---------------------------------------------------------------------------------------------------
// JSON and verdict prefixes

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 600)}`).toBe('string');
  return v as string;
}
export function hex64(v: JsonValue | undefined, what: string): string {
  const s = str(v, what);
  expect(/^[0-9a-f]{64}$/.test(s), `${what} is 32 bytes in lower-case hex, got ${s}`).toBe(true);
  return s;
}
/** The leg never ran to an answer: never a pass (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A platform need is missing here: never a pass. */
export function blocked(reason: string): never {
  return expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.slice(0, 8).join(' | ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// This Mac: `cargo build --locked --bin deep-show --no-default-features --features full` once per file, copied out of
// the target folder; a test that uses a build that failed fails with cargo's error.

export const FULL = 'full';

function buildTo(features: string, to: string): string {
  const args = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', features];
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(-4000)}`;
  copyFileSync(join(targetOf(), 'debug', SHOW), to);
  return '';
}
/** The macOS arm64 side. Off macOS arm64 the criterion's first machine is missing: BLOCKED, before any build. */
export function useMacShow(): () => string {
  let dir = '';
  let built: { bin: string; error: string } | undefined;
  beforeAll(() => {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') return;
    dir = mkdtempSync(join(tmpdir(), 'deep-501r-bins-'));
    const bin = join(dir, `${SHOW}-${FULL}`);
    built = { bin, error: buildTo(FULL, bin) };
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    if (!built) blocked(`this host is ${process.platform}/${process.arch}; the criterion's first machine is macOS arm64`);
    expect(built.error, `the binary builds: ${SHOW} with features ${FULL}`).toBe('');
    return built.bin;
  };
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (README: The surface under test)

interface Ran { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
const plantedArgs = (planted?: string): string[] => (planted ? ['--planted', planted] : []);
const parseLines = (stdout: string): JsonValue[] => stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
/** `deep-show run [--planted p]` on this Mac: exit 0, one answer line, ok, one reply per call. */
export function runShow(bin: string, sc: JsonObject, what: string, planted?: string): JsonObject[] {
  const r = spawnSync(bin, ['run', ...plantedArgs(planted)], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  return repliesOf({ status: r.status, signal: r.signal, timedOut, lines: parseLines(stdout), stdout, stderr: r.stderr ?? '' }, sc, planted ? `${what} (--planted ${planted})` : what);
}
function repliesOf(s: Ran, sc: JsonObject, what: string): JsonObject[] {
  expect(s.timedOut, `${what}: deep-show run finished within its timeout`).toBe(false);
  expect(s.status, `${what}: deep-show run exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 800)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${what}: one answer line`).toBe(1);
  const out = obj(s.lines[0], `${what}: the answer`);
  expect(out['ok'], `${what}: deep-show run answers the scenario ok; got ${show(out)}`).toBe(true);
  const replies = arr(out['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The evidence store (#15's layout: `<2 hex>/<62 hex>`, each file named by its bytes' SHA-256)

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
export function getEvidence(evidence: string, h: string, what: string): Buffer {
  const path = join(evidence, h.slice(0, 2), h.slice(2));
  expect(existsSync(path), `${what}: the evidence store holds ${h}`).toBe(true);
  const bytes = readFileSync(path);
  expect(sha256(bytes), `${what}: the stored file hashes to its name`).toBe(h);
  return bytes;
}

// ---------------------------------------------------------------------------------------------------
// Sound: 16-bit WAV assets written here; float WAVs read back; the fixture film's sound.

export function wav16(channels: Float32Array[], rate = 48_000): Buffer {
  const nch = channels.length; const frames = channels[0]!.length; const data = frames * nch * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(nch, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * nch * 2, 28); b.writeUInt16LE(nch * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) for (const c of channels) { b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, c[i]!)) * 32767), o); o += 2; }
  return b;
}
export function tone(hz: number, frames: number, amp: number, rate = 48_000): Float32Array {
  const x = new Float32Array(frames);
  for (let i = 0; i < frames; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  return x;
}
/** A float or 16-bit PCM WAV's samples per channel. */
export function readWav(bytes: Buffer, what: string): { rate: number; channels: Float32Array[] } {
  expect(bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE', `${what} is a RIFF WAVE file`).toBe(true);
  let fmt: { tag: number; nch: number; rate: number; bits: number } | null = null; let data: Buffer | null = null;
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', o, o + 4); const size = bytes.readUInt32LE(o + 4); const body = bytes.subarray(o + 8, Math.min(bytes.length, o + 8 + size));
    if (id === 'fmt ') { let tag = body.readUInt16LE(0); if (tag === 0xfffe && body.length >= 26) tag = body.readUInt16LE(24); fmt = { tag, nch: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) }; } else if (id === 'data') data = body;
    o += 8 + size + (size % 2);
  }
  expect(fmt !== null && data !== null, `${what} has fmt and data chunks`).toBe(true);
  const { tag, nch, rate, bits } = fmt!;
  expect((tag === 3 && bits === 32) || (tag === 1 && bits === 16), `${what} is float 32-bit or PCM 16-bit, got format ${tag} at ${bits} bits`).toBe(true);
  const width = bits / 8; const frames = Math.floor(data!.length / (width * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++) { const o = (i * nch + c) * width; channels[c]![i] = tag === 3 ? data!.readFloatLE(o) : data!.readInt16LE(o) / 32768; }
  return { rate, channels };
}

const FLICKS = 705_600_000;
/** Whole seconds (or a fraction that is a whole number of flicks) as flicks. */
export function fl(seconds: number): number {
  const f = Math.round(seconds * FLICKS);
  if (Math.abs(f - seconds * FLICKS) > 1e-3) throw Error(`${seconds} s is not a whole number of flicks`);
  return f;
}
/** The fixture film's sound as a media document (#499's `media_mix` document): two tones, panned. */
export function filmSound(a: string, b: string): JsonObject {
  return {
    transport: { sample_rate: 48_000, span: fl(4) },
    strips: {
      left: { track: 1, src: { asset: a }, start: 0, in: 0, out: fl(4), pan: -0.4 },
      right: { track: 2, src: { asset: b }, start: fl(0.5), in: 0, out: fl(3), pan: 0.6 },
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Linux x86_64: the same checkout built with `full` for linux/amd64 in Docker (the design's other architecture for CPU
// checks, recorded as emulated), its caches under target/acceptance-501-linux/. The leg's platform needs are probed
// first and a missing one is BLOCKED, never FAIL: Docker; the build image, which nothing here pulls or builds; and in
// it x86_64, cargo of the pinned channel, a C and a C++ compiler and libclang, which deep-show's locked dependency graph
// needs on Linux (meshopt and basisu_c_sys compile C++, blake3 compiles C, basisu_c_sys runs bindgen). Crate sources are
// fetched in their own step, a failure there BLOCKED too. Only then does the build run, offline: a cargo failure with
// every need in place is the checkout's, a FAIL; a build that times out never ran to an answer, INCONCLUSIVE.

export const LINUX = join(REPO, 'target', 'acceptance-501-linux');
const channel = (): string => {
  const c = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1];
  if (!c) throw Error('rust-toolchain.toml names no channel');
  return c;
};
/** The local build image: the pinned toolchain's slim image with g++ and libclang added (README: Run it). */
export const linuxImage = (): string => `deep-501-linux:${channel()}`;
const recipe = (): string => `printf 'FROM rust:${channel()}-slim-bookworm\\nRUN apt-get update && apt-get install -y --no-install-recommends g++ libclang-dev && rm -rf /var/lib/apt/lists/*\\n' | docker build --platform linux/amd64 -t ${linuxImage()} -`;

function docker(args: string[], input?: string, timeoutMs = 600_000): { status: number | null; stdout: string; stderr: string; timedOut: boolean } {
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) return { status: null, stdout: '', stderr: r.error.message, timedOut };
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut };
}
function hasAmd64(image: string): boolean {
  const perPlatform = docker(['image', 'inspect', '--platform', 'linux/amd64', '--format', '{{.Architecture}}', image], undefined, 30_000);
  if (perPlatform.status === 0 && perPlatform.stdout.trim() === 'amd64') return true;
  return docker(['image', 'inspect', '--format', '{{.Architecture}}', image], undefined, 30_000).stdout.trim() === 'amd64';
}
/** In the image: its machine, then one `missing <need>` line per need it lacks. */
const PROBE = [
  'uname -m',
  'command -v cargo >/dev/null 2>&1 && cargo --version | grep -q " $0 " || echo "missing cargo $0"',
  'command -v cc >/dev/null 2>&1 || echo "missing a C compiler (cc)"',
  'command -v c++ >/dev/null 2>&1 || echo "missing a C++ compiler (c++)"',
  'ls /usr/lib/llvm-*/lib/libclang.so* /usr/lib/x86_64-linux-gnu/libclang*.so* >/dev/null 2>&1 || echo "missing libclang"',
].join('; ');

const run = (image: string, mounts: string[], cmd: string[]): string[] => [
  'run', '--rm', '--platform', 'linux/amd64', ...mounts.flatMap((m) => ['-v', m]), '-w', '/src',
  '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${channel()}`, image, ...cmd,
];
let linuxBuilt: { verdict: 'built' | 'blocked' | 'inconclusive' | 'failed'; text: string } | undefined;
/** Builds `deep-show` with `full` for linux/amd64 once per process. */
function linuxShow(): void {
  if (!linuxBuilt) linuxBuilt = buildLinux();
  if (linuxBuilt.verdict === 'blocked') blocked(linuxBuilt.text);
  if (linuxBuilt.verdict === 'inconclusive') inconclusive(linuxBuilt.text);
  expect(linuxBuilt.text, `${SHOW} builds for Linux x86_64`).toBe('');
}
function buildLinux(): NonNullable<typeof linuxBuilt> {
  const info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 30_000);
  if (info.status !== 0) return { verdict: 'blocked', text: `Docker is unreachable (docker info: ${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); Linux x86_64 runs in a linux/amd64 container` };
  const image = linuxImage();
  if (!hasAmd64(image)) return { verdict: 'blocked', text: `Docker has no linux/amd64 image ${image} here, and this suite pulls and builds nothing; make it once with: ${recipe()}` };
  const probe = docker(['run', '--rm', '--platform', 'linux/amd64', '-e', `RUSTUP_TOOLCHAIN=${channel()}`, image, 'sh', '-c', PROBE, channel()], undefined, 300_000);
  if (probe.status !== 0) return { verdict: 'blocked', text: `the toolchain probe could not run in ${image} (exit ${probe.status}${probe.timedOut ? ', timed out' : ''}): ${probe.stderr.slice(-1000)}` };
  const [machine, ...missing] = probe.stdout.trim().split('\n');
  if (machine !== 'x86_64') return { verdict: 'blocked', text: `${image} with --platform linux/amd64 runs as ${machine ?? 'nothing'}, not x86_64` };
  if (missing.length) return { verdict: 'blocked', text: `${image} lacks what deep-show's Linux build needs: ${missing.join('; ')}; make the image with: ${recipe()}` };
  for (const d of ['target', 'registry', 'git']) mkdirSync(join(LINUX, d), { recursive: true });
  const mounts = [`${REPO}:/src:ro`, `${join(LINUX, 'target')}:/target`, `${join(LINUX, 'registry')}:/usr/local/cargo/registry`, `${join(LINUX, 'git')}:/usr/local/cargo/git`];
  const fetch = docker(run(image, mounts, ['cargo', 'fetch', '--locked', '--target', 'x86_64-unknown-linux-gnu']), undefined, 1_800_000);
  if (fetch.status !== 0) return { verdict: 'blocked', text: `cargo fetch --locked in ${image} could not get the crate sources${fetch.timedOut ? ' (timed out)' : ''}:\n${fetch.stderr.slice(-2000)}` };
  const args = ['build', '--locked', '--offline', '--bin', SHOW, '--no-default-features', '--features', FULL];
  const build = docker(run(image, mounts, ['cargo', ...args]), undefined, TIMEOUT - 2_400_000);
  if (build.timedOut) return { verdict: 'inconclusive', text: `cargo ${args.join(' ')} in ${image} (linux/amd64, emulated) timed out before it finished` };
  return build.status === 0 ? { verdict: 'built', text: '' } : { verdict: 'failed', text: `cargo ${args.join(' ')} in ${image} (linux/amd64) failed with every probed need in place:\n${build.stderr.slice(-4000)}` };
}
/** Runs one scenario through `deep-show run [--planted p]` in a linux/amd64 container, its evidence store at `evidence`
 * (mounted read-write at /evidence, so the files it writes land in the same store). */
export function onLinux(sc: JsonObject, evidence: string, what: string, planted?: string): JsonObject[] {
  linuxShow();
  const inner = { ...sc, evidence: '/evidence' };
  const r = docker(['run', '--rm', '-i', '--platform', 'linux/amd64', '-v', `${join(LINUX, 'target')}:/target:ro`, '-v', `${evidence}:/evidence`,
    linuxImage(), `/target/debug/${SHOW}`, 'run', ...plantedArgs(planted)], `${JSON.stringify(inner)}\n`, 1_800_000);
  return repliesOf({ status: r.status, signal: null, timedOut: r.timedOut, lines: parseLines(r.stdout), stdout: r.stdout, stderr: r.stderr }, inner, `${what} on linux/amd64${planted ? ` (--planted ${planted})` : ''}`);
}
