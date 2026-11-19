// Test-side tools for the #2653 acceptance tests: a real record on SQLite and a home holding your settings in a
// temporary folder, an asks core opened on them with a virtual clock (this checkout's, the merge base's, or a planted
// twin), the events the hook and the runner record, one session's stops landing a tick at a time as the hub ticks the
// core when a stop lands, each step's asks, tasks and outcomes read back, and the count of the stops a core holds,
// read from a heap snapshot. Nothing here stands in for the asks core; the planted wrong program is in plants.ts.

import { execFileSync, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeHeapSnapshot } from 'node:v8';
import ts from 'typescript';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection, Event, EventInput, RecordStore } from '../../../packages/record/src/index.ts';
import { openAsks } from '../../../packages/asks/src/index.ts';
import type { Asks, Delivery, InboxRow } from '../../../packages/asks/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';

export const REPO = resolve(import.meta.dirname, '../../..');
export const SECOND = 1_000;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
/** 2026-11-17 00:00 UTC. */
export const T0 = Date.UTC(2026, 10, 17, 0, 0, 0);
/** You: the person behind every connection here. */
export const YOU = 'you';
/** The commit these tests were written against: the planted twin is made from its asks core (plants.ts). */
export const BASE_COMMIT = '3cf41958f224c3b461255b09d747516bb24570eb';

export type Obj = { [key: string]: JsonValue };
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export const iso = (ms: number): string => new Date(ms).toISOString();

// ---- IDs. Every event the tests append has a ULID minted from its time; a stop's carries a mark (README: the count).
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const b32 = (n: number, length: number): string => {
  let s = '';
  for (let i = 0, v = n; i < length; i++, v = Math.floor(v / 32)) s = CROCKFORD[v % 32] + s;
  return s;
};
/** What marks a stop's ID: its ten letters of time, then STPZ and its session's two letters, then its number. */
const STOP_MARK = 'STPZ';
let minted = 0;
const otherId = (ms: number): string => `${b32(ms, 10)}EVTZ${b32(++minted, 12)}`;
/** deep-hook's stamp for a hook that started at `ms`: wall-clock ns, unique in minting order. */
const seqAt = (ms: number): string => String(BigInt(ms) * 1_000_000n + BigInt(++minted % 1_000_000));

/** A session the tests drive: its ID, and the two letters its stops' IDs carry. */
export interface Session { id: string; tag: string; thread: string }
export const session = (id: string, n: number): Session => ({ id, tag: b32(n, 2), thread: `T-${id}` });
/** The ID of a session's nth stop, stamped `ms`. The tests keep numbers, never these strings, so a count reads only what the core keeps. */
export const stopId = (s: Session, n: number, ms: number): string => `${b32(ms, 10)}${STOP_MARK}${s.tag}${b32(n, 10)}`;
const stopPattern = (s: Session): RegExp => new RegExp(`^[${CROCKFORD}]{10}${STOP_MARK}${s.tag}[${CROCKFORD}]{10}$`);

/** Your own settings as ~/.deepbuild/config.json holds them (#319's shape), with no batch: every ask shows when raised (#85's). */
export const SETTINGS: Obj = {
  asks: {
    deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
    default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
    fallback: ['change-owner'],
    fold: 5,
  },
};

// ---- The asks cores: this checkout's, and packages/asks as it is at another commit.
export type OpenAsks = typeof openAsks;
export interface Core { label: string; openAsks: OpenAsks }
export const HERE: Core = { label: "this checkout's core", openAsks };

const git = (...args: string[]): string => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
/**
 * The commit the change is measured against (README: the merge base): `git merge-base HEAD origin/main` (or main).
 * Once this folder is on that commit, the change has landed: it is then the first parent of the commit that brought
 * this folder there (`landed`), so a later run still compares the change with the program it replaced.
 */
export function changeBase(): { sha: string; landed: string | null } {
  let sha = '';
  for (const ref of ['origin/main', 'main']) {
    const found = spawnSync('git', ['merge-base', 'HEAD', ref], { cwd: REPO, encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) { sha = found.stdout.trim(); break; }
  }
  if (!sha) throw Error('BLOCKED: no merge base with origin/main or main to compare with');
  if (spawnSync('git', ['cat-file', '-e', `${sha}:tests/acceptance/2653/README.md`], { cwd: REPO }).status !== 0) return { sha, landed: null };
  const landed = git('log', '--first-parent', '--diff-filter=A', '--format=%H', sha, '--', 'tests/acceptance/2653/README.md').split('\n').filter(Boolean).at(-1);
  if (!landed) throw Error(`BLOCKED: ${sha} holds tests/acceptance/2653 but no commit on its first-parent history added it`);
  return { sha: git('rev-parse', `${landed}^1`), landed };
}
export const mergeBase = (): string => changeBase().sha;

/**
 * packages/asks as it is at `sha`, built into a folder of its own whose imports reach this checkout's node_modules: its
 * sources compiled one file at a time by this checkout's TypeScript, with the root tsconfig's target and module, beside
 * its sources.json. `patch` edits a source first, for a planted twin. Kept between runs under its name.
 */
export function asksAt(sha: string, name: string, patch?: (file: string, text: string) => string): string {
  const dir = join(tmpdir(), `dh2653-${name}-${sha.slice(0, 12)}`);
  if (existsSync(join(dir, '.built'))) return dir;
  rmSync(dir, { recursive: true, force: true });
  const work = mkdtempSync(join(tmpdir(), `dh2653-${name}-`));
  try {
    execFileSync('/bin/sh', ['-c', `git -C "$0" archive "$1" packages/asks | tar -x -C "$2"`, REPO, sha, work], { stdio: 'pipe' });
  } catch (error) {
    rmSync(work, { recursive: true, force: true });
    throw Error(`BLOCKED: packages/asks can't be read at ${sha}: ${(error as Error).message.split('\n')[0]}`);
  }
  symlinkSync(join(REPO, 'node_modules'), join(work, 'node_modules'));
  const src = join(work, 'packages/asks/src');
  mkdirSync(join(work, 'packages/asks/dist'));
  for (const file of readdirSync(src).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))) {
    const text = readFileSync(join(src, file), 'utf8');
    const js = ts.transpileModule(patch ? patch(file, text) : text, {
      fileName: file, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023, verbatimModuleSyntax: true },
    }).outputText;
    writeFileSync(join(work, 'packages/asks/dist', file.replace(/\.ts$/, '.js')), js);
  }
  writeFileSync(join(work, '.built'), `${sha}\n`);
  try {
    renameSync(work, dir);
  } catch {
    // Another run built it first.
    rmSync(work, { recursive: true, force: true });
  }
  return dir;
}
/** The entry of an asks core built by asksAt. */
export const entryOf = (dir: string): string => pathToFileURL(join(dir, 'packages/asks/dist/index.js')).href;
/** An asks core built by asksAt, loaded. */
export async function coreAt(dir: string, label: string): Promise<Core> {
  const loaded = (await import(entryOf(dir))) as { openAsks?: OpenAsks };
  if (typeof loaded.openAsks !== 'function') throw Error(`BLOCKED: ${label} at ${dir} exports no openAsks`);
  return { label, openAsks: loaded.openAsks };
}
/** The merge base's asks core, run on this checkout's record, contracts and adapters (README: the merge base). */
export async function mergeBaseCore(): Promise<Core> {
  const sha = mergeBase();
  return coreAt(asksAt(sha, 'merge-base'), `the merge base's core (${sha.slice(0, 12)})`);
}

// ---- A world: a record and a home in a temporary folder, and one asks core opened on them.
export interface Clock { now(): number; set(ms: number): void }
export const makeClock = (start = T0): Clock => {
  let t = start;
  return { now: () => t, set: (ms) => { t = ms; } };
};

export interface World {
  core: Core;
  clock: Clock;
  dir: string;
  record: RecordStore;
  asks: Asks;
  deliveries: Delivery[];
  /** The log position the step reads have reached, and each ask's name by its first appearance (stateOf). */
  seen: number;
  names: Map<string, string>;
  append(connection: Connection, event: EventInput): Promise<void>;
  tick(): Promise<void>;
  /** The hub stops (the core goes, the record closes) and starts again on the same record and settings. Returns the core and record that ran. */
  restart(): Promise<{ asks: Asks; record: RecordStore }>;
  events(kind?: string): Promise<Event[]>;
  close(): Promise<void>;
}

export async function openWorld(core: Core, clock: Clock): Promise<World> {
  const dir = mkdtempSync(join(tmpdir(), 'dh2653-world-'));
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'config.json'), `${JSON.stringify(SETTINGS, null, 2)}\n`);
  const deliveries: Delivery[] = [];
  const w = { core, clock, dir, deliveries, seen: 0, names: new Map<string, string>() } as World;
  const open = async (): Promise<void> => {
    w.record = await openRecord({ path: join(dir, 'record.db'), now: clock.now });
    w.asks = await core.openAsks({ record: w.record, now: clock.now, deliver: (d) => { deliveries.push(d); }, home });
  };
  Object.assign(w, {
    append: async (connection: Connection, event: EventInput) => { await w.record.append(connection, event); },
    tick: () => w.asks.tick(),
    restart: async () => {
      const ran = { asks: w.asks, record: w.record };
      await w.record.close();
      await open();
      return ran;
    },
    events: async (kind?: string): Promise<Event[]> => {
      const all: Event[] = [];
      for (let after = 0; ;) {
        const page = await w.record.read({ after, limit: 10_000, ...(kind ? { kinds: [kind] } : {}) });
        all.push(...page);
        if (page.length < 10_000) break;
        after = page[page.length - 1]!.log_pos;
      }
      return all;
    },
    close: async () => {
      await w.record.close().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    },
  });
  await open();
  return w;
}

// ---- What the hook, you and the runner record, as #85's suite appends them.
const hook = (s: Session, agent = 'claude-code'): Connection => ({ writer: 'hook', actor: YOU, scope: YOU, session: s.id, agent });
/** One event the tests append to every world in a step. */
export interface Input { connection: Connection; event: EventInput; what: string }

export const start = (s: Session, at: number, agent = 'claude-code'): Input => ({
  connection: hook(s, agent), what: `${s.id} starts`,
  event: { v: 1, id: otherId(at), kind: 'session.start', ts: at, seq: seqAt(at), data: { agent, worktree: join(tmpdir(), 'dh2653-no-repo'), branch: 'main', thread: s.thread } },
});

export type Cause = 'sign_in_required' | 'plan_window_spent' | 'rate_limited' | 'refusal' | 'max_turns' | 'context_overflow' | 'agent_crashed' | 'timed_out' | 'unknown';
export interface StopShape {
  cause: Cause;
  outcome: 'finished' | 'failed';
  owner?: 'agent' | 'you' | 'service';
  signature?: string;
  plan_resets?: number;
  /** A subagent's stop: the child session whose turn it ends (agent.stop@5). */
  child?: string;
}
/** A turn that ended normally: Claude Code's Stop, its cause read from structure as unknown (#85's reading). */
export const FINISHED: StopShape = { cause: 'unknown', outcome: 'finished', owner: 'agent' };
/** A turn that ended on an error no rule acts on: the agent crashed. */
export const CRASHED: StopShape = { cause: 'agent_crashed', outcome: 'failed', owner: 'agent' };
/** A dropped connection: a transient the service owns, which gets one automatic continue (#85). */
export const DROPPED: StopShape = { cause: 'timed_out', outcome: 'failed', owner: 'service', signature: 'sig:1d20c0e1f2a3b4c5' };
/** A context overflow, compacted once and re-sent (#85). */
export const OVERFLOW: StopShape = { cause: 'context_overflow', outcome: 'failed', owner: 'agent' };
/** A plan window spent, with its reset: one task for every session the same window stopped, closing at the reset (#85). */
export const WINDOW = (resets: number): StopShape => ({ cause: 'plan_window_spent', outcome: 'failed', owner: 'service', signature: 'sig:5a0e1b2c3d4e5f60', plan_resets: resets });
/** A revoked sign-in, as Claude Code's StopFailure for authentication_failed records it (#84's reach suite). */
export const SIGNED_OUT: StopShape = { cause: 'sign_in_required', outcome: 'failed', owner: 'you', signature: 'sig:00a1b2c3d4e5f607' };

/** The hook recording a session's nth stop: agent.stop@5, writer hook, stamped `at`. */
export const stop = (s: Session, n: number, at: number, shape: StopShape): Input => ({
  connection: hook(s), what: `${s.id}'s stop ${n} (${shape.child ? 'a subagent\'s, ' : ''}${shape.cause}, ${shape.outcome}) at ${iso(at)}`,
  event: {
    v: 5, id: stopId(s, n, at), kind: 'agent.stop', subject: `session:${s.id}`, ts: at, seq: seqAt(at),
    data: {
      turn: n, did_work: true, claim: shape.outcome === 'finished', cause: shape.cause, usage: null, outcome: shape.outcome,
      ...(shape.owner === undefined ? {} : { owner: shape.owner }),
      ...(shape.signature === undefined ? {} : { signature: shape.signature }),
      ...(shape.plan_resets === undefined ? {} : { plan_resets: shape.plan_resets }),
      ...(shape.child === undefined ? {} : { child: shape.child }),
    },
  },
});
let messages = 0;
/** A prompt reaching a session: user.ask@1 with its origin (person: you typed it; continuation: a goal's, a heartbeat's or the app's resume). */
export const prompt = (s: Session, at: number, from: 'person' | 'continuation' | 'scheduled', text: string): Input => ({
  connection: hook(s), what: `${s.id} gets a prompt from ${from} at ${iso(at)}`,
  event: { v: 1, id: otherId(at), kind: 'user.ask', ts: at, seq: seqAt(at), data: { msg: ++messages, text, tasks: [], from } },
});
/** A tool call of a session's turn, as #16's seeded history records one. */
export const tool = (s: Session, at: number, kind: 'tool.before' | 'tool.after'): Input => ({
  connection: hook(s), what: `${s.id}'s ${kind} at ${iso(at)}`,
  event: { v: 1, id: otherId(at), kind, ts: at, seq: seqAt(at), data: { kind: 'shell', paths: [], command: 'npm test' } },
});
/** A check passing: the runner's verdict.made@1 PASS whose one requirement that check covers, as the hub's core records it. */
export const passed = (check: string, at: number): Input => {
  const vid = otherId(at);
  const commit = '0c5e145756bbdaef4d9b8bdaca2d0bd0f900ed46';
  const claim = `claim:${otherId(at)}`;
  return {
    connection: { writer: 'core', actor: YOU, scope: YOU }, what: `the check ${check} passes at ${iso(at)}`,
    event: { v: 1, id: vid, kind: 'verdict.made', subject: claim, ts: at, data: {
      outcome: 'PASS', verdict: `verdict:${vid}`, claim, reasons: [], smallest: null, points_to: null, commit,
      requirements: [{ req: 'req:01K74G0A1B2C3D4E5F6G7H8J9K#R1', outcome: 'PASS', check, depth: 'unit', oracle: 'code', runs: { clean: 1, needed: 1, counted: [`run:${otherId(at)}`] }, smallest: null, points_to: null, evidence: [], proof: 'test_run' }],
      key: { commit, doc_revisions: [], check_digests: [], state_digests: [], environment: 'node-24.22.0/darwin-arm64', tools: [] },
    } },
  };
};

/**
 * One step, in every world alike: the clock reads `at`, the event lands, and the core ticks, as the hub ticks the asks
 * core when a stop lands (packages/hub/src/core.ts) and once a second while a task waits on its check.
 */
export async function land(worlds: readonly World[], input: Input | null, at: number): Promise<void> {
  worlds[0]!.clock.set(at);
  for (const w of worlds) {
    if (input) await w.append(input.connection, input.event);
    await w.tick();
  }
}

// ---- A step's asks, tasks and outcomes, as one text two cores can be compared by.
const HANDLE = /\b(ask|decision):([0-9A-HJKMNP-TV-Z]{26})\b/g;
/**
 * What a core shows after a step: every row of its inbox, each event the log gained since the last step (the core's
 * appends with the step's own input), with no event ID or log position, and what it handed the agent. Each ask is
 * named by its first appearance in that world, so two cores that raise the same asks read alike.
 */
export async function stateOf(w: World): Promise<string> {
  const rows = await w.asks.inbox();
  const gained = await w.record.read({ after: w.seen, limit: 100_000 });
  if (gained.length) w.seen = gained[gained.length - 1]!.log_pos;
  const delivered = w.deliveries.splice(0);
  const name = (text: string): string => text.replace(HANDLE, (handle: string, kind: string) => {
    let named = w.names.get(handle);
    if (named === undefined) w.names.set(handle, (named = `${kind}#${w.names.size + 1}`));
    return named;
  });
  const wrote = gained.map((e) => ({ kind: e.kind, writer: e.writer, subject: e.subject ?? null, session: e.session ?? null, ts: e.ts, data: e.data }));
  return JSON.stringify({ wrote, asks: rows, delivered }, (_key, value: unknown) => (typeof value === 'string' ? name(value) : value));
}

// ---- Reading back.
/** The tasks open in a core's inbox: unblock rows not yet closed. */
export const openTasks = async (w: World): Promise<InboxRow[]> => (await w.asks.inbox()).filter((r) => r.kind === 'unblock' && r.outcome === 'unanswered');
export const inboxRow = async (w: World, handle: string): Promise<InboxRow | undefined> => (await w.asks.inbox()).find((r) => r.ask === handle);
/** The automatic continues and resumes the core recorded (session.continued), in log order. */
export const continues = async (w: World): Promise<{ session: string; stop: string; because: string; task: string | null }[]> =>
  (await w.events('session.continued')).map((e) => {
    const d = isObj(e.data) ? e.data : {};
    return { session: String(e.subject ?? '').replace(/^session:/, ''), stop: String(d.stop ?? ''), because: String(d.because ?? ''), task: typeof d.task === 'string' ? d.task : null };
  });

// ---- The count (README: counted by the test). A core's stops are the IDs of a session's stops it holds, read from a
// heap snapshot by walking from the core: the object `openAsks` binds its functions to.

/** Holds one core and its record while the snapshot is written, so the walk finds the core and leaves its record out. */
export class Count2653 {
  constructor(readonly label: string, readonly asks: Asks, readonly record: RecordStore) {}
}
interface Snapshot { meta: { node_fields: string[]; node_types: [string[], ...unknown[]]; edge_fields: string[]; edge_types: [string[], ...unknown[]] }; nodes: Uint32Array; edges: Uint32Array; strings: string[] }

/** A heap snapshot file, read as a stream: its node and edge tables as numbers, and its strings. */
async function readSnapshot(file: string): Promise<Snapshot> {
  let phase = 0;
  let pending = '';
  let meta: (Snapshot['meta'] & { node_count?: number; edge_count?: number }) | undefined;
  let nodes = new Uint32Array(0);
  let edges = new Uint32Array(0);
  let filled = 0;
  let value = 0;
  let digits = false;
  const rest: string[] = [];
  const numbers = (text: string, from: number, into: Uint32Array): number => {
    for (let i = from; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c >= 48 && c <= 57) { value = value * 10 + c - 48; digits = true; continue; }
      if (digits) { into[filled++] = value; value = 0; digits = false; }
      if (c === 93) return i + 1;
    }
    return -1;
  };
  const feed = (chunk: string): void => {
    let text = chunk;
    let from = 0;
    while (from < text.length) {
      if (phase === 0 || phase === 2) {
        pending += from ? text.slice(from) : text;
        const marker = phase === 0 ? '"nodes":[' : '"edges":[';
        const at = pending.indexOf(marker);
        if (at < 0) return;
        if (phase === 0) {
          const head = JSON.parse(`${pending.slice(0, at).trim().replace(/,$/, '')}}`) as { snapshot: { meta: Snapshot['meta']; node_count: number; edge_count: number } };
          meta = { ...head.snapshot.meta, node_count: head.snapshot.node_count, edge_count: head.snapshot.edge_count };
          nodes = new Uint32Array(head.snapshot.node_count * head.snapshot.meta.node_fields.length);
        } else edges = new Uint32Array(meta!.edge_count! * meta!.edge_fields.length);
        text = pending.slice(at + marker.length);
        from = 0;
        pending = '';
        filled = 0;
        phase++;
      } else if (phase === 1 || phase === 3) {
        const end = numbers(text, from, phase === 1 ? nodes : edges);
        if (end < 0) return;
        phase++;
        from = end;
      } else {
        rest.push(from ? text.slice(from) : text);
        return;
      }
    }
  };
  for await (const chunk of createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 })) feed(chunk as string);
  const tail = rest.join('');
  const at = tail.indexOf('"strings":[');
  if (!meta || phase !== 4 || at < 0) throw Error(`BLOCKED: the heap snapshot ${file} doesn't read as V8 writes one`);
  return { meta, nodes, edges, strings: JSON.parse(tail.slice(at + '"strings":'.length, tail.lastIndexOf(']') + 1)) as string[] };
}

/** Edges the walk never takes: to an object's hidden class and prototype chain, and a closure's or a context's links. */
const NOT_HELD = new Set(['map', '__proto__', 'constructor', 'prototype', 'context', 'native_context', 'global_proxy', 'script', 'shared', 'code', 'function', 'receiver', 'parameters_and_registers', 'feedback_vector', 'feedback_cell']);
const STRING_TYPES = new Set(['string', 'concatenated string', 'sliced string']);

/**
 * For each core held by a Count2653 (`label` → its stop IDs), the IDs of `s`'s stops the core holds: every string with
 * the mark of `s`'s stops reached from the core over its data (objects, arrays, maps and sets), never through a
 * closure, a context, a hidden class or a prototype, never into a record, a holder or the functions `openAsks`
 * returned. The snapshot is written after V8 collects garbage, so what is read is what is live.
 */
export async function stopsHeld(holders: readonly Count2653[], s: Session): Promise<Map<string, Set<string>>> {
  const dir = mkdtempSync(join(tmpdir(), 'dh2653-heap-'));
  try {
    const g = await readSnapshot(writeHeapSnapshot(join(dir, 'core.heapsnapshot')));
    const NF = g.meta.node_fields.length;
    const EF = g.meta.edge_fields.length;
    const [typeAt, nameAt, countAt] = ['type', 'name', 'edge_count'].map((f) => g.meta.node_fields.indexOf(f)) as [number, number, number];
    const [edgeTypeAt, edgeNameAt, toAt] = ['type', 'name_or_index', 'to_node'].map((f) => g.meta.edge_fields.indexOf(f)) as [number, number, number];
    const nodeTypes = g.meta.node_types[0];
    const edgeTypes = g.meta.edge_types[0];
    const count = g.nodes.length / NF;
    const first = new Uint32Array(count + 1);
    for (let i = 0; i < count; i++) first[i + 1] = first[i]! + g.nodes[i * NF + countAt]!;
    const typeOf = (i: number): string => nodeTypes[g.nodes[i * NF + typeAt]!]!;
    const nameOf = (i: number): string => g.strings[g.nodes[i * NF + nameAt]!]!;
    const edgesOf = function* (i: number): Generator<{ type: string; name: string; to: number }> {
      for (let e = first[i]!; e < first[i + 1]!; e++) {
        const type = edgeTypes[g.edges[e * EF + edgeTypeAt]!]!;
        const raw = g.edges[e * EF + edgeNameAt]!;
        yield { type, name: type === 'element' || type === 'hidden' ? String(raw) : g.strings[raw]!, to: g.edges[e * EF + toAt]! / NF };
      }
    };
    const edgeTo = (i: number, name: string): number | undefined => {
      for (const e of edgesOf(i)) if (e.name === name) return e.to;
      return undefined;
    };
    const found = new Map<string, { core: number; record: number; asks: number; holder: number }>();
    for (let i = 0; i < count; i++) {
      if (typeOf(i) !== 'object' || nameOf(i) !== Count2653.name) continue;
      const label = edgeTo(i, 'label');
      const asks = edgeTo(i, 'asks');
      const record = edgeTo(i, 'record');
      const tick = asks === undefined ? undefined : edgeTo(asks, 'tick');
      const core = tick === undefined ? undefined : edgeTo(tick, 'bound_this');
      if (label === undefined || asks === undefined || record === undefined || core === undefined) {
        throw Error('BLOCKED: the count reads the core as the object openAsks binds its functions to (its tick\'s bound_this), and the snapshot shows none');
      }
      found.set(nameOf(label), { core, record, asks, holder: i });
    }
    const pattern = stopPattern(s);
    const out = new Map<string, Set<string>>();
    for (const holder of holders) {
      const at = found.get(holder.label);
      if (!at) throw Error(`BLOCKED: the heap snapshot holds no core labelled ${holder.label}`);
      const shut = new Set([...found.values()].flatMap((f) => [f.record, f.asks, f.holder]));
      const seen = new Uint8Array(count);
      const ids = new Set<string>();
      const queue = [at.core];
      seen[at.core] = 1;
      while (queue.length) {
        const i = queue.pop()!;
        for (const e of edgesOf(i)) {
          if (seen[e.to] || shut.has(e.to) || e.type === 'weak' || e.type === 'shortcut' || e.type === 'context' || NOT_HELD.has(e.name)) continue;
          const type = typeOf(e.to);
          if (STRING_TYPES.has(type)) {
            if (pattern.test(nameOf(e.to))) ids.add(nameOf(e.to));
            continue;
          }
          if (type !== 'object' && type !== 'array') continue;
          seen[e.to] = 1;
          queue.push(e.to);
        }
      }
      out.set(holder.label, ids);
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
