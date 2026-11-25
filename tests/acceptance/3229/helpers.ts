// Test-side tools for issue #3229's acceptance tests (README): a temp world under /tmp/dh3229-* (a home whose
// ~/.deepbuild is the hub's, a repo holding a cart, its visible fixture and the drafted check that totals it, the
// definitions the kernel is handed, the OS secret store's stand-in beside the home); the real hub (`deep hub run`); the
// record, followed as it changes over the hub's socket; Claude Code sessions, each its own stand-in process
// (fixtures/agent.mjs) that is the parent of its real deep-hook calls, its Bash tool's shells and its `deep mcp`; and
// the searches of the hub's home. Nothing here stands in for DeepBuild: every reading comes from the real hub,
// deep-hook, `deep` CLI, record, evidence store and disk.
//
// Adapted, not imported (suites don't import each other): the world, the sessions and their hooks from
// tests/acceptance/29/h-d.ts and tests/acceptance/1018/helpers.ts; the followed record and the bound from
// tests/acceptance/3219/helpers.ts; the MCP calls from tests/acceptance/26/helpers.ts. Same repo, same license.
//
// Safety: every folder is under /tmp/dh3229-* and removed after its test; HOME is the test's own for every process; no
// network, no model, no real `claude`, no sign-in; a process is stopped only by the PID it was started with.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';
import { expect } from 'vitest';

/** Each criterion's tag: `#3229.` and the first 8 hex of SHA-256 of its text, trimmed, white space collapsed (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #3229.ee87773b',
  2: 'AC2 #3229.9319401a',
  3: 'AC3 #3229.c04b35af',
  4: 'AC4 #3229.9dd1dffa',
  5: 'AC5 #3229.97352c61',
  6: 'AC6 #3229.2d41acf1',
  7: 'AC7 #3229.ed92ed6d',
  8: 'AC8 #3229.82fbda49',
} as const;

/** The planted wrong programs the criteria name (README, Proof on a wrong program), selected with DEEP_HUB_PLANT. */
export const PLANTS = {
  /** AC2: a hub that leaves the unsealed file behind. */
  leaves: 'leaves-unsealed-variant',
  /** AC4: a hub that answers a read by handle of a variant with its bytes. */
  answers: 'answers-variant-bytes',
  /** AC5: a gate that counts a spent variant's run. */
  counts: 'counts-spent-variant',
  /** AC6: a hub that keys the spent mark on the session's ID. */
  byId: 'spent-by-session-id',
} as const;

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
export const NODE = process.execPath;
/** A test's own time limit: a loaded Mac runs a claim's two sandboxed runs in minutes. */
export const LIMIT = 1_800_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
const parseObject = (raw: string): Line | undefined => { try { const v: unknown = JSON.parse(raw); return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Line) : undefined; } catch { return undefined; } };
export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const cut = (text: string, n = 1200): string => (text.length > n ? `${text.slice(0, n)}…` : text);

/**
 * Resolves after `ms`. Every caller races it against the event it waits for (a process's end, a recorded event, a
 * reply), so all it can do is turn a hang into a result: this suite has no fixed wait (scripts/wait-ratchet.mjs).
 */
export function bound(ms: number): Promise<void> {
  // deadline: only ever raced against the event a test waits for; it bounds that wait and never waits on its own.
  return new Promise<void>((done) => { setTimeout(done, ms).unref(); });
}

// ---- Temp folders (short: a Unix socket path must fit in 104 bytes on macOS) and the processes this suite started.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh3229-'));
  made.push(dir);
  return dir;
}
const children = new Set<ChildProcess>();
const gone = (c: ChildProcess): boolean => c.exitCode !== null || c.signalCode !== null;
const exitOf = (c: ChildProcess): Promise<void> => (gone(c) ? Promise.resolve() : new Promise((done) => c.once('exit', () => done())));
/** Stops every process this file started, by its own PID (SIGTERM, then SIGKILL), and removes its folders. */
export async function cleanup(): Promise<void> {
  for (const c of children) if (!gone(c)) c.kill('SIGTERM');
  await Promise.race([Promise.all([...children].map(exitOf)), bound(30_000)]);
  for (const c of children) if (!gone(c)) c.kill('SIGKILL');
  await Promise.race([Promise.all([...children].map(exitOf)), bound(5000)]);
  children.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Node and the system's programs: no real agent of this Mac's is on a test's PATH. */
const PATH = [dirname(NODE), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
/** A child's environment: HOME the test's, PATH above, and no DEEP_, GIT_, XDG_, CLAUDE, CODEX or billing setting of this process's. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|GIT_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|AWS_BEARER|GH_TOKEN|GITHUB_TOKEN|NODE_OPTIONS|VITEST)/.test(key)) continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), PATH, LC_ALL: 'C' });
  for (const [key, value] of Object.entries(extra)) { if (value === undefined) delete env[key]; else env[key] = value; }
  return env;
}
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: cwd, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  }).trim();
}

// ---- The fixture repo: a cart whose total ignores the discount, and a drafted check that totals a fixture cart.
/** The fixture's path: what no line of the store's journal may hold. */
export const FIXTURE = 'test/fixtures/basket-3229.json';
export const CHECK = '.deepbuild/checks/basket.sh';
export const SOURCE = 'src/cart.mjs';
const BUG = 'export function total(cart) {\n  return cart.items.reduce((a, b) => a + b, 0);\n}\n';
/** The honest fix: right on the visible fixture and on every variant. `turn` makes each claim's bytes its own. */
export const FIXED = (turn = 0): string => `// turn ${turn}\nexport function total(cart) {\n  return cart.items.reduce((a, b) => a + b, 0) - cart.discount;\n}\n`;
/** A special case on each of the carts given, the bug for any other. */
const SPECIAL = (carts: Cart[], turn: number): string => `// turn ${turn}\nconst KNOWN = ${JSON.stringify(Object.fromEntries(carts.map((c) => [c.items.join(), c.total])))};\nexport function total(cart) {\n  return KNOWN[cart.items.join()] ?? cart.items.reduce((a, b) => a + b, 0);\n}\n`;
interface Cart { name: string; items: number[]; discount: number; total: number }
const VISIBLE: Cart = { name: 'visible', items: [100], discount: 10, total: 90 };
const cartFile = (c: Cart): string => `${JSON.stringify(c)}\n`;
/** A fix that special-cases the visible fixture alone: what a session that never saw the variant can do. */
export const SPECIAL_VISIBLE = (turn = 0): string => SPECIAL([VISIBLE], turn);
/** A fix that special-cases the visible fixture and the variant. */
export const SPECIAL_BOTH = (v: Variant, turn = 0): string => SPECIAL([VISIBLE, v.cart], turn);
/** A held-out variant: the same fixture file with another cart, named by a random marker that is nowhere else. */
export interface Variant { marker: string; cart: Cart; bytes: string }
export function variant(n: 1 | 2 = 1): Variant {
  const marker = `held-out-${randomBytes(8).toString('hex')}`;
  const cart: Cart = n === 1 ? { name: marker, items: [200, 50], discount: 30, total: 220 } : { name: marker, items: [7, 8, 9], discount: 4, total: 20 };
  return { marker, cart, bytes: cartFile(cart) };
}
const FILES: Record<string, string> = {
  'package.json': `${JSON.stringify({ name: 'shop3229', private: true, type: 'module' })}\n`,
  [SOURCE]: BUG,
  [FIXTURE]: cartFile(VISIBLE),
  'test/cart.test.mjs': `import assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport { test } from 'node:test';\nimport { total } from '../${SOURCE}';\n\nconst cart = JSON.parse(readFileSync(new URL('../${FIXTURE}', import.meta.url), 'utf8'));\n\ntest('totals the fixture cart', () => {\n  assert.equal(total(cart), cart.total);\n});\n`,
  [CHECK]: 'node --test test/cart.test.mjs\n',
};

// ---- The definitions the kernel is handed (DEEP_HUB_TEST_DRAFTS), as #1018's suite hands a check's held-out variants.
export const PROMPT = 'make the cart total take the discount off';
/** A second task's prompt, for the session on another task. */
export const OTHER_PROMPT = 'make the basket total subtract the discount';
/** A requirement, R1, whose check is the drafted one, with these held-out variants. */
export const draft = (ask: string, variants: Variant[]): Line => ({
  ask, deliverables: [SOURCE], budget: null,
  requirements: [{
    id: 'R1', text: 'The cart total takes the discount off', source_line: 'ask#L1', refuted_by: 'a cart whose total ignores its discount', check: CHECK,
    on_base: 'passes', asserts: [], depth: 'unit', oracle: 'code', near_misses: [], held_out: variants.map((v) => ({ files: { [FIXTURE]: v.bytes } })),
  }],
});

// ---- A world: <tmp>/h is HOME, <tmp>/repo the repo on main with one commit, <tmp>/w<n> worktrees cut from it.
export interface World { tmp: string; home: string; root: string; secrets: string; drafts: string; confirm: string; trees: string[] }
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'], fold: 5,
};
/**
 * Lays a world out. The handed drafts and the secret store's stand-in (DEEP_HUB_TEST_SECRETS, #1606) are beside the
 * home, never in it, so a search of the hub's home reads only what the hub keeps there. <tmp>/bin holds `deep`, first on
 * an agent's PATH.
 */
export function makeWorld(drafts: Line[], trees = 1): World {
  for (const [what, path] of [['the deep CLI (npm run build --workspaces)', CLI], ['deep-hook (cargo build --locked -p deep-hook)', DEEP_HOOK]] as const) {
    if (!existsSync(path)) throw Error(`BLOCKED: ${what} is not built at ${path}`);
  }
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS, runner: { login_path: PATH } }, null, 2)}\n`);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  mkdirSync(join(tmp, 'bin'));
  writeFileSync(join(tmp, 'bin', 'deep'), `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`, { mode: 0o755 });
  writeFileSync(join(tmp, 'drafts.json'), `${JSON.stringify({ drafts }, null, 2)}\n`);
  const repo = join(tmp, 'repo');
  for (const [path, bytes] of Object.entries(FILES)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), bytes);
  }
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'the sample cart and its drafted check');
  const paths = Array.from({ length: trees }, (_, i) => join(tmp, `w${i + 1}`));
  for (const [i, tree] of paths.entries()) git(repo, 'worktree', 'add', '-q', '-b', `session-${i + 1}`, tree, 'main');
  return { tmp, home, root, secrets: join(tmp, 'secrets.json'), drafts: join(tmp, 'drafts.json'), confirm: join(tmp, 'confirm'), trees: paths.map((p) => realpathSync(p)) };
}

// ---- The hub as a process, and its record followed over its socket (the cli role, with the control token).
/** One event as the hub's stream carries it. */
export interface Ev { id: string; kind: string; log_pos: number; ts: number; subject?: string; session?: string; data: Line }
export interface Hub { child: ChildProcess; socket: string; root: string; stderr(): string }
/** Starts `deep hub run` on the world; a hub that doesn't start (a plant it doesn't list) is BLOCKED. */
export async function startHub(w: World, plant?: string, cli = CLI): Promise<Hub> {
  const env = childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_SECRETS: w.secrets, DEEP_HUB_PLANT: plant });
  const child = spawn(NODE, [cli, 'hub', 'run'], { cwd: w.tmp, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { err = (err + d).slice(-20_000); });
  const first = new Promise<Line | undefined>((done) => createInterface({ input: child.stdout! }).once('line', (l) => done(parseObject(l))));
  const ready = await Promise.race([first, exitOf(child).then(() => undefined), bound(180_000).then(() => undefined)]);
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub${plant ? ` with the plant DEEP_HUB_PLANT=${plant}` : ''} did not start: ${err.slice(-1500)}`);
  return { child, socket: String(ready.socket), root: w.root, stderr: () => err };
}
export async function stopHub(hub: Hub): Promise<void> {
  if (!gone(hub.child)) hub.child.kill('SIGTERM');
  await Promise.race([exitOf(hub.child), bound(60_000)]);
  if (!gone(hub.child)) hub.child.kill('SIGKILL');
  await exitOf(hub.child);
}
/** The hub's record, each event as its frame arrives on one `stream.subscribe` from the record's start. */
export class Log {
  readonly events: Ev[] = [];
  private readonly wakers = new Set<() => void>();
  private readonly replies = new Map<string, (line: Line) => void>();
  private ids = 0;
  private constructor(private readonly sock: net.Socket) {
    let buffer = '';
    let hello: 'sent' | 'due' = 'due';
    sock.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parseObject(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        if (hello === 'due') { hello = 'sent'; this.wake('hello', line); }
        else if (line.role !== undefined) this.wake('role', line);
        else if (line.event && typeof line.event === 'object' && !('result' in line)) this.take(line.event as Ev);
        else this.wake(String(line.id), line);
      }
    });
    sock.on('error', () => undefined);
  }
  private wake(id: string, line: Line): void { this.replies.get(id)?.(line); this.replies.delete(id); }
  private take(e: Ev): void {
    if (this.events.length && e.log_pos <= this.events[this.events.length - 1]!.log_pos) return;
    this.events.push(e);
    for (const w of [...this.wakers]) w();
  }
  private reply(id: string, what: string, ms = 180_000): Promise<Line> {
    const got = new Promise<Line>((done) => this.replies.set(id, done));
    return Promise.race([got, bound(ms).then(() => { throw Error(`BLOCKED: no ${what} from the hub within ${ms} ms`); })]);
  }
  static async open(hub: Hub): Promise<Log> {
    const sock = net.connect(hub.socket);
    const r = new Log(sock);
    await r.reply('hello', 'hello');
    const role = r.reply('role', 'cli role');
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() })}\n`);
    await role;
    await r.call('stream.subscribe', { after: 0 });
    return r;
  }
  async call(method: string, params: Line): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    const reply = this.reply(id, `reply to ${method}`);
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const line = await reply;
    if ('error' in line) throw Error(`${method} refused: ${JSON.stringify(line.error)}`);
    return line.result as Line;
  }
  /** Waits for the event that makes `done` hold, at most `ms`; whether it came. The test's own assertions say what is missing. */
  async until(done: (events: readonly Ev[]) => boolean, ms = 600_000): Promise<boolean> {
    if (done(this.events)) return true;
    let wake = (): void => undefined;
    const came = new Promise<boolean>((resolve) => { wake = () => { if (done(this.events)) resolve(true); }; this.wakers.add(wake); });
    const held = await Promise.race([came, bound(ms).then(() => false)]);
    this.wakers.delete(wake);
    return held;
  }
  close(): void { this.sock.destroy(); }
}

// ---- Claude Code sessions: the process, its transcript and its hooks, run through the real deep-hook.
export interface Ran { code: number | null; stdout: string; stderr: string }
export const shown = (r: Ran): string => `exit ${r.code}, stdout ${JSON.stringify(cut(r.stdout))}, stderr ${JSON.stringify(cut(r.stderr))}`;
const COVERED = (JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions.at(-1)!;
/** What deep-hook's output tells Claude Code: exit 2 or a deny/block decision stops the call; exit 0 with none lets it go. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const d = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || d === 'deny' || d === 'block') return 'deny';
  return r.code === 0 && (d === undefined || d === 'allow') ? 'allow' : 'other';
}
/** One Claude Code process: its children are the sessions' deep-hook runs, shells and `deep mcp`. */
export class Agent {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private constructor(readonly child: ChildProcess) {
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (line && typeof line.n === 'number') { this.pending.get(line.n)?.(line); this.pending.delete(line.n); }
    });
    child.on('exit', () => { for (const done of this.pending.values()) done({ failed: 'the agent process exited', code: null, stdout: '', stderr: '' }); this.pending.clear(); });
  }
  /** `argv` go on its command line, as `claude --resume <id> --fork-session` has them. `env` reaches everything it starts. */
  static start(w: World, env: Record<string, string | undefined> = {}, argv: string[] = []): Agent {
    // argv[0] is `claude`, so a session resumed in a new process reads as Claude Code's own (#1033).
    const child = spawn(NODE, [AGENT, DEEP_HOOK, ...argv], { argv0: 'claude', cwd: w.tmp, env: childEnv(w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', PATH: `${join(w.tmp, 'bin')}:${PATH}`, ...env }), stdio: ['pipe', 'pipe', 'ignore'] });
    children.add(child);
    child.stdin!.on('error', () => undefined);
    return new Agent(child);
  }
  send(command: Line): Promise<Line> {
    const n = ++this.n;
    const answer = new Promise<Line>((done) => this.pending.set(n, done));
    this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    return answer;
  }
  async stop(): Promise<void> {
    this.child.kill('SIGTERM');
    await Promise.race([exitOf(this.child), bound(10_000)]);
  }
}
const said = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });

/** A Claude Code session in one worktree: its transcript, and its hooks fired through deep-hook by its own process. */
export class Session {
  readonly transcript: string;
  prompt: string | undefined;
  private parent: string | null = null;
  /** With `log`, each hook is fired until the record holds its event (`fired`). */
  constructor(readonly w: World, readonly agent: Agent, readonly cwd: string, private readonly log: Log | null = null, readonly id: string = randomUUID()) {
    this.transcript = join(w.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    if (!existsSync(this.transcript)) writeFileSync(this.transcript, '');
  }
  private entry(value: Line): void {
    const uuid = randomUUID();
    const line = { parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.cwd, sessionId: this.id, version: COVERED, gitBranch: 'main' };
    this.parent = uuid;
    writeFileSync(this.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
  }
  /** `deep-hook claude-code <event>`, the hook's JSON on stdin, as a child of the session's own process. */
  async hook(event: string, fields: Line = {}): Promise<Ran> {
    const body = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields };
    return await this.agent.send({ op: 'hook', args: ['claude-code', event], cwd: this.cwd, input: JSON.stringify(body) }) as unknown as Ran;
  }
  /**
   * A hook, fired again until the record holds its event: past its 50 ms budget deep-hook lets the call go and can lose the
   * event (a load of hundreds on this Mac does that), and these tests judge the hub, never the machine's load. Six tries
   * with none recorded are BLOCKED.
   */
  private async fired(event: string, fields: Line, kind: string, match: (e: Ev) => boolean = () => true): Promise<Ran> {
    const from = this.log?.events.length ?? 0;
    for (let n = 1; ; n++) {
      const ran = await this.hook(event, fields);
      if (!this.log || await this.log.until((events) => events.slice(from).some((e) => e.kind === kind && e.session === this.id && match(e)), 20_000)) return ran;
      if (n === 6) throw Error(`BLOCKED: the record holds no ${kind} of the session's ${event} after ${n} tries: ${shown(ran)}`);
    }
  }
  async start(source: 'startup' | 'resume' | 'compact' | 'fork' = 'startup'): Promise<void> {
    this.prompt = undefined;
    const r = await this.fired('SessionStart', { source, model: 'claude-haiku-5-5' }, 'session.start');
    if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook (${source}) must end with exit 0: ${shown(r)}`);
  }
  async typed(text: string): Promise<void> {
    this.prompt = randomUUID();
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: text }, turnPosition: { promptIndex: 0, turnIndex: 1 }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
    const r = await this.fired('UserPromptSubmit', { prompt: text }, 'user.ask');
    if (r.code !== 0) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
  }
  /** One tool call: PreToolUse; when allowed, what the call does (`effect`, its tool response) and PostToolUse. */
  async call(tool_name: string, tool_input: Line, effect: () => Promise<Line> | Line): Promise<{ id: string; before: Ran; response: Line | null }> {
    const id = `toolu_${randomBytes(12).toString('hex')}`;
    this.entry(said([{ type: 'tool_use', id, name: tool_name, input: tool_input }], 'tool_use'));
    const before = await this.fired('PreToolUse', { tool_name, tool_input, tool_use_id: id }, 'tool.before', (e) => e.data.call === id);
    if (decision(before) !== 'allow') return { id, before, response: null };
    const response = await effect();
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    await this.fired('PostToolUse', { tool_name, tool_input, tool_use_id: id, tool_response: response, duration_ms: 40 }, 'tool.after', (e) => e.data.call === id);
    return { id, before, response };
  }
  /** One Bash call, its command run for real by a shell of the session's own process when its PreToolUse allows it. */
  bash(command: string): Promise<{ id: string; before: Ran; response: Line | null }> {
    return this.call('Bash', { command, description: 'Run a command' }, async () => {
      const ran = await this.agent.send({ op: 'bash', command, cwd: this.cwd });
      return { stdout: String(ran.stdout), stderr: String(ran.stderr), interrupted: false, isImage: false, code: ran.code };
    });
  }
  /** Writes a file of the repo whole (Edit), as the agent does. */
  async edit(file: string, bytes: string): Promise<void> {
    const path = join(this.cwd, file);
    const old = readFileSync(path, 'utf8');
    const r = await this.call('Edit', { file_path: path, old_string: old, new_string: bytes, replace_all: false }, () => {
      writeFileSync(path, bytes);
      return { filePath: path, oldString: old, newString: bytes, structuredPatch: [], userModified: false };
    });
    if (!r.response) throw Error(`BLOCKED: the Edit of ${file} must be allowed: ${shown(r.before)}`);
  }
  async stop(): Promise<Ran> {
    this.entry(said([{ type: 'text', text: 'Done.' }], 'end_turn'));
    return this.fired('Stop', { stop_hook_active: false, last_assistant_message: 'Done.' }, 'agent.stop');
  }
  end(): Promise<Ran> { return this.fired('SessionEnd', { reason: 'prompt_input_exit' }, 'session.end'); }
  /** A call of one `deep_*` tool through the session's own `deep mcp`: its whole reply, as text, and whether it's an error. */
  async tool(name: string, args: Line): Promise<{ text: string; error: boolean }> {
    const argv = [NODE, CLI, 'mcp'];
    const ask = async (method: string, params: Line): Promise<Line> => {
      const r = await this.agent.send({ op: 'mcp', argv, line: { jsonrpc: '2.0', id: `${method}-${randomUUID()}`, method, params } });
      if (r.failed) throw Error(`BLOCKED: deep mcp gave no reply to ${method}: ${String(r.failed)}`);
      return r.reply as Line;
    };
    await ask('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-3229', version: '0' } });
    await this.agent.send({ op: 'mcp', argv, line: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    const reply = await ask('tools/call', { name, arguments: args });
    return { text: JSON.stringify(reply.result ?? reply.error), error: reply.error !== undefined || reply.result?.isError === true };
  }
}

// ---- A task: its prompt, its lock, its claims.
/** A session that typed `prompt` and whose task's definition locked; a prompt that locks nothing is BLOCKED. */
export interface Worker { s: Session; task: string; locked: Ev }
export async function open(w: World, r: Log, o: { tree?: number; prompt?: string; env?: Record<string, string | undefined> } = {}): Promise<Worker> {
  const s = new Session(w, Agent.start(w, o.env), w.trees[o.tree ?? 0]!, r);
  await s.start();
  await s.typed(o.prompt ?? PROMPT);
  const taskOf = (events: readonly Ev[]): string | undefined => events.find((e) => e.kind === 'user.ask' && e.session === s.id)?.data.tasks?.[0] as string | undefined;
  const lockOf = (events: readonly Ev[]): Ev | undefined => events.find((e) => e.kind === 'definition.locked' && e.data.task_ref === taskOf(events));
  if (!await r.until((events) => taskOf(events) !== undefined && lockOf(events) !== undefined)) {
    throw Error(`BLOCKED: the prompt opened no task with a locked definition: ${cut(JSON.stringify(r.events.filter((e) => /^(user\.ask|task\.|definition\.)/.test(e.kind)).map((e) => [e.kind, e.data])))}`);
  }
  return { s, task: taskOf(r.events)!, locked: lockOf(r.events)! };
}
export interface RunRead { run: string; claim: string; check: string; outcome: string | null; started: Ev; finished: Ev | null }
export const runsOf = (events: readonly Ev[], claim: string): RunRead[] => events.filter((e) => e.kind === 'run.started' && e.data.claim === claim).map((e) => {
  const f = events.find((x) => x.kind === 'run.finished' && x.data.run === e.data.run) ?? null;
  return { run: String(e.data.run), claim, check: String(e.data.check), outcome: f ? String(f.data.outcome) : null, started: e, finished: f };
});
/** One claim as the record and its verdict line show it. */
export interface Claim { claim: string; made: Ev; runs: RunRead[]; verdicts: Ev[]; outcome: string | null; text: string; stop: Ran }
/**
 * The session writes `source` as src/cart.mjs and stops, which makes a claim on its task; then waits for the claim's
 * verdict. The verdict is read once every run the claim started has ended and either `runs` of its check have, or it
 * already says what `early` looks for (a program that runs no spent variant starts fewer). A claim whose snapshot took
 * longer than the gate's budget ran no check, so it is BLOCKED: the machine stalled, and nothing of the hub's is read.
 */
export async function claim(k: Worker, r: Log, source: string, o: { runs: number; early?: (text: string) => boolean }): Promise<Claim> {
  await k.s.edit(SOURCE, source);
  const before = r.events.length;
  const stop = await k.s.stop();
  const madeOf = (events: readonly Ev[]): Ev | undefined => events.slice(before).find((e) => e.kind === 'claim.made' && e.data.task_ref === k.task);
  if (!await r.until((events) => madeOf(events) !== undefined, 300_000)) throw Error(`BLOCKED: the stop made no claim on ${k.task}: ${shown(stop)}; events ${r.events.slice(before).map((e) => e.kind).join(', ')}`);
  const made = madeOf(r.events)!;
  const id = `claim:${made.id}`;
  const verdicts = (events: readonly Ev[]): Ev[] => events.filter((e) => e.kind === 'verdict.made' && e.subject === id);
  const stalled = (events: readonly Ev[]): boolean => !runsOf(events, id).length && verdicts(events).some((v) => /over budget/.test(JSON.stringify(v.data.reasons)));
  await r.until((events) => {
    if (stalled(events)) return true;
    const v = verdicts(events).at(-1);
    const runs = runsOf(events, id);
    if (!v || runs.some((x) => !x.finished)) return false;
    return runs.filter((x) => x.check === CHECK && x.finished!.log_pos < v.log_pos).length >= o.runs || (o.early?.(JSON.stringify(v.data)) ?? false);
  });
  if (stalled(r.events)) throw Error(`BLOCKED: ${id}'s snapshot went over the gate's budget, so no check of it ran: ${cut(JSON.stringify(verdicts(r.events).map((v) => v.data.reasons)))}`);
  const read = await r.call('changes.read', { id }).catch((error: unknown) => ({ change: { line: `changes.read failed: ${String(error)}` } })) as Line;
  const all = verdicts(r.events);
  const text = `${all.map((v) => JSON.stringify(v.data)).join('\n')}\n${String(read.change?.line ?? '')}\n${String(read.change?.second ?? '')}`;
  return { claim: id, made, runs: runsOf(r.events, id), verdicts: all, outcome: all.length ? String(all.at(-1)!.data.outcome) : null, text, stop };
}
export const shownClaim = (c: Claim): string => `${c.claim} (attempt ${String(c.made.data.attempt)}): outcome ${c.outcome}; verdicts ${cut(JSON.stringify(c.verdicts.map((v) => [v.data.outcome, v.data.reasons])), 900)}; runs ${c.runs.map((x) => `${x.run} ${x.check} ${x.outcome ?? 'running'}`).join(', ') || 'none'}; line ${JSON.stringify(cut(c.text.split('\n').slice(-2).join(' | '), 500))}`;

// ---- A variant's digests: what the store and the record name it by.
const HEX = /\b[0-9a-f]{64}\b/g;
/** The lines of the store's journal. */
export const journal = (w: World): string[] => { try { return readFileSync(join(w.root, 'evidence', 'records.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { return []; } };
/** The digests the store's journal files the requirement's variants under: its lines whose source names R1 (issue, Scope). */
export const journaled = (w: World): string[] => [...new Set(journal(w).flatMap((l) => { const e = parseObject(l); return e && typeof e.sha256 === 'string' && /\bR1\b/.test(String(e.source)) ? [e.sha256 as string] : []; }))];
/** Every 64-hex string under a `held_out` field of the locked definition. */
export function lockedDigests(locked: Ev): string[] {
  const out = new Set<string>();
  const walk = (v: unknown, held: boolean): void => {
    if (typeof v === 'string') { if (held) for (const h of v.match(HEX) ?? []) out.add(h); }
    else if (Array.isArray(v)) for (const x of v) walk(x, held);
    else if (v && typeof v === 'object') for (const [key, x] of Object.entries(v)) { if (held) for (const h of key.match(HEX) ?? []) out.add(h); walk(x, held || /held|variant/i.test(key)); }
  };
  walk(locked.data, false);
  return [...out];
}
/** The digests a session could name each variant by: as the store's journal files it, else as the locked definition holds it. A variant with neither is BLOCKED. */
export function variantDigests(w: World, locked: Ev): string[] {
  const out = journaled(w).length ? journaled(w) : lockedDigests(locked);
  if (!out.length) throw Error(`BLOCKED: neither the store's journal nor the locked definition names the variant by a digest: ${cut(journal(w).join('\n'), 2000)}; ${cut(JSON.stringify(locked.data), 2000)}`);
  return out;
}

// ---- The searches.
/** Every regular file under `dir` whose bytes (a .zst file's unpacked too) hold `text`, or whose own path does. */
export function filesHolding(dir: string, text: string): string[] {
  const out: string[] = [];
  const walk = (at: string): void => {
    let names: string[];
    try { names = readdirSync(at); } catch { return; }
    for (const name of names) {
      const path = join(at, name);
      let kind;
      try { kind = lstatSync(path); } catch { continue; }
      if (path.slice(dir.length).includes(text)) out.push(path);
      if (kind.isDirectory()) walk(path);
      else if (kind.isFile()) {
        let bytes: Buffer;
        try { bytes = readFileSync(path); if (name.endsWith('.zst')) bytes = zstdDecompressSync(bytes); } catch { continue; }
        if (bytes.includes(text)) out.push(path);
      }
    }
  };
  walk(dir);
  return [...new Set(out)];
}

/** Asserts a judgement that holds on the right program fails on the planted one, naming `names`; a BLOCKED setup is rethrown. */
export async function mustFail(what: string, judge: () => unknown, names: string[] = []): Promise<void> {
  let message: string | null = null;
  try { await judge(); } catch (error) {
    message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('BLOCKED:')) throw error;
  }
  expect(message, `${what}: the planted wrong program passed the judgement, so it proves nothing`).not.toBeNull();
  for (const n of names) expect(message, `${what}: the failure must name ${n}`).toContain(n);
}
