import { afterAll, expect, test } from 'vitest';
import { AC1, built, cleanup, failureOf, judgeSend, PLANT, sendScene, sendWorld, stopHub, verdict } from './helpers.ts';

afterAll(cleanup, 180_000);

test(`${AC1} (wrong program) a planted hub that opens the host with no asks core fails the send's judge, naming deep.send`, async (ctx) => verdict(ctx, async () => {
  const missing = built();
  if (missing) throw Error(`BLOCKED: ${missing}`);
  const { w, hub, p, trigger, log } = await sendWorld({ plant: PLANT });
  let failure: string | null;
  try {
    const s = await sendScene(w, hub, p, trigger, log);
    failure = await failureOf(() => {
      const problems = judgeSend(s);
      if (problems.length) throw Error(problems.join('; '));
    });
  } finally {
    await stopHub(hub);
    await p.close();
  }
  expect(failure, `${AC1} the planted hub ${PLANT} must fail the send's judge`).not.toBeNull();
  expect(failure, `${AC1} the planted hub's failure names deep.send`).toContain('`deep.send`');
  console.log(`${AC1} the planted hub fails, naming deep.send: ${failure}`);
}), 600_000);
