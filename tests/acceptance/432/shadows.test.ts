// AC6 #432.b107949f: A scene with a shadowed sun of 3 cascades, a shadowed spot and a shadowed point light, each over an
// opaque, a mask-alpha and an instanced caster, compiles every pipeline at check: its first frame creates no pipeline and
// reports no settling, counted on the noop lane and on the reference Mac; a planted warm-up that enumerates only the
// view's pipelines creates them in the first frame and fails, naming the shadow map and the caster.
//
// The scene (helpers: `shadowDoc`, `SHADOWS`): 640 × 360; a sun with `shadow: true, cascades: 3`; a spot 3 m up aimed
// straight down and a point lamp 2.5 m up, each `shadow: true`, with `light_policy.shadowed: {spots: 1, points: 1}`
// (#446); under all three, the opaque crate `crate`, the mask-alpha leaf card `leaf` and the instancer `pegs` of nine
// pegs (prototype `peg`), over a ground. `live` for 2 frames at 30 fps.
// - On the noop lane and then on Metal: from the session's first drawn frame on, no view row lists a created pipeline and
//   none reports `settled: false`. Off a reference Mac the Metal count is INCONCLUSIVE after it held.
// - `--planted warms_view_only` (noop lane): the first drawn frame lists created pipelines into shadow maps (a `target`
//   other than `view`), which between them name the crate, the leaf and the pegs (the instancer or its prototype); the
//   failure names each one's target and items.
// Wrong programs: a warm-up of the view's pipelines alone; one that misses a caster kind (mask's alpha test, an
// instancer's layout) in a shadow map.
import { describe, expect, it } from 'vitest';
import {
  AC, SHADOWS, WRITER, createdAt, firstDrawn, liveCall, liveReply, named, payload, requireGpu, requireReferenceMac, run1, shadowDoc, useBin, useOut,
  warmProblems, writeJson, type Lane, type Live,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const FPS = 30;

function play(dir: string, lane: Lane, planted?: 'warms_view_only'): Live {
  const doc = writeJson(dir, `shadows-${lane}-${planted ?? 'shipped'}.json`, payload(shadowDoc('shadows-432')));
  const call = liveCall({ frames: 2, fps: FPS, sessions: [{ session: 'shadows', writer: WRITER, doc, size: SHADOWS.size }] });
  return liveReply(run1(bin(), dir, call, planted ? { lane, planted } : { lane }), `the shadow scene on ${lane}`);
}

describe(`${AC[6]} a scene shadowed from its first frame compiles every shadow pipeline at check`, () => {
  it(`${AC[6]} a sun of 3 cascades, a spot and a point lamp over an opaque, a mask-alpha and an instanced caster: the first frame creates no pipeline and reports no settling, on the noop lane and on Metal`, () => {
    const dir = out();
    const lanes: Lane[] = process.platform === 'darwin' ? ['noop', 'gpu'] : ['noop'];
    for (const lane of lanes) {
      const problems = warmProblems(play(dir, lane), 'shadows', FPS, true);
      console.log(`${AC[6]}: ${lane}: ${problems.length} problems${problems.length ? `, first: ${problems[0]}` : ''}`);
      expect(problems, `${lane}: the first frame and those after it create no pipeline and report no settling`).toEqual([]);
    }
    if (process.platform === 'darwin') requireReferenceMac('The shadow scene\'s count');
    else requireGpu();
  }, 1_800_000);

  it(`${AC[6]} a planted warm-up of the view's pipelines only (--planted warms_view_only) creates the shadow pipelines in the first frame and fails, naming the shadow map and the caster`, () => {
    const live = play(out(), 'noop', 'warms_view_only');
    const first = firstDrawn(live, 'shadows');
    expect(first, 'the scene draws').not.toBeNull();
    const shadow = createdAt(live, 'shadows', first!).filter((c) => c.target !== 'view');
    const failure = shadow.map((c) => named(c, first!, FPS));
    console.log(`${AC[6]}: warms_view_only: ${failure.join('; ').slice(0, 3000)}`);
    expect(warmProblems(live, 'shadows', FPS, true).length, 'the check fails').toBeGreaterThan(0);
    expect(shadow.length, 'the first frame creates pipelines into shadow maps').toBeGreaterThan(0);
    for (const c of shadow) expect(c.target.length > 0 && c.items.length > 0, `each names its shadow map and its casters: ${JSON.stringify(c)}`).toBe(true);
    const casters = new Set(shadow.flatMap((c) => c.items));
    const kinds = { opaque: [SHADOWS.casters.opaque], mask: [SHADOWS.casters.mask], instanced: [SHADOWS.casters.instanced, 'peg'] };
    const missing = Object.entries(kinds).filter(([, ids]) => !ids.some((id) => casters.has(id))).map(([k]) => k);
    expect(missing, `the shadow pipelines created name the opaque, the mask-alpha and the instanced caster: ${[...casters].join(', ')}`).toEqual([]);
  }, 1_800_000);
});
