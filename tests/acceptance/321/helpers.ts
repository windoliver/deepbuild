// Shared test-side tools for issue #321's acceptance tests (README): a temp world (a home with the shipped default
// guards, your ask settings and the OS-confirmation stub; a git repository the sessions work in), the hub as a process
// with its test settings, the record read back through the hub's socket (`events.read`), Claude Code sessions driven
// through the real deep-hook binary with payloads and transcripts shaped like the corpus's, the fake MCP servers
// (fixtures/mcp-server.mjs) declared in Claude Code's config, your answer through `deep inbox answer`, and the
// judgements each criterion reads. Parts are adapted from tests/acceptance/304/helpers.ts and
// tests/acceptance/25/routes/helpers.ts (same repo, same license); this suite keeps its own copy so a redraft of
// theirs never moves these tests. Nothing here stands in for DeepBuild: every decision comes from the real hub,
// deep-hook and CLI. The test plays Claude Code: it fires each hook through deep-hook and runs a call (an MCP call's
// tools/call to the fake server) only when deep-hook's PreToolUse allows it, as Claude Code does.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
export const SERVER = fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url));
export const DAY = 86_400_000;

/** Each criterion's ID: `#321.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC1 = '#321.69952336';
export const AC2 = '#321.d75b4c41';
export const AC3 = '#321.876b8dcb';
export const AC4 = '#321.ed0f414b';
export const AC5 = '#321.e6090cff';

/** The questions the planted sorter answers "proceed" (the issue's words). */
export const PUSH_Q = 'want me to push to main?';
export const TESTS_Q = 'want me to run the tests?';

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
export const jsonLines = (text: string): Line[] => text.split('\n').flatMap((raw) => { const l = parseObject(raw); return l ? [l] : []; });
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
/**
 * The message a scenario throws on a planted program, or null when it holds. A BLOCKED setup (the plant isn't there
 * to start) and an INCONCLUSIVE reading are thrown on, never read as the plant's failure.
 */
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

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh321-'));
  made.push(dir);
  return dir;
}

// ---- Processes this suite started. Stopped by PID only, never by name or port.
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
/** Stops every process this suite started (SIGCONT and SIGTERM, then SIGKILL after 3 s) and removes the temp folders. */
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

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a child gets: HOME the test's home, and no DEEP_/GIT_/XDG_/CLAUDE settings or billing keys of this process's. */
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
/** Runs a command to its end without blocking this process's event loop. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 60_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;

// ---- A world: a home and a repository.
/** Your ask settings (#319's shape): setup's drafts with no `batch`, so every ask shows when it's raised; authority 1 day. */
export const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
export interface World { tmp: string; home: string; root: string; repo: string; confirm: string }
/**
 * `<tmp>/h` is HOME for every process: the hub's root `<home>/.deepbuild` holds the shipped default guards as the
 * first rules.json (as #304's suite seeds it) and config.json with your ask settings. `<tmp>/repo` is a git
 * repository with one commit on main, the folder every session works in. `<tmp>/confirm` says `confirmed`: the OS
 * confirming you when `deep inbox answer` counts (#24's stub, DEEP_HUB_TEST_CONFIRM).
 */
export function makeWorld(): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
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
/**
 * The planted sorter (README, The planted sorter): a file naming the rule it sorts by and the questions it answers
 * "proceed", handed to the hub as DEEP_HUB_TEST_SORTER. Returns its path.
 */
export function writeSorter(w: World, rule: string, proceed: string[]): string {
  const file = join(w.tmp, 'sorter.json');
  writeFileSync(file, `${JSON.stringify({ rule, proceed }, null, 2)}\n`);
  return file;
}

// ---- The hub as a process: `deep hub run`, HOME the world's.
export interface Hub { pid: number; socket: string; home: string; root: string; child: ChildProcess; exit: Promise<void>; readyAt: number; clock: number | undefined; stderr(): string }
export interface HubOptions { plant?: string | undefined; clock?: number | undefined; sorter?: string | undefined }
/**
 * Starts `deep hub run` with DEEP_HUB_TEST_CONFIRM, and with DEEP_HUB_PLANT, DEEP_HUB_TEST_CLOCK (the hub's clock
 * starts there and moves with real time) and DEEP_HUB_TEST_SORTER when given. A hub that doesn't start (a plant the
 * base doesn't list) is BLOCKED.
 */
export async function startHub(w: World, o: HubOptions = {}): Promise<Hub> {
  const env = childEnv(w.home, {
    DEEP_HUB_TEST_CONFIRM: w.confirm,
    DEEP_HUB_PLANT: o.plant,
    DEEP_HUB_TEST_CLOCK: o.clock === undefined ? undefined : String(Math.round(o.clock)),
    DEEP_HUB_TEST_SORTER: o.sorter,
  });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  return { pid: Number(ready.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, readyAt: Date.now(), clock: o.clock, stderr: () => err };
}
/** The hub's clock, bounded from below: its test clock's start plus the real time since its ready line. */
export const hubNow = (hub: Hub): number => (hub.clock === undefined ? Date.now() : hub.clock + (Date.now() - hub.readyAt));
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGCONT'); } catch { /* gone */ }
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 30_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(50);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  await hub.exit;
}

// ---- The record, read back through the hub's socket as the CLI reads it (the cli role, with the control token).
export function control(hub: Hub, method: string, params: Line, timeoutMs = 30_000): Promise<Line> {
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
export interface Ev { id: string; kind: string; log_pos: number; ts: number; writer?: string; subject?: string; session?: string; data: Line }
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
/** The asks raised after `since` whose question names every one of `names`. */
export async function asksNaming(hub: Hub, since: number, names: readonly string[]): Promise<Ev[]> {
  return (await allEvents(hub)).filter((e) => e.kind === 'ask.created' && e.log_pos > since && names.every((n) => String(e.data?.question ?? '').includes(n)));
}
export const handleOf = (ask: Ev) => `ask:${ask.id}`;

// ---- Each session's Claude Code (fixtures/agent.mjs, README: Redraft): one long-lived process per session, the
// parent of every deep-hook run of that session, as Claude Code is of its hook commands. The hub binds the session to
// it, so `deep inbox answer`, run by this test process, is outside every session's process tree, as your terminal is.
export const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
class Agent {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Ran) => void>();
  private constructor(private readonly child: ChildProcess) {
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
  }
  static start(w: World): Agent {
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w.home), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Agent(child);
  }
  /** `deep-hook <args…>` as this session's child, `input` on its stdin. */
  run(args: readonly string[], cwd: string, input: string, timeoutMs: number): Promise<Ran> {
    const n = ++this.n;
    return new Promise((resolve) => {
      this.pending.set(n, resolve);
      this.child.stdin!.write(`${JSON.stringify({ n, args, cwd, input, timeoutMs })}\n`);
    });
  }
}
const agents = new Map<string, Agent>();

// ---- Claude Code sessions: hook payloads and transcripts shaped like the corpus's (adapters/corpus/claude-code).
export interface Session { id: string; cwd: string; transcript: string; prompt?: string }
/** A session: its transcript, and its own Claude Code process that runs its hooks. */
export function newSession(w: World): Session {
  const id = randomUUID();
  const transcript = join(w.home, '.claude/projects', w.repo.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  agents.set(id, Agent.start(w));
  return { id, cwd: w.repo, transcript };
}
function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, output_tokens: 10 } } });
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt && event !== 'SessionStart') base.prompt_id = s.prompt;
  if (event === 'SessionStart') Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' });
  return { ...base, ...extra };
}
/**
 * deep-hook as Claude Code runs our hook entry: `deep-hook claude-code <event>`, the payload on stdin, HOME the
 * world's, a child of the session's own Claude Code process (README, Redraft).
 */
export function fire(_w: World, body: Line, timeoutMs = 150_000): Promise<Ran> {
  const agent = agents.get(String(body.session_id));
  if (!agent) throw Error(`BLOCKED: no Claude Code process for session ${String(body.session_id)}; make sessions with newSession`);
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
/** A session's start: its SessionStart through deep-hook. */
export async function sessionStart(w: World, s: Session): Promise<void> {
  const r = await fire(w, payload(s, 'SessionStart'));
  if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook must end with exit 0: ${shown(r)}`);
}
/** A prompt you type: its transcript entry and its UserPromptSubmit. */
export async function typed(w: World, s: Session, text: string): Promise<void> {
  const promptId = randomUUID();
  s.prompt = promptId;
  appendTranscript(s, { type: 'user', promptId, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  const r = await fire(w, payload(s, 'UserPromptSubmit', { prompt: text }));
  if (r.code !== 0) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
}
let files = 0;
/** The turn's work: the agent writes a file in the repository (Write, allowed, written, PostToolUse), so its stop is judged. */
export async function work(w: World, s: Session): Promise<void> {
  const file = join(s.cwd, 'src', `fix${++files}.ts`);
  const call: Call = { tool_name: 'Write', tool_input: { file_path: file, content: `export const fixed${files} = true;\n` } };
  const id = callId();
  appendTranscript(s, assistant([{ type: 'tool_use', id, name: call.tool_name, input: call.tool_input }], 'tool_use'));
  const r = await fire(w, payload(s, 'PreToolUse', { ...call, tool_use_id: id }));
  if (decision(r) !== 'allow') throw Error(`BLOCKED: the turn's Write of ${file} must be allowed: ${shown(r)}`);
  writeFileSync(file, String(call.tool_input.content));
  appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: `File created successfully at: ${file}` }] } });
  await fire(w, payload(s, 'PostToolUse', { ...call, tool_use_id: id, tool_response: { type: 'create', filePath: file, content: call.tool_input.content } }));
}

// ---- Calls, and what the agent's PreToolUse decides for each.
export interface Call { tool_name: string; tool_input: Line }
export const bash = (command: string): Call => ({ tool_name: 'Bash', tool_input: { command, description: command } });
export const mcpCall = (server: FakeServer, tool: string): Call => ({ tool_name: `mcp__${server.name}__${tool}`, tool_input: { owner: 'acme', repo: 'shop' } });
export const labelOf = (c: Call): string => (c.tool_name === 'Bash' ? String(c.tool_input.command) : c.tool_name);
let calls = 0;
export const callId = () => `toolu_${randomBytes(10).toString('hex')}${++calls}`;
/** One call the agent makes, its PreToolUse running: `result` is set once deep-hook has ended and, for an allowed MCP call, the call has run. */
export interface Pending { id: string; call: Call; started: number; done: Promise<Ran>; result?: Ran }
/**
 * The agent makes `call`: its tool_use goes into the transcript and its PreToolUse runs through deep-hook. When
 * deep-hook allows an MCP call, the test runs it on the fake server (tools/call), as Claude Code would.
 */
export function startCall(w: World, s: Session, call: Call, server?: FakeServer): Pending {
  const id = callId();
  appendTranscript(s, assistant([{ type: 'tool_use', id, name: call.tool_name, input: call.tool_input }], 'tool_use'));
  const p: Pending = { id, call, started: Date.now(), done: Promise.resolve(undefined as unknown as Ran) };
  p.done = fire(w, payload(s, 'PreToolUse', { ...call, tool_use_id: id })).then(async (r) => {
    if (server && decision(r) === 'allow') await server.runCall(call.tool_name.split('__').slice(2).join('__'), call.tool_input);
    p.result = r;
    return r;
  });
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

// ---- The fake MCP servers (fixtures/mcp-server.mjs), declared in Claude Code's config, ~/.claude.json.
export interface Tool { name: string; description: string; inputSchema: Line; annotations?: Line }
const SCHEMA = { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' } }, required: ['owner', 'repo'] };
export const tool = (name: string, annotations?: Line): Tool => ({ name, description: `${name.replace(/_/g, ' ')} on a repository`, inputSchema: SCHEMA, ...(annotations ? { annotations } : {}) });
/**
 * A stdio MCP server Claude Code loads. `user` scope is `~/.claude.json`'s `mcpServers`, where DeepBuild's sync
 * writes the servers it syncs ("written at user level"); `local` scope is `projects[<repo>].mcpServers`, where
 * `claude mcp add` writes a server you add yourself by default. Its code is its tools file; an update rewrites it.
 */
export class FakeServer {
  private constructor(readonly w: World, readonly name: string, readonly scope: 'user' | 'local', readonly toolsFile: string, readonly log: string, public tools: Tool[]) {}
  static install(w: World, name: string, scope: 'user' | 'local', tools: Tool[]): FakeServer {
    const dir = join(w.tmp, `mcp-${name}`);
    mkdirSync(dir, { recursive: true });
    const server = new FakeServer(w, name, scope, join(dir, 'tools.json'), join(dir, 'requests.jsonl'), tools);
    writeFileSync(server.toolsFile, `${JSON.stringify({ version: '1.0.0', tools }, null, 2)}\n`);
    writeFileSync(server.log, '');
    const file = join(w.home, '.claude.json');
    const config = existsSync(file) ? (parseObject(readFileSync(file, 'utf8')) ?? {}) : {};
    const entry = { type: 'stdio', command: NODE, args: [SERVER, name, server.toolsFile, server.log], env: {} };
    if (scope === 'user') config.mcpServers = { ...(config.mcpServers ?? {}), [name]: entry };
    else {
      config.projects ??= {};
      const project = config.projects[w.repo] ?? {};
      config.projects[w.repo] = { ...project, mcpServers: { ...(project.mcpServers ?? {}), [name]: entry } };
    }
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    return server;
  }
  /** A server update: its installed code now lists `tools`, under a new version. */
  update(tools: Tool[], version: string): void {
    this.tools = tools;
    writeFileSync(this.toolsFile, `${JSON.stringify({ version, tools }, null, 2)}\n`);
  }
  get names(): string[] { return this.tools.map((t) => t.name); }
  requests(): Line[] { return jsonLines(readFileSync(this.log, 'utf8')); }
  /** How many tools/call requests the server received for `name`, from anyone. */
  calls(name: string): number { return this.requests().filter((r) => r.method === 'tools/call' && r.tool === name).length; }
  /** Claude Code running an allowed call: the server started from its config, initialized, and the tool called. */
  runCall(name: string, args: Line): Promise<Line> {
    return new Promise((resolve, reject) => {
      const child = spawn(NODE, [SERVER, this.name, this.toolsFile, this.log], { env: childEnv(this.w.home), stdio: ['pipe', 'pipe', 'ignore'] });
      own(child.pid);
      let buffer = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error(`BLOCKED: the fake server ${this.name} gave no reply to tools/call ${name} in 30 s`)); }, 30_000);
      child.stdout.setEncoding('utf8').on('data', (d: string) => {
        buffer += d;
        for (const line of jsonLines(buffer)) {
          if (line.id === 3) { clearTimeout(timer); child.stdin.end(); resolve(line); }
        }
      });
      child.stdin.on('error', () => undefined);
      const send = (m: Line) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
      send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: COVERED } } });
      send({ method: 'notifications/initialized' });
      send({ id: 3, method: 'tools/call', params: { name, arguments: args } });
    });
  }
}

/**
 * Scope: "each server's tool list is recorded at each session start". After the session start at `since`, the
 * record must hold the server's whole current list: events (other than tool calls, asks and prompts) naming the
 * server that, together, name each of its tools. Waits up to 30 s, so a hub that records it just after the hook
 * ends passes; how and under which event kind it is recorded is the implementer's.
 */
export async function expectToolList(hub: Hub, since: number, server: FakeServer, who: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const texts = (await allEvents(hub))
      .filter((e) => e.log_pos > since && !e.kind.startsWith('tool.') && !e.kind.startsWith('ask.') && e.kind !== 'user.ask')
      .map((e) => JSON.stringify(e.data ?? {})).filter((t) => t.includes(server.name));
    const missing = server.names.filter((n) => !texts.some((t) => t.includes(n)));
    if (!missing.length) return;
    if (Date.now() > deadline) throw Error(`${who} the session start must record ${server.name}'s tool list (${server.names.join(', ')}): 30 s after it, no event names ${server.name} with ${missing.join(', ')}`);
    await sleep(500);
  }
}
/** A session's start that records each server's tool list. */
export async function startRecorded(w: World, hub: Hub, s: Session, servers: FakeServer[], who: string): Promise<void> {
  const since = await lastPos(hub);
  await sessionStart(w, s);
  for (const server of servers) await expectToolList(hub, since, server, who);
}

// ---- The judgements the criteria read (README, Held at PreToolUse).
export interface Held { who: string; label: string; call: Call; s: Session; ask: Ev; pendings: Pending[]; server?: FakeServer; tool?: string; before: number; names: readonly string[] }
const toolOf = (c: Call): string => c.tool_name.split('__').slice(2).join('__');
/** The failure of a call that ran before you answered, naming the call, or for an MCP call the server's request count. */
async function ranEarly(hub: Hub, h: { who: string; label: string; server?: FakeServer | undefined; tool?: string | undefined; before: number }, p: Pending): Promise<never> {
  if (await late(hub, p.id)) throw new Inconclusive(`${h.who} \`${h.label}\` was let through because the hub's acknowledgement came after deep-hook's 50 ms (${shown(p.result!)}), so the hub never decided it; read at ${loadReading()}`);
  if (h.server && h.tool) {
    const n = h.server.calls(h.tool) - h.before;
    throw Error(`${h.who} the fake server ${h.server.name} received ${n} tools/call request(s) for ${h.tool} before you answered: deep-hook allowed ${p.call.tool_name} at PreToolUse (${shown(p.result!)})`);
  }
  throw Error(`${h.who} \`${h.label}\` ran before you answered: deep-hook allowed it at PreToolUse with nothing held (${shown(p.result!)})`);
}
/** A pending call must not have been let through; one deep-hook still runs past Claude Code's hook timeout fails too. */
async function notRun(hub: Hub, h: Held, p: Pending): Promise<void> {
  if (p.result && decision(p.result) === 'allow') await ranEarly(hub, h, p);
  if (p.result?.timedOut) throw Error(`${h.who} deep-hook's PreToolUse for \`${h.label}\` still waited ${(p.result.ms / 1000).toFixed(0)} s after its start: Claude Code ends a PreToolUse hook at its timeout (60 s unless the entry sets one; the facts' hookTimeouts) and runs the call, so a hold must end within it`);
  if (h.server && h.tool && h.server.calls(h.tool) !== h.before) {
    throw Error(`${h.who} the fake server ${h.server.name} received ${h.server.calls(h.tool) - h.before} tools/call request(s) for ${h.tool} before you answered`);
  }
}
/**
 * "Held at PreToolUse with an authority ask naming it, which waits for your answer": the agent makes `call`; within
 * 90 s an ask raised after `since` names it (its question holds every one of `names`), and it is an authority ask,
 * while deep-hook has not let the call through (it may still be waiting, or have denied it naming the ask) and, for
 * an MCP call, the fake server has received no tools/call for it.
 */
export async function expectHeld(w: World, hub: Hub, s: Session, call: Call, o: { who: string; names: readonly string[]; since: number; server?: FakeServer }): Promise<Held> {
  const label = labelOf(call);
  const tool = o.server ? toolOf(call) : undefined;
  const before = o.server && tool ? o.server.calls(tool) : 0;
  const h = { who: o.who, label, server: o.server, tool, before };
  const p = startCall(w, s, call, o.server);
  const deadline = Date.now() + 90_000;
  let ask: Ev | undefined;
  for (;;) {
    if (p.result && decision(p.result) === 'allow') await ranEarly(hub, h, p);
    ask = (await asksNaming(hub, o.since, o.names))[0];
    if (ask) break;
    if (Date.now() > deadline) {
      const how = p.result ? `deep-hook ended ${decision(p.result)} (${shown(p.result)})` : 'deep-hook is still waiting';
      throw Error(`${o.who} \`${label}\` must be held with an authority ask naming it (${o.names.join(', ')}): no ask names it 90 s after the call; ${how}`);
    }
    await sleep(250);
  }
  must(ask.data.kind === 'authority', `${o.who} the hold of \`${label}\` must be an authority ask: ${handleOf(ask)} was filed as ${String(ask.data.kind)}, recommending ${JSON.stringify(ask.data.recommended)} with options ${JSON.stringify(ask.data.options)}`);
  const held: Held = { who: o.who, label, call, s, ask, pendings: [p], before, names: o.names, ...(o.server ? { server: o.server } : {}), ...(tool ? { tool } : {}) };
  await notRun(hub, held, p);
  return held;
}
/** The agent makes the held call again before you answer: it isn't let through either, and it raises no second ask. */
export async function againHeld(w: World, hub: Hub, held: Held, since: number): Promise<void> {
  const p = startCall(w, held.s, held.call, held.server);
  held.pendings.push(p);
  await sleep(5000);
  await notRun(hub, held, p);
  const asks = await asksNaming(hub, since, held.names);
  must(asks.length === 1, `${held.who} one ask per server update: \`${held.label}\` called twice must be held by one ask, ${handleOf(held.ask)}; ${asks.length} asks name it: ${asks.map(handleOf).join(', ')}`);
}
/** "Which waits for your answer": `ms` later, with no answer given, none of the held call's runs has gone through. */
export async function stillHeld(hub: Hub, held: Held, ms: number): Promise<void> {
  await sleep(ms);
  for (const p of held.pendings) await notRun(hub, held, p);
  const closed = (await allEvents(hub)).filter((e) => e.subject === handleOf(held.ask) && e.kind !== 'ask.created' && /^ask\.(answered|defaulted|escalated|cancelled|superseded|moot)$/.test(e.kind));
  must(!closed.length, `${held.who} ${handleOf(held.ask)} must wait for your answer; with none given it closed: ${closed.map((e) => e.kind).join(', ')}`);
}
/** Your yes: the held ask's option that approves (decision allow), through `deep inbox answer` with the OS confirming you. */
export async function approve(w: World, hub: Hub, held: Held): Promise<number> {
  for (const p of held.pendings) await notRun(hub, held, p);
  const options = (held.ask.data.options ?? []) as Line[];
  const yes = options.find((o) => o.decision === 'allow');
  must(yes !== undefined, `${held.who} ${handleOf(held.ask)} must have an option that approves \`${held.label}\` (decision allow): ${JSON.stringify(options)}`);
  const at = Date.now();
  const r = await run(NODE, [CLI, 'inbox', 'answer', handleOf(held.ask), String(yes.id)], { env: childEnv(w.home), cwd: w.tmp, timeoutMs: 120_000 });
  must(r.code === 0, `${held.who} your yes to ${handleOf(held.ask)} through deep inbox answer must count, exit 0: ${shown(r)}`);
  return at;
}
/**
 * "After your yes, it runs": a run of the held call still waiting ends allowed, or, when every run of it was denied
 * while held, the same call sent again is allowed with no new ask; for an MCP call the fake server then receives
 * its tools/call.
 */
export async function expectRuns(w: World, hub: Hub, held: Held, answeredAt: number): Promise<void> {
  const results = await Promise.all(held.pendings.map((p) => p.done));
  for (const [i, r] of results.entries()) {
    if (r.timedOut) throw Error(`${held.who} deep-hook's PreToolUse for \`${held.label}\` still waited ${(r.ms / 1000).toFixed(0)} s after its start: Claude Code ends a PreToolUse hook at its timeout and runs the call`);
    if (decision(r) === 'allow' && r.ended < answeredAt) await ranEarly(hub, held, held.pendings[i]!);
  }
  if (!results.some((r) => decision(r) === 'allow')) {
    const since = await lastPos(hub);
    const p = startCall(w, held.s, held.call, held.server);
    const r = await p.done;
    must(decision(r) === 'allow', `${held.who} after your yes to ${handleOf(held.ask)}, \`${held.label}\` must run: the held call was denied, and the same call sent again was not allowed (${shown(r)})`);
    const again = await asksNaming(hub, since, held.names);
    must(!again.length, `${held.who} after your yes to ${handleOf(held.ask)}, \`${held.label}\` must run with no new ask; ${again.map(handleOf).join(', ')} asks again`);
  }
  if (held.server && held.tool) {
    must(held.server.calls(held.tool) > held.before, `${held.who} after your yes to ${handleOf(held.ask)}, the fake server ${held.server.name} must receive the tools/call for ${held.tool}; it received none`);
  }
}
/** A call that needs nothing held: allowed, run (for an MCP call, received by the fake server), and no ask names it. */
export async function expectFree(w: World, hub: Hub, s: Session, call: Call, o: { who: string; names: readonly string[]; server?: FakeServer }): Promise<void> {
  const label = labelOf(call);
  const since = await lastPos(hub);
  const tool = o.server ? toolOf(call) : undefined;
  const before = o.server && tool ? o.server.calls(tool) : 0;
  const r = await startCall(w, s, call, o.server).done;
  must(decision(r) === 'allow', `${o.who} \`${label}\` must run with no ask: deep-hook's PreToolUse ended ${decision(r)} (${shown(r)})`);
  if (o.server && tool) must(o.server.calls(tool) === before + 1, `${o.who} \`${label}\` must reach the fake server ${o.server.name}: it received ${o.server.calls(tool) - before} tools/call request(s) for ${tool}`);
  await sleep(2000);
  const asks = await asksNaming(hub, since, o.names);
  must(!asks.length, `${o.who} \`${label}\` must run with no ask; ${asks.map((a) => `${handleOf(a)} ("${String(a.data.question)}")`).join(', ')} asks about it`);
}
/**
 * The agent ends its turn on `question` and the planted sorter answers it "proceed": the record holds the proceed
 * with the question and the sorter's rule (an event that isn't an ask), no ask is raised for it, and the stop's reply
 * sends the agent on with the proceed (Claude Code's Stop block, its reason saying proceed): the turn it starts.
 */
export async function expectProceed(w: World, hub: Hub, s: Session, question: string, rule: string, who: string): Promise<void> {
  const since = await lastPos(hub);
  appendTranscript(s, assistant([{ type: 'text', text: question }], 'end_turn'));
  const r = await fire(w, payload(s, 'Stop', { stop_hook_active: false, last_assistant_message: question }));
  const deadline = Date.now() + 30_000;
  for (;;) {
    const events = (await allEvents(hub)).filter((e) => e.log_pos > since);
    const recorded = events.find((e) => !e.kind.startsWith('ask.') && JSON.stringify(e.data ?? {}).includes(question) && JSON.stringify(e.data ?? {}).includes(rule));
    if (recorded) {
      const asked = events.filter((e) => e.kind === 'ask.created' && String(e.data?.question ?? '').includes(question));
      must(!asked.length, `${who} a "proceed" is not an ask: "${question}" was answered proceed, yet ${asked.map(handleOf).join(', ')} asks it`);
      break;
    }
    if (Date.now() > deadline) throw Error(`${who} the planted sorter's proceed for "${question}" must be recorded with the question and the rule that sorted it (${rule}): 30 s after the stop, no event names both`);
    await sleep(500);
  }
  must(decision(r) === 'deny' && /proceed/i.test(`${r.stdout}\n${r.stderr}`), `${who} the stop's one reply must carry the proceed for "${question}", sending the agent on (a Stop block whose reason says proceed): ${shown(r)}; read at ${loadReading()}`);
}
