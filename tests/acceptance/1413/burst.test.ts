// #1413.14667826: 1,000 identical device errors in a second print at most the burst, then one line with the
// suppressed count. The counted error source is `raise_errors` (README): 1,000 identical validation errors raised on
// the real device, through its uncaptured-error callback, as fast as it can. The test reads the process's stderr:
// each printed error is a line that starts `deep-gpu: the device raised` (the base's print), and the count is one
// line that starts `deep-gpu: ` and holds the word `suppressed` and one number. At the base there is no
// `test-faults` feature, so the binary doesn't build; its handler prints every error.
import { describe, expect, it } from 'vitest';
import { BURST_CEILING, ERRORS, ERRORS_WITHIN_MS, answered, num, run, useBuild, useDir } from './helpers.ts';

const bin = useBuild();
const dir = useDir();
const PRINTED = 'deep-gpu: the device raised';

describe('#1413.14667826 1,000 identical device errors in a second print at most the burst, then one line with the suppressed count', () => {
  it('#1413.14667826 1,000 identical validation errors print at most the burst, and one more line counts the rest as suppressed', () => {
    const { replies, stderr } = run(bin(), dir(), [{ call: 'raise_errors', count: ERRORS }]);
    const r = answered(replies[0]!, 'raise_errors');
    expect(num(r['raised'], 'raise_errors: raised'), 'the device\'s error callback saw all 1,000 errors').toBe(ERRORS);
    expect(num(r['ms'], 'raise_errors: ms'), 'they came within a second').toBeLessThanOrEqual(ERRORS_WITHIN_MS);
    const burst = num(r['burst'], 'raise_errors: burst');
    expect(burst, `the burst is at least 1 line and at most ${BURST_CEILING}`).toBeGreaterThanOrEqual(1);
    expect(burst, `the burst is at least 1 line and at most ${BURST_CEILING}`).toBeLessThanOrEqual(BURST_CEILING);

    const lines = stderr.split('\n');
    const printed = lines.filter((l) => l.startsWith(PRINTED) && !/\bsuppressed\b/.test(l)).length;
    expect(printed, 'the first error prints').toBeGreaterThanOrEqual(1);
    expect(printed, `at most the burst (${burst}) of the 1,000 errors print`).toBeLessThanOrEqual(burst);
    const counts = lines.filter((l) => l.startsWith('deep-gpu: ') && /\bsuppressed\b/.test(l));
    expect(counts, 'exactly one line counts what was suppressed').toHaveLength(1);
    const numbers = counts[0]!.match(/\d+/g) ?? [];
    expect(numbers, `the suppressed line holds one number: ${counts[0]}`).toHaveLength(1);
    expect(Number(numbers[0]), 'the suppressed count is every error that didn\'t print').toBe(ERRORS - printed);
  }, 3_600_000);
});
