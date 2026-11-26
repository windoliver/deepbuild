#!/usr/bin/env node
// #3539: makes this spike's scripts (scripts.mjs) and runs the harness on each, one process a run:
//
//   node docs/spikes/3539/run.mjs
//
// scripts/<name>.json is each script as it was run; out/<name>.<order>.json is what harness.mjs wrote for it. The
// table's twelve scripts and the one in which the person's session never stops run under `today` and `person-first`;
// the one script for the two orders runs under `today` and `hub`. Then `node docs/spikes/3539/analyze.mjs` reads them.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, kept, REPO } from './load.mjs';
import { neverStopsScript, ordersScript, OTHERS, POOLS, tableName, tableScript } from './scripts.mjs';

const runs = [
  ...POOLS.flatMap((pool) => [0, ...OTHERS].map((others) => [tableName(others, pool), tableScript(others, pool), ['today', 'person-first']])),
  ['never-stops', neverStopsScript(), ['today', 'person-first']],
  ['orders', ordersScript(), ['today', 'hub']],
];
mkdirSync(join(HERE, 'scripts'), { recursive: true });
mkdirSync(join(HERE, 'out'), { recursive: true });
for (const [name, script, orders] of runs) {
  const file = `docs/spikes/3539/scripts/${name}.json`;
  writeFileSync(join(REPO, file), `${kept(script)}\n`);
  for (const order of orders) {
    const args = ['docs/spikes/3539/harness.mjs', '--script', file, '--order', order, '--out', `docs/spikes/3539/out/${name}.${order}.json`];
    const ran = spawnSync(process.execPath, args, { cwd: REPO, stdio: ['ignore', 'inherit', 'inherit'] });
    if (ran.status !== 0) { console.error(`node ${args.join(' ')} didn't run to its end: ${ran.error?.message ?? `exit ${ran.status}`}`); process.exit(1); }
    console.log(`node ${args.join(' ')}`);
  }
}
