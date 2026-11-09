// #1156's live checkpoint on Linux (README): one real, scripted Claude Code session through the agent test harness, on
// your plan, in checkout-web, under a temporary HOME, after `deep setup` installed the hub as a systemd user service
// (of the test's own user manager). Every criterion is read as ../session.live.test.ts reads it, by ../helpers.ts;
// AC4's yes counts once polkit confirms you, stood in at its boundary, in place of the signed deep-confirm. The issue's
// wrong programs run here too, on the same world, since this folder has no fast file. It spends plan usage:
//   DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> npx vitest run --root tests/acceptance/1156/linux session.live.test.ts
// Off Linux, without the opt-in, the token, or anything the README lists, every test fails with BLOCKED; nothing skips.
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, AC2, AC3, AC4, AC5, AC6, AC7, CLEAN, COMPUTED, EXTENSION, MIRROR, NESTED, byValueProblems, matcherProblems, oldReaderProblems, perCallTrustProblems, problemsOf, realClaude,
  reportOf, shared, stagerProblems, type Step,
} from '../helpers.ts';
import { checkpoint, cleanupLinux, linuxSteps, needLinux, peerCheckProblems, PEER_CHECK, refusalProblems, serviceStop, type LinuxWorld } from './helpers.ts';

afterAll(cleanupLinux, 120_000);

const MINUTE = 60_000;
function requireLive(id: string): string {
  needLinux(id);
  if (process.env.DEEP_HARNESS_LIVE !== '1') throw Error(`BLOCKED: ${id} starts a real Claude Code session on your plan; run it by hand with DEEP_HARNESS_LIVE=1`);
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) throw Error(`BLOCKED: ${id} signs the session in with CLAUDE_CODE_OAUTH_TOKEN under a temporary HOME (make one with \`claude setup-token\`)`);
  return token;
}
const world = shared(() => checkpoint(requireLive('#1156'), realClaude()));
/** A wrong program runs on the finished world with the service's hub stopped: each starts the hub it plants. */
const stopped = async (id: string): Promise<LinuxWorld> => { requireLive(id); const w = await world(); await serviceStop(w.h); return w; };
const passes = (w: LinuxWorld, id: string) => expect(problemsOf(linuxSteps(w), id), `${id} the same check passes on the real program`).toEqual([]);

describe('#1156 on Linux: a real Claude Code session\'s risky calls stopped before they run', () => {
  it(`AC1 ${AC1} (live, Linux) both unreadable pushes are denied with the service's hub up and stopped by PID, each reply naming what couldn't be read and that writing it plainly lets it be read, and origin's main doesn't move`, async () => {
    requireLive(AC1);
    expect(problemsOf(linuxSteps(await world()), AC1), `${AC1} the unreadable pushes`).toEqual([]);
  }, 60 * MINUTE);

  it(`AC1 ${AC1} (wrong program, Linux) deep-hook from before #1097 lets a push through and fails this check, naming the call`, async () => {
    const w = await stopped(AC1);
    const problems = await oldReaderProblems(w);
    expect(problems.some((p) => p.startsWith(AC1) && (p.includes(COMPUTED) || p.includes(NESTED)) && /let through/.test(p)), `${AC1} the old reader must fail, naming the call: ${JSON.stringify(problems)}`).toBe(true);
    passes(w, AC1);
  }, 60 * MINUTE);

  it(`AC2 ${AC2} (live, Linux) before clean.sh runs a command.staged row names out/, deep undo puts back all 200 files with their hashes from a copy-on-write copy, and npm test is neither staged nor asked about`, async () => {
    requireLive(AC2);
    expect(problemsOf(linuxSteps(await world()), AC2), `${AC2} clean.sh and npm test`).toEqual([]);
  }, 60 * MINUTE);

  it(`AC2 ${AC2} (wrong program, Linux) a stager that runs the script without a copy fails this check, naming the command`, async () => {
    const w = await stopped(AC2);
    const problems = await stagerProblems(w);
    expect(problems.some((p) => p.startsWith(AC2) && p.includes(CLEAN)), `${AC2} the copy-less stager must fail, naming \`${CLEAN}\`: ${JSON.stringify(problems)}`).toBe(true);
    passes(w, AC2);
  }, 60 * MINUTE);

  it(`AC3 ${AC3} (live, Linux) the push is held by one authority ask with its plan, origin reads repo, the README's URL reads read citing the README's handle, and its card offers no wider scope`, async () => {
    requireLive(AC3);
    expect(problemsOf(linuxSteps(await world()), AC3), `${AC3} the held pushes`).toEqual([]);
  }, 60 * MINUTE);

  it(`AC3 ${AC3} (wrong program, Linux) a matcher that reads every target as repo fails this check, naming the URL`, async () => {
    const w = await stopped(AC3);
    const problems = await matcherProblems(w);
    expect(problems.some((p) => p.startsWith(AC3) && p.includes(MIRROR)), `${AC3} the all-repo matcher must fail, naming ${MIRROR}: ${JSON.stringify(problems)}`).toBe(true);
    passes(w, AC3);
  }, 60 * MINUTE);

  it(`AC4 ${AC4} (live, Linux) deep inbox answer with allow, once polkit confirms you, runs the push once and origin's main equals the session's commit`, async () => {
    requireLive(AC4);
    expect(problemsOf(linuxSteps(await world()), AC4), `${AC4} the confirmed yes`).toEqual([]);
  }, 60 * MINUTE);

  it(`AC4 ${AC4} (live, Linux) an answer polkit didn't confirm, its prompt cancelled, or one after polkit confirmed you for the earlier ask, is refused naming the ask, and the ask stays open`, async () => {
    requireLive(AC4);
    expect(refusalProblems(await world()), `${AC4} the unconfirmed answers`).toEqual([]);
  }, 60 * MINUTE);

  it(`AC4 ${AC4} (wrong program, Linux) a CLI that counts the answer because the peer check found no agent above it (${PEER_CHECK}) fails this check, naming the ask`, async () => {
    const w = await stopped(AC4);
    const problems = await peerCheckProblems(w);
    expect(problems.some((p) => p.startsWith(AC4) && /ask:\S+ approve/.test(p) && /exit 3/.test(p)), `${AC4} the peer-check CLI must fail, naming the ask: ${JSON.stringify(problems)}`).toBe(true);
    expect(refusalProblems(w), `${AC4} the same check passes on the real program`).toEqual([]);
  }, 60 * MINUTE);

  it(`AC5 ${AC5} (live, Linux) the app holds a stand-in, its sample API call gets 200, and the value is in none of the transcript, record, evidence or checkout, in any of the forms searched`, async () => {
    requireLive(AC5);
    expect(problemsOf(linuxSteps(await world()), AC5), `${AC5} the stack's credential`).toEqual([]);
  }, 60 * MINUTE);

  it(`AC5 ${AC5} (wrong program, Linux) an environment that loads by value fails this check, naming the evidence file`, async () => {
    const w = await stopped(AC5);
    const problems = await byValueProblems(w);
    expect(problems.some((p) => p.startsWith(AC5) && p.includes(join(w.h.root, 'evidence'))), `${AC5} the by-value environment must fail, naming an evidence file: ${JSON.stringify(problems)}`).toBe(true);
    passes(w, AC5);
  }, 60 * MINUTE);

  it(`AC6 ${AC6} (live, Linux) the edit under vendor/ is denied by the project extension inside the 500 ms deadline, and the trust check adds under 1 ms at p95 across the session's calls`, async () => {
    requireLive(AC6);
    expect(problemsOf(linuxSteps(await world()), AC6), `${AC6} the project extension`).toEqual([]);
  }, 60 * MINUTE);

  it(`AC6 ${AC6} (wrong program, Linux) a host that reads trust from the record per call drops the deny and fails this check, naming the extension`, async () => {
    const w = await stopped(AC6);
    const problems = await perCallTrustProblems(w);
    expect(problems.some((p) => p.startsWith(AC6) && p.includes(EXTENSION)), `${AC6} the per-call trust reader must fail, naming ${EXTENSION}: ${JSON.stringify(problems)}`).toBe(true);
    passes(w, AC6);
  }, 60 * MINUTE);

  it(`AC7 ${AC7} (live, Linux) every step of the real session reads PASS in the run's report, and with a step's hook reply or record rows taken away that step reads INCONCLUSIVE and the report never PASS`, async () => {
    requireLive(AC7);
    const steps = linuxSteps(await world());
    expect(reportOf(steps).steps.filter((s) => s.verdict !== 'PASS'), `${AC7} the run's report`).toEqual([]);
    for (const [at, s] of steps.entries()) {
      for (const [what, gone] of [['hook reply', { ...s, reply: null }], ['record row', { ...s, rows: [] }]] as [string, Step][]) {
        const without = reportOf(steps.map((other, i) => (i === at ? gone : other)));
        expect(without.steps[at]!.verdict, `${AC7} "${s.step}" with its ${what} missing`).toBe('INCONCLUSIVE');
        expect(without.verdict, `${AC7} the run's report with the ${what} of "${s.step}" missing`).toBe('INCONCLUSIVE');
      }
    }
  }, 60 * MINUTE);
});
