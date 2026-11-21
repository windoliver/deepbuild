// What #2648's acceptance tests share (README): a hub on a temp home set up as `deep setup` sets one up, with Claude
// Code's stand-in on the login shell's PATH and, where a criterion asks for it, 30 days of history; the record read
// back through `events.read`; `deep` commands as a person runs them. Every process a test starts is stopped by its PID.
// The socket's line protocol is #16's (`Conn`, `openAs`), imported unchanged.
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRecord, ulid } from '../../../packages/record/src/index.ts';
import { Conn, openAs, result, tokenOf, type Line } from '../16/helpers.ts';

export { ulid, type Line };

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const NODE = process.execPath;
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const DAY = 86_400_000;
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Each criterion's ID, as `scripts/proof-change.mjs` computes it from the issue's checkbox text. */
export const AC1 = '#2648.db254030';
export const AC2 = '#2648.d3c34df7';
export const AC3 = '#2648.c3b6fe41';
export const AC4 = '#2648.26092d61';
export const AC5 = '#2648.ccff16b0';

// ---- Processes this suite started: stopped by their PID only, never by name or port, and only while Node still holds
// them running, so a PID the system has since given to another process is never signalled.
const owned = new Set<ChildProcess>();
export function own(child: ChildProcess): void {
  owned.add(child);
  child.once('exit', () => owned.delete(child));
}
export const running = (child: ChildProcess): boolean => child.exitCode === null && child.signalCode === null;
/** SIGTERM, then SIGKILL after `waitMs`. */
async function stop(child: ChildProcess, waitMs = 20_000): Promise<void> {
  if (!running(child)) return;
  const exited = new Promise<boolean>((resolve) => child.once('exit', () => resolve(true)));
  child.kill('SIGTERM');
  if (await Promise.race([exited, sleep(waitMs).then(() => false)])) return;
  child.kill('SIGKILL');
  await Promise.race([exited, sleep(5000)]);
}

// ---- Temp folders: short paths under /tmp, since a socket's path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(prefix = 'dh2648-'): string {
  const dir = realpathSync(mkdtempSync(join('/tmp', prefix)));
  made.push(dir);
  return dir;
}
/** Stops every process this file started, then removes its temp folders. */
export async function cleanup(): Promise<void> {
  await Promise.all([...owned].map((child) => stop(child, 5000)));
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- The world: a home, Claude Code's stand-in and a login shell that keeps PATH, and the OS confirmation's stub.
/** Claude Code, as a stand-in: a version its facts cover and a sign-in. No model is called. */
const STAND_INS: Record<string, string> = {
  claude: '#!/bin/sh\ncase "$1" in\n  --version|-v) echo "2.1.308 (Claude Code)" ;;\n  auth) echo \'{"loggedIn": true, "authMethod": "claude.ai"}\' ;;\nesac\nexit 0\n',
  'login-shell': '#!/bin/sh\n[ "$1" = "-l" ] && shift\nexec /bin/sh "$@"\n',
  launchctl: '#!/bin/sh\nexit 0\n',
};
export interface World {
  /** The folder the home sits in, removed with the file's other folders. */
  tmp: string;
  home: string;
  /** The hub's folder, `<home>/.deepbuild`. */
  root: string;
  /** The stand-ins' folder, first on the hub's PATH and on the login PATH setup records. */
  bin: string;
  /** The file that stands for the OS confirming you (DEEP_HUB_TEST_CONFIRM). */
  confirm: string;
  /** Claude Code's managed settings as the hub reads them (DEEP_HUB_TEST_MANAGED_SETTINGS): none is there. */
  managed: string;
}
export function makeWorld(): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(bin);
  for (const [name, text] of Object.entries(STAND_INS)) {
    writeFileSync(join(bin, name), text);
    chmodSync(join(bin, name), 0o755);
  }
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  return { tmp, home, root: join(home, '.deepbuild'), bin, confirm, managed: join(tmp, 'managed-settings.json') };
}
/**
 * The world's home copied whole into a new folder, a clone on APFS (`cp -Rc`): the same history and setup for another
 * hub. The stand-ins, the confirmation and the login PATH setup recorded stay the template's.
 */
export async function copyWorld(w: World): Promise<World> {
  const tmp = tempDir();
  const ran = await run('/bin/cp', ['-Rc', w.home, join(tmp, 'h')]);
  if (ran.code !== 0) throw Error(`BLOCKED: the template home could not be copied: ${ran.stderr}`);
  return { ...w, tmp, home: join(tmp, 'h'), root: join(tmp, 'h', '.deepbuild') };
}

/** The environment a hub or a `deep` command gets in the world: no agent session's variables, no DEEP_ settings of ours. */
export function envOf(w: World, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(CLAUDE|CODEX|ANTHROPIC|OPENAI|GIT_|AI_AGENT|CURSOR|GROK|DEEP_|DH2648_|XDG_)/.test(key) || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: w.home, XDG_CONFIG_HOME: join(w.home, '.config'), XDG_CACHE_HOME: join(w.home, '.cache'), LC_ALL: 'C', NODE,
    PATH: `${w.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: join(w.bin, 'login-shell'),
    DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_MANAGED_SETTINGS: w.managed,
  });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

interface Ran { code: number | null; stdout: string; stderr: string }
/** A command run to its end without blocking this process's event loop. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 120_000);
    child.on('error', (error) => { stderr += String(error); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
/** git's environment: none of this process's GIT_ variables, so it reads this worktree alone. */
export const gitEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
/** The commit this checkout's change is judged against: `git merge-base HEAD origin/main`. */
export async function mergeBaseCommit(): Promise<string> {
  const base = await run('git', ['merge-base', 'HEAD', 'origin/main'], { env: gitEnv(), cwd: REPO });
  const commit = base.stdout.trim();
  if (base.code !== 0 || !/^[0-9a-f]{40}$/.test(commit)) throw Error(`BLOCKED: no merge base of HEAD and origin/main: ${base.stderr}`);
  return commit;
}
/** `deep <args>` from a checkout's built CLI, in the world, as a person runs it. */
export function deep(w: World, args: readonly string[], o: { env?: Record<string, string | undefined>; cwd?: string; timeoutMs?: number; checkout?: string } = {}): Promise<Ran> {
  const checkout = o.checkout ?? REPO;
  return run(NODE, [join(checkout, 'packages/cli/dist/main.js'), ...args], { env: envOf(w, o.env), cwd: o.cwd ?? w.tmp, timeoutMs: o.timeoutMs ?? 120_000 });
}

// ---- The hub: `deep hub run` from a checkout's built CLI, in a process group of its own, stopped by its PID.
export interface Hub { pid: number; socket: string; world: World; child: ChildProcess; stderr(): string }
/** A hub stops at its start without the deep-hook its checkout built, and the hourly cleanup can take it: BLOCKED then. */
function needDeepHook(checkout = REPO): void {
  const hook = join(checkout, 'target/debug/deep-hook');
  if (!existsSync(hook)) throw Error(`BLOCKED: ${hook} is not built; run cargo build -p deep-hook --locked in ${checkout} first`);
}
export async function startHub(w: World, o: { checkout?: string; plant?: string; env?: Record<string, string | undefined> } = {}): Promise<Hub> {
  const checkout = o.checkout ?? REPO;
  needDeepHook(checkout);
  const child = spawn(NODE, [join(checkout, 'packages/cli/dist/main.js'), 'hub', 'run'], {
    cwd: checkout, env: envOf(w, { DEEP_HUB_PLANT: o.plant, ...o.env }), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  own(child);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (!out.includes('\n')) return;
      try { resolve(JSON.parse(out.split('\n')[0]!) as Line); } catch { resolve(undefined); }
    })),
    exited.then(() => undefined),
    sleep(180_000).then(() => undefined),
  ]);
  if (ready?.ready !== true) {
    await stop(child, 5000);
    throw Error(`BLOCKED: the hub${o.plant ? ` with DEEP_HUB_PLANT=${o.plant}` : ''} from ${checkout} did not start: ${err.slice(-1500)}`);
  }
  if (Number(ready.pid) !== child.pid) throw Error(`BLOCKED: the hub's ready line names process ${String(ready.pid)}, not the one started, ${child.pid}`);
  return { pid: child.pid!, socket: String(ready.socket), world: w, child, stderr: () => err };
}
export const stopHub = (hub: Hub): Promise<void> => stop(hub.child);

/**
 * A home set up as a person sets one up: Claude Code's stand-in on the PATH, a hub, `deep setup` (Claude Code's hook
 * entries in its settings, the login PATH recorded), then the hub stopped. With `days`, that much history first, as #16's
 * budget seeds it. The files the gates timer and the extension host's tick read are there, as the hub and the host write
 * them: gates.json after a `deep on`, and the host's notices.json.
 */
export async function setUpWorld(days = 0): Promise<World> {
  const w = makeWorld();
  if (days) await seedHistory(w.root, days);
  const hub = await startHub(w);
  try {
    const set = await deep(w, ['setup'], { timeoutMs: 600_000 });
    if (set.code !== 0) throw Error(`BLOCKED: deep setup must exit 0 in the test home: exit ${set.code}: ${set.stdout.slice(-800)} ${set.stderr.slice(-1500)}`);
  } finally {
    await stopHub(hub);
  }
  writeFileSync(join(w.root, 'gates.json'), `${JSON.stringify({ off: false, since: Date.now() })}\n`, { mode: 0o600 });
  mkdirSync(join(w.root, 'extensions'), { recursive: true });
  writeFileSync(join(w.root, 'extensions', 'notices.json'), '{}');
  return w;
}

/**
 * Heavy use over `days` in the hub's ledger, through the record (#14), as #16's budget seeds it: 20 sessions a day of
 * ten turns, each turn a prompt, 13 shell calls and a stop, about 3,000 events a day. The newest is over a day old, so
 * no session of it is live: the hub has no session.
 */
async function seedHistory(root: string, days: number): Promise<void> {
  mkdirSync(root, { recursive: true });
  const end = Date.now() - DAY;
  let now = end - days * DAY;
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => now });
  const conn = (session: string) => ({ writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' });
  let n = 0;
  const seq = (ms: number) => (BigInt(ms) * 1_000_000n + BigInt(++n % 1_000_000)).toString();
  try {
    for (let d = 0; d < days; d++) {
      const dayStart = end - (days - d) * DAY;
      for (let s = 0; s < 20; s++) {
        const session = ulid(dayStart);
        let at = dayStart + s * 600_000;
        now = at;
        const pending: Promise<unknown>[] = [record.append(conn(session), { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: '~/src/shop', branch: 'main', thread: session } })];
        for (let turn = 0; turn < 10; turn++) {
          at += 1000;
          pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind: 'user.ask', ts: at, seq: seq(at), data: { msg: turn, text: 'run the tests and fix what fails', tasks: [], from: 'person' } }));
          for (let k = 0; k < 13; k++) {
            at += 1000;
            pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind: k % 2 === 0 ? 'tool.before' : 'tool.after', ts: at, seq: seq(at), data: { kind: 'shell', paths: [], command: `npm test -- src/${k}.test.ts` } }));
          }
          at += 1000;
          pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind: 'agent.stop', subject: `session:${session}`, ts: at, seq: seq(at), data: { turn: turn + 1, did_work: true } }));
        }
        await Promise.all(pending);
      }
    }
  } finally {
    await record.close();
  }
}

// ---- The record, through the hub's socket.
/** A connection as the app or the CLI, with the hub's control token. */
export const control = (hub: Hub, role: 'app' | 'cli' = 'cli'): Promise<Conn> => openAs(hub.socket, role, tokenOf(hub.world.root));
export interface Ev { id: string; kind: string; log_pos: number; ts: number; subject?: string; session?: string; data: Line }
/** The events after `after`, of `kinds`, paged by log position through `events.read`. */
export async function eventsAfter(conn: Conn, after: number, kinds: readonly string[]): Promise<Ev[]> {
  const out: Ev[] = [];
  for (;;) {
    const page = result(await conn.call('events.read', { after, limit: 1000, kinds }, 30_000));
    const events = page.events as Ev[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos;
  }
}
/** The log's last position now. */
export async function logEnd(conn: Conn): Promise<number> {
  let after = 0;
  for (;;) {
    const page = result(await conn.call('events.read', { after, limit: 10_000 }, 30_000));
    const events = page.events as Ev[];
    if (!events.length) return after;
    after = events[events.length - 1]!.log_pos;
  }
}

export const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
