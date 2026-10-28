// AC1, second sentence: "In a replica, the figure's accessibility tree read as data has one node per part and
// control with its name and role; changing a readout from 3 to 4 emits exactly one announcement with '4', and
// redrawing an unchanged readout emits none; a tree that announces every frame fails, naming the readout."
//
// asserts: on the virtual display clock alpha shows the figure with its readout at 3 (0 s), redraws it with a
// part moved and the readout unchanged (10 s), then changes the readout to 4 (20 s); the panel presents a frame
// of the unchanged redraw. The replica's `see` at 30 s gives a tree with exactly one node for each of the parts
// `beam`, `lens`, `screen` and the controls `c-rays`, `c-labels`, each with the document's name (a control's
// `label`) and role (`treeFailures`), and its announcements hold none between 10 s and 20 s and exactly one
// from 20 s to 30 s, naming the readout `count`, its text holding "4" (`announcementFailures`). The planted
// `announces_every_frame` fails `announcementFailures`, naming `count`.

import { describe, expect, it } from 'vitest';
import {
  FLICKS, READOUT, announcementFailures, announcements, failsNaming, frames, none, outcome, presented, run, scenario, see, show,
  tree, treeFailures, useEvidence, useShow, withBeamMoved, withCount,
  type JsonObject,
} from './helpers.ts';

const bin = useShow();
const evidence = useEvidence();

const REDRAWN = 10 * FLICKS;
const CHANGED = 20 * FLICKS;
const SEEN = 30 * FLICKS;

function play(planted?: string): { see: JsonObject; presented: JsonObject } {
  const replies = run(bin(), scenario(evidence(), [
    show(withCount(3), 0),
    show(withBeamMoved(40, 3), REDRAWN),
    show(withCount(4), CHANGED),
    presented(SEEN),
    see(SEEN),
  ], planted ? { planted } : {}));
  for (const [i, when] of ['0 s, the readout at 3', '10 s, a part moved and the readout unchanged', '20 s, the readout at 4'].entries()) {
    expect(outcome(replies[i]!), `the figure's revision at ${when} is presented: ${JSON.stringify(replies[i]).slice(0, 1200)}`).toBe('presented');
  }
  return { presented: replies[3]!, see: replies[4]! };
}

describe("AC1 in a replica the figure's accessibility tree and its announcements are data", () => {
  it('AC1 the tree has one node per part and control, with its name and role', () => {
    const { see: seen } = play();
    none(treeFailures(tree(seen), withCount(4)), "the figure's accessibility tree");
  });

  it("AC1 changing the readout from 3 to 4 emits exactly one announcement with '4', and redrawing it unchanged emits none", () => {
    const { see: seen, presented: shown } = play();
    const redraws = frames(shown).filter((f) => f.vsync >= REDRAWN && f.vsync < CHANGED);
    expect(redraws.length, `the panel presents the redraw with the readout unchanged between 10 s and 20 s: ${JSON.stringify(frames(shown))}`).toBeGreaterThanOrEqual(1);
    none(announcementFailures(announcements(seen), READOUT, '4', REDRAWN, CHANGED, SEEN), "the readout's announcements");
  });

  it('AC1 a planted tree that announces every frame fails this check, naming the readout', () => {
    const { see: seen } = play('announces_every_frame');
    failsNaming(announcementFailures(announcements(seen), READOUT, '4', REDRAWN, CHANGED, SEEN), [READOUT], 'the tree that announces every frame');
  });
});
