// Shared test-side tools for issue #1848's acceptance tests (README): a temp world (a home with the shipped default
// guards as rules.json, your ask settings and the OS-confirmation stub; a git repository the calls work in), deep-hook
// built (plain or the planted wrong program) and run as Claude Code's hook entry runs it, in its check mode and in its
// match mode; the hub as a process; the record read back through the hub's socket (`events.read`); sessions whose
// hooks run as children of their own Claude Code stand-in (fixtures/agent.mjs); a files server declared in Claude
// Code's config (fixtures/mcp-server.mjs); and your answer through `deep inbox answer`. Parts are adapted from
// tests/acceptance/304/helpers.ts and tests/acceptance/321/helpers.ts (same repo, same license); this suite keeps its
// own copy so a redraft of theirs never moves these tests. Nothing here stands in for deep-hook, the hub or the CLI:
// every decision comes from the real programs.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;
const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
const FACTS = join(REPO, 'adapters/claude-code.facts.json');
const SERVER = fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url));
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));

/** Each criterion's ID: `#1848.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC1 = '#1848.9bf497c4';
export const AC2 = '#1848.9ca3511a';
export const AC3 = '#1848.477a77d7';

/** The shipped default entries the criteria name. */
export const SPEC = 'no-deepbuild-spec-write';
export const TOKEN = 'no-control-token-read';
/** The planted wrong program AC3 names, a cargo feature of crates/deep-hook (README, The wrong program). */
export const PLANT = 'plant-every-string-a-path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
const jsonLines = (text: string): Line[] => text.split('\n').flatMap((raw) => { const l = parseObject(raw); return l ? [l] : []; });

// ---- Verdicts. A judgement throws a Failed naming the criterion; setup that can't be done throws BLOCKED; a hook the
// hub never decided is INCONCLUSIVE, a skip, never a pass.
export class Failed extends Error {
  constructor(message: string, readonly ran?: Ran) {
    super(message);
  }
}
export class Inconclusive extends Error {}
export function must(ok: unknown, message: string, ran?: Ran): asserts ok {
  if (!ok) throw new Failed(message, ran);
}
export async function verdict(ctx: TestContext, judge: () => Promise<void>): Promise<void> {
  try {
    await judge();
  } catch (error) {
    if (error instanceof Inconclusive) ctx.skip(`INCONCLUSIVE ${error.message}`);
    throw error;
  }
}
/** The judgement's failure on a planted program, or null when it holds; BLOCKED and INCONCLUSIVE are thrown on. */
export async function failureOf(judge: () => Promise<void>): Promise<Failed | null> {
  try {
    await judge();
    return null;
  } catch (error) {
    if (error instanceof Failed) return error;
    throw error;
  }
}

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1848-'));
  made.push(dir);
  return dir;
}

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
function own(pid: number | undefined): void {
  if (pid) owned.add(pid);
}
function alive(pid: number): boolean {
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
/** Stops every process this suite started (SIGTERM, then SIGKILL after 3 s) and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
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
function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
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

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
/** Runs a command to its end without blocking this process's event loop. */
function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
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
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, ms: performance.now() - t0, timedOut }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;

// ---- deep-hook builds: the plain one and the planted wrong program (README, The wrong program).
const builds = new Map<string, Promise<string>>();
/**
 * Builds deep-hook once per test process and returns the binary's path. `feature` builds the planted program into a
 * target folder of its own, target/<feature>/debug/deep-hook. A feature the crate lacks fails the cargo build, so the
 * plant's test fails BLOCKED, never passes.
 */
export function buildDeepHook(feature?: string): Promise<string> {
  const key = feature ?? 'plain';
  let built = builds.get(key);
  if (!built) {
    const args = ['build', '--locked', '-q', '-p', 'deep-hook'];
    let binary = DEEP_HOOK;
    if (feature) {
      const dir = join(REPO, 'target', feature);
      args.push('--features', feature, '--target-dir', dir);
      binary = join(dir, 'debug', 'deep-hook');
    }
    built = run('cargo', args, { timeoutMs: 900_000 }).then((r) => {
      if (r.code !== 0) throw Error(`BLOCKED: the deep-hook build ${feature ? `with the plant ${feature} ` : ''}did not build: cargo ${args.join(' ')} exited ${r.code}: ${r.stderr.slice(-2000)}`);
      if (!existsSync(binary)) throw Error(`BLOCKED: no binary at ${binary} after cargo ${args.join(' ')}`);
      // The first exec of a new binary is slow on macOS (it is checked before it runs); warm it once.
      spawnSync(binary, ['--version'], { stdio: 'ignore', timeout: 30_000 });
      return binary;
    });
    builds.set(key, built);
  }
  return built;
}

// ---- A world: a home and a repository.
/** Your ask settings (#319's shape): setup's drafts with no `batch`, so an ask shows when it's raised. */
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
export interface World { tmp: string; home: string; root: string; repo: string; confirm: string }
/**
 * `<tmp>/h` is HOME for every process: its `.deepbuild` holds the shipped default guards as the first rules.json (as
 * #304's suite seeds it) and config.json with your ask settings. `<tmp>/repo` is a git repository with `src/a.ts`
 * committed on main, the folder every call works in, outside HOME. `<tmp>/confirm` says `confirmed`: the OS confirming
 * you when `deep inbox answer` counts (DEEP_HUB_TEST_CONFIRM). Every path is the real one, links resolved.
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
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 0;\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  return { tmp, home, root, repo: realpathSync(repo), confirm };
}

// ---- The hub as a process: `deep hub run`, HOME the world's.
export interface Hub { pid: number; socket: string; root: string; exit: Promise<void> }
/** Starts `deep hub run` with DEEP_HUB_TEST_CONFIRM; one that doesn't start is BLOCKED. */
export async function startHub(w: World): Promise<Hub> {
  const env = childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm });
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
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid), socket: String(ready.socket), root: w.root, exit };
}
/** Stops a hub this suite started, by its PID: SIGTERM, then SIGKILL after 30 s. */
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
export interface Ev { id: string; kind: string; log_pos: number; data: Line }
async function allEvents(hub: Hub): Promise<Ev[]> {
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
/** The first event after `since` that `wanted` picks, within `ms`; undefined when none comes. */
async function waitFor(hub: Hub, since: number, wanted: (e: Ev) => boolean, ms: number): Promise<Ev | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = (await allEvents(hub)).find((e) => e.log_pos > since && wanted(e));
    if (found || Date.now() > deadline) return found;
    await sleep(500);
  }
}

// ---- Calls, and what deep-hook decides for each.
export interface Call { tool_name: string; tool_input: Line }
/** A call of the files server's tool: `mcp__files__<tool>`, as Claude Code names an MCP tool in a hook. */
export const files = (tool: string, input: Line): Call => ({ tool_name: `mcp__files__${tool}`, tool_input: input });
export const label = (c: Call): string => `${c.tool_name} ${JSON.stringify(c.tool_input)}`;
let calls = 0;
const callId = () => `toolu_${randomBytes(10).toString('hex')}${++calls}`;

/**
 * deep-hook as Claude Code runs our hook entry, `deep-hook claude-code PreToolUse`, the call's PreToolUse payload on
 * stdin, its cwd the repository, HOME the world's.
 */
export function hook(w: World, call: Call, binary: string): Promise<Ran> {
  const session = randomUUID();
  const transcript = join(w.home, '.claude/projects', w.repo.replace(/[^A-Za-z0-9]/g, '-'), `${session}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  const body = { session_id: session, transcript_path: transcript, cwd: w.repo, hook_event_name: 'PreToolUse', permission_mode: 'default', ...call, tool_use_id: callId() };
  return run(binary, ['claude-code', 'PreToolUse'], { cwd: w.repo, env: childEnv(w.home), input: JSON.stringify(body), timeoutMs: 60_000 });
}
/** deep-hook's check mode, `deep-hook check`, over the shipped entry `name` and the call: `{"matched": true | false}`. */
export async function checked(w: World, name: string, call: Call, binary: string): Promise<{ matched: boolean | undefined; ran: Ran }> {
  const entry = (JSON.parse(readFileSync(DEFAULT_RULES, 'utf8')) as { entries: Line }).entries[name];
  if (!entry) throw Error(`BLOCKED: crates/deep-hook/default-rules.json has no entry ${name}`);
  const ran = await run(binary, ['check'], { cwd: w.repo, env: childEnv(w.home), input: JSON.stringify({ entry, call: { ...call, cwd: w.repo } }), timeoutMs: 60_000 });
  const said = parseObject(ran.stdout.trim());
  return { matched: ran.code === 0 && typeof said?.matched === 'boolean' ? said.matched : undefined, ran };
}
/**
 * deep-hook's match mode, `deep-hook match`, the way the pi package runs it: one hook JSON line per call on stdin,
 * one reply line each, `{"matched": [...], "denials": [...]}`, the denials those for the hub away.
 */
export async function matched(w: World, list: Call[], binary: string): Promise<Line[]> {
  const input = list.map((c) => JSON.stringify({ cwd: w.repo, hook_event_name: 'PreToolUse', ...c, tool_use_id: callId() })).join('\n');
  const ran = await run(binary, ['match'], { cwd: w.repo, env: childEnv(w.home), input: `${input}\n`, timeoutMs: 60_000 });
  const replies = jsonLines(ran.stdout);
  if (ran.code !== 0 || replies.length !== list.length) throw Error(`BLOCKED: deep-hook match must answer each of ${list.length} line(s): ${shown(ran)}`);
  return replies;
}
/** What deep-hook's output tells Claude Code about a PreToolUse: exit 2 or a deny decision denies; exit 0 allows. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
/** Everything a PreToolUse's denial says: stderr for exit 2, stdout's decision reason otherwise. */
export const denialText = (r: Ran): string => `${r.stdout}\n${r.stderr}`;
/**
 * What a denial of an MCP call fails to name of what Scope's third bullet says it names: the entry, the argument (as a
 * whole word), the path (as the call wrote it, or resolved), and `deep_propose` where the entry's own denial points to it.
 */
export function lacks(text: string, o: { entry: string; argument: string; paths: readonly string[]; propose?: boolean }): string[] {
  const out: string[] = [];
  if (!text.includes(o.entry)) out.push(`the entry ${o.entry}`);
  if (!new RegExp(`(^|[^A-Za-z0-9_])${o.argument}([^A-Za-z0-9_]|$)`).test(text)) out.push(`the argument ${o.argument}`);
  if (!o.paths.some((p) => text.includes(p))) out.push(`the path ${o.paths.join(' or ')}`);
  if (o.propose && !text.includes('deep_propose')) out.push('deep_propose');
  return out;
}

// ---- Sessions for the hub-up criterion: each one's own Claude Code stand-in (fixtures/agent.mjs) runs its hooks, so
// the hub binds the session to that process and `deep inbox answer`, run by this test process, is your terminal.
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
        done({ code: null, signal: null, stdout: '', stderr: 'the session\'s agent process exited', ms: 0, timedOut: false });
      }
    });
  }
  static start(w: World): Agent {
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w.home), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Agent(child);
  }
  run(args: readonly string[], cwd: string, input: string, timeoutMs: number): Promise<Ran> {
    const n = ++this.n;
    return new Promise((resolve) => {
      this.pending.set(n, resolve);
      this.child.stdin!.write(`${JSON.stringify({ n, args, cwd, input, timeoutMs })}\n`);
    });
  }
}
const agents = new Map<string, Agent>();
/** The newest Claude Code version the facts cover: every transcript entry carries it, so no session is watch-only. */
const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();

export interface Session { id: string; cwd: string; transcript: string; prompt?: string }
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
function fire(s: Session, event: string, extra: Line = {}): Promise<Ran> {
  const body: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default', ...extra };
  if (s.prompt && event !== 'SessionStart') body.prompt_id = s.prompt;
  if (event === 'SessionStart') Object.assign(body, { source: 'startup', model: 'claude-haiku-5-5' });
  return agents.get(s.id)!.run(['claude-code', event], s.cwd, JSON.stringify(body), 150_000);
}
export async function sessionStart(s: Session): Promise<void> {
  const r = await fire(s, 'SessionStart');
  if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook must end with exit 0: ${shown(r)}`);
}
/** A prompt you type: its transcript entry and its UserPromptSubmit. */
export async function typed(s: Session, text: string): Promise<void> {
  s.prompt = randomUUID();
  appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  const r = await fire(s, 'UserPromptSubmit', { prompt: text });
  if (r.code !== 0) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
}
/** The agent makes `call`: its tool_use goes into the transcript and its PreToolUse runs through deep-hook. */
export async function pre(s: Session, call: Call): Promise<{ id: string; r: Ran }> {
  const id = callId();
  appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${id}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id, name: call.tool_name, input: call.tool_input }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
  return { id, r: await fire(s, 'PreToolUse', { ...call, tool_use_id: id }) };
}
/**
 * The hub up decided the call: its tool.before is in the record and isn't marked late. A call deep-hook decided alone
 * because the hub's acknowledgement came after its deadline is INCONCLUSIVE, never evidence for the hub-up criterion.
 */
export async function decidedByHub(hub: Hub, id: string, who: string): Promise<void> {
  const before = await waitFor(hub, 0, (e) => e.kind === 'tool.before' && e.data?.call === id, 15_000);
  const load = `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;
  if (!before) throw new Inconclusive(`${who} the hub never recorded the call ${id}, so it isn't known to have decided it; read at ${load}`);
  if (before.data.late === true) throw new Inconclusive(`${who} the hub's acknowledgement of ${id} came after deep-hook's deadline, so deep-hook decided it with the hub away; read at ${load}`);
}

// ---- A files server Claude Code loads (fixtures/mcp-server.mjs), in your user-scope config, ~/.claude.json.
export interface Tool { name: string; description: string; inputSchema: Line }
export const tool = (name: string): Tool => ({ name, description: `${name.replace(/_/g, ' ')} at a path`, inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path'] } });
export class FilesServer {
  private constructor(readonly name: string, readonly toolsFile: string) {}
  static install(w: World, name: string, tools: Tool[]): FilesServer {
    const dir = join(w.tmp, `mcp-${name}`);
    mkdirSync(dir, { recursive: true });
    const server = new FilesServer(name, join(dir, 'tools.json'));
    writeFileSync(server.toolsFile, `${JSON.stringify({ version: '1.0.0', tools }, null, 2)}\n`);
    const file = join(w.home, '.claude.json');
    const config = existsSync(file) ? (parseObject(readFileSync(file, 'utf8')) ?? {}) : {};
    config.mcpServers = { ...(config.mcpServers ?? {}), [name]: { type: 'stdio', command: NODE, args: [SERVER, name, server.toolsFile], env: {} } };
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    return server;
  }
  /** A server update: its installed code now lists `tools`, under a new version. */
  update(tools: Tool[], version: string): void {
    writeFileSync(this.toolsFile, `${JSON.stringify({ version, tools }, null, 2)}\n`);
  }
}
/** After a session start at `since`, the record holds the server's tool list: events naming the server and each tool. */
export async function listRecorded(hub: Hub, since: number, server: string, tools: readonly string[]): Promise<void> {
  const found = await waitFor(hub, since, (e) => {
    if (e.kind.startsWith('tool.') || e.kind.startsWith('ask.') || e.kind === 'user.ask') return false;
    const text = JSON.stringify(e.data ?? {});
    return text.includes(server) && tools.every((t) => text.includes(t));
  }, 60_000);
  if (!found) throw Error(`BLOCKED: 60 s after the session start, the record holds no tool list of ${server} naming ${tools.join(', ')}`);
}
/** The ask raised after `since` whose question names every one of `names`; BLOCKED when none is within 60 s. */
export async function askNaming(hub: Hub, since: number, names: readonly string[]): Promise<Ev> {
  const ask = await waitFor(hub, since, (e) => e.kind === 'ask.created' && names.every((n) => String(e.data?.question ?? '').includes(n)), 60_000);
  if (!ask) throw Error(`BLOCKED: 60 s after the session start, no ask names ${names.join(' and ')}`);
  return ask;
}
/** Your yes: the ask's option that approves (decision allow), through `deep inbox answer` with the OS confirming you. */
export async function approve(w: World, ask: Ev): Promise<void> {
  const yes = ((ask.data.options ?? []) as Line[]).find((o) => o.decision === 'allow');
  if (!yes) throw Error(`BLOCKED: ask:${ask.id} has no option that approves: ${JSON.stringify(ask.data.options)}`);
  const r = await run(NODE, [CLI, 'inbox', 'answer', `ask:${ask.id}`, String(yes.id)], { env: childEnv(w.home), cwd: w.tmp, timeoutMs: 120_000 });
  if (r.code !== 0) throw Error(`BLOCKED: your yes to ask:${ask.id} through deep inbox answer must count, exit 0: ${shown(r)}`);
}
