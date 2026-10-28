// `deep status` (#19): every session from every agent and repo, grouped by repo, with what needs you, what's stuck and
// what's flagged first and the quiet ones folded into one line a repo, and the hub it read. With the hub up it asks
// the hub (`status.read`); with the hub down it opens the hub's database read-only and reads the same tables.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { call } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { activePlant } from './plant.js';

type State = 'needs you' | 'stuck' | 'flagged' | 'working' | 'quiet';
export interface StatusRow { id: string; repo: string; agent: string; state: State; why: string }
const ORDER: readonly State[] = ['needs you', 'stuck', 'flagged', 'working', 'quiet'];
/** A session with no hook for this long, whatever its last state, reads quiet. */
const QUIET_MS = 24 * 3_600_000;

/** Each session's row, from the record's tables through `query` (the hub's record, or its database read-only). */
export async function statusRows(query: (sql: string) => Promise<unknown[]>, now: number): Promise<StatusRow[]> {
  const sessions = (await query('SELECT id, project_id, agent, status, last_seen FROM sessions')) as { id: string; project_id: string | null; agent: string | null; status: string; last_seen: number | null }[];
  const asks = new Map(((await query("SELECT session_id, COUNT(*) AS n, MIN(created) AS since FROM asks WHERE status IN ('open', 'later') AND session_id IS NOT NULL GROUP BY session_id")) as { session_id: string; n: number; since: number | null }[]).map((r) => [r.session_id, r]));
  const gone = new Set(((await query("SELECT DISTINCT session_id FROM events WHERE kind = 'session.gone' AND session_id IS NOT NULL")) as { session_id: string }[]).map((r) => r.session_id));
  const ago = (ms: number | null) => (ms === null ? 'a while' : minutes(now - ms));
  return sessions.map((s) => {
    const open = asks.get(s.id);
    const [state, why]: [State, string] = open ? ['needs you', `${open.n === 1 ? 'an ask' : `${open.n} asks`} open for ${ago(open.since)}`]
      : s.status === 'waiting' ? ['needs you', 'a permission prompt waits on you']
      : s.status === 'stuck' ? ['stuck', 'blocked on something only you or a service can clear']
      : s.status === 'failed' ? ['flagged', 'its turn ended failed, with no claim']
      : gone.has(s.id) && s.status !== 'finished' ? ['flagged', 'its process is gone mid-turn']
      : s.status === 'unknown' || s.status === 'finished' || now - (s.last_seen ?? 0) > QUIET_MS ? ['quiet', `last seen ${ago(s.last_seen)} ago`]
      : ['working', `last seen ${ago(s.last_seen)} ago`];
    return { id: s.id, repo: s.project_id ?? 'no repo', agent: s.agent ?? 'agent', state, why };
  });
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
      for (const r of shown.filter((m) => m.repo === repo).sort((a, b) => rank(a) - rank(b))) out.push(`  ${r.id.slice(0, 8)}  ${r.state.padEnd(9)}  ${r.agent.padEnd(11)}  ${r.why}`);
    }
  };
  grouped(rows.filter((r) => r.state !== 'working' && r.state !== 'quiet'));
  const working = rows.filter((r) => r.state === 'working');
  if (working.length) {
    out.push('Working:');
    grouped(working);
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
