// #322 AC2: an unproven acceptance criterion keeps the PR at "Part of". The gate maps the verdict to "Closes" when every
// requirement passed, else to "Part of" with what's left (design: At the claim; Done means switched on: "An agent can't
// close an issue by hand while its definition hasn't passed"). The surface is the agent's own `gh pr create` call at
// PreToolUse, through deep-hook with the hub up: a body that says `Closes #7` while a requirement of the issue's task is
// unproven is refused, the reason naming `Part of` and the unproven requirement; the same call saying `Part of #7` is
// allowed. No forge is reached: the call's effect is nothing, and its response names no pull request.
//
// The issue, from the test work source, has two criteria: R1 is judged by the drafted check, which the agent makes
// pass; R2, the e2e test, has no check, so it can't pass. The base allows both calls.
import { afterEach, describe, it } from 'vitest';
import { AC2, FLAG, cleanup, decision, itemTask, lockedFor, makeWorld, must, replyText, Session, settle, shown, startHub } from './helpers.ts';
import { CRITERIA, WORK_LINK, workDraft, workIssue } from './work.ts';

afterEach(cleanup, 60_000);

const CLOSES = 'gh pr create --title "Reject expired tokens" --body "Closes #7"';
const PART_OF = 'gh pr create --title "Reject expired tokens" --body "Part of #7"';

describe(`${AC2} an unproven acceptance criterion keeps the PR at "Part of"`, () => {
  it(`${AC2} with R2 (${CRITERIA[1]}) unproven, gh pr create whose body says Closes #7 is refused naming Part of and R2; the same call saying Part of #7 is allowed`, async () => {
    const w = makeWorld({ drafts: [workDraft(7)], readings: [workIssue(7)] });
    const hub = await startHub(w);
    const s = new Session(w);
    await s.start();
    await s.typed(`Fix ${WORK_LINK(7)}`);
    await s.read('src/auth.js');
    const events = await settle(hub, (all) => { const ref = itemTask(all, s); return ref !== undefined && lockedFor(all, ref).length > 0; });
    const ref = itemTask(events, s);
    must(ref !== undefined && lockedFor(events, ref).length > 0, `${AC2} the session started from ${WORK_LINK(7)} must open one task with its handed definition locked: ${ref ?? 'no task'}`);
    await s.edit(FLAG.file, FLAG.from, FLAG.to);

    const closes = await s.bash(CLOSES);
    must(!closes.allowed, `${AC2} R2, "${CRITERIA[1]}", has no check and never passed, so the PR can only be Part of #7: the call \`${CLOSES}\` must be refused at PreToolUse; deep-hook allowed it: ${shown(closes.before)}`);
    const reason = replyText(closes.before);
    must(/\bPart of\b/.test(reason), `${AC2} the refusal of \`${CLOSES}\` must name Part of: ${reason.slice(0, 500)}`);
    must(/\bR2\b/.test(reason) || reason.includes(CRITERIA[1]), `${AC2} the refusal must name the unproven requirement, R2 or "${CRITERIA[1]}": ${reason.slice(0, 500)}`);

    const partOf = await s.bash(PART_OF);
    must(partOf.allowed, `${AC2} the same call saying Part of #7 is allowed (decision ${decision(partOf.before)}): ${shown(partOf.before)}`);
  }, 240_000);
});
