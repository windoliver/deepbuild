// Test-side tools for #1666's acceptance tests (README): a world (a test home outside the temp folders, the hub as
// `deep hub run` on its installed root there, a git repo with an origin and a second worktree made before any start,
// the real agent behind a wrapper first on the login PATH, and a local stand-in for its model's API), the approval and
// the start as you run them in your terminal, and readings of what the session's one command really did. Nothing here
// stands in for the hub, deep-hook, git, the worktree or the agent's sandbox: the agent is the real binary at the
// version its facts list, and only its model is played.
//
// Safety: every folder is under /Users/Shared/dh1666-* (made here, removed at the end); HOME is that folder for every
// child, so no real ~/.claude, ~/.codex or ~/.deepbuild is read or written; processes are stopped by PID only: the
// hubs and their descendants, and the wrappers and agents those hubs started, read from the wrappers' own logs. No
// model, no sign-in, no key, no network beyond 127.0.0.1.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import net from 'node:net';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';

/** The folder holding the real `claude` and `codex` (README, Run them): read before the scrub below. */
const AGENT_BIN = process.env.DEEP_1666_AGENT_BIN;
// Nothing of the shell this runs in reaches the hub or an agent: no session markers, keys, model settings or git state.
for (const key of Object.keys(process.env)) if (/^(CLAUDE|DEEP_|CODEX|ANTHROPIC|OPENAI|GIT_)/.test(key)) delete process.env[key];

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const SECOND = 1000;
/** The issue the approval names and the session starts for. */
export const ISSUE = 1666;

/** The criteria's IDs: `#1666.` and the first 8 hex digits of SHA-256 of each criterion's text, white space collapsed (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #1666.a6894a2d',
  2: 'AC2 #1666.2a45598e',
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- The agents.
export type Agent = 'claude-code' | 'codex';
export const AGENTS: readonly Agent[] = ['claude-code', 'codex'];
const BINARY: Record<Agent, string> = { 'claude-code': 'claude', codex: 'codex' };
const facts = (agent: Agent): Line => JSON.parse(readFileSync(join(REPO, 'adapters', `${agent}.facts.json`), 'utf8')) as Line;
/** The versions whose sandbox the shipped facts name: what the criteria call "the version its facts list". */
export function sandboxVersions(agent: Agent): string[] {
  const versions = facts(agent).sandbox?.versions as unknown;
  return versions && typeof versions === 'object' && !Array.isArray(versions) ? Object.keys(versions) : [];
}
/** An agent as a test's name says it: its start name and the version its facts list a sandbox for. */
export const named = (agent: Agent): string => `${agent} ${sandboxVersions(agent).join(' or ') || '(no version)'}`;

/** The real binary and the version it reports. BLOCKED when it isn't there, or reports a version the facts list no sandbox for. */
export function realAgent(agent: Agent): { path: string; version: string } {
  const binary = BINARY[agent];
  if (!AGENT_BIN) throw Error(`BLOCKED: DEEP_1666_AGENT_BIN names no folder; set it to the folder holding ${binary} at ${named(agent)} (README, Run them)`);
  const path = join(AGENT_BIN, binary);
  if (!existsSync(path)) throw Error(`BLOCKED: there is no ${binary} in DEEP_1666_AGENT_BIN (${AGENT_BIN})`);
  // Both are node launchers: node must be on the PATH they run with.
  const r = spawnSync(path, ['--version'], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, PATH: [dirname(NODE), '/usr/bin', '/bin'].join(delimiter) } });
  const said = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  const version = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/.exec(r.stdout ?? '')?.[0];
  const listed = sandboxVersions(agent);
  if (!version || !listed.includes(version)) {
    throw Error(`BLOCKED: ${binary} in DEEP_1666_AGENT_BIN says ${JSON.stringify(said.slice(0, 200))} to --version, not a version whose sandbox the shipped facts list (${listed.join(', ') || 'none'})`);
  }
  return { path, version };
}

// ---- Folders: a test home outside /tmp and /var/folders, since both agents' sandboxes let commands write the temp
// folders, and a repo under them would read as writable whatever the start set.
const made: string[] = [];
function testHome(): string {
  if (!existsSync('/Users/Shared')) throw Error('BLOCKED: /Users/Shared is missing; the test home must be outside the temp folders the sandboxes let commands write');
  const dir = realpathSync(mkdtempSync('/Users/Shared/dh1666-'));
  made.push(dir);
  if (!process.env.HOME?.startsWith('/Users/Shared/dh1666-')) process.env.HOME = dir;
  return dir;
}

// ---- Processes: stopped by PID only.
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
const commandOf = (pid: number): string => {
  try { return execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim(); } catch { return ''; }
};
function descendants(root: number): number[] {
  const table = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).stdout.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number) as [number, number]);
  const out: number[] = [];
  const walk = (p: number): void => { for (const [pid, ppid] of table) if (ppid === p) { out.push(pid); walk(pid); } };
  walk(root);
  return out;
}
async function stopPids(pids: number[]): Promise<void> {
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while (pids.some(alive) && Date.now() < deadline) await sleep(100);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}

// ---- git: the first git on the PATH this suite runs with, the same one first on the test home's login PATH.
function gitBinary(): string {
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, 'git');
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  throw Error('BLOCKED: no git on the PATH this suite runs with');
}
export const GIT = gitBinary();
export function git(dir: string, ...args: string[]): string {
  return execFileSync(GIT, ['-C', dir, '-c', 'user.name=dh1666', '-c', 'user.email=dh1666@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
}
export const realOr = (p: string): string => { try { return realpathSync(p); } catch { return p; } };

// ---- The hub's line protocol, as the CLI role.
export class Client {
  private buffer = '';
  private readonly lines: Line[] = [];
  private ids = 0;
  private constructor(private readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        try { this.lines.push(JSON.parse(this.buffer.slice(0, i)) as Line); } catch { /* not a line */ }
        this.buffer = this.buffer.slice(i + 1);
      }
    });
    sock.on('error', () => undefined);
  }
  static async open(socket: string, root: string): Promise<Client> {
    const sock = net.connect(socket);
    await new Promise<void>((resolve, reject) => { sock.once('connect', resolve); sock.once('error', reject); });
    const c = new Client(sock);
    await waitFor(() => c.lines.length > 0, 5000, "the hub's hello");
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(root, 'control.token'), 'utf8').trim() })}\n`);
    await waitFor(() => c.lines.some((l) => l.role === 'cli'), 5000, 'the cli role');
    return c;
  }
  async call(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await waitFor(() => this.lines.find((l) => l.id === id), timeoutMs, `the reply to ${method}`);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
  async events(kind?: string): Promise<Line[]> {
    const out: Line[] = [];
    for (let after = 0; ;) {
      const page = await this.call('events.read', { after, limit: 1000 });
      const events = page.events as Line[];
      if (!events.length) break;
      out.push(...events);
      after = events[events.length - 1]!.log_pos as number;
    }
    return kind ? out.filter((e) => e.kind === kind) : out;
  }
  close(): void { this.sock.destroy(); }
}

export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(200);
  }
}

// ---- The model: a local stand-in for each agent's API on 127.0.0.1. A request with tools and no tool result yet
// asks for the one command; anything after says done. No model is called.
/** The command the session's turn runs: one plain command, which each agent's shipped setting lets run in its sandbox. */
export const COMMAND = 'node probe.mjs';
export interface StandIn { url: string; server: Server; requests: string[] }
async function modelStandIn(agent: Agent): Promise<StandIn> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d: Buffer) => (body += d.toString('utf8')));
    req.on('end', () => {
      let j: Line = {};
      try { j = JSON.parse(body || '{}') as Line; } catch { /* not JSON */ }
      const url = req.url ?? '';
      const tools = ((j.tools ?? []) as Line[]).map((t) => String(t.name ?? t.type));
      requests.push(`${req.method} ${url} tools=${tools.length}`);
      if (agent === 'claude-code') anthropic(url, body, j, tools, res);
      else openai(url, j, tools, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`, server, requests };
}
type Res = import('node:http').ServerResponse;
/** Anthropic's Messages API, streamed or not: one Bash tool call, then text. */
function anthropic(url: string, body: string, j: Line, tools: string[], res: Res): void {
  if (!url.startsWith('/v1/messages') || url.includes('count_tokens')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ input_tokens: 10 }));
    return;
  }
  const results = (body.match(/"type":"tool_result"/g) ?? []).length;
  const call = tools.includes('Bash') && results === 0;
  const input = { command: COMMAND, description: 'Commit in this worktree' };
  const content = call ? [{ type: 'tool_use', id: 'toolu_dh1666', name: 'Bash', input }] : [{ type: 'text', text: 'done' }];
  const stop = call ? 'tool_use' : 'end_turn';
  const message = { id: `msg_dh1666_${results}`, type: 'message', role: 'assistant', model: j.model ?? 'stand-in', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
  if (!j.stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(message));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (type: string, data: Line): void => { res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`); };
  ev('message_start', { message: { ...message, content: [], stop_reason: null } });
  if (call) {
    ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_dh1666', name: 'Bash', input: {} } });
    ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
  } else {
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'done' } });
  }
  ev('content_block_stop', { index: 0 });
  ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } });
  ev('message_stop', {});
  res.end();
}
/** OpenAI's Responses API, streamed: one call of the shell tool the request offers, then a message. */
function openai(url: string, j: Line, tools: string[], res: Res): void {
  if (!url.includes('/responses')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"data":[]}');
    return;
  }
  const results = ((j.input ?? []) as Line[]).filter((i) => i.type === 'function_call_output' || i.type === 'custom_tool_call_output').length;
  const tool = ['shell_command', 'shell', 'exec_command'].find((t) => tools.includes(t));
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (data: Line): void => { res.write(`event: ${String(data.type)}\ndata: ${JSON.stringify(data)}\n\n`); };
  ev({ type: 'response.created', response: { id: `resp_dh1666_${results}` } });
  const args = tool === 'shell' ? { command: ['bash', '-lc', COMMAND] } : tool === 'exec_command' ? { cmd: COMMAND } : { command: COMMAND };
  const item = results === 0 && tool
    ? { type: 'function_call', id: 'fc_dh1666', name: tool, arguments: JSON.stringify(args), call_id: 'call_dh1666' }
    : { type: 'message', id: `m_dh1666_${results}`, role: 'assistant', content: [{ type: 'output_text', text: 'done', annotations: [] }] };
  ev({ type: 'response.output_item.added', output_index: 0, item });
  ev({ type: 'response.output_item.done', output_index: 0, item });
  ev({ type: 'response.completed', response: { id: `resp_dh1666_${results}`, usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 15 } } });
  res.end();
}

// ---- The world.
const ASKS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
/** The commit the session's command makes, and the marker its other writes carry (fixtures/probe.mjs). */
export const SUBJECT = 'dh1666: a commit in the session worktree';
export const MARKER = 'written-by-the-session';

export interface Hub { pid: number; socket: string; child: ChildProcess; exit: Promise<unknown>; stderr(): string }
export interface Targets {
  /** A tracked file in the repo's checkout. */
  checkoutFile: string;
  /** The checkout's own .git/index and .git/HEAD. */
  index: string; head: string;
  /** The git folder of a worktree made before the start, `.git/worktrees/shop-other`. */
  otherGitDir: string;
}
export interface World extends Targets {
  agent: Agent; real: { path: string; version: string }; plant: string | undefined;
  home: string; root: string; bin: string; loginPath: string;
  repo: string; base: string; other: string;
  hub: Hub; client: Client; api: StandIn;
}
const worlds: World[] = [];

/**
 * A proxy that answers nothing, for every child: the hub, the CLI and so each agent and what they start. A client that
 * honours the proxy variables (git, Codex, Claude Code) fails at once on any host but 127.0.0.1, so nothing leaves it.
 */
const DEAD = 'http://127.0.0.1:9';
const LOCAL = '127.0.0.1,localhost,::1';
const NO_EGRESS = { HTTPS_PROXY: DEAD, https_proxy: DEAD, HTTP_PROXY: DEAD, http_proxy: DEAD, ALL_PROXY: DEAD, all_proxy: DEAD, NO_PROXY: LOCAL, no_proxy: LOCAL };
/** Every child's environment: the test home, the login PATH, no way off 127.0.0.1, and only the variables named. */
export function envFor(w: Pick<World, 'home' | 'loginPath'>, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...NO_EGRESS, HOME: w.home, PATH: `${w.loginPath}${delimiter}${process.env.PATH ?? ''}`, SHELL: '/bin/zsh', LC_ALL: 'C' };
  for (const [k, v] of Object.entries(extra)) { if (v === undefined) delete env[k]; else env[k] = v; }
  return env;
}

/** The wrapper (fixtures/agent.mjs) as the agent's binary name, first on the login PATH: Node's own path in its first line. */
function installWrapper(bin: string, agent: Agent, real: string, api: string, log: string): void {
  const binary = BINARY[agent];
  const program = readFileSync(join(FIXTURES, 'agent.mjs'), 'utf8').replace(/^#!.*\n/, `#!${NODE}\n`)
    .replace("'__AGENT__'", JSON.stringify(binary)).replace("'__REAL__'", JSON.stringify(real))
    .replace("'__API__'", JSON.stringify(api)).replace("'__LOG__'", JSON.stringify(log)).replace("'__PROMPT__'", JSON.stringify(PROMPT));
  writeFileSync(join(bin, binary), program, { mode: 0o755 });
}

/**
 * The agent's own hooks in the test home: deep-hook on SessionStart, so the session's first event reaches the hub and it
 * isn't ended as never started (#1330). Claude Code's in its user settings; Codex's in its hooks.json with hooks on,
 * each trusted as its /hooks approval writes (spikes/1330/trust.mjs), since Codex runs no untrusted hook. Codex's
 * plugins are off in the test home: on, `codex exec` and `codex app-server` each start a sync of OpenAI's curated
 * plugins from github.com.
 */
async function agentHooks(w: Pick<World, 'home' | 'loginPath' | 'agent' | 'real'>): Promise<void> {
  const entry = (adapter: string) => ({ SessionStart: [{ hooks: [{ type: 'command', command: `exec '${DEEP_HOOK}' ${adapter} SessionStart` }] }] });
  if (w.agent === 'claude-code') {
    mkdirSync(join(w.home, '.claude'), { recursive: true });
    writeFileSync(join(w.home, '.claude/settings.json'), `${JSON.stringify({ hooks: entry('claude-code') }, null, 2)}\n`);
    return;
  }
  const dir = join(w.home, '.codex');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'hooks.json'), `${JSON.stringify({ hooks: entry('codex') }, null, 2)}\n`);
  const features = '[features]\nhooks = true\nplugins = false\n';
  writeFileSync(join(dir, 'config.toml'), features);
  const hooks = await codexHooks(w);
  const untrusted = hooks.filter((h) => h.trustStatus !== 'trusted');
  writeFileSync(join(dir, 'config.toml'), `${features}${untrusted.map((h) => `\n[hooks.state.${JSON.stringify(String(h.key))}]\ntrusted_hash = ${JSON.stringify(String(h.currentHash))}\n`).join('')}`);
  const after = await codexHooks(w);
  if (!after.length || after.some((h) => h.trustStatus !== 'trusted')) throw Error(`the test home's Codex hooks aren't trusted: ${JSON.stringify(after)}`);
}
/** The hooks Codex's app-server lists for the test home, with their trust. */
async function codexHooks(w: Pick<World, 'home' | 'loginPath' | 'real'>): Promise<Line[]> {
  const child = spawn(w.real.path, ['app-server'], { cwd: w.home, env: envFor(w), stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  child.stdout!.setEncoding('utf8').on('data', (d: string) => (out += d));
  child.stdin!.on('error', () => undefined);
  const reply = (id: number): Line | undefined => {
    for (const l of out.split('\n')) { try { const j = JSON.parse(l) as Line; if (j.id === id) return j; } catch { /* not a line */ } }
    return undefined;
  };
  try {
    child.stdin!.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'dh1666', version: '0' }, capabilities: { experimentalApi: true } } })}\n`);
    await waitFor(() => reply(1), 60_000, `codex app-server's initialize reply (stderr ${err.slice(-300)})`);
    child.stdin!.write(`${JSON.stringify({ method: 'initialized' })}\n${JSON.stringify({ id: 2, method: 'hooks/list', params: { cwds: [w.home] } })}\n`);
    const list = await waitFor(() => reply(2), 60_000, `codex app-server's hooks/list reply (stderr ${err.slice(-300)})`);
    return ((list.result?.data ?? []) as Line[]).flatMap((d) => (d.hooks ?? []) as Line[]);
  } finally {
    const pids = child.pid ? [...descendants(child.pid), child.pid] : [];
    await stopPids(pids);
  }
}

async function runHub(w: Pick<World, 'home' | 'root' | 'loginPath'>, plant: string | undefined): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], {
    cwd: w.home, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    env: envFor(w, { DEEP_HUB_PLANT: plant, DEEP_HUB_TEST_CONFIRM: join(w.home, 'confirm'), DEEP_HUB_TEST_FORGE: 'http://127.0.0.1:9' }),
  });
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise((resolve) => child.on('exit', resolve));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) { try { resolve(JSON.parse(out.split('\n')[0]!) as Line); } catch { resolve(undefined); } }
      });
    }),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (ready?.ready !== true) {
    if (child.pid && alive(child.pid)) try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ }
    throw Error(`BLOCKED: the hub${plant ? ` with the plant DEEP_HUB_PLANT=${plant}` : ''} did not start (a hub that doesn't list a plant refuses to start): ${err.slice(-800)}`);
  }
  return { pid: child.pid!, socket: String(ready.socket), child, exit, stderr: () => err };
}

/**
 * A world for one agent: the home laid out with the wrapper and the agent's hooks, the repo committed and pushed to
 * its origin, a second worktree added, the model's stand-in up, the hub on it (with the plant, if one is named).
 */
export async function openWorld(agent: Agent, plant?: string): Promise<World> {
  if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI (npm run build --workspaces) is not built at ${CLI}`);
  if (!existsSync(DEEP_HOOK)) throw Error(`BLOCKED: deep-hook (cargo build --locked -p deep-hook) is not built at ${DEEP_HOOK}`);
  const real = realAgent(agent);
  const home = testHome();
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  copyFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), join(root, 'rules.json'));
  // The login shell's PATH: the wrapper's folder first, then git's, Node's and the system's.
  const bin = join(home, 'bin');
  const loginPath = [bin, dirname(GIT), dirname(NODE), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter);
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: ASKS, runner: { login_path: loginPath } }, null, 2)}\n`);
  writeFileSync(join(home, 'confirm'), 'confirmed\n');
  for (const f of ['.zprofile', '.zshenv', '.bash_profile', '.profile']) writeFileSync(join(home, f), `export PATH="${loginPath}"\n`);
  const api = await modelStandIn(agent);
  mkdirSync(bin, { recursive: true });
  installWrapper(bin, agent, real.path, api.url, join(home, '.dh1666'));
  const partial = { agent, real, home, root, bin, loginPath, plant, api };
  await agentHooks(partial);

  // The repo: a checkout with a tracked README, the command and its config, pushed to a bare origin; then a second
  // worktree, which exists before any start.
  const repo = join(home, 'src', 'shop');
  const other = join(home, 'src', 'shop-other');
  mkdirSync(repo, { recursive: true });
  const targets: Targets = { checkoutFile: join(repo, 'README.md'), index: join(repo, '.git/index'), head: join(repo, '.git/HEAD'), otherGitDir: join(repo, '.git/worktrees/shop-other') };
  const files: Record<string, string> = {
    'README.md': 'a sample shop\n',
    'probe.mjs': readFileSync(join(FIXTURES, 'probe.mjs'), 'utf8'),
    'probe-config.json': `${JSON.stringify({ file: 'committed-by-the-session.txt', subject: SUBJECT, marker: MARKER, ...targets }, null, 2)}\n`,
  };
  for (const [path, text] of Object.entries(files)) writeFileSync(join(repo, path), text);
  git(home, 'init', '-q', '--bare', '-b', 'main', join(home, 'origin.git'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'the sample');
  git(repo, 'remote', 'add', 'origin', join(home, 'origin.git'));
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  git(repo, 'worktree', 'add', '-q', '-b', 'other-work', other);
  const base = git(repo, 'rev-parse', 'origin/main').trim();
  for (const f of [targets.checkoutFile, targets.index, targets.head, join(targets.otherGitDir, 'HEAD')]) if (!existsSync(f)) throw Error(`the test repo has no ${f}`);

  const hub = await runHub(partial, plant);
  const w: World = { ...partial, ...targets, repo, base, other, hub, client: await Client.open(hub.socket, root) };
  worlds.push(w);
  return w;
}

/** Everything a world left, by PID: its hub and what the hub started, and any call of the wrapper still running and what it started; then its stand-in. */
export async function closeWorld(w: World): Promise<void> {
  w.client.close();
  const pids = new Set<number>([...descendants(w.hub.pid), w.hub.pid]);
  for (const run of wrapperCalls(w)) {
    for (const pid of [run.pid, run.child].filter((p): p is number => typeof p === 'number')) {
      if (!alive(pid) || !commandOf(pid).includes(w.home)) continue;
      pids.add(pid);
      for (const d of descendants(pid)) pids.add(d);
    }
  }
  await stopPids([...pids]);
  w.api.server.close();
}
afterAll(async () => {
  for (const w of worlds.splice(0)) await closeWorld(w);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}, 120_000);

// ---- `deep` as you run it in your terminal: the test home, outside any agent's process tree.
export interface Ran { code: number | null; stdout: string; stderr: string; out: Line | undefined }
/** The last line of stdout that parses as a JSON object. */
export function jsonOut(stdout: string): Line | undefined {
  for (const line of stdout.trim().split('\n').reverse()) {
    try { const v = JSON.parse(line) as unknown; if (v && typeof v === 'object' && !Array.isArray(v)) return v as Line; } catch { /* not JSON */ }
  }
  return undefined;
}
export function deep(w: World, args: string[], o: { timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd: w.home, env: envFor(w), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, o.timeoutMs ?? 180_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, out: jsonOut(stdout) }); });
  });
}
export const shown = (r: Pick<Ran, 'code' | 'stdout' | 'stderr'>): string => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1200))}, stderr ${JSON.stringify(r.stderr.slice(-1200))}`;

// ---- The approval (#1330): `deep start approve`, then your yes on the trusted path.
const mentions = (value: unknown, id: string): boolean => JSON.stringify(value).toLowerCase().includes(id.toLowerCase());
export async function approve(w: World): Promise<void> {
  const r = await deep(w, ['start', 'approve', '--repo', w.repo, '--issues', String(ISSUE), '--agents', w.agent, '--at-once', '1', '--plan-share', '50', '--json']);
  expect(r.code, `deep start approve exits 0 with the ask it raised (${shown(r)})`).toBe(0);
  const handle = String(r.out?.ask ?? '');
  expect(handle.startsWith('ask:'), `deep start approve --json prints { ask: "ask:<id>" }: ${JSON.stringify(r.out)}`).toBe(true);
  const id = handle.slice(4);
  const created = await waitFor(async () => (await w.client.events('ask.created')).find((e) => mentions(e, id)), 15_000, `the ask.created event of ${handle}`);
  const yes = ((created.data?.options ?? []) as { id: string; decision?: string }[]).find((o) => o.decision === 'allow');
  expect(yes, `${handle} offers a yes: ${JSON.stringify(created.data?.options)}`).toBeTruthy();
  const answered = await deep(w, ['inbox', 'answer', handle, yes!.id]);
  expect(answered.code, `deep inbox answer ${handle} ${yes!.id} exits 0 (${shown(answered)})`).toBe(0);
}

// ---- The session.
/** What the wrapper logged of each call: its arguments, whether it was the start, what it ran, and how the real binary ended. */
function wrapperCalls(w: Pick<World, 'home'>): Line[] {
  const dir = join(w.home, '.dh1666');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => {
    try { return [JSON.parse(readFileSync(join(dir, f), 'utf8')) as Line]; } catch { return []; }
  });
}
/** The starts among them: the launches that carried the start's prompt. */
export const agentRuns = (w: Pick<World, 'home'>): Line[] => wrapperCalls(w).filter((c) => c.start === true);
/** Each file the command may touch outside its worktree, by its bytes' digest: the checkout's three and every file in the other worktree's git folder. */
export type Snapshot = Record<string, string>;
const digest = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');
export function snapshot(w: World): Snapshot {
  const out: Snapshot = {};
  for (const f of [w.checkoutFile, w.index, w.head]) out[f] = existsSync(f) ? digest(f) : 'missing';
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[p] = digest(p);
    }
  };
  walk(w.otherGitDir);
  return out;
}

export interface Session {
  w: World; run: string; worktree: string; branch: string; reply: Line;
  /** The files outside the worktree as they were just before the start. */
  before: Snapshot;
  /** The wrapper's log of the launch, once the real agent ended (or as it stood when the wait ran out). */
  agentRun: Line | undefined;
  /** What the command wrote to probe-report.json in the worktree, or undefined when it never ran. */
  report: Line | undefined;
}
/** The words of the session's start, and the prompt: what the stand-in model does doesn't depend on them. */
export const PROMPT = 'Commit your change in this worktree: run node probe.mjs.';
/**
 * One session started on a test home under an approval for this agent, and its one command run to the end: the
 * approval, the files outside the worktree read, `deep start`, then the wait for the real agent to exit.
 */
export async function startedSession(agent: Agent, o: { plant?: string } = {}): Promise<Session> {
  const w = await openWorld(agent, o.plant);
  await approve(w);
  const before = snapshot(w);
  const r = await deep(w, ['start', '--repo', w.repo, '--issue', String(ISSUE), '--agent', agent, '--prompt', PROMPT, '--json']);
  const what = `the start of a ${agent} session for issue ${ISSUE}${o.plant ? ` (DEEP_HUB_PLANT=${o.plant})` : ''}`;
  expect(r.code, `${what}: deep start exits 0 (${shown(r)})`).toBe(0);
  expect(r.out?.status, `${what}: deep start --json says started: ${JSON.stringify(r.out)}`).toBe('started');
  expect(typeof r.out?.worktree === 'string' && typeof r.out?.branch === 'string' && r.out.branch.length > 0, `${what}: it names the worktree and the branch: ${JSON.stringify(r.out)}`).toBe(true);
  expect(r.out?.version, `${what}: the hub launched ${agent} at the version under test`).toBe(w.real.version);
  const worktree = realOr(String(r.out!.worktree));
  const ended = (): Line | undefined => agentRuns(w).find((x) => realOr(String(x.cwd)) === worktree && x.done === true);
  const agentRun = await waitFor(ended, 7 * 60 * SECOND, `${agent} to finish its turn in ${worktree}`).catch(() => agentRuns(w).find((x) => realOr(String(x.cwd)) === worktree));
  const file = join(worktree, 'probe-report.json');
  const report = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Line : undefined;
  return { w, run: String(r.out!.run), worktree, branch: String(r.out!.branch), reply: r.out!, before, agentRun, report };
}

/** How the session's agent was launched and ended, for a failure's message: the sandbox it was given and the tail of what it said. */
export function agentSaid(s: Session): string {
  const a = s.agentRun;
  if (!a) return `the hub never launched ${s.w.agent} in ${s.worktree} (launches logged: ${JSON.stringify(agentRuns(s.w).map((x) => x.cwd))})`;
  const launched = (a.launched as string[]).join(' ');
  return `${s.w.agent} ${a.done ? `ended (exit ${a.code}${a.signal ? `, ${a.signal}` : ''})` : 'had not ended after 7 minutes'}; launched with ${JSON.stringify(launched.slice(0, 1500))}; `
    + `stdout ${JSON.stringify(String(a.stdout ?? '').slice(-1500))}; stderr ${JSON.stringify(String(a.stderr ?? '').slice(-600))}`;
}
const ran = (s: Session, what: string): Line => {
  expect(s.report, `${what}: the session's command (${COMMAND}) ran in its worktree and wrote probe-report.json there: ${agentSaid(s)}`).toBeTruthy();
  return s.report!;
};

/** AC1: the command's git commit in the session's worktree succeeded, and the commit is on the session's branch. */
export function commitsOnItsBranch(s: Session): void {
  const what = `${AC[1]} ${s.w.agent} ${s.w.real.version}`;
  const r = ran(s, what);
  const failed = [r.add, r.commit].filter((g: Line) => g.code !== 0).map((g: Line) => String(g.stderr || g.error || `exit ${g.code}`).trim());
  expect(failed, `${what}: the command's git commit in its worktree ${s.worktree} failed: ${failed.join(' | ')} (the sandbox it was launched with: ${JSON.stringify(sandboxOf(s).slice(0, 1500))})`).toEqual([]);
  const log = git(s.w.repo, 'log', '--format=%H %P %s', s.branch).trim().split('\n');
  const [sha, parent, ...words] = (log[0] ?? '').split(' ');
  expect(words.join(' '), `${what}: the newest commit on the session's branch ${s.branch} is the command's ("${SUBJECT}"); git -C <repo> log ${s.branch} says ${JSON.stringify(log.slice(0, 3))}`).toBe(SUBJECT);
  expect(parent, `${what}: the command's commit ${sha} sits on the branch's base ${s.w.base}`).toBe(s.w.base);
}

/** The sandbox part of the launch: Claude Code's --settings JSON, Codex's -c overrides past the approval policy and trust. */
function sandboxOf(s: Session): string {
  const args = (s.agentRun?.launched ?? []) as string[];
  if (s.w.agent === 'claude-code') return args.includes('--settings') ? args[args.indexOf('--settings') + 1] ?? '' : '';
  return args.slice(0, -1).filter((a) => !a.startsWith('approval_policy=') && !a.startsWith('projects.') && a !== '-c').join(' ');
}

/** The probe's refusal codes: the sandbox's own, and a file mode's. Anything else isn't a refusal. */
const REFUSED = new Set(['EPERM', 'EACCES']);
/**
 * AC2: each write the command tried outside its worktree was refused, read from what happened: the command's own
 * report of each write, and the files themselves as they were just before the start. Each path written is named.
 */
export function refusesTheRest(s: Session): void {
  const what = `${AC[2]} ${s.w.agent} ${s.w.real.version}`;
  const r = ran(s, what);
  const after = snapshot(s.w);
  const notRefused: string[] = [];
  const writes = (r.writes ?? []) as Line[];
  for (const target of [s.w.checkoutFile, s.w.index, s.w.head, s.w.otherGitDir]) {
    const tried = writes.filter((x) => x.target === target || String(x.target).startsWith(`${target}/`));
    if (!tried.length) notRefused.push(`${target} (the command never tried it)`);
    for (const x of tried) {
      if (x.ok === true) notRefused.push(`${String(x.target)} (written)`);
      else if (!REFUSED.has(String(x.code))) notRefused.push(`${String(x.target)} (failed with ${String(x.code)}, not refused: ${String(x.error)})`);
    }
    const changed = [...new Set([...Object.keys(s.before), ...Object.keys(after)])]
      .filter((f) => (f === target || f.startsWith(`${target}/`)) && s.before[f] !== after[f]);
    for (const f of changed) if (!notRefused.some((n) => n.startsWith(`${f} `))) notRefused.push(`${f} (${s.before[f] === undefined ? 'made' : after[f] === undefined ? 'removed' : 'changed'})`);
  }
  expect(notRefused, `${what}: the session's command wasn't refused writing ${notRefused.join('; ')} (the sandbox it was launched with: ${JSON.stringify(sandboxOf(s).slice(0, 1500))})`).toEqual([]);
}

// ---- Planted programs.
/** One reading of a planted program: the message its reading throws, or null when it holds. BLOCKED is thrown on, never read as the plant's failure. */
export async function failureOf(reading: () => unknown): Promise<string | null> {
  try {
    await reading();
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('BLOCKED:')) throw error;
    return message;
  }
}
