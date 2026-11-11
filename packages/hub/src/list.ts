// `deep` and `deep status` (#1463): the list every reader shows, read as the rows the hub built (rows.ts), from the hub
// (`rows.read`) or, with it down, from its database read-only. `deep` prints the list and the one count; `deep status`
// adds each row's detail and ends on the count, so what needs you is the last thing on screen however long the detail
// is; `--json` prints the rows. Every clock time is in your time zone.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { call } from './client.js';
import { StaleHub } from './generations.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { activePlant } from './plant.js';
import { elapsed } from './promises.js';
import type { Row, Why } from './rows.js';
import { visible } from './visible.js';

/** What deep status shows under a session's row (status.ts: StatusRow, less what the row holds). */
export interface Detail { note?: string; verdict?: string; readings?: string[]; calls?: string[]; commits?: string[]; turn?: { calls: number; failed: number } }
/** A read of the list: its rows at a log_pos, each session's detail when asked, and when the hub stopped answering if it did. */
interface Read { log_pos: number; rows: Row[]; detail?: Record<string, Detail>; down?: number; explained?: Why }

/**
 * The list's sections, as deep status has always listed them (#19): what needs you, is stuck or is flagged, then what
 * works, then what finished, then the quiet ones, so no number of working sessions pushes one that needs you down.
 */
export const SECTION: Record<string, number> = {
  'needs you': 0, stuck: 0, flagged: 0, BLOCKED: 0, INVALID: 0, INCONCLUSIVE: 0, stale: 0,
  'sent back': 1, 'says done': 1, working: 1, queued: 1, PASS: 2, finished: 2, quiet: 3,
};

/** The one count sentence, as the app says it (crates/deep-app/src/views.rs: asks_need_you). */
export const asksNeedYou = (n: number): string => (n === 1 ? '1 ask needs you' : `${n} asks need you`);

/** `at` as a clock time in your time zone: 16:40. */
export const clock = (at: number): string => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
/**
 * When `at` comes, as the app's notification says it (crates/deep-app/src/notify.rs: clock_time): "at 16:40" today,
 * "tomorrow at 16:40", else "on Wed 11 Nov at 16:40".
 */
export function when(at: number, now = Date.now()): string {
  const day = (ms: number) => new Date(ms).toDateString();
  if (day(at) === day(now)) return `at ${clock(at)}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (day(at) === tomorrow.toDateString()) return `tomorrow at ${clock(at)}`;
  const d = new Date(at);
  return `on ${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })} at ${clock(at)}`;
}

/** The rows as the planted wrong programs read them; as they are otherwise. */
function planted(rows: Row[]): Row[] {
  const plant = activePlant();
  if (plant === 'status-second-order') return [...rows].reverse();
  if (plant === 'status-own-word') return rows.map((r) => (r.word === 'needs you' ? { ...r, word: 'need you' } : r));
  if (plant === 'status-unread-flipped') return rows.map((r) => ({ ...r, unread: !r.unread }));
  // #2018's: a BLOCKED row that names neither whom it waits for nor the evidence it leaves open.
  if (plant === 'blocked-bare') return rows.map((r) => (r.word === 'BLOCKED' ? { ...r, why: '', waits_on: null } : r));
  return rows;
}

/**
 * The list as text: each project's sessions under its name, the quiet ones folded into one line, then the open asks,
 * then how many sessions and the count sentence. With `detail`, each session's detail under its row; a finished
 * session's is one line, how many calls, how many failed, its commits, and the handle `deep read` takes for the rest.
 */
export function listText(rows: readonly Row[], o: { detail?: Record<string, Detail>; down?: string; now?: number } = {}): string {
  const now = o.now ?? Date.now();
  const out: string[] = o.down ? [o.down] : [];
  const sessions = rows.filter((r) => r.id.startsWith('session:'));
  const asks = rows.filter((r) => r.id.startsWith('ask:'));
  const age = (r: Row) => (r.since === null ? '' : `, ${elapsed(Math.max(0, now - r.since))}`);
  const quiet = sessions.filter((r) => r.word === 'quiet');
  let project: string | null | undefined;
  let section: number | undefined;
  for (const r of sessions.filter((s) => s.word !== 'quiet')) {
    const at = SECTION[r.word] ?? 1;
    if (at !== section) {
      section = at;
      project = undefined;
      if (at === 1) out.push('Working:');
      if (at === 2) out.push('Finished:');
    }
    if (r.project !== project) out.push((project = r.project) ?? 'no repo');
    // Its one name, its agent, then its word and why (#2018): its ID shows only in a name another row would otherwise
    // read the same as, and a verdict that isn't PASS or FAIL says whom it waits for and its evidence after its word.
    out.push(`  ${r.title}  ${r.agent ?? 'agent'}  ${[r.word, r.why].filter(Boolean).join(' · ')}${age(r)}`);
    const d = o.detail?.[r.id];
    if (!d) continue;
    for (const line of [d.note, ...(d.readings ?? [])]) if (line) out.push(`      ${line}`);
    if (!d.turn) {
      if (d.verdict) out.push(`      ${d.verdict}`);
      continue;
    }
    // A finished turn is one line: its claim's line, how many calls, how many failed, its commits, each call (#668),
    // and the handle deep read takes for the rest. The planted wrong program leaves the commits out.
    const commits = d.commits?.length ? `, commit${d.commits.length === 1 ? '' : 's'} ${d.commits.map((c) => c.slice(0, 12)).join(', ')}` : ', no commits';
    out.push(`      ${d.verdict ? `${d.verdict}; ` : ''}${d.turn.calls} call${d.turn.calls === 1 ? '' : 's'}, ${d.turn.failed} failed${activePlant() === 'status-omits-commit' ? '' : commits}${d.calls?.length ? `: ${d.calls.join('; ')}` : ''}; the rest: deep read session:${r.session.replace(/[^0-9A-Za-z]/g, '')}`);
  }
  const byRepo = [...new Set(quiet.map((r) => r.project ?? 'no repo'))].sort().map((p) => `${p} ${quiet.filter((r) => (r.project ?? 'no repo') === p).length}`);
  if (quiet.length) out.push(`${quiet.length} quiet, by repo: ${byRepo.join(', ')}`);
  // Each running job (#1925): its count from its tool's own counter, or with none how long it has run, and why.
  const jobs = rows.filter((r) => r.id.startsWith('job:'));
  if (jobs.length) out.push('Running jobs:');
  for (const r of jobs) out.push(`  ${r.word.padEnd(9)}  ${r.title}${r.progress ? ` · ${r.progress}` : age(r)}`, `      ${r.why}`);
  if (asks.length) out.push('Needs you');
  for (const r of asks) out.push(`  ${r.title}  ${r.word}  ${r.project ?? 'no repo'}${age(r)}`);
  if (!sessions.length) out.push('Start a Claude Code or Codex session in a repo and it shows here; deep doctor checks the setup.');
  else out.push(`${sessions.length} session${sessions.length === 1 ? '' : 's'}`);
  // The planted wrong program counts the open asks a second time, itself, one too many.
  if (activePlant() === 'deep-second-count') out.push(asksNeedYou(asks.length + 1));
  out.push(asksNeedYou(asks.length));
  // Each line names sessions, asks and readings from the record, so each prints through `visible` (#1510).
  return `${out.map(visible).join('\n')}\n`;
}

/**
 * Why a session reads as it does (#2018), as text: its name, the one sentence, the row of the state table that
 * matched, each record fact that row read (event kind, time and log_pos), and each row above it with the fact it lacked.
 */
export function whyText(w: Why, now = Date.now()): string {
  const out = [`${w.title}${w.project ? ` · ${w.project}` : ''}`, `${w.word}: ${w.why}`, `The state table's row that matched: ${w.rule}, which reads ${w.word}.`, w.facts.length ? 'Each record fact it read:' : 'It read no record fact.'];
  for (const f of w.facts) out.push(`  ${f.kind}  ${when(f.ts, now)}  log_pos ${f.log_pos}`);
  if (w.lacked.length) out.push('Each row above it, and the fact it lacked:');
  for (const l of w.lacked) out.push(`  ${l.row}: ${l.fact}`);
  return `${out.map(visible).join('\n')}\n`;
}

/**
 * #2018's planted wrong program tries the stale row before needs you: a session with an open ask whose newest claim's
 * verdict is on a commit that moved reads stale. It reads the hub's database for itself, as no reader should.
 */
async function staleBeforeAsk(rows: Row[], ledger: string | undefined): Promise<Row[]> {
  if (!ledger) return rows;
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(ledger, { readonly: true, fileMustExist: true });
  try {
    const { sessionFacts } = await import('./status.js');
    const stale = new Set((await sessionFacts(async (sql) => db.prepare(sql).all())).filter((f) => f.claim?.stale).map((f) => f.id));
    return rows.map((r) => (r.id.startsWith('session:') && r.word === 'needs you' && stale.has(r.session) ? { ...r, word: 'stale', entry: 'stale' } : r));
  } finally {
    db.close();
  }
}

/** The hub's socket and its token, beside the socket or the installed hub's. */
function hub(): { socket: string; token: string } {
  const socket = hubAddress().path;
  const token = [join(dirname(socket), 'control.token'), rootOf(installedRoot()).token].find((p) => existsSync(p));
  return { socket, token: token ? readFileSync(token, 'utf8').trim() : '' };
}

/** What a list read from the hub's database says first: the hub isn't answering, and since when. */
export const hubDown = (down: number): string => `The hub isn't answering, since ${clock(down)}; this is the list its database holds.`;

/**
 * The list read with the hub at `socket` down (`deep`, `deep status`, `deep inbox`): its database read-only, the
 * socket's folder's or the installed hub's; undefined with none.
 */
export async function databaseRead(socket: string, detail: boolean): Promise<Read | undefined>;
export async function databaseRead(socket: string, detail: boolean, why: string | undefined): Promise<Read | { refused: string } | undefined>;
export async function databaseRead(socket: string, detail: boolean, why?: string): Promise<Read | { refused: string } | undefined> {
  const ledger = [join(dirname(socket), 'ledger.db'), rootOf(installedRoot()).ledger].find((p) => existsSync(p));
  return ledger ? fromDatabase(ledger, detail, why) : undefined;
}

/**
 * The list read with the hub down: its database read-only, the rows its `rows` table holds, and when the hub stopped
 * answering, as the newest event the hub appended. Each session's detail, when asked, is deep status's own reading.
 */
async function fromDatabase(ledger: string, detail: boolean, why?: string): Promise<Read | { refused: string }> {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(ledger, { readonly: true, fileMustExist: true });
  try {
    const query = async (sql: string) => db.prepare(sql).all();
    const { listRows, whyOf } = await import('./rows.js');
    const rows = (await listRows(query)).map((p) => p.row);
    const [last] = (await query('SELECT MAX(ts) AS ts, MAX(log_pos) AS log_pos FROM events')) as { ts: number | null; log_pos: number | null }[];
    if (why !== undefined) {
      const found = await whyOf(query, Date.now(), why, rows);
      return 'refused' in found ? found : { log_pos: last?.log_pos ?? 0, rows, explained: found, down: last?.ts ?? Date.now() };
    }
    let details: Record<string, Detail> | undefined;
    if (detail) {
      const { statusRows } = await import('./status.js');
      details = Object.fromEntries((await statusRows(query, Date.now())).map((r) => [`session:${r.id}`, r]));
    }
    return { log_pos: last?.log_pos ?? 0, rows, ...(details ? { detail: details } : {}), down: last?.ts ?? Date.now() };
  } finally {
    db.close();
  }
}

/**
 * `deep` (`detail` false) and `deep status` (true), each with `--json`: 0 read from the hub, 3 from its database or not
 * at all. `deep status <session> --why` prints why that session reads as it does (#2018), 2 when no session has that ID.
 */
export async function listCommand(args: readonly string[], detail: boolean): Promise<number> {
  const name = detail ? 'deep status' : 'deep';
  const named = args.filter((a) => !a.startsWith('--'));
  const asked = args.includes('--why');
  if (args.some((a) => a.startsWith('--') && a !== '--json' && !(detail && a === '--why')) || named.length !== (asked ? 1 : 0)) {
    process.stderr.write(detail ? 'Usage: deep status [--json] | deep status <session> --why [--json]\n' : `Usage: ${name} [--json]\n`);
    return 2;
  }
  const session = asked ? named[0]! : undefined;
  const [method, params] = session === undefined ? ['rows.read', { detail }] as const : ['row.why', { session }] as const;
  const json = args.includes('--json');
  // The planted wrong program exits with a code the exit-code table doesn't list when it can't read a hub.
  const unread = activePlant() === 'status-exit-unmapped' ? 4 : 3;
  const print = (read: Read): void => {
    // A session's why: from the hub, the reply is the why with its log_pos; from the database, the read holds it.
    const why = session === undefined ? undefined : read.explained ?? (read as unknown as Why);
    if (why) {
      const down = read.down !== undefined ? `The hub isn't answering, since ${clock(read.down)}; this is read from its database.\n` : '';
      // The planted wrong program builds its why from a reading of its own, which says quiet for a row at work.
      const said = activePlant() === 'why-second-reading' && why.word === 'working' ? { ...why, word: 'quiet', why: 'no hook since' } : why;
      const { id, word, why: sentence, rule, facts, lacked } = said;
      process.stdout.write(json ? `${JSON.stringify({ log_pos: read.log_pos, id, word, why: sentence, rule, facts, lacked })}\n` : `${down}${whyText(said)}`);
      return;
    }
    const rows = planted(read.rows);
    if (json) process.stdout.write(`${JSON.stringify({ log_pos: read.log_pos, rows })}\n`);
    else process.stdout.write(listText(rows, { ...(read.detail ? { detail: read.detail } : {}), ...(read.down !== undefined ? { down: hubDown(read.down) } : {}) }));
  };
  // A clone of a project this machine joined reads that project's hub over the network (#1338), as its person.
  const { joinedFor, remoteCall } = await import('./remote.js');
  const joined = joinedFor(process.cwd());
  if (joined) {
    try {
      const reply = await remoteCall(joined, method, params);
      if ('result' in reply) {
        print(reply.result as unknown as Read);
        return 0;
      }
      process.stderr.write(`${name}: the hub at ${joined.address} refused this read: ${reply.error.remediation}\n`);
    } catch (error) {
      process.stderr.write(`${name}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    return unread;
  }
  let at: { socket: string; token: string };
  try {
    at = hub();
  } catch (error) {
    process.stderr.write(`${name}: ${error instanceof Error ? error.message : String(error)}\n`);
    return unread;
  }
  let why: string;
  try {
    const reply = await call(at.socket, at.token, method, params);
    if ('result' in reply) {
      const read = reply.result as unknown as Read;
      if (activePlant() === 'stale-before-ask' && session === undefined) read.rows = await staleBeforeAsk(read.rows, [join(dirname(at.socket), 'ledger.db'), rootOf(installedRoot()).ledger].find((p) => existsSync(p)));
      print(read);
      return 0;
    }
    // The hub answered, and no session has that ID: nothing its database would say differently.
    if (session !== undefined && reply.error.code === 'not_found') {
      process.stderr.write(`${name}: ${reply.error.remediation}\n`);
      return 2;
    }
    why = reply.error.remediation;
  } catch (error) {
    // A hub left behind isn't read in any way, its database included (#1338).
    if (error instanceof StaleHub) {
      process.stderr.write(`${name}: ${error.message}\n`);
      return unread;
    }
    why = error instanceof Error ? error.message : String(error);
  }
  // The hub's own folder holds its database: the socket's, or the installed root.
  const read = await databaseRead(at.socket, detail, session);
  if (!read) {
    process.stderr.write(`${name}: the hub isn't answering (${why}), and there is no database to read; start it with deep hub start.\n`);
    return unread;
  }
  if ('refused' in read) {
    process.stderr.write(`${name}: ${read.refused}\n`);
    return 2;
  }
  print(read);
  return unread;
}
