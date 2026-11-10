// Test-side tools for the #1924 acceptance tests: a world of a real hub (`deep hub run`) in a temp home, a render
// DeepBuild made already in its evidence store, an agent stand-in (fixtures/agent.mjs) whose session the hub knows
// from its hooks and whose own `deep mcp` attaches files and runs deep_job, test hosts this process serves on
// 127.0.0.1 that record every request they get, the test plug-ins (fixtures/kind, fixtures/tool) installed with
// `deep install <folder>`, the hub's socket as the cli role, `deep inbox answer`, and the judges a criterion's test and
// its planted hubs share. No hub or CLI module is imported; the evidence store's and the extension host's public
// entries are, for the seeded render and `packageDigest` only.
//
// Safety: every folder is under /tmp/dh1924-* and removed after its file; HOME is a temp home for every child;
// DEEP_*, CLAUDE*, CODEX* and NODE_OPTIONS are left out of their environment; nothing leaves 127.0.0.1; no model is
// called; every process is one this file started, stopped by its PID; every test host is closed after the file.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import { openEvidenceStore, type License } from '../../../packages/evidence/src/index.ts';
import { packageDigest } from '../../../packages/extension-host/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const AGENT = join(FIXTURES, 'agent.mjs');

/** The kind and its tools, as the README names them. */
export const KIND = 'test.hosted';
export const HOSTED_A = 'hosted-a@1.0.0';
export const HOSTED_B = 'hosted-b@1.0.0';
export const OPEN = 'open-a@1.0.0';
/** The open model's two weight files and the capability its call needs. */
export const MODEL = 'model.safetensors';
export const TOKENIZER = 'tokenizer.json';
export const CAPABILITY = 'fp16';
/** The params runs use, as JSON text, the way deep_job takes them. */
export const UPPER = '{"case":"upper"}';
export const LOWER = '{"case":"lower"}';
export const TRIM = '{"case":"upper","trim":true}';

/** The planted hubs this suite selects with DEEP_HUB_PLANT (README, Plants). */
export type HubPlant = 'job-host-asks-again' | 'job-host-sends-early' | 'job-weights-call-anyway' | 'job-weights-not-keyed';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const word = (): string => randomBytes(6).toString('hex');
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
function ulid(ms = Date.now()): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted + Math.floor(Math.random() * 2 ** 40), i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}

// ---- Temp folders, processes and test hosts, all gone after the file.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1924-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
const own = (pid: number | undefined): void => { if (pid) owned.add(pid); };
const servers: Server[] = [];
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
afterAll(async () => {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const server of servers.splice(0)) { server.closeAllConnections(); server.close(); }
  // A hub's own children may still be writing under its home for a moment after it ends.
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
export interface Ran { code: number | null; stdout: string; stderr: string }
export const shown = (r: Ran) => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
function deep(args: readonly string[], home: string, cwd: string): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

// ---- The test hosts: an HTTP server on 127.0.0.1 that records every request it gets (README, The test host).
export interface HostRequest { method: string; path: string; body: Buffer }
export interface Report { weights: { name: string; sha256: string }[]; capabilities: string[] }
export interface TestHost {
  /** `127.0.0.1:<port>`: the host as a grant, an ask and a receipt name it. */
  host: string;
  /** Where a call goes: `http://127.0.0.1:<port>/run`. */
  url: string;
  /** Every request it got, oldest first. */
  requests: HostRequest[];
  /** What it reports at GET /report: the weight files it holds, by name and hash, and its capabilities. */
  report: Report;
}
/** The text a call's params make of the input's text, as #1922's test.upper tool makes it. */
export const convert = (text: string, params: Line): string => {
  const trimmed = params.trim === true ? text.trim() : text;
  return params.case === 'lower' ? trimmed.toLowerCase() : trimmed.toUpperCase();
};
export async function startHost(): Promise<TestHost> {
  const host: TestHost = { host: '', url: '', requests: [], report: { weights: [], capabilities: [] } };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      host.requests.push({ method: req.method ?? '', path: req.url ?? '', body });
      const answer = (status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (req.method === 'GET' && req.url === '/report') return answer(200, host.report);
      if (req.method !== 'POST' || req.url !== '/run') return answer(404, { error: `no ${req.method} ${req.url} here: a call is POST /run, the report GET /report` });
      const call = parse(body.toString('utf8'));
      if (typeof call?.inputs?.text !== 'string') return answer(400, { error: 'a call is {params, inputs: {text: <the bytes, base64>}}' });
      const out = convert(Buffer.from(call.inputs.text as string, 'base64').toString('utf8'), (call.params ?? {}) as Line);
      return answer(200, { outputs: { text: Buffer.from(out, 'utf8').toString('base64') } });
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  host.host = `127.0.0.1:${port}`;
  host.url = `http://${host.host}/run`;
  return host;
}
/** Whether a request carries a file: its bytes raw, in base64 (either alphabet) or in hex. */
export const carries = (r: HostRequest, bytes: Uint8Array): boolean => {
  const b = Buffer.from(bytes);
  return [b, Buffer.from(b.toString('base64')), Buffer.from(b.toString('base64url')), Buffer.from(b.toString('hex'))].some((form) => r.body.includes(form));
};
/** The calls (POST /run) a host got since `mark`. */
export const callsSince = (h: TestHost, mark: number): HostRequest[] => h.requests.slice(mark).filter((r) => r.method === 'POST' && r.path === '/run');
/** Requests as a failure or the proof shows them: method, path and the body's first 200 characters. */
export const briefRequests = (rs: HostRequest[]): string => JSON.stringify(rs.map((r) => `${r.method} ${r.path} ${r.body.toString('utf8').slice(0, 200)}`));

// ---- The test plug-ins: a fixture folder copied, `*.fixture` renamed, probe.json written, its manifest's digest set
// by the extension host's packageDigest.
function unfixture(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (lstatSync(path).isDirectory()) unfixture(path);
    else if (name.endsWith('.fixture')) renameSync(path, join(dir, name.slice(0, -'.fixture'.length)));
  }
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
/** test/hosted-kind: the kind test.hosted. */
export function kindPlugin(dir: string): string {
  cpSync(join(FIXTURES, 'kind'), dir, { recursive: true });
  unfixture(dir);
  return seal(dir, () => undefined);
}
export interface ToolPlan { id: string; version?: string; tool: string; on: TestHost; weights?: { name: string; sha256: string }[]; needs?: string[] }
/** A plug-in adding one tool to test.hosted that runs off the machine, on the test host `on`. */
export function toolPlugin(dir: string, plan: ToolPlan): string {
  cpSync(join(FIXTURES, 'tool'), dir, { recursive: true });
  unfixture(dir);
  writeFileSync(join(dir, 'probe.json'), `${JSON.stringify({ tool: plan.tool, url: plan.on.url, ...(plan.weights ? { weights: plan.weights } : {}), ...(plan.needs ? { needs: plan.needs } : {}) })}\n`);
  return seal(dir, (m) => { m.id = plan.id; m.version = plan.version ?? '1.0.0'; m.job_tools = [{ kind: KIND, tool: plan.tool, host: plan.on.host }]; });
}

// ---- The hub.
export interface Hub { pid: number; socket: string; root: string }
async function startHub(home: string, env: Record<string, string>): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
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
  expect(ready?.ready, `the hub starts${plant ? ` with DEEP_HUB_PLANT=${plant}, a planted program this suite names (README, Plants)` : ''}: ${out.slice(0, 500)} ${err.slice(-1500)}`).toBe(true);
  return { pid: child.pid!, socket: typeof ready!.socket === 'string' ? ready!.socket : join(home, '.deepbuild', 'hub.sock'), root: join(home, '.deepbuild') };
}
/** One call on the hub's socket as the cli role, with the control token and this process for the peer check. */
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
/** The hub's record after log position `after`, through events.read on the cli role. */
export async function events(w: World, after = 0): Promise<Line[]> {
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
export async function yes(w: World, ask: Ask): Promise<Ran> {
  const option = (ask.data.options as Line[] | undefined)?.find((o) => o.decision === 'allow')?.id;
  if (typeof option !== 'string') return { code: null, stdout: '', stderr: `${ask.handle} has no option whose decision is allow: ${JSON.stringify(ask.data.options)}` };
  return deep(['inbox', 'answer', ask.handle, option], w.home, w.tmp);
}
/** The evidence store's entry for a hash (evidence.read), or undefined when it holds none. */
export async function stored(w: World, sha: string): Promise<Line | undefined> {
  const reply = await control(w, 'evidence.read', { sha });
  return reply.error ? undefined : (reply.result?.evidence as Line | undefined);
}

// ---- The agent stand-in and its session, as the hub sees them through their hooks (tests/acceptance/26's).
export interface Session { id: string; cwd: string; transcript: string }
export class Agent {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private seq = BigInt(Date.now()) * 1_000_000n;
  private rpc = 0;
  constructor(private readonly child: ChildProcess, readonly session: Session) {
    child.on('exit', () => { for (const [n, done] of [...this.pending]) done({ n, failed: 'the agent stand-in exited' }); });
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
      }
    });
  }
  private send(command: Line, timeoutMs = 150_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(n); reject(Error(`the agent stand-in gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(n, (line) => {
        clearTimeout(timer);
        this.pending.delete(n);
        if (line.failed) reject(Error(`the agent stand-in failed ${command.op}: ${line.failed}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  /** One hook, from a child of this agent (deep-hook's wire); BLOCKED unless the hub acknowledged it. */
  async hook(hub: Hub, event: string): Promise<void> {
    const s = this.session;
    const payload: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
    if (event === 'SessionStart') Object.assign(payload, { source: 'startup', model: 'claude-haiku-5-5' });
    if (event === 'UserPromptSubmit') Object.assign(payload, { prompt: 'run the hosted tool on my notes', prompt_id: randomUUID() });
    if (event === 'PreToolUse') Object.assign(payload, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `toolu_${randomUUID()}` });
    const request = { v: 1, agent: 'claude-code', event, seq: String(this.seq += 1000n), id: ulid(), matched: [], payload };
    const r = await this.send({ op: 'hook', socket: hub.socket, request, cwd: s.cwd });
    if (!((r.lines as string[] | undefined) ?? []).some((l) => /"ack"/.test(l))) throw Error(`BLOCKED: the hub didn't acknowledge ${event} for ${s.id}: ${JSON.stringify(r)}`);
  }
  /** One JSON-RPC request to this agent's own `deep mcp`, which it starts on first use: the reply. */
  async request(method: string, params: Line, timeoutMs = 120_000): Promise<Line> {
    const r = await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line: { jsonrpc: '2.0', id: `${method}#${++this.rpc}`, method, params }, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return r.reply as Line;
  }
  async notify(method: string): Promise<void> {
    await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line: { jsonrpc: '2.0', method, params: {} } });
  }
}

// ---- deep_* calls through the agent's deep mcp.
export interface Outcome { isError: boolean; value: Line; text: string }
export async function tool(w: World, name: string, args: Line): Promise<Outcome> {
  const reply = await w.agent.request('tools/call', { name, arguments: args });
  if (reply.error) return { isError: true, value: reply.error as Line, text: JSON.stringify(reply.error) };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? String(result.content.find((c: Line) => c?.type === 'text')?.text ?? '') : '';
  const value = (result.structuredContent ?? parse(text) ?? {}) as Line;
  return { isError: result.isError === true, value, text: text || JSON.stringify(value) };
}
/** One deep_job run of test.hosted on one input, named by its hash in the evidence store. */
export const runHosted = (w: World, t: string, params: string, sha: string): Promise<Outcome> => tool(w, 'deep_job', { op: 'run', kind: KIND, tool: t, params, inputs: [{ name: 'text', sha256: sha }] });
export const done = (o: Outcome): boolean => !o.isError && o.value.status === 'done';
export const outputOf = (o: Outcome): string | undefined => o.value.outputs?.text?.sha256;
export const refused = (o: Outcome): boolean => o.isError || o.value.status === 'refused';
/** How a job reads in a failure: the kind, the tool, the params and the input's hash. */
export const jobName = (t: string, params: string, sha: string): string => `the job ${KIND} ${t} ${params} on ${sha}`;
/** A host as a receipt may write it, reduced to `host:port`. */
const hostOf = (h: unknown): string => String(h).replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/.*$/, '');
/** Whether a done run's receipt lists exactly the files it sent, by hash and host; a failure's words if not. */
function receiptWrong(o: Outcome, sent: { sha: string; on: TestHost }[]): string | undefined {
  const listed = o.value.receipt?.sent;
  const got = Array.isArray(listed) ? listed.map((s: Line) => `${String(s?.sha256)} ${hostOf(s?.host)}`).sort() : undefined;
  const want = sent.map((s) => `${s.sha} ${s.on.host}`).sort();
  return JSON.stringify(got) === JSON.stringify(want) ? undefined : `its receipt must list every file it sent, by hash and host (receipt.sent ${JSON.stringify(want)}); it holds ${JSON.stringify(o.value.receipt ?? null)}`;
}

// ---- The world.
export interface World {
  tmp: string; home: string; hub: Hub; agent: Agent;
  /** The agent session's working folder, a git repo holding notes.txt (the file it attaches) and draft.txt. */
  folder: string;
  /** The agent's file and a render DeepBuild made, already in the store: their text and hash. */
  notes: { text: string; sha: string };
  draft: { text: string; sha: string };
  render: { text: string; sha: string };
}
/** A license that lets a file leave every way the store knows, and `job`, the way a hosted job's send reads (README). */
const OPEN_LICENSE = { name: 'yours', allows: ['export', 'report', 'post', 'job'] } as unknown as License;
/**
 * A render DeepBuild made, put in the store under the hub's root before the hub starts, by a writer connected as
 * DeepBuild's renderer: the store keeps origin deepbuild from that connection (#15). The base has no renderer that
 * writes one, so this is the smallest way to have it (README, The surface under test).
 */
async function seedRender(home: string, text: string): Promise<string> {
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  const store = await openEvidenceStore({ root: join(home, '.deepbuild', 'evidence') });
  const put = await store.connect({ role: 'deepbuild', via: 'render' }).put({ bytes: new Uint8Array(Buffer.from(text)), kind: 'render', source: 'canvas:render', redaction: 'complete', license: OPEN_LICENSE });
  if (put.status !== 'stored') throw Error(`harness: the store refused the seeded render: ${put.reason}`);
  return put.evidence.sha256;
}
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
const DONE_YAML = [
  'claims:', '  done:', '    checks: [unit]', 'checks:', '  unit: { type: command, run: "false" }', 'asks:',
  '  deadline: { taste: 3d, authority: 1d, unblock: 2d, exception: 2d, choice: 2d, definition: 4h }',
  '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
  '  fallback: [change-owner]', '',
].join('\n');
/** The agent's working folder: a git repo of its own (never this checkout) with the repo spec and two text files. */
function makeFolder(dir: string, files: Record<string, string>): string {
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), DONE_YAML);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env: { ...process.env, ...GIT_ENV, HOME: dir }, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return realpathSync(dir);
}
/**
 * One world: a temp home whose store holds the render, the agent's working folder, the agent stand-in with its
 * session, a real hub (DEEP_HUB_TEST_CONFIRM stubs the OS confirming you; DEEP_HUB_PLANT for a planted hub), the
 * session established through its hooks, and the agent's deep mcp initialized.
 */
export async function openWorld(plant?: HubPlant): Promise<World> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home);
  const text = (t: string) => ({ text: t, sha: sha256(t) });
  const notes = text(`agent notes ${word()}: the hero walks left`);
  const draft = text(`agent draft ${word()}: never sent by path`);
  const render = text(`render ${word()}: frame 42 of the hero shot`);
  if ((await seedRender(home, render.text)) !== render.sha) throw Error('harness: the seeded render is stored under another hash');
  const folder = makeFolder(join(tmp, 'work'), { 'notes.txt': notes.text, 'draft.txt': draft.text });
  const id = randomUUID();
  const transcript = join(home, '.claude/projects', folder.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, `${JSON.stringify({ type: 'user', sessionId: id, cwd: folder, message: { role: 'user', content: 'start' } })}\n`);
  const child = spawn(NODE, [AGENT], { cwd: folder, env: childEnv(home), stdio: ['pipe', 'pipe', 'inherit'] });
  own(child.pid);
  const agent = new Agent(child, { id, cwd: folder, transcript });
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const hub = await startHub(home, { DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm'), ...(plant ? { DEEP_HUB_PLANT: plant } : {}) });
  for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse']) await agent.hook(hub, event);
  const init = await agent.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1924', version: '0' } });
  if (!init.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(init)}`);
  await agent.notify('notifications/initialized');
  return { tmp, home, hub, agent, folder, notes, draft, render };
}
/** `deep install <folder>`, as you, confirmed by the stubbed OS. */
export const install = (w: World, folder: string): Promise<Ran> => deep(['install', folder], w.home, w.tmp);

// ---- The proof, rewritten each run under $TMPDIR/deep-1924-proof/.
export const PROOF_DIR = join(tmpdir(), 'deep-1924-proof');
export function proof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

// ---- Judges: each returns its failures in words, each starting with its case's label; none is a pass.

export const SETUP = 'setup';
export const ONE_ASK = 'one ask for the agent\'s file';
export const EARLY = 'nothing sent before your answer';
export const AFTER_YES = 'after your yes';
export const SAME_PAIR = 'a second job with the same file and host';
export const OTHER_HOST = 'the same file to another host';
export const RENDER = 'a render DeepBuild made';
export const BY_PATH = 'an input naming a path';

/** The installs a judge needs: each refusal fails, naming the plug-in and what it registers. */
async function installAll(w: World, plugins: [string, string][]): Promise<string[]> {
  for (const [what, folder] of plugins) {
    const ran = await install(w, folder);
    if (ran.code !== 0) return [`${SETUP}: ${what} must install: ${shown(ran)}`];
  }
  return [];
}
/** deep_job called again until it isn't held on an ask, for at most five minutes: every reply. */
async function untilNotHeld(call: () => Promise<Outcome>): Promise<Outcome[]> {
  const replies: Outcome[] = [];
  for (const deadline = Date.now() + 300_000; ;) {
    const o = await call();
    replies.push(o);
    if (o.value.status !== 'held' || Date.now() > deadline) return replies;
    await sleep(1000);
  }
}

/**
 * AC1's judge: hosted-a@1.0.0 (host A) and hosted-b@1.0.0 (host B) installed, the agent attaches notes.txt; that file
 * to host A raises one ask naming its hash and host A and sends nothing until your yes, which lets it go once; a second
 * job of the same file and host asks nothing; the file to host B asks again; the render goes to host B with no ask; an
 * input naming a path is refused before any file is read; and every done run's receipt lists what it sent.
 */
export async function judgeHosted(w: World): Promise<{ failures: string[]; seen: Line }> {
  const failures: string[] = [];
  const seen: Line = { notes: w.notes.sha, render: w.render.sha };
  const fail = (label: string, words: string) => failures.push(`${label}: ${words}`);
  const A = await startHost();
  const B = await startHost();
  const setup = await installAll(w, [
    ['test/hosted-kind (the kind test.hosted, through deep.registerJob)', kindPlugin(join(w.tmp, 'kind'))],
    [`test/hosted-a (the tool ${HOSTED_A}, run {url} on the test host ${A.host}, through deep.registerJobTool)`, toolPlugin(join(w.tmp, 'a'), { id: 'test/hosted-a', tool: HOSTED_A, on: A })],
    [`test/hosted-b (the tool ${HOSTED_B}, run {url} on the test host ${B.host}, through deep.registerJobTool)`, toolPlugin(join(w.tmp, 'b'), { id: 'test/hosted-b', tool: HOSTED_B, on: B })],
  ]);
  if (setup.length) return { failures: setup, seen };

  const attached = await tool(w, 'deep_evidence', { path: 'notes.txt' });
  if (attached.isError || attached.value.sha256 !== w.notes.sha) throw Error(`harness: the agent's deep_evidence of notes.txt didn't store it by its hash: ${attached.text}`);
  const origins = { notes: (await stored(w, w.notes.sha))?.origin, render: (await stored(w, w.render.sha))?.origin };
  if (origins.notes !== 'agent' || origins.render !== 'deepbuild') throw Error(`harness: the store's origins are ${JSON.stringify(origins)}, not notes.txt agent and the render deepbuild`);
  const notes = Buffer.from(w.notes.text);

  // The agent's file to host A: one ask naming its hash and host A, and nothing sent before your answer.
  const job1 = jobName(HOSTED_A, UPPER, w.notes.sha);
  let pos = await lastPos(w);
  let a = A.requests.length;
  let b = B.requests.length;
  const first = await runHosted(w, HOSTED_A, UPPER, w.notes.sha);
  const second = await runHosted(w, HOSTED_A, UPPER, w.notes.sha);
  const raised = await asks(w, pos);
  const early = [...A.requests.slice(a), ...B.requests.slice(b)];
  seen.held = { job: job1, first: first.value, second: second.value, asks: raised.map((r) => ({ handle: r.handle, ...r.data })), early: briefRequests(early) };
  if (early.length) fail(EARLY, `${job1} sent ${early.length} request(s) to its host before your answer${early.some((r) => carries(r, notes)) ? ', holding the agent\'s file' : ''}: ${briefRequests(early)}`);
  if (first.value.status !== 'held' || second.value.status !== 'held') fail(ONE_ASK, `${job1} must be held on its ask until your answer, called once or twice; it answered ${first.text.slice(0, 500)} then ${second.text.slice(0, 500)}`);
  if (raised.length !== 1) fail(ONE_ASK, `${job1}, called twice before your answer, must raise one ask; it raised ${raised.length}: ${JSON.stringify(raised.map((r) => r.data)).slice(0, 1500)}`);
  const ask = raised[0];
  if (!ask) return { failures, seen };
  if (!ask.text.includes(w.notes.sha)) fail(ONE_ASK, `the ask for ${job1} must name the file's hash ${w.notes.sha}: ${ask.text.slice(0, 1500)}`);
  if (!ask.text.includes(A.host)) fail(ONE_ASK, `the ask for ${job1} must name the tool's host ${A.host}: ${ask.text.slice(0, 1500)}`);

  // Your yes: the job runs, the file goes to host A once, and the receipt lists it.
  const answered = await yes(w, ask);
  if (answered.code !== 0) { fail(AFTER_YES, `your yes to ${ask.handle} (deep inbox answer) must count: ${shown(answered)}`); return { failures, seen }; }
  pos = await lastPos(w);
  a = A.requests.length;
  const replies = await untilNotHeld(() => runHosted(w, HOSTED_A, UPPER, w.notes.sha));
  const ran = replies[replies.length - 1]!;
  seen.afterYes = replies.map((r) => r.value);
  if (!done(ran)) fail(AFTER_YES, `${job1} must run after your yes: ${ran.text.slice(0, 800)}`);
  else {
    const went = callsSince(A, a).filter((r) => carries(r, notes));
    if (outputOf(ran) !== sha256(convert(w.notes.text, { case: 'upper' }))) fail(AFTER_YES, `${job1}'s output by hash must be the host's answer, the notes in upper case: ${ran.text.slice(0, 800)}`);
    if (went.length !== 1) fail(AFTER_YES, `${job1} must send the agent's file to ${A.host} once after your yes; the host got it ${went.length} times`);
    const wrong = receiptWrong(ran, [{ sha: w.notes.sha, on: A }]);
    if (wrong) fail(AFTER_YES, `${job1}: ${wrong}`);
  }
  const more = await asks(w, pos);
  if (more.length) fail(AFTER_YES, `${job1} after your yes must raise no other ask: ${JSON.stringify(more.map((r) => r.data)).slice(0, 1000)}`);

  // A second job with the same file and host asks nothing.
  const job2 = jobName(HOSTED_A, LOWER, w.notes.sha);
  pos = await lastPos(w);
  a = A.requests.length;
  const pair = await runHosted(w, HOSTED_A, LOWER, w.notes.sha);
  const pairAsks = await asks(w, pos);
  seen.pair = { reply: pair.value, asks: pairAsks };
  if (pairAsks.length || pair.value.status === 'held') fail(SAME_PAIR, `${job2} asked again for the pair you approved (the agent's file ${w.notes.sha} to ${A.host}): ${pair.text.slice(0, 500)} ${JSON.stringify(pairAsks.map((r) => r.data)).slice(0, 1000)}`);
  else if (!done(pair)) fail(SAME_PAIR, `${job2} must run with no ask: ${pair.text.slice(0, 800)}`);
  else {
    if (outputOf(pair) !== sha256(convert(w.notes.text, { case: 'lower' }))) fail(SAME_PAIR, `${job2}'s output by hash must be the notes in lower case: ${pair.text.slice(0, 800)}`);
    if (callsSince(A, a).filter((r) => carries(r, notes)).length !== 1) fail(SAME_PAIR, `${job2} must send the agent's file to ${A.host} once`);
    const wrong = receiptWrong(pair, [{ sha: w.notes.sha, on: A }]);
    if (wrong) fail(SAME_PAIR, `${job2}: ${wrong}`);
  }

  // The same file to another host asks again, naming that host, and sends nothing.
  const job3 = jobName(HOSTED_B, UPPER, w.notes.sha);
  pos = await lastPos(w);
  b = B.requests.length;
  const other = await runHosted(w, HOSTED_B, UPPER, w.notes.sha);
  const otherAsks = await asks(w, pos);
  seen.other = { reply: other.value, asks: otherAsks };
  if (other.value.status !== 'held' || otherAsks.length !== 1) fail(OTHER_HOST, `${job3} must be held on one new ask: it answered ${other.text.slice(0, 500)} and raised ${otherAsks.length} asks`);
  else if (!otherAsks[0]!.text.includes(w.notes.sha) || !otherAsks[0]!.text.includes(B.host)) fail(OTHER_HOST, `the ask for ${job3} must name the file's hash ${w.notes.sha} and the host ${B.host}: ${otherAsks[0]!.text.slice(0, 1500)}`);
  if (B.requests.length > b) fail(OTHER_HOST, `${job3} sent ${B.requests.length - b} request(s) to ${B.host} before your answer: ${briefRequests(B.requests.slice(b))}`);

  // A render DeepBuild made goes with no ask, to the host that has no answer from you.
  const job4 = jobName(HOSTED_B, UPPER, w.render.sha);
  pos = await lastPos(w);
  b = B.requests.length;
  const render = await runHosted(w, HOSTED_B, UPPER, w.render.sha);
  const renderAsks = await asks(w, pos);
  seen.render = { reply: render.value, asks: renderAsks };
  if (renderAsks.length) fail(RENDER, `${job4} must go without an ask: it raised ${JSON.stringify(renderAsks.map((r) => r.data)).slice(0, 1000)}`);
  if (!done(render)) fail(RENDER, `${job4} must run: ${render.text.slice(0, 800)}`);
  else {
    if (outputOf(render) !== sha256(convert(w.render.text, { case: 'upper' }))) fail(RENDER, `${job4}'s output by hash must be the render's text in upper case: ${render.text.slice(0, 800)}`);
    if (callsSince(B, b).filter((r) => carries(r, Buffer.from(w.render.text))).length !== 1) fail(RENDER, `${job4} must send the render to ${B.host} once`);
    const wrong = receiptWrong(render, [{ sha: w.render.sha, on: B }]);
    if (wrong) fail(RENDER, `${job4}: ${wrong}`);
  }

  // An input naming a path is refused before any file is read: a path to a file and one to nothing get one answer.
  pos = await lastPos(w);
  a = A.requests.length;
  b = B.requests.length;
  const named = join(w.folder, 'draft.txt');
  const nothing = join(w.folder, 'missing.txt');
  const byPath = (path: string) => tool(w, 'deep_job', { op: 'run', kind: KIND, tool: HOSTED_A, params: UPPER, inputs: [{ name: 'text', path }] });
  const toFile = await byPath(named);
  const toNothing = await byPath(nothing);
  seen.byPath = { file: toFile.value, nothing: toNothing.value };
  const job5 = `the job ${KIND} ${HOSTED_A} ${UPPER} on the path ${named}`;
  const shape = (o: Outcome, path: string) => `${o.isError} ${o.text.split(path).join('<path>')}`;
  if (!refused(toFile) || outputOf(toFile) !== undefined) fail(BY_PATH, `${job5} must be refused: ${toFile.text.slice(0, 800)}`);
  else if (shape(toFile, named) !== shape(toNothing, nothing)) fail(BY_PATH, `${job5} must be refused before any file is read, the same as a path to no file; the two answers differ: ${toFile.text.slice(0, 600)} / ${toNothing.text.slice(0, 600)}`);
  if (toFile.text.includes(w.draft.sha)) fail(BY_PATH, `${job5}'s answer holds draft.txt's hash, so the file was read`);
  if (await stored(w, w.draft.sha)) fail(BY_PATH, `${job5}: the store holds draft.txt, so the file was read`);
  const sent = [...A.requests.slice(a), ...B.requests.slice(b)];
  if (sent.length) fail(BY_PATH, `${job5} sent ${sent.length} request(s) to a host: ${briefRequests(sent)}`);
  if ((await asks(w, pos)).length) fail(BY_PATH, `${job5} raised an ask`);
  seen.hosts = { [A.host]: briefRequests(A.requests), [B.host]: briefRequests(B.requests) };
  return { failures, seen };
}

export const BOTH = 'both present';
export const SWAPPED = 'a weight file swapped';
export const MISSING = 'the capability missing';
export const NEW_HASH = 'a new hash under the same version';

/**
 * AC2's judge: open-a@1.0.0 on the test host O, declaring model.safetensors and tokenizer.json by hash and needing
 * fp16, run on the render. With both present it runs, its receipt naming both hashes; with model.safetensors swapped
 * under its name, then with fp16 missing, it is BLOCKED before the call with an unblock ask naming the file, then the
 * capability; test/open-model 1.0.1, declaring a new hash for model.safetensors under the same open-a@1.0.0, misses.
 */
export async function judgeWeights(w: World): Promise<{ failures: string[]; seen: Line }> {
  const failures: string[] = [];
  const seen: Line = { render: w.render.sha };
  const fail = (label: string, words: string) => failures.push(`${label}: ${words}`);
  const O = await startHost();
  const h = { model: sha256(`weights ${MODEL} v1`), tokenizer: sha256(`weights ${TOKENIZER} v1`), swapped: sha256(`weights ${MODEL} v2`) };
  seen.weights = h;
  const weights = (model: string) => [{ name: MODEL, sha256: model }, { name: TOKENIZER, sha256: h.tokenizer }];
  O.report = { weights: weights(h.model), capabilities: [CAPABILITY] };
  const plan = (version: string, model: string): ToolPlan => ({ id: 'test/open-model', version, tool: OPEN, on: O, weights: weights(model), needs: [CAPABILITY] });
  const setup = await installAll(w, [
    ['test/hosted-kind (the kind test.hosted, through deep.registerJob)', kindPlugin(join(w.tmp, 'kind'))],
    [`test/open-model 1.0.0 (the tool ${OPEN} on the test host ${O.host}, declaring ${MODEL} ${h.model} and ${TOKENIZER} ${h.tokenizer} and needing ${CAPABILITY})`, toolPlugin(join(w.tmp, 'open-1'), plan('1.0.0', h.model))],
  ]);
  if (setup.length) return { failures: setup, seen };
  const render = Buffer.from(w.render.text);

  // Both present: the job runs, calling the host once, and its receipt names both weight hashes, which its key holds.
  const job1 = jobName(OPEN, UPPER, w.render.sha);
  let mark = O.requests.length;
  const both = await runHosted(w, OPEN, UPPER, w.render.sha);
  seen.both = { reply: both.value, calls: callsSince(O, mark).length };
  if (!done(both)) fail(BOTH, `${job1}, with both weight files and ${CAPABILITY} on the host, must run: ${both.text.slice(0, 800)}`);
  else {
    if (outputOf(both) !== sha256(convert(w.render.text, { case: 'upper' }))) fail(BOTH, `${job1}'s output by hash must be the host's answer, the render in upper case: ${both.text.slice(0, 800)}`);
    const calls = callsSince(O, mark);
    if (calls.length !== 1 || !carries(calls[0]!, render)) fail(BOTH, `${job1} must call ${O.host} once with the render; it called ${calls.length} times`);
    const receipt = JSON.stringify(both.value.receipt ?? null);
    if (!receipt.includes(h.model) || !receipt.includes(h.tokenizer)) fail(BOTH, `${job1}'s key must hold the weight hashes ${h.model} and ${h.tokenizer}, which its receipt names: ${receipt.slice(0, 800)}`);
  }

  // A mismatch is BLOCKED before the call, with an unblock ask naming what's wrong, and nothing goes to the host.
  const blocked = async (label: string, params: string, names: string): Promise<void> => {
    const job = jobName(OPEN, params, w.render.sha);
    const pos = await lastPos(w);
    const at = O.requests.length;
    const o = await runHosted(w, OPEN, params, w.render.sha);
    const raised = await asks(w, pos);
    const calls = callsSince(O, at);
    seen[label] = { reply: o.value, asks: raised, calls: calls.length };
    if (calls.length) fail(label, `${job} called ${O.host} anyway (${calls.length} call(s)); it must be BLOCKED before the call`);
    if (String(o.value.status).toLowerCase() !== 'blocked') fail(label, `${job} must be BLOCKED: it answered ${o.text.slice(0, 800)}`);
    if (!raised.some((r) => r.kind === 'unblock' && r.text.includes(names))) fail(label, `${job} must raise an unblock ask naming ${names}; the asks raised: ${JSON.stringify(raised.map((r) => r.data)).slice(0, 1500)}`);
  };
  O.report = { weights: weights(h.swapped), capabilities: [CAPABILITY] };
  await blocked(SWAPPED, LOWER, MODEL);
  O.report = { weights: weights(h.model), capabilities: [] };
  await blocked(MISSING, TRIM, CAPABILITY);

  // The same tool version declaring a new hash for one file misses the cache of its earlier run.
  O.report = { weights: weights(h.swapped), capabilities: [CAPABILITY] };
  const upgraded = await install(w, toolPlugin(join(w.tmp, 'open-2'), plan('1.0.1', h.swapped)));
  if (upgraded.code !== 0) { fail(NEW_HASH, `test/open-model 1.0.1, declaring ${OPEN} again with ${MODEL} ${h.swapped}, must install: ${shown(upgraded)}`); return { failures, seen }; }
  mark = O.requests.length;
  const again = await runHosted(w, OPEN, UPPER, w.render.sha);
  const calls = callsSince(O, mark);
  seen.newHash = { reply: again.value, calls: calls.length };
  if (!done(again)) fail(NEW_HASH, `${job1}, under the declaration with ${MODEL} ${h.swapped}, must run: ${again.text.slice(0, 800)}`);
  else if (calls.length !== 1 || !carries(calls[0]!, render)) fail(NEW_HASH, `${job1}, with ${OPEN}'s declaration giving ${MODEL} the new hash ${h.swapped} under the same version, must miss the cache of its earlier run and call ${O.host} once; it called ${calls.length} times${again.value.receipt?.cache === 'hit' ? ', serving the earlier run\'s output: its key lacks the weight hashes' : ''}`);
  else if (!JSON.stringify(again.value.receipt ?? null).includes(h.swapped)) fail(NEW_HASH, `${job1}'s key must hold the new hash ${h.swapped}, which its receipt names: ${JSON.stringify(again.value.receipt ?? null).slice(0, 800)}`);
  seen.host = { [O.host]: briefRequests(O.requests) };
  return { failures, seen };
}
