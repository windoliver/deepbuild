// Test-side tools for #1810 (README). One fixture record per world, made the way the hub makes one: a real hub (`deep
// hub run` in a temp HOME) takes a session's first turn over its socket (its Stop makes the session's claim); with that
// hub stopped, the record and asks core seed its title and its asks (one taken by its default); a real hub starts on it
// again, and the asks the fixture answers are answered through the real `deep inbox answer`.
// Every reader is the real one: the status answer is the hub's reply to a person's "anything for me?" over the hook
// protocol; `deep` and `deep status --json` are the built CLI; the app's list is the rows the app folds (`row.set`
// events, read through `events.read`) and, on macOS, the real replica (`deep-drive`, `launch.from: "record_copy"`).
//
// Reused by import: #16's hub, socket, hooks, sessions, temp folders and PID cleanup; #26's record seeding through the
// real record and asks core. The replica's driver is adapted from tests/acceptance/1463/helpers.ts (same repo, same
// license), kept here so a redraft of that suite never moves these tests.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was
// started with; no test touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  allEvents, childEnv, cleanup as cleanup16, control, deep as deep16, hookRequest, makeHome, newSession, own, REPO, sendHook, sleep,
  startHub, stopHub, tempDir, type Ev, type Hub, type Ran, type Session,
} from '../16/helpers.ts';
import { cleanup as cleanup26, seed, sha256, ulid } from '../26/helpers.ts';

export { REPO, sleep, stopHub, type Ev, type Hub, type Ran };

/** The criteria, by `#1810.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  count: '#1810.eebcb4a2',
  defaulted: '#1810.a646c123',
  width: '#1810.1a3e8cda',
} as const;

/** #83's width: the narrowest chat, 80 columns (packages/verdicts LINE_WIDTH). */
export const WIDTH = 80;
/** The planted reader criterion 2 names (README, Pinned 1): the hub's status answer counting a defaulted ask that can still be undone. */
export const PLANT_COUNTS_DEFAULTED = 'needs-you-counts-defaulted';
/** The status question the issue types. */
export const QUESTION = 'anything for me?';

export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const cleanup = async (): Promise<void> => { await cleanup16(); await cleanup26(); };
const MINUTE = 60_000;
const DAY = 86_400_000;
const columns = (s: string): number => [...s].length;

const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
/** The CLI and deep-hook must be built: a test that can't run them is BLOCKED, never a pass. */
export function needBuilds(): void {
  if (!existsSync(join(REPO, 'packages/cli/dist/main.js'))) blocked('no built CLI at packages/cli/dist/main.js; run npm run build --workspaces first');
  if (!existsSync(target('deep-hook'))) blocked('no deep-hook under target/debug; run cargo build --locked -p deep-hook first');
}

// ---- The fixture (README, The fixture).

/** An ask of the session's: left open, answered through `deep inbox answer` once the hub is up, or taken by its default before. */
export interface AskSpec { question: string; options: [string, string][]; default: string; then: 'open' | 'answer' | 'default' }
export interface WorldSpec {
  title: string;
  asks: AskSpec[];
  /** DEEP_HUB_PLANT for the hub the readers read. */
  plant?: string;
}
export interface FixtureAsk { handle: string; question: string; then: AskSpec['then'] }
export interface World { home: string; hub: Hub; s: Session; agent: number; asks: FixtureAsk[] }

/** Waits until the hub's log stops growing for `quietMs`; its last log_pos. */
export async function quiet(hub: Hub, quietMs = 1500, timeoutMs = 30_000): Promise<number> {
  const conn = await control(hub);
  try {
    const deadline = Date.now() + timeoutMs;
    let last = -1;
    let since = Date.now();
    for (;;) {
      const page = (await conn.call('events.read', { after: Math.max(last, 0), limit: 1000 })).result as { events: Ev[] } | undefined;
      const pos = page?.events.at(-1)?.log_pos ?? last;
      if (pos !== last) { last = pos; since = Date.now(); }
      if (Date.now() - since >= quietMs || Date.now() > deadline) return last;
      await sleep(200);
    }
  } finally {
    conn.close();
  }
}
export async function eventsOf(hub: Hub): Promise<Ev[]> {
  const conn = await control(hub);
  try { return await allEvents(conn); } finally { conn.close(); }
}

/** One hook of the session's, from its agent process, through the hub's socket as deep-hook sends it. */
async function hook(hub: Hub, s: Session, agent: number, event: string, extra: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const r = await sendHook(hub.socket, { ...hookRequest(s, event, extra), pid: agent, ppid: agent }, 60_000);
  if (!r.ack) blocked(`the hub didn't acknowledge ${event}: ${JSON.stringify(r).slice(0, 600)}`);
  return r.reply ?? {};
}

/**
 * A world on `spec`: a git folder and one Claude Code session in it, its first turn (SessionStart, a prompt, one call,
 * its Stop) through a hub from a `sleep` stand-in process; then, with that hub stopped, its title (task.created) and its
 * asks through the record and asks core, an ask marked `default` taken by its default (`tick`), so it can still be
 * undone; then a real hub again (with the plant, if any), and each ask marked `answer` answered with its first option
 * through `deep inbox answer`.
 */
export async function makeWorld(spec: WorldSpec): Promise<World> {
  needBuilds();
  const home = makeHome();
  const root = join(home, '.deepbuild');
  const base = tempDir();
  const confirm = join(base, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const env = { DEEP_HUB_TEST_CONFIRM: confirm };
  const repo = join(base, 'shop');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: repo } });
  const s = newSession(home, 'claude-code', repo);
  const sleeper = spawn('/bin/sleep', ['7200'], { stdio: 'ignore' });
  own(sleeper.pid);
  const agent = sleeper.pid!;
  let hub = await startHub({ home, env });
  await hook(hub, s, agent, 'SessionStart');
  await hook(hub, s, agent, 'UserPromptSubmit', { prompt: `work on ${spec.title}` });
  const call = { tool_name: 'Bash', tool_use_id: 'toolu_1810_0', tool_input: { command: 'npm test' } };
  await hook(hub, s, agent, 'PreToolUse', call);
  await hook(hub, s, agent, 'PostToolUse', { ...call, tool_response: { stdout: 'ok', stderr: '', interrupted: false } });
  await hook(hub, s, agent, 'Stop');
  await quiet(hub);
  const events = await eventsOf(hub);
  await stopHub(hub);
  const project = (events.find((e) => e.kind === 'session.start' && e.session === s.id) as (Ev & { project?: string }) | undefined)?.project;
  const asks: FixtureAsk[] = [];
  const at = Date.now() - 30 * MINUTE;
  await seed(home, async (sd) => {
    sd.at(at);
    const who = { actor: 'you', scope: 'you', session: s.id, ...(project ? { project } : {}) };
    await sd.record.append({ writer: 'app', ...who }, { v: 1, id: ulid(at), kind: 'task.created', ts: at, data: { task_ref: `task:${ulid(at)}`, thread: s.id, owner: 'you', title: spec.title } });
    for (const a of spec.asks) {
      const handle = await sd.asks.raise({ writer: 'core', ...who }, 'deep_ask.choice', {
        kind: 'choice', question: a.question, options: a.options.map(([id, label]) => ({ id, label, decision: 'none' })), recommended: a.default,
        deadline: a.then === 'default' ? at + MINUTE : at + 2 * DAY, fallback: 'you', default: a.default, provisional: false, owner: 'you',
        key: sha256(`#1810 ${a.question}`), pinned_to: { kind: 'evidence', ref: sha256(a.question) },
      });
      asks.push({ handle, question: a.question, then: a.then });
    }
    if (asks.some((a) => a.then === 'default')) {
      sd.at(at + 2 * MINUTE);
      await sd.asks.tick();
    }
  }, at);
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(root, 'setup-finished.json'), JSON.stringify({ version }));
  try {
    hub = await startHub({ home, env, ...(spec.plant ? { plant: spec.plant } : {}) });
  } catch (error) {
    blocked(`the hub didn't start${spec.plant ? ` with DEEP_HUB_PLANT=${spec.plant} (README, Pinned 1)` : ''}: ${(error as Error).message.slice(0, 600)}`);
  }
  await quiet(hub);
  for (const a of asks.filter((x) => x.then === 'answer')) {
    const option = spec.asks.find((x) => x.question === a.question)!.options[0]![0];
    const r = await deep({ home }, ['inbox', 'answer', a.handle, option]);
    if (r.code !== 0) blocked(`deep inbox answer ${a.handle} ${option} must exit 0 (the fixture answers it): ${shown(r)}`);
  }
  await quiet(hub);
  return { home, hub, s, agent, asks };
}

// ---- The readers.

export function deep(w: { home: string }, args: readonly string[], plant?: string): Promise<Ran> {
  return deep16(w.home, args, { env: { DEEP_HUB_PLANT: plant }, timeoutMs: 120_000 });
}
export const shown = (r: Ran): string => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(0, 2500))}, stderr ${JSON.stringify(r.stderr.slice(0, 800))}`;

/**
 * The status answer: "anything for me?" typed by a person into the world's session (its transcript entry says so, as
 * Claude Code writes one, and the prompt hook carries its prompt ID), answered by the hub over the hook protocol. The
 * answer is the reason of the reply that blocks the prompt (Claude Code shows it, and the prompt never reaches the model),
 * or, when an answer waits for the agent at this prompt, the reply's systemMessage beside it.
 */
export async function statusAnswer(w: World, question = QUESTION): Promise<string> {
  const promptId = randomUUID();
  const entry = {
    parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: w.s.id, cwd: w.s.cwd, userType: 'external', entrypoint: 'cli',
    promptId, type: 'user', message: { role: 'user', content: question }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human',
  };
  writeFileSync(w.s.transcript, `${JSON.stringify(entry)}\n`, { flag: 'a' });
  const reply = await hook(w.hub, w.s, w.agent, 'UserPromptSubmit', { prompt: question, prompt_id: promptId });
  let out: Record<string, any> | undefined;
  try { out = typeof reply.stdout === 'string' ? (JSON.parse(reply.stdout) as Record<string, any>) : undefined; } catch { out = undefined; }
  // An answer or a send-back waiting for the agent at this prompt goes on with it, and the status rides beside it
  // where the chat shows it, the reply's systemMessage (#83).
  const answer = out?.decision === 'block' && typeof out.reason === 'string' ? out.reason : typeof out?.systemMessage === 'string' ? out.systemMessage : undefined;
  if (answer === undefined) expect.fail(`"${question}" typed by a person must be answered from the record (the prompt hook's reply blocks it with the answer, or shows it beside what waits for the agent): ${JSON.stringify(reply).slice(0, 1200)}`);
  return answer;
}

/** `deep status --json`'s log_pos (the record position its rows were built at, #1463 Pinned 1). */
export async function statusLogPos(w: World): Promise<number> {
  const r = await deep(w, ['status', '--json']);
  let p: { log_pos?: unknown } | undefined;
  try { p = JSON.parse(r.stdout) as { log_pos?: unknown }; } catch { p = undefined; }
  expect(r.code === 0 && typeof p?.log_pos === 'number', `deep status --json must exit 0 and print {log_pos, rows}: ${shown(r)}`).toBe(true);
  return p!.log_pos as number;
}

/** The list's rows as the app folds them: every `row.set` up to `logPos`, `listed: false` taking a row off. */
export async function foldedRows(w: World, logPos: number): Promise<Map<string, Record<string, any>>> {
  const rows = new Map<string, Record<string, any>>();
  for (const e of await eventsOf(w.hub)) {
    if (e.kind !== 'row.set' || e.log_pos > logPos) continue;
    const d = e.data as Record<string, any>;
    if (typeof d.id !== 'string') continue;
    if (d.listed === false) rows.delete(d.id);
    else rows.set(d.id, d);
  }
  return rows;
}
export const askRows = (rows: Map<string, Record<string, any>>): string[] => [...rows.keys()].filter((id) => id.startsWith('ask:'));

/** Each count sentence, as the app writes it (views::asks_need_you): "1 ask needs you", "3 asks need you". */
export const countsIn = (text: string): number[] => [...text.matchAll(/\b(\d+) asks? needs? you\b/g)].map((m) => Number(m[1]));

// ---- The replica (macOS only): one `deep-drive --out <dir>` process, JSON lines in and out (#124's protocol).

const BIN = join(tmpdir(), `dh1810-bin-${userInfo().uid}`);
let drive: string | undefined;
/** The plain `deep-drive`, built once a run and copied out of the target folder. */
export function driveBinary(): string {
  if (process.platform !== 'darwin') blocked(`the replica draws on macOS only; this is ${process.platform}`);
  if (!drive) {
    mkdirSync(BIN, { recursive: true });
    try {
      execFileSync('cargo', ['build', '--locked', '-q', '-p', 'deep-replica', '--bin', 'deep-drive'], { cwd: REPO, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' }, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    } catch (error) {
      blocked(`cargo build -p deep-replica --bin deep-drive failed: ${String((error as { stderr?: Buffer }).stderr ?? (error as Error).message).slice(0, 800)}`);
    }
    drive = join(BIN, 'deep-drive');
    copyFileSync(target('deep-drive'), drive);
  }
  return drive;
}
interface SNode { name: string | null; children?: SNode[] }
const names = (n: SNode, into: string[] = []): string[] => { into.push(n.name ?? ''); for (const c of n.children ?? []) names(c, into); return into; };
/** The replica's list over a copy of the world's record: its `log_pos` (#1463 Pinned 5) and the count sentences its window draws. */
export async function replicaList(w: World): Promise<{ log_pos: number | undefined; counts: number[]; asks: string[] }> {
  const out = join(tempDir(), 'out');
  mkdirSync(out, { recursive: true });
  const child: ChildProcess = spawn(driveBinary(), ['--out', out], { cwd: REPO, env: childEnv(w.home), stdio: ['pipe', 'pipe', 'pipe'] });
  own(child.pid);
  let buffer = '';
  const waiting: ((line: Record<string, any>) => void)[] = [];
  child.stdout!.setEncoding('utf8').on('data', (d: string) => {
    buffer += d;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      let parsed: Record<string, any>;
      try { parsed = JSON.parse(line) as Record<string, any>; } catch { parsed = { unparsed: line }; }
      waiting.shift()?.(parsed);
    }
  });
  child.on('exit', () => { for (const wake of waiting.splice(0)) wake({ exited: true }); });
  const next = (): Promise<Record<string, any>> => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), 180_000);
    waiting.push((line) => { clearTimeout(timer); resolve(line); });
  });
  const must = async (args: Record<string, unknown>): Promise<Record<string, any>> => {
    const reply = next();
    child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.ok !== true) blocked(`deep-drive ${String(args.call)}: ${JSON.stringify(got).slice(0, 600)}`);
    return got;
  };
  try {
    const ready = await next();
    if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${JSON.stringify(ready).slice(0, 300)}`);
    await must({ call: 'launch', launch: { from: 'record_copy' } });
    const seen = await must({ call: 'see' });
    const rows = Array.isArray(seen.rows) ? (seen.rows as { id: string }[]) : [];
    return { log_pos: typeof seen.log_pos === 'number' ? seen.log_pos : undefined, counts: countsIn(names(seen.snapshot.tree as SNode).join('\n')), asks: rows.map((r) => r.id).filter((id) => id.startsWith('ask:')) };
  } finally {
    try { child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 5000;
    while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await sleep(20);
    if (child.exitCode === null && child.signalCode === null) try { process.kill(child.pid!, 'SIGKILL'); } catch { /* gone */ }
  }
}

// ---- The judges: each returns the failures it finds, each naming what it found.

/** The line of a status answer that carries the Needs-you count, and the count it ends in. */
export function countLine(answer: string): { line: string; count: number | undefined } {
  const line = answer.split('\n').find((l) => /needs you/i.test(l)) ?? '';
  const m = /needs you:\s*(\d+)\s*$/.exec(line);
  return { line, count: m ? Number(m[1]) : undefined };
}

/**
 * The status answer's count against the open asks: it must say `needs you: <open>`. A count over that names each ask
 * the fixture closed (answered, or defaulted and still undoable) that it may have counted.
 */
export function countFailures(answer: string, asks: readonly FixtureAsk[]): string[] {
  const open = asks.filter((a) => a.then === 'open');
  const { line, count } = countLine(answer);
  if (count === undefined) return [`the status answer holds no line ending in "needs you: <n>": ${JSON.stringify(answer)}`];
  if (count === open.length) return [];
  const closed = asks.filter((a) => a.then !== 'open');
  const why = (a: FixtureAsk): string => `${a.handle} "${a.question}" (${a.then === 'answer' ? 'answered' : 'defaulted, can still be undone'})`;
  return [`the status answer says "needs you: ${count}", but ${open.length} ask${open.length === 1 ? ' is' : 's are'} open (${open.map((a) => a.handle).join(', ') || 'none'})${count > open.length ? `; it counts closed asks among ${closed.map(why).join(', ')}` : ''}: ${JSON.stringify(line)}`];
}

/** The status answer's count line fits #83's width and still ends in the count. */
export function widthFailures(answer: string, count: number, width = WIDTH): string[] {
  const { line, count: said } = countLine(answer);
  const out: string[] = [];
  if (columns(line) > width) out.push(`the status answer's line is ${columns(line)} columns wide, over #83's width of ${width}: ${JSON.stringify(line)}`);
  if (said !== count) out.push(`the status answer's line doesn't end in "needs you: ${count}": ${JSON.stringify(line)}`);
  return out;
}
