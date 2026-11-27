// Criterion 2 of #3612 (#3612.0873686d): "Every fixture of every shipped pack reaches the step hashes and the
// `logic.determinism` verdict it reached on the merge base. A hash that moves fails, naming the fixture and the step"
//
// `deep-logic` checks each shipped pack as the canvas core asks (`pack_check`), then bakes the piece of every fixture
// a shipped library runs, as that check makes it, and holds it to logic.determinism as the check does. What it
// answers is compared with the merge base's own answers to the same lines, kept in base.json (README: The
// recording): each fixture's verdict and full-state hashes at the pack's check, each planted library's first failed
// fixture, each kit twin's rules, and each library fixture's hash at every step, its checkpoints and its
// logic.determinism verdict. The first difference of each fixture is named with its step.
// Run: node --test tests/acceptance/3612/ac2-fixtures.test.mjs
import test from 'node:test';
import { AC, must } from './common.mjs';
import { judgeFixtures, logicPacks, openLogic, readFixtures, recording } from './logic.mjs';

test(`AC2 ${AC[2]} every fixture of every shipped pack reaches the step hashes and the logic.determinism verdict it reached on the merge base`, { timeout: 10 * 60_000 }, async (t) => {
  const base = recording();
  const packs = logicPacks();
  const logic = openLogic();
  let now;
  try {
    now = await readFixtures(logic, packs);
  } finally {
    await logic.close();
  }
  const runs = Object.values(now).reduce((n, pack) => n + pack.runs.length, 0);
  const steps = Object.values(now).reduce((n, pack) => n + pack.runs.reduce((m, run) => m + (run.hashes?.length ?? 0), 0), 0);
  t.diagnostic(`${packs.length} packs' checks, ${runs} library fixtures' pieces, ${steps} step hashes read`);
  const problems = judgeFixtures(packs, base.fixtures, now);
  must(problems.length === 0, `AC2 ${AC[2]}: ${problems.length} ${problems.length === 1 ? 'reading differs' : 'readings differ'} from the merge base's (${base.commit.slice(0, 9)}, tests/acceptance/3612/base.json):\n  ${problems.slice(0, 24).join('\n  ')}`);
});
