// The hold bench (#56), run by the preflight's perf lane for each variant: start the variant's hub,
// hold one hook in each of 50 sessions at once on a check that passes at once, and time each hold
// from request to reply. A first round of 50 warms the hub and isn't timed. Prints the hold
// latency, the hub's own peak memory and the handles it holds after the holds beyond those before.
import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SESSIONS = 50, POOL = 10;
const at = process.argv.indexOf('--variant');
const variant = process.argv[at + 1];
if (at < 0 || !['plain', 'effect'].includes(variant)) {
  console.error('usage: node spikes/hub-core/bench.mjs --variant <plain|effect>');
  process.exit(2);
}

const bindable = (port) => new Promise((done) => {
  const server = createServer();
  server.once('error', () => done(false));
  server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
});
async function freePorts() {
  for (let tries = 0; tries < 200; tries++) {
    const first = 20_000 + Math.floor(Math.random() * 40_000);
    const ports = Array.from({ length: POOL }, (_, index) => first + index);
    if ((await Promise.all(ports.map(bindable))).every(Boolean)) return ports;
  }
  throw Error(`no ${POOL} consecutive free ports`);
}

// One request per connection; `lines` resolves with the first `count` JSON lines back.
function exchange(socket, body, count) {
  return new Promise((done, fail) => {
    const connection = createConnection(socket);
    const lines = [];
    let buffer = '';
    connection.setEncoding('utf8');
    connection.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        lines.push(JSON.parse(buffer.slice(0, end)));
        buffer = buffer.slice(end + 1);
        if (lines.length === count) { connection.end(); done(lines); }
      }
    });
    connection.on('error', fail);
    connection.on('close', () => { if (lines.length < count) fail(Error(`connection closed after ${lines.length} of ${count} lines to ${JSON.stringify(body)}`)); });
    connection.write(`${JSON.stringify(body)}\n`);
  });
}
const request = async (socket, body) => (await exchange(socket, body, 1))[0];

async function round(socket, name) {
  return Promise.all(Array.from({ length: SESSIONS }, async (_, index) => {
    const started = performance.now();
    const [, reply] = await exchange(socket, { op: 'hold', id: `${name}-${index}`, session: `s${index}`, check: { argv: ['/usr/bin/true'] } }, 2);
    if (reply.outcome !== 'pass') throw Error(`hold ${name}-${index} came back ${JSON.stringify(reply)}`);
    return performance.now() - started;
  }));
}

const state = realpathSync(mkdtempSync(join(tmpdir(), 'ds56b-')));
const ports = await freePorts();
const hub = spawn(process.execPath, [fileURLToPath(new URL('hub.mjs', import.meta.url)), '--variant', variant, '--state', state, '--ports', `${ports[0]}-${ports.at(-1)}`], { stdio: ['ignore', 'pipe', 'inherit'] });
try {
  const ready = await new Promise((done, fail) => {
    let out = '';
    hub.stdout.setEncoding('utf8').on('data', (chunk) => {
      out += chunk;
      for (const line of out.split('\n')) try { const object = JSON.parse(line); if (object.ready) done(object); } catch {}
    });
    hub.once('exit', (code, signal) => fail(Error(`the ${variant} hub exited ${code ?? signal} before its ready line`)));
  });
  await round(ready.socket, 'warm');
  const before = await request(ready.socket, { op: 'stats' });
  const times = (await round(ready.socket, 'timed')).sort((a, b) => a - b);
  for (let tries = 0; (await request(ready.socket, { op: 'leases' })).held.length; tries++) {
    if (tries > 100) throw Error('leases still held a second after every hold ended');
    await new Promise((done) => setTimeout(done, 10));
  }
  const after = await request(ready.socket, { op: 'stats' });
  const pick = (q) => Math.round(times[Math.min(times.length - 1, Math.ceil(q * times.length) - 1)] * 100) / 100;
  console.log(JSON.stringify({ bench: 'hold', variant, holds: SESSIONS, holdP50Ms: pick(0.5), holdP95Ms: pick(0.95), hubPeakBytes: after.maxRssBytes, leakedHandles: Math.max(0, after.handles - before.handles) }));
} finally {
  if (hub.exitCode === null && hub.signalCode === null) {
    const exited = new Promise((done) => hub.once('exit', done));
    hub.kill('SIGTERM');
    const timer = setTimeout(() => hub.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
  }
  rmSync(state, { recursive: true, force: true });
}
