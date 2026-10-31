// Planted wrong program (#45): a turn keeps only its last stop.
export * from './impl.js';
import { heldTime as realHeldTime } from './impl.js';

export function heldTime(...args: Parameters<typeof realHeldTime>): ReturnType<typeof realHeldTime> {
  const read = realHeldTime(...args);
  for (const turn of read.turns) {
    const last = read.stops.filter((s) => s.turn === turn.turn).at(-1);
    if (last) { turn.total_ms = last.total_ms; turn.by = last.by; }
  }
  return read;
}
