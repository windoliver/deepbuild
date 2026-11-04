// A claim that says "1.8× faster than the merge base" cites a timing check that names the merge base, the compiler,
// driver and runtime versions on each side and the machine's fingerprint, and times both sides in one run with caches
// flushed before each repeat; it passes only when all five runs a side reach 1.8× within the margin. The same claim
// against "the library", with no release or commit, is INVALID naming the missing baseline; with the baseline side
// run under a driver version other than the one the check names it is INCONCLUSIVE as a reading; and with one repeat
// whose report says its caches weren't flushed, in a check that declares none warm, it is INVALID naming the repeat.
// A numbers check that accepts a baseline named only by library, or counts a side that ran under a toolchain the
// check doesn't name, fails this test: both are planted (README: Wrong programs) and shown to fail its assertions.
import { describe, expect, it } from 'vitest';
import type { SpeedClaim, SpeedPlant, TimingCheck } from '../../../../packages/checks-numbers/src/index.ts';
import type { Verdict } from '../../../../packages/verdicts/src/index.ts';
import { BASE_WORK, CHANGE_WORK, context, judge, MACHINE, numbers, shownSpeed, side, speedCheckout, TOOLCHAIN, type SideOptions } from './helpers.ts';

const REPEATS = 5;
const TIMED = ['warm', ...Array.from({ length: REPEATS }, () => ['flush', 'work']).flat()];
const OTHER_DRIVER = { ...TOOLCHAIN, driver: 'Metal 350.11' };

/** A timing check naming everything the criterion asks for, with the baseline given. */
const timing = (baseline: TimingCheck['baseline']): TimingCheck => ({
  baseline, toolchain: { baseline: { ...TOOLCHAIN }, change: { ...TOOLCHAIN } }, machine: MACHINE, repeats: REPEATS,
});
const mergeBaseClaim = (base: string): SpeedClaim => ({ stated: '1.8× faster than the merge base', timing: timing({ commit: base }) });
const libraryClaim: SpeedClaim = { stated: '1.8× faster than the library', timing: timing({ library: 'fastspin' }) };

/** The claim re-run through its timing check, its two sides doing the work given, and the core's verdict on it. */
async function speed(claim: SpeedClaim, checkout: string, baseline: SideOptions, change: SideOptions, plant?: SpeedPlant) {
  const b = side(baseline);
  const c = side(change);
  const n = await numbers();
  const r = await n.checkSpeed(claim, { baseline: b.side, change: c.side }, context(checkout), plant);
  const v = judge(r, 'check:speed');
  return { r, v, baseline: b.events, change: c.events, said: `${shownSpeed(r, v)}` };
}
const named = (v: Verdict, pattern: RegExp): boolean => v.reasons.some((x) => pattern.test(x));

describe('a speed claim cites a timing check that names its baseline, toolchains and machine, and times both sides on cold caches', () => {
  it('"1.8× faster than the merge base" passes on a change twenty times faster and never on equal work; "the library" with no release is INVALID; another driver is INCONCLUSIVE; an unflushed repeat is INVALID', async () => {
    const repo = speedCheckout();
    const claim = mergeBaseClaim(repo.base);

    // Both sides in one run: each warmed up once, then a flush before each of five timed repeats; all five reach 1.8×.
    const fast = await speed(claim, repo.dir, { work: BASE_WORK }, { work: CHANGE_WORK });
    expect(fast.baseline, `the baseline side: warmed up once, then flushed before each of ${REPEATS} timed repeats`).toEqual(TIMED);
    expect(fast.change, `the change side: warmed up once, then flushed before each of ${REPEATS} timed repeats`).toEqual(TIMED);
    expect(fast.r.repeats.baseline.length, fast.said).toBe(REPEATS);
    expect(fast.r.repeats.change.length, fast.said).toBe(REPEATS);
    expect(fast.r.timing.outcome, fast.said).toBe('counts');
    expect(fast.v.outcome, fast.said).toBe('PASS');

    // The same claim where the change is no faster: never PASS.
    const same = await speed(claim, repo.dir, { work: BASE_WORK }, { work: BASE_WORK });
    expect(same.v.outcome, same.said).not.toBe('PASS');

    // Against "the library", with no release or commit: INVALID, naming the missing baseline.
    const library = await speed(libraryClaim, repo.dir, { work: BASE_WORK }, { work: CHANGE_WORK });
    expect(library.v.outcome, library.said).toBe('INVALID');
    expect(named(library.v, /baseline/i), `the verdict names the missing baseline (${library.said})`).toBe(true);

    // The baseline side run under another driver than the check names: a reading, so INCONCLUSIVE.
    const driver = await speed(claim, repo.dir, { work: BASE_WORK, toolchain: OTHER_DRIVER }, { work: CHANGE_WORK });
    expect(driver.r.timing.outcome, driver.said).toBe('reading');
    expect(driver.r.timing.reasons.some((x) => /driver/i.test(x)), `the reading names the driver (${driver.said})`).toBe(true);
    expect(driver.v.outcome, driver.said).toBe('INCONCLUSIVE');

    // One repeat whose flush reports it didn't flush, in a check that declares no warm caches: INVALID, naming it.
    const unflushed = await speed(claim, repo.dir, { work: BASE_WORK, unflushedAt: 3 }, { work: CHANGE_WORK });
    expect(unflushed.v.outcome, unflushed.said).toBe('INVALID');
    expect(named(unflushed.v, /repeat 3(?![0-9])/i), `the verdict names repeat 3 (${unflushed.said})`).toBe(true);
  });

  it('wrong program: a numbers check that accepts a baseline named only by library fails this test (the "the library" claim is not INVALID)', async () => {
    const repo = speedCheckout();
    const planted = await speed(libraryClaim, repo.dir, { work: BASE_WORK }, { work: CHANGE_WORK }, 'library-baseline');
    expect(planted.v.outcome, `the criterion asks INVALID here, and the planted check gives ${planted.said}`).not.toBe('INVALID');
  });

  it('wrong program: a numbers check that counts a side run under a toolchain it doesn\'t name fails this test (another driver is not INCONCLUSIVE)', async () => {
    const repo = speedCheckout();
    const planted = await speed(mergeBaseClaim(repo.base), repo.dir, { work: BASE_WORK, toolchain: OTHER_DRIVER }, { work: CHANGE_WORK }, 'any-toolchain');
    expect(planted.v.outcome, `the criterion asks INCONCLUSIVE here, and the planted check gives ${planted.said}`).not.toBe('INCONCLUSIVE');
  });
});
