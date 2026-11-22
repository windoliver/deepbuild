// Test-side tools for #2568's acceptance tests (a rules.json deep-hook can't read, on a pi call, with the hub
// answering): a temp home that `deep setup` set up, the real hub as a process (`deep hub run`), real pi 1.4.0 in RPC
// mode with the pi package from packages/pi and the scripted model of tests/acceptance/40, and the record read back
// through the hub's socket. The socket client, pi's location check and the child environment are #40's helpers, as
// packages/pi/test/guards.test.ts uses them; the hub and pi starts are this suite's own, because a hub started a second
// time must leave the home's config.json as setup wrote it, and pi loads one more extension here (fixtures/net.ts).
// Nothing here stands in for deep-hook, the hub or the package, and nothing here asserts a criterion: a setup that
// can't be made throws a plain BLOCKED or INCONCLUSIVE error; the criteria are the tests' own `expect`s.
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI, Client, NODE, REPO, SCRIPTED, childEnv, cleanup as stopOwned, own, piCli, run, sleep, waitFor, type Line } from '../40/helpers.js';

export { Client, NODE, REPO, sleep, waitFor, type Line };
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const PACKAGE = join(REPO, 'packages/pi');
/** Loaded after the package: blocks a `pkill` call the package let through, so no kill ever runs (README, The surface). */
const NET = fileURLToPath(new URL('./fixtures/net.ts', import.meta.url));
/** The words fixtures/net.ts blocks with: the package let the call through, and it would have run. */
export const NET_WORDS = 'acceptance-2568 net: the pi package let this call run';

/** Each criterion's ID: `#2568.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC1 = '#2568.3ae12f6f';
export const AC2 = '#2568.8523ddc0';
export const AC3 = '#2568.2ab07f36';
export const AC4 = '#2568.4918d42c';

export const blocked = (what: string): never => { throw Error(`BLOCKED: ${what}`); };
export const inconclusive = (what: string): never => { throw Error(`INCONCLUSIVE: ${what}`); };

// ---- Temp folders, short for the hub's socket path; removed, with every process this suite started, after each test.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh2568-'));
  made.push(dir);
  return dir;
}
export async function cleanup(): Promise<void> {
  await stopOwned();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * A child's environment: #40's (HOME the test's, no DEEP_, XDG_, PI_, CLAUDE or billing settings), with a `pkill` that
 * only leaves a mark first on PATH, a second guard behind fixtures/net.ts so the system's never runs.
 */
export function env(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const bin = join(dirname(home), 'bin');
  if (!existsSync(join(bin, 'pkill'))) {
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'pkill'), `#!/bin/sh\n: > ${join(dirname(home), 'pkill-ran')}\n`);
    chmodSync(join(bin, 'pkill'), 0o755);
  }
  const base = childEnv(home, extra);
  return { ...base, PATH: `${bin}:${base.PATH}`, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, '.gitconfig') };
}

// ---- The hub.
export interface Hub { pid: number; home: string; socket: string; child: ChildProcess; output(): string }
/** `deep hub run` on the home. The first start writes the asks settings #40's hub starts with; a later one writes nothing. */
export async function startHub(home: string): Promise<Hub> {
  if (!existsSync(CLI)) return blocked(`the hub isn't built (${CLI}); run npm run build --workspaces`);
  const confirm = join(dirname(home), 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  const config = join(home, '.deepbuild/config.json');
  if (!existsSync(config)) writeFileSync(config, `${JSON.stringify({ asks: { deadline: { taste: '3d' }, default: { taste: 'recommended' } } }, null, 2)}\n`);
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: env(home, { DEEP_HUB_TEST_CONFIRM: confirm }), stdio: ['ignore', 'pipe', 'pipe'] });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 60_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(first.includes('"ready":true')); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) return blocked(`the hub didn't start: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(home, '.deepbuild/hub.sock'), child, output: () => out };
}
/** Stops a hub this suite started, by its PID, and waits until its socket is gone. */
export async function stopHub(hub: Hub): Promise<void> {
  if (hub.child.exitCode === null && hub.child.signalCode === null) {
    const exited = new Promise((done) => hub.child.once('exit', done));
    process.kill(hub.pid, 'SIGTERM');
    await Promise.race([exited, sleep(10_000)]);
  }
  if (hub.child.exitCode === null && hub.child.signalCode === null) blocked(`the hub (pid ${hub.pid}) didn't stop within 10 s of SIGTERM`);
  if (existsSync(hub.socket)) rmSync(hub.socket, { force: true });
}

// ---- A home after setup: the hub up, `deep setup` run on it (rules.json, setup-finished.json, config.json's hook).
export interface Home { tmp: string; home: string; cwd: string; hub: Hub; rules: string; text: string }
export async function setUp(): Promise<Home> {
  piCli();
  if (!existsSync(DEEP_HOOK)) blocked(`no ${DEEP_HOOK}; run cargo build --locked -q -p deep-hook`);
  if (!existsSync(join(PACKAGE, 'dist/index.js'))) blocked(`the pi package isn't built (${PACKAGE}/dist); run npm run build --workspaces`);
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const cwd = join(tmp, 'w');
  mkdirSync(home);
  mkdirSync(cwd);
  // A hub is up before setup, so setup's own start finds it answering and installs no login service.
  const hub = await startHub(home);
  const setup = await run(NODE, [CLI, 'setup'], { env: env(home), timeoutMs: 120_000 });
  if (setup.code !== 0) blocked(`deep setup exited ${setup.code}: ${setup.stdout.slice(-800)}${setup.stderr.slice(-800)}`);
  const rules = join(home, '.deepbuild/rules.json');
  if (!existsSync(rules)) blocked('deep setup wrote no ~/.deepbuild/rules.json');
  if (!existsSync(join(home, '.deepbuild/setup-finished.json'))) blocked('deep setup wrote no ~/.deepbuild/setup-finished.json');
  const hook = (JSON.parse(readFileSync(join(home, '.deepbuild/config.json'), 'utf8')) as Line).hook?.binary;
  if (typeof hook !== 'string' || realpathSync(hook) !== realpathSync(DEEP_HOOK)) blocked(`setup recorded deep-hook ${String(hook)}, not ${DEEP_HOOK}`);
  return { tmp, home, cwd, hub, rules, text: readFileSync(rules, 'utf8') };
}
/** The file's own first 40 bytes written over it. */
export function cutShort(h: Home): void {
  writeFileSync(h.rules, Buffer.from(h.text, 'utf8').subarray(0, 40));
  try { JSON.parse(readFileSync(h.rules, 'utf8')); blocked('rules.json cut to 40 bytes still parses'); } catch (e) { if (String(e).includes('BLOCKED')) throw e; }
}

// ---- Real pi in RPC mode, the package and then the net loaded, the scripted model following `steps`.
export interface Step { text?: string; tools?: { name: string; arguments: Record<string, unknown> }[] }
export const bash = (command: string): Step => ({ tools: [{ name: 'bash', arguments: { command } }] });
export class Pi {
  readonly events: Line[] = [];
  private buffer = '';
  private ids = 0;
  private err = '';
  private constructor(readonly child: ChildProcess) {
    child.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        try { this.events.push({ ...(JSON.parse(this.buffer.slice(0, i)) as Line), at: Date.now() }); } catch { /* protocol records only */ }
        this.buffer = this.buffer.slice(i + 1);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (this.err += d));
  }
  static async start(h: Home, steps: Step[]): Promise<Pi> {
    const cli = piCli();
    const dir = mkdtempSync(join(h.tmp, 'pi-'));
    writeFileSync(join(dir, 'script.json'), JSON.stringify(steps));
    const args = [cli, '--mode', 'rpc', '--offline', '--no-approve', '-e', SCRIPTED, '-e', PACKAGE, '-e', NET, '--provider', 'scripted', '--model', 'scripted-1', '--session-dir', join(dir, 'sessions')];
    const child = spawn(NODE, args, { cwd: h.cwd, env: env(h.home, { DEEP_PI_SCRIPT: join(dir, 'script.json') }), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const pi = new Pi(child);
    await pi.call({ type: 'get_state' }, 60_000);
    return pi;
  }
  async call(command: Line, timeoutMs = 30_000): Promise<Line> {
    const id = `c${++this.ids}`;
    this.child.stdin!.write(`${JSON.stringify({ id, ...command })}\n`);
    return waitFor(() => this.events.find((e) => e.type === 'response' && e.id === id), timeoutMs, `pi's response to ${String(command.type)}; stderr: ${this.err.slice(-800)}`);
  }
  until(type: string, n: number, timeoutMs = 60_000): Promise<Line> {
    return waitFor(() => this.events.filter((e) => e.type === type)[n - 1], timeoutMs, `pi event ${type} #${n}; stderr: ${this.err.slice(-800)}`);
  }
}

/** One tool call's end as pi reports it, and what it said. */
export interface Ended { end: Line; id: string; words: string; ms: number; blocked: boolean; byNet: boolean }
/**
 * Prompts pi once and waits for the ends of its tool calls `first` to `first + count - 1` (1-based, counted over the
 * session), then, with `settle`, for the run's end. Each call's `ms` runs from the prompt, or from the end of the call
 * before it.
 */
export async function prompt(pi: Pi, first: number, count = 1, settle = true): Promise<Ended[]> {
  const runs = pi.events.filter((e) => e.type === 'agent_end').length;
  let at = Date.now();
  await pi.call({ type: 'prompt', message: 'Go.' });
  const out: Ended[] = [];
  for (let n = first; n < first + count; n++) {
    const end = await pi.until('tool_execution_end', n);
    const words = JSON.stringify(end.result);
    out.push({ end, id: String(end.toolCallId), words, ms: Number(end.at) - at, blocked: end.isError === true, byNet: words.includes(NET_WORDS) });
    at = Number(end.at);
  }
  if (settle) await pi.until('agent_end', runs + 1, 90_000);
  return out;
}
export const nextCall = async (pi: Pi, n: number): Promise<Ended> => (await prompt(pi, n))[0]!;

/** The record's `tool.before` for a pi call, by its tool_use_id; undefined when the hub never took it. */
export async function before(client: Client, id: string, timeoutMs = 15_000): Promise<Line | undefined> {
  try {
    return await waitFor(async () => (await client.events()).find((e) => e.kind === 'tool.before' && JSON.stringify(e).includes(id)), timeoutMs, `tool.before for ${id}`);
  } catch { return undefined; }
}

/** pi's package waits 15 s for the hub's reply; a call that took this long may have been decided with the hub away. */
export const ANSWERED_MS = 12_000;
