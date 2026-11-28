// Helpers for #3439's acceptance tests (README). Nothing here imports the code under test: the hub is `deep hub run`
// from the built CLI, the login service is the definition `deep hub start` hands to $DEEP_HUB_LAUNCHER, `deep mcp` is
// the command `deep setup` wrote into Claude Code's settings, and the repo rule is `node scripts/repo-rules.mjs`.
// A thread's collector is read from outside, through Node's own inspector (README: Reading a collector).
//
// No helper here fails a criterion by throwing: each returns what it saw, and the test asserts on it, so a wrong
// program fails at an assertion that names what was expected (README: Twins needed).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { CLI, NODE, REPO, allEvents, childEnv, own, parseObject, rootOf, tempDir, waitFor, type Ev, type Hub, type Line } from '../27/helpers.ts';

/** Each criterion's tag: `#3439.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC = {
  rule: '#3439.fead997e',
  start: '#3439.0f3a1117',
  service: '#3439.9382967d',
  mcp: '#3439.420f3cfc',
  /** No test here: the budget window's (README: Not covered here). */
  budget: '#3439.40137b0c',
} as const;

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** Text for a message: this checkout as <checkout>, a home folder as ~. */
export const redact = (text: string): string => text.split(REPO.replace(/\/$/, '')).join('<checkout>').split(homedir()).join('~');
/** A process's output for a message: each distinct line once (a parser that fails is started again, over and over), cut to `max`. */
export const told = (output: string, max = 3000): string => redact([...new Set(output.split('\n'))].join('\n')).slice(0, max);

/**
 * A wrong program planted by hand on a checkout that has no twin folder yet (README: Twins needed): Node options added
 * to the hub this suite launches without the flag and to the `deep mcp` runs, such as
 * `--import=<this folder>/fixtures/v8-call-does-nothing.mjs`. Unset in every lane.
 */
const PLANTED = process.env.T3439_NODE_OPTIONS?.trim() || undefined;
const EXPOSES = /(?:^|\s)--expose[-_]gc(?=\s|$)/;

// ---- A hub launched without the flag: `node <built CLI> hub run`, no Node option before the script and none in its environment.
export interface Launched { pid: number; ready: boolean; child: ChildProcess; hub: Hub; command: string; output(): string }
export async function launchWithoutFlag(home: string): Promise<Launched> {
  const env = childEnv(home, { NODE_OPTIONS: PLANTED });
  const args = [CLI, 'hub', 'run'];
  if (EXPOSES.test(` ${env.NODE_OPTIONS ?? ''}`)) throw Error('BLOCKED: T3439_NODE_OPTIONS gives the flag itself, so this is no hub launched without it');
  const child = spawn(NODE, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    // deadline: a hub that never says it is ready (its core never posts `started`) fails the test instead of hanging it.
    const timer = setTimeout(() => resolve(false), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(parseObject(first.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', (code, signal) => { out += `\n[the hub exited ${code ?? signal}]`; clearTimeout(timer); resolve(false); });
  });
  const hub: Hub = { pid: child.pid!, home, socket: join(rootOf(home), 'hub.sock'), root: rootOf(home), child, output: () => out };
  return { pid: child.pid!, ready, child, hub, command: `node ${redact(args.join(' '))}${PLANTED ? ` with NODE_OPTIONS=${redact(PLANTED)} planted by hand` : ''}`, output: () => out };
}

// ---- The record's readings that say start-up garbage was not shed.
/** An event that is a reading (its kind says so) and whose words say "shed": the issue's "says its start-up garbage was not shed". */
export const unshed = (events: readonly Ev[]): Ev[] => events.filter((e) => /reading/i.test(e.kind) && /shed/i.test(JSON.stringify(e.data)));
export const shownEvent = (e: Ev): string => `${e.kind}@${e.log_pos} ${redact(JSON.stringify(e.data)).slice(0, 400)}`;
export const record = (hub: Hub): Promise<Ev[]> => allEvents(hub);
/** Whether deep-hook left a request holding `marker` in the spool: what it does when the hub didn't acknowledge inside its window. */
export function spooled(home: string, marker: string): boolean {
  const folder = join(rootOf(home), 'spool');
  if (!existsSync(folder)) return false;
  return readdirSync(folder, { recursive: true, withFileTypes: true }).some((entry) => {
    if (!entry.isFile()) return false;
    try { return readFileSync(join(entry.parentPath, entry.name), 'utf8').includes(marker); } catch { return false; }
  });
}

// ---- Reading a collector: `typeof gc` in a thread's own global scope, through the inspector Node opens on SIGUSR1.
// A collector given when the process launched is the global `gc` of every thread. One reached later, by
// v8.setFlagsFromString, is not: the merge base's threads read "undefined" here (BASE-FAILURE.txt).
export interface Thread { name: string; url: string; collector: string }
export interface Threads { threads: Thread[]; why?: string }
/** The option that gives the inspector a port of its own, so two suites never meet on 9229. It opens nothing until SIGUSR1. */
export const INSPECT = '--inspect-port=0';
/**
 * The main thread and every worker of a live Node process started with INSPECT in NODE_OPTIONS, each with its
 * `typeof gc`. `stderr` gives the process's stderr so far, where Node prints the inspector's address. `why` says
 * what stopped the reading, if anything did; the threads read until then are still given.
 */
export async function threadsOf(pid: number, stderr: () => string, atLeastWorkers = 0): Promise<Threads> {
  const threads: Thread[] = [];
  const from = stderr().length;
  try { process.kill(pid, 'SIGUSR1'); } catch (error) { return { threads, why: `the process ${pid} is gone (${(error as Error).message})` }; }
  const address = await waitFor(() => /Debugger listening on (ws:\/\/\S+)/.exec(stderr().slice(from))?.[1], 30_000, 'the inspector to open', 50).catch(() => undefined);
  if (!address) return { threads, why: `Node opened no inspector within 30 s of SIGUSR1; its stderr since: ${told(stderr().slice(from), 600)}` };
  const ws = new WebSocket(address);
  const workers: { sessionId: string; workerInfo: { title: string; url: string } }[] = [];
  const waiting = new Map<string, (reply: Line) => void>();
  let n = 0;
  ws.addEventListener('message', (message) => {
    const line = JSON.parse(String(message.data)) as Line;
    if (line.method === 'NodeWorker.attachedToWorker') workers.push(line.params);
    else if (line.method === 'NodeWorker.receivedMessageFromWorker') { const inner = JSON.parse(line.params.message) as Line; waiting.get(`${line.params.sessionId}:${inner.id}`)?.(inner); }
    else if (line.id !== undefined) waiting.get(`:${line.id}`)?.(line);
  });
  /** One inspector call, to the main thread or through it to a worker's session. */
  const call = (method: string, params: Line, session = ''): Promise<Line | undefined> => new Promise((resolve) => {
    const id = ++n;
    // deadline: a thread that never answers the inspector is reported as unread, not waited on forever.
    const timer = setTimeout(() => resolve(undefined), 30_000);
    waiting.set(`${session}:${id}`, (reply) => { clearTimeout(timer); resolve(reply); });
    if (session) ws.send(JSON.stringify({ id: ++n, method: 'NodeWorker.sendMessageToWorker', params: { sessionId: session, message: JSON.stringify({ id, method, params }) } }));
    else ws.send(JSON.stringify({ id, method, params }));
  });
  const read = async (session = ''): Promise<string> => String((await call('Runtime.evaluate', { expression: 'typeof gc' }, session))?.result?.result?.value ?? 'unread');
  try {
    const opened = await new Promise<boolean>((resolve) => { ws.addEventListener('open', () => resolve(true)); ws.addEventListener('error', () => resolve(false)); });
    if (!opened) return { threads, why: `the inspector at ${address} refused the connection` };
    threads.push({ name: 'the main thread', url: '', collector: await read() });
    await call('NodeWorker.enable', { waitForDebuggerOnStart: false });
    await waitFor(() => workers.length >= atLeastWorkers, 30_000, 'the workers to attach', 50).catch(() => undefined);
    for (const worker of [...workers]) {
      const url = String(worker.workerInfo.url);
      threads.push({ name: `the worker ${url.split('/').at(-1) || worker.workerInfo.title}`, url, collector: await read(worker.sessionId) });
    }
    return { threads };
  } finally {
    ws.close();
  }
}
export const shownThreads = (threads: readonly Thread[]): string => threads.map((t) => `${t.name}: typeof gc is ${JSON.stringify(t.collector)}`).join('; ') || 'no thread was read';

// ---- The login service's stand-in (fixtures/launcher.mjs), behind $DEEP_HUB_LAUNCHER.
export interface Job { pid: number; program: string[]; env: Record<string, string>; log: string; definition: string }
/** Writes the launcher into the home's bin; gives its path and where it writes the job it started. */
export function launcher(bin: string, tmp: string): { path: string; state: string } {
  const state = join(tmp, 'service');
  mkdirSync(state, { recursive: true });
  const path = join(bin, 'launcher');
  writeFileSync(path, `#!/bin/sh\nT3439_STATE='${state}' T3439_JOB_OPTIONS='${INSPECT}' exec '${NODE}' '${join(FIXTURES, 'launcher.mjs')}' "$@"\n`);
  chmodSync(path, 0o755);
  return { path, state };
}
/** The job the launcher started from the definition it was handed, or undefined if it was never called. */
export function jobOf(state: string): Job | undefined {
  try { return JSON.parse(readFileSync(join(state, 'job.json'), 'utf8')) as Job; } catch { return undefined; }
}
export const logOf = (job: Job): string => { try { return readFileSync(job.log, 'utf8'); } catch { return ''; } };

// ---- `deep mcp`, started as Claude Code starts the server DeepBuild wrote into its settings.
export interface Server { command: string; args: string[]; env?: Record<string, string> }
/** DeepBuild's MCP server as `deep setup` registered it at user scope, in <home>/.claude.json. */
export function mcpServer(home: string): Server | undefined {
  try {
    const server = (JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')) as Line).mcpServers?.deepbuild as Line | undefined;
    return server && typeof server.command === 'string' && Array.isArray(server.args) ? { command: server.command, args: server.args.map(String), ...(server.env ? { env: server.env } : {}) } : undefined;
  } catch { return undefined; }
}
/** How a run differs from the settings' own: untouched; given a collector for sure; or with every way to one at launch taken out. */
export type Collector = 'as-written' | 'given' | 'withheld';
export interface Mcp { pid: number; child: ChildProcess; command: string; stderr(): string; request(method: string, params: Line): Promise<Line | { failed: string }>; notify(method: string): void; end(): void }
export function startMcp(home: string, cwd: string, server: Server, collector: Collector): Mcp {
  const strip = (text: string) => text.replace(/(^|\s)--expose[-_]gc(?=\s|$)/g, '$1').trim();
  const args = collector === 'withheld' ? server.args.filter((a) => !/^--expose[-_]gc$/.test(a)) : server.args;
  const own_ = collector === 'withheld' ? strip(server.env?.NODE_OPTIONS ?? '') : (server.env?.NODE_OPTIONS ?? '');
  // The untouched run gets no option of this suite's; the other two get the inspector's port, to read their collector by.
  const options = [own_, PLANTED, collector === 'given' ? '--expose-gc' : '', collector === 'as-written' ? '' : INSPECT].filter(Boolean).join(' ');
  const env = childEnv(home, { ...(server.env ?? {}), NODE_OPTIONS: options || undefined });
  const child = spawn(server.command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  own(child.pid);
  child.stdin!.on('error', () => undefined);
  let err = '';
  let exit: string | undefined;
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const lines: Line[] = [];
  const wakers = new Set<() => void>();
  const wake = () => { for (const w of [...wakers]) w(); };
  createInterface({ input: child.stdout! }).on('line', (raw) => { const l = parseObject(raw); if (l) lines.push(l); wake(); });
  child.on('close', (code, signal) => { exit = `exited ${code ?? signal}`; wake(); });
  let ids = 0;
  return {
    pid: child.pid!, child, stderr: () => err,
    command: `${redact([server.command, ...args].join(' '))}${options ? ` with NODE_OPTIONS=${redact(options)}` : ''}`,
    request(method, params) {
      const id = `${method}#${++ids}`;
      return new Promise((resolve) => {
        const finish = (value: Line | { failed: string }) => { clearTimeout(timer); wakers.delete(check); resolve(value); };
        // deadline: a deep mcp that never answers fails the call instead of hanging the test.
        const timer = setTimeout(() => finish({ failed: `no reply within 60 s; its stderr: ${told(err, 1500)}` }), 60_000);
        const check = () => {
          const reply = lines.find((l) => l.id === id && ('result' in l || 'error' in l));
          if (reply) finish(reply);
          else if (exit) finish({ failed: `deep mcp ${exit} with no reply; its stderr: ${told(err, 1500)}` });
        };
        wakers.add(check);
        child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        check();
      });
    },
    notify(method) { child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params: {} })}\n`); },
    end() { try { child.stdin!.end(); } catch { /* gone */ } },
  };
}

// ---- The repo rule, in a scratch repository: a copy of this checkout's scripts/, left out of git's listing, and the planted files.
const git = (cwd: string, ...args: string[]) => {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const r = spawnSync('git', ['-c', 'user.name=t3439', '-c', 'user.email=t3439@example.invalid', ...args], { cwd, env, encoding: 'utf8' });
  if (r.status !== 0) throw Error(`BLOCKED: git ${args[0]} failed in the scratch repository: ${r.stderr}`);
  return r.stdout;
};
export interface Rules { status: number | null; lines: string[]; stderr: string }
/** A scratch git repository holding `files`, committed, with this checkout's scripts/ beside them. */
export function scratch(files: Record<string, string>): string {
  const cwd = tempDir();
  git(cwd, 'init', '-q', '-b', 'main');
  mkdirSync(join(cwd, '.git/info'), { recursive: true });
  writeFileSync(join(cwd, '.git/info/exclude'), '/scripts/\n');
  cpSync(join(REPO, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  const rules = JSON.parse(readFileSync(join(REPO, 'scripts/repo-rules.json'), 'utf8')) as Line;
  writeFileSync(join(cwd, 'scripts/repo-rules.json'), `${JSON.stringify({ ...rules, deps: {}, allowedFindings: [] }, null, 2)}\n`);
  for (const [path, text] of Object.entries({ 'package.json': `${JSON.stringify({ name: 'fixture-root', private: true })}\n`, ...files })) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'fixture');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return cwd;
}
/** `node scripts/repo-rules.mjs` with cwd at `cwd`: its exit and each line it printed. */
export function repoRules(cwd: string): Rules {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))), PATH: `${dirname(NODE)}:${process.env.PATH ?? ''}` };
  // deadline: a rule run that never ends is no verdict; nothing waits on it to pass.
  const r = spawnSync(NODE, ['scripts/repo-rules.mjs'], { cwd, env, encoding: 'utf8', timeout: 900_000, maxBuffer: 1 << 28 });
  if (r.error || r.signal) throw Error(`INCONCLUSIVE: node scripts/repo-rules.mjs didn't finish (${(r.error as NodeJS.ErrnoException | undefined)?.code ?? r.signal})`);
  return { status: r.status, lines: redact(r.stdout).split('\n'), stderr: redact(r.stderr) };
}
/** Tracked files, and new ones git doesn't ignore, under `folder` of this checkout. */
export function listed(folder: string): string[] {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))), GIT_OPTIONAL_LOCKS: '0' };
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', folder], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw Error(`BLOCKED: git ls-files failed in this checkout: ${r.stderr}`);
  return r.stdout.split('\0').filter(Boolean);
}
