// Shared test-side tools for #997's acceptance tests (README): the criterion tags, the recorded monitor session's
// place in the corpus and what it must hold, a made-up twin of it shaped as the issue describes, a replay of a
// corpus-shaped session through the real deep-hook into `deep hub run`, and the readings the criteria name: the
// session's row after each stop (`status.read`), each stop's loop reading, the gate's judgements and the
// notifications. The #18 mapping suite's helpers (the hub as a process, deep-hook, the record over the socket) are
// imported, never copied. Nothing here stands in for the hub, the adapter or deep-hook.
//
// Safety: every folder is under /tmp/dh18m-* (made by ../18/mapping/helpers.ts) and removed after each file; no
// network, no model, no real `claude`; a process a test starts is stopped by its PID only, never by name or port.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Conn, deepHook, kindOf, ofSession, REPO, run, settle, tempDir, claudeEnv, type Ev, type Hub, type Line } from '../18/mapping/helpers.ts';

// ---- Criterion tags: `#997.<first 8 hex of the SHA-256 of the criterion's text>`, as scripts/proof-change.mjs computes them.
export const AC1 = 'AC1 #997.13bd3097';
export const AC2 = 'AC2 #997.a820a75b';

/** The planted wrong program AC1's Proof names: the hub reads loop facts as the merge base does, with no Monitor (README, Surfaces). */
export const PLANT = 'monitor-unread';
/** The recorded session's name in the corpus (README, The fixture). */
export const SET = 'monitor';

// ---- The corpus.
const CORPUS = join(REPO, 'adapters/corpus/claude-code');
const covered = (): string[] => (JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions;
const lines = (path: string): Line[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Line) : []);

/** A corpus-shaped session: its hook payloads in order and its transcript. */
export interface Recorded { where: string; version: string; payloads: Line[]; transcript: Line[]; cases: Line[]; meta: Line }
/**
 * The recorded monitor session: `adapters/corpus/claude-code/<v>/monitor/` for the newest version `v` the facts cover
 * that holds one. Undefined when no covered version holds it.
 */
export function recorded(): Recorded | undefined {
  const versions = covered().filter((v) => existsSync(join(CORPUS, v, SET, 'events.jsonl'))).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const version = versions.at(-1);
  if (!version) return undefined;
  const dir = join(CORPUS, version, SET);
  const cases = lines(join(dir, 'events.jsonl'));
  return { where: `adapters/corpus/claude-code/${version}/${SET}`, version, payloads: cases.map((c) => c.payload as Line), transcript: lines(join(dir, 'transcript.jsonl')), cases, meta: existsSync(join(dir, 'session.json')) ? JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8')) as Line : {} };
}
/** Every version folder of the corpus that holds a monitor session, covered or not, for the failure message. */
export const anywhere = (): string[] => (existsSync(CORPUS) ? readdirSync(CORPUS).filter((v) => existsSync(join(CORPUS, v, SET))) : []);

const textOf = (content: unknown): string => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (typeof c === 'object' && c && typeof (c as Line).text === 'string' ? (c as Line).text : '')).join('\n') : '');
/** Every string a value holds, at any depth. */
export const strings = (value: unknown): string[] => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);

/** What the issue says the session holds, read off its payloads: the watch, its three wakes, its stop, and each turn's Stop. */
export interface Shape { monitor: Line; watch: string; wakes: Line[]; taskStop: Line; stops: Line[]; problems: string[] }
export function shapeOf(s: Recorded): Shape {
  const problems: string[] = [];
  const p = s.payloads;
  const post = (tool: string) => p.filter((x) => x.hook_event_name === 'PostToolUse' && x.tool_name === tool);
  const [monitor] = post('Monitor');
  const [taskStop] = post('TaskStop');
  if (post('Monitor').length !== 1) problems.push(`one PostToolUse of a Monitor call (it has ${post('Monitor').length})`);
  if (!p.some((x) => x.hook_event_name === 'PreToolUse' && x.tool_name === 'Monitor')) problems.push('the Monitor call\'s PreToolUse');
  if (monitor && typeof monitor.tool_input?.command !== 'string') problems.push(`the Monitor call's input carries its command: ${JSON.stringify(monitor.tool_input)}`);
  if (post('TaskStop').length !== 1) problems.push(`one PostToolUse of a TaskStop call (it has ${post('TaskStop').length})`);
  // The watch's ID: the value TaskStop names that the Monitor call's response also carries.
  const named = taskStop ? strings(taskStop.tool_input) : [];
  const answered = monitor ? strings(monitor.tool_response) : [];
  const watch = named.find((id) => id.length >= 4 && answered.some((a) => a.includes(id))) ?? '';
  if (!watch) problems.push(`TaskStop names the watch the Monitor call started (TaskStop's input ${JSON.stringify(taskStop?.tool_input)}, the Monitor's response ${JSON.stringify(monitor?.tool_response)})`);
  const at = (x: Line | undefined) => (x ? p.indexOf(x) : -1);
  const wakes = p.filter((x) => x.hook_event_name === 'UserPromptSubmit' && typeof x.prompt === 'string' && x.prompt.includes('<task-notification>') && (!watch || x.prompt.includes(watch)));
  if (wakes.length !== 3) problems.push(`three prompts that are the monitor's events (<task-notification> naming ${watch || 'the watch'}), it has ${wakes.length}`);
  if (wakes.some((w) => at(w) < at(monitor))) problems.push('every wake comes after the Monitor call');
  if (at(taskStop) < at(wakes.at(-1))) problems.push('TaskStop comes after the third wake');
  for (const w of wakes) {
    const entry = s.transcript.find((e) => e.type === 'user' && e.promptId === w.prompt_id && textOf(e.message?.content).includes('<task-notification>'));
    if (!entry) problems.push(`the transcript entry of the wake whose prompt_id is ${w.prompt_id}`);
  }
  const stops = p.filter((x) => x.hook_event_name === 'Stop' && !x.agent_id);
  if (stops.length !== 4) problems.push(`four Stops of the session's own: the one that armed the watch and one per wake (it has ${stops.length})`);
  // Each Stop between: after the arming, one before each wake, and the last after TaskStop.
  for (const [i, w] of wakes.entries()) if (!stops.some((x) => at(x) < at(w) && at(x) > (i ? at(wakes[i - 1]) : at(monitor)))) problems.push(`a Stop before wake ${i + 1}`);
  if (!stops.some((x) => at(x) > at(taskStop))) problems.push('a Stop after TaskStop');
  return { monitor: monitor ?? {}, watch, wakes, taskStop: taskStop ?? {}, stops, problems };
}

// ---- The made-up twin: the session the issue describes, shaped as Claude Code writes one (README, The twin).
const TWIN_VERSION = '2.1.308';
const MODEL = 'claude-haiku-5-5';
export function twin(): Recorded {
  const session = '5f0c2b1e-9d1a-4c7e-8b2a-997997997997';
  const cwd = '/tmp/deep-corpus-twin/work';
  const transcript_path = `/tmp/deep-corpus-twin/.claude/projects/-tmp-deep-corpus-twin-work/${session}.jsonl`;
  const watch = 'bm7q4x2k9';
  const command = 'tail -F build.log | grep --line-buffered -E "PASS|FAIL"';
  const description = 'build results in build.log';
  const base = { session_id: session, transcript_path, cwd, permission_mode: 'default' };
  const payloads: Line[] = [];
  const entries: Line[] = [];
  let parent: string | null = null;
  let n = 0;
  const entry = (value: Line) => {
    const uuid = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    entries.push({ parentUuid: parent, isSidechain: false, ...value, uuid, timestamp: new Date(Date.UTC(2026, 10, 2, 9, 0, n)).toISOString(), userType: 'external', entrypoint: 'cli', cwd, sessionId: session, version: TWIN_VERSION, gitBranch: 'main' });
    parent = uuid;
  };
  const usage = { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 12 };
  const say = (text: string) => entry({ type: 'assistant', message: { model: MODEL, id: `msg_${n}`, type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage } });
  const stop = (prompt_id: string, text: string) => { say(text); payloads.push({ ...base, prompt_id, effort: { level: 'medium' }, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: text, background_tasks: [{ id: watch, type: 'monitor', status: 'running', description }], session_crons: [] }); };
  const call = (prompt_id: string, tool: string, id: string, input: Line, response: Line) => {
    entry({ type: 'assistant', message: { model: MODEL, id: `msg_${n}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id, name: tool, input }], stop_reason: 'tool_use', usage } });
    payloads.push({ ...base, prompt_id, effort: { level: 'medium' }, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: id });
    entry({ promptId: prompt_id, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(response) }] }, toolUseResult: response });
    payloads.push({ ...base, prompt_id, effort: { level: 'medium' }, hook_event_name: 'PostToolUse', tool_name: tool, tool_input: input, tool_response: response, tool_use_id: id, duration_ms: 40 });
  };
  payloads.push({ session_id: session, transcript_path, cwd, hook_event_name: 'SessionStart', source: 'startup', model: MODEL });
  const asked = 'Watch build.log with a monitor and tell me each PASS or FAIL line; stop watching after the third.';
  const p0 = '7a1d0c55-0000-4000-8000-000000000000';
  entry({ promptId: p0, type: 'user', message: { role: 'user', content: asked }, origin: { kind: 'human' }, turnOrigin: 'human', turnPosition: { promptIndex: 1, turnIndex: 1 } });
  payloads.push({ ...base, prompt_id: p0, hook_event_name: 'UserPromptSubmit', prompt: asked });
  call(p0, 'Monitor', 'toolu_01MonitorArmsTheWatch00', { command, description, timeout_ms: 1_800_000 }, { taskId: watch, description, timeoutMs: 1_800_000 });
  stop(p0, `I armed a monitor (task ${watch}) on build.log; I will report each result line.`);
  for (let i = 1; i <= 3; i++) {
    const p = `7a1d0c55-0000-4000-8000-00000000000${i}`;
    const text = `<task-notification>\n<task-id>${watch}</task-id>\n<summary>Monitor event: "${description}"</summary>\n<event>step ${i}: PASS</event>\n</task-notification>`;
    entry({ type: 'queue-operation', operation: 'enqueue', content: text });
    entry({ type: 'queue-operation', operation: 'dequeue' });
    entry({ promptId: p, type: 'user', message: { role: 'user', content: text }, isMeta: true, promptSource: 'system', origin: { kind: 'task-notification', producer: 'session-task' }, turnOrigin: 'task_notification', queueSkipAttachments: true, turnPosition: { promptIndex: 1, turnIndex: i + 1 } });
    payloads.push({ ...base, prompt_id: p, hook_event_name: 'UserPromptSubmit', prompt: text });
    if (i === 3) call(p, 'TaskStop', 'toolu_01TaskStopEndsTheWatch0', { task_id: watch }, { message: `Successfully stopped task: ${watch} (${command})`, task_id: watch, task_type: 'monitor', command });
    if (i === 3) { say(`Step 3 passed. That was the third result, so I stopped the monitor.`); payloads.push({ ...base, prompt_id: p, effort: { level: 'medium' }, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Step 3 passed. That was the third result, so I stopped the monitor.', background_tasks: [], session_crons: [] }); }
    else stop(p, `Step ${i} passed.`);
  }
  return { where: 'tests/acceptance/997 (made-up twin)', version: TWIN_VERSION, payloads, transcript: entries, cases: payloads.map((payload) => ({ payload })), meta: { scenario: SET } };
}

// ---- The replay: each payload through the real deep-hook, the transcript written up to its hook's place.
/** How many transcript entries Claude Code had written when each hook fired, read off the transcript's own order. */
export function cuts(s: Recorded): number[] {
  const t = s.transcript;
  const find = (from: number, test: (e: Line) => boolean): number => { for (let i = from; i < t.length; i++) if (test(t[i]!)) return i; return -1; };
  const uses = (e: Line, id: string, type: string) => Array.isArray(e.message?.content) && e.message.content.some((c: Line) => c?.type === type && (c.id === id || c.tool_use_id === id));
  let at = 0;
  return s.payloads.map((p) => {
    const event = String(p.hook_event_name);
    let upTo = at;
    if (event === 'UserPromptSubmit') { const i = find(at, (e) => e.type === 'user' && e.promptId === p.prompt_id); if (i >= 0) upTo = i + 1; }
    else if (event === 'PreToolUse' || event === 'PermissionRequest') { const i = find(at, (e) => e.type === 'assistant' && uses(e, String(p.tool_use_id), 'tool_use')); if (i >= 0) upTo = i + 1; }
    else if (event === 'PostToolUse' || event === 'PostToolUseFailure') { const i = find(at, (e) => uses(e, String(p.tool_use_id), 'tool_result')); if (i >= 0) upTo = i + 1; }
    else if (event === 'Stop' || event === 'StopFailure' || event === 'SessionEnd') {
      // The turn's own entries: up to the next prompt's, less the queue's entries that came with it.
      let next = find(at, (e) => e.type === 'user' && typeof e.promptId === 'string' && e.promptId !== p.prompt_id && !uses(e, '', 'tool_result') && !Array.isArray(e.message?.content));
      if (next < 0 || event === 'SessionEnd') next = t.length;
      while (next > at && t[next - 1]!.type === 'queue-operation') next--;
      upTo = next;
    }
    at = Math.max(at, upTo);
    return at;
  });
}

export interface Replay {
  session: string;
  /** The session's row (status.read) after each Stop, in order, with the hook's own reply. */
  rows: { stop: number; row: Line | undefined; reply: string }[];
  events: Ev[];
  hub: Hub;
}
/** The control connection, as the CLI holds one. */
async function control<T>(hub: Hub, use: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
    return await use(conn);
  } finally {
    conn.close();
  }
}
export const rowOf = (hub: Hub, id: string): Promise<Line | undefined> => control(hub, async (conn) => ((await conn.call('status.read')).rows as Line[]).find((r) => r.id === id));

/**
 * Replays `s` into `hub` as a session of its own folder and transcript (its session ID kept), each payload through
 * `deep-hook claude-code <event>` as Claude Code's hook entry runs it, and reads the row after each Stop once the
 * record has it.
 */
export async function replay(hub: Hub, s: Recorded): Promise<Replay> {
  const first = s.payloads[0]!;
  const session = String(first.session_id);
  const cwd = join(tempDir(), 'work');
  mkdirSync(cwd);
  const transcript = join(hub.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${session}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  const from = { cwd: String(first.cwd), transcript: String(first.transcript_path) };
  const rewrite = (value: Line): Line => JSON.parse(JSON.stringify(value).replaceAll(from.transcript, transcript).replaceAll(from.cwd, cwd)) as Line;
  const written = s.transcript.map((e) => JSON.stringify(rewrite(e)));
  const upTo = cuts(s);
  const hook = await deepHook();
  const env = claudeEnv(hub.home, cwd);
  const rows: Replay['rows'] = [];
  for (const [i, raw] of s.payloads.entries()) {
    writeFileSync(transcript, upTo[i]! ? `${written.slice(0, upTo[i]).join('\n')}\n` : '');
    const payload = rewrite(raw);
    delete payload.scratchpad_dir;
    const event = String(payload.hook_event_name);
    const ran = await run(hook, ['claude-code', event], { cwd, env, input: JSON.stringify(payload), timeoutMs: 120_000 });
    if (event === 'Stop' && !payload.agent_id) {
      const n = rows.length + 1;
      await settle(hub, (all) => kindOf(all, session, 'agent.stop').filter((e) => !e.data.child).length >= n, { timeoutMs: 30_000, minMs: 500, quietMs: 1500 });
      rows.push({ stop: n, row: await rowOf(hub, session), reply: ran.stdout.trim() });
    }
  }
  const events = ofSession(await settle(hub, () => false, { timeoutMs: 8000, quietMs: 2000, minMs: 1000 }), session);
  return { session, rows, events, hub };
}

// ---- The readings the criteria name.
/** A row in one line. */
export const rowShown = (row: Line | undefined): string => (row ? `${row.state}: ${row.why}${row.note ? ` (${row.note})` : ''}` : 'no row');
/** A row that reads the session as waiting on its monitor: not handed back to you, and saying so with its monitor. */
export const waitsOnMonitor = (row: Line | undefined): boolean => Boolean(row) && !['finished', 'needs you', 'stuck', 'flagged', 'quiet'].includes(String(row!.state)) && /monitor/i.test(`${row!.why} ${row!.note ?? ''}`) && /wait/i.test(`${row!.why} ${row!.note ?? ''}`);
/**
 * Each Stop the row reads as the turn handed back to you, which is what notifies you (README, Open points): any row
 * after a Stop that isn't working and isn't waiting on the monitor.
 */
export const notifications = (r: Replay): number[] => r.rows.filter(({ row }) => !waitsOnMonitor(row) && row?.state !== 'working').map(({ stop }) => stop);
/** The gate's judgements of the session's claim: each `claim.made` the core recorded for it, by log position. */
export const judgements = (r: Replay): Ev[] => r.events.filter((e) => e.kind === 'claim.made' && e.writer === 'core');
/** The session's own stops, in log order. */
export const stopsOf = (r: Replay): Ev[] => kindOf(r.events, r.session, 'agent.stop').filter((e) => !e.data.child);
