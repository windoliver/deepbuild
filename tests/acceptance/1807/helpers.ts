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

export { sleep, stopHub, type Ev, type Line };

export const SECOND = 1000;
export const MINUTE = 60_000;
export const SUITE = new URL('.', import.meta.url).pathname;
export const DECIDED_RECORD = join(SUITE, 'fixtures', 'record.events.jsonl');
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);

export const ID = {
  row: '#1807.7b07b348',
  undo: '#1807.9f2f358f',
  last: '#1807.77fab939',
  settled: '#1807.55e5c424',
  page: '#1807.ed9995d7',
  shown: '#1807.9a39e256',
} as const;

export const PLANT = {
  rowLeavesAt2s: 'answered-row-leaves-at-2s',
  undoSendsNothing: 'undo-clears-receipt-only',
  lastReceiptLeaves: 'last-receipt-jumps-away',
  settledUnderNeedsYou: 'settled-row-under-needs-you',
  decidedRowInList: 'decided-row-in-list',
} as const;

export const STARTS_IN = /Starts in/;
export const UNDO = 'Undo';
export const DECIDED = 'Decided';
export const HOLD_MS = 10_000;

export async function cleanup(): Promise<void> {
  await cleanup16();
}

const TARGET = process.env.CARGO_TARGET_DIR ?? join(REPO, 'target');
const BIN = join(tmpdir(), `da1807-bin-${userInfo().uid}-${createHash('sha256').update(REPO).digest('hex').slice(0, 8)}`);
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
const hookBuilt = (): Promise<void> => (hookBuild ??= fresh(join(TARGET, 'debug', 'deep-hook')) ? Promise.resolve() : throttled('cargo build --locked -q -p deep-hook --bin deep-hook', 'deep-hook'));
const drives = new Map<boolean, Promise<string>>();
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

export const NOW = 1_800_000_000_000;
const HUB_START = NOW + MINUTE;
const FLICKS_PER_MS = 705_600;

const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
const RULES = (JSON.parse(readFileSync(DEFAULT_RULES, 'utf8')) as { entries: Record<string, { match: string }> }).entries;
const entriesFor = (effect: string): string[] => Object.entries(RULES).filter(([, e]) => e.match === `effect:${effect}`).map(([name]) => name);
const COVERED = ((JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions).at(-1)!;
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
export const PROMPT = 'Fix the login bug in src/auth.js.';

export interface Step { command: string; matched: string[]; ref: string }
const push = (ref: string): Step => ({ command: `git push origin ${ref}`, matched: entriesFor('push'), ref });
export const PUSH = push('main');
export const PUSH_TAG = push('v2.0.0');

export interface Device { id: string; key: KeyObject; hub: string }
export interface Tried { step: string; call: string; sent: number; replied: boolean; ran: boolean; said: string; at: number }
export interface World {
  home: string; root: string; repo: string; remote: string; hub: Hub; env: Record<string, string | undefined>;
  base: number; device?: Device; tries: Tried[]; waiting: Promise<Tried>[];
}

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
export async function clock(w: World, advance = 0): Promise<number> {
  return Number((await call(w, 'test.clock', { advance_ms: Math.max(0, Math.round(advance)) })).now);
}
export async function stepTo(w: World, at: number): Promise<number> {
  const now = await clock(w);
  return now >= at ? now : clock(w, at - now);
}
const stamp = (w: World): number => Date.now() + w.base;

export async function world(o: { plant?: string } = {}): Promise<World> {
  needCli();
  await hookBuilt();
  const home = makeHome();
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  const tools = join(home, 'tools');
  mkdirSync(tools, { recursive: true });
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS, runner: { login_path: `${tools}:/usr/bin:/bin` } }, null, 2)}\n`);
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
  const env = { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_STOP_HOLD_MS: '5000', DEEP_HUB_TEST_CLOCK_STEPS: '1', DEEP_HUB_PLANT: o.plant && hubLists(o.plant) ? o.plant : undefined };
  const hub = await startHub({ home, clock: HUB_START, env }, 10 * MINUTE);
  const conn = await control(hub);
  let base: number;
  try {
    const reply = await conn.call('test.clock', { advance_ms: 0 }, 60_000);
    if (reply.error) blocked(`the hub serves no test clock (DEEP_HUB_TEST_CLOCK_STEPS=1): ${JSON.stringify(reply.error)}`);
    base = Number(reply.result.now) - Date.now();
  } finally { conn.close(); }
  return { home, root, repo, remote, hub, env, base, tries: [], waiting: [] };
}

export async function eventsOf(w: World): Promise<Ev[]> {
  const conn = await control(w.hub);
  try { return await allEvents(conn); } finally { conn.close(); }
}
export async function awaitRecord<T>(w: World, pick: (events: Ev[]) => T | undefined, what: string, timeoutMs = 3 * MINUTE): Promise<T> {
  const by = Date.now() + timeoutMs;
  for (;;) {
    const found = pick(await eventsOf(w));
    if (found !== undefined) return found;
    if (Date.now() > by) blocked(`${what}: not in the hub's record after ${timeoutMs / 1000} s`);
    await sleep(500);
  }
}
export async function notOpenAgain(w: World, ask: string): Promise<string | undefined> {
  const row = ((await call(w, 'inbox.read', {})).asks as Line[]).find((r) => r.ask === ask);
  if (!row) return `the hub's inbox doesn't list ${ask}`;
  if (row.status === 'closed' || row.outcome !== 'unanswered') return `the hub's inbox reads ${ask} ${String(row.status)}, ${String(row.outcome)}, not open and unanswered`;
  return undefined;
}
export async function remoteHas(w: World, ref: string): Promise<boolean> {
  const r = await run('git', ['--git-dir', w.remote, 'show-ref', '--verify', '-q', ref === 'main' ? 'refs/heads/main' : `refs/tags/${ref}`], { env: GIT_ENV(w.home) });
  return r.code === 0;
}

let calls = 0;
export class Agent {
  readonly s: Session;
  readonly pid: number;
  private parent: string | null = null;
  private constructor(private readonly w: World, child: ChildProcess) {
    this.s = newSession(w.home, 'claude-code', w.repo);
    this.pid = child.pid!;
  }
  static async start(w: World): Promise<Agent> {
    const child = spawn('/bin/sleep', ['7200'], { stdio: 'ignore' });
    own(child.pid);
    const a = new Agent(w, child);
    await a.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    a.entry({ type: 'user', message: { role: 'user', content: PROMPT }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
    await a.hook('UserPromptSubmit', { prompt: PROMPT });
    return a;
  }
  private entry(value: Line): void {
    const uuid = randomBytes(16).toString('hex');
    appendFileSync(this.s.transcript, `${JSON.stringify({ parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date(stamp(this.w)).toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.s.cwd, sessionId: this.s.id, version: COVERED, gitBranch: 'main' })}\n`);
    this.parent = uuid;
  }
  async hook(event: string, extra: Line = {}, matched: string[] = []): Promise<HookResult> {
    const at = stamp(this.w);
    const request = { ...hookRequest(this.s, event, extra), seq: nextSeq(at), id: ulid(at), matched, pid: this.pid, ppid: this.pid };
    const r = await sendHook(this.w.hub.socket, request, 4 * MINUTE);
    if (!r.ack) blocked(`the hub didn't acknowledge ${event} of session ${this.s.id}: ${JSON.stringify(r).slice(0, 600)}`);
    return r;
  }
  async call(step: Step): Promise<{ call: string; ran: boolean; said: string }> {
    const call = `toolu_1807${randomBytes(8).toString('hex')}${++calls}`;
    const input = { command: step.command, description: 'Push to the remote' };
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
  async runs(step: Step, call: string): Promise<void> {
    const r = await run('git', ['-c', 'core.hooksPath=/dev/null', 'push', 'origin', step.ref], { cwd: this.w.repo, env: GIT_ENV(this.w.home) });
    const stdout = `${r.stdout}${r.stderr}`;
    const input = { command: step.command, description: 'Push to the remote' };
    const response = { stdout, stderr: '', interrupted: false, isImage: false };
    this.entry({ type: 'user', message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content: stdout, is_error: false }] }, toolUseResult: response });
    await this.hook('PostToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: call, tool_response: response, duration_ms: 900 });
  }
}

export interface Held { ask: string; ulid: string; question: string; step: Step; card: Line; ts: number }
export async function held(w: World, a: Agent, step: Step): Promise<Held> {
  const since = Math.max(0, ...(await eventsOf(w)).map((e) => e.log_pos));
  const tried = await a.call(step);
  if (tried.ran) blocked(`\`${step.command}\` ran with no ask: the shipped guards didn't hold it (${tried.said.slice(0, 300)})`);
  const created = await awaitRecord(w, (all) => all.find((e) => e.kind === 'ask.created' && e.log_pos > since && e.data.kind === 'authority' && String(e.data.question ?? '').includes(step.command)),
    `the authority ask holding \`${step.command}\` (the hub told the agent "${tried.said.slice(0, 300)}")`, MINUTE);
  const ask = `ask:${created.id}`;
  return { ask, ulid: created.id, question: String(created.data.question), step, card: await call(w, 'ask.card', { ask }), ts: created.ts };
}

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
export async function settleTries(w: World, waitMs = 60 * SECOND): Promise<void> {
  await Promise.race([Promise.allSettled(w.waiting), sleep(waitMs)]);
}
export const ranTries = (w: World, step: Step): Tried[] => w.tries.filter((t) => t.step === step.command && t.replied && t.ran);

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
export const allowOption = (h: Held): Line => ((h.card.options ?? []) as Line[]).find((o) => o.decision === 'allow') ?? blocked(`${h.ask}'s card offers no option that allows: ${JSON.stringify(h.card.options)}`);
export async function allowOnHub(w: World, h: Held, params?: Line): Promise<Ev> {
  const yes = params ?? { ask: h.ask, option: String(allowOption(h).id), plan_hash: h.card.plan?.hash ?? null, token: `click-${randomBytes(8).toString('hex')}` };
  const reply = await asApp(w, 'ask.answer', yes);
  if (reply.error) blocked(`the yes to ${h.ask} was refused by the hub: ${JSON.stringify(reply.error)}`);
  return awaitRecord(w, (all) => all.find((e) => e.kind === 'ask.answered' && e.subject === h.ask && e.data.decision === 'allow'), `${h.ask} answered allow`);
}

export async function copyRecord(w: World): Promise<{ file: string; last: number }> {
  const events = await eventsOf(w);
  const file = join(tempDir(), 'record.events.jsonl');
  writeFileSync(file, `${events.map((e) => JSON.stringify({ session_id: e.session ?? '', event: e })).join('\n')}\n`);
  return { file, last: Math.max(0, ...events.map((e) => e.log_pos)) };
}

export interface SNode { role: string; name: string | null; value: unknown; id?: unknown; bounds: number[]; children: SNode[] }
export const flat = (n: SNode, into: SNode[] = []): SNode[] => { into.push(n); for (const c of n.children ?? []) flat(c, into); return into; };
const said = (v: unknown): string => (JSON.stringify(v) ?? String(v)).slice(0, 300);
const clean = (t: string): string => t.normalize('NFC').replace(/\s+/g, ' ').trim();
export const textsOf = (nodes: SNode[]): string[] => [...new Set(nodes.flatMap((n) => [n.name ?? '', typeof n.value === 'string' ? n.value : '']).map(clean).filter(Boolean))];

export interface Seen { tree: SNode; nodes: SNode[]; address: string | null; hub: Line[]; menus: { title: string; items: { title: string; enabled: boolean }[] }[] }
export const byId = (s: Seen, id: string): SNode | undefined => s.nodes.find((n) => n.id === id);
export const listOf = (s: Seen): SNode | undefined => byId(s, 'list');
export const listRows = (s: Seen): string[] => {
  const list = listOf(s);
  return list ? flat(list).map((n) => String(n.id ?? '')).filter((id) => /^(ask|session|quiet|project):[^:]+$/.test(id)) : [];
};
export const rowNodes = (s: Seen, row: string): SNode[] => {
  const list = listOf(s);
  const node = list ? flat(list).find((n) => n.id === row) : undefined;
  if (!node) return [];
  return [...flat(node), ...flat(list!).filter((n) => typeof n.id === 'string' && n.id.startsWith(`${row}:`))];
};
export const pageNodes = (s: Seen): SNode[] => {
  const page = s.address ? byId(s, s.address) : undefined;
  if (page) return flat(page);
  const list = listOf(s);
  const inList = new Set(list ? flat(list) : []);
  return s.nodes.filter((n) => !inList.has(n));
};
export const card = (s: Seen): SNode[] => {
  const node = byId(s, 'question-card');
  return node ? flat(node) : [];
};
export const shows = (nodes: SNode[], words: string | RegExp): boolean => {
  const texts = textsOf(nodes);
  const joined = texts.join(' ');
  return typeof words === 'string' ? texts.some((t) => t.includes(words)) || joined.includes(words) : texts.some((t) => words.test(t)) || words.test(joined);
};
export const undoControls = (nodes: SNode[]): SNode[] => nodes.filter((n) => clean(n.name ?? '') === UNDO || n.id === 'card-undo' || (typeof n.id === 'string' && n.id.endsWith(':undo')));
export const quote = (nodes: SNode[]): string => textsOf(nodes).slice(0, 14).map((t) => `"${t.slice(0, 120)}"`).join(', ') || 'nothing';
export const askAddress = (h: Held): string => `ask/${h.ulid}`;

export class Replica {
  private buffer = '';
  private readonly waiting: ((line: Line) => void)[] = [];
  private exited = false;
  private err = '';
  now = NOW;
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
  static async on(fixture: string, o: { plant?: string; theme?: 'light' | 'dark' } = {}): Promise<Replica> {
    const bin = await driveBin(o.plant !== undefined);
    const out = join(tempDir(), 'out');
    mkdirSync(out, { recursive: true });
    const confirm = join(tempDir(), 'confirm');
    writeFileSync(confirm, 'confirmed\n');
    const child = spawn(bin, ['--out', out], { cwd: REPO, env: childEnv(makeHome(), { DEEP_HUB_PLANT: o.plant, DEEP_APP_TEST_CONFIRM: confirm }), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const r = new Replica(child);
    const ready = await r.next(10 * MINUTE);
    if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${said(ready)} ${r.err.slice(-600)}`);
    await r.must('the launch on a copy of the record', { call: 'launch', launch: { from: 'fixture', fixture, theme: o.theme ?? 'light' } });
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
  async at(ms: number, stepMs = 500): Promise<void> {
    if (ms <= this.now) return;
    const t = Math.round((ms - NOW) * FLICKS_PER_MS);
    await this.must(`moving the replica's clock to ${ms}`, { call: 'wait_for', wait_for: { t, step_ms: stepMs }, timeout: Math.max(0, ms - NOW) + MINUTE });
    this.now = ms;
  }
  async see(): Promise<Seen> {
    const seen = await this.must('see', { call: 'see' });
    const tree = (seen.snapshot as { tree: SNode }).tree;
    return { tree, nodes: flat(tree), address: (seen.address ?? null) as string | null, hub: (Array.isArray(seen.hub) ? seen.hub : []) as Line[], menus: (Array.isArray(seen.menus) ? seen.menus : []) as Seen['menus'] };
  }
  async open(address: string): Promise<Line> { return this.must(`the open of ${address}`, { call: 'open', open: { address } }); }
  async press(keys: string): Promise<void> { await this.must(`the keys ${keys}`, { call: 'act', act: { kind: 'press', keys, source: 'hid' } }); }
  async type(text: string): Promise<void> { await this.must(`typing "${text}"`, { call: 'act', act: { kind: 'type', text, source: 'hid' } }); }
  async menu(path: string[]): Promise<void> { await this.must(`the menu item ${path.join(' › ')}`, { call: 'act', act: { kind: 'menu', path } }); }
  async pressControl(id: string): Promise<void> { await this.must(`a press on ${id}`, { call: 'act', locator: { id }, act: { kind: 'click', source: 'hid' } }); }
  async feed(e: Ev): Promise<void> {
    const event: Line = { v: (e as Line).v ?? 1, id: e.id, kind: e.kind, writer: e.writer, actor: e.actor, scope: e.scope, data: e.data, ...(e.subject ? { subject: e.subject } : {}) };
    await this.must(`feeding ${e.kind}`, { call: 'feed', feed: { session: e.session ?? '', event } });
  }
  async screenshot(to: string): Promise<string> {
    const shot = await this.must('a screenshot of the window', { call: 'screenshot', screenshot: { target: 'window' } });
    copyFileSync(String(shot.path), to);
    return createHash('sha256').update(readFileSync(to)).digest('hex');
  }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { this.exited = true; }
    const by = Date.now() + 5000;
    while (!this.exited && Date.now() < by) await sleep(20);
    if (!this.exited) try { process.kill(this.child.pid!, 'SIGKILL'); } catch { this.exited = true; }
  }
}

export async function feedSince(w: World, r: Replica, after: number, skip: (e: Ev) => boolean = () => false): Promise<number> {
  const events = (await eventsOf(w)).filter((e) => e.log_pos > after);
  for (const e of events) if (!skip(e)) await r.feed(e);
  return Math.max(after, ...events.map((e) => e.log_pos));
}

export interface Answered { w: World; a: Agent; r: Replica; first: Held; second?: Held; start: number; before: string[]; fed: number; plant?: string }
export async function answeredInApp(o: { second: boolean; plant?: string }): Promise<Answered> {
  const w = await world(o.plant ? { plant: o.plant } : {});
  const a = await Agent.start(w);
  const first = await held(w, a, PUSH);
  const second = o.second ? await held(w, a, PUSH_TAG) : undefined;
  await driveBin(o.plant !== undefined);
  const copy = await copyRecord(w);
  const r = await Replica.on(copy.file, o.plant ? { plant: o.plant } : {});
  await r.at(await clock(w), 5000);
  const before = listRows(await r.see());
  await r.open(askAddress(first));
  await r.at((await clock(w)), 5000);
  for (let i = 0; i < 40 && String(byId(await r.see(), 'question-card')?.value ?? '') !== 'armed'; i++) await r.at(r.now + 100, 100);
  await r.pressControl(`card-option:${String(allowOption(first).id)}`);
  const sent = (await r.see()).hub.find((c) => c.method === 'ask.answer' && (c.params as Line)?.ask === first.ask);
  if (!sent) blocked(`Allow pressed on ${first.ask}'s card sent no ask.answer: the app sent ${said((await r.see()).hub.map((c) => c.method))}`);
  const start = (await allowOnHub(w, first, sent!.params as Line)).ts;
  const fed = await feedSince(w, r, copy.last, (e) => e.kind === 'ask.answered' && e.subject === first.ask);
  return { w, a, r, first, ...(second ? { second } : {}), start, before, fed, ...(o.plant ? { plant: o.plant } : {}) };
}

export async function rowAndCardAt4(s: Answered): Promise<string[]> {
  const at = s.start + 4 * SECOND + 200;
  if (s.r.now > at) inconclusive(`the replica's clock was already ${((s.r.now - s.start) / 1000).toFixed(1)} s into the hold of ${s.first.ask} when it was to be read at 4 s`);
  await s.r.at(at);
  const seen = await s.r.see();
  const failures: string[] = [];
  const who = `${s.first.ask} (\`${s.first.step.command}\`)`;
  const row = rowNodes(seen, s.first.ask);
  if (!row.length) failures.push(`${who}: its row isn't in the list 4 s after it was allowed; the list holds ${said(listRows(seen))}`);
  else {
    if (!shows(row, STARTS_IN)) failures.push(`${who}: its row doesn't read "Starts in" 4 s after it was allowed; it reads ${quote(row)}`);
    if (!undoControls(row).length && !shows(row, UNDO)) failures.push(`${who}: its row shows no ${UNDO} 4 s after it was allowed; it reads ${quote(row)}`);
  }
  const shown = card(seen);
  if (seen.address !== askAddress(s.first)) failures.push(`${who}: its card isn't on the page 4 s after it was allowed; the page is ${String(seen.address)}`);
  else if (!shown.length) failures.push(`${who}: its page draws no card 4 s after it was allowed`);
  else {
    if (!shows(shown, STARTS_IN)) failures.push(`${who}: its card doesn't read "Starts in" 4 s after it was allowed; it reads ${quote(shown)}`);
    if (!undoControls(shown).length) failures.push(`${who}: its card shows no ${UNDO} control 4 s after it was allowed; it reads ${quote(shown)}`);
  }
  if (s.second && !rowNodes(seen, s.second.ask).length) failures.push(`${s.second.ask}, the second ask, isn't open in the list 4 s after ${s.first.ask} was allowed`);
  return failures;
}

export async function undoAt6(s: Answered): Promise<string[]> {
  const failures: string[] = [];
  const who = `${s.first.ask} (\`${s.first.step.command}\`)`;
  const elsewhere = s.second ? askAddress(s.second) : 'project/shop';
  await s.r.at(s.start + 6 * SECOND);
  if ((await clock(s.w)) >= s.start + 9 * SECOND) inconclusive(`the hub's clock was past 9 s into the hold of ${who} before ⌘Z could be pressed at 6 s`);
  await s.r.open(elsewhere);
  const sentBefore = (await s.r.see()).hub.length;
  await s.r.press('cmd-z');
  const after = (await s.r.see()).hub.slice(sentBefore);
  const undo = after.find((c) => c.method === 'ask.undo' && (c.params as Line)?.ask === s.first.ask);
  if (!undo) failures.push(`${who}: ⌘Z at 6 s on ${elsewhere} made no ask.undo call for ${s.first.ask}, the missing call; the app sent ${said(after.map((c) => c.method))}`);
  else {
    const reply = await asApp(s.w, 'ask.undo', undo.params as Line);
    if (reply.error) failures.push(`${who}: the hub refused the ask.undo ⌘Z sent at 6 s: ${said(reply.error)}`);
    else if ((await clock(s.w)) >= s.start + HOLD_MS) inconclusive(`the ask.undo of ${who}, sent at 6 s, reached the hub only after 10 s on its clock`);
  }
  s.fed = await feedSince(s.w, s.r, s.fed);
  await s.r.at(s.start + 7 * SECOND);
  const seen = await s.r.see();
  const place = s.before.indexOf(s.first.ask);
  const now = listRows(seen).indexOf(s.first.ask);
  if (now < 0) failures.push(`${who}: after ⌘Z at 6 s its row isn't in the list; the list holds ${said(listRows(seen))}`);
  else if (now !== place) failures.push(`${who}: after ⌘Z at 6 s it is row ${now} of the list, not in its place, row ${place}`);
  else if (shows(rowNodes(seen, s.first.ask), STARTS_IN)) failures.push(`${who}: after ⌘Z at 6 s its row still reads the receipt: ${quote(rowNodes(seen, s.first.ask))}`);
  const open = await notOpenAgain(s.w, s.first.ask);
  if (open) failures.push(`${who} isn't open again after ⌘Z at 6 s: ${open}`);
  await stepTo(s.w, s.start + 12 * SECOND);
  await attempt(s.w, s.a, PUSH);
  await settleTries(s.w, 20 * SECOND);
  for (const t of ranTries(s.w, PUSH)) failures.push(`${who} ran ${((t.at - s.start) / 1000).toFixed(1)} s after its yes, though ⌘Z at 6 s undid it`);
  if (!ranTries(s.w, PUSH).length && await remoteHas(s.w, 'main')) failures.push(`${who}: a git process pushed main to origin though ⌘Z at 6 s undid it`);
  return failures;
}

export const UNDO_WINDOW_READS = [200, 2200, 4200, 6200, 8200, 9400];
export async function lastReceiptStays(s: Answered): Promise<string[]> {
  const failures: string[] = [];
  const who = `${s.first.ask} (\`${s.first.step.command}\`)`;
  let read = 0;
  for (const ms of UNDO_WINDOW_READS) {
    if (s.r.now > s.start + ms) continue;
    read++;
    await s.r.at(s.start + ms);
    const seen = await s.r.see();
    const at = `${(ms / 1000).toFixed(1)} s after the only open ask ${who} was answered`;
    if (seen.address !== askAddress(s.first)) { failures.push(`${at}, the page jumped to ${String(seen.address)} while its Undo was live`); continue; }
    const shown = card(seen).length ? card(seen) : pageNodes(seen);
    if (!shows(shown, STARTS_IN)) failures.push(`${at}, its page doesn't keep the receipt: it reads ${quote(shown)}`);
    if (!undoControls(shown).length) failures.push(`${at}, its page shows no ${UNDO} control: it reads ${quote(shown)}`);
  }
  if (failures.length === 0 && read < UNDO_WINDOW_READS.length - 1) inconclusive(`the replica's clock was already ${((s.r.now - s.start) / 1000).toFixed(1)} s into the Undo window of ${who} when it was first read, so only ${read} of its ${UNDO_WINDOW_READS.length} reads were taken`);
  return failures;
}

export async function finish(s: Answered | undefined): Promise<void> {
  if (!s) return;
  await s.r.stop();
  await stopHub(s.w.hub).catch(() => undefined);
}

export const OPEN_ASK = 'ask:01KB1807AK0000000000000001';
export const SETTLED: Record<'defaulted' | 'rule' | 'decision', { ask: string; question: string }> = {
  defaulted: { ask: 'ask:01KB1807AK0000000000000002', question: 'Which header colour for the cart page?' },
  rule: { ask: 'ask:01KB1807AK0000000000000005', question: 'How should the search fix pull request merge?' },
  decision: { ask: 'ask:01KB1807AK0000000000000004', question: 'Which test runner for the search worker?' },
};
export const ANSWERED_BY_YOU = ['ask:01KB1807AK0000000000000003', 'ask:01KB1807AK0000000000000006'];

export const needsYouCount = (s: Seen): number | undefined => {
  const heading = byId(s, 'heading:needs-you');
  const m = /\d+/.exec(String(heading?.value ?? ''));
  return m ? Number(m[0]) : undefined;
};

export async function decidedPage(r: Replica, how: 'menu' | 'commands'): Promise<{ seen: Seen; failure?: string }> {
  if (how === 'menu') {
    const view = (await r.see()).menus.find((m) => m.title === 'View');
    const item = view?.items.find((i) => i.title === DECIDED);
    if (!item) return { seen: await r.see(), failure: `the View menu holds no ${DECIDED} item: it holds ${said(view?.items.map((i) => i.title) ?? [])}` };
    await r.menu(['View', DECIDED]);
  } else {
    await r.press('cmd-k');
    await r.type(DECIDED);
    const listed = await r.see();
    const hits = byId(listed, 'command-list');
    const names = hits ? flat(hits).filter((n) => n.role === 'list_box_option').map((n) => clean(n.name ?? '')) : [];
    if (!names.includes(DECIDED)) return { seen: listed, failure: `⌘K finds no ${DECIDED} for "${DECIDED}": it lists ${said(names)}` };
    await r.press('enter');
  }
  const seen = await r.see();
  const title = byId(seen, 'page-title');
  if (!clean(title?.name ?? '').includes(DECIDED)) return { seen, failure: `${how === 'menu' ? 'View › Decided' : '⌘K, Decided, Return'} doesn't open the ${DECIDED} page: the page is ${String(seen.address)}, titled "${title?.name ?? ''}"` };
  return { seen };
}

export async function settledJudge(plant?: string): Promise<string[]> {
  const r = await Replica.on(DECIDED_RECORD, plant ? { plant } : {});
  const failures: string[] = [];
  try {
    await r.at(NOW + SECOND);
    const home = await r.see();
    const count = needsYouCount(home);
    if (count !== 1) failures.push(`Needs you's count reads ${String(count)}, though one ask is open (${OPEN_ASK}); the count holds what was settled`);
    const rows = listRows(home);
    for (const [what, s] of Object.entries(SETTLED)) if (rows.includes(s.ask)) failures.push(`the ${what} ask ${s.ask} has a row under Needs you; the count reads ${String(count)}`);
    for (const ask of ANSWERED_BY_YOU) if (rows.includes(ask)) failures.push(`the ask you answered, ${ask}, has a row under Needs you; the count reads ${String(count)}`);
    const opened = await decidedPage(r, 'menu');
    if (opened.failure) failures.push(opened.failure);
    else {
      const page = pageNodes(opened.seen);
      for (const [what, s] of Object.entries(SETTLED)) if (!shows(page, s.question)) failures.push(`the ${what} ask ${s.ask} ("${s.question}") isn't on the ${DECIDED} page: it reads ${quote(page)}`);
    }
  } finally {
    await r.stop();
  }
  return failures;
}

export async function decidedDoorsJudge(plant?: string): Promise<string[]> {
  const r = await Replica.on(DECIDED_RECORD, plant ? { plant } : {});
  const failures: string[] = [];
  try {
    await r.at(NOW + SECOND);
    const home = await r.see();
    const list = listOf(home);
    if (!list) blocked(`the window draws no list (no node "list"): ${quote(home.nodes)}`);
    for (const n of flat(list!)) {
      const named = `${String(n.id ?? '')} ${n.name ?? ''} ${typeof n.value === 'string' ? n.value : ''}`;
      if (/decided/i.test(named)) failures.push(`the list holds a ${DECIDED} row: ${n.role} ${String(n.id ?? '')} "${n.name ?? ''}"`);
    }
    for (const how of ['menu', 'commands'] as const) {
      await r.open('project/shop');
      const opened = await decidedPage(r, how);
      if (opened.failure) failures.push(opened.failure);
    }
  } finally {
    await r.stop();
  }
  return failures;
}

export const screensDir = (): string => {
  const dir = process.env.DA1807_SCREENS ?? join(tempDir(), 'screens');
  mkdirSync(dir, { recursive: true });
  return dir;
};
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
