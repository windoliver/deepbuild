// Planted wrong program (#45): the slow hold stays in the code-changing reading.
export * from './impl.js';
import { heldTime as realHeldTime } from './impl.js';

export function heldTime(...args: Parameters<typeof realHeldTime>): ReturnType<typeof realHeldTime> {
  const read = realHeldTime(...args);
  for (const session of read.sessions) {
    const all = read.stops.filter((s) => s.session === session.session && s.code_changing).map((s) => s.total_ms).sort((a, b) => a - b);
    const at = (q: number): number => all[Math.min(all.length - 1, Math.ceil(q * all.length) - 1)] ?? 0;
    session.code_changing = { ...session.code_changing, p50_ms: at(0.5), p95_ms: at(0.95), slow_hold_ms: 0 };
  }
  return read;
}
