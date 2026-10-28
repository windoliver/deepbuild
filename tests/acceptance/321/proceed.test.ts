// #321 AC1: a "proceed" never covers a call that needs authority. A planted sorter (DEEP_HUB_TEST_SORTER, README:
// The planted sorter) answers the agent's "want me to push to main?" with "proceed"; the proceed is recorded with its
// rule, and in the turn it starts the agent's `git push origin main` is held at PreToolUse with an authority ask naming
// the push, which waits for your answer (your yes then lets it run). After the same sorter's "proceed" for "want me
// to run the tests?", `npm test` runs with no ask. A core that lets a proceed cover the calls of the turn it starts
// (DEEP_HUB_PLANT=proceed-covers-turn) lets the push through and fails this test, naming the call.
import { afterEach, describe, it } from 'vitest';
import {
  AC1, PUSH_Q, TESTS_Q, approve, bash, cleanup, expectFree, expectHeld, expectProceed, expectRuns, failureOf, lastPos, makeWorld,
  must, newSession, sessionStart, startHub, stillHeld, stopHub, tag, typed, verdict, work, writeSorter,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const PUSH = 'git push origin main';

async function scenario(plant?: string): Promise<void> {
  const who = `AC1 ${AC1}`;
  const w = makeWorld();
  const rule = `planted-proceed-${tag()}`;
  const hub = await startHub(w, { plant, sorter: writeSorter(w, rule, [PUSH_Q, TESTS_Q]) });
  try {
    const s = newSession(w);
    await sessionStart(w, s);
    await typed(w, s, 'Fix the login bug in src/login.ts.');
    await work(w, s);
    await expectProceed(w, hub, s, PUSH_Q, rule, who);
    // The turn the proceed starts: the agent pushes.
    const since = await lastPos(hub);
    const held = await expectHeld(w, hub, s, bash(PUSH), { who: `${who} [effect.push]`, names: [PUSH], since });
    await stillHeld(hub, held, 5000);
    await expectRuns(w, hub, held, await approve(w, hub, held));
    // A later turn ends on a question the same sorter answers proceed; in the turn it starts, the tests run.
    await typed(w, s, 'Carry on.');
    await work(w, s);
    await expectProceed(w, hub, s, TESTS_Q, rule, who);
    await expectFree(w, hub, s, bash('npm test'), { who, names: ['npm test'] });
  } finally {
    await stopHub(hub);
  }
}

describe(`AC1 ${AC1} a proceed never covers a push: held at PreToolUse with an authority ask, whatever sorter answered`, () => {
  it(`AC1 a planted sorter's proceed is recorded with its rule; in the turn it starts, ${PUSH} is held with an authority ask naming it until your answer; after a proceed for the tests, npm test runs with no ask`, async (ctx) => {
    await verdict(ctx, () => scenario());
  }, 900_000);

  it(`AC1 (wrong program) a core that lets a proceed cover the turn's calls (DEEP_HUB_PLANT=proceed-covers-turn) lets the push through and fails this test, naming the call`, async (ctx) => {
    await verdict(ctx, async () => {
      const why = await failureOf(() => scenario('proceed-covers-turn'));
      must(why !== null, `${AC1} the planted core proceed-covers-turn must fail this test; it passed`);
      must(why.includes(PUSH), `${AC1} the planted core must fail this test naming the call \`${PUSH}\`; it failed with: ${why}`);
    });
  }, 900_000);
});
