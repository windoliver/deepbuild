// AC18's scripted sessions and its load call, in a process of their own so the timings don't share an event
// loop with the test (or with the hub). node load-ac18.mjs <socket> <spec file>; spec:
//   { sessions: [{id, cwd, transcript}], intervalMs, warmHooks, warmTimeoutMs, minHooks, tailMs, hookTimeoutMs, loadTimeoutMs,
//     token: "<control token>", load: <test.load params>, out: "<file the result goes to>" }
// Each session first sends its SessionStart (untimed). Then the sessions send PreToolUse hooks on a fixed
// timetable, open loop: hook k is due intervalMs / sessions.length * k after the first, from session
// k % sessions.length, and starts when due whether or not earlier hooks have their replies, as separate
// deep-hook processes would. Each hook is one new connection, as deep-hook makes it: connect, read the hub's
// hello, write the request, read the ack and the reply. Once warmHooks hooks have their replies, the load call
// (test.load on a cli connection opened before the hooks started) is sent; the hooks keep coming until it has
// returned, tailMs more have passed and at least minHooks have started. Times are performance.now() in this
// process; wallOffset turns one into ms since the epoch (Date.now()). Writes one JSON object to `out`:
//   { wallOffset, starts: [ids], hooks: [{id, session, k, dueAt, connectAt, helloAt, writeAt, ackAt, replyAt,
//     end, endAt, error?}], warmAt, load: {sentAt, doneAt, reply} | null, stopAt }
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';

const [socket, specFile] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specFile, 'utf8'));
const wallOffset = Date.now() - performance.now();
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const base32 = (v, n) => { let s = ''; for (let i = 0; i < n; i++) { s = CROCKFORD[Number(v & 31n)] + s; v >>= 5n; } return s; };
const ulid = () => base32(BigInt(Date.now()), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
let counter = 0n;
const seq = () => { counter = (counter + 1n) % 1_000_000n; return (BigInt(Date.now()) * 1_000_000n + counter).toString(); };
const parse = (raw) => { try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };

function request(s, event, extra) {
  const payload = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default', ...extra };
  return { v: 1, agent: 'claude-code', event, seq: seq(), id: ulid(), pid: process.pid, ppid: process.ppid, matched: [], payload };
}

/** One hook on a new connection. r is filled in as it goes; resolves once it ends. */
function exchange(line, r, timeoutMs) {
  return new Promise((resolve) => {
    r.connectAt = performance.now();
    const sock = net.connect(socket);
    let buffer = '';
    let settled = false;
    const done = (end) => { if (settled) return; settled = true; r.end = end; r.endAt = performance.now(); clearTimeout(timer); sock.destroy(); resolve(r); };
    const timer = setTimeout(() => done('timeout'), timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (e) => done(`error:${e.code ?? e.message}`));
    sock.on('close', () => done('close'));
    sock.on('data', (chunk) => {
      const at = performance.now();
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (r.helloAt === null) {
          r.helloAt = at;
          r.writeAt = performance.now();
          sock.write(line);
          continue;
        }
        const json = parse(raw);
        if ('ack' in json && r.ackAt === null) r.ackAt = at;
        if ('error' in json) { r.error = json.error; done('error'); return; }
        if ('exit' in json) { r.replyAt = at; done('reply'); return; }
      }
    });
  });
}

/** A cli connection: hello, the token, the role line. Resolves with a function that makes one call on it. */
function controlConnection() {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buffer = '';
    let stage = 'hello';
    const waiting = new Map();
    sock.setEncoding('utf8');
    sock.on('error', (e) => reject(new Error(`control connection: ${e.code ?? e.message}`)));
    sock.on('close', () => { for (const w of waiting.values()) w({ closed: true }); waiting.clear(); });
    sock.on('data', (chunk) => {
      const at = performance.now();
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const json = parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (stage === 'hello') { stage = 'role'; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: spec.token })}\n`); continue; }
        if (stage === 'role') {
          stage = 'calls';
          if (json.role !== 'cli') { reject(new Error(`the hub refused the cli hello: ${JSON.stringify(json)}`)); return; }
          resolve((method, params) => new Promise((done) => {
            const id = `${method}#ac18`;
            waiting.set(id, (reply, at) => done({ at: at ?? performance.now(), reply }));
            sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
          }));
          continue;
        }
        const w = waiting.get(json.id);
        if (w && ('result' in json || 'error' in json)) { waiting.delete(json.id); w(json, at); }
      }
    });
  });
}

const sessions = spec.sessions;
const starts = [];
for (const s of sessions) {
  const r = { connectAt: null, helloAt: null, writeAt: null, ackAt: null, replyAt: null, end: 'timeout' };
  const start = request(s, 'SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
  starts.push(start.id);
  await exchange(`${JSON.stringify(start)}\n`, r, spec.hookTimeoutMs);
}
const call = await controlConnection();

const hooks = [];
const inFlight = new Set();
const step = spec.intervalMs / sessions.length;
let replies = 0;
let warmAt = null;
let load = null;
let loadDone = false;
let stopAt = null;
const t0 = performance.now();

function fire(k) {
  const s = sessions[k % sessions.length];
  const req = request(s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: `ls src/${k}` }, tool_use_id: `call_${randomUUID()}` });
  const r = { id: req.id, session: s.id, k, dueAt: t0 + k * step, connectAt: null, helloAt: null, writeAt: null, ackAt: null, replyAt: null, end: 'timeout' };
  hooks.push(r);
  const p = exchange(`${JSON.stringify(req)}\n`, r, spec.hookTimeoutMs).then(() => {
    inFlight.delete(p);
    if (r.end === 'reply' && ++replies === spec.warmHooks) startLoad();
  });
  inFlight.add(p);
}

function startLoad() {
  warmAt = performance.now();
  const sentAt = performance.now();
  const timer = setTimeout(() => { load = { sentAt, doneAt: performance.now(), reply: { timeout: spec.loadTimeoutMs } }; loadDone = true; }, spec.loadTimeoutMs);
  void call('test.load', spec.load).then(({ at, reply }) => {
    if (loadDone) return;
    clearTimeout(timer);
    load = { sentAt, doneAt: at, reply };
    loadDone = true;
  });
}

await new Promise((resolve) => {
  let k = 0;
  const tick = () => {
    const now = performance.now();
    while (t0 + k * step <= now) fire(k++);
    const done = loadDone && k >= spec.minHooks && now >= load.doneAt + spec.tailMs;
    // Hooks that never reach warmHooks replies never send the load: stop, and the test reads load null.
    if (done || (warmAt === null && now - t0 > spec.warmTimeoutMs)) { stopAt = now; resolve(); return; }
    setTimeout(tick, 1);
  };
  tick();
});
await Promise.all([...inFlight]);
writeFileSync(spec.out, JSON.stringify({ wallOffset, starts, hooks, warmAt, load, stopAt }));
process.exit(0);
