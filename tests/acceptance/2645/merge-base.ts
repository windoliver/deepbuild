// The merge base's two readers, the reference every criterion of #2645 compares with ("the list the merge base
// returns", "equal the merge base's"). Copied from the base commit 1a4b7d065b1ed115a54d6b506f9bdd516ca4a8c0:
// `newestList` from packages/hub/src/open-items.ts (lines 292-313) and `codexReadings` with the helpers it calls from
// packages/hub/src/codex-loops.ts (lines 14-176). The code is the base's, token for token, with one change: the line
// that read the file, `readFile(transcript, 'utf8')`, reads through `read`, which is that same call unless a caller
// passes another. The planted reader (planted.ts) is these readers with a read that drops a line cut by a block's edge.
// Both read the facts the change reads (adapters/*.facts.json, loops.facts.json), so the two sides differ only in how
// they read the transcript.
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readFacts } from '@deepbuild/adapters';
import { isRecord as isObj } from '@deepbuild/contracts';
import type { TaskListFacts } from '@deepbuild/gate';

/** How the merge base read a transcript: the whole file, decoded as UTF-8. */
export type Read = (transcript: string) => Promise<string>;
const whole: Read = (transcript) => readFile(transcript, 'utf8');

// ---- packages/hub/src/open-items.ts at the base

/** The agent's newest task list in its transcript: the last call of the facts' tool, its input (a Codex call's arguments). */
export async function baseNewestList(facts: TaskListFacts, transcript: string, read: Read = whole): Promise<unknown> {
  let text: string;
  try { text = await read(transcript); } catch { return undefined; }
  let newest: unknown;
  for (const raw of text.split('\n')) {
    if (!raw.includes(facts.tool)) continue;
    let line: unknown;
    try { line = JSON.parse(raw); } catch { continue; }
    if (!isObj(line)) continue;
    // Claude Code: an assistant entry's tool_use part.
    if (isObj(line.message) && Array.isArray(line.message.content)) {
      for (const part of line.message.content) if (isObj(part) && part.type === 'tool_use' && part.name === facts.tool) newest = part.input;
    }
    // Codex: a rollout response_item's function_call, its arguments as JSON text.
    const p = line.payload;
    if (line.type === 'response_item' && isObj(p) && p.type === 'function_call' && p.name === facts.tool && typeof p.arguments === 'string') {
      try { newest = JSON.parse(p.arguments); } catch { /* a call that doesn't parse lists nothing */ }
    }
  }
  return newest;
}

// ---- packages/hub/src/codex-loops.ts at the base

type Obj = Record<string, unknown>;

interface CodexFacts {
  versions: string[];
  windows: { limit: string; weeklyMinutes: number; ignoredOtherwise: string };
  billing: { plan: string[] };
  goals: { tools: string[]; statuses: string[]; continuing: string[]; store: { file: string; table: string } };
  heartbeats: { folder: string; file: string; kind: string; active: string };
}
const facts = (): CodexFacts => readFacts<{ agents: { codex: CodexFacts } }>('loops.facts.json').agents.codex;

/** The loop a stop reads: looping, with its next prompt's due time when one is known, or a loop with none left. */
type Loop = { state: 'looping'; due: number | null } | { state: 'none_left' };
interface CodexReadings { version?: string; readings: string[]; loop?: Loop; limits?: Obj; account?: string }

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
export async function baseCodexReadings(session: string, transcript: string, turn: string | undefined, continuation: boolean, read: Read = whole): Promise<CodexReadings> {
  const f = facts();
  let text: string;
  try { text = await read(transcript); } catch { return { readings: [] }; }
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
  const going = goal !== undefined && f.goals.continuing.includes(goal);
  if (goal !== undefined) {
    readings.push(going ? `Codex goal: ${goal}, looping` : `Codex goal: ${goal}, a loop with no automatic prompt left`);
    if (going) loop = { state: 'looping', due };
  }
  for (const b of beats.active) readings.push(`Codex heartbeat: ${b.id}, next automatic prompt due ${b.due === null ? 'on a schedule DeepBuild can\'t read' : new Date(b.due).toISOString()}`);
  if (beats.active.length) loop = { state: 'looping', due };
  else if ((beats.paused || continuation) && !going) readings.push('Codex heartbeat: no automatic prompt left');
  if (!loop && (goal !== undefined || beats.paused || continuation)) loop = { state: 'none_left' };
  const account = newest && accountIn(home);
  return { ...(version ? { version } : {}), readings, ...(loop ? { loop } : {}), ...(newest && account ? { limits: newest, account } : {}) };
}
