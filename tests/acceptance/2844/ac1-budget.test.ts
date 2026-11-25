// AC1 #2844.1a4ae9f6: "Budget, on the reference Mac in the local preflight: 16 lights and 4,096 occluder segments at 1920 ×
// 1080 cost under 2 ms of GPU time a frame (a target, to be measured)"
//
// The criterion is #2032's eighth, moved here on 2026-11-18 with its text unchanged, and the issue's Proof names its
// test: `tests/acceptance/2032-redraft-ac8/ac8-budget.test.ts`, the blind redraft that judges the budget from five runs
// with each run's loads. By the maintainer's decision on #2032 that test keeps its tag, `AC8 #2032.1a4ae9f6`, and a
// criterion is traced by the tag in a test's name: the same text gives the same eight digits under either issue, and
// the issue's number in front of them is what the trace reads. So this file measures nothing and judges nothing of
// its own. It registers that one test, from its own file, under this criterion's ID: the test below is the redraft's,
// with its fixture, its warm-up, its five runs, its loads and its verdict, and its full name carries both tags.
// It fails where the redraft fails (the merge base: 2.82 to 2.85 ms against 2 on the reference Mac at rest), is
// INCONCLUSIVE where the redraft is (off macOS's Metal device, off a reference Mac at rest), and passes when the
// budget holds (README: Criterion 1).
import { describe } from 'vitest';

const AC1 = 'AC1 #2844.1a4ae9f6';

describe(`${AC1} the budget of 16 lights and 4,096 occluder segments, judged by #2032's redrafted criterion 8`, async () => {
  await import('../2032-redraft-ac8/ac8-budget.test.ts');
});
