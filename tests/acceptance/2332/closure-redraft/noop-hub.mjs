// A hub that does nothing: `node noop-hub.mjs hub run` prints the ready line at once and answers every hook
// with an acknowledgement and an empty reply, recording nothing. It retires almost no instructions, so a
// check that only counted them would pass it; the acceptance checks must not.
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';

const dir = join(process.env.HOME, '.deepbuild');
mkdirSync(dir, { recursive: true });
const socket = join(dir, 'hub.sock');
net.createServer((sock) => {
  let buffer = '';
  sock.setEncoding('utf8');
  sock.write(`${JSON.stringify({ hello: 'deep-hub' })}\n`);
  sock.on('error', () => undefined);
  sock.on('data', (chunk) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const request = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (request.id) {
        sock.write(`${JSON.stringify({ v: 1, ack: request.id, hold_until_ms: null })}\n`);
        sock.write(`${JSON.stringify({ v: 1, exit: 0, stdout: '', stderr: '' })}\n`);
      }
    }
  });
}).listen(socket, () => process.stdout.write(`${JSON.stringify({ v: 1, ready: true, pid: process.pid, socket, start: 0 })}\n`));
