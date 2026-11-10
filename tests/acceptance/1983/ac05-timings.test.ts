// Criterion 5 (no upstream test): "A step time, frame time or budget reading taken in the lane is refused as a timing or
// a budget, naming the lane and `emulated: true`; a planted reader that counts a lane reading toward logic.budget fails,
// naming the reading"
//
// A lane record for this tree and tally's golden, planted where the lane writes one, holds three readings taken in the
// lane (README: Readings): a step time and a frame time of 10 s each, and a logic.budget verdict of FAIL. `deep-logic
// budget` (logic.budget, on [app]) with the tree must refuse each, as a timing or a budget, naming the lane and
// `emulated: true`, and give the verdict and failures it gives with no tree, from this Mac's bake alone. The planted
// reader `budget_counts_lane_reading` counts them, and this criterion's judgement of its reply fails, naming them.
import { hostname } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  AC, HOST_ARCH, LANE, LANE_ARCH, NETWORK, RECORDING, TIMEOUT, arr, budgetCall, logicBin, macGolden, obj, onMac, onReferenceMac, pin,
  plantRecord, prebuild, sandbox, show, str, tallyPiece, treeOf, type Box, type JsonObject, type LogicPlanted,
} from './helpers.ts';

prebuild(() => { logicBin(); });

const TEN_SECONDS_NS = 10_000_000_000;
const READINGS = [
  { reading: { name: 'step_time', ns: TEN_SECONDS_NS }, as: 'timing' },
  { reading: { name: 'frame_time', ns: TEN_SECONDS_NS }, as: 'timing' },
  { reading: { name: 'budget', verdict: 'FAIL' }, as: 'budget' },
] as const;

interface Setup { box: Box; piece: JsonObject; tree: string }
/** tally's piece and a lane record for this tree and its golden, holding the three readings. */
function setup(seed: number): Setup {
  const p = pin();
  const box = sandbox();
  const tree = treeOf(box);
  const piece = tallyPiece(seed);
  const golden = macGolden(piece);
  plantRecord(box, tree, {
    lane: LANE, state: 'PASS', host: hostname(), platform: `${process.platform}-${process.arch}`, tree, tests: [],
    recording_machine: RECORDING, lane_arch: LANE_ARCH, host_arch: HOST_ARCH, emulated: true, image_digest: p.digest, network: NETWORK,
    bake_key: golden['bake_key'] ?? null, report: null, ask: null, readings: READINGS.map((r) => ({ ...r.reading })),
  });
  return { box, piece, tree };
}

/** logic.budget with the tree beside logic.budget with none, in one deep-logic process. */
function budgets(s: Setup, planted?: LogicPlanted): { withLane: JsonObject; alone: JsonObject } {
  const [withLane, alone] = onMac([budgetCall(s.piece, s.tree), budgetCall(s.piece)], { box: s.box, ...(planted ? { planted } : {}) });
  for (const [r, what] of [[withLane!, 'logic.budget with the lane\'s record'], [alone!, 'logic.budget alone']] as const) {
    expect(r['ok'], `${what} ran: ${show(r)}`).toBe(true);
    expect(r['kind'], `${what} is logic.budget`).toBe('logic.budget');
  }
  return { withLane: withLane!, alone: alone! };
}

/** The criterion over a reply: each problem names the reading it is about. */
function judge({ withLane, alone }: { withLane: JsonObject; alone: JsonObject }): string[] {
  const problems: string[] = [];
  const refusals = arr(withLane['refusals'] ?? [], 'logic.budget\'s refusals').map((r, i) => obj(r, `refusals[${i}]`));
  for (const { reading, as } of READINGS) {
    const r = refusals.find((x) => x['reading'] === reading.name);
    if (!r) problems.push(`the lane's reading ${reading.name} isn't refused: ${show(refusals)}`);
    else if (r['as'] !== as || r['lane'] !== LANE || r['emulated'] !== true) problems.push(`the lane's reading ${reading.name} is refused as ${show(r['as'])}, naming lane ${show(r['lane'])} and emulated ${show(r['emulated'])}, not as a ${as} naming ${LANE} and emulated: true`);
  }
  const verdict = str(withLane['verdict'], 'logic.budget\'s verdict');
  if (verdict !== alone['verdict'] || show(withLane['failures']) !== show(alone['failures'])) {
    problems.push(`logic.budget counted the lane's readings ${READINGS.map((r) => r.reading.name).join(', ')}: ${verdict} ${show(withLane['failures'])}, where this Mac's bake alone gives ${show(alone['verdict'])} ${show(alone['failures'])}`);
  }
  return problems;
}

describe(`${AC[5]} a timing or a budget taken in the lane never counts`, () => {
  it(`${AC[5]} logic.budget refuses the lane's step time, frame time and budget reading, as a timing or a budget, naming the lane and emulated: true`, () => {
    onReferenceMac();
    const result = budgets(setup(1983_05));
    expect(judge(result), 'logic.budget refuses every lane reading and counts none').toEqual([]);
  }, TIMEOUT);

  it(`${AC[5]} a planted reader that counts a lane reading toward logic.budget (budget_counts_lane_reading) fails, naming the reading`, () => {
    onReferenceMac();
    const problems = judge(budgets(setup(1983_15), 'budget_counts_lane_reading'));
    expect(problems.length, 'the criterion fails on the planted reader').toBeGreaterThan(0);
    for (const { reading } of READINGS) expect(problems.join('\n'), `the failure names the reading ${reading.name}`).toContain(reading.name);
  }, TIMEOUT);
});
