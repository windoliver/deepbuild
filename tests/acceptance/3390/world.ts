// The world of the #3390 acceptance tests: a real hub (`deep hub run`) in a temp home, test plug-ins installed through
// `deep install`, one or two agent stand-ins (#363's fixtures/agent.mjs) working in one git repo, and the person's side
// (`deep inbox answer`, and the hub's socket on a cli connection with the control token). Nothing of the hub, the asks
// core or the CLI is imported here: what a test reads is an MCP reply, the record (`events.read`), the inbox
// (`inbox.read`), a card (`ask.card`) or a `deep` command's exit.
//
// What #363's hub.ts and helpers.ts export is reused: the agent stand-in and its session, the plug-in copier, temp
// folders and IDs. This file adds what #363 doesn't need: a hub that is stopped and started again on the same home, a
// second agent in the same repo, the socket's other methods, and the PreToolUse an agent's hook sends before each call,
// which is how a session is known again to a hub that just started.
//
// Safety: every folder is under /tmp (363's tempDir); HOME is the test's own for every child; no variable of git's, of
// this agent's or of DeepBuild's reaches a child; and a process is stopped only through the handle it was started with,
// never by name or port.

import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, vi } from 'vitest';
import { Agent, CLI, NODE, REPO, type Hub, type Line, type Outcome, type Session } from '../363/hub.ts';
import { host, requestId, tempDir } from '../363/helpers.ts';

export { pkg, requestId } from '../363/helpers.ts';
export type { Line, Outcome } from '../363/hub.ts';

/** One test may start a hub twice on a machine whose load is often above 150. */
export const TEST_MS = 600_000;
/** How long a poll waits for what the record or a started hub must come to. */
const WAIT = { timeout: 120_000, interval: 250 };

for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];

const parse = (text: string): Line | undefined => { try { return JSON.parse(text) as Line; } catch { return undefined; } };
export const brief = (value: unknown, length = 700): string => (JSON.stringify(value) ?? String(value)).slice(0, length);

/** This environment with HOME moved to the test's home, and nothing of this agent's, DeepBuild's or git's in it. */
function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(?:DEEP_|XDG_|TMUX|CLAUDE|CODEX|GIT_)/.test(key) || key === 'NODE_OPTIONS' || key === 'AI_AGENT') continue;
    env[key] = value;
  }
  return Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra });
}

// ---- The repo the sessions work in: a git repo of its own, never this checkout, with the repo's spec.
const DONE_YAML = [
  'claims:',
  '  done:',
  '    checks: [unit]',
  'checks:',
  '  unit: { type: command, run: "false" }',
  'asks:',
  '  deadline: { taste: 3d, authority: 1d, unblock: 2d, exception: 2d, choice: 2d, definition: 4h }',
  '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
  '  fallback: [change-owner]',
  '',
].join('\n');
function makeRepo(dir: string): string {
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), DONE_YAML);
  const env = childEnv(dir, { GIT_CONFIG_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: dirname(dir), GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return realpathSync(dir);
}

// ---- The hub.
interface Running extends Hub { child: ChildProcess; exited: Promise<void> }
const running = new Set<Running>();

async function startHub(home: string): Promise<Running> {
  const confirm = join(dirname(home), 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const hub: Running = { pid: child.pid!, home, socket: join(home, '.deepbuild', 'hub.sock'), output: () => out, child, exited };
  running.add(hub);
  void exited.then(() => running.delete(hub));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    // deadline: a hub that never says it is ready fails here.
    const timer = setTimeout(() => resolve(false), 180_000);
    const end = (ok: boolean): void => { clearTimeout(timer); resolve(ok); };
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) end(parse(first.split('\n')[0]!)?.ready === true);
    });
    child.once('exit', () => end(false));
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start: ${out.slice(0, 2000)}`);
  return hub;
}

/** SIGTERM to a hub this file started, and the wait for it to exit; a hub that won't is killed, and says so. */
async function stop(hub: Running): Promise<boolean> {
  if (!running.has(hub)) return true;
  hub.child.kill('SIGTERM');
  let clean = true;
  // deadline: a hub that won't stop is killed.
  const timer = setTimeout(() => { clean = false; hub.child.kill('SIGKILL'); }, 120_000);
  await hub.exited;
  clearTimeout(timer);
  return clean;
}

// Each test's hub stops with it, so no test runs beside another's.
afterEach(async () => {
  for (const hub of [...running]) await stop(hub);
}, 150_000);

// ---- The world.
/** A session of an agent stand-in, with its own hooks and its own MCP servers, children of its own process. */
export interface Actor { agent: Agent; session: Session }
export interface World {
  home: string;
  repo: string;
  /** The hub running now: another process after a restart, on the same home. */
  hub: Running;
  /** The session of the first agent. */
  a: Actor;
  /** Every session opened in the world, the first among them. */
  actors: Actor[];
  /** The plug-ins' action names, which a hub that has loaded them offers. */
  actions: string[];
}

function deep(home: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(NODE, [CLI, ...args], { cwd: REPO, env: childEnv(home), timeout: 240_000 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, out: `${stdout}${stderr}` });
    });
  });
}

/** A hub with `packages` installed as a person installs them, and one agent's session in a git repo. */
export async function openWorld(packages: string[]): Promise<World> {
  const tmp = tempDir('3390');
  const home = join(tmp, 'h');
  mkdirSync(home);
  const repo = makeRepo(join(tmp, 'work'));
  const hub = await startHub(home);
  for (const dir of packages) {
    const r = await deep(home, ['install', dir]);
    if (r.code !== 0) throw Error(`BLOCKED: deep install ${dir} exited ${r.code}: ${r.out.slice(0, 1500)}`);
  }
  const w = { home, repo, hub, actors: [], actions: [] } as unknown as World;
  w.a = await openSession(w);
  w.actions = await offered(w.a);
  if (!w.actions.length) throw Error('BLOCKED: the installed plug-ins offer no action');
  return w;
}

/** A session of another agent process in the world's repo: its own thread, its own hooks and MCP servers. */
export async function openSession(w: World): Promise<Actor> {
  const agent = Agent.start(w.home, w.repo);
  const session = agent.session(w.repo);
  await agent.establish(w.hub, session);
  await agent.initialize('deep-actions');
  const actor = { agent, session };
  w.actors.push(actor);
  return actor;
}

async function offered(a: Actor): Promise<string[]> {
  const o = await a.agent.callTool('deep-actions', 'find_actions', { query: null });
  if (o.isError) throw Error(`BLOCKED: find_actions failed: ${brief(o.reply)}`);
  return (o.value.actions as { action: string }[]).map((x) => x.action).sort();
}

/**
 * The hub stopped (SIGTERM) and started again on the same home. The agents and their MCP servers run on: each agent's
 * next hook makes its session known to the new hub, and each server says hello to it at its next call. It returns once
 * the plug-ins the hub had loaded are offered again.
 */
export async function restartHub(w: World): Promise<void> {
  if (!await stop(w.hub)) throw Error(`BLOCKED: the hub didn't stop on SIGTERM: ${w.hub.output().slice(-1500)}`);
  w.hub = await startHub(w.home);
  for (const { agent, session } of w.actors) await agent.hook(w.hub, session, 'PreToolUse');
  await vi.waitFor(async () => {
    const now = await offered(w.a);
    if (JSON.stringify(now) !== JSON.stringify(w.actions)) throw Error(`BLOCKED: after the restart the hub offers ${brief(now)}, not ${brief(w.actions)}`);
  }, WAIT);
}
/** The hub stopped for good: its record is then free to open. */
export async function stopHub(w: World): Promise<void> {
  if (!await stop(w.hub)) throw Error(`BLOCKED: the hub didn't stop on SIGTERM: ${w.hub.output().slice(-1500)}`);
}

// ---- An action call, as a session's agent makes it.
export interface Call { action: string; request: string; input: Record<string, unknown> }
export const callOf = (action: string, input: Record<string, unknown>): Call => ({ action, request: requestId(), input });
/** The call as a failure names it. */
export const named = (c: Call): string => `the call of ${c.action} under request ${c.request} with ${JSON.stringify(c.input)}`;

/**
 * `call_action` from the session's own deep-actions server. A PreToolUse comes first, as the agent's hook sends one before
 * each tool call: a hub that just started knows the session by it, and a call on a connection whose process a loaded
 * machine didn't name in time binds to its session by it, for which it names the tool as the hub stamps its own tools.
 * A connection the hub didn't answer within a second was never a call (deep mcp says nothing was recorded), so that one
 * is made again; anything else is the call's answer.
 */
export async function call(w: World, a: Actor, c: Call): Promise<Outcome> {
  const args = { action: c.action, request: c.request, input: JSON.stringify(c.input) };
  await a.agent.hook(w.hub, a.session, 'PreToolUse', { tool_name: 'mcp__deep__call_action', tool_input: args });
  return vi.waitFor(async () => {
    const o = await a.agent.callTool('deep-actions', 'call_action', args, 90_000);
    if (o.isError && o.value?.code === 'unavailable' && /unreachable \(no answer on its socket\)/.test(String(o.value.remediation))) throw Error(`BLOCKED: the hub gave ${named(c)} no connection: ${brief(o.reply)}`);
    if (o.isError && o.value?.code === 'unbound') throw Error(`BLOCKED: ${named(c)} bound to no session: ${brief(o.reply)}`);
    return o;
  }, WAIT);
}

export interface Held extends Call { ask: string }
/** A change's or a send's first call, held by an ask. */
export async function hold(w: World, a: Actor, action: string, input: Record<string, unknown>): Promise<Held> {
  const c = callOf(action, input);
  const o = await call(w, a, c);
  expect(o.isError, `${named(c)} comes back held, not an error: ${brief(o.reply)}`).toBe(false);
  expect(o.value?.status, `${named(c)} is held by an ask: ${brief(o.value)}`).toBe('held');
  expect(String(o.value.ask), `${named(c)} names its ask`).toMatch(/^ask:[0-9A-Za-z]+$/);
  return { ...c, ask: String(o.value.ask) };
}
/** A call that must come back done, and did run: its reply. */
export async function runsOn(w: World, a: Actor, c: Call, why: string): Promise<Outcome> {
  const o = await call(w, a, c);
  expect({ isError: o.isError, status: o.value?.status }, `${named(c)} ${why}: ${brief(o.reply)}`).toEqual({ isError: false, status: 'done' });
  return o;
}
/** How often each change or send handler of a test plug-in ran in its current load (its `runs` read, which asks nothing). */
export async function runs(w: World, a: Actor, plugin: 'stocks' | 'desk' = 'stocks'): Promise<Record<string, number>> {
  const o = await call(w, a, callOf(`ext.${plugin}.runs`, {}));
  if (o.isError) throw Error(`BLOCKED: the runs read failed: ${brief(o.reply)}`);
  return o.value.output as Record<string, number>;
}

// ---- The person's side.
/** One call on the hub's socket, as the cli role holding the control token. */
async function rpc(w: World, method: string, params: Line): Promise<Line> {
  const token = readFileSync(join(w.home, '.deepbuild', 'control.token'), 'utf8').trim();
  const sock = net.connect(w.hub.socket);
  const lines: Line[] = [];
  let wake = (): void => undefined;
  let buffer = '';
  sock.setEncoding('utf8').on('data', (chunk: string) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      lines.push(parse(buffer.slice(0, i)) ?? {});
      buffer = buffer.slice(i + 1);
    }
    wake();
  });
  sock.on('error', () => wake());
  const line = (pred: (l: Line, i: number) => boolean): Promise<Line> => new Promise((resolve, reject) => {
    // deadline: a hub that gives no answer on its socket fails here.
    const timer = setTimeout(() => reject(Error(`BLOCKED: the hub gave ${method} no answer on its socket`)), 120_000);
    wake = () => {
      const found = lines.find(pred);
      if (found) { clearTimeout(timer); resolve(found); }
    };
    wake();
  });
  try {
    await line((_, i) => i === 0);
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
    const hello = await line((_, i) => i === 1);
    if (hello.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${brief(hello)}`);
    sock.write(`${JSON.stringify({ v: 1, id: 't3390', method, params })}\n`);
    const reply = await line((l) => l.id === 't3390');
    if (reply.error) throw Error(`the hub refused ${method}: ${brief(reply.error)}`);
    return reply.result as Line;
  } finally {
    sock.destroy();
  }
}

/** Every event in the hub's record, in log order. */
export async function events(w: World): Promise<Line[]> {
  const all: Line[] = [];
  for (let after = 0; ;) {
    const page = (await rpc(w, 'events.read', { after, limit: 1000 })).events as Line[];
    if (!page.length) return all;
    all.push(...page);
    after = page[page.length - 1]!.log_pos as number;
  }
}
export interface Row { ask: string; session: string; status: string; outcome: string; closed_at: number | null; decision: string | null; question: string }
/** The inbox's asks raised in a session: every open one, and the newest settled. */
export async function inbox(w: World, a: Actor): Promise<Row[]> {
  return ((await rpc(w, 'inbox.read', {})).asks as Row[]).filter((r) => r.session === a.session.id);
}
/** An ask as the inbox has it: `open`, or how it closed, with the decision that closed it. */
export async function stateOf(w: World, a: Actor, ask: string): Promise<string> {
  const row = (await inbox(w, a)).find((r) => r.ask === ask);
  if (!row) return 'in no inbox';
  return row.closed_at === null ? 'open' : `${row.outcome}${row.decision ? ` by ${row.decision}` : ''}`;
}
export const openAsksOf = async (w: World, a: Actor): Promise<string[]> => (await inbox(w, a)).filter((r) => r.closed_at === null).map((r) => r.ask);
/** The question card's document. */
export const card = (w: World, ask: string): Promise<Line> => rpc(w, 'ask.card', { ask });
/** `deep inbox answer <ask> <option>`, the person's answer; the OS confirmation is its test stand-in. */
export async function answer(w: World, ask: string, option: 'approve' | 'decline'): Promise<void> {
  const r = await deep(w.home, ['inbox', 'answer', ask, option]);
  if (r.code !== 0) throw Error(`BLOCKED: deep inbox answer ${ask} ${option} exited ${r.code}: ${r.out.slice(0, 1500)}`);
}
/** Your answer to an ask that must still be open: an ask that closed meanwhile takes none, and the failure says why. */
export async function answerOpen(w: World, a: Actor, ask: string, option: 'approve' | 'decline', why: string): Promise<void> {
  const r = await deep(w.home, ['inbox', 'answer', ask, option]);
  expect(r.code, `${why}: ${ask} takes your ${option}, but \`deep inbox answer\` said ${brief(r.out)}; it is ${await stateOf(w, a, ask)}`).toBe(0);
}
/** `decision.overrule`: a saved decision taken out of force, on the trusted path. */
export async function overrule(w: World, decision: string): Promise<void> {
  const said = await rpc(w, 'decision.overrule', { decision });
  if (said.overruled !== decision) throw Error(`BLOCKED: decision.overrule ${decision} answered ${brief(said)}`);
}

// ---- The record read back.
export const lastPos = (all: Line[]): number => (all.length ? all[all.length - 1]!.log_pos as number : 0);
export const entered = (all: Line[], c: Call): unknown[] => all.filter((e) => e.kind === 'action.entered' && e.data?.request === c.request).map((e) => e.data.input);
/** The asks a session raised, in order, those after a log position. */
export const raised = (all: Line[], a: Actor, after = 0): string[] => all.filter((e) => e.kind === 'ask.created' && e.session === a.session.id && e.log_pos > after).map((e) => `ask:${e.id}`);
/** The decisions saved from an ask, as the record names them. */
export const savedFrom = (all: Line[], ask: string): Line[] => all.filter((e) => e.kind === 'decision.created' && (e.data?.ask === ask || e.subject === ask));
export interface Applied { decision: string; ask: string }
export const applied = (all: Line[]): Applied[] => all.filter((e) => e.kind === 'decision.applied').map((e) => ({ decision: String(e.data?.decision), ask: String(e.data?.ask) }));

/** Your answer to a change's ask, and the decision saved from it for the session's repo: its handle. */
export async function answerAndSave(w: World, held: Held, option: 'approve' | 'decline'): Promise<string> {
  await answer(w, held.ask, option);
  const saved = await vi.waitFor(async () => {
    const [found] = savedFrom(await events(w), held.ask);
    if (!found) throw Error(`BLOCKED: your ${option} to ${held.ask}, a change's ask in a git repo's session, saved no decision`);
    return found;
  }, WAIT);
  if (saved.data.answer !== option || !String(saved.data.scope).startsWith('repo:')) throw Error(`BLOCKED: your ${option} to ${held.ask} saved ${brief(saved.data)}, not ${option} for the repo`);
  return `decision:${saved.id}`;
}

/**
 * The ask of `c` is open, and is still open once the hub has served another call of the session and settled its states:
 * no saved decision closed it, at once or a little later.
 */
export async function expectStaysOpen(w: World, a: Actor, c: Call, ask: string, plugin: 'stocks' | 'desk' = 'stocks'): Promise<void> {
  for (const when of ['at once', 'once the hub served another call'] as const) {
    if (when !== 'at once') await runs(w, a, plugin);
    const decided = applied(await events(w)).filter((d) => d.ask === ask).map((d) => d.decision);
    expect({ ask: await stateOf(w, a, ask), decided }, `${named(c)} is held by ${ask}, which waits for your own answer and stays open (${when}): ${c.action}'s ask isn't decided for you`).toEqual({ ask: 'open', decided: [] });
  }
}

// ---- The desk plug-in: two change actions of one plug-in (AC3).
export async function deskPkg(): Promise<string> {
  const dir = tempDir('pkg-desk');
  cpSync(fileURLToPath(new URL('./fixtures/desk/', import.meta.url)), dir, { recursive: true });
  for (const entry of readdirSync(dir)) if (entry.endsWith('.fixture')) renameSync(join(dir, entry), join(dir, entry.slice(0, -'.fixture'.length)));
  const path = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Line;
  const { packageDigest } = await host();
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

export const SET_ALERT = 'ext.stocks.set_alert';
export const SEND = 'ext.stocks.send_digest';
