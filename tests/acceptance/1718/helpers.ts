// Test-side tools for the #1718 acceptance tests: a real hub (`deep hub run`) in a temporary home, a Claude Code session
// bound to it through its hooks (#26's agent stand-in, whose `deep mcp` is its own child), deep_kinds called over MCP,
// the reference reply of `deep-show run` for the same call, and the check criterion 1 states (`kindsFailures`). For
// criterion 3, the installed tree of #41 (`scripts/install-prefix.mjs`), whose hub runs the canvas core shipped beside
// its code, with that core replaced by the planted one (fixtures/stamps-at.mjs). Nothing here stands in for the hub,
// `deep mcp` or the canvas core. Processes are stopped by PID; folders are /tmp/dh1718-* (a socket path must fit in 104
// bytes) and every process runs with HOME there, so the real ~/.deepbuild, ~/.claude and ~/.codex are never touched.

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect } from 'vitest';
import * as t26 from '../26/helpers.ts';

export { t26 };
export type Line = t26.Line;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
const NODE = process.execPath;
/** The checkout's built CLI: `deep hub run` and `deep mcp`. */
export const CHECKOUT_DEEP = t26.CLI;
const PLANT = join(HERE, 'fixtures', 'stamps-at.mjs');

// ---------------------------------------------------------------------------------------------------
// Folders and processes

const made: string[] = [];
export function tempDir(tag = ''): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh1718-${tag}`));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
const own = (pid: number | undefined): void => { if (pid) { owned.add(pid); t26.own(pid); } };
/** Stops every process this suite started, by PID (SIGTERM, then SIGKILL after 3 s), and removes its folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(t26.alive) && Date.now() < deadline) await t26.sleep(50);
  for (const pid of owned) if (t26.alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  await t26.cleanup();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------------
// The canvas core the checkout's hub runs, and the deep-hook it needs to start, built once per file

/**
 * Builds `deep-show` and `deep-hook` once per file (`cargo build --locked --bin <each>`: the hub refuses to
 * start without a deep-hook); the check that fails a test, naming the build, when it didn't build.
 */
export function useCanvasCore(): () => void {
  let error = 'not built';
  beforeAll(() => {
    const env = { ...process.env };
    // The hub looks for the canvas core under the checkout's own target folder, so it is built there.
    delete env['CARGO_TARGET_DIR'];
    // One cargo run per binary, so neither changes the features the other is built with.
    for (const bin of ['deep-show', 'deep-hook']) {
      const run = spawnSync('cargo', ['build', '--locked', '--bin', bin], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
      error = run.error ? `cargo could not run: ${run.error.message}` : run.status === 0 ? '' : `cargo build --bin ${bin} failed:\n${run.stderr.slice(-4000)}`;
      if (error) break;
    }
  }, 3_600_000);
  return () => expect(error, 'the canvas core and deep-hook build: cargo build --locked --bin deep-show, then --bin deep-hook').toBe('');
}
/** A checkout's build as the hub finds it (packages/hub/src/canvas.ts `canvasCore`, paths.ts `deepHook`): the newer of target/release and target/debug. */
function checkoutBuild(name: string): string {
  const built = ['release', 'debug'].map((p) => join(REPO, 'target', p, name)).filter((p) => existsSync(p));
  expect(built.length, `BLOCKED: no ${name} is built under ${join(REPO, 'target')}`).toBeGreaterThan(0);
  return built.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
}
/** The canvas core the checkout's hub runs. */
export const checkoutCore = (): string => checkoutBuild('deep-show');

// ---------------------------------------------------------------------------------------------------
// The hub, a session bound by its hooks, and its deep mcp

/** `deep hub run` from `deep` (the checkout's CLI or an installed tree's bin/deep) with HOME the test's home. */
export async function startHub(deep: string, home: string): Promise<t26.Hub> {
  const confirm = join(dirname(home), 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const child = spawn(NODE, [deep, 'hub', 'run'], { cwd: REPO, env: t26.childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); try { resolve((JSON.parse(first.split('\n')[0]!) as Line).ready === true); } catch { resolve(false); } }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub (${deep}) didn't start: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(t26.rootOf(home), 'hub.sock'), child, output: () => out };
}

export interface Live { tmp: string; home: string; hub: t26.Hub; session: t26.Session; agent: t26.Agent }
/**
 * A hub from `deep` in a fresh home; a Claude Code session in a worktree, established through its hooks (SessionStart,
 * UserPromptSubmit, PreToolUse, each from a hook process the agent started) and recorded by the hub; the agent's own
 * `deep mcp` (the checkout's, #26's stand-in starts it as its child) initialized.
 */
export async function openSession(deep: string): Promise<Live> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home);
  const wt = t26.makeWorktree(join(tmp, 'work'));
  const hub = await startHub(deep, home);
  const agent = t26.Agent.start(home, wt.path);
  own(agent.pid);
  const session = agent.session(wt.path, 'draw a box');
  await agent.establish(hub, session, 'draw a box');
  const started = await t26.eventMatching(hub, (e) => e.kind === 'session.start' && e.session === session.id, 10_000);
  if (!started) throw Error(`BLOCKED: the hub recorded no session.start for the session its hooks started (${session.id})`);
  await t26.initialize(agent);
  return { tmp, home, hub, session, agent };
}

// ---------------------------------------------------------------------------------------------------
// deep_kinds: the calls criterion 1 names, through deep mcp and through `deep-show run`

/** The ops criterion 1 names, in its order, each with the fields it states; `read`'s example is the gallery's first hash. */
export const OPS = ['sheet', 'list', 'search', 'word', 'gallery', 'read'] as const;
export type Op = (typeof OPS)[number];
export function argsOf(op: Op, firstHash: string): Line {
  switch (op) {
    case 'search': return { op, query: 'box' };
    case 'word': return { op, word: 'BoxGeometry' };
    case 'read': return { op, example: firstHash };
    default: return { op };
  }
}

/** One deep_kinds call through the agent's `deep mcp`, with only the fields given (a field left out reads as null, #26). */
export const kindsOverMcp = (m: t26.Mcp, args: Line): Promise<t26.Outcome> => t26.callTool(m, 'deep_kinds', args);

/** `deep-show run` of one scenario holding the one deep_kinds call: its reply. */
export function kindsOnRun(bin: string, args: Line): JsonObject {
  const evidence = tempDir('ev-');
  const scenario = { evidence, calls: [{ call: 'deep_kinds', ...args }] };
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 300_000, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`${bin} run: ${r.error.message}`);
  expect(r.status, `${bin} run exits 0; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const out = JSON.parse(r.stdout.trim().split('\n')[0]!) as JsonObject;
  expect(out['ok'], `deep-show run took the scenario: ${JSON.stringify(out).slice(0, 600)}`).toBe(true);
  const reply = (out['replies'] as Json[])[0] as JsonObject;
  expect(reply['error'], `deep-show run answers deep_kinds ${String(args.op)} (the reference reply): ${JSON.stringify(reply).slice(0, 600)}`).toBeUndefined();
  return reply;
}

/** The gallery's first example's hash, as `deep-show run` lists it. */
export function firstHashOn(bin: string): string {
  const gallery = kindsOnRun(bin, { op: 'gallery' });
  const first = Array.isArray(gallery['examples']) ? (gallery['examples'][0] as JsonObject | undefined) : undefined;
  const hash = first?.['hash'];
  expect(typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash), `deep-show run's gallery lists a first example with a hash: ${JSON.stringify(gallery).slice(0, 400)}`).toBe(true);
  return hash as string;
}

/** The reference reply of every op of criterion 1, from `bin`. */
export function references(bin: string): { firstHash: string; replies: Map<Op, JsonObject> } {
  const firstHash = firstHashOn(bin);
  return { firstHash, replies: new Map(OPS.map((op) => [op, kindsOnRun(bin, argsOf(op, firstHash))])) };
}

/** The fields the criterion leaves out of the comparison. */
const LEFT_OUT = new Set(['core', 'set_digest']);
const rest = (v: JsonObject): JsonObject => Object.fromEntries(Object.entries(v).filter(([k]) => !LEFT_OUT.has(k)));
const text = (v: unknown, n = 300): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);

/**
 * Criterion 1's check for one op: the call through the hub and `deep mcp` answers without isError, and its reply equals,
 * apart from `core` and `set_digest`, the reply `deep-show run` gives the same call. Each failure names the op.
 */
export function kindsFailures(op: Op, got: t26.Outcome, want: JsonObject): string[] {
  const name = `deep_kinds ${op}`;
  if (got.protocolError) return [`${name}: deep mcp answered a JSON-RPC error, not the tool's reply: ${text(got.value, 600)}`];
  if (got.isError) {
    const e = (got.value ?? {}) as Line;
    return [`${name}: answered isError: ${String(e.code)} at ${String(e.path)}: ${String(e.remediation ?? e.message ?? text(e))}`];
  }
  if (typeof got.value !== 'object' || got.value === null || Array.isArray(got.value)) return [`${name}: the reply is no JSON object: ${text(got.value)}`];
  const [a, b] = [rest(got.value as JsonObject), rest(want)];
  const failures: string[] = [];
  for (const key of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
    if (!(key in a)) failures.push(`${name}: the reply lacks ${key}, which deep-show run's holds: ${text(b[key])}`);
    else if (!(key in b)) failures.push(`${name}: the reply holds ${key}, which deep-show run's lacks: ${text(a[key])}`);
    else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) failures.push(`${name}: ${key} differs from deep-show run's: ${text(a[key])} against ${text(b[key])}`);
  }
  return failures;
}

/** Every op of criterion 1 through `live`'s deep mcp, checked against the references: the failures, each naming its op. */
export async function allFailures(live: Live, refs: ReturnType<typeof references>): Promise<Map<Op, string[]>> {
  const out = new Map<Op, string[]>();
  for (const op of OPS) out.set(op, kindsFailures(op, await kindsOverMcp(live.agent, argsOf(op, refs.firstHash)), refs.replies.get(op)!));
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: the installed tree (#41), its canvas core replaced by the planted one

export interface Installed { prefix: string; deep: string; core: string }
/**
 * `node scripts/install-prefix.mjs --prefix <temp>`: the installed tree, whose hub runs the deep-show shipped in its
 * packages/hub/dist. Its deep-hook, which npm would install as the optional package @deepbuild/deep-hook-<platform>-<arch>
 * and the checkout's node_modules doesn't hold, is the checkout's build put where the tree's hub looks next, <tree>/target/debug.
 */
export function install(): Installed {
  const prefix = tempDir('p-');
  const r = spawnSync(NODE, [join(REPO, 'scripts', 'install-prefix.mjs'), '--prefix', prefix], { cwd: REPO, encoding: 'utf8', timeout: 1_200_000, maxBuffer: 1 << 26 });
  expect(r.status, `BLOCKED: scripts/install-prefix.mjs lays out the installed tree: ${(r.stderr || r.stdout).slice(-2000)}`).toBe(0);
  const tree = join(prefix, 'lib', 'node_modules', 'deepbuild');
  const core = join(tree, 'packages', 'hub', 'dist', 'deep-show');
  expect(existsSync(core), `BLOCKED: the installed tree ships the canvas core at ${core}`).toBe(true);
  mkdirSync(join(tree, 'target', 'debug'), { recursive: true });
  copyFileSync(checkoutBuild('deep-hook'), join(tree, 'target', 'debug', 'deep-hook'));
  chmodSync(join(tree, 'target', 'debug', 'deep-hook'), 0o755);
  return { prefix, deep: join(prefix, 'bin', 'deep'), core };
}

/**
 * Replaces the installed canvas core with the planted one: the same binary behind fixtures/stamps-at.mjs, which puts an
 * arrival time `at` on every call the hub sends `deep-show canvas` but deep_query, geometry and fn, as the merge base's
 * `CanvasSide::scenario` does, logging each stamp to the returned file. Returns the real binary's new path and the log.
 */
export function plantStampsAt(i: Installed): { real: string; log: string } {
  const real = `${i.core}.real`;
  renameSync(i.core, real);
  const log = join(dirname(i.prefix), `${i.prefix.split('/').pop()}-stamps.jsonl`);
  made.push(log);
  const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
  writeFileSync(i.core, `#!/bin/sh\n# The planted canvas core of #1718's criterion 3 (tests/acceptance/1718/README.md).\nexec ${q(NODE)} ${q(PLANT)} ${q(real)} ${q(log)} "$@"\n`);
  chmodSync(i.core, 0o755);
  return { real, log };
}
