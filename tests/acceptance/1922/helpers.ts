// Test-side tools for the #1922 acceptance tests: a world of a real hub (`deep hub run`) in a temp home, the test
// plug-ins (fixtures/kind, fixtures/more, fixtures/rival, each with the tool program in fixtures/tool) installed with
// `deep install <folder>`, a `deep mcp` started in the world's project folder and spoken to as an agent's MCP client
// does, the hub's socket as the cli role (your trusted path, the OS confirmation stubbed by DEEP_HUB_TEST_CONFIRM),
// `deep inbox answer`, the record's process.starting events for process counts, and the judges a criterion's test
// and its planted hub share. No hub, CLI or extension-host module is imported but the extension host's public entry,
// for `packageDigest` only.
//
// Safety: every folder is under /tmp/dh1922-* and removed after its file; HOME is a temp home for every child;
// DEEP_*, CLAUDE*, CODEX* and NODE_OPTIONS are left out of their environment; nothing leaves 127.0.0.1; no model is
// called; every process is one this file started, stopped by its PID.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** The kind, its check, its holder and its first tool, as the issue and README name them. */
export const KIND = 'test.upper';
export const CHECK = 'test.upper_only';
export const HOLDER = 'test/upper-kind';
export const TOOL_A = 'upper-a@1.0.0';
/** The criterion's params (AC5) as JSON text, the way deep_job takes them. */
export const BASE_PARAMS = '{"case":"upper","trim":false}';
/** The kind's qualification fixtures (fixtures/kind/index.ts.fixture), by name. */
export const FIXTURE_NAMES = ['fx-greeting', 'fx-sentence', 'fx-route'];

/** The planted hubs this suite selects with DEEP_HUB_PLANT (README, Plants). */
export type HubPlant = 'job-key-params-text' | 'job-key-no-version' | 'job-build-entry-only' | 'job-build-hashes-paths' | 'job-build-hashes-mtimes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };

// ---- Temp folders and processes, all gone after the file.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1922-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
afterAll(async () => {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
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
/** What a command said, both streams. */
export const said = (r: Ran) => `${r.stdout}\n${r.stderr}`;
function run(args: readonly string[], home: string, cwd: string): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

// ---- The test plug-ins: a fixture folder copied, `*.fixture` renamed, the tool's two files laid in ./tool, its
// probe and manifest written, its digest set by the extension host's packageDigest.
const { packageDigest } = await import(new URL('../../../packages/extension-host/src/index.ts', import.meta.url).href) as typeof import('../../../packages/extension-host/src/index.ts');
function unfixture(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (lstatSync(path).isDirectory()) unfixture(path);
    else if (name.endsWith('.fixture')) renameSync(path, join(dir, name.slice(0, -'.fixture'.length)));
  }
}
/** The tool's two files: upper.mjs, its entry, and case.mjs, its second file (the planted one's, or one byte changed). */
function layTool(dir: string, opts: { lowlast?: boolean; mark?: string } = {}): void {
  mkdirSync(join(dir, 'tool'));
  writeFileSync(join(dir, 'tool', 'upper.mjs'), readFileSync(join(FIXTURES, 'tool', 'upper.mjs.fixture')));
  const second = readFileSync(join(FIXTURES, 'tool', opts.lowlast ? 'lowlast-case.mjs.fixture' : 'case.mjs.fixture'), 'utf8');
  // One byte changed (AC6): the mark in a comment, so what the tool does stays the same.
  const marked = opts.mark ? second.replace('build mark: a', `build mark: ${opts.mark}`) : second;
  if (opts.mark && marked === second) throw Error('the tool fixture has no build mark to change');
  writeFileSync(join(dir, 'tool', 'case.mjs'), marked);
}
function seal(dir: string, edit: (m: Line) => void): string {
  const path = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Line;
  edit(manifest);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
/** test/upper-kind: the kind test.upper, its check test.upper_only and its first tool upper-a@1.0.0. */
export function kindPlugin(dir: string): string {
  cpSync(join(FIXTURES, 'kind'), dir, { recursive: true });
  unfixture(dir);
  layTool(dir);
  return seal(dir, () => undefined);
}
export interface ToolPlan { id?: string; tool?: string; version?: string; cost?: { usd: number }; lowlast?: boolean; mark?: string }
/** A plug-in that adds one tool to test.upper (fixtures/more): test/upper-more's upper-b@1.0.0 unless the plan says otherwise. */
export function toolPlugin(dir: string, plan: ToolPlan = {}): string {
  const id = plan.id ?? 'test/upper-more';
  const tool = plan.tool ?? 'upper-b';
  const version = plan.version ?? '1.0.0';
  cpSync(join(FIXTURES, 'more'), dir, { recursive: true });
  unfixture(dir);
  layTool(dir, plan);
  writeFileSync(join(dir, 'probe.json'), `${JSON.stringify({ tool, version, ...(plan.cost ? { cost: plan.cost } : {}) })}\n`);
  return seal(dir, (m) => { m.id = id; m.version = version; m.job_tools = [{ kind: KIND, tool: `${tool}@${version}` }]; });
}
/** A second registration of test.upper (fixtures/rival): test/upper-rival, or test/upper-heir whose manifest replaces it. */
export function rivalPlugin(dir: string, replaces: boolean): string {
  cpSync(join(FIXTURES, 'rival'), dir, { recursive: true });
  unfixture(dir);
  return seal(dir, (m) => {
    if (replaces) { m.id = 'test/upper-heir'; m.replaces = [KIND]; }
  });
}
/** A tool's build as the README reads it: packageDigest of its folder (`run.dir`, ./tool), files and modes as installed. */
export const toolBuild = (plugin: string): string => packageDigest(join(plugin, 'tool'));
/** A plug-in folder copied elsewhere, every file's modified time set to another one, bytes and modes kept. */
export function copyElsewhere(from: string, to: string): string {
  cpSync(from, to, { recursive: true });
  const when = new Date('2001-02-03T04:05:06Z');
  const touch = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (lstatSync(path).isDirectory()) touch(path);
      utimesSync(path, when, when);
    }
  };
  touch(to);
  return to;
}

// ---- The hub.
interface Hub { pid: number; socket: string; root: string; child: ChildProcess }
async function startHub(home: string, env: Record<string, string>): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
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
/** A cli call that must succeed: its result; a method the hub doesn't serve reads BLOCKED. */
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
/** The record's last log position. */
export async function lastPos(w: World): Promise<number> {
  const all = await events(w);
  return all.length ? Math.max(...all.map((e) => Number(e.log_pos))) : 0;
}
const dataOf = (e: Line): Line => (typeof e.data === 'string' ? parse(e.data) ?? {} : e.data ?? {});
/** The asks raised in the record after `after`, oldest first, each `{handle, kind, text, data}`. */
export async function asks(w: World, after = 0): Promise<{ handle: string; kind: string; text: string; data: Line }[]> {
  return (await events(w, after)).filter((e) => e.kind === 'ask.created').map((e) => ({ handle: `ask:${String(e.id)}`, kind: String(dataOf(e).kind), text: JSON.stringify(dataOf(e)), data: dataOf(e) }));
}
/** Your yes to an ask, on the trusted path: `deep inbox answer <ask> <the option whose decision is allow>`. */
export async function yes(w: World, ask: { handle: string; data: Line }): Promise<Ran> {
  const option = (ask.data.options as Line[] | undefined)?.find((o) => o.decision === 'allow')?.id;
  if (typeof option !== 'string') throw Error(`${ask.handle} has no option that says yes: ${JSON.stringify(ask.data.options)}`);
  return run(['inbox', 'answer', ask.handle, option], w.home, w.project);
}
/** The evidence store's entry for a hash (evidence.read), or undefined when it holds none. */
export async function stored(w: World, sha: string): Promise<Line | undefined> {
  const reply = await control(w, 'evidence.read', { sha });
  return reply.error ? undefined : (reply.result?.evidence as Line | undefined) ?? (reply.result as Line | undefined);
}

// ---- deep mcp, as an agent's MCP client talks to it.
export interface Outcome { isError: boolean; value: Line; text: string }
class Mcp {
  private lines: string[] = [];
  private wakers = new Set<() => void>();
  private n = 0;
  constructor(readonly child: ChildProcess) {
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { this.lines.push(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
      for (const w of [...this.wakers]) w();
    });
    child.stdin!.on('error', () => undefined);
  }
  request(method: string, params: Line, timeoutMs = 300_000): Promise<Line> {
    const id = ++this.n;
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.wakers.delete(check); reject(Error(`deep mcp gave no reply to ${method} in ${timeoutMs} ms`)); }, timeoutMs);
      const check = () => {
        const found = this.lines.map((l) => parse(l)).find((l) => l?.id === id);
        if (found) { clearTimeout(timer); this.wakers.delete(check); resolve(found); }
        else if (this.child.exitCode !== null) { clearTimeout(timer); this.wakers.delete(check); reject(Error(`deep mcp exited ${this.child.exitCode}`)); }
      };
      this.wakers.add(check);
      check();
    });
  }
  notify(method: string): void { this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params: {} })}\n`); }
  /** Stops this deep mcp by its PID and waits for it to end. */
  async stop(): Promise<void> {
    if (this.child.exitCode !== null || !this.child.pid) return;
    const ended = new Promise<void>((resolve) => this.child.once('exit', () => resolve()));
    this.child.kill('SIGTERM');
    await Promise.race([ended, sleep(5000)]);
    if (this.child.exitCode === null) { this.child.kill('SIGKILL'); await ended; }
  }
}
async function startMcp(home: string, cwd: string): Promise<Mcp> {
  const child = spawn(NODE, [CLI, 'mcp'], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'ignore'] });
  if (child.pid) owned.add(child.pid);
  const mcp = new Mcp(child);
  const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1922', version: '0' } });
  if (!init.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(init)}`);
  mcp.notify('notifications/initialized');
  return mcp;
}
/** One deep_job call through deep mcp. */
export async function job(w: World, args: Line): Promise<Outcome> {
  const reply = await w.mcp.request('tools/call', { name: 'deep_job', arguments: args });
  if (reply.error) return { isError: true, value: reply.error as Line, text: JSON.stringify(reply.error) };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? String(result.content.find((c: Line) => c?.type === 'text')?.text ?? '') : '';
  const value = (result.structuredContent ?? parse(text) ?? {}) as Line;
  return { isError: result.isError === true, value, text: text || JSON.stringify(value) };
}
/** deep_job's list: the registered kinds; a reply with no `kinds` list fails, naming the reply. */
export async function listKinds(w: World): Promise<Line[]> {
  const o = await job(w, { op: 'list' });
  if (o.isError || !Array.isArray(o.value.kinds)) throw Error(`deep_job {op: list} gave no kinds: ${o.text.slice(0, 1500)}`);
  return o.value.kinds as Line[];
}
/** The listed tools of a kind, by name@version: each `{tool, plugin, build}`. */
export async function toolsOf(w: World, kind = KIND): Promise<Line[]> {
  return ((await listKinds(w)).find((k) => k.kind === kind)?.tools as Line[] | undefined) ?? [];
}
export interface Run { outcome: Outcome; started: number }
/**
 * One deep_job run of test.upper on one input file, and the processes it started: the process.starting events the
 * record gained from just before the call until 500 ms after its reply.
 */
export async function runJob(w: World, tool: string | null, params: string | null, input: string): Promise<Run> {
  return counted(w, () => job(w, { op: 'run', kind: KIND, tool, params, inputs: [{ name: 'text', path: input }] }));
}
export async function counted(w: World, call: () => Promise<Outcome>): Promise<Run> {
  const before = await lastPos(w);
  const outcome = await call();
  await sleep(500);
  const started = (await events(w, before)).filter((e) => e.kind === 'process.starting').length;
  return { outcome, started };
}
/** Whether a run is done: no error and status done. */
export const done = (o: Outcome): boolean => !o.isError && o.value.status === 'done';
/** The run's text output, by hash. */
export const outputOf = (o: Outcome): string | undefined => o.value.outputs?.text?.sha256;
export const receiptOf = (o: Outcome): Line => (o.value.receipt ?? {}) as Line;
/** A refusal: a tool error, or a reply whose status is refused. */
export const refused = (o: Outcome): boolean => o.isError || o.value.status === 'refused';
/** How a run read, for a failure's words. */
export const brief = (r: Run): string => `${r.started} process${r.started === 1 ? '' : 'es'} started; reply ${r.outcome.text.slice(0, 600)}`;

// ---- The world.
export interface World {
  tmp: string; home: string; hub: Hub; mcp: Mcp;
  /** The project folder: deep mcp's working folder, where the inputs are. */
  project: string;
}
export async function openWorld(plant?: HubPlant): Promise<World> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const project = join(tmp, 'proj');
  mkdirSync(home);
  mkdirSync(project);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const hub = await startHub(home, { DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm'), ...(plant ? { DEEP_HUB_PLANT: plant } : {}) });
  const mcp = await startMcp(home, project);
  return { tmp, home, hub, mcp, project };
}
/** `deep install <folder>`, as you, confirmed by the stubbed OS. */
export const install = (w: World, folder: string): Promise<Ran> => run(['install', folder], w.home, w.project);
/** An install that must load: a refusal fails, naming the plug-in and what the install said. */
export async function mustInstall(w: World, folder: string): Promise<Ran> {
  const ran = await install(w, folder);
  const id = (JSON.parse(readFileSync(join(folder, 'deepbuild.json'), 'utf8')) as Line).id;
  if (ran.code !== 0) throw Error(`deep install of ${String(id)} didn't load it: ${shown(ran)}`);
  return ran;
}
/** A world with test/upper-kind installed. */
export async function kindWorld(plant?: HubPlant): Promise<World> {
  const w = await openWorld(plant);
  await mustInstall(w, kindPlugin(join(w.tmp, 'kind')));
  return w;
}
/** An input file in the project folder, written now. */
export function input(w: World, name: string, text: string): string {
  const path = join(w.project, name);
  writeFileSync(path, text);
  return path;
}
/** The project folder moved: deep mcp stopped, the folder renamed, deep mcp started again in its new place. */
export async function moveProject(w: World, to: string): Promise<void> {
  await w.mcp.stop();
  renameSync(w.project, to);
  w.project = to;
  w.mcp = await startMcp(w.home, to);
}
/** Every file under a folder: its path, bytes' hash and modified time. */
export function snapshot(dir: string): { path: string; sha256: string; mtimeMs: number }[] {
  const out: { path: string; sha256: string; mtimeMs: number }[] = [];
  const walk = (at: string, prefix: string): void => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path, `${prefix}${name}/`);
      else out.push({ path: `${prefix}${name}`, sha256: sha256(readFileSync(path)), mtimeMs: stat.mtimeMs });
    }
  };
  walk(dir, '');
  return out;
}

// ---- The proof, rewritten each run under $TMPDIR/deep-1922-proof/.
export const PROOF_DIR = join(tmpdir(), 'deep-1922-proof');
export function proof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

// ---- Judges: each returns its failures in words; none is a pass.

/** Whether a text names a build: its 64 hex digits, or at least their first 12. */
export const namesBuild = (text: string, build: string): boolean => text.includes(build.replace(/^d1:/, '').slice(0, 12));

interface KeyCase { label: string; part: string; expect: 'hit' | 'miss'; text: string; prepare: (w: World, at: { file: string }) => Promise<{ tool: string; params: string; file: string }> }
/**
 * AC5's judge, in a world with test/upper-kind and test/upper-more (upper-b@1.0.0) installed: the base run, then five
 * changes that must each hit and start no process, then three that must each miss and start one, each failure naming
 * the case and the key's part it is about.
 */
export async function judgeKey(w: World): Promise<{ failures: string[]; runs: Line[] }> {
  const failures: string[] = [];
  const runs: Line[] = [];
  const TOOL = 'upper-b@1.0.0';
  const at = { file: input(w, 'in.txt', 'abc') };
  const base = await runJob(w, TOOL, BASE_PARAMS, at.file);
  runs.push({ case: 'base', started: base.started, reply: base.outcome.value });
  if (!done(base.outcome) || outputOf(base.outcome) !== sha256('ABC') || base.started !== 1) {
    return { failures: [`the base run of ${TOOL} on "abc" with ${BASE_PARAMS} isn't a miss that starts one process and returns "ABC" by hash: ${brief(base)}`], runs };
  }
  const key = receiptOf(base.outcome).key;
  const cases: KeyCase[] = [
    { label: 'reordering the params\' keys', part: 'the params, canonical (keys sorted)', expect: 'hit', text: 'ABC', prepare: async () => ({ tool: TOOL, params: '{"trim":false,"case":"upper"}', file: at.file }) },
    { label: 'omitting trim', part: 'the params, canonical (every default written out)', expect: 'hit', text: 'ABC', prepare: async () => ({ tool: TOOL, params: '{"case":"upper"}', file: at.file }) },
    {
      label: 're-saving the input with a new modified time', part: 'the input\'s bytes by hash, never a modified time', expect: 'hit', text: 'ABC',
      prepare: async () => { writeFileSync(at.file, 'abc'); const later = new Date(Date.now() + 3_600_000); utimesSync(at.file, later, later); return { tool: TOOL, params: BASE_PARAMS, file: at.file }; },
    },
    {
      label: 'renaming the input file', part: 'the input\'s bytes by hash, never a file name', expect: 'hit', text: 'ABC',
      prepare: async () => { const to = join(dirname(at.file), 'renamed.txt'); renameSync(at.file, to); at.file = to; return { tool: TOOL, params: BASE_PARAMS, file: to }; },
    },
    {
      label: 'moving the project folder', part: 'the input\'s bytes by hash, never a path', expect: 'hit', text: 'ABC',
      prepare: async (world) => { await moveProject(world, join(world.tmp, 'proj-moved')); at.file = join(world.project, 'renamed.txt'); return { tool: TOOL, params: BASE_PARAMS, file: at.file }; },
    },
    { label: 'a changed input byte', part: 'the input\'s bytes by hash', expect: 'miss', text: 'ABD', prepare: async () => { writeFileSync(at.file, 'abd'); return { tool: TOOL, params: BASE_PARAMS, file: at.file }; } },
    { label: 'trim: true', part: 'the params, canonical', expect: 'miss', text: 'ABC', prepare: async () => { writeFileSync(at.file, 'abc'); return { tool: TOOL, params: '{"case":"upper","trim":true}', file: at.file }; } },
    {
      label: 'a bump of the tool\'s version', part: 'the tool\'s name@version', expect: 'miss', text: 'ABC',
      prepare: async (world) => {
        writeFileSync(at.file, 'abc');
        const bumped = await install(world, toolPlugin(join(world.tmp, 'more-1.0.1'), { version: '1.0.1' }));
        if (bumped.code !== 0) throw Error(`deep install of test/upper-more 1.0.1 (upper-b@1.0.1) didn't load it: ${shown(bumped)}`);
        return { tool: 'upper-b@1.0.1', params: BASE_PARAMS, file: at.file };
      },
    },
  ];
  for (const c of cases) {
    const { tool, params, file } = await c.prepare(w, at);
    const r = await runJob(w, tool, params, file);
    runs.push({ case: c.label, tool, params, file, started: r.started, reply: r.outcome.value });
    const rec = receiptOf(r.outcome);
    if (!done(r.outcome)) { failures.push(`${c.label}: the run isn't done (${brief(r)}); the key's part: ${c.part}`); continue; }
    if (outputOf(r.outcome) !== sha256(c.text)) failures.push(`${c.label}: the output by hash is ${String(outputOf(r.outcome))}, not "${c.text}"'s ${sha256(c.text)}; the key's part: ${c.part}`);
    if (c.expect === 'hit') {
      if (r.started !== 0 || rec.cache !== 'hit' || rec.key !== key) failures.push(`${c.label}: must hit the cache and start no process, as the key holds only ${c.part}; it read cache ${JSON.stringify(rec.cache)}, key ${JSON.stringify(rec.key)} (the base's ${JSON.stringify(key)}), ${r.started} processes started`);
    } else if (r.started !== 1 || rec.cache !== 'miss' || rec.key === key) {
      failures.push(`${c.label}: must miss the cache and start one process, as the key holds ${c.part}; it read cache ${JSON.stringify(rec.cache)}, key ${JSON.stringify(rec.key)} (the base's ${JSON.stringify(key)}), ${r.started} processes started${rec.cache === 'hit' ? ', serving the old output' : ''}`);
    }
  }
  return { failures, runs };
}

/**
 * AC6's judge, in a world with test/upper-kind installed: test/upper-more's upper-b@1.0.0 installed and run on "abc";
 * installed again under the same version with one byte changed in tool/case.mjs, its second file, which must be
 * refused naming the tool and both builds, with "abc" still a hit that starts no process; then under 1.0.1, which must
 * qualify and join with the changed build and miss "abc" once.
 */
export async function judgeRebuild(w: World): Promise<{ failures: string[]; seen: Line }> {
  const failures: string[] = [];
  const seen: Line = {};
  const first = toolPlugin(join(w.tmp, 'more-1'));
  await mustInstall(w, first);
  const old = toolBuild(first);
  const file = input(w, 'in.txt', 'abc');
  const miss = await runJob(w, 'upper-b@1.0.0', BASE_PARAMS, file);
  seen.first = { started: miss.started, reply: miss.outcome.value };
  if (!done(miss.outcome) || outputOf(miss.outcome) !== sha256('ABC')) return { failures: [`upper-b@1.0.0 on "abc" isn't done with "ABC" by hash: ${brief(miss)}`], seen };

  const changed = toolPlugin(join(w.tmp, 'more-2'), { mark: 'b' });
  const next = toolBuild(changed);
  if (next === old) throw Error('harness: the changed tool\'s build equals the first; the byte didn\'t change');
  const again = await install(w, changed);
  seen.again = { old, next, ran: again };
  if (again.code === 0) {
    failures.push(`upper-b@1.0.0 installed again under the same version with one byte changed in tool/case.mjs, its second file, was accepted: its build (${old} before) must count tool/case.mjs, whose change makes it ${next}`);
  } else {
    const text = said(again);
    if (!text.includes('upper-b')) failures.push(`the refused install doesn't name the tool upper-b@1.0.0: ${shown(again)}`);
    if (!namesBuild(text, old) || !namesBuild(text, next)) failures.push(`the refused install of upper-b@1.0.0 doesn't name both builds, ${old} and ${next}: ${shown(again)}`);
  }
  const hit = await runJob(w, 'upper-b@1.0.0', BASE_PARAMS, file);
  seen.hit = { started: hit.started, reply: hit.outcome.value };
  if (!done(hit.outcome) || hit.started !== 0 || receiptOf(hit.outcome).cache !== 'hit') failures.push(`after the second install, upper-b@1.0.0 on "abc" must still be a cache hit that starts no process: ${brief(hit)}`);

  const bumped = toolPlugin(join(w.tmp, 'more-3'), { mark: 'b', version: '1.0.1' });
  if (toolBuild(bumped) !== next) throw Error('harness: the 1.0.1 tool\'s files differ from the changed 1.0.0\'s');
  const joined = await install(w, bumped);
  seen.joined = joined;
  if (joined.code !== 0) { failures.push(`the changed tool under the next version, upper-b@1.0.1, must qualify and join: ${shown(joined)}`); return { failures, seen }; }
  const listed = (await toolsOf(w)).find((t) => t.tool === 'upper-b@1.0.1');
  seen.listed = listed;
  if (!listed) failures.push('upper-b@1.0.1 doesn\'t appear in deep_job\'s list after its install');
  else if (listed.build !== next) failures.push(`upper-b@1.0.1 is listed with the build ${JSON.stringify(listed.build)}, not its files' ${next}`);
  const once = await runJob(w, 'upper-b@1.0.1', BASE_PARAMS, file);
  const twice = await runJob(w, 'upper-b@1.0.1', BASE_PARAMS, file);
  seen.next = [{ started: once.started, reply: once.outcome.value }, { started: twice.started, reply: twice.outcome.value }];
  if (!done(once.outcome) || once.started !== 1 || receiptOf(once.outcome).cache !== 'miss' || outputOf(once.outcome) !== sha256('ABC')) failures.push(`upper-b@1.0.1 on "abc" must miss once, starting one process, and return "ABC": ${brief(once)}`);
  else if (receiptOf(once.outcome).build !== next) failures.push(`upper-b@1.0.1's receipt names the build ${JSON.stringify(receiptOf(once.outcome).build)}, not its files' ${next}`);
  if (!done(twice.outcome) || twice.started !== 0 || receiptOf(twice.outcome).cache !== 'hit') failures.push(`upper-b@1.0.1 on "abc" again must hit, starting no process (it misses once): ${brief(twice)}`);
  return { failures, seen };
}

/**
 * AC7's judge, in a world with test/upper-kind installed: test/upper-more installed from one folder, its receipt for
 * "abc" naming the build its files' digest gives; the same files installed from a second folder, with other modified
 * times, must be taken as the same build, listed once, and named by the next receipt.
 */
export async function judgeBuild(w: World): Promise<{ failures: string[]; seen: Line }> {
  const TOOL = 'upper-b@1.0.0';
  const failures: string[] = [];
  const seen: Line = {};
  const first = toolPlugin(join(w.tmp, 'one'));
  await mustInstall(w, first);
  const build = toolBuild(first);
  seen.build = build;
  const file = input(w, 'in.txt', 'abc');
  const a = await runJob(w, TOOL, BASE_PARAMS, file);
  seen.first = a.outcome.value;
  if (!done(a.outcome)) return { failures: [`${TOOL} on "abc" isn't done: ${brief(a)}`], seen };
  if (receiptOf(a.outcome).build !== build) failures.push(`${TOOL}'s receipt for "abc" names the build ${JSON.stringify(receiptOf(a.outcome).build)}; the digest of its files as installed is ${build}`);

  mkdirSync(join(w.tmp, 'elsewhere', 'deeper'), { recursive: true });
  const second = copyElsewhere(first, join(w.tmp, 'elsewhere', 'deeper', 'two'));
  if (toolBuild(second) !== build) throw Error('harness: the copied tool\'s files digest differently');
  const again = await install(w, second);
  seen.again = again;
  if (again.code !== 0) { failures.push(`${TOOL}'s same files, installed from a second folder with other modified times, were refused, so the host recorded two builds for one tool: ${shown(again)}`); return { failures, seen }; }
  const listed = (await toolsOf(w)).filter((t) => t.tool === TOOL);
  seen.listed = listed;
  const builds = [...new Set(listed.map((t) => String(t.build)))];
  if (builds.length !== 1 || builds[0] !== build) failures.push(`after ${TOOL} was installed from two folders, deep_job lists its builds as ${JSON.stringify(builds)}; the one build of its files is ${build}`);
  const b = await runJob(w, TOOL, BASE_PARAMS, file);
  seen.second = b.outcome.value;
  if (!done(b.outcome)) failures.push(`${TOOL} on "abc" after the second install isn't done: ${brief(b)}`);
  else if (receiptOf(b.outcome).build !== build) failures.push(`${TOOL}'s receipt after the second install names the build ${JSON.stringify(receiptOf(b.outcome).build)}, not ${build}, the one its files have`);
  return { failures, seen };
}
