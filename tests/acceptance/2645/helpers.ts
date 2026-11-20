// Shared by #2645's acceptance tests (README): temp folders; the agents' task-list facts; the claim as the hub's claim
// lane makes it (OpenItems.atClaim) and what it leaves open; #20's fixtures and the corpus's recorded sessions; the
// newest call placed in the first block, the last block and across a block's edge; and the comparison with the merge
// base's readers, whose every difference names the line the merge base's answer comes from.
import { AssertionError } from 'node:assert';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shipped } from '@deepbuild/adapters';
import type { Asks } from '@deepbuild/asks';
import { openTasks, type TaskListFacts } from '@deepbuild/gate';
import type { Connection, EventInput } from '@deepbuild/record';
import { openItemId } from '@deepbuild/verdicts';
import { codexReadings } from '../../../packages/hub/src/codex-loops.ts';
import { OpenItems } from '../../../packages/hub/src/open-items.ts';
import { appendClaude, claudeTranscript, codexTranscript, numbered, T0, tinyTranscript } from '../20/helpers.ts';
import { session as generated } from '../20/generate.ts';
import { baseCodexReadings, baseNewestList } from './merge-base.ts';
import { dropsCutLines } from './planted.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A criterion's check. Its failure is the test framework's own assertion failure, node:assert's AssertionError
 * (ERR_ASSERTION), its stack starting at the caller in this suite's files, so the proof lanes read it as failing at its
 * assertion (scripts/proof-runs.mjs `atAssertion`; design: Failing on an assertion). BLOCKED and INCONCLUSIVE are
 * thrown as plain errors that name their state, never through this.
 */
export function must(ok: boolean, message: string): asserts ok {
  if (!ok) throw new AssertionError({ message, stackStartFn: must });
}
/** A number with thousands separators, for messages. */
export const fmt = (n: number): string => n.toLocaleString('en-US');
/** A value in one line for a message, its long strings cut. */
export const show = (value: unknown): string => {
  const text = JSON.stringify(value, (_k, v: unknown) => (typeof v === 'string' && v.length > 160 ? `${v.slice(0, 120)}… (${fmt(v.length)} characters)` : v)) ?? 'undefined';
  return text.length > 1600 ? `${text.slice(0, 1600)}…` : text;
};
/** A value as canonical JSON: keys sorted, undefined dropped, so two answers compare by what they say. */
export const canon = (value: unknown): string => JSON.stringify(value, (_k, v: unknown) => (isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v)) ?? 'undefined';

// ---- Temp folders, removed by `removeTemps`.
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `dh2645-${tag}-`)));
  made.push(dir);
  return dir;
}
export function removeTemps(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- The agents' task-list facts, as the hub reads them (core.ts: every agent but Codex reads Claude Code's).
/** An agent by the name its corpus folder or #20's fixture gives it: claude-code, codex, tiny, or another adapter's. */
type Agent = string;
const registry = shipped();
export const factsOf = (agent: Agent): TaskListFacts => (registry.get(agent === 'codex' ? 'codex' : 'claude').facts as unknown as { taskList: TaskListFacts }).taskList;
/** The facts with every status a list's items take counted open, so a claim's open items are its whole list. */
export const everyItem = (facts: TaskListFacts): TaskListFacts => ({ ...facts, open: ['pending', 'in_progress', 'completed'] });

// ---- The claim, as the hub's claim lane makes it (stop-judging.ts: atClaim with the session's transcript).
const TASK = 'task:dh2645';
const SESSION = 'session-dh2645';
/** What a list leaves open, as a claim records it: each item's text, once per item ID, cut to 8,192 characters. */
export function projection(facts: TaskListFacts, list: unknown, cwd: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of openTasks(facts, list)) {
    const id = openItemId(item.text, { repo: cwd, task: TASK, req: null });
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item.text.slice(0, 8192));
  }
  return out;
}
type Claim = (transcript: string, agent: Agent, facts: TaskListFacts) => Promise<string[]>;
/**
 * One OpenItems for every claim, as the hub keeps one: the record answers that nothing is open yet, and the events the
 * claim appends are kept. A claim's result is the text of each `open_item.opened` it records `from: 'task'`.
 */
export function claimer(cwd: string): Claim {
  const events: EventInput[] = [];
  let facts: TaskListFacts | undefined;
  const items = new OpenItems({
    raw: async () => [],
    append: async (_connection: Connection, input: EventInput) => { events.push(input); },
    now: () => Date.now(),
    connection: (session?: string, agent?: string): Connection => ({ writer: 'core', actor: 'you', scope: 'you', ...(session ? { session } : {}), ...(agent ? { agent } : {}) }),
    asks: () => ({ raise: async () => { throw new Error('a task list raises no ask'); } }) as unknown as Asks,
    pin: async () => null,
    github: async () => { throw new Error('these claims name no pull request'); },
    taskList: () => facts,
  });
  return async (transcript, agent, f) => {
    facts = f;
    events.length = 0;
    await items.atClaim({ session: SESSION, agent, task: TASK, cwd, base: 'HEAD', message: '', transcript, pr: undefined, same: true });
    return events.filter((e) => e.kind === 'open_item.opened' && isObj(e.data) && e.data.from === 'task').map((e) => String((e.data as Obj).text));
  };
}

// ---- The transcripts: #20's fixtures and the corpus's recorded sessions.
export interface Source { label: string; agent: Agent; session: string; lines: string[] }
const linesOf = (text: string): string[] => {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
};
/** A Codex rollout's thread, as its session_meta names it. */
const threadOf = (lines: readonly string[], fallback: string): string => {
  for (const raw of lines.slice(0, 3)) {
    try {
      const line = JSON.parse(raw) as Obj;
      if (line.type === 'session_meta' && isObj(line.payload) && typeof line.payload.id === 'string') return line.payload.id;
    } catch { /* not a record */ }
  }
  return fallback;
};
/** Every recorded session's transcript in adapters/corpus (its README: `<agent>/<version>/<session>/transcript.jsonl`). */
export function corpusSources(): Source[] {
  const root = join(REPO, 'adapters/corpus');
  const out: Source[] = [];
  for (const agent of readdirSync(root).filter((a) => statSync(join(root, a)).isDirectory()).sort()) {
    for (const version of readdirSync(join(root, agent)).sort()) {
      if (!statSync(join(root, agent, version)).isDirectory()) continue;
      for (const name of readdirSync(join(root, agent, version)).sort()) {
        const file = join(root, agent, version, name, 'transcript.jsonl');
        let text: string;
        try { text = readFileSync(file, 'utf8'); } catch { continue; }
        const lines = linesOf(text);
        out.push({ label: `corpus ${agent}/${version}/${name}`, agent: agent as Agent, session: threadOf(lines, `dh2645-${agent}-${version}-${name}`), lines });
      }
    }
  }
  return out;
}
/**
 * #20's fixtures, made with #20's own helpers: its first budget session (budgets.test.ts, seed 0x207000, 3 MB), a
 * Claude Code transcript grown from 10 to 50 messages (growth.test.ts), a Codex rollout (copies.test.ts) and the new
 * adapter's transcript (copies.test.ts), which the hub reads with Claude Code's facts.
 */
export function twentySources(home: string): Source[] {
  const env = { HOME: home };
  const budget = generated(0x20_7000, 3_000_000, T0);
  const grown = claudeTranscript(env, numbered(1, 10, 'grow'));
  appendClaude(grown, numbered(11, 50, 'grow'));
  const codex = codexTranscript(env, ['codex: fix the checkout total', 'codex: now run the tests']);
  const tiny = tinyTranscript(env, ['tiny: rename the cart module']);
  return [
    { label: "#20's budget session 0x207000 (3 MB)", agent: 'claude-code', session: budget.id, lines: budget.lines },
    { label: "#20's Claude Code transcript grown to 50 messages", agent: 'claude-code', session: grown.id, lines: grown.lines },
    { label: "#20's Codex rollout", agent: 'codex', session: codex.id, lines: codex.lines },
    { label: "#20's new adapter's transcript", agent: 'tiny', session: tiny.id, lines: tiny.lines },
  ];
}

// ---- The lines this suite plants: the newest task-list call, Codex's newest goal call, and lines that name the tool
// without assigning a list. Their text has characters of one to four bytes, so a cut can fall inside one.
export const TODOS = [
  { content: 'Read the checkout total — café receipts', status: 'completed', activeForm: 'Reading the checkout total' },
  { content: 'Fix the rounding in total.ts ✓ before the tax line', status: 'in_progress', activeForm: 'Fixing the rounding' },
  { content: 'Add a test for 東京 prices', status: 'pending', activeForm: 'Adding a test' },
  { content: 'Write the release note 🙂', status: 'pending', activeForm: 'Writing the release note' },
];
const PLAN = TODOS.map((t) => ({ step: t.content, status: t.status }));
/** Lines longer than this straddle an edge of every block a reader that reads at most 2 MB can use (README). */
const LONG_BYTES = 2_300_000;
const WORDS = ['checkout', 'total', 'rounding', 'café', 'naïve', '東京', 'price', '✓', '—', '🙂', 'receipt', 'step', 'cart', 'tax', 'line', 'item', 'order', 'page'];
let long: string | undefined;
/** About LONG_BYTES of words: no record's name and no tool's, so it is read only as a part of its line. */
export function longText(): string {
  if (long !== undefined) return long;
  const out: string[] = [];
  let bytes = 0;
  for (let i = 0; bytes < LONG_BYTES; i++) {
    const word = WORDS[(i * 7 + (i >> 3)) % WORDS.length]!;
    out.push(word);
    bytes += Buffer.byteLength(word) + 1;
  }
  return (long = out.join(' '));
}
const AT = '2026-11-19T10:00:00.000Z';
const claudeEntry = (session: string, uuid: string, type: 'user' | 'assistant', message: Obj, extra: Obj = {}): string => JSON.stringify({
  parentUuid: null, isSidechain: false, userType: 'external', cwd: '/tmp/dh2645-work/shop', sessionId: session, version: '2.1.304', gitBranch: 'main', type, message, uuid, timestamp: AT, ...extra,
});
/** Claude Code's TodoWrite call: an assistant entry whose tool_use part's input is the list; long, a text part before it holds LONG_BYTES. */
export const todoCall = (session: string, id: string, todos: readonly Obj[], long = false): string => claudeEntry(session, `dh2645-${id}`, 'assistant', {
  model: 'claude-opus-5-5', id: `msg_${id}`, type: 'message', role: 'assistant',
  content: [{ type: 'text', text: long ? longText() : 'I will keep the remaining steps on the list.' }, { type: 'tool_use', id, name: 'TodoWrite', input: { todos } }],
  stop_reason: 'tool_use', usage: { input_tokens: 12, output_tokens: 40 },
});
export const todoResult = (session: string, id: string, todos: readonly Obj[]): string => claudeEntry(session, `dh2645-${id}-result`, 'user', {
  role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: 'Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress.' }],
}, { toolUseResult: { oldTodos: [], newTodos: todos } });
/** A typed prompt that names the tool and assigns nothing. */
export const todoMention = (session: string): string => claudeEntry(session, 'dh2645-mention', 'user', { role: 'user', content: 'Keep the TodoWrite list as it stands — no new TodoWrite call is needed for the tax line.' }, { promptSource: 'typed' });
const codexLine = (type: string, payload: Obj): string => JSON.stringify({ timestamp: AT, type, payload });
/** Codex's update_plan call: a function_call whose arguments are the plan; long, its explanation holds LONG_BYTES. */
export const planCall = (id: string, plan: readonly Obj[], long = false): string => codexLine('response_item', {
  type: 'function_call', name: 'update_plan', arguments: JSON.stringify({ explanation: long ? longText() : 'The steps left', plan }), call_id: id,
});
export const planOutput = (id: string): string => codexLine('response_item', { type: 'function_call_output', call_id: id, output: 'Plan updated' });
/** An update_plan call whose arguments don't parse: the merge base reads no list from it. */
const planCut = (): string => codexLine('response_item', { type: 'function_call', name: 'update_plan', arguments: '{"explanation":"cut short","plan":[{"step":"Fix the tax line","status":"pend', call_id: 'call_dh2645_cut' });
/** Codex's goal call, as a script's `tools.update_goal(`, and its output, the goal record for the thread. */
export const goalCall = (id: string): string => codexLine('response_item', {
  type: 'custom_tool_call', status: 'completed', call_id: id, name: 'exec', input: 'const r = await tools.update_goal({status:"paused"});\ntext(r);\n',
});
export const goalOutput = (id: string, thread: string, status: string, long = false): string => codexLine('response_item', {
  type: 'custom_tool_call_output', call_id: id,
  output: [{ type: 'input_text', text: 'Script completed\nWall time 0.1 seconds\nOutput:\n' }, { type: 'input_text', text: JSON.stringify({ goal: { threadId: thread, objective: long ? longText() : 'Finish the checkout fix — 東京 prices', status } }) }],
});
/** A token count with the account's Codex windows and plan, from which the merge base reads both windows and the billing. */
const windows = (): string => codexLine('event_msg', {
  type: 'token_count', info: { total_token_usage: { input_tokens: 26_450, output_tokens: 645 } },
  rate_limits: { limit_id: 'codex', primary: { used_percent: 12.5, window_minutes: 300 }, secondary: { used_percent: 62.5, window_minutes: 10080 }, plan_type: 'pro' },
});

/** Lines that hold no list and no reading, about `bytes` of them: #20's generator for Claude Code, shell output for Codex. */
const fills = new Map<string, string[]>();
function filler(codex: boolean, bytes: number): string[] {
  const key = `${codex}:${bytes}`;
  const known = fills.get(key);
  if (known) return known;
  const out: string[] = [];
  if (!codex) out.push(...generated(0x2645, bytes, T0).lines);
  else {
    for (let n = 0, total = 0; total < bytes; n++) {
      const rows = Array.from({ length: 600 + (n % 7) * 60 }, (_, i) => `  ${i % 9 ? '✓' : '✗'} ${WORDS[(n + i) % WORDS.length]} ${WORDS[(n * 3 + i) % WORDS.length]} rounds to ${i * 7 % 100} (${i % 40} ms)`);
      const call = codexLine('response_item', { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', `npm test -- --grep part-${n}`] }), call_id: `call_dh2645_fill_${n}` });
      const output = codexLine('response_item', { type: 'function_call_output', call_id: `call_dh2645_fill_${n}`, output: rows.join('\n') });
      out.push(call, output);
      total += Buffer.byteLength(call) + Buffer.byteLength(output) + 2;
    }
  }
  fills.set(key, out);
  return out;
}

// ---- Which line a merge base's answer comes from, read as the merge base reads a line, for messages.
/** Whether a line assigns the list, as the merge base's newestList takes one. */
function assigns(raw: string, tool: string): string | null {
  if (!raw.includes(tool)) return null;
  let line: unknown;
  try { line = JSON.parse(raw); } catch { return null; }
  if (!isObj(line)) return null;
  let id: string | null = null;
  if (isObj(line.message) && Array.isArray(line.message.content)) {
    for (const part of line.message.content) if (isObj(part) && part.type === 'tool_use' && part.name === tool) id = String(part.id);
  }
  const p = line.payload;
  if (line.type === 'response_item' && isObj(p) && p.type === 'function_call' && p.name === tool && typeof p.arguments === 'string') {
    try { JSON.parse(p.arguments); id = String(p.call_id); } catch { /* lists nothing */ }
  }
  return id;
}
/** A line named by its number, its call and where its bytes lie. */
function lineAt(lines: readonly string[], index: number, size: number, what: string): string {
  let start = 0;
  for (let i = 0; i < index; i++) start += Buffer.byteLength(lines[i]!) + 1;
  const length = Buffer.byteLength(lines[index]!);
  return `line ${index + 1} (${what}, bytes ${fmt(start)}–${fmt(start + length)} of ${fmt(size)}${length > 2_000_000 ? `, ${fmt(length)} bytes long` : ''})`;
}
function fileLines(path: string): { lines: string[]; size: number } {
  const bytes = readFileSync(path);
  return { lines: bytes.toString('utf8').split('\n'), size: bytes.length };
}
/** The line the merge base's list comes from. */
function listSource(path: string, tool: string): string {
  const { lines, size } = fileLines(path);
  for (let i = lines.length - 1; i >= 0; i--) {
    const id = assigns(lines[i]!, tool);
    if (id !== null) return `the merge base's list is the ${tool} call on ${lineAt(lines, i, size, id)}`;
  }
  return `the merge base finds no ${tool} call`;
}
/** The lines the merge base's newest readings come from: its newest goal record and its newest token count. */
function readingsSource(path: string): string {
  const { lines, size } = fileLines(path);
  let goal = -1;
  let tokens = -1;
  lines.forEach((raw, i) => {
    if (raw.includes('{\\"goal\\"') && /_output"/.test(raw)) goal = i;
    if (raw.includes('"token_count"')) tokens = i;
  });
  return [goal >= 0 ? `its newest goal record is ${lineAt(lines, goal, size, 'goal output')}` : 'it holds no goal record', tokens >= 0 ? `its newest token count is ${lineAt(lines, tokens, size, 'token_count')}` : 'no token count'].join(', ');
}

// ---- The newest call placed in the first block, the last block and across a block's edge (README, Readings).
type Placement = 'first block' | 'last block' | "across a block's edge";
export const PLACEMENTS: readonly Placement[] = ['first block', 'last block', "across a block's edge"];
interface Variant { placement: Placement; lines: string[]; at: number; callId: string; goalAt?: number }
/** The call IDs of a rollout's goal calls, as the merge base's goalCall knows one. */
function goalIds(lines: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const raw of lines) {
    if (!raw.includes('_call"')) continue;
    try {
      const p = (JSON.parse(raw) as Obj).payload;
      if (isObj(p) && /_call$/.test(String(p.type)) && typeof p.call_id === 'string' && ['create_goal', 'get_goal', 'update_goal'].some((t) => p.name === t || (typeof p.input === 'string' && p.input.includes(`tools.${t}(`)))) ids.add(p.call_id);
    } catch { /* not a record */ }
  }
  return ids;
}
const callIdOf = (raw: string): string | undefined => {
  try {
    const p = (JSON.parse(raw) as Obj).payload;
    return isObj(p) && typeof p.call_id === 'string' ? p.call_id : undefined;
  } catch { return undefined; }
};
/**
 * A source with this suite's newest task-list call (and, in a Codex rollout, its newest goal call, with a token count
 * beside it that holds the account's windows) placed:
 * - last block: after the source's own lines, followed only by its result and a line naming the tool that assigns nothing;
 * - across a block's edge: the same, with the call's line, and the goal record's, LONG_BYTES long;
 * - first block: first in the file (a rollout's session_meta stays its first line), the source's own task-list calls
 *   and goal records left out, and LONG_BYTES of lines with no call after the source's own.
 */
export function variant(src: Source, placement: Placement): Variant {
  const codex = src.agent === 'codex';
  const long = placement === "across a block's edge";
  const callId = codex ? 'call_dh2645_plan' : 'toolu_dh2645_newest';
  const call = codex ? planCall(callId, PLAN, long) : todoCall(src.session, callId, TODOS, long);
  const after = codex ? planOutput(callId) : todoResult(src.session, callId, TODOS);
  const mention = codex ? planCut() : todoMention(src.session);
  const goal = codex ? [goalCall('call_dh2645_goal'), goalOutput('call_dh2645_goal', src.session, 'paused', long), windows()] : [];
  if (placement !== 'first block') {
    const lines = [...src.lines, ...goal, call, after, mention];
    return { placement, lines, at: src.lines.length + goal.length, callId, ...(codex ? { goalAt: src.lines.length + 1 } : {}) };
  }
  const head = codex && src.lines[0]?.includes('"session_meta"') ? [src.lines[0]] : [];
  const tool = factsOf(src.agent).tool;
  const goals = goalIds(src.lines);
  const rest = src.lines.slice(head.length).filter((raw) => assigns(raw, tool) === null && !(codex && raw.includes(tool)) && !goals.has(callIdOf(raw) ?? ''));
  const lines = [...head, ...goal, call, after, ...rest, ...filler(codex, LONG_BYTES), mention];
  return { placement, lines, at: head.length + goal.length, callId, ...(codex ? { goalAt: head.length + 1 } : {}) };
}

/** A byte inside a line to cut it at: within a character of two or more bytes in its second half, when it has one. */
function cutInside(line: string): number {
  const bytes = Buffer.from(line);
  for (let i = Math.floor(bytes.length / 2); i < bytes.length - 1; i++) if ((bytes[i]! & 0xc0) === 0xc0) return i + 1;
  return Math.floor(bytes.length / 2);
}
/** The bytes of a variant at each step it is written in: the goal record and then the newest call half written, then whole. */
function steps(v: Variant): { name: string; bytes: number }[] {
  const starts: number[] = [];
  let at = 0;
  for (const line of v.lines) { starts.push(at); at += Buffer.byteLength(line) + 1; }
  const halves = [...(v.goalAt !== undefined ? [v.goalAt] : []), v.at];
  return [...halves.map((i) => ({ name: `written up to the middle of line ${i + 1}`, bytes: starts[i]! + cutInside(v.lines[i]!) })), { name: 'written whole', bytes: at }];
}
/** The turns a rollout's bytes have started, in order. */
function turnsIn(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    if (!raw.includes('"task_started"')) continue;
    try {
      const p = (JSON.parse(raw) as Obj).payload;
      if (isObj(p) && p.type === 'task_started' && typeof p.turn_id === 'string') out.push(p.turn_id);
    } catch { /* half written */ }
  }
  return out;
}

// ---- Readers: the hub's, the merge base's planted twin, and the comparison of either with the merge base's.
interface Readers {
  name: string;
  list(transcript: string, agent: Agent): Promise<string[]>;
  readings(session: string, transcript: string, turn: string | undefined, continuation: boolean): Promise<unknown>;
}
/** The change's readers, as the hub calls them: a claim's open items, every item counted, and codexReadings. */
export function hubReaders(cwd: string): Readers {
  const claim = claimer(cwd);
  return { name: 'the hub', list: (transcript, agent) => claim(transcript, agent, everyItem(factsOf(agent))), readings: codexReadings };
}
/** The planted reader: the merge base's readers reading through dropsCutLines(block). */
export function plantedReaders(block: number, cwd: string): Readers {
  const read = dropsCutLines(block);
  return {
    name: `the planted reader (blocks of ${fmt(block)} bytes)`,
    list: async (transcript, agent) => { const f = everyItem(factsOf(agent)); return projection(f, await baseNewestList(f, transcript, read), cwd); },
    readings: (session, transcript, turn, continuation) => baseCodexReadings(session, transcript, turn, continuation, read),
  };
}
/** Where a variant's copy lives: a rollout under a `sessions/` folder of a Codex home of its own, so its readings read no real home. */
function fileFor(dir: string, src: Source, v: Variant, kind: string): string {
  const name = `${src.label}-${v.placement}-${kind}`.replace(/[^A-Za-z0-9.-]+/g, '-');
  const path = src.agent === 'codex' ? join(dir, 'codex-home', 'sessions', '2026', '11', '19', `rollout-2026-11-19T10-00-00-${name}.jsonl`) : join(dir, 'claude', `${name}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}
/**
 * One variant read as the hub reads it, each answer compared with the merge base's on the same bytes: the file whole at
 * a path no reader has read (a Codex rollout's readings for its last turn, and for its first), then a copy written in
 * steps and read at each, the newest goal record and the newest call each half written before the file is whole.
 */
export async function compare(src: Source, v: Variant, readers: Readers, dir: string, cwd: string): Promise<{ checked: number; differ: string[] }> {
  const codex = src.agent === 'codex';
  const facts = everyItem(factsOf(src.agent));
  const bytes = Buffer.from(v.lines.map((l) => `${l}\n`).join(''));
  const out = { checked: 0, differ: [] as string[] };
  const where = `${src.label}, newest call in the ${v.placement}`;
  const list = async (path: string, step: string): Promise<void> => {
    const got = await readers.list(path, src.agent);
    const want = projection(facts, await baseNewestList(facts, path), cwd);
    out.checked++;
    if (canon(got) !== canon(want)) out.differ.push(`${where}, ${step}: the list is not the merge base's: ${listSource(path, facts.tool)}. The merge base's: ${show(want)}; ${readers.name}'s: ${show(got)}`);
  };
  const readings = async (path: string, step: string, turn: string | undefined, continuation: boolean): Promise<void> => {
    const got = await readers.readings(src.session, path, turn, continuation);
    const want = await baseCodexReadings(src.session, path, turn, continuation);
    out.checked++;
    if (canon(got) !== canon(want)) out.differ.push(`${where}, ${step}, turn ${turn ?? 'none'}: the readings are not the merge base's: ${readingsSource(path)}. The merge base's: ${show(want)}; ${readers.name}'s: ${show(got)}`);
  };
  const cold = fileFor(dir, src, v, 'cold');
  writeFileSync(cold, bytes);
  await list(cold, 'read whole');
  if (codex) {
    const turns = turnsIn(bytes.toString('utf8'));
    await readings(cold, 'read whole', turns.at(-1), true);
    if (turns.length > 1) {
      const late = fileFor(dir, src, v, 'late');
      writeFileSync(late, bytes);
      await readings(late, 'read whole for its first turn', turns[0], false);
    }
  }
  const grown = fileFor(dir, src, v, 'grown');
  let written = 0;
  for (const step of steps(v)) {
    appendFileSync(grown, bytes.subarray(written, step.bytes));
    written = step.bytes;
    await list(grown, step.name);
    if (codex) await readings(grown, step.name, turnsIn(bytes.subarray(0, step.bytes).toString('utf8')).at(-1), false);
  }
  return out;
}
