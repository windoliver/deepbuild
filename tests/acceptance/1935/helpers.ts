// Test-side tools for the #1935 acceptance tests: `deep-show` built with the `full` feature set and driven by one
// JSON scenario line (#393's `deep-show run`, #403's claims, requirements and `verdict`); a scene document of one
// `mesh.asset@1` item whose glTF sits in a temporary evidence store by SHA-256 (#420, #453); reading
// geometry.shading's requirement row and its one result per item (README: The surface under test); and the checks
// the criteria make, each returning its failures as sentences that name what failed. Copied in part from #453's and
// #1936's helpers, since suites don't import each other. Nothing here stands in for geometry.shading.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { glb, type Prim } from './gltf.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1935 is three levels down). */
const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
const CARGO_ARGS = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

export const KIND = 'geometry.shading';
/** The planted wrong program criterion 1 names: overlap computed from chart bounding boxes (README: The planted program). */
export const PLANT = 'uv_overlap_from_boxes';
/** What every UV case's check input carries beside its threshold: UV readings whether or not a map is used, at 1,024 px. */
export const UV_INPUT: JsonObject = { uv_when: 'always', resolution: 1024 };

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1200): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
/** No failures; the message lists them, each naming what failed. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names each of `names`: what a wrong program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  }
}
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` with `full`, copied out of target/.

/** Builds once, before the file's tests. A test whose build failed fails with cargo's error; without cargo it can't decide. */
export function useBuild(): () => string {
  let dir = '';
  let made: { bin: string; error: string; ran: boolean } | undefined;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1935-bin-'));
    const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
    if (r.error) { made = { bin: '', error: `cargo could not run: ${r.error.message}`, ran: false }; return; }
    if (r.status !== 0) {
      const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
      made = { bin: '', error: `cargo ${CARGO_ARGS.join(' ')} failed:\n${lines.join('\n').slice(-4000)}`, ran: true };
      return;
    }
    const bin = join(dir, SHOW);
    copyFileSync(join(TARGET, 'debug', SHOW), bin);
    made = { bin, error: '', ran: true };
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    if (!made) throw Error('the build never ran');
    if (!made.ran) inconclusive(made.error);
    expect(made.error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return made.bin;
  };
}

/** Fresh evidence stores for a test, all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1935-')); made.push(d); return d; };
}

/** Keeps `bytes` in the evidence store at `<first 2 hex>/<other 62 hex>` (deep-show's layout); its SHA-256. */
function putEvidence(root: string, bytes: Uint8Array): string {
  const sha = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(join(root, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(root, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}

/** One `deep-show run` process: one scenario, accepted, with one reply per call. */
function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
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

// ---------------------------------------------------------------------------------------------------
// The world: one agent's session, the process table, a panel; one document and one claim per case.

const SESSION = 'sess-alpha';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: asset checks', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 4100, ppid: 3000, start: 1_000 }];
const PANELS: JsonObject = { main: { rect: [0, 0, 800, 600] } };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
const docId = (n: number): string => ulid('01JB1935D', n);
const claimId = (n: number): string => `claim:${ulid('01JB1935C', n)}`;
const reqId = (n: number): string => `req:${ulid('01JB1935Q', n)}`;
/** The one item each case's document holds. */
export const ITEM = 'asset';

/** A scene document as the last release stored it (opened as revision 0): one `mesh.asset@1` naming the glTF by hash, node 0. */
function sceneWith(sha256: string): JsonObject {
  return {
    format: 1, profile: 'scene', title: 'Asset check', description: 'One glTF asset, held to geometry.shading.', size: [480, 360],
    requires: { modules: { scene3d: '^1' } },
    layers: { 'you-main': { writer: 'you:you', title: 'You', order: 'a0' } },
    items: { [ITEM]: { id: ITEM, kind: 'mesh.asset@1', name: 'Asset', order: 'a0', layer: 'you-main', params: { sha256, node: 0, paint: { fill: { role: 'accent' } } } } },
  };
}

/** One fixture to judge: its primitive, and the geometry.shading check input's fields beyond `kind`. */
export interface Case { name: string; prim: Prim; check: JsonObject }

/** One issue on a requirement's row. */
export interface Issue { code: string; severity: string; ids: string[]; raw: JsonObject }
/** What one case's verdict said: its requirement row and the row's result for the item. */
export interface Judged { name: string; result: string; issues: Issue[]; reading: JsonObject | undefined; row: JsonObject | undefined }

/**
 * Every case judged in one run: each glTF put in the evidence store, its own document holding one item that names
 * it, its own claim with one requirement whose check input is geometry.shading with the case's fields, one verdict
 * per claim; with `planted`, the scenario's planted program.
 */
export function judge(bin: string, evidence: string, cases: Case[], planted?: string): Map<string, Judged> {
  const docs: JsonObject = {}; const claims: JsonObject = {}; const calls: JsonObject[] = [];
  cases.forEach((c, i) => {
    const sha = putEvidence(evidence, glb(c.prim));
    docs[docId(i + 1)] = { panel: 'main', document: sceneWith(sha) };
    claims[claimId(i + 1)] = { session: SESSION, deliverables: [docId(i + 1)], requirements: [{ id: reqId(i + 1), check: { kind: KIND, ...c.check } }] };
    calls.push({ call: 'verdict', claim: claimId(i + 1) });
  });
  const replies = run(bin, { evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs, claims, ...(planted ? { planted } : {}), calls });
  return new Map(cases.map((c, i) => {
    const v = replies[i]!;
    const rows = Array.isArray(v['requirements']) ? v['requirements'].filter(isObject) : [];
    const row = rows.find((r) => r['id'] === reqId(i + 1));
    const results = row && Array.isArray(row['results']) ? row['results'].filter(isObject) : [];
    const reading = results.find((r) => r['item'] === ITEM && r['doc'] === docId(i + 1));
    const issues = (row && Array.isArray(row['issues']) ? row['issues'].filter(isObject) : []).map((o) => ({
      code: String(o['code']), severity: String(o['severity']), ids: Array.isArray(o['ids']) ? o['ids'].map(String) : [], raw: o,
    }));
    return [c.name, { name: c.name, result: String(row?.['result']), issues, reading, row }];
  }));
}

/** The judged case named `name`. */
export function the(judged: Map<string, Judged>, name: string): Judged {
  const j = judged.get(name);
  if (!j) throw Error(`no case ${name}`);
  return j;
}

// ---------------------------------------------------------------------------------------------------
// Readings (README: The surface under test)

const num = (v: JsonValue | undefined): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const sorted = (xs: readonly string[]): string[] => [...xs].sort();

/** A number in the item's result, by path from it (`uv.uv1.uv_fill`, `islands`), or the failure that names what is missing. */
export function reading(j: Judged, path: string): { value: number | undefined; failures: string[] } {
  if (!j.reading) return { value: undefined, failures: [`${j.name}: geometry.shading reported no result for ${ITEM}, so no ${path} (row: ${brief(j.row ?? null, 600)})`] };
  let at: JsonValue | undefined = j.reading;
  for (const key of path.split('.')) at = isObject(at) ? at[key] : undefined;
  const value = num(at);
  return value === undefined ? { value, failures: [`${j.name}: ${path} is ${brief(at ?? null, 200)}, not a number`] } : { value, failures: [] };
}

/** An ID list in the item's result, by path (`uv.uv1.ids.uv_overlap`, `ids.hidden_faces`), exactly `expected` in any order. Each failure names the path. */
export function idsFailures(j: Judged, path: string, expected: readonly string[]): string[] {
  let at: JsonValue | undefined = j.reading;
  for (const key of path.split('.')) at = isObject(at) ? at[key] : undefined;
  if (!Array.isArray(at)) return [`${j.name}: ${path} is ${brief(at ?? null, 200)}, not a list naming ${JSON.stringify(expected)}`];
  const got = sorted(at.map(String));
  return JSON.stringify(got) === JSON.stringify(sorted(expected)) ? [] : [`${j.name}: ${path} names ${JSON.stringify(got)}, not ${JSON.stringify(sorted(expected))}`];
}

/** A number within `tolerance` of `expected`. The failure names the path. */
export function nearFailures(j: Judged, path: string, expected: number, tolerance: number): string[] {
  const { value, failures } = reading(j, path);
  if (value === undefined) return failures;
  return Math.abs(value - expected) <= tolerance ? [] : [`${j.name}: ${path} is ${value}, not ${expected} within ${tolerance}`];
}

/** The requirement FAIL, with an error naming the item whose code, text or actual names `name`. Each failure names `name`. */
export function failsOn(j: Judged, name: string): string[] {
  const failures: string[] = [];
  if (j.result !== 'FAIL') failures.push(`${j.name}: geometry.shading is ${j.result}, not FAIL on ${name}: ${brief(j.row ?? null, 800)}`);
  const named = j.issues.some((i) => i.severity === 'error' && i.ids.includes(ITEM) && JSON.stringify([i.raw['code'], i.raw['what'], i.raw['actual']] as JsonValue).includes(name));
  if (!named) failures.push(`${j.name}: no error on ${ITEM} names ${name}: ${brief(j.issues.map((i) => i.raw), 800)}`);
  return failures;
}

/** The requirement PASS. The failure names `name`, the reading it passes on. */
export function passesOn(j: Judged, name: string): string[] {
  return j.result === 'PASS' ? [] : [`${j.name}: geometry.shading is ${j.result}, not PASS on ${name}: ${brief(j.issues.map((i) => i.raw), 800)}`];
}
