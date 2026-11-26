// Test-side tools for #2764's blind acceptance suite (README). One Codex session replayed through the real deep-hook
// binary (`deep-hook codex <event>`, payload on stdin, a child of one long-lived stand-in process for the session) and
// the real `deep hub run`, the record read back over the hub's socket. Payloads and rollout lines are shaped like
// adapters/corpus/codex/0.166.0-alpha.5.1 (`subagent`, `tools`). The hub, the record and socket reader, the stand-in
// process and the verdict helpers come from tests/acceptance/1836 (same repo, same license); nothing here decides
// anything DeepBuild decides. Processes are stopped by PID only (1836's `cleanup`, `stopHub`).

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  AGENT, DEEP_HOOK, DEFAULT_RULES, Inconclusive, NODE, REPO, allEvents, asksNaming, childEnv, cleanup as cleanup1836,
  decision, handleOf, lastPos, loadReading, own, parseObject, shown, sleep, startHub, stopHub, tag,
  type Ev, type Hub, type Line, type Ran, type World,
} from '../1836/helpers.ts';

export { Inconclusive, handleOf, type Ev };

/** The criterion's ID: `#2764.` and the first 8 hex of SHA-256 of its text, trimmed, white space collapsed (README). */
export const AC = '#2764.f88db370';
/** The planted wrong program this suite names (README, The plant): a new DEEP_HUB_PLANT value the work must add. */
export const PLANT = 'proceed-ends-at-child-prompt';

/** The call that deletes on a remote service: deep-hook's `effect:delete` (gh release delete, matcher_tests.rs). */
export const DELETE = 'gh release -R acme/shop delete v1';
/** The question the agent's stop ends on, which the planted sorter answers "proceed". */
export const QUESTION = 'want me to delete the stale v1 release?';
/** The subagent's prompt, as Codex submits it under the root's session ID with the child's agent_id. */
export const CHILD_PROMPT = 'List the releases of acme/shop and report which ones are older than v2.';

const CODEX_COVERED = (() => { const v = (JSON.parse(readFileSync(join(REPO, 'adapters/codex.facts.json'), 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
/** A Codex-style ID (time-ordered UUIDv7 look, as the corpus's are). */
const codexId = (variant: string) => `01a2${tag(2)}-${tag(2)}-7${tag(2).slice(1)}-${variant}${tag(2).slice(1)}-${tag(6)}`;

// ---- The world: a home with the shipped guards as they are and your ask settings, and a git repository.
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
const made: string[] = [];
export function makeWorld(): World {
  const tmp = realpathSync(mkdtempSync('/tmp/dh2764-'));
  made.push(tmp);
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.codex', 'sessions'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  // The shipped default guards, unchanged: `authority-delete` (effect:delete, watch) is the only entry a delete meets,
  // and no named default settles a delete before the proceed's hold.
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const repo = join(tmp, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  const git = (args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repo, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  });
  git(['init', '-q', '-b', 'main']);
  writeFileSync(join(repo, 'src', 'release.ts'), 'export const latest = "v1";\n');
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'shop', version: '1.0.0', scripts: { test: 'node -e 0' } }, null, 2)}\n`);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  return { tmp, home, root, repo: realpathSync(repo), confirm };
}
export async function cleanup(): Promise<void> {
  await cleanup1836();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
export function writeSorter(w: World, rule: string, proceed: string[]): string {
  const file = join(w.tmp, 'sorter.json');
  writeFileSync(file, `${JSON.stringify({ rule, proceed }, null, 2)}\n`);
  return file;
}

// ---- The session's Codex, as far as its hooks go: one long-lived process (1836's fixtures/agent.mjs), the parent of
// every `deep-hook codex <event>` run of the session.
class Runner {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Ran) => void>();
  private readonly child: ChildProcess;
  constructor(w: World) {
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w.home), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = parseObject(this.buffer.slice(0, i));
        this.buffer = this.buffer.slice(i + 1);
        if (!line || typeof line.n !== 'number') continue;
        if ('pid' in line && !('code' in line)) { own(Number(line.pid)); continue; }
        const done = this.pending.get(line.n);
        this.pending.delete(line.n);
        done?.(line as unknown as Ran);
      }
    });
    child.on('exit', () => {
      for (const [n, done] of [...this.pending]) {
        this.pending.delete(n);
        done({ code: null, signal: null, stdout: '', stderr: 'the session\'s Codex stand-in exited', ms: 0, timedOut: false, ended: Date.now() });
      }
    });
    this.child = child;
  }
  run(args: readonly string[], cwd: string, input: string, timeoutMs: number): Promise<Ran> {
    const n = ++this.n;
    return new Promise((resolve) => {
      this.pending.set(n, resolve);
      this.child.stdin!.write(`${JSON.stringify({ n, args, cwd, input, timeoutMs })}\n`);
    });
  }
}

function rollout(file: string): (type: string, payload: Line) => void {
  let ordinal = 0;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '');
  return (type, payload) => writeFileSync(file, `${JSON.stringify({ timestamp: new Date().toISOString(), ordinal: ordinal++, type, payload })}\n`, { flag: 'a' });
}
const spoiled = (event: string, ran: Ran): void => {
  if (/spooled \S+, but its sync didn't finish/.test(ran.stderr)) throw new Inconclusive(`deep-hook couldn't hand Codex's ${event} to the hub within its budget (${ran.stderr.trim()}), ${loadReading()}`);
};

/** A Codex session (root thread): its rollout under `~/.codex/sessions`, every hook carrying its session_id and turn_id. */
export class CodexSession {
  readonly id = codexId('a');
  readonly cwd: string;
  readonly transcript: string;
  turn: string | undefined;
  private readonly line: (type: string, payload: Line) => void;
  private readonly runner: Runner;
  constructor(readonly w: World) {
    this.cwd = w.repo;
    this.transcript = join(w.home, '.codex/sessions/2026/11/26', `rollout-2026-11-26T09-00-00-${this.id}.jsonl`);
    this.line = rollout(this.transcript);
    this.line('session_meta', { session_id: this.id, id: this.id, timestamp: new Date().toISOString(), cwd: this.cwd, originator: 'codex_cli_rs', cli_version: CODEX_COVERED, source: 'cli', model_provider: 'openai' });
    this.runner = new Runner(w);
  }
  /** `deep-hook codex <event>` with the payload on stdin, as Codex runs DeepBuild's hook entry. */
  async hook(event: string, fields: Line = {}, transcript = this.transcript): Promise<Ran> {
    const body: Line = { session_id: this.id, ...(this.turn && event !== 'SessionStart' ? { turn_id: this.turn } : {}), transcript_path: transcript, cwd: this.cwd, hook_event_name: event, model: 'gpt-5.4', permission_mode: 'bypassPermissions', ...fields };
    const ran = await this.runner.run(['codex', event], this.cwd, JSON.stringify(body), 150_000);
    spoiled(event, ran);
    return ran;
  }
  /** The run of a PreToolUse still going (deep-hook may wait on the hub's hold) and its tool_use_id. */
  pre(tool: string, input: Line): { id: string; done: Promise<Ran> } {
    const id = `exec-${tag(12)}`;
    return { id, done: this.hook('PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: id }) };
  }
  async start(): Promise<void> {
    const r = await this.hook('SessionStart', { source: 'startup' });
    if (r.code !== 0) throw Error(`BLOCKED: Codex's SessionStart hook must end with exit 0: ${shown(r)}`);
  }
  /** A prompt you type: the turn opens in the rollout (task_started, turn_context, your message), then UserPromptSubmit. */
  async typed(text: string): Promise<void> {
    const turn = codexId('8');
    this.turn = turn;
    this.line('event_msg', { type: 'task_started', turn_attribution: { turn_id: turn, turn_trigger: 'user', parent_turn_id: null, initiating_agent_path: null, root_turn_id: turn }, turn_id: turn, root_turn_id: turn, model_context_window: 258400 });
    this.line('turn_context', { turn_id: turn, root_turn_id: turn, cwd: this.cwd, approval_policy: 'never', model: 'gpt-5.4' });
    this.line('response_item', { type: 'message', id: `msg_${tag(8)}`, role: 'user', content: [{ type: 'input_text', text }] });
    const r = await this.hook('UserPromptSubmit', { prompt: text });
    if (r.code !== 0) throw Error(`BLOCKED: Codex's UserPromptSubmit hook for your prompt must end with exit 0: ${shown(r)}`);
  }
  /** The turn's work: an apply_patch that updates src/release.ts (allowed, PostToolUse), so the stop is held and judged. */
  async patch(): Promise<void> {
    const path = join(this.cwd, 'src/release.ts');
    const command = `*** Begin Patch\n*** Update File: ${path}\n@@\n-export const latest = "v1";\n+export const latest = "v2";\n*** End Patch`;
    const p = this.pre('apply_patch', { command });
    const before = await p.done;
    if (decision(before) !== 'allow') throw Error(`BLOCKED: Codex's apply_patch of src/release.ts must be allowed: ${shown(before)}`);
    writeFileSync(path, 'export const latest = "v2";\n');
    const out = `Exit code: 0\nWall time: 0 seconds\nOutput:\nSuccess. Updated the following files:\nM ${path}\n`;
    this.line('response_item', { type: 'function_call_output', call_id: p.id, output: out });
    await this.hook('PostToolUse', { tool_name: 'apply_patch', tool_input: { command }, tool_use_id: p.id, tool_response: out });
  }
  /**
   * The agent ends its turn on `question` and the planted sorter answers it "proceed": the record holds a
   * question.proceeded naming it and the rule, and the stop's reply sends the agent on, saying proceed. BLOCKED otherwise.
   */
  async proceedAt(hub: Hub, question: string, rule: string): Promise<void> {
    const since = await lastPos(hub);
    this.line('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: question }] });
    const r = await this.hook('Stop', { stop_hook_active: false, last_assistant_message: question });
    const deadline = Date.now() + 30_000;
    for (;;) {
      const events = (await allEvents(hub)).filter((e) => e.log_pos > since);
      if (events.some((e) => e.kind === 'question.proceeded' && String(e.data?.question ?? '') === question && e.data?.rule === rule)) {
        if (decision(r) !== 'deny' || !/proceed/i.test(`${r.stdout}\n${r.stderr}`)) throw Error(`BLOCKED: the Codex stop's reply must carry the proceed for "${question}" (a Stop block whose reason says proceed): ${shown(r)}; read at ${loadReading()}`);
        const asked = events.filter((e) => e.kind === 'ask.created' && String(e.data?.question ?? '').includes(question));
        if (asked.length) throw Error(`BLOCKED: a "proceed" is not an ask: "${question}" was answered proceed, yet ${asked.map(handleOf).join(', ')} asks it`);
        // Codex goes on in the same turn with the Stop hook's reason.
        return;
      }
      if (Date.now() > deadline) throw Error(`BLOCKED: the planted sorter's proceed for "${question}" must be recorded as question.proceeded with rule ${rule}: 30 s after the Codex stop, none is; the stop's reply was ${shown(r)}`);
      await sleep(500);
    }
  }
  /**
   * In the turn the proceed started, the agent spawns a Codex subagent (corpus 0.166.0-alpha.5.1, `subagent`): the
   * spawn_agent call (allowed) and its result, the child's SubagentStart, then the child's prompt: UserPromptSubmit under
   * the root's session_id with the child's agent_id, agent_type and turn_id, its transcript_path the child's rollout.
   * The record must hold that prompt as the session's user.ask with `from: 'subagent'` (as the base's core.ts records
   * it), or the test is BLOCKED. The subagent is still running when this returns: no SubagentStop is sent.
   */
  async subagentPrompt(hub: Hub, prompt: string): Promise<void> {
    const spawnInput = { message: prompt };
    const p = this.pre('spawn_agent', spawnInput);
    const before = await p.done;
    if (decision(before) !== 'allow') throw Error(`BLOCKED: Codex's spawn_agent call that starts the subagent must be allowed: ${shown(before)}`);
    const child = codexId('b');
    const childTurn = codexId('8');
    const childRollout = join(dirname(this.transcript), `rollout-2026-11-26T09-00-05-${child}.jsonl`);
    const childLine = rollout(childRollout);
    childLine('session_meta', { session_id: child, id: child, timestamp: new Date().toISOString(), cwd: this.cwd, originator: 'codex_cli_rs', cli_version: CODEX_COVERED, model_provider: 'openai' });
    childLine('event_msg', { type: 'task_started', turn_attribution: { turn_id: childTurn, turn_trigger: 'agent', parent_turn_id: this.turn, initiating_agent_path: null, root_turn_id: this.turn }, turn_id: childTurn, root_turn_id: this.turn, model_context_window: 258400 });
    childLine('response_item', { type: 'message', id: `msg_${tag(8)}`, role: 'user', content: [{ type: 'input_text', text: prompt }] });
    const started = await this.hook('SubagentStart', { turn_id: childTurn, agent_id: child, agent_type: 'default' }, childRollout);
    if (started.code !== 0) throw Error(`BLOCKED: Codex's SubagentStart hook must end with exit 0: ${shown(started)}`);
    const response = JSON.stringify({ agent_id: child, nickname: 'Dirac' });
    this.line('response_item', { type: 'function_call_output', call_id: p.id, output: response });
    await this.hook('PostToolUse', { tool_name: 'spawn_agent', tool_input: spawnInput, tool_use_id: p.id, tool_response: response });
    const since = await lastPos(hub);
    const submitted = await this.hook('UserPromptSubmit', { turn_id: childTurn, agent_id: child, agent_type: 'default', prompt }, childRollout);
    if (submitted.code !== 0) throw Error(`BLOCKED: the Codex subagent's UserPromptSubmit hook must end with exit 0: ${shown(submitted)}`);
    const deadline = Date.now() + 30_000;
    for (;;) {
      const asks = (await allEvents(hub)).filter((e) => e.log_pos > since && e.kind === 'user.ask');
      if (asks.some((e) => e.data?.from === 'subagent' && String(e.data?.text ?? '') === prompt)) return;
      if (Date.now() > deadline) throw Error(`BLOCKED: the Codex subagent's prompt must reach the record as the session's user.ask from 'subagent': 30 s after it, the record's prompts since are ${JSON.stringify(asks.map((e) => e.data))}; the hook ended ${shown(submitted)}`);
      await sleep(250);
    }
  }
  /** A Bash call's PreToolUse in the root's turn, its function call in the rollout. */
  shell(command: string): Pending {
    const p = this.pre('Bash', { command });
    this.line('response_item', { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', command] }), call_id: p.id });
    const pending: Pending = { id: p.id, done: p.done };
    void p.done.then((r) => { pending.result = r; });
    return pending;
  }
}
export interface Pending { id: string; done: Promise<Ran>; result?: Ran }

/** Whether the hub never decided this call: deep-hook let it through for a late acknowledgement, spooled marked late. */
async function late(hub: Hub, id: string): Promise<boolean> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const before = (await allEvents(hub)).find((e) => e.kind === 'tool.before' && e.data?.call === id);
    if (before) return before.data.late === true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}
/** The message naming the call when deep-hook let a run of it through as decided by the hub; INCONCLUSIVE when the hub never decided it. */
async function ranThrough(hub: Hub, p: Pending): Promise<string | undefined> {
  if (!p.result || decision(p.result) !== 'allow') return undefined;
  if (await late(hub, p.id)) throw new Inconclusive(`\`${DELETE}\` was let through because the hub's acknowledgement came after deep-hook's budget (${shown(p.result)}), so the hub never decided it; read at ${loadReading()}`);
  return `\`${DELETE}\` ran in the turn the proceed started, after the Codex subagent's prompt, with no authority ask: deep-hook allowed it at PreToolUse with nothing held (${shown(p.result)})`;
}

/** What the session showed, for the test files to judge with their own assertions. */
export interface Seen {
  /** Set when a run of the delete was let through: the message names the call. */
  ran?: string;
  /** The asks raised after the subagent's prompt whose question names the delete. */
  asks: Ev[];
  /** Whether the delete was called a second time before any answer (only when the first was held). */
  retried: boolean;
}

/**
 * The replay (README, The session replayed): you type a prompt; the agent patches a file and ends its turn on QUESTION,
 * which the planted sorter answers "proceed"; in the turn the proceed starts, a Codex subagent is spawned and its prompt
 * submitted; then the agent calls DELETE. Watches the call for 90 s; when it is held, calls it again and watches 5 s more.
 */
export async function replay(plant?: string): Promise<Seen> {
  const w = makeWorld();
  const rule = `planted-proceed-${tag()}`;
  const hub = await startHub(w, { plant, sorter: writeSorter(w, rule, [QUESTION]) });
  try {
    const s = new CodexSession(w);
    await s.start();
    await s.typed('Tidy up the shop\'s releases: point src/release.ts at v2.');
    await s.patch();
    await s.proceedAt(hub, QUESTION, rule);
    await s.subagentPrompt(hub, CHILD_PROMPT);
    const since = await lastPos(hub);
    const first = s.shell(DELETE);
    const deadline = Date.now() + 90_000;
    for (;;) {
      const ran = await ranThrough(hub, first);
      if (ran) return { ran, asks: await asksNaming(hub, since, DELETE), retried: false };
      const asks = await asksNaming(hub, since, DELETE);
      if (asks.length) break;
      if (Date.now() > deadline) return { asks, retried: false };
      await sleep(250);
    }
    // Held: the agent calls the delete again before you answer.
    const again = s.shell(DELETE);
    await sleep(5000);
    const ran = (await ranThrough(hub, first)) ?? (await ranThrough(hub, again));
    return { ...(ran ? { ran } : {}), asks: await asksNaming(hub, since, DELETE), retried: true };
  } finally {
    await stopHub(hub);
  }
}

/** Every way `seen` breaks the criterion, each naming the call; empty when it holds. */
export function breaches(seen: Seen): string[] {
  const out: string[] = [];
  if (seen.ran) out.push(seen.ran);
  if (!seen.asks.length && !seen.ran) out.push(`\`${DELETE}\` must be held with an authority ask naming it: no ask names it 90 s after the call`);
  const [ask] = seen.asks;
  if (ask && ask.data.kind !== 'authority') out.push(`the hold of \`${DELETE}\` must be an authority ask: ${handleOf(ask)} was filed as ${String(ask.data.kind)}`);
  const question = String(ask?.data.question ?? '');
  if (ask && !(/proceed/i.test(question) && question.includes(QUESTION))) out.push(`the authority ask holding \`${DELETE}\` must name the proceed ("${QUESTION}"): ${handleOf(ask)} asks "${question}"`);
  if (seen.asks.length > 1) out.push(`one authority ask holds \`${DELETE}\`, called twice: ${seen.asks.length} asks name it: ${seen.asks.map(handleOf).join(', ')}`);
  return out;
}
