// #2330: lifecycle notifications must complete the public command without advancing a retry timer.
// Real Unix sockets on a frozen clock separate this regression from a loaded machine's timing budgets.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../../../tests/acceptance/2330/build.mjs';

const realTimeout = globalThis.setTimeout;
const realClear = globalThis.clearTimeout;
let dir, hubCommand;
before(async () => {
  dir = mkdtempSync('/tmp/hub-events-');
  build(join(dir, 'build'));
  const entry = createRequire(join(dir, 'build/package.json')).resolve('@deepbuild/hub/hub');
  ({ hubCommand } = await import(pathToFileURL(entry).href));
});
after(() => rmSync(dir, { recursive: true, force: true }));

async function observed(work) {
  let timer;
  try {
    return await Promise.race([work.then((code) => ({ code })), new Promise((done) => {
      timer = realTimeout(() => done(undefined), 5000);
    })]);
  } finally { realClear(timer); }
}
function fixture(t) {
  const root = mkdtempSync(join(dir, 'root-'));
  writeFileSync(join(root, 'control.token'), 'lifecycle-events-only\n');
  const sockets = new Set();
  let stopped;
  const requested = new Promise((done) => { stopped = done; });
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    const send = (o) => socket.write(`${JSON.stringify({ v: 1, ...o })}\n`);
    send({ hello: 'deep-hub' });
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (let i; (i = buffer.indexOf('\n')) >= 0;) {
        const message = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (message.hello === 'cli') send({ hello: 'cli' });
        else if (message.method === 'hub.stop') {
          send({ id: message.id, result: { stopping: true } });
          stopped();
        }
      }
    });
  });
  const close = () => {
    if (server.listening) server.close();
    for (const socket of sockets) socket.destroy();
  };
  let work;
  t.after(async () => {
    close();
    t.mock.timers.tick(16_000); // settle a wrong program's outstanding wait before restoring the clock
    if (work) await work;
    t.mock.timers.reset();
  });
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  return {
    root, requested, close,
    listen: () => new Promise((done, reject) => server.listen(join(root, 'hub.sock'), done).once('error', reject)),
    command: (verb, cli = '') => (work = hubCommand([verb, '--root', root], cli)),
  };
}

// A real peer round-trip lets already queued socket callbacks run; the lifecycle clock stays frozen.
async function roundTrip(root) {
  await new Promise((done, reject) => {
    const socket = net.connect(join(root, 'hub.sock'));
    socket.once('error', reject);
    socket.once('data', () => { socket.destroy(); done(); });
  });
}

test('start observes socket creation without a clock step after the hub becomes ready', { timeout: 20_000 }, async (t) => {
  const hub = fixture(t);
  const marker = join(hub.root, 'launched');
  const cli = join(hub.root, 'stand-in.mjs');
  // The real start command spawns this short-lived stand-in; the test owns its socket server.
  writeFileSync(cli, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, String(process.pid));\n`);
  let watcher;
  const launched = new Promise((done) => {
    watcher = watch(hub.root, () => { if (existsSync(marker)) { watcher.close(); done(); } });
  });
  t.after(() => watcher.close());
  const work = hub.command('start', cli);
  await launched;
  assert.ok(Number(readFileSync(marker, 'utf8')) > 0, 'start launched its stand-in hub');
  await new Promise((done) => realTimeout(done, 25));
  await hub.listen();
  assert.deepEqual(await observed(work), { code: 0 }, 'socket readiness must wake start without advancing its polling timer');
  assert.equal(Date.now(), 0, 'no retry-clock step was supplied');
});

test('stop observes peer closure and a quiet socket without a clock step', { timeout: 20_000 }, async (t) => {
  const hub = fixture(t);
  await hub.listen();
  let returned = false;
  const work = hub.command('stop').then((code) => { returned = true; return code; });
  await hub.requested;
  await roundTrip(hub.root);
  await roundTrip(hub.root);
  assert.equal(returned, false, 'the stop acknowledgement is not proof that the hub stopped');
  hub.close();
  assert.deepEqual(await observed(work), { code: 0 }, 'peer closure must wake stop without advancing its polling timer');
  assert.equal(Date.now(), 0, 'no retry-clock step was supplied');
});

test('stop refuses success at its deadline while the hub keeps answering', { timeout: 20_000 }, async (t) => {
  const hub = fixture(t);
  await hub.listen();
  const work = hub.command('stop');
  await hub.requested;
  await roundTrip(hub.root);
  await roundTrip(hub.root);
  t.mock.timers.tick(15_000);
  assert.deepEqual(await observed(work), { code: 3 }, 'the 15 s limit must not turn a still-answering hub into success');
  await roundTrip(hub.root);
  assert.equal(Date.now(), 15_000, 'stop stayed bounded by its original deadline');
});
