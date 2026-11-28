import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ID = '#321.70212996';
export const PUSH = 'git push origin main';
export const TESTS = 'npm test';
export const PUSH_QUESTION = 'want me to push to main?';
export const TESTS_QUESTION = 'want me to run the tests?';
export const SORTER_RULE = 'planted-sorter-proceeds-on-every-question';
export const WRONG_CORE = 'proceed-covers-turn';
export const TESTS_RAN = 'tests-ran.txt';

function checkout(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'crates/deep-hook/Cargo.toml'))) {
    const up = dirname(dir);
    if (up === dir) throw Error('BLOCKED: no checkout above this suite holds crates/deep-hook');
    dir = up;
  }
  return dir;
}
export const REPO = checkout();
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));

export type Line = Record<string, unknown>;
export const get = (value: unknown, ...keys: string[]): unknown => keys.reduce<unknown>((v, k) => (typeof v === 'object' && v !== null ? (v as Line)[k] : undefined), value);
export interface Ran { code: number | null; signal: string | null; stdout: string; stderr: string }
export interface Ev { id: string; kind: string; log_pos: number; session?: string; data: Line }

export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
export const shown = (r: Ran): string => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;
export function must(ok: boolean, message: string): asserts ok {
  if (!ok) throw Error(message);
}

export function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  // deadline: bounds a wait on an event (a reply, a frame, a process exit), so a hang fails naming what never came
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`${what}: not within ${ms / 1000} s`)), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

const closers: (() => Promise<void>)[] = [];
const made: string[] = [];
export async function cleanup(): Promise<void> {
  for (const close of closers.splice(0).reverse()) await close().catch(() => undefined);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/d321-'));
  made.push(dir);
  return dir;
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    return;
  }
}
const exitOf = (child: ChildProcess): Promise<void> => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) resolve();
  else child.once('exit', () => resolve());
});
async function stop(child: ChildProcess, ms: number): Promise<void> {
  const exited = exitOf(child);
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  try {
    await within(exited, ms, `process ${child.pid} after SIGTERM`);
  } catch {
    child.kill('SIGKILL');
    await within(exited, ms, `process ${child.pid} after SIGKILL`).catch(() => undefined);
  }
}

const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
const DROPPED = /^(DEEP_|GIT_|npm_|NPM_|XDG_|CLAUDE|ANTHROPIC_|CODEX|CURSOR|GROK|VITEST|NODE_OPTIONS$)/;
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!DROPPED.test(key) && !BILLING.includes(key)) env[key] = value;
  Object.assign(env, {
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export async function run(file: string, args: readonly string[], o: { env: NodeJS.ProcessEnv; cwd: string; ms?: number }): Promise<Ran> {
  const child = spawn(file, args, { cwd: o.cwd, env: o.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
  child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
  const done = new Promise<Ran>((resolve) => {
    child.on('error', (error) => resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  try {
    return await within(done, o.ms ?? 60_000, `${file} ${args.join(' ')}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

export function requireBuilt(): void {
  if (!existsSync(CLI)) throw Error(`BLOCKED: ${CLI} is missing; run npm run build --workspaces first`);
  if (!existsSync(DEEP_HOOK)) throw Error(`BLOCKED: ${DEEP_HOOK} is missing; run cargo build -p deep-hook first`);
  const built = statSync(DEEP_HOOK).mtimeMs;
  const sources = ['crates/deep-hook/src', 'crates/deep-contracts/src'].flatMap((d) => readdirSync(join(REPO, d), { recursive: true, encoding: 'utf8' }).map((f) => join(REPO, d, f)));
  const newer = sources.find((f) => statSync(f).isFile() && statSync(f).mtimeMs > built);
  if (newer) throw Error(`BLOCKED: ${DEEP_HOOK} is older than ${newer}; run cargo build -p deep-hook first`);
}

export function coveredVersion(): string {
  const facts = parseObject(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8'));
  const versions: unknown = facts?.versions;
  if (!Array.isArray(versions) || typeof versions.at(-1) !== 'string') throw Error('BLOCKED: adapters/claude-code.facts.json lists no versions');
  return versions.at(-1) as string;
}

export interface Hub { pid: number; socket: string; stderr: () => string }
export async function startHub(home: string, env: Record<string, string | undefined>): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  closers.push(() => stop(child, 15_000));
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { err += d; });
  const ready = new Promise<Line | undefined>((resolve) => {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!));
    });
    child.on('exit', () => resolve(undefined));
  });
  const said = await within(ready, 60_000, 'BLOCKED: the hub reporting ready').catch(() => undefined);
  if (!said || said.ready !== true) throw Error(`BLOCKED: the hub${env.DEEP_HUB_PLANT ? ` with DEEP_HUB_PLANT=${env.DEEP_HUB_PLANT}` : ''} did not start: ${err.slice(-1500)}`);
  return { pid: Number(said.pid), socket: String(said.socket), stderr: () => err };
}

export class Cli {
  readonly events: Ev[] = [];
  private buffer = '';
  private n = 0;
  private readonly replies = new Map<number, (line: Line) => void>();
  private readonly watchers = new Set<() => void>();
  private constructor(private readonly sock: net.Socket) {}

  static async open(home: string, socket: string): Promise<Cli> {
    const token = readFileSync(join(home, '.deepbuild/control.token'), 'utf8').trim();
    const sock = net.connect(socket);
    const cli = new Cli(sock);
    closers.push(async () => { sock.destroy(); });
    const role = new Promise<Line>((resolve, reject) => {
      let step = 0;
      sock.on('error', reject);
      sock.on('close', () => reject(Error('the hub closed the cli connection')));
      sock.setEncoding('utf8').on('data', (chunk: string) => {
        cli.buffer += chunk;
        for (let i = cli.buffer.indexOf('\n'); i >= 0; i = cli.buffer.indexOf('\n')) {
          const line = parseObject(cli.buffer.slice(0, i)) ?? {};
          cli.buffer = cli.buffer.slice(i + 1);
          if (step === 0) {
            step = 1;
            sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
          } else if (step === 1) {
            step = 2;
            resolve(line);
          } else cli.take(line);
        }
      });
    });
    const said = await within(role, 30_000, 'BLOCKED: the hub taking the cli hello');
    if (said.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(said)}`);
    return cli;
  }

  private take(line: Line): void {
    if (line.event && typeof line.event === 'object') {
      this.events.push(line.event as Ev);
      for (const watch of [...this.watchers]) watch();
    } else if (typeof line.id === 'number') this.replies.get(line.id)?.(line);
  }

  call(method: string, params: Line, ms = 30_000): Promise<Line> {
    const id = ++this.n;
    const reply = new Promise<Line>((resolve, reject) => {
      this.replies.set(id, (line) => {
        this.replies.delete(id);
        if (line.error) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`));
        else resolve(line.result as Line);
      });
    });
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    return within(reply, ms, `the hub's reply to ${method}`);
  }

  subscribe(): Promise<Line> {
    return this.call('stream.subscribe', { after: 0 });
  }

  until<T>(find: (events: Ev[]) => T | undefined, ms: number, what: string): Promise<T> {
    let watch = (): void => undefined;
    const found = new Promise<T>((resolve) => {
      watch = () => {
        const hit = find(this.events);
        if (hit !== undefined) resolve(hit);
      };
      this.watchers.add(watch);
      watch();
    });
    return within(found, ms, what).finally(() => this.watchers.delete(watch));
  }

  async allEvents(): Promise<Ev[]> {
    const all: Ev[] = [];
    for (let after = 0; ;) {
      const page = (await this.call('events.read', { after, limit: 1000 })).events as Ev[];
      if (!page.length) return all;
      all.push(...page);
      after = page[page.length - 1]!.log_pos;
    }
  }
}

export const deep = (home: string, args: readonly string[]): Promise<Ran> => run(NODE, [CLI, ...args], { env: childEnv(home), cwd: home, ms: 60_000 });
export const openAsks = (stdout: string): string[][] => stdout.split('\n').filter((l) => l.startsWith('ask:')).map((l) => l.trim().split(/\s+/));

export interface Repo { origin: string; work: string; git(...args: string[]): string }
export function makeRepo(dir: string, home: string): Repo {
  const origin = join(dir, 'o.git');
  const work = join(dir, 'w');
  const env = childEnv(home);
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: work, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env, stdio: 'ignore' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { env, stdio: 'ignore' });
  const config: [string, string][] = [['user.name', 'Test'], ['user.email', 'test@example.invalid'], ['core.hooksPath', '/dev/null'], ['commit.gpgsign', 'false']];
  for (const [key, value] of config) git('config', key, value);
  writeFileSync(join(work, 'README.md'), '# shop\n\nA small shop.\n');
  const script = `node -e "require('fs').writeFileSync('${TESTS_RAN}', 'ran')"`;
  writeFileSync(join(work, 'package.json'), `${JSON.stringify({ name: 'shop', version: '1.0.0', private: true, scripts: { test: script } }, null, 2)}\n`);
  writeFileSync(join(work, '.gitignore'), `${TESTS_RAN}\n`);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  return { origin, work: realpathSync(work), git };
}
export const originMain = (repo: Repo): string => repo.git(`--git-dir=${repo.origin}`, 'rev-parse', 'refs/heads/main');
export const localHead = (repo: Repo): string => repo.git('rev-parse', 'HEAD');

export class Agent {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Ran) => void>();
  private readonly kids = new Map<number, number>();
  private constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const line = parseObject(this.buffer.slice(0, i)) ?? {};
        this.buffer = this.buffer.slice(i + 1);
        const n = Number(line.n);
        if (typeof line.pid === 'number') this.kids.set(n, line.pid);
        else if (line.failed !== undefined || 'code' in line) {
          this.kids.delete(n);
          this.pending.get(n)?.({ code: line.failed !== undefined ? null : (line.code as number | null), signal: (line.signal as string | null) ?? null, stdout: String(line.stdout ?? ''), stderr: String(line.stderr ?? line.failed ?? '') });
          this.pending.delete(n);
        }
      }
    });
  }

  static start(home: string, cwd: string): Agent {
    const child = spawn(NODE, [AGENT], { cwd, env: childEnv(home, { npm_config_update_notifier: 'false', npm_config_fund: 'false' }), stdio: ['pipe', 'pipe', 'inherit'] });
    const agent = new Agent(child);
    closers.push(() => agent.close());
    return agent;
  }

  private send(command: Line): Promise<Ran> {
    const n = ++this.n;
    const done = new Promise<Ran>((resolve) => this.pending.set(n, resolve));
    this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    return done;
  }

  hook(event: string, payload: Line): Promise<Ran> {
    return this.send({ op: 'hook', binary: DEEP_HOOK, event, payload, cwd: payload.cwd });
  }

  sh(line: string, cwd: string): Promise<Ran> {
    return this.send({ op: 'sh', line, cwd });
  }

  async close(): Promise<void> {
    const exited = exitOf(this.child);
    this.child.stdin!.end();
    try {
      await within(exited, 15_000, 'the agent stand-in ending with its children');
    } catch {
      for (const pid of this.kids.values()) signal(pid, 'SIGKILL');
      await stop(this.child, 5000);
    }
  }
}

export type Decision = 'allow' | 'deny' | 'other';
export function decision(r: Ran): Decision {
  const out = parseObject(r.stdout.trim());
  const said = get(out, 'hookSpecificOutput', 'permissionDecision') ?? get(out, 'decision');
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
export function stopAnswer(r: Ran): string | undefined {
  const out = parseObject(r.stdout.trim());
  const reason = get(out, 'reason');
  if (r.code === 0 && get(out, 'decision') === 'block' && typeof reason === 'string') return reason;
  if (r.code === 2) return r.stderr;
  return undefined;
}

export class Session {
  readonly id = randomUUID();
  readonly transcript: string;
  private calls = 0;
  constructor(private readonly agent: Agent, home: string, readonly cwd: string, private readonly version: string) {
    this.transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
  }

  private entry(type: 'user' | 'assistant', content: unknown): void {
    const line = { type, sessionId: this.id, cwd: this.cwd, version: this.version, uuid: randomUUID(), timestamp: new Date().toISOString(), message: { role: type, content } };
    appendFileSync(this.transcript, `${JSON.stringify(line)}\n`);
  }
  private base(event: string): Line {
    return { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, permission_mode: 'default', hook_event_name: event };
  }
  callId(): string {
    return `toolu_${randomBytes(10).toString('hex')}_${++this.calls}`;
  }

  start(): Promise<Ran> {
    this.entry('user', 'Tidy the README and commit it.');
    return this.agent.hook('SessionStart', { ...this.base('SessionStart'), source: 'startup', model: 'claude-sonnet-5' });
  }
  prompt(text: string): Promise<Ran> {
    return this.agent.hook('UserPromptSubmit', { ...this.base('UserPromptSubmit'), prompt: text, prompt_id: randomUUID() });
  }
  pre(tool: string, input: Line, id: string): Promise<Ran> {
    this.entry('assistant', [{ type: 'tool_use', id, name: tool, input }]);
    return this.agent.hook('PreToolUse', { ...this.base('PreToolUse'), tool_name: tool, tool_input: input, tool_use_id: id });
  }
  post(tool: string, input: Line, id: string, response: Line): Promise<Ran> {
    this.entry('user', [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(response) }]);
    return this.agent.hook('PostToolUse', { ...this.base('PostToolUse'), tool_name: tool, tool_input: input, tool_use_id: id, tool_response: response });
  }
  stop(message: string, active: boolean): Promise<Ran> {
    this.entry('assistant', [{ type: 'text', text: message }]);
    return this.agent.hook('Stop', { ...this.base('Stop'), stop_hook_active: active, last_assistant_message: message });
  }
  sh(line: string): Promise<Ran> {
    return this.agent.sh(line, this.cwd);
  }
}

export function spooled(home: string, id: string): boolean {
  const dir = join(home, '.deepbuild/spool');
  if (!existsSync(dir)) return false;
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).some((f) => {
    const file = join(dir, f);
    return statSync(file).isFile() && readFileSync(file, 'utf8').includes(id);
  });
}
