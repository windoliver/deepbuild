// Test-side tools for the #2012 acceptance tests (README: The surface under test). They extend #2010's surface (the
// `deep-physics` binary and its golden, golden_verify and golden_cross calls, ../2010/helpers.ts, which builds it once
// per file) with the machines a golden recorded on this Mac is checked on: Linux x86_64 and a Linux VM on this Mac, as
// containers of the #1983 lane's pinned image (scripts/lane-x86.json) run as linux/amd64 and linux/arm64, and the web
// player's wasm32 through `node scripts/physics-wasm32.mjs`. Nothing here stands in for the physics module: every golden,
// run, hash, key and verdict read here is the program's own, on the machine named; the expected values come from the
// issue's text and the golden recorded on this Mac.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  ARCH, CARGO_ENV, HEX16, HEX64, REPO, TARGET, TIMEOUT, ask, blocked, cleanEnv, goldenOf, hostTriple, isObject, obj, recordGolden, scratch,
  show, type JsonObject, type JsonValue,
} from '../2010/helpers.ts';

export * from '../2010/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = { 1: '#2012.4d10a14c', 2: '#2012.13d17890', 3: '#2012.53ff430e', 4: '#2012.562a3985' } as const;

const MIB = 1024 * 1024;

/** The targets a golden recorded on this Mac is checked on (Golden: the other CPU architecture and the web player's wasm32), and the Linux VM's. */
export const LINUX_X86 = 'x86_64-unknown-linux-gnu';
export const LINUX_ARM = 'aarch64-unknown-linux-gnu';
export const WASM32 = 'wasm32-unknown-unknown';
/** The second machines configured (README: golden_cross's `machines`): the lane's linux/amd64 container and the web player's stand-in. */
export const LINUX_MACHINE: JsonObject = { name: 'linux-amd64', target: LINUX_X86 };
export const WEB_MACHINE: JsonObject = { name: 'web-player', target: WASM32 };

/** A test with a container leg: the first linux/amd64 build of Rapier and the workspace runs under emulation. */
export const CONTAINER_TIMEOUT = 3 * 3_600_000;

/** The goldens here are recorded on the arm64 reference Mac (macOS on Apple silicon); any other host is BLOCKED. */
export function referenceMac(): void {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') blocked(`these tests record goldens on the arm64 reference Mac (macOS on Apple silicon); this host is ${process.platform} ${process.arch}`);
}

// ---------------------------------------------------------------------------------------------------
// Replies (one JSON reply per call, exit 0), from any machine

export function readReplies(status: number | null, stdout: string, stderr: string, calls: JsonObject[], what: string): JsonObject[] {
  expect(status, `${what} exits 0; stdout: ${stdout.slice(0, 1000)}; stderr: ${stderr.slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one reply per call`).toBe(calls.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 120)})`));
}

/** A golden recorded on this Mac, checked to name macOS on arm64, this host's triple and the targets asked. */
export function recordHere(w: JsonObject, steps: number, verifyOn: string[]): JsonObject {
  const golden = goldenOf(ask([recordGolden(w, steps, scratch('golden-store'), verifyOn)], { where: 'recording on this Mac' })[0]!, 'golden');
  const machine = obj(golden['machine'], 'golden: machine');
  expect(machine['os'], 'the golden is recorded on macOS').toBe('macos');
  expect(machine['arch'], 'the golden is recorded on arm64').toBe(ARCH);
  expect(golden['record_on'], 'the golden names the target that recorded it').toBe(hostTriple());
  expect(golden['verify_on'], `the golden verifies on ${verifyOn.join(' and ')}`).toEqual(verifyOn);
  expect(golden['bake_key'], 'the golden\'s bake_key is a sha256').toMatch(HEX64);
  return golden;
}

// ---------------------------------------------------------------------------------------------------
// The wasm32 leg (README: `node scripts/physics-wasm32.mjs`)

export const WASM32_SCRIPT = join(REPO, 'scripts', 'physics-wasm32.mjs');
/** Runs `calls` through the physics module built for wasm32-unknown-unknown in Node's WebAssembly engine. */
export function onWasm32(calls: JsonObject[]): JsonObject[] {
  expect(existsSync(WASM32_SCRIPT), 'the wasm32 leg, node scripts/physics-wasm32.mjs, exists (README: The surface under test)').toBe(true);
  const r = spawnSync(process.execPath, [WASM32_SCRIPT], { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 4096 * MIB, env: cleanEnv(), timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', 'node scripts/physics-wasm32.mjs finished in time').toBe('');
  if (r.error && code !== 'EPIPE') throw Error(`node scripts/physics-wasm32.mjs: ${r.error.message}`);
  return readReplies(r.status, r.stdout ?? '', r.stderr ?? '', calls, 'deep-physics on wasm32 (node scripts/physics-wasm32.mjs)');
}

// ---------------------------------------------------------------------------------------------------
// The lane's containers (README: Linux x86_64 and the Linux VM). The #1983 lane's pinned image, `<image>@<digest>` from
// scripts/lane-x86.json, run as linux/amd64 (Linux x86_64, emulated) or linux/arm64 (a Linux VM on this Mac: colima's
// arm64 VM runs it natively). Never pulled (`--pull never`); built with the checkout mounted read-only and caches under
// target/acceptance-2012-linux/<arch>/; every run after a build has no network. A missing runtime or image is BLOCKED
// with one unblock ask; a failed build is a failure.

export type Platform = 'linux/amd64' | 'linux/arm64';
export interface Out { status: number | null; stdout: string; stderr: string; timedOut: boolean }

/** The toolchain channel rust-toolchain.toml pins. */
export function channel(): string {
  const c = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1];
  if (!c) throw Error('rust-toolchain.toml names no channel');
  return c;
}
/** The lane's pinned image, `<image>@<digest>`. */
export function laneRef(): string {
  const pin = obj(JSON.parse(readFileSync(join(REPO, 'scripts', 'lane-x86.json'), 'utf8')) as JsonValue, 'scripts/lane-x86.json');
  expect(typeof pin['image'] === 'string' && typeof pin['digest'] === 'string' && /^sha256:[0-9a-f]{64}$/.test(pin['digest']), `scripts/lane-x86.json pins an image by digest: ${show(pin)}`).toBe(true);
  return `${pin['image'] as string}@${pin['digest'] as string}`;
}

function docker(args: string[], input?: string, timeoutMs = 600_000): Out {
  const run = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) });
  const timedOut = (run.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  if (run.error && !timedOut) return { status: null, stdout: '', stderr: run.error.message, timedOut };
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '', timedOut };
}

/** The lane's image for `platform`, present here; BLOCKED with one unblock ask when Docker or that image isn't. */
export function laneImage(platform: Platform): string {
  const info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 30_000);
  if (info.status !== 0) blocked(`Docker is unreachable (docker info: ${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); the second machines run in this Mac's container runtime: start it (colima start)`);
  const ref = laneRef();
  const arch = platform.split('/')[1];
  const r = docker(['image', 'inspect', '--platform', platform, '--format', '{{.Architecture}}', ref], undefined, 30_000);
  if (r.status !== 0 || r.stdout.trim() !== arch) blocked(`Docker has no ${platform} image of the lane's pinned ${ref} here, and this suite pulls nothing: run docker pull --platform ${platform} ${ref}`);
  return ref;
}

const cacheOf = (platform: Platform): string => join(TARGET, 'acceptance-2012-linux', platform.split('/')[1]!);

/** Runs `command` in the lane's image for `platform`, in the checkout (read-only) with the cargo caches mounted. */
export function inLane(platform: Platform, command: string[], opts: { network: boolean; timeoutMs: number }): Out {
  const ref = laneImage(platform);
  const cache = cacheOf(platform);
  for (const d of ['target', 'registry', 'git']) mkdirSync(join(cache, d), { recursive: true });
  return docker([
    'run', '--rm', '--pull', 'never', '--platform', platform, ...(opts.network ? [] : ['--network', 'none']),
    '-v', `${REPO}:/src:ro`, '-v', `${join(cache, 'target')}:/target`,
    '-v', `${join(cache, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(cache, 'git')}:/usr/local/cargo/git`,
    '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${channel()}`,
    '-e', `CARGO_INCREMENTAL=${CARGO_ENV['CARGO_INCREMENTAL']}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${CARGO_ENV['CARGO_PROFILE_DEV_DEBUG']}`,
    ref, ...command,
  ], undefined, opts.timeoutMs);
}

const builds = new Map<string, string>();
/** `cargo <args>` in the lane's image for `platform`, with the network (it fetches into the cache); once per file. */
export function laneBuild(platform: Platform, cargoArgs: string[]): void {
  const key = `${platform} ${cargoArgs.join(' ')}`;
  if (!builds.has(key)) {
    const r = inLane(platform, ['cargo', ...cargoArgs], { network: true, timeoutMs: CONTAINER_TIMEOUT - 1_800_000 });
    builds.set(key, r.status === 0 ? '' : `cargo ${cargoArgs.join(' ')} in the lane's ${platform} image ${r.timedOut ? 'timed out' : 'failed'}:\n${r.stderr.slice(-4000)}`);
  }
  expect(builds.get(key), `cargo ${cargoArgs.join(' ')} builds in the lane's ${platform} image`).toBe('');
}

/** Runs `calls` through one deep-physics process in the lane's image for `platform`, built there, with no network. */
export function onLane(platform: Platform, calls: JsonObject[]): JsonObject[] {
  laneBuild(platform, ['build', '--locked', '--bin', 'deep-physics']);
  const ref = laneImage(platform);
  const text = `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`;
  const r = docker(['run', '--rm', '-i', '--pull', 'never', '--platform', platform, '--network', 'none', '-v', `${join(cacheOf(platform), 'target')}:/target:ro`, ref, '/target/debug/deep-physics'], text, 1_800_000);
  expect(r.timedOut ? 'timed out' : '', `deep-physics on ${platform} finished in time`).toBe('');
  return readReplies(r.status, r.stdout, r.stderr, calls, `deep-physics on ${platform}`);
}

// ---------------------------------------------------------------------------------------------------
// Judging a replay (golden_verify's Run) against the golden recorded on this Mac

/** The first step at which the run's own step hashes differ from the golden's, -1 when none does, null when it has none. */
export function firstDifference(run: JsonObject, golden: JsonObject): number | null {
  const got = run['step_hashes'];
  const want = golden['step_hashes'];
  if (!Array.isArray(got) || !Array.isArray(want)) return null;
  for (let k = 0; k < Math.max(got.length, want.length); k++) if (got[k] !== want[k]) return k;
  return -1;
}

/** Step for step: the run's own step hashes (each a u64 as 16 hex) equal the golden's at every step, naming the first that differs. */
export function stepForStepFailures(run: JsonObject, golden: JsonObject, what: string): string[] {
  const got = run['step_hashes'];
  const want = golden['step_hashes'] as JsonValue[];
  if (!Array.isArray(got)) return [`${what}: the replay answers no step_hashes of its own (got ${show(got)})`];
  const f: string[] = [];
  if (got.some((h) => typeof h !== 'string' || !HEX16.test(h))) f.push(`${what}: step_hashes holds something other than u64s as 16 hex`);
  if (got.length !== want.length) f.push(`${what}: the replay has ${got.length} step hashes, the golden ${want.length}`);
  const k = firstDifference(run, golden);
  if (k !== null && k >= 0) f.push(`${what}: step ${k} hashes ${show(got[k])} here and ${show(want[k])} in the golden recorded on the Mac`);
  return f;
}

export interface Where { target: string; arch: string; os?: string; machines: 'same' | 'different' }
/** The run says where it ran: its target, its machine, and `machines` against the golden's recording machine. */
export function machineFailures(run: JsonObject, want: Where, what: string): string[] {
  if (run['ok'] !== true) return [`${what} doesn't answer: ${show(run)}`];
  const f: string[] = [];
  if (run['target'] !== want.target) f.push(`${what}: target is ${show(run['target'])}, not ${want.target}`);
  const m = run['machine'];
  if (!isObject(m)) f.push(`${what}: no machine: ${show(m)}`);
  else {
    if (m['arch'] !== want.arch) f.push(`${what}: machine.arch is ${show(m['arch'])}, not ${want.arch}`);
    if (want.os !== undefined && m['os'] !== want.os) f.push(`${what}: machine.os is ${show(m['os'])}, not ${want.os}`);
  }
  if (run['machines'] !== want.machines) f.push(`${what}: machines is ${show(run['machines'])}, not ${want.machines}`);
  return f;
}

/** The replay matches the golden: run where `want` says, under the golden's key and runtime digest, PASS, step for step. */
export function matchFailures(run: JsonObject, golden: JsonObject, want: Where, what: string): string[] {
  const f = machineFailures(run, want, what);
  if (run['ok'] !== true) return f;
  if (run['bake_key'] !== golden['bake_key']) f.push(`${what}: bake_key ${show(run['bake_key'])}, the golden's ${show(golden['bake_key'])}`);
  if (run['runtime_digest'] !== golden['runtime_digest']) f.push(`${what}: runtime_digest ${show(run['runtime_digest'])}, the golden's ${show(golden['runtime_digest'])}`);
  if (run['verdict'] !== 'PASS') f.push(`${what}: the verdict is ${show(run['verdict'])}, not PASS (report ${show(run['report'])}, failure ${show(run['failure'])}${run['refused'] ? `, refused ${show(run['refused'])}` : ''})`);
  return [...f, ...stepForStepFailures(run, golden, what)];
}

/**
 * A replay shifted one ulp at step `at` (golden_verify's `shift`) differs from the golden first at that step, by its own
 * step hashes and by its report: the leg stepped the world itself, so the step-for-step judge has something to catch.
 */
export function shiftedFailures(run: JsonObject, golden: JsonObject, at: number, what: string): string[] {
  if (run['ok'] !== true) return [`${what} doesn't answer: ${show(run)}`];
  const f: string[] = [];
  if (stepForStepFailures(run, golden, what).length === 0) f.push(`${what}: the step-for-step judge finds nothing wrong with a run shifted at step ${at}`);
  const k = firstDifference(run, golden);
  if (k !== at) f.push(`${what}: its own step hashes first differ from the golden's at ${show(k)}, not at step ${at}`);
  if (run['verdict'] !== 'FAIL') f.push(`${what}: the verdict is ${show(run['verdict'])}, not FAIL`);
  const report = run['report'];
  if (!isObject(report) || report['first_step'] !== at) f.push(`${what}: the report doesn't name step ${at}: ${show(report)}`);
  return f;
}
