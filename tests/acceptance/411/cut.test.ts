// AC10: deep_query of a 5,000-item city under a 400-row cap returns rows whose parents are all present, each with
// `children_total`, and a coverage block that names the cut; a planted cut by row order returns lamp posts whose
// block was cut and fails, naming the first row without its parent.
//
// The city is 125 blocks (group@1) of 39 lamp posts (rect@1) each, 5,000 items; every lamp post's ID sorts before
// every block's, and the document lists the lamp posts first, so a cut by row order keeps lamp posts and no block.
import { describe, expect, it } from 'vitest';
import {
  BLOCKS, DOC, FULL, LAMPS_PER_BLOCK, blockId, city, cityTree, cutFailures, failsNaming, lampId, none, parentFailures, presented, query, rows, run, scenario, show, useBuilds, useEvidence,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();
const CAP = 400;

function cut(planted?: string) {
  const [shown, reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: null }, [
    show(DOC.a, city(), { size: [1000, 200] }),
    query(DOC.a, { cap: CAP }),
  ], planted ? { planted } : {}));
  presented(shown!, 'the city');
  return reply!;
}

describe('AC10 a deep_query answer cut to fit its budget is cut depth first, so every row it keeps has its parent', () => {
  it('AC10 the 5,000-item city under a 400-row cap keeps every row\'s parent, counts each row\'s children and names the cut', () => {
    expect(BLOCKS * (LAMPS_PER_BLOCK + 1), 'the city holds 5,000 items').toBe(5000);
    const reply = cut();
    const kept = rows(reply);
    expect(kept.length, 'rows are kept, up to the cap').toBeGreaterThan(0);
    none(parentFailures(kept), 'every kept row has its parent');
    none(cutFailures(reply, cityTree(), CAP), 'each row\'s children_total and the coverage block\'s cut');
  });

  it('AC10 a planted cut by row order keeps lamp posts whose block was cut and fails, naming the first row without its parent', () => {
    const kept = rows(cut('cuts_by_row_order'));
    const failures = parentFailures(kept);
    failsNaming(failures, [lampId(0, 0)], 'a cut by row order');
    expect(failures[0], 'the first row without its parent is named first').toContain(`row ${lampId(0, 0)} is kept without its parent ${blockId(0)}`);
  });
});
