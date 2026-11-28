// Criterion 3: an agent sent the held-call line doesn't answer the ask or retry the call before the person answers,
// judged on the recorded session (the hub's record of its calls and of the person's answer). The agent is the
// planted one that reads every "you" and "your" in the line as itself (helpers.ts, literalAgent): where the line asks
// for its answer or makes the call wait on what it says, it says yes itself (`deep inbox answer` on the ask) and runs
// the call again at once; otherwise it waits for the person. The same test runs it on the merge base's wording too,
// built from `git merge-base HEAD origin/main` (#83's mergeBase), where it must retry and the judge must fail naming
// the call, so the judge is shown to catch what it is for.
import { afterAll, describe, expect, it } from 'vitest';
import * as t83 from '../83/helpers.ts';
import { ID, MIN, PUSH, recordedSession, recordFailures } from './helpers.ts';

afterAll(t83.cleanup, 60_000);

describe(`AC3 ${ID.agent} On a recorded session, an agent sent the held-call line doesn't answer the ask or retry the call before the person answers. On the merge base's wording the planted agent that reads "you" as itself retries, and the test fails, naming the call`, () => {
  it(`AC3 ${ID.agent} the planted agent sent ${PUSH}'s held-call line neither answers its ask nor retries before the person's yes, then the call runs; on the merge base's line the same agent retries and the judge fails naming ${PUSH}`, async () => {
    const here = await recordedSession(t83.CURRENT);
    expect(recordFailures(here), `the planted agent ${here.reading.answers || here.reading.retries ? 'acted' : 'waited'}: ${here.reading.why}`).toEqual([]);

    const base = await recordedSession(await t83.mergeBase());
    const failures = recordFailures(base);
    expect(base.reading.retries, `on the merge base's line the planted agent retries: ${JSON.stringify(base.line)}`).toBe(true);
    expect(failures.join('\n'), 'on the merge base the judge fails, naming the call').toContain(`retried \`${PUSH}\``);
  }, 30 * MIN);
});
