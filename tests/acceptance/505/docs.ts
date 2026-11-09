// The documents the #505 tests send, each written from its criterion's words (README: Documents), with the scales
// that put the issue's numbers in document u. The criterion tests and the taste test share them, so the pictures
// the taste call sees are the documents the criteria check.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FIXTURES, document, fl, item, lin, ramp, scale, slider, stroke, type JsonObject,
} from './helpers.ts';

/** The time a test's slider gesture lands: one second in. */
export const T = fl(1);

// ---------------------------------------------------------------------------------------------------
// AC1: the formula an agent's renderer wrote, written on term by term.

export const FORMULA_SVG = (): Buffer => readFileSync(join(FIXTURES, 'pythagoras.svg'));
export const FORMULA_ALT = 'a^2 + b^2 = c^2';
/** The terms in reading order, with their boxes in document u ([x0, y0, x1, y1]; the SVG drawn at (20, 20), scale 1) and a point of their fill. */
export const TERMS: { id: string; box: [number, number, number, number]; inside: [number, number] }[] = [
  { id: 't-a2', box: [30, 40, 110, 100], inside: [70, 70] },
  { id: 't-plus', box: [130, 40, 190, 100], inside: [160, 70] },
  { id: 't-b2', box: [210, 40, 290, 100], inside: [250, 70] },
  { id: 't-eq', box: [310, 48, 370, 92], inside: [340, 56] },
  { id: 't-c2', box: [390, 40, 470, 100], inside: [430, 70] },
];
/** Over 1 s, n = 5 terms overlap by min(4 ÷ n, 0.2) = 0.2 of a span: each span 1 ÷ (1 + 4 × 0.2) s, term k from k × 0.2 spans. */
export const LAG = Math.min(4 / TERMS.length, 0.2);
export const SPAN = 1 / (1 + (TERMS.length - 1) * LAG);
export const termStart = (k: number): number => k * LAG * SPAN;
const formulaParams = (src: string): JsonObject => ({
  src, size: [500, 100], colors: { currentColor: 'ink' }, alt: FORMULA_ALT, write_on: { progress: 0, order: 'term' },
});
const writeOn = (): JsonObject => ({ write: ramp('items/formula/params/write_on/progress', 0, 1, 1) });
/** For `deep-canvas-render` (#398's form): the SVG named by `src` in the request's store. */
export const formulaDoc = (src: string): JsonObject => document('formula-505', 'a squared plus b squared equals c squared', [540, 140], [
  item('formula', 'vector@1', 'a0', formulaParams(src), { role: 'part', at: { pos: [20, 20, 0] } }),
], { channels: writeOn() });
/** For the hub (`deep-show run`, #376's form): no layers (they come from the connection), the modules it requires named. */
export const formulaHubDoc = (src: string): JsonObject => ({
  format: 1, profile: 'figure', title: 'a squared plus b squared equals c squared',
  description: 'The Pythagorean identity, written on term by term, for the #505 acceptance tests.', size: [540, 140],
  requires: { modules: { marks2d: '^1', vector: '^1' } },
  items: { formula: { id: 'formula', kind: 'vector@1', name: 'Pythagorean identity', role: 'part', order: 'a0', at: { pos: [20, 20, 0] }, params: formulaParams(src) } },
  channels: writeOn(),
});

// ---------------------------------------------------------------------------------------------------
// AC2: y = a·x² over [−2, 2], a bound to a slider, with a probe at x = 1.5.

export const PARABOLA = { x: [-2, 2] as [number, number], y: [0, 8] as [number, number], ux: [20, 420] as [number, number], uy: [420, 20] as [number, number] };
export const parabolaU = { x: lin(PARABOLA.x, PARABOLA.ux), y: lin(PARABOLA.y, PARABOLA.uy) };
export const parabolaDoc = (): JsonObject => document('parabola-505', 'y equals a x squared, a on a slider', [440, 480], [
  scale('px', 'a0', PARABOLA.x, PARABOLA.ux),
  scale('py', 'a1', PARABOLA.y, PARABOLA.uy),
  item('curve', 'path@1', 'b0', {
    fn: { y: 'a * x^2', over: [-2, 2], vars: { a: 'controls/a/value' }, scales: { x: 'px', y: 'py' } },
    probes: { p: { at: 1.5 } },
    paint: stroke('ink', 2),
  }),
  item('track', 'rect@1', 'c0', { box: [20, 448, 400, 4], paint: { fill: { role: 'muted' } } }),
  item('knob', 'rect@1', 'c1', { box: [10, 440, 20, 20], paint: { fill: { role: 'accent' } } }, { role: 'control' }),
], { controls: { a: slider('a', [0.5, 2], 0.5, { handle: { item: 'knob', along: 'x', travel: 400, drag: 'along' } }) } });

// ---------------------------------------------------------------------------------------------------
// AC3: sin(2πx) over [0, 1] at 100 px per unit on both axes; sin(1/x) over [0.0001, 1].

export const SINE = { x: [0, 1] as [number, number], y: [-1, 1] as [number, number], ux: [50, 150] as [number, number], uy: [250, 50] as [number, number] };
export const sineU = { x: lin(SINE.x, SINE.ux), y: lin(SINE.y, SINE.uy) };
export const sineDoc = (): JsonObject => document('sine-505', 'y equals sin 2 pi x', [200, 300], [
  scale('sx', 'a0', SINE.x, SINE.ux),
  scale('sy', 'a1', SINE.y, SINE.uy),
  item('curve', 'path@1', 'b0', { fn: { y: 'sin(2 * pi * x)', over: [0, 1], scales: { x: 'sx', y: 'sy' } }, paint: stroke('ink', 2) }),
]);
export const WILD = { x: [0.0001, 1] as [number, number], y: [-1, 1] as [number, number], ux: [50, 1050] as [number, number], uy: [250, 50] as [number, number] };
export const wildU = { x: lin(WILD.x, WILD.ux), y: lin(WILD.y, WILD.uy) };
/** sin(1/x) over [0.0001, 1]; with `fill`, the area to the axis over that range, which needs the curve's bound there. */
export const wildDoc = (fill?: [number, number]): JsonObject => document('wild-505', 'y equals sin of 1 over x', [1100, 300], [
  scale('wx', 'a0', WILD.x, WILD.ux),
  scale('wy', 'a1', WILD.y, WILD.uy),
  item('curve', 'path@1', 'b0', {
    fn: { y: 'sin(1 / x)', over: [0.0001, 1], scales: { x: 'wx', y: 'wy' } },
    ...(fill ? { fill: { to: 'axis', over: fill } } : {}),
    paint: { ...stroke('ink', 1), ...(fill ? { fill: { role: 'fillr' } } : {}) },
  }),
]);

// ---------------------------------------------------------------------------------------------------
// AC4: implicit curves, 100 u per unit.

export interface Plane { x: [number, number]; y: [number, number]; ux: [number, number]; uy: [number, number] }
export const planeU = (p: Plane) => ({ x: lin(p.x, p.ux), y: lin(p.y, p.uy), fx: lin(p.ux, p.x), fy: lin(p.uy, p.y) });
export const SQUARE2: Plane = { x: [-2, 2], y: [-2, 2], ux: [20, 420], uy: [420, 20] };
export const SQUARE3: Plane = { x: [-3, 3], y: [-3, 3], ux: [20, 620], uy: [620, 20] };
export const SQUARE1: Plane = { x: [-1, 1], y: [-1, 1], ux: [20, 420], uy: [420, 20] };
export const implicitDoc = (id: string, zero: string, p: Plane, size: [number, number]): JsonObject => document(id, `${zero} = 0`, size, [
  scale('ix', 'a0', p.x, p.ux),
  scale('iy', 'a1', p.y, p.uy),
  item('curve', 'path@1', 'b0', { fn: { zero, over_x: p.x, over_y: p.y, scales: { x: 'ix', y: 'iy' } }, paint: stroke('ink', 2) }),
]);
export const CIRCLE = 'x^2 + y^2 - 1';
export const ELLIPTIC = 'y^2 - x^3 + 2 * x - 1';
/** A circle of radius 0.02 at (1.5, 0). */
export const SMALL = '(x - 1.5)^2 + y^2 - 0.0004';
export const CAPPED = 'sin(1 / (x * y))';
export const circleDoc = (): JsonObject => implicitDoc('circle-505', CIRCLE, SQUARE2, [440, 440]);
export const ellipticDoc = (): JsonObject => implicitDoc('elliptic-505', ELLIPTIC, SQUARE3, [640, 640]);
export const smallDoc = (): JsonObject => implicitDoc('small-505', SMALL, SQUARE2, [440, 440]);
export const cappedDoc = (): JsonObject => implicitDoc('capped-505', CAPPED, SQUARE1, [440, 440]);

// ---------------------------------------------------------------------------------------------------
// AC5: a bar set whose columns come from a formula over the row index, n on a slider; a counter on sum(y) ÷ n.

export const BARS = { x: [0, 1] as [number, number], y: [0, 1] as [number, number], ux: [20, 420] as [number, number], uy: [280, 30] as [number, number] };
export const barsU = { x: lin(BARS.x, BARS.ux), y: lin(BARS.y, BARS.uy) };
export const riemannDoc = (max = 100): JsonObject => document('riemann-505', 'Midpoint Riemann sum of x squared', [440, 320], [
  scale('bx', 'a0', BARS.x, BARS.ux),
  scale('by', 'a1', BARS.y, BARS.uy),
  item('bars', 'marks@1', 'b0', {
    mark: 'bar', n: 'controls/count/value',
    columns: { x: { expr: '(i + 0.5) / n' }, y: { expr: 'x ^ 2' }, x0: { expr: 'i / n' }, x1: { expr: '(i + 1) / n' } },
    encode: { x: { column: 'x0', scale: 'bx' }, x2: { column: 'x1', scale: 'bx' }, y: { column: 'y', scale: 'by' } },
    paint: { fill: { role: 'ink' } },
  }),
  item('count', 'text@1', 'c0', { text: { counter: { source: 'riemann', format: { precision: 6 }, tabular: true } }, font: 'body', size: 13, box: { w: 160, h: 20 } }, { at: { pos: [20, 292, 0] } }),
], {
  controls: { count: slider('n', [1, max], 4, { increment: 1 }) },
  data: { riemann: { value: 0, source: 'story' } },
  drivers: { riemann: { target: 'data/riemann', expr: 's / n', vars: { s: 'items/bars#sum/y', n: 'controls/count/value' }, fallback: 0 } },
});
/** Bars of sin(2πx) at n = 8, a role column `y < 0 ? 1 : 0` over the set's roles [ink, accent]. */
export const WAVES = { x: [0, 1] as [number, number], y: [-1, 1] as [number, number], ux: [20, 420] as [number, number], uy: [280, 30] as [number, number] };
export const wavesU = { x: lin(WAVES.x, WAVES.ux), y: lin(WAVES.y, WAVES.uy) };
export const wavesDoc = (): JsonObject => document('waves-505', 'Bars of sin 2 pi x, colored by sign', [440, 320], [
  scale('wx', 'a0', WAVES.x, WAVES.ux),
  scale('wy', 'a1', WAVES.y, WAVES.uy),
  item('waves', 'marks@1', 'b0', {
    mark: 'bar', n: 8, roles: ['ink', 'accent'],
    columns: { x: { expr: '(i + 0.5) / n' }, y: { expr: 'sin(tau * x)' }, role: { expr: 'y < 0 ? 1 : 0' }, x0: { expr: 'i / n' }, x1: { expr: '(i + 1) / n' } },
    encode: { x: { column: 'x0', scale: 'wx' }, x2: { column: 'x1', scale: 'wx' }, y: { column: 'y', scale: 'wy' } },
  }),
]);
/** The bare set with n on a slider declared up to `max`. */
export const declaredDoc = (max: number): JsonObject => document(`declared-${max}`, `Bars with n up to ${max}`, [440, 320], [
  scale('bx', 'a0', BARS.x, BARS.ux),
  scale('by', 'a1', BARS.y, BARS.uy),
  item('bars', 'marks@1', 'b0', {
    mark: 'bar', n: 'controls/count/value',
    columns: { x: { expr: '(i + 0.5) / n' }, y: { expr: 'x ^ 2' }, x0: { expr: 'i / n' }, x1: { expr: '(i + 1) / n' } },
    encode: { x: { column: 'x0', scale: 'bx' }, x2: { column: 'x1', scale: 'bx' }, y: { column: 'y', scale: 'by' } },
    paint: { fill: { role: 'ink' } },
  }),
], { controls: { count: slider('n', [1, max], 4, { increment: 1 }) } });

// ---------------------------------------------------------------------------------------------------
// AC6: calculus on a function path.

export const UNIT = { x: [0, 1] as [number, number], y: [0, 1] as [number, number], ux: [40, 440] as [number, number], uy: [440, 40] as [number, number] };
export const unitU = { x: lin(UNIT.x, UNIT.ux), y: lin(UNIT.y, UNIT.uy) };
/** y = x² filled to the axis over [0, 1]; the slider `upper` moves the fill's upper end. */
export const areaDoc = (): JsonObject => document('area-505', 'The area under x squared', [480, 480], [
  scale('ux', 'a0', UNIT.x, UNIT.ux),
  scale('uy', 'a1', UNIT.y, UNIT.uy),
  item('area', 'path@1', 'b0', {
    fn: { y: 'x^2', over: [0, 1], scales: { x: 'ux', y: 'uy' } },
    fill: { to: 'axis', over: [0, 1] },
    paint: { ...stroke('ink', 2), fill: { role: 'fillr' } },
  }),
], { controls: { upper: slider('upper end', [0.25, 1], 1, { binds: ['items/area/params/fill/over/1'] }) } });
export const SECANT = { x: [0, 3] as [number, number], y: [0, 2.25] as [number, number], ux: [40, 340] as [number, number], uy: [260, 35] as [number, number] };
export const secantU = { x: lin(SECANT.x, SECANT.ux), y: lin(SECANT.y, SECANT.uy) };
/** y = x²/4 with probes at 1.5 and 2.5, a slope readout of the secant through them, and a path attached between their anchors. */
export const secantDoc = (): JsonObject => document('secant-505', 'A secant of x squared over four', [380, 300], [
  scale('sx', 'a0', SECANT.x, SECANT.ux),
  scale('sy', 'a1', SECANT.y, SECANT.uy),
  item('curve', 'path@1', 'b0', { fn: { y: 'x^2 / 4', over: [0, 3], scales: { x: 'sx', y: 'sy' } }, probes: { p1: { at: 1.5 }, p2: { at: 2.5 } }, paint: stroke('ink', 2) }),
  item('chord', 'path@1', 'b1', { d: 'M 0 0 L 10 10', attach: { start: 'curve#p1', end: 'curve#p2' }, paint: stroke('accent', 2) }),
  item('slope', 'text@1', 'c0', { text: { counter: { source: 'secant', format: { precision: 4 }, tabular: true } }, font: 'body', size: 13, box: { w: 120, h: 20 } }, { at: { pos: [40, 272, 0] } }),
], {
  data: { secant: { value: 0, source: 'story' } },
  drivers: { secant: { target: 'data/secant', expr: '(y2 - y1) / (x2 - x1)', vars: { y1: 'items/curve#p1/y', y2: 'items/curve#p2/y', x1: 'items/curve#p1/x', x2: 'items/curve#p2/x' }, fallback: 0 } },
});
export const SLOPES = { x: [0, 2] as [number, number], y: [0, 4] as [number, number], ux: [40, 440] as [number, number], uy: [440, 40] as [number, number] };
export const slopesU = { x: lin(SLOPES.x, SLOPES.ux), y: lin(SLOPES.y, SLOPES.uy) };
/** y = x² and a curve `d` marked `derivative_of` it. */
export const derivativeDoc = (d: string): JsonObject => document('derivative-505', `${d} as the derivative of x squared`, [480, 480], [
  scale('dx', 'a0', SLOPES.x, SLOPES.ux),
  scale('dy', 'a1', SLOPES.y, SLOPES.uy),
  item('f', 'path@1', 'b0', { fn: { y: 'x^2', over: [0, 2], scales: { x: 'dx', y: 'dy' } }, paint: stroke('ink', 2) }),
  item('d', 'path@1', 'b1', { fn: { y: d, over: [0, 2], scales: { x: 'dx', y: 'dy' } }, derivative_of: 'f', paint: stroke('accent', 2) }),
]);
/** y = x² over [0, e], e a data value a channel keys from 0.25 at 0 s to 1 at 1 s. */
export const END = (t: number): number => 0.25 + 0.75 * Math.min(1, Math.max(0, t / fl(1)));
export const growDoc = (): JsonObject => document('grow-505', 'x squared up to a moving end', [480, 480], [
  scale('gx', 'a0', UNIT.x, UNIT.ux),
  scale('gy', 'a1', UNIT.y, UNIT.uy),
  item('grow', 'path@1', 'b0', { fn: { y: 'x^2', over: [0, 'e'], vars: { e: 'data/end' }, scales: { x: 'gx', y: 'gy' } }, paint: stroke('ink', 2) }),
], { data: { end: { value: 0.25, source: 'story' } }, channels: { end: ramp('data/end', 0.25, 1, 1) } });

// ---------------------------------------------------------------------------------------------------
// AC7: y = x over [0, 1], its stroke colored by y through the ramp [a, b].

export const colorDoc = (): JsonObject => document('color-505', 'y equals x, colored by y', [480, 480], [
  scale('cx', 'a0', UNIT.x, UNIT.ux),
  scale('cy', 'a1', UNIT.y, UNIT.uy),
  item('line', 'path@1', 'b0', { fn: { y: 'x', over: [0, 1], scales: { x: 'cx', y: 'cy' } }, color: { by: 'y', ramp: ['a', 'b'], domain: [0, 1] }, paint: stroke('ink', 9) }),
]);
