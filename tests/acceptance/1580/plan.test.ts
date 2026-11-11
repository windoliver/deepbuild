// #1580 AC1, and the Proof: a phone's yes on a plan signs that plan's hash, and a plan changed after signing is
// refused, naming the hash; the merge base accepts it, since there the hub fills the plan's hash in itself at answer
// time. The phone signs its yes over the card as the paseo relay shows it; then the core proposes another plan for the
// ask (README, Surfaces: how a plan changes) while the hub is down; the hub starts again and the signed yes arrives.
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, MINUTE, answeredOf, cleanup, describeItem, inboxRow, lastPos, openInNeedsYou, outcomeOf, planOf, planOn, proposeAgain, restart, said, signedAnswer, sleep, waitFor, world,
} from './helpers.ts';

afterEach(cleanup, 120_000);

const PUSH = { source: 'effect.push', question: 'Push feature/1580-plan to origin?', plan: planOf('Push feature/1580-plan to origin') } as const;
const CHANGED = planOf('Push feature/1580-plan to origin with --force');

describe(`${AC[1]} A phone's yes on a plan signs that plan's hash, and a plan changed after signing is refused, naming the hash. The merge base accepts it`, () => {
  it(`${AC[1]} the phone's yes over the plan its card showed is refused naming plan_hash once the plan changed, and the ask stays open; a yes over the card's new plan counts and binds that plan`, async () => {
    const w = await world({ channels: ['paseo'], seed: [PUSH] });
    const [ask] = w.asks;
    if (!ask?.plan) throw Error(`BLOCKED: setup: the push ask was raised without its plan: ${JSON.stringify(ask)}`);
    const allow = ask.options.find((o) => o.decision === 'allow')!.id;
    const relay = w.relays.paseo!;
    const shown = await waitFor(() => relay.latest(ask.handle), MINUTE, `${ask.handle} on the phone`);

    // The phone signs a yes over the card as it shows it; the plan changes after that, while the hub is down.
    const yes = signedAnswer(w.phone, w.hubId, shown, allow);
    let changed: { hash: string } = { hash: '' };
    const down = Date.now();
    await restart(w, async (root) => { changed = await proposeAgain(root, ask.handle, CHANGED); });
    await waitFor(() => relay.posts.find((p) => p.at > down && p.status === 200 && p.item.thread_key === ask.handle), MINUTE, `${ask.handle}'s card on the phone again once the hub is back`);

    const since = await lastPos(w);
    relay.give(yes);
    const first = await outcomeOf(w, ask.handle, since, 'the hub refusing or counting the phone\'s yes signed before the plan changed');
    const took = first.kind === 'ask.answered' ? `counted it, binding the plan ${String(first.data.plan_hash)}` : said([first]);
    expect(first.kind, `the phone's yes over the card it showed (plan ${planOn(shown)?.hash ?? 'none on the card'}) is refused once the plan changed to ${changed.hash}; the hub ${took}`).toBe('channel.refused');
    expect(first.data.field, `the refusal names the plan's hash: ${said([first])}`).toBe('plan_hash');
    await sleep(2000);
    expect(await answeredOf(w, ask.handle), 'the refused yes counted for nothing').toEqual([]);
    expect(openInNeedsYou(await inboxRow(w, ask.handle)), `${ask.handle} is still open in Needs you: ${JSON.stringify(await inboxRow(w, ask.handle))}`).toBe(true);

    // What the phone signed over: a card carrying the plan's steps and hash.
    expect(planOn(shown)?.hash, `the phone's card carried the plan's hash: ${describeItem(shown)}`).toBe(ask.plan.hash);
    expect(JSON.stringify(planOn(shown)?.steps ?? []), 'and its steps').toContain(ask.plan.steps[0]!.does);

    // The card now carries the new plan, and a yes over it counts, binding the plan it signed.
    const now = await waitFor(() => { const c = relay.latest(ask.handle); return planOn(c)?.hash === changed.hash ? c : undefined; }, MINUTE, `the phone's card carrying the new plan ${changed.hash}`)
      .catch((e: Error) => { throw Error(`${e.message}; the phone shows ${describeItem(relay.latest(ask.handle))}`); });
    const before = await lastPos(w);
    relay.give(signedAnswer(w.phone, w.hubId, now, allow));
    const second = await outcomeOf(w, ask.handle, before, 'the hub counting the phone\'s yes over the new plan');
    expect(second.kind, `the yes over the card as it is now counts: ${said([second])}`).toBe('ask.answered');
    expect(second.data.plan_hash, 'it binds the plan the phone signed').toBe(changed.hash);
  });
});
