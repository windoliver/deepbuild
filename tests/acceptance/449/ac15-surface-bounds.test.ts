// AC15: "Every live particle lies inside the item's closed-form bounds at 1,000 random times on both fixtures; a planted
// bound taken from the bind pose alone lets a particle leave it and fails"
//
// The surface fixtures (helpers.ts): the cube and the sphere (shapesDoc) and the walker (walkerDoc), each cut to 256
// particles so 1,000 times stay readable, and the turntable (turntableDoc) as criterion 14 reads it; "both fixtures"
// doesn't say which two of the three surface fixtures it means, so every one is read (README: Criteria 12 to 16). The
// `particles` call reads every row's CPU f64 position and the item's bounds at 1,000 random times over each fixture's
// span: every live particle must lie inside the bounds (within 1e-9 m), an item with live particles must have bounds,
// and particles must be live at more than half the times. The planted `bounds_bind_pose` (README: Criteria 12 to 16)
// lets a particle on the walker's swinging limbs leave the walker's bind-pose bounds, and fails, naming the item and the
// time.

import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, TURN, WALKER, acSurface, failsNaming, liveRows, none, outsideBounds, particlesCall, passed, randomFlicks, reading,
  runGpuSurface, shapesDoc, turntableDoc, useBins, useDir, walkerDoc, writeJson, type JsonObject, type SurfacePlanted,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const FIXTURES: { name: string; doc: () => JsonObject; item: string; span: number }[] = [
  { name: 'cube and sphere', doc: () => shapesDoc(256), item: 'grit', span: 2 },
  { name: 'walker', doc: () => walkerDoc(256), item: 'dust', span: WALKER.span },
  { name: 'turntable', doc: () => turntableDoc(), item: 'sparks', span: TURN.span },
];

function containment(f: (typeof FIXTURES)[number], planted?: SurfacePlanted): string[] {
  const call = particlesCall({ doc: writeJson(dir(), 'fixture.json', f.doc()), t: randomFlicks(4515, 1000, 0, f.span), bounds: true });
  const [reply] = runGpuSurface(bins.bin('deep-gpu'), dir(), [call], { backend: 'noop', ...(planted ? { planted } : {}) });
  const r = reading(passed(reply!, call, f.name), f.item, f.name);
  expect(r.at.filter((s) => liveRows(s.cpu).length > 0).length, `${f.name}: particles are live at more than half the times read`).toBeGreaterThan(500);
  return outsideBounds(r);
}

describe(`${acSurface(15)} every live particle of a surface emitter lies inside its item's closed-form bounds`, () => {
  for (const f of FIXTURES) {
    it(`${acSurface(15)} (${f.name}) every live particle lies inside its item's bounds at 1,000 random times`, () => {
      none(containment(f), `${f.name}: live particles against their bounds`);
    }, TIMEOUT);
  }

  it(`${acSurface(15)} (planted) a bound taken from the bind pose alone lets a particle on the walker leave it and fails`, () => {
    failsNaming(containment(FIXTURES[1]!, 'bounds_bind_pose'), ['dust at t = '], 'the planted bounds_bind_pose');
  }, TIMEOUT);
});
