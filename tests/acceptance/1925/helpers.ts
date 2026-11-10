// Test-side tools for the #1925 acceptance tests (README). A world of a real hub (`deep hub run`) in a temp home, the
// test plug-ins (fixtures/kind and fixtures/guess, each with the encoder in fixtures/tool) installed with `deep install
// <folder>`, a `deep mcp` started in the world's project folder and spoken to as an agent's MCP client does, and the
// hub's socket as the cli role (the control token and this process as the peer) for `rows.read` (the list's rows, what
// `deep status --json` prints) and `events.read`. The app is the real `deep-drive` (#124), the replica of the app's
// window, opened on a copy of the world's hub's record. The ground truth of what the encoder wrote is its own `log`
// output, read from the evidence store by hash after the run. The judges each test shares with its planted twin are
// here too. No hub, CLI or extension-host module is imported but two public entries: the extension host's, for
// `packageDigest`, and the evidence store's, to read an output's bytes by hash.
//
// Copied from tests/acceptance/1922/helpers.ts (no import across suites): the temp folders and PIDs, childEnv, the
// plug-in sealing, the hub, `control`, `events`, the MCP client and `deep install`. From tests/acceptance/1463/helpers.ts:
// the replica driver and the snapshot's text.
//
// Safety: every folder is under /tmp/dh1925-* and removed after its file; HOME is a temp home for every child;
// DEEP_*, XDG_*, CLAUDE*, CODEX* and NODE_OPTIONS are left out of their environment; nothing leaves 127.0.0.1; no model
// is called; every process is one this file started, stopped by its PID.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** The criterion: `#1925.` and the first 8 hex of SHA-256 of its checkbox text, white space collapsed. */
export const ID = '#1925.c0a82b1d';
/** The kind, its holder and its tools, as README, The world, names them. */
export const KIND = 'test.encode';
export const HOLDER = 'test/encode-kind';
export const TOOL = 'encode-a@1.0.0';
export const PLANTED = 'encode-guess@1.0.0';
/** The encode the criterion names: 600 frames, 15 every 2 s (7.5 a second), so 300 at 40 s and the last at 80 s. */
export const FRAMES = 600;
export const BATCH = 15;
export const EVERY_MS = 2000;
export const PARAMS = JSON.stringify({ frames: FRAMES, batch: BATCH, every_ms: EVERY_MS });
/** How far a row may trail its tool when the app opens (README, reading 7): one batch. */
export const LAG_MS = EVERY_MS;
/** The tool's folder in its plug-in (`run.dir`): the record's process.starting for its run names it as its cwd. */
const RUN_DIR = 'encoder';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---- Temp folders and processes, all gone after the file.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1925-'));
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

/** What a build this suite needs is missing: BLOCKED, never a pass. */
export function needBuilds(): void {
  if (!existsSync(CLI)) throw Error(`BLOCKED: no built CLI at ${CLI}; run npm run build --workspaces first`);
  if (!existsSync(target('deep-hook'))) throw Error('BLOCKED: no deep-hook under target/debug; run cargo build --locked -p deep-hook first (the hub won\'t start without it)');
}
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);

// ---- The test plug-ins: a fixture folder copied, `*.fixture` renamed, the encoder's two files laid in ./encoder, its
// manifest's digest set by the extension host's packageDigest.
const { packageDigest } = await import(new URL('../../../packages/extension-host/src/index.ts', import.meta.url).href) as typeof import('../../../packages/extension-host/src/index.ts');
const { openEvidenceStore } = await import(new URL('../../../packages/evidence/src/index.ts', import.meta.url).href) as typeof import('../../../packages/evidence/src/index.ts');
function unfixture(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (lstatSync(path).isDirectory()) unfixture(path);
    else if (name.endsWith('.fixture')) renameSync(path, join(dir, name.slice(0, -'.fixture'.length)));
  }
}
/** The encoder's two files: encode.mjs, its entry, and counter.mjs, what it reports (the planted one's guess, or its own count). */
function layTool(dir: string, guess: boolean): void {
  mkdirSync(join(dir, RUN_DIR));
  writeFileSync(join(dir, RUN_DIR, 'encode.mjs'), readFileSync(join(FIXTURES, 'tool', 'encode.mjs.fixture')));
  writeFileSync(join(dir, RUN_DIR, 'counter.mjs'), readFileSync(join(FIXTURES, 'tool', guess ? 'guess-counter.mjs.fixture' : 'counter.mjs.fixture')));
}
function seal(dir: string): string {
  const path = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Line;
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
/** test/encode-kind: the kind test.encode and its first tool encode-a@1.0.0, which reports the frames it has written. */
export function kindPlugin(dir: string): string {
  cpSync(join(FIXTURES, 'kind'), dir, { recursive: true });
  unfixture(dir);
  layTool(dir, false);
  return seal(dir);
}
/** test/encode-guess: the planted tool encode-guess@1.0.0, the same encoder reporting elapsed time over an expected duration. */
export function guessPlugin(dir: string): string {
  cpSync(join(FIXTURES, 'guess'), dir, { recursive: true });
  unfixture(dir);
  layTool(dir, true);
  return seal(dir);
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
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub didn't start (deep hub run): ${out.slice(0, 500)} ${err.slice(-1500)}`);
  return { pid: child.pid!, socket: typeof ready.socket === 'string' ? ready.socket : join(home, '.deepbuild', 'hub.sock'), root: join(home, '.deepbuild'), child };
}

/** This process's start time as `ps` gives it, the peer check's second half; read once, it never changes. */
let started: string | undefined;
const startOf = (): string => (started ??= execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' }).trim());
/** One call on the hub's socket as the cli role, with the control token and this process for the peer check: the reply line. */
export async function control(w: World, method: string, params: Line, timeoutMs = 60_000): Promise<Line> {
  const token = readFileSync(join(w.hub.root, 'control.token'), 'utf8').trim();
  const start = startOf();
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
/** The record's last log position. */
export async function lastPos(w: World): Promise<number> {
  const all = await events(w);
  return all.length ? Math.max(...all.map((e) => Number(e.log_pos))) : 0;
}
const dataOf = (e: Line): Line => (typeof e.data === 'string' ? parse(e.data) ?? {} : e.data ?? {});

// ---- The list (README, readings 2 and 3): `rows.read` on the cli role, the hub's one row shape, what `deep status
// --json` prints, `{log_pos, rows}`.
export async function rowsRead(w: World): Promise<{ log_pos: number; rows: Line[] }> {
  const got = await must(w, 'rows.read', {});
  return { log_pos: Number(got.log_pos), rows: Array.isArray(got.rows) ? (got.rows as Line[]) : [] };
}
/** The job's row: the row whose id starts `job:` (README, reading 2). */
export const jobRowOf = (rows: readonly Line[]): Line | undefined => rows.find((r) => typeof r?.id === 'string' && r.id.startsWith('job:'));
/** What a row says: its string fields but the ones that only name it (README, reading 3). */
const NAMING = new Set(['id', 'address', 'session', 'project', 'agent', 'entry', 'waits_on']);
export const rowText = (row: Line | null | undefined): string => (row ? Object.entries(row).filter(([k, v]) => typeof v === 'string' && !NAMING.has(k)).map(([, v]) => v as string).join(' · ') : '');
/** "<done> of <total>" in a text: the count it shows. */
export function countIn(text: string): { done: number; total: number } | undefined {
  const m = /\b(\d+) of (\d+)\b/.exec(text);
  return m ? { done: Number(m[1]), total: Number(m[2]) } : undefined;
}
/** "<span> left" in a text, the span as the app writes one (states::span: "40 s", "2 min", "1 h", "1 d"), in ms. */
export function leftIn(text: string): number | undefined {
  const m = /\b(\d+) (s|min|h|d) left\b/.exec(text);
  return m ? Number(m[1]) * { s: 1000, min: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'min' | 'h' | 'd'] : undefined;
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
}
async function startMcp(home: string, cwd: string): Promise<Mcp> {
  const child = spawn(NODE, [CLI, 'mcp'], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'ignore'] });
  if (child.pid) owned.add(child.pid);
  const mcp = new Mcp(child);
  const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1925', version: '0' } });
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
/** Whether a run is done: no error and status done. */
export const done = (o: Outcome | undefined): boolean => !!o && !o.isError && o.value.status === 'done';

// ---- The world.
export interface World {
  tmp: string; home: string; hub: Hub; mcp: Mcp;
  /** The project folder: deep mcp's working folder, where the input is. */
  project: string;
}
export async function openWorld(): Promise<World> {
  needBuilds();
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const project = join(tmp, 'proj');
  mkdirSync(home);
  mkdirSync(project);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const hub = await startHub(home, { DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm') });
  const mcp = await startMcp(home, project);
  return { tmp, home, hub, mcp, project };
}
/** `deep install <folder>`, as you, confirmed by the stubbed OS; a refusal is BLOCKED (#1922's job API is merged). */
export async function mustInstall(w: World, folder: string): Promise<Ran> {
  const ran = await run(['install', folder], w.home, w.project);
  const id = (JSON.parse(readFileSync(join(folder, 'deepbuild.json'), 'utf8')) as Line).id;
  if (ran.code !== 0) throw Error(`BLOCKED: deep install of ${String(id)} didn't load it, so no job of ${KIND} can run: ${shown(ran)}`);
  return ran;
}
/** A world with test/encode-kind installed, and test/encode-guess too when `guess`. */
export async function encodeWorld(guess = false): Promise<World> {
  const w = await openWorld();
  await mustInstall(w, kindPlugin(join(w.tmp, 'kind')));
  if (guess) await mustInstall(w, guessPlugin(join(w.tmp, 'guess')));
  return w;
}

// ---- The app (README, reading 6): the real `deep-drive`, the replica of the app's window, one process per opening,
// launched on a copy of the world's hub's record.
interface SNode { role: string; name: string | null; value: unknown; id?: unknown; bounds?: number[]; children?: SNode[] }
const flat = (n: SNode, into: SNode[] = []): SNode[] => { into.push(n); for (const c of n.children ?? []) flat(c, into); return into; };
const textOf = (n: SNode): string => [n.name ?? '', typeof n.value === 'string' ? n.value : '', ...(n.children ?? []).map(textOf)].join(' ');
/** What the app drew of the job when it opened: the read's window, and the job's node's text, or null with none. */
export interface AppView { a: number; b: number; log_pos: unknown; node: string | null; row: Line | null }
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
        this.waiting.shift()?.(parse(line) ?? { unparsed: line });
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true }); });
  }
  /** The app's process, with HOME the world's so `record_copy` reads its hub; no window yet. */
  static async start(home: string): Promise<Drive> {
    const bin = target('deep-drive');
    if (process.platform !== 'darwin') throw Error(`BLOCKED: the replica draws on macOS only; this is ${process.platform}`);
    if (!existsSync(bin)) throw Error(`BLOCKED: no deep-drive under target/debug; run cargo build --locked -p deep-replica --bin deep-drive first`);
    const out = join(tempDir(), 'out');
    mkdirSync(out, { recursive: true });
    const child = spawn(bin, ['--out', out], { cwd: REPO, env: childEnv(home), stdio: ['pipe', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    const drive = new Drive(child);
    const ready = await drive.next(180_000);
    if (ready.ready !== true) throw Error(`BLOCKED: deep-drive didn't say {"ready": true}: ${JSON.stringify(ready).slice(0, 300)} ${drive.err.slice(-600)}`);
    return drive;
  }
  private next(ms: number): Promise<Line> {
    if (this.exited) return Promise.resolve({ exited: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  private async must(args: Line): Promise<Line> {
    const reply = this.next(180_000);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.ok !== true) throw Error(`BLOCKED: deep-drive ${String(args.call)} didn't answer ok: ${JSON.stringify(got).slice(0, 600)} ${this.err.slice(-600)}`);
    return got;
  }
  /** Opens the app's window on a copy of the hub's record and reads it: the job's node, the first whose id starts `job:`. */
  async open(): Promise<AppView> {
    const a = Date.now();
    await this.must({ call: 'launch', launch: { from: 'record_copy' } });
    const seen = await this.must({ call: 'see' });
    const b = Date.now();
    const node = flat((seen.snapshot as { tree: SNode }).tree).find((n) => typeof n.id === 'string' && n.id.startsWith('job:'));
    return { a, b, log_pos: seen.log_pos, node: node ? textOf(node).replace(/\s+/g, ' ').trim() : null, row: Array.isArray(seen.rows) ? jobRowOf(seen.rows as Line[]) ?? null : null };
  }
  /** Closes the app: its window, then its process. When it closed. */
  async close(): Promise<number> {
    await this.must({ call: 'close' }).catch(() => undefined);
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 5000;
    while (!this.exited && Date.now() < deadline) await sleep(20);
    if (!this.exited) try { process.kill(this.child.pid!, 'SIGKILL'); } catch { /* gone */ }
    return Date.now();
  }
}

// ---- One run of the 600-frame encode (README, How each part is read).

/** A read of the list while the job ran: the read's window, its log_pos and the job's row, if the list held one. */
export interface Reading { a: number; b: number; log_pos: number | null; row: Line | null; error?: string }
/** A line of the encoder's own log: the frames it had written, and when. */
export interface LogLine { written: number; at: number }
export interface AppPart { trigger: string; open?: AppView; closed?: number; reopen?: AppView; error?: string }
export interface EncodeRun {
  tool: string;
  /** When deep_job was called. */
  called: number;
  readings: Reading[];
  /** The tool's run in the record: its run handle, when it started and when it ended, and the end's log position. */
  run: { id: string | null; started: number | null; ended: number | null; endPos: number | null };
  /** deep_job's reply to the run, and to the rerun after it ended (a cache hit) when the first didn't come back done. */
  reply?: Outcome;
  rerun?: Outcome;
  outputs: { video?: string; log?: string };
  log: LogLine[] | null;
  app?: AppPart;
}
const ARGS = (tool: string, clip: string): Line => ({ op: 'run', kind: KIND, tool, params: PARAMS, inputs: [{ name: 'clip', path: clip }] });

/**
 * Runs the 600-frame encode on `tool` through deep_job and reads the list every 200 ms until the tool's run ends. With
 * `app`, the app is opened when the job's row first shows 300 of 600 (or, with no such row, 41 s after the call),
 * read, closed, and opened again 4 s later in a new process (README, reading 6). After the run: its outputs by hash
 * (deep_job's reply, else a rerun's cache hit) and the encoder's log, the frames it wrote and when.
 */
export async function encodeRun(w: World, tool: string, o: { app?: boolean } = {}): Promise<EncodeRun> {
  const clip = join(w.project, 'clip.txt');
  writeFileSync(clip, 'dawn');
  let after = await lastPos(w);
  const r: EncodeRun = { tool, called: 0, readings: [], run: { id: null, started: null, ended: null, endPos: null }, outputs: {}, log: null };
  const first = o.app ? await Drive.start(w.home) : undefined;
  let app: Promise<void> | undefined;
  r.called = Date.now();
  const replied = job(w, ARGS(tool, clip)).then((x) => { r.reply = x; }, (e: unknown) => { r.reply = { isError: true, value: {}, text: message(e) }; });
  let lastEvents = 0;
  for (const until = r.called + 115_000; Date.now() < until && r.run.ended === null;) {
    const a = Date.now();
    try {
      const got = await rowsRead(w);
      r.readings.push({ a, b: Date.now(), log_pos: got.log_pos, row: jobRowOf(got.rows) ?? null });
    } catch (e) {
      r.readings.push({ a, b: Date.now(), log_pos: null, row: null, error: message(e) });
    }
    if (o.app && !app) {
      const shows = countIn(rowText(r.readings.at(-1)!.row));
      const at300 = shows?.done === 300 && shows.total === FRAMES;
      if (at300 || Date.now() - r.called >= 41_000) app = theApp(w, r, first!, at300 ? 'the job\'s row showed 300 of 600' : 'no row showed 300 of 600 by 41 s after the call');
    }
    if (Date.now() - lastEvents >= 1000) {
      lastEvents = Date.now();
      const evs = await events(w, after);
      if (evs.length) after = Math.max(...evs.map((e) => Number(e.log_pos)));
      for (const e of evs) {
        const d = dataOf(e);
        if (e.kind === 'process.starting' && r.run.id === null && typeof d.cwd === 'string' && d.cwd.endsWith(`/${RUN_DIR}`)) { r.run.id = String(d.run); r.run.started = Number(e.ts); }
        if ((e.kind === 'process.ended' || e.kind === 'run.cleaned') && r.run.id !== null && d.run === r.run.id && r.run.ended === null) { r.run.ended = Number(e.ts); r.run.endPos = Number(e.log_pos); }
      }
    }
    await sleep(200);
  }
  await app;
  if (r.run.ended === null) throw Error(`BLOCKED: the encode's run (${r.run.id ?? 'never started in the record'}) didn't end within 115 s of the call; nothing can be judged against its log`);
  // Its outputs: the reply if it came back done; else, once the hub has kept them, a rerun, which must be a hit.
  await Promise.race([replied, sleep(60_000)]);
  if (!done(r.reply)) {
    for (const until = Date.now() + 15_000; Date.now() < until;) {
      const evs = await events(w, r.run.endPos!);
      if (evs.filter((e) => e.kind === 'evidence.stored').length >= 2) break;
      await sleep(250);
    }
    r.rerun = await job(w, ARGS(tool, clip));
  }
  const kept = done(r.reply) ? r.reply! : r.rerun!;
  if (!done(kept)) throw Error(`BLOCKED: the encode on ${tool} didn't end done, so its log can't be read: reply ${r.reply?.text.slice(0, 500)}; rerun ${r.rerun?.text.slice(0, 500)}`);
  if (r.rerun && r.rerun.value.receipt?.cache !== 'hit') throw Error(`BLOCKED: the rerun after the encode ended wasn't a cache hit, so its outputs are another run's: ${r.rerun.text.slice(0, 500)}`);
  r.outputs = { video: kept.value.outputs?.video?.sha256, log: kept.value.outputs?.log?.sha256 };
  if (!r.outputs.log) throw Error(`BLOCKED: the encode's reply names no log output: ${kept.text.slice(0, 500)}`);
  const store = await openEvidenceStore({ root: join(w.hub.root, 'evidence'), readOnly: true });
  const text = Buffer.from(await store.read(r.outputs.log)).toString('utf8');
  r.log = text.split('\n').filter(Boolean).map((l) => { const [n, at] = l.split(' '); return { written: Number(n), at: Number(at) }; });
  if (!r.log.length || r.log.at(-1)!.written !== FRAMES) throw Error(`BLOCKED: the encoder's log doesn't end at ${FRAMES} frames: ${text.slice(-300)}`);
  return r;
}
/** The app opened at frame 300, read, closed, then opened again 4 s after it closed, in a new process. */
async function theApp(w: World, r: EncodeRun, first: Drive, trigger: string): Promise<void> {
  const part: AppPart = (r.app = { trigger });
  try {
    part.open = await first.open();
    part.closed = await first.close();
    const second = await Drive.start(w.home);
    const at = part.closed + 4000;
    if (Date.now() < at) await sleep(at - Date.now());
    part.reopen = await second.open();
    await second.close();
  } catch (e) {
    part.error = message(e);
  }
}

// ---- The proof, rewritten each run under $TMPDIR/deep-1925-proof/.
export const PROOF_DIR = join(tmpdir(), 'deep-1925-proof');
export function proof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}
/** A run as the proof keeps it: each read of the list as its time into the run and what the job's row said. */
export const proofOf = (r: EncodeRun): Line => ({
  tool: r.tool, run: r.run, outputs: r.outputs, log: r.log, app: r.app,
  reply: r.reply?.text.slice(0, 600), rerun: r.rerun?.text.slice(0, 600),
  readings: r.readings.map((x) => ({ s: +((x.a - r.called) / 1000).toFixed(2), took_ms: x.b - x.a, log_pos: x.log_pos, id: x.row?.id ?? null, says: rowText(x.row) || null, ...(x.error ? { error: x.error } : {}) })),
});

// ---- Judges: each returns its failures in words; none is a pass.

/** The frames the encoder had written at `t`, by its own log. */
export const writtenAt = (log: readonly LogLine[], t: number): number => log.reduce((n, l) => (l.at <= t ? Math.max(n, l.written) : n), 0);
const lastFrameAt = (log: readonly LogLine[]): number => log.find((l) => l.written === FRAMES)!.at;
const into = (r: EncodeRun, t: number): string => `${((t - r.called) / 1000).toFixed(1)} s`;
/** The job by name: its row's id, its kind and its tool. */
export const jobName = (r: EncodeRun): string => { const id = r.readings.find((x) => x.row)?.row?.id as string | undefined; return id ? `${id} (${KIND} on ${r.tool})` : `${KIND} on ${r.tool}`; };

/**
 * The count and the time left (README, readings 3 to 5): the list holds the job's row; the first read showing "300 of
 * 600" falls while the encoder had written 300 by its log; and the first read at 300 of 600 with a time left says one
 * within 10% of the time from that read to the encoder's last frame. A failure names the job.
 */
export function judgeCount(r: EncodeRun): string[] {
  const log = r.log!;
  const rows = r.readings.filter((x) => x.row);
  if (!rows.length) return [`the list never held a row for the job ${KIND} on ${r.tool}: none of ${r.readings.length} reads of rows.read (what deep status --json prints) over its ${into(r, r.readings.at(-1)?.b ?? r.called)} had a row whose id starts job:${r.readings.some((x) => x.error) ? `; a read failed: ${r.readings.find((x) => x.error)!.error}` : ''}`];
  const name = jobName(r);
  const at300 = (x: Reading): boolean => { const c = countIn(rowText(x.row)); return c?.done === 300 && c.total === FRAMES; };
  const first = rows.find(at300);
  if (!first) return [`the job's row ${name} never showed "300 of 600"; it said ${JSON.stringify([...new Set(rows.map((x) => rowText(x.row)))].slice(0, 8))}`];
  const failures: string[] = [];
  const mid = (first.a + first.b) / 2;
  const n = writtenAt(log, mid);
  if (n !== 300) failures.push(`the job's row ${name} showed "300 of 600" at ${into(r, mid)} while its tool had written ${n} frames of ${FRAMES}: the row's count isn't the tool's own`);
  // The time left comes after 30 s of the run: a row at 300 of 600 sooner (the planted tool's) is judged by its count alone.
  if (mid - (r.run.started ?? r.called) < 30_000) return failures;
  const timed = rows.find((x) => at300(x) && leftIn(rowText(x.row)) !== undefined);
  if (!timed) failures.push(`the job's row ${name} showed "300 of 600" with no time left ("<n> s left") at ${into(r, mid)} into the run, after 30 s: ${JSON.stringify(rowText(first.row))}`);
  else {
    const at = (timed.a + timed.b) / 2;
    const left = leftIn(rowText(timed.row))!;
    const took = lastFrameAt(log) - at;
    if (Math.abs(left - took) > 0.1 * took) failures.push(`the job's row ${name} said ${JSON.stringify(rowText(timed.row))} at ${into(r, at)}, a time left of ${left / 1000} s, and the job then took ${(took / 1000).toFixed(1)} s to write its last frame: more than 10% off`);
  }
  return failures;
}

/** Whether a count is one the encoder had written from `LAG_MS` before `a` to `b` (README, reading 7). */
const trueCount = (log: readonly LogLine[], n: number, a: number, b: number): boolean => n >= writtenAt(log, a - LAG_MS) && n <= writtenAt(log, b);
/** What the app drew of the job when it opened, judged: the job's node, its count the true one, and with `left`, a time left. */
function appFailures(r: EncodeRun, view: AppView, when: string, left: boolean): string[] {
  const log = r.log!;
  const range = `${writtenAt(log, view.a - LAG_MS)} to ${writtenAt(log, view.b)}`;
  if (view.node === null) return [`the app ${when} (${into(r, view.a)} to ${into(r, view.b)}, the tool at ${range} frames) draws no row for the job ${jobName(r)}: no node of its window has an id starting job:`];
  const c = countIn(view.node);
  if (!c || c.total !== FRAMES) return [`the app ${when} draws the job ${jobName(r)} as ${JSON.stringify(view.node)}, with no "<n> of ${FRAMES}"`];
  const failures: string[] = [];
  if (c.done === 0) failures.push(`the app ${when} shows the job ${jobName(r)} at 0 of ${FRAMES} while its tool had written ${range} frames`);
  else if (!trueCount(log, c.done, view.a, view.b)) failures.push(`the app ${when} shows the job ${jobName(r)} at ${c.done} of ${FRAMES} while its tool had written ${range} frames (${into(r, view.a)} to ${into(r, view.b)}): not its true count`);
  if (left && leftIn(view.node) === undefined) failures.push(`the app ${when} shows the job ${jobName(r)} as ${JSON.stringify(view.node)}, with no time left ("<n> s left") ${into(r, view.a)} into the run`);
  return failures;
}
/**
 * The app through a close and a reopen (README, readings 6 to 8): opened at frame 300 it draws the job's true count
 * and its time left; closed there, the job runs on to its last frame and ends done; opened again, it draws the true
 * count, never 0.
 */
export function judgeApp(r: EncodeRun): string[] {
  const app = r.app;
  if (!app) return ['the app was never opened'];
  if (app.error) return [app.error.startsWith('BLOCKED') ? app.error : `the app couldn't be opened, closed and opened again: ${app.error}`];
  const log = r.log!;
  const failures = [...appFailures(r, app.open!, 'opened at frame 300', true)];
  const last = lastFrameAt(log);
  if (!(writtenAt(log, app.closed!) < FRAMES && last > app.closed!)) failures.push(`the job ${jobName(r)} didn't run on after the app closed at ${into(r, app.closed!)}: its tool had written ${writtenAt(log, app.closed!)} frames then and its last at ${into(r, last)}`);
  if (!r.outputs.video) failures.push(`the job ${jobName(r)} didn't end done after the app closed: ${r.reply?.text.slice(0, 300)}`);
  if (app.reopen!.a > last) throw Error(`INCONCLUSIVE: the app opened again at ${into(r, app.reopen!.a)}, after the job's last frame at ${into(r, last)}, so it couldn't show a running job's count; this Mac was too slow for the run's timing, and this is not a pass`);
  failures.push(...appFailures(r, app.reopen!, 'opened again after it closed at frame 300', false));
  return failures;
}
