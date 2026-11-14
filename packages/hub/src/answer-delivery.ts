import type { HubEvents, HubRuntime, HookSchedule } from './hub-capabilities.js';
import type { StopJudgingPort, SessionMemoryPort, SessionStatePort, McpOperationsPort, HubControlPort } from './hub-ports.js';
import { execFile } from 'node:child_process';
import { constants, realpathSync } from 'node:fs';
import { access } from 'node:fs/promises';

import { subjectKey, type Asks, type Delivery, type Resolver } from '@deepbuild/asks';

import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { scrubText } from '@deepbuild/evidence';

import { type Connection, type RecordStore } from '@deepbuild/record';

import { piAcceptsReplaced } from './plant.js';

import { Acceptance } from './acceptance.js';

import { CONTINUATION_CAP } from './claude-settings.js';

import { AskTasks } from './ask-tasks.js';

import { Holds } from './holds.js';

import { registry } from './hookmap.js';

import { forgeOf, type Root } from './paths.js';

import { aboutPermission, type About } from './standing.js';

import { Forge } from './forge.js';

import { blockedCause, blockedReading, dueReading, ownerOf, promisesIn, setPromise, promiseToken, wakeText, type PromiseState } from './promises.js';
import { Answers, answerText, type Answer } from './answers.js';

import { plantedSessionEnd } from './plant.js';

import { Hosts } from './hosts.js';
import { Jobs } from './jobs.js';
import { Libraries } from './libraries.js';

import { refuse, Refused, refusal, ulid, ulidTime, type CoreOptions, type Draft, type HookMeta } from './wire.js';
import type { CallContext, Routes, CutOff, Note } from './session-types.js';

import { TranscriptReader } from './transcript-reader.js';
import { letters, ghToken, WAKE_GRACE, SHOWN_SOON, said, FOREIGN, placesItself, type Obj, isObj, asRefused, effectEntries, callOf, sendKey, PULL_LOOKUP_MS, OWN_TURN, continueText } from "./hub-shared.js";

export interface AnswerDeliveryOptions {
  settings: CoreOptions;
  services: {
    readonly now: () => number;
    readonly asks: Asks;
    readonly record: RecordStore;
    readonly libraries: Libraries | undefined;
    readonly jobKinds: Jobs | undefined;
    readonly hosts: Hosts;
    readonly tasks: AskTasks;
    readonly acceptance: Acceptance;
    readonly root: Root;
    readonly transcriptReader: TranscriptReader;
    readonly holds: Holds;
  };
  state: () => Pick<SessionStatePort, "acks" | "attention" | "live" | "midTurn" | "onScreen" | "projects" | "sessions" | "turnsStarted">;
  mcp: () => Pick<McpOperationsPort, "pinOf">;
  judging: () => Pick<StopJudgingPort, "delivery" | "landedLine" | "lineStanding" | "openedPr">;
  control: () => Pick<HubControlPort, "trusted">;
  memory: () => Pick<SessionMemoryPort, "syncStanding">;
  events: Pick<HubEvents, "appendSession" | "appendReading" | "connection" | "append">;
kernel: Pick<HubRuntime, "stopping" | "ready">;
schedule: Pick<HookSchedule, "queue" | "askingSoon" | "abandoned">;

}

/** AnswerDelivery: owns its domain state; services are resolved only when used. */
export class AnswerDelivery {
  constructor(private readonly options: AnswerDeliveryOptions) {}

  /** Your switches from a provisional ask's option, in flight: the commits made under the old one (#84). */
  readonly switches = new Map<string, string[]>();

  /** The log position of the last session.continued the hub routed (#85). */
  continuedPos = 0;

  /** The sends each session's cut-off turn started with no recorded end (#85), by the key an identical call matches: denied at PreToolUse with the earlier result. */
  readonly unknownSends = new Map<string, Map<string, { label: string; pr: boolean; denied?: boolean; done?: boolean }>>();

  /** The continues being read, one reading at a time, so the timer's and a prompt's never carry the same one twice. */
  private continuing: Promise<void> = Promise.resolve();

  /** deep_wait and deep_run calls, by the ask or run they wait on, each woken by the event that settles it (#823). */
  readonly settling = new Map<string, Set<() => void>>();

  /** Each session's routes back into it, by session ID. */
  readonly routes = new Map<string, Routes>();

  /**
   * Answers handed to a route that no turn has shown yet, by ask ID (#906): to a waiter, or in a hook's reply (`hook`,
   * the event's ID), whose session's transcript says whether deep-hook got it in time.
   */
  readonly handed = new Map<string, { session: string; at: number; timer: NodeJS.Timeout; via: 'wake' | 'next_prompt' | 'stop_hold'; hook?: string }>();

  /** Answers whose delivery timed out because their session couldn't be read, by ask ID, with the session. */
  readonly unread = new Map<string, string>();

  /**
   * Notes from the app (#340): those waiting for a route into their session, by session; those handed to a waiter
   * that no turn has shown yet, by request ID; and those a prompt's hook carries as its context, for its reply.
   */
  private readonly notes = new Map<string, Note[]>();

  private readonly handedNotes = new Map<string, Note & { timer: NodeJS.Timeout }>();

  readonly carried = new Map<string, Note[]>();

  /** The asks raised for permission prompts and saved offers, by handle: their answer is never delivered as a message (#23). */
  readonly prompts = new Set<string>();

  answers!: Answers;

  /** paseo's plugin (#55): the token each agent's DeepBuild MCP server binds by, to the agent's own session. */
  readonly binds = new Map<string, string>();
  readonly tokenBound = new Set<string>();

  /** The sessions paseo runs that another adapter gates: a permission prompt there shows in paseo, not a terminal. */
  private readonly inPaseo = new Set<string>();

  /** The ask each permission request paseo's plugin sent became, by session and request ID. */
  private readonly paseoRequests = new Map<string, string>();

  /** A permission prompt held for its ask's answer, by the ask. */
  private readonly permits = new Map<string, (delivery: Delivery) => void>();

  /** Sessions paseo runs whose answer no route could carry: their rows read "answer waiting". */
  readonly answerWaiting = new Set<string>();

  /** Prompts no decision covered, by session and what the call is, until the call runs and is offered back (#23). */
  private readonly pending = new Map<string, { meta: HookMeta; about: About }>();

  /** Permissions you said yes to in the terminal, offered back as decisions to save, by handle (#23). */
  private readonly offers = new Map<string, { meta: HookMeta; about: About; scope: string }>();

  /** The typed-saves-decision plant's sessions you typed words in. */
  readonly typedAt = new Map<string, number>();

  /** Each session's promised check (#120): its state as the record has it, the timer for its due time, and whether its one ask was raised. */
  readonly promises = new Map<string, PromiseState & { timer?: NodeJS.Timeout | undefined; asked?: boolean; handed?: boolean }>();

  /** resolver-decisions with no ledger, asked whether a saved decision covers a prompt before anything is raised (#23). */
  precheck!: Resolver;

  /** The asks a running deep_ask or deep_wait of a session whose package places answers will return itself. */
  readonly askWaits = new Map<string, string>();

  /** Held stops, each woken when an answer for its session is ready to deliver. */
  readonly waiting = new Map<string, Set<() => void>>();

  /** A change that no longer merges goes back to its own attempt (#1331): each session that worked its issue hears it, and no person is asked. */
  async landingSendBack(r: { checkout: string; issue: number; pr: number; files: string[]; text: string }): Promise<void> {
    const rows = (await this.options.services.record.raw(`SELECT DISTINCT json_extract(data, '$.session') AS session FROM events WHERE kind = 'start.session' AND json_extract(data, '$.run') IN
      (SELECT subject FROM events WHERE kind = 'start.started' AND json_extract(data, '$.issue') = ? AND json_extract(data, '$.repo') = ?)`, [r.issue, realpathSync(r.checkout)])) as { session: string | null }[];
    for (const { session } of rows) {
      const live = session ? this.options.state().live.get(session) : undefined;
      if (session && live) { this.later(session, live.cwd, r.text); this.offer(session); }
    }
  }

  /** Words for an agent whose hooks take no context: carried by its next prompt. */
  later(session: string, cwd: string, text: string): void {
    this.routesOf(session, cwd).later.push(text);
  }

  /**
   * The checks a stop's last message promises for later: the first sets the session's wake-up, or sets it again,
   * keeping its first end; a wake-up never sets itself again. A promise set a fourth time, or due past its end, is
   * BLOCKED with its owner and at most one ask, and no further wake-up fires.
   */
  async promised(meta: HookMeta): Promise<void> {
    const text = meta.fields?.last_assistant_message;
    if (!text) return;
    const now = this.options.services.now();
    const [next] = promisesIn(text, now);
    if (!next) return;
    const current = this.promises.get(meta.session);
    // BLOCKED stands until the session ends: no further wake-up is set, and the one ask is not asked again.
    if (current?.status === 'blocked') return;
    clearTimeout(current?.timer);
    const state = setPromise(current, next, ulid(now));
    const entry = { ...state, timer: undefined, asked: current?.asked ?? false };
    this.promises.set(meta.session, entry);
    if (state.status === 'blocked') return this.promiseBlocked(meta.session, meta.agent, meta.cwd, entry);
    await this.options.events.appendSession(meta.session, meta.agent, 'promise.set', { promise: state.id, quote: state.quote, due: state.due, times_set: state.set, end: state.end });
    this.armPromise(meta.session);
  }

  /** One timer per promise, for its due time; nothing polls, so an idle session costs no CPU while it waits. */
  private armPromise(session: string): void {
    const p = this.promises.get(session);
    if (!p || p.status !== 'set' || this.options.kernel.stopping) return;
    clearTimeout(p.timer);
    p.timer = setTimeout(() => void this.options.schedule.queue(() => this.promiseDue(session)).catch(() => undefined), Math.min(Math.max(0, p.due - this.options.services.now()), 2 ** 31 - 1));
    p.timer.unref();
  }

  /**
   * A promise's due time: where the session has shown it can be woken when idle (Claude Code's waiter), the wake-up
   * starts a turn now; elsewhere, as in Codex, whose hooks never start a turn, it starts nothing: the session's row
   * shows it due, and its next prompt or stop carries it. The route is the session's shown routes, never the agent's name.
   */
  private async promiseDue(session: string): Promise<void> {
    const p = this.promises.get(session);
    if (!p || p.status !== 'set' || this.options.kernel.stopping) return;
    if (p.due > this.options.services.now()) return this.armPromise(session);
    const agent = this.options.state().sessions.get(session)?.agent ?? this.options.state().live.get(session)?.agent ?? 'claude-code';
    const r = this.routes.get(session);
    // A session stopped on a cause whose task is open isn't woken for it (#85): the check goes with the resume.
    const idle = r !== undefined && r.waiter !== undefined && r.covered && r.shown.has('waiter') && r.wakes !== false && !r.holding && !r.blocked && r.busy < r.waiter.since;
    await this.options.events.appendSession(session, agent, 'promise.due', { promise: p.id, due: p.due, route: idle ? 'wake' : 'next_hook' });
    p.status = 'due';
    if (idle && r.waiter) return this.handPromise(session, p, r);
    await this.options.events.appendReading(session, agent, dueReading(p));
    // The event loop holds this session's next stop for it.
    this.options.schedule.askingSoon();
  }

  /**
   * The wake-up handed to the session's waiter: woken only once the wake's prompt shows it (the `promise:<id>` token
   * in the waiter's text). A wake that shows no turn within the grace reads stalled, as an ask's does: the route is
   * marked as not waking, the row shows the check due, and the session's next prompt or stop carries it.
   */
  private handPromise(session: string, p: PromiseState & { timer?: NodeJS.Timeout | undefined; handed?: boolean }, r: Routes): void {
    const waiter = r.waiter;
    if (!waiter) return;
    r.waiter = undefined;
    p.handed = true;
    waiter.give({ session, text: wakeText(p) });
    this.armPromiseGrace(session, p, WAKE_GRACE);
  }

  private armPromiseGrace(session: string, p: PromiseState & { timer?: NodeJS.Timeout | undefined }, inMs: number): void {
    if (this.options.kernel.stopping) return;
    clearTimeout(p.timer);
    p.timer = setTimeout(() => void this.options.schedule.queue(() => this.promiseUnwoken(session, p.id)).catch(() => undefined), Math.max(0, inMs));
    p.timer.unref();
  }

  private async promiseUnwoken(session: string, id: string): Promise<void> {
    const p = this.promises.get(session);
    if (!p || p.id !== id || p.status !== 'due' || p.handed !== true) return;
    p.handed = false;
    const agent = this.options.state().sessions.get(session)?.agent ?? 'claude-code';
    const r = this.routes.get(session);
    // A route never seen working counts as absent: this session's promised checks wait for its next prompt or stop.
    if (r && r.wakes !== true) r.wakes = false;
    await this.options.events.appendSession(session, agent, 'promise.due', { promise: p.id, due: p.due, route: 'next_hook' });
    await this.options.events.appendReading(session, agent, `Claude Code didn't wake this session for its promised check: its waiter handed it over and no turn started. ${dueReading(p)}`);
    this.options.schedule.askingSoon();
  }

  /** The due promise a session's prompt or stop carries, taken once, with how it went. */
  async promiseCarried(session: string, via: 'next_prompt' | 'stop_hold', prompt = ''): Promise<string | undefined> {
    const p = this.promises.get(session);
    if (!p || p.status !== 'due') return undefined;
    p.status = 'woken';
    const agent = this.options.state().sessions.get(session)?.agent ?? 'claude-code';
    // The wake's own prompt, carrying the text the waiter was handed, proves the wake; any other hook carries the check
    // itself. Only a handed wake text carries this set's token, so a late wake (its prompt after the grace) still proves
    // the route, and a typed prompt that lands while the wake is queued finds it in the transcript, as an ask's does.
    const token = promiseToken(p);
    const stalled = p.handed === false;
    const woke = via === 'next_prompt' && (prompt.includes(token) || (p.handed !== undefined && await this.woken(session, token)));
    clearTimeout(p.timer);
    const r = this.routes.get(session);
    if (woke && r) r.wakes = true;
    await this.options.events.appendSession(session, agent, 'promise.woken', { promise: p.id, via: woke ? 'waiter' : via }).catch(() => undefined);
    if (woke && stalled) await this.options.events.appendReading(session, agent, 'Claude Code woke this session for its promised check after all; the check goes with that wake\'s turn.').catch(() => undefined);
    this.options.schedule.askingSoon();
    return woke ? undefined : wakeText(p);
  }

  promiseDueFor(session: string): boolean { return this.promises.get(session)?.status === 'due'; }

  private async promiseBlocked(session: string, agent: string, cwd: string, p: PromiseState & { asked?: boolean }): Promise<void> {
    const owner = ownerOf(p.quote);
    let ask: string | null = null;
    if (!p.asked) {
      p.asked = true;
      const question = `The agent's promised check is BLOCKED (${blockedCause(p) === 'set_again' ? `promised ${p.set} times` : 'promised past its end'}; owner: ${owner}): "${p.quote}" Do the check yourself, or drop it?`;
      const options = [{ id: 'take', label: 'I will do the check', decision: 'none' }, { id: 'drop', label: 'Drop it', decision: 'none' }];
      const raised = { kind: 'choice', question, options, recommended: 'drop', fallback: 'you', provisional: false, owner: 'you', key: sha256Hex(canonicalize({ kind: 'promise', session, quote: p.quote } as JsonValue)), pinned_to: await this.options.mcp().pinOf(cwd, question) };
      ask = await this.options.services.asks.raise(this.options.events.connection('core', { session, agent }), 'promise.blocked', raised).catch(() => null);
    }
    await this.options.events.appendSession(session, agent, 'promise.blocked', { promise: p.id, status: 'BLOCKED', quote: p.quote, cause: blockedCause(p), owner, ask });
    await this.options.events.appendReading(session, agent, blockedReading(p, owner));
    await this.options.state().attention(session, agent, 'stuck');
  }

  /** The promises the record holds that still wait, after a restart: each set one is armed again, each due one waits for its hook. */
  async restorePromises(): Promise<void> {
    const rows = (await this.options.services.record.raw(`SELECT session_id AS session, kind, data, ts FROM events WHERE kind IN ('promise.set', 'promise.due', 'promise.woken', 'promise.blocked', 'session.end') AND session_id IS NOT NULL ORDER BY log_pos`)) as { session: string; kind: string; data: string | Obj; ts: number }[];
    const handedAt = new Map<string, number>();
    for (const row of rows) {
      // A session's end takes its promise with it: nothing wakes a session that is gone.
      if (row.kind === 'session.end') { this.promises.delete(row.session); continue; }
      const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Obj;
      const p = this.promises.get(row.session);
      if (row.kind === 'promise.set') this.promises.set(row.session, { id: String(d.promise), quote: String(d.quote), due: Number(d.due), set: Number(d.times_set), end: Number(d.end), status: 'set', timer: undefined, asked: p?.asked ?? false });
      else if (p && p.id === d.promise) {
        p.status = row.kind === 'promise.due' ? 'due' : row.kind === 'promise.woken' ? 'woken' : 'blocked';
        p.handed = row.kind === 'promise.due' && d.route === 'wake';
        if (p.handed) handedAt.set(row.session, Number(row.ts));
      }
      if (row.kind === 'promise.blocked' && p) p.asked = true;
    }
    for (const [session, p] of this.promises) {
      if (p.status === 'set') this.armPromise(session);
      else if (p.status === 'due' && p.handed) this.armPromiseGrace(session, p, WAKE_GRACE - (this.options.services.now() - (handedAt.get(session) ?? this.options.services.now())));
      else if (p.status === 'due') this.options.schedule.askingSoon();
    }
  }

  /**
   * Your words from the app at a prompt's hook (#340), each recorded `from: app` with its request ID: a note its
   * waiter handed over, which the wake's prompt carries, is that prompt's own ask; one still waiting goes as this
   * prompt's context, an ask beside the prompt's. They are matched by request ID, never by their words.
   */
  appNotes(drafts: Draft[], session: string): void {
    const at = drafts.findIndex((d) => d.kind === 'user.ask' && !d.queued);
    if (at < 0) return;
    const prompt = drafts[at]!;
    const draft = (note: Note): Draft['data'] => {
      const text = scrubText(note.text, { held: this.options.settings.held }).slice(0, 8000);
      // The planted wrong program takes the app's words for yours, with no request ID.
      if (this.options.settings.plant === 'app-note-as-person') return { msg: 0, text, tasks: [], from: 'person' };
      // Recorded as the session reads them, with their request ID, so the same words typed are never the note.
      return { msg: 0, text: `${text} (request ${note.request})`, tasks: [], from: 'app', request: note.request };
    };
    const woke = [...this.handedNotes.values()].filter((n) => n.session === session && String(prompt.data.text).includes(`(request ${n.request})`));
    for (const note of woke) {
      clearTimeout(note.timer);
      this.handedNotes.delete(note.request);
    }
    const waiting = this.notes.get(session)?.splice(0) ?? [];
    if (waiting.length) this.carried.set(session, [...(this.carried.get(session) ?? []), ...waiting]);
    const asks = waiting.map((note): Draft => {
      const ts = this.options.services.now();
      return { kind: 'user.ask', v: 1, id: ulid(ts), ts, data: draft(note), fill: 'msg', queued: true };
    });
    const [first, ...rest] = woke;
    // The planted wrong program delivers a waiter's note and records nothing for it.
    if (first && this.options.settings.plant === 'app-note-unrecorded') drafts.splice(at, 1);
    else if (first) {
      prompt.data = draft(first);
      const live = this.options.state().live.get(session);
      if (live) live.from = String(prompt.data.from);
      for (const note of rest) {
        const ts = this.options.services.now();
        asks.push({ kind: 'user.ask', v: 1, id: ulid(ts), ts, data: draft(note), fill: 'msg', queued: true });
      }
    }
    drafts.push(...asks);
    // The planted wrong program lets a note's yes answer the session's open authority ask, as the trusted path would.
    if (this.options.settings.plant === 'app-note-answers-authority' && [...woke, ...waiting].some((n) => /\b(?:yes|approve|go ahead)\b/i.test(n.text))) void this.noteAnswers(session).catch(() => undefined);
  }

  /** The app-note-answers-authority plant: the session's open authority asks answered with their allowing option. */
  private async noteAnswers(session: string): Promise<void> {
    const rows = (await this.options.services.record.raw(`SELECT id, options FROM asks WHERE session_id = ? AND kind = 'authority' AND status IN ('open', 'later')`, [session])) as { id: string; options: string | null }[];
    for (const row of rows) {
      const option = (JSON.parse(row.options ?? '[]') as { id: string; decision?: string }[]).find((o) => o.decision === 'allow');
      if (option) await this.options.services.asks.answer(this.options.events.connection('app'), `ask:${row.id}`, { option: option.id, plan_hash: (await this.options.services.asks.card(`ask:${row.id}`)).plan?.hash ?? null, token: `os-confirm:${ulid(this.options.services.now())}` });
    }
  }

  /** The notes as the agent reads them, each labelled as yours, sent from the app, with its request ID. */
  noteText(notes: Note[]): string {
    return `DeepBuild delivers your words, sent from the app:\n${notes.map((n) => `(request ${n.request}) ${n.text}`).join('\n')}`;
  }

  /** session.note, from the app: your words into a session, by the route its flags allow, as an answer goes (#25). */
  note(params: Obj): Obj {
    const { session, text, request } = params;
    if (typeof session !== 'string' || !session) throw refuse('type', '/params/session', 'Name the session by its ID, as its hooks carry it.', session);
    if (typeof text !== 'string' || !text.trim() || text.length > 8192) throw refuse('type', '/params/text', 'Send the note\'s words as a string of 1 to 8192 characters.', text);
    if (typeof request !== 'string' || !/^[0-9A-Za-z_-]{1,64}$/.test(request)) throw refuse('type', '/params/request', 'Give the delivery\'s request ID: 1 to 64 letters, digits, - or _.', request);
    if (!this.options.state().live.has(session)) throw refuse('not_found', '/params/session', `No session ${session} has reached the hub; send the note to one deep status lists.`, session);
    // A request ID applies once: a retried send changes nothing.
    const known = [...(this.notes.get(session) ?? []), ...this.handedNotes.values()].some((n) => n.request === request);
    if (!known) {
      this.notes.set(session, [...(this.notes.get(session) ?? []), { session, text, request }]);
      // Your words, sent while a turn runs or between turns: the next green turn end starts a loop's held checks (#965).
      if (this.options.settings.plant !== 'words-only-at-turn-start') this.options.state().live.get(session)!.words = 'words';
      this.offer(session);
    }
    return { session, request };
  }

  // ---- Answers back to a session (#25): through a held stop, its waiter, or the context of its next prompt or start.

  /** What a session has shown of the routes back into it since it last started, its holds, waiter and continuations. */
  routesOf(session: string, cwd = ''): Routes {
    let r = this.routes.get(session);
    if (!r) this.routes.set(session, r = { cwd, shown: new Set(), covered: true, holding: 0, busy: 0, ended: 0, continued: 0, capped: false, sendBacks: [], later: [] });
    return r;
  }

  /**
   * What each hook shows of its session's routes, read as it arrives, before the record has it: a hook of ours that
   * fired on a version the facts cover counts its route; a tool call or a prompt starts the turn's count again and
   * shows a turn running, from when its hook started; a session's end retires its waiter.
   */
  track(meta: HookMeta): void {
    if (!meta.session || FOREIGN.has(meta.agent)) return;
    if (meta.event === 'SessionStart') {
      // What a session has shown resets only when it starts again.
      const before = this.options.settings.plant === 'routes-kept-across-sessions' ? [...this.routes.values()].reverse().find((r) => r.cwd === meta.cwd) : undefined;
      const fresh: Routes = { cwd: meta.cwd, shown: before ? before.shown : new Set(), covered: true, holding: 0, busy: 0, ended: 0, continued: 0, capped: false, sendBacks: [], later: [] };
      const old = this.routes.get(meta.session);
      if (old?.waiter) fresh.waiter = old.waiter;
      // A continue parked for the next prompt goes with the first prompt after a resume (#85); a clear or a
      // compaction starts a new session ID, and the cleared one's continues end with it.
      if (old) fresh.later = [...(old.handed ?? []), ...old.later];
      if (old?.places) fresh.places = true;
      this.routes.delete(meta.session);
      this.routes.set(meta.session, fresh);
    }
    const r = this.routesOf(meta.session, meta.cwd);
    r.covered = !meta.watchOnly;
    if (r.covered && !(this.options.settings.plant === 'routes-kept-across-sessions' && r.shown.size)) r.shown.add(meta.event);
    if (meta.parent) void this.options.schedule.queue(() => this.placeOrRefuse(meta.parent!)).catch(() => undefined);
    if (meta.event === 'PreToolUse') {
      if (this.options.settings.plant !== 'stop-count-never-resets') r.continued = 0;
      r.capped = false;
    }
    // A turn running, or a prompt you typed, is the session yours again: its stop's hold on DeepBuild's turns ends (#85).
    if (meta.event === 'UserPromptSubmit' || meta.event === 'PreToolUse' || meta.event === 'PostToolUse') r.blocked = undefined;
    if (meta.event === 'SessionEnd') {
      plantedSessionEnd(this.options.settings.plant, meta.session);
      if (this.options.settings.plant !== 'waiter-outlives-session') r.waiter?.give({ exit: 'session ended' });
      this.routes.delete(meta.session);
      // Its parked continues wait for the session to be resumed (#85), in an entry of no folder, so nothing reads
      // it as the folder's last session.
      if (r.later.length || r.handed?.length) this.routesOf(meta.session).later = [...(r.handed ?? []), ...r.later];
      // A call running as its session quit returns to nobody: its answer waits for the session's resume.
      for (const [ask, waiting] of this.askWaits) if (waiting === meta.session) this.stopAskWait(ask);
      const promise = this.promises.get(meta.session);
      clearTimeout(promise?.timer);
      this.promises.delete(meta.session);
      for (const map of [this.options.state().acks, this.options.state().midTurn, this.carried, this.options.state().turnsStarted, this.options.state().onScreen]) map.delete(meta.session);
    } else if (meta.event === 'StopFailure') {
      // A turn that ends on an API error ends like a Stop, and Claude Code starts its waiter as at a Stop; one an
      // earlier stop started may still wait, and either may wake the idle session (#85). Only the newest turn's: a prompt you
      // queued may start before the failed turn's hook is stamped, and one that names no turn ends none.
      if (!meta.fields?.agent_id && meta.fields?.prompt_id !== undefined && meta.fields.prompt_id === r.prompt) r.ended = Math.max(r.ended, ulidTime(meta.id));
    // A notification shows no turn running: Claude Code sends one at an idle prompt too (#992).
    } else if (meta.event !== 'Stop' && meta.event !== 'SessionStart' && meta.event !== 'Notification') r.busy = Math.max(r.busy, ulidTime(meta.id));
    if (meta.event === 'UserPromptSubmit') r.prompt = meta.fields?.prompt_id;
  }

  /** Claude Code's cap on stop-hook continuations in one turn, from its facts. */
  cap(): number {
    const continuation = (registry().get('claude').facts as Obj).continuation;
    return isObj(continuation) && typeof continuation.cap === 'number' ? continuation.cap : CONTINUATION_CAP;
  }

  /**
   * The answers waiting for a session: answered asks of its thread (its ID and those `/clear`, `/compact` or a fork
   * joined to it) not yet delivered, nor handed to its waiter and not yet seen in a turn; or, with `scope`, the
   * answered asks it names.
   */
  async waitingFor(session: string, scope?: string): Promise<Answer[]> {
    return this.answers.waitingFor(session, scope);
  }

  /** The answers as the agent reads them, each naming its ask. */
  private answerText(rows: Answer[]): string {
    return answerText(rows, (ask) => this.switches.get(ask));
  }

  async outcome(ask: string, via: string, outcome: 'delivered' | 'stalled' | 'timed_out' | 'replaced' | 'waiting'): Promise<void> {
    return this.answers.outcome(ask, via, outcome);
  }

  /** An answer to a Codex session that ended waits on its task, and only the same thread's resume hears it (#39). */
  private async waitsOnTask(delivery: Delivery): Promise<void> {
    await this.answers.waitsOnTask(delivery);
  }

  /**
   * Each answer handed to a hook's reply once (#906). The session is read first: an answer a turn already shows is
   * recorded delivered and not sent again. The rest are in flight until a turn shows them, read at the session's next
   * prompt or stop, once deep-hook is found gone, or when the grace runs out. A tool's reply (no hook) is delivered now.
   */
  async deliver(rows: Answer[], via: 'next_prompt' | 'stop_hold', hook?: { session: string; id: string }): Promise<string | undefined> {
    if (!rows.length) return undefined;
    // The planted wrong program records the answer delivered as the hub writes its reply.
    if (!hook || this.options.settings.plant === 'delivered-when-written') {
      for (const row of rows) await this.outcome(row.id, via, 'delivered');
      return this.answerText(rows);
    }
    // The planted wrong program keeps no answer in flight, so each later route sends it again without reading the session.
    if (this.options.settings.plant === 'sends-shown-again') return this.answerText(rows);
    // Codex's rollout shows no hook's context, and its facts name no stable format to read one from (#39): its reply is
    // delivered as written, and one deep-hook had already given up on reads stalled and goes by the next route.
    if (this.options.state().sessions.get(hook.session)?.agent === 'codex') {
      const outcome = this.options.schedule.abandoned.has(hook.id) ? 'stalled' : 'delivered';
      for (const row of rows) await this.outcome(row.id, via, outcome);
      return outcome === 'delivered' ? this.answerText(rows) : undefined;
    }
    const shown = await this.shown(hook.session, rows.map((row) => said(row.id)));
    const fresh: Answer[] = [];
    for (const row of rows) {
      if (shown?.has(said(row.id))) await this.outcome(row.id, via, 'delivered');
      else fresh.push(row);
    }
    if (!fresh.length) return undefined;
    const at = Date.now();
    for (const row of fresh) this.handed.set(row.id, { session: hook.session, at, via, hook: hook.id, timer: setTimeout(() => void this.options.schedule.queue(() => this.unwoken(hook.session, row.id)).catch(() => undefined), WAKE_GRACE) });
    // A deep-hook already gone takes no reply: what it would carry goes by the next route.
    if (this.options.schedule.abandoned.has(hook.id)) for (const row of fresh) void this.options.schedule.queue(() => this.unwoken(hook.session, row.id)).catch(() => undefined);
    // Claude Code writes a hook's reply into the transcript as the hook ends, so it is read for again soon after.
    else setTimeout(() => void this.options.schedule.queue(() => this.seen(fresh.map((row) => row.id))).catch(() => undefined), SHOWN_SOON).unref();
    return this.answerText(fresh);
  }

  /** A call held on an ask ran again on your yes, so the session has that answer: its stop needn't be sent back to say it. */
  async heardBy(ask: string): Promise<void> {
    const id = ask.replace(/^ask:/, '');
    if (this.handed.has(id) || (await this.options.services.record.raw(`SELECT 1 FROM deliveries WHERE delivery = ? AND outcome = 'delivered' LIMIT 1`, [id])).length) return;
    await this.outcome(id, 'next_prompt', 'delivered');
  }

  /** Answers still in flight that a turn now shows: delivered; the rest stay in flight (#906). */
  private async seen(asks: string[]): Promise<void> {
    for (const ask of asks) {
      const handed = this.handed.get(ask);
      if (!handed || !await this.woken(handed.session, said(ask))) continue;
      clearTimeout(handed.timer);
      this.handed.delete(ask);
      await this.outcome(ask, handed.via === 'wake' ? 'next_prompt' : handed.via, 'delivered');
    }
  }

  /** An answer the asks core recorded: a stop of its session held now takes it, else its waiter if the session is idle. */
  answered(delivery: Delivery): void {
    // A permission prompt's answer goes back through the prompt it holds (#23).
    this.permits.get(delivery.ask)?.(delivery);
    if (this.prompts.has(delivery.ask)) return;
    // Your answer to a library fetch's authority ask (#1731), which no session raised: a yes runs the fetch's job.
    if (this.options.services.libraries?.answered(delivery.ask, delivery.decision)) return;
    // Your answer to a paid job call's authority ask (#1922): a yes lets that call run once.
    if (this.options.services.jobKinds?.answered(delivery.ask, delivery.decision)) return;
    // Your answer to a host's ask for changes as you there (#1942): a yes lets its runs start, now and later.
    if (this.options.services.hosts.answered(delivery.ask, delivery.decision)) return;
    this.options.services.tasks.answered(delivery);
    this.options.services.acceptance?.answered(delivery);
    this.options.judging().delivery(delivery);
    void this.waitsOnTask(delivery).catch(() => undefined);
    const asker = this.options.state().sessions.get(delivery.session);
    if (placesItself(asker?.agent) || this.routes.get(delivery.session)?.places) return void this.options.schedule.queue(() => this.placeOrRefuse(delivery.session)).catch(() => undefined);
    // Inside paseo, with neither deep-hook's waiter nor paseo's plugin there to take it, the answer waits on the row (#55).
    const route = this.routes.get(delivery.session);
    if (this.inPaseo.has(delivery.session) && !route?.waiter && !route?.relay) this.answerWaiting.add(delivery.session);
    // One the restarted hub hasn't heard from may be a pi session replaced before it, or any idle session whose waiter asked again.
    if (!asker) void this.options.schedule.queue(() => this.placeOrRefuse(delivery.session)).catch(() => undefined);
    if (this.routes.get(delivery.session)?.holding) for (const wake of this.waiting.get(delivery.session) ?? []) wake();
    else this.offer(delivery.session);
  }

  /**
   * Hands what waits for an idle session to its waiter, which exits 2 with it and so wakes the session. Claude Code
   * starts the waiter at a stop, so the session is idle while no stop of it is held (the hold takes the answer) and no
   * hook started since the waiter, or since a StopFailure ended a later turn, shows a turn running; never past the
   * turn's cap (the next prompt does), or once its app has shown it doesn't wake.
   */
  offer(session: string): void {
    const r = this.routes.get(session);
    if (!r) return;
    if (r.places) return void this.options.schedule.queue(() => this.placeOrRefuse(session)).catch(() => undefined);
    // Where deep-hook's own wake isn't there, paseo's plugin prompts the session on its behalf (#55). The planted wrong
    // program hands it over beside a live waiter too.
    if (r.relay && !r.holding && (!r.waiter || this.options.settings.plant === 'paseo-delivers-beside-waiter')) void this.options.schedule.queue(() => this.relayAnswers(session, r)).catch(() => undefined);
    const idle = () => r.waiter !== undefined && !r.holding && r.busy < Math.max(r.waiter.since, r.ended);
    if (!r.covered || !r.shown.has('waiter') || r.capped || r.wakes === false || !idle()) return;
    void this.options.schedule.queue(async () => {
      const waiter = r.waiter;
      if (!waiter || !idle()) return;
      // While the session's newest stop carries a cause whose task is open, no turn DeepBuild causes starts there (#85):
      // an answer, a promised check or a parked line waits on its row and goes with the resume. Only a message you
      // typed goes at once.
      if (r.blocked && !(this.notes.get(session) ?? []).length) return;
      // A promised check that came due before this waiter asked (a hub restarted on the record, the waiter back a
      // moment later) wakes the session now: the route is the waiter's, however the two arrived (#120).
      const p = this.promises.get(session);
      if (p?.status === 'due' && !p.handed) {
        // The hand follows its recorded route, or not at all.
        const agent = this.options.state().sessions.get(session)?.agent ?? 'claude-code';
        await this.options.events.appendSession(session, agent, 'promise.due', { promise: p.id, due: p.due, route: 'wake' });
        await this.options.events.appendReading(session, agent, 'The promised check\'s wake-up is handed to this session\'s waiter.').catch(() => undefined);
        return this.handPromise(session, p, r);
      }
      const rows = await this.waitingFor(session);
      const notes = this.notes.get(session) ?? [];
      if (!rows.length && !notes.length && !r.later.length) return;
      if (this.options.settings.plant === 'waiter-checks-every-5s') {
        // The planted waiter asks every 5 s instead of being told.
        const due = 5000 - ((Date.now() - waiter.at) % 5000);
        setTimeout(() => this.offer(session), due).unref();
        if (due < 4900) return;
      }
      r.waiter = undefined;
      if (this.options.settings.plant === 'waiter-never-wakes') return waiter.give({ exit: 'planted: never wakes' });
      // A continue parked before this waiter connected goes with it too (#85): a first turn that failed had none open.
      const later = r.later.splice(0);
      if (later.length) r.handed = [...(r.handed ?? []), ...later];
      const standing = rows.length ? await this.options.judging().lineStanding(session) : undefined;
      waiter.give({ session, text: [rows.length ? this.answerText(rows) : '', standing ? `DeepBuild: ${standing}` : '', notes.length ? this.noteText(notes) : '', ...later].filter(Boolean).join('\n\n') });
      // A note is your words once a turn shows them: the wake's prompt names its request ID, else it goes by the next prompt.
      for (const note of this.notes.get(session)?.splice(0) ?? []) {
        this.handedNotes.set(note.request, { ...note, timer: setTimeout(() => void this.options.schedule.queue(async () => this.notWoken(note.request)).catch(() => undefined), WAKE_GRACE) });
      }
      if (this.options.settings.plant === 'delivered-on-waiter-exit' || this.options.settings.plant === 'wake-assumed' || this.options.settings.plant === 'delivered-to-dead-waiter') {
        for (const row of rows) await this.outcome(row.id, 'next_prompt', 'delivered');
        return;
      }
      // Delivered only once a turn shows it: the wake's prompt carries it, or the transcript does.
      const at = Date.now();
      for (const row of rows) this.handed.set(row.id, { session, at, via: 'wake', timer: setTimeout(() => void this.options.schedule.queue(() => this.unwoken(session, row.id)).catch(() => undefined), WAKE_GRACE) });
    }).catch(() => undefined);
  }

  /** The answers waiting for a session deep-hook gates inside paseo, handed to paseo's plugin, which prompts it once it reads idle. */
  private async relayAnswers(session: string, r: Routes): Promise<void> {
    const relay = r.relay;
    const rows = (await this.waitingFor(session)).filter((row) => !this.handed.has(row.id));
    if (!relay || !rows.length) return;
    r.relay = undefined;
    this.answerWaiting.delete(session);
    relay.give({ session, text: this.answerText(rows), asks: rows.map((row) => row.id) });
    // Delivered only once a turn shows it, as a wake's answer is.
    const at = Date.now();
    for (const row of rows) this.handed.set(row.id, { session, at, via: 'next_prompt', timer: setTimeout(() => void this.options.schedule.queue(() => this.unwoken(session, row.id)).catch(() => undefined), WAKE_GRACE) });
  }

  /** The continues the asks core recorded since the hub last read them (#85): each takes a route back into its session. */
  continues(): Promise<void> {
    return (this.continuing = this.continuing.then(() => this.readContinues()).catch(() => undefined));
  }

  private async readContinues(): Promise<void> {
    const rows = (await this.options.services.record.raw(`SELECT log_pos, session_id, data FROM events WHERE kind = 'session.continued' AND log_pos > ${this.continuedPos} ORDER BY log_pos`)) as { log_pos: number; session_id: string | null; data: string | Obj }[];
    for (const row of rows) {
      this.continuedPos = row.log_pos;
      if (!row.session_id) continue;
      const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Obj;
      await this.continueSession(row.session_id, String(d.because), typeof d.task === 'string' ? d.task : null, typeof d.stop === 'string' ? d.stop : undefined);
    }
  }

  /**
   * The words a continue goes into its session with (#85): why it continues, then the block from the record for the
   * turn the stop cut off: each change or send call that started with no recorded end, marked outcome unknown, to
   * check before acting on. A send among them is denied at PreToolUse while its outcome is unknown. The box's resume
   * (#146) reuses the block. The block is kept as the session's reading, so the record says what the session heard.
   */
  async continueBlock(session: string, because: string, task: string | null, stop: string | undefined): Promise<string> {
    const text = continueText(because, task);
    const calls = stop ? await this.cutOff(session, stop) : [];
    if (!calls.length) return text;
    const sends = this.unknownSends.get(session) ?? this.unknownSends.set(session, new Map()).get(session)!;
    // Only a shell send has its input recorded (its command), so only one can be matched as identical; an MCP send is named, never denied.
    for (const call of calls) if (call.send && call.key.startsWith('shell:')) sends.set(call.key, { label: call.label, pr: call.pr });
    const block = `DeepBuild: the turn that was cut off started ${calls.length === 1 ? 'this call' : 'these calls'} with no recorded end, so ${calls.length === 1 ? 'its' : 'each one\'s'} outcome is unknown; check before acting on it: ${calls.map((c) => `${c.label} (outcome unknown)`).join('; ')}.`;
    const agent = this.options.state().live.get(session)?.agent ?? this.options.state().sessions.get(session)?.agent ?? 'claude-code';
    const [seen] = await this.options.services.record.raw(`SELECT 1 FROM events WHERE session_id = ? AND kind = 'session.reading' AND json_extract(data, '$.reading') = ? LIMIT 1`, [session, block]);
    if (!seen) await this.options.events.appendReading(session, agent, block).catch(() => undefined);
    if (sends.size) this.options.schedule.askingSoon();
    return `${text}\n\n${block}`;
  }

  /**
   * The change and send calls of the turn `stop` cut off that started with no recorded end: each tool.before of the
   * session between the stop before it and the stop itself with no tool.after for its call. A change is an edit or
   * a write; a send is a shell call that opens a pull request, or one the `effect:` guard entries deep-hook matched
   * read as a push, merge, dispatch, send or delete, or an MCP tool whose facts give it such an effect.
   */
  private async cutOff(session: string, stop: string): Promise<CutOff[]> {
    const rows = (await this.options.services.record.raw(`SELECT kind, data FROM events WHERE session_id = ? AND kind IN ('tool.before', 'tool.after')
      AND log_pos < (SELECT log_pos FROM events WHERE id = ?)
      AND log_pos > COALESCE((SELECT MAX(log_pos) FROM events e WHERE e.session_id = ? AND e.kind IN ('agent.stop', 'session.start') AND ${OWN_TURN} AND e.log_pos < (SELECT log_pos FROM events WHERE id = ?)), 0) ORDER BY log_pos`, [session, stop, session, stop])) as { kind: string; data: string | Obj }[];
    const open = new Map<string, Obj>();
    for (const row of rows) {
      const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Obj;
      if (typeof d.call !== 'string') continue;
      if (row.kind === 'tool.before') open.set(d.call, d);
      else open.delete(d.call);
    }
    const rules = effectEntries(this.options.services.root.dir);
    const found: CutOff[] = [];
    for (const d of open.values()) {
      const kind = String(d.kind);
      const command = typeof d.command === 'string' ? d.command : undefined;
      const { label, send, pr } = callOf(d, rules);
      const change = kind === 'edit' || kind === 'write';
      if (!send && !change) continue;
      const paths = Array.isArray(d.paths) ? d.paths.map(String).join(', ') : '';
      found.push({ key: kind === 'mcp' ? `mcp:${String(d.server)}/${String(d.tool)}` : `${kind}:${command ?? paths}`, label, send, pr });
    }
    return found;
  }

  /**
   * Whether a PreToolUse repeats a send the cut-off turn started with no recorded end (#85), and why it is denied: with
   * the earlier result when the hub can read it (a pull request the forge holds for the session's branch), else with
   * the outcome unknown, once, so the agent checks before sending again. A send the forge shows never went out runs.
   */
  async resent(meta: HookMeta): Promise<string | undefined> {
    const sends = this.unknownSends.get(meta.session);
    const call = meta.call;
    if (!sends?.size || !call) return undefined;
    const command = typeof call.input.command === 'string' ? call.input.command : undefined;
    // The recorded command was scrubbed by the parser with the values it held then; either spelling matches.
    const keys = command === undefined ? (call.tool.startsWith('mcp__') ? [sendKey(call.tool, undefined, call.input)] : []) : [...new Set([`shell:${scrubText(command, { held: this.options.settings.held })}`, `shell:${command}`])];
    const key = keys.find((k) => sends.has(k));
    const found = key ? sends.get(key) : undefined;
    if (!key || !found) {
      // A different call ran: the agent went on, or checked, as the denial asked. A send denied once is free to run again.
      for (const [k, v] of sends) if (v.denied) sends.delete(k);
      if (!sends.size) { this.unknownSends.delete(meta.session); this.options.schedule.askingSoon(); }
      return undefined;
    }
    // A send the cut-off turn made and saw complete (#1033): denied once, so the resumed session doesn't make it twice.
    if (found.done) {
      found.denied = true;
      return `DeepBuild denied this: ${found.label} is the send the turn that was cut off already made, and it completed. Don't make it again; go on from there.`;
    }
    const result = found.pr ? await this.pullFor(meta) : undefined;
    if (result === null) {
      // The forge holds no pull request for the branch: the send never went out, so this one runs.
      sends.delete(key);
      if (!sends.size) { this.unknownSends.delete(meta.session); this.options.schedule.askingSoon(); }
      return undefined;
    }
    if (result) {
      const agent = this.options.state().live.get(meta.session)?.agent ?? meta.agent;
      await this.options.judging().openedPr(meta.session, agent, result).catch(() => undefined);
      return `DeepBuild denied this: ${found.label} is the send the turn that was cut off already made. Its result: pull request ${result}. Go on from there; don't open it again.`;
    }
    // Its outcome can't be read from here: denied with that, until a different call shows the agent went on or checked;
    // a retry right after a late reply is denied again, so a hold that ran out never lets the send through.
    found.denied = true;
    return `DeepBuild denied this: ${found.label} is the send the turn that was cut off started with no recorded end, so its outcome is unknown. Check whether it went through before sending again; only a call you've checked, or a different one, runs.`;
  }

  /** The pull request the forge holds for the session's branch, or null when it holds none, or undefined when it can't be read. */
  private async pullFor(meta: HookMeta): Promise<string | null | undefined> {
    const lookup = async (): Promise<string | null | undefined> => {
      // The forge uses origin's owner/name, never the decision-scope ID (#1881).
      const origin = forgeOf(meta.cwd);
      const repo = origin?.slice(origin.indexOf('/') + 1);
      const [row] = (await this.options.services.record.raw(`SELECT branch FROM sessions WHERE id = ?`, [meta.session])) as { branch: string | null }[];
      const branch = row?.branch || await new Promise<string | undefined>((done) => execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: meta.cwd, timeout: 2000 }, (error, out) => done(error ? undefined : out.trim())));
      if (!repo || !branch) return undefined;
      const forge = new Forge(this.options.settings.forge ?? 'https://api.github.com', process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken());
      return forge.pullFor(repo, branch);
    };
    // Well inside the gate's hold, so the reply is never late for this: past it the result is unknown.
    return Promise.race([lookup().catch(() => undefined), new Promise<undefined>((done) => setTimeout(() => done(undefined), PULL_LOOKUP_MS).unref())]);
  }

  /**
   * One automatic continue of a stopped session (#85), by #25's routes: a stop of the session held now is sent back
   * with it; else its idle waiter wakes the session with it; else it goes with the session's next prompt, and the
   * record says so. The core decided it from the stop's structure; the hub only carries it. What waited on the row
   * while the stop's task was open (a parked line, a promised check due) goes with the resume.
   */
  private async continueSession(session: string, because: string, task: string | null, stop?: string): Promise<void> {
    const block = await this.continueBlock(session, because, task, stop);
    // A verdict that landed while the session was stopped (a slow-lane FAIL, say) waited on its row: it goes with the resume.
    const landed = await this.options.judging().landedLine(session).catch(() => undefined);
    const claim = this.options.state().live.get(session)?.claim;
    const text = landed ? `${block}\n\nDeepBuild: while this session was stopped, its claim${claim ? ` ${claim}` : ''} was judged: ${landed}` : block;
    const r = this.routesOf(session);
    r.blocked = undefined;
    if (r.holding) {
      r.sendBacks.push(text);
      for (const wake of this.waiting.get(session) ?? []) wake();
      return;
    }
    const waiter = r.waiter;
    if (waiter && r.covered && r.shown.has('waiter') && !r.capped && r.wakes !== false && r.busy < Math.max(waiter.since, r.ended)) {
      r.waiter = undefined;
      const later = r.later.splice(0);
      r.handed = [...(r.handed ?? []), text, ...later];
      const p = this.promises.get(session);
      let promised: string | undefined;
      if (p?.status === 'due' && !p.handed) { p.handed = true; promised = wakeText(p); this.armPromiseGrace(session, p, WAKE_GRACE); }
      waiter.give({ session, text: [text, ...later, promised].filter(Boolean).join('\n\n') });
      return;
    }
    r.later.push(text);
    const agent = this.options.state().live.get(session)?.agent ?? this.options.state().sessions.get(session)?.agent ?? 'claude-code';
    await this.options.events.appendReading(session, agent, `DeepBuild continues this session (${because}${task ? `, task ${task}` : ''}), but no route into it is open now: the continue goes with its next prompt.`).catch(() => undefined);
  }

  /**
   * An answer handed to a route that no turn has shown: the transcript is read for it, and with none it reads stalled
   * and goes by the next route. A waiter's also says the app didn't wake the session, and its answer goes by the next
   * prompt.
   */
  async unwoken(session: string, ask: string, prompt?: string): Promise<void> {
    const handed = this.handed.get(ask);
    if (!handed) return;
    clearTimeout(handed.timer);
    this.handed.delete(ask);
    const wake = handed.via === 'wake';
    const via = wake ? 'next_prompt' : handed.via;
    const woken = (wake && (prompt ?? '').includes(`ask:${ask}`)) || await this.woken(session, said(ask));
    if (woken) {
      const r = this.routes.get(session);
      if (r && wake) r.wakes = true;
      return this.outcome(ask, via, 'delivered');
    }
    // A session that can't be read proves nothing either way (#27): timed out, and the next prompt reads it first.
    if (woken === undefined) {
      this.unread.set(ask, session);
      return this.outcome(ask, via, 'timed_out');
    }
    await this.outcome(ask, via, 'stalled');
    if (!wake) {
      await this.options.events.appendReading(session, this.options.state().sessions.get(session)?.agent ?? 'claude-code', `DeepBuild's ${via === 'stop_hold' ? 'stop' : 'prompt'} reply carrying your answer to ask:${ask} didn't reach the agent: deep-hook had given up on it. The answer goes by the session's next route.`).catch(() => undefined);
      return;
    }
    const r = this.routes.get(session);
    // A route never seen working counts as absent: this session's answers wait for its next prompt.
    if (r && r.wakes !== true) r.wakes = false;
    await this.options.events.appendReading(session, this.options.state().sessions.get(session)?.agent ?? 'claude-code', `Claude Code didn't wake this session with your answer to ask:${ask}: its waiter handed it over and no turn started. The answer goes with the session's next prompt.`).catch(() => undefined);
  }

  /**
   * A session cleared while its waiter's answers showed in no turn (#27): replaced, and each goes to the thread's new
   * session at its start, as an answer that never reached it.
   */
  async replaced(session: string): Promise<void> {
    for (const [ask, handed] of [...this.handed]) {
      if (handed.session !== session) continue;
      clearTimeout(handed.timer);
      this.handed.delete(ask);
      await this.outcome(ask, handed.via === 'stop_hold' ? 'stop_hold' : 'next_prompt', 'replaced');
    }
  }

  /** A note its waiter handed over that no turn showed: it waits for the session's next prompt. */
  private notWoken(request: string): void {
    const note = this.handedNotes.get(request);
    if (!note) return;
    this.handedNotes.delete(request);
    this.notes.set(note.session, [...(this.notes.get(note.session) ?? []), { session: note.session, text: note.text, request }]);
  }

  /** Whether the transcript shows a turn carrying `token`; undefined when the transcript can't be read. */
  async woken(session: string, token: string): Promise<boolean | undefined> {
    return (await this.shown(session, [token]))?.has(token);
  }

  /**
   * The tokens the transcript shows a turn carrying (an ask's answer, a promise's wake-up): a queued wake, a prompt or
   * a stop hook's feedback naming one, or a hook's context or blocking error carrying it (#906); undefined when the
   * transcript can't be read.
   */
  private async shown(session: string, tokens: string[]): Promise<Set<string> | undefined> {
    const seen = new Set<string>();
    const transcript = this.options.state().sessions.get(session)?.transcript;
    if (!transcript) return seen;
    try { await access(transcript, constants.R_OK); } catch { return undefined; }
    for (const l of (await this.options.services.transcriptReader.tail(transcript, 1 << 20)).split('\n')) {
      const hit = tokens.filter((t) => l.includes(t));
      if (!hit.length) continue;
      try {
        const e = JSON.parse(l) as Obj;
        const hook = e.type === 'attachment' && isObj(e.attachment) && (e.attachment.type === 'hook_additional_context' || e.attachment.type === 'hook_blocking_error');
        if (hook || e.type === 'queue-operation' || (e.type === 'user' && isObj(e.message) && typeof e.message.content === 'string')) for (const t of hit) seen.add(t);
      } catch { /* a cut line shows nothing */ }
    }
    return seen;
  }

  /**
   * The waiter: one per session, the newest. It waits until the session is idle with an answer for it, then hands
   * it over to wake the session; it is told to exit when a newer one replaces it, the stop hold took the answer, or
   * the session ends. Its life is its session's, not this hub's: one that waited across a restart asks again.
   */
  async waitAnswer(params: Obj, context: CallContext): Promise<Obj> {
    const session = String(params.session);
    const since = typeof params.since === 'number' ? params.since : this.options.services.now();
    if (this.options.kernel.stopping) throw refuse('unavailable', '', 'The hub is stopping; ask again once it is back.', session, true);
    if (this.options.settings.plant === 'waiter-gives-up-at-600s' && this.options.services.now() - since > 600_000) return { exit: 'planted: gave up at 600 s' };
    const r = this.routesOf(session, typeof params.cwd === 'string' ? params.cwd : '');
    // paseo's plugin on deep-hook's behalf, for a session deep-hook gates inside paseo (#55).
    if (params.relay === true) {
      if (context.session !== session || !this.inPaseo.has(session)) throw refuse('role', '/params/session', 'Wait only on a session paseo runs that this connection is bound to.', session);
      return new Promise((give) => {
        r.relay?.give({ exit: 'replaced by a newer waiter' });
        r.relay = { key: Number(context.waiter ?? 0), at: Date.now(), since, give };
        this.offer(session);
      });
    }
    if (params.push === true || context.role === 'mcp') {
      const agent = this.options.state().sessions.get(session)?.agent;
      if (context.session !== session || !placesItself(agent)) throw refuse('role', '/params/session', 'Wait only on the pi or paseo session this connection is bound to.', session);
      r.places = true;
    }
    if (params.poll === true) {
      // The planted Node waiter (waiter-polls) asks each time instead of being told.
      const rows = !r.holding ? await this.options.schedule.queue(() => this.waitingFor(session)) : [];
      if (!rows.length) return {};
      for (const row of rows) await this.outcome(row.id, 'next_prompt', 'delivered');
      return { session, text: this.answerText(rows) };
    }
    return new Promise((give) => {
      const waiter = { key: Number(context.waiter ?? 0), at: Date.now(), since, give: (reply: Obj) => give(reply) };
      const old = r.waiter;
      if (old && this.options.settings.plant !== 'waiter-per-stop') {
        if (old.since > since) return give({ exit: 'replaced by a newer waiter' });
        old.give({ exit: 'replaced by a newer waiter' });
      }
      r.waiter = waiter;
      if (r.covered && this.options.settings.plant !== 'routes-kept-across-sessions') r.shown.add('waiter');
      this.offer(session);
    });
  }

  /** The session that replaced this one in its process, if it hasn't itself been resumed since: its answers are bound to the old generation. */
  private async replacedBy(session: string): Promise<string | undefined> {
    const [row] = (await this.options.services.record.raw(`SELECT session_id FROM events WHERE kind = 'session.start' AND json_extract(data, '$.parent') = ?
      AND log_pos > (SELECT COALESCE(MAX(log_pos), 0) FROM events WHERE kind = 'session.start' AND session_id = ?) ORDER BY log_pos DESC LIMIT 1`, [session, session])) as { session_id: string }[];
    // Replaced in its own process: a start naming it as parent from anywhere else replaces nothing.
    const [was, now] = [this.options.state().sessions.get(session), row && this.options.state().sessions.get(row.session_id)];
    // A hub restarted since knows the old one by no process: the start that named it is what's left.
    return now && (!was || was.pid === 0 || (was.pid === now.pid && was.start === now.start)) ? row!.session_id : undefined;
  }

  /**
   * An answer of a session whose package places them (#40): refused when another session has replaced it, so it never
   * reaches the replacement; else handed to the package, unless the deep_ask or deep_wait still running returns it.
   */
  private async placeOrRefuse(session: string): Promise<void> {
    // A refusal is final: a session resumed later doesn't take what was refused for it.
    const refused = (await this.options.services.record.raw(`SELECT delivery FROM deliveries WHERE outcome = 'replaced'`)) as { delivery: string }[];
    // Its own: a fork shares its thread, and only the session that asked takes an answer or reports on it.
    const rows = (await this.waitingFor(session)).filter((row) => row.session === session && !this.askWaits.has(row.id) && !refused.some((d) => d.delivery === row.id));
    if (!rows.length) return;
    const successor = await this.replacedBy(session);
    const r = this.routes.get(successor && piAcceptsReplaced() ? successor : session);
    if (successor && !piAcceptsReplaced()) {
      for (const row of rows) await this.outcome(row.id, 'next_prompt', 'replaced');
      return;
    }
    if (!r?.places || !r.waiter) return;
    const placing = (r.placing ??= new Set());
    const fresh = rows.filter((row) => !placing.has(row.id));
    const waiter = r.waiter;
    if (!fresh.length) return;
    r.waiter = undefined;
    for (const row of fresh) placing.add(row.id);
    waiter.give({ session, text: this.answerText(fresh), asks: fresh.map((row) => row.id) });
  }

  /** What the package did with the answers it took: only the session that raised an ask reports on it. */
  async placed(params: Obj, context: CallContext): Promise<Obj> {
    const session = String(params.session);
    const agent = this.options.state().sessions.get(session)?.agent;
    if (!context.session || context.session !== session || !placesItself(agent)) throw refuse('role', '/params/session', 'Report only on the pi or paseo session this connection is bound to.', session);
    const via = String(params.via);
    const outcome = String(params.outcome);
    if (!['steer', 'next_prompt'].includes(via)) throw refuse('enum', '/params/via', 'Say steer or next_prompt.', via);
    if (!['delivered', 'replaced'].includes(outcome)) throw refuse('enum', '/params/outcome', 'Say delivered or replaced.', outcome);
    const asks = Array.isArray(params.asks) ? params.asks.map(String) : [];
    for (const ask of asks) {
      const [row] = (await this.options.services.record.raw(`SELECT session_id, status FROM asks WHERE id = ?`, [ask])) as { session_id: string | null; status: string }[];
      if (!piAcceptsReplaced()) {
        if (row?.session_id !== session || row.status !== 'answered') throw refuse('not_found', '/params/asks', 'Report only on an answered ask this session raised.', ask);
        // Delivered is a word about what the hub handed over, or what a running call returned.
        if (outcome === 'delivered' && !this.routes.get(session)?.placing?.has(ask) && !this.askWaits.has(ask)) throw refuse('not_found', '/params/asks', 'Report only on an answer handed to this session.', ask);
      }
      this.askWaits.delete(ask);
      const [done] = (await this.options.services.record.raw(`SELECT 1 AS yes FROM deliveries WHERE delivery = ? AND outcome IN ('delivered', 'replaced')`, [ask])) as unknown[];
      if (done) continue;
      await this.outcome(ask, via as 'steer' | 'next_prompt', outcome as 'delivered' | 'replaced');
    }
    return { reported: asks.length };
  }

  /** Ends a running call's hold on its ask, and wakes the call: nothing about the ask landed to wake it (#823). */
  private stopAskWait(ask: string): void {
    this.askWaits.delete(ask);
    for (const wake of this.settling.get(`ask:${ask}`) ?? []) wake();
  }

  /** Stops this session's running deep_ask and deep_wait: the call was aborted, and its answer comes as a message of its own. */
  stopWaiting(context: CallContext): Obj {
    for (const [ask, session] of [...this.askWaits]) if (session === context.session) this.stopAskWait(ask);
    // One answered as it was aborted: the call's reply went unread.
    if (context.session && this.options.state().sessions.get(context.session)?.agent === 'pi') { const session = context.session; void this.options.schedule.queue(() => this.placeOrRefuse(session)).catch(() => undefined); }
    return {};
  }

  /** A waiter whose connection closed: Claude Code stopped it, or it exited. */
  waiterGone(key: number): void {
    if (this.options.settings.plant === 'delivered-to-dead-waiter') return;
    for (const [session, r] of this.routes) {
      if (r.relay?.key === key) r.relay = undefined;
      if (r.waiter?.key !== key) continue;
      r.waiter = undefined;
      // The running deep_ask went with it: its answer waits for the next waiter.
      if (r.places) for (const [ask, waiting] of this.askWaits) if (waiting === session) this.stopAskWait(ask);
    }
  }

  /** test.send_back: a send-back planted for the session's next stop (the hub runs with DEEP_HUB_TEST_SEND_BACK=1). */
  sendBack(params: Obj): Obj {
    if (typeof params.session !== 'string' || typeof params.reason !== 'string') throw refuse('type', '/params', 'Name the session and the reason, as strings.', params);
    this.routesOf(params.session).sendBacks.push(params.reason);
    this.options.schedule.askingSoon();
    return { planted: true };
  }

  /**
   * A permission prompt (#23): answered through the hook only from a saved decision that covers it, logged as decided
   * for you. One no decision covers opens no ask: the agent's own prompt asks you in the terminal (#18), and once the
   * call you said yes to runs it is offered back as a decision you save with one click (`deep inbox save`).
   */
  async permission(meta: HookMeta, until = 0, inPaseo = false): Promise<{ decision: 'allow' | 'deny' | 'none'; because?: string }> {
    await this.options.kernel.ready;
    if (FOREIGN.has(meta.agent) || !meta.session || !meta.call) return { decision: 'none' };
    const tool = aboutPermission(meta.call.tool, meta.call.input);
    // A request paseo calls `other` is never one a saved decision answers: it asks you (#55).
    const about = meta.paseo?.kind === 'other' ? { ...tool, subject: { ...tool.subject, target: { ...tool.subject.target, kind: `other:${meta.call.tool}`, owner: `other:${tool.subject.target.owner}` } } } : tool;
    // A prompt shown in paseo, not in a terminal, is asked here: there is no dialog of the agent's own to draw it (#55).
    const shown = meta.agent === 'paseo' || inPaseo || this.inPaseo.has(meta.session);
    if (!shown && !(await this.covered(meta.session, about))) {
      this.pending.set(`${meta.session}|${about.subject.target.owner}`, { meta, about });
      return { decision: 'none' };
    }
    const asked = await this.options.services.holds.asked(meta, about);
    this.prompts.add(asked.ask);
    if (asked.decision) return { decision: asked.option === 'approve' ? 'allow' : 'deny', because: asked.decision };
    if (shown) {
      if (meta.paseo?.request) this.paseoRequests.set(`${meta.session}|${meta.paseo.request}`, asked.ask);
      const answer = await new Promise<Delivery | undefined>((done) => {
        const timer = setTimeout(() => { this.permits.delete(asked.ask); done(undefined); }, Math.max(0, until - Date.now()));
        timer.unref();
        this.permits.set(asked.ask, (delivery) => { clearTimeout(timer); this.permits.delete(asked.ask); done(delivery); });
      });
      return { decision: !answer ? 'none' : answer.option === 'approve' ? 'allow' : 'deny' };
    }
    // The core's gate refused what looked covered, as when two decisions disagree: the prompt goes to you, and its ask with it.
    const ts = this.options.services.now();
    await this.options.events.append(this.options.events.connection('core', { session: meta.session, agent: meta.agent }), { v: 1, id: ulid(ts), kind: 'ask.cancelled', subject: asked.ask, ts, data: { answer: 'decline', plan_hash: null, decision: 'none' } });
    return { decision: 'none' };
  }

  /**
   * Who gates a session paseo's plugin sends a line for (#55): the adapter that bound its session ID first, deep-hook
   * or the pi package, or null when that is the plugin. Its MCP server's token binds to the session either way.
   */
  paseoOwner(meta: HookMeta): Promise<string | null> {
    return this.options.schedule.queue(async () => {
      if (meta.paseo?.bind && meta.session) { this.binds.set(meta.paseo.bind, meta.session); this.tokenBound.add(meta.session); }
      const session = this.options.state().sessions.get(meta.session);
      const owner = session && session.agent !== 'paseo' ? session.agent : null;
      if (owner) this.inPaseo.add(meta.session);
      return owner;
    });
  }

  /**
   * A permission request someone answered in paseo's own app (#55): no answer to DeepBuild's ask, which stays open,
   * since an answer with authority counts only on the trusted path or with a paired phone's verified signature.
   */
  async paseoAppAnswer(meta: HookMeta): Promise<Obj> {
    const ask = meta.paseo?.request ? this.paseoRequests.get(`${meta.session}|${meta.paseo.request}`) : undefined;
    if (!ask || !this.permits.has(ask)) return {};
    await this.options.schedule.queue(() => this.options.events.appendReading(meta.session, meta.agent, `An answer to ${ask} came from paseo's app with no verified device signature, so DeepBuild refused it and ${ask} stays open: an answer with authority counts only on the trusted path (the DeepBuild app, deep inbox answer once the OS confirms you, or a paired phone that signs).`)).catch(() => undefined);
    return { refused: 'trusted path', ask };
  }

  /** Whether a saved decision covers what a prompt is about, asked of resolver-decisions with nothing raised. */
  private async covered(session: string, about: About): Promise<boolean> {
    const options = [{ id: 'approve', label: about.options[0], decision: 'allow' as const }, { id: 'decline', label: about.options[1], decision: 'deny' as const }];
    const key = subjectKey({ kind: 'authority', subject: about.subject, options } as unknown as Parameters<typeof subjectKey>[0], '');
    const answer = await this.precheck({
      ask: 'ask:0', kind: 'authority', options, plan: null, words: [], changed: null, folded: [], undo: false, cost_usd: null, suggested: null, conflict: [],
      needs_person: [], budget: null, missing: null, targets: [], session, key, repo: this.options.state().projects.get(session) ?? null, subject: about.subject,
    });
    return answer !== undefined && !answer.also?.length;
  }

  /** A call whose prompt no decision covered has run: you said yes in the terminal, so it is offered back to save. */
  async offerBack(meta: HookMeta): Promise<void> {
    // The prompt and the call that ran are matched by session and call: a prompt's payload names no tool_use_id.
    const key = `${meta.session}|${aboutPermission(meta.call!.tool, meta.call!.input).subject.target.owner}`;
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    const project = this.options.state().projects.get(meta.session);
    const handle = `offer:${ulid(this.options.services.now())}`;
    this.offers.set(handle, { ...pending, scope: project ? `repo:${project}` : `session:${letters(meta.session)}` });
    // The typed-saves-decision plant, when your words came in before the call's run did.
    if (this.options.settings.plant === 'typed-saves-decision' && this.typedAt.has(meta.session)) await this.typedSaves(meta.session);
  }

  /** The typed-saves-decision plant: words you type in the session save what it offers back, with no click. */
  async typedSaves(session: string): Promise<void> {
    for (const [handle, offer] of [...this.offers]) if (offer.meta.session === session) await this.saveOffer(handle, this.options.events.connection('cli'));
  }

  /** The offers still open: each one no saved decision covers yet. */
  async openOffers(): Promise<Obj[]> {
    const open: Obj[] = [];
    for (const [offer, o] of this.offers) {
      if (await this.covered(o.meta.session, o.about)) this.offers.delete(offer);
      else open.push({ offer, session: o.meta.session, command: o.about.subject.target.ref, scope: o.scope });
    }
    return open;
  }

  /** offers/:id/save, from the app or `deep inbox save`: your one click, once the trusted path allows it, saves the offered permission for its repo. */
  async saveOffered(params: Obj, context: CallContext): Promise<Obj> {
    const handle = params.offer;
    if (typeof handle !== 'string' || !/^offer:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/offer', 'Name the offer by its handle, offer:<id>, as deep inbox lists it.', handle));
    const offer = this.offers.get(handle);
    if (!offer) throw new Refused(refusal('not_found', '/params/offer', `No offer ${handle}; save one deep inbox lists.`, handle));
    await this.options.control().trusted('offer.save', params, context, `save “${offer.about.subject.target.ref.slice(0, 120)}” as a decision for ${offer.scope}`, handle, offer.scope);
    return this.saveOffer(handle, this.options.events.connection(context.role === 'app' ? 'app' : 'cli'));
  }

  /** The offer saved: its permission raised as an authority ask and answered yes on the trusted path, which saves it for the repo. */
  private async saveOffer(handle: string, as: Connection): Promise<Obj> {
    const offer = this.offers.get(handle)!;
    this.offers.delete(handle);
    const asked = await this.options.services.holds.asked(offer.meta, offer.about);
    // Its answer is yours, given here: nothing is delivered to the session.
    this.prompts.add(asked.ask);
    if (!asked.decision) await this.options.services.asks.answer(as, asked.ask, { option: 'approve', plan_hash: (await this.options.services.asks.card(asked.ask)).plan?.hash ?? null, token: `os-confirm:${ulid(this.options.services.now())}` }).catch((error: unknown) => { throw asRefused(error); });
    await this.options.memory().syncStanding().catch(() => undefined);
    const [saved] = (await this.options.services.record.raw(`SELECT id, data FROM events WHERE kind = 'decision.created' AND subject = ? ORDER BY log_pos DESC LIMIT 1`, [asked.ask])) as { id: string; data: string }[];
    return { offer: handle, ask: asked.ask, decision: saved ? `decision:${saved.id}` : asked.decision ?? null, scope: saved ? String((JSON.parse(saved.data) as Obj).scope) : offer.scope };
  }

  /** The planted wrong programs that let a held stop go when its answer comes, leaving the answer to the waiter. */
  get releases(): boolean {
    return this.options.settings.plant === 'answer-skips-held-stop' || this.options.settings.plant === 'stop-hold-releases-without-answer';
  }
}
