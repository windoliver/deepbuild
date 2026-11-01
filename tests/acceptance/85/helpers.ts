// Test-side tools for the #85 acceptance tests: a real record on SQLite in a temporary folder, a home folder
// holding your settings, the asks core opened on both with a virtual clock (or the real one, for the budgets), the
// stops the hook would record (agent.stop@4 with deep-hook's stamp), the prompts you type (user.ask@1), the
// verdicts a check's run ends in (verdict.made@1), the thread of your chat app behind a read-only connector, and
// the hub stopped and started again on the same record. Nothing here stands in for the asks core; the planted wrong
// programs are in plants.ts.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection, Event, RecordStore, Row } from '../../../packages/record/src/index.ts';
import { AskRefused, openAsks } from '../../../packages/asks/src/index.ts';
import type { Asks, Card, Delivery, InboxRow } from '../../../packages/asks/src/index.ts';
import { bare, isObj, makeClock, seqAt, SETTINGS, T0, ulid, USAGE, YOU, type Clock, type Obj, type StopInput } from './data.ts';

export * from './data.ts';

// ---- Connections, as the hub's socket would prove them.
const who = { actor: YOU, scope: YOU };
/** DeepBuild's own code, for a session (as #318's, #319's and #320's tests raise and append). */
export const core = (session: string): Connection => ({ writer: 'core', ...who, session });
/** deep-hook, for a session of an agent. */
export const hook = (session: string, agent = 'claude-code'): Connection => ({ writer: 'hook', ...who, session, agent });

/** One message in a thread of your chat app, as the read-only connector hands it to the core. */
export interface ThreadMessage { from: string; text: string; at: number }
/** The read-only thread connector (README: The surface): the one boundary a chat app is reached through. */
export interface ThreadConnector { read(link: string): Promise<ThreadMessage[]> }
/** Your chat app's threads, as the test controls them: you and the bot post; the connector only reads. */
export class FakeThreads implements ThreadConnector {
  /** Every link the core read, in order. */
  readonly reads: string[] = [];
  private readonly threads = new Map<string, ThreadMessage[]>();
  constructor(private readonly now: () => number) {}
  post(link: string, from: string, text: string): void {
    this.threads.set(link, [...(this.threads.get(link) ?? []), { from, text, at: this.now() }]);
  }
  async read(link: string): Promise<ThreadMessage[]> {
    this.reads.push(link);
    return [...(this.threads.get(link) ?? [])];
  }
}

/** A session.continued@1 event, read back: the session, the stop it continues from, why, and the task when one closed. */
export interface Continued { id: string; session: string; stop: string; because: string; task: string | null; ts: number }

/** A wrong program planted around the real asks core: the real program with one part done wrong. */
export interface Planting {
  asks?: (asks: Asks, world: World) => Asks;
}

export interface World {
  clock: Clock;
  record: RecordStore;
  asks: Asks;
  deliveries: Delivery[];
  threads: FakeThreads;
  dir: string;
  home: string;
  /** A session starting: session.start with its agent, thread and worktree. */
  start(session: string, thread: string, agent?: string): Promise<void>;
  /** The hook recording a stop of a session: agent.stop@4 with its cause, stamped `at` (default: now). Returns the event's ID. */
  stop(session: string, input: StopInput): Promise<string>;
  /** A prompt you typed in a session: user.ask@1 from the hook, with its stamp. */
  typed(session: string, text: string, at?: number): Promise<void>;
  /** A check passing: a verdict.made@1 PASS whose one requirement that check covers. Returns the verdict's handle. */
  passed(check: string): Promise<string>;
  /** A check failing, with what's missing: a verdict.made@1 FAIL on that check with its reasons. */
  failed(check: string, reasons: string[]): Promise<string>;
  /** Sets the virtual clock and lets the hub act on it. */
  at(ms: number): Promise<void>;
  tick(): Promise<void>;
  events(kind?: string): Promise<Event[]>;
  /** The automatic continues and resumes recorded (session.continued), for one session or all, in log order. */
  continued(session?: string): Promise<Continued[]>;
  /** The session's row in the sessions projection, as `deep status` and the app read it. */
  sessionRow(session: string): Promise<Row | undefined>;
  /** The hub stops (the core goes, the record closes) and starts again on the same record and settings. */
  restart(): Promise<void>;
  close(): Promise<void>;
}

export interface WorldOptions {
  plant?: Planting;
  /** The real clock (the budgets); otherwise the virtual one at T0. */
  real?: boolean;
}

export async function openWorld({ plant = {}, real = false }: WorldOptions = {}): Promise<World> {
  const dir = mkdtempSync(join(tmpdir(), 'deep-85-'));
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'config.json'), `${JSON.stringify(SETTINGS, null, 2)}\n`);
  const clock: Clock = real ? { now: () => Date.now(), set: () => undefined } : makeClock(T0);
  const deliveries: Delivery[] = [];
  const threads = new FakeThreads(clock.now);
  const agents = new Map<string, string>();
  const turns = new Map<string, number>();
  let messages = 0;
  const w = { clock, deliveries, threads, dir, home } as World;
  const open = async () => {
    w.record = await openRecord({ path: join(dir, 'record.db'), now: clock.now });
    const asks = await openAsks({ record: w.record, now: clock.now, deliver: (d) => { deliveries.push(d); }, home, threads });
    w.asks = plant.asks ? plant.asks(asks, w) : asks;
  };
  const events = async (kind?: string): Promise<Event[]> => {
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await w.record.read({ after, limit: 1000 });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return kind ? all.filter((e) => e.kind === kind) : all;
  };
  const verdict = async (check: string, outcome: 'PASS' | 'FAIL', reasons: string[]): Promise<string> => {
    const now = clock.now();
    const vid = ulid(now);
    const ids = { run: `run:${ulid(now)}`, verdict: `verdict:${vid}`, claim: `claim:${ulid(now)}` };
    const commit = '0c5e145756bbdaef4d9b8bdaca2d0bd0f900ed46';
    // The runner's verdict, as the hub core records it.
    await w.record.append({ writer: 'core', ...who }, { v: 1, id: vid, kind: 'verdict.made', subject: ids.claim, ts: now, data: {
      outcome, verdict: ids.verdict, claim: ids.claim, reasons, smallest: reasons[0] ?? null, points_to: null, commit,
      requirements: [{ req: 'req:01K74G0A1B2C3D4E5F6G7H8J9K#R1', outcome, check, depth: 'unit', oracle: 'code', runs: { clean: outcome === 'PASS' ? 1 : 0, needed: 1, counted: [ids.run] }, smallest: reasons[0] ?? null, points_to: null, evidence: [], proof: 'test_run' }],
      key: { commit, doc_revisions: [], check_digests: [], state_digests: [], environment: 'node-24.22.0/darwin-arm64', tools: [] },
    } });
    return ids.verdict;
  };
  Object.assign(w, {
    events,
    start: async (session: string, thread: string, agent = 'claude-code') => {
      agents.set(session, agent);
      await w.record.append(hook(session, agent), { v: 1, id: ulid(clock.now()), kind: 'session.start', ts: clock.now(), seq: seqAt(clock.now()), data: { agent, worktree: join(dir, 'no-repo'), branch: 'main', thread } });
    },
    stop: async (session: string, input: StopInput) => {
      const at = input.at ?? clock.now();
      const id = ulid(at);
      const turn = (turns.get(session) ?? 0) + 1;
      turns.set(session, turn);
      const data: Obj = {
        turn, did_work: input.did_work ?? false, claim: input.claim ?? false, cause: input.cause, usage: USAGE, outcome: input.outcome ?? 'failed',
        ...(input.signature === undefined ? {} : { signature: input.signature }),
        ...(input.owner === undefined ? {} : { owner: input.owner }),
        ...(input.plan_resets === undefined ? {} : { plan_resets: input.plan_resets }),
      };
      await w.record.append(hook(session, agents.get(session)), { v: 4, id, kind: 'agent.stop', subject: `session:${session}`, ts: at, seq: seqAt(at), data });
      return id;
    },
    typed: async (session: string, text: string, at = clock.now()) => {
      await w.record.append(hook(session, agents.get(session)), { v: 1, id: ulid(at), kind: 'user.ask', ts: at, seq: seqAt(at), data: { msg: ++messages, text, tasks: [], from: 'person' } });
    },
    passed: (check: string) => verdict(check, 'PASS', []),
    failed: (check: string, reasons: string[]) => verdict(check, 'FAIL', reasons),
    at: async (ms: number) => { clock.set(ms); await w.asks.tick(); },
    tick: () => w.asks.tick(),
    continued: async (session?: string): Promise<Continued[]> => (await events('session.continued'))
      .map((e) => {
        const d = isObj(e.data) ? e.data : {};
        return { id: e.id, session: String(e.subject ?? '').replace(/^session:/, ''), stop: String(d.stop ?? ''), because: String(d.because ?? ''), task: typeof d.task === 'string' ? d.task : null, ts: e.ts };
      })
      .filter((c) => session === undefined || c.session === session),
    sessionRow: async (session: string) => (await w.record.table('sessions')).rows.find((r) => r.id === session),
    restart: async () => { await w.record.close(); await open(); },
    close: async () => { await w.record.close().catch(() => undefined); rmSync(dir, { recursive: true, force: true }); },
  });
  await open();
  return w;
}

/** Runs a scenario in its own world, with the planted wrong program when one is given, and closes it. */
export async function inWorld(plant: Planting | undefined, run: (w: World) => Promise<void>): Promise<void> {
  const w = await openWorld({ ...(plant ? { plant } : {}) });
  try {
    await run(w);
  } finally {
    await w.close();
  }
}

/** The ask.sources@1 row an agent raises an unblock task from with deep_ask. */
export const UNBLOCK_SOURCE = 'deep_ask.unblock';

/** Raises an ask the test expects the core to take: a refusal fails the test at this assertion, naming why. */
export async function raised(w: World, connection: Connection, data: Obj, what: string): Promise<string> {
  let handle: string | undefined;
  let refusal: unknown;
  try {
    handle = await w.asks.raise(connection, UNBLOCK_SOURCE, data);
  } catch (error) {
    refusal = error;
  }
  expect(refusal === undefined ? undefined : `${(refusal as Error).name}: ${(refusal as Error).message}`, `${what} is raised, not refused`).toBeUndefined();
  return handle!;
}

/** Raises an ask the test expects the core to refuse, and returns the refusal (undefined when it took the ask). */
export async function refusal(w: World, connection: Connection, data: Obj): Promise<AskRefused | undefined> {
  try {
    await w.asks.raise(connection, UNBLOCK_SOURCE, data);
    return undefined;
  } catch (error) {
    expect(error, 'the core refuses with AskRefused').toBeInstanceOf(AskRefused);
    return error as AskRefused;
  }
}

/** The ask.created event an ask was raised with. */
export async function created(w: World, handle: string): Promise<Event> {
  const event = (await w.events('ask.created')).find((e) => e.id === bare(handle));
  expect(event, `ask ${handle} is in the log`).toBeDefined();
  return event!;
}
/** An ask's data as it was raised. */
export const dataOf = async (w: World, handle: string): Promise<Obj> => {
  const d = (await created(w, handle)).data;
  return isObj(d) ? d : {};
};

/** Your inbox row for an ask, as `deep inbox` prints it. */
export const inboxRow = async (w: World, handle: string): Promise<InboxRow | undefined> => (await w.asks.inbox()).find((r) => r.ask === handle);
/** The tasks open in your inbox: unblock rows not yet closed. */
export const openTasks = async (w: World): Promise<InboxRow[]> => (await w.asks.inbox()).filter((r) => r.kind === 'unblock' && r.outcome === 'unanswered');
/**
 * What a task unblocks: its own `unblocks`, and those of every ask that joined it (recorded superseded by it), so a
 * core that widens one task in place and one that raises a session's task and folds it into the shared one read alike.
 */
export async function unblocksOf(w: World, task: string): Promise<string[]> {
  const joined = (await w.events('ask.superseded')).filter((e) => isObj(e.data) && e.data.by === task).map((e) => `ask:${String(e.subject ?? '').replace(/^ask:/, '')}`);
  const out = new Set<string>();
  for (const handle of [task, ...joined]) {
    const unblocks = (await dataOf(w, handle)).unblocks;
    if (Array.isArray(unblocks)) for (const u of unblocks) out.add(String(u));
  }
  return [...out];
}
/** The open tasks that unblock a session: those whose `unblocks` lists `session:<id>`. */
export async function tasksFor(w: World, session: string): Promise<string[]> {
  const out: string[] = [];
  for (const row of await openTasks(w)) if ((await unblocksOf(w, row.ask)).includes(`session:${session}`)) out.push(row.ask);
  return out;
}
/** The card Needs you shows for an ask. */
export const cardIn = (cards: Card[], ask: string): Card | undefined => cards.find((c) => c.ask === ask);

/**
 * Sessions stopped by one cause share one task: exactly one task is open in your inbox, it unblocks every one of
 * them, you own it, and it is the one unblock task Needs you shows. Returns its handle.
 */
export async function theOneTask(w: World, sessions: string[], what: string): Promise<string> {
  const open = await openTasks(w);
  expect(open.map((r) => r.ask), `${what}: the ${sessions.length} sessions stopped by one cause share one task, open in your inbox`).toHaveLength(1);
  const task = open[0]!;
  const unblocks = await unblocksOf(w, task.ask);
  for (const s of sessions) expect(unblocks, `${what}: task ${task.ask} unblocks session ${s}`).toContain(`session:${s}`);
  expect(task.owner, `${what}: task ${task.ask} is yours to do`).toBe(YOU);
  const shown = (await w.asks.needsYou()).filter((c) => c.kind === 'unblock').map((c) => c.ask);
  expect(shown, `${what}: Needs you shows that one task`).toEqual([task.ask]);
  return task.ask;
}

/** What the task's check proves, as the core raised it: the check its PASS closes it on. */
export async function provesOf(w: World, task: string): Promise<string> {
  const proves = (await dataOf(w, task)).proves;
  expect(typeof proves, `task ${task} names the check that proves it`).toBe('string');
  return proves as string;
}

/** Nothing you typed, and no answer: the task closed on its check alone. */
export async function nothingTyped(w: World, what: string): Promise<void> {
  expect(await w.events('ask.answered'), `${what}: no ask was answered; you never typed "done"`).toEqual([]);
  expect(await w.events('ask.defaulted'), `${what}: nothing defaulted`).toEqual([]);
  expect((await w.events('user.ask')).filter((e) => isObj(e.data) && e.data.from === 'person'), `${what}: you typed nothing`).toEqual([]);
}
