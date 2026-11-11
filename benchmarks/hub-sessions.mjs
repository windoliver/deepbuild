// DeepBuild's memory per session (issue #824): node benchmarks/hub-sessions.mjs [--home dir] [--merge-base].
// A hub on a temp home, set up for Claude Code by `deep setup`, serves 1, then 10, then 30 scripted sessions, each open
// and idle: a stand-in agent with a 32 MiB transcript starts the MCP servers ~/.claude.json names, makes one tool call
// through `deep mcp`, runs its turn's hooks through deep-hook and leaves the Stop entry's waiter waiting. At each count
// it reads every process DeepBuild runs for them, counting shared pages once (Linux's Pss, macOS's phys_footprint):
// the hub, each session's servers and waiter, and every process under them. The reading is the most any step between
// counts added per session, and it must be under 25 MB. It prints the readings as one JSON line, then PASS, FAIL or
// BLOCKED, and stops what it started by PID. `--agent <spec>` is one session's stand-in, which this starts.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
/** Under 25 MB per session added past the first; 1 MB is 10^6 bytes. */
const LIMIT = 25_000_000;
const COUNTS = [1, 10, 30];
/** A long resumed session's transcript, written before its first hook: the hub reads none of it. */
const TRANSCRIPT_BYTES = 32 * 2 ** 20;
const STEP_MS = 120_000;
/** How long the sessions sit idle before a reading, so each process has settled after its start. */
const SETTLE_MS = 5000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mb = (bytes) => `${(bytes / 1e6).toFixed(3)} MB`;
/** A reading that can't be had, or a session that can't be opened: BLOCKED, never PASS. */
class Blocked extends Error {}

function flag(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
}
/**
 * Runs a settings entry's command line as Claude Code runs a hook, the shell replaced by the command: setup writes
 * `exec '<deep-hook>' claude-code <event>` on main, and wrote it without the exec at the merge base.
 */
const shell = (command, cwd) => spawn('/bin/sh', ['-c', /^exec\s/.test(command) ? command : `exec ${command}`], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
const within = (promise, what, ms = STEP_MS) => {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Blocked(`${what}: nothing within ${ms / 1000} s`)), ms).unref(); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
};

// ---- One session's stand-in agent: its MCP servers and its hooks are its children, as Claude Code's are.
async function agent(spec) {
  const { session, transcript, cwd, servers, hooks, waiter } = spec;
  // Claude Code transcript lines, written whole before the first hook.
  const turn = `${JSON.stringify({ type: 'user', sessionId: session, cwd, message: { role: 'user', content: 'x'.repeat(900) } })}\n`;
  writeFileSync(transcript, turn.repeat(Math.ceil(TRANSCRIPT_BYTES / Buffer.byteLength(turn))));
  const started = {};
  const children = [];
  process.stdin.on('end', () => { for (const child of children) child.kill(); process.exit(0); }).resume();
  const rpc = {};
  for (const [name, { command, args }] of Object.entries(servers)) {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'inherit'] });
    children.push(child);
    started[name] = child.pid;
    const waiting = new Map();
    let n = 0;
    createInterface({ input: child.stdout }).on('line', (text) => {
      const reply = JSON.parse(text);
      waiting.get(reply.id)?.(reply);
      waiting.delete(reply.id);
    });
    rpc[name] = (method, params) => within(new Promise((done) => {
      const id = ++n;
      waiting.set(id, done);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    }), `${name}: ${method}`);
    const init = await rpc[name]('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '0' } });
    if (!init.result) throw Error(`${name} refused initialize: ${JSON.stringify(init)}`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  }
  const fire = async (event, extra = {}) => {
    const child = shell(hooks[event], cwd);
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { out += d; });
    child.stdin.end(JSON.stringify({ session_id: session, transcript_path: transcript, cwd, hook_event_name: event, permission_mode: 'default', ...extra }));
    const code = await within(new Promise((done) => child.on('close', done)), event);
    if (code !== 0) throw Error(`${event} exited ${code}: ${out}`);
  };
  await fire('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
  await fire('UserPromptSubmit', { prompt: 'what does the deploy say?' });
  const call = { tool_name: 'mcp__deepbuild__deep_status', tool_input: {}, tool_use_id: `toolu_${randomUUID()}` };
  await fire('PreToolUse', call);
  const status = await rpc.deepbuild('tools/call', { name: 'deep_status', arguments: {} });
  if (!status.result || status.result.isError) throw Error(`deep_status through deep mcp: ${JSON.stringify(status)}`);
  await fire('PostToolUse', { ...call, tool_response: status.result.structuredContent ?? {} });
  const stop = { stop_hook_active: false, last_assistant_message: 'The deploy is green.' };
  await fire('Stop', stop);
  const waiting = shell(waiter, cwd);
  children.push(waiting);
  waiting.stdin.end(JSON.stringify({ session_id: session, transcript_path: transcript, cwd, hook_event_name: 'Stop', permission_mode: 'default', ...stop }));
  started.waiter = waiting.pid;
  // The waiter has read its payload and waits on the hub before the session counts as idle.
  await sleep(500);
  if (waiting.exitCode !== null) throw Error(`the waiter exited ${waiting.exitCode} instead of waiting`);
  console.log(JSON.stringify({ ready: started }));
}

// ---- Memory, shared pages counted once.
/** Each live process's bytes, by PID; one that's gone isn't in the map. */
function memoryOf(pids) {
  if (process.env.DEEP_HUB_PLANT === 'sessions-no-memory-read') throw new Blocked('this platform reads no process\'s memory (the planted sessions-no-memory-read)');
  const bytes = new Map();
  if (process.platform === 'linux') {
    for (const pid of pids) {
      let text;
      try { text = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'); } catch { continue; }
      const pss = /^Pss:\s+(\d+) kB$/m.exec(text);
      if (!pss) throw new Blocked(`/proc/${pid}/smaps_rollup holds no Pss line`);
      bytes.set(pid, Number(pss[1]) * 1024);
    }
  } else if (process.platform === 'darwin') {
    // One footprint for them all: a header line per process, `<name> [<pid>]: 64-bit    Footprint: <n> B ...`.
    const r = spawnSync('/usr/bin/footprint', ['-f', 'bytes', ...pids.flatMap((pid) => ['-p', String(pid)])], { encoding: 'utf8', maxBuffer: 2 ** 28 });
    if (r.error) throw new Blocked(`footprint can't read the processes' memory: ${r.error.message}`);
    for (const m of r.stdout.matchAll(/^.* \[(\d+)\]: \S+\s+Footprint: (\d+) B\b/gm)) bytes.set(Number(m[1]), Number(m[2]));
    if (!bytes.size) throw new Blocked(`footprint read no process: exit ${r.status}: ${r.stderr.trim()}`);
  } else {
    throw new Blocked(`no way to read a process's memory with shared pages counted once on ${process.platform}`);
  }
  return bytes;
}
/** Every process: its parent and its command line as the OS shows it. */
function table() {
  const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,args='], { encoding: 'utf8', maxBuffer: 2 ** 26 });
  if (r.error || r.status) throw new Blocked(`ps can't list the processes: ${r.error?.message ?? r.stderr}`);
  const rows = new Map();
  for (const row of r.stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s(.*)$/.exec(row);
    if (m) rows.set(Number(m[1]), { ppid: Number(m[2]), command: m[3].trim() });
  }
  return rows;
}
/** The processes of each role and every process under them, read once. */
function reading(sessions, roots) {
  const at = Date.now();
  const rows = table();
  const processes = [];
  const add = (pid, role, child) => {
    const row = rows.get(pid);
    if (!row) throw new Blocked(`the ${role} ${pid} is gone`);
    processes.push({ pid, ppid: row.ppid, role, child, command: row.command });
    for (const [kid, r] of rows) if (r.ppid === pid) add(kid, role, true);
  };
  for (const { pid, role } of roots) add(pid, role, false);
  const bytes = memoryOf(processes.map((p) => p.pid));
  // A child gone since the table was read, such as a hook's helper, isn't held; one still running that can't be read is,
  // and so is one of DeepBuild's own.
  const running = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
  const read = processes.filter((p) => bytes.has(p.pid) || !p.child || running(p.pid));
  for (const p of read) {
    if (!bytes.has(p.pid)) throw new Blocked(`the ${p.role} ${p.pid} couldn't be read`);
    p.bytes = bytes.get(p.pid);
  }
  return { sessions, at, totalBytes: read.reduce((sum, p) => sum + p.bytes, 0), processes: read };
}
/** The most any step between consecutive counts added per session, for the processes `pick` takes. */
function perSession(readings, pick = () => true) {
  let most = -Infinity;
  for (let i = 1; i < readings.length; i++) {
    const [a, b] = [readings[i - 1], readings[i]];
    const sum = (r) => r.processes.filter(pick).reduce((total, p) => total + p.bytes, 0);
    most = Math.max(most, (sum(b) - sum(a)) / (b.sessions - a.sessions));
  }
  return Math.round(most);
}

// ---- The run: a hub, setup, and the sessions opened one count at a time.
async function run({ cli, home }) {
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const work = join(home, 'work');
  mkdirSync(work, { recursive: true });
  const confirm = join(home, 'confirm');
  writeFileSync(confirm, 'confirmed');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key === 'DEEP_HUB_PLANT' || !/^(DEEP_|CLAUDE|ANTHROPIC|OPENAI|CODEX|GH_TOKEN|GITHUB_TOKEN|NODE_OPTIONS)/.test(key))), HOME: home, DEEP_HUB_TEST_CONFIRM: confirm };
  // Memory that can't be read is BLOCKED before any session is spent on it.
  memoryOf([process.pid]);
  const hub = spawn(process.execPath, [cli, 'hub', 'run'], { cwd: work, env, stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise((resolve) => hub.on('exit', resolve));
  let stderr = '';
  hub.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000); });
  const agents = [];
  try {
    const socket = join(root, 'hub.sock');
    const t0 = Date.now();
    while (!(await new Promise((resolve) => {
      const sock = net.connect(socket).on('error', () => resolve(false)).once('data', () => { sock.destroy(); resolve(true); });
      sock.setTimeout(2000, () => { sock.destroy(); resolve(false); });
    }))) {
      if (hub.exitCode !== null) throw new Blocked(`the hub exited ${hub.exitCode}: ${stderr}`);
      if (Date.now() - t0 > STEP_MS) throw new Blocked(`the hub did not answer: ${stderr}`);
      await sleep(50);
    }
    // deep setup with the hub already answering, as a person runs it: it writes the entries the sessions run.
    const setup = spawnSync(process.execPath, [cli, 'setup'], { cwd: work, env, encoding: 'utf8', timeout: 20 * 60_000 });
    if (setup.status !== 0) throw new Blocked(`deep setup exited ${setup.status}: ${setup.stderr}${setup.stdout}`);
    const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    const entries = (event) => settings.hooks[event].flatMap((group) => group.hooks);
    const hooks = Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'].map((event) => [event, entries(event).find((h) => !h.asyncRewake).command]));
    const waiter = entries('Stop').find((h) => h.asyncRewake)?.command;
    const servers = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).mcpServers;
    if (!waiter || !servers.deepbuild || !servers['deep-actions']) throw new Blocked(`deep setup wrote no waiter or MCP servers: ${JSON.stringify({ waiter, servers })}`);
    const roles = { deepbuild: 'deep mcp', 'deep-actions': 'deep mcp actions', waiter: 'waiter' };

    const open = async () => {
      // Each session in a working folder of its own, as each agent session opens in its own checkout.
      const session = randomUUID();
      const cwd = join(home, `work-${agents.length + 1}`);
      mkdirSync(cwd);
      const project = join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
      mkdirSync(project, { recursive: true });
      const spec = { session, transcript: join(project, `${session}.jsonl`), cwd, servers: { deepbuild: servers.deepbuild, 'deep-actions': servers['deep-actions'] }, hooks, waiter };
      const child = spawn(process.execPath, [SELF, '--agent', JSON.stringify(spec)], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
      agents.push(child);
      let said = '';
      child.stderr.setEncoding('utf8').on('data', (d) => { said = (said + d).slice(-4000); });
      const ready = await within(new Promise((resolve) => {
        createInterface({ input: child.stdout }).on('line', (text) => { try { resolve(JSON.parse(text).ready); } catch { /* not its line */ } });
        child.on('exit', () => resolve(undefined));
      }), `session ${agents.length}`, 5 * STEP_MS);
      if (!ready) throw new Blocked(`session ${agents.length} didn't open: ${said}`);
      return Object.entries(ready).map(([name, pid]) => ({ pid, role: roles[name] }));
    };
    const roots = [{ pid: hub.pid, role: 'hub' }];
    const readings = [];
    for (const count of COUNTS) {
      while (agents.length < count) {
        const batch = Math.min(5, count - agents.length);
        for (const opened of await Promise.all(Array.from({ length: batch }, open))) roots.push(...opened);
      }
      await sleep(SETTLE_MS);
      readings.push(reading(count, roots));
    }
    const perSessionBytes = perSession(readings);
    const grew = ['hub', 'deep mcp', 'deep mcp actions', 'waiter'].map((role) => ({ role, perSessionBytes: perSession(readings, (p) => p.role === role) })).sort((a, b) => b.perSessionBytes - a.perSessionBytes)[0];
    return { bench: 'hub-sessions', platform: process.platform, method: process.platform === 'darwin' ? 'phys_footprint' : 'pss', limitBytes: LIMIT, readings, perSessionBytes, grew };
  } finally {
    for (const child of agents) child.stdin.end();
    await sleep(500);
    for (const child of agents) child.kill('SIGKILL');
    hub.kill('SIGTERM');
    const killing = setTimeout(() => hub.kill('SIGKILL'), 30_000);
    await exited;
    clearTimeout(killing);
  }
}
/** The merge base's side: its own build, its own setup and these same sessions, after this side's run. */
function mergeBase() {
  const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  const commit = git('merge-base', 'HEAD', 'origin/main');
  const copy = realpathSync(mkdtempSync('/tmp/deep-sessions-base-'));
  const scratch = realpathSync(mkdtempSync('/tmp/deep-sessions-base-home-'));
  try {
    const archive = spawnSync('/usr/bin/git', ['archive', commit], { cwd: ROOT, maxBuffer: 2 ** 31 });
    execFileSync('tar', ['-xf', '-', '-C', copy], { input: archive.stdout, maxBuffer: 2 ** 31 });
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: copy, stdio: 'ignore' });
    if (spawnSync('npm', ['run', 'build', '--workspaces'], { cwd: copy, stdio: 'ignore' }).status) execFileSync('npm', ['run', 'build', '--workspaces'], { cwd: copy, stdio: 'ignore' });
    const { DEEP_HUB_PLANT: _plant, ...env } = process.env;
    const out = spawnSync(process.execPath, [SELF, '--cli', join(copy, 'packages/cli/dist/main.js'), '--home', join(scratch, 'h')], { env, encoding: 'utf8', maxBuffer: 2 ** 28, timeout: 2 * 60 * 60_000 }).stdout;
    const line = out.split('\n').find((text) => text.startsWith('{"bench"'));
    if (!line) return { commit, initial: `the merge base ${commit} gave no reading: ${out.split('\n').find((text) => text.startsWith('BLOCKED')) ?? 'it printed nothing'}` };
    return { commit, perSessionBytes: JSON.parse(line).perSessionBytes };
  } catch (error) {
    return { commit, initial: `the merge base ${commit} can't be built here: ${error.message}` };
  } finally {
    rmSync(copy, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--agent') {
  await agent(JSON.parse(process.argv[3])).catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exit(1); });
} else {
  const given = flag('home');
  const home = given ?? join(realpathSync(mkdtempSync('/tmp/deep-sessions-')), 'h');
  mkdirSync(home, { recursive: true });
  try {
    const line = await run({ cli: flag('cli') ?? join(ROOT, 'packages/cli/dist/main.js'), home: realpathSync(home) });
    if (process.argv.includes('--merge-base')) line.mergeBase = mergeBase();
    console.log(JSON.stringify(line));
    const words = `each session added past the first raised DeepBuild's summed memory by ${mb(line.perSessionBytes)}, the most from ${line.grew.role} (${mb(line.grew.perSessionBytes)} per added session)`;
    if (line.perSessionBytes >= LIMIT) {
      console.log(`FAIL hub sessions: ${words}; the limit is under ${mb(LIMIT)}\n  Fix: Find what ${line.grew.role} holds for each session and stop holding it, or start less for each session.`);
      process.exitCode = 1;
    } else console.log(`PASS hub sessions: ${words}, under ${mb(LIMIT)}`);
  } catch (error) {
    if (!(error instanceof Blocked)) throw error;
    console.log(`BLOCKED hub sessions: ${error.message}\n  Fix: Run it on Linux or macOS, where each process's memory can be read with shared pages counted once, and the hub answers.`);
    process.exitCode = 1;
  } finally {
    if (!given) rmSync(join(home, '..'), { recursive: true, force: true });
  }
}
