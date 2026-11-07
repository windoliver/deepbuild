// #1523 AC2: "create PR" names `gt submit --stack` as it names `gh pr create`. In a thread whose prompt says
// "create PR", `gt submit --stack` runs with no ask. In another thread whose prompt says only "push", it's held as a PR:
// denied naming a block entry of `effect:pr`, with an authority ask whose card names the pull request.
import { afterEach, describe, it } from 'vitest';
import { AC2, CREATE_PR, Session, bash, cleanup, expectAllowed, expectHeld, makeWorld, startHub, stopHub, verdict, type Hub, type World } from './helpers.ts';

afterEach(cleanup, 60_000);

const SUBMIT = 'gt submit --stack';

async function thread(hub: Hub, w: World, prompt: string): Promise<Session> {
  const s = new Session(w);
  s.hub = hub;
  await s.start();
  await s.typed(prompt);
  return s;
}

describe(`${AC2} "create PR" covers gt submit; "push" alone doesn't`, () => {
  it(`${AC2} after "${CREATE_PR}" ${SUBMIT} runs; in a thread that says only "push" it is held as a PR`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    try {
      const asked = await thread(hub, w, CREATE_PR);
      await expectAllowed(hub, asked, bash(SUBMIT), `${AC2} in a thread whose prompt says "${CREATE_PR}",`);
      const pushOnly = await thread(hub, w, 'push');
      await expectHeld(hub, pushOnly, SUBMIT, ['pr'], `${AC2} in a thread whose prompt says only "push", held as a PR:`);
    } finally {
      await stopHub(hub);
    }
  }), 900_000);
});
