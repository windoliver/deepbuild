// AC4 #211.c8b345d9: "A request for page 1,024 with max 1,024 traps pages, naming the request; a page asked for twice in
// one step traps pages; and a world that writes its 4,097th distinct page with written_max 256 MiB traps pages_full at
// the same step on macOS arm64 and in the web player, naming the count"
//
// Through `deep-logic` (README): two scripted items (programs.ts: script) whose step 5 asks for page 1,024 of a
// 1,024-page world, and for page 7 twice (request 0 into slot 0, request 1 into slot 1); a trap names the step whose
// requests it read, its kind and the request (`request: {index, page, slot}`). The flood (programs.ts) asks 16 fresh
// pages a step into 128 slots and writes each when it lands: pages 0 to 4,095 by step 258, then page 4,096 alone at
// step 259 (pages 4,097 to 4,111 land and are never written), so step 259 writes the 4,097th distinct page; with
// written_max 256 (MiB, 4,096 pages) it traps pages_full there, `written: 4097`, in the app (deep-logic's bake on this
// Mac) and in the web player (the web runner, in headless Chrome, on web_plan's request for the same bake).

import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, arrayOf, bakeCall, bakeOf, logic, onMacArm64, pagesOf, piece, show, str, useBuilds, webBake, type Bake, type ItemSpec, type JsonObject } from './helpers.ts';
import { flood, floodWrites, script, scriptWrites } from './programs.ts';

const ID = AC(4);
useBuilds(['logic']);

/** An item of `max` pages whose step 5 asks for `asks`, in request order. */
const asker = (name: string, max: number, asks: { page: number; slot: number }[]): ItemSpec => ({
  program: script({ name, slots: 4, moves: 2, at: { 5: asks.map((a) => ({ ask: a })) }, reads: [{ slot: 0, offset: 0, bytes: 4 }] }),
  writes: scriptWrites(1), pages: pagesOf({ max, slots: 4, moves: 2, lead: 4 }),
});
const floodPiece = (): JsonObject => piece({
  seed: 211_04,
  items: {
    world: {
      program: flood({ name: 'flood256', moves: 16, last: 262, limit: 4400, skip: [4097, 4111] }), writes: floodWrites,
      pages: pagesOf({ max: 8192, slots: 128, moves: 16, lead: 4, written_max: 256, web_max: 256 }),
      budget: { fuel: 2_000_000, memory: 9 }, checkpoint: { every: 60, budget: 1_073_741_824 },
    },
  },
});
/** The one trap of a bake, which must be its item's. */
function oneTrap(b: Bake, item: string, what: string): JsonObject {
  expect(b.traps.length, `${what}: one trap: ${show(b.traps as unknown as JsonObject[])}`).toBe(1);
  expect(b.traps[0]!['item'], `${what}: the trap is ${item}'s`).toBe(item);
  return b.traps[0]!;
}

describe(`${ID} page requests and written pages trap the same way everywhere`, () => {
  it(`${ID} page 1,024 of 1,024 traps pages naming the request; a page asked twice in a step traps pages; the 4,097th written page traps pages_full at the same step on macOS arm64 and in the web player, naming the count`, async () => {
    onMacArm64();
    const past = piece({ seed: 211_04, items: { past: asker('past', 1024, [{ page: 1024, slot: 0 }]) } });
    const twice = piece({ seed: 211_04, items: { twice: asker('twice', 64, [{ page: 7, slot: 0 }, { page: 7, slot: 1 }]) } });
    const [a, b] = logic([bakeCall(past, 10), bakeCall(twice, 10)]);

    const t1 = oneTrap(bakeOf(a!, 10, 'the request past max'), 'past', 'the request past max');
    expect([t1['kind'], t1['step'], t1['request']], `a request for page 1,024 with max 1,024 traps pages after step 5, naming the request: ${show(t1)}`)
      .toEqual(['pages', 5, { index: 0, page: 1024, slot: 0 }]);
    str(t1['why'], 'the pages trap\'s why');

    const t2 = oneTrap(bakeOf(b!, 10, 'the page asked twice'), 'twice', 'the page asked twice');
    expect([t2['kind'], t2['step'], t2['request']], `page 7 asked for twice in step 5 traps pages, naming the second request: ${show(t2)}`)
      .toEqual(['pages', 5, { index: 1, page: 7, slot: 1 }]);
    str(t2['why'], 'the pages trap\'s why');

    const [c] = logic([bakeCall(floodPiece(), 264)]);
    const app = bakeOf(c!, 264, 'the flood in the app');
    expect(arrayOf(app.steps[258]!, 'world.written', 'the flood in the app')[0], 'by step 258 the flood has written 4,096 distinct pages').toBe(4096);
    const t3 = oneTrap(app, 'world', 'the flood in the app');
    expect([t3['kind'], t3['step'], t3['written']], `the 4,097th written page traps pages_full at step 259 on macOS arm64, naming the count: ${show(t3)}`)
      .toEqual(['pages_full', 259, 4097]);

    const web = await webBake(floodPiece(), 264, 'the flood in the web player');
    const t4 = oneTrap(web, 'world', 'the flood in the web player');
    expect([t4['kind'], t4['step'], t4['written']], `the web player traps pages_full at the same step, naming the count: ${show(t4)}`)
      .toEqual(['pages_full', 259, 4097]);
  }, TIMEOUT);
});
