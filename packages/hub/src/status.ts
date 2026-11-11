// The one state reading (#992): each session's state from the record's tables, which the core records as
// `session.state` and builds the list's rows from (rows.ts, #1463), and each session's detail deep status shows under
// its row: a session whose turn finished, that turn's tool calls, failures and commits (#668), and a session with a
// claim, its newest claim's line, the one its chat showed (#669). `deep numbers` reads the hub's readings.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
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
import { ROUNDS, verdictLine } from '@deepbuild/verdicts';

/** The words a session's state reads as (design: States people see); the table below gives their order. */
export type State = 'needs you' | 'stuck' | 'flagged' | 'sent back' | 'BLOCKED' | 'INVALID' | 'INCONCLUSIVE' | 'stale' | 'says done' | 'working' | 'queued' | 'PASS' | 'finished' | 'quiet';
/** A session's row; a finished one carries what its last turn did: each tool call, then each commit by SHA. */
export interface StatusRow { id: string; repo: string; agent: string; state: State; why: string; note?: string; verdict?: string; calls?: string[]; commits?: string[]; readings?: string[]; turn?: { calls: number; failed: number } }
/** A session with no hook for this long reads quiet, unless an ask, a block or its newest claim says more. */
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
/** The most tool calls a finished turn lists; the rest are counted on one line. */
const CALLS_SHOWN = 20;

/**
 * Why a session is in its state: one of a closed set, so a surface that draws the state from the record (the app's
 * sidebar, from `session.state`) says the same as this listing.
 */
type Cause = 'ask' | 'gone' | 'waiting' | 'words' | 'stuck' | 'promised' | 'failed' | 'sent_back' | 'blocked' | 'invalid' | 'inconclusive' | 'stale' | 'says_done' | 'working' | 'queued' | 'pass' | 'interrupted' | 'finished' | 'quiet';
/** A record fact a reading read (#2018): the event's kind, its time and its place in the log. */
export interface Fact { kind: string; ts: number; log_pos: number }
/** A row of the table above the one that matched, with the fact it lacked. */
export interface Lacked { rule: string; state: State; fact: string }
/** A session's state as the record reads it, with why. */
/** `plain` is `why` with no age in it and `since` the time it counts from, so a row built from it changes only with its state (#1463). */
/**
 * `rule` is the row of the state table that matched, `facts` each record fact that row read, `lacked` each higher row
 * with the fact it lacked, and `waits_on` whom the session waits for (#2018): one function picks the state and says why.
 */
export interface Reading { id: string; project_id: string | null; agent: string | null; worktree: string | null; state: State; cause: Cause; rule: string; why: string; plain: string; since: number | null; waits_on: string | null; facts: Fact[]; lacked: Lacked[]; note?: string }

/** A session's newest claim as the record holds it: its verdict in force, or the stale one, and what it leaves open. */
interface Claim { made: Fact; outcome: string | null; judged?: Fact; stale?: Fact; round: number | null; owner: string | null; evidence: string | null }
/**
 * What the record holds of one session, each value with the event it was read from: everything `decide` reads, so a
 * state and its why come from the same facts (#2018).
 */
export interface SessionFacts {
  id: string; project_id: string | null; agent: string | null; worktree: string | null;
  /** Its status as its hooks and the core last said it, the event that set it, and its newest stop's cause. */
  status: string; statusBy?: Fact; stopCause: string | null;
  /** When it was last seen, and the event that was. */
  last_seen: number | null; seenBy?: Fact;
  /** Its open asks: how many, the oldest's time, and each one's creation. */
  asks?: { n: number; since: number | null; facts: Fact[] };
  /** Its process gone, with no start since. */
  gone?: Fact;
  /** An answer of yours whose delivery into it stalled or timed out. */
  words?: { outcome: string; at?: Fact };
  /** The newest reading that says its holds don't apply, and the one that says its hooks can't run. */
  note?: string; cantRun?: Fact;
  promised?: { due: number; quote: string; at?: Fact };
  /** It waits on its monitor (#997); a turn of it you interrupted, with no prompt since (#39). */
  watching?: { text: string; at?: Fact };
  interrupted?: Fact;
  /** Its newest stop of its own. */
  stopped?: Fact;
  claim?: Claim;
  /** A task of its thread it hasn't started. */
  queued?: Fact;
}

/** What a row of the table gives a session it matches. */
interface Hit { why: string; plain?: string; since: number | null; waits_on: string | null; facts: (Fact | undefined)[] }
/** A row of the state table: its name, the word and reason it gives, what a session it doesn't match lacks, and its test. */
interface Rule { rule: string; state: State; cause: Cause; lacks: string; match(f: SessionFacts, now: number): Hit | undefined }

const ago = (ms: number | null, now: number): string => (ms === null ? 'a while' : elapsed(now - ms));
const recent = (f: SessionFacts, now: number): boolean => now - (f.last_seen ?? 0) <= QUIET_MS;
const causeOf = (f: SessionFacts): string => (f.stopCause ? ` (${f.stopCause})` : '');
/** Its agent's process gone while a turn was under way: one that stopped, failed or got stuck first had ended its turn. */
const goneMidTurn = (f: SessionFacts): boolean => f.gone !== undefined && !['finished', 'failed', 'stuck'].includes(f.status);
/** A row for a claim's verdict: the session's newest claim, judged `outcome` by a verdict still in force. */
const judged = (rule: string, state: State, cause: Cause, outcome: string, hit: (c: Claim) => Pick<Hit, 'why' | 'waits_on'>): Rule => ({
  rule, state, cause, lacks: `its newest claim has no ${outcome} in force`,
  match: (f) => (f.claim && !f.claim.stale && f.claim.outcome === outcome ? { ...hit(f.claim), since: f.claim.made.ts, facts: [f.claim.made, f.claim.judged] } : undefined),
});
/** A verdict that isn't PASS or FAIL names who can clear it and the evidence it leaves open, never the bare word. */
const waitsFor = (c: Claim): Pick<Hit, 'why' | 'waits_on'> => ({ why: `waits for ${c.owner ?? 'you'}: ${c.evidence ?? 'its verdict names no evidence'}`, waits_on: c.owner ?? 'you' });

/**
 * The one ordered state table (#2018; design: States people see): a session's state on every surface is the first row
 * that matches what the record holds of it, in the words' order: needs you, stuck, flagged, sent back, BLOCKED,
 * INVALID, INCONCLUSIVE, stale, says done, working, queued, PASS, finished, quiet. A word has a row for each fact
 * that gives it. The last row matches every session, so each reads exactly one state.
 */
const TABLE: readonly Rule[] = [
  { rule: 'ask', state: 'needs you', cause: 'ask', lacks: 'no open ask',
    match: (f, now) => { const n = f.asks?.n ? (f.asks.n === 1 ? 'an ask' : `${f.asks.n} asks`) : undefined; return n ? { why: `${n} open for ${ago(f.asks!.since, now)}`, plain: `${n} open`, since: f.asks!.since, waits_on: 'you', facts: f.asks!.facts } : undefined; } },
  // A prompt its agent shows, unless the agent's process is gone mid-turn: no one is left to answer it then (#992).
  // The planted wrong reading checks a permission prompt before a process gone.
  { rule: 'waiting', state: 'needs you', cause: 'waiting', lacks: 'no permission prompt showing',
    match: (f, now) => (f.status === 'waiting' && now - (f.last_seen ?? 0) <= WAITING_QUIET_MS && (!goneMidTurn(f) || activePlant() === 'waiting-first') ? { why: 'a permission prompt waits on you', since: f.last_seen, waits_on: 'you', facts: [f.statusBy] } : undefined) },
  { rule: 'words', state: 'needs you', cause: 'words', lacks: 'no words of yours whose delivery stalled or timed out',
    match: (f) => (f.words ? { why: `your words didn't reach it: their delivery ${f.words.outcome === 'timed_out' ? 'timed out' : 'stalled'}`, since: f.words.at?.ts ?? f.last_seen, waits_on: 'you', facts: [f.words.at] } : undefined) },
  // A session whose hooks can't run sends no hook to say so (#993): stuck, never folded away as quiet.
  { rule: 'hooks', state: 'stuck', cause: 'stuck', lacks: 'its hooks can run',
    match: (f) => (f.note?.startsWith(CANT_RUN) ? { why: 'BLOCKED: its hooks can\'t run, so its gates are watch-only; run `deep setup`', since: f.last_seen, waits_on: 'you', facts: [f.cantRun] } : undefined) },
  { rule: 'stuck', state: 'stuck', cause: 'stuck', lacks: 'no stop blocked on you or a service',
    match: (f) => (f.status === 'stuck' ? { why: `blocked on something only you or a service can clear${causeOf(f)}`, since: f.last_seen, waits_on: 'you', facts: [f.statusBy] } : undefined) },
  { rule: 'gone', state: 'flagged', cause: 'gone', lacks: 'no process gone mid-turn',
    match: (f) => (goneMidTurn(f) ? { why: 'its process is gone mid-turn', since: f.last_seen, waits_on: 'you', facts: [f.gone, f.statusBy] } : undefined) },
  { rule: 'promised', state: 'flagged', cause: 'promised', lacks: 'no promised check due',
    match: (f) => (f.promised ? { why: `a promised check is due since ${clockTime(f.promised.due)}, waiting for its next prompt or stop: "${f.promised.quote}"`, plain: `a promised check is due, waiting for its next prompt or stop: "${f.promised.quote}"`, since: f.promised.due, waits_on: 'agent', facts: [f.promised.at] } : undefined) },
  { rule: 'failed', state: 'flagged', cause: 'failed', lacks: 'no turn ended failed',
    match: (f) => (f.status === 'failed' ? { why: `its turn ended failed, with no claim${causeOf(f)}`, since: f.last_seen, waits_on: 'you', facts: [f.statusBy] } : undefined) },
  judged('sent_back', 'sent back', 'sent_back', 'FAIL', (c) => ({ why: `its checks sent its claim back, round ${Math.max(1, c.round ?? 1)} of ${ROUNDS}`, waits_on: 'agent' })),
  judged('blocked', 'BLOCKED', 'blocked', 'BLOCKED', waitsFor),
  judged('invalid', 'INVALID', 'invalid', 'INVALID', waitsFor),
  judged('inconclusive', 'INCONCLUSIVE', 'inconclusive', 'INCONCLUSIVE', waitsFor),
  { rule: 'stale', state: 'stale', cause: 'stale', lacks: 'no verdict on a commit that has moved',
    match: (f) => (f.claim?.stale ? { why: 'its verdict is on a commit that has moved since', since: f.claim.made.ts, waits_on: 'agent', facts: [f.claim.made, f.claim.judged, f.claim.stale] } : undefined) },
  { rule: 'says_done', state: 'says done', cause: 'says_done', lacks: 'no claim still waiting for its verdict',
    match: (f) => (f.claim && f.claim.outcome === null ? { why: 'it says done, and its checks have given no verdict yet', since: f.claim.made.ts, waits_on: 'its checks', facts: [f.claim.made] } : undefined) },
  // A session waiting on its monitor (#997) is still at work.
  { rule: 'monitor', state: 'working', cause: 'working', lacks: 'no monitor it waits on',
    match: (f, now) => (f.status === 'finished' && f.watching && recent(f, now) ? { why: f.watching.text, since: f.last_seen, waits_on: 'agent', facts: [f.watching.at, f.statusBy] } : undefined) },
  { rule: 'working', state: 'working', cause: 'working', lacks: 'no turn in progress',
    match: (f, now) => (f.status === 'working' && recent(f, now) ? { why: `last seen ${ago(f.last_seen, now)} ago`, plain: 'at work', since: f.last_seen, waits_on: 'agent', facts: [f.statusBy, f.seenBy] } : undefined) },
  // A session no hook has moved yet, with no task waiting for it: it started, and reads at work as it always has.
  { rule: 'started', state: 'working', cause: 'working', lacks: 'no start in the last day',
    match: (f, now) => (f.status === 'running' && !f.queued && recent(f, now) ? { why: `last seen ${ago(f.last_seen, now)} ago`, plain: 'at work', since: f.last_seen, waits_on: 'agent', facts: [f.seenBy] } : undefined) },
  { rule: 'queued', state: 'queued', cause: 'queued', lacks: 'no task it hasn\'t started',
    match: (f, now) => (f.queued && f.status === 'running' && recent(f, now) ? { why: 'its task is queued, and its agent hasn\'t started it', since: f.queued.ts, waits_on: 'agent', facts: [f.queued] } : undefined) },
  { rule: 'pass', state: 'PASS', cause: 'pass', lacks: 'its newest claim has no PASS in force',
    match: (f) => (f.claim && !f.claim.stale && f.claim.outcome === 'PASS' ? { why: 'its claim passed its checks', since: f.claim.made.ts, waits_on: null, facts: [f.claim.made, f.claim.judged] } : undefined) },
  { rule: 'interrupted', state: 'finished', cause: 'interrupted', lacks: 'no turn you interrupted',
    match: (f, now) => (f.status === 'finished' && f.interrupted && recent(f, now) ? { why: `its turn was interrupted ${ago(f.last_seen, now)} ago`, plain: 'its turn was interrupted', since: f.last_seen, waits_on: 'you', facts: [f.interrupted, f.statusBy] } : undefined) },
  { rule: 'finished', state: 'finished', cause: 'finished', lacks: 'no turn stopped in the last day with nothing to judge',
    match: (f, now) => { const at = f.stopped?.ts ?? f.last_seen; return f.status === 'finished' && recent(f, now) ? { why: `its turn stopped ${ago(at, now)} ago`, plain: 'its turn stopped', since: at, waits_on: 'you', facts: [f.stopped ?? f.statusBy, f.seenBy] } : undefined; } },
  // Whatever is left: its hooks said unknown, a prompt it showed went unanswered, or no hook came in a day.
  { rule: 'quiet', state: 'quiet', cause: 'quiet', lacks: '',
    match: (f, now) => ({ why: `last seen ${ago(f.last_seen, now)} ago`, plain: 'no hook since', since: f.last_seen, waits_on: 'agent', facts: [f.seenBy, f.statusBy] }) },
];
/** The words in the table's order (#2018): every surface and `--why` name the rows above a state by these. */
export const WORDS: readonly State[] = [...new Set(TABLE.map((r) => r.state))];

/**
 * The state of one session, from its facts alone: the first row of the table that matches, with each fact that row
 * read and, for each row above it, the fact it lacked (#2018). The same call gives the word and the why, so no
 * surface reads why a second way.
 */
export function decide(f: SessionFacts, now: number): Reading {
  const lacked: Lacked[] = [];
  for (const row of TABLE) {
    const hit = row.match(f, now);
    if (!hit) { lacked.push({ rule: row.rule, state: row.state, fact: row.lacks }); continue; }
    const facts = hit.facts.filter((x): x is Fact => x !== undefined).filter((x, i, all) => all.findIndex((y) => y.log_pos === x.log_pos) === i);
    return { id: f.id, project_id: f.project_id, agent: f.agent, worktree: f.worktree, state: row.state, cause: row.cause, rule: row.rule, why: hit.why, plain: hit.plain ?? hit.why, since: hit.since, waits_on: hit.waits_on, facts, lacked, ...(f.note ? { note: f.note } : {}) };
  }
  throw new Error(`no row of the state table matched session ${f.id}`);
}

/**
 * Each session's state, from the record's tables through `query` (the hub's record, or its database read-only): the
 * one reading `deep status` lists and the hub records as `session.state` for the app (#992), each the first matching
 * row of the one ordered table (#2018).
 */
export async function sessionStates(query: (sql: string) => Promise<unknown[]>, now: number, only?: ReadonlySet<string>): Promise<Reading[]> {
  return (await sessionFacts(query, only)).map((f) => decide(f, now));
}

type Query = (sql: string) => Promise<unknown[]>;
const quoted = (v: string): string => `'${v.replace(/'/g, "''")}'`;
const fact = (kind: string | null, ts: number | null, log_pos: number | null): Fact | undefined => (kind !== null && ts !== null && log_pos !== null ? { kind, ts, log_pos } : undefined);

/** What the record holds of each session, of those `only` names when it names some, each value with its event (#2018). */
export async function sessionFacts(query: Query, only?: ReadonlySet<string>): Promise<SessionFacts[]> {
  // Of the sessions `only` names, when it names some: each query reads their events alone, through the session index.
  const of = (column: string) => (only ? ` AND ${column} IN (${[...only].map(quoted).join(', ')})` : '');
  // Read through the session index then, not the kind index, which would walk every session's events of the kind.
  const events = (alias = '') => `events${alias ? ` ${alias}` : ''}${only ? ' INDEXED BY events_session' : ''}`;
  // A database the hub hasn't opened since a column joined the table has none yet: the stop's cause (#85), and the
  // events its status and last sighting came from (#2018).
  const columns = new Set(((await query("SELECT name FROM pragma_table_info('sessions')")) as { name: string }[]).map((c) => c.name));
  const placed = columns.has('status_at');
  // A row no event of its own made is no session: as the row a transcript.archived makes, which names the session by
  // its handle, its letters and digits, and so not by its ID.
  const sessions = (await query(`SELECT s.id, s.project_id, s.agent, s.status, s.last_seen, s.worktree, ${columns.has('cause') ? 's.cause' : 'NULL AS cause'}, ${placed ? 'st.kind AS status_kind, st.ts AS status_ts, s.status_at, se.kind AS seen_kind, se.ts AS seen_ts, s.seen_at' : 'NULL AS status_kind, NULL AS status_ts, NULL AS status_at, NULL AS seen_kind, NULL AS seen_ts, NULL AS seen_at'} FROM sessions s${placed ? ' LEFT JOIN events st ON st.log_pos = s.status_at LEFT JOIN events se ON se.log_pos = s.seen_at' : ''} WHERE s.last_seen IS NOT NULL${of('s.id')}`)) as { id: string; project_id: string | null; agent: string | null; status: string; last_seen: number | null; worktree: string | null; cause: string | null; status_kind: string | null; status_ts: number | null; status_at: number | null; seen_kind: string | null; seen_ts: number | null; seen_at: number | null }[];
  const asks = new Map<string, { n: number; since: number | null; facts: Fact[] }>();
  for (const a of (await query(`SELECT a.session_id, a.created, e.ts, e.log_pos FROM asks a LEFT JOIN events e ON e.id = a.id WHERE a.status IN ('open', 'later') AND a.session_id IS NOT NULL${of('a.session_id')} ORDER BY a.created, a.id`)) as { session_id: string; created: number | null; ts: number | null; log_pos: number | null }[]) {
    const open = asks.get(a.session_id) ?? { n: 0, since: a.created, facts: [] };
    open.n += 1;
    const made = fact('ask.created', a.ts, a.log_pos);
    if (made) open.facts.push(made);
    asks.set(a.session_id, open);
  }
  // A process gone, unless the session started again since, as a resume does in a new process.
  const gone = new Map(((await query(`SELECT g.session_id, g.ts, g.log_pos FROM ${events('g')} WHERE g.kind = 'session.gone' AND g.session_id IS NOT NULL${of('g.session_id')} AND NOT EXISTS (SELECT 1 FROM events s WHERE s.session_id = g.session_id AND s.kind = 'session.start' AND s.log_pos > g.log_pos) ORDER BY g.log_pos`)) as { session_id: string; ts: number; log_pos: number }[]).map((r) => [r.session_id, { kind: 'session.gone', ts: r.ts, log_pos: r.log_pos }]));
  const due = await duePromises(query, events(), of('session_id'));
  // The newest reading that says why a session's holds don't apply (#39): watch-only past its facts, a stop not held,
  // or a call DeepBuild denied that ran anyway (#1033).
  const noted = ((await query(`SELECT session_id, json_extract(data, '$.reading') AS text, ts, log_pos FROM ${events()} WHERE kind = 'session.reading' AND session_id IS NOT NULL${of('session_id')} AND (json_extract(data, '$.reading') LIKE '%watch-only%' OR json_extract(data, '$.reading') LIKE 'DeepBuild denied % and it ran anyway%' OR json_extract(data, '$.reading') LIKE 'Its Claude Code home loads no mod%' OR json_extract(data, '$.reading') LIKE 'Hooks can run again%' OR json_extract(data, '$.reading') LIKE '% ran unleased: %' OR (json_extract(data, '$.reading') LIKE 'This stop isn''t held%' AND NOT EXISTS (SELECT 1 FROM events later WHERE later.session_id = events.session_id AND later.log_pos > events.log_pos AND later.kind = 'user.ask' AND json_extract(later.data, '$.from') <> 'subagent'))) ORDER BY log_pos`)) as { session_id: string; text: string; ts: number; log_pos: number }[]);
  // Hooks that can run again (#993) take back each "hooks can't run" before them, and show nothing of their own.
  const notes = new Map<string, { text: string; at: Fact }>();
  const shown = new Map<string, { text: string; at: Fact }[]>();
  for (const r of noted) {
    const kept = shown.get(r.session_id) ?? [];
    // A home that no longer loads an overriding mod takes back its watch-only line the same way (#1033).
    shown.set(r.session_id, r.text.startsWith(CAN_RUN) ? kept.filter((t) => !t.text.startsWith(CANT_RUN)) : r.text.startsWith(MODS_GONE) ? kept.filter((t) => !t.text.startsWith(MODS_WATCH)) : [...kept, { text: r.text, at: { kind: 'session.reading', ts: r.ts, log_pos: r.log_pos } }]);
    const last = shown.get(r.session_id)!.at(-1);
    if (last) notes.set(r.session_id, last);
    else notes.delete(r.session_id);
  }
  // A session waiting on its monitor (#997): the newest of its monitor readings says so, with no stop of its own or end since.
  const watching = new Map(((await query(`SELECT r.session_id, json_extract(r.data, '$.reading') AS text, r.ts, r.log_pos FROM ${events('r')} WHERE r.kind = 'session.reading' AND r.session_id IS NOT NULL${of('r.session_id')} AND json_extract(r.data, '$.reading') LIKE 'Waiting on its monitor%' AND NOT EXISTS (SELECT 1 FROM events later WHERE later.session_id = r.session_id AND later.log_pos > r.log_pos AND (later.kind = 'session.end' OR (later.kind = 'agent.stop' AND json_extract(later.data, '$.child') IS NULL) OR (later.kind = 'session.reading' AND json_extract(later.data, '$.reading') LIKE 'Its monitor%'))) ORDER BY r.log_pos`)) as { session_id: string; text: string; ts: number; log_pos: number }[]).map((r) => [r.session_id, { text: r.text, at: { kind: 'session.reading', ts: r.ts, log_pos: r.log_pos } }]));
  // A turn you interrupted, with no prompt since (#39).
  const interrupted = new Map(((await query(`SELECT e.session_id, e.ts, e.log_pos FROM ${events('e')} WHERE e.kind = 'session.reading'${of('e.session_id')} AND json_extract(e.data, '$.reading') LIKE 'Interrupt:%' AND NOT EXISTS (SELECT 1 FROM events a WHERE a.session_id = e.session_id AND a.kind = 'user.ask' AND a.log_pos > e.log_pos) ORDER BY e.log_pos`)) as { session_id: string; ts: number; log_pos: number }[]).map((r) => [r.session_id, { kind: 'session.reading', ts: r.ts, log_pos: r.log_pos }]));
  // Each session's newest stop of its own: a hook after it, such as Claude Code's idle-prompt notification, is no later
  // stop, and nor is a subagent's.
  const stops = new Map(((await query(`SELECT session_id, MAX(ts) AS ts, log_pos FROM ${events()} WHERE kind = 'agent.stop' AND json_extract(data, '$.child') IS NULL AND session_id IS NOT NULL${of('session_id')} GROUP BY session_id`)) as { session_id: string; ts: number; log_pos: number }[]).map((r) => [r.session_id, { kind: 'agent.stop', ts: r.ts, log_pos: r.log_pos }]));
  const claims = await newestClaims(query, of);
  // An answer of yours whose delivery stalled or timed out (#2018), as the newest outcome its delivery recorded. A
  // database older than the deliveries table has none.
  const words = new Map<string, { outcome: string; at?: Fact }>();
  for (const d of (await query(`SELECT a.session_id, a.id, d.outcome FROM deliveries d JOIN asks a ON a.id = d.delivery WHERE d.outcome IN ('stalled', 'timed_out') AND a.session_id IS NOT NULL${of('a.session_id')}`).catch(() => [])) as { session_id: string; id: string; outcome: string }[]) {
    const [at] = (await query(`SELECT ts, log_pos FROM events WHERE kind = 'delivery.outcome' AND json_extract(data, '$.delivery') = ${quoted(`ask:${d.id}`)} ORDER BY log_pos DESC LIMIT 1`)) as { ts: number; log_pos: number }[];
    words.set(d.session_id, { outcome: d.outcome, ...(at ? { at: { kind: 'delivery.outcome', ts: at.ts, log_pos: at.log_pos } } : {}) });
  }
  // A task of the session's thread that no turn has started: read only for a session no hook has moved yet.
  const waiting = sessions.filter((s) => s.status === 'running').map((s) => s.id);
  const queued = new Map<string, Fact>();
  if (waiting.length) {
    for (const t of (await query(`SELECT json_extract(e.data, '$.thread') AS thread, e.ts, e.log_pos FROM events e JOIN tasks t ON t.task_ref = json_extract(e.data, '$.task_ref') WHERE e.kind = 'task.created' AND t.state = 'queued' AND t.thread IN (${waiting.map(quoted).join(', ')}) ORDER BY e.log_pos DESC`).catch(() => [])) as { thread: string; ts: number; log_pos: number }[]) queued.set(t.thread, { kind: 'task.created', ts: t.ts, log_pos: t.log_pos });
  }
  return sessions.map((s): SessionFacts => {
    const statusBy = fact(s.status_kind, s.status_ts, s.status_at);
    const seenBy = fact(s.seen_kind, s.seen_ts, s.seen_at);
    const note = notes.get(s.id);
    return {
      id: s.id, project_id: s.project_id, agent: s.agent, worktree: s.worktree, status: s.status, stopCause: s.cause, last_seen: s.last_seen,
      ...(statusBy ? { statusBy } : {}), ...(seenBy ? { seenBy } : {}), ...(asks.has(s.id) ? { asks: asks.get(s.id)! } : {}), ...(gone.has(s.id) ? { gone: gone.get(s.id)! } : {}),
      ...(words.has(s.id) ? { words: words.get(s.id)! } : {}), ...(note ? { note: note.text, ...(note.text.startsWith(CANT_RUN) ? { cantRun: note.at } : {}) } : {}),
      ...(due.has(s.id) ? { promised: due.get(s.id)! } : {}), ...(watching.has(s.id) ? { watching: watching.get(s.id)! } : {}), ...(interrupted.has(s.id) ? { interrupted: interrupted.get(s.id)! } : {}),
      ...(stops.has(s.id) ? { stopped: stops.get(s.id)! } : {}), ...(claims.has(s.id) ? { claim: claims.get(s.id)! } : {}), ...(queued.has(s.id) ? { queued: queued.get(s.id)! } : {}),
    };
  });
}

/**
 * Each session's newest claim (#2018), as `newestClaim` picks it: the verdict in force for it, the newest one a
 * commit that moved left stale when none is, and for a verdict that isn't PASS or FAIL who can clear it and the
 * evidence it leaves open. A database older than the claims tables has none.
 */
async function newestClaims(query: Query, of: (column: string) => string): Promise<Map<string, Claim>> {
  const out = new Map<string, Claim>();
  const newest = new Map<string, { id: string; subject_ref: string | null; round: number | null; made: Fact }>();
  for (const c of (await query(`SELECT c.id, c.session_id, c.subject_ref, c.round, e.ts, e.log_pos FROM claims c JOIN events e ON e.id = c.id WHERE c.session_id IS NOT NULL${of('c.session_id')} ORDER BY c.created, c.id`).catch(() => [])) as { id: string; session_id: string; subject_ref: string | null; round: number | null; ts: number; log_pos: number }[]) {
    newest.set(c.session_id, { id: c.id, subject_ref: c.subject_ref, round: c.round, made: { kind: 'claim.made', ts: c.ts, log_pos: c.log_pos } });
  }
  if (!newest.size) return out;
  const ids = [...newest.values()].map((c) => quoted(c.id)).join(', ');
  const verdicts = (await query(`SELECT v.claim_id, v.handle, v.outcome, v.stale, v.smallest, v.points_to, v.reasons, e.ts, e.log_pos FROM verdicts v JOIN events e ON e.id = v.id WHERE v.claim_id IN (${ids}) ORDER BY v.created, v.id`)) as { claim_id: string; handle: string | null; outcome: string; stale: number; smallest: string | null; points_to: string | null; reasons: string | null; ts: number; log_pos: number }[];
  for (const [session, c] of newest) {
    const own = verdicts.filter((v) => v.claim_id === c.id);
    const verdict = own.filter((v) => !v.stale).at(-1) ?? own.at(-1);
    const claim: Claim = { made: c.made, outcome: verdict?.outcome ?? null, round: c.round, owner: null, evidence: null, ...(verdict ? { judged: { kind: 'verdict.made', ts: verdict.ts, log_pos: verdict.log_pos } } : {}) };
    if (verdict?.stale) {
      const [stale] = (await query(`SELECT ts, log_pos FROM events WHERE kind = 'verdict.stale' AND json_extract(data, '$.verdict') = ${quoted(verdict.handle ?? '')} ORDER BY log_pos DESC LIMIT 1`)) as { ts: number; log_pos: number }[];
      claim.stale = stale ? { kind: 'verdict.stale', ts: stale.ts, log_pos: stale.log_pos } : claim.judged!;
    } else if (verdict && ['BLOCKED', 'INVALID', 'INCONCLUSIVE'].includes(verdict.outcome)) {
      // Who can clear it: the owner of the task raised for it that closed with no answer, else of the claim's task.
      const [task] = (await query(`SELECT owner FROM asks WHERE session_id = ${quoted(session)} AND kind = 'unblock' AND status NOT IN ('open', 'later', 'answered') AND owner IS NOT NULL ORDER BY created DESC, id DESC LIMIT 1`)) as { owner: string }[];
      const [owner] = task ? [task] : c.subject_ref ? ((await query(`SELECT owner FROM tasks WHERE task_ref = ${quoted(c.subject_ref)} AND owner IS NOT NULL`).catch(() => [])) as { owner: string }[]) : [];
      // The evidence it leaves open: its task's open item, else what the verdict itself names.
      const [item] = c.subject_ref ? ((await query(`SELECT text FROM open_items WHERE task_ref = ${quoted(c.subject_ref)} AND closed IS NULL ORDER BY opened DESC LIMIT 1`).catch(() => [])) as { text: string }[]) : [];
      let reason: string | undefined;
      try { const [first] = JSON.parse(verdict.reasons ?? '[]') as unknown[]; reason = typeof first === 'string' ? first : undefined; } catch { reason = undefined; }
      claim.owner = owner?.owner ?? null;
      claim.evidence = item?.text ?? verdict.smallest ?? reason ?? verdict.points_to ?? null;
    }
    out.set(session, claim);
  }
  return out;
}

/** Each session's row, from the record's tables through `query` (the hub's record, or its database read-only). */
export async function statusRows(query: (sql: string) => Promise<unknown[]>, now: number): Promise<StatusRow[]> {
  const facts = await sessionFacts(query);
  const sessions = facts.map((f) => decide(f, now));
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
  // Each session whose turn stopped, whatever its claim reads since (#2018): finished, or by its newest claim.
  const stopped = new Set(facts.filter((f) => f.status === 'finished').map((f) => f.id));
  const finished = rows.filter((r) => stopped.has(r.id) && !['needs you', 'stuck', 'flagged', 'working', 'queued', 'quiet'].includes(r.state));
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
async function duePromises(query: (sql: string) => Promise<unknown[]>, from = 'events', of = ''): Promise<Map<string, { due: number; quote: string; at: Fact }>> {
  const events = (await query(`SELECT session_id, kind, data, ts, log_pos FROM ${from} WHERE kind IN ('promise.set', 'promise.due', 'promise.woken', 'promise.blocked', 'session.end') AND session_id IS NOT NULL${of} ORDER BY log_pos`)) as { session_id: string; kind: string; data: string | Obj; ts: number; log_pos: number }[];
  const quotes = new Map<string, string>();
  const out = new Map<string, { due: number; quote: string; at: Fact }>();
  for (const e of events) {
    // A session that ended waits for no prompt: its due check is no longer anyone's row.
    if (e.kind === 'session.end') { out.delete(e.session_id); continue; }
    const d = (typeof e.data === 'string' ? JSON.parse(e.data) : e.data) as Obj;
    if (e.kind === 'promise.set') { quotes.set(String(d.promise), String(d.quote)); out.delete(e.session_id); }
    else if (e.kind === 'promise.due' && d.route === 'next_hook') out.set(e.session_id, { due: Number(d.due), quote: quotes.get(String(d.promise)) ?? '', at: { kind: 'promise.due', ts: e.ts, log_pos: e.log_pos } });
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
