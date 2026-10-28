// Check files under .deepbuild/ (#303): a drafted check file changed by python after the lock makes the next claim's
// recomputed hash differ; the claim's checks run the approved bytes kept by digest; the change becomes a proposal.

import { afterEach, test } from 'vitest';
import { openWorld, type World } from './helpers.ts';
import { checkFileChanged } from './scenarios.ts';

let world: World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

test('#303.323ca6a1 a drafted check file under .deepbuild/ changed by python -c after the lock makes the next claim\'s hash differ, its checks run the approved bytes by digest, and the change becomes a proposal naming the file', async () => {
  world = await openWorld();
  await checkFileChanged(world);
});
