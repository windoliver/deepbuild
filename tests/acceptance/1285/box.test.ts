// AC2 #1285.9b9bfe99: The same document with a lit `mark.box@1` in front of the camera draws the box over the sky: the
// box's pixels differ from the sky's.
//
// AC1's document (a camera and the near-white `sky@1`) with a key sun and a red `mark.box@1` of 1.6 m at the origin,
// 5 m in front of the camera, so the box covers the middle of the 64 × 48 frame (about 25 px across) and the sky the
// rest. Both documents draw in one `view3d` run each, one frame, final target, #422's plain look. Then:
//   - the sky still draws around the box: the frame with the box isn't blank under film.blank's measure, and each pixel
//     of its four 6 × 6 corners (sky only, far outside the box's silhouette) is bright (luma at least 0.5) and within
//     8 codes of the same pixel of the sky-only frame;
//   - the box draws over the sky: each pixel of the frame's middle 12 × 12 (well inside the silhouette) differs from the
//     same pixel of the sky-only frame by more than 16 codes in some channel.
// Wrong programs: the base (both frames black, so the corners aren't sky and the box's pixels equal the sky's); a sky
// that draws but a box that doesn't (the middle equals the sky); a box drawn under the sky, or the sky drawn over
// everything (the same); a box that draws while the sky is dropped (the corners are dark).
import { describe, expect, it } from 'vitest';
import { PLAIN_LOOK, box, material, requireMetal, useDir, useGpu, view3dCall, writeJson } from '../422/helpers.ts';
import { AC, BRIGHT_SKY, KEY, SIZE, centre, codes, corners, doc, finals, luma, noValidationError, notBlank, px, runKeepingStderr } from './helpers.ts';

const bin = useGpu();
const dir = useDir();

describe(`${AC[2]} a lit box in front of the camera draws over the sky`, () => {
  it(`${AC[2]} with a lit mark.box@1 in front of the camera, the box draws over the near-white sky: the box's pixels differ from the sky's, and the sky still shows around it`, () => {
    requireMetal();
    const out = dir();
    const skyOnly = doc('sky-only', { sky: BRIGHT_SKY });
    const withBox = doc('sky-and-box', {
      sky: BRIGHT_SKY, sun: KEY,
      red: material({ base_color: [0.8, 0.08, 0.06, 1], roughness: 0.7 }),
      box: box([1.6, 1.6, 1.6], { pos: [0, 0, 0] }, { material: 'red' }),
    });
    const call = (name: string, d: typeof skyOnly) => view3dCall({ doc: writeJson(out, name, d), look: PLAIN_LOOK, size: SIZE, frames: 1, capture: [0], targets: ['final'] });
    const { replies, stderr } = runKeepingStderr(bin(), out, [call('sky', skyOnly), call('box', withBox)]);
    const [sky, boxed] = finals(out, replies, ['the sky alone', 'the sky and the box']).map((d) => d.final);
    const [w, h] = SIZE;

    notBlank(boxed!, 'the sky and the box');
    const notSky = corners(w, h, 6).filter(([x, y]) => luma(boxed!, y * w + x) < 0.5 || codes(px(boxed!, x, y), px(sky!, x, y)) > 8);
    expect.soft(notSky.length, `the sky shows around the box: every corner pixel is bright and within 8 codes of the sky alone; ${notSky.length} of ${corners(w, h, 6).length} aren't, such as (${notSky[0]?.join(', ')}) = ${notSky[0] ? px(boxed!, ...notSky[0]).join(', ') : ''} against the sky's ${notSky[0] ? px(sky!, ...notSky[0]).join(', ') : ''}`).toBe(0);

    const middle = centre(w, h, 6);
    const same = middle.filter(([x, y]) => codes(px(boxed!, x, y), px(sky!, x, y)) <= 16);
    console.log(`${AC[2]}: middle pixel with the box ${px(boxed!, w / 2, h / 2).join(', ')}, the sky alone ${px(sky!, w / 2, h / 2).join(', ')}; ${same.length} of ${middle.length} middle pixels within 16 codes of the sky`);
    expect.soft(same.length, `the box draws over the sky: every pixel of the middle 12 × 12 differs from the sky's by more than 16 codes; ${same.length} of ${middle.length} don't, such as (${same[0]?.join(', ')}) = ${same[0] ? px(boxed!, ...same[0]).join(', ') : ''} against the sky's ${same[0] ? px(sky!, ...same[0]).join(', ') : ''}`).toBe(0);
    noValidationError(stderr, 'drawing the sky and the box');
  }, 1_800_000);
});
