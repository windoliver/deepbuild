// A claim whose checkout can't be made still gets a verdict (invariant 2): INCONCLUSIVE, naming why its checks did not start.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
/** The verdicts on the claims made so far. */
const verdicts = (all: readonly Ev[]): Ev[] => {
  const claims = new Set(all.filter((e) => e.kind === 'claim.made').map((e) => `claim:${e.id}`));
  return all.filter((e) => e.kind === 'verdict.made' && claims.has(String(e.data.claim)));
};

it('a claim whose checkout fails is INCONCLUSIVE, naming the failure', async () => {
  const w = makeWorld({ drafts: [DRAFT], files: { [CHECK]: '#!/bin/sh\nnode --test tests/unit.test.js\n', '.gitignore': 'node_modules\n' } });
  await trust(w, []);
  const hub = await startHub(w);
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
  // The installed packages hold a folder nothing can read, so the checkout's copy of them fails.
  const sealed = join(w.repo, 'node_modules', 'sealed');
  mkdirSync(sealed, { recursive: true });
  writeFileSync(join(sealed, 'index.js'), '');
  chmodSync(sealed, 0o000);
  try {
    await s.stop('Done: the cart says what the total adds.');
    events = await settle(hub, (all) => verdicts(all).length > 0, 60_000);
  } finally { chmodSync(sealed, 0o755); }
  expect(events.some((e) => e.kind === 'claim.made'), 'the stop made its claim').toBe(true);
  expect(verdicts(events).map((e) => [e.data.outcome, e.data.reasons])).toEqual([['INCONCLUSIVE', ['its checks did not start: can\'t copy node_modules into the checkout']]]);
}, 600_000);
