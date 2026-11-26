// Test-side tools for #1456's AC2 and AC4 (README). AC2's record is one the merge base's hub wrote (fixtures/ledger.db):
// sessions played through a real hub's hooks, then readings appended as the hub's core appends them, through the real
// record, with the hub stopped. fixtures/base-states.json is what the merge base's `deep status --json` read from it.
// The hub under test opens a copy of that record after the record replays it, and its `deep status --json` is read at
// the same hub clock.
//
// Reused by import: #16's temp homes, hub process, socket client, hook requests and PID cleanup; the record's public
// entry for the replay. Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only
// by the PID it was started with; nothing touches the real ~/.deepbuild or ~/.claude; no network, no model.
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRecord } from '../../../packages/record/src/index.ts';
import {
  allEvents, cleanup as cleanup16, control, deep, hookRequest, installedRoot, makeHome, newSession, own, REPO, sendHook, sleep, startHub, stopHub, tempDir, ulid,
  type Hub, type Ran, type Session,
} from '../16/helpers.ts';

export { REPO, sleep, stopHub, type Hub };
export const HERE = fileURLToPath(new URL('./', import.meta.url));
export const FIXTURES = join(HERE, 'fixtures');
export const LEDGER = join(FIXTURES, 'ledger.db');
export const BASE_STATES = join(FIXTURES, 'base-states.json');
export const MINUTE = 60_000;

/** Each criterion's tag: `#1456.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const ID = {
  /** AC2: "A record written before this change, replayed, gives the same states as the merge base" */
  replay: '#1456.f70bc414',
  /** AC4: "`992/agree` holds" */
  agree: '#1456.6799dc51',
} as const;

export const cleanup = async (): Promise<void> => { await cleanup16(); };
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

export function needBuilds(): void {
  if (!existsSync(join(REPO, 'packages/cli/dist/main.js'))) blocked('no built CLI at packages/cli/dist/main.js; run npm run build --workspaces first');
  if (!existsSync(join(REPO, 'target/debug/deep-hook'))) blocked('no deep-hook under target/debug; run cargo build --locked -p deep-hook first');
}

// ---- The record AC2 replays (README, The record).

/**
 * A session: its hooks, a start, a prompt and `calls` shell calls; then, from the core, its turn ended finished when
 * `ended` (session.attention, as the core records an interrupted or a held turn's end), and its readings, in order. No
 * Stop hook: every stop the base judges makes a claim, whose says done would hide the rows below it.
 */
export interface Spec { key: string; calls: number; ended: boolean; readings: string[]; why: string }

const CANT_RUN = "BLOCKED: hooks can't run, so this session's holds and every block but the floor are watch-only: the hook entry runs /opt/gone/deep-hook, which is not there. Run `deep setup` to point them at a deep-hook that runs.";
const CAN_RUN = "Hooks can run again: this session's gates hold again.";
const MONITOR = 'Waiting on its monitor `tail -f build.log`: each event wakes it, and its stop is judged once the watch ends.';
/**
 * The sessions, each with the reading text the merge base's state reading matches (packages/hub/src/status.ts at the
 * base: its LIKE and startsWith on `session.reading`), and two with none. Every text is one the base's hub writes, with
 * its variable part filled in.
 */
export const SPECS: readonly Spec[] = [
  { key: 'hooks-cant-run', calls: 1, ended: false, readings: [CANT_RUN], why: "a reading that its hooks can't run" },
  { key: 'hooks-run-again', calls: 1, ended: false, readings: [CANT_RUN, CAN_RUN], why: "a reading that its hooks can't run, then one that they run again" },
  { key: 'monitor', calls: 1, ended: true, readings: [MONITOR], why: 'its turn ended, then a reading that it waits on its monitor' },
  { key: 'monitor-ended', calls: 1, ended: true, readings: [MONITOR, 'Its monitor `tail -f build.log` ended: the command exited 0.'], why: 'its turn ended, a monitor reading, then one that its monitor ended' },
  { key: 'interrupted', calls: 1, ended: true, readings: ['Interrupt: you pressed Esc while it ran `npm test`.'], why: 'its turn ended, then an interrupt reading' },
  { key: 'denied-ran-anyway', calls: 1, ended: false, readings: ['DeepBuild denied `rm -rf dist` and it ran anyway: a mod approved it past the guard.'], why: 'a reading that a denied call ran anyway' },
  { key: 'plain-working', calls: 2, ended: false, readings: [], why: 'no reading' },
  { key: 'plain-ended', calls: 2, ended: true, readings: [], why: 'its turn ended, and no reading' },
];

/** What base-states.json holds. */
export interface BaseStates {
  base: string;
  /** The hub clock both reads are taken at. */
  readAt: number;
  sessions: { key: string; id: string; why: string; row: Compared }[];
}
/**
 * A session's state as the readers show it (README, What "the same states" compares): from its `deep status --json`
 * row, its word, its status-map entry, whom it waits on, whether it reads unread and its flag's code; and from
 * `deep status <session> --why --json`, the state table's row that matched, which tells apart two rows of one word (an
 * interrupted turn and a stopped one both read finished).
 */
export interface Compared { word: unknown; entry: unknown; waits_on: unknown; unread: unknown; flag: unknown; rule: unknown }
export interface Row { id: string; session?: string; word: string; flag?: { code?: string }; [key: string]: unknown }

/**
 * Writes fixtures/ledger.db and fixtures/base-states.json from this checkout (README: it ran once, at the merge base):
 * each session's hooks through a real hub, each reading appended with the hub stopped, as the core appends one, then
 * the base's own `deep status --json` over a copy, at `readAt`.
 */
export async function makeRecord(base: string): Promise<BaseStates> {
  needBuilds();
  const home = makeHome();
  const repo = join(tempDir(), 'shop');
  mkdirSync(repo);
  const played: { spec: Spec; s: Session; agent: ChildProcess }[] = SPECS.map((spec) => ({ spec, s: newSession(home, 'claude-code', repo), agent: spawn('/bin/sleep', ['7200'], { stdio: 'ignore' }) }));
  let hub = await startHub({ home });
  for (const { spec, s, agent } of played) {
    own(agent.pid);
    const send = async (event: string, extra: Record<string, unknown> = {}): Promise<void> => {
      const r = await sendHook(hub.socket, { ...hookRequest(s, event, extra), pid: agent.pid!, ppid: agent.pid! }, 15_000);
      if (!r.ack) blocked(`the hub didn't acknowledge ${event} for ${spec.key}: ${JSON.stringify(r).slice(0, 600)}`);
    };
    await send('SessionStart');
    await send('UserPromptSubmit', { prompt: `work on ${spec.key}` });
    for (let c = 0; c < spec.calls; c++) {
      const call = { tool_name: 'Bash', tool_use_id: `toolu_${spec.key.replace(/-/g, '_')}_${c}`, tool_input: { command: `npm run step-${c}` } };
      await send('PreToolUse', call);
      await send('PostToolUse', { ...call, tool_response: { stdout: 'ok', stderr: '', interrupted: false } });
    }
  }
  // Each agent's process goes, and the hub records it gone (session.gone), so the record holds that and no later
  // reader's state hangs on whether some process now has the PID.
  for (const { agent } of played) agent.kill('SIGTERM');
  const conn = await control(hub);
  try {
    const deadline = Date.now() + 60_000;
    const gone = async () => new Set((await allEvents(conn)).filter((e) => e.kind === 'session.gone').map((e) => e.session));
    for (let seen = await gone(); played.some(({ s }) => !seen.has(s.id)); seen = await gone()) {
      if (Date.now() > deadline) blocked(`the hub recorded no session.gone for ${played.filter(({ s }) => !seen.has(s.id)).map(({ spec }) => spec.key).join(', ')} within 60 s of its process going`);
      await sleep(500);
    }
  } finally {
    conn.close();
  }
  await stopHub(hub);
  // The core's events, as it appends them at the base: a turn's end as session-state.ts's attention() records it
  // (session.attention@2), and each reading as core.ts's appendReading does (session.reading@1 { reading }).
  let now = Date.now();
  const record = await openRecord({ path: join(installedRoot(home), 'ledger.db'), now: () => now });
  try {
    for (const { spec, s } of played) {
      const core = { writer: 'core', actor: 'you', scope: 'you', session: s.id, agent: 'claude-code' };
      if (spec.ended) {
        now += 1_000;
        await record.append(core, { v: 2, id: ulid(now), kind: 'session.attention', ts: now, subject: `session:${s.id.replace(/[^0-9A-Za-z]/g, '')}`, data: { state: 'finished' } });
      }
      for (const reading of spec.readings) {
        now += 1_000;
        await record.append(core, { v: 1, id: ulid(now), kind: 'session.reading', ts: now, data: { reading } });
      }
    }
  } finally {
    await record.close();
  }
  mkdirSync(FIXTURES, { recursive: true });
  copyFileSync(join(installedRoot(home), 'ledger.db'), LEDGER);
  const readAt = now + 30 * MINUTE;
  hub = await openCopy(readAt);
  const read = await readStates(hub.home, played.map(({ s }) => s.id));
  await stopHub(hub);
  const states: BaseStates = {
    base, readAt,
    sessions: played.map(({ spec, s }) => ({ key: spec.key, id: s.id, why: spec.why, row: read.get(s.id) ?? blocked(`the base's deep status --json has no row for ${spec.key} (${s.id})`) })),
  };
  writeFileSync(BASE_STATES, `${JSON.stringify(states, null, 2)}\n`);
  return states;
}

/**
 * A copy of fixtures/ledger.db in a fresh home, replayed by the record (every projection rebuilt from the log), then a
 * real hub on it whose clock starts at `clock`.
 */
export async function openCopy(clock: number): Promise<Hub> {
  needBuilds();
  if (!existsSync(LEDGER)) blocked('no fixtures/ledger.db: the record the merge base wrote is missing');
  const home = makeHome();
  mkdirSync(installedRoot(home), { recursive: true, mode: 0o700 });
  const path = join(installedRoot(home), 'ledger.db');
  copyFileSync(LEDGER, path);
  const record = await openRecord({ path, now: () => clock });
  try {
    await record.rebuild();
  } finally {
    await record.close();
  }
  // Setup finished in this home, so `deep status` runs no first-run setup (#1002's marker).
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(installedRoot(home), 'setup-finished.json'), JSON.stringify({ version }));
  return startHub({ home, clock }, 60_000);
}

export const shown = (r: Ran): string => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(0, 2500))}, stderr ${JSON.stringify(r.stderr.slice(0, 800))}`;

/** One `deep` command's JSON, as you run it; a read that doesn't exit 0 with JSON fails, naming what it printed. */
async function deepJson<T>(home: string, args: readonly string[]): Promise<T> {
  const r = await deep(home, args, { timeoutMs: 120_000 });
  let parsed: T | undefined;
  try { parsed = JSON.parse(r.stdout) as T; } catch { parsed = undefined; }
  if (r.code !== 0 || parsed === undefined) throw Error(`deep ${args.join(' ')} must exit 0 and print JSON: ${shown(r)}`);
  return parsed;
}

/** Each of `ids`' state, as `deep status --json` and `deep status <session> --why --json` read it; none for a session with no row. */
export async function readStates(home: string, ids: readonly string[]): Promise<Map<string, Compared>> {
  const { rows } = await deepJson<{ rows?: Row[] }>(home, ['status', '--json']);
  if (!Array.isArray(rows)) throw Error(`deep status --json printed no rows: ${JSON.stringify(rows)}`);
  const states = new Map<string, Compared>();
  for (const id of ids) {
    const row = rows.find((r) => r.session === id);
    if (!row) continue;
    const { rule } = await deepJson<{ rule?: unknown }>(home, ['status', id, '--why', '--json']);
    states.set(id, { word: row.word, entry: row.entry, waits_on: row.waits_on, unread: row.unread, flag: row.flag?.code ?? null, rule: rule ?? null });
  }
  return states;
}

/** Each session whose state the hub under test reads otherwise than the merge base did, naming it and both states. */
export function moved(base: BaseStates, read: ReadonlyMap<string, Compared>): string[] {
  return base.sessions.flatMap(({ key, id, why, row }) => {
    const got = read.get(id);
    return JSON.stringify(got) === JSON.stringify(row) ? [] : [`session ${key} (${id}; ${why}): the merge base read ${JSON.stringify(row)}, this checkout reads ${got ? JSON.stringify(got) : 'no row'}`];
  });
}
