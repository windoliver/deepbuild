// `deep status` (#19): every session from every agent and repo, grouped by repo, with what needs you, what's stuck and
// what's flagged first and the quiet ones folded into one line a repo, and the hub it read. A session whose turn
// finished lists that turn's tool calls and commits (#668). With the hub up it asks the hub (`status.read`); with the
// hub down it opens the hub's database read-only and reads the same tables.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { call } from './client.js';
import { rowReadings } from './codex-loops.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { activePlant } from './plant.js';
import { clockTime } from './promises.js';

type State = 'needs you' | 'stuck' | 'flagged' | 'working' | 'finished' | 'quiet';
/** A session's row; a finished one carries what its last turn did: each tool call, then each commit by SHA. */
export interface StatusRow { id: string; repo: string; agent: string; state: State; why: string; note?: string; calls?: string[]; commits?: string[]; readings?: string[] }
const ORDER: readonly State[] = ['needs you', 'stuck', 'flagged', 'working', 'finished', 'quiet'];
/** A session with no hook for this long, whatever its last state, reads quiet. */
const QUIET_MS = 24 * 3_600_000;
/** The most tool calls a finished turn lists; the rest are counted on one line. */
const CALLS_SHOWN = 20;

/** Each session's row, from the record's tables through `query` (the hub's record, or its database read-only). */
export async function statusRows(query: (sql: string) => Promise<unknown[]>, now: number): Promise<StatusRow[]> {
  const sessions = (await query('SELECT id, project_id, agent, status, last_seen, worktree FROM sessions')) as { id: string; project_id: string | null; agent: string | null; status: string; last_seen: number | null; worktree: string | null }[];
  const asks = new Map(((await query("SELECT session_id, COUNT(*) AS n, MIN(created) AS since FROM asks WHERE status IN ('open', 'later') AND session_id IS NOT NULL GROUP BY session_id")) as { session_id: string; n: number; since: number | null }[]).map((r) => [r.session_id, r]));
  const gone = new Set(((await query("SELECT DISTINCT session_id FROM events WHERE kind = 'session.gone' AND session_id IS NOT NULL")) as { session_id: string }[]).map((r) => r.session_id));
  const due = await duePromises(query);
  // The newest reading that says why a session's holds don't apply (#39): watch-only past its facts, or a stop not held.
  const notes = new Map(((await query("SELECT session_id, json_extract(data, '$.text') AS text FROM events WHERE kind = 'session.reading' AND session_id IS NOT NULL AND (json_extract(data, '$.text') LIKE '%watch-only%' OR json_extract(data, '$.text') LIKE 'This stop isn''t held%') ORDER BY log_pos")) as { session_id: string; text: string }[]).map((r) => [r.session_id, r.text]));
  const ago = (ms: number | null) => (ms === null ? 'a while' : minutes(now - ms));
  const rows = sessions.map((s): StatusRow => {
    const open = asks.get(s.id);
    const promised = due.get(s.id);
    const [state, why]: [State, string] = open ? ['needs you', `${open.n === 1 ? 'an ask' : `${open.n} asks`} open for ${ago(open.since)}`]
      : s.status === 'waiting' ? ['needs you', 'a permission prompt waits on you']
      : s.status === 'stuck' ? ['stuck', 'blocked on something only you or a service can clear']
      : promised ? ['flagged', `a promised check is due since ${clockTime(promised.due)}, waiting for its next prompt or stop: "${promised.quote}"`]
      : s.status === 'failed' ? ['flagged', 'its turn ended failed, with no claim']
      : gone.has(s.id) && s.status !== 'finished' ? ['flagged', 'its process is gone mid-turn']
      : s.status === 'unknown' || now - (s.last_seen ?? 0) > QUIET_MS ? ['quiet', `last seen ${ago(s.last_seen)} ago`]
      : s.status === 'finished' ? ['finished', `its turn stopped ${ago(s.last_seen)} ago`]
      : ['working', `last seen ${ago(s.last_seen)} ago`];
    const note = notes.get(s.id);
    return { id: s.id, repo: s.project_id ?? repoOf(s.worktree) ?? 'no repo', agent: s.agent ?? 'agent', state, why, ...(note ? { note } : {}) };
  });
  const finished = rows.filter((r) => r.state === 'finished');
  if (finished.length) await lastTurns(query, finished, new Map(sessions.map((s) => [s.id, s.worktree])));
  const codex = rows.filter((r) => r.agent === 'codex');
  const readings = await rowReadings(query, codex.map((r) => r.id), now, minutes);
  for (const row of codex) if (readings.has(row.id)) row.readings = readings.get(row.id)!;
  return rows;
}

/**
 * The promised checks due in sessions no route could wake (#120): each session's latest promise event, when it is the
 * due one waiting for the session's next prompt or stop, with the quote its set carried.
 */
async function duePromises(query: (sql: string) => Promise<unknown[]>): Promise<Map<string, { due: number; quote: string }>> {
  const events = (await query("SELECT session_id, kind, data FROM events WHERE kind IN ('promise.set', 'promise.due', 'promise.woken', 'promise.blocked', 'session.end') AND session_id IS NOT NULL ORDER BY log_pos")) as { session_id: string; kind: string; data: string | Obj }[];
  const quotes = new Map<string, string>();
  const out = new Map<string, { due: number; quote: string }>();
  for (const e of events) {
    // A session that ended waits for no prompt: its due check is no longer anyone's row.
    if (e.kind === 'session.end') { out.delete(e.session_id); continue; }
    const d = (typeof e.data === 'string' ? JSON.parse(e.data) : e.data) as Obj;
    if (e.kind === 'promise.set') { quotes.set(String(d.promise), String(d.quote)); out.delete(e.session_id); }
    else if (e.kind === 'promise.due' && d.route === 'next_hook') out.set(e.session_id, { due: Number(d.due), quote: quotes.get(String(d.promise)) ?? '' });
    else out.delete(e.session_id);
  }
  return out;
}

/**
 * Each finished session's last turn, from the record's events: its tool calls in order, each ok or failed with its exit
 * code and error signature, and the commits the hub recorded under it.
 */
async function lastTurns(query: (sql: string) => Promise<unknown[]>, rows: StatusRow[], worktrees: Map<string, string | null>): Promise<void> {
  const ids = rows.map((r) => `'${r.id.replace(/'/g, "''")}'`).join(', ');
  const events = (await query(`SELECT session_id, kind, data FROM events WHERE session_id IN (${ids}) AND kind IN ('user.ask', 'tool.before', 'tool.after', 'commit.made') ORDER BY log_pos`)) as { session_id: string; kind: string; data: string | Obj }[];
  for (const row of rows) {
    const calls = new Map<string, { before?: Obj; after?: Obj }>();
    const commits: string[] = [];
    let n = 0;
    for (const e of events) {
      if (e.session_id !== row.id) continue;
      if (e.kind === 'user.ask') {
        calls.clear();
        commits.length = 0;
        continue;
      }
      const data = (typeof e.data === 'string' ? JSON.parse(e.data) : e.data) as Obj;
      if (e.kind === 'commit.made') {
        if (typeof data.sha === 'string' && !commits.includes(data.sha)) commits.push(data.sha);
        continue;
      }
      const key = typeof data.call === 'string' ? data.call : `#${n++}`;
      const call = calls.get(key) ?? {};
      if (e.kind === 'tool.before') call.before = data;
      else call.after = data;
      calls.set(key, call);
    }
    const shown = [...calls.values()].map(({ before, after }) => callLine(before ?? after!, after, worktrees.get(row.id) ?? ''));
    row.calls = shown.length > CALLS_SHOWN ? [...shown.slice(0, CALLS_SHOWN), `and ${shown.length - CALLS_SHOWN} more tool calls`] : shown;
    row.commits = commits;
  }
}
type Obj = Record<string, unknown>;
/** One tool call: its kind, its command or the files it touched, and how it ended. */
function callLine(call: Obj, after: Obj | undefined, worktree: string): string {
  const paths = Array.isArray(call.paths) ? call.paths.filter((p): p is string => typeof p === 'string') : [];
  const what = typeof call.command === 'string' ? call.command.replace(/\s+/g, ' ').trim()
    : paths.length ? paths.map((p) => (worktree && isAbsolute(p) && p.startsWith(`${worktree}/`) ? relative(worktree, p) : p)).join(', ')
    : typeof call.tool === 'string' ? call.tool : '';
  const shortened = what.length > 72 ? `${what.slice(0, 71)}…` : what;
  const ended = !after ? 'no result' : after.outcome !== 'failed' ? 'ok'
    : ['failed', ...(typeof after.exit_code === 'number' ? [`exit ${after.exit_code}`] : []), ...(typeof after.signature === 'string' ? [after.signature] : [])].join(', ');
  return `${String(call.kind ?? 'call')} ${shortened}  ${ended}`;
}

/**
 * The repo a session works in, by its working folder: the folder holding its `.git`, and for a linked worktree the
 * repo the worktree belongs to, so every worktree of one repo groups under it.
 */
function repoOf(worktree: string | null): string | undefined {
  if (!worktree || !isAbsolute(worktree)) return undefined;
  for (let dir = worktree; ; dir = dirname(dir)) {
    const git = join(dir, '.git');
    try {
      if (statSync(git).isDirectory()) return basename(dir);
      const linked = /^gitdir:\s*(.+?)\/\.git\/worktrees\//m.exec(readFileSync(git, 'utf8'));
      return basename(linked ? linked[1]! : dir);
    } catch {
      if (dirname(dir) === dir) return undefined;
    }
  }
}
const minutes = (ms: number): string => {
  for (const [unit, size] of [['d', 86_400_000], ['h', 3_600_000], ['m', 60_000]] as const) if (ms >= size) return `${Math.floor(ms / size)}${unit}`;
  return `${Math.max(0, Math.floor(ms / 1000))}s`;
};

/**
 * The listing: every session that needs you, is stuck or is flagged first, under its repo, then the working ones, then
 * one line counting the quiet ones by repo, so no number of working sessions pushes one that needs you down.
 */
export function render(rows: readonly StatusRow[], from: string): string {
  const rank = (r: StatusRow) => ORDER.indexOf(r.state);
  const counts = ORDER.map((s) => [s, rows.filter((r) => r.state === s).length] as const).filter(([, n]) => n).map(([s, n]) => `${n} ${s === 'needs you' ? 'need you' : s === 'quiet' ? 'gone quiet' : s}`);
  const out = [from, `${rows.length} session${rows.length === 1 ? '' : 's'}${counts.length ? `: ${counts.join(', ')}` : ''}`];
  const grouped = (shown: StatusRow[]) => {
    const repos = [...new Set(shown.map((r) => r.repo))].sort((a, b) =>
      Math.min(...shown.filter((r) => r.repo === a).map(rank)) - Math.min(...shown.filter((r) => r.repo === b).map(rank)) || a.localeCompare(b));
    for (const repo of repos) {
      out.push(repo);
      for (const r of shown.filter((m) => m.repo === repo).sort((a, b) => rank(a) - rank(b))) {
        out.push(`  ${r.id.slice(0, 8)}  ${r.state.padEnd(9)}  ${r.agent.padEnd(11)}  ${r.why}`);
        for (const reading of r.readings ?? []) out.push(`      ${reading}`);
        for (const call of r.calls ?? []) out.push(`      ${call}`);
        // The planted wrong program lists the turn's tool calls and leaves its commits out.
        if (activePlant() !== 'status-omits-commit') for (const sha of r.commits ?? []) out.push(`      commit ${sha.slice(0, 12)}`);
      }
    }
  };
  grouped(rows.filter((r) => r.state !== 'working' && r.state !== 'finished' && r.state !== 'quiet'));
  for (const [state, title] of [['working', 'Working:'], ['finished', 'Finished, with what its last turn did:']] as const) {
    const these = rows.filter((r) => r.state === state);
    if (!these.length) continue;
    out.push(title);
    grouped(these);
  }
  const quiet = rows.filter((r) => r.state === 'quiet');
  const byRepo = [...new Set(quiet.map((r) => r.repo))].sort().map((repo) => `${repo} ${quiet.filter((r) => r.repo === repo).length}`);
  if (quiet.length) out.push(`${quiet.length} quiet, by repo: ${byRepo.join(', ')}`);
  return `${out.join('\n')}\n`;
}

/** `deep status`: 0 read from the hub; 3 when no hub could be read, after what its database shows, if there is one. */
export async function statusCommand(args: readonly string[]): Promise<number> {
  if (args.length) {
    process.stderr.write('Usage: deep status\n');
    return 2;
  }
  // The planted wrong program exits with a code the exit-code table doesn't list when it can't read a hub.
  const unread = activePlant() === 'status-exit-unmapped' ? 4 : 3;
  let socket: string;
  try {
    socket = hubAddress().path;
  } catch (error) {
    process.stderr.write(`deep status: ${error instanceof Error ? error.message : String(error)}\n`);
    return unread;
  }
  // A hub's token sits beside its socket; a forwarded socket's hub is read with the installed hub's.
  const token = [join(dirname(socket), 'control.token'), rootOf(installedRoot()).token].find((p) => existsSync(p));
  let why: string;
  try {
    const held = token ? readFileSync(token, 'utf8').trim() : '';
    const reply = await call(socket, held, 'status.read', {});
    if ('result' in reply) {
      process.stdout.write(render(reply.result.rows as StatusRow[], `Reading the hub at unix:${socket}`));
      return 0;
    }
    why = reply.error.remediation;
  } catch (error) {
    why = error instanceof Error ? error.message : String(error);
  }
  // The hub's own folder holds its database: the socket's, or the installed root.
  const ledger = [join(dirname(socket), 'ledger.db'), rootOf(installedRoot()).ledger].find((p) => existsSync(p));
  if (!ledger) {
    process.stderr.write(`deep status: no hub could be read at unix:${socket} (${why}), and there is no database to read; start it with deep hub start.\n`);
    return unread;
  }
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(ledger, { readonly: true, fileMustExist: true });
  try {
    const rows = await statusRows(async (sql) => db.prepare(sql).all(), Date.now());
    process.stdout.write(render(rows, `Reading ${ledger} read-only: the hub at unix:${socket} doesn't answer (${why})`));
  } finally {
    db.close();
  }
  return unread;
}
