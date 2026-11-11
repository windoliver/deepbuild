// Test-side tools for the #1961 acceptance tests: `deep-show` built once with the `r1` feature set (the build without
// scene3d that draws 2D rects), driven by one scenario line on stdin as #306's and #1957's suites drive it; the pack and
// document fixtures of `fixtures/`; the calls this suite makes (`read`, a patch, an undo) and the fields it reads from
// their replies; and the checks the criteria's planted programs must fail, each returning its failures as sentences
// that name what failed (README: The surface under test). Nothing here stands in for the pack check, recipe expansion,
// the document check or patches: every result read here is the binary's. Helper code is copied from
// tests/acceptance/306 and 1957, never imported across suites.

import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1961 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const FIXTURES = join(HERE, 'fixtures');
const SHOW_NAME = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetOf = (root: string, env: NodeJS.ProcessEnv): string => (env['CARGO_TARGET_DIR'] ? resolve(root, env['CARGO_TARGET_DIR']) : join(root, 'target'));

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
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const sorted = (list: readonly string[]): string[] => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
export const show = (v: JsonValue | undefined, max = 1500): string => JSON.stringify(v)?.slice(0, max) ?? 'undefined';
/** One canonical text per JSON value (keys sorted at every depth), so "the same bytes" is one string comparison. */
export function canon(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (isObject(value)) return `{${sorted(Object.keys(value)).map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
/** The sha256 of a value's canonical text: "by hash". */
export const hashOf = (value: JsonValue | undefined): string => createHash('sha256').update(canon(value)).digest('hex');

/** A fixture document of this suite, parsed. */
export function fixture(name: string): JsonObject {
  return obj(JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as JsonValue, `fixture ${name}`);
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
// The build: `deep-show` of `r1`, built once per file.

/** Builds stay light on the shared Mac: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };

/** `cargo build --locked --bin deep-show --no-default-features --features r1` in the checkout, copied to `to`; '' or cargo's error. */
function buildTo(to: string): string {
  const args = ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', 'r1'];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n')}`;
  copyFileSync(join(targetOf(REPO, process.env), 'debug', exe(SHOW_NAME)), to);
  return '';
}

/** Builds the binary once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBuild(): () => string {
  let dir = '';
  let bin = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1961-bin-'));
    bin = join(dir, `${SHOW_NAME}-r1`);
    error = buildTo(bin);
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: ${SHOW_NAME} with features r1`).toBe('');
    return bin;
  };
}

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1961-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Running a scenario: one JSON line in, one JSON line out, exit 0 (#393's convention).

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function run(bin: string, sc: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`${SHOW_NAME} run: ${r.error.message}`);
  expect(r.status, `${SHOW_NAME} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((line) => line !== '');
  expect(lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${show(out, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((v, i) => obj(v, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the scenario\'s calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The world the scenarios share: the process table, the panel, the stored document, the packs, the note.

const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** The document the hub minted and stored. */
export const DOC = ulid('01JB1961D', 1);
/** A patch's ULID. */
export const patchId = (n: number): string => ulid('01JB1961P', n);
/** Your note on the broken-out item (README: Notes). */
export const NOTE = ulid('01JB1961N', 1);
/** Your writer layer in the stored documents. */
export const YOUR_LAYER = 'you-main';

/** A pack fixture, `{id: owner/name, dir}` as the scenario's `packs` takes it. */
export interface PackFixture { id: string; version: string; dir: string }
const pack = (id: string, version: string, folder: string): PackFixture => ({ id, version, dir: join(FIXTURES, 'packs', folder) });
export const packAt = (p: PackFixture): string => `${p.id}@${p.version}`;

/** One version of the bookcase: the pack version that carries it, the recipe version, and the step that makes its boards. */
export interface Version { pack: PackFixture; recipe: string; step: string }
/** acme/shelf@1.0.0 carries shelf.bookcase 1.0, whose step `board` makes one board per level. */
export const V10: Version = { pack: pack('acme/shelf', '1.0.0', 'shelf-1.0.0'), recipe: 'shelf.bookcase 1.0', step: 'board' };
/** acme/shelf@1.1.0 carries shelf.bookcase 1.1, which renames the step `board` to `shelf`. */
export const V11: Version = { pack: pack('acme/shelf', '1.1.0', 'shelf-1.1.0'), recipe: 'shelf.bookcase 1.1', step: 'shelf' };
/** What a version's expansion of `instance` derives at `index` of the step that makes the boards. */
export const boardOf = (v: Version, instance: string, index: number): string => `${instance}.${v.step}.${index}`;
/** The pin a document's `packs` holds for a version. */
export const named = (v: Version): string => packAt(v.pack);

/** A scenario with the process table and the panel; `document` stored as DOC on `main`; both shelf versions installed before the first call. */
export function scenario(evidence: string, document: JsonObject, calls: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    evidence,
    sessions: {},
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { [DOC]: { panel: 'main', document } },
    packs: [V10, V11].map((v) => ({ id: v.pack.id, dir: v.pack.dir })),
    ...extra,
    calls,
  };
}

/** Your note on `item` of DOC, seen at revision 0, as the hub holds it (a scenario's `notes`; README: Notes). */
export const noteOn = (item: string): JsonObject => ({
  note: NOTE, doc: DOC, item, rev: 0, region: { x: 40, y: 110, w: 120, h: 4 }, text: 'This board sags; keep it as I set it.',
});

// ---------------------------------------------------------------------------------------------------
// Calls

/** `read` from your shell: the revision shown, with `document`, `draws` and `expansions`. */
export const read = (): JsonObject => ({ call: 'read', doc: DOC, peer: YOU_PEER });
/** A patch from your shell. */
export const patch = (p: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc: DOC, patch: p });
/** Your undo of patch `of`, as patch `id`. */
export const undo = (id: string, of: string): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc: DOC, undo: { patch: id, of } });
/**
 * Your patch `id` on revision `base` that names `v`'s pack version in DOC: one `set` whose path is the document's
 * `packs` entry for the pack named `shelf` (README: The surface under test, the pin patch).
 */
export const pinPatch = (id: string, base: number, v: Version): JsonObject => ({
  patch: id, doc: DOC, base, reason: `take the bookcase at ${v.recipe}`,
  ops: [{ op: 'set', id: 'shelf', path: 'packs/shelf', value: named(v) }],
});

// ---------------------------------------------------------------------------------------------------
// Replies

export const outcome = (reply: JsonObject): string => String(reply['outcome']);
/** The stored document a `read` reply carries. */
export const storedOf = (reply: JsonObject, what: string): JsonObject => obj(reply['document'], `${what}: document`);
export const itemsOf = (reply: JsonObject, what: string): JsonObject => obj(storedOf(reply, what)['items'], `${what}: document.items`);
/** The pack versions the stored document names. */
export const pinsOf = (reply: JsonObject, what: string): JsonValue[] => arr(storedOf(reply, what)['packs'], `${what}: document.packs`);

/** One recipe instance's expansion row, as #306's `expansions` gives it. */
export interface Expansion { instance: string; pack: string; key: string; derived: Record<string, JsonObject>; raw: JsonObject }
export function expansions(reply: JsonObject, what: string): Expansion[] {
  return arr(reply['expansions'] ?? [], `${what}: expansions`).map((v, i) => {
    const o = obj(v, `${what}: expansions[${i}]`);
    const derived: JsonObject = isObject(o['derived']) ? o['derived'] : {};
    return {
      instance: String(o['instance']), pack: String(o['pack']), key: String(o['key']),
      derived: Object.fromEntries(Object.entries(derived).filter(([, it]) => isObject(it)).map(([id, it]) => [id, it as JsonObject])),
      raw: o,
    };
  });
}
/** The one expansion of `instance`, or undefined. */
export const expansionOf = (reply: JsonObject, instance: string, what: string): Expansion | undefined => expansions(reply, what).find((e) => e.instance === instance);

/** The notices and issues a reply raises with `code`: the base's `deep show` replies carry notices in `notices`, issues in `issues`. */
export function raised(reply: JsonObject, code: string): JsonObject[] {
  const list = [...(Array.isArray(reply['notices']) ? reply['notices'] : []), ...(Array.isArray(reply['issues']) ? reply['issues'] : [])];
  return list.filter((n): n is JsonObject => isObject(n) && n['code'] === code);
}
/** Whether a value's JSON text holds `needle` (an ID, a ULID). */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);

// ---------------------------------------------------------------------------------------------------
// The criteria's checks, each returning its failures as sentences naming what failed.

/**
 * #1961.0c0ae838, its first clause: after the load under 1.1, `id`, which the instance broke out under 1.0, is still the
 * writer's own: in the stored document, in the writer's layer, with the same canonical bytes (`before`), and the
 * instance's expansion doesn't write it. Each failure names the item.
 */
export function keptFailures(after: JsonObject, instance: string, id: string, before: JsonObject): string[] {
  const failures: string[] = [];
  const document = after['document'];
  const items: JsonObject = isObject(document) && isObject(document['items']) ? document['items'] : {};
  const now = items[id];
  if (!isObject(now)) failures.push(`${id}, the item ${instance} broke out under ${V10.recipe}, is gone from the stored document after the load under ${V11.recipe}`);
  else {
    if (now['layer'] !== before['layer']) failures.push(`${id} left the writer's layer ${String(before['layer'])}: it is in ${show(now['layer'])}`);
    if (hashOf(now) !== hashOf(before)) failures.push(`${id}'s bytes changed in the load under ${V11.recipe}: sha256 ${hashOf(now)}, the writer's was ${hashOf(before)} (${show(now, 600)})`);
  }
  const e = expansionOf(after, instance, 'after the load');
  if (e && id in e.derived) failures.push(`${instance}'s expansion under ${e.pack} writes ${id} itself, the ID of the writer's broken-out item: ${show(e.derived[id], 600)}`);
  return failures;
}

/**
 * #1961.0c0ae838, its second clause: the load raises `derived_orphan`, one entry naming `id` and the note `note`, on the
 * reply of the patch that loaded the document under the new version or on the read of the revision it made. Each failure
 * names the item.
 */
export function orphanFailures(patched: JsonObject, after: JsonObject, id: string, note: string): string[] {
  const orphans = [...raised(patched, 'derived_orphan'), ...raised(after, 'derived_orphan')];
  if (orphans.some((n) => mentions(n, id) && mentions(n, note))) return [];
  if (orphans.length === 0) return [`no derived_orphan was raised for ${id}, which ${V11.recipe} no longer derives; the patch's notices: ${show(patched['notices'] ?? null, 800)}; its issues: ${show(patched['issues'] ?? null, 800)}`];
  return [`no derived_orphan names both ${id} and the note ${note} on it: ${show(orphans, 1200)}`];
}

/** #1961.0c0ae838, its third clause: `id` expands, `instance`'s expansion through 1.1's pack writes it. Each failure names `id`. */
export function expandsFailures(after: JsonObject, instance: string, id: string): string[] {
  const e = expansionOf(after, instance, 'after the load');
  if (!e) return [`${instance} has no expansion after the load under ${V11.recipe}, so ${id} doesn't expand: ${show(after['expansions'] ?? null, 800)}`];
  const failures: string[] = [];
  if (e.pack !== named(V11)) failures.push(`${instance} expanded through ${e.pack}, not ${named(V11)}, so ${id} isn't ${V11.recipe}'s`);
  if (!(id in e.derived)) failures.push(`${id} doesn't expand: ${instance} under ${e.pack} derives ${sorted(Object.keys(e.derived)).join(', ') || 'nothing'}`);
  return failures;
}

/**
 * #1961.7bc49ab6: after `label`, the document names `want`'s pack version, and instance `instance` derives
 * `boardOf(want, instance, 2)` and not `boardOf(other, instance, 2)`. Each failure names the instance and both versions.
 */
export function derivesFailures(reply: JsonObject, label: string, instance: string, want: Version, other: Version): string[] {
  const has = boardOf(want, instance, 2);
  const hasNot = boardOf(other, instance, 2);
  const document = reply['document'];
  const pins: JsonValue[] = isObject(document) && Array.isArray(document['packs']) ? document['packs'] : [];
  const e = expansionOf(reply, instance, label);
  const failures: string[] = [];
  if (!pins.includes(named(want))) failures.push(`after ${label} the document names ${show(pins)}, not ${named(want)} (${want.recipe}), so instance \`${instance}\` can't be ${want.recipe}'s rather than ${other.recipe}'s`);
  if (!e) return [...failures, `instance \`${instance}\` has no expansion after ${label} (${want.recipe} would derive ${has}, ${other.recipe} ${hasNot})`];
  if (e.derived[hasNot] !== undefined) failures.push(`after ${label}, instance \`${instance}\` (expanded through ${e.pack}, key ${e.key}) still derives ${hasNot}, which only ${other.recipe} (${named(other)}) derives, though the document names ${named(want)}, whose ${want.recipe} derives ${has}`);
  if (e.derived[has] === undefined) failures.push(`after ${label}, instance \`${instance}\` (expanded through ${e.pack}) doesn't derive ${has}, which ${want.recipe} (${named(want)}) derives in place of ${other.recipe}'s ${hasNot}: it derives ${sorted(Object.keys(e.derived)).join(', ') || 'nothing'}`);
  return failures;
}

/**
 * #1961.7bc49ab6, "after each every evaluated output and content key equals a cold evaluation of that revision": the
 * warm `read` after `label` against the `read` of a fresh process that opened the stored document it shows. Each
 * expansion row is compared field by field (its pack, its key, its derived items with their values, their seeds, its
 * broken_out and the rest), and so are `draws`. Each failure names the instance and the versions the document names.
 */
export function coldFailures(warm: JsonObject, cold: JsonObject, label: string, want: Version, other: Version): string[] {
  const failures: string[] = [];
  const rows = (r: JsonObject, what: string): Map<string, JsonObject> => new Map(expansions(r, what).map((e) => [e.instance, e.raw]));
  const w = rows(warm, `the warm read after ${label}`);
  const c = rows(cold, `the cold read after ${label}`);
  const versions = `that revision is to name ${named(want)} (${want.recipe}) in place of ${named(other)} (${other.recipe})`;
  for (const instance of sorted([...new Set([...w.keys(), ...c.keys()])])) {
    const a = w.get(instance);
    const b = c.get(instance);
    if (!a || !b) { failures.push(`after ${label}, instance \`${instance}\` has an expansion ${a ? 'warm only' : 'cold only'}; ${versions}`); continue; }
    for (const field of sorted([...new Set([...Object.keys(a), ...Object.keys(b)])])) {
      if (canon(a[field]) !== canon(b[field])) failures.push(`after ${label}, instance \`${instance}\`'s ${field} differs from a cold evaluation of that revision: warm ${show(a[field], 500)}, cold ${show(b[field], 500)}; ${versions}`);
    }
  }
  if (canon(warm['draws']) !== canon(cold['draws'])) failures.push(`after ${label}, what draws differs from a cold evaluation of that revision: warm ${show(warm['draws'] ?? null, 500)}, cold ${show(cold['draws'] ?? null, 500)}; ${versions}`);
  return failures;
}

/**
 * A cold evaluation of a revision: a fresh process, with an evidence store of its own, that opens `stored` (the document
 * a warm `read` showed) at revision 0 and reads it.
 */
export function coldRead(bin: string, stored: JsonObject, extra: JsonObject = {}): JsonObject {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-1961-cold-'));
  try {
    const [cold] = run(bin, scenario(evidence, stored, [read()], extra));
    return cold!;
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}
