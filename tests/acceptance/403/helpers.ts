// Test-side tools for the #403 acceptance tests: `deep-show` built per Cargo feature set (the full build
// set, alone or with one of this suite's test features, as #305's, #371's and #388's suites build it) and
// driven by JSON lines; the scenario it runs (agents' sessions, the process table the peer check reads,
// panels, documents the hub minted or stored, claims with their deliverables and requirements); reading
// replies; and the checks the criteria's wrong programs must fail, each returning its failures as
// sentences that name what failed. Nothing here stands in for a document check, a verdict, its key or
// the check registry.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/403 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';
const BUILT = join(REPO, 'target', 'debug', process.platform === 'win32' ? `${SHOW_NAME}.exe` : SHOW_NAME);

/** The core's own check kinds, as issue #403's scope and Check input list them. */
export const CORE_CHECK_KINDS = [
  'document.validate', 'document.budget', 'document.frame_time', 'document.layout', 'document.determinism',
  'geometry.audit', 'film.audit', 'film.flicker', 'film.layout', 'honest_numbers', 'kind_rules',
] as const;
export const VERDICTS = ['PASS', 'FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'] as const;

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
// Builds: one `deep-show` per Cargo feature set, built once per file, each kept under its own name.

/** This suite's test features (README: Test builds). */
export type TestFeature = 'test-check-kind' | 'test-leave-out-logic';
/** The full build set, alone or with one test feature. */
export interface Build { with?: TestFeature }
export const FULL: Build = {};
export const CHECK_KIND: Build = { with: 'test-check-kind' };
export const NO_LOGIC: Build = { with: 'test-leave-out-logic' };
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
    dir = mkdtempSync(join(tmpdir(), 'deep-403-bins-'));
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
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`${SHOW_NAME} run: ${run.error.message}`);
  expect(run.status, `${SHOW_NAME} run exits 0 (${run.signal ?? 'no signal'}); stderr: ${(run.stderr ?? '').slice(0, 2000)}`).toBe(0);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${brief(out, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(scenario['calls'], 'the scenario\'s calls').length);
  return replies;
}

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-403-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// The world the scenarios share: agents' sessions, the process table, panels, documents, claims.

export interface SessionFixture { id: string; thread: string; name: string; process: { pid: number; start: number } }
export const ALPHA: SessionFixture = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: checks board', process: { pid: 4100, start: 1_000 } };
export const BRAVO: SessionFixture = { id: 'sess-bravo', thread: 'thread-bravo', name: 'Codex: release notes', process: { pid: 5200, start: 2_000 } };
export const SESSIONS: JsonObject = Object.fromEntries([ALPHA, BRAVO].map((s) => [s.id, { thread: s.thread, name: s.name, process: s.process }]));

/** The OS process table the peer check reads: `deep show` you ran, outside every agent's tree, and one inside alpha's. */
export const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 },
  { pid: 4102, ppid: 4100, start: 1_200 },
  { pid: 5200, ppid: 3001, start: 2_000 },
];
/** `deep show` from your shell: it writes as you. */
export const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
/** `deep show` from inside alpha's process tree: it writes as alpha. */
export const IN_ALPHA: JsonObject = { pid: 4102, start: 1_200 };

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** Documents the hub has minted. */
export const DOC = { a: ulid('01JB74D', 1), b: ulid('01JB74D', 2) } as const;
export const patchId = (n: number): string => ulid('01JB74P', n);
export const claimId = (n: number): string => `claim:${ulid('01JB74C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB74Q', n)}`;

export const PANELS: JsonObject = { main: { rect: [0, 0, 800, 600] }, side: { rect: [800, 0, 400, 600] } };

/** A requirement of a claim's definition: its ID and its check input (README: Claims with requirements). */
export const requirement = (n: number, check: JsonObject): JsonObject => ({ id: reqId(n), check });

/** Alpha's claim whose definition names `deliverables` and holds `requirements`. */
export const claim = (deliverables: string[], requirements: JsonObject[] = []): JsonObject =>
  ({ session: ALPHA.id, deliverables, ...(requirements.length ? { requirements } : {}) });

/** A scenario with this suite's sessions, process table and panels; each doc on its panel, `main` unless named. */
export function scenario(evidence: string, docs: Record<string, string | JsonObject>, calls: JsonObject[], extra: JsonObject = {}): JsonObject {
  const docsOut: JsonObject = {};
  for (const [id, d] of Object.entries(docs)) docsOut[id] = typeof d === 'string' ? { panel: d } : d;
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs: docsOut, ...extra, calls };
}

// ---------------------------------------------------------------------------------------------------
// Documents

export const rect = (id: string, name: string, box: number[], order: string, extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'rect@1', name, order, params: { box, paint: { fill: { role: 'muted' } } }, ...extra });
export const text = (id: string, name: string, words: string, pos: [number, number], order: string, extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'text@1', name, order, params: { text: words, font: 'body', size: 13, box: { w: 240, h: 20 } }, at: { pos: [pos[0], pos[1], 0] }, ...extra });

/** A whole revision as an agent sends it: no `id`, no `layers`, no item `layer`. */
export function board(title: string, items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, profile: 'board', title, description: `${title}, drawn by a test agent through deep_show.`, size: [640, 360],
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}

/** A board as the last release stored it (`docs[…].document`): one layer of yours, opened as revision 0. */
export function storedBoard(items: JsonObject[]): JsonObject {
  return {
    format: 1, profile: 'board', title: 'Checks', description: 'Checks by service, as the last release stored the board.', size: [640, 360],
    layers: { 'you-main': { writer: 'you:you', title: 'You', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), { ...i, layer: 'you-main' }])),
  };
}

/** The work: the checks board a claim names as its deliverable. */
export const WORK_ITEMS: JsonObject[] = [
  text('you.title', 'Title', 'Weekly checks', [16, 16], 'a0'),
  text('you.y-label', 'Y axis label', 'Checks', [16, 180], 'a1'),
  rect('you.plot', 'Plot area', [80, 60, 520, 240], 'a2'),
];

// ---------------------------------------------------------------------------------------------------
// Replies

export const outcome = (reply: JsonObject): string => String(reply['outcome']);

export interface Issue { code: string; severity: string; ids: string[]; raw: JsonObject }
export function issues(value: JsonValue | undefined, what: string): Issue[] {
  return arr(value ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: str(o['code'], `${what}: issues[${i}].code`), severity: String(o['severity']), ids: Array.isArray(o['ids']) ? o['ids'].map(String) : [], raw: o };
  });
}

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
  expect(now.length, `exactly one revision is current: ${brief(reply['revisions'])}`).toBe(1);
  return now[0]!;
}

/** Why a check is BLOCKED for a kind (README: `blocked`). */
export interface Blocked { code: string; kind: string; module: string | null; ids: string[] }
export function blockedOf(value: JsonValue | undefined): Blocked[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map((b) => ({
    code: String(b['code']), kind: String(b['kind']), module: typeof b['module'] === 'string' ? b['module'] : null,
    ids: Array.isArray(b['ids']) ? b['ids'].map(String) : [],
  }));
}

/** A requirement's row in a verdict (README: The `verdict` call). */
export interface RequirementRow { id: string; kind: string; result: string; blocked: Blocked[]; issues: Issue[]; raw: JsonObject }
/** A verdict on a claim (README: The `verdict` call). */
export interface Verdict { result: string; stale: boolean | undefined; keyRevisions: { doc: string; rev: number | undefined; hash: string | undefined }[]; requirements: RequirementRow[]; raw: JsonObject }

export function verdictOf(value: JsonValue | undefined, what: string): Verdict {
  const o = obj(value, what);
  const key = isObject(o['key']) ? o['key'] : {};
  const keyRevisions = (Array.isArray(key['revisions']) ? key['revisions'] : []).filter(isObject).map((r) => ({
    doc: String(r['doc']), rev: typeof r['rev'] === 'number' ? r['rev'] : undefined, hash: typeof r['hash'] === 'string' ? r['hash'] : undefined,
  }));
  const requirements = (Array.isArray(o['requirements']) ? o['requirements'] : []).filter(isObject).map((r, i) => ({
    id: String(r['id']), kind: String(r['kind']), result: String(r['result']), blocked: blockedOf(r['blocked']),
    issues: Array.isArray(r['issues']) ? issues(r['issues'], `${what}: requirements[${i}]`) : [], raw: r,
  }));
  return { result: String(o['result']), stale: typeof o['stale'] === 'boolean' ? o['stale'] : undefined, keyRevisions, requirements, raw: o };
}
/** `{"call": "verdicts"}`'s list, in the order the verdicts were made. */
export function verdictList(reply: JsonObject): Verdict[] {
  return arr(reply['verdicts'], 'verdicts: the list').map((v, i) => verdictOf(v, `verdicts[${i}]`));
}
/** The row of requirement `id` in a verdict. */
export function rowOf(verdict: Verdict, id: string): RequirementRow | undefined {
  return verdict.requirements.find((r) => r.id === id);
}

// ---------------------------------------------------------------------------------------------------
// The criteria's checks, each returning its failures as sentences naming what failed.

/**
 * AC1: a PASS made on revision `before` of `doc` is keyed by that revision's hash; once the writer's patch
 * `patch` makes `after` the current revision, the PASS reads stale, still keyed by `before`'s hash, and a
 * verdict made then is keyed by `after`'s hash and not stale. Each failure names the patch.
 */
export function staleFailures(args: { doc: string; patch: string; writer: string; first: Verdict; before: Revision; after: Revision; listed: Verdict[]; again: Verdict }): string[] {
  const { doc, patch, writer, first, before, after, listed, again } = args;
  const failures: string[] = [];
  const keyOf = (v: Verdict) => v.keyRevisions.find((r) => r.doc === doc);
  if (first.result !== 'PASS') failures.push(`the claim on ${doc} was ${first.result}, not PASS, before ${writer}'s patch ${patch}`);
  const firstKey = keyOf(first);
  if (firstKey?.hash !== before.hash) failures.push(`the PASS's key names ${doc} at hash ${firstKey?.hash ?? '(none)'}, not the hash ${before.hash} of revision ${before.rev} it was made on`);
  if (first.stale !== false) failures.push(`the PASS on revision ${before.rev} reads stale=${String(first.stale)} before any patch`);
  if (after.hash === before.hash || after.rev === before.rev) failures.push(`${writer}'s patch ${patch} made no new revision of ${doc} (still rev ${after.rev}, hash ${after.hash})`);
  const old = listed[0];
  if (listed.length < 1 || !old) failures.push(`after ${writer}'s patch ${patch}, the claim lists no verdict`);
  else {
    if (old.stale !== true) failures.push(`after ${writer}'s patch ${patch} made revision ${after.rev}, the PASS made on revision ${before.rev} reads stale=${String(old.stale)}, not stale`);
    if (keyOf(old)?.hash !== before.hash) failures.push(`after ${writer}'s patch ${patch}, the earlier PASS's key names hash ${keyOf(old)?.hash ?? '(none)'}, not ${before.hash}, the revision it judged`);
  }
  if (again.result !== 'PASS') failures.push(`the claim judged again after ${writer}'s patch ${patch} was ${again.result}, not PASS`);
  if (keyOf(again)?.hash !== after.hash) failures.push(`the verdict made after ${writer}'s patch ${patch} names hash ${keyOf(again)?.hash ?? '(none)'}, not ${after.hash}, the revision it judged`);
  if (again.stale !== false) failures.push(`the verdict made after ${writer}'s patch ${patch} on the current revision reads stale=${String(again.stale)}`);
  return failures;
}

/**
 * AC2: a check in the claim of a deliverable holding an item of `kind`, which the build doesn't know, is
 * BLOCKED, naming the kind and the item. Each failure names the kind.
 */
export function unknownKindFailures(result: string, blocked: Blocked[], kind: string, item: string, what: string): string[] {
  const failures: string[] = [];
  if (result !== 'BLOCKED') failures.push(`${what} on a deliverable holding an item of ${kind}, which this build doesn't know, was ${result}, not BLOCKED`);
  if (!blocked.some((b) => b.code === 'unknown_kind' && b.kind === kind && b.ids.includes(item))) {
    failures.push(`${what}: nothing BLOCKED names unknown_kind ${kind} on item ${item}: ${JSON.stringify(blocked)}`);
  }
  return failures;
}

/**
 * AC3: a requirement whose check input names `kind`, which no module in the build registers, is BLOCKED
 * with module_missing, naming the kind and `module`, never PASS or INCONCLUSIVE, and never skipped.
 * Each failure names the kind.
 */
export function missingKindFailures(verdict: Verdict, id: string, kind: string, module: string | null): string[] {
  const row = rowOf(verdict, id);
  if (!row) return [`the requirement ${id} whose check input names ${kind} was skipped: the verdict has no row for it`];
  const failures: string[] = [];
  if (row.result !== 'BLOCKED') failures.push(`the requirement ${id} whose check input names ${kind} was ${row.result}, not BLOCKED`);
  const named = row.blocked.filter((b) => b.code === 'module_missing' && b.kind === kind);
  if (named.length === 0) failures.push(`the requirement ${id} names no module_missing for ${kind}: ${JSON.stringify(row.blocked)}`);
  else if (module !== null && !named.some((b) => b.module === module)) failures.push(`the requirement ${id}'s module_missing for ${kind} names ${named.map((b) => b.module).join(', ')}, not the ${module} module`);
  if (verdict.result === 'PASS' || verdict.result === 'INCONCLUSIVE') failures.push(`the claim whose requirement names ${kind} was ${verdict.result}`);
  return failures;
}
