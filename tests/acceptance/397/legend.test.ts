// AC3: A legend that tells two series apart only by a red and a green role whose simulated deuteranopia colors lie
// 0.02 apart is refused naming both roles, passes once the second series takes a dashed line, and a blue and orange
// pair passes unchanged.
// Two line series, each a `marks@1` path set whose `role` is encoded through one ordinal scale over the categories
// `north` and `south` (a scale whose range is palette roles; its legend is automatic). fixtures/roles.json holds the
// pairs; each test first recomputes, from Machado et al. 2009 at full severity (the Oracle page's colorspacious
// matrices) and OKLab, that the pair is what the criterion says, against the look's data distance 0.06 (Look:
// `data_distance: OKLab ΔE = 0.06`, left at its default here). `deep-canvas-render check` with the clean look plus the
// pair's roles answers.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, VISIONS, checked, cleanLook, deltaE, f32Column, holdsAsData, lines, lookWith, rolesOf, shownIssues, u32Column, useBuilds,
  type Checked, type JsonObject, type Rgb,
} from './helpers.ts';

const builds = useBuilds([{ bin: 'deep-canvas-render' }]);
const render = (): string => builds.path({ bin: 'deep-canvas-render' });
const DATA_DISTANCE = 0.06;
const RED_GREEN = rolesOf('red_green');
const BLUE_ORANGE = rolesOf('blue_orange');

function series(id: string, category: string, ys: number[], order: string, dash: number[] | null): JsonObject {
  const xs = [40, 160, 280, 400, 520];
  return {
    id, kind: 'marks@1', layer: 'main', name: `Series ${category}`, order,
    params: {
      mark: 'path', n: 5, key: 'key',
      columns: { key: u32Column([1, 2, 3, 4, 5]), x: f32Column(xs), y: f32Column(ys), series: { const: category } },
      encode: { x: { column: 'x' }, y: { column: 'y' }, role: { column: 'series', scale: 'colors' } },
      paint: { stroke: { width: 3, ...(dash ? { dash } : {}) } },
    },
  };
}

function twoSeries(roles: [string, string], dashSecond: boolean): JsonObject {
  return {
    format: 1, id: 'chart-two-series', profile: 'chart', title: 'Two series', description: 'Two line series told apart by their roles, with the automatic legend of their color scale.',
    size: [600, 320], layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: {
      colors: { id: 'colors', kind: 'scale@1', layer: 'main', name: 'Series colors', order: 'a0', params: { type: 'ordinal', domain: ['north', 'south'], range: roles } },
      north: series('north', 'north', [200, 160, 180, 120, 140], 'a1', null),
      south: series('south', 'south', [260, 240, 250, 210, 230], 'a2', dashSecond ? [6, 4] : null),
    },
  };
}

function check(doc: JsonObject, roles: Record<string, Rgb>): Checked {
  const [out] = lines(render(), ['check'], [{ doc, look: lookWith(cleanLook(render()), roles) }]);
  return checked(out, 'check');
}

/** The criterion's red and green: 0.02 apart under deuteranopia, farther than the data distance as seen. */
function expectRedGreen(): void {
  const [red, green] = [RED_GREEN['series_red']!, RED_GREEN['series_green']!];
  for (const clip of [false, true]) expect(Math.abs(deltaE(red, green, 'deuteranopia', clip) - 0.02), `the red and green lie 0.02 apart under simulated deuteranopia (clipped: ${clip})`).toBeLessThan(0.0005);
  expect(deltaE(red, green, 'seen'), 'as seen, the red and green are farther apart than the data distance').toBeGreaterThan(DATA_DISTANCE);
}

describe('AC3 categories a legend tells apart by color alone keep the data distance under simulated color-vision deficiency', () => {
  it('AC3 (refused) a red and a green role whose simulated deuteranopia colors lie 0.02 apart, solid lines both, are refused naming both roles', () => {
    expectRedGreen();
    const c = check(twoSeries(['series_red', 'series_green'], false), RED_GREEN);
    expect(c.ok, `the check refuses the pair: ${shownIssues(c)}`).toBe(false);
    const naming = c.errors.filter((e) => holdsAsData(e.raw, 'series_red') && holdsAsData(e.raw, 'series_green'));
    expect(naming.length, `an error names both roles as data, outside what and fix: ${shownIssues(c)}`).toBeGreaterThan(0);
  }, TIMEOUT);

  it('AC3 (dashed) the same pair passes once the second series takes a dashed line', () => {
    expectRedGreen();
    const c = check(twoSeries(['series_red', 'series_green'], true), RED_GREEN);
    expect(c.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `the dashed second series tells the pair apart: ${shownIssues(c)}`).toEqual([]);
    expect(c.ok, 'the check passes').toBe(true);
  }, TIMEOUT);

  it('AC3 (blue and orange) a blue and orange pair, solid lines both, passes unchanged', () => {
    const [blue, orange] = [BLUE_ORANGE['series_blue']!, BLUE_ORANGE['series_orange']!];
    for (const vision of VISIONS) for (const clip of [false, true]) {
      expect(deltaE(blue, orange, vision, clip), `the blue and orange stay farther apart than the data distance (${vision}, clipped: ${clip})`).toBeGreaterThan(DATA_DISTANCE);
    }
    const c = check(twoSeries(['series_blue', 'series_orange'], false), BLUE_ORANGE);
    expect(c.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `the pair passes: ${shownIssues(c)}`).toEqual([]);
    expect(c.ok, 'the check passes').toBe(true);
  }, TIMEOUT);
});
