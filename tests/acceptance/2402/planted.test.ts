// AC2's wrong program (README, Wrong programs): "A planted host that counts failures and never clears them sets the
// handler aside at the fourth failure and fails, naming the call." A hub started with DEEP_HUB_PLANT=PLANT (chosen),
// which the hub passes on to its extension host, and acme/flaky alone, plays the scene set-aside.test.ts plays on the
// right program: two failures, a reply in time, two failures, then a call acme/flaky answers in time. The same judge
// must fail here, naming the call acme/flaky was no longer asked about. A hub that won't start with the plant (the base
// lists no such plant) is BLOCKED, never a pass.
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import {
  allEvents, asked, built, cleanup, failureOf, FLAKY, FLAKY_SCENE, flakyPackage, flakyScene, installAll, judgeNothingSetAside, loadReading, PLANT, session, sleep, startHub, stopHub, verdict, waitOf, world,
} from './helpers.ts';

const AC2 = 'AC2 #2402.e40df126';

afterAll(cleanup, 180_000);

test(`${AC2} (wrong program) a planted host that counts failures and never clears them sets acme/flaky aside at the fourth failure and fails this test, naming the call`, async (ctx) => verdict(ctx, async () => {
  const missing = built();
  if (missing) throw Error(`BLOCKED: ${missing}`);
  const w = world();
  const flaky = flakyPackage(join(w.tmp, 'test-packages'));
  await installAll(w, [flaky]);
  const hub = await startHub(w, { plant: PLANT });
  let failure: string | null;
  try {
    const s = await session(w);
    const start = (await allEvents(hub)).at(-1)?.log_pos ?? 0;
    const calls = await flakyScene(s);
    // The handler's notes land after its calls; the record is read once they have.
    await sleep(3000);
    const events = await allEvents(hub);
    if (!asked(events, FLAKY, calls[0]!)) throw Error(`BLOCKED: ${AC2} ${FLAKY} must be loaded and asked about its first call on the planted hub (hub stderr: ${hub.stderr().slice(-600)})`);
    console.log(`${AC2} the planted host's scene: ${calls.map((c) => `${c.label} ${waitOf(c).toFixed(0)} ms${asked(events, FLAKY, c) ? ' asked' : ''}`).join(', ')}; ${loadReading()}`);
    failure = await failureOf(() => {
      const problems = judgeNothingSetAside(events, calls, start);
      if (problems.length) throw Error(problems.join('; '));
    });
  } finally {
    await stopHub(hub);
  }
  expect(failure, `${AC2} the planted host ${PLANT} must fail the scene's reading`).not.toBeNull();
  const named = FLAKY_SCENE.filter((step) => failure!.includes(`\`${step.command}\``)).map((step) => step.label);
  expect(named, `${AC2} the failure names the call ${FLAKY} was no longer asked about: ${failure}`).toHaveLength(1);
  console.log(`${AC2} the planted host fails, naming ${named[0]}: ${failure}`);
}), 1_800_000);
