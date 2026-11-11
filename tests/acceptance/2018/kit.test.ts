// AC1 #2018.b912741a: a replacement sidebar whose row reads "done" for a stop with no verdict yet, or shows a count
// other than the hub's, fails `session.row@1` at install, naming the row. The kit runs as `deep install` runs a view's
// kit, in the replica, on the kit's own fixture record: `deep-replica --view-kit session.row@1 <dir>` (README, Pinned 1).
// The views are fixtures/views. Each wrong view is run again with every row the kit named drawn right, until the kit
// passes it: a kit that names a row the view drew right names it again, so each name is a row that was wrong.
import { describe, expect, test } from 'vitest';
import { ID, namedUntilPass, none, viewKit } from './helpers.ts';

const MIN = 60_000;

describe(ID.kit, () => {
  test(`${ID.kit}: a replacement sidebar that draws each row's state's words and the hub's counts passes session.row@1`, () => {
    const kit = viewKit('rows-right');
    expect(kit.verdict, `deep-replica --view-kit session.row@1 gives one JSON verdict line: ${kit.said}`).toEqual({ result: 'pass' });
    expect(kit.code, 'a passing kit exits 0').toBe(0);
  }, 30 * MIN);

  test(`${ID.kit}: a replacement sidebar whose row reads "done" for a stop with no verdict yet fails session.row@1 at install, naming the row`, () => {
    const { named, failures } = namedUntilPass((skip) => viewKit('rows-done', skip));
    console.log(`rows-done: the kit named ${JSON.stringify(named)}`);
    none(failures, 'the kit, run again with each row it named drawn right');
    expect(named.length, 'session.row@1 passed a sidebar that reads "done" wherever a row\'s words hold "says done": it must fail naming that row, and its fixture record must hold a stop with no verdict yet (README, Pinned 1)').toBeGreaterThan(0);
  }, 30 * MIN);

  test(`${ID.kit}: a replacement sidebar that shows a count other than the hub's fails session.row@1 at install, naming the row`, () => {
    const { named, failures } = namedUntilPass((skip) => viewKit('rows-count', skip));
    console.log(`rows-count: the kit named ${JSON.stringify(named)}`);
    none(failures, 'the kit, run again with each row it named drawn right');
    expect(named.length, 'session.row@1 passed a sidebar whose every row shows one more than the hub\'s count of its open asks: it must fail naming the row (README, Pinned 1)').toBeGreaterThan(0);
  }, 30 * MIN);
});
