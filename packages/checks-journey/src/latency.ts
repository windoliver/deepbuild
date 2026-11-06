// A latency check (#37): the changed journeys or commands timed on the branch and on the merge base, the same number
// of runs each, failing when the branch is slower by more than the proof bar's margin, showing both times.
export interface Timed { side: 'branch' | 'base'; ms: number[] }
export interface LatencyVerdict {
  outcome: 'passed' | 'failed' | 'INVALID';
  branch: { runs: number; median: number };
  base: { runs: number; median: number };
  /** The margin as a fraction of the base's median, from the proof bar. */
  margin: number;
  message: string;
}
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : NaN;
};

/** Judges two sides' timings; a margin that isn't a number, or an unequal number of runs, can't be judged, so it is INVALID naming why. */
export function judgeLatency(branch: readonly number[], base: readonly number[], margin: number): LatencyVerdict {
  const b = { runs: branch.length, median: median(branch) }, m = { runs: base.length, median: median(base) };
  if (!(margin >= 0)) return { outcome: 'INVALID', branch: b, base: m, margin, message: `the margin ${margin} is not a number of percent at or above 0, so no time can be judged against it` };
  if (!branch.length || branch.length !== base.length) return { outcome: 'INVALID', branch: b, base: m, margin, message: `the branch ran ${branch.length} times and the base ${base.length}: a latency check times both sides the same number of runs` };
  const limit = m.median * (1 + margin);
  const slower = b.median > limit;
  return {
    outcome: slower ? 'failed' : 'passed', branch: b, base: m, margin,
    message: `branch ${b.median.toFixed(1)} ms vs base ${m.median.toFixed(1)} ms over ${branch.length} runs each (limit ${limit.toFixed(1)} ms at a ${Math.round(margin * 100)}% margin): ${slower ? 'slower by more than the margin' : 'within the margin'}`,
  };
}
