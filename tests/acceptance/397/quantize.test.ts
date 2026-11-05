// AC4: A mark set of 400 cells whose role encodes a value through a quantize scale over five palette roles colors
// each cell with the role of its value's band, and no cell takes a literal color.
// fixtures/quantize-400.json: 400 values on a 20 × 20 grid of 24 u cells; the scale's domain is [0, 100] and its
// range the five roles heat_1 … heat_5. The expected band is d3-scale's scaleQuantize (the Oracle page's d3-scale
// 83555bd759, test/quantize-test.js), ported: thresholds ((i + 1) × x1 − (i − n) × x0) ÷ (n + 1) and the band the
// number of thresholds at or below the value (bisectRight), so the edges 20, 40, 60 and 80 open the next band and 100
// takes the last. `deep-canvas-render raster` draws the set twice, under two looks that give the five roles different
// colors: each cell's center must be its band's role in each look, so a cell colored by a literal can't follow both.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, arr, checked, f32Column, fixtureJson, lines, num, obj, pixel, readPng, rolesOf, same, shownIssues, u32Column, useBuilds, useTemp,
  type JsonObject, type Rgb,
} from './helpers.ts';

const builds = useBuilds([{ bin: 'deep-canvas-render' }]);
const render = (): string => builds.path({ bin: 'deep-canvas-render' });
const temp = useTemp('quantize');

const F = fixtureJson('quantize-400.json');
const VALUES = arr(F['values'], 'values').map((v, i) => num(v, `values[${i}]`));
const [X0, X1] = arr(F['domain'], 'domain').map((v) => num(v, 'domain')) as [number, number];
const COLS = num(F['columns'], 'columns');
const CELL = num(F['cell'], 'cell');
const [OX, OY] = arr(F['origin'], 'origin').map((v) => num(v, 'origin')) as [number, number];
const ROLES = ['heat_1', 'heat_2', 'heat_3', 'heat_4', 'heat_5'];

/** d3's scaleQuantize over ROLES: thresholds, then bisectRight. */
function band(v: number): number {
  const n = ROLES.length - 1;
  const thresholds = Array.from({ length: n }, (_, i) => ((i + 1) * X1 - (i - n) * X0) / (n + 1));
  return thresholds.filter((t) => t <= v).length;
}

const cellBox = (i: number): [number, number] => [OX + (i % COLS) * CELL, OY + Math.floor(i / COLS) * CELL];

function heatmap(): JsonObject {
  const boxes = VALUES.map((_, i) => cellBox(i));
  return {
    format: 1, id: 'chart-heat', profile: 'chart', title: 'Heat map', description: 'Four hundred cells colored by value through a quantize scale over five roles.',
    size: [OX * 2 + COLS * CELL, OY * 2 + (VALUES.length / COLS) * CELL], layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: {
      heat: { id: 'heat', kind: 'scale@1', layer: 'main', name: 'Heat', order: 'a0', params: { type: 'quantize', domain: [X0, X1], range: ROLES, nice: false } },
      cells: {
        id: 'cells', kind: 'marks@1', layer: 'main', name: 'Cells', order: 'a1',
        params: {
          mark: 'rect', n: VALUES.length, key: 'key',
          columns: {
            key: u32Column(VALUES.map((_, i) => i)),
            x: f32Column(boxes.map((b) => b[0])), y: f32Column(boxes.map((b) => b[1])),
            x2: f32Column(boxes.map((b) => b[0] + CELL)), y2: f32Column(boxes.map((b) => b[1] + CELL)),
            v: f32Column(VALUES),
          },
          encode: { x: { column: 'x' }, y: { column: 'y' }, x2: { column: 'x2' }, y2: { column: 'y2' }, role: { column: 'v', scale: 'heat' } },
        },
      },
    },
  };
}

/** A role map (#373's look form): the ground, ink and the five roles. */
const lookOf = (roles: Record<string, Rgb>): JsonObject => ({ light: { ground: [255, 255, 255], ink: [0, 0, 0], ...roles } });

function drawn(name: string, roles: Record<string, Rgb>): Rgb[] {
  const out = `${temp()}/${name}.png`;
  const [answer] = lines(render(), ['raster'], [{ out, doc: heatmap(), look: lookOf(roles) }]);
  expect(obj(answer, 'raster')['ok'], `raster draws the heat map: ${JSON.stringify(answer).slice(0, 1500)}`).toBe(true);
  const image = readPng(out);
  return VALUES.map((_, i) => { const [x, y] = cellBox(i); return pixel(image, x + CELL / 2, y + CELL / 2); });
}

function expectBands(colors: Rgb[], roles: Record<string, Rgb>, what: string): void {
  const wrong = VALUES.flatMap((v, i) => {
    const want = roles[ROLES[band(v)]!]!;
    return same(colors[i]!, want) ? [] : [`cell ${i} (value ${v}, band ${band(v) + 1}): ${JSON.stringify(colors[i])}, want ${ROLES[band(v)]} ${JSON.stringify(want)}`];
  });
  expect(wrong.slice(0, 20), `${what}: every cell takes the role of its value's band (${wrong.length} of 400 don't)`).toEqual([]);
}

describe('AC4 a quantize scale over five palette roles colors each of 400 cells with its band\'s role', () => {
  it('AC4 (bands) each cell takes the role of its value\'s band, the band edges included, and the set passes the check', () => {
    expect(VALUES.length, 'the fixture holds 400 cells').toBe(400);
    expect([20, 40, 60, 80, 0, 100].every((v) => VALUES.includes(v)), 'the fixture holds every band edge and both ends of the domain').toBe(true);
    expect(new Set(VALUES.map(band)).size, 'every band holds cells').toBe(5);
    const roles = rolesOf('heat_a');
    const [c] = lines(render(), ['check'], [{ doc: heatmap(), look: lookOf(roles) }]);
    const result = checked(c, 'check');
    expect(result.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `the heat map passes the check: ${shownIssues(result)}`).toEqual([]);
    expectBands(drawn('heat-a', roles), roles, 'look A');
  }, TIMEOUT);

  it('AC4 (no literal) under a look that gives the five roles other colors every cell follows its role, so no cell takes a literal color', () => {
    const a = rolesOf('heat_a');
    const b = rolesOf('heat_b');
    expect(ROLES.every((r) => !same(a[r]!, b[r]!)), 'the two looks give every role a different color').toBe(true);
    const underA = drawn('heat-a', a);
    const underB = drawn('heat-b', b);
    expectBands(underB, b, 'look B');
    expect(underA.filter((c, i) => same(c, underB[i]!)).length, 'no cell keeps its color when the look changes its role').toBe(0);
  }, TIMEOUT);
});
