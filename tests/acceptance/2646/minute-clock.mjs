// #2646 acceptance, test code only: the hub's one-minute interval, fired when the test says so.
//
// minute.test.mjs starts each hub with `node --import <this file>` and DEEP_2646_MINUTES=<file>. The hub's minute pass
// runs on a wall-clock interval of 60,000 ms, which the hub's test clock (test.clock) doesn't move, so 120 minutes on a
// test clock would take two hours. Node's timers are a boundary this repo doesn't own: here every setInterval of
// exactly 60,000 ms, in whichever thread makes it, is kept and never armed, and runs once each time the number in the
// file goes up by one. The thread then appends `<thread>:<n>` to <file>.ack, after `<thread>:reg` when it first kept
// one, so the test knows each thread with a minute job has run minute n. Nothing else of the hub is touched, and
// without the variable this file does nothing.
import { appendFileSync, readFileSync } from 'node:fs';
import { threadId } from 'node:worker_threads';

const file = process.env.DEEP_2646_MINUTES;
if (file) {
  const real = globalThis.setInterval;
  const jobs = [];
  globalThis.setInterval = function minuteOnDemand(job, ms, ...rest) {
    if (ms !== 60_000) return real.call(this, job, ms, ...rest);
    if (!jobs.length) appendFileSync(`${file}.ack`, `${threadId}:reg\n`);
    jobs.push(() => job(...rest));
    // A timer of its own to clear or unref, which never comes due.
    return real(() => undefined, 2 ** 31 - 1);
  };
  let fired = 0;
  real(() => {
    let asked;
    try {
      asked = Number(readFileSync(file, 'utf8'));
    } catch {
      return;
    }
    if (!(asked > fired)) return;
    for (; fired < asked; fired++) for (const job of jobs) job();
    if (jobs.length) appendFileSync(`${file}.ack`, `${threadId}:${fired}\n`);
  }, 10).unref();
}
