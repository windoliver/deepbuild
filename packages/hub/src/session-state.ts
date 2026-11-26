import type { HubEvents, HubRuntime, HookSchedule } from './hub-capabilities.js';
import type { AnswerDeliveryPort, StopJudgingPort, SessionFlagsPort, SessionMemoryPort, TranscriptsPort, McpOperationsPort } from './hub-ports.js';

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';

import { UsageTail } from '@deepbuild/readings';

import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { type JsonValue } from '@deepbuild/contracts';
import type { Asks } from '@deepbuild/asks';

import { type EventInput, type RecordStore } from '@deepbuild/record';

import { type JobRecord, type Runner } from '@deepbuild/runner';
import { alive as running } from '@deepbuild/supervisor';

import { sessionHomes } from './codex-settings.js';

import { sessionStates, statusRows, WAITING_QUIET_MS, type StatusRow } from './status.js';
import { plantedKeeps } from './plant.js';
import { buildRows, distinctTitles, ENTRY, jobRow, listRows, nameIn, orderOf, rowVersion, settle, SHORT, whyOf, type Placed, type Row, type RunningJob } from './rows.js';

import { commitsBetween, headOf } from './session-facts.js';

import { GateRunner } from './gate-runner.js';
import { Siblings } from './siblings.js';

import { argsOf, parentOf, parents, peerOf, startOf } from './children.js';
import { deepHook, type Root } from './paths.js';
import { OWNER, People } from './people.js';
import type { Hosts } from './hosts.js';

import { UNREAD_WINDOW } from './status.js';

import { isStatusQuestion } from './verdict-chat.js';

import { clockTime } from './promises.js';

import { Stacks } from './stacks.js';
import { Starts } from './starts.js';

import { Replicas } from './drive.js';

import { cursorAt, cursorOf, Refused, refusal, refuse, SETTLED_PAGE, ulid, type CoreOptions, type Draft, type HookMeta } from './wire.js';
import type { CallContext, Session, Live } from './session-types.js';

import { TranscriptReader } from './transcript-reader.js';
import { CODEX_BINARY, CLAUDE_BINARY, JOB_ROW_MS, sql, letters, QUIET_MS, CALL_GRACE, COMMITS, ENDED_KEPT, manyThreads, type Obj, reusedPids, isObj, isUnder } from "./hub-shared.js";

/** How long a call with no end yet keeps its session at work through quiet hooks (#2021): Claude Code's Bash tool's own limit. */
const CALL_RUNS_MS = 10 * 60_000;

export interface SessionStateOptions {
  settings: CoreOptions;
  services: {
    readonly gate: GateRunner;
    readonly asks: Asks;
    readonly now: () => number;
    readonly record: RecordStore;
    readonly raw: RecordStore['raw'];
    readonly transcriptReader: TranscriptReader;
    readonly stacks: Stacks;
    readonly replicas: Replicas;
    readonly archivedSessions: (() => Promise<Set<string>>) | undefined;
    readonly archiveSession: ((session: string) => Promise<void>) | undefined;
    readonly runner: Runner;
    readonly root: Root;
    readonly siblings: Siblings;
    readonly sessionStarts: Starts;
    readonly people: People;
    readonly hosts: Hosts;
  };
  judging: () => Pick<StopJudgingPort, "forget" | "letGo" | "watchEnded">;
  transcripts: () => Pick<TranscriptsPort, "cursors" | "saveCursors" | "writeCursors">;
  delivery: () => Pick<AnswerDeliveryPort, "answerWaiting" | "answers" | "binds" | "forget">;
  mcp: () => Pick<McpOperationsPort, "forget" | "stamps">;
  memory: () => Pick<SessionMemoryPort, "forget">;
  flags: () => Pick<SessionFlagsPort, "unpushed" | "modelCalled">;
  events: Pick<HubEvents, "appendReading" | "append" | "connection" | "appendSession">;
kernel: Pick<HubRuntime, "stopping">;
schedule: Pick<HookSchedule, "askingSoon" | "queue">;
  /** A session forgotten (#1866): what the core itself keeps of it goes. */
  forgot: (session: string) => void;

}

/**
 * What an event names that leads to a session (#3389), by the fields the record's projections read: an ask's, a claim's,
 * a verdict's or a session's handle, each ask of a batch, and the task it is about.
 */
function namesOf({ id, kind, subject, data }: EventInput): string[] {
  const d: Obj = isObj(data) ? data : {};
  const asks = Array.isArray(d.asks) ? d.asks.map((a) => (isObj(a) ? a.ask : undefined)) : [];
  const handles = [subject, d.ask, d.claim, d.verdict, d.delivery, d.owner, d.session, ...asks, kind === 'ask.created' ? `ask:${id}` : undefined];
  const tasks = [d.task_ref, kind.startsWith('task.') ? subject : undefined];
  return [...handles.filter((h) => typeof h === 'string' && /^(ask|claim|verdict|session):/.test(h)), ...tasks].filter((n): n is string => typeof n === 'string');
}

/** A state a hub's restart waits on (hub-control.ts): a turn under way, or one waiting on you. */
const inTurn = (state: string): boolean => state.startsWith('working/') || state === 'needs you/waiting';

/** SessionState: owns its domain state; services are resolved only when used. */
export class SessionState {
  constructor(private readonly options: SessionStateOptions) {}

  readonly sessions = new Map<string, Session>();

  /** Every session the hooks named, checked or not, by ID. */
  readonly live = new Map<string, Live>();

  /** The sessions that ended, oldest end first. */
  readonly endedOrder = new Set<string>();

  /** Each process's start time, as `ps -o lstart=` prints it: how a process is told apart from a reused PID. */
  private readonly starts = new Map<number, Promise<string | undefined>>();

  /** When each session's agent process last had its start time read, by the watch for processes gone (#992). */
  private readonly startChecked = new Map<string, number>();

  /** A hook's parent's command line, shared even while a resume is changing the session's binding. */
  private readonly argsRead = new WeakMap<HookMeta, Promise<string>>();

  /** Launch facts belong to the checked process, shared across rotated IDs and forgotten with its sessions. */
  private readonly processReads = new WeakMap<Session, { pid: number; start: string; args?: Promise<string>; parents?: { key: string; read: Promise<string | undefined> } }>();
  private readonly parentLinks = new WeakMap<Session, string>();

  /** The repo each session works in, from its hooks' folder: what its events carry as their project (#23). */
  readonly projects = new Map<string, string>();

  readonly sessionPeople = new Map<string, string>();

  /** The host each session on another machine runs on, from the connection its hooks came over (#999). */
  readonly sessionHosts = new Map<string, string>();

  /** The project each session entered, for its packs (#67). */
  readonly entered = new Map<string, string>();

  /** Each live session's running usage, from its transcript and its subagents'. */
  readonly tails = new Map<string, UsageTail>();

  /** Each Codex session's turn its last hook named, so a turn no prompt hook started is seen at its first hook. */
  readonly turnsStarted = new Map<string, string>();

  /** Each session's turn whose compaction a PreCompact opened and no PostCompact has closed yet (#1022). */
  private readonly compacting = new Map<string, string>();

  /**
   * Each session's messages typed mid-turn not yet acknowledged, with the task each opened, and all those of its
   * current turn: the queue the chat line shows (#340).
   */
  readonly acks = new Map<string, { text: string; task: string | undefined }[]>();

  readonly midTurn = new Map<string, string[]>();

  /** The screen each session's computer use last switched to, one it leases (#332). */
  readonly onScreen = new Map<string, string>();

  /**
   * Each session's state as the core last recorded it, `<state>/<cause>`: the one reading deep status lists, recorded as
   * session.state when it changes so the app draws the same (#992).
   */
  readonly states = new Map<string, string>();

  statesRead = false;

  stating: Promise<void> | undefined;

  private restate = false;
  private stateWake: (() => void) | undefined;
  private stateTimer: ReturnType<typeof setTimeout> | undefined;

  /** The sessions appended to since the last state pass, or all of them: at the start, after a failed pass and at `deep off` or `deep on`. */
  touched: Set<string> | 'all' = 'all';

  /** What the appends since the last state pass name: the pass reads the sessions these lead to as well (#3389). */
  private names = new Set<string>();

  /** When the clock alone ends each session's state, for those whose last reading gave a time (#2646). */
  private readonly until = new Map<string, number>();

  /**
   * The list's rows as last appended (#1463), by ID; empty until the record's are read at start, which makes the first
   * pass a backfill. A session's leaves memory with the session (#1866), and a pass that needs it reads the record's.
   */
  rows = new Map<string, Placed>();

  rowsFirst = true;

  /** Each running job's row (#1925): when it was last appended, and the newer count held until a second has passed. */
  private readonly jobRows = new Map<string, { at: number; held?: ReturnType<typeof setTimeout> }>();

  /** The job rows' appends in turn, so a row never leaves the list before its last count is recorded. */
  private jobRowsAppended: Promise<void> = Promise.resolve();

  /** The commits recorded, each by the session that made it, so one made across two hooks is recorded once. */
  private readonly committed = new Map<string, string>();

  /** The sessions that got their reading for a version past their facts. */
  readonly versioned = new Set<string>();

  /** Sessions whose caller name the payload contradicted, each read once (#993). */
  readonly miscalled = new Set<string>();

  /** Hooks from a running job's folder held until the runner reads that job's session ID, by job. */
  private readonly parked = new Map<string, Promise<void>>();

  /** Each session a reading named a job for, once. */
  readonly readings = new Set<string>();

  /** Each session's own five-hour reading, as its status line last sent it. */
  private readonly windowOf = new Map<string, { used: number; resets: number | null }>();

  private readsOf(session: Session) {
    let kept = this.processReads.get(session);
    if (!kept) {
      const before = [...this.sessions.values()].find((s) => s !== session && s.pid === session.pid && s.start === session.start && this.processReads.has(s));
      if (before) kept = this.processReads.get(before);
    }
    if (!kept || kept.pid !== session.pid || kept.start !== session.start) {
      kept = { pid: session.pid, start: session.start };
      this.parentLinks.delete(session);
    }
    this.processReads.set(session, kept);
    return kept;
  }

  async parentArgs(meta: HookMeta): Promise<string> {
    // A host's process is read there, never in this machine's table (#999).
    if (meta.host) return this.options.services.hosts.sessions.argsOf(meta.host, meta.ppid);
    const session = this.sessions.get(meta.session);
    const kept = session && !session.ended && session.pid === meta.ppid && session.cwd === meta.cwd
      && (!meta.transcript || resolve(meta.transcript) === session.transcript)
      && await this.startOf(meta.ppid) === session.start ? this.readsOf(session) : undefined;
    let read = this.argsRead.get(meta);
    if (!read) this.argsRead.set(meta, (read = kept?.args ?? argsOf(meta.ppid).catch(() => '')));
    if (kept && kept.args !== read) {
      kept.args = read;
      // An unread command line is not a launch fact: the next start tries again.
      void read.then((args) => { if (!args && kept.args === read) delete kept.args; });
    }
    return read;
  }

  // ---- What the core reads beside a session's hooks (#18).

  liveOf(meta: HookMeta): Live {
    let live = this.live.get(meta.session);
    if (!live) this.live.set(meta.session, (live = { agent: meta.agent, cwd: meta.cwd, last: 0, calls: new Map(), wakeups: [], crons: new Map(), background: new Map(), looping: false, turn: 0, judged: false }));
    return live;
  }

  /**
   * What a hook says of its session beyond its events: whether it is working, so its hooks going quiet reads unknown,
   * the calls still running, and the commits made in its worktree.
   */
  follow(drafts: Draft[], meta: HookMeta, verified: boolean): void {
    if (!meta.session) return;
    const live = this.liveOf(meta);
    // The hub's own ticker firing FileChanged (#120) says nothing of the session: its quiet reading stays timed (#992).
    if (meta.event === 'FileChanged') return;
    const now = Date.now();
    live.last = now;
    const wasWaiting = live.state;
    let state = live.state;
    // A prompt hook opens the turn the next stop is judged on: a person's, with work done in it (#83). A prompt read
    // from the transcript's queue (#25) opens none yet: its turn starts when the agent takes it, at its own prompt
    // hook, which then has no draft left. A wake (the waiter's, or a subagent's report as its `<task-notification>`),
    // the app's resume, a status question answered from the record and a subagent's own prompt all leave the turn
    // as it is, so the stop that finishes the person's task is still judged; a hand-back prompt without that text
    // opens a turn of its own, unjudged.
    const prompt = meta.fields?.prompt ?? '';
    const statusQuestion = meta.event === 'UserPromptSubmit' && live.from === 'person' && isStatusQuestion(prompt);
    const continues = prompt.includes('<task-notification>') || live.from === 'continuation' || statusQuestion || Boolean(meta.fields?.agent_id);
    if (meta.event === 'UserPromptSubmit' && !continues) {
      live.turn++;
      live.judged = false;
      live.sentOn = false;
      live.prOpened = undefined;
      // The task the prompt opened: on its draft, or on the queue's draft of it when the queue showed it first.
      const opened = drafts.find((d) => d.kind === 'user.ask') ?? this.sessions.get(meta.session)?.spliced?.get(meta.id)?.task;
      const ask = opened?.data.tasks;
      live.turnTask = Array.isArray(ask) && typeof ask[0] === 'string' ? ask[0] : undefined;
      // The ask that began the turn is the turn's handle, the one its usage carries (#45).
      live.turnAsk = opened?.id;
      this.options.schedule.askingSoon();
    }
    for (const draft of drafts) {
      const call = typeof draft.data.call === 'string' ? draft.data.call : undefined;
      if (draft.kind === 'user.ask') state = 'working';
      else if (draft.kind === 'permission.request') state = 'waiting';
      // A hook that says the session waits on you, is at work again, or sits idle at its prompt (#992); an idle prompt
      // after a stop that failed or got stuck leaves the stop's state.
      else if (draft.kind === 'session.attention' && typeof draft.data.state === 'string' && !(draft.data.state === 'finished' && (state === 'failed' || state === 'stuck'))) state = draft.data.state;
      else if (draft.kind === 'tool.before' || draft.kind === 'tool.after') {
        // A late call event never reopens a turn that stopped.
        if (state !== 'finished' && state !== 'failed') state = 'working';
        if (call && draft.kind === 'tool.before') live.lastCall = call;
        if (call && draft.kind === 'tool.before') live.calls.set(call, { what: `${String(draft.data.kind)} call ${call}${typeof draft.data.command === 'string' ? ` (\`${draft.data.command}\`)` : ''}`, at: now });
        else if (call) { const open = live.calls.get(call); if (open) open.ended = now; }
      } else if (draft.kind === 'agent.stop' && !draft.data.child) {
        // A turn that ended on a block only you or a service can clear (a sign-in, a rate limit) leaves the session stuck.
        state = draft.data.outcome !== 'failed' ? 'finished' : draft.data.owner === 'you' || draft.data.owner === 'service' ? 'stuck' : 'failed';
      }
    }
    for (const [call, c] of live.calls) if (c.ended !== undefined && now - c.ended > CALL_GRACE) live.calls.delete(call);
    // A turn you interrupted (#39, #3430) has no stop to say so: it ends here, with no claim.
    if (verified && meta.interrupted) { state = 'finished'; void this.attention(meta.session, meta.agent, 'finished'); }
    // A compaction is one event (#1022): a PreCompact of the turn whose compaction is still open is the same one again.
    const turn = meta.fields?.turn_id ?? '';
    const again = meta.event === 'PreCompact' && this.compacting.get(meta.session) === turn;
    if (meta.event === 'PreCompact') this.compacting.set(meta.session, turn);
    else if (meta.event === 'PostCompact' || meta.event === 'SessionEnd') this.compacting.delete(meta.session);
    // Kept under the hook's own ID, so the copy deep-hook spooled when the hub was late is known at its replay.
    if (verified && meta.reading && !again) void this.options.events.appendReading(meta.session, meta.agent, meta.reading, meta.id, meta.readingCode).catch(() => undefined);
    // The agent's own title for the session (#2018), when its hook says a new one; a subagent's hook names no session.
    if (verified && meta.fields?.session_title && !meta.fields.agent_id) void this.agentTitled(meta.session, meta.agent, meta.fields.session_title).catch(() => undefined);
    // The record reads these states from the hook events themselves; only unknown, below, is the core's to append.
    // A person's status question changes none: answered from the record it runs no model, and let through (an
    // answer waiting, or DeepBuild off) it shows its state at its next hook, as the record's row does.
    if (state && !statusQuestion) live.state = state;
    clearTimeout(live.quiet);
    live.quiet = undefined;
    if (meta.event === 'SessionEnd') {
      // A watch ends with its session, whose last stop is then judged (#997), before the session is let go.
      const ends = [...live.background].filter(([, b]) => b.watch).map(([id]) => this.options.judging().watchEnded(meta.session, id, 'its session ended'));
      const end = () => { this.live.delete(meta.session); this.options.services.gate.ended(meta.session); this.options.judging().letGo(meta.session); this.options.schedule.askingSoon(); };
      if (ends.length) void Promise.all(ends).finally(end);
      else end();
    }
    // A session waiting on you goes quiet as a working one does (#992): a prompt denied with Esc says so in no hook.
    else if ((state === 'working' || state === 'waiting') && !statusQuestion && !this.options.kernel.stopping) {
      // The call whose prompt the session starts waiting on: its result, with no hook, shows the prompt closed.
      if (state === 'waiting' && wasWaiting !== 'waiting') live.asking = drafts.some((d) => d.kind === 'permission.request') ? live.lastCall : undefined;
      live.heard = this.options.services.now();
      this.quietIn(meta.session, live, now, live.heard + QUIET_MS);
    }
    // Read on the session's own chain, never the core's: a replay at the start would wait on the start it is part of.
    if (meta.cwd && ['SessionStart', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd'].includes(meta.event)) {
      // A call of the session's that makes commits (git commit, merge, cherry-pick, am, revert, rebase) makes the
      // commits that appear by its end the session's (#29: head trust reads them); any other new head is not.
      const after = drafts.find((d) => d.kind === 'tool.after');
      const made = after !== undefined && typeof after.data.command === 'string' && COMMITS.test(after.data.command);
      // Once its turn stops, its commits no remote branch holds (#2019).
      const stopped = (meta.event === 'Stop' || meta.event === 'StopFailure') && !meta.fields?.agent_id;
      live.reading = (live.reading ?? Promise.resolve()).then(() => this.commits(meta, live, made)).then(() => (stopped ? this.options.flags().unpushed(meta.session, live.agent) : undefined)).catch(() => undefined);
    }
  }

  async attention(session: string, agent: string, state: string): Promise<void> {
    // A session whose question to you is still open waits on you: its stop never reads as finished (#27).
    if (state === 'finished' && await this.asksYou(session)) state = 'waiting';
    const ts = this.options.services.now();
    return this.options.events.append(this.options.events.connection('core', { session, agent }), { v: 2, id: ulid(ts), kind: 'session.attention', ts, subject: `session:${letters(session)}`, data: { state } }).catch(() => undefined);
  }

  /** Whether the session has an ask still open for you. */
  async asksYou(session: string): Promise<boolean> {
    return ((await this.options.services.record.raw(`SELECT 1 FROM asks WHERE session_id = ? AND status IN ('open', 'later') LIMIT 1`, [session]).catch(() => [])) as unknown[]).length > 0;
  }

  /** Times the session's quiet reading for `due` on the hub's clock, which a stepped test clock brings on (#992). */
  private quietIn(id: string, live: Live, since: number, due: number): void {
    clearTimeout(live.quiet);
    live.quietDue = due;
    live.quiet = setTimeout(() => void this.options.schedule.queue(() => this.quiet(id, since)).catch(() => undefined), Math.max(0, due - this.options.services.now()));
    live.quiet.unref();
  }

  /**
   * A working or waiting session whose hooks went quiet: unknown, unless its transcript's tail shows it still at work, or
   * still at a prompt: one that closed with no hook, as Esc does, leaves your entry in the transcript (#992).
   */
  private async quiet(id: string, since: number): Promise<void> {
    const live = this.live.get(id);
    if (!live || live.last !== since || (live.state !== 'working' && live.state !== 'waiting')) return;
    live.quiet = undefined;
    const session = this.sessions.get(id);
    const read = session?.read;
    if (session) await this.options.services.transcriptReader.readTranscript(session, this.options.flags().modelCalled(session));
    const due = live.quietDue ?? this.options.services.now();
    // A call under way writes nothing until it ends: the session waits on it, at work, for as long as such a call runs (#2021).
    const running = [...live.calls.values()].some((c) => c.ended === undefined && c.at !== undefined && due - c.at < CALL_RUNS_MS);
    // Its transcript grew since the last check, whether this read or the read between hooks (#2019) took it in.
    const going = live.state === 'working' ? running || (session !== undefined && (session.read !== read || (session.grewAt ?? 0) > due - QUIET_MS))
      : !(live.asking && session?.results?.includes(live.asking)) && due - (live.heard ?? due) < WAITING_QUIET_MS;
    if (going) {
      this.quietIn(id, live, since, due + QUIET_MS);
      return;
    }
    live.state = 'unknown';
    await this.attention(id, live.agent, 'unknown');
  }

  /**
   * Every session whose agent's process the hub watched end with no SessionEnd (its terminal closed, it was killed):
   * its session.gone, lease or not (#992). Only a process two of its hooks named is watched. A process is checked each tick, and its start time, which tells a reused
   * ID apart, every half minute; a ps that fails proves nothing.
   */
  async goneSessions(): Promise<void> {
    const now = Date.now();
    // An agent the last hub watched, whose session no hook has brought to this one yet.
    for (const [id, cursor] of [...this.options.transcripts().cursors]) {
      const watch = cursor.watch;
      if (!watch || this.sessions.has(id)) continue;
      let alive = running(watch.pid);
      if (alive && now - (this.startChecked.get(id) ?? 0) >= 30_000) {
        this.startChecked.set(id, now);
        const start = await this.startOf(watch.pid, true);
        alive = start === undefined || start === watch.start;
      }
      if (alive || this.sessions.has(id) || this.options.transcripts().cursors.get(id) !== cursor) continue;
      this.options.transcripts().cursors.set(id, { ...cursor, watch: undefined });
      this.startChecked.delete(id);
      this.options.transcripts().saveCursors();
      await this.options.events.appendSession(id, watch.agent, 'session.gone', { pid: watch.pid, start: watch.start }).catch(() => undefined);
    }
    for (const session of [...this.sessions.values()]) {
      if (session.ended || !session.pid || !session.watched) continue;
      let alive = running(session.pid);
      if (alive && now - (this.startChecked.get(session.id) ?? 0) >= 30_000) {
        this.startChecked.set(session.id, now);
        const start = await this.startOf(session.pid, true);
        alive = start === undefined || start === session.start;
      }
      if (alive || session.ended) continue;
      session.ended = true;
      this.startChecked.delete(session.id);
      // The process is gone, so its ID may start another: no session is bound to the start time cached for it.
      if (![...this.sessions.values()].some((s) => !s.ended && s.pid === session.pid)) this.starts.delete(session.pid);
      session.interrupted = true;
      if (this.options.settings.plant === 'reap-on-kill') this.options.services.stacks.endFor(session.id);
      this.letGoLive(session.id);
      this.options.services.siblings.died(session.id);
      await this.options.events.appendSession(session.id, session.agent, 'session.gone', { pid: session.pid, start: session.start }).catch(() => undefined);
      if (session.agent === 'codex' && this.options.settings.plant !== 'leaves-codex-session-open') await this.closedAtExit(session).catch(() => undefined);
      this.endedOrder.delete(session.id);
      this.endedOrder.add(session.id);
      this.forgetEnded();
    }
  }

  /**
   * Codex ended with Ctrl-C may fire no SessionEnd (#1023), so its process ending is its end: the core records the
   * session.end, a reading that says so, and each answer still waiting for it goes by its task, as an ended Codex
   * session's answer does (#39).
   */
  private async closedAtExit(session: Session): Promise<void> {
    this.sessionOver(session);
    const ts = this.options.services.now();
    await this.options.events.append(this.options.events.connection('core', { session: session.id, agent: session.agent }), { v: 2, id: ulid(ts), kind: 'session.end', ts, subject: `session:${letters(session.id)}`, data: { reason: 'process_exited' } });
    await this.options.events.appendReading(session.id, session.agent, `Codex fired no SessionEnd: the hub closed this session when its process (pid ${session.pid}) exited`);
    for (const answer of await this.options.delivery().answers.waitingFor(session.id)) await this.options.delivery().answers.outcome(answer.id, 'on_task', 'waiting');
  }

  /** A session has ended, by its SessionEnd or its Archive: what it started goes with it (#342). */
  sessionOver(session: Session): void {
    session.ended = true;
    session.interrupted = false;
    this.options.services.stacks.endFor(session.id);
    // Its replicas end with it, and their leases with them (#124).
    this.options.services.replicas.endFor(session.id);
    this.options.mcp().stamps = this.options.mcp().stamps.filter((stamp) => stamp.session !== session.id);
  }

  private letGoLive(id: string): void {
    const live = this.live.get(id);
    if (live) { clearTimeout(live.quiet); this.live.delete(id); this.options.services.gate.ended(id); this.options.judging().letGo(id); this.options.schedule.askingSoon(); }
  }

  /**
   * Codex Desktop's Archive fires no hook and moves the rollout to its archived folder (#80), so that move is the session's
   * end: the rollout is copied from there and the session ends as a SessionEnd ends it (#342). An interrupted session's Archive
   * ends it too. One whose rollout is back where it was has been unarchived, and goes on.
   */
  async archivedThreads(): Promise<void> {
    const open = [...this.sessions.values()].filter((s) => (!s.ended || s.interrupted) && !existsSync(s.transcript));
    if (!open.length) return;
    const archived = await this.options.services.archivedSessions!();
    for (const session of open) {
      if (!archived.has(letters(session.id)) || (session.ended && !session.interrupted)) continue;
      await this.options.services.archiveSession!(session.id).catch(() => undefined);
      this.sessionOver(session);
      this.letGoLive(session.id);
      await this.options.events.appendSession(session.id, session.agent, 'session.archived', { transcript: session.transcript });
      this.endedOrder.delete(session.id);
      this.endedOrder.add(session.id);
      this.forgetEnded();
    }
  }

  /**
   * An append, made in `session` if in one (#3389): the next state pass reads that session and those the event's names
   * lead to. One that concerns none starts no pass.
   */
  appended(input: EventInput, session: string | undefined): void {
    if (input.kind === 'session.state' || input.kind === 'row.set') return;
    // The planted wrong program touches the session the append was made in, and nothing else.
    const own = this.options.settings.plant === 'state-pass-own-session-only';
    // `deep off` and `deep on` hold for every session.
    if (input.kind === 'holds.watch' && !session && !own) this.touched = 'all';
    if (this.touched !== 'all') {
      const names = own ? [] : namesOf(input);
      if (!session && !names.length) return;
      if (session) this.touched.add(session);
      for (const name of names) this.names.add(name);
    }
    this.stateSoon();
  }

  /** The sessions the names of events lead to: an ask's, a claim's, a verdict's claim's, those at a task, and a session's own (#3389). */
  private async sessionsOf(names: ReadonlySet<string>): Promise<string[]> {
    if (!names.size) return [];
    const ids = [...names].flatMap((name) => [name, name.replace(/^[a-z]+:/, '')]);
    const rows = await this.options.services.raw(`WITH named(id) AS (SELECT value FROM json_each(?))
      SELECT session_id AS id FROM asks WHERE id IN (SELECT id FROM named)
      UNION SELECT session_id FROM claims WHERE id IN (SELECT id FROM named) UNION SELECT session_id FROM claims WHERE subject_ref IN (SELECT id FROM named)
      UNION SELECT c.session_id FROM verdicts v JOIN claims c ON c.id = v.claim_id WHERE v.id IN (SELECT id FROM named)
      UNION SELECT thread FROM tasks WHERE task_ref IN (SELECT id FROM named) UNION SELECT id FROM sessions WHERE id IN (SELECT id FROM named)`, [JSON.stringify(ids)]);
    return (rows as { id: string | null }[]).flatMap((r) => r.id ?? []);
  }

  /** Reads the sessions' states again soon after an append; appends that land meanwhile are read in the next pass. */
  stateSoon(): void {
    if (!this.statesRead || this.options.kernel.stopping) return;
    if (this.stating) { this.restate = true; return; }
    this.stating = new Promise<void>((done) => {
      this.stateWake = () => {
        clearTimeout(this.stateTimer);
        this.stateTimer = undefined;
        this.stateWake = undefined;
        done();
      };
      this.stateTimer = setTimeout(this.stateWake, 200);
    }).then(() => this.recordStates()).catch(() => undefined).finally(() => {
      this.stating = undefined;
      if (this.restate) { this.restate = false; this.stateSoon(); }
    });
  }

  /**
   * Each minute's pass (#2646): the sessions whose state the clock has ended since their last reading, and no others.
   * A state that changes with time alone has no append to say so; every other change is an append, which has its pass.
   */
  minutePassed(): void {
    const now = this.options.services.now();
    if (this.touched !== 'all') for (const [id, until] of this.until) if (until < now) this.touched.add(id);
    this.stateSoon();
  }

  /** Stop owns the debounce: wake it before draining so shutdown never waits on an abandoned delay. */
  async flushStates(): Promise<void> {
    this.stateWake?.();
    await this.statesSettled();
  }

  /** Marks the row `id` read, as row.set with `unread: false`, if it's unread; whether it was (#1461). */
  async seeRow(id: string): Promise<Obj> {
    const placed = this.rows.get(id) ?? (await this.recordedRows([id]))[0];
    if (!placed?.row.unread) return { seen: false };
    const row = { ...placed.row, unread: false };
    const ts = this.options.services.now();
    const session = row.session;
    const connection = this.options.events.connection('core', { ...(this.projects.get(session) ? { project: this.projects.get(session)! } : {}), ...(this.sessionPeople.get(session) ? { actor: this.sessionPeople.get(session)! } : {}) });
    await this.options.events.append(connection, { v: rowVersion(row), id: ulid(ts), kind: 'row.set', ts, data: { listed: true, order: placed.order, ...row } as unknown as JsonValue });
    if (this.rows.has(id)) this.rows.set(id, { order: placed.order, row });
    return { seen: true };
  }

  /** Once no state pass is under way or due, the passes appends since asked for included. */
  async statesSettled(): Promise<void> {
    while (this.stating) await this.stating;
  }

  /** Appends session.state for each session whose state or cause the one reading now gives differently. */
  async recordStates(): Promise<void> {
    const { touched, names } = this;
    this.touched = new Set();
    this.names = new Set();
    if (touched !== 'all' && !touched.size && !names.size) return;
    try {
      const only = touched === 'all' ? touched : new Set([...touched, ...await this.sessionsOf(names)]);
      // Appended together, so the record commits them in one batch, as it does a first start's state for every session.
      // An ask of no session has no state to read, only its row below.
      const read = only !== 'all' && !only.size ? [] : await sessionStates(this.options.services.raw, this.options.services.now(), only === 'all' ? undefined : only);
      // The planted wrong program leaves out each session whose newest promise event says its promise fell due.
      const due = !['pass-skips-due-promise', 'state-pass-skips-due-promise'].includes(this.options.settings.plant ?? '') ? [] : (await this.options.services.raw("SELECT session_id FROM events e WHERE kind = 'promise.due' AND NOT EXISTS (SELECT 1 FROM events l WHERE l.session_id = e.session_id AND l.log_pos > e.log_pos AND l.kind IN ('promise.set', 'promise.due', 'promise.woken', 'promise.blocked'))")) as { session_id: string }[];
      const readings = read.filter((r) => !due.some((d) => d.session_id === r.id));
      if (only === 'all') this.until.clear();
      else for (const id of only) this.until.delete(id);
      for (const r of readings) if (r.until !== undefined) this.until.set(r.id, r.until);
      // The list's rows (#1463): each that changed, and each ask's that left the list, in the same batch.
      // The open asks are the asks core's inbox projection, by its one close rule (#2026), and of those the ones in
      // sight: shown at their batch or at once, or put off with Later. One waiting for its batch, held for the agent's
      // next step, or folded into an exception, which shows it, has no row of its own (#22).
      const inbox = (await this.options.services.asks.inbox()).filter((a) => a.status === 'shown' || a.status === 'later').map((a) => a.ask);
      const named = await buildRows(this.options.services.raw, readings, inbox);
      await this.recall(readings.map((r) => r.id), only === 'all');
      const built = await this.titled(named, only === 'all');
      const changed = settle(this.rows, built, this.rowsFirst);
      const open = new Set(built.filter((r) => r.id.startsWith('ask:')).map((r) => r.id));
      const left = [...this.rows.keys()].filter((id) => id.startsWith('ask:') && !open.has(id));
      this.rowsFirst = false;
      const rowOf = (session: string) => this.options.events.connection('core', { ...(this.projects.get(session) ? { project: this.projects.get(session)! } : {}), ...(this.sessionPeople.get(session) ? { actor: this.sessionPeople.get(session)! } : {}) });
      await Promise.all([
        ...readings.map(async (r) => {
          const state = `${r.state}/${r.cause}`;
          if (this.states.get(r.id) === state) return;
          const ts = this.options.services.now();
          await this.options.events.append(this.options.events.connection('core', { session: r.id, ...(r.agent ? { agent: r.agent } : {}) }), { v: 3, id: ulid(ts), kind: 'session.state', ts, subject: `session:${letters(r.id)}`, data: { state: r.state, cause: r.cause, entry: ENTRY[r.state] } });
          this.states.set(r.id, state);
        }),
        ...changed.map(async (p) => {
          const ts = this.options.services.now();
          // A row that says what its session's turn is doing now takes the version with the field (#2021).
          await this.options.events.append(rowOf(p.row.session), { v: rowVersion(p.row), id: ulid(ts), kind: 'row.set', ts, data: { listed: true, order: p.order, ...p.row } as unknown as JsonValue });
          this.rows.set(p.row.id, p);
        }),
        ...left.map(async (id) => {
          const ts = this.options.services.now();
          await this.options.events.append(rowOf(this.rows.get(id)!.row.session), { v: 1, id: ulid(ts), kind: 'row.set', ts, data: { id, listed: false } });
          this.rows.delete(id);
        }),
      ]);
      // A session the core doesn't keep is the record's again (#1866), but one whose turn the hub's restart waits for.
      for (const id of [...this.rows.keys()]) if (id.startsWith('session:') && !this.keeps(id.slice('session:'.length))) this.rows.delete(id);
      for (const [id, state] of this.states) if (!this.keeps(id) && !inTurn(state)) this.states.delete(id);
    } catch (error) {
      this.touched = 'all';
      throw error;
    }
  }

  /** Whether the core keeps a session in memory: one its hooks reach, or that just ended. */
  private keeps(session: string): boolean {
    return this.sessions.has(session) || this.live.has(session);
  }

  /** Rows as the record holds them, by ID. */
  private async recordedRows(ids: readonly string[]): Promise<Placed[]> {
    if (!ids.length) return [];
    return ((await this.options.services.raw('SELECT ord, row FROM rows WHERE id IN (SELECT value FROM json_each(?))', [JSON.stringify(ids)])) as { ord: string; row: string }[]).map((r) => ({ order: r.ord, row: JSON.parse(r.row) as Row }));
  }

  /** The rows and states a pass over `sessions`, or over every one, compares with, of those memory doesn't hold (#1866). */
  private async recall(sessions: readonly string[], all: boolean): Promise<void> {
    const states = sessions.filter((id) => !this.states.has(id));
    for (const r of (states.length ? await this.options.services.raw(`SELECT value AS id, (SELECT json_extract(data, '$.state') || '/' || json_extract(data, '$.cause') FROM events INDEXED BY events_session WHERE session_id = value AND kind = 'session.state' ORDER BY log_pos DESC LIMIT 1) AS state FROM json_each(?)`, [JSON.stringify(states)]) : []) as { id: string; state: string | null }[]) {
      if (r.state !== null) this.states.set(r.id, r.state);
    }
    const rows = all ? await listRows(this.options.services.raw) : await this.recordedRows(sessions.map((id) => `session:${id}`).filter((id) => !this.rows.has(id)));
    for (const p of rows) if (!this.rows.has(p.row.id)) this.rows.set(p.row.id, p);
  }

  /**
   * Each session's one name (#2018), with its short ID only where another session's row would read the same: a row whose
   * twin came or went is set again with it, though nothing else of it changed. A pass over every session has its row in
   * memory; any other asks the record for the other rows of each name it touches (#1866), as few as tell a twin.
   */
  private async titled(named: readonly Row[], all: boolean): Promise<Row[]> {
    const fresh = new Map(named.filter((r) => r.id.startsWith('session:')).map((r) => [r.id, r.title]));
    const of = new Map<string, Map<string, string>>();
    const add = (id: string, name: string): void => void (of.get(name) ?? of.set(name, new Map()).get(name)!).set(id, name);
    for (const [id, name] of fresh) add(id, name);
    if (all) { for (const p of this.rows.values()) if (p.row.id.startsWith('session:') && !fresh.has(p.row.id)) add(p.row.id, nameIn(p.row)); }
    else {
      // The name a session had before, too: its going may leave that name to one row alone.
      const names = new Set([...fresh.values(), ...[...fresh.keys()].flatMap((id) => { const was = this.rows.get(id); return was ? [nameIn(was.row)] : []; })]);
      for (const name of names) for (const p of await this.sameName(name, fresh.size + 2)) {
        if (fresh.has(p.row.id)) continue;
        if (!this.rows.has(p.row.id)) this.rows.set(p.row.id, p);
        add(p.row.id, name);
      }
    }
    const titles = new Map([...of.values()].flatMap((names) => [...distinctTitles(names)]));
    return [
      ...named.map((r) => (titles.has(r.id) ? { ...r, title: titles.get(r.id)! } : r)),
      ...[...titles].flatMap(([id, title]) => { const was = this.rows.get(id)?.row; return was && !fresh.has(id) && was.title !== title ? [{ ...was, title }] : []; }),
    ];
  }

  /** The session rows of one name: every one that reads as the name alone, and up to `most` with their short IDs. */
  private async sameName(name: string, most: number): Promise<Placed[]> {
    const title = "json_extract(row, '$.title')";
    const rows = [
      ...await this.options.services.raw(`SELECT ord, row FROM rows WHERE ${title} = ? AND id LIKE 'session:%'`, [name]),
      ...await this.options.services.raw(`SELECT ord, row FROM rows WHERE ${title} >= ? AND ${title} < ? AND id LIKE 'session:%' AND ${title} = ? || substr(id, ${'session:'.length + 1}, 8) LIMIT ${most}`, [`${name}${SHORT}`, `${name}${SHORT}\u{10FFFF}`, `${name}${SHORT}`]),
    ] as { ord: string; row: string }[];
    return rows.map((r) => ({ order: r.ord, row: JSON.parse(r.row) as Row }));
  }

  /**
   * A running job's row as it now reads (#1925), appended at most once a second however fast its tool counts, with
   * the newest count always appended in the end; or, once its tool's run has ended, the row leaving the list.
   */
  jobShown(job: RunningJob, running: boolean): void {
    const id = `job:${job.key}`;
    const was = this.jobRows.get(id);
    clearTimeout(was?.held);
    if (!running) {
      this.jobRows.delete(id);
      this.jobRowAppend(id, null);
      return;
    }
    const wait = was ? was.at + JOB_ROW_MS - Date.now() : 0;
    if (wait > 0) {
      this.jobRows.set(id, { at: was!.at, held: setTimeout(() => this.jobShown(job, true), wait) });
      return;
    }
    this.jobRows.set(id, { at: Date.now() });
    this.jobRowAppend(id, jobRow(job));
  }

  /** Appends a job's row as row.set@2, or with none its leaving the list, after the job rows' earlier appends. */
  jobRowAppend(id: string, row: Row | null): void {
    this.jobRowsAppended = this.jobRowsAppended.then(async () => {
      const ts = this.options.services.now();
      if (row) {
        const placed = { order: orderOf(row), row };
        await this.options.events.append(this.options.events.connection('core'), { v: 2, id: ulid(ts), kind: 'row.set', ts, data: { listed: true, order: placed.order, ...row } as unknown as JsonValue });
        this.rows.set(id, placed);
      } else if (this.rows.has(id)) {
        await this.options.events.append(this.options.events.connection('core'), { v: 2, id: ulid(ts), kind: 'row.set', ts, data: { id, listed: false } });
        this.rows.delete(id);
      }
    }).catch(() => undefined);
  }

  /**
   * Rename from the Session menu (#2018): the name you gave a session, which every surface shows first. Recorded as
   * the core, as Pause is; it is no sign of the session, so its row's time in its state stays.
   */
  async renameSession(params: Obj): Promise<Obj> {
    const { session } = params;
    if (typeof session !== 'string' || !letters(session)) throw refuse('type', '/params/session', 'Name the session by its ID.', session);
    const name = typeof params.name === 'string' ? params.name.split(/\r?\n/)[0]!.trim() : '';
    if (!name || name.length > 512) throw refuse('type', '/params/name', 'Give the session a name of 1 to 512 characters, on one line.', params.name);
    await this.named(session, name, 'you');
    return { session, name };
  }
  /** The agent's own title for a session, from its hook (#2018): recorded once each time it changes. */
  private async agentTitled(session: string, agent: string, title: string): Promise<void> {
    if (!this.agentTitles.has(session)) {
      const [last] = (await this.options.services.record.raw("SELECT json_extract(data, '$.name') AS name FROM events WHERE kind = 'session.named' AND session_id = ? AND json_extract(data, '$.by') = 'agent' ORDER BY log_pos DESC LIMIT 1", [session])) as { name: string }[];
      this.agentTitles.set(session, last?.name ?? '');
    }
    if (this.agentTitles.get(session) === title) return;
    this.agentTitles.set(session, title);
    await this.named(session, title, 'agent', agent);
  }
  private readonly agentTitles = new Map<string, string>();
  private async named(session: string, name: string, by: 'you' | 'agent', agent?: string): Promise<void> {
    const ts = this.options.services.now();
    await this.options.events.append(this.options.events.connection('core', { session, ...(agent ? { agent } : {}) }), { v: 1, id: ulid(ts), kind: 'session.named', ts, subject: `session:${letters(session)}`, data: { name, by } });
  }

  /**
   * Why a session reads as it does (#2018): its row, the row of the state table that matched, each record fact that
   * row read and, for each row above it, the fact it lacked, from the same call that picks every session's state.
   */
  async whySeen(role: string, params: Obj): Promise<Obj> {
    const rows = async () => (await listRows(this.options.services.raw)).map((p) => p.row);
    let found = await whyOf(this.options.services.raw, this.options.services.now(), String(params.session ?? ''), await rows());
    // A row the clock alone moved since its last pass, as one gone quiet, is set first: the row and its why agree.
    const listed = 'refused' in found ? undefined : (await this.recordedRows([found.id]))[0]?.row;
    if (!('refused' in found) && (found.word !== listed?.word || found.why !== listed?.why)) {
      if (this.touched !== 'all') this.touched.add(found.id.slice('session:'.length));
      await this.recordStates().catch(() => undefined);
      found = await whyOf(this.options.services.raw, this.options.services.now(), found.id, await rows());
    }
    if ('refused' in found) throw refuse('not_found', '/params/session', found.refused, params.session);
    const seen = role.startsWith('person:') ? this.seenBy(role) : '';
    if (seen && !(await this.options.services.record.raw(`SELECT 1 FROM events WHERE session_id = ?${seen} LIMIT 1`, [found.id.slice('session:'.length)])).length) throw refuse('not_found', '/params/session', 'No session of yours has that ID.', params.session);
    return found as unknown as Obj;
  }

  /** The quiet readings a stepped test clock brought due, each quiet period that passed read in turn. */
  async quietDue(): Promise<void> {
    for (const [id, live] of this.live) {
      while (live.quiet && live.quietDue !== undefined && live.quietDue <= this.options.services.now()) {
        clearTimeout(live.quiet);
        live.quiet = undefined;
        await this.options.schedule.queue(() => this.quiet(id, live.last));
      }
    }
  }

  /**
   * The thread a session's ID joins. `/clear`, `/compact` and a fork inside a session rotate the ID in the same agent
   * process, so the new ID joins that process's last session; `--fork-session` starts a new process, whose arguments
   * name the session it forked. Anything else starts a thread of its own. Codex keeps its ID through a compaction and
   * a clear, its daemon runs many threads, and its payload names no fork's parent: its thread is its own ID.
   */
  async threadOf(session: Session, source: string | undefined): Promise<string> {
    if (manyThreads(session.agent)) return session.id;
    if (source !== 'clear' && source !== 'compact' && source !== 'fork') return session.id;
    const before = [...this.sessions.values()].filter((s) => s.id !== session.id && s.pid === session.pid && s.start === session.start).at(-1);
    if (before) return before.thread;
    if (source !== 'fork') return session.id;
    const from = /(?:^|\s)(?:--resume|-r)[\s=]([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?=\s|$)/.exec(this.sessionHosts.has(session.id) ? '' : await argsOf(session.pid))?.[1];
    if (!from) return session.id;
    // One that ended long ago has left memory; the record still names its thread.
    const known = this.sessions.get(from)?.thread;
    if (known) return known;
    const [row] = (await this.options.services.record.raw('SELECT thread_id FROM sessions WHERE id = ?', [from])) as { thread_id: string | null }[];
    return row?.thread_id ?? from;
  }

  /** Links a session whose agent process another session's agent process started, such as `codex exec` run by Claude Code, as its child. */
  async childOf(session: Session, agent: string): Promise<void> {
    const kept = this.readsOf(session);
    // The process didn't change. Only learning another possible parent (or its rotated ID) can change the link.
    const candidates = JSON.stringify([...this.sessions.values()].filter((s) => s.pid > 1 && s.pid !== session.pid).map((s) => [s.id, s.pid, s.start, s.ended]));
    const key = createHash('sha256').update(candidates).digest('hex'); // Fixed retained size, not a copy of every session.
    let finding = kept.parents;
    if (finding?.key !== key) {
      finding = { key, read: this.readAgentAbove({ pid: session.pid, start: session.start }) };
      kept.parents = finding;
    }
    try {
      const parent = await finding.read;
      if (!parent || parent === session.id || this.parentLinks.get(session) === parent) return;
      this.parentLinks.set(session, parent);
      await this.options.events.appendSession(session.id, agent, 'session.child_started', { parent: `session:${letters(parent)}`, child: `session:${letters(session.id)}`, task_ref: null });
    } catch (error) {
      if (kept.parents === finding) delete kept.parents;
      this.parentLinks.delete(session);
      throw error;
    }
  }

  /**
   * The commits a session made in its worktree since its last hook, each recorded once under it: only those a call of
   * its own that makes commits brought (`made`), never a head that moved some other way, such as a pull of a
   * stranger's commits, whatever their author and committer fields say.
   */
  private async commits(meta: HookMeta, live: Live, made: boolean): Promise<void> {
    // A host's folder is read over SSH (#999): at a start, a stop and a call that makes commits, not at every call's end.
    if (meta.host && !made && meta.event.startsWith('PostToolUse')) return;
    const head = await this.head(meta.session, meta.cwd).catch(() => undefined);
    // A folder with no commit yet: the first one a call makes is a commit too.
    if (!head) { live.unborn = true; return; }
    const before = live.head;
    const first = before === undefined && live.unborn === true;
    live.head = head.sha;
    live.unborn = false;
    if ((before === undefined && !first) || before === head.sha || !made) return;
    for (const sha of first || meta.host ? [head.sha] : await commitsBetween(meta.cwd, before!, head.sha)) {
      if (this.committed.has(sha)) continue;
      this.committed.set(sha, meta.session);
      await this.options.events.appendSession(meta.session, live.agent, 'commit.made', { sha, worktree: meta.cwd, branch: head.branch }).catch(() => undefined);
    }
  }

  /**
   * Whose a hook is: a job's, when its session ID is the one the runner read from that job's own output and it was
   * sent inside the job's run; held, when it comes from a running job's folder before that ID is read; otherwise
   * the session's own, with a reading when it only looks like a job's. It reads the jobs the runner holds in memory,
   * so a hook from an older ended job's folder or session is the session's own with no reading (#2650), and of those
   * only the ones of the hook's session or folder (#2651).
   */
  async whose(meta: HookMeta, seq: string | undefined): Promise<{ job?: string; wait?: string; reading?: { job: string; text: string } }> {
    // Only the jobs of its session or its folder are read, never a copy of every job (#2651).
    const jobs = await this.options.services.runner.near(meta.session, meta.cwd);
    const at = seq ? Number(BigInt(seq) / 1_000_000n) : Date.now();
    const during = (j: JobRecord) => j.ran !== undefined && at >= j.ran.from && (j.ran.to === undefined || at <= j.ran.to);
    // The planted wrong program looks only at the sessions of running jobs: no folder, no ended job.
    if (this.options.settings.plant === 'whose-running-sessions-only') {
      const running = jobs.find((j) => meta.session && j.session === meta.session && j.state === 'running');
      return running ? { job: running.job } : {};
    }
    const own = jobs.find((j) => meta.session && j.session === meta.session && during(j));
    if (own) return { job: own.job };
    const there = jobs.find((j) => meta.cwd && (meta.cwd === j.folder || isUnder(meta.cwd, j.folder)));
    if (there && there.session === undefined && (there.state === 'running' || there.state === 'stopping')) return { wait: there.job };
    const resumed = jobs.find((j) => meta.session && j.session === meta.session);
    if (resumed) return { reading: { job: resumed.job, text: `It resumes the session ID of DeepBuild's job ${resumed.job}, which it is not: it is judged as your own session.` } };
    if (there) return { reading: { job: there.job, text: `It works in the folder of DeepBuild's job ${there.job} (${there.folder}), which it is not: it is judged as your own session.` } };
    return {};
  }

  /** Resolves once the runner has read the job's session ID, or the job has ended without one. */
  park(job: string): Promise<void> {
    let parked = this.parked.get(job);
    if (!parked) {
      parked = (async () => {
        for (;;) {
          const rec = await this.options.services.runner.status(job).catch(() => undefined);
          if (!rec || rec.session !== undefined || (rec.state !== 'running' && rec.state !== 'stopping')) return;
          await new Promise((done) => setTimeout(done, 50));
        }
      })();
      this.parked.set(job, parked);
      void parked.finally(() => this.parked.delete(job));
    }
    return parked;
  }

  /** The HEAD of a session's folder: on its host for a session there (#999), else here. */
  head(session: string, cwd: string): Promise<{ sha: string; branch: string | null } | undefined> {
    const host = this.sessionHosts.get(session);
    return host ? this.options.services.hosts.sessions.headOf(host, cwd) : headOf(cwd);
  }
  /** A process's start time, or undefined when it can't be read. Read from the children's thread, never this one or the event loop. */
  startOf(pid: number, fresh = false, host?: string): Promise<string | undefined> {
    // A host's process is read there, never in this machine's table (#999).
    if (host) return this.options.services.hosts.sessions.startOf(host, pid, fresh);
    const known = this.starts.get(pid);
    if (known && !fresh) return known;
    const read = startOf(pid);
    // A fresh read replaces the kept one once it is in: a hook's check meanwhile reads the kept one, never waits on it.
    // One that fails keeps the kept one, since a failed ps proves nothing about the process.
    if (known) void read.then((start) => { if (start !== undefined) this.starts.set(pid, read); });
    else this.starts.set(pid, read);
    return read;
  }

  /**
   * Whether an event can be checked against the session it claims: its transcript under its agent's home, its
   * working folder and its process tree (its hook's parent, by PID and start time) all as the session's own
   * hooks established them. The first checked event of a session establishes it.
   */
  async verify(meta: HookMeta): Promise<boolean> {
    // A Codex hook may carry no transcript path (its facts: `transcript_path: string|null`); such a session is checked by
    // its working folder and process tree alone, and nothing is read from a transcript for it (#806).
    // paseo's plugin keeps no transcript: its sessions are checked by working folder and the plugin's process (#55).
    const none = (meta.agent === 'codex' && !meta.transcript) || meta.agent === 'paseo';
    // A session is on the host its first hook's connection came over (#999).
    if (meta.host && meta.session && !this.sessionHosts.has(meta.session)) this.sessionHosts.set(meta.session, meta.host);
    if (!meta.session || !meta.cwd || (!none && !isAbsolute(meta.transcript))) return false;
    // A session on a host (#999) keeps its transcript under its agent's home there, and its process is read there.
    const homes = meta.host ? [`${this.options.services.hosts.sessions.home(meta.host) ?? ''}/.claude/projects`] : meta.agent === 'codex' ? sessionHomes(this.options.services.root.dir) : [join(homedir(), '.claude', 'projects')];
    const named = none ? '' : resolve(meta.transcript);
    // pi's --session-dir puts a session's file anywhere; its package runs inside pi, and pi's process is what is checked.
    if (!none && meta.agent !== 'pi' && !homes.some((home) => isUnder(named, home))) return false;
    // Nothing is read here from a transcript that is on a host: a file at the same path here is another's.
    const transcript = meta.host ? '' : named;
    const start = await this.startOf(meta.ppid, false, meta.host);
    if (!start) return false;
    const session = this.sessions.get(meta.session);
    // A Codex subagent's SubagentStart names the child's own rollout, whose file ends in its agent_id, with the root's session ID.
    const child = meta.agent === 'codex' && meta.fields?.agent_id && transcript.endsWith(`-${meta.fields.agent_id}.jsonl`);
    if (!session) {
      // A child's rollout is no root's: the root's own next hook establishes the session.
      if (child) return false;
      // A session the last hub met is read from where that hub left it; one this hub meets first, from here on:
      // what its transcript held before isn't judged.
      const cursor = this.options.transcripts().cursors.get(meta.session);
      this.options.transcripts().cursors.delete(meta.session);
      const left = cursor?.transcript === transcript && typeof cursor.read === 'number' && Array.isArray(cursor.reached) ? cursor : undefined;
      const read = left ? left.read : none ? 0 : await stat(transcript).then((s) => s.size, () => 0);
      const watched = left?.watch?.pid === meta.ppid && left.watch.start === start;
      this.sessions.set(meta.session, { id: meta.session, thread: meta.session, agent: meta.agent, pid: meta.ppid, start, cwd: meta.cwd, transcript, ended: false, watched, read, turn: undefined, closed: [], reached: new Set(left?.reached), pending: new Map(), prompts: new Map(), entries: [] });
      // A session's first cursor is written at once: a restart before it would read the session from its end.
      this.options.transcripts().writeCursors();
      return true;
    }
    // A Codex thread's identity is its payload's: resumed in a new Codex process, once the old one is gone or the session
    // ended, it is bound to that process from its start. A Claude Code session resumed in a new process (`--resume`, the
    // desktop app opened again) is too, by its own resume start (#1033).
    const binary = meta.agent === 'codex' ? CODEX_BINARY : meta.agent === 'claude-code' || meta.agent === 'claude' ? CLAUDE_BINARY : undefined;
    const resumed = meta.fields?.source === 'resume' || (meta.agent === 'codex' && meta.fields?.source === 'startup');
    // A resume rereads launch facts as before, even when it names the same PID (#2329).
    if (meta.event === 'SessionStart' && resumed) {
      this.processReads.set(session, { pid: session.pid, start: session.start });
      this.parentLinks.delete(session);
    }
    if (binary && transcript === session.transcript && meta.event === 'SessionStart' && resumed
      && (session.ended || await this.startOf(session.pid, true, meta.host) !== session.start) && binary.test(await this.parentArgs(meta))) {
      Object.assign(session, { pid: meta.ppid, start, cwd: meta.cwd, ended: false, interrupted: false, watched: false });
      return true;
    }
    // pi resumes a session from a new process, by its file: its start takes the session over once the old process is gone.
    const gone = async () => {
      if (!session.pid) return true;
      const was = await this.startOf(session.pid, true);
      return was === undefined ? !running(session.pid) : was !== session.start;
    };
    if (meta.agent === 'pi' && session.agent === 'pi' && meta.event === 'SessionStart' && transcript === session.transcript && await gone()) {
      Object.assign(session, { pid: meta.ppid, start, cwd: meta.cwd, watched: false });
      return true;
    }
    const own = ((child && meta.event === 'SubagentStart') || transcript === session.transcript) && meta.cwd === session.cwd && meta.ppid === session.pid && start === session.start;
    // Only a process of this machine is watched for its end: a host's sessions read unknown while its link is down, never gone (#999).
    if (own && !session.watched && !meta.host) { session.watched = true; this.options.transcripts().saveCursors(); }
    return own;
  }

  /**
   * Past the newest ENDED_KEPT to end, an ended session with its turns judged and no call pending goes, with what the
   * core kept for it (#824): the record holds it, and a `/clear` or a late reading only ever looks at one that just ended.
   */
  forgetEnded(): void {
    for (const id of this.endedOrder) if (!this.sessions.get(id)?.ended) this.endedOrder.delete(id);
    // A stack it still owns asks whether it lives, and only one in memory can answer that it ended.
    const owning = this.options.services.stacks.holders();
    const ended = [...this.endedOrder].filter((id) => { const s = this.sessions.get(id)!; return !s.closed.length && !s.pending.size && !owning.has(`mcp:${id}`); });
    for (const id of ended.slice(0, Math.max(0, ended.length - ENDED_KEPT))) {
      this.endedOrder.delete(id);
      // Its agent's start time, kept for the checks of its hooks; a watch has no process of its own.
      const pid = this.sessions.get(id)!.pid;
      if (pid && ![...this.sessions.values()].some((s) => s.id !== id && s.pid === pid)) this.starts.delete(pid);
      this.sessions.delete(id);
      if (this.tails.has(id)) plantedKeeps(this.options.settings.plant, 'churn-keeps-usage-tail', id, this.tails.get(id));
      for (const kept of [this.projects, this.sessionPeople, this.entered, this.tails, this.compacting, this.states, this.windowOf, this.agentTitles]) kept.delete(id);
      // When the clock ends its state stays until then (#3389): the minute pass reads it, and no append will. The planted
      // wrong program lets it go with the session.
      if (this.options.settings.plant === 'let-go-forgets-time') this.until.delete(id);
      this.rows.delete(`session:${id}`);
      for (const kept of [this.versioned, this.miscalled]) kept.delete(id);
      this.startChecked.delete(id);
      for (const reading of this.readings) if (reading.startsWith(`${id}\0`)) this.readings.delete(reading);
      for (const [sha, by] of this.committed) if (by === id) this.committed.delete(sha);
      // Its answers whose delivery timed out go too: only its next prompt reads for them, and the record keeps them undelivered.
      for (const domain of [this.options.judging(), this.options.delivery(), this.options.mcp(), this.options.memory(), this.options.services.siblings]) domain.forget(id);
      this.options.forgot(id);
    }
  }

  /**
   * Binds a deep mcp to the one live session whose checked hooks came from its parent process, or to none, and names
   * the parent its calls bind by. That parent is read from the process the OS reports at the other end of its
   * connection `fd`, by PID and start time, never from its hello (#2070): the session's agent process itself, as the
   * pi package runs inside pi, or else that process's parent. Where the OS reports no peer, it binds to none here and
   * each call binds by the PreToolUse stamped for it, as a shared process's do.
   */
  async mcpHello(fd: number | undefined, claimed: { pid: number; start: string } | undefined, paseo?: string): Promise<{ session: string | null; parent?: { pid: number; start: string } }> {
    let hook: string | undefined;
    try { hook = deepHook(); } catch { /* no deep-hook here to ask the OS: no peer */ }
    const peer = hook && fd !== undefined && fd >= 0 ? await peerOf(hook, fd) : undefined;
    const at = async (pid: number | undefined) => { const start = pid === undefined ? undefined : await this.startOf(pid, true); return start ? { pid: pid!, start } : undefined; };
    const serves = (p: { pid: number; start: string } | undefined) => p !== undefined && [...this.sessions.values()].some((s) => s.pid === p.pid && s.start === p.start && !s.ended);
    const own = peer !== undefined && [...this.sessions.values()].some((s) => s.pid === peer) ? await at(peer) : undefined;
    const parent = peer === undefined ? claimed : serves(own) ? own : await at(await parentOf(peer));
    return this.options.schedule.queue(async () => {
      // A server paseo's plugin added names its agent's session by the token the plugin's checked lines carry (#55).
      const bound = paseo ? this.options.delivery().binds.get(paseo) : undefined;
      if (bound && !this.sessions.get(bound)?.ended) return { session: bound };
      if (peer === undefined || !parent) return { session: null, ...(parent ? { parent } : {}) };
      const served = [...this.sessions.values()].filter((s) => s.pid === parent.pid && s.start === parent.start && !s.ended);
      // A Codex process may run another thread at any time: each of its calls binds by its own stamp.
      return { session: served.length === 1 && !manyThreads(served[0]!.agent) ? served[0]!.id : null, parent };
    });
  }

  /**
   * The sessions' rows as a phone can afford them (#1576): every live one, then the 25 newest settled, by where each
   * settled (its last turn stopped, or it ended since its state last moved), with `rest` and `next` as the inbox's. One
   * paseo runs whose answer no route could carry reads "answer waiting" (#55).
   */
  async sessionRows(seen = '', params: Obj = {}): Promise<Obj> {
    const raw: RecordStore['raw'] = (q, values) => this.options.services.record.raw(q, values);
    // A reader sees a session whose events it may see (#1337); a session that ended without a turn ending settles there.
    const visible = seen ? ` AND id IN (SELECT session_id FROM events WHERE session_id IS NOT NULL${seen})` : '';
    const table = `(SELECT sessions.*, coalesce(ended_log_pos, (SELECT max(log_pos) FROM events WHERE session_id = sessions.id AND kind = 'session.end' AND log_pos > coalesce(sessions.status_at, 0))) AS settled_at FROM sessions WHERE 1${visible})`;
    const older = (at: { at: number; id: string }) => ['settled_at IS NOT NULL AND (settled_at < ? OR (settled_at = ? AND id < ?))', [at.at, at.at, at.id]] as const;
    const from = params.page === undefined ? undefined : cursorAt(params.page);
    let found: Record<string, unknown>[];
    let next: string | null = null;
    let rest = 0;
    // The planted wrong program reads every session's row, whatever the params.
    if (this.options.settings.plant === 'reads-every-row') found = (await raw(`SELECT * FROM ${table} ORDER BY id`)) as Record<string, unknown>[];
    else {
      const live = from ? [] : (await raw(`SELECT * FROM ${table} WHERE settled_at IS NULL ORDER BY id`)) as Record<string, unknown>[];
      const [where, at] = from ? older(from) : ['settled_at IS NOT NULL', []];
      const settled = (await raw(`SELECT * FROM ${table} WHERE ${where} ORDER BY settled_at DESC, id DESC LIMIT ?`, [...at, SETTLED_PAGE])) as Record<string, unknown>[];
      const last = settled.at(-1);
      if (last) {
        const after = { at: Number(last.settled_at), id: String(last.id) };
        const [w, a] = older(after);
        rest = Number(((await raw(`SELECT count(*) AS n FROM ${table} WHERE ${w}`, [...a])) as { n: number }[])[0]!.n);
        if (rest) next = cursorOf(after.at, after.id);
      }
      found = [...live, ...settled];
    }
    // Its integers as the sessions table gives them, which the wire writes as decimal text.
    const rows = found.map(({ settled_at: _, ...row }) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'number' ? BigInt(v) : v])));
    for (const id of [...this.options.delivery().answerWaiting]) if (!(await this.options.delivery().answers.waitingFor(id)).length) this.options.delivery().answerWaiting.delete(id);
    // The session map (#352): each session's repo, branch, issue and changed files, the commands it runs now, its leases and its state.
    const leases = (await this.options.services.record.raw(`SELECT kind, key, holder FROM leases WHERE state = 'held'`)) as { kind: string; key: string; holder: string }[];
    const sessions = rows.map((row) => {
      const id = String(row.id);
      const placed = this.options.services.siblings.row(id);
      const map = placed && {
        ...placed, running: [...(this.live.get(id)?.calls.values() ?? [])].filter((c) => c.ended === undefined).map((c) => c.what),
        leases: leases.filter((l) => l.holder === `session:${letters(id)}`).map((l) => `${l.kind} ${l.key}`), state: row.status,
      };
      // A session DeepBuild started shows its run and what its agent's own sandbox holds (#1330).
      const started = this.options.services.sessionStarts.rowOf(id);
      return { ...row, ...(started ? { run: started.run, sandbox: started.sandbox } : {}), ...(map ? { map } : {}), ...(this.options.delivery().answerWaiting.has(id) ? { delivery: 'answer waiting: neither deep-hook\'s waiter nor paseo\'s plugin can carry it, so it goes with the session\'s next prompt' } : {}) };
    });
    return { sessions, rest, next };
  }

  /**
   * The list's rows (#1463), a person's only of the sessions they may see (#1338), with each session's detail for deep
   * status when `detail` asks for it.
   */
  async rowsSeen(role: string, detail: boolean): Promise<Obj> {
    let rows = (await listRows(this.options.services.raw)).map((p) => p.row);
    const seen = role.startsWith('person:') ? this.seenBy(role) : '';
    if (seen) {
      const visible = new Set(((await this.options.services.record.raw(`SELECT DISTINCT session_id AS id FROM events WHERE session_id IS NOT NULL${seen}`)) as { id: string }[]).map((r) => r.id));
      rows = rows.filter((r) => visible.has(r.session));
    }
    return { rows, ...(detail ? { detail: Object.fromEntries((await this.statusSeen(role)).map((r) => [`session:${r.id}`, r])) } : {}) } as unknown as Obj;
  }

  /** deep status's rows, a person's only of the sessions they may see (#1338). */
  /**
   * A five-hour reading the status line forwarder sent with the session its input names (#1296): kept for that
   * session's row alone, and only for a session the hub has met through its hooks.
   */
  sessionWindow(params: Obj): void {
    const five = isObj(params.rate_limits) && isObj(params.rate_limits.five_hour) ? params.rate_limits.five_hour : undefined;
    if (typeof params.session !== 'string' || !this.sessions.has(params.session) || typeof five?.used_percentage !== 'number') return;
    this.windowOf.set(params.session, { used: five.used_percentage, resets: typeof five.resets_at === 'number' ? five.resets_at * 1000 : null });
  }

  async statusSeen(role: string): Promise<StatusRow[]> {
    const rows = await statusRows(this.options.services.raw, this.options.services.now());
    for (const row of rows) {
      const own = this.windowOf.get(row.id);
      const unread = row.readings?.[0]?.startsWith(UNREAD_WINDOW);
      // The planted wrong programs: a session with no reading shows 0%, or the newest reading another session sent.
      const carried = this.options.settings.plant === 'window-carried-from-other-repo' && unread ? [...this.windowOf.values()].at(-1) : undefined;
      const shown = own ?? carried ?? (this.options.settings.plant === 'window-unknown-as-zero' && unread ? { used: 0, resets: null } : undefined);
      if (shown) row.readings = [`5 h · ${Math.max(0, 100 - shown.used)}% left${shown.resets ? ` · resets ${clockTime(shown.resets)}` : ''}`, ...(row.readings ?? []).filter((r) => !r.startsWith(UNREAD_WINDOW))];
    }
    const seen = role.startsWith('person:') ? this.seenBy(role) : '';
    if (!seen) return rows;
    const visible = new Set(((await this.options.services.record.raw(`SELECT DISTINCT session_id AS id FROM events WHERE session_id IS NOT NULL${seen}`)) as { id: string }[]).map((r) => r.id));
    return rows.filter((row) => visible.has(row.id));
  }

  /**
   * The events a reader may see, as SQL (#1337): a person reads their own personal scope and the projects they are
   * on; the owner reads everything but another person's personal scope. With nobody else on the hub, everything.
   */
  seenBy(role: string): string {
    if (!this.options.services.people.any) return '';
    const person = role.startsWith('person:') ? role.slice('person:'.length) : OWNER;
    if (person === OWNER) return ` AND scope NOT LIKE 'person:%'`;
    // The planted wrong program: a person's reads without the filter.
    if (this.options.settings.plant === 'reads-unfiltered') return '';
    const scopes = [`person:${person}`, ...[...this.options.services.people.projects(person)].map((p) => `repo:${p}`)];
    return ` AND scope IN (${scopes.map((x) => `'${sql(x)}'`).join(',')})`;
  }

  /**
   * The peer check: the agent session whose process is above the caller's, by PID and start time as that session's
   * hooks established them. It decides whose session a deep command acts as, never whether an answer counts.
   */
  agentAbove(peer: CallContext['peer']): Promise<string | undefined> {
    return this.readAgentAbove(peer).catch(() => undefined);
  }

  /** A failed OS read is not a cached absence of a parent; public peer checks still refuse it as before. */
  private async readAgentAbove(peer: CallContext['peer']): Promise<string | undefined> {
    if (!peer) return undefined;
    // Only a session of another process can be above it (a process table has no cycles): with none, the table isn't read;
    // with one, the caller's start and the table are read together, not one ps after the other (#2328).
    const others = [...this.sessions.values()].some((s) => s.pid > 1 && s.pid !== peer.pid);
    const [actual, up] = await Promise.all([this.startOf(peer.pid, true), others ? parents() : undefined]);
    if (!actual) throw Error('the peer process start could not be read');
    if (actual !== peer.start || !up) return undefined;
    if (!up.has(peer.pid)) throw Error('the peer process is missing from the process table');
    const seen = new Set<number>();
    for (let pid = up.get(peer.pid); pid !== undefined && pid > 1 && !seen.has(pid); pid = up.get(pid)) {
      seen.add(pid);
      // A PID another process now holds, with a start time no session recorded (#806's test seam): no agent's tree.
      if (reusedPids().includes(pid)) continue;
      // After a `/clear` the process's session is its newest one.
      const session = [...this.sessions.values()].filter((s) => s.pid === pid).at(-1);
      // A start that can't be read (ps failing under load) proves nothing: the session's process still running counts.
      const start = session ? await this.startOf(pid, true) : undefined;
      if (session && (start === undefined ? running(pid) : start === session.start)) return session.id;
    }
    return undefined;
  }

  /** What feeds your numbers or labels is yours to run: an agent's word is never evidence. */
  async notAnAgent(context: CallContext, method: string): Promise<void> {
    const agent = await this.agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `Nothing changed: this deep command runs inside agent session ${agent}'s process tree, and no agent feeds its own numbers. Run it from your own terminal.`, method));
  }
}
