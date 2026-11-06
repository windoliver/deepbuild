// #1156's fast tests: no Claude Code session and no spend. The whole checkpoint in order, on a temporary home with
// stand-ins only for what this repo doesn't own (launchd, the `claude` binary, Claude Code running its settings'
// hooks): `deep setup`, the checkout-web fixture with a local bare remote, a trusted project extension, a stack with
// one credential, the record padded with 1,000,000 events after the trust decision, and a made-up session whose hooks
// go through the user settings into the real deep-hook and hub while its commands run for real. Each criterion's check
// is the one the live file runs on a real session. The seven wrong programs the issue's Proof names run here too: each
// must fail its criterion's check, naming what the issue says it names.
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, AC2, AC3, AC4, AC5, AC6, AC7, CLEAN, COMPUTED, EXTENSION, MIRROR, NESTED, byValueProblems, checkpoint, cleanup, exitZeroProblems, fastSession, matcherProblems, oldReaderProblems,
  perCallTrustProblems, problemsOf, replayProblems, reportOf, shared, stagerProblems, stepsOf, type Step,
} from './helpers.ts';

afterAll(cleanup, 120_000);

const MINUTE = 60_000;
const world = shared(() => checkpoint(fastSession));

describe(`AC1 ${AC1} Both unreadable pushes are denied with the hub up and with it stopped by PID; the reply names what couldn't be read and says writing it plainly lets it be read, and the remote's \`main\` is unchanged. deep-hook from before #1097 lets a push through and fails this test, naming the call`, () => {
  it(`AC1 ${AC1} \`${COMPUTED}\` and the same push nested 13 deep are denied with the hub up and stopped by PID, each reply naming what couldn't be read and that writing it plainly lets it be read, and origin's main doesn't move`, async () => {
    expect(problemsOf(stepsOf(await world()), AC1), `${AC1} the unreadable pushes`).toEqual([]);
  }, 30 * MINUTE);

  it(`AC1 ${AC1} (wrong program) deep-hook from before #1097 lets a push through and fails this check, naming the call`, async () => {
    const w = await world();
    const problems = await oldReaderProblems(w);
    expect(problems.some((p) => p.startsWith(AC1) && (p.includes(COMPUTED) || p.includes(NESTED)) && /let through/.test(p)), `${AC1} the old reader must fail, naming the call: ${JSON.stringify(problems)}`).toBe(true);
    expect(problemsOf(stepsOf(w), AC1), `${AC1} the same check passes on this deep-hook`).toEqual([]);
  }, 30 * MINUTE);
});

describe(`AC2 ${AC2} Before \`clean.sh\` runs, a \`command.staged\` row names \`out/\`, and \`deep undo staged:<id>\` then puts back all 200 files with the same hashes; \`npm test\` is neither staged nor asked about. A planted stager that runs the script without a copy fails, naming the command`, () => {
  it(`AC2 ${AC2} before clean.sh runs a command.staged row names out/, deep undo puts back all 200 files with their hashes, and npm test is neither staged nor asked about`, async () => {
    expect(problemsOf(stepsOf(await world()), AC2), `${AC2} clean.sh and npm test`).toEqual([]);
  }, 30 * MINUTE);

  it(`AC2 ${AC2} (wrong program) a stager that runs the script without a copy fails this check, naming the command`, async () => {
    const w = await world();
    const problems = await stagerProblems(w);
    expect(problems.some((p) => p.startsWith(AC2) && p.includes(CLEAN)), `${AC2} the copy-less stager must fail, naming \`${CLEAN}\`: ${JSON.stringify(problems)}`).toBe(true);
    expect(problemsOf(stepsOf(w), AC2), `${AC2} the same check passes on this stager`).toEqual([]);
  }, 30 * MINUTE);
});

describe(`AC3 ${AC3} \`git push origin main\` is held at PreToolUse with one authority ask whose \`plan.proposed\` row lists each step, what it changes, its undo or "can't undo", and its cost, and whose target reads origin \`repo\`. The README's URL reads \`read\`, citing the README's handle, and its card offers no wider scope. A matcher that reads every target as \`repo\` fails, naming the URL`, () => {
  it(`AC3 ${AC3} the push is held by one authority ask with its plan, origin reads repo, the README's URL reads read citing the README's handle, and its card offers no wider scope`, async () => {
    expect(problemsOf(stepsOf(await world()), AC3), `${AC3} the held pushes`).toEqual([]);
  }, 30 * MINUTE);

  it(`AC3 ${AC3} (wrong program) a matcher that reads every target as repo fails this check, naming the URL`, async () => {
    const w = await world();
    const problems = await matcherProblems(w);
    expect(problems.some((p) => p.startsWith(AC3) && p.includes(MIRROR)), `${AC3} the all-repo matcher must fail, naming ${MIRROR}: ${JSON.stringify(problems)}`).toBe(true);
    expect(problemsOf(stepsOf(w), AC3), `${AC3} the same check passes on this matcher`).toEqual([]);
  }, 30 * MINUTE);
});

describe(`AC4 ${AC4} \`deep inbox answer\` with allow, signed by the test helper over the hub's challenge, runs the push once and the remote's \`main\` equals the session's commit. A helper replaced by an exit-0 script, or a signature captured for an earlier ask, is refused naming the path or the ask, and the ask stays open`, () => {
  it(`AC4 ${AC4} deep inbox answer with allow, signed over the hub's challenge, runs the push once and origin's main equals the session's commit`, async () => {
    expect(problemsOf(stepsOf(await world()), AC4), `${AC4} the signed yes`).toEqual([]);
  }, 30 * MINUTE);

  it(`AC4 ${AC4} (wrong program) a helper replaced by an exit-0 script is refused naming the path, and the ask stays open`, async () => {
    const w = await world();
    expect(exitZeroProblems(w.answers, w.h.helper), `${AC4} the exit-0 helper`).toEqual([]);
  }, 30 * MINUTE);

  it(`AC4 ${AC4} (wrong program) a signature captured for an earlier ask is refused naming the ask, and the ask stays open`, async () => {
    expect(replayProblems((await world()).answers), `${AC4} the replayed signature`).toEqual([]);
  }, 30 * MINUTE);
});

describe(`AC5 ${AC5} After \`deep env up\`, the app's environment holds a stand-in and its sample API call gets 200; the value is in none of the transcript, record, evidence or checkout, searched raw, base64, reversed and XOR'd. A planted environment that loads by value fails, naming the evidence file`, () => {
  it(`AC5 ${AC5} the app holds a stand-in, its call to the sample API gets 200, and the value is in none of the transcript, record, evidence or checkout, in any of the forms searched`, async () => {
    expect(problemsOf(stepsOf(await world()), AC5), `${AC5} the stack's credential`).toEqual([]);
  }, 30 * MINUTE);

  it(`AC5 ${AC5} (wrong program) an environment that loads by value fails this check, naming the evidence file`, async () => {
    const w = await world();
    const problems = await byValueProblems(w);
    expect(problems.some((p) => p.startsWith(AC5) && p.includes(join(w.h.root, 'evidence'))), `${AC5} the by-value environment must fail, naming an evidence file under ${join(w.h.root, 'evidence')}: ${JSON.stringify(problems)}`).toBe(true);
    expect(problemsOf(stepsOf(w), AC5), `${AC5} the same check passes on this environment`).toEqual([]);
  }, 30 * MINUTE);
});

describe(`AC6 ${AC6} The \`vendor/\` edit is denied by the project extension inside the 500 ms hook deadline, and the trust check adds under 1 ms at p95 across the session's calls. A planted host that reads trust from the record per call drops the deny and fails, naming the extension`, () => {
  it(`AC6 ${AC6} the edit under vendor/ is denied by the project extension inside the 500 ms deadline, and the trust check adds under 1 ms at p95 across the session's calls, 1,000,000 events after the trust decision`, async () => {
    expect(problemsOf(stepsOf(await world()), AC6), `${AC6} the project extension`).toEqual([]);
  }, 30 * MINUTE);

  it(`AC6 ${AC6} (wrong program) a host that reads trust from the record per call drops the deny and fails this check, naming the extension`, async () => {
    const w = await world();
    const problems = await perCallTrustProblems(w);
    expect(problems.some((p) => p.startsWith(AC6) && p.includes(EXTENSION)), `${AC6} the per-call trust reader must fail, naming ${EXTENSION}: ${JSON.stringify(problems)}`).toBe(true);
    expect(problemsOf(stepsOf(w), AC6), `${AC6} the same check passes on this host`).toEqual([]);
  }, 30 * MINUTE);
});

describe(`AC7 ${AC7} A step whose hook reply or record row is missing reads INCONCLUSIVE in the run's report, never PASS`, () => {
  it(`AC7 ${AC7} the run's report reads PASS on every step of the session, and with any step's hook reply or record rows taken away that step reads INCONCLUSIVE and the report never PASS`, async () => {
    const steps = stepsOf(await world());
    const report = reportOf(steps);
    expect(report.steps.filter((s) => s.verdict !== 'PASS'), `${AC7} every step of the run, with its reply and rows, reads PASS`).toEqual([]);
    for (const [at, s] of steps.entries()) {
      const cases: [string, Step][] = [['hook reply', { ...s, reply: null }], ['record row', { ...s, rows: [] }]];
      for (const [what, gone] of cases) {
        const without = reportOf(steps.map((other, i) => (i === at ? gone : other)));
        expect(without.steps[at]!.verdict, `${AC7} "${s.step}" with its ${what} missing`).toBe('INCONCLUSIVE');
        expect(without.verdict, `${AC7} the run's report with the ${what} of "${s.step}" missing`).toBe('INCONCLUSIVE');
      }
    }
  }, 30 * MINUTE);
});
