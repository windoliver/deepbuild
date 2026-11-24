// Criterion 3 of #3262 (#3262.693f8038), on the suites' scenarios: "Every reply equals the reply of a fresh hub that
// plays every kept call, on the scenarios #806's, #393's, #384's, #1415's and #2694's suites play and on #3222's
// 16-session script. A planted canvas side that keeps its hub across a world change that ended a session fails, naming
// the first call whose reply differs"
//
// Each scenario goes to a canvas side of its own (`deep-show canvas`) as the lines a hub sends, and every reply is
// compared, whole, with the reply of a new hub (`deep-show run`) that plays every kept call before it in the world as
// it then is (side.mjs `compare`, judge.mjs; README: Criterion 3). The scenarios are in scenarios.ts: #393's and
// #384's as #806's suite plays them, #806's two figures where one session then ends, #1415's two and #2694's three.
// #3222's 16-session script is in ac3-script.test.mjs. The planted side is twins/keeps-hub-when-session-ends.
// Run: node node_modules/vitest/vitest.mjs run tests/acceptance/3262/ac3-suites.test.ts --testTimeout=1200000
import { AssertionError } from 'node:assert';
import { beforeAll, describe, it } from 'vitest';
import { putPng } from '../393/helpers.ts';
import { TRANSCRIPTS } from './scenarios.ts';
import { compare, showBinary } from './side.mjs';

const AC3 = 'AC3 #3262.693f8038';
/** One test's own limit: the proof lanes stop a run at 20 minutes. */
const TIMEOUT = 18 * 60_000;

describe('AC3 #3262.693f8038 every reply equals the reply of a fresh hub that plays every kept call, on the scenarios the suites play', () => {
  beforeAll(() => { showBinary(); }, TIMEOUT);

  it('AC3 #3262.693f8038 on the scenarios #806\'s, #393\'s, #384\'s, #1415\'s and #2694\'s suites play, and where a session ends, every reply of the canvas side equals a fresh hub\'s', async () => {
    const differences: string[] = [];
    let calls = 0;
    for (const t of TRANSCRIPTS) {
      const run = await compare(t.name, async (side) => {
        for (const png of t.assets) for (const store of [side.evidence, side.fresh]) await putPng(store, png);
        await t.feed(side);
      });
      calls += run.calls;
      console.log(`${AC3} ${t.name}: ${run.calls} calls, ${run.kept} kept, ${run.scenarios} fresh hubs, outcomes ${JSON.stringify(run.outcomes)}${run.difference ? `: ${run.difference.text}` : ''}`);
      if (run.difference) differences.push(`on ${t.name}, ${run.difference.text}`);
    }
    if (calls < TRANSCRIPTS.length) throw Error(`BLOCKED: ${calls} calls were played over ${TRANSCRIPTS.length} scenarios`);
    if (differences.length) throw new AssertionError({ message: `${AC3}: ${differences.join('\n')}`, actual: differences.length, expected: 0, operator: '==' });
  }, TIMEOUT);
});
