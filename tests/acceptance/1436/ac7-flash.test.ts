// Criterion 7 (README: Criteria to tests): "A planted effect flashing 4 times a second is refused, naming the rate."
// The pack check run with one planted operator added, `planted.flash`, which flashes 4 times a second at its defaults
// (DEEP_CHROME_PLANT=flashes_4hz): the check fails with a refusal naming that operator, its measured rate (4 a second,
// within a quarter) and the limit of 3, and none of the 24 shipped operators is refused by it.
import { describe, expect, it } from 'vitest';
import { AC, packCheck, useBuild } from './helpers.ts';

const bin = useBuild('replica');

describe(`#1436 AC7 ${AC[7]} a planted effect flashing 4 times a second is refused, naming the rate`, () => {
  it('AC7 the pack check with planted.flash (DEEP_CHROME_PLANT=flashes_4hz) refuses it, naming its rate of 4 a second against 3', () => {
    const check = packCheck(bin(), undefined, 'flashes_4hz');
    expect(check.status, `the check with a flashing operator fails: ${JSON.stringify(check.refusals)}`).toBe(1);
    const refused = check.refusals.filter((r) => r['operator'] === 'planted.flash' && r['code'] === 'chrome_fx_flash_rate');
    expect(refused.length, `a refusal names the flashing operator: ${JSON.stringify(check.refusals)}`).toBe(1);
    expect(Math.abs((refused[0]!['rate'] as number) - 4), `the refusal names the rate, 4 a second: ${JSON.stringify(refused[0])}`).toBeLessThanOrEqual(0.25);
    expect(refused[0]!['limit'], 'against the limit of 3 a second').toBe(3);
    expect(check.refusals.filter((r) => r['operator'] !== 'planted.flash'), 'none of the shipped operators is refused').toEqual([]);
  }, 3_600_000);
});
