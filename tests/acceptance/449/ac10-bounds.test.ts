// AC10: "On the emit-region, bounce and turbulence fixtures, every live particle lies inside the item's closed-form
// bounds at 1,000 random times, and a view that culls by those bounds draws the same pixels as one that doesn't; a
// planted bound taken from the emit region alone lets a ballistic particle leave it and fails, naming the item and the
// time"
//
// The three fixtures: emit regions, the parity film (helpers.ts: emitShapes) with each burst cut to 64 particles so
// 1,000 times stay readable; bounce, the sparks (sparksDoc); turbulence, the smoke at strength 0.3 m (smokeDoc). The
// `particles` call reads every item's CPU f64 positions and its bounds at 1,000 random times over each fixture's span:
// every live particle must lie inside the bounds (within 1e-9 m), and an item with live particles must have bounds.
// Culling: each fixture with a camera that pans 40 m along +x over its first second and holds (a channel on its
// position and target), drawn by `view3d` at 30 fps for 2 s twice, culling by the bounds (as shipped) and with
// `particle_cull: "none"`; every frame's pixel hash must be the same in both. Guards: the culling view culls some item
// with live particles in some frame and draws some item with live particles in another, and the other view culls none.
// The planted `bounds_emit_region_only` (README: Planted programs) fails the containment check on the sparks, naming the
// item and the time.

import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, ac, clone, emitShapes, failsNaming, framesOf, isObject, none, obj, outsideBounds, particleIds, particlesCall, passed,
  randomFlicks, reading, requireGpu, runGpu, smokeDoc, sparksDoc, useBins, useDir, view3d, withBursts, writeJson,
  type JsonObject, type Planted,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const FIXTURES: { name: string; doc: () => JsonObject; span: number }[] = [
  { name: 'emit regions', doc: () => withBursts(emitShapes(), 64), span: 4 },
  { name: 'bounce', doc: () => sparksDoc(), span: 3 },
  { name: 'turbulence', doc: () => smokeDoc({ strength: 0.3, seed: 1 }), span: 4 },
];

function containment(f: (typeof FIXTURES)[number], planted?: Planted): string[] {
  const doc = f.doc();
  const call = particlesCall({ doc: writeJson(dir(), 'fixture.json', doc), t: randomFlicks(4510, 1000, 0, f.span), bounds: true });
  const [reply] = runGpu(bins.bin('deep-gpu'), dir(), [call], { backend: 'noop', ...(planted ? { planted } : {}) });
  const c = passed(reply!, call, f.name);
  return particleIds(doc).flatMap((id) => outsideBounds(reading(c, id, `${f.name}: ${id}`)));
}

/** The fixture with its camera panning 40 m along +x over the first second, then holding. */
function panned(doc: JsonObject): JsonObject {
  const out = clone(doc);
  const cam = obj(obj(obj(out['items'], 'items')['cam'], 'cam')['params'], 'cam.params');
  const x0 = (cam['position'] as number[])[0]!;
  const t0 = (cam['target'] as number[])[0]!;
  const keys = (x: number): JsonObject => ({ k0: { t: '0s', value: x, interp: 'linear' }, k1: { t: '1s', value: x + 40, interp: 'hold' } });
  out['channels'] = {
    ...(isObject(out['channels']) ? out['channels'] : {}),
    pan_eye: { target: 'items/cam/params/position/0', type: 'f32', keys: keys(x0) },
    pan_aim: { target: 'items/cam/params/target/0', type: 'f32', keys: keys(t0) },
  };
  return out;
}

describe(`${ac(10)} every live particle lies inside its item's closed-form bounds, and culling by them changes no pixel`, () => {
  for (const f of FIXTURES) {
    it(`${ac(10)} (${f.name}) every live particle lies inside its item's bounds at 1,000 random times`, () => {
      none(containment(f), `${f.name}: live particles against their bounds`);
    }, TIMEOUT);
  }

  it(`${ac(10)} (culling) on the three fixtures a view that culls by the bounds draws the same pixels as one that doesn't`, () => {
    requireGpu();
    const fails: string[] = [];
    for (const f of FIXTURES) {
      const doc = panned(f.doc());
      const ids = particleIds(doc);
      const path = writeJson(dir(), 'panned.json', doc);
      const spec = { doc: path, fps: 30, from: 0, frames: 61, particles: ids };
      const [culled, whole] = runGpu(bins.bin('deep-gpu'), dir(), [view3d(spec), view3d({ ...spec, particle_cull: 'none' })]);
      const a = framesOf(culled!, `${f.name}, culled by bounds`, ids);
      const b = framesOf(whole!, `${f.name}, not culled`, ids);
      expect(a.map((x) => x.frame), `${f.name}: both views draw frames 0 to 60`).toEqual(b.map((x) => x.frame));
      a.forEach((fa, k) => {
        const fb = b[k]!;
        expect(fa.pixelHash, `${f.name}: frame ${fa.frame} has a pixel hash`).not.toBeNull();
        if (fa.pixelHash !== fb.pixelHash) fails.push(`${f.name}: frame ${fa.frame} draws ${fa.pixelHash?.slice(0, 12)} culled by bounds and ${fb.pixelHash?.slice(0, 12)} without (culled: ${[...fa.particles].filter(([, p]) => p.culled).map(([id]) => id).join(', ') || 'none'})`);
      });
      const cases = a.flatMap((x) => [...x.particles.values()]).filter((p) => p.live > 0);
      expect(cases.some((p) => p.culled), `${f.name}: the culling view culls some item with live particles once the camera pans away`).toBe(true);
      expect(cases.some((p) => !p.culled), `${f.name}: the culling view draws some item with live particles`).toBe(true);
      expect(b.every((x) => [...x.particles.values()].every((p) => !p.culled)), `${f.name}: with particle_cull none no item is culled`).toBe(true);
    }
    none(fails, 'culled against unculled pixels');
  }, TIMEOUT);

  it(`${ac(10)} (planted) a bound taken from the emit region alone lets a ballistic spark leave it and fails, naming the item and the time`, () => {
    failsNaming(containment(FIXTURES[1]!, 'bounds_emit_region_only'), ['sparks at t = '], 'the planted bounds_emit_region_only');
  }, TIMEOUT);
});
