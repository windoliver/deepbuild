// #2186 AC1 and AC2: `deep-gpu run`'s `canonical` call (render_back, frame 1, final, 320 × 240) draws the scene within
// 2 levels of `view3d`'s frame 0 of the same document at every pixel, with all three lights' shadows on (AC1) and
// with each one's shadow off in turn (AC2). README: Criteria to tests.

import { describe, it } from 'vitest';
import {
  canonicalCall, canonicalFinal, expectWithin, LIGHTS, payload, readFinal, requireMetal, run, sessionDoc, useBuild,
  useOut, view3dCall, view3dFinal, writeDoc, type Light,
} from './helpers.ts';

const TIMEOUT = 600_000;
const AC1 = '#2186.540fbb6b AC1';
const AC2 = '#2186.f9f118b5 AC2';

describe('#2186 the canonical render draws the shadow maps its warm-up never drew', () => {
  const build = useBuild();
  const out = useOut();

  /** The `canonical` final and view3d's frame 0 final of the scene, `off`'s shadow false when given, each in its own process. */
  function compare(criterion: string, off?: Light): void {
    requireMetal();
    const bin = build();
    const dir = out();
    const name = off ? `${off}-off` : 'all-on';
    const [v] = run(bin, dir, [view3dCall(writeDoc(dir, `session-${name}`, sessionDoc(off)))]);
    const theirs = readFinal(dir, view3dFinal(v!), `view3d's frame 0 final (${name})`);
    const [c] = run(bin, dir, [canonicalCall(writeDoc(dir, `payload-${name}`, payload(off)))]);
    const ours = readFinal(dir, canonicalFinal(c!), `the canonical final (${name})`);
    expectWithin(off ? `${criterion} (${off}'s shadow off)` : criterion, 'canonical', ours, theirs);
  }

  it(`${AC1} canonical render_back of frame 1 under a shadowed key sun and two shadowed spots is within 2 levels of view3d's frame 0 at every pixel (the base reads 0 at the subject's centre, view3d 106)`, () => {
    compare(AC1);
  }, TIMEOUT);

  for (const light of LIGHTS) {
    it(`${AC2} with ${light}'s shadow set to false, the canonical final is within 2 levels of view3d's frame 0 at every pixel (the base reads ${light === 'key' ? '137 at the subject\'s centre, view3d 168' : '75–76 at the subject\'s centre, view3d 106'})`, () => {
      compare(AC2, light);
    }, TIMEOUT);
  }
});
