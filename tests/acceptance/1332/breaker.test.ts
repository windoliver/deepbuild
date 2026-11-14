// AC8: the breaker counts one issue's attempts across agents and models. Claude Code, then Codex, then Claude Code on
// another model, each replaced, raise one ask listing the three with agent, model and cause, and no fourth starts.
import { expect, test } from 'vitest';
import { asksBesides, MIN, must, mustFail, named, names, sleep, waitUntil, World, type Launch, type Ran } from './helpers.ts';

const ISSUE = 100;
const SCOPE = 'work through #100 with Claude Code and Codex, one at a time';
/** Every attempt is replaced; Claude Code reports its account's model, another one on its second start (README: readings). */
const PLAN = { [ISSUE]: { launches: ['replaced' as const], models: { 'claude-code': ['claude-haiku-5-5', 'claude-sonnet-5-5'], codex: ['gpt-5.5-codex'] } } };
const agentWords: Record<Launch['agent'], RegExp> = { 'claude-code': /claude[ -]?code/i, codex: /codex/i };

/** Runs the scene until the breaker's ask or a fourth attempt, and a minute more. */
async function scene(plant?: string): Promise<{ w: World; asked: Ran; ask: string }> {
  const w = await World.open({ issues: [{}], plan: PLAN, ...(plant ? { plant } : {}) });
  const asked = await w.run(SCOPE);
  if (asked.code !== 0) return { w, asked, ask: '' };
  const { ask } = await w.approve(asked);
  await waitUntil(async () => w.on(ISSUE).length > 3 || (await asksBesides(w, ask)).some((e) => names(JSON.stringify(e.data), ISSUE)), 30 * MIN, 2000);
  await sleep(60_000);
  return { w, asked, ask };
}

/** The judgement: three attempts and no fourth, then one ask listing each attempt's agent, model and cause. */
async function judgeBreaker(w: World, ask: string): Promise<void> {
  const tries = w.on(ISSUE);
  if (tries.length > 3) {
    const f = tries[3]!;
    must(false, `a fourth attempt started on #${ISSUE} after three replaced ones: attempt 4, ${f.agent} on ${f.model}, session ${f.session}`);
  }
  const asks = (await asksBesides(w, ask)).filter((e) => names(JSON.stringify(e.data), ISSUE));
  must(asks.length === 1, `three replaced attempts on #${ISSUE} raise one ask; the record holds ${asks.length}`);
  const text = JSON.stringify(asks[0]!.data);
  tries.forEach((l, i) => {
    must(agentWords[l.agent].test(text), `the ask lists attempt ${i + 1}'s agent, ${l.agent}: ${text.slice(0, 2000)}`);
    must(text.includes(l.model), `the ask lists attempt ${i + 1}'s model, ${l.model}: ${text.slice(0, 2000)}`);
  });
  must(/replaced/i.test(text), `the ask lists each attempt's cause, replaced: ${text.slice(0, 2000)}`);
}

test(named(8), async () => {
  const { w, asked, ask } = await scene();
  expect(asked.code, `deep work "${SCOPE}" raises the run's one approval and exits 0: exit ${asked.code}, ${asked.stderr.slice(-600)}`).toBe(0);
  const tries = w.on(ISSUE);
  expect(tries.slice(0, 3).map((l) => l.agent), 'approved agents take turns: Claude Code, then Codex, then Claude Code').toEqual(['claude-code', 'codex', 'claude-code']);
  expect(tries[2]!.model, 'the third attempt is Claude Code with another model than the first').not.toBe(tries[0]!.model);
  await judgeBreaker(w, ask);

  const planted = await scene('breaker-counts-per-agent');
  expect(planted.asked.code, `the planted run's approval: exit ${planted.asked.code}`).toBe(0);
  const fourth = planted.w.on(ISSUE)[3];
  expect(fourth, 'the planted breaker started no fourth attempt, so it proves nothing').toBeDefined();
  await mustFail('a breaker that counts per agent', () => judgeBreaker(planted.w, planted.ask), ['attempt 4', fourth!.session]);
}, 90 * MIN);
