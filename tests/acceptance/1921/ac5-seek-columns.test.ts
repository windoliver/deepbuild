// #1921.ff1e7756: a seek to step 300 writes the instancer's columns byte for byte as play does; a planted output that
// keeps the previous frame's columns fails, naming the step.
//
// The drop (helpers.ts: dropScene), presented twice in one `deep-show run`: document A is played, `eval` at every 60
// fps frame from 0 to 150 in order (frame 150 is t = 2.5 s, step 300); document B is evaluated at frame 0 and then at
// frame 150, a seek on its session (#497's convention). At frame 150 each reads, through `eval`'s `paths`, both
// instancers' `params/pos` and `params/rot` columns as the frame draws them (README: The surface under test): rows in
// the instancer's row order, each value an f32. At step 300, 115 of the 800 bodies are still awake (a reading off the
// base's backend for this world declared one by one), so the frame isn't a still one.
//
// Play's columns at frame 150 are, byte for byte, the element bodies' poses after step 300 from `deep-physics`'s bake
// of the same scene; the seek's are play's, byte for byte (so -0 and 0 differ). B's frame 0, the frame before the seek,
// draws the bodies where they were dropped, so a seek that keeps it can't pass. The planted twin is the scenario's
// `planted: "output_keeps_previous_columns"`: each frame writes the columns of the frame the session drew before; judged
// the same way, it fails, naming step 300.
import { describe, expect, it } from 'vitest';
import {
  COLUMN_WIDTH, COUNT, CRITERIA, DOC, DROP_STEPS, INSTANCERS, TIMEOUT, address, bakedColumn, columnOf, dropBake, dropScene, elementIds,
  evalCall, firstByteDiff, none, prebuild, prebuildShow, presented, rowText, runShow, scenario, showBin, showCall, useTemp,
  valuesOf, withPlanted, type Column, type ShowPlanted,
} from './helpers.ts';

prebuild();
prebuildShow(['full']);

const ID = CRITERIA[5];
const temp = useTemp();
const STEP = 300;
const FRAME = STEP / 2;
const COLUMNS: Column[] = ['pos', 'rot'];
const paths = INSTANCERS.flatMap((inst) => COLUMNS.map((c) => `items/${inst}/params/${c}`));

function seekProblems(planted?: ShowPlanted): string[] {
  const { poses } = dropBake(DROP_STEPS, STEP);
  const scene = dropScene();
  const [a, b] = [DOC(51), DOC(52)];
  const play = Array.from({ length: FRAME + 1 }, (_, f) => evalCall(a, f, f === FRAME ? paths : []));
  const calls = [showCall(a, scene), ...play, showCall(b, scene), evalCall(b, 0, paths), evalCall(b, FRAME, paths)];
  const replies = runShow(showBin('full'), withPlanted(scenario(temp(), [a, b], calls), planted), `the drop, played and seeked${planted ? ` (planted ${planted})` : ''}`);
  presented(replies[0], 'the drop (played)');
  presented(replies[FRAME + 2], 'the drop (seeked)');
  const [played, before, seeked] = [replies[FRAME + 1], replies[FRAME + 3], replies[FRAME + 4]].map((r, i) => valuesOf(r, ['play at frame 150', 'the seek\'s session at frame 0', 'the seek to frame 150'][i]!));
  const problems: string[] = [];
  for (const inst of INSTANCERS) {
    for (const c of COLUMNS) {
      const w = COLUMN_WIDTH[c];
      const path = `items/${inst}/params/${c}`;
      const fails: string[] = [];
      const p = columnOf(played![path], COUNT, w, `step ${STEP}: play's ${path}`, fails);
      const s = columnOf(seeked![path], COUNT, w, `step ${STEP}: the seek's ${path}`, fails);
      const z = columnOf(before![path], COUNT, w, `the seek's session at frame 0: ${path}`, fails);
      problems.push(...fails.slice(0, 3));
      if (fails.length) continue;
      const baked = bakedColumn(poses[inst], 1, c);
      const pr = firstByteDiff(p, baked, w);
      if (pr >= 0) problems.push(`step ${STEP}: play writes ${path} row ${pr} (${address(inst, elementIds[pr]!)}) as ${rowText(p, pr, w)}, its body after step ${STEP} is ${rowText(baked, pr, w)}`);
      const sr = firstByteDiff(s, p, w);
      if (sr >= 0) problems.push(`step ${STEP}: the seek writes ${path} row ${sr} (${address(inst, elementIds[sr]!)}) as ${rowText(s, sr, w)}, play writes ${rowText(p, sr, w)}`);
      const zr = firstByteDiff(z, bakedColumn(poses[inst], 0, c), w);
      if (zr >= 0) problems.push(`step 0: the seek's session writes ${path} row ${zr} (${address(inst, elementIds[zr]!)}) at frame 0 as ${rowText(z, zr, w)}, its body as built is ${rowText(bakedColumn(poses[inst], 0, c), zr, w)}`);
      if (c === 'pos') expect(firstByteDiff(bakedColumn(poses[inst], 0, c), baked, w), `the ${inst} move between step 0 and step ${STEP}, so a seek that keeps the frame before it can't pass`).toBeGreaterThanOrEqual(0);
    }
  }
  return problems;
}

describe(`${ID} a seek writes an instancer's columns as play does`, () => {
  it(`${ID} a seek to step 300 writes the instancer's columns byte for byte as play does`, () => {
    none(seekProblems(), 'both instancers\' pos and rot columns at step 300, played and seeked');
  }, TIMEOUT);

  it(`${ID} (twin) a planted output that keeps the previous frame's columns fails, naming the step`, () => {
    const problems = seekProblems('output_keeps_previous_columns');
    expect(problems.length, 'output_keeps_previous_columns fails the judge that passes the real output').toBeGreaterThan(0);
    expect(problems.filter((p) => p.startsWith(`step ${STEP}:`)), `a failure names step ${STEP}: ${problems.slice(0, 5).join('; ')}`).not.toEqual([]);
  }, TIMEOUT);
});
