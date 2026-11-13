// AC2 #1401.b2d6901b: A sky pixel returns `hits: []`; a planted nearest-item probe fails.
//
// The fixture: one shared document, stored at revision 0 in test agent alpha's layer: `block`, a `mark.box@1` of 2 m
// centred at the origin, unlit and opaque, over a black sky with nothing else in it; `cam` 8 m in front of it and 1.5 m
// up, looking at its centre (fov 40°, 320 × 240 px), so a pixel there spans about 1.8 cm. One render-back by alpha at t
// = 0 of revision 0 from the document's camera, with 23 probes:
// - 3 on the block's front face, each at least 0.4 m inside its edges: each answers exactly one hit naming `block`,
//   its point within 1e-5 m of where the probe's ray meets the face, so a program that answers every probe `[]` fails;
// - 18 sky pixels in three runs leaving the block's silhouette (right, left and up from its centre), 0, 1, 2, 4, 8 and
//   16 px past the first pixel whose ray misses the block (that ray clears the block by at least 1 mm, about 0.05 px),
//   and the frame's two far corners: each ray meets nothing, so each answers `hits: []`.
// The sky pixels nearest the block lie within the object-ID pick's 3 px margin (#424), so a probe that takes the
// pick's item for the ray's answers there too: the CPU ray decides, never the pick alone.
//
// The planted twin, scenario `planted: "probe_nearest_item"`, answers a probe whose ray meets nothing with the item
// drawn nearest its pixel. The same check fails on it, naming a sky probe.
import { describe, expect, it } from 'vitest';
import {
  AC2, DARK_SKY, boxHits, boxItem, cameraItem, hitBox, hitLists, listFailures, pixelOf, probeRay, proof, renderBack, requireMetal, runShow,
  scenario, sceneDoc, slot, unlit, useDir, useShow, type Box, type JsonValue, type Pinhole, type Pixel, type Planted, type Want,
} from './helpers.ts';

const bin = useShow();
const dir = useDir();

const SIZE: [number, number] = [320, 240];
const BOUND = 1e-5;
const CAM: Pinhole = { position: [0, 1.5, 8], target: [0, 0, 0], fov: 40, size: SIZE };
const BLOCK: Box = { id: 'block', centre: [0, 0, 0], size: [2, 2, 2] };
/** How far a sky probe's ray must clear the block: 1 mm, about 0.05 px here. */
const CLEAR = 1e-3;

const DOCUMENT = sceneDoc('A block against the sky', 'cam', {
  cam: cameraItem(CAM.position, CAM.target, CAM.fov, 0.5, 100), sky: DARK_SKY, block_mat: unlit([0.8, 0.35, 0.1]),
  block: boxItem(BLOCK.centre, BLOCK.size, 'block_mat'),
});

interface Probe { px: Pixel; label: string; sky: boolean; want: Want[] }
const misses = (p: Pixel): boolean => hitBox(CAM.position, probeRay(CAM, p), BLOCK, CLEAR) === null;

/** The 23 probes (header). */
function fixture(): Probe[] {
  const probes: Probe[] = [];
  const add = (px: Pixel, label: string, sky: boolean): void => {
    probes.push({ px, label: `${label}, pixel (${px[0]}, ${px[1]})`, sky, want: boxHits(CAM.position, probeRay(CAM, px), [BLOCK]) });
  };
  for (const [x, y] of [[-0.5, 0], [0.5, 0.5], [0, -0.5]] as [number, number][]) add(pixelOf(CAM, [x, y, 1]), `the block's front face at (${x}, ${y}, 1)`, false);
  const centre = pixelOf(CAM, BLOCK.centre);
  for (const [name, step] of [['right', [1, 0]], ['left', [-1, 0]], ['up', [0, -1]]] as [string, Pixel][]) {
    let edge: Pixel = [...centre];
    while (!misses(edge)) edge = [edge[0] + step[0], edge[1] + step[1]];
    for (const n of [0, 1, 2, 4, 8, 16]) add([edge[0] + n * step[0], edge[1] + n * step[1]], `sky ${n} px past the block's silhouette, ${name}`, true);
  }
  add([2, 2], 'sky in the frame\'s top left corner', true);
  add([SIZE[0] - 3, SIZE[1] - 3], 'sky in the frame\'s bottom right corner', true);
  return probes;
}
const PROBES = fixture();

/** The render-back's hit lists for the probes, in order. */
function probed(planted?: Planted): JsonValue[][] {
  const evidence = dir();
  const replies = runShow(bin(), scenario(evidence, DOCUMENT, [renderBack(slot(0), { t: 0, rev: 0, probes: PROBES.map((p) => p.px) })], planted), `sky probes${planted ? `, planted ${planted}` : ''}`);
  return hitLists(replies[0]!, PROBES.length, `${planted ? `planted ${planted}: ` : ''}render-back of the block`);
}

/** Every probe against its analytic hits: none for a sky pixel, the block's face for the others. */
const failures = (lists: JsonValue[][]): string[] => PROBES.flatMap((p, i) => listFailures(p.label, lists[i]!, p.want, BOUND));

describe(`${AC2} a sky pixel returns no hits`, () => {
  it(`${AC2} a sky pixel returns hits: []; a planted nearest-item probe fails`, () => {
    requireMetal();
    // The fixture: the face probes meet the block and only it; every sky probe's ray clears it by 1 mm; no pixel twice.
    for (const p of PROBES.filter((x) => !x.sky)) expect(p.want.map((w) => w.item), `the fixture: ${p.label} meets the block`).toEqual(['block']);
    for (const p of PROBES.filter((x) => x.sky)) expect(misses(p.px), `the fixture: ${p.label} clears the block by ${CLEAR} m`).toBe(true);
    expect(new Set(PROBES.map((p) => p.px.join(','))).size, 'the fixture: no pixel probed twice').toBe(PROBES.length);

    const lists = probed();
    proof('AC2 sky probes and their hits', PROBES.flatMap((p, i) => (p.sky ? [{ probe: p.px, hits: lists[i] ?? null }] : [])));
    const real = failures(lists);
    expect(real, 'each sky probe answers hits: [] and each face probe its one hit on the block').toEqual([]);

    // The planted nearest-item probe fails the same check, naming a sky probe.
    const twin = failures(probed('probe_nearest_item'));
    proof('AC2 planted probe_nearest_item failures', twin.slice(0, 8));
    expect(twin.length, 'planted probe_nearest_item fails the check, but the check found nothing wrong').toBeGreaterThan(0);
    expect(twin.some((f) => f.startsWith('sky')), `planted probe_nearest_item fails on a sky probe; its failures were:\n  ${twin.join('\n  ')}`).toBe(true);
  }, 1_800_000);
});

