// Criterion 14, the ask.sources@1 table, and the rebuild half of criterion 11.

import { afterEach, beforeEach, test } from 'vitest';
import { askSources } from '../../../packages/asks/src/index.ts';
import { openWorld, type World } from './helpers.ts';
import { rebuildFromLog, sourcesTable } from './scenarios.ts';

test('#318.af2a2599 every place that raises an ask has one row naming its kind; its fixture takes its default; a budget raise and a paid generation take no; a source with no row raises nothing', async () => {
  await sourcesTable(askSources(), () => openWorld());
});

let w: World;
beforeEach(async () => { w = await openWorld(); });
afterEach(async () => { await w.close(); });

test('#318.e4675a8d dropping the asks table and replaying the log rebuilds each ask with its fallback, owner, key and pinned_to, and past its deadline it goes to its fallback', async () => {
  await rebuildFromLog(w);
});
