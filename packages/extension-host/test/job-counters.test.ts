// A job tool's own counters (#1925), one JSON line each on its stderr: done of a total or a provider's percent. Any
// other line is the tool's own text, and a counter that can't be true (past its total, negative, a fraction of a
// frame, past 100%) is no counter.
import { expect, it } from 'vitest';
import { counterOf } from '../src/job-kinds.js';

it('reads done of a total and a percent, and nothing from any other line', () => {
  expect(counterOf('{"progress":{"done":300,"total":600}}')).toEqual({ done: 300, total: 600 });
  expect(counterOf('{"progress":{"percent":42.5}}')).toEqual({ percent: 42.5 });
  for (const line of ['wrote frame 300', '{"done":300,"total":600}', '{"progress":{"done":601,"total":600}}', '{"progress":{"done":-1,"total":600}}', '{"progress":{"done":1.5,"total":3}}', '{"progress":{"percent":101}}']) {
    expect(counterOf(line), line).toBeUndefined();
  }
});
