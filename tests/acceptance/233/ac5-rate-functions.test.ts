// AC5 #233.a6357ff6: "Each mapped rate function equals its published equation within 1e-12 at 1,001 points, in the
// quick lane with no outside library installed"
//
// The published equations are the upstream library's, re-expressed in reference.ts (no outside library). The mapping
// is the issue's (Fields: Rate functions). Every value judged comes from our binaries:
//   - Ease words (smooth, slow_into, rush_into, exponential_decay, rush_from, double_smooth, running_start): deep_kinds
//     answers the word from math@1 with its target, an `ease@1` entry with its params (README: An alias to an ease), and
//     that entry must be the issue's: sigmoid(10), out_circ, rush_in(10), exp_decay(0.1), rush_out, double_sigmoid,
//     running_start (params left out read as the entry's defaults). The answered target is then used as written, as a
//     key's interp `{ease: {name, params}}`, on a channel keyed 0 → 1 over 1 s, read by `deep-motion eval` at
//     i ms, i = 0 … 1000. Each value equals the upstream function at i ÷ 1000 within 1e-12. exponential_decay is held to
//     the upstream equation divided by 1 − e^(−10), the renormalisation the design states for exp_decay (README:
//     Readings).
//   - Pulse words (there_and_back, there_and_back_with_pause, wiggle): deep_kinds answers each, naming `pulse` (and
//     `pause`, `wiggle`); the pulse the issue maps it to, `{pulse: {at: 0 s, span: 1 s, amount: 1, shape}}` on a held 0,
//     reads the upstream function at 1,001 times within 1e-12.
//   - Key words (lingering, squish_rate_func, not_quite_there): deep_kinds answers each, naming keys; the keys the issue
//     maps them to (lingering: linear keys at 0 and 0.8 s, then hold; squish_rate_func(smooth, 0.2, 0.7): keys at 0.2 and
//     0.7 s on smooth's mapped ease; not_quite_there(smooth, 0.7): keys at 0 and 1 s on smooth's ease to the value 0.7)
//     read the upstream function at 1,001 times within 1e-12.
// Wrong programs: the base (no math@1, so every word is no_match); smooth mapped to sigmoid(5) or smoothstep;
// slow_into to in_circ; rush_into to rush_out; exponential_decay to exp_decay(0.2); a wiggle pulse at twice the
// upstream frequency; a pause share other than 1/3.
import { describe, expect, it } from 'vitest';
import { AC, FLICKS, TIMEOUT, channelValues, isObject, mentions, motionDoc, none, run, scenario, useBins, useFolders, word, type JsonObject, type JsonValue } from './helpers.ts';
import {
  doubleSmooth, exponentialDecay, lingering, notQuiteThere, runningStart, rushFrom, rushInto, slowInto, smooth, squishRateFunc, thereAndBack,
  thereAndBackWithPause, unitSamples, wiggle, type Rate,
} from './reference.ts';

const bin = useBins(['deep-show', 'deep-motion']);
const folder = useFolders();
const TOL = 1e-12;
const XS = unitSamples(1000);
const TIMES = XS.map((x) => Math.round(x * FLICKS));

/** The ease words: the entry and params the issue maps each to (null: the entry's own default), and the equation. */
const EASES: { word: string; name: string; params: number | null; f: Rate }[] = [
  { word: 'smooth', name: 'sigmoid', params: 10, f: smooth },
  { word: 'slow_into', name: 'out_circ', params: null, f: slowInto },
  { word: 'rush_into', name: 'rush_in', params: 10, f: rushInto },
  { word: 'exponential_decay', name: 'exp_decay', params: 0.1, f: (t) => exponentialDecay(t) / (1 - Math.exp(-10)) },
  { word: 'rush_from', name: 'rush_out', params: null, f: rushFrom },
  { word: 'double_smooth', name: 'double_sigmoid', params: null, f: doubleSmooth },
  { word: 'running_start', name: 'running_start', params: null, f: runningStart },
];
const DEFAULTS: Record<string, number> = { rush_out: 10, double_sigmoid: 10, running_start: -0.5 };
const PULSES: { word: string; shape: JsonValue; names: string[]; f: Rate }[] = [
  { word: 'there_and_back', shape: 'there_and_back', names: ['pulse'], f: thereAndBack },
  { word: 'there_and_back_with_pause', shape: 'pause', names: ['pulse', 'pause'], f: thereAndBackWithPause },
  { word: 'wiggle', shape: 'wiggle', names: ['pulse', 'wiggle'], f: wiggle },
];
const KEYWORDS = ['lingering', 'squish_rate_func', 'not_quite_there'];

/** The single number an ease's params are written as: a number, or an object of one number; null when none. */
function paramOf(p: JsonValue | undefined): number | null | 'bad' {
  if (p === undefined || p === null) return null;
  if (typeof p === 'number') return p;
  if (isObject(p)) { const v = Object.values(p); return v.length === 0 ? null : v.length === 1 && typeof v[0] === 'number' ? v[0] : 'bad'; }
  return 'bad';
}
const keyed = (keys: JsonObject): JsonObject => motionDoc({ keys });
function failuresOf(what: string, got: number[] | string, f: Rate): string[] {
  if (typeof got === 'string') return [`${what}: ${got}`];
  return XS.flatMap((x, i) => (Math.abs(got[i]! - f(x)) <= TOL ? [] : [`${what} at ${x}: ${got[i]}, the upstream equation ${f(x)}`])).slice(0, 5);
}

describe(`${AC[5]} each mapped rate function equals its published equation`, () => {
  it(`${AC[5]} every mapped rate function, through math@1's mapping and our evaluation, equals the upstream equation within 1e-12 at 1,001 points`, () => {
    const words = [...EASES.map((e) => e.word), ...PULSES.map((p) => p.word), ...KEYWORDS];
    const a = run(bin('deep-show'), scenario(folder(), words.map(word)));
    expect(a.ok, `deep-show run accepts the scenario: ${a.why}`).toBe(true);
    const answers = new Map(words.map((w, i) => [w, a.replies[i]!]));
    // An answer with a `code` (`no_match`, or a refusal) maps nothing.
    const unanswered = words.filter((w) => answers.get(w)!['code'] !== undefined);
    expect(unanswered, `deep_kinds answers every rate-function word from math@1: ${unanswered.map((w) => `${w} → ${JSON.stringify(answers.get(w))}`).join('; ')}`).toEqual([]);

    const failures: string[] = [];
    const motion = bin('deep-motion');
    let smoothInterp: JsonValue = null;
    for (const e of EASES) {
      const target = answers.get(e.word)!['target'];
      const ease = isObject(target) && isObject(target['ease']) ? target['ease'] : null;
      if (!ease) { failures.push(`${e.word}: the target ${JSON.stringify(target)} is no ease@1 entry {ease: {name, params}}`); continue; }
      const p = paramOf(ease['params']);
      const want = e.params ?? DEFAULTS[e.name] ?? null;
      if (ease['name'] !== e.name || p === 'bad' || (p ?? DEFAULTS[e.name] ?? null) !== want) {
        failures.push(`${e.word}: mapped to ${JSON.stringify(ease)}, not the issue's ${e.name}${e.params === null ? '' : `(${e.params})`}`);
        continue;
      }
      if (e.word === 'smooth') smoothInterp = { ease };
      const got = channelValues(motion, keyed({ k0: { t: '0s', value: 0, interp: { ease } }, k1: { t: '1s', value: 1 } }), TIMES, 'c');
      failures.push(...failuresOf(`${e.word} (${JSON.stringify(ease)})`, got, e.f));
    }
    for (const p of PULSES) {
      const answer = answers.get(p.word)!;
      for (const n of p.names) if (!mentions(answer, n)) failures.push(`${p.word}: deep_kinds' answer doesn't name ${n}: ${JSON.stringify(answer)}`);
      const doc = motionDoc({ keys: { k0: { t: '0s', value: 0, interp: 'hold' } }, modifiers: [{ pulse: { at: '0s', span: '1s', amount: 1, shape: p.shape } }] });
      failures.push(...failuresOf(`${p.word} (pulse ${JSON.stringify(p.shape)})`, channelValues(motion, doc, TIMES, 'c'), p.f));
    }
    for (const w of KEYWORDS) if (!/key/i.test(JSON.stringify(answers.get(w)))) failures.push(`${w}: deep_kinds' answer doesn't name its keys: ${JSON.stringify(answers.get(w))}`);
    failures.push(...failuresOf('lingering (keys at 0 and 0.8 s)', channelValues(motion, keyed({ k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '0.8s', value: 1, interp: 'hold' } }), TIMES, 'c'), lingering));
    if (smoothInterp === null) failures.push('squish_rate_func and not_quite_there: no mapped ease for smooth to run them on');
    else {
      failures.push(...failuresOf('squish_rate_func(smooth, 0.2, 0.7) (keys at 0.2 and 0.7 s)', channelValues(motion, keyed({ k0: { t: '0.2s', value: 0, interp: smoothInterp }, k1: { t: '0.7s', value: 1, interp: 'hold' } }), TIMES, 'c'), squishRateFunc(smooth, 0.2, 0.7)));
      failures.push(...failuresOf('not_quite_there(smooth, 0.7) (key value 0.7)', channelValues(motion, keyed({ k0: { t: '0s', value: 0, interp: smoothInterp }, k1: { t: '1s', value: 0.7, interp: 'hold' } }), TIMES, 'c'), notQuiteThere(smooth, 0.7)));
    }
    none(failures, 'each mapped rate function against its published equation');
  }, TIMEOUT);
});
