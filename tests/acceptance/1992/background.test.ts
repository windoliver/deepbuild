// AC4 #1992.6b71e62f: With a uniform HDR environment of radiance 1, `background_intensity: 0.25` and tone map none,
// background pixels read 0.25 within 1/255 linear, and a white matte sphere's pixels equal the frame at
// `background_intensity: 1` byte for byte. A planted control that scales the environment's lighting instead changes
// the sphere and fails, naming the pixel.
//
// The fixture (helpers: backgroundDoc): a Radiance HDR written here, every pixel mantissa 128 at exponent 129, which
// is 1 exactly in each channel, as the sky's `environment.from` with no `background` field (so the HDR draws behind
// the scene), no fog and no ambient gradient; a camera at the origin, fov 60° across 480 × 360; `sphere`, a `ball@1`
// of radius 1 m 4 m ahead in a white matte material (base color 1, metallic 0, roughness 1), lit by the environment
// alone; tone map none at exposure scale 1. Drawn three times in one process: `background_intensity: 0.25`,
// `background_intensity: 1`, and the planted control.
//   - Fixture: at `background_intensity: 1` every background pixel reads 1 within 1/255 (the HDR is radiance 1), and
//     the sphere's centre reads 0.5 or more (the environment lights it, so a control on the lighting would show).
//     A background pixel is one with no item within 3 px in the ID target; there are 50,000 or more.
//   - At `background_intensity: 0.25` every background pixel reads 0.25 within 1/255 on the linear target.
//   - Every pixel the sphere covers whole (it and every pixel within 2 px on the sphere in the ID target; 20,000 or
//     more) holds the same bytes in both frames, on the linear target (f32) and on the final target.
//   - The planted control, by a real field: the same document with `environment.intensity: 0.25` in place of
//     `background_intensity`, the base's control, which scales what the environment lights. The same sphere judge
//     fails on its frame, every failure naming a pixel, on 20,000 or more of the sphere's pixels.
// Wrong programs: the base (the field isn't read); a field that scales the environment's light, or both; one that
// dims the sphere's rim through a blend; a background scaled after tone mapping only.
import { describe, expect, it } from 'vitest';
import {
  AC, BG_SIZE, PIXEL, SPHERE, TOL, backgroundDoc, failsNaming, fmt, judgeSphere, nearItem, none, off, only, readIds, readLinear, readPng, requireMetal,
  runGpu, useBin, useDir, view3dCall, writeJson, writeUniformHdr, type Ids, type JsonObject, type Linear,
} from './helpers.ts';

const bin = useBin();
const dir = useDir();

/** The background pixels that miss `want` by more than 1/255, each named, and how many were read. */
function background(lin: Linear, ids: Ids, want: number, what: string): { failures: string[]; read: number } {
  const failures: string[] = []; let read = 0;
  for (let y = 0; y < ids.height; y++) for (let x = 0; x < ids.width; x++) {
    if (nearItem(ids, x, y, 3)) continue;
    read++;
    const v = lin.at(x, y);
    if (off(v, want) > TOL) failures.push(`(${x}, ${y}) ${what}: the background reads ${fmt(v)}, should read ${want.toFixed(4)}`);
  }
  return { failures, read };
}

describe(`${AC[4]} a background brightness of its own`, () => {
  it(`${AC[4]} with a uniform HDR of radiance 1 and background_intensity 0.25 the background reads 0.25 within 1/255 and a white matte sphere's pixels equal the frame at background_intensity 1 byte for byte; a planted control that scales the environment's lighting fails, naming the pixel`, () => {
    requireMetal();
    const out = dir();
    const hdr = writeUniformHdr(out);
    const call = (name: string, sky: JsonObject, env: JsonObject = {}): JsonObject =>
      view3dCall({ doc: writeJson(out, name, backgroundDoc(hdr.sha, sky, env)), size: BG_SIZE, targets: ['final', 'linear', 'ids'], assets: { [hdr.sha]: hdr.path } });
    const replies = runGpu(bin(), out, [call('quarter', { background_intensity: 0.25 }), call('one', { background_intensity: 1 }), call('planted', {}, { intensity: 0.25 })]);
    const [quarter, one, planted] = ['background_intensity 0.25', 'background_intensity 1', 'the planted control'].map((what, i) => {
      const f = only(replies[i]!, what);
      return { lin: readLinear(out, f, BG_SIZE, what), final: readPng(out, f.final, what), ids: readIds(out, f, what) };
    });

    // The fixture.
    const full = background(one!.lin, one!.ids, 1, 'at background_intensity 1');
    expect(full.read, 'the frame holds 50,000 or more background pixels').toBeGreaterThanOrEqual(50_000);
    none(full.failures, 'the HDR is radiance 1: at background_intensity 1 the background reads 1');
    expect(one!.ids.at(BG_SIZE[0] / 2, BG_SIZE[1] / 2), 'the sphere is at the frame\'s centre').toBe(SPHERE);
    const centre = one!.lin.at(BG_SIZE[0] / 2, BG_SIZE[1] / 2);
    expect(Math.min(...centre), `the environment lights the sphere: its centre reads ${fmt(centre)}`).toBeGreaterThanOrEqual(0.5);

    // The criterion: the sphere is the frame at background_intensity 1, byte for byte.
    console.log(`${AC[4]}: the background reads ${fmt(quarter!.lin.at(2, 2))} at background_intensity 0.25 and ${fmt(one!.lin.at(2, 2))} at 1; the sphere's centre ${fmt(quarter!.lin.at(BG_SIZE[0] / 2, BG_SIZE[1] / 2))} and ${fmt(centre)}`);
    const sphere = judgeSphere(one!.ids, quarter!, one!, 'at background_intensity 0.25');
    expect(sphere.judged, 'the sphere covers 20,000 or more pixels whole').toBeGreaterThanOrEqual(20_000);
    none(sphere.failures, 'the sphere\'s pixels equal the frame at background_intensity 1 byte for byte');

    // The planted control that scales the environment's lighting instead, through the same judge.
    const lit = judgeSphere(one!.ids, planted!, one!, 'under the planted control (environment.intensity 0.25)');
    failsNaming(lit.failures, PIXEL, 'the planted control that scales the environment\'s lighting');
    expect(lit.failures.length, 'the planted control changes the sphere on 20,000 or more pixels').toBeGreaterThanOrEqual(20_000);

    // The criterion: the background reads 0.25.
    const dimmed = background(quarter!.lin, quarter!.ids, 0.25, 'at background_intensity 0.25');
    expect(dimmed.read, 'both frames hold the same background pixels').toBe(full.read);
    none(dimmed.failures, 'at background_intensity 0.25 the background reads 0.25');
  }, 1_800_000);
});
