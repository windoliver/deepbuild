// Planted wrong program (#45): panel rows drop their source and age.
export * from './impl.js';
import { panelRows as realPanelRows } from './impl.js';

export function panelRows(...args: Parameters<typeof realPanelRows>): ReturnType<typeof realPanelRows> {
  const read = realPanelRows(...args);
  return read.map((row) => ({ ...row, source: '', age_ms: null as unknown as number }));
}
