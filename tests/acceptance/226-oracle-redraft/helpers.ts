// The #226 Oracle lane's tools: `deep-show` built with cargo and driven by JSON lines (#393's `deep-show run`), the
// working agent's `deep_show` of a document, and #420's `geometry` call, whose row for a `mark.point@1` gives the
// point's world position (README: Assumed surfaces); and the axes documents the two tests show, generated here.
// Nothing here stands in for the axes, the scales or `mod.axes@1`: every position a test compares comes from the
// binary, every expected value from the issue's text and the design. Written for this folder alone, since suites don't
// import each other.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (this folder is three levels down). */
const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const TARGET_DIR = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/** Criterion 1's ID: `#226.` and the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (scripts/proof-change.mjs). */
export const AC1 = '#226.c218cc0a';
/** The criterion's agreement: 1e-6 m. */
export const TOL = 1e-6;

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
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
  expect(failures, `${what}:\n  ${failures.slice(0, 20).join('\n  ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` with every module, copied out of target/.

const CARGO_ARGS = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];

/** Builds `deep-show` once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useShow(): () => string {
  let dir = '';
  let made = { bin: '', error: 'the build did not run' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-226-oracle-bin-'));
    const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
    if (r.error) { made = { bin: '', error: `cargo could not run: ${r.error.message}` }; return; }
    if (r.status !== 0) {
      const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
      made = { bin: '', error: `cargo ${CARGO_ARGS.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
      return;
    }
    const bin = join(dir, SHOW);
    copyFileSync(join(TARGET_DIR, 'debug', SHOW), bin);
    made = { bin, error: '' };
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    expect(made.error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return made.bin;
  };
}

/** A fresh evidence folder for a test, deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-226-oracle-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

const SESSION = 'sess-alpha';
/** The minted document every scenario here shows. */
const DOC = '01JB0226D00000000000000001';

/** One `deep-show run` process: the working agent shows `document`, then asks `geometry` for `items`; its two replies. */
export function showAndPlace(bin: string, evidence: string, document: JsonObject, items: readonly string[]): { shown: JsonObject; placed: JsonObject } {
  const calls: JsonObject[] = [
    { call: 'deep_show', session: SESSION, doc: DOC, document, include: ['issues'] },
    { call: 'geometry', doc: DOC, items: [...items] },
  ];
  const scenario: JsonObject = {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: 3D axes', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 4100, ppid: 3000, start: 1_000 }],
    panels: { main: { rect: [0, 0, 1280, 720] } },
    docs: { [DOC]: { panel: 'main' } },
    calls,
  };
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  expect(timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(r.status, `${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario (its calls deep_show, geometry): ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${SHOW} run: replies`).map((v, i) => obj(v, `${SHOW} run: replies[${i}]`));
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(calls.length);
  return { shown: replies[0]!, placed: replies[1]! };
}

/** The show was presented: no error issue, no item skipped as a kind the build doesn't know, outcome `presented`. */
export function presented(reply: JsonObject, what: string): void {
  const notices = Array.isArray(reply['notices']) ? reply['notices'].filter(isObject) : [];
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  none([
    ...[...notices, ...issues].filter((n) => n['code'] === 'unknown_kind').map((n) => `an item is skipped as a kind the build doesn't know: ${brief(n, 600)}`),
    ...issues.filter((i) => i['severity'] === 'error').map((i) => `the check raises an error: ${brief(i, 600)}`),
    ...(reply['outcome'] === 'presented' ? [] : [`the show's outcome is ${brief(reply['outcome'])}, not presented: ${brief(reply, 1500)}`]),
  ], `${what} is presented`);
}

/** Each named point's world position from the `geometry` reply: its row's `pos`, three finite numbers in metres. */
export function positionsOf(reply: JsonObject, ids: readonly string[], what: string): Map<string, V3> {
  expect(reply['code'], `the geometry call answers ${what} without refusing: ${brief(reply, 1500)}`).toBeUndefined();
  const rows = arr(reply['items'], `the geometry reply's items for ${what}`).filter(isObject);
  const out = new Map<string, V3>();
  const failures: string[] = [];
  for (const id of ids) {
    const row = rows.find((r) => r['id'] === id);
    const pos = row?.['pos'];
    if (!row) failures.push(`${id}: no row`);
    else if (row['kind'] !== 'mark.point@1') failures.push(`${id}: its row's kind is ${brief(row['kind'])}, not mark.point@1`);
    else if (!Array.isArray(pos) || pos.length !== 3 || !pos.every((v) => typeof v === 'number' && Number.isFinite(v))) failures.push(`${id}: its row's pos is ${brief(pos)}, not three finite numbers`);
    else out.set(id, pos as V3);
  }
  none(failures, `the geometry call gives each point of ${what} its world position`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Documents. Metres, world +Y up. The axes are an `axes3d@1` at the world origin with three `scale@1` items, one per
// math axis, each scale's range naming its axis; every point is a `mark.point@1` parented to the axes, at its numbers
// (`at.pos`), carrying `mod.axes@1` that names the axes.

export type ScaleType = 'linear' | 'log';
export const AXES = 'axes';

export function axesDoc(title: string, type: ScaleType, domain: [number, number], points: Record<string, V3>): JsonObject {
  const scale = (range: 'x' | 'y' | 'z'): JsonObject => ({ kind: 'scale@1', params: { type, domain: [...domain], range, nice: false } });
  const point = (at: V3): JsonObject => ({
    kind: 'mark.point@1', parent: AXES, at: { pos: [...at] },
    params: { size: 4, paint: { fill: { role: 'ink' } } },
    modifiers: [{ kind: 'mod.axes@1', params: { axes: AXES } }],
  });
  const items: Record<string, JsonObject> = {
    sx: scale('x'), sy: scale('y'), sz: scale('z'),
    [AXES]: { kind: 'axes3d@1', params: { x: 'sx', y: 'sy', z: 'sz', lengths: [8, 8, 8], up: 'z' } },
    ...Object.fromEntries(Object.entries(points).map(([id, at]) => [id, point(at)])),
  };
  const entries = Object.entries(items).map(([id, item], k) => [id, { id, name: id, order: `a${String(k).padStart(4, '0')}`, ...item }] as const);
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #226 oracle-lane fixture.`, size: [640, 480],
    requires: { modules: { scene3d: '^1', data: '^1' } }, items: Object.fromEntries(entries),
  };
}

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const fmt = (v: V3): string => `(${v.map((x) => +x.toPrecision(12)).join(', ')})`;
