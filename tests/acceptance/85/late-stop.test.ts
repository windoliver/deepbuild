// Criterion 10: a dropped-connection stop that reaches the hub 9 hours after its stamp starts no automatic continue;
// the same stop arriving 2 minutes after its stamp continues once. A rule keyed only on the cause fails this test
// (plants.test.ts).

import { test } from 'vitest';
import { lateStop } from './scenarios.ts';

test("#85.d96aabec a dropped-connection stop 9 hours old by deep-hook's stamp when it reaches the hub starts no automatic continue (its row shows the cause, nothing reaches Needs you, no turn starts), while the same stop 2 minutes old continues once", async () => {
  await lateStop();
}, 30_000);
