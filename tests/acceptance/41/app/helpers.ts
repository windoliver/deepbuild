// Test-side tools for #41's app suite (the app's half of AC13, AC14, AC17 and the mechanical part of AC22): the app
// binary built from the checkout and its planted build, temp homes, a stand-in for an older running hub on the app's
// socket, a loopback update server, the environment Finder gives an app, and the taste-call judge. Nothing here
// stands in for DeepBuild: every test reaches it through the built `deep-app`, the built CLI (`deep`) and the files
// under the temp home. The planted wrong programs stand in for those only in the tests that say so. The surfaces are
// pinned in the header of each test file.

import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const TWINS = fileURLToPath(new URL('./twins/', import.meta.url));
/** Where the person's taste call on the three screenshots is recorded (AC22). */
export const TASTE = join(REPO, 'docs/evidence/41/taste.json');
/** Copies of each build of the app, so a planted build never stands where another test runs the real one. */
const BIN = join(REPO, 'target', 'acceptance-41-app');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};

/** The app draws and sets up on macOS only; elsewhere these tests can't run, which is BLOCKED, never a pass. */
export function onMac(): void {
  if (process.platform !== 'darwin') throw Error(`BLOCKED: the app runs on macOS only; this is ${process.platform}`);
}

// ---- Temp folders. Short real paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/da41-'));
  made.push(dir);
  return dir;
}
export const rootOf = (home: string) => join(home, '.deepbuild');
export function script(path: string, text: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, 0o755);
  return path;
}

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
export function own(pid: number | undefined | null): void {
  if (pid) owned.add(pid);
}
function alive(pid: number): boolean {
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
/** Files where a stand-in this suite wrote (a hung login shell) logs its PID, so cleanup can stop it by PID. */
const pidFiles: string[] = [];
export const pidFile = (path: string) => { pidFiles.push(path); return path; };
const closers: (() => Promise<void>)[] = [];
/** Stops every process and server this suite started (SIGTERM, then SIGKILL after 3 s) and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
  for (const file of pidFiles.splice(0)) {
    if (existsSync(file)) for (const pid of readFileSync(file, 'utf8').split(/\s+/).map(Number)) if (pid > 0) own(pid);
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

// ---- Running a program.
export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean; ms: number }
export function run(command: string, args: readonly string[], o: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 180_000);
    child.on('error', (error) => { stderr += `\n[spawn failed: ${error.message}]`; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut, ms: Date.now() - started }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end('');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;
export const lastLine = (text: string) => text.trim().split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? '';

/** Runs `f`, which must fail with a message matching `pattern`: how a planted wrong program is shown to fail a test. */
export async function failsWith(f: () => unknown, pattern: RegExp): Promise<void> {
  let error: unknown;
  try {
    await f();
  } catch (e) {
    error = e;
  }
  if (error === undefined) expect.fail(`the planted wrong program passed this test; it must fail it with ${pattern}`);
  const message = error instanceof Error ? error.message : String(error);
  if (!pattern.test(message)) expect.fail(`the planted wrong program failed this test for another reason than ${pattern}: ${message}`);
}

// ---- Builds: the app as `cargo build -p deep-app --bin deep-app` builds it from the checkout, and its planted build.
export type Plant = 'plant-calls-unlisted';
function cargo(args: readonly string[], what: string): Promise<void> {
  // Through the repo's lease script, so the build takes a cpu.slot on this shared machine (it runs unleased without a hub).
  const env = { ...process.env, PATH: `${dirname(NODE)}:${process.env.PATH ?? ''}` };
  return run(join(REPO, 'scripts/lease'), ['cargo', 'build', '--locked', '-q', ...args], { cwd: REPO, env, timeoutMs: 3_000_000 }).then((r) => {
    if (r.code !== 0) throw Error(`${what} didn't build (cargo build ${args.join(' ')}): ${r.stderr.slice(-3000)}`);
  });
}
const built = new Map<string, Promise<string>>();
/**
 * The path of a copy of the built app: the real one, or with `plant` the build with that cargo feature (in no shipped
 * build). The real build is put back in target/debug afterwards, for the suites that run it from there.
 */
export function appBinary(plant?: Plant): Promise<string> {
  const key = plant ?? 'plain';
  let build = built.get(key);
  if (!build) {
    build = (async () => {
      onMac();
      if (plant) await appBinary();
      const what = plant ? `the planted app (cargo feature ${plant} on deep-app)` : 'BLOCKED: the app';
      await cargo(['-p', 'deep-app', '--bin', 'deep-app', ...(plant ? ['--features', plant] : [])], what);
      mkdirSync(BIN, { recursive: true });
      const out = join(BIN, `deep-app-${key}`);
      // Copied beside it and renamed into place: another test file may be running the last copy, and macOS kills a
      // program whose file is written over while it runs.
      const part = `${out}.${process.pid}.part`;
      copyFileSync(join(REPO, 'target/debug/deep-app'), part);
      chmodSync(part, 0o755);
      renameSync(part, out);
      if (plant) await cargo(['-p', 'deep-app', '--bin', 'deep-app'], 'BLOCKED: the app');
      return out;
    })();
    built.set(key, build);
  }
  return build;
}

// ---- Homes and environments.
/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/**
 * A fresh home: `<tmp>/h` is HOME for every process a test starts. `<tmp>/bin` holds:
 * - `deep`, the built CLI run by this Node;
 * - `dead-launcher`, a login service stand-in through the hub's seam `DEEP_HUB_LAUNCHER` that starts nothing, and
 *   `launchctl` and `systemctl` stand-ins that only log, so nothing a test runs reaches the real login service;
 * - `sh-login`, the login shell (SHELL), whose PATH is `<tmp>/bin`, Node's folder and the system's; login and
 *   interactive flags are dropped, so no profile of the machine running the tests is read.
 */
export interface Home { tmp: string; home: string; bin: string }
export function makeHome(): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(home, { recursive: true });
  for (const name of ['launchctl', 'systemctl', 'dead-launcher']) script(join(bin, name), `#!/bin/sh\nprintf '${name} %s\\n' "$*" >> '${bin}/calls.log'\nexit 0\n`);
  script(join(bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`);
  script(join(bin, 'sh-login'), [
    '#!/bin/sh',
    `PATH='${bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin'; export PATH`,
    'for a; do shift; case "$a" in -l|-i|--login|-il|-li) ;; -lc|-cl|-ilc|-lic|-ic|-ci) set -- "$@" -c ;; *) set -- "$@" "$a" ;; esac; done',
    'exec /bin/sh "$@"',
    '',
  ].join('\n'));
  return { tmp, home, bin };
}
/** A home that was set up before: `~/.deepbuild` exists, so the first `deep` command runs no setup (packages/hub/src/setup.ts). */
export function setUpHome(): Home {
  const h = makeHome();
  mkdirSync(rootOf(h.home), { recursive: true });
  writeFileSync(join(rootOf(h.home), 'control.token'), `${randomBytes(16).toString('hex')}\n`, { mode: 0o600 });
  return h;
}
/**
 * The environment a child gets: HOME the test's home, `<tmp>/bin` first on PATH, the dead login service as
 * `DEEP_HUB_LAUNCHER`, light appearance, and no DEEP_, CLAUDE*, CODEX*, GIT_ or billing variable of this process's.
 */
export function childEnv(h: Home, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_|npm_)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = h.home;
  env.XDG_CONFIG_HOME = join(h.home, '.config');
  env.XDG_CACHE_HOME = join(h.home, '.cache');
  env.SHELL = join(h.bin, 'sh-login');
  env.PATH = `${h.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  env.LC_ALL = 'C';
  env.DEEP_HUB_LAUNCHER = join(h.bin, 'dead-launcher');
  env.DEEP_APP_APPEARANCE = 'light';
  return { ...env, ...extra };
}

// ---- A stand-in for the running hub, on the app's socket (AC13).
export interface Hello { contract?: string; features: string[] }
export interface StandInHub {
  /** Every line the app sent, in order. */
  lines: Line[];
  /** The method of every call the app made, in order. */
  calls: () => string[];
  hello: Hello;
  close: () => Promise<void>;
}
/**
 * A hub that is older than (or as new as) the app, listening at `socket` as the running hub does: on each connection it
 * writes its hello, `{"v":1,"hello":"deep-hub","start":<id>,"contract"?,"features"}`; it answers a client's
 * `{"hello":"app","token"}` with `{"v":1,"role":"app"}`, a call of a method its hello lists with an empty result
 * (`{"events":[],"asks":[],"log_pos":0}`), and a call of any other method with error@3's refusal, as a hub refuses a
 * method it doesn't have. It records every line.
 */
export function standInHub(socket: string, hello: Hello): Promise<StandInHub> {
  mkdirSync(dirname(socket), { recursive: true });
  const lines: Line[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
    s.on('error', () => undefined);
    const helloLine: Line = { v: 1, hello: 'deep-hub', start: 'stand-in-hub-start', features: hello.features };
    if (hello.contract !== undefined) helloLine.contract = hello.contract;
    s.write(`${JSON.stringify(helloLine)}\n`);
    let buffer = '';
    s.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        const line = parseObject(raw) ?? { unparsed: raw };
        lines.push(line);
        if (line.hello === 'app') s.write(`${JSON.stringify({ v: 1, role: 'app' })}\n`);
        else if (typeof line.method === 'string') {
          const reply = hello.features.includes(line.method)
            ? { v: 1, id: line.id, result: { events: [], asks: [], log_pos: 0 } }
            : { v: 1, id: line.id, error: { code: 'unknown_method', retryable: false, remediation: `this hub has no method ${line.method}`, path: 'method', actual: line.method, evidence: [] } };
          s.write(`${JSON.stringify(reply)}\n`);
        }
      }
    });
  });
  const close = () => new Promise<void>((resolve) => {
    for (const s of sockets) s.destroy();
    server.close(() => resolve());
  });
  closers.push(close);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socket, () => resolve({ lines, hello, close, calls: () => lines.filter((l) => typeof l.method === 'string').map((l) => l.method as string) }));
  });
}

// ---- A loopback update server (AC14).
export interface UpdateServer { url: string; hits: () => number; close: () => Promise<void> }
/** Serves `{"version": <version>}` as JSON at `<url>` on 127.0.0.1, counting every request. */
export function updateServer(version: string): Promise<UpdateServer> {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ version }));
  });
  const close = () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
  closers.push(close);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/deepbuild/manifest.json`, hits: () => hits, close });
    });
  });
}
/** A loopback port that accepts each connection and drops it before a byte of answer: a network that cuts you off. */
export function droppingServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = net.createServer((s) => s.destroy());
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  closers.push(close);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/deepbuild/manifest.json`, close });
    });
  });
}

// ---- The taste call on the screenshots (AC22).
/**
 * Whether the screenshots look right is one taste call, a person's, recorded in `file` (docs/evidence/41/taste.json):
 * `{"criterion": "#41.bff357be", "call": "looks right" | "looks wrong", "by": <who>, "at": <when>, "screens":
 * {<file name>: <sha256 of its bytes>}}`. With none on exactly these screenshots the run is INCONCLUSIVE, never a pass;
 * a call that they don't look right fails.
 */
export function tasteCall(screens: Record<string, string>, where: string, file = TASTE): void {
  const these = `these screenshots (${Object.keys(screens).join(', ')} in ${where})`;
  if (!existsSync(file)) throw Error(`INCONCLUSIVE: no taste call is recorded at ${file} on ${these}; whether they look right is a person's call`);
  const call = parseObject(readFileSync(file, 'utf8'));
  if (!call || call.criterion !== '#41.bff357be') throw Error(`INCONCLUSIVE: ${file} is not a taste call on #41.bff357be`);
  if (typeof call.by !== 'string' || !call.by.trim()) throw Error(`INCONCLUSIVE: the taste call at ${file} names no person who made it`);
  for (const [name, digest] of Object.entries(screens)) {
    if (call.screens?.[name] !== digest) throw Error(`INCONCLUSIVE: the taste call at ${file} is on other screenshots than ${these}: ${name} is ${digest}, the call names ${JSON.stringify(call.screens?.[name] ?? null)}`);
  }
  if (call.call !== 'looks right') expect.fail(`#41 AC22 the recorded taste call says the screenshots don't look right: ${JSON.stringify(call.call)}${call.note ? `, ${JSON.stringify(call.note)}` : ''}`);
}
/** A PNG's pixel size, or undefined when the bytes aren't a PNG. */
export function pngSize(path: string): [number, number] | undefined {
  const bytes = readFileSync(path);
  const png = bytes.subarray(1, 4).toString('latin1') === 'PNG' && bytes.subarray(12, 16).toString('latin1') === 'IHDR';
  return png ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : undefined;
}
