// Test-side tools for #1836's acceptance test (README): a temp world (a home with the shipped default guards and your
// ask settings; a git repository the session works in), `deep hub run` as a process with its test settings, the record
// read back through the hub's socket (`events.read`), and one Claude Code session driven through the real deep-hook
// binary, with payloads and transcripts shaped like adapters/corpus/claude-code/2.1.308 (its `subagent` scenario for
// the Agent call and the SubagentStop). Cut down from tests/acceptance/321/helpers.ts (same repo, same license); this
// suite keeps its own copy so a redraft of theirs never moves these tests. Nothing here stands in for DeepBuild: every
// decision comes from the real hub and deep-hook. Processes are stopped by PID only.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));

/** The criterion's ID: `#1836.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC = '#1836.76416703';
/** The planted wrong program this suite names (README, The plant): a new DEEP_HUB_PLANT value. */
export const PLANT = 'proceed-ends-at-child-stop';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const tag = (n = 4) => randomBytes(n).toString('hex');
export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
/** The newest Claude Code version the facts cover: every transcript entry carries it, so no session is watch-only. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;

// ---- Verdicts. A judgement throws an Error naming the criterion; INCONCLUSIVE is a skip, never a pass.
/** A reading the machine spoiled: a hook whose acknowledgement came too late, so the hub never decided its call. */
export class Inconclusive extends Error {}
export async function verdict(ctx: TestContext, judge: () => Promise<void>): Promise<void> {
  try {
    await judge();
  } catch (error) {
    if (error instanceof Inconclusive) ctx.skip(`INCONCLUSIVE ${error.message}`);
    throw error;
  }
}
/** The message a scenario throws on a planted program, or null when it holds. BLOCKED and INCONCLUSIVE are thrown on. */
export async function failureOf(judge: () => Promise<void>): Promise<string | null> {
  try {
    await judge();
    return null;
  } catch (error) {
    if (error instanceof Inconclusive) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('BLOCKED:')) throw error;
    return message;
  }
}
export function must(ok: boolean, message: string): asserts ok {
  if (!ok) throw Error(message);
}

// ---- Temp folders, short paths under /tmp (a Unix socket path must fit in 104 bytes on macOS), and owned processes.
const made: string[] = [];
const owned = new Set<number>();
export function own(pid: number | undefined): void {
  if (pid) owned.add(pid);
}
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
  try {
    return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }));
  } catch {
    return false;
  }
}
/** Stops every process this suite started (SIGTERM, then SIGKILL after 3 s), by PID, and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) {
    try { process.kill(pid, 'SIGCONT'); } catch { /* gone */ }
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  agents.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** A child's environment: HOME the test's, and none of this process's DEEP_/GIT_/XDG_/CLAUDE settings or billing keys. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('GIT_') || key.startsWith('CLAUDE') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.PATH = `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  env.LC_ALL = 'C';
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean; ended: number }
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;

// ---- A world: a home and a repository.
/** Your ask settings (#319's shape) as #321's suite writes them: no `batch`, so every ask shows when raised. */
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
/** The shipped request defaults for a merge, which this suite's home holds in watch mode. */
export const MERGE_DEFAULTS = ['merge-needs-ask', 'merge-names-head'];
export interface World { tmp: string; home: string; root: string; repo: string; confirm: string }
/** `<tmp>/h` is HOME: the hub's root holds the shipped default guards and your ask settings; `<tmp>/repo` is a git repository. */
export function makeWorld(): World {
  const tmp = realpathSync(mkdtempSync('/tmp/dh1836-'));
  made.push(tmp);
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  // The shipped guards, with the merge's two request defaults (#84) in watch mode, as you may set them: the hub counts
  // them only in block mode, and when they count they settle the merge before the proceed's hold (README, How the
  // issue was read). So here the proceed's hold is the only thing that can hold `gh pr merge 12`.
  const rules = JSON.parse(readFileSync(DEFAULT_RULES, 'utf8')) as { entries: Record<string, { mode: string }> };
  for (const rule of MERGE_DEFAULTS) rules.entries[rule]!.mode = 'watch';
  writeFileSync(join(root, 'rules.json'), `${JSON.stringify(rules, null, 2)}\n`);
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const repo = join(tmp, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  const git = (args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  });
  git(['init', '-q', '-b', 'main']);
  writeFileSync(join(repo, 'src', 'login.ts'), 'export const login = () => false;\n');
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'shop', version: '1.0.0', scripts: { test: 'node -e 0' } }, null, 2)}\n`);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  return { tmp, home, root, repo: realpathSync(repo), confirm };
}
/** #321's planted sorter: a file naming its rule and the questions it answers "proceed", given as DEEP_HUB_TEST_SORTER. */
export function writeSorter(w: World, rule: string, proceed: string[]): string {
  const file = join(w.tmp, 'sorter.json');
  writeFileSync(file, `${JSON.stringify({ rule, proceed }, null, 2)}\n`);
  return file;
}

// ---- The hub as a process: `deep hub run`, HOME the world's.
export interface Hub { pid: number; socket: string; root: string; exit: Promise<void>; stderr(): string }
/** Starts `deep hub run`; a hub that doesn't start (a plant the base doesn't list) is BLOCKED. */
export async function startHub(w: World, o: { plant?: string | undefined; sorter: string }): Promise<Hub> {
  const env = childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_PLANT: o.plant, DEEP_HUB_TEST_SORTER: o.sorter });
  const child: ChildProcess = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!));
      });
    }),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub${o.plant ? ` with the plant DEEP_HUB_PLANT=${o.plant}` : ''} did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid), socket: String(ready.socket), root: w.root, exit, stderr: () => err };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 30_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(50);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  await hub.exit;
}

// ---- The record, read back through the hub's socket as the CLI reads it (the cli role, with the control token).
function control(hub: Hub, method: string, params: Line, timeoutMs = 30_000): Promise<Line> {
  const token = readFileSync(join(hub.root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = parseObject(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (step === 0) {
          step = 1;
          sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
        } else if (step === 1 && line?.role !== undefined) {
          step = 2;
          sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`);
        } else if (step === 2 && line?.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          if (line.error) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`));
          else resolve(line.result as Line);
        }
      }
    });
  });
}
export interface Ev { id: string; kind: string; log_pos: number; subject?: string; data: Line }
export async function allEvents(hub: Hub): Promise<Ev[]> {
  const out: Ev[] = [];
  let after = 0;
  for (;;) {
    const events = (await control(hub, 'events.read', { after, limit: 1000 })).events as Ev[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos;
  }
}
export async function lastPos(hub: Hub): Promise<number> {
  const events = await allEvents(hub);
  return events.length ? events[events.length - 1]!.log_pos : 0;
}
/** The asks raised after `since` whose question names `name`. */
export async function asksNaming(hub: Hub, since: number, name: string): Promise<Ev[]> {
  return (await allEvents(hub)).filter((e) => e.kind === 'ask.created' && e.log_pos > since && String(e.data?.question ?? '').includes(name));
}
export const handleOf = (ask: Ev) => `ask:${ask.id}`;

// ---- The session's Claude Code (fixtures/agent.mjs): one long-lived process, the parent of every deep-hook run of the
// session, as Claude Code is of its hook commands.
class Agent {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Ran) => void>();
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
        done({ code: null, signal: null, stdout: '', stderr: 'the session\'s agent process exited', ms: 0, timedOut: false, ended: Date.now() });
      }
    });
    this.child = child;
  }
  private readonly child: ChildProcess;
  run(args: readonly string[], cwd: string, input: string, timeoutMs: number): Promise<Ran> {
    const n = ++this.n;
    return new Promise((resolve) => {
      this.pending.set(n, resolve);
      this.child.stdin!.write(`${JSON.stringify({ n, args, cwd, input, timeoutMs })}\n`);
    });
  }
}
const agents = new Map<string, Agent>();

export interface Session { id: string; cwd: string; transcript: string; prompt?: string }
export function newSession(w: World): Session {
  const id = randomUUID();
  const transcript = join(w.home, '.claude/projects', w.repo.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  agents.set(id, new Agent(w));
  return { id, cwd: w.repo, transcript };
}
function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, output_tokens: 10 } } });
function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt && event !== 'SessionStart') base.prompt_id = s.prompt;
  if (event === 'SessionStart') Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' });
  return { ...base, ...extra };
}
/** deep-hook as Claude Code runs our hook entry: `deep-hook claude-code <event>`, the payload on stdin, a child of the session's process. */
function fire(body: Line, timeoutMs = 150_000): Promise<Ran> {
  const agent = agents.get(String(body.session_id))!;
  return agent.run(['claude-code', String(body.hook_event_name)], String(body.cwd), JSON.stringify(body), timeoutMs);
}
/** What deep-hook's output tells Claude Code: exit 2 or a deny/block decision stops the call (or the stop); exit 0 lets it go. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
export async function sessionStart(s: Session): Promise<void> {
  const r = await fire(payload(s, 'SessionStart'));
  if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook must end with exit 0: ${shown(r)}`);
}
/** A prompt you type: its transcript entry and its UserPromptSubmit. */
export async function typed(s: Session, text: string): Promise<void> {
  const promptId = randomUUID();
  s.prompt = promptId;
  appendTranscript(s, { type: 'user', promptId, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  const r = await fire(payload(s, 'UserPromptSubmit', { prompt: text }));
  if (r.code !== 0) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
}
let calls = 0;
const callId = () => `toolu_${randomBytes(10).toString('hex')}${++calls}`;
/** The turn's work: the agent writes a file in the repository (Write, allowed, PostToolUse), so its stop is judged. */
export async function work(s: Session): Promise<void> {
  const file = join(s.cwd, 'src', `fix${++calls}.ts`);
  const input = { file_path: file, content: `export const fixed${calls} = true;\n` };
  const id = callId();
  appendTranscript(s, assistant([{ type: 'tool_use', id, name: 'Write', input }], 'tool_use'));
  const r = await fire(payload(s, 'PreToolUse', { tool_name: 'Write', tool_input: input, tool_use_id: id }));
  if (decision(r) !== 'allow') throw Error(`BLOCKED: the turn's Write of ${file} must be allowed: ${shown(r)}`);
  writeFileSync(file, input.content);
  appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: `File created successfully at: ${file}` }] } });
  await fire(payload(s, 'PostToolUse', { tool_name: 'Write', tool_input: input, tool_use_id: id, tool_response: { type: 'create', filePath: file, content: input.content } }));
}
/**
 * The agent ends its turn on `question` and the planted sorter answers it "proceed": the record holds a
 * question.proceeded naming it and the rule, no ask is raised for it, and the stop's reply sends the agent on.
 */
export async function expectProceed(hub: Hub, s: Session, question: string, rule: string, who: string): Promise<Ev> {
  const since = await lastPos(hub);
  appendTranscript(s, assistant([{ type: 'text', text: question }], 'end_turn'));
  const r = await fire(payload(s, 'Stop', { stop_hook_active: false, last_assistant_message: question }));
  const deadline = Date.now() + 30_000;
  for (;;) {
    const events = (await allEvents(hub)).filter((e) => e.log_pos > since);
    const proceeded = events.find((e) => e.kind === 'question.proceeded' && String(e.data?.question ?? '') === question && e.data?.rule === rule);
    if (proceeded) {
      const asked = events.filter((e) => e.kind === 'ask.created' && String(e.data?.question ?? '').includes(question));
      must(!asked.length, `BLOCKED: a "proceed" is not an ask: "${question}" was answered proceed, yet ${asked.map(handleOf).join(', ')} asks it`);
      must(decision(r) === 'deny' && /proceed/i.test(`${r.stdout}\n${r.stderr}`), `BLOCKED: the stop's reply must carry the proceed for "${question}" (a Stop block whose reason says proceed): ${shown(r)}; read at ${loadReading()}`);
      return proceeded;
    }
    if (Date.now() > deadline) throw Error(`BLOCKED: ${who} the planted sorter's proceed for "${question}" must be recorded as question.proceeded with rule ${rule}: 30 s after the stop, none is; the stop's reply was ${shown(r)}`);
    await sleep(500);
  }
}
/**
 * In the turn the proceed started, the agent runs a foreground subagent (corpus 2.1.308, `subagent`): the Agent call's
 * PreToolUse, allowed; the subagent's SubagentStop under the parent's session_id with its agent_id, which the record
 * must hold as the session's agent.stop naming the child; then the Agent call's PostToolUse.
 */
export async function subagent(hub: Hub, s: Session, child: string): Promise<void> {
  const input = { description: 'Run the tests', prompt: 'Run `npm test` and report its output.', subagent_type: 'general-purpose' };
  const id = callId();
  appendTranscript(s, assistant([{ type: 'tool_use', id, name: 'Agent', input }], 'tool_use'));
  const pre = await fire(payload(s, 'PreToolUse', { tool_name: 'Agent', tool_input: input, tool_use_id: id }));
  if (decision(pre) !== 'allow') throw Error(`BLOCKED: the Agent call that starts the subagent must be allowed: ${shown(pre)}`);
  const agentTranscript = join(dirname(s.transcript), s.id, 'subagents', `agent-${child}.jsonl`);
  mkdirSync(dirname(agentTranscript), { recursive: true });
  writeFileSync(agentTranscript, `${JSON.stringify({ parentUuid: null, isSidechain: true, agentId: child, type: 'user', message: { role: 'user', content: input.prompt }, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED })}\n`);
  const since = await lastPos(hub);
  const stop = await fire(payload(s, 'SubagentStop', { agent_id: child, agent_type: 'general-purpose', agent_transcript_path: agentTranscript, stop_hook_active: false, last_assistant_message: 'npm test passed: 0 failures.' }));
  const deadline = Date.now() + 30_000;
  for (;;) {
    const stops = (await allEvents(hub)).filter((e) => e.log_pos > since && e.kind === 'agent.stop');
    if (stops.some((e) => e.data?.child === child)) break;
    if (Date.now() > deadline) throw Error(`BLOCKED: the SubagentStop must reach the record as the session's agent.stop naming the child ${child}: 30 s after it, the record's stops since are ${JSON.stringify(stops.map((e) => e.data))}; the hook ended ${shown(stop)}`);
    await sleep(250);
  }
  appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: [{ type: 'text', text: 'npm test passed: 0 failures.' }] }] } });
  await fire(payload(s, 'PostToolUse', { tool_name: 'Agent', tool_input: input, tool_use_id: id, tool_response: { status: 'completed', content: [{ type: 'text', text: 'npm test passed: 0 failures.' }] } }));
}

/** One run of a Bash call's PreToolUse: its tool_use in the transcript, its hook through deep-hook. */
export interface Pending { id: string; done: Promise<Ran>; result?: Ran }
export function bash(s: Session, command: string): Pending {
  const id = callId();
  const input = { command, description: command };
  appendTranscript(s, assistant([{ type: 'tool_use', id, name: 'Bash', input }], 'tool_use'));
  const p: Pending = { id, done: Promise.resolve(undefined as unknown as Ran) };
  p.done = fire(payload(s, 'PreToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: id })).then((r) => { p.result = r; return r; });
  return p;
}
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
/** A run of the call deep-hook let through: INCONCLUSIVE when the hub never decided it, otherwise the failure naming it. */
export async function notRun(hub: Hub, p: Pending, label: string, who: string): Promise<void> {
  if (!p.result || decision(p.result) !== 'allow') return;
  if (await late(hub, p.id)) throw new Inconclusive(`${who} \`${label}\` was let through because the hub's acknowledgement came after deep-hook's 50 ms (${shown(p.result)}), so the hub never decided it; read at ${loadReading()}`);
  throw Error(`${who} \`${label}\` ran in the turn the proceed started, after the subagent's stop, with no authority ask: deep-hook allowed it at PreToolUse with nothing held (${shown(p.result)})`);
}
