// AC1 #211.53478a94: "A logic item with pages {max 1,024, slots 64, moves 8, lead 4} that walks a seeded path for 3,600
// steps, writing hash(seed, page, step) into each page it visits, passes logic.determinism with seeks to 20 seeded
// times, three of them landing while a move is queued: deep hashes match the straight run's at every checkpoint and
// every continuation probe agrees; and a planted pager that restores without the move queue fails, naming the first
// step, the restored step plus 4, whose slot table differs"
//
// Through `deep-logic` (README): the walker (programs.ts) on a 32 × 32 torus of pages, steered by the control `steer`
// (logic.determinism's probes feed it), checkpoints every 60 steps. A straight bake gives `walk.asked`, from which the
// 20 seeded times are drawn: 3 at steps whose state holds a queued move, 17 at steps whose state holds none.
// logic.determinism (#532's runs: twice, a seek from every checkpoint before each sampled time, the probes) passes the
// real pager. The walker asks only at steps 8j + 3 (landing at 8j + 7), so a checkpoint c = 60m with m odd sits right
// after an asking step (c − 1, "the restored step": the last step whose state c holds); under
// `pager_restores_without_queue` a seek from such a checkpoint loses that move and the first slot table that differs
// is at (c − 1) + 4.

import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, arrayOf, bakeCall, bakeOf, detOf, determinismCall, pagesOf, piece, rng, show, timeOf, useBuilds, logic, type JsonObject } from './helpers.ts';
import { walkWrites, walker } from './programs.ts';

const ID = AC(1);
useBuilds(['logic']);

const STEPS = 3600;
const EVERY = 60;
const walkPiece = (): JsonObject => piece({
  seed: 211_01, controls: ['steer'],
  items: {
    walk: {
      program: walker({ name: 'walk', slots: 64, moves: 8, topology: { torus: [32, 32] }, start: 528, pathSeed: 211_011n, mode: 'visit' }),
      reads: ['steer'], writes: walkWrites(64), pages: pagesOf({ max: 1024, slots: 64, moves: 8, lead: 4 }),
      budget: { memory: 5 }, checkpoint: { every: EVERY, budget: 268_435_456 },
    },
  },
});
/** The straight run's `asked` at every step: the page the walker asked for after that step, or −1. */
function askedOf(): number[] {
  const [reply] = logic([bakeCall(walkPiece(), STEPS)]);
  return bakeOf(reply!, STEPS, 'the straight walk').steps.map((s) => arrayOf(s, 'walk.asked', 'the straight walk')[0]!);
}
/** Whether the state before step s holds a queued move: the walker asked at 8⌊s ÷ 8⌋ + 3 and s is past it. */
const queuedAt = (asked: number[], s: number): boolean => s % 8 >= 4 && asked[s - (s % 8) + 3]! >= 0;
/** 20 seeded steps in [8, 3,540): 3 landing while a move is queued, 17 while none is. */
function seededSteps(asked: number[]): number[] {
  const g = rng(211_011);
  const out: number[] = [];
  const draw = (want: boolean, n: number): void => {
    for (let left = n; left > 0;) {
      const s = 8 + Math.floor(g() * (3540 - 8));
      if (!out.includes(s) && queuedAt(asked, s) === want) { out.push(s); left--; }
    }
  };
  draw(true, 3);
  draw(false, 17);
  return out.sort((a, b) => a - b);
}

describe(`${ID} a paged walk seeks as it plays, with its move queue in every checkpoint`, () => {
  it(`${ID} the 3,600-step walk passes logic.determinism with seeks to 20 seeded times, three landing while a move is queued`, () => {
    const asked = askedOf();
    expect(asked.filter((a) => a >= 0).length, 'the walk asks for pages as it goes').toBeGreaterThan(0);
    const steps = seededSteps(asked);
    expect(steps.filter((s) => queuedAt(asked, s)).length, `three of the seeded times land while a move is queued: ${steps.join(', ')}`).toBe(3);
    const [reply] = logic([determinismCall(walkPiece(), STEPS, steps.map(timeOf))]);
    const det = detOf(reply!, 'logic.determinism of the walk');
    expect([det.verdict, det.failures], `logic.determinism passes: deep hashes match at every checkpoint and every probe agrees: ${show(det.raw)}`).toEqual(['PASS', []]);
  }, TIMEOUT);

  it(`${ID} (planted pager_restores_without_queue) fails, naming the first step whose slot table differs: the restored step plus 4`, () => {
    const asked = askedOf();
    const steps = seededSteps(asked);
    // The first checkpoint a seek restores that holds a queued move: c = 60m, m odd, right after the asking step c − 1.
    const c = Array.from({ length: STEPS / EVERY }, (_, m) => EVERY * m).find((x) => x > 0 && x % 8 === 4 && asked[x - 1]! >= 0 && steps.some((s) => s >= x));
    expect(c, 'a checkpoint right after a step that asked for a page, before a sampled time').toBeDefined();
    const [reply] = logic([determinismCall(walkPiece(), STEPS, steps.map(timeOf))], { planted: ['pager_restores_without_queue'] });
    const det = detOf(reply!, 'logic.determinism under pager_restores_without_queue');
    expect(det.verdict, `logic.determinism fails the pager that restores without the move queue: ${show(det.raw)}`).toBe('FAIL');
    const named = det.failures.filter((f) => f['run'] === 'seek' && f['from'] === c! && f['step'] === (c! - 1) + 4
      && (f['region'] === 'slot_table' || f['array'] === 'walk.slots'));
    expect(named.length, `a seek from checkpoint ${c} names step ${c! + 3} (the restored step ${c! - 1} plus 4) and the slot table: ${show(det.failures as unknown as JsonObject[], 3000)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});
