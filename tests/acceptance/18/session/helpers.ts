// Test-side tools for the #18 session criteria (AC5, AC9, AC10, AC20): a real hub (`deep hub run`) in a temporary
// home, the real deep-hook binary run as Claude Code runs a hook entry's command (`deep-hook claude-code <event>`,
// the hook JSON on stdin), Claude Code sessions as hook payloads shaped like the corpus's (adapters/corpus/claude-code)
// with a transcript under <home>/.claude/projects, the real `deep mcp`, and an agent stand-in (fixtures/agent.mjs)
// whose hooks and `deep mcp` are its children. Every observation goes through deep-hook's output, the hub's socket
// (tests/acceptance/16/README.md), `deep mcp` spoken to as an MCP client speaks it, or files. No hub, CLI or adapter
// module is imported. Processes are stopped by PID only, never by name or port.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const NODE = process.execPath;
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const parse = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
/** A short random word of lower-case letters and digits, starting with a letter: unique text to look for. */
export const word = (prefix = 'w'): string => `${prefix}${randomBytes(5).toString('hex')}`;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function ulid(ms = Date.now()): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (const b of randomBytes(16)) tail += CROCKFORD[b % 32];
  return time + tail;
}

// ---- Temp folders (short: a socket path must fit in 104 bytes on macOS) and the processes this suite started.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh18s-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
export const own = (pid: number | undefined): void => { if (pid) owned.add(pid); };
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
/** Stops every process this suite started, by PID (SIGTERM, then SIGKILL after 3 s), and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/**
 * The environment a child gets: this one with HOME moved to the test's home, and none of the hub's settings, your
 * Claude Code or Codex settings, or billing keys; `extra` on top (undefined removes a variable).
 */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key.startsWith('GIT_') || key.startsWith('TMUX') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
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
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, ms: performance.now() - t0, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran): string => `exit ${r.code}${r.timedOut ? ' (killed at the timeout)' : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;

/** Builds deep-hook once per test process (target/debug/deep-hook), as the repo's own build does. */
let built: Promise<void> | undefined;
export function buildDeepHook(): Promise<void> {
  built ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutMs: 900_000 }).then((r) => {
    if (r.code !== 0 || !existsSync(DEEP_HOOK)) throw Error(`BLOCKED: cargo build -p deep-hook failed: ${r.stderr.slice(-3000)}`);
    // The first exec of a new binary is slow on macOS (it is checked before it runs); warm it once.
    spawnSync(DEEP_HOOK, ['--version'], { stdio: 'ignore', timeout: 30_000 });
  });
  return built;
}

// ---- A home and a worktree: a git repo of its own with the repo's spec, .deepbuild/done.yaml.
export const rootOf = (home: string): string => join(home, '.deepbuild');
/** A temp folder with a home in it: <tmp>/h. */
export function makeHome(): { tmp: string; home: string } {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home);
  return { tmp, home };
}
/**
 * The repo's spec, as the design's done.yaml example writes it: the claim `done` runs `checks`, each a command check
 * (`false`), and the values the ask rules leave open (a value nobody declares makes what depends on it BLOCKED).
 */
export function doneYaml(checks: readonly string[]): string {
  return [
    'claims:',
    '  done:',
    `    checks: [${checks.join(', ')}]`,
    'checks:',
    ...checks.map((name) => `  ${name}: { type: command, run: "false" }`),
    'asks:',
    '  deadline: { taste: 3d, authority: 1d, unblock: 2d, exception: 2d, choice: 2d, definition: 4h }',
    '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
    '  fallback: [change-owner]',
    '',
  ].join('\n');
}
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
/** A worktree at `dir`: a fresh git repo (never this checkout) whose one commit holds the spec naming `checks`. */
export function makeWorktree(dir: string, checks: readonly string[] = ['unit', 'lint']): string {
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), doneYaml(checks));
  writeFileSync(join(dir, 'README.md'), '# shop\n');
  const env = { ...process.env, ...GIT_ENV, HOME: dir };
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return realpathSync(dir);
}

// ---- Claude Code's facts: the versions the shipped facts cover, and a copy widened to one more (README: Widening).
export const FACTS_FILE = join(REPO, 'adapters/claude-code.facts.json');
export const readFacts = (): Line => JSON.parse(readFileSync(FACTS_FILE, 'utf8')) as Line;
const semver = (v: string): number[] => v.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
const newer = (a: string, b: string): number => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!; return 0; };
/** The newest Claude Code version the shipped facts cover: its sessions are gated as usual. */
export function newestCovered(): string {
  const versions = (readFacts().versions ?? []) as string[];
  if (!versions.length) throw Error(`BLOCKED: ${FACTS_FILE} names no versions`);
  return [...versions].sort(newer).at(-1)!;
}
/** A version past the facts: one patch after the newest they cover, so no covered range holds it. */
export function pastFacts(): string {
  const [major, minor, patch] = semver(newestCovered());
  const version = `${major}.${minor}.${patch! + 1}`;
  const facts = readFacts();
  if ((facts.versions as string[]).includes(version) || facts.events?.versions?.[version]) throw Error(`BLOCKED: ${version} is already covered`);
  return version;
}
/**
 * A folder holding the shipped facts files with Claude Code's range widened to `version`, as the live smoke test's
 * approved diff widens it: `version` added to `versions`, and its strict payload schema (`events.versions`) the same
 * as the newest covered version's, which the payloads these tests send were shaped from. Codex's file is copied
 * unchanged. The hub reads it through DEEP_HUB_TEST_FACTS (README: Seams).
 */
export function widenedFacts(dir: string, version: string): string {
  const facts = readFacts();
  const newest = newestCovered();
  facts.versions = [...(facts.versions as string[]), version];
  facts.events.versions[version] = structuredClone(facts.events.versions[newest]);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'claude-code.facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
  writeFileSync(join(dir, 'codex.facts.json'), readFileSync(join(REPO, 'adapters/codex.facts.json')));
  return dir;
}

// ---- Claude Code sessions: hook payloads and a transcript whose every entry carries the session's version.
export interface Session { id: string; cwd: string; transcript: string; version: string; parent: string | null }
/**
 * A session in `cwd` on Claude Code `version`. Its transcript is where Claude Code keeps it,
 * <home>/.claude/projects/<cwd with each non-alphanumeric character as ->/<id>.jsonl, and already holds one earlier
 * turn (a user entry and an assistant entry), as a resumed session's does, every entry stamped with `version`.
 */
export function newSession(home: string, cwd: string, version: string): Session {
  const id = randomUUID();
  const transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  const s: Session = { id, cwd, transcript, version, parent: null };
  userTurn(s, 'Look around the repo.');
  entry(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Done looking.' }], stop_reason: 'end_turn', usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 3 } } });
  return s;
}
/** Appends one transcript entry as Claude Code writes it: its session, folder, version and place in the chain. */
export function entry(s: Session, fields: Line): string {
  const uuid = randomUUID();
  appendFileSync(s.transcript, `${JSON.stringify({ parentUuid: s.parent, isSidechain: false, ...fields, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: s.cwd, sessionId: s.id, version: s.version, gitBranch: 'main' })}\n`);
  s.parent = uuid;
  return uuid;
}
/** A prompt you typed, as its transcript entry records it; returns its prompt ID. */
export function userTurn(s: Session, prompt: string): string {
  const promptId = randomUUID();
  entry(s, { promptId, type: 'user', message: { role: 'user', content: prompt }, permissionMode: 'default', origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  return promptId;
}
/** The assistant entry that calls a tool; returns the call's tool_use_id. */
export function toolCall(s: Session, name: string, input: Line): string {
  const call = `toolu_${randomBytes(12).toString('hex')}`;
  entry(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: call, name, input }], stop_reason: 'tool_use', usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 } } });
  return call;
}
/** The base of a Claude Code hook payload for `event`, with `extra` over it (the corpus's shapes). */
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, permission_mode: 'default', hook_event_name: event };
  if (event === 'SessionStart') Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' });
  return { ...base, ...extra };
}
/** A whole turn's hooks as Claude Code fires them for a typed prompt that runs one Bash command and stops. */
export function turn(s: Session, prompt: string, command: string): { prompt: Line; pre: Line; post: Line; stop: Line } {
  const promptId = userTurn(s, prompt);
  const input = { command, description: 'Run the command' };
  const call = toolCall(s, 'Bash', input);
  return {
    prompt: payload(s, 'UserPromptSubmit', { prompt_id: promptId, prompt }),
    pre: payload(s, 'PreToolUse', { prompt_id: promptId, tool_name: 'Bash', tool_input: input, tool_use_id: call }),
    post: payload(s, 'PostToolUse', { prompt_id: promptId, tool_name: 'Bash', tool_input: input, tool_response: { stdout: '', stderr: '', interrupted: false, isImage: false }, tool_use_id: call }),
    stop: payload(s, 'Stop', { prompt_id: promptId, stop_hook_active: false, last_assistant_message: 'Ran it.' }),
  };
}

/** deep-hook as Claude Code runs a hook entry's command: `deep-hook claude-code <event>`, the hook JSON on stdin. */
export function hook(home: string, s: Session, body: Line, o: { env?: Record<string, string | undefined>; timeoutMs?: number } = {}): Promise<Ran> {
  return run(DEEP_HOOK, ['claude-code', String(body.hook_event_name)], { cwd: s.cwd, env: childEnv(home, o.env), input: JSON.stringify(body), timeoutMs: o.timeoutMs ?? 90_000 });
}
/** What deep-hook's output tells Claude Code about a tool call: exit 2 or a deny decision blocks it; exit 0 allows. */
export function blocked(r: Ran): boolean {
  const out = parse(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  return r.code === 2 || said === 'deny' || said === 'block';
}

// ---- rules.json: guard@1 entries deep-hook matches and the hub decides (design: Before each command).
export function writeRules(home: string, entries: Record<string, Line>): void {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  writeFileSync(join(rootOf(home), 'rules.json'), `${JSON.stringify({ v: 1, entries }, null, 2)}\n`);
}

// ---- The hub: `deep hub run` with HOME at the test's home, so its root is <home>/.deepbuild.
export interface Hub { pid: number; home: string; socket: string; child: ChildProcess; output(): string }
export interface HubOptions {
  /** DEEP_HUB_PLANT: a planted wrong program the hub already lists (README: Wrong programs). */
  plant?: string | undefined;
  /** DEEP_HUB_TEST_FACTS: a folder whose facts files the hub's adapters read instead of the checkout's adapters/. */
  facts?: string | undefined;
}
export async function startHub(home: string, o: HubOptions = {}): Promise<Hub> {
  const env = childEnv(home, { DEEP_HUB_PLANT: o.plant, DEEP_HUB_TEST_FACTS: o.facts });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(parse(first.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start${o.plant ? ` with DEEP_HUB_PLANT=${o.plant}` : ''}: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(rootOf(home), 'hub.sock'), child, output: () => out };
}
/** SIGTERM to the hub, by its PID, and waits for it to exit. */
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 20_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  while (alive(hub.pid)) await sleep(20);
}

// ---- The socket: one JSON line each way, `v: 1` (tests/acceptance/16/README.md, The socket).
export class Conn {
  private buffer = '';
  private readonly lines: Line[] = [];
  private readonly wakers = new Set<() => void>();
  private ids = 0;
  private closed = false;
  private constructor(private readonly sock: net.Socket) {
    sock.setEncoding('utf8').on('data', (chunk: string) => {
      this.buffer += chunk;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        this.lines.push(parse(this.buffer.slice(0, i)) ?? { unparsed: this.buffer.slice(0, i) });
        this.buffer = this.buffer.slice(i + 1);
      }
      for (const w of [...this.wakers]) w();
    });
    const end = () => { this.closed = true; for (const w of [...this.wakers]) w(); };
    sock.on('error', end);
    sock.on('close', end);
  }
  /** Connects, reads the hub's hello, and presents `hello`; resolves with the connection and the hub's answer to it. */
  static async open(socket: string, hello: Line): Promise<{ conn: Conn; answer: Line | undefined }> {
    const conn = new Conn(net.connect(socket));
    if (!(await conn.wait(0))) throw Error(`BLOCKED: no hello from the hub at ${socket}`);
    conn.sock.write(`${JSON.stringify({ v: 1, ...hello })}\n`);
    return { conn, answer: await conn.wait(1) };
  }
  private wait(index: number, timeoutMs = 15_000): Promise<Line | undefined> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.lines.length > index || this.closed) { clearTimeout(timer); this.wakers.delete(check); resolve(this.lines[index]); }
      };
      const timer = setTimeout(() => { this.wakers.delete(check); resolve(undefined); }, timeoutMs);
      this.wakers.add(check);
      check();
    });
  }
  async call(method: string, params: Line = {}, timeoutMs = 30_000): Promise<Line> {
    const id = `t18#${++this.ids}`;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await new Promise<Line | undefined>((resolve) => {
      const check = () => {
        const found = this.lines.find((l) => l.id === id);
        if (found || this.closed) { clearTimeout(timer); this.wakers.delete(check); resolve(found); }
      };
      const timer = setTimeout(() => { this.wakers.delete(check); resolve(undefined); }, timeoutMs);
      this.wakers.add(check);
      check();
    });
    if (!reply) throw Error(`no reply to ${method} within ${timeoutMs} ms`);
    return reply;
  }
  close(): void { this.sock.destroy(); }
}
/** A connection holding the control token, read from <home>/.deepbuild/control.token, as `deep` holds it. */
export async function control(hub: Hub): Promise<Conn> {
  const token = readFileSync(join(rootOf(hub.home), 'control.token'), 'utf8').trim();
  const { conn, answer } = await Conn.open(hub.socket, { hello: 'cli', token });
  if (answer?.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(answer)}`);
  return conn;
}
/** An event as `events.read` gives it: the record's JSON, `session` its session, `verified` its unverified mark. */
export interface Ev { id: string; kind: string; subject?: string; writer: string; session?: string; seq?: string; ts: number; data: Line; log_pos: number; verified?: boolean }
/** Every event in the hub's log, through `events.read`. */
export async function events(hub: Hub): Promise<Ev[]> {
  const conn = await control(hub);
  try {
    const all: Ev[] = [];
    for (let after = 0; ;) {
      const reply = await conn.call('events.read', { after, limit: 1000 });
      if ('error' in reply) throw Error(`BLOCKED: events.read refused: ${JSON.stringify(reply.error)}`);
      const page = reply.result.events as Ev[];
      if (!page.length) return all;
      all.push(...page);
      after = page[page.length - 1]!.log_pos;
    }
  } finally {
    conn.close();
  }
}
/** Polls the log until `done(events)` holds or `timeoutMs` passes; returns the last read either way. */
export async function eventsUntil(hub: Hub, done: (all: Ev[]) => boolean, timeoutMs = 20_000): Promise<Ev[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const all = await events(hub);
    if (done(all) || Date.now() > deadline) return all;
    await sleep(200);
  }
}
export const brief = (e: Ev): string => `${e.kind}${e.verified === false ? ' (unverified)' : ''} ${JSON.stringify(e.data).slice(0, 300)}`;

// ---- MCP: newline-delimited JSON-RPC 2.0 over a `deep mcp` process's stdio, as a real MCP client speaks it.
export interface Mcp { request(method: string, params?: Line, timeoutMs?: number): Promise<Line>; notify(method: string, params?: Line): Promise<void> }
let rpc = 0;
const nextId = (): string => `t18-${++rpc}`;
export const MCP_ARGV = [NODE, CLI, 'mcp'];

/** A `deep mcp` started by hand: a child of this test process, under no agent, so its parent matches no session. */
export class HandMcp implements Mcp {
  private readonly child: ChildProcess;
  private readonly lines: string[] = [];
  private readonly wakers = new Set<() => void>();
  private stderr = '';
  constructor(home: string, cwd: string, plant?: string) {
    this.child = spawn(MCP_ARGV[0]!, MCP_ARGV.slice(1), { cwd, env: childEnv(home, { DEEP_HUB_PLANT: plant }), stdio: ['pipe', 'pipe', 'pipe'] });
    own(this.child.pid);
    this.child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.stderr = (this.stderr + d).slice(-4000); });
    createInterface({ input: this.child.stdout! }).on('line', (l) => { this.lines.push(l); for (const w of [...this.wakers]) w(); });
    this.child.on('close', () => { for (const w of [...this.wakers]) w(); });
  }
  async notify(method: string, params: Line = {}): Promise<void> {
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }
  request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<Line> {
    const id = nextId();
    return new Promise((resolve, reject) => {
      const from = this.lines.length;
      const finish = () => { clearTimeout(timer); this.wakers.delete(check); };
      const timer = setTimeout(() => { finish(); reject(Error(`deep mcp gave no reply to ${method} in ${timeoutMs} ms: ${this.stderr}`)); }, timeoutMs);
      const check = () => {
        for (let i = from; i < this.lines.length; i++) {
          const json = parse(this.lines[i]!);
          if (json?.id === id) { finish(); resolve(json); return; }
        }
        if (this.child.exitCode !== null) { finish(); reject(Error(`deep mcp exited ${this.child.exitCode}: ${this.stderr}`)); }
      };
      this.wakers.add(check);
      this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      check();
    });
  }
}

/** The Claude Code stand-in (fixtures/agent.mjs): deep-hook and its `deep mcp` run as its children. */
export class Agent implements Mcp {
  private readonly child: ChildProcess;
  private readonly answers = new Map<number, (line: Line) => void>();
  private n = 0;
  private constructor(private readonly home: string, private readonly cwd: string, private readonly plant: string | undefined) {
    this.child = spawn(NODE, [AGENT], { cwd, env: childEnv(home, { DEEP_HUB_PLANT: plant }), stdio: ['pipe', 'pipe', 'pipe'] });
    own(this.child.pid);
    createInterface({ input: this.child.stdout! }).on('line', (l) => {
      const line = parse(l);
      if (line && typeof line.n === 'number') { this.answers.get(line.n)?.(line); this.answers.delete(line.n); }
    });
  }
  static start(home: string, cwd: string, plant?: string): Agent { return new Agent(home, cwd, plant); }
  get pid(): number { return this.child.pid!; }
  private send(command: Line, timeoutMs = 150_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.answers.delete(n); reject(Error(`the agent stand-in gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.answers.set(n, (line) => { clearTimeout(timer); if (line.failed) reject(Error(line.failed)); else resolve(line); });
      this.child.stdin!.write(`${JSON.stringify({ ...command, n })}\n`);
    });
  }
  /** One hook, as Claude Code runs it: deep-hook a child of this agent, in the session's folder. */
  async hook(s: Session, body: Line): Promise<Ran> {
    const t0 = performance.now();
    const r = await this.send({ op: 'hook', binary: DEEP_HOOK, event: body.hook_event_name, payload: body, cwd: s.cwd, env: childEnv(this.home) });
    return { code: r.code as number | null, stdout: String(r.stdout), stderr: String(r.stderr), ms: performance.now() - t0, timedOut: false };
  }
  async notify(method: string, params: Line = {}): Promise<void> {
    await this.send({ op: 'mcp', argv: MCP_ARGV, cwd: this.cwd, env: childEnv(this.home, { DEEP_HUB_PLANT: this.plant }), line: { jsonrpc: '2.0', method, params } });
  }
  async request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<Line> {
    const r = await this.send({ op: 'mcp', argv: MCP_ARGV, cwd: this.cwd, env: childEnv(this.home, { DEEP_HUB_PLANT: this.plant }), line: { jsonrpc: '2.0', id: nextId(), method, params }, timeoutMs }, timeoutMs + 10_000);
    return r.reply as Line;
  }
}

export async function initialize(m: Mcp): Promise<void> {
  const reply = await m.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-18', version: '0' } });
  if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
  await m.notify('notifications/initialized');
}
/** A tool call's outcome: `isError`, and its value (structuredContent, else the first text block's JSON). */
export interface Outcome { isError: boolean; value: any; reply: Line }
export async function callTool(m: Mcp, name: string, args: Line, timeoutMs?: number): Promise<Outcome> {
  const reply = await m.request('tools/call', { name, arguments: args }, timeoutMs);
  if (reply.error) return { isError: true, value: reply.error, reply };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? result.content.find((c: Line) => c?.type === 'text')?.text : undefined;
  return { isError: result.isError === true, value: result.structuredContent ?? (typeof text === 'string' ? parse(text) ?? text : undefined), reply };
}
/** A call left running while the test goes on: its outcome, or why it failed. Never rejects. */
export function pending(call: Promise<Outcome>): Promise<{ returned?: Outcome; failed?: string }> {
  return call.then((o) => ({ returned: o }), (error: unknown) => ({ failed: String(error) }));
}
