// Deadlines a caller sets: a run's, a check's, a call's. Node keeps a timer's delay in a signed 32-bit integer and
// runs any longer one after 1 ms, so a long deadline is armed in steps of at most 2³¹ − 1 ms (#822).

const MAX_DELAY_MS = 2 ** 31 - 1;

/** Calls `fn` once `ms` have passed, however long that is; the function returned cancels it. */
export function after(ms: number, fn: () => void): () => void {
  let timer: NodeJS.Timeout;
  const arm = (left: number): void => {
    timer = left > MAX_DELAY_MS ? setTimeout(() => arm(left - MAX_DELAY_MS), MAX_DELAY_MS) : setTimeout(fn, left);
  };
  arm(ms);
  return () => clearTimeout(timer);
}

/** Why `value` can't be the deadline `field`, naming both, or null when it is a positive whole number of ms. */
export function badDeadline(field: string, value: unknown): string | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? null : `${field} is a positive whole number of milliseconds, not ${String(value)}`;
}
