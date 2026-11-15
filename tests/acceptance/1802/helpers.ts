// Test-side tools for the #1802 acceptance tests: the criterion IDs; fixture trees the contract step is pointed at
// with --root (a preview entry with its `preview_since` and `decide_by`, a release recorded by the step's own
// `record`, a break file, an extension on record); the step run in a clean environment, and the planted step in its
// place (plants/reports-only.mjs); the world an extension's ask is raised and answered in; and `deep-show` built per
// Cargo feature set and driven by one scenario line on stdin, for `deep_kinds` and the kit's migration part.
// Nothing here stands in for a surface: every result read here is `scripts/contract-diff.mjs`'s, the hub's public
// entry's, the asks core's or the `deep-show` binary's own (README: The surface under test). The step and tree tools
// follow tests/acceptance/139's, the `deep-show` tools tests/acceptance/412's, 138's and 1956's; they are copied, never
// imported, so this suite changes no other suite's process (139's helpers move HOME, which a cargo build must keep).
//
// Safety: every folder is a temp folder this file made and deletes; the step's children get a temp HOME and none of
// the agent's CLAUDE_* or DEEP_* variables; nothing is started that isn't stopped by the call that started it; no
// network.

import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import type { Asks } from '../../../packages/asks/src/index.ts';
import { d1Digest } from '../../../packages/contracts/src/index.ts';
import type { Connection, RecordStore } from '../../../packages/record/src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1802 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const NODE = process.execPath;

// ---------------------------------------------------------------------------------------------------
// Criteria: `#1802.<first 8 hex of the SHA-256 of the criterion's text, trimmed, white space collapsed>`, as
// scripts/proof-change.mjs (`criterionId`) computes them from the live issue. Each test's title starts with its ID,
// written out so the trace lane reads it.

export const CRITERIA = {
  ac1: { id: '#1802.1c4f47ee', text: 'A preview entry with no `decide_by`, or one more than 3 releases after its `preview_since`, fails the preflight, naming the entry' },
  ac2: { id: '#1802.cca13350', text: 'In a fixture release that is an entry\'s `decide_by`, the preflight fails, naming the entry, until it is stable, removed or extended. A planted preflight that only warns fails this test' },
  ac3: { id: '#1802.0d11e259', text: 'A fixture entry promoted and then changed in the same release fails the break diff, naming the field' },
  ac4: { id: '#1802.b8a0e044', text: 'A corpus document that lists a removed entry in `requires.preview` opens through the entry\'s migration with the same evaluated values at 20 sampled times, or the removal is refused, naming the document. A planted removal with no migration fails' },
  ac5: { id: '#1802.9ef4dcb1', text: 'An extension is one ask answered by a person, recorded with its reason and a new `decide_by` at most 2 releases later. A second extension of the same entry is refused, and an agent\'s patch to `decide_by` is refused' },
  ac6: { id: '#1802.c5460f6b', text: '`deep_kinds` lists `preview_since` and `decide_by` for each preview entry, and a listing that leaves either out fails, naming the entry' },
  ac7: { id: '#1802.9400be12', text: 'The generated release notes name every entry promoted, removed or extended, and each shipped demo that names a preview entry is listed with it. A planted note that drops one fails, naming the entry' },
  ac8: { id: '#1802.18e8cff0', text: 'A fixture release removes a method, with a break file that quotes the removal, and a later commit restores the method. The step fails, naming the file and the quoted line that no longer occurs. A planted step that only prints the line passes and fails this test' },
  ac9: { id: '#1802.3f79e4e6', text: 'A break file that quotes two lines, one still in the diff and one not, fails, naming the one that isn\'t' },
  ac10: { id: '#1802.b515e798', text: 'With the stale file deleted, removing the method again fails as a break with no file, naming the method. A planted tree that keeps the stale file passes the same removal, and the test that expects the failure catches it' },
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and the judges' two ends

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 800)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 800)}`).toBe(true);
  return value as JsonValue[];
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 800)}`).toBe('string');
  return value as string;
}
export const show = (value: unknown, max = 1500): string => JSON.stringify(value)?.slice(0, max) ?? String(value);
/** Whether a value's JSON text holds `needle` (a name, a path, a release). */
export const mentions = (value: unknown, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);
export const readJson = (path: string): JsonValue => JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** No failures; the message lists them. A criterion's check on the right program. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names each of `names`: what a criterion's check must give on its planted program. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  }
}

// ---------------------------------------------------------------------------------------------------
// Temp folders, deleted after the file

const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `deep-1802-${tag}-`)));
  made.push(dir);
  return dir;
}
const worlds: World[] = [];
afterAll(async () => {
  for (const w of worlds.splice(0)) await w.close().catch(() => undefined);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 60_000);

// ---------------------------------------------------------------------------------------------------
// The contract step: `node scripts/contract-diff.mjs <command> --release <R> --root <tree>` (#139), and the planted
// step run in its place.

export const STEP = join(REPO, 'scripts', 'contract-diff.mjs');
/** The planted step (plants/reports-only.mjs): the same step, its failures only printed. */
export const REPORTS_ONLY = join(HERE, 'plants', 'reports-only.mjs');

export interface Ran { code: number | null; stdout: string; stderr: string; out: string; timedOut: boolean }
let stepHome: string | undefined;
/** A child's environment: this process's, less the agent's own variables, with a temp HOME. */
function stepEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('DEEP_') && !key.startsWith('CLAUDE') && key !== 'AI_AGENT' && key !== 'NODE_OPTIONS') env[key] = value;
  env['HOME'] = stepHome ??= tempDir('home');
  env['PATH'] = `${dirname(NODE)}:${process.env['PATH'] ?? '/usr/bin:/bin'}`;
  return env;
}
export const shown = (r: Ran): string => `exit ${r.code}${r.timedOut ? ' (killed at the timeout)' : ''}, output ${JSON.stringify(r.out.slice(-3000))}`;

/**
 * Runs the step, or `program` in its place, on the tree. A step that can't run is BLOCKED, never a pass or a
 * failure of a criterion: the contracts package not built, or the step's own BLOCKED line (exit 3).
 */
export function step(args: readonly string[], t: Tree, program: string = STEP): Ran {
  if (!existsSync(join(REPO, 'packages', 'contracts', 'dist', 'index.js'))) throw Error('BLOCKED: packages/contracts/dist is not built (npm run build --workspaces), so scripts/contract-diff.mjs can\'t run');
  const r = spawnSync(NODE, [program, ...args, '--root', t.root], { cwd: REPO, env: stepEnv(), encoding: 'utf8', timeout: 300_000, maxBuffer: 1 << 28 });
  const ran: Ran = { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}`, timedOut: r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' };
  if (r.error && !ran.timedOut) throw Error(`BLOCKED: ${program.slice(REPO.length + 1)} could not start: ${r.error.message}`);
  if (ran.code === 3) throw Error(`BLOCKED: the contract step could not run: ${ran.out.split('\n').find((l) => l.startsWith('BLOCKED')) ?? shown(ran)}`);
  return ran;
}
/** The preflight's contract step on the candidate `release`. */
export const check = (t: Tree, release: string, program: string = STEP): Ran => step(['check', '--release', release], t, program);
/** The generated release notes of the candidate `release`. */
export const notes = (t: Tree, release: string): Ran => step(['notes', '--release', release], t);
/** Cuts `release` from the tree as it is now, with the step's own `record` (#139): how a fixture release is made. */
export function record(t: Tree, release: string): void {
  const r = step(['record', '--release', release], t);
  expect(r.code, `record ${release} on the fixture tree\n${shown(r)}`).toBe(0);
  expect(existsSync(at(t, `contracts/releases/${release}.json`)), `record ${release} writes contracts/releases/${release}.json`).toBe(true);
}

/** The step's FAIL lines: `FAIL contracts: <entry or file>: <reason>`. */
export const failLines = (r: Ran): string[] => r.out.split('\n').filter((l) => l.startsWith('FAIL contracts:'));
/** The run passed: exit 0, a PASS line and no FAIL line. */
export const passed = (r: Ran): boolean => r.code === 0 && failLines(r).length === 0 && /^PASS contracts/m.test(r.out);
/** The run failed (exit 1) with one FAIL line holding every part: the entry, the field, the file, the quoted line. */
export const failedNaming = (r: Ran, ...parts: string[]): boolean => r.code === 1 && failLines(r).some((l) => parts.every((p) => l.includes(p)));
export function expectPass(r: Ran, what: string): void {
  expect(passed(r), `${what}: the step exits 0 with a PASS contracts line and no FAIL contracts line\n${shown(r)}`).toBe(true);
}
export function expectFailNaming(r: Ran, what: string, ...parts: string[]): void {
  expect(failedNaming(r, ...parts), `${what}: the step exits 1 and one FAIL contracts line names ${parts.join(' and ')}; its FAIL lines are ${JSON.stringify(failLines(r))}\n${shown(r)}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Fixture trees: what the step reads under --root. A fixture tree starts empty, so no entry of the repo's own
// contracts, with whatever `decide_by` it comes to carry, is in a fixture release.

export interface Tree { root: string }
export const at = (t: Tree, rel: string): string => join(t.root, rel);
export const API_FILE = 'packages/contracts/extension-api.json';
export const SHIPPED_FILE = 'contracts/shipped.json';
export const EXTENSIONS_FILE = 'contracts/extensions.json';

/** A tree with no published entry, no shipped piece and no release. */
export function emptyTree(tag = 'tree'): Tree {
  const t: Tree = { root: tempDir(tag) };
  writeJson(at(t, API_FILE), []);
  writeJson(at(t, SHIPPED_FILE), { pieces: [] });
  mkdirSync(at(t, 'contracts/releases'), { recursive: true });
  return t;
}
/** A copy of a tree, with the releases it has recorded. */
export function fork(t: Tree, tag = 'fork'): Tree {
  const root = tempDir(tag);
  cpSync(t.root, root, { recursive: true });
  return { root };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;
export function edit(t: Tree, rel: string, fn: (value: Json) => void): void {
  const value: Json = readJson(at(t, rel));
  fn(value);
  writeJson(at(t, rel), value);
}

/** A fixture method's params: one required field, `threshold`, an integer. */
export const PARAMS = { type: 'object', properties: { threshold: { type: 'integer' } }, required: ['threshold'], additionalProperties: false } as const;
const paramsCopy = (): Json => JSON.parse(JSON.stringify(PARAMS)) as Json;
/** The issue a fixture preview entry names as tracking it. */
export const TRACKING = '#1802';

/** A preview API entry as published (README: the published data): its tracking issue, `preview_since` and `decide_by`; `null` leaves a field out. */
export function previewEntry(method: string, dates: { preview_since: string | null; decide_by: string | null }, since = 'R1'): Json {
  const params = paramsCopy();
  return {
    method, variants: null, since, stability: 'preview', tracking: TRACKING,
    ...(dates.preview_since === null ? {} : { preview_since: dates.preview_since }),
    ...(dates.decide_by === null ? {} : { decide_by: dates.decide_by }),
    digest: d1Digest(params), params,
  };
}
/** A stable API entry as published. */
export function stableEntry(method: string, since = 'R1'): Json {
  const params = paramsCopy();
  return { method, variants: null, since, stability: 'stable', digest: d1Digest(params), params };
}
/** Publishes an API entry; a stable one is also called by a shipped piece of the candidate, as the step asks (#139). */
export function addApi(t: Tree, entry: Json): void {
  edit(t, API_FILE, (api) => { api.push(entry); });
  if (entry.stability === 'stable') edit(t, SHIPPED_FILE, (s) => { s.pieces.push({ piece: `fixture/${entry.method}`, calls: [entry.method] }); });
}
/** Takes an API entry out of the published data, and out of what the shipped pieces call and name. */
export function removeApi(t: Tree, method: string): void {
  edit(t, API_FILE, (api) => {
    const i = api.findIndex((e: Json) => e.method === method);
    if (i < 0) throw Error(`the fixture tree publishes no ${method}`);
    api.splice(i, 1);
  });
  edit(t, SHIPPED_FILE, (s) => { s.pieces = s.pieces.filter((p: Json) => !(p.calls ?? []).includes(method)); });
}
/** Edits one published API entry in place. */
export function editApi(t: Tree, method: string, fn: (entry: Json) => void): void {
  edit(t, API_FILE, (api) => {
    const e = api.find((x: Json) => x.method === method);
    if (!e) throw Error(`the fixture tree publishes no ${method}`);
    fn(e);
  });
}
/** Promotes a preview entry: it is published stable, with no tracking issue, `preview_since` or `decide_by`, and a shipped piece calls it. */
export function promote(t: Tree, method: string): void {
  editApi(t, method, (e) => {
    e.stability = 'stable';
    delete e.tracking;
    delete e.preview_since;
    delete e.decide_by;
  });
  edit(t, SHIPPED_FILE, (s) => { s.pieces.push({ piece: `fixture/${method}`, calls: [method] }); });
}
/** Retypes the fixture method's `threshold` field from integer to string, its digest following its shape. */
export function retypeThreshold(t: Tree, method: string): void {
  editApi(t, method, (e) => {
    e.params.properties.threshold = { type: 'string' };
    e.digest = d1Digest(e.params);
  });
}
/** An extension as it is on record in the tree (README: contracts/extensions.json), written as data: the row, and the entry's new `decide_by`. */
export function extensionOnRecord(t: Tree, method: string, row: { from: string; to: string; reason: string; ask: string }): void {
  editApi(t, method, (e) => { e.decide_by = row.to; });
  const file = at(t, EXTENSIONS_FILE);
  const rows: Json = existsSync(file) ? readJson(file) : [];
  rows.push({ entry: `api:${method}`, ...row });
  writeJson(file, rows);
}
/** The tree's extensions on record for an entry. */
export function extensionsOf(t: Tree, method: string): Json[] {
  const file = at(t, EXTENSIONS_FILE);
  const rows: Json = existsSync(file) ? readJson(file) : [];
  return (Array.isArray(rows) ? rows : []).filter((r: Json) => r?.entry === `api:${method}`);
}
/** An API entry's published `decide_by`. */
export const decideByOf = (t: Tree, method: string): unknown => (readJson(at(t, API_FILE)) as Json[]).find((e: Json) => e.method === method)?.decide_by;

/** The preview method most scenes use. */
export const TRIAL = 'deep.trial';
/**
 * The scene of criteria 2, 3 and 5: `deep.trial`, a preview since R1 whose `decide_by` is R3, in the two fixture
 * releases R1 and R2. R3 is the candidate.
 */
export function trialTree(): Tree {
  const t = emptyTree('trial');
  addApi(t, previewEntry(TRIAL, { preview_since: 'R1', decide_by: 'R3' }));
  record(t, 'R1');
  record(t, 'R2');
  return t;
}

/** A reviewed break file `contracts/breaks/<from>_<to>/<issue>.txt` (#139): each quoted diff line verbatim, then the workaround. Returns its path under the root. */
export function breakFile(t: Tree, from: string, to: string, issue: string, quoted: readonly string[], workaround: string): string {
  const rel = `contracts/breaks/${from}_${to}/${issue}.txt`;
  mkdirSync(dirname(at(t, rel)), { recursive: true });
  writeFileSync(at(t, rel), `${quoted.join('\n')}\nworkaround: ${workaround}\n`);
  return rel;
}
/** The diff line of a stable API method removed between two releases, as the step prints it and a break file quotes it (#139). */
export const removalLine = (from: string, to: string, method: string): string => `diff: ${from}_${to} api:${method} / removed`;

/** The method criteria 8 and 10 remove, and the break file that quotes its removal. */
export const GONE = 'deep.gone';
export const GONE_FILE = 'contracts/breaks/R1_R2/1802.txt';
export const GONE_LINE = removalLine('R1', 'R2', GONE);
/**
 * The scene of criteria 8 and 10. R1 is recorded with the stable method deep.gone; the fixture release R2 removes it,
 * with a break file that quotes the removal; a later commit restores the method as it was. Each stage must stand as
 * the criterion describes it before the next is made: the removal fails with no file, and passes with its file,
 * which the passing run names as the file it used. Returns the restored tree, the stale file still in it.
 */
export function restoredTree(): Tree {
  const t = emptyTree('gone');
  addApi(t, stableEntry(GONE));
  addApi(t, stableEntry('deep.stays'));
  record(t, 'R1');
  removeApi(t, GONE);
  expectFailNaming(check(t, 'R2'), 'the fixture release R2 removes deep.gone, and with no break file that is a break', GONE);
  expect(breakFile(t, 'R1', 'R2', '1802', [GONE_LINE], 'Call deep.stays instead.')).toBe(GONE_FILE);
  const reviewed = check(t, 'R2');
  expectPass(reviewed, 'the same removal with a break file that quotes it');
  expect(reviewed.out, `the passing run lists the break file it used\n${shown(reviewed)}`).toContain(GONE_FILE);
  addApi(t, stableEntry(GONE));
  return t;
}

// ---------------------------------------------------------------------------------------------------
// The world an extension's ask is raised and answered in: a record and the asks core over it (#139's world, less
// the supervisor and the host), and the hub's public entry.

export interface World { dir: string; record: RecordStore; asks: Asks; close(): Promise<void> }
/** The trusted path: you, answering on the question card. */
export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };

export async function openWorld(): Promise<World> {
  for (const key of Object.keys(process.env)) if (key.startsWith('DEEP_') || key.startsWith('CLAUDE') || key === 'AI_AGENT') delete process.env[key];
  const dir = tempDir('world');
  const { openRecord } = await import('../../../packages/record/src/index.ts');
  const { openAsks } = await import('../../../packages/asks/src/index.ts');
  const rec = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record: rec, now: Date.now, deliver: () => undefined });
  let closed = false;
  const w: World = { dir, record: rec, asks, close: async () => { if (closed) return; closed = true; await rec.close(); } };
  worlds.push(w);
  return w;
}

/** `extendPreview`'s options (README: the hub's public entry). */
export interface ExtendOptions { root: string; record: RecordStore; asks: Asks; entry: string; decide_by: string; reason: string }
export type ExtendPreview = (options: ExtendOptions) => Promise<unknown>;
/** The hub's public entry, as a caller outside the package reaches it. */
export async function hubEntry(): Promise<{ extendPreview?: ExtendPreview }> {
  return (await import('../../../packages/hub/src/index.ts')) as unknown as { extendPreview?: ExtendPreview };
}

export const sleep = (ms: number): Promise<void> => new Promise<void>((done) => setTimeout(done, ms));
export async function waitUntil<T>(probe: () => Promise<T | undefined | false>, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > end) throw Error(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(50);
  }
}
/** The open asks that need you whose card names `name`. */
export async function cardsNaming(w: World, name: string): Promise<{ ask: string }[]> {
  return (await w.asks.needsYou()).filter((c) => mentions(c, name)).map((c) => ({ ask: c.ask }));
}
/** Your answer on the trusted path: the option that declares `decision`, bound to the plan the card shows and to your click. */
export async function answerCard(w: World, ask: string, decision: 'allow' | 'deny'): Promise<void> {
  const card = await w.asks.card(ask);
  const option = card.options.find((o) => o.decision === decision);
  expect(option, `the ask's card has an option that declares ${decision}: ${show(card.options)}`).toBeDefined();
  await w.asks.answer(YOU, ask, { option: option!.id, plan_hash: card.plan?.hash ?? null, token: `click-${Date.now()}` });
}

// ---------------------------------------------------------------------------------------------------
// `deep-show`: one binary per Cargo feature set, built once per file, each kept under its own name (#412's, #138's
// and #1956's suites).

const SHOW_NAME = 'deep-show';
/** The test canvas modules' Cargo features this suite reads (README: Test features of deep-show). */
export type ShowFeature = 'test-preview' | 'test-preview-removed' | 'test-preview-removed-bare';
const featuresOf = (feature: ShowFeature): string[] => ['full', feature];
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetOf = (env: NodeJS.ProcessEnv): string => (env['CARGO_TARGET_DIR'] ? resolve(REPO, env['CARGO_TARGET_DIR']) : join(REPO, 'target'));
/** Builds stay light on the shared Mac: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };

interface Built { bin: string; error: string; blocked: string }
/** `cargo build --locked --bin deep-show --no-default-features --features full,<feature>`, the binary copied to `to`. */
function buildTo(feature: ShowFeature, to: string): Built {
  const args = ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', featuresOf(feature).join(',')];
  const env = { ...process.env, ...CARGO_ENV };
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return { bin: to, error: '', blocked: `cargo could not run, so ${SHOW_NAME} was not built: ${run.error.message}` };
  if (run.status !== 0) return { bin: to, error: `cargo ${args.join(' ')} failed:\n${(run.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Locking|Updating/.test(l)).join('\n').slice(0, 4000)}`, blocked: '' };
  copyFileSync(join(targetOf(env), 'debug', exe(SHOW_NAME)), to);
  return { bin: to, error: '', blocked: '' };
}
/**
 * Builds each listed feature set once, before the file's tests. A test that asks for a build cargo refused fails with
 * cargo's error; where cargo itself is missing it is BLOCKED.
 */
export function useBuilds(features: readonly ShowFeature[]): (feature: ShowFeature) => string {
  let dir = '';
  const built = new Map<ShowFeature, Built>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1802-bins-'));
    for (const feature of features) if (!built.has(feature)) built.set(feature, buildTo(feature, join(dir, `${SHOW_NAME}-full+${feature}`)));
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (feature) => {
    const entry = built.get(feature);
    if (!entry) throw Error(`the file didn't list the build full,${feature} in useBuilds`);
    if (entry.blocked) throw Error(`BLOCKED: ${entry.blocked}`);
    expect(entry.error, `the binary builds: ${SHOW_NAME} with features ${featuresOf(feature).join(',')}`).toBe('');
    return entry.bin;
  };
}

/** A fresh folder per test, deleted after it: a corpus folder. */
export function useFolder(tag: string): () => string {
  let dir = '';
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), `deep-1802-${tag}-`))); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
/** A fresh evidence store root for each process a test runs, so no process sees another's store; all deleted after the test. */
export function useEvidence(): () => string {
  const root = useFolder('ev');
  let n = 0;
  return () => {
    const dir = join(root(), `run-${++n}`);
    mkdirSync(dir);
    return dir;
  };
}

// The world the scenarios share (#1956's): the working agent's session, the process table, a panel, one document.
const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: previews', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
/** The document the scenarios present. */
export const DOC = `01JB1802D${'1'.padStart(17, '0')}`;

export function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { [DOC]: { panel: 'main' } },
    calls,
  };
}
/** `deep-show run`: one scenario line in, one line out, exit 0, one reply per call (#393's convention). */
export function run(bin: string, sc: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
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
// deep_kinds (#412): the listing, every page followed by its cursor.

/** One row the listing holds with a `stability`: an entry of a registry, or a registry or slot itself. */
export interface Listed { name: string; stability: string | undefined; raw: JsonObject }
function listedOf(o: JsonObject, what: string): Listed {
  const stability = o['stability'];
  return { name: str(o['name'], `${what}.name`), stability: typeof stability === 'string' ? stability : undefined, raw: o };
}
/** `deep_kinds` `list`, page after page: every registry and slot row, and every entry under them, in order. */
export function listAll(bin: string, evidence: string): Listed[] {
  const out: Listed[] = [];
  // A registry cut across pages comes again on the next page with its remaining entries: its own row counts once.
  const rows = new Set<string>();
  let cursor: string | undefined;
  for (let page = 1; page <= 200; page++) {
    const call: JsonObject = cursor === undefined ? { call: 'deep_kinds', op: 'list' } : { call: 'deep_kinds', op: 'list', cursor };
    const reply = run(bin, scenario(evidence, [call]))[0]!;
    expect(reply['error'], `deep_kinds list, page ${page}, answers: ${show(reply)}`).toBeUndefined();
    for (const [i, v] of arr(reply['registries'], `deep_kinds list page ${page}: registries`).entries()) {
      const row = obj(v, `page ${page}: registries[${i}]`);
      const listed = listedOf(row, `page ${page}: registries[${i}]`);
      const key = `${String(row['kind'])}:${listed.name}`;
      if (!rows.has(key)) out.push(listed);
      rows.add(key);
      const held = row['entries'];
      for (const [j, e] of (Array.isArray(held) ? held : []).entries()) out.push(listedOf(obj(e, `${listed.name}.entries[${j}]`), `${listed.name}.entries[${j}]`));
    }
    const next = reply['next'];
    cursor = typeof next === 'string' && next !== '' ? next : undefined;
    if (cursor === undefined) return out;
  }
  throw Error('deep_kinds list did not end within 200 pages');
}

// ---------------------------------------------------------------------------------------------------
// The kit's migration part over a corpus folder (#138), and a document presented from your shell (#393).

/** Flicks per second (One clock). */
export const FLICKS = 705_600_000;
/** A corpus document saved by this build: its values and snapshots at each time, in `<corpus>/<name>.json` (#138). Returns the file. */
export function corpusRecord(bin: string, evidence: string, corpus: string, name: string, document: JsonObject, times: readonly string[]): string {
  const reply = run(bin, scenario(evidence, [{ call: 'corpus_record', corpus, name, document, times: [...times] }]))[0]!;
  const file = str(reply['file'], `corpus_record's file: ${show(reply)}`);
  expect(existsSync(file), `the corpus file exists: ${file}`).toBe(true);
  return file;
}
/** One module's result in a `kit` reply, with its migration part's cases and every failure it names. */
export interface KitModule { verdict: string; cases: JsonObject[]; failures: JsonObject[]; raw: JsonObject }
/** `{"call": "kit"}` for one canvas module's migration part over a corpus folder. */
export function kitMigration(bin: string, evidence: string, module: string, corpus: string): KitModule {
  const reply = run(bin, scenario(evidence, [{ call: 'kit', modules: [module], parts: ['migration'], corpus, param_sets: 10 }]))[0]!;
  const modules = arr(reply['modules'], `the kit's modules: ${show(reply)}`).map((m, i) => obj(m, `the kit's modules[${i}]`));
  const found = modules.find((m) => m['module'] === module);
  expect(found, `the kit's report holds the module ${module}; it holds ${modules.map((m) => String(m['module'])).join(', ') || 'none'}`).toBeDefined();
  const result: JsonObject = found ?? {};
  const parts = arr(result['parts'] ?? [], `${module}.parts`).map((p, i) => obj(p, `${module}.parts[${i}]`)).filter((p) => p['part'] === 'migration');
  const cases = parts.flatMap((p) => arr(p['cases'] ?? [], `${module}'s migration cases`).map((c, i) => obj(c, `${module}'s migration cases[${i}]`)));
  const named: JsonValue[] = [
    ...arr(result['failures'] ?? [], `${module}.failures`),
    ...parts.flatMap((p) => arr(p['failures'] ?? [], `${module}'s migration failures`)),
    ...cases.flatMap((c) => { const failure = c['failure']; return failure === undefined ? [] : [failure]; }),
  ];
  const failures = named.map((f, i) => obj(f, `${module}'s failures[${i}]`));
  return { verdict: str(result['verdict'], `${module}.verdict`), cases, failures, raw: result };
}
/** A whole revision from your shell (`deep show`), with its issues and notices. */
export const present = (document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc: DOC, document, include: ['issues'] });
