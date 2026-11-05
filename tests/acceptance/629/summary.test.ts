// AC5: the agent's summary of the run (fixtures/agent-summary.txt) says cart total received 18.10; the run's report says
// 18. The hub is given both: the report, and the summary as the agent's words about the run (the `run` call's
// `summary`). The bound values show the report's numbers; the planted resolver that reads the agent's summary instead
// shows 18.10, a value the report doesn't hold, and the same check fails on it, naming the bound value. An agent's word
// is never evidence (AGENTS.md, the first invariant). At the base `deep-show run` has no `run` call and answers
// `bad_input`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ASSERTION, ENDED, RECORDED_AT, VITEST_RUN, copied, find, fixture, framesOf, runShow, scenario, secs, showsValue, useBuilds, useTemp,
  type BoundText, type Planted,
} from './helpers.ts';

const build = useBuilds(['deep-show']);
const temp = useTemp();

const bound: BoundText[] = [
  { id: 'expected', bind: { source: `${VITEST_RUN}#${ASSERTION}`, select: 'expected' } },
  { id: 'received', bind: { source: `${VITEST_RUN}#${ASSERTION}`, select: 'received' } },
];

/** The criterion's check: the panel shows what the report holds, as failures each naming its bound value. */
function fromReport(planted?: Planted): { failures: string[]; received: (number | null)[] } {
  const s = scenario({
    evidence: temp(), bound, ...(planted ? { planted } : {}),
    runs: [{ at: RECORDED_AT, run: { run: VITEST_RUN, check: 'cart', tool: 'vitest', report: copied(temp(), 'vitest-cart-failed.json'), ended: ENDED, summary: copied(temp(), 'agent-summary.txt') } }],
  });
  const frames = framesOf(s, runShow(build('deep-show'), s, `the Vitest run with the agent's summary${planted ? ` (planted ${planted})` : ''}`), 'the run with a summary');
  return {
    failures: frames.flatMap((f) => [
      ...showsValue(find(f.bound, 'expected'), { element: 'expected', source: VITEST_RUN, shows: '18.01', value: 18.01, asOf: ENDED }, `in the frame at ${secs(f.at)}`),
      ...showsValue(find(f.bound, 'received'), { element: 'received', source: VITEST_RUN, shows: '18', value: 18, asOf: ENDED }, `in the frame at ${secs(f.at)}`),
    ]),
    received: frames.map((f) => find(f.bound, 'received')?.value ?? null),
  };
}

describe('AC5 a resolver that reads the agent\'s summary instead of the tool\'s report fails, naming the bound value', () => {
  it('AC5 with the agent\'s summary saying 18.10 beside the report, the bound values show the report\'s 18.01 and 18; the planted resolver_reads_summary shows 18.10, which the report doesn\'t hold, and fails naming bound value received', () => {
    // The fixtures disagree as the criterion needs: the summary says 18.10, the report holds no 18.1 anywhere.
    expect(readFileSync(fixture('agent-summary.txt'), 'utf8'), 'the agent\'s summary says received 18.10').toContain('received 18.10');
    expect(readFileSync(fixture('vitest-cart-failed.json'), 'utf8'), 'the report holds no 18.1').not.toMatch(/18\.1(?!\d)|18\.10/);
    expect(fromReport().failures, 'the report\'s numbers, whatever the agent said').toEqual([]);
    const wrong = fromReport('resolver_reads_summary');
    expect(wrong.received.every((v) => v !== null && Math.abs(v - 18.1) < 1e-9), `the planted resolver shows the summary's 18.10 at every frame: ${JSON.stringify(wrong.received)}`).toBe(true);
    expect(wrong.failures.length, 'the check fails on the planted resolver').toBeGreaterThan(0);
    expect(wrong.failures.every((w) => w.startsWith('bound value received')), `every failure names the bound value received: ${JSON.stringify(wrong.failures)}`).toBe(true);
  });
});
