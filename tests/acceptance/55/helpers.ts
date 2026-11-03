// What every #55 test shares (README, The worlds): scratch homes under /tmp/dh55-*, the real hub read through its
// socket, the paseo plugin under test loaded either into a real paseo daemon (pinned, from DEEP_PASEO_CLI) or into
// fixtures/paseo-host.mjs, the stand-in for the daemon around a plugin, and the agents paseo runs as fakes. The Claude
// Code stand-in and its home come from tests/acceptance/27 and 29, real pi from tests/acceptance/40 (same repo, same
// license): this suite imports them so it plays those agents as their own suites do. Nothing here stands in for
// DeepBuild's code. Processes are stopped by PID (and the process groups this suite started), never by name or port,
// and the real ~/.deepbuild, ~/.paseo, ~/.claude and ~/.pi are never touched.
// First: what you gave the suite by hand, before ../29's helpers delete it (README, Disputes D1).
import { given, restore } from './env.ts';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttp, type Server as HttpServer } from 'node:http';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { childEnv, cleanup as cleanup27, COVERED, FIXTURES as FIXTURES27, NODE, own, run, type Ran } from '../27/helpers.ts';
import { cleanup as cleanup29 } from '../29/h-d.ts';
import { cleanup as cleanup40 } from '../40/helpers.ts';

// ../29's helpers have loaded and emptied process.env of DEEP_*: the helpers that read it when called get yours back.
restore();

export type Line = { [key: string]: any };
export const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const PLUGIN = join(REPO, 'packages/paseo');
export const ENTRY = join(PLUGIN, 'index.server.ts');
export const FACTS = join(REPO, 'adapters/paseo.facts.json');
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const HOST = join(FIXTURES, 'paseo-host.mjs');
export const FAKE_PROVIDER = join(FIXTURES, 'fake-provider');
export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Each criterion's tag: `#55.` and the first 8 hex of SHA-256 of its text (tests/acceptance/48/README.md). */
export const AC = {
  1: 'AC1 #55.600b9b2a', 2: 'AC2 #55.44e1fa39', 3: 'AC3 #55.326e394f', 4: 'AC4 #55.e582614a', 5: 'AC5 #55.1e08fb6f',
  6: 'AC6 #55.e7e53540', 7: 'AC7 #55.9cef546e', 8: 'AC8 #55.6be2ad60', 9: 'AC9 #55.e30f079d', 10: 'AC10 #55.dae4bb29',
  11: 'AC11 #55.b7bb3861', 12: 'AC12 #55.da36aa35', 13: 'AC13 #55.480a0e0c', 14: 'AC14 #55.9d31eef3',
} as const;

export function needPlugin(): void {
  if (!existsSync(ENTRY)) throw Error(`the paseo plugin is missing: no ${ENTRY} (README, The surface)`);
}
export function readFacts(): Line {
  if (!existsSync(FACTS)) throw Error(`paseo's facts are missing: no ${FACTS} (README, The surface)`);
  return JSON.parse(readFileSync(FACTS, 'utf8')) as Line;
}
/** The paseo version the facts pin: the newest they cover. */
export const pinnedPaseo = (): string => String((readFacts().versions as string[]).at(-1));

export async function waitFor<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, timeoutMs: number, what: string, everyMs = 200): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const got = await probe();
    if (got) return got;
    if (Date.now() > end) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(everyMs);
  }
}
/** The first value `probe` gives within `ms`, or undefined: for "nothing happens" checks. */
export async function within<T>(ms: number, probe: () => Promise<T | undefined | false | null> | T | undefined | false | null): Promise<T | undefined> {
  return waitFor(probe, ms, '').catch(() => undefined);
}

// ---- Folders and processes this suite made.
const made: string[] = [];
const groups = new Set<number>();
/** Short real paths: a Unix socket path fits in 104 bytes. */
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh55-'));
  made.push(dir);
  return dir;
}
const hosts = new Set<Host>();
const servers: HttpServer[] = [];
export async function cleanup(): Promise<void> {
  for (const h of [...hosts]) await h.stop().catch(() => undefined);
  for (const s of servers.splice(0)) await new Promise((done) => s.close(done));
  for (const g of groups) try { process.kill(-g, 'SIGTERM'); } catch { /* gone */ }
  await sleep(groups.size ? 1500 : 0);
  for (const g of groups) try { process.kill(-g, 'SIGKILL'); } catch { /* gone */ }
  groups.clear();
  await cleanup27();
  await cleanup29();
  await cleanup40();
  for (const dir of made.splice(0)) {
    execFileSync('chmod', ['-R', 'u+rwX', dir]);
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A home as #27's tests make one, under /tmp/dh55-*: `<tmp>/h` is HOME for every process, `<tmp>/bin` first on PATH
 * with #27's stand-ins for launchctl, systemctl and claude, a `deep` that runs the built CLI, and, with DEEP_PASEO_CLI
 * set, a `paseo` that runs it; `<tmp>/confirm` says confirmed (DEEP_HUB_TEST_CONFIRM, #24's stub for the OS).
 */
export interface Home { tmp: string; home: string; bin: string }
export function makeHome(o: { paseo?: boolean } = {}): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(bin);
  for (const name of ['launchctl', 'systemctl', 'claude']) {
    copyFileSync(join(FIXTURES27, 'stub-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'claude.version'), `${COVERED}\n`);
  writeFileSync(join(bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`);
  chmodSync(join(bin, 'deep'), 0o755);
  if (o.paseo) {
    writeFileSync(join(bin, 'paseo'), `#!/bin/sh\nexec '${paseoCli()}' "$@"\n`);
    chmodSync(join(bin, 'paseo'), 0o755);
  }
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  return { tmp, home, bin };
}
/** Your ask settings, as `deep setup` drafts them (tests/acceptance/29): every kind has a deadline and a default, no batch. */
export const ASK_SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
export function editConfig(home: string, edit: (config: Line) => void): void {
  const file = join(home, '.deepbuild', 'config.json');
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Line : {};
  edit(config);
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}
/** Claude Code's workspace trust for a folder, which the hub reads as project trust (design: spec-draft's row). */
export function trust(home: string, dir: string): void {
  const file = join(home, '.claude.json');
  const user = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Line : {};
  user.projects = { ...(user.projects ?? {}), [dir]: { ...(user.projects?.[dir] ?? {}), hasTrustDialogAccepted: true } };
  writeFileSync(file, `${JSON.stringify(user, null, 2)}\n`);
}

const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Acceptance 55', GIT_AUTHOR_EMAIL: 'acceptance-55@example.invalid', GIT_COMMITTER_NAME: 'Acceptance 55', GIT_COMMITTER_EMAIL: 'acceptance-55@example.invalid', GIT_TERMINAL_PROMPT: '0' };
export function git(dir: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, ...GIT_ENV }, encoding: 'utf8' }).trim();
}

// ---- The repo of the gate's tests (README, The fixture repo): a cart whose total must take the discount off, its
// spec naming one check, cart-discount, that fails on the base and on the false done.
export const CHECK = 'cart-discount';
export const CHECK_SAYS = 'cart-discount: expected 90 for 100 with 10% off';
export const CART = 'exports.total = (prices, off) => prices.reduce((a, b) => a + b, 0);\n';
/** The false done: a change to the cart that still ignores the discount. */
export const FALSE_DONE = 'exports.total = (prices, off) => prices.reduce((a, b) => a + b, 0) * 1; // takes the discount off\n';
export function specRepo(home: string): { dir: string; base: string } {
  const dir = join(dirname(home), 'repo');
  mkdirSync(join(dir, '.deepbuild', 'checks'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'cart.js'), CART);
  writeFileSync(join(dir, '.deepbuild', 'checks', `${CHECK}.sh`), `#!/bin/sh\nnode -e "const t = require('./src/cart.js').total([100], 0.1); if (t !== 90) { console.error('${CHECK_SAYS}, got ' + t); process.exit(1); }"\n`);
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), [
    'claims:', '  done:', `    checks: [${CHECK}]`,
    'checks:', `  ${CHECK}: { type: command, run: "sh .deepbuild/checks/${CHECK}.sh" }`,
    'asks:',
    '  deadline: { taste: 3d, authority: 1d, unblock: 2d, exception: 2d, choice: 2d, definition: 4h }',
    '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
    '  fallback: [change-owner]', '',
  ].join('\n'));
  git(dir, ['init', '-q']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'the cart and its check']);
  trust(home, dir);
  return { dir, base: git(dir, ['rev-parse', 'HEAD']) };
}
/** The agent's work: the false done written and committed, as an agent run through paseo does it in its folder. */
export function commitFalseDone(dir: string): string {
  writeFileSync(join(dir, 'src', 'cart.js'), FALSE_DONE);
  git(dir, ['commit', '-q', '-am', 'take the discount off']);
  return git(dir, ['rev-parse', 'HEAD']);
}

// ---- The hub's record and tables, read through its socket on a cli connection with the control token (#16).
function control(home: string, method: string, params: Line, timeoutMs = 30_000): Promise<Line> {
  const root = join(home, '.deepbuild');
  const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(join(root, 'hub.sock'));
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line: Line | undefined;
        try { line = JSON.parse(buffer.slice(0, i)) as Line; } catch { line = undefined; }
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`); }
        else if (step === 1 && line?.role !== undefined) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (step === 2 && line?.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          if (line.error) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`));
          else resolve(line.result as Line);
        }
      }
    });
  });
}
export interface Ev { id: string; kind: string; log_pos: number; ts: number; writer?: string; subject?: string; session?: string; data: Line; [key: string]: unknown }
export async function events(home: string): Promise<Ev[]> {
  const out: Ev[] = [];
  for (let after = 0; ;) {
    const read = await control(home, 'events.read', { after, limit: 1000 });
    const page = (typeof read.events === 'string' ? JSON.parse(read.events) : read.events) as Ev[];
    if (!page.length) return out;
    out.push(...page);
    after = page[page.length - 1]!.log_pos;
  }
}
export const inboxRows = async (home: string): Promise<Line[]> => (await control(home, 'inbox.read', {})).asks as Line[];
export const sessionRows = async (home: string): Promise<Line[]> => (await control(home, 'sessions.read', {})).sessions as Line[];
export const said = (e: Ev | undefined): string => (e ? `${e.kind}@${e.log_pos} session ${e.session ?? '-'} subject ${e.subject ?? '-'} ${JSON.stringify(e.data).slice(0, 500)}` : 'no event');
export const kinds = (evs: readonly Ev[]): string => evs.map((e) => e.kind).join(', ');
/** Whether an event is about a session: its session, or its text names the session's ID. */
export const about = (e: Ev, session: string): boolean => e.session === session || JSON.stringify(e).includes(session);
/** Your answer, given with `deep inbox answer` (#24, the OS confirmation stubbed). */
export async function answer(home: string, handle: string, option: string): Promise<Ran> {
  const r = await run(NODE, [CLI, 'inbox', 'answer', handle, option], { env: childEnv(home), timeoutMs: 60_000 });
  if (r.code !== 0) throw Error(`BLOCKED: deep inbox answer ${handle} ${option} must exit 0: exit ${r.code} ${r.stdout} ${r.stderr}`);
  return r;
}
/** The record's delivery outcomes for an ask, in log order. */
export const outcomesOf = (evs: readonly Ev[], ask: string): Ev[] => evs.filter((e) => e.kind === 'delivery.outcome' && (e.subject === ask || String(e.data?.delivery ?? '') === ask || `ask:${String(e.data?.delivery ?? '')}` === ask));
/** An ask whose question or subject names `text`. */
export const asksNaming = (evs: readonly Ev[], text: string): Ev[] => evs.filter((e) => e.kind === 'ask.created' && JSON.stringify(e.data ?? {}).includes(text));

// ---- Paseo, as the plugin sees it: agents, their snapshots and timelines (the shapes of @getpaseo/protocol 0.15.0).
export interface Permission { id: string; provider: string; name: string; kind: 'tool' | 'plan' | 'question' | 'mode' | 'other'; title?: string; description?: string; input?: Line; detail?: Line; actions?: Line[] }
export interface Fake { agent: Line; snapshot: Line; timeline: Line[]; session: string }
/** An agent paseo runs: its PluginHookAgent, and its snapshot with the agent's own session ID in runtimeInfo and persistence. */
export function fakeAgent(provider: string, cwd: string, session: string = randomUUID()): Fake {
  const id = randomUUID();
  const at = new Date().toISOString();
  const agent = { id, workspaceId: 'wks_dh55', parentAgentId: null, provider, cwd, title: null };
  const snapshot = {
    id, provider, cwd, workspaceId: 'wks_dh55', model: 'stand-in', thinkingOptionId: null, effectiveThinkingOptionId: null, createdAt: at, updatedAt: at, lastUserMessageAt: null,
    status: 'idle', activeTurn: null,
    capabilities: { supportsStreaming: true, supportsSessionPersistence: true, supportsSessionListing: false, supportsDynamicModes: false, supportsMcpServers: true, supportsNativePaseoTools: false, supportsReasoningStream: true, supportsToolInvocations: true, supportsRewindConversation: false, supportsRewindFiles: false, supportsRewindBoth: false },
    currentModeId: null, availableModes: [], features: [], pendingPermissions: [] as Permission[],
    persistence: { provider, sessionId: session, metadata: { cwd } },
    runtimeInfo: { provider, sessionId: session, model: 'stand-in', thinkingOptionId: null, modeId: null },
    title: null, labels: {}, requiresAttention: false, attentionReason: null, attentionTimestamp: null, archivedAt: null,
  };
  return { agent, snapshot, timeline: [], session };
}
export const permissionOf = (f: Fake, o: Partial<Permission> & { name: string; kind: Permission['kind'] }): Permission => ({ id: `perm_${randomUUID().slice(0, 8)}`, provider: String(f.agent.provider), ...o });

/** The plugin in fixtures/paseo-host.mjs: the test is paseo's daemon around it. */
export class Host {
  readonly lines: Line[] = [];
  hooks: string[] = [];
  private n = 0;
  private err = '';
  private constructor(readonly child: ChildProcess, readonly home: string) {
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      try { this.lines.push({ ...(JSON.parse(raw) as Line), seen: Date.now() }); } catch { /* not ours */ }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-8000); });
  }
  /** The plugin loaded, HOME the test's, with DEEP_PASEO_PLANT when a test names a wrong program. */
  static async start(home: string, o: { plant?: string } = {}): Promise<Host> {
    needPlugin();
    const child = spawn(NODE, [HOST, ENTRY], { cwd: dirname(home), env: childEnv(home, { DEEP_PASEO_PLANT: o.plant ?? given.DEEP_PASEO_PLANT }), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const host = new Host(child, home);
    hosts.add(host);
    const loaded = await host.send({ op: 'load' }, 60_000);
    host.hooks = loaded.hooks as string[];
    return host;
  }
  stderr(): string { return this.err; }
  async send(command: Line, timeoutMs = 60_000): Promise<Line> {
    const n = ++this.n;
    this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    const got = await waitFor(() => this.lines.find((l) => l.n === n), timeoutMs, `the paseo stand-in's answer to ${String(command.op)} ${String(command.name ?? '')}; its stderr: ${this.err.slice(-1500)}`, 20);
    if (got.error) throw Error(`the paseo stand-in failed ${String(command.op)} ${String(command.name ?? '')}: ${String(got.error)}; stderr: ${this.err.slice(-1500)}`);
    return got;
  }
  /** Paseo's view of an agent, pushed to the plugin's subscribers. */
  async show(f: Fake): Promise<void> { await this.send({ op: 'agent', agent: f.agent, snapshot: f.snapshot, timeline: f.timeline }); }
  /** Paseo fires a hook; a waiting hook's result comes back, a notification's `fire` ID to wait on. */
  fire(name: string, payload: Line): Promise<Line> { return this.send({ op: 'fire', name, payload }); }
  /** Waits until every handler of a notification has returned; their times and errors. */
  async settled(fired: Line, timeoutMs = 60_000): Promise<Line> {
    return waitFor(() => this.lines.find((l) => l.settled === fired.fire), timeoutMs, `the plugin's ${String(fired.name)} handlers to return`, 5);
  }
  /** A person answered a pending permission in paseo's own app. */
  async resolve(f: Fake, requestId: string, resolution: Line): Promise<void> {
    f.snapshot.pendingPermissions = (f.snapshot.pendingPermissions as Permission[]).filter((p) => p.id !== requestId);
    await this.send({ op: 'resolve', agentId: f.agent.id, requestId, resolution });
  }
  /** Every SDK call the plugin made on an agent, of one kind when given. */
  callsOf(f: Fake, call?: string): Line[] { return this.lines.filter((l) => l.agentId === f.agent.id && typeof l.call === 'string' && (!call || l.call === call)); }
  /** What the plugin did on its own to an agent: words sent, permissions answered, a reload (never a read). */
  actionsOn(f: Fake): Line[] { return this.lines.filter((l) => l.agentId === f.agent.id && ['send', 'respondToPermission', 'reload', 'run', 'archive'].includes(String(l.call))); }
  errors(): Line[] { return this.lines.filter((l) => (Array.isArray(l.errors) && l.errors.length) || l.unhandled); }
  async stop(): Promise<void> {
    if (!hosts.delete(this)) return;
    if (this.child.exitCode === null) {
      this.child.stdin!.write(`${JSON.stringify({ n: ++this.n, op: 'stop' })}\n`);
      await Promise.race([new Promise((done) => this.child.once('exit', done)), sleep(5000)]);
      if (this.child.exitCode === null) this.child.kill('SIGKILL');
    }
  }
}

/** Paseo creates and opens an agent: agent.create.before, agent.open.before, agent.create.after; the open's MCP servers. */
export async function create(host: Host, f: Fake): Promise<Record<string, Line>> {
  await host.show(f);
  await host.fire('agent.create.before', { request: { config: { provider: f.agent.provider, cwd: f.agent.cwd, model: 'stand-in' }, env: {} } });
  const opened = await host.fire('agent.open.before', {
    request: { agentId: f.agent.id, workspaceId: f.agent.workspaceId, provider: f.agent.provider, cwd: f.agent.cwd, reason: 'create', purpose: 'interactive', title: null, labels: {}, tools: [], env: {}, mcpServers: {} },
  });
  if (opened.errors?.length) throw Error(`agent.open.before failed in the plugin: ${opened.errors.join('; ')}`);
  await host.settled(await host.fire('agent.create.after', { agent: f.agent }));
  return (opened.result?.mcpServers ?? {}) as Record<string, Line>;
}
/** A turn starts with your prompt: the agent reads running, its timeline holds the prompt, paseo fires agent.turn.before. */
export async function turnStarts(host: Host, f: Fake, turnId: string, prompt: string): Promise<void> {
  f.snapshot.status = 'running';
  f.snapshot.activeTurn = { turnId, startedAt: new Date().toISOString() };
  f.snapshot.lastUserMessageAt = new Date().toISOString();
  f.timeline.push({ type: 'user_message', text: prompt, messageId: `u-${turnId}`, turnId });
  await host.show(f);
  await host.settled(await host.fire('agent.turn.before', { agent: f.agent, turnId }));
}
/** The agent's own tool call, as paseo's timeline shows it. */
export function toolCall(f: Fake, turnId: string, name: string, detail: Line): void {
  f.timeline.push({ type: 'tool_call', callId: `call_${randomUUID().slice(0, 8)}`, name, detail, status: 'completed', error: null, turnId });
}
/** The turn ends: its last words, the agent reads `status` (idle unless a test says otherwise), agent.turn.after fires. */
export async function turnEnds(host: Host, f: Fake, turnId: string, o: { words?: string; status?: string | undefined; outcome?: Line } = {}): Promise<Line> {
  f.timeline.push({ type: 'assistant_message', text: o.words ?? 'Done.', messageId: `a-${turnId}`, turnId });
  f.snapshot.status = o.status ?? 'idle';
  f.snapshot.activeTurn = null;
  await host.show(f);
  return host.fire('agent.turn.after', { agent: f.agent, turnId, outcome: o.outcome ?? { kind: 'completed' }, timeline: [] });
}
/** A permission or question becomes pending: in the snapshot, then agent.permission.before. */
export async function permissionAsked(host: Host, f: Fake, p: Permission): Promise<Line> {
  (f.snapshot.pendingPermissions as Permission[]).push(p);
  await host.show(f);
  return host.fire('agent.permission.before', { agent: f.agent, request: p });
}

// ---- An MCP server as an agent starts it: the stdio entry the plugin added, the agent's child, in its folder.
export class Mcp {
  private buffer = '';
  private readonly replies = new Map<number, Line>();
  private ids = 0;
  private err = '';
  private constructor(readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        try { const l = JSON.parse(this.buffer.slice(0, i)) as Line; if (typeof l.id === 'number') this.replies.set(l.id, l); } catch { /* not a reply */ }
        this.buffer = this.buffer.slice(i + 1);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
  }
  static async start(home: string, cwd: string, entry: Line): Promise<Mcp> {
    if (entry.type !== 'stdio' || typeof entry.command !== 'string') throw Error(`DeepBuild's MCP server entry must be stdio with a command (README, The surface): ${JSON.stringify(entry)}`);
    const child = spawn(entry.command, (entry.args ?? []) as string[], { cwd, env: { ...childEnv(home), ...((entry.env ?? {}) as Record<string, string>) }, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const mcp = new Mcp(child);
    const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dh55-agent', version: '0' } });
    if (!init.result) throw Error(`BLOCKED: DeepBuild's MCP server refused initialize: ${JSON.stringify(init)}; stderr ${mcp.err}`);
    mcp.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    return mcp;
  }
  async request(method: string, params: Line, timeoutMs = 120_000): Promise<Line> {
    const id = ++this.ids;
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return waitFor(() => this.replies.get(id), timeoutMs, `the MCP server's reply to ${method}; stderr ${this.err.slice(-800)}`, 20);
  }
  async tools(): Promise<string[]> { return (((await this.request('tools/list', {})).result?.tools ?? []) as Line[]).map((t) => String(t.name)); }
  /** A tool's value as #26 reads it: its structuredContent, else the JSON in its first text block. */
  async call(name: string, args: Line): Promise<Line> {
    const reply = await this.request('tools/call', { name, arguments: args });
    if (reply.result?.structuredContent) return reply.result.structuredContent as Line;
    try { return JSON.parse(String(reply.result?.content?.[0]?.text ?? '')) as Line; } catch { return { reply }; }
  }
  stop(): void { try { this.child.stdin!.end(); } catch { /* gone */ } this.child.kill(); }
}
/** The one MCP server among an agent's that is DeepBuild's: the stdio entry whose tools list deep_claim. */
export async function deepServer(home: string, cwd: string, servers: Record<string, Line>): Promise<Mcp> {
  const tried: string[] = [];
  for (const [name, entry] of Object.entries(servers)) {
    if (entry.type !== 'stdio') { tried.push(`${name}: ${entry.type}`); continue; }
    const mcp = await Mcp.start(home, cwd, entry);
    const tools = await mcp.tools();
    if (tools.includes('deep_claim')) return mcp;
    tried.push(`${name}: ${tools.join(', ')}`);
    mcp.stop();
  }
  throw Error(`agent.open.before added no DeepBuild MCP server listing deep_claim: ${JSON.stringify(servers)} (${tried.join('; ') || 'no server at all'})`);
}
/** The agent claims its work done through DeepBuild's MCP server (deep_claim, #26's arguments). */
export async function claimDone(mcp: Mcp, commit: string): Promise<string> {
  const task = `task:01K${randomUUID().replace(/-/g, '').toUpperCase().slice(0, 23)}`;
  const got = await mcp.call('deep_claim', { task_ref: task, attempt: 1, commit, scope: 'session', predictions: null });
  const claim = typeof got.claim === 'string' ? got.claim : typeof got.event === 'string' ? `claim:${got.event}` : undefined;
  if (!claim) throw Error(`BLOCKED: deep_claim through the plugin's MCP server made no claim: ${JSON.stringify(got).slice(0, 1500)}`);
  return claim;
}

// ---- A real paseo daemon (README, The worlds): the pinned release from DEEP_PASEO_CLI, its home <home>/.paseo.
/** `DEEP_PASEO_CLI`: the `paseo` command of @getpaseo/cli at the version the facts pin. Missing or another version is BLOCKED, never a skip. */
export function paseoCli(): string {
  const cli = given.DEEP_PASEO_CLI;
  if (!cli || !existsSync(cli)) throw Error(`BLOCKED: no real paseo: set DEEP_PASEO_CLI to the paseo command of @getpaseo/cli ${existsSync(FACTS) ? pinnedPaseo() : '(the version adapters/paseo.facts.json pins)'} (got ${cli ?? 'nothing'})`);
  const version = execFileSync(cli, ['--version'], { encoding: 'utf8', env: { PATH: `${dirname(NODE)}:/usr/bin:/bin`, HOME: '/tmp' } }).trim().replace(/^v/, '');
  if (existsSync(FACTS) && version !== pinnedPaseo()) throw Error(`BLOCKED: DEEP_PASEO_CLI is paseo ${version}; the facts pin ${pinnedPaseo()}, the version these tests run on`);
  return cli;
}
/** The JSON a paseo command printed, after any line of words before it (`paseo run` names the workspace it made). */
const jsonIn = (text: string): Line => JSON.parse(text.slice(Math.min(...['{', '['].map((c) => text.indexOf(c)).filter((i) => i >= 0)))) as Line;
const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
});
export class Paseo {
  private out = '';
  private constructor(readonly child: ChildProcess, readonly home: string, readonly root: string, readonly env: NodeJS.ProcessEnv) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => { this.out = (this.out + d).slice(-20_000); });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.out = (this.out + d).slice(-20_000); });
  }
  /**
   * `paseo daemon run` with HOME the test's home and a config of its own: a free port, the relay off, and plugins on
   * unless `plugins: false`; no speech models are fetched. `env` reaches the daemon (npm's registry, for one).
   */
  static async start(home: string, o: { plugins?: boolean; env?: Record<string, string | undefined> } = {}): Promise<Paseo> {
    const cli = paseoCli();
    const root = join(home, '.paseo');
    mkdirSync(root, { recursive: true });
    const config: Line = { version: 1, daemon: { listen: `127.0.0.1:${await freePort()}`, relay: { enabled: false } } };
    if (o.plugins !== false) config.pluginsEnabled = true;
    writeFileSync(join(root, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
    const env = childEnv(home, { PASEO_DICTATION_ENABLED: 'false', PASEO_VOICE_MODE_ENABLED: 'false', DEEP_PASEO_PLANT: given.DEEP_PASEO_PLANT, ...o.env });
    const child = spawn(cli, ['daemon', 'run', '--home', root], { cwd: dirname(home), env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    own(child.pid);
    if (child.pid) groups.add(child.pid);
    const p = new Paseo(child, home, root, env);
    await waitFor(() => /Listening on/.test(p.out) || child.exitCode !== null, 120_000, 'paseo\'s daemon to listen');
    if (child.exitCode !== null) throw Error(`BLOCKED: paseo's daemon exited ${child.exitCode}: ${p.out.slice(-2000)}`);
    return p;
  }
  output(): string { return this.out; }
  /** One paseo command against this daemon's home. */
  async cli(args: readonly string[], timeoutMs = 120_000): Promise<Ran> {
    return run(paseoCli(), ['--home', this.root, ...args], { env: this.env, cwd: dirname(this.home), timeoutMs });
  }
  async json(args: readonly string[]): Promise<Line> {
    const r = await this.cli([...args, '--json']);
    if (r.code !== 0) throw Error(`paseo ${args.join(' ')} exited ${r.code}: ${r.stdout} ${r.stderr}`);
    return jsonIn(r.stdout);
  }
  /** A plugin installed from a directory and running. */
  async install(dir: string, id: string): Promise<void> {
    const r = await this.cli(['plugin', 'install', dir]);
    if (r.code !== 0) throw Error(`BLOCKED: paseo plugin install ${dir} exited ${r.code}: ${r.stdout} ${r.stderr}`);
    await this.running(id);
  }
  async plugins(): Promise<Line[]> {
    const got = await this.json(['plugin', 'ls']);
    return (Array.isArray(got) ? got : (got.plugins ?? got.entries ?? [])) as Line[];
  }
  async running(id: string, timeoutMs = 60_000): Promise<Line> {
    return waitFor(async () => (await this.plugins()).find((p) => (p.id ?? p.plugin) === id && p.status === 'running'), timeoutMs, `paseo plugin ${id} running; daemon output ${this.out.slice(-1500)}`, 500);
  }
  /** `paseo run` with the stand-in agent in `cwd`: the agent's ID once its turn is done. */
  async runAgent(cwd: string, prompt: string): Promise<string> {
    mkdirSync(cwd, { recursive: true });
    const r = await this.cli(['run', '--provider', 'dh55-fake', '--cwd', cwd, '--json', prompt], 180_000);
    if (r.code !== 0) throw Error(`BLOCKED: paseo run with the stand-in agent exited ${r.code}: ${r.stdout} ${r.stderr}`);
    const got = jsonIn(r.stdout);
    const id = got.agentId ?? got.id ?? got.agent?.id;
    if (typeof id !== 'string') throw Error(`BLOCKED: paseo run --json named no agent: ${r.stdout.slice(0, 1000)}`);
    return id;
  }
  /** What the stand-in agent saw in a folder: fixtures/fake-provider's log. */
  static seen(cwd: string): Line[] {
    const file = join(cwd, '.dh55-provider.jsonl');
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line) : [];
  }
  /** The agent's saved file, under <home>/.paseo/agents. */
  saved(id: string): Line | undefined {
    const dir = join(this.root, 'agents');
    if (!existsSync(dir)) return undefined;
    for (const project of readdirSync(dir)) {
      const file = join(dir, project, `${id}.json`);
      if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Line;
    }
    return undefined;
  }
  async stop(): Promise<void> {
    const pid = this.child.pid;
    if (!pid || this.child.exitCode !== null) return;
    try { process.kill(-pid, 'SIGTERM'); } catch { /* gone */ }
    await Promise.race([new Promise((done) => this.child.once('exit', done)), sleep(10_000)]);
    try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
    groups.delete(pid);
  }
}

// ---- npm, for paseo's install of the plugin: a local registry that stands in for npmjs.com (as tests/acceptance/40).
/** `npm pack` of packages/paseo as it would be published. */
export async function packed(): Promise<{ name: string; version: string; tgz: Buffer }> {
  needPlugin();
  const dir = tempDir();
  const r = await run('npm', ['pack', '--pack-destination', dir, '--ignore-scripts'], { cwd: PLUGIN, timeoutMs: 120_000 });
  if (r.code !== 0) throw Error(`npm pack of packages/paseo exited ${r.code}: ${r.stderr}`);
  const manifest = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8')) as Line;
  return { name: String(manifest.name), version: String(manifest.version), tgz: readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith('.tgz'))!)) };
}
export async function registry(name: string, versions: Record<string, Buffer>): Promise<string> {
  const server = createHttp((req, res) => {
    const url = decodeURIComponent(req.url ?? '');
    const base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
    if (url === `/${name}`) {
      const entries = Object.entries(versions);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        name, 'dist-tags': { latest: entries.at(-1)![0] },
        versions: Object.fromEntries(entries.map(([v, tgz]) => [v, { name, version: v, dist: { tarball: `${base}/t/${v}.tgz`, shasum: createHash('sha1').update(tgz).digest('hex') } }])),
      }));
      return;
    }
    const tarball = /^\/t\/(.+)\.tgz$/.exec(url);
    if (tarball && versions[tarball[1]!]) { res.end(versions[tarball[1]!]); return; }
    res.statusCode = 404;
    res.end('{}');
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/`;
}

// ---- Timing on the reference Mac: tests/acceptance/40's rule, and a load past the core count reads INCONCLUSIVE.
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;
export const loaded = (): boolean => loadavg()[0]! > availableParallelism();
export function percentile(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!;
}
