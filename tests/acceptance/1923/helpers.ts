// Test-side tools for the #1923 acceptance tests: a world of a real hub (`deep hub run`) in a temp home, a test
// provider (a local HTTP server on 127.0.0.1 standing in for a hosted model, which counts every submission it gets),
// the test plug-in (fixtures/hosted, its tool program from fixtures/tool) installed with `deep install <folder>` and a
// standing rule for its paid tool, `deep mcp` processes spoken to as agents' MCP clients do, the hub's socket as the
// cli role (the OS confirmation stubbed by DEEP_HUB_TEST_CONFIRM), the hub killed by its PID and started again, and
// the judges each criterion's test and its planted programs share. Copied from tests/acceptance/1922/helpers.ts where
// the same: the hub, the cli role, the record, deep mcp. No hub, CLI or extension-host module is imported but the
// extension host's public entry, for `packageDigest` only.
//
// Safety: every folder is under /tmp/dh1923-* and removed after its file; HOME is a temp home for every child;
// DEEP_*, CLAUDE*, CODEX* and NODE_OPTIONS are left out of their environment; the provider listens on 127.0.0.1 and
// nothing leaves it; no model is called; every process is one this file started, stopped by its PID.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** The kind, the paid test job tool, the planted tool and their price, as README names them. */
export const KIND = 'test.hosted';
export const TOOL = 'hosted-upper@1.0.0';
export const PLANTED_TOOL = 'hosted-resubmit@1.0.0';
export const COST = 0.02;
const PARAMS = '{"case":"upper"}';
/** How long the judges wait for what must not happen (a second call, an early reply, a dropped request). */
const WINDOW_MS = 3000;

/** The planted runners this suite selects with DEEP_HUB_PLANT (README, Plants). */
export type HubPlant = 'job-second-call' | 'job-joiner-cancels-job';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Line) : undefined; } catch { return undefined; } };
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---- Temp folders, processes and providers, all gone after the file.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1923-'));
  made.push(dir);
  return dir;
}
/** The PIDs of the processes this file started that haven't exited: a PID leaves once its process exits, so a reused one is never signalled. */
const owned = new Set<number>();
function own(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  owned.add(pid);
  child.once('exit', () => owned.delete(pid));
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
const providers: Provider[] = [];
afterAll(async () => {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  // Closing a provider ends any request still held there, so a tool the hub left waiting on it ends too.
  for (const p of providers.splice(0)) await p.close();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 30_000);

function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT)/.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_EXTRA_CA_CERTS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}
export interface Ran { code: number | null; stdout: string; stderr: string }
export const shown = (r: Ran) => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
function run(args: readonly string[], home: string, cwd: string): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    own(child);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

// ---- The test plug-in: fixtures/hosted copied, `*.fixture` renamed, its tool program laid in ./tool, its probe and
// manifest written (the tool and its provider's host), its digest set by the extension host's packageDigest.
const { packageDigest } = await import(new URL('../../../packages/extension-host/src/index.ts', import.meta.url).href) as typeof import('../../../packages/extension-host/src/index.ts');
function unfixture(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (lstatSync(path).isDirectory()) unfixture(path);
    else if (name.endsWith('.fixture')) renameSync(path, join(dir, name.slice(0, -'.fixture'.length)));
  }
}
/** test/hosted with the paid test job tool hosted-upper@1.0.0, or the planted hosted-resubmit@1.0.0, calling `provider`. */
export function hostedPlugin(dir: string, plan: { planted: boolean; provider: string }): string {
  const tool = plan.planted ? PLANTED_TOOL : TOOL;
  cpSync(join(FIXTURES, 'hosted'), dir, { recursive: true });
  unfixture(dir);
  mkdirSync(join(dir, 'tool'));
  writeFileSync(join(dir, 'tool', 'hosted.mjs'), readFileSync(join(FIXTURES, 'tool', plan.planted ? 'resubmit.mjs.fixture' : 'hosted.mjs.fixture')));
  writeFileSync(join(dir, 'probe.json'), `${JSON.stringify({ tool })}\n`);
  const path = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Line;
  manifest.job_tools = [{ kind: KIND, tool, provider: plan.provider }];
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

// ---- The test provider: a hosted model's stand-in on 127.0.0.1 that the test controls (README, The surface under
// test, 6). It counts every submission, whatever its key, and never dedupes; at the moment each one arrives it reads
// the call journal for that submission's key; it answers {task, text in upper case}, or holds the answer until
// released.
export interface JournalLine { file: string; key: string; provider?: unknown; task?: unknown }
/** Every JSON line holding a `key` in every file under the hub's jobs folder, as it is now. */
export function journalLines(dir: string): JournalLine[] {
  const out: JournalLine[] = [];
  const walk = (at: string): void => {
    let names: string[];
    try { names = readdirSync(at).sort(); } catch { return; }
    for (const name of names) {
      const path = join(at, name);
      let text: string;
      try {
        const stat = lstatSync(path);
        if (stat.isDirectory()) { walk(path); continue; }
        if (!stat.isFile() || stat.size > 1 << 20) continue;
        text = readFileSync(path, 'utf8');
      } catch { continue; }
      for (const line of text.split('\n')) {
        const v = parse(line);
        if (v && typeof v.key === 'string') out.push({ ...v, file: path, key: v.key });
      }
    }
  };
  walk(dir);
  return out;
}
/** A journal line that records a submission: its key and provider, before any task. */
const submitted = (lines: JournalLine[], key: string, provider: string): boolean => lines.some((l) => l.key === key && l.provider === provider && l.task === undefined);

export interface Submission {
  /** 1 for the first the provider got. */
  n: number;
  /** The Idempotency-Key header: the submission key the tool sent. */
  key: string | null;
  text: string;
  /** The provider's task ID for it. */
  task: string;
  /** Whether, when it arrived, a file under the hub's jobs folder already held {key, provider} for its key. */
  journaled: boolean;
  answered: boolean;
  /** Its connection closed before the provider answered: the tool's request was dropped. */
  dropped: boolean;
}
export interface Provider {
  /** "127.0.0.1:<port>", as the manifest names it. */
  host: string;
  submissions: Submission[];
  /** The next submission's answer is held until release(). */
  holdNext(): void;
  release(): void;
  /** The first submission after `from` that `match` takes, once it has arrived; undefined after `ms`. */
  arrived(from: number, match: (s: Submission) => boolean, ms: number): Promise<Submission | undefined>;
  close(): Promise<void>;
}
export async function openProvider(jobs: string): Promise<Provider> {
  const submissions: Submission[] = [];
  const held: (() => void)[] = [];
  let holds = 0;
  const server = createServer((req, res: ServerResponse) => {
    if (req.method !== 'POST' || req.url !== '/tasks') { res.writeHead(404).end(); return; }
    const header = req.headers['idempotency-key'];
    const key = typeof header === 'string' && header ? header : null;
    // What the journal held at the moment the request arrived, the earliest the test sees it leave the machine.
    const journaled = key !== null && submitted(journalLines(jobs), key, host);
    const parts: Buffer[] = [];
    req.on('data', (d: Buffer) => parts.push(d));
    req.on('end', () => {
      const text = String(parse(Buffer.concat(parts).toString('utf8'))?.text ?? '');
      const s: Submission = { n: submissions.length + 1, key, text, task: `task-${submissions.length + 1}`, journaled, answered: false, dropped: false };
      submissions.push(s);
      res.on('close', () => { if (!s.answered) s.dropped = true; });
      const answer = (): void => {
        if (res.destroyed || s.dropped) return;
        s.answered = true;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ task: s.task, text: text.toUpperCase() }));
      };
      if (holds > 0) { holds -= 1; held.push(answer); } else answer();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const host = `127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  const provider: Provider = {
    host, submissions,
    holdNext: () => { holds += 1; },
    release: () => { for (const answer of held.splice(0)) answer(); },
    async arrived(from, match, ms) {
      const deadline = Date.now() + ms;
      for (;;) {
        const found = submissions.slice(from).find(match);
        if (found || Date.now() > deadline) return found;
        await sleep(50);
      }
    },
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
  providers.push(provider);
  return provider;
}

// ---- The hub.
interface Hub { pid: number; socket: string; root: string; child: ChildProcess }
async function startHub(home: string, env: Record<string, string>): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-8000)));
  const ready = await new Promise<Line | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); resolve(parse(out.split('\n')[0]!)); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub didn't start (deep hub run${env.DEEP_HUB_PLANT ? ` with DEEP_HUB_PLANT=${env.DEEP_HUB_PLANT}` : ''}): ${out.slice(0, 500)} ${err.slice(-1500)}`);
  return { pid: child.pid!, socket: typeof ready.socket === 'string' ? ready.socket : join(home, '.deepbuild', 'hub.sock'), root: join(home, '.deepbuild'), child };
}
/** The hub killed by its PID with SIGKILL, as a crash would end it, once it has exited. */
export async function killHub(w: World): Promise<void> {
  const { child, pid } = w.hub;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  process.kill(pid, 'SIGKILL');
  await ended;
}
/** `deep hub run` again in the same home, with the same environment. */
export async function restartHub(w: World): Promise<void> {
  w.hub = await startHub(w.home, w.env);
}

/** One call on the hub's socket as the cli role, with the control token and this process for the peer check: the reply line. */
export async function control(w: World, method: string, params: Line, timeoutMs = 60_000): Promise<Line> {
  const token = readFileSync(join(w.hub.root, 'control.token'), 'utf8').trim();
  const start = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' }).trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(w.hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`BLOCKED: the hub gave no answer to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parse(buffer.slice(0, i)) ?? {};
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token, peer: { pid: process.pid, start } })}\n`); }
        else if (step === 1) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (line.id === 1) { clearTimeout(timer); sock.destroy(); resolve(line); }
      }
    });
  });
}
/** A cli call that must succeed: its result. */
export async function must(w: World, method: string, params: Line): Promise<Line> {
  const reply = await control(w, method, params);
  if (reply.error) throw Error(`${reply.error.code === 'unknown_method' ? 'BLOCKED: ' : ''}${method} ${JSON.stringify(params)} was refused: ${JSON.stringify(reply.error)}`);
  return reply.result as Line;
}
/** The hub's record after log position `after`, through events.read on the cli role. */
export async function events(w: World, after = 0): Promise<Line[]> {
  const all: Line[] = [];
  for (let from = after; ;) {
    const page = (await must(w, 'events.read', { after: from, limit: 1000 })).events as Line[];
    all.push(...page);
    if (page.length < 1000) return all;
    from = page[page.length - 1]!.log_pos;
  }
}
export async function lastPos(w: World): Promise<number> {
  const all = await events(w);
  return all.length ? Math.max(...all.map((e) => Number(e.log_pos))) : 0;
}
const dataOf = (e: Line): Line => (typeof e.data === 'string' ? parse(e.data) ?? {} : e.data ?? {});
/** The asks raised in the record after `after`, oldest first, each `{handle, kind, text, data}`. */
export async function asks(w: World, after = 0): Promise<{ handle: string; kind: string; text: string; data: Line }[]> {
  return (await events(w, after)).filter((e) => e.kind === 'ask.created').map((e) => ({ handle: `ask:${String(e.id)}`, kind: String(dataOf(e).kind), text: JSON.stringify(dataOf(e)), data: dataOf(e) }));
}

// ---- deep mcp, as an agent's MCP client talks to it: requests that can be left open, and MCP's cancellation.
export interface Outcome { isError: boolean; value: Line; text: string }
/** A tools/call reply as an Outcome: the tool's error, or its result's structured content. */
export function outcomeOf(reply: Line | undefined): Outcome {
  if (!reply) return { isError: true, value: {}, text: 'no reply' };
  if (reply.error) return { isError: true, value: reply.error as Line, text: JSON.stringify(reply.error) };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? String(result.content.find((c: Line) => c?.type === 'text')?.text ?? '') : '';
  const value = (result.structuredContent ?? parse(text) ?? {}) as Line;
  return { isError: result.isError === true, value, text: text || JSON.stringify(value) };
}
export class Mcp {
  private lines: Line[] = [];
  private wakers = new Set<() => void>();
  private n = 0;
  constructor(readonly child: ChildProcess) {
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { const l = parse(buffer.slice(0, i)); if (l) this.lines.push(l); buffer = buffer.slice(i + 1); }
      for (const w of [...this.wakers]) w();
    });
    child.on('exit', () => { for (const w of [...this.wakers]) w(); });
    child.stdin!.on('error', () => undefined);
  }
  /** The reply to request `id`, once it has come. */
  replied(id: number): Line | undefined { return this.lines.find((l) => l.id === id); }
  /** A request sent now: its id, and its reply, or undefined if none comes in `timeoutMs` or deep mcp exits. Never rejects. */
  begin(method: string, params: Line, timeoutMs = 300_000): { id: number; reply: Promise<Line | undefined> } {
    const id = ++this.n;
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    const reply = new Promise<Line | undefined>((resolve) => {
      const timer = setTimeout(() => { this.wakers.delete(check); resolve(undefined); }, timeoutMs);
      timer.unref();
      const check = (): void => {
        const found = this.replied(id);
        if (found || this.child.exitCode !== null) { clearTimeout(timer); this.wakers.delete(check); resolve(found); }
      };
      this.wakers.add(check);
      check();
    });
    return { id, reply };
  }
  notify(method: string, params: Line = {}): void { this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`); }
}
export async function startMcp(home: string, cwd: string): Promise<Mcp> {
  const child = spawn(NODE, [CLI, 'mcp'], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'ignore'] });
  own(child);
  const mcp = new Mcp(child);
  const init = await mcp.begin('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1923', version: '0' } }, 60_000).reply;
  if (!init?.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(init)}`);
  mcp.notify('notifications/initialized');
  return mcp;
}
/** deep_job's run of test.hosted on one input file with the paid tool, as the same args each time. */
export const jobArgs = (tool: string, file: string): Line => ({ op: 'run', kind: KIND, tool, params: PARAMS, inputs: [{ name: 'text', path: file }] });
/** A deep_job call left open: its request id, and its outcome once answered. */
export function beginJob(mcp: Mcp, args: Line): { id: number; outcome: Promise<Outcome> } {
  const { id, reply } = mcp.begin('tools/call', { name: 'deep_job', arguments: args });
  return { id, outcome: reply.then(outcomeOf) };
}
export const runJob = (mcp: Mcp, args: Line): Promise<Outcome> => beginJob(mcp, args).outcome;
export const done = (o: Outcome): boolean => !o.isError && o.value.status === 'done';
export const outputOf = (o: Outcome): string | undefined => o.value.outputs?.text?.sha256;
export const receiptOf = (o: Outcome): Line => (o.value.receipt ?? {}) as Line;
const cut = (o: Outcome): string => o.text.slice(0, 600);

// ---- The world.
export interface World {
  tmp: string; home: string; project: string;
  /** The hub's environment, kept for its restart. */
  env: Record<string, string>;
  hub: Hub; mcp: Mcp; provider: Provider;
  /** The paid tool installed: TOOL, or PLANTED_TOOL. */
  tool: string;
  /** The hub's jobs folder, where the call journals are (README, The surface under test, 5). */
  jobs: string;
}
/**
 * A world: a temp home, a real hub (planted when asked), the test provider, a `deep mcp` in the project folder, the
 * test plug-in installed calling that provider (with the planted tool when asked), and your standing rule for its
 * paid tool, so its calls need no ask. Throws, naming what failed, when any of it doesn't come up.
 */
export async function paidWorld(opts: { planted?: boolean; plant?: HubPlant } = {}): Promise<World> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const project = join(tmp, 'proj');
  mkdirSync(home);
  mkdirSync(project);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const env = { DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm'), ...(opts.plant ? { DEEP_HUB_PLANT: opts.plant } : {}) };
  const hub = await startHub(home, env);
  const jobs = join(hub.root, 'jobs');
  const provider = await openProvider(jobs);
  const mcp = await startMcp(home, project);
  const tool = opts.planted ? PLANTED_TOOL : TOOL;
  const w: World = { tmp, home, project, env, hub, mcp, provider, tool, jobs };
  const ran = await run(['install', hostedPlugin(join(tmp, 'hosted'), { planted: opts.planted === true, provider: provider.host })], home, project);
  if (ran.code !== 0) throw Error(`deep install of test/hosted (its tool ${tool} calling ${provider.host}) didn't load it: ${shown(ran)}`);
  await must(w, 'job.rule', { tool, usd: COST });
  return w;
}
/** An input file in the project folder, written now. */
export function input(w: World, name: string, text: string): string {
  const path = join(w.project, name);
  writeFileSync(path, text);
  return path;
}
/** Whether deep_job lists test.hosted with the world's tool within `ms`: the restarted hub is ready to run it. */
async function listed(w: World, ms = 120_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    const o = await runJobList(w.mcp);
    if (!o.isError && Array.isArray(o.value.kinds) && (o.value.kinds as Line[]).some((k) => k.kind === KIND && (k.tools as Line[] | undefined)?.some((t) => t.tool === w.tool))) return true;
    if (Date.now() > deadline) return false;
    await sleep(500);
  }
}
const runJobList = (mcp: Mcp): Promise<Outcome> => beginJob(mcp, { op: 'list' }).outcome;

// ---- The proof, rewritten each run under $TMPDIR/deep-1923-proof/.
export const PROOF_DIR = join(tmpdir(), 'deep-1923-proof');
export function proof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

// ---- Judges: each returns its failures in words; none is a pass. A world that doesn't come up is a failure too.

/**
 * AC1's judge (README, How each criterion is read): with the world's paid tool, one call the provider answers (its
 * key recorded before the request arrived, its task ID after the answer, the key the job's), then one call the hub is
 * SIGKILLed in, after the provider got it and before its answer; the hub started again, the same deep_job twice must
 * make no second call and be BLOCKED with one unblock ask naming the provider and the key.
 */
export async function judgeRetry(planted: boolean): Promise<{ failures: string[]; seen: Line }> {
  const failures: string[] = [];
  const seen: Line = {};
  let w: World;
  try { w = await paidWorld({ planted }); } catch (e) { return { failures: [message(e)], seen }; }
  const P = w.provider.host;
  seen.tool = w.tool;
  seen.provider = P;

  // A call the provider answers.
  let from = w.provider.submissions.length;
  const one = input(w, 'one.txt', 'abc');
  const answered = await runJob(w.mcp, jobArgs(w.tool, one));
  await sleep(500);
  const ones = w.provider.submissions.slice(from).filter((s) => s.text === 'abc');
  seen.answered = { reply: answered.value, calls: ones, journal: journalLines(w.jobs) };
  const s1 = ones[0];
  if (ones.length !== 1 || !s1) failures.push(`the paid run on "abc" made ${ones.length} calls to the provider, not one: ${cut(answered)}`);
  else if (!s1.key) failures.push('the paid call on "abc" reached the provider with no submission key (no Idempotency-Key)');
  else {
    if (!s1.journaled) failures.push(`the submission key ${s1.key} wasn't recorded before the request left the machine: when the provider got the request, no file under ${w.jobs} held {"key":"${s1.key}","provider":"${P}"}`);
    if (!journalLines(w.jobs).some((l) => l.key === s1.key && l.provider === P && l.task === s1.task)) failures.push(`the provider's task ID ${s1.task} wasn't recorded for the key ${s1.key} when it answered: no file under ${w.jobs} holds {"key":"${s1.key}","provider":"${P}","task":"${s1.task}"}`);
    if (done(answered) && receiptOf(answered).key !== s1.key) failures.push(`the submission key ${s1.key} isn't the job's key, ${JSON.stringify(receiptOf(answered).key)}, that its receipt names`);
  }
  if (!done(answered) || outputOf(answered) !== sha256('ABC')) failures.push(`the paid run on "abc" isn't done with the provider's "ABC" by hash: ${cut(answered)}`);

  // A call the hub dies in: the provider holds its answer, and the hub is killed once the request has reached it.
  from = w.provider.submissions.length;
  const two = input(w, 'two.txt', 'xyz');
  w.provider.holdNext();
  const lost = beginJob(w.mcp, jobArgs(w.tool, two));
  const s2 = await w.provider.arrived(from, (s) => s.text === 'xyz', 120_000);
  if (!s2) {
    failures.push(`BLOCKED: the paid run on "xyz" never reached the provider: ${w.mcp.replied(lost.id) ? cut(outcomeOf(w.mcp.replied(lost.id))) : 'no reply yet'}`);
    return { failures, seen };
  }
  const K = s2.key;
  if (!K) failures.push('the paid call on "xyz" reached the provider with no submission key (no Idempotency-Key)');
  else if (!s2.journaled) failures.push(`the submission key ${K} wasn't recorded before the request left the machine: when the provider got the request, no file under ${w.jobs} held {"key":"${K}","provider":"${P}"}`);
  // The record from here on: an unblock ask the new hub raises as it starts counts as much as one a retry raises.
  const pos = await lastPos(w);
  await killHub(w);
  seen.killed = { key: K, journal: journalLines(w.jobs), lost: (await Promise.race([lost.outcome, sleep(70_000).then(() => undefined)]))?.value ?? null };
  try { await restartHub(w); } catch (e) { failures.push(message(e)); return { failures, seen }; }
  if (!(await listed(w))) { failures.push(`BLOCKED: after its restart the hub never listed ${KIND} with ${w.tool}`); return { failures, seen }; }

  // The retry, twice: the same deep_job, so the same key.
  const retries: Outcome[] = [];
  for (let i = 0; i < 2; i += 1) retries.push(await runJob(w.mcp, jobArgs(w.tool, two)));
  await sleep(1000);
  const calls = w.provider.submissions.slice(from).filter((s) => s.text === 'xyz');
  const raised = await asks(w, pos);
  seen.retry = { key: K, calls, replies: retries.map((r) => r.value), asks: raised, journal: journalLines(w.jobs) };
  const named = K ?? '(none sent)';
  if (calls.length > 1) failures.push(`a retry after the hub was killed made a second call to the provider for the key ${named}: ${calls.length} submissions of "xyz" arrived, where the one recorded before the kill must stay the only one`);
  retries.forEach((r, i) => {
    if (r.value.status !== 'BLOCKED' || outputOf(r) !== undefined) failures.push(`retry ${i + 1} with the key ${named}, after the hub was killed between the submission and the provider's answer, isn't BLOCKED with no output: ${cut(r)}`);
  });
  const unblock = raised.filter((a) => a.kind === 'unblock');
  if (unblock.length !== 1) failures.push(`the record holds ${unblock.length} unblock asks from the kill through the two retries, where the BLOCKED job has exactly one: ${JSON.stringify(raised.map((a) => a.kind))}`);
  else {
    const ask = unblock[0]!;
    if (retries.some((r) => r.value.ask !== ask.handle)) failures.push(`the BLOCKED replies don't both name the unblock ask ${ask.handle}: ${JSON.stringify(retries.map((r) => r.value.ask))}`);
    if (!ask.text.includes(P)) failures.push(`the unblock ask doesn't name the provider ${P}: ${ask.text.slice(0, 800)}`);
    if (K && !ask.text.includes(K)) failures.push(`the unblock ask doesn't name the key ${K}: ${ask.text.slice(0, 800)}`);
  }
  return { failures, seen };
}

/**
 * AC2's judge (README, How each criterion is read): three `deep mcp`s, each an agent's. A starts the paid job, which
 * the provider holds; B sends the same deep_job (the same key) and must be left waiting with no call started; B's
 * request is cancelled with MCP's notifications/cancelled, and the job must run on: its request to the provider not
 * dropped, A not answered; C sends it too and must wait; once the provider answers, A gets the job's output, C the same
 * with a receipt saying it joined, B no output, and the provider has had one call. Every failure names the key.
 */
export async function judgeJoin(plant?: HubPlant): Promise<{ failures: string[]; seen: Line; key: string | null }> {
  const failures: string[] = [];
  const seen: Line = {};
  let w: World;
  let B: Mcp;
  let C: Mcp;
  try {
    w = await paidWorld(plant ? { plant } : {});
    B = await startMcp(w.home, w.project);
    C = await startMcp(w.home, w.project);
  } catch (e) { return { failures: [message(e)], seen, key: null }; }
  const file = input(w, 'in.txt', 'abc');
  const args = jobArgs(w.tool, file);
  const from = w.provider.submissions.length;
  const calls = (): Submission[] => w.provider.submissions.slice(from).filter((s) => s.text === 'abc');

  w.provider.holdNext();
  const a = beginJob(w.mcp, args);
  const s = await w.provider.arrived(from, (x) => x.text === 'abc', 120_000);
  if (!s) {
    failures.push(`BLOCKED: the first paid run on "abc" never reached the provider: ${w.mcp.replied(a.id) ? cut(outcomeOf(w.mcp.replied(a.id))) : 'no reply yet'}`);
    return { failures, seen, key: null };
  }
  const K = s.key;
  const named = K ?? '(none sent)';
  if (!K) failures.push('the paid call on "abc" reached the provider with no submission key (no Idempotency-Key)');

  // B: the same deep_job while the first runs.
  const b = beginJob(B, args);
  await sleep(WINDOW_MS);
  const bEarly = B.replied(b.id);
  if (bEarly) failures.push(`the second deep_job with the key ${named}, sent while the first ran, didn't join it: it was answered before the job ended: ${cut(outcomeOf(bEarly))}`);
  // B's request cancelled, as its MCP client cancels it.
  B.notify('notifications/cancelled', { requestId: b.id, reason: 'acceptance #1923: the joining request is cancelled' });
  await sleep(WINDOW_MS);
  if (s.dropped) failures.push(`cancelling the joining request stopped the job for the key ${named}: the tool's request to the provider was dropped before the provider answered`);
  const aEarly = w.mcp.replied(a.id);
  if (aEarly) failures.push(`cancelling the joining request ended the first request for the key ${named} before the provider answered: ${cut(outcomeOf(aEarly))}`);
  // C: the same deep_job once more, after B's cancel, left to finish.
  const c = beginJob(C, args);
  await sleep(WINDOW_MS);
  const cEarly = C.replied(c.id);
  if (cEarly) failures.push(`a deep_job with the key ${named}, sent while the job ran after its other joiner cancelled, didn't join it: it was answered before the job ended: ${cut(outcomeOf(cEarly))}`);

  w.provider.release();
  const ra = await a.outcome;
  const rc = await c.outcome;
  await sleep(1000);
  const rb = B.replied(b.id);
  const n = calls().length;
  seen.join = { key: K, calls: calls(), first: ra.value, joined: rc.value, cancelled: rb ?? null, journal: journalLines(w.jobs) };
  if (n > 1) failures.push(`${n} calls reached the provider for the key ${named} while one job ran: a joining request started a second call`);
  if (!done(ra) || outputOf(ra) !== sha256('ABC')) failures.push(`the first request for the key ${named} wasn't answered with the job's "ABC" by hash once the provider answered: ${cut(ra)}`);
  if (!done(rc) || outputOf(rc) !== sha256('ABC') || receiptOf(rc).key !== K || receiptOf(rc).joined !== true) failures.push(`the joining request for the key ${named} isn't answered with the job's "ABC" by hash and a receipt naming that key with joined: true: ${cut(rc)}`);
  if (rb && done(outcomeOf(rb))) failures.push(`the cancelled joining request for the key ${named} was still answered with the job's outputs: ${cut(outcomeOf(rb))}`);
  return { failures, seen, key: K };
}
