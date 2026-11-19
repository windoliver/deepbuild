// Test-side tools for #1509's criteria (README): a temp world (a home with the shipped default guards, your ask
// settings and stand-ins for the agents' CLIs; a git repository with a package.json, its lockfile and a
// requirements.txt), the fixture registry this process serves on loopback, the hub as a process pointed at it, the
// record read back through the hub's socket (`events.read`, `changes.read`), Claude Code sessions driven through the
// real deep-hook binary with payloads shaped like the corpus's, deep-hook's check mode, and the readings each criterion
// judges. Parts are adapted from tests/acceptance/23/permissions/helpers.ts (same repo, same license); this folder
// keeps its own copy so a redraft there never moves these tests. Nothing here stands in for DeepBuild: every decision
// comes from the real hub and deep-hook. No package manager ever runs: the hook decides each call and nothing executes
// it, and the registry is this file's server on 127.0.0.1.
//
// A judgement fails through node:assert (`fail`, `must`), so a failure is an assertion in this folder. A reading the
// machine spoiled throws `Inconclusive`, a skip; a world that can't be built throws an Error starting `BLOCKED:`.

import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
export const STUB = fileURLToPath(new URL('./fixtures/stub-bin.sh', import.meta.url));
export const DAY = 86_400_000;
export const YEAR = 365 * DAY;

/** Each criterion's ID: `#1509.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed (scripts/proof-change.mjs, criterionId). */
export const AC1 = '#1509.a4073779';
export const AC2 = '#1509.ae8eec29';
export const AC3 = '#1509.a066c839';
export const AC4 = '#1509.69494a39';
export const AC5 = '#1509.6384e10e';
export const AC6 = '#1509.231f163d';

/** AC6's planted guard (chosen), selected with DEEP_HUB_PLANT: it asks for every package run from a registry, whatever its age. */
export const ASKS_EVERY = 'asks-every-registry-run';

// ---- The calls. Package names and versions are the fixture registry's (fixturePackages).
/** AC1, AC4, AC5: the issue's call; the lockfile doesn't hold some-pkg, and its latest version is 2 days old. */
export const NPX_LATEST = 'npx -y some-pkg@latest';
/** AC6: a version published three years ago, of a name first published four years ago. */
export const NPX_OLD = 'npx -y some-pkg@1.0.0';
/** AC6: a version published 2 days ago. */
export const NPX_NEW = 'npx -y some-pkg@2.0.0';
/** AC4, with the registry down: a package the registry would have read as three years old. */
export const NPX_UNREAD = 'npx -y other-pkg@1.2.0';
/** AC2: vitest, which the lockfile holds at 3.2.4. */
export const NPX_LOCKED = 'npx vitest';
/** AC2's contrast: a vitest version the lockfile doesn't hold, published 2 days ago. */
export const NPX_UNLOCKED = 'npx vitest@4.0.0';
/** AC1: the Scope's spellings of running a package straight from a registry, none of them held by the fixture repo's lockfile. */
export const SPELLINGS = [
  NPX_LATEST,
  'bunx some-pkg@2.0.0',
  'pnpm dlx some-pkg@2.0.0',
  'yarn dlx some-pkg@2.0.0',
  'uvx some-tool@1.0.0',
  'pipx run some-tool',
  'pipx install some-tool',
  'python -m pip install some-lib',
  'python3 -m pip install some-lib',
  'uv tool run some-tool',
];

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
/** The newest Claude Code version the facts cover: every transcript entry carries it, so no session is watch-only. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;

// ---- Verdicts.
/** A reading the machine spoiled, such as a hook deep-hook decided alone because the hub's acknowledgement came late. */
export class Inconclusive extends Error {}
/** Runs a judgement: INCONCLUSIVE is a skip that names the load, never a pass; anything else is thrown on. */
export async function verdict(ctx: TestContext, judge: () => Promise<void>): Promise<void> {
  try {
    await judge();
  } catch (error) {
    if (error instanceof Inconclusive) ctx.skip(`INCONCLUSIVE ${error.message} (read at ${loadReading()})`);
    throw error;
  }
}
/** The message a scenario fails with, or null when it holds. BLOCKED and INCONCLUSIVE are thrown on, never read as a failure. */
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
/** A judgement's failure: an assertion thrown here, under the test paths. */
export function fail(message: string): never {
  assert.fail(message);
}
export function must(ok: boolean, message: string): asserts ok {
  if (!ok) fail(message);
}

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1509-'));
  made.push(dir);
  return dir;
}

// ---- Processes and servers this suite started. Processes are stopped by PID only, never by name or port.
const owned = new Set<number>();
const servers = new Set<Server>();
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
/** Stops every process this suite started (SIGCONT and SIGTERM, then SIGKILL after 3 s), closes its registries and removes its temp folders. */
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
  for (const server of servers) closeServer(server);
  servers.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Variables no child inherits from this process: DeepBuild's and the agents' settings, credentials, proxies and npm's configuration. */
const DROPPED = /^(?:DEEP_|XDG_|GIT_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|AWS_|GH_|GITHUB_|OTEL_|npm_|NPM_CONFIG_)|^(?:NODE_OPTIONS|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy)$/;
/**
 * The environment a child gets: HOME the world's, and PATH the world's stand-ins first, then Node's folder and the
 * system folders only, so no real agent CLI (and no model) is reachable and no package manager of this machine runs.
 */
export function childEnv(w: World, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!DROPPED.test(key)) env[key] = value;
  env.HOME = w.home;
  env.XDG_CONFIG_HOME = join(w.home, '.config');
  env.XDG_CACHE_HOME = join(w.home, '.cache');
  env.PATH = `${w.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  env.LC_ALL = 'C';
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

// ---- The fixture registry (README, The fixture registry): npm's registry documents, served by this process on loopback.
export interface Published { version: string; at: number }
export interface Pkg { name: string; created: number; latest: string; versions: Published[] }
/**
 * The packages the registry knows, dated from `now`: some-pkg (the name four years old; 1.0.0 published three years
 * ago, 2.0.0 two days ago and `latest`), other-pkg (a name six years old; 1.2.0 published three years ago), left-pad (a
 * new name: 1.3.0, its only version, published two days ago) and vitest (a name five years old; 3.2.4, the lockfile's,
 * published 150 days ago, and 4.0.0, `latest`, two days ago). "Three years" and "four years" are each a month past
 * the whole years, so any way of counting years reads three and four.
 */
export function fixturePackages(now: number): Pkg[] {
  return [
    { name: 'some-pkg', created: now - 4 * YEAR - 60 * DAY, latest: '2.0.0', versions: [{ version: '1.0.0', at: now - 3 * YEAR - 30 * DAY }, { version: '2.0.0', at: now - 2 * DAY }] },
    { name: 'other-pkg', created: now - 6 * YEAR, latest: '1.2.0', versions: [{ version: '1.2.0', at: now - 3 * YEAR - 30 * DAY }] },
    { name: 'left-pad', created: now - 2 * DAY - 60_000, latest: '1.3.0', versions: [{ version: '1.3.0', at: now - 2 * DAY }] },
    { name: 'vitest', created: now - 5 * YEAR, latest: '4.0.0', versions: [{ version: '3.2.4', at: now - 150 * DAY }, { version: '4.0.0', at: now - 2 * DAY }] },
  ];
}
const iso = (t: number) => new Date(t).toISOString();
const manifest = (p: Pkg, v: Published, base: string): Line => ({
  name: p.name, version: v.version, description: `${p.name}, a fixture package`, license: 'MIT',
  dist: { tarball: `${base}/${p.name}/-/${p.name}-${v.version}.tgz`, shasum: '0'.repeat(40) },
});
/** A package's document as npm's registry serves it at `<base>/<name>`: dist-tags, versions, and `time` (created, modified, and each version's publish time). */
export function packument(p: Pkg, base: string): Line {
  return {
    _id: p.name, name: p.name, 'dist-tags': { latest: p.latest },
    versions: Object.fromEntries(p.versions.map((v) => [v.version, manifest(p, v, base)])),
    time: { created: iso(p.created), modified: iso(Math.max(...p.versions.map((v) => v.at))), ...Object.fromEntries(p.versions.map((v) => [v.version, iso(v.at)])) },
  };
}
export interface Registry { url: string; packages: Pkg[]; requests: { method: string; path: string }[]; close(): void }
function closeServer(server: Server): void {
  server.close();
  server.closeAllConnections();
}
/**
 * The fixture registry: an HTTP server on 127.0.0.1 that answers `GET /<name>` with the package's document, `GET
 * /<name>/<version or dist-tag>` with that version's, and 404 otherwise. `close()` takes it down: every connection
 * dropped, and nothing listens there any more.
 */
export async function startRegistry(packages: Pkg[]): Promise<Registry> {
  const requests: Registry['requests'] = [];
  let base = '';
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    requests.push({ method: req.method ?? 'GET', path });
    const send = (status: number, body: Line) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const m = /^\/((?:@[^/]+\/)?[^/@]+)(?:\/([^/]+))?\/?$/.exec(path);
    const p = m ? packages.find((x) => x.name === m[1]) : undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { error: 'method not allowed' });
    if (!m || !p) return send(404, { error: 'Not found' });
    if (!m[2]) return send(200, packument(p, base));
    const version = m[2] === 'latest' ? p.latest : m[2];
    const v = p.versions.find((x) => x.version === version);
    return v ? send(200, manifest(p, v, base)) : send(404, { error: 'version not found' });
  });
  servers.add(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url: base, packages, requests, close: () => { closeServer(server); servers.delete(server); } };
}

// ---- A world: a home and a repository.
/** Your ask settings (#319's shape, as #321's and #23's suites set them): setup's drafts with no `batch`, so every ask shows when it's raised; authority 1 day. */
export const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
/** The fixture repo's manifest at the base: vitest as its one dev dependency. */
export const PACKAGE = { name: 'shop', version: '1.0.0', private: true, devDependencies: { vitest: '3.2.4' } };
/** Its lockfile (npm's v3 format): vitest at 3.2.4, and nothing else. */
export const LOCKFILE = {
  name: 'shop', version: '1.0.0', lockfileVersion: 3, requires: true,
  packages: {
    '': { name: 'shop', version: '1.0.0', devDependencies: { vitest: '3.2.4' } },
    'node_modules/vitest': { version: '3.2.4', resolved: 'https://registry.example.test/vitest/-/vitest-3.2.4.tgz', integrity: `sha512-${'A'.repeat(86)}==`, dev: true, license: 'MIT', bin: { vitest: 'vitest.mjs' } },
  },
};
/** Its Python requirements, unchanged in every test. */
export const REQUIREMENTS = 'some-lib==1.0.0\n';
export const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

export interface World { tmp: string; home: string; root: string; repo: string; bin: string }
/**
 * `<tmp>/h` is HOME for every process. The hub's root `<home>/.deepbuild` holds the shipped default guards as the
 * first rules.json and config.json with your ask settings. `<tmp>/bin` holds the stand-ins for `claude` and `codex`.
 * `<tmp>/repo` is a git repository with one commit on main, the base: package.json, package-lock.json,
 * requirements.txt and src/signup.ts. Every session works there, on main.
 */
export function makeWorld(): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  copyFileSync(DEFAULT_RULES, join(root, 'rules.json'));
  writeFileSync(join(root, 'config.json'), json({ asks: SETTINGS }));
  const bin = join(tmp, 'bin');
  mkdirSync(bin);
  for (const name of ['claude', 'codex']) {
    copyFileSync(STUB, join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  const repoDir = join(tmp, 'repo');
  mkdirSync(join(repoDir, 'src'), { recursive: true });
  writeFileSync(join(repoDir, 'package.json'), json(PACKAGE));
  writeFileSync(join(repoDir, 'package-lock.json'), json(LOCKFILE));
  writeFileSync(join(repoDir, 'requirements.txt'), REQUIREMENTS);
  writeFileSync(join(repoDir, 'src', 'signup.ts'), 'export const signup = (email: string) => email.includes("@");\n');
  const git = (args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repoDir, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  });
  git(['init', '-q', '-b', 'main']);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  return { tmp, home, root, repo: realpathSync(repoDir), bin };
}

// ---- The hub as a process: `deep hub run`, HOME the world's.
export interface Hub { pid: number; socket: string; root: string; child: ChildProcess; exit: Promise<void>; stderr(): string }
export interface HubOptions {
  /** DEEP_HUB_TEST_REGISTRY (chosen): the base URL of the registry the hub reads, the fixture's or one where nothing listens. */
  registry: string;
  plant?: string | undefined;
  /** DEEP_HUB_TEST_STOP_HOLD_MS, the hub's own test setting: how long a stop is held at most. */
  stopHoldMs?: number | undefined;
}
/** Starts `deep hub run`. A hub that doesn't start (a plant the program doesn't list) is BLOCKED. */
export async function startHub(w: World, o: HubOptions): Promise<Hub> {
  const env = childEnv(w, {
    DEEP_HUB_TEST_REGISTRY: o.registry,
    DEEP_HUB_PLANT: o.plant,
    DEEP_HUB_TEST_STOP_HOLD_MS: o.stopHoldMs === undefined ? undefined : String(o.stopHoldMs),
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
  return { pid: Number(ready.pid), socket: String(ready.socket), root: w.root, child, exit, stderr: () => err };
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
export const handleOf = (ask: Ev) => `ask:${ask.id}`;
export const questionOf = (ask: Ev) => String(ask.data?.question ?? '');
/** The asks raised after `since` whose question names any of `words`. */
export async function asksNaming(hub: Hub, since: number, words: readonly string[]): Promise<Ev[]> {
  return (await allEvents(hub)).filter((e) => e.kind === 'ask.created' && e.log_pos > since && words.some((n) => questionOf(e).includes(n)));
}
export const asksShown = (asks: Ev[]) => asks.map((a) => `${handleOf(a)} asking ${JSON.stringify(questionOf(a))}`).join('; ');
/** How the ask closed, as the record says: the first closing event naming it, or undefined while it's open. */
const CLOSING = /^(ask\.(answered|defaulted|escalated|cancelled|superseded|moot)|decision\.applied)$/;
export function closingOf(events: Ev[], handle: string): Ev | undefined {
  return events.find((e) => CLOSING.test(e.kind) && (e.subject === handle || e.data?.ask === handle));
}

// ---- Each session's Claude Code (fixtures/agent.mjs): one long-lived process per session, the parent of every
// deep-hook run of that session, as Claude Code is of its hook commands.
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
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w), stdio: ['pipe', 'pipe', 'ignore'] });
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
/** A session in the repo, in the default permission mode, with its transcript and its own Claude Code process. */
export function newSession(w: World): Session {
  if (!existsSync(DEEP_HOOK)) throw Error(`BLOCKED: no deep-hook at ${DEEP_HOOK}; build it with cargo build --locked -q -p deep-hook`);
  const id = randomUUID();
  const transcript = join(w.home, '.claude/projects', w.repo.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  agents.set(id, Agent.start(w));
  return { id, cwd: w.repo, transcript };
}
function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  appendFileSync(s.transcript, `${JSON.stringify(line)}\n`);
}
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, output_tokens: 10 } } });
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt && event !== 'SessionStart') base.prompt_id = s.prompt;
  if (event === 'SessionStart') Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' });
  if (event === 'Stop') Object.assign(base, { stop_hook_active: false });
  return { ...base, ...extra };
}
/** deep-hook as Claude Code runs our hook entry: `deep-hook claude-code <event>`, the payload on stdin, a child of the session's Claude Code. */
export function fire(body: Line, timeoutMs = 150_000): Promise<Ran> {
  const agent = agents.get(String(body.session_id));
  if (!agent) throw Error(`BLOCKED: no Claude Code process for session ${String(body.session_id)}; make sessions with newSession`);
  return agent.run(['claude-code', String(body.hook_event_name)], String(body.cwd), JSON.stringify(body), timeoutMs);
}
export async function sessionStart(s: Session): Promise<void> {
  const r = await fire(payload(s, 'SessionStart'));
  if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook must end with exit 0: ${shown(r)}`);
  // The hub's work on a session's start (its briefing, the transcript) settles before the session's first call, so
  // that call's acknowledgement isn't late for it on a loaded machine. Not a wait on the program's answer.
  await sleep(1500);
}
/** Words you type in the session: its transcript entry and its UserPromptSubmit. */
export async function typed(s: Session, text: string): Promise<Ran> {
  const promptId = randomUUID();
  s.prompt = promptId;
  appendTranscript(s, { type: 'user', promptId, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  return fire(payload(s, 'UserPromptSubmit', { prompt: text }));
}

// ---- Calls, and what each hook's reply tells Claude Code.
export interface Call { tool_name: string; tool_input: Line }
export const bash = (command: string): Call => ({ tool_name: 'Bash', tool_input: { command, description: command } });
export const label = (c: Call): string => String(c.tool_input.command ?? `${c.tool_name} ${String(c.tool_input.file_path ?? '')}`);
let calls = 0;
export const callId = () => `toolu_${randomBytes(10).toString('hex')}${++calls}`;
/** One call the agent makes: its tool_use in the transcript and its PreToolUse through deep-hook. */
export async function preToolUse(s: Session, call: Call, id = callId()): Promise<{ id: string; r: Ran }> {
  appendTranscript(s, assistant([{ type: 'tool_use', id, name: call.tool_name, input: call.tool_input }], 'tool_use'));
  return { id, r: await fire(payload(s, 'PreToolUse', { ...call, tool_use_id: id })) };
}
/** The call ran: its result in the transcript and its PostToolUse. */
export async function postToolUse(s: Session, call: Call, id: string, response: Line = { stdout: 'ok', stderr: '', interrupted: false, isImage: false }): Promise<Ran> {
  appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: 'ok', is_error: false }] } });
  return fire(payload(s, 'PostToolUse', { ...call, tool_use_id: id, tool_response: response }));
}
/** The turn ends: the agent's last words in the transcript and its Stop. */
export function stop(s: Session, said: string): Promise<Ran> {
  appendTranscript(s, assistant([{ type: 'text', text: said }], 'end_turn'));
  return fire(payload(s, 'Stop', { last_assistant_message: said }));
}

/** A PreToolUse reply as Claude Code reads it: denied, explicitly allowed, or passed on to the permission mode. */
export type PreToolDecision = 'deny' | 'allow' | 'pass';
export function preTool(r: Ran): PreToolDecision {
  const out = parseObject(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (said === 'allow' || said === 'approve') return 'allow';
  return 'pass';
}
/** The words the agent reads from a hook's reply: a block's stderr, a deny's reason, and any added context. */
export function agentReads(r: Ran): string {
  const out = parseObject(r.stdout.trim());
  const h = out?.hookSpecificOutput ?? {};
  const parts = [r.code === 2 ? r.stderr : '', String(h.additionalContext ?? '')];
  if (h.permissionDecision === 'deny') parts.push(String(h.permissionDecisionReason ?? ''));
  if (out?.decision === 'block') parts.push(String(out.reason ?? ''));
  return parts.filter(Boolean).join('\n');
}
/**
 * Whether deep-hook decided this call on its own, the hub's acknowledgement having come late (README, Late hooks):
 * deep-hook says it spooled it or denied it on the floor "while the hub doesn't answer"; a spool file still holds the
 * call, which deep-hook spools only when it decides alone; or the record marks the call late.
 */
export async function lateHook(hub: Hub, r: Ran, call: string): Promise<boolean> {
  if (/deep-hook: (spooled|could not spool)|while the hub doesn't answer/.test(r.stderr)) return true;
  const dir = join(hub.root, 'spool');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      let text = '';
      try { text = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
      if (text.includes(call)) return true;
    }
  }
  const before = (await allEvents(hub)).find((e) => e.kind === 'tool.before' && e.data?.call === call);
  return before?.data?.late === true;
}
/** The hub's own words when its gate didn't decide a call within its hold, or failed to: a reading the machine spoiled. */
export const GATE_LATE = /couldn't check whether .* needs your authority in time|checking whether .* needs your authority failed/;

// ---- deep-hook's check mode: whether a guard@1 entry matches a call, as the hub checks entries at install.
/** The shipped default entries whose match is the dependency effect, by name. */
export function dependencyEntries(): [string, Line][] {
  const rules = JSON.parse(readFileSync(DEFAULT_RULES, 'utf8')) as { entries: Record<string, Line> };
  return Object.entries(rules.entries).filter(([, e]) => e.match === 'effect:dependency');
}
/** `deep-hook check` of one entry against a Bash call run in the world's repo: whether it matched, as deep-hook says. */
export async function checkEntry(w: World, entry: Line, command: string): Promise<boolean> {
  const input = JSON.stringify({ entry, call: { tool_name: 'Bash', tool_input: { command }, cwd: w.repo } });
  const r = await run(DEEP_HOOK, ['check'], { env: childEnv(w), cwd: w.repo, input, timeoutMs: 60_000 });
  const out = parseObject(r.stdout.trim());
  if (typeof out?.matched !== 'boolean') throw Error(`BLOCKED: deep-hook check must say whether the entry matches \`${command}\`: ${shown(r)}`);
  return out.matched;
}

// ---- The change a session's claim makes, as its page reads it (`changes.read`, #83, #1999).
/** Waits up to `ms` for the claim the session's stop made on its task: `claim:<id>`. */
export async function claimOf(hub: Hub, s: Session, since: number, ms: number): Promise<string | undefined> {
  const task = `session:${s.id.replace(/[^0-9A-Za-z]/g, '')}#`;
  const deadline = Date.now() + ms;
  for (;;) {
    const made = (await allEvents(hub)).find((e) => e.kind === 'claim.made' && e.log_pos > since && (e.session === s.id || String(e.data?.task_ref ?? '').startsWith(task)));
    if (made) return `claim:${made.id}`;
    if (Date.now() > deadline) return undefined;
    await sleep(500);
  }
}
/** `changes.read` for a claim: its `change`, or undefined while the hub can't answer for it yet. */
export async function changeOf(hub: Hub, claim: string): Promise<Line | undefined> {
  try {
    const change = (await control(hub, 'changes.read', { id: claim })).change as Line | undefined;
    return change && typeof change === 'object' ? change : undefined;
  } catch {
    return undefined;
  }
}
