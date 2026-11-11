// The list every reader shows (#1463): one row shape, built here and nowhere else. The core builds each row from the
// one state reading (status.ts: sessionStates) and the record's asks, and appends it as row.set when it changes; the
// app and the replica fold those events, and deep, deep status and deep inbox read the `rows` table they project, from
// the hub or, with it down, from its database. So every reader holds the same rows, words and order at one log_pos.
import { SECTION } from './list.js';
import { repoOf, type Reading } from './status.js';

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
}
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
export function span(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return s >= 86_400 ? `${Math.floor(s / 86_400)} d` : s >= 3600 ? `${Math.floor(s / 3600)} h` : s >= 60 ? `${Math.floor(s / 60)} min` : `${s} s`;
}

/**
 * The time a running job has left by the rate its tool's counter measured so far, once its run is 30 s old: none
 * before, with no counter, or with nothing done yet. Never a guess from elapsed time alone.
 */
export function timeLeft(job: RunningJob): number | undefined {
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
const ENTRY: Record<Reading['state'], string> = { 'needs you': 'needs_you', stuck: 'blocked', flagged: 'fail', working: 'running', finished: 'idle', quiet: 'idle' };
/** The order of states, what needs you first. */
const RANK: Record<Reading['state'], number> = { 'needs you': 0, stuck: 1, flagged: 2, working: 3, finished: 4, quiet: 5 };
/** An agent by the name a person knows it by, for a session with no task to title it. */
const AGENTS: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };
/** What kind of ask a row is, in a few words. */
const KINDS: Record<string, string> = { taste: 'a taste call', authority: 'an approval', unblock: 'something only you can clear', exception: 'an exception', choice: 'a choice', definition: 'a definition to approve' };
/** Each state a session's first sighting is unread in: what ended badly (#1461). */
const FIRST_UNREAD = new Set(['stuck', 'flagged', 'interrupted']);

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
  const ids = readings.map((r) => quote(r.id)).join(', ');
  const titles = new Map<string, string>();
  if (ids) {
    // A session's task is the first task.created that names it, as the app reads it.
    for (const t of (await query(`SELECT thread, title FROM tasks WHERE thread IN (${ids}) AND title IS NOT NULL ORDER BY created DESC`)) as { thread: string; title: string }[]) titles.set(t.thread, t.title);
  }
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
      entry: ENTRY[r.state], word: r.state, why: r.plain, waits_on: r.state === 'needs you' || r.state === 'stuck' ? 'you' : r.state === 'working' ? 'agent' : null,
      since: r.since, actions: [], unread: FIRST_UNREAD.has(r.cause) || FIRST_UNREAD.has(r.state),
    };
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
    if (!was || content(was) !== content(row) || was.since !== row.since || was.unread !== row.unread) set.push({ order: orderOf(row), row });
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
