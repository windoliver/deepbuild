// AC5: an issue whose attempt raises a taste ask gives up its slot within 10 s, so the next issue starts, and once the
// ask is answered it takes the next slot that comes free, not one another issue holds.
import { expect, test } from 'vitest';
import { asksBesides, load, MIN, named, shown, sleep, waitUntil, withinBudget, World } from './helpers.ts';

const TASTE = 100;
const NEXT = 101;
const SCOPE = 'work through #100 and #101 with Claude Code, one at a time';

test(named(5), async (ctx) => {
  // #100's attempt asks a taste question through deep_ask and works once it has the answer; #101's works on the test's go.
  const w = await World.open({ issues: [{}, {}], plan: { [TASTE]: { launches: ['taste'] }, [NEXT]: { launches: ['gated'] } } });
  const asked = await w.run(SCOPE);
  expect(asked.code, `deep work "${SCOPE}" raises the run's one approval and exits 0: exit ${asked.code}, ${asked.stderr.slice(-600)}`).toBe(0);
  const { ask } = await w.approve(asked);

  const taste = await waitUntil(async () => (await asksBesides(w, ask)).find((e) => e.data.kind === 'taste'), 20 * MIN, 500);
  expect(taste, `#${TASTE}'s attempt raises its taste ask (attempts on it: ${w.on(TASTE).length})`).toBeDefined();
  const next = await waitUntil(() => w.on(NEXT)[0], 5 * MIN, 250);
  const loadThen = load();
  expect(next, `#${TASTE} gives up its slot while it waits on you: #${NEXT} starts in it`).toBeDefined();
  expect(next!.started, `#${NEXT} starts in the slot #${TASTE} gave up, once its ask was raised`).toBeGreaterThanOrEqual(taste!.ts - 1000);
  const gaveUp = next!.started - taste!.ts;

  const answered = await w.deep(['inbox', 'answer', `ask:${taste!.id}`, 'pay']);
  expect(answered.code, `deep inbox answer ask:${taste!.id} pay (${shown(answered)})`).toBe(0);
  const at = Date.now();
  // #101 still holds the slot: #100 must not take it back.
  await sleep(30_000);
  expect(w.on(TASTE).filter((l) => (l.worked ?? 0) > 0).map((l) => new Date(l.worked!).toISOString()), `#${TASTE} takes the next free slot, not #${NEXT}'s: it did no work while #${NEXT} held it`).toEqual([]);
  w.go(NEXT);
  const freed = await waitUntil(() => w.on(NEXT).find((l) => l.stopAt)?.stopAt, 10 * MIN, 500);
  expect(freed, `#${NEXT}'s attempt ends its turn`).toBeDefined();
  const worked = await waitUntil(() => w.on(TASTE).find((l) => l.worked)?.worked, 15 * MIN, 500);
  expect(worked, `after the answer, #${TASTE} takes the next free slot and goes on`).toBeDefined();
  expect(worked!, `#${TASTE} went on after the answer`).toBeGreaterThanOrEqual(at);
  expect(worked!, `#${TASTE} went on only once #${NEXT}'s turn freed the slot`).toBeGreaterThanOrEqual(freed!);

  withinBudget(ctx, gaveUp, 10_000, `#${TASTE} giving up its slot (its taste ask at ${new Date(taste!.ts).toISOString()} to #${NEXT}'s start)`, loadThen);
}, 60 * MIN);
