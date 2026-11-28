import { join } from 'node:path';
import { expect } from 'vitest';
import * as adapters from '../../../packages/adapters/src/index.ts';
import { learnEvent, youApp } from '../62/helpers.ts';
import type { World } from '../303/helpers.ts';
import { fixtureWorld as fixtureWorld344, type FixtureOptions } from '../344/helpers.ts';
import { makeClock, seedSession, withRecord, type World as World355 } from '../355-redraft-1894/helpers.ts';

export * from '../344/helpers.ts';

export function fixtureWorld(o: FixtureOptions = {}): World {
  expect('transcriptReaders' in adapters, '@deepbuild/adapters exports transcriptReaders (#1894)').toBe(true);
  return fixtureWorld344(o);
}

const world355 = (w: World): World355 => ({ tmp: w.tmp, home: w.home, root: w.root, wiki: join(w.root, 'wiki'), elsewhere: w.tmp, clock: makeClock(), said: new Map() });
export async function seedSlice(w: World, texts: readonly string[]): Promise<string[]> {
  const w355 = world355(w);
  return withRecord(w355, async (o) => {
    const session = await seedSession(w355, o, 'shop', w.repo, [{ id: 'm1', from: 'you', text: `${texts.join('. ')}.` }]);
    const ids: string[] = [];
    for (const [i, text] of texts.entries()) {
      const event = learnEvent('learn.applied', w355.clock.tick(1000), { target: `slice:fixture${i}`, diff: `+ ${text}`, evidence: [{ at: `session:${session}#m1`, quote: text }], scope: 'all' }, 'you');
      await o.record.append(youApp, event);
      ids.push(event.id);
    }
    return ids;
  });
}
export async function rollBack(w: World, change: string): Promise<void> {
  await withRecord(world355(w), async (o) => { await o.record.rollBack(youApp, { change }); });
}
