// The wrong program #1830 AC3 names: a judgeLimit that ignores loads. It judges every set of runs as if each had
// started and ended on an idle machine, as judgeLimit did before #1555; everything else is scripts/benchmark.mjs.
// ac3-judge.test.ts lays it in a scratch checkout as scripts/benchmark.mjs, with the real module beside it as
// scripts/benchmark.real.mjs, and runs a copy of #568's redrafted judge suite there.
import { judgeLimit as judge } from './benchmark.real.mjs';

export * from './benchmark.real.mjs';

export function judgeLimit(input) {
  const { loads: _ignored, ...rest } = input ?? {};
  const idle = Array.from({ length: Array.isArray(rest.runs) ? rest.runs.length : 5 }, () => ({ start: 0, end: 0 }));
  return judge({ ...rest, loads: idle });
}
