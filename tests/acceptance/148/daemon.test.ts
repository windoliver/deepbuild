// AC16 #148.9536f2a1: With one Codex daemon serving two sessions and a sync landing after the daemon started, both
// sessions' rows say the daemon started before the sync until their own evidence shows the new set; restarting it is
// one authority ask naming both sessions, and nothing signals the daemon; a host that runs the restart without your
// answer fails this test, naming the daemon; on the pinned Codex version, whether a running daemon picks up a changed
// `hooks.json` and `[mcp_servers]` is recorded in Codex's facts with the version.
//
// The daemon is a process of its own whose command line reads as Codex's app-server, and both sessions' hooks run as its
// children through the real deep-hook (README: Sessions). It records every catchable signal it gets. The `codex` on the
// login PATH runs the real Codex for everything but `codex app-server daemon ...`, which it records and doesn't run
// (fixtures/stub.mjs), so a restart is seen and nothing real restarts. A row is the session's in `status.read`, as
// `deep status` shows it; a row "says the daemon started before the sync" with a reading that names the daemon's PID.
// The restart is asked for with `agents.restart` (the Agents page's Restart for Codex); the ask may also be raised by the
// sync itself, but there is one. A session's own evidence of the new set is its SessionStart (`resume`) from a daemon
// started after the sync.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AC, CodexSession, Proc, alive, answer, approve, call, events, factsOf, failsNaming, failureOf, gitRepo, installed, makeWorld, parse, propose, readingsOf, rowOf, shown, sleep, startHub,
  stdioServer, tag, useCleanup, waitFor, type Ev, type Line, type World,
} from './helpers.ts';

useCleanup();
const restarts = (w: World): Line[] => readFileSync(w.restarts, 'utf8').split('\n').flatMap((l) => (parse(l) ? [parse(l)!] : []));
const namesSession = (e: Ev, s: CodexSession): boolean => { const t = JSON.stringify(e.data); return t.includes(s.id) || t.includes(s.id.replace(/-/g, '')); };
const staleOn = async (w: World, s: CodexSession, daemon: Proc): Promise<boolean> => readingsOf(await rowOf(w, s.id)).some((r) => r.includes(String(daemon.pid)));

async function oneDaemonTwoSessions(plant?: string): Promise<void> {
  const w = await makeWorld({ codexRestartRecorded: true });
  await startHub(w, { plant });
  const daemon = Proc.start(w, 'codex-daemon');
  const s1 = new CodexSession(w, gitRepo(w, `api-${tag()}`, { 'README.md': 'api\n' }).dir, daemon);
  const s2 = new CodexSession(w, gitRepo(w, `web-${tag()}`, { 'README.md': 'web\n' }).dir, daemon);
  await s1.start();
  await s2.start();
  await sleep(1500);
  const since = Math.max(0, ...(await events(w)).map((e) => e.log_pos));
  await approve(w, await propose(w, { via: 'app', server: stdioServer(w, `forge-${tag()}`), agents: ['codex'] }));

  // Both rows say the daemon started before the sync.
  await waitFor(async () => (await staleOn(w, s1, daemon)) && (await staleOn(w, s2, daemon)), 60_000, `both sessions' rows to name Codex's daemon (pid ${daemon.pid}) as started before the sync`);

  // The restart: one authority ask naming both sessions, and nothing runs until your answer.
  await call(w, 'agents.restart', { agent: 'codex' });
  const asks = await waitFor(async () => { const a = (await events(w)).filter((e) => e.kind === 'ask.created' && e.log_pos > since && namesSession(e, s1) && namesSession(e, s2)); return a.length ? a : undefined; }, 30_000, 'an ask naming both sessions');
  await sleep(3000);
  const early = restarts(w);
  expect(early, `Codex's daemon (pid ${daemon.pid}) is restarted only after your answer, and it ran before: ${shown(early)}`).toEqual([]);
  const all = (await events(w)).filter((e) => e.kind === 'ask.created' && e.log_pos > since && namesSession(e, s1) && namesSession(e, s2));
  expect(all.length, `restarting Codex's daemon is one ask naming both sessions: ${shown(all.map((e) => e.data))}`).toBe(1);
  const ask = asks[0]!;
  expect(ask.data.kind, 'the restart is an authority ask').toBe('authority');
  const yes = ((ask.data.options ?? []) as Line[]).find((o) => o.decision === 'allow');
  expect(yes, `the ask has a yes (decision allow): ${shown(ask.data.options)}`).toBeDefined();
  await answer(w, ask.id, String(yes!.id));
  await waitFor(() => (restarts(w).length ? restarts(w) : undefined), 30_000, 'the restart after your yes');
  await sleep(2000);
  const restart = factsOf('codex').daemon?.restart as unknown;
  expect(Array.isArray(restart), `Codex's facts name its restart command, daemon.restart: ${shown(factsOf('codex').daemon)}`).toBe(true);
  expect(restarts(w).map((r) => r.args), 'the restart runs once, through Codex\'s own restart command as its facts name it').toEqual([restart]);
  expect(daemon.signalled(), `nothing signals Codex's daemon (pid ${daemon.pid})`).toEqual([]);
  expect(alive(daemon.pid), `Codex's daemon (pid ${daemon.pid}) still runs: nothing stopped it`).toBe(true);

  // Until its own evidence shows the new set: s1 comes back from a daemon started after the sync; s2 hasn't.
  const after = Proc.start(w, 'codex-daemon');
  s1.daemon = after;
  await s1.start('resume');
  await waitFor(async () => !(await staleOn(w, s1, daemon)), 60_000, `session ${s1.id}'s row to stop naming the old daemon once its own SessionStart shows the new set`);
  expect(await staleOn(w, s2, daemon), `session ${s2.id}'s row still says the daemon (pid ${daemon.pid}) started before the sync`).toBe(true);

  // The facts record, for the pinned Codex, whether a running daemon picks up hooks.json and [mcp_servers].
  const version = installed.codex!;
  const picks = (factsOf('codex').daemon?.picksUp ?? {})[version] as Line | undefined;
  expect(typeof picks?.['hooks.json'], `Codex's facts record for ${version} whether a running daemon picks up a changed hooks.json: ${shown(factsOf('codex').daemon)}`).toBe('boolean');
  expect(typeof picks?.mcp_servers, `Codex's facts record for ${version} whether a running daemon picks up changed [mcp_servers]`).toBe('boolean');
}

describe('#148 Codex\'s shared daemon', () => {
  it(`${AC[16]} one daemon, two sessions, a sync after it started: both rows say so until their own evidence shows the new set, the restart is one authority ask naming both, nothing signals it, and the facts record what the pinned version picks up`, () => oneDaemonTwoSessions());
  it(`${AC[16]} twin: a host that runs the restart without your answer fails the check, naming the daemon`, async () => {
    const failure = await failureOf(() => oneDaemonTwoSessions('restarts-without-answer'));
    failsNaming(failure, 'Codex\'s daemon (pid ', 'DEEP_HUB_PLANT=restarts-without-answer');
    expect(failure!, 'it fails where the restart ran before your answer').toMatch(/restarted only after your answer/);
  });
});
