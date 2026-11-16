// AC5: the standing run's own breaker. Five attempts in a row ending in anything but PASS pause the run with one ask:
// not at the fourth, and nothing starts after the fifth.
import { expect, test } from 'vitest';
import { LABEL, MIN, named, pausedOn, shown, sleep, waitUntil, World, type Ev } from './helpers.ts';

const SCOPE = `work through open issues labelled "${LABEL}" with Claude Code, one at a time`;
const SET = [100, 101];

/** The run's starts, and its attempts that ended, in the record's order, and the asks after its fifth start. */
async function reading(w: World, ask: string): Promise<{ starts: Ev[]; ended: Ev[]; after: Ev[] }> {
  const events = await w.events();
  const starts = events.filter((e) => e.kind === 'start.started' && e.data.ask === ask);
  const ended = events.filter((e) => e.kind === 'work.attempt' && e.data.ask === ask && e.data.step === 'ended');
  const fifth = starts[4];
  const after = fifth ? events.filter((e) => e.kind === 'ask.created' && e.log_pos > fifth.log_pos && `ask:${e.id}` !== ask) : [];
  return { starts, ended, after };
}

test(named(5), async () => {
  // Every attempt on either issue ends its turn with nothing changed in its worktree: replaced, never PASS. One at a
  // time, the run works #100 until #1332's breaker on it asks you, then #101: its second attempt is the fifth in a row.
  const w = await World.open({ issues: [{}, {}], plan: Object.fromEntries(SET.map((n) => [n, { launches: ['replaced' as const] }])) });
  const asked = await w.run(SCOPE);
  expect(asked.code, `deep work "${SCOPE}" raises the standing run's one approval and exits 0: ${shown(asked)}`).toBe(0);
  const { ask } = await w.approve(asked);

  // Until a sixth attempt starts, an ask comes after the fifth started, or the run's page shows it paused; a minute
  // more then.
  await waitUntil(async () => { const r = await reading(w, ask); return r.starts.length > 5 || r.after.length > 0 || pausedOn((await w.show()).json, ask); }, 30 * MIN, 5000);
  await sleep(60_000);
  const r = await reading(w, ask);
  const tries = w.launches().filter((l) => SET.includes(l.issue ?? 0)).map((l) => `#${l.issue} at ${new Date(l.started).toISOString()}`);
  expect(r.starts.length, `the fifth attempt starts, so four in a row didn't pause the run, and no sixth starts after it: ${tries.join('; ')}`).toBe(5);
  expect(tries.length, `the played agents started five times: ${tries.join('; ')}`).toBe(5);
  expect(r.ended.map((e) => (e.data.cause === 'PASS' ? 'PASS' : 'not PASS')), 'all five attempts ended, none of them PASS').toEqual(Array(5).fill('not PASS'));
  expect(r.after.map((e) => String(e.data.question).slice(0, 300)), 'the fifth attempt in a row ending in anything but PASS raises one ask').toHaveLength(1);
  expect(r.after[0]!.log_pos, 'the ask comes once the fifth attempt has ended').toBeGreaterThan(r.ended[4]!.log_pos);
  const page = await w.show();
  expect(pausedOn(page.json, ask), `deep work show shows the run paused: ${shown(page)}`).toBe(true);
}, 45 * MIN);
