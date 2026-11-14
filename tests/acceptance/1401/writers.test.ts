// AC5 #1401.39142bf2: A probe landing on another writer's layer returns `ref_unresolved` and no position.
//
// The fixture: one shared document, stored at revision 0, that two test agents write: alpha's layer `alpha-main`
// (writer `agent:thread-alpha`) holds the camera, the sky and `alpha.block`, an opaque `mark.box@1` of 2 m centred at
// (−2, 0, 0); bravo's layer `bravo-main` (writer `agent:thread-bravo`) holds `bravo.block`, the same box centred at
// (2, 0, 0), and its material. `cam` at (0, 1, 12) looks at the origin (fov 40°, 320 × 240 px); nothing else is in
// view. 6 probes, 3 on each block's front face, each at least 0.5 m inside its edges, each ray meeting that block and
// nothing else (checked here).
//
// Two render-backs at t = 0 of revision 0 from the document's camera, one by each agent's session, with the 6 probes.
// A probe on the caller's own block answers exactly one hit naming it, its point within 1e-5 m of where the ray meets
// the face. A probe on the other agent's block lands on another writer's layer: its list holds an entry whose `code` is
// `ref_unresolved`, and no entry of it carries a position (`point`, `distance` or `geo`) (README: Readings). Wrong
// programs this fails: one that answers the other writer's hit with its point, one that answers `[]` there as if it
// were sky, one that answers `ref_unresolved` everywhere, and one that takes a fixed layer as the caller's.
import { describe, expect, it } from 'vitest';
import {
  AC5, ALPHA, BRAVO, DARK_SKY, boxHits, boxItem, cameraItem, hitLists, isObject, listFailures, pixelOf, probeRay, proof, renderBack,
  requireMetal, runShow, scenario, sceneDoc, shown, slot, unlit, useDir, useShow, type Box, type JsonValue, type Pinhole, type Pixel,
  type SessionFixture, type Want,
} from './helpers.ts';

const bin = useShow();
const dir = useDir();

const SIZE: [number, number] = [320, 240];
const BOUND = 1e-5;
const CAM: Pinhole = { position: [0, 1, 12], target: [0, 0, 0], fov: 40, size: SIZE };
const BLOCKS: Record<string, Box> = {
  [ALPHA.id]: { id: 'alpha.block', centre: [-2, 0, 0], size: [2, 2, 2] },
  [BRAVO.id]: { id: 'bravo.block', centre: [2, 0, 0], size: [2, 2, 2] },
};
const ALPHA_BLOCK = BLOCKS[ALPHA.id]!; const BRAVO_BLOCK = BLOCKS[BRAVO.id]!;

const DOCUMENT = sceneDoc('Two agents\' blocks', 'cam', {
  cam: cameraItem(CAM.position, CAM.target, CAM.fov, 0.5, 100), sky: DARK_SKY, 'alpha.mat': unlit([0.8, 0.35, 0.1]),
  'alpha.block': boxItem(ALPHA_BLOCK.centre, ALPHA_BLOCK.size, 'alpha.mat'),
  'bravo.mat': { ...unlit([0.1, 0.4, 0.8]), layer: BRAVO.layer },
  'bravo.block': { ...boxItem(BRAVO_BLOCK.centre, BRAVO_BLOCK.size, 'bravo.mat'), layer: BRAVO.layer },
});

interface Probe { px: Pixel; owner: SessionFixture; label: string; want: Want[] }
const OFFSETS: [number, number][] = [[0, 0], [-0.5, 0.5], [0.5, -0.5]];
const PROBES: Probe[] = [ALPHA, BRAVO].flatMap((owner) => OFFSETS.map(([x, y]) => {
  const b = BLOCKS[owner.id]!;
  const px = pixelOf(CAM, [b.centre[0] + x, b.centre[1] + y, b.centre[2] + 1]);
  return { px, owner, label: `${b.id}'s front face at (${x}, ${y}) from its centre, pixel (${px[0]}, ${px[1]})`, want: boxHits(CAM.position, probeRay(CAM, px), [ALPHA_BLOCK, BRAVO_BLOCK]) };
}));

/** A probe on another writer's layer: an entry with `code: ref_unresolved`, and no position in any entry. */
function unresolvedFailures(label: string, got: JsonValue[]): string[] {
  const f: string[] = [];
  if (!got.some((e) => isObject(e) && e['code'] === 'ref_unresolved')) f.push(`${label}: lands on another writer's layer, so its list holds an entry with \`code: ref_unresolved\`; got ${shown(got)}`);
  for (const [i, e] of got.entries()) {
    const placed = isObject(e) ? ['point', 'distance', 'geo'].filter((k) => e[k] !== undefined && e[k] !== null) : [];
    if (placed.length > 0) f.push(`${label}: lands on another writer's layer, yet entry ${i} gives a position (${placed.map((k) => `\`${k}\``).join(', ')}): ${shown(e)}`);
  }
  return f;
}

describe(`${AC5} a probe on another writer's layer`, () => {
  it(`${AC5} a probe landing on another writer's layer returns ref_unresolved and no position`, () => {
    requireMetal();
    for (const p of PROBES) expect(p.want.map((w) => w.item), `the fixture: ${p.label} meets that block and nothing else`).toEqual([BLOCKS[p.owner.id]!.id]);
    expect(new Set(PROBES.map((p) => p.px.join(','))).size, 'the fixture: no pixel probed twice').toBe(PROBES.length);

    const callers = [ALPHA, BRAVO];
    const calls = callers.map((s, i) => renderBack(slot(i), { session: s.id, t: 0, rev: 0, probes: PROBES.map((p) => p.px) }));
    const replies = runShow(bin(), scenario(dir(), DOCUMENT, calls), 'each agent probes both blocks');
    const failures: string[] = [];
    callers.forEach((caller, i) => {
      const lists = hitLists(replies[i]!, PROBES.length, `render-back by ${caller.id}`);
      proof(`AC5 hits for ${caller.id}`, PROBES.map((p, k) => ({ probe: p.px, layer: p.owner.layer, hits: lists[k] ?? null })));
      PROBES.forEach((p, k) => {
        const label = `${caller.id}'s probe on ${p.label}`;
        failures.push(...(p.owner === caller ? listFailures(label, lists[k]!, p.want, BOUND) : unresolvedFailures(label, lists[k]!)));
      });
    });
    expect(failures, 'a probe on the caller\'s own block answers its hit; one on the other agent\'s block answers ref_unresolved and no position').toEqual([]);
  }, 1_800_000);
});
