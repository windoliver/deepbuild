import test from 'node:test';
import { AC, must } from './common.mjs';
import { hashesMovedFromRecording, keptFixturesAndGoldens, namesStepOf, allHashesReached, mergeBaseRecording } from './goldens.mjs';
import { openLogic } from './logic.mjs';

const BASE_RUNNER_THAT_CHANGES_STEP_37 = 'replay_changes_step_37';

async function hashesReachedUnderPlantedRunners(all, planted) {
  const logic = openLogic(planted);
  try {
    return await allHashesReached(logic, all);
  } finally {
    await logic.close();
  }
}

test(`AC2 ${AC[2]} every fixture of #531 and every kept logic golden reaches the step hashes it reached on the merge base, and a hash that moves fails, naming the golden and the step`, { timeout: 12 * 60_000 }, async (t) => {
  const base = mergeBaseRecording();
  const all = keptFixturesAndGoldens();
  const now = await hashesReachedUnderPlantedRunners(all, []);
  const count = (of) => Object.values(now).reduce((n, items) => n + Object.values(items).reduce((m, item) => m + of(item), 0), 0);
  t.diagnostic(`${Object.keys(now.fixtures).length} fixtures of #531 and ${all.length - 1} kept goldens: ${count((item) => item.steps.length)} steps, ${count((item) => item.steps.filter((hash) => hash !== null).length)} of them with a hash (a failed item's step has none), and ${count((item) => item.checkpoints.length)} checkpoints read`);
  const problems = hashesMovedFromRecording(all, base, now);
  must(problems.length === 0, `AC2 ${AC[2]}: ${problems.length} ${problems.length === 1 ? 'hash differs' : 'hashes differ'} from the merge base's (${base.commit.slice(0, 9)}, tests/acceptance/3529/base.json):\n  ${problems.slice(0, 24).join('\n  ')}`);

  const caught = hashesMovedFromRecording(all, base, await hashesReachedUnderPlantedRunners(all, [BASE_RUNNER_THAT_CHANGES_STEP_37]));
  const missed = all.filter((one) => !caught.some((problem) => namesStepOf(problem, one, 37)));
  must(missed.length === 0, `AC2 ${AC[2]}: the judge passed a logic module whose step 37 changes one value (deep-logic --planted ${BASE_RUNNER_THAT_CHANGES_STEP_37}) on ${missed.map((one) => one.name).join(' and ')}: it names ${caught.length ? `only\n  ${caught.slice(0, 12).join('\n  ')}` : 'no hash that moved'}`);
  t.diagnostic(`the control fails as it must, naming step 37 of each: ${caught.filter((problem) => all.some((one) => namesStepOf(problem, one, 37))).join('; ')}`);
});
