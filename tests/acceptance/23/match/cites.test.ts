// #23.6477f693 each automatic answer cites the decision it reused: in decision.applied, in the agent's delivery
// and in the "decided for you" row. "Each" is held by a generated property with a recorded seed.

import fc from 'fast-check';
import { expect, test } from 'vitest';
import type { Event } from '../../../../packages/record/src/index.ts';
import { choiceAsk, HOUR, inWorld, REPO_A, REPO_B, repoScope, REQ_FORMAT, REQ_SECRETS, REQ_STORE, type Obj, type World } from './helpers.ts';
import { repeated } from './scenarios.ts';

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const dataOf = (e: Event): Obj => (isObj(e.data) ? e.data : {});

/** The decision an automatic answer cites holds: saved, of the ask's key, at a scope covering it, with the option delivered. */
async function citesWhatCovers(w: World, ask: string, repo: string, session: string): Promise<void> {
  const [applied] = await w.appliedTo(ask);
  const cited = String(dataOf(applied!).decision);
  const saved = (await w.events('decision.created')).find((e) => `decision:${e.id}` === cited);
  expect(saved, `${cited}, cited by the automatic answer to ${ask}, is a decision you saved`).toBeDefined();
  const d = dataOf(saved!);
  expect(d.key, `${cited} is of ${ask}'s kind: the same key`).toBe(await w.keyOf(ask));
  expect(['all', repoScope(repo), `session:${session}`], `${cited}'s scope covers ${ask}, raised in ${session} of ${repo}`).toContain(d.scope);
  const delivered = w.deliveries.filter((x) => x.ask === ask);
  expect(delivered.map((x) => [x.option, x.because]), `the agent gets ${cited}'s answer for ${ask}, citing it`).toEqual([[d.answer, cited]]);
  expect((await w.row(ask)).decision, `the "decided for you" row of ${ask} cites ${cited}`).toBe(cited);
}

test('#23.6477f693 an automatic answer cites the decision it reused, to the agent and in the "decided for you" log', async () => {
  await inWorld(async (w) => {
    const { asks } = await repeated(w);
    for (const [i, ask] of asks.entries()) await citesWhatCovers(w, ask, REPO_A, i === 0 ? 'S2' : 'S1');
  });
});

// Generator: two to five sessions, each its own thread, in repo A or B; one to ten steps, each raising one of
// three choices in one session and, when it reaches you, answering it with either option. Holds: every ask
// decided for you cites a decision that covers it and whose option the agent got; and every ask whose question
// you had already answered in its repo was decided for you, with that answer.
const SEED = 0x23_06;
const POINTS = [REQ_STORE, REQ_FORMAT, REQ_SECRETS];
const stream = fc.record({
  repos: fc.array(fc.constantFrom(REPO_A, REPO_B), { minLength: 2, maxLength: 5 }),
  steps: fc.array(fc.record({ session: fc.nat(4), point: fc.nat(2), option: fc.nat(1) }), { minLength: 1, maxLength: 10 }),
});

test('#23.6477f693 property: each automatic answer cites a decision that covers its ask, and each question already answered in its repo is answered for you', async () => {
  await fc.assert(fc.asyncProperty(stream, async (s) => {
    await inWorld(async (w) => {
      for (const [i, repo] of s.repos.entries()) await w.start(`S${i}`, `T${i}`, repo);
      const answered = new Map<string, string>();
      const raised: { ask: string; repo: string; session: string; known: string | undefined }[] = [];
      for (const step of s.steps) {
        const i = step.session % s.repos.length;
        const repo = s.repos[i]!;
        const point = POINTS[step.point]!;
        w.clock.set(w.clock.now() + HOUR);
        const ask = await w.raise(`S${i}`, 'deep_ask.choice', choiceAsk(`Which way for ${point}?`, point, ['one', 'two'], w.clock.now()));
        raised.push({ ask, repo, session: `S${i}`, known: answered.get(`${repo} ${point}`) });
        if ((await w.row(ask)).outcome === 'unanswered') {
          const option = step.option === 0 ? 'one' : 'two';
          await w.answer(ask, option);
          answered.set(`${repo} ${point}`, option);
        }
      }
      for (const r of raised) {
        const row = await w.row(r.ask);
        if (r.known !== undefined) {
          expect([row.outcome, w.deliveries.filter((d) => d.ask === r.ask).map((d) => d.option)], `${r.ask}, a question you had answered in ${r.repo}, is answered for you with ${r.known}`)
            .toEqual(['decided_for_you', [r.known]]);
        }
        if (row.outcome === 'decided_for_you') await citesWhatCovers(w, r.ask, r.repo, r.session);
      }
    });
  }), { seed: SEED, numRuns: 100 });
}, 600_000);
