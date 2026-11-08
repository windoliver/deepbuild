// The Linux platform the Linux twins of #668's and #669's live checkpoints run on (#70; README): the hub as a systemd
// user service of a user manager the test starts for itself, the session bus that manager's dbus.socket gives, the
// Secret Service on that bus (gnome-keyring-daemon, its keyring unlocked with a password made for the run and never
// written down), polkit's password prompt stood in for at the hub's confirmation seam, and bubblewrap's prerequisites
// with a watch that reads whether a check's processes ran inside it. Nothing here starts, stops or installs a unit
// in the person's own user manager: the one call that reaches it is `systemd-run --user --scope`, which puts the test's
// manager in a transient scope of its own with its cgroup delegated. Every process this starts is stopped by PID.
// #669's Linux twin imports this file; it imports nothing from either suite.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { release, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
/** The unit `deep setup` installs on Linux (packages/hub/src/service.ts), and where it writes it under the test's home. */
export const UNIT = 'deepbuild-hub.service';
export const unitFile = (home: string) => join(home, '.config', 'systemd', 'user', UNIT);
/** The target the test's user manager starts instead of default.target: the session bus and nothing of the distribution's. */
const TARGET = 'dh-login.target';
/** bubblewrap where the supervisor's Linux backend runs it, and the helper that puts Landlock and seccomp on each run (packages/supervisor/src/bubblewrap.ts). */
export const BWRAP = '/usr/bin/bwrap';
export const SANDBOX_HELPER = join(REPO, 'packages/supervisor/dist/helper');
const LANDLOCK_ABI = 4;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(probe: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return true;
    if (Date.now() > deadline) return false;
    await sleep(200);
  }
}

/** Every Linux test's first line: on any other platform it fails BLOCKED, naming the platform. */
export function requireLinux(id: string): void {
  if (process.platform !== 'linux') throw Error(`BLOCKED: ${id} is the Linux twin of its checkpoint (#70) and runs only on Linux, through a systemd user service, the Secret Service, polkit and bubblewrap; this machine is ${process.platform}`);
}

/**
 * A failure a sibling suite's helper threw as "<ID> BLOCKED: …" (or INCONCLUSIVE, INVALID), restated with its state
 * first, as scripts/lanes.mjs reads a state: only a message that starts with one keeps it.
 */
export function restated(error: unknown): Error {
  const e = error instanceof Error ? error : Error(String(error));
  const m = /^(#\d+(?:\.[0-9a-f]{8})?) (BLOCKED|INCONCLUSIVE|INVALID):?\s*/.exec(e.message);
  return m ? Error(`${m[2]}: ${m[1]} ${e.message.slice(m[0].length)}`) : e;
}

// ---- Processes. Stopped by PID only, never by name or port.
export function alive(pid: number): boolean {
  if (!(pid > 0)) return false;
  try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EPERM') return false; }
  try { return !/^\d+ \(.*\) Z/s.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return false; }
}
export interface Out { command: string; code: number | null; stdout: string; stderr: string }
export function exec(file: string, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs = 30_000): Promise<Out> {
  return new Promise((resolve) => {
    const command = [file, ...args].join(' ');
    let child: ChildProcess;
    try {
      child = spawn(file, args, { env, cwd: '/', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ command, code: null, stdout: '', stderr: (error as Error).message });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); resolve({ command, code: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ command, code, stdout, stderr }); });
  });
}
export const outText = (o: Out) => `$ ${o.command}\n${o.stdout}${o.stderr}(exit ${o.code})\n`;

// ---- What the machine needs (README: Assumed surfaces). Anything missing fails BLOCKED, naming it.
interface Tools { systemdRun: string; systemd: string; systemctl: string; busctl: string; keyring: string; env: string }
function which(name: string): string | undefined {
  for (const dir of [...(process.env.PATH ?? '').split(':'), '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']) {
    if (!dir) continue;
    try { accessSync(join(dir, name), constants.X_OK); return join(dir, name); } catch { /* not here */ }
  }
  return undefined;
}
function tools(id: string): Tools {
  const missing: string[] = [];
  const need = (what: string, found: string | undefined): string => { if (!found) missing.push(what); return found ?? ''; };
  const t: Tools = {
    systemdRun: need('systemd-run (systemd), which gives the test its own user manager in a delegated scope', which('systemd-run')),
    systemd: need('the systemd binary (/usr/lib/systemd/systemd or /lib/systemd/systemd), run as the test\'s own user manager', ['/usr/lib/systemd/systemd', '/lib/systemd/systemd'].find((f) => existsSync(f))),
    systemctl: need('systemctl (systemd)', which('systemctl')),
    busctl: need('busctl (systemd), which reads who owns a name on the session bus', which('busctl')),
    keyring: need('gnome-keyring-daemon, the Secret Service provider (package gnome-keyring)', which('gnome-keyring-daemon')),
    env: need('env (coreutils)', ['/usr/bin/env', '/bin/env'].find((f) => existsSync(f))),
  };
  need('script (util-linux), the agent harness\'s pseudo-terminal on Linux', which('script'));
  if (!existsSync('/sys/fs/cgroup/cgroup.controllers')) missing.push('the unified cgroup hierarchy (cgroup v2) a delegated user manager runs on');
  if (!process.env.XDG_RUNTIME_DIR || !existsSync(join(process.env.XDG_RUNTIME_DIR, 'systemd', 'private'))) missing.push('a user manager of your own for `systemd-run --user --scope` to make the test\'s scope in (XDG_RUNTIME_DIR with systemd/private; log in, or `loginctl enable-linger`)');
  need(`bubblewrap at ${BWRAP}, the platform sandbox's Linux backend (package bubblewrap)`, existsSync(BWRAP) ? BWRAP : undefined);
  if (!existsSync(SANDBOX_HELPER)) missing.push(`the supervisor's sandbox helper at ${SANDBOX_HELPER} (npm run build --workspaces)`);
  else {
    let abi = 0;
    try { abi = Number(spawnText(SANDBOX_HELPER, ['landlock']).trim()) || 0; } catch { abi = 0; }
    if (abi < LANDLOCK_ABI) missing.push(`Landlock ABI ${LANDLOCK_ABI} (Linux 6.7 or later), which the bubblewrap backend's file rules need: this kernel (${release()}) gives ${abi}`);
  }
  if (missing.length) throw Error(`BLOCKED: ${id} needs, on this Linux machine: ${missing.join('; ')}`);
  return t;
}
/** A one-off reading before any world runs, so a blocking call is fine here. */
const spawnText = (file: string, args: string[]): string => execFileSync(file, args, { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] });

// ---- The test's own login: a user manager, its session bus, the Secret Service and polkit's stand-in.
export interface LinuxWorld {
  id: string; home: string; tools: Tools;
  /** XDG_RUNTIME_DIR of the test's login (mode 0700); its user manager's private socket and its session bus live here. */
  run: string; bus: string;
  /** The test's user manager (systemd --user) and the cgroup of the scope that holds it; gnome-keyring-daemon. */
  manager: number; scope: string; keyring: number;
  /** polkit's prompt as the hub runs it: the words of every ask it was shown, one a line. */
  asks: string;
  /** Added to every process the test starts: XDG_RUNTIME_DIR, DBUS_SESSION_BUS_ADDRESS and XDG_DATA_HOME of the test's login. */
  env: Record<string, string>;
  /** The user manager's and the keyring's own output. */
  log: string;
}
const worlds: LinuxWorld[] = [];
const ctlEnv = (w: LinuxWorld): NodeJS.ProcessEnv => ({ PATH: '/usr/bin:/bin', HOME: w.home, LANG: 'C.UTF-8', XDG_RUNTIME_DIR: w.run, DBUS_SESSION_BUS_ADDRESS: w.bus, SYSTEMD_PAGER: '', SYSTEMD_COLORS: '0' });
/** `systemctl --user …` against the test's user manager, never the person's: its XDG_RUNTIME_DIR and session bus are the test's. */
export const systemctl = (w: LinuxWorld, args: readonly string[]) => exec(w.tools.systemctl, ['--user', ...args], ctlEnv(w));
const tail = (file: string) => { try { return JSON.stringify(readFileSync(file, 'utf8').slice(-2000)); } catch { return '(none)'; } };
const cgroupOf = (pid: number | 'self'): string => { try { return /^0::(.*)$/m.exec(readFileSync(`/proc/${pid}/cgroup`, 'utf8'))?.[1]?.trim() ?? ''; } catch { return ''; } };

/**
 * The test's login, for a home at `home` under `tmp`: polkit's stand-in written at `confirm` (the hub's confirmation
 * seam, DEEP_HUB_TEST_CONFIRM: run once per ask with its words, exit 0 is you typing your login password), a user
 * manager of the test's own started on an empty target that wants only dbus.socket, with `seams` and the login's
 * variables in its environment (so the units it starts, the hub's included, get them as a login's units do), and the
 * Secret Service on its session bus. BLOCKED, naming it, when the machine lacks a piece.
 */
export async function linuxWorld(id: string, o: { tmp: string; home: string; confirm: string; seams: Record<string, string> }): Promise<LinuxWorld> {
  const t = tools(id);
  const run = join(o.tmp, 'run');
  mkdirSync(join(run, 'systemd', 'user'), { recursive: true, mode: 0o700 });
  chmodSync(run, 0o700);
  // $XDG_RUNTIME_DIR/systemd/user is on a user manager's unit search path.
  writeFileSync(join(run, 'systemd', 'user', TARGET), '[Unit]\nDescription=A login with only its session bus, for DeepBuild\'s Linux acceptance tests\nWants=dbus.socket\nAfter=dbus.socket\n');
  const asks = join(o.tmp, 'polkit-asks.log');
  writeFileSync(asks, '');
  writeFileSync(o.confirm, [
    '#!/bin/sh',
    '# polkit asking for your login password, stood in for at the hub\'s confirmation seam: the hub runs this once per',
    '# ask, its words the one argument; exit 0 is you typing your password. Each ask\'s words go to the log.',
    `printf '%s\\n' "$1" >> '${asks}'`,
    'exit 0',
    '',
  ].join('\n'));
  chmodSync(o.confirm, 0o755);
  const bus = `unix:path=${join(run, 'bus')}`;
  const env = { XDG_RUNTIME_DIR: run, DBUS_SESSION_BUS_ADDRESS: bus, XDG_DATA_HOME: join(o.home, '.local', 'share') };
  const user = userInfo().username;
  const managerEnv: Record<string, string> = { HOME: o.home, USER: user, LOGNAME: user, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', XDG_CONFIG_HOME: join(o.home, '.config'), XDG_CACHE_HOME: join(o.home, '.cache'), ...env, ...o.seams };
  const log = join(o.tmp, 'user-manager.log');
  const out = openSync(log, 'a');
  // The runner's own environment reaches its own user manager, once, to make the scope; the manager inside gets only managerEnv.
  const child = spawn(t.systemdRun, ['--user', '--scope', '--quiet', '--collect', '-p', 'Delegate=yes', '--', t.env, '-i', ...Object.entries(managerEnv).map(([k, v]) => `${k}=${v}`), t.systemd, '--user', `--unit=${TARGET}`], { env: process.env, cwd: '/', stdio: ['ignore', out, out], detached: true });
  child.on('error', () => undefined);
  child.unref();
  const w: LinuxWorld = { id, home: o.home, tools: t, run, bus, manager: child.pid ?? 0, scope: '', keyring: 0, asks, env, log };
  worlds.push(w);
  const up = await until(async () => existsSync(join(run, 'systemd', 'private')) && (await systemctl(w, ['show', '-p', 'Version', '--value'])).code === 0, 30_000);
  if (!up) throw Error(`BLOCKED: ${id} the test's own user manager (systemd --user in a delegated scope, through systemd-run --user --scope) didn't come up within 30 s; its output ${tail(log)}`);
  // The scope systemd-run made: the manager's cgroup, or the one above its init.scope.
  const scope = cgroupOf(w.manager).replace(/\/init\.scope$/, '');
  w.scope = scope.endsWith('.scope') && scope !== cgroupOf('self') ? scope : '';
  if (!(await until(() => existsSync(join(run, 'bus')), 15_000))) {
    const s = await systemctl(w, ['status', 'dbus.socket', '--no-pager']);
    throw Error(`BLOCKED: ${id} the test's user manager gives no session bus at ${bus}: a user manager needs the distribution's dbus.socket user unit (dbus-user-session on Ubuntu, dbus-broker on Fedora); ${outText(s).slice(0, 1500)}`);
  }
  // The Secret Service on that bus: a keyring of the test's home, unlocked with a password made for this run alone.
  const keyring = spawn(t.keyring, ['--foreground', '--components=secrets', '--unlock'], { env: { PATH: '/usr/bin:/bin', HOME: o.home, LANG: 'C.UTF-8', XDG_CONFIG_HOME: join(o.home, '.config'), ...env }, cwd: '/', stdio: ['pipe', out, out], detached: true });
  keyring.on('error', () => undefined);
  keyring.stdin!.on('error', () => undefined);
  keyring.stdin!.end(randomBytes(18).toString('base64url'));
  keyring.unref();
  w.keyring = keyring.pid ?? 0;
  const owner = () => exec(t.busctl, [`--address=${bus}`, 'call', 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'NameHasOwner', 's', 'org.freedesktop.secrets'], ctlEnv(w));
  if (!(await until(async () => (await owner()).stdout.trim() === 'b true', 20_000))) throw Error(`BLOCKED: ${id} no Secret Service (org.freedesktop.secrets) on the test's session bus 20 s after gnome-keyring-daemon started; ${outText(await owner())}; output ${tail(log)}`);
  return w;
}

/**
 * Stops each test login, by PID: the user manager (SIGTERM starts its exit.target, stopping the hub's unit and every
 * other), the keyring, then anything left in the manager's scope, and waits for them; then removes its XDG_RUNTIME_DIR,
 * leaving the rest of the temp folder removable by the suite's own cleanup. Every login is torn down before a failure
 * is thrown.
 */
export async function linuxTeardown(): Promise<void> {
  const failed: string[] = [];
  for (const w of worlds.splice(0)) {
    if (alive(w.manager)) try { process.kill(w.manager, 'SIGTERM'); } catch { /* gone */ }
    await until(() => !alive(w.manager), 30_000);
    if (alive(w.keyring)) try { process.kill(w.keyring, 'SIGTERM'); } catch { /* gone */ }
    await until(() => !alive(w.keyring), 5000);
    const left = [...scopePids(w.scope), w.manager, w.keyring].filter(alive);
    for (const pid of left) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    if (!(await until(() => !left.some(alive), 10_000))) failed.push(`${w.id}: processes of the test's login still run after SIGKILL: ${left.filter(alive).join(', ')}`);
    // With nothing of the login left to write there, the user manager's mode-000 folders (systemd's `inaccessible`
    // nodes under XDG_RUNTIME_DIR) are made enterable and writable, as their owner, so the temp folder can go.
    const tmp = dirname(w.run);
    removable(tmp);
    try { rmSync(w.run, { recursive: true, force: true }); } catch (error) { failed.push(`${w.id}: ${w.run} can't be removed: ${(error as Error).message}`); }
  }
  if (failed.length) throw Error(`the test's Linux login wasn't torn down whole: ${failed.join('; ')}`);
}
/** Every folder under `dir`, `dir` included, made enterable and writable by its owner (u+rwx), before it is read; links are never followed. */
function removable(dir: string): void {
  try { if (!lstatSync(dir).isDirectory()) return; } catch { return; }
  try { chmodSync(dir, 0o700); } catch { /* not ours to change: rmSync names it */ }
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) removable(join(dir, name));
}
/** Every PID in the scope's cgroup tree: all of them the test's manager's, so the test's own. */
function scopePids(scope: string): number[] {
  if (!scope) return [];
  const out: number[] = [];
  const walk = (dir: string) => {
    try { out.push(...readFileSync(join(dir, 'cgroup.procs'), 'utf8').split('\n').map(Number).filter((n) => n > 0)); } catch { /* gone */ }
    try { for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) walk(join(dir, e.name)); } catch { /* gone */ }
  };
  walk(join('/sys/fs/cgroup', scope));
  return out;
}

// ---- The hub as the systemd user service `deep setup` installed.
/** The service's main process, as the test's user manager reads it; 0 when it has none. */
export async function mainPid(w: LinuxWorld): Promise<number> {
  return Number((await systemctl(w, ['show', '-p', 'MainPID', '--value', UNIT])).stdout.trim()) || 0;
}
/** What the test's user manager says of the hub's unit, and the unit file, for a message or the proof. */
export async function unitStatus(w: LinuxWorld): Promise<string> {
  const status = await systemctl(w, ['status', UNIT, '--no-pager', '--full', '--lines=40']);
  let file = '(no unit file)';
  try { file = readFileSync(unitFile(w.home), 'utf8'); } catch { /* none */ }
  return `${outText(status)}${unitFile(w.home)}:\n${file}`;
}
/**
 * The hub as a systemd user service (README, Readings): `deep setup` wrote its unit under the home's
 * XDG_CONFIG_HOME, enabled it and started it, and the process answering at the socket is the unit's main process,
 * in the unit's own cgroup of the test's manager.
 */
export async function unitProblems(w: LinuxWorld, socket: string): Promise<{ problems: string[]; text: string }> {
  const problems: string[] = [];
  const [enabled, active, pid, text] = [await systemctl(w, ['is-enabled', UNIT]), await systemctl(w, ['is-active', UNIT]), await mainPid(w), await unitStatus(w)];
  const where = `the systemd user service ${UNIT}`;
  if (!existsSync(unitFile(w.home))) problems.push(`deep setup must install the hub as ${where}: no unit file at ${unitFile(w.home)}`);
  if (enabled.stdout.trim() !== 'enabled') problems.push(`deep setup must enable ${where}, so a login starts it: is-enabled reads ${JSON.stringify(enabled.stdout.trim() || enabled.stderr.trim())}`);
  if (active.stdout.trim() !== 'active') problems.push(`deep setup must start ${where}: is-active reads ${JSON.stringify(active.stdout.trim() || active.stderr.trim())}`);
  const cgroup = pid ? cgroupOf(pid) : '';
  if (!pid || !alive(pid)) problems.push(`${where} must have a running main process: MainPID reads ${pid}`);
  else if (!cgroup.endsWith(`/${UNIT}`) || (w.scope && !cgroup.startsWith(w.scope))) problems.push(`the hub must run in ${where}'s own cgroup of the test's user manager: its main process ${pid} is in ${JSON.stringify(cgroup)}`);
  if (!(await answers(socket))) problems.push(`the hub ${where} started must answer at ${socket}`);
  return { problems, text: `MainPID ${pid}, cgroup ${cgroup}\n${outText(enabled)}${outText(active)}${text}` };
}
/** Waits for a hub to answer at the socket; BLOCKED, naming the unit's state, when none does. */
export async function hubUp(w: LinuxWorld, socket: string, timeoutMs = 30_000): Promise<void> {
  if (await until(() => answers(socket), timeoutMs)) return;
  throw Error(`BLOCKED: ${w.id} no hub answers at ${socket}; ${(await unitStatus(w)).slice(0, 2500)}`);
}
/** Stops the hub by its unit's main process, by PID (SIGTERM), and waits for it to exit and its socket to go quiet. */
export async function stopHub(w: LinuxWorld, socket: string): Promise<void> {
  const pid = await mainPid(w);
  if (!pid) throw Error(`BLOCKED: ${w.id} the hub's unit has no main process to stop by PID; ${(await unitStatus(w)).slice(0, 2000)}`);
  try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  if (!(await until(async () => !alive(pid) && !(await answers(socket, 500)), 15_000))) throw Error(`BLOCKED: ${w.id} the hub (MainPID ${pid}) still answers at ${socket} 15 s after SIGTERM, or systemd started it again on its own; ${(await unitStatus(w)).slice(0, 2000)}`);
}
/**
 * A hub restart on Linux: the hub stopped by its unit's main process, by PID (SIGTERM, as a logout or an update stops
 * it), then its login service starts it again (`systemctl --user start`, a no-op if Restart= already did).
 */
export async function restartHub(w: LinuxWorld, socket: string): Promise<string> {
  const pid = await mainPid(w);
  if (!pid) throw Error(`BLOCKED: ${w.id} the hub's unit has no main process to restart; ${(await unitStatus(w)).slice(0, 2000)}`);
  try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  if (!(await until(() => !alive(pid), 30_000))) throw Error(`BLOCKED: ${w.id} the hub (MainPID ${pid}) hasn't exited 30 s after SIGTERM`);
  const start = await systemctl(w, ['start', UNIT]);
  await hubUp(w, socket);
  return `(SIGTERM to MainPID ${pid}; it exited)\n${outText(start)}(MainPID now ${await mainPid(w)})\n`;
}

// ---- The hub's socket (#16's line protocol), as far as these twins read it.
export function answers(socket: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(socket);
    const done = (v: boolean) => { clearTimeout(timer); sock.destroy(); resolve(v); };
    const timer = setTimeout(() => done(false), timeoutMs);
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => { if (d.includes('\n')) done(true); });
    sock.on('error', () => done(false));
  });
}
/** `hub.health` on a cli connection with the control token. */
export function hubHealth(socket: string, tokenFile: string, timeoutMs = 10_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buffer = '';
    let step: 'hello' | 'role' | 'health' = 'hello';
    const timer = setTimeout(() => finish(() => reject(Error(`hub.health: no answer within ${timeoutMs} ms`))), timeoutMs);
    const finish = (then: () => void) => { clearTimeout(timer); sock.destroy(); then(); };
    sock.setEncoding('utf8');
    sock.on('error', (error) => finish(() => reject(error)));
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line: Record<string, unknown>;
        try { line = JSON.parse(buffer.slice(0, i)) as Record<string, unknown>; } catch { line = {}; }
        buffer = buffer.slice(i + 1);
        if (step === 'hello') {
          step = 'role';
          sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(tokenFile, 'utf8').trim() })}\n`);
        } else if (step === 'role' && ('role' in line || 'error' in line)) {
          if (line.role !== 'cli') return finish(() => reject(Error(`the hub refused the cli hello: ${JSON.stringify(line)}`)));
          step = 'health';
          sock.write(`${JSON.stringify({ v: 1, id: 'health', method: 'hub.health', params: {} })}\n`);
        } else if (step === 'health' && line.id === 'health') {
          return finish(() => ('result' in line ? resolve(line.result as Record<string, unknown>) : reject(Error(`hub.health refused: ${JSON.stringify(line.error)}`))));
        }
      }
    });
  });
}

// ---- polkit's stand-in: the asks the hub showed.
export const asksOf = (w: LinuxWorld): string[] => { try { return readFileSync(w.asks, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
/** `id`'s reading of the trusted path on Linux: each command in `commands` was shown to polkit (its words start with the command), so it counted only once polkit confirmed you. */
export function askedProblems(id: string, asks: readonly string[], commands: readonly string[]): string[] {
  return commands.filter((c) => !asks.some((a) => a === c || a.startsWith(`${c} `))).map((c) => `${id} on Linux \`${c}\` counts only once polkit confirms you with your login password, never on the peer check alone: the hub showed polkit no ask for it (the asks it showed: ${JSON.stringify(asks)})`);
}

// ---- bubblewrap: whether a check's processes ran inside it.
export interface Sighting { pid: number; sandboxed: boolean; chain: string; cmd: string }
/**
 * Watches, every 100 ms, the processes under the test's user manager (the hub's and every run it starts, since the
 * manager is their subreaper) whose command line matches `match`, and reads whether each sat under a `bwrap` process.
 */
export function sandboxWatch(w: LinuxWorld, match: RegExp): { stop(): Promise<Sighting[]> } {
  const seen = new Map<number, Sighting>();
  let stopped = false;
  const scan = () => {
    const procs = new Map<number, { ppid: number; comm: string }>();
    let names: string[] = [];
    try { names = readdirSync('/proc').filter((n) => /^\d+$/.test(n)); } catch { return; }
    for (const name of names) {
      try {
        const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
        const close = stat.lastIndexOf(')');
        procs.set(Number(name), { comm: stat.slice(stat.indexOf('(') + 1, close), ppid: Number(stat.slice(close + 2).split(' ')[1]) });
      } catch { /* gone */ }
    }
    for (const [pid, p] of procs) {
      if (seen.has(pid)) continue;
      const chain: string[] = [];
      let under = false;
      for (let at: number | undefined = p.ppid; at !== undefined && at > 1; at = procs.get(at)?.ppid) {
        if (at === w.manager) { under = true; break; }
        const parent = procs.get(at);
        if (!parent) break;
        chain.push(`${parent.comm}[${at}]`);
      }
      if (!under) continue;
      let cmd = '';
      try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim(); } catch { continue; }
      if (match.test(cmd)) seen.set(pid, { pid, sandboxed: chain.some((c) => c.startsWith('bwrap[')), chain: chain.join(' < '), cmd: cmd.slice(0, 300) });
    }
  };
  const loop = (async () => { while (!stopped) { scan(); await sleep(100); } })();
  return { stop: async () => { stopped = true; await loop; return [...seen.values()]; } };
}
/** INVALID when a check's process was seen outside bubblewrap: its verdict isn't evidence of the Linux path. */
export function sandboxedOrInvalid(id: string, seen: readonly Sighting[]): void {
  const outside = seen.filter((s) => !s.sandboxed);
  if (outside.length) throw Error(`INVALID: ${id} a check's process ran outside bubblewrap, the platform sandbox's Linux backend, so its verdict can't stand as evidence: ${JSON.stringify(outside.slice(0, 5))}`);
}

/** The distribution and kernel, for the proof's machine.txt (#70 names Ubuntu LTS and Fedora). */
export function distro(): string {
  let name = 'unknown distribution';
  try { name = /^PRETTY_NAME="?([^"\n]*)"?$/m.exec(readFileSync('/etc/os-release', 'utf8'))?.[1] ?? name; } catch { /* none */ }
  return `${name}; kernel ${release()}`;
}
