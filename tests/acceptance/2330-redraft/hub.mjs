import assert from 'node:assert/strict';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const now = () => Number(process.hrtime.bigint()) / 1e6;
const record = (kind, extra = {}) => appendFileSync(join(process.env.ACC2330_EVENTS, `${process.pid}.jsonl`),
  JSON.stringify({ kind, at: now(), pid: process.pid, ...extra }) + '\n');

export async function runHub() {
  const root = process.argv[process.argv.indexOf('--root') + 1];
  assert(root && root !== '--root', 'INVALID: stand-in needs --root');
  mkdirSync(root, { recursive: true });
  const token = randomBytes(24).toString('hex');
  writeFileSync(join(root, 'control.token'), token, { mode: 0o600 });
  const mode = process.env.ACC2330_MODE;
  const start = Number(process.env.ACC2330_START);
  assert(Number.isFinite(start) && start > 0, 'INVALID: missing real hub spawn timestamp');
  record('boot', { start, mode });
  process.on('SIGINT', () => process.exit(0)); // owned cleanup reports normal exit, including descendant counters
  // Owner disappearance is cleanup, not a fixture lifetime/deadline.
  setInterval(() => {
    try { process.kill(Number(process.env.ACC2330_OWNER), 0); } catch { process.exit(99); }
  }, 1000).unref();
  if (mode === 'never') { await new Promise(() => { setInterval(() => {}, 60_000); }); }
  const sockets = new Set();
  const send = (socket, value) => socket.write(JSON.stringify({ v: 1, ...value }) + '\n');
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    send(socket, { hello: 'deep-hub', start: 'acceptance', contract: '1.0', features: [], generation: 1, hub: 'acceptance' });
    let buffer = '', authenticated = false;
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffer += chunk;
      for (let i; (i = buffer.indexOf('\n')) >= 0;) {
        const message = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
        if (message.hello === 'cli') {
          assert.equal(message.token, token, 'INVALID: control token mismatch');
          authenticated = true;
          send(socket, { hello: 'ok' });
        } else {
          assert(authenticated && message.method === 'hub.stop', 'INVALID: unexpected peer request');
          record('stop-request');
          send(socket, { id: message.id, result: { stopping: true } });
          // Ack and even control EOF are not enough: keep accepting during shutdown.
          if (mode === 'early-close' || mode === 'stubborn') socket.end();
          if (mode === 'stubborn') continue; // Still answers after the CLI's entire stop limit.
          const due = now() + (mode === 'early-close' ? 200 : 30);
          const leave = () => {
            if (now() < due) return setTimeout(leave, Math.max(1, due - now()));
            record('going-away');
            for (const s of sockets) s.destroy();
            server.close(() => process.exit(0));
          };
          setTimeout(leave, due - now());
        }
      }
    });
  });
  // Real spawn is t=0, not the poller's first failed attempt or first successful hello.
  const due = start + 30;
  const listen = () => {
    if (now() < due) return setTimeout(listen, Math.max(1, due - now()));
    const begin = now();
    server.listen(join(root, 'hub.sock'), () => {
      record('listening', { start, begin });
      // An independent client establishes a complete first answer even if the CLI sleeps for 100 ms.
      const witness = net.connect(join(root, 'hub.sock'));
      witness.setEncoding('utf8');
      let buffer = '';
      witness.on('error', error => { throw error; });
      witness.on('data', chunk => {
        buffer += chunk;
        if (!buffer.includes('\n')) return;
        assert.equal(JSON.parse(buffer.slice(0, buffer.indexOf('\n'))).hello, 'deep-hub');
        record('witness'); witness.removeAllListeners('data'); witness.destroy();
      });
    });
  };
  listen();
  await new Promise(() => {});
}
