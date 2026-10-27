// Claude Code's adapter, for the perf lane's budgets (issue #18): node benchmarks/claude-code.mjs <mode>.
// map: the corpus's recorded payloads of the newest version the facts cover, each mapped to its events by the hub's
// parser as it maps a hook request off the socket (held to hook.request@3, the adapter's mapping, the scrub), timed
// one at a time after a warm-up. backfill: 100 sessions'
// transcripts spread over 30 days, each 2,000 lines of a recorded transcript, backfilled through `deep hub run` on a
// temp home (test.load, served under the test VFS), then counted through events.read. Each prints its readings as
// one JSON line last, and stops the hub it started by PID.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shipped } from '../packages/adapters/dist/index.js';
import { parseLine } from '../packages/hub/dist/hookmap.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const DAY = 86_400_000;
const SESSIONS = 100;
const DAYS = 30;
const LINES = 2000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const registry = shipped();
const version = Object.keys(registry.get('claude').facts.events.versions).at(-1);
const corpus = join(REPO, 'adapters/corpus/claude-code', version);
const p95 = (samples) => samples.sort((a, b) => a - b)[Math.floor(samples.length * 0.95)];

/** A connection as the app, with the hub's control token: `call` resolves with the reply's result, or throws its error. */
function asApp(home, socket) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    const waiting = new Map();
    let buffer = '';
    let n = 0;
    const app = {
      call: (method, params) => new Promise((done, fail) => {
        const id = `b${++n}`;
        waiting.set(id, (line) => (line.error ? fail(Error(`${method}: ${JSON.stringify(line.error)}`)) : done(line.result)));
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
        else if (waiting.has(line.id)) { waiting.get(line.id)(line); waiting.delete(line.id); }
      }
    });
  });
}
/** The hub on `home` under the test VFS, which serves test.load: resolves once its socket answers as the app. */
async function start(home) {
  const socket = join(home, '.deepbuild', 'hub.sock');
  const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env: { ...process.env, HOME: home, DEEP_HUB_TEST_VFS: '{}' }, stdio: 'ignore' });
  const t0 = performance.now();
  for (;;) {
    try {
      return { hub, app: await asApp(home, socket) };
    } catch {
      if (performance.now() - t0 > 30_000) {
        hub.kill('SIGTERM');
        throw Error('the hub did not answer within 30 s');
      }
      await sleep(5);
    }
  }
}
/** The events from log position `after` to the log's end, counted through events.read. */
async function count(app, after) {
  let n = 0;
  for (;;) {
    const { events, log_pos } = await app.call('events.read', { after, limit: 10_000 });
    if (!events.length) return { n, end: after };
    n += events.length;
    after = log_pos;
  }
}

const modes = {
  // Every recorded payload, cycled until 1,000 are timed, each a request line as deep-hook sends it, through the parser.
  async map() {
    const payloads = readdirSync(corpus).flatMap((scenario) => readFileSync(join(corpus, scenario, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line).payload));
    const request = (payload, i) => ({ v: 1, agent: 'claude-code', event: payload.hook_event_name, seq: `${1_760_013_451_000_000_000n + BigInt(i)}`, id: `01K74FKZVK8Q2X5R7M${String(i).padStart(8, '0')}`, pid: process.pid, ppid: process.ppid, matched: [], payload });
    const parse = (line) => parseLine(Buffer.from(JSON.stringify(line)), true, []);
    for (let i = 0; i < payloads.length * 3; i++) parse(request(payloads[i % payloads.length], i));
    const samples = [];
    const byHook = {};
    for (let i = 0; i < Math.ceil(1000 / payloads.length) * payloads.length; i++) {
      const line = request(payloads[i % payloads.length], i);
      const t0 = performance.now();
      const parsed = parse(line);
      samples.push(performance.now() - t0);
      byHook[line.event] = (byHook[line.event] ?? 0) + (parsed.kind === 'hook' ? parsed.drafts.length : 0);
    }
    return { p95Ms: p95(samples), hooks: samples.length, byHook };
  },
  // 100 sessions, one a day's slot over 30 calendar days, each the recorded tools transcript repeated to 2,000 lines.
  async backfill(home) {
    const recorded = readFileSync(join(corpus, 'tools', 'transcript.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const first = Math.floor((Date.now() - DAYS * DAY) / DAY) * DAY;
    const folder = join(home, '.claude', 'projects', 'work');
    mkdirSync(folder, { recursive: true });
    const sessions = [];
    const days = new Set();
    let lines = 0;
    for (let s = 0; s < SESSIONS; s++) {
      const session = `6f1c2b9e-1111-4222-8333-${String(s).padStart(12, '0')}`;
      const at = first + Math.floor((s * DAYS) / SESSIONS) * DAY + (1 + (s % 4)) * 3_600_000;
      const out = [];
      for (let k = 0; k < LINES; k++) {
        const entry = recorded[k % recorded.length];
        const round = Math.floor(k / recorded.length);
        const timestamp = new Date(at + k * 1000).toISOString();
        days.add(timestamp.slice(0, 10));
        out.push(JSON.stringify({ ...entry, uuid: `${round}-${entry.uuid}`, ...(entry.promptId ? { promptId: `${round}-${entry.promptId}` } : {}), ...(entry.session_id ? { session_id: session } : {}), timestamp }));
      }
      const transcript = join(folder, `${session}.jsonl`);
      writeFileSync(transcript, `${out.join('\n')}\n`);
      lines += out.length;
      sessions.push({ session, transcript });
    }
    const { hub, app } = await start(home);
    try {
      const { end } = await count(app, 0);
      const t0 = performance.now();
      for (const { session, transcript } of sessions) await app.call('test.load', { backfill: { session, agent: 'claude-code', transcript } });
      const elapsedMs = performance.now() - t0;
      return { elapsedMs, sessions: sessions.length, days: days.size, lines, events: (await count(app, end)).n };
    } finally {
      app.close();
      const exited = new Promise((resolve) => hub.on('exit', resolve));
      hub.kill('SIGTERM');
      await exited;
    }
  },
};

const mode = process.argv[2];
if (!modes[mode]) throw Error(`Unknown mode ${mode}; one of: ${Object.keys(modes).join(', ')}`);
const home = realpathSync(mkdtempSync('/tmp/deep-claude-bench-'));
try {
  console.log(JSON.stringify({ bench: 'claude-code', mode, ...(await modes[mode](home)) }));
} finally {
  rmSync(home, { recursive: true, force: true });
}
