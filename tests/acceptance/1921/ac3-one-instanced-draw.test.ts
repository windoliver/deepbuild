// #1921.877e2ad5: with 400 boxes and 400 balls written back through `<body>#*` outputs, the frame's draw list holds
// exactly 2 instanced draws for them, one per prototype and material.
//
// The drop (helpers.ts: dropScene): instancers `boxes` (prototype `cube`, material `box_mat`) and `balls` (prototype
// `bead`, material `ball_mat`), 400 elements each, one body per element through `each:`, written back by the outputs
// `{from: "boxes#*", read: "pose", to: "items/boxes"}` and its twin for balls; an unshadowed sun, so the camera's view is
// the only view drawn. `deep-gpu run`'s `view3d` draws frames 0 … 60 (t = f ÷ 60 s, step 2f) with #484's counters and
// #429's `evaluate` reading each instancer's `params/pos`, the column the frame drew (README: The surface under test).
//
// At frame 60 (1 s, while most bodies still fall) each instancer's evaluated `pos` column holds its element bodies'
// positions after step 120 from `deep-physics`'s bake of the same scene, row by row, within 1e-6 m: the poses are
// written back. At every frame the camera's view holds exactly one indexed indirect draw of `boxes` and one of `balls`
// (both have more than 256 elements, so each batch is culled on the GPU and drawn by one indirect draw: Instance
// `instance@1`), in two batches, and no batch the frame encoded draws an element as an item of its own (an item ID
// holding `#`). A program that draws each body as its own item, splits an instancer into draws per element or per range,
// or never writes the bodies' poses back fails here.
import { describe, expect, it } from 'vitest';
import {
  COUNT, CRITERIA, INSTANCERS, TIMEOUT, address, dropBake, dropDoc, drawnOf, elementIds, gpu, none, prebuild, prebuildGpu,
  requireGpu, show, useDirs, view3d,
} from './helpers.ts';

prebuild();
prebuildGpu();

const ID = CRITERIA[3];
const dirs = useDirs();
const LAST = 60;
const POS_TOL = 1e-6;

describe(`${ID} hundreds of bodies written back through <body>#* outputs stay one instanced draw per prototype and material`, () => {
  it(`${ID} with 400 boxes and 400 balls written back through <body>#* outputs, each frame's draw list holds exactly 2 instanced draws for them, one per prototype and material`, () => {
    requireGpu();
    const { poses } = dropBake(2 * LAST, 2);
    const out = dirs();
    const paths = INSTANCERS.map((inst) => `items/${inst}/params/pos`);
    const [reply] = gpu(out, [view3d(dropDoc(out), LAST + 1, { evaluate: paths })]);
    const frames = drawnOf(reply!, 'the drop, frames 0 to 60');
    expect(frames.map((f) => f.frame), 'the run draws frames 0 to 60').toEqual(Array.from({ length: LAST + 1 }, (_, f) => f));

    const fails: string[] = [];
    const last = frames[LAST]!;
    for (const inst of INSTANCERS) {
      const column = last.values?.[`items/${inst}/params/pos`];
      if (!Array.isArray(column) || column.length !== COUNT) { fails.push(`frame ${LAST}: items/${inst}/params/pos isn't ${COUNT} rows: ${show(column).slice(0, 200)}`); continue; }
      const bad = elementIds.findIndex((_, j) => {
        const row = column[j];
        const want = poses[inst][j]![LAST]!.pos;
        return !Array.isArray(row) || row.length !== 3 || row.some((x, i) => typeof x !== 'number' || Math.abs(x - want[i]!) > POS_TOL);
      });
      if (bad >= 0) fails.push(`frame ${LAST}: ${inst} row ${bad} (${address(inst, elementIds[bad]!)}) is drawn at ${show(column[bad])}, its body after step ${2 * LAST} is at ${show(poses[inst][bad]![LAST]!.pos)}`);
    }
    none(fails, 'the frame draws each element where its body is: the poses are written back');

    for (const f of frames) {
      if (f.indirect === null) { fails.push(`frame ${f.frame} reports no indirect_draws`); continue; }
      const view = f.indirect.filter((d) => d.view === 'view' && (INSTANCERS as readonly string[]).includes(d.item));
      const of = (inst: string): number => view.filter((d) => d.item === inst).length;
      const batches = new Set(view.map((d) => d.batch)).size;
      if (of('boxes') !== 1 || of('balls') !== 1 || batches !== 2) fails.push(`frame ${f.frame}: the view holds ${of('boxes')} instanced draws of boxes and ${of('balls')} of balls in ${batches} batches, not one each in two: ${show(view)}`);
      const items = (f.encoded ?? []).flatMap((b) => b.items).filter((i) => i.includes('#'));
      if (items.length) fails.push(`frame ${f.frame}: elements drawn as items of their own: ${items.slice(0, 5).join(', ')}${items.length > 5 ? ` and ${items.length - 5} more` : ''}`);
    }
    none(fails, 'each frame\'s draw list: exactly 2 instanced draws for the 800 bodies, one per prototype and material');
  }, TIMEOUT);
});
