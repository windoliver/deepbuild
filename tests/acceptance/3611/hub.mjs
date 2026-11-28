// A real hub for criterion 4's hub test (README: The surface under test): `deep hub run` from this checkout's built
// CLI with HOME a folder of the test's own, so its root is `<home>/.deepbuild`, and a `deep mcp` started by hand, as
// #26's and #1720's suites start theirs. Nothing here stands in for the hub, `deep mcp` or the canvas core the hub
// starts. Each process is stopped by its PID, and the real `~/.deepbuild` is never touched.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { REPO, blocked, brief, inconclusive, within } from './core.mjs';

/** The checkout's built CLI: `deep hub run`, `deep mcp`. */
const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;

/**
 * What the checkout's hub runs: the canvas core and the hook client it won't start without, which it finds only under
 * the checkout's own `target/`. The proof run puts its own builds there for a test that names the CLI's package; run
 * by hand, this builds them, each in a cargo run of its own, as #1720's suite does. BLOCKED when one is missing.
 */
export function hubBinaries() {
  if (!existsSync(CLI)) throw blocked(`${CLI} is missing: run npm run build --workspaces`);
  if (process.env.DEEP_BIN_DIR === undefined) {
    const env = { ...process.env };
    delete env.CARGO_TARGET_DIR;
    const show = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    if (show.error || show.status !== 0) throw blocked(`cargo build --locked --bin deep-show failed: ${show.error?.message ?? show.stderr.slice(-3000)}`);
    const hook = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-hook'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    if (hook.error || hook.status !== 0) throw blocked(`cargo build --locked --bin deep-hook failed: ${hook.error?.message ?? hook.stderr.slice(-3000)}`);
  }
  for (const name of ['deep-show', 'deep-hook']) {
    if (!['release', 'debug'].some((profile) => existsSync(join(REPO, 'target', profile, name)))) throw blocked(`no ${name} is built under ${join(REPO, 'target')}, where this checkout's hub looks for it`);
  }
}

/** This environment with HOME moved to the test's home and none of the hub's own settings, as #26's suite makes it. */
function childEnv(home, extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('TMUX') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}

const stopped = (child) => child.exitCode !== null || child.signalCode !== null;
/** Stops a child by its PID, SIGTERM and after 15 s SIGKILL, and waits for its end. */
async function stop(child) {
  if (stopped(child) || !child.pid) return;
  const ended = new Promise((done) => child.once('exit', done));
  try { process.kill(child.pid, 'SIGTERM'); } catch { return; }
  // deadline: a hub that doesn't end on SIGTERM is stopped for good, so no test leaves one behind.
  const timer = setTimeout(() => { try { process.kill(child.pid, 'SIGKILL'); } catch { /* it has ended */ } }, 15_000);
  await ended;
  clearTimeout(timer);
}

/**
 * Starts `deep hub run` in `home` and waits for its ready line. Gives `{pid, root, stop()}`, `root` the hub's root.
 * Its OS confirmation is #24's stub, as in #26's suite. BLOCKED when it doesn't start.
 */
export async function startHub(home) {
  mkdirSync(home, { recursive: true });
  const confirm = join(dirname(home), 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  child.stderr.setEncoding('utf8').on('data', (d) => { out = (out + d).slice(-4000); });
  const ready = new Promise((done) => {
    let first = '';
    child.stdout.setEncoding('utf8').on('data', (d) => {
      out = (out + d).slice(-4000);
      first += d;
      if (!first.includes('\n')) return;
      try { done(JSON.parse(first.split('\n')[0]).ready === true); } catch { done(false); }
    });
    child.once('exit', () => done(false));
    child.once('error', () => done(false));
  });
  let ok = false;
  try { ok = await within(ready, 'ready line of the hub', () => undefined, 120_000); } finally { if (!ok) await stop(child); }
  if (!ok) throw blocked(`the hub didn't start: ${out.slice(0, 2000)}`);
  return { pid: child.pid, root: join(home, '.deepbuild'), said: () => out, stop: () => stop(child) };
}

/**
 * A `deep mcp` started by hand in `cwd`, initialized: `tool(name, args, ms)` gives a tool call's result as
 * `{ok, value, ms}`, `value` its structured content or its first text block's JSON; `stop()` ends it.
 */
export async function startMcp(home, cwd) {
  const child = spawn(NODE, [CLI, 'mcp'], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'pipe'] });
  let said = '';
  child.stderr.setEncoding('utf8').on('data', (d) => { said = (said + d).slice(-2000); });
  child.stdin.on('error', () => undefined);
  const waiting = new Map();
  createInterface({ input: child.stdout }).on('line', (raw) => {
    let line;
    try { line = JSON.parse(raw); } catch { return; }
    if (line && waiting.has(line.id) && ('result' in line || 'error' in line)) { waiting.get(line.id)(line); waiting.delete(line.id); }
  });
  child.once('exit', () => { for (const wake of waiting.values()) wake({ error: { message: `deep mcp exited: ${said.trim()}` } }); waiting.clear(); });
  let ids = 0;
  const request = (method, params, ms) => {
    const id = `t3611#${++ids}`;
    const reply = new Promise((done) => {
      if (stopped(child)) return done({ error: { message: `deep mcp exited: ${said.trim()}` } });
      waiting.set(id, done);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
    return within(reply, `reply of deep mcp to ${method}`, () => undefined, ms);
  };
  const mcp = {
    async tool(name, args, ms) {
      const at = performance.now();
      const reply = await request('tools/call', { name, arguments: args }, ms);
      const took = performance.now() - at;
      if (reply.error) return { ok: false, value: reply.error, ms: took };
      const result = reply.result ?? {};
      const text = Array.isArray(result.content) ? result.content.find((c) => c?.type === 'text')?.text : undefined;
      let value = result.structuredContent;
      if (value === undefined && typeof text === 'string') { try { value = JSON.parse(text); } catch { value = text; } }
      return { ok: result.isError !== true, value, ms: took };
    },
    stop: () => stop(child),
  };
  try {
    const hello = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-3611', version: '0' } }, 120_000);
    if (!hello.result) throw blocked(`deep mcp refused initialize: ${brief(hello, 600)}`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
  } catch (error) {
    await stop(child);
    throw error;
  }
  return mcp;
}

/**
 * Asks the hub for the first page of `deep_kinds list` through `mcp`, which is the first call that needs the
 * release's packs: the hub's canvas core checks each before it answers. `deep mcp` gives a call 55 s, less than a
 * debug core takes on a loaded machine, and the hub's core goes on checking, so a call that ran out is asked again
 * until `most` has passed. Gives the listing's first page. INCONCLUSIVE when none came; BLOCKED on a refusal.
 */
export async function firstListing(mcp, most) {
  const from = Date.now();
  for (;;) {
    const got = await mcp.tool('deep_kinds', { op: 'list' }, 120_000);
    if (got.ok && typeof got.value === 'object' && got.value !== null && Array.isArray(got.value.registries)) return got.value;
    // A refusal that came at once is the hub's answer, not a wait that ran out.
    if (got.ms < 20_000) throw blocked(`deep_kinds list through the hub was refused: ${brief(got.value, 800)}`);
    if (Date.now() - from > most) throw inconclusive(`the hub gave no deep_kinds listing within ${Math.round(most / 60_000)} minutes: its last answer was ${brief(got.value, 600)}`);
  }
}
