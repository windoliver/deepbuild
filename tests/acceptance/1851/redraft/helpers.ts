
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestContext } from 'vitest';
import {
  Conn, askingSession, carries, childEnv, deep, firedShown, own, payload, readSettings, rootOf, shown, sleep, waitFor, waiterEntries,
  type Asking, type Claude, type Entry, type Ev, type Fired, type HookRun, type Hub, type Line, type Ran, type Session,
} from '../../25/routes/helpers.ts';

export const tokenFile = (home: string): string => join(rootOf(home), 'control.token');
export const heldToken = (home: string): string => readFileSync(tokenFile(home), 'utf8').trim();

export async function eventsWith(hub: Hub, token: string): Promise<Ev[]> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(token);
    const out: Ev[] = [];
    for (let after = 0; ;) {
      const page = (await conn.call('events.read', { after, limit: 1000 })).events as Ev[];
      if (!page.length) return out;
      out.push(...page);
      after = page[page.length - 1]!.log_pos;
    }
  } finally {
    conn.close();
  }
}

export function yourHome(hub: Hub, token: string): string {
  const you = join(dirname(hub.home), 'you');
  mkdirSync(rootOf(you), { recursive: true, mode: 0o700 });
  writeFileSync(join(rootOf(you), 'config.json'), `${JSON.stringify({ hub: { address: `unix:${hub.socket}` } })}\n`);
  writeFileSync(join(rootOf(you), 'control.token'), `${token}\n`, { mode: 0o600 });
  return you;
}
export async function answerFrom(home: string, handle: string, option: string): Promise<Ran> {
  const r = await deep(home, ['inbox', 'answer', handle, option]);
  if (r.code !== 0) throw Error(`BLOCKED: deep inbox answer ${handle} ${option} must exit 0: ${shown(r)}`);
  return r;
}

export async function runNow(claude: Claude, pid: number): Promise<HookRun & { event: string }> {
  const found = (await claude.background()).find((r) => r.pid === pid);
  if (!found) throw Error(`BLOCKED: the Claude Code stand-in ${claude.pid} knows no background entry ${pid}`);
  return found;
}
export const runShown = (r: { pid: number; code: number | null; signal: string | null; ended: number | null; stderr: string }): string =>
  `${r.ended === null ? 'still running' : `exited ${r.code}${r.signal ? ` (${r.signal})` : ''}`}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;

export async function stopToIdle(a: Asking): Promise<HookRun> {
  const fired = await a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.' }));
  if (fired.blocked) throw Error(`BLOCKED: nothing is answered yet, so ${a.s.id}'s stop must go through: ${firedShown(fired)}`);
  const live = await waitFor(async () => { const w = await a.claude.liveWaiters(a.s.id); return w.length ? w : undefined; }, 30_000, `the waiter of ${a.s.id}, running once its Stop went through`)
    .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}: ${firedShown(fired)}`); });
  return live[live.length - 1]!;
}
export async function idleSession(hub: Hub, home: string): Promise<{ a: Asking; waiter: HookRun }> {
  const a = await askingSession(hub, home);
  return { a, waiter: await stopToIdle(a) };
}

export const stopWaiter = (home: string): Entry => waiterEntries(readSettings(home)).stop;

export async function waiterUnder(claude: Claude, entry: Entry, body: Line): Promise<HookRun> {
  const settings = join(dirname(claude.home), `waiter-only-${claude.pid}.json`);
  writeFileSync(settings, `${JSON.stringify({ hooks: { Stop: [{ hooks: [entry.hook] }] } })}\n`);
  const fired = (await (claude as unknown as { send(command: Line): Promise<Line> }).send({ op: 'hook', event: 'Stop', payload: body, settings })) as unknown as Fired;
  const run = fired.background.find((r) => r.asyncRewake);
  if (!run) throw Error(`BLOCKED: the Claude Code stand-in ${claude.pid} started no waiter from ${settings}: ${firedShown(fired)}`);
  return run;
}

export interface Outsider { pid: number; started: number; ended: number | null; code: number | null; signal: string | null; stderr: string; stdout: string }
export function outsiderWaiter(home: string, entry: Entry, s: Session): Outsider {
  const command = String(entry.hook.command);
  const child = spawn('/bin/sh', ['-c', /^\s*exec\s/.test(command) ? command : `exec ${command}`], { cwd: s.cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  const run: Outsider = { pid: child.pid!, started: Date.now(), ended: null, code: null, signal: null, stderr: '', stdout: '' };
  child.stdout.setEncoding('utf8').on('data', (d: string) => (run.stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d: string) => (run.stderr += d));
  child.stdin.on('error', () => undefined);
  child.stdin.end(JSON.stringify(payload(s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.' })));
  child.on('close', (code, signal) => Object.assign(run, { code, signal, ended: Date.now() }));
  return run;
}

export const tookAnswer = (r: { code: number | null; stderr: string }, a: Asking): boolean => r.code === 2 || carries(r.stderr, a.green);

export interface Mark { pos: number; out: number }
export async function markNow(hub: Hub, token: string): Promise<Mark> {
  return { pos: Math.max(0, ...(await eventsWith(hub, token)).map((e) => e.log_pos)), out: hub.output().length };
}
function holdsRefusal(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(holdsRefusal);
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Line;
  return (typeof o.code === 'string' && typeof o.remediation === 'string') || Object.values(o).some(holdsRefusal);
}
export interface Said { where: string; text: string }
export async function refusalsSince(hub: Hub, token: string, mark: Mark, waiterStderr: string): Promise<Said[]> {
  const said: Said[] = [];
  if (waiterStderr.trim()) said.push({ where: "the refused waiter's stderr", text: waiterStderr });
  for (const text of hub.output().slice(mark.out).split('\n')) if (text.trim()) said.push({ where: "the hub's output", text });
  for (const e of await eventsWith(hub, token)) {
    if (e.log_pos > mark.pos && (/refus/i.test(e.kind) || holdsRefusal(e.data))) said.push({ where: `the record's ${e.kind} ${e.id}`, text: JSON.stringify(e) });
  }
  return said;
}
export const namesPid = (text: string, pid: number): boolean => new RegExp(`(?<![0-9])${pid}(?![0-9])`).test(text);
export const saidShown = (said: readonly Said[]): string => (said.length ? said.map((s) => `${s.where}: ${s.text.slice(0, 600)}`).join('\n') : 'nothing: no stderr from the waiter, no line from the hub, no refusal in the record');

export async function settle(done: () => boolean | Promise<boolean>, from: number, atLeastMs: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await done()) && Date.now() < deadline) await sleep(100);
  while (Date.now() < from + atLeastMs) await sleep(100);
}

export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;
export function judgeWithin(ctx: TestContext, what: string, ms: number, limitMs: number): void {
  const text = `${what}: ${ms.toFixed(0)} ms against ${limitMs} ms`;
  console.log(text);
  if (ms <= limitMs) return;
  if (loadavg()[0]! > availableParallelism()) ctx.skip(`INCONCLUSIVE ${text}, read at ${loadReading()}`);
  throw Error(`FAIL ${text}, at ${loadReading()}`);
}

export function removeToken(home: string): void {
  rmSync(tokenFile(home));
  if (existsSync(tokenFile(home))) throw Error(`BLOCKED: ${tokenFile(home)} is still there after its removal`);
}
