// Shared test-side tools for the issue #317 acceptance tests: temp homes, the shipped default guard@1 entries and
// this repo's own entries installed as rules.json, deep-hook run as an agent's hook entry runs it, the hub as a
// process (installed, dev and safe mode), real git checkouts, the hub's record read over its socket, and the
// wrong programs built as data: the defaults with every entry that holds a named call removed. Parts are adapted
// from tests/acceptance/316/helpers.ts and 315/helpers.ts (same repo, same license); this suite keeps its own copy
// so a redraft of those suites never moves these tests. Nothing here stands in for deep-hook: every decision comes
// from the real binary, and no planted call is ever run, except AC3's script, only inside its own temp repo and
// only after deep-hook allowed it.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
/** The core's default guard@1 entries, installed verbatim as the first rules.json (#316's surface). */
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
/** This repo's own guard@1 entries, `{v, entries}`, which the hub's install adds to rules.json (README). */
export const REPO_RULES = join(REPO, '.deepbuild/rules.json');
/** The hub's login service on macOS, as the base names it (packages/hub/src/service.ts). */
export const SERVICE_LABEL = 'com.deepbuild.hub';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh317-'));
  made.push(dir);
  return dir;
}
/** A fresh home folder; rules.json, the spool and the installed hub's root live in <home>/.deepbuild. */
export function makeHome(): string {
  const home = join(tempDir(), 'h');
  mkdirSync(home);
  return home;
}
export const rootOf = (home: string) => join(home, '.deepbuild');

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
export function own(pid: number | undefined): void {
  if (pid) owned.add(pid);
}
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
  try {
    return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }));
  } catch {
    return false;
  }
}
/** Stops every process this suite started (SIGTERM, then SIGKILL after 3 s), by PID, and removes temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) {
    try { process.kill(pid, 'SIGCONT'); } catch { /* gone */ }
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) {
    if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a child gets: this one with HOME moved to the test's home and no DEEP_/GIT_ settings or billing keys. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('GIT_') || key.startsWith('AWS_') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.PATH = `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  env.LC_ALL = 'C';
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
/** Runs a command to its end without blocking this process's event loop. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 60_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}

// ---- deep-hook, built once per test process (the README's "How to run" warms it first).
let built: Promise<string> | undefined;
export function buildDeepHook(): Promise<string> {
  built ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutMs: 900_000 }).then((r) => {
    if (r.code !== 0) throw Error(`BLOCKED: cargo build --locked -q -p deep-hook failed: ${r.stderr.slice(-3000)}`);
    if (!existsSync(DEEP_HOOK)) throw Error(`BLOCKED: no binary at ${DEEP_HOOK}`);
    spawnSync(DEEP_HOOK, ['--version'], { stdio: 'ignore', timeout: 30_000 });
    return DEEP_HOOK;
  });
  return built;
}

// ---- Sessions and their hook JSON, shaped like the corpus's Claude Code payloads (adapters/corpus/claude-code).
export interface Session { id: string; cwd: string; transcript: string }
/** A session whose cwd is `cwd` (a real checkout where a criterion needs one) or a fresh work folder. */
export function newSession(home: string, cwd?: string): Session {
  const id = randomUUID();
  const dir = cwd ?? join(dirname(home), 'work');
  mkdirSync(dir, { recursive: true });
  const transcript = join(home, '.claude/projects', dir.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd: dir, transcript };
}
let calls = 0;
export const callId = () => `toolu_${randomBytes(12).toString('hex')}_${++calls}`;
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (event === 'SessionStart') Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' });
  return { ...base, ...extra };
}
const tool = (s: Session, name: string, input: Line): Line =>
  payload(s, 'PreToolUse', { tool_name: name, tool_input: input, tool_use_id: callId() });
export const bash = (s: Session, command: string) => tool(s, 'Bash', { command });
export const edit = (s: Session, filePath: string) => tool(s, 'Edit', { file_path: filePath, old_string: 'a', new_string: 'b', replace_all: false });
export const write = (s: Session, filePath: string, content = 'x') => tool(s, 'Write', { file_path: filePath, content });
export const read = (s: Session, filePath: string) => tool(s, 'Read', { file_path: filePath });

/** deep-hook as a hook entry runs it: `deep-hook claude-code <event>`, the hook JSON on stdin, HOME the agent's. */
export function hook(home: string, s: Session, body: Line, o: { cwd?: string } = {}): Promise<Ran> {
  const event = String(body.hook_event_name);
  return run(DEEP_HOOK, ['claude-code', event], { cwd: o.cwd ?? s.cwd, env: childEnv(home), input: JSON.stringify(body), timeoutMs: 30_000 });
}

/** What deep-hook's output tells Claude Code about a PreToolUse: exit 2 or a deny decision denies; exit 0 allows. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(1)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 500))}, stderr ${JSON.stringify(r.stderr.slice(0, 500))}`;
/** Everything deep-hook printed: Claude Code reads a deny's reason from stderr (exit 2) or from the JSON (stdout). */
export const denialText = (r: Ran) => `${r.stdout}\n${r.stderr}`;

// ---- Rules: the shipped defaults, this repo's own entries, and the data plants made from them.
export interface Guard { match: unknown; scope: string; mode: string; reason: string; next_step: string; fail_closed: boolean; [k: string]: unknown }
export interface Rules { v: number; entries: Record<string, Guard> }
function readRules(file: string, what: string): Rules {
  if (!existsSync(file)) throw Error(`${what} is missing at ${file.slice(REPO.length + 1)} (README, Where the entries live)`);
  const parsed = parseObject(readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed.v !== 'number' || typeof parsed.entries !== 'object' || parsed.entries === null) {
    throw Error(`${what} at ${file.slice(REPO.length + 1)} is not {v, entries}: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  return parsed as Rules;
}
export const defaultRules = (): Rules => readRules(DEFAULT_RULES, "the core's default guard@1 entries");
export const repoRules = (): Rules => readRules(REPO_RULES, "this repo's own guard@1 entries");
/** Two sets of entries as one rules.json, as the hub's install writes it; a name in both is an error, not an override. */
export function merged(a: Rules, b: Rules): Rules {
  for (const name of Object.keys(b.entries)) if (name in a.entries) throw Error(`entry ${name} is both a default and this repo's own`);
  return { v: a.v, entries: { ...a.entries, ...b.entries } };
}
export function installRules(home: string, rules: Rules): void {
  mkdirSync(rootOf(home), { recursive: true });
  writeFileSync(join(rootOf(home), 'rules.json'), `${JSON.stringify(rules, null, 2)}\n`);
}
/** The name of a shipped entry whose `reason` and `next_step` both appear whole in the denial, or null. */
export function carriesReasonNextStep(r: Ran, rules: Rules): string | null {
  const text = denialText(r);
  for (const [name, g] of Object.entries(rules.entries)) {
    if (g.reason && g.next_step && text.includes(g.reason) && text.includes(g.next_step)) return name;
  }
  return null;
}

/**
 * Text compared for "naming the command" or "naming the file": `~/` and `$HOME/` read as the home folder, quotes
 * dropped and whitespace collapsed, so a denial that names `sqlite3 /…/h/.deepbuild/ledger.db "insert …"` names
 * `sqlite3 ~/.deepbuild/ledger.db 'insert …'`.
 */
export function plain(text: string, home: string): string {
  return text
    .replace(/\$\{HOME\}\/|\$HOME\//g, `${home}/`)
    .replace(/(^|[\s'"=:(`])~\//g, `$1${home}/`)
    .replace(/['"`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
export const names = (r: Ran, what: string, home: string) => plain(denialText(r), home).includes(plain(what, home));

/** Single-quotes a word for sh. */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** A shell command as written directly, through `sh -c`, through `nohup`, and as a heredoc fed to sh. */
export function forms(command: string, only: ('direct' | 'sh -c' | 'nohup' | 'heredoc')[] = ['direct', 'sh -c', 'nohup', 'heredoc']): { form: string; command: string }[] {
  const all = {
    direct: command,
    'sh -c': /'/.test(command) && !/["$`\\]/.test(command) ? `sh -c "${command}"` : `sh -c ${shq(command)}`,
    nohup: `nohup ${command}`,
    heredoc: `sh <<'EOF'\n${command}\nEOF`,
  };
  return only.map((form) => ({ form, command: all[form] }));
}

// ---- A world: a home with rules installed, a session, and the hub stopped, up, or up in safe mode.
export type Mode = 'stopped' | 'up' | 'safe';
export interface World { home: string; s: Session; rules: Rules; mode: Mode; hub?: Hub }
export async function world(o: { rules: Rules; mode: Mode; cwd?: string; prep?: (home: string) => void }): Promise<World> {
  const home = makeHome();
  installRules(home, o.rules);
  o.prep?.(home);
  const s = newSession(home, o.cwd);
  const hub = o.mode === 'stopped' ? undefined : await startHub(home, { safe: o.mode === 'safe' });
  return { home, s, rules: o.rules, mode: o.mode, ...(hub ? { hub } : {}) };
}
export const hubWords = (m: Mode) => (m === 'stopped' ? 'with the hub stopped' : m === 'up' ? 'with the hub up' : 'with the hub up in safe mode');

/** A planted call or its twin: its label (the call as written), its hook body, and what a denial must name. */
export interface Call { label: string; body: (w: World) => Line; naming?: (w: World) => string; propose?: boolean }
export const sh = (command: string, naming?: string, propose?: boolean): Call =>
  ({ label: command, body: (w) => bash(w.s, command), ...(naming !== undefined ? { naming: () => naming } : {}), ...(propose ? { propose } : {}) });
/** Each form of a shell command, every one of which must name the command itself (unwrapped). */
export const shForms = (command: string, only?: Parameters<typeof forms>[1]): Call[] =>
  forms(command, only).map((f) => sh(f.command, command));

export async function decide(w: World, call: Call): Promise<Ran> {
  return hook(w.home, w.s, call.body(w));
}
/** Throws at the first call that isn't denied as the criterion says, naming the call and the hub's state. */
export async function expectDenied(w: World, list: Call[]): Promise<void> {
  for (const call of list) {
    const ran = await decide(w, call);
    const at = `\`${call.label}\` ${hubWords(w.mode)}`;
    if (decision(ran) !== 'deny') throw Error(`${at} must be denied: ${shown(ran)}`);
    if (!carriesReasonNextStep(ran, w.rules)) throw Error(`${at}: the denial carries no shipped entry's reason and next_step: ${shown(ran)}`);
    const naming = call.naming?.(w);
    if (naming !== undefined && !names(ran, naming, w.home)) throw Error(`${at}: the denial does not name \`${naming}\`: ${shown(ran)}`);
    if (call.propose && !denialText(ran).includes('deep_propose')) throw Error(`${at}: the denial does not name deep_propose: ${shown(ran)}`);
  }
}
export async function expectAllowed(w: World, list: Call[]): Promise<void> {
  for (const call of list) {
    const ran = await decide(w, call);
    if (decision(ran) !== 'allow') throw Error(`the twin \`${call.label}\` ${hubWords(w.mode)} must be allowed: ${shown(ran)}`);
  }
}

/**
 * The wrong program "without that entry", built as data and blind to `match` spellings: the entries that, each
 * installed alone with the hub stopped, deny `probe`, removed from `rules`. Throws when no entry holds the probe,
 * since then there is nothing to remove and the rules are no wrong program of this build.
 */
export async function without(rules: Rules, probe: Call, cwd?: string, prep?: (home: string) => void): Promise<{ rules: Rules; removed: string[] }> {
  const removed: string[] = [];
  for (const [name, entry] of Object.entries(rules.entries)) {
    const w = await world({ rules: { v: rules.v, entries: { [name]: entry } }, mode: 'stopped', ...(cwd ? { cwd } : {}), ...(prep ? { prep } : {}) });
    if (decision(await decide(w, probe)) === 'deny') removed.push(name);
  }
  if (!removed.length) throw Error(`no shipped entry, installed alone with the hub stopped, denies \`${probe.label}\`: there is no entry to leave out, so the wrong program can't be made`);
  const entries = Object.fromEntries(Object.entries(rules.entries).filter(([n]) => !removed.includes(n)));
  return { rules: { v: rules.v, entries }, removed };
}

// ---- The hub as a process: the installed one (HOME's ~/.deepbuild), a dev hub (--root), safe mode (--safe).
export interface Ready { v: number; ready: true; pid: number; socket: string; start: string }
export interface Hub extends Ready { home: string; root: string; child: ChildProcess; stderr(): string }
export async function startHub(home: string, o: { root?: string; safe?: boolean } = {}, timeoutMs = 30_000): Promise<Hub> {
  const args = [CLI, 'hub', 'run', ...(o.root ? ['--root', o.root] : []), ...(o.safe ? ['--safe'] : [])];
  const child = spawn(NODE, args, { cwd: REPO, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let err = '';
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<undefined>((resolve) => child.on('exit', () => resolve(undefined)));
  const ready = new Promise<Ready | undefined>((resolve) => {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      const first = out.split('\n')[0];
      if (out.includes('\n') && first !== undefined) {
        const parsed = parseObject(first);
        resolve(parsed && parsed.ready === true ? (parsed as Ready) : undefined);
      }
    });
    void exit.then(() => resolve(undefined));
  });
  const r = await Promise.race([ready, exit, sleep(timeoutMs).then(() => undefined)]);
  if (!r) throw Error(`the hub didn't start (deep ${args.slice(1).join(' ')}): ${err.slice(0, 1500)}`);
  return { ...r, home, root: o.root ?? rootOf(home), child, stderr: () => err };
}

// ---- The hub's record, read as the CLI reads it: the cli role with the control token, then events.read.
async function controlCall(socket: string, tokenFile: string, method: string, params: Line): Promise<Line> {
  const token = readFileSync(tokenFile, 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method} at ${socket}`)); }, 15_000);
    sock.setEncoding('utf8');
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.on('data', (d: string) => {
      buffer += d;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const l = parseObject(buffer.slice(0, i)) ?? {};
        buffer = buffer.slice(i + 1);
        if (step === 0 && 'hello' in l) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`); }
        else if (step === 1 && ('role' in l || 'error' in l)) {
          if (l.role !== 'cli') { clearTimeout(timer); sock.destroy(); reject(Error(`the hub refused the cli hello: ${JSON.stringify(l)}`)); return; }
          step = 2;
          sock.write(`${JSON.stringify({ v: 1, id: 'q', method, params })}\n`);
        } else if (step === 2 && l.id === 'q') {
          clearTimeout(timer);
          sock.destroy();
          if ('error' in l) reject(Error(`${method} refused: ${JSON.stringify(l.error)}`));
          else resolve(l.result as Line);
        }
      }
    });
  });
}
/** Every event in a hub's log, as JSON text each, paged by log_pos. */
export async function eventTexts(root: string): Promise<string[]> {
  const out: string[] = [];
  let after = 0;
  for (;;) {
    const events = (await controlCall(join(root, 'hub.sock'), join(root, 'control.token'), 'events.read', { after, limit: 1000 })).events as Line[];
    if (!events?.length) return out;
    out.push(...events.map((e) => JSON.stringify(e)));
    after = Number(events[events.length - 1]!.log_pos);
  }
}
/** Polls a hub's log until one event mentions every needle; returns whether one did within the time. */
export async function recorded(root: string, needles: string[], timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await eventTexts(root)).some((t) => needles.every((n) => t.includes(n)))) return true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}

// ---- Real git checkouts in temp folders. Every git call skips the user's hooks and signing.
export interface Checkout { dir: string; git(args: string[], cwd?: string): string }
export function makeRepo(files: Record<string, string> = { README: 'base\n' }): Checkout {
  const dir = join(tempDir(), 'repo');
  mkdirSync(dir, { recursive: true });
  const git = (args: string[], cwd = dir): string =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: { ...childEnv(dir), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e' } }).trim();
  git(['init', '-q', '-b', 'main']);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  return { dir, git };
}
export function addWorktree(repo: Checkout, name: string): string {
  const path = join(dirname(repo.dir), name);
  repo.git(['worktree', 'add', '-q', '-b', `wt-${name}`, path]);
  return realpathSync(path);
}

/** A process this suite started and owns (a `sleep`), standing for a PID the session started. */
export function sleeper(): number {
  const child = spawn('sleep', ['600'], { stdio: 'ignore', detached: true });
  own(child.pid);
  return child.pid!;
}
