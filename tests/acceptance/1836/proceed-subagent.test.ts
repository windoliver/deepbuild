// #1836: a subagent's stop ends no turn a proceed started. One Claude Code session through the real deep-hook and
// `deep hub run`: you type a prompt, the agent works and ends its turn on "want me to run the tests?", which #321's
// planted sorter answers "proceed" (recorded as question.proceeded). In the turn that proceed starts, the agent runs a
// foreground subagent: its Agent call, the subagent's SubagentStop (under the parent's session_id, with agent_id), the
// Agent call's PostToolUse. Then it calls `gh pr merge 12`. The merge must be held at PreToolUse with one authority ask
// whose question names the proceed, and calling it again before you answer raises no second ask. A hub whose
// proceed-turn query counts a child's stop (DEEP_HUB_PLANT=proceed-ends-at-child-stop, README: The plant) lets the
// merge through and fails this test, naming the call.
import { afterEach, describe, it } from 'vitest';
import {
  AC, PLANT, asksNaming, bash, cleanup, expectProceed, failureOf, handleOf, lastPos, makeWorld, must, newSession, notRun,
  sessionStart, sleep, startHub, stopHub, subagent, tag, typed, verdict, work, writeSorter, type Ev, type Hub, type Pending,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const MERGE = 'gh pr merge 12';
const QUESTION = 'want me to run the tests?';
const CHILD = 'a5f8e7f484d9d1308';

/** Within 90 s of the call, an ask raised after `since` names it, while no run of the call has gone through. */
async function heldBy(hub: Hub, p: Pending, since: number, who: string): Promise<Ev> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    await notRun(hub, p, MERGE, who);
    const [ask] = await asksNaming(hub, since, MERGE);
    if (ask) return ask;
    if (Date.now() > deadline) {
      const how = p.result ? 'deep-hook ended it denied with no ask' : 'deep-hook is still waiting';
      throw Error(`${who} \`${MERGE}\` must be held with an authority ask naming it: no ask names it 90 s after the call; ${how}`);
    }
    await sleep(250);
  }
}

async function scenario(plant?: string): Promise<void> {
  const who = `${AC}`;
  const w = makeWorld();
  const rule = `planted-proceed-${tag()}`;
  const hub = await startHub(w, { plant, sorter: writeSorter(w, rule, [QUESTION]) });
  try {
    const s = newSession(w);
    await sessionStart(s);
    await typed(s, 'Fix the login bug in src/login.ts.');
    await work(s);
    await expectProceed(hub, s, QUESTION, rule, who);
    // The turn the proceed starts: a subagent runs the tests and stops; then the agent merges.
    await subagent(hub, s, CHILD);
    const since = await lastPos(hub);
    const first = bash(s, MERGE);
    const ask = await heldBy(hub, first, since, who);
    must(ask.data.kind === 'authority', `${who} the hold of \`${MERGE}\` must be an authority ask: ${handleOf(ask)} was filed as ${String(ask.data.kind)}`);
    const question = String(ask.data.question ?? '');
    must(/proceed/i.test(question) && question.includes(QUESTION), `${who} the authority ask holding \`${MERGE}\` must name the proceed whose turn it is in ("${QUESTION}"): ${handleOf(ask)} asks "${question}"`);
    // The agent calls the merge again before you answer: it isn't let through, and no second ask is raised.
    const again = bash(s, MERGE);
    await sleep(5000);
    await notRun(hub, first, MERGE, who);
    await notRun(hub, again, MERGE, who);
    const asks = await asksNaming(hub, since, MERGE);
    must(asks.length === 1, `${who} one authority ask holds \`${MERGE}\`, called twice: ${asks.length} asks name it: ${asks.map(handleOf).join(', ')}`);
  } finally {
    await stopHub(hub);
  }
}

describe(`${AC} a subagent's stop ends no turn a proceed started: the merge after it is held with one authority ask`, () => {
  it(`${AC} in the turn a proceed started, after a Claude Code subagent's stop, \`${MERGE}\` is held at PreToolUse with one authority ask naming the proceed`, async (ctx) => {
    await verdict(ctx, () => scenario());
  }, 600_000);

  it(`${AC} (wrong program) a hub whose proceed-turn query counts a child's stop (DEEP_HUB_PLANT=${PLANT}) lets the merge run and fails this test, naming the call`, async (ctx) => {
    await verdict(ctx, async () => {
      const why = await failureOf(() => scenario(PLANT));
      must(why !== null, `${AC} the planted hub ${PLANT} must fail this test; it passed`);
      must(why.includes(MERGE), `${AC} the planted hub ${PLANT} must fail this test naming the call \`${MERGE}\`; it failed with: ${why}`);
    });
  }, 600_000);
});
