// #2457.d36df7b1: "An open asset is refused at check, naming an open edge, as a built item is"
//
// The assets (helpers.ts: CUBE, OPEN, openAndClosed): the closed cube of criterion 1, and the same cube with the face
// its file holds first, the top, left out: 20 vertices and 10 triangles that weld to 8 vertices, the four edges round
// the missing face each on one triangle only. Each is a glTF 2.0 binary written here, kept in one evidence store and
// placed by a `mesh.asset@1` item of one scene, beside a built cube with its top left out (#524's lathe); a world for
// each holds one soft volume built from it. The open edges are worked here from the open asset's own triangles over
// its own welded vertices, never read from the program.
//   - `check` admits the volume from the closed asset: no error issue. The base refuses every asset, closed or open, so
//     a refusal alone proves nothing.
//   - `check` refuses the volume from the open asset with an error issue whose `edge` names two welded vertices v{i},
//     v{j} of the open asset, and that edge is one of its four open edges.
//   - `check` refuses the volume from the built open cube the same way, as the base does, and the open asset's issue
//     carries the same code: the asset is refused as a built item is.
import { describe, expect, it } from 'vitest';
import {
  AC, CUBE, OPEN, TIMEOUT, check, edgeIssue, namedEdge, openAndClosed, openEdges, refusals, show, usePhysics, useTemp, welded,
} from './helpers.ts';

const ask = usePhysics();
const temp = useTemp();
const ID = AC[2];

describe(`${ID} a soft volume from an open asset`, () => {
  it(`${ID} is refused at check, naming one of the asset's open edges, as a volume from an open built item is; from the closed asset it is admitted`, () => {
    const open = welded(OPEN);
    const edges = openEdges(open.triangles);
    expect([OPEN.positions.length, OPEN.triangles.length, open.points.length, edges.length, openEdges(welded(CUBE).triangles)], 'the fixtures: the open asset\'s 20 file vertices and 10 triangles weld to 8 vertices with 4 open edges; the closed asset has none').toEqual([20, 10, 8, 4, []]);
    const w = openAndClosed(temp());
    const run = ask([check(w.closed), check(w.holed), check(w.built)]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const [closed, holed, built] = [run.replies[0]!, run.replies[1]!, run.replies[2]!];
    expect(refusals(closed), 'a soft volume from the closed cube asset is admitted at check: no error issue').toEqual([]);
    const refused = edgeIssue(holed);
    expect(typeof refused === 'string' ? refused : '', 'a soft volume from the cube asset with one face left out is refused at check, an error issue naming an edge in `edge`').toBe('');
    const asset = refused as Exclude<typeof refused, string>;
    const named = namedEdge(asset.edge, open.points.length);
    expect(named === null ? show(asset.edge) : '', 'the edge is two different welded vertices of the open asset, ["v{i}", "v{j}"] with i and j under 8').toBe('');
    expect(edges, `the named edge ${named} is one of the open asset's open edges, the four round its missing face (${edges.join(', ')})`).toContain(named);
    const same = edgeIssue(built);
    expect(typeof same === 'string' ? same : '', 'a soft volume from a built cube with its top left out is refused at check, an error issue naming an edge in `edge`').toBe('');
    expect(asset.code, `the open asset is refused as the open built item is, under the same code: ${show(asset.issue)}`).toBe((same as Exclude<typeof same, string>).code);
  }, TIMEOUT);
});
