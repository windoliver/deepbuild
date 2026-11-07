// AC4 #467.2680a499: A parallax group's offset equals its closed form in the camera pose and t at 1,000 random times,
// and adding a terrain cell never changes another cell's tile
// (this file carries its second clause; parallax.test.ts the first)
//
// The recipe `tiles.terrain@1` expands at check (Mark set: atlas tiles), so its choice is read from `deep-canvas-render
// check`'s answer: the `marks@1` set with `cx`, `cy` and `tile` columns it expands into (helpers.ts `tilesOf`). The floor
// is a hex grid under `rules: edges_6` (Mark set: hex grid), where an edge with no neighbor expects the cell's own
// terrain, so on an all-grass floor no cell's labels change when a grass cell is added and every difference would be a
// reseeding. Four grass tiles match every cell, so each tile is the seeded hash's pick. Each added cell is written first,
// so a choice drawn from a stream in written order moves every other cell's.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, atlasPng, check, describeErrors, sha256, terrain, tilesOf, useBin } from './helpers.ts';

const ID = AC[4];
const bin = useBin('deep-canvas-render');

describe(`${ID} terrain tiles from a seeded recipe`, () => {
  it(`${ID} adding a terrain cell never changes another cell's tile`, () => {
    const store = mkdtempSync(join(tmpdir(), 'deep-467-store-'));
    try {
      const png = atlasPng();
      const asset = sha256(png);
      writeFileSync(join(store, asset), png);
      const base: [number, number][] = [];
      for (let cy = 0; cy < 5; cy++) for (let cx = 0; cx < 6; cx++) base.push([cx, cy]);
      const tiles = (cells: [number, number][], what: string): Map<string, number> => {
        const { answer, errors } = check(bin(), terrain(asset, cells), { store });
        expect(answer['ok'], `${what} passes the check: ${describeErrors(errors)}`).toBe(true);
        const t = tilesOf(answer);
        expect([...t.keys()].sort(), `${what}: one tile for each cell`).toEqual(cells.map(([x, y]) => `${x},${y}`).sort());
        return t;
      };
      const before = tiles(base, 'the 30-cell floor');
      expect(new Set(before.values()).size, `the seeded hash spreads the floor over its four equal tiles, not one: ${[...before.values()].join(' ')}`).toBeGreaterThan(1);
      expect([...before.values()].every((t) => [0, 1, 2, 3].includes(t)), 'every cell takes one of the recipe\'s tiles').toBe(true);
      for (const added of [[6, 2], [-1, 0], [3, 5]] as [number, number][]) {
        const after = tiles([added, ...base], `the floor with (${added.join(', ')}) added`);
        const moved = base.filter(([x, y]) => after.get(`${x},${y}`) !== before.get(`${x},${y}`)).map(([x, y]) => `(${x}, ${y}): ${before.get(`${x},${y}`)} → ${after.get(`${x},${y}`)}`);
        expect(moved, `adding (${added.join(', ')}) changes no other cell's tile`).toEqual([]);
      }
    } finally {
      rmSync(store, { recursive: true, force: true });
    }
  });
});
