import { spawnSync } from 'node:child_process';
import { accessSync, constants, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect } from 'vitest';
import type { Pose, V3 } from './fixtures.ts';
import { KIND, brief, isObject, type Expected, type JsonObject, type JsonValue } from './judges.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
export const TIMEOUT = 1_800_000;

export const PLANTED = {
  list: 'relations_read_arrangement_list',
  upright: 'relations_read_tipped_upright',
  measure: 'relations_measure_off_last_place',
} as const;

export function none(failures: readonly string[], what: string): void {
  const listed = failures.length > 12 ? [...failures.slice(0, 12), `… and ${failures.length - 12} more`] : failures;
  expect(listed, `${what}:\n  ${listed.join('\n  ')}`).toEqual([]);
}
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
function blocked(reason: string): never {
  expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}

const supplied = process.env['DEEP_BIN_DIR'];
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const SHOW_BIN = join(supplied === undefined ? join(TARGET, 'debug') : resolve(supplied), SHOW);
export function showBin(): string {
  try {
    accessSync(SHOW_BIN, constants.X_OK);
  } catch {
    blocked(`${supplied === undefined ? relative(REPO, SHOW_BIN) : `DEEP_BIN_DIR's ${SHOW}`} is missing or not executable: build it first, with \`cargo build --locked --bin ${SHOW}\``);
  }
  return SHOW_BIN;
}

export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-3225-')); made.push(d); return d; };
}

export function run(bin: string, scenario: JsonObject): JsonObject[] {
  // deadline: the process ends when it has answered; the timeout only turns a hang into a failure.
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_500_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  expect(timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(r.status, `${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = JSON.parse(lines[0]!) as JsonValue;
  expect(isObject(out) && out['ok'] === true, `${SHOW} run accepted the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = (out as JsonObject)['replies'];
  const calls = scenario['calls'];
  expect(Array.isArray(replies) && Array.isArray(calls) && replies.length === calls.length && replies.every(isObject), `${SHOW} run: one reply per call: ${brief(replies, 600)}`).toBe(true);
  return replies as JsonObject[];
}

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'alpha: relations', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
const PANELS: JsonObject = { main: { rect: [0, 0, 1280, 720] } };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB3225D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB3225C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB3225Q', n)}`;

export interface Requirement { id: string; check: JsonObject }
export const claimOf = (doc: string, requirements: readonly Requirement[]): JsonObject =>
  ({ session: ALPHA.id, deliverables: [doc], requirements: requirements.map((r) => ({ id: r.id, check: r.check })) });

export function scenarioOf(evidence: string, docs: readonly string[], claims: JsonObject, calls: JsonObject[], planted?: string): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS,
    docs: Object.fromEntries(docs.map((d) => [d, { panel: 'main' }])), claims, ...(planted ? { planted } : {}), calls,
  };
}

export const relations = (expected: readonly Expected[]): JsonObject => ({ kind: KIND, expect: expected as unknown as JsonValue[] });
export const SCENE_AUDIT: JsonObject = { kind: 'geometry.audit', scope: 'scene', support: { floating: ['floor'] } };

export const show = (doc: string, document: JsonObject, audit = false): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc, document, include: audit ? ['issues', 'audit'] : ['issues'] });
export const query = (doc: string, ids: readonly string[]): JsonObject =>
  ({ call: 'deep_query', session: ALPHA.id, doc, paths: ids.flatMap((id) => [`items/${id}/at/pos`, `items/${id}/at/rot`]), at: ['0s'] });
export const verdict = (claim: string): JsonObject => ({ call: 'verdict', claim });

export function presented(reply: JsonObject, what: string): void {
  const rows = (k: string): JsonObject[] => (Array.isArray(reply[k]) ? (reply[k] as JsonValue[]).filter(isObject) : []);
  expect(rows('issues').filter((i) => i['severity'] === 'error').map((i) => brief(i, 600)), `${what}: no error issue`).toEqual([]);
  expect([...rows('notices'), ...rows('issues')].filter((n) => n['code'] === 'unknown_kind').map((n) => brief(n, 600)), `${what}: no item skipped as a kind the build doesn't know`).toEqual([]);
  expect(reply['outcome'], `${what} is presented: ${brief(reply, 3000)}`).toBe('presented');
}

export function posesOf(reply: JsonObject, ids: readonly string[], what: string): Record<string, Pose> {
  const values = reply['values'];
  const v3 = (path: string): V3 => {
    const at = isObject(values) ? values[path] : undefined;
    const a = Array.isArray(at) ? at[0] : undefined;
    expect(Array.isArray(a) && a.length === 3 && a.every((x) => typeof x === 'number' && Number.isFinite(x)), `${what}: ${path} at 0s is three finite numbers, got ${brief(at)}`).toBe(true);
    return a as V3;
  };
  return Object.fromEntries(ids.map((id) => [id, { pos: v3(`items/${id}/at/pos`), rot: v3(`items/${id}/at/rot`) }]));
}

export const load = (): number => loadavg()[0]!;
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}

const RELEASE_BUILD = ['build', '--locked', '--release', '--bin', SHOW];
export function releaseBin(dir: string): { bin: string; error: string } {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0' };
  const r = spawnSync('cargo', RELEASE_BUILD, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error) return { bin: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { bin: '', error: `cargo ${RELEASE_BUILD.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
  }
  const bin = join(dir, `${SHOW}-release`);
  copyFileSync(join(TARGET, 'release', SHOW), bin);
  return { bin, error: '' };
}
