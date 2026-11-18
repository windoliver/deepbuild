// The suite held against itself, with no reader under test: node tests/acceptance/2698/selfcheck.mjs [ac1 ac2 ac3 ac4].
// It runs each criterion's fixture once, read by the clean twin (planted/twin.mjs) and by that criterion's planted
// reader, and prints how the criterion's assertions judge each. The twin must pass, or read BLOCKED or INCONCLUSIVE
// for what the run couldn't show; the planted reader must fail, naming what its criterion says. It tells a mistake in
// the suite from one in the reader, and it is no test: nothing here proves a criterion.
import { collectAc1, collectAc2, collectAc3, collectAc4, judgeAc1, judgeAc2, judgeAc3, judgeAc4 } from './criteria.mjs';
import { planted, unproven } from './support.mjs';
import { reader } from './surface.mjs';

const CRITERIA = {
  ac1: { collect: collectAc1, judge: judgeAc1, wrong: 'ps-backed.mjs', naming: /wakeups/ },
  ac2: { collect: collectAc2, judge: judgeAc2, wrong: 'resident-memory.mjs', naming: /footprint: .* bytes/ },
  ac3: { collect: collectAc3, judge: judgeAc3, wrong: 'parent-only.mjs', naming: /the kept child \d+/ },
  ac4: { collect: collectAc4, judge: judgeAc4, wrong: 'returns-zero.mjs', naming: /total\.\w+.* gives 0/ },
};

let bad = 0;
for (const criterion of process.argv.length > 2 ? process.argv.slice(2) : Object.keys(CRITERIA)) {
  const { collect, judge, wrong, naming } = CRITERIA[criterion];
  const twin = await reader(planted('twin.mjs'), 'the clean twin'), plant = await reader(planted(wrong), `the planted ${wrong}`);
  let data;
  try {
    data = await collect([twin, plant], (line) => console.log(`  ${criterion}: ${line}`));
  } catch (error) {
    console.log(`${criterion}: ${unproven(error) ? error.message : `the fixture run failed: ${error.stack}`}`);
    if (!unproven(error)) bad++;
    continue;
  }
  for (const [each, expectFailure] of [[twin, false], [plant, true]]) {
    let failure;
    try { judge(data, each.name); } catch (error) { failure = error; }
    const ok = unproven(failure) || (expectFailure ? Boolean(failure) && naming.test(failure.message) : !failure);
    if (!ok) bad++;
    console.log(`${criterion}: ${each.name}: ${failure ? failure.message : 'passes'}${ok ? '' : `  <-- the suite is wrong here: ${expectFailure ? `it must fail, naming ${naming}` : 'it must pass'}`}`);
  }
}
process.exit(bad ? 1 : 0);
