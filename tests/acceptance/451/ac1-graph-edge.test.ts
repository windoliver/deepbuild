// AC1 #451.5e48c360: "20 packets on a graph's edge a→b stay within 0.5 u of that edge's route at 100 random times,
// seeking equal to playing, and after a relayout moves the edge they follow its new route"
//
// The graph (helpers.ts: graphDoc): a pinned graph@1 at (30, 20) with nodes A, C and B and the edge `ab` from A to B,
// and the 2D particles item `packets` (20 packets, life 2 s, born 10 a second, `motion.along.curves: ["net#ab"]` at 120
// to 160 u/s). Before the relayout B sits right of A with C between them, so `ab`'s route bends around C; the relayout
// (a revision of the same document, B's place in the layout memory moved below A) moves the route to run straight down.
// The route each time is the canvas's own, `deep-canvas-render geometry`'s `graph.routes.ab` of the graph alone.
//
// The 100 random times are frames 75 to 299 at 30 fps (2.5 s to 10 s), drawn by mulberry32 from seed 451, where all 20
// packets are live. One `deep-gpu run` process evaluates the document before the relayout and then after it (a program
// that keeps a route it laid out for that document would show here). At every time: exactly 20 live packets, each one's
// particle moving along `net#ab`, within 0.5 u of the route, and (guards) each packet further along the route at each
// later time it is read, and the packets reaching at least 7 of the route's 10 equal stretches. Two wrong programs made
// in test code from this run's readings must fail, naming the item and the edge: packets on the straight chord from the
// route's start to its end at the same fraction of the way (a route that ignores how the edge is laid out), and the
// packets read before the relayout judged against the route after it (a program that keeps the old route).
//
// Seeking equal to playing (helpers.ts: seekEqualsPlay): `film2d` plays both documents from frame 0 to 299 in one
// process, and fresh processes open each at frames 101, 187 and 263; at each of the 100 frames the played frame's
// evaluated-data hash of `packets` is the hash of the evaluation's places there, and each sought frame's the played one's.

import { describe, expect, it } from 'vitest';
import {
  FLICKS, GRAPH, TIMEOUT, ac, cleanLook, failsNaming, graphDoc, lengthOf, liveAt, nearest, none, particlesCall, pickFrames, pointAt,
  reading2d, requireGpu, routeOf, run, seekEqualsPlay, frameT, useBins, useDir, writeJson,
  type Layout, type P2, type Reading2,
} from './helpers.ts';

const bins = useBins(['deep-gpu', 'deep-canvas-render']);
const dir = useDir();
const FRAMES = pickFrames(451, 100, 75, 299);
const TIMES = FRAMES.map(frameT);
const TOLERANCE = 0.5;

/** What AC1 holds of one reading against one route; each failure names the item `packets` and the edge `net#ab`. */
function edgeProblems(r: Reading2, route: readonly P2[], what: string): string[] {
  const out: string[] = [];
  r.at.forEach((s, k) => {
    const live = liveAt(r, k);
    const at = `${(s.t / FLICKS).toFixed(4)} s`;
    if (live.length !== GRAPH.count) out.push(`packets ${what} at ${at}: ${live.length} packets live on ${GRAPH.edge}, not ${GRAPH.count}`);
    for (const l of live) {
      if (l.particle === null) { out.push(`packets ${what} at ${at}: row ${l.row} is live but no particle in the list holds it`); continue; }
      if (l.particle.curve !== GRAPH.edge) out.push(`packets ${what} at ${at}: row ${l.row} moves along ${l.particle.curve}, not ${GRAPH.edge}`);
      const d = nearest(route, l.at).d;
      if (!(d <= TOLERANCE)) out.push(`packets ${what} at ${at}: row ${l.row} at (${l.at[0].toFixed(2)}, ${l.at[1].toFixed(2)}) is ${d.toFixed(3)} u from ${GRAPH.edge}'s route, more than ${TOLERANCE} u`);
    }
  });
  return out;
}

/** Guards: each packet further along the route at each later time, and the packets reaching 7 of the route's 10 stretches. */
function travelProblems(r: Reading2, route: readonly P2[], what: string): string[] {
  const out: string[] = [];
  const total = lengthOf(route);
  const tenths = new Set<number>();
  const track = new Map<string, number>();
  r.at.forEach((s, k) => {
    for (const l of liveAt(r, k)) {
      if (l.particle === null) continue;
      const along = nearest(route, l.at).s;
      tenths.add(Math.min(9, Math.floor((10 * along) / total)));
      const key = `${l.particle.row}@${l.particle.born}`;
      const before = track.get(key);
      if (before !== undefined && !(along > before)) out.push(`packets ${what}: the packet in row ${l.row} born at ${l.particle.born} s is at ${along.toFixed(2)} u along the route at ${(s.t / FLICKS).toFixed(4)} s, not past ${before.toFixed(2)} u where it was read before`);
      track.set(key, along);
    }
  });
  if (tenths.size < 7) out.push(`packets ${what}: the packets reach only ${tenths.size} of the route's 10 equal stretches (${[...tenths].sort().join(', ')})`);
  return out;
}

/** A wrong program made from a reading: every live packet on the straight chord from the route's start to its end, as far along as it is on the route. */
function onChord(r: Reading2, route: readonly P2[]): Reading2 {
  const total = lengthOf(route);
  const a = route[0]!; const b = route[route.length - 1]!;
  return {
    ...r,
    at: r.at.map((s) => ({ t: s.t, cpu: s.cpu.map((p) => {
      if (p === null) return null;
      const f = nearest(route, p).s / total;
      return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])] as P2;
    }) })),
  };
}

describe(`${ac(1)} packets on a graph's routed edge, before and after a relayout`, () => {
  it(`${ac(1)} 20 packets on edge a→b stay within 0.5 u of its route at 100 random times, and after a relayout moves the edge they follow its new route; a chord program and an old-route program fail naming the edge`, () => {
    const renderBin = bins.bin('deep-canvas-render');
    const look = cleanLook(renderBin);
    const routes = {
      before: routeOf(renderBin, look, graphDoc('before', false), 'the graph before the relayout'),
      after: routeOf(renderBin, look, graphDoc('after', false), 'the graph after the relayout'),
    } satisfies Record<Layout, P2[]>;
    // The fixture: the route before bends around C (the chord between its ends leaves it by more than 10 u), and the
    // relayout moves the edge (no point of the route before lies within 20 u of the route after).
    const before = routes.before;
    const chordGap = Math.max(...before.map((p) => nearest([before[0]!, before[before.length - 1]!], p).d));
    expect(chordGap, `the route before the relayout bends around C: ${JSON.stringify(before)}`).toBeGreaterThan(10);
    const moved = Math.min(...Array.from({ length: 101 }, (_, i) => nearest(routes.after, pointAt(before, (i / 100) * lengthOf(before))).d));
    expect(moved, `the relayout moves the edge: the route before ${JSON.stringify(before)}, after ${JSON.stringify(routes.after)}`).toBeGreaterThan(20);
    for (const l of ['before', 'after'] as const) {
      expect(lengthOf(routes[l]), `the route ${l} the relayout is longer than a packet travels in its life`).toBeGreaterThan(GRAPH.speed[1] * GRAPH.life);
    }

    const paths = { before: writeJson(dir(), 'graph-before.json', graphDoc('before')), after: writeJson(dir(), 'graph-after.json', graphDoc('after')) };
    const calls = (['before', 'after'] as const).map((l) => particlesCall({ doc: paths[l], t: TIMES, items: ['packets'] }));
    const replies = run(bins.bin('deep-gpu'), dir(), calls, { backend: 'noop' });
    const readings = {
      before: reading2d(replies[0]!, 'packets', TIMES, 'the packets before the relayout'),
      after: reading2d(replies[1]!, 'packets', TIMES, 'the packets after the relayout (the same process)'),
    };
    none(edgeProblems(readings.before, routes.before, 'before the relayout'), 'before the relayout, every packet on net#ab within 0.5 u of its route');
    none(edgeProblems(readings.after, routes.after, 'after the relayout'), 'after the relayout, every packet on net#ab within 0.5 u of its new route');
    none(travelProblems(readings.before, routes.before, 'before the relayout'), 'before the relayout, the packets move from a to b and spread along the route');
    none(travelProblems(readings.after, routes.after, 'after the relayout'), 'after the relayout, the packets move from a to b and spread along the route');

    failsNaming(edgeProblems(onChord(readings.before, routes.before), routes.before, 'on the chord'), ['packets', GRAPH.edge], 'a program that moves the packets along the straight chord from a to b');
    failsNaming(edgeProblems(readings.before, routes.after, 'on the old route'), ['packets', GRAPH.edge], 'a program that keeps the route laid out before the relayout');
  }, TIMEOUT);

  it(`${ac(1)} seeking equals playing: at the 100 times, before and after the relayout, the played frames' evaluated data are the evaluation's, and frames opened alone are the played ones`, () => {
    requireGpu();
    const docs = (['before', 'after'] as const).map((l) => {
      const doc = graphDoc(l);
      return { name: `the graph ${l} the relayout`, doc, path: writeJson(dir(), `graph-${l}.json`, doc) };
    });
    none(seekEqualsPlay(bins.bin('deep-gpu'), dir(), docs, 'packets', FRAMES, [101, 187, 263]), 'seeking the packets equals playing them');
  }, 2 * TIMEOUT);
});
