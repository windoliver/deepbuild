// Criterion 2 (no upstream test): "A quiz whose logic shuffles five questions with its step seed shows the same
// order when played, seeked and replayed by its tour; a document with another seed shows another order; and the
// seed of step k is hash(document seed, logic ID, k)"
//
// Through `deep-logic bake` (README: deep-logic). The quiz (programs.ts `quiz`) shuffles [0, 1, 2, 3, 4] with the
// seed of the step that reads its first `start` entry, and every step writes the order and the seed it read.
// Played: an entry of yours at 2.0 s (step 120). Seeked: restores from the checkpoints at steps 60, 120 and 180,
// each run on to step 239. Replayed by its tour: no entry of yours, the piece's tour keying `start` at 0.6 s on its
// own clock, which starts idle_after = 1.4 s in (Tour), so at 2.0 s too. The design names the hash's inputs, not its
// function, so "the seed of step k is hash(document seed, logic ID, k)" is read as: a function of exactly those
// three (README: Readings).
import { describe, expect, it } from 'vitest';
import { AC, FLICKS, TIMEOUT, admitted, arrayAt, bakeCall, bakeOf, checkCall, logicBin, none, onMac, piece, prebuild, show, stepLength, yours, type Bake, type JsonObject, type Layout, type PieceSpec } from './helpers.ts';
import { probe, quiz, shuffleOf, tally } from './programs.ts';

prebuild(() => { logicBin(); });

const SEED = 531_02;
const START_STEP = 120;
const START_T = 2 * FLICKS;
const STEPS = 240;
const TOUR: JsonObject = { keys: { start: [[0.6, 1, 'hold']] }, idle_after: 1.4, resume_after: 3.6, loop: false };
const QUIZ_WRITES = { order: { type: 'i32' as const, count: 5 }, seed: { type: 'i32' as const, count: 2 } };

let layout: Layout | undefined;
/** The quiz item's layout, read once by `check` with a program built for no layout. */
function quizLayout(): Layout {
  if (layout) return layout;
  const [reply] = onMac([checkCall(piece({ seed: SEED, controls: ['start'], items: { quiz: { program: probe(), reads: ['start'], writes: QUIZ_WRITES } } }))]);
  layout = admitted(reply!, 'check of the quiz item')['quiz']!.layout;
  return layout;
}
function quizPiece(seed: number, opts: { id?: string; tour?: boolean; step_rate?: number; extra?: boolean } = {}): JsonObject {
  const items: PieceSpec['items'] = {};
  if (opts.extra) items['extra'] = { program: tally(), writes: { k: { type: 'i32' } } };
  items[opts.id ?? 'quiz'] = { program: quiz(quizLayout()), reads: ['start'], writes: QUIZ_WRITES, ...(opts.step_rate ? { step_rate: opts.step_rate } : {}) };
  return piece({ seed, controls: ['start'], items, ...(opts.tour ? { tour: TOUR } : {}) });
}
const played = (seed: number, steps = STEPS): JsonObject => bakeCall(quizPiece(seed), { steps, track: [yours('start', START_STEP, 1)] });

/** The seed a step read, from the quiz's `seed` array (two i32 words, low first). */
function seedAt(b: Bake, k: number, id: string, what: string): bigint {
  const [lo, hi] = arrayAt(b.steps, k, `${id}.seed`, what) as number[];
  return (BigInt(hi! >>> 0) << 32n) | BigInt(lo! >>> 0);
}
const orderAt = (b: Bake, k: number, id: string, what: string): number[] => arrayAt(b.steps, k, `${id}.order`, what) as number[];

describe(`${AC[2]} the quiz's order follows its step seed`, () => {
  it(`${AC[2]} played, seeked from three checkpoints and replayed by its tour, the quiz shows one order at every step; a document with another seed shows another`, () => {
    const playedCall = bakeCall(quizPiece(SEED), {
      steps: STEPS, track: [yours('start', START_STEP, 1)],
      restores: [60, 120, 180].map((from) => ({ from, steps: STEPS - from })),
    });
    const tourCall = bakeCall(quizPiece(SEED, { tour: true }), { steps: STEPS });
    const others = [SEED + 1, 7_777_777, 2_026_531];
    const [p, t, ...o] = onMac([playedCall, tourCall, ...others.map((s) => played(s))]).map((r, i) => bakeOf(r, `bake ${i}`));
    expect(START_T, 'the tour keys start at 1.4 s + 0.6 s, on step 120 at 60 Hz').toBe(START_STEP * stepLength(60));

    const shuffled = shuffleOf(seedAt(p!, START_STEP, 'quiz', 'played'));
    const failures: string[] = [];
    for (let k = 0; k < STEPS; k++) {
      const want = k < START_STEP ? [0, 1, 2, 3, 4] : shuffled;
      const got = orderAt(p!, k, 'quiz', 'played');
      if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`played, step ${k}: ${show(got)}, expected ${show(want)} (shuffled at step ${START_STEP} by its seed)`);
      const toured = orderAt(t!, k, 'quiz', 'replayed by its tour');
      if (JSON.stringify(toured) !== JSON.stringify(got)) failures.push(`replayed by its tour, step ${k}: ${show(toured)}, played ${show(got)}`);
    }
    for (const r of p!.restores) {
      for (let k = r.from; k < STEPS; k++) {
        const sought = orderAt({ ...p!, steps: r.steps }, k, 'quiz', `seeked from ${r.from}`);
        const got = orderAt(p!, k, 'quiz', 'played');
        if (JSON.stringify(sought) !== JSON.stringify(got)) failures.push(`seeked from checkpoint ${r.from}, step ${k}: ${show(sought)}, played ${show(got)}`);
      }
    }
    expect(p!.restores.map((r) => r.from), 'the bake answers each restore').toEqual([60, 120, 180]);
    none(failures, 'the order is the same played, seeked and replayed by its tour');
    const tourEntries = t!.track.filter((e) => e['control'] === 'start');
    expect(tourEntries.map((e) => [e['t'], e['writer'], e['value']]), 'the tour wrote the start entry the replay read').toEqual([[START_T, 'tour', 1]]);

    const otherOrders = o.map((b, i) => {
      const s = seedAt(b, START_STEP, 'quiz', `seed ${others[i]}`);
      const got = orderAt(b, STEPS - 1, 'quiz', `seed ${others[i]}`);
      expect(got, `with document seed ${others[i]} the quiz shuffles with its own step seed`).toEqual(shuffleOf(s));
      return JSON.stringify(got);
    });
    expect(otherOrders.some((x) => x !== JSON.stringify(shuffled)), `a document with another seed shows another order (seed ${SEED}: ${show(shuffled)}; others: ${otherOrders.join(', ')})`).toBe(true);
  }, TIMEOUT);

  it(`${AC[2]} the seed of step k is a function of the document seed, the logic ID and k alone: not of the step rate, the other items or the track`, () => {
    const N = 60;
    const calls = [
      played(SEED, N),
      bakeCall(quizPiece(SEED, { extra: true, step_rate: 30 }), { steps: N, track: [yours('start', 5, 1, 0, 30)] }),
      bakeCall(quizPiece(SEED, { id: 'quiz2' }), { steps: N }),
      bakeCall(quizPiece(SEED + 1), { steps: N }),
    ];
    const [a, same, otherId, otherSeed] = onMac(calls).map((r, i) => bakeOf(r, `bake ${i}`));
    const failures: string[] = [];
    const seen = new Set<string>();
    for (let k = 0; k < N; k++) {
      const s = seedAt(a!, k, 'quiz', 'document seed 531_02, quiz');
      seen.add(s.toString());
      const s2 = seedAt(same!, k, 'quiz', 'the same document seed and ID at 30 Hz, beside another item, with another track');
      if (s2 !== s) failures.push(`step ${k}: ${s2} at 30 Hz beside another item, ${s} at 60 Hz alone; the seed depends on the document seed, the ID and k only`);
      if (seedAt(otherId!, k, 'quiz2', 'logic ID quiz2') === s) failures.push(`step ${k}: logic ID quiz2 reads quiz's seed ${s}`);
      if (seedAt(otherSeed!, k, 'quiz', 'document seed 531_03') === s) failures.push(`step ${k}: document seed ${SEED + 1} reads seed ${SEED}'s ${s}`);
    }
    expect(seen.size, `each of steps 0 to ${N - 1} reads its own seed`).toBe(N);
    none(failures, 'the seed of step k is hash(document seed, logic ID, k)');
  }, TIMEOUT);
});
