// Test-side tools for the blind redraft of two #39 criteria: a temp home, the hub as a process (`deep hub run`), its
// socket as the cli role, deep-hook as Codex's hook engine runs a command (`sh -c`, the payload on stdin), Codex
// payloads and rollouts shaped like adapters/corpus/codex, a stand-in `codex` on a temp PATH, and `deep inbox answer`
// with the OS-confirmation stub. Nothing here stands in for DeepBuild. Every process is stopped by PID, every folder
// is under /tmp/dh39r-*, HOME is a temp folder for every child; no live model, no network, no secret.
import { spawn, spawnSync, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
// A fresh checkout has no target/: built at load, so DEEP_HOOK stays a plain path. Cargo's lock serializes files loading this together.
if (!existsSync(DEEP_HOOK)) {
  const built = spawnSync('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REPO, encoding: 'utf8', timeout: 900_000 });
  if (built.status !== 0 || !existsSync(DEEP_HOOK)) throw Error(`BLOCKED: cargo build --locked -q -p deep-hook failed: ${built.error?.message ?? built.stderr.slice(-3000)}`);
}
export const NODE = process.execPath;
export const ACCOUNT = 'acct-dh39r';
/** The newest plain release the Codex facts cover: a stand-in and every rollout name it, so no session is watch-only. */
export const COVERED = (JSON.parse(readFileSync(join(REPO, 'adapters/codex.facts.json'), 'utf8')) as { versions: string[] }).versions.filter((v) => /^\d+\.\d+\.\d+$/.test(v)).at(-1)!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const parse = (raw: string): Line | undefined => { try { const v: unknown = JSON.parse(raw); return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Line) : undefined; } catch { return undefined; } };
export async function waitFor<T>(read: () => Promise<T | undefined | false>, ms: number, what: string, shown: () => Promise<string> | string = () => ''): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw Error(`waited ${ms} ms for ${what}; ${await shown()}`);
    await sleep(100);
  }
}

// ---- Folders and processes.
const made: string[] = [];
const owned = new Set<number>();
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh39r-'));
  made.push(dir);
  return dir;
}
const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
};
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const DROPPED = /^(DEEP_|XDG_|GIT_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|AWS_)|^NODE_OPTIONS$/;
export function childEnv(w: World, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!DROPPED.test(key)) env[key] = value;
  return { ...env, HOME: w.home, PATH: `${w.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, DEEP_HUB_TEST_CONFIRM: w.confirm, LC_ALL: 'C', ...extra };
}

export interface Ran { code: number | null; stdout: string; stderr: string; ms: number }
export function run(command: string, args: readonly string[], o: { env: NodeJS.ProcessEnv; cwd: string; input?: string; timeoutMs?: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 120_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, ms: performance.now() - t0 }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 800))}, stderr ${JSON.stringify(r.stderr.slice(0, 800))}`;

// ---- A world: a home with the hub's root, a git repo, the confirmation stub, and a folder on PATH for stand-ins.
export interface World { tmp: string; home: string; root: string; repo: string; bin: string; confirm: string }
const ASK_SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
export function makeWorld(): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  const bin = join(tmp, 'bin');
  const repo = join(tmp, 'repo');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(join(home, '.codex'), { recursive: true });
  mkdirSync(bin);
  mkdirSync(repo);
  // Setup finds a hub already answering, so it registers no login service; these make sure of it on this Mac.
  for (const name of ['launchctl', 'systemctl']) writeFileSync(join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: ASK_SETTINGS, runner: { login_path: `${bin}:/usr/bin:/bin` }, plan: { reserve_pct: 10 } }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const git = (args: string[]) => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo, encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  });
  git(['init', '-q', '-b', 'main']);
  writeFileSync(join(repo, 'README.md'), '# shop\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  return { tmp, home, root, repo, bin, confirm };
}
/** The stand-in `codex` (fixtures/fake-codex.sh) on the world's PATH, printing `codex exec --json` events as Codex does. */
export function installCodex(w: World): string {
  const text = readFileSync(fileURLToPath(new URL('./fixtures/fake-codex.sh', import.meta.url)), 'utf8').replace('__VERSION__', COVERED);
  const path = join(w.bin, 'codex');
  writeFileSync(path, text, { mode: 0o755 });
  return path;
}

// ---- The hub as a process, and its socket as the cli role.
export interface Hub { pid: number; socket: string; child: ChildProcess; exit: Promise<void>; stderr(): string }
export async function startHub(w: World): Promise<Hub> {
  if (!existsSync(CLI) || !existsSync(DEEP_HOOK)) throw Error(`BLOCKED: build first: npm run build --workspaces and cargo build --locked -q -p deep-hook (${CLI}, ${DEEP_HOOK})`);
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: w.tmp, env: childEnv(w), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  owned.add(child.pid!);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<void>((done) => child.on('exit', () => done()));
  const ready = await Promise.race([
    new Promise<Line | undefined>((done) => child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; if (out.includes('\n')) done(parse(out.split('\n')[0]!)); })),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid), socket: String(ready.socket), child, exit, stderr: () => err };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  await Promise.race([hub.exit, sleep(30_000)]);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  await hub.exit;
  owned.delete(hub.pid);
}
export function control(w: World, hub: Hub, method: string, params: Line, timeoutMs = 60_000): Promise<Line> {
  const token = readFileSync(join(w.root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method} in ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`); }
        else if (step === 1 && line?.role !== undefined) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (step === 2 && line?.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          if (line.error) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`));
          else resolve(line.result as Line);
        }
      }
    });
  });
}
export interface Ev { id: string; kind: string; log_pos: number; session?: string; subject?: string; data: Line }
export async function allEvents(w: World, hub: Hub): Promise<Ev[]> {
  const out: Ev[] = [];
  for (let after = 0; ;) {
    const events = (await control(w, hub, 'events.read', { after, limit: 1000 })).events as Ev[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos;
  }
}

// ---- Codex: a thread's payloads (adapters/corpus/codex) and its rollout, under the temp home.
export interface Thread { id: string; turn: string; cwd: string; transcript: string }
export function newThread(w: World, cwd: string, source: 'cli' | 'exec'): Thread {
  const id = randomUUID();
  const transcript = join(w.home, '.codex/sessions/2026/10/31', `rollout-2026-10-31T00-00-00-${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  const at = new Date().toISOString();
  const turn = randomUUID();
  const entries = [
    { timestamp: at, type: 'session_meta', payload: { session_id: id, id, timestamp: at, cwd, originator: 'codex-tui', cli_version: COVERED, source, model_provider: 'openai' } },
    { timestamp: at, type: 'turn_context', payload: { turn_id: turn, cwd, model: 'gpt-reserve' } },
    { timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 100, cache_write_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 0, total_tokens: 1050 }, last_token_usage: { input_tokens: 1000, cached_input_tokens: 100, cache_write_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 0, total_tokens: 1050 }, model_context_window: 258400 }, rate_limits: codexLimits() } },
  ];
  writeFileSync(transcript, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
  return { id, turn, cwd, transcript };
}
export function codexLimits(): Line {
  const soon = Math.floor(Date.now() / 1000) + 3 * 3600;
  return { limit_id: 'codex', limit_name: null, primary: { used_percent: 5, window_minutes: 300, resets_at: soon }, secondary: { used_percent: 20, window_minutes: 10080, resets_at: soon + 5 * 86400 }, credits: null, plan_type: 'plus' };
}
/** A hook's payload, with exactly the fields the facts' strict schema requires of the event, plus `extra`. */
export function payload(t: Thread, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: t.id, transcript_path: t.transcript, cwd: t.cwd, hook_event_name: event, model: 'gpt-reserve', permission_mode: 'default' };
  if (event !== 'SessionStart') base.turn_id = t.turn;
  return { ...base, ...extra };
}
/**
 * What Codex's hook engine does with a command hook: `sh -c <command>`, the payload on stdin. The shell stays the
 * hook's parent (it doesn't exec the last command), as a daemon's short-lived child is, so `deep inbox answer` run by
 * this test process isn't in any session's process tree.
 */
export function runCommand(w: World, command: string, body: Line): Promise<Ran> {
  return run('/bin/sh', ['-c', `${command}; exit $?`], { env: childEnv(w), cwd: String(body.cwd), input: JSON.stringify(body), timeoutMs: 120_000 });
}
const quoted = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
export const hook = (w: World, body: Line): Promise<Ran> => runCommand(w, `${quoted(DEEP_HOOK)} codex ${String(body.hook_event_name)}`, body);

/** A hook deep-hook spooled because the hub didn't acknowledge in time: the hub never decided it, so it proves nothing. */
export function spooled(w: World, r: Ran, session: string, event: string): boolean {
  if (/deep-hook: (spooled|could not spool)/.test(r.stderr)) return true;
  const dir = join(w.root, 'spool');
  if (!existsSync(dir)) return false;
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).some((f) => {
    let text = '';
    try { text = readFileSync(join(dir, f), 'utf8'); } catch { return false; }
    return text.split('\n').some((raw) => { const l = parse(raw); return l?.late === true && l.event === event && JSON.stringify(l.payload ?? {}).includes(session); });
  });
}

// ---- The reply a hook's stdout carries.
export function reply(r: Ran): Line | undefined { return parse(r.stdout.trim()); }

// ---- The subject the hub reads a permission prompt as (packages/hub/src/standing.ts, aboutPermission).
export const permissionSubject = (command: string): Line => ({ effect: 'permission', target: { kind: 'tool:Bash', ref: command, owner: `run:${command}` }, change: null });
export const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
