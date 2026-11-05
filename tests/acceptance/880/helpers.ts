// Test-side tools for the #880 acceptance tests (README). Each test builds a rig in a short /tmp folder:
// - a copy of the built hub and CLI (`<tmp>/s`, README: The copy of the hub), so the test can replace the copy's
//   `packages/hub/dist/deep-confirm`, the helper beside the hub's code, without touching this checkout's build;
// - the test's helper at that location: fixtures/launcher.c compiled with the paths and a role, ad-hoc signed, which
//   runs fixtures/helper.mjs with a P-256 key in a file (README: The helper's protocol);
// - a home (`<tmp>/h`) with `deep setup` run in it through the copy's CLI, launchd stood in for by fixtures/launchd.mjs;
// - a git worktree (`<tmp>/w`) for the session, whose commits are what its asks are pinned to;
// - the record seeded through the real record and asks core, and the copy's hub run as `deep hub run`, with no
//   DEEP_HUB_TEST_CONFIRM: the hub asks its helper.
// Processes are stopped by PID only, never by name or port.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection } from '../../../packages/record/src/index.ts';
import { askSources } from '../../../packages/asks/src/index.ts';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { withPlans } from '../plans.ts';
import { Conn, ulid } from '../24/helpers.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
export const MINUTE = 60_000;
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const parse = (raw: string): Line | undefined => { try { return JSON.parse(raw) as Line; } catch { return undefined; } };

/** These tests need macOS: the helper, its code signature and LocalAuthentication are macOS's (the Linux route is out of scope). */
export function onMac(): void {
  if (process.platform !== 'darwin') throw Error(`BLOCKED: #880 changes macOS only; on ${process.platform} there's no code signature or Secure Enclave to test`);
}

// ---- Temp folders (short: a socket path must fit in 104 bytes on macOS) and processes this suite started.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh880-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
export const own = (pid: number | undefined): void => { if (pid) owned.add(pid); };
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
async function stop(pids: Iterable<number>): Promise<void> {
  const list = [...pids];
  for (const pid of list) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 10_000;
  while (list.some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of list) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}
const launched: string[] = [];
/** Every PID the launchd stand-in started for a rig of this file. */
const launchedPids = (): number[] => launched.flatMap((f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').map(Number).filter((n) => n > 0) : []));
/** Stops every process this suite started, the hubs setup started included, by PID (SIGTERM, then SIGKILL), and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of launchedPids()) own(pid);
  launched.length = 0;
  await stop(owned);
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- Children: HOME the rig's, a PATH with nothing of yours on it, and none of this process's DEEP_* settings.
export function childEnv(rig: Rig, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_|TMUX)/.test(key) || key === 'NODE_OPTIONS' || /API_KEY|AUTH_TOKEN|OAUTH/.test(key)) continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: rig.home, XDG_CONFIG_HOME: join(rig.home, '.config'), XDG_CACHE_HOME: join(rig.home, '.cache'),
    PATH: `${rig.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: join(rig.bin, 'sh-login'), LC_ALL: 'C',
  });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
export interface Ran { code: number | null; stdout: string; stderr: string; ms: number; end: number }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? '/tmp', env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 120_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, ms: performance.now() - t0, end: Date.now() }); });
  });
}
export const shown = (r: Ran): string => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;
/** `deep <args>` from the copy's CLI, run by you: a child of this test process, under no agent. */
export const deep = (rig: Rig, args: readonly string[]): Promise<Ran> => run(NODE, [rig.cli, ...args], { env: childEnv(rig), cwd: rig.tmp, timeoutMs: 180_000 });

// ---- deep-hook: `deep setup` names the built binary its hook entries run, so it must be built before setup; a
// checkout that has one built isn't built again, as setup itself doesn't.
let cargo: Promise<void> | undefined;
export function cargoBuild(): Promise<void> {
  if (['release', 'debug'].some((p) => existsSync(join(REPO, 'target', p, 'deep-hook')))) return Promise.resolve();
  cargo ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REPO, timeoutMs: 1_200_000 }).then((r) => {
    if (r.code !== 0) throw Error(`BLOCKED: cargo build -p deep-hook failed: ${r.stderr.slice(-3000)}`);
  });
  return cargo;
}

// ---- The copy of the hub (README: The copy of the hub).
/**
 * `<at>`: every top-level entry of this checkout as a link, except `packages` and `node_modules`. `packages/hub` and
 * `packages/cli` are folders of links with `dist` copied (the hub's helper left out); every other package is a link.
 * `node_modules` links every entry but `@deepbuild`, whose packages point into the copy's `packages`, so the copy's
 * CLI loads the copy's hub, and the copy's hub finds its helper beside its own code.
 */
function copyOfTheHub(at: string): void {
  for (const dist of ['packages/hub/dist/index.js', 'packages/cli/dist/main.js', 'node_modules/@deepbuild']) {
    if (!existsSync(join(REPO, dist))) throw Error(`BLOCKED: ${dist} is missing; run npm ci and npm run build --workspaces first`);
  }
  mkdirSync(at);
  for (const name of readdirSync(REPO)) if (name !== 'packages' && name !== 'node_modules') symlinkSync(join(REPO, name), join(at, name));
  mkdirSync(join(at, 'packages'));
  for (const name of readdirSync(join(REPO, 'packages'))) {
    if (name !== 'hub' && name !== 'cli') { symlinkSync(join(REPO, 'packages', name), join(at, 'packages', name)); continue; }
    mkdirSync(join(at, 'packages', name));
    for (const entry of readdirSync(join(REPO, 'packages', name))) {
      if (entry !== 'dist') symlinkSync(join(REPO, 'packages', name, entry), join(at, 'packages', name, entry));
    }
    // The checkout's own deep-confirm is never copied: no test here may run the real helper (README).
    cpSync(join(REPO, 'packages', name, 'dist'), join(at, 'packages', name, 'dist'), { recursive: true, filter: (src) => !(name === 'hub' && basename(src) === 'deep-confirm') });
  }
  mkdirSync(join(at, 'node_modules'));
  for (const name of readdirSync(join(REPO, 'node_modules'))) if (name !== '@deepbuild') symlinkSync(join(REPO, 'node_modules', name), join(at, 'node_modules', name));
  mkdirSync(join(at, 'node_modules', '@deepbuild'));
  for (const name of readdirSync(join(REPO, 'node_modules', '@deepbuild'))) {
    const real = realpathSync(join(REPO, 'node_modules', '@deepbuild', name));
    const inPackages = dirname(real) === realpathSync(join(REPO, 'packages'));
    symlinkSync(inPackages ? join(at, 'packages', basename(real)) : real, join(at, 'node_modules', '@deepbuild', name));
  }
}

// ---- The rig.
export const SESSION = 'S880';
export const PROJECT = 'shop';
export interface Rig {
  tmp: string; home: string; bin: string;
  /** The copy of the hub, and its CLI. */
  shadow: string; cli: string;
  /** The hub's helper location in the copy: `<shadow>/packages/hub/dist/deep-confirm`. */
  helper: string;
  /** The test helper's state: its key, mode, calls and captures (README: The helper's protocol). */
  work: string;
  /** The test helper as built for setup, kept to put back. */
  built: string;
  /** The session's git worktree. */
  worktree: string;
}
/**
 * A rig with the test's helper at the hub's helper location; `realHelper` (criterion 4 only, run by a person) keeps
 * the checkout's own deep-confirm there instead.
 */
export async function makeRig(o: { realHelper?: boolean } = {}): Promise<Rig> {
  onMac();
  await cargoBuild();
  const tmp = tempDir();
  const shadow = join(tmp, 's');
  copyOfTheHub(shadow);
  const rig: Rig = {
    tmp, home: join(tmp, 'h'), bin: join(tmp, 'bin'), shadow, cli: join(shadow, 'packages/cli/dist/main.js'),
    helper: join(shadow, 'packages/hub/dist/deep-confirm'), work: join(tmp, 'k'), built: join(tmp, 'k', 'helper.bin'), worktree: join(tmp, 'w'),
  };
  for (const dir of [rig.home, rig.bin, rig.work]) mkdirSync(dir, { recursive: true });
  const script = (name: string, text: string) => { writeFileSync(join(rig.bin, name), text); chmodSync(join(rig.bin, name), 0o755); };
  // Your login shell, as setup reads it: login flags dropped, so no profile of this machine is read.
  script('sh-login', [
    '#!/bin/sh',
    `PATH='${rig.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin'; export PATH`,
    'for a; do shift; case "$a" in -l|-i|--login|-il|-li) ;; -lc|-cl|-ilc|-lic|-ic|-ci) set -- "$@" -c ;; *) set -- "$@" "$a" ;; esac; done',
    'exec /bin/sh "$@"', '',
  ].join('\n'));
  writeFileSync(join(rig.work, 'config.json'), JSON.stringify({ dir: rig.work, key: join(rig.work, 'key.pem') }));
  if (o.realHelper) {
    const real = join(REPO, 'packages/hub/dist/deep-confirm');
    if (!existsSync(real)) throw Error(`BLOCKED: ${real} isn't built; run npm run build --workspaces`);
    copyFileSync(real, rig.built);
  } else {
    buildHelper(rig, 'helper', rig.built);
  }
  installHelper(rig, rig.built);
  makeWorktree(rig);
  return rig;
}

// ---- The test's helper binaries.
/**
 * Compiles fixtures/launcher.c for `role` into `out` and signs it ad hoc with the identifier `deep-confirm`, so the
 * helper and the impostor share their identifier and differ in their code (their CDHash).
 */
export function buildHelper(rig: Rig, role: 'helper' | 'impostor', out: string): void {
  const define = (name: string, value: string) => `-D${name}="${value}"`;
  try {
    execFileSync('cc', ['-O2', '-o', out, join(FIXTURES, 'launcher.c'), define('NODE_PATH', NODE), define('SCRIPT_PATH', join(FIXTURES, 'helper.mjs')),
      define('CONFIG_PATH', join(rig.work, 'config.json')), define('ROLE', role)], { stdio: 'pipe' });
    execFileSync('codesign', ['--force', '--sign', '-', '--identifier', 'deep-confirm', out], { stdio: 'pipe' });
  } catch (error) {
    throw Error(`BLOCKED: building the test's ${role} with cc and codesign failed: ${String((error as { stderr?: Buffer }).stderr ?? error)}`);
  }
}
/** The code identity codesign reads from a file: its identifier and CDHash. */
export function identity(file: string): { identifier: string; cdhash: string } {
  // codesign writes what it displays to stderr.
  const r = spawnSync('codesign', ['--display', '--verbose=4', file], { encoding: 'utf8' });
  const all = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { identifier: /^Identifier=(.*)$/m.exec(all)?.[1] ?? '', cdhash: /^CDHash=(.*)$/m.exec(all)?.[1] ?? '' };
}
/** Puts `file` at the hub's helper location as a new file (a rename, so no running process sees its bytes change). */
export function installHelper(rig: Rig, file: string): void {
  const tmp = `${rig.helper}.new`;
  copyFileSync(file, tmp);
  chmodSync(tmp, 0o755);
  renameSync(tmp, rig.helper);
}
/** Criterion 1's helper: a script that prints nothing and exits 0. */
export function plantExitZero(rig: Rig): void {
  const tmp = `${rig.helper}.new`;
  writeFileSync(tmp, '#!/bin/sh\nexit 0\n');
  chmodSync(tmp, 0o755);
  renameSync(tmp, rig.helper);
}
/** What the test helper does at its next `sign` (README: The helper's protocol). */
export type Mode = { mode: 'sign' } | { mode: 'capture' } | { mode: 'capture-cancel' } | { mode: 'cancel' } | { mode: 'replay'; capture: number };
export function setMode(rig: Rig, mode: Mode): void {
  const file = join(rig.work, 'mode.json');
  writeFileSync(`${file}.tmp`, JSON.stringify(mode));
  renameSync(`${file}.tmp`, file);
}
export interface Call { at: number; role: string; args: string[]; challenge?: Line; reply?: Line; enrolled?: string; base_protocol?: boolean }
/** Every call the test helper (or impostor) logged. */
export const calls = (rig: Rig): Call[] => {
  const file = join(rig.work, 'calls.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Call) : [];
};
export interface Capture { challenge: Line; response: Line }
export const captures = (rig: Rig): Capture[] => {
  const file = join(rig.work, 'captures.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Capture) : [];
};
export const impostorMarker = (rig: Rig): string => join(rig.work, 'impostor-started');

// ---- The session's worktree: the commits its asks are pinned to.
const gitEnv = (rig: Rig): NodeJS.ProcessEnv => ({ PATH: '/usr/bin:/bin', HOME: rig.home, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'You', GIT_AUTHOR_EMAIL: 'you@example.invalid', GIT_COMMITTER_NAME: 'You', GIT_COMMITTER_EMAIL: 'you@example.invalid', LC_ALL: 'C' });
const git = (rig: Rig, ...args: string[]): string => execFileSync('git', ['-C', rig.worktree, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { env: gitEnv(rig), encoding: 'utf8' }).trim();
function makeWorktree(rig: Rig): void {
  mkdirSync(rig.worktree);
  git(rig, 'init', '-q', '-b', 'main');
  commit(rig, 'first');
}
/** A new commit in the session's worktree: an ask pinned to the one before now shows what changed (design: Asks stay current). */
export function commit(rig: Rig, what: string): string {
  writeFileSync(join(rig.worktree, 'release.txt'), `${what}\n`);
  git(rig, 'add', '-A');
  git(rig, 'commit', '-q', '-m', what);
  return git(rig, 'rev-parse', 'HEAD');
}
export const head = (rig: Rig): string => git(rig, 'rev-parse', 'HEAD');

// ---- `deep setup`, through the copy's CLI, with launchd stood in for.
/**
 * Runs `deep setup` in the rig's home; insists it exits 0 (or 4, the wiki not built, which setup says leaves setup
 * standing). The hub setup started through the launchd stand-in is stopped afterwards, by PID, so each test starts
 * the hub itself with the settings it needs.
 */
export async function setup(rig: Rig): Promise<Ran> {
  const log = join(rig.tmp, 'launched.pids');
  launched.push(log);
  const r = await run(NODE, [rig.cli, 'setup'], { env: childEnv(rig, { DEEP_HUB_LAUNCHER: join(rig.bin, 'launchctl-standin'), DEEP_TEST_LAUNCHER_LOG: log }), cwd: rig.tmp, timeoutMs: 300_000 });
  if (r.code !== 0 && r.code !== 4) throw Error(`BLOCKED: deep setup didn't install DeepBuild in the test's home: ${shown(r)}`);
  await stop(existsSync(log) ? readFileSync(log, 'utf8').split('\n').map(Number).filter((n) => n > 0) : []);
  return r;
}
/** The launchd stand-in setup runs as $DEEP_HUB_LAUNCHER. */
export function writeLauncher(rig: Rig): void {
  writeFileSync(join(rig.bin, 'launchctl-standin'), `#!/bin/sh\nexec '${NODE}' '${join(FIXTURES, 'launchd.mjs')}' "$@"\n`);
  chmodSync(join(rig.bin, 'launchctl-standin'), 0o755);
}

// ---- The record, seeded with the hub stopped, through the real record and asks core.
export const rootOf = (rig: Rig): string => join(rig.home, '.deepbuild');
const who = { actor: 'you', scope: 'you' };
const core = (session: string): Connection => ({ writer: 'core', ...who, session, project: PROJECT });
const AUTHORITY = [{ id: 'approve', label: 'Push it', decision: 'allow' }, { id: 'decline', label: 'Hold the push', decision: 'deny' }];
/** An authority ask as ask.created@1 data, pinned to the commit `ref` of the session's worktree. */
function authorityAsk(subject: string, raised: number, ref: string): Line {
  return {
    kind: 'authority', question: `Push ${subject} to origin?`, options: structuredClone(AUTHORITY), recommended: null,
    deadline: raised + 86_400_000, fallback: 'you', default: 'decline', provisional: false, owner: 'you', key: sha256(`authority:${subject}`),
    pinned_to: { kind: 'commit', ref },
  };
}
/** Seeds the session (its worktree the rig's) and one authority ask per subject, pinned to the worktree's HEAD; their handles. */
export async function seedAsks(rig: Rig, subjects: readonly string[]): Promise<string[]> {
  const now = Date.now();
  const record = await openRecord({ path: join(rootOf(rig), 'ledger.db'), now: () => now });
  try {
    const asks = withPlans(await openAsks({ record, now: () => now, deliver: () => undefined }));
    await record.append({ writer: 'hook', ...who, session: SESSION, project: PROJECT, agent: 'claude-code' }, { v: 1, id: ulid(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: rig.worktree, branch: 'main', thread: SESSION } });
    const source = askSources().find((row) => row.kind === 'authority')!.source;
    const handles: string[] = [];
    for (const subject of subjects) handles.push(await asks.raise(core(SESSION), source, authorityAsk(subject, now, head(rig))));
    return handles;
  } finally {
    await record.close();
  }
}

// ---- The hub: `deep hub run` from the copy, HOME the rig's, never with DEEP_HUB_TEST_CONFIRM.
export interface Hub { pid: number; rig: Rig; socket: string; child: ChildProcess; stderr(): string }
export async function startHub(rig: Rig, o: { plant?: string } = {}): Promise<Hub> {
  const child = spawn(NODE, [rig.cli, 'hub', 'run'], { cwd: rig.tmp, env: childEnv(rig, { DEEP_HUB_PLANT: o.plant }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let err = '';
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const ready = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 60_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); resolve(parse(out.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start${o.plant ? ` with DEEP_HUB_PLANT=${o.plant}` : ''}: ${err.slice(0, 2000)}`);
  return { pid: child.pid!, rig, socket: join(rootOf(rig), 'hub.sock'), child, stderr: () => err };
}

/** A rig with `deep setup` run (the helper enrolled), asks seeded for `subjects`, and its hub started. */
export async function ready(subjects: readonly string[], o: { plant?: string; realHelper?: boolean } = {}): Promise<{ rig: Rig; hub: Hub; asks: string[] }> {
  const rig = await makeRig({ realHelper: o.realHelper ?? false });
  writeLauncher(rig);
  await setup(rig);
  const asks = await seedAsks(rig, subjects);
  const hub = await startHub(rig, o.plant ? { plant: o.plant } : {});
  return { rig, hub, asks };
}

// ---- What the record holds, through the hub's socket (`events.read` on a cli connection with the control token).
async function control(hub: Hub): Promise<Conn> {
  const token = readFileSync(join(rootOf(hub.rig), 'control.token'), 'utf8').trim();
  const { conn, answer } = await Conn.open(hub.socket, { hello: 'cli', token });
  if (answer?.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(answer)}`);
  return conn;
}
export interface Ev { id: string; kind: string; subject?: string; writer: string; data: Line; log_pos: number }
export async function events(hub: Hub): Promise<Ev[]> {
  const conn = await control(hub);
  try {
    const all: Ev[] = [];
    for (let after = 0; ;) {
      const reply = await conn.call('events.read', { after, limit: 1000 });
      if ('error' in reply) throw Error(`BLOCKED: events.read refused: ${JSON.stringify(reply.error)}`);
      const page = reply.result.events as Ev[];
      if (!page.length) return all;
      all.push(...page);
      after = page[page.length - 1]!.log_pos;
    }
  } finally {
    conn.close();
  }
}
const CLOSING = new Set(['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot']);
/** The ask's closing events and any decision saved from it or applied to it. */
export function counted(all: readonly Ev[], handle: string): Ev[] {
  return all.filter((e) => (CLOSING.has(e.kind) && e.subject === handle) || ((e.kind === 'decision.created' || e.kind === 'decision.applied') && e.data?.ask === handle));
}
/** The ask is still open: nothing closed it, and no decision was saved from it. The message names the ask. */
export async function expectOpen(hub: Hub, handle: string, how: string): Promise<void> {
  await sleep(300);   // anything the hub appends for the answer lands before this read
  const found = counted(await events(hub), handle);
  expect(found.map((e) => `${e.kind} ${e.id}`), `ask ${handle} (${how}) counted: it must be refused and the ask stay open, no decision saved`).toEqual([]);
}
/** The answer counted once: one ask.answered with `option`, from deep inbox answer. */
export async function expectCountedOnce(hub: Hub, handle: string, option: string, how: string): Promise<void> {
  const answered = counted(await events(hub), handle).filter((e) => e.kind === 'ask.answered');
  expect(answered.map((e) => [e.data.answer, e.data.via]), `ask ${handle} (${how}) is answered exactly once, with ${option}, from deep inbox answer`).toEqual([[option, 'inbox']]);
}
/** The refusal of `deep inbox answer`: exit 3 (not decided), its output naming `what`. */
export function expectRefusedNaming(r: Ran, what: string, how: string): void {
  expect(r.code, `deep inbox answer (${how}) exits 3, not decided: ${shown(r)}`).toBe(3);
  expect(`${r.stdout}\n${r.stderr}`, `deep inbox answer (${how}) names ${what} in its refusal: ${shown(r)}`).toContain(what);
}
/** The calls to `sign` the test helper logged after `since`. */
export const signsSince = (rig: Rig, since: number): Call[] => calls(rig).filter((c) => c.at >= since && c.args[0] === 'sign');
/** The hub's challenge as the README defines it: the ask's handle, a revision, the prompt's words and a fresh 32-byte nonce. */
export function expectChallenge(c: Line | undefined, handle: string, how: string): Line {
  expect(c, `the hub sent the helper a challenge on stdin (${how})`).toBeTypeOf('object');
  expect(c!.ask, `the challenge (${how}) names the ask it confirms`).toBe(handle);
  expect(typeof c!.revision === 'string' && c!.revision.length > 0, `the challenge (${how}) carries the ask's revision as a string: ${JSON.stringify(c)}`).toBe(true);
  expect(typeof c!.words === 'string' && c!.words.length > 0, `the challenge (${how}) carries the prompt's words: ${JSON.stringify(c)}`).toBe(true);
  const nonce = typeof c!.nonce === 'string' ? Buffer.from(c!.nonce, 'base64url') : Buffer.alloc(0);
  expect(nonce.length === 32 && nonce.toString('base64url') === c!.nonce, `the challenge's nonce (${how}) is 32 bytes in base64url: ${JSON.stringify(c)}`).toBe(true);
  return c!;
}
