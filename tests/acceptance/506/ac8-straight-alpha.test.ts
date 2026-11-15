// AC8: "An inset whose content is a white disc at alpha 0.5 on a transparent ground, on a black part's face, reads at the
// disc's edge the same pixels within one code value as the disc drawn directly on that face; a planted inset that
// samples its premultiplied render as straight alpha darkens the edge and fails, naming the inset"
//
// The fixture (helpers.ts: DISC, discDoc): a 1 × 1 m unlit black panel facing an orthographic camera straight on, 256 px
// a metre, so its face spans px 32 to 288 on each axis with its edges on pixel edges; the inset `disc-inset` fills the
// face at 256 px a metre, so texel (i, j) lies on pixel (32 + i, 32 + j). Its content is one `image@1` of the disc's
// PNG made here: white, alpha 0.5 × the share of each texel inside a circle of radius 80 texels (16 × 16 samples a
// texel), straight alpha, transparent outside.
//
// The reference: the disc drawn directly on the black face, texel by texel: straight-alpha white over black in linear
// light, 1 × a + 0 × (1 − a), then sRGB coded (tone map none at unit exposure): round(255 × encode(a ÷ 255)). The edge is
// every texel with 0 < a < 128 (the disc's rim, where the content's own alpha is partial) and its 8 neighbours.
//
// asserts, through `view3d` (final target):
//   - every pixel over the edge reads the reference within one code value on each channel; guards: at least 400 edge
//     pixels, and the disc's middle reads the reference too (code 188 for alpha 128);
//   - under `--planted inset_premultiplied_as_straight` (the inset's premultiplied render sampled as straight alpha:
//     a² in place of a), the edge reads darker and the check fails, naming `disc-inset`.
// Wrong programs: the base (no inset kind); an inset sampled premultiplied as straight; an inset composited in sRGB
// codes; an inset that resamples its content off the texel grid.
import { describe, expect, it } from 'vitest';
import {
  DISC, TIMEOUT, ac, discAlpha, discDirect, discDoc, discPng, failsNaming, finalOf, frameAt, framesOf, look, none, px, requireGpu, rgbText, runGpu, sha256,
  useBins, useDir, view3d, writeBytes, writeJson, type Image,
} from './helpers.ts';

const bin = useBins(['deep-gpu']);
const dir = useDir();

/** Each edge pixel off the disc drawn directly by more than one code value, named by the inset. */
function edgeFailures(im: Image, alpha: Uint8Array, what: string): string[] {
  const n = DISC.tex;
  const edge = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = alpha[j * n + i]!;
    if (a > 0 && a < 128) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di; const jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < n && jj < n) edge[jj * n + ii] = 1;
    }
  }
  let count = 0; let bad = 0; let first = '';
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (!edge[j * n + i]) continue;
    count++;
    const want = discDirect(alpha[j * n + i]!);
    const got = px(im, DISC.offset + i, DISC.offset + j);
    if (got.some((v) => Math.abs(v - want) > 1)) { bad++; if (!first) first = `pixel (${DISC.offset + i}, ${DISC.offset + j}) reads ${rgbText(got)}, the disc drawn directly ${want} (alpha ${alpha[j * n + i]})`; }
  }
  const failures: string[] = [];
  if (count < 400) failures.push(`${what}: the fixture's edge covers only ${count} pixels`);
  if (bad) failures.push(`${what}: inset disc-inset: ${bad} of ${count} pixels at the disc's edge are off the disc drawn directly on the face by more than one code value; first ${first}`);
  const mid = px(im, DISC.offset + 128, DISC.offset + 128);
  if (mid.some((v) => Math.abs(v - discDirect(128)) > 1)) failures.push(`${what}: inset disc-inset: the disc's middle (${DISC.offset + 128}, ${DISC.offset + 128}) reads ${rgbText(mid)}, the disc drawn directly ${discDirect(128)}`);
  return failures;
}

describe(`${ac(8)} an inset's content enters the material as straight alpha`, () => {
  it(`${ac(8)} the white disc at alpha 0.5 reads at its edge the pixels of the disc drawn directly on the black face within one code value, and the planted premultiplied-as-straight inset darkens the edge and fails, naming the inset`, () => {
    requireGpu();
    const out = dir();
    const alpha = discAlpha();
    const png = discPng(alpha);
    const sha = sha256(png);
    const call = view3d({ doc: writeJson(out, 'disc', discDoc(sha)), look: look(), size: DISC.size, assets: { [sha]: writeBytes(out, `${sha}.png`, png) } });
    expect(discDirect(128), 'the reference: alpha 128 over black reads code 188').toBe(188);
    const shot = (planted?: 'inset_premultiplied_as_straight'): Image => {
      const [r] = runGpu(bin('deep-gpu'), out, [call], planted);
      return finalOf(out, frameAt(framesOf(r!, 'the disc inset'), 0, 'the disc inset'), 'the disc inset');
    };
    none(edgeFailures(shot(), alpha, 'the disc inset'), "the inset's edge matches the disc drawn directly");
    failsNaming(edgeFailures(shot('inset_premultiplied_as_straight'), alpha, 'the planted inset'), ['disc-inset'], 'the planted inset that samples its premultiplied render as straight alpha');
  }, TIMEOUT);
});
