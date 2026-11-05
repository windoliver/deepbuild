// A replay's frozen hash must survive refactoring, including paths consisting entirely of digits.
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { planHash, type ReplayPlan } from '@deepbuild/record';

it('keeps the frozen replay-plan bytes for numeric-looking file names', () => {
  const plan: ReplayPlan = {
    id: 'replay-order', cutoff: 1, tasks: ['task-1'], fitted: [],
    variants: {
      base: { name: 'base', files: { '2': 'second', '10': 'tenth' } },
      change: { name: 'change', files: {} },
    },
    models: { agent: 'claude', judge: 'gpt' }, repeats: 1,
    measures: [{ name: 'latency', better: 'lower' }],
    rule: 'paired-mean-one-sided-95', budget: { ms: 1000, plan_share: 0.1 },
  };
  // The existing replay encoding sorts these names lexically ("10", then "2"), not as JS integer keys.
  const frozen = '{"budget":{"ms":1000,"plan_share":0.1},"cutoff":1,"fitted":[],"id":"replay-order","measures":[{"better":"lower","name":"latency"}],"models":{"agent":"claude","judge":"gpt"},"repeats":1,"rule":"paired-mean-one-sided-95","tasks":["task-1"],"variants":{"base":{"files":{"10":"tenth","2":"second"},"name":"base"},"change":{"files":{},"name":"change"}}}';
  expect(planHash(plan)).toBe(createHash('sha256').update(frozen).digest('hex'));
});
