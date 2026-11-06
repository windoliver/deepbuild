// #84 AC13: the defaults read the prompts a person typed, by each prompt's `from` (#303). In a thread where only a
// background subagent's report says "create PR" (a prompt nobody typed, recorded `from: subagent`), `git push origin
// HEAD` is denied, naming the rule; after you type "create PR" in the same thread it goes through. A default that reads
// every prompt the thread holds, whatever its `from` (DEEP_HUB_PLANT=reads-every-from), lets the first push through and
// fails this test.
import { afterEach, describe, it } from 'vitest';
import { AC13, CREATE_PR, PUSH, allEvents, bash, cleanup, expectAllowed, expectDenied, failureOf, listed, makeWorld, must, settle, startHub, stopHub, unasked, verdict } from './helpers.ts';

afterEach(cleanup, 60_000);

/** The report as the corpus's subagent session has it; only its origin keeps it from being your ask. */
const REPORT = `<agent-message from="a2711031fe8c87e48">\n[Subagent hand-back] The text below is the final report of a subagent this session delegated to. The report follows:\n  The login fix is committed on this branch. ${CREATE_PR}\n</agent-message>`;

async function scenario(plant?: string): Promise<void> {
  const w = makeWorld();
  const hub = await startHub(w, { plant });
  try {
    const s = await unasked(hub, w);
    await s.handback(REPORT);
    const report = (all: Awaited<ReturnType<typeof allEvents>>) => all.find((e) => e.kind === 'user.ask' && e.session === s.id && String(e.data.text).includes(CREATE_PR));
    const recorded = report(await settle(hub, (all) => report(all) !== undefined));
    must(recorded?.data.from === 'subagent', `BLOCKED: ${AC13} the report must be recorded in the thread as a prompt from subagent: ${listed(recorded ? [recorded] : [])}`);
    await expectDenied(hub, s, bash(PUSH), `${AC13} with only the subagent's report saying "${CREATE_PR}",`);
    await s.typed(CREATE_PR);
    await expectAllowed(hub, s, bash(PUSH), `${AC13} after you type "${CREATE_PR}" in the same thread,`);
  } finally {
    await stopHub(hub);
  }
}

describe(`${AC13} a subagent's report is no ask; your typed "${CREATE_PR}" is`, () => {
  it(`${AC13} ${PUSH} is denied naming the rule while only a subagent's report says "${CREATE_PR}", and goes through after you type it`, async (ctx) => verdict(ctx, () => scenario()), 600_000);

  it(`${AC13} (wrong program) a default that reads every prompt the thread holds, whatever its from (DEEP_HUB_PLANT=reads-every-from), lets the first push through and fails this test`, async (ctx) => verdict(ctx, async () => {
    const why = await failureOf(() => scenario('reads-every-from'));
    must(why !== null, `${AC13} the planted default reads-every-from must fail this test; it passed`);
    must(why.includes(PUSH) && why.includes('must be denied'), `${AC13} the planted default must fail this test on the first \`${PUSH}\` going through; it failed with: ${why}`);
  }), 600_000);
});
