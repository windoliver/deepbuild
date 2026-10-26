// Shared test-side tools for the issue #723 acceptance tests: a test clock, ULIDs minted from it, connections,
// sessions with archived transcripts in the real evidence store, learned changes and guard rules as events, and
// reads of the learned layer and of what a session loads. None of them stands in for the record, the layer or
// the classifier (README: The surface under test).

import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { fixtures } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { Evidence, EvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection, Event, EventInput, RecordStore, Row, SliceEntry, Table } from '../../../packages/record/src/index.ts';

export const SECOND = 1000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** Monday 2026-10-05 09:00 UTC, day 1: every test starts its clock here. */
export const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);

export type JsonObject = { [key: string]: JsonValue };
export const utf8 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'utf8'));

// ---- The surface #723 adds to the record (README: The surface under test).
/** A learned step spec, playbook or composition a session does not load, and why: the reason names the guard rule. */
export interface HeldAtLoad { target: string; reason: string }
/** What a session loads of the learned layer's step specs, playbooks and compositions, checked against the guard rules in force. */
export interface LearnedLoad { loaded: SliceEntry[]; held: HeldAtLoad[] }
export interface LoadingRecord extends RecordStore {
  loadLearned(session: string): Promise<LearnedLoad>;
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
let seed = 0x0723;
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
/** You, in the app: what you apply, the guard rules you add, the archive of a transcript. */
export const youApp: Connection = { writer: 'app', ...YOU };
/** The core: what a rule applies, and the core-only kinds (verdicts). */
export const core: Connection = { writer: 'core', ...YOU };
export const hookIn = (session: string, repo: string): Connection => ({ writer: 'hook', ...YOU, session, project: repo, agent: 'claude-code' });

/** The local-first rule, which applies a change to the session it came from (#62). */
export const LOCAL_FIRST = 'rule:localfirst';
export type By = 'you' | `rule:${string}`;
/** The replay every planted change carries: 20 tasks, no regressions. */
export const CLEAN_REPLAY = { tasks: 20, regressions: 0 } as const;

// ---- A world: a record over a real evidence store, in a temp folder.
export interface World { root: string; clock: Clock; store: EvidenceStore; record: LoadingRecord }
const roots: string[] = [];
export function removeRoots(): void {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
}
export async function openWorld(start = T0): Promise<World> {
  const root = mkdtempSync(join(tmpdir(), 'deep-learn-723-'));
  roots.push(root);
  const clock = makeClock(start);
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: clock.now });
  const record = (await openRecord({ path: join(root, 'record', 'record.sqlite'), now: clock.now, evidence: store })) as LoadingRecord;
  return { root, clock, store, record };
}

// ---- Sessions and their archived transcripts (Claude Code's JSONL: one entry per line, `uuid` names the message).
/** A message you typed in a session: first-hand evidence. */
export interface Msg { id: string; text: string }
function transcript(session: string, messages: readonly Msg[]): string {
  return messages.map((m) => JSON.stringify({ type: 'user', uuid: m.id, sessionId: session, message: { role: 'user', content: m.text } })).join('\n') + '\n';
}
async function putText(w: World, text: string): Promise<string> {
  const put = await w.store.connect({ role: 'deepbuild', via: 'capture' })
    .put({ bytes: utf8(text), kind: 'transcript', source: 'claude-code', redaction: 'complete', license: { name: 'own', allows: [] } });
  expect(put.status, 'the evidence store stores the transcript').toBe('stored');
  return (put as { evidence: Evidence }).evidence.sha256;
}
/** Starts a session in a repo (its project), archives its transcript and links it. Returns its ID. */
export async function startSession(w: World, repo: string, messages: readonly Msg[]): Promise<string> {
  const at = w.clock.tick(SECOND);
  const id = ulidAt(at);
  await w.record.append(hookIn(id, repo), { v: 1, id: ulidAt(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: `~/src/${repo}`, branch: 'main', thread: id } });
  const hash = await putText(w, transcript(id, messages));
  const t = w.clock.tick(1);
  await w.record.append(youApp, { v: 1, id: ulidAt(t), kind: 'transcript.archived', ts: t, data: { session: `session:${id}`, evidence: hash } });
  return id;
}
/** The handle of one message of a session. */
export const said = (session: string, message: string): string => `session:${session}#${message}`;

// ---- Learned changes: the frozen shape {layer, target, diff, evidence, scope, replay, applied_by, supersedes}.
export interface Quote { at: string; quote: string }
export interface Change {
  layer?: 'learned' | 'base';
  target: string;
  /** Lines: `+ <line>` adds it, `- <line>` removes it; on a step, playbook, composition, extension or guard, each line is `<field>: <value>`. */
  diff: string;
  evidence: Quote[];
  scope: string;
  replay?: { tasks: number; regressions: number } | null;
}
/** The diff of the given lines, one per line. */
export const lines = (...l: string[]): string => l.join('\n');
function learnEvent(at: number, change: Change, appliedBy: By): EventInput {
  return {
    v: 1, id: ulidAt(at), kind: 'learn.applied', ts: at,
    data: {
      layer: change.layer ?? 'learned', target: change.target, diff: change.diff,
      evidence: change.evidence.map((q) => ({ at: q.at, quote: q.quote })),
      scope: change.scope, replay: change.replay ?? null, applied_by: appliedBy, supersedes: null,
    },
  };
}
/**
 * Appends a learn.applied: from the app when you apply it, from the core when a rule does. The append resolves
 * whether the core applies, holds or refuses it: the attempt is recorded, and its learned_layer row says which (#62).
 */
export async function apply(w: World, change: Change, by: By = LOCAL_FIRST): Promise<string> {
  const at = w.clock.tick(SECOND);
  const event = learnEvent(at, change, by);
  await w.record.append(by === 'you' ? youApp : core, event);
  return event.id;
}

// ---- Guard rules you add: a base change to `guard:<name>`, its lines the guard@1 entry's fields (README: Readings).
export interface Guard { match: string; scope: string; mode: 'watch' | 'warn' | 'block'; reason: string; next_step: string; fail_closed: boolean }
/** Adds a guard rule of yours, in force from its place in the log; returns its event ID. */
export async function addGuard(w: World, name: string, guard: Guard, evidence: Quote[]): Promise<string> {
  const diff = lines(...(Object.keys(guard) as (keyof Guard)[]).map((k) => `+ ${k}: ${String(guard[k])}`));
  const id = await apply(w, { layer: 'base', target: `guard:${name}`, diff, evidence, scope: 'all' }, 'you');
  await expectState(w, id, 'applied', `your guard rule guard:${name}, a base change you apply`);
  return id;
}

/** A core verdict whose one requirement names `check`, from the published verdict.made fixture of that outcome. */
export async function verdict(w: World, outcome: 'FAIL' | 'PASS', check: string): Promise<string> {
  const index = { FAIL: 0, PASS: 1 }[outcome];
  const fx = structuredClone(fixtures('verdict.made@1')[index]) as JsonObject;
  const data = fx.data as JsonObject;
  expect(data.outcome, `verdict.made fixture ${index} is ${outcome}`).toBe(outcome);
  const at = w.clock.tick(SECOND);
  const id = ulidAt(at);
  const requirements = (data.requirements as JsonObject[]).map((r) => ({ ...r, check }));
  await w.record.append(core, { v: 1, id, kind: 'verdict.made', ts: at, data: { ...data, verdict: `verdict:${id}`, claim: `claim:${ulidAt(at)}`, requirements } });
  return id;
}

/** A field name no classifier can list ahead of time: fresh random hex on every run (README: Readings, AC5). */
export const unknownField = (): string => `f${randomBytes(6).toString('hex')}`;

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
/**
 * Held for you, its reason quoting the clause that loosens: one of `clauses` (a diff line without its sign), whole.
 * Returns the reason.
 */
export async function expectHeld(w: World, id: string, clauses: string[], why: string): Promise<string> {
  const row = await expectState(w, id, 'held', why);
  const reason = str(row.reason);
  expect(clauses.some((c) => reason.includes(c)), `${why}: the hold's reason "${reason}" quotes the clause ${clauses.map((c) => `"${c}"`).join(' or ')}`).toBe(true);
  return reason;
}
/** What a session loads now of the learned step specs, playbooks and compositions. */
export async function load(w: World, session: string): Promise<LearnedLoad> {
  expect(typeof w.record.loadLearned, 'the record has loadLearned(session), the surface README defines').toBe('function');
  const got = await w.record.loadLearned(session);
  expect(Array.isArray(got?.loaded) && Array.isArray(got?.held), `loadLearned(${session}) returns {loaded, held}`).toBe(true);
  return got;
}
export const loadedTargets = (l: LearnedLoad): string[] => l.loaded.map((e) => e.target);
export const heldTargets = (l: LearnedLoad): string[] => l.held.map((e) => e.target);
/** The loaded text of one target, or undefined when the session doesn't load it. */
export const loadedText = (l: LearnedLoad, target: string): string | undefined => l.loaded.find((e) => e.target === target)?.text;

// ---- Table comparison, values as stored (as tests/acceptance/62).
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
