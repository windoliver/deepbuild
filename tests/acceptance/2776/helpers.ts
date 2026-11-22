// Test-side tools for the #2776 acceptance tests (README: The surface under test): `deep-show` built per Cargo feature
// set with this suite's test canvas module (as #200's and #172's suites build it); the seal's startup refusal;
// `deep-show run` scenarios with `deep show`, the web export and `deep_kinds`; `deep-show kinds --dump`; and the paths
// lane, `node scripts/canvas-closures.mjs paths [--root <tree>]`, run on scratch trees and on the checkout, with the
// reference's Paths rows read and rewritten in the format the README gives. Nothing here stands in for the seal, the
// listing, the export or the lane: every verdict read here is the binary's or the script's own. The `...Failures`
// functions are the criteria's checks: each returns sentences naming what failed, so a test runs it on the right
// program (no failures) and on the criterion's planted program (a failure naming what the criterion says).

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2776 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');

/** Each criterion's ID: `#2776.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #2776.e33547f5',
  2: 'AC2 #2776.43b1fe3a',
  3: 'AC3 #2776.c440ce00',
  4: 'AC4 #2776.cab3192b',
  5: 'AC5 #2776.9ecba479',
  6: 'AC6 #2776.c726fb11',
  7: 'AC7 #2776.95a7c6cc',
  8: 'AC8 #2776.7c0bede8',
} as const;

/** Every test's timeout, as #200's: freshly built binaries, whose first exec on macOS alone can take seconds. */
export const TIMEOUT = 1_800_000;
/** The file's builds, in beforeAll. */
const BUILD_TIMEOUT = 7_200_000;

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 600)}`).toBe('string');
  return v as string;
}
const sorted = (list: readonly string[]): string[] => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
/** One canonical text per JSON value (keys sorted at every depth), so "the same answer" is one string comparison. */
export function canon(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (isObject(value)) return `{${sorted(Object.keys(value)).map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const readJson = (path: string): JsonValue => JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
export function writeJson(path: string, value: JsonValue): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names every one of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  expect(failures.some((f) => names.every((n) => f.includes(n))), `${what}: one failure names ${names.join(' and ')}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// The answers (README: The answers as data). The three paths, in the order every line and listing gives them.

export const PATHS = ['rays', 'final', 'web'] as const;
export type PathName = (typeof PATHS)[number];
export const KINDS_OF_ANSWER = ['same', 'stand_in', 'refused', 'not_applicable'] as const;
/** The refusal code where the design is silent (the issue's Scope and Fields). */
export const UNDEFINED = 'path_undefined';

// The test canvas module `test.paths` (README: Test canvas modules and features of deep-show).
export const MODULE = 'test.paths';
export const GLOW = 'test.paths.glow@1';
export const HALO = 'test.paths.halo@1';
export const MIST = 'test.paths.mist@1';
/** The open task the test module's path_undefined answers name (an issue number only; any would do). */
export const TASK = '#2759';
/** glow's own web refusal code. */
export const NO_WEB = 'test.paths.no_web';
/** The fixture that holds glow's `same`: the test module's fixture `glow`, as `<module>/<fixture>`. */
export const GLOW_FIXTURE = 'test.paths/glow';
export const GLOW_WHY = 'drawn after lighting, as in the real-time export';
export const HALO_DRAWS = 'nothing, the web player leaves the halo out';
export const HALO_RECEIPT = 'halo left out';
const undefinedFor = (task: string): JsonObject => ({ answer: 'refused', code: UNDEFINED, task });
/** Each test kind's three answers, as the module declares them and deep_kinds returns them. */
export const ANSWERS: Record<string, Record<PathName, JsonObject>> = {
  [GLOW]: {
    rays: { answer: 'same', held_by: GLOW_FIXTURE },
    final: { answer: 'not_applicable', why: GLOW_WHY },
    web: { answer: 'refused', code: NO_WEB },
  },
  [HALO]: {
    rays: undefinedFor(TASK),
    final: undefinedFor(TASK),
    web: { answer: 'stand_in', draws: HALO_DRAWS, receipt: HALO_RECEIPT },
  },
  [MIST]: { rays: undefinedFor(TASK), final: undefinedFor(TASK), web: undefinedFor(TASK) },
};

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-show` per Cargo feature set, built once per file, each kept under its own name.

/** cargo on PATH: the pinned toolchain's folder first when it is there (as #172's helpers do). */
const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
if (existsSync(TOOLCHAIN) && !(process.env['PATH'] ?? '').split(':').includes(TOOLCHAIN)) process.env['PATH'] = `${TOOLCHAIN}:${process.env['PATH'] ?? ''}`;
/** Builds stay light on the shared Mac: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');

/** The full set with the test module `test.paths` (AC1's twin, AC6, AC7). */
export const PATHS_BUILD = 'full,test-paths';
/** The full set with `test.paths` whose `test.paths.mist@1` declares no answer for a final (AC1). */
export const NO_FINAL_BUILD = 'full,test-paths-no-final';

function build(features: string, to: string): string {
  const args = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', features];
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l));
    return `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}`;
  }
  copyFileSync(join(TARGET, 'debug', 'deep-show'), to);
  return '';
}
/** `deep-show` of each feature set, built once in the file's beforeAll; a test that asks for a build that failed fails with cargo's error. */
export function useBuilds(sets: readonly string[]): (set: string) => string {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2776-bins-'));
    for (const s of sets) if (!made.has(s)) { const bin = join(dir, `deep-show-${s.replace(/,/g, '+')}`); made.set(s, { bin, error: build(s, bin) }); }
  }, BUILD_TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (s: string): string => {
    const e = made.get(s);
    if (!e) throw Error(`the file didn't list the build ${s} in useBuilds`);
    expect(e.error, `the binary builds: deep-show with features ${s}`).toBe('');
    return e.bin;
  };
}

/** Fresh folders for a test (evidence stores, export outputs, dumps), all deleted after it. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-2776-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// Starting the binary: JSON lines in, one JSON line out per line in; or one refusal line and exit 2.

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
export function start(bin: string, args: string[], inputs: JsonValue[], timeoutMs = TIMEOUT - 300_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const r = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`deep-show ${args.join(' ')}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, signal: r.signal, timedOut, lines, stdout, stderr: r.stderr ?? '' };
}

// The world the scenarios share (#200's): your shell, an agent's session and the process table.
const ALPHA = { id: 'sess-2776', thread: 'thread-2776', name: 'Test agent: the paths row', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };

/** A scenario with your shell, the agent's session, `docs` each in a panel of its own, and the scenario's `planted` key. */
export function scenario(evidence: string, docs: readonly string[], calls: JsonObject[], planted?: string): JsonObject {
  const panels: JsonObject = {};
  const onPanels: JsonObject = {};
  docs.forEach((d, k) => { panels[`p${k}`] = { rect: [0, 0, 640, 360] }; onPanels[d] = { panel: `p${k}` }; });
  if (!docs.length) panels['main'] = { rect: [0, 0, 640, 360] };
  return {
    evidence, sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } }, processes: PROCESSES,
    panels, docs: onPanels, ...(planted ? { planted } : {}), calls,
  };
}
/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function run(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const s = start(bin, ['run'], [sc]);
  expect(s.timedOut, `${what}: deep-show run finished within its timeout`).toBe(false);
  expect(s.status, `${what}: deep-show run starts and exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${what}: deep-show run writes one answer line`).toBe(1);
  const answer = obj(s.lines[0], `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run takes the scenario${sc['planted'] ? ` (planted ${String(sc['planted'])})` : ''}: ${show(answer, 3000)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The seal (#305, #185, #200): a startup with one `registry` call, sealed or refused.

/** A startup the seal refuses exits with this status, after one JSON line (#305). */
export const REFUSED_EXIT = 2;
/** The seal's reason for a 3D entry with no answer for a path (README: The seal's refusal). */
export const UNANSWERED = 'path_unanswered';

export function startup(bin: string): Started {
  const s = start(bin, ['run'], [{ evidence: tmpdir(), calls: [{ call: 'registry' }] }]);
  expect(s.timedOut, 'deep-show run (startup) finished within its timeout').toBe(false);
  return s;
}
/**
 * The seal refused the build as the criterion says: exit 2 and one line `{"ok": false, "code": "seal_refused",
 * "reason": "path_unanswered", "entry", "path", ...}` naming `entry` and `path`. Each failure names the entry.
 */
export function sealRefusalFailures(s: Started, entry: string, path: PathName): string[] {
  if (s.status !== REFUSED_EXIT) return [`${entry}: the startup exited ${s.status} (${s.signal ?? 'no signal'}), not ${REFUSED_EXIT} with the seal's refusal; stdout: ${s.stdout.slice(0, 800)}`];
  if (s.lines.length !== 1 || !isObject(s.lines[0])) return [`${entry}: the refusal is not one JSON line: ${s.stdout.slice(0, 800)}`];
  const line = s.lines[0];
  const failures: string[] = [];
  if (line['ok'] !== false || line['code'] !== 'seal_refused') failures.push(`${entry}: the line is not the seal's refusal: ${show(line)}`);
  if (line['reason'] !== UNANSWERED) failures.push(`${entry}: the refusal's reason is ${show(line['reason'])}, not ${UNANSWERED}: ${show(line)}`);
  if (line['entry'] !== entry) failures.push(`${entry}: the refusal names the entry ${show(line['entry'])}, not ${entry}: ${show(line)}`);
  if (line['path'] !== path) failures.push(`${entry}: the refusal names the path ${show(line['path'])}, not ${path}: ${show(line)}`);
  return failures;
}
/** The build sealed: exit 0, and its `registry` reply lists `module` among the sealed modules. */
export function sealedFailures(s: Started, module: string, what: string): string[] {
  if (s.status !== 0) return [`${what} did not seal: exit ${s.status}; ${s.stdout.slice(0, 800)} ${s.stderr.slice(-400)}`];
  const answer = isObject(s.lines[0]) ? s.lines[0] : {};
  const reply = Array.isArray(answer['replies']) && isObject(answer['replies'][0]) ? answer['replies'][0] : {};
  const modules = Array.isArray(reply['modules']) ? reply['modules'] : [];
  return modules.includes(module) ? [] : [`${what} sealed without the module ${module}: ${show(reply['modules'])}`];
}

// ---------------------------------------------------------------------------------------------------
// Documents and calls: a 3D scene holding one item of a test kind, shown from your shell, and its web export.

const ulid = (k: number): string => `01JB2776D${String(k).padStart(17, '0')}`;
export const DOC = { glow: ulid(1), halo: ulid(2), mist: ulid(3) } as const;

/** A 3D scene of 320 × 180 with a camera, a floor box (scene3d's) and the item `item` of the test kind `kind`. */
export function scene(id: string, title: string, kind: string, item: string): JsonObject {
  const items: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0000', params: { projection: 'perspective', position: [0, 1.5, 4], target: [0, 0.25, 0], fov: 40 } },
    { id: 'floor', kind: 'mark.box@1', name: 'Floor', order: 'a0001', params: { size: [4, 0.1, 4] }, at: { pos: [0, -0.05, 0] } },
    { id: item, kind, name: item, order: 'a0002', params: { size: [0.5, 0.5, 0.5] }, at: { pos: [0, 0.25, 0] } },
  ];
  return {
    format: 1, id, profile: 'scene', title, description: `${title}: a piece the #2776 acceptance tests export to the web.`, size: [320, 180],
    camera: 'cam', seed: 2776, transport: { span: '1s', frame_rate: [30, 1] }, requires: { modules: { scene3d: '^1', [MODULE]: '^1' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
  };
}
/** `deep show` of a whole revision from your shell, with its issues. */
export const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, document: clone(document), include: ['issues'] });
/** The revision is presented, with no item skipped as a kind the build doesn't know. */
export function presented(reply: JsonObject | undefined, what: string): void {
  const r = obj(reply, what);
  const notes = [...(Array.isArray(r['notices']) ? r['notices'] : []), ...(Array.isArray(r['issues']) ? r['issues'] : [])].filter(isObject);
  expect(notes.filter((n) => n['code'] === 'unknown_kind').map((n) => show(n)), `${what}: no item skipped as a kind the build doesn't know`).toEqual([]);
  expect(r['outcome'], `${what} is presented: ${show(r, 3000)}`).toBe('presented');
}
/** #172's web export: `{call: "export", doc, out, video: {codec: "web"}}`. */
export const webExport = (doc: string, out: string): JsonObject => ({ call: 'export', doc, out, video: { codec: 'web' } });

/** One `deep-show run` that shows `document` and exports it to the web at `out`; the export's reply. */
export function exportToWeb(bin: string, evidence: string, document: JsonObject, out: string, what: string, planted?: string): JsonObject {
  const doc = String(document['id']);
  const [shown, reply] = run(bin, scenario(evidence, [doc], [present(doc, document), webExport(doc, out)], planted), what);
  presented(shown, what);
  return obj(reply, `${what}: the export's reply`);
}

/** Every file under `dir`, by its path relative to `dir`. */
export function filesUnder(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const walk = (d: string): void => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p); else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

/**
 * AC6's check: the web export of a piece whose item `item` uses an entry whose web answer is refused with `code` is
 * refused, nothing written in `out`'s folder, and its `refused` list gives `item` that code. Each failure names the item.
 */
export function webRefusedFailures(reply: JsonObject, out: string, item: string, code: string): string[] {
  const failures: string[] = [];
  if (reply['outcome'] !== 'refused') failures.push(`${item}: the web export of the piece holding ${item} is ${show(reply['outcome'])}, not refused: ${show(reply, 1200)}`);
  const written = filesUnder(dirname(out));
  if (written.length) failures.push(`${item}: the export wrote ${written.slice(0, 5).join(', ')}${written.length > 5 ? ', …' : ''} for a piece it must refuse`);
  const refused = (Array.isArray(reply['refused']) ? reply['refused'] : []).filter(isObject);
  if (!refused.some((r) => r['item'] === item && r['code'] === code)) failures.push(`${item}: the refusal gives ${item} no entry with the code ${code}: ${show(refused as JsonValue, 1200)}`);
  return failures;
}
/** The refusal entry of `item` with `code`, or a failure. */
export function refusalEntry(reply: JsonObject, item: string, code: string, what: string): JsonObject {
  const refused = (Array.isArray(reply['refused']) ? reply['refused'] : []).filter(isObject);
  const found = refused.find((r) => r['item'] === item && r['code'] === code);
  expect(found, `${what}: the refusal gives ${item} an entry with the code ${code}: ${show(reply, 1500)}`).toBeDefined();
  return found!;
}
/** An exported piece's receipt (#172: `{outcome: "exported", receipt}`). */
export function receiptOf(reply: JsonObject, what: string): JsonObject {
  expect(reply['outcome'], `${what} is exported: ${show(reply, 3000)}`).toBe('exported');
  return obj(reply['receipt'], `${what}: receipt`);
}

// ---------------------------------------------------------------------------------------------------
// deep_kinds (#412) and `deep-show kinds --dump`.

/** deep_kinds `list` of one registry, every page followed by its cursor until none is left: that registry's entries. */
export function listedEntries(bin: string, evidence: string, registry: string): JsonObject[] {
  const entries: JsonObject[] = [];
  let cursor: string | undefined;
  for (let k = 0; k < 200; k++) {
    const call: JsonObject = { call: 'deep_kinds', op: 'list', registry, ...(cursor ? { cursor } : {}) };
    const [page] = run(bin, scenario(evidence, [], [call]), `deep_kinds list ${registry}, page ${k + 1}`);
    expect(page!['error'], `deep_kinds list ${registry} answers, not refuses: ${show(page)}`).toBeUndefined();
    for (const row of arr(page!['registries'], `deep_kinds list page ${k + 1}: registries`).filter(isObject)) {
      if (row['name'] === registry && Array.isArray(row['entries'])) entries.push(...row['entries'].filter(isObject));
    }
    cursor = typeof page!['next'] === 'string' && page!['next'] !== '' ? page!['next'] : undefined;
    if (!cursor) return entries;
  }
  return expect.fail(`deep_kinds list ${registry} doesn't end within 200 pages`);
}
/** `deep-show kinds --dump <dir>` (#412): the whole sealed listing as written. */
export function dumpOf(bin: string, dir: string): JsonObject {
  const s = start(bin, ['kinds', '--dump', dir], [], 600_000);
  expect(s.status, `deep-show kinds --dump exits 0: ${s.stdout.slice(0, 800)} ${s.stderr.slice(-800)}`).toBe(0);
  const line = obj(s.lines[0], 'deep-show kinds --dump: its line');
  expect(line['ok'], `deep-show kinds --dump answers ok: ${show(line)}`).toBe(true);
  return obj(readJson(str(line['path'], 'the dump\'s path')), 'the dump');
}

// ---------------------------------------------------------------------------------------------------
// The sealed listing the lane reads (README: The sealed listing): packages/contracts/canvas-paths.json.

export const LISTING = 'packages/contracts/canvas-paths.json';
export const REFERENCE = 'docs/canvas-primitives.md';

/** One holder of answers: a 3D entry, or a field of one that carries its own. */
export interface Holder { name: string; registry: string; entry: string; field: string | undefined; module: string; section: string; paths: Record<PathName, JsonObject> }
/** The name a Paths row gives a holder: `<entry>[.<field>]`, prefixed `<registry>/` for an entry of a registry other than kind@1. */
export const holderName = (registry: string, entry: string, field?: string): string =>
  `${registry === 'kind@1' ? '' : `${registry}/`}${entry}${field ? `.${field}` : ''}`;
/** A holder's key across the listing, deep_kinds and the dump. */
export const holderKey = (registry: string, entry: string, field?: string): string => `${registry}|${entry}|${field ?? ''}`;

/** The checkout's committed listing, as JSON. */
export function committedListing(): JsonObject {
  const path = join(REPO, LISTING);
  expect(existsSync(path), `the sealed listing is committed at ${LISTING}`).toBe(true);
  return obj(readJson(path), LISTING);
}

export interface Listing { checks: string[]; fixtures: string[]; holders: Holder[]; raw: JsonObject }
/** The listing read strictly as the README gives its shape. */
export function listingOf(value: JsonValue, what: string): Listing {
  const o = obj(value, what);
  const names = (k: string): string[] => arr(o[k], `${what}.${k}`).map((x, i) => str(x, `${what}.${k}[${i}]`));
  const holders = arr(o['entries'], `${what}.entries`).map((v, i): Holder => {
    const h = obj(v, `${what}.entries[${i}]`);
    const at = `${what}.entries[${i}]`;
    const registry = str(h['registry'], `${at}.registry`);
    const entry = str(h['entry'], `${at}.entry`);
    const field = h['field'] === undefined ? undefined : str(h['field'], `${at}.field`);
    const paths = obj(h['paths'], `${at}.paths`);
    return {
      name: holderName(registry, entry, field), registry, entry, field, module: str(h['module'], `${at}.module`), section: str(h['section'], `${at}.section`),
      paths: { rays: obj(paths['rays'], `${at}.paths.rays`), final: obj(paths['final'], `${at}.paths.final`), web: obj(paths['web'], `${at}.paths.web`) },
    };
  });
  return { checks: names('checks'), fixtures: names('fixtures'), holders, raw: o };
}

export interface Counts { same: number; stand_in: number; refused: number; path_undefined: number; not_applicable: number }
/** How many holders answer each path with each answer, and how many of the refusals are path_undefined. */
export function countsOf(holders: readonly Holder[]): Record<PathName, Counts> {
  const out = {} as Record<PathName, Counts>;
  for (const p of PATHS) {
    const c: Counts = { same: 0, stand_in: 0, refused: 0, path_undefined: 0, not_applicable: 0 };
    for (const h of holders) {
      const a = h.paths[p]['answer'];
      if (a === 'same' || a === 'stand_in' || a === 'refused' || a === 'not_applicable') c[a]++;
      if (a === 'refused' && h.paths[p]['code'] === UNDEFINED) c.path_undefined++;
    }
    out[p] = c;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The lane (README: The lane), run as the local preflight runs it: `node scripts/canvas-closures.mjs paths`.

export interface LaneRun { code: number | null; out: string; ms: number }
/** `node [nodeArgs] scripts/canvas-closures.mjs <args>` from the checkout, timed from spawn to exit. */
export function lane(args: string[], o: { nodeArgs?: string[]; env?: NodeJS.ProcessEnv } = {}): LaneRun {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [...(o.nodeArgs ?? []), join(REPO, 'scripts', 'canvas-closures.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...(o.env ?? {}) }, timeout: 120_000 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, ms: performance.now() - t0 };
}
/** The paths lane on `root` (a scratch tree), or on the checkout. */
export const paths = (root?: string): LaneRun => lane(['paths', ...(root ? ['--root', root] : [])]);
/** `node <args>` from the checkout with `env` added: its exit status and output. */
export function spawnNode(args: string[], env: NodeJS.ProcessEnv): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
/** The counts that differ between two readings, each as `<answer> <a> ≠ <b>`. */
export function countsDiffer(a: Counts, b: Counts): string[] {
  return (Object.keys(a) as (keyof Counts)[]).filter((k) => a[k] !== b[k]).map((k) => `${k} ${a[k]} ≠ ${b[k]}`);
}
export const shown = (r: LaneRun): string => `exit ${r.code}\n${r.out.slice(0, 4000)}`;
export const failLines = (r: LaneRun): string[] => r.out.split('\n').filter((l) => l.startsWith('FAIL paths: '));

/** The lane passed: exit 0, a PASS line, no FAIL line. */
export function lanePasses(r: LaneRun, what: string): void {
  expect(failLines(r), `${what}: no FAIL paths line\n${shown(r)}`).toEqual([]);
  expect(r.code, `${what}: exit 0\n${shown(r)}`).toBe(0);
  expect(/^PASS paths: /m.test(r.out), `${what}: a PASS paths line\n${shown(r)}`).toBe(true);
}
/** The lane failed: exit 1, and one FAIL line naming every one of `names`. */
export function laneFailsNaming(r: LaneRun, names: readonly string[], what: string): void {
  expect(r.code, `${what}: exit 1\n${shown(r)}`).toBe(1);
  failsNaming(failLines(r), names, what);
}

/** The lane's `same` lines: `same paths: <path>: <holder>: held by <check or fixture>`. */
export function sameLines(r: LaneRun): { path: string; name: string; heldBy: string }[] {
  return [...r.out.matchAll(/^same paths: (\S+): (\S+): held by (\S+)$/gm)].map((m) => ({ path: m[1]!, name: m[2]!, heldBy: m[3]! }));
}
/** The lane's counts lines: `count paths: <path>: same n, stand_in n, refused n (path_undefined n), not_applicable n`. */
export function countLines(r: LaneRun): Map<string, Counts> {
  const out = new Map<string, Counts>();
  const re = /^count paths: (\S+): same (\d+), stand_in (\d+), refused (\d+) \(path_undefined (\d+)\), not_applicable (\d+)$/gm;
  for (const m of r.out.matchAll(re)) out.set(m[1]!, { same: Number(m[2]), stand_in: Number(m[3]), refused: Number(m[4]), path_undefined: Number(m[5]), not_applicable: Number(m[6]) });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Scratch trees for `--root`, and the Paths rows read and rewritten (README: The Paths row).

const scratch: string[] = [];
/** A scratch folder deleted after the file. */
export function tempDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `deep-2776-${tag}-`));
  scratch.push(d);
  return d;
}
export function useTempDirs(): void {
  afterAll(() => { for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true }); });
}
/** A tree holding only a reference and a sealed listing, where the lane reads them. */
export function laneTree(tag: string, reference: string, listing: JsonValue): string {
  const root = tempDir(tag);
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, REFERENCE), reference);
  writeJson(join(root, LISTING), listing);
  return root;
}
/** The scratch reference and listing of fixtures/ (README: Fixtures). */
export const fixtureReference = (): string => readFileSync(join(FIXTURES, 'reference.md'), 'utf8');
export const fixtureListing = (): JsonObject => obj(readJson(join(FIXTURES, 'canvas-paths.json')), 'fixtures/canvas-paths.json');

/** The lines of `section` (`#### <section>` to the next heading of level 1 to 4), as [first, end) line indexes. */
export function sectionSpan(lines: readonly string[], section: string): [number, number] {
  const first = lines.findIndex((l) => l.trimEnd() === `#### ${section}`);
  expect(first, `the reference has the section #### ${section}`).toBeGreaterThanOrEqual(0);
  let end = first + 1;
  while (end < lines.length && !/^#{1,4} /.test(lines[end]!)) end++;
  return [first, end];
}
/** The cells of a table line, trimmed. */
const cells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
/** `text` with the answer of `name` for `path` in `section`'s Paths row replaced by `cell`. */
export function withCell(text: string, section: string, name: string, path: PathName, cell: string): string {
  const lines = text.split('\n');
  const [first, end] = sectionSpan(lines, section);
  const header = lines.slice(first, end).findIndex((l) => /^\|\s*Entry\s*\|/.test(l));
  expect(header, `${section} has a Paths table whose header starts | Entry |`).toBeGreaterThanOrEqual(0);
  const column = cells(lines[first + header]!).indexOf(path);
  expect(column, `${section}'s Paths table has a column ${path}: ${lines[first + header]}`).toBeGreaterThan(0);
  const row = lines.slice(first, end).findIndex((l) => l.trim().startsWith('|') && cells(l)[0] === `\`${name}\``);
  expect(row, `${section}'s Paths table has a row for \`${name}\``).toBeGreaterThanOrEqual(0);
  const c = cells(lines[first + row]!);
  c[column] = cell;
  lines[first + row] = `| ${c.join(' | ')} |`;
  return lines.join('\n');
}
/** `text` with `section`'s Paths row (the line `**Paths**` and its table) taken out. */
export function withoutPathsRow(text: string, section: string): string {
  const lines = text.split('\n');
  const [first, end] = sectionSpan(lines, section);
  const label = lines.slice(first, end).findIndex((l) => l.trim() === '**Paths**');
  expect(label, `${section} has a Paths row`).toBeGreaterThanOrEqual(0);
  let stop = first + label + 1;
  while (stop < end && lines[stop]!.trim() === '') stop++;
  while (stop < end && lines[stop]!.trim().startsWith('|')) stop++;
  lines.splice(first + label, stop - (first + label));
  return lines.join('\n');
}
/** The listing with `name`'s answer for `path` replaced by `answer`. */
export function withAnswer(listing: JsonObject, name: string, path: PathName, answer: JsonObject): JsonObject {
  const out = clone(listing);
  const holders = arr(out['entries'], 'the listing\'s entries').filter(isObject);
  const h = holders.find((x) => holderName(String(x['registry']), String(x['entry']), x['field'] === undefined ? undefined : String(x['field'])) === name);
  expect(h, `the listing holds ${name}`).toBeDefined();
  obj(h!['paths'], `${name}.paths`)[path] = answer;
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The network guard (AC8): a module the lane's process imports first, which records and refuses every socket, name
// lookup, request and child process, so a run that reads the network or starts a process leaves a line in the log.

const GUARD = `import { appendFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
const require = createRequire(import.meta.url);
const log = process.env.DEEP_2776_NET_LOG;
const deny = (what) => function denied() {
  appendFileSync(log, what + '\\n');
  throw new Error(what + ': the paths lane reads no network and starts no process');
};
const patch = (name, members) => {
  const m = require(name);
  for (const k of members) if (typeof m[k] === 'function') m[k] = deny(name + '.' + k);
  return m;
};
patch('node:net', ['connect', 'createConnection']).Socket.prototype.connect = deny('node:net.Socket.connect');
patch('node:tls', ['connect']);
const lookups = ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse'];
patch('node:dns', lookups);
patch('node:dns/promises', lookups);
patch('node:http', ['request', 'get']);
patch('node:https', ['request', 'get']);
patch('node:http2', ['connect']);
patch('node:dgram', ['createSocket']);
patch('node:child_process', ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']);
for (const k of ['fetch', 'WebSocket', 'EventSource']) if (typeof globalThis[k] === 'function') globalThis[k] = deny(k);
syncBuiltinESMExports();
`;
/** The guard written to a scratch folder, and a fresh log for it; the guard's `--import` argument and its env. */
export function networkGuard(): { nodeArgs: string[]; env: NodeJS.ProcessEnv; log: string } {
  const dir = tempDir('guard');
  const file = join(dir, 'guard.mjs');
  writeFileSync(file, GUARD);
  const log = join(dir, 'reached.log');
  writeFileSync(log, '');
  return { nodeArgs: ['--import', pathToFileURL(file).href], env: { DEEP_2776_NET_LOG: log }, log };
}

// ---------------------------------------------------------------------------------------------------
// The design's judge for timing results (as tests/acceptance/200): five runs after a warm-up.

export type Judged = { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; shown: string };
/** PASS all within the limit, FAIL all over it by more than the margin (the larger of 5% and their spread), else INCONCLUSIVE. */
export function judgeRuns(name: string, runs: number[], limit: number): Judged {
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
  const text = `${name}: ${runs.map((r) => r.toFixed(1)).join(', ')} ms against ${limit} ms (margin ${(margin * 100).toFixed(0)}%)`;
  if (runs.length !== 5) return { status: 'INCONCLUSIVE', shown: `${text}: not five runs` };
  if (runs.every((r) => r <= limit)) return { status: 'PASS', shown: text };
  if (runs.every((r) => r > limit * (1 + margin))) return { status: 'FAIL', shown: text };
  return { status: 'INCONCLUSIVE', shown: text };
}
/** A FAIL fails the test, an INCONCLUSIVE skips it as INCONCLUSIVE, else it passes. */
export function settle(ctx: TestContext, judged: Judged): void {
  console.log(`${judged.status} ${judged.shown}`);
  expect(judged.status === 'FAIL' ? judged.shown : '', 'the budget is not judged FAIL').toBe('');
  if (judged.status === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE ${judged.shown}`);
}
