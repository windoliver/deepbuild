// Test-side tools for the blind redraft of #499 AC5 (REDRAFT.md): `deep-show` built per Cargo feature set, driven by
// one scenario line, and its replies read strictly. Nothing here stands in for the seal, the decode worker or the test
// canvas module: every value a test compares comes from the binary; every expected value from the fixture made here.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/499/module/redraft is five levels down). */
export const REPO = join(HERE, '..', '..', '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const SHOW = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
/** Every `it` passes this timeout: a first build can take many minutes. */
export const TIMEOUT = 7_200_000;
/** `deep-show run`'s exit status when the seal refuses the build (#305). */
export const REFUSED_EXIT = 2;
export const FLICKS = 705_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON, read strictly

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? String(v);
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
export function int(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isSafeInteger(v), `${what} is an integer, got ${show(v)}`).toBe(true);
  return v as number;
}
export const strs = (v: JsonValue | undefined, what: string): string[] => arr(v, what).map((x, i) => str(x, `${what}[${i}]`));

// ---------------------------------------------------------------------------------------------------
// Builds: each feature set built once per file in beforeAll, copied out of the target folder under its own name.

/**
 * `deep-show` built with `--no-default-features --features <features>` once, before the file's tests; the getter
 * fails the test that uses it when the build failed, and with `BLOCKED:` when cargo can't run on this machine.
 */
export function useBuild(features: string[]): () => string {
  let dir = ''; let error = ''; let bin = '';
  const args = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', features.join(',')];
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-499-ac5-bin-'));
    const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
    const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    if (run.error) {
      error = (run.error as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'BLOCKED: cargo is not on PATH; install the Rust toolchain (rustup) to build deep-show'
        : `cargo could not run: ${run.error.message}`;
    } else if (run.status !== 0) {
      error = `cargo ${args.join(' ')} failed:\n${(run.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
    } else {
      bin = join(dir, `${SHOW}-${features.join('+')}`);
      copyFileSync(join(TARGET, 'debug', exe(SHOW)), bin);
    }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => { expect(error, `the binary builds: cargo ${args.join(' ')}`).toBe(''); return bin; };
}

/** A fresh temporary folder per test (the evidence store root), deleted after it. */
export function useTemp(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-499-ac5-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Running: one scenario line in; one `{ok, replies}` line out and exit 0, or one refusal line and exit 2.

export interface Started { status: number | null; signal: string | null; pid: number; lines: JsonValue[]; stdout: string; stderr: string }

export function start(bin: string, sc: JsonObject): Started {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL' });
  expect(r.error?.message ?? '', 'deep-show run ran within its timeout').toBe('');
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, signal: r.signal, pid: r.pid ?? 0, lines, stdout, stderr: r.stderr ?? '' };
}

/** The scenario accepted: one reply per call, and the pid of the deep-show process that answered. */
export function run(bin: string, sc: JsonObject): { replies: JsonObject[]; pid: number } {
  const s = start(bin, sc);
  expect(s.status, `deep-show run starts (the seal passes) and exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, 'deep-show run: one output line per input line').toBe(1);
  const out = obj(s.lines[0], 'deep-show run: the answer');
  expect(out['ok'], `deep-show run accepted the scenario: ${show(out)}`).toBe(true);
  const replies = arr(out['replies'], 'replies').map((v, i) => obj(v, `replies[${i}]`));
  expect(replies.length, 'one reply per call').toBe(arr(sc['calls'], 'calls').length);
  return { replies, pid: s.pid };
}

/** The seal's refusal (#305): `{"ok": false, "code": "seal_refused", "reason", "modules", "arrays"}`, exit 2, no reply. */
export interface Refusal { reason: string; modules: string[]; raw: JsonObject }
export function sealRefusal(bin: string, sc: JsonObject): Refusal {
  const s = start(bin, sc);
  expect(s.status, `deep-show run is refused at its seal (exit ${REFUSED_EXIT}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(REFUSED_EXIT);
  expect(s.lines.length, `the refusal is one JSON line, with no reply to the scenario: ${s.stdout.slice(0, 1500)}`).toBe(1);
  const raw = obj(s.lines[0], 'the refusal line');
  expect(raw['ok'], 'the refusal says ok: false').toBe(false);
  expect(raw['code'], `the refusal is the seal's: ${show(raw)}`).toBe('seal_refused');
  return { reason: str(raw['reason'], 'the refusal\'s reason'), modules: strs(raw['modules'], 'the refusal\'s modules'), raw };
}

// ---------------------------------------------------------------------------------------------------
// The scenario, the document and the calls

const SESSION = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: an asset without media', process: { pid: 4100, start: 1_000 } };
export const DOC = '01JB499A000000000000000005';

export function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  return {
    evidence,
    sessions: { [SESSION.id]: { thread: SESSION.thread, name: SESSION.name, process: SESSION.process } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }],
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { [DOC]: { panel: 'main' } },
    calls,
  };
}

export const MODULE = 'test.probe';
export const KIND = 'test.probe@1';
export const SAMPLE_RATE = 'test.probe.sample_rate';
export const DURATION = 'test.probe.duration';

export const REGISTRY: JsonObject = { call: 'registry' };
export const WORKERS: JsonObject = { call: 'workers' };
export const showDoc = (document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION.id, doc: DOC, document, include: ['issues'] });
export const evalProbe = (): JsonObject => ({ call: 'eval', doc: DOC, t: 0, arrays: [SAMPLE_RATE, DURATION] });

/** A board with one `test.probe@1` item reading the document's asset `tone`, kept by `sha`. It names no media kind. */
export function probeBoard(sha: string): JsonObject {
  return {
    format: 1, profile: 'board', seed: 499, title: 'A probed tone', size: [320, 200],
    description: 'One test.probe item that reads a sound asset\'s probe through the decode worker, drawn by a test agent for #499 AC5.',
    requires: { modules: { [MODULE]: '^1' } },
    assets: { tone: { sha256: sha, license: { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture.' } } },
    items: {
      back: { id: 'back', kind: 'rect@1', name: 'Back', order: 'a0', params: { box: [0, 0, 320, 200], paint: { fill: { role: 'ground' } } } },
      tone: { id: 'tone', kind: KIND, name: 'Tone probe', order: 'a1', params: { box: [16, 40, 120, 30], asset: 'tone' } },
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// The asset: a WAV made by node alone, kept in the evidence store by hash (`<root>/<2 hex>/<62 hex>`, #15, #305)

/** A 16-bit mono PCM WAV of `frames` samples of a 440 Hz tone at `rate`. */
export function wav(frames: number, rate: number): Buffer {
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8, 'latin1');
  h.write('fmt ', 12, 'latin1'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'latin1'); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** Keeps `bytes` in the evidence store at `root` by its SHA-256; returns the hash. */
export function keep(root: string, bytes: Uint8Array): string {
  const sha = sha256(bytes);
  mkdirSync(join(root, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(root, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}

// ---------------------------------------------------------------------------------------------------
// Replies

export interface Worker { pid: number; role: string; jobs: { op: string; file: string | null }[] }
/** The `workers` reply (#498): every helper process the run started, with every job it ran. */
export function workersOf(reply: JsonObject): Worker[] {
  return arr(reply['workers'], 'workers').map((v, i) => {
    const w = obj(v, `workers[${i}]`);
    return {
      pid: int(w['pid'], `workers[${i}].pid`), role: str(w['role'], `workers[${i}].role`),
      jobs: arr(w['jobs'], `workers[${i}].jobs`).map((j, k) => {
        const o = obj(j, `workers[${i}].jobs[${k}]`);
        return { op: str(o['op'], `workers[${i}].jobs[${k}].op`), file: typeof o['file'] === 'string' ? o['file'] : null };
      }),
    };
  });
}
