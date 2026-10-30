// Planted wrong program (#45): the held places count as runs.
export * from './impl.js';
import { loopHolds as realLoopHolds } from './impl.js';

export function loopHolds(...args: Parameters<typeof realLoopHolds>): ReturnType<typeof realLoopHolds> {
  const read = realLoopHolds(...args);
  return { ...read, sessions: read.sessions.map((s) => ({ ...s, runs_started: s.runs_started + s.places_taken, runs_saved: 0 })) };
}
