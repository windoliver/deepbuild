// Planted wrong program (#45): recompute takes 11 s and an update 1.1 s.
export * from './impl.js';
import { recompute as realRecompute, update as realUpdate } from './impl.js';

const spin = (ms: number): void => { const end = performance.now() + ms; while (performance.now() < end); };
export function recompute(...args: Parameters<typeof realRecompute>): ReturnType<typeof realRecompute> {
  spin(11_000);
  return realRecompute(...args);
}
export function update(...args: Parameters<typeof realUpdate>): ReturnType<typeof realUpdate> {
  spin(1100);
  return realUpdate(...args);
}
