// #202.b0fcc31e: "shelf.bookcase@1 at levels 8 and width 3.0 m stays in class. A planted kind whose triangles grow with
// levels² exceeds its class at levels 8 and fails the kit, naming the param, the value and the cost. A planted kit that
// tests defaults only passes that kind and fails this test"
//
// asserts: in `r1,test-weight`, deep_kinds lists shelf.bookcase@1's kit result PASS with its cost part PASS, and its
// cost.at_extremes beside its cost at defaults, holding the largest item count over its hard-range ends (11: 2 sides, 8
// boards, 1 divider at levels 8) and a triangle count; acme/tower@1.0.0's tower.stack@1, which makes levels² items of
// test.weight@1 (in class at its default levels 2, 64 items and 12.8 ms of CPU at levels 8), is refused at its pack
// check with an error naming levels, 8 and a cost of at least 12.8. Under `planted: "kit_tests_defaults_only"` the
// tower installs, and this check fails naming tower.stack@1.
// Wrong programs: the planted kit (named) and the levels² kind; the merge base (no test-weight feature; shelf refused).

import { expect, it } from 'vitest';
import {
  BOOKCASE, PACKS, SHELF, TOWER, WEIGHT, extremesFailures, failsNaming, kindEntry, kitOf, listed, none, num, obj, packRow, run, scenario, show,
  useBuilds, useEvidence, type PackRow,
} from './helpers.ts';

const builds = useBuilds([WEIGHT]);
const evidence = useEvidence();
const STACK = 'tower.stack@1';
/** 64 test.weight@1 items at levels 8, each 0.20 ms of CPU. */
const COST_AT_8 = 12.8;

const towerRow = (planted?: string): PackRow =>
  packRow(run(builds.bin(WEIGHT), scenario(evidence(), [PACKS], { packs: [SHELF, TOWER], planted }))[0]!, TOWER);

it('#202.b0fcc31e shelf.bookcase@1 at levels 8 and width 3.0 m stays in class, and a kind whose triangles grow with levels² exceeds its class at levels 8 and fails the kit naming the param, the value and the cost', () => {
  const entry = listed(kindEntry(builds.bin(WEIGHT), evidence(), BOOKCASE, { packs: [SHELF] }), BOOKCASE);
  const kit = kitOf(entry, BOOKCASE);
  expect([kit.verdict, kit.parts['cost']], `shelf.bookcase@1's kit and its cost part pass at its hard-range ends: ${show(kit.raw)}`).toEqual(['PASS', 'PASS']);
  const cost = obj(entry['cost'], `${BOOKCASE}'s cost`);
  obj(cost['at_defaults'], `${BOOKCASE}'s cost.at_defaults`);
  const extremes = obj(cost['at_extremes'], `${BOOKCASE}'s cost.at_extremes, beside its cost at defaults`);
  expect(num(extremes['items'], 'cost.at_extremes.items'), 'the largest item count over the ends: 2 sides, 8 boards and 1 divider at levels 8').toBe(11);
  expect(num(extremes['triangles'], 'cost.at_extremes.triangles'), 'and the largest triangle count').toBeGreaterThanOrEqual(0);
  none(extremesFailures(towerRow(), TOWER, STACK, 'levels', 8, COST_AT_8), 'the kind whose triangles grow with levels²');
}, 1_800_000);

it('#202.b0fcc31e a planted kit that tests defaults only passes the levels² kind and fails this test', () => {
  failsNaming(extremesFailures(towerRow('kit_tests_defaults_only'), TOWER, STACK, 'levels', 8, COST_AT_8), [STACK], 'the kit that tests defaults only');
}, 1_800_000);
