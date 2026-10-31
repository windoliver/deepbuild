// Planted wrong program (#45): a stale reading shows as current.
export * from './impl.js';
import { panelRows as realPanelRows } from './impl.js';

export function panelRows(...args: Parameters<typeof realPanelRows>): ReturnType<typeof realPanelRows> {
  const read = realPanelRows(...args);
  return read.map((row) => ({ ...row, status: 'current' as const }));
}
