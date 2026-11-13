// #55 AC13's wrong program (README, The wrong program): the hub planted with `paseo-delivers-beside-waiter` hands your
// answer to the plugin's prompt route while deep-hook's waiter for the session is live, so the plugin delivers while the
// waiter also fires. This is delivery.test.ts's wake route, run on that hub: it must fail at the routes assertion,
// naming the ask and quoting what the plugin sent beside the live waiter. It passes only on a program delivering once.
import { afterEach, describe, it } from 'vitest';
import { AC13, PLANT, answeredByWake, cleanup, idleInPaseo } from './world.ts';

afterEach(cleanup, 120_000);

describe(`${AC13} the wrong program ${PLANT}`, () => {
  it(`${AC13} ${PLANT}: a plugin that delivers while deep-hook's waiter also fires sends the answer twice and fails, naming the ask`, async () => {
    // As DEEP_HUB_PLANT set by hand reaches every process #27's childEnv starts: the hub, setup, the CLI, and paseo's
    // daemon with the plugin, Claude Code, deep-hook and deep mcp under it.
    const before = process.env.DEEP_HUB_PLANT;
    process.env.DEEP_HUB_PLANT = PLANT;
    try {
      await answeredByWake(await idleInPaseo());
    } finally {
      if (before === undefined) delete process.env.DEEP_HUB_PLANT;
      else process.env.DEEP_HUB_PLANT = before;
    }
  }, 400_000);
});
