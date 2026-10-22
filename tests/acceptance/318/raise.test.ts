// Criteria 1, 6, 9 and 11 through the asks core: raise refuses what ask.created@1 refuses, naming the
// field (or, for an agent's allow option, the option), and appends nothing it refuses.

import { afterEach, beforeEach, expect, test } from 'vitest';
import { ENDS, KINDS, NOT_DECISIONS, NOT_KINDS, STATES, agent, ask, core, openWorld, refused, sourceOf, type Obj, type World } from './helpers.ts';

let w: World;
beforeEach(async () => { w = await openWorld(); });
afterEach(async () => { await w.close(); });

test('#318.b64bd314 the asks core raises an ask of each of the six kinds and refuses any other item, appending nothing', async () => {
  for (const [i, kind] of KINDS.entries()) {
    await w.start(`K${i}`, `TK${i}`);
    const handle = await w.asks.raise(core(`K${i}`), sourceOf(kind), ask(kind, w.clock.now()));
    expect(handle, `a ${kind} ask is raised`).toMatch(/^ask:[0-9A-Za-z]+$/);
    expect((await w.events('ask.created')).map((e) => `ask:${e.id}`), `the ${kind} ask is in the log`).toContain(handle);
  }
  await w.start('S1', 'T1');
  const before = (await w.events('ask.created')).length;
  for (const kind of NOT_KINDS) await refused(w.asks.raise(core('S1'), sourceOf('taste'), { ...ask('taste', w.clock.now()), kind }));
  expect((await w.events('ask.created')).length, 'an item of no ask kind was created as an ask').toBe(before);
});

test('#318.785af8ee the asks core refuses to raise an ask without what it decides, its options, the recommendation or the default, naming the field', async () => {
  await w.start('S1', 'T1');
  for (const kind of KINDS) {
    for (const field of STATES) {
      const data: Obj = ask(kind, w.clock.now());
      delete data[field];
      await refused(w.asks.raise(core('S1'), sourceOf(kind), data), { field });
    }
  }
  expect(await w.events('ask.created'), 'a refused ask reached the log').toHaveLength(0);
});

test('#318.fc8e493b the asks core refuses such an authority ask, and a deep_ask whose own option declares allow, naming that option', async () => {
  await w.start('S1', 'T1');
  const missing = ask('authority', w.clock.now());
  delete ((missing.options as Obj[])[1] as Obj).decision;
  await refused(w.asks.raise(core('S1'), sourceOf('authority'), missing), { field: 'decision' });
  for (const value of NOT_DECISIONS) {
    const data = ask('authority', w.clock.now());
    ((data.options as Obj[])[0] as Obj).decision = value;
    await refused(w.asks.raise(core('S1'), sourceOf('authority'), data), { field: 'decision' });
  }
  // deep_ask: the options are the agent's, so they may declare deny or none, never allow.
  const options = (decision: string) => [{ id: 'go', label: 'Go ahead', decision }, { id: 'wait', label: 'Wait', decision: 'none' }];
  const taste = (decision: string) => ask('taste', w.clock.now(), { options: options(decision), recommended: 'wait', default: 'wait' });
  await refused(w.asks.raise(agent('S1'), sourceOf('taste'), taste('allow')), { option: 'go' });
  await refused(w.asks.raise(agent('S1'), sourceOf('authority'), ask('authority', w.clock.now())), { option: 'push' });
  expect(await w.events('ask.created'), 'a refused ask reached the log').toHaveLength(0);
  // Its twin, whose options declare deny and none, is raised.
  await w.asks.raise(agent('S1'), sourceOf('taste'), taste('deny'));
  expect(await w.events('ask.created'), 'a deep_ask whose options declare deny or none is raised').toHaveLength(1);
});

test('#318.e4675a8d the asks core refuses to raise an ask without its fallback, owner, key or pinned_to, naming the field, and every ask.created it appends carries all four', async () => {
  await w.start('S1', 'T1');
  for (const kind of KINDS) {
    for (const field of ENDS) {
      const data: Obj = ask(kind, w.clock.now());
      delete data[field];
      await refused(w.asks.raise(core('S1'), sourceOf(kind), data), { field });
    }
  }
  expect(await w.events('ask.created'), 'a refused ask reached the log').toHaveLength(0);
  const handle = await w.asks.raise(core('S1'), sourceOf('choice'), ask('choice', w.clock.now()));
  const [event] = (await w.events('ask.created')).filter((e) => `ask:${e.id}` === handle);
  for (const field of ENDS) expect(event?.data, `ask ${handle}'s ask.created carries its ${field}`).toHaveProperty(field);
});
