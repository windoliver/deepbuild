// Planted wrong program (#45): an update keeps the state it was given.
export * from './impl.js';
import { update as realUpdate } from './impl.js';

export function update(...args: Parameters<typeof realUpdate>): ReturnType<typeof realUpdate> {
  return args[0];
}
