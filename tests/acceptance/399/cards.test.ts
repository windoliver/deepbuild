// #399.79b9406f: A graph of 6 nodes naming card frames, in 2 groups of 3, lays out with each card's box equal to its
// node's laid-out box within 0.5 u and each group's box holding exactly its 3 cards under its title, with no route
// crossing a title.
//
// The cards are measured on their own by `deep-layout solve` (#375's auto layout); the graph's nodes, group boxes,
// titles and routes come from `deep-canvas-render geometry` of the graph item, and each card's drawn box from
// `geometry` of the card, with the layout's place applied (README).
import { describe, expect, it } from 'vitest';
import {
  CARDS, accepted, arr, boundsOf, box, boxesNear, cardItems, cardsDoc, cleanLook, doc, graphGeometry, inside, obj, overlap, points, routeEnters, show, useBins,
  type Box, type Point,
} from './helpers.ts';

const ID = '#399.79b9406f';
const bin = useBins(['deep-canvas-render', 'deep-layout']);
const TOL = 0.5;

describe(`${ID} six cards drawn as the nodes of a graph, in two titled groups`, () => {
  it(`${ID} each card's box is its node's laid-out box, each group's box holds exactly its three cards under its title, and no route crosses a title`, () => {
    const render = bin('deep-canvas-render');
    const look = cleanLook(render);
    // The cards' measured bounds, on their own.
    const solo = accepted(bin('deep-layout'), ['solve'], { doc: doc('cards-alone', 'Six cards', 'The six cards on their own, measured by the auto layout.', [900, 700], cardItems()) }, 'deep-layout solve of the cards');
    const measured = obj(solo['boxes'], 'solve: boxes');

    const d = cardsDoc();
    const g = graphGeometry(accepted(render, ['geometry'], { doc: d, look, item: 'g' }, 'geometry of the graph'));
    expect(Object.keys(g.nodes).sort(), 'the graph lays out its six nodes').toEqual(CARDS.map(([id]) => id).sort());
    const cardBox: Record<string, Box> = {};
    for (const [id] of CARDS) {
      const m = box(measured[`card-${id}`], `the measured box of card-${id}`);
      const n = g.nodes[id]!;
      // A layout that ignores the item and keeps a default node size fails here.
      expect(Math.abs(n[2] - m[2]) <= TOL && Math.abs(n[3] - m[3]) <= TOL, `node ${id} takes card-${id}'s measured size: node ${show(n)}, card ${show(m)}`).toBe(true);
      const geo = accepted(render, ['geometry'], { doc: d, look, item: `card-${id}` }, `geometry of card-${id}`);
      const pts: Point[] = arr(geo['subpaths'], `card-${id}: subpaths`).flatMap((s, i) => points(obj(s, `card-${id}: subpaths[${i}]`)['points'], `card-${id}: subpaths[${i}].points`));
      expect(pts.length, `card-${id} draws its box`).toBeGreaterThan(0);
      cardBox[id] = boundsOf(pts);
      // A layout that never writes the card's place leaves it at the origin.
      expect(boxesNear(cardBox[id]!, n, TOL), `card-${id}'s box ${show(cardBox[id])} equals node ${id}'s laid-out box ${show(n)} within ${TOL} u`).toBe(true);
    }

    expect(Object.keys(g.groups).sort(), 'one box per group, on by default').toEqual(['Build', 'Ship']);
    const titles = Object.entries(g.groups).map(([name, gr]) => ({ name, title: gr.title }));
    for (const [name, gr] of Object.entries(g.groups)) {
      const own = CARDS.filter(([, group]) => group === name).map(([id]) => id);
      const others = CARDS.filter(([, group]) => group !== name).map(([id]) => id);
      expect(own.length, `${name} has three cards`).toBe(3);
      for (const id of own) {
        expect(inside(cardBox[id]!, gr.box, TOL), `${name}'s box ${show(gr.box)} holds card-${id} ${show(cardBox[id])}`).toBe(true);
        expect(cardBox[id]![1] >= gr.title[1] + gr.title[3] - TOL, `card-${id} sits under ${name}'s title ${show(gr.title)}`).toBe(true);
      }
      for (const id of others) expect(overlap(cardBox[id]!, gr.box), `${name}'s box holds none of the other group's cards: card-${id}`).toBe(false);
      expect(inside(gr.title, gr.box, TOL), `${name}'s title is on its box`).toBe(true);
    }
    expect(Object.keys(g.routes).sort(), 'every edge is routed').toEqual(['b1-b2', 'b1-b3', 'b3-s1', 's1-s2', 's1-s3']);
    // b3 → s1 enters Ship's box from above, where its title is; a router that ignores titles crosses it.
    const crossings = Object.entries(g.routes).flatMap(([edge, route]) => titles.filter((t) => routeEnters(route, t.title)).map((t) => `${edge} crosses ${t.name}'s title`));
    expect(crossings, 'no route crosses a title').toEqual([]);
  });
});
