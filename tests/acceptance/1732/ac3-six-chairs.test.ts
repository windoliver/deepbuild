// AC3: "Asking for six chairs `next_to` a 1.2 m table, where only four fit, is refused at check, naming the relation
// missed and its shortfall in m."

import { describe, expect, it } from 'vitest';
import { AC, DOC, MM, SIX, TIMEOUT, arr, isObject, issuesOf, runShow, scenario, show, shown, sixChairsDoc, useDir, useShow } from './helpers.ts';

const bin = useShow();
const dir = useDir();
const chairs: readonly string[] = SIX;

describe(`${AC[3]} six chairs next_to a 1.2 m table, where only four fit, are refused at check`, () => {
  it(`${AC[3]} the revision is refused with arrange_unsatisfied, naming a chair's next_to table relation and its shortfall in m`, () => {
    const [reply] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, sixChairsDoc())]));
    expect(reply!['outcome'], `the revision is refused at check, never placed half right: ${shown(reply)}`).toBe('refused');
    const refusal = issuesOf(reply!).find((i) => i.severity === 'error' && i.code === 'arrange_unsatisfied');
    expect(refusal, `an error issue arrange_unsatisfied: ${shown(reply)}`).toBeDefined();
    const missed = arr(refusal!.raw['missed'], 'the refusal\'s missed relations').filter(isObject);
    const named = missed.filter((m) => m['rel'] === 'next_to' && m['b'] === 'table' && chairs.includes(String(m['a'])));
    expect(named.length, `the refusal names a chair's next_to table relation: ${shown(refusal!.raw)}`).toBeGreaterThan(0);
    for (const m of named) {
      expect(typeof m['by'] === 'number' && Number.isFinite(m['by']) && m['by'] > MM, `${String(m['a'])} next_to table names its shortfall in m, past the 1 mm it is held to: ${shown(m)}`).toBe(true);
    }
  }, TIMEOUT);
});
