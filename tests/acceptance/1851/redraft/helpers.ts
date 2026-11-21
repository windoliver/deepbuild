// Test-side tools for the #1851 acceptance tests (redraft). The hub in a temporary home, `deep setup`, the Claude Code
// stand-in whose hooks, `deep mcp` and waiter are its children, an asking session and `deep inbox answer` come from the
// Claude Code delivery suite (../../25/routes/helpers.ts and its fixtures/claude.mjs); this file adds what #1851's
// criteria need beside them: the control token held as the app holds it, a home of yours that reaches the hub with the
// token file gone from the hub's root, a waiter run by one session's Claude Code with another session's Stop payload, a
// waiter run by this test process (no agent above it), and where a refusal is read. No hub, CLI or deep-hook module is
// imported; processes are stopped by PID only (../../25/routes/helpers.ts, cleanup).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestContext } from 'vitest';
import {
  Conn, askingSession, carries, childEnv, deep, firedShown, own, payload, readSettings, rootOf, shown, sleep, waitFor, waiterEntries,
  type Asking, type Claude, type Entry, type Ev, type Fired, type HookRun, type Hub, type Line, type Ran, type Session,
} from '../../25/routes/helpers.ts';

/** The file the issue names: `~/.deepbuild/control.token`, under the test's home. */
export const tokenFile = (home: string): string => join(rootOf(home), 'control.token');
/** The control token, read once while the file is there and held in memory from then on, as the app holds it. */
export const heldToken = (home: string): string => readFileSync(tokenFile(home), 'utf8').trim();

/** Every event in the log through `events.read`, on a cli connection presenting the held token (the file may be gone). */
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

/**
 * A home of yours beside the session's, `<tmp>/you`: its `.deepbuild/config.json` names the hub's socket (`hub.address`,
 * the design's "Your hub, wherever it runs") and its `.deepbuild/control.token` holds the token you held before the
 * file was removed from the hub's root. `deep inbox answer` run with this HOME is you answering; no process of the
 * session's tree ever has this HOME.
 */
export function yourHome(hub: Hub, token: string): string {
  const you = join(dirname(hub.home), 'you');
  mkdirSync(rootOf(you), { recursive: true, mode: 0o700 });
  writeFileSync(join(rootOf(you), 'config.json'), `${JSON.stringify({ hub: { address: `unix:${hub.socket}` } })}\n`);
  writeFileSync(join(rootOf(you), 'control.token'), `${token}\n`, { mode: 0o600 });
  return you;
}
/** Your answer with `deep inbox answer`, HOME `home`; BLOCKED unless it exits 0. `ended` is when the command exited: your answer accepted. */
export async function answerFrom(home: string, handle: string, option: string): Promise<Ran> {
  const r = await deep(home, ['inbox', 'answer', handle, option]);
  if (r.code !== 0) throw Error(`BLOCKED: deep inbox answer ${handle} ${option} must exit 0: ${shown(r)}`);
  return r;
}

/** A background run of the stand-in, as it stands now, by the PID the stand-in started it with. */
export async function runNow(claude: Claude, pid: number): Promise<HookRun & { event: string }> {
  const found = (await claude.background()).find((r) => r.pid === pid);
  if (!found) throw Error(`BLOCKED: the Claude Code stand-in ${claude.pid} knows no background entry ${pid}`);
  return found;
}
export const runShown = (r: { pid: number; code: number | null; signal: string | null; ended: number | null; stderr: string }): string =>
  `${r.ended === null ? 'still running' : `exited ${r.code}${r.signal ? ` (${r.signal})` : ''}`}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;

/**
 * The session's Stop, fired by its own Claude Code: nothing is answered, so the hold ends and the Stop goes through;
 * the session is idle and the waiter Claude Code started at that Stop is running. Gives that waiter's run.
 */
export async function stopToIdle(a: Asking): Promise<HookRun> {
  const fired = await a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.' }));
  if (fired.blocked) throw Error(`BLOCKED: nothing is answered yet, so ${a.s.id}'s stop must go through: ${firedShown(fired)}`);
  const live = await waitFor(async () => { const w = await a.claude.liveWaiters(a.s.id); return w.length ? w : undefined; }, 30_000, `the waiter of ${a.s.id}, running once its Stop went through`)
    .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}: ${firedShown(fired)}`); });
  return live[live.length - 1]!;
}
/** An asking session of its own Claude Code, stopped and idle, with its own waiter running. */
export async function idleSession(hub: Hub, home: string): Promise<{ a: Asking; waiter: HookRun }> {
  const a = await askingSession(hub, home);
  return { a, waiter: await stopToIdle(a) };
}

/** DeepBuild's waiter entry under Stop, as `deep setup` wrote it into the home's Claude Code settings. */
export const stopWaiter = (home: string): Entry => waiterEntries(readSettings(home)).stop;

/**
 * The waiter entry run by `claude`'s process, as Claude Code runs a Stop entry (`/bin/sh -c <command>`, the payload on
 * stdin, in the payload's cwd, its own process group, in the background), with `body` as the Stop payload: the
 * stand-in's own `hook` command (../../25/routes/fixtures/claude.mjs: `{op:'hook', event, payload, settings}`) given a
 * settings file that holds the waiter's entry alone, so nothing else of a Stop runs. The Claude class sends that
 * command only with the home's settings file, so this reaches its sender directly.
 */
export async function waiterUnder(claude: Claude, entry: Entry, body: Line): Promise<HookRun> {
  const settings = join(dirname(claude.home), `waiter-only-${claude.pid}.json`);
  writeFileSync(settings, `${JSON.stringify({ hooks: { Stop: [{ hooks: [entry.hook] }] } })}\n`);
  const fired = (await (claude as unknown as { send(command: Line): Promise<Line> }).send({ op: 'hook', event: 'Stop', payload: body, settings })) as unknown as Fired;
  const run = fired.background.find((r) => r.asyncRewake);
  if (!run) throw Error(`BLOCKED: the Claude Code stand-in ${claude.pid} started no waiter from ${settings}: ${firedShown(fired)}`);
  return run;
}

/** A waiter this test process started: under no agent. */
export interface Outsider { pid: number; started: number; ended: number | null; code: number | null; signal: string | null; stderr: string; stdout: string }
/**
 * The waiter entry's command run by this test process, with `s`'s Stop payload on stdin, in its cwd, HOME the session's
 * home: `/bin/sh -c <command>`, the command beginning with `exec` (as setup writes it, or added here), so the shell becomes the waiter and the process whose PID this gives is the one
 * that says hello. Its parent is this vitest worker: it is no child, and no descendant, of any session's agent.
 */
export function outsiderWaiter(home: string, entry: Entry, s: Session): Outsider {
  // Setup's entry already begins with `exec` where the shell is to become deep-hook; one that doesn't gets it here.
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

/** Whether a waiter's run handed over the answer: it exited 2, or its stderr carries the option you picked. */
export const tookAnswer = (r: { code: number | null; stderr: string }, a: Asking): boolean => r.code === 2 || carries(r.stderr, a.green);

// ---- Where a refusal is read (README: Readings, 3).
/** A point in the hub's log and output, taken before the process that is to be refused starts. */
export interface Mark { pos: number; out: number }
export async function markNow(hub: Hub, token: string): Promise<Mark> {
  return { pos: Math.max(0, ...(await eventsWith(hub, token)).map((e) => e.log_pos)), out: hub.output().length };
}
/** Whether a value holds a refusal of the shared shape (error@2: a `code` and a `remediation`), at any depth. */
function holdsRefusal(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(holdsRefusal);
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Line;
  return (typeof o.code === 'string' && typeof o.remediation === 'string') || Object.values(o).some(holdsRefusal);
}
export interface Said { where: string; text: string }
/**
 * Everything a refusal of that process can be read from, since `mark`: the refused waiter's own stderr; each line the
 * hub wrote to its stdout or stderr; and each event the record gained that is a refusal (its kind says refused, or its
 * data holds an error@2 refusal).
 */
export async function refusalsSince(hub: Hub, token: string, mark: Mark, waiterStderr: string): Promise<Said[]> {
  const said: Said[] = [];
  if (waiterStderr.trim()) said.push({ where: "the refused waiter's stderr", text: waiterStderr });
  for (const text of hub.output().slice(mark.out).split('\n')) if (text.trim()) said.push({ where: "the hub's output", text });
  for (const e of await eventsWith(hub, token)) {
    if (e.log_pos > mark.pos && (/refus/i.test(e.kind) || holdsRefusal(e.data))) said.push({ where: `the record's ${e.kind} ${e.id}`, text: JSON.stringify(e) });
  }
  return said;
}
/** Whether a text names a process by its PID: the number, with no digit on either side. */
export const namesPid = (text: string, pid: number): boolean => new RegExp(`(?<![0-9])${pid}(?![0-9])`).test(text);
export const saidShown = (said: readonly Said[]): string => (said.length ? said.map((s) => `${s.where}: ${s.text.slice(0, 600)}`).join('\n') : 'nothing: no stderr from the waiter, no line from the hub, no refusal in the record');

/**
 * Waits until `done()` or `timeoutMs`, and in any case until `atLeastMs` after `from` (epoch ms): the bounded time in
 * which an answer that must never arrive would have.
 */
export async function settle(done: () => boolean | Promise<boolean>, from: number, atLeastMs: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await done()) && Date.now() < deadline) await sleep(100);
  while (Date.now() < from + atLeastMs) await sleep(100);
}

// ---- The issue's 2 s (README: Readings, 5).
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;
/**
 * PASS within the limit. A miss on a machine whose 1-minute load is over its core count is INCONCLUSIVE (the test is
 * skipped, saying so, with the reading and the load), never PASS; a miss on a machine that isn't is a FAIL.
 */
export function judgeWithin(ctx: TestContext, what: string, ms: number, limitMs: number): void {
  const text = `${what}: ${ms.toFixed(0)} ms against ${limitMs} ms`;
  console.log(text);
  if (ms <= limitMs) return;
  if (loadavg()[0]! > availableParallelism()) ctx.skip(`INCONCLUSIVE ${text}, read at ${loadReading()}`);
  throw Error(`FAIL ${text}, at ${loadReading()}`);
}

/** Removes the hub's control.token file; BLOCKED if it is still there. */
export function removeToken(home: string): void {
  rmSync(tokenFile(home));
  if (existsSync(tokenFile(home))) throw Error(`BLOCKED: ${tokenFile(home)} is still there after its removal`);
}
