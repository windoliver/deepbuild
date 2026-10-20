// The extension that ignores its abort signal, for the #56 acceptance tests. The hub under test
// loads it with `--extension <this file>` and calls `onHold(hold, signal)` once per hold.
//
// It writes what happened to it to the file in DEEP_SPIKE_EXTENSION_LOG, and otherwise misbehaves
// the way the issue names: it never settles, keeps a timer of its own running forever, and goes
// on after its signal aborts. Listening for the abort only records that it came.
import { appendFileSync } from 'node:fs';

const log = process.env.DEEP_SPIKE_EXTENSION_LOG;
const record = (event, hold) => {
  if (log) appendFileSync(log, `${JSON.stringify({ event, id: hold?.id ?? null, session: hold?.session ?? null, t: Date.now() })}\n`);
};

export default {
  name: 'ignores-abort',
  onHold(hold, signal) {
    record(signal instanceof AbortSignal ? 'called' : 'called without an AbortSignal', hold);
    if (signal instanceof AbortSignal) signal.addEventListener('abort', () => record('aborted', hold), { once: true });
    setInterval(() => {}, 60_000);
    return new Promise(() => {});
  },
};
