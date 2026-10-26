// Shared test-side tools for the issue #666 acceptance tests: the temporary home whose Claude Code user settings run
// deep-hook for every hook event, the checkout-web fixture repo, the hub as a process and its line protocol, the
// spool as files, the record's projections, the agent test harness as a process, and the checks each criterion runs
// on what a session left. Parts are adapted from tests/acceptance/315/helpers.ts and tests/acceptance/16 (same repo,
// same license); this suite keeps its own copy so a redraft of those suites never moves these tests. Nothing here
// stands in for deep-hook, the hub or the record: every test reaches them through the binary, `deep hub run`, the
// socket, the files under the root and @deepbuild/record's public entry.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRecord, PROJECTIONS, type Table } from '../../../packages/record/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
export const HARNESS = join(REPO, 'scripts/agent-harness.mjs');
export const PROOF_DIR = join(tmpdir(), 'deep-666-proof');
/** The prompt the issue gives the session. */
export const PROMPT = 'Read the README and add one line to it.';
/** The harness scenario this suite drives (README, The surface under test). */
export const SCENARIO = 'add-readme-line';

/** Each criterion's ID: #666.<first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed, "- [ ] " dropped>. */
export const AC1 = '#666.fa419b94';
export const AC2 = '#666.d0fc950d';
export const AC3 = '#666.7359ccd1';
export const AC4 = '#666.be202da6';
export const AC5 = '#666.95eb0939';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
export const jsonLines = (text: string): Line[] => text.split('\n').flatMap((raw) => { const l = parseObject(raw); return l ? [l] : []; });
export const wallMs = () => performance.timeOrigin + performance.now();
const json = (value: unknown) => JSON.stringify(value, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2);

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh666-'));
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
/** Stops every process this suite started (SIGCONT and SIGTERM, then SIGKILL after 5 s) and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) {
    try { process.kill(pid, 'SIGCONT'); } catch { /* gone */ }
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) {
    if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Variables that make an agent bill an API account; a child never inherits this process's. */
export const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** This process's environment with no DEEP_ settings, no billing keys and no NODE_OPTIONS; `extra` set on top (undefined removes). */
export function cleanEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
/** The environment the hub and the fast tests' hooks get: HOME moved to the test's temporary home. */
export const homeEnv = (home: string, extra: Record<string, string | undefined> = {}) =>
  cleanEnv({ HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra });

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
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
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}

// ---- deep-hook, built once per test process: target/debug for the fast tests, target/release for the live sessions.
const builds = new Map<string, Promise<string>>();
export function buildDeepHook(o: { release?: boolean } = {}): Promise<string> {
  const key = o.release ? 'release' : 'debug';
  let made = builds.get(key);
  if (!made) {
    const args = ['build', '--locked', '-q', '-p', 'deep-hook', ...(o.release ? ['--release'] : [])];
    const binary = join(REPO, 'target', key, 'deep-hook');
    made = run('cargo', args, { timeoutMs: 900_000 }).then((r) => {
      if (r.code !== 0) throw Error(`BLOCKED: cargo ${args.join(' ')} failed: ${r.stderr.slice(-3000)}`);
      if (!existsSync(binary)) throw Error(`BLOCKED: no binary at ${binary} after cargo ${args.join(' ')}`);
      // The first exec of a new binary is slow on macOS (it is checked before it runs); no hook pays for it.
      spawnSync(binary, ['--version'], { stdio: 'ignore', timeout: 30_000 });
      return binary;
    });
    builds.set(key, made);
  }
  return made;
}

// ---- Claude Code's adapter facts: which hook events there are, the event kind each maps to, and each tool's kind.
const facts = JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as Line;
const versions = facts.events.versions as Record<string, Record<string, unknown>>;
/** Every hook event the newest covered Claude Code version has: the test's settings run deep-hook for each. */
export const HOOK_EVENTS: string[] = Object.keys(versions[Object.keys(versions).at(-1)!]!);
/** The event kind a hook event maps to, from the facts' mapping. */
export const kindOf = (event: string): string | undefined => (facts.mapping[event] as Line | undefined)?.kind as string | undefined;
/** A tool's kind (shell, read, edit, …), from the facts' toolKinds. */
export function toolKind(tool: string): string {
  const kinds = facts.toolKinds as Line;
  if (kinds.tools[tool]) return kinds.tools[tool] as string;
  for (const [prefix, kind] of Object.entries(kinds.prefixes as Record<string, string>)) if (tool.startsWith(prefix)) return kind;
  return kinds.otherwise as string;
}

// ---- The temporary home: <home>/.deepbuild is DeepBuild's (the hub's root, deep-hook's spool and address setting),
// and <home>/.claude/settings.json is the Claude Code user settings file whose hooks run deep-hook for every event.
export interface Setup { dir: string; home: string; root: string; settings: string; log: string; tripwire: string; deepHook: string }
export function installHooks(deepHook: string): Setup {
  const dir = tempDir();
  const home = join(dir, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true });
  const log = join(dir, 'hooks.jsonl');
  const config = join(dir, 'timed-hook.json');
  writeFileSync(config, JSON.stringify({ deepHook, agent: 'claude-code', home, log }));
  const command = (event: string) => [NODE, join(FIXTURES, 'timed-hook.mjs'), config, event].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
  const settings = join(home, '.claude/settings.json');
  mkdirSync(dirname(settings), { recursive: true });
  const hooks = Object.fromEntries(HOOK_EVENTS.map((event) => [event, [{ hooks: [{ type: 'command', command: command(event) }] }]]));
  writeFileSync(settings, `${JSON.stringify({ hooks }, null, 2)}\n`);
  return { dir, home, root, settings, log, tripwire: join(dir, 'repo-settings-ran'), deepHook };
}
/** The command the settings run for `event`. */
export const hookCommand = (s: Setup, event: string): string => (JSON.parse(readFileSync(s.settings, 'utf8')) as Line).hooks[event][0].hooks[0].command as string;

/**
 * A fresh git checkout of the checkout-web fixture in the setup's folder. Its own .claude/settings.json and
 * settings.local.json each hold a hook that writes the tripwire file, so a session that loads the repo's own
 * settings is seen (written here, at run time: the repo itself keeps no hooks in any settings file).
 */
export function checkout(s: Setup): string {
  const work = join(s.dir, 'checkout-web');
  cpSync(join(FIXTURES, 'checkout-web'), work, { recursive: true });
  const trip = { hooks: Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop'].map((event) => [event, [{ hooks: [{ type: 'command', command: `echo ${event} >> '${s.tripwire}'` }] }]])) };
  mkdirSync(join(work, '.claude'));
  writeFileSync(join(work, '.claude/settings.json'), JSON.stringify(trip));
  writeFileSync(join(work, '.claude/settings.local.json'), JSON.stringify(trip));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: work, env: cleanEnv({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }), stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'checkout-web');
  return work;
}

// ---- What each hook did, from the log the timed hook command writes (fixtures/timed-hook.mjs).
export interface HookRun { event: string; pid: number | null; spawnedAtMs: number; exitedAtMs: number; ms: number; exit: number | null; signal: string | null; stdout: string; stderr: string; input: Line }
export const readHooks = (s: Setup): HookRun[] => (existsSync(s.log) ? (jsonLines(readFileSync(s.log, 'utf8')) as HookRun[]) : []);
/** How a hook is named in a failure: the PostToolUse of a call names the call. */
export function label(h: { event: string; input: Line }): string {
  const tool = h.input?.tool_name as string | undefined;
  return tool ? `the ${h.event} of call ${tool} (${h.input.tool_use_id})` : `the ${h.event} hook`;
}

/** Runs recorded or made-up hook inputs, one after another, through the settings' commands, as Claude Code runs a hook. */
export async function runHooks(s: Setup, inputs: readonly { event: string; input: Line }[], cwd: string, env: NodeJS.ProcessEnv = homeEnv(s.home)): Promise<void> {
  for (const { event, input } of inputs) {
    const r = await run('/bin/sh', ['-c', hookCommand(s, event)], { cwd, env, input: JSON.stringify(input), timeoutMs: 60_000 });
    if (r.timedOut) throw Error(`the ${event} hook didn't end within 60 s`);
  }
}

/** A made-up session in `work`: the transcript of a Read and an Edit of the README, and the hook inputs it fires. */
export function syntheticSession(s: Setup, work: string): { sessionId: string; transcript: string; inputs: { event: string; input: Line }[] } {
  const sessionId = randomUUID();
  const transcript = join(s.dir, 'agent', '.claude/projects', work.replace(/[^A-Za-z0-9]/g, '-'), `${sessionId}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  const readme = join(work, 'README.md');
  const read = { id: `toolu_read_${randomUUID().slice(0, 8)}`, name: 'Read', input: { file_path: readme } };
  const edit = { id: `toolu_edit_${randomUUID().slice(0, 8)}`, name: 'Edit', input: { file_path: readme, old_string: '## Run it', new_string: 'Payments go through the pay button only.\n\n## Run it' } };
  const promptId = randomUUID();
  const entry = (type: string, content: unknown) => ({ type, isSidechain: false, sessionId, cwd: work, uuid: randomUUID(), ...(type === 'user' ? { promptId } : {}), message: { role: type, content } });
  writeFileSync(transcript, [
    entry('user', PROMPT),
    entry('assistant', [{ type: 'tool_use', ...read }]),
    entry('user', [{ type: 'tool_result', tool_use_id: read.id, content: 'the README' }]),
    entry('assistant', [{ type: 'tool_use', ...edit }]),
    entry('user', [{ type: 'tool_result', tool_use_id: edit.id, content: 'edited' }]),
    entry('assistant', [{ type: 'text', text: 'Added one line to the README.' }]),
  ].map((e) => `${JSON.stringify(e)}\n`).join(''));
  const base = { session_id: sessionId, transcript_path: transcript, cwd: work, permission_mode: 'acceptEdits' };
  const call = (event: string, c: typeof read, extra: Line = {}) => ({ event, input: { ...base, hook_event_name: event, tool_name: c.name, tool_input: c.input, tool_use_id: c.id, ...extra } });
  return {
    sessionId, transcript,
    inputs: [
      { event: 'SessionStart', input: { ...base, hook_event_name: 'SessionStart', source: 'startup', model: 'claude-haiku-5-5' } },
      { event: 'UserPromptSubmit', input: { ...base, hook_event_name: 'UserPromptSubmit', prompt: PROMPT, prompt_id: promptId } },
      call('PreToolUse', read), call('PostToolUse', read, { tool_response: { type: 'text' } }),
      call('PreToolUse', edit), call('PostToolUse', edit, { tool_response: { filePath: readme } }),
      { event: 'Stop', input: { ...base, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Added one line to the README.', prompt_id: promptId } },
    ],
  };
}

/** The tool calls a transcript shows (the session's own, not a subagent's), each once, with whether its result was an error. */
export interface Call { id: string; name: string; failed: boolean }
export function toolCalls(transcript: string): Call[] {
  if (!existsSync(transcript)) return [];
  const entries = jsonLines(readFileSync(transcript, 'utf8')).filter((e) => e.isSidechain !== true);
  const calls = new Map<string, Call>();
  for (const e of entries) {
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Line[]) {
      if (e.type === 'assistant' && block.type === 'tool_use' && typeof block.id === 'string' && !calls.has(block.id)) calls.set(block.id, { id: block.id, name: String(block.name), failed: false });
      if (e.type === 'user' && block.type === 'tool_result' && block.is_error === true && calls.has(block.tool_use_id)) calls.get(block.tool_use_id)!.failed = true;
    }
  }
  return [...calls.values()];
}

// ---- The hub as a process: `deep hub run` with HOME the temporary home (#16).
export interface Ready { v: number; ready: true; pid: number; socket: string; start: string }
export interface HubProc { child: ChildProcess; pid: number; stdout(): string; stderr(): string; ready: Promise<Ready | undefined>; exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }> }
export interface Hub extends Ready { home: string; root: string; proc: HubProc }
export async function startHub(o: { home: string; plant?: string | undefined }, timeoutMs = 60_000): Promise<Hub> {
  const env = homeEnv(o.home, { DEEP_HUB_PLANT: o.plant });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const ready = new Promise<Ready | undefined>((resolve) => {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      const first = out.split('\n')[0];
      if (out.includes('\n') && first !== undefined) {
        const line = parseObject(first);
        resolve(line && line.ready === true ? (line as Ready) : undefined);
      }
    });
    void exit.then(() => resolve(undefined));
  });
  const proc: HubProc = { child, pid: child.pid!, stdout: () => out, stderr: () => err, ready, exit };
  const r = await Promise.race([ready, sleep(timeoutMs).then(() => undefined)]);
  if (!r) throw Error(`BLOCKED: the hub didn't start (deep hub run${o.plant ? `, DEEP_HUB_PLANT=${o.plant}` : ''}): stderr: ${err.slice(0, 2000)}`);
  return { ...r, home: o.home, root: join(o.home, '.deepbuild'), proc };
}
export async function stopHub(hub: Hub, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  try { process.kill(hub.pid, signal); } catch { return; }
  const deadline = Date.now() + 15_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  await hub.proc.exit;
}
/** What the hub wrote to stdout and stderr: the hub's log. */
export const hubLog = (hub: Hub) => `${hub.proc.stdout()}\n${hub.proc.stderr()}`;

// ---- The line protocol (#16): a cli connection, events.read.
class Conn {
  private buffer = '';
  private readonly lines: Line[] = [];
  private wakers = new Set<() => void>();
  private ids = 0;
  ended = false;
  constructor(readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        this.lines.push(parseObject(this.buffer.slice(0, i)) ?? { unparsed: this.buffer.slice(0, i) });
        this.buffer = this.buffer.slice(i + 1);
      }
      for (const w of [...this.wakers]) w();
    });
    const end = () => { this.ended = true; for (const w of [...this.wakers]) w(); };
    sock.on('error', end);
    sock.on('close', end);
  }
  wait(match: (line: Line) => boolean, from: number, timeoutMs: number): Promise<Line | undefined> {
    return new Promise((resolve) => {
      const done = (v: Line | undefined) => { clearTimeout(timer); this.wakers.delete(check); resolve(v); };
      const check = () => { const found = this.lines.slice(from).find(match); if (found) done(found); else if (this.ended) done(undefined); };
      const timer = setTimeout(() => done(undefined), timeoutMs);
      this.wakers.add(check);
      check();
    });
  }
  count(): number { return this.lines.length; }
  async call(method: string, params: unknown, timeoutMs = 30_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await this.wait((l) => l.id === id && ('result' in l || 'error' in l), from, timeoutMs);
    if (!reply) throw Error(`no reply to ${method} within ${timeoutMs} ms`);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
}
async function control(hub: Hub): Promise<Conn> {
  const conn = new Conn(net.connect(hub.socket));
  if (!(await conn.wait(() => true, 0, 5000))) throw Error(`no hello from the hub at ${hub.socket}`);
  const from = conn.count();
  conn.sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() })}\n`);
  const reply = await conn.wait((l) => 'role' in l || 'error' in l, from, 10_000);
  if (reply?.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(reply)}`);
  return conn;
}
export interface Ev { id: string; kind: string; log_pos: number; writer: string; ts: number; seq?: string; subject?: string; session?: string; data: Line; evidence: string[] }
/** Every event in the log, paged by log_pos through events.read, in the order it serves them. */
export async function allEvents(hub: Hub): Promise<Ev[]> {
  const conn = await control(hub);
  try {
    const out: Ev[] = [];
    let after = 0;
    for (;;) {
      const events = (await conn.call('events.read', { after, limit: 1000 })).events as Ev[];
      if (!events.length) return out;
      out.push(...events);
      after = events[events.length - 1]!.log_pos;
    }
  } finally {
    conn.sock.destroy();
  }
}
/** Polls the log until `done` holds, or until it stops changing for `quietMs`; resolves with the last read. */
export async function settleEvents(hub: Hub, done: (events: Ev[]) => boolean, o: { timeoutMs?: number; quietMs?: number } = {}): Promise<Ev[]> {
  const deadline = Date.now() + (o.timeoutMs ?? 60_000);
  let last: Ev[] = [];
  let since = Date.now();
  for (;;) {
    const events = await allEvents(hub);
    if (done(events)) return events;
    if (events.length !== last.length) { last = events; since = Date.now(); }
    if (Date.now() - since > (o.quietMs ?? 8000) || Date.now() > deadline) return events;
    await sleep(250);
  }
}
/** Reads the log every 50 ms while the hub runs; `served()` is every event read so far, by ID, with its log_pos. */
export function pollEvents(hub: Hub): { served(): Map<string, number>; stop(): Promise<void> } {
  const served = new Map<string, number>();
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      try { for (const e of await allEvents(hub)) served.set(e.id, e.log_pos); } catch { /* the hub is gone */ }
      await sleep(50);
    }
  })();
  return { served: () => new Map(served), stop: async () => { stopped = true; await loop; } };
}
/** A hook request the hub acknowledged on a forwarded connection, and when the acknowledgement came through. */
export interface Acked { request: Line; atMs: number }
/**
 * A forwarded socket at the address setting (#16: every client reaches the hub through one), relaying each connection
 * to the hub's socket unchanged and keeping each hook request with the hub's acknowledgement of it. With the hub gone a
 * connection is closed at once, as the hub's own socket would refuse it.
 */
export function forwarder(dir: string, target: string): Promise<{ path: string; acked(): Acked[]; close(): Promise<void> }> {
  const path = join(dir, 'fwd.sock');
  const acked: Acked[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstream = net.connect(target);
    sockets.add(client); sockets.add(upstream);
    let up = '';
    let down = '';
    let request: Line | undefined;
    client.on('data', (d: Buffer) => { up += d.toString('utf8'); if (!request && up.includes('\n')) request = parseObject(up.slice(0, up.indexOf('\n'))); });
    upstream.on('data', (d: Buffer) => {
      down += d.toString('utf8');
      const ack = jsonLines(down).find((l) => typeof l.ack === 'string');
      if (ack && request && ack.ack === request.id && !acked.some((a) => a.request.id === request!.id)) acked.push({ request, atMs: wallMs() });
    });
    client.pipe(upstream);
    upstream.pipe(client);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => resolve({ path, acked: () => [...acked], close: () => new Promise((done) => { for (const x of sockets) x.destroy(); server.close(() => done()); }) }));
  });
}
/** The address setting: `{"hub": {"address": "unix:<path>"}}` in <home>/.deepbuild/config.json (#16). */
export function setAddress(root: string, path: string): void {
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ hub: { address: `unix:${path}` } })}\n`);
}
export async function waitFor<T>(probe: () => T | undefined | false, timeoutMs: number, stopIf: () => boolean = () => false): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline || stopIf()) return undefined;
    await sleep(10);
  }
}
/** A setup shared by a file's tests, made by the first test that needs it. */
export function shared<T>(make: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | undefined;
  return () => (value ??= make());
}

// ---- The spool: <home>/.deepbuild/spool/*.jsonl, read as bytes (#315's README, The spool).
export interface Spooled { file: string; offset: number; json: Line }
export interface SpoolCopy { files: Record<string, string>; requests: Spooled[] }
/** Every file in the spool folder as it is now, and every request line in it (each ID once), in file then byte order. */
export function readSpool(root: string): SpoolCopy {
  const dir = join(root, 'spool');
  const out: SpoolCopy = { files: {}, requests: [] };
  if (!existsSync(dir)) return out;
  const seen = new Set<string>();
  for (const name of readdirSync(dir).sort()) {
    const text = readFileSync(join(dir, name), 'utf8');
    out.files[name] = text;
    let offset = 0;
    for (const raw of text.split('\n')) {
      const req = parseObject(raw);
      if (req && typeof req.id === 'string' && !seen.has(req.id)) { seen.add(req.id); out.requests.push({ file: name, offset, json: req }); }
      offset += Buffer.byteLength(raw) + 1;
    }
  }
  return out;
}
/** Writes a spool copy into a root as deep-hook leaves it: a folder of mode 0700, files of mode 0600. */
export function writeSpool(root: string, copy: SpoolCopy): void {
  const dir = join(root, 'spool');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  for (const [name, text] of Object.entries(copy.files)) writeFileSync(join(dir, name), text, { mode: 0o600 });
}
export const spoolLabel = (r: Spooled) => label({ event: String(r.json.event), input: r.json.payload ?? {} });

// ---- Which record event is which hook's: the same kind, the session, the tool's kind and path, and a seq inside the
// hook's run (deep-hook stamps seq from the wall clock as it starts, so it falls between the spawn and the exit).
const SLACK_NS = 5_000_000n;
const ns = (ms: number) => BigInt(Math.round(ms * 1000)) * 1000n;
function fits(h: HookRun, e: Ev): boolean {
  if (e.kind !== kindOf(h.event) || e.seq === undefined) return false;
  const seq = BigInt(e.seq);
  if (seq < ns(h.spawnedAtMs) - SLACK_NS || seq > ns(Number.isFinite(h.exitedAtMs) ? h.exitedAtMs : h.spawnedAtMs + 60_000) + SLACK_NS) return false;
  const tool = h.input.tool_name as string | undefined;
  if (tool && (e.kind === 'tool.before' || e.kind === 'tool.after')) {
    if (e.data?.kind !== toolKind(tool)) return false;
    const path = h.input.tool_input?.file_path as string | undefined;
    if (path && Array.isArray(e.data?.paths) && e.data.paths.length && !(e.data.paths as string[]).includes(path)) return false;
  }
  return true;
}
/** Each hook's events in the record: every event that fits it (two or more means it is there twice). */
export function eventsOf(hooks: readonly HookRun[], events: readonly Ev[]): Map<HookRun, Ev[]> {
  const out = new Map<HookRun, Ev[]>();
  for (const h of hooks) out.set(h, []);
  // Where windows overlap (hooks run at once), an event goes to the hook whose start its seq is nearest.
  const gap = (h: HookRun, seq: bigint) => { const d = seq - ns(h.spawnedAtMs); return d < 0n ? -d : d; };
  for (const e of events) {
    const fitting = hooks.filter((h) => fits(h, e));
    if (!fitting.length) continue;
    const seq = BigInt(e.seq!);
    out.get(fitting.reduce((a, b) => (gap(a, seq) <= gap(b, seq) ? a : b)))!.push(e);
  }
  return out;
}
/** The spool line a hook wrote: the same event, session and call, its seq inside the hook's run. */
export function spoolLineOf(h: HookRun, spooled: readonly Spooled[]): Spooled | undefined {
  return spooled.find((r) => r.json.event === h.event && r.json.payload?.session_id === h.input.session_id
    && r.json.payload?.tool_use_id === h.input.tool_use_id && typeof r.json.seq === 'string'
    && BigInt(r.json.seq) >= ns(h.spawnedAtMs) - SLACK_NS && BigInt(r.json.seq) <= ns(h.exitedAtMs) + SLACK_NS);
}
/** The record's events for a spooled request: its ID, or the same session, kind and seq under another ID. */
export const eventsOfSpooled = (r: Spooled, events: readonly Ev[]): Ev[] =>
  events.filter((e) => e.id === r.json.id || (e.seq === r.json.seq && e.kind === kindOf(String(r.json.event)) && e.session === r.json.payload?.session_id));

// ---- The checks. Each returns its problems, every one starting with its criterion's ID; none means it holds.

/** AC1: every hook the session fired is in the record once, under its session, in stamp order, as the transcript has it. */
export function recordProblems(o: { hooks: readonly HookRun[]; events: readonly Ev[]; transcript: string; sessionId: string }): string[] {
  const p: string[] = [];
  const say = (text: string) => p.push(`${AC1}: ${text}`);
  if (!o.sessionId) say('the run names no session ID');
  if (!o.hooks.length) say('no hook ran through deep-hook');
  const found = eventsOf(o.hooks, o.events);
  for (const h of o.hooks) {
    if (h.input.session_id !== o.sessionId) say(`${label(h)} carries session ${h.input.session_id}, not the session's ${o.sessionId}`);
    const evs = found.get(h)!;
    if (!evs.length) say(`${label(h)} (stamped while its hook ran, ${new Date(h.spawnedAtMs).toISOString()}) is not in the record`);
    if (evs.length > 1) say(`${label(h)} is in the record ${evs.length} times: ${evs.map((e) => `${e.id} at log_pos ${e.log_pos}`).join(', ')}`);
    for (const e of evs) if (e.session !== o.sessionId) say(`${label(h)} is recorded as ${e.id} under session ${e.session}, not ${o.sessionId}`);
  }
  // In the order deep-hook stamped them: log_pos rises with seq.
  const pairs = o.hooks.flatMap((h) => (found.get(h)!.length === 1 ? [{ h, e: found.get(h)![0]! }] : [])).sort((a, b) => (BigInt(a.e.seq!) < BigInt(b.e.seq!) ? -1 : 1));
  for (let i = 1; i < pairs.length; i++) {
    const [a, b] = [pairs[i - 1]!, pairs[i]!];
    if (b.e.log_pos <= a.e.log_pos) say(`${label(b.h)} (seq ${b.e.seq}) is at log_pos ${b.e.log_pos}, not after ${label(a.h)} (seq ${a.e.seq}) at log_pos ${a.e.log_pos}: the record's order is not the stamps'`);
  }
  const first = pairs.reduce<(typeof pairs)[number] | undefined>((a, b) => (!a || b.e.log_pos < a.e.log_pos ? b : a), undefined);
  if (!o.hooks.some((h) => h.event === 'SessionStart')) say('the session fired no SessionStart through deep-hook');
  else if (first && first.h.event !== 'SessionStart') say(`the session's first event in the record is ${label(first.h)} (log_pos ${first.e.log_pos}), not its SessionStart`);
  const calls = toolCalls(o.transcript);
  if (!calls.length) say(`INCONCLUSIVE: the transcript ${o.transcript} shows no tool call, so its PreToolUse and PostToolUse went untested`);
  for (const c of calls) {
    const pre = o.hooks.find((h) => h.event === 'PreToolUse' && h.input.tool_use_id === c.id);
    const post = o.hooks.find((h) => (h.event === 'PostToolUse' || (c.failed && h.event === 'PostToolUseFailure')) && h.input.tool_use_id === c.id);
    if (!pre) say(`the transcript shows call ${c.name} (${c.id}), but no PreToolUse of it ran through deep-hook`);
    if (!post) say(`the transcript shows call ${c.name} (${c.id}), but no PostToolUse of it ran through deep-hook`);
  }
  const stops = o.hooks.filter((h) => h.event === 'Stop');
  if (!stops.length) say('the session fired no Stop through deep-hook');
  const last = pairs.filter((x) => x.h.event === 'PreToolUse' || x.h.event === 'PostToolUse' || x.h.event === 'PostToolUseFailure').at(-1);
  const stop = pairs.filter((x) => x.h.event === 'Stop').at(-1);
  if (last && stop && stop.e.log_pos < last.e.log_pos) say(`the session's last Stop (log_pos ${stop.e.log_pos}) comes before ${label(last.h)} (log_pos ${last.e.log_pos})`);
  return p;
}

/** AC2's first half: every hook returned within 50 ms of its start, timed from deep-hook's spawn to its exit. */
export function hookTimeProblems(hooks: readonly HookRun[], limitMs = 50): string[] {
  const p = hooks.filter((h) => !(h.ms < limitMs) || h.signal !== null)
    .map((h) => `${AC2}: ${label(h)} returned ${Number.isFinite(h.ms) ? h.ms.toFixed(1) : '(never)'} ms after its start${h.signal ? `, killed by ${h.signal}` : ''}, not within ${limitMs} ms`);
  if (!hooks.length) p.push(`${AC2}: no hook ran through deep-hook`);
  return p;
}

/** AC2's second half: every spooled event is in the record once, in stamp order (a replay that appends one twice names its ID). */
export function replayProblems(spooled: readonly Spooled[], events: readonly Ev[], criterion = AC2): string[] {
  const p: string[] = [];
  if (!spooled.length) p.push(`${criterion}: INCONCLUSIVE: the spool held no request before the hub started`);
  for (const r of spooled) {
    if (!kindOf(String(r.json.event))) p.push(`${criterion}: spooled event ${r.json.id} (${spoolLabel(r)}) maps to no event kind, so it can't be in the record`);
    const hits = eventsOfSpooled(r, events);
    if (!hits.length) p.push(`${criterion}: spooled event ${r.json.id} (${spoolLabel(r)}) is not in the record`);
    if (hits.length > 1) p.push(`${criterion}: spooled event ${r.json.id} (${spoolLabel(r)}) is in the record ${hits.length} times: ${hits.map((e) => `${e.id} at log_pos ${e.log_pos}`).join(', ')}`);
  }
  const once = spooled.flatMap((r) => { const hits = eventsOfSpooled(r, events); return hits.length === 1 ? [{ r, e: hits[0]! }] : []; })
    .sort((a, b) => (BigInt(a.r.json.seq) < BigInt(b.r.json.seq) ? -1 : BigInt(a.r.json.seq) > BigInt(b.r.json.seq) ? 1 : 0));
  for (let i = 1; i < once.length; i++) {
    const [a, b] = [once[i - 1]!, once[i]!];
    if (b.e.log_pos <= a.e.log_pos) p.push(`${criterion}: spooled event ${b.r.json.id} (seq ${b.r.json.seq}) is at log_pos ${b.e.log_pos}, not after ${a.r.json.id} (seq ${a.r.json.seq}) at log_pos ${a.e.log_pos}: not in stamp order`);
  }
  return p;
}

/** AC3: across a SIGKILL between two tool calls and a restart. */
export function killProblems(o: { hooks: readonly HookRun[]; killAtMs: number; restartAtMs: number; acked: readonly Acked[]; spooled: readonly Spooled[]; served: Map<string, number>; events: readonly Ev[]; transcript: string }): string[] {
  const p: string[] = [];
  const say = (text: string) => p.push(`${AC3}: ${text}`);
  const calls = toolCalls(o.transcript);
  if (calls.length < 2) say(`INCONCLUSIVE: the transcript shows ${calls.length} tool call(s), so no kill fell between two`);
  const before = o.hooks.filter((h) => h.exitedAtMs < o.killAtMs);
  if (!before.some((h) => h.event === 'PostToolUse' || h.event === 'PostToolUseFailure') || !o.hooks.some((h) => h.event === 'PreToolUse' && h.spawnedAtMs > o.killAtMs)) {
    say('INCONCLUSIVE: the kill did not fall between two tool calls (a call ended before it and another began after it)');
  }
  // Every event the hub acknowledged before the kill, as the forwarded socket saw its acknowledgement.
  const acked = o.acked.filter((a) => a.atMs < o.killAtMs);
  if (!acked.length) say('INCONCLUSIVE: the hub acknowledged no hook before the kill');
  for (const a of acked) {
    const r: Spooled = { file: '(socket)', offset: 0, json: a.request };
    const hits = eventsOfSpooled(r, o.events);
    if (hits.length !== 1) say(`${spoolLabel(r)}, event ${a.request.id}, acknowledged before the kill, is in the record ${hits.length} times${hits.length ? `: ${hits.map((e) => `${e.id} at log_pos ${e.log_pos}`).join(', ')}` : ''}`);
  }
  // Log positions only increase: served in rising order, none moved, and every event appended after the restart above all served before.
  for (let i = 1; i < o.events.length; i++) if (o.events[i]!.log_pos <= o.events[i - 1]!.log_pos) say(`log_pos ${o.events[i]!.log_pos} (${o.events[i]!.id}) follows log_pos ${o.events[i - 1]!.log_pos}`);
  const now = new Map(o.events.map((e) => [e.id, e.log_pos]));
  for (const [id, pos] of o.served) if (now.get(id) !== pos) say(`event ${id} was at log_pos ${pos} before the kill and is ${now.has(id) ? `at ${now.get(id)}` : 'gone'} after the restart`);
  const top = Math.max(0, ...o.served.values());
  for (const e of o.events) if (!o.served.has(e.id) && e.log_pos <= top && o.spooled.some((r) => r.json.id === e.id)) say(`${e.id}, replayed from the spool after the restart, took log_pos ${e.log_pos}, not above the ${top} served before the kill`);
  // The hooks fired while the hub was down arrive from the spool.
  const down = o.hooks.filter((h) => h.spawnedAtMs > o.killAtMs && h.exitedAtMs < o.restartAtMs);
  if (!down.length) say('INCONCLUSIVE: no hook fired while the hub was down');
  for (const h of down) {
    const line = spoolLineOf(h, o.spooled);
    if (!line) { say(`${label(h)}, fired while the hub was down, is not in the spool`); continue; }
    const hits = eventsOfSpooled(line, o.events);
    if (hits.length !== 1 || hits[0]!.id !== line.json.id) say(`${label(h)}, fired while the hub was down, spooled as ${line.json.id}, is in the record ${hits.length} times${hits.length ? ` as ${hits.map((e) => e.id).join(', ')}` : ''}`);
  }
  return p;
}

/** The forms #15 names for a value it scrubs: raw, URL-encoded with hex of either case, base64 at each offset in both alphabets. */
export function forms(value: string): { name: string; core: string }[] {
  const bytes = Buffer.from(value, 'utf8');
  const pct = (upper: boolean) => [...bytes].map((b) => (/[A-Za-z0-9\-_.~]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).padStart(2, '0')[upper ? 'toUpperCase' : 'toLowerCase']()}`)).join('');
  const out = [{ name: 'raw', core: value }, { name: 'URL-encoded, upper-case hex', core: pct(true) }, { name: 'URL-encoded, lower-case hex', core: pct(false) }];
  for (const k of [0, 1, 2]) {
    const std = Buffer.concat([Buffer.from('r:'.slice(2 - k)), bytes]).toString('base64');
    const core = std.slice(Math.ceil((8 * k) / 6), Math.floor((8 * (k + bytes.length)) / 6));
    out.push({ name: `base64 standard at offset ${k}`, core }, { name: `base64 url-safe at offset ${k}`, core: core.replace(/\+/g, '-').replace(/\//g, '_') });
  }
  return out;
}
export function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : []));
}

/** AC5: a copy of the ledger opened with @deepbuild/record; every projection read, rebuilt from the log, read again and compared. */
export async function projectionProblems(root: string, into: string, mutate?: (ledger: string) => void): Promise<{ problems: string[]; rows: number }> {
  mkdirSync(into, { recursive: true });
  for (const name of ['ledger.db', 'ledger.db-wal']) if (existsSync(join(root, name))) copyFileSync(join(root, name), join(into, name));
  if (!existsSync(join(into, 'ledger.db'))) return { problems: [`${AC5}: no ledger.db under ${root}`], rows: 0 };
  mutate?.(join(into, 'ledger.db'));
  const record = await openRecord({ path: join(into, 'ledger.db'), now: Date.now });
  try {
    const live = new Map<string, Table>();
    for (const name of PROJECTIONS) live.set(name, await record.table(name));
    await record.rebuild();
    const rebuilt = new Map<string, Table>();
    for (const name of PROJECTIONS) rebuilt.set(name, await record.table(name));
    const rows = [...live.values()].reduce((n, t) => n + t.rows.length, 0);
    const first = firstDifference(live, rebuilt);
    const problems = first ? [`${AC5}: ${first}`] : [];
    if (!rows) problems.push(`${AC5}: INCONCLUSIVE: no projection holds a row, so the rebuild was compared with nothing`);
    return { problems, rows };
  } finally {
    await record.close();
  }
}
const canon = (value: unknown): string => (typeof value === 'bigint' ? `${value}n` : value === undefined ? 'undefined' : value instanceof Uint8Array ? `bytes:${Buffer.from(value).toString('hex')}` : JSON.stringify(value));
function firstDifference(live: Map<string, Table>, rebuilt: Map<string, Table>): string | undefined {
  for (const [name, a] of live) {
    const b = rebuilt.get(name);
    if (!b) return `${name}: missing after the rebuild`;
    const key = (t: Table, row: Table['rows'][number]) => t.primaryKey.map((k) => canon(row[k])).join('|');
    for (let i = 0; i < Math.max(a.rows.length, b.rows.length); i++) {
      const [x, y] = [a.rows[i], b.rows[i]];
      if (!x || !y) return `${name}: row ${x ? key(a, x) : key(b, y!)} ${x ? 'missing after the rebuild' : 'only after the rebuild'}`;
      const column = [...new Set([...Object.keys(x), ...Object.keys(y)])].find((c) => canon(x[c]) !== canon(y[c]));
      if (column !== undefined) return `${name}: row ${key(a, x)} column ${column}: live ${canon(x[column])}, rebuilt ${canon(y[column])}`;
    }
  }
  return undefined;
}

/** A session that loaded the repo's own settings ran the checkout's tripwire hook: its evidence is INVALID. */
export const scopeProblems = (s: Setup, criterion: string): string[] =>
  (existsSync(s.tripwire) ? [`${criterion}: INVALID: the session ran the checkout's own .claude settings hooks (${readFileSync(s.tripwire, 'utf8').trim().split('\n').join(', ')}), so its hooks aren't only the temporary home's`] : []);

// ---- The proof: written under PROOF_DIR, one folder per session or planted run, never read back.
export function proof(folder: string, name: string, content: unknown): void {
  const dir = join(PROOF_DIR, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), typeof content === 'string' ? content : `${json(content)}\n`);
}
/** The record as the proof keeps it: each event with its stamp and log position. */
export const recordProof = (events: readonly Ev[]) => events.map((e) => ({ log_pos: e.log_pos, seq: e.seq ?? null, id: e.id, kind: e.kind, writer: e.writer, session: e.session ?? null, data: e.data }));
export const hookProof = (hooks: readonly HookRun[]) => hooks.map((h) => ({ event: h.event, call: h.input.tool_use_id ?? null, tool: h.input.tool_name ?? null, spawnedAt: new Date(h.spawnedAtMs).toISOString(), returnMs: Number(h.ms.toFixed(3)), exit: h.exit, signal: h.signal, stderr: h.stderr }));
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

// ---- The reference-Mac reading (#16's and #315's), written into the proof beside the hook times.
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
export function machine(): string {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  try {
    const model = read('sysctl', '-n', 'hw.model');
    const chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    const gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    const power = read('pmset', '-g', 'batt').split('\n')[0];
    const load = read('sysctl', '-n', 'vm.loadavg');
    return `${model} / ${chip} / ${gib} GiB; ${power}; load ${load}`;
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
}

// ---- The agent test harness (#48), as a process: `node scripts/agent-harness.mjs run --scenario add-readme-line …`.
export interface HarnessRun { code: number | null; stdout: string; stderr: string; run: Line | undefined }
/**
 * Starts one scripted session. HOME stays the real one (Claude Code's sign-in is in the macOS keychain); the session's
 * hooks come from the temporary home's settings file through --hooks; `env` adds variables for the harness to pass
 * on (the one session that sets ANTHROPIC_API_KEY). No other billing key or DEEP_ setting reaches it.
 */
export function startHarness(s: Setup, work: string, o: { passEnv?: string[]; env?: Record<string, string> } = {}): { pid: number; done: Promise<HarnessRun> } {
  const out = join(s.dir, 'harness');
  const args = [HARNESS, 'run', '--scenario', SCENARIO, '--workdir', work, '--hooks', s.settings, '--out', out, '--timeout-ms', '240000', ...(o.passEnv ?? []).flatMap((name) => ['--pass-env', name])];
  const child = spawn(NODE, args, { cwd: REPO, env: cleanEnv(o.env), stdio: ['ignore', 'pipe', 'pipe'] });
  own(child.pid);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  const done = new Promise<HarnessRun>((resolve) => child.on('close', (code) => resolve({ code, stdout, stderr, run: jsonLines(stdout).find((l) => typeof l.run === 'string' && l.run) })));
  return { pid: child.pid!, done };
}
/** A run that can't stand as evidence for a criterion: none printed, BLOCKED, or for a session other than the one asked. */
export function runProblem(r: HarnessRun, s: Setup, work: string): string | undefined {
  const tail = `exit ${r.code}; stdout ${r.stdout.slice(-1500)}; stderr ${r.stderr.slice(-1500)}`;
  if (!r.run) return `BLOCKED: the harness printed no run line for scenario ${SCENARIO}: ${tail}`;
  if (r.run.verdict === 'BLOCKED') return `BLOCKED: the harness run was BLOCKED: ${r.run.reason}`;
  if (r.run.scenario !== SCENARIO) return `INVALID: the run line is for scenario ${r.run.scenario}, not ${SCENARIO}`;
  if (r.run.workdir !== realpathSync(work)) return `INVALID: the session ran in ${r.run.workdir}, not the checkout ${work}`;
  if (typeof r.run.transcript !== 'string' || !existsSync(r.run.transcript)) return `INVALID: the run kept no transcript: ${JSON.stringify(r.run.transcript)}`;
  if (!readHooks(s).length) return `INVALID: no hook ran through the temporary home's settings (${s.settings})`;
  return undefined;
}
