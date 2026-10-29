// Ask-tasks in the kernel (#303; design: What done means, fixed at the start, and The contract (kernel)).
//
// - A prompt you typed that asks for new or changed behavior opens a task under the session's thread, keyed by the
//   issue it names or by its message handle (`session:<id>#<msg>`). One nobody typed, one that only asks a question,
//   and a rename open none. The rule reads the words' form, with no model: a question asks, a rename renames, and
//   anything else you typed asks for a change, so an unplaced form opens a task rather than going unjudged.
// - The kernel locks the definition it is handed and never drafts one: here a test's fixture
//   (DEEP_HUB_TEST_DRAFTS), the issue's criteria from week 3, the drafting job's output from week 5. A task with
//   none handed waits. The lock records the hash, the issue's revision and the base commit; each requirement keeps
//   the author of the text it came from, with the role the work source's `work.item@1` reading gives them
//   (DEEP_HUB_TEST_WORK is the test source), and each check's bytes are kept by digest in the evidence store.
// - Text from anyone but you or a repo collaborator adds requirements and never removes or waives one, and a
//   definition that carries such text locks only after one ask about it.
// - At each claim the hash is recomputed from the stored definition and the checks' bytes on disk; a check changed
//   since the lock is a proposal naming its file, never a new definition.
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
import type { Asks, Delivery } from '@deepbuild/asks';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { ulid, type Connection, type EventInput } from '@deepbuild/record';
import { headOf } from './session-facts.js';
import type { Plant } from './wire.js';

type Obj = Record<string, unknown>;
const sql = (s: string) => s.replace(/'/g, "''");
const letters = (s: string) => s.replace(/[^0-9A-Za-z]/g, '');

// ---- Which prompts ask for a change.

/** Words that only lead into a request: "also", "please", "can you". */
const LEAD = /^(?:(?:also|and|then|now|next|so|ok(?:ay)?|please|finally|can you|could you|would you|will you|let's|lets|i want you to|i'd like you to|i would like you to)\b[\s,]*)+/i;
/** A request's verb: what you ask the code to start or stop doing. */
const CHANGE = /^(?:add|make|fix|implement|change|update|remove|delete|drop|create|build|write|support|reject|return|accept|allow|block|send|handle|refactor|replace|move|use|switch|enable|disable|introduce|set|ensure|log|raise|throw|validate|limit|cache|retry|convert|migrate|port|upgrade|bump|wire|expose|split|extend|improve|optimi[sz]e|rewrite|rework|redesign|cover)\b/i;
/** A question's lead word. */
const ASKS = /^(?:why|what|how|where|when|which|who|whose|is|are|was|were|does|do|did|can|could|would|should|will|has|have|explain|describe|tell me|walk me through|summari[sz]e|list|compare)\b/i;

/** Whether a prompt you typed asks for new or changed behavior: not a question, and not a rename alone. */
export function asksForChange(text: string): boolean {
  const clauses = text.trim().split(/[;\n]+|\.\s+|,?\s+\b(?:and then|and|then|also)\b\s+/i).map((c) => c.trim().replace(LEAD, '')).filter(Boolean);
  if (!clauses.length) return false;
  // A rename changes no behavior; it is judged by the repo's spec alone, unless another clause asks for a change.
  if (/^rename\b/i.test(clauses[0]!)) return clauses.slice(1).some((c) => CHANGE.test(c));
  if (clauses.some((c) => CHANGE.test(c))) return true;
  return !(text.trim().endsWith('?') || ASKS.test(clauses[0]!));
}

// ---- Definitions handed to the kernel, and the work source's readings.

interface Requirement { id: string; text: string; source_line: string; refuted_by: string; check: string | null; check_sha256: string | null; on_base: string; asserts: string[]; depth: string; oracle: string; near_misses: string[]; author: Author }
interface Author { handle: string; role: string }
interface Handed { ask?: string; issue?: string; requirements: Obj[]; deliverables?: string[]; budget?: JsonValue; waives?: { id: string; source_line: string }[] }
/** A work source's work.item@1 reading: the test source's carries its body as text. */
export interface WorkItem { source_id: string; link: string; title: string; body: string; authors: { handle: string; role: string }[]; updated: string }
type Reading = WorkItem;
/** A definition as locked, without its hash: what the hash covers. */
interface Definition { task_ref: string; requirements: Requirement[]; deliverables: string[]; issue_rev: string; base_commit: string; budget: JsonValue }
interface Pending { session: string; agent: string; definition: Definition; handed: string; outside: string[] }

/** The roles whose text can remove or waive a requirement. */
const TRUSTED = new Set(['you', 'owner', 'collaborator']);

export interface AskTaskOptions {
  raw(query: string): Promise<unknown[]>;
  asks: () => Asks;
  now: () => number;
  plant: Plant | undefined;
  /** The definitions handed to the kernel, from DEEP_HUB_TEST_DRAFTS; only tests set it. */
  drafts: string | undefined;
  /** The test work source's work.item@1 readings, from DEEP_HUB_TEST_WORK; only tests set it. */
  work: string | undefined;
  append(connection: Connection, input: EventInput): Promise<void>;
  /** The core's connection for a session's events. */
  connection(session: string, agent: string): Connection;
  pin(cwd: string, question: string): Promise<Obj>;
  /** Keeps bytes in the evidence store, answering their SHA-256. */
  keep(bytes: Uint8Array, source: string): Promise<string>;
  /** Runs a claim's check from the bytes the store keeps under its approved digest. */
  run(r: { claim: string; check: string; approved: string; commit: string; cwd: string }): Promise<void>;
  /** Records the core's INVALID verdict on a claim, naming why: the floor, before any check counts. */
  invalid(claim: string, commit: string, reason: string): Promise<void>;
}

export class AskTasks {
  /** Definitions that wait for your one answer, by the ask's handle. */
  private readonly pending = new Map<string, Pending>();
  constructor(private readonly o: AskTaskOptions) {}

  private async json<T>(file: string | undefined, field: string): Promise<T[]> {
    if (!file) return [];
    try {
      const value = (JSON.parse(await readFile(file, 'utf8')) as Obj)[field];
      return Array.isArray(value) ? value as T[] : [];
    } catch {
      return [];
    }
  }

  /**
   * The tasks a prompt opens: none for a prompt nobody typed, a question or a rename; else its message's. A prompt
   * that names a work item opens that item's task instead, once the source's reading shows it (`opened`).
   */
  tasksOf(p: { session: string; msg: number; text: string; from: string; queued: boolean; first: boolean }): string[] {
    if (p.from !== 'person') return [];
    const planted = (p.first && this.o.plant === 'first-prompt-always-task') || (p.queued && this.o.plant === 'midturn-always-task');
    return planted || asksForChange(p.text) ? [`session:${letters(p.session)}#${String(p.msg)}`] : [];
  }
  /** A work item whose link the prompt names, from the work source's readings. */
  async itemOf(text: string): Promise<Reading | undefined> {
    if (!this.o.work || !/https?:\/\//.test(text)) return undefined;
    const readings = await this.json<Reading>(this.o.work, 'readings');
    return readings.find((r) => !r.link.includes('#') && new RegExp(`(?:^|\\s)${r.link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[\\s/#?.,])`).test(text));
  }

  /** The task a prompt opened: task.created under the thread, then its handed definition locked, off the hook's path. */
  async opened(t: { session: string; agent: string; cwd: string; thread: string; task_ref: string; text: string; item?: Reading }): Promise<void> {
    // A work item's task is opened once, whichever prompt names it again.
    if (t.item && (await this.o.raw(`SELECT 1 FROM tasks WHERE task_ref = '${sql(t.task_ref)}' LIMIT 1`)).length) return;
    const ts = this.o.now();
    const connection = this.o.connection(t.session, t.agent);
    await this.o.append(connection, { v: 1, id: ulid(ts), kind: 'task.created', ts, data: { task_ref: t.task_ref, thread: t.thread, owner: connection.actor, title: (t.item?.title ?? t.text).slice(0, 200) || '-' } });
    void this.lock(t).catch((error: unknown) => process.stderr.write(`deep hub: the definition of ${t.task_ref} was not locked: ${error instanceof Error ? error.message : String(error)}\n`));
  }

  /** Locks the definition handed for a task, or asks you first when outside text is in it; with none handed it waits. */
  private async lock(t: { session: string; agent: string; cwd: string; task_ref: string; text: string; item?: Reading }): Promise<void> {
    const handed = (await this.json<Handed>(this.o.drafts, 'drafts')).find((d) => (t.item ? d.issue === t.item.source_id : d.ask === t.text));
    if (!handed) return;
    const head = await headOf(t.cwd).catch(() => undefined);
    if (!head) return;
    const readings = t.item ? await this.json<Reading>(this.o.work, 'readings') : [];
    const authorOf = (line: string): Author => {
      const source = line.replace(/#L\d+$/, '');
      if (source === 'ask') return { handle: 'you', role: 'you' };
      const reading = readings.find((r) => r.source_id === source);
      const first = reading?.authors[0];
      if (!reading || !first) return { handle: 'unknown', role: 'outside' };
      // The planted wrong program believes what the text says of its author.
      if (this.o.plant === 'role-from-text' && /\brepo owner\b/i.test(reading.body)) return { handle: first.handle, role: 'owner' };
      return { handle: first.handle, role: first.role };
    };
    const requirements: Requirement[] = [];
    for (const r of handed.requirements) {
      const check = typeof r.check === 'string' && r.check ? r.check : null;
      requirements.push({
        id: String(r.id), text: String(r.text), source_line: String(r.source_line), refuted_by: String(r.refuted_by), check,
        check_sha256: check ? await this.approve(t.cwd, check) : null, on_base: String(r.on_base ?? 'fails'),
        asserts: (r.asserts as string[] | undefined) ?? [], depth: String(r.depth), oracle: String(r.oracle), near_misses: (r.near_misses as string[] | undefined) ?? [],
        author: authorOf(String(r.source_line)),
      });
    }
    // A waiver counts only from you or a repo collaborator; any other's leaves the requirement in, and makes the
    // definition wait for your one answer, as outside text that adds a requirement does.
    const outside = requirements.filter((r) => !TRUSTED.has(r.author.role)).map((r) => r.id);
    let waived = false;
    for (const w of handed.waives ?? []) {
      if (TRUSTED.has(authorOf(w.source_line).role)) {
        const at = requirements.findIndex((r) => r.id === w.id);
        if (at >= 0) requirements.splice(at, 1);
      } else waived = true;
    }
    // An item's revision is its newest reading, its comments' among them; a message's is its text's digest.
    const item = t.item;
    const revision = item ? readings.filter((r) => r.link === item.link || r.link.startsWith(`${item.link}#`)).map((r) => r.updated).sort().at(-1) ?? item.updated : undefined;
    const definition: Definition = {
      task_ref: t.task_ref, requirements, deliverables: handed.deliverables ?? [],
      issue_rev: revision ?? sha256Hex(new TextEncoder().encode(t.text)), base_commit: head.sha, budget: handed.budget ?? null,
    };
    const digest = sha256Hex(canonicalize(handed as unknown as JsonValue));
    if (!outside.length && !waived) return this.record(t.session, t.agent, definition, digest);
    const who = [...new Set(requirements.filter((r) => outside.includes(r.id)).map((r) => r.author.handle))];
    const question = `The definition of ${t.task_ref} carries text from outside the repo${who.length ? ` (${who.join(', ')})` : ''}: ${outside.length ? `it adds ${outside.join(', ')}` : 'it asks to waive a requirement, which it can\'t'}. Lock it with what the outside text added?`;
    const raised = {
      // At its deadline it takes your settings' definition default, leave-out: what the outside text added stays out.
      kind: 'definition', question, recommended: 'keep', default: 'leave-out', fallback: 'you', provisional: false, owner: 'you',
      options: [{ id: 'keep', label: 'Lock it with the outside additions, marked with their author', decision: 'none' }, { id: 'leave-out', label: 'Lock it without them', decision: 'none' }],
      key: sha256Hex(canonicalize({ kind: 'definition.outside', task_ref: t.task_ref, digest })), pinned_to: await this.o.pin(t.cwd, question),
    };
    const ask = await this.o.asks().raise(this.o.connection(t.session, t.agent), 'definition.draft', raised);
    this.pending.set(ask, { session: t.session, agent: t.agent, definition, handed: digest, outside });
  }
  /** Your one answer about outside text: the definition locks, with the outside additions or without them. */
  answered(delivery: Delivery): void {
    const p = this.pending.get(delivery.ask);
    if (!p) return;
    this.pending.delete(delivery.ask);
    const definition = delivery.option === 'leave-out' ? { ...p.definition, requirements: p.definition.requirements.filter((r) => !p.outside.includes(r.id)) } : p.definition;
    void this.record(p.session, p.agent, definition, p.handed).catch(() => undefined);
  }
  private async record(session: string, agent: string, definition: Definition, handed: string): Promise<void> {
    const ts = this.o.now();
    await this.o.append(this.o.connection(session, agent), {
      v: 2, id: ulid(ts), kind: 'definition.locked', ts,
      data: { definition: handed, ...definition, hash: this.hashOf(definition) } as unknown as JsonValue,
    });
  }

  /** The definition's hash: every field it holds, each check's approved bytes by digest among them. */
  private hashOf(d: Definition): string {
    const requirements = this.o.plant === 'hash-ids-only' ? d.requirements.map((r) => r.id)
      : this.o.plant === 'hash-check-paths' ? d.requirements.map(({ check_sha256: _bytes, ...r }) => r) : d.requirements;
    return sha256Hex(canonicalize({ ...d, requirements } as unknown as JsonValue));
  }
  /** A check file's bytes in the session's folder, kept by digest; null for one that isn't there. */
  private async approve(cwd: string, check: string): Promise<string | null> {
    const bytes = await this.bytesOf(cwd, check);
    return bytes ? this.o.keep(bytes, check) : null;
  }
  private async bytesOf(cwd: string, check: string): Promise<Uint8Array | undefined> {
    const path = normalize(check);
    if (isAbsolute(path) || path.startsWith('..')) return undefined;
    return readFile(join(cwd, path)).then((b) => new Uint8Array(b), () => undefined);
  }

  /** The open tasks of a session's thread with their locked definitions, as the store holds them. */
  private async lockedIn(session: string, thread?: string): Promise<Obj[]> {
    const of = thread === undefined ? `(SELECT json_extract(data, '$.thread') FROM events WHERE session_id = '${sql(session)}' AND kind = 'session.start' ORDER BY log_pos DESC LIMIT 1)` : `'${sql(thread)}'`;
    return this.o.raw(`SELECT d.task_ref, d.requirements, d.deliverables, d.issue_rev, d.base_commit, d.budget, d.hash FROM definitions d JOIN tasks t ON t.task_ref = d.task_ref
      WHERE d.state = 'locked' AND t.state != 'closed' AND t.thread = ${of} ORDER BY t.created`) as Promise<Obj[]>;
  }
  /**
   * A stop the stop rule reads as a claim: a claim for each open task of the session's thread with a locked
   * definition, carrying the hash recomputed from the stored definition and the checks' bytes now. A check whose
   * bytes differ from the approved ones is a proposal naming its file; the claim's checks run the approved bytes,
   * read from the evidence store by digest, never the file in the folder the agent works in.
   */
  async claim(session: string, agent: string, cwd: string): Promise<void> {
    const head = await headOf(cwd).catch(() => undefined);
    for (const row of await this.lockedIn(session)) {
      const task_ref = String(row.task_ref);
      const stored = JSON.parse(String(row.requirements)) as Requirement[];
      const requirements: Requirement[] = [];
      const changed: { check: string; approved: string | null; now: string | null }[] = [];
      for (const r of stored) {
        const bytes = r.check ? await this.bytesOf(cwd, r.check) : undefined;
        const now = bytes ? sha256Hex(bytes) : null;
        if (r.check && now !== r.check_sha256) changed.push({ check: r.check, approved: r.check_sha256, now });
        requirements.push({ ...r, check_sha256: now });
      }
      const definition: Definition = {
        task_ref, requirements, deliverables: JSON.parse(String(row.deliverables ?? '[]')) as string[], issue_rev: String(row.issue_rev),
        base_commit: String(row.base_commit), budget: JSON.parse(String(row.budget ?? 'null')) as JsonValue,
      };
      const [{ n } = { n: 0 }] = await this.o.raw(`SELECT COUNT(*) AS n FROM events WHERE kind = 'claim.made' AND json_extract(data, '$.task_ref') = '${sql(task_ref)}'`) as { n: number }[];
      const ts = this.o.now();
      const id = ulid(ts);
      const connection = this.o.connection(session, agent);
      const commit = head?.sha ?? definition.base_commit;
      const hash = this.hashOf(definition);
      await this.o.append(connection, {
        v: 3, id, kind: 'claim.made', ts,
        data: { task_ref, attempt: Number(n) + 1, commit, scope: 'session', predictions: [], hash },
      });
      // The core's floor (#29): a recomputed hash that differs from the locked one makes the claim INVALID, naming what
      // changed, whatever done gate is installed and in safe mode.
      if (hash !== String(row.hash)) {
        const what = changed.length ? changed.map((c) => c.check) : ['the definition'];
        await this.o.invalid(`claim:${id}`, commit, `the definition's hash differs from the one locked for ${task_ref}; changed: ${what.join(', ')}`);
      }
      for (const c of changed) {
        const diff = `${c.check}: approved sha256 ${c.approved ?? 'none'}, now ${c.now ?? 'deleted'}`;
        const known = await this.o.raw(`SELECT 1 FROM events WHERE kind = 'learn.proposed' AND json_extract(data, '$.diff') = '${sql(diff)}' LIMIT 1`);
        if (known.length) continue;
        const at = this.o.now();
        await this.o.append(connection, {
          v: 1, id: ulid(at), kind: 'learn.proposed', ts: at,
          data: { layer: 'learned', target: c.check, diff, evidence: [{ at: `claim:${id}`, quote: `${c.check} changed after ${task_ref}'s definition locked; its checks run the approved bytes` }], scope: `session:${letters(session)}`, replay: null, applied_by: null, supersedes: null },
        });
      }
      // Its checks start last, so a slow start holds up neither the claim nor its proposals.
      for (const r of stored) if (r.check && r.check_sha256) await this.o.run({ claim: `claim:${id}`, check: r.check, approved: r.check_sha256, commit, cwd });
    }
  }

  /** What SessionStart sends again after a compaction or a resume: the open asks' requirement IDs, in one short block. */
  async brief(session: string, thread: string | undefined): Promise<string | undefined> {
    const rows = await this.lockedIn(session, thread).catch(() => []);
    if (!rows.length) return undefined;
    const lines = rows.map((r) => `- ${String(r.task_ref)}: ${(JSON.parse(String(r.requirements)) as { id: string }[]).map((q) => q.id).join(', ')}`);
    return `DeepBuild: the open asks in this thread and their requirements (deep_status shows each one):\n${lines.join('\n')}`;
  }
}
