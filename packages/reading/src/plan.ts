/** A 5-hour window reading: the share used and when it resets, in milliseconds, as the runner keeps it. */
export interface WindowReading { used: number; resets: number | null }

/** How far apart two readings' resets may be and still name one window: a reset moves it by five hours. */
const SAME_WINDOW_MS = 3_600_000;

/**
 * The share of the window used from one reading to a later one, to two decimals. Two readings of different windows,
 * or a later one showing less used, can't say what was spent between them: not captured.
 */
export function usedBetween(from: WindowReading, to: WindowReading): number | 'not captured' {
  const moved = from.resets !== null && to.resets !== null && Math.abs(to.resets - from.resets) >= SAME_WINDOW_MS;
  if (moved || to.used < from.used) return 'not captured';
  return Math.round((to.used - from.used) * 100) / 100;
}
