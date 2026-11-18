// #2331, its second criterion: for every minute of a week across a daylight-saving change, in three time zones,
// `when` (packages/hub/src/list.ts) returns what it returns today, kit.ts's oracle built from the base's own expressions.
// `clock` isn't exported: every minute's `when(at, at)` is "at " and `clock(at)`, and every other `when` holds `clock(at)`
// too, so each comparison reads both. Each zone is set in this process (TZ) and list.ts is imported afresh under it.
// It passes at the base by design; judges.test.ts holds the comparison to wrong programs (README).
import { describe, expect, test, vi } from 'vitest';
import { compare, ID, inZone, OFFSETS, oracleWhen, WEEK_MINUTES, WEEKS } from './kit.ts';

describe(ID.text, () => {
  for (const week of WEEKS) {
    test(`${ID.text}: in ${week.zone}, ${week.what}, when and so clock return today's text for every minute of the week`, async () => {
      await inZone(week, async () => {
        vi.resetModules();
        const { when } = await import('../../../packages/hub/src/list.ts');
        const r = compare(week, (at, now) => when(at, now), oracleWhen());
        expect(r.checked, 'every minute of the week, with at at each offset from it').toBe(WEEK_MINUTES * OFFSETS.length);
        expect(r.mismatches, `${r.total} of ${r.checked} texts differ from today's in ${week.zone}; the first of them`).toEqual([]);
      });
    }, 600_000);
  }
});
