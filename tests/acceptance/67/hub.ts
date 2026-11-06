// Test-side tools for the #67 suites on the real hub (README): a temp world (a home with the shipped default guards and
// your settings, a plain folder that is no repo, the definitions the kernel is handed and the test work source's
// readings), `deep hub run`, `deep workspace` and `deep inbox answer` as processes, the record read back through the
// hub's socket, and Claude Code sessions driven through the real deep-hook binary. Adapted from
// tests/acceptance/322/helpers.ts (same repo, same license); this suite keeps its own copy so a redraft of theirs
// never moves these tests. Nothing here stands in for DeepBuild: the test only plays Claude Code. Processes are stopped
// by PID only, and every folder is under /tmp/dh67-*, a Unix socket path having to fit in 104 bytes on macOS.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AC1 = 'AC1 #67.04ad1434';
export const AC2 = 'AC2 #67.a680fef7';
export const AC3 = 'AC3 #67.798381ee';
export const AC4 = 'AC4 #67.b151d718';
export const AC5 = 'AC5 #67.550dd2c3';
export const AC6 = 'AC6 #67.4a8b02f5';
export const AC7 = 'AC7 #67.bb36d821';
export const AC8 = 'AC8 #67.5080f53e';
export const AC9 = 'AC9 #67.7e6414d6';
export const AC10 = 'AC10 #67.458f2e6a';
export const AC11 = 'AC11 #67.b3d12369';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
const FACTS = join(REPO, 'adapters/claude-code.facts.json');
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const tag = (n = 4) => randomBytes(n).toString('hex');
const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
/** The newest Claude Code version the facts cover: every transcript entry carries it, so no session is watch-only. */
const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
export function must(ok: boolean, message: string): asserts ok {
  if (!ok) throw Error(message);
}

// ---- Temp folders and the processes this suite started.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh67-'));
  made.push(dir);
  return dir;
}
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

/** The environment a child gets: HOME the test's home, and no DEEP_/GIT_/XDG_/CLAUDE settings or keys of this process's. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|GIT_|CLAUDE|ANTHROPIC_|OPENAI_|CODEX_|GH_|GITHUB_|AWS_)/.test(key) || key === 'NODE_OPTIONS') continue;
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
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 60_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(-600))}`;

// ---- The definitions the kernel is handed (README), and the test work source.
export interface Requirement { id: string; text: string; source_line: string; refuted_by: string; check: string | null; on_base: 'fails' | 'passes'; asserts: string[]; depth: string; oracle: 'code' | 'model' | 'person'; near_misses: string[]; reads?: string[]; targets?: string[] }
/** A definition handed for an ask, by the prompt's exact text, or for a work item, by its source_id. `files` and `touches` are what the drafting job wrote, for a task that lands in a new workspace (README). */
export interface Draft { ask?: string; issue?: string; requirements: Requirement[]; deliverables: string[]; budget: null; files?: Record<string, string>; touches?: Touch[] }
export interface Reading { source_id: string; link: string; title: string; body: string; criteria: string[]; authors: { handle: string; role: 'owner' | 'collaborator' | 'outside' }[]; updated: string }
/** A requirement; `reads` names the touches of the workspace its check reads. By default its check isn't one for a fix, so it may pass on the base commit too. */
export const req = (id: string, text: string, o: Partial<Requirement> = {}): Requirement => ({
  id, text, source_line: 'ask#L1', refuted_by: `a run where ${text.toLowerCase()} does not hold`, check: null, on_base: 'passes', asserts: [], depth: 'unit', oracle: 'code', near_misses: [], ...o,
});
export const draft = (ask: string, requirements: Requirement[], o: Partial<Draft> = {}): Draft => ({ ask, requirements, deliverables: [], budget: null, ...o });
/** A drafted check's file, under the `.deepbuild/` guard, as a requirement names it. */
export const CHECK = (name: string): string => `.deepbuild/checks/${name}.sh`;
/** Where its assertion is. */
export const ASSERTS = (name: string): string => `.deepbuild/checks/${name}.test.js:2`;
/**
 * A drafted check and the node:test file it runs, whose one assertion holds `condition`: JavaScript over `fs` and
 * `state(touch)`, what the check's checkout holds of a touch it reads, by item (README).
 */
export const nodeCheck = (name: string, condition: string): Record<string, string> => ({
  [CHECK(name)]: `#!/bin/sh\n# Drafted check.\nnode --test .deepbuild/checks/${name}.test.js\n`,
  [`.deepbuild/checks/${name}.test.js`]: `const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), state = (touch) => JSON.parse(fs.readFileSync(\`.deepbuild/state/\${touch}.json\`, 'utf8'));\ntest('${name}', () => { assert.ok(${condition}); });\n`,
});

const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
export interface World { tmp: string; home: string; root: string; outside: string; confirm: string; drafts: string; work: string }
/**
 * `<tmp>/h` is HOME for every process, its `.deepbuild` holding the shipped default guards and your settings;
 * `<tmp>/outside` is a plain folder inside no repo. `<tmp>/confirm` says `confirmed` (DEEP_HUB_TEST_CONFIRM), and
 * `drafts.json` and `work.json` are DEEP_HUB_TEST_DRAFTS and DEEP_HUB_TEST_WORK. Git has no identity in this home: a
 * person never needs to set one up.
 */
export function makeWorld(o: { drafts?: Draft[]; readings?: Reading[] } = {}): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ oauthAccount: { accountUuid: 'acct-dh67-0001', emailAddress: 'you@example.test' }, numStartups: 3 }, null, 2)}\n`);
  const outside = join(tmp, 'outside');
  mkdirSync(outside);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const drafts = join(tmp, 'drafts.json');
  const work = join(tmp, 'work.json');
  const w: World = { tmp, home, root, outside, confirm, drafts, work };
  handDrafts(w, o.drafts ?? []);
  writeFileSync(work, `${JSON.stringify({ readings: o.readings ?? [] }, null, 2)}\n`);
  return w;
}
/** Hands the kernel these definitions; the hub reads the file at each task. */
export function handDrafts(w: World, drafts: Draft[]): void {
  writeFileSync(w.drafts, `${JSON.stringify({ drafts }, null, 2)}\n`);
}
/** Git as this test runs it, with an identity of the test's own: DeepBuild's own commits have to manage without one. */
export function git(w: World, cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: w.home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  }).trim();
}

// ---- The hub as a process.
export interface Hub { pid: number; socket: string; root: string; child: ChildProcess; exit: Promise<void>; stderr(): string }
/** `deep hub run` with its test settings; `plant` is DEEP_HUB_PLANT. A hub that doesn't start, as with a plant the base doesn't list, is BLOCKED. */
export async function startHub(w: World, o: { plant?: string } = {}): Promise<Hub> {
  const env = childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_WORK: w.work, DEEP_HUB_PLANT: o.plant });
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
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), root: w.root, child, exit, stderr: () => err };
}

/** One call on the hub's socket as the cli role, with the control token. */
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
/** One event as `events.read` returns it. */
export interface Ev { v?: number; id: string; kind: string; log_pos: number; ts: number; writer?: string; subject?: string; session?: string; project?: string; data: Line }
export async function allEvents(hub: Hub): Promise<Ev[]> {
  const out: Ev[] = [];
  let after = 0;
  for (;;) {
    const read = await control(hub, 'events.read', { after, limit: 1000 });
    const events = (typeof read.events === 'string' ? JSON.parse(read.events) : read.events) as Ev[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos;
  }
}
/** Reads the log until `done` holds, or `timeoutMs` passes; resolves with the last read either way, so a test's own assertions say what is missing. */
export async function settle(hub: Hub, done: (events: Ev[]) => boolean, timeoutMs = 30_000): Promise<Ev[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = await allEvents(hub);
    if (done(events) || Date.now() > deadline) return events;
    await sleep(200);
  }
}
export const lastPos = (events: readonly Ev[]): number => events.at(-1)?.log_pos ?? 0;
const said = (e: Ev): string => `${e.kind} at log_pos ${e.log_pos} ${JSON.stringify(e.data).slice(0, 500)}`;
export const listed = (events: readonly Ev[]): string => events.map(said).join('; ') || 'none';

/** The task a prompt opened, as its user.ask names it. */
export function taskOf(events: readonly Ev[], s: Session, text: string): string | undefined {
  const ask = events.find((e) => e.kind === 'user.ask' && e.session === s.id && e.data.text === text);
  return Array.isArray(ask?.data.tasks) && ask!.data.tasks.length === 1 ? String(ask!.data.tasks[0]) : undefined;
}
export const locked = (events: readonly Ev[], ref: string | undefined): Ev | undefined => events.find((e) => e.kind === 'definition.locked' && e.data.task_ref === ref);
export const claimsOf = (events: readonly Ev[], ref: string | undefined, since = 0): Ev[] => events.filter((e) => e.kind === 'claim.made' && e.log_pos > since && e.data.task_ref === ref);
export const claimHandle = (claim: Ev): string => `claim:${claim.id}`;
export const verdictsOf = (events: readonly Ev[], claim: string, since = 0): Ev[] => events.filter((e) => e.kind === 'verdict.made' && e.log_pos > since && e.data.claim === claim);
export const runsAfter = (events: readonly Ev[], since: number): Ev[] => events.filter((e) => e.kind === 'run.started' && e.log_pos > since);
export const finishOf = (events: readonly Ev[], run: Ev): Ev | undefined => events.find((e) => e.kind === 'run.finished' && e.data.run === run.data.run);

// ---- `deep`, as you run it: the OS confirmation stubbed, so a trusted-path call counts.
export const deep = (w: World, args: readonly string[], cwd = w.tmp): Promise<Ran> =>
  run(NODE, [CLI, ...args], { env: childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm }), cwd, timeoutMs: 120_000 });
/** A `deep workspace` command's one line of JSON (README); anything else fails the test, naming the command. */
export async function workspace(w: World, ...args: string[]): Promise<Line> {
  const r = await deep(w, ['workspace', ...args]);
  must(r.code === 0, `\`deep workspace ${args.join(' ')}\` must exit 0: ${shown(r)}`);
  const line = parseObject(r.stdout.trim());
  must(line !== undefined, `\`deep workspace ${args.join(' ')}\` must print one line of JSON: ${shown(r)}`);
  return line;
}
export interface Workspace { id: string; folder: string; name: string }
export async function newWorkspace(w: World, topic: string, ...flags: string[]): Promise<Workspace> {
  return (await workspace(w, 'new', topic, ...flags)) as Workspace;
}
/** A touch: what a workspace names that it touches, its id, the state source that reads it and that source's settings (README). */
export interface Touch { id: string; source: 'git' | 'host'; log?: string; [setting: string]: unknown }
/** What a drafting job and the agent keep in a workspace: files, written and committed, and the touches its `.deepbuild/workspace.json` names. */
export function fill(w: World, ws: Workspace, files: Record<string, string>, touches: Touch[] = []): string {
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(ws.folder, path)), { recursive: true });
    writeFileSync(join(ws.folder, path), bytes, { mode: path.endsWith('.sh') ? 0o755 : 0o644 });
  }
  const named = join(ws.folder, '.deepbuild', 'workspace.json');
  if (touches.length) writeFileSync(named, `${JSON.stringify({ ...(JSON.parse(readFileSync(named, 'utf8')) as Line), touches }, null, 2)}\n`);
  git(w, ws.folder, ['add', '-A']);
  git(w, ws.folder, ['commit', '-q', '-m', 'set up']);
  return git(w, ws.folder, ['rev-parse', 'HEAD']);
}
/** Your answer on the trusted path: `deep inbox answer <ask> <option>`, the OS confirming you. */
export const answer = (w: World, ask: Ev, option: string): Promise<Ran> => deep(w, ['inbox', 'answer', `ask:${ask.id}`, option]);

// ---- A host's change log (README): one JSON line per change, an item's value being the last line that names it.
export function hostLog(w: World, name: string, items: Record<string, unknown>): string {
  const log = join(w.tmp, `${name}.changes.jsonl`);
  writeFileSync(log, '');
  for (const [item, value] of Object.entries(items)) changed(log, item, value);
  return log;
}
export function changed(log: string, item: string, value: unknown): void {
  writeFileSync(log, `${JSON.stringify({ id: `c-${tag()}`, item, value })}\n`, { flag: 'a' });
}

// ---- Each session's Claude Code (fixtures/agent.mjs): one long-lived process per session, the parent of every
// deep-hook run of that session, as Claude Code is of its hook commands, so `deep inbox answer`, run by this test
// process, is outside every session's process tree, as your terminal is.
class Agent {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Ran) => void>();
  private constructor(child: ChildProcess, private readonly send: (line: string) => void) {
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
  static start(w: World, cwd: string): Agent {
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: cwd }), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Agent(child, (line) => child.stdin!.write(line));
  }
  run(args: readonly string[], cwd: string, input: string, timeoutMs: number): Promise<Ran> {
    const n = ++this.n;
    return new Promise((resolve) => {
      this.pending.set(n, resolve);
      this.send(`${JSON.stringify({ n, args, cwd, input, timeoutMs })}\n`);
    });
  }
}
const agents = new Map<string, Agent>();

/** What deep-hook's output tells Claude Code: exit 2 or a deny/block decision stops the call (or the stop). */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const d = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || d === 'deny' || d === 'block') return 'deny';
  if (r.code === 0 && (d === undefined || d === 'allow')) return 'allow';
  return 'other';
}
/** A block's reason and the line the chat shows, as one text to search. */
export function replyText(r: Ran): string {
  const out = parseObject(r.stdout.trim());
  const reason = typeof out?.reason === 'string' ? out.reason : typeof out?.hookSpecificOutput?.permissionDecisionReason === 'string' ? out.hookSpecificOutput.permissionDecisionReason : r.code === 2 ? r.stderr : '';
  const message = typeof out?.systemMessage === 'string' ? out.systemMessage : '';
  return `${reason}\n${message}`.trim();
}

let calls = 0;
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, output_tokens: 2 } } });

/** A Claude Code session: its transcript, its own Claude Code process, and its hooks fired through deep-hook. */
export class Session {
  readonly id = randomUUID();
  readonly transcript: string;
  private prompt: string | undefined;
  private parent: string | null = null;
  private turn = 0;
  constructor(w: World, readonly cwd: string) {
    this.transcript = join(w.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
    agents.set(this.id, Agent.start(w, cwd));
  }
  private entry(value: Line): void {
    const uuid = randomUUID();
    const line = { parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.cwd, sessionId: this.id, version: COVERED, gitBranch: 'main' };
    this.parent = uuid;
    writeFileSync(this.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
  }
  private async hook(event: string, fields: Line = {}, timeoutMs = 150_000): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields };
    return agents.get(this.id)!.run(['claude-code', event], this.cwd, JSON.stringify(body), timeoutMs);
  }
  async start(): Promise<void> {
    const r = await this.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook must end with exit 0: ${shown(r)}`);
  }
  /** A prompt you typed. */
  async typed(text: string): Promise<Ran> {
    this.prompt = randomUUID();
    this.turn += 1;
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: text }, turnPosition: { promptIndex: 0, turnIndex: this.turn }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
    const r = await this.hook('UserPromptSubmit', { prompt: text });
    if (r.code !== 0 && r.code !== 2) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
    return r;
  }
  /** One tool call: when PreToolUse allows it, `effect` runs and PostToolUse fires. */
  async call(tool_name: string, tool_input: Line, o: { response?: Line; effect?: () => void } = {}): Promise<{ allowed: boolean; before: Ran }> {
    const id = `toolu_${randomBytes(10).toString('hex')}${++calls}`;
    this.entry(assistant([{ type: 'tool_use', id, name: tool_name, input: tool_input }], 'tool_use'));
    const before = await this.hook('PreToolUse', { tool_name, tool_input, tool_use_id: id });
    if (decision(before) !== 'allow') return { allowed: false, before };
    o.effect?.();
    const response = o.response ?? { stdout: '', stderr: '', interrupted: false, isImage: false };
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    await this.hook('PostToolUse', { tool_name, tool_input, tool_use_id: id, tool_response: response, duration_ms: 40 });
    return { allowed: true, before };
  }
  /** The agent writes a file, by its absolute path; a denied write is BLOCKED. */
  async write(path: string, content: string): Promise<void> {
    const r = await this.call('Write', { file_path: path, content }, {
      response: { type: 'create', filePath: path, content, structuredPatch: [] },
      effect: () => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); },
    });
    if (!r.allowed) throw Error(`BLOCKED: the Write of ${path} must be allowed: ${shown(r.before)}`);
  }
  bash(command: string, effect?: () => void): Promise<{ allowed: boolean; before: Ran }> {
    return this.call('Bash', { command, description: command.slice(0, 40) }, effect ? { effect } : {});
  }
  /** The agent's last words of the turn, then Stop. */
  async stop(words = 'Done.'): Promise<Ran> {
    this.entry(assistant([{ type: 'text', text: words }], 'end_turn'));
    return this.hook('Stop', { stop_hook_active: false, last_assistant_message: words });
  }
}
