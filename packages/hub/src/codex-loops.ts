// What a Codex session's own records say at its stop (#39), as adapters/loops.facts.json names them: its plan windows
// and billing from the rollout's token events; its goal from the rollout's goal records; each heartbeat automation in
// Codex's home that targets the thread. Read off the hook's path, read-only, and never from a continuation prompt's
// words: the turn that completes a goal looks like the turns before it. The record keeps each as a session.reading,
// and the session's row shows the newest of each, a window with its age.
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

interface CodexFacts {
  versions: string[];
  windows: { limit: string; weeklyMinutes: number; ignoredOtherwise: string };
  billing: { plan: string[] };
  goals: { tools: string[]; statuses: string[]; continuing: string[]; store: { file: string; table: string } };
  heartbeats: { folder: string; file: string; kind: string; active: string };
}
const facts = (): CodexFacts => (JSON.parse(readFileSync(new URL('../../../adapters/loops.facts.json', import.meta.url), 'utf8')) as { agents: { codex: CodexFacts } }).agents.codex;

/** The loop a stop reads: looping, with its next prompt's due time when one is known, or a loop with none left. */
export type Loop = { state: 'looping'; due: number | null } | { state: 'none_left' };
export interface CodexReadings { version?: string; readings: string[]; loop?: Loop; limits?: Obj; account?: string }

/** Codex's home for a session: the folder its rollout sits under, since the shared daemon may not share this process's environment. */
function homeOf(transcript: string): string {
  const at = transcript.lastIndexOf('/sessions/');
  return at > 0 ? transcript.slice(0, at) : process.env.CODEX_HOME || join(homedir(), '.codex');
}

/** The thread's goal in the store in Codex's home, read-only: a goal set outside a tool call leaves no rollout record. */
function storedGoal(f: CodexFacts, home: string, session: string): { status: string; at: number } | undefined {
  try {
    const db = new DatabaseSync(join(home, f.goals.store.file), { readOnly: true });
    try {
      const row = db.prepare(`SELECT * FROM ${f.goals.store.table} WHERE thread_id = ?`).get(session) as { status?: unknown; updated_at_ms?: unknown } | undefined;
      return typeof row?.status === 'string' && f.goals.statuses.includes(row.status) ? { status: row.status, at: typeof row.updated_at_ms === 'number' ? row.updated_at_ms : -Infinity } : undefined;
    } finally { db.close(); }
  } catch { return undefined; }
}
/** The account Codex is signed in to, by its ID alone, which a window reading is filed under. */
function accountIn(home: string): string | undefined {
  try {
    const auth = JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8')) as { tokens?: { account_id?: unknown } };
    return typeof auth.tokens?.account_id === 'string' && auth.tokens.account_id ? auth.tokens.account_id : undefined;
  } catch { return undefined; }
}

/** One window's room, in the words a row shows; a reading is never a used percentage, so a missing one can't read as 0%. */
const windowLine = (name: string, used: number, at: string): string => `Codex ${name} window: ${Math.max(0, Math.round(100 - used))}% left, read at ${at}`;

/** Whether a rollout record is a call of one of Codex's goal tools: by its name, or by a script's `tools.<name>(`. */
const goalCall = (f: CodexFacts, payload: Obj): boolean => /_call$/.test(String(payload.type)) && typeof payload.call_id === 'string'
  && f.goals.tools.some((t) => payload.name === t || (typeof payload.input === 'string' && payload.input.includes(`tools.${t}(`)));
/** A goal record: a goal tool's output, `{"goal":{"threadId":…,"status":…}}`, for this thread; any other tool's text that looks like one is no record. */
function goalIn(f: CodexFacts, entry: Obj, session: string, calls: ReadonlySet<unknown>): string | undefined {
  const payload = isObj(entry.payload) ? entry.payload : undefined;
  if (!payload || !/_output$/.test(String(payload.type)) || !calls.has(payload.call_id)) return undefined;
  const parts = Array.isArray(payload.output) ? payload.output.map((p) => (isObj(p) ? p.text : undefined)) : [payload.output];
  for (const text of parts) {
    if (typeof text !== 'string' || !text.startsWith('{"goal"')) continue;
    try {
      const { goal } = JSON.parse(text) as { goal?: unknown };
      if (isObj(goal) && goal.threadId === session && typeof goal.status === 'string' && f.goals.statuses.includes(goal.status)) return goal.status;
    } catch { /* a tool's own text that only looks like one */ }
  }
  return undefined;
}

/** The next time an RRULE of a plain frequency and interval falls after `after`; null for a schedule it can't read exactly. */
function nextOf(rrule: string, after: number): number | null {
  const m = /^FREQ=(MINUTELY|HOURLY|DAILY|WEEKLY)(?:;INTERVAL=(\d+))?$/.exec(rrule);
  if (!m) return null;
  const size = { MINUTELY: 60_000, HOURLY: 3_600_000, DAILY: 86_400_000, WEEKLY: 604_800_000 }[m[1] as 'MINUTELY'];
  return after + size * Math.max(1, Number(m[2] ?? 1));
}

/** The flat `key = value` lines of an automation's TOML: strings and numbers. */
function flatToml(text: string): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Za-z_]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|(\d+))\s*$/.exec(line);
    if (m) out[m[1]!] = m[3] !== undefined ? Number(m[3]) : m[2]!;
  }
  return out;
}

/** The heartbeat automations that target this thread: an active one's due time, and whether any exists at all. */
function heartbeats(f: CodexFacts, home: string, session: string): { active: { id: string; due: number | null }[]; paused: boolean } {
  const out = { active: [] as { id: string; due: number | null }[], paused: false };
  let names: string[];
  try { names = readdirSync(join(home, f.heartbeats.folder)); } catch { return out; }
  for (const name of names) {
    let a: Record<string, string | number>;
    try { a = flatToml(readFileSync(join(home, f.heartbeats.folder, name, f.heartbeats.file), 'utf8')); } catch { continue; }
    if (a.kind !== f.heartbeats.kind || a.target_thread_id !== session) continue;
    if (a.status !== f.heartbeats.active) { out.paused = true; continue; }
    const last = Number(a.last_run_at ?? a.created_at);
    out.active.push({ id: String(a.id ?? name), due: Number.isFinite(last) ? nextOf(String(a.rrule ?? ''), last) : null });
  }
  return out;
}

/** What a thread's records say now; `continuation` says the turn came from no person, so a loop with nothing left reads as one. */
export async function codexReadings(session: string, transcript: string, turn: string | undefined, continuation: boolean): Promise<CodexReadings> {
  const f = facts();
  let text: string;
  try { text = await readFile(transcript, 'utf8'); } catch { return { readings: [] }; }
  let version: string | undefined;
  let goal: string | undefined;
  let goalAt = -Infinity;
  const goalCalls = new Set<unknown>();
  let plan: string | undefined;
  let tokens = false;
  const seen = new Map<string, { used: number; at: string }>();
  let reached = false;
  let newest: Obj | undefined;
  for (const raw of text.split('\n')) {
    if (!raw.includes('session_meta') && !raw.includes('token_count') && !raw.includes('goal') && !raw.includes('task_started')) continue;
    let entry: unknown;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (!isObj(entry) || !isObj(entry.payload)) continue;
    const payload = entry.payload;
    // Only what stands at this stop: the records end with its turn, as the facts' stop.turn reads a turn.
    if (entry.type === 'event_msg' && payload.type === 'task_started' && turn) {
      if (reached && payload.turn_id !== turn) break;
      if (payload.turn_id === turn) reached = true;
    }
    if (entry.type === 'session_meta' && typeof payload.cli_version === 'string') version = payload.cli_version;
    if (entry.type === 'event_msg' && payload.type === 'token_count') {
      tokens = true;
      if (!isObj(payload.rate_limits)) continue;
      const limits = payload.rate_limits;
      for (const key of f.billing.plan) if (typeof limits[key] === 'string') plan = limits[key] as string;
      // Another limit's snapshot, such as image_gen's, says nothing of the account's codex windows.
      if ((limits.limit_id ?? f.windows.limit) !== f.windows.limit) continue;
      newest = limits;
      for (const w of [limits.primary, limits.secondary]) {
        if (!isObj(w) || typeof w.used_percent !== 'number') continue;
        seen.set(typeof w.window_minutes === 'number' && w.window_minutes >= f.windows.weeklyMinutes ? 'weekly' : '5-hour', { used: w.used_percent, at: String(entry.timestamp ?? '') });
      }
    }
    if (goalCall(f, payload)) goalCalls.add(payload.call_id);
    const said = goalIn(f, entry, session, goalCalls);
    if (said) { goal = said; goalAt = Date.parse(String(entry.timestamp ?? '')) || -Infinity; }
  }
  if (version !== undefined && !f.versions.includes(version)) return { version, readings: [] };
  const readings = [...seen].map(([name, w]) => windowLine(name, w.used, w.at));
  if (tokens) readings.push(plan ? `Codex billing: your ${plan} plan, from the session's logs` : 'Codex billing: no plan in the session\'s logs, so an API account');
  const home = homeOf(transcript);
  // The store is newer than the rollout when Codex itself moved the goal, which leaves no record there.
  const stored = storedGoal(f, home, session);
  if (stored && (goal === undefined || stored.at > goalAt)) goal = stored.status;
  const beats = heartbeats(f, home, session);
  const dues = beats.active.flatMap((b) => (b.due === null ? [] : [b.due]));
  const due = dues.length ? Math.min(...dues) : null;
  let loop: Loop | undefined;
  if (goal !== undefined) {
    const going = f.goals.continuing.includes(goal);
    readings.push(going ? `Codex goal: ${goal}, looping` : `Codex goal: ${goal}, a loop with no automatic prompt left`);
    if (going) loop = { state: 'looping', due };
  }
  for (const b of beats.active) readings.push(`Codex heartbeat: ${b.id}, next automatic prompt due ${b.due === null ? 'on a schedule DeepBuild can\'t read' : new Date(b.due).toISOString()}`);
  if (beats.active.length) loop = { state: 'looping', due };
  else if (beats.paused || continuation) readings.push('Codex heartbeat: no automatic prompt left');
  if (!loop && (goal !== undefined || beats.paused || continuation)) loop = { state: 'none_left' };
  const account = newest && accountIn(home);
  return { ...(version ? { version } : {}), readings, ...(loop ? { loop } : {}), ...(newest && account ? { limits: newest, account } : {}) };
}

/** The reading naming a version whose loops the facts don't cover: it is left to the grace window. */
export const uncoveredLoops = (version: string): string => `Codex ${version} is past the loop facts: its goals and heartbeats aren't read, so its loops are left to the grace window`;

/** Whether the facts name loops for a version. */
export const loopsCovered = (version: string): boolean => facts().versions.includes(version);

/** The reading's name: a heartbeat by its automation, any other by what it reads. */
const readingName = (reading: string): string => /^Codex heartbeat: (?!no automatic)[^,]*/.exec(reading)?.[0] ?? reading.slice(0, reading.indexOf(':'));
/** Readings, oldest first, as they stand: the newest of each name, heartbeats cleared when none is left, and that cleared when one comes back. */
export function standingReadings(readings: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const reading of readings) {
    const name = readingName(reading);
    if (name === 'Codex heartbeat') { for (const k of [...out.keys()]) if (k.startsWith('Codex heartbeat:')) out.delete(k); }
    else if (name.startsWith('Codex heartbeat:')) out.delete('Codex heartbeat');
    out.set(name, reading);
  }
  return out;
}
/** Whether a new reading says what its name already stands at. */
export const stands = (standing: ReadonlyMap<string, string>, reading: string): boolean => standing.get(readingName(reading)) === reading;

/** Each session's newest Codex readings for its row, one per name; a window's reading says how old it is. */
export async function rowReadings(query: (sql: string) => Promise<unknown[]>, ids: readonly string[], now: number, since: (ms: number) => string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!ids.length) return new Map();
  const list = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
  const rows = (await query(`SELECT session_id, json_extract(data, '$.reading') AS reading FROM events WHERE kind = 'session.reading' AND session_id IN (${list}) AND json_extract(data, '$.reading') LIKE 'Codex %: %' ORDER BY log_pos`)) as { session_id: string; reading: string }[];
  for (const { session_id, reading } of rows) out.set(session_id, [...(out.get(session_id) ?? []), reading]);
  return new Map([...out].map(([id, list]) => [id, [...standingReadings(list).values()].map((reading) => {
    const read = /, read at (\d{4}-\S+)$/.exec(reading);
    const at = read ? Date.parse(read[1]!) : NaN;
    return read ? reading.slice(0, read.index) + (Number.isNaN(at) ? '' : `, read ${since(now - at)} ago`) : reading;
  })]));
}
