// AC4 #161.f2821130: Every operator's measured cost is within 25% of its declaration on the reference Mac, and a group
// naming five of them stays within the figure class's operator budget or is refused naming the top three.
//
// The criterion's two halves that read no clock, which run anywhere the GPU layer draws; `ac4-measured.test.ts` holds
// the measured half, on a reference Mac.
//   1. Every one of the 70 declares its cost, `cost: {ns_per_px}` (1 ns a pixel is 1 ms a megapixel, the issue's
//      unit), finite and above 0.
//   2. A figure-class document whose one group names five operators in its `passes`, shown as a `live` session
//      (#379's call, which runs the document check before a session shows). The figure class's operator budget is
//      1 ms (design: Operator budgets by class); a pass costs its declared cost × the group's pixels (Frame and
//      group: passes), so the sum is arithmetic from the pack's own declarations. The five are the pack's costliest,
//      taken so that the third costs more than the fourth. Over a 32 × 32 px group they sum to under a tenth of the
//      budget: the session is `live` and draws. Over a group that fills the smallest of 1920 × 1080, 2560 × 1440 and
//      3840 × 2160 where they sum to twice the budget or more, the session is `refused` with an `over_budget` error
//      whose `ids` are the three costliest operators' IDs, the costliest first, and nothing else.
//
// Wrong programs: the base (17 operators; its document check sums no pass's cost, so the large group is kept); a
// refusal that names the group, or all five.
import { describe, expect, it } from 'vitest';
import {
  AC, ALL, TIMEOUT, buildLine, declared, document, group, inconclusive, isObject, listProblems, liveCall, liveFrames, look1, packOperators, payload, rect, refusal, requireGpu, runGpu,
  sessionRow, shown, useBin, useDir, writeJson, type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = AC[4];
const gpu = useBin('deep-gpu');
const dir = useDir();
/** The figure class's operator GPU time (design: Operator budgets by class), in ns. */
const BUDGET_NS = 1e6;
const LOOK = look1('cost-161', { panel: [214, 218, 224], accent: [26, 163, 200] });
const SMALL = { size: [256, 144] as const, box: [16, 16, 32, 32] as const };
const LADDER: readonly (readonly [number, number])[] = [[1920, 1080], [2560, 1440], [3840, 2160]];

/** The five costliest by declaration, the third strictly costlier than the fourth, costliest first. */
function fiveOf(operators: Record<string, JsonObject>): string[] {
  const byCost = ALL.filter((id) => Number.isFinite(declared(operators[id]))).sort((a, b) => declared(operators[b]) - declared(operators[a]) || a.localeCompare(b));
  const top = byCost.slice(0, 3);
  const rest = byCost.slice(3).filter((id) => declared(operators[id]) < declared(operators[top[2]!])).slice(0, 2);
  return [...top, ...rest];
}
const fiveDoc = (id: string, size: readonly [number, number], box: readonly [number, number, number, number], ops: string[]): JsonObject =>
  document(id, size, [group('five', 'a1', ops.map((op): JsonValue => ({ op, params: {} }))), rect('card', 'a2', box, 'accent', 1, { parent: 'five' })]);

describe(`${ID} each operator's declared cost, and a group of five against the figure class's operator budget`, () => {
  it(`${ID} every one of the 70 operators declares its cost in ns a pixel`, () => {
    const operators = packOperators();
    expect(listProblems(operators), 'packs/fx-1.0.0 holds the issue\'s 69 operators and fx.slice_shift@1, each by its ID').toEqual([]);
    expect(ALL.filter((id) => !(declared(operators[id]) > 0 && Number.isFinite(declared(operators[id])))), 'operators with no cost.ns_per_px above 0').toEqual([]);
  }, TIMEOUT);

  it(`${ID} a figure's group naming the five costliest operators is kept over 32 × 32 px, and over a group that costs twice the 1 ms budget is refused with over_budget naming the three costliest`, () => {
    const operators = packOperators();
    expect(listProblems(operators), 'packs/fx-1.0.0 holds the issue\'s 69 operators and fx.slice_shift@1, each by its ID').toEqual([]);
    const five = fiveOf(operators);
    expect(five.length, `five operators whose third costs more than the fourth: ${five.join(', ')}`).toBe(5);
    const sum = five.reduce((s, id) => s + declared(operators[id]), 0);
    const small = sum * SMALL.box[2] * SMALL.box[3];
    expect(small, `the five over 32 × 32 px cost ${small.toFixed(0)} ns by their declarations, under a tenth of the budget`).toBeLessThan(BUDGET_NS / 10);
    const large = LADDER.find(([w, h]) => sum * w * h >= 2 * BUDGET_NS);
    if (!large) inconclusive(`the five costliest operators declare ${sum.toFixed(4)} ns a pixel together: under twice the 1 ms budget even over 3840 × 2160 px, so no frame this suite draws shows the refusal`);
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');

    const out = dir();
    const kept = writeJson(out, 'kept.json', payload(fiveDoc('five-kept', SMALL.size, SMALL.box, five)));
    const over = writeJson(out, 'over.json', payload(fiveDoc('five-over', large, [0, 0, large[0], large[1]], five)));
    const ran = runGpu(gpu().bin, out, [liveCall(LOOK, [{ session: 'kept', doc: kept, size: [...SMALL.size] }], { frames: 3 }), liveCall(LOOK, [{ session: 'over', doc: over, size: [...large] }], { frames: 2 })]);
    expect(ran.problem, 'deep-gpu runs the two live calls').toBe('');
    expect([refusal(ran.replies[0], 'the small figure'), refusal(ran.replies[1], 'the large figure')], 'both live calls answer').toEqual(['', '']);

    const keptRow = sessionRow(ran.replies[0], 'kept');
    expect(keptRow?.['state'], `the five over 32 × 32 px stay within the budget, so the session is live: ${shown(keptRow, 600)}`).toBe('live');
    expect(liveFrames(ran.replies[0], 'kept').some((f) => f.view?.['drawn'] === true), 'and it draws').toBe(true);

    const overRow = sessionRow(ran.replies[1], 'over');
    console.log(`${ID}: ${five.join(', ')} over ${large[0]} × ${large[1]} px cost ${((sum * large[0] * large[1]) / 1e6).toFixed(2)} ms by their declarations`);
    expect(overRow?.['state'], `the five over ${large[0]} × ${large[1]} px cost twice the 1 ms budget or more, so the session is refused: ${shown(overRow, 600)}`).toBe('refused');
    const issue = (Array.isArray(overRow?.['issues']) ? overRow['issues'] : []).filter(isObject).find((i) => i['code'] === 'over_budget');
    expect(issue, `the refusal is over_budget: ${shown(overRow?.['issues'], 600)}`).toBeDefined();
    expect(issue!['ids'], 'over_budget names the three costliest operators, the costliest first, and nothing else').toEqual(five.slice(0, 3));
  }, TIMEOUT);
});
