// Test-side tools for the #220 acceptance tests (README: The surface under test): the typeset job's first-party plug-in
// installed with `deep install` into a world of a real hub (`deep hub run`) in a temp home, and run through `deep_job`
// over a `deep mcp` spoken to as an agent's MCP client; its outputs read by hash from the hub's evidence store; the
// plug-in's own tool process run directly (the same request on its stdin, on this Mac and in a linux/amd64 container,
// and fed several requests for the warm and cold times); an SVG reader for the outputs (elements, part groups, their
// outlines with every transform applied, and their bounds); `deep-show run` (#393's scenarios with #387's `eval` and
// #494's `film.morphs`) for the match morph between two imports and for `deep show`'s issues; and the perf lane's
// judgeLimit, imported. Nothing here stands in for the typesetter, the hub or the canvas: every value a test compares
// comes from them; every expected value comes from the issue's and the design's text, computed here.
//
// Safety: every folder is under /tmp/dh220-* (short, for the hub's socket path) and removed after its file; the hub,
// `deep` commands and `deep mcp` run with HOME in the world's temp folder and without the caller's DEEP_*, CLAUDE*,
// CODEX*, NODE_OPTIONS; every process this file starts is stopped by its PID; nothing is stopped by name or port;
// nothing leaves 127.0.0.1, and the Linux container runs with no network. No image is pulled.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;
/**
 * The typeset job's first-party plug-in of its own (README: The surface under test, 1). `ACCEPTANCE_220_PLUGIN` names
 * another folder to install in its place: a planted twin (README: Plants).
 */
export const PLUGIN = resolve(REPO, process.env['ACCEPTANCE_220_PLUGIN'] ?? 'packages/jobs/typeset');
export const KIND = 'typeset';
/** The first tool's name; its version is the one deep_job lists. */
export const TOOL_NAME = 'typst-mitex';
/** Every hub test's `it` timeout. */
export const TIMEOUT = 1_800_000;

/** Each criterion's ID (scripts/proof-change.mjs's criterionId: `#220.` and 8 hex of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #220.a1078979',
  2: 'AC2 #220.ec8a4363',
  3: 'AC3 #220.472f9775',
  4: 'AC4 #220.e4f3b85e',
  5: 'AC5 #220.56b932fa',
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Line) : undefined; } catch { return undefined; } };
export const isObj = (v: unknown): v is Line => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown): string => (JSON.stringify(v) ?? 'undefined').slice(0, 1500);
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** The criterion stays open, whatever the reason: never a pass (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// The params, as the design's `typeset {…}` fields (README: The surface under test, 3)

/** The params with every field the design gives a default written out, so a direct run gets what the hub gives. */
export function paramsOf(parts: readonly string[]): Line {
  return { syntax: 'latex_math', parts: parts.map((source) => ({ source })), display: true, font: 'new_computer_modern_math', macros: [] };
}
/** The job's source: its parts' sources joined by one space (made_by.input). */
export const sourceOf = (parts: readonly string[]): string => parts.join(' ');
/** A part's id from its source: `t-` and each byte outside A-Z, a-z and 0-9 written as `_` and two hex digits. */
export function partId(source: string): string {
  let id = 't-';
  for (const b of Buffer.from(source, 'utf8')) {
    const plain = (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);
    id += plain ? String.fromCharCode(b) : `_${b.toString(16).padStart(2, '0')}`;
  }
  return id;
}

// ---------------------------------------------------------------------------------------------------
// Temp folders and processes, all gone after the file

const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh220-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
afterAll(async () => {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}, 30_000);

function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT|ACCEPTANCE_|TMUX)/.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_EXTRA_CA_CERTS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env['PATH'] ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}
interface Ran { code: number | null; stdout: string; stderr: string }
const shown = (r: Ran) => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
function deep(args: readonly string[], home: string, cwd: string): Promise<Ran> {
  return new Promise((done) => {
    const child = spawn(NODE, [CLI, ...args], { cwd, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    // An install qualifies the tool on the kind's fixtures: allow it time.
    const timer = setTimeout(() => child.kill('SIGKILL'), 900_000);
    child.on('error', (error) => { clearTimeout(timer); done({ code: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
  });
}

// ---------------------------------------------------------------------------------------------------
// Builds, once per file in beforeAll: the CLI (npm run build --workspaces), deep-hook (the hub won't start without it)
// and, where a file needs it, `full` deep-show. A file whose plug-in folder is missing builds nothing: each of its tests
// fails at its first assertion, that the plug-in is there.

const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
function step(command: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  const r = spawnSync(command, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...env } });
  if (r.error) return `${command} could not run: ${r.error.message}`;
  if (r.status === 0) return '';
  const said = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading/.test(l)).join('\n');
  return `${command} ${args.join(' ')} failed (exit ${String(r.status)}):\n${said.slice(-4000)}`;
}
/** Whether the plug-in is there to install. */
export const pluginThere = (): boolean => existsSync(join(PLUGIN, 'deepbuild.json'));
/** The first assertion of every hub test: the typeset job's plug-in of its own is there. */
export function mustHavePlugin(): void {
  expect(pluginThere(), `the typeset job's first-party plug-in of its own is at ${relative(REPO, PLUGIN)} (README: The surface under test, 1): it has no deepbuild.json`).toBe(true);
}
export interface Builds { hub(): void; show(): string }
export function useBuilds(o: { show: boolean }): Builds {
  const error = { cli: 'not built', hook: 'not built', show: 'not built' };
  let dir = '';
  beforeAll(() => {
    if (!pluginThere()) return;
    error.cli = step('npm', ['run', 'build', '--workspaces']);
    error.hook = step('cargo', ['build', '--locked', '-p', 'deep-hook'], CARGO_ENV);
    if (!o.show) return;
    error.show = step('cargo', ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'], CARGO_ENV);
    if (error.show === '') {
      dir = mkdtempSync(join(tmpdir(), 'deep-220-show-'));
      copyFileSync(join(TARGET, 'debug', 'deep-show'), join(dir, 'deep-show'));
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return {
    hub: () => {
      expect(error.cli, 'the CLI builds: npm run build --workspaces').toBe('');
      expect(error.hook, 'deep-hook builds: cargo build --locked -p deep-hook').toBe('');
    },
    show: () => {
      expect(error.show, 'deep-show builds: cargo build --locked --bin deep-show --no-default-features --features full').toBe('');
      return join(dir, 'deep-show');
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// The hub, deep mcp and deep_job (README: The surface under test, 2)

interface Hub { pid: number; socket: string; root: string }
async function startHub(home: string, env: Record<string, string>): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-8000)));
  const ready = await new Promise<Line | undefined>((done) => {
    const timer = setTimeout(() => done(undefined), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); done(parse(out.split('\n')[0]!)); }
    });
    child.on('exit', () => { clearTimeout(timer); done(undefined); });
  });
  if (ready?.['ready'] !== true) throw Error(`BLOCKED: the hub didn't start (deep hub run): ${out.slice(0, 500)} ${err.slice(-1500)}`);
  return { pid: child.pid!, socket: typeof ready['socket'] === 'string' ? ready['socket'] : join(home, '.deepbuild', 'hub.sock'), root: join(home, '.deepbuild') };
}

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
  request(method: string, params: Line, timeoutMs = 600_000): Promise<Line> {
    const id = ++this.n;
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { this.wakers.delete(check); fail(Error(`deep mcp gave no reply to ${method} in ${timeoutMs} ms`)); }, timeoutMs);
      const check = () => {
        const found = this.lines.map((l) => parse(l)).find((l) => l?.['id'] === id);
        if (found) { clearTimeout(timer); this.wakers.delete(check); done(found); }
        else if (this.child.exitCode !== null) { clearTimeout(timer); this.wakers.delete(check); fail(Error(`deep mcp exited ${this.child.exitCode}`)); }
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
  const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-220', version: '0' } });
  if (!init['result']) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(init)}`);
  mcp.notify('notifications/initialized');
  return mcp;
}

export interface World { tmp: string; home: string; project: string; hub: Hub; mcp: Mcp; tool: string }
/**
 * A world: a temp home, a real hub with the OS confirmation stubbed (DEEP_HUB_TEST_CONFIRM), a project folder where
 * `deep mcp` runs, and the plug-in installed with `deep install <folder>` as you; `tool` is the typst-mitex@<version>
 * deep_job lists for the kind typeset. A refused install or a missing kind or tool fails here.
 */
export async function openWorld(): Promise<World> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const project = join(tmp, 'proj');
  mkdirSync(home);
  mkdirSync(project);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const hub = await startHub(home, { DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm') });
  const mcp = await startMcp(home, project);
  const ran = await deep(['install', PLUGIN], home, project);
  expect(ran.code, `deep install ${relative(REPO, PLUGIN)} installs the typeset job's plug-in, its tool qualifying on the kind's fixtures: ${shown(ran)}`).toBe(0);
  const listed = await job({ mcp }, { op: 'list' });
  const kinds = Array.isArray(listed.value['kinds']) ? (listed.value['kinds'] as Line[]) : [];
  const kind = kinds.find((k) => k['kind'] === KIND);
  expect(kind, `deep_job {op: list} lists the job kind ${KIND} once its plug-in is installed: ${listed.text.slice(0, 1500)}`).toBeDefined();
  const tools = ((kind!['tools'] ?? []) as Line[]).map((t) => String(t['tool']));
  const tool = tools.find((t) => t.startsWith(`${TOOL_NAME}@`));
  expect(tool, `${KIND} lists its first tool ${TOOL_NAME}@<version>: it lists ${JSON.stringify(tools)}`).toBeDefined();
  return { tmp, home, project, hub, mcp, tool: tool! };
}

export interface Outcome { isError: boolean; value: Line; text: string }
async function job(w: { mcp: Mcp }, args: Line): Promise<Outcome> {
  const reply = await w.mcp.request('tools/call', { name: 'deep_job', arguments: args });
  if (reply['error']) return { isError: true, value: reply['error'] as Line, text: JSON.stringify(reply['error']) };
  const result = (reply['result'] ?? {}) as Line;
  const text = Array.isArray(result['content']) ? String((result['content'] as Line[]).find((c) => c?.['type'] === 'text')?.['text'] ?? '') : '';
  const value = (result['structuredContent'] ?? parse(text) ?? {}) as Line;
  return { isError: result['isError'] === true, value, text: text || JSON.stringify(value) };
}
/** One deep_job run of the kind typeset on the world's tool: `{op: run, kind, tool, params: <JSON text>, inputs: []}`. */
export const typeset = (w: World, params: Line): Promise<Outcome> =>
  job(w, { op: 'run', kind: KIND, tool: w.tool, params: JSON.stringify(params), inputs: [] });

export interface Typeset { svg: Buffer; probe: Line; shas: { svg: string; probe: string }; receipt: Line; outcome: Outcome }
/** A run that must be done: its SVG's bytes and its probe, each read from the evidence store by the hash the reply names. */
export async function mustTypeset(w: World, params: Line, what: string): Promise<Typeset> {
  const o = await typeset(w, params);
  const outputs = (o.value['outputs'] ?? {}) as Line;
  const svgSha = outputs['svg']?.['sha256'];
  const probeSha = outputs['probe']?.['sha256'];
  expect(!o.isError && o.value['status'] === 'done' && typeof svgSha === 'string' && typeof probeSha === 'string', `${what}: deep_job runs ${KIND} on ${w.tool} to done, with outputs svg and probe by hash: ${o.text.slice(0, 1500)}`).toBe(true);
  const svg = storeBytes(w, svgSha as string, `${what}'s svg`);
  const probeBytes = storeBytes(w, probeSha as string, `${what}'s probe`);
  const probe = parse(probeBytes.toString('utf8'));
  expect(probe, `${what}: the probe output is a JSON object: ${probeBytes.toString('utf8').slice(0, 600)}`).toBeDefined();
  return { svg, probe: probe!, shas: { svg: svgSha as string, probe: probeSha as string }, receipt: (o.value['receipt'] ?? {}) as Line, outcome: o };
}
/** A file's bytes in the hub's evidence store by its hash (`<root>/evidence/<2 hex>/<62 hex>`), checked against it. */
export function storeBytes(w: World, sha: string, what: string): Buffer {
  const path = join(w.hub.root, 'evidence', sha.slice(0, 2), sha.slice(2));
  expect(existsSync(path), `${what}: the evidence store holds the output ${sha}`).toBe(true);
  const bytes = readFileSync(path);
  expect(sha256(bytes), `${what}: the stored bytes hash to ${sha}`).toBe(sha);
  return bytes;
}
/** Every file the evidence store holds by hash, as `<2 hex>/<62 hex>`. */
export function storeFiles(w: World): string[] {
  const root = join(w.hub.root, 'evidence');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((d) => /^[0-9a-f]{2}$/.test(d)).flatMap((d) => readdirSync(join(root, d)).filter((f) => /^[0-9a-f]{62}(\.zst)?$/.test(f)).map((f) => `${d}/${f}`));
}

// ---- The proof, rewritten each run under $TMPDIR/deep-220-proof/.
export const PROOF_DIR = join(tmpdir(), 'deep-220-proof');
export function proof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`);
}

// ---------------------------------------------------------------------------------------------------
// The tool's own process (README: The surface under test, 5)

/** The tool's files as its plug-in registers them: `run {dir, entry}` of the typst-mitex tool, by calling the plug-in's
 * own entry (index.ts's default export) with a `deep` that records registerJobTool and answers every other call. */
export async function toolFiles(): Promise<{ dir: string; entry: string }> {
  const tools: Line[] = [];
  const deepApi = new Proxy({}, {
    get: (_, name) => (name === 'then' ? undefined : async (...args: unknown[]) => {
      if (name === 'registerJobTool' && args[0] === KIND && isObj(args[1])) tools.push(args[1]);
      return undefined;
    }),
  });
  const mod = (await import(pathToFileURL(join(PLUGIN, 'index.ts')).href)) as { default: (deep: unknown) => Promise<void> | void };
  await mod.default(deepApi);
  const tool = tools.find((t) => typeof t['tool'] === 'string' && t['tool'].startsWith(`${TOOL_NAME}@`));
  expect(tool, `the plug-in registers its tool ${TOOL_NAME}@<version> for ${KIND} through deep.registerJobTool: it registered ${show(tools.map((t) => t['tool']))}`).toBeDefined();
  const run = (tool!['run'] ?? {}) as Line;
  expect(typeof run['dir'] === 'string' && typeof run['entry'] === 'string', `${String(tool!['tool'])} runs on this machine from its own files, run {dir, entry}: ${show(run)}`).toBe(true);
  const dir = join(PLUGIN, run['dir'] as string);
  return { dir, entry: join(dir, run['entry'] as string) };
}
/** The tool's request, as the job API hands it one: `{params, inputs}`; the kind declares no inputs. */
export const request = (params: Line): Line => ({ params, inputs: {} });
/** An answer's outputs, each decoded from base64. */
export function answerOutputs(answer: Line, what: string): { svg: Buffer; probe: Line } {
  const out = (answer['outputs'] ?? {}) as Line;
  expect(typeof out['svg'] === 'string' && typeof out['probe'] === 'string', `${what}: the tool answers {outputs: {svg, probe}}, each in base64: ${show(answer)}`).toBe(true);
  const probe = parse(Buffer.from(out['probe'] as string, 'base64').toString('utf8'));
  expect(probe, `${what}: the probe is a JSON object`).toBeDefined();
  return { svg: Buffer.from(out['svg'] as string, 'base64'), probe: probe! };
}

/** One process of the tool: requests written one per line, each answer read as one line, timed. */
export class ToolProcess {
  readonly child: ChildProcess;
  readonly started = performance.now();
  private lines: { text: string; at: number }[] = [];
  private wakers = new Set<() => void>();
  private stderr = '';
  private constructor(entry: string, dir: string, home: string) {
    this.child = spawn(NODE, [entry], { cwd: dir, env: { PATH: '/usr/bin:/bin', HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    if (this.child.pid) owned.add(this.child.pid);
    let buffer = '';
    this.child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      const at = performance.now();
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { this.lines.push({ text: buffer.slice(0, i), at }); buffer = buffer.slice(i + 1); }
      for (const w of [...this.wakers]) w();
    });
    this.child.stderr!.setEncoding('utf8').on('data', (d: string) => (this.stderr = (this.stderr + d).slice(-4000)));
    this.child.on('exit', () => { for (const w of [...this.wakers]) w(); });
    this.child.stdin!.on('error', () => undefined);
  }
  static start(files: { dir: string; entry: string }): ToolProcess {
    return new ToolProcess(files.entry, files.dir, tempDir());
  }
  /** Writes one request line; the time it was written. */
  send(req: Line): number {
    const at = performance.now();
    this.child.stdin!.write(`${JSON.stringify(req)}\n`);
    return at;
  }
  /** The n-th answer line (0-based), parsed, and when it arrived. */
  answer(n: number, what: string, timeoutMs = 120_000): Promise<{ answer: Line; at: number }> {
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { this.wakers.delete(check); fail(Error(`${what}: the tool gave no answer line ${n + 1} in ${timeoutMs} ms; stderr ${JSON.stringify(this.stderr.slice(-1500))}`)); }, timeoutMs);
      const check = () => {
        const line = this.lines[n];
        if (line) {
          clearTimeout(timer); this.wakers.delete(check);
          const answer = parse(line.text);
          if (answer) done({ answer, at: line.at });
          else fail(Error(`${what}: the tool's answer line ${n + 1} is no JSON object: ${line.text.slice(0, 600)}`));
        } else if (this.child.exitCode !== null || this.child.signalCode !== null) {
          clearTimeout(timer); this.wakers.delete(check);
          fail(Error(`${what}: the tool ended (exit ${String(this.child.exitCode ?? this.child.signalCode)}) before answer line ${n + 1}; stderr ${JSON.stringify(this.stderr.slice(-1500))}`));
        }
      };
      this.wakers.add(check);
      check();
    });
  }
  /** Ends its input and waits for it to exit: its exit code. */
  async end(): Promise<number | null> {
    this.child.stdin!.end();
    const ended = new Promise<void>((done) => (this.child.exitCode !== null || this.child.signalCode !== null ? done() : this.child.once('exit', () => done())));
    await Promise.race([ended, sleep(30_000)]);
    if (this.child.exitCode === null && this.child.signalCode === null) { this.child.kill('SIGKILL'); await ended; }
    return this.child.exitCode;
  }
}
/** One request to a fresh process of the tool on this Mac: its answer. */
export async function runToolOnce(files: { dir: string; entry: string }, req: Line, what: string): Promise<Line> {
  const p = ToolProcess.start(files);
  p.send(req);
  const { answer } = await p.answer(0, what);
  const code = await p.end();
  expect(code, `${what}: the tool exits 0 at the end of its input`).toBe(0);
  return answer;
}

// ---- Linux x86_64: the same tool in a linux/amd64 container of the repo's Node (README: The surface under test, 6).

/** The repo's Node, as `.node-version` pins it. */
function nodeVersion(): string {
  return readFileSync(join(REPO, '.node-version'), 'utf8').trim().replace(/^v/, '');
}
export const linuxImage = (): string => `node:${nodeVersion()}-bookworm-slim`;
interface Docked { status: number | null; timedOut: boolean; stdout: string; stderr: string }
function docker(args: string[], input: string | undefined, timeoutMs: number): Docked {
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) return { status: null, timedOut, stdout: '', stderr: r.error.message };
  return { status: r.status, timedOut, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
/** Why Linux x86_64 can't run here (no Docker, or no linux/amd64 image of the repo's Node), or null when it can. */
export function linuxMissing(): string | null {
  const info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 30_000);
  if (info.status !== 0) return `Docker is unreachable (${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); the second target triple runs in a linux/amd64 container`;
  const image = linuxImage();
  const arch = docker(['image', 'inspect', '--platform', 'linux/amd64', '--format', '{{.Architecture}}', image], undefined, 30_000);
  const any = arch.status === 0 ? arch : docker(['image', 'inspect', '--format', '{{.Architecture}}', image], undefined, 30_000);
  if (any.stdout.trim() !== 'amd64') return `Docker has no linux/amd64 image ${image}, and this suite pulls no image; run once: docker pull --platform linux/amd64 ${image}`;
  return null;
}
/**
 * One request to the tool in a linux/amd64 container with no network, its plug-in folder mounted read-only: its answer,
 * or why the container decided nothing (Docker couldn't start it, it ran out of time, or it or Node under emulation was
 * killed by a signal). The tool's own failure (another exit, no answer line) fails.
 */
export function runToolOnLinux(files: { dir: string; entry: string }, req: Line): { answer: Line } | { open: string } {
  const inside = (p: string): string => `/plugin/${relative(PLUGIN, p).split('\\').join('/')}`;
  const r = docker([
    'run', '--rm', '-i', '--platform', 'linux/amd64', '--network', 'none', '-v', `${PLUGIN}:/plugin:ro`, '-w', inside(files.dir),
    '-e', 'HOME=/tmp', '-e', 'PATH=/usr/local/bin:/usr/bin:/bin', linuxImage(), 'timeout', '600', 'node', inside(files.entry),
  ], `${JSON.stringify(req)}\n`, 900_000);
  const tail = r.stderr.trim().slice(-3000);
  if (r.status === null && !r.timedOut) return { open: `docker could not run: ${tail}` };
  if (r.timedOut || r.status === 124) return { open: `the tool in ${linuxImage()} (linux/amd64) didn't answer within 10 min: ${tail}` };
  if (r.status === 125) return { open: `docker could not start the container: ${tail}` };
  if (r.status === 132 || r.status === 137 || r.status === 139) return { open: `Node in ${linuxImage()} (linux/amd64, emulated) was killed by a signal (exit ${String(r.status)}): ${tail}` };
  expect(r.status, `the tool in ${linuxImage()} (linux/amd64) exits 0: ${tail}`).toBe(0);
  const answer = parse(r.stdout.split('\n').find((l) => l.trim() !== '') ?? '');
  expect(answer, `the tool in ${linuxImage()} (linux/amd64) answers one JSON line: ${r.stdout.slice(0, 600)}`).toBeDefined();
  return { answer: answer! };
}

// ---- The perf lane's rule: scripts/benchmark.mjs's judgeLimit and fingerprint, imported, never copied.
export const load = (): number => loadavg()[0]!;
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<Line> {
  const bench = (await import(pathToFileURL(join(REPO, 'scripts', 'benchmark.mjs')).href)) as { fingerprint: () => Line; judgeLimit: (o: unknown) => Line };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}

// ---------------------------------------------------------------------------------------------------
// Reading an SVG (README: How each criterion is read): its elements, its part groups, and their outlines in the root's
// user space with every transform applied. The reader is this suite's own; it reads the elements that draw (path, rect,
// polygon, polyline, line, circle, ellipse, inside g, a and svg) and skips those that draw only where referenced.

export interface El { name: string; local: string; attrs: Record<string, string>; children: El[] }
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string): string => s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => (e.startsWith('#x') ? String.fromCodePoint(parseInt(e.slice(2), 16)) : e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1))) : ENTITIES[e] ?? m));
/** The document's root element; malformed XML throws, naming where. */
export function parseXml(text: string): El {
  const top: El = { name: '#document', local: '#document', attrs: {}, children: [] };
  const stack: El[] = [top];
  let i = 0;
  const fail = (why: string): never => { throw Error(`the SVG isn't well-formed XML at byte ${i}: ${why}`); };
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    i = lt;
    if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i + 4); if (e < 0) fail('an unclosed comment'); i = e + 3; continue; }
    if (text.startsWith('<![CDATA[', i)) { const e = text.indexOf(']]>', i); if (e < 0) fail('an unclosed CDATA section'); i = e + 3; continue; }
    if (text.startsWith('<?', i)) { const e = text.indexOf('?>', i); if (e < 0) fail('an unclosed processing instruction'); i = e + 2; continue; }
    if (text.startsWith('<!', i)) {
      let depth = 0;
      let j = i + 2;
      for (; j < text.length; j++) { if (text[j] === '[') depth++; else if (text[j] === ']') depth--; else if (text[j] === '>' && depth <= 0) break; }
      i = j + 1;
      continue;
    }
    if (text[i + 1] === '/') {
      const e = text.indexOf('>', i);
      if (e < 0) fail('an unclosed end tag');
      const name = text.slice(i + 2, e).trim();
      const open = stack.pop();
      if (!open || open === top || open.name !== name) fail(`</${name}> closes <${open?.name ?? 'nothing'}>`);
      i = e + 1;
      continue;
    }
    let j = i + 1;
    const nameMatch = /^[^\s/>]+/.exec(text.slice(j, j + 200));
    if (!nameMatch) fail('a tag with no name');
    const name = nameMatch![0];
    j += name.length;
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    for (;;) {
      while (j < text.length && /\s/.test(text[j]!)) j++;
      if (j >= text.length) fail(`<${name}> never ends`);
      if (text[j] === '/' && text[j + 1] === '>') { selfClosing = true; j += 2; break; }
      if (text[j] === '>') { j += 1; break; }
      const an = /^[^\s=/>]+/.exec(text.slice(j, j + 200));
      if (!an) fail(`a bad attribute in <${name}>`);
      j += an![0].length;
      while (/\s/.test(text[j] ?? '')) j++;
      if (text[j] !== '=') fail(`the attribute ${an![0]} of <${name}> has no value`);
      j++;
      while (/\s/.test(text[j] ?? '')) j++;
      const quote = text[j];
      if (quote !== '"' && quote !== "'") fail(`the attribute ${an![0]} of <${name}> isn't quoted`);
      const end = text.indexOf(quote!, j + 1);
      if (end < 0) fail(`the attribute ${an![0]} of <${name}> never ends`);
      attrs[an![0]] = decode(text.slice(j + 1, end));
      j = end + 1;
    }
    const el: El = { name, local: name.includes(':') ? name.slice(name.indexOf(':') + 1) : name, attrs, children: [] };
    stack[stack.length - 1]!.children.push(el);
    if (!selfClosing) stack.push(el);
    i = j;
  }
  if (stack.length !== 1) fail(`<${stack[stack.length - 1]!.name}> is never closed`);
  const roots = top.children;
  if (roots.length !== 1 || roots[0]!.local !== 'svg') fail(`the document's one root element is <svg>, not ${roots.map((r) => `<${r.name}>`).join(', ') || 'nothing'}`);
  return roots[0]!;
}
/** Every element under (and with) `el`, in document order. */
export function elements(el: El): El[] {
  return [el, ...el.children.flatMap(elements)];
}
/** The part groups: the `<g>` elements that carry both `id` and `data-source` (the design's part groups). */
export const partGroups = (root: El): El[] => elements(root).filter((e) => e.local === 'g' && e.attrs['id'] !== undefined && e.attrs['data-source'] !== undefined);
/** The root's viewBox, else [0, 0, width, height], as the import reads it. */
export function viewBoxOf(root: El): [number, number, number, number] {
  const v = (root.attrs['viewBox'] ?? '').trim().split(/[\s,]+/).map(Number);
  if (v.length === 4 && v.every(Number.isFinite) && v[2]! > 0 && v[3]! > 0) return v as [number, number, number, number];
  const side = (k: string): number => { const n = parseFloat(root.attrs[k] ?? ''); return Number.isFinite(n) && n > 0 ? n : 100; };
  return [0, 0, side('width'), side('height')];
}

/** An affine map [a, b, c, d, e, f]: (x, y) → (a x + c y + e, b x + d y + f). */
export type M = [number, number, number, number, number, number];
const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
export type P = [number, number];
const apply = (m: M, p: P): P => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
function transformOf(text: string | undefined): M {
  let m: M = ID;
  for (const [, fn, args] of (text ?? '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const n = args!.trim().split(/[\s,]+/).filter((s) => s !== '').map(Number);
    const r = (deg: number) => (deg * Math.PI) / 180;
    let t: M = ID;
    if (fn === 'matrix' && n.length === 6) t = n as M;
    else if (fn === 'translate') t = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
    else if (fn === 'scale') t = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const a = r(n[0] ?? 0);
      const rot: M = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
      t = n.length >= 3 ? mul(mul([1, 0, 0, 1, n[1]!, n[2]!], rot), [1, 0, 0, 1, -n[1]!, -n[2]!]) : rot;
    } else if (fn === 'skewX') t = [1, 0, Math.tan(r(n[0] ?? 0)), 1, 0, 0];
    else if (fn === 'skewY') t = [1, Math.tan(r(n[0] ?? 0)), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
}

/** One sub-path in the root's user space: its verbs (M, L, Q, C, A:<radii, rotation, flags>, Z) and each verb's points. */
export interface Sub { verbs: string[]; pts: P[][] }
/** A path's `d` read into sub-paths in its own space: relative commands made absolute, H and V as L, S and T as C and Q. */
function readD(d: string): Sub[] {
  const subs: Sub[] = [];
  let i = 0;
  const skip = () => { while (i < d.length && /[\s,]/.test(d[i]!)) i++; };
  const num = (): number => {
    skip();
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(i, i + 64));
    if (!m) throw Error(`path data: a number expected at ${i}: ${JSON.stringify(d.slice(i, i + 24))}`);
    i += m[0].length;
    return Number(m[0]);
  };
  const flag = (): number => { skip(); const c = d[i]; if (c !== '0' && c !== '1') throw Error(`path data: an arc flag expected at ${i}`); i++; return Number(c); };
  let cmd = '';
  let cur: P = [0, 0];
  let start: P = [0, 0];
  let lastC: P | null = null;
  let lastQ: P | null = null;
  // The open sub-path, or none after a Z (a drawing command then opens one at the last start).
  const open: { sub: Sub | null } = { sub: null };
  const push = (verb: string, pts: P[]): void => {
    if (!open.sub) { open.sub = { verbs: ['M'], pts: [[cur]] }; subs.push(open.sub); }
    open.sub.verbs.push(verb);
    open.sub.pts.push(pts);
  };
  // One segment a turn: a number where a command letter could stand repeats the last command (after M, as L).
  for (;;) {
    skip();
    if (i >= d.length) break;
    if (/[A-Za-z]/.test(d[i]!)) cmd = d[i++]!;
    else if (!cmd || cmd === 'Z' || cmd === 'z') throw Error(`path data: numbers with no command at ${i}: ${JSON.stringify(d.slice(i, i + 24))}`);
    const rel = cmd === cmd.toLowerCase();
    const at = (x: number, y: number): P => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      if (open.sub) { open.sub.verbs.push('Z'); open.sub.pts.push([]); }
      cur = start; open.sub = null; lastC = null; lastQ = null;
    } else if (C === 'M') {
      cur = at(num(), num()); start = cur;
      open.sub = { verbs: ['M'], pts: [[cur]] }; subs.push(open.sub);
      cmd = rel ? 'l' : 'L'; lastC = null; lastQ = null;
    } else if (C === 'L') { cur = at(num(), num()); push('L', [cur]); lastC = null; lastQ = null; }
    else if (C === 'H') { const x = num(); cur = [rel ? cur[0] + x : x, cur[1]]; push('L', [cur]); lastC = null; lastQ = null; }
    else if (C === 'V') { const y = num(); cur = [cur[0], rel ? cur[1] + y : y]; push('L', [cur]); lastC = null; lastQ = null; }
    else if (C === 'C') { const c1 = at(num(), num()); const c2 = at(num(), num()); const p = at(num(), num()); push('C', [c1, c2, p]); cur = p; lastC = c2; lastQ = null; }
    else if (C === 'S') { const c1: P = lastC ? [2 * cur[0] - lastC[0], 2 * cur[1] - lastC[1]] : cur; const c2 = at(num(), num()); const p = at(num(), num()); push('C', [c1, c2, p]); cur = p; lastC = c2; lastQ = null; }
    else if (C === 'Q') { const c = at(num(), num()); const p = at(num(), num()); push('Q', [c, p]); cur = p; lastQ = c; lastC = null; }
    else if (C === 'T') { const c: P = lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : cur; const p = at(num(), num()); push('Q', [c, p]); cur = p; lastQ = c; lastC = null; }
    else if (C === 'A') {
      const rx = num(); const ry = num(); const rot = num(); const large = flag(); const sweep = flag(); const p = at(num(), num());
      push(`A:${rx},${ry},${rot},${large},${sweep}`, [p]); cur = p; lastC = null; lastQ = null;
    } else throw Error(`path data: the command ${cmd} isn't SVG's`);
  }
  return subs;
}
const K = 0.5522847498307936;
/** An element's own geometry as sub-paths in its own space, or [] for one that draws nothing. */
function geometry(el: El): Sub[] {
  const n = (k: string): number => { const v = parseFloat(el.attrs[k] ?? '0'); return Number.isFinite(v) ? v : 0; };
  const poly = (closed: boolean): Sub[] => {
    const v = (el.attrs['points'] ?? '').trim().split(/[\s,]+/).filter((s) => s !== '').map(Number);
    if (v.length < 2) return [];
    const pts: P[][] = [];
    for (let k = 0; k + 1 < v.length; k += 2) pts.push([[v[k]!, v[k + 1]!]]);
    return [{ verbs: ['M', ...pts.slice(1).map(() => 'L'), ...(closed ? ['Z'] : [])], pts: [...pts, ...(closed ? [[] as P[]] : [])] }];
  };
  const oval = (cx: number, cy: number, rx: number, ry: number): Sub[] => {
    if (rx <= 0 || ry <= 0) return [];
    const q = (a: P, b: P, c: P): P[] => [a, b, c];
    return [{
      verbs: ['M', 'C', 'C', 'C', 'C', 'Z'],
      pts: [[[cx + rx, cy]], q([cx + rx, cy + K * ry], [cx + K * rx, cy + ry], [cx, cy + ry]), q([cx - K * rx, cy + ry], [cx - rx, cy + K * ry], [cx - rx, cy]), q([cx - rx, cy - K * ry], [cx - K * rx, cy - ry], [cx, cy - ry]), q([cx + K * rx, cy - ry], [cx + rx, cy - K * ry], [cx + rx, cy]), []],
    }];
  };
  switch (el.local) {
    case 'path': return readD(el.attrs['d'] ?? '');
    case 'rect': {
      const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')];
      return w > 0 && h > 0 ? [{ verbs: ['M', 'L', 'L', 'L', 'Z'], pts: [[[x, y]], [[x + w, y]], [[x + w, y + h]], [[x, y + h]], []] }] : [];
    }
    case 'polygon': return poly(true);
    case 'polyline': return poly(false);
    case 'line': return [{ verbs: ['M', 'L'], pts: [[[n('x1'), n('y1')]], [[n('x2'), n('y2')]]] }];
    case 'circle': return oval(n('cx'), n('cy'), n('r'), n('r'));
    case 'ellipse': return oval(n('cx'), n('cy'), n('rx'), n('ry'));
    default: return [];
  }
}
/** Containers whose children draw where they stand. */
const CONTAINERS = new Set(['svg', 'g', 'a', 'switch']);
const placed = (s: Sub, m: M): Sub => ({ verbs: s.verbs, pts: s.pts.map((ps) => ps.map((p) => apply(m, p))) });
/** What `el` and its children draw, as sub-paths in the root's user space, given the map from `el`'s parent's space. */
function drawnUnder(el: El, parent: M, isRoot: boolean): Sub[] {
  if (el.attrs['display'] === 'none') return [];
  let m = mul(parent, transformOf(el.attrs['transform']));
  if (el.local === 'svg' && !isRoot) m = mul(m, [1, 0, 0, 1, parseFloat(el.attrs['x'] ?? '0') || 0, parseFloat(el.attrs['y'] ?? '0') || 0]);
  if (CONTAINERS.has(el.local)) return el.children.flatMap((c) => drawnUnder(c, m, false));
  return geometry(el).map((s) => placed(s, m));
}
/** The map from an element's own space to the root's user space, its own transform included: by its ancestors' path. */
function mapTo(root: El, target: El): M | undefined {
  const walk = (el: El, parent: M, isRoot: boolean): M | undefined => {
    let m = mul(parent, transformOf(el.attrs['transform']));
    if (el.local === 'svg' && !isRoot) m = mul(m, [1, 0, 0, 1, parseFloat(el.attrs['x'] ?? '0') || 0, parseFloat(el.attrs['y'] ?? '0') || 0]);
    if (el === target) return m;
    for (const c of el.children) { const found = walk(c, m, false); if (found) return found; }
    return undefined;
  };
  return walk(root, ID, true);
}
/** One part group's outlines: every sub-path drawn inside it, in the root's user space. */
export function outlinesOf(root: El, group: El): Sub[] {
  const m = mapTo(root, group)!;
  // The group's own transform is in m; its children are drawn under it.
  return group.children.flatMap((c) => drawnUnder(c, m, false));
}
export interface Part { id: string; source: string; subs: Sub[] }
/** An SVG's part groups in document order, each with its id, its data-source and its outlines. */
export function partsOf(svg: Buffer | string): { root: El; parts: Part[] } {
  const root = parseXml(typeof svg === 'string' ? svg : svg.toString('utf8'));
  return { root, parts: partGroups(root).map((g) => ({ id: g.attrs['id']!, source: g.attrs['data-source']!, subs: outlinesOf(root, g) })) };
}
const sameSub = (a: Sub, b: Sub, tol: number): boolean =>
  a.verbs.length === b.verbs.length && a.verbs.every((v, k) => v === b.verbs[k]) &&
  a.pts.every((ps, k) => ps.length === b.pts[k]!.length && ps.every((p, j) => Math.abs(p[0] - b.pts[k]![j]![0]) <= tol && Math.abs(p[1] - b.pts[k]![j]![1]) <= tol));
const subText = (s: Sub): string => s.verbs.map((v, k) => `${v.split(':')[0]}${s.pts[k]!.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(' ')}`).join(' ').slice(0, 160);
/**
 * Two collections of sub-paths compared as multisets, point for point within `tol` user units: each failure names a
 * sub-path one side has and the other lacks.
 */
export function sameOutlines(left: readonly Sub[], right: readonly Sub[], tol: number, names: [string, string]): string[] {
  const unmatched = [...right];
  const extra: Sub[] = [];
  for (const s of left) {
    const k = unmatched.findIndex((r) => sameSub(s, r, tol));
    if (k >= 0) unmatched.splice(k, 1);
    else extra.push(s);
  }
  return [
    ...extra.slice(0, 10).map((s) => `${names[0]} has a sub-path ${names[1]} lacks: ${subText(s)}`),
    ...unmatched.slice(0, 10).map((s) => `${names[1]} has a sub-path ${names[0]} lacks: ${subText(s)}`),
    ...(extra.length + unmatched.length > 20 ? [`… ${extra.length} and ${unmatched.length} unmatched in all (of ${left.length} and ${right.length})`] : []),
  ];
}
/** Sub-paths moved by (dx, dy): a mutant the outline comparison must catch. */
export const moved = (subs: readonly Sub[], dx: number, dy: number): Sub[] => subs.map((s) => ({ verbs: s.verbs, pts: s.pts.map((ps) => ps.map((p) => [p[0] + dx, p[1] + dy] as P)) }));

/** The extrema in (0, 1) of one coordinate of a quadratic or cubic Bézier, by its derivative's roots. */
function extremaT(c: number[]): number[] {
  if (c.length === 3) { const den = c[0]! - 2 * c[1]! + c[2]!; return den === 0 ? [] : [(c[0]! - c[1]!) / den]; }
  const [p0, p1, p2, p3] = c as [number, number, number, number];
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const cc = p1 - p0;
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-cc / b];
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return [];
  return [(-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a)];
}
const bez = (c: number[], t: number): number => (c.length === 3 ? (1 - t) ** 2 * c[0]! + 2 * (1 - t) * t * c[1]! + t * t * c[2]! : (1 - t) ** 3 * c[0]! + 3 * (1 - t) ** 2 * t * c[1]! + 3 * (1 - t) * t * t * c[2]! + t ** 3 * c[3]!);
/** The bounds [x0, y0, x1, y1] of the curves the sub-paths draw (curve extrema, not control points), or null for none. */
export function boundsOf(subs: readonly Sub[]): [number, number, number, number] | null {
  let b: [number, number, number, number] | null = null;
  const add = (p: P) => { b = b ? [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])] : [p[0], p[1], p[0], p[1]]; };
  for (const s of subs) {
    let cur: P = s.pts[0]?.[0] ?? [0, 0];
    add(cur);
    s.verbs.forEach((v, k) => {
      const ps = s.pts[k]!;
      if (v === 'M' || v === 'Z' || !ps.length) { if (v === 'M' && ps[0]) cur = ps[0]; return; }
      if (v === 'Q' || v === 'C') {
        const ctl = [cur, ...ps];
        for (const axis of [0, 1]) {
          const c = ctl.map((p) => p[axis]!);
          for (const t of extremaT(c)) if (t > 0 && t < 1) {
            const q: P = [bez(ctl.map((p) => p[0]), t), bez(ctl.map((p) => p[1]), t)];
            add(q);
          }
        }
      }
      cur = ps[ps.length - 1]!;
      add(cur);
    });
  }
  return b;
}
export const centreOf = (b: [number, number, number, number]): P => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

// ---------------------------------------------------------------------------------------------------
// deep-show run (README: The surface under test, 7 and 8): #393's scenario, `deep show` of a whole document from your
// shell with its issues, and #387's `eval` with `film: true`, read from #494's `film.morphs`.

export type V2 = [number, number];
export const FLICKS = 705_600_000;
export const fl = (s: number): number => Math.round(s * FLICKS);
const LAYER = 'main';
const LAYERS: Line = { [LAYER]: { writer: 'agent-a', title: 'Main', order: 'a0' } };
export const PAGE: V2 = [800, 450];
/** A film of the page with a still 2D camera over it (y down), its vector items, and `extra` (its transitions). */
export function film(id: string, items: Line[], extra: Line = {}): Line {
  const cam: Line = { id: 'cam', kind: 'camera@1', layer: LAYER, name: 'Camera cam', order: 'a0cam', params: { projection: 'orthographic', target: [PAGE[0] / 2, PAGE[1] / 2, 0], view_width: PAGE[0] } };
  return {
    format: 1, id, profile: 'film', title: `#220 ${id}`, description: `The #220 acceptance tests' film ${id}.`, size: PAGE, camera: 'cam', layers: LAYERS,
    transport: { span: '2s' }, requires: { modules: { vector: '^1' } }, items: Object.fromEntries([cam, ...items].map((i) => [String(i['id']), i])), ...extra,
  };
}
/** A vector@1 over the SVG `src`, its viewBox placed into `size` from `pos`, `currentColor` drawn in ink, `alt` its source. */
export function vector(id: string, src: string, size: V2, pos: V2, alt: string): Line {
  return { id, kind: 'vector@1', layer: LAYER, name: `Formula ${id}`, order: `d${id}`, params: { src, size: [...size], colors: { currentColor: 'ink' }, alt }, at: { pos: [pos[0], pos[1], 0] } };
}
/** Where the import places a point of the SVG's user space: the viewBox scaled uniformly into `size` from `pos`, centred on the axis it doesn't fill. */
export function placeIn(viewBox: [number, number, number, number], size: V2, pos: V2): (p: P) => P {
  const [vx, vy, vw, vh] = viewBox;
  const s = Math.min(size[0] / vw, size[1] / vh);
  const ox = pos[0] + (size[0] - vw * s) / 2;
  const oy = pos[1] + (size[1] - vh * s) / 2;
  return (p) => [(p[0] - vx) * s + ox, (p[1] - vy) * s + oy];
}
/** A 1 s match morph from one item to another, its window [0 s, 1 s] (`at` its centre), linear (as #494's suite reads it). */
export const matchMorph = (from: string, to: string): Line => ({ from, to, kind: 'match_morph', at: '0.5s', span: '1s', progress: 'linear', match_morph: {} });

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = { a: ulid('01JB220D', 1), b: ulid('01JB220D', 2) } as const;
const YOU_PEER: Line = { pid: 3002, start: 3_000 };
const PROCESSES: Line[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
/** A scenario: the evidence store, your shell's process tree, one panel, the documents, and the calls. */
export function scenario(evidence: string, calls: Line[]): Line {
  return { evidence, sessions: {}, processes: PROCESSES, panels: { main: { rect: [0, 0, 1920, 1080] } }, docs: { [DOC.a]: { panel: 'main' }, [DOC.b]: { panel: 'main' } }, calls };
}
/** `deep show` of a whole document from your shell, with its issues (no `layers`, no item `layer`: the hub stamps them). */
export function present(doc: string, document: Line): Line {
  const payload = JSON.parse(JSON.stringify(document)) as Line;
  delete payload['layers'];
  for (const item of Object.values(isObj(payload['items']) ? payload['items'] : {})) if (isObj(item)) delete item['layer'];
  return { call: 'deep show', peer: YOU_PEER, doc, document: payload, include: ['issues'] };
}
export const evalCall = (doc: string, t: number): Line => ({ call: 'eval', doc, t, film: true });
/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function runShow(bin: string, sc: Line): Line[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  expect(r.error, `deep-show run ran: ${r.error?.message ?? ''}`).toBeUndefined();
  expect(r.status, `deep-show run exits 0; stdout ${(r.stdout ?? '').slice(0, 1500)}; stderr ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const out = parse((r.stdout ?? '').split('\n').find((l) => l.trim() !== '') ?? '');
  expect(out?.['ok'], `deep-show run accepted the scenario: ${show(out)}`).toBe(true);
  expect(Array.isArray(out!['replies']), 'deep-show run: one reply per call').toBe(true);
  return out!['replies'] as Line[];
}
/** Puts bytes into a scenario's evidence store at their SHA-256, as the hub keeps them. */
export function putStore(evidence: string, bytes: Buffer): string {
  const sha = sha256(bytes);
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}
/** A `deep show` reply's issues: the full list from the store when the reply cut it, else the inline list. */
export function issuesOf(reply: Line, evidence: string): Line[] {
  const sha = reply['issues_evidence'];
  if (typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha)) {
    const path = join(evidence, sha.slice(0, 2), sha.slice(2));
    if (existsSync(path)) { try { const all: unknown = JSON.parse(readFileSync(path, 'utf8')); if (Array.isArray(all)) return all as Line[]; } catch { /* the inline list */ } }
  }
  return Array.isArray(reply['issues']) ? (reply['issues'] as Line[]) : [];
}
/** One piece a match morph draws (#494's `film.morphs.<transition>.pieces`). */
export interface Piece { from: string | null; to: string | null; center: V2; opacity: number }
export function piecesOf(reply: Line, transition: string, what: string): Piece[] {
  expect(reply['outcome'], `${what} is evaluated: ${show(reply)}`).toBe('evaluated');
  const m = reply['film']?.['morphs']?.[transition];
  expect(isObj(m) && Array.isArray(m['pieces']), `${what}: film.morphs.${transition}.pieces: ${show(reply['film'])}`).toBe(true);
  return (m!['pieces'] as Line[]).map((p, i) => {
    const c = p['center'];
    expect(Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number' && typeof p['opacity'] === 'number', `${what}: pieces[${i}] has a centre and an opacity: ${show(p)}`).toBe(true);
    return { from: typeof p['from'] === 'string' ? p['from'] : null, to: typeof p['to'] === 'string' ? p['to'] : null, center: [c[0], c[1]], opacity: p['opacity'] as number };
  });
}
export const dist = (a: V2, b: V2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp2 = (a: V2, b: V2, p: number): V2 => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p];
export const fmt = (p: V2): string => `(${p[0].toFixed(3)}, ${p[1].toFixed(3)})`;

// ---------------------------------------------------------------------------------------------------
// A failed job's reason (README: How each criterion is read, AC3)

/** Every JSON object written inside a text, nested ones included. */
export function jsonObjectsIn(text: string): Line[] {
  const out: Line[] = [];
  for (let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inString) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; continue; }
      if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { const v = parse(text.slice(i, j + 1)); if (v) out.push(v); break; }
    }
  }
  return out;
}
/** A byte range as `[start, end]`, `{start, end}` or `"start..end"`, or null for none of these. */
export function rangeOf(v: unknown): [number, number] | null {
  if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number')) return [v[0] as number, v[1] as number];
  if (isObj(v) && typeof v['start'] === 'number' && typeof v['end'] === 'number') return [v['start'], v['end']];
  const m = typeof v === 'string' ? /^(\d+)\.\.(\d+)$/.exec(v) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}
/** Every string held anywhere inside a value. */
export const stringsIn = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(stringsIn) : isObj(v) ? Object.values(v).flatMap(stringsIn) : []);
