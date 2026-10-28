// #321 AC5: on the virtual clock, the held push, the held merge, and the new `delete_repo` and `post_update` tools
// each take no at the 1-day authority deadline, and the call never runs. In the turn a planted sorter's proceed
// starts (as in AC1), `git push origin main` and `gh pr merge 12` are held; a server update of `forge` adds delete_repo
// and post_update (readOnlyHint: true), each held. Nobody answers. The hub's clock is set only at its start
// (DEEP_HUB_TEST_CLOCK), so the test stops the hub by PID once every held run has ended, and starts it again with its
// clock 20 s before the earliest deadline; it then reads only the record while the deadlines pass. Each hold's ask must
// take its default, no (ask.defaulted, decision deny, at or after its deadline), and none of the calls, held or sent
// again after the no, may run. A hold filed as a choice whose recommended option approves
// (DEEP_HUB_PLANT=hold-as-choice) fails this test, naming the source (the ask.sources@1 row each hold comes from).
import { afterEach, describe, it } from 'vitest';
import {
  AC5, DAY, FakeServer, PUSH_Q, allEvents, bash, cleanup, decision, expectHeld, expectProceed, failureOf, handleOf, hubNow,
  lastPos, makeWorld, mcpCall, must, newSession, shown, sleep, startCall, startHub, startRecorded, stopHub, tag, tool,
  typed, verdict, work, writeSorter, type Held,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const PUSH = 'git push origin main';
const MERGE = 'gh pr merge 12';

async function scenario(plant?: string): Promise<void> {
  const who = `AC5 ${AC5}`;
  const w = makeWorld();
  const rule = `planted-proceed-${tag()}`;
  const sorter = writeSorter(w, rule, [PUSH_Q]);
  const V1 = [tool('list_issues', { readOnlyHint: true })];
  const forge = FakeServer.install(w, 'forge', 'user', V1);
  let hub = await startHub(w, { plant, sorter });
  try {
    const s1 = newSession(w);
    await startRecorded(w, hub, s1, [forge], who);
    forge.update([...V1, tool('delete_repo'), tool('post_update', { readOnlyHint: true })], '1.1.0');
    const since = await lastPos(hub);
    const s = newSession(w);
    await startRecorded(w, hub, s, [forge], who);
    await typed(w, s, 'Ship the login fix and tidy the forge.');
    await work(w, s);
    await expectProceed(w, hub, s, PUSH_Q, rule, who);
    // The turn the proceed starts: four calls that need authority, each held.
    const holds: Held[] = [
      await expectHeld(w, hub, s, bash(PUSH), { who: `${who} [effect.push]`, names: [PUSH], since }),
      await expectHeld(w, hub, s, bash(MERGE), { who: `${who} [effect.merge]`, names: [MERGE], since }),
      await expectHeld(w, hub, s, mcpCall(forge, 'delete_repo'), { who: `${who} [mcp.tool_changed]`, names: ['forge', 'delete_repo'], since, server: forge }),
      await expectHeld(w, hub, s, mcpCall(forge, 'post_update'), { who: `${who} [mcp.tool_changed]`, names: ['forge', 'post_update'], since, server: forge }),
    ];
    for (const h of holds) {
      const deadline = Number(h.ask.data.deadline);
      must(Math.abs(deadline - (h.ask.ts + DAY)) <= 60_000, `${h.who} ${handleOf(h.ask)}, the hold of \`${h.label}\`, must wait the 1-day authority deadline: raised at ${new Date(h.ask.ts).toISOString()}, its deadline is ${Number.isFinite(deadline) ? new Date(deadline).toISOString() : String(h.ask.data.deadline)}`);
    }
    // Every held run ends, none let through, before the hub stops: a hook waiting on a stopped hub would fail open.
    for (const h of holds) {
      for (const p of h.pendings) {
        const r = await p.done;
        must(!r.timedOut, `${h.who} deep-hook's PreToolUse for \`${h.label}\` still waited ${(r.ms / 1000).toFixed(0)} s: Claude Code ends a PreToolUse hook at its timeout and runs the call`);
        must(decision(r) !== 'allow', `${h.who} \`${h.label}\` ran with nobody answering: deep-hook allowed it at PreToolUse (${shown(r)})`);
      }
    }
    const asks = [...new Map(holds.map((h) => [h.ask.id, h.ask])).values()];
    const first = Math.min(...asks.map((a) => Number(a.data.deadline)));
    const last = Math.max(...asks.map((a) => Number(a.data.deadline)));
    await stopHub(hub);
    hub = await startHub(w, { plant, sorter, clock: first - 20_000 });
    // Only the record is read while the deadlines pass: nothing that could close an overdue ask on the way.
    while (hubNow(hub) < last + 15_000) await sleep(1000);
    const events = await allEvents(hub);
    for (const h of holds) {
      const closing = events.filter((e) => e.subject === handleOf(h.ask) && /^ask\.(answered|defaulted|escalated|cancelled|superseded|moot)$/.test(e.kind));
      must(closing.length > 0, `${h.who} ${handleOf(h.ask)}, the hold of \`${h.label}\`, must take no at its 1-day deadline: it is still open ${((hubNow(hub) - Number(h.ask.data.deadline)) / 1000).toFixed(0)} s past it`);
      const defaulted = closing.find((e) => e.kind === 'ask.defaulted');
      must(defaulted !== undefined && defaulted.data.decision === 'deny', `${h.who} ${handleOf(h.ask)}, the hold of \`${h.label}\`, must take no at its 1-day deadline (ask.defaulted, decision deny); it closed with ${closing.map((e) => `${e.kind} ${JSON.stringify(e.data)}`).join('; ')}`);
      must(defaulted.ts >= Number(h.ask.data.deadline), `${h.who} ${handleOf(h.ask)} took its default at ${new Date(defaulted.ts).toISOString()}, before its deadline ${new Date(Number(h.ask.data.deadline)).toISOString()}`);
    }
    // The call never runs: sent again in the same turn after the no, none is let through, and the server is never called.
    const again = holds.map((h) => ({ h, p: startCall(w, s, h.call, h.server) }));
    for (const { h, p } of again) {
      const r = await p.done;
      must(!r.timedOut, `${h.who} deep-hook's PreToolUse for \`${h.label}\`, sent again after the no, still waited ${(r.ms / 1000).toFixed(0)} s`);
      must(decision(r) !== 'allow', `${h.who} the call never runs: \`${h.label}\`, sent again after ${handleOf(h.ask)} took no, was allowed (${shown(r)})`);
    }
    for (const name of ['delete_repo', 'post_update']) {
      must(forge.calls(name) === 0, `${who} [mcp.tool_changed] the call never runs: the fake server forge received ${forge.calls(name)} tools/call request(s) for ${name}`);
    }
  } finally {
    await stopHub(hub);
  }
}

describe(`AC5 ${AC5} on the virtual clock, each hold takes no at the 1-day authority deadline and its call never runs`, () => {
  it(`AC5 ${PUSH}, ${MERGE}, and forge's new delete_repo and post_update, held with nobody answering: each ask takes no at its 1-day deadline and no call runs`, async (ctx) => {
    await verdict(ctx, () => scenario());
  }, 1_200_000);

  it('AC5 (wrong program) a hold filed as a choice whose recommended option approves (DEEP_HUB_PLANT=hold-as-choice) fails this test, naming the source', async (ctx) => {
    await verdict(ctx, async () => {
      const why = await failureOf(() => scenario('hold-as-choice'));
      must(why !== null, `${AC5} the planted hold-as-choice must fail this test; it passed`);
      must(/\[(effect\.push|effect\.merge|mcp\.tool_changed)\]/.test(why), `${AC5} the planted hold-as-choice must fail this test naming the source (effect.push, effect.merge or mcp.tool_changed); it failed with: ${why}`);
    });
  }, 1_200_000);
});
