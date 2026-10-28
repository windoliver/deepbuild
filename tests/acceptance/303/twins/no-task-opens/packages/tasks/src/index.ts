// TWIN no-task-opens: a wrong program the before lane lays over the change; no prompt ever opens a task.
// The kernel's ask-tasks (#303): each prompt recorded with its origin, a task for each ask a person typed that asks
// for new or changed behavior, its definition of done locked by hash with the issue's revision and the base commit,
// the check files it names kept by digest, and the stop and answer rule over a session's recorded turns. The record
// is its only state; it locks the definition it is handed and never drafts one.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { canonicalize, sha256Hex } from '@deepbuild/contracts';
import type { JsonValue } from '@deepbuild/contracts';
import type { Connection, RecordStore } from '@deepbuild/record';

export type Role = 'owner' | 'collaborator' | 'outside';
export type From = 'person' | 'scheduled' | 'subagent' | 'session' | 'continuation' | 'unknown';
export interface Author { handle: string; role: Role }
/** A work.item@1 reading, as a work source gives it (design: Work source): each author's role comes from here, never from text. */
export interface WorkItem { source_id: string; link: string; title: string; body: string; criteria: string[]; authors: Author[]; updated: number }

/**
 * One UserPromptSubmit, as the adapter placed it: the hub's message number, the text and the origin. The hub hands
 * the event's own identity too (its ID, stamp and time), so a spool replayed again finds its events there once.
 */
export interface Prompt { msg: number; text: string; from: From; id?: string; seq?: string; ts?: number }
/** What the prompt hook recorded: the user.ask's event ID, and the task it opened (its message handle) or null. */
export interface Prompted { ask: string; task: string | null }

export type Oracle = 'code' | 'model' | 'person';
/** A requirement as the drafting job hands it over: its text, the handle of the author it came from, and the check files it names, by path. */
export interface RequirementInput { id: string; text: string; author: string; checks: string[]; oracle: Oracle; depth: string }
/** A definition handed to the kernel to lock. The kernel never drafts one. */
export interface DefinitionInput {
  task_ref: string;
  requirements: RequirementInput[];
  deliverables: string[];
  issue_rev: string;
  base_commit: string;
  /** The folder the requirements' check paths resolve under; the kernel reads their bytes here at the lock. */
  root: string;
  /** The work.item@1 reading that gives each requirement's author a role. */
  item: WorkItem;
}
export interface CheckFile { path: string; sha256: string }
export interface Requirement { id: string; text: string; author: Author; checks: CheckFile[]; oracle: Oracle; depth: string }
/** A definition as the kernel holds it: locked, or waiting for one ask about text from outside the repo. */
export interface Definition {
  task_ref: string;
  requirements: Requirement[];
  deliverables: string[];
  issue_rev: string;
  base_commit: string;
  hash: string;
  state: 'waiting' | 'locked';
  waiting: string | null;
}
/** A check file as approved at the lock: its bytes, kept by digest. */
export interface ApprovedFile extends CheckFile { bytes: Uint8Array }
/** A claim's recomputation: the hash from the definition and the check files as they stand, against the locked one. */
export interface ClaimCheck { hash: string; locked: string; changed: string[]; proposal: string | null }
/** The stop rule's reading of one recorded agent.stop. */
export interface StopReading { stop: string; claim: boolean; reason: string }
export interface AskTask { task_ref: string; thread: string; state: string; owner: string; definition: Definition | null }

export interface TasksOptions {
  record: RecordStore;
  /** The only clock the kernel reads. */
  now: () => number;
  /** The hub's home: the kernel keeps the approved check bytes under it, by digest. */
  home: string;
}
export interface Tasks {
  /** The prompt hook: records the user.ask with its from and, when a person's prompt asks for new or changed behavior, its task, before it returns. */
  prompt(connection: Connection, prompt: Prompt): Promise<Prompted>;
  /** Reads what the record gained since the last call (an answer to a definition ask) and acts on it. */
  tick(): Promise<void>;
  /** Locks the definition it is handed, or holds it for one ask when its text comes from outside the repo. */
  lock(connection: Connection, definition: DefinitionInput): Promise<Definition>;
  definition(task_ref: string): Promise<Definition | undefined>;
  /** The kernel's hash over a definition as read back: hashOf(definition(ref)) equals the recorded hash while nothing changed. */
  hashOf(definition: Definition): string;
  /** The check files approved at the lock, by digest. */
  approved(task_ref: string): Promise<ApprovedFile[]>;
  /** A claim on the task: recomputes the hash as the gate runner would at every claim. */
  claim(connection: Connection, task_ref: string): Promise<ClaimCheck>;
  /** The stop and answer rule, over a session's recorded turns: one reading per agent.stop. */
  stops(session: string): Promise<StopReading[]>;
  /** The ask-tasks of a thread, each with its definition. */
  tasks(thread: string): Promise<AskTask[]>;
}

/** Every refusal the kernel makes. Each names what it refuses. */
export class TasksRefused extends Error {
  readonly field?: string;
  readonly task?: string;
  constructor(message: string, named: { field?: string; task?: string } = {}) {
    super(message);
    this.name = 'TasksRefused';
    if (named.field !== undefined) this.field = named.field;
    if (named.task !== undefined) this.task = named.task;
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const sql = (text: string): string => text.replace(/'/g, "''");
const letters = (session: string): string => session.replace(/[^0-9A-Za-z]/g, '');
const TASK_REF = /^(task:[0-9A-Za-z]+|session:[0-9A-Za-z]+#[A-Za-z0-9][A-Za-z0-9._-]*)$/;
const COMMIT = /^[0-9a-f]{40}$/;
const ROLES = new Set<string>(['owner', 'collaborator', 'outside']);
const ORACLES = new Set<string>(['code', 'model', 'person']);
const DEFINITION_ASK_WAIT = 4 * 3_600_000;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A ULID at `ms` whose random part is a hash of `key`: the same prompt always opens the task under the same ID, so a replay finds it once. */
function ulidFrom(ms: number, key: string): string {
  let out = '';
  let time = BigInt(ms);
  for (let i = 0; i < 10; i++) { out = CROCKFORD[Number(time & 31n)] + out; time >>= 5n; }
  let random = BigInt(`0x${createHash('sha256').update(key).digest('hex').slice(0, 20)}`);
  let tail = '';
  for (let i = 0; i < 16; i++) { tail = CROCKFORD[Number(random & 31n)] + tail; random >>= 5n; }
  return out + tail;
}
const sha256Of = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
/** Whether a path relative to a folder leaves it: empty (the folder itself), absolute, or through its parent. */
const leaves = (rel: string): boolean => !rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`);
/** The requirements as the hash and the definition events carry them: the same fields, nothing else. */
const plain = (requirements: readonly Requirement[]): JsonValue[] => requirements.map((r) => ({
  id: r.id, text: r.text, author: { handle: r.author.handle, role: r.author.role },
  checks: r.checks.map((c) => ({ path: c.path, sha256: c.sha256 })), oracle: r.oracle, depth: r.depth,
}));

// ---- Does a prompt ask for new or changed behavior? A rule over the text, with no model (design: What done means).

/** Words that open a question: a prompt starting with one asks, and a stop that answers it is an answer. */
const QUESTION_START = /^(?:explain|why|how|what|which|where|when|who|whose|whom|describe|summari[sz]e|tell me|show me|walk me|is|are|does|do|did|was|were|has|have|had|could you explain|can you explain)\b/i;
/** A prompt that changes no behavior, such as a rename, is judged by the repo's spec alone and opens no task. */
const NO_BEHAVIOR = /^(?:(?:please\s+)?(?:just\s+)?(?:rename|reformat|format|re-?indent|re-?order|sort|alphabeti[sz]e|lint|prettify|tidy|clean up)\b|(?:fix|correct)\s+(?:the\s+|a\s+)?typos?\b|(?:add|update|fix)\s+(?:the\s+|a\s+)?comments?\b)/i;
/** Verbs that ask for new or changed behavior, and the words a bug report brings. */
const CHANGE = /\b(?:make|add|implement|fix|change|remove|delete|drop|update|upgrade|write|create|build|refactor|rewrite|support|allow|accept|reject|refuse|stop|prevent|block|enable|disable|turn (?:on|off)|migrate|replace|introduce|handle|return|throw|raise|convert|extract|split|merge|improve|speed up|optimi[sz]e|cache|validate|ensure|guard|retry|log|record|emit|send|notify|redirect|rename|move|wire|hook up|expose|hide|show|render|display|should|must|needs? to|broken|bug|crash(?:es|ed)?|fails?|failing|error|doesn'?t work|isn'?t working|not working|regress(?:ion|ed))\b/i;

/** Whether a person's prompt asks for new or changed behavior. Only the issue's example texts are fixed; the rule is the kernel's. */
function asksForChange(text: string): boolean {
  const t = text.trim().replace(/^[\s>*\-#]+/, '');
  if (!t) return false;
  if (NO_BEHAVIOR.test(t) && !/\b(?:and|then|also)\b.*\b(?:make|add|implement|fix(?!\s+(?:the\s+|a\s+)?typos?)|change|remove|support|reject|prevent)\b/i.test(t)) return false;
  if (QUESTION_START.test(t)) return false;
  if (t.endsWith('?') && !/^(?:can|could|would|will|please)\b/i.test(t)) return false;
  return CHANGE.test(t);
}

class TasksCore {
  private readonly record: RecordStore;
  private readonly now: () => number;
  private readonly approvedDir: string;
  /** Where each task's check paths resolve, from the lock that read them; a task met after a restart takes its session's worktree. */
  private readonly roots = new Map<string, string>();

  constructor(options: TasksOptions) {
    this.record = options.record;
    this.now = options.now;
    this.approvedDir = join(options.home, 'approved');
  }

  private core(connection: Connection): Connection {
    return { writer: 'core', actor: connection.actor, scope: connection.scope, ...(connection.session ? { session: connection.session } : {}), ...(connection.agent ? { agent: connection.agent } : {}) };
  }

  private async rows(query: string): Promise<Obj[]> {
    return ((await this.record.raw(query)) as unknown[]).filter(isObj);
  }
  private async threadOf(session: string): Promise<string> {
    const [row] = await this.rows(`SELECT thread_id FROM sessions WHERE id = '${sql(session)}'`);
    return typeof row?.thread_id === 'string' && row.thread_id ? row.thread_id : session;
  }

  // ---- The prompt hook.

  async prompt(connection: Connection, prompt: Prompt): Promise<Prompted> {
    const session = connection.session;
    if (!session) throw new TasksRefused('a prompt is recorded for its session: the connection names none', { field: 'session' });
    if (!Number.isInteger(prompt.msg) || prompt.msg < 0) throw new TasksRefused('a prompt carries its message number', { field: 'msg' });
    if (typeof prompt.text !== 'string') throw new TasksRefused('a prompt carries its text', { field: 'text' });
    const ts = prompt.ts ?? this.now();
    const id = prompt.id ?? ulidFrom(ts, `${session}#${prompt.msg}:${prompt.text}`);
    // Only a prompt a person typed is your ask, and only one that asks for new or changed behavior opens a task; one the
    // hub couldn't check against its session (design: Threats, callers posing as others) opens none.
    void asksForChange;
    void letters;
    const handle: string | null = null;
    const data: JsonValue = { msg: prompt.msg, text: prompt.text, tasks: handle ? [handle] : [], from: prompt.from };
    await this.record.append(connection, { v: 1, id, kind: 'user.ask', ts, ...(prompt.seq !== undefined ? { seq: prompt.seq } : {}), data });
    if (handle) {
      const thread = await this.threadOf(session);
      await this.record.append(this.core(connection), {
        v: 1, id: ulidFrom(ts, `task:${id}`), kind: 'task.created', ts, data: { task_ref: handle, thread, owner: connection.actor, title: prompt.text.slice(0, 200) || handle },
      });
    }
    return { ask: id, task: handle };
  }

  // ---- The lock.

  hashOf(definition: Definition): string {
    return sha256Hex(canonicalize({ task_ref: definition.task_ref, requirements: plain(definition.requirements), deliverables: [...definition.deliverables], issue_rev: definition.issue_rev, base_commit: definition.base_commit }));
  }

  /** The definition as the kernel reads it from what it was handed: roles from the reading, check files read and kept by digest. */
  private prepare(input: DefinitionInput): { definition: Definition; bytes: Map<string, Uint8Array> } {
    if (!isObj(input)) throw new TasksRefused('a definition is an object', { field: 'definition' });
    if (typeof input.task_ref !== 'string' || !TASK_REF.test(input.task_ref)) throw new TasksRefused('a definition names its task: task:<id> or session:<id>#<msg>', { field: 'task_ref' });
    const task = input.task_ref;
    if (typeof input.issue_rev !== 'string' || !input.issue_rev) throw new TasksRefused(`${task}: a definition carries the issue's revision`, { field: 'issue_rev', task });
    if (typeof input.base_commit !== 'string' || !COMMIT.test(input.base_commit)) throw new TasksRefused(`${task}: a definition carries its base commit, 40 hex`, { field: 'base_commit', task });
    if (typeof input.root !== 'string' || !input.root) throw new TasksRefused(`${task}: a definition names the folder its check paths resolve under`, { field: 'root', task });
    if (!isObj(input.item) || !Array.isArray(input.item.authors)) throw new TasksRefused(`${task}: a definition carries the work.item@1 reading that gives each author a role`, { field: 'item', task });
    if (!Array.isArray(input.requirements) || !input.requirements.length) throw new TasksRefused(`${task}: a definition holds at least one requirement`, { field: 'requirements', task });
    if (!Array.isArray(input.deliverables) || input.deliverables.some((d) => typeof d !== 'string' || !d)) throw new TasksRefused(`${task}: deliverables are paths`, { field: 'deliverables', task });
    // The role is the reading's, never the text's; an author the reading doesn't know is outside the repo.
    const roles = new Map<string, Role>();
    for (const author of input.item.authors) {
      if (!isObj(author) || typeof author.handle !== 'string' || typeof author.role !== 'string' || !ROLES.has(author.role)) throw new TasksRefused(`${task}: each author of the reading has a handle and a role: owner, collaborator or outside`, { field: 'item.authors', task });
      roles.set(author.handle, author.role as Role);
    }
    const root = resolve(input.root);
    const real = existsSync(root) ? realpathSync(root) : root;
    const bytes = new Map<string, Uint8Array>();
    const seen = new Set<string>();
    const requirements = input.requirements.map((r, i) => {
      const at = `requirements/${i}`;
      if (!isObj(r) || typeof r.id !== 'string' || !/^R[1-9][0-9]*$/.test(r.id)) throw new TasksRefused(`${task}: requirement ${i} needs an ID R1, R2, …`, { field: `${at}/id`, task });
      if (seen.has(r.id)) throw new TasksRefused(`${task}: requirement ${r.id} appears twice`, { field: `${at}/id`, task });
      seen.add(r.id);
      if (typeof r.text !== 'string' || !r.text) throw new TasksRefused(`${task}: requirement ${r.id} has no text`, { field: `${at}/text`, task });
      if (typeof r.author !== 'string' || !r.author) throw new TasksRefused(`${task}: requirement ${r.id} names the author its text came from`, { field: `${at}/author`, task });
      if (typeof r.oracle !== 'string' || !ORACLES.has(r.oracle)) throw new TasksRefused(`${task}: requirement ${r.id} names its oracle: code, model or person`, { field: `${at}/oracle`, task });
      if (typeof r.depth !== 'string' || !r.depth) throw new TasksRefused(`${task}: requirement ${r.id} names its depth`, { field: `${at}/depth`, task });
      if (!Array.isArray(r.checks) || r.checks.some((c) => typeof c !== 'string' || !c)) throw new TasksRefused(`${task}: requirement ${r.id} names its check files by path`, { field: `${at}/checks`, task });
      const checks = r.checks.map((path) => {
        const file = resolve(root, path);
        const rel = relative(root, file);
        if (leaves(rel)) throw new TasksRefused(`${task}: check ${path} of ${r.id} leaves the folder ${input.root}`, { field: `${at}/checks`, task });
        if (!existsSync(file)) throw new TasksRefused(`${task}: check ${path} of ${r.id} is not under ${input.root}`, { field: `${at}/checks`, task });
        // The bytes read are the file's own: a link that points out of the folder is refused, not followed.
        const target = relative(real, realpathSync(file));
        if (leaves(target)) throw new TasksRefused(`${task}: check ${path} of ${r.id} links out of the folder ${input.root}`, { field: `${at}/checks`, task });
        if (!statSync(file).isFile()) throw new TasksRefused(`${task}: check ${path} of ${r.id} is not a file`, { field: `${at}/checks`, task });
        const content = readFileSync(file);
        const digest = sha256Of(content);
        bytes.set(digest, content);
        return { path, sha256: digest };
      });
      return { id: r.id, text: r.text, author: { handle: r.author, role: roles.get(r.author) ?? 'outside' }, checks, oracle: r.oracle as Oracle, depth: r.depth };
    });
    const definition: Definition = { task_ref: task, requirements, deliverables: [...input.deliverables], issue_rev: input.issue_rev, base_commit: input.base_commit, hash: '', state: 'locked', waiting: null };
    definition.hash = this.hashOf(definition);
    return { definition, bytes };
  }

  /** The approved bytes, kept once by digest. */
  private keep(digest: string, bytes: Uint8Array): void {
    mkdirSync(this.approvedDir, { recursive: true });
    const file = join(this.approvedDir, digest);
    if (!existsSync(file)) writeFileSync(file, bytes);
  }

  private definitionEvent(definition: Definition): JsonValue {
    return {
      definition: definition.hash, task_ref: definition.task_ref,
      requirements: plain(definition.requirements),
      deliverables: [...definition.deliverables], issue_rev: definition.issue_rev, hash: definition.hash, base_commit: definition.base_commit, budget: null,
    };
  }

  async lock(connection: Connection, input: DefinitionInput): Promise<Definition> {
    const { definition, bytes } = this.prepare(input);
    const task = definition.task_ref;
    const [row] = await this.rows(`SELECT task_ref FROM tasks WHERE task_ref = '${sql(task)}'`);
    if (!row) throw new TasksRefused(`${task}: no task to lock a definition for`, { field: 'task_ref', task });
    const held = await this.definition(task); // ticks first: a draft whose ask closed locks before it could be redrafted
    if (held?.state === 'locked') throw new TasksRefused(`${task}: its definition is locked; it changes only through a dispute you answer`, { field: 'task_ref', task });
    // A draft waits while its ask is open; one whose ask closed on neither option (words, a cancel) takes a new draft.
    if (held?.waiting && (await this.askOpen(held.waiting.slice(4)))) throw new TasksRefused(`${task}: its definition is waiting for your answer to ${held.waiting}`, { field: 'task_ref', task });
    for (const [digest, content] of bytes) this.keep(digest, content);
    this.roots.set(task, resolve(input.root));
    const ts = this.now();
    const outside = definition.requirements.filter((r) => r.author.role === 'outside');
    if (!outside.length) {
      await this.record.append(this.core(connection), { v: 2, id: ulidFrom(ts, `lock:${task}:${definition.hash}`), kind: 'definition.locked', ts, data: this.definitionEvent(definition) });
      return definition;
    }
    // Text from anyone but you or a repo collaborator can add requirements, never remove or waive one, and the
    // definition locks only after one ask about it: the early question, with the requirement kept or left out. Left
    // unanswered, the ask defaults to keeping it: nothing drops a requirement but your answer.
    const askId = ulidFrom(ts, `ask:${task}:${definition.hash}`);
    const names = outside.map((r) => `${r.id} (${r.author.handle})`).join(', ');
    const ask: JsonValue = {
      kind: 'definition',
      question: `Done for ${task} includes ${outside.length === 1 ? 'a requirement' : `${outside.length} requirements`} from outside the repo, ${names}: ${outside.map((r) => `"${r.text}"`).join('; ')}. Keep ${outside.length === 1 ? 'it' : 'them'}?`,
      options: [{ id: 'keep', label: `Keep ${outside.length === 1 ? 'the requirement' : 'the requirements'}`, decision: 'none' }, { id: 'drop', label: `Leave ${outside.length === 1 ? 'it' : 'them'} out`, decision: 'none' }],
      recommended: 'keep', deadline: ts + DEFINITION_ASK_WAIT, fallback: 'you', default: 'keep', provisional: false, owner: connection.actor,
      key: sha256Of(`definition:${task}`), pinned_to: { kind: 'evidence', ref: definition.hash },
    };
    await this.record.append(this.core(connection), { v: 1, id: askId, kind: 'ask.created', ts, data: ask });
    await this.record.append(this.core(connection), { v: 2, id: ulidFrom(ts, `draft:${task}:${definition.hash}`), kind: 'definition.drafted', ts, data: this.definitionEvent(definition) });
    return { ...definition, state: 'waiting', waiting: `ask:${askId}` };
  }

  private async askOpen(askId: string): Promise<boolean> {
    const [ask] = await this.rows(`SELECT status FROM asks WHERE id = '${sql(askId)}'`);
    return ask !== undefined && (ask.status === 'open' || ask.status === 'later');
  }

  /** The option an ask closed on: its answer, the default it took, or the answer of the decision that covered it; words are keep. */
  private async optionOf(askId: string): Promise<string | undefined> {
    const [ask] = await this.rows(`SELECT status, answer FROM asks WHERE id = '${sql(askId)}'`);
    if (!ask) return undefined;
    const parse = (text: unknown): unknown => { try { return JSON.parse(String(text ?? 'null')); } catch { return text; } };
    let answer: unknown;
    if (ask.status === 'answered' || ask.status === 'defaulted') answer = parse(ask.answer);
    else if (ask.status === 'decided') {
      const [applied] = await this.rows(`SELECT json_extract(data, '$.decision') AS decision FROM events WHERE kind = 'decision.applied' AND json_extract(data, '$.ask') = 'ask:${sql(askId)}' ORDER BY log_pos DESC LIMIT 1`);
      const [decision] = applied ? await this.rows(`SELECT answer FROM decisions WHERE id = '${sql(String(applied.decision).replace(/^decision:/, ''))}'`) : [];
      answer = decision ? parse(decision.answer) : undefined;
    }
    if (isObj(answer)) answer = answer.option;
    // An answer in words that names neither option (the next prompt you typed closes a shown question as its answer)
    // drops nothing: the requirement stays, as the default would keep it.
    if ((ask.status === 'answered' || ask.status === 'defaulted') && answer !== 'keep' && answer !== 'drop') return 'keep';
    return typeof answer === 'string' ? answer : undefined;
  }

  private ticking: Promise<void> = Promise.resolve();
  /** Each drafted definition whose ask closed locks: kept whole on "keep" (the answer or the default), without the outside requirements on "drop". */
  tick(): Promise<void> {
    // One pass at a time: the hub's timer and a claim may ask together, and each pass sees what the one before appended.
    return (this.ticking = this.ticking.catch(() => undefined).then(() => this.pass()));
  }
  private async pass(): Promise<void> {
    const drafted = await this.rows("SELECT task_ref FROM definitions WHERE state = 'drafted'");
    for (const row of drafted) {
      const task = String(row.task_ref);
      const read = await this.read(task);
      if (!read || read.state !== 'waiting' || !read.waiting) continue;
      const askId = read.waiting.slice(4);
      const option = await this.optionOf(askId);
      // An ask still open, or closed on no option the kernel reads, locks nothing: the definition keeps waiting.
      if (option !== 'keep' && option !== 'drop') continue;
      const kept: Definition = { ...read, requirements: option === 'keep' ? read.requirements : read.requirements.filter((r) => r.author.role !== 'outside'), state: 'locked', waiting: null, hash: '' };
      // A definition with nothing left to check never locks: the draft stays, for a redraft with your own requirement.
      if (!kept.requirements.length) continue;
      kept.hash = this.hashOf(kept);
      const ts = this.now();
      // The lock is appended as the ask was: for its actor and scope, under its session.
      const [raised] = await this.rows(`SELECT actor, scope, session_id FROM events WHERE id = '${sql(askId)}'`);
      const connection: Connection = { writer: 'core', actor: String(raised?.actor ?? 'you'), scope: String(raised?.scope ?? 'you'), ...(typeof raised?.session_id === 'string' && raised.session_id ? { session: raised.session_id } : {}) };
      await this.record.append(connection, { v: 2, id: ulidFrom(ts, `lock:${task}:${kept.hash}`), kind: 'definition.locked', ts, data: this.definitionEvent(kept) });
    }
  }

  /** The definition the record holds for a task, from its definitions row and, while it waits, its ask. */
  private async read(task: string): Promise<Definition | undefined> {
    const [row] = await this.rows(`SELECT task_ref, requirements, base_commit, hash, issue_rev, state FROM definitions WHERE task_ref = '${sql(task)}'`);
    if (!row) return undefined;
    const requirements = (() => { try { return JSON.parse(String(row.requirements)) as unknown; } catch { return []; } })();
    const list = Array.isArray(requirements) ? requirements.filter(isObj) : [];
    const definition: Definition = {
      task_ref: task,
      requirements: list.map((r) => ({
        id: String(r.id), text: String(r.text),
        author: isObj(r.author) ? { handle: String(r.author.handle), role: (ROLES.has(String(r.author.role)) ? String(r.author.role) : 'outside') as Role } : { handle: 'you', role: 'owner' },
        checks: Array.isArray(r.checks) ? r.checks.filter(isObj).map((c) => ({ path: String(c.path), sha256: String(c.sha256) })) : [],
        oracle: (ORACLES.has(String(r.oracle)) ? String(r.oracle) : 'code') as Oracle, depth: String(r.depth),
      })),
      deliverables: [], issue_rev: typeof row.issue_rev === 'string' ? row.issue_rev : '', base_commit: String(row.base_commit), hash: String(row.hash),
      state: row.state === 'drafted' ? 'waiting' : 'locked', waiting: null,
    };
    // The deliverables live in the event; the projection keeps the requirements, the hash and the rest.
    const [event] = await this.rows(`SELECT data FROM events WHERE kind IN ('definition.locked', 'definition.drafted', 'definition.revised') AND json_extract(data, '$.task_ref') = '${sql(task)}' ORDER BY log_pos DESC LIMIT 1`);
    if (event) {
      const data = (() => { try { return JSON.parse(String(event.data)) as unknown; } catch { return undefined; } })();
      if (isObj(data) && Array.isArray(data.deliverables)) definition.deliverables = data.deliverables.map(String);
    }
    if (definition.state === 'waiting') {
      // The draft's own ask: the one pinned to its hash, since an earlier draft of the task may have had one too.
      const [ask] = await this.rows(`SELECT id FROM asks WHERE key = '${sha256Of(`definition:${task}`)}' AND json_extract(pinned_to, '$.ref') = '${sql(definition.hash)}' ORDER BY created DESC, rowid DESC LIMIT 1`);
      definition.waiting = ask ? `ask:${String(ask.id)}` : null;
    }
    return definition;
  }

  /** The definition as the record holds it, once every closed definition ask has locked its draft. */
  async definition(task: string): Promise<Definition | undefined> {
    await this.tick();
    return this.read(task);
  }

  async approved(task: string): Promise<ApprovedFile[]> {
    const definition = await this.definition(task);
    if (!definition) return [];
    return definition.requirements.flatMap((r) => r.checks.map((c) => ({ ...c, bytes: new Uint8Array(readFileSync(join(this.approvedDir, c.sha256))) })));
  }

  /** Where a task's check paths resolve: the lock's folder, else the worktree of the session claiming. */
  private async rootOf(connection: Connection, task: string): Promise<string | undefined> {
    const kept = this.roots.get(task);
    if (kept) return kept;
    if (!connection.session) return undefined;
    const [row] = await this.rows(`SELECT worktree FROM sessions WHERE id = '${sql(connection.session)}'`);
    return typeof row?.worktree === 'string' && row.worktree ? row.worktree : undefined;
  }

  /** Whether `file` is a file whose own bytes sit under `root`: a link out of the folder is not. */
  private inside(root: string, file: string): boolean {
    if (!existsSync(root) || !existsSync(file) || !statSync(file).isFile()) return false;
    const target = relative(realpathSync(root), realpathSync(file));
    return !leaves(target);
  }

  async claim(connection: Connection, task: string): Promise<ClaimCheck> {
    // Whatever closed the definition ask (an answer, a default, the next prompt you typed), the draft locks first.
    const definition = await this.definition(task);
    if (!definition) throw new TasksRefused(`${task}: no definition to claim against`, { field: 'task_ref', task });
    if (definition.state !== 'locked') {
      const askId = definition.waiting?.slice(4);
      const open = askId ? await this.askOpen(askId) : false;
      const option = askId && !open ? await this.optionOf(askId) : undefined;
      const why = open ? `waits for your answer to ${definition.waiting}`
        : option === 'drop' ? `has nothing left to check: ${definition.waiting} dropped its only requirements; lock a definition with your own`
        : definition.waiting ? `is not locked: ${definition.waiting} closed on neither option; lock a definition again`
        : 'is drafted with no ask of its own; lock a definition again';
      throw new TasksRefused(`${task}: its definition ${why}`, { field: 'task_ref', task });
    }
    const root = definition.requirements.some((r) => r.checks.length) ? await this.rootOf(connection, task) : undefined;
    if (definition.requirements.some((r) => r.checks.length) && !root) throw new TasksRefused(`${task}: no folder to read its check files under; claim from the session whose worktree holds them`, { field: 'root', task });
    const changed: string[] = [];
    const now: Definition = {
      ...definition,
      requirements: definition.requirements.map((r) => ({
        ...r,
        checks: r.checks.map((c) => {
          // A file gone from the folder is a change too: its digest is the empty file's.
          const file = resolve(root!, c.path);
          const digest = this.inside(root!, file) ? sha256Of(readFileSync(file)) : sha256Of('');
          if (digest !== c.sha256) changed.push(c.path);
          return { path: c.path, sha256: digest };
        }),
      })),
    };
    const hash = this.hashOf(now);
    let proposal: string | null = null;
    if (changed.length) {
      // The lock stands: the claim's checks run the approved bytes, and the change waits in the open items as a proposal.
      const text = `${changed.length === 1 ? 'Check file' : 'Check files'} ${changed.join(', ')} changed after the lock (locked ${definition.hash.slice(0, 12)}, now ${hash.slice(0, 12)}): the checks run the approved bytes kept by digest; the change is proposed, not applied.`;
      // One proposal per change: a claim that meets the same change again names the open item still open for it.
      const items = await this.rows(`SELECT id, json_extract(data, '$.text') AS text FROM events WHERE kind = 'open_item.opened' AND json_extract(data, '$.task_ref') = '${sql(task)}' ORDER BY log_pos DESC`);
      const standing = (await this.rows(`SELECT text FROM open_items WHERE task_ref = '${sql(task)}' AND closed IS NULL`)).some((item) => item.text === text);
      const open = standing ? items.find((item) => item.text === text) : undefined;
      if (open) proposal = String(open.id);
      else {
        const ts = this.now();
        proposal = ulidFrom(ts, `proposal:${task}:${hash}`);
        await this.record.append(this.core(connection), { v: 1, id: proposal, kind: 'open_item.opened', ts, subject: task, data: { task_ref: task, text } });
      }
    }
    return { hash, locked: definition.hash, changed, proposal };
  }

  // ---- The stop and answer rule.

  async stops(session: string): Promise<StopReading[]> {
    const view = await this.record.session(session);
    if (!view) return [];
    const rows = await this.rows(`SELECT id, kind, data FROM events WHERE session_id = '${sql(session)}'`);
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    const readings: StopReading[] = [];
    for (const turn of view.turns) {
      const events = turn.events.map((id) => byId.get(id)).filter((e): e is Obj => e !== undefined);
      const data = (e: Obj): Obj => { try { const d: unknown = JSON.parse(String(e.data)); return isObj(d) ? d : {}; } catch { return {}; } };
      const first = events.find((e) => e.kind === 'user.ask');
      // A message typed while the agent worked joins the open turn: a task it opened is the turn's too.
      const opened = events.some((e) => e.kind === 'user.ask' && Array.isArray(data(e).tasks) && (data(e).tasks as unknown[]).length > 0);
      const changed = events.some((e) => (e.kind === 'tool.before' || e.kind === 'tool.after') && ['edit', 'write'].includes(String(data(e).kind))) || events.some((e) => e.kind === 'ask.created');
      for (const stop of events.filter((e) => e.kind === 'agent.stop')) {
        const id = String(stop.id);
        if (!first) { readings.push({ stop: id, claim: false, reason: 'the turn began with no prompt: a stop right after startup, a resume or /clear is never a claim' }); continue; }
        const prompt = data(first);
        if (prompt.from === 'person' && !opened && !changed) { readings.push({ stop: id, claim: false, reason: 'an answer: the turn began with a prompt you typed that opened no task, with no edit, write or ask in it' }); continue; }
        if (data(stop).did_work !== true) { readings.push({ stop: id, claim: false, reason: 'no work since the turn began' }); continue; }
        readings.push({ stop: id, claim: true, reason: opened ? 'the turn did work on the task its prompt opened' : changed ? 'the turn did work: an edit, a write or an ask' : 'the turn did work' });
      }
    }
    return readings;
  }

  async tasks(thread: string): Promise<AskTask[]> {
    await this.tick();
    const rows = await this.rows(`SELECT task_ref, thread, state, owner FROM tasks WHERE thread = '${sql(thread)}' ORDER BY created, task_ref`);
    const out: AskTask[] = [];
    for (const row of rows) out.push({ task_ref: String(row.task_ref), thread: String(row.thread), state: String(row.state), owner: String(row.owner), definition: (await this.read(String(row.task_ref))) ?? null });
    return out;
  }
}

export async function openTasks(options: TasksOptions): Promise<Tasks> {
  const core = new TasksCore(options);
  await core.tick();
  // Plain functions, so a caller can wrap one method and keep the rest.
  return {
    prompt: core.prompt.bind(core), tick: core.tick.bind(core), lock: core.lock.bind(core), definition: core.definition.bind(core), hashOf: core.hashOf.bind(core),
    approved: core.approved.bind(core), claim: core.claim.bind(core), stops: core.stops.bind(core), tasks: core.tasks.bind(core),
  };
}
