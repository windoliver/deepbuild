// Shared test-side tools for issue #1359's acceptance tests (README): throwaway homes with stand-ins for the login
// service and the service managers, the built `deep` CLI run as a child process, setup through the CLI, snapshots of a
// folder tree (paths, modes, bytes) and their differences, the commands `deep --help` lists, a fixture hub socket, the
// socket spy, a copy of the checkout with no deep-hook built, and an older Node. Parts are adapted from
// tests/acceptance/1002/helpers.ts and 572/helpers.ts (same repo, same license). Nothing here stands in for DeepBuild:
// every test reaches it through the CLI and the files under the throwaway home. Processes are stopped by PID only.

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, constants, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync,
  realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The checkout under test: this one, or the one DEEP1359_CHECKOUT names (a build of another commit, as BASE-FAILURE.txt
 * ran 3d30b4ef). Its packages/cli/dist/main.js is the `deep` every test runs, its README.md the one AC8 reads.
 */
export const CHECKOUT = realpathSync(process.env.DEEP1359_CHECKOUT || fileURLToPath(new URL('../../../', import.meta.url)));
export const CLI = join(CHECKOUT, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const SPY = join(FIXTURES, 'spy.mjs');
export const SECOND = 1000;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The CLI must be built: a test that can't run it is BLOCKED, never a pass. */
export function needBuild(): void {
  if (!existsSync(CLI)) throw Error(`BLOCKED: no built CLI at ${CLI}; run npm run build --workspaces first`);
}
/** setup's entries name the built deep-hook (#18); a checkout with none would build it, which these tests don't wait for. */
export function needHook(): void {
  if (!['release', 'debug'].some((p) => existsSync(join(CHECKOUT, 'target', p, 'deep-hook')))) {
    throw Error(`BLOCKED: no deep-hook built under ${join(CHECKOUT, 'target')}; run cargo build --locked -p deep-hook first`);
  }
}

// ---- Temp folders. Short real paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1359-'));
  made.push(dir);
  return dir;
}

/**
 * A throwaway world: `<tmp>/h` is HOME (empty: nobody set DeepBuild up there), `<tmp>/w` the working folder a command
 * runs in, and `<tmp>/bin` first on PATH with:
 * - `launcher`, the login service stand-in (fixtures/launcher.mjs): setup hands it the hub's service definition
 *   through `DEEP_HUB_LAUNCHER`, and it starts the program the definition names, logging each PID to `<tmp>/launched`;
 * - `refusing-launcher`, a login service that loads nothing and exits 1, and `launchctl` and `systemctl`, which do the
 *   same, so nothing reaches the real service manager even if the seam is ignored; each logs its call to
 *   `<tmp>/bin/calls.log`;
 * - `sh-login`, your login shell (SHELL), whose PATH is `<tmp>/bin`, Node's folder and the system's.
 * There is no `cargo` on that PATH. `<tmp>/confirm` holds `cancelled`: the OS confirmation stubbed through
 * DEEP_HUB_TEST_CONFIRM (#24), so nothing a command asks you to confirm goes through.
 */
export interface World { tmp: string; home: string; work: string; bin: string }
export function world(): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const work = join(tmp, 'w');
  const bin = join(tmp, 'bin');
  for (const dir of [home, work, bin]) mkdirSync(dir);
  for (const name of ['launchctl', 'systemctl', 'refusing-launcher']) {
    copyFileSync(join(FIXTURES, 'stub-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  const script = (name: string, text: string) => { writeFileSync(join(bin, name), text); chmodSync(join(bin, name), 0o755); };
  script('launcher', `#!/bin/sh\nprintf 'launcher %s\\n' "$*" >> '${bin}/calls.log'\nexec '${NODE}' '${join(FIXTURES, 'launcher.mjs')}' "$@"\n`);
  script('sh-login', [
    '#!/bin/sh',
    '# Your login shell, as setup reads it: the PATH a login shell sets is this one. Login and interactive flags are',
    '# dropped, so no profile of the machine running the tests is read.',
    `PATH='${bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin'; export PATH`,
    'for a; do shift; case "$a" in -l|-i|--login|-il|-li) ;; -lc|-cl|-ilc|-lic|-ic|-ci) set -- "$@" -c ;; *) set -- "$@" "$a" ;; esac; done',
    'exec /bin/sh "$@"',
    '',
  ].join('\n'));
  writeFileSync(join(tmp, 'confirm'), 'cancelled\n');
  return { tmp, home, work, bin };
}
export const rootOf = (w: World) => join(w.home, '.deepbuild');
/** What the service-manager stand-ins and the launcher were asked to do, one line a call. */
export const calls = (w: World): string[] => (existsSync(join(w.bin, 'calls.log')) ? readFileSync(join(w.bin, 'calls.log'), 'utf8').split('\n').filter(Boolean) : []);

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/**
 * The environment a child gets: HOME the world's home, the stand-ins first on PATH, a login service (`starts`, the
 * launcher, or `refuses`, the default) as `DEEP_HUB_LAUNCHER`, and no DEEP_, XDG_, CLAUDE*, CODEX*, GIT_, NODE_OPTIONS
 * or billing variable of this process's. `extra` sets or (undefined) removes more.
 */
export function childEnv(w: World, o: { hub?: 'starts' | 'refuses' | undefined; extra?: Record<string, string | undefined> | undefined } = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_|MCP_)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = w.home;
  env.XDG_CONFIG_HOME = join(w.home, '.config');
  env.XDG_CACHE_HOME = join(w.home, '.cache');
  env.SHELL = join(w.bin, 'sh-login');
  env.PATH = `${w.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  env.LC_ALL = 'C';
  env.TMPDIR = join(w.tmp, 'tmp');
  mkdirSync(env.TMPDIR, { recursive: true });
  env.DEEP_HUB_TEST_CONFIRM = join(w.tmp, 'confirm');
  env.DEEP_HUB_LAUNCHER = join(w.bin, o.hub === 'starts' ? 'launcher' : 'refusing-launcher');
  env.DEEP_TEST_LAUNCHER_LOG = join(w.tmp, 'launched');
  for (const [key, value] of Object.entries(o.extra ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
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
/** The hubs the login service stand-in started in a world, by the PIDs it logged. */
export const launched = (w: World): number[] => (existsSync(join(w.tmp, 'launched')) ? readFileSync(join(w.tmp, 'launched'), 'utf8').split('\n').map(Number).filter((pid) => pid > 0) : []);
/** Stops the hubs the launcher started in `w` (SIGTERM, then SIGKILL after 10 s) and waits for them to be gone. */
export async function stopHubs(w: World): Promise<void> {
  const pids = launched(w);
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 10 * SECOND;
  while (pids.some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  while (pids.some(alive)) await sleep(50);
}
/** Stops every process this suite started, the hubs the launcher started included, and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const dir of made) {
    const log = join(dir, 'launched');
    if (existsSync(log)) for (const pid of readFileSync(log, 'utf8').split('\n').map(Number)) if (pid > 0) own(pid);
  }
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }
/**
 * Runs a command to its end in a process group of its own, without blocking this process's event loop; at the timeout
 * the group this run made is killed (SIGKILL to its own PID's group, never by name or port).
 */
export function run(command: string, args: readonly string[], o: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number | undefined }): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, o.timeoutMs ?? 120 * SECOND);
    child.on('error', (error) => { stderr += `\n[spawn failed: ${error.message}]`; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end('');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;
/** `deep <args>` as you run it: the built CLI under a Node (this one unless `node`), in the world's working folder. */
export function deep(w: World, args: readonly string[], o: { node?: string; cli?: string; hub?: 'starts' | 'refuses'; extra?: Record<string, string | undefined>; timeoutMs?: number; cwd?: string } = {}): Promise<Ran> {
  return run(o.node ?? NODE, [o.cli ?? CLI, ...args], { env: childEnv(w, { hub: o.hub, extra: o.extra }), cwd: o.cwd ?? w.work, timeoutMs: o.timeoutMs });
}

/**
 * `deep setup` in the world, with the login service stand-in that starts the hub: setup returns once the hub answers.
 * Its hubs are stopped by PID at cleanup, or by stopHubs.
 */
export function setUp(w: World, o: { node?: string; extra?: Record<string, string | undefined> } = {}): Promise<Ran> {
  needHook();
  return deep(w, ['setup'], { hub: 'starts', timeoutMs: 180 * SECOND, ...o });
}

// ---- Snapshots of a folder tree: every path under it with its type, mode and bytes (or link target).
/** A path's type, permission bits and bytes (a file's SHA-256, a link's target); `born` and `written` are its file times. */
export interface Entry { type: 'file' | 'dir' | 'link' | 'socket' | 'other'; mode: number; digest: string; born: number; written: number }
export type Snapshot = Map<string, Entry>;
export function snapshot(dir: string): Snapshot {
  const out: Snapshot = new Map();
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      let s;
      try { s = lstatSync(path); } catch { continue; /* gone while read */ }
      const rel = relative(dir, path);
      const t = { born: s.birthtimeMs || s.mtimeMs, written: s.mtimeMs };
      if (s.isSymbolicLink()) out.set(rel, { type: 'link', mode: s.mode & 0o7777, digest: readlinkSync(path), ...t });
      else if (s.isDirectory()) { out.set(rel, { type: 'dir', mode: s.mode & 0o7777, digest: '', ...t }); walk(path); }
      else if (s.isFile()) {
        let digest = '';
        try { digest = createHash('sha256').update(readFileSync(path)).digest('hex'); } catch (e) { digest = `unreadable: ${(e as Error).message}`; }
        out.set(rel, { type: 'file', mode: s.mode & 0o7777, digest, ...t });
      } else out.set(rel, { type: s.isSocket() ? 'socket' : 'other', mode: s.mode & 0o7777, digest: '', ...t });
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}
export interface Change { path: string; what: 'added' | 'removed' | 'changed'; at: number; dir: boolean }
/** What changed from `before` to `after`, the first written first (by its file times). */
export function changes(before: Snapshot, after: Snapshot): Change[] {
  const out: Change[] = [];
  for (const [path, entry] of after) {
    const was = before.get(path);
    if (!was) out.push({ path, what: 'added', at: entry.born, dir: entry.type === 'dir' });
    else if (was.type !== entry.type || was.mode !== entry.mode || was.digest !== entry.digest) out.push({ path, what: 'changed', at: entry.written, dir: entry.type === 'dir' });
  }
  for (const [path, entry] of before) if (!after.has(path)) out.push({ path, what: 'removed', at: Number.POSITIVE_INFINITY, dir: entry.type === 'dir' });
  return out.sort((a, b) => a.at - b.at || a.path.localeCompare(b.path));
}
/** One line naming the first file written under `label` and how many paths changed; empty when none did. */
export function changeLine(label: string, list: Change[]): string {
  if (!list.length) return '';
  // The first file: a folder made to hold it is no file written.
  const first = list.find((c) => c.what !== 'removed' && !c.dir) ?? list[0]!;
  return `${label}: the first file written was ${first.path} (${first.what}); ${list.length} path${list.length === 1 ? '' : 's'} changed in all: ${list.slice(0, 12).map((c) => `${c.what} ${c.path}`).join(', ')}${list.length > 12 ? ', ...' : ''}`;
}

// ---- The commands `deep --help` lists.
/** The text up to the usage's first `|` at bracket depth 0, and so on: a synopsis's alternatives. */
function alternatives(synopsis: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of synopsis) {
    if (ch === '[' || ch === '<') depth++;
    if (ch === ']' || ch === '>') depth = Math.max(0, depth - 1);
    if (ch === '|' && depth === 0) { out.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  out.push(current.trim());
  return out;
}
const WORD = /^[a-z][a-z0-9-]*$/;
/**
 * Every command `deep --help` lists, as its words (`['hub', 'start']`): each usage line `deep <synopsis>  <what it
 * does>`, its synopsis split into alternatives at `|`. A command's words are the leading plain lowercase words of its
 * alternative; a later alternative replaces the last word of a two-word command (`hub run | start`), or of a one-word
 * one with nothing after it (`off | on`), and follows a one-word command that takes arguments (`numbers [--json] |
 * refresh`). An alternative that starts with a flag or a placeholder names no new command.
 */
export function listedCommands(help: string): string[][] {
  const seen = new Map<string, string[]>();
  for (const line of help.split('\n')) {
    const m = /^\s*(?:Usage:\s*)?deep\s+(.*)$/.exec(line);
    if (!m) continue;
    const synopsis = m[1]!.split(/\s{2,}/)[0]!.trim();
    const alts = alternatives(synopsis);
    const tokens0 = alts[0]!.split(/\s+/).filter(Boolean);
    const first: string[] = [];
    for (const t of tokens0) { if (!WORD.test(t)) break; first.push(t); }
    if (!first.length) continue;
    const takesArgs = tokens0.length > first.length;
    const add = (words: string[]) => seen.set(words.join(' '), words);
    add(first);
    for (const alt of alts.slice(1)) {
      const words: string[] = [];
      for (const t of alt.split(/\s+/).filter(Boolean)) { if (!WORD.test(t)) break; words.push(t); }
      if (!words.length) continue;
      if (first.length >= 2) add([...first.slice(0, -1), ...words]);
      else if (takesArgs) add([...first, ...words]);
      else add(words);
    }
  }
  return [...seen.values()];
}
/** `deep --help`'s output, read once per checkout from a fresh world. */
let helpText: Promise<string> | undefined;
export function help(): Promise<string> {
  return (helpText ??= (async () => {
    needBuild();
    const w = world();
    const r = await deep(w, ['--help'], { timeoutMs: 60 * SECOND });
    if (r.code !== 0 || !r.stdout.includes('deep ')) throw Error(`BLOCKED: deep --help didn't print the commands to list: ${shown(r)}`);
    return r.stdout;
  })());
}

// ---- A fixture hub: a socket at the hub's address that notes each connection and closes it at once.
export interface FixtureHub { path: string; connections: number; close(): Promise<void> }
export async function fixtureHub(path: string): Promise<FixtureHub> {
  rmSync(path, { force: true });
  mkdirSync(dirname(path), { recursive: true });
  const hub: FixtureHub = { path, connections: 0, close: () => new Promise<void>((done) => server.close(() => done())) };
  const server = net.createServer((sock) => { hub.connections++; sock.destroy(); });
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(path, () => done()); });
  return hub;
}

// ---- The socket spy (fixtures/spy.mjs), in every Node process a command starts.
export function spyEnv(log: string): Record<string, string> {
  return { NODE_OPTIONS: `--import=${pathToFileURL(SPY).href}`, DEEP1359_SPY_LOG: log };
}
export const spied = (log: string): string[] => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);

// ---- A copy of the checkout with no deep-hook built (AC7).
/**
 * The checkout under test copied to `<tmp>/checkout` without target/ (so no deep-hook is built there), .git, docs/ and
 * tests/; its node_modules is a folder of links: each workspace package's link as the checkout has it (relative, so it
 * leads to the copy's own packages), every other package linked to the checkout's. The copy's CLI is its
 * packages/cli/dist/main.js; the hub it loads finds its checkout, and deep-hook, from where it runs.
 */
export function hooklessCheckout(): { dir: string; cli: string } {
  const tmp = tempDir();
  const dir = join(tmp, 'checkout');
  const skip = new Set(['target', 'node_modules', '.git', 'docs', 'tests']);
  mkdirSync(dir);
  for (const name of readdirSync(CHECKOUT)) {
    if (skip.has(name)) continue;
    cpSync(join(CHECKOUT, name), join(dir, name), { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
  }
  const link = (from: string, to: string) => {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
      const path = join(from, name);
      const s = lstatSync(path);
      if (s.isSymbolicLink() && !isAbsolute(readlinkSync(path))) symlinkSync(readlinkSync(path), join(to, name));
      else if (name.startsWith('@') && s.isDirectory()) link(path, join(to, name));
      else symlinkSync(path, join(to, name));
    }
  };
  link(join(CHECKOUT, 'node_modules'), join(dir, 'node_modules'));
  const cli = join(dir, 'packages/cli/dist/main.js');
  if (!existsSync(cli)) throw Error(`BLOCKED: the copy of the checkout has no built CLI at ${cli}`);
  return { dir, cli };
}

// ---- A Node older than the CLI's engines field (AC6).
/** The version the CLI's engines field names (`>=24.22.0` → `24.22.0`). */
export function enginesNode(): string {
  const engines = (JSON.parse(readFileSync(join(CHECKOUT, 'packages/cli/package.json'), 'utf8')) as { engines?: { node?: string } }).engines?.node;
  if (!engines) throw Error(`BLOCKED: ${join(CHECKOUT, 'packages/cli/package.json')} names no engines.node`);
  return engines.replace(/^>=\s*/, '').trim();
}
const older = (version: string, than: string) => version.localeCompare(than, undefined, { numeric: true }) < 0;
/**
 * A real Node older than the engines field: DEEP1359_OLD_NODE if it names one, else the first older one among
 * Homebrew's, /usr/local's, and the versions fnm and nvm keep. Undefined when this machine has none.
 */
export function olderNode(): { node: string; version: string } | undefined {
  const needed = enginesNode();
  const list = (dir: string, tail: string) => { try { return readdirSync(dir).map((v) => join(dir, v, tail)); } catch { return []; } };
  const home = homedir();
  const candidates = [
    process.env.DEEP1359_OLD_NODE,
    '/opt/homebrew/bin/node', '/usr/local/bin/node',
    ...list('/opt/homebrew/opt', 'bin/node').filter((p) => /\/opt\/node(@[^/]+)?\/bin\/node$/.test(p)),
    ...list(join(home, '.local/share/fnm/node-versions'), 'installation/bin/node'),
    ...list(join(home, '.nvm/versions/node'), 'bin/node'),
  ].filter((p): p is string => !!p && existsSync(p));
  for (const node of candidates) {
    try {
      const version = execFileSync(node, ['-p', 'process.versions.node'], { encoding: 'utf8', timeout: 10_000 }).trim();
      if (version && older(version, needed)) return { node, version };
    } catch { /* not a Node that runs */ }
  }
  return undefined;
}

/** The login service definition setup wrote in the world's home: the program it starts, as its words. */
export function serviceProgram(w: World): { file: string; argv: string[] } {
  const plist = join(w.home, 'Library', 'LaunchAgents', 'com.deepbuild.hub.plist');
  const unit = join(w.home, '.config', 'systemd', 'user', 'deepbuild-hub.service');
  const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  if (existsSync(plist)) {
    const args = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(readFileSync(plist, 'utf8'));
    return { file: plist, argv: args ? [...args[1]!.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unxml(m[1]!)) : [] };
  }
  if (existsSync(unit)) {
    const exec = /^ExecStart=(.*)$/m.exec(readFileSync(unit, 'utf8'));
    const words = [...(exec?.[1] ?? '').matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] ?? m[3]!));
    return { file: unit, argv: words };
  }
  return { file: plist, argv: [] };
}
