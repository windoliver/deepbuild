// AC6 #492.853d06ee: With the look's quantize at 12 Hz and a placement quantized to 8 fps, a channel at t = 0.2 s samples
// its clip at 0.125 s, since the look steps the document's time to 1/6 s before the placement steps it to 1/8 s; and a remap
// that doubles time on a placement repeating a 1 s clip three times reads the clip at 0.2 s when the placement's local time
// is 0.6 s, since the remap maps 0.6 s to 1.2 s before the repeat wraps it.
//
// Through `deep-motion eval`, its `look` line carrying `time.quantize_hz` (#417's `look`, Look `look@1`: `time`). The clip's
// x reads its own time, so an item's x is the time it was sampled at. Each time the criterion names is read with others
// that tell the wrong orders apart: at 0.13 s the look's step leaves 1/12 s, which the placement floors to 0, where a program
// that drops the look reads 0.125 s; and at 0.2 s, a program that steps the placement first reads 1/12 s. Upstream port
// (oracle page): Unreal's MovieSceneTransformTests "a sub-sequence at 3 playing at ×2 in a 0 to 30 loop", through a remap.
import { describe, expect, it } from 'vitest';
import { AC, FLICKS, TIMEOUT, evalOk, clipOf, film, fl, none, place, posOr, rect, secs, useMotion, type JsonObject } from './helpers.ts';

const motion = useMotion();

const CLOCK = clipOf('x', 'at/pos/0', [[0, 0], [2, 2]]);
const QUANTIZED = film('nested-quantize', [rect('dot', [0, 0])], { clips: { clock: CLOCK }, placements: { p: place('clock', 'dot', { start: '0s', quantize: '8/1' }) } }, { span: '2s' });
const LOOK: JsonObject = { time: { quantize_hz: 12 } };
/** The document's time stepped by the look, then by the placement. */
const nested = (s: number): number => Math.floor(Math.floor(s * 12 + 1e-9) / 12 * 8 + 1e-9) / 8;

const SECOND = clipOf('x', 'at/pos/0', [[0, 0], [1, 1]]);
const double = (seconds: number): JsonObject => ({ keys: { a: { t: '0s', value: 0, interp: 'linear' }, b: { t: `${seconds}s`, value: 2 * seconds * FLICKS, interp: 'linear' } } });

describe(`${AC[6]} the nesting order: the look, then the placement; the remap, then the repeat`, () => {
  it(`${AC[6]} with the look at 12 Hz and a placement at 8 fps, a channel at 0.2 s samples its clip at 0.125 s, the look stepping first`, () => {
    const times = [0.04, 0.13, 0.2, 0.26, 0.45, 1.01, 1.7].map(fl);
    const a = evalOk(motion.bin(), { doc: QUANTIZED, times, look: LOOK }, 'the quantized placement under the look');
    const failures = a.frames.flatMap((f) => {
      const want = nested(secs(f.t)); const got = posOr(f, 'dot', 0);
      return Math.abs(got - want) <= 1e-9 ? [] : [`at ${f.t} flicks the clip is sampled at ${got} s, not ${want} s`];
    });
    none(failures, 'look then placement');
    expect(nested(0.2), 'fixture: the issue\'s number').toBe(0.125);
    expect(nested(0.13), 'fixture: the look\'s step leaves 1/12 s, which floors to 0, not the 1/8 s a dropped look gives').toBe(0);
  }, TIMEOUT);

  it(`${AC[6]} a remap that doubles time on a placement repeating a 1 s clip three times reads the clip at 0.2 s at local time 0.6 s, the remap before the wrap`, () => {
    const doc = film('remap-then-repeat', [rect('dot', [0, 0])], {
      clips: { second: SECOND }, placements: { p: place('second', 'dot', { start: '0s', repeat: { count: 3, mode: 'wrap' } }) }, time_remaps: { r: { target: 'p', map: double(3) } },
    }, { span: '3s' });
    const cases: [number, number][] = [[0.3, 0.6], [0.6, 0.2], [0.9, 0.8], [1.2, 0.4]];
    const a = evalOk(motion.bin(), { doc, times: cases.map(([t]) => fl(t)) }, 'the remap under the repeat');
    const failures = a.frames.flatMap((f, i) => {
      const want = cases[i]![1]; const got = posOr(f, 'dot', 0);
      return Math.abs(got - want) <= 1e-9 ? [] : [`at local time ${cases[i]![0]} s the clip is read at ${got} s, not ${want} s`];
    });
    none(failures, 'remap then repeat');
  }, TIMEOUT);

  it(`${AC[6]} Unreal's sub-sequence at 3, at ×2 by a remap in a 0 to 30 loop, maps frame 21 to 6, scaling before the wrap`, () => {
    const doc = film('unreal-remap', [rect('dot', [0, 0])], {
      clips: { loop: clipOf('x', 'at/pos/0', [[0, 0], [1, 30]]) },
      placements: { p: place('loop', 'dot', { start: '3f', repeat: { count: 3, mode: 'wrap' } }) }, time_remaps: { r: { target: 'p', map: double(3) } },
    }, { span: '10s', frame_rate: '30/1' });
    const frame = (k: number): number => (k * FLICKS) / 30;
    const a = evalOk(motion.bin(), { doc, times: [frame(13), frame(21)] }, 'the sub-sequence through a remap');
    expect(Math.abs(posOr(a.frames[0]!, 'dot', 0) - 20), `frame 13 maps to 20, got ${posOr(a.frames[0]!, 'dot', 0)}`).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(posOr(a.frames[1]!, 'dot', 0) - 6), `frame 21 maps to 6, got ${posOr(a.frames[1]!, 'dot', 0)}`).toBeLessThanOrEqual(1e-9);
  }, TIMEOUT);
});
