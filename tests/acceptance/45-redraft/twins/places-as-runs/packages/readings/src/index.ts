export * from './impl.js';
import { loopHolds as realLoopHolds } from './impl.js';

// Twin for #45.5f772137: a reading that counts the held places as runs. Every held place, the ones a newer snapshot
// took as well as the one that started, is read as a run started, each with a start of its own, and none as saved.
export function loopHolds(...args: Parameters<typeof realLoopHolds>): ReturnType<typeof realLoopHolds> {
  const real = realLoopHolds(...args);
  return {
    sessions: real.sessions.map((s) => ({
      ...s,
      runs_started: s.runs_started + s.places_taken,
      runs_saved: 0,
      starts: [...s.starts, ...Array.from({ length: s.places_taken }, () => s.starts[0]).filter((x) => x !== undefined)],
    })),
  };
}
