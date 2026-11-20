// #2760.3bd24233: "Shown to you: screenshots of the three rings and of a pond after a fish rises, taken by the check run
// from the renderer's own output, with a recording of the rings spreading, are attached to the PR and shown to you in
// the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS,
// and no criterion above reads a picture to judge it"
//
// Three files, from this run's `view3d` frames under a filmic look, all of helpers.ts's `pondDoc` (a pond mirroring red
// and white posts under a day sky and a sun, over a sand bed): `three-rings.png`, criterion 1's still pond and its
// three touches at 2.25 s, 1280 × 720, the renderer's final PNG byte for byte; `fish-rise.png`, the pond in a light
// breeze (a 1.5 m/s wind's waves, ripples at 0.15) after a fish rises 0.7 m off its centre: the logic item `fish` emits
// three `rise {point: vec3}` rows there, 0.15 s apart from 1 s, and the frame is 1.9 s, seen from a camera nearer the
// rise; and `rings-spreading.apng`, the three touches' rings spreading on the still pond, 96 frames from 0.9 s at 30
// fps and 640 × 360, the renderer's final frames as an animated PNG. They are kept in DEEPBUILD_EVIDENCE_DIR (else a
// folder under $TMPDIR), their paths printed for the PR and the session. The taste call is a file you record, named by
// DEEPBUILD_TASTE_2760: {"criterion": "#2760.3bd24233", "by": "you", "screenshots": [sha256 × 3], "call":
// "looks_right" | "looks_wrong"}. With no record, or one made on other files, the test fails as INCONCLUSIVE;
// looks_wrong fails it. No other test in this suite reads a picture to judge it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CENTRE, FILMIC, STILL, TAPS, TAP_RINGS, type Emitter, type V3, camera, decodePng, emitter, encodeApng, evidenceDir, finalOf, frameAt, framesOf, inconclusive,
  logicItem, pondDoc, putAsset, requireGpu, runGpu, sha256, threeTouches, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SHOT: [number, number] = [1280, 720];
const REC: [number, number] = [640, 360];
const RISE: V3 = [CENTRE[0] + 0.3, 0, CENTRE[2] + 0.6];
/** A fish rises: three `rise` rows at one place, at steps 60, 69 and 78 (1, 1.15 and 1.3 s). */
const fish = (): Emitter => emitter('fish', [{ kind: 'rise', fields: [['point', 'vec3']] }], [60, 69, 78].map((step, i) => ({ step, kind: 'rise', a: i + 1, fields: { point: RISE } })));

describe(`${AC[9]} one taste call on the renderer's own screenshots and recording`, () => {
  it(`${AC[9]} the three rings, a pond after a fish rises, and the recording of the rings spreading, from the renderer's own frames, and the recorded taste call says they look right`, () => {
    requireGpu();
    const dir = out();
    const taps = threeTouches(); const riser = fish();
    const assets = { ...putAsset(dir, taps.program), ...putAsset(dir, riser.program) };
    const still = (size: [number, number]) => pondDoc('three-rings', size, { ...STILL, rings: TAP_RINGS }, { [TAPS]: logicItem(taps) });
    const risen = pondDoc('fish-rise', SHOT, { waves: { wind: { speed: 1.5, direction: 60 } }, ripples: { strength: 0.15 }, rings: { on: { list: 'fish.occurrences', kinds: ['rise'] } } },
      { fish: logicItem(riser) }, { cam: camera([RISE[0] - 0.4, 1.1, RISE[2] + 3], [RISE[0], 0, RISE[2] - 0.4], 45) });
    const [ringShot, fishShot, rec] = runGpu(bin(), dir, [
      view3d({ doc: writeJson(dir, 'three-rings', still(SHOT)), look: FILMIC, size: SHOT, from: 45, frames: 1, fps: 20, capture: [45], targets: ['final'], assets }),
      view3d({ doc: writeJson(dir, 'fish-rise', risen), look: FILMIC, size: SHOT, from: 38, frames: 1, fps: 20, capture: [38], targets: ['final'], assets }),
      view3d({ doc: writeJson(dir, 'rec', still(REC)), look: FILMIC, size: REC, from: 27, frames: 96, fps: 30, capture: 'every', targets: ['final'], assets }),
    ]);
    const keep = evidenceDir();
    const kept = (name: string, bytes: Buffer): string => {
      const hash = sha256(bytes); const [base, ext] = name.split('.') as [string, string];
      const file = join(keep, `${base}-${hash}.${ext}`);
      writeFileSync(file, bytes);
      console.log(`for the taste call: ${file}`);
      return hash;
    };
    const frames = framesOf(rec!, 'the recording');
    expect(frames.length, 'the recording holds 96 frames').toBe(96);
    const screenshots = [
      kept('three-rings.png', finalOf(dir, frameAt(framesOf(ringShot!, 'the three rings'), 45, 'the three rings'), 'the three rings')),
      kept('fish-rise.png', finalOf(dir, frameAt(framesOf(fishShot!, 'the pond after a fish rises'), 38, 'the pond after a fish rises'), 'the pond after a fish rises')),
      kept('rings-spreading.apng', encodeApng(frames.map((f) => decodePng(finalOf(dir, f, 'the recording'))), 30)),
    ];
    const path = process.env['DEEPBUILD_TASTE_2760'];
    if (!path || !existsSync(path)) inconclusive(`no taste call is recorded on these screenshots (${screenshots.join(', ')}); record yours in a file named by DEEPBUILD_TASTE_2760`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; call?: string };
    const same = JSON.stringify([...(record.screenshots ?? [])].sort()) === JSON.stringify([...screenshots].sort());
    if (record.criterion !== AC[9] || record.by !== 'you' || !same) inconclusive(`the recorded taste call at ${path} isn't yours on these screenshots (${screenshots.join(', ')})`);
    expect(record.call, 'your taste call').toBe('looks_right');
  });
});
