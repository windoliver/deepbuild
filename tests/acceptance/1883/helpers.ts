// Test-side tools for #1883's acceptance tests (README): a world (a test home under /tmp, the hub as `deep hub run`
// on its installed root there, a git repo with an origin, the Claude Code stand-in on its login PATH), the approval
// and `deep start` as you run them in your terminal, and readings of the agent's config file. Nothing here stands in
// for the hub, git or the worktree; only the agent (fixtures/claude.mjs) is played. #1330's line client, waits and
// plant reading are imported from its suite, not copied.
//
// Safety: every folder is under /tmp/dh1883-* (made here, removed at the end); HOME is that folder for the hub and
// every child, so no real ~/.claude.json, ~/.claude or ~/.deepbuild is read or written. Processes are stopped by PID
// only: the hubs this suite started, their descendants and the stand-ins they launched. Nothing leaves 127.0.0.1.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import { Client, failureOf, jsonOut, mustStart, shown, sleep, waitFor, type Line } from '../1330/helpers.ts';

export { failureOf, shown, type Line };
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
const STAND_IN = fileURLToPath(new URL('./fixtures/claude.mjs', import.meta.url));

/** The criteria's IDs: `#1883.` and the first 8 hex digits of SHA-256 of each criterion's text, white space collapsed (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #1883.cba928bb',
  2: 'AC2 #1883.6b16b1ac',
  3: 'AC3 #1883.dd68075b',
} as const;
/** The planted `Starts.trust` that writes a temporary file and renames it over the config path (README). */
export const PLANT = 'trust-renames-over-link';
/** The issue every approval and start here names. */
export const ISSUE = 1883;

// ---- Processes: stopped by PID only.
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
const commandOf = (pid: number): string => {
  try { return execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim(); } catch { return ''; }
};
function descendants(root: number): number[] {
  const table = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).stdout.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number) as [number, number]);
  const out: number[] = [];
  const walk = (p: number): void => { for (const [pid, ppid] of table) if (ppid === p) { out.push(pid); walk(pid); } };
  walk(root);
  return out;
}
async function stopPids(pids: number[]): Promise<void> {
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while (pids.some(alive) && Date.now() < deadline) await sleep(100);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}

// ---- The world.
const ASKS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};

/**
 * The version the stand-in reports: the newest the shipped Claude Code facts list that their `sandbox` has no entry
 * for, so the hub starts it with no sandbox of its own on any platform (else the newest listed).
 */
export function standInVersion(): string {
  const facts = JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as Line;
  const listed = facts.versions as string[];
  const sandboxed = Object.keys((facts.sandbox?.versions ?? {}) as Line);
  return [...listed].reverse().find((v) => !sandboxed.includes(v)) ?? listed.at(-1)!;
}

export interface Hub { pid: number; socket: string; child: ChildProcess; exit: Promise<unknown>; stderr(): string }
export interface World { home: string; root: string; repo: string; bin: string; loginPath: string; hub: Hub; client: Client; plant: string | undefined }
const worlds: World[] = [];
const made: string[] = [];

/** Every child's environment: the test home, the login PATH, and only the test variables named. */
export function envFor(w: Pick<World, 'home' | 'loginPath'>, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: w.home, PATH: `${w.loginPath}:${process.env.PATH ?? ''}`, SHELL: '/bin/sh', LC_ALL: 'C' };
  for (const [k, v] of Object.entries(extra)) { if (v === undefined) delete env[k]; else env[k] = v; }
  return env;
}
export function git(w: Pick<World, 'home' | 'loginPath'>, dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, '-c', 'user.name=dh1883', '-c', 'user.email=dh1883@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { encoding: 'utf8', env: envFor(w, { GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }), stdio: ['ignore', 'pipe', 'pipe'] });
}

async function runHub(w: Pick<World, 'home' | 'loginPath'>, plant: string | undefined): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], {
    cwd: w.home, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    env: envFor(w, { DEEP_HUB_PLANT: plant, DEEP_HUB_TEST_CONFIRM: join(w.home, 'confirm'), DEEP_HUB_TEST_FORGE: 'http://127.0.0.1:9' }),
  });
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise((resolve) => child.on('exit', resolve));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) { try { resolve(JSON.parse(out.split('\n')[0]!) as Line); } catch { resolve(undefined); } }
      });
    }),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (ready?.ready !== true) {
    if (child.pid && alive(child.pid)) try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ }
    throw Error(`BLOCKED: the hub${plant ? ` with the plant DEEP_HUB_PLANT=${plant}` : ''} did not start (a hub that doesn't list a plant refuses to start): ${err.slice(-800)}`);
  }
  return { pid: child.pid!, socket: String(ready.socket), child, exit, stderr: () => err };
}

/** A world: a test home, the stand-in on its login PATH, a repo pushed to its origin, and the hub on it. */
export async function openWorld(o: { plant?: string } = {}): Promise<World> {
  if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI (npm run build --workspaces) is not built at ${CLI}`);
  // The hub won't open without deep-hook built in the checkout, though no hook runs here.
  if (!['release', 'debug'].some((p) => existsSync(join(REPO, 'target', p, 'deep-hook')))) throw Error(`BLOCKED: deep-hook (cargo build --locked -p deep-hook) is not built under ${join(REPO, 'target')}; the hub won't start without it`);
  const home = realpathSync(mkdtempSync('/tmp/dh1883-'));
  made.push(home);
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  copyFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), join(root, 'rules.json'));
  // The login shell's PATH: the stand-in's folder first, then Node's, then the system's.
  const bin = join(home, 'bin');
  const loginPath = [bin, dirname(NODE), '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: ASKS, runner: { login_path: loginPath } }, null, 2)}\n`);
  writeFileSync(join(home, 'confirm'), 'confirmed\n');
  for (const f of ['.zprofile', '.bash_profile', '.profile']) writeFileSync(join(home, f), `export PATH="${loginPath}"\n`);
  mkdirSync(bin, { recursive: true });
  const program = readFileSync(STAND_IN, 'utf8').replace(/^#!.*\n/, `#!${NODE}\n`)
    .replace("'__VERSION__'", JSON.stringify(standInVersion())).replace("'__LOGDIR__'", JSON.stringify(join(home, '.standin')));
  writeFileSync(join(bin, 'claude'), program, { mode: 0o755 });
  // Claude Code's default home, so the approval's home is the default and its config file is ~/.claude.json.
  mkdirSync(join(home, '.claude'), { recursive: true });
  const l = { home, loginPath };
  const origin = join(home, 'origin.git');
  const repo = join(home, 'src', 'shop');
  mkdirSync(repo, { recursive: true });
  git(l, home, 'init', '-q', '--bare', '-b', 'main', origin);
  writeFileSync(join(repo, 'README.md'), 'a sample shop\n');
  git(l, repo, 'init', '-q', '-b', 'main');
  git(l, repo, 'add', '-A');
  git(l, repo, 'commit', '-q', '-m', 'the sample');
  git(l, repo, 'remote', 'add', 'origin', origin);
  git(l, repo, 'push', '-q', '-u', 'origin', 'main');
  const hub = await runHub(l, o.plant);
  const w: World = { home, root, repo, bin, loginPath, hub, client: await Client.open(hub.socket, root), plant: o.plant };
  worlds.push(w);
  return w;
}

/** The stand-ins a world's hub launched, by the PIDs they wrote. */
function standInPids(w: World): number[] {
  const dir = join(w.home, '.standin');
  return existsSync(dir) ? readdirSync(dir).map(Number).filter((p) => Number.isSafeInteger(p) && p > 1) : [];
}
export async function closeWorld(w: World): Promise<void> {
  w.client.close();
  const pids = new Set<number>(descendants(w.hub.pid));
  for (const p of standInPids(w)) if (alive(p) && commandOf(p).includes(w.home)) pids.add(p);
  pids.add(w.hub.pid);
  await stopPids([...pids]);
  for (const p of standInPids(w)) if (alive(p) && commandOf(p).includes(w.home)) await stopPids([p]);
}
afterAll(async () => {
  for (const w of worlds.splice(0)) await closeWorld(w);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 120_000);

// ---- `deep` as you run it in your terminal.
export interface Ran { code: number | null; stdout: string; stderr: string; out: Line | undefined }
export function deep(w: World, args: string[]): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd: w.home, env: envFor(w), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 180_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, out: jsonOut(stdout) }); });
  });
}

/**
 * A start that records trust, as #1330 makes one: `deep start approve` for this issue and Claude Code in its default
 * home, your yes on the trusted path (`deep inbox answer`, the OS confirming you through the hub's test stand-in),
 * then `deep start`. Returns the worktree it made, the folder whose trust the config file must hold.
 */
export async function trustedStart(w: World): Promise<{ run: string; worktree: string }> {
  const asked = await deep(w, ['start', 'approve', '--repo', w.repo, '--issues', String(ISSUE), '--agents', 'claude-code', '--at-once', '1', '--plan-share', '100', '--json']);
  expect(asked.code, `deep start approve exits 0 with the ask it raised (${shown(asked)})`).toBe(0);
  const handle = String(asked.out?.ask ?? '');
  expect(handle.startsWith('ask:'), `deep start approve --json prints { ask: "ask:<id>" }: ${JSON.stringify(asked.out)}`).toBe(true);
  const id = handle.slice(4);
  const created = await waitFor(async () => (await w.client.events('ask.created')).find((e) => JSON.stringify(e).includes(id)), 15_000, `the ask.created event of ${handle}`);
  const yes = ((created.data?.options ?? []) as { id: string; decision?: string }[]).find((x) => x.decision === 'allow');
  expect(yes, `${handle} offers a yes: ${JSON.stringify(created.data?.options)}`).toBeTruthy();
  const answered = await deep(w, ['inbox', 'answer', handle, yes!.id]);
  expect(answered.code, `deep inbox answer ${handle} ${yes!.id} exits 0 (${shown(answered)})`).toBe(0);
  const s = mustStart(await deep(w, ['start', '--repo', w.repo, '--issue', String(ISSUE), '--agent', 'claude-code', '--prompt', 'Say ready.', '--json']),
    `a start for issue ${ISSUE} under its approval`);
  return { run: s.run, worktree: s.worktree };
}

// ---- The agent's config file: Claude Code's ~/.claude.json in its default home (facts: launch.started.trust.file).
export const configPath = (w: World): string => join(w.home, '.claude.json');
