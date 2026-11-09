// Blind redraft (README) of #65's Proof, signed in the current format: the earlier ../proof.test.ts, tagged AC1, AC2
// and AC3, with the phone's "I did it" signed in the design's shape. A task sent to a phone and finished there, its
// check re-run and the item closed on every other channel, plus a refused authority answer from chat. An agent paseo
// runs raises the task through its bound `deep mcp` (deep_ask, kind unblock, proved by the repo's check task-done); you
// do the step, answer "I did it" on the paired phone, and the hub runs task-done again before the task stays closed;
// then the agent's push request asks for your authority, and an approve from chat is refused, pointing to the trusted
// path.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, CHECK, MINUTE, YOU, cleanup, closed, describeItem, events, inTime, inboxRow, live, Mcp, ofKind, openInNeedsYou, paseoAgent, permission, refusalsOf, said, sleep, turnStarts, waitFor, world,
} from '../helpers.ts';
import type { Provider } from '../fixtures/providers.ts';
import { phoneOf } from './helpers.ts';

afterEach(cleanup, 120_000);

describe(`Proof of #65: ${AC[1]} ${AC[2]} ${AC[3]}`, () => {
  it(`${AC[1]} ${AC[2]} ${AC[3]} a task finished on the phone has its check re-run and closes on chat and email; chat's approve of the push is refused`, async (ctx) => {
    const w = await world({ channels: ['paseo', 'chat', 'email'], link: true, phone: true });
    const { paseo, chat, email } = w.providers as Record<'paseo' | 'chat' | 'email', Provider>;
    const phone = await phoneOf(w);
    const a = paseoAgent(w.repo);
    await turnStarts(w, a);
    const mcp = await Mcp.start(w, a);
    const asked = mcp.call('deep_ask', {
      kind: 'unblock', question: 'Create done.txt in the repo, then say you did it', options: null, recommended: null,
      steps: ['Create done.txt at the repo\'s root'], where: 'your terminal', why: 'the release waits on it', check: CHECK, thread: null, subject: null,
    });
    const raised = await waitFor(async () => (await ofKind(w, 'ask.created')).find((e) => e.data.kind === 'unblock'), 30_000, 'the task deep_ask raised')
      .catch((e: Error) => { throw Error(`BLOCKED: ${e.message}`); });
    const task = `ask:${raised.id}`;
    for (const [k, p] of [['phone', paseo], ['chat', chat], ['email', email]] as const) await waitFor(() => p.latest(task), MINUTE, `the task on the ${k}`);
    expect(live(paseo.latest(task)), `the phone can say "I did it": ${describeItem(paseo.latest(task))}`).toBe(true);

    // You do the step, and say so on the phone.
    writeFileSync(join(w.repo, 'done.txt'), 'done\n');
    const before = (await events(w)).at(-1)!.log_pos;
    const since = Date.now();
    phone.answer(paseo, task, 'done');
    const run = await waitFor(async () => (await events(w)).find((e) => e.kind === 'run.started' && e.log_pos > before && e.data.check === CHECK), MINUTE, `${CHECK} run again after the phone's "I did it"`)
      .catch(async (e: Error) => { throw Error(`${e.message}; the hub's refusals: ${said(await refusalsOf(w, task))}`); });
    const finished = await waitFor(async () => (await events(w)).find((e) => e.kind === 'run.finished' && e.subject === run.subject), 2 * MINUTE, `${CHECK}'s run to finish`);
    expect(finished.data.outcome, `${CHECK} passes now that done.txt is there: ${said([finished])}`).toBe('passed');
    const open = async (): Promise<string> => `chat ${describeItem(chat.latest(task))}; email ${describeItem(email.latest(task))}; Needs you ${JSON.stringify(await inboxRow(w, task))}`;
    await inTime(ctx, `the task closed on chat, in email and in Needs you after the phone's "I did it"`, since, 10_000,
      async () => closed(chat.latest(task)) && closed(email.latest(task)) && (await inboxRow(w, task))?.status === 'closed', open);
    expect((await asked).answer, 'the agent\'s deep_ask got "I did it"').toBe('done');

    // The agent's push asks for your authority; an approve from chat is refused.
    const { ask, held } = await permission(w, a, 'git push origin main');
    await waitFor(() => chat.latest(ask), MINUTE, `${ask} on chat`);
    chat.give({ thread_key: ask, answer: 'approve', account: YOU });
    const refused = await waitFor(async () => (await refusalsOf(w, ask))[0], 30_000, `the hub's refusal of chat's approve of ${ask}`);
    expect(String(refused.data.reason), 'it points to the trusted path').toMatch(/trusted path/i);
    expect(await Promise.race([held.reply, sleep(5000).then(() => 'none')]), 'the push waits for your answer on the trusted path').toBe('none');
    expect(openInNeedsYou(await inboxRow(w, ask)), 'the push ask is still open in Needs you').toBe(true);
  });
});
