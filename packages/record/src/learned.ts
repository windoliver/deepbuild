// The learned layer (#62): the core's check of a learned change before it is in force, and the start slice
// agents read. Learning changes only a layer over a base it can't touch: the kernel's rules, the invariants,
// the specs and checks you approved, your decisions and the rules you typed (design: The learned layer).
// The projection judges a change from the record alone; what only the evidence store holds, the core reads at
// append and records as learn_check.made, so the layer stays a function of the log.
import type { JsonValue } from '@deepbuild/contracts';
import type { EvidenceStore } from '@deepbuild/evidence';
import type { Db } from './storage.js';

/** The base: a change of layer `learned` aimed at any of these is refused. */
const BASE = ['kernel:', 'invariant:', 'spec:', 'check:', 'decision:', 'rule:'];
/** The learned layer's closed list of targets: wiki claims, start-slice entries, rules DeepBuild offers, extension patches, playbooks, step specs, how definitions are drafted, compositions. */
const LEARNED = ['wiki:', 'slice:', 'offer:', 'ext:', 'playbook:', 'step:', 'drafting:', 'composition:'];
/** The local-first rule: it applies a change to the session it came from, and no further. */
const LOCAL_FIRST = 'rule:localfirst';
/** The rule that applies the claims learned at install, at the scope their evidence covers. */
const INSTALL = 'rule:install';
/** Tools whose results are outside content: what the agent fetched, searched for or got from an MCP server. */
const OUTSIDE = /^(WebFetch|WebSearch|Glob|Grep|mcp__.+)$/;
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

/** One Claude Code transcript entry: its text, and whether it is the result of a tool that brings outside content. */
interface Entry { text: string; outside: boolean }
function readTranscript(bytes: Uint8Array): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  const tools = new Map<string, string>();
  for (const line of Buffer.from(bytes).toString('utf8').split('\n')) {
    let entry: unknown;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!isObj(entry) || typeof entry.uuid !== 'string' || !isObj(entry.message)) continue;
    const content = entry.message.content;
    const parts: string[] = [];
    let outside = false;
    if (typeof content === 'string') parts.push(content);
    else if (Array.isArray(content)) {
      for (const block of content) {
        if (!isObj(block)) continue;
        if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
        if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') tools.set(block.id, block.name);
        if (block.type === 'tool_result') {
          if (OUTSIDE.test(tools.get(String(block.tool_use_id)) ?? '')) outside = true;
          if (typeof block.content === 'string') parts.push(block.content);
          else if (Array.isArray(block.content)) for (const c of block.content) if (isObj(c) && typeof c.text === 'string') parts.push(c.text);
        }
      }
    }
    entries.set(entry.uuid, { text: parts.join('\n'), outside });
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
    const row = db.prepare('SELECT transcript FROM sessions WHERE id = ?').get(session[1]) as { transcript: string | null } | undefined;
    return row?.transcript ? { in: 'store', sha: row.transcript, message: session[2]! } : undefined;
  }
  const ev = /^ev:([0-9a-f]{64})$/.exec(handle);
  if (ev) return { in: 'store', sha: ev[1]! };
  const decision = /^decision:([0-9A-Za-z]+)$/.exec(handle);
  if (decision) {
    const row = db.prepare("SELECT answer FROM decisions WHERE id = ? AND state = 'active'").get(decision[1]) as { answer: string | null } | undefined;
    return row ? { in: 'record', entry: { text: textOf(row.answer), outside: false } } : undefined;
  }
  // A learned change in force, by its handle: its diff.
  const change = db.prepare(`SELECT diff FROM learned_layer WHERE handle = ? AND ${IN_FORCE}`).get(handle) as { diff: string | null } | undefined;
  return change ? { in: 'record', entry: { text: change.diff ?? '', outside: false } } : undefined;
}
/** Text a reason names, cut so the reason stays within its schema's 8,192 characters. */
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);
const notAt = (quote: Quote): Check => ({ outcome: 'refused', reason: `the quote "${clip(quote.quote, 200)}" is not at its handle ${clip(quote.at, 4000)}` });
const quoted = (entry: Entry, quote: string): boolean => norm(entry.text).includes(norm(quote));

/** The project of each session a change's evidence cites. */
function projectsOf(db: Db, evidence: readonly Quote[]): Set<string> | undefined {
  const projects = new Set<string>();
  for (const { at } of evidence) {
    const session = /^session:([0-9A-Za-z]+)/.exec(at)?.[1];
    if (!session) continue;
    const row = db.prepare('SELECT project_id FROM sessions WHERE id = ?').get(session) as { project_id: string | null } | undefined;
    if (!row?.project_id) return undefined;
    projects.add(row.project_id);
  }
  return projects.size ? projects : undefined;
}

/** The sessions a change came from, as scopes: each session it quotes, and the session of each session-scoped change it cites. */
function sourcesOf(db: Db, evidence: readonly Quote[]): Set<string> {
  const sources = new Set<string>();
  for (const { at } of evidence) {
    const session = /^session:([0-9A-Za-z]+)#/.exec(at)?.[1];
    if (session) sources.add(`session:${session}`);
    const cited = db.prepare('SELECT scope FROM learned_layer WHERE handle = ?').get(at) as { scope: string | null } | undefined;
    if (cited?.scope?.startsWith('session:')) sources.add(cited.scope);
  }
  return sources;
}

/** What the start slice always holds: each line of a rule you typed or a decision of yours, by the target that holds it. */
function baseLines(db: Db): Map<string, string> {
  const held = new Map<string, string>();
  for (const { target, text } of fold(db.prepare(`SELECT target, scope, diff FROM learned_layer WHERE ${IN_FORCE} AND layer = 'base' AND target LIKE 'rule:%' ORDER BY log_pos`).all() as FoldRow[], () => true)) {
    for (const line of text.split('\n')) held.set(norm(line), target);
  }
  for (const row of db.prepare("SELECT id, answer FROM decisions WHERE state = 'active'").all() as { id: string; answer: string | null }[]) held.set(norm(textOf(row.answer)), `decision:${row.id}`);
  return held;
}

/** Whether a check was named by a requirement of a FAIL verdict: it once caught a real bug. */
function caughtABug(db: Db, check: string): boolean {
  for (const row of db.prepare("SELECT requirements FROM verdicts WHERE outcome = 'FAIL'").all() as { requirements: string | null }[]) {
    const requirements = row.requirements ? (JSON.parse(row.requirements) as JsonValue) : [];
    if (Array.isArray(requirements) && requirements.some((r) => isObj(r) && r.check === check)) return true;
  }
  return false;
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
    const covered = !projects ? undefined : projects.size > 1 ? 'all' : `repo:${[...projects][0]!}`;
    if (!covered) return refused(`${target} was learned at install from no session of a known repo`);
    if (covered !== 'all' && scope !== covered) return refused(`${target} claims ${scope}, but its evidence covers ${covered}`);
  } else if (by !== null && by !== 'you' && by !== LOCAL_FIRST
    && !db.prepare(`SELECT 1 FROM learned_layer WHERE ${IN_FORCE} AND layer = 'base' AND target = ?`).get(by)) return refused(`${by}, which applied ${target}, is not a rule you approved`);

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
    for (const dropped of linesOf(change.diff, '-')) {
      if (caughtABug(db, dropped.trim())) return { outcome: 'held', reason: `${target} would drop ${dropped.trim()}, a check that once caught a real bug` };
    }
  }
  return undefined;
}

/**
 * The core's reading of what a change cites in the evidence store, at append: a quote not in its transcript
 * message or evidence file is refused, naming the handle, and a start-slice claim whose every cited source is
 * outside content is refused unless a decision of yours it cites holds each line it adds. Undefined when
 * nothing it read refuses it; the core records a refusal as learn_check.made, so a rebuild needs no bytes.
 */
export async function readEvidence(db: Db, store: EvidenceStore | undefined, change: LearnedChange, transcripts: Transcripts): Promise<Check | undefined> {
  /** What the store holds at a location: a file as text, or one transcript message. Transcripts are parsed once, by hash. */
  // A file the store doesn't hold has nothing at it; a read of one it holds that fails throws, so the append
  // fails and its retry reads again, and nothing false about the evidence is recorded or kept.
  const bytesOf = async (sha: string): Promise<Uint8Array | undefined> => (store && (await store.get(sha)) ? store.read(sha) : undefined);
  const read = async (where: { sha: string; message?: string }): Promise<Entry | undefined> => {
    if (where.message === undefined) {
      const b = await bytesOf(where.sha);
      return b ? { text: Buffer.from(b).toString('utf8'), outside: false } : undefined;
    }
    let parsed = transcripts.get(where.sha);
    if (!parsed) {
      parsed = bytesOf(where.sha).then((b) => (b ? readTranscript(b) : undefined));
      transcripts.set(where.sha, parsed);
      parsed.catch(() => transcripts.delete(where.sha));
    }
    return (await parsed)?.get(where.message);
  };
  /** Whether a learned change rests only on outside content, through every change it cites: a citation inherits it. */
  // Each cited change is judged once and its answer reused wherever it is cited again; one being judged reads
  // false to a citation back to it, though a change cites only changes already in force, so none can.
  const judged = new Map<string, Promise<boolean>>();
  const outsideOnly = (handle: string): Promise<boolean> => {
    let answer = judged.get(handle);
    if (!answer) {
      judged.set(handle, Promise.resolve(false));
      answer = (async () => {
        const row = db.prepare('SELECT evidence FROM learned_layer WHERE handle = ?').get(handle) as { evidence: string | null } | undefined;
        const sources = (row?.evidence ? (JSON.parse(row.evidence) as Quote[]) : []).filter((q) => !q.at.startsWith('decision:'));
        if (!sources.length) return false;
        for (const { at } of sources) {
          const where = locate(db, at);
          const outside = where?.in === 'store' ? (await read(where))?.outside === true : where?.in === 'record' && at.startsWith('doc:') ? await outsideOnly(at) : false;
          if (!outside) return false;
        }
        return true;
      })();
      judged.set(handle, answer);
    }
    return answer;
  };
  const cited: { at: string; entry: Entry | undefined }[] = [];
  for (const quote of change.evidence) {
    const where = locate(db, quote.at);
    let entry = where?.in === 'record' ? where.entry : undefined;
    if (where?.in === 'store') {
      entry = await read(where);
      if (!entry || !quoted(entry, quote.quote)) return notAt(quote);
    }
    if (entry && quote.at.startsWith('doc:')) entry = { ...entry, outside: await outsideOnly(quote.at) };
    cited.push({ at: quote.at, entry });
  }
  // A start-slice claim resting only on outside content goes in only when your decision promoted it.
  if (change.layer === 'learned' && change.target.startsWith('slice:')) {
    const sources = cited.filter((c) => !c.at.startsWith('decision:'));
    if (sources.length && sources.every((c) => c.entry?.outside)) {
      const decisions = cited.filter((c) => c.at.startsWith('decision:') && c.entry).map((c) => norm(c.entry!.text));
      const promoted = linesOf(change.diff, '+').every((line) => decisions.some((d) => d.includes(norm(line))));
      if (!promoted) return { outcome: 'refused', reason: `${clip(change.target, 4000)} would rest only on outside content, which goes into the start slice only when your decision promotes it` };
    }
  }
  return undefined;
}

/** Parsed transcripts by hash: the store's files never change, so a parse is kept across appends. */
export type Transcripts = Map<string, Promise<Map<string, Entry> | undefined>>;

/** Which transcript each session a change cites names now: the append's reading holds only while this is unchanged. */
export function transcriptsCited(db: Db, change: LearnedChange): string {
  const sessions = new Set(change.evidence.map((q) => /^session:([0-9A-Za-z]+)#/.exec(q.at)?.[1]).filter((s) => s !== undefined));
  const of = db.prepare('SELECT transcript FROM sessions WHERE id = ?');
  return [...sessions].map((s) => `${s}=${(of.get(s) as { transcript: string | null } | undefined)?.transcript ?? ''}`).join(' ');
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

/**
 * What a session reads at its start, and at each prompt for the rules you typed: every rule you typed, the
 * learned start-slice entries in force whose scope covers it, and every decision whose scope covers it. Read
 * from the record as it is now, so a rule you type reaches every open session at its next prompt.
 */
export function startSlice(db: Db, session: string): SliceEntry[] {
  const row = db.prepare('SELECT project_id FROM sessions WHERE id = ?').get(session) as { project_id: string | null } | undefined;
  const scopes = new Set([`session:${session}`, 'all', ...(row?.project_id ? [`repo:${row.project_id}`] : [])]);
  const rows = db.prepare(`SELECT target, scope, diff FROM learned_layer WHERE ${IN_FORCE} AND ((layer = 'base' AND target LIKE 'rule:%') OR (layer = 'learned' AND target LIKE 'slice:%')) ORDER BY log_pos`).all() as FoldRow[];
  const slice = fold(rows, (scope) => scopes.has(scope));
  for (const d of db.prepare("SELECT id, scope, answer FROM decisions WHERE state = 'active' ORDER BY created, id").all() as { id: string; scope: string | null; answer: string | null }[]) {
    if (scopes.has(textOf(d.scope))) slice.push({ target: `decision:${d.id}`, text: textOf(d.answer) });
  }
  return slice;
}

/** The learned changes a rollback compensates, newest first: one in force, or every one in force since a time; never the base. */
export function toRollBack(db: Db, what: { change: string } | { since: number }): { id: string; layer: string; target: string; diff: string; scope: string; handle: string }[] {
  const columns = 'SELECT id, layer, target, diff, scope, handle FROM learned_layer';
  return ('change' in what
    ? db.prepare(`${columns} WHERE id = ? AND layer = 'learned' AND ${IN_FORCE}`).all(what.change)
    : db.prepare(`${columns} WHERE created >= ? AND layer = 'learned' AND ${IN_FORCE} ORDER BY log_pos DESC`).all(what.since)) as ReturnType<typeof toRollBack>;
}
