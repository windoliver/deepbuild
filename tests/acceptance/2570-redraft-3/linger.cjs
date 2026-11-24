// The scene's one instrument, loaded into a real `deep hub run` only through NODE_OPTIONS=--require, which
// start.test.ts sets on the `deep hub start` whose hub it shapes (the started hub inherits the variable). No product
// file is changed. In any process other than `deep hub run --root <folder>` it does nothing.
//
// ACC2570_TRACE     a JSON-lines file: the hub's pid when its process starts, when its socket closed, when it exits.
// ACC2570_SOCKET    the root's socket path, so only the hub's own listener is touched.
// ACC2570_LINGER_MS a stopped hub still exiting: right after the hub closes its socket (the first step of its stop),
//                   its main thread is held for this long before the stop goes on to release the lock and exit.
//                   That is the issue's "closes its socket, then exits after a set time", on the real hub.
// ACC2570_HANG=1    a hub that never answers: its listen on the socket is withheld, so the process runs on,
//                   holding the root's lock, and nothing ever answers there.
'use strict';
const { appendFileSync } = require('node:fs');
const net = require('node:net');

const trace = process.env.ACC2570_TRACE;
const socket = process.env.ACC2570_SOCKET;
const hubRun = process.argv[2] === 'hub' && process.argv[3] === 'run' && process.argv.includes('--root');

if (trace && socket && hubRun) {
  const note = (event, data = {}) => {
    try { appendFileSync(trace, `${JSON.stringify({ event, pid: process.pid, t: Date.now(), ...data })}\n`); } catch { /* the scene reads what it can */ }
  };
  note('hub-process', { argv: process.argv.slice(2) });
  process.on('exit', (code) => note('exit', { code }));

  const linger = Number(process.env.ACC2570_LINGER_MS || 0);
  if (linger > 0) {
    const close = net.Server.prototype.close;
    net.Server.prototype.close = function (...args) {
      let own = false;
      try { own = this.address() === socket; } catch { /* not listening */ }
      const result = close.apply(this, args);
      if (own) {
        note('socket-closed');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, linger);
        note('linger-over');
      }
      return result;
    };
  }

  if (process.env.ACC2570_HANG === '1') {
    const listen = net.Server.prototype.listen;
    net.Server.prototype.listen = function (...args) {
      if (args[0] !== socket) return listen.apply(this, args);
      note('listen-withheld');
      // The process stays up on its own, as a hung hub does.
      setInterval(() => undefined, 1 << 30);
      return this;
    };
  }
}
