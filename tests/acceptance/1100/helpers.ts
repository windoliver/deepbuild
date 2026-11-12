// Test-side tools for #1100 (README): a fixture machine (a temp home with stand-ins for the login service, `claude`,
// `codex`, `paseo`, `cargo` and your login shell, and the `deep` the app runs), the first `deep` command through the
// built CLI, the replica (`deep-drive`) driven over its stdin, the hub's socket, and one judge per criterion. Patterns
// adapted from tests/acceptance/1002, 1461, 1556 and 1998 (same repo, same license); this suite keeps its own copy so a
// redraft there never moves these tests. Nothing here stands in for DeepBuild: every judge reads what the built CLI, the
// replica, the hub's record or the files under the temp home show.
//
// Safety: every folder is under /tmp/da1100-*; HOME is a temp home for every process started, so no real ~/.deepbuild,
// ~/.claude, ~/.codex, ~/.paseo or ~/Library is read or written; no child inherits this process's DEEP_*, CLAUDE*,
// CODEX*, XDG_*, GIT_* or billing variables; every process is stopped by its PID, never by name or port. No agent runs:
// `claude`, `codex` and `paseo` are stubs that log their arguments and exit 0.
import { execFile, execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { askData, ulid } from '../26/helpers.ts';
import { rowSet, type Row } from '../1461/helpers.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const FIXTURES = join(SUITE, 'fixtures');
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const MIN = 60_000;
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
export const said = (v: unknown, n = 300): string => (JSON.stringify(v) ?? String(v)).slice(0, n);
export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };

/** The criteria, by `#1100.<first 8 hex of SHA-256(text, trimmed, white space collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  agents: '#1100.09a72dfd',
  oneButton: '#1100.919771a4',
  undo: '#1100.f7be8897',
  words: '#1100.7caad132',
  stops: '#1100.bde8557a',
  opens: '#1100.dbc87baa',
  notifications: '#1100.51fb49b2',
  firstCommand: '#1100.5f1d5581',
  guards: '#1100.c0eb6fe9',
  noTrace: '#1100.fb98dd92',
  stdout: '#1100.0bc0935d',
  slowStep: '#1100.ccd14b19',
  busy: '#1100.ac11c199',
  leaves: '#1100.da894c8b',
  shown: '#1100.616f99b5',
} as const;

/** The plants this suite selects with DEEP_HUB_PLANT (README, Pinned here 6 and 7). */
export const PLANT = {
  writtenList: 'first-launch-written-list',
  secondOption: 'first-launch-second-option',
  missingRoute: 'undo-line-missing-route',
  pretooluse: 'first-launch-pretooluse',
  staysOnFirstLaunch: 'stays-on-first-launch',
  asksAtFirstPost: 'notifications-asked-at-first-post',
  printsOutput: 'set-up-prints-output',
  hidesButton: 'set-up-hides-button',
  startsTwice: 'set-up-starts-twice',
  nothingLeaves: 'first-launch-nothing-leaves',
  saysNothingBlocks: 'set-up-line-says-nothing-blocks',
  lineToStdout: 'set-up-line-to-stdout',
  silentSteps: 'silent-steps',
} as const;

// ---- Temp folders under /tmp (a socket path must fit in 104 bytes) and the processes this suite started.

const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/da1100-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
export const own = (pid: number | undefined | null): void => { if (pid) owned.add(pid); };
function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
/** Every folder under `dir` made writable again: the wiki folder a fixture made read-only must go with the rest. */
function writable(dir: string): void {
  try { if (!lstatSync(dir).isDirectory()) return; chmodSync(dir, 0o700); } catch { return; }
  for (const name of readdirSync(dir)) writable(join(dir, name));
}
/** Stops every process this suite started, the hubs the login service stand-in started included (SIGTERM, then SIGKILL after 3 s), and removes the temp folders. */
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
  for (const dir of made.splice(0)) { writable(dir); rmSync(dir, { recursive: true, force: true }); }
}

/** The replica and the app draw on macOS only; elsewhere these tests can't run, which is BLOCKED, never a pass. */
export function onMac(): void {
  if (process.platform !== 'darwin') blocked(`the app and its replica draw on macOS only; this is ${process.platform}`);
}

// ---- The fixture machine (README, The fixture machine).

const newest = (facts: string): string => { const v = (JSON.parse(readFileSync(join(REPO, 'adapters', facts), 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; };
/** Your Claude Code user settings, by hand: tabs, a space before a colon, your status line and hooks, no newline at the end. */
export const MY_SETTINGS = '{\n\t"model" : "opus",\n\t"statusLine": {"type": "command", "command": "/bin/echo my-status", "padding": 0},\n\t"hooks": {\n\t\t"Stop": [ { "hooks": [ { "type": "command", "command": "/bin/echo my-stop" } ] } ]\n\t}\n}';
/** Your ~/.claude.json, Claude Code's own state with your MCP server. */
export const MY_CLAUDE_JSON = '{"numStartups": 12, "theme": "dark",\n "mcpServers": {"notes": {"type": "stdio", "command": "/usr/bin/true", "args": ["--notes"]}}\n}\n';
/** Your Codex hooks, by hand: your own guard and stop. */
export const MY_CODEX_HOOKS = '{\n  "hooks": {\n    "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "/bin/echo my-codex-guard", "timeout": 15 } ] } ],\n    "Stop": [ { "hooks": [ { "type": "command", "command": "/bin/echo my-codex-stop" } ] } ]\n  }\n}\n';
/** Your Codex config.toml: settings, a comment and your MCP server. */
export const MY_CODEX_CONFIG = '# my codex settings\nmodel = "gpt-5.5"\napproval_policy = "on-request"\n\n[mcp_servers.notes]\ncommand = "/usr/bin/true"\nargs = ["--notes"]\n';
/** Claude Code's settings file in a state no JSON parser reads: an object cut off after its first key. */
export const UNPARSEABLE = '{\n  "hooks": \n';

export interface Machine {
  /** Claude Code installed: `claude` on the login shell's PATH, `~/.claude/settings.json` and `~/.claude.json` yours. Default true. */
  claude?: boolean;
  /** Codex installed: `codex` on the login shell's PATH, `~/.codex/config.toml` and `~/.codex/hooks.json` yours. Default true. */
  codex?: boolean;
  /** A session of each installed agent in its history, so setup has history to read. */
  history?: boolean;
  /** `paseo` on the PATH, a second tool setup reports on. */
  paseo?: boolean;
  /** Claude Code's settings file unparseable. */
  brokenSettings?: boolean;
  /** The `deep` the app runs from the login shell's PATH: the built CLI (default); `slow`, whose `deep setup` takes 5 s; `trace`, whose `deep setup` fails with fixtures/trace.txt. */
  deep?: 'cli' | 'slow' | 'trace';
  /** The login service: it starts the hub (default), or first makes `~/.deepbuild/wiki` a folder nobody may write. */
  hub?: 'starts' | 'wiki-refused';
  /** A `cargo` whose build of deep-hook takes 5 s and then puts this deep-hook in place. */
  cargo?: string;
}
/** `<tmp>/h` is HOME; `<tmp>/bin` comes first on PATH; `<tmp>/deep.log` and `<tmp>/cargo.log` are what the stand-ins logged. */
export interface Home { tmp: string; home: string; bin: string; deepLog: string; cargoLog: string; machine: Machine }

/**
 * A fixture machine with nothing of DeepBuild on it. `<tmp>/bin` holds: `node` (this Node), `launcher` (the login service
 * stand-in, fixtures/launcher.mjs through the merged seam DEEP_HUB_LAUNCHER, logging each hub's PID to `<tmp>/launched`),
 * `launchctl` and `systemctl` (log and exit 0, so nothing reaches the real service manager), `sh-login` (your login shell,
 * SHELL, whose PATH is `<tmp>/bin` and the system's), `deep` (logs `start <args>` and `end <code>` to `<tmp>/deep.log`,
 * drops DEEP_HUB_PLANT, then runs the built CLI, or the `slow` or `trace` setup), and the agents the machine has. No `pi`
 * anywhere, and no `~/.pi`.
 */
export function makeHome(m: Machine = {}): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  const deepLog = join(tmp, 'deep.log');
  const cargoLog = join(tmp, 'cargo.log');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin);
  symlinkSync(NODE, join(bin, 'node'));
  const script = (name: string, lines: string[]): void => { writeFileSync(join(bin, name), ['#!/bin/sh', ...lines, ''].join('\n')); chmodSync(join(bin, name), 0o755); };
  const logged = (name: string): string => `printf '%s %s\\n' '${name}' "$*" >> '${join(bin, 'calls.log')}'`;
  for (const name of ['launchctl', 'systemctl']) script(name, [logged(name), 'exit 0']);
  if (m.claude !== false) script('claude', [logged('claude'), `if [ "$1" = --version ]; then echo '${newest('claude-code.facts.json')} (Claude Code)'; fi`, 'exit 0']);
  if (m.codex !== false) script('codex', [logged('codex'), `if [ "$1" = --version ]; then echo 'codex-cli ${newest('codex.facts.json')}'; fi`, 'exit 0']);
  // paseo lists no plugin, and writes its config.json as it installs one, as paseo's own manager does.
  if (m.paseo) script('paseo', [logged('paseo'), 'if [ "$1 $2" = "plugin ls" ]; then echo "[]"; fi', `if [ "$1 $2" = "plugin install" ]; then mkdir -p "$HOME/.paseo"; printf '{"plugins": ["deepbuild"]}\\n' > "$HOME/.paseo/config.json"; fi`, 'exit 0']);
  script('launcher', [
    logged('launcher'),
    ...(m.hub === 'wiki-refused' ? ['# A hub whose wiki read is refused: the wiki folder is one nobody may write.', 'mkdir -p "$HOME/.deepbuild/wiki"', 'chmod 500 "$HOME/.deepbuild/wiki"'] : []),
    `exec '${NODE}' '${join(FIXTURES, 'launcher.mjs')}' "$@"`,
  ]);
  script('sh-login', [
    '# Your login shell, as setup reads it: the PATH a login shell sets is this one. Login and interactive flags are',
    '# dropped, so no profile of the machine running the tests is read.',
    `PATH='${bin}:/usr/bin:/bin:/usr/sbin:/sbin'; export PATH`,
    'for a; do shift; case "$a" in -l|-i|--login|-il|-li) ;; -lc|-cl|-ilc|-lic|-ic|-ci) set -- "$@" -c ;; *) set -- "$@" "$a" ;; esac; done',
    'exec /bin/sh "$@"',
  ]);
  const cli = `'${NODE}' '${CLI}' "$@"`;
  const start = [`echo "start $*" >> '${deepLog}'`, 'unset DEEP_HUB_PLANT'];
  const setupOnly = (body: string[]): string[] => [...start, 'if [ "$*" = setup ]; then', ...body.map((l) => `  ${l}`), 'fi', `exec ${cli}`];
  const deep = {
    cli: [...start, cli, 'code=$?', `echo "end $code" >> '${deepLog}'`, 'exit $code'],
    slow: setupOnly(['sleep 5', 'echo "DeepBuild is set up."', `echo "end 0" >> '${deepLog}'`, 'exit 0']),
    trace: setupOnly([`cat '${join(FIXTURES, 'trace.txt')}' >&2`, `echo "end 1" >> '${deepLog}'`, 'exit 1']),
  }[m.deep ?? 'cli'];
  script('deep', deep);
  if (m.cargo) {
    const now = `"$('${NODE}' -e 'process.stdout.write(String(Date.now()))')"`;
    script('cargo', [`echo "start ${now} $*" >> '${cargoLog}'`, 'sleep 5', 'mkdir -p "$PWD/target/debug"', `cp '${m.cargo}' "$PWD/target/debug/deep-hook"`, `echo "end ${now}" >> '${cargoLog}'`, 'exit 0']);
  }
  const file = (path: string, text: string): void => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
  if (m.claude !== false) {
    file(join(home, '.claude', 'settings.json'), m.brokenSettings ? UNPARSEABLE : MY_SETTINGS);
    file(join(home, '.claude.json'), MY_CLAUDE_JSON);
  }
  if (m.codex !== false) {
    file(join(home, '.codex', 'hooks.json'), MY_CODEX_HOOKS);
    file(join(home, '.codex', 'config.toml'), MY_CODEX_CONFIG);
  }
  if (m.history) {
    const at = '2026-11-10T09:00:00.000Z';
    if (m.claude !== false) {
      const id = randomUUID();
      file(join(home, '.claude', 'projects', '-tmp-shop', `${id}.jsonl`), `${JSON.stringify({ type: 'user', uuid: randomUUID(), parentUuid: null, sessionId: id, cwd: '/tmp/shop', timestamp: at, message: { role: 'user', content: 'Make the cart header green.' } })}\n`);
    }
    if (m.codex !== false) {
      const id = randomUUID();
      file(join(home, '.codex', 'sessions', '2026', '11', '10', `rollout-2026-11-10T09-00-00-${id}.jsonl`), [
        JSON.stringify({ timestamp: at, type: 'session_meta', payload: { id, timestamp: at, cwd: '/tmp/shop', originator: 'codex_cli_rs', cli_version: newest('codex.facts.json') } }),
        JSON.stringify({ timestamp: at, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Make the cart header green.' }] } }),
        '',
      ].join('\n'));
    }
  }
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  return { tmp, home, bin, deepLog, cargoLog, machine: m };
}
export const rootOf = (h: Home): string => join(h.home, '.deepbuild');
export const claudeSettings = (h: Home): string => join(h.home, '.claude', 'settings.json');
/** Both agents' settings files (AC3): Claude Code's user settings and its ~/.claude.json, Codex's hooks.json and config.toml. */
export const settingsFiles = (h: Home): string[] => [claudeSettings(h), join(h.home, '.claude.json'), join(h.home, '.codex', 'hooks.json'), join(h.home, '.codex', 'config.toml')];
export const bytesOf = (files: readonly string[]): Map<string, Buffer | null> => new Map(files.map((f) => [f, existsSync(f) ? readFileSync(f) : null]));
/** What `deep` the app ran logged: `start <args>` and `end <code>` lines. */
export const deepLog = (h: Home): string[] => (existsSync(h.deepLog) ? readFileSync(h.deepLog, 'utf8').split('\n').filter(Boolean) : []);
export const setupStarts = (h: Home): number => deepLog(h).filter((l) => l === 'start setup').length;
/** How the first `deep setup` the app ran ended, by the `deep` stand-in's log; undefined while it runs. */
export function setupEnded(h: Home): number | undefined {
  const log = deepLog(h);
  if (!log.includes('start setup')) return undefined;
  const end = log.slice(log.indexOf('start setup') + 1).find((l) => /^end -?\d+$/.test(l));
  return end === undefined ? undefined : Number(end.slice(4));
}

const BILLING = /^(ANTHROPIC_|OPENAI_|AWS_|CLAUDE|CODEX|DEEP_|XDG_|GIT_|GH_|GITHUB_)/;
/** The environment a child gets: HOME the fixture's, the stand-ins first on PATH, the login service stand-in, and `extra`. */
export function childEnv(h: Home, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!BILLING.test(key) && key !== 'NODE_OPTIONS') env[key] = value;
  Object.assign(env, {
    HOME: h.home, XDG_CONFIG_HOME: join(h.home, '.config'), XDG_CACHE_HOME: join(h.home, '.cache'), SHELL: join(h.bin, 'sh-login'),
    PATH: `${h.bin}:/usr/bin:/bin:/usr/sbin:/sbin`, LC_ALL: 'C', DEEP_HUB_TEST_CONFIRM: join(h.tmp, 'confirm'),
    DEEP_HUB_LAUNCHER: join(h.bin, 'launcher'), DEEP_TEST_LAUNCHER_LOG: join(h.tmp, 'launched'),
  });
  for (const [key, value] of Object.entries(extra)) { if (value === undefined) delete env[key]; else env[key] = value; }
  return env;
}

// ---- Running a command, each chunk of its output with the time it came.

export interface Chunk { stream: 'stdout' | 'stderr'; at: number; text: string }
export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean; chunks: Chunk[]; started: number }
export function run(command: string, args: readonly string[], o: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const chunks: Chunk[] = [];
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (text: string) => chunks.push({ stream: 'stdout', at: Date.now(), text }));
    child.stderr.setEncoding('utf8').on('data', (text: string) => chunks.push({ stream: 'stderr', at: Date.now(), text }));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 300_000);
    child.on('error', (error) => chunks.push({ stream: 'stderr', at: Date.now(), text: `\n[spawn failed: ${error.message}]` }));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const of = (s: Chunk['stream']): string => chunks.filter((c) => c.stream === s).map((c) => c.text).join('');
      resolve({ code, signal, stdout: of('stdout'), stderr: of('stderr'), timedOut, chunks, started });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end('');
  });
}
export const shown = (r: Ran): string => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${said(r.stdout.slice(-1500), 1600)}, stderr ${said(r.stderr.slice(-1500), 1600)}`;
export const lines = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter(Boolean);
/** Each line of a stream with the time its last piece came. */
export function timedLines(r: Ran, stream: Chunk['stream']): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  let open = '';
  for (const c of r.chunks.filter((x) => x.stream === stream)) {
    const parts = (open + c.text).split('\n');
    open = parts.pop()!;
    for (const p of parts) if (p.trim()) out.push({ text: p.trim(), at: c.at });
  }
  if (open.trim()) out.push({ text: open.trim(), at: r.chunks.at(-1)?.at ?? Date.now() });
  return out;
}

// ---- Builds (README, How to run). Each binary is copied out of the target folder under its own name, so a planted
// build never stands in for the plain one.

const BIN = join(tmpdir(), `da1100-bin-${userInfo().uid}`);
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
export const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
const builds = new Map<string, Promise<string>>();
function cargo(key: string, args: string[], copy?: string): Promise<string> {
  let build = builds.get(key);
  if (!build) {
    build = new Promise<string>((resolve, reject) => {
      execFile('cargo', ['build', '--locked', '-q', ...args], { cwd: REPO, env: CARGO_ENV, maxBuffer: 64 * 1024 * 1024 }, (error, _out, stderr) => {
        if (error) return reject(Error(`BLOCKED: cargo build ${args.join(' ')} failed: ${String(stderr).slice(-1500) || error.message}`));
        if (!copy) return resolve('');
        mkdirSync(BIN, { recursive: true });
        const out = join(BIN, key);
        copyFileSync(target(copy), out);
        resolve(out);
      });
    });
    builds.set(key, build);
  }
  return build;
}
/** The CLI and the workspaces built, or BLOCKED (never a pass). */
export function needCli(): void {
  if (!existsSync(CLI)) blocked(`no built CLI at ${CLI}; run npm run build --workspaces first`);
}
/** deep-hook, which setup's entries run (#18). */
export async function buildHook(): Promise<string> {
  needCli();
  await cargo('deep-hook', ['-p', 'deep-hook', '--bin', 'deep-hook']);
  return target('deep-hook');
}
/** The replica, `deep-drive`: as shipped, or with `env-plants`, so DEEP_HUB_PLANT selects a wrong program (README, Pinned 6). */
export async function driveBin(planted: boolean): Promise<string> {
  onMac();
  const plain = cargo('deep-drive-plain', ['-p', 'deep-replica', '--bin', 'deep-drive'], 'deep-drive');
  if (!planted) return plain;
  await plain;
  return cargo('deep-drive-plants', ['-p', 'deep-replica', '--bin', 'deep-drive', '--features', 'env-plants'], 'deep-drive');
}

// ---- The first `deep` command, through the built CLI (or a scratch copy's), HOME the fixture's, in its temp folder.

export async function deep(h: Home, args: readonly string[], o: { plant?: string; cli?: string } = {}): Promise<Ran> {
  await buildHook();
  return run(NODE, [o.cli ?? CLI, ...args], { env: childEnv(h, { DEEP_HUB_PLANT: o.plant }), cwd: h.tmp });
}
/** `deep status | cat`, as you'd type it: the pipe gets the command's stdout, and its stderr is the shell's. */
export async function statusThroughCat(h: Home, o: { plant?: string } = {}): Promise<Ran> {
  await buildHook();
  const q = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;
  return run('/bin/sh', ['-c', `${q(NODE)} ${q(CLI)} status | cat`], { env: childEnv(h, { DEEP_HUB_PLANT: o.plant }), cwd: h.tmp });
}
/** The set-up line: the line on stderr naming `deep setup --undo` (#326's line, which #1100 keeps naming the route). */
export const setUpLine = (r: Ran): string | undefined => lines(r.stderr).find((l) => l.includes('deep setup --undo'));

/**
 * A scratch copy of the checkout with nothing built under `target/` (AC12): the tracked files and the untracked ones git
 * doesn't ignore, each workspace's `dist` copied in, and a `node_modules` whose `@deepbuild/*` links point into the copy
 * and whose other entries link to the checkout's. Its CLI is `<copy>/packages/cli/dist/main.js`; setup run from it finds
 * no deep-hook and builds one.
 */
export function scratchCheckout(): string {
  needCli();
  const tmp = tempDir();
  const dest = join(tmp, 'repo');
  mkdirSync(dest);
  const listed = execFileSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], { cwd: REPO, maxBuffer: 1 << 28 }).toString('utf8').split('\0').filter(Boolean);
  writeFileSync(join(tmp, 'files'), [...new Set(listed)].filter((f) => existsSync(join(REPO, f))).join('\0'));
  const tar = spawnSync('/bin/sh', ['-c', `tar --null -T '${join(tmp, 'files')}' -cf - | tar -xf - -C '${dest}'`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (tar.status !== 0) blocked(`the scratch copy of the checkout failed: ${tar.stderr.slice(-1500)}`);
  for (const pkg of readdirSync(join(REPO, 'packages'))) {
    const dist = join(REPO, 'packages', pkg, 'dist');
    if (existsSync(dist) && existsSync(join(dest, 'packages', pkg))) cpSync(dist, join(dest, 'packages', pkg, 'dist'), { recursive: true });
  }
  const modules = join(REPO, 'node_modules');
  mkdirSync(join(dest, 'node_modules'));
  for (const name of readdirSync(modules)) {
    if (name !== '@deepbuild') { symlinkSync(join(modules, name), join(dest, 'node_modules', name)); continue; }
    mkdirSync(join(dest, 'node_modules', name));
    for (const pkg of readdirSync(join(modules, name))) {
      const from = join(modules, name, pkg);
      symlinkSync(lstatSync(from).isSymbolicLink() ? readlinkSync(from) : from, join(dest, 'node_modules', name, pkg));
    }
  }
  if (existsSync(join(dest, 'target'))) blocked(`the scratch copy holds a target folder: ${join(dest, 'target')}`);
  return dest;
}

// ---- The hub, as the CLI reaches it: its socket, the control token, one call per connection.

export type Reply = { result: Line } | { error: Line };
export function hubCall(h: Home, method: string, params: Line = {}, timeoutMs = 60_000): Promise<Reply> {
  const socket = join(rootOf(h), 'hub.sock');
  const token = readFileSync(join(rootOf(h), 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line: Line | undefined;
        try { line = JSON.parse(buffer.slice(0, i)) as Line; } catch { line = undefined; }
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`); }
        else if (step === 1 && line?.role !== undefined) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (step === 2 && line?.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          resolve(line.error ? { error: line.error as Line } : { result: (line.result ?? {}) as Line });
        }
      }
    });
  });
}
/** Whether the hub answers at `~/.deepbuild/hub.sock` within `ms`. */
export async function hubAnswers(h: Home, ms = 30_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (existsSync(join(rootOf(h), 'control.token'))) {
      try { if ('result' in (await hubCall(h, 'events.read', { after: 0, limit: 1 }, 5000))) return true; } catch { /* not yet */ }
    }
    await sleep(500);
  }
  return false;
}
export interface Ev { id: string; kind: string; subject?: string; writer: string; ts: number; data: Line; log_pos: number }
/** Every event in the home's record, through `events.read`. */
export async function events(h: Home): Promise<Ev[]> {
  const all: Ev[] = [];
  for (let after = 0; ;) {
    const reply = await hubCall(h, 'events.read', { after, limit: 1000 });
    if ('error' in reply) blocked(`events.read refused: ${said(reply.error)}`);
    const page = (('result' in reply ? reply.result.events : []) ?? []) as Ev[];
    if (!page.length) return all;
    all.push(...page);
    after = page[page.length - 1]!.log_pos;
  }
}

// ---- The replica: one `deep-drive --out <dir>` process, JSON lines in and out (#124's protocol).

export interface SNode { role: string; name: string | null; value: unknown; id?: unknown; bounds: number[]; children: SNode[] }
export interface DrawnRun { text: string; bounds: number[] }
export interface Snapshot { window: { size: number[]; scale: number }; tree: SNode; runs?: DrawnRun[]; focus?: unknown }
/** What `see` answers; `notifications` is pinned here (README, Pinned 4). */
export interface Seen { snapshot: Snapshot; address: string | null; notifications?: { setting?: unknown } }
export interface Request { t: number; ask: string | null }
export interface Trace { notifications?: { t: number; ask: string | null }[]; permission_requests?: Request[] }
export const flat = (n: SNode, into: SNode[] = []): SNode[] => { into.push(n); for (const c of n.children ?? []) flat(c, into); return into; };
export const FLICKS = 705_600_000;

export class Drive {
  private buffer = '';
  private readonly waiting: ((line: Line) => void)[] = [];
  private exited = false;
  private err = '';
  /** The replica's clock at its last reply, in flicks since launch. */
  t = 0;
  private constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const raw = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let parsed: Line;
        try { parsed = JSON.parse(raw) as Line; } catch { parsed = { unparsed: raw }; }
        this.waiting.shift()?.(parsed);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true }); });
  }
  /** A replica in the fixture's home, `plant` its DEEP_HUB_PLANT in the planted build (README, Pinned 6). */
  static async start(h: Home, plant?: string): Promise<Drive> {
    const bin = await driveBin(plant !== undefined);
    await buildHook();
    const out = join(h.tmp, `drive-${randomUUID().slice(0, 8)}`);
    mkdirSync(out, { recursive: true });
    const child = spawn(bin, ['--out', out], { cwd: REPO, env: childEnv(h, { DEEP_HUB_PLANT: plant }), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const d = new Drive(child);
    const ready = await d.next(600_000);
    if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${said(ready)} ${d.err.slice(-600)}`);
    return d;
  }
  private next(ms: number): Promise<Line> {
    if (this.exited) return Promise.resolve({ exited: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  /** One call and its reply; BLOCKED when the binary gives none. */
  async call(args: Line): Promise<Line> {
    const reply = this.next(600_000);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.exited || got.timedOut || got.unparsed !== undefined) blocked(`deep-drive gave no JSON reply to ${String(args.call)}: ${said(got)} ${this.err.slice(-600)}`);
    if (typeof got.t === 'number') this.t = got.t;
    return got;
  }
  /** One call that must answer ok; else a failure naming `what` and the replica's own error. */
  async must(what: string, args: Line): Promise<Line> {
    const reply = await this.call(args);
    if (reply.ok !== true) throw Error(`${what}: ${said(reply.error ?? reply, 800)}`);
    return reply;
  }
  launch(launch: Line): Promise<Line> { return this.must(`launching the replica with ${said(launch)}`, { call: 'launch', launch }); }
  async see(): Promise<Seen> {
    const r = await this.must('see', { call: 'see' });
    return { snapshot: r.snapshot as Snapshot, address: (r.address ?? null) as string | null, ...(r.notifications !== undefined ? { notifications: r.notifications as Seen['notifications'] & object } : {}) };
  }
  /** Lets the replica's clock run `ms` with no input (wall time, on `clock: "real"`). */
  wait(ms: number): Promise<Line> { return this.must(`waiting ${ms} ms`, { call: 'wait_for', wait_for: { t: this.t + Math.round((ms * FLICKS) / 1000) }, timeout: ms + 2000 }); }
  click(locator: Line, what = `a click on ${said(locator)}`): Promise<Line> { return this.must(what, { call: 'act', locator, act: { kind: 'click' } }); }
  /** A press at a point in device pixels, now, with no locator and no wait (#1461's act). */
  clickAt(point: number[]): Promise<Line> { return this.must(`a press at ${said(point)}`, { call: 'act', act: { kind: 'click', point } }); }
  feed(session: string, event: Line): Promise<Line> { return this.must(`feeding ${String(event.kind)}`, { call: 'feed', feed: { session, event } }); }
  /** Closes the replica; its trace (README, Pinned 4: `permission_requests`). */
  async close(): Promise<Trace> {
    const closed = await this.must('close', { call: 'close' });
    return JSON.parse(readFileSync(String(closed.trace.path), 'utf8')) as Trace;
  }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 5000;
    while (!this.exited && Date.now() < deadline) await sleep(20);
    if (!this.exited) try { process.kill(this.child.pid!, 'SIGKILL'); } catch { /* gone */ }
  }
}

/** The replica in the fixture's home, on its first launch, on the wall clock so a real `deep setup` and the app's ticks agree. */
export async function firstLaunch(h: Home, o: { plant?: string; notifications?: 'not_asked' } = {}): Promise<{ d: Drive; screen: Screen }> {
  onMac();
  const d = await Drive.start(h, o.plant);
  await d.launch({ from: 'empty', setup: 'unfinished', clock: 'real', ...(o.notifications ? { notifications: o.notifications } : {}) });
  await d.wait(1500);
  return { d, screen: screenOf(await d.see()) };
}
/** The clock of a replica launched with no record (crates/deep-replica/src/lib.rs, NOW), in ms since the epoch, at its last reply. */
export const replicaNow = (d: Drive): number => 1_800_000_000_000 + Math.round((d.t * 1000) / FLICKS);
/** A new ask on a session, raised now on the replica's clock: its `ask.created`, then its row as the core builds it (#1461's feed). Its handle. */
export async function feedAsk(d: Drive, question = 'Keep the cart on SQLite or plain files?'): Promise<string> {
  const id = ulid();
  const raised = replicaNow(d);
  const data = askData('choice', question, raised, raised + 2 * 86_400_000);
  const session = 'session-1100';
  const core = { writer: 'core', actor: 'you', scope: 'you' };
  const fed = await d.feed(session, { v: 1, id, kind: 'ask.created', ...core, data });
  const options = (data.options as { id: string; label: string }[]).map((o) => ({ answer: o.id, label: o.label }));
  await d.feed(session, await rowSet({
    id: `ask:${id}`, address: `ask/${id}`, title: question, project: 'shop', session, agent: 'claude-code', entry: 'needs_you', word: 'needs you',
    why: 'a choice', waits_on: 'you', since: typeof fed.ts === 'number' ? fed.ts : raised, actions: options, unread: false,
  } as unknown as Row));
  return `ask:${id}`;
}
/** Presses Set up as a person does. */
export const pressSetUp = (d: Drive): Promise<Line> => d.click({ role: 'button', name: 'Set up' }, 'a press on the Set up button');
/** Lets the clock run a second at a time until `done` holds or `ms` pass; the last screen. */
export async function until(d: Drive, done: (s: Screen) => boolean, ms: number): Promise<Screen> {
  const deadline = Date.now() + ms;
  for (;;) {
    await d.wait(1000);
    const s = screenOf(await d.see());
    if (done(s) || Date.now() > deadline) return s;
  }
}

// ---- Reading the window.

export const ADDRESS = /^(ask|session|project|page)\/\S+$/;
export const FIRST_LAUNCH = 'page/welcome';
/** A screen: what `see` answered, its one page (the node whose id is an address, #1460), and the page's words in reading order. */
export interface Screen { seen: Seen; page: SNode | undefined; texts: string[]; nodeTexts: string[]; runTexts: string[]; ids: string[] }
const inside = (b: number[], box: number[]): boolean => b[0]! >= box[0]! - 1 && b[1]! >= box[1]! - 1 && b[0]! + b[2]! <= box[0]! + box[2]! + 1 && b[1]! + b[3]! <= box[1]! + box[3]! + 1;
/** The page's words: its nodes' names and string values in tree order, then the strings drawn inside it, top to bottom. */
export function screenOf(seen: Seen): Screen {
  const pages = flat(seen.snapshot.tree).filter((n) => typeof n.id === 'string' && ADDRESS.test(n.id));
  const page = pages.length === 1 ? pages[0] : undefined;
  if (!page) return { seen, page, texts: [], nodeTexts: [], runTexts: [], ids: [] };
  const nodes = flat(page);
  const tidy = (all: string[]): string[] => all.map((t) => t.trim()).filter((t, i, list) => t !== '' && t !== list[i - 1]?.trim());
  const nodeTexts = tidy(nodes.flatMap((n) => [n.name ?? '', typeof n.value === 'string' ? n.value : '']));
  const runTexts = tidy((seen.snapshot.runs ?? []).filter((r) => inside(r.bounds, page.bounds)).sort((a, b) => a.bounds[1]! - b.bounds[1]! || a.bounds[0]! - b.bounds[0]!).map((r) => r.text));
  return { seen, page, texts: [...nodeTexts, ...runTexts], nodeTexts, runTexts, ids: nodes.map((n) => n.id).filter((x): x is string => typeof x === 'string') };
}
/** The distinct texts on the page that `test` finds: a node's, or a drawn string no node's text holds (a wrapped line's piece is its node's). */
export function textsWhere(s: Screen, test: (text: string) => boolean): string[] {
  const nodes = s.nodeTexts.filter(test);
  return [...new Set([...nodes, ...s.runTexts.filter((t) => test(t) && !s.nodeTexts.some((n) => n.includes(t)))])];
}
export const pageId = (s: Screen): string => String(s.page?.id ?? s.seen.address ?? 'no page');
export const nodesOf = (s: Screen): SNode[] => (s.page ? flat(s.page) : []);
export const byId = (s: Screen, id: string): SNode | undefined => nodesOf(s).find((n) => n.id === id);
/** Everything a node holds in words: names and string values of its subtree. */
export const wordsOf = (n: SNode): string => flat(n).flatMap((x) => [x.name ?? '', typeof x.value === 'string' ? x.value : '']).filter(Boolean).join(' ');
export const buttons = (s: Screen): SNode[] => nodesOf(s).filter((n) => n.role === 'button');
export const setUpButton = (s: Screen): SNode | undefined => buttons(s).find((n) => n.name === 'Set up');
export const centre = (n: SNode): number[] => [n.bounds[0]! + Math.round(n.bounds[2]! / 2), n.bounds[1]! + Math.round(n.bounds[3]! / 2)];

// ---- AC1: the agents and steps the screen lists (README, Pinned 1), and the record's setup events (Pinned 3).

export const AGENT_NAMES: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex', pi: 'pi' };
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The list the screen was built from: `setup-agent:<agent>` rows and `setup-step:<step>[:<agent>]` steps. */
export function listedOf(s: Screen): { agents: string[]; steps: string[] } {
  const take = (prefix: string): string[] => [...new Set(s.ids.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length)))];
  return { agents: take('setup-agent:'), steps: take('setup-step:') };
}
/** AC1's screen half: the first-launch page, a row for each agent found, none for one absent, named nowhere, and a list of steps. */
export function agentFailures(s: Screen, found: readonly string[] = ['claude-code', 'codex'], absent: readonly string[] = ['pi']): string[] {
  if (!s.page) return [`the window shows no one page (a node whose id is an address); address ${said(s.seen.address)}`];
  const out: string[] = [];
  if (s.page.id !== FIRST_LAUNCH) out.push(`the window shows ${pageId(s)}, not the first-launch page ${FIRST_LAUNCH}`);
  const { agents, steps } = listedOf(s);
  for (const a of absent) {
    const name = AGENT_NAMES[a] ?? a;
    if (agents.includes(a)) out.push(`the screen has a row for ${name} (setup-agent:${a}), an agent this machine doesn't have`);
    const hit = s.texts.find((t) => new RegExp(`(^|[^\\w-])${escape(name)}([^\\w-]|$)`, 'i').test(t));
    if (hit !== undefined) out.push(`the screen names ${name}, an agent this machine doesn't have: ${said(hit)}`);
  }
  for (const a of found) {
    const name = AGENT_NAMES[a] ?? a;
    if (!agents.includes(a)) out.push(`the screen has no row for ${name} (a node with id setup-agent:${a}); its rows are ${said(agents)}`);
    if (!s.texts.some((t) => t.includes(name))) out.push(`the screen doesn't name ${name}; its words are ${said(s.texts, 600)}`);
  }
  for (const a of agents.filter((x) => !found.includes(x) && !absent.includes(x))) out.push(`the screen has a row for ${a}, an agent this machine doesn't have`);
  if (!steps.length) out.push('the screen lists no step: no node whose id is setup-step:<step> or setup-step:<step>:<agent> (README, Pinned 1)');
  for (const st of steps) {
    const agent = st.split(':')[1];
    if (agent && !agents.includes(agent)) out.push(`the screen lists the step ${st} for ${agent}, which has no row`);
  }
  return out;
}
const keyOf = (e: Ev): string => (typeof e.data?.agent === 'string' && e.data.agent ? `${String(e.data.step)}:${e.data.agent}` : String(e.data?.step));
/** AC1's record half: setup's `setup.step` events name exactly the steps and agents the screen listed. */
export function eventFailures(listed: { agents: string[]; steps: string[] }, all: readonly Ev[]): string[] {
  const setup = all.filter((e) => e.kind === 'setup.step');
  if (!setup.length) return [`after the click the record holds no setup.step event (README, Pinned 3); its kinds are ${said([...new Set(all.map((e) => e.kind))], 600)}`];
  const out: string[] = [];
  const ran = new Set(setup.map(keyOf));
  for (const k of listed.steps) if (!ran.has(k)) out.push(`the screen listed the step ${k}, and setup's events don't name it`);
  for (const k of ran) if (!listed.steps.includes(k)) out.push(`setup's events name the step ${k}, which the screen didn't list`);
  const agents = new Set(setup.map((e) => e.data?.agent).filter((a): a is string => typeof a === 'string' && a !== ''));
  for (const a of agents) if (!listed.agents.includes(a)) out.push(`setup's events name the agent ${AGENT_NAMES[a] ?? a}, which the screen didn't list`);
  for (const a of listed.agents) if (!agents.has(a)) out.push(`the screen listed ${AGENT_NAMES[a] ?? a}, and no setup event names it`);
  return out;
}

// ---- AC2: one button and no other control that writes.

/** Roles of a control that writes something when used: a press, a pick, a switch or typed words. A link only reads. */
const WRITES = /^(button|menu_item\w*|switch|toggle_button|check_box|radio_button|slider|spin_button|combo_box|.*_input)$/;
export function controlFailures(s: Screen): string[] {
  if (!s.page) return ['the window shows no one page (a node whose id is an address)'];
  const controls = nodesOf(s).filter((n) => WRITES.test(n.role));
  const out: string[] = [];
  if (!controls.some((n) => n.role === 'button' && n.name === 'Set up')) out.push(`the first-launch page has no Set up button: its controls are ${said(controls.map((n) => [n.role, n.id, n.name]))}`);
  for (const n of controls.filter((c) => !(c.role === 'button' && c.name === 'Set up'))) out.push(`the first-launch page holds a second control that writes: ${n.role} ${said(n.id ?? null)} ${said(n.name)}`);
  return out;
}

// ---- AC3: the take-it-back line and the routes it names.

export const UNDO_LINE = 'setup-line:undo';
/** The take-it-back line's words (README, Pinned 1), or why there's none. */
export function undoLineOf(s: Screen): { line?: string; failures: string[] } {
  const node = byId(s, UNDO_LINE);
  if (!node) return { failures: [`the screen has no take-it-back line (a node with id ${UNDO_LINE}, README, Pinned 1); its words are ${said(s.texts, 600)}`] };
  const line = wordsOf(node);
  return { line, failures: line.includes('deep setup --undo') ? [] : [`the take-it-back line doesn't name deep setup --undo: ${said(line)}`] };
}
/** The routes a line names: each `deep <command> [--flag]`, and each "remove DeepBuild from <agent>" said in the box. */
export function routesOf(line: string, agents: readonly string[]): { deep: { route: string; command: string; flags: string[] }[]; box: string[] } {
  const deep = [...line.matchAll(/(?<![\w-])deep ([a-z][a-z-]*)((?: --?[a-z][a-z-]*)*)/g)].map((m) => ({ route: m[0], command: m[1]!, flags: (m[2] ?? '').trim().split(/\s+/).filter(Boolean) }));
  const box = [...line.matchAll(/[Rr]emove DeepBuild from (<agent>|[A-Z][\w-]*(?: Code)?)/g)].flatMap((m) => (m[1] === '<agent>' ? agents.map((a) => AGENT_NAMES[a] ?? a) : [m[1]!])).map((who) => `remove DeepBuild from ${who}`);
  return { deep, box: [...new Set(box)] };
}
/**
 * Whether each route the line names exists: a `deep` command whose own help (`deep <command> --help`, which never acts,
 * #1359) exits 0 and lists each flag; and words the box drafts as a change (`box.say` answers an ask) once the hub runs.
 */
export async function routeFailures(h: Home, line: string, agents: readonly string[], hubUp: boolean): Promise<string[]> {
  const out: string[] = [];
  const { deep: commands, box } = routesOf(line, agents);
  for (const c of commands) {
    const help = await run(NODE, [CLI, c.command, '--help'], { env: childEnv(h), cwd: h.tmp, timeoutMs: 60_000 });
    const missing = c.flags.filter((f) => !help.stdout.includes(f));
    if (help.code !== 0 || !/^Usage:/m.test(help.stdout) || missing.length) out.push(`the take-it-back line names ${c.route}, a route deep doesn't have: deep ${c.command} --help ${shown(help)}`);
  }
  for (const words of box) {
    if (!hubUp) { out.push(`the take-it-back line names the box's "${words}", and no hub ran to read it`); continue; }
    const reply = await hubCall(h, 'box.say', { words });
    const ask = 'result' in reply ? reply.result.ask : undefined;
    if (typeof ask !== 'string') out.push(`the take-it-back line names the box's "${words}", which the box doesn't take: ${said(reply, 500)}`);
  }
  return out;
}
/** Where two byte strings first differ, with a little of each around it. */
export function firstDifference(was: Buffer | null, now: Buffer | null): string {
  if (!was || !now) return `${was ? `${was.length} bytes` : 'absent'} before, ${now ? `${now.length} bytes` : 'absent'} now`;
  let i = 0;
  while (i < was.length && i < now.length && was[i] === now[i]) i++;
  const around = (b: Buffer): string => said(b.subarray(Math.max(0, i - 40), i + 80).toString('utf8'));
  return `${was.length} bytes before, ${now.length} now; first difference at byte ${i}: was ${around(was)}, now ${around(now)}`;
}
export function bytesFailures(before: Map<string, Buffer | null>, after: Map<string, Buffer | null>): string[] {
  const out: string[] = [];
  for (const [file, was] of before) {
    const now = after.get(file) ?? null;
    const same = was === null ? now === null : now !== null && was.equals(now);
    if (!same) out.push(`after deep setup --undo, ${file} isn't byte for byte as before: ${firstDifference(was, now)}`);
  }
  return out;
}

// ---- AC4: the One word per idea table, read from docs/canvas-primitives.md.

export interface Term { name: string; code: boolean; means: string }
/** Each Name of the table with its Means: a cell naming two (`open captions, closed captions`) gives two terms. */
export function wordTable(): Term[] {
  const text = readFileSync(join(REPO, 'docs/canvas-primitives.md'), 'utf8');
  const at = text.indexOf('\n## One word per idea');
  if (at < 0) blocked('docs/canvas-primitives.md has no "## One word per idea" section');
  const section = text.slice(at + 1).split('\n## ')[0]!.split('\n');
  const head = section.findIndex((l) => /^\|\s*Name\s*\|\s*Means\s*\|/.test(l));
  if (head < 0) blocked('the One word per idea section has no table headed Name | Means');
  const terms: Term[] = [];
  for (const row of section.slice(head + 2)) {
    if (!row.startsWith('|')) break;
    const cells = row.split('|').map((c) => c.trim());
    for (const name of (cells[1] ?? '').split(/,\s*/).filter(Boolean)) terms.push({ name: name.replace(/`/g, ''), code: /^`.*`$/.test(name), means: cells[2] ?? '' });
  }
  if (terms.length < 100) blocked(`the One word per idea table read as ${terms.length} terms; it has more`);
  return terms;
}
const plain = (s: string): string => s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '').replace(/\s+/g, ' ').trim().replace(/\.$/, '').toLowerCase();
/** Whether `text` holds `term` as a whole word or phrase, in any case, or with a plural ending. */
export function holds(text: string, term: Term): boolean {
  if (term.code) return text.includes(`\`${term.name}\``);
  return new RegExp(`(^|[^\\w-])${escape(term.name)}(e?s)?([^\\w-]|$)`, 'i').test(text);
}
/** AC4: each term of the table the screen shows has its Means text beside it: in the same text, or the one before or after it. */
export function termFailures(s: Screen, table: readonly Term[]): string[] {
  if (!s.page) return ['the window shows no one page (a node whose id is an address)'];
  const out: string[] = [];
  s.texts.forEach((text, i) => {
    const near = plain([s.texts[i - 1] ?? '', text, s.texts[i + 1] ?? ''].join(' '));
    for (const term of table) {
      if (!holds(text, term)) continue;
      const means = plain(term.means);
      const short = plain(term.means.replace(/\s*\([^)]*\)\s*\.?\s*$/, ''));
      if (!near.includes(means) && !near.includes(short)) out.push(`the screen says "${term.name}" with no gloss beside it, in ${said(text)}; the One word per idea table means by it: ${said(term.means)}`);
    }
  });
  return [...new Set(out)];
}

// ---- AC5 and AC10: a Set up that stops.

/** Exit statuses, codes and signals as a process reports them. */
const EXIT = /exit (status|code)|exited with|\bstatus:? \d|\bsignal:? \d|code \d+\)/i;
/** AC5: one line naming the file, no exit status, and the Set up button still there to press. */
export function stopFailures(s: Screen, file: RegExp): string[] {
  if (!s.page) return ['the window shows no one page (a node whose id is an address)'];
  const out: string[] = [];
  const naming = textsWhere(s, (t) => file.test(t));
  if (naming.length !== 1) out.push(`after the click the screen must show one line naming the file; ${naming.length} name it: ${said(naming, 800)} (words: ${said(s.texts, 800)})`);
  for (const t of naming) if (/[\r\n]/.test(t)) out.push(`the line naming the file runs over more than one line: ${said(t)}`);
  for (const t of textsWhere(s, (x) => EXIT.test(x))) out.push(`the line holds an exit status: ${said(t)}`);
  const button = setUpButton(s);
  if (!button) out.push(`the Set up button is gone once setup stopped: the page's buttons are ${said(buttons(s).map((b) => b.name))}`);
  return out;
}
/** The fixture setup's error output, line by line (fixtures/trace.txt). */
export const TRACE = lines(readFileSync(join(FIXTURES, 'trace.txt'), 'utf8'));
/** AC10: no line of the error output on the screen. */
export function traceFailures(s: Screen): string[] {
  if (!s.page) return ['the window shows no one page (a node whose id is an address)'];
  const out: string[] = [];
  for (const line of TRACE) {
    const shownAt = s.texts.find((t) => t.includes(line));
    if (shownAt !== undefined) out.push(`the screen shows setup's error output, its line ${said(line)}, in ${said(shownAt, 500)}`);
  }
  return out;
}

// ---- AC6: what opens after a Set up that works.

export function opensFailures(s: Screen): string[] {
  const at = s.seen.address ?? pageId(s);
  if (at === FIRST_LAUNCH || s.page?.id === FIRST_LAUNCH) return [`after a Set up that works the window stays on the first-launch screen (${FIRST_LAUNCH})`];
  if (/^(ask|project)\//.test(at)) return [];
  const box = byId(s, 'box');
  const focus = s.seen.snapshot.focus;
  if (box && (focus === 'box' || focus === 'box-draft')) return [];
  return [`after a Set up that works the window shows ${at}, not the first open ask, the latest project or the box with its focus (box: ${box ? 'drawn' : 'none'}, focus ${said(focus)})`];
}

// ---- AC7: the app's notification setting (README, Pinned 4).

export interface Asking { before: unknown; after: unknown; ask: string; trace: Trace }
export function notificationFailures(a: Asking): string[] {
  if (a.before !== 'not_asked') return [`BLOCKED: the replica launched as a fresh account (notifications: "not_asked") reads its notification setting as ${said(a.before)} before the click (README, Pinned 4)`];
  const out: string[] = [];
  if (a.after === 'not_asked' || typeof a.after !== 'string') out.push(`after the Set up click the app's notification setting still reads ${said(a.after)}: it never asked`);
  const requests = a.trace.permission_requests;
  if (!Array.isArray(requests)) return [...out, `the replica's trace holds no permission_requests (README, Pinned 4): ${said(Object.keys(a.trace))}`];
  const first = requests[0];
  if (!first) out.push('the app never asked macOS to allow notifications');
  else if (first.ask) out.push(`the app first asked macOS to allow notifications when ${first.ask} came due, not at the Set up click`);
  return out;
}

// ---- AC13: a Set up that takes 5 s.

const BUSY = /^Setting up/;
export function busyFailures(s: Screen, when: string): string[] {
  if (!s.page) return [`${when}, the window shows no one page`];
  const busy = buttons(s).filter((b) => BUSY.test(b.name ?? ''));
  return busy.length === 1 ? [] : [`${when}, ${busy.length} buttons read Setting up: the page's buttons are ${said(buttons(s).map((b) => b.name))} and its words ${said(s.texts, 400)}`];
}

// ---- AC14: a reading job and what leaves this Mac.

/** Words that say nothing of yours leaves this machine. */
const NOTHING_LEAVES = [/\bnothing\b[^.]*\bleaves?\b[^.]*\b(this|your) (mac|machine|computer)\b/i, /\bnever leaves (this|your) (mac|machine|computer)\b/i, /\b(stays?|kept|keeps?) (only )?on (this|your) (mac|machine|computer)\b/i];
export function leavesFailures(s: Screen): string[] {
  if (!s.page) return ['the window shows no one page (a node whose id is an address)'];
  const jobs = listedOf(s).steps.filter((st) => st.startsWith('history:'));
  if (!jobs.length) return [`the screen lists no reading job: no node with id setup-step:history:<agent> (README, Pinned 1); its steps are ${said(listedOf(s).steps)}`];
  return textsWhere(s, (t) => NOTHING_LEAVES.some((r) => r.test(t))).map((t) => `the screen says ${said(t)}, yet its list holds the reading job ${jobs[0]}: your own agent reads that history on your plan`);
}

// ---- AC9: the shipped guard entries.

export interface Shipped { name: string; mode: string }
export function shippedEntries(): Shipped[] {
  const rules = JSON.parse(readFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), 'utf8')) as { entries: Record<string, { mode?: string }> };
  return Object.entries(rules.entries).map(([name, e]) => ({ name, mode: String(e.mode) }));
}
/** AC9: the set-up line says the guard entries block, with how many, read from the shipped list. */
export function guardLineFailures(line: string | undefined, entry: string): string[] {
  const count = shippedEntries().filter((e) => e.mode === 'block').length;
  if (!line) return [`the first command printed no set-up line, yet the shipped guard entry ${entry} blocked the session's call`];
  const says = /\bblock/i.test(line) && new RegExp(`(^|[^\\d])${count}([^\\d]|$)`).test(line);
  return says ? [] : [`the set-up line says nothing of the ${count} shipped guard entries that block, yet ${entry} blocked the session's call: ${said(line)}`];
}

// ---- AC8 and AC11: the session list.

/** The lines of the first command's stdout that the session list, as a later `deep status` prints it, doesn't hold. */
export function notTheList(first: string, later: string): string[] {
  const list = new Set(lines(later));
  return lines(first).filter((l) => !list.has(l));
}

// ---- The taste call (AC15).

export interface Taste { issue?: number; criterion?: string; verdict?: string | null; who?: string | null; when?: string | null; files?: Record<string, string>; note?: string }
export const sortedFiles = (files: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(files).sort()));
export const sha256File = (path: string): string => sha256(readFileSync(path));
