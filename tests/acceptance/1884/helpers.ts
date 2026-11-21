// Test-side tools for #1884: a copy of this checkout's built tree whose shipped Claude Code facts list only the
// test's versions (README: The test's facts), the real `deep doctor --json` and the real hub (`deep hub run`) run from
// that copy with HOME at a temporary home, a stand-in `claude` on PATH that prints a version (README: The stand-in),
// and one PreToolUse hook sent over the hub's socket as deep-hook sends it (README: The hook). No hub, CLI or adapter
// module is imported. Processes are stopped by PID only, never by name or port.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const NODE = process.execPath;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const parse = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
export const word = (prefix = 'w'): string => `${prefix}${randomBytes(5).toString('hex')}`;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function ulid(ms = Date.now()): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (const b of randomBytes(16)) tail += CROCKFORD[b % 32];
  return time + tail;
}

// ---- Temp folders (short: a socket path must fit in 104 bytes on macOS) and the processes this suite started.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dk1884-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
const own = (pid: number | undefined): void => { if (pid) owned.add(pid); };
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
/** Stops every process this suite started, by PID (SIGTERM, then SIGKILL after 3 s). */
export async function stopAll(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
}
/** stopAll, then removes the temp folders. */
export async function cleanup(): Promise<void> {
  await stopAll();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- The test's facts: the shipped Claude Code facts with `versions` set to the issue's two versions.
export const LISTED = ['1.0.0', '1.2.0'] as const;
export const BETWEEN = '1.1.0';
const SHIPPED_FACTS = join(REPO, 'adapters/claude-code.facts.json');
/**
 * The shipped facts with `versions` [1.0.0, 1.2.0], each given the strict payload schema (`events.versions`) of the
 * newest shipped version, which the hook this suite sends is shaped like; everything else unchanged.
 */
export function testFacts(): Line {
  const facts = JSON.parse(readFileSync(SHIPPED_FACTS, 'utf8')) as Line;
  const schemas = facts.events?.versions as Line | undefined;
  const newest = schemas ? Object.keys(schemas).at(-1) : undefined;
  if (!schemas || !newest) throw Error(`BLOCKED: ${SHIPPED_FACTS} has no events.versions to give the test's versions`);
  facts.versions = [...LISTED];
  facts.events.versions = Object.fromEntries(LISTED.map((v) => [v, structuredClone(schemas[newest])]));
  return facts;
}

/**
 * A copy of this checkout's runtime tree at <tmp>/c: package.json, adapters/, contracts/, packs/ and packages/
 * (built dist included, each package's test/ left out), a link to this checkout's target/ (its deep-hook), and a node_modules whose @deepbuild links point into the
 * copy's packages while every other dependency links to this checkout's. Its adapters/claude-code.facts.json is the
 * test's facts, so whatever in the copy reads the shipped facts (the doctor and the hub alike) reads them.
 */
export function factsCopy(): { root: string; cli: string; facts: Line } {
  const cli = join(REPO, 'packages/cli/dist/main.js');
  if (!existsSync(cli)) throw Error(`BLOCKED: ${cli} is missing; run npm run build --workspaces`);
  const root = join(tempDir(), 'c');
  mkdirSync(root);
  const skip = (src: string) => basename(src) !== 'node_modules' && !(basename(src) === 'test' && basename(dirname(dirname(src))) === 'packages');
  for (const part of ['package.json', 'adapters', 'contracts', 'packs', 'packages']) {
    if (existsSync(join(REPO, part))) cpSync(join(REPO, part), join(root, part), { recursive: true, filter: skip, verbatimSymlinks: true });
  }
  const modules = join(root, 'node_modules');
  mkdirSync(modules);
  for (const name of readdirSync(join(REPO, 'node_modules'))) {
    if (name !== '@deepbuild') { symlinkSync(join(REPO, 'node_modules', name), join(modules, name)); continue; }
    mkdirSync(join(modules, name));
    // Each is a relative link (../../packages/<name>), which inside the copy names the copy's package.
    for (const pkg of readdirSync(join(REPO, 'node_modules', name))) symlinkSync(readlinkSync(join(REPO, 'node_modules', name, pkg)), join(modules, name, pkg));
  }
  // The hub proves its guard entries through deep-hook at start, the one this checkout's cargo build made.
  if (existsSync(join(REPO, 'target'))) symlinkSync(join(REPO, 'target'), join(root, 'target'));
  const facts = testFacts();
  writeFileSync(join(root, 'adapters/claude-code.facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
  return { root, cli: join(root, 'packages/cli/dist/main.js'), facts };
}

const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** This environment with HOME moved to the test's home and none of the hub's settings or billing keys; `extra` on top. */
export function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key.startsWith('GIT_') || key.startsWith('TMUX') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), PATH: `${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, LC_ALL: 'C' }, extra);
  return env;
}

export interface Ran { code: number | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
function run(command: string, args: readonly string[], o: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 180_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, ms: performance.now() - t0, timedOut }); });
  });
}
export const shown = (r: Ran): string => `exit ${r.code}${r.timedOut ? ' (killed at the timeout)' : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;

/** A temp folder with a home in it, and a working folder for the session. */
export function makeHome(): { tmp: string; home: string; cwd: string } {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const cwd = join(tmp, 'w');
  mkdirSync(home);
  mkdirSync(cwd);
  return { tmp, home, cwd };
}

// ---- The stand-in `claude`: `claude --version` prints `<version> (Claude Code)`, as Claude Code prints it.
export function standIn(tmp: string, version: string): string {
  const bin = join(tmp, `bin-${version}`);
  mkdirSync(bin, { recursive: true });
  const file = join(bin, 'claude');
  writeFileSync(file, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${version} (Claude Code)"; exit 0; fi\nexit 1\n`);
  chmodSync(file, 0o755);
  return bin;
}

// ---- deep doctor (`deep doctor --json`: one item per line).
export interface DoctorItem { item: string; agent: string; code: string; level: string; evidence: string; fix: string }
/** `deep doctor --json` from the copy, HOME `home`, the stand-in for `version` first on PATH, no managed settings. */
export async function doctor(cli: string, home: string, tmp: string, version: string): Promise<{ items: DoctorItem[]; ran: Ran }> {
  const env = childEnv(home, { PATH: `${standIn(tmp, version)}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, DEEP_HUB_TEST_MANAGED_SETTINGS: join(tmp, 'no-managed-settings.json') });
  const ran = await run(NODE, [cli, 'doctor', '--json'], { env, cwd: tmp });
  const items = ran.stdout.split('\n').map((l) => parse(l)).filter((x): x is Line => x !== undefined && typeof x.item === 'string') as DoctorItem[];
  return { items, ran };
}
export const listed = (items: readonly DoctorItem[]): string => items.map((i) => `${i.item} ${i.level} (${i.code}): ${i.evidence}`).join(' | ') || 'none';

// ---- rules.json: one guard entry in block mode, not fail_closed, that the session's Bash call matches.
export function writeRules(home: string, name: string, command: string): void {
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  const entries = { [name]: { match: `shell:${command}`, scope: 'all_repos', mode: 'block', reason: 'Guarded in this test.', next_step: 'Leave it.', fail_closed: false } };
  writeFileSync(join(home, '.deepbuild', 'rules.json'), `${JSON.stringify({ v: 1, entries }, null, 2)}\n`);
}

// ---- The hub: `deep hub run` from the copy, HOME at the test's home, so its root is <home>/.deepbuild.
export interface Hub { pid: number; socket: string; child: ChildProcess; output(): string }
export async function startHub(cli: string, home: string, cwd: string): Promise<Hub> {
  // The copy's target/ is this checkout's (factsCopy).
  const target = join(cli, '../../../../target');
  if (!['release', 'debug'].some((p) => existsSync(join(target, p, 'deep-hook')))) throw Error(`BLOCKED: the hub proves its guard entries through deep-hook, and none is built under ${join(REPO, 'target')}; run cargo build --locked -p deep-hook`);
  const child = spawn(NODE, [cli, 'hub', 'run'], { cwd, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 180_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(parse(first.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start from the copy: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, socket: join(home, '.deepbuild', 'hub.sock'), child, output: () => out };
}

// ---- A Claude Code session: a transcript where Claude Code keeps it, every entry stamped with the session's version.
export interface Session { id: string; cwd: string; transcript: string; version: string; parent: string | null }
export function newSession(home: string, cwd: string, version: string): Session {
  const id = randomUUID();
  const transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript, version, parent: null };
}
function entry(s: Session, fields: Line): void {
  const uuid = randomUUID();
  appendFileSync(s.transcript, `${JSON.stringify({ parentUuid: s.parent, isSidechain: false, ...fields, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: s.cwd, sessionId: s.id, version: s.version, gitBranch: 'main' })}\n`);
  s.parent = uuid;
}

/** The hub's answer to one hook: every line it wrote on the connection, and its reply (the line with `exit`). */
export interface HookAnswer { lines: Line[]; reply: Line | undefined }
/**
 * One PreToolUse of a Bash call running `command`, as deep-hook sends it (hook.request@3 on the hub's socket, after
 * the hub's hello), with `matched` naming the guard entry deep-hook matched. The prompt and the call are first
 * written to the transcript, as Claude Code writes them before it fires the hook.
 */
export async function preToolUse(hub: Hub, s: Session, command: string, matched: string): Promise<HookAnswer> {
  const promptId = randomUUID();
  entry(s, { promptId, type: 'user', message: { role: 'user', content: 'Run the command.' }, permissionMode: 'default', origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  const call = `toolu_${randomBytes(12).toString('hex')}`;
  const input = { command, description: 'Run the command' };
  entry(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: call, name: 'Bash', input }], stop_reason: 'tool_use', usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 } } });
  const payload = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, permission_mode: 'default', hook_event_name: 'PreToolUse', prompt_id: promptId, tool_name: 'Bash', tool_input: input, tool_use_id: call };
  const request = { v: 1, agent: 'claude-code', event: 'PreToolUse', seq: `${BigInt(Date.now()) * 1_000_000n}`, id: ulid(), pid: process.pid, ppid: process.ppid, matched: [matched], payload };
  const sock = net.connect(hub.socket);
  const lines: Line[] = [];
  let buffer = '';
  return new Promise<HookAnswer>((resolve) => {
    const done = () => { sock.destroy(); resolve({ lines, reply: lines.find((l) => 'exit' in l) }); };
    const timer = setTimeout(done, 60_000);
    sock.setEncoding('utf8');
    sock.on('error', () => { clearTimeout(timer); done(); });
    sock.on('close', () => { clearTimeout(timer); done(); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parse(buffer.slice(0, i)) ?? { unparsed: buffer.slice(0, i) };
        buffer = buffer.slice(i + 1);
        lines.push(line);
        if (lines.length === 1) sock.write(`${JSON.stringify(request)}\n`);
        else if ('exit' in line || 'error' in line) { clearTimeout(timer); done(); }
      }
    });
  });
}
/** What the reply tells Claude Code about the call: exit 2, or a deny or block decision, blocks it. */
export function blocked(a: HookAnswer): boolean {
  const out = parse(String(a.reply?.stdout ?? '').trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  return a.reply?.exit === 2 || said === 'deny' || said === 'block';
}
export const answered = (a: HookAnswer): string => JSON.stringify(a.lines).slice(0, 1500);
