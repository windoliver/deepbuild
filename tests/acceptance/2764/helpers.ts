
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
export const FACTS = join(REPO, 'adapters/codex.facts.json');
export const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));

export const AC = '#2764.d93a7447';
export const PLANT = 'proceed-ends-at-subagent-prompt';

export type Line = { [key: string]: any };
// deadline: only bounds a wait for an event or a process exit, so a hang fails the test instead of hanging it
export const deadline = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms).unref(); });
export const tag = (n = 4) => randomBytes(n).toString('hex');
export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;

export class Inconclusive extends Error {}
export async function verdict(ctx: TestContext, judge: () => Promise<void>): Promise<void> {
  try {
    await judge();
  } catch (error) {
    if (error instanceof Inconclusive) ctx.skip(`INCONCLUSIVE ${error.message}`);
    throw error;
  }
}
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

const made: string[] = [];
const owned = new Set<number>();
const exits: Promise<unknown>[] = [];
export function own(pid: number | undefined, exit: Promise<unknown>): void {
  if (!pid) return;
  owned.add(pid);
  exits.push(exit);
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
export async function cleanup(): Promise<void> {
  for (const pid of owned) {
    try { process.kill(pid, 'SIGCONT'); } catch { }
    try { process.kill(pid, 'SIGTERM'); } catch { }
  }
  await Promise.race([Promise.all(exits.splice(0)), deadline(3000)]);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { }
  owned.clear();
  agents.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
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

const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
export interface World { tmp: string; home: string; root: string; repo: string; confirm: string; codexHome: string }
export function makeWorld(): World {
  const tmp = realpathSync(mkdtempSync('/tmp/dh2764-'));
  made.push(tmp);
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  const codexHome = join(home, '.codex');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(codexHome, 'sessions'), { recursive: true });
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
  return { tmp, home, root, repo: realpathSync(repo), confirm, codexHome };
}
export function writeSorter(w: World, rule: string, proceed: string[]): string {
  const file = join(w.tmp, 'sorter.json');
  writeFileSync(file, `${JSON.stringify({ rule, proceed }, null, 2)}\n`);
  return file;
}

export interface Hub { pid: number; socket: string; root: string; exit: Promise<void>; stderr(): string; seen(): number; past(n: number): Promise<void>; close(): void }
export async function startHub(w: World, o: { plant?: string | undefined; sorter: string }): Promise<Hub> {
  const env = childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_PLANT: o.plant, DEEP_HUB_TEST_SORTER: o.sorter });
  const child: ChildProcess = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  own(child.pid, exit);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!));
      });
    }),
    exit.then(() => undefined),
    deadline(120_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub${o.plant ? ` with the plant DEEP_HUB_PLANT=${o.plant}` : ''} did not start: ${err.slice(-1500)}`);
  const socket = String(ready.socket);
  return { pid: Number(ready.pid), socket, root: w.root, exit, stderr: () => err, ...follow(socket, w.root) };
}
export async function stopHub(hub: Hub): Promise<void> {
  hub.close();
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  await Promise.race([hub.exit, deadline(30_000)]);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { }
  await hub.exit;
}

function connect(socket: string, root: string, method: string, params: Line, onLine: (line: Line | undefined) => void): net.Socket {
  const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
  const sock = net.connect(socket);
  let buffer = '';
  let step = 0;
  sock.setEncoding('utf8');
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
      } else if (step === 2) onLine(line);
    }
  });
  return sock;
}
function control(hub: Hub, method: string, params: Line, timeoutMs = 30_000): Promise<Line> {
  return new Promise((resolve, reject) => {
    const sock = connect(hub.socket, hub.root, method, params, (line) => {
      if (line?.id !== 1) return;
      sock.destroy();
      if (line.error) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`));
      else resolve(line.result as Line);
    });
    sock.on('error', reject);
    void deadline(timeoutMs).then(() => { sock.destroy(); reject(Error(`no reply to ${method} within ${timeoutMs} ms`)); });
  });
}
function follow(socket: string, root: string): { seen(): number; past(n: number): Promise<void>; close(): void } {
  let count = 0;
  let waiting: { n: number; wake: () => void }[] = [];
  const sock = connect(socket, root, 'stream.subscribe', { after: 0 }, (line) => {
    if (line?.event === undefined) return;
    count++;
    const due = waiting.filter((w) => count > w.n);
    waiting = waiting.filter((w) => count <= w.n);
    for (const w of due) w.wake();
  });
  sock.on('error', () => undefined);
  return {
    seen: () => count,
    past: (n) => (count > n ? Promise.resolve() : new Promise<void>((resolve) => { waiting.push({ n, wake: () => resolve() }); })),
    close: () => sock.destroy(),
  };
}
export async function waitFor<T>(hub: Hub, ms: number, look: () => Promise<T | undefined>, also?: Promise<unknown>): Promise<T | undefined> {
  const end = deadline(ms).then(() => false);
  let settled = also === undefined;
  const other = also?.then(() => { settled = true; return true; });
  for (;;) {
    const seen = hub.seen();
    const found = await look();
    if (found !== undefined) return found;
    const woke = await Promise.race([hub.past(seen).then(() => true), end, ...(settled || !other ? [] : [other])]);
    if (!woke) return look();
  }
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
export async function asksNaming(hub: Hub, since: number, name: string): Promise<Ev[]> {
  return (await allEvents(hub)).filter((e) => e.kind === 'ask.created' && e.log_pos > since && String(e.data?.question ?? '').includes(name));
}
export const handleOf = (ask: Ev) => `ask:${ask.id}`;

class Agent {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Ran) => void>();
  private readonly runs = new Map<number, Promise<Ran>>();
  private readonly child: ChildProcess;
  constructor(w: World) {
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w.home), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid, new Promise<void>((resolve) => child.on('exit', () => resolve())));
    child.stdin!.on('error', () => undefined);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = parseObject(this.buffer.slice(0, i));
        this.buffer = this.buffer.slice(i + 1);
        if (!line || typeof line.n !== 'number') continue;
        if ('pid' in line && !('code' in line)) { own(Number(line.pid), this.runs.get(line.n) ?? Promise.resolve()); continue; }
        const done = this.pending.get(line.n);
        this.pending.delete(line.n);
        this.runs.delete(line.n);
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
  run(args: readonly string[], cwd: string, input: string, timeoutMs: number): Promise<Ran> {
    const n = ++this.n;
    const ran = new Promise<Ran>((resolve) => {
      this.pending.set(n, resolve);
      this.child.stdin!.write(`${JSON.stringify({ n, args, cwd, input, timeoutMs })}\n`);
    });
    this.runs.set(n, ran);
    return ran;
  }
}
const agents = new Map<string, Agent>();

export interface Session { id: string; cwd: string; transcript: string; turn: string }
export function newSession(w: World): Session {
  const id = randomUUID();
  const now = new Date();
  const day = now.toISOString().slice(0, 10).replace(/-/g, '/');
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
  const transcript = join(w.codexHome, 'sessions', day, `rollout-${stamp}-${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, `${JSON.stringify({ timestamp: now.toISOString(), type: 'session_meta', payload: { session_id: id, id, timestamp: now.toISOString(), cwd: w.repo, originator: 'codex_cli_rs', cli_version: COVERED, source: 'cli' } })}\n`);
  agents.set(id, new Agent(w));
  return { id, cwd: w.repo, transcript, turn: randomUUID() };
}
function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, model: 'gpt-reserve', permission_mode: 'default' };
  if (event === 'SessionStart') base.source = 'startup';
  else base.turn_id = s.turn;
  return { ...base, ...extra };
}
function fire(s: Session, body: Line, timeoutMs = 150_000): Promise<Ran> {
  return agents.get(s.id)!.run(['codex', String(body.hook_event_name)], s.cwd, JSON.stringify(body), timeoutMs);
}
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
export async function sessionStart(s: Session): Promise<void> {
  const r = await fire(s, payload(s, 'SessionStart'));
  if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook must end with exit 0: ${shown(r)}`);
}
export async function typed(s: Session, text: string): Promise<void> {
  s.turn = randomUUID();
  const r = await fire(s, payload(s, 'UserPromptSubmit', { prompt: text }));
  if (r.code !== 0) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
}
let calls = 0;
const callId = () => `call_${randomBytes(10).toString('hex')}${++calls}`;
export async function work(s: Session): Promise<void> {
  const rel = `src/fix${++calls}.ts`;
  const body = `export const fixed${calls} = true;`;
  const input = { command: `*** Begin Patch\n*** Add File: ${rel}\n+${body}\n*** End Patch\n` };
  const id = callId();
  const r = await fire(s, payload(s, 'PreToolUse', { tool_name: 'apply_patch', tool_input: input, tool_use_id: id }));
  if (decision(r) !== 'allow') throw Error(`BLOCKED: the turn's apply_patch adding ${rel} must be allowed: ${shown(r)}`);
  writeFileSync(join(s.cwd, rel), `${body}\n`);
  await fire(s, payload(s, 'PostToolUse', { tool_name: 'apply_patch', tool_input: input, tool_use_id: id, tool_response: 'Success. Updated the following files:\nA ' + rel + '\n' }));
}
export async function expectProceed(hub: Hub, s: Session, question: string, rule: string, who: string): Promise<Ev> {
  const since = await lastPos(hub);
  const r = await fire(s, payload(s, 'Stop', { stop_hook_active: false, last_assistant_message: question }));
  if (decision(r) === 'allow' && /deep-hook: (could not spool|spooled)/.test(r.stderr)) throw new Inconclusive(`${who} the stop that ends on "${question}" was let go unheld because the hub's acknowledgement came after deep-hook stopped waiting for it (${shown(r)}), so no proceed could reach it; read at ${loadReading()}`);
  const found = await waitFor(hub, 30_000, async () => {
    const events = (await allEvents(hub)).filter((e) => e.log_pos > since);
    const proceeded = events.find((e) => e.kind === 'question.proceeded' && String(e.data?.question ?? '') === question && e.data?.rule === rule);
    return proceeded && { proceeded, events };
  });
  if (!found) throw Error(`BLOCKED: ${who} the planted sorter's proceed for "${question}" must be recorded as question.proceeded with rule ${rule}: 30 s after the stop, none is; the stop's reply was ${shown(r)}`);
  const asked = found.events.filter((e) => e.kind === 'ask.created' && String(e.data?.question ?? '').includes(question));
  must(!asked.length, `BLOCKED: a "proceed" is not an ask: "${question}" was answered proceed, yet ${asked.map(handleOf).join(', ')} asks it`);
  must(decision(r) === 'deny' && /proceed/i.test(`${r.stdout}\n${r.stderr}`), `BLOCKED: the stop's reply must carry the proceed for "${question}" (a Stop block whose reason says proceed): ${shown(r)}; read at ${loadReading()}`);
  return found.proceeded;
}
export async function subagentPrompt(hub: Hub, s: Session, child: string, prompt: string): Promise<void> {
  const start = await fire(s, payload(s, 'SubagentStart', { agent_id: child, agent_type: 'worker' }));
  if (start.code !== 0) throw Error(`BLOCKED: the subagent's SubagentStart hook must end with exit 0: ${shown(start)}`);
  const since = await lastPos(hub);
  const r = await fire(s, payload(s, 'UserPromptSubmit', { prompt, agent_id: child, agent_type: 'worker', turn_id: randomUUID() }));
  if (r.code !== 0) throw Error(`BLOCKED: the subagent's UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
  const prompts = async () => (await allEvents(hub)).filter((e) => e.log_pos > since && e.kind === 'user.ask');
  const mine = await waitFor(hub, 30_000, async () => (await prompts()).find((e) => String(e.data?.text ?? '') === prompt));
  if (mine?.data?.from === 'subagent') return;
  throw Error(`BLOCKED: the Codex subagent's prompt must reach the record as the session's user.ask with from 'subagent': ${mine ? `it is recorded with from ${JSON.stringify(mine.data?.from)}` : `30 s after it, the record's prompts since are ${JSON.stringify((await prompts()).map((e) => e.data))}`}; the hook ended ${shown(r)}`);
}

export interface Pending { id: string; done: Promise<Ran>; result?: Ran }
export function bash(s: Session, command: string): Pending {
  const id = callId();
  const p: Pending = { id, done: Promise.resolve(undefined as unknown as Ran) };
  p.done = fire(s, payload(s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: id })).then((r) => { p.result = r; return r; });
  return p;
}
async function late(hub: Hub, id: string): Promise<boolean> {
  const before = await waitFor(hub, 10_000, async () => (await allEvents(hub)).find((e) => e.kind === 'tool.before' && e.data?.call === id));
  return before?.data.late === true;
}
export async function notRun(hub: Hub, p: Pending, label: string, who: string): Promise<void> {
  if (!p.result || decision(p.result) !== 'allow') return;
  if (await late(hub, p.id)) throw new Inconclusive(`${who} \`${label}\` was let through because the hub's acknowledgement came after deep-hook stopped waiting for it (${shown(p.result)}), so the hub never decided it; read at ${loadReading()}`);
  throw Error(`${who} \`${label}\` ran in the turn the proceed started, after the Codex subagent's prompt, with no authority ask: deep-hook allowed it at PreToolUse with nothing held (${shown(p.result)})`);
}
