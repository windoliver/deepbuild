import { describe, expect, it } from 'vitest';
import {
  AGENT, FIGURE, MARKER_IDS, REVISIONS, SCREEN, bands, current, diff, errors, keepProof, outcome, run, scenario, show, snapshots, useEvidence,
  useShowBinary, NO_MARKER, type JsonObject,
} from './helpers.ts';

useShowBinary();
const evidence = useEvidence();

describe('AC5 a whole revision that leaves the marker out without naming it in its removes is refused with unintended_removal, and the last good revision stays shown', () => {
  it('AC5 the figure re-sent without the marker and no removes is refused with unintended_removal naming the marker, and the last good revision stays current, on screen and drawn the same', () => {
    const doc = NO_MARKER;
    const replies = run(scenario(evidence(), [
      show(FIGURE, '1s'), REVISIONS, // the last good revision, with its snapshot at 1 s
      show(doc, '1s'), REVISIONS, SCREEN, // the marker left out, not in removes
      show(FIGURE, '1s'), // the figure again: diffed against what is current, and drawn
    ]));
    const [good, before, refused, after, screen, again] = replies as [JsonObject, JsonObject, JsonObject, JsonObject, JsonObject, JsonObject];
    keepProof('ac5-without-marker-figure', doc);
    keepProof('ac5-replies', replies);
    expect(outcome(good), `the figure is presented: ${JSON.stringify(good['issues'])?.slice(0, 1500)}`).toBe('presented');
    const goodSnap = snapshots(good)[0]?.sha256;
    expect(goodSnap, 'the good revision has a snapshot at 1 s').toBeDefined();
    const last = current(before);

    expect(outcome(refused), 'the revision that leaves the marker out without naming it is refused').toBe('refused');
    // A deep show that presents the revision, or refuses it for another reason, fails here.
    const named = errors(refused).filter((i) => i.code === 'unintended_removal').flatMap((i) => i.ids);
    expect(named, `an unintended_removal issue names the marker; the errors were ${JSON.stringify(errors(refused).map((i) => [i.code, i.ids]))}`).toContain('marker');
    expect(snapshots(refused), 'render-back returns no snapshot of the refused revision').toEqual([]);

    // The last good revision stays shown: still current by rev and hash, its layer still on screen,
    // and the figure re-sent finds the marker unchanged in it and draws the same picture.
    const now = current(after);
    expect([now.rev, now.hash], 'the last good revision stays current, by rev and hash').toEqual([last.rev, last.hash]);
    expect(bands(screen).filter((b) => b.band !== 'card').map((b) => [b.band, b.owner]), 'the agent\'s layer is still on screen')
      .toEqual([['agent', { kind: 'agent', id: AGENT.thread }]]);
    expect(outcome(again), 'the figure re-sent is presented').toBe('presented');
    const d = diff(again);
    for (const id of MARKER_IDS) {
      expect(d.unchanged, `${id} is unchanged against the current revision (it was never dropped)`).toContain(id);
      expect(d.created, `${id} is not created again`).not.toContain(id);
    }
    expect(snapshots(again)[0]?.sha256, 'the current revision draws at 1 s what the last good one drew').toBe(goodSnap);
  }, 120_000);

  it('AC5 the same revision with the marker named in its removes is presented, the marker listed as removed', () => {
    // A check that refuses every revision dropping an item would pass the test above; this one fails it.
    const replies = run(scenario(evidence(), [show(FIGURE, '1s'), show(NO_MARKER, '1s', { removes: MARKER_IDS })]));
    const named = replies[1]!;
    keepProof('ac5-named-removal-reply', named);
    expect(outcome(replies[0]!), `the figure is presented: ${JSON.stringify(replies[0]!['issues'])?.slice(0, 1500)}`).toBe('presented');
    expect(outcome(named), `the revision that names the marker in removes is presented: ${JSON.stringify(named['issues'])?.slice(0, 1500)}`).toBe('presented');
    expect(diff(named).removed, 'its reply lists the marker and its channel as removed').toEqual([...MARKER_IDS].sort());
  }, 120_000);
});
