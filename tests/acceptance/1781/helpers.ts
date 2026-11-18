// Test-side tools for the #1781 acceptance tests: `deep-show` built per Cargo feature set (the `full` set, and
// `full` with the fixture builder's `test-attrs`) and driven by one JSON line (#393's `deep-show run`, #403's
// claims and `verdict`); scene documents an agent presents (#420's builders as item kinds and their modifier
// stacks); the `geometry.attributes` check input, its requirement's row, the arrays it read and its issues; and a
// revision's own issues, refusals among them (README: The surface under test). Nothing here stands in for a
// builder, a modifier, a field or the check: every array a test compares comes from the binary, and every expected
// value from the issue's text and the design (reference.ts).

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import type { Attribute, V3 } from './reference.ts';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1781 is three levels down). */
const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const SHOW = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

/** Every `it` passes this: a test starts up to four `deep-show` processes on a machine that may be loaded. */
export const TIMEOUT = 7_200_000;
/** Every build hook passes this: a first build of `deep-show` takes many minutes under load. */
const BUILD_TIMEOUT = 7_200_000;
/** One `deep-show run` process. */
const RUN_TIMEOUT = 900_000;

/** The planted wrong programs this suite names (README: The planted programs), each the scenario's `planted`. */
export const PLANTED = {
  f32: 'attrs_kept_as_f32',
  corners: 'subdivide_corners_per_point',
  edgePoint: 'subdivide_edge_copies_end',
  averages: 'subdivide_averages_whole',
  drops: 'subdivide_drops_edge_attrs',
  wholeDomain: 'store_ignores_on',
  keepsEarlier: 'store_nonfinite_keeps_earlier',
} as const;
type Planted = (typeof PLANTED)[keyof typeof PLANTED];

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 2000): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
const list = (o: JsonObject, k: string): JsonObject[] => { const v = o[k]; return Array.isArray(v) ? v.filter(isObject) : []; };
const strings = (v: JsonValue | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const same = (a: JsonValue | undefined, b: JsonValue): boolean => JSON.stringify(a) === JSON.stringify(b);

/** No problems; the message lists them. */
export function none(problems: readonly string[], what: string): void {
  expect(problems, `${what}:\n  ${problems.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one problem, and one that holds each of `names`: what a planted program must give. */
export function failsNaming(problems: readonly string[], names: readonly string[], what: string): void {
  expect(problems.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(problems.some((p) => p.includes(name)), `${what}: a problem names ${name}; the problems were:\n  ${problems.slice(0, 40).join('\n  ')}`).toBe(true);
  }
}

// ---------------------------------------------------------------------------------------------------
// The binary: `deep-show` per Cargo feature set, built once per file and copied out under its own name.

type Feature = 'full' | 'test-attrs';
/** The full build set. */
export const FULL: Feature[] = ['full'];
/** The full set and the test build's fixture builder, `test.attrs@1`. */
export const ATTRS: Feature[] = ['full', 'test-attrs'];
const cargoArgs = (features: Feature[]): string[] => ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', features.join(',')];

/** Builds `deep-show` with `features` before the file's test; a test whose build failed fails with cargo's error. */
export function useShow(features: Feature[]): () => string {
  const args = cargoArgs(features);
  let dir = '';
  let error = 'the build never ran';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1781-bin-'));
    const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
    const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    if (r.error) error = `cargo could not run: ${r.error.message}`;
    else if (r.status !== 0) {
      const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
      error = `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}`;
    } else {
      copyFileSync(join(TARGET, 'debug', exe(SHOW)), join(dir, exe(`${SHOW}-${features.join('+')}`)));
      error = '';
    }
  }, BUILD_TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    expect(error, `the binary builds: cargo ${args.join(' ')}`).toBe('');
    return join(dir, exe(`${SHOW}-${features.join('+')}`));
  };
}

/** Fresh folders for a test (each run's evidence store), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1781-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** One `deep-show run` process: its replies, one per call. */
function run(bin: string, scenario: JsonObject): JsonObject[] {
  const what = `${SHOW} run${typeof scenario['planted'] === 'string' ? ` (planted ${scenario['planted']})` : ''}`;
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: RUN_TIMEOUT, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${what}: ${r.error.message}`);
  expect(timedOut, `${what} finished within its timeout`).toBe(false);
  expect(r.status, `${what} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one output line per input line`).toBe(1);
  const out = JSON.parse(lines[0]!) as JsonValue;
  expect(isObject(out), `${what}: the answer is an object, got ${brief(out)}`).toBe(true);
  const answer = out as JsonObject;
  expect(answer['ok'], `${what} refused the scenario: ${brief(answer, 3000)}`).toBe(true);
  const replies = Array.isArray(answer['replies']) ? answer['replies'] : [];
  const calls = Array.isArray(scenario['calls']) ? scenario['calls'].length : 0;
  expect([replies.length, replies.every(isObject)], `${what}: one reply per call, each an object: ${brief(answer)}`).toEqual([calls, true]);
  return replies as JsonObject[];
}

// The world a scenario holds: the working agent alpha, the process table, one panel every document sits in.
const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Agent alpha: attributes', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
const PANELS: JsonObject = { main: { rect: [0, 0, 800, 600] } };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
const docId = (n: number): string => ulid('01JB1781D', n);
const claimId = (n: number): string => `claim:${ulid('01JB1781C', n)}`;
const reqId = (n: number): string => `req:${ulid('01JB1781Q', n)}`;

function scenarioOf(evidence: string, docs: string[], claims: JsonObject | null, calls: JsonObject[], planted?: Planted): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS,
    docs: Object.fromEntries(docs.map((d) => [d, { panel: 'main' }])),
    ...(claims ? { claims } : {}), ...(planted ? { planted } : {}), calls,
  };
}
/** Alpha's `deep_show`: a whole revision of `document`, with its issues (#393). */
const show = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc, document, include: ['issues'] });

/** One process: alpha presents each of `documents` as a revision of a document of its own. The replies, in order. */
export function present(bin: string, evidence: string, documents: JsonObject[], planted?: Planted): JsonObject[] {
  const docs = documents.map((_, k) => docId(k + 1));
  return run(bin, scenarioOf(evidence, docs, null, documents.map((document, k) => show(docs[k]!, document)), planted));
}

/** What one judged document answered: the `deep_show` reply and the claim's verdict. */
export interface Judged { shown: JsonObject; verdict: JsonObject }
/**
 * One process: alpha presents `document`, then alpha's claim, whose one deliverable is that document and whose
 * locked definition holds one requirement per check of `checks`, is judged (`verdict`).
 */
export function judge(bin: string, evidence: string, document: JsonObject, checks: JsonObject[], planted?: Planted): Judged {
  const [doc, claim] = [docId(1), claimId(1)];
  const requirements = checks.map((check, i) => ({ id: reqId(i + 1), check }));
  const claims: JsonObject = { [claim]: { session: ALPHA.id, deliverables: [doc], requirements } };
  const [shown, verdict] = run(bin, scenarioOf(evidence, [doc], claims, [show(doc, document), { call: 'verdict', claim }], planted));
  return { shown: shown!, verdict: verdict! };
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: Fixtures). Metres, +Y up. An agent's payload: no `id`, no `layers`.

/** A scene document around `items`, with a still camera. */
export function sceneDoc(title: string, items: Record<string, JsonObject>): JsonObject {
  const all: Record<string, JsonObject> = { cam: { kind: 'camera@1', params: { projection: 'perspective', position: [3, 3, 4], target: [0, 0.5, 0], fov: 40 } }, ...items };
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(all)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #1781 acceptance fixture.`, size: [480, 360], camera: 'cam',
    requires: { modules: { scene3d: '^1' } }, items: withIds,
  };
}
/** The one item every fixture document holds beside its camera. */
export const BOX = 'box';
const stacked = (modifiers: JsonObject[]): JsonObject => (modifiers.length ? { modifiers } : {});
/** The 1 m slab box with `shade: flat`: `slab@1 {size: [1, 1, 1]}`, its points at x and z = ±0.5 m. */
export const slabBox = (modifiers: JsonObject[]): JsonObject => ({ kind: 'slab@1', params: { size: [1, 1, 1], shade: 'flat' }, ...stacked(modifiers) });
/** The fixture builder's 1 m box with the attributes its params list. */
export const attrsBox = (attributes: Attribute[], modifiers: JsonObject[] = []): JsonObject => ({ kind: 'test.attrs@1', params: { attributes }, ...stacked(modifiers) });

/** `mod.store@1 {name, domain, type, field, fallback}`; `on` is the modifier's own, as every modifier takes it. */
export const store = (name: string, domain: string, type: string, field: string, o: { fallback?: number; on?: string } = {}): JsonObject => ({
  kind: 'mod.store@1', ...(o.on === undefined ? {} : { on: o.on }),
  params: { name, domain, type, field, ...(o.fallback === undefined ? {} : { fallback: o.fallback }) },
});
/** Three f32 stores, `<prefix>x`, `<prefix>y` and `<prefix>z`: each element's own position on `domain`. */
export const positions = (prefix: string, domain: 'point' | 'corner'): JsonObject[] =>
  ['x', 'y', 'z'].map((a) => store(`${prefix}${a}`, domain, 'f32', `position.${a}`));
/** `subdivide {levels: 1, scheme: simple}`. */
export const SUBDIVIDE: JsonObject = { kind: 'mod.subdivide@1', params: { levels: 1, scheme: 'simple' } };
/** `array {count: 3, offset: [2, 0, 0]}`: three copies 2 m apart. */
export const ARRAY: JsonObject = { kind: 'mod.array@1', params: { count: 3, offset: [2, 0, 0] } };

// ---------------------------------------------------------------------------------------------------
// The check input (README: The check, as a claim's requirement)

/** The check kind under test. */
const KIND = 'geometry.attributes';
/** What `expect` holds for one attribute. */
type Expected = { domain: string; type: string; count: number; values: JsonValue[] };
/** `geometry.attributes {of, after}` with no `expect`: a reading of the mesh modifier `after` leaves, or the whole stack's. */
export const reading = (of: string, after?: number): JsonObject => ({ kind: KIND, of, ...(after === undefined ? {} : { after }) });
/** `geometry.attributes {of, expect}` on the mesh the whole stack leaves. */
export const expecting = (of: string, expected: Record<string, Expected>): JsonObject => ({ kind: KIND, of, expect: expected });

// ---------------------------------------------------------------------------------------------------
// The verdict's row (README: The verdict's row)

/** The issue code of an attribute that differs from what `expect` gives, or that the mesh lacks. */
const DIFFERS = 'geometry.attribute';
/** One array the check read: `{attribute, domain, type, count, values}`. */
interface Read { attribute: string; domain: string; type: string; count: JsonValue | undefined; values: JsonValue[]; raw: JsonObject }
/** One `geometry.attribute` issue: `{attribute, element, expected, actual}` on the issue itself. */
interface Differs { attribute: string; element: JsonValue | undefined; expected: JsonValue | undefined; actual: JsonValue | undefined; raw: JsonObject }
interface Row { result: string; reads: Read[]; differs: Differs[]; raw: JsonObject }

/** The row of the claim's requirement `i` (the i-th check given to `judge`). */
export function rowAt(judged: Judged, i: number, what: string): Row {
  const raw = list(judged.verdict, 'requirements').find((r) => r['id'] === reqId(i + 1));
  expect(raw, `${what}: the verdict has a row for its requirement: ${brief(judged.verdict)}`).toBeDefined();
  return {
    result: String(raw!['result']), raw: raw!,
    reads: list(raw!, 'results').map((r) => ({
      attribute: String(r['attribute']), domain: String(r['domain']), type: String(r['type']), count: r['count'], values: Array.isArray(r['values']) ? r['values'] : [], raw: r,
    })),
    differs: list(raw!, 'issues').filter((i) => i['code'] === DIFFERS).map((i) => ({ attribute: String(i['attribute']), element: i['element'], expected: i['expected'], actual: i['actual'], raw: i })),
  };
}
/** The row is decided as `result`; the message carries the row. */
export function decided(row: Row, result: 'PASS' | 'FAIL' | 'INCONCLUSIVE', what: string): void {
  expect(row.result, `${what} is ${result}: ${brief(row.raw, 3000)}`).toBe(result);
}
/** The array the row read for `attribute`, which must be of `domain` and `type` and hold `count` values. */
export function readOf(row: Row, attribute: string, want: { domain: string; type: string; count: number }, what: string): Read {
  const read = row.reads.find((r) => r.attribute === attribute);
  expect(read, `${what}: the row's results hold the attribute ${attribute}; they hold ${row.reads.map((r) => r.attribute).join(', ') || 'none'}`).toBeDefined();
  expect([read!.domain, read!.type, read!.count, read!.values.length], `${what}: ${attribute} reads back with its domain, type and count, one value per element: ${brief(read!.raw, 600)}`)
    .toEqual([want.domain, want.type, want.count, want.count]);
  return read!;
}
/** A scalar array's values, each a finite number. */
export function numbers(read: Read, what: string): number[] {
  expect(read.values.every((v) => typeof v === 'number' && Number.isFinite(v)), `${what}: every value of ${read.attribute} is a finite number: ${brief(read.values)}`).toBe(true);
  return read.values as number[];
}
/** Each element's position on `domain`, from the three f32 arrays `positions(prefix, domain)` stored. */
export function placesOf(row: Row, prefix: string, domain: 'point' | 'corner', count: number, what: string): V3[] {
  const [x, y, z] = ['x', 'y', 'z'].map((a) => numbers(readOf(row, `${prefix}${a}`, { domain, type: 'f32', count }, what), what));
  return x!.map((_, i) => [x![i]!, y![i]!, z![i]!]);
}

// ---------------------------------------------------------------------------------------------------
// A revision's own issues (README: Issues a revision raises)

interface Issue { code: string; severity: string; path: string; ids: string[]; raw: JsonObject }
export const issuesOf = (reply: JsonObject): Issue[] =>
  list(reply, 'issues').map((o) => ({ code: String(o['code']), severity: String(o['severity']), path: typeof o['path'] === 'string' ? o['path'] : '', ids: strings(o['ids']), raw: o }));
/** A field an issue names: on the issue itself, or in its `actual` when that is an object (the tests read either). */
export const named = (issue: Issue, key: string): JsonValue | undefined => issue.raw[key] ?? (isObject(issue.raw['actual']) ? issue.raw['actual'][key] : undefined);

/** The revision was presented: no error issue, and no item skipped as an unknown kind. */
export function admitted(reply: JsonObject, what: string): void {
  expect(issuesOf(reply).filter((i) => i.severity === 'error').map((i) => brief(i.raw, 600)), `${what}: no error issue`).toEqual([]);
  expect(list(reply, 'notices').filter((n) => n['code'] === 'unknown_kind').map((n) => brief(n, 600)), `${what}: no item skipped as an unknown kind`).toEqual([]);
  expect(reply['outcome'], `${what}: presented, got ${brief(reply)}`).toBe('presented');
}

/** A refusal: an error issue of `code` (any code when null) whose path is `at` or under it, naming each of `names`. */
export interface Refusal { code: string | null; at: string; names?: Record<string, JsonValue> }
/** Why `reply` isn't that refusal: the revision wasn't refused, or no such issue names what it must. */
export function refusalProblems(reply: JsonObject, what: string, r: Refusal): string[] {
  const names = Object.entries(r.names ?? {});
  const wanted = `an error issue${r.code ? ` ${r.code}` : ''} at ${r.at}${names.length ? ` naming ${names.map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(', ')}` : ''}`;
  const out: string[] = [];
  if (reply['outcome'] !== 'refused') out.push(`${what}: the revision is ${String(reply['outcome'])}, not refused by ${wanted}`);
  const errors = issuesOf(reply).filter((i) => i.severity === 'error');
  const hit = errors.some((i) => (r.code === null || i.code === r.code) && (i.path === r.at || i.path.startsWith(`${r.at}/`)) && names.every(([k, v]) => same(named(i, k), v)));
  if (!hit) out.push(`${what}: it has no ${wanted}; its error issues: ${brief(errors.map((i) => i.raw))}`);
  return out;
}
