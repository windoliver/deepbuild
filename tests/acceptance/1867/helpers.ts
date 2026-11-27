// Test-side tools for issue #1867's acceptance tests (README): a temp home under /tmp/dh1867-* with stand-ins for
// launchctl, systemctl, claude and codex first on PATH (or the machine's real codex, for its own hook list); `deep
// setup` and the hub (`deep hub run`) as processes; the hub's record and health over its socket; one stand-in process
// per agent (fixtures/agent.mjs) that is the parent of its sessions' real deep-hook runs and of its calls' shells;
// Codex's hooks.json and Claude Code's ~/.claude.json as the files hold them; and Codex's own hook list over `codex
// app-server`. Nothing here stands in for DeepBuild: every reading comes from the real hub, deep-hook, CLI and files.
//
// Adapted, not imported (suites don't import each other): the home, the Codex thread, its payloads and Codex's hook
// list from tests/acceptance/39/helpers.ts; the Claude Code session, its payloads and transcript, and `readingTexts`
// from tests/acceptance/18/install/helpers.ts; the bound, the stand-in's client and the hook fired until the record
// holds it from tests/acceptance/3229/helpers.ts. Same repo, same license.
//
// Safety: every folder is under /tmp/dh1867-* and removed after its file; HOME is the test's own for every process;
// the real codex runs only against that home's own CODEX_HOME, never with --dangerously-bypass-hook-trust; no model
// is called; a process is stopped only by the PID it was started with. No wait here is a fixed one
// (scripts/wait-ratchet.mjs): each timer bounds a wait for an event, and says so.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, homedir, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

/** Each criterion's tag: its number in the issue's order, then `#1867.` and the first 8 hex of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = { 1: 'AC1 #1867.e9a5b9d7', 2: 'AC2 #1867.74eeacdf', 3: 'AC3 #1867.5a700f0c' } as const;

export const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const HOOK = join(REPO, 'target/debug/deep-hook');
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
export const TAMPER = fileURLToPath(new URL('./fixtures/tamper.mjs', import.meta.url));
export const NODE = process.execPath;
export const SECOND = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
const isObj = (v: unknown): v is Line => typeof v === 'object' && v !== null && !Array.isArray(v);
export const parseObject = (raw: string): Line | undefined => { try { const v: unknown = JSON.parse(raw); return isObj(v) ? v : undefined; } catch { return undefined; } };
export const tag = (n = 4): string => randomBytes(n).toString('hex');
export const cut = (text: string, n = 1200): string => (text.length > n ? `${text.slice(0, n)}…` : text);
/** A word as a shell takes it whole. */
export const quoted = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;
/** A value's JSON with every object's keys in order, so two values compare whatever order their keys were written in. */
export const canon = (value: unknown): string => JSON.stringify(value, (_, v: unknown) => (isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
const newest = (facts: string): string => (JSON.parse(readFileSync(join(REPO, 'adapters', facts), 'utf8')) as { versions: string[] }).versions.at(-1)!;
/** The newest version of each agent its facts cover: the version the stand-in sessions run. */
const CODEX_COVERED = newest('codex.facts.json');
const CLAUDE_COVERED = newest('claude-code.facts.json');

/**
 * Resolves after `ms`. Every caller races it against the event it waits for (a process's end, a reply, a line), so all
 * it can do is turn a hang into a result.
 */
export function bound(ms: number): Promise<void> {
  // deadline: only ever raced against the event a test waits for; it bounds that wait and never waits on its own.
  return new Promise<void>((done) => { setTimeout(done, ms).unref(); });
}
// deadline: the step between two reads of `until` and `watchBack`, which each end at their event or at their caller's bound.
const step = (ms: number): Promise<void> => new Promise<void>((done) => { setTimeout(done, ms); });
/** Reads `probe` until it gives a value, at most `ms`; undefined when it never did. The caller's assertion says what is missing. */
export async function until<T>(probe: () => Promise<T | undefined | null | false> | T | undefined | null | false, ms: number, every = 100): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== null && value !== false) return value;
    if (Date.now() >= end) return undefined;
    await step(every);
  }
}

// ---- Temp folders (short: a Unix socket path must fit in 104 bytes on macOS) and the processes this suite started.
const made: string[] = [];
const children = new Set<ChildProcess>();
const gone = (c: ChildProcess): boolean => c.exitCode !== null || c.signalCode !== null;
const exitOf = (c: ChildProcess): Promise<void> => (gone(c) ? Promise.resolve() : new Promise((done) => c.once('exit', () => done())));
/** Stops every process this file started, by its own PID (SIGTERM, then SIGKILL), and removes its folders. */
export async function cleanup(): Promise<void> {
  for (const c of children) if (!gone(c)) c.kill('SIGTERM');
  await Promise.race([Promise.all([...children].map(exitOf)), bound(30_000)]);
  for (const c of children) if (!gone(c)) c.kill('SIGKILL');
  await Promise.race([Promise.all([...children].map(exitOf)), bound(5000)]);
  children.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * A fresh home. `<tmp>/h` is HOME for every process a test starts, so `~/.deepbuild`, `~/.codex`, `~/.claude` and
 * `~/.claude.json` are under it. `<tmp>/bin` comes first on PATH with stand-ins for launchctl and systemctl (each
 * exits 0) and for claude and codex (each answers `--version` with the newest version its facts cover, and exits 0);
 * with `realCodex` the codex there is the machine's own, for its hook list. With `linked`, `~/.codex/hooks.json` is a
 * link into a dotfiles folder whose file holds a Stop entry of yours. `claudeJson` is what `~/.claude.json` holds
 * before setup.
 */
export interface Home { tmp: string; home: string; bin: string; root: string; codexHome: string; hooksFile: string; configToml: string; claudeJson: string; link: string | undefined }
/** Your own Stop entry in the dotfiles file, and where `~/.codex/hooks.json` points when it is a link. */
export const YOUR_STOP = '/usr/bin/true your-own-stop-hook';
const LINK = '../../dotfiles/hooks.json';
export function makeHome(o: { realCodex?: boolean; linked?: boolean; claudeJson?: Line } = {}): Home {
  for (const [what, path] of [['the deep CLI (npm run build --workspaces)', CLI], ['deep-hook (cargo build --locked -p deep-hook)', HOOK]] as const) {
    if (!existsSync(path)) throw Error(`BLOCKED: ${what} is not built at ${path}`);
  }
  const tmp = realpathSync(mkdtempSync('/tmp/dh1867-'));
  made.push(tmp);
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  const codexHome = join(home, '.codex');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(codexHome, 'sessions'), { recursive: true });
  mkdirSync(bin);
  const program = (name: string, body: string): void => writeFileSync(join(bin, name), body, { mode: 0o755 });
  for (const name of ['launchctl', 'systemctl']) program(name, '#!/bin/sh\nexit 0\n');
  program('claude', `#!/bin/sh\n[ "$1" = "--version" ] && echo '${CLAUDE_COVERED} (Claude Code)'\nexit 0\n`);
  program('codex', o.realCodex ? `#!/bin/sh\nexec ${quoted(realCodex())} "$@"\n` : `#!/bin/sh\n[ "$1" = "--version" ] && echo 'codex-cli ${CODEX_COVERED}'\nexit 0\n`);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const hooksFile = join(codexHome, 'hooks.json');
  if (o.linked) {
    mkdirSync(join(tmp, 'dotfiles'));
    writeFileSync(join(tmp, 'dotfiles', 'hooks.json'), `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: YOUR_STOP }] }] } }, null, 2)}\n`);
    symlinkSync(LINK, hooksFile);
  }
  const claudeJson = join(home, '.claude.json');
  if (o.claudeJson) writeFileSync(claudeJson, `${JSON.stringify(o.claudeJson, null, 2)}\n`);
  return { tmp, home, bin, root: join(home, '.deepbuild'), codexHome, hooksFile, configToml: join(codexHome, 'config.toml'), claudeJson, link: o.linked ? LINK : undefined };
}
/** The codex this machine has, found on the PATH the suite started with; none is BLOCKED. */
function realCodex(): string {
  const dirs = [...(process.env.PATH ?? '').split(':'), '/usr/local/bin', '/opt/homebrew/bin'].filter(Boolean);
  const found = dirs.map((d) => join(d, 'codex')).find((p) => existsSync(p));
  if (!found) throw Error("BLOCKED: this test reads Codex's own hook list (codex app-server, hooks/list), and no codex is on PATH");
  return found;
}
/** A text with every home folder written as `~`, the test's own and the runner's, and the test's folder as `<tmp>`. */
export const tilde = (h: Home, text: string): string => text.replaceAll(h.home, '~').replaceAll(h.tmp, '<tmp>').replaceAll(homedir(), '~');
/** The machine's one-minute load against its cores: over them, a time this suite measures is the machine's as much as the hub's. */
export const loaded = (): boolean => loadavg()[0]! > availableParallelism();
export const loadNow = (): string => `a one-minute load of ${loadavg()[0]!.toFixed(0)} on ${availableParallelism()} cores`;

/** A child's environment: HOME the test's, the stand-ins first on PATH, and no DEEP_, CLAUDE, CODEX, XDG_, GIT_ or billing setting of this process's. */
export function childEnv(h: Home, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|CLAUDE|CODEX_|XDG_|GIT_|OPENAI_|ANTHROPIC_|AWS_BEARER|GH_|GITHUB_|VITEST|NODE_OPTIONS$)/.test(key)) continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: h.home, XDG_CONFIG_HOME: join(h.home, '.config'), XDG_CACHE_HOME: join(h.home, '.cache'), SHELL: '/bin/sh', LC_ALL: 'C', PATH: `${h.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, DEEP_HUB_TEST_CONFIRM: join(h.tmp, 'confirm') });
  for (const [key, value] of Object.entries(extra)) { if (value === undefined) delete env[key]; else env[key] = value; }
  return env;
}
export interface Ran { code: number | null; stdout: string; stderr: string }
export const shown = (r: Ran): string => `exit ${r.code}, stdout ${JSON.stringify(cut(r.stdout))}, stderr ${JSON.stringify(cut(r.stderr))}`;
/** A program run to its end with nothing on its standard input; one still going at `ms` is stopped, by its PID. */
export function run(command: string, args: readonly string[], o: { env: NodeJS.ProcessEnv; cwd: string; ms?: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.ms ?? 600_000); // deadline: a program that never ends is stopped, and the test reads what it printed
    child.on('error', (error) => { stderr += String(error); });
    child.on('close', (code) => { clearTimeout(timer); children.delete(child); resolve({ code, stdout, stderr }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end();
  });
}
/** `deep <args>` from the built CLI, HOME the test's home. */
export const deep = (h: Home, args: readonly string[]): Promise<Ran> => run(NODE, [CLI, ...args], { env: childEnv(h), cwd: h.tmp });

// ---- The hub as a process (`deep hub run`), and its socket's line protocol in the cli role, with the control token.
export interface Hub { child: ChildProcess; h: Home; socket: string; root: string; output(): string }
export async function startHub(h: Home): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: h.tmp, env: childEnv(h), stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { out = (out + d).slice(-20_000); });
  const first = new Promise<Line | undefined>((done) => createInterface({ input: child.stdout! }).once('line', (l) => done(parseObject(l))));
  const ready = await Promise.race([first, exitOf(child).then(() => undefined), bound(180_000).then(() => undefined)]);
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub didn't start: ${tilde(h, out.slice(-1500))}`);
  return { child, h, socket: join(h.root, 'hub.sock'), root: h.root, output: () => out };
}
export async function stopHub(hub: Hub): Promise<void> {
  if (!gone(hub.child)) hub.child.kill('SIGTERM');
  await Promise.race([exitOf(hub.child), bound(60_000)]);
  if (!gone(hub.child)) hub.child.kill('SIGKILL');
  await exitOf(hub.child);
}
/** A hub with `deep setup` run in the home; a setup that doesn't exit 0 is BLOCKED. */
export async function hubWithSetup(h: Home): Promise<Hub> {
  const hub = await startHub(h);
  const r = await deep(h, ['setup']);
  if (r.code !== 0) throw Error(`BLOCKED: deep setup must exit 0: ${tilde(h, shown(r))}`);
  return hub;
}
/** One call over the line protocol (#16): the hub's hello, the cli hello with the control token, then the call. */
export async function control(hub: Hub, method: string, params: Line = {}, ms = 60_000): Promise<Line> {
  const sock = net.connect(hub.socket);
  try {
    const reply = new Promise<Line>((resolve, reject) => {
      let buffer = '';
      let stage = 0;
      sock.setEncoding('utf8');
      sock.on('error', reject);
      sock.on('close', () => reject(Error(`the hub closed the connection before it answered ${method}`)));
      sock.on('data', (chunk: string) => {
        buffer += chunk;
        for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
          const line = parseObject(buffer.slice(0, i)) ?? {};
          buffer = buffer.slice(i + 1);
          if (stage === 0) { stage = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() })}\n`); }
          else if (stage === 1) {
            if ('error' in line || ('role' in line && line.role !== 'cli')) return reject(Error(`the hub refused the cli hello: ${JSON.stringify(line)}`));
            if (!('role' in line)) continue;
            stage = 2;
            sock.write(`${JSON.stringify({ v: 1, id: 'c1', method, params })}\n`);
          } else if (line.id === 'c1') {
            if ('error' in line) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`));
            else resolve(line.result as Line);
          }
        }
      });
    });
    return await Promise.race([reply, bound(ms).then(() => { throw Error(`no reply to ${method} from the hub within ${ms} ms`); })]);
  } finally {
    sock.destroy();
  }
}
export interface Ev { id: string; kind: string; log_pos: number; ts: number; subject?: string; session?: string; data: Line }
/** Every event in the log, paged by log_pos through `events.read`. */
export async function allEvents(hub: Hub): Promise<Ev[]> {
  const out: Ev[] = [];
  for (let after = 0; ;) {
    const page = ((await control(hub, 'events.read', { after, limit: 1000 })).events ?? []) as Ev[];
    if (!page.length) return out;
    out.push(...page);
    after = page[page.length - 1]!.log_pos;
  }
}
export const health = (hub: Hub): Promise<Line> => control(hub, 'hub.health');
/** The kinds a hook itself maps to: a call's own events are never the reading that names it. */
const HOOK_KINDS = new Set(['session.start', 'session.end', 'user.ask', 'tool.before', 'tool.after', 'permission.request', 'agent.stop', 'task.completed']);
/** Every string a value holds, at any depth. */
const strings = (value: unknown): string[] => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(strings) : isObj(value) ? Object.values(value).flatMap(strings) : []);
/**
 * A reading, wherever the hub shows it (README: Readings, 5), where #18's install suite reads one: each string its
 * `hub.health` answer holds, and every event of `events` that isn't one of the hook events themselves, as JSON text.
 * One reading is one of these texts.
 */
async function readingTexts(hub: Hub, events: readonly Ev[]): Promise<string[]> {
  return [...strings(await health(hub)), ...events.filter((e) => !HOOK_KINDS.has(e.kind)).map((e) => JSON.stringify({ kind: e.kind, subject: e.subject, session: e.session, data: e.data }))];
}

// ---- One agent's process (fixtures/agent.mjs): the parent of its sessions' deep-hook runs and of its calls' shells.
export class Agent {
  readonly child: ChildProcess;
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private constructor(child: ChildProcess) {
    this.child = child;
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (line && typeof line.n === 'number') { this.pending.get(line.n)?.(line); this.pending.delete(line.n); }
    });
    child.on('exit', () => { for (const done of this.pending.values()) done({ failed: 'the agent stand-in exited', code: null, stdout: '', stderr: '' }); this.pending.clear(); });
  }
  /** One agent's process in the home: Claude Code for one session, or Codex's shared one for every thread. */
  static start(h: Home): Agent {
    const child = spawn(NODE, [AGENT, HOOK], { cwd: h.tmp, env: childEnv(h), stdio: ['pipe', 'pipe', 'inherit'] });
    children.add(child);
    child.stdin!.on('error', () => undefined);
    return new Agent(child);
  }
  private send(command: Line): Promise<Line> {
    const n = ++this.n;
    const answer = new Promise<Line>((done) => this.pending.set(n, done));
    this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    return answer;
  }
  /** `deep-hook <args…>`, the hook's JSON on its stdin, as a child of this agent. */
  async hook(args: string[], cwd: string, payload: Line): Promise<Ran> {
    return await this.send({ op: 'hook', args, cwd, input: JSON.stringify(payload) }) as unknown as Ran;
  }
  /** A command as a shell call runs it, to its end. */
  async shell(command: string, cwd: string): Promise<Ran> {
    return await this.send({ op: 'shell', command, cwd }) as unknown as Ran;
  }
  /** A command as a shell call runs it, left running: its first line of output, and the handle `close` ends it by. A command that ends without a line is BLOCKED. */
  async open(command: string, cwd: string): Promise<{ id: number; line: string }> {
    const started = await this.send({ op: 'open', command, cwd });
    if (typeof started.id !== 'number') throw Error(`BLOCKED: the call's command printed no line: ${cut(JSON.stringify(started))}`);
    return { id: started.id, line: String(started.line) };
  }
  async close(id: number): Promise<Ran> {
    return await this.send({ op: 'close', id }) as unknown as Ran;
  }
}

// ---- Sessions: a Codex thread and a Claude Code session, each named only by its hooks' payloads.
export interface Session { agent: 'codex' | 'claude-code'; id: string; cwd: string; transcript: string; turn: string; prompt: string | undefined; proc: Agent; h: Home }
/** A Codex thread: its rollout under the home's ~/.codex/sessions names a version the facts cover. */
export function codexThread(h: Home, proc: Agent): Session {
  const id = randomUUID();
  const cwd = join(h.tmp, `w${tag(3)}`);
  mkdirSync(cwd, { recursive: true });
  const transcript = join(h.codexHome, 'sessions', `rollout-${id}.jsonl`);
  writeFileSync(transcript, `${JSON.stringify({ type: 'session_meta', payload: { id, cwd, cli_version: CODEX_COVERED, originator: 'codex_cli_rs' } })}\n`);
  return { agent: 'codex', id, cwd, transcript, turn: randomUUID(), prompt: undefined, proc, h };
}
/** A Claude Code session: its transcript under the home's ~/.claude/projects. */
export function claudeSession(h: Home, proc: Agent): Session {
  const id = randomUUID();
  const cwd = join(h.tmp, `w${tag(3)}`);
  mkdirSync(cwd, { recursive: true });
  const transcript = join(h.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { agent: 'claude-code', id, cwd, transcript, turn: randomUUID(), prompt: undefined, proc, h };
}
/** A line of a Claude Code transcript, as Claude Code writes one. */
function entry(s: Session, value: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: CLAUDE_COVERED, userType: 'external', entrypoint: 'cli', ...value };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
/** A hook's payload, shaped as each agent's own (adapters/corpus). */
function payload(s: Session, event: string, extra: Line): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.agent === 'codex') {
    base.model = 'gpt-reserve';
    if (event === 'SessionStart') base.source = 'startup';
    else base.turn_id = s.turn;
  } else if (event === 'SessionStart') Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' });
  else if (s.prompt) base.prompt_id = s.prompt;
  return { ...base, ...extra };
}
/** One hook of the session through the real deep-hook, `deep-hook <agent> <event>`, as a child of its agent's process. */
export const hook = (s: Session, event: string, extra: Line = {}): Promise<Ran> => s.proc.hook([s.agent, event], s.cwd, payload(s, event, extra));
/**
 * A hook, fired again until the record holds its event: past its 50 ms deep-hook lets a call go and the event can
 * miss the hub (a machine at many times its cores' load does that), and these tests judge the hub, never the load.
 * Six tries with none recorded are BLOCKED.
 */
export async function fired(hub: Hub, s: Session, event: string, extra: Line, kind: string, match: (e: Ev) => boolean = () => true): Promise<Ran> {
  for (let n = 1; ; n++) {
    const ran = await hook(s, event, extra);
    if (await until(async () => (await allEvents(hub)).some((e) => e.kind === kind && e.session === s.id && match(e)), 20_000, 200)) return ran;
    if (n === 6) throw Error(`BLOCKED: the record holds no ${kind} of the session's ${event} after ${n} tries: ${tilde(s.h, shown(ran))}`);
  }
}
/** The session starts, its SessionStart in the record. */
export async function start(hub: Hub, s: Session): Promise<void> {
  const ran = await fired(hub, s, 'SessionStart', {}, 'session.start');
  if (ran.code !== 0) throw Error(`BLOCKED: the SessionStart hook must end with exit 0: ${tilde(s.h, shown(ran))}`);
}
/** The session starts and you type a prompt, which opens its turn. */
export async function begin(hub: Hub, s: Session, text: string): Promise<void> {
  await start(hub, s);
  s.turn = randomUUID();
  if (s.agent === 'claude-code') {
    s.prompt = randomUUID();
    entry(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  }
  await hook(s, 'UserPromptSubmit', { prompt: text });
}
/** What deep-hook's output tells the agent of a call: exit 2 or a deny or block decision stops it. */
const denies = (r: Ran): boolean => {
  const out = parseObject(r.stdout.trim());
  return r.code === 2 || out?.hookSpecificOutput?.permissionDecision === 'deny' || out?.decision === 'block';
};
export interface Call { id: string; command: string; input: Line }
/**
 * A shell call's PreToolUse, in the record before this returns, so the hub knows the call is running. A call the hook
 * denies never runs, so the test can't go on: BLOCKED.
 */
export async function callBefore(hub: Hub, s: Session, command: string): Promise<Call> {
  const id = s.agent === 'codex' ? `call_${tag(6)}` : `toolu_${tag(12)}`;
  const input = s.agent === 'codex' ? { command } : { command, description: 'Run a script' };
  if (s.agent === 'claude-code') entry(s, { type: 'assistant', message: { role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id, name: 'Bash', input }] } });
  const ran = await fired(hub, s, 'PreToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: id }, 'tool.before', (e) => e.data?.call === id);
  if (denies(ran)) throw Error(`BLOCKED: DeepBuild's PreToolUse hook denied the call ${id}, so its command never runs: ${tilde(s.h, shown(ran))}`);
  return { id, command, input };
}
/** The call's PostToolUse, once its command has ended, in the record before this returns. */
export async function callAfter(hub: Hub, s: Session, call: Call, ended: Ran): Promise<void> {
  const response = s.agent === 'codex' ? { stdout: ended.stdout, stderr: ended.stderr, exit_code: ended.code ?? 1 } : { stdout: ended.stdout, stderr: ended.stderr, interrupted: false };
  if (s.agent === 'claude-code') entry(s, { type: 'user', message: { role: 'user', content: [{ tool_use_id: call.id, type: 'tool_result', content: ended.stdout, is_error: false }] } });
  await fired(hub, s, 'PostToolUse', { tool_name: 'Bash', tool_input: call.input, tool_use_id: call.id, tool_response: response }, 'tool.after', (e) => e.data?.call === call.id);
}
/**
 * Whether one reading names the call and the file its entry went from (README: Readings, 5). The call: by its ID, by
 * its command, or by the record's ID of its PreToolUse or PostToolUse event. The file: by its name (`hooks.json`,
 * `.claude.json`), anywhere in the reading but inside the call's own command. A reading that names only the call
 * isn't one: at the base the hub already names a call that ran past its expected time. Read for at most 20 s.
 */
export async function readingNames(hub: Hub, s: Session, call: Call, file: string): Promise<boolean> {
  const found = await until(async () => {
    const events = await allEvents(hub);
    const own = events.filter((e) => e.session === s.id && (e.kind === 'tool.before' || e.kind === 'tool.after') && e.data?.call === call.id).map((e) => e.id);
    const names = [call.id, call.command, ...own];
    return (await readingTexts(hub, events)).some((text) => names.some((n) => text.includes(n)) && text.replaceAll(call.command, '').includes(file));
  }, 20_000, 250);
  return found === true;
}

// ---- Codex's hooks.json: every hook entry, by event, group and place, with its own bytes as the file holds them.
/** Where each value of a JSON text starts and ends, by its path's JSON. */
function spans(text: string): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  let i = 0;
  const space = (): void => { while (i < text.length && ' \t\r\n'.includes(text[i]!)) i++; };
  const string = (): string => {
    const from = i;
    for (i++; text[i] !== '"'; i++) {
      if (i >= text.length) throw SyntaxError('a string never ends');
      if (text[i] === '\\') i++;
    }
    i++;
    return JSON.parse(text.slice(from, i)) as string;
  };
  const value = (path: (string | number)[]): void => {
    space();
    const from = i;
    if (text[i] === '{') {
      i++;
      space();
      if (text[i] === '}') i++;
      else for (;;) {
        space();
        if (text[i] !== '"') throw SyntaxError(`a key expected at byte ${i}`);
        const key = string();
        space();
        if (text[i++] !== ':') throw SyntaxError(`a colon expected at byte ${i - 1}`);
        value([...path, key]);
        space();
        const next = text[i++];
        if (next === '}') break;
        if (next !== ',') throw SyntaxError(`a comma or } expected at byte ${i - 1}`);
      }
    } else if (text[i] === '[') {
      i++;
      space();
      if (text[i] === ']') i++;
      else for (let n = 0; ; n++) {
        value([...path, n]);
        space();
        const next = text[i++];
        if (next === ']') break;
        if (next !== ',') throw SyntaxError(`a comma or ] expected at byte ${i - 1}`);
      }
    } else if (text[i] === '"') string();
    else {
      while (i < text.length && /[-+.\w]/.test(text[i]!)) i++;
      if (i === from) throw SyntaxError(`a value expected at byte ${i}`);
    }
    out.set(JSON.stringify(path), [from, i]);
  };
  value([]);
  return out;
}
export interface Entry { event: string; group: number; index: number; hook: Line; raw: string }
/** Every hook entry of a hooks.json; none while the file is missing or doesn't parse, as in the middle of a write in place. */
export function entriesIn(file: string): Entry[] {
  let text: string;
  let at: Map<string, [number, number]>;
  try {
    text = readFileSync(file, 'utf8');
    at = spans(text);
  } catch {
    return [];
  }
  const hooks: unknown = parseObject(text)?.hooks;
  if (!isObj(hooks)) return [];
  const out: Entry[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((g: unknown, group) => {
      if (!isObj(g) || !Array.isArray(g.hooks)) return;
      g.hooks.forEach((h: unknown, index: number) => {
        const span = at.get(JSON.stringify(['hooks', event, group, 'hooks', index]));
        if (isObj(h) && span) out.push({ event, group, index, hook: h, raw: text.slice(span[0], span[1]) });
      });
    });
  }
  return out;
}
/** Whether a hook command is DeepBuild's: it runs deep-hook, or the deep CLI. */
export const isDeepBuild = (command: unknown): boolean => typeof command === 'string' && (/deep-hook/.test(command) || /(^|[\s/'"])deep(\s|$)/.test(command));
/** DeepBuild's entries for an event, as the file holds them now. */
export const oursNow = (h: Home, event: string): Entry[] => entriesIn(h.hooksFile).filter((e) => e.event === event && isDeepBuild(e.hook.command));
/** Every command the file holds for an event, in order. */
export const commandsNow = (h: Home, event: string): string[] => entriesIn(h.hooksFile).filter((e) => e.event === event).map((e) => String(e.hook.command));
/** DeepBuild's one entry for an event, as setup wrote it; none, or more than one, is BLOCKED. */
export function ourEntry(h: Home, event: string): Entry {
  const found = oursNow(h, event);
  if (found.length !== 1) throw Error(`BLOCKED: deep setup must write one ${event} entry of DeepBuild's into ~/.codex/hooks.json; it holds ${found.length}: ${tilde(h, cut(JSON.stringify(entriesIn(h.hooksFile).map((e) => [e.event, e.hook.command]))))}`);
  const e = found[0]!;
  if (canon(parseObject(e.raw)) !== canon(e.hook)) throw Error(`BLOCKED: this suite's reader didn't find the ${event} entry's own bytes in ~/.codex/hooks.json: ${tilde(h, cut(e.raw))}`);
  return e;
}
/** What `~/.codex/hooks.json` is now where it was a link: undefined while it is still the same link. */
export function linkProblem(h: Home): string | undefined {
  if (!h.link) return undefined;
  const s = lstatSync(h.hooksFile, { throwIfNoEntry: false });
  if (!s) return 'gone';
  if (!s.isSymbolicLink()) return 'a plain file where the link was';
  return readlinkSync(h.hooksFile) === h.link ? undefined : `a link to ${readlinkSync(h.hooksFile)}`;
}

// ---- Claude Code's ~/.claude.json: DeepBuild's MCP server in it (README: Readings, the `deep` MCP server).
export function claudeJsonNow(h: Home): Line | undefined {
  try { return parseObject(readFileSync(h.claudeJson, 'utf8')); } catch { return undefined; }
}
/**
 * The `deep` MCP server as setup registered it: the one entry under `mcpServers` that runs `deep mcp`, its `args`
 * ending in `mcp`. Its name is read off the file. None, or more than one, is BLOCKED.
 */
export function deepServer(h: Home): { name: string; entry: Line } {
  const servers: unknown = claudeJsonNow(h)?.mcpServers;
  const found = Object.entries(isObj(servers) ? servers : {}).filter(([, v]) => isObj(v) && Array.isArray(v.args) && v.args.at(-1) === 'mcp');
  if (found.length !== 1) throw Error(`BLOCKED: deep setup must register one MCP server that runs deep mcp in ~/.claude.json; its mcpServers hold ${found.length}: ${tilde(h, cut(JSON.stringify(servers)))}`);
  return { name: found[0]![0], entry: found[0]![1] as Line };
}

// ---- "Within a second": from the removal to the first read that finds the entry back.
export interface Back { back: boolean; ms: number; gone: number | null; reads: number }
/**
 * Reads until `isBack()` holds, at most `limit` ms after the removal at `at` (epoch ms, the script's own clock, which
 * is this machine's). `ms` is the first read that found the entry back, or the last read when none did; `gone` the
 * last read that found it still gone; all counted from the removal.
 */
export async function watchBack(isBack: () => boolean, at: number, limit: number): Promise<Back> {
  let gone: number | null = null;
  for (let reads = 1; ; reads++) {
    const back = isBack();
    const ms = Date.now() - at;
    if (back) return { back, ms, gone, reads };
    gone = ms;
    if (ms >= limit) return { back, ms, gone, reads };
    await step(10);
  }
}
/**
 * How a put-back reads against the criterion's second. `within`: a read within the second found the entry back.
 * `over`: a read past the second still found it gone, on a machine whose load is under its cores. `unmeasured`: it
 * came back past the second while the machine's load was over its cores, or this suite's own reads were too far
 * apart to say on which side of the second it came back; that is INCONCLUSIVE, never a pass.
 */
export function againstSecond(w: Back): 'within' | 'over' | 'unmeasured' {
  if (w.ms <= SECOND) return 'within';
  return w.gone !== null && w.gone >= SECOND && !loaded() ? 'over' : 'unmeasured';
}

// ---- Codex's own hook list and trust (the real binary, app-server's hooks/list), in the test's own CODEX_HOME only.
export interface Listed { key: string; eventName: string; command: string; timeoutSec: number; matcher: string | null; currentHash: string; trustStatus: string; enabled: boolean }
/** Codex's hook list, from `codex app-server` in the home's own CODEX_HOME; a codex that gives none is BLOCKED. */
export async function hooksList(h: Home): Promise<Listed[]> {
  const child = spawn(join(h.bin, 'codex'), ['app-server'], { cwd: h.tmp, env: childEnv(h, { CODEX_HOME: h.codexHome }), stdio: ['pipe', 'pipe', 'ignore'] });
  children.add(child);
  child.once('exit', () => children.delete(child));
  child.stdin!.on('error', () => undefined);
  const say = (message: Line): void => { child.stdin!.write(`${JSON.stringify(message)}\n`); };
  const reply = new Promise<Line>((resolve, reject) => {
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (line?.id === 1) { say({ method: 'initialized' }); say({ id: 2, method: 'hooks/list', params: { cwds: [h.tmp] } }); }
      else if (line?.id === 2) resolve(line);
    });
    child.once('error', (error) => reject(Error(`BLOCKED: codex app-server didn't start: ${error.message}`)));
    child.once('exit', (code) => reject(Error(`BLOCKED: codex app-server exited ${code} before it answered hooks/list`)));
  });
  say({ id: 1, method: 'initialize', params: { clientInfo: { name: 'dh1867', version: '0' }, capabilities: { experimentalApi: true } } });
  try {
    const line = await Promise.race([reply, bound(120_000).then(() => { throw Error('BLOCKED: codex app-server gave no hooks/list reply within 120 s'); })]);
    const data: unknown = line.result?.data;
    if (!Array.isArray(data)) throw Error(`BLOCKED: Codex's hooks/list gave no list: ${tilde(h, cut(JSON.stringify(line), 600))}`);
    return data.flatMap((d: unknown) => (isObj(d) && Array.isArray(d.hooks) ? (d.hooks as Listed[]) : []));
  } finally {
    child.stdin!.end();
    if (!gone(child)) child.kill('SIGTERM');
  }
}
/** You approve each listed hook once in `/hooks`: what that writes, `[hooks.state."<key>"] trusted_hash`, in the home's own config.toml. */
export async function trustAll(h: Home): Promise<Listed[]> {
  const listed = await hooksList(h);
  const toml = listed.map((l) => `[hooks.state.${JSON.stringify(l.key)}]\ntrusted_hash = ${JSON.stringify(l.currentHash)}\n`).join('\n');
  writeFileSync(h.configToml, `${existsSync(h.configToml) ? readFileSync(h.configToml, 'utf8') : ''}\n${toml}`);
  return hooksList(h);
}
/** DeepBuild's entry for an event in Codex's list; Codex names the event in its own case. */
export const listedOurs = (list: readonly Listed[], event: string): Listed | undefined => list.find((l) => String(l.eventName).toLowerCase() === event.toLowerCase() && isDeepBuild(l.command));
