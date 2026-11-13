// What a claim leaves open, as open items in the record (#323; design: Open items as records, An agent says it's
// done, Done means switched on). At each claim the gate reads, with no model: the final message's open sections, the
// bugs it says it left and the issues it filed instead of fixing; placeholder text in the files the change touched;
// the limits it writes into its PR body or its docs; each review thread on its PR; and the agent's own task list, as
// its adapter's facts name it. Each is `open_item.opened` under its ID, the hash of its normalized text and scope,
// so the same item raised twice is one record. An item closes only on evidence, your answer or a rule: a thread a
// reviewer resolves, your waiver through the item's ask. The agent's word closes nothing: a thread its own account
// resolved stays open, naming who resolved it, and an item it marks completed stays open. Raised again after evidence
// closed it, such as a thread unresolved after a reviewer resolved it, an item opens again citing that closing (#1633);
// one your answer closed stays closed.
import { exec as childRun } from './children.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Asks } from '@deepbuild/asks';
import { isRecord as isObj, sha256Hex } from '@deepbuild/contracts';
import { addedLines, errorShape, leftOpen, limitsIn, openTasks, placeholders, type LeftOpen, type TaskListFacts } from '@deepbuild/gate';
import { ulid, type Connection, type EventInput } from '@deepbuild/record';
import { openItemId } from '@deepbuild/verdicts';
import { parsePrUrl } from './forge.js';
import type { Answer, Fetch, Graphql } from './github-source.js';
import type { Plant } from './plant.js';

type Obj = Record<string, unknown>;

/** The sections whose items are claims nobody proved: each reaches you through an ask that can waive it. */
const UNVERIFIED = new Set(['not verified', 'not run', 'not exercised', 'remaining proof gaps', 'remaining proof gap']);
/** The most bytes of one untracked file read for placeholders. */
const FILE_BYTES = 256 * 1024;
const THREADS = `query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
  number url body reviewThreads(first: 100) { totalCount pageInfo { hasNextPage endCursor } nodes { id isResolved isOutdated path line
  resolvedBy { login } comments(first: 1) { totalCount nodes { id databaseId author { login } body url createdAt } } } } } } }`;

interface OpenItemsOptions {
  raw(query: string, params?: readonly (string | number | null)[]): Promise<unknown[]>;
  append(connection: Connection, input: EventInput): Promise<void>;
  /** The core's connection, for the session when given. */
  connection(session?: string, agent?: string): Connection;
  asks(): Asks;
  pin(cwd: string, question: string): Promise<unknown>;
  now(): number;
  plant?: Plant | undefined;
  /** GitHub's REST and GraphQL APIs: recorded answers in tests, the live API with your `gh` login otherwise. */
  github(): Promise<{ fetch: Fetch; graphql: Graphql }>;
  /** The agent's task list as its adapter's facts name it. */
  taskList(agent: string): TaskListFacts | undefined;
}
/** What one claim is read for. */
interface ClaimRead {
  session: string; agent: string; task: string; cwd: string; base: string; message: string; transcript: string | undefined; pr: string | undefined;
  /** Nothing but reads since the session's last claim (#82): the lines the change added are those it read then. */
  same?: boolean;
}

/** One thing found open, with what it says beside its words. */
interface Found extends Omit<LeftOpen, 'from'> { from: LeftOpen['from'] | 'review_thread'; resolved_by?: string }
/**
 * An item as the record has it. `resolved_by`: who its newest opening says resolved its thread, the session's own
 * account, which raised no ask then; `reopened`: it opened again after a closing while that account held its thread
 * resolved, and every opening since says so too: its ask is owed as an item opened again.
 */
interface Standing { item: string; text: string; from: string; open: boolean; by: string | null; resolved_by: string | null; closing: string | null; reopened: boolean }

const run = async (cmd: string, args: string[], cwd: string): Promise<string> => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const { error, stdout } = await childRun(cmd, args, { cwd, env, maxBuffer: 64 << 20, timeout: 10_000 });
  return error ? '' : stdout;
};

export class OpenItems {
  /** Whether each task has an item a pending verdict opened still open (#82), once known. */
  private readonly waiting = new Map<string, boolean>();
  constructor(private readonly o: OpenItemsOptions) {}

  /** An item's ID: its normalized text and scope (the planted normalizer drops numbers first). */
  private idOf(text: string, repo: string, task: string): string {
    return openItemId(this.o.plant === 'normalizer-drops-numbers' ? text.replace(/\d+/g, '') : text, { repo, task, req: null });
  }
  /** Error text as a waiver matches it: the item's normalized words, with run-to-run values put by their kind. */
  private shapeOf(text: string): string {
    const shaped = errorShape(text);
    return (this.o.plant === 'normalizer-drops-numbers' ? shaped.replace(/\d+/g, '') : shaped).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').replace(/[\s.,;:!?]+$/, '').trim();
  }

  /** The task's open items as the record has them, by ID: the newest opening's words, and whether a closing came after it. */
  private async standing(task: string): Promise<Map<string, Standing>> {
    const rows = (await this.o.raw(`SELECT id, kind, data FROM events WHERE kind IN ('open_item.opened', 'open_item.closed') AND json_extract(data, '$.task_ref') = ? AND json_extract(data, '$.item') IS NOT NULL ORDER BY log_pos`, [task])) as { id: string; kind: string; data: string }[];
    const out = new Map<string, Standing>();
    for (const row of rows) {
      const d = JSON.parse(row.data) as Obj;
      const item = String(d.item);
      const was = out.get(item);
      if (row.kind === 'open_item.opened') out.set(item, { item, text: String(d.text), from: String(d.from), open: true, by: null, resolved_by: typeof d.resolved_by === 'string' ? d.resolved_by : null, closing: null, reopened: was !== undefined && typeof d.resolved_by === 'string' && (!was.open || was.reopened) });
      else if (was) out.set(item, { ...was, open: false, by: String(d.by), closing: row.id });
    }
    return out;
  }

  /** Reads one claim for what it leaves open and records each new item; a thread a reviewer resolved closes its own. */
  async atClaim(c: ClaimRead): Promise<void> {
    const found: Found[] = leftOpen(c.message);
    const added = c.same ? [] : await this.added(c.cwd, c.base);
    found.push(...placeholders(added));
    const docs = new Map<string, string[]>();
    for (const a of added) if (/\.(md|mdx|markdown|rst|txt)$/i.test(a.path)) docs.set(a.path, [...(docs.get(a.path) ?? []), a.text]);
    for (const lines of docs.values()) found.push(...limitsIn(lines.join('\n')));
    const closes: { item: string; text: string; by: string }[] = [];
    const pr = c.pr ? parsePrUrl(c.pr) : undefined;
    if (pr) {
      const gh = await this.o.github();
      const body = await gh.fetch(`/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`, 1).catch((): Answer => ({ status: 599, headers: {}, body: undefined }));
      if (body.status === 200 && isObj(body.body) && typeof body.body.body === 'string') found.push(...limitsIn(body.body.body));
      // The planted wrong program reads the PR body only, never its review threads.
      if (this.o.plant !== 'pr-body-only') await this.threads(gh, pr, c, found, closes);
    }
    const facts = this.o.taskList(c.agent);
    const list = facts && c.transcript ? await newestList(facts, c.transcript) : undefined;
    if (facts && list !== undefined) found.push(...openTasks(facts, list));

    const standing = await this.standing(c.task);
    const waived = new Set([...standing.values()].filter((s) => !s.open && s.by?.startsWith('your answer')).map((s) => this.shapeOf(s.text)));
    const seen = new Set<string>();
    const core = this.o.connection(c.session, c.agent);
    for (const f of found) {
      const item = this.idOf(f.text, c.cwd, c.task);
      if (seen.has(item)) continue;
      seen.add(item);
      const was = standing.get(item);
      // Raised again after evidence closed it, it opens again, citing that closing; one your answer closed stays
      // closed, as does one you accepted or waived through its ask while evidence held it closed. The planted wrong
      // program opens again whatever closed it.
      // A review note unresolved, whose item last opened while the session's own account held its thread resolved, raised
      // no ask then: it is decided now, once, and the item is revised to say its thread is unresolved.
      const note = f.from === 'review_thread' && !f.resolved_by;
      const held = note && was?.open === true && was.resolved_by !== null;
      const asked = was && (!was.open || held) ? await this.asked(item) : undefined;
      const again = was && !was.open && ((!was.by?.startsWith('your answer') && !asked?.closed) || this.o.plant === 'reopens-every-item') ? was.closing : null;
      // Opened again, it reaches you through its ask only when none is open for it and you never answered one; held, as
      // that once its thread is unresolved, or, never opened again, only when it never had one.
      const ask = !was || (asked !== undefined && (again !== null || (held && was.reopened) ? !asked.open && !asked.answered : held && !asked.any));
      // Raised again while open, it is the same record; one whose thread the session resolved or unresolved since is
      // revised, naming who resolved it, if anyone.
      if (was && !again && !held && !(f.resolved_by && was.open && was.resolved_by !== f.resolved_by)) continue;
      // The same error as one you waived, its run-to-run values aside, stays closed by that waiver.
      if (!was && waived.has(this.shapeOf(f.text))) continue;
      await this.opened(core, c.task, item, f, again);
      if (ask && f.from === 'section' && f.section && UNVERIFIED.has(f.section)) await this.askWaiver(c, item, f.text);
      if (ask && note) this.raiseAccept(c, item, f.text);
    }
    for (const x of closes) if (standing.get(x.item)?.open) await this.closed(core, c.task, x.item, x.text, x.by);
    // The planted wrong program takes the agent's "completed" as closing its item.
    if (this.o.plant === 'completed-closes-item' && facts && list !== undefined) {
      const done = Array.isArray((list as Obj)[facts.items]) ? ((list as Obj)[facts.items] as unknown[]).filter(isObj).filter((t) => t[facts.status] === 'completed').map((t) => String(t[facts.text])) : [];
      for (const s of standing.values()) if (s.open && s.from === 'task' && done.some((d) => s.text.includes(`"${d}"`))) await this.closed(core, c.task, s.item, s.text, 'the agent marked it completed');
    }
  }

  /** The lines the change added since `base`: the working tree's diff, and every line of a file it created. */
  private async added(cwd: string, base: string): Promise<{ path: string; line: number; text: string }[]> {
    const out = addedLines(await run('git', ['-c', 'core.fsmonitor=false', 'diff', '--no-color', '--no-ext-diff', '-U0', base, '--'], cwd));
    for (const path of (await run('git', ['-c', 'core.fsmonitor=false', 'ls-files', '-o', '--exclude-standard', '-z'], cwd)).split('\0').filter(Boolean)) {
      const text = await readFile(join(cwd, path)).then((b) => (b.length <= FILE_BYTES && !b.includes(0) ? b.toString('utf8') : ''), () => '');
      text.split('\n').forEach((t, i) => out.push({ path, line: i + 1, text: t }));
    }
    return out;
  }

  /**
   * The PR's review threads: each unresolved one is an open item naming it and quoting its first comment; one the
   * session's own account resolved is the agent's word, so its item stays open naming the resolver; one anyone else
   * resolved closes its item.
   */
  private async threads(gh: { fetch: Fetch; graphql: Graphql }, pr: { owner: string; repo: string; number: number }, c: ClaimRead, found: Found[], closes: { item: string; text: string; by: string }[]): Promise<void> {
    const read = await gh.graphql(THREADS, { owner: pr.owner, repo: pr.repo, number: pr.number }).catch((): Answer => ({ status: 599, headers: {}, body: undefined }));
    const nodes = (read.body as { data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: unknown[] } } } } } | undefined)?.data?.repository?.pullRequest?.reviewThreads?.nodes;
    if (read.status !== 200 || !Array.isArray(nodes)) return;
    const me = await gh.fetch('/user', 1).catch((): Answer => ({ status: 599, headers: {}, body: undefined }));
    const own = me.status === 200 && isObj(me.body) && typeof me.body.login === 'string' ? me.body.login : null;
    for (const t of nodes.filter(isObj)) {
      const first = (isObj(t.comments) && Array.isArray(t.comments.nodes) ? t.comments.nodes.filter(isObj) : [])[0];
      if (typeof t.id !== 'string' || !first) continue;
      const author = isObj(first.author) ? String(first.author.login) : 'someone';
      const where = typeof t.path === 'string' ? ` (${t.path}${typeof t.line === 'number' ? `:${t.line}` : ''})` : '';
      const text = `Review thread ${t.id} on ${c.pr}${where}, ${typeof first.url === 'string' ? `${first.url}, ` : ''}first comment by ${author}: “${String(first.body ?? '').slice(0, 2000)}”`;
      const resolver = isObj(t.resolvedBy) && typeof t.resolvedBy.login === 'string' ? t.resolvedBy.login : null;
      if (t.isResolved !== true) found.push({ text, from: 'review_thread' });
      // An unknown signed-in account can't tell whose a resolution is: it stays open as the session's own would.
      else if ((own === null || resolver === own || resolver === null) && this.o.plant !== 'resolved-counts-closed') found.push({ text, from: 'review_thread', resolved_by: resolver ?? `session ${c.session}` });
      else closes.push({ item: this.idOf(text, c.cwd, c.task), text, by: `review thread ${t.id} resolved by ${resolver ?? 'someone'}` });
    }
  }

  /**
   * What a stop let through with its claim pending or INCONCLUSIVE still needs (#82; design: An agent says it's done):
   * one open item per requirement, naming the run or your answer it waits for, from the claim's verdict. Raised again,
   * the same item is the same record.
   */
  async stillNeeded(c: { session: string; agent: string; task: string; cwd: string }, needs: readonly string[]): Promise<void> {
    const standing = await this.standing(c.task);
    const core = this.o.connection(c.session, c.agent);
    for (const text of needs) {
      const item = this.idOf(text, c.cwd, c.task);
      if (standing.get(item)?.open) continue;
      const ts = this.o.now();
      await this.o.append(core, { v: 3, id: ulid(ts), kind: 'open_item.opened', ts, data: { task_ref: c.task, text: text.slice(0, 8192), item, from: 'verdict' } });
    }
    this.waiting.set(c.task, true);
  }
  /** Closes each item a pending claim's verdict opened (`verdict`) that its newest verdict no longer waits for (#82). */
  async settled(c: { session: string; agent: string; task: string }, needs: readonly string[]): Promise<void> {
    // Read from the record once per task after a start; known none open, there is nothing to read.
    if (this.waiting.get(c.task) === false) return;
    const still = new Set(needs);
    const core = this.o.connection(c.session || undefined, c.agent);
    let left = false;
    for (const s of (await this.standing(c.task)).values()) {
      if (!s.open || s.from !== 'verdict') continue;
      if (still.has(s.text)) left = true;
      else await this.closed(core, c.task, s.item, s.text, 'the run or answer it waited for came');
    }
    this.waiting.set(c.task, left);
  }
  /** Records an item opened, or opened again citing the closing it replaces (`open_item.opened@4`). */
  private async opened(core: Connection, task: string, item: string, f: Found, replaces: string | null): Promise<void> {
    const ts = this.o.now();
    await this.o.append(core, { v: replaces ? 4 : 2, id: ulid(ts), kind: 'open_item.opened', ts, data: { task_ref: task, text: f.text.slice(0, 8192), item, from: f.from, ...(f.resolved_by ? { resolved_by: f.resolved_by.slice(0, 256) } : {}), ...(replaces ? { replaces } : {}) } });
  }
  /** The item's asks: whether it had any, whether one is open, whether you answered one, and whether you closed it through one, accepting or waiving it. */
  private async asked(item: string): Promise<{ any: boolean; open: boolean; answered: boolean; closed: boolean }> {
    const rows = (await this.o.raw(`SELECT status, answer FROM asks WHERE key = ?`, [waiverKey(item)])) as { status: string; answer: string | null }[];
    const answered = rows.filter((r) => r.status === 'answered' || r.status === 'decided');
    return { any: rows.length > 0, open: rows.some((r) => r.status === 'open' || r.status === 'later'), answered: answered.length > 0, closed: answered.some((r) => r.answer === '"accept"' || r.answer === '"waive"') };
  }
  private async closed(core: Connection, task: string, item: string, text: string, by: string): Promise<void> {
    const ts = this.o.now();
    await this.o.append(core, { v: 2, id: ulid(ts), kind: 'open_item.closed', ts, data: { task_ref: task, text: text.slice(0, 8192), item, by: by.slice(0, 1024) } });
  }

  /** The task's review notes still open (#87): each one's words, naming its thread and its first comment's link. */
  async openNotes(task: string): Promise<string[]> {
    return [...(await this.standing(task)).values()].filter((s) => s.open && s.from === 'review_thread').map((s) => s.text);
  }

  /** The ask an unproven item reaches you through: waive it, closing it without evidence, or keep it open. */
  private askWaiver(c: ClaimRead, item: string, text: string): Promise<void> {
    const question = `Close this open item of ${c.task} without evidence, as a waiver? The agent's final message left it: “${text.slice(0, 2000)}”`;
    return this.ask(c, item, question, { id: 'waive', label: 'Waive it: close it without evidence' });
  }
  /**
   * A review note on the PR keeps it from Closes until it is fixed or you accept it (#87). Its ask is raised apart from
   * the claim, so no verdict waits on the ask's resolver.
   */
  private raiseAccept(c: ClaimRead, item: string, text: string): void {
    void this.askAccept(c, item, text).catch((error: unknown) => process.stderr.write(`deep hub: the ask for review note ${item} was not raised: ${error instanceof Error ? error.message : String(error)}\n`));
  }
  /** The ask a review note reaches you through (#87): accept it as it stands, closing its item, or keep it open. */
  private askAccept(c: ClaimRead, item: string, text: string): Promise<void> {
    const question = `Accept this review note on the PR of ${c.task} without a fix, so the PR may say Closes? ${text.slice(0, 2400)}`;
    return this.ask(c, item, question, { id: 'accept', label: 'Accept it: close it without a fix' });
  }
  private async ask(c: ClaimRead, item: string, question: string, close: { id: string; label: string }): Promise<void> {
    const raised = {
      kind: 'exception', question, recommended: 'keep', default: 'keep', fallback: 'you', provisional: false, owner: 'you', key: waiverKey(item), pinned_to: await this.o.pin(c.cwd, question),
      options: [{ ...close, decision: 'none' }, { id: 'keep', label: 'Keep it open', decision: 'none' }],
    };
    // Raised by the core, bound to no session: the stop doesn't wait on it, and your answer is never the agent's to read.
    await this.o.asks().raise(this.o.connection(), 'open_item.waive', raised).catch((error: unknown) => process.stderr.write(`deep hub: the ask for open item ${item} was not raised: ${error instanceof Error ? error.message : String(error)}\n`));
  }

  /** Your answer to an item's ask: "waive" or "accept" closes it, as your answer; any other leaves it open. */
  async answered(ask: { key?: unknown }, option: string | undefined): Promise<void> {
    if ((option !== 'waive' && option !== 'accept') || typeof ask.key !== 'string') return;
    const rows = (await this.o.raw(`SELECT data FROM events WHERE kind = 'open_item.opened' AND json_extract(data, '$.item') IS NOT NULL ORDER BY log_pos DESC LIMIT 5000`)) as { data: string }[];
    for (const row of rows) {
      const d = JSON.parse(row.data) as Obj;
      if (waiverKey(String(d.item)) !== ask.key) continue;
      const by = option === 'accept' ? 'your answer: accepted, closed without a fix' : 'your answer: waived, closed without evidence';
      if ((await this.standing(String(d.task_ref))).get(String(d.item))?.open) await this.closed(this.o.connection(), String(d.task_ref), String(d.item), String(d.text), by);
      return;
    }
  }
}

const waiverKey = (item: string): string => sha256Hex(new TextEncoder().encode(`open item waiver\n${item}`));

/** The agent's newest task list in its transcript: the last call of the facts' tool, its input (a Codex call's arguments). */
async function newestList(facts: TaskListFacts, transcript: string): Promise<unknown> {
  let text: string;
  try { text = await readFile(transcript, 'utf8'); } catch { return undefined; }
  let newest: unknown;
  for (const raw of text.split('\n')) {
    if (!raw.includes(facts.tool)) continue;
    let line: unknown;
    try { line = JSON.parse(raw); } catch { continue; }
    if (!isObj(line)) continue;
    // Claude Code: an assistant entry's tool_use part.
    if (isObj(line.message) && Array.isArray(line.message.content)) {
      for (const part of line.message.content) if (isObj(part) && part.type === 'tool_use' && part.name === facts.tool) newest = part.input;
    }
    // Codex: a rollout response_item's function_call, its arguments as JSON text.
    const p = line.payload;
    if (line.type === 'response_item' && isObj(p) && p.type === 'function_call' && p.name === facts.tool && typeof p.arguments === 'string') {
      try { newest = JSON.parse(p.arguments); } catch { /* a call that doesn't parse lists nothing */ }
    }
  }
  return newest;
}
