// AC2 #149.c0138bef: Paper anchored to the world stays within 0.5 px of its reprojected place on the page through a
// 9,100 px dolly and a 5× zoom, and no pixel's paper value changes by more than 2 code values between adjacent frames of
// a steady push.
//
// The fixture (`fixtures/paper-move.json`, 480 × 270 at 30 fps) moves its camera 9,100 u along x from 0 to 20 s, then
// narrows its view from 480 to 96 u from 20 to 28 s. The paper is the `ground` row of `layers`, in f32 (README). The
// reference is the camera's own arithmetic: each frame is compared with the one before it in a chain, the earlier frame
// reprojected to the later pose, and the offset that best aligns them on a grid of patches is that link's error. Every
// patch stays within 0.5 px, and so does the error summed along the chain, so a slow drift can't hide in small links.
//
// Adjacent frames of the push, 240 of them, are compared the same way, every pixel of the earlier frame reprojected to
// the later pose. A pixel's paper value is read at its place on the page, not at its place on the screen: on a screen
// pixel, the tooth itself crossing the pixel would be the change. The tooth is set soft enough (scale 18 px, depth 0.25)
// that the bilinear read adds well under one code value.
//
// Wrong programs: paper on the screen; paper off by a small scale or at a parallax, which the chain sums; an octave
// that pops at a zoom threshold, which one adjacent pair catches.
import { describe, it } from 'vitest';
import {
  AC, codesOf, chainProblems, flickOf, fixtureJson, layerFloats, layersCall, lookOf, none, obj, requireMetal, reproject, residuals, runGpu, sampleAt, toGray, useDir,
  useGpu, type Floats, type Gray, type Pose, type Residual,
} from './helpers.ts';

const ID = AC[2];
const bin = useGpu();
const dir = useDir();
const F = fixtureJson('paper-move.json');
const DOC = obj(F['doc'], 'the document');
const LOOK = lookOf(F);
const [W, H] = [480, 270] as const;
const FPS = 30;
const DOLLY_END = 600; // 20 s
const ZOOM_END = 840; // 28 s

const poseAt = (n: number): Pose => {
  const t = n / FPS;
  return { x: 240 + 9100 * Math.min(t, 20) / 20, y: 135, vw: t <= 20 ? 480 : 480 - 384 * (Math.min(t, 28) - 20) / 8 };
};
/** The paper at these frames, each from `layers` at its time, in a fresh process per batch. */
function papers(ns: number[]): Floats[] {
  const out = dir();
  const found: Floats[] = [];
  for (let i = 0; i < ns.length; i += 16) {
    const batch = ns.slice(i, i + 16);
    const replies = runGpu(bin(), out, batch.map((n) => layersCall(DOC, LOOK, { t: flickOf(n, FPS), ground: true })));
    replies.forEach((r, k) => found.push(layerFloats(out, r, 'ground', [W, H], `the paper at frame ${batch[k]!}`)));
  }
  return found;
}
function chain(ns: number[], what: string): { problems: string[]; worst: number; drift: number } {
  const grays: Gray[] = papers(ns).map(toGray);
  const links: { label: string; found: Residual[] }[] = [];
  for (let i = 1; i < ns.length; i++) {
    links.push({ label: `frame ${ns[i - 1]!} to ${ns[i]!}`, found: residuals(grays[i - 1]!, poseAt(ns[i - 1]!), grays[i]!, poseAt(ns[i]!)) });
  }
  const result = chainProblems(what, links, W, H, 0.5);
  console.log(`${ID}: ${what}: worst patch ${result.worst.toFixed(3)} px, drift along the chain ${result.drift.toFixed(3)} px, over ${links.length} links`);
  return result;
}

describe(`${ID} paper on the page through a dolly and a zoom`, () => {
  it(`${ID} the paper stays within 0.5 px of its reprojected place through the 9,100 px dolly and the 5× zoom`, () => {
    requireMetal();
    // 16 frames is 242.7 u, half the frame, so each link keeps half of it in view.
    const dolly = Array.from({ length: 39 }, (_, k) => Math.min(k * 16, DOLLY_END));
    // A 1.25× step, so an octave crossfading between two frames leaves most of the field to correlate.
    const widths = [...Array.from({ length: 8 }, (_, k) => 480 / 1.25 ** k), 96];
    const zoom = widths.map((vw) => DOLLY_END + Math.round((240 * (480 - vw)) / 384));
    none([...chain(dolly, 'the dolly').problems, ...chain(zoom, 'the zoom').problems], 'paper off its reprojected place');
  });

  it(`${ID} no pixel's paper value changes by more than 2 code values between adjacent frames of the steady push`, () => {
    requireMetal();
    const failures: string[] = [];
    let worst = 0;
    let previous: Gray[] | null = null;
    for (let start = DOLLY_END; start <= ZOOM_END; start += 16) {
      const ns = Array.from({ length: Math.min(16, ZOOM_END + 1 - start) }, (_, k) => start + k);
      papers(ns).forEach((im, k) => {
        const channels = [0, 1, 2].map((c) => codesOf(im, c));
        if (previous) {
          const a = poseAt(ns[k]! - 1); const b = poseAt(ns[k]!);
          for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
            const [qx, qy] = reproject(b, a, W, H, x + 0.5, y + 0.5);
            for (let c = 0; c < 3; c++) {
              const d = Math.abs(sampleAt(channels[c]!, x + 0.5, y + 0.5) - sampleAt(previous[c]!, qx, qy));
              worst = Math.max(worst, d);
              if (d > 2 && failures.length < 40) failures.push(`frame ${ns[k]! - 1} to ${ns[k]!}: the paper at pixel (${x}, ${y}) channel ${c} changes by ${d.toFixed(2)} code values`);
            }
          }
        }
        previous = channels;
      });
    }
    console.log(`${ID}: the steady push: worst change ${worst.toFixed(3)} code values between adjacent frames at one place on the page`);
    none(failures, 'paper values that jump between adjacent frames');
  });
});
