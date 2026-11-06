// #84, the check before a task reaches you (design: Could the agent do it?, Tasks only you can do): LEASED, ONE_TAP and
// OWNER. Every session works on an item whose R1 fails, so its stop is a real hand-back, not a done.
import { afterAll, afterEach, describe, it } from 'vitest';
import {
  LEASED, ONE_TAP, OWNER, answered, asksIn, asksOf, cleanup, item, lastPos, listed, makeWorld, must, namesWord, needsYou, optionMatching, optionsOf, reachedYou, replyText,
  said, Session, settle, shown, startHub, startOnItem, verdict, wentBack, type Ev, type Hub, type World,
} from './helpers.ts';

afterEach(cleanup, 60_000);
afterAll(cleanup, 60_000);

/** A session on item n that did a round of work and is about to stop. */
async function working(w: World, hub: Hub, n: number, who: string): Promise<Session> {
  const s = new Session(w);
  await startOnItem(hub, s, n, who);
  await s.bump();
  return s;
}

describe(`${LEASED} a "please sign in" task whose browser profile is leased goes back to the agent`, () => {
  it(`${LEASED} GitHub's profile is leased: the task goes back naming it, and nothing reaches you; GitLab's isn't leased: that task reaches you`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld({
      items: [item(801), item(802)],
      reach: { profiles: [{ profile: 'github-work', provider: 'github', leased: true }, { profile: 'gitlab-work', provider: 'gitlab', leased: false }] },
    });
    const hub = await startHub(w);
    const leased = await working(w, hub, 801, LEASED);
    const since = await lastPos(hub);
    const stop = await leased.stop('unblock: please sign in to GitHub so I can finish the check.');
    await wentBack(hub, leased, stop, since, 'github-work', `${LEASED} (a leased profile)`);

    // The twin: a hub that sends every sign-in back with whatever it knows fails here.
    const free = await working(w, hub, 802, LEASED);
    const before = await lastPos(hub);
    const twin = await free.stop('unblock: please sign in to GitLab so I can finish the check.');
    await reachedYou(hub, free, before, `${LEASED} (a profile you didn't lease)`);
    must(!namesWord(replyText(twin), 'gitlab-work'), `${LEASED} a profile you didn't lease is no tool to use: ${replyText(twin).slice(0, 400)}`);
  }), 600_000);
});

/** The option that says the agent can do it, on a task as raised. */
function agentOption(task: Ev, who: string): { id: string; label: string } {
  const option = optionMatching(task, /the agent can do it/i);
  must(option !== undefined, `${who} the task must offer "the agent can do it": its options are ${JSON.stringify(optionsOf(task))}; ${said(task)}`);
  return option;
}

describe(`${ONE_TAP} every task only you can do that reaches you can be answered "the agent can do it" in one tap, which sends it back with the tools the check found`, () => {
  it(`${ONE_TAP} a task from a stop, one from deep_ask and one from a revoked sign-in each offer it; the one tap sends the first two back naming gh, the tool the check found`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld({ items: [item(811), item(812), item(813)], reach: { tools: [{ name: 'gh', kind: 'cli', provider: 'github', signed_in: true }] } });
    const hub = await startHub(w);

    // From a stop, with the waiter beside it: your tap wakes the session, or waits for its next stop.
    const fromStop = await working(w, hub, 811, ONE_TAP);
    const since1 = await lastPos(hub);
    const { waiter } = await fromStop.stopWaiting('unblock: accept the model license on the vendor site so the weights can download.', 90_000);
    const task1 = await reachedYou(hub, fromStop, since1, `${ONE_TAP} (from a stop)`);

    // From deep_ask, its call still waiting.
    const fromAsk = await working(w, hub, 812, ONE_TAP);
    const since2 = await lastPos(hub);
    const call = fromAsk.deepAsk({ kind: 'unblock', question: 'Plug in the hardware key', steps: ['Plug in the hardware key'], where: 'at your desk', why: 'the signing step needs it', check: 'unit' });
    const task2 = await reachedYou(hub, fromAsk, since2, `${ONE_TAP} (from deep_ask)`);

    // From a stop's block: Claude Code's StopFailure for a revoked sign-in, which the hub raises as a task of its own.
    const fromBlock = await working(w, hub, 813, ONE_TAP);
    const since3 = await lastPos(hub);
    await fromBlock.hook('StopFailure', { error: 'authentication_failed' });
    const events = await settle(hub, (all) => asksIn(all, since3).some((a) => a.data.kind === 'unblock'));
    const task3 = asksIn(events, since3).find((a) => a.data.kind === 'unblock');
    must(task3 !== undefined, `BLOCKED: ${ONE_TAP} a revoked sign-in raises a task, as #85 made it: ${listed(asksIn(events, since3))}`);
    agentOption(task3, `${ONE_TAP} (from a revoked sign-in)`);

    await answered(w, task1, agentOption(task1, `${ONE_TAP} (from a stop)`).id, ONE_TAP);
    const woken = await waiter;
    const back1 = `${woken.stderr}\n${replyText(await fromStop.stop('I looked at the license page again.'))}`;
    must(namesWord(back1, 'gh'), `${ONE_TAP} (from a stop) your tap sends the task back with the tools the check found, gh; the agent heard: ${back1.slice(0, 500)}`);

    await answered(w, task2, agentOption(task2, `${ONE_TAP} (from deep_ask)`).id, ONE_TAP);
    const returned = await call;
    const back2 = `${JSON.stringify(returned.value)}\n${replyText(await fromAsk.stop('I went back to the key.'))}`;
    must(namesWord(back2, 'gh'), `${ONE_TAP} (from deep_ask) your tap sends the task back with the tools the check found, gh; the agent heard: ${back2.slice(0, 500)}`);

    const open = (await needsYou(hub)).map((r) => String(r.ask));
    must(!open.includes(`ask:${task1.id}`) && !open.includes(`ask:${task2.id}`), `${ONE_TAP} one tap closes the task: Needs you still lists ${open.join(', ')}`);
  }), 600_000);
});

describe(`${OWNER} a step handed to a repo's owner when you or the agent already have access goes back to the agent, and an option that needs a tool the agent lacks never reaches you`, () => {
  it(`${OWNER} a step for the owner of a repo the agent can write, or you can, goes back naming gh; one for a repo neither can touch still comes to you`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld({
      items: [item(821), item(822), item(823)],
      reach: {
        tools: [{ name: 'gh', kind: 'cli', provider: 'github', signed_in: true }],
        access: [{ repo: 'acme/shop', who: 'agent', via: 'gh' }, { repo: 'acme/wiki', who: 'you', via: 'gh' }],
      },
    });
    const hub = await startHub(w);
    const agentHas = await working(w, hub, 821, OWNER);
    const since1 = await lastPos(hub);
    await wentBack(hub, agentHas, await agentHas.stop('unblock: the owner of acme/shop has to add the ready label to the pull request.'), since1, 'gh', `${OWNER} (the agent has access)`);

    const youHave = await working(w, hub, 822, OWNER);
    const since2 = await lastPos(hub);
    await wentBack(hub, youHave, await youHave.stop('unblock: the owner of acme/wiki has to turn on the issues tab.'), since2, 'gh', `${OWNER} (you have access)`);

    // The twin: nobody here has access, so the step leaves through you, as a drafted request or a task.
    const nobody = await working(w, hub, 823, OWNER);
    const since3 = await lastPos(hub);
    const twin = await nobody.stop('unblock: the owner of acme/infra has to rotate the deploy key.');
    const events = await settle(hub, (all) => asksIn(all, since3).length > 0);
    must(asksIn(events, since3).length > 0, `${OWNER} a step nobody here has access to still comes to you, as a request for its owner or a task: nothing did; the stop: ${shown(twin)}`);
  }), 600_000);

  it(`${OWNER} a deep_ask choice with an option that writes through the read-only notion connector reaches you without that option`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld({ items: [item(824)], reach: { tools: [{ name: 'mcp__notion__search', kind: 'mcp', connector: 'notion', read_only: true }] } });
    const hub = await startHub(w);
    const s = await working(w, hub, 824, OWNER);
    const since = await lastPos(hub);
    // Left running: a provisional choice returns at once, and either way the call has no part in this reading.
    void s.deepAsk({
      kind: 'choice', question: 'Where should the release notes go?', recommended: 'docs',
      options: [{ id: 'docs', label: 'A file under docs/' }, { id: 'wiki', label: 'A page in the repo wiki' }, { id: 'notion', label: 'Write them to Notion through the notion connector' }],
    }).catch(() => undefined);
    const events = await settle(hub, (all) => asksOf(all, s, since).some((a) => a.data.kind === 'choice'));
    const ask = asksOf(events, s, since).find((a) => a.data.kind === 'choice');
    must(ask !== undefined, `${OWNER} the choice reaches you with the options left: ${listed(asksOf(events, s, since))}`);
    const offered = optionsOf(ask).map((o) => `${o.id} ${o.label}`).join('; ');
    must(!/notion/i.test(offered), `${OWNER} an option that needs a tool the agent lacks, a write through the read-only notion connector, is struck: the card offers ${offered}`);
    must(optionMatching(ask, /docs/i) !== undefined && optionMatching(ask, /wiki/i) !== undefined, `${OWNER} only that option is struck: the card offers ${offered}`);
  }), 600_000);
});
