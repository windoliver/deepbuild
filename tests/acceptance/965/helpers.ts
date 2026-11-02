// Shared test-side tools for #965's acceptance tests (README): the criterion tags; a world (the #29 suite's home and git
// repository, with one ask whose definition names a 2 s fast-lane check and a 300 s journey, and the record seeded with
// their clean runs so the gate runner expects those times); `deep hub run` with two check slots and a stepped clock;
// Claude Code sessions played through the real deep-hook binary, with a `deep mcp` and background commands of their
// own (fixtures/agent.mjs); and the record read back through the hub's socket. Nothing here stands in for the hub, the
// gate runner, deep-hook or deep mcp: every reading comes from them. The #29 suite's hub helpers (tests/acceptance/29/
// h-d.ts: the world, the socket, `events.read`, the process cleanup) are imported, never copied.
//
// Safety: folders are under /tmp/dh29-* (made by h-d.ts's makeWorld); no network (the forge is a closed local port), no
// model, no real `claude`, no sign-in; every process a test starts is stopped by its PID, or its process group by the
// group's ID, never by name or port.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRecord, ulid, type Connection } from '../../../packages/record/src/index.ts';
import {
  alive, allEvents, childEnv, cleanup as cleanup29, CLI, control, COVERED, DEEP_HOOK, draftFor, makeWorld, NODE, own, parseObject, REPO, req,
  settle, sleep, type Ev, type Hub, type Line, type Ran, type World,
} from '../29/h-d.ts';

export { alive, allEvents, CLI, DEEP_HOOK, settle, sleep, type Ev, type Hub, type Line, type Ran, type World };
/** A hook's stdout as Claude Code reads it: one JSON object, or undefined. */
export const parseLine = (raw: string): Line | undefined => parseObject(raw.trim());

// ---- Criterion tags: `#965.<first 8 hex of the SHA-256 of the criterion's text>`, as scripts/proof-change.mjs computes them.
export const AC1 = 'AC1 #965.2723aec9';
export const AC2 = 'AC2 #965.932ea160';
export const AC3 = 'AC3 #965.3dfb5f43';
export const AC4 = 'AC4 #965.a4f3c27b';
export const AC5 = 'AC5 #965.ef38e013';

export const SECOND = 1000;
export const MINUTE = 60_000;
/** The ask every session types: it opens one task, whose definition names the checks below. */
export const TASK = 'make the cart total round each line to cents';
/** The file each turn changes. */
export const CART = 'src/cart.ts';
/** The checks, by the path their definition names: the 2 s fast-lane check, the 300 s journey and AC3's 20-minute check. */
export const UNIT = '.deepbuild/checks/unit.sh';
export const J = '.deepbuild/checks/journey.sh';
export const SOAK = '.deepbuild/checks/soak.sh';
/** The background command AC5 names, as the session runs it and as the row names it. */
export const E2E = 'npm run e2e';
/** The lines the issue quotes. */
export const WAKE_LINE = '1 check waits for the loop · wake-up';
export const E2E_LINE = `1 check waits for the loop · ${E2E} in the background`;
export const CRON_LINE = '1 check waits for the loop · cron';

/** Every process group a test started in the background: stopped by its group ID at cleanup. */
const groups = new Set<number>();
export async function cleanup(): Promise<void> {
  for (const g of groups) try { process.kill(-g, 'SIGKILL'); } catch { /* gone */ }
  groups.clear();
  await cleanup29();
}

// ---- The world.
const g = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
  cwd, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dirname(cwd), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
}).trim();
/** A drafted check: `sh` runs a node:test suite of one test that passes after `ms` of real time, so the command check kind counts it (#30). */
function writeCheck(repo: string, path: string, ms: number): void {
  const suite = path.replace(/\.sh$/, '.test.mjs');
  writeFileSync(join(repo, path), `#!/bin/sh\nnode --test ${suite}\n`);
  chmodSync(join(repo, path), 0o755);
  writeFileSync(join(repo, suite), `import { test } from 'node:test';\ntest('${path}', async () => { await new Promise((done) => setTimeout(done, ${ms})); });\n`);
}
/** The claim the seeded runs name: no session's. */
const SEEDED = 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H';
/** The core's connection, as the gate runner's runs are recorded. */
const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };
/** Five clean runs of a check, each `ms` long, a day ago: the gate runner's expected time for it, the median of its last clean runs, is `ms`. */
async function seed(ledger: string, times: Record<string, number>): Promise<void> {
  const record = await openRecord({ path: ledger, now: Date.now });
  try {
    let t = Date.now() - 86_400_000;
    for (const [check, ms] of Object.entries(times)) {
      for (let i = 0; i < 5; i++) {
        t += ms + 60_000 + Math.floor(Math.random() * 1000);
        const run = `run:${ulid(t)}`;
        await record.append(CORE, { v: 1, id: ulid(t), kind: 'run.started', ts: t, subject: run, data: { run, check, claim: SEEDED, commit: 'a'.repeat(40) } });
        await record.append(CORE, {
          v: 1, id: ulid(t + ms), kind: 'run.finished', ts: t + ms, subject: run,
          data: { run, outcome: 'passed', tests_run: 1, passed: 1, runs: 1, evidence: [], check, assertion: null, expected: null, actual: null, step: null, points_to: null, findings: [], environment: 'test' },
        });
      }
    }
  } finally {
    await record.close();
  }
}
export interface WorldOptions {
  /** AC3's 20-minute check beside the journey. */
  soak?: boolean;
  /** How long the journey's run really takes, in real time; by default it runs on past the test. */
  journeyRealMs?: number;
}
/**
 * The #29 suite's world (a home and a git repository) with `src/cart.ts`, and one ask, TASK, whose handed definition
 * has R1 checked by UNIT (unit depth) and R2 by J (journey depth), both `on_base: passes`, and with `soak` R3 by SOAK.
 * The drafted checks are committed; the hub's record (`<home>/.deepbuild/ledger.db`) holds five clean runs of UNIT at
 * 2 s, of J at 300 s and of SOAK at 20 minutes, so the gate runner expects those times. Each check really takes: UNIT
 * 2 s, J `journeyRealMs` (default an hour), SOAK an hour.
 */
export async function world(o: WorldOptions = {}): Promise<World> {
  const requirements = [
    req('R1', 'each line of the cart total is rounded to cents', { check: UNIT, on_base: 'passes', depth: 'unit' }),
    req('R2', 'checkout shows the rounded total', { check: J, on_base: 'passes', depth: 'journey' }),
    ...(o.soak ? [req('R3', 'the total stays rounded under a long checkout soak', { check: SOAK, on_base: 'passes', depth: 'journey' })] : []),
  ];
  const w = makeWorld({ drafts: [draftFor(TASK, { requirements, deliverables: [CART] })] });
  writeFileSync(join(w.repo, CART), 'export function total(lines: number[]): number {\n  return lines.reduce((a, b) => a + b, 0);\n}\n');
  writeCheck(w.repo, UNIT, 2000);
  writeCheck(w.repo, J, o.journeyRealMs ?? 3_600_000);
  if (o.soak) writeCheck(w.repo, SOAK, 3_600_000);
  g(w.repo, 'add', '-A');
  g(w.repo, 'commit', '-qm', 'the cart and its drafted checks');
  const base = g(w.repo, 'rev-parse', 'HEAD');
  await seed(join(w.root, 'ledger.db'), { [UNIT]: 2000, [J]: 300_000, ...(o.soak ? { [SOAK]: 20 * MINUTE } : {}) });
  return { ...w, base };
}

// ---- The hub as a process, with two check slots and a stepped clock.
/**
 * `deep hub run` with HOME the world's and h-d.ts's test settings, plus (README, Surfaces): DEEP_HUB_TEST_CORES=4, so
 * the hub's check slots (its `cpu.slot` pool, half the cores) are two; DEEP_HUB_TEST_CLOCK_STEPS=1, so it serves
 * `test.clock`; DEEP_HUB_TEST_FORGE at a closed local port, so a pull request's receipt never reaches the network; and
 * DEEP_HUB_PLANT when given. A hub that doesn't start (a plant it doesn't list) is BLOCKED.
 */
export async function startHub(w: World, plant?: string): Promise<Hub> {
  const env = childEnv(w.home, {
    DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_WORK: w.work, DEEP_HUB_PLANT: plant,
    DEEP_HUB_TEST_CORES: '4', DEEP_HUB_TEST_CLOCK_STEPS: '1', DEEP_HUB_TEST_FORGE: 'http://127.0.0.1:9',
  });
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
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub${plant ? ` with the plant DEEP_HUB_PLANT=${plant}` : ''} did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, readyAt: Date.now(), clock: undefined, plant, stderr: () => err };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 30_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(50);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  await hub.exit;
}

/**
 * The hub's clock as this test moves it (README, Surfaces: `test.clock`). The hub's clock is the wall clock plus every
 * step the test asked for, so `now()` here is the hub's now. `pass(ms)` lets `ms` pass on it: by `test.clock`
 * `{ advance_ms }` where the hub serves it, then a second of real time for what comes due to run; where it doesn't (the
 * base), by waiting in real time, which this suite does only for a minute or less: a longer wait on such a hub is
 * BLOCKED, never a pass.
 */
export class Clock {
  private advanced = 0;
  private stepped: boolean | undefined;
  constructor(private readonly hub: Hub) {}
  now(): number { return Date.now() + this.advanced; }
  async pass(ms: number): Promise<void> {
    if (ms <= 0) return;
    if (this.stepped !== false) {
      try {
        const r = await control(this.hub, 'test.clock', { advance_ms: ms });
        this.stepped = true;
        this.advanced += ms;
        if (typeof r.now === 'number' && Math.abs(r.now - this.now()) > 5000) throw Error(`test.clock says the hub's clock is ${r.now}, but the test moved it to about ${this.now()}`);
        await sleep(1000);
        return;
      } catch (error) {
        if (!/unknown_method|serves no method/.test(String((error as Error).message))) throw error;
        this.stepped = false;
      }
    }
    if (ms > 90_000) throw Error(`BLOCKED: the hub serves no test.clock (README, Surfaces), so ${Math.round(ms / 1000)} s can't be let pass on its clock`);
    await sleep(ms);
  }
}

// ---- Each session's Claude Code (fixtures/agent.mjs).
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
class Agent {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Line) => void>();
  readonly pid: number;
  private constructor(private readonly child: ChildProcess) {
    this.pid = child.pid!;
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = parseObject(this.buffer.slice(0, i));
        this.buffer = this.buffer.slice(i + 1);
        if (!line || typeof line.n !== 'number') continue;
        // A hook run's start: its PID, owned so cleanup can stop it. A background command's start is its answer.
        if ('pid' in line && !('code' in line) && !this.waitsForPid.has(line.n)) { own(Number(line.pid)); continue; }
        const done = this.pending.get(line.n);
        this.pending.delete(line.n);
        this.waitsForPid.delete(line.n);
        done?.(line);
      }
    });
    child.on('exit', () => {
      for (const [n, done] of [...this.pending]) { this.pending.delete(n); done({ n, code: null, failed: 'the session\'s agent process exited', stdout: '', stderr: '' }); }
    });
  }
  private readonly waitsForPid = new Set<number>();
  static start(w: World): Agent {
    const child = spawn(NODE, [AGENT, DEEP_HOOK, CLI], { cwd: w.tmp, env: childEnv(w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: w.repo }), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Agent(child);
  }
  send(command: Line, o: { pid?: boolean } = {}): Promise<Line> {
    const n = ++this.n;
    if (o.pid) this.waitsForPid.add(n);
    return new Promise((resolve) => {
      this.pending.set(n, resolve);
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
}

let calls = 0;
let rpc = 0;
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomBytes(6).toString('hex')}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });
/** What deep-hook's output tells Claude Code: exit 2 or a deny/block decision stops the call; exit 0 lets it go. */
const allowed = (r: Ran): boolean => {
  const out = parseObject(r.stdout.trim());
  const d = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  return r.code === 0 && (d === undefined || d === 'allow');
};
const shownRan = (r: Ran) => `exit ${r.code}${r.timedOut ? ' (timed out)' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;

/** A stop as the session saw it: deep-hook's run, the line the chat shows (`systemMessage`), and when it was sent and replied, on the hub's clock. */
export interface StopSeen { ran: Ran; line: string; block: string | undefined; at: number; repliedAt: number }

/** A Claude Code session: its transcript, its own Claude Code process, and its hooks fired through deep-hook. */
export class Session {
  readonly id: string;
  readonly cwd: string;
  readonly transcript: string;
  private readonly agent: Agent;
  private promptId: string | undefined;
  private parent: string | null = null;
  private turn = 0;
  private mcpReady = false;
  constructor(readonly w: World, readonly clock: Clock) {
    this.id = randomUUID();
    this.cwd = w.repo;
    this.transcript = join(w.home, '.claude/projects', w.repo.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
    this.agent = Agent.start(w);
  }
  /** The session's handle as the core writes it in its events' data: `session:<letters>`. */
  get handle(): string { return `session:${this.id.replace(/[^0-9A-Za-z]/g, '')}`; }
  entry(value: Line): void {
    const uuid = randomUUID();
    const line = { parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.cwd, sessionId: this.id, version: COVERED, gitBranch: 'main' };
    this.parent = uuid;
    writeFileSync(this.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
  }
  async hook(event: string, fields: Line = {}, timeoutMs = 150_000): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.promptId && event !== 'SessionStart' ? { prompt_id: this.promptId } : {}), ...fields };
    return (await this.agent.send({ op: 'hook', args: ['claude-code', event], cwd: this.cwd, input: JSON.stringify(body), timeoutMs })) as unknown as Ran;
  }
  async start(): Promise<void> {
    const r = await this.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook must end with exit 0: ${shownRan(r)}`);
  }
  private async submit(text: string, entry: Line): Promise<Ran> {
    this.promptId = randomUUID();
    this.turn += 1;
    this.entry({ promptId: this.promptId, type: 'user', message: { role: 'user', content: text }, turnPosition: { promptIndex: 0, turnIndex: this.turn }, ...entry });
    const r = await this.hook('UserPromptSubmit', { prompt: text });
    if (r.code !== 0 && r.code !== 2) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shownRan(r)}`);
    return r;
  }
  /** A prompt you typed (turnOrigin human). */
  typed(text: string): Promise<Ran> { return this.submit(text, { origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' }); }
  /** A `/loop` wake-up's prompt (turnOrigin scheduled), as Claude Code 2.1.304 writes it. */
  scheduled(text: string): Promise<Ran> { return this.submit(text, { isMeta: true, promptSource: 'system', queueSkipSlashCommands: true, turnOrigin: 'scheduled' }); }
  /** A message from another Claude Code session (turnOrigin peer, hostInjected): origin `session`. */
  peer(text: string, from = 'local_8f6f9e9a-898e-4858-aefe-44dfc1b77684'): Promise<Ran> {
    return this.submit(text, { isMeta: true, promptSource: 'system', queueSkipSlashCommands: true, queueSkipAttachments: true, turnOrigin: 'peer', origin: { kind: 'peer', from, hostInjected: true } });
  }
  /** A background command's end notice, as Claude Code 2.1.304 queues it: an automatic prompt (turnOrigin task_notification). */
  notice(call: string, command: string): Promise<Ran> {
    const task = `b${randomBytes(4).toString('hex')}`;
    const text = `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>${call}</tool-use-id>\n<output-file>/private/tmp/claude-502/${this.id}/tasks/${task}.output</output-file>\n<status>completed</status>\n<summary>Background command "${command}" completed (exit code 0)</summary>\n</task-notification>`;
    return this.submit(text, { isMeta: true, promptSource: 'system', origin: { kind: 'task-notification', producer: 'session-task' }, turnOrigin: 'task_notification', queueSkipAttachments: true });
  }
  /** A message you type while the agent works: Claude Code's queue entry in the transcript, read at the next hook. */
  queue(text: string): void {
    writeFileSync(this.transcript, `${JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date().toISOString(), sessionId: this.id, content: text })}\n`, { flag: 'a' });
  }
  /** One tool call: its tool_use entry and PreToolUse; when allowed, `effect`, its tool_result entry and PostToolUse. */
  async call(tool_name: string, tool_input: Line, o: { response?: Line; effect?: () => void | Promise<void> } = {}): Promise<{ id: string; after: Ran }> {
    const id = `toolu_${randomBytes(10).toString('hex')}${++calls}`;
    this.entry(assistant([{ type: 'tool_use', id, name: tool_name, input: tool_input }], 'tool_use'));
    const before = await this.hook('PreToolUse', { tool_name, tool_input, tool_use_id: id });
    if (!allowed(before)) throw Error(`BLOCKED: the ${tool_name} call must be allowed: ${shownRan(before)}`);
    await o.effect?.();
    const response = o.response ?? { stdout: '', stderr: '', interrupted: false, isImage: false };
    this.entry({ promptId: this.promptId, type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    const after = await this.hook('PostToolUse', { tool_name, tool_input, tool_use_id: id, tool_response: response, duration_ms: 40 });
    return { id, after };
  }
  /** The agent changes src/cart.ts (Edit), and the change is made: each call writes a new line, so each turn's snapshot differs. */
  async editCart(n: number): Promise<void> {
    const path = join(this.cwd, CART);
    const from = readFileSync(path, 'utf8');
    const to = `${from}export const rounding${n} = ${n};\n`;
    await this.call('Edit', { file_path: path, old_string: from, new_string: to, replace_all: false }, {
      response: { filePath: path, oldString: from, newString: to, replaceAll: false, structuredPatch: [], userModified: false },
      effect: () => writeFileSync(path, to),
    });
  }
  /** `/loop`'s ScheduleWakeup: the next wake-up in `seconds`. */
  async wakeup(seconds: number): Promise<void> {
    await this.call('ScheduleWakeup', { delaySeconds: seconds, prompt: '/loop keep the cart total right', reason: 'check the cart again' }, { response: { scheduled: true, delaySeconds: seconds } });
  }
  /** CronCreate: a recurring cron job whose next fire is `nextFireAt` (ms since the epoch on the hub's clock, as Claude Code reports it). */
  async cron(nextFireAt: number): Promise<void> {
    await this.call('CronCreate', { cron: '*/15 * * * *', prompt: 'check the cart total', recurring: true }, { response: { id: `cron_${randomBytes(4).toString('hex')}`, nextFireAt, humanSchedule: 'every 15 minutes' } });
  }
  /**
   * `Bash` with `run_in_background: true`: the agent starts `command` in a process group of its own (its process's
   * arguments hold the command's text, as a shell running it does), and the call returns at once. Returns the call's
   * ID and the process group.
   */
  async background(command: string): Promise<{ call: string; group: number }> {
    let group = 0;
    const { id } = await this.call('Bash', { command, description: 'Run the e2e suite', run_in_background: true }, {
      response: { stdout: '', stderr: '', interrupted: false, isImage: false, backgroundTaskId: `b${randomBytes(4).toString('hex')}` },
      effect: async () => {
        const r = await this.agent.send({ op: 'background', command: `sleep 7200; : ${command}`, cwd: this.cwd }, { pid: true });
        group = Number(r.pid);
        groups.add(group);
        // Let the process show in the process table before the call's PostToolUse reads it.
        await sleep(300);
      },
    });
    // The agent's next step comes a moment later, as a model's would, once the hub has read the command's group.
    await sleep(2000);
    return { call: id, group };
  }
  /** `gh pr create` through Bash, its response naming the pull request it opened. */
  async prCreate(): Promise<void> {
    await this.call('Bash', { command: 'gh pr create --title "Round each cart line to cents" --body "Rounds each line."', description: 'Open the pull request' }, {
      response: { stdout: 'https://github.com/acme/shop/pull/12\n', stderr: '', interrupted: false, isImage: false },
    });
  }
  /** One JSON-RPC request to this session's own `deep mcp`. */
  private async mcp(method: string, params: Line, notify = false): Promise<Line> {
    const line = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: `${method}#${++rpc}`, method, params };
    const r = await this.agent.send({ op: 'mcp', line, timeoutMs: 120_000 }, { pid: true });
    if (r.failed) throw Error(`BLOCKED: deep mcp: ${r.failed}`);
    own(Number(r.pid));
    return (r.reply ?? {}) as Line;
  }
  /** deep_claim for the task, as Claude Code calls it: its PreToolUse (mcp__deep__deep_claim), the call on the session's deep mcp, its PostToolUse. */
  async deepClaim(task_ref: string): Promise<void> {
    if (!this.mcpReady) {
      const init = await this.mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-965', version: '0' } });
      if (!init.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(init)}`);
      await this.mcp('notifications/initialized', {}, true);
      this.mcpReady = true;
    }
    const args = { task_ref, attempt: 1, commit: this.w.base, scope: 'session' };
    let reply: Line = {};
    await this.call('mcp__deep__deep_claim', args, {
      effect: async () => { reply = await this.mcp('tools/call', { name: 'deep_claim', arguments: args }); },
      response: { content: [{ type: 'text', text: '{}' }] },
    });
    if (reply.error || reply.result?.isError) throw Error(`BLOCKED: the session's deep_claim was refused: ${JSON.stringify(reply).slice(0, 1500)}`);
  }
  /** The agent's last words of the turn, then Stop: returns the line the chat shows and the reply's times on the hub's clock. */
  async stop(words = 'Done.'): Promise<StopSeen> {
    this.entry(assistant([{ type: 'text', text: words }], 'end_turn'));
    const at = this.clock.now();
    const ran = await this.hook('Stop', { stop_hook_active: false, last_assistant_message: words });
    const repliedAt = this.clock.now();
    const out = parseObject(ran.stdout.trim()) ?? {};
    return { ran, line: typeof out.systemMessage === 'string' ? out.systemMessage : '', block: out.decision === 'block' ? String(out.reason) : undefined, at, repliedAt };
  }
}

// ---- Reading the record.
/** Whether the hub still runs, and the end of what it wrote to stderr: what a BLOCKED setup names. */
const hubState = (hub: Hub): string => `the hub (pid ${hub.pid}) ${alive(hub.pid) ? 'is running' : 'has exited'}; its stderr ends ${JSON.stringify(hub.stderr().slice(-1200))}`;
/** The task the session's typed TASK opened, once its definition is locked. */
export async function opened(hub: Hub, s: Session): Promise<string> {
  const ok = (e: readonly Ev[]) => {
    const ask = e.find((x) => x.kind === 'user.ask' && x.session === s.id && x.data.text === TASK);
    const ref = Array.isArray(ask?.data.tasks) && ask!.data.tasks.length === 1 ? String(ask!.data.tasks[0]) : undefined;
    return ref !== undefined && e.some((x) => x.kind === 'definition.locked' && x.data.task_ref === ref) ? ref : undefined;
  };
  const ref = ok(await settle(hub, (e) => ok(e) !== undefined, 180_000));
  if (!ref) throw Error(`BLOCKED: the typed ask "${TASK}" opened no task with a locked definition within 180 s; ${hubState(hub)}`);
  return ref;
}
/**
 * A judged stop as the record has it: the claim the stop rule made there (a `claim.made` of the session carrying the
 * recomputed definition hash, as each claiming stop makes one for the one ask), the snapshot its fast-lane check ran
 * on (the commit its run of UNIT names), and its held time (`stop.held` naming the claim) once recorded.
 */
export interface Judged { claim: string; snapshot: string | undefined; held: Ev | undefined }
/** The session's judged stops so far, in order. */
export function judgedStops(events: readonly Ev[], s: Session): Judged[] {
  return events.filter((e) => e.kind === 'claim.made' && e.session === s.id && typeof e.data.hash === 'string').map((made) => {
    const claim = `claim:${made.id}`;
    const unit = events.find((e) => e.kind === 'run.started' && e.data.claim === claim && e.data.check === UNIT);
    return { claim, snapshot: unit ? String(unit.data.commit) : undefined, held: events.find((e) => e.kind === 'stop.held' && e.data.claim === claim) };
  });
}
/** Waits until the session has `n` judged stops whose snapshots are known; returns the events read last. */
export async function stopsRecorded(hub: Hub, s: Session, n: number, timeoutMs = 60_000): Promise<Ev[]> {
  return settle(hub, (e) => { const j = judgedStops(e, s); return j.length >= n && j.slice(0, n).every((x) => x.snapshot !== undefined && x.held !== undefined); }, timeoutMs);
}
/**
 * The session's k-th judged stop, once the record has it (a loaded machine may take minutes): its claim, snapshot and
 * held time, with the events read last. A stop the hub never judges is BLOCKED, never a pass.
 */
export async function judgedAt(hub: Hub, s: Session, k: number, seen?: StopSeen): Promise<{ events: Ev[]; stop: Judged }> {
  const events = await stopsRecorded(hub, s, k, 180_000);
  const stop = judgedStops(events, s)[k - 1];
  if (!stop?.snapshot) {
    const stops = events.filter((e) => e.kind === 'agent.stop' && e.session === s.id).map((e) => JSON.stringify(e.data).slice(0, 200));
    throw Error(`BLOCKED: stop ${k} was not judged within 180 s (no claim.made of the stop with a fast-lane run); the session's agent.stop events: ${stops.join('; ') || 'none'}; its Stop hook: ${seen ? JSON.stringify({ code: seen.ran.code, stdout: seen.ran.stdout.slice(0, 300), stderr: seen.ran.stderr.slice(0, 300) }) : 'not shown'}; ${hubState(hub)}`);
  }
  return { events, stop };
}
/** The runs of a check that started, in log order, the seeded history left out. */
export const runsOf = (events: readonly Ev[], check: string): Ev[] => events.filter((e) => e.kind === 'run.started' && e.data.check === check && e.data.claim !== SEEDED);
/** A run as a failure message shows it. */
export const shownRun = (e: Ev, snapshots: Record<string, string | undefined> = {}): string => {
  const name = Object.entries(snapshots).find(([, c]) => c === e.data.commit)?.[0] ?? String(e.data.commit).slice(0, 7);
  return `${String(e.data.check)} on ${name} (${String(e.data.lane)} lane) at ${e.ts}`;
};
/**
 * The held places as the record holds them (README, Surfaces: `check.held`): each event's data is the scheduler's
 * HeldRecord for one check on one snapshot (session, check, snapshot, held_at, reason, started_at, started_by,
 * replaced_by), appended when it is held and again whenever it changes; the newest for a check and snapshot stands.
 */
export interface HeldRecord { session: string; check: string; snapshot: string; held_at: number; reason: string; started_at: number | null; started_by: string | null; replaced_by: string | null }
export function heldPlaces(events: readonly Ev[]): HeldRecord[] {
  const byKey = new Map<string, HeldRecord>();
  for (const e of events) if (e.kind === 'check.held') byKey.set(`${String(e.data.check)}\0${String(e.data.snapshot)}`, e.data as unknown as HeldRecord);
  return [...byKey.values()];
}
export const heldOf = (events: readonly Ev[], check: string, snapshot: string | undefined): HeldRecord | undefined => heldPlaces(events).find((h) => h.check === check && h.snapshot === snapshot);
export const shownHeld = (events: readonly Ev[]): string => heldPlaces(events).map((h) => `${h.check} on ${h.snapshot.slice(0, 7)} held at ${h.held_at} (${h.reason}): started ${h.started_at === null ? 'never' : `at ${h.started_at} by ${h.started_by}`}${h.replaced_by ? `, replaced by ${h.replaced_by.slice(0, 7)}` : ''}`).join('; ') || 'none';
/** The session's row as the record has it: its session.reading texts, in order. */
export const readingsOf = (events: readonly Ev[], s: Session): string[] => events.filter((e) => e.kind === 'session.reading' && e.session === s.id).map((e) => String(e.data.reading));

/** The message a judgement throws, or null when it holds; a BLOCKED setup is thrown on, never read as the plant's failure. */
export async function failureOf(judge: () => unknown): Promise<string | null> {
  try {
    await judge();
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('BLOCKED:')) throw error;
    return message;
  }
}
export function must(ok: boolean, message: string): asserts ok {
  if (!ok) throw Error(message);
}

// ---- One session on one hub.
export interface Run { w: World; hub: Hub; clock: Clock; s: Session; ref: string }
/**
 * A world, its hub (with `plant`), and a session that types TASK and waits for its task's definition to lock. With
 * `opening` (the default) that first turn ends with no tool call, so its stop makes no claim, and the loop's turns
 * follow; without it the caller goes on with that turn.
 */
export async function begin(o: { plant?: string | undefined; world?: WorldOptions; opening?: boolean } = {}): Promise<Run> {
  for (const [what, path] of [['the deep CLI (npm run build --workspaces)', CLI], ['deep-hook (cargo build --locked -p deep-hook)', DEEP_HOOK]] as const) {
    try { readFileSync(path); } catch { throw Error(`BLOCKED: ${what} is not built at ${path}`); }
  }
  const w = await world(o.world);
  const hub = await startHub(w, o.plant);
  const clock = new Clock(hub);
  const s = new Session(w, clock);
  await s.start();
  await s.typed(TASK);
  const ref = await opened(hub, s);
  if (o.opening !== false) await s.stop('I will keep the cart total right in a loop.');
  return { w, hub, clock, s, ref };
}
/** Waits `ms` of real time, so a run a wrong program starts at a stop has landed in the record before the test reads it. */
export const landing = (ms = 6000): Promise<void> => sleep(ms);
/** The journey's runs on a snapshot. */
export const journeysOn = (events: readonly Ev[], snapshot: string | undefined, check = J): Ev[] => runsOf(events, check).filter((e) => e.data.commit === snapshot);
/** Waits up to `ms` of real time for a run of `check` on `snapshot`; returns the events read last. */
export const runStarted = (hub: Hub, snapshot: string | undefined, ms = 20_000, check = J): Promise<Ev[]> => settle(hub, (e) => journeysOn(e, snapshot, check).length > 0, ms);
