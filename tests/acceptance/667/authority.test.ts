// AC3: the authority ask's answers. From inside the asking session's process tree it is refused even with the OS
// confirming (the peer check refuses it, never the confirmation); by you it counts only once the OS confirms you.

import { afterEach, test } from 'vitest';
import { AC, cleanup } from './helpers.ts';
import { authorityAnswers } from './scenarios.ts';

afterEach(cleanup, 30_000);

test(`${AC[3]} the authority ask answered from inside the asking session's process tree is refused and stays open; by you with the OS confirmation it counts; with it cancelled it saves no decision and stays open`, async () => {
  await authorityAnswers();
}, 240_000);
