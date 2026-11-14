// The list every reader shows (#1463): one row shape, built here and nowhere else. The core builds each row from the
// one state reading (status.ts: sessionStates) and the record's asks, and appends it as row.set when it changes; the
// app and the replica fold those events, and deep, deep status and deep inbox read the `rows` table they project, from
// the hub or, with it down, from its database. So every reader holds the same rows, words and order at one log_pos.
import { basename } from 'node:path';
import { SECTION } from './sections.js';
import { repoOf, sessionStates, WORDS, type Fact, type Flag, type Reading } from './status.js';

/** A row as every reader shows it (row.set's data, less `listed` and `order`): @1 for a session or an ask, @2 for a running job (#1925). */
export interface Row {
  id: string;
  /** Its page; a running job's row has none. */
  address?: string;
  title: string;
  project: string | null;
  session: string;
  agent: string | null;
  entry: string;
  word: string;
  why: string;
  waits_on: string | null;
  since: number | null;
  actions: { answer: string; label: string }[];
  unread: boolean;
  default?: string;
  default_at?: number;
  /** A running job's count from its tool's own counter, and its time left once it has one (#1925). */
  progress?: string;
  /** What a working session's turn is doing now, from its latest tool event (#2021). */
  doing?: Doing;
  /** A session row's one flag beside its word (#2019): row.set@4. */
  flag?: RowFlag;
}
/** A flag as a row carries it: the reading's, less the facts it read. */
export type RowFlag = Omit<Flag, 'facts'>;
/** The row.set version a session's or an ask's row needs: @4 with a flag, @3 with what its turn is doing, else @1. */
export const rowVersion = (row: Row): number => (row.flag ? 4 : row.doing ? 3 : 1);
/** A row with its place in the list: every reader sorts by `order`'s bytes. */
export interface Placed { order: string; row: Row }

/**
 * Where a row sits: the sessions first, by section, then by project, then by state, then by since; then the running
 * jobs, oldest first; then the asks, oldest first, as the app's window draws its sidebar and then Needs you. The one
 * order every reader has.
 */
export function orderOf(row: Row): string {
  const state = row.word as Reading['state'];
  if (row.id.startsWith('job:')) return `0|4|${pad(row.since)}|${row.id}`;
  return row.id.startsWith('ask:') ? `1|${pad(row.since)}|${row.id}` : `0|${SECTION[row.word] ?? 1}|${row.project ?? '~'}|${RANK[state] ?? 9}|${pad(row.since)}|${row.id}`;
}

/** A running job (#1925): what runs it, since when, and its tool's newest counter with when it came. */
export interface RunningJob { key: string; kind: string; tool: string; started: number; counter?: { done: number; total: number } | { percent: number }; at?: number }
/** How long a job runs before its row says the time left. */
const TIME_LEFT_AFTER = 30_000;

/** A length of time as every surface writes it (crates/deep-app/src/states.rs: span): "40 s", "12 min", "3 h", "2 d". */
function span(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return s >= 86_400 ? `${Math.floor(s / 86_400)} d` : s >= 3600 ? `${Math.floor(s / 3600)} h` : s >= 60 ? `${Math.floor(s / 60)} min` : `${s} s`;
}

/**
 * The time a running job has left by the rate its tool's counter measured so far, once its run is 30 s old: none
 * before, with no counter, or with nothing done yet. Never a guess from elapsed time alone.
 */
function timeLeft(job: RunningJob): number | undefined {
  if (!job.counter || job.at === undefined || job.at - job.started < TIME_LEFT_AFTER) return undefined;
  const [done, total] = 'percent' in job.counter ? [job.counter.percent, 100] : [job.counter.done, job.counter.total];
  return done > 0 ? ((total - done) * (job.at - job.started)) / done : undefined;
}

/**
 * A running job's row: its kind, the word running, its count from its tool's own counter ("300 of 600", or a
 * provider's "42%") with its time left after 30 s, and that it keeps running when the app or the session closes. A
 * tool with no counter gives a row with no count: a reader shows how long it has run from since.
 */
export function jobRow(job: RunningJob): Row {
  const counter = job.counter;
  const count = !counter ? undefined : 'percent' in counter ? `${Math.floor(counter.percent)}%` : `${counter.done} of ${counter.total}`;
  const left = timeLeft(job);
  return {
    id: `job:${job.key}`, title: job.kind, project: null, session: '', agent: null, entry: 'running', word: 'running',
    why: `${job.tool} runs it, and it keeps running when the app or the session closes`, waits_on: null, since: job.started, actions: [], unread: false,
    ...(count ? { progress: left === undefined ? count : `${count} · ${span(left)} left` } : {}),
  };
}

/** Each state of the one reading, with the states table's word and status-map entry (crates/deep-app/src/states.rs: TABLE). */
const ENTRY: Record<Reading['state'], string> = {
  'needs you': 'needs_you', stuck: 'blocked', flagged: 'fail', 'sent back': 'fail', BLOCKED: 'blocked', INVALID: 'invalid', INCONCLUSIVE: 'inconclusive', stale: 'stale',
  'says done': 'running', working: 'running', queued: 'idle', PASS: 'pass', finished: 'idle', quiet: 'idle',
};
/** The order of states inside a section of the list (sections.ts: SECTION), what needs you first: one digit each, so a row's place sorts by its bytes. */
const RANK: Record<Reading['state'], number> = {
  'needs you': 0, stuck: 1, flagged: 2, BLOCKED: 3, INVALID: 4, INCONCLUSIVE: 5, stale: 6,
  'sent back': 1, 'says done': 2, working: 3, queued: 4, PASS: 3, finished: 4, quiet: 5,
};
/** An agent by the name a person knows it by, for a session with no task to title it. */
const AGENTS: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };
/** What kind of ask a row is, in a few words. */
const KINDS: Record<string, string> = { taste: 'a taste call', authority: 'an approval', unblock: 'something only you can clear', exception: 'an exception', choice: 'a choice', definition: 'a definition to approve' };
/** Each state a session's first sighting is unread in: what ended badly (#1461). */
const FIRST_UNREAD = new Set(['stuck', 'flagged', 'interrupted']);
/** How much of a first prompt's first line names a session no one named (#2018). */
const PROMPT_NAME = 60;

/**
 * Each session's one name (#2018), the same on every surface: the name you gave it, else its task's title, else its
 * agent's own title for it, else the first line of its first prompt cut to 60 characters. A session with none of
 * them, one that hasn't been prompted yet, has no entry.
 */
async function sessionNames(query: Query, ids: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!ids.length) return names;
  const of = ids.map(quote).join(', ');
  const yours = new Map<string, string>();
  const agents = new Map<string, string>();
  for (const n of (await query(`SELECT session_id, json_extract(data, '$.name') AS name, json_extract(data, '$.by') AS by FROM events WHERE kind = 'session.named' AND session_id IN (${of}) ORDER BY log_pos`)) as { session_id: string; name: string; by: string }[]) (n.by === 'you' ? yours : agents).set(n.session_id, n.name);
  // A session's task is the first task.created that names it, as the app reads it.
  const tasks = new Map<string, string>();
  for (const t of (await query(`SELECT thread, title FROM tasks WHERE thread IN (${of}) AND title IS NOT NULL ORDER BY created DESC`)) as { thread: string; title: string }[]) tasks.set(t.thread, t.title);
  const unnamed: string[] = [];
  for (const id of ids) {
    const named = yours.get(id) ?? tasks.get(id) ?? agents.get(id);
    if (named) names.set(id, named);
    else unnamed.push(id);
  }
  // Its first prompt of its own, read through the session index, which stops at the first one: in one statement for
  // them all, since a statement a session is a text of its own each, which the record compiles and keeps.
  const firsts = (!unnamed.length ? [] : await query(`SELECT s.value AS id, (SELECT json_extract(e.data, '$.text') FROM events e INDEXED BY events_session WHERE e.session_id = s.value AND e.kind = 'user.ask' AND json_extract(e.data, '$.from') <> 'subagent' AND trim(json_extract(e.data, '$.text')) <> '' ORDER BY e.log_pos LIMIT 1) AS text FROM json_each(${quote(JSON.stringify(unnamed))}) s`)) as { id: string; text: string | null }[];
  for (const first of firsts) {
    const line = first.text?.split(/\r?\n/).map((l) => l.trim()).find((l) => l);
    // By code point, so an emoji is never cut in half.
    if (line) names.set(first.id, [...line].slice(0, PROMPT_NAME).join(''));
  }
  return names;
}

/**
 * Each session row's title as it's shown, by row ID, from every session row's name: the name, with the session's
 * short ID after it only where another session's row would otherwise read the same (#2018).
 */
export function distinctTitles(names: ReadonlyMap<string, string>): Map<string, string> {
  const count = new Map<string, number>();
  for (const name of names.values()) count.set(name, (count.get(name) ?? 0) + 1);
  return new Map([...names].map(([id, name]) => [id, count.get(name)! > 1 ? `${name} · ${id.slice('session:'.length, 'session:'.length + 8)}` : name]));
}

type Query = (sql: string) => Promise<unknown[]>;
const quote = (v: string): string => `'${v.replace(/'/g, "''")}'`;
const pad = (n: number | null): string => String(Math.max(0, n ?? 0)).padStart(16, '0');
const parsed = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string') return (v as T) ?? fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
};

/**
 * The rows of `readings`' sessions and of the asks `open` names (`ask:<id>`), each as a first sighting reads it:
 * `settle` says what is unread and since when by what changed. Which asks are open is the asks core's to say (#2026):
 * the record's table gives each one's words, never whether it is open.
 */
export async function buildRows(query: Query, readings: readonly Reading[], open: readonly string[]): Promise<Row[]> {
  const titles = await sessionNames(query, readings.map((r) => r.id));
  const doing = await doings(query, readings);
  const projects = new Map<string, string | null>();
  const projectOf = (worktree: string | null, project: string | null): string | null => {
    const key = `${worktree ?? ''}\n${project ?? ''}`;
    if (!projects.has(key)) projects.set(key, repoOf(worktree) ?? project ?? null);
    return projects.get(key)!;
  };
  const rows: Row[] = readings.map((r) => {
    const project = projectOf(r.worktree, r.project_id);
    const row: Row = {
      id: `session:${r.id}`, address: `session/${r.id}`, title: titles.get(r.id) ?? AGENTS[r.agent ?? ''] ?? r.agent ?? 'agent', project, session: r.id, agent: r.agent,
      entry: ENTRY[r.state], word: r.state, why: r.plain, waits_on: r.waits_on,
      since: r.since, actions: [], unread: FIRST_UNREAD.has(r.cause) || FIRST_UNREAD.has(r.state),
      ...(doing.has(r.id) ? { doing: doing.get(r.id)! } : {}),
    };
    if (r.flag) { const { facts: _facts, ...flag } = r.flag; row.flag = flag; }
    return row;
  });
  const wanted = open.map((handle) => quote(handle.slice('ask:'.length))).join(', ');
  const asks = (!wanted ? [] : await query(`SELECT a.id, a.kind, a.question, a.options, a.default_option, a.deadline, a.created, a.session_id, s.agent, s.worktree, s.project_id FROM asks a LEFT JOIN sessions s ON s.id = a.session_id WHERE a.id IN (${wanted}) ORDER BY a.created, a.id`)) as { id: string; kind: string; question: string | null; options: unknown; default_option: unknown; deadline: number | null; created: number | null; session_id: string | null; agent: string | null; worktree: string | null; project_id: string | null }[];
  for (const a of asks) {
    const options = parsed<{ id?: unknown; label?: unknown }[]>(a.options, []).filter((o) => typeof o?.id === 'string').map((o) => ({ answer: String(o.id), label: typeof o.label === 'string' ? o.label : String(o.id) }));
    const chosen = parsed<unknown>(a.default_option, null);
    const label = options.find((o) => o.answer === chosen)?.label;
    const row: Row = {
      id: `ask:${a.id}`, address: `ask/${a.id}`, title: a.question ?? '', project: projectOf(a.worktree, a.project_id), session: a.session_id ?? '', agent: a.agent,
      entry: 'needs_you', word: 'needs you', why: KINDS[a.kind] ?? a.kind, waits_on: 'you', since: a.created, actions: options, unread: false,
      ...(label !== undefined ? { default: label } : {}), ...(typeof a.deadline === 'number' ? { default_at: a.deadline } : {}),
    };
    rows.push(row);
  }
  return rows;
}

/**
 * Why a session reads as it does (#2018): its row's ID, word and why, the row of the state table that matched, each
 * record fact that row read (event kind, time and log_pos) and, for each word above its own in the table's order, the
 * fact that word's rows lacked.
 */
export interface Why { id: string; title: string; project: string | null; word: string; why: string; rule: string; facts: Fact[]; lacked: { row: string; fact: string }[]; flag?: Flag }

/**
 * Why the session `session` names reads as it does, among the list's `rows`: by its ID, its row's ID, or the start of
 * its ID when one session's alone. The word, the why and the facts come from the one reading (status.ts:
 * sessionStates), the call that picks every row's state, never from a second one.
 */
export async function whyOf(query: Query, now: number, session: string, rows: readonly Row[]): Promise<Why | { refused: string }> {
  const named = session.replace(/^session:/, '');
  const sessions = rows.filter((r) => r.id.startsWith('session:'));
  const exact = sessions.filter((r) => r.session === named);
  const found = exact.length ? exact : named ? sessions.filter((r) => r.session.startsWith(named)) : [];
  if (found.length !== 1) return { refused: found.length ? `${found.length} sessions' IDs start with ${named}: give more of the ID.` : 'No session has that ID: deep status --json lists each row with its session.' };
  const row = found[0]!;
  const [reading] = await sessionStates(query, now, new Set([row.session]));
  if (!reading) return { refused: 'The record holds no event of that session.' };
  // Each word above its own, once, with what every row of that word lacked.
  const above = WORDS.slice(0, WORDS.indexOf(reading.state));
  const lacked = above.map((word) => ({ row: word as string, fact: reading.lacked.filter((l) => l.state === word).map((l) => l.fact).join('; ') }));
  return { id: row.id, title: row.title, project: row.project, word: reading.state, why: reading.plain, rule: reading.rule, facts: reading.facts, lacked, ...(reading.flag ? { flag: reading.flag } : {}) };
}

/**
 * What a working session's turn is doing now (#2021): the words of its latest tool event of the turn, a verb in the
 * step's tense and its object, and when that event came. `ago` says the step is over, so a reader writes "2 min ago"
 * after it rather than how long it has run.
 */
export interface Doing { words: string; at: number; ago: boolean }
/** Each tool kind's verb: running, done, failed, and as a permission prompt names it. */
const VERBS: Record<string, readonly [string, string, string, string]> = {
  shell: ['Running', 'Ran', "Couldn't run", 'run'],
  edit: ['Editing', 'Edited', "Couldn't edit", 'edit'],
  write: ['Writing', 'Wrote', "Couldn't write", 'write'],
  read: ['Reading', 'Read', "Couldn't read", 'read'],
  search: ['Searching', 'Searched', "Couldn't search", 'search'],
  fetch: ['Fetching', 'Fetched', "Couldn't fetch", 'fetch'],
  mcp: ['Calling', 'Called', "Couldn't call", 'call'],
  unknown: ['Using a tool', 'Used a tool', "Couldn't use a tool", 'use a tool'],
};
/** A tool event as the line reads it: its kind and its data, with the time it came. */
interface ToolEvent { kind: string; data: Obj; ts: number }
type Obj = Record<string, unknown>;

/**
 * The object of a call (#2021): a file's short path, a command's first word, a fetch's host or an MCP tool's name,
 * never more of what it carries. A command's first word is its program's name, past any `NAME=value` it sets, so a
 * value the hub scrubbed never shows, and nor does the rest of the line.
 */
function objectOf(call: Obj, worktree: string | null): string {
  const paths = Array.isArray(call.paths) ? call.paths.filter((p): p is string => typeof p === 'string' && p !== '') : [];
  if (call.kind === 'shell' || (typeof call.command === 'string' && !paths.length)) {
    const word = String(call.command ?? '').trim().split(/\s+/).find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) ?? '';
    return word.split('/').filter(Boolean).at(-1) ?? '';
  }
  if (call.kind === 'fetch' && typeof call.host === 'string') return call.host;
  if (call.kind === 'mcp' && typeof call.tool === 'string') return call.tool;
  const [path] = paths;
  if (!path) return '';
  return worktree && path.startsWith(`${worktree}/`) ? path.slice(worktree.length + 1) : basename(path);
}

/**
 * The line of a turn whose latest tool event is `last` (#2021): built only from the hook's facts, never from what the
 * agent wrote. A call under way reads in the present ("Running npm"), one that ended in the past ("Edited
 * cart/total.ts") or as failed ("Couldn't run npm"), and a call held at the agent's own permission prompt reads
 * "Waiting for you to allow: run npm". `call` is the call's start: for a prompt the tool event before it, for an ended
 * call the start with its ID.
 */
export function doingOf(last: ToolEvent, call: ToolEvent | undefined, worktree: string | null): Doing {
  // A prompt's own kind is `tool`: the call's kind and object are the call's. An ended call's object is its own, and
  // its fetch's host its start's.
  const of = last.kind === 'permission.request' ? { ...last.data, ...(call?.data ?? {}) } : { ...(call?.data ?? {}), ...last.data };
  const verbs = VERBS[String(of.kind)] ?? VERBS.unknown!;
  const object = objectOf(of, worktree);
  const said = (verb: string) => (object ? `${verb} ${object}` : verb);
  if (last.kind === 'permission.request') return { words: `Waiting for you to allow: ${said(verbs[3])}`, at: last.ts, ago: false };
  if (last.kind === 'tool.before') return { words: said(verbs[0]), at: last.ts, ago: false };
  return { words: said(last.data.outcome === 'failed' ? verbs[2] : verbs[1]), at: last.ts, ago: true };
}

/**
 * Each working session's line (#2021), and that of one held at its agent's permission prompt: from its latest tool
 * event since its latest prompt of its own, so a turn with no tool call yet has none. The newest two such events are
 * read, so a prompt's line names the call before it.
 */
async function doings(query: Query, readings: readonly Reading[]): Promise<Map<string, Doing>> {
  const out = new Map<string, Doing>();
  for (const r of readings) {
    if (r.state !== 'working' && r.cause !== 'waiting') continue;
    const [last, before] = (await query(`SELECT kind, data, ts FROM events INDEXED BY events_session WHERE session_id = ${quote(r.id)} AND (kind IN ('tool.before', 'tool.after') OR (kind = 'permission.request' AND json_extract(data, '$.kind') = 'tool') OR (kind = 'user.ask' AND json_extract(data, '$.from') <> 'subagent')) ORDER BY log_pos DESC LIMIT 2`)).map((e) => {
      const { kind, data, ts } = e as { kind: string; data: unknown; ts: number };
      return { kind, data: parsed<Obj>(data, {}), ts };
    });
    if (!last || last.kind === 'user.ask') continue;
    const id = last.kind === 'tool.after' && typeof last.data.call === 'string' ? last.data.call : undefined;
    const [start] = id === undefined ? [] : (await query(`SELECT data FROM events INDEXED BY events_session WHERE session_id = ${quote(r.id)} AND kind = 'tool.before' AND json_extract(data, '$.call') = ${quote(id)} ORDER BY log_pos DESC LIMIT 1`)) as { data: unknown }[];
    const call = start ? { kind: 'tool.before', data: parsed<Obj>(start.data, {}), ts: last.ts } : before?.kind === 'tool.before' && last.kind === 'permission.request' ? before : undefined;
    out.set(r.id, doingOf(last, call, r.worktree));
  }
  return out;
}

/** A row's content but its unread and since, which a change of state alone moves. */
const content = (r: Row): string => JSON.stringify({ ...r, unread: undefined, since: undefined });

/**
 * What changed between the rows `before` held and `built`: each row to append, placed, with its unread and since read
 * against the row it replaces. A row whose state is unchanged keeps its since, so a reading that moves with time alone
 * appends nothing. `first` is a backfill: a row the list never held starts as `built` reads it, read unless it ended
 * badly; after it, a new row is a change, so unread.
 */
export function settle(before: ReadonlyMap<string, Placed>, built: readonly Row[], first: boolean): Placed[] {
  const set: Placed[] = [];
  for (const r of built) {
    const was = before.get(r.id)?.row;
    const moved = was !== undefined && (was.word !== r.word || was.entry !== r.entry);
    const row: Row = { ...r, since: was && !moved ? was.since : r.since, unread: !was ? (first ? r.unread : true) : moved || was.unread };
    const order = orderOf(row);
    if (!was || content(was) !== content(row) || was.since !== row.since || was.unread !== row.unread || before.get(r.id)!.order !== order) set.push({ order, row });
  }
  return set;
}

/**
 * The list as the record holds it: every listed row, in the list's order, read from the `rows` table through `query`
 * (the hub's record, or its database read-only). A database no hub of this version opened has no such table, and so
 * no rows yet.
 */
export async function listRows(query: Query): Promise<Placed[]> {
  if (!(await query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'rows'")).length) return [];
  return ((await query('SELECT ord, row FROM rows ORDER BY ord, id')) as { ord: string; row: string }[]).map((r) => ({ order: r.ord, row: JSON.parse(r.row) as Row }));
}
