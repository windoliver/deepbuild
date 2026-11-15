// AC4 #223.bd85dee7 (Oracle lane): a homotopy is a function of its progress. Ported from a fork of an upstream
// animation library, pinned at `cfd33af5aa`: tests/unit/animation/test_timeline.py, lines 256–291,
// TestEveryAnimation.test_it_is_a_function_of_its_progress, for its Homotopy and ComplexHomotopy entries (README:
// Sources). No upstream code is copied.
//
// The upstream test brings an animation to a progress b directly, and by way of a progress a first, and asserts both
// show the same leaves, for eight drawn pairs (a, b). Ours: two homotopies over 1 s, each a warp reading t through
// `vars: {u: "time"}`: the #223 suite's (x, y + 1.5·u·sin(2x − 6u)) on the line y = 0, and a complex one, `complex
// {f: "cmul(z, vec2(cos(u), sin(u)))"}`, the line turning about the plane's origin. For eight pairs of whole flicks
// in [0, 1 s) drawn by a seeded generator, `deep-canvas-render path` of the line at [a, b] in one line (by way of a)
// and at [b] in a fresh process (directly): the frames at b have the same sub-paths, number for number, and the same
// tessellation digest.
// The planted fault, in this file: a play that shows at b the frame it built at a (a stale frame); the port's
// comparison, given that frame, finds the difference for every pair whose times differ.
import { describe, expect, it } from 'vitest';
import {
  AC, PLANE, TIMEOUT, fl, figure, homotopyDoc, pathAll, pathItem, planeJson, random, useBins, warpGroup, type JsonObject, type PathFrame,
} from './helpers.ts';

const bin = useBins(['render']);
const COMPLEX = figure('warp-oracle-complex-homotopy', [800, 600], [
  warpGroup('g', { complex: { f: 'cmul(z, vec2(cos(u), sin(u)))' }, vars: { u: 'time' }, mix: 1, plane: planeJson(PLANE) }),
  pathItem('line', 'a1', 'M 100 300 L 700 300', 4, {}, { parent: 'g' }),
], { transport: { span: '1s' } });
const FIXTURES: [string, JsonObject][] = [['the homotopy', homotopyDoc('warp-oracle-homotopy')], ['the complex homotopy', COMPLEX]];
const next = random('#223 oracle progress pairs');
const PAIRS: [number, number][] = Array.from({ length: 8 }, () => [Math.floor(next() * fl(1)), Math.floor(next() * fl(1))]);

/** The port's comparison: the frame at b reached by way of a against the frame at b reached directly. */
function differs(via: PathFrame, direct: PathFrame, what: string): string[] {
  const out: string[] = [];
  if (JSON.stringify(via.subpaths) !== JSON.stringify(direct.subpaths)) out.push(`${what}: the sub-paths differ`);
  if (via.tessellation !== direct.tessellation) out.push(`${what}: the tessellation ${via.tessellation} is not ${direct.tessellation}`);
  return out;
}

describe(`${AC[4]} (Oracle) a homotopy is a function of its progress`, () => {
  it(`${AC[4]} test_it_is_a_function_of_its_progress: each homotopy brought to b by way of a shows what it shows at b directly; a stale frame fails the comparison`, () => {
    const failures: string[] = [];
    let caught = 0; let moved = 0;
    for (const [name, doc] of FIXTURES) {
      const via = pathAll(bin('render'), PAIRS.map(([a, b]) => ({ doc, item: 'line', times: [a, b] })), `${name}, by way of a`);
      PAIRS.forEach(([a, b], i) => {
        const direct = pathAll(bin('render'), [{ doc, item: 'line', times: [b] }], `${name}, directly at b`)[0]![0]!;
        failures.push(...differs(via[i]![1]!, direct, `${name}, pair ${i} (${a} then ${b} flicks)`));
        // The planted stale frame: what the play built at a, shown at b.
        if (a !== b && JSON.stringify(via[i]![0]!.subpaths) !== JSON.stringify(direct.subpaths)) moved += 1;
        if (a !== b && differs(via[i]![0]!, direct, 'the stale frame').length > 0) caught += 1;
      });
    }
    expect(failures, `by way of a, each homotopy shows at b what it shows directly:\n  ${failures.join('\n  ')}`).toEqual([]);
    expect(moved, 'the homotopies move between a and b, so the stale frame is a live fault').toBe(2 * PAIRS.length);
    expect(caught, 'the comparison catches the stale frame for every pair').toBe(2 * PAIRS.length);
  }, TIMEOUT);
});
