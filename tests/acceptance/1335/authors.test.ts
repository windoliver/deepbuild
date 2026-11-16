// AC2: only work written by you or a collaborator joins. An issue with the rule's label by an outside author never
// joins, and neither does one a session opens: here the run's own session, with the credential the run gave it.
import { expect, test } from 'vitest';
import { DRIFTER } from './forge.ts';
import { bodyOf, LABEL, MIN, named, shown, sleep, waitUntil, World } from './helpers.ts';

const SCOPE = `work through open issues labelled "${LABEL}" with Claude Code, two at a time`;
const YOURS = 100;
const OUTSIDE = 101;
/** The issue the session on #100 opens, with the rule's label, ready to join by every other reading. */
const OPENED = 102;

test(named(2), async () => {
  const w = await World.open({
    issues: [{}, { author: DRIFTER }],
    more: 1,
    plan: {
      [YOURS]: { launches: ['open-issue'], opens: { title: `Issue ${OPENED}`, body: bodyOf(OPENED), labels: [LABEL] } },
      [OUTSIDE]: { launches: ['gated'] }, [OPENED]: { launches: ['gated'] },
    },
  });
  const asked = await w.run(SCOPE);
  expect(asked.code, `deep work "${SCOPE}" raises the standing run's one approval and exits 0: ${shown(asked)}`).toBe(0);
  await w.approve(asked);

  const yours = await waitUntil(() => w.on(YOURS)[0], 15 * MIN, 2000);
  expect(yours, `#${YOURS}, yours with the rule's label, starts`).toBeDefined();
  const opened = await waitUntil(() => w.forge.opened.find((o) => o.issue === OPENED), 10 * MIN, 1000);
  expect(opened, `the session on #${YOURS} opens #${OPENED}, labelled "${LABEL}"`).toBeDefined();
  expect(opened!.by, 'with its own credential: GitHub records the agents\' app as its author').toBe('deepbuild-agents[bot]');
  // Once the hub has read the issues with #102 among them, a run that let it join starts it in the free slot.
  const read = await waitUntil(() => w.forge.readAfter(opened!.at, OPENED), 10 * MIN, 2000);
  expect(read, `the run reads the forge's issues after #${OPENED} was opened`).toBe(true);
  await sleep(90_000);

  expect(w.starts(OUTSIDE), `#${OUTSIDE}, labelled "${LABEL}" but written by an outside author, never joins: it never starts, a slot free`).toEqual([]);
  expect((await w.startsOf(OUTSIDE)).length, `the record holds no start for #${OUTSIDE}`).toBe(0);
  expect(w.starts(OPENED), `#${OPENED}, which a session opened, never joins: it never starts, a slot free`).toEqual([]);
  expect((await w.startsOf(OPENED)).length, `the record holds no start for #${OPENED}`).toBe(0);
}, 45 * MIN);
