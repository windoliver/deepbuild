// Test-side tools for the issue #1501 acceptance tests: temp homes, the shipped default guard@1 entries (plus this
// suite's own watch, warn and block entries) installed as rules.json, Claude Code sessions whose transcript names
// their version, the real deep-hook run as a hook entry runs it, the real hub as a process, a forwarder at the
// address setting that keeps each connection's lines so a test can tell the hub's own answer from deep-hook's
// hub-away one, and the hub's record read over its socket.
//
// Adapted from tests/acceptance/317/helpers.ts (temp homes, rules.json, deep-hook as a hook entry, the hub's ready
// line, PID-only cleanup), tests/acceptance/18/session/helpers.ts (transcripts stamped with a version, widened facts
// through DEEP_HUB_TEST_FACTS, events.read) and tests/acceptance/19/authority/helpers.ts (the forwarder and the
// address setting, reading a hold off the hub's acknowledgement). Same repo, same license. This suite keeps its own
// copy so a redraft of those suites never moves these tests. Nothing here stands in for deep-hook or the hub, and no
// planted call is ever run: deep-hook only decides.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const FACTS_FILE = join(REPO, 'adapters/claude-code.facts.json');
/** The version the issue names: one the facts don't list. */
export const UNLISTED = '9.9.9';
/** What deep-hook says in a denial it made alone, the hub not answering in time (crates/deep-hook/src/main.rs at the base). */
export const HUB_AWAY_WORDS = "while the hub doesn't answer";

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
export const jsonLines = (text: string): Line[] => text.split('\n').flatMap((raw) => { const l = parseObject(raw); return l ? [l] : []; });
export const tag = (prefix = 't'): string => `${prefix}${randomBytes(5).toString('hex')}`;

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1501-'));
  made.push(dir);
  return dir;
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
const closers: (() => Promise<void>)[] = [];
/** Closes the forwarders, stops every process this suite started (SIGTERM, then SIGKILL after 3 s), by PID, and removes temp folders. */
export async function cleanup(): Promise<void> {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a child gets: HOME the test's, no DEEP_/CLAUDE/CODEX/GIT_/AWS_ settings or billing keys; `extra` on top. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key.startsWith('GIT_') || key.startsWith('AWS_') || key.startsWith('TMUX') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' });
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
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;

// ---- deep-hook, built once per test process (the README's "How to run" warms it first).
let built: Promise<void> | undefined;
export function buildDeepHook(): Promise<void> {
  built ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutMs: 900_000 }).then((r) => {
    if (r.code !== 0 || !existsSync(DEEP_HOOK)) throw Error(`BLOCKED: cargo build --locked -q -p deep-hook failed: ${r.stderr.slice(-3000)}`);
    spawnSync(DEEP_HOOK, ['--version'], { stdio: 'ignore', timeout: 30_000 });
    if (!existsSync(CLI)) throw Error(`BLOCKED: no built CLI at ${CLI}; run npm run build --workspaces`);
  });
  return built;
}

// ---- Claude Code's facts: the versions they list.
export const factsVersions = (): string[] => (JSON.parse(readFileSync(FACTS_FILE, 'utf8')) as { versions: string[] }).versions;
/** The newest version the facts list (the last of `versions`): a session on it is gated as usual. */
export function listed(): string {
  const v = factsVersions();
  if (!v.length) throw Error(`BLOCKED: ${FACTS_FILE} lists no versions`);
  return v[v.length - 1]!;
}
export function assertUnlisted(): void {
  const facts = JSON.parse(readFileSync(FACTS_FILE, 'utf8')) as Line;
  if ((facts.versions as string[]).includes(UNLISTED) || facts.events?.versions?.[UNLISTED]) throw Error(`BLOCKED: the facts list ${UNLISTED}, so it can't stand for a version they don't`);
}
/**
 * A folder holding the shipped facts with `version` listed, its strict payload schema the newest listed version's:
 * a hub given it (DEEP_HUB_TEST_FACTS) gates a session on `version` as on any listed one. AC2 uses it as the wrong
 * program "a hub that ends watch-only altogether". The hub builds its whole adapter registry from that folder, so
 * every other shipped `adapters/*.facts.json` (codex, pi, paseo, mcp-servers, loops, and any added later) is copied
 * there verbatim.
 */
export function widenedFacts(dir: string, version: string): string {
  const facts = JSON.parse(readFileSync(FACTS_FILE, 'utf8')) as Line;
  const newest = listed();
  facts.versions = [...(facts.versions as string[]), version];
  facts.events.versions[version] = structuredClone(facts.events.versions[newest]);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'claude-code.facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
  const adapters = join(REPO, 'adapters');
  for (const file of readdirSync(adapters)) {
    if (file.endsWith('.facts.json') && file !== 'claude-code.facts.json') writeFileSync(join(dir, file), readFileSync(join(adapters, file)));
  }
  return dir;
}

// ---- Rules: the shipped defaults, and this suite's own entries beside them.
export interface Guard { match: unknown; scope: string; mode: string; reason: string; next_step: string; fail_closed: boolean; [k: string]: unknown }
export interface Rules { v: number; entries: Record<string, Guard> }
export function defaultRules(): Rules {
  const parsed = parseObject(readFileSync(DEFAULT_RULES, 'utf8'));
  if (!parsed || typeof parsed.v !== 'number' || typeof parsed.entries !== 'object') throw Error(`BLOCKED: ${DEFAULT_RULES} is not {v, entries}`);
  return parsed as Rules;
}
/** This suite's own entries, none fail_closed, each matching `echo <word>-<mode>…`: a watch, a warn and a block. */
export interface Own { word: string; watch: string; warn: string; block: string; rules: Rules }
export function withOwn(base: Rules): Own {
  const word = tag('t');
  const entry = (mode: string): Guard => ({ match: `shell:echo ${word}-${mode}*`, scope: 'all_repos', mode, reason: `The ${word} ${mode} commands are this test's ${mode} entry.`, next_step: `Leave the ${word} commands.`, fail_closed: false });
  const names = { watch: `t1501-${word}-watch`, warn: `t1501-${word}-warn`, block: `t1501-${word}-block` };
  const entries = { ...base.entries, [names.watch]: entry('watch'), [names.warn]: entry('warn'), [names.block]: entry('block') };
  return { word, ...names, rules: { v: base.v, entries } };
}
export function installRules(home: string, rules: Rules): void {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  writeFileSync(join(rootOf(home), 'rules.json'), `${JSON.stringify(rules, null, 2)}\n`);
}
export const floorNames = (rules: Rules): string[] => Object.keys(rules.entries).filter((n) => rules.entries[n]!.fail_closed === true);

// ---- Real git checkouts: a repo holding the spec, and a second worktree of it. Git skips the user's hooks and signing.
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
export interface Checkout { dir: string; other: string }
export function makeRepo(tmp: string): Checkout {
  const dir = join(tmp, 'repo');
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  writeFileSync(join(dir, '.deepbuild/done.yaml'), 'claims:\n  done:\n    checks: [unit]\n');
  writeFileSync(join(dir, 'README.md'), '# shop\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, env: { ...childEnv(tmp), ...GIT_ENV }, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const other = join(tmp, 'wt2');
  git('worktree', 'add', '-q', '-b', 'wt2', other);
  return { dir: realpathSync(dir), other: realpathSync(other) };
}

// ---- Claude Code sessions: hook payloads, and a transcript whose every entry carries the session's version.
export interface Session { id: string; cwd: string; transcript: string; version: string; parent: string | null }
/**
 * A session in `cwd` on Claude Code `version`. Its transcript is where Claude Code keeps it,
 * <home>/.claude/projects/<cwd, each non-alphanumeric character as ->/<id>.jsonl, and already holds one earlier turn
 * (a user entry and an assistant entry), every entry stamped with `version`, as tests/acceptance/18/session's do.
 */
export function newSession(home: string, cwd: string, version: string): Session {
  const id = randomUUID();
  const transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  const s: Session = { id, cwd, transcript, version, parent: null };
  userEntry(s, 'Look around the repo.');
  entry(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Done looking.' }], stop_reason: 'end_turn', usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 3 } } });
  return s;
}
function entry(s: Session, fields: Line): void {
  const uuid = randomUUID();
  appendFileSync(s.transcript, `${JSON.stringify({ parentUuid: s.parent, isSidechain: false, ...fields, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: s.cwd, sessionId: s.id, version: s.version, gitBranch: 'main' })}\n`);
  s.parent = uuid;
}
export function userEntry(s: Session, prompt: string): string {
  const promptId = randomUUID();
  entry(s, { promptId, type: 'user', message: { role: 'user', content: prompt }, permissionMode: 'default' });
  return promptId;
}
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, permission_mode: 'default', hook_event_name: event };
  if (event === 'SessionStart') Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' });
  return { ...base, ...extra };
}
export const callId = () => `toolu_${randomBytes(12).toString('hex')}`;

/** A tool call as a test names it: its label (the call as written) and its PreToolUse body, a fresh tool_use_id each time. */
export interface Call { label: string; body: (s: Session) => Line }
const tool = (s: Session, name: string, input: Line): Line => payload(s, 'PreToolUse', { tool_name: name, tool_input: input, tool_use_id: callId() });
export const bash = (command: string): Call => ({ label: command, body: (s) => tool(s, 'Bash', { command, description: 'Run it' }) });
export const editOf = (path: string, label = `Edit ${path}`): Call => ({ label, body: (s) => tool(s, 'Edit', { file_path: path, old_string: 'a', new_string: 'b', replace_all: false }) });
export const writeOf = (path: string, label = `Write ${path}`): Call => ({ label, body: (s) => tool(s, 'Write', { file_path: path, content: '{}\n' }) });
export const readOf = (path: string, label = `Read ${path}`): Call => ({ label, body: (s) => tool(s, 'Read', { file_path: path }) });
/** A PostToolUse for a Bash call, as Claude Code sends it once the command ran. */
export const postOf = (s: Session, pre: Line): Line => payload(s, 'PostToolUse', { tool_name: pre.tool_name, tool_input: pre.tool_input, tool_use_id: pre.tool_use_id, tool_response: { stdout: '', stderr: '', interrupted: false, isImage: false } });

/** deep-hook as a hook entry runs it: `deep-hook claude-code <event>`, the hook JSON on stdin, HOME the agent's. */
export function hook(home: string, s: Session, body: Line, timeoutMs = 60_000): Promise<Ran> {
  return run(DEEP_HOOK, ['claude-code', String(body.hook_event_name)], { cwd: s.cwd, env: childEnv(home), input: JSON.stringify(body), timeoutMs });
}
/** What Claude Code makes of a PreToolUse's output: exit 2 or a deny decision denies; exit 0 without one allows. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
export const outputText = (r: Ran) => `${r.stdout}\n${r.stderr}`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether a denial names the entry `name` as its guard (`guard <name>`) and says its reason, in its own words. */
export function namesGuard(r: Ran, rules: Rules, name: string): boolean {
  const text = outputText(r);
  const reason = rules.entries[name]?.reason;
  return new RegExp(`\\bguard:? ${escape(name)}(?![\\w-])`).test(text) && typeof reason === 'string' && text.includes(reason);
}
/** The fail_closed entries a denial names as its guard, each with its reason. */
export const floorNamed = (r: Ran, rules: Rules): string[] => floorNames(rules).filter((n) => namesGuard(r, rules, n));

// ---- The hub as a process: `deep hub run`, HOME the test's home, so its root is <home>/.deepbuild.
export interface Hub { pid: number; home: string; socket: string; child: ChildProcess; stderr(): string }
export async function startHub(home: string, o: { facts?: string } = {}, timeoutMs = 120_000): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, { DEEP_HUB_TEST_FACTS: o.facts }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(parseObject(first.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start (deep hub run): ${err.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(rootOf(home), 'hub.sock'), child, stderr: () => err };
}
/** SIGTERM to the hub by its PID, and waits for it to exit. */
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 20_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  while (alive(hub.pid)) await sleep(20);
}

// ---- A forwarder at the address setting: each connection's lines both ways, so the hub's own answer can be read.
export interface Exchange { up: string; down: string }
export interface Forwarder { path: string; exchanges: Exchange[]; close(): Promise<void> }
export function forwarder(dir: string, target: string): Promise<Forwarder> {
  const path = join(dir, `f${randomBytes(3).toString('hex')}.sock`);
  const exchanges: Exchange[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const x: Exchange = { up: '', down: '' };
    exchanges.push(x);
    const upstream = net.connect(target);
    sockets.add(client); sockets.add(upstream);
    client.on('data', (d: Buffer) => { x.up += d.toString('utf8'); });
    upstream.on('data', (d: Buffer) => { x.down += d.toString('utf8'); });
    client.pipe(upstream);
    upstream.pipe(client);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.end());
    upstream.on('close', () => client.end());
  });
  let closed = false;
  const f: Forwarder = {
    path,
    exchanges,
    close: () => new Promise((resolve) => {
      if (closed) return resolve();
      closed = true;
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    }),
  };
  closers.push(f.close);
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, () => resolve(f)); });
}
/** The address setting `{"hub": {"address": "unix:<path>"}}` in <home>/.deepbuild/config.json (#16); null removes it. */
export function setAddress(home: string, path: string | null): void {
  const file = join(rootOf(home), 'config.json');
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const config = existsSync(file) ? (parseObject(readFileSync(file, 'utf8')) ?? {}) : {};
  if (path === null) delete config.hub;
  else config.hub = { ...(config.hub as Line | undefined), address: `unix:${path}` };
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}
/** The hub's side of the exchange whose request `pick` chooses: the request, its acknowledgement and its reply. */
export interface HubSide { request: Line; ack?: Line; reply?: Line }
export function hubSide(fwd: Forwarder, pick: (request: Line) => boolean): HubSide | undefined {
  for (const x of [...fwd.exchanges].reverse()) {
    const request = jsonLines(x.up).find((l) => typeof l.event === 'string' && pick(l));
    if (!request) continue;
    const down = jsonLines(x.down);
    const at = down.findIndex((l) => l.ack === request.id);
    if (at < 0) return { request };
    const reply = down.slice(at + 1).find((l) => 'exit' in l);
    return { request, ack: down[at]!, ...(reply ? { reply } : {}) };
  }
  return undefined;
}
async function sideOf(fwd: Forwarder, pick: (request: Line) => boolean, waitMs: number): Promise<HubSide | undefined> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const side = hubSide(fwd, pick);
    if ((side?.ack && (side.reply || typeof side.ack.hold_until_ms === 'number')) || Date.now() > deadline) return side;
    await sleep(25);
  }
}
/** Whether what deep-hook printed is the hub's reply: its exit code and its text, not deep-hook's own hub-away decision. */
function tookHubReply(ran: Ran, side: HubSide | undefined): boolean {
  const reply = side?.reply;
  if (!reply || ran.code !== reply.exit) return false;
  const out = String(reply.stdout ?? '');
  const err = String(reply.stderr ?? '');
  const alone = outputText(ran).includes(HUB_AWAY_WORDS) && !`${out}${err}`.includes(HUB_AWAY_WORDS);
  return ran.stdout.includes(out.trim()) && ran.stderr.includes(err.trim()) && !alone;
}

// ---- A world: a home, the rules, a checkout, the hub up behind a forwarder, and sessions in the checkout.
export interface World { tmp: string; home: string; repo: Checkout; own: Own; rules: Rules; hub: Hub; fwd: Forwarder }
export async function world(o: { facts?: (tmp: string) => string } = {}): Promise<World> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home);
  const mine = withOwn(defaultRules());
  installRules(home, mine.rules);
  const repo = makeRepo(tmp);
  const hub = await startHub(home, o.facts ? { facts: o.facts(tmp) } : {});
  // Set after the hub is up, as tests/acceptance/19/authority does: the hub listens at its own root.
  const fwd = await forwarder(tmp, hub.socket);
  setAddress(home, fwd.path);
  return { tmp, home, repo, own: mine, rules: mine.rules, hub, fwd };
}
/** A session that started and took a prompt, as Claude Code's hooks report it, on `version`. */
export async function startSession(w: World, version: string): Promise<Session> {
  const s = newSession(w.home, w.repo.dir, version);
  // `startup`, not `resume`: the hub sends a resumed session's shell calls to the gate until the core reads its
  // cut-off turn (#85), which would hold calls these tests read at once.
  await hook(w.home, s, payload(s, 'SessionStart'));
  const prompt = 'Tidy the release notes, then stop.';
  const promptId = userEntry(s, prompt);
  await hook(w.home, s, payload(s, 'UserPromptSubmit', { prompt_id: promptId, prompt }));
  return s;
}
export const who = (s: Session) => `session ${s.id.slice(0, 8)} on Claude Code ${s.version}`;

export interface Decided { ran: Ran; side: HubSide; body: Line }
/**
 * A PreToolUse decided by the hub: run through deep-hook, and taken only when what deep-hook printed is the reply
 * the hub wrote on that connection. A call deep-hook decided alone (the hub not acknowledging within its 20 ms, as
 * under load) proves nothing about the hub and is tried again, a fresh tool_use_id each time, up to `tries` times;
 * then INCONCLUSIVE, never a pass.
 */
export async function hubDecides(w: World, s: Session, call: Call, tries = 10): Promise<Decided> {
  let last = '';
  for (let i = 0; i < tries; i++) {
    const body = call.body(s);
    const ran = await hook(w.home, s, body);
    const side = await sideOf(w.fwd, (l) => l.payload?.tool_use_id === body.tool_use_id, 1500);
    if (side && tookHubReply(ran, side)) return { ran, side, body };
    last = `${shown(ran)}; the hub's side ${JSON.stringify(side ?? null).slice(0, 600)}`;
    await sleep(100);
  }
  throw Error(`INCONCLUSIVE: in ${tries} tries deep-hook never printed the hub's own reply to \`${call.label}\` (${who(s)}); the machine is too loaded to read the hub: ${last}`);
}
/**
 * A hook whose hold the test reads off the hub's acknowledgement, without waiting for its end: the hub acknowledges
 * a call it holds with a number in `hold_until_ms` and one it answers at once with null (#16's hook protocol).
 */
export async function ackOf(w: World, s: Session, body: Line, pick: (request: Line) => boolean, waitMs = 30_000): Promise<{ ack: Line; done: Promise<Ran> } | undefined> {
  const done = hook(w.home, s, body);
  const deadline = Date.now() + waitMs;
  for (;;) {
    const side = hubSide(w.fwd, pick);
    if (side?.ack) return { ack: side.ack, done };
    if (Date.now() > deadline) return undefined;
    await sleep(25);
  }
}
/**
 * One turn that worked, then its Stop: a prompt, a Bash call matching this suite's watch entry, its PostToolUse
 * (acknowledged by the hub, so the hub saw the work), then the Stop, whose acknowledgement is returned. A turn whose
 * PostToolUse the hub never acknowledged is tried again; after `tries`, INCONCLUSIVE.
 */
export async function stopAfterWork(w: World, s: Session, tries = 6): Promise<{ ack: Line; done: Promise<Ran>; stopTag: string }> {
  let last = '';
  for (let i = 0; i < tries; i++) {
    const prompt = `Run the ${tag('n')} command, then stop.`;
    const promptId = userEntry(s, prompt);
    await hook(w.home, s, payload(s, 'UserPromptSubmit', { prompt_id: promptId, prompt }));
    const pre = bash(`echo ${w.own.word}-watch-${i}`).body(s);
    await hook(w.home, s, pre);
    const post = postOf(s, pre);
    await hook(w.home, s, post);
    const posted = await sideOf(w.fwd, (l) => l.event === 'PostToolUse' && l.payload?.tool_use_id === post.tool_use_id, 3000);
    if (!posted?.ack) { last = `the PostToolUse of ${pre.tool_use_id} was never acknowledged`; continue; }
    const stopTag = tag('stop');
    const body = payload(s, 'Stop', { prompt_id: promptId, stop_hook_active: false, last_assistant_message: `Ran it (${stopTag}).` });
    const got = await ackOf(w, s, body, (l) => l.event === 'Stop' && String(l.payload?.last_assistant_message ?? '').includes(stopTag));
    if (got) return { ...got, stopTag };
    last = `the Stop ${stopTag} was never acknowledged`;
  }
  throw Error(`INCONCLUSIVE: in ${tries} tries the hub never acknowledged a worked turn's PostToolUse and Stop for ${who(s)}: ${last}`);
}

// ---- The hub's record, read as the CLI reads it: the cli role with the control token, then events.read.
export interface Ev { id: string; kind: string; session?: string; data: Line; log_pos: number; verified?: boolean }
async function controlCall(home: string, method: string, params: Line): Promise<Line> {
  const root = rootOf(home);
  const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(join(root, 'hub.sock'));
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method}`)); }, 15_000);
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
          if (l.role !== 'cli') { clearTimeout(timer); sock.destroy(); reject(Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(l)}`)); return; }
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
export async function events(home: string): Promise<Ev[]> {
  const out: Ev[] = [];
  for (let after = 0; ;) {
    const page = (await controlCall(home, 'events.read', { after, limit: 1000 })).events as Ev[];
    if (!page?.length) return out;
    out.push(...page);
    after = Number(page[page.length - 1]!.log_pos);
  }
}
/** Polls the record until `done(events)` holds or `timeoutMs` passes; returns the last read either way. */
export async function eventsUntil(home: string, done: (all: Ev[]) => boolean, timeoutMs = 30_000): Promise<Ev[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const all = await events(home);
    if (done(all) || Date.now() > deadline) return all;
    await sleep(250);
  }
}
export const brief = (e: Ev) => `${e.kind}${e.verified === false ? ' (unverified)' : ''} ${JSON.stringify(e.data).slice(0, 300)}`;
/** The tool.before of the call `toolUse`, once recorded. */
export const beforeOf = (all: Ev[], s: Session, toolUse: string) => all.find((e) => e.kind === 'tool.before' && e.session === s.id && JSON.stringify(e.data).includes(toolUse));
export const matchedIn = (e: Ev | undefined, name: string) => Array.isArray(e?.data.matched) && (e!.data.matched as unknown[]).includes(name);

// ---- The calls the criteria name, and one representative call for each shipped fail_closed entry.
/** AC1's four calls: an Edit of the spec, a write of Claude Code's settings, `deep off`, and a delete of unknown reach. */
export function ac1Calls(w: World): Call[] {
  return [
    editOf(join(w.repo.dir, '.deepbuild/done.yaml'), 'Edit .deepbuild/done.yaml'),
    writeOf(join(w.home, '.claude/settings.json'), 'Write ~/.claude/settings.json'),
    bash('deep off'),
    bash('rm -rf "$X"/*'),
  ];
}
/** The entry whose `match` is `kill:hub`: its call needs the hub's real PID, so it is checked with the hub up only. */
export const isHubKill = (rules: Rules, name: string) => rules.entries[name]?.match === 'kill:hub';
/**
 * One call per shipped fail_closed entry, chosen from the base's matcher (crates/deep-hook/src/matcher.rs) and the
 * suites that prove each entry (#316, #317, #1156), that with the hub stopped the entry denies. Keyed by entry name;
 * an entry with none here fails AC4, never passes it.
 */
export function representatives(w: World): Record<string, Call> {
  const h = w.home;
  return {
    'no-kill-by-name': bash('pkill -f vite'),
    'no-workflow-dispatch': bash('gh workflow run deploy.yml'),
    'no-bare-stash': bash('git stash'),
    'no-git-other-checkout': bash(`git -C ${w.repo.other} status`),
    'no-agent-config-write': writeOf(join(h, '.claude/settings.json'), 'Write ~/.claude/settings.json'),
    'no-pi-config-write': writeOf(join(h, '.pi/agent/settings.json'), 'Write ~/.pi/agent/settings.json'),
    'no-deepbuild-spec-write': editOf(join(w.repo.dir, '.deepbuild/done.yaml'), 'Edit .deepbuild/done.yaml'),
    'no-deep-off': bash('deep off'),
    'no-deep-on': bash('deep on'),
    'no-deep-hub-stop': bash('deep hub stop'),
    'no-deep-hub-use': bash(`deep hub use --root ${join(w.tmp, 'dev')}`),
    'no-deep-setup-undo': bash('deep setup --undo'),
    'no-deep-restore': bash('deep restore ~/backup'),
    'no-hub-service-stop': bash('systemctl --user stop deepbuild-hub.service'),
    'no-hub-service-write': writeOf(join(h, '.config/systemd/user/deepbuild-hub.service'), 'Write ~/.config/systemd/user/deepbuild-hub.service'),
    'no-deepbuild-home-write': writeOf(join(h, '.deepbuild/rules.json'), 'Write ~/.deepbuild/rules.json'),
    'no-control-token-read': readOf(join(h, '.deepbuild/control.token'), 'Read ~/.deepbuild/control.token'),
    'no-unnamed-cloud-resource': bash("aws kms create-key --profile shop-new-account --description 'orders key'"),
    'no-unknown-reach-delete': bash('rm -rf "$X"/*'),
    'no-discarding-edits': bash('git reset --hard'),
    'no-dropping-stash': bash('git stash drop'),
    'no-unreadable-push': bash('"$(printf git)" push origin main'),
  };
}
/** `kill -9 <the hub's PID>`: the no-hub-kill entry's call, which only a running hub can be the target of. */
export const hubKill = (w: World): Call => bash(`kill -9 ${w.hub.pid}`);
/**
 * A PreToolUse sent to the hub at its own socket, no forwarder between (deep-hook reads the hub's PID off the peer of
 * the address it connects to): taken once deep-hook's output isn't its own hub-away denial; after `tries`, INCONCLUSIVE.
 */
export async function hubDecidesDirect(w: World, s: Session, call: Call, tries = 10): Promise<Ran> {
  setAddress(w.home, null);
  try {
    let last = '';
    for (let i = 0; i < tries; i++) {
      const ran = await hook(w.home, s, call.body(s));
      if (!outputText(ran).includes(HUB_AWAY_WORDS)) return ran;
      last = shown(ran);
      await sleep(100);
    }
    throw Error(`INCONCLUSIVE: in ${tries} tries deep-hook decided \`${call.label}\` alone, the hub not answering in time (${who(s)}): ${last}`);
  } finally {
    setAddress(w.home, w.fwd.path);
  }
}
/** The readings the hub keeps about a session's version: its session.reading events that name the version. */
export const versionReadings = (all: Ev[], s: Session) => all.filter((e) => e.kind === 'session.reading' && e.session === s.id && JSON.stringify(e.data).includes(s.version));
export const readingText = (e: Ev) => String(e.data?.reading ?? JSON.stringify(e.data));
