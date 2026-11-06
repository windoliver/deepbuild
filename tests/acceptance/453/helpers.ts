// Test-side tools for the #453 acceptance tests: `deep-show` built in the full build set and driven by JSON
// lines (#393's convention, #403's claims, requirements and verdicts); a scene document of `mesh.asset@1` items
// whose glTF files sit in the evidence store by SHA-256 (as `geometry` reads them, #420); reading
// geometry.shading's requirement rows, their `results` and `blocked` (README: The surface under test); and the
// checks each criterion's wrong program must fail, each returning its failures as sentences that name what
// failed. Nothing here stands in for geometry.shading, the loop module or a verdict.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { glb, type Spec } from './gltf.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/453 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';
const BUILT = join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', process.platform === 'win32' ? `${SHOW_NAME}.exe` : SHOW_NAME);

/** The criteria's tags: `#453.` and the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: '#453.c5097296 AC1',
  2: '#453.061ce907 AC2',
  3: '#453.e9d7118c AC3',
  4: '#453.bb73e219 AC4',
  5: '#453.c8592e0f AC5',
} as const;

export const KIND = 'geometry.shading';
/** The issue's Result fields, each a count with up to 64 face, vertex or edge IDs. */
export const DEFECTS = ['non_manifold_edges', 'non_manifold_vertices', 'inconsistent_edges', 'flipped_faces', 'degenerate_faces', 'boundary_edges'] as const;
export type Defect = (typeof DEFECTS)[number];
/** The most IDs a result lists per field. */
export const MAX_IDS = 64;

/** Scenario `planted` values this suite adds (README: planted values). */
export type Planted = 'no_weld' | 'one_winding_sum' | 'degenerate_exact_zero' | 'outward_skips_volume' | 'vertex_fans_skipped' | 'unreadable_skipped' | 'quad_fails_rigid' | 'pair_ignores_corners';

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export const brief = (value: JsonValue | undefined, n = 1200): string => (JSON.stringify(value) ?? 'undefined').slice(0, n);

/** No failures; the message lists them, each naming what failed. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}

/** At least one failure, and one that names each of `names`: what a wrong program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  }
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` in the full build set, built once per file (#403's suite, without test features).

export interface Builds { bin: () => string }

export function useBuild(): Builds {
  let dir = '';
  let error = '';
  let bin = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-453-bin-'));
    const args = ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', 'full'];
    const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
    const run = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished/.test(l)).join('\n')}`;
    else { bin = join(dir, `${SHOW_NAME}-full`); copyFileSync(BUILT, bin); }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(): string {
      expect(error, `the binary builds: ${SHOW_NAME} with features full`).toBe('');
      return bin;
    },
  };
}

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-453-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** Keeps `bytes` in the evidence store at `<first 2 hex>/<other 62 hex>` (deep-show's `evidence::put` layout); its SHA-256. */
export function putEvidence(root: string, bytes: Uint8Array): string {
  const sha = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(join(root, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(root, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300_000, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`${SHOW_NAME} run: ${r.error.message}`);
  expect(r.status, `${SHOW_NAME} run exits 0 (${r.signal ?? 'no signal'}); stderr: ${(r.stderr ?? '').slice(0, 2000)}`).toBe(0);
  const lines = r.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${brief(out, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((x, i) => obj(x, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(scenario['calls'], "the scenario's calls").length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The world: one agent's session, the process table, a panel; one document and one claim per case.

const SESSION = 'sess-alpha';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: asset checks', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 4100, ppid: 3000, start: 1_000 }];
const PANELS: JsonObject = { main: { rect: [0, 0, 800, 600] } };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB45D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB45C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB45Q', n)}`;
/** The one item each case's document holds. */
export const ITEM = 'asset';

/** A scene document as the last release stored it (opened as revision 0): one `mesh.asset@1` item naming the glTF by hash, node 0. */
export function sceneWith(sha256: string): JsonObject {
  return {
    format: 1, profile: 'scene', title: 'Asset check', description: 'One glTF asset, held to geometry.shading.', size: [480, 360],
    requires: { modules: { scene3d: '^1' } },
    layers: { 'you-main': { writer: 'you:you', title: 'You', order: 'a0' } },
    items: { [ITEM]: { id: ITEM, kind: 'mesh.asset@1', name: 'Asset', order: 'a0', layer: 'you-main', params: { sha256, node: 0, paint: { fill: { role: 'accent' } } } } },
  };
}

/** One fixture to judge: its glTF, and the geometry.shading check input's fields beyond `kind` (none: every default). */
export interface Case { name: string; spec: Spec; check?: JsonObject }

/** What one case's verdict said. */
export interface Judged { name: string; doc: string; verdict: string; row: Row | undefined; result: ShadingResult | undefined; raw: JsonObject }

/**
 * Every case judged in one run: each glTF put in the evidence store, its own document holding one item that
 * names it, its own claim with one requirement whose check input is geometry.shading, and one verdict per claim.
 */
export function judge(bin: string, evidence: string, cases: Case[], planted?: Planted): Map<string, Judged> {
  const docs: JsonObject = {}; const claims: JsonObject = {}; const calls: JsonObject[] = [];
  cases.forEach((c, i) => {
    const sha = putEvidence(evidence, glb(c.spec));
    docs[docId(i + 1)] = { panel: 'main', document: sceneWith(sha) };
    claims[claimId(i + 1)] = { session: SESSION, deliverables: [docId(i + 1)], requirements: [{ id: reqId(i + 1), check: { kind: KIND, ...(c.check ?? {}) } }] };
    calls.push({ call: 'verdict', claim: claimId(i + 1) });
  });
  const replies = run(bin, { evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs, claims, ...(planted ? { planted } : {}), calls });
  return new Map(cases.map((c, i) => {
    const v = replies[i]!;
    const rows = (Array.isArray(v['requirements']) ? v['requirements'] : []).filter(isObject).map(rowOf);
    const row = rows.find((r) => r.id === reqId(i + 1));
    const result = row?.results.find((r) => r.item === ITEM && r.doc === docId(i + 1));
    return [c.name, { name: c.name, doc: docId(i + 1), verdict: String(v['result']), row, result, raw: v }];
  }));
}

/** The judged case named `name`. */
export function the(judged: Map<string, Judged>, name: string): Judged {
  const j = judged.get(name);
  if (!j) throw Error(`no case ${name}`);
  return j;
}

// ---------------------------------------------------------------------------------------------------
// Replies (README: The surface under test)

export interface Issue { code: string; severity: string; ids: string[]; actual: JsonValue | undefined; fix: JsonValue | undefined; raw: JsonObject }
export interface Blocked { code: string; kind: string; ids: string[]; doc: string | null; item: string | null; primitive: number | null; why: string | null }
export interface ShadingResult {
  doc: string; item: string; welded_vertices: number | undefined; triangles: number | undefined;
  counts: Partial<Record<Defect, number>>; ids: Partial<Record<Defect | 'unpaired', string[]>>;
  signed_volume: number | null | undefined; quad_ratio: number | undefined; unpaired: number | undefined; raw: JsonObject;
}
export interface Row { id: string; kind: string; result: string; blocked: Blocked[]; issues: Issue[]; results: ShadingResult[]; raw: JsonObject }

const n = (v: JsonValue | undefined): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const s = (v: JsonValue | undefined): string | null => (typeof v === 'string' ? v : null);
const strings = (v: JsonValue | undefined): string[] | undefined => (Array.isArray(v) ? v.map(String) : undefined);

function resultOf(o: JsonObject): ShadingResult {
  const ids = isObject(o['ids']) ? o['ids'] : {};
  const counts: Partial<Record<Defect, number>> = {}; const lists: Partial<Record<Defect | 'unpaired', string[]>> = {};
  for (const d of DEFECTS) { const c = n(o[d]); if (c !== undefined) counts[d] = c; }
  for (const d of [...DEFECTS, 'unpaired'] as const) { const l = strings(ids[d]); if (l) lists[d] = l; }
  return {
    doc: String(o['doc']), item: String(o['item']), welded_vertices: n(o['welded_vertices']), triangles: n(o['triangles']), counts, ids: lists,
    signed_volume: o['signed_volume'] === null ? null : n(o['signed_volume']), quad_ratio: n(o['quad_ratio']), unpaired: n(o['unpaired']), raw: o,
  };
}

export function rowOf(o: JsonObject): Row {
  const list = (k: string) => (Array.isArray(o[k]) ? (o[k] as JsonValue[]).filter(isObject) : []);
  return {
    id: String(o['id']), kind: String(o['kind']), result: String(o['result']), raw: o,
    blocked: list('blocked').map((b) => ({
      code: String(b['code']), kind: String(b['kind']), ids: strings(b['ids']) ?? [], doc: s(b['doc']), item: s(b['item']),
      primitive: n(b['primitive']) ?? null, why: s(b['why']),
    })),
    issues: list('issues').map((i) => ({ code: String(i['code']), severity: String(i['severity']), ids: strings(i['ids']) ?? [], actual: i['actual'], fix: i['fix'], raw: i })),
    results: list('results').map(resultOf),
  };
}

// ---------------------------------------------------------------------------------------------------
// The criteria's checks, each returning its failures as sentences naming what failed.

const sorted = (xs: readonly string[]) => [...xs].sort();

/** `kind` counted exactly `expected.length` times, naming exactly `expected` (each a face, vertex or edge ID). Each failure names the kind. */
export function defectFailures(j: Judged, kind: Defect, expected: readonly string[]): string[] {
  const r = j.result;
  if (!r) return [`${j.name}: geometry.shading reported no result for ${ITEM}, so no ${kind} count (row: ${brief(j.row?.raw ?? null, 600)})`];
  const failures: string[] = [];
  if (r.counts[kind] !== expected.length) failures.push(`${j.name}: ${kind} is ${String(r.counts[kind])}, not ${expected.length}`);
  const ids = r.ids[kind];
  if (!ids) failures.push(`${j.name}: ids.${kind} is missing`);
  else if (JSON.stringify(sorted(ids)) !== JSON.stringify(sorted(expected))) failures.push(`${j.name}: ids.${kind} names ${JSON.stringify(sorted(ids))}, not ${JSON.stringify(sorted(expected))}`);
  return failures;
}

/** Every defect count zero with no IDs, and the requirement PASS. Each failure names the field. */
export function cleanFailures(j: Judged): string[] {
  const failures = DEFECTS.flatMap((d) => defectFailures(j, d, []));
  if (j.row?.result !== 'PASS') failures.push(`${j.name}: the geometry.shading requirement is ${String(j.row?.result)}, not PASS: ${brief(j.row?.raw ?? null, 800)}`);
  return failures;
}

/** The welded vertex count. The failure names welded_vertices. */
export function weldFailures(j: Judged, expected: number): string[] {
  const w = j.result?.welded_vertices;
  return w === expected ? [] : [`${j.name}: welded_vertices is ${String(w)}, not ${expected}`];
}

/** BLOCKED naming the item, the primitive and why, never PASS. Each failure names `primitive <p>`. */
export function blockedFailures(j: Judged, primitive: number, why: string): string[] {
  const failures: string[] = [];
  if (!j.row) return [`${j.name}: the verdict has no row for the geometry.shading requirement, so primitive ${primitive} is never named`];
  if (j.row.result !== 'BLOCKED') failures.push(`${j.name}: geometry.shading is ${j.row.result}, not BLOCKED, on the mesh whose primitive ${primitive} it can't read (${why})`);
  if (!j.row.blocked.some((b) => b.code === 'mesh_unreadable' && b.kind === KIND && b.item === ITEM && b.doc === j.doc && b.ids.includes(ITEM) && b.primitive === primitive && b.why === why)) {
    failures.push(`${j.name}: nothing BLOCKED names mesh_unreadable on ${ITEM}, primitive ${primitive}, why ${why}: ${JSON.stringify(j.row.blocked)}`);
  }
  if (j.verdict === 'PASS') failures.push(`${j.name}: the claim is PASS while primitive ${primitive} goes unread`);
  return failures;
}

/** A requirement FAIL with an error issue of `code` naming the item. Each failure names the code. */
export function failedWith(j: Judged, code: string): { failures: string[]; issue: Issue | undefined } {
  const issue = j.row?.issues.find((i) => i.code === code && i.severity === 'error' && i.ids.includes(ITEM));
  const failures: string[] = [];
  if (j.row?.result !== 'FAIL') failures.push(`${j.name}: geometry.shading is ${String(j.row?.result)}, not FAIL, so no ${code}`);
  if (!issue) failures.push(`${j.name}: no error ${code} names ${ITEM}: ${brief((j.row?.issues ?? []).map((i) => i.raw), 800)}`);
  return { failures, issue };
}
