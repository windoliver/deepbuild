// A check's host@1 scope: wait proves the entire run gone, and closing also drains starts whose caller timed out.
// Both the extension host and the hub's built-in kind table use it; neither owns processes outside this scope.
import type { Host, Started, Supervisor } from './types.js';

export function checkHost(supervisor: Supervisor): { host: Host; close(): Promise<void> } {
  let closed = false;
  const starts = new Map<string, Promise<Started>>();
  const clean = async (run: string): Promise<void> => {
    const result = await supervisor.cleanup(run);
    if (result.outcome !== 'clean') throw Error(`BLOCKED: ${run}'s cleanup could not prove every process gone: ${result.left.join(', ')}`);
  };
  return {
    host: {
      name: supervisor.name,
      start: (spec) => {
        if (closed) return Promise.reject(Error('the check ended; no further process may start'));
        if (starts.has(spec.run)) return Promise.reject(Error(`${spec.run} has already started in this check`));
        const starting = supervisor.start(spec);
        starts.set(spec.run, starting);
        // A refused start conveys no ownership, especially when its token already belongs to another run.
        void starting.catch(() => { starts.delete(spec.run); });
        return starting;
      },
      signal: (run, signal) => supervisor.signal(run, signal),
      wait: async (run) => {
        try { return await supervisor.wait(run); }
        finally { await clean(run); }
      },
      facts: () => supervisor.facts(),
    },
    close: async () => {
      closed = true;
      // Let synchronous start refusals drop their tokens before taking the set this scope owns.
      await Promise.resolve();
      // Cleanup cancels queued starts too: awaiting the start first would deadlock on another run's lease.
      const results = await Promise.allSettled([...starts].map(async ([run, starting]) => {
        const [started, cleaned] = await Promise.allSettled([starting, clean(run)]);
        // A refused launch can disappear before cleanup finds it. Any run still recorded must prove cleanup.
        if (cleaned.status === 'rejected' && (started.status === 'fulfilled' || await supervisor.status(run).then(() => true, () => false))) throw cleaned.reason;
      }));
      const failed = results.find((r) => r.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    },
  };
}
