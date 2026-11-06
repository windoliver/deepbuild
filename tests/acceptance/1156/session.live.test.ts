// #1156's live tests: one real, scripted Claude Code session through the agent test harness, on your plan, in
// checkout-web, under a temporary HOME whose user settings hold DeepBuild's entries after `deep setup`. The session
// follows SESSION.md (helpers.ts, `sessionScript`), the issue's script in order; you answer its asks at your terminal
// while it runs. Each criterion's check is the fast file's. They spend plan usage, so they run only by hand or in the
// local preflight on the reference Mac, on your own sign-in, with a long-lived token:
//   DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> npx vitest run --root tests/acceptance/1156 session.live.test.ts
// Without the opt-in, the token or a covered `claude` on PATH, every test fails with BLOCKED in its message; nothing
// skips. A session that didn't make the script's calls fails as INCONCLUSIVE.
import { afterAll, describe, expect, it } from 'vitest';
import { AC1, AC2, AC3, AC4, AC5, AC6, AC7, checkpoint, cleanup, liveSession, problemsOf, realClaude, reportOf, shared, stepsOf } from './helpers.ts';

afterAll(cleanup, 120_000);

const MINUTE = 60_000;
function requireLive(id: string): string {
  if (process.env.DEEP_HARNESS_LIVE !== '1') throw Error(`${id} BLOCKED: this test starts a real Claude Code session on your plan; run it by hand with DEEP_HARNESS_LIVE=1`);
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) throw Error(`${id} BLOCKED: the live session runs under a temporary HOME and signs in with CLAUDE_CODE_OAUTH_TOKEN (make one with \`claude setup-token\`)`);
  return token;
}
const world = shared(() => checkpoint(liveSession(requireLive('#1156')), { claude: realClaude() }));

const CRITERIA: [string, string, string][] = [
  ['AC1', AC1, 'both unreadable pushes are denied with the hub up and stopped by PID, each reply naming what couldn\'t be read, and origin\'s main doesn\'t move'],
  ['AC2', AC2, 'before clean.sh runs a command.staged row names out/, deep undo puts back all 200 files, and npm test is neither staged nor asked about'],
  ['AC3', AC3, 'the push is held by one authority ask with its plan, origin reads repo, the README\'s URL reads read citing the README\'s handle, and its card offers no wider scope'],
  ['AC4', AC4, 'your signed yes runs the push once and origin\'s main equals the session\'s commit, after an exit-0 helper and a replayed signature were refused'],
  ['AC5', AC5, 'the app holds a stand-in, its sample API call gets 200, and the value is nowhere searched'],
  ['AC6', AC6, 'the edit under vendor/ is denied by the project extension, and the trust check adds under 1 ms at p95'],
];
describe('#1156 a real Claude Code session\'s risky calls stopped before they run', () => {
  for (const [name, id, words] of CRITERIA) {
    it(`${name} ${id} (live) ${words}`, async () => {
      requireLive(id);
      expect(problemsOf(stepsOf(await world()), id), `${id} the real session`).toEqual([]);
    }, 60 * MINUTE);
  }

  it(`AC7 ${AC7} (live) every step of the real session reads PASS in the run's report, each with its hook reply and record row`, async () => {
    requireLive(AC7);
    const report = reportOf(stepsOf(await world()));
    expect(report.steps.filter((s) => s.verdict !== 'PASS'), `${AC7} the run's report`).toEqual([]);
  }, 60 * MINUTE);
});
