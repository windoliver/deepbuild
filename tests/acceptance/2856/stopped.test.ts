// AC1 #2856.4a55999e: "On #172's lab fixture with its 600-step track, a test shim makes the core's frame call throw at
// step 300. By the next display frame `paused` reads true and the page shows one `stopped` notice naming step 300 and
// the shim's message. `ended` hasn't fired, and in the 5 s after, the page asks for 0 animation callbacks. `probe()`
// answers with `stopped` naming step 300. On the merge base `paused` reads false and no notice shows, and this test
// fails. A planted player that catches the failure and plays on fails, naming the step"
//
// The lab and its track are #172's (`labDoc`, `labTrack`), exported to the web by `deep-show run` and served untouched
// by the test server. The shim (helpers.ts) is installed before the page's own scripts; once the player is ready the
// test arms it and starts the play from 0 as a user's gesture. The first frame call of the core asked for a time at or
// past step 300 (5 s) steps the core to exactly step 300 and throws `WebAssembly.RuntimeError` with the shim's message,
// so the step the player holds is 300. At the next display frame the shim reads `paused` and the notices; 5 s after
// that the test reads the animation callbacks asked for since the throw, the `ended` events and `probe()`
// (helpers.ts `stoppedFailures`).
//
// asserts, each failure naming step 300:
//   - at the next display frame: `paused` is true, and the page shows exactly one notice of kind `stopped`
//     (`[data-deep-notice="stopped"]`), shown, whose text holds 300 as a number and the shim's message;
//   - over the 5 s after: no animation callback asked for since the throw, and no `ended`;
//   - then `probe()` answers, its `stopped` an object whose `step` is 300 (README: probe().stopped, chosen);
//   - the planted player `web_plays_on_failure` fails that judgement, a failure naming step 300.
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { AC, FULL, PLANTED, STOP_STEP, TIMEOUT, bundleFailures, exportLab, failsNaming, none, stoppedFailures, usePages, useShow, useTemp } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const pages = usePages();
const AT = `step ${STOP_STEP}`;

/** The lab exported to the web (by the planted export when named), its bundle checked against its receipt. */
function exported(planted?: string): string {
  const out = join(temp(), 'bundle');
  const what = `the lab${planted ? ` (planted ${planted})` : ''}`;
  const { receipt } = exportLab(shows(FULL), temp(), out, what, planted);
  none(bundleFailures(out, receipt, `${what}'s bundle`), `${what}: the bundle holds every file its receipt names, each by its hash`);
  return out;
}

describe(`${AC[1]} a throw from the core while the lab plays stops the play, with a notice naming the step and the failure`, () => {
  it(`${AC[1]} the core's frame call thrown at ${AT}: paused by the next display frame with one stopped notice naming ${AT} and the shim's message, no animation callback asked for in the 5 s after, no ended, probe().stopped at ${AT}`, async () => {
    none(await stoppedFailures(exported(), 'the lab', pages), `the play stops at ${AT} and says why`);
  }, TIMEOUT);

  it(`${AC[1]} the planted player ${PLANTED.playsOn}, which catches the failure and plays on, fails, naming the step`, async () => {
    const failures = await stoppedFailures(exported(PLANTED.playsOn), `the lab (planted ${PLANTED.playsOn})`, pages);
    console.log(`${AC[1]} the planted player's failures:\n  ${failures.join('\n  ')}`);
    failsNaming(failures, AT, `the planted player ${PLANTED.playsOn}`);
  }, TIMEOUT);
});
