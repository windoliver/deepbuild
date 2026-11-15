// A Vitest setup file for #1106's third criterion run on a planted supervisor (helpers.ts, run1106). #1106's test
// starts its own hub with no plant, and its helpers remove every DEEP_* variable when they load. This puts the hub's
// DEEP_HUB_PLANT back, from DH2399_PLANT, once that test file has loaded and before its tests run, so the hub it
// starts acts as the planted program. With DH2399_PLANT unset it does nothing. Only tests set either variable.
import { beforeAll } from 'vitest';

beforeAll(() => {
  if (process.env.DH2399_PLANT) process.env.DEEP_HUB_PLANT = process.env.DH2399_PLANT;
});
