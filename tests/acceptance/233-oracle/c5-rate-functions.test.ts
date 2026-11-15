// Oracle lane, criterion 5 (AC5 #233.a6357ff6), port and formula: a fork of the upstream math-film library at
// cfd33af5aa, tests/unit/animation/test_easing.py:31-51 (every rate function starts at 0 and ends at 1, the
// there-and-back family at 0, exactly, and holds its ends outside [0, 1]) and :97-136 (squish_rate_func runs its
// function through its window and holds outside it, its default window the middle fifth, an empty window a step;
// not_quite_there goes `proportion` of the way, 0.7 unless told); and the reference project at a6d5cc02b4,
// utils/rate_functions.py (under its package folder), the equations (reference.ts).
//
// Run against our output, through the mapping the issue states: each ease word's target as deep_kinds answers it from
// math@1 (an ease@1 entry with its params, README: An alias to an ease), used as a key's interp on a channel keyed
// 0 → 1 over [1 s, 2 s] and read by `deep-motion eval`: exactly 0 at 1 s and at 0 s and 0.5 s before it, exactly 1 at
// 2 s and at 2.5 s and 3 s after it. The there-and-back family as the pulses the issue maps them to (amount 1 at 1 s
// over 1 s on a held 0): exactly 0 at 0, 0.5, 1, 2, 2.5 and 3 s. squish_rate_func(f, a, b) as keys at a and b: with
// smooth's mapped ease, at a + s(b − a) it reads smooth(s) within 1e-9 for s in 0, 0.1, … 1, and exactly 0 before a
// and 1 after b, for (a, b) = (0.2, 0.7), (0, 0.5) and (0.6, 1); with linear keys and the default window (0.4, 0.6) it
// reads 0, 0, 0.5, 1 at 0.3, 0.4, 0.5, 0.6 within 1e-12; an empty window (0.3, 0.3), two keys on one time, reads 0, 0, 1,
// 1 at 0, 0.29, 0.3, 0.8 s. not_quite_there(linear, p) as linear keys to the value p reads p·t within 1e-12 for p 0.7,
// 0.3 and 1. Times are in seconds over a 1 s span from 0 unless said.
// Not ported: monotonicity and continuity searches (property searches over upstream's functions; our eases' own are
// #490's); the Penner family checks (#490's).
import { describe, expect, it } from 'vitest';
import { AC, FLICKS, TIMEOUT, channelValues, isObject, motionDoc, none, run, scenario, useBins, useFolders, word, type JsonObject, type JsonValue } from './helpers.ts';
import { smooth } from './reference.ts';

const bin = useBins(['deep-show', 'deep-motion']);
const folder = useFolders();
const EASE_WORDS = ['smooth', 'slow_into', 'rush_into', 'exponential_decay', 'rush_from', 'double_smooth', 'running_start'];
const PULSES = ['there_and_back', 'pause', 'wiggle'];
const at = (s: number[]): number[] => s.map((x) => Math.round(x * FLICKS));
const exactly = (what: string, got: number[] | string, want: number[]): string[] =>
  typeof got === 'string' ? [`${what}: ${got}`] : got.flatMap((v, i) => (Object.is(v, want[i]) || v === want[i] ? [] : [`${what}: reads ${v} at the ${i + 1}th time, not exactly ${want[i]}`]));
const near = (what: string, got: number[] | string, want: number[], tol: number): string[] =>
  typeof got === 'string' ? [`${what}: ${got}`] : got.flatMap((v, i) => (Math.abs(v - want[i]!) <= tol ? [] : [`${what}: reads ${v} at the ${i + 1}th time, not ${want[i]}`]));

describe(`${AC[5]} (oracle, port) every mapped rate function's ends, squish_rate_func's window and not_quite_there's proportion`, () => {
  it(`${AC[5]} each ease word's mapped entry starts at exactly 0, ends at exactly 1 and holds both ends outside its span; each there-and-back pulse is exactly 0 at both ends and outside`, () => {
    const a = run(bin('deep-show'), scenario(folder(), EASE_WORDS.map(word)));
    expect(a.ok, `deep-show run accepts the scenario: ${a.why}`).toBe(true);
    const motion = bin('deep-motion');
    const failures: string[] = [];
    EASE_WORDS.forEach((w, i) => {
      const target = a.replies[i]!['target'];
      const ease = isObject(target) && isObject(target['ease']) ? target['ease'] : null;
      if (!ease) { failures.push(`${w}: deep_kinds answers no ease@1 entry: ${JSON.stringify(a.replies[i])}`); return; }
      const doc = motionDoc({ keys: { k0: { t: '1s', value: 0, interp: { ease } }, k1: { t: '2s', value: 1 } } });
      failures.push(...exactly(`${w} (${JSON.stringify(ease)})`, channelValues(motion, doc, at([0, 0.5, 1, 2, 2.5, 3]), 'c'), [0, 0, 0, 1, 1, 1]));
    });
    for (const shape of PULSES) {
      const doc = motionDoc({ keys: { k0: { t: '0s', value: 0, interp: 'hold' } }, modifiers: [{ pulse: { at: '1s', span: '1s', amount: 1, shape } }] });
      failures.push(...exactly(`the ${shape} pulse`, channelValues(motion, doc, at([0, 0.5, 1, 2, 2.5, 3]), 'c'), [0, 0, 0, 0, 0, 0]));
    }
    none(failures, 'the ends, exactly');
  }, TIMEOUT);

  it(`${AC[5]} squish_rate_func as keys at a and b runs its function through the window and holds outside it; not_quite_there as a key value goes p of the way`, () => {
    const a = run(bin('deep-show'), scenario(folder(), [word('smooth')]));
    expect(a.ok, `deep-show run accepts the scenario: ${a.why}`).toBe(true);
    const target = a.replies[0]!['target'];
    expect(isObject(target) && isObject(target['ease']), `smooth maps to an ease@1 entry: ${JSON.stringify(a.replies[0])}`).toBe(true);
    const ease = (target as JsonObject)['ease'] as JsonValue;
    const motion = bin('deep-motion');
    const failures: string[] = [];
    const keys = (k0: JsonObject, k1: JsonObject): JsonObject => motionDoc({ keys: { k0, k1 } });
    for (const [lo, hi] of [[0.2, 0.7], [0, 0.5], [0.6, 1]] as [number, number][]) {
      const doc = keys({ t: `${lo}s`, value: 0, interp: { ease } }, { t: `${hi}s`, value: 1, interp: 'hold' });
      const s = Array.from({ length: 11 }, (_, k) => k / 10);
      failures.push(...near(`squish_rate_func(smooth, ${lo}, ${hi}) inside`, channelValues(motion, doc, at(s.map((v) => lo + v * (hi - lo))), 'c'), s.map((v) => smooth(v)), 1e-9));
      const before = [0, lo / 2].filter((t) => t < lo); const after = [hi + (1 - hi) / 2, 1, 1.5].filter((t) => t > hi);
      failures.push(...exactly(`squish_rate_func(smooth, ${lo}, ${hi}) outside`, channelValues(motion, doc, at([...before, ...after]), 'c'), [...before.map(() => 0), ...after.map(() => 1)]));
    }
    const middle = keys({ t: '0.4s', value: 0, interp: 'linear' }, { t: '0.6s', value: 1, interp: 'hold' });
    failures.push(...near('squish_rate_func(linear) in its default window (0.4, 0.6)', channelValues(motion, middle, at([0.3, 0.4, 0.5, 0.6]), 'c'), [0, 0, 0.5, 1], 1e-12));
    const step = keys({ t: '0.3s', value: 0, interp: 'linear' }, { t: '0.3s', value: 1, interp: 'hold' });
    failures.push(...exactly('squish_rate_func(smooth, 0.3, 0.3), an empty window', channelValues(motion, step, at([0, 0.29, 0.3, 0.8]), 'c'), [0, 0, 1, 1]));
    for (const p of [0.7, 0.3, 1]) {
      const doc = keys({ t: '0s', value: 0, interp: 'linear' }, { t: '1s', value: p, interp: 'hold' });
      const ts = Array.from({ length: 21 }, (_, k) => k / 20);
      failures.push(...near(`not_quite_there(linear, ${p})`, channelValues(motion, doc, at(ts), 'c'), ts.map((t) => p * t), 1e-12));
    }
    none(failures, 'squish_rate_func and not_quite_there');
  }, TIMEOUT);
});
