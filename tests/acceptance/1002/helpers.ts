// Shared test-side tools for issue #1002 (README): temp homes with stand-ins for the login service, systemctl,
// launchctl, claude and your login shell; the first `deep` command and `deep setup` through the built CLI; the app's
// Set up (`deep-app --set-up`, #326's surface) and its first screen headless (`deep-replica --first-screen`, pinned
// here); the finished record; and the judges of the first screen. Adapted from tests/acceptance/326/setup/helpers.ts
// (same repo, same license); this suite keeps its own copy so a redraft of #326's never moves these tests. Nothing
// here stands in for DeepBuild: every test reaches it through the CLI, the app binary, the replica binary and the
// files under the temporary home. The planted wrong programs in twins/ stand in for those binaries only in the tests
// that say so.

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
/** The app as `cargo build -p deep-app` builds it from the checkout (R1: "built from the checkout"). */
export const APP = join(REPO, 'target/debug/deep-app');
/** The replica as `cargo build -p deep-replica --bin deep-replica` builds it. */
export const REPLICA = join(REPO, 'target/debug/deep-replica');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const TWINS = fileURLToPath(new URL('./twins/', import.meta.url));
/** Where the person's taste call on the screenshots is recorded (README: the taste call). */
export const TASTE = join(REPO, 'docs/evidence/1002/taste.json');
export const NODE = process.execPath;

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
export const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

/** The app and the replica draw on macOS only; elsewhere these tests can't run, which is BLOCKED, never a pass. */
export function onMac(): void {
  if (process.platform !== 'darwin') throw Error(`BLOCKED: the app and its replica draw on macOS only; this is ${process.platform}`);
}

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/da1002-'));
  made.push(dir);
  return dir;
}
/**
 * A fresh home: `<tmp>/h` is HOME for every process a test starts, so `~/.deepbuild`, `~/.claude`, `~/.claude.json`,
 * `~/.config/systemd` and `~/Library/LaunchAgents` are under `<tmp>/h`, and nothing of DeepBuild is installed there.
 * `<tmp>/bin` comes first on PATH with:
 * - `launcher`, the login service stand-in (fixtures/launcher.mjs, #16's): setup hands it the hub's service
 *   definition through the merged seam `DEEP_HUB_LAUNCHER`, and it starts the program the definition names, logging
 *   each PID to `<tmp>/launched`;
 * - `dead-launcher`, a login service that takes the definition, exits 0 and starts nothing: a hub that doesn't start;
 * - `launchctl`, `systemctl` and `claude`, which log their call to `<tmp>/bin/calls.log` and exit 0, so nothing reaches
 *   the real service manager even if the seam is ignored (then no hub starts and the tests fail, never pass);
 * - `sh-login`, your login shell (SHELL), whose PATH is `<tmp>/bin`, Node's folder and the system's;
 * - `deep`, the built CLI.
 * `<tmp>/confirm` holds `confirmed`: the OS confirmation stubbed through DEEP_HUB_TEST_CONFIRM (#24), never asked here.
 */
export interface Home { tmp: string; home: string; bin: string }
export function makeHome(): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin);
  for (const name of ['systemctl', 'launchctl', 'claude']) {
    copyFileSync(join(FIXTURES, 'stub-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'claude.version'), '2.1.0\n');
  const script = (name: string, text: string) => { writeFileSync(join(bin, name), text); chmodSync(join(bin, name), 0o755); };
  script('launcher', `#!/bin/sh\nprintf 'launcher %s\\n' "$*" >> '${bin}/calls.log'\nexec '${NODE}' '${join(FIXTURES, 'launcher.mjs')}' "$@"\n`);
  script('dead-launcher', `#!/bin/sh\nprintf 'dead-launcher %s\\n' "$*" >> '${bin}/calls.log'\nexit 0\n`);
  script('deep', `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`);
  script('sh-login', [
    '#!/bin/sh',
    '# Your login shell, as setup reads it: the PATH a login shell sets is this one. Login and interactive flags are',
    '# dropped, so no profile of the machine running the tests is read.',
    `PATH='${bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin'; export PATH`,
    'for a; do shift; case "$a" in -l|-i|--login|-il|-li) ;; -lc|-cl|-ilc|-lic|-ic|-ci) set -- "$@" -c ;; *) set -- "$@" "$a" ;; esac; done',
    'exec /bin/sh "$@"',
    '',
  ].join('\n'));
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  return { tmp, home, bin };
}
export const rootOf = (home: string) => join(home, '.deepbuild');
export const settingsFile = (home: string) => join(home, '.claude', 'settings.json');
export const binOf = (home: string) => join(dirname(home), 'bin');
/** The record that setup finished, pinned here (README: The finished record). */
export const recordFile = (home: string) => join(rootOf(home), 'setup-finished.json');
export const socketOf = (home: string) => join(rootOf(home), 'hub.sock');

/** Claude Code's settings file in a state no JSON parser reads: an object cut off after its first key. */
export const UNPARSEABLE = '{\n  "hooks": \n';
export function breakSettings(home: string): void {
  mkdirSync(dirname(settingsFile(home)), { recursive: true });
  writeFileSync(settingsFile(home), UNPARSEABLE);
}
/** The file fixed: valid JSON, your own setting in it. */
export function fixSettings(home: string): void {
  mkdirSync(dirname(settingsFile(home)), { recursive: true });
  writeFileSync(settingsFile(home), '{\n  "theme": "light"\n}\n');
}

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
export function own(pid: number | undefined | null): void {
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
/** Stops every process this suite started, the hubs the login service stand-in started included (SIGTERM, then SIGKILL after 3 s), and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const dir of made) {
    const log = join(dir, 'launched');
    if (existsSync(log)) for (const pid of readFileSync(log, 'utf8').split('\n').map(Number)) if (pid > 0) own(pid);
  }
  for (const pid of owned) {
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
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/**
 * The environment a child gets: HOME the test's home, the stand-ins first on PATH, the login service stand-in as
 * `DEEP_HUB_LAUNCHER` (`launcher` unless `hub: 'dead'`), no DEEP_, CLAUDE*, CODEX*, GIT_ or billing variable of this
 * process's.
 */
export function childEnv(home: string, o: { hub?: 'starts' | 'dead' } = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.SHELL = join(binOf(home), 'sh-login');
  env.PATH = `${binOf(home)}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  env.LC_ALL = 'C';
  env.DEEP_HUB_TEST_CONFIRM = join(dirname(home), 'confirm');
  env.DEEP_HUB_LAUNCHER = join(binOf(home), o.hub === 'dead' ? 'dead-launcher' : 'launcher');
  env.DEEP_TEST_LAUNCHER_LOG = join(dirname(home), 'launched');
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }
export function run(command: string, args: readonly string[], o: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 180_000);
    child.on('error', (error) => { stderr += `\n[spawn failed: ${error.message}]`; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end('');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;

// ---- Builds: setup's entries run the built deep-hook (#18); the click is the built app's, the first screen the replica's.
const builds = new Map<string, Promise<void>>();
function cargoBuild(...args: string[]): Promise<void> {
  const key = args.join(' ');
  let build = builds.get(key);
  if (!build) {
    build = run('cargo', ['build', '--locked', '-q', ...args], { cwd: REPO, env: process.env, timeoutMs: 1_800_000 }).then((r) => {
      if (r.code !== 0) throw Error(`BLOCKED: cargo build ${key} failed: ${r.stderr.slice(-3000)}`);
    });
    builds.set(key, build);
  }
  return build;
}
export const buildHook = () => cargoBuild('-p', 'deep-hook');
const buildApp = () => cargoBuild('-p', 'deep-app', '--bin', 'deep-app');
const buildReplica = () => cargoBuild('-p', 'deep-replica', '--bin', 'deep-replica');

/**
 * `deep <args>`, HOME the test's home, in the temp folder (outside every repo). `twin` names a planted wrong program
 * in twins/ that stands in for the CLI; `hub: 'dead'` gives setup a login service that starts no hub.
 */
export async function deep(home: string, args: readonly string[], o: { twin?: string | undefined; hub?: 'starts' | 'dead' } = {}): Promise<Ran> {
  await buildHook();
  const [command, argv] = o.twin ? [join(TWINS, o.twin), args] : [NODE, [CLI, ...args]];
  return run(command, argv, { env: childEnv(home, { hub: o.hub ?? 'starts' }), cwd: dirname(home) });
}
/** The app's Set up, headless: `deep-app --set-up` (#326's pinned surface: the action the Set up button's click runs). */
export async function appSetUp(home: string, o: { hub?: 'starts' | 'dead' } = {}): Promise<Ran> {
  onMac();
  await buildHook();
  await buildApp();
  return run(APP, ['--set-up'], { env: childEnv(home, { hub: o.hub ?? 'starts' }), cwd: dirname(home) });
}

// ---- The app's first screen (README: Pinned here, 2).
export interface Screen { snapshot: Line; nodes: Line[]; names: string[]; menuBar: string; png: string; ran: Ran }
/**
 * Reopening the app: `deep-replica --first-screen --out <out> --appearance light`, HOME the test's home, in the temp
 * folder. It writes `<out>/snapshots/first-screen.json`, `<out>/screens/first-screen.png` and `<out>/menu-bar.txt`.
 * `twin` names a planted first screen in twins/first-screen.mjs (its mode), run in the replica's place.
 */
export async function firstScreen(home: string, out: string, o: { twin?: string } = {}): Promise<Screen> {
  const args = ['--first-screen', '--out', out, '--appearance', 'light'];
  let ran: Ran;
  if (o.twin) {
    ran = await run(NODE, [join(TWINS, 'first-screen.mjs'), o.twin, ...args], { env: childEnv(home), cwd: dirname(home) });
  } else {
    onMac();
    await buildReplica();
    ran = await run(REPLICA, args, { env: childEnv(home), cwd: dirname(home) });
  }
  const who = '#1002 reopening the app (deep-replica --first-screen)';
  if (ran.code !== 0) expect.fail(`${who} must draw the app's first screen for this home and exit 0: ${shown(ran)}`);
  const file = join(out, 'snapshots', 'first-screen.json');
  const png = join(out, 'screens', 'first-screen.png');
  const bar = join(out, 'menu-bar.txt');
  for (const f of [file, png, bar]) if (!existsSync(f)) expect.fail(`${who} must write ${f}: it didn't (${shown(ran)})`);
  const snapshot = parseObject(readFileSync(file, 'utf8'));
  if (!snapshot || typeof snapshot.tree !== 'object') expect.fail(`${who}: ${file} is not a snapshot with a tree`);
  const nodes: Line[] = [];
  const walk = (n: Line) => { nodes.push(n); for (const c of Array.isArray(n.children) ? n.children : []) walk(c as Line); };
  walk(snapshot.tree as Line);
  const names = nodes.flatMap((n) => [n.name, n.value]).filter((v): v is string => typeof v === 'string');
  return { snapshot, nodes, names, menuBar: readFileSync(bar, 'utf8').trim(), png, ran };
}

const ZERO = /(^|[^\d])0 (asks? needs? you|waiting on you)\b/i;
const DIDNT_FINISH = /set ?up did(n['’]t| not) finish/i;
/**
 * The count on a first screen whose setup didn't finish: it reads setup didn't finish, never 0, in the window and in
 * the menu bar. Judged first, so a first screen that opens on "0 asks need you" fails naming the count.
 */
export function countReadsDidntFinish(s: Screen): void {
  const zero = s.names.find((n) => ZERO.test(n));
  if (zero !== undefined) expect.fail(`#1002 the count must read setup didn't finish, never 0: the first screen reads ${JSON.stringify(zero)}`);
  if (s.menuBar === '' || /^\d+$/.test(s.menuBar)) expect.fail(`#1002 the count must read setup didn't finish, never 0: the menu bar reads ${JSON.stringify(s.menuBar)}`);
  if (!s.names.some((n) => DIDNT_FINISH.test(n))) expect.fail(`#1002 the count must read setup didn't finish: no node of the first screen says so; its names are ${JSON.stringify(s.names.slice(0, 60))}`);
}
/** The one Set up button, as #326 names it: role button, name "Set up". */
export const offersSetUp = (s: Screen): boolean => s.nodes.some((n) => n.role === 'button' && n.name === 'Set up');
/**
 * A first screen after a setup that stopped: the count reads setup didn't finish, never 0; the Set up button is offered
 * again; and the reason is shown with its fix. `why` is the case: the settings file (`file`, named by its path or as
 * `~/.claude/settings.json`, and a fix), or the hub that didn't start (the hub and its start).
 */
export function offeredAgain(s: Screen, why: { file: string } | 'hub'): void {
  countReadsDidntFinish(s);
  if (!offersSetUp(s)) expect.fail(`#1002 reopening the app must offer Set up again while setup hasn't finished: no button named "Set up"; the first screen's names are ${JSON.stringify(s.names.slice(0, 60))}`);
  const text = s.names.join('\n');
  if (why === 'hub') {
    if (!/\bhub\b/i.test(text) || !/start/i.test(text)) expect.fail(`#1002 reopening the app must show why setup stopped: that the hub didn't start; the first screen's names are ${JSON.stringify(s.names.slice(0, 60))}`);
    return;
  }
  if (!text.includes(why.file) && !text.includes('~/.claude/settings.json')) expect.fail(`#1002 reopening the app must show why setup stopped, naming ${why.file}; the first screen's names are ${JSON.stringify(s.names.slice(0, 60))}`);
  if (!/\bfix/i.test(text)) expect.fail(`#1002 reopening the app must show the reason's fix (fix the file); the first screen's names are ${JSON.stringify(s.names.slice(0, 60))}`);
}
/** The reference window (design, Decided: The reference window): 1512 × 982 points at 2×. */
export function atReferenceWindow(s: Screen): void {
  const size = s.snapshot.window?.size;
  const scale = s.snapshot.window?.scale;
  if (!Array.isArray(size) || size[0] !== 1512 || size[1] !== 982 || scale !== 2) expect.fail(`#1002 the first screen must be drawn at the reference window, 1512 x 982 points at 2x: its snapshot says ${JSON.stringify(s.snapshot.window)}`);
  const bytes = readFileSync(s.png);
  const png = bytes.subarray(1, 4).toString('latin1') === 'PNG' && bytes.subarray(12, 16).toString('latin1') === 'IHDR';
  const [w, h] = png ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : [0, 0];
  if (w !== 3024 || h !== 1964) expect.fail(`#1002 the first screen's screenshot must be the reference window at 2x, 3024 x 1964 pixels: ${s.png} is ${png ? `${w} x ${h}` : 'not a PNG'}`);
}

// ---- The finished record, and what the next command must leave alone.
/** `deep --version`: the version a finished record names. */
export async function deepVersion(home: string): Promise<string> {
  const r = await run(NODE, [CLI, '--version'], { env: childEnv(home), cwd: dirname(home) });
  if (r.code !== 0 || !r.stdout.trim()) throw Error(`BLOCKED: deep --version didn't answer: ${shown(r)}`);
  return r.stdout.trim();
}
/** A setup that stopped leaves no finished record. */
export function noRecord(home: string, who: string): void {
  if (existsSync(recordFile(home))) expect.fail(`#1002 ${who} stopped, so it must leave no record that it finished, but ${recordFile(home)} holds ${JSON.stringify(readFileSync(recordFile(home), 'utf8').slice(0, 300))}`);
}
/** A setup that finished wrote its record, a JSON object whose `version` is DeepBuild's, `deep --version`. */
export async function finishedRecord(home: string, who: string): Promise<void> {
  if (!existsSync(recordFile(home))) expect.fail(`#1002 ${who} finished, so it must write its record ${recordFile(home)} as its last step; there is none (in ${rootOf(home)}: ${existsSync(rootOf(home)) ? execFileSync('ls', [rootOf(home)], { encoding: 'utf8' }).split('\n').join(' ') : 'nothing'})`);
  const record = parseObject(readFileSync(recordFile(home), 'utf8'));
  const version = await deepVersion(home);
  if (!record || record.version !== version) expect.fail(`#1002 ${who}'s record must name its version, ${JSON.stringify(version)} (deep --version): ${recordFile(home)} holds ${JSON.stringify(readFileSync(recordFile(home), 'utf8').slice(0, 300))}`);
}
/** The files setup writes, the record among them, each with its text ('' when absent). */
export const written = (home: string): Record<string, string> => Object.fromEntries(
  [settingsFile(home), join(home, '.claude.json'), join(rootOf(home), 'rules.json'), join(rootOf(home), 'config.json'), recordFile(home)]
    .map((f) => [f, existsSync(f) ? readFileSync(f, 'utf8') : '']));
export const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);
/**
 * "Says so in one line" (#326's pinned surface, which a first command that sets up still keeps): exactly one non-empty
 * line on stderr, naming the hooks, watch-only, the hub and `deep setup --undo`.
 */
export function saidSetUp(who: string, text: string): void {
  const said = lines(text);
  if (said.length !== 1) expect.fail(`${who} must set DeepBuild up and say so in one line on stderr; it said ${said.length} lines: ${JSON.stringify(text.slice(0, 1500))}`);
  for (const [what, pattern] of [['the hooks', /hook/i], ['watch-only mode', /watch[- ]only/i], ['the hub', /\bhub\b/i], ['how to remove it (deep setup --undo)', /deep setup --undo/]] as const) {
    if (!pattern.test(said[0]!)) expect.fail(`${who}'s one line must say ${what}: ${JSON.stringify(said[0])}`);
  }
}
/** Once setup finished, a `deep` command runs no setup: it says nothing about setup and rewrites none of its files. */
export function ranNoSetup(who: string, ran: Ran, before: Record<string, string>, after: Record<string, string>): void {
  if (ran.code !== 0) expect.fail(`#1002 ${who} must do its own job, exit 0, once setup finished: ${shown(ran)}`);
  if (lines(ran.stderr).some((l) => /watch[- ]only|deep setup --undo|deep setup:/i.test(l))) expect.fail(`#1002 once setup finished, ${who} must run no setup: it said ${JSON.stringify(ran.stderr.slice(0, 1000))}`);
  const changed = Object.keys(before).filter((f) => before[f] !== after[f]);
  if (changed.length) expect.fail(`#1002 once setup finished, ${who} must run no setup: it wrote ${changed.join(', ')} again`);
}

// ---- The hub the login service started.
export function answers(path: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(path);
    const done = (v: boolean) => { clearTimeout(timer); sock.destroy(); resolve(v); };
    const timer = setTimeout(() => done(false), timeoutMs);
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => { if (d.includes('\n')) done(true); });
    sock.on('error', () => done(false));
  });
}
/** Waits for the hub to answer at `~/.deepbuild/hub.sock`; fails naming `who` otherwise. */
export async function hubAnswers(home: string, who: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await answers(socketOf(home))) return;
    await sleep(200);
  }
  expect.fail(`#1002 ${who} finished, so the hub must answer at ${socketOf(home)}; none did within ${timeoutMs / 1000} s`);
}

// ---- The taste call on the screenshots (README: The taste call).
/**
 * Whether the screenshots look right is one taste call, a person's, recorded in `file` (docs/evidence/1002/taste.json):
 * `{"criterion": "#1002.1f6f1740", "call": "looks right" | "looks wrong", "by": <who>, "at": <when>, "screens":
 * {<file name>: <sha256 of its bytes>}}`. With none on exactly these screenshots the run is INCONCLUSIVE, never a pass;
 * a call that they don't look right fails.
 */
export function tasteCall(screens: Record<string, string>, where: string, file = TASTE): void {
  const these = `these screenshots (${Object.keys(screens).join(', ')} in ${where})`;
  if (!existsSync(file)) throw Error(`INCONCLUSIVE: no taste call is recorded at ${file} on ${these}; whether they look right is a person's call`);
  const call = parseObject(readFileSync(file, 'utf8'));
  if (!call || call.criterion !== '#1002.1f6f1740') throw Error(`INCONCLUSIVE: ${file} is not a taste call on #1002.1f6f1740`);
  if (typeof call.by !== 'string' || !call.by.trim()) throw Error(`INCONCLUSIVE: the taste call at ${file} names no person who made it`);
  for (const [name, digest] of Object.entries(screens)) {
    if (call.screens?.[name] !== digest) throw Error(`INCONCLUSIVE: the taste call at ${file} is on other screenshots than ${these}: ${name} is ${digest}, the call names ${JSON.stringify(call.screens?.[name] ?? null)}`);
  }
  if (call.call !== 'looks right') expect.fail(`#1002 the recorded taste call says the screenshots don't look right: ${JSON.stringify(call.call)}${call.note ? `, ${JSON.stringify(call.note)}` : ''}`);
}
