// AC1 #468.01baeaa5: On an occlusion fixture no far sample brightens a sharper nearer pixel, an orthographic camera blurs
// by distance to the focus plane, and a tilt band's centre keeps a CoC under 0.5 px.
//
// Through `deep-gpu run`'s `view3d` (#378) at 960 × 640, every document an `effect@1` of kind dof (README: Documents).
//
// The occlusion fixture: a camera at the origin looking down −Z through a 50 mm lens at f/2 on the 36 × 24 mm sensor
// (1333.3 px of focal length), focused at 2 m. A near plate (unlit linear grey 0.2) whose front face stands at exactly
// 2 m covers the frame left of its centre column (x < 480 px); behind it an emissive wall of linear radiance 10 at
// 10 m covers everything left of x = 720 px; the sky right of it is black. The wall's circle of confusion is about
// 13.7 px across, so a gather that lets far samples in brightens the plate's pixels up to 7 px from its edge by up to
// half the wall's light. Read on `pre_tone` (the linear image before tone mapping): every plate pixel 2.5 px or more
// inside its edge reads at most 0.01 above the same pixel of the document without the effect, while (the gather runs)
// the wall's own edge spreads at least 0.5 into the black sky beside it.
//
// The orthographic fixture: an orthographic camera 10 m from the plane z = 0, 4 m of view width (240 px a metre), the
// dof's `projection: orthographic`, `ortho_coc: 4` px a metre and focus 10 m. Three one-pixel emissive points of
// radiance 50: 2 m before the focus plane, 3 m behind it and on it. Their discs are |Δ| × ortho_coc across: 8 ± 1 px
// and 12 ± 1 px, and the one on the plane stays under 2 px (helpers: `measureDisc`).
//
// The tilt band: a plate filling the frame at the focus distance (3 m, so the lens's CoC is 0 on it) under
// `band: {center: 320.5, width: 80, feather: 40, angle: 0, amount: 12}`, read through `targets: ["coc"]` (Assumed
// surface 2: each pixel's signed CoC in px): every pixel on the band's centre row (row 320) under 0.5 px, and, so the
// band is seen to blur, rows 20 and 620 at a median of at least 2 px.
//
// Wrong programs: the base (no dof effect: the documents are refused); a gather that lets far samples spread over a
// sharper nearer pixel; an orthographic CoC from a perspective rule, from one side of the focus plane only, or none;
// a band whose blur doesn't fall to zero at its centre.
import { describe, it } from 'vitest';
import {
  AC, DARK_SKY, at, ball, box, dof, emissive, frameAt, framesOf, lensCamera, measureDisc, median, none, readCoc, readPreTone, requireMetal, runGpu,
  sceneDoc, unlit, useGpu, useOut, view3d, writeJson, type JsonObject, type V3,
} from './helpers.ts';

const ID = AC[1];
const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [960, 640];
const LENS = { focal_length: 50, sensor: [36, 24] as [number, number], fit: 'wider' as const };

function occlusionDoc(withDof: boolean): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: lensCamera([0, 0, 0], [0, 0, -10], LENS, { aperture: { f_stop: 2, blades: 0 } }),
    sky: DARK_SKY, plate_mat: unlit([0.2, 0.2, 0.2]), wall_mat: emissive(10),
    // Front face at z = −2, x from −3 to 0 (the frame's centre column), every row.
    near_plate: box([3, 4, 0.01], [-1.5, 0, -2.005], 'plate_mat'),
    // Front face at z = −10, x from −10 to 1.8 (720 px), every row.
    far_wall: box([11.8, 12, 0.01], [-4.1, 0, -10.005], 'wall_mat'),
  };
  if (withDof) items['fx'] = dof({ focus: 2, max_coc: 32 });
  return sceneDoc(`occlusion-${withDof ? 'dof' : 'sharp'}`, SIZE, items, { transport: { span: '1s' } });
}

/** 240 px a metre: the orthographic view is 4 m wide. */
const ORTHO_PX = SIZE[0] / 4;
interface Point { id: string; z: number; px: [number, number]; across: number | null }
const ORTHO_POINTS: Point[] = [
  { id: 'before_plane', z: 2, px: [240.5, 320.5], across: 8 },
  { id: 'on_plane', z: 0, px: [480.5, 320.5], across: null },
  { id: 'behind_plane', z: -3, px: [720.5, 320.5], across: 12 },
];
function orthoDoc(): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'orthographic', position: [0, 0, 10], target: [0, 0, 0], view_width: 4, near: 0.05, far: 100 } },
    sky: DARK_SKY, glow_mat: emissive(50),
    fx: dof({ focus: 10, projection: 'orthographic', ortho_coc: 4, max_coc: 32 }),
  };
  for (const p of ORTHO_POINTS) {
    const pos: V3 = [(p.px[0] - SIZE[0] / 2) / ORTHO_PX, -(p.px[1] - SIZE[1] / 2) / ORTHO_PX, p.z];
    items[p.id] = ball(0.5 / ORTHO_PX, pos, 'glow_mat');
  }
  return sceneDoc('ortho-blur', SIZE, items, { transport: { span: '1s' } });
}
const BAND_ROW = 320;
function bandDoc(): JsonObject {
  return sceneDoc('tilt-band', SIZE, {
    cam: lensCamera([0, 0, 0], [0, 0, -10], LENS, { aperture: { f_stop: 2.8, blades: 0 } }),
    sky: DARK_SKY, plate_mat: unlit([0.5, 0.5, 0.5]),
    plate: box([20, 20, 0.01], [0, 0, -3.005], 'plate_mat'),
    fx: dof({ focus: 3, max_coc: 32, band: { center: BAND_ROW + 0.5, width: 80, feather: 40, angle: 0, amount: 12 } }),
  }, { transport: { span: '1s' } });
}

describe(`${ID} depth of field never spreads far over near, blurs by distance in an orthographic view, and keeps a tilt band's centre sharp`, () => {
  it(`${ID} on the occlusion fixture no far sample brightens a sharper nearer pixel, while the far wall's edge spreads over the farther sky`, () => {
    requireMetal();
    const dir = out();
    const docs = [occlusionDoc(false), occlusionDoc(true)];
    const [sharp, blurred] = runGpu(bin(), dir, docs.map((d, k) => view3d({ doc: writeJson(dir, `occlusion-${k}`, d), size: SIZE, capture: [0], targets: ['pre_tone'] })))
      .map((r, k) => readPreTone(dir, frameAt(framesOf(r, String(docs[k]!['id'])), 0, String(docs[k]!['id'])), SIZE, String(docs[k]!['id'])));
    const failures: string[] = [];
    let worst = 0;
    // The plate's edge is the frame's centre column (x = 480): pixels 0 to 477 are 2.5 px or more inside it.
    for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x <= 477; x++) {
      const rise = at(blurred!, x, y) - at(sharp!, x, y);
      worst = Math.max(worst, rise);
      if (rise > 0.01 && failures.length < 20) failures.push(`near_plate pixel (${x}, ${y}) brightened by far samples: ${at(sharp!, x, y).toFixed(4)} sharp, ${at(blurred!, x, y).toFixed(4)} with dof`);
    }
    let spread = 0;
    for (let y = 200; y <= 440; y++) for (let x = 721; x <= 727; x++) spread = Math.max(spread, at(blurred!, x, y) - at(sharp!, x, y));
    console.log(`${ID} occlusion: the largest rise on the near plate is ${worst.toFixed(5)}; the far wall's edge spreads ${spread.toFixed(3)} into the sky beside it`);
    if (!(spread >= 0.5)) failures.push(`far_wall: the gather doesn't run: its edge spreads only ${spread.toFixed(4)} into the sky beside it (at least 0.5 wanted)`);
    none(failures, `${ID}: far never spreads over near`);
  });

  it(`${ID} an orthographic camera blurs by distance to the focus plane (|Δ| × ortho_coc), and the tilt band's centre row keeps a CoC under 0.5 px`, () => {
    requireMetal();
    const dir = out();
    const docs = [orthoDoc(), bandDoc()];
    const [ortho, band] = runGpu(bin(), dir, [
      view3d({ doc: writeJson(dir, 'ortho', docs[0]!), size: SIZE, capture: [0], targets: ['pre_tone'] }),
      view3d({ doc: writeJson(dir, 'band', docs[1]!), size: SIZE, capture: [0], targets: ['coc'] }),
    ]);
    const failures: string[] = [];
    const lum = readPreTone(dir, frameAt(framesOf(ortho!, 'ortho-blur'), 0, 'ortho-blur'), SIZE, 'ortho-blur');
    for (const p of ORTHO_POINTS) {
      const d = measureDisc(lum, p.px, 20);
      console.log(`${ID} orthographic: ${p.id} (${p.z} m from the focus plane) is ${d.across.toFixed(2)} px across${p.across === null ? ' (on the plane)' : ` (want ${p.across} ± 1)`}`);
      if (p.across === null ? !(d.across < 2) : !(Math.abs(d.across - p.across) <= 1)) failures.push(`${p.id}: ${d.across.toFixed(2)} px across, not ${p.across === null ? 'under 2 px on the focus plane' : `${p.across} ± 1 px (|Δ| × ortho_coc)`}`);
    }
    const coc = readCoc(dir, frameAt(framesOf(band!, 'tilt-band'), 0, 'tilt-band'), SIZE, 'tilt-band');
    let centre = 0;
    for (let x = 0; x < SIZE[0]; x++) centre = Math.max(centre, Math.abs(at(coc, x, BAND_ROW)));
    const away = [20, 620].map((y) => median(Array.from({ length: SIZE[0] }, (_, x) => Math.abs(at(coc, x, y)))));
    console.log(`${ID} tilt band: the largest |CoC| on its centre row ${BAND_ROW} is ${centre.toFixed(4)} px; the median |CoC| on rows 20 and 620 is ${away.map((v) => v.toFixed(2)).join(' and ')} px`);
    if (!(centre < 0.5)) failures.push(`band: its centre row ${BAND_ROW} reaches a CoC of ${centre.toFixed(4)} px (under 0.5 wanted)`);
    away.forEach((v, k) => { if (!(v >= 2)) failures.push(`band: row ${[20, 620][k]} far from the band has a median CoC of ${v.toFixed(3)} px: the band adds no blur away from its centre`); });
    none(failures, `${ID}: the orthographic blur and the tilt band`);
  });
});
