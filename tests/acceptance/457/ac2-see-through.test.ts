// #457.a2efe6ef: "A pane with transmission 0.9, a banner with alpha_mode blend and a beam with alpha_mode add in front
// of a kept item hide none of its points, and a pillar listed in the check input's except doesn't count as an
// occluder; a planted check that counts the add beam as an occluder fails, naming the beam"
//
// Fixture (helpers.ts `gallery`): the kept statue (1 × 2 × 0.4 m) 8 m in front of the camera; between them a pane of
// transmission 0.9 over its whole silhouette, a banner in alpha_mode blend over its upper part, a beam in alpha_mode
// add over about 75% of its surface by area, and an opaque pillar over about 19%, apart from the beam. The
// requirement is `{kind: camera.framing, keep: [statue], except: [pillar]}`.
//
// asserts:
//   - shipped: the row PASSes with nothing raised, and at every checked time the statue's occluded share is 0 with no
//     occluders: none of the pane, the banner, the beam or the excepted pillar hides a point;
//   - planted `occluders_count_add` (the scenario's `planted`: the check counts an alpha_mode add item as an
//     occluder): the same claim FAILs with a camera.framing error naming the statue whose occluders hold the beam.
// Wrong programs: the base (no occluded share, so no result to read); a check that counts glass, a blended or an added
// item, or ignores `except` (a share above 0, or an occluder named); the planted one.
import { describe, it } from 'vitest';
import {
  GALLERY_CHECK, TIMEOUT, brief, claimId, claimOn, docId, gallery, none, occludedFor, occludersOf, occlusionIssues, passFailures, proof, reqId,
  rowOf, run, scenarioOf, useBuilds, useFolders, verdict, type Row,
} from './helpers.ts';

const ID = '#457.a2efe6ef';
const builds = useBuilds();
const folder = useFolders();
const [DOC, CLAIM, REQ] = [docId(1), claimId(1), reqId(1)];
const judged = (planted?: string): Row => {
  const [v] = run(builds.debug(), scenarioOf(folder(), { [DOC]: gallery() }, { [CLAIM]: claimOn(DOC, [[REQ, GALLERY_CHECK]]) }, [verdict(CLAIM)], planted ? { planted } : {}));
  return rowOf(v!, REQ, planted ? `the statue under ${planted}` : 'the statue');
};

describe(`${ID} see-through items and an excepted pillar never occlude`, () => {
  it(`${ID} glass, a blended banner and an added beam hide none of the statue's points and the excepted pillar isn't an occluder; a planted check that counts the add beam fails, naming the beam`, () => {
    const row = judged();
    proof('statue row', row.raw);
    const failures = passFailures(row, 'the statue behind glass, a banner, a beam and an excepted pillar');
    for (const o of occludedFor(row, 'statue', 'the statue')) {
      if (o.share !== 0 || o.occluders.length > 0) failures.push(`the statue's occluded share reads ${o.share} behind ${o.occluders.join(', ') || 'nothing'}, not 0 behind nothing: ${brief(o.raw, 600)}`);
    }
    none(failures, 'the pane, the banner, the beam and the excepted pillar hide none of the statue');

    const planted = judged('occluders_count_add');
    proof('statue row under occluders_count_add', planted.raw);
    const naming = occlusionIssues(planted, 'statue').filter((i) => occludersOf(i).includes('beam'));
    none([
      ...(planted.result === 'FAIL' ? [] : [`under occluders_count_add the statue is ${planted.result}, not FAIL: ${brief(planted.raw)}`]),
      ...(naming.length > 0 ? [] : [`under occluders_count_add no camera.framing error names the statue with the beam among its occluders: ${brief(planted.raw['issues'] ?? null)}`]),
    ], 'the planted check that counts the add beam fails, naming the beam');
  }, TIMEOUT);
});
