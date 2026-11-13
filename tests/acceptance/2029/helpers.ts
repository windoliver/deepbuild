// Test-side tools for #2029 (README). Every reading comes from a real component:
// - AC1: the three closed sets are read from @deepbuild/contracts' published schemas, and what each of the app's views
//   draws for a code is read from the real app code through the replica (`deep-replica --words`, README, Pinned 1).
// - AC2: a real hub (`deep hub run`) in a temp HOME holds a Claude Code session's `git push` with an authority ask under
//   the shipped default guards; the push is allowed on its card as the app's card answers (`ask.answer`, signed by a
//   device paired with the hub, bound to the card's plan and a click's token); the push then runs, and its PostToolUse,
//   PostToolUseFailure or nothing comes over the hook wire, as deep-hook sends it. The receipt is read where a person
//   reads it: the answered ask's page in the real app's views, drawn by the real `deep-drive` (#124) over a copy of
//   that hub's record (README, Pinned 2).
//
// Reused by import: #16's homes, hub, hook wire, sessions, connections and PID cleanup.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was
// started with; nothing touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { canonicalize, getSchema, listSchemas, type JsonValue } from '../../../packages/contracts/src/index.ts';
import {
  allEvents, childEnv, cleanup as cleanup16, control, hookRequest, makeHome, newSession, NODE, openAs, own, REPO, run, sendHook, sleep, startHub, stopHub,
  tempDir, tokenOf, type Ev, type HookResult, type Hub, type Line, type Session,
} from '../16/helpers.ts';

export { sleep, stopHub, type Ev, type Hub };

export const SECOND = 1000;
export const MINUTE = 60_000;
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

/** The criteria, by `#2029.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  words: '#2029.9136787a',
  receipt: '#2029.af116b92',
} as const;

/** The planted wrong programs this suite selects with DEEP_HUB_PLANT (README, Plants). */
export const PLANT = {
  /** AC2: the receipt of an allowed step reads "Allowed" and nothing more, whatever the call's records say. */
  staysAllowed: 'receipt-stays-allowed',
  /** AC2: the receipt takes what the step did from the agent's next message ("Pushed main to origin."), not the call's records. */
  agentText: 'receipt-from-agent-text',
} as const;

/** The words AC2 pins, exactly as the issue writes them. */
export const REJECTED = '! [rejected] main -> main (fetch first)';
export const RECEIPT_FAILED = `Allowed · it failed: ${REJECTED} · the agent was told`;
export const RECEIPT_UNKNOWN = 'Allowed · outcome unknown';
export const BATCH_COUNTS = '3 ran · 1 failed';

export async function cleanup(): Promise<void> {
  await cleanup16();
}

// ---- Builds (README, How to run). #1172's build environment, all in one grant of the machine's build throttle; each
// binary is copied out of the target folder under its own name into a folder of this checkout's, so a planted build
// never stands in for the plain one and another checkout's never stands in for this one's. A copy newer than every
// file the Rust build reads is used as it is, so a run on a busy Mac doesn't queue for a build that has nothing to do.

const BIN = join(tmpdir(), `da2029-bin-${userInfo().uid}-${createHash('sha256').update(REPO).digest('hex').slice(0, 8)}`);
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
/** The copies the suite runs: `deep-replica` and `deep-drive` plain, and `deep-drive` with `env-plants`. */
const COPIES = ['deep-replica-plain', 'deep-drive-plain', 'deep-drive-plants'];
/** What the Rust build reads: a copy older than any of these is built again. */
const SOURCES = ['Cargo.toml', 'Cargo.lock', '.cargo', 'rust-toolchain.toml', 'crates', 'vendor', 'contracts', 'brand', 'adapters', 'packages/contracts/schemas'];
function newestMtime(path: string): number {
  if (!existsSync(path)) return 0;
  const s = statSync(path);
  if (!s.isDirectory()) return s.mtimeMs;
  return readdirSync(path).filter((n) => n !== 'target' && n !== 'node_modules' && n !== '.git').reduce((m, n) => Math.max(m, newestMtime(join(path, n))), s.mtimeMs);
}
let built: Promise<void> | undefined;
/**
 * deep-hook into the checkout's target, where the hub looks for it, and the three copies, in one throttled build when
 * any is missing or older than the sources; BLOCKED when the build fails.
 */
function builds(): Promise<void> {
  built ??= (async () => {
    if (process.platform !== 'darwin') blocked(`the replica draws on macOS only; this is ${process.platform}`);
    const sources = Math.max(...SOURCES.map((p) => newestMtime(join(REPO, p))));
    const fresh = (file: string): boolean => existsSync(file) && statSync(file).mtimeMs > sources;
    if (fresh(target('deep-hook')) && COPIES.every((copy) => fresh(join(BIN, copy)))) return;
    mkdirSync(BIN, { recursive: true });
    const q = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;
    const cargo = 'cargo build --locked -q';
    const script = [
      `${cargo} -p deep-hook --bin deep-hook`,
      `${cargo} -p deep-replica --features env-plants --bin deep-drive`,
      `cp ${q(target('deep-drive'))} ${q(join(BIN, 'deep-drive-plants'))}`,
      `${cargo} -p deep-replica --bin deep-drive --bin deep-replica`,
      `cp ${q(target('deep-drive'))} ${q(join(BIN, 'deep-drive-plain'))}`,
      `cp ${q(target('deep-replica'))} ${q(join(BIN, 'deep-replica-plain'))}`,
    ].join(' && ');
    const r = await run(NODE, ['scripts/throttle.mjs', 'build', '--wait', '60', '--', '/bin/sh', '-c', script], { env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' }, timeoutMs: 240 * MINUTE });
    if (r.code !== 0) blocked(`the build failed (exit ${r.code}): ${(r.stderr || r.stdout).slice(-2000)}`);
  })();
  return built;
}
/** `deep-replica`, plain: the replica whose `--words` reads each view's words (README, Pinned 1). */
export const wordsBin = (): Promise<string> => builds().then(() => join(BIN, 'deep-replica-plain'));
/** `deep-drive`, plain, or with `env-plants` so DEEP_HUB_PLANT selects a wrong program (README, Plants). */
export const driveBin = (planted: boolean): Promise<string> => builds().then(() => join(BIN, planted ? 'deep-drive-plants' : 'deep-drive-plain'));

/** The built CLI and hub every hub here runs. */
export function needCli(): void {
  if (!existsSync(join(REPO, 'packages/cli/dist/main.js'))) blocked('the CLI isn\'t built: run npm ci and npm run build --workspaces');
}

// ---- AC1: the three closed sets, as @deepbuild/contracts publishes them (README, The sets).

export type SetName = 'ask.outcome' | 'stop.cause' | 'verdict.reason';
export interface CodeSet { set: SetName; codes: string[]; from: string }
type Obj = { [key: string]: any };
const newest = (stem: string): string | undefined => listSchemas().map((e) => e.name).filter((n) => n.startsWith(`${stem}@`))
  .sort((a, b) => Number(b.slice(b.indexOf('@') + 1)) - Number(a.slice(a.indexOf('@') + 1)))[0];
/** A node with its local `$ref` (`#/…`) followed. */
function follow(schema: Obj, node: unknown): Obj | undefined {
  let at = node as Obj | undefined;
  for (let hops = 0; at && typeof at.$ref === 'string' && at.$ref.startsWith('#/') && hops < 8; hops++) {
    at = at.$ref.slice(2).split('/').reduce<Obj | undefined>((n, key) => (n && typeof n === 'object' ? n[key] as Obj : undefined), schema);
  }
  return at && typeof at === 'object' ? at : undefined;
}
/** The string members a node allows: its enum, its const, or those of each oneOf or anyOf branch. */
function members(schema: Obj, node: unknown): string[] {
  const at = follow(schema, node);
  if (!at) return [];
  if (Array.isArray(at.enum)) return at.enum.filter((v: unknown): v is string => typeof v === 'string');
  if (typeof at.const === 'string') return [at.const];
  return ['oneOf', 'anyOf'].flatMap((k) => (Array.isArray(at[k]) ? (at[k] as unknown[]).flatMap((b) => members(schema, b)) : []));
}
/** Every value of `key` among the `properties` of a schema's object nodes, anywhere in it. */
function propertiesNamed(node: unknown, key: string, into: unknown[] = []): unknown[] {
  if (Array.isArray(node)) for (const n of node) propertiesNamed(n, key, into);
  else if (node && typeof node === 'object') {
    const o = node as Obj;
    if (o.properties && typeof o.properties === 'object' && key in o.properties) into.push(o.properties[key]);
    for (const v of Object.values(o)) propertiesNamed(v, key, into);
  }
  return into;
}
const unique = (codes: string[]): string[] => [...new Set(codes)];
/** A standalone schema of the set, `<stem>@<n>` (as verdict.outcome@1 is the five outcomes'), when the contracts publish one. */
function standalone(stem: string): { codes: string[]; from: string } | undefined {
  const name = newest(stem);
  if (!name) return undefined;
  const schema = getSchema(name) as Obj;
  const codes = unique(members(schema, schema));
  return codes.length ? { codes, from: name } : undefined;
}
/**
 * The three sets (README, The sets). Each is its own schema when the contracts publish one (`ask.outcome@n`,
 * `stop.cause@n`, `verdict.reason@n`); else the ask outcomes are the newest `answer.refused`'s `outcome`, the design's
 * closed set with unanswered; the stop causes the newest `agent.stop`'s `cause`; the verdict reasons the closed members
 * of the newest `verdict.made`'s `reasons` (a string enum, or the enum of each reason's `code`). A set the contracts
 * don't close is a failure, naming it.
 */
export function codeSets(): { sets: CodeSet[]; failures: string[] } {
  const sets: CodeSet[] = [];
  const failures: string[] = [];
  const outcome = standalone('ask.outcome') ?? (() => {
    const name = newest('answer.refused');
    if (!name) return undefined;
    const schema = getSchema(name) as Obj;
    const codes = unique(members(schema, schema.properties?.data?.properties?.outcome));
    return codes.length ? { codes, from: `${name} data.outcome` } : undefined;
  })();
  if (outcome) sets.push({ set: 'ask.outcome', ...outcome });
  else failures.push('@deepbuild/contracts publishes no closed set of ask outcomes (ask.outcome@n, or answer.refused\'s outcome)');
  const cause = standalone('stop.cause') ?? (() => {
    const name = newest('agent.stop');
    if (!name) return undefined;
    const schema = getSchema(name) as Obj;
    const codes = unique(propertiesNamed(schema.properties?.data, 'cause').flatMap((n) => members(schema, n)));
    return codes.length ? { codes, from: `${name} data.cause` } : undefined;
  })();
  if (cause) sets.push({ set: 'stop.cause', ...cause });
  else failures.push('@deepbuild/contracts publishes no closed set of stop causes (stop.cause@n, or agent.stop\'s cause)');
  const reason = standalone('verdict.reason') ?? (() => {
    const name = newest('verdict.made');
    if (!name) return undefined;
    const schema = getSchema(name) as Obj;
    const codes = unique(propertiesNamed(schema, 'reasons').flatMap((r) => {
      const items = follow(schema, (follow(schema, r) ?? {}).items);
      if (!items) return [];
      const direct = members(schema, items);
      return direct.length ? direct : members(schema, items.properties?.code);
    }));
    return codes.length ? { codes, from: `${name} reasons` } : undefined;
  })();
  if (reason) sets.push({ set: 'verdict.reason', ...reason });
  else failures.push('@deepbuild/contracts publishes no closed set of verdict reasons: no verdict.reason@n, and the newest verdict.made\'s reasons are free text, so no view can be checked against them');
  return { sets, failures };
}

/** The outcome AC1 plants into the ask outcome set: no view has words for it (README, The sets). */
export const PLANTED_OUTCOME = 'planted_outcome';

// ---- AC1: what each view draws for a code (README, Pinned 1).

export interface Asked { set: SetName; code: string; core: string }
export interface Answered { set: string; code: string; views: { view: string; shows: string }[] }
/** The core's text for a code, as the test hands it to the views: words no view could have for the code itself. */
export const coreText = (set: SetName, code: string): string => `The core recorded ${set} ${createHash('sha256').update(`${set}:${code}`).digest('hex').slice(0, 10)}.`;
/**
 * `deep-replica --words`: a JSON array of `{set, code, core}` on stdin; on stdout the same array's answers in order,
 * `{set, code, views: [{view, shows}]}`, each view that shows codes of that set with what it draws for this one.
 * `why` when the replica gave no such answer.
 */
export async function viewWords(asked: readonly Asked[]): Promise<{ answered?: Answered[]; why?: string }> {
  const bin = await wordsBin();
  const home = makeHome();
  const r = await run(bin, ['--words'], { env: childEnv(home), input: JSON.stringify(asked), timeoutMs: 20 * MINUTE });
  if (r.code !== 0) return { why: `deep-replica --words ended with exit ${r.code}${r.signal ? ` (${r.signal})` : ''}: ${(r.stderr.trim() || r.stdout.trim()).slice(-400)}` };
  let answered: unknown;
  try { answered = JSON.parse(r.stdout); } catch { return { why: `deep-replica --words printed no JSON: ${r.stdout.slice(0, 400)}` }; }
  const ok = Array.isArray(answered) && answered.length === asked.length && answered.every((a: Obj, i) => a && a.set === asked[i]!.set && a.code === asked[i]!.code
    && Array.isArray(a.views) && a.views.every((v: Obj) => v && typeof v.view === 'string' && typeof v.shows === 'string'));
  if (!ok) return { why: `deep-replica --words answered out of shape (one {set, code, views: [{view, shows}]} per code asked, in order): ${r.stdout.slice(0, 600)}` };
  return { answered: answered as Answered[] };
}

/** The questions for a set of codes: each code with its core's text. */
export const asking = (sets: readonly CodeSet[]): Asked[] => sets.flatMap((s) => s.codes.map((code) => ({ set: s.set, code, core: coreText(s.set, code) })));

/**
 * AC1's judge: every code of every set has words in each view that shows it. A view has no words for a code when it
 * draws the core's text for it, a blank, or the raw code (the code itself, or a code with `_` anywhere in what it draws).
 * A set no view shows at all is a failure too. Each failure names the code.
 */
export function wordFailures(sets: readonly CodeSet[], got: { answered?: Answered[]; why?: string }): string[] {
  if (!got.answered) return sets.map((s) => `no view gave words for any ${s.set} (${got.why}), so none of these has words: ${s.codes.join(', ')}`);
  const failures: string[] = [];
  const asked = asking(sets);
  for (const s of sets) {
    const rows = asked.map((a, i) => ({ a, got: got.answered![i]! })).filter((r) => r.a.set === s.set);
    if (rows.every((r) => !r.got.views.length)) {
      failures.push(`no view shows a ${s.set}, so none of these has words: ${s.codes.join(', ')}`);
      continue;
    }
    for (const { a, got: g } of rows) {
      if (!g.views.length) failures.push(`${s.set} ${a.code} has words in no view: deep-replica --words lists none for it`);
      for (const v of g.views) {
        const shows = v.shows.trim();
        if (!shows) failures.push(`${v.view} has no words for the ${s.set} ${a.code}: it draws a blank`);
        else if (shows.includes(a.core.trim())) failures.push(`${v.view} has no words for the ${s.set} ${a.code}: it draws the core's text ("${shows}")`);
        else if (shows === a.code || (/_/.test(a.code) && shows.includes(a.code))) failures.push(`${v.view} has no words for the ${s.set} ${a.code}: it draws the raw code ("${shows}")`);
      }
    }
  }
  return failures;
}

// ---- AC2: a hub in a temp HOME with the shipped default guards (README, The world).

const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
/** The guard entries deep-hook's matcher meets on a plain `git push`: every shipped entry whose match is effect:push. */
export const PUSH_ENTRIES = Object.entries((JSON.parse(readFileSync(DEFAULT_RULES, 'utf8')) as { entries: Record<string, { match: string }> }).entries)
  .filter(([, e]) => e.match === 'effect:push').map(([name]) => name);
/** The newest Claude Code version the adapter's facts cover: what the session's transcript says it runs. */
const COVERED = ((JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions).at(-1)!;
/** How often your visits come in AC2's batch world: asks raised inside one such window show together, as one batch. */
export const BATCH_EVERY_MS = 2 * 60_000;
/** Your ask settings, as setup drafts them; the batch world adds a visit every BATCH_EVERY_MS (README, The fixtures). */
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
/** Whether the hub lists a plant: then the receipt is (also) the hub's to make, and its hub gets DEEP_HUB_PLANT too (README, Plants). */
export const hubLists = (plant: string): boolean => readFileSync(join(REPO, 'packages/hub/src/plant.ts'), 'utf8').includes(`'${plant}'`);

export interface World { home: string; root: string; repo: string; hub: Hub; device?: { id: string; key: KeyObject; hub: string } }
const git = (cwd: string, args: string[], home: string): Promise<void> => run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
  cwd, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
}).then((r) => { if (r.code !== 0) blocked(`git ${args.join(' ')}: ${r.stderr}`); });
/**
 * A HOME whose hub holds the shipped default guards (rules.json from crates/deep-hook/default-rules.json) and your ask
 * settings; a git repository `shop` with one commit on main, which Claude Code trusts; the OS confirming you
 * (DEEP_HUB_TEST_CONFIRM's file says `confirmed`); then `deep hub run`, given `plant` when the hub lists it.
 */
export async function world(o: { batch?: boolean; plant?: string } = {}): Promise<World> {
  needCli();
  await builds();
  const home = makeHome();
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  const tools = join(home, 'tools');
  mkdirSync(tools, { recursive: true });
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: { ...SETTINGS, ...(o.batch ? { batch: { every: `${BATCH_EVERY_MS / 60_000}m`, cap: 20 } } : {}) }, runner: { login_path: `${tools}:/usr/bin:/bin` } }, null, 2)}\n`);
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(root, 'setup-finished.json'), JSON.stringify({ version }));
  const repo = join(tempDir(), 'shop');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'auth.js'), 'export const checkToken = (token) => token.exp > Date.now() / 1000;\n');
  await git(repo, ['init', '-q', '-b', 'main'], home);
  await git(repo, ['add', '.'], home);
  await git(repo, ['commit', '-q', '-m', 'base'], home);
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ numStartups: 3, projects: { [repo]: { allowedTools: [], hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  const confirm = join(home, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const hubPlant = o.plant && hubLists(o.plant) ? o.plant : undefined;
  const hub = await startHub({ home, env: { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_STOP_HOLD_MS: '5000', DEEP_HUB_PLANT: hubPlant } }, 10 * MINUTE);
  return { home, root, repo, hub };
}

export async function eventsOf(hub: Hub): Promise<Ev[]> {
  const conn = await control(hub);
  try { return await allEvents(conn); } finally { conn.close(); }
}
/** Polls the record until `pick` finds what it waits for; BLOCKED naming it when it never comes. */
export async function awaitRecord<T>(hub: Hub, pick: (events: Ev[]) => T | undefined, what: string, timeoutMs = 3 * MINUTE): Promise<T> {
  const by = Date.now() + timeoutMs;
  for (;;) {
    const found = pick(await eventsOf(hub));
    if (found !== undefined) return found;
    if (Date.now() > by) blocked(`${what}: not in the hub's record after ${timeoutMs / 1000} s`);
    await sleep(500);
  }
}
async function cli(hub: Hub, method: string, params: Line): Promise<Line> {
  const conn = await control(hub);
  try {
    const reply = await conn.call(method, params, 60_000);
    if (reply.error) blocked(`${method} was refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  } finally { conn.close(); }
}

// ---- AC2: a Claude Code session on the hook wire (README, The session), its agent's process a `sleep`.

let calls = 0;
export class Agent {
  readonly s: Session;
  readonly pid: number;
  private parent: string | null = null;
  private constructor(private readonly w: World, child: ChildProcess) {
    this.s = newSession(w.home, 'claude-code', w.repo);
    this.pid = child.pid!;
  }
  static async start(w: World, prompt: string): Promise<Agent> {
    const child = spawn('/bin/sleep', ['7200'], { stdio: 'ignore' });
    own(child.pid);
    const a = new Agent(w, child);
    await a.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    a.entry({ type: 'user', message: { role: 'user', content: prompt }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
    await a.hook('UserPromptSubmit', { prompt });
    return a;
  }
  get id(): string { return this.s.id; }
  /** One transcript entry, as Claude Code writes it. */
  private entry(value: Line): void {
    const uuid = randomBytes(16).toString('hex');
    appendFileSync(this.s.transcript, `${JSON.stringify({ parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.s.cwd, sessionId: this.s.id, version: COVERED, gitBranch: 'main' })}\n`);
    this.parent = uuid;
  }
  /** One hook on the hub's socket, as deep-hook sends it from this session's process; BLOCKED unless the hub acknowledged it. */
  async hook(event: string, extra: Line = {}, matched: string[] = []): Promise<HookResult> {
    const request = { ...hookRequest(this.s, event, extra), matched, pid: this.pid, ppid: this.pid };
    const r = await sendHook(this.w.hub.socket, request, 4 * MINUTE);
    if (!r.ack) blocked(`the hub didn't acknowledge ${event} of session ${this.s.id}: ${JSON.stringify(r).slice(0, 600)}`);
    return r;
  }
  /**
   * The agent calls `git push …`: its tool_use, and its PreToolUse with the entries deep-hook matches on a push. Whether
   * the hub let it run, and what it told the agent.
   */
  async push(command: string): Promise<{ call: string; ran: boolean; said: string }> {
    const call = `toolu_2029${randomBytes(8).toString('hex')}${++calls}`;
    const input = { command, description: 'Push to the remote' };
    this.entry({ type: 'assistant', message: { role: 'assistant', type: 'message', model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id: call, name: 'Bash', input }], stop_reason: 'tool_use' } });
    const r = await this.hook('PreToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: call }, PUSH_ENTRIES);
    const reply = r.reply ?? blocked(`the hub gave no reply to the PreToolUse of \`${command}\`: ${JSON.stringify(r).slice(0, 400)}`);
    let out: Line | undefined;
    try { out = JSON.parse(String(reply.stdout || '{}')) as Line; } catch { out = undefined; }
    const denied = reply.exit === 2 || out?.hookSpecificOutput?.permissionDecision === 'deny' || out?.decision === 'block';
    const said = String(out?.hookSpecificOutput?.permissionDecisionReason ?? reply.stderr ?? '');
    if (denied) this.entry({ type: 'user', message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content: said, is_error: true }] } });
    return { call, ran: !denied, said };
  }
  /** The call ran and ended well: its tool_result and PostToolUse. */
  async ok(call: string, command: string, stdout: string): Promise<void> {
    const response = { stdout, stderr: '', interrupted: false, isImage: false };
    this.entry({ type: 'user', message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content: stdout, is_error: false }] }, toolUseResult: response });
    await this.hook('PostToolUse', { tool_name: 'Bash', tool_input: { command, description: 'Push to the remote' }, tool_use_id: call, tool_response: response, duration_ms: 900 });
  }
  /** The call ran and failed: its tool_result and PostToolUseFailure, `error` as Claude Code writes it ("Exit code 1\n…"). */
  async failed(call: string, command: string, error: string): Promise<void> {
    this.entry({ type: 'user', message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content: error, is_error: true }] }, toolUseResult: `Error: ${error}` });
    await this.hook('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command, description: 'Push to the remote' }, tool_use_id: call, error, is_interrupt: false, duration_ms: 900 });
  }
  /** The agent's next message, and its turn's end: the assistant's text in the transcript, then Stop carrying it. */
  async says(text: string): Promise<void> {
    this.entry({ type: 'assistant', message: { role: 'assistant', type: 'message', model: 'claude-haiku-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn' } });
    await this.hook('Stop', { stop_hook_active: false, last_assistant_message: text });
  }
}

/** Claude Code's `error` for a `git push` the remote rejected: the exit line, then what git printed. */
export const pushError = (rejected: string): string => `Exit code 1\n ${rejected}\nerror: failed to push some refs to 'github.com:acme/shop.git'\nhint: Updates were rejected because the remote contains work that you do not\nhint: have locally.`;

export interface Held { ask: string; question: string; card: Line }
/**
 * The agent pushes and the hub holds the push: the call doesn't run, and an authority ask naming it is raised. Its
 * handle, question and card (`ask.card`, what the app and `deep inbox` show). BLOCKED when the hub lets the push run.
 */
export async function held(w: World, a: Agent, command: string): Promise<Held> {
  const since = Math.max(0, ...(await eventsOf(w.hub)).map((e) => e.log_pos));
  const tried = await a.push(command);
  if (tried.ran) blocked(`\`${command}\` ran with no ask: the shipped guard push-needs-ask didn't hold it (${tried.said.slice(0, 300)})`);
  const created = await awaitRecord(w.hub, (all) => all.find((e) => e.kind === 'ask.created' && e.log_pos > since && e.data.kind === 'authority' && String(e.data.question ?? '').includes(command)), `the authority ask holding \`${command}\``);
  const ask = `ask:${created.id}`;
  return { ask, question: String(created.data.question), card: await cli(w.hub, 'ask.card', { ask }) };
}

/** The app's paired device, made once a world: an Ed25519 key paired with the hub (`device.pair`, the OS confirming you). */
async function deviceOf(w: World): Promise<NonNullable<World['device']>> {
  if (w.device) return w.device;
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const conn = await control(w.hub);
  let hubId: string;
  try {
    hubId = String(conn.hello?.hub ?? '');
    if (!hubId) blocked(`the hub's hello names no hub ID: ${JSON.stringify(conn.hello)}`);
    const paired = await conn.call('device.pair', { name: 'DeepBuild app', public_key: String(publicKey.export({ format: 'jwk' }).x) }, 60_000);
    if (paired.error || typeof paired.result?.device !== 'string') blocked(`device.pair was refused: ${JSON.stringify(paired)}`);
    w.device = { id: String(paired.result.device), key: privateKey, hub: hubId };
  } finally { conn.close(); }
  return w.device;
}
/**
 * "Allowed on its card": the card's allow option, sent as the app's card sends it (crates/deep-app/src/answer.rs):
 * `ask.answer {ask, option, plan_hash, token, steps?}` on an app connection, signed by the paired device for this hub,
 * bound to the plan the card showed and a click's token. `steps` approves a batch's steps by index (#327).
 */
export async function allowOnCard(w: World, h: Held, steps?: number[]): Promise<void> {
  const device = await deviceOf(w);
  const allow = ((h.card.options ?? []) as Line[]).find((o) => o.decision === 'allow') ?? blocked(`${h.ask}'s card offers no option that allows: ${JSON.stringify(h.card.options)}`);
  const params: Line = { ask: h.ask, option: String(allow.id), plan_hash: h.card.plan?.hash ?? null, token: `click-${randomBytes(8).toString('hex')}`, ...(steps ? { steps } : {}) };
  const signed = { device: device.id, method: 'ask.answer', hub: device.hub, at: Date.now(), once: randomBytes(18).toString('base64url'), params: createHash('sha256').update(canonicalize(params as JsonValue)).digest('hex') };
  const sig = sign(null, canonicalize(signed as JsonValue), device.key).toString('base64url');
  const conn = await openAs(w.hub.socket, 'app', tokenOf(w.hub.root));
  try {
    const reply = await conn.call('ask.answer', { ...params, signature: { signed, sig } }, 3 * MINUTE);
    if (reply.error) blocked(`the card's allow of ${h.ask} was refused: ${JSON.stringify(reply.error)}`);
  } finally { conn.close(); }
  await awaitRecord(w.hub, (all) => all.find((e) => e.kind === 'ask.answered' && e.subject === h.ask && e.data.decision === 'allow'), `${h.ask} answered allow`);
}
/** Waits until a batch window has just begun, so asks raised now show together at the next visit. */
export async function windowStart(): Promise<void> {
  const into = Date.now() % BATCH_EVERY_MS;
  if (into >= 2000 && into < 20_000) return;
  await sleep((BATCH_EVERY_MS - into + 2000) % BATCH_EVERY_MS);
}
/** Waits until the next batch window has begun: the time of your next visit has passed. */
export const nextWindow = (): Promise<void> => sleep(BATCH_EVERY_MS - (Date.now() % BATCH_EVERY_MS) + 3000);
/** The agent runs the allowed push again, as the hold told it to; it must now go through (a hold's countdown may delay it). */
export async function runsAgain(a: Agent, command: string): Promise<string> {
  const by = Date.now() + 2 * MINUTE;
  for (;;) {
    const tried = await a.push(command);
    if (tried.ran) return tried.call;
    if (Date.now() > by) blocked(`the allowed \`${command}\` never ran: the hub still holds it (${tried.said.slice(0, 300)})`);
    await sleep(3000);
  }
}

// ---- AC2: the receipt, read on the answered ask's page in the real app's views (README, Pinned 2).

export interface SNode { role: string; name: string | null; value: unknown; id?: unknown; bounds: number[]; children: SNode[] }
const flat = (n: SNode, into: SNode[] = []): SNode[] => { into.push(n); for (const c of n.children ?? []) flat(c, into); return into; };
const PAGE = /^(ask|session|project|page)\/\S+$/;
const said = (v: unknown): string => (JSON.stringify(v) ?? String(v)).slice(0, 300);
/** `deep-drive` (#124) over a copy of a world's record, as #1461's suite drives it: one JSON call per line on stdin. */
class Drive {
  private buffer = '';
  private readonly waiting: ((line: Line) => void)[] = [];
  private exited = false;
  private err = '';
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
  static async start(home: string, plant?: string): Promise<Drive> {
    const bin = await driveBin(plant !== undefined);
    const out = join(tempDir(), 'out');
    mkdirSync(out, { recursive: true });
    const child = spawn(bin, ['--out', out], { cwd: REPO, env: childEnv(home, { DEEP_HUB_PLANT: plant }), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const d = new Drive(child);
    const ready = await d.next(10 * MINUTE);
    if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${said(ready)} ${d.err.slice(-600)}`);
    return d;
  }
  private next(ms: number): Promise<Line> {
    if (this.exited) return Promise.resolve({ exited: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  async must(what: string, args: Line): Promise<Line> {
    const reply = this.next(10 * MINUTE);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.exited || got.timedOut || got.unparsed !== undefined) blocked(`deep-drive gave no JSON reply to ${what}: ${said(got)} ${this.err.slice(-600)}`);
    if (got.ok !== true) blocked(`deep-drive refused ${what}: ${said(got.error ?? got)}`);
    return got;
  }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const by = Date.now() + 5000;
    while (!this.exited && Date.now() < by) await sleep(20);
    if (!this.exited) try { process.kill(this.child.pid!, 'SIGKILL'); } catch { /* gone */ }
  }
}

/** What an ask's page shows: the address the window shows, and every string drawn or named on the page. */
export interface Page { ask: string; address: string | null; said: string | null; texts: string[] }
const clean = (t: string): string => t.normalize('NFC').replace(/\s+/g, ' ').trim();
/**
 * Opens each ask's page, `ask/<ULID>` (#1460's address), in the app's views drawn by `deep-drive` over a copy of the
 * world's record taken now (the plain replica, or with `plant` the `env-plants` one), and reads what each page shows.
 */
export async function pages(w: World, asks: readonly string[], plant?: string): Promise<Map<string, Page>> {
  const d = await Drive.start(w.home, plant);
  try {
    await d.must('the launch over a copy of the record', { call: 'launch', launch: { from: 'record_copy' } });
    const out = new Map<string, Page>();
    for (const ask of asks) {
      const opened = await d.must(`the open of ${ask}'s page`, { call: 'open', open: { address: `ask/${ask.slice('ask:'.length)}` } });
      const seen = await d.must(`see on ${ask}'s page`, { call: 'see' });
      const tree = (seen.snapshot as { tree: SNode }).tree;
      const nodes = flat(tree);
      const page = nodes.filter((n) => typeof n.id === 'string' && PAGE.test(n.id));
      const within = page.length === 1 ? flat(page[0]!) : nodes;
      const texts = [...new Set(within.flatMap((n) => [n.name ?? '', typeof n.value === 'string' ? n.value : '']).map(clean).filter(Boolean))];
      out.set(ask, { ask, address: (seen.address ?? null) as string | null, said: (opened.said ?? null) as string | null, texts });
    }
    return out;
  } finally {
    await d.stop();
  }
}

/** Where a page's words are quoted in a failure: the strings that read like a receipt, else the page's first strings. */
const receiptLines = (p: Page): string[] => p.texts.filter((t) => /\bAllowed\b|\bran\b|\bfailed\b|\boutcome\b/i.test(t));
const shown = (p: Page): string => {
  const lines = receiptLines(p);
  return lines.length ? `its receipt reads ${lines.map((l) => `"${l}"`).join(', ')}` : `no receipt is on its page (${p.address ?? 'no address'}${p.said ? `, which says "${p.said}"` : ''}; the page shows ${p.texts.slice(0, 12).map((t) => `"${t.slice(0, 160)}"`).join(', ') || 'nothing'})`;
};
/**
 * AC2's judge for one answered ask: its page shows each expected piece of its receipt, and no receipt line takes
 * "pushed" from the agent's message. Each failure names the ask and its question.
 */
export function receiptFailures(p: Page | undefined, h: Held, expected: readonly string[]): string[] {
  const who = `${h.ask} ("${h.question.slice(0, 120)}")`;
  if (!p) return [`${who}: its page was never read`];
  const all = clean(p.texts.join(' '));
  const failures = expected.filter((e) => !p.texts.some((t) => t.includes(e)) && !all.includes(e)).map((e) => `${who}: the receipt must read "${e}"; ${shown(p)}`);
  const pushed = receiptLines(p).filter((l) => /\bpushed\b/i.test(l));
  if (pushed.length) failures.push(`${who}: the receipt takes "pushed" from the agent's next message, not the call's own records: ${pushed.map((l) => `"${l}"`).join(', ')}`);
  return failures;
}
