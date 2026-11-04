// Planted wrong program (#45): stale runs are counted per day, keeping one day of a session.
export * from './impl.js';
import { staleRuns as realStaleRuns } from './impl.js';

export function staleRuns(...args: Parameters<typeof realStaleRuns>): ReturnType<typeof realStaleRuns> {
  const read = realStaleRuns(...args);
  const day = (run: string): number => {
    const end = args[0].find((e) => e.kind === 'run.stale' && e.data.run === run);
    return Math.floor((end?.ts ?? 0) / 86_400_000);
  };
  return { ...read, sessions: read.sessions.map((s) => {
    const first = s.runs[0] ? day(s.runs[0].run) : 0;
    const runs = s.runs.filter((r) => day(r.run) === first);
    return { ...s, count: runs.length, runs, within_30s: runs.filter((r) => r.after_ms <= 30_000).length };
  }) };
}
