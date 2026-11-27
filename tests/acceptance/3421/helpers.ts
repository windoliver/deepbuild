// Shared test-side tools for the issue #3421 acceptance tests: deep-hook built three ways (this checkout's, the
// merge base's and a scratch checkout's after its schema edit), a stand-in hub on the Unix socket of a temp home,
// deep-hook run as an agent's hook entry runs it, and the spool read as bytes. Nothing here stands in for deep-hook:
// every reply comes from a real binary. No function here waits for time to pass; the only timers bound a child's run.

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  constants, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { loadavg } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const NODE = process.execPath;
/** The commit this suite was written on, pinned: the merge base the recorded replies are compared with (README). */
export const BASE = '4d8baa1189968d95871417134c711e08918532c3';
export const MINUTE = 60_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh3421-'));
  made.push(dir);
  return dir;
}
/** A fresh home whose ~/.deepbuild holds an empty rules.json, so no guard entry decides a call. */
export function makeHome(): string {
  const home = join(tempDir(), 'h');
  mkdirSync(join(home, '.deepbuild'), { recursive: true });
  writeFileSync(join(home, '.deepbuild', 'rules.json'), `${JSON.stringify({ v: 1, entries: {} }, null, 2)}\n`);
  return home;
}
/** Removes the temp folders this file made. Every child a test starts is awaited to its end before this runs. */
export function cleanup(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a hook gets: this one with HOME moved to the test's home and no DEEP_, GIT_ or billing settings. */
export function childEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('GIT_') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.LC_ALL = 'C';
  return env;
}
/** This process's environment without GIT_ settings, for git, cargo and npm: a hook's or worktree's can't aim them elsewhere. */
export const toolEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
  ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), ...extra });

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }
/** Runs a command to its end without blocking this process's event loop, so a stand-in hub here can answer it. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    // deadline: a child that hangs is killed by its PID, so a hang reads as a failure and never as a wait
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? MINUTE);
    child.on('error', (error) => { clearTimeout(timer); done({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, timedOut }); });
    child.on('close', (code, signal) => { clearTimeout(timer); done({ code, signal, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 400))}, stderr ${JSON.stringify(r.stderr.slice(0, 400))}`;
/** What an agent reads of a hook: its exit code and the bytes of its two streams. */
export const replyOf = (r: Ran) => ({ exit: r.timedOut ? 'killed at the timeout' : (r.code ?? r.signal), stdout: r.stdout, stderr: r.stderr });
/** A home folder written as `~`, for a message a run record may keep. */
export const tilde = (text: string): string => (process.env.HOME ? text.split(process.env.HOME).join('~') : text);
export const loadNow = (): string => loadavg().map((n) => n.toFixed(1)).join(' ');

// ---- deep-hook builds. A build's failure is returned, never thrown: the test that needs it fails at its expect.
export interface Built { bin: string; error: string }
const targetDir = (): string => { const t = process.env.CARGO_TARGET_DIR; return t ? resolve(REPO, t) : join(REPO, 'target'); };
/** The suite's own folder under target/: the merge base's sources, the scratch checkout, and the one target folder their builds share. */
export const OWN = join(targetDir(), 'acceptance-3421');
const CARGO_ENV = { CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0' };
const tail = (text: string | null | undefined): string => tilde((text ?? '').split('\n').filter((l) => !/^\s*(?:Blocking waiting|Compiling|Finished|Downloaded|Downloading|Locking)\b/.test(l)).join('\n').slice(-3000));
/** The first run of a new binary is slow on macOS (it is checked before it runs); run it once before a timed exchange. */
function warmed(bin: string): Built {
  const ran = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: MINUTE });
  return ran.status === 0 ? { bin, error: '' } : { bin, error: `${tilde(bin)} --version exited ${ran.status ?? ran.signal}: ${tail(ran.stderr)}` };
}
function cargoHook(cwd: string, env: NodeJS.ProcessEnv): string {
  const built = spawnSync('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd, env, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 30 * MINUTE });
  return built.status === 0 ? '' : `cargo build --locked -q -p deep-hook in ${tilde(cwd)} exited ${built.status ?? built.signal}: ${built.error?.message ?? ''}${tail(built.stderr)}`;
}

/** This checkout's deep-hook, the hook under test: `cargo build --locked -q -p deep-hook`, in the checkout's own target. */
export function buildChange(): Built {
  const bin = join(targetDir(), 'debug', 'deep-hook');
  const error = cargoHook(REPO, toolEnv());
  return error ? { bin, error } : warmed(bin);
}

/** The Cargo workspace as a checkout holds it, and what deep-hook's sources read at build time (adapters/). */
const CARGO_PATHS = ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'crates', 'vendor', 'adapters'];

/**
 * The merge base's deep-hook: BASE's Cargo workspace exported with `git archive` (no .git is copied), built in the
 * suite's own target folder and kept as a file of its own, since the scratch build shares that folder.
 */
export function buildBase(): Built {
  const src = join(OWN, `base-${BASE.slice(0, 12)}`);
  const bin = join(OWN, 'deep-hook-base');
  if (!existsSync(join(src, '.exported'))) {
    rmSync(src, { recursive: true, force: true });
    mkdirSync(src, { recursive: true });
    const tar = `${src}.tar`;
    const archived = spawnSync('git', ['archive', '--format=tar', '-o', tar, BASE, ...CARGO_PATHS], { cwd: REPO, encoding: 'utf8', env: toolEnv() });
    if (archived.status !== 0) return { bin, error: `git archive ${BASE} failed: ${tail(archived.stderr)}` };
    const unpacked = spawnSync('tar', ['-xf', tar, '-C', src], { encoding: 'utf8' });
    rmSync(tar, { force: true });
    if (unpacked.status !== 0) return { bin, error: `unpacking the merge base ${BASE} failed: ${tail(unpacked.stderr)}` };
    writeFileSync(join(src, '.exported'), BASE);
  }
  const error = cargoHook(src, toolEnv({ ...CARGO_ENV, CARGO_TARGET_DIR: join(OWN, 'target') }));
  if (error) return { bin, error };
  copyFileSync(join(OWN, 'target', 'debug', 'deep-hook'), bin);
  return warmed(bin);
}

// ---- The scratch checkout (criterion 3).
/** Every file under `dir`, as paths from it, with each file's bytes: a folder's whole content, to compare two of them. */
export function filesUnder(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.set(relative(dir, path), readFileSync(path).toString('base64'));
    }
  };
  walk(dir);
  return out;
}
export const SCHEMA = 'packages/contracts/schemas/hook.reply@2.json';
export const GENERATED = 'crates/deep-contracts/src/generated.rs';
export const HOOK_SRC = 'crates/deep-hook/src';
export interface Scratch { dir: string; copied: string; schemaBefore: Line | undefined; generate: Ran; generatedChanged: boolean; build: Built }
/**
 * A scratch checkout of this checkout as its files are now: the Cargo workspace, the contracts package and the root
 * files its generator reads, copied to the suite's own folder under target/ (always the same path, so Cargo rebuilds
 * only the two crates whose files changed), with node_modules a link to this checkout's. Then, there only: `exit`'s
 * maximum in hook.reply@2.json is set to `maximum`, the repository's own command regenerates the Rust
 * (`npm run generate -w @deepbuild/contracts`, crates/deep-contracts/README.md), and deep-hook is built.
 */
export async function scratchWithExitMaximum(maximum: number): Promise<Scratch> {
  const dir = join(OWN, 'scratch');
  const out: Scratch = { dir, copied: '', schemaBefore: undefined, generate: { code: null, signal: null, stdout: '', stderr: 'not run', timedOut: false }, generatedChanged: false, build: { bin: join(OWN, 'deep-hook-scratch'), error: 'not built' } };
  try {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'packages'), { recursive: true });
    const skip = new Set(['node_modules', 'dist', 'target']);
    for (const path of [...CARGO_PATHS, 'package.json', 'tsconfig.json', 'packages/contracts']) {
      // Cloned where the disk can (APFS), so the copy takes no room until a file changes.
      cpSync(join(REPO, path), join(dir, path), { recursive: true, mode: constants.COPYFILE_FICLONE, filter: (from) => !skip.has(from.split('/').at(-1) ?? '') });
    }
    symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'));
  } catch (error) {
    out.copied = `copying the checkout to ${tilde(dir)} failed: ${tilde((error as Error).message)}`;
    return out;
  }
  const schemaFile = join(dir, SCHEMA);
  out.schemaBefore = parseObject(readFileSync(schemaFile, 'utf8'));
  const schema = parseObject(readFileSync(schemaFile, 'utf8'));
  if (schema?.properties?.exit) schema.properties.exit.maximum = maximum;
  writeFileSync(schemaFile, `${JSON.stringify(schema, null, 2)}\n`);
  const before = readFileSync(join(dir, GENERATED), 'utf8');
  // npm gets a home of its own for its logs and cache; it reads no registry to run a package's script.
  const npmHome = join(tempDir(), 'npm');
  mkdirSync(npmHome);
  out.generate = await run('npm', ['run', 'generate', '-w', '@deepbuild/contracts'], { cwd: dir, env: toolEnv({ HOME: npmHome, npm_config_cache: join(npmHome, 'cache'), npm_config_update_notifier: 'false' }), timeoutMs: 10 * MINUTE });
  out.generatedChanged = readFileSync(join(dir, GENERATED), 'utf8') !== before;
  if (out.generate.code !== 0) return out;
  const error = cargoHook(dir, toolEnv({ ...CARGO_ENV, CARGO_TARGET_DIR: join(OWN, 'target') }));
  if (error) { out.build = { bin: out.build.bin, error }; return out; }
  copyFileSync(join(OWN, 'target', 'debug', 'deep-hook'), out.build.bin);
  out.build = warmed(out.build.bin);
  return out;
}

// ---- A Claude Code PreToolUse for a shell command, shaped like the corpus's payloads (adapters/corpus/claude-code).
export interface Session { id: string; cwd: string; transcript: string }
export function newSession(home: string): Session {
  const id = randomUUID();
  const cwd = join(dirname(home), 'work');
  mkdirSync(cwd, { recursive: true });
  const transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript };
}
export const preToolUse = (s: Session, command: string): Line => ({
  session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: 'PreToolUse', permission_mode: 'default',
  tool_name: 'Bash', tool_input: { command }, tool_use_id: `toolu_${randomBytes(12).toString('hex')}`,
});
/** deep-hook as a hook entry runs it: `deep-hook claude-code PreToolUse`, the hook JSON on stdin, HOME the agent's. */
export const hook = (bin: string, home: string, s: Session, body: Line): Promise<Ran> =>
  run(bin, ['claude-code', 'PreToolUse'], { cwd: s.cwd, env: childEnv(home), input: JSON.stringify(body), timeoutMs: MINUTE });

// ---- The stand-in hub: this process listening on the home's own address, ~/.deepbuild/hub.sock. It speaks just
// enough of the hub's line protocol (design: Hook protocol) to write the lines a test plants: its hello, then, for
// each request line it reads, whatever `answer` returns for that request, in one write. It is never the hub under test.
export interface StandIn { socket: string; requests: Line[]; wrote: string[]; close(): Promise<void> }
export function standIn(home: string, answer: (request: Line) => string[]): Promise<StandIn> {
  const socket = join(home, '.deepbuild', 'hub.sock');
  rmSync(socket, { force: true });
  const sockets = new Set<net.Socket>();
  const hub: StandIn = {
    socket, requests: [], wrote: [],
    close: () => new Promise((done) => { for (const s of sockets) s.destroy(); server.close(() => done()); }),
  };
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('error', () => undefined);
    sock.on('close', () => sockets.delete(sock));
    sock.write(`${JSON.stringify({ v: 1, hello: 'deep-hub', start: 'stand-in-3421', features: [] })}\n`);
    let buffer = '';
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const request = parseObject(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (!request) continue;
        hub.requests.push(request);
        const lines = answer(request);
        hub.wrote.push(...lines);
        if (lines.length && !sock.destroyed) sock.write(lines.map((l) => `${l}\n`).join(''));
      }
    });
  });
  return new Promise((done, failed) => { server.once('error', failed); server.listen(socket, () => done(hub)); });
}
/** The hub's two lines for a request, as the design writes them. */
export const ackLine = (id: unknown, more: Line = {}): string => JSON.stringify({ v: 1, ack: id, hold_until_ms: null, ...more });
export const replyLine = (exit: number, stdout: string, stderr = ''): string => JSON.stringify({ v: 1, exit, stdout, stderr });
/** A ULID's 26 characters that no request of a test carries: its time part is the year 2000's. */
export const otherUlid = (): string => {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  return `00V${[...randomBytes(23)].map((b) => alphabet[b % 32]).join('')}`;
};
export const nonce = (): string => `n3421${randomBytes(9).toString('hex')}`;

// ---- The spool: <home>/.deepbuild/spool/*.jsonl. With the hub away deep-hook spools its request, and marks it
// `late` when the hub was there but didn't acknowledge in time (design: Hook protocol).
export function spooled(home: string): Line[] {
  const dir = join(home, '.deepbuild', 'spool');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()
    .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').flatMap((raw) => { const l = parseObject(raw); return l ? [l] : []; }));
}

/**
 * One planted exchange: a fresh home, the stand-in answering with `answer`'s lines, one hook call. `how` is what the
 * spool shows of it:
 * - `refused`: the request is spooled with no `late` mark. The hub's lines reached deep-hook inside its windows, and
 *   it counted the hub as away.
 * - `late`: the request is spooled marked late, the stand-in never read it, or the hook was killed at its timeout. On
 *   a busy machine the stand-in can miss the 20 ms it has to acknowledge; such a run says nothing of the planted lines.
 * - `none spooled`: the reply was taken, or a busy disk lost the spooled copy of a call the hub was away for.
 */
export interface Exchange { ran: Ran; request: Line | undefined; wrote: string[]; spool: Line[]; how: 'refused' | 'late' | 'none spooled' }
export async function exchange(bin: string, answer: (request: Line) => string[]): Promise<Exchange> {
  const home = makeHome();
  const session = newSession(home);
  const hub = await standIn(home, answer);
  try {
    const body = preToolUse(session, 'echo hi');
    const ran = await hook(bin, home, session, body);
    const request = hub.requests.find((r) => r.payload?.tool_use_id === body.tool_use_id);
    const spool = spooled(home).filter((l) => l.payload?.tool_use_id === body.tool_use_id);
    const read = request !== undefined && hub.wrote.length > 0 && !ran.timedOut;
    const how = !read || spool.some((l) => l.late === true) ? 'late' : spool.length ? 'refused' : 'none spooled';
    return { ran, request, wrote: [...hub.wrote], spool, how };
  } finally {
    await hub.close();
  }
}
/**
 * Whether a reply reads as the hub-away reply `away`: the same exit code and the same stdout, byte for byte. stderr is
 * left to the caller: with the hub away deep-hook may add a line of its own there about its spool (that a busy disk
 * didn't finish syncing it in the hook's time, naming the event's new ID), so it differs between two runs of one call.
 */
export const readsAway = (ran: Ran, away: Ran): boolean => !ran.timedOut && ran.code === away.code && ran.signal === away.signal && ran.stdout === away.stdout;
/**
 * Runs the planted exchange until one tells of the planted lines, at most `tries` times, and returns it with the count:
 * one deep-hook refused in time, or one that doesn't read as the hub away (the hub's reply, taken). A run that was
 * late, or that reads as the hub away with nothing spooled to say why, is run again.
 */
export async function exchangeInTime(bin: string, away: Ran, answer: (request: Line) => string[], tries = 40): Promise<Exchange & { tries: number; told: boolean }> {
  let last: Exchange | undefined;
  for (let n = 1; n <= tries; n++) {
    last = await exchange(bin, answer);
    if (last.how === 'refused' || (last.how === 'none spooled' && !readsAway(last.ran, away))) return { ...last, tries: n, told: true };
  }
  return { ...last!, tries, told: false };
}
/** deep-hook with no hub at the address: the reply the hub being away gives this call. */
export async function hubAway(bin: string): Promise<Ran> {
  const home = makeHome();
  const session = newSession(home);
  return hook(bin, home, session, preToolUse(session, 'echo hi'));
}
