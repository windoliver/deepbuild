// #2732's stall: loaded into the hub's process with NODE_OPTIONS=--import, it makes a stop land while the core's
// `init` is running, before `init` creates the job pool, and writes down that it did.
//
// It acts only in `deep hub run`, and only when D2732_MARK is set. It changes no product file, and nothing the hub
// does besides one wait at the core's start.
//
// - In the hub's main thread it lets the hub's `{ op: 'stop' }` to the core's worker go, then writes `stop-posted`.
// - In the core's worker thread (the one whose workerData carries `core`), the core is created and its `init` started
//   before core-worker.js adds its message listener. When it adds that listener, the stall writes `init-running` and
//   holds the thread until the main thread wrote `stop-posted` (at most D2732_WAIT_MS, then `gave-up`). No message
//   reaches the core meanwhile, so the stop is the core's first message once its `init` next waits: `init` is still
//   running then. The listener is wrapped to write `stop-received` when the stop reaches the core.
// - It writes `pool` when the core runs `mkfifo <root>/jobserver` (the JobPool constructor makes its pipe so in a root
//   that has none), with whether the stop had reached the core by then; and `started` or `fatal` when the core says so.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

const mark = process.env.D2732_MARK;
const waitMs = Number(process.env.D2732_WAIT_MS ?? 120_000);
const at = process.argv.indexOf('hub');
const say = (o) => appendFileSync(mark, `${JSON.stringify({ pid: process.pid, main: isMainThread, at: Date.now(), ...o })}\n`);
const marked = (name) => existsSync(mark) && readFileSync(mark, 'utf8').split('\n').some((l) => l.includes(`"mark":"${name}"`));

if (mark && isMainThread && at >= 2 && process.argv[at + 1] === 'run') {
  const post = Worker.prototype.postMessage;
  let posted = false;
  Worker.prototype.postMessage = function (message, ...rest) {
    const sent = post.call(this, message, ...rest);
    if (!posted && message && typeof message === 'object' && message.op === 'stop') {
      posted = true;
      say({ mark: 'stop-posted' });
    }
    return sent;
  };
} else if (mark && !isMainThread && parentPort && workerData?.core) {
  let stopSeen = false;
  // The hub's children.js runs execFileSync through spawnSync, which it takes from child_process when it loads, after
  // this file: both are watched.
  for (const name of ['execFileSync', 'spawnSync']) {
    const run = cp[name];
    cp[name] = function (file, args, ...rest) {
      const words = [file, ...(Array.isArray(args) ? args : [])].map(String);
      const pipe = words.find((w) => w.endsWith('/jobserver'));
      if (pipe && words.some((w) => /(^|\/)mkfifo$/.test(w))) say({ mark: 'pool', path: pipe, stopSeen });
      return run.call(this, file, args, ...rest);
    };
  }
  syncBuiltinESMExports();
  const port = parentPort;
  const postMessage = port.postMessage;
  port.postMessage = function (message, ...rest) {
    if (message && typeof message === 'object' && (message.op === 'started' || message.op === 'fatal')) say({ mark: message.op });
    return postMessage.call(this, message, ...rest);
  };
  const on = port.on;
  let held = false;
  port.on = function (event, listener, ...rest) {
    if (event !== 'message' || held) return on.call(this, event, listener, ...rest);
    held = true;
    say({ mark: 'init-running' });
    const deadline = Date.now() + waitMs;
    const nap = new Int32Array(new SharedArrayBuffer(4));
    while (!marked('stop-posted') && Date.now() < deadline) Atomics.wait(nap, 0, 0, 10);
    if (!marked('stop-posted')) say({ mark: 'gave-up' });
    return on.call(this, event, (message, ...more) => {
      if (!stopSeen && message && typeof message === 'object' && message.op === 'stop') {
        stopSeen = true;
        say({ mark: 'stop-received' });
      }
      return listener(message, ...more);
    }, ...rest);
  };
}
