import { describe, expect, it } from 'vitest';
import {
  AGENT, BOUND_BAR, FIGURE, REVISIONS, SCREEN, SNAP_SIZE, bands, current, errors, issues, keepProof, outcome, revisions, run, scenario,
  show, snapshots, useEvidence, useShowBinary, NO_BAR_SOURCE, type Issue,
} from './helpers.ts';

useShowBinary();
const evidence = useEvidence();

/** The issue names the bound bar: the row as picking names it, or its mark set with the row in the path or value it refuses. */
function namesBar(issue: Issue): boolean {
  if (issue.ids.includes(BOUND_BAR)) return true;
  return issue.ids.includes('chart') && JSON.stringify([issue.path ?? null, issue.actual ?? null]).includes(BOUND_BAR);
}

describe('AC1 the figure is presented with no issues; the same figure with the bound bar\'s source removed is refused, its issue naming the bar', () => {
  it('AC1 the figure, sent by deep show from a test process in the agent\'s tree as its own writer layer, is presented with no issues', () => {
    const replies = run(scenario(evidence(), [show(FIGURE, '0s'), REVISIONS, SCREEN]));
    const [shown, state, screen] = replies as [typeof replies[0], typeof replies[0], typeof replies[0]];
    keepProof('ac1-figure', FIGURE);
    keepProof('ac1-figure-reply', shown);
    // A check that refuses the figure for any issue (an unresolved row target, a channel's keys, a
    // mark set's stroke gradient) fails here, naming the issues.
    expect(issues(shown), 'the figure raises no issue of any severity').toEqual([]);
    expect(outcome(shown), 'the figure is presented').toBe('presented');
    const snaps = snapshots(shown);
    expect(snaps.map((s) => [s.w, s.h]), 'render-back returns one snapshot at the size asked for').toEqual([SNAP_SIZE]);
    // As its own writer layer: stamped as the agent whose process tree ran `deep show`, never as you.
    expect(current(state).writer, 'the revision is stamped as the test agent').toEqual({ kind: 'agent', id: AGENT.thread });
    expect(bands(screen).filter((b) => b.band !== 'card').map((b) => [b.band, b.owner]), 'one layer on screen, the agent\'s, in the agent band')
      .toEqual([['agent', { kind: 'agent', id: AGENT.thread }]]);
  }, 120_000);

  it('AC1 the same figure with the bound bar\'s source removed is refused, its issue naming the bar', () => {
    const doc = NO_BAR_SOURCE;
    const replies = run(scenario(evidence(), [show(doc, '0s'), REVISIONS]));
    const [refused, state] = replies as [typeof replies[0], typeof replies[0]];
    keepProof('ac1-no-source-figure', doc);
    keepProof('ac1-no-source-reply', refused);
    expect(outcome(refused), 'the figure whose bound bar has no source is refused').toBe('refused');
    // A check that names only the bound value entry, and not the bar it fills, fails here.
    const naming = errors(refused).filter(namesBar);
    expect(naming.length, `an error names the bound bar ${BOUND_BAR}; the errors were ${JSON.stringify(errors(refused).map((i) => [i.code, i.ids, i.path]))}`).toBeGreaterThan(0);
    expect(snapshots(refused), 'render-back returns no snapshot of a refused revision').toEqual([]);
    expect(revisions(state).filter((r) => r.state === 'current'), 'no revision is current').toEqual([]);
  }, 120_000);
});
