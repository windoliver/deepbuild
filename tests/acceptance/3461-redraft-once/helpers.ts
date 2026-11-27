// Test-side tools for #3461's criterion a80d1545, redrafted blind (REDRAFT.md). The world, childEnv, the process helpers,
// the usage-line reader, the forms, NOT_RUN and the normalization are copied from the frozen first draft's
// tests/acceptance/3461/helpers.ts (same repo, same license), cut to what this criterion needs; what is new here is the
// merge base as a program run beside the checkout's (`baseProgram`), and normalization against each program's own root.
// Nothing here stands in for the deep CLI: each run is a real `packages/cli/dist/main.js`, the checkout's or the merge
// base's built from its own sources. Processes are stopped by PID only, never by name or port.

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/** The checkout under test: its packages/cli/dist/main.js is the tested `deep`. */
export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const NODE = process.execPath;
const STUB = join(CHECKOUT, 'tests/acceptance/1812/fixtures/stub-bin.sh');
export const SECOND = 1000;
/** The merge base this suite was written on, pinned so the reference stays put after the change merges. */
export const BASE = '1b4929ae7977aa4bfe62b03e0ef39674be9e8a27';

/** A `deep` to run: the tree it was built in (its own root, which its output may name) and its CLI. */
export interface Program { name: string; root: string; cli: string }
/** The checkout's own `deep`, as built in this checkout. */
export const TESTED: Program = { name: 'this checkout', root: CHECKOUT, cli: join(CHECKOUT, 'packages/cli/dist/main.js') };

/** The CLI must be built: a test that can't run it is BLOCKED, never a pass. */
export function needBuild(p: Program): void {
  if (!existsSync(p.cli)) throw Error(`BLOCKED: no built CLI at ${p.cli}; run npm run build --workspaces first`);
}

// ---- The merge base as a program, under this checkout's conditions.
const gitEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
/** A process environment for the base's build: no GIT_, NODE_OPTIONS or test-runner variable of this process's. */
const buildEnv = (): NodeJS.ProcessEnv => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_|VITEST|NODE_TEST|NODE_OPTIONS$)/.test(k)));
  env.PATH = `${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  return env;
};

/**
 * Lays `<to>/node_modules` as the proof lanes lay a copy's (scripts/proof-runs.mjs, copyChange): a real folder whose
 * entries link to this checkout's installed packages, a scope folder made anew, and a workspace package's relative link
 * made anew so it reaches the copy's own package, never the checkout's.
 */
function linkModules(from: string, to: string, folder = 'node_modules'): void {
  mkdirSync(join(to, folder), { recursive: true });
  for (const name of readdirSync(join(from, folder))) {
    const source = join(from, folder, name);
    const target = join(to, folder, name);
    if (existsSync(target)) continue;
    const stat = lstatSync(source);
    if (stat.isSymbolicLink() && !isAbsolute(readlinkSync(source))) symlinkSync(readlinkSync(source), target);
    else if (stat.isDirectory() && name.startsWith('@') && folder === 'node_modules') linkModules(from, to, join(folder, name));
    else if (stat.isDirectory() && name.startsWith('.') && name !== '.bin') mkdirSync(target);
    else symlinkSync(source, target);
  }
}

let based: Program | undefined;
/**
 * The merge base's `deep`: BASE's tree exported with `git archive` (no .git copied; git runs in this checkout with no
 * GIT_* variable) into `target/acceptance-3461-base/<sha>/`, with this checkout's installed packages linked in as the
 * proof lanes link them, `target` a link to this checkout's `target` (so the base finds the very Rust builds the
 * checkout's `deep` finds, or none), and every workspace built there with npm, as this checkout's were. Built once per
 * checkout; a later run reuses it. A base that can't be exported or built is BLOCKED.
 */
export function baseProgram(): Program {
  if (based) return based;
  const own = join(CHECKOUT, 'target', 'acceptance-3461-base');
  const root = join(own, BASE.slice(0, 12));
  const cli = join(root, 'packages/cli/dist/main.js');
  const done = join(root, '.built');
  if (!(existsSync(done) && readFileSync(done, 'utf8') === BASE && existsSync(cli))) {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    const tar = `${root}.tar`;
    const a = spawnSync('git', ['archive', '--format=tar', '-o', tar, BASE], { cwd: CHECKOUT, encoding: 'utf8', env: gitEnv(), maxBuffer: 64 * 1024 * 1024 });
    if (a.status !== 0) throw Error(`BLOCKED: git archive of the merge base ${BASE} failed in ${CHECKOUT}: ${a.error?.message ?? a.stderr}`);
    const x = spawnSync('tar', ['-xf', tar, '-C', root], { encoding: 'utf8' });
    rmSync(tar, { force: true });
    if (x.status !== 0) throw Error(`BLOCKED: unpacking the merge base ${BASE} failed: ${x.stderr}`);
    if (!existsSync(join(CHECKOUT, 'node_modules'))) throw Error(`BLOCKED: no node_modules in ${CHECKOUT}; run npm ci first`);
    linkModules(CHECKOUT, root);
    symlinkSync(join(CHECKOUT, 'target'), join(root, 'target'));
    const npm = join(dirname(NODE), 'npm');
    // The workspaces build in name order; a package built before one it declares types from fails the first pass and
    // builds on the second, as in a fresh checkout (`npm run build --workspaces`, twice if the first fails).
    let b = spawnSync(npm, ['run', 'build', '--workspaces', '--if-present'], { cwd: root, encoding: 'utf8', env: buildEnv(), maxBuffer: 256 * 1024 * 1024, timeout: 1500 * SECOND });
    if (b.status !== 0) b = spawnSync(npm, ['run', 'build', '--workspaces', '--if-present'], { cwd: root, encoding: 'utf8', env: buildEnv(), maxBuffer: 256 * 1024 * 1024, timeout: 1500 * SECOND });
    if (b.status !== 0 || !existsSync(cli)) throw Error(`BLOCKED: the merge base ${BASE} did not build in ${root}: npm run build --workspaces exited ${b.status}${b.error ? ` (${b.error.message})` : ''}: ${`${b.stdout}\n${b.stderr}`.slice(-3000)}`);
    writeFileSync(done, BASE);
  }
  return (based = { name: `the merge base ${BASE.slice(0, 9)}`, root, cli });
}

// ---- Temp folders. Short real paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh3461o-'));
  made.push(dir);
  return dir;
}

/**
 * A throwaway world: `<tmp>/h` is HOME, where setup has finished (#1002's marker, so no command sets anything up first),
 * `<tmp>/w` the working folder, and `<tmp>/bin` first on PATH with stand-ins for `launchctl`, `systemctl`, a refusing
 * login service, `curl` and `wget` (each logs its call and exits 1) and a login shell. `<tmp>/confirm` holds `cancelled`:
 * the OS confirmation stubbed through DEEP_HUB_TEST_CONFIRM (#24), so nothing a command asks you to confirm goes through.
 */
export interface World { tmp: string; home: string; work: string; bin: string }
export function world(): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const work = join(tmp, 'w');
  const bin = join(tmp, 'bin');
  for (const dir of [home, work, bin]) mkdirSync(dir);
  for (const name of ['launchctl', 'systemctl', 'refusing-launcher', 'curl', 'wget']) {
    copyFileSync(STUB, join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'sh-login'), [
    '#!/bin/sh',
    `PATH='${bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin'; export PATH`,
    'for a; do shift; case "$a" in -l|-i|--login|-il|-li) ;; -lc|-cl|-ilc|-lic|-ic|-ci) set -- "$@" -c ;; *) set -- "$@" "$a" ;; esac; done',
    'exec /bin/sh "$@"',
    '',
  ].join('\n'));
  chmodSync(join(bin, 'sh-login'), 0o755);
  writeFileSync(join(tmp, 'confirm'), 'cancelled\n');
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const version = (JSON.parse(readFileSync(join(CHECKOUT, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(root, 'setup-finished.json'), `${JSON.stringify({ version, at: '2026-11-24T00:00:00.000Z' })}\n`, { mode: 0o600 });
  return { tmp, home, work, bin };
}

/** A git checkout with one commit on main, at `<tmp>/<name>`, for the commands that name a repo. */
export function repo(w: World, name = 'repo'): string {
  const dir = join(w.tmp, name);
  mkdirSync(dir);
  const env = { PATH: '/usr/bin:/bin', HOME: w.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env });
  writeFileSync(join(dir, 'README.md'), '# a fixture repo\n');
  execFileSync('git', ['add', '.'], { cwd: dir, env });
  // A fixed author and date, so both programs' worlds hold the same commit.
  execFileSync('git', ['-c', 'user.name=dh3461', '-c', 'user.email=dh3461@example.invalid', 'commit', '-q', '-m', 'init'], { cwd: dir, env: { ...env, GIT_AUTHOR_DATE: '2026-11-24T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-24T00:00:00Z' } });
  return dir;
}

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/**
 * The environment a child gets: HOME the world's home, the stand-ins first on PATH, the refusing login service as
 * DEEP_HUB_LAUNCHER, `deep update`'s registry an address nothing answers on, and no DEEP_, XDG_, CLAUDE*, CODEX*, GIT_,
 * MCP_, NODE_OPTIONS or billing variable of this process's.
 */
export function childEnv(w: World): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_|MCP_|AI_AGENT|NODE_TEST|VITEST)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = w.home;
  env.XDG_CONFIG_HOME = join(w.home, '.config');
  env.XDG_CACHE_HOME = join(w.home, '.cache');
  env.SHELL = join(w.bin, 'sh-login');
  env.PATH = `${w.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  env.LC_ALL = 'C';
  env.TZ = 'UTC';
  env.TMPDIR = join(w.tmp, 'tmp');
  mkdirSync(env.TMPDIR, { recursive: true });
  env.DEEP_HUB_TEST_CONFIRM = join(w.tmp, 'confirm');
  env.DEEP_HUB_LAUNCHER = join(w.bin, 'refusing-launcher');
  env.DEEP_UPDATE_URL = 'http://127.0.0.1:9/deepbuild/latest';
  return env;
}

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
/** Stops every process this suite started and removes its temp folders (the base's build in target/ stays). */
export async function cleanup(): Promise<void> {
  const pids = [...owned];
  owned.clear();
  for (const pid of pids) try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
  // deadline: bounds the wait for killed groups to go before their folders are removed
  const deadline = Date.now() + 5 * SECOND;
  while (pids.some(alive) && Date.now() < deadline) await new Promise<void>((r) => setImmediate(r));
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }
/** `deep <args>` as you run it: program `p`'s CLI under this Node, in the world's working folder, its stdin closed. */
export function deep(p: Program, w: World, args: readonly string[], o: { timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [p.cli, ...args], { cwd: w.work, env: childEnv(w), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    // deadline: a command that never ends is killed with its group and reported as timed out
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, o.timeoutMs ?? 90 * SECOND);
    child.on('error', (error) => { stderr += `\n[spawn failed: ${error.message}]`; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (child.pid) owned.delete(child.pid);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end('');
  });
}

// ---- The usage lines `deep --help` prints, read into commands and flags (the frozen draft's reading, unchanged).
/** `deep --help`'s output from program `p`, in a fresh world. */
export async function help(p: Program): Promise<string> {
  needBuild(p);
  const r = await deep(p, world(), ['--help'], { timeoutMs: 60 * SECOND });
  if (r.code !== 0 || !r.stdout.includes('deep ')) throw Error(`BLOCKED: ${p.name}'s deep --help didn't print the commands: exit ${r.code}, ${JSON.stringify(r.stderr.slice(0, 600))}`);
  return r.stdout;
}
/** A synopsis's tokens: a `<…>` placeholder is one token, spaces and all; `[` and `]` stand alone. */
function tokens(synopsis: string): string[] {
  const out: string[] = [];
  let current = '';
  let angle = 0;
  const push = () => { if (current) out.push(current); current = ''; };
  for (const ch of synopsis) {
    if (angle === 0 && /\s/.test(ch)) { push(); continue; }
    if (angle === 0 && (ch === '[' || ch === ']')) { push(); out.push(ch); continue; }
    if (ch === '<') angle++;
    if (ch === '>') angle = Math.max(0, angle - 1);
    current += ch;
  }
  push();
  return out;
}
/** The flag names a usage line's synopsis shows; `--` alone, which ends the flags, is none. */
export function flagsOf(synopsis: string): string[] {
  return [...new Set(tokens(synopsis).filter((t) => /^--[a-z]/.test(t)))];
}
/** Each usage line of `deep --help`: the line as printed (its synopsis), and the flags it shows. */
export interface Line { synopsis: string; flags: string[] }
export function usageLines(text: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.split('\n')) {
    const m = /^\s*(?:Usage:\s*)?(deep\s+[a-z].*)$/.exec(raw);
    if (!m) continue;
    const synopsis = m[1]!.split(/\s{2,}/)[0]!.trim();
    out.push({ synopsis, flags: flagsOf(synopsis) });
  }
  return out;
}

// ---- The forms: for each usage line, arguments that fit it with each of its flags once (the frozen draft's, unchanged).
export interface Form { line: string; args: string[] }
/** A handle's ID: a ULID, as the record's handles carry them. */
const ID = '01KAZ3Y8M5Q2W7E4R6T9P1N3B5';
/**
 * The forms, laid in `w`: each names the usage line it fits by the line's start, and gives every flag that line shows
 * once (a repeating flag once too). Paths are under the world's temp folder.
 */
export function forms(w: World): Form[] {
  const checkout = repo(w);
  const file = join(w.tmp, 'doc.json');
  writeFileSync(file, '{}\n');
  const other = join(w.tmp, 'other.json');
  writeFileSync(other, '{}\n');
  const pkg = join(w.tmp, 'pkg');
  mkdirSync(pkg);
  writeFileSync(join(pkg, 'deepbuild.json'), `${JSON.stringify({ id: 'dh3461.fixture', version: '0.0.1' })}\n`);
  const dev = join(w.tmp, 'devhub');
  const read = join(w.tmp, 'readroot');
  const invite = `deepbuild-invite:${Buffer.from(JSON.stringify({ v: 1, address: '127.0.0.1:9', hub: 'hub-fixture', secret: 'fixture-secret', project: 'github.com/acme/other', person: 'login1' })).toString('base64url')}`;
  return [
    { line: 'deep doctor', args: ['doctor', '--json'] },
    { line: 'deep status [--json]', args: ['status', '--json'] },
    { line: 'deep status <session>', args: ['status', `session:${ID}`, '--why', '--json'] },
    { line: 'deep explain', args: ['explain', join(w.tmp, 'session'), '--json'] },
    { line: 'deep host', args: ['host', 'facts', 'h1', '--refresh'] },
    { line: 'deep hub run', args: ['hub', 'status', '--root', dev] },
    { line: 'deep hub stop', args: ['hub', 'stop', '--root', dev] },
    { line: 'deep hub use', args: ['hub', 'use', '--root', dev] },
    { line: 'deep run --result', args: ['run', '--result', file] },
    { line: 'deep fix', args: ['fix', 'ACME-1', '--json'] },
    { line: 'deep land', args: ['land', '--repo', checkout, '--json'] },
    { line: 'deep land', args: ['land', 'judge', '--repo', checkout, '--json'] },
    { line: 'deep work "<scope>"', args: ['work', 'fix the login page', '--repo', checkout, '--json'] },
    { line: 'deep work --repo', args: ['work', '--repo', checkout, '--issues', '1,2', '--once', '--json'] },
    { line: 'deep workspace', args: ['workspace', 'new', 'topic', '--folder', join(w.tmp, 'ws')] },
    { line: 'deep workspace', args: ['workspace', 'task', 'ws1', 'title', '--criterion', 'text', '--blocked-by', '1'] },
    { line: 'deep workspace', args: ['workspace', 'drift', 'ws1', '--json'] },
    { line: 'deep setup', args: ['setup', '--undo'] },
    { line: 'deep env', args: ['env', 'up', '--root', dev, '--json'] },
    { line: 'deep env', args: ['env', 'down', '--root', dev, '--json'] },
    { line: 'deep numbers', args: ['numbers', '--json'] },
    { line: 'deep numbers', args: ['numbers', 'refresh', '--json'] },
    { line: 'deep show', args: ['show', '--doc', 'doc1', '--document', file, '--removes', 'a,b', '--t', '0', '--size', '10x10', '--include', 'issues', '--check', '--snap', '--claim', 'claim1', '--json'] },
    { line: 'deep export', args: ['export', '--document', file, '--still', '0', '--out', join(w.tmp, 'still.png')] },
    { line: 'deep kinds', args: ['kinds', '--dump', join(w.tmp, 'dump')] },
    { line: 'deep kinds', args: ['kinds', '--diff', file, other] },
    { line: 'deep inbox [--json]', args: ['inbox', '--json'] },
    { line: 'deep start approve', args: ['start', 'approve', '--repo', checkout, '--issues', '1', '--agents', 'claude-code', '--home', `claude-code=${join(w.tmp, 'cc')}`, '--mode', 'claude-code=plan', '--at-once', '1', '--plan-share', '10', '--until', '2030-01-01T00:00:00Z', '--host', 'h1', '--json'] },
    { line: 'deep start --repo', args: ['start', '--repo', checkout, '--issue', '1', '--agent', 'claude-code', '--mode', 'plan', '--prompt', 'go', '--json'] },
    { line: 'deep gate rules', args: ['gate', 'rules', '--json'] },
    { line: 'deep install', args: ['install', '--trust-key', pkg] },
    { line: 'deep memory [--json]', args: ['memory', '--json'] },
    { line: 'deep rules', args: ['rules', 'sync', '--json'] },
    { line: 'deep rules', args: ['rules', 'reach', '--repo', checkout, '--scope', '**', '--json'] },
    { line: 'deep rules', args: ['rules', 'credit', `rule:${ID}`, '--json'] },
    { line: 'deep session rules', args: ['session', 'rules', `session:${ID}`, '--json'] },
    { line: 'deep secret', args: ['secret', 'list', '--json'] },
    { line: 'deep join', args: ['join', 'https://github.com/acme/widget', '--invite', invite] },
    { line: 'deep person', args: ['person', 'invite', 'login1', '--address', '127.0.0.1:9'] },
    { line: 'deep update', args: ['update', '--check'] },
    { line: 'deep read', args: ['read', 'handle1', '--slice', 'c1', '--json', '--root', read] },
    { line: 'deep find', args: ['find', 'query', '--file', 'a.txt', '--slice', 'c1', '--json', '--root', read] },
  ];
}
/** Flags no form gives here, by line start and flag, each with why. */
export const NOT_RUN: readonly { line: string; flag: string; why: string }[] = [
  { line: 'deep doctor', flag: '--prompt', why: 'sends each signed-in agent a test prompt, which spends plan usage' },
  { line: 'deep hub run', flag: '--safe', why: 'runs a hub in the foreground until it is stopped' },
];
/** The form's line among `lines`: the first whose synopsis starts with the form's line start. */
export const lineOf = (lines: readonly Line[], start: string): Line | undefined => lines.find((l) => l.synopsis.startsWith(start));

/**
 * A run's output with the program's own root written `<checkout>` (the base is built under this checkout, so its root
 * goes first), the world's folder `<tmp>`, this checkout `<checkout>`, Node's folder `<node>`, and ULIDs, clock times,
 * durations and doctor's free-space and free-port readings as placeholders: what differs between two runs of one
 * program in two fresh worlds.
 */
export function normalized(p: Program, w: World, text: string): string {
  return text
    .split(p.root).join('<checkout>')
    .split(w.tmp).join('<tmp>')
    .split(CHECKOUT).join('<checkout>')
    .split(dirname(NODE)).join('<node>')
    .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, '<ulid>')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, '<time>')
    .replace(/\b\d+(?:\.\d+)? ?ms\b/g, '<ms>')
    .replace(/\b\d+(?:\.\d+)? [KMGT]?B free\b/g, '<size> free')
    .replace(/\bport \d+ is free\b/g, 'port <n> is free')
    .replace(/\bleased from \d+ up\b/g, 'leased from <n> up');
}
