// Test-side tools for #225's criterion 5, redrafted blind: `deep-show` built `full` on this Mac and for Linux x86_64
// in a linux/amd64 container, each driven by one `deep-show run` scenario line (#393); the Lorenz document the
// criterion describes; reading the stream's points off the `streams` call (README: The surface under test); and the
// judges, each returning its failures as sentences that name what failed. Nothing here stands in for the vector
// field: every point a test compares comes from a binary, every expected value from the issue's text and the design.
// The one reference trajectory below is an independent first oracle (technical design: Independent first oracles),
// classic RK4 written from the criterion's numbers, used only to show a stream is the Lorenz system's.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect } from 'vitest';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Vec3 = [number, number, number];

/** The checkout root (this folder is three levels down). */
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
const CARGO_ARGS = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];
const HOUR = 3_600_000;
/** The whole test: a first build on this Mac and an emulated one in the container each take hours under load. */
export const TIMEOUT = 10 * HOUR;

/** Criterion 5's ID: `#225.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC5 = '#225.eb041fdb';

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A judge's failures on a wrong program: it found something wrong, and a failure names each of `names`. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails the judge, but the judge found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names "${name}"; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  }
}
/** The second machine can't run here: the test fails BLOCKED with one unblock ask, never passes (AGENTS.md). */
export function blocked(reason: string, ask: string): never {
  expect.fail(`BLOCKED: ${reason}. Unblock: ${ask}. This is not a pass`);
}

/** Fresh folders for a test (binaries, evidence stores), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-225-ac5-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// This Mac: `deep-show` built `full`, copied out of target/, and run once per scenario.

/** Builds `full` deep-show on this machine and copies it into `dir`: the binary, or cargo's error. */
export function buildHere(dir: string): { bin: string; error: string } {
  const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 3 * HOUR, killSignal: 'SIGKILL', env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return { bin: '', error: `cargo could not run or timed out: ${r.error.message}` };
  if (r.status !== 0) return { bin: '', error: `cargo ${CARGO_ARGS.join(' ')} failed:\n${quiet(r.stderr ?? '').slice(-4000)}` };
  const bin = join(dir, `${SHOW}-full`);
  copyFileSync(join(TARGET, 'debug', SHOW), bin);
  return { bin, error: '' };
}
const quiet = (stderr: string): string => stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n');

interface Started { status: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string }
function started(r: ReturnType<typeof spawnSync>): Started {
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  return { status: r.status, signal: r.signal, timedOut, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? r.error?.message ?? '') };
}
/** `deep-show run`'s answer: one line, `ok`, one reply per call. */
function repliesOf(s: Started, calls: number, name: string): JsonObject[] {
  expect(s.timedOut, `${name} finished within its timeout`).toBe(false);
  expect(s.status, `${name} exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  const lines = s.stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line for the one scenario line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(out['ok'], `${name} accepted the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls);
  return replies;
}
/** One `deep-show run` process on this machine: its replies, one per call. */
export function runHere(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: HOUR, killSignal: 'SIGKILL' });
  return repliesOf(started(r), arr(scenario['calls'], 'the calls').length, `${SHOW} run on this Mac`);
}

// ---------------------------------------------------------------------------------------------------
// The scenario: your shell's process tree, one panel, the Lorenz document shown from your shell, then its streams.

const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const DOC = '01JB225DAC5000000000000001';
const FIELD = 'lorenz';
/** The stream from the one start, by the design's read-only address `<id>#s<i>`. */
export const STREAM = `${FIELD}#s0`;

/** The criterion's numbers. */
export const LORENZ = { sigma: 10, rho: 28, beta: 8 / 3, start: [1, 1, 1] as Vec3, step: 0.005, time: 40, maxPoints: 16_384 } as const;
/** time ÷ step: 8,000 steps of 0.005 (exactly 8000 in f64). */
export const STEPS = Math.round(LORENZ.time / LORENZ.step);

/**
 * The film your shell shows (#393's document from a shell: no `id`, no `layers`, no item's `layer`): one
 * `vector_field@1`, `lorenz`, the data module's kind (`requires.modules.data`). Its fn is the Lorenz system with σ 10,
 * ρ 28 and β 8/3 written into the formula; one stream from the point (1, 1, 1) by RK4 at step 0.005 for time 40, its
 * `max_points` raised to the cap 16,384 that one start allows. Its arrows' grid, x and y from −30 to 30 and z from 0
 * to 60 in steps of 10 (343 arrows), is the box the stream may not leave; the attractor lies well inside it.
 */
function lorenzDocument(): JsonObject {
  return {
    format: 1, profile: 'film', title: 'Lorenz attractor', description: "The Lorenz system's one stream, which #225's criterion 5 compares across two machines.",
    size: [800, 600], requires: { modules: { data: '^1' } },
    items: {
      [FIELD]: {
        id: FIELD, kind: 'vector_field@1', name: 'Lorenz system', order: 'a0',
        params: {
          fn: { x: '10 * (y - x)', y: 'x * (28 - z) - y', z: 'x * y - 8 / 3 * z' },
          arrows: { grid: { x: [-30, 30, 10], y: [-30, 30, 10], z: [0, 60, 10] } },
          streams: { starts: { points: [LORENZ.start] }, jitter: 0, seed: 1, step: LORENZ.step, time: LORENZ.time, method: 'rk4', pad: 3, max_points: LORENZ.maxPoints },
        },
      },
    },
  };
}
/** The calls: show the document from your shell, then read the field's streams (README: the `streams` call). */
const CALLS: JsonObject[] = [
  { call: 'deep show', peer: YOU_PEER, doc: DOC, document: lorenzDocument(), include: ['issues'] },
  { call: 'streams', doc: DOC, item: FIELD },
];
export function scenario(evidence: string): JsonObject {
  return {
    evidence,
    sessions: { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: vector fields', process: { pid: 4100, start: 1_000 } } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1920, 1080] } },
    docs: { [DOC]: { panel: 'main' } },
    calls: CALLS,
  };
}

/**
 * The stream's points a machine gave, or why it gave none: the document is presented with no error, and `streams`
 * answers with exactly one stream, `lorenz#s0`, whose points are each three finite numbers.
 */
export function streamOf(replies: readonly JsonObject[], machine: string): { failures: string[]; points: Vec3[] | null } {
  const shown = replies[0]!;
  const failures: string[] = [];
  if (shown['outcome'] !== 'presented') failures.push(`on ${machine}, deep show's outcome for the Lorenz film is ${brief(shown['outcome'])}, not presented: ${brief(shown)}`);
  const issues = Array.isArray(shown['issues']) ? shown['issues'].filter(isObject) : [];
  for (const e of issues.filter((i) => i['severity'] === 'error')) failures.push(`on ${machine}, the check raises an error on the Lorenz film: ${brief(e, 600)}`);
  const reply = replies[1]!;
  const streams = Array.isArray(reply['streams']) ? reply['streams'].filter(isObject) : null;
  if (!streams) return { failures: [...failures, `on ${machine}, the streams call gives no list of streams: ${brief(reply)}`], points: null };
  if (streams.length !== 1) failures.push(`on ${machine}, ${FIELD} has ${streams.length} streams, not the one from its one start: ${brief(streams.map((s) => s['id'] ?? null))}`);
  const stream = streams.find((s) => s['id'] === STREAM);
  if (!stream) return { failures: [...failures, `on ${machine}, no stream is named ${STREAM}: ${brief(streams.map((s) => s['id'] ?? null))}`], points: null };
  const raw = stream['points'];
  if (!Array.isArray(raw)) return { failures: [...failures, `on ${machine}, ${STREAM} has no list of points: ${brief(raw)}`], points: null };
  const bad = raw.findIndex((p) => !Array.isArray(p) || p.length !== 3 || !p.every((c) => typeof c === 'number' && Number.isFinite(c)));
  if (bad >= 0) return { failures: [...failures, `on ${machine}, point ${bad} of ${STREAM} is ${brief(raw[bad])}, not three finite numbers`], points: null };
  return { failures, points: raw as Vec3[] };
}

// ---------------------------------------------------------------------------------------------------
// The judges

const lorenz = (p: Vec3): Vec3 => [LORENZ.sigma * (p[1] - p[0]), p[0] * (LORENZ.rho - p[2]) - p[1], p[0] * p[1] - LORENZ.beta * p[2]];
const along = (p: Vec3, k: Vec3, s: number): Vec3 => [p[0] + s * k[0], p[1] + s * k[1], p[2] + s * k[2]];
/** Classic RK4 of the Lorenz system from (1, 1, 1) at step 0.005 in f64: the start and `steps` more points. */
export function lorenzRk4(steps: number): Vec3[] {
  const h = LORENZ.step;
  let p: Vec3 = [...LORENZ.start];
  const out: Vec3[] = [p];
  for (let i = 0; i < steps; i++) {
    const k1 = lorenz(p), k2 = lorenz(along(p, k1, h / 2)), k3 = lorenz(along(p, k2, h / 2)), k4 = lorenz(along(p, k3, h));
    p = [0, 1, 2].map((j) => p[j]! + (h / 6) * (k1[j]! + 2 * k2[j]! + 2 * k3[j]! + k4[j]!)) as Vec3;
    out.push(p);
  }
  return out;
}
/** A wrong integrator's stream for the judge's twin: forward Euler at the same step. */
export function lorenzEuler(steps: number): Vec3[] {
  let p: Vec3 = [...LORENZ.start];
  const out: Vec3[] = [p];
  for (let i = 0; i < steps; i++) { p = along(p, lorenz(p), LORENZ.step); out.push(p); }
  return out;
}

/** Up to field time 10 (2,000 steps) the stream is the reference's within 1e-6; two f64 RK4s that round differently stay within about 1e-12 there. */
const CHECKED_STEPS = 2_000;
const NEAR = 1e-6;
const reference = lorenzRk4(CHECKED_STEPS);

/**
 * Why `points` isn't one machine's Lorenz stream as the criterion gives it: at most 16,384 points; the whole time 40
 * run, so 8,000 to 8,002 points (time ÷ step steps after the start, with one either way for how the last step is
 * counted); its first point the start (1, 1, 1) exactly; and within 1e-6 of the reference RK4 up to field time 10.
 */
export function streamFailures(points: readonly Vec3[], machine: string): string[] {
  const failures: string[] = [];
  if (points.length > LORENZ.maxPoints) failures.push(`on ${machine}, ${STREAM} has ${points.length} points, more than ${LORENZ.maxPoints}`);
  if (points.length < STEPS || points.length > STEPS + 2) failures.push(`on ${machine}, ${STREAM} has ${points.length} points, not the ${STEPS + 1} (± 1) of time ${LORENZ.time} at step ${LORENZ.step}`);
  const first = points[0];
  if (!first || first.some((c, j) => c !== LORENZ.start[j])) failures.push(`on ${machine}, ${STREAM} starts at ${brief(first ?? null)}, not at the start (1, 1, 1)`);
  for (let i = 0; i <= CHECKED_STEPS && i < points.length; i++) {
    const off = Math.max(...[0, 1, 2].map((j) => Math.abs(points[i]![j]! - reference[i]![j]!)));
    if (!(off <= NEAR)) {
      failures.push(`on ${machine}, point ${i} of ${STREAM} (field time ${(i * LORENZ.step).toFixed(3)}) is ${brief(points[i]!)}, ${off.toExponential(3)} from the Lorenz system's RK4 point ${brief(reference[i]!)}, more than ${NEAR}`);
      break;
    }
  }
  return failures;
}

/** Each point's x, y and z as little-endian f64, in order: the bytes "byte-identical" compares. */
export function bytesOf(points: readonly Vec3[]): Buffer {
  const b = Buffer.alloc(points.length * 24);
  points.forEach((p, i) => p.forEach((c, j) => b.writeDoubleLE(c, i * 24 + j * 8)));
  return b;
}
export const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
/** How many f64 values lie between a and b (0 when their bits are equal). */
function ulps(a: number, b: number): bigint {
  const ordered = (x: number): bigint => {
    const v = Buffer.alloc(8);
    v.writeDoubleLE(x);
    const bits = v.readBigInt64LE();
    return bits < 0n ? -(bits & 0x7fffffffffffffffn) : bits;
  };
  const d = ordered(a) - ordered(b);
  return d < 0n ? -d : d;
}
const AXES = ['x', 'y', 'z'] as const;
/**
 * Why the second machine's points aren't the first's byte for byte: their SHA-256 differ, and the first point and
 * axis that differ are named with both values and their distance in ulps (as a golden's report names a field).
 */
export function sameBytesFailures(a: readonly Vec3[], b: readonly Vec3[], machines: [string, string]): string[] {
  const [ha, hb] = [sha256(bytesOf(a)), sha256(bytesOf(b))];
  if (ha === hb) return [];
  const failures = [`${STREAM}'s points differ: SHA-256 ${ha} on ${machines[0]}, ${hb} on ${machines[1]}`];
  if (a.length !== b.length) failures.push(`${STREAM} has ${a.length} points on ${machines[0]} and ${b.length} on ${machines[1]}`);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const j = [0, 1, 2].find((k) => !Object.is(a[i]![k], b[i]![k]));
    if (j !== undefined) {
      failures.push(`first difference: point ${i}, ${AXES[j]}: ${a[i]![j]} on ${machines[0]}, ${b[i]![j]} on ${machines[1]}, ${ulps(a[i]![j]!, b[i]![j]!)} ulps apart`);
      break;
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Linux x86_64: a linux/amd64 container on this Mac (canvas primitives: Golden, "it counts as the other architecture
// for CPU checks"), from scripts/lane-x86.json's pinned toolchain image with libclang added, which `full` deep-show's
// bindgen build scripts need. Its caches live under target/acceptance-225-ac5-linux/. Nothing is pulled.

const CHANNEL = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1] ?? '';
const PIN = JSON.parse(readFileSync(join(REPO, 'scripts', 'lane-x86.json'), 'utf8')) as { image: string; digest: string };
const PINNED = `${PIN.image}@${PIN.digest}`;
/** This suite's build image (README: Linux x86_64). */
const LINUX_IMAGE = `deepbuild-acceptance-225-ac5-linux:${CHANNEL}`;
const RECIPE = `FROM ${PINNED}\nRUN apt-get update && apt-get install -y --no-install-recommends libclang-dev && rm -rf /var/lib/apt/lists/*\n`;
const MAKE_IMAGE = `printf '${RECIPE.replace(/\n/g, '\\n')}' | docker build --platform linux/amd64 -t ${LINUX_IMAGE} -`;
const CACHE = join(TARGET, 'acceptance-225-ac5-linux');

function docker(args: string[], timeout: number, input?: string): Started {
  return started(spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout, killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) }));
}
const lastLine = (s: string): string => s.trim().split('\n').slice(-1)[0] ?? '';
const layers = (image: string): string[] | null => {
  const r = docker(['image', 'inspect', '--platform', 'linux/amd64', '--format', '{{.Architecture}} {{json .RootFS.Layers}}', image], 60_000);
  const m = /^amd64 (\[.*\])$/.exec(r.stdout.trim());
  return r.status === 0 && m ? (JSON.parse(m[1]!) as string[]) : null;
};

/** Why Linux x86_64 can't run here, with its one unblock ask; null when it can. */
export function linuxBlocked(): { reason: string; ask: string } | null {
  const info = docker(['info', '--format', '{{.ServerVersion}}'], 60_000);
  if (info.status !== 0) return { reason: `the container runtime is unreachable (${lastLine(info.stderr) || `exit ${info.status}`})`, ask: 'start Docker on this Mac, then run this file again' };
  if (PIN.image !== `rust:${CHANNEL}-bookworm`) return { reason: `scripts/lane-x86.json pins ${PIN.image}, not the toolchain image of rust-toolchain.toml's channel ${CHANNEL}`, ask: `pin rust:${CHANNEL}-bookworm by digest in scripts/lane-x86.json, then run this file again` };
  const base = layers(PINNED);
  if (!base) return { reason: `Docker has no linux/amd64 image ${PINNED}, and this suite pulls nothing`, ask: `docker pull --platform linux/amd64 ${PINNED}` };
  const ours = layers(LINUX_IMAGE);
  if (!ours || base.some((l, i) => ours[i] !== l)) {
    return { reason: `Docker has no linux/amd64 image ${LINUX_IMAGE} built from ${PINNED} with libclang`, ask: `build it once: ${MAKE_IMAGE}` };
  }
  return null;
}

/** An emulated compiler or linker that died on a signal: cargo resumes from the crates already built. */
const crashed = (s: Started): boolean => s.status === 139 || /SIGSEGV|SIGBUS|SIGILL|signal: 1[01],|Segmentation fault|qemu: uncaught target signal/i.test(s.stderr);
/** Builds `full` deep-show for linux/amd64, resuming up to twice after an emulation crash: '' or the reason it failed. */
export function buildLinux(): { error: string; crashes: number } {
  for (const d of ['target', 'registry', 'git']) mkdirSync(join(CACHE, d), { recursive: true });
  let crashes = 0;
  for (;;) {
    const r = docker([
      'run', '--rm', '--pull', 'never', '--platform', 'linux/amd64',
      '-v', `${REPO}:/src:ro`, '-v', `${join(CACHE, 'target')}:/target`,
      '-v', `${join(CACHE, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(CACHE, 'git')}:/usr/local/cargo/git`,
      '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${CHANNEL}`, '-e', 'CARGO_BUILD_JOBS=2',
      '-e', `CARGO_INCREMENTAL=${CARGO_ENV.CARGO_INCREMENTAL}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${CARGO_ENV.CARGO_PROFILE_DEV_DEBUG}`,
      LINUX_IMAGE, 'cargo', ...CARGO_ARGS,
    ], 3 * HOUR);
    if (r.status === 0) return { error: '', crashes };
    if (!r.timedOut && crashed(r) && crashes < 2) { crashes++; continue; }
    return { error: `cargo ${CARGO_ARGS.join(' ')} in ${LINUX_IMAGE} (linux/amd64) ${r.timedOut ? 'timed out' : 'failed'}:\n${quiet(r.stderr).slice(-4000)}`, crashes };
  }
}

/**
 * One `deep-show run` process in a linux/amd64 container with no network, the checkout and the build read-only,
 * `evidence` as its store: the machine the container reports (`uname -m`) and the replies.
 */
export function runLinux(sc: JsonObject, evidence: string): { arch: string; replies: JsonObject[] } {
  const inside = { ...sc, evidence: '/evidence' };
  const r = docker([
    'run', '--rm', '-i', '--pull', 'never', '--platform', 'linux/amd64', '--network', 'none',
    '-v', `${REPO}:/src:ro`, '-v', `${join(CACHE, 'target')}:/target:ro`, '-v', `${evidence}:/evidence`, '-w', '/src',
    LINUX_IMAGE, 'sh', '-c', `echo "machine: $(uname -m)" >&2; exec /target/debug/${SHOW} run`,
  ], HOUR, `${JSON.stringify(inside)}\n`);
  const arch = /machine: (\S+)/.exec(r.stderr)?.[1] ?? 'unknown';
  return { arch, replies: repliesOf(r, arr(sc['calls'], 'the calls').length, `${SHOW} run on linux/amd64`) };
}
