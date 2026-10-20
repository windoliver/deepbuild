// Shared by the #56 acceptance tests: the spike's hub, its socket protocol, the check fixture's
// record, the process table, free ports, a seeded random source and the spike's results record.
// The slice is reached only through `node spikes/hub-core/hub.mjs --variant <plain|effect>` and
// its socket, so one test drives both builds. See README.md for the surface.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, statSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const SPIKE = 'spikes/hub-core';
export const RESULTS = `${SPIKE}/results.json`;
export const VARIANTS = ['plain', 'effect'];
export const BASE = 'dcfd7b86f55373c14181f5da827fb2aee6f663b0'; // has no spike, no hub, no Effect

// The issue's numbers.
export const HOLD_MS = 2000; // hooks held with a 2-second timeout
export const SESSIONS = 50; // 50 sessions holding hooks
export const RETRIES = 3; // flaky checks retried three times
export const ATTEMPTS = 1 + RETRIES;
export const POOL = 10; // leases from a pool of 10 ports
export const RANDOMIZED_RUNS = 1000; // no lease leaks across 1,000 randomized runs
export const VIRTUAL_RUNS = 20; // pass 20 of 20 runs
export const FIX_ROUNDS = 2; // within two rounds of fixes
export const REVIEW_RATIO = 1.5; // at most 1.5 times as long as for the plain version
export const WITHIN = 0.1; // within 10% of plain TypeScript on latency and memory

export const CHECK = fileURLToPath(new URL('./fixtures/check.mjs', import.meta.url));
export const EXTENSION = fileURLToPath(new URL('./fixtures/extension.mjs', import.meta.url));

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
export const hex = (bytes = 4) => randomBytes(bytes).toString('hex');

// A short scratch folder: the hub's socket lives inside it, and a Unix socket path must stay
// under 104 bytes on macOS.
export function scratch(t, prefix = 'ds56-') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

export async function waitFor(predicate, withinMs, what) {
  const until = Date.now() + withinMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= until) assert.fail(`timed out after ${withinMs} ms waiting for ${what}`);
    await sleep(25);
  }
}

export async function within(promise, ms, what) {
  let timer;
  const late = new Promise((_, fail) => { timer = setTimeout(() => fail(Error(`timed out after ${ms} ms waiting for ${what}`)), ms); });
  try { return await Promise.race([promise, late]); } finally { clearTimeout(timer); }
}

// ------------------------------------------------------------------ ports

const bindable = (port) => new Promise((done) => {
  const server = createServer();
  server.once('error', () => done(false));
  server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
});

// `count` consecutive ports that are free on 127.0.0.1 right now.
export async function freePorts(count = POOL) {
  for (let tries = 0; tries < 200; tries++) {
    const first = 20_000 + Math.floor(Math.random() * 40_000);
    const ports = Array.from({ length: count }, (_, index) => first + index);
    let ok = true;
    for (const port of ports) if (!(await bindable(port))) { ok = false; break; }
    if (ok) return ports;
  }
  assert.fail(`BLOCKED: found no ${count} consecutive free ports`);
}

// Ports something still listens on.
export async function busyPorts(ports) {
  const busy = [];
  for (const port of ports) if (!(await bindable(port))) busy.push(port);
  return busy;
}

// ------------------------------------------------------------------ processes

// Every live process whose command line carries `marker`. A zombie doesn't count. Only processes
// this test started carry its random marker, so a match is never someone else's process.
export function living(marker) {
  const result = spawnSync('ps', ['-axww', '-o', 'pid=,stat=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, `ps failed: ${result.stderr}`);
  return result.stdout.split('\n').map((line) => line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/)).filter(Boolean)
    .filter(([, , stat, command]) => !stat.startsWith('Z') && command.includes(marker)).map(([, pid]) => Number(pid));
}

export async function waitGone(marker, withinMs) {
  const until = Date.now() + withinMs;
  let left = living(marker);
  while (left.length && Date.now() < until) {
    await sleep(50);
    left = living(marker);
  }
  return left;
}

function stop(pid, marker) {
  const line = spawnSync('ps', ['-ww', '-o', 'stat=,command=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
  if (line && !line.startsWith('Z') && line.includes(marker)) try { process.kill(pid, 'SIGKILL'); } catch {}
}

// ------------------------------------------------------------------ the check fixture

// One scratch folder per test with the check fixture's record and the extension's record.
// `check(session, script, grandchildren)` returns a hold's check argv, with a marker unique to
// that hold; the record readers group lines by hold.
export function fixture(t) {
  const directory = scratch(t);
  const log = join(directory, 'checks.jsonl');
  const extensionLog = join(directory, 'extension.jsonl');
  const run = `ds56m.${hex()}.`;
  const read = (path) => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  // The check record grows to thousands of lines in the randomized runs, so it's read
  // incrementally: only whole lines past what was already read.
  const seen = [];
  let offset = 0, rest = '';
  const events = () => {
    if (!existsSync(log)) return seen;
    const size = statSync(log).size;
    if (size > offset) {
      const buffer = Buffer.alloc(size - offset);
      const descriptor = openSync(log, 'r');
      try { readSync(descriptor, buffer, 0, buffer.length, offset); } finally { closeSync(descriptor); }
      offset = size;
      const lines = (rest + buffer.toString('utf8')).split('\n');
      rest = lines.pop();
      for (const line of lines) if (line.trim()) seen.push(JSON.parse(line));
    }
    return seen;
  };
  let count = 0;
  const check = (session, script = ['pass'], grandchildren = 0) => {
    const key = `h${++count}-${session}`;
    const marker = `${run}${key}.`;
    const config = { log, key, counter: join(directory, `${key}.attempts`), script, grandchildren };
    return { key, marker, session, script, argv: [process.execPath, CHECK, marker, JSON.stringify(config)] };
  };
  // Whatever happened, nothing this test's checks started outlives it: stop each recorded PID
  // that still carries the test's marker.
  t.after(() => {
    for (const { pid, event } of events()) if (['start', 'grandchild'].includes(event)) stop(pid, run);
  });
  return {
    directory, log, extensionLog, run, check, events,
    of: (key, event) => events().filter((line) => line.key === key && (!event || line.event === event)),
    starts: (key) => events().filter((line) => line.key === key && line.event === 'start').length,
    bound: (key, attempt) => events().some((line) => line.key === key && line.event === 'bound' && (!attempt || line.attempt === attempt)),
    grandchildren: (key, attempt) => events().filter((line) => line.key === key && line.event === 'grandchild' && (!attempt || line.attempt === attempt)),
    problems: () => events().filter((line) => ['conflict', 'noport'].includes(line.event)),
    extension: () => read(extensionLog),
  };
}

// ------------------------------------------------------------------ the hub and its socket

function lineReader(socket, onObject) {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      let object;
      try { object = JSON.parse(line); } catch { continue; }
      if (object && typeof object === 'object') onObject(object);
    }
  });
}

// Starts the variant's hub and waits for its ready line. Stops it by PID when the test ends.
export async function startHub(t, { variant, state, ports, extensionLog, extension = true, virtual = false }) {
  const args = [`${SPIKE}/hub.mjs`, '--variant', variant, '--state', state, '--ports', `${ports[0]}-${ports.at(-1)}`];
  if (extension) args.push('--extension', EXTENSION);
  if (virtual) args.push('--clock', 'virtual');
  const env = { ...process.env };
  if (extensionLog) env.DEEP_SPIKE_EXTENSION_LOG = extensionLog;
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((done) => child.once('exit', (code, signal) => done({ code, signal })));
  const ready = new Promise((done, fail) => {
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
      for (const line of stdout.split('\n')) {
        try { const object = JSON.parse(line); if (object?.ready === true) done(object); } catch {}
      }
    });
    exited.then(({ code, signal }) => fail(Error(`exited ${code ?? signal} before its ready line`)));
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) try { process.kill(child.pid, 'SIGKILL'); } catch {} });
  let line;
  try {
    line = await within(ready, 20_000, 'the ready line');
  } catch (error) {
    assert.fail(`BLOCKED: the ${variant} hub didn't start (${error.message}): node ${args.join(' ')}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  const socket = join(state, 'hub.sock');
  assert.equal(line.variant, variant, `the ready line names the variant that runs: ${JSON.stringify(line)}`);
  assert.equal(line.pid, child.pid, `the ready line names the hub's PID: ${JSON.stringify(line)}`);
  assert.equal(realpathSync(line.socket), realpathSync(socket), `the hub listens on <state>/hub.sock: ${JSON.stringify(line)}`);
  return { child, pid: child.pid, socket, exited, stderr: () => stderr, stdout: () => stdout };
}

// One request on its own connection; resolves with the first JSON line back.
export function request(socketPath, body, timeoutMs = 5000) {
  return new Promise((done, fail) => {
    const socket = createConnection(socketPath);
    const timer = setTimeout(() => { socket.destroy(); fail(Error(`no reply to ${JSON.stringify(body)} within ${timeoutMs} ms`)); }, timeoutMs);
    let answered = false;
    lineReader(socket, (object) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      socket.end();
      done(object);
    });
    socket.on('error', (error) => { clearTimeout(timer); if (!answered) fail(error); });
    socket.on('close', () => { clearTimeout(timer); if (!answered) fail(Error(`connection closed with no reply to ${JSON.stringify(body)}`)); });
    socket.write(`${JSON.stringify(body)}\n`);
  });
}

// A held hook: one connection that sends the hold and reads the acknowledgement, then the reply.
// `ack` and `reply` never reject: a connection that closes first resolves them with `{ closed }`.
export function hold(socketPath, { id, session, argv }) {
  const handle = { id, session, sentAt: performance.now(), sentEpoch: Date.now(), ackAt: undefined, replyAt: undefined, replied: undefined };
  let settleAck, settleReply;
  handle.ack = new Promise((done) => { settleAck = done; });
  handle.reply = new Promise((done) => { settleReply = done; });
  const socket = createConnection(socketPath);
  lineReader(socket, (object) => {
    if ('ack' in object && handle.ackAt === undefined) {
      handle.ackAt = performance.now();
      settleAck(object);
    } else if ('outcome' in object && handle.replyAt === undefined) {
      handle.replyAt = performance.now();
      handle.replied = object;
      settleReply(object);
      socket.end();
    }
  });
  const closed = (error) => {
    settleAck({ closed: true, error: error?.message });
    if (handle.replyAt === undefined) {
      handle.replyAt = performance.now();
      handle.replied = { closed: true, error: error?.message };
      settleReply(handle.replied);
    }
  };
  socket.on('error', closed);
  socket.on('close', () => closed());
  socket.write(`${JSON.stringify({ op: 'hold', id, session, check: { argv } })}\n`);
  return handle;
}

export const holdCheck = (socketPath, check) => ({ ...check, handle: hold(socketPath, { id: check.key, session: check.session, argv: check.argv }) });

// A test's whole setup: scratch state, a pool of 10 free ports, the fixtures and the hub.
export async function setup(t, variant, { extension = true, virtual = false, extraPorts = 0 } = {}) {
  const fx = fixture(t);
  const state = join(fx.directory, 's');
  const all = await freePorts(POOL + extraPorts);
  const ports = all.slice(0, POOL);
  const hub = await startHub(t, { variant, state, ports, extensionLog: fx.extensionLog, extension, virtual });
  return { fx, state, ports, extra: all.slice(POOL), hub };
}

export async function leases(socketPath) {
  const reply = await request(socketPath, { op: 'leases' });
  assert.ok(Array.isArray(reply.pool) && Array.isArray(reply.held), `leases replies with { pool, held }: ${JSON.stringify(reply)}`);
  return reply;
}

export async function assertNoLeases(socketPath, ports, withinMs = 3000) {
  let reply;
  const until = Date.now() + withinMs;
  do {
    reply = await leases(socketPath);
    if (!reply.held.length) break;
    await sleep(50);
  } while (Date.now() < until);
  assert.deepEqual([...reply.pool].sort((a, b) => a - b), ports, `the pool is the 10 ports the hub was given: ${JSON.stringify(reply)}`);
  assert.deepEqual(reply.held, [], `every lease is back in the pool: ${JSON.stringify(reply.held)}`);
}

// ------------------------------------------------------------------ randomness

// mulberry32: a small seeded generator, so a failing randomized run can be replayed.
export function random(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (low, high) => low + Math.floor(next() * (high - low + 1)), pick: (items) => items[Math.floor(next() * items.length)] };
}

export function seedFromEnv() {
  const given = process.env.DEEP_SPIKE_SEED;
  return given !== undefined && given !== '' ? Number(given) >>> 0 : randomBytes(4).readUInt32BE(0);
}

// ------------------------------------------------------------------ the record

export function results() {
  const path = join(root, RESULTS);
  assert.ok(existsSync(path), `BLOCKED: the spike's record ${RESULTS} doesn't exist`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Runs one of the spike's commands with node from the repo root.
export function spike(script, args = [], { timeout = 180_000 } = {}) {
  const result = spawnSync(process.execPath, [`${SPIKE}/${script}`, ...args], { cwd: root, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  const objects = (result.stdout ?? '').split('\n').map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter((value) => value && typeof value === 'object');
  return { ...result, objects };
}

export const show = (result) => `exit ${result.status ?? result.signal}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
