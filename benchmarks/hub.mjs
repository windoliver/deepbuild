// One hub workload per run, for the perf lane's budgets (issues #16 and #34): node benchmarks/hub.mjs <mode>.
// Each starts `deep hub run` on a temp home, does its work, prints its readings as one JSON line, and stops
// the hub it started by PID.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../packages/cli/dist/main.js', import.meta.url));
const DAY = 86_400_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One connection: resolves with each line the hub writes, through `onLine`, until it closes. */
function exchange(socket, request) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buffer = '';
    let sent = 0;
    sock.setEncoding('utf8');
    sock.on('error', reject);
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line.hello && request) {
          sent = performance.now();
          sock.write(`${JSON.stringify(request)}\n`);
        } else if ('exit' in line || 'error' in line || !request) {
          sock.destroy();
          resolve(performance.now() - sent);
        }
      }
    });
  });
}

/** A connection as the app, with the hub's control token: `call` resolves with a reply, `onFrame` gets each frame. */
function asApp(home, socket) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    const waiting = new Map();
    let buffer = '';
    let n = 0;
    const app = {
      onFrame: () => undefined,
      call: (method, params) => new Promise((done) => {
        const id = `b${++n}`;
        waiting.set(id, done);
        sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
      }),
      close: () => sock.destroy(),
    };
    sock.setEncoding('utf8');
    sock.on('error', reject);
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line.hello) sock.write(`${JSON.stringify({ v: 1, hello: 'app', token: readFileSync(join(home, '.deepbuild', 'control.token'), 'utf8').trim() })}\n`);
        else if (line.role) resolve(app);
        else if (line.event) app.onFrame(line.event);
        else if (waiting.has(line.id)) { waiting.get(line.id)(line); waiting.delete(line.id); }
      }
    });
  });
}
/** A PreToolUse request as deep-hook sends it. */
function hookRequest(home, i) {
  const session = '6f1c2b9e-1111-4222-8333-444455556666';
  const cwd = join(home, 'work');
  const payload = { session_id: session, transcript_path: join(home, '.claude', 'projects', 'work', `${session}.jsonl`), cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `ls src/${i}` }, tool_use_id: `call_${i}` };
  return { v: 1, agent: 'claude-code', event: 'PreToolUse', seq: `${1_760_013_451_000_000_000n + BigInt(i)}`, id: `01K74FKZVK8Q2X5R7M${String(i).padStart(8, '0')}`, pid: process.pid, ppid: process.ppid, matched: [], payload };
}
/** A UserPromptSubmit request as deep-hook sends it, for a prompt that asks for a change (#303). */
function promptRequest(home, i) {
  const session = '6f1c2b9e-1111-4222-8333-444455557777';
  const cwd = join(home, 'work');
  const prompt = `make the auth middleware reject expired tokens in the h${i} handler`;
  const payload = { session_id: session, transcript_path: join(home, '.claude', 'projects', 'work', `${session}.jsonl`), cwd, hook_event_name: 'UserPromptSubmit', prompt };
  return { v: 1, agent: 'claude-code', event: 'UserPromptSubmit', seq: `${1_760_013_452_000_000_000n + BigInt(i)}`, id: `01K74FKZVK8Q2X5R7P${String(i).padStart(8, '0')}`, pid: process.pid, ppid: process.ppid, matched: [], payload };
}
const percentiles = (samples) => {
  samples.sort((a, b) => a - b);
  return { p50Ms: samples[Math.floor(samples.length * 0.5)], p95Ms: samples[Math.floor(samples.length * 0.95)] };
};
/** The log's end, through events.read. */
async function logEnd(app) {
  let after = 0;
  for (;;) {
    const { result } = await app.call('events.read', { after, limit: 10_000 });
    if (!result.events.length) return after;
    after = result.log_pos;
  }
}

async function start(home) {
  const socket = join(home, '.deepbuild', 'hub.sock');
  const t0 = performance.now();
  const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env: { ...process.env, HOME: home }, stdio: 'ignore' });
  for (;;) {
    try {
      await exchange(socket);
      break;
    } catch {
      if (performance.now() - t0 > 10_000) throw Error('the hub did not answer within 10 s');
      await sleep(2);
    }
  }
  return { hub, socket, coldMs: performance.now() - t0 };
}
async function stop(hub) {
  const exited = new Promise((resolve) => hub.on('exit', resolve));
  hub.kill('SIGTERM');
  await exited;
}

const modes = {
  // From spawning the hub to its socket answering.
  async 'cold-start'(home) {
    const { hub, coldMs } = await start(home);
    await stop(hub);
    return { coldMs };
  },
  // 1,000 PreToolUse requests, one connection each, as deep-hook makes them: the round trip at p95.
  async 'round-trip'(home) {
    const { hub, socket } = await start(home);
    mkdirSync(join(home, 'work'));
    const samples = [];
    for (let i = 0; i < 1000; i++) samples.push(await exchange(socket, hookRequest(home, i)));
    await stop(hub);
    samples.sort((a, b) => a - b);
    return { p50Ms: samples[499], p95Ms: samples[949] };
  },
  // 1,000 UserPromptSubmit requests for prompts that ask for a change, one connection each, after 20 to warm up (#303).
  async prompt(home) {
    const { hub, socket } = await start(home);
    mkdirSync(join(home, 'work'));
    for (let i = 0; i < 20; i++) await exchange(socket, promptRequest(home, 1000 + i));
    const samples = [];
    for (let i = 0; i < 1000; i++) samples.push(await exchange(socket, promptRequest(home, i)));
    await stop(hub);
    return percentiles(samples);
  },
  // 1,000 PreToolUse requests, each timed from its write to the app's stream frame for its event (#34).
  async stream(home) {
    const { hub, socket } = await start(home);
    mkdirSync(join(home, 'work'));
    const app = await asApp(home, socket);
    await app.call('stream.subscribe', { after: await logEnd(app) });
    const arrived = new Map();
    app.onFrame = (event) => arrived.get(event.id)?.(performance.now());
    const samples = [];
    for (let i = 0; i < 1000; i++) {
      const request = hookRequest(home, i);
      const frame = new Promise((resolve) => arrived.set(request.id, resolve));
      const t0 = performance.now();
      void exchange(socket, request);
      samples.push((await frame) - t0);
    }
    app.close();
    await stop(hub);
    return percentiles(samples);
  },
  // 30 days of history, about 3,000 events a day, paged by the app from 0 to the log's end through events.read (#34).
  async history(home) {
    const { openRecord } = await import('../packages/record/dist/index.js');
    const end = Date.now() - 60_000;
    let now = end - 30 * DAY;
    const record = await openRecord({ path: join(home, '.deepbuild', 'ledger.db'), now: () => now });
    const conn = (session) => ({ writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' });
    let n = 0;
    for (let d = 0; d < 30; d++) {
      for (let s = 0; s < 20; s++) {
        const session = `6f1c2b9e-1111-4222-8333-${String(d * 20 + s).padStart(12, '0')}`;
        const pending = [];
        for (let k = 0; k < 150; k++) {
          now = end - (30 - d) * DAY + s * 600_000 + k * 1000;
          pending.push(record.append(conn(session), { v: 1, id: `01K${String(++n).padStart(23, '0')}`, kind: 'tool.before', ts: now, seq: `${BigInt(now) * 1_000_000n}`, data: { kind: 'shell', paths: [], command: `npm test -- src/${k}.test.ts` } }));
        }
        await Promise.all(pending);
      }
    }
    await record.close();
    const { hub, socket } = await start(home);
    const app = await asApp(home, socket);
    const t0 = performance.now();
    const events = await logEnd(app);
    const pagedMs = performance.now() - t0;
    app.close();
    await stop(hub);
    return { events, pagedMs };
  },
  // The hub left idle: after two seconds to settle, the CPU it uses over five more, and its resident memory.
  async idle(home) {
    const { hub } = await start(home);
    await sleep(2000);
    const ps = (field) => execFileSync('ps', ['-o', `${field}=`, '-p', String(hub.pid)], { encoding: 'utf8' }).trim();
    const cpu = () => ps('time').split(/[:.]/).map(Number).reduce((acc, part, i, all) => (i === all.length - 1 ? acc + part / 100 : acc * 60 + part), 0);
    const before = cpu();
    await sleep(5000);
    const idleCpuPercent = ((cpu() - before) / 5) * 100;
    const rssBytes = Number(ps('rss')) * 1024;
    await stop(hub);
    return { idleCpuPercent, rssBytes };
  },
};

const mode = process.argv[2];
if (!modes[mode]) throw Error(`Unknown mode ${mode}; one of: ${Object.keys(modes).join(', ')}`);
const home = realpathSync(mkdtempSync('/tmp/deep-hub-bench-'));
try {
  console.log(JSON.stringify({ bench: 'hub', mode, ...(await modes[mode](home)) }));
} finally {
  rmSync(home, { recursive: true, force: true });
}
