// AC2, a batch: a batch of three allowed steps where the second fails reads "3 ran · 1 failed" with that step's error.
//
// A real hub holds three pushes of one session under the shipped guard push-needs-ask, raised inside one window of
// your visits, so the asks core shows them as one batch (`ask.batched`); the batch is approved on its first step's card
// as the app's card approves a batch (`ask.answer` with every step's index, #327). The agent runs the three in the
// batch's order: the first and third go through (PostToolUse), the second is rejected by the remote
// (PostToolUseFailure). The receipt is read on the answered card's page, its first step's ask, in the app's views drawn
// by `deep-drive` over a copy of the hub's record (README, Pinned 2).
import { afterAll, describe, expect, it } from 'vitest';
import {
  Agent, allowOnCard, awaitRecord, BATCH_COUNTS, cleanup, held, ID, MINUTE, nextWindow, pages, pushError, receiptFailures, runsAgain, stopHub, windowStart, world,
  type Held, type World,
} from './helpers.ts';

const PROMPT = 'Fix the login bug in src/auth.js.';
const PUSHES = ['git push origin main', 'git push origin v2.0.0', 'git push origin release'];
/** The remote's error line for a push of `command`'s ref: a tag that's there already, or a branch that moved. */
const rejected = (command: string): string => {
  const ref = command.split(' ').at(-1)!;
  return `! [rejected] ${ref} -> ${ref} (${ref.startsWith('v') ? 'already exists' : 'fetch first'})`;
};

const worlds: World[] = [];
afterAll(async () => {
  for (const w of worlds.splice(0)) await stopHub(w.hub).catch(() => undefined);
  await cleanup();
}, 5 * MINUTE);

describe(`#2029 AC2 ${ID.receipt}`, () => {
  it(`${ID.receipt} a batch of three allowed steps where the second fails reads "${BATCH_COUNTS}" with that step's error`, async () => {
    const w = await world({ batch: true });
    worlds.push(w);
    const a = await Agent.start(w, PROMPT);
    await windowStart();
    const asks: Held[] = [];
    for (const command of PUSHES) asks.push(await held(w, a, command));
    // The agent's turn ends waiting on your answer after your next visit's time: the hub reads the asks again at a stop
    // (core.ts, the asks beat), which shows the batch.
    await nextWindow();
    await a.says('The three pushes wait for your answer.');
    const batch = await awaitRecord(w.hub, (all) => all.find((e) => e.kind === 'ask.batched' && asks.every((h) => (e.data.asks as { ask: string }[]).some((m) => m.ask === h.ask))),
      `one batch showing the three held pushes (${asks.map((h) => h.ask).join(', ')}), at your next visit`, 6 * MINUTE);
    const order = (batch.data.asks as { ask: string }[]).map((m) => m.ask);
    const steps = asks.map((h) => order.indexOf(h.ask)).sort((x, y) => x - y);
    const byOrder = steps.map((i) => asks.find((h) => h.ask === order[i])!);
    const first = byOrder[0]!;
    await allowOnCard(w, first, steps);
    for (const h of byOrder) await awaitRecord(w.hub, (all) => all.find((e) => e.kind === 'ask.answered' && e.subject === h.ask && e.data.decision === 'allow'), `${h.ask} allowed with the batch`);

    // The three run in the batch's order; the second is rejected.
    const second = byOrder[1]!;
    const commandOf = (h: Held): string => PUSHES.find((c) => h.question.includes(c))!;
    const ran: string[] = [];
    for (const h of byOrder) {
      const command = commandOf(h);
      const call = await runsAgain(a, command);
      ran.push(call);
      if (h === second) await a.failed(call, command, pushError(rejected(command)));
      else await a.ok(call, command, `To github.com:acme/shop.git\n   1a2b3c4..5d6e7f8  ${command.split(' ').at(-1)} -> ${command.split(' ').at(-1)}`);
    }
    await a.says('Pushed main, the v2.0.0 tag and the release branch.');
    for (const call of ran) await awaitRecord(w.hub, (all) => all.find((e) => e.kind === 'tool.after' && e.data.call === call), `the end of step ${call}`);

    const shown = await pages(w, [first.ask]);
    const failures = receiptFailures(shown.get(first.ask), first, [BATCH_COUNTS, rejected(commandOf(second))]);
    expect(failures, failures.join('\n')).toEqual([]);
  }, 180 * MINUTE);
});
