// Test-side tools for the #1819 acceptance tests: a world of a real hub (`deep hub run`) in a temp home whose evidence
// store already holds the fixture's audio and text (put there as yours before the hub starts), the first-party
// plug-in deepbuild/bakes installed from packages/jobs/bakes with `deep install`, its model host started on this
// machine with the design's run line, a `deep mcp` spoken to as an agent's MCP client for deep_job, the hub's socket as
// the cli role for the record's asks and your yes, and `deep-show run` (built once per file) for `media_bake`, its
// evidence folder the hub's evidence store, so the PCM a bake keeps is what the job takes by hash and the record the
// job keeps is what the bake reads. Nothing here stands in for an analyzer or a bake: every reading is what the hub
// and deep-show answer; the truth each judge holds them to comes from the fixtures (fixtures/synth.ts).
//
// Safety: every folder is under /tmp/dh1819-* and removed after its file; the hub, `deep` commands and `deep mcp` run
// with HOME in the world's temp folder and without the caller's DEEP_*, CLAUDE*, CODEX*, NODE_OPTIONS; the model host
// runs with your HOME (its weights are cached there) and without DEEP_*. Every process is one this file started,
// stopped by its PID (the model host by the process group it leads); nothing is stopped by name or port. Nothing leaves
// 127.0.0.1 but the model host's first fetch of its own pinned weights.
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { FLICKS, sha256 } from './fixtures/synth.ts';

export { FLICKS, sha256 };
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;
/** The first-party plug-in, its model host's script and the port its manifest names (Analysis bake). */
export const BAKES = join(REPO, 'packages/jobs/bakes');
const HOST_SCRIPT = 'packages/jobs/bakes/host/host.py';
export const PORT = 8719;
/** The pinned tools, each its kind's analyzer. */
export const ALIGNER = 'charsiu-aligner@1.0.0';
export const TRACKER = 'beat-this@1.1.0';
export const VAD = 'silero-vad@6.2.3';
export const JOB = { words: 'bake.words', beats: 'bake.beats', activity: 'bake.activity' } as const;
/** Every test passes this: a first start of the model host fetches its weights, and a first build of deep-show is long. */
export const TIMEOUT = 3_600_000;
export const MS = FLICKS / 1000;

/** Each criterion's ID (scripts/proof-change.mjs: `#<issue>.<8 hex of the text's sha256>`), which starts its test's name. */
export const AC = {
  1: 'AC1 #1819.d6311ec9',
  2: 'AC2 #1819.1e90e26a',
  3: 'AC3 #1819.78820a4a',
  4: 'AC4 #1819.9d92b582',
  5: 'AC5 #1819.faf43058',
} as const;

/** The planted programs (README, Planted programs): deep-show's are named in the scenario, the hub's by DEEP_HUB_PLANT. */
export type ShowPlant = 'beats_fixed_120' | 'activity_level_threshold' | 'visemes_no_lead';
export type HubPlant = 'job-host-down-done';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };
/** A time in flicks as seconds, for failures. */
export const sec = (flicks: number): string => `${(flicks / FLICKS).toFixed(3)} s`;

// ---- Temp folders and processes, all gone after the file.
const made: string[] = [];
function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1819-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
const groups = new Set<number>();
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
afterAll(async () => {
  for (const pid of groups) try { process.kill(-pid, 'SIGTERM'); } catch { /* gone */ }
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of groups) try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  groups.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}, 30_000);

function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT|TMUX)/.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_EXTRA_CA_CERTS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}
interface Ran { code: number | null; stdout: string; stderr: string }
const shown = (r: Ran) => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
function deep(args: readonly string[], home: string, cwd: string): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    // An install qualifies three model tools on the host: allow it time.
    const timer = setTimeout(() => child.kill('SIGKILL'), 1_800_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

// ---- deep-show, built once per file (`cargo build --locked --bin deep-show`, honoring CARGO_TARGET_DIR), as #500's
// bake suite builds it, with rustup's cargo on PATH.
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
export function useShow(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1819-bin-'));
    const env = { ...process.env, CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0', ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env.PATH ?? ''}` } : {}) };
    const run = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo build --locked --bin deep-show failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(0, 4000)}`;
    else copyFileSync(join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', 'deep-show'), join(dir, 'deep-show'));
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    expect(error, 'deep-show builds: cargo build --locked --bin deep-show').toBe('');
    return join(dir, 'deep-show');
  };
}

// ---- The hub.
interface Hub { pid: number; socket: string; root: string }
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
  const plant = env.DEEP_HUB_PLANT;
  expect(ready?.ready, `the hub starts${plant ? ` with DEEP_HUB_PLANT=${plant}, a planted program this suite names (README, Planted programs)` : ''}: ${out.slice(0, 500)} ${err.slice(-1500)}`).toBe(true);
  return { pid: child.pid!, socket: typeof ready!.socket === 'string' ? ready!.socket : join(home, '.deepbuild', 'hub.sock'), root: join(home, '.deepbuild') };
}
/** One call on the hub's socket as the cli role, with the control token and this process for the peer check. */
async function control(w: World, method: string, params: Line, timeoutMs = 60_000): Promise<Line> {
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
/** The hub's record after log position `after`, through events.read on the cli role. */
async function events(w: World, after = 0): Promise<Line[]> {
  const all: Line[] = [];
  for (let from = after; ;) {
    const reply = await control(w, 'events.read', { after: from, limit: 1000 });
    if (reply.error) throw Error(`BLOCKED: events.read was refused: ${JSON.stringify(reply.error)}`);
    const page = reply.result.events as Line[];
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
export interface Ask { handle: string; kind: string; text: string; data: Line }
/** The asks raised in the record after `after`, oldest first. */
export async function asks(w: World, after = 0): Promise<Ask[]> {
  return (await events(w, after)).filter((e) => e.kind === 'ask.created').map((e) => ({ handle: `ask:${String(e.id)}`, kind: String(dataOf(e).kind), text: JSON.stringify(dataOf(e)), data: dataOf(e) }));
}
/** Your yes to an ask, on the trusted path: `deep inbox answer <ask> <the option whose decision is allow>`. */
async function yes(w: World, ask: Ask): Promise<Ran> {
  const option = (ask.data.options as Line[] | undefined)?.find((o) => o.decision === 'allow')?.id;
  if (typeof option !== 'string') return { code: null, stdout: '', stderr: `${ask.handle} has no option whose decision is allow: ${JSON.stringify(ask.data.options)}` };
  return deep(['inbox', 'answer', ask.handle, option], w.home, w.project);
}

// ---- deep mcp, as an agent's MCP client talks to it (deep_job binds no session).
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
  request(method: string, params: Line, timeoutMs = 1_800_000): Promise<Line> {
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
}
async function startMcp(home: string, cwd: string): Promise<Mcp> {
  const child = spawn(NODE, [CLI, 'mcp'], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'ignore'] });
  if (child.pid) owned.add(child.pid);
  const mcp = new Mcp(child);
  const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1819', version: '0' } });
  if (!init.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(init)}`);
  mcp.notify('notifications/initialized');
  return mcp;
}
async function deepJob(w: World, args: Line): Promise<Outcome> {
  const reply = await w.mcp.request('tools/call', { name: 'deep_job', arguments: args });
  if (reply.error) return { isError: true, value: reply.error as Line, text: JSON.stringify(reply.error) };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? String(result.content.find((c: Line) => c?.type === 'text')?.text ?? '') : '';
  const value = (result.structuredContent ?? parse(text) ?? {}) as Line;
  return { isError: result.isError === true, value, text: text || JSON.stringify(value) };
}

// ---- The model host, as the design runs it: `uv run --script packages/jobs/bakes/host/host.py --port 8719`.
async function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (v: boolean) => { sock.destroy(); resolve(v); };
    sock.setTimeout(1000, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}
interface ModelHost { pid: number; child: ChildProcess; tail: () => string }
/**
 * The model host started from the checkout with the design's run line and your HOME, waited on until it answers on
 * 127.0.0.1:8719 (its first start fetches its weights). A host this suite didn't start already answering there, or this
 * one exiting or not answering in 30 minutes, is BLOCKED: the suite never stops a process it didn't start.
 */
async function startModelHost(): Promise<ModelHost> {
  if (await answers(PORT)) throw Error(`BLOCKED: something this suite didn't start already answers on 127.0.0.1:${PORT}, the port deepbuild/bakes names for its model host (another worktree's host?); stop it yourself and run again`);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^DEEP_/.test(key) && key !== 'NODE_OPTIONS') env[key] = value;
  env.PATH = `/opt/homebrew/bin:${process.env.PATH ?? '/usr/bin:/bin'}`;
  const child = spawn('uv', ['run', '--script', HOST_SCRIPT, '--port', String(PORT)], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) { owned.add(child.pid); groups.add(child.pid); }
  let out = '';
  const keep = (d: string) => { out = (out + d).slice(-4000); };
  child.stdout!.setEncoding('utf8').on('data', keep);
  child.stderr!.setEncoding('utf8').on('data', keep);
  let exited = false;
  child.on('exit', () => { exited = true; });
  child.on('error', (e) => { exited = true; keep(e.message); });
  for (const deadline = Date.now() + 1_800_000; ;) {
    if (await answers(PORT)) break;
    if (exited) throw Error(`BLOCKED: the model host (uv run --script ${HOST_SCRIPT} --port ${PORT}) exited before it answered on 127.0.0.1:${PORT}: ${out.slice(-2000)}`);
    if (Date.now() > deadline) throw Error(`BLOCKED: the model host didn't answer on 127.0.0.1:${PORT} within 30 minutes: ${out.slice(-2000)}`);
    await sleep(1000);
  }
  return { pid: child.pid!, child, tail: () => out };
}
/** The host stopped by the process group it leads, and waited on until the port no longer answers. */
async function stopModelHost(h: ModelHost): Promise<void> {
  const ended = new Promise<void>((resolve) => { if (h.child.exitCode !== null || h.child.signalCode !== null) resolve(); else h.child.once('exit', () => resolve()); });
  try { process.kill(-h.pid, 'SIGTERM'); } catch { /* gone */ }
  await Promise.race([ended, sleep(10_000)]);
  try { process.kill(-h.pid, 'SIGKILL'); } catch { /* gone */ }
  groups.delete(h.pid);
  for (const deadline = Date.now() + 30_000; await answers(PORT);) {
    if (Date.now() > deadline) throw Error(`the model host this suite started (process group ${h.pid}) still answers on 127.0.0.1:${PORT} after it was stopped`);
    await sleep(250);
  }
}

// ---- The world.
export interface World {
  tmp: string; home: string; hub: Hub; mcp: Mcp; project: string;
  /** The hub's evidence store, which deep-show run reads and keeps by hash too. */
  evidence: string;
  host?: ModelHost;
}
/** A license that lets your file leave every way the store knows. */
const YOURS = { name: 'yours', allows: ['export', 'report', 'post'] as const };
/**
 * A world: a temp home whose evidence store holds `files` (your recordings and texts, put there before the hub starts
 * by a writer connected as you dropping them in), a real hub (DEEP_HUB_TEST_CONFIRM stubs the OS confirming you;
 * DEEP_HUB_PLANT for a planted hub), and a deep mcp in a project folder.
 */
export async function openWorld(files: Uint8Array[], plant?: HubPlant): Promise<World> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const project = join(tmp, 'proj');
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  mkdirSync(project);
  const evidence = join(home, '.deepbuild', 'evidence');
  const store = await openEvidenceStore({ root: evidence });
  const you = store.connect({ role: 'you', via: 'drop' });
  for (const bytes of files) {
    const put = await you.put({ bytes, kind: 'file', source: 'you:drop', redaction: 'complete', license: YOURS });
    if (put.status !== 'stored' || put.evidence.sha256 !== sha256(bytes)) throw Error(`harness: the store didn't keep a fixture by its hash: ${JSON.stringify(put)}`);
  }
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const hub = await startHub(home, { DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm'), ...(plant ? { DEEP_HUB_PLANT: plant } : {}) });
  const mcp = await startMcp(home, project);
  return { tmp, home, hub, mcp, project, evidence };
}
/**
 * The model host started and deepbuild/bakes installed from packages/jobs/bakes as you install any package (its tools
 * qualify on the host at install): what each criterion's jobs need. A missing plug-in or a refused install fails here.
 */
export async function withBakes(w: World): Promise<void> {
  expect(existsSync(join(BAKES, 'deepbuild.json')), `the first-party plug-in deepbuild/bakes is at packages/jobs/bakes (Analysis bake): no ${join(BAKES, 'deepbuild.json')}`).toBe(true);
  w.host = await startModelHost();
  const ran = await deep(['install', BAKES], w.home, w.project);
  expect(ran.code, `deep install packages/jobs/bakes installs deepbuild/bakes, its tools qualifying on the model host: ${shown(ran)}; the host said ${w.host.tail().slice(-1500)}`).toBe(0);
}
/** The world's model host stopped (AC5: a job that can't start). */
export async function stopHost(w: World): Promise<void> {
  if (w.host) await stopModelHost(w.host);
  delete w.host;
}

// ---- deep_job on deepbuild/bakes' kinds.
export interface JobRun { outcome: Outcome; replies: Outcome[]; yeses: string[] }
/**
 * One deep_job run of a bake kind on inputs by hash, with `sample_rate` and `channels` in its params. A reply held on an
 * ask gets your yes and the call is made again (no criterion reads such an ask; README, The surface), at most 5 times.
 */
export async function runJob(w: World, kind: string, tool: string, inputs: { name: string; sha256: string }[], rate: number): Promise<JobRun> {
  const args = { op: 'run', kind, tool, params: JSON.stringify({ sample_rate: rate, channels: 1 }), inputs };
  const replies: Outcome[] = [];
  const yeses: string[] = [];
  for (let i = 0; ; i++) {
    const o = await deepJob(w, args);
    replies.push(o);
    if (o.value.status !== 'held' || typeof o.value.ask !== 'string' || i >= 5) return { outcome: o, replies, yeses };
    const ask = (await asks(w)).find((a) => a.handle === o.value.ask);
    if (!ask) return { outcome: o, replies, yeses };
    const ran = await yes(w, ask);
    yeses.push(`${ask.handle}: ${ask.text.slice(0, 300)} -> ${ran.code}`);
  }
}
export const done = (o: Outcome): boolean => !o.isError && o.value.status === 'done';
/** The job's one output, the record, by hash. */
export const recordOf = (o: Outcome): string | undefined => o.value.outputs?.bake?.sha256;
/** A done run of a bake kind: its record's hash, or the run fails, naming the job. */
export async function mustRecord(w: World, kind: string, tool: string, inputs: { name: string; sha256: string }[], rate: number): Promise<{ record: string; run: JobRun }> {
  const run = await runJob(w, kind, tool, inputs, rate);
  const record = recordOf(run.outcome);
  expect(done(run.outcome) && typeof record === 'string' && /^[0-9a-f]{64}$/.test(record), `deep_job runs ${kind} on ${tool} for ${inputs.map((i) => `${i.name} ${i.sha256}`).join(', ')}, its one output \`bake\` the record by hash: ${run.outcome.text.slice(0, 1500)}${w.host ? `; the model host said ${w.host.tail().slice(-800)}` : ''}`).toBe(true);
  return { record: record!, run };
}
/** The record's JSON, read from the evidence store by its hash (`<2 hex>/<62 hex>`). */
export function readRecord(w: World, record: string): Line {
  const path = join(w.evidence, record.slice(0, 2), record.slice(2));
  expect(existsSync(path), `the evidence store holds the record ${record}`).toBe(true);
  const bytes = readFileSync(path);
  expect(sha256(bytes), `the record ${record}'s bytes hash to its name`).toBe(record);
  const v = parse(bytes.toString('utf8'));
  expect(v, `the record ${record} is a JSON object`).toBeDefined();
  return v!;
}

// ---- media_bake through `deep-show run` (#393's scenario on stdin, one answer line), on the hub's evidence store.
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface Bake { asset: string; kind: 'words' | 'beats' | 'activity' | 'visemes'; analyzer: string; record?: string; [field: string]: JsonValue | undefined }
/** One scenario of media_bake calls: each call's reply, in order. A run that exits non-zero or isn't ok fails, naming it. */
export function bakes(bin: string, w: World, calls: Bake[], what: string, planted?: ShowPlant): Line[] {
  const label = planted ? `${what} (planted ${planted})` : what;
  const scenario = { evidence: w.evidence, ...(planted ? { planted } : {}), calls: calls.map((bake) => ({ call: 'media_bake', bake })) };
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const stdout = r.stdout ?? '';
  expect(r.status, `${label}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${label}: one output line for the one scenario line`).toBe(1);
  const answer = parse(out[0]!) ?? {};
  expect(answer.ok, `${label}: deep-show run answers the scenario ok (media_bake with model kinds, README: The surface); got ${JSON.stringify(answer).slice(0, 800)}`).toBe(true);
  expect(Array.isArray(answer.replies) && answer.replies.length === calls.length, `${label}: one reply per call: ${JSON.stringify(answer).slice(0, 800)}`).toBe(true);
  return answer.replies as Line[];
}
/** A bake's readings: the reply's `bake`, of the asset, kind and analyzer asked, or the call fails, naming the reply. */
export function readings(reply: Line, ask: Bake, what: string): Line {
  const b = reply.bake as Line | undefined;
  expect(b !== undefined && b !== null && typeof b === 'object', `${what}: media_bake answers the bake's readings as \`bake\`; it answered ${JSON.stringify(reply).slice(0, 1500)}`).toBe(true);
  expect({ asset: b!.asset, kind: b!.kind, analyzer: b!.analyzer }, `${what}: the bake is of the asset, kind and analyzer asked`).toEqual({ asset: ask.asset, kind: ask.kind, analyzer: ask.analyzer });
  return b!;
}
/** Whether a reply says BLOCKED and has no readings. */
export const blocked = (reply: Line): boolean => /\bBLOCKED\b/i.test(JSON.stringify(reply)) && !['words', 'beats', 'tempo', 'spans', 'visemes'].some((k) => reply.bake?.[k] !== undefined);
/**
 * A model bake asked with no record (Analysis bake): BLOCKED, naming the analyzer and the PCM's hash, and the PCM kept in
 * the store by that hash for the job. `pcm` is the PCM's bytes as the test knows them (the fixture's f32 samples).
 */
export function mustBlockForPcm(bin: string, w: World, ask: Bake, pcm: Uint8Array, what: string): string {
  const [reply] = bakes(bin, w, [ask], what);
  const text = JSON.stringify(reply);
  const hash = sha256(pcm);
  expect(blocked(reply!) && text.includes(ask.analyzer) && text.includes(hash), `${what}: media_bake with ${ask.kind} by ${ask.analyzer} and no record is BLOCKED, naming ${ask.analyzer} and the PCM's hash ${hash}; it answered ${text.slice(0, 1500)}`).toBe(true);
  const path = join(w.evidence, hash.slice(0, 2), hash.slice(2));
  expect(existsSync(path) && sha256(readFileSync(path)) === hash, `${what}: the BLOCKED bake keeps the PCM in the evidence store by its hash ${hash}, for the job`).toBe(true);
  return hash;
}

// ---- The proof, rewritten each run under $TMPDIR/deep-1819-proof/.
export const PROOF_DIR = join(tmpdir(), 'deep-1819-proof');
export function proof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}
