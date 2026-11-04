// #325 AC6: a change that ships behind a switch, flag or schedule that's off or unset in the deployed configuration
// can't say "Closes" until you decide it stays off, and that decision is saved with the follow-up it needs (design:
// Done means switched on).
//
// The repo's spec names its switches (README, Switches): `switches: { file: config/flags.json, deployed:
// config/deployed.json }`. The change adds reject_expired (off where it's deployed), audit_log (unset there) and
// fast_path (on) to config/flags.json.
import { afterEach, describe, it } from 'vitest';
import { AC6, cleanup } from './helpers.ts';
import { behindSwitches } from './scenarios.ts';

afterEach(cleanup, 60_000);

describe(`${AC6} a change behind a switch that's off where it's deployed can't say Closes until you decide it stays off`, () => {
  it(`${AC6} item 11: Closes #11 refused naming Part of, reject_expired and audit_log (never fast_path); you decide both stay off; Closes #11 then allowed; each decision saved with its follow-up`, async () => {
    await behindSwitches(11, AC6);
  }, 300_000);
});
