// #1399.09928950: "A planted cache that analyzes once and serves 25 frames fails its per-frame check, naming the
// counter"
//
// The per-frame check is the core's flicker check (`film.flicker`, #407), which reads each frame's relative luminance
// from its own raster. It runs on a claim's deliverable through `verdict`: here a 640 × 360 u film at 25 frames a
// second, 1 s long, of one still grey rect, so each rendition the check plays (as made, and under reduced motion) is 25
// frames, and nothing in it flashes. The check pairs its frames with a counter of real evaluations, `analyzed`: the
// frames whose luminance was computed from their own raster. Its row lists, per deliverable and rendition, `counters:
// {doc, rendition, frames, analyzed}` (README: The surface under test). One test:
//   - the control, the right program: the row reads PASS, and each counters row of the film holds frames 25 and
//     analyzed 25;
//   - the planted cache (`planted: "flicker_analyzes_once"`), which analyzes each rendition's first frame once and
//     serves that analysis to all 25 frames: the row reads FAIL, an error on it names the counter `analyzed` as data,
//     and each counters row holds frames 25 and analyzed 1, the counts from the run.
// At the base the flicker row carries no counters, and `flicker_analyzes_once` is no planted name.

import { describe, expect, it } from 'vitest';

import { FILM_DOC, FRAMES, isObject, type JsonObject, names, rowOf, runShow, show, sub, useBinary, useTemp, verdictScenario } from './helpers.ts';

const AC = '#1399.09928950';
const bin = useBinary('deep-show');
const temp = useTemp();

const FLICKER: JsonObject = { kind: 'film.flicker' };

/** The row's counters for the film: one per rendition the check played, each `{doc, rendition?, frames, analyzed}`. */
function countersOf(row: JsonObject): JsonObject[] {
  const list = Array.isArray(row['counters']) ? row['counters'].filter(isObject) : [];
  return list.filter((c) => c['doc'] === FILM_DOC);
}

describe(`${AC} a per-frame check pairs with a counter of real evaluations`, () => {
  it(`${AC} a planted cache that analyzes once and serves 25 frames fails its per-frame check, naming the counter`, () => {
    const [right] = runShow(bin(), verdictScenario(sub(temp(), 'right'), FLICKER));
    const control = rowOf(right!);
    expect(control['result'], `the still film passes the flicker check: ${show(control, 3000)}`).toBe('PASS');
    const counted = countersOf(control);
    expect(counted.length, `the flicker check's row counts its frames and its real evaluations for the film: ${show(control, 3000)}`).toBeGreaterThan(0);
    for (const c of counted) {
      expect(c['frames'], `the film's ${String(c['rendition'] ?? '')} rendition is 25 frames: ${show(c)}`).toBe(FRAMES);
      expect(c['analyzed'], `the right program analyzes each of the 25 frames from its own raster: ${show(c)}`).toBe(FRAMES);
    }

    const [cached] = runShow(bin(), verdictScenario(sub(temp(), 'planted'), FLICKER, 'flicker_analyzes_once'));
    const row = rowOf(cached!);
    expect(row['result'], `the planted cache serves one analysis to 25 frames, so its per-frame check fails: ${show(row, 3000)}`).toBe('FAIL');
    const issues = Array.isArray(row['issues']) ? row['issues'].filter(isObject) : [];
    expect(issues.some((i) => i['severity'] === 'error' && names(i, 'analyzed')), `an error on the row names the counter analyzed: ${show(issues, 3000)}`).toBe(true);
    const served = countersOf(row);
    expect(served.length, `the row lists the counts from the run: ${show(row, 3000)}`).toBeGreaterThan(0);
    for (const c of served) {
      expect(c['frames'], `25 frames: ${show(c)}`).toBe(FRAMES);
      expect(c['analyzed'], `the planted cache analyzed once: ${show(c)}`).toBe(1);
    }
  });
});
