// AC1 and AC2: a Vitest run whose test `cart total` fails at `expect(total).toBe(18.01)` with 18 received. Its report
// is Vitest's own JSON reporter's file (fixtures/vitest-cart-failed.json, README: Fixtures). The hub records the run
// from that report (`run`), and a panel's two bound values on `run:<id>#cart total`, `select: expected` and `select:
// received`, show 18.01 and 18 with the run as their source and the run's end as their as-of time, at every frame read.
// The same panel replayed from the record entry alone, with the report deleted, shows the same at the same frames. A
// bound value on a run that passed reads missing with `not_reported`, naming the run and the assertion. At the base
// `deep-show run` has no `run` call and answers the scenario `bad_input`.
import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ASSERTION, ENDED, FRAMES_AT, RECORDED_AT, VITEST_PASSED_RUN, VITEST_RUN, copied, entryOf, find, framesOf, numbersIn, readsMissing, runShow,
  scenario, secs, showsValue, useBuilds, useTemp, type BoundText, type JsonObject, type World,
} from './helpers.ts';

const build = useBuilds(['deep-show']);
const temp = useTemp();

const bound = (run: string): BoundText[] => [
  { id: 'expected', bind: { source: `${run}#${ASSERTION}`, select: 'expected' } },
  { id: 'received', bind: { source: `${run}#${ASSERTION}`, select: 'received' } },
];

/** The live scenario: the failing Vitest run recorded from its report, then the panel's frames. */
function live(evidence: string, report: string): World {
  return { evidence, bound: bound(VITEST_RUN), runs: [{ at: RECORDED_AT, run: { run: VITEST_RUN, check: 'cart', tool: 'vitest', report, ended: ENDED } }] };
}

/** AC1's check on every frame: expected 18.01 and received 18, each with the run as source and its end as as-of. */
function totals(frames: ReturnType<typeof framesOf>): string[] {
  return frames.flatMap((f) => [
    ...showsValue(find(f.bound, 'expected'), { element: 'expected', source: VITEST_RUN, shows: '18.01', value: 18.01, asOf: ENDED }, `in the frame at ${secs(f.at)}`),
    ...showsValue(find(f.bound, 'received'), { element: 'received', source: VITEST_RUN, shows: '18', value: 18, asOf: ENDED }, `in the frame at ${secs(f.at)}`),
  ]);
}

describe('AC1 a failing Vitest assertion\'s expected and received numbers, read from its report', () => {
  it('AC1 the run recorded from Vitest\'s JSON report holds cart total\'s expected 18.01 and received 18 as printed, and the panel\'s bound values show 18.01 and 18 with the run as source and the run\'s end as as-of (fails on a resolver that swaps Vitest\'s "expected <received> to be <expected>", or stamps the as-of when the hub recorded the run)', () => {
    const s = scenario(live(temp(), copied(temp(), 'vitest-cart-failed.json')));
    const replies = runShow(build('deep-show'), s, 'the failing Vitest run');
    const entry = entryOf(replies[1], 'the run call');
    // The record entry: the run, its end, and the assertion as the report printed it where it failed.
    expect(entry.run, 'the record entry names the run').toBe(VITEST_RUN);
    expect(entry.ended, 'the record entry keeps the run\'s end').toBe(ENDED);
    const cart = entry.assertions.find((a) => a.assertion === ASSERTION);
    expect(cart, `the record entry lists the assertion ${JSON.stringify(ASSERTION)}: ${JSON.stringify(entry.raw).slice(0, 800)}`).toBeDefined();
    expect(cart!.outcome, 'cart total failed').toBe('failed');
    // Vitest prints "expected 18 to be 18.01": the first number is what it received.
    expect(numbersIn(cart!.expected ?? ''), `the expected value's raw bytes ${JSON.stringify(cart!.expected)} are the 18.01 Vitest printed`).toEqual(['18.01']);
    expect(numbersIn(cart!.received ?? ''), `the received value's raw bytes ${JSON.stringify(cart!.received)} are the 18 Vitest printed`).toEqual(['18']);
    const frames = framesOf(s, replies, 'the failing Vitest run');
    expect(frames.map((f) => f.at), 'a frame read at each time').toEqual(FRAMES_AT);
    expect(totals(frames), 'the two bound values at every frame').toEqual([]);
  });
});

describe('AC2 a replay from the record shows the same, and a run that passed reads missing', () => {
  it('AC2 replayed from the record entry alone, with the report deleted, the panel shows the same two values, sources and as-of times at the same frames (fails on a replay that re-reads the report, or one whose as-of is the replay\'s load time)', () => {
    const report = copied(temp(), 'vitest-cart-failed.json');
    const s = scenario(live(temp(), report));
    const replies = runShow(build('deep-show'), s, 'the live run');
    const entry = entryOf(replies[1], 'the run call');
    const before = framesOf(s, replies, 'the live run');
    expect(totals(before), 'the live run shows the two values').toEqual([]);
    // The replay holds only the record: the report the run was read from is gone.
    rmSync(report);
    const r = scenario({ evidence: temp(), bound: bound(VITEST_RUN), record: [entry.raw] });
    const again = framesOf(r, runShow(build('deep-show'), r, 'the replay from the record'), 'the replay from the record');
    expect(totals(again), 'the replay shows the two values').toEqual([]);
    const shown = (fs: typeof before): JsonObject[] => fs.map((f) => ({ vsync: f.vsync, bound: f.bound.map((b) => ({ element: b.element, text: b.text, value: b.value, as_of: b.as_of, source: b.source })) }));
    expect(shown(again), 'the replay draws what the live run drew, frame for frame').toEqual(shown(before));
  });

  it('AC2 a bound value on a run that passed reads missing with not_reported, naming the run and the assertion, and shows no number (fails on a resolver that shows the expected value of a passed assertion, or 0)', () => {
    const s = scenario({
      evidence: temp(), bound: bound(VITEST_PASSED_RUN),
      runs: [{ at: RECORDED_AT, run: { run: VITEST_PASSED_RUN, check: 'cart', tool: 'vitest', report: copied(temp(), 'vitest-cart-passed.json'), ended: ENDED } }],
    });
    const replies = runShow(build('deep-show'), s, 'the passing Vitest run');
    const entry = entryOf(replies[1], 'the run call');
    const cart = entry.assertions.find((a) => a.assertion === ASSERTION);
    expect(cart, `the record entry lists ${JSON.stringify(ASSERTION)}: ${JSON.stringify(entry.raw).slice(0, 800)}`).toBeDefined();
    expect([cart!.outcome, cart!.expected, cart!.received], 'cart total passed, with nothing recorded where it failed').toEqual(['passed', null, null]);
    const f = framesOf(s, replies, 'the passing Vitest run').flatMap((fr) => [
      ...readsMissing(find(fr.bound, 'expected'), 'expected', VITEST_PASSED_RUN, `in the frame at ${secs(fr.at)}`),
      ...readsMissing(find(fr.bound, 'received'), 'received', VITEST_PASSED_RUN, `in the frame at ${secs(fr.at)}`),
    ]);
    expect(f, 'both bound values read missing at every frame').toEqual([]);
  });
});
