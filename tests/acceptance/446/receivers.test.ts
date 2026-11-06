// AC3 #446.42931fc0: An unshadowed lamp whose receivers are its room lights nothing outside that room.
//
// Two rooms in plan (their floors face +Z, an orthographic view from +Z sees them at 40 px/m) under a black sky: room A
// (floor, a table, the wall between the rooms) and room B (floor, a table), with a yard around them, which is in no
// room. An unshadowed lamp in room A, `receivers: room_a`, a collection of A's items. At 1.5 m over floor A it reads
// about 0.5, and with nothing filtering it floor B would read about 0.045 through the wall (no shadow stops it). Every
// pixel of floor_b, table_b and the yard (at least 50,000) reads 0 in the linear target, under 1e-5; room A's floor has
// a median above 0.1, so the lamp is on. The same with eleven lamps, past the eight above which culling goes by screen
// tile and depth slice (Light and the light policy), and `receivers` given as a list. The wrong program is a lamp that
// ignores its receivers, the same document without them: it must fail, naming floor_b.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, box, failsNaming, matte, none, only, ortho, point, readIds, readLinear, requireMetal, runGpu, sessionDoc, useDir, useGpu, view3dCall, writeJson,
  type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = AC[3];
const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [480, 320];
const OUTSIDE = ['floor_b', 'table_b', 'yard'];

function roomsDoc(lamps: number, receivers: JsonValue | undefined): JsonObject {
  const grey = { material: 'grey' };
  const items: Record<string, JsonObject> = {
    cam: ortho([0, 0, 0], 12), sky: DARK_SKY, grey: matte(0.8),
    yard: box([12, 8, 0.1], [0, 0, -0.15], grey),
    floor_a: box([4, 6, 0.1], [-2, 0, -0.05], grey), floor_b: box([4, 6, 0.1], [2, 0, -0.05], grey),
    wall_ab: box([0.2, 6, 2.5], [0, 0, 1.25], grey),
    table_a: box([1, 1, 0.7], [-3, -1.5, 0.35], grey), table_b: box([1, 1, 0.7], [2.5, 1, 0.35], grey),
  };
  for (let i = 0; i < lamps; i++) {
    items[`lamp${i}`] = point(55.5 / lamps, [-2 + 0.1 * i, 0.2 * (i % 3), 1.5], receivers === undefined ? {} : { receivers });
  }
  return sessionDoc(`rooms-${lamps}`, SIZE, items, { collections: { room_a: { members: ['floor_a', 'table_a', 'wall_ab'] } } });
}
function outsideProblems(lamps: number, receivers: JsonValue | undefined): string[] {
  const out = dir();
  const [reply] = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, `rooms-${lamps}`, roomsDoc(lamps, receivers)), size: SIZE, targets: ['linear', 'ids'] })]);
  const f = only(reply!, 'the rooms');
  const l = readLinear(out, f, SIZE, 'the rooms'); const ids = readIds(out, f, 'the rooms');
  const problems: string[] = []; const inside: number[] = [];
  let judged = 0;
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
    const id = ids.at(x, y);
    if (id === 'floor_a') inside.push(l.at(x, y));
    if (!id || !OUTSIDE.includes(id)) continue;
    judged++;
    if (l.at(x, y) > 1e-5) problems.push(`${id} is lit outside the room at (${x}, ${y}): ${l.at(x, y).toFixed(5)}`);
  }
  expect(judged, 'at least 50,000 pixels lie outside the room').toBeGreaterThanOrEqual(50_000);
  inside.sort((a, b) => a - b);
  expect(inside[Math.floor(inside.length / 2)] ?? 0, 'the lamp lights its own room').toBeGreaterThan(0.1);
  return problems;
}

describe(`${ID} an unshadowed lamp lights only its receivers`, () => {
  it(`${ID} nothing outside the room is lit, by one lamp or by eleven; a lamp without receivers lights floor_b through the wall`, () => {
    requireMetal();
    none(outsideProblems(1, 'room_a'), 'one lamp');
    none(outsideProblems(11, ['room_a']), 'eleven lamps');
    failsNaming(outsideProblems(1, undefined), ['floor_b'], 'a lamp that ignores its receivers');
  }, 1_800_000);
});
