// #1558 AC3 (README): the same `deep lease -- /bin/sh -c 'sleep 300 & echo $!; exit 3'` with no hub, in an empty HOME
// (it runs unleased), and on the `DEEP_LEASED` path (a `deep lease` inside a leased command, which takes no lease of its
// own). Each returns 3 under 5000 ms after its command exited, the leftover sleep still running.
//
// Safety: helpers.ts (an empty home under /tmp/dh1558-*, the sleep SIGKILLed by the PID its command printed, `deep
// lease` by its PID, after the file).
import { describe, expect, it } from 'vitest';
import { cleanEnv } from '../18/mapping/helpers.ts';
import { AC3, EXIT_CODE, emptyDir, killSleep, leaseRun, RETURN_MS, watch } from './helpers.ts';

const CRITERION = 'The same holds with no hub (an empty HOME) and on the `DEEP_LEASED` path: the client returns when the leader exits';

describe(`${AC3} ${CRITERION}`, () => {
  for (const [path, extra] of [['no hub (an empty HOME)', {}], ['the DEEP_LEASED path', { DEEP_LEASED: '1' }]] as const) {
    it(`${AC3} ${path}: \`deep lease\` returns ${EXIT_CODE} at once when the leader exits, its leftover sleep still running`, async () => {
      const dir = emptyDir();
      const run = leaseRun(cleanEnv(dir, extra), dir);
      const { returned, why } = await watch(run, 60_000);
      console.log(`AC3 ${path}: ${returned ? `deep lease exited ${returned.code ?? returned.signal} ${returned.ms} ms after its command exited; the leftover sleep ${returned.sleep} ${returned.sleepRan ? 'still running' : 'gone'}` : why}`);
      try {
        expect(why, why).toBeUndefined();
        expect(returned!.code, `deep lease's exit code is its command's (${EXIT_CODE}); stderr: ${run.err().slice(0, 600)}`).toBe(EXIT_CODE);
        expect(returned!.ms, `deep lease returned ${returned!.ms} ms after its command exited`).toBeLessThan(RETURN_MS);
        expect(returned!.sleepRan, `the leftover sleep ${returned!.sleep} was still running when deep lease returned`).toBe(true);
      } finally {
        if (returned) killSleep(returned.sleep);
      }
    }, 120_000);
  }
});
