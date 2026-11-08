// #668's live tests on Linux (README): the macOS live file's six criteria, its checks and its planted status, on the
// platform #70 names for Linux. One real, scripted Claude Code session through the agent test harness, on your plan,
// in a copy of checkout-web, under a temporary HOME whose user settings hold one hook of your own; `deep setup`
// installs and starts the hub as the systemd user service deepbuild-hub.service of a user manager the test starts for
// itself, with its session bus and the Secret Service, and polkit's password prompt stood in for at the hub's
// confirmation seam. They spend plan usage, so they run only by hand or in the release preflight, on Linux:
//   DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> npx vitest run --root tests/acceptance/668/linux session.live.test.ts
// On another platform every test fails BLOCKED naming it; without the opt-in, the token, a `claude` on PATH or a piece
// of the Linux platform, BLOCKED naming what is missing; nothing skips.
import { existsSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, AC2, AC3, AC4, AC5, AC6, SCENARIO, TELEMETRY, afterStopProblems, besideProblems, checkout, cleanup, commitsBetween, doctorProblems, duringSession,
  failedRunProblems, isTestRun, realClaude, sessionBlock, shared, shown, statusPoller, terminal, transcriptCalls, undoProblems, unlisted, whileRunningProblems,
  type Home, type Repo, type SessionRun,
} from '../helpers.ts';
import { checkpointLinux, harnessRunLinux, linuxHome, secretStoreProblems } from './helpers.ts';
import { askedProblems, linuxTeardown, requireLinux, restated } from './platform.ts';

// The login first (its manager stopped and waited for, its mode-000 folders made removable), then the suite's cleanup, which runs either way.
afterAll(async () => { try { await linuxTeardown(); } finally { await cleanup(); } }, 180_000);

const MINUTE = 60_000;
function requireLive(id: string): string {
  requireLinux(id);
  if (process.env.DEEP_HARNESS_LIVE !== '1') throw Error(`BLOCKED: ${id} starts a real Claude Code session on your plan; run it by hand with DEEP_HARNESS_LIVE=1`);
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) throw Error(`BLOCKED: ${id} runs its session under a temporary HOME, signed in with CLAUDE_CODE_OAUTH_TOKEN (make one with \`claude setup-token\`)`);
  return token;
}

/** The real session through the harness, with `deep status` taken back to back while it runs (../session.live.test.ts's, with bash as your shell). */
const live = (token: string) => async (h: Home, repo: Repo): Promise<SessionRun> => {
  const poller = statusPoller(h);
  const { ran, line } = await harnessRunLinux(h, repo, token);
  const snaps = await poller.stop();
  const said = `${shown(ran)}; run line ${JSON.stringify(line ?? null).slice(0, 2000)}`;
  if (!line) throw Error(`BLOCKED: #668 the harness printed no run line for the ${SCENARIO} scenario: ${said}`);
  if (line.verdict === 'BLOCKED') throw Error(`BLOCKED: #668 the harness's run was BLOCKED: ${line.reason}`);
  if (line.verdict !== 'PASS') throw Error(`INCONCLUSIVE: #668 the harness's run was ${line.verdict}: ${line.reason}; ${said}`);
  if (existsSync(repo.tripwire)) throw Error(`INVALID: #668 the session ran a hook from checkout-web's own settings (${repo.tripwire}), so it didn't run on your user settings alone`);
  const transcript = String(line.transcript ?? '');
  const calls = transcriptCalls(transcript);
  const runs = calls.filter(isTestRun);
  const first = runs[0];
  const steps = calls.map((c) => `${c.name}${c.failed ? ' (failed)' : ''} ${JSON.stringify(c.input.command ?? c.input.file_path ?? '')}`).join('; ');
  if (!first || !first.failed) throw Error(`INCONCLUSIVE: #668 the session's first test run must fail for the criteria to read it; its calls: ${steps}`);
  if (!runs.slice(1).some((c) => !c.failed)) throw Error(`INCONCLUSIVE: #668 the session never ran the tests again to a pass; its calls: ${steps}`);
  if (!commitsBetween(h, repo, repo.base).length) throw Error(`INCONCLUSIVE: #668 the session made no commit in checkout-web; its calls: ${steps}`);
  return { id: String(line.sessionId), calls, first, transcript, whileRunning: snaps, terminal: [terminal(ran)] };
};
const world = shared(async () => {
  try {
    const token = requireLive('#668');
    const { h, lx } = await linuxHome('#668', realClaude());
    return await checkpointLinux('linux-live', h, lx, checkout(h), live(token), { ...TELEMETRY, CLAUDE_CODE_OAUTH_TOKEN: token });
  } catch (error) {
    throw restated(error);
  }
});

describe(`AC1 ${AC1} After \`deep setup\`, the person's own hook still runs, and DeepBuild's hook entries sit beside it in the user settings, never in the repo's`, () => {
  it(`AC1 ${AC1} (live, Linux) with the hub set up as a systemd user service, the real session runs your own PostToolUse hook for every tool call that ran, DeepBuild's entries sit beside it in your user settings, and the repo's settings are untouched`, async () => {
    requireLive(AC1);
    const w = await world();
    expect(besideProblems({ h: w.h, before: w.settingsBefore.toString('utf8'), repo: w.repoSnaps, settingsAfterSetup: w.settingsAfterSetup, session: w.session.id, calls: w.session.calls }),
      `${AC1} your hook beside DeepBuild's entries, in your user settings only`).toEqual([]);
  }, 30 * MINUTE);
});

describe(`AC2 ${AC2} While the session runs, \`deep status\` lists it under checkout-web as working; after its stop it lists its tool calls and its commit by SHA, read from the record; a status that misses the session's commit or lists one it didn't make fails this test, naming the commit`, () => {
  it(`AC2 ${AC2} (live, Linux) deep status lists the real session under checkout-web as working while it runs, and after its stop its tool calls and its commit by SHA, and not your commit made after it`, async () => {
    requireLive(AC2);
    const w = await world();
    const during = duringSession(w);
    if (!during.length) throw Error(`INCONCLUSIVE: ${AC2} no deep status ran wholly between the session's prompt and its stop (${w.session.whileRunning.length} taken): the session was too quick to read it at work`);
    expect(during.flatMap((r) => whileRunningProblems(r, w.session.id, w.sessions)), `${AC2} while the session runs`).toEqual([]);
    expect(afterStopProblems({ status: w.statusStopped, session: w.session.id, sessions: w.sessions, calls: w.session.calls, made: w.made, others: w.others, events: w.events }),
      `${AC2} after its stop, read from the record`).toEqual([]);
  }, 30 * MINUTE);

  it(`AC2 ${AC2} (live, Linux, planted status) a status that lists the real session's tool calls but not its commit fails the same check, naming the criterion and the commit`, async () => {
    requireLive(AC2);
    const w = await world();
    const block = sessionBlock(w.statusPlanted.stdout, w.session.id, w.sessions);
    expect(block, `${AC2} the planted status (DEEP_HUB_PLANT=status-omits-commit) must still list session ${w.session.id}: ${shown(w.statusPlanted)}`).toBeDefined();
    expect(unlisted(block!.lines, w.session.calls).map((c) => `${c.name} ${c.id}`), `${AC2} the planted status must list the session's tool calls as the merged status does, or it plants nothing: ${shown(w.statusPlanted)}`).toEqual([]);
    const problems = afterStopProblems({ status: w.statusPlanted, session: w.session.id, sessions: w.sessions, calls: w.session.calls, made: w.made, others: w.others, events: w.events });
    for (const c of w.made) {
      expect(problems.some((p) => p.startsWith(AC2) && p.includes(c.sha)), `${AC2} the check must fail on the planted status, naming the criterion and the commit ${c.sha}: ${JSON.stringify(problems)}`).toBe(true);
    }
  }, 30 * MINUTE);
});

describe(`AC3 ${AC3} The first test run, which fails, is recorded as a failed tool call with its error signature and shows on the session`, () => {
  it(`AC3 ${AC3} (live, Linux) the real session's failing first test run is a failed tool call in the record, with its error signature, and deep status shows it failed on the session`, async () => {
    requireLive(AC3);
    const w = await world();
    expect(failedRunProblems({ status: w.statusStopped, session: w.session.id, sessions: w.sessions, first: w.session.first, events: w.events }), `${AC3} the failed first test run`).toEqual([]);
  }, 30 * MINUTE);
});

describe(`AC4 ${AC4} \`deep doctor\` exits 0 with every item OK or "not checked"; with DeepBuild's hook entry removed by hand it names the missing installation with its exact fix and exits non-zero`, () => {
  it(`AC4 ${AC4} (live, Linux) after setup and the real session, deep doctor --prompt shows every item OK or "not checked" and exits 0, with the hub its systemd unit started reaching the Secret Service; with DeepBuild's PreToolUse entry removed by hand (the hub stopped by its unit's MainPID) it names the missing installation with the fix \`deep setup\` and exits non-zero, and that fix puts the entry back`, async () => {
    requireLive(AC4);
    const w = await world();
    if ('error' in w.removal) throw restated(w.removal.error);
    expect([...doctorProblems(w), ...secretStoreProblems(w)], `${AC4} the doctor after setup and the session, then with DeepBuild's entry removed by hand`).toEqual([]);
  }, 30 * MINUTE);
});

describe(`AC5 ${AC5} \`deep off\` makes the next hook reply watch-only within a second, and \`deep on\` brings the gates back`, () => {
  it(`AC5 ${AC5} (live, Linux) after the real session, deep off, once polkit confirms you, lets your gated call through from a hook started within a second, and deep on, once polkit confirms you, denies it again`, async () => {
    requireLive(AC5);
    const w = await world();
    if ('error' in w.offOn) throw restated(w.offOn.error);
    expect([...w.offOn.problems, ...askedProblems(AC5, w.asks.offOn, ['deep off', 'deep on'])], `${AC5} deep off and deep on: ${w.offOn.proof}`).toEqual([]);
  }, 30 * MINUTE);
});

describe(`AC6 ${AC6} \`deep setup --undo\` leaves the Claude Code user settings byte for byte as they were before setup`, () => {
  it(`AC6 ${AC6} (live, Linux) after a real session on your user settings, deep setup --undo, once polkit confirms you, leaves them byte for byte as before setup`, async () => {
    requireLive(AC6);
    const w = await world();
    expect([...undoProblems(w.h, w.settingsBefore, w.undo), ...askedProblems(AC6, w.asks.undo, ['deep setup --undo'])], `${AC6} your user settings after undo`).toEqual([]);
  }, 30 * MINUTE);
});
