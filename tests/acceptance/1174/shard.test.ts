// #1174.d79a0063: A 12 px ink label on paper reaches the ink's own value within 4 codes at its darkest pixel at internal
// scales 1 and 0.5.
// #1174.197f8e90: At internal scale 0.5 a label's pixels equal its pixels at scale 1 within 8 codes; a planted label
// drawn before the upscale fails, naming the label.
//
// Both read the shard view's labels (helpers.ts, `shardScene`: #386's 1080p frame of 48 labels of 12 px text in ink
// on paper, the one the Nov 3 audit measured, without its lines) drawn by #378's `view3d` through #386's `surface` at
// internal scale 1 and at 0.5 (edge-adaptive upscale, sharpen 0.2, the defaults). Each label is read inside its own
// region (320 × 80 px about where the camera puts its centre); a fixture check holds that the regions hold the labels.
// Wrong programs: the merge base (washed-out labels, drawn into the internal frame before the upscale);
// `--planted labels_before_upscale` (README: the labels drawn at internal size before the upscale and sharpen).
import { describe, expect, it } from 'vitest';
import {
  HD, INK, INK_CODES, MASK_CODES, SHARD_LABEL, SHARD_LABELS, codes, hex, pixel, regionOf, regionProblems, requireReferenceMac, run, shardScene,
  useBuild, useOut, view3dCall, viewFrame, writeJson,
  type Image, type Planted, type Rgb, type SurfaceSpec,
} from './helpers.ts';

const INK_ID = '#1174.d79a0063';
const SCALE_ID = '#1174.197f8e90';
const ONE: SurfaceSpec = { internal_scale: 1 };
const HALF: SurfaceSpec = { internal_scale: 0.5 };

const bin = useBuild();
const out = useOut();

/** The shard view drawn at scale 1 and at internal scale 0.5, each held to the surface it drew through. */
function shard(planted?: Planted): { one: Image; half: Image } {
  const doc = writeJson(out(), 'shard', shardScene());
  const [r1, r05] = run(bin(), out(), [view3dCall(doc, HD, ONE), view3dCall(doc, HD, HALF)], planted);
  const one = viewFrame(out(), r1!, 'the shard view at scale 1');
  const half = viewFrame(out(), r05!, 'the shard view at internal scale 0.5');
  expect([one.scale, one.upscale], 'scale 1 drew with no upscale').toEqual([1, 'none']);
  expect([half.scale, half.upscale], 'internal scale 0.5 drew through the edge-adaptive upscale').toEqual([0.5, 'edge_adaptive']);
  for (const im of [one.image, half.image]) expect([im.width, im.height], 'the frame is 1080p').toEqual(HD);
  expect(regionProblems(one.image), 'the fixture tries: each label\'s region holds it, and no ink lies outside them').toEqual([]);
  return { one: one.image, half: half.image };
}

/** The darkest pixel (least R + G + B, first in reading order) in a label's region. */
function darkest(image: Image, id: string): { at: [number, number]; color: Rgb } {
  const l = SHARD_LABELS.find((x) => x.id === id)!;
  const [x0, y0, w, h] = regionOf(l);
  let best = { at: [x0, y0] as [number, number], color: pixel(image, x0, y0) };
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const c = pixel(image, x, y);
    if (c[0] + c[1] + c[2] < best.color[0] + best.color[1] + best.color[2]) best = { at: [x, y], color: c };
  }
  return best;
}

/** Each label whose region at internal scale 0.5 differs from scale 1 by more than 8 codes, with its worst pixel. */
function scaleProblems(one: Image, half: Image): string[] {
  const p: string[] = [];
  for (const l of SHARD_LABELS) {
    const [x0, y0, w, h] = regionOf(l);
    let worst = -1; let at: [number, number] = [x0, y0];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const d = codes(pixel(one, x, y), pixel(half, x, y));
      if (d > worst) { worst = d; at = [x, y]; }
    }
    if (worst > MASK_CODES) p.push(`${l.id} "${l.text}": at internal scale 0.5 its pixel (${at[0]}, ${at[1]}) is ${hex(pixel(half, ...at))}, at scale 1 ${hex(pixel(one, ...at))}: ${worst} codes apart, over ${MASK_CODES}`);
  }
  return p;
}

describe(`${INK_ID} a 12 px ink label on paper reaches the ink's own value within 4 codes at its darkest pixel, at internal scales 1 and 0.5`, () => {
  it(`${INK_ID} the shard view's "Shard 7 lag 33.5 ms" at 12 px: its darkest pixel within 4 codes of ink ${hex(INK)} at internal scale 1 and at 0.5`, () => {
    requireReferenceMac();
    const { one, half } = shard();
    const label = SHARD_LABELS.find((l) => l.id === SHARD_LABEL)!;
    expect(label.text, 'the issue\'s label').toBe('Shard 7 lag 33.5 ms');
    const p: string[] = [];
    for (const [scale, im] of [['1', one], ['0.5', half]] as const) {
      const d = darkest(im, label.id);
      const off = codes(d.color, INK);
      console.log(`${INK_ID}: ${label.id} "${label.text}" at internal scale ${scale}: darkest pixel ${hex(d.color)} (${d.color.join(', ')}) at (${d.at[0]}, ${d.at[1]}), ${off} codes from ink ${hex(INK)}`);
      if (off > INK_CODES) p.push(`${label.id} "${label.text}" at internal scale ${scale}: its darkest pixel is (${d.color.join(', ')}) at (${d.at[0]}, ${d.at[1]}), ${off} codes from ink ${hex(INK)}, not within ${INK_CODES}`);
    }
    expect(p, `the label reaches the ink at its darkest pixel at both scales: ${p.join('; ')}`).toEqual([]);
  }, 1_800_000);
});

describe(`${SCALE_ID} at internal scale 0.5 a label's pixels equal its pixels at scale 1 within 8 codes`, () => {
  it(`${SCALE_ID} each of the shard view's 48 labels: every pixel of its region at internal scale 0.5 within 8 codes of scale 1`, () => {
    requireReferenceMac();
    const { one, half } = shard();
    const p = scaleProblems(one, half);
    console.log(`${SCALE_ID}: ${p.length} of ${SHARD_LABELS.length} labels differ by more than ${MASK_CODES} codes between internal scales 0.5 and 1`);
    expect(p, `every label at internal scale 0.5 equals itself at scale 1 within 8 codes: ${p.slice(0, 5).join('; ')}${p.length > 5 ? ` (and ${p.length - 5} more)` : ''}`).toEqual([]);
  }, 1_800_000);

  it(`${SCALE_ID} a planted label drawn before the upscale fails, naming the label`, () => {
    requireReferenceMac();
    const { one, half } = shard('labels_before_upscale');
    const p = scaleProblems(one, half);
    console.log(`${SCALE_ID} (--planted labels_before_upscale): ${p.length} labels differ; first: ${p[0] ?? 'none'}`);
    expect(p.length, '--planted labels_before_upscale fails the check').toBeGreaterThan(0);
    expect(p.join('\n'), 'naming the label').toMatch(/^t-\d\d "[^"]+": at internal scale 0\.5 its pixel/m);
  }, 1_800_000);
});
