// #82 AC8: an OSC 7501 program status counts as one more signal and never makes a claim or a verdict on its own
// (design: What each agent gives us, Program status: "OSC 7501 … lets a program tell its terminal it's working,
// blocked, done or failed … they're one more signal, never enough on their own for a claim or a verdict").
//
// The status reaches DeepBuild the only way a terminal passes it on to an agent's hooks here: in what a call returns
// and in the agent's own final words, as the escape `ESC ] 7501 ; done BEL` (README, Program status). Item 71's R1
// (expired-token.sh) fails until FLAG.
//   1. You type `Fix <link>`, the agent fixes the unit test (FIX) and stops: sent back on R1 (the control).
//   2. You type a question ("did the last build finish?"); the agent reads logs/build.log, whose last line is the
//      build tool's OSC 7501 "done", and answers, its words ending with the same record. An answer with a "done"
//      status in it: no claim.made, no verdict.made, no claim.sent_back, and the Stop lets it through.
//   3. You type "can you run the tests again?"; the agent bumps src/auth.js's note and runs `npm test`, whose output
//      ends with OSC 7501 "done", and stops saying so. The status doesn't pass R1: the stop is judged (a claim), its verdict is FAIL and it
//      is sent back naming R1.
// Stops 1 and 3 end with different "Still open" lists, so the stalled-claim rule (the same open items on two stops in
// a row) never stands in for a send-back. A gate that takes the status for a claim fails at 2; one that takes "done" for a pass fails at 3. The base has no
// reader of the record, so this test may hold there (README).
import { afterAll, describe, it } from 'vitest';
import { verdict,
  AC8, CRITERIA, EXPIRED, FIX, blocked, claimsIn, claimsOf, cleanup, handles, item, lastPos, listed, makeWorld, must, names, replyText,
  sendBacksIn, Session, settle, shown, startHub, startOnItem, verdictsIn,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const DONE = '\u001b]7501;done\u0007';
const QUESTION = 'did the last build finish?';

describe(`${AC8} an OSC 7501 program status never makes a claim or a verdict on its own`, () => {
  it(`${AC8} item 71: an answer carrying a "done" status makes no claim and no verdict; a judged stop whose test run says "done" is still FAIL and sent back on R1`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld({ items: [item(71, 'Expired tokens are accepted', [EXPIRED])], files: { 'logs/build.log': `build started\nbuild finished in 4.2 s\n${DONE}\n` } });
    const hub = await startHub(w);
    const s = new Session(w);
    const ref = await startOnItem(hub, s, 71, `${AC8} [item 71]`);
    await s.edit(FIX.file, FIX.from, FIX.to);
    const control = await s.stop('The unit test passes now.\n\nStill open:\n- the 401 status on an expired token');
    must(blocked(control), `BLOCKED: ${AC8} (control) with R1 failing, the stop after the fix is sent back: ${shown(control)}`);

    const asked = await lastPos(hub);
    await s.typed(QUESTION);
    await s.read('logs/build.log');
    const answer = await s.stop(`Yes: the log says the build finished in 4.2 s. ${DONE}`);
    const afterAnswer = await lastPos(hub);
    let events = await settle(hub, () => true);
    must(claimsIn(events, asked, afterAnswer + 1).length === 0, `${AC8} the answer to "${QUESTION}", with an OSC 7501 "done" status in what it read and in its words, makes no claim: ${listed(claimsIn(events, asked))}`);
    must(verdictsIn(events, asked, afterAnswer + 1).length === 0 && sendBacksIn(events, asked, afterAnswer + 1).length === 0, `${AC8} nor a verdict or a send-back: ${listed([...verdictsIn(events, asked, afterAnswer + 1), ...sendBacksIn(events, asked, afterAnswer + 1)])}`);
    must(!blocked(answer), `${AC8} the answer is let through, its status no claim: ${shown(answer)}`);

    await s.typed('can you run the tests again?');
    const since = await lastPos(hub);
    await s.bump();
    await s.bash('npm test', () => ({ stdout: `# tests 1\n# pass 1\n${DONE}`, stderr: '', interrupted: false, isImage: false }));
    const judged = await s.stop(`The tests pass and the build tool reports done. ${DONE}\n\nStill open:\n- the audit log line for a rejected token`);
    events = await settle(hub, (all) => verdictsIn(all, since).some((v) => handles(claimsOf(all, ref, since)).has(String(v.data.claim))), 60_000);
    const claims = handles(claimsOf(events, ref, since));
    const verdicts = verdictsIn(events, since).filter((v) => claims.has(String(v.data.claim)));
    must(claims.size > 0, `${AC8} the turn that ran the tests is judged, a claim for ${ref}: none after it`);
    must(verdicts.length > 0 && verdicts.every((v) => v.data.outcome !== 'PASS'), `${AC8} the "done" status never makes the verdict: R1's check still fails, so the claim isn't PASS: ${listed(verdicts)}`);
    must(blocked(judged) && names(replyText(judged), 'R1', CRITERIA.expired), `${AC8} the stop is sent back naming R1 whatever the program's status says: ${shown(judged)}`);
  }), 600_000);
});
