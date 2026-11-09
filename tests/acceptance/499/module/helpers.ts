// Test-side tools for #499's "module" part: `deep-show` built per Cargo feature set (a build set plus
// this suite's test features, as #185's, #388's and #443's suites build it), debug or release with a kit
// ledger; the startup refusal line; `deep-show run` scenarios and the replies this suite reads; the
// evidence store's `<2 hex>/<62 hex>` layout; and the two fixtures (a WAV made here, a short video with
// sound made by ffmpeg). Nothing here stands in for the seal, the decode worker, the kit or the document
// check: every verdict read here is the binary's own.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/499/module is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
const SHOW = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetOf = (env: NodeJS.ProcessEnv): string => (env['CARGO_TARGET_DIR'] ? resolve(REPO, env['CARGO_TARGET_DIR']) : join(REPO, 'target'));

/** A startup the seal refuses exits with this status, after one JSON line (#305). */
export const REFUSED_EXIT = 2;
export const SLOW = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v)}`).toBe(true);
  return v as JsonValue[];
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v)}`).toBe('string');
  return v as string;
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${show(v)}`).toBe(true);
  return v as number;
}
export const strs = (v: JsonValue | undefined, what: string): string[] => arr(v, what).map((x, i) => str(x, `${what}[${i}]`));
export const show = (v: JsonValue | undefined, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-show` per Cargo feature set, built once per file, each kept under its own name.

/** `full` and this suite's test features (README: The surface under test). */
export type Feature = 'full' | 'test-leave-out-media' | 'test-probe' | 'test-probe-via-media' | 'test-media-checkpoint-without-tail';
export type Build = Feature[];

/** `cargo build --locked [--release] --bin deep-show --no-default-features --features …`, copied to `to`; '' or cargo's error. */
function buildTo(features: Build, release: boolean, to: string, env: NodeJS.ProcessEnv = {}): string {
  const args = ['build', '--locked', ...(release ? ['--release'] : []), '--bin', SHOW, '--no-default-features', '--features', features.join(',')];
  const all = { ...process.env, ...env };
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: all });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n')}`;
  copyFileSync(join(targetOf(all), release ? 'release' : 'debug', exe(SHOW)), to);
  return '';
}

/** Builds every listed feature set once, before the file's tests; a test that asks for a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): { bin: (b: Build) => string; dir: () => string } {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-499-module-bins-'));
    for (const b of builds) {
      const name = b.join('+');
      if (made.has(name)) continue;
      const bin = join(dir, `${SHOW}-${name}`);
      made.set(name, { bin, error: buildTo(b, false, bin) });
    }
  }, SLOW);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(b: Build): string {
      const e = made.get(b.join('+'));
      if (!e) throw Error(`the file didn't list the build ${b.join(',')} in useBuilds`);
      expect(e.error, `the binary builds: ${SHOW} with features ${b.join(',')}`).toBe('');
      return e.bin;
    },
    dir: () => dir,
  };
}

/** A release build (`--release`) embedding the kit ledger at `ledger` (#138: DEEP_KIT_LEDGER at build time). */
export function releaseBuild(b: Build, ledger: string, dir: string): { bin: string; error: string } {
  const bin = join(dir, `${SHOW}-release-${b.join('+')}`);
  return { bin, error: buildTo(b, true, bin, { DEEP_KIT_LEDGER: ledger }) };
}

/** A temporary folder per test (an evidence store root, fixtures), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-499-module-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Running: JSON lines in, one JSON line out per line in; or one refusal line and exit 2.

interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
function start(bin: string, inputs: JsonValue[]): Started {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: inputs.map((v) => JSON.stringify(v)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: SLOW, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, signal: r.signal, timedOut, lines, stdout, stderr: r.stderr ?? '' };
}

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: media module', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];
export const DOC = '01JB499M000000000000000001';

/** A scenario with one agent session and one document in one panel; `planted` selects a wrong program for the run. */
export function scenario(evidence: string, calls: JsonObject[], planted?: string): JsonObject {
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { [DOC]: { panel: 'main' } },
    ...(planted ? { planted } : {}),
    calls,
  };
}

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function run(bin: string, sc: JsonObject): JsonObject[] {
  const s = start(bin, [sc]);
  expect(s.timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW} run starts and exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario: ${show(out)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the calls').length);
  return replies;
}

/** #305's startup refusal: `{"ok": false, "code": "seal_refused", "reason", "modules", "interface"?, …}` and exit 2, with no reply. */
export function startupRefusal(bin: string): { reason: string; modules: string[]; interface: string | undefined; raw: JsonObject } {
  const s = start(bin, [{ evidence: tmpdir(), calls: [{ call: 'registry' }] }]);
  expect(s.timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW} run refuses to start (exit ${REFUSED_EXIT}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1000)}`).toBe(REFUSED_EXIT);
  expect(s.lines.length, `the refusal is one JSON line, with no reply: ${s.stdout.slice(0, 1500)}`).toBe(1);
  const raw = obj(s.lines[0], 'the refusal line');
  expect([raw['ok'], raw['code']], `the line is the seal's refusal: ${show(raw)}`).toEqual([false, 'seal_refused']);
  return {
    reason: typeof raw['reason'] === 'string' ? raw['reason'] : '',
    modules: Array.isArray(raw['modules']) ? raw['modules'].map(String) : [],
    interface: typeof raw['interface'] === 'string' ? raw['interface'] : undefined,
    raw,
  };
}

// ---------------------------------------------------------------------------------------------------
// Calls and replies

export const present = (document: JsonObject): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc: DOC, document, include: ['issues'] });
export const patch = (p: JsonObject): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc: DOC, patch: { doc: DOC, ...p }, include: ['issues'] });
export const REVISIONS: JsonObject = { call: 'revisions', doc: DOC };

export interface Issue { code: string; severity: string; ids: string[]; raw: JsonObject }
export function issues(reply: JsonObject, what: string): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: str(o['code'], `${what}: issues[${i}].code`), severity: String(o['severity']), ids: Array.isArray(o['ids']) ? o['ids'].map(String) : [], raw: o };
  });
}
export const errorsOf = (reply: JsonObject, what: string): Issue[] => issues(reply, what).filter((i) => i.severity === 'error');

export interface Revision { rev: number; hash: string; state: string }
export function currents(reply: JsonObject, what: string): Revision[] {
  return arr(reply['revisions'], `${what}: revisions`).map((v, i) => {
    const o = obj(v, `${what}: revisions[${i}]`);
    return { rev: num(o['rev'], `${what}: revisions[${i}].rev`), hash: str(o['hash'], `${what}: revisions[${i}].hash`), state: str(o['state'], `${what}: revisions[${i}].state`) };
  }).filter((r) => r.state === 'current');
}

/** `schedule`'s `interfaces[name]` (deep://schedule, #185). */
export interface Interface { digest: string; reference: string; kit: string[]; behavior: string; module: string; implementation: { name: string; version: string; equivalence: string; state: string } }
export function interfaceIn(schedule: JsonObject, name: string): Interface {
  const all = obj(schedule['interfaces'], 'schedule: interfaces');
  const o = obj(all[name], `schedule: interfaces["${name}"] (it names ${Object.keys(all).join(', ')})`);
  const impl = obj(o['implementation'], `${name}.implementation`);
  return {
    digest: str(o['digest'], `${name}.digest`), reference: str(o['reference'], `${name}.reference`), kit: strs(o['kit'], `${name}.kit`),
    behavior: str(o['behavior'], `${name}.behavior`), module: str(o['module'], `${name}.module`),
    implementation: { name: str(impl['name'], `${name}.implementation.name`), version: str(impl['version'], `${name}.implementation.version`), equivalence: str(impl['equivalence'], `${name}.implementation.equivalence`), state: str(impl['state'], `${name}.implementation.state`) },
  };
}

/** #138's `kit` call, with this suite's sizes: fewer sequences and param sets than the kit's defaults, so a file runs in minutes. */
export const kitCall = (o: { modules?: string[]; ledger?: string } = {}): JsonObject => ({ call: 'kit', sequences: 100, param_sets: 50, ...o });

export interface KitCase { case: string; verdict: string; fixture: string | undefined; raw: JsonObject }
export interface KitPart { part: string; verdict: string; declared: number; ran: number; cases: KitCase[]; failures: JsonObject[] }
export interface KitModule { module: string; digest: string; verdict: string; parts: KitPart[]; failures: JsonObject[] }
export function kitModule(reply: JsonObject, name: string): KitModule {
  const list = arr(reply['modules'], 'kit: modules').map((m, i) => obj(m, `kit: modules[${i}]`));
  const o = list.find((m) => m['module'] === name);
  expect(o, `the kit's report holds module ${name}; it holds ${list.map((m) => String(m['module'])).join(', ')}`).toBeDefined();
  const fl = (v: JsonValue | undefined, w: string): JsonObject[] => arr(v ?? [], w).map((f, j) => obj(f, `${w}[${j}]`));
  return {
    module: name, digest: String(o!['digest']), verdict: str(o!['verdict'], `${name}.verdict`), failures: fl(o!['failures'], `${name}.failures`),
    parts: arr(o!['parts'], `${name}.parts`).map((p, j) => {
      const po = obj(p, `${name}.parts[${j}]`);
      const part = str(po['part'], `${name}.parts[${j}].part`);
      return {
        part, verdict: str(po['verdict'], `${name}.${part}.verdict`), declared: num(po['declared'], `${name}.${part}.declared`), ran: num(po['ran'], `${name}.${part}.ran`),
        failures: fl(po['failures'], `${name}.${part}.failures`),
        cases: arr(po['cases'], `${name}.${part}.cases`).map((c, k) => {
          const co = obj(c, `${name}.${part}.cases[${k}]`);
          return { case: String(co['case']), verdict: str(co['verdict'], `${name}.${part}.cases[${k}].verdict`), fixture: typeof co['fixture'] === 'string' ? co['fixture'] : undefined, raw: co };
        }),
      };
    }),
  };
}
/** Every failure a part names: the part's own and each case's `failure`. */
export const partFailures = (p: KitPart): JsonObject[] => [...p.failures, ...p.cases.flatMap((c) => (isObject(c.raw['failure']) ? [c.raw['failure'] as JsonObject] : []))];

/** The `manifest` call's fixtures of one module: `{name, module, profile, document, sidecar}` each. */
export function fixturesOf(manifest: JsonObject, module: string): JsonObject[] {
  return arr(manifest['fixtures'], 'manifest.fixtures').map((f, i) => obj(f, `manifest.fixtures[${i}]`)).filter((f) => f['module'] === module);
}

// ---------------------------------------------------------------------------------------------------
// Assets and fixtures

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
/** Puts `bytes` in the evidence store at their SHA-256, as the hub keeps bytes (`<2 hex>/<62 hex>`), and returns it. */
export function putBytes(store: string, bytes: Buffer): string {
  const sha = sha256(bytes);
  mkdirSync(join(store, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(store, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}

/** A 16-bit mono WAV of a 440 Hz tone, `seconds` long at 8 kHz (as #498's decode suite makes it). */
export function wav(seconds: number, rate = 8000): Buffer {
  const n = seconds * rate;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8, 'latin1');
  h.write('fmt ', 12, 'latin1'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'latin1'); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** ffmpeg with the libx264 and aac encoders, or the test fails `BLOCKED:`. It only makes the fixture; it never stands in for the decode worker. */
function ffmpegTool(): string {
  const env = process.env['DEEP_FFMPEG'];
  for (const c of [env, 'ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].filter((x): x is string => !!x)) {
    const r = spawnSync(c, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    if (!r.error && r.status === 0 && /\blibx264\b/.test(r.stdout) && /\baac\b/.test(r.stdout)) return c;
  }
  return expect.fail('BLOCKED: the video fixture is made by ffmpeg with the libx264 and aac encoders; none was found on PATH, /opt/homebrew/bin, /usr/local/bin or DEEP_FFMPEG. Unblock: brew install ffmpeg');
}
/** VIDEO_SECONDS of a 30 fps 160 × 90 test pattern (H.264) with a 440 Hz tone at 48 kHz (AAC) in one MP4: a recording with its sound. */
export const VIDEO_SECONDS = 2;
export function videoWithSound(dir: string): Buffer {
  const out = join(dir, 'recording.mp4');
  execFileSync(ffmpegTool(), ['-hide_banner', '-v', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=160x90:rate=30:duration=${VIDEO_SECONDS}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${VIDEO_SECONDS}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-bf', '0', '-c:a', 'aac', '-b:a', '64k', '-shortest', out], { stdio: ['ignore', 'pipe', 'pipe'] });
  return readFileSync(out);
}

/** One flick is 1/705,600,000 s (canvas primitives: Time and the flick). */
export const FLICKS_PER_SECOND = 705_600_000;
