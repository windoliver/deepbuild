// AC3: ready to join, checked with no model. An issue the rule selects that has no acceptance criteria stays out, is
// named on the run's page, and raises no ask; a ready one beside it starts.
import { expect, test } from 'vitest';
import { LABEL, MIN, named, names, shown, sleep, waitUntil, World } from './helpers.ts';

const SCOPE = `work through open issues labelled "${LABEL}" with Claude Code, two at a time`;
const NO_CRITERIA = 100;
const READY = 101;

test(named(3), async () => {
  // Both yours with the rule's label and a design link that resolves; #100's body has no acceptance criteria.
  const w = await World.open({ issues: [{ criteria: false }, {}], plan: { [NO_CRITERIA]: { launches: ['gated'] }, [READY]: { launches: ['gated'] } } });
  const asked = await w.run(SCOPE);
  expect(asked.code, `deep work "${SCOPE}" raises the standing run's one approval and exits 0: ${shown(asked)}`).toBe(0);
  const { ask } = await w.approve(asked);

  const ready = await waitUntil(() => w.on(READY)[0], 15 * MIN, 2000);
  expect(ready, `#${READY}, ready to join, starts`).toBeDefined();
  // The run read #100 when it found #101; it names #100 on its page within a few passes.
  await waitUntil(async () => names((await w.show()).stdout, NO_CRITERIA), 3 * MIN, 5000);
  await sleep(60_000);

  const page = await w.show();
  expect(page.code, `deep work show --json prints the run's page: ${shown(page)}`).toBe(0);
  expect(names(page.stdout, NO_CRITERIA), `#${NO_CRITERIA}, with no acceptance criteria, is named on the run's page: ${page.stdout.slice(-2500)}`).toBe(true);
  expect(w.starts(NO_CRITERIA), `#${NO_CRITERIA}, with no acceptance criteria, stays out: it never starts, a slot free`).toEqual([]);
  expect((await w.startsOf(NO_CRITERIA)).length, `the record holds no start for #${NO_CRITERIA}`).toBe(0);
  expect((await w.asksBesides(ask)).map((e) => String(e.data.question).slice(0, 300)), `#${NO_CRITERIA} staying out raises no ask`).toEqual([]);
}, 45 * MIN);
