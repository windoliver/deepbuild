// Shared by the #570 acceptance tests (README: The surface). The tables are read as files under
// packages/contracts/schemas/; the contract test's check through @deepbuild/contracts' public entry; the
// hub's moves through @deepbuild/record's public entry (a real SQLite record in a temp folder); the
// enumerator and the log checker only as `node scripts/lifecycle.mjs <command>`, a process this test starts.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { openRecord, ulid } from '../../../packages/record/src/index.ts';
import type { Connection, RecordStore } from '../../../packages/record/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';

export const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const SCHEMAS = join(ROOT, 'packages/contracts/schemas');
export const FIXTURES = join(ROOT, 'packages/contracts/fixtures');
export const CORPUS = join(ROOT, 'adapters/corpus');
export const SCRIPT = join(ROOT, 'scripts/lifecycle.mjs');

/** The issue's eight record objects with a lifecycle, by the names their tables carry (README). */
export const OBJECTS = ['ask', 'ask_task', 'lease', 'claim', 'attempt', 'waiver', 'open_item', 'session_binding'] as const;

/** Each criterion's ID: the first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed. */
export const ID = {
  tables: '#570.97e22112',
  refused: '#570.23b51af5',
  enumerator: '#570.f58617e9',
  orders: '#570.98951df5',
  crash: '#570.dfd317ed',
  replay: '#570.2f9f6ed9',
  withdrawn: '#570.f596e027',
};

export interface Move { from: string; event: string; guard?: string; to: string }
export interface Table { id: string; states: string[]; initial: string; final: string[]; moves: Move[]; conflicts?: { name: string; events: string[] }[] }

// ---- Scratch folders, removed after each file.
const made: string[] = [];
export function scratch(prefix = 'deep-570-'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}
export function cleanup(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export const json = (value: unknown): string => JSON.stringify(value, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));

// ---- The tables, as files.
export const tableFile = (object: string): string => join(SCHEMAS, `${object}.machine@1.json`);

/** The table of `object` at packages/contracts/schemas/<object>.machine@1.json, asserted to exist and parse. */
export function readTable(object: string): Table {
  const path = tableFile(object);
  expect(existsSync(path), `${relative(ROOT, path)} exists: ${object}'s lifecycle table`).toBe(true);
  let table: unknown;
  try {
    table = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    expect.fail(`${relative(ROOT, path)} reads as JSON: ${(error as Error).message}`);
  }
  expect(typeof table === 'object' && table !== null && !Array.isArray(table), `${relative(ROOT, path)} holds one object`).toBe(true);
  return table as Table;
}

/** The published event kinds: every packages/contracts/schemas/<kind>@<n>.json that isn't a table. */
export function publishedKinds(): Set<string> {
  if (!existsSync(SCHEMAS)) return new Set();
  return new Set(readdirSync(SCHEMAS).filter((f) => f.endsWith('.json') && !/\.machine@\d+\.json$/.test(f)).map((f) => f.replace(/@\d+\.json$/, '')));
}

/**
 * A folder holding a copy of every table in packages/contracts/schemas/ (each *.machine@<n>.json), with
 * `edit` applied to the parsed tables by file name first: how a test plants a table.
 */
export function plantTables(edit: (tables: Map<string, Table>) => void): string {
  const dir = join(scratch('deep-570-tables-'), 'tables');
  mkdirSync(dir);
  const tables = new Map<string, Table>();
  for (const file of existsSync(SCHEMAS) ? readdirSync(SCHEMAS) : []) {
    if (/\.machine@\d+\.json$/.test(file)) tables.set(file, JSON.parse(readFileSync(join(SCHEMAS, file), 'utf8')) as Table);
  }
  edit(tables);
  for (const [file, table] of tables) writeFileSync(join(dir, file), `${JSON.stringify(table, null, 2)}\n`);
  return dir;
}

// ---- The script, run as a process with a temp HOME.
export interface Ran { status: number | null; signal: string | null; stdout: string; stderr: string; lines: string[] }

export function lifecycle(args: readonly string[], timeoutMs = 300_000): Ran {
  const home = scratch('deep-570-home-');
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env.NODE_TEST_CONTEXT;
  delete env.DEEP_HUB_PLANT;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 });
  const stdout = r.stdout ?? '';
  return { status: r.status, signal: r.signal, stdout, stderr: r.stderr ?? '', lines: stdout.split('\n').map((l) => l.trimEnd()).filter(Boolean) };
}

export const show = (r: Ran): string =>
  `exit ${r.status ?? r.signal}\n--- stdout (last 6000)\n${r.stdout.slice(-6000)}\n--- stderr (last 3000)\n${r.stderr.slice(-3000)}`;

/** The lines `<STATE> lifecycle <command>: …` of a run, for STATE in states. */
export const linesOf = (r: Ran, states: readonly string[], command: string): string[] =>
  r.lines.filter((l) => states.some((s) => l.startsWith(`${s} lifecycle ${command}:`)));
/** Its FAIL, BLOCKED, INVALID and INCONCLUSIVE lines. */
export const problems = (r: Ran, command: string): string[] => linesOf(r, ['FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'], command);

/** The number in the line `… <n> states reached …`, asserted present. */
export function statesReached(r: Ran): number {
  const m = r.stdout.match(/(\d+) states reached/);
  expect(m, `the enumerator reports how many states it reached ("<n> states reached")\n${show(r)}`).not.toBeNull();
  return Number(m![1]);
}
/** The number in the line `… <m> crashes …`, asserted present. */
export function crashesReplayed(r: Ran): number {
  const m = r.stdout.match(/(\d+) crash(?:es)?\b/);
  expect(m, `the enumerator reports how many crashes it replayed ("<m> crashes")\n${show(r)}`).not.toBeNull();
  return Number(m![1]);
}

// ---- A real record, on a clock the test sets.
export const who = { actor: 'you', scope: 'you' };
export const core = (session = 'S1'): Connection => ({ writer: 'core', ...who, session });
export const app: Connection = { writer: 'app', ...who };
export const cli: Connection = { writer: 'cli', ...who };
export const mcp = (session = 'S1'): Connection => ({ writer: `mcp:${session}`, ...who, session, agent: 'claude-code' });
export const hook = (session = 'S1'): Connection => ({ writer: 'hook', ...who, session, agent: 'claude-code' });

export interface Opened { record: RecordStore; path: string; clock: { now: () => number; step: (ms: number) => void } }
const records: RecordStore[] = [];
export async function openScratchRecord(path = join(scratch('deep-570-record-'), 'record.db'), start = 1_760_013_451_123): Promise<Opened> {
  let t = start;
  const clock = { now: () => t, step: (ms: number) => { t += ms; } };
  const record = await openRecord({ path, now: clock.now });
  records.push(record);
  return { record, path, clock };
}
export async function closeRecords(): Promise<void> {
  for (const r of records.splice(0)) await r.close().catch(() => {});
}
export const newId = (ms: number): string => ulid(ms);

/** A published fixture's data, as a starting point for an event's data. */
export function fixtureData(name: string): { [key: string]: JsonValue } {
  const file = join(FIXTURES, name, '01.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { data: { [key: string]: JsonValue } }).data;
}

/** Appends one event, resolving with the error the record threw, if any. */
export async function tryAppend(record: RecordStore, connection: Connection, event: Parameters<RecordStore['append']>[1]): Promise<Error | undefined> {
  try {
    await record.append(connection, event);
    return undefined;
  } catch (error) {
    return error as Error;
  }
}

/** Every recorded session of the fixture corpus: adapters/corpus/<agent>/<version>/<session>/ holding events.jsonl. */
export function corpusSessions(): string[] {
  const dirs = (d: string) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);
  const refs: string[] = [];
  for (const agent of dirs(CORPUS)) for (const version of dirs(join(CORPUS, agent))) for (const session of dirs(join(CORPUS, agent, version))) {
    if (existsSync(join(CORPUS, agent, version, session, 'events.jsonl'))) refs.push(`${agent}/${version}/${session}`);
  }
  return refs;
}
