// Criterion 4: "A linear table with x 0, 1, 2, 4 and y 0, 1, 1.5, 1.75 reads 1.625 at 3, 0 at −1 and 1.75 at 5, and
// its interval form over [0.5, 3] is [0.5, 1.625] within one ulp; a planted sampler that extrapolates past the ends
// reads 1.875 at 5 and fails, naming the table; and in monotone mode, 1,000 samples between each pair of knots stay
// between those knots' values"
//
// Through `deep-show run`'s `fn` call in the `core` build: `table(fnpack.ramp, x)` over the table a pack named
// fnpack holds (the call's `packs`, README: tables). "Within one ulp" is each end within one ulp of 0.5 and 1.625 and
// enclosing them (an interval form never lies inside the range it bounds). The monotone half also asserts the
// samples aren't the linear table's, so a monotone mode that is linear interpolation fails. No upstream test.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, boundsOf, failsNaming, fnReplies, none, scalars, ulp, useEvidence, useShow, type JsonObject } from './helpers.ts';

const CORE = 'core';
const shows = useShow([CORE]);
const evidence = useEvidence();

const RAMP = { x: [0, 1, 2, 4], y: [0, 1, 1.5, 1.75], mode: 'linear' };
const pack = (tables: JsonObject): JsonObject[] => [{ name: 'fnpack', tables }];
const READ = [3, -1, 5];
const WANT = [1.625, 0, 1.75];

/** The table read at 3, −1 and 5: 1.625 between its knots, and held at its ends below the first and past the last. */
function readFailures(values: (number | null)[]): string[] {
  return READ.flatMap((x, i) => (values[i] === WANT[i] ? [] : [`table fnpack.ramp reads ${values[i]} at ${x}, not ${WANT[i]}`]));
}

describe('criterion 4: a function table reads between and at its knots, held at its ends, with an interval form exact from its knots', () => {
  it('criterion 4: the linear table reads 1.625 at 3, 0 at −1 and 1.75 at 5, and its interval form over [0.5, 3] is [0.5, 1.625] within one ulp', () => {
    const [read, form] = fnReplies(shows.bin(CORE), evidence(), [
      { expr: 'table(fnpack.ramp, x)', packs: pack({ ramp: RAMP }), at: READ },
      { expr: 'table(fnpack.ramp, x)', packs: pack({ ramp: RAMP }), over: [[0.5, 3]] },
    ]);
    none(readFailures(scalars(read!, READ.length, 'the table read')), 'the table read at 3, −1 and 5');
    const [b] = boundsOf(form!, 1, 'the table over [0.5, 3]');
    expect(b!.lo, 'the lower end').not.toBeNull();
    expect(b!.hi, 'the upper end').not.toBeNull();
    expect(b!.lo!, 'the lower end holds 0.5').toBeLessThanOrEqual(0.5);
    expect(0.5 - b!.lo!, 'the lower end within one ulp of 0.5').toBeLessThanOrEqual(ulp(0.5));
    expect(b!.hi!, 'the upper end holds 1.625').toBeGreaterThanOrEqual(1.625);
    expect(b!.hi! - 1.625, 'the upper end within one ulp of 1.625').toBeLessThanOrEqual(ulp(1.625));
  }, TIMEOUT);

  it('criterion 4: a planted sampler that extrapolates past the ends reads 1.875 at 5 and fails, naming the table', () => {
    const [read] = fnReplies(shows.bin(CORE), evidence(), [{ expr: 'table(fnpack.ramp, x)', packs: pack({ ramp: RAMP }), at: READ, planted: 'table_extrapolates' }]);
    const values = scalars(read!, READ.length, 'the planted sampler');
    expect(values[2], 'the planted sampler extends the last segment to 5').toBe(1.875);
    failsNaming(readFailures(values), ['fnpack.ramp'], 'the read check on the planted sampler');
  }, TIMEOUT);

  it('criterion 4: in monotone mode, 1,000 samples between each pair of knots stay between those knots\' values', () => {
    const wavy = { x: [0, 1, 2, 3, 4, 6, 7], y: [0, 2, 1, 1, 3, -1, 0.5], mode: 'monotone' };
    const xs: number[] = [];
    for (let k = 0; k + 1 < wavy.x.length; k++) for (let j = 1; j <= 1000; j++) xs.push(wavy.x[k]! + ((wavy.x[k + 1]! - wavy.x[k]!) * j) / 1001);
    const [read] = fnReplies(shows.bin(CORE), evidence(), [{ expr: 'table(fnpack.wavy, x)', packs: pack({ wavy }), at: xs }]);
    const v = scalars(read!, xs.length, 'the monotone table');
    const failures: string[] = [];
    let curved = false;
    xs.forEach((x, i) => {
      const k = Math.floor(i / 1000);
      const [a, b] = [wavy.y[k]!, wavy.y[k + 1]!];
      const y = v[i];
      if (y === null || y === undefined || y < Math.min(a, b) || y > Math.max(a, b)) failures.push(`at ${x}, between knots ${k} and ${k + 1} (${a} and ${b}), the table reads ${y}`);
      const linear = a + ((b - a) * (x - wavy.x[k]!)) / (wavy.x[k + 1]! - wavy.x[k]!);
      if (y !== null && y !== undefined && Math.abs(y - linear) > 1e-6) curved = true;
    });
    none(failures, 'the monotone samples between their knots');
    expect(curved, 'monotone mode is the piecewise cubic, not the linear table').toBe(true);
  }, TIMEOUT);
});
