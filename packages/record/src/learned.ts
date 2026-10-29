// The learned layer (#62): the core's check of a learned change before it is in force, and the start slice
// agents read. Learning changes only a layer over a base it can't touch: the kernel's rules, the invariants,
// the specs and checks you approved, your decisions and the rules you typed (design: The learned layer).
// The projection judges a change from the record alone; what only the evidence store holds, the core reads at
// append and records as learn_check.made, so the layer stays a function of the log.
import type { JsonValue } from '@deepbuild/contracts';
import type { EvidenceStore } from '@deepbuild/evidence';
import type { Statement } from 'better-sqlite3';
import type { Db } from './storage.js';

/** Each connection's statements, prepared once: the layer's reads run several times per learned change. */
const prepared = new WeakMap<Db, Map<string, Statement<unknown[]>>>();
function q(db: Db, sql: string): Statement<unknown[]> {
  let statements = prepared.get(db);
  if (!statements) prepared.set(db, (statements = new Map()));
  let s = statements.get(sql);
  if (!s) statements.set(sql, (s = db.prepare(sql)));
  return s;
}

/** The base: a change of layer `learned` aimed at any of these is refused. A guard rule you add is `guard:<name>`. */
const BASE = ['kernel:', 'invariant:', 'spec:', 'check:', 'decision:', 'rule:', 'guard:'];
/** The learned layer's closed list of targets: wiki claims, start-slice entries, rules DeepBuild offers, extension patches, playbooks, step specs, how definitions are drafted, compositions. */
const LEARNED = ['wiki:', 'slice:', 'offer:', 'ext:', 'playbook:', 'step:', 'drafting:', 'composition:'];
/** The local-first rule: it applies a change to the session it came from, and no further. */
const LOCAL_FIRST = 'rule:localfirst';
/** The rule that applies the claims learned at install, at the scope their evidence covers. */
const INSTALL = 'rule:install';
/**
 * Tools whose results are no first-hand source: what the agent fetched, searched for, got from an MCP server, or a
 * subagent's report. Any other tool's result reads as first-hand, as the issue defines outside content: a check's
 * output is the evidence this product runs on, though a file the agent wrote and read back is its own words.
 */
const OUTSIDE = /^(WebFetch|WebSearch|Glob|Grep|Task|Agent|mcp__.+)$/;
/** A wiki claim's line, as its page and its change's diff hold it (#355): `- <text> <!-- deep:claim <its record> -->`. */
export interface ClaimLine { text: string; record: { [key: string]: JsonValue } }
const CLAIM_LINE = /^- (.*?) <!-- deep:claim (\{.*\}) -->$/;
export function parseClaimLine(line: string): ClaimLine | undefined {
  const m = CLAIM_LINE.exec(line);
  if (!m) return undefined;
  try {
    const record = JSON.parse(m[2]!) as JsonValue;
    return typeof record === 'object' && record !== null && !Array.isArray(record) ? { text: m[1]!, record } : undefined;
  } catch {
    return undefined;
  }
}
/** The writers that speak for you: only through them does a change reach the base. */
export const YOURS = new Set(['app', 'cli']);
/** The writers whose learn.rolled_back takes a change out of force: you, through the app or the CLI, and the core. */
export const ROLLERS = new Set([...YOURS, 'core']);
/** The learn.* kinds that change what is in force, which the core checks. */
export const CHECKED = new Set(['learn.applied', 'learn.widened']);
/** The kinds of the changes that can be in force. */
const IN_FORCE = "kind IN ('learn.applied', 'learn.widened') AND state = 'applied'";

export interface Quote { at: string; quote: string }
export interface LearnedChange { layer: string; target: string; diff: string; evidence: Quote[]; scope: string; applied_by: string | null }
export interface Check { outcome: 'refused' | 'held'; reason: string }
export interface SliceEntry { target: string; text: string }

type Obj = { [key: string]: JsonValue };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Text as quotes are compared: NFC, each whitespace run one space (design: Reading by reference). */
const norm = (text: string): string => text.normalize('NFC').replace(/\s+/g, ' ');
/** The lines a diff adds (`+`) or removes (`-`). */
const linesOf = (diff: string, sign: '+' | '-'): string[] =>
  diff.split('\n').filter((l) => l.startsWith(sign)).map((l) => l.slice(1).replace(/^ /, ''));
/** The text a stored JSON value holds: a string as it is, anything else as JSON. */
const textOf = (stored: string | null): string => {
  if (stored === null) return '';
  const value = JSON.parse(stored) as JsonValue;
  return typeof value === 'string' ? value : JSON.stringify(value);
};

/**
 * One Claude Code transcript entry: its text, and whether it is no first-hand source: the result of a tool that
 * brings outside content, or the agent's own words, which may repeat it (an agent's word is never evidence).
 */
export interface Entry { text: string; outside: boolean; role?: string; tool?: string }
function readTranscript(bytes: Uint8Array): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  const tools = new Map<string, string>();
  for (const line of Buffer.from(bytes).toString('utf8').split('\n')) {
    let entry: unknown;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!isObj(entry) || typeof entry.uuid !== 'string' || !isObj(entry.message)) continue;
    const content = entry.message.content;
    const parts: string[] = [];
    // The agent's turns, and what Claude Code writes under the user's role in its stead: a compaction summary,
    // and a subagent's run, whose prompt the agent composed.
    let outside = entry.message.role === 'assistant' || entry.isCompactSummary === true || entry.isSidechain === true;
    // The tool whose result the entry holds ('' for one whose call the transcript doesn't hold).
    let called: string | undefined;
    if (typeof content === 'string') parts.push(content);
    else if (Array.isArray(content)) {
      for (const block of content) {
        if (!isObj(block)) continue;
        if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
        if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') tools.set(block.id, block.name);
        if (block.type === 'tool_result') {
          // A result whose call the transcript doesn't hold is nobody's: no first-hand source either.
          const tool = tools.get(String(block.tool_use_id));
          if (tool === undefined || OUTSIDE.test(tool)) outside = true;
          called = tool ?? '';
          if (typeof block.content === 'string') parts.push(block.content);
          else if (Array.isArray(block.content)) for (const c of block.content) if (isObj(c) && typeof c.text === 'string') parts.push(c.text);
        }
      }
    }
    entries.set(entry.uuid, { text: parts.join('\n'), outside, ...(typeof entry.message.role === 'string' ? { role: entry.message.role } : {}), ...(called === undefined ? {} : { tool: called }) });
  }
  return entries;
}

/**
 * Where a handle's text is. The record holds what decisions and learned changes say; a transcript message or
 * an evidence file is bytes in the evidence store, which only the core reads, at append (`readEvidence`).
 * A whole session, a session with no archived transcript, or a scheme the layer doesn't read names nothing.
 */
type Located = { in: 'record'; entry: Entry } | { in: 'store'; sha: string; message?: string } | undefined;
function locate(db: Db, handle: string): Located {
  const session = /^session:([0-9A-Za-z]+)#(.+)$/.exec(handle);
  if (session) {
    const row = q(db, 'SELECT transcript FROM sessions WHERE id = ?').get(session[1]) as { transcript: string | null } | undefined;
    return row?.transcript ? { in: 'store', sha: row.transcript, message: session[2]! } : undefined;
  }
  const ev = /^ev:([0-9a-f]{64})$/.exec(handle);
  if (ev) return { in: 'store', sha: ev[1]! };
  const decision = /^decision:([0-9A-Za-z]+)$/.exec(handle);
  if (decision) {
    const row = q(db, "SELECT answer FROM decisions WHERE id = ? AND state = 'active'").get(decision[1]) as { answer: string | null } | undefined;
    return row ? { in: 'record', entry: { text: textOf(row.answer), outside: false } } : undefined;
  }
  // A learned change in force, by its handle: its diff.
  const change = q(db, `SELECT diff FROM learned_layer WHERE handle = ? AND ${IN_FORCE}`).get(handle) as { diff: string | null } | undefined;
  return change ? { in: 'record', entry: { text: change.diff ?? '', outside: false } } : undefined;
}
/** Text a reason names, cut so the reason stays within its schema's 8,192 characters. */
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);
const notAt = (quote: Quote): Check => ({ outcome: 'refused', reason: `the quote "${clip(quote.quote, 200)}" is not at its handle ${clip(quote.at, 4000)}` });
const quoted = (entry: Entry, quote: string): boolean => norm(entry.text).includes(norm(quote));

/** Every repo a scope reaches: `all` for every one. */
const EVERY = '*';
/**
 * The project of each session a change's evidence cites, of each file it cites that the core kept for a repo
 * (`keep`), and what each decision of yours it cites covers: its repo, its session's, or every repo.
 */
function projectsOf(db: Db, evidence: readonly Quote[]): Set<string> | undefined {
  const projects = new Set<string>();
  const ofSession = (id: string): string | null =>
    (q(db, 'SELECT project_id FROM sessions WHERE id = ?').get(id) as { project_id: string | null } | undefined)?.project_id ?? null;
  for (const { at } of evidence) {
    const session = /^session:([0-9A-Za-z]+)/.exec(at)?.[1];
    if (session) {
      const project = ofSession(session);
      if (!project) return undefined;
      projects.add(project);
      continue;
    }
    const file = /^ev:([0-9a-f]{64})$/.exec(at)?.[1];
    if (file) {
      const kept = q(db, "SELECT project_id FROM events WHERE kind = 'evidence.stored' AND json_extract(data, '$.sha256') = ? AND project_id IS NOT NULL ORDER BY log_pos DESC LIMIT 1").get(file) as { project_id: string } | undefined;
      if (kept) projects.add(kept.project_id);
      continue;
    }
    const decision = /^decision:([0-9A-Za-z]+)$/.exec(at)?.[1];
    if (decision) {
      const row = q(db, "SELECT scope FROM decisions WHERE id = ? AND state = 'active'").get(decision) as { scope: string | null } | undefined;
      const scope = textOf(row?.scope ?? null);
      const project = scope === 'all' ? EVERY : scope.startsWith('repo:') ? scope.slice(5) : scope.startsWith('session:') ? ofSession(scope.slice(8)) : null;
      if (project) projects.add(project);
    }
  }
  return projects.size ? projects : undefined;
}

/** The sessions a change came from, as scopes: each session it quotes, and the session of each session-scoped change it cites. */
function sourcesOf(db: Db, evidence: readonly Quote[]): Set<string> {
  const sources = new Set<string>();
  for (const { at } of evidence) {
    const session = /^session:([0-9A-Za-z]+)#/.exec(at)?.[1];
    if (session) sources.add(`session:${session}`);
    const cited = q(db, 'SELECT scope FROM learned_layer WHERE handle = ?').get(at) as { scope: string | null } | undefined;
    if (cited?.scope?.startsWith('session:')) sources.add(cited.scope);
  }
  return sources;
}

/** What the start slice always holds: each line of a rule you typed or a decision of yours, by the target that holds it. */
function baseLines(db: Db): Map<string, string> {
  const held = new Map<string, string>();
  for (const { target, text } of fold(q(db, `SELECT target, scope, diff FROM learned_layer WHERE ${IN_FORCE} AND layer = 'base' AND target LIKE 'rule:%' ORDER BY log_pos`).all() as FoldRow[], () => true)) {
    for (const line of text.split('\n')) held.set(norm(line), target);
  }
  for (const row of q(db, "SELECT id, answer FROM decisions WHERE state = 'active'").all() as { id: string; answer: string | null }[]) held.set(norm(textOf(row.answer)), `decision:${row.id}`);
  return held;
}

/** Whether a check was named by a requirement of a FAIL verdict: it once caught a real bug. */
function caughtABug(db: Db, check: string): boolean {
  for (const row of q(db, "SELECT requirements FROM verdicts WHERE outcome = 'FAIL'").all() as { requirements: string | null }[]) {
    const requirements = row.requirements ? (JSON.parse(row.requirements) as JsonValue) : [];
    if (Array.isArray(requirements) && requirements.some((r) => isObj(r) && r.check === check)) return true;
  }
  return false;
}

/** The targets whose lines are `<field>: <value>`: what a step runs and checks, and what an extension may reach. */
const STEPS = ['step:', 'playbook:', 'composition:'];
const STEP_FIELDS = new Set(['run', 'check', 'assert', 'verify', 'mode', 'note']);
const VERIFICATION = new Set(['check', 'assert', 'verify']);
const GRANT = new Set(['grant.words', 'grant.hosts', 'grant.paths']);
const GUARD_FIELD = /^guard\.[^.\s]+\.(match|scope|mode|reason|next_step|fail_closed)$/;
/** Each order runs from the narrowest to the widest permission mode, and from the weakest to the strongest guard. */
const MODES = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];
const STRENGTH: Record<string, string[]> = { mode: ['watch', 'warn', 'block'], fail_closed: ['false', 'true'] };
/** Flags known to switch verification off, in a line a change adds to any target. */
const VERIFY_OFF: [RegExp, string][] = [
  [/(^|\s)--insecure(?=[\s=]|$)/, '--insecure'],
  [/\bcurl\b[^|;&\n]*?\s-[A-Za-z]*k[A-Za-z]*(?=\s|$)/, 'curl -k'],
  [/\bNODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/, 'NODE_TLS_REJECT_UNAUTHORIZED=0'],
  [/\bGIT_SSL_NO_VERIFY\b/, 'GIT_SSL_NO_VERIFY'],
  [/\bverify\s*=\s*False\b/, 'verify=False'],
];
interface Field { line: string; field: string | undefined; value: string }
const fieldsOf = (lines: string[]): Field[] => lines.map((line) => {
  const m = /^([^\s:]+): ?(.*)$/.exec(line);
  return { line, field: m?.[1], value: m?.[2] ?? '' };
});

/**
 * Whether a learned change's diff loosens safety, read from its structure: a flag that switches verification off,
 * a verification step removed or narrowed, a grant or a permission mode widened, a guard's coverage lowered, or a
 * field the classifier doesn't know inside a step or an extension. Such a change counts as aimed at the base, so
 * it is held for you whatever its replay shows, its reason quoting the clause that loosens.
 */
export function loosens(target: string, diff: string): string | undefined {
  const say = (line: string, why: string): string => `${clip(target, 200)} is held for you: "${clip(line, 4000)}" ${why}`;
  const added = linesOf(diff, '+');
  for (const line of added) for (const [flag, name] of VERIFY_OFF) if (flag.test(line)) return say(line, `switches verification off (${name})`);
  const step = STEPS.some((p) => target.startsWith(p));
  if (!step && !target.startsWith('ext:')) return undefined;
  const plus = fieldsOf(added);
  const minus = fieldsOf(linesOf(diff, '-'));
  for (const { line, field } of [...plus, ...minus]) {
    const known = field !== undefined && (step ? STEP_FIELDS.has(field) : field === 'note' || GRANT.has(field) || GUARD_FIELD.test(field));
    if (!known) return say(line, 'changes a field the classifier does not know, which counts as loosening');
  }
  for (const { line, field, value } of minus) {
    if (plus.some((p) => p.line === line)) continue;
    if (step && VERIFICATION.has(field!)) return say(line, 'removes or narrows a verification step');
    const guard = step ? undefined : GUARD_FIELD.exec(field!)?.[1];
    if (guard === 'match' || guard === 'scope') return say(line, "lowers a guard's coverage");
    const order = guard ? STRENGTH[guard] : undefined;
    if (order) {
      const next = plus.find((p) => p.field === field);
      if (!next || order.indexOf(next.value) < order.indexOf(value)) return say(next?.line ?? line, "lowers a guard's coverage");
    }
  }
  for (const { line, field, value } of plus) {
    if (!step && GRANT.has(field!)) return say(line, 'widens a grant');
    if (step && field === 'mode') {
      const was = MODES.indexOf(minus.find((m) => m.field === 'mode')?.value ?? 'default');
      const now = MODES.indexOf(value);
      if (now < 0 || now > was) return say(line, 'widens a permission mode');
    }
  }
  return undefined;
}

/**
 * The layer's judgment of a learned change from the record alone, as the projection makes it at the change's
 * place in the log: undefined when it is in force, or refused or held with a reason naming the target, the
 * handle or the check. The first failure decides. Quotes in the evidence store are the core's to read
 * (`readEvidence`), so here they count as found.
 */
export function judge(db: Db, change: LearnedChange, writer: string): Check | undefined {
  const refused = (reason: string): Check => ({ outcome: 'refused', reason });
  const { target, scope } = change;
  if (change.layer !== 'learned' && !YOURS.has(writer)) return refused(`${target} is in the base, which only you change, through the app or the CLI, not ${writer}`);
  if (change.layer === 'learned') {
    if (BASE.some((p) => target.startsWith(p))) return refused(`${target} is in the base, which only you change, as a base change you approve`);
    if (!LEARNED.some((p) => target.startsWith(p))) return refused(`${target} is not a target the learned layer holds`);
  }
  // Who applied it: you, the local-first rule within a session, install claims at the scope their evidence covers, or a rule you typed.
  const by = change.applied_by;
  // Its session is one its evidence came from; evidence from no session (an evidence file) names none to hold it to.
  const sources = by === LOCAL_FIRST ? sourcesOf(db, change.evidence) : undefined;
  if (sources && (!scope.startsWith('session:') || (sources.size > 0 && !sources.has(scope)))) return refused(`the local-first rule applies ${target} only to the session it came from; ${scope} needs your OK`);
  if (by === INSTALL) {
    const projects = projectsOf(db, change.evidence);
    const covered = !projects ? undefined : projects.size > 1 || projects.has(EVERY) ? 'all' : `repo:${[...projects][0]!}`;
    if (!covered) return refused(`${target} was learned at install from no session of a known repo`);
    if (covered !== 'all' && scope !== covered) return refused(`${target} claims ${scope}, but its evidence covers ${covered}`);
  } else if (by !== null && by !== 'you' && by !== LOCAL_FIRST
    && !q(db, `SELECT 1 FROM learned_layer WHERE ${IN_FORCE} AND layer = 'base' AND target = ?`).get(by)) return refused(`${by}, which applied ${target}, is not a rule you approved`);

  // Every quote at its handle (design: Reading by reference).
  for (const quote of change.evidence) {
    const where = locate(db, quote.at);
    if (!where || (where.in === 'record' && !quoted(where.entry, quote.quote))) return notAt(quote);
  }
  if (change.layer !== 'learned') return undefined;

  // The start slice always holds the rules you typed and your decisions: a learned change can't take one out.
  const removed = linesOf(change.diff, '-');
  const held = removed.length ? baseLines(db) : new Map<string, string>();
  for (const line of removed) {
    const holder = held.get(norm(line));
    if (holder) return refused(`${target} would remove ${holder} ("${line}"), which the start slice always holds`);
  }
  // How definitions are drafted: dropping a check that once caught a real bug waits for you.
  if (target.startsWith('drafting:')) {
    for (const dropped of removed) {
      if (caughtABug(db, dropped.trim())) return { outcome: 'held', reason: `${target} would drop ${dropped.trim()}, a check that once caught a real bug` };
    }
  }
  const loosening = loosens(target, change.diff);
  return loosening === undefined ? undefined : { outcome: 'held', reason: loosening };
}

/** What the store holds at a location: a file as text, or one transcript message. Transcripts are parsed once, by hash. */
// A file the store doesn't hold has nothing at it; a read of one it holds that fails throws, so the append
// fails and its retry reads again, and nothing false about the evidence is recorded or kept.
async function readStored(store: EvidenceStore | undefined, transcripts: Transcripts, where: { sha: string; message?: string }): Promise<Entry | undefined> {
  const bytesOf = async (sha: string): Promise<Uint8Array | undefined> => (store && (await store.get(sha)) ? store.read(sha) : undefined);
  if (where.message === undefined) {
    const b = await bytesOf(where.sha);
    return b ? { text: Buffer.from(b).toString('utf8'), outside: false } : undefined;
  }
  return (await parsedTranscript(store, transcripts, where.sha))?.get(where.message);
}
/** The bytes of transcript files whose parses a cache keeps, at most: the newest one is kept whatever its size. */
const TRANSCRIPT_BYTES_KEPT = 32 * 1024 * 1024;
/** The size of each file a cache holds a parse of, once read. */
const cachedBytes = new WeakMap<Transcripts, Map<string, number>>();
/**
 * A transcript in the store, parsed once by hash, the least recently read dropped first past the byte bound. Only a
 * parsed one is kept: a file the store doesn't hold yet, or a failed read, is asked for again.
 */
function parsedTranscript(store: EvidenceStore | undefined, transcripts: Transcripts, sha: string): Promise<Map<string, Entry> | undefined> {
  let sizes = cachedBytes.get(transcripts);
  if (!sizes) cachedBytes.set(transcripts, (sizes = new Map()));
  const known = sizes;
  let parsed = transcripts.get(sha);
  if (parsed) {
    // Read again: now the newest.
    transcripts.delete(sha);
    transcripts.set(sha, parsed);
    return parsed;
  }
  const forget = (): void => {
    if (transcripts.get(sha) === parsed) transcripts.delete(sha);
    known.delete(sha);
  };
  parsed = (async () => (store && (await store.get(sha)) ? store.read(sha) : undefined))().then((b) => {
    if (!b) {
      forget();
      return undefined;
    }
    if (transcripts.get(sha) === parsed) {
      known.set(sha, b.length);
      let total = 0;
      for (const size of known.values()) total += size;
      for (const oldest of transcripts.keys()) {
        if (total <= TRANSCRIPT_BYTES_KEPT || oldest === sha) break;
        total -= known.get(oldest) ?? 0;
        known.delete(oldest);
        transcripts.delete(oldest);
      }
    }
    return readTranscript(b);
  });
  transcripts.set(sha, parsed);
  parsed.catch(forget);
  return parsed;
}

/** One message of an archived transcript: its ID (`session:<id>#<message>`) and what it holds. */
export interface Message extends Entry { id: string }
/**
 * A session's archived transcript (design: Reading by reference): the evidence its newest transcript.archived event
 * links, and each message that holds text, in order. Undefined for a session no such event links.
 */
export async function sessionTranscript(db: Db, store: EvidenceStore | undefined, transcripts: Transcripts, session: string): Promise<Message[] | undefined> {
  const row = q(db, 'SELECT transcript FROM sessions WHERE id = ?').get(session) as { transcript: string | null } | undefined;
  if (!row?.transcript) return undefined;
  const parsed = await parsedTranscript(store, transcripts, row.transcript);
  if (!parsed) return undefined;
  return [...parsed].filter(([, e]) => e.text !== '').map(([id, e]) => ({ id, ...e }));
}

/**
 * What a handle names now (design: Reading by reference): a transcript message, with its role and the tool whose
 * result it holds; a decision's answer; an evidence file's text; a learned change's diff. Undefined for nothing.
 */
export async function resolveHandle(db: Db, store: EvidenceStore | undefined, transcripts: Transcripts, handle: string): Promise<Entry | undefined> {
  const where = locate(db, handle);
  return where?.in === 'store' ? readStored(store, transcripts, where) : where?.entry;
}

/**
 * The core's reading of what a change cites in the evidence store, at append: a quote not in its transcript
 * message or evidence file is refused, naming the handle, and a start-slice claim whose every cited source is
 * outside content is refused unless a decision of yours it cites holds each line it adds. Undefined when
 * nothing it read refuses it; the core records a refusal as learn_check.made, so a rebuild needs no bytes.
 */
export async function readEvidence(db: Db, store: EvidenceStore | undefined, change: LearnedChange, transcripts: Transcripts): Promise<Check | undefined> {
  const read = (where: { sha: string; message?: string }): Promise<Entry | undefined> => readStored(store, transcripts, where);
  /** Whether a learned change rests only on outside content, through every change it cites: a citation inherits it. */
  // Each cited change is judged once and its answer reused wherever it is cited again; one being judged reads
  // false to a citation back to it, though a change cites only changes already in force, so none can.
  /**
   * The clauses (normalized) of the decisions of yours among the quotes: each line of an answer, cut at '; ', and
   * of a labelled line ("promote: X") what follows its last label, never the label ("X: no" promotes only "no"),
   * and nothing when the label is a negation ("never: X", "no: X", "do not: X" promote nothing).
   */
  const NEGATION = /(^|[^a-z])(never|no|not|don'?t)([^a-z]|$)/;
  const clauseOf = (piece: string): string => {
    const cut = piece.lastIndexOf(': ');
    if (cut < 0) return piece.trim();
    return NEGATION.test(piece.slice(0, cut).toLowerCase()) ? '' : piece.slice(cut + 2).trim();
  };
  const decisionsAmong = (quotes: Quote[]): string[] => quotes.filter((q) => q.at.startsWith('decision:')).flatMap((q) => {
    const where = locate(db, q.at);
    return where?.in === 'record' ? where.entry.text.split('\n').flatMap((l) => norm(l).split('; ')).map(clauseOf).filter((c) => c !== '') : [];
  });
  /** What a cited change rests on: whether only outside content, and the decisions it and its citations cite. */
  interface Rests { outside: boolean; decisions: string[] }
  const judged = new Map<string, Promise<Rests>>();
  const restsOn = (handle: string): Promise<Rests> => {
    let answer = judged.get(handle);
    if (!answer) {
      judged.set(handle, Promise.resolve({ outside: false, decisions: [] }));
      answer = (async () => {
        const row = q(db, 'SELECT evidence FROM learned_layer WHERE handle = ?').get(handle) as { evidence: string | null } | undefined;
        const quotes = row?.evidence ? (JSON.parse(row.evidence) as Quote[]) : [];
        const decisions = decisionsAmong(quotes);
        const sources = quotes.filter((q) => !q.at.startsWith('decision:'));
        // A source nobody can read now (a link rolled back since, a transcript gone) is no first-hand source either,
        // and a change resting on your decisions alone carries only what they hold.
        let outside = true;
        for (const { at } of sources) {
          const where = locate(db, at);
          if (where?.in === 'store') outside &&= (await read(where))?.outside !== false;
          else if (where?.in === 'record' && at.startsWith('doc:')) {
            const rests = await restsOn(at);
            outside &&= rests.outside;
            decisions.push(...rests.decisions);
          } else outside &&= where === undefined;
        }
        return { outside, decisions };
      })();
      judged.set(handle, answer);
    }
    return answer;
  };
  const cited: { at: string; entry: Entry | undefined }[] = [];
  // The decisions the change cites, and those its cited changes rest on: a citation inherits a promotion as it
  // inherits outside-ness, but only for the lines the decision holds.
  const decisions = decisionsAmong(change.evidence);
  for (const quote of change.evidence) {
    const where = locate(db, quote.at);
    let entry = where?.in === 'record' ? where.entry : undefined;
    if (where?.in === 'store') {
      entry = await read(where);
      if (!entry || !quoted(entry, quote.quote)) return notAt(quote);
    }
    if (entry && quote.at.startsWith('doc:')) {
      const rests = await restsOn(quote.at);
      entry = { ...entry, outside: rests.outside };
      decisions.push(...rests.decisions);
    }
    cited.push({ at: quote.at, entry });
  }
  // A start-slice claim resting only on outside content, or on your decisions alone, goes in only when a decision
  // promoted it: a clause of it is each line the claim adds, not a run of words inside one ("never deploy with
  // --force" promotes nothing).
  if (change.layer === 'learned' && change.target.startsWith('slice:')) {
    const sources = cited.filter((c) => !c.at.startsWith('decision:'));
    if (sources.every((c) => c.entry?.outside)) {
      const clauses = new Set(decisions);
      const promoted = linesOf(change.diff, '+').every((line) => clauses.has(norm(line).trim()));
      if (!promoted) return { outcome: 'refused', reason: `${clip(change.target, 4000)} would rest only on outside content, which goes into the start slice only when your decision promotes it` };
    }
  }
  return undefined;
}

/** Parsed transcripts by hash: the store's files never change, so a parse is kept across appends. */
export type Transcripts = Map<string, Promise<Map<string, Entry> | undefined>>;

/**
 * What a change's reading depends on, as text the append compares: which transcript each session it cites names
 * now, through the changes it cites too, and the layer's newest position among what can be in force, which an
 * agent's proposal never moves. The reading holds only while this is unchanged.
 */
export function dependsOn(db: Db, change: LearnedChange): string {
  const sessions = new Set<string>();
  const seen = new Set<string>();
  const walk = (quotes: Quote[]): void => {
    for (const { at } of quotes) {
      const session = /^session:([0-9A-Za-z]+)#/.exec(at)?.[1];
      if (session !== undefined) sessions.add(session);
      else if (at.startsWith('doc:') && !seen.has(at)) {
        seen.add(at);
        const row = q(db, 'SELECT evidence FROM learned_layer WHERE handle = ?').get(at) as { evidence: string | null } | undefined;
        if (row?.evidence) walk(JSON.parse(row.evidence) as Quote[]);
      }
    }
  };
  walk(change.evidence);
  const of = q(db, 'SELECT transcript FROM sessions WHERE id = ?');
  const newest = (q(db, "SELECT MAX(log_pos) AS at FROM learned_layer WHERE kind <> 'learn.proposed'").get() as { at: number | null }).at ?? 0;
  return [`@${newest}`, ...[...sessions].map((s) => `${s}=${(of.get(s) as { transcript: string | null } | undefined)?.transcript ?? ''}`)].join(' ');
}

interface FoldRow { target: string; scope: string; diff: string | null }
/** The changes in log order, folded line by line into entries: `+` adds a line, `-` removes it. */
function fold(rows: readonly FoldRow[], covers: (scope: string) => boolean): SliceEntry[] {
  const entries = new Map<string, string[]>();
  for (const row of rows) {
    if (!covers(row.scope)) continue;
    const lines = entries.get(row.target) ?? [];
    entries.set(row.target, lines);
    for (const raw of (row.diff ?? '').split('\n')) {
      const line = raw.slice(1).replace(/^ /, '');
      if (raw.startsWith('-')) {
        const i = lines.indexOf(line);
        if (i >= 0) lines.splice(i, 1);
      } else if (raw.startsWith('+') && !lines.includes(line)) lines.push(line);
    }
  }
  return [...entries].filter(([, lines]) => lines.length).map(([target, lines]) => ({ target, text: lines.join('\n') }));
}

/** A session or project ID as a scope names it: letters and digits only, as the hub's handles hold them (a stored scope is already so, by its schema). */
const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
/** Whether a scope covers a session: everywhere, the session, or the project its session.start was recorded under. */
function coversSession(db: Db, session: string): (scope: string) => boolean {
  const row = q(db, 'SELECT project_id FROM sessions WHERE id = ?').get(session) as { project_id: string | null } | undefined;
  const scopes = new Set([`session:${letters(session)}`, 'all', ...(row?.project_id ? [`repo:${letters(row.project_id)}`] : [])]);
  return (scope) => scopes.has(scope);
}

/**
 * What a session reads at its start, and at each prompt for the rules you typed: every rule you typed, the
 * learned start-slice entries in force whose scope covers it, and every decision whose scope covers it. Read
 * from the record as it is now, so a rule you type reaches every open session at its next prompt.
 */
export function startSlice(db: Db, session: string): SliceEntry[] {
  const covers = coversSession(db, session);
  const rows = q(db, `SELECT target, scope, diff FROM learned_layer WHERE ${IN_FORCE} AND ((layer = 'base' AND target LIKE 'rule:%') OR (layer = 'learned' AND target LIKE 'slice:%')) ORDER BY log_pos`).all() as FoldRow[];
  const slice = fold(rows, covers);
  for (const d of q(db, "SELECT id, scope, answer FROM decisions WHERE state = 'active' ORDER BY created, id").all() as { id: string; scope: string | null; answer: string | null }[]) {
    if (covers(textOf(d.scope))) slice.push({ target: `decision:${d.id}`, text: textOf(d.answer) });
  }
  return slice;
}

export interface HeldAtLoad { target: string; reason: string }
export interface LearnedLoad { loaded: SliceEntry[]; held: HeldAtLoad[] }

/** A glob as deep-hook's matcher reads one: `*` any run, the rest matched whole. */
const globMatches = (pattern: string, text: string): boolean =>
  new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's').test(text);
/** The programs a plain command line runs, each with its words: split at `&&`, `||`, `;` and `|`, past assignments and the wrappers deep-hook looks through. */
function runsOf(command: string): string[][] {
  return command.split(/&&|\|\||[;|]/).map((part) => {
    const words = part.trim().split(/\s+/).filter((w) => w !== '');
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!)) words.shift();
    if (['env', 'command', 'exec', 'nohup', 'sudo', 'xargs'].includes(words[0] ?? '')) words.shift();
    else if (words[0] === 'timeout') words.splice(0, 2);
    return words;
  }).filter((words) => words.length > 0);
}
/**
 * Whether a guard's `match` reads a command a step runs, as deep-hook's matcher reads a plain command line: its
 * `shell:` and `run:` forms. Undefined for a form only deep-hook can read from a call (a write, a kill, an effect).
 */
function matchesCommand(match: string, command: string): boolean | undefined {
  const cut = match.indexOf(':');
  const rest = match.slice(cut + 1);
  if (match.startsWith('shell:')) return globMatches(rest, command);
  if (!match.startsWith('run:')) return undefined;
  const [program, ...wanted] = rest.trim().split(/\s+/);
  return runsOf(command).some(([first, ...args]) => {
    if (!globMatches(program!.toLowerCase(), first!.split('/').pop()!.toLowerCase())) return false;
    const plain = args.filter((a) => !a.startsWith('-'));
    let next = 0;
    return wanted.every((want) => (want.startsWith('-') ? args.some((a) => globMatches(want, a)) : next < plain.length && globMatches(want, plain[next++]!)));
  });
}

/**
 * What a session loads of the learned step specs, playbooks and compositions in force whose scope covers it,
 * each checked against the guard rules in force now, so a rule added after a spec applied still holds it. One
 * that runs a command a `block` rule denies, or that a rule this check can't read might deny, stays out of the
 * session and shows as held, naming the rule. Read from the record as it is now, as the start slice is.
 */
export function loadLearned(db: Db, session: string): LearnedLoad {
  const covers = coversSession(db, session);
  const inForce = (where: string): SliceEntry[] =>
    fold(q(db, `SELECT target, scope, diff FROM learned_layer WHERE ${IN_FORCE} AND ${where} ORDER BY log_pos`).all() as FoldRow[], covers);
  const guards = inForce("layer = 'base' AND target LIKE 'guard:%'").map(({ target, text }) => {
    const fields = new Map(fieldsOf(text.split('\n')).map((f) => [f.field, f.value]));
    return { name: target.slice('guard:'.length), match: fields.get('match') ?? '', mode: fields.get('mode'), reason: fields.get('reason') ?? '' };
  }).filter((g) => g.mode === 'block');
  const out: LearnedLoad = { loaded: [], held: [] };
  for (const entry of inForce(`layer = 'learned' AND (${STEPS.map((p) => `target LIKE '${p}%'`).join(' OR ')})`)) {
    const commands = fieldsOf(entry.text.split('\n')).filter((f) => f.field === 'run' || f.field === 'verify').map((f) => f.value);
    let reason: string | undefined;
    for (const guard of guards) {
      for (const command of commands) {
        const hit = matchesCommand(guard.match, command);
        if (hit === false) continue;
        reason = hit
          ? `${entry.target} runs "${clip(command, 2000)}", which the guard rule ${guard.name} denies: ${clip(guard.reason, 2000)}`
          : `${entry.target} runs "${clip(command, 2000)}", and the guard rule ${guard.name} matches "${clip(guard.match, 2000)}", which only deep-hook reads from a call, so it is held until you look`;
        break;
      }
      if (reason) break;
    }
    if (reason) out.held.push({ target: entry.target, reason });
    else out.loaded.push(entry);
  }
  return out;
}

/** The learned changes a rollback compensates, newest first: one in force, or every one in force since a time; never the base. */
export function toRollBack(db: Db, what: { change: string } | { since: number }): { id: string; layer: string; target: string; diff: string; scope: string; handle: string }[] {
  const columns = 'SELECT id, layer, target, diff, scope, handle FROM learned_layer';
  return ('change' in what
    ? q(db, `${columns} WHERE id = ? AND layer = 'learned' AND ${IN_FORCE}`).all(what.change)
    : q(db, `${columns} WHERE created >= ? AND layer = 'learned' AND ${IN_FORCE} ORDER BY log_pos DESC`).all(what.since)) as ReturnType<typeof toRollBack>;
}
