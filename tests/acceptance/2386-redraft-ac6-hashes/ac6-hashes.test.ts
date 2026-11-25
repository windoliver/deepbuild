// AC6 #2386.b3f6fe16: 10,000 rows with `draw` from one atlas draw in one instanced draw for their atlas. Each fixture
// of #1653 and #536 keeps its pixel hash. Budgets, on the reference Mac in the local preflight, compared with the
// merge base: the 10,000 rows add under 0.1 ms a frame over the same set without `draw` (drafted, a target to be
// measured)
// (this file carries one clause: "Each fixture of #1653 and #536 keeps its pixel hash", with the Scope line it holds:
// "No pixel of any set without the two fields changes")
//
// Every picture is `deep-canvas-render raster {out, doc, look, t: 0, store, view: {zoom}}` (Vello CPU, every
// platform). The pictures are the two suites' fixtures that draw an atlas tile set (helpers.ts `PICTURES`), and a
// picture's hash is the SHA-256 of its RGBA pixels; base-hashes.json holds what each drew to at the merge base.
// Before a picture is read, the layout the issue and the design state is worked out here in f64 (helpers.ts
// `quadsOf`, `drawnAt`): each row's quad, the draw order, and at two named pixels the quad on top and the atlas texel
// it shows. `inside` lies in a row's quad; `below` lies under a last-line row's cell, where no quad reaches. A set
// with neither field draws the grid's cell, centered: `inside` reads the row's tile, `below` the bare page, and the
// hash is the base's. The same sets with `draw: [w, 2h]` and `anchor: [0.5, 0.25]` hang each tile from its cell's top
// edge, one cell height below its cell: `below` reads the row's tile, so the picture is another and its hash can't be
// the base's, which shows the hashes see a set's pixels. README: The fixtures; The hashes; Readings.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BASE, CLEAR, GROUND, ID, PICTURES, TIMEOUT, boxOf, decodePng, drawnAt, hung, make, none, pixelHash, quadsOf,
  rasterLine, reads, render, shown, useDir, useRender, type Image, type JsonObject, type Made,
} from './helpers.ts';

const bin = useRender();
const dir = useDir();

/** Each document drawn at its picture's zoom, all through one `raster` process: the picture, or the refusal. */
function draw(store: string, made: Made[], docs: JsonObject[]): { image?: Image; refusal: string }[] {
  const lines = docs.map((d, i) => rasterLine(store, d, 0, { store, view: { zoom: made[i]!.picture.zoom } }));
  return render(bin(), 'raster', lines).map((answer, i) => (answer['ok'] === true
    ? { image: decodePng(readFileSync(String(lines[i]!['out']))), refusal: '' }
    : { refusal: shown(answer) }));
}
const at = (p: [number, number]): string => `pixel (${p[0]}, ${p[1]})`;
const rgba = (c: number[]): string => `[${c.join(', ')}, 255]`;

describe(`${ID} each fixture of #1653 and #536 keeps its pixel hash`, () => {
  it(`${ID} each fixture of #1653 and #536, its sets without draw and anchor, draws the grid's cell, centered, as at the merge base: the named pixels read the row's tile and the bare page under its cell, and the pixel hash is the merge base's`, () => {
    expect(boxOf({ shape: 'isometric', cell: [64, 32] }, {}, 0, 0), 'the layout worked out here gives the issue\'s box for a draw that fills the grid\'s cell (criterion 1)').toEqual([-32, -16, 64, 32]);
    const store = dir();
    const made = PICTURES.map((p) => make(bin(), store, p));
    // What the layout draws at each named pixel, before any picture is read.
    const laid = made.map(({ picture: p, sets, atlas }) => {
      const quads = quadsOf(sets);
      const inside = drawnAt(quads, atlas, p.inside, p.zoom, p.name);
      expect(inside?.row, `${p.name}: at ${at(p.inside)} the top quad is that of ${p.row}, the grid's cell centered on its cell`).toBe(p.row);
      expect(drawnAt(quads, atlas, p.below, p.zoom, p.name), `${p.name}: no quad reaches ${at(p.below)}, ${CLEAR} px or more under the cell of ${p.under}`).toBeUndefined();
      return inside!.rgb;
    });
    const drawn = draw(store, made, made.map((m) => m.doc));
    const problems: string[] = [];
    made.forEach(({ picture: p }, i) => {
      const { image, refusal } = drawn[i]!;
      if (!image) { problems.push(`${p.name}: raster refused it: ${refusal}`); return; }
      const hash = pixelHash(image);
      console.log(`${ID} ${p.name}: zoom ${p.zoom}, ${image.width} × ${image.height} px, pixel hash ${hash}`);
      const tile = reads(image, p.inside, laid[i]!);
      if (!tile.ok) problems.push(`${p.name}: ${at(p.inside)} reads ${tile.got}, not the tile of ${p.row} ${rgba(laid[i]!)}`);
      const bare = reads(image, p.below, GROUND);
      if (!bare.ok) problems.push(`${p.name}: ${at(p.below)}, under the cell of ${p.under}, reads ${bare.got}, not the bare page ${rgba(GROUND)}`);
      const base = BASE.pictures[p.name];
      if (!base) { problems.push(`${p.name}: base-hashes.json holds no hash for it; this run's is ${hash}`); return; }
      if (image.width !== base.width || image.height !== base.height || p.zoom !== base.zoom) problems.push(`${p.name}: ${image.width} × ${image.height} px at zoom ${p.zoom}, the merge base's ${base.width} × ${base.height} at zoom ${base.zoom}`);
      if (hash !== base.sha256) problems.push(`${p.name}: pixel hash ${hash}, the merge base's ${base.sha256}: a pixel of a set without the two fields changed`);
    });
    none(problems, 'each fixture keeps its pixel hash');
  }, TIMEOUT);

  it(`${ID} the hashes see a set's pixels: the same sets with draw [w, 2h] and anchor [0.5, 0.25] hang each tile from its cell's top edge, so the pixel under the cell reads the row's tile where the page was bare, and no pixel hash is the merge base's`, () => {
    expect(boxOf({ shape: 'isometric', cell: [64, 32] }, { draw: [64, 64], anchor: [0.5, 0.75] }, 0, 0), 'the layout worked out here gives the issue\'s box for the wall at (0, 0) (criterion 1)').toEqual([-32, -48, 64, 64]);
    expect(boxOf({ shape: 'square', cell: [16, 16] }, { draw: [16, 32], anchor: [0.5, 0.75] }, 2, 3), 'the layout worked out here gives the issue\'s box for the tree at (2, 3) (criterion 3)').toEqual([24, 24, 16, 32]);
    const store = dir();
    const made = PICTURES.map((p) => make(bin(), store, p));
    const twins = made.map((m) => hung(m.sets));
    // What the issue's rule draws at the pixel under the cell: nothing with neither field, and with them the hung
    // quad of that row, on top. So the two pictures differ there.
    const laid = made.map(({ picture: p, sets, atlas }, i) => {
      expect(drawnAt(quadsOf(sets), atlas, p.below, p.zoom, p.name), `${p.name}: with neither field no quad reaches ${at(p.below)}`).toBeUndefined();
      const below = drawnAt(quadsOf(twins[i]!), atlas, p.below, p.zoom, `${p.name} hung`);
      expect(below?.row, `${p.name} hung: at ${at(p.below)} the top quad is that of ${p.under}, draw placed so anchor is on its cell's center`).toBe(p.under);
      return below!.rgb;
    });
    const drawn = draw(store, made, twins);
    const problems: string[] = [];
    made.forEach(({ picture: p }, i) => {
      const { image, refusal } = drawn[i]!;
      if (!image) { problems.push(`${p.name} hung: raster refused the sets with draw and anchor: ${refusal}`); return; }
      const tile = reads(image, p.below, laid[i]!);
      if (!tile.ok) problems.push(`${p.name} hung: ${at(p.below)}, under the cell of ${p.under}, reads ${tile.got}, not its hung tile ${rgba(laid[i]!)}`);
      const base = BASE.pictures[p.name];
      if (!base) { problems.push(`${p.name}: base-hashes.json holds no hash for it`); return; }
      if (pixelHash(image) === base.sha256) problems.push(`${p.name} hung: its pixel hash is the merge base's own, ${base.sha256}, though its tiles reach under their cells`);
    });
    none(problems, 'each fixture with draw and anchor draws another picture than at the merge base');
  }, TIMEOUT);
});
