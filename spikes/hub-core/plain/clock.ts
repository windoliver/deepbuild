// The hub's clock: real time, or virtual time that starts at 0 and moves only on `tick`.
export interface Clock {
  now(): number;
  // Calls `fire` once the clock reaches `time`; the returned function cancels it.
  at(time: number, fire: () => void): () => void;
}

export interface VirtualClock extends Clock {
  // Moves the clock on by `ms`, fires every timer due by then, and returns the new time.
  tick(ms: number): number;
}

export function realClock(): Clock {
  return {
    now: () => Date.now(),
    at(time, fire) {
      const timer = setTimeout(fire, Math.max(0, time - Date.now()));
      return () => clearTimeout(timer);
    },
  };
}

export function virtualClock(): VirtualClock {
  let current = 0;
  const timers = new Set<{ time: number; fire: () => void }>();
  return {
    now: () => current,
    at(time, fire) {
      const timer = { time, fire };
      timers.add(timer);
      return () => {
        timers.delete(timer);
      };
    },
    tick(ms) {
      current += ms;
      const due = [...timers].filter(({ time }) => time <= current).sort((a, b) => a.time - b.time);
      for (const timer of due) {
        timers.delete(timer);
        timer.fire();
      }
      return current;
    },
  };
}
