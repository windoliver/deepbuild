// Planted wrong program (#45): a held check's wait counts from the first stop that held it.
export * from './impl.js';
import { loopHolds as realLoopHolds } from './impl.js';

export function loopHolds(...args: Parameters<typeof realLoopHolds>): ReturnType<typeof realLoopHolds> {
  const read = realLoopHolds(...args);
  return { ...read, sessions: read.sessions.map((s) => {
    const first = args[0].find((e) => e.kind === 'check.held' && e.session === s.session);
    return { ...s, starts: s.starts.map((start) => {
      const begun = args[0].find((e) => e.kind === 'check.held_start' && e.data.claim === start.claim);
      return { ...start, waited_ms: (begun?.ts ?? 0) - (first?.ts ?? 0) };
    }) };
  }) };
}
