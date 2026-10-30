// Planted wrong program (#45): a session adds its stops and its turns, so a turn counts twice.
export * from './impl.js';
import { heldTime as realHeldTime } from './impl.js';

export function heldTime(...args: Parameters<typeof realHeldTime>): ReturnType<typeof realHeldTime> {
  const read = realHeldTime(...args);
  for (const session of read.sessions) {
    const turns = read.turns.filter((t) => t.session === session.session).reduce((sum, t) => sum + t.total_ms, 0);
    const own = read.stops.filter((s) => s.session === session.session).reduce((sum, s) => sum + s.total_ms, 0);
    session.total_ms = turns + own;
  }
  return read;
}
