// Test-side tools for the #371 acceptance tests: `deep-show` built per Cargo feature set (the full build
// set, alone or with one of this suite's test canvas modules, as #305's and #388's suites build it) and
// driven by JSON lines; the scenario it runs (agents' sessions, the process table the peer check reads,
// panels, documents the hub minted or stored, the record, the virtual display clock); the evidence store
// read through its public entry; and the checks the criteria's planted programs must fail, each returning
// its failures as sentences that name what failed. Nothing here stands in for the document check, the
// revision diff, show-time admission, render-back or the frame clock.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/371 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';
const BUILT = join(REPO, 'target', 'debug', process.platform === 'win32' ? `${SHOW_NAME}.exe` : SHOW_NAME);

/** The tech design's read cap: `actual` is cut at 8,192 characters (What holds a document to its rules). */
export const READ_CAP = 8_192;
/** Flicks in one second (One clock). */
export const FLICKS = 705_600_000;

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
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export function strs(value: JsonValue | undefined, what: string): string[] {
  return arr(value, what).map((v, i) => str(v, `${what}[${i}]`));
}
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** Sorted copy, by code point. */
export const sorted = (list: readonly string[]): string[] => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
/** The text's length in Unicode code points: the read cap counts characters. */
export const chars = (text: string): number => [...text].length;

/** A fixture file of this suite, parsed. */
export function fixture(path: string): JsonObject {
  return obj(JSON.parse(readFileSync(join(HERE, 'fixtures', path), 'utf8')) as JsonValue, `fixture ${path}`);
}

/** No failures; the message lists them, each naming what failed. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}

/** At least one failure, and one that names each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  }
}

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-show` per Cargo feature set, built once per file, each kept under its own name.

/** This suite's test canvas modules (README: Test builds). */
export type TestFeature = 'test-title-cap' | 'test-deprecated';
/** The full build set, alone or with one test canvas module. */
export interface Build { with?: TestFeature }
export const FULL: Build = {};
const featuresOf = (build: Build): string[] => ['full', ...(build.with ? [build.with] : [])];
const nameOf = (build: Build): string => featuresOf(build).join('+');

function buildFeatures(features: string[]): string {
  const args = ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', features.join(',')];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished/.test(l)).join('\n')}`;
  return '';
}

export interface Builds { bin: (build: Build) => string }

/** Builds every listed feature set once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): Builds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-371-bins-'));
    for (const build of builds) {
      const name = nameOf(build);
      if (made.has(name)) continue;
      const error = buildFeatures(featuresOf(build));
      const bin = join(dir, `${SHOW_NAME}-${name.replace(/[^a-z0-9+.-]/g, '_')}`);
      if (error === '') copyFileSync(BUILT, bin);
      made.set(name, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(build: Build): string {
      const entry = made.get(nameOf(build));
      if (!entry) throw Error(`the file didn't list the build ${nameOf(build)} in useBuilds`);
      expect(entry.error, `the binary builds: ${SHOW_NAME} with features ${featuresOf(build).join(',')}`).toBe('');
      return entry.bin;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Running a scenario: one JSON line in, one JSON line out, exit 0 (#393's convention).

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 300_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`${SHOW_NAME} run: ${run.error.message}`);
  expect(run.status, `${SHOW_NAME} run exits 0 (${run.signal ?? 'no signal'}); stderr: ${(run.stderr ?? '').slice(0, 2000)}`).toBe(0);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(scenario['calls'], 'the scenario\'s calls').length);
  return replies;
}

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-371-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** One piece of evidence, read by its hash through the evidence store's public entry and parsed as JSON. */
export async function readEvidenceJson(root: string, sha256: string): Promise<JsonValue> {
  const store = await openEvidenceStore({ root });
  return JSON.parse(Buffer.from(await store.read(sha256)).toString('utf8')) as JsonValue;
}

// ---------------------------------------------------------------------------------------------------
// The world the scenarios share: agents' sessions, the process table, panels, documents.

export interface SessionFixture { id: string; thread: string; name: string; process: { pid: number; start: number } }
export const ALPHA: SessionFixture = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: checks board', process: { pid: 4100, start: 1_000 } };
export const BRAVO: SessionFixture = { id: 'sess-bravo', thread: 'thread-bravo', name: 'Codex: release notes', process: { pid: 5200, start: 2_000 } };
export const SESSIONS: JsonObject = Object.fromEntries([ALPHA, BRAVO].map((s) => [s.id, { thread: s.thread, name: s.name, process: s.process }]));

/** The OS process table the peer check reads: `deep show` you ran, outside every agent's tree. */
export const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 },
  { pid: 5200, ppid: 3001, start: 2_000 },
];
/** `deep show` from your shell: it writes as you. */
export const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** Documents the hub has minted. */
export const DOC = { a: ulid('01JB71D', 1), b: ulid('01JB71D', 2), c: ulid('01JB71D', 3) } as const;
/** A patch's ULID. */
export const patchId = (n: number): string => ulid('01JB71P', n);
export const reading = (n: number): string => `reading:${ulid('01JB71R', n)}`;

export const PANELS: JsonObject = { main: { rect: [0, 0, 800, 600] }, side: { rect: [800, 0, 400, 600] }, low: { rect: [0, 600, 800, 400] } };

/** A scenario with this suite's sessions, process table and panels; each doc on its panel, `main` unless named. */
export function scenario(evidence: string, docs: Record<string, string | JsonObject>, calls: JsonObject[], extra: JsonObject = {}): JsonObject {
  const docsOut: JsonObject = {};
  for (const [id, d] of Object.entries(docs)) docsOut[id] = typeof d === 'string' ? { panel: d } : d;
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs: docsOut, ...extra, calls };
}

// ---------------------------------------------------------------------------------------------------
// Documents as an agent sends them: no `id`, no `layers`, no item `layer`.

export const rect = (id: string, name: string, box: number[], order: string, extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'rect@1', name, order, params: { box, paint: { fill: { role: 'muted' } } }, ...extra });
export const text = (id: string, name: string, words: string, pos: [number, number], order: string, extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'text@1', name, order, params: { text: words, font: 'body', size: 13, box: { w: 240, h: 20 } }, at: { pos: [pos[0], pos[1], 0] }, ...extra });

export function board(title: string, size: [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, profile: 'board', title, description: `${title}, drawn by a test agent through deep_show.`, size,
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}

/** A deep_show whole revision from `session`. */
export const show = (session: string, doc: string, document: JsonObject, extra: JsonObject = {}): JsonObject =>
  ({ call: 'deep_show', session, doc, document, ...extra });

// ---------------------------------------------------------------------------------------------------
// Replies

export interface Issue { code: string; severity: string; ids: string[]; path: string; carried: boolean; hasActual: boolean; actual: JsonValue | undefined; raw: JsonObject }
function issueOf(v: JsonValue, what: string): Issue {
  const o = obj(v, what);
  return {
    code: str(o['code'], `${what}.code`), severity: str(o['severity'], `${what}.severity`), ids: strs(o['ids'] ?? [], `${what}.ids`),
    path: typeof o['path'] === 'string' ? o['path'] : '', carried: o['carried'] === true,
    hasActual: Object.prototype.hasOwnProperty.call(o, 'actual'), actual: o['actual'], raw: o,
  };
}
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => issueOf(v, `${what}: issues[${i}]`));
}
/** Every issue of a reply, read back from its `issues_evidence` (the whole list, never the cut one). */
export async function allIssues(root: string, reply: JsonObject, what = 'the reply'): Promise<Issue[]> {
  const sha = str(reply['issues_evidence'], `${what}: issues_evidence`);
  return arr(await readEvidenceJson(root, sha), `${what}: the issues at ${sha}`).map((v, i) => issueOf(v, `${what}: evidence issues[${i}]`));
}
export const errors = (list: Issue[]): Issue[] => list.filter((i) => i.severity === 'error');
export const outcome = (reply: JsonObject): string => String(reply['outcome']);

export interface Revision { rev: number; hash: string; state: string }
export function revisions(reply: JsonObject): Revision[] {
  return arr(reply['revisions'], 'revisions').map((v, i) => {
    const o = obj(v, `revisions[${i}]`);
    return { rev: num(o['rev'], `revisions[${i}].rev`), hash: str(o['hash'], `revisions[${i}].hash`), state: str(o['state'], `revisions[${i}].state`) };
  });
}
/** The one revision of a document in the state `current`. */
export function current(reply: JsonObject): Revision {
  const now = revisions(reply).filter((r) => r.state === 'current');
  expect(now.length, `exactly one revision is current: ${JSON.stringify(reply['revisions'])}`).toBe(1);
  return now[0]!;
}

export interface Band { layer: string; owner: JsonObject; band: string; outline: boolean; name: string | null }
export function bands(reply: JsonObject): Band[] {
  return arr(reply['bands'], 'screen: bands').map((v, i) => {
    const o = obj(v, `screen: bands[${i}]`);
    return { layer: String(o['layer']), owner: isObject(o['owner']) ? o['owner'] : {}, band: str(o['band'], `bands[${i}].band`), outline: o['outline'] === true, name: typeof o['name'] === 'string' ? o['name'] : null };
  });
}

export interface Row { id: string; box: [number, number, number, number] }
/** The reply's table of visible items (README: `visible`). */
export function visibleRows(reply: JsonObject, what = 'the reply'): Row[] {
  return arr(reply['visible'], `${what}: visible`).map((v, i) => {
    const o = obj(v, `${what}: visible[${i}]`);
    const b = arr(o['box'], `${what}: visible[${i}].box`).map((n, k) => num(n, `${what}: visible[${i}].box[${k}]`));
    expect(b.length, `${what}: visible[${i}].box is [x, y, w, h]`).toBe(4);
    return { id: str(o['id'], `${what}: visible[${i}].id`), box: b as [number, number, number, number] };
  });
}

// ---------------------------------------------------------------------------------------------------
// The criteria's checks, each returning its failures as sentences naming what failed.

/**
 * AC5: a whole revision that leaves out `dropped` without naming them in `removes` is refused with
 * `unintended_removal`, naming exactly those IDs, and the revision before it stays current, by hash.
 */
export function removalFailures(reply: JsonObject, before: Revision, after: Revision, dropped: readonly string[]): string[] {
  const failures: string[] = [];
  const named = new Set(issues(reply).filter((i) => i.code === 'unintended_removal').flatMap((i) => i.ids));
  if (outcome(reply) !== 'refused') failures.push(`the revision that drops ${dropped.join(', ')} without naming them was ${outcome(reply)}, not refused`);
  for (const id of dropped) if (!named.has(id)) failures.push(`no unintended_removal issue names ${id}, which the revision dropped without naming it`);
  for (const id of named) if (!dropped.includes(id)) failures.push(`an unintended_removal issue names ${id}, which the revision kept`);
  if (after.hash !== before.hash || after.rev !== before.rev) {
    failures.push(`the current revision moved from rev ${before.rev} (${before.hash}) to rev ${after.rev} (${after.hash}), dropping ${dropped.join(', ')}`);
  }
  return failures;
}

/**
 * AC6: the typo fix `fix` is admitted with the title's issue listed as carried, and the second title `add`
 * is refused with an issue it brings, naming `addedId`. Each failure names its patch.
 */
export function admissionFailures(fix: { patch: string; reply: JsonObject }, add: { patch: string; reply: JsonObject }, titleId: string, addedId: string, code: string): string[] {
  const failures: string[] = [];
  if (outcome(fix.reply) !== 'applied') {
    const blamed = issues(fix.reply).filter((i) => i.severity === 'error' && !i.carried).map((i) => `${i.code} on ${i.ids.join(', ') || 'the document'}`);
    failures.push(`patch ${fix.patch}, the typo fix, was ${outcome(fix.reply)}, not admitted${blamed.length ? `, for ${blamed.join('; ')}` : ''}`);
  } else if (!issues(fix.reply).some((i) => i.carried && i.code === code && i.ids.includes(titleId))) {
    failures.push(`patch ${fix.patch}, the typo fix, was admitted but its reply doesn't list ${titleId}'s ${code} issue as carried`);
  }
  if (outcome(add.reply) !== 'refused') {
    failures.push(`patch ${add.patch}, which adds a second over-long title, was ${outcome(add.reply)}, not refused`);
  } else if (!issues(add.reply).some((i) => i.severity === 'error' && !i.carried && i.ids.includes(addedId))) {
    failures.push(`patch ${add.patch} was refused, but no issue it brings (not carried) names ${addedId}`);
  }
  return failures;
}

/** AC7: every issue carries `actual`; each one that doesn't is named by its code. */
export function actualFailures(list: Issue[]): string[] {
  return list.filter((i) => !i.hasActual).map((i) => `an issue with code ${i.code} at ${i.path || '(no path)'} carries no actual`);
}

/** AC8: the revision that uses `kind` is presented with a `deprecated` notice naming `replacedBy`. */
export function deprecatedFailures(reply: JsonObject, kind: string, itemId: string, replacedBy: string): string[] {
  const failures: string[] = [];
  if (outcome(reply) !== 'presented') failures.push(`the revision using ${kind} was ${outcome(reply)}, not presented: it didn't load`);
  const notices = Array.isArray(reply['notices']) ? reply['notices'] : [];
  const deprecated = notices.filter((n) => isObject(n) && n['code'] === 'deprecated') as JsonObject[];
  if (deprecated.length === 0) failures.push(`${kind} loaded silently: the reply has no deprecated notice`);
  else if (!deprecated.some((n) => Array.isArray(n['ids']) && n['ids'].includes(itemId) && n['replaced_by'] === replacedBy)) {
    failures.push(`no deprecated notice for ${kind} names item ${itemId} and replaced_by ${replacedBy}: ${JSON.stringify(deprecated).slice(0, 600)}`);
  }
  return failures;
}
