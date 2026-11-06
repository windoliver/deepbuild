// A stated speed re-run through the timing check behind it (#87, design: Speed claims name their baseline). Both
// sides run in one run on cold caches: each warmed up once, then every timed repeat starts with a flush. The stated
// factor is judged as a timing result is, on the repeats a side: passed when every repeat reaches it, failed when
// every repeat misses it by more than the margin (the larger of 5% and the repeats' spread), uncounted otherwise.
import { execFileSync } from 'node:child_process';
import type { CheckContext, Failure } from '@deepbuild/conformance';
import type { TimingReport } from '@deepbuild/verdicts';
import type { Side, SpeedClaim, SpeedPlant, SpeedResult, Toolchain } from './types.js';

const MIN_MARGIN = 0.05;

/** Why the baseline can't be timed against: none named, a library with no pinned release, or a commit the checkout lacks. */
function unresolved(claim: SpeedClaim, ctx: CheckContext, plant?: SpeedPlant): string | null {
  const b = claim.timing.baseline as Partial<{ commit: string; library: string; release: string }> | undefined;
  if (b?.commit) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${b.commit}^{commit}`], { cwd: ctx.checkout, stdio: 'ignore' });
      return null;
    } catch {
      return `the baseline commit ${b.commit} doesn't resolve in the checkout`;
    }
  }
  if (b?.library) return b.release || plant === 'library-baseline' ? null : `the baseline names the library ${b.library} with no pinned release or commit`;
  return 'the timing check names no baseline';
}

/** How a side's toolchain and machine differ from what the check names, each in words. */
function offToolchain(name: 'baseline' | 'change', side: Side, claim: SpeedClaim): string[] {
  const want = claim.timing.toolchain[name];
  const ran = side.toolchain();
  const off = (Object.keys(want) as (keyof Toolchain)[]).filter((k) => ran[k] !== want[k])
    .map((k) => `the ${name} side ran with ${k} ${ran[k]}, where the check names ${want[k]}`);
  if (side.machine() !== claim.timing.machine) off.push(`the ${name} side ran on ${side.machine()}, where the check names ${claim.timing.machine}`);
  return off;
}

const factorOf = (stated: string): number => Number(/([0-9]+(?:\.[0-9]+)?)\s*[×x]/.exec(stated)?.[1] ?? NaN);

export async function checkSpeed(claim: SpeedClaim, sides: { baseline: Side; change: Side }, ctx: CheckContext, plant?: SpeedPlant): Promise<SpeedResult> {
  const warm = claim.timing.warm === true;
  const repeats = { baseline: [] as number[], change: [] as number[] };
  const result = (outcome: SpeedResult['outcome'], timing: TimingReport, failures: Failure[] = []): SpeedResult =>
    ({ outcome, testsRun: repeats.change.length ? 1 : 0, failures, evidence: [], read: [], mask: null, timing, repeats });
  const missing = unresolved(claim, ctx, plant);
  if (missing) return result('uncounted', { outcome: 'INVALID', reasons: [missing], warm });
  // No repeat timed shows no speed: a claim judged on none would pass on nothing.
  if (!(Number.isInteger(claim.timing.repeats) && claim.timing.repeats > 0)) {
    return result('uncounted', { outcome: 'INVALID', reasons: [`the timing check times ${String(claim.timing.repeats)} repeats a side, so nothing is timed`], warm });
  }

  const unflushed: string[] = [];
  const named = [['baseline', sides.baseline], ['change', sides.change]] as const;
  for (const [, side] of named) await side.warmUp();
  for (let i = 1; i <= claim.timing.repeats; i++) {
    for (const [name, side] of named) {
      if (!(await side.flush()) && !warm) unflushed.push(`repeat ${i} of the ${name} side ran without its caches flushed, and the check declares no warm caches`);
      const started = performance.now();
      await side.work();
      repeats[name].push(performance.now() - started);
    }
  }
  if (unflushed.length) return result('uncounted', { outcome: 'INVALID', reasons: unflushed, warm });
  const off = plant === 'any-toolchain' ? [] : named.flatMap(([name, side]) => offToolchain(name, side, claim));
  if (off.length) return result('uncounted', { outcome: 'reading', reasons: off, warm });

  const factor = factorOf(claim.stated);
  if (!Number.isFinite(factor)) return result('uncounted', { outcome: 'INVALID', reasons: [`"${claim.stated}" states no factor`], warm });
  const ratios = repeats.baseline.map((b, i) => b / repeats.change[i]!);
  const sorted = [...ratios].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const margin = Math.max(MIN_MARGIN, (sorted.at(-1)! - sorted[0]!) / median);
  const shown = ratios.map((r) => `${r.toFixed(2)}×`).join(', ');
  const timing: TimingReport = { outcome: 'counts', reasons: [], warm };
  if (ratios.every((r) => r >= factor)) return result('passed', timing);
  if (ratios.every((r) => r < factor * (1 - margin))) {
    return result('failed', timing, [{ test: `speed: ${claim.stated}`, file: '', line: 1, stack: null, assertion: true, message: `"${claim.stated}": every repeat misses ${factor}× by more than the ${(margin * 100).toFixed(0)}% margin (${shown})` }]);
  }
  return result('uncounted', timing);
}
