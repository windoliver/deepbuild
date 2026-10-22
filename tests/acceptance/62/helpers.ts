// Shared test-side tools for the issue #62 acceptance tests: a test clock, ULIDs minted from it, connections,
// sessions with archived transcripts in the real evidence store, learned-change events, and reads of the
// learned layer. None of them stands in for the record or the layer (README: The surface under test).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type TestContext } from 'vitest';
import { fixtures } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { Evidence, EvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection, Event, EventInput, RecordStore, Row, Table } from '../../../packages/record/src/index.ts';

export const SECOND = 1000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** Monday 2026-10-05 09:00 UTC: every test starts its clock here. */
export const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);

export type JsonObject = { [key: string]: JsonValue };
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const utf8 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'utf8'));

// ---- The surface #62 adds to the record (README: The surface under test).
/** One entry of what an agent reads at session start. The tests read only its text and compare whole slices. */
export interface SliceEntry { target: string; text: string }
export type RollBackRequest = { change: string } | { since: number };
export interface LearnedRecord extends RecordStore {
  /** What the session reads at its start, and, for the rules you typed, at its next prompt. */
  startSlice(session: string): Promise<SliceEntry[]>;
  /** Appends one learn.rolled_back per compensated change; returns the compensated changes' event IDs, in compensation order. */
  rollBack(connection: Connection, what: RollBackRequest): Promise<string[]>;
}

// ---- The test clock: the record and the evidence store read time only through now().
export interface Clock { now(): number; tick(ms: number): number; set(ms: number): void }
export function makeClock(start = T0): Clock {
  let t = start;
  return { now: () => t, tick: (ms) => (t += ms), set: (ms) => { t = ms; } };
}

// ---- ULIDs minted from a time, sorting by that time and, within a millisecond, by minting order.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastMs = -1;
let lastRandom = 0n;
let seed = 0x62_62;
function rand16(): number {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * 65536) | 0;
}
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
    for (let i = 0; i < 5; i++) random = (random << 16n) | BigInt(rand16());
    random &= (1n << 79n) - 1n;
  }
  lastMs = ms; lastRandom = random;
  return base32(BigInt(ms), 10) + base32(random, 16);
}

// ---- Connections: what the hub's socket proved.
const YOU = { actor: 'you', scope: 'you' } as const;
/** You, in the app: your OK, your rollbacks, the archive of a transcript. */
export const youApp: Connection = { writer: 'app', ...YOU };
/** The core: what a rule applies, and the core-only kinds (decisions, verdicts). */
export const core: Connection = { writer: 'core', ...YOU };
export const hookIn = (session: string, repo: string): Connection => ({ writer: 'hook', ...YOU, session, project: repo, agent: 'claude-code' });
/** An agent through MCP (deep_propose). */
export const agentIn = (session: string, repo: string): Connection => ({ writer: `mcp:${session}`, ...YOU, session, project: repo, agent: 'claude-code' });

/** The local-first rule, which applies a change to the session it came from (README: Readings). */
export const LOCAL_FIRST = 'rule:localfirst';
/** The rule that applies the claims learned at install, at the scope their evidence covers (README: Readings). */
export const INSTALL = 'rule:install';
export type By = 'you' | `rule:${string}`;

// ---- A world: a record over a real evidence store, in a temp folder.
export interface World { root: string; clock: Clock; store: EvidenceStore; record: LearnedRecord }
const roots: string[] = [];
export function tempRoot(prefix = 'deep-learn-62-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}
export function removeRoots(): void {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
}
export async function openWorld(start = T0): Promise<World> {
  const root = tempRoot();
  const clock = makeClock(start);
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: clock.now });
  const record = (await openRecord({ path: join(root, 'record', 'record.sqlite'), now: clock.now, evidence: store })) as LearnedRecord;
  return { root, clock, store, record };
}

// ---- Sessions and their archived transcripts (Claude Code's JSONL: one entry per line, `uuid` names the message).
/** A message: from you, from the agent, or the result of a fetch the agent made (outside content). */
export interface Msg { id: string; from: 'you' | 'agent' | 'fetch'; text: string }
export function transcript(session: string, messages: readonly Msg[]): string {
  const lines: JsonObject[] = [];
  for (const m of messages) {
    if (m.from === 'you') lines.push({ type: 'user', uuid: m.id, sessionId: session, message: { role: 'user', content: m.text } });
    else if (m.from === 'agent') lines.push({ type: 'assistant', uuid: m.id, sessionId: session, message: { role: 'assistant', content: [{ type: 'text', text: m.text }] } });
    else {
      const call = `toolu${m.id}`;
      lines.push({ type: 'assistant', uuid: `${m.id}call`, sessionId: session, message: { role: 'assistant', content: [{ type: 'tool_use', id: call, name: 'WebFetch', input: { url: 'https://docs.example.com/cards', prompt: 'test cards' } }] } });
      lines.push({ type: 'user', uuid: m.id, sessionId: session, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, content: m.text }] } });
    }
  }
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}
/** Puts text into the real evidence store, as DeepBuild's capture; returns its hash. */
export async function putText(w: World, text: string, kind = 'transcript'): Promise<string> {
  const put = await w.store.connect({ role: 'deepbuild', via: 'capture' })
    .put({ bytes: utf8(text), kind, source: 'claude-code', redaction: 'complete', license: { name: 'own', allows: [] } });
  expect(put.status, 'the evidence store stores the text').toBe('stored');
  return (put as { evidence: Evidence }).evidence.sha256;
}
/** Starts a session in a repo (its project) and, unless told not to, archives its transcript and links it. Returns its ID. */
export async function startSession(w: World, repo: string, messages: readonly Msg[], archive = true): Promise<string> {
  const at = w.clock.tick(SECOND);
  const id = ulidAt(at);
  await w.record.append(hookIn(id, repo), { v: 1, id: ulidAt(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: `~/src/${repo}`, branch: 'main', thread: id } });
  if (archive) {
    const hash = await putText(w, transcript(id, messages));
    const t = w.clock.tick(1);
    await w.record.append(youApp, { v: 1, id: ulidAt(t), kind: 'transcript.archived', ts: t, data: { session: `session:${id}`, evidence: hash } });
  }
  return id;
}
/** The handle of one message of a session. */
export const said = (session: string, message: string): string => `session:${session}#${message}`;

// ---- Learned changes: the frozen shape {layer, target, diff, evidence, scope, replay, applied_by, supersedes}.
export interface Quote { at: string; quote: string }
export interface Change {
  layer?: 'learned' | 'base';
  target: string;
  diff: string;
  evidence: Quote[];
  scope: string;
  replay?: { tasks: number; regressions: number } | null;
  supersedes?: string | null;
}
export type LearnKind = 'learn.proposed' | 'learn.applied' | 'learn.widened';
export function learnEvent(kind: LearnKind, at: number, change: Change, appliedBy: By | null): EventInput {
  return {
    v: 1, id: ulidAt(at), kind, ts: at,
    data: {
      layer: change.layer ?? 'learned', target: change.target, diff: change.diff,
      evidence: change.evidence.map((q) => ({ at: q.at, quote: q.quote })),
      scope: change.scope, replay: change.replay ?? null, applied_by: appliedBy, supersedes: change.supersedes ?? null,
    },
  };
}
/**
 * Appends a learn.applied (or learn.widened): from the app when you apply it, from the core when a rule does.
 * The append resolves whether the core applies, holds or refuses it: the attempt is recorded (README: Readings).
 */
export async function apply(w: World, change: Change, by: By = LOCAL_FIRST, kind: LearnKind = 'learn.applied'): Promise<string> {
  const at = w.clock.tick(SECOND);
  const event = learnEvent(kind, at, change, by);
  await w.record.append(by === 'you' ? youApp : core, event);
  return event.id;
}
export const widen = (w: World, change: Change, by: By): Promise<string> => apply(w, change, by, 'learn.widened');
/** An agent proposes a change with deep_propose: learn.proposed from its MCP connection, applied by no one. */
export async function propose(w: World, session: string, repo: string, change: Change): Promise<string> {
  const at = w.clock.tick(SECOND);
  const event = learnEvent('learn.proposed', at, change, null);
  await w.record.append(agentIn(session, repo), event);
  return event.id;
}

// ---- Other base events.
/** A decision of yours (decision.created, core only); returns its ID, which `decision:<id>` names. */
export async function decide(w: World, answer: string, scope = 'all'): Promise<string> {
  const at = w.clock.tick(SECOND);
  const id = ulidAt(at);
  await w.record.append(core, { v: 1, id, kind: 'decision.created', ts: at, data: { key: sha256(`decision ${id}`), scope, answer, ask: `ask:${ulidAt(at)}` } });
  return id;
}
/** A core verdict whose one requirement names `check`, from the published verdict.made fixture of that outcome. */
export async function verdict(w: World, outcome: 'FAIL' | 'PASS' | 'INVALID', check: string): Promise<string> {
  const index = { FAIL: 0, PASS: 1, INVALID: 2 }[outcome];
  const fx = structuredClone(fixtures('verdict.made@1')[index]) as JsonObject;
  const data = fx.data as JsonObject;
  expect(data.outcome, `verdict.made fixture ${index} is ${outcome}`).toBe(outcome);
  const at = w.clock.tick(SECOND);
  const id = ulidAt(at);
  const requirements = (data.requirements as JsonObject[]).map((r) => ({ ...r, check }));
  await w.record.append(core, { v: 1, id, kind: 'verdict.made', ts: at, data: { ...data, verdict: `verdict:${id}`, claim: `claim:${ulidAt(at)}`, requirements } });
  return id;
}

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
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
/** The learned_layer row of one learn.* event, by its ID. */
export async function layerRow(w: World, id: string): Promise<Row> {
  const table = await w.record.table('learned_layer');
  const rows = table.rows.filter((r) => str(r.id) === id);
  expect(rows, `learned_layer has one row for event ${id}`).toHaveLength(1);
  return rows[0]!;
}
export async function expectState(w: World, id: string, state: string, why: string): Promise<Row> {
  const row = await layerRow(w, id);
  expect(row.state, `${why}: state of ${id} (reason: ${str(row.reason)})`).toBe(state);
  return row;
}
/** Refused, with a reason that names `naming` (a target or a handle). */
export async function expectRefused(w: World, id: string, naming: string | string[], why: string): Promise<Row> {
  const row = await expectState(w, id, 'refused', why);
  const names = Array.isArray(naming) ? naming : [naming];
  const reason = str(row.reason);
  expect(names.some((n) => reason.includes(n)), `${why}: the refusal "${reason}" names ${names.join(' or ')}`).toBe(true);
  return row;
}
/** The record handle naming a learned change, which later changes cite in `supersedes` or `evidence[].at`. */
export async function handleOf(w: World, id: string): Promise<string> {
  const h = str((await layerRow(w, id)).handle);
  expect(h, `learned_layer row ${id} has a handle that fits the frozen record-handle pattern`).toMatch(/^(task|ask|claim|verdict|run|req|decision|plan|lease|reading|notice|doc|ev|session):[0-9A-Za-z]+(#[A-Za-z0-9][A-Za-z0-9._-]*)?$/);
  return h;
}
export async function sliceText(w: World, session: string): Promise<string> {
  const slice = await w.record.startSlice(session);
  expect(Array.isArray(slice), `startSlice(${session}) returns a list`).toBe(true);
  return JSON.stringify(slice);
}

// ---- Table comparison, values as stored (as tests/acceptance/14).
export function canon(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`;
  if (value === undefined) return 'undefined';
  if (value instanceof Uint8Array) return `bytes:${Buffer.from(value).toString('hex')}`;
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (typeof value === 'object' && value !== null) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canon((value as Row)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function firstRowDifference(a: Table, b: Table): string | undefined {
  if (canon(a.primaryKey) !== canon(b.primaryKey)) return `primary key ${canon(a.primaryKey)} became ${canon(b.primaryKey)}`;
  const n = Math.max(a.rows.length, b.rows.length);
  for (let i = 0; i < n; i++) {
    const x = a.rows[i], y = b.rows[i];
    if (!x || !y) return `row ${i} (${str((x ?? y)!.id)}) ${x ? 'missing after the rebuild' : 'only after the rebuild'}`;
    if (canon(x) !== canon(y)) {
      const col = [...new Set([...Object.keys(x), ...Object.keys(y)])].find((c) => canon(x[c]) !== canon(y[c]));
      return `row ${str(x.id)} column ${col}: live ${canon(x[col!])}, rebuilt ${canon(y[col!])}`;
    }
  }
  return undefined;
}

// ---- The reference-Mac gate and the design's judge for timing results (as tests/acceptance/14, 15 and 311).
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = sh('pmset', '-g', 'batt');
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
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
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(2)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
export const p95 = (samples: number[]): number => {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]!;
};
