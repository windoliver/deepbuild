// Shared test-side tools for the #2539 acceptance tests (README). The sync shim, the hub as a process and its socket's
// line protocol are #1410's (../1410/helpers.ts, ../1410/shim/syncshim.c), used as they are. What is added here: a hub
// started with every evidence sync slowed, sessions whose hooks are sent as deep-hook sends them (a prompt with the
// transcript entry that says who typed it), an asking session with its own `deep mcp`, your answer through
// `deep inbox answer`, and the judgement of what a slowed sync covered. Nothing here stands in for DeepBuild, and no
// function of the hub is called: only hooks, `events.read`, `deep mcp` and `deep inbox answer`.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  allEvents, buildShim, childEnv, CLI, Conn, control, idOf, fileOf, makeHome, NODE, own, readLog, shimEnv, sleep, startHub, stopHub, SYNC_OPS, ulid,
  type Ev, type Home, type Hub, type Line, type SyncEntry,
} from '../1410/helpers.ts';

export { cleanup, sleep } from '../1410/helpers.ts';
export type { Ev, Line, SyncEntry } from '../1410/helpers.ts';

/** The issue's own values: each evidence sync takes 4 s, a reply comes within 1 s, the record keeps 8,192 characters of a field. */
export const SLOW_MS = 4000;
export const BOUND_MS = 1000;
export const KEPT_CHARS = 8192;
export const C1 = '#2539.948b73c4';
export const C2 = '#2539.10f656f1';
export const C3 = '#2539.fc330be5';

/** The machine's load, for messages and the run's output. */
export const load = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;
export const tag = (n = 3): string => randomBytes(n).toString('hex');

// ---- The hub under slowed evidence syncs.
export interface World { h: Home; hub: Hub; cli: Conn; log: string; evidence: string; confirm: string; agent: number }
let shim: string | undefined;
/**
 * `deep hub run` on a temp home, the sync shim preloaded: every sync of a file or folder under the hub's evidence
 * folder takes SLOW_MS, no other sync is slowed. `agent` is a process that stands for the Claude Code the sessions'
 * hooks come from (their `ppid`), stopped by its PID with the rest.
 */
export async function startWorld(): Promise<World> {
  shim ??= buildShim();
  const h = makeHome();
  const log = join(h.tmp, 'sync.log');
  const evidence = join(h.root, 'evidence');
  const confirm = join(h.tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  // Your settings: a choice ask's deadline and default, without which deep_ask files none (#318).
  mkdirSync(h.root, { recursive: true, mode: 0o700 });
  writeFileSync(join(h.root, 'config.json'), `${JSON.stringify({ asks: { deadline: { choice: '2d' }, default: { choice: 'recommended' } } }, null, 2)}\n`);
  const hub = await startHub(h, { ...shimEnv(shim, log, { watch: evidence, slowUnder: evidence, slowMs: SLOW_MS }), DEEP_HUB_TEST_CONFIRM: confirm });
  const cli = await control(hub);
  const agent = spawn(NODE, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', env: { PATH: process.env.PATH ?? '' } });
  own(agent.pid);
  return { h, hub, cli, log, evidence, confirm, agent: agent.pid! };
}
export async function stopWorld(w: World | undefined): Promise<void> {
  if (!w) return;
  w.cli.close();
  await stopHub(w.hub);
}
/** Polls the record until `test` holds; BLOCKED, naming what never came, past `ms`. */
export async function recordUntil(w: World, what: string, test: (events: Ev[]) => boolean, ms = 90_000): Promise<Ev[]> {
  const deadline = Date.now() + ms;
  for (;;) {
    const events = await allEvents(w.cli);
    if (test(events)) return events;
    if (Date.now() > deadline) throw Error(`BLOCKED: ${what} never reached the record within ${ms} ms (${load()}); the last kinds: ${JSON.stringify(events.slice(-12).map((e) => e.kind))}`);
    await sleep(150);
  }
}
/** Polls the record for `ms` for something that may never come; what it found, or undefined. */
export async function recordWithin(w: World, test: (events: Ev[]) => boolean, ms: number): Promise<Ev[] | undefined> {
  return recordUntil(w, '', test, ms).catch(() => undefined);
}

// ---- Sessions: hooks sent as deep-hook sends them (hook.request@1), one connection each, each reply timed.
/** The transcript entry fields Claude Code writes for a prompt, by who sent it (shapes as #2066's and #303's tests have them). */
const ORIGIN: Record<string, Line> = {
  person: { origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' },
  scheduled: { isMeta: true, promptSource: 'system', queueSkipSlashCommands: true, turnOrigin: 'scheduled' },
};
let seqCounter = 0n;
const nextSeq = (): string => { seqCounter += 1n; return (BigInt(Date.now()) * 1_000_000n + (seqCounter % 1_000_000n)).toString(); };
/** One hook call: its event ID, when it was sent (ms since the epoch), the ms from sending it to the hub's reply line, and that reply. */
export interface Call { id: string; event: string; sent: number; ms: number; ack?: Line; reply?: Line }
/** The whole of a reply as text: what the agent or the chat would be shown of it. */
export const said = (c: Call): string => {
  const r = c.reply ?? {};
  return [r.stdout, r.stderr].map((x) => (typeof x === 'string' ? x : '')).join('\n');
};
let sessions = 0;
export class Sess {
  readonly id = randomUUID();
  readonly cwd: string;
  readonly transcript: string;
  private parent: string | null = null;
  private promptId: string | undefined;
  /** `ppid` is the Claude Code process the session's hooks come from: the world's stand-in unless another is named. */
  constructor(private readonly w: World, private readonly ppid: number = w.agent) {
    this.cwd = join(w.h.tmp, `work${++sessions}`);
    mkdirSync(this.cwd, { recursive: true });
    this.transcript = join(w.h.home, '.claude/projects', this.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
  }
  private write(value: Line): void { writeFileSync(this.transcript, `${JSON.stringify(value)}\n`, { flag: 'a' }); }
  /** A transcript entry, as Claude Code writes one before the hook that follows it. */
  entry(value: Line): void {
    const uuid = randomUUID();
    this.write({ parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', cwd: this.cwd, sessionId: this.id, gitBranch: 'main' });
    this.parent = uuid;
  }
  async hook(event: string, fields: Line = {}): Promise<Call> {
    const conn = await Conn.open(this.w.hub.socket, 30_000);
    try {
      const id = ulid();
      const from = conn.received.length;
      const sent = Date.now();
      const t0 = performance.now();
      conn.send({ v: 1, agent: 'claude-code', event, seq: nextSeq(), id, pid: process.pid, ppid: this.ppid, matched: [],
        payload: { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.promptId && event !== 'SessionStart' ? { prompt_id: this.promptId } : {}), ...fields } });
      const ack = await conn.seek((l) => 'ack' in l || 'error' in l, from, 90_000);
      const reply = await conn.seek((l) => 'exit' in l || 'error' in l, from, 120_000);
      return { id, event, sent, ms: (reply?.at ?? Number.POSITIVE_INFINITY) - t0, ...(ack ? { ack: ack.line } : {}), ...(reply ? { reply: reply.line } : {}) };
    } finally {
      conn.close();
    }
  }
  start(source = 'startup'): Promise<Call> { return this.hook('SessionStart', { source, model: 'claude-haiku-5-5' }); }
  /** A prompt: its transcript entry first, with the fields that say who sent it, then its UserPromptSubmit. */
  prompt(text: string, origin: 'person' | 'scheduled' = 'person'): Promise<Call> {
    this.promptId = randomUUID();
    this.entry({ type: 'user', message: { role: 'user', content: text }, promptId: this.promptId, ...ORIGIN[origin]! });
    return this.hook('UserPromptSubmit', { prompt: text });
  }
  says(text: string): void {
    this.entry({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' } });
  }
  /** One tool call that ran: its PreToolUse and its PostToolUse. */
  async tool(n: string): Promise<[Call, Call]> {
    const id = `toolu_2539_${n}_${tag(4)}`;
    const pre = await this.hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: id });
    const post = await this.hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: '', stderr: '', interrupted: false }, tool_use_id: id });
    return [pre, post];
  }
  /**
   * One tool call that failed: its PreToolUse and its PostToolUseFailure, always the same command with the same
   * error. The hub holds a call that fails as the session's last one did for its core's reply (#2019).
   */
  async failed(n: string): Promise<[Call, Call]> {
    const input = { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: `toolu_2539_${n}_${tag(4)}` };
    const pre = await this.hook('PreToolUse', input);
    const post = await this.hook('PostToolUseFailure', { ...input, error: 'Exit code 1\nError: the api test suite found no tests', is_interrupt: false });
    return [pre, post];
  }
  /** The turn's end: the agent's last words, which claim nothing, then its Stop. */
  stop(last = 'I am still reading; nothing to report yet.'): Promise<Call> {
    this.says(last);
    return this.hook('Stop', { stop_hook_active: false, last_assistant_message: last });
  }
}
/** A session whose first turn has ended, its stop in the record: its next prompt resumes it. */
export async function endedSession(w: World, ppid?: number): Promise<Sess> {
  const s = new Sess(w, ppid);
  await s.start();
  await s.prompt('What does this folder hold?');
  await s.stop('Nothing yet.');
  await recordUntil(w, `the stop of session ${s.id}`, (events) => events.some((e) => e.session === s.id && e.kind === 'agent.stop'));
  return s;
}
/** Filler in plain words a scrub leaves as they are; with `lead` and `tail`, a prompt longer than the record keeps of a field. */
export const longText = (lead: string, tail = 'Sound good?'): string => {
  const text = `${lead}\n${'please carry on with the plan we made '.repeat(260)}\n${tail}`;
  if (text.length <= KEPT_CHARS) throw Error(`the prompt must be over ${KEPT_CHARS} characters, not ${text.length}`);
  return text;
};

// ---- What the shim saw of the evidence folder.
/** Every sync of a file or folder under the hub's evidence folder that has ended: the slowed ones. */
export const evidenceSyncs = (w: World): SyncEntry[] =>
  readLog(w.log).filter((e): e is SyncEntry => e.kind === 'S' && SYNC_OPS.has(e.op) && (e.path === w.evidence || e.path.startsWith(`${w.evidence}/`)));
/** Whether the shim sees the hub at all: the record's own FULL commits sync its WAL. */
export function mustSeeHub(w: World): void {
  if (!readLog(w.log).some((e) => e.kind === 'S' && e.path === join(w.h.root, 'ledger.db-wal'))) throw Error(`BLOCKED: the shim saw no sync of the hub's ledger WAL, so it doesn't see the hub's syncs`);
}
/**
 * The slowed syncs, once no more are coming: the shim logs a sync when it ends, so this waits until one has ended
 * and none has for longer than a slowed sync takes. Empty when none came within `ms`.
 */
export async function settledSyncs(w: World, ms = 8 * SLOW_MS + 60_000): Promise<SyncEntry[]> {
  const deadline = Date.now() + ms;
  let seen = -1;
  let since = Date.now();
  for (;;) {
    const now = evidenceSyncs(w);
    if (now.length !== seen) { seen = now.length; since = Date.now(); }
    if (seen > 0 && Date.now() - since > SLOW_MS + 2000) return now;
    if (Date.now() > deadline) return now;
    await sleep(250);
  }
}
/** The slowed syncs of one evidence hash: of its file (by inode, so a sync before its rename counts) or of its folder. */
export function syncsOf(w: World, sha: string, all: SyncEntry[]): SyncEntry[] {
  const file = fileOf(w.evidence, sha);
  if (!existsSync(file)) return [];
  const [f, d] = [idOf(file), idOf(dirname(file))];
  return all.filter((e) => (e.dev === f.dev && e.ino === f.ino) || (e.dev === d.dev && e.ino === d.ino));
}
/** Whether a moment (ms since the epoch) fell while a slowed sync ran. */
export const during = (at: number, all: SyncEntry[]): boolean => all.some((e) => at >= e.start && at < e.end);
export const spans = (all: SyncEntry[]): string => JSON.stringify(all.map((e) => [Math.round(e.start), Math.round(e.end)]));
/**
 * What must hold of the slowed commit for a test to show anything (invariant 2): its event names evidence, the shim
 * saw that evidence synced, and a sync took the time the shim was told to give it. Problems, each saying why the test
 * shows nothing.
 */
export function slowedCommit(w: World, event: Ev | undefined, what: string, all: SyncEntry[]): { problems: string[]; own: SyncEntry[] } {
  mustSeeHub(w);
  if (!event) return { problems: [`BLOCKED: ${what} is not in the record`], own: [] };
  const named = event.evidence ?? [];
  if (!named.length) return { problems: [`BLOCKED: ${what} names no evidence in the record, so its commit waits for no evidence sync: this test shows nothing`], own: [] };
  const own = named.flatMap((sha) => syncsOf(w, sha, all));
  const problems: string[] = [];
  if (!own.length) problems.push(`no sync of the evidence ${what} names (${named.join(', ')}) or of its folder was seen, though a FULL commit names it: no reply was exposed to an evidence sync (syncs under the evidence folder: ${spans(all)})`);
  else if (!own.some((e) => e.end - e.start >= SLOW_MS - 200)) problems.push(`BLOCKED: the shim slowed no sync of the evidence ${what} names to ${SLOW_MS} ms (they took ${JSON.stringify(own.map((e) => Math.round(e.end - e.start)))} ms)`);
  return { problems, own };
}
/** The user.ask a prompt's hook recorded: its event carries the hook's ID. */
export const askOf = (events: Ev[], c: Call): Ev | undefined => events.find((e) => e.id === c.id && e.kind === 'user.ask');

// ---- An asking session: its own Claude Code stand-in (a shell), whose child is the session's `deep mcp`.
export interface Asker { s: Sess; pid: number; ask(question: string, north: string, south: string): Promise<number>; replied(): string; close(): Promise<void> }
/**
 * A session with a `deep mcp` of its own, as Claude Code starts one: a shell stands for the session's Claude Code (the
 * `ppid` of its hooks), and runs `deep mcp` as its child once the session's first hooks are in. `ask` calls deep_ask
 * (a choice between two roads, south recommended) and doesn't wait for the call, which waits for your answer; it
 * returns when the call was written. `close` ends the session's deep mcp, as Claude Code does when a turn is cut.
 */
export async function asker(w: World): Promise<Asker> {
  const child: ChildProcess = spawn('/bin/sh', ['-c', 'read go; "$0" "$1" mcp; :', NODE, CLI], { cwd: w.h.tmp, env: childEnv(w.h, { DEEP_HUB_TEST_CONFIRM: w.confirm }), stdio: ['pipe', 'pipe', 'pipe'] });
  own(child.pid);
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  child.stdin!.on('error', () => undefined);
  const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const waiting = new Map<number, (m: Line) => void>();
  createInterface({ input: child.stdout! }).on('line', (raw) => { try { const m = JSON.parse(raw) as Line; waiting.get(m.id as number)?.(m); waiting.delete(m.id as number); } catch { /* not a reply */ } });
  let ids = 0;
  const replies: string[] = [];
  const request = (method: string, params: Line): { id: number; reply: Promise<Line> } => {
    const id = ++ids;
    const reply = new Promise<Line>((resolve) => waiting.set(id, resolve));
    child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return { id, reply };
  };
  const s = new Sess(w, child.pid!);
  await s.start();
  await s.prompt('Lay out the path through the garden.');
  child.stdin!.write('go\n');
  const init = await Promise.race([request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-2539', version: '0' } }).reply, sleep(120_000).then(() => undefined), exited.then(() => undefined)]);
  if (!init?.result) throw Error(`BLOCKED: the session's deep mcp didn't initialize (${load()}): ${JSON.stringify(init ?? null).slice(0, 600)} ${err.slice(0, 1500)}`);
  child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
  return {
    s,
    pid: child.pid!,
    async ask(question, north, south) {
      const args = { kind: 'choice', question, options: [{ id: 'north', label: north }, { id: 'south', label: south }], recommended: 'south', steps: null, where: null, why: null, check: null, subject: null };
      const call = `toolu_2539_ask_${tag(4)}`;
      s.entry({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: call, name: 'mcp__deep__deep_ask', input: args }], stop_reason: 'tool_use' } });
      await s.hook('PreToolUse', { tool_name: 'mcp__deep__deep_ask', tool_input: args, tool_use_id: call });
      const at = Date.now();
      void request('tools/call', { name: 'deep_ask', arguments: args }).reply.then((m) => { replies.push(JSON.stringify(m).slice(0, 1500)); });
      return at;
    },
    replied: () => replies.join(' | ') || 'nothing yet',
    async close() {
      child.stdin!.end();
      await Promise.race([exited, sleep(20_000)]);
    },
  };
}
/** The ask a session filed, once the record holds it. */
export async function askFiled(w: World, q: Asker, question: string): Promise<Ev> {
  const mine = (e: Ev): boolean => e.kind === 'ask.created' && e.session === q.s.id && e.data?.question === question;
  const deadline = Date.now() + 120_000;
  for (;;) {
    const found = (await allEvents(w.cli)).find(mine);
    if (found) return found;
    // deep_ask waits for your answer; a reply before the ask is filed is its refusal.
    if (Date.now() > deadline || q.replied().includes('"isError":true')) throw Error(`BLOCKED: the deep_ask "${question}" of session ${q.s.id} filed no ask in the record (${load()}); deep_ask replied ${q.replied()}`);
    await sleep(150);
  }
}
export interface Ran { code: number | null; stdout: string; stderr: string; started: number; ended: number }
/** `deep <args>` from the built CLI, as you run it: HOME the test's home, the OS confirmation stubbed (#24). */
export function deep(w: World, args: readonly string[]): Promise<Ran> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(NODE, [CLI, ...args], { cwd: w.h.tmp, env: childEnv(w.h, { DEEP_HUB_TEST_CONFIRM: w.confirm }), stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr, started, ended: Date.now() }));
  });
}
/** Your answer, north, with `deep inbox answer`; returns once the record holds it. BLOCKED unless the command exits 0. */
export async function answerNorth(w: World, ask: Ev): Promise<Ran> {
  const r = await deep(w, ['inbox', 'answer', `ask:${ask.id}`, 'north']);
  if (r.code !== 0) throw Error(`BLOCKED: deep inbox answer ask:${ask.id} north must exit 0 (${load()}): exit ${r.code}, ${JSON.stringify(r.stdout.slice(0, 800))} ${JSON.stringify(r.stderr.slice(0, 800))}`);
  await recordUntil(w, `the answer to ask:${ask.id}`, (all) => all.some((e) => e.kind === 'ask.answered' && (e as Ev & { subject?: string }).subject === `ask:${ask.id}`), 120_000);
  return r;
}
/** The rules file's guard entries for a word (`word:<word>`), as a rejection writes them. */
export function guardsFor(w: World, word: string): string[] {
  const file = join(w.h.root, 'rules.json');
  if (!existsSync(file)) return [];
  const entries = (JSON.parse(readFileSync(file, 'utf8')) as { entries?: Record<string, { match?: string }> }).entries ?? {};
  return Object.entries(entries).filter(([, e]) => e.match === `word:${word}`).map(([name]) => name);
}
