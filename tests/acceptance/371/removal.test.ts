// AC5: "A board revision that keeps all 14 items but leaves out two of its three controls and one bound value
// without naming them is refused with unintended_removal naming those three IDs; a planted diff over the
// items map alone presents it and fails, naming the three"
//
// asserts: `fixtures/board14.json` (14 items, controls c-week, c-team, c-scale, bound value bv-total) is
// presented; the re-send with all 14 items, c-week only and no bound value, with no `removes`, is refused, the
// `unintended_removal` issues naming exactly c-team, c-scale and bv-total, and the 14-item revision stays
// current by rev and hash (`removalFailures`); with the three in `removes` it is presented, listing them as
// removed. The planted `diffs_items_only` presents the re-send, so `removalFailures` fails, naming all three.

import { describe, expect, it } from 'vitest';
import {
  ALPHA, DOC, FULL, clone, current, failsNaming, fixture, none, outcome, reading, removalFailures, run, scenario, show, sorted, strs, useBuilds, useEvidence,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

const FULL_BOARD = fixture('board14.json');
const DROPPED = ['bv-total', 'c-scale', 'c-team'];
/** All 14 items, one control of three, and no bound value. */
function cut(): JsonObject {
  const doc = clone(FULL_BOARD);
  const controls = doc['controls'] as JsonObject;
  delete controls['c-team'];
  delete controls['c-scale'];
  delete doc['bound_values'];
  return doc;
}
/** The reading the count is bound to belongs to alpha's session, so alpha can read it. */
const RECORD: JsonObject = { [reading(1)]: { session: ALPHA.id, value: 42 } };

function threeCalls(extra: JsonObject = {}): JsonObject[] {
  return [
    show(ALPHA.id, DOC.a, FULL_BOARD),
    { call: 'revisions', doc: DOC.a },
    show(ALPHA.id, DOC.a, cut(), extra),
    { call: 'revisions', doc: DOC.a },
  ];
}

describe('AC5 a whole revision that leaves out controls and a bound value without naming them is refused with unintended_removal naming them', () => {
  it('AC5 the 14-item board re-sent without two of its three controls and its bound value, unnamed, is refused naming exactly those three IDs, and the full revision stays current', () => {
    const [first, before, reply, after] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: 'main' }, threeCalls(), { record: RECORD }));
    expect(outcome(first!), `the full board is presented: ${JSON.stringify(first).slice(0, 1500)}`).toBe('presented');
    expect(Object.keys(FULL_BOARD['items'] as JsonObject).length, 'the board has 14 items').toBe(14);
    expect(Object.keys((cut()['items'] as JsonObject)).length, 'the re-send keeps all 14').toBe(14);
    none(removalFailures(reply!, current(before!), current(after!), DROPPED), 'the re-send that drops c-team, c-scale and bv-total');
  });

  it('AC5 the same re-send naming the three in removes is presented, listing them as removed and the 14 items as unchanged', () => {
    const [, , reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: 'main' }, threeCalls({ removes: DROPPED }), { record: RECORD }));
    expect(outcome(reply!), `the re-send that names what it removes is presented: ${JSON.stringify(reply).slice(0, 1500)}`).toBe('presented');
    expect(sorted(strs(reply!['removed'], 'removed')), 'removed: the three named').toEqual(DROPPED);
    const unchanged = strs(reply!['unchanged'], 'unchanged');
    for (const id of [...Object.keys(FULL_BOARD['items'] as JsonObject), 'c-week']) expect(unchanged, `${id} is unchanged`).toContain(id);
  });

  it('AC5 a planted diff over the items map alone presents the re-send and fails this check, naming c-team, c-scale and bv-total', () => {
    const [, before, reply, after] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: 'main' }, threeCalls(), { record: RECORD, planted: 'diffs_items_only' }));
    expect(outcome(reply!), 'the planted diff presents the re-send').toBe('presented');
    failsNaming(removalFailures(reply!, current(before!), current(after!), DROPPED), DROPPED, 'the planted diff over the items map alone');
  });
});
