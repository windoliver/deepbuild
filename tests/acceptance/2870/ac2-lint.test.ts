// #2870 AC2: "The loads lint reads `benchmarks/` as well as `tests/acceptance`, so a judge there that gives no loads
// fails the lint"
//
// The issue's Proof: the loads lint's planted call. A scratch checkout holds copies of this checkout's scripts/ and
// benchmarks/, a judge planted under benchmarks/ that gives no loads for a plain target and for a floor, in the forms
// canvas.mjs's judge had at the base (twins/benchmarks/), and a timing suite planted under tests/acceptance that gives
// none (twins/acceptance/). This checkout's lint, run with --root on it, must list exactly the planted calls, each by its
// file and line, and exit 1: the copy of this checkout's own benchmarks/ adds no finding.
import { expect, test } from 'vitest';
import { AC2, checkout, lint, plant } from './helpers.ts';

test(`${AC2} over a checkout holding this one's benchmarks/, the loads lint lists a judge planted under benchmarks/ and a suite planted under tests/acceptance that give no loads, each by its file and line, nothing else, and fails`, () => {
  const at = checkout();
  const planted = [...plant(at, 'benchmarks', 'benchmarks'), ...plant(at, 'acceptance', 'tests/acceptance/9870')].sort();
  expect(planted, 'the planted calls that give no loads').toHaveLength(3);
  const { status, fails, passes, output } = lint(at);
  expect([...fails].sort(), `the lint lists exactly the planted calls, the judge under benchmarks/ among them:\n${output}`).toEqual(planted);
  expect(status, output).toBe(1);
  expect(passes, `no PASS line beside a finding:\n${output}`).toBe(0);
});
