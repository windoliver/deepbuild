// AC4: nobody answers. The hub's clock moves past the choice ask's 4-hour deadline and it takes its default,
// announced on the stream and recorded as defaulted, and an undo opens it again; past the authority ask's 1-day
// deadline it takes no. The clock moves by starting the hub again just before each deadline (README).

import { afterEach, test } from 'vitest';
import { AC, cleanup } from './helpers.ts';
import { defaultsAtDeadlines } from './scenarios.ts';

afterEach(cleanup, 30_000);

test(`${AC[4]} past its deadline the unanswered choice ask takes its default, announced on the stream and recorded as defaulted, and an undo opens it again; the authority ask past its deadline takes no`, async () => {
  await defaultsAtDeadlines();
}, 360_000);
