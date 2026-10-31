// Planted wrong program (#45): the band always reads inside.
export * from './impl.js';
import { heldTime as realHeldTime } from './impl.js';

export function heldTime(...args: Parameters<typeof realHeldTime>): ReturnType<typeof realHeldTime> {
  const read = realHeldTime(...args);
  for (const session of read.sessions) session.code_changing = { ...session.code_changing, band: 'inside' };
  return read;
}
