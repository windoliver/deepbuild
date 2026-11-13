// AC2, one push at a time: a push allowed on its card, whose `git push` then fails with
// `! [rejected] main -> main (fetch first)`, shows the receipt "Allowed · it failed: ! [rejected] main -> main
// (fetch first) · the agent was told"; one whose PostToolUse never arrives reads "Allowed · outcome unknown". A receipt
// that stays "Allowed", or takes "pushed" from the agent's next message, fails, naming the ask.
//
// A real hub holds each `git push` under the shipped guard push-needs-ask with an authority ask; the push is allowed on
// its card as the app's card answers; the agent runs it again and the hook wire carries its PostToolUseFailure, or no
// record at all; then the agent's next message ("Pushed main to origin.") ends its turn. The receipt is read on the
// answered ask's page in the app's views, drawn by `deep-drive` over a copy of that hub's record (README, Pinned 2).
// The plants are the wrong receipts the criterion names, selected with DEEP_HUB_PLANT (README, Plants).
import { afterAll, describe, expect, it } from 'vitest';
import {
  Agent, allowOnCard, awaitRecord, cleanup, held, hubLists, ID, MINUTE, PLANT, pages, pushError, RECEIPT_FAILED, RECEIPT_UNKNOWN, receiptFailures, REJECTED,
  runsAgain, stopHub, world, type Held, type World,
} from './helpers.ts';

/** You typed this; it names no push, so each push is held for your authority. */
const PROMPT = 'Fix the login bug in src/auth.js.';
const MAIN = 'git push origin main';
const RELEASE = 'git push origin release';
/** The agent's next message after its push failed: what a receipt must never take its words from. */
const AGENT_SAYS = 'Pushed main to origin.';

interface Scene { w: World; failed: Held; unknown?: Held }
/**
 * Session A's push, allowed on its card, runs and the remote rejects it; then the agent says it pushed. With `unknown`,
 * session B's push, allowed on its card, starts, no PostToolUse ever comes, and its turn ends.
 */
async function scene(o: { plant?: string; unknown: boolean }): Promise<Scene> {
  const w = await world(o.plant ? { plant: o.plant } : {});
  const a = await Agent.start(w, PROMPT);
  const failed = await held(w, a, MAIN);
  await allowOnCard(w, failed);
  const call = await runsAgain(a, MAIN);
  await a.failed(call, MAIN, pushError(REJECTED));
  await a.says(AGENT_SAYS);
  await awaitRecord(w.hub, (all) => all.find((e) => e.kind === 'tool.after' && e.data.call === call), `the PostToolUseFailure of \`${MAIN}\``);
  await awaitRecord(w.hub, (all) => all.find((e) => e.kind === 'agent.stop' && e.session === a.id), `session A's stop after "${AGENT_SAYS}"`);
  if (!o.unknown) return { w, failed };
  const b = await Agent.start(w, PROMPT);
  const unknown = await held(w, b, RELEASE);
  await allowOnCard(w, unknown);
  const started = await runsAgain(b, RELEASE);
  await b.says('I will look at the release branch next.');
  await awaitRecord(w.hub, (all) => all.find((e) => e.kind === 'tool.before' && e.data.call === started), `the PreToolUse of the allowed \`${RELEASE}\``);
  await awaitRecord(w.hub, (all) => all.find((e) => e.kind === 'agent.stop' && e.session === b.id), 'session B\'s stop');
  return { w, failed, unknown };
}

const worlds: World[] = [];
let clean: Promise<{ s: Scene; failed: string[]; unknown: string[] }> | undefined;
/** The clean world, its two pages read by the plain replica, judged once for the file. */
const cleanRun = (): NonNullable<typeof clean> => (clean ??= (async () => {
  const s = await scene({ unknown: true });
  worlds.push(s.w);
  const shown = await pages(s.w, [s.failed.ask, s.unknown!.ask]);
  return {
    s,
    failed: receiptFailures(shown.get(s.failed.ask), s.failed, [RECEIPT_FAILED]),
    unknown: receiptFailures(shown.get(s.unknown!.ask), s.unknown!, [RECEIPT_UNKNOWN]),
  };
})());
/** The failed push's page with a plant: in the clean world's record when only the app lists the plant, else in a world whose hub runs it too. */
async function planted(plant: string): Promise<{ ask: string; failures: string[] }> {
  let s = (await cleanRun()).s;
  if (hubLists(plant)) {
    s = await scene({ plant, unknown: false });
    worlds.push(s.w);
  }
  const shown = await pages(s.w, [s.failed.ask], plant);
  return { ask: s.failed.ask, failures: receiptFailures(shown.get(s.failed.ask), s.failed, [RECEIPT_FAILED]) };
}

afterAll(async () => {
  for (const w of worlds.splice(0)) await stopHub(w.hub).catch(() => undefined);
  await cleanup();
}, 5 * MINUTE);

describe(`#2029 AC2 ${ID.receipt}`, () => {
  it(`${ID.receipt} a push allowed on its card whose git push fails reads "${RECEIPT_FAILED}"`, async () => {
    const { failed } = await cleanRun();
    expect(failed, failed.join('\n')).toEqual([]);
  }, 180 * MINUTE);

  it(`${ID.receipt} a push allowed on its card whose PostToolUse never arrives reads "${RECEIPT_UNKNOWN}"`, async () => {
    const { unknown } = await cleanRun();
    expect(unknown, unknown.join('\n')).toEqual([]);
  }, 180 * MINUTE);

  it(`${ID.receipt} a receipt that stays "Allowed" (${PLANT.staysAllowed}) fails, naming the ask`, async () => {
    const { failed } = await cleanRun();
    expect(failed, `the clean receipt already fails, so the plant can't be told from it: ${failed.join('\n')}`).toEqual([]);
    const caught = await planted(PLANT.staysAllowed);
    expect(caught.failures.filter((f) => f.includes(caught.ask)), `the receipt that stays "Allowed" wasn't caught, naming ${caught.ask}: ${JSON.stringify(caught.failures)}`).not.toEqual([]);
  }, 180 * MINUTE);

  it(`${ID.receipt} a receipt that takes "pushed" from the agent's next message (${PLANT.agentText}) fails, naming the ask`, async () => {
    const { failed } = await cleanRun();
    expect(failed, `the clean receipt already fails, so the plant can't be told from it: ${failed.join('\n')}`).toEqual([]);
    const caught = await planted(PLANT.agentText);
    expect(caught.failures.filter((f) => f.includes(caught.ask)), `the receipt that takes "pushed" from "${AGENT_SAYS}" wasn't caught, naming ${caught.ask}: ${JSON.stringify(caught.failures)}`).not.toEqual([]);
  }, 180 * MINUTE);
});
