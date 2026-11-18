// #2330: verification-handshake failures are not proof of shutdown.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../../../tests/acceptance/2330/build.mjs';

const realTimer = setTimeout, realClear = clearTimeout;
let dir, hubCommand;
before(async () => {
  dir = mkdtempSync('/tmp/hub-races-');
  build(join(dir, 'build'));
  ({ hubCommand } = await import(pathToFileURL(createRequire(join(dir, 'build/package.json')).resolve('@deepbuild/hub/hub')).href));
});
after(() => rmSync(dir, { recursive: true, force: true }));
async function within(work) {
  let timer;
  try { return await Promise.race([work, new Promise((done) => { timer = realTimer(() => done('pending'), 2000); })]); }
  finally { realClear(timer); }
}
function peer(t, verification) {
  const root = mkdtempSync(join(dir, 'r-')), sockets = new Set();
  writeFileSync(join(root, 'control.token'), 'races-only\n');
  let count = 0, reached;
  const probed = new Promise((done) => { reached = done; });
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    if (++count > 1) {
      verification(socket, server);
      reached();
      return;
    }
    socket.write('{"hello":"deep-hub"}\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (let i; (i = buffer.indexOf('\n')) >= 0;) {
        const message = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
        if (message.hello) socket.write('{"role":"cli"}\n');
        else {
          assert.equal(message.method, 'hub.stop');
          socket.end(`${JSON.stringify({ id: message.id, result: { stopping: true } })}\n`);
        }
      }
    });
  });
  let work;
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  t.after(async () => {
    server.close();
    for (const socket of sockets) socket.destroy();
    t.mock.timers.tick(16_000);
    if (work) await within(work);
    t.mock.timers.reset();
  });
  return {
    root, probed,
    async start() {
      await new Promise((done, reject) => server.listen(join(root, 'hub.sock'), done).once('error', reject));
      work = hubCommand(['stop', '--root', root], '');
      return { work };
    },
  };
}

test('a silent shutdown-verification connection cannot turn the 15 s deadline into success', async (t) => {
  const hub = peer(t, () => {});
  const { work } = await hub.start();
  assert.equal(await within(hub.probed), undefined, 'verification connected to the still-running peer');
  t.mock.timers.tick(15_000);
  assert.equal(await within(work), 3, 'timeout is a failure, not a stopped hub');
});

test('EOF during verification is rechecked without waiting for the hello timeout', async (t) => {
  const hub = peer(t, (socket, server) => { server.close(); socket.end('{"hello":'); });
  const { work } = await hub.start();
  assert.equal(await within(hub.probed), undefined, 'verification socket accepted before the peer shut down');
  assert.equal(await within(work), 0, 'EOF and a refused reconnect settle stop without a clock step');
  assert.equal(Date.now(), 0, 'the 2 s hello timer never advanced');
});
