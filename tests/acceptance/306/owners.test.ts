// AC7: "A document whose packs name alice/foley@1.0.0 and bob/foley@1.0.0 is refused at check, naming both
// IDs; with only bob/foley@1.0.0 it checks and its entry foley.tap resolves through bob's pack; a planted
// check that keys packs by name alone resolves foley.tap through the first pack listed and fails, naming
// the entry"
//
// asserts: in the build without scene3d, with alice/foley@1.0.0 and bob/foley@1.0.0 both installed (alice's
// first), a board whose packs name both, with t1 of kind foley.tap@1, is refused with an error naming both
// IDs, no snapshot, its check BLOCKED or FAIL (never PASS); a board naming only bob/foley@1.0.0 is
// presented and t1's expansion came through bob/foley@1.0.0 (`resolutionFailures`), its two taps bob's
// recipe makes; `packs_keyed_by_name` fails `resolutionFailures` naming foley.tap.

import { describe, expect, it } from 'vitest';
import {
  ALICE_FOLEY, BOB_FOLEY, DOC, R1, board, check, errors, expansionOf, failsNaming, instance, issues, names, none, outcome, packAt, resolutionFailures, run, scenario, show,
  snapshots, sorted, useBuilds, useEvidence, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([R1]);
const evidence = useEvidence();
const tap = instance('t1', 'foley.tap@1', { size: 10 }, 'a0', [60, 60]);
const both = board('Two foleys', [packAt(ALICE_FOLEY), packAt(BOB_FOLEY)], [tap]);
const bobs = board('Bob\'s foley', [packAt(BOB_FOLEY)], [tap]);

function play(planted?: string): JsonObject[] {
  return run(builds.bin(R1), scenario(evidence(), { [DOC.a]: 'main', [DOC.b]: 'main', [DOC.c]: 'main' }, [ALICE_FOLEY, BOB_FOLEY], [
    show(both, { pixels: true }),
    check(both, { doc: DOC.b }),
    show(bobs, { pixels: true, doc: DOC.c }),
  ], planted ? { planted } : {}));
}

describe('AC7 a document names at most one pack of a name, and an entry resolves through that pack', () => {
  it('AC7 naming alice/foley@1.0.0 and bob/foley@1.0.0 is refused naming both IDs; naming only bob\'s, foley.tap resolves through bob\'s pack', () => {
    const [two, checked, one] = play();
    expect(outcome(two!), 'the board naming two packs of one name is refused').toBe('refused');
    expect(snapshots(two!).length, 'and not drawn').toBe(0);
    const naming = errors(issues(two!)).filter((i) => names(i, packAt(ALICE_FOLEY)) && names(i, packAt(BOB_FOLEY)));
    expect(naming.length, `an error names both ${packAt(ALICE_FOLEY)} and ${packAt(BOB_FOLEY)}: ${JSON.stringify(two!['issues']).slice(0, 800)}`).toBeGreaterThan(0);
    expect(checked!['result'], 'its check does not pass').not.toBe('PASS');
    expect(outcome(one!), `the board naming only bob's pack is presented: ${JSON.stringify(one!['issues']).slice(0, 600)}`).toBe('presented');
    none(resolutionFailures(one!, 't1', 'foley.tap', BOB_FOLEY), 'the resolution of foley.tap');
    expect(sorted(Object.keys(expansionOf(one!, 't1').derived)), 't1 expands into the two taps bob\'s recipe makes').toEqual(['t1.tap.0', 't1.tap.1']);
  });

  it('AC7 a planted check that keys packs by name alone resolves foley.tap through the first pack listed and fails this check, naming the entry', () => {
    const [, , one] = play('packs_keyed_by_name');
    failsNaming(resolutionFailures(one!, 't1', 'foley.tap', BOB_FOLEY), ['foley.tap'], 'the check that keys packs by name alone');
  });
});
