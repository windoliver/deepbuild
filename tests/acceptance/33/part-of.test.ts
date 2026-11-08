// #33 AC5: until drafting lands, each task here takes its definition of done from its issue's acceptance criteria: a
// change that passes the bootstrap's commands but leaves one criterion unproven stays "Part of"; a gate that judges
// only the bootstrap's commands says "Closes" and fails this test.
//
// The world is AC4's (helpers.ts, bootstrapWorld): a bootstrap done.yaml with `test` and `typecheck`, no drafted spec,
// no handed definition; the session starts from work item acme/shop#5, whose one acceptance criterion no check proves
// (no test is tagged with its ID). The agent's change makes the test pass with the types intact, and stops: both
// bootstrap commands run and pass, and the claim doesn't PASS. Then the agent's `gh pr create … "Closes #5"` is
// refused at PreToolUse, naming Part of and the unproven criterion (R1, its text, or its ID `#5.<hash>`), and the same
// call saying "Part of #5" is allowed. The wrong program `bootstrap-commands-only` (DEEP_HUB_PLANT) judges the
// bootstrap's commands alone, so it lets "Closes" through; the scenario must fail on it.
import { createHash } from 'node:crypto';
import { afterEach, describe, it } from 'vitest';
import {
  AC5, CRITERION, PRICE_BASE, PRICE_FIXED, Session, bootstrapWorld, cleanup, decision, failureOf, itemLink, itemTask, lockedFor, must, replyText, runsOf, settle,
  shown, startHub, taskVerdicts, verdict, verdictText,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const PLANT = 'bootstrap-commands-only';
const ID = `#5.${createHash('sha256').update(CRITERION.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
const CLOSES = 'gh pr create --title "Fix the cart total" --body "Closes #5"';
const PART_OF = 'gh pr create --title "Fix the cart total" --body "Part of #5"';

async function staysPartOf(plant?: string): Promise<void> {
  const w = bootstrapWorld(5);
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  await s.start();
  await s.typed(`Fix ${itemLink(5)}`);
  await s.read('src/price.ts');
  let events = await settle(hub, (all) => { const t = itemTask(all, s); return t !== undefined && lockedFor(all, t).length > 0; }, 120_000);
  const task = itemTask(events, s);
  must(task !== undefined && lockedFor(events, task).length > 0, `${AC5} the session started from ${itemLink(5)} opens one task whose definition locks from the item's criterion: ${task ?? 'no task'}`);
  await s.edit('src/price.ts', PRICE_BASE, PRICE_FIXED);
  const since = events.length ? events[events.length - 1]!.log_pos : 0;
  await s.stop('Fixed the total. Done.');
  events = await settle(hub, (all) => taskVerdicts(all, task!, since).some((v) => v.data.outcome !== 'pending'), 180_000);
  const runs = runsOf(events, task!, since);
  for (const name of ['test', 'typecheck']) {
    const mine = runs.filter((r) => String(r.started.data.check) === name || String(r.started.data.check).includes(name));
    must(mine.some((r) => r.finished?.data.outcome === 'passed'), `${AC5} the change passes the bootstrap's ${name} command: its runs ended ${JSON.stringify(mine.map((r) => r.finished?.data.outcome ?? 'running'))}`);
  }
  const verdicts = taskVerdicts(events, task!, since);
  must(!verdicts.some((v) => v.data.outcome === 'PASS'), `${AC5} the criterion is unproven, so the claim doesn't PASS: ${verdicts.map(verdictText).join(' | ').slice(0, 600)}`);

  const closes = await s.bash(CLOSES);
  must(!closes.allowed, `${AC5} the criterion "${CRITERION}" is unproven, so the change stays Part of #5: \`${CLOSES}\` must be refused; deep-hook allowed it: ${shown(closes.before)}`);
  const reason = replyText(closes.before);
  must(/\bPart of\b/.test(reason), `${AC5} the refusal names Part of: ${reason.slice(0, 600)}`);
  must(/\bR1\b/.test(reason) || reason.includes(CRITERION) || reason.includes(ID), `${AC5} the refusal names the unproven criterion (R1, its text or ${ID}): ${reason.slice(0, 600)}`);
  const partOf = await s.bash(PART_OF);
  must(partOf.allowed, `${AC5} the same call saying Part of #5 is allowed (decision ${decision(partOf.before)}): ${shown(partOf.before)}`);
}

describe(`${AC5} until drafting lands, a change that passes the bootstrap's commands but leaves a criterion unproven stays "Part of"`, () => {
  it(`${AC5} test and typecheck pass, the item's criterion is unproven: Closes #5 refused naming Part of and the criterion; Part of #5 allowed`, async (ctx) => {
    await verdict(ctx, () => staysPartOf());
  }, 600_000);

  it(`${AC5} (wrong program) a gate that judges only the bootstrap's commands (DEEP_HUB_PLANT=${PLANT}) says Closes and fails the scenario`, async () => {
    const failure = await failureOf(() => staysPartOf(PLANT));
    must(failure !== null, `${AC5} the planted gate that judges only the bootstrap's commands passed the scenario; it must let "Closes" through and fail it`);
    must(failure!.startsWith(AC5), `${AC5} the planted gate fails at one of the scenario's assertions: ${failure}`);
  }, 600_000);
});
