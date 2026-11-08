// The expected amounts in fixtures/range-shapes.expected.json, computed from Lottie's range-selector formulas:
//
//   node tests/acceptance/496/lottie-reference.mjs            writes the sidecar
//   node tests/acceptance/496/lottie-reference.mjs --check    exits 1 if the sidecar on disk differs
//
// Ported from lottie-web (https://github.com/airbnb/lottie-web), commit bede03d25d232826e0c9dca1733d542d8a7754fb:
//   player/js/utils/text/TextSelectorProperty.js, lines 39-120 (getMult: the six shapes, `sh` 1..6, and the ease
//   from `xe` and `ne`) and lines 155-158 (getValue: start and end in units, `divisor = 100 / totalChars`);
//   player/js/3rd_party/BezierEaser.js (bezier-easing by Gaëtan Renaudeau), the ease the shapes go through.
// Both files carry this notice:
//
//   The MIT License (MIT)
//   Copyright (c) 2015 Bodymovin / Airbnb, Inc.; bezier-easing Copyright (c) 2014 Gaëtan Renaudeau
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
//   documentation files (the "Software"), to deal in the Software without restriction, including without limitation
//   the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
//   to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above
//   copyright notice and this permission notice shall be included in all copies or substantial portions of the
//   Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
//   LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
//   SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
//   OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
//   DEALINGS IN THE SOFTWARE.
//
// Our names map to Lottie's: shape square/ramp/ramp_down/triangle/round/smooth = sh 1..6; ease high = xe ÷ 100 and
// ease low = ne ÷ 100 ("Ease High" and "Ease Low", −1..1 here, −100..100 % there); start 20 % and end 70 % with
// basis fraction = s 20, e 70 with r 1 (percent), so over 10 units s = 2 and e = 7; amount (a) 100 %, smoothness
// (sm) 100 %, offset (o) 0, as the design's defaults (strength 1, no falloff, no offset).
//
// The ease is solved two ways and both are kept honest: exactly (bisection of x(t) in f64 to the last bit), which is
// what the sidecar lists, and as bezier-easing solves it (its 11-sample table and 4 Newton steps); the script refuses
// to write a sidecar where the two differ by 1e-9 or more, so the listed values are Lottie's within far less than
// the criterion's 1e-6.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIDECAR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'range-shapes.expected.json');

export const SHAPES = ['square', 'ramp', 'ramp_down', 'triangle', 'round', 'smooth'];
/** Ease high and low, each −1..1: none, both positive, both negative, and one of each sign (each of Lottie's branches). */
export const EASES = [{ high: 0, low: 0 }, { high: 0.6, low: 0.3 }, { high: -0.4, low: -0.7 }, { high: 0.5, low: -0.5 }];
export const UNITS = 10;
export const START = 0.2;
export const END = 0.7;

// bezier-easing's curve (BezierEaser.js: A, B, C, calcBezier, getSlope).
const A = (a1, a2) => 1.0 - 3.0 * a2 + 3.0 * a1;
const B = (a1, a2) => 3.0 * a2 - 6.0 * a1;
const C = (a1) => 3.0 * a1;
const calc = (t, a1, a2) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
const slope = (t, a1, a2) => 3.0 * A(a1, a2) * t * t + 2.0 * B(a1, a2) * t + C(a1);

/** The control points TextSelectorProperty.js (lines 43-56) builds from xe and ne, here from high and low. */
function controls(high, low) {
  let x1 = 0; let y1 = 0; let x2 = 1; let y2 = 1;
  const ne = low * 100; const xe = high * 100;
  if (ne > 0) x1 = ne / 100.0; else y1 = -ne / 100.0;
  if (xe > 0) x2 = 1.0 - xe / 100.0; else y2 = 1.0 + xe / 100.0;
  return [x1, y1, x2, y2];
}

/** The ease solved exactly: t with x(t) = x by bisection (x(t) is monotone for control x in [0, 1]), then y(t). */
function easeExact([x1, y1, x2, y2], x) {
  if (x1 === y1 && x2 === y2) return x;
  if (x === 0) return 0;
  if (x === 1) return 1;
  let lo = 0; let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    if (calc(mid, x1, x2) > x) hi = mid; else lo = mid;
  }
  return calc((lo + hi) / 2, y1, y2);
}

/** The ease as bezier-easing solves it (BezierEaser.js: get, _getTForX, newtonRaphsonIterate, binarySubdivide). */
function easeLottie([x1, y1, x2, y2], x) {
  if (x1 === y1 && x2 === y2) return x;
  if (x === 0) return 0;
  if (x === 1) return 1;
  const size = 11; const step = 1.0 / (size - 1.0);
  const samples = new Float32Array(size);
  for (let i = 0; i < size; ++i) samples[i] = calc(i * step, x1, x2);
  let start = 0.0; let current = 1; const last = size - 1;
  for (; current !== last && samples[current] <= x; ++current) start += step;
  --current;
  const dist = (x - samples[current]) / (samples[current + 1] - samples[current]);
  let t = start + dist * step;
  const initial = slope(t, x1, x2);
  if (initial >= 0.001) {
    for (let i = 0; i < 4; ++i) {
      const s = slope(t, x1, x2);
      if (s === 0.0) break;
      t -= (calc(t, x1, x2) - x) / s;
    }
  } else if (initial !== 0.0) {
    let a = start; let b = start + step; let cx; let i = 0;
    do {
      t = a + (b - a) / 2.0;
      cx = calc(t, x1, x2) - x;
      if (cx > 0.0) b = t; else a = t;
    } while (Math.abs(cx) > 0.0000001 && ++i < 10);
  }
  return calc(t, y1, y2);
}

/** TextSelectorProperty.js getMult (lines 59-120), before the ease, for unit `ind` with start s and end e in units. */
function shaped(shape, s, e, ind) {
  const { max, min, floor } = Math;
  switch (shape) {
    case 'ramp': return e === s ? (ind >= e ? 1 : 0) : max(0, min(0.5 / (e - s) + (ind - s) / (e - s), 1));
    case 'ramp_down': return e === s ? (ind >= e ? 0 : 1) : 1 - max(0, min(0.5 / (e - s) + (ind - s) / (e - s), 1));
    case 'triangle': {
      if (e === s) return 0;
      const m = max(0, min(0.5 / (e - s) + (ind - s) / (e - s), 1));
      return m < 0.5 ? m * 2 : 1 - 2 * (m - 0.5);
    }
    case 'round': {
      if (e === s) return 0;
      const tot = e - s;
      const i = min(max(0, ind + 0.5 - s), e - s);
      const x = -tot / 2 + i; const a = tot / 2;
      return Math.sqrt(1 - (x * x) / (a * a));
    }
    case 'smooth': {
      if (e === s) return 0;
      const i = min(max(0, ind + 0.5 - s), e - s);
      return (1 + Math.cos(Math.PI + Math.PI * 2 * i / (e - s))) / 2;
    }
    case 'square': {
      if (ind < floor(s)) return 0;
      return ind - s < 0 ? max(0, min(min(e, 1) - (s - ind), 1)) : max(0, min(e - ind, 1));
    }
    default: throw Error(`no shape ${shape}`);
  }
}

/** Every case: each shape with each ease, its amount at each of the 10 units. */
export function cases() {
  // getValue (lines 155-158): divisor = 100 / totalChars, s = s% / divisor, e = e% / divisor.
  const divisor = 100 / UNITS;
  const s = (START * 100) / divisor; const e = (END * 100) / divisor;
  const out = [];
  for (const shape of SHAPES) {
    for (const ease of EASES) {
      const c = controls(ease.high, ease.low);
      const amounts = [];
      for (let ind = 0; ind < UNITS; ind++) {
        const m = shaped(shape, s, e, ind);
        const exact = easeExact(c, m); const lottie = easeLottie(c, m);
        if (!(Math.abs(exact - lottie) < 1e-9)) throw Error(`${shape} ${JSON.stringify(ease)} unit ${ind}: exact ${exact}, bezier-easing ${lottie}`);
        amounts.push(exact);
      }
      out.push({ shape, ease, amounts });
    }
  }
  return out;
}

const sidecar = () => `${JSON.stringify({
  source: 'lottie-web bede03d25d232826e0c9dca1733d542d8a7754fb player/js/utils/text/TextSelectorProperty.js getMult and getValue; player/js/3rd_party/BezierEaser.js',
  generator: 'tests/acceptance/496/lottie-reference.mjs',
  text: 'ABCDEFGHIJ', units: UNITS, start: START, end: END, basis: 'fraction',
  cases: cases(),
}, null, 1)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const same = readFileSync(SIDECAR, 'utf8') === sidecar();
    console.log(same ? 'the sidecar matches the formulas' : 'the sidecar differs from the formulas');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(SIDECAR, sidecar());
  console.log(`wrote ${SIDECAR}`);
}
