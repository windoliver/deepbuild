// AC4 #443.c78c7ccd: "In a test build without the vector module, an `extrude` whose outline names a vector item is
// refused with `module_missing`, naming vector, while the same title from text extrudes; scene3d's interface digest
// is the same with the vector module and without it, and a planted scene3d that reads vector items directly adds an
// edge the seal refuses, naming it"
//
// asserts: `full,test-leave-out-vector` seals without vector; in it, a scene whose `extrude@1` outline names the
// vector item `logo` (fixtures/ring.svg) is refused with a `module_missing` error naming vector, and no error naming
// the extrude has another code; in the same run the title "OB" extruded from text is presented and builds its two
// closed shells (glyph0, glyph1). `schedule`'s scene3d@1 digest is the same string in `full` and without vector. The
// build `full,test-scene3d-reads-vector` (a planted scene3d whose extrude reads vector@1's items itself) is refused at
// the seal, the refusal naming scene3d and vector; `full` seals (the control).
// Wrong programs: scene3d reaching vector's code or items (a hard edge, a digest that moves with vector); an outline
// form left to fail some other way than module_missing; a text title that needs vector.

import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, NO_VECTOR, READS_VECTOR, arr, REGISTRY, RING_SVG, SCHEDULE, SLOW, admitted, extrude, geometryCall, geometryOf, interfaceDigest, mentions,
  namesItem, none, putBytes, refusalOf, refusedWith, runShow, scenario, sceneDoc, show, shown, startup, str, textOutline, useBuilds, useDir, vectorItem,
} from './helpers.ts';

const bin = useBuilds([FULL, NO_VECTOR, READS_VECTOR]);
const dir = useDir();

describe(`${AC[4]} scene3d reads outlines only through the core's registry`, () => {
  it(`${AC[4]} without the vector module, an extrude of a vector item is refused with module_missing naming vector, while the same title from text extrudes`, () => {
    const ring = putBytes(dir(), RING_SVG());
    const fromVector = sceneDoc('A logo in depth', { logo: vectorItem(ring, 'A ring'), logo3d: extrude({ vector: 'logo', size: 1 }) }, ['vector']);
    const fromText = sceneDoc('A title in depth', { title: extrude(textOutline('OB')) });
    const [registry, refused, presented, geometry] = runShow(bin(NO_VECTOR), scenario(dir(), [DOC.a, DOC.b], [REGISTRY, show(DOC.a, fromVector), show(DOC.b, fromText), geometryCall(DOC.b, ['title'])]));
    expect(arr(registry!['modules'], 'registry: modules').map((m) => str(m, 'a module')), 'the test build holds no vector module').not.toContain('vector');
    const errs = refusedWith(refused!, 'the extrude of a vector item without vector');
    const failures: string[] = [];
    if (!errs.some((e) => e.code === 'module_missing' && mentions(e.raw, 'vector'))) failures.push(`no module_missing error names vector: ${errs.map((e) => JSON.stringify(e.raw)).join('; ')}`);
    for (const e of errs.filter((x) => namesItem(x, 'logo3d') && x.code !== 'module_missing')) failures.push(`the extrude is refused with ${e.code}, not module_missing: ${JSON.stringify(e.raw)}`);
    none(failures, 'the refusal');
    admitted(presented!, 'the title from text without vector');
    const g = geometryOf(geometry!, 'title', 'the title from text without vector');
    expect(g.closed.map((c) => c.name).sort(), `the title from text builds its two shells without vector: ${shown(g.raw['closed'])}`).toEqual(['glyph0', 'glyph1']);
  }, SLOW);

  it(`${AC[4]} scene3d's interface digest is the same with the vector module and without it`, () => {
    const digest = (b: typeof FULL): string => interfaceDigest(runShow(bin(b), scenario(dir(), [], [SCHEDULE]))[0]!, 'scene3d@1');
    const [withVector, without] = [digest(FULL), digest(NO_VECTOR)];
    none(withVector === without ? [] : [`scene3d@1's interface digest is ${withVector} with vector and ${without} without it`], 'scene3d@1\'s digest');
  }, SLOW);

  it(`${AC[4]} a planted scene3d that reads vector items directly adds an edge the seal refuses, naming it`, () => {
    expect(startup(bin(FULL)).status, 'the full build seals (the control)').toBe(0);
    const r = refusalOf(startup(bin(READS_VECTOR)), 'the planted scene3d that reads vector items');
    expect(['scene3d', 'vector'].filter((m) => !r.modules.includes(m)), `the refusal names the edge scene3d → vector: ${shown(r.raw)}`).toEqual([]);
  }, SLOW);
});
