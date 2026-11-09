// The replay for #1024 (README): one Codex CLI thread through a real hub and real deep-hook, the hub restarted
// mid-session, the transcript archive's pass recording `transcript.archived`, more hooks after the restart, and what
// the hub's status shows at each step. The temp home, the hub, `deep setup` and `deep-hook codex <event>` are #39's
// helpers, imported by path. The thread's hooks and rollout are the 0.160.0 corpus recording `tools`, re-keyed.
import { expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, allEvents, deep, run, shown, startHub, stopHub, statusRows, waitFor, HOOK, childEnv, makeHome, type Ev, type Home, type Hub, type Line } from '../39/helpers.ts';

export const AC = { 1: 'AC1 #1024.f267e668', 2: 'AC2 #1024.bd7d9d35' } as const;

/** A session ID as the record's handles hold it: letters and digits only. */
export const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');

const CORPUS = join(REPO, 'adapters/corpus/codex/0.160.0/tools');
const RECORDED = '01a1581d-33f7-7b62-8f4f-c790574d966f';
const RECORDED_CWD = '/private/tmp';

/** What the hub showed at one step: `status.read`'s rows, `deep status`'s text and `deep hub status`'s JSON. */
export interface Seen { step: string; rows: Line[]; status: string; hubStatus: string }
export interface Replayed { h: Home; thread: string; handle: string; seen: Seen[]; events: Ev[] }

/**
 * Why a listing of rows fails AC1 for the thread, naming every ID it shows the thread under; undefined when it shows
 * the thread as one row under the form its SessionStart gave.
 */
export function twoRows(rows: readonly Line[], thread: string, step: string): string | undefined {
  const same = rows.filter((r) => typeof r.id === 'string' && letters(r.id) === letters(thread));
  if (same.length === 1 && same[0]!.id === thread) return undefined;
  return `${step}: the hub shows thread ${thread} as ${same.length} row${same.length === 1 ? '' : 's'}, not one under its SessionStart's ID: ${same.map((r) => `${String(r.id)} (agent ${JSON.stringify(r.agent)}, ${JSON.stringify(r.state)})`).join(' and ') || 'none'}`;
}
/** Every object in `deep hub status`'s JSON naming the thread by `id` or `session`, in either form. */
export function hubStatusRows(text: string, thread: string): Line[] {
  const found: Line[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v !== 'object' || v === null) return;
    const o = v as Line;
    const id = typeof o.id === 'string' ? o.id : typeof o.session === 'string' ? o.session.replace(/^session:/, '') : undefined;
    if (id !== undefined && letters(id) === letters(thread)) found.push({ ...o, id });
    Object.values(o).forEach(walk);
  };
  try { walk(JSON.parse(text)); } catch { /* not JSON: nothing listed */ }
  return found;
}
/** How many sessions `deep status` says it lists (its second line), or undefined when it says none. */
export const statusCount = (text: string): number | undefined => {
  const m = /^(\d+) sessions?\b/m.exec(text);
  return m ? Number(m[1]) : undefined;
};

// ---- The recording, re-keyed: a fresh thread ID, the test's folder, a rollout where Codex 0.160.0 keeps it.
const lines = (file: string) => readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
/** Each string of a recorded line, one at a time: the rollout's path, the recorded folder and the recorded thread ID replaced. */
function rekey(line: string, thread: string, cwd: string, rollout: string): Line {
  const each = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) return v.map((x) => each(x));
    if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, each(x, k)]));
    if (typeof v !== 'string') return v;
    if (key === 'transcript_path') return rollout;
    const moved = v === RECORDED_CWD ? cwd : v.startsWith(`${RECORDED_CWD}/`) ? `${cwd}${v.slice(RECORDED_CWD.length)}` : v;
    return moved.replaceAll(RECORDED, thread);
  };
  return each(JSON.parse(line)) as Line;
}

async function seen(h: Home, hub: Hub, step: string): Promise<Seen> {
  const rows = await statusRows(hub);
  const status = await deep(h, ['status']);
  if (status.code !== 0) throw Error(`BLOCKED: deep status must read the hub (exit 0) at ${step}: ${shown(status)}`);
  const hubStatus = await deep(h, ['hub', 'status']);
  if (hubStatus.code !== 0) throw Error(`BLOCKED: deep hub status must read the hub (exit 0) at ${step}: ${shown(hubStatus)}`);
  return { step, rows, status: status.stdout, hubStatus: hubStatus.stdout };
}
/** The archive's transcript.archived for the thread's handle that copied the rollout at its size now, from either hub's pass. */
const archivedAt = async (hub: Hub, handle: string, size: number) =>
  waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'transcript.archived' && e.data?.session === `session:${handle}` && Number(e.data?.source?.size) === size), 180_000, `the archive's transcript.archived for session:${handle} at ${size} bytes`).catch(async (error: Error) => {
    const archived = (await allEvents(hub)).filter((e) => e.kind === 'transcript.archived').map((e) => `${e.log_pos} ${JSON.stringify(e.data?.session)} ${String(e.data?.source?.size)} bytes`);
    throw Error(`BLOCKED: ${error.message}; transcript.archived in the record: ${archived.join(', ') || 'none'}; the hub said: ${hub.output().slice(-1500)}`);
  });

export async function replay(): Promise<Replayed> {
  const h = makeHome();
  const thread = randomUUID();
  const handle = letters(thread);
  const cwd = join(h.tmp, 'shop');
  mkdirSync(cwd, { recursive: true });
  // Where Codex 0.160.0 keeps a thread's rollout (its facts' transcripts.path): sessions/YYYY/MM/DD/rollout-<time>-<thread>.jsonl.
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const day = join(h.codexHome, 'sessions', String(now.getFullYear()), p2(now.getMonth() + 1), p2(now.getDate()));
  mkdirSync(day, { recursive: true });
  const rollout = join(day, `rollout-${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}T${p2(now.getHours())}-${p2(now.getMinutes())}-${p2(now.getSeconds())}-${thread}.jsonl`);
  const hooks = lines(join(CORPUS, 'events.jsonl')).map((l) => rekey(l, thread, cwd, rollout).payload as Line);
  // Changed from the recording: the CLI's own originator and source, as the issue's run was in the Codex CLI.
  const transcript = lines(join(CORPUS, 'transcript.jsonl')).map((l) => {
    const e = rekey(l, thread, cwd, rollout);
    if (e.type === 'session_meta') Object.assign(e.payload as Line, { originator: 'codex_cli_rs', source: 'cli' });
    return JSON.stringify(e);
  });
  for (const p of hooks) {
    if (p.session_id !== thread || p.transcript_path !== rollout) throw Error(`BLOCKED: the recording didn't re-key: ${JSON.stringify(p).slice(0, 300)}`);
  }
  // The rollout's lines up to the first command's result go with the first hooks; the model's next lines, up to the
  // patch's call, after setup and before the restart; the rest after the restart.
  const cut = transcript.findIndex((l) => (JSON.parse(l) as Line).payload?.type === 'token_count');
  const cut2 = transcript.findIndex((l, i) => i > cut && (JSON.parse(l) as Line).payload?.type === 'custom_tool_call');
  const hook = async (p: Line) => {
    const r = await run(HOOK, ['codex', String(p.hook_event_name)], { cwd, env: childEnv(h), input: JSON.stringify(p), timeoutMs: 90_000 });
    if (r.code !== 0) throw Error(`BLOCKED: deep-hook codex ${String(p.hook_event_name)} must exit 0: ${shown(r)}`);
  };
  const out: Seen[] = [];

  let hub = await startHub(h);
  try {
    // The session starts and its first turn runs its first command.
    writeFileSync(rollout, `${transcript.slice(0, cut + 1).join('\n')}\n`);
    for (const p of hooks.slice(0, 4)) await hook(p);
    out.push(await seen(h, hub, 'before the restart'));
    // Setup runs mid-session (it writes the runner's login_path; its wiki build runs an archive pass), the model writes
    // on, and the hub is restarted to pick up login_path.
    const setup = await deep(h, ['setup']);
    if (setup.code !== 0) throw Error(`BLOCKED: deep setup must exit 0: ${shown(setup)}`);
    appendFileSync(rollout, `${transcript.slice(cut + 1, cut2).join('\n')}\n`);
    await stopHub(hub);
    hub = await startHub(h);
    // The restarted hub's archive pass copies the rollout as it grew and records transcript.archived under the handle
    // (or a pass of the first hub's still under way did; either is the record's transcript.archived of that rollout).
    await archivedAt(hub, handle, statSync(rollout).size);
    out.push(await seen(h, hub, 'after the restart and transcript.archived'));
    // The turn goes on after the restart: the patch, the second command and the stop.
    appendFileSync(rollout, `${transcript.slice(cut2).join('\n')}\n`);
    for (const p of hooks.slice(4)) await hook(p);
    out.push(await seen(h, hub, 'after the hooks that followed the restart'));
    const events = await allEvents(hub);
    // The record holds the thread in both forms: the SessionStart's dashed ID and the archive's dashless handle.
    expect(events.some((e) => e.kind === 'session.start' && e.session === thread), `BLOCKED: no session.start under ${thread}`).toBe(true);
    expect(events.some((e) => e.kind === 'transcript.archived' && e.data?.session === `session:${handle}`), `BLOCKED: no transcript.archived for session:${handle}`).toBe(true);
    return { h, thread, handle, seen: out, events };
  } finally {
    await stopHub(hub);
  }
}
