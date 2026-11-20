// The first work run (#1332; design: Work runs, Attempt and plan, Landing in turn), with no app. `deep work "<scope>"`
// turns its words into #1330's bounds and raises the same `start.approve` ask; once you answer it yes, the hub works the
// set by itself. An issue is ready when it's open, in the set, has no live attempt, no open PR linking it from another
// account, its `Runs on:` line names a machine this host can serve, and everything it's blocked by is done: landed with
// a PASS in the record, landed with only a budget window's requirement open, or on the baseline of issues closed before
// the gate. A closed issue whose PR hasn't merged isn't done, and a link the forge can't read keeps it waiting, naming
// the link. The ready issue that unblocks most in the set starts first, then the lowest number, with the reason shown.
// An attempt is a session in the approved agent whose turn it is, then landing (#1331): its PR is judged on its merge
// with main whenever its head moves, and once it lands the session stops. A next attempt goes on in the same worktree
// and branch, its uncommitted files kept, from a brief written only from the record; three replaced attempts on an
// issue become one ask, counted across agents and models. An issue waiting on a person gives up its slot: its session
// stops, and its next attempt starts once you answered and a slot is free. Everything is read again from the record and
// the forge each pass, so a restarted hub, its started sessions reconciled first, starts nothing twice. Each issue's
// state word is recorded as `work.state`, which `deep work show` prints. A workspace's run (#1347) takes its tasks from
// the record the same way, with no forge read or written: a task's change finishes on the workspace's own main once
// its PASS covers the merge, the version before it kept a step back. Under a standing rule or a topic's card (#1345), a
// change whose only open requirements are calls on you lands on its other checks unless it reaches a release or a
// published page; its issue stays open naming the calls, and their answers close it, revert it or start an attempt.
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import type { Asks } from '@deepbuild/asks';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { gitEnv } from '@deepbuild/gate';
import type { WorkItem } from './ask-tasks.js';
import { mergeOf, onlyWindow, type Landing, type Outcome, type RaiseCall } from './landing.js';
import type { Plant } from './plant.js';
import type { Starts } from './starts.js';
import type { WorkspaceService } from './workspaces-port.js';
import { refusal, Refused } from './wire.js';
import { authored, byMilestone, meets, ruleOf, whyOut, type Listed, type Rule } from './work-rule.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const DAY = 86_400_000;
/** How often a run looks again: an issue waiting on a person gives up its slot well within 10 s. */
const PASS_MS = 2_000;
/** How long the forge's answers stand between passes, unless something the run did changed them. */
const FORGE_MS = 30_000;
/** How soon the forge is read again for an attempt whose turn ended with no PR read yet: it may have just opened one. */
const PR_MS = 5_000;
/** Replaced attempts on one issue at which the run asks you instead of starting another. */
const BREAKER = 3;
/** A standing run's breaker (#1335): attempts in a row ending in anything but a landing, or reverted landings in a day. */
const IN_A_ROW = 5;
const REVERTS = 2;
/** How often a standing run says what it landed, left and spent. */
const WEEK = 7 * DAY;
/** How long a candidate's blocked-by links stand unless the issue changed. */
const LINKS_MS = 5 * 60_000;
/** How an attempt ended with its change landed. */
const LANDED = new Set(['PASS', 'landed with the budget window open', 'landed with your call open']);
/** The words GitHub reads as linking an issue, closing ones first, and `Part of`, which links without closing. */
const LINKS = /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of):?\s+#(\d+)\b/i;
/** The baseline of issues closed before the gate: the repo's file, as the commit that added it holds it. */
const BASELINE = '.deepbuild/closed-before-gate.json';
/** How an attempt ended without being replaced: its change landed, or its issue waited on you. */
const KEPT = new Set(['PASS', 'landed with the budget window open', 'landed with your call open', 'gave up its slot']);
/** A call's two answers (#328's): Yes, the recommended one, and Send back. */
const YES = 'yes';
const SEND_BACK = 'send_back';
/** The verdict words a landing records that are state words too. */
const WORDS = new Set(['BLOCKED', 'INVALID', 'INCONCLUSIVE']);
/** The machines a `Runs on:` line names, as docs/parallel-proof.md does, and what serves each. */
const MACHINES: Record<string, () => boolean> = {
  mac: () => process.platform === 'darwin', macos: () => process.platform === 'darwin',
  spark: () => process.platform === 'linux' && process.arch === 'arm64', linux: () => process.platform === 'linux',
};

/** One issue's row: its state word, on every surface the same, and what it waits for. */
export interface Row { issue: number; word: string; waits_on: string | null; why: string }
interface Issue { n: number; open: boolean; title: string; body: string; blockers: number[] | { unread: string } }
interface Pull { pr: number; issue: number; login: string; open: boolean; merged: boolean; branch: string; head: string }
interface Attempt { attempt: number; run: string; agent: string; model: string | null; worktree: string; branch: string; reason: string; ended: { cause: string; verdict: string | null; model: string | null } | null }
interface OpenAsk { handle: string; session: string | null; key: string; writer: string; provisional: boolean }
/** A call on an issue's change (#1345) as it stands: open, or closed with the option it took and how. */
interface CallRow { handle: string; issue: number; head: string; text: string; open: boolean; answer: string | null; how: string | null; words: string | null }
/** What landed for an issue: the newest landing, its outcome, what it left open, its pull request, head, commit and claim. */
interface Landed { outcome: string; open: string[]; pr: number; at?: string; head?: string | null; commit?: string | null }
/** A merged revert of a landing, by the landing's commit as its branch names it, and when it merged. */
interface Revert { pr: number; landing: string; at: number }
/** What a pass reads: the issues and pull requests, the run's set, a standing run's left-out issues with why, and its milestones. */
interface Read { issues: Map<number, Issue>; pulls: Pull[]; reverts: Revert[]; set: number[]; out: Map<number, string>; milestones: Map<number, Listed['milestone']> }
type Approval = NonNullable<Awaited<ReturnType<Starts['approvalOf']>>>;

export interface WorkOptions {
  api: string;
  token(): Promise<string | undefined>;
  repoOf(remote: string): string | undefined;
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  appendCore(kind: string, data: Obj, extra?: { subject?: string; v?: number }): Promise<void>;
  starts(): Starts;
  landing(): Landing;
  asks(): Asks;
  now(): number;
  plant: Plant | undefined;
  /** The workspaces a run's folder may be (#1347), and a workspace task's change judged on its merge with main. */
  spaces(): Pick<WorkspaceService, 'idAt' | 'tasksOf' | 'finished'>;
  /** Each pass's turn for the briefs (#1342). */
  due?(): Promise<void>;
  judgeTask(r: { folder: string; item: WorkItem; commit: string; session: string }): Promise<{ claim: string; outcome: Outcome; requirements: { req: string; text: string; settled_by: string | null; outcome: string; oracle?: string | null }[] } | undefined>;
  /** A call on a claim's requirement whose oracle is you, and once it closed your answer: the claim's verdict reads them (#1345). */
  answered(claim: string, req: string, ask: string, answer?: 'PASS' | 'FAIL' | 'unanswered'): Promise<void>;
}

const git = (cwd: string, ...args: string[]): Promise<string> =>
  new Promise((done, fail) => execFile('git', ['-C', cwd, ...args], { encoding: 'utf8', env: gitEnv(), timeout: 30_000 }, (error, out, err) => (error ? fail(Error(String(err || error.message).trim())) : done(String(out).trim()))));
const real = (p: string): string => { try { return realpathSync(p); } catch { return p; } };
const key = (o: Obj): string => sha256Hex(canonicalize(o as JsonValue));

export class Work {
  private timer: NodeJS.Timeout | undefined;
  private passing: Promise<void> | undefined;
  private readonly forge = new Map<string, { at: number; issues: Map<number, Issue>; pulls: Pull[]; reverts: Revert[] }>();
  /** A standing run's open issues as the forge lists them, and each one's blocked-by links, read again once it changed (#1335). */
  private readonly lists = new Map<string, { at: number; open: Map<number, Listed & { updated: string }> }>();
  private readonly links = new Map<string, { updated: string; at: number; blockers: number[] | { unread: string } }>();
  private readonly epics = new Map<string, { at: number; under: Set<number> }>();
  private readonly docs = new Map<string, string | undefined>();
  /** The head of each PR a run last judged, and what held it: judged again only once its head moves. */
  private readonly judged = new Map<number, { head: string; held: string | null }>();
  /** The head of each workspace attempt's branch last judged, and what held it (#1347). */
  private readonly heads = new Map<string, { head: string; held: string | null }>();
  private judgements = 0;
  /** Each attempt's worktree as it started: a turn that ends with it unchanged replaced the attempt. */
  private readonly snapshots = new Map<string, string>();
  /** Each call's claims and requirements as this hub judged them, by the call's handle: your answer reaches each (#1345). */
  private readonly asked = new Map<string, { claim: string; req: string }[]>();
  /** The answers handed to claims, and the reverts and closes made for calls, each once: with why one couldn't be. */
  private readonly done = new Map<string, string | null>();
  private you: string | undefined;
  constructor(private readonly o: WorkOptions) {}

  /** After the starts are reconciled with what still runs: nothing new starts before that. */
  open(): void {
    this.timer = setInterval(() => void this.pass(), PASS_MS);
    this.timer.unref();
    void this.pass();
  }
  /**
   * First when the hub stops, before its supervisor lets go of the sessions it started: a pass still under way then
   * ends no attempt and starts none, so the next hub finds them as they were.
   */
  close(): void { this.closed = true; clearInterval(this.timer); }
  private closed = false;

  // ---- The commands.

  /** `deep work "<scope>"`: its words as #1330's bounds, raised as the same `start.approve` ask, and the run recorded. */
  async approve(params: Obj, caller: Parameters<Starts['approve']>[1]): Promise<{ ask: string; bounds: Obj }> {
    const words = typeof params.scope === 'string' ? params.scope : '';
    const bounds = scopeOf(words, this.o.now());
    if (typeof bounds === 'string') throw new Refused(refusal('type', '/params/scope', bounds, words));
    const { ask } = await this.o.starts().approve({ repo: params.repo, ...bounds, lands: typeof params.repo === 'string' && this.o.spaces().idAt(params.repo) ? 'workspace' : true }, caller);
    await this.o.appendCore('work.run', { ask, step: 'asked', scope: words.slice(0, 2000) }, { subject: ask });
    return { ask, bounds };
  }
  /** A run your yes on a brief's card approved (#1342): the same bounds and record, under that card's ask, with no ask of its own. */
  async under(ask: string, folder: string, words: string): Promise<void> {
    const bounds = scopeOf(words, this.o.now());
    if (typeof bounds === 'string') throw Error(bounds);
    await this.o.starts().approved(ask, { repo: folder, ...bounds, lands: this.o.spaces().idAt(folder) ? 'workspace' : true });
    await this.o.appendCore('work.run', { ask, step: 'asked', scope: words.slice(0, 2000) }, { subject: ask });
  }
  /** `deep work pause`: no new starts, and running turns finish. */
  async pause(params: Obj): Promise<{ paused: string[] }> {
    const runs = (await this.runs(params.repo)).filter((r) => !r.paused);
    for (const r of runs) await this.o.appendCore('work.run', { ask: r.ask, step: 'paused', scope: r.scope }, { subject: r.ask });
    return { paused: runs.map((r) => r.ask) };
  }
  /**
   * `deep work show`: each issue's state word and what it waits for, as the record's `work.state` holds them. A standing
   * run's page (#1335) adds its rule, the issues that stay out with why, its weekly notices, and its breaker's pause.
   */
  async show(params: Obj): Promise<{ runs: ({ ask: string; repo: string; paused: boolean; issues: Row[] } & Obj)[] }> {
    const out = [];
    for (const r of await this.runs(params.repo)) {
      let rows = await this.rows(r.ask);
      // The planted wrong program takes each issue's word from the newest comment on it that says one.
      if (this.o.plant === 'state-from-comment' && r.repo) {
        const slug = await this.slugOf(r.repo);
        rows = await Promise.all(rows.map(async (row) => {
          const said = await this.get(`/repos/${slug}/issues/${row.issue}/comments?per_page=100`);
          const word = Array.isArray(said.body) ? said.body.filter(isObj).map((c) => /^State:\s*(.+)$/m.exec(String(c.body ?? ''))?.[1]?.trim()).filter(Boolean).at(-1) : undefined;
          return word ? { ...row, word } : row;
        }));
      }
      const [approval] = (await this.o.raw(`SELECT json_extract(data, '$.rule') AS rule FROM events WHERE kind = 'start.approval' AND subject = ? LIMIT 1`, [r.ask])) as { rule: string | null }[];
      const rule = approval?.rule ? (JSON.parse(approval.rule) as Rule) : undefined;
      if (!rule) { out.push({ ask: r.ask, repo: r.repo, paused: r.paused, issues: rows }); continue; }
      const left = await this.outOf(r.ask);
      const breaker = await this.runBreakerOf(r.ask);
      const notices = ((await this.o.raw(`SELECT data FROM events WHERE kind = 'work.notice' AND subject = ? ORDER BY log_pos`, [r.ask])) as { data: string }[]).map((n) => { const d = JSON.parse(n.data) as Obj; delete d.ask; return d; });
      out.push({
        ask: r.ask, repo: r.repo, paused: r.paused || breaker.raised !== null,
        ...(breaker.raised ? { breaker: breaker.raised === 'open' ? `${breaker.handle} asks you whether it goes on` : `you kept it paused (${breaker.handle})` } : {}),
        rule: rule.words, issues: rows.filter((row) => !left.has(row.issue)), left_out: [...left].map(([issue, why]) => ({ issue, why })), notices,
      });
    }
    return { runs: out };
  }

  // ---- What the record holds.

  /** The runs `deep work` raised, oldest first, each with its repo and whether it is paused; with a repo, only its runs. */
  private async runs(repo?: unknown): Promise<{ ask: string; scope: string; repo: string; paused: boolean }[]> {
    const rows = (await this.o.raw(`SELECT w.data AS data, (SELECT json_extract(a.data, '$.repo') FROM events a WHERE a.kind = 'start.approval' AND a.subject = w.subject LIMIT 1) AS repo
      FROM events w WHERE w.kind = 'work.run' ORDER BY w.log_pos`)) as { data: string; repo: string | null }[];
    const runs = new Map<string, { ask: string; scope: string; repo: string; paused: boolean }>();
    for (const row of rows) {
      const d = JSON.parse(row.data) as { ask: string; step: string; scope: string };
      const r = runs.get(d.ask) ?? { ask: d.ask, scope: d.scope, repo: row.repo ?? '', paused: false };
      if (d.step === 'paused') r.paused = true;
      runs.set(d.ask, r);
    }
    const only = typeof repo === 'string' && repo ? real(await git(repo, 'rev-parse', '--show-toplevel').catch(() => repo)) : undefined;
    return [...runs.values()].filter((r) => !only || real(r.repo) === only);
  }
  /** The newest `work.state` of each issue in a run. */
  private async rows(ask: string): Promise<Row[]> {
    const rows = (await this.o.raw(`SELECT data FROM events WHERE kind = 'work.state' AND subject = ? ORDER BY log_pos`, [ask])) as { data: string }[];
    const last = new Map<number, Row>();
    for (const row of rows) {
      const d = JSON.parse(row.data) as Row;
      last.set(d.issue, { issue: d.issue, word: d.word, waits_on: d.waits_on, why: d.why });
    }
    return [...last.values()].sort((a, b) => a.issue - b.issue);
  }
  /** Each issue's attempts under a run, in order. */
  private async attempts(ask: string): Promise<Map<number, Attempt[]>> {
    const rows = (await this.o.raw(`SELECT data FROM events WHERE kind = 'work.attempt' AND subject = ? ORDER BY log_pos`, [ask])) as { data: string }[];
    const out = new Map<number, Attempt[]>();
    for (const row of rows) {
      const d = JSON.parse(row.data) as Obj;
      const list = out.get(Number(d.issue)) ?? [];
      if (d.step === 'started') list.push({ attempt: Number(d.attempt), run: String(d.run), agent: String(d.agent), model: null, worktree: String(d.worktree), branch: String(d.branch), reason: String(d.reason), ended: null });
      else { const a = list.find((x) => x.attempt === Number(d.attempt)); if (a) { a.ended = { cause: String(d.cause), verdict: (d.verdict as string | null) ?? null, model: (d.model as string | null) ?? null }; a.model = a.ended.model; } }
      out.set(Number(d.issue), list);
    }
    return out;
  }
  /** What landed last for each issue of a repo: its outcome, the requirements it left open, and its head and commit. */
  private async landed(repo: string): Promise<Map<number, Landed>> {
    const rows = (await this.o.raw(`SELECT data FROM events WHERE kind = 'landing.made' AND json_extract(data, '$.step') = 'landed' AND json_extract(data, '$.repo') = ? ORDER BY log_pos`, [repo])) as { data: string }[];
    const out = new Map<number, Landed>();
    for (const row of rows) {
      const d = JSON.parse(row.data) as { issue: number; outcome: string; open: string[]; pr: number; head: string | null; commit: string | null };
      out.set(d.issue, { outcome: d.outcome, open: d.open ?? [], pr: d.pr, head: d.head, commit: d.commit });
    }
    return out;
  }
  /**
   * The calls raised on a repo's issues (#1345), oldest first, each as it stands: open, or closed by your answer, a
   * decision of yours, its default or the rest of the closed set. An undone default opens it again.
   */
  private async callsOf(repo: string): Promise<CallRow[]> {
    const made = ((await this.o.raw(`SELECT id, data FROM events WHERE kind = 'ask.created' AND writer = 'core' AND json_extract(data, '$.kind') = 'taste' AND json_extract(data, '$.subject.screen') IS NOT NULL ORDER BY log_pos`)) as { id: string; data: string }[])
      .map((r) => ({ id: r.id, d: JSON.parse(r.data) as Obj })).filter((r) => isObj(r.d.subject) && String(r.d.subject.screen).startsWith(`${repo}#`));
    if (!made.length) return [];
    const handles = made.map((r) => `ask:${r.id}`);
    const closes = (await this.o.raw(`SELECT kind, subject, data FROM events WHERE subject IN (${handles.map(() => '?').join(', ')}) AND kind IN ('ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot', 'decision.applied', 'default.undone') ORDER BY log_pos`, handles)) as { kind: string; subject: string; data: string }[];
    const decided = closes.some((c) => c.kind === 'decision.applied')
      ? new Map(((await this.o.raw(`SELECT id, json_extract(data, '$.answer') AS answer FROM events WHERE kind = 'decision.created'`)) as { id: string; answer: string }[]).map((r) => [`decision:${r.id}`, r.answer]))
      : new Map<string, string>();
    return made.map(({ id, d }) => {
      const handle = `ask:${id}`;
      const last = closes.filter((c) => c.subject === handle).at(-1);
      const e = last ? JSON.parse(last.data) as Obj : {};
      const answer = !last || last.kind === 'default.undone' ? null
        : last.kind === 'decision.applied' ? decided.get(String(e.decision)) ?? null : typeof e.option === 'string' ? e.option : typeof e.answer === 'string' ? e.answer : null;
      return {
        handle, issue: Number(String((d.subject as Obj).screen).slice(repo.length + 1)), head: String((d.pinned_to as Obj | undefined)?.ref ?? ''), text: String((d.subject as Obj).element),
        open: !last || last.kind === 'default.undone', answer, how: last && last.kind !== 'default.undone' ? last.kind : null, words: typeof e.words === 'string' ? e.words : null,
      };
    });
  }
  /**
   * Raises a call for a requirement whose oracle is you (#1345): Yes, the recommended answer and its default, or Send
   * back. One per requirement and head, so the same change never asks twice; a claim judged again on it is told the
   * call, and the answer once it came. An issue's calls keep a thread of their own: no attempt or judgement of its task
   * claims there, so none of them makes a call moot, and calls from several issues never fold into one exception.
   */
  private raiser(repo: string): RaiseCall {
    return async (c) => {
      const had = (await this.callsOf(repo)).find((x) => x.issue === c.issue && x.head === c.head && x.text === c.text);
      const screen = `${repo}#${c.issue}`;
      const session = `calls${repo.replace(/[^0-9A-Za-z]/g, '')}x${c.issue}`;
      const handle = had?.handle ?? await this.o.asks().raise({ writer: 'core', actor: 'you', scope: 'you', session }, 'work.call', {
        kind: 'taste',
        question: `Is "${c.text}" true of #${c.issue}'s change? Before: main at ${c.main.slice(0, 12)}; after: PR #${c.pr} at ${c.head.slice(0, 12)}${c.reaches ? `, which reaches ${c.reaches}, so it waits for your answer` : ', which lands now and Send back reverts'}.`.slice(0, 8192),
        options: [{ id: YES, label: 'Yes', decision: 'none' }, { id: SEND_BACK, label: 'Send back', decision: 'none' }],
        recommended: YES, fallback: 'you', provisional: false, owner: 'you', key: key({ kind: 'work.call', screen, element: c.text }),
        pinned_to: { kind: 'commit', ref: c.head }, subject: { screen, element: c.text.slice(0, 8192) },
      });
      const claims = this.asked.get(handle) ?? [];
      if (!claims.some((x) => x.claim === c.claim)) this.asked.set(handle, [...claims, { claim: c.claim, req: c.req }]);
      await this.o.answered(c.claim, c.req, handle, had && !had.open ? answerOf(had) : undefined);
      return handle;
    };
  }
  /** Whether calls are on for a run (#1345): only a standing rule, or a topic's card, turns them on. */
  private async callsOn(ask: string, approval: Approval): Promise<boolean> {
    if (approval.rule) return true;
    return ((await this.o.raw(`SELECT 1 FROM events WHERE kind = 'brief.drafted' AND json_extract(data, '$.ask') = ? LIMIT 1`, [ask])) as unknown[]).length > 0;
  }
  /** The asks still open: who raised each, and its key. */
  private async openAsks(): Promise<OpenAsk[]> {
    const rows = (await this.o.raw(`SELECT c.id AS id, c.session_id AS session, c.writer AS writer, json_extract(c.data, '$.key') AS key, json_extract(c.data, '$.provisional') AS provisional FROM events c WHERE c.kind = 'ask.created'
      AND NOT EXISTS (SELECT 1 FROM events e WHERE e.subject = 'ask:' || c.id AND e.kind IN ('ask.answered', 'ask.defaulted', 'ask.cancelled', 'ask.moot', 'ask.superseded', 'decision.applied'))`)) as { id: string; session: string | null; writer: string; key: string | null; provisional: number | null }[];
    return rows.map((r) => ({ handle: `ask:${r.id}`, session: r.session, key: r.key ?? '', writer: r.writer, provisional: r.provisional === 1 }));
  }
  /**
   * The breaker on an issue: how many of its asks you answered to try again, which sets the count it trips at next,
   * and whether the current one was raised and how it stands (open, or answered to leave the issue waiting).
   */
  private async breakerOf(ask: string, issue: number): Promise<{ level: number; raised: 'open' | 'left' | null; handle: string | null }> {
    const keys = Array.from({ length: 16 }, (_, level) => this.breakerKey(ask, issue, level));
    const rows = (await this.o.raw(`SELECT 'ask:' || c.id AS handle, json_extract(c.data, '$.key') AS key, (SELECT json_extract(y.data, '$.answer') FROM events y WHERE y.subject = 'ask:' || c.id AND y.kind IN ('ask.answered', 'ask.defaulted') ORDER BY y.log_pos LIMIT 1) AS answer
      FROM events c WHERE c.kind = 'ask.created' AND json_extract(c.data, '$.key') IN (${keys.map(() => '?').join(', ')})`, keys)) as { handle: string; key: string; answer: string | null }[];
    const level = rows.filter((r) => r.answer === 'again').length;
    const current = rows.find((r) => r.key === keys[level]);
    return { level, raised: current ? (current.answer === null ? 'open' : 'left') : null, handle: current?.handle ?? null };
  }
  private breakerKey(ask: string, issue: number, level: number): string { return key({ kind: 'work.breaker', ask, issue, level }); }

  // ---- The forge.

  private async get(path: string): Promise<{ status: number; body: unknown }> {
    const token = await this.o.token();
    const res = await fetch(`${this.o.api}${path}`, { signal: AbortSignal.timeout(30_000), headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    const text = await res.text();
    let body: unknown;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
    return { status: res.status, body };
  }
  /** The login your token goes by: a PR of yours from before the run is its issue's attempt. */
  private async login(): Promise<string | undefined> {
    if (this.you === undefined) { const r = await this.get('/user'); if (r.status === 200 && isObj(r.body)) this.you = String(r.body.login); }
    return this.you;
  }
  private async slugOf(checkout: string): Promise<string> {
    const origin = await git(checkout, 'remote', 'get-url', 'origin');
    const repo = this.o.repoOf(origin.replace(/^https?:\/\/[^/]+\/(?=github\.com\/)/, 'https://'));
    if (!repo) throw Error(`${checkout}'s origin (${origin}) names no forge repository`);
    return repo;
  }
  /**
   * The set's issues, with the issues they're blocked by (the forge's blocked-by links and the body's Depends on list),
   * and every PR that links an issue; read at most every 30 s unless the run changed something.
   */
  private async read(repo: string, set: number[], fresh: boolean, known?: ReadonlyMap<number, Issue>): Promise<{ issues: Map<number, Issue>; pulls: Pull[]; reverts: Revert[] }> {
    const kept = this.forge.get(repo);
    if (kept && !fresh && this.o.now() - kept.at < FORGE_MS && set.every((n) => kept.issues.has(n))) return kept;
    const issues = new Map<number, Issue>();
    const want = [...set];
    for (let i = 0; i < want.length; i++) {
      const n = want[i]!;
      if (issues.has(n)) continue;
      // A standing run's open issues come from the forge's list, their links from its cache (#1335).
      const listed = known?.get(n);
      if (listed) {
        issues.set(n, listed);
        if (Array.isArray(listed.blockers)) for (const b of listed.blockers) if (!want.includes(b)) want.push(b);
        continue;
      }
      const r = await this.get(`/repos/${repo}/issues/${n}`);
      if (r.status !== 200 || !isObj(r.body)) { issues.set(n, { n, open: true, title: '', body: '', blockers: { unread: `#${n}, which the forge answered ${r.status} for` } }); continue; }
      const body = String(r.body.body ?? '');
      const links = await this.get(`/repos/${repo}/issues/${n}/dependencies/blocked_by`);
      const blockers = links.status === 200 && Array.isArray(links.body)
        ? [...new Set([...links.body.filter(isObj).map((b) => Number(b.number)), ...dependsOn(body)])].sort((a, b) => a - b)
        : { unread: `#${n}'s blocked-by links, which the forge answered ${links.status} for` };
      issues.set(n, { n, open: r.body.state === 'open', title: String(r.body.title ?? ''), body, blockers });
      // A blocker outside the set is read too, to know whether it's done.
      if (Array.isArray(blockers)) for (const b of blockers) if (!want.includes(b)) want.push(b);
    }
    const pulls: Pull[] = [];
    const reverts: Revert[] = [];
    for (let page = 1; ; page++) {
      const r = await this.get(`/repos/${repo}/pulls?state=all&per_page=100&page=${page}`);
      if (r.status !== 200 || !Array.isArray(r.body) || !r.body.length) break;
      for (const p of r.body.filter(isObj)) {
        const head = isObj(p.head) ? p.head : {};
        // Main watch's revert of a landing (#1333), merged: a standing run's breaker counts these.
        const reverted = /^main-watch\/revert-([0-9a-f]{7,40})$/.exec(String(head.ref ?? ''));
        if (reverted && typeof p.merged_at === 'string') reverts.push({ pr: Number(p.number), landing: reverted[1]!, at: Date.parse(p.merged_at) });
        const link = LINKS.exec(typeof p.body === 'string' ? p.body : '');
        if (!link) continue;
        pulls.push({ pr: Number(p.number), issue: Number(link[2]), login: isObj(p.user) ? String(p.user.login) : '', open: p.state === 'open', merged: Boolean(p.merged_at), branch: String(head.ref ?? ''), head: String(head.sha ?? '') });
      }
      if (r.body.length < 100) break;
    }
    const read = { at: this.o.now(), issues, pulls, reverts };
    this.forge.set(repo, read);
    return read;
  }
  /** The issues the baseline commit lists as closed before the gate: the file as the commit that added it holds it, set once. */
  private async baseline(checkout: string): Promise<Set<number>> {
    const added = (await git(checkout, 'log', '--diff-filter=A', '--format=%H', 'refs/remotes/origin/main', '--', BASELINE).catch(() => '')).split('\n').filter(Boolean).at(-1);
    if (!added) return new Set();
    const text = await git(checkout, 'show', `${added}:${BASELINE}`).catch(() => '');
    try {
      const list = (JSON.parse(text) as { closed_before_gate?: unknown }).closed_before_gate;
      return new Set(Array.isArray(list) ? list.filter((n): n is number => Number.isSafeInteger(n)) : []);
    } catch { return new Set(); }
  }

  // ---- A standing run's set (#1335).

  /**
   * A standing run's set: the open issues that meet its rule and are ready to join, with those that joined before.
   * One that meets the rule but isn't ready stays out, with why, and no ask; one that joined and no longer meets the
   * rule leaves. Each joined issue's milestone sets the order, earliest first.
   */
  private async readRule(ask: string, repo: string, checkout: string, rule: Rule, fresh: boolean): Promise<Read> {
    const listed = await this.listOpen(repo, fresh);
    const rows = await this.rows(ask);
    const joined = new Set(rows.map((r) => r.issue));
    const under = rule.epic !== null ? await this.underEpic(repo, rule.epic, fresh) : undefined;
    const out = new Map<number, string>();
    const set: number[] = [];
    const known = new Map<number, Issue>();
    const milestones = new Map<number, Listed['milestone']>();
    for (const i of [...listed.values()].sort((a, b) => a.n - b.n)) {
      // Outside the rule: its structure, its author (only you or a collaborator, never an outside author or an agent),
      // or a Runs on: line this host can't serve. Such an issue isn't named, unless it had joined and left.
      const machine = unserved(i.body);
      if (!meets(rule, i, under) || !authored(rule, i, (login) => this.o.starts().isAgentLogin(login)) || machine) {
        if (joined.has(i.n)) out.set(i.n, machine ? `#${i.n}'s Runs on: line names ${machine}, which this host can't serve` : `#${i.n} no longer meets the run's rule`);
        continue;
      }
      const blockers = await this.linksOf(repo, i);
      const why = joined.has(i.n) ? undefined : await whyOut(i, { repo, doc: (path) => this.doc(checkout, path), blockers });
      if (why) { out.set(i.n, why); continue; }
      set.push(i.n);
      known.set(i.n, { n: i.n, open: true, title: i.title, body: i.body, blockers });
      milestones.set(i.n, i.milestone);
    }
    // An issue that joined and has closed since keeps its place until its row reads landed or closed; then it's done
    // with, and the forge isn't read for it again.
    const final = new Set(['PASS', 'closed', 'closed before the gate']);
    for (const r of rows) if (!listed.has(r.issue) && !set.includes(r.issue) && !final.has(r.word)) set.push(r.issue);
    return { ...(await this.read(repo, set, fresh, known)), set, out, milestones };
  }
  /** The repo's open issues, pull requests left out, as the forge lists them a page at a time; read at most every 30 s. */
  private async listOpen(repo: string, fresh: boolean): Promise<Map<number, Listed & { updated: string }>> {
    const kept = this.lists.get(repo);
    if (kept && !fresh && this.o.now() - kept.at < FORGE_MS) return kept.open;
    const open = new Map<number, Listed & { updated: string }>();
    for (let page = 1; ; page++) {
      const r = await this.get(`/repos/${repo}/issues?state=open&per_page=100&page=${page}`);
      if (r.status !== 200 || !Array.isArray(r.body)) throw Error(`the forge answered ${r.status} for ${repo}'s open issues, page ${page}`);
      for (const x of r.body.filter(isObj)) {
        if (x.pull_request !== undefined) continue;
        const user = isObj(x.user) ? x.user : {};
        const m = isObj(x.milestone) ? x.milestone : null;
        open.set(Number(x.number), {
          n: Number(x.number), title: String(x.title ?? ''), body: String(x.body ?? ''), updated: String(x.updated_at ?? ''),
          labels: Array.isArray(x.labels) ? x.labels.map((l) => (isObj(l) ? String(l.name ?? '') : String(l))).filter(Boolean) : [],
          milestone: m ? { number: Number(m.number), title: String(m.title ?? ''), due: typeof m.due_on === 'string' ? Date.parse(m.due_on) : null } : null,
          author: String(user.login ?? ''), role: String(x.author_association ?? 'NONE'),
          // An app's or a bot's issue is what an agent writes.
          app: user.type === 'Bot' || isObj(x.performed_via_github_app),
        });
      }
      if (r.body.length < 100) break;
    }
    this.lists.set(repo, { at: this.o.now(), open });
    return open;
  }
  /** An issue's blocked-by links, the forge's and its Depends on list's, read again once the issue changed or after 5 minutes. */
  private async linksOf(repo: string, i: Listed & { updated: string }): Promise<number[] | { unread: string }> {
    const at = `${repo}#${i.n}`;
    const kept = this.links.get(at);
    if (kept && kept.updated === i.updated && this.o.now() - kept.at < LINKS_MS) return kept.blockers;
    const links = await this.get(`/repos/${repo}/issues/${i.n}/dependencies/blocked_by`);
    const blockers = links.status === 200 && Array.isArray(links.body)
      ? [...new Set([...links.body.filter(isObj).map((b) => Number(b.number)), ...dependsOn(i.body)])].sort((a, b) => a - b)
      : { unread: `#${i.n}'s blocked-by links, which the forge answered ${links.status} for` };
    this.links.set(at, { updated: i.updated, at: this.o.now(), blockers });
    return blockers;
  }
  /** The issues the forge lists under an epic as its sub-issues; none when it lists none. */
  private async underEpic(repo: string, epic: number, fresh: boolean): Promise<Set<number>> {
    const at = `${repo}#${epic}`;
    const kept = this.epics.get(at);
    if (kept && !fresh && this.o.now() - kept.at < FORGE_MS) return kept.under;
    const under = new Set<number>();
    for (let page = 1; ; page++) {
      const r = await this.get(`/repos/${repo}/issues/${epic}/sub_issues?per_page=100&page=${page}`);
      if (r.status !== 200 || !Array.isArray(r.body)) break;
      for (const x of r.body.filter(isObj)) under.add(Number(x.number));
      if (r.body.length < 100) break;
    }
    this.epics.set(at, { at: this.o.now(), under });
    return under;
  }
  /** A file on the checkout's default branch as its remote holds it, for a design link to land in; undefined when it has none. */
  private async doc(checkout: string, path: string): Promise<string | undefined> {
    const ref = await git(checkout, 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/HEAD^{commit}').catch(() => git(checkout, 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main^{commit}')).catch(() => git(checkout, 'rev-parse', '--verify', '--quiet', 'refs/heads/main^{commit}')).catch(() => '');
    if (!ref) return undefined;
    const at = `${checkout}\n${ref}:${path}`;
    // Kept for the default branch's head alone: a landing moves it, and the files are read again there.
    if (!this.docs.has(at)) {
      for (const k of this.docs.keys()) if (k.startsWith(`${checkout}\n`) && !k.startsWith(`${checkout}\n${ref}:`)) this.docs.delete(k);
      this.docs.set(at, await git(checkout, 'show', `${ref}:${path}`).catch(() => undefined));
    }
    return this.docs.get(at);
  }

  /** A standing run's issues that stay out, each named with why whenever that changes: a reading on the run's page, never an ask. */
  private async recordOut(ask: string, out: Map<number, string>): Promise<void> {
    const kept = await this.outOf(ask);
    for (const [issue, why] of out) if (kept.get(issue) !== why.slice(0, 2000)) await this.o.appendCore('work.left', { ask, issue, why: why.slice(0, 2000) }, { subject: ask });
    for (const issue of kept.keys()) if (!out.has(issue)) await this.o.appendCore('work.left', { ask, issue, why: null }, { subject: ask });
  }
  /** The issues a standing run's page names as staying out, and why, as the record holds them. */
  private async outOf(ask: string): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    for (const row of (await this.o.raw(`SELECT data FROM events WHERE kind = 'work.left' AND subject = ? ORDER BY log_pos`, [ask])) as { data: string }[]) {
      const d = JSON.parse(row.data) as { issue: number; why: string | null };
      if (d.why === null) out.delete(d.issue); else out.set(d.issue, d.why);
    }
    return out;
  }
  /**
   * A standing run's weekly notice (#1335): once a week from your yes, what it landed, what is left and what it spent,
   * recorded for its page and needing no answer. A week the hub was down for comes as one notice, not one per week.
   */
  private async weekly(ask: string, repo: string): Promise<void> {
    const [yes] = (await this.o.raw(`SELECT ts FROM events WHERE kind = 'ask.answered' AND subject = ? ORDER BY log_pos LIMIT 1`, [ask])) as { ts: number }[];
    if (!yes) return;
    const [last] = (await this.o.raw(`SELECT json_extract(data, '$.to') AS until FROM events WHERE kind = 'work.notice' AND subject = ? ORDER BY log_pos DESC LIMIT 1`, [ask])) as { until: number }[];
    const from = last?.until ?? yes.ts;
    const weeks = Math.floor((this.o.now() - from) / WEEK);
    if (weeks < 1) return;
    const to = from + weeks * WEEK;
    const rows = await this.rows(ask);
    const landed = ((await this.o.raw(`SELECT DISTINCT json_extract(data, '$.issue') AS issue FROM events WHERE kind = 'landing.made' AND json_extract(data, '$.step') = 'landed' AND json_extract(data, '$.repo') = ? AND ts >= ? AND ts < ?`, [repo, from, to])) as { issue: number }[])
      .map((r) => Number(r.issue)).filter((n) => rows.some((r) => r.issue === n)).sort((a, b) => a - b);
    const left = rows.filter((r) => !['PASS', 'closed', 'closed before the gate'].includes(r.word)).map((r) => ({ issue: r.issue, word: r.word }));
    // What it spent: the attempts it started in the week, and what their sessions' usage says they cost where priced.
    const started = ((await this.o.raw(`SELECT json_extract(data, '$.run') AS run FROM events WHERE kind = 'work.attempt' AND subject = ? AND json_extract(data, '$.step') = 'started' AND ts >= ? AND ts < ?`, [ask, from, to])) as { run: string }[]).map((r) => r.run);
    const sessions = started.map((run) => this.o.starts().sessionOfRun(run)).filter((s): s is string => Boolean(s));
    let usd: number | null = null;
    let tokens = 0;
    if (sessions.length) {
      const usage = (await this.o.raw(`SELECT session_id AS session, data FROM events WHERE kind = 'turn.usage' AND session_id IN (${sessions.map(() => '?').join(', ')}) ORDER BY log_pos`, sessions)) as { session: string; data: string }[];
      const per = new Map<string, { usd: number | null; tokens: number }>();
      for (const u of usage) {
        const d = JSON.parse(u.data) as { covers: string; tokens?: { input: number; cached: number; output: number }; cost?: { usd?: number } };
        const was = per.get(u.session) ?? { usd: null, tokens: 0 };
        const t = d.tokens ? d.tokens.input + d.tokens.cached + d.tokens.output : 0;
        // A session's reading covers it so far; a turn's adds to the ones before.
        per.set(u.session, d.covers === 'session' ? { usd: d.cost?.usd ?? was.usd, tokens: t } : { usd: d.cost?.usd !== undefined ? (was.usd ?? 0) + d.cost.usd : was.usd, tokens: was.tokens + t });
      }
      for (const p of per.values()) { tokens += p.tokens; if (p.usd !== null) usd = (usd ?? 0) + p.usd; }
    }
    await this.o.appendCore('work.notice', { ask, from, to, landed, left, spent: { attempts: started.length, sessions: sessions.length, usd: usd === null ? null : Math.round(usd * 100) / 100, tokens } }, { subject: ask });
  }

  // ---- A workspace's tasks (#1347).

  /** A workspace run's tasks as the record holds them, each with what it's blocked by; a workspace has no pull requests. */
  private async readSpace(id: string, set: number[]): Promise<{ issues: Map<number, Issue>; pulls: Pull[] }> {
    // The planted wrong program reads each task from a forge too, as a repo's run reads its issues.
    if (this.o.plant === 'workspace-calls-forge') for (const n of set) await this.get(`/repos/${id}/tasks/issues/${n}`).catch(() => undefined);
    const issues = new Map<number, Issue>();
    for (const t of await this.o.spaces().tasksOf(id)) issues.set(t.task, { n: t.task, open: t.step !== 'finished', title: t.title, body: t.criteria.join('; '), blockers: t.blocked_by });
    for (const n of set) if (!issues.has(n)) issues.set(n, { n, open: true, title: '', body: '', blockers: { unread: `#${n}, which the workspace has no task for` } });
    return { issues, pulls: [] };
  }
  /** The tasks that finished in a workspace: a PASS covered each one's change on main. */
  private async finishedIn(id: string): Promise<Map<number, Landed>> {
    const out = new Map<number, Landed>();
    for (const t of await this.o.spaces().tasksOf(id)) if (t.step === 'finished' && t.commit) out.set(t.task, { outcome: 'PASS', open: [], pr: 0, at: t.commit });
    return out;
  }
  /**
   * A workspace attempt settled, as a pull request's is but with no forge: once its turn ends, a branch that moved is
   * judged on its merge with the workspace's main and finishes there on a PASS. Passes run one at a time, so tasks
   * finish one at a time, in the order their PASSes came. Whether it ended.
   */
  private async settleSpace(ask: string, approval: Approval, space: string, issue: number, a: Attempt, asks: OpenAsk[]): Promise<boolean> {
    if (this.closed) return false;
    const starts = this.o.starts();
    const live = starts.live(a.run);
    const session = starts.sessionOfRun(a.run);
    if (live && session && asks.some((x) => x.session === session)) {
      await starts.stop(a.run);
      return this.end(ask, issue, a, 'gave up its slot', 'its task waits on your answer');
    }
    if (live && (!session || !(await this.turnEnded(session)))) return false;
    const { base } = await starts.treeOf(a.run);
    const head = await git(approval.repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${a.branch}`).catch(() => '');
    if (head && head !== base && this.heads.get(a.branch)?.head !== head) {
      const r = await this.finish(space, approval.repo, issue, head);
      this.heads.set(a.branch, { head, held: 'held' in r ? r.held : null });
      if (!('held' in r)) {
        if (live) await starts.stop(a.run);
        return this.end(ask, issue, a, 'PASS', `finished at ${r.commit}`);
      }
    }
    const held = this.heads.get(a.branch)?.head === head ? this.heads.get(a.branch)?.held : undefined;
    if (held) {
      if (live) await starts.stop(a.run);
      return this.end(ask, issue, a, 'sent back past its rounds', held);
    }
    if (live) {
      if ((await this.state(a.worktree).catch(() => '')) !== (this.snapshots.get(a.run) ?? `${base}\n`)) return false;
      await starts.stop(a.run);
      return this.end(ask, issue, a, 'stalled', 'its turn ended with nothing changed in its worktree');
    }
    const ended = await starts.endOf(a.run);
    return this.end(ask, issue, a, ended.never ? 'stalled' : 'crashed or interrupted', ended.never ? 'it wrote no first event within 60 s' : 'its session ended before its change finished');
  }
  /** A task's change judged on its merge with the workspace's main and, on a PASS, main moved to that merge, the version before it kept. */
  private async finish(space: string, folder: string, n: number, head: string): Promise<{ commit: string } | { held: string }> {
    const task = (await this.o.spaces().tasksOf(space)).find((t) => t.task === n);
    if (!task) return { held: `the workspace has no task #${n}` };
    const main = await git(folder, 'rev-parse', 'refs/heads/main');
    const merged = await mergeOf(folder, main, head);
    if ('files' in merged) return { held: `its change no longer merges with the workspace's main (${main.slice(0, 12)}): ${merged.files.join(', ')} conflict` };
    const item: WorkItem = { source_id: task.source_id, link: task.link, title: task.title, body: task.criteria.join('\n'), criteria: task.criteria, authors: task.authors, updated: task.updated };
    const v = await this.o.judgeTask({ folder, item, commit: merged.commit, session: `task${space}x${n}x${this.o.now()}x${++this.judgements}` }).catch(() => undefined);
    if (!v) return { held: 'BLOCKED: no verdict was made on its merge with main: its definition did not lock or its checks did not end' };
    if (v.outcome !== 'PASS' && !onlyWindow(v)) return { held: `${v.outcome}: ${v.requirements.filter((q) => q.outcome !== 'PASS').map((q) => `${q.req} ${q.outcome}`).join(', ') || 'not every requirement passed'}` };
    // Main moves only here, from the merge its PASS covered; a commit made in the folder meanwhile holds it.
    const moved = await git(folder, '-c', 'core.hooksPath=/dev/null', 'merge', '--ff-only', '-q', merged.commit).then(() => '', (error: Error) => error.message);
    if (moved) return { held: `the workspace's main moved past ${main.slice(0, 12)}, so its PASS no longer covers it: ${moved}` };
    await this.o.spaces().finished(space, n, merged.commit, main);
    return { commit: merged.commit };
  }

  // ---- A pass.

  private pass(): Promise<void> {
    this.passing ??= (async () => {
      for (const r of await this.runs()) await this.passRun(r).catch((error: unknown) => process.stderr.write(`deep hub: work run ${r.ask}: ${error instanceof Error ? error.message : String(error)}\n`));
      // Briefs (#1342): one a restart left half done carries on, and a held step that is due asks.
      await this.o.due?.().catch((error: unknown) => process.stderr.write(`deep hub: briefs: ${error instanceof Error ? error.message : String(error)}\n`));
    })().finally(() => { this.passing = undefined; });
    return this.passing;
  }

  private async passRun(run: { ask: string; paused: boolean }): Promise<void> {
    const approval = await this.o.starts().approvalOf(run.ask);
    if (!approval) return;
    // A workspace's run reads its tasks from the record, and never a forge.
    const space = this.o.spaces().idAt(approval.repo);
    const repo = space ?? await this.slugOf(approval.repo);
    // A standing run (#1335) takes its set from its rule each pass, as the forge holds the issues then.
    const rule = space ? null : approval.rule ?? null;
    // Calls on you hold no reversible change (#1345), under a standing rule or a topic's card only.
    const on = !space && await this.callsOn(run.ask, approval);
    const readAll = async (fresh: boolean): Promise<Read> => {
      const none = { out: new Map<number, string>(), milestones: new Map<number, Listed['milestone']>() };
      if (space) return { ...(await this.readSpace(space, approval.issues)), reverts: [], set: approval.issues, ...none };
      if (rule) return this.readRule(run.ask, repo, approval.repo, rule, fresh);
      return { ...(await this.read(repo, approval.issues, fresh)), set: approval.issues, ...none };
    };
    let attempts = await this.attempts(run.ask);
    let read = await readAll(false);
    let { issues, pulls } = read;
    // An attempt whose turn ended may have just opened its PR: the forge is read again for it, at most every 5 s.
    const starts = this.o.starts();
    const opened = async (): Promise<boolean> => {
      for (const list of attempts.values()) {
        const a = list.at(-1);
        const session = a && !a.ended ? starts.sessionOfRun(a.run) : undefined;
        if (session && !pulls.some((p) => p.open && p.branch === a!.branch) && (await this.turnEnded(session))) return true;
      }
      return false;
    };
    if (!space && this.o.now() - (this.forge.get(repo)?.at ?? 0) >= PR_MS && (await opened())) ({ issues, pulls } = read = await readAll(true));
    let asks = await this.openAsks();
    // Each live attempt first: landed, waiting on you, replaced or ended, each with its cause.
    let changed = false;
    for (const [issue, list] of attempts) {
      const a = list.at(-1);
      if (a && !a.ended) changed = (await (space ? this.settleSpace(run.ask, approval, space, issue, a, asks) : this.settle(run.ask, approval, repo, read.set, issue, a, pulls, asks, on))) || changed;
    }
    if (changed) {
      attempts = await this.attempts(run.ask);
      ({ issues, pulls } = read = await readAll(true));
      asks = await this.openAsks();
    }
    const { set, out, milestones } = read;
    // Each closed call's answer reaches the claims it asks about, once (#1345).
    const calls = on ? await this.callsOf(repo) : [];
    for (const c of calls.filter((x) => !x.open)) {
      for (const at of this.asked.get(c.handle) ?? []) {
        const k = `${c.handle} ${at.claim} ${answerOf(c)}`;
        if (this.done.has(k)) continue;
        this.done.set(k, null);
        await this.o.answered(at.claim, at.req, c.handle, answerOf(c)).catch(() => undefined);
      }
    }
    const landed = space ? await this.finishedIn(space) : await this.landed(repo);
    const baseline = space ? new Set<number>() : await this.baseline(approval.repo);
    const login = space ? undefined : await this.login();
    /** Whether a blocker is done for its dependents, else what they wait for. */
    const done = (n: number): string | undefined => {
      const l = landed.get(n);
      // The planted wrong program keeps dependents waiting for the window, as if only a PASS were done.
      if (l && (l.outcome === 'PASS' || (l.open.length && this.o.plant !== 'waits-for-budget-window'))) return undefined;
      // The planted wrong program takes an attempt that said done, its PR open, for a change that landed.
      if (this.o.plant === 'starts-before-blockers-done' && attempts.get(n)?.some((a) => a.ended?.cause === 'PASS')) return undefined;
      if (baseline.has(n)) return undefined;
      const i = issues.get(n);
      if (i && !Array.isArray(i.blockers) && !i.title) return i.blockers.unread;
      const unmerged = pulls.find((p) => p.issue === n && !p.merged);
      if (i && !i.open && unmerged) return `#${n}'s PR #${unmerged.pr}, which hasn't merged`;
      if (i && !i.open) return `#${n}, closed with no change of it landed`;
      return l?.open.length ? `#${n}'s budget window` : `#${n}`;
    };
    const rows = new Map<number, Row>();
    const ready: number[] = [];
    for (const n of set) {
      const i = issues.get(n)!;
      const list = attempts.get(n) ?? [];
      const last = list.at(-1);
      const l = landed.get(n);
      const row = (word: string, waits_on: string | null, why: string): void => { rows.set(n, { issue: n, word, waits_on, why }); };
      const sessions = new Set(list.map((a) => starts.sessionOfRun(a.run)).filter(Boolean));
      const asked = asks.find((x) => x.session && sessions.has(x.session));
      const replaced = this.replaced(list);
      const breaker = await this.breakerOf(run.ask, n);
      const mine = calls.filter((x) => x.issue === n);
      // A change that landed with calls open (#1345): your Send back reverts it, and once each call closed otherwise its
      // issue closes, saying how. Until then its issue waits on you.
      const onLanded = l?.head ? mine.filter((x) => x.head === l.head) : [];
      if (l && onLanded.length) {
        const back = onLanded.find((x) => x.answer === SEND_BACK && !x.open);
        const open = onLanded.filter((x) => x.open);
        if (back) {
          const k = `revert ${l.commit ?? l.pr}`;
          if (!this.done.has(k)) this.done.set(k, l.commit ? (await this.o.landing().revert(approval.repo, { issue: n, pr: l.pr, commit: l.commit, ask: back.handle, words: back.words }).catch((error: unknown) => (error instanceof Error ? error.message : String(error)))) ?? null : 'the forge named no commit for its landing');
          const failed = this.done.get(k);
          row('sent back', failed ? 'you' : null, failed ? `your Send back on ${back.handle} couldn't revert PR #${l.pr}'s landing: ${failed}` : `your Send back on ${back.handle} reverted PR #${l.pr}'s landing`);
          continue;
        }
        if (open.length) { row('needs you', 'you', `landed through PR #${l.pr} with its calls open: ${open.map((x) => `${x.handle}, "${x.text}"`).join('; ')}`); continue; }
        const yes = onLanded.every((x) => x.answer === YES && x.how !== 'ask.defaulted');
        const how = yes ? `you answered ${onLanded.map((x) => x.handle).join(', ')} yes` : `${onLanded.filter((x) => x.how !== 'ask.answered' && x.how !== 'decision.applied').map((x) => x.handle).join(', ')} took its recommended answer at its deadline, a default you can overrule`;
        const k = `close ${n} ${l.head}`;
        if (i.open && !this.done.has(k)) { this.done.set(k, null); await this.o.landing().closeAnswered(approval.repo, n, how).catch(() => this.done.delete(k)); }
        row(yes ? 'PASS' : 'INCONCLUSIVE', null, `landed through PR #${l.pr}; ${how}`);
        continue;
      }
      if (l?.outcome === 'PASS') { row('PASS', null, l.at ? `finished at ${l.at}` : `landed through PR #${l.pr}`); continue; }
      if (l?.open.length) { row(WORDS.has(l.outcome) ? l.outcome : 'INCONCLUSIVE', `the budget window: ${l.open.join('; ')}`, `landed through PR #${l.pr} with only the budget window's requirement open`); continue; }
      if (baseline.has(n)) { row('closed before the gate', null, `closed before the gate, as the baseline commit lists it; never PASS`); continue; }
      if (!i.open) { const p = pulls.find((x) => x.issue === n && !x.merged); row('closed', p ? `PR #${p.pr} to land` : null, 'closed on the forge with no change of it landed'); continue; }
      if (last && !last.ended) { row('working', null, `attempt ${last.attempt} in ${last.agent}: ${last.reason}`); continue; }
      if (this.o.plant === 'starts-before-blockers-done' && last?.ended?.cause === 'PASS') { row('says done', 'its change to land', String(last.ended.verdict)); continue; }
      // A change held for its calls, as one that reaches a release (#1345): your yes lands it, your Send back starts the
      // next attempt, and a default lands nothing that can't be undone.
      const pr = pulls.find((p) => p.issue === n && p.open && list.some((a) => a.branch === p.branch));
      const onHeld = pr ? mine.filter((x) => x.head === pr.head) : [];
      if (pr && onHeld.length && !onHeld.some((x) => x.answer === SEND_BACK && !x.open)) {
        const open = onHeld.filter((x) => x.open);
        if (open.length) { row('needs you', 'you', `its change waits for your answer to ${open.map((x) => x.handle).join(', ')}${this.judged.get(pr.pr)?.held ? `: ${this.judged.get(pr.pr)!.held}` : ''}`); continue; }
        if (!onHeld.every((x) => x.answer === YES && x.how !== 'ask.defaulted')) { row('INCONCLUSIVE', 'you', `${onHeld.map((x) => x.handle).join(', ')} took its recommended answer as a default, and a change that can't be undone lands only on your yes`); continue; }
        const k = `land ${pr.head}`;
        if (!this.done.has(k)) {
          this.done.set(k, null);
          const round = await this.o.landing().work(approval.repo, set, this.raiser(repo)).catch(() => undefined);
          if (!round?.landed.some((x) => x.issue === n)) setTimeout(() => this.done.delete(k), FORGE_MS).unref();
        }
        row('working', `PR #${pr.pr} to land`, `you answered ${onHeld.map((x) => x.handle).join(', ')} yes, so its change lands`);
        continue;
      }
      if (asked) { row('needs you', 'you', `its attempt waits on your answer to ${asked.handle}, so it gave up its slot`); continue; }
      if (breaker.raised === 'open') { row('needs you', 'you', `${replaced} attempts were replaced: ${breaker.handle} asks you`); continue; }
      if (breaker.raised === 'left') { row('queued', 'you', `${replaced} attempts were replaced, and you left it waiting (${breaker.handle})`); continue; }
      if (!Array.isArray(i.blockers)) { row('queued', i.blockers.unread, "a blocked-by link the forge can't read"); continue; }
      const waiting = i.blockers.flatMap((b) => { const why = done(b); return why ? [why] : []; });
      if (waiting.length) { row('queued', waiting.join(', '), `blocked by ${i.blockers.map((b) => `#${b}`).join(', ')}`); continue; }
      const other = pulls.find((p) => p.issue === n && p.open && !list.some((a) => a.branch === p.branch));
      // An open PR of yours from before the run joins as the issue's attempt (#1331): it's judged and landed, and no
      // second attempt starts beside it. One from another account keeps the issue waiting (#110).
      if (other && login && other.login === login) {
        if (this.judged.get(other.pr)?.head !== other.head) { this.judged.set(other.pr, { head: other.head, held: null }); await this.o.landing().work(approval.repo, set, on ? this.raiser(repo) : undefined).catch(() => undefined); }
        row('working', `PR #${other.pr} to land`, `PR #${other.pr}, from before the run, is its attempt`);
        continue;
      }
      if (other) { row('queued', `PR #${other.pr} from ${other.login || 'another account'}`, 'an open PR from another account links it'); continue; }
      const machine = unserved(i.body);
      if (machine) { row('queued', `a host that can serve ${machine}`, `its Runs on: line names ${machine}, which this host can't serve`); continue; }
      if (replaced >= BREAKER * (breaker.level + 1)) {
        await this.breaker(run.ask, n, list, breaker.level);
        row('needs you', 'you', `${replaced} attempts were replaced`);
        continue;
      }
      row(last?.ended?.cause === 'sent back past its rounds' ? 'sent back' : 'queued', 'a free slot', 'ready');
      ready.push(n);
    }
    // The order: a standing run's earliest milestone first (#1335), then the ready issue that unblocks most in the set,
    // then the lowest number.
    const unblocks = (n: number): number[] => set.filter((m) => { const b = issues.get(m)?.blockers; return Array.isArray(b) && b.includes(n) && rows.get(m)?.word !== 'PASS'; });
    ready.sort((a, b) => byMilestone(milestones.get(a) ?? null, milestones.get(b) ?? null) || unblocks(b).length - unblocks(a).length || a - b);
    const live = [...attempts.values()].filter((list) => { const a = list.at(-1); return a && !a.ended && starts.live(a.run); }).length;
    // A standing run's breaker (#1335) stops new starts until you answer its one ask.
    const tripped = rule ? await this.runBreaker(run.ask, repo, read.reverts) : undefined;
    const stopped = run.paused ? "the run's pause" : tripped ?? (approval.until !== null && this.o.now() >= approval.until ? `the run's end at ${new Date(approval.until).toISOString()}` : undefined);
    let free = stopped ? 0 : Math.max(0, approval.at_once - live);
    const before = new Map((await this.rows(run.ask)).map((r) => [r.issue, r]));
    for (const n of ready) {
      if (this.closed) return;
      if (stopped || free <= 0) { rows.set(n, { ...rows.get(n)!, waits_on: stopped ?? 'a free slot' }); continue; }
      // At its plan share a run starts nothing until the next window, and asks nothing (#1335).
      const list = attempts.get(n) ?? [];
      const held = starts.planHeld(approval, approval.agents[list.length % approval.agents.length]!);
      if (held) { rows.set(n, { ...rows.get(n)!, waits_on: held }); continue; }
      const blocked = unblocks(n);
      const milestone = milestones.get(n);
      const order = `${rule ? (milestone ? `its milestone ${milestone.title} is the earliest ready; ` : 'it is in no milestone, so after those in one; ') : ''}${blocked.length ? `it unblocks ${blocked.map((m) => `#${m}`).join(', ')}` : 'it unblocks none in the set'}, then the lowest number`;
      // A standing run's issue joins on the record before it starts: its start is checked against that.
      if (rule && !before.has(n)) { const r = rows.get(n)!; await this.o.appendCore('work.state', { ask: run.ask, issue: n, word: r.word, waits_on: r.waits_on, why: r.why }, { subject: run.ask }); before.set(n, r); }
      const r = await this.start(run.ask, approval, n, issues.get(n)!, list, order, space !== undefined, calls.filter((x) => x.issue === n && x.answer === SEND_BACK && !x.open).at(-1));
      if (r.started) { rows.set(n, { issue: n, word: 'working', waits_on: null, why: r.why }); free--; }
      else rows.set(n, { ...rows.get(n)!, waits_on: r.why });
    }
    // Each row whose word or wait changed is recorded.
    for (const r of rows.values()) {
      const b = before.get(r.issue);
      if (b && b.word === r.word && b.waits_on === r.waits_on) continue;
      await this.o.appendCore('work.state', { ask: run.ask, issue: r.issue, word: r.word, waits_on: r.waits_on?.slice(0, 8192) ?? null, why: r.why.slice(0, 2000) }, { subject: run.ask });
    }
    if (rule) {
      await this.recordOut(run.ask, out);
      await this.weekly(run.ask, repo);
    }
  }

  // ---- Attempts.

  /** Attempts that ended on any cause but a landing or a wait on you: counted across agents and models. */
  private replaced(list: Attempt[]): number {
    // The planted wrong program counts the last attempt's agent's alone.
    const counted = this.o.plant === 'breaker-counts-per-agent' ? list.filter((a) => a.agent === list.at(-1)?.agent) : list;
    return counted.filter((a) => a.ended && !KEPT.has(a.ended.cause)).length;
  }

  /** A next attempt, in the approved agent whose turn it is, in the issue's worktree when an earlier attempt made one. */
  private async start(ask: string, approval: Approval, n: number, issue: Issue, list: Attempt[], order: string, task = false, back?: CallRow): Promise<{ started: boolean; why: string }> {
    const k = list.length;
    const agent = approval.agents[k % approval.agents.length]!;
    const turn = approval.agents.length > 1 ? `${agent}'s turn, as the approved agents take turns` : `${agent}, the approved agent`;
    const last = list.at(-1);
    // A next attempt goes on where the last one left off, unless that one's change landed: it starts again from main (#1345).
    const tree = last && !LANDED.has(last.ended?.cause ?? '') ? await this.o.starts().treeOf(last.run) : undefined;
    const before = tree ? await this.state(tree.path) : undefined;
    const r = await this.o.starts().runStart({ ask, repo: approval.repo, issue: n, agent, prompt: this.brief(n, issue, list, tree?.branch, task, back), ...(tree ? { worktree: tree } : {}) });
    if (r.status !== 'started') return { started: false, why: `its start was refused: ${r.reason}` };
    this.snapshots.set(r.run, before ?? `${(await this.o.starts().treeOf(r.run)).base}\n`);
    const reason = `${order}; ${turn}`;
    await this.o.appendCore('work.attempt', { ask, step: 'started', issue: n, attempt: k + 1, run: r.run, agent, model: null, worktree: r.worktree, branch: r.branch, reason, cause: 'none', verdict: null }, { subject: ask, v: 2 });
    return { started: true, why: `attempt ${k + 1} in ${agent}: ${reason}` };
  }

  /** The brief an attempt starts from, written only from the record: the issue, the branch and each earlier attempt's verdict line. */
  private brief(n: number, issue: Issue, list: Attempt[], branch: string | undefined, task: boolean, back?: CallRow): string {
    // A workspace's task (#1347) has no forge: its change finishes on the workspace's main once its checks pass there.
    const finish = task ? `When your change is ready, commit it on your branch; it finishes once its checks pass on the workspace's main. Its criteria: ${issue.body}`
      : `When your change is ready, commit it, push the branch and open a pull request whose body says Closes #${n}.`;
    const what = task ? 'task' : 'issue';
    if (!list.length) return `Work ${what} #${n}: ${issue.title}. ${finish}`;
    return [
      `Work ${what} #${n}: ${issue.title}. This is attempt ${list.length + 1}: ${LANDED.has(list.at(-1)?.ended?.cause ?? '') ? 'you start again from main, where the last change landed and was reverted' : `you go on in the worktree and on the branch ${branch ?? 'of the earlier attempts'}, its uncommitted files kept`}.`,
      ...list.map((a) => `Attempt ${a.attempt}: ${a.agent}${a.model ? ` on ${a.model}` : ''}, ended ${a.ended?.cause ?? 'unknown'}${a.ended?.verdict ? `: ${a.ended.verdict}` : ''}.`),
      // Your Send back on its call, with your words, is why it goes again (#1345).
      ...(back ? [`You sent its change back on ${back.handle} ("${back.text}")${back.words ? `: ${back.words}` : ''}.`] : []),
      finish,
    ].join('\n');
  }

  /**
   * A live attempt settled, or left running: its PR judged on its merge with main and landed once its head moved, its
   * session stopped once that landed or once its issue waits on you, replaced when its turn ended with nothing changed or
   * with its change held, and ended with its cause once its session ended. Whether it ended.
   */
  private async settle(ask: string, approval: Approval, repo: string, set: number[], issue: number, a: Attempt, pulls: Pull[], asks: OpenAsk[], on: boolean): Promise<boolean> {
    if (this.closed) return false;
    const starts = this.o.starts();
    const live = starts.live(a.run);
    const session = starts.sessionOfRun(a.run);
    const pr = pulls.find((p) => p.open && p.issue === issue && p.branch === a.branch);
    // The planted wrong program ends an attempt as done once its PR is open, before its change is judged or lands.
    if (this.o.plant === 'starts-before-blockers-done' && pr) {
      if (live) await starts.stop(a.run);
      return this.end(ask, issue, a, 'PASS', `PR #${pr.pr} is open`);
    }
    // Where calls are on (#1345), a taste call or a choice the agent went on from gives up no slot: its change lands,
    // or waits, on the calls its own requirements raise.
    if (live && session && asks.some((x) => x.session === session && !(on && x.provisional && x.writer !== 'core'))) {
      await starts.stop(a.run);
      return this.end(ask, issue, a, 'gave up its slot', 'its issue waits on your answer');
    }
    if (pr && this.judged.get(pr.pr)?.head !== pr.head) {
      const round = await this.o.landing().work(approval.repo, set, on ? this.raiser(repo) : undefined).catch(() => undefined);
      const held = round?.held.find((h) => h.issue === issue);
      this.judged.set(pr.pr, { head: pr.head, held: held?.reason ?? (round?.sent_back.some((s) => s.issue === issue) ? 'its change no longer merges with main' : null) });
      const landed = round?.landed.find((l) => l.issue === issue);
      if (landed) {
        if (live) await starts.stop(a.run);
        const l = (await this.landed(repo)).get(issue);
        const open = l?.open ?? [];
        const called = on && open.length > 0 && (await this.callsOf(repo)).some((x) => x.issue === issue && x.head === l?.head);
        return this.end(ask, issue, a, called ? 'landed with your call open' : open.length ? 'landed with the budget window open' : 'PASS', `landed at ${landed.commit}${open.length ? `; ${called ? 'your calls settle' : 'the budget window settles'} ${open.join('; ')}` : ''}`);
      }
      // A change held for its calls waits on you (#1345): its attempt gives up its slot until you answer.
      if (held?.calls?.length) {
        if (live) await starts.stop(a.run);
        return this.end(ask, issue, a, 'gave up its slot', held.reason);
      }
    }
    if (live) {
      if (!session || !(await this.turnEnded(session))) return false;
      const held = pr ? this.judged.get(pr.pr)?.held : undefined;
      if (held) { await starts.stop(a.run); return this.end(ask, issue, a, 'sent back past its rounds', held); }
      if (!pr && (await this.state(a.worktree).catch(() => '')) === (this.snapshots.get(a.run) ?? `${(await starts.treeOf(a.run)).base}\n`)) {
        await starts.stop(a.run);
        return this.end(ask, issue, a, 'stalled', 'its turn ended with nothing changed in its worktree');
      }
      return false;
    }
    const held = pr ? this.judged.get(pr.pr)?.held : undefined;
    if (held) return this.end(ask, issue, a, 'sent back past its rounds', held);
    const ended = await starts.endOf(a.run);
    return this.end(ask, issue, a, ended.never ? 'stalled' : 'crashed or interrupted', ended.never ? 'it wrote no first event within 60 s' : 'its session ended before its change landed');
  }
  private async end(ask: string, issue: number, a: Attempt, cause: string, verdict: string): Promise<boolean> {
    if (this.closed) return false;
    const model = this.o.starts().modelOf(a.run) ?? null;
    this.snapshots.delete(a.run);
    await this.o.appendCore('work.attempt', { ask, step: 'ended', issue, attempt: a.attempt, run: a.run, agent: a.agent, model, worktree: null, branch: null, reason: null, cause, verdict: verdict.slice(0, 2000) }, { subject: ask, v: 2 });
    return true;
  }
  /** Whether a session's newest turn event is its stop: its turn ended. */
  private async turnEnded(session: string): Promise<boolean> {
    const [row] = (await this.o.raw(`SELECT kind FROM events WHERE session_id = ? AND kind IN ('user.ask', 'tool.before', 'tool.after', 'agent.stop', 'session.continued')
      AND (kind <> 'agent.stop' OR json_extract(data, '$.child') IS NULL) ORDER BY log_pos DESC LIMIT 1`, [session])) as { kind: string }[];
    return row?.kind === 'agent.stop';
  }
  /** A worktree's head and the files it holds uncommitted. */
  private async state(worktree: string): Promise<string> {
    return `${await git(worktree, 'rev-parse', 'HEAD')}\n${await git(worktree, 'status', '--porcelain', '--untracked-files=all')}`;
  }

  /**
   * A standing run's breaker (#1335): five attempts in a row ending in anything but a landing, or two of its landings
   * reverted within a day (#1333), pause the run with one ask. A wait on you is no attempt's end here. "Go on" starts
   * the count again from the answer; "keep it paused", the default, leaves the run paused. Why it is paused, or
   * undefined while it may start.
   */
  private async runBreaker(ask: string, repo: string, reverts: Revert[]): Promise<string | undefined> {
    const state = await this.runBreakerOf(ask);
    if (state.raised === 'open') return `its breaker: ${state.handle} asks you whether it goes on`;
    if (state.raised === 'left') return `its breaker: you kept it paused (${state.handle})`;
    const ended = (await this.o.raw(`SELECT log_pos AS at, data FROM events WHERE kind = 'work.attempt' AND subject = ? AND json_extract(data, '$.step') = 'ended' AND log_pos > ? ORDER BY log_pos`, [ask, state.since])) as { at: number; data: string }[];
    const row: Obj[] = [];
    for (const e of ended.map((x) => JSON.parse(x.data) as Obj).reverse()) {
      if (LANDED.has(String(e.cause))) break;
      if (e.cause !== 'gave up its slot') row.unshift(e);
    }
    const commits = (await this.o.raw(`SELECT json_extract(data, '$.commit') AS sha, json_extract(data, '$.issue') AS issue FROM events WHERE kind = 'landing.made' AND json_extract(data, '$.step') = 'landed' AND json_extract(data, '$.repo') = ?`, [repo])) as { sha: string | null; issue: number }[];
    const joined = new Set((await this.rows(ask)).map((r) => r.issue));
    const ours = commits.filter((c) => c.sha && joined.has(Number(c.issue)));
    const reverted = reverts.filter((r) => r.at >= Math.max(this.o.now() - DAY, state.sinceTs) && ours.some((c) => c.sha!.startsWith(r.landing)));
    if (row.length < IN_A_ROW && reverted.length < REVERTS) return undefined;
    const why = row.length >= IN_A_ROW
      ? `the last ${row.length} attempts in a row ended without a landing: ${row.map((e) => `#${String(e.issue)} attempt ${String(e.attempt)} in ${agentName(String(e.agent))}, ${String(e.cause)}`).join('; ')}`
      : `${reverted.length} of its landings were reverted within a day: ${reverted.map((r) => `${r.landing.slice(0, 10)} by #${r.pr}`).join(', ')}`;
    const pin = this.runBreakerKey(ask, state.level);
    const handle = await this.o.asks().raise({ writer: 'core', actor: 'you', scope: 'you' }, 'work.run_breaker', {
      kind: 'exception', question: `The standing run ${ask} is paused: ${why}. Go on, or keep it paused?`.slice(0, 2000),
      options: [{ id: 'resume', label: 'Go on', decision: 'none' }, { id: 'stay', label: 'Keep it paused', decision: 'none' }],
      recommended: 'stay', deadline: this.o.now() + DAY, fallback: 'you', default: 'stay', provisional: false, owner: 'you', key: pin, pinned_to: { kind: 'evidence', ref: pin },
    });
    return `its breaker: ${why}; ${handle} asks you whether it goes on`;
  }
  /** Where a standing run's breaker stands: how often you said go on, since when it counts, and the current ask. */
  private async runBreakerOf(ask: string): Promise<{ level: number; since: number; sinceTs: number; raised: 'open' | 'left' | null; handle: string | null }> {
    const keys = Array.from({ length: 16 }, (_, level) => this.runBreakerKey(ask, level));
    const rows = (await this.o.raw(`SELECT 'ask:' || c.id AS handle, json_extract(c.data, '$.key') AS key,
      (SELECT json_extract(y.data, '$.answer') FROM events y WHERE y.subject = 'ask:' || c.id AND y.kind IN ('ask.answered', 'ask.defaulted') ORDER BY y.log_pos LIMIT 1) AS answer,
      (SELECT y.log_pos FROM events y WHERE y.subject = 'ask:' || c.id AND y.kind IN ('ask.answered', 'ask.defaulted') ORDER BY y.log_pos LIMIT 1) AS at,
      (SELECT y.ts FROM events y WHERE y.subject = 'ask:' || c.id AND y.kind IN ('ask.answered', 'ask.defaulted') ORDER BY y.log_pos LIMIT 1) AS ts
      FROM events c WHERE c.kind = 'ask.created' AND json_extract(c.data, '$.key') IN (${keys.map(() => '?').join(', ')})`, keys)) as { handle: string; key: string; answer: string | null; at: number | null; ts: number | null }[];
    const resumed = rows.filter((r) => r.answer === 'resume');
    const level = resumed.length;
    const current = rows.find((r) => r.key === keys[level]);
    return { level, since: Math.max(0, ...resumed.map((r) => r.at ?? 0)), sinceTs: Math.max(0, ...resumed.map((r) => r.ts ?? 0)), raised: current ? (current.answer === null ? 'open' : 'left') : null, handle: current?.handle ?? null };
  }
  private runBreakerKey(ask: string, level: number): string { return key({ kind: 'work.run_breaker', ask, level }); }

  /** The breaker: one ask listing each attempt's agent, model, cause and verdict line, once per three replaced attempts. */
  private async breaker(ask: string, issue: number, list: Attempt[], level: number): Promise<void> {
    const lines = list.map((x) => `attempt ${x.attempt}: ${agentName(x.agent)} on ${x.model ?? 'a model it did not name'}, ${x.ended && !KEPT.has(x.ended.cause) ? `replaced (${x.ended.cause})` : x.ended?.cause ?? 'live'}${x.ended?.verdict ? `: ${x.ended.verdict}` : ''}`);
    const pin = this.breakerKey(ask, issue, level);
    await this.o.asks().raise({ writer: 'core', actor: 'you', scope: 'you' }, 'work.breaker', {
      kind: 'exception', question: `Issue #${issue}'s last ${BREAKER} attempts were replaced. ${lines.join('; ')}. Start another attempt, or leave it waiting?`.slice(0, 2000),
      options: [{ id: 'again', label: 'Start another attempt', decision: 'none' }, { id: 'leave', label: 'Leave it waiting', decision: 'none' }],
      recommended: 'leave', deadline: this.o.now() + DAY, fallback: 'you', default: 'leave', provisional: false, owner: 'you', key: pin, pinned_to: { kind: 'evidence', ref: pin },
    });
  }
}

/** What a closed call tells its claim's verdict (#1345): Yes passes it, Send back fails it, and a default, or a close with no answer, leaves it unanswered. */
const answerOf = (c: CallRow): 'PASS' | 'FAIL' | 'unanswered' => (c.how === 'ask.defaulted' || !c.answer ? 'unanswered' : c.answer === YES ? 'PASS' : c.answer === SEND_BACK ? 'FAIL' : 'unanswered');

/** An agent by the name people know it by. */
const agentName = (agent: string): string => (agent === 'claude-code' ? 'Claude Code' : agent === 'codex' ? 'Codex' : agent);

/** The issues a body's `### Depends on` list names, one `- #<n>` a line. */
function dependsOn(body: string): number[] {
  const m = /^#+\s*depends on\s*$([\s\S]*?)(?=^#+\s|(?![\s\S]))/im.exec(body);
  return m ? [...m[1]!.matchAll(/^\s*[-*]\s*#(\d+)\b/gm)].map((x) => Number(x[1])) : [];
}

/** The machines an issue's `Runs on:` line names that this host can't serve, or undefined when it names none or serves one. */
function unserved(body: string): string | undefined {
  const line = /^\s*\**Runs on:?\**:?\s*(.+)$/im.exec(body)?.[1];
  if (!line) return undefined;
  const names = line.split(/,|;|\bor\b|\band\b|\bboth\b/i).map((s) => s.trim().replace(/^the\s+/i, '').replace(/[`*.]/g, '')).filter(Boolean);
  const host = hostname().toLowerCase();
  const serves = (m: string): boolean => MACHINES[m.toLowerCase()]?.() ?? (m.toLowerCase() === host || m.toLowerCase() === host.split('.')[0]);
  return names.some(serves) ? undefined : names.join(', ');
}

/**
 * A scope's words as #1330's bounds: the issues it names by number (`#12`, `#12-#15`), the agents in the order it names
 * them (Claude Code, Codex), how many at once (`two at a time`, `3 at once`), its plan share (`50% of each plan
 * window`) and its end (`until <ISO time>`). Bounds it doesn't say take defaults: Claude Code alone, one at a time, the
 * whole plan window, no end. Words that name a rule instead of numbers (#1335: labels, a milestone, an epic, the
 * author's role) make a standing run, with no set and no end. A string says what's missing or refused.
 */
export function scopeOf(words: string, now: number): Obj | string {
  const rule = ruleOf(words);
  if (typeof rule === 'string') return rule;
  const issues = new Set<number>();
  if (!rule) for (const m of words.matchAll(/#(\d+)(?:\s*(?:-|–|to|through)\s*#?(\d+))?/g)) {
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    for (let n = from; n <= to && n - from < 1000; n++) issues.add(n);
  }
  if (!rule && !issues.size) return 'Name the issues by number, such as "work through #12, #14 and #15 with Claude Code, two at a time", or a rule, such as "every issue labelled ready".';
  const agents = [...new Set([...words.matchAll(/\b(claude[ -]?code|claude|codex)\b/gi)].map((m) => (/codex/i.test(m[1]!) ? 'codex' : 'claude-code')))];
  const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const once = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+at\s+(?:a\s+time|once)\b/i.exec(words);
  const share = /\b(\d{1,3})\s*%/.exec(words);
  const until = /\buntil\s+(\S+)/i.exec(words);
  const end = until ? Date.parse(until[1]!) : null;
  if (until && (end === null || Number.isNaN(end) || end <= now)) return `"${until[1]}" is no time still to come: give the end as an ISO time.`;
  return {
    issues: [...issues].sort((a, b) => a - b), ...(rule ? { rule } : {}), agents: agents.length ? agents : ['claude-code'],
    at_once: once ? (NUM[once[1]!.toLowerCase()] ?? Number(once[1])) : 1, plan_share: share ? Math.min(100, Number(share[1])) : 100,
    ...(end !== null ? { until: end } : {}),
  };
}
