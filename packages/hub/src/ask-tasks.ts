// Ask-tasks in the kernel (#303; design: What done means, fixed at the start, and The contract (kernel)), and the done
// gate's core reads (#322): each task's acceptance criteria through its work source's `work.item@2` readings, and
// claims on tasks whose definition hasn't locked.
//
// - A prompt you typed that asks for new or changed behavior opens a task under the session's thread, keyed by the
//   issue it names or by its message handle (`session:<id>#<msg>`). One nobody typed, one that only asks a question,
//   and a rename open none. The rule reads the words' form, with no model: a question asks, a rename renames, and
//   anything else you typed asks for a change, so an unplaced form opens a task rather than going unjudged.
// - The kernel locks the definition it is handed and never drafts one: here a test's fixture
//   (DEEP_HUB_TEST_DRAFTS), or the drafting job's output. With none handed, a task opened from a work item takes its
//   definition from the item's reading: one requirement per acceptance criterion, in the reading's order, quoting it
//   in full and authored by the item's author (#322), each criterion linted for its observable, its threshold with its
//   unit, the wrong case that must fail it and its proof depth; in this repo, a criterion's check is the test tagged
//   with its ID. A task with no item and none handed waits. The lock records the hash, the issue's revision and the
//   base commit; each requirement keeps the author of the text it came from, with the role the work source's
//   `work.item@2` reading gives them (DEEP_HUB_TEST_WORK is the test source; the GitHub source reads the API, or the
//   recorded answers DEEP_HUB_TEST_GITHUB names), and each check's bytes, and each expected output it references, are
//   kept by digest in the evidence store. A drafted check lives under `.deepbuild/`, behind its guard: a draft that
//   names one elsewhere doesn't lock, and the record says why.
// - Text from anyone but you or a repo collaborator, an automated account's included, adds requirements and never
//   removes or waives one, and a definition that carries such text locks only after one ask about it.
// - While the account's plan window is at your reserve, the drafting job waits, so the definition does; a claim
//   meanwhile is judged on the repo's spec, and once the window resets the lock lands and the claim is judged against it.
// - At each claim the hash is recomputed from the stored definition and the checks' bytes on disk; a check changed
//   since the lock is a proposal naming its file, never a new definition. A proposal for a changed file lists the
//   verdicts it would make stale (#323): each standing verdict in the repo whose definition's checks read that file.
// - A requirement may name the stable targets its check is about (#323), `<file>#<symbol>`: each is resolved in the
//   folder the claim's snapshot is taken from before its checks run, and one that no longer resolves makes the claim
//   INVALID, naming it, whatever its checks show.
// - A requirement may declare the surface its check enters through (#874), carried to the gate runner's base run for
//   a stand-in on a base with nothing to start; the stand-in's hash is recorded in its `stand_in`, which the hash
//   leaves out. A surface with no fixed form goes to the early question before the definition locks.
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, normalize, sep } from 'node:path';
import type { Asks, Delivery } from '@deepbuild/asks';
import type { PaidKind } from '@deepbuild/gate';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { RecordError, ulid, type Connection, type EventInput } from '@deepbuild/record';
import { solveLine } from '@deepbuild/gate';
import type { ClaimCheck, DefinitionState, StatePin, Surface } from './gate-runner.js';
import { ISSUE_LINK, liveFetch, readIssue, recordedFetch, type Reading } from './github-source.js';
import { headOf } from './session-facts.js';
import type { WorkspaceService, WorkspacesProvider } from './workspaces-port.js';
import { derivedId, type Plant } from './wire.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
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
function asksForChange(text: string): boolean {
  const clauses = text.trim().split(/[;\n]+|\.\s+|,?\s+\b(?:and then|and|then|also)\b\s+/i).map((c) => c.trim().replace(LEAD, '')).filter(Boolean);
  if (!clauses.length) return false;
  // A rename changes no behavior; it is judged by the repo's spec alone, unless another clause asks for a change.
  if (/^rename\b/i.test(clauses[0]!)) return clauses.slice(1).some((c) => CHANGE.test(c));
  if (clauses.some((c) => CHANGE.test(c))) return true;
  return !(text.trim().endsWith('?') || ASKS.test(clauses[0]!));
}

// ---- The criteria lint (#322; design: Solved or not). Each part is read from the criterion's words, with no model.

/** What a criterion names that can be observed: an outcome verb, or a measured thing. */
const OBSERVABLE = /\b(?:finish(?:es)?|complet(?:es|ed)|return(?:s|ed)?|reject(?:s|ed)?|accept(?:s|ed)?|respond(?:s|ed)?|answer(?:s|ed)?|show(?:s|n)?|display(?:s|ed)?|render(?:s|ed)?|log(?:s|ged)?|emit(?:s|ted)?|writ(?:es|ten)|read(?:s)?|contain(?:s|ed)?|equal(?:s)?|match(?:es|ed)?|fail(?:s|ed)?|pass(?:es|ed)?|exit(?:s|ed)?|refus(?:es|ed)|den(?:ies|ied)|allow(?:s|ed)?|send(?:s)?|sent|receiv(?:es|ed)|open(?:s|ed)?|clos(?:es|ed)|start(?:s|ed)?|stop(?:s|ped)?|record(?:s|ed)?|mark(?:s|ed)?|flag(?:s|ged)?|nam(?:es|ed)|list(?:s|ed)?|count(?:s|ed)?|lock(?:s|ed)?|wait(?:s|ed)?|run(?:s)?|ran|hold(?:s)?|held|keep(?:s)?|kept|stay(?:s|ed)?|block(?:s|ed)?|timer|status|count|response|output|header|field|line|row|byte|request|message|event|verdict|reading|error|exit code|page|screen|element|button|file|record|table)\b/i;
/** A threshold's number, with the comparator or count word before it. */
const THRESHOLD = /\b(?:under|below|within|at most|less than|no more than|fewer than|over|above|at least|more than|exactly|equal to|up to|per|after|before|every|once|twice)\s+(?:\d[\d,.]*|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b|\b[<>≤≥=]\s*\d[\d,.]*|\b(?:\d[\d,.]*|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?=(?:%|percent|ms|milliseconds?|s\b|sec|seconds?|minutes?|min\b|hours?|h\b|days?|weeks?|px|pixels?|kb|mb|gb|bytes?|rows?|requests?|times?|attempts?|items?|users?|runs?|calls?|retries|lines?|files?|tests?|pages?|elements?|frames?|fps|hz|x\b|×))|\b(?:status|code|exit code|http)\s*\d{3}\b|\bwith\s+\d{3}\b/gi;
/** A unit right after a threshold's number: a unit of time, size, share or count, or a status code's name. */
const UNIT_AFTER = /^(?:\d[\d,.]*|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:%|percent|ms|milliseconds?|s\b|sec|seconds?|minutes?|min\b|hours?|h\b|days?|weeks?|px|pixels?|kb|mb|gb|bytes?|rows?|requests?|times?|attempts?|items?|users?|runs?|calls?|retries|lines?|files?|tests?|pages?|elements?|frames?|fps|hz|x\b|×)/i;
/** Whether a criterion states a threshold, and whether each threshold it states carries its unit. */
function thresholds(text: string): { threshold: boolean; unit: boolean } {
  const found = [...text.matchAll(THRESHOLD)];
  if (!found.length) return { threshold: false, unit: false };
  const unit = found.every((m) => {
    const span = m[0];
    // A status code names its unit by its word; a comparator's number by the unit after it.
    if (/^(?:status|code|exit code|http|with)\b/i.test(span)) return true;
    const rest = text.slice(m.index! + span.search(/\d|zero|one|two|three|four|five|six|seven|eight|nine|ten/i));
    return UNIT_AFTER.test(rest);
  });
  return { threshold: true, unit };
}
/** The wrong case that must fail it: a negative, a failure or the other way round. */
const WRONG_CASE = /\b(?:fails?(?:\s+it)?|must fail|is refused|is rejected|is denied|is blocked|does not|doesn't|do not|don't|never|no longer|not\s+\w+|otherwise|instead|rather than|wrong|invalid|missing|expired|malformed|longer than|slower than|more than|past|beyond|without|unless|except|else)\b/i;
/** The proof depth: a unit test, an integration test, a journey (end to end, a browser, a simulator), or a live run. */
const DEPTH = /\b(?:unit(?:\s+test)?s?|integration(?:\s+test)?s?|end[- ]to[- ]end|e2e|journey|browser|playwright|cypress|simulator|emulator|live(?:\s+run)?|in production|against the (?:app|stack|server)|proven by|through the (?:api|cli|ui|command|route|page))\b/i;
/** The parts a criterion lacks, each as the flag names it: its observable, its threshold with its unit, the wrong case, its depth. */
function lintCriterion(text: string, plant?: Plant | undefined): { observable: boolean; threshold: boolean; unit: boolean; wrong_case: boolean; depth: boolean } {
  const t = thresholds(text);
  // The planted wrong program only looks for a number: any number passes as a threshold with its unit.
  const threshold = plant === 'lint-number-only' ? /\d/.test(text) : t.threshold;
  const unit = plant === 'lint-number-only' ? /\d/.test(text) : t.unit;
  return { observable: OBSERVABLE.test(text), threshold, unit, wrong_case: WRONG_CASE.test(text), depth: DEPTH.test(text) };
}
/** What the flag says a criterion lacks, in words; empty when it lacks nothing. */
function lacking(text: string, plant?: Plant | undefined): string[] {
  const l = lintCriterion(text, plant);
  return [
    ...(l.observable ? [] : ['its observable']),
    ...(l.threshold ? (l.unit ? [] : ['the unit of its threshold']) : ['its threshold with its unit']),
    ...(l.wrong_case ? [] : ['the wrong case that must fail it']),
    ...(l.depth ? [] : ['its proof depth']),
  ];
}
/** The depth a criterion names, as the verdict engine knows depths; unit when it names none. */
function depthOf(text: string): string {
  if (/\b(?:live(?:\s+run)?|in production)\b/i.test(text)) return 'live';
  if (/\b(?:end[- ]to[- ]end|e2e|journey|browser|playwright|cypress|simulator|emulator)\b/i.test(text)) return 'journey';
  if (/\bintegration\b/i.test(text)) return 'integration';
  return 'unit';
}
/** A criterion's ID as scripts/proof-change.mjs computes it: #<issue>.<first 8 hex of the SHA-256 of its text, trimmed, white space collapsed>. */
const criterionId = (issue: number, text: string): string => `#${issue}.${sha256Hex(new TextEncoder().encode(text.trim().replace(/\s+/g, ' '))).slice(0, 8)}`;
/** The issue number a work item's source ID ends with (`owner/repo#12`, `item-12`), or undefined. */
const issueNumber = (source_id: string): number | undefined => { const m = /(\d+)$/.exec(source_id); return m ? Number(m[1]) : undefined; };

// ---- Definitions handed to the kernel, and the work source's readings.

interface Requirement { expected_ms?: number; deadline_ms?: number; runs?: number; held_out?: HeldOut[]; id: string; text: string; source_line: string; refuted_by: string; check: string | null; check_sha256: string | null; on_base: string; asserts: string[]; depth: string; oracle: string; near_misses: string[]; author: Author; surface: Surface | null; stand_in?: { surface: Surface; hash: string }; references?: { path: string; sha256: string }[]; command?: string; criterion?: string; targets?: string[]; paid?: PaidKind; timing?: boolean }
interface Author { handle: string; role: string; automated?: boolean }
/** A held-out variant of a check (#1018): the files written over the claim's checkout for a run of its own, kept by digest. */
interface HeldOut { files: Record<string, string> }
interface Handed { ask?: string; issue?: string; requirements: Obj[]; deliverables?: string[]; budget?: JsonValue; waives?: { id: string; source_line: string }[]; kind?: unknown; plan?: unknown }
/**
 * A task's plan (#324), handed with its definition: whether it marks the issue as large, and its scope section, the
 * files and parts it will touch and the dependencies and top-level folders it names. A part is a part of the code by
 * name, or a document's item by its stable ID.
 */
export interface Plan { large: boolean; scope: { files: string[]; parts: string[]; dependencies: string[]; folders: string[] } }
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);
function planOf(v: unknown): Plan | null {
  if (!isObj(v) || !isObj(v.scope)) return null;
  return { large: v.large === true, scope: { files: strings(v.scope.files), parts: strings(v.scope.parts), dependencies: strings(v.scope.dependencies), folders: strings(v.scope.folders) } };
}
/** A work source's work.item@2 reading: the test source's and the GitHub source's carry their body as text; an item carries the readings it came with (its comments among them). */
export interface WorkItem { source_id: string; link: string; title: string; body: string; criteria?: string[]; authors: Author[]; updated: string; readings?: WorkItem[] }
/** A definition as locked, without its hash: what the hash covers. */
interface Definition { task_ref: string; requirements: Requirement[]; deliverables: string[]; issue_rev: string; base_commit: string; budget: JsonValue }
/** The requirements your one answer can leave out: those outside text added, and those whose surface has no fixed form. */
interface Pending { session: string; agent: string; cwd: string; definition: Definition; handed: string; held: string[]; at: number }
/** What a task's lock needs: the prompt that opened it and the item it came from. */
interface Opening { session: string; agent: string; cwd: string; task_ref: string; text: string; at: number; item?: WorkItem }
/** A claim made on a task before its definition locked (#322): judged against the definition once the lock lands. */
interface Early { claim: string; session: string; agent: string; cwd: string }

/** The roles whose text can remove or waive a requirement; an automated account's never does, whatever its membership. */
const TRUSTED = new Set(['you', 'owner', 'collaborator']);
const trusted = (a: Author): boolean => TRUSTED.has(a.role) && a.automated !== true;
/** The kinds of spend a check can cost (#325). */
const PAID = new Set<string>(['live call', 'hosted browser run', 'model job']);
/** Where each definition's drafted checks are kept, behind the `.deepbuild/` guard. */
const DRAFTED = '.deepbuild/';
/** A declared surface: #31's shape, without the check, which is the requirement's own; only the fields the lock records. */
function surfaceOf(v: unknown): Surface | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v) || typeof (v as Obj).kind !== 'string' || !(v as Obj).kind) return null;
  const s = v as Obj;
  const words = (k: string) => (Array.isArray(s[k]) && (s[k] as unknown[]).every((x) => typeof x === 'string' && x) ? { [k]: s[k] } : {});
  const word = (k: string) => (typeof s[k] === 'string' && s[k] ? { [k]: s[k] } : {});
  return { kind: String(s.kind), ...words('routes'), ...word('format'), ...word('name'), ...word('path'), ...words('exports') };
}
/** Whether `deep` has a fixed form to stand in for a surface: a JSON service, a page, a command, a module's exports. */
function hasForm(s: Surface): boolean {
  if (s.kind === 'service') return (s.format ?? 'json') === 'json';
  if (s.kind === 'command') return typeof s.name === 'string';
  if (s.kind === 'module') return typeof s.path === 'string' && Array.isArray(s.exports);
  return s.kind === 'page';
}

interface AskTaskOptions {
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  asks: () => Asks;
  now: () => number;
  plant: Plant | undefined;
  /** The definitions handed to the kernel, from DEEP_HUB_TEST_DRAFTS; only tests set it. */
  drafts: string | undefined;
  /** The test work source's work.item readings, from DEEP_HUB_TEST_WORK; only tests set it. */
  work: string | undefined;
  /** The GitHub API's recorded answers, from DEEP_HUB_TEST_GITHUB; only tests set it. Without it the GitHub source reads the API at `forge`. */
  github?: string | undefined;
  forge?: string;
  /** Your `gh` login's token for the GitHub source, if any. */
  token?(): Promise<string | undefined>;
  append(connection: Connection, input: EventInput): Promise<void>;
  /** The core's connection for a session's events. */
  connection(session: string, agent: string): Connection;
  /** A reading of the session's, in words: why a definition waits or didn't lock, and what the lint flagged. */
  reading?(session: string, agent: string, text: string): Promise<void>;
  /** Why the plan window of the account the session's agent runs on keeps a drafting job waiting at your reserve, or undefined. */
  atReserve?(agent: string): string | undefined;
  pin(cwd: string, question: string): Promise<Obj>;
  /** Keeps bytes in the evidence store, answering their SHA-256. */
  keep(bytes: Uint8Array, source: string): Promise<string>;
  /** A definition just locked: its paid checks are priced and the issue's budget asked for once (#325), and its plan sized before any code (#324). */
  locked?(d: { session: string; agent: string; cwd: string; task_ref: string; requirements: { id: string; check: string | null; paid?: PaidKind }[] }): Promise<void>;
  /**
   * Hands a claim's checks to the gate runner (#29), from the bytes the store keeps under each one's approved digest:
   * it takes the claim's snapshot and checkout, and starts the fast lane's checks, the repo's spec checks beside them.
   * `definition` says whether the task's definition is locked; `joins` that the claim's checks already started once,
   * before its definition locked, and these join them.
   */
  run(r: { claim: string; session: string; task: string; commit: string; base: string; cwd: string; deliverables: string[]; requirements: { req: string; id: string; text: string; depth: string; oracle: string; on_base: 'fails' | 'passes'; check: string | null }[]; checks: (Pick<ClaimCheck, 'check' | 'approved' | 'on_base' | 'asserts' | 'req' | 'surface' | 'expected_ms' | 'deadline_ms' | 'references' | 'runs' | 'held_out' | 'timing'> & { command?: string; paid?: PaidKind })[]; definition: DefinitionState; joins?: boolean; state?: StatePin }): Promise<void>;
  /** Records the core's INVALID verdict on a claim, naming why: the floor, before any check counts. */
  invalid(claim: string, commit: string, reason: string): Promise<void>;
  /** The targets of a claim's requirements that didn't resolve before its runs (#323): each verdict made on it is INVALID, naming them. */
  unresolved(claim: string, targets: { req: string; reason: string }[]): void;
  /** Where work outside a repo lives (#67). */
  spaces: Pick<WorkspaceService, 'land' | 'fill' | 'pin' | 'keep' | 'claimState' | 'folderOf'>;
  renamedSince: WorkspacesProvider['renamedSince'];
}

export class AskTasks {
  /** Definitions that wait for your one answer, by the ask's handle. */
  private readonly pending = new Map<string, Pending>();
  /** Tasks whose drafting waits at your reserve, by task: locked again once the window changes. */
  private readonly waiting = new Map<string, { opening: Opening; why: string }>();
  /** Claims made before their task's definition locked, by task: the newest, judged against the definition at its lock. */
  private readonly early = new Map<string, Early>();
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
    // Your words sent from the app count as typed by you (#340).
    if (p.from !== 'person' && p.from !== 'app') return [];
    const planted = (p.first && this.o.plant === 'first-prompt-always-task') || (p.queued && this.o.plant === 'midturn-always-task');
    return planted || asksForChange(p.text) ? [`session:${letters(p.session)}#${String(p.msg)}`] : [];
  }
  /**
   * A work item whose link the prompt names, with the readings its source gave for it: the test source's, or the
   * GitHub source's read of the issue, its comments and the repo's membership, which is each session's own.
   */
  async itemOf(text: string): Promise<WorkItem | undefined> {
    if (!/https?:\/\//.test(text)) return undefined;
    const readings = await this.json<WorkItem>(this.o.work, 'readings');
    const item = readings.find((r) => !r.link.includes('#') && new RegExp(`(?:^|\\s)${r.link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[\\s/#?.,])`).test(text));
    if (item) return { ...item, readings };
    const link = ISSUE_LINK.exec(text);
    if (!link) return undefined;
    const fetch = this.o.github ? recordedFetch(this.o.github) : liveFetch(this.o.forge ?? 'https://api.github.com', await this.o.token?.());
    const read: Reading[] | undefined = await readIssue(fetch, link[1]!, link[2]!, Number(link[3]), this.o.plant).catch(() => undefined);
    if (!read?.length) return undefined;
    return { ...read[0]!, readings: read };
  }

  /** A work item by its ID among the test work source's readings (#66), with every reading on it; only tests set DEEP_HUB_TEST_WORK. */
  async workItem(id: string): Promise<WorkItem | undefined> {
    const readings = await this.json<WorkItem>(this.o.work, 'readings');
    const item = readings.find((r) => r.source_id === id);
    return item ? { ...item, readings } : undefined;
  }

  /** Each session's definitions still being locked. */
  private readonly locking = new Map<string, Promise<void>>();
  /** The task a prompt opened: task.created under the thread, then its handed definition locked, off the hook's path. */
  async opened(t: { session: string; agent: string; cwd: string; thread: string; task_ref: string; text: string; prompt: string; at: number; item?: WorkItem }): Promise<void> {
    // A work item's task is opened once, whichever prompt names it again.
    if (t.item && (await this.o.raw(`SELECT 1 FROM tasks WHERE task_ref = ? LIMIT 1`, [t.task_ref])).length) return;
    const connection = this.o.connection(t.session, t.agent);
    // The task's ID follows from its prompt's event, and its lock's from the task's: the same hook replayed appends
    // the same events, which the record holds once.
    await this.o.append(connection, { v: 1, id: derivedId(t.at, `${t.prompt}:task`), kind: 'task.created', ts: t.at, data: { task_ref: t.task_ref, thread: t.thread, owner: connection.actor, title: (t.item?.title ?? t.text).slice(0, 200) || '-' } });
    // Off the hook's path, but a stop that follows at once claims against the definition, never ahead of it.
    // A task from outside any repo lands in a workspace first (#67), with git to run, so off the hook's path too.
    const locked = this.o.spaces.land(t).then((folder) => this.lock(folder ? { ...t, cwd: folder } : t)).catch((error: unknown) => this.unlocked(t.task_ref, error));
    const all = Promise.all([this.locking.get(t.session), locked]).then(() => { if (this.locking.get(t.session) === all) this.locking.delete(t.session); });
    this.locking.set(t.session, all);
  }
  private reading(session: string, agent: string, text: string): Promise<void> {
    return this.o.reading?.(session, agent, text) ?? Promise.resolve();
  }
  private unlocked(task_ref: string, error: unknown): void {
    process.stderr.write(`deep hub: the definition of ${task_ref} was not locked: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  /** The plan window changed: each definition whose drafting waited at your reserve is locked once the window clears, and waits on, told once, while it doesn't. */
  windowChanged(): void {
    for (const [task_ref, w] of [...this.waiting]) {
      const why = this.o.atReserve?.(w.opening.agent);
      if (why) { w.why = why; continue; }
      this.waiting.delete(task_ref);
      void this.lock(w.opening).catch((error: unknown) => this.unlocked(task_ref, error));
    }
  }
  /** Why a task's definition waits for its drafting job at your reserve, or undefined. */
  waitingWhy(task_ref: string): string | undefined {
    return this.waiting.get(task_ref)?.why;
  }

  /**
   * The definition a work item's reading gives when none is handed (#322): one requirement per acceptance criterion,
   * quoting it in full, authored by the item's author; in this repo, its check is the test tagged with its ID. Each
   * criterion is linted, and the flag recorded as a reading of the session's naming what it lacks.
   */
  private async fromCriteria(t: Opening & { item: WorkItem }): Promise<Handed | undefined> {
    const item = t.item;
    // The planted wrong program reads criteria from the GitHub API alone: a test source's item gets none.
    const github = /^https?:\/\/github\.com\//.test(item.link);
    const criteria = this.o.plant === 'criteria-from-github-api' && !github ? [] : item.criteria ?? [];
    if (!criteria.length) return undefined;
    const lines = item.body.split('\n');
    const issue = issueNumber(item.source_id);
    const tagged = issue === undefined ? new Map<string, string>() : await this.taggedTests(t.cwd, issue);
    const requirements: Obj[] = [];
    for (const [i, text] of criteria.entries()) {
      const line = lines.findIndex((l) => l.includes(text));
      const id = issue === undefined ? undefined : criterionId(issue, text);
      const test = id === undefined ? undefined : tagged.get(id);
      const lacks = lacking(text, this.o.plant);
      if (lacks.length) await this.reading(t.session, t.agent, `DeepBuild flagged the criterion "${text}" of ${item.source_id}: it lacks ${lacks.join(', ')}.`);
      requirements.push({
        id: `R${i + 1}`, text, source_line: `${item.source_id}#L${line >= 0 ? line + 1 : i + 1}`, refuted_by: `an observation on which "${text}" does not hold`,
        check: test ?? null, on_base: 'fails', asserts: [], depth: depthOf(text), oracle: 'code', near_misses: [],
        ...(id ? { criterion: id } : {}), ...(test && issue !== undefined ? { command: `npx vitest run --root tests/acceptance/${issue} ${basename(test)} -t '${id}'` } : {}),
      });
    }
    return { issue: item.source_id, requirements, deliverables: [], budget: null };
  }
  /** In this repo, the tests tagged with each criterion ID of an issue: tests/acceptance/<issue>/*.test.ts carrying the tag, by ID. */
  private async taggedTests(cwd: string, issue: number): Promise<Map<string, string>> {
    const folder = `tests/acceptance/${issue}`;
    const out = new Map<string, string>();
    let files: string[];
    try { files = (await readdir(join(cwd, folder))).filter((f) => f.endsWith('.test.ts')).sort(); } catch { return out; }
    // A suite may keep its tags as named constants in a helper beside its tests (`export const AC1 = 'AC1 #n.<hash>'`):
    // a test file that names the constant carries its tag (#33).
    const tag = new RegExp(`#${issue}\\.[0-9a-f]{8}`, 'g');
    const named = new Map<string, string[]>();
    for (const helper of (await readdir(join(cwd, folder)).catch(() => [] as string[])).filter((f) => /\.[cm]?ts$/.test(f) && !f.endsWith('.test.ts'))) {
      const text = await readFile(join(cwd, folder, helper), 'utf8').catch(() => '');
      for (const [, name, , value] of text.matchAll(/export const (\w+) = (['"`])(.*?)\2/g)) { const tags = value!.match(tag); if (tags) named.set(name!, tags); }
    }
    for (const file of files) {
      const text = await readFile(join(cwd, folder, file), 'utf8').catch(() => '');
      const tags = [...[...text.matchAll(tag)].map(([t]) => t), ...[...named].flatMap(([name, t]) => (new RegExp(`\\b${name}\\b`).test(text) ? t : []))];
      for (const t of tags) if (!out.has(t)) out.set(t, `${folder}/${file}`);
    }
    return out;
  }

  /** Locks the definition handed for a task, or asks you first when outside text is in it; with none handed it waits. */
  private async lock(t: Opening): Promise<void> {
    let handed = (await this.json<Handed>(this.o.drafts, 'drafts')).find((d) => (t.item ? d.issue === t.item.source_id : d.ask === t.text));
    const drafted = handed !== undefined;
    if (!handed && t.item) handed = await this.fromCriteria({ ...t, item: t.item });
    if (!handed) return;
    // While the account's window is at your reserve the drafting job waits, and so does the lock (design: Timing and cost).
    const why = this.o.atReserve?.(t.agent);
    if (why) {
      if (!this.waiting.has(t.task_ref)) await this.reading(t.session, t.agent, `The definition of ${t.task_ref} waits for its drafting job, held at your reserve (${why}); the repo's spec checks judge its claims meanwhile.`);
      this.waiting.set(t.task_ref, { opening: t, why });
      return;
    }
    await this.o.spaces.fill(t.cwd, handed as unknown as Obj);
    const head = await headOf(t.cwd).catch(() => undefined);
    if (!head) return;
    // A drafted check is kept under .deepbuild/, behind its guard: a draft naming one elsewhere doesn't lock, and the record says why.
    const outsideCheck = drafted ? handed.requirements.find((r) => typeof r.check === 'string' && r.check && !normalize(String(r.check)).startsWith(DRAFTED)) : undefined;
    if (outsideCheck) {
      const reason = `its drafted check ${String(outsideCheck.check)} is not under ${DRAFTED}, where each definition's drafted checks are kept behind the ${DRAFTED} guard`;
      await this.reading(t.session, t.agent, `The definition of ${t.task_ref} was not locked: ${reason}.`);
      throw Error(reason);
    }
    const readings = t.item ? t.item.readings ?? await this.json<WorkItem>(this.o.work, 'readings') : [];
    const authorOf = (line: string): Author => {
      const source = line.replace(/#L\d+$/, '');
      if (source === 'ask') return { handle: 'you', role: 'you' };
      const reading = readings.find((r) => r.source_id === source);
      const first = reading?.authors[0];
      if (!reading || !first) return { handle: 'unknown', role: 'outside' };
      // The planted wrong program believes what the text says of its author.
      if (this.o.plant === 'role-from-text' && /\brepo owner\b/i.test(reading.body)) return { handle: first.handle, role: 'owner' };
      return first.automated ? { handle: first.handle, role: first.role, automated: true } : { handle: first.handle, role: first.role };
    };
    const requirements: Requirement[] = [];
    for (const r of handed.requirements) {
      const check = typeof r.check === 'string' && r.check ? r.check : null;
      const references: { path: string; sha256: string }[] = [];
      for (const path of Array.isArray(r.references) ? r.references.filter((p): p is string => typeof p === 'string' && p !== '') : []) references.push({ path, sha256: await this.approve(t.cwd, path) });
      const targets = Array.isArray(r.targets) ? r.targets.filter((p): p is string => typeof p === 'string' && p !== '') : [];
      requirements.push({
        id: String(r.id), text: String(r.text), source_line: String(r.source_line), refuted_by: String(r.refuted_by), check,
        check_sha256: check ? await this.approve(t.cwd, check) : null, on_base: String(r.on_base ?? 'fails'),
        asserts: (r.asserts as string[] | undefined) ?? [], depth: String(r.depth), oracle: String(r.oracle), near_misses: (r.near_misses as string[] | undefined) ?? [],
        author: authorOf(String(r.source_line)), surface: surfaceOf(r.surface),
        ...(typeof r.expected_ms === 'number' ? { expected_ms: r.expected_ms } : {}), ...(typeof r.deadline_ms === 'number' ? { deadline_ms: r.deadline_ms } : {}),
        ...(references.length ? { references } : {}), ...(typeof r.command === 'string' && r.command ? { command: r.command } : {}), ...(typeof r.criterion === 'string' && r.criterion ? { criterion: r.criterion } : {}),
        ...(targets.length ? { targets } : {}),
        // A timing check says so (#352), so a run of it that fails under load is rerun alone.
        ...(check && r.timing === true ? { timing: true } : {}),
        ...(typeof r.runs === 'number' ? { runs: r.runs } : {}), ...(Array.isArray(r.held_out) ? { held_out: await this.heldOut(r.held_out as Obj[], String(r.id)) } : {}),
        // A check that costs money says what it spends on (#325), so the lock prices it.
        ...(check && PAID.has(String(r.paid)) ? { paid: r.paid as PaidKind } : {}),
      });
    }
    // A waiver counts only from you or a repo collaborator; any other's leaves the requirement in, and makes the
    // definition wait for your one answer, as outside text that adds a requirement does.
    const outside = requirements.filter((r) => !trusted(r.author)).map((r) => r.id);
    let waived = false;
    for (const w of handed.waives ?? []) {
      if (trusted(authorOf(w.source_line))) {
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
    // Before the lock lands, so what changes after it is what a diff names (#67).
    await this.o.spaces.pin(t.task_ref, t.cwd, handed.requirements as readonly Obj[]);
    // The early question (#874): a check whose surface has no fixed form has nothing to stand in for it on a base with
    // nothing to start, so its definition waits for your one answer too, in the same ask.
    const formless = requirements.filter((r) => r.surface && !hasForm(r.surface));
    if (!outside.length && !waived && !formless.length) return this.record(t.session, t.agent, t.cwd, definition, digest, t.at);
    const who = [...new Set(requirements.filter((r) => outside.includes(r.id)).map((r) => r.author.handle))];
    const said = [
      ...(outside.length || waived ? [`carries text from outside the repo${who.length ? ` (${who.join(', ')})` : ''}: ${outside.length ? `it adds ${outside.join(', ')}` : 'it asks to waive a requirement, which it can\'t'}`] : []),
      ...formless.map((r) => `has ${r.id}'s check enter through a ${r.surface!.kind} surface, which has no fixed form to stand in for it where the base has nothing to start`),
    ];
    const question = `The definition of ${t.task_ref} ${said.join('; it ')}. ${outside.length ? 'Lock it with what the outside text added?' : 'Lock it as drafted?'}`;
    const raised = {
      // At its deadline it takes your settings' definition default, leave-out: what the outside text added stays out.
      // With no outside text the default locks it as drafted, so no requirement drops out unanswered.
      kind: 'definition', question, recommended: 'keep', default: outside.length || waived ? 'leave-out' : 'keep', fallback: 'you', provisional: false, owner: 'you',
      options: outside.length || waived
        ? [{ id: 'keep', label: 'Lock it with the outside additions, marked with their author', decision: 'none' }, { id: 'leave-out', label: 'Lock it without them', decision: 'none' }]
        : [{ id: 'keep', label: 'Lock it as drafted: its check runs on the base with no stand-in', decision: 'none' }, { id: 'leave-out', label: `Lock it without ${formless.map((r) => r.id).join(', ')}`, decision: 'none' }],
      key: sha256Hex(canonicalize({ kind: 'definition.outside', task_ref: t.task_ref, digest })), pinned_to: await this.o.pin(t.cwd, question),
    };
    const ask = await this.o.asks().raise(this.o.connection(t.session, t.agent), 'definition.draft', raised);
    this.pending.set(ask, { session: t.session, agent: t.agent, cwd: t.cwd, definition, handed: digest, held: [...new Set([...outside, ...formless.map((r) => r.id)])], at: t.at });
  }
  /** Your one answer about outside text or a formless surface: the definition locks, with the requirements it held or without them. */
  answered(delivery: Delivery): void {
    const p = this.pending.get(delivery.ask);
    if (!p) return;
    const definition = delivery.option === 'leave-out' ? { ...p.definition, requirements: p.definition.requirements.filter((r) => !p.held.includes(r.id)) } : p.definition;
    // An answer that leaves nothing to lock locks nothing, and the draft keeps waiting: the default undone, your next answer can still lock it.
    if (!definition.requirements.length) return this.unlocked(definition.task_ref, Error('leaving the outside text out leaves it no requirement; undo the default to lock it with that text'));
    this.pending.delete(delivery.ask);
    void this.record(p.session, p.agent, p.cwd, definition, p.handed, p.at).catch((error: unknown) => this.unlocked(definition.task_ref, error));
  }
  /** The task whose locked definition stands on a definition ask's answer, by the ask's key; undefined when none locked on it. */
  async lockedOn(ask: string): Promise<string | undefined> {
    const [row] = (await this.o.raw(`SELECT key FROM asks WHERE id = ? AND kind = 'definition'`, [ask.replace(/^ask:/, '')])) as { key: string }[];
    if (!row) return undefined;
    const locked = (await this.o.raw("SELECT task_ref, id FROM definitions WHERE state IN ('locked', 'revised')")) as { task_ref: string; id: string }[];
    return locked.find((d) => sha256Hex(canonicalize({ kind: 'definition.outside', task_ref: d.task_ref, digest: d.id })) === row.key)?.task_ref;
  }
  private async record(session: string, agent: string, cwd: string, definition: Definition, handed: string, at: number): Promise<void> {
    // A definition with nothing to meet locks nothing: a claim on it would pass with no check run.
    if (!definition.requirements.length) throw Error('it has no requirements left to lock');
    const ts = this.o.now();
    let fresh = true;
    try {
      await this.o.append(this.o.connection(session, agent), {
        v: 9, id: derivedId(at, `${definition.task_ref}:${handed}:lock`), kind: 'definition.locked', ts,
        data: { definition: handed, ...definition, hash: this.hashOf(definition) } as unknown as JsonValue,
      });
    } catch (error) {
      // The lock is in the log already under this ID (its ts differs, so a replayed hook or a second lock racing the first conflicts): the first lock stands.
      if (!(error instanceof RecordError && error.code === 'conflict')) throw error;
      fresh = false;
    }
    // What the definition shows of itself before any claim (#323): its one solve line, and each journey with no
    // negative case, whose check nothing shows can fail.
    const solve = solveLine(definition.requirements);
    const flags = definition.requirements.filter((r) => r.depth === 'journey' && !r.near_misses.length).map((r) => `${r.id} is a journey with no negative case: no near miss shows that its check can fail`);
    await this.o.append(this.o.connection(session, agent), {
      v: 1, id: derivedId(at, `${definition.task_ref}:${handed}:checked`), kind: 'definition.checked', ts, data: { task_ref: definition.task_ref, solved: solve.solved, solve: solve.line, flags },
    }).catch((error: unknown) => { if (!(error instanceof RecordError && error.code === 'conflict')) throw error; });
    // Its paid checks are priced now, and the issue's one budget asked for once (#325); its plan is sized (#324).
    if (fresh) await this.o.locked?.({ session, agent, cwd, task_ref: definition.task_ref, requirements: definition.requirements }).catch((error: unknown) => process.stderr.write(`deep hub: ${definition.task_ref}'s lock was not followed up: ${error instanceof Error ? error.message : String(error)}\n`));
    // A claim made before the lock is judged against the definition now (#322).
    const early = this.early.get(definition.task_ref);
    if (early) {
      this.early.delete(definition.task_ref);
      await this.judge(early.session, early.agent, early.cwd, definition.task_ref, early.claim).catch((error: unknown) => process.stderr.write(`deep hub: ${early.claim} was not judged against ${definition.task_ref}'s definition: ${error instanceof Error ? error.message : String(error)}\n`));
    }
  }

  /** A check's held-out variants as handed: each file's bytes kept by digest, so only the digests reach the definition. */
  private async heldOut(handed: Obj[], req: string): Promise<HeldOut[]> {
    const variants: HeldOut[] = [];
    for (const [i, v] of handed.entries()) {
      const files: Record<string, string> = {};
      for (const [path, bytes] of Object.entries((v.files ?? {}) as Record<string, string>)) files[path] = await this.o.keep(Buffer.from(String(bytes)), `${req} held-out variant ${i + 1}: ${path}`);
      variants.push({ files });
    }
    return variants;
  }
  /** The kind of issue and the plan a task's definition was handed with (#324), found again by the lock's digest of it. */
  async scopeOf(task_ref: string): Promise<{ kind: string | null; plan: Plan | null }> {
    const [row] = (await this.o.raw(`SELECT id FROM definitions WHERE task_ref = ? AND state IN ('locked', 'revised') LIMIT 1`, [task_ref])) as { id: string }[];
    const handed = row ? (await this.json<Handed>(this.o.drafts, 'drafts')).find((d) => sha256Hex(canonicalize(d as unknown as JsonValue)) === row.id) : undefined;
    return { kind: typeof handed?.kind === 'string' && handed.kind ? handed.kind : null, plan: planOf(handed?.plan) };
  }
  /** The definition's hash: every field it holds, each check's approved bytes by digest and each referenced output's among them. */
  private hashOf(d: Definition): string {
    const requirements = this.o.plant === 'hash-ids-only' ? d.requirements.map((r) => r.id)
      : this.o.plant === 'hash-check-paths' ? d.requirements.map(({ check_sha256: _bytes, references: _refs, ...r }) => r) : d.requirements;
    return sha256Hex(canonicalize({ ...d, requirements } as unknown as JsonValue));
  }
  /** A check file's bytes in the session's folder, kept by digest; a check the folder doesn't hold as a file refuses the lock. */
  private async approve(cwd: string, check: string): Promise<string> {
    const bytes = await this.bytesOf(cwd, check);
    if (!bytes) throw Error(`its check ${check} is not a file under the session's folder (a path or link out of it, a folder, nothing there, or the folder itself gone)`);
    return this.o.keep(bytes, check);
  }
  /**
   * The verdicts a change to a file would make stale (#323): each standing verdict on another claim in the same repo
   * whose definition's checks read the file, as their check or an expected output they reference.
   */
  private async staleIf(cwd: string, path: string, claim: string): Promise<string[]> {
    const rows = (await this.o.raw(`SELECT v.id, v.handle, d.requirements FROM verdicts v JOIN claims c ON c.id = v.claim_id JOIN sessions s ON s.id = c.session_id
      JOIN definitions d ON d.task_ref = c.subject_ref WHERE v.stale = 0 AND s.worktree = ? AND c.id != ? ORDER BY v.created`, [cwd, claim])) as { id: string; handle: string | null; requirements: string | null }[];
    const reads = (r: Requirement) => r.check === path || (r.references ?? []).some((ref) => ref.path === path);
    return [...new Set(rows.filter((row) => (JSON.parse(row.requirements ?? '[]') as Requirement[]).some(reads)).map((row) => row.handle ?? `verdict:${row.id}`))];
  }
  /**
   * Why a target, `<file>#<symbol>`, doesn't resolve in the folder, or null when it does: the file is there and
   * defines the symbol (a declaration of it, a property or assignment of it at a line's start, or a method of it).
   */
  private async unresolvedTarget(cwd: string, target: string): Promise<string | null> {
    const at = target.lastIndexOf('#');
    if (at <= 0 || at === target.length - 1) return `${target} doesn't resolve: it names no file and symbol (<file>#<symbol>)`;
    const file = target.slice(0, at);
    const symbol = target.slice(at + 1);
    const bytes = await this.bytesOf(cwd, file);
    if (!bytes) return `${target} doesn't resolve: ${file} is not in the claim's snapshot`;
    const s = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const defines = new RegExp(`\\b(?:function\\*?|class|const|let|var|def|fn|struct|enum|trait|type|interface)\\s+${s}\\b|^\\s*(?:export\\s+)?(?:static\\s+)?(?:async\\s+)?['"]?${s}['"]?\\s*(?::|=(?!=)|\\([^)]*\\)\\s*\\{)|\\bexports\\.${s}\\s*=(?!=)`, 'm');
    return defines.test(new TextDecoder().decode(bytes)) ? null : `${target} doesn't resolve: ${file} no longer defines ${symbol}`;
  }
  /** A task's folder: its workspace's, or the session's. A session outside the workspace has no git of its own there, so its work is kept first. */
  private async homeOf(task_ref: string, cwd: string): Promise<string> {
    const home = this.o.spaces.folderOf(task_ref);
    if (!home || home === cwd) return cwd;
    await this.o.spaces.keep(home, task_ref);
    return home;
  }
  /** The file a target's file was renamed to since the definition's base, when its symbol resolves there. */
  private async followed(cwd: string, base: string, target: string): Promise<string | undefined> {
    const [file, symbol] = target.split('#') as [string, string | undefined];
    const now = await this.o.renamedSince(cwd, base, file);
    return now && !(await this.unresolvedTarget(cwd, symbol ? `${now}#${symbol}` : now)) ? now : undefined;
  }
  /** One proposed diff of a definition for the renames a claim followed; the definition changes only on your approval. */
  private async proposeRenames(connection: Connection, session: string, task_ref: string, id: string, renames: Map<string, string>): Promise<void> {
    const pairs = [...renames].map(([from, to]) => `${from} → ${to}`).sort();
    const diff = `targets of ${task_ref}: ${pairs.join(', ')}`;
    if ((await this.o.raw(`SELECT 1 FROM events WHERE kind = 'learn.proposed' AND json_extract(data, '$.diff') = ? LIMIT 1`, [diff])).length) return;
    const at = this.o.now();
    await this.o.append(connection, {
      v: 1, id: ulid(at), kind: 'learn.proposed', ts: at,
      data: { layer: 'learned', target: task_ref, diff, scope: `session:${letters(session)}`, replay: null, applied_by: null, supersedes: null, evidence: [{ at: `claim:${id}`, quote: `the claim followed ${pairs.join(', ')}, by the file's history` }] },
    });
  }
  /** The bytes of a file the folder holds, by its real path: a link out of the folder, a folder and a missing file are undefined. */
  private async bytesOf(cwd: string, check: string): Promise<Uint8Array | undefined> {
    const path = normalize(check);
    if (isAbsolute(path)) return undefined;
    try {
      const [root, file] = await Promise.all([realpath(cwd), realpath(join(cwd, path))]);
      if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) return undefined;
      return new Uint8Array(await readFile(file));
    } catch {
      return undefined;
    }
  }

  /** The thread a session's start recorded, as SQL. */
  private threadSql(session: string, thread?: string): string {
    return thread === undefined ? `(SELECT json_extract(data, '$.thread') FROM events WHERE session_id = '${sql(session)}' AND kind = 'session.start' ORDER BY log_pos DESC LIMIT 1)` : `'${sql(thread)}'`;
  }
  /** The open tasks of a session's thread with their locked definitions, as the store holds them. */
  private async lockedIn(session: string, thread?: string): Promise<Obj[]> {
    return this.o.raw(`SELECT d.task_ref, d.requirements, d.deliverables, d.issue_rev, d.base_commit, d.budget, d.hash FROM definitions d JOIN tasks t ON t.task_ref = d.task_ref
      WHERE d.state = 'locked' AND t.state != 'closed' AND t.thread = ${this.threadSql(session, thread)} ORDER BY t.created`) as Promise<Obj[]>;
  }
  /** The open tasks of a session's thread whose definition hasn't locked (#322). */
  private async unlockedIn(session: string): Promise<string[]> {
    const rows = (await this.o.raw(`SELECT t.task_ref FROM tasks t WHERE t.state != 'closed' AND t.thread = ${this.threadSql(session)}
      AND NOT EXISTS (SELECT 1 FROM definitions d WHERE d.task_ref = t.task_ref AND d.state IN ('locked', 'revised')) ORDER BY t.created`)) as { task_ref: string }[];
    return rows.map((r) => String(r.task_ref));
  }
  /**
   * A stop the stop rule reads as a claim: a claim for each open task of the session's thread. One with a locked
   * definition carries the hash recomputed from the stored definition and the checks' bytes now; a check whose bytes
   * differ from the approved ones is a proposal naming its file, and the claim's checks run the approved bytes, read
   * from the evidence store by digest, never the file in the folder the agent works in. One whose definition hasn't
   * locked (#322) is judged on the repo's spec meanwhile and waits for the lock: the turn's own task only (`task`),
   * never another the thread opened. Answers the claims it made, in order; one task's failure is reported and the
   * others still claimed.
   */
  async claim(session: string, agent: string, cwd: string, o: { early?: boolean; task?: string } = {}): Promise<string[]> {
    await this.locking.get(session);
    const made: string[] = [];
    for (const row of await this.lockedIn(session)) {
      const task_ref = String(row.task_ref);
      if (o.task && task_ref !== o.task && await this.standsInWorkspace(task_ref)) continue;
      try {
        made.push(await this.judge(session, agent, cwd, task_ref));
      } catch (error) {
        process.stderr.write(`deep hub: ${task_ref} was not claimed: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    // A turn whose claim already stands (a deep_claim with no work since) claims no early task anew.
    for (const task_ref of o.early === false ? [] : (await this.unlockedIn(session)).filter((t) => t === o.task)) {
      try {
        made.push(await this.claimEarly(session, agent, cwd, task_ref));
      } catch (error) {
        process.stderr.write(`deep hub: ${task_ref} was not claimed: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    return made;
  }
  /**
   * Whether a workspace task's verdict stands (#67). Another task's stop doesn't claim it again: a workspace runs again
   * only the checks whose inputs changed, which a drift finds, and its passed verdict stands until then.
   */
  private async standsInWorkspace(task_ref: string): Promise<boolean> {
    if (!this.o.spaces.folderOf(task_ref)) return false;
    const [newest] = (await this.o.raw(`SELECT v.outcome AS outcome, v.stale AS stale FROM verdicts v JOIN claims c ON c.id = v.claim_id WHERE c.subject_ref = ? ORDER BY v.created DESC LIMIT 1`, [task_ref])) as { outcome: string; stale: number }[];
    return newest?.outcome === 'PASS' && !newest.stale;
  }
  /** A claim on a task whose definition hasn't locked: judged on the repo's spec, its definition pending, or held by the plan window. */
  private async claimEarly(session: string, agent: string, from: string, task_ref: string): Promise<string> {
    const cwd = await this.homeOf(task_ref, from);
    const head = await headOf(cwd).catch(() => undefined);
    const commit = head?.sha ?? '0'.repeat(40);
    const [{ n } = { n: 0 }] = await this.o.raw(`SELECT COUNT(*) AS n FROM events WHERE kind = 'claim.made' AND json_extract(data, '$.task_ref') = ?`, [task_ref]) as { n: number }[];
    const ts = this.o.now();
    const id = ulid(ts);
    await this.o.append(this.o.connection(session, agent), { v: 2, id, kind: 'claim.made', ts, data: { task_ref, attempt: Number(n) + 1, commit, scope: 'session', predictions: [] } });
    const claim = `claim:${id}`;
    const why = this.waitingWhy(task_ref);
    // A lock is on its way when your answer about the definition is still open or its lock is still being made.
    const expected = [...this.pending.values()].some((p) => p.definition.task_ref === task_ref) || this.locking.has(session);
    // The planted wrong program judges the claim on the spec alone, as if its definition were locked with nothing in it.
    const definition: DefinitionState = this.o.plant === 'spec-only-judges-early-claim' ? 'locked' : why ? { blocked: why } : expected ? 'waiting' : 'pending';
    this.early.set(task_ref, { claim, session, agent, cwd });
    await this.o.run({ claim, session, task: task_ref, commit, base: commit, cwd, deliverables: [], requirements: [], checks: [], definition });
    return claim;
  }
  /**
   * A claim on a task with a locked definition: a new claim.made, or, at the lock, the early claim given (`joins`),
   * which then runs the definition's checks beside the spec's it already ran.
   */
  private async judge(session: string, agent: string, from: string, task_ref: string, existing?: string): Promise<string> {
    const cwd = await this.homeOf(task_ref, from);
    const [row] = (await this.o.raw(`SELECT task_ref, requirements, deliverables, issue_rev, base_commit, budget, hash FROM definitions WHERE task_ref = ? AND state = 'locked' LIMIT 1`, [task_ref])) as Obj[];
    if (!row) throw Error('its definition is not locked');
    const head = await headOf(cwd).catch(() => undefined);
    const stored = JSON.parse(String(row.requirements)) as Requirement[];
    const requirements: Requirement[] = [];
    const changed: { check: string; approved: string | null; now: string | null }[] = [];
    // A stand-in recorded since the lock is the base run's finding, not the definition: the hash leaves it out.
    for (const { stand_in: _found, ...r } of stored) {
      const bytes = r.check ? await this.bytesOf(cwd, r.check) : undefined;
      const now = bytes ? sha256Hex(bytes) : null;
      if (r.check && now !== r.check_sha256) changed.push({ check: r.check, approved: r.check_sha256, now });
      const references: { path: string; sha256: string }[] = [];
      for (const ref of r.references ?? []) {
        const refBytes = await this.bytesOf(cwd, ref.path);
        const refNow = refBytes ? sha256Hex(refBytes) : '';
        if (refNow !== ref.sha256) changed.push({ check: ref.path, approved: ref.sha256, now: refNow || null });
        references.push({ path: ref.path, sha256: refNow });
      }
      requirements.push({ ...r, check_sha256: now, ...(r.references ? { references } : {}) });
    }
    const definition: Definition = {
      task_ref, requirements, deliverables: JSON.parse(String(row.deliverables ?? '[]')) as string[], issue_rev: String(row.issue_rev),
      base_commit: String(row.base_commit), budget: JSON.parse(String(row.budget ?? 'null')) as JsonValue,
    };
    const connection = this.o.connection(session, agent);
    const commit = head?.sha ?? definition.base_commit;
    const hash = this.hashOf(definition);
    let id: string;
    if (existing) id = existing.replace(/^claim:/, '');
    else {
      const [{ n } = { n: 0 }] = await this.o.raw(`SELECT COUNT(*) AS n FROM events WHERE kind = 'claim.made' AND json_extract(data, '$.task_ref') = ?`, [task_ref]) as { n: number }[];
      const ts = this.o.now();
      id = ulid(ts);
      await this.o.append(connection, {
        v: 3, id, kind: 'claim.made', ts,
        data: { task_ref, attempt: Number(n) + 1, commit, scope: 'session', predictions: [], hash },
      });
    }
    // The core's floor (#29): a recomputed hash that differs from the locked one makes the claim INVALID, naming what
    // changed, whatever done gate is installed and in safe mode.
    if (hash !== String(row.hash)) {
      const what = changed.length ? changed.map((c) => c.check) : ['the definition'];
      await this.o.invalid(`claim:${id}`, commit, `the definition's hash differs from the one locked for ${task_ref}; changed: ${what.join(', ')}`);
    }
    for (const c of changed) {
      const diff = `${c.check}: approved sha256 ${c.approved ?? 'none'}, now ${c.now ?? 'deleted'}`;
      const known = await this.o.raw(`SELECT 1 FROM events WHERE kind = 'learn.proposed' AND json_extract(data, '$.diff') = ? LIMIT 1`, [diff]);
      if (known.length) continue;
      // Before the change is approved, it lists the verdicts it would make stale (#323), each cited by its handle.
      const stale = await this.staleIf(cwd, c.check, id);
      const at = this.o.now();
      await this.o.append(connection, {
        v: 1, id: ulid(at), kind: 'learn.proposed', ts: at,
        data: {
          layer: 'learned', target: c.check, diff, scope: `session:${letters(session)}`, replay: null, applied_by: null, supersedes: null,
          evidence: [
            { at: `claim:${id}`, quote: `${c.check} changed after ${task_ref}'s definition locked; its checks run the approved bytes${stale.length ? `; approving it would make ${stale.length} verdict${stale.length === 1 ? '' : 's'} stale: ${stale.join(', ')}` : '; approving it would make no verdict stale'}` },
            ...stale.map((v) => ({ at: v, quote: `${v} would go stale: its checks read ${c.check}` })),
          ],
        },
      });
    }
    // Each target its requirements name is resolved in the folder the claim's snapshot is taken from, before any run (#323).
    const unresolved: { req: string; reason: string }[] = [];
    const renames = new Map<string, string>();
    for (const [i, r] of stored.entries()) {
      for (const target of r.targets ?? []) {
        const reason = await this.unresolvedTarget(cwd, target);
        // A target its history shows was renamed is the same target: followed here, and offered as one diff below (#67).
        const renamed = reason ? await this.followed(cwd, definition.base_commit, target) : undefined;
        if (renamed) renames.set(target.split('#')[0]!, renamed);
        else if (reason) unresolved.push({ req: `req:${letters(task_ref)}#${/^R[1-9][0-9]*$/.test(r.id) ? r.id : `R${i + 1}`}`, reason: `${r.id}'s target ${reason}` });
      }
    }
    if (unresolved.length) this.o.unresolved(`claim:${id}`, unresolved);
    if (renames.size) await this.proposeRenames(connection, session, task_ref, id, renames);
    // What a workspace's checks read is read now, and pinned to the claim; one that can't be read proves nothing (#67).
    let state: StatePin | undefined;
    try {
      state = await this.o.spaces.claimState(task_ref, cwd, `claim:${id}`);
    } catch (error) {
      await this.o.invalid(`claim:${id}`, commit, `what its checks read couldn't be read: ${error instanceof Error ? error.message : String(error)}`);
      return `claim:${id}`;
    }
    // Its checks start last, so a slow start holds up neither the claim nor its proposals.
    const onBase = (r: Requirement) => (r.on_base === 'passes' ? 'passes' as const : 'fails' as const);
    // Each with the requirement it judges and the surface it declares, for a stand-in on the base (#874), and the expected outputs it references by their approved digests.
    const checks = stored.flatMap((r) => (r.check && r.check_sha256 ? [{
      check: r.check, approved: r.check_sha256, on_base: onBase(r), asserts: r.asserts, req: r.id, surface: r.surface ?? null,
      ...(r.expected_ms !== undefined ? { expected_ms: r.expected_ms } : {}), ...(r.deadline_ms !== undefined ? { deadline_ms: r.deadline_ms } : {}),
      ...(r.references?.length ? { references: r.references } : {}), ...(r.command ? { command: r.command } : {}), ...(r.paid ? { paid: r.paid } : {}), ...(r.timing ? { timing: true } : {}),
      ...(r.runs !== undefined ? { runs: r.runs } : {}), ...(r.held_out?.length ? { held_out: r.held_out } : {}),
    }] : []));
    // Each requirement by its handle (req:<task>#R<n>, as verdict.made names them), with the check that covers it.
    const handles = stored.map((r, i) => ({ req: `req:${letters(task_ref)}#${/^R[1-9][0-9]*$/.test(r.id) ? r.id : `R${i + 1}`}`, id: r.id, text: r.criterion ? `${r.criterion}, ${r.text}` : r.text, depth: r.depth, oracle: r.oracle, on_base: onBase(r), check: r.check }));
    await this.o.run({ claim: `claim:${id}`, session, task: task_ref, commit, base: definition.base_commit, cwd, deliverables: definition.deliverables, requirements: handles, checks, definition: 'locked', ...(existing ? { joins: true } : {}), ...(state ? { state } : {}) });
    return `claim:${id}`;
  }

  /**
   * Records the stand-in a requirement's check was proven on (#874): the surface it enters through and the stand-in's
   * hash, as the requirement's `stand_in`, once for each hash.
   */
  async stoodIn(connection: Connection, r: { task: string; req: string; surface: Surface; hash: string }): Promise<void> {
    const [row] = (await this.o.raw('SELECT id, requirements FROM definitions WHERE task_ref = ?', [r.task])) as { id: string; requirements: string }[];
    if (!row) return;
    const was = (JSON.parse(row.requirements) as Requirement[]).find((q) => q.id === r.req)?.stand_in;
    if (was?.hash === r.hash) return;
    const ts = this.o.now();
    await this.o.append(connection, {
      v: 1, id: ulid(ts), kind: 'definition.stood_in', ts,
      data: { definition: row.id, task_ref: r.task, requirements: [{ id: r.req, stand_in: { surface: r.surface, hash: r.hash } }] } as unknown as JsonValue,
    });
  }

  /**
   * The requirements of a session's open item tasks that no verdict has passed (#322; design: At the claim), by the
   * issue number the task's source ID ends with: what keeps a pull request at "Part of". Undefined when no open task
   * of the session's thread is the issue's.
   */
  async unproven(session: string, issue: number): Promise<{ task_ref: string; left: { id: string; text: string }[]; locked: boolean } | undefined> {
    const rows = (await this.o.raw(`SELECT t.task_ref FROM tasks t WHERE t.state != 'closed' AND t.thread = ${this.threadSql(session)} ORDER BY t.created`)) as { task_ref: string }[];
    const task = rows.map((r) => String(r.task_ref)).find((ref) => !ref.startsWith('session:') && issueNumber(ref) === issue);
    if (!task) return undefined;
    const left = await this.leftOf(task);
    if (!left) return { task_ref: task, left: [], locked: false };
    return { task_ref: task, left: left.map((r) => ({ id: r.id, text: r.criterion ? `${r.criterion}, "${r.text}"` : `"${r.text}"` })), locked: true };
  }
  /** The requirements of a task's locked definition that its newest verdict didn't pass; undefined while none is locked. */
  async leftOf(task: string): Promise<Requirement[] | undefined> {
    const [definition] = (await this.o.raw(`SELECT requirements FROM definitions WHERE task_ref = ? AND state IN ('locked', 'revised') LIMIT 1`, [task])) as { requirements: string }[];
    if (!definition) return undefined;
    const requirements = JSON.parse(definition.requirements) as Requirement[];
    const [verdict] = (await this.o.raw(`SELECT v.requirements FROM verdicts v JOIN claims c ON c.id = v.claim_id WHERE c.subject_ref = ? AND v.stale = 0 ORDER BY v.created DESC LIMIT 1`, [task])) as { requirements: string }[];
    const passed = new Set((verdict ? JSON.parse(verdict.requirements) as { req: string; outcome: string }[] : []).filter((r) => r.outcome === 'PASS').map((r) => r.req.slice(r.req.indexOf('#') + 1)));
    return requirements.filter((r, i) => !passed.has(/^R[1-9][0-9]*$/.test(r.id) ? r.id : `R${i + 1}`));
  }

  /** The session's open asks with a locked definition and the requirements of each that no verdict has passed (#82). */
  async stillOpen(session: string): Promise<{ task_ref: string; left: Requirement[] }[]> {
    const out: { task_ref: string; left: Requirement[] }[] = [];
    for (const row of await this.lockedIn(session)) {
      const left = await this.leftOf(String(row.task_ref));
      if (left?.length) out.push({ task_ref: String(row.task_ref), left });
    }
    return out;
  }
  /** What SessionStart sends again after a compaction or a resume: the open asks' requirement IDs, in one short block. */
  async brief(session: string, thread: string | undefined): Promise<{ text: string; ids: string[] } | undefined> {
    const rows = await this.lockedIn(session, thread).catch(() => []);
    if (!rows.length) return undefined;
    // The planted wrong program sends each requirement's whole text, not its ID alone.
    const said = (q: { id: string; text?: string; refuted_by?: string }) => (this.o.plant === 'brief-full-text' ? `${q.id} (${String(q.text)}; refuted by ${String(q.refuted_by)})` : q.id);
    const asks = rows.map((r) => ({ task: String(r.task_ref), reqs: JSON.parse(String(r.requirements)) as { id: string }[] }));
    const lines = asks.map((a) => `- ${a.task}: ${a.reqs.map(said).join(', ')}`);
    // Each requirement by its handle too, for the record of what a reply cut to fit kept inline (#1296).
    return { text: `DeepBuild: the open asks in this thread and their requirements (deep_status shows each one):\n${lines.join('\n')}`, ids: asks.flatMap((a) => a.reqs.map((q) => `req:${a.task}#${q.id}`)) };
  }
}
