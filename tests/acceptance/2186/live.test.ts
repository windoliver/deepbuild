// #2186 AC3: a `live` session opened on the scene, its frame 1 captured, is within 2 levels of `view3d`'s frame 0 of
// the same document at every pixel. README: Criteria to tests.

import { describe, it } from 'vitest';
import {
  expectWithin, liveCall, liveFinal, payload, readFinal, requireMetal, run, sessionDoc, useBuild, useOut, view3dCall,
  view3dFinal, writeDoc,
} from './helpers.ts';

const TIMEOUT = 600_000;
const AC3 = '#2186.b9ad6749 AC3';

describe('#2186 a live session\'s first frame draws the shadow maps its warm-up never drew', () => {
  const build = useBuild();
  const out = useOut();

  it(`${AC3} a live session on the scene, its frame 1 captured, is within 2 levels of view3d's frame 0 at every pixel (the base reads 0 at the subject's centre)`, () => {
    requireMetal();
    const bin = build();
    const dir = out();
    const [v] = run(bin, dir, [view3dCall(writeDoc(dir, 'session', sessionDoc()))]);
    const theirs = readFinal(dir, view3dFinal(v!), "view3d's frame 0 final");
    const [l] = run(bin, dir, [liveCall(writeDoc(dir, 'payload', payload()))]);
    const ours = readFinal(dir, liveFinal(l!), "the live session's frame 1 final");
    expectWithin(AC3, 'live frame 1', ours, theirs);
  }, TIMEOUT);
});
