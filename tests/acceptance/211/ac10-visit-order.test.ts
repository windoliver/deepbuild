// AC10 #211.15f6aeb8: "A 64 × 64-page world (pages {max 4,096, slots 64, moves 8, lead 4}) walked along two seeded
// 3,600-step tracks that visit its pages in different orders, with no player writes, ends with equal hashes in both
// page maps for every page both walks generated; a planted generator that writes a tree into whichever neighbour page
// is resident gives that page different hashes and fails, naming the page and both tracks"
//
// Through `deep-logic` (README): the walker (programs.ts) on a 64 × 64 torus in generate mode, which fills each page
// that arrives fresh from init's seed and its page number alone and writes nothing else; two seeded tracks of `steer`
// entries steer it through the world in different orders. logic.determinism takes them as `orders` (README:
// logic.determinism's orders) and compares the pages both generated; each track's bake ends with its page map at
// checkpoint 3,600. The planted generator is a program (the walker in tree mode): when it generates a page it also
// writes a tree into the page east of it whenever that page is resident.

import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, arrayOf, bakeCall, bakeOf, detOf, determinismCall, entryAt, logic, pagesOf, piece, rng, show, useBuilds, type Bake, type Entry, type JsonObject } from './helpers.ts';
import { walkWrites, walker } from './programs.ts';

const ID = AC(10);
useBuilds(['logic']);

const STEPS = 3600;
/** A seeded track: before each round's pick (step 8j + 1), with even odds, a `steer` entry of a seeded value in (0, 1]. */
function track(seed: number): Entry[] {
  const g = rng(seed);
  const out: Entry[] = [];
  for (let j = 0; j < STEPS / 8; j++) if (g() < 0.5) out.push(entryAt('steer', 8 * j + 1, (Math.floor(g() * 1e6) + 1) / 1e6));
  return out;
}
const TRACKS = [track(211_101), track(211_202)];
const worldPiece = (mode: 'generate' | 'tree'): JsonObject => piece({
  seed: 211_10, controls: ['steer'],
  items: {
    world: {
      program: walker({ name: `world_${mode}`, slots: 64, moves: 8, topology: { torus: [64, 64] }, start: 2080, pathSeed: 211_010n, mode }),
      reads: ['steer'], writes: walkWrites(64), pages: pagesOf({ max: 4096, slots: 64, moves: 8, lead: 4 }),
      budget: { memory: 5 }, checkpoint: { every: 60, budget: 268_435_456 },
    },
  },
});
/** Each track's bake: its page map at checkpoint 3,600 and the order in which it first entered pages. */
function walks(mode: 'generate' | 'tree'): { map: Record<string, string>; order: number[] }[] {
  const replies = logic(TRACKS.map((t) => bakeCall(worldPiece(mode), STEPS, { track: t })));
  return replies.map((r, i) => {
    const b: Bake = bakeOf(r, STEPS, `track ${i}'s walk (${mode})`);
    const last = (b.checkpoints['world'] ?? []).find((c) => c.step === STEPS);
    expect(last?.map, `track ${i}'s walk ends with a page map at checkpoint ${STEPS}: ${show(last?.raw)}`).toBeTruthy();
    const order: number[] = [];
    for (const s of b.steps) { const p = arrayOf(s, 'world.page', `track ${i}`)[0]!; if (p >= 0 && !order.includes(p)) order.push(p); }
    return { map: last!.map!, order };
  });
}
const both = (a: Record<string, string>, b: Record<string, string>): string[] => Object.keys(a).filter((p) => p in b);

describe(`${ID} pages generated as they arrive don't depend on the order the world is visited in`, () => {
  it(`${ID} two seeded tracks that visit the world in different orders end with equal hashes for every page both generated, and logic.determinism with both as orders passes`, () => {
    const [a, b] = walks('generate');
    expect(a!.order.join(',') === b!.order.join(','), 'the two tracks visit the world\'s pages in different orders').toBe(false);
    const common = both(a!.map, b!.map);
    expect(common.length, 'the two walks generated some pages in common').toBeGreaterThan(0);
    expect(common.filter((p) => a!.map[p] !== b!.map[p]), 'every page both walks generated has one hash in both page maps').toEqual([]);
    const [reply] = logic([determinismCall(worldPiece('generate'), STEPS, [], { track: TRACKS[0]!, orders: TRACKS })]);
    const det = detOf(reply!, 'logic.determinism with both tracks as orders');
    expect([det.verdict, det.failures], `logic.determinism passes: ${show(det.raw)}`).toEqual(['PASS', []]);
  }, TIMEOUT);

  it(`${ID} (the planted generator that writes a tree into a resident neighbour) gives that page different hashes and fails, naming the page and both tracks`, () => {
    const [reply] = logic([determinismCall(worldPiece('tree'), STEPS, [], { track: TRACKS[0]!, orders: TRACKS })]);
    const det = detOf(reply!, 'logic.determinism of the planted generator');
    expect(det.verdict, `logic.determinism fails the planted generator: ${show(det.raw)}`).toBe('FAIL');
    const named = det.failures.filter((f) => f['run'] === 'orders' && typeof f['page'] === 'number' && JSON.stringify(f['orders']) === '[0,1]');
    expect(named.length, `a failure names a page and both tracks (orders 0 and 1): ${show(det.failures as unknown as JsonObject[], 3000)}`).toBeGreaterThan(0);
    const [a, b] = walks('tree');
    const page = String(named[0]!['page']);
    expect([page in a!.map, page in b!.map], `page ${page}, which the failure names, is in both page maps`).toEqual([true, true]);
    expect(a!.map[page] === b!.map[page], `page ${page} has different hashes in the two page maps`).toBe(false);
  }, TIMEOUT);
});
