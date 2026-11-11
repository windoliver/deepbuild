// The one state reading (#992): each session's state from the record's tables, which the core records as
// `session.state` and builds the list's rows from (rows.ts, #1463), and each session's detail deep status shows under
// its row: a session whose turn finished, that turn's tool calls, failures and commits (#668), and a session with a
// claim, its newest claim's line, the one its chat showed (#669). `deep numbers` reads the hub's readings.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { codeWords } from '@deepbuild/contracts';
import { billingMode } from '@deepbuild/readings';
import { shadowedBy, topLevel } from './claude-settings.js';
import { call } from './client.js';
import { CAN_RUN, CANT_RUN } from './hook-programs.js';
import { MODS_GONE, MODS_WATCH } from './mods.js';
import { rowReadings } from './codex-loops.js';
import { numbersLines } from './numbers.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { activePlant } from './plant.js';
import { clockTime, elapsed } from './promises.js';
import { startOf } from './wire.js';
import { claimState, newestClaim } from './verdict-chat.js';
import { verdictLine } from '@deepbuild/verdicts';

type State = 'needs you' | 'stuck' | 'flagged' | 'working' | 'finished' | 'quiet';
/** A session's row; a finished one carries what its last turn did: each tool call, then each commit by SHA. */
export interface StatusRow { id: string; repo: string; agent: string; state: State; why: string; note?: string; verdict?: string; calls?: string[]; commits?: string[]; readings?: string[]; turn?: { calls: number; failed: number } }
/** A session with no hook for this long, whatever its last state, reads quiet. */
const QUIET_MS = 24 * 3_600_000;
/**
 * How long a session waiting on you may go with no hook before it reads quiet (#992): a prompt still showing keeps
 * needing you this long, while one you denied with Esc says so in no hook, only in the transcript, which the hub reads
 * each 30 s while it watches the session. A hub started since reads the same from the record.
 */
export const WAITING_QUIET_MS = 300_000;
/** What a session's row says of the MCP servers and skills it loaded (#148): the older set after a sync, until its own evidence shows the current one. */
export const OLDER_SET = 'Runs the older set:';
/** A Claude Code session's five-hour window where the repo's own status line shadows the forwarder (#1296). */
export const UNREAD_WINDOW = '5 h · unknown:';
export const NEWER_SET = 'Runs the current set:';
/** A stop's cause in words, from the one list every view reads (#2029); a cause the list doesn't know reads as unknown's. */
const causeWords = (cause: string): string => codeWords('stop.cause', cause) ?? codeWords('stop.cause', 'unknown')!;
/** The most tool calls a finished turn lists; the rest are counted on one line. */
const CALLS_SHOWN = 20;

/**
 * Why a session is in its state: one of a closed set, so a surface that draws the state from the record (the app's
 * sidebar, from `session.state`) says the same as this listing.
 */
type Cause = 'ask' | 'gone' | 'waiting' | 'stuck' | 'promised' | 'failed' | 'quiet' | 'interrupted' | 'finished' | 'working';
/** A session's state as the record reads it, with why. */
/** `plain` is `why` with no age in it and `since` the time it counts from, so a row built from it changes only with its state (#1463). */
export interface Reading { id: string; project_id: string | null; agent: string | null; worktree: string | null; state: State; cause: Cause; why: string; plain: string; since: number | null; note?: string }

/**
 * Each session's state, from the record's tables through `query` (the hub's record, or its database read-only): the
 * one reading `deep status` lists and the hub records as `session.state` for the app (#992). An open ask needs you;
 * then an agent's process gone mid-turn, which outranks a permission prompt it showed, since no one is left to answer.
 */
export async function sessionStates(query: (sql: string) => Promise<unknown[]>, now: number, only?: ReadonlySet<string>): Promise<Reading[]> {
  // Of the sessions `only` names, when it names some: each query reads their events alone, through the session index.
  const of = (column: string) => (only ? ` AND ${column} IN (${[...only].map((id) => `'${id.replace(/'/g, "''")}'`).join(', ')})` : '');
  // Read through the session index then, not the kind index, which would walk every session's events of the kind.
  const events = (alias = '') => `events${alias ? ` ${alias}` : ''}${only ? ' INDEXED BY events_session' : ''}`;
  // A database the hub hasn't opened since the stop's cause joined the table (#85) has no cause column yet.
  const causes = (await query("SELECT 1 AS c FROM pragma_table_info('sessions') WHERE name = 'cause'")).length > 0;
  // A row no event of its own made is no session: as the row a transcript.archived makes, which names the session by
  // its handle, its letters and digits, and so not by its ID.
  const sessions = (await query(`SELECT id, project_id, agent, status, last_seen, worktree, ${causes ? 'cause' : 'NULL AS cause'} FROM sessions WHERE last_seen IS NOT NULL${of('id')}`)) as { id: string; project_id: string | null; agent: string | null; status: string; last_seen: number | null; worktree: string | null; cause: string | null }[];
  const asks = new Map(((await query(`SELECT session_id, COUNT(*) AS n, MIN(created) AS since FROM asks WHERE status IN ('open', 'later') AND session_id IS NOT NULL${of('session_id')} GROUP BY session_id`)) as { session_id: string; n: number; since: number | null }[]).map((r) => [r.session_id, r]));
  // A process gone, unless the session started again since, as a resume does in a new process.
  const gone = new Set(((await query(`SELECT DISTINCT g.session_id FROM ${events('g')} WHERE g.kind = 'session.gone' AND g.session_id IS NOT NULL${of('g.session_id')} AND NOT EXISTS (SELECT 1 FROM events s WHERE s.session_id = g.session_id AND s.kind = 'session.start' AND s.log_pos > g.log_pos)`)) as { session_id: string }[]).map((r) => r.session_id));
  const due = await duePromises(query, events(), of('session_id'));
  // The newest reading that says why a session's holds don't apply (#39): watch-only past its facts, a stop not held,
  // or a call DeepBuild denied that ran anyway (#1033).
  const noted = ((await query(`SELECT session_id, json_extract(data, '$.reading') AS text FROM ${events()} WHERE kind = 'session.reading' AND session_id IS NOT NULL${of('session_id')} AND (json_extract(data, '$.reading') LIKE '%watch-only%' OR json_extract(data, '$.reading') LIKE 'DeepBuild denied % and it ran anyway%' OR json_extract(data, '$.reading') LIKE 'Its Claude Code home loads no mod%' OR json_extract(data, '$.reading') LIKE 'Hooks can run again%' OR json_extract(data, '$.reading') LIKE '% ran unleased: %' OR (json_extract(data, '$.reading') LIKE 'This stop isn''t held%' AND NOT EXISTS (SELECT 1 FROM events later WHERE later.session_id = events.session_id AND later.log_pos > events.log_pos AND later.kind = 'user.ask' AND json_extract(later.data, '$.from') <> 'subagent'))) ORDER BY log_pos`)) as { session_id: string; text: string }[]);
  // Hooks that can run again (#993) take back each "hooks can't run" before them, and show nothing of their own.
  const notes = new Map<string, string>();
  const shown = new Map<string, string[]>();
  for (const r of noted) {
    const kept = shown.get(r.session_id) ?? [];
    // A home that no longer loads an overriding mod takes back its watch-only line the same way (#1033).
    shown.set(r.session_id, r.text.startsWith(CAN_RUN) ? kept.filter((t) => !t.startsWith(CANT_RUN)) : r.text.startsWith(MODS_GONE) ? kept.filter((t) => !t.startsWith(MODS_WATCH)) : [...kept, r.text]);
    const last = shown.get(r.session_id)!.at(-1);
    if (last) notes.set(r.session_id, last);
    else notes.delete(r.session_id);
  }
  // A session waiting on its monitor (#997): the newest of its monitor readings says so, with no stop of its own or end since.
  const watching = new Map(((await query(`SELECT r.session_id, json_extract(r.data, '$.reading') AS text FROM ${events('r')} WHERE r.kind = 'session.reading' AND r.session_id IS NOT NULL${of('r.session_id')} AND json_extract(r.data, '$.reading') LIKE 'Waiting on its monitor%' AND NOT EXISTS (SELECT 1 FROM events later WHERE later.session_id = r.session_id AND later.log_pos > r.log_pos AND (later.kind = 'session.end' OR (later.kind = 'agent.stop' AND json_extract(later.data, '$.child') IS NULL) OR (later.kind = 'session.reading' AND json_extract(later.data, '$.reading') LIKE 'Its monitor%')))`)) as { session_id: string; text: string }[]).map((r) => [r.session_id, r.text]));
  // A turn you interrupted, with no prompt since (#39).
  const interrupted = new Set(((await query(`SELECT e.session_id FROM ${events('e')} WHERE e.kind = 'session.reading'${of('e.session_id')} AND json_extract(e.data, '$.reading') LIKE 'Interrupt:%' AND NOT EXISTS (SELECT 1 FROM events a WHERE a.session_id = e.session_id AND a.kind = 'user.ask' AND a.log_pos > e.log_pos)`)) as { session_id: string }[]).map((r) => r.session_id));
  // Each session's newest stop of its own: a hook after it, such as Claude Code's idle-prompt notification, is no later
  // stop, and nor is a subagent's.
  const stops = new Map(((await query(`SELECT session_id, MAX(ts) AS ts FROM ${events()} WHERE kind = 'agent.stop' AND json_extract(data, '$.child') IS NULL AND session_id IS NOT NULL${of('session_id')} GROUP BY session_id`)) as { session_id: string; ts: number }[]).map((r) => [r.session_id, r.ts]));
  const ago = (ms: number | null) => (ms === null ? 'a while' : elapsed(now - ms));
  // The planted wrong reading checks a permission prompt before a process gone.
  const waitingFirst = activePlant() === 'waiting-first';
  return sessions.map((s): Reading => {
    const open = asks.get(s.id);
    const promised = due.get(s.id);
    const note = notes.get(s.id);
    const midTurn = gone.has(s.id) && !['finished', 'failed', 'stuck'].includes(s.status);
    const seen = s.last_seen;
    const stopped = stops.get(s.id) ?? s.last_seen;
    const [state, cause, why, plain, since]: [State, Cause, string, string, number | null] = open ? ['needs you', 'ask', `${open.n === 1 ? 'an ask' : `${open.n} asks`} open for ${ago(open.since)}`, `${open.n === 1 ? 'an ask' : `${open.n} asks`} open`, open.since]
      : midTurn && !waitingFirst ? ['flagged', 'gone', 'its process is gone mid-turn', 'its process is gone mid-turn', seen]
      : s.status === 'waiting' && now - (s.last_seen ?? 0) <= WAITING_QUIET_MS ? ['needs you', 'waiting', 'a permission prompt waits on you', 'a permission prompt waits on you', seen]
      // A session whose hooks can't run sends no hook to say so (#993): stuck, never folded away as quiet.
      : note?.startsWith(CANT_RUN) ? ['stuck', 'stuck', 'BLOCKED: its hooks can\'t run, so its gates are watch-only; run `deep setup`', 'BLOCKED: its hooks can\'t run, so its gates are watch-only; run `deep setup`', seen]
      : s.status === 'stuck' ? ['stuck', 'stuck', `blocked on something only you or a service can clear${s.cause ? ` (${causeWords(s.cause)})` : ''}`, `blocked on something only you or a service can clear${s.cause ? ` (${causeWords(s.cause)})` : ''}`, seen]
      : promised ? ['flagged', 'promised', `a promised check is due since ${clockTime(promised.due)}, waiting for its next prompt or stop: "${promised.quote}"`, `a promised check is due, waiting for its next prompt or stop: "${promised.quote}"`, promised.due]
      : s.status === 'failed' ? ['flagged', 'failed', `its turn ended failed, with no claim${s.cause ? ` (${causeWords(s.cause)})` : ''}`, `its turn ended failed, with no claim${s.cause ? ` (${causeWords(s.cause)})` : ''}`, seen]
      : midTurn ? ['flagged', 'gone', 'its process is gone mid-turn', 'its process is gone mid-turn', seen]
      : s.status === 'unknown' || s.status === 'waiting' || now - (s.last_seen ?? 0) > QUIET_MS ? ['quiet', 'quiet', `last seen ${ago(s.last_seen)} ago`, 'no hook since', seen]
      // A session waiting on its monitor (#997) is still at work.
      : s.status === 'finished' && watching.has(s.id) ? ['working', 'working', watching.get(s.id)!, watching.get(s.id)!, seen]
      : s.status === 'finished' && interrupted.has(s.id) ? ['finished', 'interrupted', `its turn was interrupted ${ago(s.last_seen)} ago`, 'its turn was interrupted', seen]
      : s.status === 'finished' ? ['finished', 'finished', `its turn stopped ${ago(stopped)} ago`, 'its turn stopped', stopped]
      : ['working', 'working', `last seen ${ago(s.last_seen)} ago`, 'at work', seen];
    return { id: s.id, project_id: s.project_id, agent: s.agent, worktree: s.worktree, state, cause, why, plain, since, ...(note ? { note } : {}) };
  });
}

/** Each session's row, from the record's tables through `query` (the hub's record, or its database read-only). */
export async function statusRows(query: (sql: string) => Promise<unknown[]>, now: number): Promise<StatusRow[]> {
  const sessions = await sessionStates(query, now);
  // By each session's latest start: a resume without the key no longer bills it.
  const keyed = new Set<string>();
  for (const e of (await query("SELECT session_id, data FROM events WHERE kind = 'session.start' AND session_id IS NOT NULL ORDER BY log_pos")) as { session_id: string; data: string | Obj }[]) {
    const data = (typeof e.data === 'string' ? JSON.parse(e.data) : e.data) as Obj;
    if (billingMode({ id: '', kind: 'session.start', v: 3, ts: 0, session: e.session_id, data }) === 'api_key') keyed.add(e.session_id);
    else keyed.delete(e.session_id);
  }
  const rows = sessions.map((s): StatusRow => {
    return { id: s.id, repo: repoOf(s.worktree) ?? s.project_id ?? 'no repo', agent: s.agent ?? 'agent', state: s.state, why: keyed.has(s.id) ? `${s.why}, billing an API key` : s.why, ...(s.note ? { note: s.note } : {}) };
  });
  // The newest claim's line, from the record's claims, verdicts and runs, as the chat shows it (#83, #669).
  for (const row of rows) {
    // A database older than the claims tables has none to show.
    const claim = await newestClaim(query, row.id).catch(() => undefined);
    const state = claim === undefined ? undefined : await claimState(query, claim, new Map()).catch(() => undefined);
    if (state) row.verdict = verdictLine(state.state);
  }
  const finished = rows.filter((r) => r.state === 'finished');
  if (finished.length) await lastTurns(query, finished, new Map(sessions.map((s) => [s.id, s.worktree])));
  // A Claude Code session in a repo whose own status line overrides the forwarder has no plan-window reading of its
  // own: its windows read unknown, naming the file, never 0% or the account's reading from another repo (#1296).
  const worktrees = new Map(sessions.map((s) => [s.id, s.worktree]));
  for (const row of rows) {
    const worktree = worktrees.get(row.id);
    if ((row.agent !== 'claude-code' && row.agent !== 'claude') || !worktree) continue;
    const shadow = shadowedBy(topLevel(worktree))[0];
    if (shadow) row.readings = [`${UNREAD_WINDOW} ${shadow.file} sets ${shadow.key}, which runs instead of DeepBuild's status line forwarder, so this session's plan windows aren't read`];
  }
  const codex = rows.filter((r) => r.agent === 'codex');
  const readings = await rowReadings(query, codex.map((r) => r.id), now, elapsed);
  for (const row of codex) if (readings.has(row.id)) row.readings = readings.get(row.id)!;
  // The newest older-or-current set reading of each session: an older one stays on its row (#148).
  const sets = (await query(`SELECT session_id, json_extract(data, '$.reading') AS text FROM events WHERE kind = 'session.reading' AND (json_extract(data, '$.reading') LIKE '${OLDER_SET}%' OR json_extract(data, '$.reading') LIKE '${NEWER_SET}%') ORDER BY log_pos`)) as { session_id: string; text: string }[];
  const newest = new Map(sets.map((r) => [r.session_id, r.text]));
  for (const row of rows) {
    const text = newest.get(row.id);
    if (text?.startsWith(OLDER_SET)) row.readings = [...(row.readings ?? []), text];
  }
  return rows;
}

/**
 * The promised checks due in sessions no route could wake (#120): each session's latest promise event, when it is the
 * due one waiting for the session's next prompt or stop, with the quote its set carried.
 */
async function duePromises(query: (sql: string) => Promise<unknown[]>, from = 'events', of = ''): Promise<Map<string, { due: number; quote: string }>> {
  const events = (await query(`SELECT session_id, kind, data FROM ${from} WHERE kind IN ('promise.set', 'promise.due', 'promise.woken', 'promise.blocked', 'session.end') AND session_id IS NOT NULL${of} ORDER BY log_pos`)) as { session_id: string; kind: string; data: string | Obj }[];
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
    // What deep status says of the turn on one line (#1463): how many calls, how many failed.
    row.turn = { calls: calls.size, failed: [...calls.values()].filter((c) => c.after?.outcome === 'failed').length };
  }
}
type Obj = Record<string, unknown>;
/** One tool call: its kind, its command or the files it touched, and how it ended. */
function callLine(call: Obj, after: Obj | undefined, worktree: string): string {
  const paths = Array.isArray(call.paths) ? call.paths.filter((p): p is string => typeof p === 'string') : [];
  // Runs of spaces fold to one; any other white space is a character `render` marks (#1510), never a space.
  const what = typeof call.command === 'string' ? call.command.replace(/ +/g, ' ').replace(/^ | $/g, '')
    : paths.length ? paths.map((p) => (worktree && isAbsolute(p) && p.startsWith(`${worktree}/`) ? relative(worktree, p) : p)).join(', ')
    : typeof call.tool === 'string' ? call.tool : '';
  // By code point, so an emoji or a tag character is never cut in half.
  const points = [...what];
  const shortened = points.length > 72 ? `${points.slice(0, 71).join('')}…` : what;
  const ended = !after ? 'no result' : after.outcome !== 'failed' ? 'ok'
    : ['failed', ...(typeof after.exit_code === 'number' ? [`exit ${after.exit_code}`] : []), ...(typeof after.signature === 'string' ? [after.signature] : [])].join(', ');
  return `${String(call.kind ?? 'call')} ${shortened}  ${ended}`;
}

/**
 * The repo a session works in, by its working folder: the folder holding its `.git`, and for a linked worktree the
 * repo the worktree belongs to, so every worktree of one repo groups under it.
 */
export function repoOf(worktree: string | null): string | undefined {
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

/** `deep numbers`: your readings through the hub, or what changes them; a hub that can't be read shows no numbers at all. */
export async function numbersCommand(args: readonly string[]): Promise<number> {
  const [sub, arg, extra] = args;
  const asks: [string, Record<string, unknown>] | undefined = !sub || sub === '--json' ? ['numbers.read', {}]
    : sub === 'refresh' && !arg ? ['numbers.refresh', {}]
    : sub === 'baseline' && arg ? ['numbers.baseline', { manifest: resolve(arg) }]
    : sub === 'sample' && arg && !Number.isNaN(Date.parse(arg)) ? ['numbers.sample', { before: Date.parse(arg), ...(extra ? { manifest: resolve(extra) } : {}) }]
    : undefined;
  if (!asks) {
    process.stderr.write('Usage: deep numbers [--json] | refresh | baseline <manifest> | sample <before date> [manifest]\n');
    return 2;
  }
  try {
    const socket = hubAddress().path;
    const token = [join(dirname(socket), 'control.token'), rootOf(installedRoot()).token].find((p) => existsSync(p));
    // Named so the hub can refuse an agent's process tree what feeds your numbers.
    const reply = await call(socket, token ? readFileSync(token, 'utf8').trim() : '', asks[0], asks[1], { pid: process.pid, start: (await startOf(process.pid)) ?? '' });
    if (!('result' in reply)) {
      process.stderr.write(`deep numbers: ${reply.error.remediation}\n`);
      return 3;
    }
    if (asks[0] === 'numbers.read' && sub !== '--json') {
      const lines = numbersLines(reply.result.rows as Parameters<typeof numbersLines>[0]);
      process.stdout.write(lines.length ? `${lines.join('\n')}\n` : 'No readings yet.\n');
    } else process.stdout.write(`${JSON.stringify(reply.result, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`deep numbers: ${error instanceof Error ? error.message : String(error)}; start the hub with deep hub start.\n`);
    return 3;
  }
}
