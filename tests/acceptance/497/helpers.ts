// Test-side tools for the #497 acceptance tests: the two binaries the base already has, extended (README: The surface
// under test): `deep-show run` built with the test canvas module `test.held` (criterion 1), and `deep-motion eval`
// with input entries that carry a player and an arrival (criterion 2). Nothing here stands in for the program under
// test: every value a test compares comes from a binary; every expected value from the issue's text, computed here.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/497 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Every `it` passes this timeout: a first build can take many minutes. */
export const TIMEOUT = 1_800_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #497.db40ef0b',
  2: 'AC2 #497.2bda68b3',
} as const;

// ---------------------------------------------------------------------------------------------------
// Time, JSON, judging

export const FLICKS = 705_600_000;
export const fl = (s: number): number => Math.round(s * FLICKS);
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
/** A seeded shuffle (Fisher-Yates) of a copy of `list`. */
export function shuffled<T>(list: readonly T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}
export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
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
export const mentions = (v: JsonValue | undefined, needle: string): boolean => (JSON.stringify(v) ?? '').includes(needle);
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// The builds: each file builds its binary once, in beforeAll, copied out of the target folder.

function useBinary(name: string, features: string[] | null): () => string {
  let dir = ''; let error = ''; let bin = '';
  const args = ['build', '--locked', '--bin', name, ...(features ? ['--no-default-features', '--features', features.join(',')] : [])];
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), `deep-497-${name}-`));
    const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
    const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    error = run.error ? `cargo could not run: ${run.error.message}` : run.status === 0 ? '' : `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
    if (error === '') { bin = join(dir, name); copyFileSync(join(TARGET, 'debug', name), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => { expect(error, `the binary builds: cargo ${args.join(' ')}`).toBe(''); return bin; };
}
/** `deep-show` with the full set and the test canvas module `test.held` (README: The test canvas module). */
export const useHeldShow = (): (() => string) => useBinary('deep-show', ['full', 'test-held']);
export const useMotion = (): (() => string) => useBinary('deep-motion', null);

// ---------------------------------------------------------------------------------------------------
// `deep-show run` (criterion 1): one scenario line in, one `{ok, replies}` line out (#387, #488).

export function run(bin: string, sc: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  expect(r.error?.message ?? '', 'deep-show run ran').toBe('');
  const stdout = r.stdout ?? '';
  expect(r.status, `deep-show run exits 0; stdout: ${stdout.slice(0, 1000)}; stderr: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-show run: one output line per input line').toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-show run: the answer');
  expect(out['ok'], `deep-show run accepted the scenario: ${show(out)}`).toBe(true);
  const replies = arr(out['replies'], 'replies').map((v, i) => obj(v, `replies[${i}]`));
  expect(replies.length, 'one reply per call').toBe(arr(sc['calls'], 'calls').length);
  return replies;
}
/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-497-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
const SESSION = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: steps on the clock', process: { pid: 4100, start: 1_000 } };
/** Document IDs: `doc(n)`, each in its own visible panel `p<n>`. */
export const doc = (n: number): string => `01JB97D${String(n).padStart(19, '0')}`;
const DOCS = 4;
export function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  const docs: JsonObject = {}; const panels: JsonObject = {};
  for (let n = 1; n <= DOCS; n++) { docs[doc(n)] = { panel: `p${n}` }; panels[`p${n}`] = { rect: [0, 0, 800, 600] }; }
  return {
    evidence,
    sessions: { [SESSION.id]: { thread: SESSION.thread, name: SESSION.name, process: SESSION.process } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }],
    panels, docs, calls,
  };
}
/** An agent's deep_show call: a whole revision of `document` into `doc(n)`. */
export const showDoc = (n: number, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION.id, doc: doc(n), document, include: ['issues'] });
/** `eval` at `t` flicks, asking for the held array as the frame reads it (README: `eval`'s `arrays`). */
export const ARRAY = 'test.held.index';
export const evalHeld = (n: number, t: number): JsonObject => ({ call: 'eval', doc: doc(n), t, arrays: [ARRAY] });
/** The index an `eval` reply's frame read from the held array. */
export function heldRead(reply: JsonObject, what: string): number {
  expect(reply['outcome'], `${what} evaluated: ${show(reply)}`).toBe('evaluated');
  return int(obj(reply['arrays'], `${what}: arrays`)[ARRAY], `${what}: arrays["${ARRAY}"]`);
}
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${show(reply)}`).toBe('presented');
}
/** The error issues of a refused deep_show reply. */
export function refusedIssues(reply: JsonObject, what: string): JsonObject[] {
  expect(reply['outcome'], `${what} is refused: ${show(reply)}`).toBe('refused');
  return arr(reply['issues'], `${what}: issues`).map((v, i) => obj(v, `${what}: issues[${i}]`)).filter((i) => i['severity'] === 'error');
}

// Documents (criterion 1): a board with one `test.held@1` item stepping at `rate` Hz.
export const STEP_50 = 14_112_000;
const SIZE = [320, 200];
export const rect = (id: string, box: number[], order: string, extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'rect@1', name: `Rect ${id}`, order, params: { box, paint: { fill: { role: 'ink' } } }, ...extra });
export function heldBoard(title: string, rate: number, fps: number, extra: { items?: JsonObject[]; drivers?: JsonObject } = {}): JsonObject {
  const items = [
    rect('back', [0, 0, 320, 200], 'a0'),
    { id: 'held', kind: 'test.held@1', name: 'Held index', order: 'a1', params: { box: [16, 40, 40, 30], step_rate: rate } },
    ...(extra.items ?? []),
  ];
  return {
    format: 1, profile: 'board', seed: 497, title, description: `${title}, drawn by a test agent for the #497 acceptance tests.`, size: SIZE,
    transport: { span: '2s', frame_rate: [fps, 1] }, requires: { modules: { 'test.held': '^1' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    ...(extra.drivers ? { drivers: extra.drivers } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------
// `deep-motion eval` (criterion 2): one JSON line in {doc, times, input, planted?}, one out per line.

export function evalAll(bin: string, lines: JsonObject[]): JsonObject[] {
  const r = spawnSync(bin, ['eval'], { cwd: REPO, input: `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  expect(r.error?.message ?? '', 'deep-motion eval ran').toBe('');
  expect(r.status, `deep-motion eval exits 0; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const out = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, 'deep-motion eval: one output line per input line').toBe(lines.length);
  return out.map((l, i) => obj(JSON.parse(l) as JsonValue, `answer ${i}`));
}
export interface Frame { t: number; items: JsonObject; hash: string; entries: number }
/** An accepted answer's frames, each with its items and its `input: {hash, entries}`. */
export function framesOf(answer: JsonObject, times: readonly number[], what: string): Frame[] {
  expect(answer['ok'], `${what} is accepted: ${show(answer)}`).toBe(true);
  const frames = arr(answer['frames'], `${what}: frames`);
  expect(frames.length, `${what}: one frame per time`).toBe(times.length);
  return frames.map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    expect(f['t'], `${what}: frames[${i}].t`).toBe(times[i]);
    const input = obj(f['input'], `${what}: frames[${i}].input`);
    return { t: times[i]!, items: obj(f['items'], `${what}: frames[${i}].items`), hash: str(input['hash'], `${what}: frames[${i}].input.hash`), entries: int(input['entries'], `${what}: frames[${i}].input.entries`) };
  });
}
/** Item `id`'s `at.pos[0]`: where its driver writes a count. */
export function countOf(f: Frame, id: string, what: string): number {
  const pos = obj(obj(f.items[id], `${what}: item ${id}`)['at'], `${what}: item ${id}.at`)['pos'];
  const x = arr(pos, `${what}: item ${id}.at.pos`)[0];
  expect(typeof x === 'number', `${what}: item ${id}.at.pos[0] is a number, got ${show(x)}`).toBe(true);
  return x as number;
}
