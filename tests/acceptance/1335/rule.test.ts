// AC1: one approval names a rule, and the run's set follows the forge: an issue added after the approval that meets the
// rule starts with no new approval, and one that doesn't starts nothing. A rule that reads an issue's text is refused
// at approval, naming the rule: the planted twin of the run's own words.
import { expect, test } from 'vitest';
import { LABEL, MIN, named, shown, sleep, waitUntil, World } from './helpers.ts';

const SCOPE = `work through open issues labelled "${LABEL}" with Claude Code, two at a time`;
/** The planted rule: the same words, and a rule that reads the issue's text. */
const PLANTED = `work through open issues labelled "${LABEL}" whose text mentions "refund", with Claude Code, two at a time`;
const OFF_RULE = 100;
const ON_RULE = 101;

test(named(1), async () => {
  // No issue is open at the approval; both come after it. Each started one holds its turn.
  const w = await World.open({ issues: [], more: 2, plan: { [OFF_RULE]: { launches: ['gated'] }, [ON_RULE]: { launches: ['gated'] } } });
  const asked = await w.run(SCOPE);
  expect(asked.code, `deep work "${SCOPE}" raises the standing run's one approval and exits 0: ${shown(asked)}`).toBe(0);
  const { ask } = await w.approve(asked);

  // After the approval: one issue without the rule's label, then one with it, both yours and otherwise ready.
  w.add(OFF_RULE, { labels: [] });
  w.add(ON_RULE);
  const started = await waitUntil(() => w.on(ON_RULE)[0], 15 * MIN, 2000);
  expect(started, `#${ON_RULE}, added after the approval and meeting its rule (labelled "${LABEL}"), starts`).toBeDefined();
  expect((await w.startsOf(ON_RULE)).map((e) => e.data.ask), `#${ON_RULE} starts under the run's one approval, ${ask}`).toEqual([ask]);
  // The read that found #101 found #100 too, and a slot is free: a run that didn't hold to its rule starts #100 by now.
  await sleep(60_000);
  expect(w.starts(OFF_RULE), `#${OFF_RULE}, added after the approval without the rule's label, starts nothing`).toEqual([]);
  expect((await w.startsOf(OFF_RULE)).length, `the record holds no start for #${OFF_RULE}`).toBe(0);
  const events = await w.events();
  expect(events.filter((e) => e.kind === 'ask.created' && `ask:${e.id}` !== ask).map((e) => String(e.data.question).slice(0, 300)), 'no new approval: the run asked nothing more').toEqual([]);
  expect([...new Set(events.filter((e) => e.kind === 'start.approval').map((e) => e.data.ask))], 'no new approval: every start.approval is the run\'s').toEqual([ask]);

  // The planted rule reads the issue's text: refused at approval, naming the rule, and nothing is asked or approved.
  const before = await w.events();
  const planted = await w.run(PLANTED);
  const after = (await w.events()).filter((e) => e.log_pos > (before.at(-1)?.log_pos ?? 0));
  expect(planted.code, `deep work "${PLANTED}" is refused at approval: ${shown(planted)}`).not.toBe(0);
  expect(after.filter((e) => e.kind === 'ask.created' || e.kind === 'start.approval').map((e) => e.kind), 'the refused rule raises no approval').toEqual([]);
  expect(`${planted.stdout}\n${planted.stderr}`, 'the refusal names the rule that reads the text').toContain('refund');
}, 45 * MIN);
