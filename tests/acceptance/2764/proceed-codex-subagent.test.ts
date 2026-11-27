import { afterEach, describe, it } from 'vitest';
import {
  AC, PLANT, asksNaming, bash, cleanup, expectProceed, failureOf, handleOf, lastPos, makeWorld, must, newSession, notRun,
  sessionStart, sleep, startHub, stopHub, subagentPrompt, tag, typed, verdict, work, writeSorter, type Ev, type Hub, type Pending,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const DELETE = 'gh release delete v1.2.0 --yes';
const QUESTION = 'want me to clean up the old releases?';
const CHILD = '019a8f3e-5c2d-7b41-9e60-2764c0de5ab1';
const CHILD_PROMPT = 'List the releases older than v1.3.0 and report their tags.';

async function heldBy(hub: Hub, p: Pending, since: number, who: string): Promise<Ev> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    await notRun(hub, p, DELETE, who);
    const [ask] = await asksNaming(hub, since, DELETE);
    if (ask) return ask;
    if (Date.now() > deadline) {
      const how = p.result ? 'deep-hook ended it denied with no ask' : 'deep-hook is still waiting';
      throw Error(`${who} \`${DELETE}\` must be held with an authority ask naming it: no ask names it 90 s after the call; ${how}`);
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
    await subagentPrompt(hub, s, CHILD, CHILD_PROMPT);
    const since = await lastPos(hub);
    const first = bash(s, DELETE);
    const ask = await heldBy(hub, first, since, who);
    must(ask.data.kind === 'authority', `${who} the hold of \`${DELETE}\` must be an authority ask: ${handleOf(ask)} was filed as ${String(ask.data.kind)}`);
    const question = String(ask.data.question ?? '');
    must(/proceed/i.test(question) && question.includes(QUESTION), `${who} the authority ask holding \`${DELETE}\` must name the proceed whose turn it is in ("${QUESTION}"): ${handleOf(ask)} asks "${question}"`);
    const again = bash(s, DELETE);
    await sleep(5000);
    await notRun(hub, first, DELETE, who);
    await notRun(hub, again, DELETE, who);
    const asks = await asksNaming(hub, since, DELETE);
    must(asks.length === 1, `${who} one authority ask holds \`${DELETE}\`, called twice: ${asks.length} asks name it: ${asks.map(handleOf).join(', ')}`);
  } finally {
    await stopHub(hub);
  }
}

describe(`${AC} a Codex subagent's prompt ends no turn a proceed started: the delete after it is held with one authority ask`, () => {
  it(`${AC} in the turn a proceed started, after a Codex subagent's prompt, \`${DELETE}\` is held at PreToolUse with one authority ask naming the proceed`, async (ctx) => {
    await verdict(ctx, () => scenario());
  }, 600_000);

  it(`${AC} (wrong program) a hub whose proceed-turn query counts a subagent's prompt (DEEP_HUB_PLANT=${PLANT}) lets the delete run and fails this test, naming the call`, async (ctx) => {
    await verdict(ctx, async () => {
      const why = await failureOf(() => scenario(PLANT));
      must(why !== null, `${AC} the planted hub ${PLANT} must fail this test; it passed`);
      must(why.includes(DELETE), `${AC} the planted hub ${PLANT} must fail this test naming the call \`${DELETE}\`; it failed with: ${why}`);
    });
  }, 600_000);
});
