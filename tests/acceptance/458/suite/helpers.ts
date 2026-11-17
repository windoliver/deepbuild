// Test-side tools for #458's suite group (criteria 1, 2, 3, 4, 5, 6 and 8). The tests reach the change only through
// what the README names: `node scripts/parity-suite.mjs run <lane> | report | promote <fixture> | list` with
// `--suite`, `--store`, `--commit`, `--now` and `--planted`, `node scripts/fixture-scan.mjs <path>`, and
// scripts/lanes.mjs's `checks` and `releaseLanes`. A world is a temporary folder holding a suite file, a store and one
// stub runner per lane (fixtures/stub-runner.mjs, laid as an executable), each answering from a plan file the test
// writes. Nothing here stands in for the suite's verdict rules, the bar or the scan: each is read from what the
// scripts print. README: The surface under test.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, onTestFinished } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/458/suite is four levels down). */
export const REPO = realpathSync(join(HERE, '..', '..', '..', '..'));
const SUITE = join(REPO, 'scripts', 'parity-suite.mjs');
const SCAN = join(REPO, 'scripts', 'fixture-scan.mjs');
const STUB = join(HERE, 'fixtures', 'stub-runner.mjs');

/** Every `it` passes this: under load each run of a script takes a second or more. */
export const TIMEOUT = 1_200_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #458.ad2c506c',
  2: 'AC2 #458.fa585b23',
  3: 'AC3 #458.d1e38bf0',
  4: 'AC4 #458.d13e155c',
  5: 'AC5 #458.ae77277a',
  6: 'AC6 #458.78a02001',
  8: 'AC8 #458.33b0fb5c',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and verdict prefixes

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
const ran = (r: SpawnSyncReturns<string>): string =>
  `exit ${r.status}${r.signal ? ` (${r.signal})` : ''}${r.error ? ` (${r.error.message})` : ''}\nstdout: ${(r.stdout ?? '').slice(-2500)}\nstderr: ${(r.stderr ?? '').slice(-2500)}`;

/** A platform need is missing here: never a pass (AGENTS.md: the four invariants). */
export function blocked(reason: string): never {
  return expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
/** The criterion stays open, whatever the reason: never a pass. */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The right program's run: this suite's own check finds nothing. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.slice(0, 8).join(' | ')}`).toEqual([]);
}
/** A planted program's run: this suite's own check must fail on it, and some failure must name `named`. */
export function failsNaming(failures: readonly string[], named: string, what: string): void {
  expect(failures.length, `${what}: the check fails the planted program`).toBeGreaterThan(0);
  expect(failures.some((f) => f.includes(named)), `${what}: a failure names ${named}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// The suite file, the lanes' stub runners and their plans

export type Verdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'INVALID' | 'INCONCLUSIVE';
export type Lane = 'quick' | 'full' | 'cross' | 'oracle';
export const LANES: readonly Lane[] = ['quick', 'full', 'cross', 'oracle'];

/** A planted-fault twin; one that names a comparison is that comparison's planted-mismatch twin. */
export interface Twin { name: string; comparison?: string }
export interface Fixture {
  name: string;
  lanes: Lane[];
  backends: string[];
  owner?: string;
  twins: Twin[];
  pixels?: { loose_ceiling: number; iou_floor: number };
}
export interface Waiver { fixture: string; reason: string }
export interface ExpectedFailure { fixture: string; backend: string; adapter: string; driver: string; reason: string }
export interface Lists { waivers?: Waiver[]; expected_failures?: ExpectedFailure[] }

/** What a runner answers for one request. */
export interface Reply {
  verdict: Verdict;
  reason?: string;
  digest?: string;
  comparisons?: { name: string; verdict: Verdict }[];
  pixels?: { flip: number; iou: number };
}
/** A stub's answers for one fixture: its own run, and each twin it doesn't fail as planned. */
export interface Answer { run: Reply; twins?: Record<string, Reply> }
export interface Device { backend: string; adapter?: { name: string; driver: string; type: string } }

/** The adapter the stub GPU lanes report, and the same adapter after a driver update. */
export const STUB_GPU = { name: 'Stub GPU', driver: '1.0', type: 'integrated_gpu' } as const;
export const STUB_GPU_NEW_DRIVER = { ...STUB_GPU, driver: '2.0' } as const;
const DEVICES: Record<Lane, Device> = {
  quick: { backend: 'vello_cpu' },
  full: { backend: 'gpu', adapter: STUB_GPU },
  cross: { backend: 'gpu', adapter: STUB_GPU },
  oracle: { backend: 'gpu', adapter: STUB_GPU },
};

export const digest = (label: string): string => createHash('sha256').update(label).digest('hex');
export const pass = (label = 'clean'): Reply => ({ verdict: 'PASS', digest: digest(label) });
export const fail = (label = 'wrong'): Reply => ({ verdict: 'FAIL', digest: digest(label) });
export const cantRun = (reason: string): Reply => ({ verdict: 'BLOCKED', reason });

export interface World { dir: string; suite: string; store: string }
const tool = (w: World, lane: Lane): string => join(w.dir, 'tools', `${lane}-runner`);
const plan = (w: World, lane: Lane): string => join(w.dir, `${lane}.plan.json`);

/** The lane's tool: the stub runner as an executable of its own, so removing the file removes the tool. */
export function install(w: World, lane: Lane): void {
  writeFileSync(tool(w, lane), `#!${process.execPath}\n${readFileSync(STUB, 'utf8')}`);
  chmodSync(tool(w, lane), 0o755);
}
export function removeTool(w: World, lane: Lane): void {
  rmSync(tool(w, lane));
}
/** What the lane's stub answers from now on, and the device it says it ran on. */
export function answers(w: World, lane: Lane, fixtures: Record<string, Answer>, device: Device = DEVICES[lane]): void {
  writeFileSync(plan(w, lane), JSON.stringify({ device, fixtures }));
}
/** The suite file: the four lanes, each with its runner, the fixtures, and the waivers and expected failures. */
export function writeSuite(w: World, fixtures: readonly Fixture[], lists: Lists = {}): void {
  const lanes = Object.fromEntries(LANES.map((lane) => [lane, { runner: [tool(w, lane), plan(w, lane)] }]));
  writeFileSync(w.suite, JSON.stringify({ lanes, fixtures, waivers: lists.waivers ?? [], expected_failures: lists.expected_failures ?? [] }, null, 2));
}
/** A temporary suite file, store and four stub lanes whose stubs know no fixture yet; removed when the test ends. */
export function world(fixtures: readonly Fixture[], lists: Lists = {}): World {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-458-suite-')));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const w: World = { dir, suite: join(dir, 'suite.json'), store: join(dir, 'store') };
  mkdirSync(join(dir, 'tools'));
  mkdirSync(w.store);
  for (const lane of LANES) {
    install(w, lane);
    answers(w, lane, {});
  }
  writeSuite(w, fixtures, lists);
  return w;
}
/** Every request the lane's stub has been sent since the world began, in order. */
export function requests(w: World, lane: Lane): { fixture: string; twin: string | null }[] {
  const log = `${plan(w, lane)}.log`;
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => {
    const r = JSON.parse(line) as { fixture: string; twin?: { name: string } | null };
    return { fixture: r.fixture, twin: r.twin?.name ?? null };
  });
}

// ---------------------------------------------------------------------------------------------------
// Commits and the clock the runs are given

/** A commit ID for the nth commit of a test: 40 hex digits, as git's. */
export const commit = (n: number): string => createHash('sha1').update(`#458 suite commit ${n}`).digest('hex');
/** The first run's time, and a time `days` and `hours` after it. */
export const T0 = '2026-03-02T09:00:00Z';
export const after = (days: number, hours = 0): string => new Date(Date.parse(T0) + (days * 24 + hours) * 3_600_000).toISOString();
export interface At { commit: string; now: string; planted?: string }

// ---------------------------------------------------------------------------------------------------
// The scripts

function script(path: string, args: readonly string[]): SpawnSyncReturns<string> {
  const name = path.slice(REPO.length + 1);
  expect(existsSync(path), `${name} is missing: the checkout has no ${name === 'scripts/fixture-scan.mjs' ? 'fixture scan' : 'parity suite runner, release report or bar'}`).toBe(true);
  return spawnSync(process.execPath, [path, ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: TIMEOUT });
}
function lastLine(r: SpawnSyncReturns<string>, what: string): JsonObject {
  let parsed: JsonValue | undefined;
  try {
    parsed = JSON.parse((r.stdout ?? '').trim().split('\n').at(-1) ?? '') as JsonValue;
  } catch {
    parsed = undefined;
  }
  expect(isObject(parsed), `${what} prints one JSON object as its last line; ${ran(r)}`).toBe(true);
  return parsed as JsonObject;
}
const where = (w: World, at: At): string[] => ['--suite', w.suite, '--store', w.store, '--commit', at.commit, '--now', at.now, ...(at.planted ? ['--planted', at.planted] : [])];

/** One run of a lane: its record. */
export function runLane(w: World, lane: Lane, at: At): JsonObject {
  const record = lastLine(script(SUITE, ['run', lane, ...where(w, at)]), `parity-suite.mjs run ${lane}`);
  arr(record['rows'], `the ${lane} lane's record's rows`);
  return record;
}
/** The release report for a commit, and the status the script exited with. */
export function report(w: World, at: At): { status: number | null; report: JsonObject } {
  const r = script(SUITE, ['report', ...where(w, at)]);
  return { status: r.status, report: lastLine(r, 'parity-suite.mjs report') };
}
/** A promotion to must-pass: the reply. */
export function promote(w: World, fixture: string, at: At): JsonObject {
  return lastLine(script(SUITE, ['promote', fixture, ...where(w, at)]), `parity-suite.mjs promote ${fixture}`);
}
/** The shipped suite, as the script lists it with no `--suite`. */
export function list(): JsonObject {
  return lastLine(script(SUITE, ['list']), 'parity-suite.mjs list');
}
/** The fixture scan over a folder: its status and output. */
export function scan(folder: string): { status: number | null; out: string; lines: string[] } {
  const r = script(SCAN, [folder]);
  expect(r.error, `fixture-scan.mjs ran; ${ran(r)}`).toBeUndefined();
  return { status: r.status, out: ran(r), lines: (r.stdout ?? '').split('\n') };
}

// ---------------------------------------------------------------------------------------------------
// Reading a record and a report

/** A fixture's row in a lane's record. */
export function rowOf(record: JsonObject, fixture: string): JsonObject {
  const row = arr(record['rows'], 'rows').find((r) => isObject(r) && r['fixture'] === fixture);
  return obj(row, `the row of ${fixture} in the ${String(record['lane'])} lane's record (${show(record['rows'], 400)})`);
}
/** A fixture's entry in a release report. */
export function entryOf(rep: JsonObject, fixture: string): JsonObject {
  const entry = arr(rep['fixtures'], 'the report\'s fixtures').find((f) => isObject(f) && f['fixture'] === fixture);
  return obj(entry, `the report's entry for ${fixture}`);
}
/** The fixtures the bar failed on. */
export function failed(rep: JsonObject): string[] {
  return arr(rep['failures'], 'the report\'s failures').map((f) => String(obj(f, 'a failure')['fixture'])).sort();
}
/** What a row says of each named field, for a failure message. */
export const says = (row: JsonObject): string => show({ verdict: row['verdict'] ?? null, reason: row['reason'] ?? null, owner: row['owner'] ?? null, since: row['since'] ?? null, age_days: row['age_days'] ?? null });
