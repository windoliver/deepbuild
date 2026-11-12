// #1999's world and judges (README). One world is #83's: a real hub on a temp home with `deep setup` run, and a Claude
// Code session played through the stand-in that edits total.ts, claims through deep_claim, leaves an open item through
// deep_open_item, gets two verdicts planted through test.verdict (FAIL, sent back, then PASS) and stops with its own
// last words. The change, its verdicts and its open item are then read as the change's page reads them, `changes.read`
// on the hub's socket, and again after the hub restarts on the same record. The judges name what's wrong; a test
// asserts they find nothing, or, for a wrong program, that they name it.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const FACTS = join(REPO, 'adapters/claude-code.facts.json');
const NODE = process.execPath;
const CLI = join(REPO, 'packages/cli/dist/main.js');
const HOOK = join(REPO, 'target/debug/deep-hook');
export const MIN = 60_000;

/** The one criterion, with its ID as scripts/proof-change.mjs computes it. */
export const AC1 = 'AC1 #1999.e525e035';

/** The planted wrong programs (README, Pinned 4), each a name on the hub's closed plant list (packages/hub/src/plant.ts). */
export const PLANTS = {
  agentText: 'sentence-from-agent-text',
  model: 'sentence-from-model',
  noItemSentence: 'open-item-no-sentence',
} as const;

/** What the session does and says (README, The world). */
export const PROMPT = 'Fix the cart total, then stop.';
export const FILE = 'total.ts';
export const ITEM = 'the refund path has no test yet';
/** The agent's own last words: a person never reads them as a sentence DeepBuild wrote. */
export const CANARY = 'Quokka-7731';
export const AGENT_PHRASE = 'fixed every rounding case';
export const SAID = `${CANARY} here: ${AGENT_PHRASE}, trust me, all good.`;
/** What the FAIL verdict's failing requirement found, from its check (the record's words, never the agent's). */
export const SMALLEST = 'expected 10.80, got 10.70';

type Line = { [key: string]: any };
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const tag = (n = 4) => randomBytes(n).toString('hex');
const parseObject = (raw: string): Line | undefined => {
  try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined; } catch { return undefined; }
};
const newest = (file: string): string => { const v = (JSON.parse(readFileSync(file, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; };
const COVERED = newest(FACTS);
const CODEX_COVERED = newest(join(REPO, 'adapters/codex.facts.json'));

// ---- Temp folders under /tmp/dh1999-*: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1999-'));
  made.push(dir);
  return dir;
}

/**
 * A fresh home: `<tmp>/h` is HOME for every process. `<tmp>/bin` holds the stand-ins for launchctl, systemctl, claude
 * and codex (fixtures/stub-bin.sh, each logging its call to `<tmp>/bin/calls.log`) and a `deep` that runs the built CLI.
 */
export interface Home { tmp: string; home: string; bin: string; calls: string }
function makeHome(): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.codex', 'sessions'), { recursive: true });
  mkdirSync(bin);
  for (const name of ['launchctl', 'systemctl', 'claude', 'codex']) {
    copyFileSync(join(FIXTURES, 'stub-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'claude.version'), `${COVERED}\n`);
  writeFileSync(join(bin, 'codex.version'), `${CODEX_COVERED}\n`);
  writeFileSync(join(bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`);
  chmodSync(join(bin, 'deep'), 0o755);
  writeFileSync(join(bin, 'calls.log'), '');
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  return { tmp, home, bin, calls: join(bin, 'calls.log') };
}

// ---- Processes this suite started: stopped by PID or by the process group a stand-in started, never by name or port.
const owned = new Set<number>();
const groups = new Set<number>();
function own(pid: number | undefined): void { if (pid) owned.add(pid); }
function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
export async function cleanup(): Promise<void> {
  for (const pgid of groups) try { process.kill(-pgid, 'SIGTERM'); } catch { /* gone */ }
  for (const pid of owned) for (const target of [pid, -pid]) try { process.kill(target, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) for (const target of [pid, -pid]) try { process.kill(target, 'SIGKILL'); } catch { /* gone */ }
  for (const pgid of groups) try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  groups.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Variables that bill an account or reach a forge; no child inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN'];
/**
 * A child's environment: HOME the test's home, and a PATH of the stand-ins, Node's folder and the system's folders
 * only, so no real `claude` or `codex` can be reached; none of this process's DEEP_, CLAUDE, CODEX, GIT_, XDG_ or
 * billing variables.
 */
function childEnv(h: Home, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_|GH_|OTEL_)/.test(key) || key === 'NODE_OPTIONS' || key === 'PATH' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: h.home, XDG_CONFIG_HOME: join(h.home, '.config'), XDG_CACHE_HOME: join(h.home, '.cache'), SHELL: '/bin/sh', LC_ALL: 'C',
    PATH: `${h.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, DEEP_HUB_TEST_CONFIRM: join(h.tmp, 'confirm'),
  });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

interface Ran { code: number | null; stdout: string; stderr: string }
function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs = 300_000): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

// ---- The hub (`deep hub run`), with test.verdict served (#83's DEEP_HUB_TEST_VERDICT=1) and a plant when asked.
interface Hub { pid: number; socket: string; root: string; output(): string }
async function startHub(h: Home, plant?: string): Promise<Hub> {
  const env = childEnv(h, { DEEP_HUB_PLANT: plant, DEEP_HUB_TEST_VERDICT: '1' });
  const child: ChildProcess = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(parseObject(first.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start${plant ? ` with DEEP_HUB_PLANT=${plant} (README, Pinned 4: the implementation adds it to the hub's plant list)` : ''}: ${out.slice(0, 1500)}`);
  const root = join(h.home, '.deepbuild');
  return { pid: child.pid!, socket: join(root, 'hub.sock'), root, output: () => out };
}
async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 30_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(50);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  while (alive(hub.pid)) await sleep(50);
}

/** One call on the hub's socket as the `cli` role with the control token (#16's line protocol). */
async function call(hub: Hub, method: string, params: Line): Promise<Line> {
  const sock = net.connect(hub.socket);
  const lines: Line[] = [];
  let buffer = '';
  let ended = false;
  const wakers = new Set<() => void>();
  sock.setEncoding('utf8');
  sock.on('data', (chunk: string) => {
    buffer += chunk;
    let i: number;
    while ((i = buffer.indexOf('\n')) >= 0) { lines.push(parseObject(buffer.slice(0, i)) ?? {}); buffer = buffer.slice(i + 1); }
    for (const w of [...wakers]) w();
  });
  const end = () => { ended = true; for (const w of [...wakers]) w(); };
  sock.on('error', end);
  sock.on('close', end);
  /** The first line from `from` on that matches, or undefined once the socket ends or `ms` pass. */
  const wait = (match: (l: Line) => boolean, from: number, ms: number) => new Promise<Line | undefined>((resolve) => {
    const done = (v: Line | undefined) => { clearTimeout(timer); wakers.delete(check); resolve(v); };
    const check = () => { const found = lines.slice(from).find(match); if (found) done(found); else if (ended) done(undefined); };
    const timer = setTimeout(() => done(undefined), ms);
    wakers.add(check);
    check();
  });
  try {
    if (!await wait(() => true, 0, 10_000)) throw Error(`BLOCKED: no hello from the hub at ${hub.socket}`);
    let from = lines.length;
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() })}\n`);
    const hello = await wait((l) => 'role' in l || 'error' in l, from, 10_000);
    if (hello?.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(hello)}`);
    const id = `${method}#${tag(3)}`;
    from = lines.length;
    sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await wait((l) => l.id === id && ('result' in l || 'error' in l), from, 60_000);
    if (!reply) throw Error(`BLOCKED: no reply to ${method} within 60 s`);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  } finally {
    sock.destroy();
  }
}

// ---- The session, played through Claude Code's stand-in (fixtures/claude.mjs), its payloads and transcript shaped
// like the corpus's (adapters/corpus/claude-code), as #83's helpers shape them.
interface Session { id: string; cwd: string; transcript: string; prompt?: string }
function newSession(h: Home): Session {
  const id = randomUUID();
  const cwd = join(h.tmp, `w${tag(3)}`);
  mkdirSync(cwd, { recursive: true });
  const transcript = join(h.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript };
}
function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt) base.prompt_id = s.prompt;
  if (event === 'SessionStart') { Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' }); delete base.prompt_id; }
  if (event === 'Stop') Object.assign(base, { stop_hook_active: false });
  return { ...base, ...extra };
}
function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  appendFileSync(s.transcript, `${JSON.stringify(line)}\n`);
}
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(6)}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, output_tokens: 10 } } });

class Claude {
  private n = 0;
  private rpc = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private exited = false;
  private constructor(private readonly child: ChildProcess, private readonly h: Home) {
    child.on('exit', () => { this.exited = true; for (const [n, done] of [...this.pending]) done({ n, failed: 'the Claude Code stand-in exited' }); });
    createInterface({ input: child.stdout! }).on('line', (raw) => { const line = parseObject(raw); if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line); });
  }
  static start(h: Home): Claude {
    const child = spawn(NODE, [join(FIXTURES, 'claude.mjs'), CLI, FACTS, join(h.tmp, 'hooks.jsonl')], { cwd: h.tmp, env: childEnv(h), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Claude(child, h);
  }
  private send(command: Line, timeoutMs = 600_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(n); reject(Error(`BLOCKED: the Claude Code stand-in gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(n, (line) => {
        clearTimeout(timer);
        this.pending.delete(n);
        if (line.failed) reject(Error(`BLOCKED: the Claude Code stand-in failed ${command.op}: ${line.failed}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  async hook(event: string, body: Line): Promise<Line> {
    const fired = await this.send({ op: 'hook', event, payload: body, settings: join(this.h.home, '.claude', 'settings.json') });
    for (const r of [...(fired.ran ?? []), ...(fired.background ?? [])]) if (typeof r.pid === 'number') groups.add(r.pid);
    return fired;
  }
  private async request(method: string, params: Line): Promise<Line> {
    const r = await this.send({ op: 'mcp', line: { jsonrpc: '2.0', id: `${method}#${++this.rpc}`, method, params }, timeoutMs: 120_000 }, 125_000);
    own(r.pid as number);
    return r.reply as Line;
  }
  async initialize(): Promise<void> {
    const reply = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1999', version: '0' } });
    if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
    await this.send({ op: 'mcp', line: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } });
  }
  /** A tool call as Claude Code makes it: its tool_use entry, PreToolUse, the call (a deep_* tool through deep mcp), its tool_result entry, PostToolUse. */
  async tool(s: Session, name: string, input: Line, response?: Line): Promise<Line> {
    const id = `toolu_${tag(12)}`;
    appendTranscript(s, assistant([{ type: 'tool_use', id, name, input }], 'tool_use'));
    await this.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: name, tool_input: input, tool_use_id: id }));
    const reply = response ?? await this.request('tools/call', { name: name.replace(/^mcp__deep__/, ''), arguments: input });
    appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: JSON.stringify(reply.result?.content ?? reply.error ?? reply) }] }, toolUseResult: reply });
    await this.hook('PostToolUse', payload(s, 'PostToolUse', { tool_name: name, tool_input: input, tool_use_id: id, tool_response: reply.result ?? reply.error ?? reply }));
    return reply;
  }
  async end(): Promise<void> {
    if (this.exited) return;
    const gone = new Promise<void>((resolve) => { if (this.exited) resolve(); else this.child.once('exit', () => resolve()); });
    await this.send({ op: 'end' }, 10_000).catch(() => undefined);
    await Promise.race([gone, sleep(10_000)]);
  }
}

// ---- The world (README, The world).
/** One read of the change, as `changes.read` answers it; the fields README, Pinned names are read from it. */
export type Change = Line;
export interface World {
  plant: string | undefined;
  session: string;
  claim: string;
  /** `changes.read` for the claim once the session stopped, then again after the hub restarted on the same record (when asked). */
  reads: Change[];
  /** Every call the stand-in agents' CLIs logged from the hub's first start to the last read. */
  calls: string[];
  /** What the hub printed, for a failure's message. */
  output: string;
}

const ulid = (): string => { const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; let s = ''; for (let i = 0; i < 26; i++) s += chars[Math.floor(Math.random() * 32)]; return s; };
const req = (n: number, outcome: string, extra: Line = {}): Line => ({ req: `req:01K74G0A1B2C3D4E5F6G7H8J9K#R${n}`, outcome, check: 'unit', smallest: null, points_to: null, ...extra });

/**
 * Builds the world on a fresh home, with `plant` on the hub when given, and reads the change; with `restart`, stops the
 * hub, starts it again on the same home with no plant, and reads the change again. Anything the criterion doesn't judge
 * that goes wrong on the way is BLOCKED, never a criterion's failure.
 */
export async function buildWorld(o: { plant?: string; restart?: boolean } = {}): Promise<World> {
  if (!existsSync(CLI)) throw Error(`BLOCKED: ${CLI} is missing: run npm run build --workspaces`);
  if (!existsSync(HOOK)) throw Error(`BLOCKED: ${HOOK} is missing: run cargo build --locked -p deep-hook`);
  const h = makeHome();
  let hub = await startHub(h, o.plant);
  const out: string[] = [];
  try {
    const setup = await run(NODE, [CLI, 'setup'], childEnv(h));
    if (setup.code !== 0) throw Error(`BLOCKED: deep setup must exit 0 and install DeepBuild into Claude Code's settings: exit ${setup.code}, ${setup.stderr.slice(-1500)}`);
    const s = newSession(h);
    const claude = Claude.start(h);
    try {
      await claude.hook('SessionStart', payload(s, 'SessionStart'));
      const promptId = randomUUID();
      s.prompt = promptId;
      appendTranscript(s, { promptId, type: 'user', message: { role: 'user', content: PROMPT }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
      await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: PROMPT }));
      await claude.initialize();
      // The change: one Edit of total.ts in the session's folder.
      const path = join(s.cwd, FILE);
      writeFileSync(path, 'export const total = (n: number) => n * 1.08;\n');
      await claude.tool(s, 'Edit', { file_path: path, old_string: 'n * 1.07', new_string: 'n * 1.08' }, { filePath: path, oldString: 'n * 1.07', newString: 'n * 1.08' });
      // The claim, through deep_claim, at no commit (the folder is no repo), as #83's helpers make it.
      const claimed = JSON.stringify(await claude.tool(s, 'mcp__deep__deep_claim', { task_ref: `task:${ulid()}`, attempt: 1, commit: 'a'.repeat(40), scope: 'session', predictions: null }));
      const m = /claim:([0-9A-Z]{26})/.exec(claimed);
      if (!m) throw Error(`BLOCKED: deep_claim must answer with the claim's handle: ${claimed.slice(0, 800)}`);
      const claim = `claim:${m[1]}`;
      // The open item, through deep_open_item, on the claim's task.
      const opened = await claude.tool(s, 'mcp__deep__deep_open_item', { text: ITEM });
      if (!opened.result || opened.result.isError) throw Error(`BLOCKED: deep_open_item must record the open item: ${JSON.stringify(opened).slice(0, 800)}`);
      // Two verdicts on the claim, planted as #83's test.verdict plants them: sent back (round 1 of 3), then PASS.
      await call(hub, 'test.verdict', { session: s.id, claim, outcome: 'FAIL', round: 1, requirements: [req(1, 'FAIL', { smallest: SMALLEST, points_to: `${FILE}:1` }), req(2, 'PASS')], ran: [{ check: 'unit', outcome: 'failed' }] })
        .catch((e: Error) => { throw Error(`BLOCKED: the hub must serve test.verdict with DEEP_HUB_TEST_VERDICT=1: ${e.message}`); });
      await call(hub, 'test.verdict', { session: s.id, claim, outcome: 'PASS', requirements: [req(1, 'PASS'), req(2, 'PASS')], ran: [{ check: 'unit', outcome: 'passed' }] });
      // The agent's own last words, then its Stop.
      appendTranscript(s, assistant([{ type: 'text', text: SAID }], 'end_turn'));
      await claude.hook('Stop', payload(s, 'Stop', { last_assistant_message: SAID }));
      const stopped = async (): Promise<boolean> => ((await call(hub, 'events.read', { after: 0, limit: 5000 })).events as Line[]).some((e) => e.kind === 'agent.stop' && e.session === s.id);
      const deadline = Date.now() + 60_000;
      while (!await stopped()) {
        if (Date.now() > deadline) throw Error(`BLOCKED: the session's Stop never reached the record: ${hub.output().slice(-1500)}`);
        await sleep(250);
      }
      const reads: Change[] = [];
      const read = async (): Promise<Change> => {
        const r = await call(hub, 'changes.read', { id: claim });
        const change = r.change as Change | undefined;
        if (!change || typeof change !== 'object') throw Error(`BLOCKED: changes.read must answer with the change: ${JSON.stringify(r).slice(0, 800)}`);
        // The record state the criterion is judged on is there, whatever the implementation shows of it.
        if (!Array.isArray(change.verdicts) || change.verdicts.length !== 2) throw Error(`BLOCKED: changes.read must list the claim's two planted verdicts: ${JSON.stringify(change.verdicts).slice(0, 800)}`);
        return change;
      };
      reads.push(await read());
      await claude.end();
      if (o.restart) {
        out.push(hub.output());
        await stopHub(hub);
        hub = await startHub(h);
        reads.push(await read());
      }
      out.push(hub.output());
      return { plant: o.plant, session: s.id, claim, reads, calls: readFileSync(h.calls, 'utf8').split('\n').filter(Boolean), output: out.join('\n') };
    } finally {
      await claude.end();
    }
  } finally {
    await stopHub(hub);
  }
}

// ---- The judges (README, What "one plain sentence, from the template" is read as).
/** contracts/plain-words.json: each internal word with its plain word, longest first. */
const PLAIN: [string, string][] = Object.entries((JSON.parse(readFileSync(join(REPO, 'contracts/plain-words.json'), 'utf8')) as { words: Record<string, string> }).words).sort((a, b) => b[0].length - a[0].length);
/** The listed words `text` holds as a whole word, in any case, or with a plural ending (as crates/deep-app/src/plain.rs reads them). */
function listed(text: string): [string, string][] {
  const lower = text.toLowerCase();
  const joins = (c: string | undefined) => c !== undefined && /[a-z0-9]/i.test(c);
  return PLAIN.filter(([word]) => {
    const w = word.toLowerCase();
    for (let at = lower.indexOf(w); at >= 0; at = lower.indexOf(w, at + 1)) {
      let rest = lower.slice(at + w.length);
      if (rest.startsWith('es') && !joins(rest[2])) rest = rest.slice(2);
      else if (rest.startsWith('s') && !joins(rest[1])) rest = rest.slice(1);
      if (!joins(lower[at - 1]) && !joins(rest[0])) return true;
    }
    return false;
  });
}
/** A record handle, which a person never reads in a plain sentence. */
const HANDLE = /\b(claim|verdict|task|req|session|ask|run|item|ev):[0-9A-Za-z]{10,}/;

/** What's wrong with `sentence` as `what`'s one plain sentence: none, or each failure naming it. */
export function sentenceFailures(what: string, sentence: unknown): string[] {
  if (typeof sentence !== 'string' || !sentence.trim()) return [`${what} shows no plain sentence: its sentence is ${JSON.stringify(sentence)}`];
  const f: string[] = [];
  const shown = JSON.stringify(sentence);
  if (sentence !== sentence.trim() || /[\r\n]/.test(sentence)) f.push(`${what}'s sentence is not one line: ${shown}`);
  const ends = [...sentence.trim().matchAll(/[.!?]["'”’)\]]*(?=\s|$)/g)];
  if (ends.length !== 1 || ends[0]!.index! + ends[0]![0].length !== sentence.trim().length) f.push(`${what}'s sentence is not one sentence, ending once in ".", "!" or "?": ${shown}`);
  for (const [word, plain] of listed(sentence)) f.push(`${what}'s sentence says "${word}", where the plain word is "${plain}" (contracts/plain-words.json): ${shown}`);
  if (HANDLE.test(sentence)) f.push(`${what}'s sentence holds a record handle, ${HANDLE.exec(sentence)![0]}: ${shown}`);
  for (const words of [CANARY, AGENT_PHRASE]) {
    if (sentence.toLowerCase().includes(words.toLowerCase())) f.push(`${what}'s sentence holds the agent's words "${words}", from its last message, not the record's fields: ${shown}`);
  }
  return f;
}

/** The same sentence after the hub restarted on the same record, read by `pick` from each read. */
function replayFailures(what: string, w: World, pick: (c: Change) => unknown): string[] {
  if (w.reads.length < 2) return [];
  const [before, after] = [pick(w.reads[0]!), pick(w.reads[1]!)];
  return before === after ? [] : [`${what}'s sentence is not the same after the hub restarted on the same record: before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`];
}

/** The change: one plain sentence naming the file it wrote, the same on replay. */
export function changeFailures(w: World): string[] {
  const what = `the change ${w.claim}`;
  const sentence = w.reads[0]!.sentence;
  const f = sentenceFailures(what, sentence);
  if (typeof sentence === 'string' && sentence.trim() && !sentence.includes(FILE)) f.push(`${what}'s sentence doesn't name the file it wrote, ${FILE}: ${JSON.stringify(sentence)}`);
  return [...f, ...replayFailures(what, w, (c) => c.sentence)];
}

/** Each verdict: one plain sentence holding its state's word ("sent back" for FAIL, "PASS" for PASS), the same on replay. */
export function verdictFailures(w: World): string[] {
  const f: string[] = [];
  for (const v of w.reads[0]!.verdicts as Line[]) {
    const id = String(v.id ?? v.handle);
    const what = `the ${v.outcome} verdict ${id} on ${w.claim}`;
    const sentence = v.sentence;
    f.push(...sentenceFailures(what, sentence));
    if (typeof sentence === 'string' && sentence.trim()) {
      if (v.outcome === 'PASS' && !/\bPASS\b/.test(sentence)) f.push(`${what}'s sentence doesn't name its state with its word, PASS (States people see): ${JSON.stringify(sentence)}`);
      if (v.outcome === 'FAIL' && !/\bsent back\b/i.test(sentence)) f.push(`${what}'s sentence doesn't name its state with its word, sent back (States people see): ${JSON.stringify(sentence)}`);
    }
    f.push(...replayFailures(what, w, (c) => (c.verdicts as Line[]).find((x) => String(x.id ?? x.handle) === id)?.sentence));
  }
  return f;
}

/** The open item: listed with the change, its text as the record holds it, and one plain sentence quoting it, the same on replay. */
export function openItemFailures(w: World): string[] {
  const items = w.reads[0]!.open_items;
  const what = `the open item "${ITEM}" of ${w.claim}`;
  if (!Array.isArray(items)) return [`${what} isn't shown: changes.read lists no open_items for the change (README, Pinned 3): ${JSON.stringify(items)}`];
  const item = (items as Line[]).find((i) => i?.text === ITEM);
  if (!item) return [`${what} isn't shown: open_items holds ${JSON.stringify(items).slice(0, 600)}`];
  const f = sentenceFailures(what, item.sentence);
  if (typeof item.sentence === 'string' && item.sentence.trim() && !item.sentence.includes(ITEM)) f.push(`${what}'s sentence doesn't say what is open, in the item's words as the record holds them: ${JSON.stringify(item.sentence)}`);
  return [...f, ...replayFailures(what, w, (c) => (Array.isArray(c.open_items) ? (c.open_items as Line[]).find((i) => i?.text === ITEM)?.sentence : undefined))];
}

/** The kinds that show no sentence at all in the first read. */
export function missingSentences(w: World): string[] {
  const c = w.reads[0]!;
  const blank = (s: unknown) => typeof s !== 'string' || !s.trim();
  return [
    ...(blank(c.sentence) ? [`the change ${w.claim} shows no sentence`] : []),
    ...(c.verdicts as Line[]).filter((v) => blank(v.sentence)).map((v) => `the ${v.outcome} verdict ${String(v.id ?? v.handle)} shows no sentence`),
    ...(!Array.isArray(c.open_items) || !(c.open_items as Line[]).some((i) => i?.text === ITEM && !blank(i.sentence)) ? [`the open item "${ITEM}" shows no sentence`] : []),
  ];
}

/** Every headless model call the stand-in agents' CLIs logged: `claude -p`/`--print`, `codex exec`/`codex e`. */
export function modelCalls(w: World): string[] {
  return w.calls.filter((line) => {
    const [name, ...args] = line.split(' ');
    if (name === 'claude') return args.includes('-p') || args.includes('--print');
    if (name === 'codex') return args[0] === 'exec' || args[0] === 'e';
    return false;
  }).map((line) => `a model call while the sentences were made and read: \`${line}\``);
}
