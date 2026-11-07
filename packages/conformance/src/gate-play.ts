// The kit gate@1's player (#33): one play of a corpus case, its claim or its twin, walked through a Claude Code
// session on a done gate this checkout builds. A world of its own under the kit's TMPDIR (HOME there, the repo
// trusted in Claude Code, the case's drafts and work items handed through the hub's test seams), `deep hub run` from
// packages/cli, and each hook through target/debug/deep-hook as a child of the session's own Claude Code stand-in
// (runtime/gate/agent.mjs). The agent makes each commit folder's tree with Write and rm, commits, and stops. Ported
// from tests/acceptance/322/helpers.ts (same repo, same license). It decides nothing about a verdict: it reads the
// one the gate recorded, or the one the stop's reply shows when the record can't take it.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The checkout this package was built in: its hub, its deep-hook and their default rules. */
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
const RULES = join(REPO, 'crates/deep-hook/default-rules.json');
const FACTS = join(REPO, 'adapters/claude-code.facts.json');
const AGENT = join(REPO, 'packages/conformance/runtime/gate/agent.mjs');
const NODE = process.execPath;
/** The asks settings the hub needs before it takes a session, as a setup writes them. */
const ASKS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
const ACCOUNT = 'acct-gate-kit-0001';
const BILLING = /^(ANTHROPIC_|CLAUDE|CODEX|OPENAI_API_KEY|AWS_BEARER|GH_TOKEN|GITHUB_TOKEN|DEEP_|XDG_|GIT_|OTEL_|npm_)/;

export type Obj = { [key: string]: any };
export interface Ran { code: number | null; stdout: string; stderr: string }
export interface Ev { id: string; kind: string; log_pos: number; session?: string; subject?: string; data: Obj }

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
/** A wait that keeps no process alive on its own. */
const idle = (ms: number) => new Promise<void>((done) => { (setTimeout(done, ms) as unknown as NodeJS.Timeout).unref(); });
const parse = (raw: string): Obj | undefined => { try { const v: unknown = JSON.parse(raw); return v && typeof v === 'object' ? v as Obj : undefined; } catch { return undefined; } };
const COVERED = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions.at(-1)!;

/** What this play started, stopped by PID only when it ends. */
export class Owned {
  readonly pids = new Set<number>();
  readonly dirs: string[] = [];
  add(pid: number | undefined): void { if (pid) this.pids.add(pid); }
  async stop(): Promise<void> {
    for (const pid of this.pids) { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
    const deadline = Date.now() + 3000;
    while ([...this.pids].some(alive) && Date.now() < deadline) await sleep(50);
    for (const pid of this.pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    this.pids.clear();
    for (const dir of this.dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  }
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}

/** The environment every process of a world gets: HOME the world's, none of this process's agent, forge or DeepBuild settings. */
export function worldEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!BILLING.test(key) && key !== 'NODE_OPTIONS') env[key] = value;
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' });
  for (const [key, value] of Object.entries(extra)) { if (value === undefined) delete env[key]; else env[key] = value; }
  return env;
}

export function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: cwd, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  }).trim();
}

/** A tree's files, path → bytes, .git and node_modules left out. */
export function filesOf(root: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.set(relative(root, p), readFileSync(p));
    }
  };
  walk(root);
  return out;
}

export interface World { tmp: string; home: string; root: string; repo: string; drafts: string; work: string; github: string; confirm: string }
/** A world from a case's base folder, its repo committed once on main and trusted in Claude Code. */
export function makeWorld(owned: Owned, base: string, o: { drafts?: unknown[] | undefined; readings?: unknown[] | undefined; installs?: string[] | undefined; files?: Record<string, string> }): World {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'gk-')));
  owned.dirs.push(tmp);
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: ASKS }, null, 2)}\n`);
  const repo = join(tmp, 'repo');
  cpSync(base, repo, { recursive: true });
  for (const [path, bytes] of Object.entries(o.files ?? {})) { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), bytes); }
  for (const path of o.installs ?? []) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    execFileSync('/bin/cp', ['-cR', join(REPO, path), join(repo, path)]);
  }
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);
  const real = realpathSync(repo);
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'you@example.test' }, numStartups: 3, projects: { [real]: { allowedTools: [], hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const file = (name: string, value: unknown): string => { const p = join(tmp, name); writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`); return p; };
  return { tmp, home, root, repo: real, confirm, drafts: file('drafts.json', { drafts: o.drafts ?? [] }), work: file('work.json', { readings: o.readings ?? [] }), github: file('github.json', { answers: [] }) };
}

export interface Hub { pid: number; socket: string; root: string; exit: Promise<void>; stderr(): string }
/** `deep hub run` on the world, with the test seams and any setting the play adds. Throws BLOCKED when it doesn't start. */
export async function startHub(owned: Owned, w: World, env: Record<string, string | undefined> = {}): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], {
    cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: worldEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_WORK: w.work, DEEP_HUB_TEST_GITHUB: w.github, DEEP_HUB_PLANT: process.env.DEEP_HUB_PLANT, ...env }),
  });
  owned.add(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { err = `${err}${d}`.slice(-20_000); });
  const exit = new Promise<void>((done) => child.on('exit', () => done()));
  const ready = await Promise.race([
    new Promise<Obj | undefined>((done) => child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; if (out.includes('\n')) done(parse(out.split('\n')[0]!)); })),
    exit.then(() => undefined),
    idle(120_000).then(() => undefined),
  ]);
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub did not start: ${err.slice(-800)}`);
  owned.add(Number(ready.pid));
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), root: w.root, exit, stderr: () => err };
}
/** Kills the hub as `kill` does (SIGTERM), mid-run, and waits for it to be gone; a SIGKILL is a power cut, whose open claims the record reads as events lost. */
export async function killHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { /* gone */ }
  await Promise.race([hub.exit, idle(30_000)]);
}

/** One call on the hub's socket as the CLI makes it: the cli role with the control token. */
export function control(hub: Hub, method: string, params: Obj, timeoutMs = 30_000): Promise<Obj> {
  const token = readFileSync(join(hub.root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = connect(hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`); }
        else if (step === 1 && line?.role !== undefined) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (step === 2 && line?.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          if (line.error) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`));
          else resolve(line.result as Obj);
        }
      }
    });
  });
}
export async function events(hub: Hub): Promise<Ev[]> {
  const out: Ev[] = [];
  for (let after = 0; ;) {
    const read = await control(hub, 'events.read', { after, limit: 1000 });
    const page = (typeof read.events === 'string' ? JSON.parse(read.events) : read.events) as Ev[];
    if (!page.length) return out;
    out.push(...page);
    after = page.at(-1)!.log_pos;
  }
}

/** One session's Claude Code: a long-lived process whose children are its deep-hook runs. */
class Agent {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Ran) => void>();
  constructor(owned: Owned, w: World, cwd: string) {
    const child: ChildProcess = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: worldEnv(w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: cwd }), stdio: ['pipe', 'pipe', 'ignore'] });
    owned.add(child.pid);
    child.stdin!.on('error', () => undefined);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = parse(this.buffer.slice(0, i));
        this.buffer = this.buffer.slice(i + 1);
        if (!line || typeof line.n !== 'number') continue;
        if ('pid' in line && !('code' in line)) { owned.add(Number(line.pid)); continue; }
        const done = this.pending.get(line.n);
        this.pending.delete(line.n);
        done?.(line as Ran);
      }
    });
    child.on('exit', () => { for (const [n, done] of [...this.pending]) { this.pending.delete(n); done({ code: null, stdout: '', stderr: 'the session\'s agent process exited' }); } });
    this.child = child;
  }
  private readonly child: ChildProcess;
  run(args: string[], cwd: string, input: string, timeoutMs: number): Promise<Ran> {
    const n = ++this.n;
    return new Promise((done) => { this.pending.set(n, done); this.child.stdin!.write(`${JSON.stringify({ n, args, cwd, input, timeoutMs })}\n`); });
  }
}

/** What deep-hook's reply tells Claude Code: a deny or block, or exit 2, stops the call or the stop. */
export function denied(r: Ran): boolean {
  const out = parse(r.stdout.trim());
  const d = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  return r.code === 2 || d === 'deny' || d === 'block';
}
/** A reply's words: a block's reason and the line the chat shows. */
export function replyText(r: Ran): string {
  const out = parse(r.stdout.trim());
  const reason = typeof out?.reason === 'string' ? out.reason : typeof out?.hookSpecificOutput?.permissionDecisionReason === 'string' ? out.hookSpecificOutput.permissionDecisionReason : r.code === 2 ? r.stderr : '';
  return `${reason}\n${typeof out?.systemMessage === 'string' ? out.systemMessage : ''}`.trim();
}

let calls = 0;
const assistant = (content: Obj[], stop: string): Obj => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });

/** A Claude Code session: its transcript and its hooks, fired through deep-hook. */
export class Session {
  readonly id = randomUUID();
  readonly transcript: string;
  private prompt: string | undefined;
  private parent: string | null = null;
  private turn = 0;
  private readonly agent: Agent;
  constructor(owned: Owned, readonly w: World) {
    this.transcript = join(w.home, '.claude/projects', w.repo.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
    this.agent = new Agent(owned, w, w.repo);
  }
  private entry(value: Obj): void {
    const uuid = randomUUID();
    writeFileSync(this.transcript, `${JSON.stringify({ parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.w.repo, sessionId: this.id, version: COVERED, gitBranch: 'main' })}\n`, { flag: 'a' });
    this.parent = uuid;
  }
  hook(event: string, fields: Obj = {}, timeoutMs = 150_000): Promise<Ran> {
    const body = { session_id: this.id, transcript_path: this.transcript, cwd: this.w.repo, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields };
    return this.agent.run(['claude-code', event], this.w.repo, JSON.stringify(body), timeoutMs);
  }
  async start(): Promise<void> {
    const r = await this.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    if (r.code !== 0) throw Error(`BLOCKED: SessionStart ended ${r.code}: ${r.stderr.slice(0, 400)}`);
  }
  async typed(text: string): Promise<void> {
    this.prompt = randomUUID();
    this.turn += 1;
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: text }, turnPosition: { promptIndex: 0, turnIndex: this.turn }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
    await this.hook('UserPromptSubmit', { prompt: text });
  }
  async call(tool_name: string, tool_input: Obj, response: Obj, effect: () => void): Promise<Ran | undefined> {
    const id = `toolu_${randomBytes(10).toString('hex')}${++calls}`;
    this.entry(assistant([{ type: 'tool_use', id, name: tool_name, input: tool_input }], 'tool_use'));
    const before = await this.hook('PreToolUse', { tool_name, tool_input, tool_use_id: id });
    if (denied(before)) return before;
    effect();
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    await this.hook('PostToolUse', { tool_name, tool_input, tool_use_id: id, tool_response: response, duration_ms: 40 });
    return undefined;
  }
  bash(command: string, effect: () => void): Promise<Ran | undefined> {
    return this.call('Bash', { command, description: command.slice(0, 40) }, { stdout: '', stderr: '', interrupted: false, isImage: false }, effect);
  }
  stop(words: string): Promise<Ran> {
    this.entry(assistant([{ type: 'text', text: words }], 'end_turn'));
    return this.hook('Stop', { stop_hook_active: false, last_assistant_message: words });
  }
}

/** The agent makes the repo's tree equal `tree` (Write, rm), then commits it; an empty commit when nothing changed. */
export async function commitTree(w: World, s: Session, tree: Map<string, Buffer>, message: string): Promise<void> {
  const now = filesOf(w.repo);
  for (const path of [...new Set([...now.keys(), ...tree.keys()])].sort()) {
    const was = now.get(path);
    const want = tree.get(path);
    if (was && want && was.equals(want)) continue;
    const full = join(w.repo, path);
    let refused: Ran | undefined;
    if (want) {
      const content = want.toString('utf8');
      refused = await s.call('Write', { file_path: full, content }, { type: was ? 'update' : 'create', filePath: full, content, structuredPatch: [] }, () => { mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, want); });
    } else refused = await s.bash(`rm ${path}`, () => unlinkSync(full));
    if (refused) throw Error(`BLOCKED: the agent's change of ${path} was refused: ${replyText(refused).slice(0, 400)}`);
  }
  const empty = git(w.repo, ['status', '--porcelain']) === '';
  const command = empty ? `git commit --allow-empty -q -m "${message}"` : `git add -A && git commit -q -m "${message}"`;
  const refused = await s.bash(command, () => { if (!empty) git(w.repo, ['add', '-A']); git(w.repo, ['commit', '-q', ...(empty ? ['--allow-empty'] : []), '-m', message]); });
  if (refused) throw Error(`BLOCKED: the agent's commit was refused: ${replyText(refused).slice(0, 400)}`);
}

/** The session's task: the newest one opened under its thread. */
export function taskOf(all: readonly Ev[], s: Session): string | undefined {
  const thread = all.find((e) => e.kind === 'session.start' && e.session === s.id && typeof e.data.thread === 'string')?.data.thread;
  const tasks = all.filter((e) => e.kind === 'task.created' && thread !== undefined && e.data.thread === thread);
  return tasks.length ? String(tasks.at(-1)!.data.task_ref) : undefined;
}
/** The claims of the task since the session's last stop, and the newest verdict made on any of them. */
export function lastClaim(all: readonly Ev[], task: string, s: Session): { claims: Ev[]; verdict: Ev | undefined } {
  const since = all.filter((e) => e.kind === 'agent.stop' && e.session === s.id).at(-1)?.log_pos ?? 0;
  const handles = new Set(all.filter((e) => e.log_pos >= since && e.data?.task_ref === task).map((e) => `claim:${e.id}`));
  const claims = all.filter((e) => e.kind === 'claim.made' && e.log_pos >= since && e.data.task_ref === task);
  const verdicts = all.filter((e) => e.kind === 'verdict.made' && (handles.has(String(e.data.claim)) || handles.has(String(e.subject))));
  return { claims, verdict: verdicts.at(-1) };
}

export { sleep };
