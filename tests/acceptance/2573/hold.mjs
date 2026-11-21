// #2573's hold: loaded into the hub's process with NODE_OPTIONS=--import, it keeps a stopping hub alive.
//
// It acts only in the main thread of `deep hub run`, and only when D2573_HOLD_MS and D2573_MARK are set. The hub
// tells its core to stop by posting `{ op: 'stop' }` to the core's worker thread, right after it closed its socket.
// The hold lets that message go, writes a line to the marker file, then blocks the main thread for the hold's
// length: the core's thread goes on running and stops the core, the hub's main thread can't leave. That is the
// hold the issue's own probe used. It changes no product file and nothing the hub does besides the wait.
import { appendFileSync } from 'node:fs';
import { isMainThread, Worker } from 'node:worker_threads';

const ms = Number(process.env.D2573_HOLD_MS);
const mark = process.env.D2573_MARK;
const at = process.argv.indexOf('hub');
if (isMainThread && mark && ms > 0 && at >= 2 && process.argv[at + 1] === 'run') {
  const say = (o) => appendFileSync(mark, `${JSON.stringify({ pid: process.pid, at: Date.now(), ...o })}\n`);
  const post = Worker.prototype.postMessage;
  let held = false;
  Worker.prototype.postMessage = function (message, ...rest) {
    const sent = post.call(this, message, ...rest);
    if (!held && message && typeof message === 'object' && message.op === 'stop') {
      held = true;
      say({ mark: 'held', ms });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      say({ mark: 'released' });
    }
    return sent;
  };
}
