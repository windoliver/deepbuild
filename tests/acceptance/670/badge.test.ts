import { describe, expect, it } from 'vitest';
import { REVISIONS, errors, keepProof, outcome, revisions, run, scenario, show, snapshots, useEvidence, useShowBinary, LITERAL_BADGE } from './helpers.ts';

useShowBinary();
const evidence = useEvidence();

describe('AC4 a literal status color written on the badge, not through a verdict binding, is refused, naming the badge', () => {
  it('AC4 the figure with the badge painted status.pass and no verdict binding is refused with status_color_unbound naming the badge', () => {
    const doc = LITERAL_BADGE;
    const replies = run(scenario(evidence(), [show(doc, '0s'), REVISIONS]));
    const [refused, state] = replies as [typeof replies[0], typeof replies[0]];
    keepProof('ac4-literal-badge-figure', doc);
    keepProof('ac4-literal-badge-reply', refused);
    expect(outcome(refused), 'the figure with a literal status color on the badge is refused').toBe('refused');
    // The code is #392's for a status color taken from anything but a status binding. A check that
    // lets a literal through, or refuses the figure only for something else, fails here. (The
    // figure as it is, with the badge's verdict binding, is presented: AC1.)
    const naming = errors(refused).filter((i) => i.code === 'status_color_unbound' && i.ids.includes('badge'));
    expect(naming.length, `a status_color_unbound error names the badge; the errors were ${JSON.stringify(errors(refused).map((i) => [i.code, i.ids, i.path]))}`).toBeGreaterThan(0);
    expect(snapshots(refused), 'render-back returns no snapshot of a refused revision').toEqual([]);
    expect(revisions(state).filter((r) => r.state === 'current'), 'no revision is current').toEqual([]);
  }, 120_000);
});
