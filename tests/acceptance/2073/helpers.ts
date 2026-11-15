// Test-side tools for #2073's acceptance tests (README): the fixture repo, a real hub (`deep hub run`) in a temporary
// home, the project's trust decision recorded before the hub starts as #348 records it, an agent stand-in
// (fixtures/agent.mjs) whose hooks and `deep mcp` are its children, and the record read with `events.read`. Adapted
// from tests/acceptance/26/helpers.ts and tests/acceptance/322/helpers.ts (same repo, same license); this suite keeps
// its own copy so a redraft of theirs never moves these tests. Nothing here stands in for DeepBuild: every reading
// comes from the real hub and the real `deep mcp`. Processes are stopped by PID only, never by name or port.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRecord, openTrust } from '../../../packages/record/src/index.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
const NODE = process.execPath;
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const parse = (raw: string): Line | undefined => { try { return JSON.parse(raw) as Line; } catch { return undefined; } };

// The criteria (README: Criteria to tests): `#2073.<first 8 hex of SHA-256 of the criterion's text, trimmed,
// whitespace collapsed, the leading "- [ ] " dropped>`, by the command in tests/acceptance/48/README.md.
export const AC1 = '#2073.c18985be';
export const AC2 = '#2073.77f14713';
export const AC3 = '#2073.7513ec0a';

// ---- The fixture repo (README: The fixture).
/** Its folder's name: letters only, so its path, its name and a project ID made from its name all hold it. */
export const PROJECT = 'shopfront';
/** The tracked file the checks read, what the repo's one commit holds in it, and what the test's edit writes. */
export const FILE = 'state.txt';
export const COMMITTED = 'committed';
export const EDITED = 'edited';
/** The check that passes only where state.txt holds what the commit holds, and the one that passes only on the edit. */
export const HOLDS_COMMITTED = 'holds-committed';
export const HOLDS_EDITED = 'holds-edited';
/** The check that writes the marker file outside the repo. */
export const MARKER = 'marker';
/** checks/holds.mjs: exits 0 when state.txt, in the folder it runs in, holds the word given, 1 when it holds another; prints what it read. */
const HOLDS_SCRIPT = `import { readFileSync } from 'node:fs';
const got = readFileSync('${FILE}', 'utf8').trim();
console.log('${FILE} holds ' + got);
process.exitCode = got === process.argv[2] ? 0 : 1;
`;
/** The repo's spec, as the design's done.yaml example writes command checks. */
const doneYaml = (marker: string): string => [
  'claims:',
  '  done:',
  `    checks: [${HOLDS_COMMITTED}]`,
  'checks:',
  `  ${HOLDS_COMMITTED}: { type: command, run: "node checks/holds.mjs ${COMMITTED}" }`,
  `  ${HOLDS_EDITED}: { type: command, run: "node checks/holds.mjs ${EDITED}" }`,
  `  ${MARKER}: { type: command, run: "echo ran > ${marker}" }`,
  '',
].join('\n');

// ---- ULIDs, for hook IDs and task refs.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
export function ulid(ms = Date.now()): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted + Math.floor(Math.random() * 2 ** 40), i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}

// ---- Temp folders (short: a socket path must fit in 104 bytes on macOS) and the processes this suite started.
const made: string[] = [];
const owned = new Set<number>();
const own = (pid: number | undefined): void => { if (pid) owned.add(pid); };
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
/** Stops every process this suite started, by PID (SIGTERM, then SIGKILL after 3 s), and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** This environment with HOME moved to the test's home and none of this process's hub, agent or git settings. */
function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('TMUX') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key.startsWith('GIT_') || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  return Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' }, extra);
}

// ---- The hub: `deep hub run` with HOME at the test's home, so its root is <home>/.deepbuild.
export interface Hub { pid: number; home: string; socket: string; output(): string }
async function startHub(home: string): Promise<Hub> {
  // #24's OS-confirmation stub, as #26's and #823's hubs have it: nothing here needs your confirmation, and nothing can ask the OS for it.
  const confirm = join(dirname(home), 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 120_000);
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(parse(first.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(home, '.deepbuild', 'hub.sock'), output: () => out };
}

// ---- The record, read through the hub's socket as `deep` reads it: the cli role, with the control token.
function control(hub: Hub, method: string, params: Line, timeoutMs = 30_000): Promise<Line> {
  const token = readFileSync(join(hub.home, '.deepbuild', 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let buffer = '';
    let step = 0;
    const end = (error?: Error, result?: Line) => { clearTimeout(timer); sock.destroy(); if (error) reject(error); else resolve(result!); };
    const timer = setTimeout(() => end(Error(`BLOCKED: no reply to ${method} within ${timeoutMs} ms; the hub ${alive(hub.pid) ? 'runs' : 'exited'}: ${hub.output().slice(-1500)}`)), timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => end(Error(`BLOCKED: the hub's socket failed on ${method}: ${error.message}; the hub ${alive(hub.pid) ? 'runs' : 'exited'}: ${hub.output().slice(-1500)}`)));
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (step === 0) {
          step = 1;
          sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
        } else if (step === 1) {
          if (line?.role !== 'cli') return end(Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(line)}`));
          step = 2;
          sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`);
        } else if (line?.id === 1) {
          if (line.error) end(Error(`BLOCKED: ${method} refused: ${JSON.stringify(line.error)}`));
          else end(undefined, line.result as Line);
        }
      }
    });
  });
}
export interface Ev { id: string; kind: string; subject?: string; session?: string; ts: number; data: Line; log_pos: number }
/** Every event in the hub's log, through `events.read`. */
export async function events(hub: Hub): Promise<Ev[]> {
  const all: Ev[] = [];
  for (let after = 0; ;) {
    const read = await control(hub, 'events.read', { after, limit: 1000 });
    const page = (typeof read.events === 'string' ? JSON.parse(read.events) : read.events) as Ev[];
    if (!page.length) return all;
    all.push(...page);
    after = page[page.length - 1]!.log_pos;
  }
}
/** The first event matching `pred`, reading the log until `timeoutMs` has passed; undefined if none came. */
export async function eventMatching(hub: Hub, pred: (e: Ev) => boolean, timeoutMs: number): Promise<Ev | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = (await events(hub)).find(pred);
    if (found || Date.now() > deadline) return found;
    await sleep(100);
  }
}

// ---- The agent stand-in (fixtures/agent.mjs): its session, as the hub sees it through its hooks, and its own `deep mcp`.
/** A tool call's outcome: `isError`, and its value (structuredContent, else the first text block's JSON). */
export interface Outcome { isError: boolean; value: any; reply: Line }
let requests = 0;
interface Session { id: string; cwd: string; transcript: string }
export class Agent {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private seq = BigInt(Date.now()) * 1_000_000n;
  private constructor(private readonly child: ChildProcess, private readonly home: string, private readonly cwd: string) {
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
  static start(home: string, cwd: string): Agent {
    const child = spawn(NODE, [AGENT], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Agent(child, home, cwd);
  }
  /** A new Claude Code session in the agent's folder, its transcript where Claude Code keeps it under the agent's home. */
  session(): Session {
    const id = randomUUID();
    const transcript = join(this.home, '.claude/projects', this.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(transcript, `${JSON.stringify({ type: 'user', sessionId: id, cwd: this.cwd, message: { role: 'user', content: 'start' } })}\n`);
    return { id, cwd: this.cwd, transcript };
  }
  private send(command: Line, timeoutMs = 150_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(n); reject(Error(`BLOCKED: the agent stand-in gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(n, (line) => {
        clearTimeout(timer);
        this.pending.delete(n);
        if (line.failed) reject(Error(`BLOCKED: the agent stand-in failed ${command.op}: ${line.failed}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  /** One hook, from a child of this agent (deep-hook's wire); throws BLOCKED unless the hub acknowledged it. */
  private async hook(hub: Hub, s: Session, event: string, extra: Line): Promise<void> {
    const payload = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default', ...extra };
    const request = { v: 1, agent: 'claude-code', event, seq: String(this.seq += 1000n), id: ulid(), matched: [], payload };
    const r = await this.send({ op: 'hook', socket: hub.socket, request, cwd: s.cwd });
    if (!(r.lines as string[] ?? []).some((l) => /"ack"/.test(l))) throw Error(`BLOCKED: the hub didn't acknowledge ${event} for ${s.id}: ${JSON.stringify(r)}`);
  }
  /** Its SessionStart, prompt and first tool call, each from a hook process it started, so the hub knows its process. */
  async establish(hub: Hub, s: Session): Promise<void> {
    await this.hook(hub, s, 'SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    await this.hook(hub, s, 'UserPromptSubmit', { prompt: 'make the shop front show its state', prompt_id: randomUUID() });
    await this.hook(hub, s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `toolu_${randomUUID()}` });
  }
  /** One JSON-RPC line to this agent's own `deep mcp`, which the agent starts on first use; a request's reply. */
  async rpc(method: string, params: Line, o: { notify?: boolean; timeoutMs?: number } = {}): Promise<Line> {
    const timeoutMs = o.timeoutMs ?? 120_000;
    const line = { jsonrpc: '2.0', ...(o.notify ? {} : { id: `${method}#${++requests}` }), method, params };
    const r = await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return (r.reply ?? {}) as Line;
  }
  /** One tool call, as an MCP client makes it. */
  async call(tool: string, args: Line, timeoutMs?: number): Promise<Outcome> {
    const reply = await this.rpc('tools/call', { name: tool, arguments: args }, timeoutMs === undefined ? {} : { timeoutMs });
    const result = (reply.result ?? {}) as Line;
    const text = Array.isArray(result.content) ? result.content.find((c: Line) => c?.type === 'text')?.text : undefined;
    const value = reply.error ?? result.structuredContent ?? (typeof text === 'string' ? parse(text) ?? text : undefined);
    return { isError: reply.error !== undefined || result.isError === true, value, reply };
  }
}

export interface World {
  /** The test's own folder, /tmp/dh2073-*: the home, the repo and the marker are in it. */
  tmp: string;
  home: string;
  /** The fixture repo, <tmp>/shopfront, and its one commit. */
  repo: string;
  commit: string;
  /** The file the marker check writes: <tmp>/marker, outside the repo. */
  marker: string;
  hub: Hub;
  agent: Agent;
}
/**
 * A home (<tmp>/h, HOME for every process, holding no Claude Code or Codex trust file), the fixture repo with one
 * commit, the project's trust decision when `trusted` (your answer on the trusted path, appended to the record through
 * `openTrust` as #348 records it, before the hub starts), the hub, an agent stand-in working in the repo with its
 * session established through its hooks, and its `deep mcp` initialized and reaching the hub. Anything of that which
 * fails is BLOCKED, never a criterion's result.
 */
export async function world(o: { trusted: boolean }): Promise<World> {
  if (!existsSync(CLI)) throw Error('BLOCKED: packages/cli/dist/main.js is missing: run `npm run build --workspaces` first (README: How to run)');
  const tmp = realpathSync(mkdtempSync('/tmp/dh2073-'));
  made.push(tmp);
  const home = join(tmp, 'h');
  mkdirSync(home);
  const marker = join(tmp, 'marker');
  const dir = join(tmp, PROJECT);
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  mkdirSync(join(dir, 'checks'));
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), doneYaml(marker));
  writeFileSync(join(dir, 'checks', 'holds.mjs'), HOLDS_SCRIPT);
  writeFileSync(join(dir, FILE), `${COMMITTED}\n`);
  const git = (...args: string[]): string => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd: dir, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
  }).trim();
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  const repo = realpathSync(dir);
  const commit = git('rev-parse', 'HEAD');
  if (o.trusted) {
    mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
    const record = await openRecord({ path: join(home, '.deepbuild', 'ledger.db'), now: Date.now });
    try {
      await (await openTrust({ record, now: Date.now })).answer({ writer: 'app', actor: 'you', scope: 'you' }, repo, true);
    } finally {
      await record.close();
    }
  }
  const agent = Agent.start(home, repo);
  const session = agent.session();
  const hub = await startHub(home);
  await agent.establish(hub, session);
  const initialized = await agent.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-2073', version: '0' } });
  if (!initialized.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(initialized)}`);
  await agent.rpc('notifications/initialized', {}, { notify: true });
  // deep mcp connects to the hub at its first call and gives up after 1 s; on a loaded machine that first connect can
  // miss, so one deep_status is called, up to ten times a second apart, as an `unavailable` refusal's remediation says.
  for (let i = 1; ; i++) {
    const status = await agent.call('deep_status', {});
    if (!status.isError) break;
    if (i === 10 || status.value?.code !== 'unavailable') throw Error(`BLOCKED: deep_status through the agent's deep mcp failed ${i} times: ${JSON.stringify(status.reply).slice(0, 1500)}; the hub ${alive(hub.pid) ? 'runs' : 'exited'}: ${hub.output().slice(-2000)}`);
    await sleep(1000);
  }
  return { tmp, home, repo, commit, marker, hub, agent };
}

/** A text with the test's own folder written `<tmp>`, so a message reads the same on every run. */
export const shown = (w: World, value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)).replaceAll(w.tmp, '<tmp>').slice(0, 1500);

/**
 * deep_claim at the repo's commit, for a task of its own: the claim's handle, once its claim.made, naming that commit,
 * is in the record. A claim that isn't recorded is BLOCKED: every criterion here is about a run for a recorded claim.
 */
export async function claimed(w: World): Promise<string> {
  const made = await w.agent.call('deep_claim', { task_ref: `task:${ulid()}`, attempt: 1, commit: w.commit, scope: 'session', predictions: null });
  const claim = typeof made.value?.claim === 'string' ? made.value.claim as string : `claim:${made.value?.event}`;
  if (made.isError || !/^claim:[0-9A-Za-z]+$/.test(claim)) throw Error(`BLOCKED: deep_claim at ${w.commit} must record the claim the run is for: ${shown(w, made.reply)}`);
  const recorded = await eventMatching(w.hub, (e) => e.kind === 'claim.made' && e.id === claim.slice(6), 10_000);
  if (recorded?.data?.commit !== w.commit) throw Error(`BLOCKED: ${claim} must be in the record as a claim.made at ${w.commit}: ${shown(w, recorded ?? 'no such event')}`);
  return claim;
}

/** deep_run of `check` for `claim`, through the session's own deep mcp. A hub that couldn't be reached is BLOCKED, never a refusal. */
export async function deepRun(w: World, check: string, claim: string): Promise<Outcome> {
  const out = await w.agent.call('deep_run', { check, claim }, 300_000);
  if (out.isError && out.value?.code === 'unavailable') throw Error(`BLOCKED: deep_run of ${check} couldn't reach the hub: ${shown(w, out.reply)}; the hub ${alive(w.hub.pid) ? 'runs' : 'exited'}: ${w.hub.output().slice(-1500)}`);
  return out;
}
/** A deep_run that answered with its run's outcome. One whose run was still going when deep_run's wait ran out is INCONCLUSIVE, never a pass or a failure. */
export function ended(w: World, check: string, out: Outcome): Outcome {
  if (!out.isError && out.value?.outcome === 'running') throw Error(`INCONCLUSIVE: deep_run of ${check} answered that ${String(out.value?.run)} was still running when its wait ran out, so its outcome wasn't read: ${shown(w, out.value)}`);
  return out;
}
