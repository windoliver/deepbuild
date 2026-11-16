// Oracle lane, criterion 4 (AC4 #233.ca1d4667), port: a fork of the upstream math-film library at cfd33af5aa,
// tests/unit/test_mobject.py:459-468, `test_to_edge_puts_the_box_buff_in_from_the_frames_edge`: to_edge toward each of
// eight directions (the corners to_corner takes included) puts the object's box `buff` in from the frame's edge on each
// axis the direction has, within 1e-9.
//
// Upstream draws an object, a direction and a buff in [0, 1] by property search; here a Square (side 2) to_edge toward
// each of UP, DOWN, LEFT, RIGHT, UL, UR, DL and DR, at the default buff (0.5) and at buff 0, 0.25 and 1, each a math.square
// instance with `to_edge: {edge, buff}` (README: Documents), on the default 1920 × 1080 frame (14.22 × 8 math@1 units)
// and on a portrait 1080 × 1920 one, drawn through `deep-canvas-render geometry`. On each axis the direction has, the
// box's edge on that side lies buff × (short side ÷ 8) u in from the frame's edge, within 1e-6 u (upstream's 1e-9
// units, widened to what u in f64 keeps: README: Tolerances).
// Not ported: other objects than a square (any box reads the same); the y-up twin (ours, in the issue's own lane).
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, boxOf, drawnParts, mathDoc, none, unitOf, useBins, useFolders, type Box, type JsonObject, type P2, type Spec } from './helpers.ts';

const bin = useBins(['deep-show', 'deep-canvas-render']);
const folder = useFolders();
/** Each direction's unit vector, upstream's, with y up. */
const DIRECTIONS: Record<string, P2> = { UP: [0, 1], DOWN: [0, -1], LEFT: [-1, 0], RIGHT: [1, 0], UL: [-1, 1], UR: [1, 1], DL: [-1, -1], DR: [1, -1] };
const BUFFS: (number | null)[] = [null, 0, 0.25, 1];

describe(`${AC[4]} (oracle, port) to_edge puts the box buff in from the frame's edge`, () => {
  for (const size of [[1920, 1080], [1080, 1920]] as P2[]) {
    it(`${AC[4]} on ${size.join(' × ')}: a square to_edge toward each of eight directions, at buffs 0.5 (default), 0, 0.25 and 1`, () => {
      const items: Record<string, Spec> = {};
      for (const [name] of Object.entries(DIRECTIONS)) {
        for (const buff of BUFFS) items[`sq_${name.toLowerCase()}_${buff === null ? 'default' : String(buff).replace('.', '_')}`] = { kind: 'math.square@1', params: { side_length: 2, to_edge: buff === null ? name : { edge: name, buff } } };
      }
      const doc: JsonObject = mathDoc(`Squares to each edge, ${size.join(' × ')}`, size, items);
      const { derived, geo, why } = drawnParts(bin('deep-show'), bin('deep-canvas-render'), folder, doc, Object.keys(items));
      expect(why, 'the figure is presented and drawn').toBe('');
      const unit = unitOf(size);
      const failures: string[] = [];
      for (const [id] of Object.entries(items)) {
        const [, dirName, buffText] = /^sq_([a-z]+)_(.+)$/.exec(id)!;
        const dir = DIRECTIONS[dirName!.toUpperCase()]!;
        const buff = buffText === 'default' ? 0.5 : Number(buffText!.replace('_', '.'));
        const bs = Object.keys(derived).filter((d) => d === id || d.startsWith(`${id}.`)).map((d) => boxOf(geo[d]!)).filter((b): b is Box => b !== null);
        if (!bs.length) { failures.push(`${id}: no box drawn`); continue; }
        const x0 = Math.min(...bs.map((b) => b[0])); const y0 = Math.min(...bs.map((b) => b[1]));
        const x1 = Math.max(...bs.map((b) => b[0] + b[2])); const y1 = Math.max(...bs.map((b) => b[1] + b[3]));
        const want = buff * unit;
        const gaps: [string, number][] = [];
        if (dir[0] > 0) gaps.push(['right', size[0] - x1]);
        if (dir[0] < 0) gaps.push(['left', x0]);
        if (dir[1] > 0) gaps.push(['top', y0]);
        if (dir[1] < 0) gaps.push(['bottom', size[1] - y1]);
        for (const [edge, gap] of gaps) if (Math.abs(gap - want) > 1e-6) failures.push(`${id}: its ${edge} edge is ${gap} u in from the frame's, not ${want}`);
      }
      none(failures, 'every box buff in from the frame\'s edge');
    }, TIMEOUT);
  }
});
