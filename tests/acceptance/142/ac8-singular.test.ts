// AC8 #142.0b0a5201: "A singular [[1, 2], [2, 4]] collapses the plane onto a line and the readout shows 0.00; with ghosts
// each old tip keeps its arrow at 0.3 opacity; and explain.linear_map on the 3D stage is refused, naming the recipe"
//
// A linear_map film on the 2D stage (README: Fixtures): the plane x −4…4, y −3…3, the basis, the unit square, ghosts
// on, one vector `v` at (1, 1); one cue, `squash`, explain.apply [[1, 2], [2, 4]] over 0–1 s. Read at 1.5 s, after it:
//   - The plane collapses onto a line: every point of the moving plane's grid (`film.grid`, #223's `path` in document
//     u, read in plane coordinates through `film.moving`'s warp) lies within 1e-6 of the line y = 2x, and the points
//     spread over more than one unit along it (a line, not a point); î and ĵ (`film.i_hat`, `film.j_hat`) end at the
//     columns, (1, 2) and (2, 4), within 1e-9.
//   - The readout (`film.area`, `eval` with `texts`) shows 0.00.
//   - Ghosts: for each old tip, î's (1, 0), ĵ's (0, 1) and v's (1, 1), some derived item whose own opacity
//     (`items/<id>/adjust/opacity`) reads 0.3 within 1e-9 draws an arrow there: its drawn point farthest from the
//     plane's origin lies within 1e-6 of the old tip.
// The same film with `stage: "3d"` is refused, with an error naming explain.linear_map.
// Wrong programs: the base; a collapse drawn as a point or left a plane; a readout of a signed det (−0.00) or of the
// square's drawn area; ghosts at full opacity, at the new tips or carried by the plane; a 3D stage drawn anyway, or
// refused without naming the recipe.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, INSTANCE, LM, TIMEOUT, apply, brief, docId, errors, evalAt, expansionOf, linearFilm, names, none, onStage, pathAt, planeOf,
  pointsOf, present, readings, run, scenario, textsOf, tipOf, toPlane, useFolders, useShow, valuesOf, type JsonObject,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();
const AT = 1.5 * FLICKS;
const film = linearFilm('A singular map', [apply('squash', [[1, 2], [2, 4]])], { ghosts: true, vectors: [{ id: 'v', coords: [1, 1], role: 'accent', label: 'v' }] }, 2);
const OLD_TIPS: [string, [number, number]][] = [['î', [1, 0]], ['ĵ', [0, 1]], ['v', [1, 1]]];

describe(`${AC[8]} a singular map collapses the plane, ghosts keep the old tips, and the 3D stage is refused`, () => {
  it(`${AC[8]} [[1, 2], [2, 4]] collapses the plane onto y = 2x with the readout at 0.00, ghosts hold the old tips at 0.3 opacity, and the 3D stage is refused naming the recipe`, () => {
    const [shown, refused] = run(show(), scenario(folder(), [present(docId(1), film), present(docId(2), onStage(film, '3d'))]));
    expect(shown!['outcome'] === 'presented' && errors(shown!).length === 0, `the singular film is presented with no error: ${brief(shown!, 1500)}`).toBe(true);
    const failures: string[] = [];
    if (refused!['outcome'] === 'presented') failures.push('explain.linear_map on the 3D stage is presented; it is refused');
    if (!errors(refused!).some((i) => names(i, 'explain.linear_map'))) failures.push(`explain.linear_map on the 3D stage: no error names the recipe: ${brief(errors(refused!), 1500)}`);

    const e = expansionOf(shown!, INSTANCE, 'the singular film');
    const plane = planeOf(e, 'the singular film');
    const derived = Object.keys(e.derived);
    const calls: JsonObject[] = [
      present(docId(1), film),
      evalAt(docId(1), AT, { texts: true, paths: derived.map((id) => `items/${id}/adjust/opacity`) }),
      ...derived.map((id) => pathAt(docId(1), id, AT)),
    ];
    const replies = run(show(), scenario(folder(), calls));
    const outline = new Map(derived.map((id, k) => [id, pointsOf(replies[2 + k]!)]));

    const grid = outline.get(LM.grid);
    if (!grid || !grid.length) failures.push(`the grid ${LM.grid} answers no outline at 1.5 s`);
    else {
      const q = grid.map((p) => toPlane(plane, p));
      const off = Math.max(...q.map(([x, y]) => Math.abs(2 * x - y) / Math.sqrt(5)));
      const along = q.map(([x, y]) => (x + 2 * y) / Math.sqrt(5));
      if (off > 1e-6) failures.push(`the grid isn't on the line y = 2x: a point lies ${off} off it`);
      if (Math.max(...along) - Math.min(...along) <= 1) failures.push('the grid collapses to a point, not onto a line');
    }
    for (const [name, id, want] of [['î', LM.i, [1, 2]], ['ĵ', LM.j, [2, 4]]] as const) {
      const pts = outline.get(id);
      if (!pts || !pts.length) { failures.push(`${name} (${id}) answers no outline at 1.5 s`); continue; }
      const tip = tipOf(plane, pts);
      if (!(Math.abs(tip[0] - want[0]) <= 1e-9 && Math.abs(tip[1] - want[1]) <= 1e-9)) failures.push(`${name} ends at (${tip[0]}, ${tip[1]}), not (${want[0]}, ${want[1]}) within 1e-9`);
    }
    const texts = textsOf(replies[1]!, 'the singular film at 1.5 s');
    const area = texts[LM.area];
    const got = typeof area === 'string' ? readings(area) : [];
    if (got.length !== 1 || got[0] !== '0.00') failures.push(`the area readout shows ${brief(area ?? null)}, not 0.00`);

    const opacity = valuesOf(replies[1]!, 'the singular film at 1.5 s');
    const ghosts = derived.filter((id) => typeof opacity[`items/${id}/adjust/opacity`] === 'number' && Math.abs((opacity[`items/${id}/adjust/opacity`] as number) - 0.3) <= 1e-9);
    for (const [name, tip] of OLD_TIPS) {
      const at = ghosts.filter((id) => { const pts = outline.get(id); if (!pts || !pts.length) return false; const t = tipOf(plane, pts); return Math.abs(t[0] - tip[0]) <= 1e-6 && Math.abs(t[1] - tip[1]) <= 1e-6; });
      if (!at.length) failures.push(`no arrow at 0.3 opacity holds ${name}'s old tip (${tip[0]}, ${tip[1]}); items at 0.3: ${ghosts.join(', ') || 'none'}`);
    }
    none(failures, 'the singular map, the ghosts and the 3D stage');
  }, TIMEOUT);
});
