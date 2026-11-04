// #399.bf5632b7: Labels of 40 × 12 px on 50 points 60 px apart all place with none folded; a route from A to B past
// node C, whose label lies on the straight line between them, keeps 8 u from C's box and label, never doubles back and
// shares at most one segment with any other edge; a planted placer that folds every label fails the first case and a
// planted straight router fails the second, naming C.
//
// `deep-canvas-render labels` places the labels (README); `geometry` of the graph item gives the routes. The route
// document is a pinned graph at zoom 1, where view px are u.
import { describe, expect, it } from 'vitest';
import {
  ROUTE_NODES, accepted, cleanLook, expectBadPlanted, graphGeometry, gridDoc, labelSteps, routeBox, routeDoc, routeEnters, segmentBox, sharedSegments, show,
  useBins, type Box, type JsonObject, type Point, type Step,
} from './helpers.ts';

const ID = '#399.bf5632b7';
const render = useBins(['deep-canvas-render']);
const CLEARANCE = 8;
const EPS = 0.01;

const look = (): JsonObject => cleanLook(render('deep-canvas-render'));
const center = (b: Box): Point => [b[0] + b[2] / 2, b[1] + b[3] / 2];
function placeAtOne(doc: JsonObject, planted?: string): Step {
  const out = accepted(render('deep-canvas-render'), ['labels'], { doc, look: look(), path: [{ zoom: 1 }], ...(planted ? { planted } : {}) }, 'labels at zoom 1');
  return labelSteps(out)[0]!;
}
/** What the first case holds: every label placed, none folded. */
const foldProblems = (s: Step): string[] => Object.entries(s.labels).filter(([, l]) => l.state !== 'placed').map(([id]) => `${id} folded`);

/** What the second case holds of the route from A to B, each problem naming the node it concerns. */
function routeProblems(routes: Record<string, Point[]>, cLabel: Box): string[] {
  const ab = routes['ab'];
  if (!ab || ab.length < 2) return ['there is no route from A to B'];
  const out: string[] = [];
  const toC = routeBox(ab, ROUTE_NODES['C']!);
  if (toC < CLEARANCE - EPS) out.push(`the route from A to B passes ${toC.toFixed(2)} u from node C's box`);
  const toLabel = routeBox(ab, cLabel);
  if (toLabel < CLEARANCE - EPS) out.push(`the route from A to B passes ${toLabel.toFixed(2)} u from node C's label`);
  if (segmentBox(ab[0]!, ab[0]!, ROUTE_NODES['A']!) > 0.5 || segmentBox(ab.at(-1)!, ab.at(-1)!, ROUTE_NODES['B']!) > 0.5) out.push('the route from A to B does not run from A\'s border to B\'s');
  // Never doubles back: B lies right of and below A, so x and y never decrease along the route.
  for (let i = 1; i < ab.length; i++) {
    if (ab[i]![0] < ab[i - 1]![0] - EPS || ab[i]![1] < ab[i - 1]![1] - EPS) out.push(`the route from A to B doubles back at point ${i} ${show(ab[i])}`);
  }
  for (const other of ['ad', 'eb']) {
    const n = sharedSegments(ab, routes[other] ?? []);
    if (n > 1) out.push(`the route from A to B shares ${n} segments with ${other}`);
  }
  return out;
}

describe(`${ID} labels on a grid of points, and a route around C and its label`, () => {
  it(`${ID} fifty 40 × 12 px labels 60 px apart all place, and the route from A to B keeps 8 u from C and its label, never doubles back and shares at most one segment with another edge`, () => {
    const grid = placeAtOne(gridDoc());
    expect(Object.keys(grid.labels).length, 'fifty labels').toBe(50);
    expect(foldProblems(grid), 'every label places, none folded').toEqual([]);
    expect(grid.folded, 'and none is counted folded').toBe(0);

    const d = routeDoc();
    const c = placeAtOne(d).labels['lab-c'];
    expect(c?.state, 'C\'s label places').toBe('placed');
    const cLabel = c!.box!;
    // The fixture's point: C's label lies on the straight line from A to B, so a straight route can't keep clear.
    expect(routeEnters([center(ROUTE_NODES['A']!), center(ROUTE_NODES['B']!)], cLabel), `C's label ${show(cLabel)} lies on the straight line from A to B`).toBe(true);
    const g = graphGeometry(accepted(render('deep-canvas-render'), ['geometry'], { doc: d, look: look(), item: 'g' }, 'geometry of the route graph'));
    expect(routeProblems(g.routes, cLabel), `the route from A to B: ${show(g.routes['ab'])}`).toEqual([]);
  });

  it(`${ID} a planted placer that folds every label fails the first case`, () => {
    const problems = foldProblems(placeAtOne(gridDoc(), 'folds_every_label'));
    expect(problems.length, 'the first case fails on the planted placer, naming the folded labels').toBe(50);
    expectBadPlanted(render('deep-canvas-render'), ['labels'], { doc: gridDoc(), look: look(), path: [{ zoom: 1 }] });
  });

  it(`${ID} a planted straight router fails the second case, naming C`, () => {
    const d = routeDoc();
    const cLabel = placeAtOne(d).labels['lab-c']!.box!;
    const g = graphGeometry(accepted(render('deep-canvas-render'), ['geometry'], { doc: d, look: look(), item: 'g', planted: 'straight_router' }, 'geometry with the planted straight router'));
    const problems = routeProblems(g.routes, cLabel);
    expect(problems.filter((p) => p.includes('node C')).length, `the second case fails on the straight router, naming C: ${problems.join('; ')}`).toBeGreaterThan(0);
    expectBadPlanted(render('deep-canvas-render'), ['geometry'], { doc: d, look: look(), item: 'g' });
  });
});
