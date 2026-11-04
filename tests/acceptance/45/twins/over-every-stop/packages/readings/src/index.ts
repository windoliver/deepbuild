// Planted wrong program (#45): the code-changing reading runs over every stop.
export * from './impl.js';
import { heldTime as realHeldTime } from './impl.js';

export function heldTime(...args: Parameters<typeof realHeldTime>): ReturnType<typeof realHeldTime> {
  const read = realHeldTime(...args);
  for (const session of read.sessions) {
    const all = read.stops.filter((s) => s.session === session.session).map((s) => s.total_ms - s.by.slow).sort((a, b) => a - b);
    const at = (q: number): number => all[Math.min(all.length - 1, Math.ceil(q * all.length) - 1)] ?? 0;
    session.code_changing = { ...session.code_changing, p50_ms: at(0.5), p95_ms: at(0.95), stops: all.length };
  }
  return read;
}
