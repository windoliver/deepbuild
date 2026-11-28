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
export const REPO = join(HERE, '..', '..', '..');
export const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
export const TIMEOUT = 3_600_000;

export const AC = { 1: '#2396.e524c371', 2: '#2396.9c791087' } as const;


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
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 20).join('\n  ')}`).toEqual([]);
}


const CARGO_ARGS = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];

export function useShow(): () => string {
  let dir = '';
  let made = { bin: '', error: 'the build did not run' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2396-bin-'));
    const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
    if (r.error) { made = { bin: '', error: `cargo could not run: ${r.error.message}` }; return; }
    if (r.status !== 0) {
      const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
      made = { bin: '', error: `cargo ${CARGO_ARGS.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
      return;
    }
    const bin = join(dir, SHOW);
    copyFileSync(join(TARGET, 'debug', SHOW), bin);
    made = { bin, error: '' };
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    expect(made.error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return made.bin;
  };
}

export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-2396-')); made.push(d); return d; };
}


export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  expect(timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(r.status, `${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${SHOW} run: replies`).map((v, i) => obj(v, `${SHOW} run: replies[${i}]`));
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(arr(scenario['calls'], 'the calls').length);
  return replies;
}

export const SESSION = 'sess-alpha';
export const DOC = '01JB2396D00000000000000001';

export function scenarioOf(evidence: string, calls: JsonObject[]): JsonObject {
  return {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: lifted table', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 4100, ppid: 3000, start: 1_000 }],
    panels: { main: { rect: [0, 0, 1280, 720] } },
    docs: { [DOC]: { panel: 'main' } },
    calls,
  };
}

export const show = (document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc: DOC, document, include: ['issues'] });
export const query = (paths: readonly string[], at: readonly string[]): JsonObject => ({ call: 'deep_query', session: SESSION, doc: DOC, paths: [...paths], at: [...at] });
export const evalAt = (t: string): JsonObject => ({ call: 'eval', doc: DOC, t });

export function presented(reply: JsonObject, what: string): void {
  const notices = Array.isArray(reply['notices']) ? reply['notices'].filter(isObject) : [];
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  const unknown = [...notices, ...issues].filter((n) => n['code'] === 'unknown_kind');
  expect(unknown.map((n) => brief(n)), `${what}: no item skipped as a kind the build doesn't know`).toEqual([]);
  expect(issues.filter((i) => i['severity'] === 'error').map((i) => brief(i, 600)), `${what}: the check raises no error (no no_support)`).toEqual([]);
  expect(reply['outcome'], `${what} is presented: ${brief(reply, 3000)}`).toBe('presented');
}


export const TABLE = { size: [1.2, 0.05, 0.8] as V3 } as const;
export const LIFT = { from: 0, to: 0.25, seconds: 2 } as const;
export const VASE = { r: 0.1, x: 0.2, start: 1.0, z: 0.1 } as const;
export const TIMES = ['0s', '1s', '2s'] as const;
export const SECONDS = [0, 1, 2] as const;
export const VASE_POS = 'items/vase/at/pos';

const ITEMS: Record<string, JsonObject> = {
  cam: { kind: 'camera@1', order: 'a0', params: { projection: 'perspective', target: [0, 0.2, 0], orbit: { azimuth: 30, elevation: 25, distance: 5 }, fov: 40 } },
  table: { kind: 'mark.box@1', order: 'a1', params: { size: [...TABLE.size] }, at: { pos: [0, 0, 0] } },
  vase: { kind: 'mark.sphere@1', order: 'a2', params: { size: [2 * VASE.r, 2 * VASE.r, 2 * VASE.r] }, at: { pos: [VASE.x, VASE.start, VASE.z] } },
  flag: { kind: 'slab@1', order: 'a3', params: { size: [0.1, 1.5, 0.6] }, at: { pos: [3, 0, 0] } },
};
export const IDS = Object.keys(ITEMS).sort();
export const ID_ORDER: readonly string[] = ['cam', 'flag', 'table', 'vase'];
export const REPRO_ORDER: readonly string[] = ['cam', 'table', 'vase', 'flag'];

export function liftedDoc(listing: readonly string[]): JsonObject {
  expect([...listing].sort(), `a listing of the document's items names each of ${IDS.join(', ')} once`).toEqual(IDS);
  return {
    format: 1, profile: 'scene', title: 'A vase on a lifted table', description: 'A vase rests on a table a channel lifts: a #2396 acceptance fixture.', size: [640, 480],
    requires: { modules: { scene3d: '^1', motion: '^1' } },
    channels: { lift: { target: 'items/table/at/pos/1', type: 'f32', keys: { k0: { t: '0s', value: LIFT.from, interp: 'linear' }, k1: { t: `${LIFT.seconds}s`, value: LIFT.to, interp: 'linear' } } } },
    constraints: { rest: { owner: 'vase', kind: 'rest_on', on: 'table' } },
    items: Object.fromEntries(listing.map((id) => [id, { id, name: id, ...ITEMS[id]! }])),
  };
}

export const liftAt = (s: number): number => LIFT.from + ((LIFT.to - LIFT.from) * Math.min(Math.max(s, 0), LIFT.seconds)) / LIFT.seconds;
export const restedAt = (s: number): V3 => [VASE.x, liftAt(s) + TABLE.size[1] / 2 + VASE.r, VASE.z];


export function shuffled<T>(list: readonly T[], seed: number): T[] {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
