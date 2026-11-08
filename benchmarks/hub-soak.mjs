// The release soak (#41): node benchmarks/hub-soak.mjs --sessions 30 --duration <ms> --sample <ms> [--root <dir>].
// A hub on a home of its own runs rounds of `sessions` Claude Code sessions open at once (start, a prompt, tool calls,
// end) for `duration`, and reads its own open files, resident memory and child processes from hub.health between
// rounds, every `sample` ms. The first reading after the first eighth of the run is the baseline, as hour one is of
// the release's 8 hours; the run fails when any one's last reading is more than 10% over its baseline. It prints one
// JSON line {baseline, last, verdict, reasons} and stops the hub it started by PID. DEEP_HUB_PLANT passes to the hub.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../packages/cli/dist/main.js', import.meta.url));
const GROWTH = 0.1;
const METRICS = ['openFiles', 'rssBytes', 'children'];
const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
};
const sessions = Number(flag('sessions', 30));
const duration = Number(flag('duration', 8 * 3600_000));
const sample = Number(flag('sample', 60_000));
const home = realpathSync(flag('root') ?? mkdtempSync(join(tmpdir(), 'deep-soak-')));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let counter = 0n;
/** A ULID now, with a counter for its random part: unique and ordered, as a hook request's id must be. */
function ulid() {
  let s = '';
  let value = (BigInt(Date.now()) << 80n) | counter++;
  for (let i = 0; i < 26; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}

/** One hook request on a connection of its own, as deep-hook makes it. */
function hook(socket, request) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buffer = '';
    sock.setEncoding('utf8');
    sock.on('error', reject);
    sock.on('close', () => reject(Error('the hub closed the connection')));
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line.hello) sock.write(`${JSON.stringify(request)}\n`);
        else if ('exit' in line || 'error' in line) { sock.destroy(); resolve(line); }
      }
    });
  });
}
/** A control connection: `call` resolves with a method's reply. */
function connect(socket, hello) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    const waiting = new Map();
    let buffer = '';
    let n = 0;
    sock.setEncoding('utf8');
    sock.on('error', reject);
    // A hub that dies mid-run answers no call: each waiting one gets an error, so the run reports it rather than hangs.
    sock.on('close', () => { for (const done of waiting.values()) done({ error: { message: 'the hub closed the control connection' } }); waiting.clear(); });
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line.hello) sock.write(`${JSON.stringify({ v: 1, ...hello })}\n`);
        else if (line.role) resolve({ call: (method, params = {}) => new Promise((done) => { const id = `s${++n}`; waiting.set(id, done); sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`); }), close: () => sock.destroy() });
        else if (line.error && !line.id) reject(Error(JSON.stringify(line.error)));
        else if (waiting.has(line.id)) { waiting.get(line.id)(line); waiting.delete(line.id); }
      }
    });
  });
}

const root = join(home, '.deepbuild');
const work = join(home, 'work');
const transcripts = join(home, '.claude', 'projects', 'work');
for (const dir of [root, work, transcripts]) mkdirSync(dir, { recursive: true, mode: 0o700 });
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key === 'DEEP_HUB_PLANT' || !/^(DEEP_|CLAUDE|ANTHROPIC|OPENAI|CODEX|GH_TOKEN|GITHUB_TOKEN|NODE_OPTIONS)/.test(key)));
// V8's optimizing tiers keep compiling long after warm-up, growth that is no leak (as hub-churn found).
const hub = spawn(process.execPath, ['--no-opt', '--no-maglev', '--no-sparkplug', CLI, 'hub', 'run'], { cwd: work, env: { ...env, HOME: home }, stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
hub.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000); });
const exited = new Promise((resolve) => hub.once('exit', resolve));
/** Stops the hub this run started, by its PID, and waits until it has exited, so nothing writes under the root after. */
const stop = async () => {
  if (hub.exitCode !== null || hub.signalCode !== null) return;
  hub.kill('SIGTERM');
  const late = setTimeout(() => hub.kill('SIGKILL'), 15_000);
  await exited;
  clearTimeout(late);
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop().then(() => process.exit(1)); });

let code = 1;
try {
  const socket = join(root, 'hub.sock');
  let app;
  for (const t0 = Date.now(); ;) {
    try {
      app = await connect(socket, { hello: 'app', token: readFileSync(join(root, 'control.token'), 'utf8').trim() });
      break;
    } catch {
      if (hub.exitCode !== null) throw Error(`BLOCKED: the hub exited ${hub.exitCode}: ${stderr}`);
      if (Date.now() - t0 > 60_000) throw Error(`BLOCKED: the hub did not answer within 60 s: ${stderr}`);
      await sleep(50);
    }
  }
  const reading = async () => {
    const reply = await app.call('hub.health');
    if (!reply.result?.process) throw Error(`BLOCKED: hub.health reports no process readings: ${JSON.stringify(reply.error ?? reply.result)}`);
    return reply.result.process;
  };

  let seq = BigInt(Date.now()) * 1_000_000n;
  const fire = async (session, event, extra = {}) => {
    const reply = await hook(socket, {
      v: 1, agent: 'claude-code', event, seq: String(seq += 1000n), id: ulid(), pid: process.pid, ppid: process.pid, matched: [],
      payload: { session_id: session, transcript_path: join(transcripts, `${session}.jsonl`), cwd: work, hook_event_name: event, ...extra },
    });
    if (reply.error) throw Error(`BLOCKED: ${event}: ${JSON.stringify(reply.error)}`);
  };
  /** One round: every session started and working before any ends, so `sessions` are open at once. */
  const round = async (n) => {
    const ids = Array.from({ length: sessions }, () => randomUUID());
    for (const id of ids) writeFileSync(join(transcripts, `${id}.jsonl`), '');
    await Promise.all(ids.map((id) => fire(id, 'SessionStart', { source: 'startup' })));
    await Promise.all(ids.map(async (id, i) => {
      await fire(id, 'UserPromptSubmit', { prompt: 'what does the deploy say?' });
      const call = { tool_name: 'Bash', tool_input: { command: `ls src/${i}` }, tool_use_id: `toolu_${n}_${i}` };
      await fire(id, 'PreToolUse', call);
      await fire(id, 'PostToolUse', { ...call, tool_response: { stdout: '', stderr: '', exit_code: 0 } });
    }));
    await Promise.all(ids.map((id) => fire(id, 'SessionEnd', { reason: 'exit' })));
  };

  const start = Date.now();
  let baseline, last, nextSample = start, n = 0;
  while (Date.now() - start < duration) {
    await round(n++);
    if (Date.now() < nextSample) continue;
    // Read between rounds, with no hook connection of a round still open.
    await sleep(200);
    last = await reading();
    if (!baseline && Date.now() - start >= duration / 8) baseline = last;
    nextSample = Date.now() + sample;
  }
  await sleep(200);
  last = await reading();
  baseline ??= last;
  const reasons = METRICS.filter((m) => last[m] > baseline[m] * (1 + GROWTH)).map((m) => `${m} grew from ${baseline[m]} to ${last[m]}, more than ${GROWTH * 100}% over its level after the first eighth of the run`);
  const verdict = reasons.length ? 'FAIL' : 'PASS';
  console.log(JSON.stringify({ baseline, last, verdict, reasons, rounds: n, sessions }));
  code = verdict === 'PASS' ? 0 : 1;
  app.close();
} catch (error) {
  await Promise.race([exited, sleep(2000)]);
  const died = hub.exitCode !== null || hub.signalCode !== null ? [`the hub exited ${hub.exitCode ?? hub.signalCode}: ${stderr}`] : [];
  console.log(JSON.stringify({ verdict: 'BLOCKED', reasons: [error instanceof Error ? error.message : String(error), ...died] }));
  code = 2;
} finally {
  await stop();
}
process.exit(code);
