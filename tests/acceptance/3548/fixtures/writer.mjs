// The planted writer of #3548's suite (README: The planted writer): what makes a hub write lines to its log.
//
// A test loads it into the hub's process with NODE_OPTIONS=--import=<this file> in the environment it starts the hub
// from, as tests/acceptance/16 loads its preload. It acts only in the main thread of the process whose arguments are
// `hub run` (the hub itself, as `deep hub start` and the login service start it) and only with $DEEP_3548_CTL set, so
// `deep hub start`, the launcher and every other child that inherits the variable load it and do nothing.
//
// There it listens on $DEEP_3548_CTL/w-<pid>.sock, a socket of the test's own beside none of the hub's. A request is
// one JSON line, {"tag", "from", "bytes"}: it writes planted lines (lines.mjs) numbered from `from` until `bytes` bytes
// are written, each line one process.stderr.write of its own, as the hub writes its own lines, a few hundred lines a
// turn of the event loop so the hub goes on serving what it serves. It answers with one JSON line, {"pid", "from",
// "to", "bytes", "lines"}, once the last write was taken. It reads no file, writes none, and changes nothing of the hub's.
import { once } from 'node:events';
import { rmSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { isMainThread } from 'node:worker_threads';
import { fillAt, lineOf } from './lines.mjs';

const ctl = process.env.DEEP_3548_CTL;
if (ctl && isMainThread && process.argv[2] === 'hub' && process.argv[3] === 'run') {
  const turn = () => new Promise((next) => setImmediate(next));
  const burst = async ({ tag, from, bytes }) => {
    let number = from;
    let written = 0;
    while (written < bytes) {
      for (let i = 0; i < 256 && written < bytes; i++, number++) {
        const line = `${lineOf(tag, number, fillAt(number))}\n`;
        written += line.length;
        // A standard error that is a pipe takes what it can and says when it has room again.
        if (!process.stderr.write(line)) await once(process.stderr, 'drain');
      }
      await turn();
    }
    await new Promise((taken) => process.stderr.write('', () => taken()));
    return { pid: process.pid, from, to: number - 1, bytes: written, lines: number - from };
  };
  const server = net.createServer((socket) => {
    let asked = '';
    socket.setEncoding('utf8');
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      asked += chunk;
      const end = asked.indexOf('\n');
      if (end < 0) return;
      socket.removeAllListeners('data');
      Promise.resolve(asked.slice(0, end)).then((line) => burst(JSON.parse(line)))
        .then((wrote) => socket.end(`${JSON.stringify(wrote)}\n`), (error) => socket.end(`${JSON.stringify({ failed: String(error?.stack ?? error) })}\n`));
    });
  });
  server.on('error', () => undefined);
  const path = join(ctl, `w-${process.pid}.sock`);
  try {
    rmSync(path, { force: true });
    server.listen(path);
    server.unref();
  } catch { /* no control folder: the test's connect fails and says so */ }
}
