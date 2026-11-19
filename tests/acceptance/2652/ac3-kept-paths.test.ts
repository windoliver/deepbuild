// #2652 AC3 #2652.a3e2a15d: a hub started on a record of 3,000 kept runs of one check with 500 paths each retains under
// 20 MB for them (drafted from the audit's estimate of 12 MB), read from a heap snapshot by the map's own retained size;
// on the merge base it retains over 100 MB.
//
// The record is written while the hub is stopped, through the record's public entry, as #1018's budget suite keeps its
// keys: 3,000 runs of one check, each a run.finished whose key names the same 500 paths, as runs of one check that read
// one tree's files do. The hub then starts with its inspector; its core thread writes a heap snapshot, and the map is the
// gate runner's map of run records, `records`, which the issue names (gate-runner.ts:205), read by its own retained size
// (README: The readings).
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AC3, cleanup, coreThread, inspect, keepRuns, makeHome, retainedIn, shownBytes, snapshot, startHub, stopHub } from './helpers.ts';

afterEach(cleanup, 300_000);

const RUNS = 3000;
const LIMIT = 20_000_000;
const CHECK = '.deepbuild/checks/build.sh';
/** 500 paths of one repo's tree, each about 70 characters, as a build check's run reads them. */
const PATHS = Array.from({ length: 500 }, (_, i) => `packages/app-${String(i % 25).padStart(2, '0')}/src/features/feature-${String(i).padStart(4, '0')}/component-module-index.ts`);

describe(`${AC3} a hub started on a record of 3,000 kept runs of one check with 500 paths each retains under 20 MB for them, read from a heap snapshot by the map's own retained size; on the merge base it retains over 100 MB`, () => {
  it(`${AC3} the gate runner's map of run records holds the 3,000 kept runs and retains under 20 MB`, async () => {
    const h = makeHome();
    // A first start makes the hub's record; the kept runs are written into it while the hub is stopped.
    await stopHub(await startHub(h));
    const runs = await keepRuns(h.root, CHECK, RUNS, PATHS);
    const hub = await startHub(h, { inspect: true });
    const ins = await inspect(hub.inspector!);
    try {
      const file = join(h.tmp, 'core.heapsnapshot');
      await snapshot(ins, await coreThread(ins), file);
      const r = retainedIn(file, 'GateRunner', 'records');
      if (r.constructorCount !== 1 || !/Map$/.test(r.target)) throw Error(`BLOCKED: the core's heap must hold one gate runner with its map of run records, \`records\`: it holds ${r.constructorCount} GateRunner objects, and \`records\` is ${r.target}`);
      const missing = runs.filter((run) => !r.strings.has(run));
      expect(missing.length, `the hub reads every kept run at its start, so the map holds a record for each of the ${RUNS}: ${missing.length} are missing, ${missing.slice(0, 3).join(', ')}`).toBe(0);
      console.log(`AC3 the gate runner's map of run records retains ${shownBytes(r.bytes)} over ${r.nodes} heap nodes for ${RUNS} kept runs of 500 paths each`);
      expect(r.bytes, `A hub started on a record of ${RUNS} kept runs of one check with 500 paths each must retain under 20 MB for them, by the map's own retained size: it retains ${shownBytes(r.bytes)} over ${r.nodes} heap nodes`).toBeLessThan(LIMIT);
    } finally {
      ins.close();
      await stopHub(hub);
    }
  }, 3_600_000);
});
