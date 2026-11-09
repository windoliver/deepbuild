// #533.cbdc85ec: a test writer that appends one press of a control for player 2 and then one for player 1 on the
// same step, and in a second run the same presses in the other order, gives a program that writes the player of
// the first entry it reads the value 1 both times, with equal step hashes; a planted read region that orders
// entries by arrival, or leaves out the player, fails, naming the step.
//
// The test writer is `append` into an open session (README: Sessions), player 2's press a peer's (writer `peer`),
// as in a match; the planted twins are deep-logic's `read_region_orders_by_arrival` and `read_region_drops_player`.
import { describe, expect, it } from 'vitest';
import {
  AC, STEP_60, TIMEOUT, appendCall, layoutFor, logicBin, onLogic, openCall, piece, prebuild, rowOf, show, stepCall, stepped,
  type ControlEntry, type JsonObject, type LogicPlanted, type StepRecord,
} from './helpers.ts';
import { FIRST_WRITES, PRESS, firstPlayer, layoutProbe } from './programs.ts';

const ID = AC[2];
prebuild(() => { logicBin(); });

/** The step both presses are stamped at, and the last step run before they are appended. */
const AT = 3;
const LAST = 5;
const press = (player: number): ControlEntry => ({ t: AT * STEP_60, seq: 1, control: PRESS, value: 1, writer: player === 1 ? 'you' : 'peer', player });

function pieceOf(): JsonObject {
  const layout = layoutFor({ program: layoutProbe(), reads: [PRESS], writes: FIRST_WRITES }, { controls: [PRESS] });
  return piece({ seed: 533_02, controls: [PRESS], items: { first: { program: firstPlayer(layout), reads: [PRESS], writes: FIRST_WRITES } } });
}
/** One session: steps to AT − 1, the presses appended in `order`, then steps to LAST. */
function run(p: JsonObject, order: number[], planted?: LogicPlanted): { steps: StepRecord[]; track: JsonObject[] } {
  const calls = [openCall(p), stepCall('s1', AT - 1), ...order.map((pl) => appendCall('s1', press(pl))), stepCall('s1', LAST)];
  const rs = onLogic(calls, planted);
  expect(rs[0]!['ok'], `open admits the piece: ${show(rs[0])}`).toBe(true);
  rs.slice(2, 2 + order.length).forEach((r, i) => expect(r['ok'], `append of player ${order[i]}'s press: ${show(r)}`).toBe(true));
  const a = stepped(rs[1]!, `step to ${AT - 1}`);
  const b = stepped(rs[rs.length - 1]!, `step to ${LAST}`);
  return { steps: [...a.steps, ...b.steps], track: b.track };
}
/** The criterion's judgement of two runs; each failure names its step. */
function judge(x: StepRecord[], y: StepRecord[]): string[] {
  const out: string[] = [];
  for (const [name, steps] of [['2 then 1', x], ['1 then 2', y]] as const) {
    const s = steps.find((r) => r.step === AT);
    if (!s) { out.push(`step ${AT}: run ${name} has no record`); continue; }
    const n = s.arrays['first.n']?.[0]; const first = s.arrays['first.first']?.[0];
    if (n !== 2) out.push(`step ${AT}: run ${name} read ${String(n)} entries, not both presses`);
    if (first !== 1) out.push(`step ${AT}: run ${name} wrote first = ${String(first)}, not player 1`);
  }
  const ys = new Map(y.map((r) => [r.step, r.hashes['first'] ?? null]));
  for (const r of x) if ((r.hashes['first'] ?? null) !== ys.get(r.step)) out.push(`step ${r.step}: the two runs' step hashes differ`);
  return out;
}

describe(`${ID} every player's entries reach the read region in step, player and seq order, never by arrival`, () => {
  it(`${ID} player 2's press then player 1's, and the other order, both give first = 1 at step ${AT} with equal step hashes at every step`, () => {
    const p = pieceOf();
    const x = run(p, [2, 1]);
    const y = run(p, [1, 2]);
    expect(x.steps.map((s) => s.step), 'each run ran steps 0 to 5').toEqual([...Array(LAST + 1).keys()]);
    const failures = judge(x.steps, y.steps);
    expect(failures, `the program reads player 1's press first in both runs:\n  ${failures.join('\n  ')}`).toEqual([]);
    expect(x.steps.map(rowOf), 'the two runs agree at every step').toEqual(y.steps.map(rowOf));
    expect(x.steps.filter((s) => s.step !== AT).map((s) => s.arrays['first.n']?.[0]), 'no other step read a press').toEqual(Array(LAST).fill(0));
    expect(x.track.map((e) => [e['player'], e['writer'], e['t']]), 'the track holds both presses at their step, player 1 first').toEqual([[1, 'you', AT * STEP_60], [2, 'peer', AT * STEP_60]]);
    expect(y.track, 'both runs recorded the same track').toEqual(x.track);
  }, TIMEOUT);

  for (const twin of ['read_region_orders_by_arrival', 'read_region_drops_player'] as const) {
    it(`${ID} a planted read region that ${twin === 'read_region_orders_by_arrival' ? 'orders entries by arrival' : 'leaves out the player'} (${twin}) fails, naming step ${AT}`, () => {
      const p = pieceOf();
      const failures = judge(run(p, [2, 1], twin).steps, run(p, [1, 2], twin).steps);
      expect(failures.length, `the judgement fails the planted read region ${twin}`).toBeGreaterThan(0);
      expect(failures.some((f) => f.startsWith(`step ${AT}:`)), `the failure names step ${AT}: ${failures.join('; ')}`).toBe(true);
    }, TIMEOUT);
  }
});
