// AC4 #210.2cf346a3: "A sensor fixture source with delivery each and max_per_step 16 sends 40 values between two 60 Hz
// steps; the logic reads all 40 over three steps in recorded order and their sum equals the fixture's 40 values' sum; a
// planted read region that keeps only the last value fails that sum, naming the reading; and 100 values in one step drop
// the 36 oldest, raise reading.overflow naming 36, and leave the other 64 read over four steps"
//
// deep-logic (README: deep-logic). The piece reads `reading:sensor`, a scalar source with `each` and `max_per_step` 16,
// through `gauge`, which writes each step's count and the values and as-of times it read. In one session the source
// delivers 40 values after step 1 (before step 2): steps 2, 3 and 4 read 16, 16 and 8 of them, in the order delivered,
// with their as-of times, and the values read sum to the 40's sum; no step raises an issue. Then 100 values after step 5:
// one `reading.overflow` naming the reading, step 6 and 36 dropped; steps 6 to 9 read the newest 64 (values 37 to 100) in
// order, 16 a step, and step 10 reads none. The planted `read_region_keeps_last` reads the 40 and fails the sum, naming
// the reading.
import { describe, expect, it } from 'vitest';
import {
  AC, GAUGE_WRITES, TIMEOUT, arr, deliver, gaugeProgram, int, issuesOf, layoutOf, logicBin, logicPiece, none, obj, onLogic, onLogicPlanted, openPiece,
  prebuild, show, stepTo, str, type JsonObject, type LogicPlanted, type Source,
} from './helpers.ts';

const ID = AC[4];
prebuild(() => { logicBin(); });

const READING = 'reading:sensor';
const SOURCES: Record<string, Source> = { sensor: { shape: 'scalar', delivery: 'each', max_per_step: 16 } };
/** The k-th value a burst sends (k from 0): eighths, so every sum is exact; as-of times 250 µs apart, each value
 * reaching the hub 100 µs after its as-of time. */
const burst = (n: number, from: number): { value: number; as_of: number; arrived: number }[] =>
  Array.from({ length: n }, (_, k) => ({ value: ((((k + from) * 37) % 101) - 50) / 8, as_of: 1_000_000 + (k + from) * 250, arrived: 1_000_100 + (k + from) * 250 }));
const FORTY = burst(40, 0);
const HUNDRED = burst(100, 1000);

interface Step { step: number; count: number; values: number[]; as_of: number[] }
/** What `gauge` read at each step: its count, then that many values and as-of times. */
function readsOf(reply: JsonObject, what: string): Step[] {
  expect(reply['ok'], `${what}: the step call runs (ok: true): ${show(reply, 800)}`).toBe(true);
  return arr(reply['steps'], `${what}: steps`).map((s, i) => {
    const o = obj(s, `${what}: steps[${i}]`);
    const a = obj(o['arrays'], `${what}: steps[${i}].arrays`);
    const nums = (k: string): number[] => arr(a[k], `${what}: steps[${i}].arrays.${k}`).map((x) => Number(x));
    const count = nums('gauge.count')[0] ?? NaN;
    return { step: int(o['step'], `${what}: steps[${i}].step`), count, values: nums('gauge.values').slice(0, count), as_of: nums('gauge.as_of').slice(0, count) };
  });
}
/** The session: open, step to 1, the 40 values, step to 5, the 100 values, step to 10. */
function session(planted?: LogicPlanted): { forty: Step[]; hundred: Step[]; issues: JsonObject[][]; appended: JsonObject[] } {
  const layout = layoutOf('gauge', [READING], GAUGE_WRITES, SOURCES);
  const piece = logicPiece(210_04, { gauge: { program: gaugeProgram(layout, READING), reads: [READING], writes: GAUGE_WRITES } }, SOURCES);
  const s = 's1';
  const calls: JsonObject[] = [
    openPiece(piece), stepTo(s, 1),
    ...FORTY.map((v) => deliver(s, READING, v.value, v.as_of, v.arrived)), stepTo(s, 5),
    ...HUNDRED.map((v) => deliver(s, READING, v.value, v.as_of, v.arrived)), stepTo(s, 10),
  ];
  const rs = planted ? onLogicPlanted(calls, planted) : onLogic(calls);
  expect(rs[0]!['ok'], `the session opens the sensor piece: ${show(rs[0], 800)}`).toBe(true);
  expect(str(rs[0]!['session'], 'open: session'), 'the session is s1').toBe(s);
  const appended = rs.filter((_, i) => calls[i]!['call'] === 'append');
  const steps = rs.filter((_, i) => calls[i]!['call'] === 'step');
  return { forty: readsOf(steps[1]!, 'steps 2 to 5'), hundred: readsOf(steps[2]!, 'steps 6 to 10'), issues: steps.map((r, i) => issuesOf(r, `step call ${i}`)), appended };
}
/** The values read over `steps`, in order, against those sent: each failure names the reading. */
function sumFailures(steps: Step[], sent: number[]): string[] {
  const read = steps.flatMap((s) => s.values);
  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
  return sum(read) === sum(sent) && read.length === sent.length ? [] : [`the logic read ${read.length} values of ${READING} summing to ${sum(read)}, not the ${sent.length} sent summing to ${sum(sent)}`];
}

describe(`AC4 ${ID} an each reading: every value since the step before, in order, and an overflow dropped and counted`, () => {
  it(`AC4 ${ID} 40 values are read 16, 16, 8 in order with the sum sent; 100 drop the 36 oldest with one reading.overflow naming 36, the other 64 read over four steps`, () => {
    const r = session();
    const f: string[] = [];
    r.appended.forEach((a, i) => { if (a['ok'] !== true) f.push(`delivery ${i} was refused: ${show(a, 300)}`); });
    // The 40: steps 2, 3, 4 read 16, 16, 8 in the order sent, with their as-of times; step 5 none.
    const want40 = [[2, 0, 16], [3, 16, 32], [4, 32, 40], [5, 40, 40]] as const;
    for (const [k, from, to] of want40) {
      const s = r.forty.find((x) => x.step === k);
      const sent = FORTY.slice(from, to);
      if (!s) { f.push(`no record of step ${k}`); continue; }
      if (JSON.stringify(s.values) !== JSON.stringify(sent.map((v) => v.value))) f.push(`step ${k} read ${JSON.stringify(s.values)}, not the values sent ${from + 1} to ${to} in order ${JSON.stringify(sent.map((v) => v.value))}`);
      if (JSON.stringify(s.as_of) !== JSON.stringify(sent.map((v) => v.as_of))) f.push(`step ${k} read the as-of times ${JSON.stringify(s.as_of)}, not ${JSON.stringify(sent.map((v) => v.as_of))}`);
    }
    f.push(...sumFailures(r.forty, FORTY.map((v) => v.value)));
    const early = r.issues.slice(0, 2).flat();
    if (early.length) f.push(`the steps up to 5 raised ${JSON.stringify(early)}, though nothing overflowed`);
    // The 100: one reading.overflow naming the reading, step 6 and 36; steps 6 to 9 read values 37 to 100 in order.
    const overflow = r.issues[2]!.filter((x) => x['code'] === 'reading.overflow');
    if (overflow.length !== 1 || overflow[0]!['reading'] !== READING || overflow[0]!['step'] !== 6 || overflow[0]!['dropped'] !== 36) f.push(`the steps 6 to 10 raised ${JSON.stringify(r.issues[2])}, not one reading.overflow {reading: ${READING}, step: 6, dropped: 36}`);
    const kept = HUNDRED.slice(36);
    for (let k = 6; k <= 10; k++) {
      const s = r.hundred.find((x) => x.step === k);
      const sent = kept.slice((k - 6) * 16, (k - 5) * 16).map((v) => v.value);
      if (!s) { f.push(`no record of step ${k}`); continue; }
      if (JSON.stringify(s.values) !== JSON.stringify(sent)) f.push(`step ${k} read ${JSON.stringify(s.values)}, not ${JSON.stringify(sent)} (the newest 64 of the 100, 16 a step)`);
    }
    none(f, `AC4 ${ID}`);
  }, TIMEOUT);

  it(`AC4 ${ID} the planted read_region_keeps_last fails the sum of the 40, naming the reading`, () => {
    const r = session('read_region_keeps_last');
    const f = sumFailures(r.forty, FORTY.map((v) => v.value));
    expect(f.length, 'AC4 planted: the sum judgement fails the planted read region').toBeGreaterThan(0);
    expect(f[0], `AC4 planted: the failure names the reading ${READING}`).toContain(READING);
  }, TIMEOUT);
});
