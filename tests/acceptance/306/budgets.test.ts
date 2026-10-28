// AC8: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a document of
// 10,000 items, 1,000 of them derived from recipe instances, checks in under 50 ms, as a full cheap check
// does (Check input); a pack version's check runs once, never on open; and nothing runs per frame"
//
// asserts: in the full build, a board of 8,800 plain rects and 200 chart.bars@1 instances with n = 5
// (10,000 items once expanded, 1,000 of them derived) passes its `--check` with 200 expansions, and the
// check's own time (`timing.check_ms`, with `include: ["timing"]`) over five fresh processes after a
// warm-up is judged against 50 ms by the design's rule (PASS all within; FAIL all over by more than the
// margin; else INCONCLUSIVE, a skip) on a reference Mac on mains with Low Power Mode off and no thermal
// warning, and skips as INCONCLUSIVE anywhere else, never passing by skipping; and in one process the pack
// check of test/chart@1.0.0 has run once after three boards naming it opened and six frames of one of
// them were drawn (`packs[].checks` stays 1). The merge-base comparison the criterion names is the perf
// lane's, run at preflight against the merge base's numbers, not this test's (README: Readings).

import { describe, expect, it } from 'vitest';
import {
  CHART, CHECK_BUDGET_MS, DOC, FULL, PACKS, board, check, environmentProblem, expansions, fixture, instance, judge, num, obj, outcome, packAt, packRow, read, rect, run, scenario, show,
  useBuilds, useEvidence, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();
const problem = environmentProblem();

const PLAIN = 8_800;
const INSTANCES = 200;
const N = 5;

/** 8,800 rects and 200 instances of chart.bars@1 with n = 5: 10,000 items at its expanded size, 1,000 derived. */
function bigBoard(): JsonObject {
  const items: JsonObject[] = [];
  for (let i = 0; i < PLAIN; i++) items.push(rect(`r-${String(i).padStart(4, '0')}`, `Rect ${i}`, [(i % 40) * 16, Math.floor(i / 40) % 20 * 16, 12, 12], `a${String(i).padStart(5, '0')}`));
  for (let i = 0; i < INSTANCES; i++) items.push(instance(`c-${String(i).padStart(3, '0')}`, 'chart.bars@1', { n: N }, `b${String(i).padStart(5, '0')}`, [(i % 20) * 30, Math.floor(i / 20) * 30]));
  return board('Ten thousand items', [packAt(CHART)], items);
}

function timedCheck(bin: string, document: JsonObject): { ms: number; reply: JsonObject } {
  const [reply] = run(bin, scenario(evidence(), { [DOC.a]: 'main' }, [CHART], [check(document, { timing: true })]));
  expect(outcome(reply!), `the 10,000-item board is presented: ${JSON.stringify(reply!['issues']).slice(0, 600)}`).toBe('presented');
  expect(reply!['result'], 'and its check passes').toBe('PASS');
  expect(expansions(reply!).length, `the timed check expanded all ${INSTANCES} instances`).toBe(INSTANCES);
  expect(expansions(reply!).every((e) => Object.keys(e.derived).length === N), `each into ${N} derived items`).toBe(true);
  return { ms: num(obj(reply!['timing'], 'timing')['check_ms'], 'timing.check_ms'), reply: reply! };
}

describe('AC8 budgets on the reference Mac: a 10,000-item document with 1,000 derived items checks in under 50 ms; a pack checks once, never on open; nothing per frame', () => {
  it(`AC8 the full check of 10,000 items, 1,000 derived, takes under ${CHECK_BUDGET_MS} ms (five fresh processes after a warm-up)`, (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const bin = builds.bin(FULL);
    const document = bigBoard();
    const warm = timedCheck(bin, document);
    console.log(`warm-up check ${warm.ms.toFixed(2)} ms (discarded)`);
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) runs.push(timedCheck(bin, document).ms);
    judge(ctx, 'AC8 full check of 10,000 items with 1,000 derived (ms)', runs, CHECK_BUDGET_MS);
  }, 600_000);

  it('AC8 a pack version\'s check runs once, never on open: after three boards naming it open and six frames draw, test/chart@1.0.0 has been checked once', () => {
    const bars = board('Bars', [packAt(CHART)], [instance('c1', 'chart.bars@1', { n: 5 }, 'a0', [40, 40])]);
    const replies = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: 'main', [DOC.b]: 'main', [DOC.c]: { panel: 'main', document: fixture('chart-board.json') } }, [CHART], [
      PACKS,
      show(bars, { pixels: true }),
      show(bars, { pixels: true, doc: DOC.b }),
      read(DOC.c),
      ...['0s', '1s', '2s', '3s', '4s', '5s'].map((t) => show(bars, { pixels: true, t })),
      PACKS,
    ]));
    const before = packRow(replies[0]!, CHART);
    expect(before.state, 'the pack installed at startup').toBe('installed');
    expect(before.checks, 'its check ran once at install').toBe(1);
    for (const [i, reply] of replies.slice(1, -1).entries()) expect(outcome(reply) === 'presented' || typeof reply['document'] === 'object', `call ${i + 1} opens its board: ${JSON.stringify(reply).slice(0, 300)}`).toBe(true);
    const after = packRow(replies[replies.length - 1]!, CHART);
    expect(after.checks, 'the pack check ran once in all: never on open, never per frame').toBe(1);
  }, 600_000);
});
