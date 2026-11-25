// Criterion 3 of #3262 (#3262.693f8038), on #3222's 16-session script: "Every reply equals the reply of a fresh hub
// that plays every kept call, on the scenarios #806's, #393's, #384's, #1415's and #2694's suites play and on #3222's
// 16-session script. A planted canvas side that keeps its hub across a world change that ended a session fails, naming
// the first call whose reply differs"
//
// One canvas side (`deep-show canvas`) is sent the script's 224 calls as its hub sends them (script.mjs), each
// session ending once it has made its last call, and every reply is compared, whole, with the reply of a new hub
// (`deep-show run`) that plays every kept call before it in the world as it then is (side.mjs `compare`, judge.mjs).
// The suites' scenarios are in ac3-suites.test.ts. The planted side is twins/keeps-hub-when-session-ends.
// Run: node --test tests/acceptance/3262/ac3-script.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { AC } from './judge.mjs';
import { playScript } from './script.mjs';
import { compare, showBinary } from './side.mjs';

const SESSIONS = 16;

test('AC3 #3262.693f8038 on #3222\'s 16-session script, every reply of the canvas side equals the reply of a fresh hub that plays every kept call', { timeout: 30 * 60_000 }, async (t) => {
  showBinary();
  let played;
  const run = await compare(`#3222's ${SESSIONS}-session script`, async ({ send }) => { played = await playScript(SESSIONS, send); });
  // The script was played: its calls of each of the five kinds went out, were answered, and did what such calls do.
  const { sent, ended } = played;
  const kinds = ['revision', 'patch', 'check', 'render_back_2d', 'render_back_3d'];
  if (kinds.some((k) => !sent[k]) || ended !== SESSIONS) throw Error(`BLOCKED: the script wasn't played whole: it sent ${JSON.stringify(sent)} and ended ${ended} sessions`);
  if (!run.outcomes.presented || !run.outcomes.applied) throw Error(`BLOCKED: no revision of the script was presented or no patch applied (the side's replies' outcomes: ${JSON.stringify(run.outcomes)}), so the replies compared aren't the script's`);
  t.diagnostic(`${run.calls} calls played (${JSON.stringify(sent)}, and a read after each session's end), ${run.kept} of them kept; ${run.scenarios} fresh hubs; outcomes ${JSON.stringify(run.outcomes)}`);
  assert.ok(run.difference === null, `AC3 ${AC[3]}: on #3222's ${SESSIONS}-session script, ${run.difference?.text}`);
});
