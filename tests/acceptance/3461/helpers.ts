// Shared test-side tools for issue #3461's acceptance tests (README): throwaway homes with stand-ins for the login
// service and the service managers, the built `deep` CLI run as a child process, a stand-in hub on a socket that records
// what each command sends it, the usage lines `deep --help` prints read into their flags, and the table of forms each
// command fits. The world, childEnv, the process helpers and listedCommands' bracket reading are adapted from
// tests/acceptance/1812/helpers.ts (same repo, same license). Nothing here stands in for the deep CLI: every test runs
// packages/cli/dist/main.js. Processes are stopped by PID only, never by name or port.

import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The checkout under test: its packages/cli/dist/main.js is the `deep` every test runs. */
export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CLI = join(CHECKOUT, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
const STUB = join(CHECKOUT, 'tests/acceptance/1812/fixtures/stub-bin.sh');
export const SECOND = 1000;

/** The CLI must be built: a test that can't run it is BLOCKED, never a pass. */
export function needBuild(): void {
  if (!existsSync(CLI)) throw Error(`BLOCKED: no built CLI at ${CLI}; run npm run build --workspaces first`);
}

// ---- Temp folders. Short real paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh3461-'));
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
/** The installed hub's root in a world: `deep` commands without `--root` call the hub there. */
export const rootOf = (w: World) => join(w.home, '.deepbuild');
/** What the stand-ins were asked to do, one line a call. */
export const calls = (w: World): string[] => (existsSync(join(w.bin, 'calls.log')) ? readFileSync(join(w.bin, 'calls.log'), 'utf8').split('\n').filter(Boolean) : []);

/** A git checkout with one commit on main, at `<tmp>/<name>`, for the commands that name a repo. */
export function repo(w: World, name = 'repo'): string {
  const dir = join(w.tmp, name);
  mkdirSync(dir);
  const env = { PATH: '/usr/bin:/bin', HOME: w.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env });
  writeFileSync(join(dir, 'README.md'), '# a fixture repo\n');
  execFileSync('git', ['add', '.'], { cwd: dir, env });
  execFileSync('git', ['-c', 'user.name=dh3461', '-c', 'user.email=dh3461@example.invalid', 'commit', '-q', '-m', 'init'], { cwd: dir, env });
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
const servers = new Set<net.Server>();
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
/** Stops every process this suite started and every stand-in hub, and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const server of servers) server.close();
  servers.clear();
  const pids = [...owned];
  owned.clear();
  for (const pid of pids) try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
  // deadline: bounds the wait for killed groups to go before their folders are removed
  const deadline = Date.now() + 5 * SECOND;
  while (pids.some(alive) && Date.now() < deadline) await new Promise<void>((r) => setImmediate(r));
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }
/** `deep <args>` as you run it: the built CLI under this Node, in the world's working folder, its stdin closed. */
export function deep(w: World, args: readonly string[], o: { timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd: w.work, env: childEnv(w), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
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
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;

/** Whether `r` printed the usage of `deep <word>`: a line of its stderr or stdout that starts `Usage:` and names it. */
export function printsUsageOf(r: Ran, word: string): boolean {
  const own = new RegExp(`^\\s*Usage:.*\\bdeep ${word.replace(/[-]/g, '\\-')}(?![\\w-])`);
  return `${r.stderr}\n${r.stdout}`.split('\n').some((line) => own.test(line));
}

// ---- A stand-in hub: what a command sends the hub, read at the socket.
export interface Call { method: string; params: Record<string, unknown> }
export interface StandIn { socket: string; dir: string; connections: number; lines: string[]; calls: Call[] }
/** The answer each method gets; any other method gets `{}`. */
const ANSWERS: Record<string, Record<string, unknown>> = {
  'start.approve': { ask: 'ask:01KAZ3Y8M5Q2W7E4R6T9P1N3B5' },
  'work.approve': { ask: 'ask:01KAZ3Y8M5Q2W7E4R6T9P1N3B5' },
  'canvas.show': { outcome: 'presented' },
  'env.up': { status: 'ready', ports: {}, run: 'run:01KAZ3Y8M5Q2W7E4R6T9P1N3B5' },
  'env.down': { stopped: [], left: [] },
  'handle.read': { hits: [] },
};
/**
 * A hub stand-in at `<dir>/hub.sock`, with the control token a hub writes beside it: it says hello on the 1.0 contract,
 * takes the cli role, records every line a client sends and every call, and answers each call as ANSWERS says. It is
 * the boundary these tests read; it decides nothing for the command.
 */
export async function standIn(dir: string): Promise<StandIn> {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'control.token'), 'fixture-control-token-3461\n', { mode: 0o600 });
  const socket = join(dir, 'hub.sock');
  rmSync(socket, { force: true });
  const hub: StandIn = { socket, dir, connections: 0, lines: [], calls: [] };
  const server = net.createServer((sock) => {
    hub.connections++;
    sock.setEncoding('utf8');
    sock.on('error', () => undefined);
    let buffer = '';
    sock.write(`${JSON.stringify({ v: 1, contract: '1.0', features: [], hub: `stand-in:${dir}`, generation: 1 })}\n`);
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        hub.lines.push(line);
        let message: Record<string, unknown>;
        try { message = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
        if (message.hello !== undefined) sock.write(`${JSON.stringify({ v: 1, role: 'cli' })}\n`);
        else if (typeof message.method === 'string') {
          hub.calls.push({ method: message.method, params: (message.params ?? {}) as Record<string, unknown> });
          sock.write(`${JSON.stringify({ v: 1, id: message.id, result: ANSWERS[message.method] ?? {} })}\n`);
        }
      }
    });
  });
  servers.add(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()); });
  return hub;
}
export const callsShown = (hub: StandIn) => (hub.calls.length ? hub.calls.map((c) => `${c.method} ${JSON.stringify(c.params)}`).join('; ') : 'no call');

// ---- The usage lines `deep --help` prints, read into commands and flags.
/** `deep --help`'s output from a fresh world. */
export async function help(): Promise<string> {
  needBuild();
  const r = await deep(world(), ['--help'], { timeoutMs: 60 * SECOND });
  if (r.code !== 0 || !r.stdout.includes('deep ')) throw Error(`BLOCKED: deep --help didn't print the commands: ${shown(r)}`);
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
/** A flag a usage line shows: its name, how many values follow it, whether the value is optional, and whether it repeats (`...`). */
export interface Flag { name: string; values: number; optional: boolean; repeats: boolean }
/** The flags a usage line's synopsis shows, each as written once; `--` alone, which ends the flags, is none. */
export function flagsOf(synopsis: string): Flag[] {
  const t = tokens(synopsis);
  const out: Flag[] = [];
  const isValue = (s: string | undefined) => s !== undefined && !s.startsWith('-') && s !== '|' && s !== '...' && s !== '[' && s !== ']';
  for (let i = 0; i < t.length; i++) {
    if (!/^--[a-z]/.test(t[i]!)) continue;
    let j = i + 1;
    let values = 0;
    let optional = false;
    while (j < t.length) {
      if (isValue(t[j]) && (t[j]!.startsWith('<') || !/^[a-z][a-z-]*$/.test(t[j]!) || values === 0)) { values++; j++; continue; }
      if (t[j] === '[' && t[j + 1]?.startsWith('<') && t[j + 2] === ']') { values++; optional = true; j += 3; continue; }
      break;
    }
    const repeats = t[j] === '...' || (t[j] === ']' && t[j + 1] === '...');
    out.push({ name: t[i]!, values, optional, repeats });
  }
  return out;
}
/** Each usage line of `deep --help`: the line as printed (its synopsis), and the flags it shows. */
export interface Line { synopsis: string; flags: Flag[] }
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

// ---- The forms: for each usage line, arguments that fit it with each of its flags once (README, The forms).
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
/** The usage line's command word: the word after `deep`. */
export const wordOf = (args: readonly string[]) => args[0]!;
/** How many of a form's first words name its command: two when the second is a plain word its line shows (`land judge`). */
export function commandWords(synopsis: string, args: readonly string[]): number {
  const second = args[1];
  return second && /^[a-z][a-z-]*$/.test(second) && new RegExp(`(^|[\\s[|])${second}([\\s\\]|]|$)`).test(synopsis) ? 2 : 1;
}
/** Where a repeated flag goes: last, before a `--` that ends the flags. */
export function withRepeat(args: readonly string[], flag: string, values: readonly string[]): string[] {
  const end = args.indexOf('--');
  const at = end < 0 ? args.length : end;
  return [...args.slice(0, at), flag, ...values, ...args.slice(at)];
}
/** The values a form gives `flag`: the words after it, as many as the flag takes. */
export function valuesIn(args: readonly string[], flag: Flag): string[] {
  const at = args.indexOf(flag.name);
  return at < 0 ? [] : args.slice(at + 1, at + 1 + flag.values);
}
/** A different value of the same shape: a path or a word with `-2` added before its extension, a number plus one. */
export function another(value: string): string {
  if (/^\d+$/.test(value)) return String(Number(value) + 1);
  if (/^\d{4}-/.test(value)) return value.replace(/^\d{4}/, (y) => String(Number(y) + 1));
  if (/:\d+$/.test(value)) return value.replace(/\d+$/, (n) => String(Number(n) + 1));
  if (/^\d+x\d+$/.test(value)) return value.replace(/^\d+/, (n) => String(Number(n) + 1));
  if (/^\d+,\d+$/.test(value)) return value.replace(/\d+$/, (n) => String(Number(n) + 1));
  const dot = value.lastIndexOf('.');
  const slash = value.lastIndexOf('/');
  return dot > slash + 1 && dot > 0 ? `${value.slice(0, dot)}-2${value.slice(dot)}` : `${value}-2`;
}
/** A run's output with the world's paths, Node's path, ULIDs and clock times written as placeholders. */
export function normalized(w: World, text: string): string {
  return text
    .split(w.tmp).join('<tmp>')
    .split(CHECKOUT).join('<checkout>')
    .split(dirname(NODE)).join('<node>')
    .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, '<ulid>')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, '<time>')
    .replace(/\b\d+(?:\.\d+)? ?ms\b/g, '<ms>')
    // deep doctor's readings of this machine: the disk's free space and the first free port.
    .replace(/\b\d+(?:\.\d+)? [KMGT]?B free\b/g, '<size> free')
    .replace(/\bport \d+ is free\b/g, 'port <n> is free')
    .replace(/\bleased from \d+ up\b/g, 'leased from <n> up');
}
