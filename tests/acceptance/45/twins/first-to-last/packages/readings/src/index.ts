// Planted wrong program (#45): a turn counts from its first stop's stamp to its last reply.
export * from './impl.js';
import { heldTime as realHeldTime } from './impl.js';

const heldOf = (events: Parameters<typeof realHeldTime>[0]) => events.filter((e) => e.kind === 'stop.held');
export function heldTime(...args: Parameters<typeof realHeldTime>): ReturnType<typeof realHeldTime> {
  const read = realHeldTime(...args);
  for (const turn of read.turns) {
    const ids = new Set(read.stops.filter((s) => s.turn === turn.turn).map((s) => s.stop));
    const mine = heldOf(args[0]).filter((e) => ids.has(e.data.stop as string));
    if (!mine.length) continue;
    turn.total_ms = Math.max(...mine.map((e) => e.ts)) - Math.min(...mine.map((e) => e.ts - (e.data.total as number)));
  }
  return read;
}
