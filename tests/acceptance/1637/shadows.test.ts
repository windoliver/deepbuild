// #1637.2d8df0a5: "Shadows and captures are untouched: an item hidden from the camera still casts its shadow into view.
// A planted culler applied to a cascade pass or a probe capture loses that shadow and fails, naming the pass"
//
// The walk's first frame with shadows (`helpers.ts: cityDoc({camera: 'walk', shadows: true})`, 960 × 540): the key
// sun 20° up, straight down the street ahead, casting 4 cascades out to 300 m, so light runs back along −X and the
// sidewalks lie in sun. Statue `statue` (an item, 0.6 × 2.4 × 0.6 m), 12 m ahead and 4.5 m left, stands behind kiosk
// `kiosk` (an item, 2.5 m tall, 1.6 m across), 8 m ahead and 3 m left: by a scratch CPU ray cast none of 363 rays to
// its surface reaches it, while its 6.6 m shadow runs back toward the camera along the sidewalk past the kiosk, where
// about 980 sample points of it are in view and would be in sun without it. Reflection probe `probe`
// (`light.probe@1`, 4 × 3 × 4 m) stands 12 m ahead and 1 m left, 4.5 m from the statue, inside its capture's reach.
//
// Three calls: the shipped path with `cull_report`; then in one process `occlusion: 'off'` with `cull_report` and the
// final and object-ID targets, and `occlusion: 'off'` on the twin without the statue (`statue: false`) with the final
// target. The checks:
//   - the shipped frame hashes as occlusion: 'off''s;
//   - every pass but the camera's (`cascade<k>`, `probe:probe`, and any other the frame reports) keeps, in the shipped
//     path, exactly what it keeps with occlusion: 'off', instancer elements and items alike;
//   - the fixture: the statue has no pixel in the object-ID target, yet the frustum keeps it for the camera; a cascade
//     and the probe's capture keep it; and at least 200 ground pixels are darker with the statue than without it, by
//     at least 6 codes over R, G and B, which is its shadow in view.
//
// `--planted occlusion_in_cascades` applies the camera's occlusion test to the cascade passes: the statue, hidden from
// the camera, leaves its cascade and its shadow leaves the frame, and the check fails naming the cascade pass and the
// frame's hash.
// `--planted occlusion_in_probe_captures` applies it to the probe's capture, which loses the statue and its shadow, and
// the check fails naming `probe:probe` (by its kept set alone: at the base a probe's capture is made on the CPU and
// draws nothing in the look, so no pixel is asked of it; README: Readings). Each plant's run is the shipped path's call; occlusion: 'off' and the twin are
// drawn by the shipped program in their own process.
import { describe, it } from 'vitest';
import {
  AC, PROBE, SIZE, STATUE, cityDoc, decodePng, failsNaming, frameAt, framesOf, keptBy, namedFile, none, passesOf, readIds, requireGpu, run, useGpu, useOut,
  view3dCall, writeJson, type Planted,
} from './helpers.ts';

const bin = useGpu();
const dir = useOut();
const SHADOW_PX = 200;
const DARKER = 6;
const PROBE_PASS = `probe:${PROBE}`;

function courtProblems(planted?: Planted): string[] {
  const out = dir();
  const doc = writeJson(out, 'city', cityDoc({ camera: 'walk', shadows: true }));
  const twin = writeJson(out, 'city-without', cityDoc({ camera: 'walk', shadows: true, statue: false }));
  const what = planted ? `--planted ${planted}` : 'the shipped path';
  const [shippedReply] = run(bin(), out, [view3dCall({ doc, size: SIZE, cull_report: true })], planted);
  const [offReply, twinReply] = run(bin(), out, [
    view3dCall({ doc, size: SIZE, cull_report: true, occlusion: 'off', targets: ['final', 'ids'] }),
    view3dCall({ doc: twin, size: SIZE, occlusion: 'off', targets: ['final'] }),
  ]);
  const a = frameAt(framesOf(shippedReply!, what), 0, what);
  const b = frameAt(framesOf(offReply!, "occlusion: 'off'"), 0, "occlusion: 'off'");
  const problems: string[] = [];
  if (!a.hash || a.hash !== b.hash) problems.push(`frame 0: ${what} hashes ${String(a.hash)}, occlusion: 'off' ${String(b.hash)}`);
  const passes = [...new Set([...passesOf(a), ...passesOf(b)])].filter((p) => p !== 'view');
  for (const pass of passes) {
    const mine = keptBy(out, a, pass, what);
    const theirs = keptBy(out, b, pass, "occlusion: 'off'");
    for (const e of theirs) if (!mine.has(e)) problems.push(`pass ${pass}: element ${e}, which occlusion: 'off' keeps there, is missing from ${what}'s kept set`);
    for (const e of mine) if (!theirs.has(e)) problems.push(`pass ${pass}: element ${e} is in ${what}'s kept set but not in occlusion: 'off''s`);
  }
  if (!planted) {
    const fixture: string[] = [];
    const ids = readIds(out, b, "frame 0, occlusion: 'off'");
    if (ids.count.has(STATUE)) fixture.push(`${STATUE} has ${ids.count.get(STATUE)} px in the object-ID target, so it isn't hidden from the camera`);
    if (!keptBy(out, b, 'view', "occlusion: 'off'").has(STATUE)) fixture.push(`occlusion: 'off''s frustum doesn't keep ${STATUE} for the camera`);
    const cascades = passes.filter((p) => /^cascade\d$/.test(p));
    if (!cascades.some((p) => keptBy(out, b, p, "occlusion: 'off'").has(STATUE))) fixture.push(`no cascade of ${cascades.join(', ') || 'none reported'} keeps ${STATUE}`);
    if (!passes.includes(PROBE_PASS) || !keptBy(out, b, PROBE_PASS, "occlusion: 'off'").has(STATUE)) fixture.push(`${PROBE_PASS}'s capture doesn't keep ${STATUE}`);
    const withIt = decodePng(namedFile(out, b.final, 'png', "occlusion: 'off''s final target"));
    const without = decodePng(namedFile(out, frameAt(framesOf(twinReply!, 'the twin'), 0, 'the twin').final, 'png', "the twin's final target"));
    let darker = 0;
    for (let y = 0; y < withIt.height; y++) for (let x = 0; x < withIt.width; x++) {
      if (ids.at(x, y) !== 'ground') continue;
      const o = (y * withIt.width + x) * 4;
      const drop = [0, 1, 2].reduce((s, k) => s + without.rgba[o + k]! - withIt.rgba[o + k]!, 0);
      if (drop >= DARKER) darker++;
    }
    if (darker < SHADOW_PX) fixture.push(`${darker} ground pixels are darker with ${STATUE} than without it, under ${SHADOW_PX}: its shadow isn't in view`);
    problems.push(...fixture.map((f) => `the fixture: ${f}`));
  }
  return problems;
}

describe(`${AC[4]} shadows and captures keep their own sets`, () => {
  it(`${AC[4]} the statue hidden from the camera still casts its shadow into view, and every cascade and the probe's capture keep what occlusion: 'off' keeps`, () => {
    requireGpu();
    none(courtProblems(), 'the statue at frame 0');
  }, 3_600_000);

  it(`${AC[4]} a planted culler applied to the cascade passes (--planted occlusion_in_cascades) loses the statue's shadow, and fails naming the pass`, () => {
    requireGpu();
    none(courtProblems(), 'the shipped program at frame 0');
    failsNaming(courtProblems('occlusion_in_cascades'), [new RegExp(`^pass cascade\\d: element ${STATUE},`), /^frame 0: --planted occlusion_in_cascades hashes /], '--planted occlusion_in_cascades');
  }, 3_600_000);

  it(`${AC[4]} a planted culler applied to the probe's capture (--planted occlusion_in_probe_captures) loses the statue's shadow, and fails naming the pass`, () => {
    requireGpu();
    none(courtProblems(), 'the shipped program at frame 0');
    failsNaming(courtProblems('occlusion_in_probe_captures'), [`pass ${PROBE_PASS}: element ${STATUE},`], '--planted occlusion_in_probe_captures');
  }, 3_600_000);
});
