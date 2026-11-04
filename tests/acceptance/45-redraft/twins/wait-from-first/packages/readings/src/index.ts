export * from './impl.js';
import { loopHolds as realLoopHolds } from './impl.js';

// Twin for #45.5f772137: a start's wait measured from the wrong stop, the first held place's of its check in the
// session, instead of its own. Each wait grows by the time from the first hold of that check to the hold that started.
export function loopHolds(...args: Parameters<typeof realLoopHolds>): ReturnType<typeof realLoopHolds> {
  const [events] = args;
  const real = realLoopHolds(...args);
  const held = events.filter((e) => e.kind === 'check.held').map((e) => e.data as { session: string; check: string; held_at: number; started_by: string | null });
  return {
    sessions: real.sessions.map((s) => ({
      ...s,
      starts: s.starts.map((start) => {
        const mine = held.filter((h) => h.session.replace(/^session:/, '') === s.session && h.check === start.check);
        if (!mine.length) return start;
        const first = Math.min(...mine.map((h) => h.held_at));
        const own = mine.filter((h) => h.started_by !== null).map((h) => h.held_at);
        const ownAt = own.length ? Math.max(...own) : first;
        return { ...start, waited_ms: start.waited_ms + (ownAt - first) };
      }),
    })),
  };
}
