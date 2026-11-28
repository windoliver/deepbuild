import { describe, expect, it } from 'vitest';
import { ROOMS, cellsOfClass, floorOf, roomsFacts } from './floors.ts';
import { TIMEOUT, bench, fillOf, keep, none, publishes, reachKit, reachSpec, runCheck, runFill, skipOf } from './helpers.ts';
import { PLANTED, SKIPPED, onlySkippedWrong, passedWrong, skippedWrong } from './judges.ts';
import { RUNS, playtest, reach, type Need } from './programs.ts';

const ID = 'AC2 #3263.df7081dd';
const BOTH: Need[] = [{ goal: 'exit', through: [ROOMS.first, ROOMS.second] }];
const FIRST_ONLY: Need[] = [{ goal: 'exit', through: [ROOMS.first] }];
const SECOND_ONLY: Need[] = [{ goal: 'exit', through: [ROOMS.second] }];
const floor = floorOf('rooms');
const room = (name: string): { what: string; cells: number[] } => ({ what: `the room of class ${name}`, cells: cellsOfClass(floor, name) });

describe(`${ID} an exit reached through either of two rooms needs both rooms' classes closed`, () => {
  it(`${ID} the two-room floor passes with both rooms' classes in through, and fails grid.skipped with one, naming a route through the other room`, async () => {
    none(roomsFacts(), 'the two-room floor, by this suite\'s own search: the exit is reached through either room, and through neither with both closed');
    const { pool, hub, play } = await bench();
    const rooms = keep('rooms');
    await publishes(pool, rooms, 'rooms');

    const both = await runCheck(hub, reachSpec(reach(BOTH), playtest(rooms, play)));
    expect(passedWrong(both, RUNS), `the floor passes with through: [${ROOMS.first}, ${ROOMS.second}]`).toEqual([]);

    const first = await runCheck(hub, reachSpec(reach(FIRST_ONLY), playtest(rooms, play)));
    for (let i = 0; i < RUNS; i++) {
      expect(skippedWrong(first, skipOf(i, floor, [ROOMS.first], [room(ROOMS.second)])), `with through: [${ROOMS.first}] run ${i}'s floor fails ${SKIPPED} once, naming a route through the ${ROOMS.second} room`).toEqual([]);
    }
    expect(onlySkippedWrong(first, RUNS), `and nothing but ${SKIPPED} fails`).toEqual([]);

    const second = await runCheck(hub, reachSpec(reach(SECOND_ONLY), playtest(rooms, play)));
    for (let i = 0; i < RUNS; i++) {
      expect(skippedWrong(second, skipOf(i, floor, [ROOMS.second], [room(ROOMS.first)])), `with through: [${ROOMS.second}] run ${i}'s floor fails ${SKIPPED} once, naming a route through the ${ROOMS.first} room`).toEqual([]);
    }
    expect(onlySkippedWrong(second, RUNS), `and nothing but ${SKIPPED} fails`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} a planted check that closes only the first class listed finds the route through the second room with both named, and fails this test`, async () => {
    none(roomsFacts(), 'the two-room floor, by this suite\'s own search');
    const { pool, hub, play } = await bench();
    const rooms = keep('rooms');
    await publishes(pool, rooms, 'rooms');
    const kit = await reachKit(pool);
    const planted = fillOf(kit, PLANTED);
    const spec = reachSpec(reach(BOTH), playtest(rooms, play));

    const wrong = await runFill(planted, spec);
    for (let i = 0; i < RUNS; i++) {
      expect(skippedWrong(wrong, skipOf(i, floor, [ROOMS.first], [room(ROOMS.second)])), `the planted check closes ${ROOMS.first} alone: run ${i}'s floor fails ${SKIPPED}, naming a route through the ${ROOMS.second} room`).toEqual([]);
    }
    expect(passedWrong(wrong, RUNS), 'and so it fails this test, which holds the floor to pass with both classes named').not.toEqual([]);
    expect(passedWrong(await runFill(fillOf(kit, 'clean'), spec), RUNS), 'the kit\'s reference check passes the same floor with both named').toEqual([]);
    expect(passedWrong(await runCheck(hub, spec), RUNS), 'and so does grid.reach through the hub').toEqual([]);
  }, TIMEOUT);
});
