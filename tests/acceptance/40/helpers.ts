// What every #40 test shares: a scratch home, the real hub (`deep hub run`, with its root under that home), real pi
// 1.4.0 in RPC mode with the scripted provider and the package under test loaded from packages/pi, a client of the
// hub's socket, and the corpus. Nothing here stands in for DeepBuild's code. It stops only processes it started, by
// PID, and never touches ~/.pi, ~/.deepbuild or any account.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Line = Record<string, any>;
export const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const NODE = process.execPath;
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const PACKAGE = join(REPO, 'packages/pi');
export const FACTS = join(REPO, 'adapters/pi.facts.json');
export const CORPUS = join(REPO, 'adapters/corpus/pi');
export const VERSION = '1.4.0';
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const SCRIPTED = join(FIXTURES, 'scripted-provider.ts');
export const LIFECYCLE = join(FIXTURES, 'lifecycle.ts');
export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
export const blocked = (what: string): never => { throw Error(`BLOCKED: ${what}`); };

/** Real pi's dist/cli.js, from DEEP_PI_CLI. Missing is BLOCKED, never a skip. */
export function piCli(): string {
  const cli = process.env.DEEP_PI_CLI;
  if (!cli || !existsSync(cli)) return blocked(`no real pi: set DEEP_PI_CLI to dist/cli.js of @earendil-works/pi-coding-agent ${VERSION} (got ${cli ?? 'nothing'})`);
  const version = execFileSync(NODE, [cli, '--version'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: '/tmp', PI_OFFLINE: '1' } }).trim();
  if (version !== VERSION) return blocked(`DEEP_PI_CLI is pi ${version}; these tests are written against ${VERSION}, the one with agent_before_settle and agent_settled`);
  return cli;
}
export function needPackage(): void {
  if (!existsSync(join(PACKAGE, 'package.json'))) throw Error(`the pi package is missing: no ${join(PACKAGE, 'package.json')} (README, The surface)`);
}
export function readFacts(): Line {
  if (!existsSync(FACTS)) throw Error(`pi's facts are missing: no ${FACTS} (README, The surface)`);
  return JSON.parse(readFileSync(FACTS, 'utf8')) as Line;
}

export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const got = await probe();
    if (got) return got;
    if (Date.now() > end) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(50);
  }
}

// ---- Processes and folders this suite made.
const owned = new Set<number>();
const made: string[] = [];
export const own = (pid: number | undefined): void => { if (pid) owned.add(pid); };
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** Short real paths: a Unix socket path fits in 104 bytes, and Seatbelt matches real paths. */
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh40-'));
  made.push(dir);
  return dir;
}
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const end = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < end) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** This environment with HOME in the scratch folder and none of the agent's or the hub's own settings. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|TMUX|CLAUDE|CODEX|PI_|ANTHROPIC_|OPENAI_)/.test(key) || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PI_CODING_AGENT_DIR: join(home, '.pi/agent'), PI_OFFLINE: '1', PI_TELEMETRY: '0', PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
export interface Ran { code: number | null; stdout: string; stderr: string }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 60_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

// ---- The hub, its socket, and you at your terminal.
export interface Hub { pid: number; home: string; socket: string; child: ChildProcess; output(): string }
export async function startHub(home: string, plant?: string): Promise<Hub> {
  if (!existsSync(CLI)) return blocked(`the hub isn't built (${CLI}); run npm run build --workspaces`);
  const confirm = join(dirname(home), 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  // Your settings, as setup drafts them: without a deadline and a default for its kind an ask is refused (README, Disputes D3).
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.deepbuild/config.json'), `${JSON.stringify({ asks: { deadline: { taste: '3d' }, default: { taste: 'recommended' } } }, null, 2)}\n`);
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_PI_PLANT: plant }), stdio: ['ignore', 'pipe', 'pipe'] });
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
/** A client of the hub's line protocol, with the cli role. */
export class Client {
  private buffer = '';
  private readonly lines: Line[] = [];
  private ids = 0;
  private constructor(private readonly sock: net.Socket) {
    sock.setEncoding('utf8').on('data', (chunk: string) => {
      this.buffer += chunk;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        try { this.lines.push(JSON.parse(this.buffer.slice(0, i)) as Line); } catch { /* not a line of ours */ }
        this.buffer = this.buffer.slice(i + 1);
      }
    });
    sock.on('error', () => undefined);
  }
  static async open(hub: Hub): Promise<Client> {
    const sock = net.connect(hub.socket);
    await new Promise<void>((resolve, reject) => { sock.once('connect', resolve); sock.once('error', reject); });
    const c = new Client(sock);
    await waitFor(() => c.lines.length > 0, 5000, 'the hub\'s hello');
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(hub.home, '.deepbuild/control.token'), 'utf8').trim() })}\n`);
    await waitFor(() => c.lines.some((l) => l.role === 'cli'), 5000, 'the cli role');
    return c;
  }
  async call(method: string, params: unknown = {}, timeoutMs = 15_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await waitFor(() => this.lines.find((l) => l.id === id), timeoutMs, `the reply to ${method}`);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
  async events(): Promise<Line[]> {
    const out: Line[] = [];
    for (let after = 0; ;) {
      const page = await this.call('events.read', { after, limit: 1000 });
      const events = page.events as Line[];
      if (!events.length) return out;
      out.push(...events);
      after = events[events.length - 1]!.log_pos as number;
    }
  }
  close(): void { this.sock.destroy(); }
}

// ---- One scripted pi session in RPC mode.
export interface Step { text?: string; echo?: boolean; tools?: { name: string; arguments: Record<string, unknown> }[]; error?: string; holdMs?: number; usage?: { input: number; output: number; cacheRead?: number } }
export interface PiOptions {
  steps: Step[];
  /** Text an extension consumes without a run (fixtures/lifecycle.ts). */
  handle?: string;
  /** True: that extension loads ahead of the package, so pi never shows the package an input it consumes. */
  handlerAhead?: boolean;
  /** DEEP_PI_PLANT: a planted wrong program (README, Wrong programs). */
  plant?: string | undefined;
  /** False: pi alone, without the package. */
  withPackage?: boolean;
  /** Further -e paths, for the installed-package test: none by default. */
  env?: Record<string, string | undefined>;
}
export class Pi {
  readonly events: Line[] = [];
  private buffer = '';
  private ids = 0;
  private err = '';
  session = '';
  private constructor(readonly child: ChildProcess, readonly dir: string, readonly cwd: string) {
    child.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      // Split on LF alone: pi's own RPC doc warns against readline here.
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        try { this.events.push({ ...(JSON.parse(this.buffer.slice(0, i)) as Line), at: Date.now() }); } catch { /* stdout is protocol records only */ }
        this.buffer = this.buffer.slice(i + 1);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (this.err += d));
  }
  static async start(home: string, cwd: string, o: PiOptions): Promise<Pi> {
    const cli = piCli();
    if (o.withPackage !== false) needPackage();
    const dir = mkdtempSync(join(dirname(home), 'pi-'));
    const script = join(dir, 'script.json');
    writeFileSync(script, JSON.stringify(o.steps));
    // pi runs `input` handlers in load order and stops at the first that returns handled, so the package sees an
    // input the fixture consumes only when it loads first; handlerAhead is the other real order (README, Disputes D1).
    const pkg = o.withPackage === false ? [] : ['-e', PACKAGE];
    const extensions = o.handlerAhead ? ['-e', LIFECYCLE, ...pkg] : [...pkg, '-e', LIFECYCLE];
    const args = [cli, '--mode', 'rpc', '--offline', '--no-approve', '-e', SCRIPTED, ...extensions, '--provider', 'scripted', '--model', 'scripted-1', '--session-dir', join(dir, 'sessions')];
    const child = spawn(NODE, args, {
      cwd,
      env: childEnv(home, { DEEP_PI_SCRIPT: script, DEEP_PI_REQUESTS: join(dir, 'requests.jsonl'), DEEP_PI_INPUTS: join(dir, 'inputs.jsonl'), DEEP_PI_HANDLE: o.handle, DEEP_PI_PLANT: o.plant, ...o.env }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    own(child.pid);
    const pi = new Pi(child, dir, cwd);
    const state = await pi.call({ type: 'get_state' }, 60_000);
    pi.session = String(state.data.sessionId);
    return pi;
  }
  /** One command and its response. */
  async call(command: Line, timeoutMs = 30_000): Promise<Line> {
    const id = `c${++this.ids}`;
    this.child.stdin!.write(`${JSON.stringify({ id, ...command })}\n`);
    return waitFor(() => this.events.find((e) => e.type === 'response' && e.id === id), timeoutMs, `pi's response to ${String(command.type)}; stderr: ${this.err.slice(-800)}`);
  }
  count(type: string): number { return this.events.filter((e) => e.type === type).length; }
  /** Waits for the `n`th (1-based) event of a type. */
  until(type: string, n: number, timeoutMs = 75_000): Promise<Line> {
    return waitFor(() => this.events.filter((e) => e.type === type)[n - 1], timeoutMs, `pi event ${type} #${n}; saw ${[...new Set(this.events.map((e) => e.type))].join(', ')}; stderr: ${this.err.slice(-800)}`);
  }
  /** Every model request, as the scripted provider saw it: { at, ms, messages, tools, stop, endMs }. */
  requests(): Line[] {
    const file = join(this.dir, 'requests.jsonl');
    if (!existsSync(file)) return [];
    const byAt = new Map<number, Line>();
    for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      const e = JSON.parse(line) as Line;
      if (e.phase === 'start') byAt.set(e.at, e);
      else Object.assign(byAt.get(e.at) ?? {}, { stop: e.stop, endMs: e.ms });
    }
    return [...byAt.values()];
  }
  inputs(): Line[] {
    const file = join(this.dir, 'inputs.jsonl');
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line) : [];
  }
  /** The user messages of the newest model request holding `text`, or none. */
  userMessagesWith(text: string): Line[] {
    return (this.requests().at(-1)?.messages as Line[] | undefined ?? []).filter((m) => m.role === 'user' && String(m.text).includes(text));
  }
  sessionEntries(): Line[] {
    const dir = join(this.dir, 'sessions');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isFile() ? readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line) : []));
  }
  stderr(): string { return this.err; }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    await Promise.race([new Promise((done) => this.child.once('exit', done)), sleep(3000)]);
  }
}

// ---- A world: the hub, a working folder, pi with the package.
export interface World { tmp: string; home: string; cwd: string; hub: Hub; client: Client; pi: Pi; plant?: string | undefined }
export async function openWorld(o: PiOptions): Promise<World> {
  piCli();
  needPackage();
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const cwd = join(tmp, 'w');
  mkdirSync(home);
  mkdirSync(cwd);
  writeFileSync(join(cwd, 'nested.txt'), 'nested\n');
  const hub = await startHub(home, o.plant);
  const client = await Client.open(hub);
  const pi = await Pi.start(home, cwd, o);
  await waitFor(async () => (await client.events()).some((e) => e.kind === 'session.start' && e.session === pi.session), 15_000, `the hub to record session.start for pi session ${pi.session}: pi's stderr ${pi.stderr().slice(-500)}; pi extension errors ${JSON.stringify(pi.events.filter((e) => e.type === 'extension_error')).slice(0, 500)}`);
  return { tmp, home, cwd, hub, client, pi, plant: o.plant };
}

// ---- Asks: a native deep_ask from the scripted model, and your answer in your terminal.
export function askStep(question: string, label: string): Step {
  return { tools: [{ name: 'deep_ask', arguments: { kind: 'taste', question, options: [{ id: 'first', label }, { id: 'second', label: 'The other one' }], recommended: 'second' } }] };
}
export async function askCreated(w: World, question: string): Promise<Line> {
  return waitFor(async () => (await w.client.events()).find((e) => e.kind === 'ask.created' && e.data?.question === question), 30_000, `the native deep_ask to raise "${question}" under the session`);
}
/** Your answer: `deep inbox answer`, with the OS confirmation stubbed as #24's tests do. */
export async function answer(w: World, handle: string, option = 'first'): Promise<void> {
  const r = await run(NODE, [CLI, 'inbox', 'answer', handle, option], { env: childEnv(w.home), timeoutMs: 30_000 });
  if (r.code !== 0) throw Error(`deep inbox answer ${handle} ${option} exited ${r.code}: ${r.stdout}${r.stderr}`);
}
export const outcomesOf = async (w: World, handle: string): Promise<Line[]> => (await w.client.events()).filter((e) => e.kind === 'delivery.outcome' && e.data?.delivery === handle);
/**
 * Prompts a session that raises an ask, then aborts its turn while deep_ask waits: the session is idle with the ask
 * open, without the 40 s of the wait. Returns the ask's handle.
 */
export async function pendingAsk(w: World, question: string): Promise<string> {
  const settled = w.pi.count('agent_settled');
  await w.pi.call({ type: 'prompt', message: 'Raise the ask.' });
  const created = await askCreated(w, question);
  await w.pi.call({ type: 'abort' });
  await w.pi.until('agent_settled', settled + 1);
  return `ask:${String(created.id)}`;
}
export const word = (): string => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---- The lifecycle a record or a corpus session shows, reduced to what the cases pin.
export function lifecycleOf(events: readonly { kind: string; data: Line }[]): string[] {
  return events.flatMap((e) => {
    if (e.kind === 'session.activity') return [String(e.data.activity)];
    if (e.kind === 'agent.stop') return ['stop'];
    if (e.kind === 'user.ask') return [e.data.disposition === 'handled' ? 'prompt:handled' : 'prompt'];
    return [];
  });
}
export const holdsRun = (haystack: readonly string[], needle: readonly string[]): boolean => haystack.some((_, i) => needle.every((n, j) => haystack[i + j] === n));

// ---- The corpus.
export interface CorpusCase { payload: Line; expect: { kind: string; data: Line }[]; source?: string; reviewed?: string; tag?: string; pending?: Line; session: string; dir: string; line: number }
export function corpusSessions(): { name: string; dir: string; meta: Line; cases: CorpusCase[]; transcript: Line[] }[] {
  if (!existsSync(CORPUS)) throw Error(`the pi corpus is missing: no ${CORPUS}`);
  return readdirSync(CORPUS).flatMap((version) => readdirSync(join(CORPUS, version)).map((name) => {
    const dir = join(CORPUS, version, name);
    const cases = readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((text, i) => ({ ...(JSON.parse(text) as Line), session: `${version}/${name}`, dir, line: i + 1 })) as CorpusCase[];
    const transcriptFile = join(dir, 'transcript.jsonl');
    return { name: `${version}/${name}`, dir, meta: JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8')) as Line, cases, transcript: existsSync(transcriptFile) ? readFileSync(transcriptFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line) : [] };
  }));
}
/** A copy of the repo's facts files with pi's patched: a planted wrong mapping, for a run of the real replay. */
export function plantedFacts(patch: (facts: Line) => void): string {
  const dir = tempDir();
  for (const name of readdirSync(join(REPO, 'adapters')).filter((n) => n.endsWith('.facts.json'))) {
    const facts = JSON.parse(readFileSync(join(REPO, 'adapters', name), 'utf8')) as Line;
    if (name === 'pi.facts.json') patch(facts);
    writeFileSync(join(dir, name), JSON.stringify(facts));
  }
  return dir;
}
export const logTo = (file: string, line: string): void => appendFileSync(file, `${line}\n`);

// ---- Timing on the reference Mac (tests/acceptance/14, 16, 159 and 236's rule).
const REFERENCE_MACS = [{ model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 }, { model: 'Mac15,12', chip: 'Apple M3', gib: 16 }];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    therm = read('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  if ([...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100) || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
