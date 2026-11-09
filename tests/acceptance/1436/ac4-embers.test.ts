// Criterion 4 (README: Criteria to tests): "An ember's path stops at a card's edge, and moving the card moves where
// embers land, with the same seed."
// `edge.flame` with its embers on a node between two raised cards, one above and one below, drawn at 4 s of the effect
// clock; chrome.json's `particles` gives each ember's path and where it stopped. At least one ember stops on a card, at a
// point on that card's edge, its path ending there; no ember's path ever goes inside a card. With the cards moved (24 pt
// out and 16 pt right) and the same seed, the same embers leave from the same places, and those that stop do so on the
// moved cards' edges, at other points than before. With no cards at all, some ember's path crosses where a card was, so
// the stops come from the cards and not from the embers' own fade.
import { describe, expect, it } from 'vitest';
import { AC, CARDS, SEED, embers, replica, useBuild, type Card, type Rect } from './helpers.ts';

const bin = useBuild('replica');
const AT = 4;
const TOL = 0.5;
const MOVED: Card[] = [{ id: 'card-above', rect: [296, 176, 400, 40] }, { id: 'card-below', rect: [296, 424, 400, 40] }];

interface Ember { effect: string; index: number; seed: number; path: [number, number, number][]; stopped: null | { on: string; at: [number, number]; t: number } }

function draw(cards: Card[]): Ember[] {
  const drawn = replica(bin(), embers(cards), { at: [AT] });
  expect(drawn.refusals, 'nothing is refused').toEqual([]);
  const all = (drawn.report['particles'] as Ember[] | undefined) ?? [];
  const mine = all.filter((e) => e.effect === 'flame');
  expect(mine.length, `chrome.json lists the flame's embers: ${JSON.stringify(drawn.report).slice(0, 600)}`).toBeGreaterThan(0);
  for (const e of mine) {
    expect(e.seed, `ember ${e.index} has the effect's seed`).toBe(SEED);
    expect(e.path.length, `ember ${e.index} has a path`).toBeGreaterThan(0);
  }
  return mine;
}
const inside = ([x, y]: number[], [rx, ry, rw, rh]: Rect, by: number): boolean => x! > rx + by && x! < rx + rw - by && y! > ry + by && y! < ry + rh - by;
const near = ([x, y]: number[], [rx, ry, rw, rh]: Rect): boolean => x! >= rx - TOL && x! <= rx + rw + TOL && y! >= ry - TOL && y! <= ry + rh + TOL;
const onEdge = (p: number[], r: Rect): boolean => near(p, r) && !inside(p, r, TOL);

/** Each ember stopped on a card is on its edge with its path ending there; no path goes inside a card. The landings. */
function landings(es: Ember[], cards: Card[]): string[] {
  const rects = new Map(cards.map((c) => [c.id, c.rect]));
  const landed = es.filter((e) => e.stopped !== null && rects.has(e.stopped.on));
  expect(landed.length, `an ember stops on a card: ${JSON.stringify(es.map((e) => e.stopped))}`).toBeGreaterThan(0);
  for (const e of landed) {
    const s = e.stopped!;
    expect(onEdge(s.at, rects.get(s.on)!), `ember ${e.index} stops at (${s.at.join(', ')}), on ${s.on}'s edge ${JSON.stringify(rects.get(s.on))}`).toBe(true);
    const last = e.path[e.path.length - 1]!;
    expect(Math.hypot(last[1] - s.at[0], last[2] - s.at[1]), `ember ${e.index}'s path ends where it stopped`).toBeLessThanOrEqual(0.01);
  }
  const into: string[] = [];
  for (const e of es) for (const [t, x, y] of e.path) for (const c of cards) {
    if (inside([x, y], c.rect, TOL) && into.length < 5) into.push(`ember ${e.index} at ${t} s is at (${x}, ${y}), inside ${c.id}`);
  }
  expect(into, 'path points inside a card').toEqual([]);
  return landed.map((e) => `${e.index}@${e.stopped!.on}(${e.stopped!.at.map((v) => v.toFixed(1)).join(',')})`).sort();
}

describe(`#1436 AC4 ${AC[4]} an ember's path stops at a card's edge`, () => {
  it('AC4 embers stop on the cards\' edges and never go inside; with no cards, a path crosses where a card was', () => {
    landings(draw(CARDS), CARDS);
    const free = draw([]);
    const crossed = free.some((e) => e.path.some(([, x, y]) => CARDS.some((c) => inside([x, y], c.rect, 1))));
    expect(crossed, 'with no cards, some ember goes through where a card was').toBe(true);
  }, 3_600_000);

  it('AC4 moving the cards moves where embers land, with the same seed', () => {
    const before = draw(CARDS);
    const after = draw(MOVED);
    const first = new Map(before.map((e) => [e.index, JSON.stringify(e.path[0])]));
    const both = after.filter((e) => first.has(e.index));
    expect(both.length, 'the same embers are there after the cards moved').toBeGreaterThan(0);
    const moved = both.filter((e) => JSON.stringify(e.path[0]) !== first.get(e.index)).map((e) => e.index);
    expect(moved, 'embers whose first point changed with the cards: the same seed sends each from the same place').toEqual([]);
    const was = landings(before, CARDS);
    const now = landings(after, MOVED);
    expect(now, 'where embers land, after the cards moved, against before').not.toEqual(was);
  }, 3_600_000);
});
