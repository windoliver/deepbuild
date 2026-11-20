// #2760.ee433725: "65 touches inside one second on one part are refused at check, naming the part, the time and the count
// of 65; 64 draw"
//
// The fixture (helpers.ts `pondDoc`, 480 × 270): the still pond, and the logic item `crowd` (60 Hz), which emits n
// touches `touch {point: vec3, n: i32}`, two a step from step 60: touch i (from 0) at step 60 + ⌊i ÷ 2⌋, at the point
// 0.4 m × (i mod 9, ⌊i ÷ 9⌋) from (−0.6, −1.9) in world x and z, all on the plate. With 65, the last touch falls at step
// 92 (1.533 s), 0.533 s after the first; with 64, at step 91. `rings` is at its defaults, so each ring lives 2 s and
// every touch's ring is alive from the last touch until the first one's span ends at 3 s.
//
// 65: `view3d`, asked for the frame at 2 s (frame 40 at 20 fps, so the call's own bake holds all 65 touches), answers
// with the document check's refusal, `{code: "refused", issues}`. An error issue names the part `pond`, and its
// `actual` holds `count: 65` and `t`, a time in whole flicks at which 65 rings are alive on the part: at or after the
// 65th touch's flick (1,081,920,000) and before the first ring's span ends (2,116,800,000).
// 64: the same pond with 64 touches draws. Frame 40's `rings` rows list 64 rings, one per touch, each at its point with
// radius speed × age, and the frame differs from the same pond with `rings: "none"`. Wrong programs: no cap, a cap that
// drops the 65th ring instead of refusing, a cap counted per step or per list rather than alive at one time, a refusal
// that names no part, time or count, a cap that refuses 64.
import { describe, expect, it } from 'vitest';
import {
  AC, CAP, FLICKS, POND, SPAN, STEP, STILL, TOUCH, type Emitter, type JsonObject, type Touch, alive, emitter, frameAt, framesOf, hashAt, int, isObject, logicItem, look3d,
  namesWord, none, pondDoc, putAsset, refusedIssues, requireGpu, ringFailures, ringsOf, runGpu, shown, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [480, 270];
const LOOK = look3d('cap-2760');
const FPS = 20;
const AT = 40; // 2 s
const T = AT / FPS;
const LIST = 'crowd.occurrences';
/** n touches, two a step from step 60, on a 0.4 m grid of nine columns over the plate. */
const crowd = (n: number): Emitter => emitter(`crowd-${n}`, [TOUCH], Array.from({ length: n }, (_, i): Touch => ({
  step: 60 + (i >> 1), kind: 'touch', a: i + 1, fields: { point: [-0.6 + 0.4 * (i % 9), 0, -1.9 + 0.4 * Math.floor(i / 9)], n: i + 1 },
})));

describe(`${AC[5]} at most ${CAP} rings alive at one time on one part`, () => {
  it(`${AC[5]} 65 touches inside one second on one part are refused at check, naming the part, the time and the count of 65; 64 draw`, () => {
    requireGpu();
    const dir = out();
    const over = crowd(CAP + 1); const full = crowd(CAP);
    const assets = { ...putAsset(dir, over.program), ...putAsset(dir, full.program) };
    const pond = (name: string, e: Emitter, rings: boolean): string =>
      writeJson(dir, name, pondDoc(name, SIZE, { ...STILL, rings: rings ? { on: { list: LIST, kinds: ['touch'] } } : 'none' }, { crowd: logicItem(e) }));
    const at2 = (doc: string): JsonObject => view3d({ doc, look: LOOK, size: SIZE, from: AT, frames: 1, fps: FPS, capture: [AT], rings: true, assets });
    const [refused, drawn, bare] = runGpu(bin(), dir, [at2(pond('crowd-65', over, true)), at2(pond('crowd-64', full, true)), at2(pond('crowd-bare', full, false))]);

    // 64 draw.
    const frame = frameAt(framesOf(drawn!, 'the pond with 64 touches'), AT, 'the pond with 64 touches');
    const rings = ringsOf(frame, 'the pond with 64 touches');
    expect(rings.length, '64 rings are alive at 2 s, one per touch').toBe(CAP);
    none(ringFailures(rings, alive(full.rows, T), T, LIST), 'each of the 64 touches\' rings at its point, with radius speed × age');
    expect(hashAt(bare!, AT, 'the pond with rings: none'), 'the 64 rings are drawn: the pond with rings: none has another frame 40').not.toBe(frame.pixel_hash);

    // 65 are refused at check.
    expect(over.rows.length, 'the list holds 65 touches').toBe(CAP + 1);
    const first = over.rows[0]!.t; const last = over.rows[CAP]!.t;
    expect(last - first, '65 touches inside one second').toBeLessThan(FLICKS);
    const issues = refusedIssues(refused!, 'the pond with 65 touches');
    const hit = issues.find((i) => namesWord(JSON.stringify(i), POND) && isObject(i['actual']) && i['actual']['count'] === CAP + 1);
    expect(hit, `an error issue names the part ${POND} and, in its actual, the count 65: ${shown(issues)}`).toBeDefined();
    const t = int((hit!['actual'] as JsonObject)['t'], 'the issue\'s actual.t, the time in whole flicks');
    console.log(`${AC[5]}: refused naming ${POND}, count 65 at ${t} flicks (${t / FLICKS} s); 65 rings are alive from ${last} to ${first + SPAN * FLICKS}`);
    expect(t >= last && t < first + SPAN * FLICKS, `the time named, ${t} flicks, is one at which 65 rings are alive: from the 65th touch's flick ${last} (step ${last / STEP}) to before ${first + SPAN * FLICKS}`).toBe(true);
  });
});
