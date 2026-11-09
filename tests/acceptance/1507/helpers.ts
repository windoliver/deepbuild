// Test-side protocol driver adapted from acceptance/1294 and /347 (same repo, Apache-2.0).
// No implementation imports: real CLI, hook, socket record and shell. Fixtures are local copies.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

export const AC = ['#1507.38331cb5', '#1507.56b942ba', '#1507.0ecedf02', '#1507.04e8286c', '#1507.0f4ac05d'];
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const HOOK = join(REPO, 'target/debug/deep-hook');
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
const PRIVATE = fileURLToPath(new URL('./fixtures/private-size.c', import.meta.url));
// Unlike os.homedir(), the OS account's home is not fooled by the runner's overridden HOME.
const REAL_HOME = realpathSync(userInfo().homedir);
const facts = JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8'));
export const TIMEOUT = facts.hookTimeouts.perHook?.PreToolUse ?? facts.hookTimeouts.defaultMs;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = Record<string, any>;
export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
export function must(ok: unknown, message: string): asserts ok { if (!ok) throw Error(message); }
const dirs: string[] = [];
const children = new Set<ChildProcess>();
function track(child: ChildProcess): ChildProcess {
  children.add(child);
  child.once('close', () => children.delete(child));
  return child;
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise<void>((done) => child.once('close', () => done()));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  await ended;
  clearTimeout(timer);
}
export async function cleanup(): Promise<void> {
  await Promise.all([...children].map(stop));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}
export interface World { tmp: string; home: string; root: string; repo: string; confirm: string }
/** Called before any session exists, and again immediately before every shell invocation. */
export function safe(w: World): void {
  const tmp = realpathSync(w.tmp);
  const home = realpathSync(w.home);
  must(/^\/(?:private\/)?tmp\/dh1507-[^/]+$/.test(tmp), 'BLOCKED: world must be an owned /tmp/dh1507-* folder');
  must(dirs.includes(tmp) && home === join(tmp, 'h') && home !== REAL_HOME && !REAL_HOME.startsWith(home + sep), 'BLOCKED: test HOME must be owned and must not be or contain the real home');
  must(realpathSync(w.repo).startsWith(home + sep), 'BLOCKED: session worktree must be inside the test home');
}
function env(w: World, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { HOME: w.home, TMPDIR: join(w.tmp, 't'), XDG_CONFIG_HOME: join(w.home, '.config'), XDG_CACHE_HOME: join(w.home, '.cache'), PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...extra };
}
export function git(w: World, args: string[]): string {
  return execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: w.repo, encoding: 'utf8', env: env(w, { GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test' }) });
}
export function world(files = 1000): World {
  const tmp = realpathSync(mkdtempSync('/tmp/dh1507-'));
  dirs.push(tmp);
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  const repo = join(home, 'work', 'repo');
  const confirm = join(tmp, 'confirm');
  for (const dir of [root, repo, join(tmp, 't')]) mkdirSync(dir, { recursive: true });
  const w = { tmp, home, root, repo, confirm };
  safe(w);
  writeFileSync(join(root, 'rules.json'), readFileSync(join(REPO, 'crates/deep-hook/default-rules.json')));
  writeFileSync(join(root, 'config.json'), JSON.stringify({ staging: { files, seconds: 20, keep: '3d' }, asks: {
    deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
    default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' }, fallback: ['change-owner'], fold: 5,
  } }));
  writeFileSync(confirm, 'confirmed\n');
  git(w, ['init', '-q', '-b', 'main']);
  writeFileSync(join(repo, '.gitignore'), '.env\nnode_modules/\nbuild/\n');
  writeFileSync(join(repo, 'tracked.txt'), 'tracked fixture\n');
  git(w, ['add', '.']); git(w, ['commit', '-q', '-m', 'fixture']);
  return w;
}
export interface File { path: string; digest: string }
export const digest = (file: string): string | undefined => existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : undefined;
export function file(w: World, path: string): File {
  const absolute = resolve(w.home, path);
  must(absolute.startsWith(w.home + sep), 'BLOCKED: fixture file outside test home');
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, randomBytes(65536));
  return { path: absolute, digest: digest(absolute)! };
}
export interface Ran { code: number | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
export const shown = (r: Ran) => JSON.stringify(r);
function run(w: World, command: string, args: string[], cwd = w.repo): Promise<Ran> {
  return new Promise((done, fail) => {
    const start = performance.now();
    const child = track(spawn(command, args, { cwd, env: env(w), stdio: ['ignore', 'pipe', 'pipe'] }));
    let stdout = '', stderr = '', timedOut = false;
    child.stdout!.on('data', (d) => { stdout += String(d); });
    child.stderr!.on('data', (d) => { stderr += String(d); });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 120000);
    child.once('error', (e) => { clearTimeout(timer); fail(e); });
    child.once('close', (code) => { clearTimeout(timer); done({ code, stdout, stderr, timedOut, ms: performance.now() - start }); });
  });
}
export interface Hub { child: ChildProcess; socket: string; token: string }
export async function startHub(w: World): Promise<Hub> {
  safe(w);
  must(existsSync(CLI) && existsSync(HOOK), 'BLOCKED: build the CLI, hub and deep-hook first');
  const child = track(spawn(process.execPath, [CLI, 'hub', 'run'], { cwd: REPO, env: env(w, { DEEP_HUB_TEST_CONFIRM: w.confirm }), stdio: ['ignore', 'pipe', 'pipe'] }));
  let out = '', err = '';
  child.stdout!.on('data', (d) => { out += String(d); });
  child.stderr!.on('data', (d) => { err += String(d); });
  const deadline = Date.now() + 120000;
  while (!out.includes('\n') && child.exitCode === null && Date.now() < deadline) await sleep(50);
  const ready = out.includes('\n') ? JSON.parse(out.split('\n')[0]!) : undefined;
  must(ready?.ready === true, `BLOCKED: hub did not start: ${err}`);
  must(ready.pid === child.pid, 'BLOCKED: hub readiness must name the process we started');
  return { child, socket: String(ready.socket), token: readFileSync(join(w.root, 'control.token'), 'utf8').trim() };
}
export const stopHub = (hub: Hub) => stop(hub.child);
async function control(hub: Hub, after: number): Promise<Line[]> {
  return new Promise((done, fail) => {
    const sock = net.connect(hub.socket);
    let buffer = '', step = 0;
    const timer = setTimeout(() => { sock.destroy(); fail(Error('BLOCKED: events.read timed out')); }, 30000);
    sock.setEncoding('utf8');
    sock.on('error', (e) => { clearTimeout(timer); fail(e); });
    sock.on('data', (chunk) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
        if (step === 0) { step++; sock.write(JSON.stringify({ v: 1, hello: 'cli', token: hub.token }) + '\n'); }
        else if (step === 1 && line.role) { step++; sock.write(JSON.stringify({ v: 1, id: 1, method: 'events.read', params: { after, limit: 1000 } }) + '\n'); }
        else if (step === 2 && line.id === 1) {
          clearTimeout(timer); sock.destroy();
          if (line.error) fail(Error(`BLOCKED: events.read: ${JSON.stringify(line.error)}`));
          else done(line.result.events);
        }
      }
    });
  });
}
export async function events(hub: Hub): Promise<Line[]> {
  const all: Line[] = [];
  for (;;) { const page = await control(hub, all.at(-1)?.log_pos ?? 0); if (!page.length) return all; all.push(...page); }
}
export class Session {
  readonly id = randomUUID();
  readonly transcript: string;
  private child: ChildProcess;
  private readonly prompt = randomUUID();
  private n = 0;
  private pending = new Map<number, (r: Ran) => void>();
  constructor(readonly w: World) {
    safe(w);
    this.transcript = join(w.home, '.claude/projects/fixture', `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
    this.child = track(spawn(process.execPath, [AGENT, HOOK], { cwd: w.repo, env: env(w), stdio: ['pipe', 'pipe', 'pipe'] }));
    let buffer = '';
    this.child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d; let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
        if (!('code' in line)) continue; // The fixture owns and stops its hook children, by PID.
        this.pending.get(line.n)?.(line); this.pending.delete(line.n);
      }
    });
    this.child.stdin!.on('error', () => undefined);
    this.child.once('close', () => { for (const done of this.pending.values()) done({ code: null, stdout: '', stderr: 'agent exited', ms: 0, timedOut: false }); this.pending.clear(); });
  }
  private append(entry: Line): void {
    writeFileSync(this.transcript, JSON.stringify({ parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: this.id, cwd: this.w.repo, version: facts.versions.at(-1), userType: 'external', entrypoint: 'cli', ...entry }) + '\n', { flag: 'a' });
  }
  private fire(event: string, extra: Line = {}): Promise<Ran> {
    const n = ++this.n;
    const body = { session_id: this.id, transcript_path: this.transcript, cwd: this.w.repo, hook_event_name: event, permission_mode: 'default', prompt_id: this.prompt, ...extra };
    return new Promise((done) => {
      this.pending.set(n, done);
      this.child.stdin!.write(JSON.stringify({ n, args: ['claude-code', event], cwd: this.w.repo, input: JSON.stringify(body), timeoutMs: TIMEOUT + 30000 }) + '\n');
    });
  }
  async begin(): Promise<void> {
    const start = await this.fire('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    must(start.code === 0, `BLOCKED: SessionStart: ${shown(start)}`);
    const text = 'Clean up these local fixture folders.';
    this.append({ type: 'user', promptId: this.prompt, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
    const r = await this.fire('UserPromptSubmit', { prompt: text });
    must(r.code === 0, `BLOCKED: UserPromptSubmit: ${shown(r)}`);
  }
  async pre(command: string): Promise<Pre> {
    const id = `toolu_${randomBytes(12).toString('hex')}`;
    const input = { command, description: command };
    this.append({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${id}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
    return { id, command, r: await this.fire('PreToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: id }) };
  }
  async execute(p: Pre): Promise<Ran> {
    must(decision(p.r) === 'allow', 'BLOCKED: must never execute a denied call');
    safe(this.w);
    const r = await run(this.w, '/bin/bash', ['-c', p.command]);
    // A wrongly allowed home delete removes the transcript too. Do not mask its named assertion with ENOENT.
    if (existsSync(this.transcript)) {
      this.append({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: p.id, content: r.stdout + r.stderr }] } });
      await this.fire('PostToolUse', { tool_name: 'Bash', tool_input: { command: p.command }, tool_use_id: p.id, tool_response: { stdout: r.stdout, stderr: r.stderr, interrupted: false, isImage: false } });
    }
    return r;
  }
}
export interface Pre { id: string; command: string; r: Ran }
export function decision(r: Ran): string {
  let out: Line = {}; try { out = JSON.parse(r.stdout.trim()); } catch { /* empty is allow */ }
  const said = out.hookSpecificOutput?.permissionDecision ?? out.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  return r.code === 0 && (!said || said === 'allow') ? 'allow' : 'other';
}
/** Missing/late delivery is an explicit non-pass, never evidence of a matcher failure. */
export async function live(hub: Hub, p: Pre): Promise<Line[]> {
  must(!/which holds while the hub doesn't answer|deep-hook: (?:spooled|could not spool)|deep-hook couldn't read/.test(p.r.stderr), `INCONCLUSIVE: hook decided without hub: ${shown(p.r)}`);
  const deadline = Date.now() + 10000;
  for (;;) {
    const all = await events(hub);
    const before = all.find((e) => e.kind === 'tool.before' && e.data.call === p.id);
    if (before) {
      must(!before.data.late && !all.some((e) => e.kind === 'session.reading' && String(e.data.reading).includes(before.id) && /through as late/.test(e.data.reading)), 'INCONCLUSIVE: late hook delivery');
      return all;
    }
    must(Date.now() < deadline, 'INCONCLUSIVE: no tool.before recorded'); await sleep(100);
  }
}
export const staging = (all: Line[], p: Pre) => all.find((e) => e.kind === 'command.staged' && e.data.call === p.id);
export const asks = (all: Line[], since: number) => all.filter((e) => e.kind === 'ask.created' && e.log_pos > since);
export const position = async (hub: Hub) => (await events(hub)).at(-1)?.log_pos ?? 0;
function privateBytes(w: World, paths: string[]): number[] {
  const reader = join(w.tmp, 'private-size');
  if (!existsSync(reader)) execFileSync('/usr/bin/cc', ['-O2', '-o', reader, PRIVATE], { env: env(w) });
  return execFileSync(reader, paths, { env: env(w), encoding: 'utf8' }).trim().split('\n').map((row) => Number(row.split('\t')[1]));
}
export async function stagedUndo(w: World, hub: Hub, s: Session, command: string, lost: File[], who: string): Promise<void> {
  must(privateBytes(w, lost.map((f) => f.path)).every((n) => n === 65536), 'BLOCKED: APFS private-size control needs 64 KiB private per fixture');
  const since = await position(hub);
  const p = await s.pre(command);
  await live(hub, p);
  must(decision(p.r) === 'allow', `${who} STAGED_ALLOW: ${command} must be staged within ceilings, not denied: ${shown(p.r)}`);
  const cloned = privateBytes(w, lost.map((f) => f.path)).every((n) => n === 0);
  const before = await events(hub);
  const staged = staging(before, p);
  const r = await s.execute(p);
  must(r.code === 0 && lost.every((f) => !existsSync(f.path)), `BLOCKED: fixture delete must succeed: ${shown(r)}`);
  must(cloned && staged, `${who} STAGED_BEFORE_RUN: ${command} ran without a recorded copy-on-write staging; clone=${cloned}, command.staged=${Boolean(staged)}, deleted=${lost.length}`);
  must(asks(await events(hub), since).length === 0, `${who} STAGED_NO_ASK: a staged delete needs no ask`);
  const handle = `staged:${staged.id}`;
  const undone = await run(w, process.execPath, [CLI, 'undo', handle], w.tmp);
  must(undone.code === 0, `${who} UNDO_EXIT: ${shown(undone)}`);
  must(lost.every((f) => digest(f.path) === f.digest), `${who} UNDO_BYTES: undo must restore every deleted file byte for byte`);
  console.log(`${who} proof ${command}: ${handle}, restored ${lost.length} file(s) by SHA-256`);
}
