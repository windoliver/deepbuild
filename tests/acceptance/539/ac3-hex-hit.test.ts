// AC3 #539.78972f29: On the 6 × 6 pointy odd hex fixture with cell [32, 28], a click at (34, 9) picks (1, 0), though
// the quad of (1, 1), drawn above it, covers that point, and a click at (40, 10.5), on the edge (1, 0) and (1, 1) share,
// picks (1, 0), the smaller (cy, cx); and a planted hit test by quad bounds picks (1, 1) for the first click and fails,
// naming the point
//
// The fixture (fixtures.ts `hexDoc`): `hexes`, #536's 6 × 6 pointy odd grid, cell [32, 28], at the origin, its rows drawn
// as solid 32 × 28 u quads (so (1, 1)'s quad, centred on (48, 21) and drawn after (1, 0)'s, centred on (32, 0), covers
// x 32 to 64, y 7 to 35); `place`, a pick control whose rows are [hexes]. The page is 224 × 160 u in an 896 × 640 px
// panel, 4 px a u, so both points map to whole panel px and back exactly. Through `deep-show run`: the two clicks
// (`input`'s `appended`). The design's numbers are checked here too: (34, 9) lies inside (1, 0)'s hexagon and outside
// (1, 1)'s, and (40, 10.5) on the edge they share. The planted `hit_by_quad_bounds` hits a hex row by its quad.
import { describe, expect, it } from 'vitest';
import { HEX, worldProgram, type Cell } from './programs.ts';
import { cellText, hexDoc, putAtlas } from './fixtures.ts';
import {
  AC, DOC, Script, TIMEOUT, appendedOf, binOf, entriesText, failsNaming, none, pickOf, pickText, prebuild, presented, putEvidence,
  runShow, scenario, scopeView, toPanel, useTemp, type Planted, type Pt, type Rect,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(3);
const RECT: Rect = [0, 0, 896, 640];
const INSIDE: Pt = [34, 9];
const ON_EDGE: Pt = [40, 10.5];
const WANT: Cell = [1, 0];

/** A pointy hexagon of the fixture's cell, centred on (cx, cy): the signed distances of `p` past its six edges (≤ 0 inside). */
function past([x0, y0]: Pt, [x, y]: Pt): number {
  const [a, b] = [16, 14]; // half the cell's width, half its height
  const [dx, dy] = [x - x0, y - y0];
  // Two vertical sides at ±a and four slanted ones through (±a, ±b/2) and (0, ±b).
  return Math.max(Math.abs(dx) - a, (Math.abs(dx) * (b / 2) + Math.abs(dy) * a - a * b) / Math.hypot(b / 2, a));
}
const centre = ([cx, cy]: Cell): Pt => [32 * (cx + (cy % 2) / 2), 21 * cy];

function judge(planted?: Planted): { failures: string[]; first: string } {
  const ev = temp();
  const atlas = putAtlas(ev);
  const world = worldProgram(HEX);
  putEvidence(ev, world.bytes);
  const doc = hexDoc('hex-picks', atlas, world);
  const view = scopeView(binOf(), ev, D, doc, { rect: RECT }, 'AC3 the hex fixture');
  const s = new Script();
  s.present(D, doc);
  s.scope();
  const first = s.click(toPanel(view, INSIDE));
  const second = s.click(toPanel(view, ON_EDGE));
  const r = runShow(binOf(), scenario(ev, [D], s.calls, { rect: RECT, ...(planted ? { planted } : {}) }), `AC3 the clicks${planted ? ` (planted ${planted})` : ''}`);
  presented(r[0]!, 'the hex fixture');
  const picked = (pair: number[], where: Pt): { text: string; failure: string | null } => {
    const entries = pair.flatMap((i) => appendedOf(r[i]!, `the click at (${where.join(', ')})`));
    const p = entries.length === 1 && entries[0]!['control'] === 'place' ? pickOf(entries[0]!) : null;
    const text = pickText(p);
    return { text, failure: text === pickText({ set: 0, key: WANT }) ? null : `the click at the point (${where.join(', ')}) appends ${entriesText(entries)}, picking ${text}, not one entry of place with {set 0, key ${cellText(WANT)}}` };
  };
  const a = picked(first, INSIDE);
  const b = picked(second, ON_EDGE);
  return { failures: [a.failure, b.failure].filter((f): f is string => f !== null), first: a.text };
}

describe(`${AC[3]} a pick on a hex grid hits the cell whose hexagon holds the point, never a neighbour's quad`, () => {
  it(`${AC[3]} a click at (34, 9) picks (1, 0) though (1, 1)'s quad, drawn above it, covers the point, and a click at (40, 10.5) on their shared edge picks (1, 0), the smaller (cy, cx)`, () => {
    // The design's geometry, so the clicks test what the criterion says.
    expect(past(centre([1, 0]), INSIDE), 'the fixture: (34, 9) lies inside (1, 0)\'s hexagon').toBeLessThan(0);
    expect(past(centre([1, 1]), INSIDE), 'the fixture: (34, 9) lies outside (1, 1)\'s hexagon').toBeGreaterThan(0);
    expect(Math.abs(INSIDE[0] - 48) <= 16 && Math.abs(INSIDE[1] - 21) <= 14, 'the fixture: (1, 1)\'s quad covers (34, 9)').toBe(true);
    expect(Math.abs(past(centre([1, 0]), ON_EDGE)), 'the fixture: (40, 10.5) lies on (1, 0)\'s edge').toBeLessThan(1e-9);
    expect(Math.abs(past(centre([1, 1]), ON_EDGE)), 'the fixture: (40, 10.5) lies on (1, 1)\'s edge').toBeLessThan(1e-9);
    none(judge().failures, 'the two clicks on the hex fixture');
  }, TIMEOUT);

  it(`${AC[3]} planted hit_by_quad_bounds picks (1, 1) for the first click and fails, naming the point`, () => {
    const twin = judge('hit_by_quad_bounds');
    expect(twin.first, 'under the planted hit test the click at (34, 9) picks (1, 1), whose quad is drawn above').toBe(pickText({ set: 0, key: [1, 1] }));
    failsNaming(twin.failures, [/\(34, 9\)/], 'the clicks under hit_by_quad_bounds');
  }, TIMEOUT);
});
