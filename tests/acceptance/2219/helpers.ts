// Test-side tools for issue #2219's acceptance tests (an entry deep-hook can't read stops only what its mode would):
// temp homes under /tmp holding the first-party entries as rules.json, the real hub as a process (`deep hub run`),
// the real deep-hook run as Claude Code's hook entry runs it, and the record read back through the hub's socket.
// `tempDir`, `cleanup`, `childEnv`, `run`, `shown`, `buildDeepHook`, `makeHome`, `hook`, `decision`, `words`,
// `startHub`, `stopHub`, `control` and `allEvents` are copied from tests/acceptance/2204/helpers.ts at base 74e6e2634
// (same repo, same license), with this issue's temp prefix, IDs and entries; this suite keeps its own copy so a
// redraft there never moves these tests. `answered` reads more than 2204's does (README, Readings). Nothing here
// stands in for deep-hook or the hub, and nothing here asserts a criterion: a setup that can't be made throws a plain
// BLOCKED or INCONCLUSIVE error, never an assertion; the criteria's assertions are the tests' own `expect`s.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
/** The first-party entries: what setup installs as the first rules.json (packages/hub/src/setup.ts, installRules). */
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');

/** Each criterion's ID: `#2219.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC1 = '#2219.2d7325d2';
export const AC2 = '#2219.091a3d84';
export const AC3 = '#2219.1b85eb34';
export const AC4 = '#2219.9b9e651b';

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

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh2219-'));
  made.push(dir);
  return dir;
}

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
function alive(pid: number): boolean {
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
/** Stops every process this suite started that still runs (SIGTERM, then SIGKILL after 3 s) and removes temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** A child's environment: this one with HOME the test's and no DEEP_, GIT_, XDG_, CLAUDE, CODEX or RUST_ settings or billing keys. */
export function childEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(?:DEEP_|XDG_|GIT_|CLAUDE|CODEX|RUST_)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.PATH = `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  env.LC_ALL = 'C';
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
/** Runs a command to its end, with stdin `input`, killing it (by its PID) at `timeoutMs`. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs);
    const done = (code: number | null, signal: NodeJS.Signals | null, extra = '') => {
      clearTimeout(timer);
      if (child.pid) owned.delete(child.pid);
      resolve({ code, signal, stdout, stderr: stderr + extra, ms: performance.now() - t0, timedOut });
    };
    child.on('error', (error) => done(null, null, error.message));
    child.on('close', (code, signal) => done(code, signal));
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 900))}`;

/** This checkout's deep-hook, built plain into target/debug (a no-op when it is fresh). */
export async function buildDeepHook(): Promise<void> {
  const args = ['build', '--locked', '-q', '-p', 'deep-hook'];
  const r = await run('nice', ['-n', '10', 'cargo', ...args], { timeoutMs: 1_800_000 });
  if (r.timedOut) throw Error(`INCONCLUSIVE: cargo ${args.join(' ')} was killed at the timeout`);
  if (r.code !== 0 || !existsSync(DEEP_HOOK)) throw Error(`BLOCKED: deep-hook did not build: cargo ${args.join(' ')} exited ${r.code}: ${r.stderr.slice(-1500)}`);
  if (!existsSync(CLI)) throw Error(`BLOCKED: no ${CLI}: run \`npm run build --workspaces\` first`);
}

// ---- A home after setup, and its rules.json.
export interface Home { home: string; root: string; rules: string; work: string }
/** The first-party entries file as shipped. */
export const shippedText = () => readFileSync(DEFAULT_RULES, 'utf8');
/**
 * A fresh home as setup leaves the parts these tests reach: <home>/.deepbuild (0700) holding the shipped
 * default-rules.json verbatim as rules.json and a setup-finished.json shaped as setup writes it, and a work folder.
 * No agent config, login service or hub: `deep setup` itself is never run (README, Readings).
 */
export function makeHome(): Home {
  const home = join(tempDir(), 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const rules = join(root, 'rules.json');
  writeFileSync(rules, shippedText(), { mode: 0o600 });
  const version = String((JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as Line).version);
  writeFileSync(join(root, 'setup-finished.json'), `${JSON.stringify({ version, at: new Date().toISOString() })}\n`, { mode: 0o600 });
  const work = join(home, 'w');
  mkdirSync(work);
  return { home, root, rules, work };
}

// ---- The entries these tests add. Their names, reasons and next steps hold no "older", "newer" or "rules.json",
// so only deep-hook's or the hub's own words can say those.
/** AC1's and AC2's entry, whose `match` is `effect:not-a-class`. */
export const CLASS_ENTRY = 'class-probe-2219';
/** AC3's entry, with a seventh field `until` and a `match` deep-hook knows. */
export const UNTIL_ENTRY = 'until-probe-2219';
/** AC4's entry, whose `mode` is `stop`. */
export const STOP_ENTRY = 'stop-probe-2219';
/** A guard@1 entry: the six fields, with the given match, mode and fail_closed, plus any `more` fields. */
export const entry = (match: string, mode: string, failClosed: boolean, more: Line = {}): Line => ({
  match, scope: 'all_repos', mode, reason: 'Held by a test entry.', next_step: 'Leave it; it is a test.', fail_closed: failClosed, ...more,
});
/**
 * The readable rules.json gains one entry, as a newer hub's install would write it: the file read, the entry added
 * to its `entries`, and the whole written beside it and renamed over it, so no reader meets it half written.
 */
export function gain(h: Home, name: string, value: Line): void {
  const file = JSON.parse(readFileSync(h.rules, 'utf8')) as { entries: Record<string, Line> };
  file.entries[name] = value;
  const next = `${h.rules}.next`;
  writeFileSync(next, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  renameSync(next, h.rules);
}

// ---- Hooks, shaped like Claude Code's payloads for a Bash call.
const session = randomUUID();
/** deep-hook as a hook entry runs it: `deep-hook claude-code PreToolUse`, the payload on stdin, HOME the agent's. `call` is its tool_use_id. */
export async function hook(h: Home, command: string): Promise<Ran & { call: string }> {
  const call = `toolu_${randomBytes(12).toString('hex')}`;
  const body: Line = { session_id: session, transcript_path: join(h.home, 't.jsonl'), cwd: h.work, hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: 'Bash', tool_input: { command }, tool_use_id: call };
  const r = await run(DEEP_HOOK, ['claude-code', 'PreToolUse'], { cwd: h.work, env: childEnv(h.home), input: JSON.stringify(body), timeoutMs: 60_000 });
  if (r.timedOut) throw Error(`INCONCLUSIVE: the PreToolUse hook for \`${command}\` was killed at 60 s (the machine may be loaded): ${shown(r)}`);
  return { ...r, call };
}
/** What deep-hook's output tells Claude Code about a PreToolUse: exit 2 or a deny decision denies; exit 0 with neither allows. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said: unknown = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
/** Everything the hook printed: where a denial's words are, whichever stream carries them. */
export const words = (r: Ran) => `${r.stdout}\n${r.stderr}`;
/**
 * "That deep-hook is older than it", loosely: the issue states the fact, not the wording. "older" as a word (this
 * deep-hook is older than the entry), or the entry newer than deep-hook ("newer than this deep-hook", "needs a newer
 * deep-hook").
 */
export const OLDER = /\bolder\b|\bnewer than (?:this |the )?deep-hook\b|\bnewer deep-hook\b/i;

// ---- The hub as a process.
export interface Hub { home: string; socket: string; pid: number; proc: ChildProcess; stderr(): string; exit: Promise<void> }
/** Starts `deep hub run` on the home's root and waits for its ready line. */
export async function startHub(h: Home, timeoutMs = 180_000): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(h.home), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!));
      });
    }),
    exit.then(() => undefined),
    sleep(timeoutMs).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub did not start within ${timeoutMs} ms: ${err.slice(-1500)}`);
  return { home: h.home, socket: String(ready.socket), pid: Number(ready.pid), proc: child, stderr: () => err, exit };
}
/** Stops a hub this suite started, by its PID: SIGTERM, then SIGKILL after 15 s. */
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 15_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  await hub.exit;
  owned.delete(hub.pid);
}

// ---- The record, read back through the hub's socket as the CLI reads it (the cli role, with the control token).
function control(hub: Hub, method: string, params: Line, timeoutMs = 30_000): Promise<Line> {
  const token = readFileSync(join(hub.home, '.deepbuild', 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`INCONCLUSIVE: no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(Error(`BLOCKED: the hub's socket: ${error.message}`)); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = parseObject(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (step === 0) {
          step = 1;
          sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
        } else if (step === 1 && line?.role !== undefined) {
          step = 2;
          sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`);
        } else if (step === 2 && line?.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          if (line.error) reject(Error(`BLOCKED: ${method} refused: ${JSON.stringify(line.error)}`));
          else resolve(line.result as Line);
        }
      }
    });
  });
}
export interface Ev { id: string; kind: string; log_pos: number; data: Line }
/** Every event the record holds, in log order (`events.read`). */
export async function allEvents(hub: Hub): Promise<Ev[]> {
  const out: Ev[] = [];
  let after = 0;
  for (;;) {
    const events = (await control(hub, 'events.read', { after, limit: 1000 })).events as Ev[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos;
  }
}

/** Every line deep-hook spooled that the hub hasn't replayed yet: spool.jsonl and the files the hub moves aside to replay. */
function spooled(h: Home): string {
  const dir = join(h.root, 'spool');
  if (!existsSync(dir)) return '';
  let text = '';
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) {
    try { text += readFileSync(join(dir, name), 'utf8'); } catch { /* moved or removed meanwhile */ }
  }
  return text;
}
/**
 * Whether deep-hook decided this PreToolUse on the hub's reply, which is the only reading of "with the hub up"; if
 * not, why. deep-hook spools a request only when it decides without the hub's reply (the hub away, or late past the
 * 20 ms it has to acknowledge), and the hub records a call it answered as a tool.before unmarked `late`
 * (tool.before@4). So a try is the hub's when deep-hook said nothing of spooling it, no spool file holds it, the
 * record holds its tool.before unmarked, and no reading names that event as let through late (the hub writes one
 * when its own copy is in the record but deep-hook gave up on its acknowledgement and spooled a late copy). Waits up
 * to 30 s for the tool.before.
 */
export async function answered(h: Home, hub: Hub, r: Ran & { call: string }): Promise<{ yes: boolean; why: string }> {
  if (/deep-hook: (?:could not spool|spooled)/.test(r.stderr)) return { yes: false, why: 'deep-hook said it spooled the call' };
  if (spooled(h).includes(r.call)) return { yes: false, why: 'the spool holds the call' };
  let events: Ev[] = [];
  let before: Ev | undefined;
  for (const deadline = Date.now() + 30_000; ;) {
    events = await allEvents(hub);
    before = events.find((e) => e.kind === 'tool.before' && e.data.call === r.call);
    if (before || Date.now() > deadline) break;
    await sleep(200);
  }
  if (!before) return { yes: false, why: 'the record held no tool.before for the call within 30 s' };
  if (before.data.late === true) return { yes: false, why: 'its tool.before is marked late' };
  const id = before.id;
  if (events.some((e) => e.kind === 'session.reading' && String(e.data.reading).includes(id) && /\blate\b/.test(String(e.data.reading)))) return { yes: false, why: 'a reading says deep-hook let it through as late' };
  return { yes: true, why: 'the hub answered it' };
}
