// A host with one core still has one check slot, as the lease table has (#29): a claim's check starts there.
import { afterAll, expect, it } from 'vitest';
import { CART_JS, ClaudeSession, cleanup, makeWorld, settle, startHub, trust, type Draft, type Ev } from '../../../tests/acceptance/352/helpers.ts';

afterAll(cleanup, 60_000);

const ASK = 'say in the cart what the total adds';
const CHECK = '.deepbuild/checks/total.sh';
const DRAFT: Draft = {
  ask: ASK,
  requirements: [{ id: 'R1', text: 'The total adds the lines', source_line: 'ask#L1', refuted_by: 'a total that is not the sum of its lines', check: CHECK, on_base: 'passes', asserts: ['tests/unit.test.js:5'], depth: 'unit', oracle: 'code', near_misses: [] }],
  deliverables: ['src/cart.js'],
  budget: null,
};
/** The runs started for the claims made so far. */
const runs = (all: readonly Ev[]): Ev[] => {
  const claims = new Set(all.filter((e) => e.kind === 'claim.made').map((e) => `claim:${e.id}`));
  return all.filter((e) => e.kind === 'run.started' && claims.has(String(e.data.claim)));
};

it('a claim\'s check starts on a host with one core', async () => {
  const w = makeWorld({ drafts: [DRAFT], files: { [CHECK]: '#!/bin/sh\nnode --test tests/unit.test.js\n' } });
  await trust(w, []);
  const hub = await startHub(w, { DEEP_HUB_TEST_CORES: '1' });
  const s = ClaudeSession.open(w, w.repo);
  await s.start();
  await s.typed(ASK);
  const locked = (all: Ev[]) => all.some((e) => e.kind === 'definition.locked');
  let events = await settle(hub, locked, 10_000);
  // The agent reads while its definition drafts, as a session does.
  for (const end = Date.now() + 300_000; !locked(events) && Date.now() < end;) {
    await s.read('tests/unit.test.js');
    events = await settle(hub, locked, 10_000);
  }
  expect(locked(events), 'the handed definition locked').toBe(true);
  await s.write('src/cart.js', CART_JS.replace('// end of cart', '// the total adds the lines'));
  await s.stop('Done: the cart says what the total adds.');
  events = await settle(hub, (all) => runs(all).length > 0, 90_000);
  expect(events.some((e) => e.kind === 'claim.made'), 'the stop made its claim').toBe(true);
  expect(runs(events).length, 'the claim\'s check started').toBeGreaterThan(0);
}, 600_000);
