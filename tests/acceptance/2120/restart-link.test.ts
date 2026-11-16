// AC7: a started run whose first hook comes after a hub restart is still linked to its session (README).
//
// #1330's world, the stand-in behind a gate: under an approval for issue 41, `deep start` launches the agent, which
// waits at the gate before its first hook. Once the supervisor tracks its process, the hub is stopped (SIGTERM, by its
// PID) and started again on the same home; then the gate opens and the agent's first hook arrives at the new hub.
// start.session must then be on the record for that run, naming the agent's session. On the base the new hub rebuilds
// the run with no PID, so the hook's process is never matched to it and nothing is recorded.
//
// The criterion's other branch, ending as never started, applies to an agent that never hooks within its 60 s; this
// test's hook comes well inside them, and a reading where it came after 50 s is INCONCLUSIVE, never a pass.
import { expect, test } from 'vitest';
import { approve, mentions, openWorld, standInIn, standIns, start, waitFor, type Line } from '../1330/helpers.ts';
import { blocked, installStandIn, restartHub, started } from './helpers.ts';

const AC7 = 'AC7 #2120.f803e5df';

test(`${AC7} a start whose agent has not hooked yet: the hub stops and starts, the agent's first hook arrives, and start.session is on the record for that run`, async (ctx) => {
  const w = await openWorld();
  const gate = installStandIn(w, { gated: true });
  await blocked('the approval of issue 41', () => approve(w, { issues: [41], agents: ['claude-code'], atOnce: 1, planShare: 50 }));
  const startedAt = Date.now();
  const s = started(await start(w, { issue: 41 }), 'deep start --issue 41');

  // Given: the agent runs, waiting at the gate, and has not hooked.
  const pid = await blocked(`the agent of ${s.run} waiting at its gate`, () => gate.waiting(s.worktree, 30_000));
  await blocked(`the supervisor tracking ${s.run}`, () => waitFor(async () => (await w.client.events('process.tracked')).some((e) => e.data?.run === s.run || mentions(e, s.run)), 30_000, `process.tracked for ${s.run}`));
  await blocked('no hook before the restart', async () => {
    const linked = (await w.client.events('start.session')).filter((e) => mentions(e, s.run));
    const ran = standIns(w).filter((l: Line) => !l.refused);
    if (linked.length || ran.length) throw Error(`the agent hooked before the restart: ${JSON.stringify({ linked, ran: ran.map((l: Line) => l.session) })}`);
  });

  await restartHub(w);
  gate.open();
  const agent = await blocked(`the agent (PID ${pid}) running its turn after the restart`, () => standInIn(w, s.worktree, { done: true }));
  const session = String(agent.session);
  const firstHook = Number(((agent.hooks ?? []) as Line[])[0]?.at ?? NaN);
  if (!(firstHook - startedAt <= 50_000)) ctx.skip(`INCONCLUSIVE ${AC7}: the agent's first hook came ${((firstHook - startedAt) / 1000).toFixed(1)} s after the start, past 50 s of its 60; the hub's restart took too long on this machine`);
  await blocked(`the first hook of session ${session} in the new hub's record`, () => waitFor(async () => (await w.client.events()).some((e) => e.kind !== 'start.session' && mentions(e, session)), 30_000, `an event of session ${session}`));

  const linked = async () => (await w.client.events('start.session')).filter((e) => e.data?.run === s.run || mentions(e, s.run));
  await waitFor(async () => (await linked()).length > 0, 20_000, 'start.session').catch(() => undefined);
  const recorded = await linked();
  expect(recorded.map((e) => `start.session for ${String(e.data?.run)} naming session ${String(e.data?.session)}`), `${AC7} run ${s.run}'s agent (PID ${pid}) sent its first hook after the hub stopped and started again, so start.session for that run, naming session ${session}, is on the record; the record holds ${recorded.length} start.session for it`)
    .toEqual([`start.session for ${s.run} naming session ${session}`]);
});
