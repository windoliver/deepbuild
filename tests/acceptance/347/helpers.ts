// Shared test-side tools for issue #347's acceptance tests (README): a temp world (a home with the shipped default
// guards, your ask settings, the staging settings and the OS-confirmation stub; a git repository with a tiny npm
// project and a tiny Cargo project, and folders git can't restore), the hub as a process with its test settings, the
// record read back through the hub's socket (`events.read`), Claude Code sessions driven through the real deep-hook
// binary with payloads and transcripts shaped like the corpus's, `deep undo`, and the judgements each criterion
// reads. Parts are adapted from tests/acceptance/321/helpers.ts (same repo, same license); this suite keeps its own
// copy so a redraft of that one never moves these tests. Nothing here stands in for DeepBuild: every decision comes
// from the real hub, deep-hook and CLI. The test plays Claude Code: it fires each hook through deep-hook and runs a
// command (with /bin/bash, in the repository) only when deep-hook's PreToolUse allows it, as Claude Code does.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
export const PRIVATE_SIZE_C = fileURLToPath(new URL('./fixtures/private-size.c', import.meta.url));
export const DAY = 86_400_000;

/** Each criterion's ID: `#347.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC1 = '#347.3abdadd8';
export const AC2 = '#347.f308d7e8';
export const AC3 = '#347.8c6cfb34';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const tag = (n = 4) => randomBytes(n).toString('hex');
export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
const facts = JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[]; hookTimeouts: { defaultMs: number; perHook?: Record<string, number> } };
/** The newest Claude Code version the facts cover: every transcript entry carries it, so no session is watch-only. */
export const COVERED = facts.versions[facts.versions.length - 1]!;
/** "Before the agent's hook timeout": Claude Code's PreToolUse timeout, from its facts (hookTimeouts), 60 s at the base. */
export const HOOK_TIMEOUT_MS = facts.hookTimeouts.perHook?.PreToolUse ?? facts.hookTimeouts.defaultMs;
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;

// ---- Verdicts. A judgement throws an Error naming the criterion; INCONCLUSIVE is a skip, never a pass.
/** A reading the machine spoiled: a hook whose acknowledgement came too late, so the hub never decided its call. */
export class Inconclusive extends Error {}
export async function verdict(ctx: TestContext, judge: () => Promise<void>): Promise<void> {
  try {
    await judge();
  } catch (error) {
    if (error instanceof Inconclusive) ctx.skip(`INCONCLUSIVE ${error.message}`);
    throw error;
  }
}
/**
 * The message a scenario throws on a planted program, or null when it holds. A BLOCKED setup (the plant isn't there
 * to start) and an INCONCLUSIVE reading are thrown on, never read as the plant's failure.
 */
export async function failureOf(judge: () => Promise<void>): Promise<string | null> {
  try {
    await judge();
    return null;
  } catch (error) {
    if (error instanceof Inconclusive) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('BLOCKED:')) throw error;
    return message;
  }
}
/**
 * Throws `message` unless `ok`. A message that reads a value which may be missing exactly when the assertion holds
 * (a handle, a date) is passed as a function, so it is built only on failure.
 */
export function must(ok: boolean, message: string | (() => string)): asserts ok {
  if (!ok) throw Error(typeof message === 'function' ? message() : message);
}

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh347-'));
  made.push(dir);
  return dir;
}

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
export function own(pid: number | undefined): void {
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
/** Stops every process this suite started (SIGCONT and SIGTERM, then SIGKILL after 3 s) and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) {
    try { process.kill(pid, 'SIGCONT'); } catch { /* gone */ }
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  agents.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/**
 * The environment a child gets: HOME the world's home and TMPDIR the world's own temp folder, so whatever the hub,
 * deep-hook or a command writes stays inside the world; npm offline with no update check; no DEEP_/GIT_/XDG_/CLAUDE/
 * CARGO/RUSTUP/npm settings or billing keys of this process's.
 */
export function childEnv(w: { home: string; tmp: string }, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|GIT_|CLAUDE|CARGO|RUSTUP|npm_)/i.test(key) || key === 'NODE_OPTIONS' || key === 'TMPDIR' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = w.home;
  env.TMPDIR = join(w.tmp, 't');
  env.XDG_CONFIG_HOME = join(w.home, '.config');
  env.XDG_CACHE_HOME = join(w.home, '.cache');
  env.PATH = `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  env.LC_ALL = 'C';
  env.npm_config_offline = 'true';
  env.npm_config_update_notifier = 'false';
  env.npm_config_fund = 'false';
  env.npm_config_audit = 'false';
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean; ended: number }
/** Runs a command to its end without blocking this process's event loop. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 60_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;

// ---- A world: a home and a repository.
/** Your ask settings (#319's shape): setup's drafts with no `batch`, so every ask shows when it's raised. */
export const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
/** How long a staged copy is kept (README, Surfaces): `staging.keep`, a duration as the ask deadlines are written. */
export const KEEP = '3d';
export const KEEP_MS = 3 * DAY;
/** The staging settings (README, Surfaces): `staging` in ~/.deepbuild/config.json. */
export interface Staging { files: number; seconds: number; keep: string }
/** The settings every test uses but the seconds-ceiling one: the issue's 1,000-file ceiling, 20 s, kept 3 days. */
export const STAGING: Staging = { files: 1000, seconds: 20, keep: KEEP };

export interface World { tmp: string; home: string; root: string; repo: string; confirm: string; tag: string; extra: Record<string, string | undefined> }
const git = (repo: string, tmp: string, args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
  cwd: repo, encoding: 'utf8',
  env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
});
/**
 * `<tmp>/h` is HOME for every process: the hub's root `<home>/.deepbuild` holds the shipped default guards as the
 * first rules.json (as #304's suite seeds it) and config.json with your ask settings and `staging`. `<tmp>/t` is every
 * child's TMPDIR. `<tmp>/confirm` says `confirmed`: the OS confirming you, should `deep undo` ask it
 * (DEEP_HUB_TEST_CONFIRM, #24's stub). `<tmp>/repo` is a git repository with one commit on main, the folder every
 * session works in: a tiny npm project (`npm test` runs test.js, `npm run build` runs build.js, which rewrites
 * dist/), a tiny Cargo project, and a .gitignore for build/, dist/, cache/ and target/, so what is in them is
 * ignored: files git can't restore. None of the scripts is ever changed by a session.
 */
export function makeWorld(staging: Staging = STAGING): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(tmp, 't'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS, staging }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const repo = join(tmp, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  git(repo, tmp, ['init', '-q', '-b', 'main']);
  writeFileSync(join(repo, '.gitignore'), 'build/\ndist/\ncache/\ntarget/\n');
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'shop', version: '1.0.0', private: true, scripts: { test: 'node test.js', build: 'node build.js' } }, null, 2)}\n`);
  writeFileSync(join(repo, 'test.js'), "const assert = require('node:assert');\nconst { total } = require('./src/cart.js');\nassert.strictEqual(total([2, 3]), 5);\nconsole.log('1 test passed');\n");
  writeFileSync(join(repo, 'build.js'), "const fs = require('node:fs');\nfs.rmSync('dist', { recursive: true, force: true });\nfs.mkdirSync('dist');\nfs.writeFileSync('dist/cart.js', fs.readFileSync('src/cart.js'));\nconsole.log('built dist/cart.js');\n");
  writeFileSync(join(repo, 'src', 'cart.js'), 'exports.total = (items) => items.reduce((a, b) => a + b, 0);\n');
  writeFileSync(join(repo, 'Cargo.toml'), '[package]\nname = "shop-tool"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n');
  writeFileSync(join(repo, 'src', 'main.rs'), 'fn main() {\n    println!("shop tool");\n}\n');
  git(repo, tmp, ['add', '.']);
  git(repo, tmp, ['commit', '-q', '-m', 'base']);
  return { tmp, home, root, repo: realpathSync(repo), confirm, tag: tag(), extra: {} };
}

// ---- Folders of files, their bytes, and where copies of them are.
/** A folder's files: relative path -> SHA-256 of the bytes. */
export type Tree = Map<string, string>;
export interface Filled { dir: string; tree: Tree; names: Set<string>; big: string[] }
/**
 * Fills `<repo>/<folder>` with `count` files spread over sub-folders of `perDir`, each with its own bytes and a name
 * unique to this world (`<prefix>-<world tag>-<n>.dat`), so a copy anywhere in the world is found by name. The first
 * `big` files hold 64 KiB of random bytes, so APFS gives them blocks a clone can share.
 */
export function fill(w: World, folder: string, count: number, o: { perDir?: number; big?: number; prefix?: string } = {}): Filled {
  const dir = join(w.repo, folder);
  const perDir = o.perDir ?? 10;
  const prefix = o.prefix ?? folder.replace(/[^a-z0-9]/gi, '');
  const tree: Tree = new Map();
  const names = new Set<string>();
  const big: string[] = [];
  for (let n = 0; n < count; n++) {
    const sub = join(dir, `part${String(Math.floor(n / perDir)).padStart(3, '0')}`);
    if (n % perDir === 0) mkdirSync(sub, { recursive: true });
    const name = `${prefix}-${w.tag}-${n}.dat`;
    const bytes = n < (o.big ?? 0) ? randomBytes(65_536) : Buffer.from(`${name} ${randomBytes(16).toString('hex')}\n`);
    const file = join(sub, name);
    writeFileSync(file, bytes);
    tree.set(relative(dir, file), createHash('sha256').update(bytes).digest('hex'));
    names.add(name);
    if (n < (o.big ?? 0)) big.push(file);
  }
  return { dir, tree, names, big };
}
/** Every file under `dir` (none when it is gone), by relative path, with the SHA-256 of its bytes. */
export function treeOf(dir: string): Tree {
  const tree: Tree = new Map();
  if (!existsSync(dir)) return tree;
  for (const rel of readdirSync(dir, { recursive: true }) as string[]) {
    const file = join(dir, rel);
    if (lstatSync(file).isFile()) tree.set(rel, createHash('sha256').update(readFileSync(file)).digest('hex'));
  }
  return tree;
}
/** How `now` differs from `was`, in words, or null when every file is there with its bytes and nothing else is. */
export function treeDiff(was: Tree, now: Tree): string | null {
  const missing = [...was.keys()].filter((k) => !now.has(k));
  const changed = [...was.keys()].filter((k) => now.has(k) && now.get(k) !== was.get(k));
  const extra = [...now.keys()].filter((k) => !was.has(k));
  if (!missing.length && !changed.length && !extra.length) return null;
  const some = (l: string[]) => `${l.length}${l.length ? ` (${l.slice(0, 3).join(', ')}${l.length > 3 ? ', …' : ''})` : ''}`;
  return `${now.size} of its ${was.size} files are there; missing ${some(missing)}, with other bytes ${some(changed)}, not there before ${some(extra)}`;
}
/**
 * Files anywhere in the world (home, the hub's root, TMPDIR, the repository and its .git) named as one of `names`,
 * outside `home`, the folder they were made in: a copy of them, wherever the stager put it.
 */
export function copiesOf(w: World, names: Set<string>, home: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const path = join(dir, e.name);
      if (path === home || path.startsWith(home + sep)) continue;
      if (e.isDirectory()) walk(path);
      else if (names.has(e.name)) found.push(path);
    }
  };
  walk(w.tmp);
  return found;
}
/** Waits up to `ms` for no copy of `names` to remain outside `home`; the copies still there when it gives up. */
export async function noCopies(w: World, names: Set<string>, home: string, ms: number): Promise<string[]> {
  const deadline = Date.now() + ms;
  for (;;) {
    const left = copiesOf(w, names, home);
    if (!left.length || Date.now() > deadline) return left;
    await sleep(500);
  }
}

// ---- Copy-on-write, read from APFS: the bytes private to a file, which a clone of it shares (fixtures/private-size.c).
let reader: string | undefined;
function privateSizeReader(): string {
  if (reader && existsSync(reader)) return reader;
  const out = join(tempDir(), 'private-size');
  try {
    execFileSync('cc', ['-O2', '-o', out, PRIVATE_SIZE_C], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    throw Error(`BLOCKED: fixtures/private-size.c, which reads whether a file shares its blocks with a clone, didn't compile with cc (install the Xcode command line tools): ${error instanceof Error ? error.message : String(error)}`);
  }
  return (reader = out);
}
/** Each file's private bytes: its size until a clone shares its blocks, then 0; undefined where APFS doesn't say. */
export function privateSizes(files: readonly string[]): Map<string, number | undefined> {
  const out = execFileSync(privateSizeReader(), files, { encoding: 'utf8' });
  const sizes = new Map<string, number | undefined>();
  for (const row of out.trim().split('\n')) {
    const [file, value] = row.split('\t');
    sizes.set(file!, value === 'unknown' ? undefined : Number(value));
  }
  return sizes;
}
/** The control: each big file's blocks are its own before anything runs, or this file system can't show a clone. */
export function expectPrivate(files: readonly string[]): void {
  for (const [file, size] of privateSizes(files)) {
    if (size !== 65_536) throw Error(`BLOCKED: ${file} must start with its 64 KiB private (no clone shares it) for the test to read a copy-on-write copy; this file system reads ${size ?? 'unknown'} (APFS is needed)`);
  }
}

// ---- The hub as a process: `deep hub run`, HOME the world's.
export interface Hub { pid: number; socket: string; home: string; root: string; child: ChildProcess; exit: Promise<void>; readyAt: number; clock: number | undefined; stderr(): string }
export interface HubOptions {
  /** DEEP_HUB_PLANT, on the hub and on every deep-hook run of the sessions made after. */
  plant?: string | undefined;
  /** DEEP_HUB_TEST_CLOCK: the hub's clock starts there and moves with real time. */
  clock?: number | undefined;
  /** DEEP_HUB_TEST_SLOW_CLONE_MS, on the hub and on every deep-hook run: each clone the stager makes waits this long. */
  slowCloneMs?: number | undefined;
}
/**
 * Starts `deep hub run` with DEEP_HUB_TEST_CONFIRM, and with DEEP_HUB_PLANT, DEEP_HUB_TEST_CLOCK and
 * DEEP_HUB_TEST_SLOW_CLONE_MS when given; the plant and the slow clones also go to every session made after. A hub
 * that doesn't start (a plant the base doesn't list) is BLOCKED.
 */
export async function startHub(w: World, o: HubOptions = {}): Promise<Hub> {
  w.extra = { DEEP_HUB_PLANT: o.plant, DEEP_HUB_TEST_SLOW_CLONE_MS: o.slowCloneMs === undefined ? undefined : String(o.slowCloneMs) };
  const env = childEnv(w, {
    ...w.extra,
    DEEP_HUB_TEST_CONFIRM: w.confirm,
    DEEP_HUB_TEST_CLOCK: o.clock === undefined ? undefined : String(Math.round(o.clock)),
  });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!));
      });
    }),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub${o.plant ? ` with the plant DEEP_HUB_PLANT=${o.plant}` : ''} did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, readyAt: Date.now(), clock: o.clock, stderr: () => err };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGCONT'); } catch { /* gone */ }
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 30_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(50);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  await hub.exit;
}

// ---- The record, read back through the hub's socket as the CLI reads it (the cli role, with the control token).
export function control(hub: Hub, method: string, params: Line, timeoutMs = 30_000): Promise<Line> {
  const token = readFileSync(join(hub.root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = parseObject(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (step === 0) {
          step = 1;
          sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
        } else if (step === 1 && line?.role !== undefined) {
          step = 2;
          sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`);
        } else if (step === 2 && line?.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          if (line.error) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`));
          else resolve(line.result as Line);
        }
      }
    });
  });
}
export interface Ev { id: string; kind: string; log_pos: number; ts: number; writer?: string; subject?: string; session?: string; data: Line }
export async function allEvents(hub: Hub): Promise<Ev[]> {
  const out: Ev[] = [];
  let after = 0;
  for (;;) {
    const events = (await control(hub, 'events.read', { after, limit: 1000 })).events as Ev[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos;
  }
}
export async function lastPos(hub: Hub): Promise<number> {
  const events = await allEvents(hub);
  return events.length ? events[events.length - 1]!.log_pos : 0;
}
/** The asks raised after `since` whose question names `command`. */
export async function asksNaming(hub: Hub, since: number, command: string): Promise<Ev[]> {
  return (await allEvents(hub)).filter((e) => e.kind === 'ask.created' && e.log_pos > since && String(e.data?.question ?? '').includes(command));
}
export const askHandle = (ask: Ev) => `ask:${ask.id}`;
/** The staging the record holds for the call `id` (README, Surfaces): a `command.staged` event whose `data.call` is it. */
export async function stagingOf(hub: Hub, id: string): Promise<Ev | undefined> {
  return (await allEvents(hub)).find((e) => e.kind === 'command.staged' && e.data?.call === id);
}
export const stagedHandle = (staged: Ev) => `staged:${staged.id}`;

// ---- Each session's Claude Code (fixtures/agent.mjs): one long-lived process per session, the parent of every
// deep-hook run of that session, as Claude Code is of its hook commands. `deep undo`, run by this test process, is
// outside every session's process tree, as your terminal is.
class Agent {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Ran) => void>();
  private constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = parseObject(this.buffer.slice(0, i));
        this.buffer = this.buffer.slice(i + 1);
        if (!line || typeof line.n !== 'number') continue;
        if ('pid' in line && !('code' in line)) { own(Number(line.pid)); continue; }
        const done = this.pending.get(line.n);
        this.pending.delete(line.n);
        done?.(line as unknown as Ran);
      }
    });
    child.on('exit', () => {
      for (const [n, done] of [...this.pending]) {
        this.pending.delete(n);
        done({ code: null, signal: null, stdout: '', stderr: 'the session\'s agent process exited', ms: 0, timedOut: false, ended: Date.now() });
      }
    });
  }
  static start(w: World): Agent {
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w, w.extra), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Agent(child);
  }
  run(args: readonly string[], cwd: string, input: string, timeoutMs: number): Promise<Ran> {
    const n = ++this.n;
    return new Promise((resolve) => {
      this.pending.set(n, resolve);
      this.child.stdin!.write(`${JSON.stringify({ n, args, cwd, input, timeoutMs })}\n`);
    });
  }
}
const agents = new Map<string, Agent>();

// ---- Claude Code sessions: hook payloads and transcripts shaped like the corpus's (adapters/corpus/claude-code).
export interface Session { id: string; cwd: string; transcript: string; prompt?: string }
/** A session: its transcript, and its own Claude Code process that runs its hooks (made after the hub starts). */
export function newSession(w: World): Session {
  const id = randomUUID();
  const transcript = join(w.home, '.claude/projects', w.repo.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  agents.set(id, Agent.start(w));
  return { id, cwd: w.repo, transcript };
}
function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, output_tokens: 10 } } });
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt && event !== 'SessionStart') base.prompt_id = s.prompt;
  if (event === 'SessionStart') Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' });
  return { ...base, ...extra };
}
/**
 * deep-hook as Claude Code runs our hook entry: `deep-hook claude-code <event>`, the payload on stdin, a child of the
 * session's own Claude Code process. Stopped 30 s past Claude Code's PreToolUse timeout, so a reply later than that
 * timeout reads as one.
 */
export function fire(body: Line, timeoutMs = HOOK_TIMEOUT_MS + 30_000): Promise<Ran> {
  const agent = agents.get(String(body.session_id));
  if (!agent) throw Error(`BLOCKED: no Claude Code process for session ${String(body.session_id)}; make sessions with newSession`);
  return agent.run(['claude-code', String(body.hook_event_name)], String(body.cwd), JSON.stringify(body), timeoutMs);
}
/** What deep-hook's output tells Claude Code: exit 2 or a deny/block decision stops the call; exit 0 lets it go. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
/** A session's start and your prompt: SessionStart, then the prompt's transcript entry and its UserPromptSubmit. */
export async function begin(s: Session, text: string): Promise<void> {
  const started = await fire(payload(s, 'SessionStart'));
  if (started.code !== 0) throw Error(`BLOCKED: the SessionStart hook must end with exit 0: ${shown(started)}`);
  const promptId = randomUUID();
  s.prompt = promptId;
  appendTranscript(s, { type: 'user', promptId, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  const r = await fire(payload(s, 'UserPromptSubmit', { prompt: text }));
  if (r.code !== 0) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
}
let calls = 0;
const callId = () => `toolu_${randomBytes(10).toString('hex')}${++calls}`;
/** One call: its tool_use in the transcript, then its PreToolUse through deep-hook; the call's ID, when it started, and the reply. */
export interface Pre { id: string; started: number; r: Ran }
export async function pre(s: Session, tool: string, input: Line): Promise<Pre> {
  const id = callId();
  appendTranscript(s, assistant([{ type: 'tool_use', id, name: tool, input }], 'tool_use'));
  const started = Date.now();
  const r = await fire(payload(s, 'PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: id }));
  return { id, started, r };
}
/** The call's result in the transcript and its PostToolUse through deep-hook. */
export async function post(s: Session, tool: string, input: Line, id: string, response: Line, text: string): Promise<void> {
  appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: text }] } });
  await fire(payload(s, 'PostToolUse', { tool_name: tool, tool_input: input, tool_use_id: id, tool_response: response }));
}
/**
 * deep-hook's own words, which only it prints when it decides a call without the hub's reply (crates/deep-hook
 * main.rs `forward`, `spool_by`, `watchdog`): a fail_closed entry's denial "(guard …, which holds while the hub doesn't
 * answer)", the watchdog's "deep-hook couldn't read …", and a spool that ran out of time. The hub's own denial of the
 * same entry ends "(guard …)" with none of these.
 */
const OWN_WORDS = /which holds while the hub doesn't answer|^deep-hook: (?:spooled|could not spool)|deep-hook couldn't read/m;
/**
 * Why the hub never decided this call, or undefined when nothing shows that it didn't. deep-hook decides alone when
 * the hub's acknowledgement misses its 20 ms, or its reply misses the hold. The hub can read the request and record it
 * live before it sees deep-hook gone, and the spooled copy marked late is then dropped as a duplicate, so `late` on the
 * `tool.before` isn't enough. Read, in turn:
 * - deep-hook's own words on stderr (OWN_WORDS): every denial it makes alone prints them;
 * - no `tool.before` for the call within 10 s: the hub never had it;
 * - a `tool.before` marked `late`: the spooled copy is the one recorded;
 * - the hub's `session.reading` "deep-hook let PreToolUse <id> through as late", which it appends when it replays a
 *   spooled copy marked late of a call it had recorded live (core.ts `lateAnswered`). The replay starts at the next
 *   hook that reaches the hub, so a caller reads this after one; it waits up to `readingMs` for it.
 * An allow by deep-hook's watchdog, with the main thread starved past 48 ms before it sent or read anything it could
 * spool, leaves none of these (README, INCONCLUSIVE).
 */
export async function decidedAlone(hub: Hub, p: Pre, readingMs = 0): Promise<string | undefined> {
  const own = OWN_WORDS.exec(p.r.stderr);
  if (own) return `deep-hook decided it alone, its stderr in its own words ("${p.r.stderr.split('\n').find((l) => OWN_WORDS.test(l))}")`;
  let before: Ev | undefined;
  const deadline = Date.now() + 10_000;
  while (!(before = (await allEvents(hub)).find((e) => e.kind === 'tool.before' && e.data?.call === p.id)) && Date.now() < deadline) await sleep(250);
  if (!before) return 'the hub recorded no tool.before for it in 10 s, so it never had the call';
  if (before.data.late === true) return 'its tool.before is the spooled copy, marked late';
  const until = Date.now() + readingMs;
  for (;;) {
    const reading = (await allEvents(hub)).find((e) => e.kind === 'session.reading' && String(e.data?.reading ?? '').includes(before.id) && /through as late/.test(String(e.data?.reading)));
    if (reading) return `the hub recorded "${String(reading.data.reading)}"`;
    if (Date.now() >= until) return undefined;
    await sleep(250);
  }
}
const lateWords = (command: string, p: Pre, why: string) => `\`${command}\` was decided without the hub: ${why} (${shown(p.r)}), so the hub never decided it; read at ${loadReading()}`;

/**
 * The agent writes `file` with its Write tool: allowed at PreToolUse, written, then PostToolUse. This is how the
 * session's own change to a file reaches DeepBuild: through the hooks, as Claude Code sends them.
 */
export async function agentWrites(s: Session, file: string, content: string): Promise<void> {
  const input = { file_path: file, content };
  const p = await pre(s, 'Write', input);
  if (decision(p.r) !== 'allow') throw Error(`BLOCKED: the session's Write of ${file} must be allowed: ${shown(p.r)}`);
  writeFileSync(file, content);
  await post(s, 'Write', input, p.id, { type: 'create', filePath: file, content, structuredPatch: [] }, `File created successfully at: ${file}`);
}

/** The folder holding the Rust toolchain's cargo, found once through rustup; undefined where there is none. */
let toolchain: string | null | undefined;
function cargoDir(): string | undefined {
  if (toolchain === undefined) {
    try {
      toolchain = dirname(execFileSync('rustup', ['which', 'cargo'], { cwd: '/', encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
    } catch {
      try { toolchain = dirname(execFileSync('/bin/sh', ['-c', 'command -v cargo'], { encoding: 'utf8' }).trim()); } catch { toolchain = null; }
    }
  }
  return toolchain ?? undefined;
}
/**
 * Claude Code running an allowed shell call: `/bin/bash -c <command>` in the repository, as the world's user. cargo
 * runs offline from the toolchain's own folder, with a CARGO_HOME of the world's.
 */
export async function runCommand(w: World, s: Session, command: string, id: string): Promise<Ran> {
  const extra: Record<string, string> = { CARGO_HOME: join(w.tmp, 'cargo'), CARGO_NET_OFFLINE: 'true' };
  const cargo = cargoDir();
  if (cargo) extra.PATH = `${cargo}:${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  const r = await run('/bin/bash', ['-c', command], { cwd: s.cwd, env: childEnv(w, extra), timeoutMs: 300_000 });
  const input = { command, description: command };
  await post(s, 'Bash', input, id, { stdout: r.stdout, stderr: r.stderr, interrupted: false, isImage: false }, `${r.stdout}${r.stderr}`);
  return r;
}

// ---- The judgements the criteria read (README, What each judgement reads).
/** Whether `folders` (the record's list) names `dir`, as written or as it resolves. */
function names(folders: unknown, dir: string): boolean {
  if (!Array.isArray(folders)) return false;
  const real = realpathSync(dir);
  return folders.some((f) => {
    if (typeof f !== 'string') return false;
    const bare = f.replace(/\/+$/, '');
    if (bare === dir || bare === real) return true;
    try { return realpathSync(bare) === real; } catch { return false; }
  });
}
export interface Staged { handle: string; event: Ev; pre: Pre }
/**
 * "Runs only after the folders it names are staged as a copy-on-write copy kept for a set time": the agent's
 * `command` is allowed at PreToolUse, with no ask naming it; at the moment it is allowed, before it runs, each big file
 * of `folder` shares its blocks with a clone (APFS reads 0 bytes private to it), and the record holds the staging of
 * that call naming `folder`, kept until its time plus `staging.keep`. Then the command runs, as Claude Code would.
 */
export async function expectStaged(w: World, hub: Hub, s: Session, command: string, folder: Filled, who: string): Promise<Staged> {
  expectPrivate(folder.big);
  const since = await lastPos(hub);
  const input = { command, description: command };
  const p = await pre(s, 'Bash', input);
  const said = decision(p.r);
  if (said !== 'allow') {
    const alone = await decidedAlone(hub, p);
    if (alone) throw new Inconclusive(`${who} ${lateWords(command, p, alone)}`);
    const asked = await asksNaming(hub, since, command);
    throw Error(`${who} \`${command}\` must run once ${relative(w.repo, folder.dir)}/ is staged: deep-hook's PreToolUse ended ${said} (${shown(p.r)})${asked.length ? `, with ${asked.map((a) => `${askHandle(a)} ("${String(a.data.question)}")`).join(', ')}` : ''}; read at ${loadReading()}`);
  }
  // Claude Code runs the command as soon as the hook allows it: the copy must exist now.
  const sizes = privateSizes(folder.big);
  const unshared = [...sizes].filter(([, size]) => size !== 0);
  must(!unshared.length, `${who} \`${command}\` was allowed before ${relative(w.repo, folder.dir)}/ was staged as a copy-on-write copy: at the allow, ${unshared.length} of its ${folder.big.length} 64 KiB files share no block with a clone (private bytes ${unshared.map(([f, n]) => `${basename(f)} ${n ?? 'unknown'}`).join(', ')}), so no clone of them exists`);
  let event: Ev | undefined;
  const deadline = Date.now() + 10_000;
  while (!(event = await stagingOf(hub, p.id)) && Date.now() < deadline) await sleep(250);
  must(event !== undefined, `${who} the record must hold the staging of \`${command}\`: 10 s after its PreToolUse allowed it, no command.staged event has data.call ${p.id}`);
  must(names(event.data.folders, folder.dir), `${who} the staging of \`${command}\` (${stagedHandle(event)}) must name the folder it stages, ${folder.dir}: its folders are ${JSON.stringify(event.data.folders)}`);
  const until = Number(event.data.until);
  must(Number.isFinite(until) && Math.abs(until - (event.ts + KEEP_MS)) <= 120_000, () => `${who} the copy of ${folder.dir} must be kept for the set time, staging.keep ${KEEP}: ${stagedHandle(event)} at ${String(event.ts)} (ms) is kept until ${JSON.stringify(event.data.until)}, not ${String(event.ts + KEEP_MS)} (±2 min)`);
  const ran = await runCommand(w, s, command, p.id);
  must(ran.code === 0 && treeOf(folder.dir).size === 0, `BLOCKED: \`${command}\` must empty ${folder.dir} when it runs: ${shown(ran)}, ${treeOf(folder.dir).size} files left`);
  await sleep(2000);
  const asked = await asksNaming(hub, since, command);
  must(!asked.length, `${who} \`${command}\` is staged, so it runs with no ask: ${asked.map((a) => `${askHandle(a)} ("${String(a.data.question)}")`).join(', ')} asks about it`);
  return { handle: stagedHandle(event), event, pre: p };
}
/** `deep undo <handle>`, as you run it in your terminal (outside every session), the OS confirming you (DEEP_HUB_TEST_CONFIRM). */
export function undo(w: World, handle: string): Promise<Ran> {
  return run(NODE, [CLI, 'undo', handle], { env: childEnv(w), cwd: w.tmp, timeoutMs: 120_000 });
}
/** "The run can be undone from it": `deep undo` exits 0, and the folder holds each file it held, with its bytes, and nothing else. */
export async function expectUndone(w: World, staged: Staged, folder: Filled, command: string, who: string): Promise<void> {
  const r = await undo(w, staged.handle);
  must(r.code === 0, `${who} \`deep undo ${staged.handle}\` must undo the run of \`${command}\` from its copy, exit 0: ${shown(r)}`);
  const diff = treeDiff(folder.tree, treeOf(folder.dir));
  must(diff === null, `${who} after \`deep undo ${staged.handle}\`, ${folder.dir} must hold every file \`${command}\` deleted, with its bytes: ${diff}`);
}

/** The ask's words say the command's reach is unknown (README, What each judgement reads). */
export const REACH_UNKNOWN = /\breach\b[^.?!]*\b(unknown|not known|can(?:'|no|’)t be (?:known|worked out))|\bunknown reach\b/i;
/**
 * "Isn't staged: the partial copy is dropped, the command becomes an authority ask that says its reach is unknown
 * before the agent's hook timeout, and the folder keeps its files": the agent's `command` isn't allowed; deep-hook
 * replies before Claude Code's PreToolUse timeout, and by then the record holds an authority ask naming the command
 * whose words say its reach is unknown; the folder holds every file with its bytes; no staging of the call is
 * recorded; and no copy of the folder's files is left anywhere in the world 20 s after the reply. A call deep-hook
 * allows is run, as Claude Code runs it, and fails, counting what the folder has left.
 */
export async function expectAsked(w: World, hub: Hub, s: Session, command: string, folder: Filled, who: string): Promise<void> {
  const since = await lastPos(hub);
  const input = { command, description: command };
  const p = await pre(s, 'Bash', input);
  const said = decision(p.r);
  const count = folder.tree.size.toLocaleString('en-US');
  if (said === 'allow') {
    const ran = await runCommand(w, s, command, p.id);
    throw Error(`${who} \`${command}\` ran with no ask: deep-hook's PreToolUse allowed it after ${p.r.ms.toFixed(0)} ms (${shown(p.r)}); run as Claude Code runs it (${ran.code === 0 ? 'exit 0' : shown(ran)}), it left ${relative(w.repo, folder.dir)}/ with ${treeOf(folder.dir).size.toLocaleString('en-US')} of its ${count} files`);
  }
  // A reply deep-hook made alone came before the hub could ask: the timing and the ask can't be read from it.
  const alone = await decidedAlone(hub, p);
  if (alone) throw new Inconclusive(`${who} ${lateWords(command, p, alone)}`);
  must(!p.r.timedOut && p.r.ms < HOOK_TIMEOUT_MS, `${who} the reply to \`${command}\` must come before the agent's hook timeout, ${HOOK_TIMEOUT_MS / 1000} s (Claude Code's PreToolUse, its facts' hookTimeouts), since past it Claude Code runs the call: deep-hook took ${(p.r.ms / 1000).toFixed(1)} s (${shown(p.r)})`);
  const asks = await asksNaming(hub, since, command);
  must(asks.length > 0, `${who} \`${command}\` must become an authority ask that says its reach is unknown: no ask names it; deep-hook's PreToolUse ended ${said} after ${p.r.ms.toFixed(0)} ms (${shown(p.r)})`);
  const ask = asks[0]!;
  must(ask.data.kind === 'authority', `${who} the ask for \`${command}\` must be an authority ask: ${askHandle(ask)} was filed as ${String(ask.data.kind)} ("${String(ask.data.question)}")`);
  must(REACH_UNKNOWN.test(String(ask.data.question)), `${who} the ask for \`${command}\` must say its reach is unknown: ${askHandle(ask)} asks "${String(ask.data.question)}"`);
  must(ask.ts <= p.r.ended + 1000, () => `${who} the ask for \`${command}\` must be raised before the agent's hook timeout, by the time deep-hook replied (${new Date(p.r.ended).toISOString()}): ${askHandle(ask)} was raised at ${new Date(ask.ts).toISOString()}`);
  const diff = treeDiff(folder.tree, treeOf(folder.dir));
  must(diff === null, `${who} after the ask for \`${command}\`, ${relative(w.repo, folder.dir)}/ must keep its ${count} files: ${diff}`);
  const staged = await stagingOf(hub, p.id);
  must(staged === undefined, () => `${who} \`${command}\` must not be staged past the ceiling: the record holds ${stagedHandle(staged!)} for it, folders ${JSON.stringify(staged!.data.folders)}`);
  const left = await noCopies(w, folder.names, folder.dir, 20_000);
  must(!left.length, `${who} the partial copy of ${relative(w.repo, folder.dir)}/ must be dropped: 20 s after the ask, ${left.length} copies of its files are left, such as ${left.slice(0, 3).join(', ')}`);
}

/**
 * "Neither staged nor asked about": the agent's `command` is allowed at PreToolUse; no staging of that call is
 * recorded, and no copy of `guarded`'s files appears anywhere in the world (what a stager staging the working folder
 * would leave); the command then runs, as Claude Code runs it, and 2 s on no ask raised since names it. Returns what
 * went wrong, naming the command, or null.
 */
export async function neither(w: World, hub: Hub, s: Session, command: string, guarded: Filled, who: string): Promise<string | null> {
  const since = await lastPos(hub);
  const input = { command, description: command };
  const p = await pre(s, 'Bash', input);
  const said = decision(p.r);
  if (said !== 'allow') {
    const alone = await decidedAlone(hub, p);
    if (alone) throw new Inconclusive(`${who} ${lateWords(command, p, alone)}`);
    const asked = await asksNaming(hub, since, command);
    return `\`${command}\` must run with no ask and nothing staged: deep-hook's PreToolUse ended ${said} (${shown(p.r)})${asked.length ? `, and ${asked.map((a) => `${askHandle(a)} ("${String(a.data.question)}")`).join(', ')} asks about it` : ''}`;
  }
  const copies = copiesOf(w, guarded.names, guarded.dir);
  const ran = await runCommand(w, s, command, p.id);
  if (ran.code !== 0) throw Error(`BLOCKED: \`${command}\` must succeed in the test's project: ${shown(ran)}`);
  await sleep(2000);
  const staged = await stagingOf(hub, p.id);
  if (staged) return `\`${command}\` was staged: the record holds ${stagedHandle(staged)} for it, folders ${JSON.stringify(staged.data.folders)}`;
  if (copies.length) return `\`${command}\` was staged: at its allow, ${copies.length} copies of ${relative(w.repo, guarded.dir)}/'s files were in the world, such as ${copies.slice(0, 2).join(', ')}`;
  const asked = await asksNaming(hub, since, command);
  if (asked.length) return `\`${command}\` was asked about: ${asked.map((a) => `${askHandle(a)} ("${String(a.data.question)}")`).join(', ')}`;
  // Nothing staged and no ask is a pass only if the hub decided the call. The PostToolUse runCommand sent reached the
  // hub, which replays a spooled copy then; a late one shows as the hub's reading within 5 s.
  const alone = await decidedAlone(hub, p, 5000);
  if (alone) throw new Inconclusive(`${who} ${lateWords(command, p, alone)}`);
  return null;
}
