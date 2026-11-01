// Planted wrong program (#45): stale runs are counted without what outdated them.
export * from './impl.js';
import { staleRuns as realStaleRuns } from './impl.js';

export function staleRuns(...args: Parameters<typeof realStaleRuns>): ReturnType<typeof realStaleRuns> {
  const read = realStaleRuns(...args);
  return { ...read, sessions: read.sessions.map((s) => ({ ...s, runs: s.runs.map((r) => ({ ...r, outdated_by: 'unknown' })) })) };
}
