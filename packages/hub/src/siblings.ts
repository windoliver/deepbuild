// The session map and its notices (#352; design: Sessions that know about each other). The map is built from the
// sessions' hooks: each session's agent, worktree, repo, branch and issue, and the files it changed, by path from its
// repo's top, with the lines a Claude Code edit reports; a Codex patch's files are its path lines, which the adapter
// reads, resolved here through symlinks. Notices go to a session through its own hook replies, at its next tool call,
// prompt or start, never as a wake of their own: at a session's start, who else is in the repo and on what; before
// and after another session changes a file it changed, which session and lines, and whether their branches conflict;
// after a sibling's pull request merges into the repo's default branch over its files, to rebase. Every notice is
// made of facts only (paths, line ranges, issue and pull request numbers, session IDs), never another agent's text,
// and names its kind of change. A newer notice on the same subject replaces one still waiting, and each goes once,
// across hub restarts too: `notice.delivered` records it. The map also raises one "keep which?" ask for two sessions
// on one issue (from their branches), except a lead's own child sessions and races you started. And it holds sessions
// that keep each other going: more than 20 turns of one session started by another's messages in 10 minutes, with no
// prompt from you, raise one ask (let them go on?) and hold the next such prompt at its submit until you answer. The
// count is of the prompts' origins as the adapter read them from the payload and transcript, never of any message's
// text, and is read back from the record after a restart.
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { ulid, type EventInput } from '@deepbuild/record';
import { run } from './children.js';
import { gitDirs, headOf } from './session-facts.js';
import type { Draft, HookMeta, Hunk } from './wire.js';

// A repeat is a turn's last calls failing alike (#2019), told to that session alone.
type Kind = 'interface' | 'dependency' | 'behavior' | 'test' | 'configuration' | 'repeat';
type Obj = Record<string, unknown>;
const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
const handle = (id: string): string => `session:${letters(id)}`;
const short = (id: string): string => id.slice(0, 8);

const DEPENDENCY = /(^|\/)(package(-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.(toml|lock)|go\.(mod|sum)|requirements[^/]*\.txt|Pipfile(\.lock)?|poetry\.lock|uv\.lock|Gemfile(\.lock)?|composer\.(json|lock)|[^/]+\.gemspec)$/;
const TEST = /(^|\/)(tests?|__tests__|spec|e2e)\/|(^|\/)[^/]+[._-](test|spec)\.[^/]+$|(^|\/)test_[^/]+\.py$/;
const INTERFACE = /\.(d\.ts|proto|graphql|gql|idl|thrift|avsc)$|(^|\/)(openapi|swagger)[^/]*$|\.schema\.json$/;
const CONFIGURATION = /(^|\/)\.[^/]+|(^|\/)(Dockerfile|Makefile|Procfile)$|\.(ya?ml|toml|ini|cfg|conf|env|json)$/;
/** The kind of change a file's path says it is, read from the path alone: a manifest is a dependency, and so on. */
function kindOf(path: string): Kind {
  if (DEPENDENCY.test(path)) return 'dependency';
  if (TEST.test(path)) return 'test';
  if (INTERFACE.test(path)) return 'interface';
  if (CONFIGURATION.test(path)) return 'configuration';
  return 'behavior';
}
/** A session's issue: the number its branch names as `issue-<n>`. */
const issueOf = (branch: string | null): number | null => {
  const n = branch ? /(?:^|[^0-9A-Za-z])issue-(\d+)(?![0-9])/i.exec(branch)?.[1] : undefined;
  return n ? Number(n) : null;
};
/** Line numbers as ranges: 3-22, 30. */
const ranges = (lines: number[]): string => {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let j = i;
    while (j + 1 < lines.length && lines[j + 1] === lines[j]! + 1) j++;
    out.push(i === j ? `${lines[i]}` : `${lines[i]}-${lines[j]}`);
    i = j;
  }
  return out.join(', ');
};
/** The lines a session's change covers after one more edit: those the edit replaced go, those below it move, its own come in. */
function edited(lines: number[], hunks: Hunk[]): number[] {
  let now = lines;
  for (const h of hunks) {
    now = now.flatMap((l) => (l < h.oldStart ? [l] : l >= h.oldStart + h.oldLines ? [l + h.newLines - h.oldLines] : []));
    now = [...new Set([...now, ...h.changed])].sort((a, b) => a - b);
  }
  return now;
}

/** One file a session changed: the state its notices report (a hook's ID; `r:` once read back after a restart) and its lines. */
interface Changed { version: string; lines: number[] }
interface Mapped {
  id: string; agent: string; cwd: string; top: string; common: string; branch: string | null; head: string | null; issue: number | null; files: Map<string, Changed>; ended: boolean;
  /** When its hooks were first and last seen. */
  first: number; seen: number;
  /** The files each of its edits in flight changes, by call, from its PreToolUse, for the lines its PostToolUse reports. */
  editing: Map<string, string[]>;
  /** Its edits whose PostToolUse came before their PreToolUse, by call. */
  ahead: Set<string>;
}
interface Notice { type: Kind; source: string | null; files: string[]; pr: number | null; key: string; version: string; text: string }

export interface SiblingOptions {
  raw(query: string, params?: readonly (string | number | null)[]): Promise<unknown[]>;
  append(session: string, agent: string, input: EventInput): Promise<void>;
  /** Raises an ask on a session, from one of ask.sources' rows, keyed by `key`; resolves with its handle. */
  ask(session: string, agent: string, cwd: string, source: string, ask: Obj): Promise<string>;
  /**
   * Wakes an idle session with a notice through its waiter, when it has one and is neither held on an open ask nor
   * stopped BLOCKED with you as owner; whether it woke.
   */
  wake(session: string, text: string): Promise<boolean>;
  /** The session's next tool call is held for its reply, which carries what waits for it. */
  acking(session: string): void;
  /** Runs work in the core's queue. */
  queue(work: () => Promise<void>): void;
  now(): number;
}
/** A merged pull request's first line, as GitHub writes it: the number and the branch, nothing of its title. */
const MERGED = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)$/;
/** How often the repos the map holds are read for a merge into their default branch. */
const MERGE_POLL_MS = 2_000;
/** The loop rule: more than this many turns started by another session's messages, in the window, with no prompt from you. */
const LOOP_TURNS = 20;
const LOOP_MS = 10 * 60_000;
/** What a prompt held because you answered to hold the loop says. */
const HOLDING = "DeepBuild held this prompt: you said to hold this session's turns that another session's messages start until you prompt it.";
/** What a prompt held because its loop ask closed with no answer says. */
const CLOSED = "DeepBuild held this prompt: the ask about this session's turns that another session's messages start closed with no answer, so they wait until you prompt it.";
/** How long after a session is first seen its issue is compared, so its process's lead is linked first. */
const ISSUE_SETTLE_MS = 5_000;
/** How long a hook's handed notices are kept by hook ID, for a deep-hook that reports it gone; its hold is 2 s. */
const IN_REPLY_MS = 60_000;
/** A session with no hook for this long is no longer in the repo. */
const GONE_MS = 24 * 3_600_000;

export class Siblings {
  private readonly map = new Map<string, Mapped>();
  /** The notices waiting for each session's next hook, by subject: a newer one on a subject replaces the older. */
  private readonly pending = new Map<string, Map<string, Notice>>();
  /** What each session was handed: `<session>\0<key>\0<version>`, and `<session>\0<key>` for any version. */
  private readonly delivered = new Set<string>();
  /** Each repo's default branch head, as last read. */
  private readonly mains = new Map<string, string>();
  /** Dry merges of two branch tips, by their commits: the conflicting files, once read off the hook path. */
  private readonly dry = new Map<string, string[] | Promise<void>>();
  /** The issues a "keep which?" ask was raised for, by repo. */
  private readonly asked = new Set<string>();
  /** The notices handed in each hook's reply, by hook ID, while deep-hook could still report that hook gone. */
  private readonly inReply = new Map<string, { session: string; notices: Notice[]; at: number }>();
  /** The sessions on one issue already read as one lead's, or raced, by repo, issue and their IDs. */
  private readonly exempt = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  /** Each session's turns since your last prompt to it: when each began, and whether another session's message began it. */
  private readonly turns = new Map<string, { id: string; at: number; peer: boolean }[]>();
  /** The loop asks that hold sessions, by each session they hold, until you answer one to go on or prompt the session. */
  private readonly loops = new Map<string, { ask: string; pair: string[]; at: number }>();
  constructor(private readonly o: SiblingOptions) {}

  /** The map and what was delivered, read back from the record at the hub's start; nothing is queued from them. */
  async restore(): Promise<void> {
    await this.restoreLoops();
    for (const r of (await this.o.raw(`SELECT session_id, json_extract(data, '$.key') AS key, json_extract(data, '$.version') AS version FROM events WHERE kind = 'notice.delivered'`)) as { session_id: string; key: string; version: string }[]) {
      this.delivered.add(`${r.session_id}\0${r.key}\0${r.version}`).add(`${r.session_id}\0${r.key}`);
    }
    const since = this.o.now() - GONE_MS;
    const rows = (await this.o.raw(`SELECT id, agent, worktree, last_seen FROM sessions WHERE status <> 'ended' AND last_seen >= ? AND worktree IS NOT NULL AND worktree <> '-'`, [since])) as { id: string; agent: string | null; worktree: string; last_seen: number }[];
    for (const r of rows) {
      const m = await this.mapped(r.id, r.agent ?? 'claude-code', r.worktree);
      if (!m) continue;
      m.seen = r.last_seen;
      await this.placed(m);
      for (const f of (await this.o.raw(`SELECT path FROM session_files WHERE session = ? AND kind IN ('edit', 'write')`, [r.id])) as { path: string }[]) {
        const path = this.inRepo(m, f.path);
        if (path) m.files.set(path, { version: `r:${path}`, lines: [] });
      }
    }
    // A "keep which?" ask already put for a repo and issue, answered or not, is never put again; its question names the issue.
    for (const r of (await this.o.raw(`SELECT session_id, question FROM asks WHERE session_id IS NOT NULL AND question LIKE '% both work on issue #% Keep which?'`)) as { session_id: string; question: string }[]) {
      const m = this.map.get(r.session_id);
      const issue = /\bissue #(\d+) in /.exec(r.question)?.[1];
      if (m && issue) this.asked.add(`${m.common}\0${issue}`);
    }
  }
  /** The turns of the last 10 minutes and the loop asks still open, read back at the start. */
  private async restoreLoops(): Promise<void> {
    const rows = (await this.o.raw(`SELECT id, session_id, ts, json_extract(data, '$.from') AS origin FROM events WHERE kind = 'user.ask' AND ts >= ? AND session_id IS NOT NULL ORDER BY log_pos`, [this.o.now() - LOOP_MS])) as { id: string; session_id: string; ts: number; origin: string }[];
    for (const r of rows) this.turn(r.session_id, r.id, r.origin, r.ts);
    // A loop ask still open, answered to hold them or closed with no answer holds its sessions' next such prompts again,
    // each unless you prompted it since.
    const open = (await this.o.raw(`SELECT id, session_id, created, question FROM asks WHERE session_id IS NOT NULL AND (status IN ('open', 'later') OR answer IS NULL OR answer NOT LIKE '%go-on%') AND (question LIKE '% Let them go on?' OR question LIKE '% Let it go on?')`)) as { id: string; session_id: string; created: number; question: string }[];
    for (const a of open) {
      // The record holds its key hashed: its question names the pair.
      const named = /^Sessions (\S+) \(.+?\) and (\S+) \(/.exec(a.question);
      const pair = named ? [named[1]!, named[2]!] : [a.session_id];
      const held = { ask: `ask:${a.id}`, pair, at: a.created };
      for (const id of pair) {
        const yours = await this.o.raw(`SELECT 1 FROM events WHERE kind = 'user.ask' AND session_id = ? AND ts > ? AND json_extract(data, '$.from') IN ('person', 'app') LIMIT 1`, [id, a.created]);
        if (!yours.length) this.loops.set(id, held);
      }
    }
  }
  /** A prompt's origin, by its event: yours starts the count again; another session's adds one, once, however often its hook is read. */
  turn(session: string, id: string, origin: string, at: number): void {
    if (origin === 'person' || origin === 'app') {
      this.turns.delete(session);
      this.loops.delete(session);
      return;
    }
    const list = (this.turns.get(session) ?? []).filter((t) => at - t.at < LOOP_MS);
    if (list.some((t) => t.id === id)) return;
    list.push({ id, at, peer: origin === 'session' });
    this.turns.set(session, list);
  }
  /** Whether a session is past the loop rule's count: more than 20 turns another session's messages started in 10 minutes. */
  looping(session: string): boolean {
    const now = this.o.now();
    return (this.turns.get(session) ?? []).filter((t) => t.peer && now - t.at < LOOP_MS).length > LOOP_TURNS;
  }
  /**
   * Whether a session's prompt another session's message started is held at its submit, and why: its 21st such turn in
   * 10 minutes with no prompt from you raises one ask naming it and the sender, when the facts name one, and holds the
   * pair's next such prompts until you answer; your "go on" starts their count again.
   */
  async held(meta: HookMeta, origin: string, sender: () => Promise<string | undefined>): Promise<string | undefined> {
    if (origin !== 'session') return undefined;
    const now = this.o.now();
    let open = this.loops.get(meta.session);
    if (open?.ask) {
      // Read each time: an undone default can be answered again.
      const [row] = (await this.o.raw(`SELECT status, answer FROM asks WHERE id = ?`, [open.ask.slice(4)])) as { status: string; answer: string | null }[];
      if (row && row.status !== 'open' && row.status !== 'later') {
        // Closed with no answer, or answered to hold them: held until you prompt the session, never asked again.
        if (row.answer === null) return CLOSED;
        if (!row.answer.includes('go-on')) return HOLDING;
        // Your "go on" lets go the sessions this ask still holds; one another ask holds since stays with that one.
        for (const id of open.pair) {
          if (this.loops.get(id) !== open) continue;
          this.loops.delete(id);
          this.turns.set(id, (this.turns.get(id) ?? []).filter((t) => t.at > now));
        }
        return undefined;
      }
    }
    if (!open && !this.looping(meta.session)) return undefined;
    if (!open) {
      // Held now; the ask is raised beside the reply, so the hold never waits on it.
      const raised: { ask: string; pair: string[]; at: number } = { ask: '', pair: [meta.session], at: now };
      open = raised;
      this.loops.set(meta.session, raised);
      // One whose ask can't be raised holds nothing more: no prompt waits on an ask you can't see.
      this.o.queue(() => this.askLoop(meta, raised, sender).catch((error: unknown) => {
        for (const id of raised.pair) if (this.loops.get(id) === raised) this.loops.delete(id);
        throw error;
      }));
    }
    return `DeepBuild held this prompt: another session's messages started more than ${LOOP_TURNS} of this session's turns in 10 minutes with no prompt from you, so you're asked in your inbox whether to let them go on. It goes on once you answer, or with your next prompt to it.`;
  }
  /** The loop's one ask, naming the session and the sender when the facts name one, which it holds too. */
  private async askLoop(meta: HookMeta, held: { ask: string; pair: string[]; at: number }, sender: () => Promise<string | undefined>): Promise<void> {
    const from = await sender().catch(() => undefined);
    if (from && from !== meta.session) {
      held.pair.push(from);
      // A sender another loop ask holds stays held by that one.
      if (!this.loops.has(from)) this.loops.set(from, held);
    }
    const count = (this.turns.get(meta.session) ?? []).filter((t) => t.peer && held.at - t.at < LOOP_MS).length;
    const names = held.pair.map((id) => `${id} (${this.map.get(id)?.agent ?? meta.agent})`).join(' and ');
    const question = held.pair.length > 1
      ? `Sessions ${names} started ${count} of ${short(meta.session)}'s turns with each other's messages in the last 10 minutes, with no prompt from you. Let them go on?`
      : `Session ${names} had ${count} turns started by another session's messages in the last 10 minutes, with no prompt from you. Let it go on?`;
    held.ask = await this.o.ask(meta.session, meta.agent, meta.cwd, 'session.loop', {
      kind: 'exception', question,
      options: [{ id: 'go-on', label: 'Let them go on', decision: 'none' }, { id: 'hold', label: 'Hold them until I prompt them', decision: 'none' }],
      recommended: 'hold', default: 'hold', fallback: 'you', provisional: false, owner: 'you', key: `loop:${[...held.pair].sort().join(':')}:${held.at}`,
    });
  }
  stop(): void {
    clearInterval(this.timer);
  }
  /** A session's place in the map: its repo, branch, issue and the files it changed, each with its lines where known. */
  row(id: string): { repo: string; branch: string | null; issue: number | null; files: { path: string; lines: string }[] } | undefined {
    const m = this.map.get(id);
    return m && { repo: dirname(m.common), branch: m.branch, issue: m.issue, files: [...m.files].map(([path, f]) => ({ path, lines: ranges(f.lines) })) };
  }

  /** What a session's hook shows the map, before its reply is asked for. */
  async hook(drafts: Draft[], meta: HookMeta): Promise<void> {
    const m = await this.mapped(meta.session, meta.agent, meta.cwd);
    if (!m) return;
    m.seen = this.o.now();
    if (meta.event === 'SessionEnd') {
      m.ended = true;
      this.pending.delete(m.id);
      return;
    }
    m.ended = false;
    // Its branch against each other session's, ready before a notice asks.
    if (await this.placed(m)) for (const o of this.others(m)) this.dryMerge(m, o);
    if (meta.event === 'SessionStart') this.started(m);
    await this.sameIssue(m);
    const before = drafts.find((d) => d.kind === 'tool.before');
    // A PreToolUse spooled behind its own PostToolUse comes after the change it announces: nothing new.
    const late = meta.event === 'PreToolUse' && !!meta.toolUse && m.ahead.delete(meta.toolUse);
    if (before && !late && (before.data.kind === 'edit' || before.data.kind === 'write') && Array.isArray(before.data.paths) && !meta.blockedBy?.length && !meta.denied) {
      for (const p of before.data.paths) {
        const path = typeof p === 'string' ? this.inRepo(m, p) : undefined;
        if (!path) continue;
        // Before the edit: which other sessions changed the file. Then it's this session's change too.
        this.heard(m, path);
        const mine = m.files.get(path) ?? { version: meta.id, lines: [] };
        mine.version = meta.id;
        m.files.set(path, mine);
        await this.changed(m, path);
      }
      if (meta.toolUse) m.editing.set(meta.toolUse, before.data.paths.flatMap((p) => (typeof p === 'string' ? [this.inRepo(m, p) ?? ''] : [])).filter(Boolean));
    }
    // The lines an edit changed, which its own call's PostToolUse reports: the file's newest state. One spooled ahead
    // of its PreToolUse names its file in its own input.
    const call = meta.event === 'PostToolUse' && meta.toolUse ? m.editing.get(meta.toolUse) ?? this.ranAhead(m, meta) : undefined;
    if (meta.toolUse && meta.event !== 'PreToolUse') m.editing.delete(meta.toolUse);
    const mine = call?.length === 1 && meta.hunks ? m.files.get(call[0]!) : undefined;
    if (mine) {
      mine.lines = edited(mine.lines, meta.hunks!);
      mine.version = meta.id;
      await this.changed(m, call![0]!);
    }
    this.poll();
  }
  /** The file of an edit whose PostToolUse came before its PreToolUse, now this session's change; that PreToolUse is then late. */
  private ranAhead(m: Mapped, meta: HookMeta): string[] | undefined {
    const file = meta.hunks && meta.call?.input.file_path;
    const path = typeof file === 'string' ? this.inRepo(m, file) : undefined;
    if (!path) return undefined;
    this.heard(m, path);
    if (!m.files.has(path)) m.files.set(path, { version: meta.id, lines: [] });
    m.ahead.add(meta.toolUse!);
    return [path];
  }
  /** Which other sessions changed a file this session changes: each a notice for it. */
  private heard(m: Mapped, path: string): void {
    for (const s of this.others(m)) {
      const theirs = s.files.get(path);
      if (theirs) this.queue(m, this.fileNotice(m, s, path, theirs));
    }
  }
  /** The session's head, branch and issue, as its worktree stands now; whether it has a head. */
  private async placed(m: Mapped): Promise<boolean> {
    const head = await headOf(m.cwd).catch(() => undefined);
    if (!head) return false;
    m.head = head.sha;
    m.branch = head.branch;
    m.issue = issueOf(head.branch);
    return true;
  }

  /**
   * The notices waiting for a session, handed in this hook's reply: each recorded as delivered, then its text. A reply
   * past `until`, the hold its hook waits for, reaches no agent, so they wait for the next hook instead. A session still
   * among others with changes has its next tool call held too, so a notice that call's own edit raises reaches it.
   */
  async deliver(meta: HookMeta, until: number): Promise<string | undefined> {
    const m = this.map.get(meta.session);
    if (m && [...this.others(m)].some((s) => s.files.size)) this.o.acking(meta.session);
    const waiting = this.pending.get(meta.session);
    if (!waiting?.size || !m || Date.now() >= until) return undefined;
    this.pending.delete(meta.session);
    const texts = await this.handed(m, [...waiting.values()], meta.event);
    if (texts.length) {
      const now = this.o.now();
      for (const [hook, r] of this.inReply) if (r.at < now - IN_REPLY_MS) this.inReply.delete(hook);
      this.inReply.set(meta.id, { session: meta.session, notices: [...waiting.values()], at: now });
    }
    return texts.length ? texts.join('\n') : undefined;
  }
  /**
   * A hook whose deep-hook was gone before it read the hub's reply: what that reply carried reached no agent, so it is
   * no longer delivered and waits for the session's next hook, which is held for it, behind anything newer on its subject.
   */
  gone(hook: string): void {
    const r = this.inReply.get(hook);
    if (!r) return;
    this.inReply.delete(hook);
    const waiting = this.pending.get(r.session) ?? this.pending.set(r.session, new Map()).get(r.session)!;
    for (const n of r.notices) {
      this.delivered.delete(`${r.session}\0${n.key}\0${n.version}`);
      this.delivered.delete(`${r.session}\0${n.key}`);
      if (!waiting.has(n.key)) waiting.set(n.key, n);
    }
    this.o.acking(r.session);
  }
  /** Notices handed to a session, each recorded once as delivered; their texts. */
  private async handed(m: Mapped, notices: Notice[], via: string): Promise<string[]> {
    if (via === 'waiter') this.pending.delete(m.id);
    const texts: string[] = [];
    for (const [i, n] of notices.entries()) {
      if (this.delivered.has(`${m.id}\0${n.key}\0${n.version}`)) continue;
      const ts = this.o.now();
      const id = ulid(ts);
      await this.o.append(m.id, m.agent, {
        // A repeat, or a failed call's reply that carries one, is notice.delivered@2's (#2019).
        v: n.type === 'repeat' || via === 'PostToolUseFailure' ? 2 : 1, id, kind: 'notice.delivered', ts, subject: handle(m.id),
        data: { notice: `notice:${id}`, type: n.type, source: n.source, target: handle(m.id), files: n.files, pr: n.pr, key: n.key, version: n.version, via, text: n.text },
      }).catch((error: unknown) => {
        // What wasn't recorded waits for the next hook again, behind anything newer on its subject.
        const waiting = this.pending.get(m.id) ?? this.pending.set(m.id, new Map()).get(m.id)!;
        for (const left of notices.slice(i)) if (!waiting.has(left.key)) waiting.set(left.key, left);
        throw error;
      });
      this.delivered.add(`${m.id}\0${n.key}\0${n.version}`).add(`${m.id}\0${n.key}`);
      texts.push(n.text);
    }
    return texts;
  }

  // ---- The map.
  private async mapped(id: string, agent: string, cwd: string): Promise<Mapped | undefined> {
    const known = this.map.get(id);
    if (known || !id || !cwd) return known;
    const real = realSync(cwd);
    const dirs = await gitDirs(real).catch(() => undefined);
    if (!dirs) return undefined;
    const m: Mapped = { id, agent, cwd: real, top: realSync(dirs.top), common: realSync(dirs.common), branch: null, head: null, issue: null, files: new Map(), ended: false, first: this.o.now(), seen: this.o.now(), editing: new Map(), ahead: new Set() };
    this.map.set(id, m);
    // Its issue is compared once its process's lead has had time to be linked, whether or not it hooks again by then.
    setTimeout(() => this.o.queue(() => this.sameIssue(m)), ISSUE_SETTLE_MS + 100).unref();
    // The repo's default branch as it stands when the map first holds it: what merges after it is news.
    if (!this.mains.has(m.common)) {
      const main = await defaultHead(m.common);
      if (main) this.mains.set(m.common, main.sha);
    }
    return m;
  }
  /** A path from the session's repo top, through `..` and symlinks; undefined outside the repo. */
  private inRepo(m: Mapped, path: string): string | undefined {
    const rel = relative(m.top, realSync(resolve(m.cwd, path)));
    return rel && !rel.startsWith('..') && !rel.startsWith(sep) ? rel.split(sep).join('/') : undefined;
  }
  /** The other sessions in the session's repo still in it. */
  private *others(m: Mapped): Generator<Mapped> {
    const since = this.o.now() - GONE_MS;
    for (const s of this.map.values()) if (s !== m && s.common === m.common && !s.ended && s.seen >= since) yield s;
  }

  // ---- Notices.
  /**
   * A notice for the session a hook names, built from facts, waiting for its next hook or this one's reply (#2019):
   * once by its key and version, as every notice.
   */
  async tell(meta: HookMeta, n: Notice): Promise<void> {
    const m = await this.mapped(meta.session, meta.agent, meta.cwd);
    if (m) this.queue(m, n);
  }
  private queue(target: Mapped, n: Notice | undefined): void {
    if (!n || target.ended) return;
    // One a restart read back is news only to a session never told of its subject.
    if (n.version.startsWith('r:') && this.delivered.has(`${target.id}\0${n.key}`)) return;
    if (this.delivered.has(`${target.id}\0${n.key}\0${n.version}`)) return;
    (this.pending.get(target.id) ?? this.pending.set(target.id, new Map()).get(target.id)!).set(n.key, n);
    this.o.acking(target.id);
  }
  /** Another session changed a file this one changed, or is about to change one it did: who, which lines, and whether their branches conflict. */
  private fileNotice(target: Mapped, s: Mapped, path: string, theirs: Changed): Notice {
    const type = kindOf(path);
    const lines = theirs.lines.length ? `, ${theirs.lines.length === 1 ? 'line' : 'lines'} ${ranges(theirs.lines)},` : '';
    const merge = this.dryMerge(target, s);
    const branches = merge === undefined ? '' : merge.length ? ` Your branches conflict in ${merge.join(', ')}.` : " Your branches don't conflict as committed.";
    return {
      type, source: handle(s.id), files: [path], pr: null, key: `file:${path}:${s.id}`, version: theirs.version,
      text: `DeepBuild: session ${short(s.id)} (${s.agent}) also changed ${path}${lines} in its worktree (a ${type} change), and this session changes it too.${branches}`,
    };
  }
  /** This session changed a file: each other session that changed it hears so. */
  private async changed(m: Mapped, path: string): Promise<void> {
    const mine = m.files.get(path)!;
    for (const s of this.others(m)) if (s.files.has(path)) this.queue(s, this.fileNotice(s, m, path, mine));
  }
  /** At a session's start: each other session in the repo, its issue and the files it changed, one notice per kind. */
  private started(m: Mapped): void {
    for (const s of this.others(m)) {
      const on = s.issue ? `, on issue #${s.issue}` : '';
      const kinds = new Map<Kind, string[]>();
      for (const path of s.files.keys()) (kinds.get(kindOf(path)) ?? kinds.set(kindOf(path), []).get(kindOf(path))!).push(path);
      if (!kinds.size) kinds.set('behavior', []);
      for (const [type, files] of kinds) {
        const version = files.map((f) => s.files.get(f)!.version).sort().at(-1) ?? 'issue';
        const changed = files.length ? `; it changed ${files.join(', ')} (a ${type} change)` : ` (a ${type} change), and has changed no file yet`;
        this.queue(m, { type, source: handle(s.id), files, pr: null, key: `start:${s.id}:${type}`, version, text: `DeepBuild: session ${short(s.id)} (${s.agent}) is also in this repo${on}${changed}.` });
      }
    }
  }
  /**
   * The conflicting files of a dry merge of the two sessions' committed branch tips, as last read; undefined until it
   * has run. It runs off the hook path, in the repo's own objects, touching no worktree or index, and is recorded.
   */
  private dryMerge(a: Mapped, b: Mapped): string[] | undefined {
    if (!a.head || !b.head || a.head === b.head) return undefined;
    const key = [a.head, b.head].sort().join('\0');
    const known = this.dry.get(key);
    if (Array.isArray(known)) return known;
    if (known) return undefined;
    const [x, y] = [a, b];
    this.dry.set(key, (async () => {
      const r = await run('git', ['--git-dir', x.common, 'merge-tree', '--write-tree', '--name-only', '--no-messages', x.head!, y.head!], { env: gitEnv(), timeout: 10_000 });
      if (r.error && r.error.code !== 1) return void this.dry.delete(key);
      const conflicts = r.stdout.split('\n').slice(1).filter(Boolean);
      this.dry.set(key, conflicts);
      const ts = this.o.now();
      await this.o.append(x.id, x.agent, { v: 1, id: ulid(ts), kind: 'merge.dry_run', ts, data: { a: handle(x.id), b: handle(y.id), conflicts } }).catch(() => undefined);
    })());
    return undefined;
  }

  // ---- Merges into each repo's default branch.
  private poll(): void {
    this.timer ??= setInterval(() => this.o.queue(() => this.merges()), MERGE_POLL_MS);
    this.timer.unref();
  }
  /** Each repo's default branch, read from its files: a head that moved brings the pull requests merged since. */
  private async merges(): Promise<void> {
    for (const common of new Set([...this.map.values()].filter((m) => !m.ended).map((m) => m.common))) {
      const main = await defaultHead(common);
      if (!main) continue;
      const before = this.mains.get(common);
      if (before === main.sha) continue;
      if (!before) { this.mains.set(common, main.sha); continue; }
      const log = await run('git', ['--git-dir', common, 'log', '--first-parent', '--merges', '--format=%H%x09%s', `${before}..${main.sha}`], { env: gitEnv(), timeout: 5_000 });
      // A read that failed is tried again at the next poll, from the same head.
      if (log.error) continue;
      this.mains.set(common, main.sha);
      for (const line of log.stdout.split('\n').filter(Boolean).reverse()) {
        const [sha, subject] = line.split('\t') as [string, string];
        const pr = MERGED.exec(subject ?? '');
        if (pr) await this.merged(common, main.branch, sha, Number(pr[1]), pr[2]!);
      }
    }
  }
  /** A sibling's pull request merged: each other session whose files it touched hears it, one notice per kind, and to rebase. */
  private async merged(common: string, main: string, sha: string, pr: number, branch: string): Promise<void> {
    const diff = await run('git', ['--git-dir', common, 'diff', '--name-only', `${sha}^1`, sha], { env: gitEnv(), timeout: 5_000 });
    const touched = new Set(diff.stdout.split('\n').filter(Boolean));
    const source = [...this.map.values()].find((s) => s.common === common && s.branch === branch);
    if (source) await this.o.append(source.id, source.agent, { v: 1, id: ulid(this.o.now()), kind: 'pr.merged', ts: this.o.now(), subject: handle(source.id), data: { pr, merge_sha: sha } }).catch(() => undefined);
    for (const m of this.map.values()) {
      if (m.common !== common || m === source || m.ended) continue;
      // The merge reports the source's change to each file now: its notice of the uncommitted change goes.
      if (source) for (const path of touched) this.pending.get(m.id)?.delete(`file:${path}:${source.id}`);
      const kinds = new Map<Kind, string[]>();
      for (const path of m.files.keys()) if (touched.has(path)) (kinds.get(kindOf(path)) ?? kinds.set(kindOf(path), []).get(kindOf(path))!).push(path);
      const by = source ? `session ${short(source.id)} (${source.agent})'s pull request #${pr}` : `pull request #${pr}`;
      for (const [type, files] of kinds) {
        this.queue(m, { type, source: source ? handle(source.id) : null, files, pr, key: `pr:${pr}:${type}`, version: sha, text: `DeepBuild: ${by} merged into ${main} and touched ${files.join(', ')}, which this session changed (a ${type} change). Rebase onto ${main} before you say done.` });
      }
      // An idle Claude Code session hears of it now, through its waiter, unless it waits on you.
      const waiting = kinds.size && (m.agent === 'claude-code' || m.agent === 'claude') ? this.pending.get(m.id) : undefined;
      if (waiting?.size && await this.o.wake(m.id, [...waiting.values()].map((n) => n.text).join('\n'))) await this.handed(m, [...waiting.values()], 'waiter');
    }
  }

  // ---- Two sessions on one issue.
  /**
   * Two sessions in one repo on one issue raise one "keep which?" ask, unless one leads the other, they share a lead,
   * or you race them; read once both have been seen long enough for a child's lead to be linked.
   */
  private async sameIssue(m: Mapped): Promise<void> {
    if (!m.issue || m.ended) return;
    const key = `${m.common}\0${m.issue}`;
    const settled = this.o.now() - ISSUE_SETTLE_MS;
    const peers = [...this.others(m)].filter((s) => s.issue === m.issue && s.first <= settled);
    const seen = `${key}\0${[m, ...peers].map((s) => s.id).sort().join('\0')}`;
    if (this.asked.has(key) || m.first > settled || !peers.length || this.exempt.has(seen)) return;
    const raced = (await this.o.raw(`SELECT 1 FROM events WHERE kind = 'race.started' AND json_extract(data, '$.issue') = ? LIMIT 1`, [m.issue])).length > 0;
    if (raced) return void this.exempt.add(seen);
    const parents = new Map(((await this.o.raw(`SELECT json_extract(data, '$.child') AS child, json_extract(data, '$.parent') AS parent FROM events WHERE kind = 'session.child_started'`)) as { child: string; parent: string }[]).map((r) => [r.child, r.parent]));
    const lead = (id: string): string => { let at = handle(id); for (let up = parents.get(at); up; up = parents.get(at)) at = up; return at; };
    const other = peers.find((s) => lead(s.id) !== lead(m.id));
    if (!other) return void this.exempt.add(seen);
    this.asked.add(key);
    const pair = [other, m];
    const question = `Sessions ${pair.map((s) => `${s.id} (${s.agent})`).join(' and ')} both work on issue #${m.issue} in ${basename(dirname(m.common))}. Keep which?`;
    await this.o.ask(m.id, m.agent, m.cwd, 'issue.twice', {
      kind: 'choice', question,
      options: [...pair.map((s, i) => ({ id: `keep-${i}`, label: `Keep ${short(s.id)} (${s.agent}), stop the other`, decision: 'none' })), { id: 'keep-both', label: 'Keep both', decision: 'none' }],
      recommended: 'keep-both', default: 'keep-both', fallback: 'you', provisional: false, owner: 'you',
      key: `issue.twice:${m.common}:${m.issue}`,
    }).catch(() => this.asked.delete(key));
  }
}

/** The repo's default branch head, as its own HEAD names it, from its files. */
async function defaultHead(common: string): Promise<{ sha: string; branch: string } | undefined> {
  const ref = /^ref: (refs\/heads\/\S+)$/.exec(((await readFile(join(common, 'HEAD'), 'utf8').catch(() => '')) ?? '').trim())?.[1];
  if (!ref) return undefined;
  const loose = (await readFile(join(common, ref), 'utf8').catch(() => '')).trim();
  const sha = /^[0-9a-f]{40}$/.test(loose) ? loose : ((await readFile(join(common, 'packed-refs'), 'utf8').catch(() => '')).split('\n').find((l) => l.endsWith(` ${ref}`))?.slice(0, 40) ?? '');
  return /^[0-9a-f]{40}$/.test(sha) ? { sha, branch: ref.slice('refs/heads/'.length) } : undefined;
}
const gitEnv = (): NodeJS.ProcessEnv => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), LC_ALL: 'C' });
/** A path through its symlinks: its deepest existing folder's real path, and the rest as written. */
function realSync(path: string): string {
  const rest: string[] = [];
  for (let at = path; ; at = dirname(at)) {
    try {
      return join(realpathSync(at), ...rest.reverse());
    } catch {
      if (dirname(at) === at) return path;
      rest.push(basename(at));
    }
  }
}
