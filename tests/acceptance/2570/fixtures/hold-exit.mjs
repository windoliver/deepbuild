// Holds a real hub's exit open for as long as the test says (README: Stand-ins). Loaded into every Node process of
// the sandbox with NODE_OPTIONS=--import; it does nothing except in the main thread of `deep hub run` with $T2570_HOLD
// set. There it writes the hub's pid, and later its exit code, to $T2570_HOLD/hubs.jsonl, and wraps the close of the
// hub's own listener (the one on <root>/hub.sock): when $T2570_HOLD/arm exists at that close, it removes it (so one
// hub is held, once) and, as soon as the hub's stop has run as far as its first wait, stops the hub's main thread on
// a read of the FIFO $T2570_HOLD/release. The hub is then what the issue describes: its socket is closed and removed,
// its connections are closed, its process still runs and still holds the root's lock. A write to the FIFO lets the
// hub's own stop go on to its own exit. No product code is changed and no product seam is used.
import { appendFileSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { basename, join } from 'node:path';
import { isMainThread } from 'node:worker_threads';

const dir = process.env.T2570_HOLD;
if (dir && isMainThread && process.argv[2] === 'hub' && process.argv[3] === 'run') {
  const note = (o) => { try { appendFileSync(join(dir, 'hubs.jsonl'), `${JSON.stringify({ t: Date.now(), pid: process.pid, ...o })}\n`); } catch { /* the sandbox is gone */ } };
  note({ event: 'run', argv: process.argv.slice(2) });
  // Runs when the hub ends by itself (process.exit or an empty loop), never when a signal ends it.
  process.on('exit', (code) => note({ event: 'exit', code }));
  const close = net.Server.prototype.close;
  net.Server.prototype.close = function held(...args) {
    let address;
    try { address = this.address(); } catch { /* not listening */ }
    const result = close.apply(this, args);
    if (typeof address !== 'string' || basename(address) !== 'hub.sock') return result;
    // One hub, once: only the close that removes `arm` is held.
    try { rmSync(join(dir, 'arm')); } catch { return result; }
    // After the rest of the hub's stop that runs before its first wait (its connections closed, its core told to
    // stop), and before anything else the main thread would do.
    queueMicrotask(() => {
      writeFileSync(join(dir, 'holding.tmp'), `${JSON.stringify({ pid: process.pid, socket: address })}\n`);
      renameSync(join(dir, 'holding.tmp'), join(dir, 'holding'));
      note({ event: 'holding' });
      readFileSync(join(dir, 'release'));
      note({ event: 'released' });
    });
    return result;
  };
}
