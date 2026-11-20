// AC3: "A 1 m edge seen by an orthographic camera, behind an opaque blocker that covers its middle 0.4 m, gives spans
// 0 to 0.3 m visible, 0.3 to 0.7 m hidden and 0.7 to 1 m visible, each end within 1e-5 m. A planted test of the
// edge's two ends only reports one visible span and fails, naming the edge"
// AC4: "Its perspective twin, with the camera on the edge's perpendicular 4 m away and a blocker 0.2 m wide halfway
// between them, gives the same three spans within 1e-5 m. A planted classifier that projects the blocker without
// perspective hides 0.4 to 0.6 m and fails, naming the edge"
// AC6: "In the orthographic fixture, a pane at transmission 1 or an item at `alpha_mode: blend` in the blocker's
// place leaves the edge one visible span, and a cutaway that removes the blocker past the edge's midpoint leaves
// only 0.3 to 0.5 m hidden. A planted classifier that counts the pane reports a hidden span and fails, naming the
// pane"
//
// The fixture is ridge.ts: the fold's ridge, edge 0, from x = −0.5 m (its start) to 0.5 m, with one flat quad between
// it and a camera on +Z, drawn on the noop lane with `counts: true` and read from `spans`. Every run first draws
// its guard, the document without the `hidden` line, which the base answers: the twin line draws the ridge alone.
//
// AC3: under the orthographic camera an opaque quad from x = −0.2 to 0.2 m covers 0.3 to 0.7 m of the ridge.
// AC4: under the perspective camera at (0, 0, 4) an opaque quad from x = −0.1 to 0.1 m in the plane z = 2 casts
// twice its width on the ridge, the same 0.3 to 0.7 m; without perspective it hides its own width, 0.4 to 0.6 m.
// AC6: the AC3 quad under the name `pane` with a material at transmission 1, and under `veil` with `alpha_mode:
// blend`, hides nothing; the opaque AC3 blocker under a `cutaway@1` whose plane removes x > 0 and whose `applies_to`
// names the blocker alone hides only 0.3 to 0.5 m. Every span list is also held to the tiling rules (README).
// Each planted run is asserted to show the issue's wrong spans, and the criterion's check to fail on them, naming
// the edge (AC3, AC4) or the pane (AC6).

import { describe, expect, it } from 'vitest';
import { AC, NOOP, drawHidden, edgeName, failsNaming, none, spanProblems, spansOf, tilingProblems, useDir, useGpuBin, type Span, type Startup } from './helpers.ts';
import { CUT, MIDDLE, UNPROJECTED, WHOLE, quad, type Edge, type Want } from './reference.ts';
import { HALFWAY, LINE, TWIN, ridge, ridgeEdge, type Ridge } from './ridge.ts';

const bin = useGpuBin();
const dir = useDir();

/** AC3's blocker, "covers its middle 0.4 m": x from −0.2 to 0.2 m. */
const WIDE = quad(-0.2, 0.2, HALFWAY);
/** AC4's blocker, "0.2 m wide halfway between them": x from −0.1 to 0.1 m in the plane z = 2. */
const NARROW = quad(-0.1, 0.1, HALFWAY);

const ORTHO: Ridge = { title: 'Orthographic blocker', view: 'orthographic', occluder: { id: 'blocker', quad: WIDE, material: 'grey' } };
const PERSPECTIVE: Ridge = { title: 'Perspective blocker', view: 'perspective', occluder: { id: 'blocker', quad: NARROW, material: 'grey' } };
const PANE: Ridge = { title: 'A pane in the place of the blocker', view: 'orthographic', occluder: { id: 'pane', quad: WIDE, material: 'glass' } };
const VEIL: Ridge = { title: 'A blended item in the place of the blocker', view: 'orthographic', occluder: { id: 'veil', quad: WIDE, material: 'cloth' } };
const CUTAWAY: Ridge = { ...ORTHO, title: 'A cutaway through the blocker', cut: true };

/** One fixture drawn and held to its guard. Its spans are read on demand, after every fixture's guard has run. */
function guarded(r: Ridge, startup: Startup): { read: () => Span[]; edge: Edge; what: string } {
  const { edges, frames, what } = drawHidden(bin(), dir(), ridge(r), LINE, TWIN, startup);
  const edge = ridgeEdge(edges, `${what}, its guard`);
  return { read: () => spansOf(frames[0]!, LINE, what), edge, what };
}
/** The ridge's spans in one fixture, the fixture held to its guard. */
function drawn(r: Ridge, startup: Startup): { spans: Span[]; edge: Edge; what: string } {
  const { read, edge, what } = guarded(r, startup);
  return { spans: read(), edge, what };
}
/** The ridge's spans against the issue's; each failure names what stands before the ridge, and the edge. */
function ridgeProblems(r: Ridge, got: readonly Span[], edge: Edge, want: readonly Want[]): string[] {
  const where = `behind ${r.occluder.id}${r.cut ? ', cut away past x = 0' : ''}`;
  return [...tilingProblems(got, [edge]), ...spanProblems(got, edge, want)].map((p) => `${where}: ${p}`);
}
/** Fixtures on the noop lane, each held to its guard first and then to the issue's spans. */
function hold(cases: readonly (readonly [Ridge, readonly Want[]])[]): void {
  const runs = cases.map(([r, want]) => ({ r, want, ...guarded(r, NOOP) }));
  for (const { r, want, read, edge, what } of runs) none(ridgeProblems(r, read(), edge, want), `${what}: the ridge's spans`);
}

describe(`${AC[3]} a 1 m edge behind an opaque blocker over its middle 0.4 m, seen by an orthographic camera`, () => {
  it(`${AC[3]} gives spans 0 to 0.3 m visible, 0.3 to 0.7 m hidden and 0.7 to 1 m visible, each end within 1e-5 m (noop lane)`, () => {
    hold([[ORTHO, MIDDLE]]);
  }, 600_000);

  it(`${AC[3]} a planted test of the edge's two ends only reports one visible span and fails, naming the edge (noop lane)`, () => {
    const { spans, edge, what } = drawn(ORTHO, { backend: 'noop', planted: 'edges_spans_ends_only' });
    none(spanProblems(spans, edge, WHOLE), `${what}: the planted test reports one visible span`);
    failsNaming(ridgeProblems(ORTHO, spans, edge, MIDDLE), [edgeName(edge)], 'the test of the edge\'s two ends only');
  }, 600_000);
});

describe(`${AC[4]} its perspective twin: the camera 4 m away on the edge's perpendicular, a blocker 0.2 m wide halfway`, () => {
  it(`${AC[4]} gives the same three spans within 1e-5 m (noop lane)`, () => {
    hold([[PERSPECTIVE, MIDDLE]]);
  }, 600_000);

  it(`${AC[4]} a planted classifier that projects the blocker without perspective hides 0.4 to 0.6 m and fails, naming the edge (noop lane)`, () => {
    const { spans, edge, what } = drawn(PERSPECTIVE, { backend: 'noop', planted: 'edges_spans_no_perspective' });
    none(spanProblems(spans, edge, UNPROJECTED), `${what}: the planted classifier hides 0.4 to 0.6 m`);
    failsNaming(ridgeProblems(PERSPECTIVE, spans, edge, MIDDLE), [edgeName(edge)], 'the classifier that projects the blocker without perspective');
  }, 600_000);
});

describe(`${AC[6]} in the orthographic fixture, what hides nothing and what a cutaway removes`, () => {
  it(`${AC[6]} a pane at transmission 1 or an item at alpha_mode blend in the blocker's place leaves the edge one visible span; a cutaway that removes the blocker past the midpoint leaves only 0.3 to 0.5 m hidden (noop lane)`, () => {
    hold([[PANE, WHOLE], [VEIL, WHOLE], [CUTAWAY, CUT]]);
  }, 600_000);

  it(`${AC[6]} a planted classifier that counts the pane reports a hidden span and fails, naming the pane (noop lane)`, () => {
    const { spans, edge, what } = drawn(PANE, { backend: 'noop', planted: 'edges_spans_count_glass' });
    expect(spans.filter((s) => s.hidden).length, `${what}: the planted classifier reports a hidden span`).toBeGreaterThan(0);
    failsNaming(ridgeProblems(PANE, spans, edge, WHOLE), ['behind pane', edgeName(edge)], 'the classifier that counts the pane');
  }, 600_000);
});
