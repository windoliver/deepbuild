// Test-side tools for #2021 (README). Every world is a record a real hub made (#1461's `makeWorld`: thirty sessions in
// three repos seeded through the real record core, then `deep hub run` builds the list's rows as its first backfill).
// The hub is then started again with its clock stepped by the test (`DEEP_HUB_TEST_CLOCK_STEPS=1`, #965), so what it
// stamps follows the replica's virtual clock. The app is the real `deep-drive` (#124) on a copy of that record
// (`launch.from: "record_copy"`) at the reference window. A session's agent is a real process (a `sleep` standing in for
// Claude Code) whose hooks reach the real hub's hook entry, each payload Claude Code 2.1.308's own as the corpus recorded
// it (adapters/corpus), with this turn's values in place of the recording's; whatever the hub appends for a hook is fed
// to the replica as the hub's stream delivers it, in log order, at the replica's clock. The judges are this suite's own.
//
// Reused by import: #16's homes, hub, hook wire, connections, scrub forms and PID cleanup; #1463's `quiet`; #1461's
// world, the window's readers (rows, slots, runs) and the reference window.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was
// started with; nothing touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import {
  childEnv, control, formsIn, nextSeq, own, REPO, result, sendHook, sha256, sleep, startHub, stopHub, tempDir, tokenOf, ulid,
  type Conn, type Ev, type Hub, type Line, type Session,
} from '../16/helpers.ts';
import { quiet } from '../1463/helpers.ts';
import {
  byId, cleanup as cleanup1461, flat, FLICKS, flicks, listOf, listRows, makeWorld, MIN, REFERENCE, runsIn, SECOND, sessionOf,
  type Row, type Seen, type SessionSpec, type SNode, type Snapshot, type World,
} from '../1461/helpers.ts';

export { MIN, SECOND };
export const cleanup = cleanup1461;
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
const said = (v: unknown, n = 300): string => (JSON.stringify(v) ?? String(v)).slice(0, n);

/** The criteria, by `#2021.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  mark: '#2021.cf07389f',
  motion: '#2021.4ccecc58',
  keys: '#2021.6db64bd1',
  turn: '#2021.71cb584f',
  scrub: '#2021.9b270501',
  select: '#2021.a6469f5a',
} as const;

/** The planted wrong programs, each read by the app through `plain::planted` (DEEP_HUB_PLANT, env-plants builds only). */
export const PLANT = {
  /** AC1: every working mark is animated by a timer, moving whether or not an event came. */
  timer: 'mark-on-timer',
  /** AC3: no row of the list can take the keyboard's focus. */
  noFocus: 'rows-take-no-focus',
  /** AC4: a working session's line reads its agent's newest message (`session.activity`) in place of its hook facts. */
  message: 'line-reads-message',
  /** AC4: a shell step's line keeps reading "Running <word>" after the call failed. */
  keepsRunning: 'line-keeps-running',
  /** AC5: a shell step's line prints the whole command line the record holds, not its first word. */
  wholeCommand: 'line-whole-command',
  /** AC5: after two minutes with no event the line, and the row's state word, read "stalled". */
  stalls: 'line-stalls-on-timer',
  /** AC6: the selected row is two lines tall, its second line its session's line. */
  secondLine: 'selected-second-line',
} as const;

// ---- Builds (README, How to run): this checkout's `deep-drive`, copied out of the target folder into a folder named
// for the checkout, so another worktree's build never stands in for this one.

const BIN = join(tmpdir(), `dd2021-bin-${userInfo().uid}-${sha256(REPO).slice(0, 8)}`);
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
function cargo(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('cargo', ['build', '--locked', '-q', ...args], { cwd: REPO, env: CARGO_ENV, maxBuffer: 64 * 1024 * 1024 }, (error, _out, stderr) => {
      if (!error) return resolve();
      reject(Error(`BLOCKED: cargo build ${args.join(' ')} failed: ${String(stderr).split('\n').filter((l) => /error/.test(l)).slice(0, 6).join('\n') || String(stderr).slice(-600)}`));
    });
  });
}
let builds: Promise<{ plain: string; plants: string }> | undefined;
/** `deep-drive` as shipped (with deep-app's `test-confirm`, as #1461's) and with `env-plants` too; the plain one built last. */
export function driveBins(): Promise<{ plain: string; plants: string }> {
  builds ??= (async () => {
    if (process.platform !== 'darwin') blocked(`the replica draws on macOS only; this is ${process.platform}`);
    mkdirSync(BIN, { recursive: true });
    // Copied beside and renamed into place: a binary rewritten where it lies can be killed at its next start on macOS.
    const keep = (as: string): string => { const out = join(BIN, as); copyFileSync(target('deep-drive'), `${out}.new`); renameSync(`${out}.new`, out); return out; };
    await cargo(['-p', 'deep-replica', '--bin', 'deep-drive', '--features', 'env-plants,deep-app/test-confirm']);
    const plants = keep('deep-drive-plants');
    await cargo(['-p', 'deep-replica', '--bin', 'deep-drive', '--features', 'deep-app/test-confirm']);
    return { plain: keep('deep-drive-plain'), plants };
  })();
  return builds;
}

// ---- The replica, driven: one `deep-drive --out <dir>` process, JSON lines in and out (#124's protocol).

export class Replica {
  private buffer = '';
  private readonly waiting: ((line: Line) => void)[] = [];
  private exited = false;
  private err = '';
  /** The replica's clock at its last reply, in flicks since launch. */
  t = 0;
  /** The wall clock just before the launch call: no later than the record's clock the replica starts at. */
  launchSent = 0;
  private constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let parsed: Line;
        try { parsed = JSON.parse(line) as Line; } catch { parsed = { unparsed: line }; }
        this.waiting.shift()?.(parsed);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true }); });
  }
  /** A replica in `home` (the world's, so `record_copy` reads its hub); `plant` its DEEP_HUB_PLANT, in the planted build. */
  static async start(home: string, plant?: string): Promise<Replica> {
    const bins = await driveBins();
    const out = join(tempDir(), 'out');
    mkdirSync(out, { recursive: true });
    const child = spawn(plant ? bins.plants : bins.plain, ['--out', out], { cwd: REPO, env: childEnv(home, { DEEP_HUB_PLANT: plant }), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const r = new Replica(child);
    const ready = await r.next(300_000);
    if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${said(ready)} ${r.err.slice(-600)}`);
    return r;
  }
  private next(ms: number): Promise<Line> {
    if (this.exited) return Promise.resolve({ exited: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  /** One call and its reply; BLOCKED when the binary gives none. */
  async call(args: Line): Promise<Line> {
    const reply = this.next(600_000);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.exited || got.timedOut || got.unparsed !== undefined) blocked(`deep-drive gave no JSON reply to ${String(args.call)}: ${said(got)} ${this.err.slice(-600)}`);
    if (typeof got.t === 'number') this.t = got.t;
    return got;
  }
  /** One call that must answer ok; else a failure naming `what` and the replica's own error. */
  async must(what: string, args: Line): Promise<Line> {
    const reply = await this.call(args);
    if (reply.ok !== true) throw Error(`${what}: ${said(reply.error ?? reply, 400)}`);
    return reply;
  }
  async launch(launch: Line): Promise<Line> {
    this.launchSent = Date.now();
    return this.must(`launching the replica with ${said(launch)}`, { call: 'launch', launch });
  }
  async see(): Promise<Seen> {
    const r = await this.must('see', { call: 'see' });
    return { snapshot: r.snapshot as Snapshot, rows: (r.rows ?? []) as Row[], log_pos: r.log_pos as number, address: (r.address ?? null) as string | null, menus: [] };
  }
  /**
   * Runs the clock to `t` (flicks since launch): a frame each 60th of a second, or with `stepMs` a frame each `stepMs` of
   * virtual time (`wait_for`'s `step_ms`, #2028), the last shorter.
   */
  async waitTo(t: number, stepMs?: number): Promise<void> {
    if (t <= this.t) return;
    const ms = Math.ceil(((t - this.t) * 1000) / FLICKS);
    const reply = await this.must(`running the clock ${ms} ms`, { call: 'wait_for', wait_for: { t, ...(stepMs ? { step_ms: stepMs } : {}) }, timeout: ms + 2000 });
    if (stepMs && reply.step_ms !== stepMs) blocked(`deep-drive's wait_for didn't step its clock ${stepMs} ms a frame: ${said(reply)}`);
  }
  wait(ms: number): Promise<void> { return this.waitTo(this.t + flicks(ms)); }
  /** Runs the clock to `t` in a frame or two: where only the moment matters, not the frames between. */
  jump(t: number): Promise<void> { return this.waitTo(t, Math.max(1, Math.floor(((t - this.t) * 1000) / FLICKS))); }
  click(id: string, what: string): Promise<Line> { return this.must(what, { call: 'act', locator: { id }, act: { kind: 'click' } }); }
  hover(id: string): Promise<Line> { return this.must(`the pointer on ${id}`, { call: 'act', locator: { id }, act: { kind: 'hover' } }); }
  press(keys: string): Promise<Line> { return this.must(`pressing ${keys}`, { call: 'act', act: { kind: 'press', keys } }); }
  feed(session: string, event: Line): Promise<Line> { return this.must(`feeding ${String(event.kind)}`, { call: 'feed', feed: { session, event } }); }
  /** The SHA-256 of the pixels the element `id` is drawn in now: the replica's own screenshot of it. */
  async shot(id: string): Promise<string> {
    const r = await this.call({ call: 'screenshot', screenshot: { target: 'locator', locator: { id } } });
    // A node the window doesn't draw has no picture: it reads as one, unlike every picture of it drawn.
    if (r.ok !== true && r.error?.code === 'locate.none') return `${id} isn't drawn`;
    if (r.ok !== true) throw Error(`a picture of ${id}: ${said(r.error ?? r, 400)}`);
    return typeof r.sha256 === 'string' ? r.sha256 : blocked(`the screenshot of ${id} has no sha256: ${said(r)}`);
  }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 5000;
    while (!this.exited && Date.now() < deadline) await sleep(20);
    if (!this.exited) try { process.kill(this.child.pid!, 'SIGKILL'); } catch { /* gone */ }
  }
}

// ---- The world (README, The fixture): thirty sessions in three repos at the reference window.

/**
 * Thirty sessions: shop's ten and docs' ten, each at work once its agent's turn has begun, and web's ten finished. The
 * list draws its projects in their names' order, so the finished ones are last and the twenty at work are all drawn.
 */
export const WORLD: SessionSpec[] = [
  { key: 'cart', project: 'shop', title: 'Cart totals' },
  { key: 'busy', project: 'shop', title: 'Product grid' },
  { key: 'slow', project: 'shop', title: 'Image build' },
  ...['Checkout page', 'Billing page', 'Login flow', 'Wish list', 'Gift cards', 'Coupons', 'Order history'].map((title, i) => ({ key: `shop${i}`, project: 'shop', title })),
  { key: 'deploy', project: 'docs', title: 'Deploy check' },
  ...['Release notes', 'API guide', 'Docs refresh', 'Install guide', 'Changelog', 'Style guide', 'Questions page', 'Tutorial', 'Glossary'].map((title, i) => ({ key: `docs${i}`, project: 'docs', title })),
  ...['Landing page', 'Pricing page', 'Blog index', 'Footer links', 'Sign-up form', 'Contact form', 'Site map', 'Image sizes', 'Font loading', 'Cookie banner']
    .map((title, i): SessionSpec => ({ key: `web${i}`, project: 'web', title, state: 'finished' })),
];
/** The twenty that work: queued as seeded, working once their agent's turn has begun (`begin`). */
export const WORKING = WORLD.filter((s) => s.state === undefined).map((s) => s.key);

/** A row id as a failure names it: the id and the session's title. */
export const named = (rows: readonly Row[], id: string): string => `${id} ("${rows.find((r) => r.id === id)?.title ?? '?'}")`;
const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');

// ---- Claude Code's own payloads (README, The fixture): the corpus's recording of 2.1.308, each hook's first recorded
// payload of that event (and tool), with this session's fields and this turn's prompt and call in place of the
// recording's; and its transcript's entries, which Claude Code writes before the hooks that name them.

const RECORDING = join(REPO, 'adapters/corpus/claude-code/2.1.308/tools');
let recorded: Line[] | undefined;
function recordedPayload(event: string, tool?: string): Line {
  recorded ??= readFileSync(join(RECORDING, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => (JSON.parse(l) as { payload: Line }).payload);
  const found = recorded.find((p) => p.hook_event_name === event && (tool === undefined || p.tool_name === tool));
  return structuredClone(found ?? blocked(`the corpus's ${RECORDING}/events.jsonl holds no ${event} payload${tool ? ` of ${tool}` : ''}`));
}
let entries: Line[] | undefined;
/** The transcript entries the recording holds: the person's typed prompt, the agent's words or its thinking, a tool call and its result. */
type Entry = 'prompt' | 'words' | 'thinking' | 'call' | 'result';
const ENTRY: Record<Entry, (e: Line) => boolean> = {
  prompt: (e) => e.type === 'user' && typeof e.promptId === 'string' && typeof e.message?.content === 'string',
  words: (e) => e.type === 'assistant' && Array.isArray(e.message?.content) && e.message.content.some((c: Line) => c.type === 'text'),
  thinking: (e) => e.type === 'assistant' && Array.isArray(e.message?.content) && e.message.content.some((c: Line) => c.type === 'thinking'),
  call: (e) => e.type === 'assistant' && Array.isArray(e.message?.content) && e.message.content.some((c: Line) => c.type === 'tool_use'),
  result: (e) => e.type === 'user' && Array.isArray(e.message?.content) && e.message.content.some((c: Line) => c.type === 'tool_result'),
};
function recordedEntry(kind: Entry): Line {
  entries ??= readFileSync(join(RECORDING, 'transcript.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Line);
  return structuredClone(entries.find(ENTRY[kind]) ?? blocked(`the corpus's ${RECORDING}/transcript.jsonl holds no ${kind} entry`));
}
export type Written = { prompt: string; promptId: string } | { words: string } | { thinking: true } | { call: Call } | { result: Call; promptId?: string; output: unknown; error?: string };
/**
 * Appends to the session's transcript what Claude Code writes there at `at`, in the recording's shape: its prompt (with
 * its prompt id), its agent's words, its thinking (a block whose text Claude Code keeps out of the file), a tool call it
 * makes (before its PreToolUse) or the call's result (before its PostToolUse or PostToolUseFailure).
 */
export function written(s: Session, at: number, o: Written): void {
  const kind: Entry = 'prompt' in o ? 'prompt' : 'words' in o ? 'words' : 'thinking' in o ? 'thinking' : 'call' in o ? 'call' : 'result';
  const e = recordedEntry(kind);
  Object.assign(e, { parentUuid: null, uuid: randomUUID(), timestamp: new Date(at).toISOString(), cwd: s.cwd, sessionId: s.id });
  if ('session_id' in e) e.session_id = s.id;
  if ('prompt' in o) Object.assign(e, { promptId: o.promptId, message: { ...e.message, content: o.prompt } });
  else if ('words' in o) e.message = { ...e.message, id: `msg_01${ulid().slice(10)}`, content: [{ type: 'text', text: o.words }] };
  else if ('thinking' in o) e.message = { ...e.message, id: `msg_01${ulid().slice(10)}`, content: [{ type: 'thinking', thinking: '', signature: sha256(randomUUID()) }] };
  else if ('call' in o) e.message = { ...e.message, id: `msg_01${ulid().slice(10)}`, content: [{ type: 'tool_use', id: o.call.id, name: o.call.tool, input: o.call.input, caller: { type: 'direct' } }] };
  else {
    const text = o.error ?? (typeof o.output === 'string' ? o.output : JSON.stringify(o.output));
    Object.assign(e, { message: { role: 'user', content: [{ tool_use_id: o.result.id, type: 'tool_result', content: text, is_error: o.error !== undefined }] }, toolUseResult: o.error ?? o.output });
    if (o.promptId) e.promptId = o.promptId;
    delete e.sourceToolAssistantUUID;
  }
  appendFileSync(s.transcript, `${JSON.stringify(e)}\n`);
}
export interface Call { id: string; tool: 'Bash' | 'Edit' | 'Read'; input: Line }
export const callOf = (tool: Call['tool'], input: Line): Call => ({ id: `toolu_01${ulid().slice(10)}`, tool, input });
/** What a Read returns, in the recording's shape. */
export const readResponse = (read: Call): Line => ({ type: 'text', file: { filePath: read.input.file_path, content: 'export {};', numLines: 1, startLine: 1, totalLines: 1 } });
export interface Said { prompt?: string; call?: Call; response?: unknown; error?: string }
interface Payload extends Said { promptId?: string }
/** The payload Claude Code sends for `event` in session `s`. */
export function payloadOf(s: Session, event: string, o: Payload = {}): Line {
  const p = recordedPayload(event, o.call?.tool);
  p.session_id = s.id;
  p.transcript_path = s.transcript;
  p.cwd = s.cwd;
  if ('scratchpad_dir' in p) p.scratchpad_dir = `/private/tmp/claude-scratch/${s.id}/scratchpad`;
  if ('prompt_id' in p && o.promptId) p.prompt_id = o.promptId;
  if (event === 'UserPromptSubmit') p.prompt = o.prompt ?? 'carry on';
  if (o.call) {
    p.tool_name = o.call.tool;
    p.tool_input = o.call.input;
    if ('tool_use_id' in p) p.tool_use_id = o.call.id;
  }
  if (event === 'PostToolUse') p.tool_response = o.response ?? {};
  if (event === 'PostToolUseFailure') p.error = o.error ?? 'Exit code 1';
  if (event === 'PermissionRequest' && o.call) {
    const rule = o.call.tool === 'Bash' ? `${String(o.call.input.command).split(' ')[0]}:*` : String(o.call.input.file_path);
    p.permission_suggestions = [{ type: 'addRules', rules: [{ toolName: o.call.tool, ruleContent: rule }], behavior: 'allow', destination: 'session' }];
  }
  return p;
}

// ---- The run: a world, its hub on a stepped clock, one replica, the hooks and the clock (README, The surface).

export interface Reading { when: string; t: number; seen: Seen }
export class Sim {
  /** The record's clock at the replica's launch, exact once the first event is fed (its reply's `ts`). */
  private L: number | undefined;
  private readonly agents = new Map<string, number>();
  /** Each session's turn: the prompt id its hooks carry since its last prompt. */
  private readonly prompts = new Map<string, string>();
  /** The sessions whose agents are at work between hooks: their transcripts grow, as the model's thinking is written. */
  private readonly thinking = new Set<string>();
  private beat: NodeJS.Timeout | undefined;
  readonly readings: Reading[] = [];
  private constructor(readonly w: World, readonly r: Replica, private readonly conn: Conn, private fed: number) {}

  /** A world, its hub started again on a stepped clock, and a replica of its record at the reference window. */
  static async start(o: { plant?: string; reduced?: true } = {}): Promise<Sim> {
    const made = await makeWorld(WORLD);
    await stopHub(made.hub);
    const hub: Hub = await startHub({ home: made.home, env: { DEEP_HUB_TEST_CLOCK_STEPS: '1' } });
    await quiet(hub, 1000);
    const w: World = { ...made, hub };
    const r = await Replica.start(w.home, o.plant);
    try {
      await r.launch({ from: 'record_copy', size: [REFERENCE.width, REFERENCE.height], ...(o.reduced ? { reduced_motion: true } : {}) });
      const fed = (await r.see()).log_pos;
      return new Sim(w, r, await control(hub), fed);
    } catch (error) {
      await r.stop();
      throw error;
    }
  }
  async stop(): Promise<void> {
    clearInterval(this.beat);
    this.conn.close();
    await this.r.stop();
  }
  id(key: string): string { return `session:${sessionOf(this.w, key).id}`; }
  who(key: string): string { return `${this.id(key)} ("${sessionOf(this.w, key).title}")`; }
  /** The record's clock now, as the replica's views read it. */
  now(): number { return (this.L ?? this.r.launchSent) + Math.floor((this.r.t * 1000) / FLICKS); }

  private async hubClock(advance = 0): Promise<number> {
    const got = result(await this.conn.call('test.clock', { advance_ms: advance }, 30_000)) as Line;
    return typeof got.now === 'number' ? got.now : blocked(`the hub's test.clock answered no now: ${said(got)}`);
  }
  /**
   * Brings the hub's clock to the replica's. Behind, it steps forward. Ahead (the wall clock ran past the virtual one),
   * with `catchUp` the replica's clock first runs on to just past the hub's in one step; without it (inside a window
   * whose marks are read), the hub stays a little ahead.
   */
  private async align(catchUp: boolean): Promise<void> {
    const ahead = (await this.hubClock()) - this.now();
    if (ahead > 0 && catchUp) await this.r.waitTo(this.r.t + flicks(ahead + 300), ahead + 300);
    const behind = this.now() - (await this.hubClock());
    if (behind > 0) await this.hubClock(behind);
  }
  /** The agent's process for `key`: one `sleep` a day long, standing in for Claude Code. */
  private agent(key: string): number {
    let pid = this.agents.get(key);
    if (!pid) {
      const child = spawn('/bin/sleep', ['86400'], { stdio: 'ignore' });
      own(child.pid);
      pid = child.pid!;
      this.agents.set(key, pid);
    }
    return pid;
  }
  /** One hook from `key`'s agent at the replica's clock, through the hub's hook entry; what the hub appended, fed. */
  async hook(key: string, event: string, o: Said = {}, catchUp = true): Promise<Ev[]> {
    const s = sessionOf(this.w, key).session;
    const pid = this.agent(key);
    await this.align(catchUp);
    const at = this.now();
    if (event === 'UserPromptSubmit') {
      const promptId = randomUUID();
      this.prompts.set(key, promptId);
      written(s, at, { prompt: o.prompt ?? 'carry on', promptId });
    }
    const promptId = this.prompts.get(key);
    // Claude Code writes a call to the transcript before its PreToolUse, and its result before the hook that ends it.
    if (o.call && event === 'PreToolUse') written(s, at, { call: o.call });
    if (o.call && (event === 'PostToolUse' || event === 'PostToolUseFailure')) written(s, at, { result: o.call, output: o.response ?? '', ...(o.error !== undefined ? { error: o.error } : {}), ...(promptId ? { promptId } : {}) });
    const payload = payloadOf(s, event, { ...o, ...(promptId ? { promptId } : {}) });
    const seq = nextSeq(at);
    const sent = await sendHook(this.w.hub.socket, { v: 1, agent: 'claude-code', event, seq, id: ulid(at), matched: [], payload, pid, ppid: pid }, 30_000);
    if (sent.end !== 'reply' || sent.error) blocked(`the hub didn't take ${key}'s ${event} hook: ${sent.end} ${said(sent.error ?? '')}`);
    return this.feedNew(seq);
  }
  private async appended(): Promise<Ev[]> {
    return (result(await this.conn.call('events.read', { after: this.fed, limit: 1000 }, 30_000)).events ?? []) as Ev[];
  }
  /**
   * Every event the hub appended since the last feed, fed to the replica in log order: once the hook stamped `seq` has
   * its event (up to 10 s) and the log is still 600 ms; with no hook, once it is still a second.
   */
  async feedNew(seq?: string): Promise<Ev[]> {
    if (seq) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && !(await this.appended()).some((e) => e.seq === seq)) await sleep(50);
    }
    await quiet(this.w.hub, seq ? 600 : 1000);
    const got: Ev[] = [];
    for (;;) {
      const page = await this.appended();
      if (!page.length) return got;
      for (const e of page) {
        const { log_pos: _pos, ts: _ts, ...event } = e;
        const before = this.r.t;
        const reply = await this.r.feed(e.session ?? '', event);
        if (this.L === undefined && typeof reply.ts === 'number') this.L = reply.ts - Math.floor((before * 1000) / FLICKS);
        this.fed = e.log_pos;
        got.push(e);
      }
    }
  }
  /** The agent's message, as the record carries one (`session.activity`, as #1461 and #2028 feed it), and in its transcript. */
  async says(key: string, text: string): Promise<void> {
    const s = sessionOf(this.w, key);
    written(s.session, this.now(), { words: text });
    await this.r.feed(s.id, { v: 1, id: ulid(), kind: 'session.activity', writer: 'hook', actor: 'you', scope: 'you', subject: `session:${letters(s.id)}`, data: { activity: text } });
  }
  /**
   * `key`'s agent starts and its turn begins: SessionStart, its prompt, and one Read of `file`, begun and ended, so the
   * hub reads it working.
   */
  async begin(key: string, prompt: string, file = 'README.md'): Promise<void> {
    const read = callOf('Read', { file_path: join(sessionOf(this.w, key).session.cwd, file) });
    await this.hook(key, 'SessionStart');
    await this.hook(key, 'UserPromptSubmit', { prompt });
    await this.hook(key, 'PreToolUse', { call: read });
    await this.hook(key, 'PostToolUse', { call: read, response: readResponse(read) });
  }
  /**
   * `keys`' agents are at work between their hooks from now on: Claude Code writes the model's thinking to each one's
   * transcript, every 5 s of the wall clock and before each step of the hub's clock, and sends no hook for it. The hub
   * reads a transcript that grew as still at work (design: Hooks are evidence, "Unknown, not finished").
   */
  atWork(keys: readonly string[]): void {
    for (const key of keys) this.thinking.add(key);
    this.beat ??= setInterval(() => this.think(), 5000);
  }
  private think(): void {
    for (const key of this.thinking) written(sessionOf(this.w, key).session, this.now(), { thinking: true });
  }
  /** Runs the replica's clock `ms` on, a minute at a time (20 s while agents think), the hub's with it, feeding what it appends. */
  async run(ms: number, stepMs?: number): Promise<void> {
    const end = this.r.t + flicks(ms);
    while (this.r.t < end) {
      await this.r.waitTo(Math.min(end, this.r.t + flicks(this.thinking.size ? 20 * SECOND : MIN)), stepMs);
      this.think();
      await this.align(false);
      await this.feedNew();
    }
  }
  /** A press on `key`'s row, which selects it and opens its page; the pointer then rests on the page's title. */
  async select(key: string): Promise<void> {
    await this.r.click(this.id(key), `a press on ${this.who(key)}'s row`);
    await this.r.hover('page-title');
  }
  async read(when: string): Promise<Seen> {
    const seen = await this.r.see();
    this.readings.push({ when, t: this.r.t, seen });
    return seen;
  }
  /** The hub's control token: a value the hub holds, so on its scrub list (design: Privacy, "its own tokens"). */
  token(): string { return tokenOf(this.w.root); }
}

// ---- Reading the window (README, Pinned).

const ROW = /^(session|ask|quiet):[^:]+$/;
/** What a node says in words: its name, else the strings drawn inside it. */
export function textOf(s: Snapshot, n: SNode | undefined): string | null {
  if (!n) return null;
  if (typeof n.name === 'string' && n.name.trim()) return n.name.trim();
  const drawn = runsIn(s, n.bounds).map((r) => r.text).join(' ').trim();
  return drawn || null;
}
/** Everything a row says: its subtree's names and string values (but its mark's status entry, a code), and its runs. */
export function rowWords(s: Snapshot, id: string): string {
  const row = byId(s, id);
  if (!row) return '';
  const own = flat(row).flatMap((x) => [x.name ?? '', typeof x.value === 'string' && x.id !== `${id}:mark` ? x.value : '']);
  return [...own, ...runsIn(s, row.bounds).map((r) => r.text)].filter(Boolean).join('\n');
}
/** The line on a session's page (Pinned 1): the node `session-doing`, read while that session's page is shown. */
export function pageLine(seen: Seen, session: string): string | null {
  if (seen.address !== `session/${session}`) return null;
  return textOf(seen.snapshot, byId(seen.snapshot, 'session-doing'));
}
/** The row's accessible name: what VoiceOver reads for it. */
export const rowName = (seen: Seen, id: string): string | null => byId(seen.snapshot, id)?.name ?? null;
/** A list row's id, in the order the list draws them. */
export const drawnRows = (s: Snapshot): string[] => listRows(s).map((n) => String(n.id)).filter((id) => ROW.test(id));
/** A duration the window reads, in seconds: "now" is 0; "40 s", "2 min ago", "3 h" and the like. */
export function seconds(text: string | null): number | undefined {
  if (!text) return undefined;
  if (/\b(just )?now\b/i.test(text)) return 0;
  const m = /(\d+)\s*(s|sec|secs|seconds?|min|mins|minutes?|h|hours?|d|days?)\b/i.exec(text);
  if (!m) return undefined;
  const unit = m[2]!.toLowerCase();
  return Number(m[1]) * (unit.startsWith('s') ? 1 : unit.startsWith('m') ? 60 : unit.startsWith('h') ? 3600 : 86_400);
}

// ---- AC1: one mark still through 60 s of silence, one moving at each event, 2 s apart.

/** When the busy session's events come after the slow one's call starts, in seconds: every 2 s up to 58 s. */
const EVERY = Array.from({ length: 29 }, (_, i) => 2 * (i + 1));
/** Where in each 2 s the marks are pictured, in frames after the event: gaps of 2 to 37 frames, odd and even, so no animation's period hides. */
const AFTER = [1, 3, 7, 15, 31, 63, 100];
const FRAME = FLICKS / 60;
/** How long rows are left to settle after a state change before the list is read: #1461 keeps a leaving row's slot up to 2.5 s. */
const SETTLE = 3000;

/**
 * AC1's run (README, The fixture): `slow` starts a long build and its tool call sends nothing for 60 s, while `busy`'s
 * reads come every 2 s. Each mark is pictured just before each of busy's events and 1 to 100 frames after; what's
 * wrong, each naming its session.
 */
export async function markRun(plant?: string): Promise<string[]> {
  const sim = await Sim.start(plant ? { plant } : {});
  const { r } = sim;
  const out: string[] = [];
  try {
    await sim.begin('slow', 'Rebuild the product images');
    await sim.begin('busy', 'Tidy the product grid');
    await sim.run(SETTLE);
    const start = await sim.read('before the build starts');
    for (const key of ['slow', 'busy']) {
      const word = start.rows.find((x) => x.id === sim.id(key))?.word;
      if (word !== 'working') blocked(`${sim.who(key)} reads ${said(word)} after its prompt, not working, so its mark isn't a working mark`);
    }
    await sim.hook('slow', 'PreToolUse', { call: callOf('Bash', { command: 'npm run build:images', description: 'Rebuild the product images' }) });
    const t0 = r.t;
    await r.jump(t0 + flicks(2 * SECOND));
    const still = await r.shot(`${sim.id('slow')}:mark`);
    const moved: number[] = [];
    const pictureSlow = async (): Promise<void> => {
      if ((await r.shot(`${sim.id('slow')}:mark`)) !== still) moved.push(Math.round(((r.t - t0) * 10) / FLICKS) / 10);
    };
    const reads = [callOf('Read', { file_path: join(sessionOf(sim.w, 'busy').session.cwd, 'src/grid.ts') })];
    for (const [k, at] of EVERY.entries()) {
      await r.jump(t0 + flicks(at * SECOND) - FRAME);
      const before = await r.shot(`${sim.id('busy')}:mark`);
      await pictureSlow();
      const read = reads[reads.length - 1]!;
      if (k % 2 === 0) await sim.hook('busy', 'PreToolUse', { call: read }, false);
      else {
        await sim.hook('busy', 'PostToolUse', { call: read, response: readResponse(read) }, false);
        reads.push(callOf('Read', { file_path: join(sessionOf(sim.w, 'busy').session.cwd, `src/part${k}.ts`) }));
      }
      const fedAt = r.t;
      let changed = false;
      for (const frames of AFTER) {
        await r.jump(fedAt + frames * FRAME);
        if ((await r.shot(`${sim.id('busy')}:mark`)) !== before) changed = true;
        await pictureSlow();
      }
      if (!changed) out.push(`${sim.who('busy')}: its event at ${at} s (${k % 2 === 0 ? 'PreToolUse' : 'PostToolUse'} of a Read) didn't move its working mark: it was drawn the same before it and 1 to 100 frames after`);
    }
    await r.jump(t0 + flicks(60 * SECOND));
    await pictureSlow();
    if (moved.length) out.push(`${sim.who('slow')}: its tool call sent nothing for 60 s and its working mark moved at ${moved.slice(0, 8).join(', ')}${moved.length > 8 ? ', …' : ''} s after the call began (${moved.length} of its pictures from 2 s on differ from the one at 2 s)`);
    const end = await sim.read('60 s after the build started');
    if (end.rows.find((x) => x.id === sim.id('slow'))?.word !== 'working') out.push(`${sim.who('slow')} reads ${said(end.rows.find((x) => x.id === sim.id('slow'))?.word)} 60 s into its call, not working`);
  } finally {
    await sim.stop();
  }
  return out;
}

// ---- AC2: twenty working sessions, reduce motion on and off.

/** When each working session's one event comes in the 10 s window, in seconds. */
const AT = WORKING.map((_, k) => 0.3 + 0.45 * k);
/** When every mark is pictured in the window, in seconds, besides each session's own event. */
const GLOBAL = [0.13, 1.37, 2.71, 3.29, 4.83, 5.57, 6.11, 7.43, 8.17, 9.29, 9.97];
/** The row's time slot (#1461's `<row id>:time`), in words. */
const timeOf = (seen: Seen, id: string): string | null => textOf(seen.snapshot, byId(seen.snapshot, `${id}:time`));

/**
 * AC2's run (README, The fixture): every working session's agent starts; then, in a 10 s window, each sends one tool
 * call's PreToolUse, 0.45 s apart. Every mark is pictured at eleven moments, and each session's mark and time just before
 * its event and after it. What's wrong, each naming its session.
 */
export async function motionRun(reduced: boolean): Promise<string[]> {
  const sim = await Sim.start(reduced ? { reduced: true } : {});
  const { r } = sim;
  const out: string[] = [];
  const mode = reduced ? 'with reduce motion on' : 'with reduce motion off';
  try {
    sim.atWork(WORKING);
    for (const key of WORKING) await sim.begin(key, `Tidy up ${sessionOf(sim.w, key).title.toLowerCase()}`);
    await sim.run(SETTLE);
    const start = await sim.read('before the window');
    for (const key of WORKING) if (start.rows.find((x) => x.id === sim.id(key))?.word !== 'working') blocked(`${sim.who(key)} reads ${said(start.rows.find((x) => x.id === sim.id(key))?.word)} before the window, not working`);
    const w0 = r.t;
    const at = (s: number): number => w0 + flicks(s * SECOND);
    // Each picture of each mark, in order, with its moment in seconds.
    const pictures = new Map<string, { s: number; sha: string }[]>(WORKING.map((k) => [k, []]));
    const picture = async (key: string): Promise<string> => {
      const sha = await r.shot(`${sim.id(key)}:mark`);
      pictures.get(key)!.push({ s: (r.t - w0) / FLICKS, sha });
      return sha;
    };
    type Step = { s: number; act: () => Promise<void> };
    const steps: Step[] = GLOBAL.map((s) => ({ s, act: async () => { for (const key of WORKING) await picture(key); } }));
    const fired = new Map<string, { s: number; before: string; after: string; pre: string; moved: boolean }>();
    for (const [k, key] of WORKING.entries()) {
      steps.push({
        s: AT[k]!,
        act: async () => {
          const pre = await picture(key);
          const before = timeOf(await r.see(), sim.id(key)) ?? '(nothing)';
          await sim.hook(key, 'PreToolUse', { call: callOf('Read', { file_path: join(sessionOf(sim.w, key).session.cwd, 'README.md') }) }, false);
          const fedAt = r.t;
          const after = timeOf(await r.see(), sim.id(key)) ?? '(nothing)';
          let moved = false;
          for (const frames of [1, 3, 7, 15]) {
            await r.jump(fedAt + frames * FRAME);
            if ((await picture(key)) !== pre) moved = true;
          }
          fired.set(key, { s: (fedAt - w0) / FLICKS, before, after, pre, moved });
        },
      });
    }
    steps.sort((a, b) => a.s - b.s);
    for (const step of steps) {
      await r.jump(at(step.s));
      await step.act();
    }
    await r.jump(at(10));
    const end = await sim.read('at the end of the window');
    for (const key of WORKING) if (end.rows.find((x) => x.id === sim.id(key))?.word !== 'working') blocked(`${sim.who(key)} reads ${said(end.rows.find((x) => x.id === sim.id(key))?.word)} at the window's end, not working, so its marks weren't a working session's`);
    for (const key of WORKING) {
      const shots = pictures.get(key)!;
      const event = fired.get(key) ?? blocked(`${sim.who(key)}'s event never came`);
      if (reduced) {
        const first = shots[0]!;
        const moved = shots.filter((p) => p.sha !== first.sha).map((p) => p.s.toFixed(2));
        if (moved.length) out.push(`${mode}, ${sim.who(key)}'s working mark moved in the 10 s window: drawn differently at ${moved.slice(0, 5).join(', ')} s than at ${first.s.toFixed(2)} s (its event came at ${event.s.toFixed(2)} s)`);
        const now = seconds(event.after);
        if (event.after === event.before || now === undefined || now > 5) out.push(`${mode}, ${sim.who(key)}'s row didn't say when its last event came: its time read "${event.before}" before its event at ${event.s.toFixed(2)} s and "${event.after}" just after`);
        const left = 10 - event.s;
        const last = timeOf(end, sim.id(key));
        const read = seconds(last);
        if (read === undefined || (read !== 0 && Math.abs(read - left) > 2) || (read === 0 && left > 60)) out.push(`${mode}, ${sim.who(key)}'s row reads "${last ?? '(nothing)'}" at the window's end, ${left.toFixed(1)} s after its last event`);
      } else {
        const before = shots.filter((p) => p.s < event.s - 0.01);
        const settled = shots.filter((p) => p.s >= event.s + 2);
        const early = before.filter((p) => p.sha !== event.pre).map((p) => p.s.toFixed(2));
        if (early.length) out.push(`${mode}, ${sim.who(key)}'s working mark moved with no event of its own: at ${early.slice(0, 5).join(', ')} s, before its event at ${event.s.toFixed(2)} s`);
        const late = settled.filter((p) => p.sha !== settled[0]!.sha).map((p) => p.s.toFixed(2));
        if (late.length) out.push(`${mode}, ${sim.who(key)}'s working mark still moved at ${late.slice(0, 5).join(', ')} s, over 2 s after its one event at ${event.s.toFixed(2)} s`);
        if (!event.moved) out.push(`${mode}, ${sim.who(key)}'s working mark didn't move at its event at ${event.s.toFixed(2)} s`);
      }
    }
  } finally {
    await sim.stop();
  }
  return out;
}

// ---- AC3: the list from the keyboard, as VoiceOver reads it.

/** What the list's keys move between, in drawn order: its rows and, as #1462 has them, its projects' headings (`project:<id>`). */
const STOP = /^(session|ask|quiet|project):[^:]+$/;
const stops = (s: Snapshot): string[] => { const l = listOf(s); return l ? flat(l).map((n) => n.id).filter((id): id is string => typeof id === 'string' && STOP.test(id)) : []; };

/**
 * AC3's run (README, The fixture): F6 (up to three times) gives the list the keyboard, Up takes it to the top and Down to
 * the first session row; then Down walks the list in drawn order, its headings and its 30 session rows, each read by its
 * name; "shop" is typed; Return opens what has the keyboard. What's wrong, each naming its row.
 */
export async function keysRun(plant?: string): Promise<string[]> {
  const w = await makeWorld(WORLD);
  const r = await Replica.start(w.home, plant);
  const out: string[] = [];
  try {
    await r.launch({ from: 'record_copy', size: [REFERENCE.width, REFERENCE.height] });
    let seen = await r.see();
    const drawn0 = drawnRows(seen.snapshot);
    const rows = seen.rows.filter((x) => x.id.startsWith('session:'));
    if (rows.length !== WORLD.length) blocked(`the list holds ${rows.length} session rows, not the world's ${WORLD.length}: ${said(rows.map((x) => x.title), 600)}`);
    const first = drawn0.find((id) => id.startsWith('session:')) ?? blocked('the list draws no session row');
    const who = (id: string): string => (id.startsWith('project:') ? `the heading ${id}` : named(seen.rows, id));
    const inList = (f: unknown): f is string => typeof f === 'string' && STOP.test(f);
    const focus = (): unknown => seen.snapshot.focus;
    for (let i = 0; i < 3 && !inList(focus()); i++) { await r.press('f6'); seen = await r.see(); }
    for (let i = 0, was: unknown; i < 50 && inList(focus()) && focus() !== was; i++) { was = focus(); await r.press('up'); seen = await r.see(); }
    for (let i = 0; i < 50 && inList(focus()) && focus() !== first; i++) { await r.press('down'); seen = await r.see(); }
    if (focus() !== first) return [`the keyboard never reached the first row ${who(first)}: after F6, Up and Down the focus is ${said(focus())}`];
    /** What VoiceOver reads for the focused row: its name, holding its title and its state word, on a row drawn in the list's view. */
    const reading = (s: Seen, id: string): string[] => {
      const node = byId(s.snapshot, id);
      const list = listOf(s.snapshot);
      if (!node) return [`${who(id)} has the keyboard but isn't drawn, so VoiceOver has nothing of it to read`];
      if (list && (node.bounds[1]! < list.bounds[1]! - 1 || node.bounds[1]! + node.bounds[3]! > list.bounds[1]! + list.bounds[3]! + 1)) return [`${who(id)} has the keyboard but is drawn outside the list's view (its bounds ${said(node.bounds)}, the list's ${said(list.bounds)})`];
      const row = s.rows.find((x) => x.id === id);
      const name = node.name ?? '';
      const missing = [row?.title, row?.word].filter((x): x is string => !!x && !name.includes(x));
      return missing.length ? [`VoiceOver on ${who(id)} reads ${said(name)}, without ${missing.map((m) => `"${m}"`).join(' or ')}`] : [];
    };
    const walked = [first];
    out.push(...reading(seen, first));
    for (let at: string = first; walked.length < WORLD.length;) {
      const order = stops(seen.snapshot);
      const i = order.indexOf(at);
      const next = i >= 0 ? order[i + 1] : undefined;
      await r.press('down');
      seen = await r.see();
      const n = `${walked.length} of ${WORLD.length}`;
      if (!next) { out.push(`${i < 0 ? `${who(at)} isn't drawn` : `nothing is drawn below ${who(at)}`} with ${n} rows walked, so Down can't walk on in drawn order (Down put the keyboard on ${said(focus())})`); break; }
      if (focus() !== next) { out.push(`Down on ${who(at)} put the keyboard on ${said(focus())}, not ${who(next)}, drawn below it (${n} rows walked)`); break; }
      at = next;
      if (!next.startsWith('project:')) { out.push(...reading(seen, next)); walked.push(next); }
    }
    if (new Set(walked).size !== walked.length) out.push(`the walk came back to a row it had read: ${said(walked)}`);
    // Typing "shop" moves the keyboard to shop (its heading or its first session) and hides no row: the list has no filter.
    const listed = seen.rows.map((x) => x.id);
    await r.press('s h o p');
    seen = await r.see();
    const shop = rows.filter((x) => x.project === 'shop').map((x) => x.id);
    const onShop = (f: unknown): boolean => typeof f === 'string' && (shop.includes(f) || (f.startsWith('project:') && byId(seen.snapshot, f)?.name === 'shop'));
    if (!onShop(focus())) out.push(`typing "shop" put the keyboard on ${said(focus())}, not on shop's heading or one of shop's sessions`);
    for (const id of listed) if (!seen.rows.some((x) => x.id === id)) out.push(`typing "shop" took ${who(id)} out of the list`);
    for (const id of shop) if (!seen.rows.some((x) => x.id === id)) out.push(`after typing "shop", shop's session ${named(rows, id)} isn't listed`);
    // Return opens what has the keyboard.
    const focused = focus();
    const address = typeof focused === 'string' ? (focused.startsWith('project:') ? `project/${focused.slice('project:'.length)}` : seen.rows.find((x) => x.id === focused)?.address) : undefined;
    await r.press('enter');
    seen = await r.see();
    if (!inList(focused) || seen.address !== address) out.push(`Return on ${inList(focused) ? who(focused) : said(focused)} opened ${said(seen.address)}, not ${said(address)}`);
    return out;
  } finally {
    await r.stop();
  }
}

// ---- AC4, AC5, AC6: what a working session is doing now, on its page and in its row's name.

/** The recorded turn's commands, files and words (README, The fixture). */
export const TURN = {
  prompt: 'The cart total rounds wrong; fix it and run the tests',
  file: 'cart/total.ts',
  test: 'npm test',
  retry: 'npm test -- cart',
  message: 'Almost done, fixing tests',
  failure: 'Exit code 1\n> shop@1.0.0 test\n> vitest run\n\n FAIL  cart/total.test.ts > rounds to cents',
};
export type Part = 'turn' | 'scrub' | 'silence';

/**
 * AC4 to AC6's run (README, The fixture), the parts asked for. `turn`: `cart` takes its prompt, starts its Edit of
 * cart/total.ts, is selected (the list read before and after), ends the Edit, says "Almost done, fixing tests", runs
 * `npm test` for 40 s, which fails, runs it again and is held at its own permission prompt. `scrub`: `deploy` takes its
 * prompt, is selected, runs a `curl` whose header holds the hub's control token, which succeeds. `silence`: ten minutes
 * with no event, read each minute. Every reading kept, named.
 */
export async function lineRun(parts: readonly Part[], plant?: string): Promise<{ readings: Reading[]; ids: { cart: string; deploy: string }; names: { cart: string; deploy: string }; token: string }> {
  const sim = await Sim.start(plant ? { plant } : {});
  const ids = { cart: sessionOf(sim.w, 'cart').id, deploy: sessionOf(sim.w, 'deploy').id };
  const names = { cart: sim.who('cart'), deploy: sim.who('deploy') };
  const token = sim.token();
  try {
    if (parts.includes('turn')) {
      const cwd = sessionOf(sim.w, 'cart').session.cwd;
      await sim.hook('cart', 'SessionStart');
      await sim.hook('cart', 'UserPromptSubmit', { prompt: TURN.prompt });
      await sim.run(1000);
      const edit = callOf('Edit', { file_path: join(cwd, TURN.file), old_string: 'return Math.round(total)', new_string: 'return Math.round(total * 100) / 100', replace_all: false });
      await sim.hook('cart', 'PreToolUse', { call: edit });
      await sim.run(SETTLE);
      await sim.read('select: before the working row is selected');
      await sim.select('cart');
      await sim.r.wait(200);
      await sim.read('select: the working row selected');
      await sim.hook('cart', 'PostToolUse', {
        call: edit,
        response: { filePath: edit.input.file_path, oldString: edit.input.old_string, newString: edit.input.new_string, originalFile: 'export const total = (xs: number[]) => {\n  const total = xs.reduce((a, b) => a + b, 0);\n  return Math.round(total)\n};\n', structuredPatch: [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-  return Math.round(total)', '+  return Math.round(total * 100) / 100'] }], userModified: false, replaceAll: false },
      });
      await sim.read('turn: right after the Edit of cart/total.ts ended');
      await sim.run(1000);
      await sim.says('cart', TURN.message);
      await sim.run(1000);
      await sim.read('turn: after the agent said "Almost done, fixing tests"');
      const test = callOf('Bash', { command: TURN.test, description: 'Run the tests' });
      await sim.hook('cart', 'PreToolUse', { call: test });
      const began = sim.r.t;
      await sim.read('turn: right after npm test began');
      // The 40 s: read around it, so neither rounding nor the hub's own stamp a moment late decides it.
      await sim.run(40_000 - 100, 1000);
      for (const ms of [100, 300, 300, 300]) { await sim.r.wait(ms); await sim.read(`turn: 40 s of npm test, ${((sim.r.t - began) / FLICKS).toFixed(2)} s after its events were fed`); }
      await sim.hook('cart', 'PostToolUseFailure', { call: test, error: TURN.failure });
      await sim.read('turn: right after npm test failed');
      await sim.run(1000);
      await sim.read('turn: a second after npm test failed');
      const retry = callOf('Bash', { command: TURN.retry, description: 'Run the cart tests' });
      await sim.hook('cart', 'PreToolUse', { call: retry });
      await sim.hook('cart', 'PermissionRequest', { call: retry });
      await sim.read('turn: right after the permission prompt for npm');
      await sim.run(1000);
      await sim.read('turn: a second into the permission prompt for npm');
    }
    if (parts.includes('scrub')) {
      await sim.begin('deploy', 'Check the deploy health endpoint', 'deploy/health.md');
      await sim.run(SETTLE);
      await sim.select('deploy');
      await sim.r.wait(200);
      const curl = callOf('Bash', { command: `curl -sS -H "Authorization: Bearer ${token}" http://127.0.0.1:8080/health`, description: 'Check the health endpoint' });
      await sim.hook('deploy', 'PreToolUse', { call: curl });
      await sim.read('scrub: right after the curl began');
      await sim.run(2000);
      await sim.read('scrub: 2 s into the curl');
      await sim.hook('deploy', 'PostToolUse', { call: curl, response: { stdout: '{"ok":true}', stderr: '', interrupted: false, isImage: false, noOutputExpected: false } });
      await sim.read('scrub: right after the curl ended');
      if (parts.includes('silence')) {
        sim.atWork(['deploy']);
        const ended = sim.r.t;
        for (let m = 1; m <= 10; m++) {
          await sim.run(Math.round(((ended + flicks(m * MIN + (m === 10 ? 5 * SECOND : 0)) - sim.r.t) * 1000) / FLICKS), 1000);
          await sim.read(`silence: ${m} min with no event${m === 10 ? ' (and 5 s)' : ''}`);
        }
      }
    }
  } finally {
    await sim.stop();
  }
  return { readings: sim.readings, ids, names, token };
}
export type LineRun = Awaited<ReturnType<typeof lineRun>>;

const pick = (run: LineRun, prefix: string): Reading[] => run.readings.filter((x) => x.when.startsWith(prefix));
/** "<step>" alone, or followed by " · <time>". */
const step = (text: string): RegExp => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}( · .+)?$`);
const STALL = /\b(stuck|stalled|idle)\b/i;

/** What a session's line reads at a reading: on its page (while shown) and in its row's name. */
function lineAt(x: Reading, session: string): { page: string | null; name: string | null } {
  return { page: pageLine(x.seen, session), name: rowName(x.seen, `session:${session}`) };
}
/** The line must read `want` on the page and inside the row's name; else what it read, naming the session. */
function reads(x: Reading, session: string, who: string, want: RegExp, wantName: string, label = `"${wantName}", alone or with its time`): string[] {
  const { page, name } = lineAt(x, session);
  const out: string[] = [];
  if (x.seen.address !== `session/${session}`) out.push(`${who}: ${x.when}, the window shows ${said(x.seen.address)}, not its page`);
  else if (!want.test(page ?? '')) out.push(`${who}: ${x.when}, its page's line (session-doing) reads ${said(page)}, not ${label}`);
  if (!(name ?? '').includes(wantName)) out.push(`${who}: ${x.when}, its row's accessible name reads ${said(name)}, without "${wantName}"`);
  return out;
}

/** AC4's judge, on the `turn` part. */
export function turnFailures(run: LineRun): string[] {
  const s = run.ids.cart;
  const who = run.names.cart;
  const at = (prefix: string): Reading => pick(run, prefix)[0] ?? blocked(`the run has no reading "${prefix}"`);
  const out: string[] = [];
  out.push(...reads(at('turn: right after the Edit'), s, who, step('Edited cart/total.ts'), 'Edited cart/total.ts'));
  out.push(...reads(at('turn: right after npm test began'), s, who, step('Running npm'), 'Running npm'));
  const forty = pick(run, 'turn: 40 s of npm test');
  const lines = forty.map((x) => lineAt(x, s));
  if (!lines.some((l) => l.page === 'Running npm · 40 s')) out.push(`${who}: from 40.0 to 41.0 s into npm test, its page's line read ${said(lines.map((l) => l.page))}, never "Running npm · 40 s"`);
  if (!lines.some((l) => (l.name ?? '').includes('Running npm · 40 s'))) out.push(`${who}: from 40.0 to 41.0 s into npm test, its row's accessible name read ${said(lines.map((l) => l.name), 600)}, never with "Running npm · 40 s"`);
  for (const when of ['turn: right after npm test failed', 'turn: a second after npm test failed']) {
    const x = at(when);
    out.push(...reads(x, s, who, step("Couldn't run npm"), "Couldn't run npm"));
    const { page, name } = lineAt(x, s);
    if (/Running npm/.test(`${page ?? ''}\n${name ?? ''}`)) out.push(`${who}: ${x.when}, it still reads "Running npm": page ${said(page)}, name ${said(name)}`);
  }
  for (const when of ['turn: right after the permission prompt', 'turn: a second into the permission prompt']) {
    const x = at(when);
    out.push(...reads(x, s, who, step('Waiting for you to allow: run npm'), 'Waiting for you to allow: run npm'));
    const word = x.seen.rows.find((r) => r.id === `session:${s}`)?.word;
    if (word !== 'needs you') out.push(`${who}: ${x.when}, its row's state word is ${said(word)}, not needs you (#992)`);
    if (!(rowName(x.seen, `session:${s}`) ?? '').includes('needs you')) out.push(`${who}: ${x.when}, its row's accessible name reads ${said(rowName(x.seen, `session:${s}`))}, without "needs you"`);
  }
  for (const x of pick(run, 'turn:')) {
    const { page, name } = lineAt(x, s);
    if (`${page ?? ''}\n${name ?? ''}`.includes(TURN.message)) out.push(`${who}: ${x.when}, it reads the agent's own words "${TURN.message}": page ${said(page)}, name ${said(name)}`);
  }
  return out;
}

/** The words of the curl command past its first, none of which the line may show. */
const CURL_WORDS = ['-sS', 'Authorization', 'Bearer', '127.0.0.1', '/health'];
/** AC5's judge, on the `scrub` part, and with `silence` the ten minutes. */
export function scrubFailures(run: LineRun, silence: boolean): string[] {
  const s = run.ids.deploy;
  const who = run.names.deploy;
  const at = (prefix: string): Reading => pick(run, prefix)[0] ?? blocked(`the run has no reading "${prefix}"`);
  const out: string[] = [];
  for (const when of ['scrub: right after the curl began', 'scrub: 2 s into the curl']) {
    const x = at(when);
    out.push(...reads(x, s, who, /^Running curl( · \d+ (s|min|h|d)( ago)?)?$/, 'Running curl', '"Running curl" and at most its time: the command\'s first word only'));
    const name = rowName(x.seen, `session:${s}`) ?? '';
    const shown = CURL_WORDS.filter((word) => name.includes(word));
    if (shown.length) out.push(`${who}: ${x.when}, its row's accessible name shows more of the command than its first word: ${shown.map((w) => `"${w}"`).join(', ')} in ${said(name)}`);
  }
  out.push(...reads(at('scrub: right after the curl ended'), s, who, step('Ran curl'), 'Ran curl'));
  for (const x of [...pick(run, 'scrub:'), ...pick(run, 'silence:')]) {
    const text = [rowWords(x.seen.snapshot, `session:${s}`), pageLine(x.seen, s) ?? '', JSON.stringify(x.seen.rows.find((r) => r.id === `session:${s}`) ?? {})].join('\n');
    const found = formsIn(text, { 'the hub\'s control token': run.token });
    if (found.length) out.push(`${who}: ${x.when}, its row holds a value the hub scrubs: ${found.join(', ')}`);
  }
  if (silence) {
    for (const x of pick(run, 'silence:')) {
      const words = `${rowWords(x.seen.snapshot, `session:${s}`)}\n${pageLine(x.seen, s) ?? ''}`;
      const hit = STALL.exec(words);
      if (hit) out.push(`${who}: ${x.when}, its row says "${hit[0]}": ${said(words.replace(/\n/g, ' | '), 400)}`);
    }
    out.push(...reads(at('silence: 10 min'), s, who, /^Ran curl · 10 min ago$/, 'Ran curl', '"Ran curl · 10 min ago"'));
  }
  return out;
}

/** AC6's judge, on the `turn` part: the list's rows before and after the working row was selected. */
export function selectFailures(run: LineRun): string[] {
  const before = pick(run, 'select: before')[0] ?? blocked('the run has no reading before the selection');
  const after = pick(run, 'select: the working row selected')[0] ?? blocked('the run has no reading after the selection');
  const selected = `session:${run.ids.cart}`;
  const who = (id: string): string => (id === selected ? `the selected row ${run.names.cart}` : named(after.seen.rows, id));
  const out: string[] = [];
  if (after.seen.address !== `session/${run.ids.cart}`) out.push(`a press on ${run.names.cart}'s row left the window on ${said(after.seen.address)}, not its page`);
  const was = new Map(drawnRows(before.seen.snapshot).map((id) => [id, byId(before.seen.snapshot, id)!.bounds]));
  const now = new Map(drawnRows(after.seen.snapshot).map((id) => [id, byId(after.seen.snapshot, id)!.bounds]));
  if (!was.has(selected)) out.push(`${run.names.cart}'s row isn't drawn before it is selected`);
  // The selected row first, so a failure names it before the rows it pushed.
  for (const id of [selected, ...[...was.keys()].filter((x) => x !== selected)]) {
    const a = was.get(id);
    const b = now.get(id);
    if (!a) continue;
    if (!b) out.push(`selecting ${run.names.cart} took ${who(id)} out of the list`);
    else if (a[3] !== b[3]) out.push(`selecting ${run.names.cart} made ${who(id)} ${b[3]} px tall, from ${a[3]}`);
    else if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) out.push(`selecting ${run.names.cart} moved ${who(id)} from ${said(a)} to ${said(b)}`);
  }
  for (const id of now.keys()) if (!was.has(id)) out.push(`selecting ${run.names.cart} added ${named(after.seen.rows, id)} to the list`);
  return out;
}
