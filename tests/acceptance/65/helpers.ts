// What every #65 test shares (README, The worlds): a real hub (`deep hub run`) in a temp home under /tmp/dh16-*, the
// channel plug-ins installed with `deep install` as you install any package (the OS confirmation stubbed, #34's seam),
// the providers they reach as stand-ins on 127.0.0.1 (fixtures/providers.ts), asks put in the record through the real
// asks core before the hub starts, and an agent paseo runs, as paseo's plugin speaks for it to the hub (#55's hook
// lines and its bound `deep mcp`). The hub's own helpers come from tests/acceptance/16 and the confirmation's stand-in,
// the app's device and its signature from tests/acceptance/34 (same repo, same license). Nothing here stands in for
// DeepBuild's code. Every process this suite starts is stopped by PID; the real ~/.deepbuild is never touched.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'vitest';
import { askSources, openAsks, type PlanInput } from '../../../packages/asks/src/index.ts';
import { packageDigest } from '../../../packages/extension-host/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { childEnv, cleanup as cleanup16, CLI, deep, makeHome, NODE, own, REPO, sleep, startHub, tempDir, tokenOf, ulid, type Hub, type Line } from '../16/helpers.ts';
import { Confirmer, hubIdOf, newDevice, signed, type Device } from '../34/helpers.ts';
import { Phone, Provider, type Item, type Kind } from './fixtures/providers.ts';

export { sleep, type Line };
export const CHANNELS = join(REPO, 'packages/channels');
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** Each criterion's tag: `#65.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC = {
  1: 'AC1 #65.82812f3b', 2: 'AC2 #65.c0406413', 3: 'AC3 #65.19700b29', 4: 'AC4 #65.7430b5d9', 5: 'AC5 #65.bd21c26c', 6: 'AC6 #65.fc037c24',
  7: 'AC7 #65.0a1ebdd7', 8: 'AC8 #65.2fec5389', 9: 'AC9 #65.a9fef351', 10: 'AC10 #65.05709fd8', 11: 'AC11 #65.af4419b9', 12: 'AC12 #65.b9ca998f',
  13: 'AC13 #65.fbb68832', 14: 'AC14 #65.08d3ff31', 15: 'AC15 #65.fdfea15b', 16: 'AC16 #65.84e09e8f',
} as const;
/** The words a view-only card carries (the issue's Scope and AC14). */
export const WHERE = 'answer in the app or on your paired phone';
/** The chat account that is yours, linked on the trusted path (channel.link). */
export const YOU = 'U-you';
export const SECOND = 1000;
export const MINUTE = 60_000;

// ---- Waiting, and timings that can't be trusted under load (README, Timing).
export const loaded = (): boolean => loadavg()[0]! > availableParallelism();
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;
export async function waitFor<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, ms: number, what: string, every = 100): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = await probe();
    if (got) return got;
    if (Date.now() > end) throw Error(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(every);
  }
}
/** The first value `probe` gives within `ms`, or undefined: for "nothing happens" checks. */
export const within = <T>(ms: number, probe: () => Promise<T | undefined | false | null> | T | undefined | false | null): Promise<T | undefined> => waitFor(probe, ms, '').catch(() => undefined);
/**
 * A step the criterion bounds at `limitMs`: it must happen within a minute at all, or it FAILs; it must happen
 * within the limit, or it FAILs, unless the machine is loaded past its cores, which reads INCONCLUSIVE.
 */
export async function inTime<T>(ctx: TestContext, what: string, since: number, limitMs: number, probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, why: () => Promise<string> | string = () => ''): Promise<T> {
  const got = await waitFor(probe, Math.max(MINUTE, limitMs * 3), what).catch(async (e: Error) => { throw Error(`${e.message}: ${await why()}`); });
  const took = Date.now() - since;
  if (took > limitMs) {
    if (loaded()) ctx.skip(`INCONCLUSIVE: ${what} took ${took} ms, past ${limitMs} ms, with the machine loaded (${loadReading()})`);
    throw Error(`${what} took ${took} ms, past ${limitMs} ms (${loadReading()})`);
  }
  return got;
}

// ---- The hub's socket: one call per connection, as `deep` makes it.
export function rpc(w: { hub: Hub }, method: string, params: Line = {}, role: 'cli' | 'app' = 'cli', timeoutMs = 60_000): Promise<Line> {
  const token = tokenOf(w.hub.root);
  return new Promise((resolve, reject) => {
    const sock = net.connect(w.hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8').on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line: Line | undefined;
        try { line = JSON.parse(buffer.slice(0, i)) as Line; } catch { line = undefined; }
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: role, token })}\n`); }
        else if (step === 1 && line?.role !== undefined) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (step === 2 && line?.id === 1) { clearTimeout(timer); sock.destroy(); resolve(line); }
      }
    });
  });
}
/** A method's result; a refusal throws, naming the method and the surface it belongs to. */
export async function ok(w: { hub: Hub }, method: string, params: Line = {}, role: 'cli' | 'app' = 'cli'): Promise<Line> {
  const reply = await rpc(w, method, params, role);
  if (reply.error) throw Error(`${method} was refused: ${JSON.stringify(reply.error)} (README, The surface (my choice))`);
  return reply.result as Line;
}
export interface Ev { id: string; kind: string; log_pos: number; ts: number; writer?: string; subject?: string; session?: string; data: Line }
export async function events(w: { hub: Hub }): Promise<Ev[]> {
  const out: Ev[] = [];
  for (let after = 0; ;) {
    const page = (await ok(w, 'events.read', { after, limit: 1000 })).events as Ev[];
    if (!page.length) return out;
    out.push(...page);
    after = page.at(-1)!.log_pos;
  }
}
export const ofKind = async (w: { hub: Hub }, kind: string, subject?: string): Promise<Ev[]> => (await events(w)).filter((e) => e.kind === kind && (subject === undefined || e.subject === subject));
export const inboxRow = async (w: { hub: Hub }, ask: string): Promise<Line | undefined> => ((await ok(w, 'inbox.read')).asks as Line[]).find((r) => r.ask === ask);
/** Whether an ask is still open in Needs you: its row unanswered and not closed. */
export const openInNeedsYou = (row: Line | undefined): boolean => Boolean(row && row.status !== 'closed' && row.outcome === 'unanswered');
/** The hub's refusals of channel answers on a thread (README, The surface: channel.refused). */
export const refusalsOf = (w: { hub: Hub }, thread: string): Promise<Ev[]> => ofKind(w, 'channel.refused', thread);
export const said = (evs: readonly Ev[]): string => evs.map((e) => `${e.kind}@${e.log_pos} ${JSON.stringify(e.data).slice(0, 300)}`).join('; ') || 'none';

// ---- Asks in the record before the hub starts, through the real asks core (as tests/acceptance/34 seeds them).
export interface SeedAsk { source: 'effect.push' | 'deep_ask.choice' | 'deep_ask.taste' | 'deep_ask.unblock'; question: string; options?: { id: string; label: string }[]; plan?: PlanInput }
async function seed(root: string, asks: readonly SeedAsk[], now: () => number): Promise<string[]> {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const record = await openRecord({ path: join(root, 'ledger.db'), now });
  const core = await openAsks({ record, now, deliver: () => undefined });
  const handles: string[] = [];
  for (const a of asks) {
    const row = askSources().find((r) => r.source === a.source);
    if (!row) throw Error(`BLOCKED: ask.sources@1 has no row ${a.source}`);
    const fixture = row.fixture.ask as Line;
    const options = a.options?.map((o) => ({ ...o, decision: 'none' })) ?? fixture.options;
    const ask: Line = {
      ...fixture, question: a.question, options, key: sha256(`#65 ${a.question}`), deadline: now() + 86_400_000,
      ...(fixture.recommended !== null && a.options ? { recommended: a.options[0]!.id, default: a.options[0]!.id } : {}),
      pinned_to: { ...(fixture.pinned_to as Line), ref: (fixture.pinned_to as Line).kind === 'commit' ? sha256(a.question).slice(0, 40) : sha256(a.question) },
    };
    const plan = a.plan ?? (row.kind === 'authority' ? { steps: [{ does: a.question, changes: [a.source], undo: 'Revert it', public: true, cost: 0 }], diff: sha256(a.question) } : undefined);
    handles.push(await core.raise({ writer: 'core', actor: 'you', scope: 'you' }, a.source, ask, plan));
  }
  await record.close();
  return handles;
}
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

// ---- A world: a hub, its channels and their providers (README, The worlds).
export interface Route { kinds: string[]; to: string[]; urgent?: boolean; next?: string[]; unseen?: string }
export interface WorldOptions {
  channels: Kind[];
  /** Default: every kind of ask to every channel of the world. */
  routes?: Route[];
  quiet?: { from: string; to: string };
  seed?: SeedAsk[];
  /** The hub's clock starts here (ms since the epoch) and steps with test.clock. */
  clock?: number;
  /** Link your chat account (YOU) before the channels load. */
  link?: boolean;
  /** Pair the test phone, and the app's device, before the channels load. */
  phone?: boolean;
  app?: boolean;
  /** What the test sets on the providers once the hub runs and before the channels load. */
  beforeInstall?: (w: World) => void;
  /** Another channel's settings entry, for a planted channel installed by the test. */
  extra?: Record<string, Line>;
}
export interface World { home: string; root: string; hub: Hub; asks: string[]; providers: Partial<Record<Kind, Provider>>; phone: Phone; app: Device; confirmer: Confirmer; repo: string }
const worlds: World[] = [];
const ASK_SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
export const TOKEN = `bot-${randomBytes(9).toString('hex')}`;
/** The channel plug-ins this suite installs, by the name each registers (README, The surface: the channel plug-ins). */
export function needChannels(names: readonly string[]): void {
  for (const name of names) {
    if (!existsSync(join(CHANNELS, name, 'deepbuild.json'))) throw Error(`the ${name} channel plug-in is missing: no packages/channels/${name}/deepbuild.json (README, The surface (my choice))`);
  }
}
export async function world(o: WorldOptions): Promise<World> {
  needChannels(o.channels);
  const home = makeHome();
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const repo = specRepo(home);
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: ASK_SETTINGS }, null, 2)}\n`);
  const providers: Partial<Record<Kind, Provider>> = {};
  const settings: Record<string, Line> = { ...(o.extra ?? {}) };
  for (const kind of o.channels) {
    const p = await Provider.start(kind, kind === 'chat' ? TOKEN : undefined);
    providers[kind] = p;
    settings[kind] = { api: p.api, ...(kind === 'chat' ? { token: TOKEN } : {}), ...(kind === 'email' ? { to: 'you@example.invalid' } : {}), ...(kind === 'text' ? { to: '+15555550100' } : {}) };
  }
  const routes = o.routes ?? [{ kinds: ['authority', 'unblock', 'choice', 'taste', 'exception', 'definition'], to: [...o.channels, ...Object.keys(o.extra ?? {})] }];
  writeFileSync(join(root, 'channels.json'), `${JSON.stringify({ channels: settings, routes, quiet: o.quiet ?? null }, null, 2)}\n`, { mode: 0o600 });
  const start = Date.now();
  const now = o.clock === undefined ? () => Date.now() : () => o.clock! + (Date.now() - start);
  const asks = await seed(root, o.seed ?? [], now);
  const confirmer = new Confirmer();
  confirmer.say(true);
  // A wrong program you try by hand: DEEP_HUB_PLANT=<name> (README, Wrong programs).
  const plant = process.env.DEEP_HUB_PLANT;
  const hub = await startHub({
    home, ...(plant ? { plant } : {}), ...(o.clock === undefined ? {} : { clock: now() }),
    env: { DEEP_HUB_TEST_CONFIRM: confirmer.path, TZ: 'UTC', ...(o.clock === undefined ? {} : { DEEP_HUB_TEST_CLOCK_STEPS: '1' }) },
  }, 120_000);
  const w: World = { home, root, hub, asks, providers, phone: new Phone(), app: newDevice('DeepBuild app'), confirmer, repo };
  worlds.push(w);
  if (o.link) await ok(w, 'channel.link', { channel: 'chat', account: YOU });
  if (o.phone) w.phone.device = String((await ok(w, 'device.pair', { name: w.phone.name, public_key: w.phone.publicKey })).device);
  if (o.app) w.app.id = String((await ok(w, 'device.pair', { name: w.app.name, public_key: w.app.publicKey })).device);
  w.app.hub = hubIdOf(w.hub.root);   // what the app's signature is made for (#1579)
  o.beforeInstall?.(w);
  for (const kind of o.channels) await install(w, join(CHANNELS, kind));
  for (const kind of o.channels) {
    await waitFor(() => providers[kind]!.calls.length > 0, MINUTE, `the ${kind} channel's first call to its provider once installed (the hub calls receive() at least once a second)`);
  }
  return w;
}
/** `deep install <folder>`, as you run it; the channel plug-ins must install and load. */
export async function install(w: World, folder: string): Promise<void> {
  const r = await deep(w.home, ['install', folder], { timeoutMs: 300_000 });
  if (r.code !== 0) throw Error(`deep install ${folder} exited ${r.code}: ${r.stdout.slice(-1500)} ${r.stderr.slice(-1500)}`);
}
export async function cleanup(): Promise<void> {
  for (const w of worlds.splice(0)) for (const p of Object.values(w.providers)) await p!.stop().catch(() => undefined);
  await cleanup16();
}
/** Steps the hub's clock (test.clock, served under DEEP_HUB_TEST_CLOCK_STEPS=1). */
export const advance = (w: World, ms: number): Promise<Line> => ok(w, 'test.clock', { advance_ms: ms });

// ---- The app's answer: ask.answer on an app connection, signed by the app's paired device (#34).
export const appAnswer = (w: World, ask: string, option: string): Promise<Line> => rpc(w, 'ask.answer', signed({ ask, option }, w.app), 'app');

// ---- A planted channel package (fixtures/planted-channel), installable: its *.fixture files renamed, its digest set.
export function plantedPackage(name: string): string {
  const dir = join(tempDir(), name);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  for (const entry of readdirSync(dir)) if (entry.endsWith('.fixture')) renameSync(join(dir, entry), join(dir, entry.slice(0, -'.fixture'.length)));
  const file = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as Line;
  manifest.digest = packageDigest(dir);
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

// ---- The repo an agent works in: its spec names one check, task-done, which passes once done.txt exists.
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Acceptance 65', GIT_AUTHOR_EMAIL: 'acceptance-65@example.invalid', GIT_COMMITTER_NAME: 'Acceptance 65', GIT_COMMITTER_EMAIL: 'acceptance-65@example.invalid', GIT_TERMINAL_PROMPT: '0' };
function git(dir: string, args: readonly string[]): void {
  const { status } = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, ...GIT_ENV } });
  if (status !== 0) throw Error(`BLOCKED: git ${args.join(' ')} failed in ${dir}`);
}
export const CHECK = 'task-done';
function specRepo(home: string): string {
  const dir = join(home, '..', 'repo');
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), [
    'claims:', '  done:', `    checks: [${CHECK}]`,
    'checks:', `  ${CHECK}: { type: command, run: "node --test .deepbuild/checks/${CHECK}.test.mjs" }`,
    'asks:',
    '  deadline: { taste: 3d, authority: 1d, unblock: 2d, exception: 2d, choice: 2d, definition: 4h }',
    '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
    '  fallback: [change-owner]', '',
  ].join('\n'));
  mkdirSync(join(dir, '.deepbuild', 'checks'), { recursive: true });
  writeFileSync(join(dir, '.deepbuild', 'checks', `${CHECK}.test.mjs`), "import { test } from 'node:test';\nimport { readFileSync } from 'node:fs';\ntest('done.txt is there', () => { readFileSync('done.txt'); });\n");
  writeFileSync(join(dir, 'README.md'), 'A repo for #65\'s tests.\n');
  git(dir, ['init', '-q']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'the spec and its check']);
  // Claude Code's workspace trust, which the hub reads as project trust.
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ projects: { [dir]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  return dir;
}

// ---- An agent paseo runs, as paseo's plugin speaks for it (#55): hook lines with agent 'paseo', and its deep mcp
// bound by the token those lines carry.
export interface PaseoAgent { session: string; bind: string; id: string; cwd: string; provider: string }
export const paseoAgent = (cwd: string): PaseoAgent => ({ session: randomUUID(), bind: randomBytes(18).toString('base64url'), id: randomUUID(), cwd, provider: 'copilot' });
export interface Held { acked: Promise<boolean>; reply: Promise<Line | undefined>; close(): void }
/** One hook line on its own connection, held open as the plugin holds it: its acknowledgement, then its reply. */
export function paseoHook(w: World, a: PaseoAgent, event: string, fields: Line = {}): Held {
  const sock = net.connect(w.hub.socket);
  let buffer = '';
  let greeted = false;
  let acked!: (v: boolean) => void;
  let replied!: (v: Line | undefined) => void;
  const ack = new Promise<boolean>((done) => { acked = done; });
  const reply = new Promise<Line | undefined>((done) => { replied = done; });
  const end = () => { acked(false); replied(undefined); };
  sock.on('error', end).on('close', end);
  sock.setEncoding('utf8').on('data', (chunk: string) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      let line: Line | undefined;
      try { line = JSON.parse(buffer.slice(0, i)) as Line; } catch { line = undefined; }
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      if (!greeted) {
        greeted = true;
        const payload = { hook_event_name: event, session_id: a.session, cwd: a.cwd, provider: a.provider, paseo_agent: a.id, bind: a.bind, ...fields };
        sock.write(`${JSON.stringify({ v: 1, agent: 'paseo', event, seq: (BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1e6))).toString(), id: ulid(), pid: process.pid, ppid: process.pid, matched: [], payload })}\n`);
      } else if ('ack' in line) acked(true);
      else if ('exit' in line) { replied(line); sock.destroy(); }
    }
  });
  return { acked: ack, reply, close: () => sock.destroy() };
}
/** The agent's turn starts: the hub learns its session and the token its deep mcp is bound by. */
export async function turnStarts(w: World, a: PaseoAgent): Promise<void> {
  const h = paseoHook(w, a, 'agent.turn.before', { turn_id: `t-${randomUUID().slice(0, 8)}` });
  if (!(await h.acked)) throw Error('BLOCKED: the hub didn\'t acknowledge the paseo agent\'s turn');
  h.close();
}
/** A permission request of the agent, held by the hub until you answer it: an authority ask (#55). */
export async function permission(w: World, a: PaseoAgent, command: string): Promise<{ ask: string; held: Held }> {
  const before = (await events(w)).at(-1)?.log_pos ?? 0;
  const held = paseoHook(w, a, 'agent.permission.before', { request_id: `perm_${randomUUID().slice(0, 8)}`, permission_kind: 'tool', tool_name: 'Bash', tool_input: { command }, title: `Run ${command}` });
  if (!(await held.acked)) throw Error(`BLOCKED: the hub didn't acknowledge the permission request for ${command}`);
  const ask = await waitFor(async () => (await events(w)).find((e) => e.kind === 'ask.created' && e.log_pos > before && JSON.stringify(e.data).includes(command)), 30_000, `the authority ask the ${command} request opened`)
    .catch((e: Error) => { throw Error(`BLOCKED: ${e.message}`); });
  return { ask: `ask:${ask.id}`, held };
}

/** The agent's deep mcp, as paseo starts it with the plugin's token in its environment. */
export class Mcp {
  private buffer = '';
  private readonly replies = new Map<number, Line>();
  private ids = 0;
  private constructor(readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        try { const l = JSON.parse(this.buffer.slice(0, i)) as Line; if (typeof l.id === 'number') this.replies.set(l.id, l); } catch { /* not a reply */ }
        this.buffer = this.buffer.slice(i + 1);
      }
    });
  }
  static async start(w: World, a: PaseoAgent): Promise<Mcp> {
    const child = spawn(NODE, [CLI, 'mcp'], { cwd: a.cwd, env: childEnv(w.home, { DEEP_PASEO_BIND: a.bind }), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    const mcp = new Mcp(child);
    const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dh65-agent', version: '0' } });
    if (!init.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(init)}`);
    child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    return mcp;
  }
  async request(method: string, params: Line, ms = 600_000): Promise<Line> {
    const id = ++this.ids;
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return waitFor(() => this.replies.get(id), ms, `deep mcp's reply to ${method}`, 50);
  }
  /** A tool's value: its structuredContent, else the JSON or text of its first block. */
  async call(name: string, args: Line, ms?: number): Promise<Line> {
    const reply = await this.request('tools/call', { name, arguments: args }, ms);
    if (reply.result?.structuredContent) return reply.result.structuredContent as Line;
    const text = String(reply.result?.content?.[0]?.text ?? JSON.stringify(reply));
    try { return JSON.parse(text) as Line; } catch { return { text }; }
  }
}

// ---- What a channel carried, as the record holds it (README, The surface: channel.delivered).
export const deliveriesOf = async (w: World, channel?: string): Promise<Ev[]> => (await ofKind(w, 'channel.delivered')).filter((e) => channel === undefined || e.data.channel === channel);
/** The answerable card a provider shows for a thread: it has answer buttons. */
export const live = (item: Item | undefined): boolean => Boolean(item && item.answerable === 'answer' && item.options.length > 0);
export const closed = (item: Item | undefined): boolean => Boolean(item && item.answerable === 'closed' && item.options.length === 0);
export const describeItem = (item: Item | undefined): string => (item ? `${item.answerable}, ${item.options.length} buttons, "${item.summary.slice(0, 160)}"` : 'no card');
