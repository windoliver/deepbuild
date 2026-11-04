// The paseo plugin's handlers, for the perf lane's budgets (issue #55): node benchmarks/paseo-plugin.mjs. Against a hub
// in a temp HOME, the plugin is loaded into tests/acceptance/55's stand-in for paseo's daemon, and a Copilot agent's
// turn ends and permission requests are fired at it, 3 warm-up rounds then 40 each; it prints how long the plugin's
// handlers held each gated event, p50 and p95 in ms, as one JSON line. The issue's 10 ms stays in
// tests/acceptance/55/budgets.test.ts. It stops only the hub and the stand-in it started.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const HOST = join(REPO, 'tests/acceptance/55/fixtures/paseo-host.mjs');
const ENTRY = join(REPO, 'packages/paseo/index.server.ts');
const ROUNDS = 40;
const WARM = 3;
const at = (xs, p) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil((p / 100) * xs.length) - 1)];

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-paseo-bench-')));
const cwd = join(dir, 'w');
mkdirSync(cwd);
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEEP_') && !k.startsWith('CLAUDE'))), HOME: join(dir, 'h') };
mkdirSync(env.HOME, { recursive: true });
const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
const host = spawn(process.execPath, [HOST, ENTRY], { cwd: dir, env, stdio: ['pipe', 'pipe', 'inherit'] });
const lines = [];
const waiting = [];
createInterface({ input: host.stdout }).on('line', (raw) => {
  let line;
  try { line = JSON.parse(raw); } catch { return; }
  lines.push(line);
  for (const w of [...waiting]) if (w.match(line)) { waiting.splice(waiting.indexOf(w), 1); w.done(line); }
});
const until = (match) => new Promise((done) => {
  const seen = lines.find(match);
  if (seen) done(seen);
  else waiting.push({ match, done });
});
let n = 0;
async function send(command) {
  const id = ++n;
  host.stdin.write(`${JSON.stringify({ n: id, ...command })}\n`);
  const got = await until((l) => l.n === id);
  if (got.error) throw Error(String(got.error));
  return got;
}
/** A notification fired, and how long its handlers held it. */
async function fired(name, payload) {
  const started = await send({ op: 'fire', name, payload });
  const settled = await until((l) => l.settled === started.fire);
  if (settled.errors.length) throw Error(settled.errors.join('; '));
  return Math.max(0, ...settled.ms);
}

try {
  await new Promise((resolve, reject) => { hub.stdout.once('data', resolve); hub.once('exit', () => reject(Error('the hub did not start'))); });
  await send({ op: 'load' });
  const id = 'bench-agent';
  const agent = { id, workspaceId: null, parentAgentId: null, provider: 'copilot', cwd, title: null };
  const snapshot = (status) => ({ id, provider: 'copilot', cwd, status, pendingPermissions: [], runtimeInfo: { provider: 'copilot', sessionId: 'bench-session' }, persistence: { provider: 'copilot', sessionId: 'bench-session' } });
  await send({ op: 'agent', agent, snapshot: snapshot('idle') });
  await send({ op: 'fire', name: 'agent.open.before', payload: { request: { agentId: id, workspaceId: null, provider: 'copilot', cwd, reason: 'create', purpose: 'interactive', title: null, labels: {}, tools: [], env: {}, mcpServers: {} } } });
  const held = [];
  for (let i = 1; i <= WARM + ROUNDS; i++) {
    await send({ op: 'agent', agent, snapshot: snapshot('running') });
    await fired('agent.turn.before', { agent, turnId: `t${i}` });
    const permission = await fired('agent.permission.before', { agent, request: { id: `perm-${i}`, provider: 'copilot', name: 'Bash', kind: 'tool', input: { command: 'npm test' } } });
    await send({ op: 'agent', agent, snapshot: snapshot('idle') });
    const turn = await fired('agent.turn.after', { agent, turnId: `t${i}`, outcome: { kind: 'completed' }, timeline: [] });
    if (i > WARM) held.push(permission, turn);
  }
  console.log(JSON.stringify({ events: held.length, p50Ms: at(held, 50), p95Ms: at(held, 95) }));
} finally {
  host.stdin.end();
  host.kill();
  hub.kill();
  await new Promise((done) => setTimeout(done, 500));
  rmSync(dir, { recursive: true, force: true });
}
