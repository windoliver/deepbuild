// Criterion 3 (no upstream test): "The guide's dice game, which keys each roll by the seed init gets and the action's
// number, rolls the same values when its roll entry is stamped one step later on a fixed clock, while its planted twin
// that rolls from the step's seed rolls another value for that shift, naming the step; and the guide names rng.timing
// as the kit check that holds a game to this"
//
// The guide's `dice` example (README: The guide's examples) is read from deep_kinds and assembled. For eight document
// seeds it is baked twice on a fixed clock: throws stamped at steps 10 and 40, and the same with the first throw
// stamped one step later, at 11. Each throw shows the same face either way (`die` at step 10 against step 11, and at
// 40), and the eight seeds don't all give the first throw one face, so the rolls follow the seed init gets. The
// guide's text has a sentence naming rng.timing as a kit's check. Served by `deep-show run --planted
// guide_dice_rolls_from_step_seed`, the guide's dice program rolls from the step's seed: the shifted throw shows
// another face for some seed, and the judgement fails naming step 11. Eight seeds make a twin that happens to land on
// the same face every time about one chance in 1.7 million.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, bakeCall, bakeOf, bins, entryAt, example, failsNaming, guideText, none, onMac, piece, prebuild, rateOf,
  type Bake, type Example, type ShowPlanted,
} from './helpers.ts';

prebuild(() => { bins(); });

const SEEDS = [546_031, 546_032, 546_033, 546_034, 546_035, 546_036, 546_037, 546_038];
const FIRST = 10;
const SHIFTED = 11;
const SECOND = 40;
const STEPS = 50;

const dieAt = (b: Bake, k: number): number => Number(b.steps.find((s) => s.step === k)?.arrays['dice.die']?.[0] ?? Number.NaN);

/** Throws on and one step off; what the criterion asks of them: each face the same, 1 to 6, and the seed's own. */
function diceProblems(dice: Example): string[] {
  const rate = rateOf(dice.params);
  const calls = SEEDS.flatMap((seed) => {
    const p = piece({ seed, class: 'figure', controls: ['roll'], items: { dice: { program: dice.program, params: dice.params } } });
    return [
      bakeCall(p, { steps: STEPS, track: [entryAt('roll', FIRST, rate), entryAt('roll', SECOND, rate)] }),
      bakeCall(p, { steps: STEPS, track: [entryAt('roll', SHIFTED, rate), entryAt('roll', SECOND, rate)] }),
    ];
  });
  const replies = onMac(calls);
  const out: string[] = [];
  const firsts: number[] = [];
  SEEDS.forEach((seed, i) => {
    const on = bakeOf(replies[2 * i]!, `the dice game's bake with seed ${seed}, throws at ${FIRST} and ${SECOND}`);
    const late = bakeOf(replies[2 * i + 1]!, `the dice game's bake with seed ${seed}, throws at ${SHIFTED} and ${SECOND}`);
    if (on.traps.length || late.traps.length) out.push(`seed ${seed}: the dice game traps: ${JSON.stringify([...on.traps, ...late.traps]).slice(0, 300)}`);
    const [a, b] = [dieAt(on, FIRST), dieAt(late, SHIFTED)];
    const [c, d] = [dieAt(on, SECOND), dieAt(late, SECOND)];
    for (const [v, k] of [[a, FIRST], [b, SHIFTED], [c, SECOND]] as const) {
      if (!(Number.isInteger(v) && v >= 1 && v <= 6)) out.push(`seed ${seed}: die at step ${k} is ${v}, not a face 1 to 6`);
    }
    if (a !== b) out.push(`seed ${seed}: the throw stamped at step ${SHIFTED} rolled ${b}; stamped at step ${FIRST} it rolled ${a}`);
    if (c !== d) out.push(`seed ${seed}: the second throw, at step ${SECOND}, rolled ${d} after the shift and ${c} without it`);
    firsts.push(a);
  });
  if (new Set(firsts).size === 1) out.push(`the first throw rolled ${firsts[0]} for all eight seeds: the rolls don't follow the seed init gets`);
  return out;
}

describe(`${AC[3]} the guide's dice game rolls by the action, not the step`, () => {
  it(`${AC[3]} the dice game rolls the same faces with its throw stamped one step later, and the guide names rng.timing as the kit's check`, () => {
    const text = guideText();
    none(diceProblems(example(text, 'dice')), 'the guide\'s dice game keeps its rolls when a throw lands a step later');
    const sentences = text.split(/(?<=[.!?])\s+|\n\s*\n/);
    expect(sentences.some((s) => s.includes('rng.timing') && /\bkit\b/.test(s)), 'a sentence of the guide names rng.timing as a kit\'s check').toBe(true);
  }, TIMEOUT);

  it(`${AC[3]} guide_dice_rolls_from_step_seed's dice game rolls another face for the shift, naming the step`, () => {
    const planted: ShowPlanted = 'guide_dice_rolls_from_step_seed';
    failsNaming(diceProblems(example(guideText(planted), 'dice')), [`step ${SHIFTED}`], planted);
  }, TIMEOUT);
});
