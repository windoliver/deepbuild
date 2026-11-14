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
// its PASS covers the merge, the version before it kept a step back.
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import type { Asks } from '@deepbuild/asks';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { gitEnv } from '@deepbuild/gate';
import type { WorkItem } from './ask-tasks.js';
import { mergeOf, onlyWindow, type Landing, type Outcome } from './landing.js';
import type { Plant } from './plant.js';
import type { Starts } from './starts.js';
import type { WorkspaceService } from './workspaces-port.js';
import { refusal, Refused } from './wire.js';

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
/** The words GitHub reads as linking an issue, closing ones first, and `Part of`, which links without closing. */
const LINKS = /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of):?\s+#(\d+)\b/i;
/** The baseline of issues closed before the gate: the repo's file, as the commit that added it holds it. */
const BASELINE = '.deepbuild/closed-before-gate.json';
/** How an attempt ended without being replaced: its change landed, or its issue waited on you. */
const KEPT = new Set(['PASS', 'landed with the budget window open', 'gave up its slot']);
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
interface OpenAsk { handle: string; session: string | null; key: string }
type Approval = NonNullable<Awaited<ReturnType<Starts['approvalOf']>>>;

export interface WorkOptions {
  api: string;
  token(): Promise<string | undefined>;
  repoOf(remote: string): string | undefined;
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  appendCore(kind: string, data: Obj, extra?: { subject?: string }): Promise<void>;
  starts(): Starts;
  landing(): Landing;
  asks(): Asks;
  now(): number;
  plant: Plant | undefined;
  /** The workspaces a run's folder may be (#1347), and a workspace task's change judged on its merge with main. */
  spaces(): Pick<WorkspaceService, 'idAt' | 'tasksOf' | 'finished'>;
  judgeTask(r: { folder: string; item: WorkItem; commit: string; session: string }): Promise<{ claim: string; outcome: Outcome; requirements: { req: string; text: string; settled_by: string | null; outcome: string }[] } | undefined>;
}

const git = (cwd: string, ...args: string[]): Promise<string> =>
  new Promise((done, fail) => execFile('git', ['-C', cwd, ...args], { encoding: 'utf8', env: gitEnv(), timeout: 30_000 }, (error, out, err) => (error ? fail(Error(String(err || error.message).trim())) : done(String(out).trim()))));
const real = (p: string): string => { try { return realpathSync(p); } catch { return p; } };
const key = (o: Obj): string => sha256Hex(canonicalize(o as JsonValue));

export class Work {
  private timer: NodeJS.Timeout | undefined;
  private passing: Promise<void> | undefined;
  private readonly forge = new Map<string, { at: number; issues: Map<number, Issue>; pulls: Pull[] }>();
  /** The head of each PR a run last judged, and what held it: judged again only once its head moves. */
  private readonly judged = new Map<number, { head: string; held: string | null }>();
  /** The head of each workspace attempt's branch last judged, and what held it (#1347). */
  private readonly heads = new Map<string, { head: string; held: string | null }>();
  private judgements = 0;
  /** Each attempt's worktree as it started: a turn that ends with it unchanged replaced the attempt. */
  private readonly snapshots = new Map<string, string>();
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
  /** `deep work pause`: no new starts, and running turns finish. */
  async pause(params: Obj): Promise<{ paused: string[] }> {
    const runs = (await this.runs(params.repo)).filter((r) => !r.paused);
    for (const r of runs) await this.o.appendCore('work.run', { ask: r.ask, step: 'paused', scope: r.scope }, { subject: r.ask });
    return { paused: runs.map((r) => r.ask) };
  }
  /** `deep work show`: each issue's state word and what it waits for, as the record's `work.state` holds them. */
  async show(params: Obj): Promise<{ runs: { ask: string; repo: string; paused: boolean; issues: Row[] }[] }> {
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
      out.push({ ask: r.ask, repo: r.repo, paused: r.paused, issues: rows });
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
  /** What landed for each issue of a repo: its outcome and the requirements only the budget window settles. */
  private async landed(repo: string): Promise<Map<number, { outcome: string; open: string[]; pr: number; at?: string }>> {
    const rows = (await this.o.raw(`SELECT data FROM events WHERE kind = 'landing.made' AND json_extract(data, '$.step') = 'landed' AND json_extract(data, '$.repo') = ? ORDER BY log_pos`, [repo])) as { data: string }[];
    const out = new Map<number, { outcome: string; open: string[]; pr: number }>();
    for (const row of rows) {
      const d = JSON.parse(row.data) as { issue: number; outcome: string; open: string[]; pr: number };
      out.set(d.issue, { outcome: d.outcome, open: d.open ?? [], pr: d.pr });
    }
    return out;
  }
  /** The asks still open: who raised each, and its key. */
  private async openAsks(): Promise<OpenAsk[]> {
    const rows = (await this.o.raw(`SELECT c.id AS id, c.session_id AS session, json_extract(c.data, '$.key') AS key FROM events c WHERE c.kind = 'ask.created'
      AND NOT EXISTS (SELECT 1 FROM events e WHERE e.subject = 'ask:' || c.id AND e.kind IN ('ask.answered', 'ask.defaulted', 'ask.cancelled', 'ask.moot', 'ask.superseded'))`)) as { id: string; session: string | null; key: string | null }[];
    return rows.map((r) => ({ handle: `ask:${r.id}`, session: r.session, key: r.key ?? '' }));
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
  private async read(repo: string, set: number[], fresh: boolean): Promise<{ issues: Map<number, Issue>; pulls: Pull[] }> {
    const kept = this.forge.get(repo);
    if (kept && !fresh && this.o.now() - kept.at < FORGE_MS) return kept;
    const issues = new Map<number, Issue>();
    const want = [...set];
    for (let i = 0; i < want.length; i++) {
      const n = want[i]!;
      if (issues.has(n)) continue;
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
    for (let page = 1; ; page++) {
      const r = await this.get(`/repos/${repo}/pulls?state=all&per_page=100&page=${page}`);
      if (r.status !== 200 || !Array.isArray(r.body) || !r.body.length) break;
      for (const p of r.body.filter(isObj)) {
        const link = LINKS.exec(typeof p.body === 'string' ? p.body : '');
        if (!link) continue;
        const head = isObj(p.head) ? p.head : {};
        pulls.push({ pr: Number(p.number), issue: Number(link[2]), login: isObj(p.user) ? String(p.user.login) : '', open: p.state === 'open', merged: Boolean(p.merged_at), branch: String(head.ref ?? ''), head: String(head.sha ?? '') });
      }
      if (r.body.length < 100) break;
    }
    const read = { at: this.o.now(), issues, pulls };
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
  private async finishedIn(id: string): Promise<Map<number, { outcome: string; open: string[]; pr: number; at?: string }>> {
    const out = new Map<number, { outcome: string; open: string[]; pr: number; at?: string }>();
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
    })().finally(() => { this.passing = undefined; });
    return this.passing;
  }

  private async passRun(run: { ask: string; paused: boolean }): Promise<void> {
    const approval = await this.o.starts().approvalOf(run.ask);
    if (!approval) return;
    // A workspace's run reads its tasks from the record, and never a forge.
    const space = this.o.spaces().idAt(approval.repo);
    const repo = space ?? await this.slugOf(approval.repo);
    const readAll = (fresh: boolean) => (space ? this.readSpace(space, approval.issues) : this.read(repo, approval.issues, fresh));
    let attempts = await this.attempts(run.ask);
    let { issues, pulls } = await readAll(false);
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
    if (!space && this.o.now() - (this.forge.get(repo)?.at ?? 0) >= PR_MS && (await opened())) ({ issues, pulls } = await this.read(repo, approval.issues, true));
    let asks = await this.openAsks();
    // Each live attempt first: landed, waiting on you, replaced or ended, each with its cause.
    let changed = false;
    for (const [issue, list] of attempts) {
      const a = list.at(-1);
      if (a && !a.ended) changed = (await (space ? this.settleSpace(run.ask, approval, space, issue, a, asks) : this.settle(run.ask, approval, issue, a, pulls, asks))) || changed;
    }
    if (changed) {
      attempts = await this.attempts(run.ask);
      ({ issues, pulls } = await readAll(true));
      asks = await this.openAsks();
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
      return l ? `#${n}'s budget window` : `#${n}`;
    };
    const rows = new Map<number, Row>();
    const ready: number[] = [];
    for (const n of approval.issues) {
      const i = issues.get(n)!;
      const list = attempts.get(n) ?? [];
      const last = list.at(-1);
      const l = landed.get(n);
      const row = (word: string, waits_on: string | null, why: string): void => { rows.set(n, { issue: n, word, waits_on, why }); };
      const sessions = new Set(list.map((a) => starts.sessionOfRun(a.run)).filter(Boolean));
      const asked = asks.find((x) => x.session && sessions.has(x.session));
      const replaced = this.replaced(list);
      const breaker = await this.breakerOf(run.ask, n);
      if (l?.outcome === 'PASS') { row('PASS', null, l.at ? `finished at ${l.at}` : `landed through PR #${l.pr}`); continue; }
      if (l?.open.length) { row(WORDS.has(l.outcome) ? l.outcome : 'INCONCLUSIVE', `the budget window: ${l.open.join('; ')}`, `landed through PR #${l.pr} with only the budget window's requirement open`); continue; }
      if (baseline.has(n)) { row('closed before the gate', null, `closed before the gate, as the baseline commit lists it; never PASS`); continue; }
      if (!i.open) { const p = pulls.find((x) => x.issue === n && !x.merged); row('closed', p ? `PR #${p.pr} to land` : null, 'closed on the forge with no change of it landed'); continue; }
      if (last && !last.ended) { row('working', null, `attempt ${last.attempt} in ${last.agent}: ${last.reason}`); continue; }
      if (this.o.plant === 'starts-before-blockers-done' && last?.ended?.cause === 'PASS') { row('says done', 'its change to land', String(last.ended.verdict)); continue; }
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
        if (this.judged.get(other.pr)?.head !== other.head) { this.judged.set(other.pr, { head: other.head, held: null }); await this.o.landing().work(approval.repo, approval.issues).catch(() => undefined); }
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
    // The order: the ready issue that unblocks most in the set, then the lowest number.
    const unblocks = (n: number): number[] => approval.issues.filter((m) => { const b = issues.get(m)?.blockers; return Array.isArray(b) && b.includes(n) && rows.get(m)?.word !== 'PASS'; });
    ready.sort((a, b) => unblocks(b).length - unblocks(a).length || a - b);
    const live = [...attempts.values()].filter((list) => { const a = list.at(-1); return a && !a.ended && starts.live(a.run); }).length;
    const stopped = run.paused ? "the run's pause" : approval.until !== null && this.o.now() >= approval.until ? `the run's end at ${new Date(approval.until).toISOString()}` : undefined;
    let free = stopped ? 0 : Math.max(0, approval.at_once - live);
    for (const n of ready) {
      if (this.closed) return;
      if (stopped || free <= 0) { rows.set(n, { ...rows.get(n)!, waits_on: stopped ?? 'a free slot' }); continue; }
      const blocked = unblocks(n);
      const order = `${blocked.length ? `it unblocks ${blocked.map((m) => `#${m}`).join(', ')}` : 'it unblocks none in the set'}, then the lowest number`;
      const r = await this.start(run.ask, approval, n, issues.get(n)!, attempts.get(n) ?? [], order, space !== undefined);
      if (r.started) { rows.set(n, { issue: n, word: 'working', waits_on: null, why: r.why }); free--; }
      else rows.set(n, { ...rows.get(n)!, waits_on: r.why });
    }
    // Each row whose word or wait changed is recorded.
    const before = new Map((await this.rows(run.ask)).map((r) => [r.issue, r]));
    for (const r of rows.values()) {
      const b = before.get(r.issue);
      if (b && b.word === r.word && b.waits_on === r.waits_on) continue;
      await this.o.appendCore('work.state', { ask: run.ask, issue: r.issue, word: r.word, waits_on: r.waits_on?.slice(0, 8192) ?? null, why: r.why.slice(0, 2000) }, { subject: run.ask });
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
  private async start(ask: string, approval: Approval, n: number, issue: Issue, list: Attempt[], order: string, task = false): Promise<{ started: boolean; why: string }> {
    const k = list.length;
    const agent = approval.agents[k % approval.agents.length]!;
    const turn = approval.agents.length > 1 ? `${agent}'s turn, as the approved agents take turns` : `${agent}, the approved agent`;
    const last = list.at(-1);
    const tree = last ? await this.o.starts().treeOf(last.run) : undefined;
    const before = tree ? await this.state(tree.path) : undefined;
    const r = await this.o.starts().runStart({ ask, repo: approval.repo, issue: n, agent, prompt: this.brief(n, issue, list, tree?.branch, task), ...(tree ? { worktree: tree } : {}) });
    if (r.status !== 'started') return { started: false, why: `its start was refused: ${r.reason}` };
    this.snapshots.set(r.run, before ?? `${(await this.o.starts().treeOf(r.run)).base}\n`);
    const reason = `${order}; ${turn}`;
    await this.o.appendCore('work.attempt', { ask, step: 'started', issue: n, attempt: k + 1, run: r.run, agent, model: null, worktree: r.worktree, branch: r.branch, reason, cause: 'none', verdict: null }, { subject: ask });
    return { started: true, why: `attempt ${k + 1} in ${agent}: ${reason}` };
  }

  /** The brief an attempt starts from, written only from the record: the issue, the branch and each earlier attempt's verdict line. */
  private brief(n: number, issue: Issue, list: Attempt[], branch: string | undefined, task: boolean): string {
    // A workspace's task (#1347) has no forge: its change finishes on the workspace's main once its checks pass there.
    const finish = task ? `When your change is ready, commit it on your branch; it finishes once its checks pass on the workspace's main. Its criteria: ${issue.body}`
      : `When your change is ready, commit it, push the branch and open a pull request whose body says Closes #${n}.`;
    const what = task ? 'task' : 'issue';
    if (!list.length) return `Work ${what} #${n}: ${issue.title}. ${finish}`;
    return [
      `Work ${what} #${n}: ${issue.title}. This is attempt ${list.length + 1}: you go on in the worktree and on the branch ${branch ?? 'of the earlier attempts'}, its uncommitted files kept.`,
      ...list.map((a) => `Attempt ${a.attempt}: ${a.agent}${a.model ? ` on ${a.model}` : ''}, ended ${a.ended?.cause ?? 'unknown'}${a.ended?.verdict ? `: ${a.ended.verdict}` : ''}.`),
      finish,
    ].join('\n');
  }

  /**
   * A live attempt settled, or left running: its PR judged on its merge with main and landed once its head moved, its
   * session stopped once that landed or once its issue waits on you, replaced when its turn ended with nothing changed or
   * with its change held, and ended with its cause once its session ended. Whether it ended.
   */
  private async settle(ask: string, approval: Approval, issue: number, a: Attempt, pulls: Pull[], asks: OpenAsk[]): Promise<boolean> {
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
    if (live && session && asks.some((x) => x.session === session)) {
      await starts.stop(a.run);
      return this.end(ask, issue, a, 'gave up its slot', 'its issue waits on your answer');
    }
    if (pr && this.judged.get(pr.pr)?.head !== pr.head) {
      const round = await this.o.landing().work(approval.repo, approval.issues).catch(() => undefined);
      const held = round?.held.find((h) => h.issue === issue)?.reason ?? (round?.sent_back.some((s) => s.issue === issue) ? 'its change no longer merges with main' : null);
      this.judged.set(pr.pr, { head: pr.head, held });
      const landed = round?.landed.find((l) => l.issue === issue);
      if (landed) {
        if (live) await starts.stop(a.run);
        const open = (await this.landed(await this.slugOf(approval.repo))).get(issue)?.open ?? [];
        return this.end(ask, issue, a, open.length ? 'landed with the budget window open' : 'PASS', `landed at ${landed.commit}${open.length ? `; the budget window settles ${open.join('; ')}` : ''}`);
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
    await this.o.appendCore('work.attempt', { ask, step: 'ended', issue, attempt: a.attempt, run: a.run, agent: a.agent, model, worktree: null, branch: null, reason: null, cause, verdict: verdict.slice(0, 2000) }, { subject: ask });
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

  /** The breaker: one ask listing each attempt's agent, model, cause and verdict line, once per three replaced attempts. */
  private async breaker(ask: string, issue: number, list: Attempt[], level: number): Promise<void> {
    const lines = list.map((x) => `attempt ${x.attempt}: ${x.agent === 'claude-code' ? 'Claude Code' : x.agent === 'codex' ? 'Codex' : x.agent} on ${x.model ?? 'a model it did not name'}, ${x.ended && !KEPT.has(x.ended.cause) ? `replaced (${x.ended.cause})` : x.ended?.cause ?? 'live'}${x.ended?.verdict ? `: ${x.ended.verdict}` : ''}`);
    const pin = this.breakerKey(ask, issue, level);
    await this.o.asks().raise({ writer: 'core', actor: 'you', scope: 'you' }, 'work.breaker', {
      kind: 'exception', question: `Issue #${issue}'s last ${BREAKER} attempts were replaced. ${lines.join('; ')}. Start another attempt, or leave it waiting?`.slice(0, 2000),
      options: [{ id: 'again', label: 'Start another attempt', decision: 'none' }, { id: 'leave', label: 'Leave it waiting', decision: 'none' }],
      recommended: 'leave', deadline: this.o.now() + DAY, fallback: 'you', default: 'leave', provisional: false, owner: 'you', key: pin, pinned_to: { kind: 'evidence', ref: pin },
    });
  }
}

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
 * whole plan window, no end. A string says what's missing.
 */
export function scopeOf(words: string, now: number): Obj | string {
  const issues = new Set<number>();
  for (const m of words.matchAll(/#(\d+)(?:\s*(?:-|–|to|through)\s*#?(\d+))?/g)) {
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    for (let n = from; n <= to && n - from < 1000; n++) issues.add(n);
  }
  if (!issues.size) return 'Name the issues by number, such as "work through #12, #14 and #15 with Claude Code, two at a time".';
  const agents = [...new Set([...words.matchAll(/\b(claude[ -]?code|claude|codex)\b/gi)].map((m) => (/codex/i.test(m[1]!) ? 'codex' : 'claude-code')))];
  const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const once = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+at\s+(?:a\s+time|once)\b/i.exec(words);
  const share = /\b(\d{1,3})\s*%/.exec(words);
  const until = /\buntil\s+(\S+)/i.exec(words);
  const end = until ? Date.parse(until[1]!) : null;
  if (until && (end === null || Number.isNaN(end) || end <= now)) return `"${until[1]}" is no time still to come: give the end as an ISO time.`;
  return {
    issues: [...issues].sort((a, b) => a - b), agents: agents.length ? agents : ['claude-code'],
    at_once: once ? (NUM[once[1]!.toLowerCase()] ?? Number(once[1])) : 1, plan_share: share ? Math.min(100, Number(share[1])) : 100,
    ...(end !== null ? { until: end } : {}),
  };
}
