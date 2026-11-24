// Keeps a real hub "still exiting" for as long as the test says (REDRAFT.md: How the scene keeps the hub exiting).
// Loaded into every Node process of the sandbox with NODE_OPTIONS=--import. It acts only in the main thread of
// `deep hub run` and `deep hub start`, and only with $T2570_HOLD set; every line it writes goes to
// $T2570_HOLD/hubs.jsonl.
//
// In `deep hub start` it writes one line, `start-command`: the command's process is running.
//
// In `deep hub run` it writes the hub's pid at its start (`run`) and its exit code when the hub ends by itself
// (`exit`; a signal leaves no such line). And it makes the hub's core slow to stop, once: the base's Hub.stop closes
// the socket, closes its connections and then sends its core, a worker thread, the message { op: 'stop' } and waits
// for the answer before it exits. When $T2570_HOLD/arm exists as that message is sent, this file removes `arm`,
// writes `held` and keeps the message back until $T2570_HOLD/go exists; then it sends it on, unchanged. Meanwhile
// the hub is what the issue describes and nothing else: its socket is closed and gone, its process runs, it holds the
// root's lock, and its own stop is waiting for its core. Its event loop is never stopped, so its timers, its signal
// handlers and its core all run as they do in a hub whose core takes that long. No product file is changed and no
// product seam is used.
import { appendFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isMainThread, Worker } from 'node:worker_threads';

const dir = process.env.T2570_HOLD;
const [, , first, second] = process.argv;
if (dir && isMainThread && first === 'hub' && (second === 'run' || second === 'start')) {
  const note = (o) => { try { appendFileSync(join(dir, 'hubs.jsonl'), `${JSON.stringify({ t: Date.now(), pid: process.pid, ...o })}\n`); } catch { /* the sandbox is gone */ } };
  if (second === 'start') {
    note({ event: 'start-command' });
  } else {
    note({ event: 'run', argv: process.argv.slice(2) });
    // Runs when the hub ends by itself (process.exit or an empty loop), never when a signal ends it.
    process.on('exit', (code) => note({ event: 'exit', code }));
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function slowStop(message, ...rest) {
      if (message?.op !== 'stop') return post.call(this, message, ...rest);
      // One hub, once: only the stop that removes `arm` is kept back.
      try { rmSync(join(dir, 'arm')); } catch { return post.call(this, message, ...rest); }
      note({ event: 'held' });
      const asked = setInterval(() => {
        if (!existsSync(join(dir, 'go'))) return;
        clearInterval(asked);
        note({ event: 'let-go' });
        post.call(this, message, ...rest);
      }, 5);
      return undefined;
    };
  }
}
