// Criterion 12: supersede and the fold follow the thread, across /compact and /clear, never the session ID.

import { afterEach, beforeEach, test } from 'vitest';
import { openWorld, type World } from './helpers.ts';
import { foldAcrossClear, supersedeAcrossCompact } from './scenarios.ts';

let w: World;
beforeEach(async () => { w = await openWorld(); });
afterEach(async () => { await w.close(); });

test('#318.b4c25197 an ask raised before /compact and a newer one on its subject after it, under the rotated ID, show one card', async () => {
  await supersedeAcrossCompact(w);
});

test('#318.b4c25197 five asks open across a /clear fold a sixth into the exception', async () => {
  await foldAcrossClear(w);
});
