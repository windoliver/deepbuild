// Shared test-side tools for the issue #14 acceptance tests: a test clock, ULIDs minted from it, event
// builders from the contracts fixtures, connections, table snapshots and their comparison. None of them
// stands in for the record.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type TestContext } from 'vitest';
import { catalogue, fixtures } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import type { Evidence } from '../../../packages/evidence/src/index.ts';
import { RecordError } from '../../../packages/record/src/index.ts';
import type { Connection, Event, EventInput, RecordStore, Row, Table } from '../../../packages/record/src/index.ts';

export const SECOND = 1000;
export const DAY = 86_400_000;
/** 2026-10-01 12:00 UTC: every test starts its clock here. */
export const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
export const COMMIT = 'f346706f346706f346706f346706f346706f3467';

export type JsonObject = { [key: string]: JsonValue };
export const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const clone = <T>(v: T): T => structuredClone(v);
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const utf8 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'utf8'));

// ---- A seeded generator.
export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function word(rng: Rng, length: number, alphabet = ALNUM): string {
  let s = '';
  for (let i = 0; i < length; i++) s += alphabet[Math.floor(rng() * alphabet.length)];
  return s;
}
export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;

// ---- The test clock: the record reads time only through now().
export interface Clock { now(): number; tick(ms: number): number; set(ms: number): void }
export function makeClock(start = T0): Clock {
  let t = start;
  return { now: () => t, tick: (ms) => (t += ms), set: (ms) => { t = ms; } };
}
/** A hook's seq: nanoseconds since the epoch when the hook started. */
export const seqAt = (ms: number, ns = 0): string => (BigInt(ms) * 1_000_000n + BigInt(ns)).toString();

// ---- ULIDs minted from a time, sorting by that time and, within a millisecond, by minting order.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastMs = -1;
let lastRandom = 0n;
const idRng = mulberry32(0x14_14);
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
export function ulidAt(ms: number): string {
  let random: bigint;
  if (ms === lastMs) random = lastRandom + 1n;
  else {
    random = 0n;
    for (let i = 0; i < 5; i++) random = (random << 16n) | BigInt(Math.floor(idRng() * 65536));
    random &= (1n << 79n) - 1n; // leave room to count up within the millisecond
  }
  lastMs = ms; lastRandom = random;
  return base32(BigInt(ms), 10) + base32(random, 16);
}

// ---- Connections: what the hub's socket proved.
export const YOU = { actor: 'you', scope: 'you' } as const;
export const hook = (session: string, extra: Partial<Connection> = {}): Connection => ({ writer: 'hook', ...YOU, session, agent: 'claude-code', ...extra });
export const app = (session?: string): Connection => (session === undefined ? { writer: 'app', ...YOU } : { writer: 'app', ...YOU, session });
export const core = (session?: string): Connection => (session === undefined ? { writer: 'core', ...YOU } : { writer: 'core', ...YOU, session });
export const ext = (id: string): Connection => ({ writer: `ext:${id}`, ...YOU });

// ---- Event builders. Each takes the kind's first (or named) fixture, strips what the connection supplies,
// and mints a fresh ID at `at` (ms), with ts = at.
export function kindSchema(kind: string): string {
  const entry = catalogue().find((e) => e.kind === kind);
  expect(entry, `event kind ${kind} is in the catalogue`).toBeDefined();
  return entry!.schema;
}
/** The fixture's writer, which its kind's schema allows. */
export function fixtureWriter(kind: string, index = 0): string {
  const f = fixtures(kindSchema(kind))[index];
  expect(isObject(f), `${kind} has fixture ${index}`).toBe(true);
  return String((f as JsonObject).writer);
}
export interface Over { id?: string; ts?: number; seq?: string; subject?: string; data?: JsonObject; evidence?: string[] }
export function fromFixture(kind: string, at: number, over: Over = {}, index = 0): EventInput {
  const f = clone(fixtures(kindSchema(kind))[index]);
  expect(isObject(f), `${kind} has fixture ${index}`).toBe(true);
  const fx = f as JsonObject;
  const input: EventInput = {
    v: fx.v as number,
    id: over.id ?? ulidAt(at),
    kind,
    ts: over.ts ?? at,
    data: over.data ? { ...(fx.data as JsonObject), ...over.data } : (fx.data as JsonObject),
  };
  const subject = over.subject ?? (typeof fx.subject === 'string' ? fx.subject : undefined);
  if (subject !== undefined) input.subject = subject;
  if (over.seq !== undefined) input.seq = over.seq;
  else if (typeof fx.seq === 'string') input.seq = seqAt(at);
  if (over.evidence) input.evidence = over.evidence;
  return input;
}
export const handle = (scheme: string, id: string): string => `${scheme}:${id}`;

export const sessionStart = (at: number, thread: string, agent = 'claude-code'): EventInput =>
  fromFixture('session.start', at, { data: { agent, worktree: '~/src/app', branch: 'main', thread } });
export const sessionAttention = (at: number, session: string, state: 'finished' | 'failed' | 'waiting_permission' | 'unknown'): EventInput =>
  fromFixture('session.attention', at, { subject: handle('session', session), data: { state } });
export const userAsk = (at: number, msg: number, text: string, seq = seqAt(at)): EventInput =>
  fromFixture('user.ask', at, { seq, data: { msg, text, tasks: [], from: 'person' } });
export type ToolKind = 'shell' | 'read' | 'edit' | 'write' | 'search' | 'fetch' | 'unknown';
const TOOL_INDEX: Record<ToolKind, number> = { shell: 0, read: 1, edit: 2, write: 3, search: 4, fetch: 5, unknown: 7 };
export const toolBefore = (at: number, kind: ToolKind, paths: string[], command: string | null, seq = seqAt(at)): EventInput =>
  fromFixture('tool.before', at, { seq, data: { kind, paths, command } }, TOOL_INDEX[kind]);
export const toolAfter = (at: number, kind: ToolKind, paths: string[], command: string | null, seq = seqAt(at)): EventInput =>
  fromFixture('tool.after', at, { seq, data: { kind, paths, command } }, TOOL_INDEX[kind]);
export const agentStop = (at: number, session: string, turn: number, seq = seqAt(at), didWork = true): EventInput =>
  fromFixture('agent.stop', at, { seq, subject: handle('session', session), data: { turn, did_work: didWork } });
export const claimMade = (at: number, taskRef: string, attempt: number, scope: 'session' | 'child' | 'task' = 'session'): EventInput =>
  fromFixture('claim.made', at, { data: { task_ref: taskRef, attempt, commit: COMMIT, scope } });
export function verdictMade(at: number, claimId: string, outcome: 'PASS' | 'FAIL' | 'INVALID' | 'BLOCKED' | 'INCONCLUSIVE', reasons: string[]): EventInput {
  const index = { FAIL: 0, PASS: 1, INVALID: 2, BLOCKED: 3, INCONCLUSIVE: 4 }[outcome];
  const id = ulidAt(at);
  return fromFixture('verdict.made', at, { id, data: { outcome, verdict: handle('verdict', id), claim: handle('claim', claimId), reasons, commit: COMMIT } }, index);
}
export const askCreated = (at: number, deadline: number, question = 'Merge PR 42 into main?'): EventInput =>
  fromFixture('ask.created', at, { data: { question, deadline } });
export const askAnswered = (at: number, askId: string): EventInput =>
  fromFixture('ask.answered', at, { subject: handle('ask', askId) });
export const askDefaulted = (at: number, askId: string): EventInput =>
  fromFixture('ask.defaulted', at, { subject: handle('ask', askId) });
const leaseData = (key: string, holder: string, expires: number, mode: 'exclusive' | 'shared'): JsonObject =>
  ({ resource: { host: 'local', kind: 'port', key }, holder: handle('session', holder), mode, expires });
export const leaseAcquired = (at: number, key: string, holder: string, expires: number, mode: 'exclusive' | 'shared' = 'exclusive'): EventInput =>
  fromFixture('lease.acquired', at, { data: leaseData(key, holder, expires, mode) });
export const leaseStale = (at: number, key: string, holder: string, expires: number, mode: 'exclusive' | 'shared' = 'exclusive'): EventInput =>
  fromFixture('lease.stale', at, { data: leaseData(key, holder, expires, mode) });
export const leaseReleased = (at: number, key: string, holder: string, expires: number, mode: 'exclusive' | 'shared' = 'exclusive'): EventInput =>
  fromFixture('lease.released', at, { data: leaseData(key, holder, expires, mode) });
export const taskCreated = (at: number, taskRef: string, thread: string, title = 'A task'): EventInput =>
  fromFixture('task.created', at, { data: { task_ref: taskRef, thread, owner: 'you', title } });
export const definitionLocked = (at: number, taskRef: string, hash: string): EventInput =>
  fromFixture('definition.locked', at, { data: { task_ref: taskRef, hash, definition: hash, base_commit: COMMIT } });
export const runStarted = (at: number, claimId: string, check = 'app.unit'): EventInput =>
  fromFixture('run.started', at, { data: { run: handle('run', ulidAt(at)), check, claim: handle('claim', claimId), commit: COMMIT } });
export const decisionCreated = (at: number, askId: string, key = sha256(`decision ${at}`)): EventInput =>
  fromFixture('decision.created', at, { data: { key, ask: handle('ask', askId) } });
/** The two kinds the issue adds for the evidence store (README: Events the record must accept). */
export const evidenceStored = (at: number, ev: Evidence): EventInput => ({
  v: 1, id: ulidAt(at), kind: 'evidence.stored', ts: at,
  data: { sha256: ev.sha256, kind: ev.kind, type: ev.type, size: ev.size, origin: ev.origin, redaction: ev.redaction, license: ev.license.name, derived_from: [...ev.derivedFrom], step_times: [] },
});
export const evidenceRemoved = (at: number, hash: string): EventInput => ({ v: 1, id: ulidAt(at), kind: 'evidence.removed', ts: at, data: { sha256: hash } });

// ---- Reads.
export async function allEvents(record: RecordStore): Promise<Event[]> {
  const out: Event[] = [];
  let after = 0;
  for (;;) {
    const page = await record.read({ after, limit: 1000 });
    if (!page.length) return out;
    out.push(...page);
    after = page[page.length - 1]!.log_pos;
  }
}
export const countEvents = async (record: RecordStore): Promise<number> => (await allEvents(record)).length;
export const rowsWhere = (table: Table, test: (row: Row) => boolean): Row[] => table.rows.filter(test);
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
/** The claims row for a claim.made event's ID. */
export async function claimRow(record: RecordStore, claimId: string): Promise<Row> {
  const rows = rowsWhere(await record.table('claims'), (r) => str(r.id) === claimId || str(r.id) === handle('claim', claimId));
  expect(rows, `claims has a row for ${claimId}`).toHaveLength(1);
  return rows[0]!;
}
/** The claim's newest verdict row, or undefined while it is open. */
export async function verdictFor(record: RecordStore, claimId: string): Promise<Row | undefined> {
  const claim = await claimRow(record, claimId);
  if (claim.verdict_id === null || claim.verdict_id === undefined) return undefined;
  const rows = rowsWhere(await record.table('verdicts'), (r) => str(r.id) === str(claim.verdict_id) || handle('verdict', str(r.id)) === str(claim.verdict_id) || str(r.id) === handle('verdict', str(claim.verdict_id)));
  expect(rows, `verdicts has the row ${str(claim.verdict_id)} that claim ${claimId} names`).toHaveLength(1);
  return rows[0]!;
}
export const reasonsText = (verdict: Row): string => (typeof verdict.reasons === 'string' ? verdict.reasons : JSON.stringify(verdict.reasons ?? ''));
/** Asserts a claim reads INVALID with cause "events lost" (never open, never PASS). */
export async function expectEventsLost(record: RecordStore, claimId: string, who: string): Promise<void> {
  const verdict = await verdictFor(record, claimId);
  expect(verdict, `${who}: claim ${claimId} must not stay open`).toBeDefined();
  expect(verdict!.outcome, `${who}: claim ${claimId} reads INVALID, never PASS`).toBe('INVALID');
  expect(reasonsText(verdict!), `${who}: the cause is events lost`).toContain('events lost');
}
export async function expectOpen(record: RecordStore, claimId: string, who: string): Promise<void> {
  const claim = await claimRow(record, claimId);
  expect(claim.verdict_id ?? null, `${who}: claim ${claimId} stays open`).toBeNull();
}

// ---- Refusals.
export async function expectRefused(work: Promise<unknown>, code: RecordError['code'], named: { path?: string; kind?: string; id?: string }, why: string): Promise<RecordError> {
  let caught: unknown;
  try { await work; } catch (e) { caught = e; }
  expect(caught, `${why}: should be refused`).toBeInstanceOf(RecordError);
  const err = caught as RecordError;
  expect(err.code, `${why}: refusal code`).toBe(code);
  if (named.path !== undefined) expect(err.path, `${why}: names the field`).toBe(named.path);
  if (named.kind !== undefined) expect(err.kind, `${why}: names the kind`).toBe(named.kind);
  if (named.id !== undefined) expect(err.id, `${why}: names the ID`).toBe(named.id);
  return err;
}

// ---- Table snapshots, compared row by row in primary-key order, values as stored.
export function canon(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`;
  if (value === undefined) return 'undefined';
  if (value instanceof Uint8Array) return `bytes:${Buffer.from(value).toString('hex')}`;
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (isObject(value as JsonValue)) return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${canon((value as Row)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const keyOf = (table: Table, row: Row): string => table.primaryKey.map((k) => canon(row[k])).join('|');
export async function snapshot(record: RecordStore, names: readonly string[]): Promise<Map<string, Table>> {
  const out = new Map<string, Table>();
  for (const name of names) out.set(name, await record.table(name));
  return out;
}
/** The first difference between two snapshots, naming the table and the row, or undefined when equal. */
export function firstTableDifference(live: Map<string, Table>, rebuilt: Map<string, Table>): string | undefined {
  for (const [name, a] of live) {
    const b = rebuilt.get(name);
    if (!b) return `${name}: missing after the rebuild`;
    if (canon(a.primaryKey) !== canon(b.primaryKey)) return `${name}: primary key ${canon(a.primaryKey)} became ${canon(b.primaryKey)}`;
    const n = Math.max(a.rows.length, b.rows.length);
    for (let i = 0; i < n; i++) {
      const x = a.rows[i], y = b.rows[i];
      if (!x || !y) return `${name}: row ${i} (${x ? keyOf(a, x) : keyOf(b, y!)}) ${x ? 'missing after the rebuild' : 'only after the rebuild'}`;
      if (canon(x) !== canon(y)) {
        const col = [...new Set([...Object.keys(x), ...Object.keys(y)])].find((c) => canon(x[c]) !== canon(y[c]));
        return `${name}: row ${keyOf(a, x)} column ${col}: live ${canon(x[col!])}, rebuilt ${canon(y[col!])}`;
      }
    }
  }
  return undefined;
}
/** A tolerant lookup: a table's rows whose named column equals the value, as a string. */
export const rowsBy = (table: Table, column: string, value: unknown): Row[] => rowsWhere(table, (r) => str(r[column]) === str(value));

// ---- Temp roots.
const roots: string[] = [];
export function tempRoot(prefix = 'deep-record-14-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}
export function removeRoots(): void {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
}
export function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}
export const filesContaining = (root: string, needle: string): string[] => walk(root).filter((p) => readFileSync(p).includes(Buffer.from(needle)));
export const bytesUnder = (root: string): number => walk(root).reduce((n, p) => n + statSync(p).size, 0);

// ---- The reference-Mac gate and the design's judge for timing results (as tests/acceptance/311 and 15).
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    therm = read('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number, over = true): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(2)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  const within = (r: number) => (over ? r <= limit : r >= limit);
  const far = (r: number) => (over ? r > limit * (1 + margin) : r < limit * (1 - margin));
  if (runs.every(within)) return;
  expect(runs.every(far), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
