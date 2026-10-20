// The contracts workload for the perf lane's budgets (issue #311): validates each event kind's first fixture
// 1,000 times, in one process. The per-call limit (20 µs at p95) stays in tests/acceptance/311/budgets.test.ts.
import { catalogue, fixtures, validate } from '../packages/contracts/dist/index.js';

const events = catalogue().map(({ schema }) => ({ schema, event: fixtures(schema)[0] }));
for (let i = 0; i < 1_000; i++) {
  for (const { schema, event } of events) {
    if (!validate(schema, event).ok) throw Error(`${schema}'s first fixture is refused`);
  }
}
