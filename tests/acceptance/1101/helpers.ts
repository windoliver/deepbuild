// Test-side tools for #1101 (README). Every reading comes from a real component:
// - The hold is the hub's: a real hub (`deep hub run`) in a temp HOME, on its test clock (DEEP_HUB_TEST_CLOCK and
//   #965's `test.clock`), holds a Claude Code session's `git push` with an authority ask under the shipped default
//   guards. The session's hooks go on the hook wire as deep-hook sends them; a call the hub lets through runs for real
//   (the push is a real `git push` to a bare repository on disk), so a git process starts only when the hub allows it.
// - The yes and the Undo are sent as the app's card sends them: `ask.answer` and `ask.undo` on an app connection,
//   signed by a device paired with the hub (#1579's format). `ask.undo` is the hub's undo, the one `deep inbox undo`
//   calls (#1806).
// - The card and its receipt are read where a person reads them: the ask's page in the app's views, drawn headless by
//   the real `deep-drive` (#124) over a copy of the hub's record, with the replica's virtual clock set to a time of
//   the hold (README, The clocks).
//
// Copied from ../2029/helpers.ts with changes, as the house does: the world, the session on the hook wire, the held
// call, the paired device and the signed answer, the record reads and the replica's page reads. Reused by import:
// #16's homes, hub, hook wire and PID cleanup.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was
// started with; nothing touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { canonicalize, type JsonValue } from '../../../packages/contracts/src/index.ts';
import {
  allEvents, childEnv, cleanup as cleanup16, control, hookRequest, makeHome, newSession, nextSeq, NODE, openAs, own, REPO, run, sendHook, sleep, startHub,
  stopHub, tempDir, tokenOf, ulid, type Ev, type HookResult, type Hub, type Line, type Session,
} from '../16/helpers.ts';

export { sleep, stopHub, type Ev };

export const SECOND = 1000;
export const MINUTE = 60_000;
export const SUITE = new URL('.', import.meta.url).pathname;
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);

/** The criteria, by `#1101.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  hold: '#1101.5140ae1c',
  undo: '#1101.08523c57',
  ran: '#1101.2d545cc0',
  restart: '#1101.96f7bd58',
  batch: '#1101.538a1251',
  card: '#1101.b49d00ae',
  shown: '#1101.cf35fa4c',
} as const;

/**
 * The planted wrong programs the criteria name, each selected with DEEP_HUB_PLANT (README, Plants). The app reads it in
 * deep-drive's `env-plants` build; the hub is given it too when packages/hub/src/plant.ts lists the name.
 */
export const PLANT = {
  /** AC1: a card whose yes starts the push at the click, with no hold. */
  startsAtClick: 'hold-starts-at-click',
  /** AC2: a host that runs the push anyway after Undo. */
  runsAnyway: 'undo-runs-anyway',
  /** AC2: a host whose Undo closes the ask as declined instead of opening it again. */
  closesDeclined: 'undo-closes-declined',
  /** AC3: a receipt that still shows Undo once its step ran. */
  keepsUndo: 'receipt-keeps-undo',
  /** AC4: a hub that runs held steps when it starts again. */
  runsOnRestart: 'restart-runs-held',
  /** AC5: a batch that holds all of its steps, those that can be undone too. */
  holdsAll: 'batch-holds-all',
  /** AC5: an Undo that withdraws a batch's step that already ran. */
  withdrawsRan: 'undo-withdraws-ran',
  /** AC6: a single-step card with a switch, so a yes takes two presses. */
  twoPresses: 'single-step-switch',
} as const;

/** The issue's words (Scope and the criteria). */
export const STARTS_IN = (s: number): string => `Starts in ${s} s`;
export const UNDO = 'Undo';
/** "It ran and can't be undone" (the issue), or "can't be taken back" (the design's words for the same receipt). */
export const CANT_UNDO = /can['’]t be (?:undone|taken back)/i;
/** The hold, as the issue sets it. */
export const HOLD_MS = 10_000;

export async function cleanup(): Promise<void> {
  await cleanup16();
}

// ---- Builds (README, How to run), as #2029's with one change: each binary is built only when a test needs it, so a
// run that draws nothing builds no replica. #1172's build environment, each build in one grant of the machine's build
// throttle; each replica is copied out of the target folder under its own name, so a planted build never stands in for
// the plain one, and a plants build is followed by the plain one, so the target folder never holds a plant. A binary
// newer than every file the Rust build reads is used as it is.

const TARGET = process.env.CARGO_TARGET_DIR ?? join(REPO, 'target');
/** The copies, out of the target folder (which a cleanup may empty), in a folder of this checkout's, as #2029 keeps them. */
const BIN = join(tmpdir(), `da1101-bin-${userInfo().uid}-${createHash('sha256').update(REPO).digest('hex').slice(0, 8)}`);
const SOURCES = ['Cargo.toml', 'Cargo.lock', '.cargo', 'rust-toolchain.toml', 'crates', 'vendor', 'contracts', 'brand', 'adapters', 'packages/contracts/schemas'];
function newestMtime(path: string): number {
  if (!existsSync(path)) return 0;
  const s = statSync(path);
  if (!s.isDirectory()) return s.mtimeMs;
  return readdirSync(path).filter((n) => n !== 'target' && n !== 'node_modules' && n !== '.git').reduce((m, n) => Math.max(m, newestMtime(join(path, n))), s.mtimeMs);
}
let sources: number | undefined;
const fresh = (file: string): boolean => existsSync(file) && statSync(file).mtimeMs > (sources ??= Math.max(...SOURCES.map((p) => newestMtime(join(REPO, p)))));
const q = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;
async function throttled(script: string, what: string): Promise<void> {
  if (process.platform !== 'darwin') blocked(`the replica draws on macOS only; this is ${process.platform}`);
  const r = await run(NODE, ['scripts/throttle.mjs', 'build', '--wait', '240', '--', '/bin/sh', '-c', script], { env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' }, timeoutMs: 480 * MINUTE });
  if (r.code !== 0) blocked(`the build of ${what} failed (exit ${r.code}): ${(r.stderr || r.stdout).slice(-2000)}`);
}
let hookBuild: Promise<void> | undefined;
/** deep-hook in the checkout's target, where the hub looks for it. */
const hookBuilt = (): Promise<void> => (hookBuild ??= fresh(join(TARGET, 'debug', 'deep-hook')) ? Promise.resolve() : throttled('cargo build --locked -q -p deep-hook --bin deep-hook', 'deep-hook'));
const drives = new Map<boolean, Promise<string>>();
/**
 * `deep-drive` with `deep-app/test-confirm`, so the OS's confirmation of a yes is a file's word (#1454, as #1462's
 * suite builds it), plain or with `env-plants` too, so DEEP_HUB_PLANT selects a wrong program (README, Plants).
 */
export function driveBin(planted: boolean): Promise<string> {
  const copy = join(BIN, planted ? 'deep-drive-confirm-plants' : 'deep-drive-confirm');
  let built = drives.get(planted);
  if (!built) {
    const cargo = 'cargo build --locked -q -p deep-replica --bin deep-drive';
    const script = [`mkdir -p ${q(BIN)}`, `${cargo} --features ${planted ? 'env-plants,' : ''}deep-app/test-confirm`, `cp ${q(join(TARGET, 'debug', 'deep-drive'))} ${q(copy)}`, cargo].join(' && ');
    built = (fresh(copy) ? Promise.resolve() : throttled(script, planted ? 'deep-drive with env-plants' : 'deep-drive')).then(() => copy);
    drives.set(planted, built);
  }
  return built;
}
function needCli(): void {
  if (!existsSync(join(REPO, 'packages/cli/dist/main.js'))) blocked('the CLI isn\'t built: run npm ci and npm run build --workspaces');
}

// ---- The clocks (README). The replica launched on a fixture starts its clock at NOW (crates/deep-replica's NOW); the
// hub's test clock starts a minute after it, so every time the hub records lies ahead of the replica's start and the
// replica's clock can be moved on to any of them.

/** crates/deep-replica's NOW: where a replica launched on a fixture starts its clock. */
export const NOW = 1_800_000_000_000;
const HUB_START = NOW + MINUTE;
/** Flicks per ms of the replica's clock (crates/deep-replica/src/drive FLICKS / 1000). */
const FLICKS_PER_MS = 705_600;

// ---- The world (README, The world).

const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
const RULES = (JSON.parse(readFileSync(DEFAULT_RULES, 'utf8')) as { entries: Record<string, { match: string }> }).entries;
/** The shipped guard entries deep-hook meets on a call of an effect class: every entry whose match is `effect:<class>`. */
const entriesFor = (effect: string): string[] => Object.entries(RULES).filter(([, e]) => e.match === `effect:${effect}`).map(([name]) => name);
/** The newest Claude Code version the adapter's facts cover: what the session's transcript says it runs. */
const COVERED = ((JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions).at(-1)!;
/** Your ask settings, as setup drafts them; the batch world adds a visit every 2 minutes. */
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
export const BATCH_EVERY_MS = 2 * MINUTE;
/** You typed this; it names no push and no pull request, so each is held for your authority. */
export const PROMPT = 'Fix the login bug in src/auth.js.';

/** A call the agent makes: its command, the entries deep-hook meets on it, and what it does once it runs. */
export interface Step { command: string; matched: string[]; kind: 'push' | 'pr'; ref?: string }
const push = (ref: string): Step => ({ command: `git push origin ${ref}`, matched: entriesFor('push'), kind: 'push', ref });
const pr = (head: string, title: string): Step => ({ command: `gh pr create --base main --head ${head} --title "${title}" --body "${title}."`, matched: entriesFor('pr'), kind: 'pr' });
/** The fixture push: a step that can't be undone. */
export const PUSH = push('main');
/** AC5's batch: two pushes, which can't be undone, and two pull requests opened, which can (README, Readings 5). */
export const BATCH: Step[] = [push('main'), pr('fix-login', 'Fix the login check'), push('v2.0.0'), pr('auth-tests', 'Tidy the auth tests')];

export interface Device { id: string; key: KeyObject; hub: string }
/** A try of a held step: the hub's clock when it was sent and when its reply came, whether the hub let it run, and what it said. */
export interface Tried { step: string; call: string; sent: number; replied: boolean; ran: boolean; said: string; at: number }
export interface World {
  home: string; root: string; repo: string; remote: string; hub: Hub; env: Record<string, string | undefined>; plant?: string;
  /** The hub's clock less its test.clock steps, minus the wall clock: what deep-hook's stamps read on this world's machine. */
  base: number;
  /** test.clock's steps since the hub started. */
  stepped: number;
  device?: Device;
  /** Every try of a held step, in order, with the hub's clock read right after its reply. */
  tries: Tried[];
  /** The tries still waiting on the hub's reply. */
  waiting: Promise<Tried>[];
}

/** Whether the hub lists a plant (packages/hub/src/plant.ts): then it is given DEEP_HUB_PLANT too (README, Plants). */
export const hubLists = (plant: string): boolean => readFileSync(join(REPO, 'packages/hub/src/plant.ts'), 'utf8').includes(`'${plant}'`);

const GIT_ENV = (home: string): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test',
});
async function git(cwd: string, args: string[], home: string): Promise<string> {
  const r = await run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd, env: GIT_ENV(home) });
  if (r.code !== 0) blocked(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

async function call(w: World, method: string, params: Line): Promise<Line> {
  const conn = await control(w.hub);
  try {
    const reply = await conn.call(method, params, 60_000);
    if (reply.error) blocked(`${method} was refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  } finally { conn.close(); }
}
/** The hub's clock now, after stepping it `advance` ms (#965's `test.clock`). */
export async function clock(w: World, advance = 0): Promise<number> {
  const now = Number((await call(w, 'test.clock', { advance_ms: Math.max(0, Math.round(advance)) })).now);
  w.stepped += Math.max(0, Math.round(advance));
  return now;
}
/** Steps the hub's clock to `at` unless it is past it already; the hub's now after. */
export async function stepTo(w: World, at: number): Promise<number> {
  const now = await clock(w);
  return now >= at ? now : clock(w, at - now);
}
/** What deep-hook would stamp now on this world's machine: the hub's clock without test.clock's steps, which the hub adds (#965). */
const stamp = (w: World): number => Date.now() + w.base;

async function startOn(w: Pick<World, 'home' | 'env'>, at: number): Promise<{ hub: Hub; base: number }> {
  const hub = await startHub({ home: w.home, clock: at, env: w.env }, 10 * MINUTE);
  const conn = await control(hub);
  try {
    const reply = await conn.call('test.clock', { advance_ms: 0 }, 60_000);
    if (reply.error) blocked(`the hub serves no test clock (DEEP_HUB_TEST_CLOCK_STEPS=1): ${JSON.stringify(reply.error)}`);
    return { hub, base: Number(reply.result.now) - Date.now() };
  } finally { conn.close(); }
}

/**
 * A HOME whose hub holds the shipped default guards and your ask settings; a git repository `shop` with one commit on
 * main and a tag v2.0.0, whose `origin` is a bare repository beside it holding nothing yet; the OS confirming you;
 * then `deep hub run` on its test clock from a minute after NOW, given `plant` when the hub lists it.
 */
export async function world(o: { batch?: boolean; plant?: string } = {}): Promise<World> {
  needCli();
  await hookBuilt();
  const home = makeHome();
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  const tools = join(home, 'tools');
  mkdirSync(tools, { recursive: true });
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: { ...SETTINGS, ...(o.batch ? { batch: { every: `${BATCH_EVERY_MS / MINUTE}m`, cap: 20 } } : {}) }, runner: { login_path: `${tools}:/usr/bin:/bin` } }, null, 2)}\n`);
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(root, 'setup-finished.json'), JSON.stringify({ version }));
  const place = tempDir();
  const repo = join(place, 'shop');
  const remote = join(place, 'shop-origin.git');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'auth.js'), 'export const checkToken = (token) => token.exp > Date.now() / 1000;\n');
  await git(place, ['init', '-q', '--bare', remote], home);
  await git(repo, ['init', '-q', '-b', 'main'], home);
  await git(repo, ['add', '.'], home);
  await git(repo, ['commit', '-q', '-m', 'base'], home);
  await git(repo, ['tag', 'v2.0.0'], home);
  await git(repo, ['remote', 'add', 'origin', remote], home);
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ numStartups: 3, projects: { [repo]: { allowedTools: [], hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  const confirm = join(home, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const plant = o.plant && hubLists(o.plant) ? o.plant : undefined;
  const env = { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_STOP_HOLD_MS: '5000', DEEP_HUB_TEST_CLOCK_STEPS: '1', DEEP_HUB_PLANT: plant };
  const { hub, base } = await startOn({ home, env }, HUB_START);
  return { home, root, repo, remote, hub, env, ...(o.plant ? { plant: o.plant } : {}), base, stepped: 0, tries: [], waiting: [] };
}

/** The hub stops (SIGTERM, by its PID) and starts again on the same home, its clock going on from where it stopped. */
export async function restart(w: World): Promise<void> {
  const at = await clock(w);
  await stopHub(w.hub);
  const { hub, base } = await startOn(w, at);
  w.hub = hub;
  w.base = base;
  w.stepped = 0;
}

export async function eventsOf(w: World): Promise<Ev[]> {
  const conn = await control(w.hub);
  try { return await allEvents(conn); } finally { conn.close(); }
}
/** Polls the record until `pick` finds what it waits for; BLOCKED naming it when it never comes. */
export async function awaitRecord<T>(w: World, pick: (events: Ev[]) => T | undefined, what: string, timeoutMs = 3 * MINUTE): Promise<T> {
  const by = Date.now() + timeoutMs;
  for (;;) {
    const found = pick(await eventsOf(w));
    if (found !== undefined) return found;
    if (Date.now() > by) blocked(`${what}: not in the hub's record after ${timeoutMs / 1000} s`);
    await sleep(500);
  }
}
/** The inbox's row for an ask (`inbox.read`, what `deep inbox` and the app list): its status and outcome. */
export async function inboxRow(w: World, ask: string): Promise<Line | undefined> {
  return ((await call(w, 'inbox.read', {})).asks as Line[]).find((r) => r.ask === ask);
}
/** Whether the ask is open on its card: the inbox holds it open and unanswered, and its card offers its options again. */
export async function openOnCard(w: World, ask: string): Promise<string | undefined> {
  const row = await inboxRow(w, ask);
  if (!row) return `the inbox doesn't list ${ask}`;
  if (row.status === 'closed' || row.outcome !== 'unanswered') return `the inbox reads ${ask} ${String(row.status)}, ${String(row.outcome)}, not open and unanswered`;
  const conn = await control(w.hub);
  try {
    const card = await conn.call('ask.card', { ask }, 60_000);
    if (card.error) return `its card can't be read: ${JSON.stringify(card.error).slice(0, 300)}`;
    if (!((card.result.options ?? []) as Line[]).some((o) => o.decision === 'allow')) return `its card offers no option that allows: ${JSON.stringify(card.result.options)}`;
  } finally { conn.close(); }
  return undefined;
}
/** Whether the bare repository the pushes go to holds the ref: a push of it ran. */
export async function remoteHas(w: World, ref: string): Promise<boolean> {
  const r = await run('git', ['--git-dir', w.remote, 'show-ref', '--verify', '-q', ref === 'main' ? 'refs/heads/main' : `refs/tags/${ref}`], { env: GIT_ENV(w.home) });
  return r.code === 0;
}

// ---- A Claude Code session on the hook wire, its agent's process a `sleep` (README, The session).

let calls = 0;
export class Agent {
  readonly s: Session;
  readonly pid: number;
  private parent: string | null = null;
  private constructor(private readonly w: World, child: ChildProcess) {
    this.s = newSession(w.home, 'claude-code', w.repo);
    this.pid = child.pid!;
  }
  static async start(w: World, prompt = PROMPT): Promise<Agent> {
    const child = spawn('/bin/sleep', ['7200'], { stdio: 'ignore' });
    own(child.pid);
    const a = new Agent(w, child);
    await a.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    a.entry({ type: 'user', message: { role: 'user', content: prompt }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
    await a.hook('UserPromptSubmit', { prompt });
    return a;
  }
  get id(): string { return this.s.id; }
  /** One transcript entry, as Claude Code writes it, stamped on this world's clock. */
  private entry(value: Line): void {
    const uuid = randomBytes(16).toString('hex');
    appendFileSync(this.s.transcript, `${JSON.stringify({ parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date(stamp(this.w)).toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.s.cwd, sessionId: this.s.id, version: COVERED, gitBranch: 'main' })}\n`);
    this.parent = uuid;
  }
  /** One hook on the hub's socket, as deep-hook sends it from this session's process; BLOCKED unless the hub acknowledged it. */
  async hook(event: string, extra: Line = {}, matched: string[] = []): Promise<HookResult> {
    const at = stamp(this.w);
    const request = { ...hookRequest(this.s, event, extra), seq: nextSeq(at), id: ulid(at), matched, pid: this.pid, ppid: this.pid };
    const r = await sendHook(this.w.hub.socket, request, 4 * MINUTE);
    if (!r.ack) blocked(`the hub didn't acknowledge ${event} of session ${this.s.id}: ${JSON.stringify(r).slice(0, 600)}`);
    return r;
  }
  /** The agent makes the call: its tool_use and its PreToolUse. Whether the hub let it run, and what it told the agent. */
  async call(step: Step): Promise<{ call: string; ran: boolean; said: string }> {
    const call = `toolu_1101${randomBytes(8).toString('hex')}${++calls}`;
    const input = { command: step.command, description: step.kind === 'push' ? 'Push to the remote' : 'Open a pull request' };
    this.entry({ type: 'assistant', message: { role: 'assistant', type: 'message', model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id: call, name: 'Bash', input }], stop_reason: 'tool_use' } });
    const r = await this.hook('PreToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: call }, step.matched);
    const reply = r.reply ?? blocked(`the hub gave no reply to the PreToolUse of \`${step.command}\`: ${JSON.stringify(r).slice(0, 400)}`);
    let out: Line | undefined;
    try { out = JSON.parse(String(reply.stdout || '{}')) as Line; } catch { out = undefined; }
    const denied = reply.exit === 2 || out?.hookSpecificOutput?.permissionDecision === 'deny' || out?.decision === 'block';
    const said = String(out?.hookSpecificOutput?.permissionDecisionReason ?? reply.stderr ?? '');
    if (denied) this.entry({ type: 'user', message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content: said, is_error: true }] } });
    return { call, ran: !denied, said };
  }
  /**
   * The call the hub let through runs: a push is a real `git push` to the bare repository (the git process starts
   * here, and only here); a pull request prints its URL. Then its tool_result and PostToolUse.
   */
  async runs(step: Step, call: string): Promise<void> {
    let stdout = 'https://github.com/acme/shop/pull/12\n';
    if (step.kind === 'push') {
      const r = await run('git', ['-c', 'core.hooksPath=/dev/null', 'push', 'origin', step.ref!], { cwd: this.w.repo, env: GIT_ENV(this.w.home) });
      stdout = `${r.stdout}${r.stderr}`;
    }
    const input = { command: step.command, description: step.kind === 'push' ? 'Push to the remote' : 'Open a pull request' };
    const response = { stdout, stderr: '', interrupted: false, isImage: false };
    this.entry({ type: 'user', message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content: stdout, is_error: false }] }, toolUseResult: response });
    await this.hook('PostToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: call, tool_response: response, duration_ms: 900 });
  }
  /** The agent's next message, and its turn's end: the assistant's text in the transcript, then Stop carrying it. */
  async says(text: string): Promise<void> {
    this.entry({ type: 'assistant', message: { role: 'assistant', type: 'message', model: 'claude-haiku-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn' } });
    await this.hook('Stop', { stop_hook_active: false, last_assistant_message: text });
  }
}

export interface Held { ask: string; question: string; step: Step; card: Line }
/**
 * The agent makes the call and the hub holds it: the call doesn't run, and an authority ask naming it is raised. Its
 * handle, question and card (`ask.card`). BLOCKED when the hub lets the call run with no ask: the world is broken.
 */
export async function held(w: World, a: Agent, step: Step): Promise<Held> {
  const since = Math.max(0, ...(await eventsOf(w)).map((e) => e.log_pos));
  const tried = await a.call(step);
  if (tried.ran) blocked(`\`${step.command}\` ran with no ask: the shipped guards didn't hold it (${tried.said.slice(0, 300)})`);
  let asked: string[] = [];
  const created = await awaitRecord(w, (all) => {
    asked = all.filter((e) => e.kind === 'ask.created' && e.log_pos > since).map((e) => `${String(e.data.kind)}: ${String(e.data.question ?? '').slice(0, 160)}`);
    return all.find((e) => e.kind === 'ask.created' && e.log_pos > since && e.data.kind === 'authority' && String(e.data.question ?? '').includes(step.command));
  }, `the authority ask holding \`${step.command}\``, MINUTE).catch((error: Error) => blocked(`${error.message.replace(/^BLOCKED: /, '')} (the hub told the agent "${tried.said.slice(0, 300)}"; the asks raised since: ${JSON.stringify(asked)})`));
  const ask = `ask:${created.id}`;
  return { ask, question: String(created.data.question), step, card: await call(w, 'ask.card', { ask }) };
}

/**
 * One try of a held step, as the agent runs the same call again: the hub's clock read just before it is sent (`sent`),
 * its PreToolUse, the hub's clock read right after the reply (`at`, no earlier than when the hub decided), and, when
 * the hub let it through, the step run for real. Kept in `w.tries` from the moment it is sent. Waited on for up to
 * `waitMs` of real time: a hub that keeps the call waiting replies only later, and the try is filled in then.
 */
export async function attempt(w: World, a: Agent, step: Step, waitMs = 3 * SECOND): Promise<Tried> {
  const tried: Tried = { step: step.command, call: '', sent: await clock(w), replied: false, ran: false, said: '', at: Number.NaN };
  w.tries.push(tried);
  const done = (async () => {
    try {
      const r = await a.call(step);
      tried.at = await clock(w);
      Object.assign(tried, { call: r.call, ran: r.ran, said: r.said, replied: true });
      if (r.ran) await a.runs(step, r.call);
    } catch (error) {
      tried.said = `no reply: ${error instanceof Error ? error.message : String(error)}`;
    }
    return tried;
  })();
  w.waiting.push(done);
  await Promise.race([done, sleep(waitMs)]);
  return tried;
}
/** Every try still waiting gets up to `waitMs` more to come back. */
export async function settleTries(w: World, waitMs = 60 * SECOND): Promise<void> {
  await Promise.race([Promise.allSettled(w.waiting), sleep(waitMs)]);
}
/** The tries of a step the hub let through, with when. */
export const ranTries = (w: World, step: Step): Tried[] => w.tries.filter((t) => t.step === step.command && t.replied && t.ran);

// ---- The app's card on the hub: its yes and its Undo, as the app's card sends them (crates/deep-app/src/answer.rs).

/** The app's paired device, made once a world: an Ed25519 key paired with the hub (`device.pair`, the OS confirming you). */
async function deviceOf(w: World): Promise<Device> {
  if (w.device) return w.device;
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const conn = await control(w.hub);
  try {
    const hubId = String(conn.hello?.hub ?? '');
    if (!hubId) blocked(`the hub's hello names no hub ID: ${JSON.stringify(conn.hello)}`);
    const paired = await conn.call('device.pair', { name: 'DeepBuild app', public_key: String(publicKey.export({ format: 'jwk' }).x) }, 60_000);
    if (paired.error || typeof paired.result?.device !== 'string') blocked(`device.pair was refused: ${JSON.stringify(paired)}`);
    w.device = { id: String(paired.result.device), key: privateKey, hub: hubId };
  } finally { conn.close(); }
  return w.device;
}
/** A call as the app makes it on the trusted path: on an app connection, signed by the paired device for this hub, at the hub's time. */
export async function asApp(w: World, method: string, params: Line): Promise<Line> {
  const device = await deviceOf(w);
  const at = await clock(w);
  const signed = { device: device.id, method, hub: device.hub, at, once: randomBytes(18).toString('base64url'), params: createHash('sha256').update(canonicalize(params as JsonValue)).digest('hex') };
  const sig = sign(null, canonicalize(signed as JsonValue), device.key).toString('base64url');
  const conn = await openAs(w.hub.socket, 'app', tokenOf(w.hub.root));
  try {
    return await conn.call(method, { ...params, signature: { signed, sig } }, 3 * MINUTE);
  } finally { conn.close(); }
}
/** The card's yes: its allow option with the plan it showed and a click's token; `steps` approves a batch's steps by index (#327). */
export const allowParams = (h: Held, steps?: number[]): Line => {
  const allow = ((h.card.options ?? []) as Line[]).find((o) => o.decision === 'allow') ?? blocked(`${h.ask}'s card offers no option that allows: ${JSON.stringify(h.card.options)}`);
  return { ask: h.ask, option: String(allow.id), plan_hash: h.card.plan?.hash ?? null, token: `click-${randomBytes(8).toString('hex')}`, ...(steps ? { steps } : {}) };
};
/** Allowed on its card; the `ask.answered` the hub recorded, whose `ts` is when the hold starts (README, The clocks). */
export async function allowOnCard(w: World, h: Held, steps?: number[], params = allowParams(h, steps)): Promise<Ev> {
  const reply = await asApp(w, 'ask.answer', params);
  if (reply.error) blocked(`the card's allow of ${h.ask} was refused: ${JSON.stringify(reply.error)}`);
  return awaitRecord(w, (all) => all.find((e) => e.kind === 'ask.answered' && e.subject === h.ask && e.data.decision === 'allow'), `${h.ask} answered allow`);
}
/** The receipt's Undo: the hub's undo (`ask.undo`, the one `deep inbox undo` calls), sent as the app sends it. Its refusal, if any. */
export async function undoOnCard(w: World, ask: string): Promise<string | undefined> {
  const reply = await asApp(w, 'ask.undo', { ask });
  return reply.error ? JSON.stringify(reply.error).slice(0, 400) : undefined;
}
/** The `approval.withdrawn` events recorded after `since`, and the steps each names (an ask's handle or a command in it). */
export const withdrawn = (all: readonly Ev[], since: number): Ev[] => all.filter((e) => e.kind === 'approval.withdrawn' && e.log_pos > since);
export const names = (e: Ev, h: Held): boolean => {
  const text = JSON.stringify({ subject: e.subject, data: e.data });
  return text.includes(h.ask) || text.includes(h.step.command);
};

// ---- The replica: the app's views over a copy of the hub's record (README, The card and its receipt).

/** A copy of the world's record now, as a replica fixture: one `{session_id, event}` per line. */
export async function copyRecord(w: World): Promise<string> {
  const events = await eventsOf(w);
  const file = join(tempDir(), 'record.events.jsonl');
  writeFileSync(file, `${events.map((e) => JSON.stringify({ session_id: e.session ?? '', event: e })).join('\n')}\n`);
  return file;
}

export interface SNode { role: string; name: string | null; value: unknown; id?: unknown; bounds: number[]; children: SNode[] }
export const flat = (n: SNode, into: SNode[] = []): SNode[] => { into.push(n); for (const c of n.children ?? []) flat(c, into); return into; };
const PAGE = /^(ask|session|project|page)\/\S+$/;
const said = (v: unknown): string => (JSON.stringify(v) ?? String(v)).slice(0, 300);
const clean = (t: string): string => t.normalize('NFC').replace(/\s+/g, ' ').trim();

/** `deep-drive` (#124) on a copy of the record, as #1461's suite drives it: one JSON call per line on stdin. */
export class Replica {
  private buffer = '';
  private readonly waiting: ((line: Line) => void)[] = [];
  private exited = false;
  private err = '';
  readonly out: string;
  private constructor(private readonly child: ChildProcess, out: string) {
    this.out = out;
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
  /**
   * The plain `deep-drive`, or with `plant` the `env-plants` one given DEEP_HUB_PLANT, launched on `fixture` (a copy of
   * a hub's record): its window is the app's at the reference window, its clock at NOW.
   */
  static async on(fixture: string, plant?: string): Promise<Replica> {
    const bin = await driveBin(plant !== undefined);
    const out = join(tempDir(), 'out');
    mkdirSync(out, { recursive: true });
    // The OS confirms you whenever the card asks (deep-app's test-confirm reads DEEP_APP_TEST_CONFIRM's file).
    const confirm = join(tempDir(), 'confirm');
    writeFileSync(confirm, 'confirmed\n');
    const child = spawn(bin, ['--out', out], { cwd: REPO, env: childEnv(makeHome(), { DEEP_HUB_PLANT: plant, DEEP_APP_TEST_CONFIRM: confirm }), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const r = new Replica(child, out);
    const ready = await r.next(10 * MINUTE);
    if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${said(ready)} ${r.err.slice(-600)}`);
    await r.must('the launch on a copy of the hub\'s record', { call: 'launch', launch: { from: 'fixture', fixture } });
    return r;
  }
  private next(ms: number): Promise<Line> {
    if (this.exited) return Promise.resolve({ exited: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  async must(what: string, args: Line): Promise<Line> {
    const reply = this.next(20 * MINUTE);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.exited || got.timedOut || got.unparsed !== undefined) blocked(`deep-drive gave no JSON reply to ${what}: ${said(got)} ${this.err.slice(-600)}`);
    if (got.ok !== true) blocked(`deep-drive refused ${what}: ${said(got.error ?? got)}`);
    return got;
  }
  /** Moves the replica's clock on to `ms` since the epoch, which must lie ahead of it, in steps of `stepMs`. */
  async at(ms: number, stepMs = 5000): Promise<void> {
    const t = Math.round((ms - NOW) * FLICKS_PER_MS);
    await this.must(`moving the replica's clock to ${ms}`, { call: 'wait_for', wait_for: { t, step_ms: stepMs }, timeout: Math.max(0, ms - NOW) + MINUTE });
  }
  async see(): Promise<Line> { return this.must('see', { call: 'see' }); }
  /** Opens an ask's page, `ask/<ULID>` (#1460's address), and reads it. */
  async page(ask: string): Promise<Page> {
    const opened = await this.must(`the open of ${ask}'s page`, { call: 'open', open: { address: `ask/${ask.slice('ask:'.length)}` } });
    return this.read(ask, (opened.said ?? null) as string | null);
  }
  /** The page shown now, read as `see` gives it. */
  async read(ask: string, opened: string | null = null): Promise<Page> {
    const seen = await this.see();
    const nodes = flat((seen.snapshot as { tree: SNode }).tree);
    const page = nodes.filter((n) => typeof n.id === 'string' && PAGE.test(n.id));
    const within = page.length === 1 ? flat(page[0]!) : nodes;
    const texts = [...new Set(within.flatMap((n) => [n.name ?? '', typeof n.value === 'string' ? n.value : '']).map(clean).filter(Boolean))];
    const card = nodes.find((n) => n.id === 'question-card');
    return { ask, address: (seen.address ?? null) as string | null, said: opened, texts, nodes: within, card, hub: (Array.isArray(seen.hub) ? seen.hub : []) as Line[] };
  }
  click(locator: Line, what: string): Promise<Line> { return this.must(what, { call: 'act', locator, act: { kind: 'click' } }); }
  /** A screenshot of the window, copied to `to`; its SHA-256. */
  async screenshot(to: string): Promise<string> {
    const shot = await this.must('a screenshot of the window', { call: 'screenshot', screenshot: { target: 'window' } });
    copyFileSync(String(shot.path), to);
    return createHash('sha256').update(readFileSync(to)).digest('hex');
  }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const by = Date.now() + 5000;
    while (!this.exited && Date.now() < by) await sleep(20);
    if (!this.exited) try { process.kill(this.child.pid!, 'SIGKILL'); } catch { /* gone */ }
  }
}

/** What an ask's page shows: the address, what `open` said, every string drawn or named on it, its nodes, and what the app sent its hub. */
export interface Page { ask: string; address: string | null; said: string | null; texts: string[]; nodes: SNode[]; card: SNode | undefined; hub: Line[] }
const joined = (p: Page): string => clean(p.texts.join(' '));
/** Whether the page shows the words: one of its strings holds them, or its strings joined do. */
export const shows = (p: Page, words: string | RegExp): boolean => (typeof words === 'string' ? p.texts.some((t) => t.includes(words)) || joined(p).includes(words) : p.texts.some((t) => words.test(t)) || words.test(joined(p)));
/** The page's Undo controls: a node named Undo, or the card's `card-undo` control. */
export const undoControls = (p: Page): SNode[] => p.nodes.filter((n) => clean(n.name ?? '') === UNDO || n.id === 'card-undo');
/**
 * The card's switches (the question card's node, `question-card`, wherever the window draws it; the page without one): a
 * node whose role is a switch or a check box, or one of the card's `card-step:<n>` controls.
 */
export const switches = (p: Page): SNode[] => (p.card ? flat(p.card) : p.nodes).filter((n) => n.role === 'switch' || n.role === 'check_box' || n.role === 'toggle_button' || (typeof n.id === 'string' && n.id.startsWith('card-step:')));
/** Where a page's words are quoted in a failure: the strings that read like a receipt, else its first strings. */
export const quoted = (p: Page): string => {
  const lines = p.texts.filter((t) => /Starts in|\bran\b|Allowed|Undo|undone|taken back/i.test(t));
  return lines.length ? lines.map((l) => `"${l.slice(0, 200)}"`).join(', ') : `no receipt (${p.address ?? 'no address'}${p.said ? `, which says "${p.said}"` : ''}; the page shows ${p.texts.slice(0, 12).map((t) => `"${t.slice(0, 120)}"`).join(', ') || 'nothing'})`;
};

/**
 * The held receipt's judge (AC1): at `s` seconds into the hold the page shows "Starts in <10 - s> s" and an Undo
 * control. Read 200 ms past each whole second, so a countdown that names the seconds left, rounded up or to the
 * nearest, reads the issue's number (README, The clocks).
 */
export async function heldReceipt(fixture: string, h: Held, start: number, plant?: string): Promise<string[]> {
  const r = await Replica.on(fixture, plant);
  const failures: string[] = [];
  try {
    for (const s of [0, 4]) {
      await r.at(start + s * SECOND + 200);
      const p = await r.page(h.ask);
      const want = STARTS_IN(10 - s);
      if (!shows(p, want)) failures.push(`${h.ask} (\`${h.step.command}\`): ${s} s into its hold its receipt must read "${want} · ${UNDO}"; it reads ${quoted(p)}`);
      if (!undoControls(p).length) failures.push(`${h.ask} (\`${h.step.command}\`): ${s} s into its hold its receipt shows no ${UNDO} control; it reads ${quoted(p)}`);
    }
  } finally {
    await r.stop();
  }
  return failures;
}
/** The receipt after the step ran (AC3): it says it ran and can't be undone, and no Undo is in the text snapshot. */
export async function ranReceipt(fixture: string, h: Held, at: number, plant?: string): Promise<string[]> {
  const r = await Replica.on(fixture, plant);
  try {
    await r.at(at);
    const p = await r.page(h.ask);
    const failures: string[] = [];
    if (!shows(p, /\bran\b/i) || !shows(p, CANT_UNDO)) failures.push(`the receipt of ${h.ask} (\`${h.step.command}\`), after its push ran, must say it ran and can't be undone; it reads ${quoted(p)}`);
    const undo = undoControls(p);
    if (undo.length || p.texts.some((t) => /\bUndo\b/.test(t))) failures.push(`the receipt of ${h.ask} (\`${h.step.command}\`) still shows ${UNDO} in the text snapshot after its push ran: ${undo.map((n) => `${n.role} "${n.name ?? ''}"`).join(', ') || p.texts.filter((t) => /\bUndo\b/.test(t)).map((t) => `"${t}"`).join(', ')}`);
    return failures;
  } finally {
    await r.stop();
  }
}

/** The card's state on a page (the question card's node, `question-card`, its value), or undefined with no card drawn. */
const cardState = (p: Page): string | undefined => (p.card ? String(p.card.value ?? '') : undefined);
/** A switch that reads off. */
export const isOff = (n: SNode): boolean => n.value === 'off' || n.value === false || n.value === 'false' || n.value === 0;
/** The answers the app sent its hub (`ask.answer`'s params, unsigned: the app signs them on the way out). */
export const answersSent = (p: Page): Line[] => p.hub.filter((c) => c.method === 'ask.answer').map((c) => c.params as Line);

export interface Pressed { page: Page; presses: number; sent: Line[] }
/**
 * Allow pressed on the card as you press it (README, The card and its receipt): the ask's page in the replica over
 * `fixture`, its clock at `at`; once the card arms, one hardware press on its allow option (`card-option:<id>`, #1462's
 * key for it). With `untilSent`, a card that sent nothing gets each of its switches that is off turned on, and Allow
 * pressed again once it arms again. The page before the first press, how many presses it took, and the answers sent.
 */
export async function pressAllow(fixture: string, at: number, h: Held, o: { plant?: string; untilSent?: boolean } = {}): Promise<Pressed> {
  const allow = ((h.card.options ?? []) as Line[]).find((x) => x.decision === 'allow') ?? blocked(`${h.ask}'s card offers no option that allows`);
  const r = await Replica.on(fixture, o.plant);
  try {
    let now = at;
    await r.at(now);
    const page = await r.page(h.ask);
    const arm = async (): Promise<void> => {
      for (let i = 0; i < 30; i++) {
        now += 100;
        await r.at(now, 100);
        if (cardState(await r.read(h.ask)) === 'armed') return;
      }
    };
    const press = (locator: Line, what: string): Promise<Line> => r.must(what, { call: 'act', locator, act: { kind: 'click', source: 'hid' } });
    await arm();
    await press({ id: `card-option:${String(allow.id)}` }, `a press on ${h.ask}'s allow option`);
    let presses = 1;
    let sent = answersSent(await r.read(h.ask));
    if (!sent.length && o.untilSent) {
      for (const s of switches(await r.read(h.ask)).filter(isOff)) {
        await press(typeof s.id === 'string' ? { id: s.id } : { role: s.role, name: s.name }, `a press on the switch "${s.name ?? ''}" of ${h.ask}'s card`);
        presses++;
      }
      await arm();
      await press({ id: `card-option:${String(allow.id)}` }, `a second press on ${h.ask}'s allow option`);
      presses++;
      sent = answersSent(await r.read(h.ask));
    }
    return { page, presses, sent };
  } finally {
    await r.stop();
  }
}

/**
 * AC5's and AC6's batch: inside one window of your visits on the hub's clock the agent's four steps (BATCH) are held;
 * after your next visit's time its turn ends waiting on your answer, and the hub, reading the asks again at that stop,
 * shows them as one batch (`ask.batched`, as #2029's batch shows). The four asks in the batch's order.
 */
export async function batchShown(w: World, a: Agent): Promise<Held[]> {
  const now = await clock(w);
  await stepTo(w, Math.ceil(now / BATCH_EVERY_MS) * BATCH_EVERY_MS + 2 * SECOND);
  const asks: Held[] = [];
  for (const step of BATCH) asks.push(await held(w, a, step));
  const after = await clock(w);
  await stepTo(w, Math.ceil(after / BATCH_EVERY_MS) * BATCH_EVERY_MS + 3 * SECOND);
  await a.says('The four steps wait for your answer.');
  const batch = await awaitRecord(w, (all) => all.find((e) => e.kind === 'ask.batched' && asks.every((h) => ((e.data.asks ?? []) as { ask: string }[]).some((m) => m.ask === h.ask))),
    `one batch showing the four held steps (${asks.map((h) => h.ask).join(', ')}) at your next visit`, 6 * MINUTE);
  return ((batch.data.asks ?? []) as { ask: string }[]).map((m) => asks.find((h) => h.ask === m.ask)).filter((h): h is Held => h !== undefined);
}

/** A run's pictures for the taste call (AC7), in $DA1101_SCREENS or a temp folder. */
export const screensDir = (): string => {
  const dir = process.env.DA1101_SCREENS ?? join(tempDir(), 'screens');
  mkdirSync(dir, { recursive: true });
  return dir;
};
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const exists = existsSync;
