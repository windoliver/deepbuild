// AC7 #3257.c1dee41c: "Budget, on the reference Mac in the local preflight, compared with the merge base: making the
// chain of a 2,048 × 2,048 `mask` map takes under 1.5 times as long, drafted, and a map no `mask` material samples takes
// no longer"
//
// First, on any machine: scripts/lanes.mjs lists this file in `timed`, the local preflight's perf step, and a
// `transcode` job with `alpha_cutoff` answers with `kept`, so the chain that is timed is the coverage chain. Then only
// where the perf lane can judge a timing (a reference Mac at rest, as scripts/benchmark.mjs's `judgeLimit` reads it,
// through #1634's helpers): release builds of this checkout's and the merge base's `deep-gpu`, a decode worker of each
// held open, and three 2,048 × 2,048 maps (./chains.ts `large`): the fence's alpha at `alpha_cutoff` 0.5 (`mask`), the
// same with no cutoff (`blend`) and alpha 255 throughout (`opaque`). A run times each job five times in each worker by
// turns, from the line sent to the reply read; a reading is this checkout's median over the merge base's. After one
// warm-up run, five runs are judged by the lane's rule: the mask map against 1.5, and each map no `mask` material
// samples against 1.05, "no longer" within the lane's own 5% (README: Readings). PASS passes, FAIL fails, anything else
// is INCONCLUSIVE; elsewhere the test fails INCONCLUSIVE before anything is built for release, never passing.
// Wrong programs: the base (no `kept`, the file not in `timed`); a walk or a weighted mean that costs past the limit; a
// coverage walk run on maps that no `mask` material samples.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TIMEOUT, buildGpu, inconclusive, judgeLimit, load, median, none, shown, timedFiles, timingProblem, useDir, useGpu, type JsonObject, type Load } from '../1634/helpers.ts';
import { fence, large } from './chains.ts';
import { AC, Worker, buildBase, jobLine, keptFaults, readMade, transcode, writeMap, type Job } from './helpers.ts';

const ID = AC[7];
const bin = useGpu();
const dir = useDir();
const FILE = 'tests/acceptance/3257/ac7-budget.test.ts';
const RUNS = 5;
const SAMPLES = 5;
const MAPS = ['mask', 'blend', 'opaque'] as const;
type MapName = (typeof MAPS)[number];
const LIMITS: Record<MapName, number> = { mask: 1.5, blend: 1.05, opaque: 1.05 };

describe(`${ID} what making a chain costs`, () => {
  it(`${ID} a 2,048 × 2,048 mask map's chain takes under 1.5 times the merge base's time and a map no mask material samples no longer, on the reference Mac`, async () => {
    const [small] = transcode(bin(), dir(), [{ name: 'fence', map: fence(), cutoff: 0.5 }]);
    none([
      ...(timedFiles().includes(FILE) ? [] : [`scripts/lanes.mjs does not list ${FILE} in timed, the local preflight's perf step`]),
      ...keptFaults(small!.reply['kept'], small!.levels, 0.5, 'the transcode\'s reply'),
    ], `${ID}: what is timed, and where`);
    const problem = timingProblem();
    if (problem) inconclusive(`the budget is judged only on a reference Mac at rest, and nothing was timed here: ${problem}`);

    const scratch = mkdtempSync(join(tmpdir(), 'deep-3257-release-'));
    const workers: Worker[] = [];
    try {
      const after = buildGpu(scratch, true);
      expect(after.error, 'the release binary builds: cargo build --locked --release --bin deep-gpu').toBe('');
      const before = buildBase(scratch, true);
      expect(before.error, 'the merge base\'s release binary builds').toBe('');
      workers.push(new Worker(after.bin), new Worker(before.bin));
      const jobs: Record<MapName, Job> = {
        mask: { name: 'mask', map: large('fence'), cutoff: 0.5 }, blend: { name: 'blend', map: large('fence') }, opaque: { name: 'opaque', map: large('opaque') },
      };
      const at = dir();
      const lines = Object.fromEntries(MAPS.map((m) => [m, jobLine(jobs[m], writeMap(at, m, jobs[m].map).path, join(at, `${m}.chain`))])) as Record<MapName, JsonObject>;
      const run = async (): Promise<Record<MapName, number>> => {
        const ratios: Partial<Record<MapName, number>> = {};
        for (const m of MAPS) {
          const ms: [number[], number[]] = [[], []];
          for (let s = 0; s < SAMPLES; s++) for (const side of s % 2 ? [1, 0] : [0, 1]) {
            const { line, ms: took } = await workers[side]!.ask(lines[m]);
            if (s === 0) readMade(line, jobs[m], join(at, `${m}.chain`));
            ms[side]!.push(took);
          }
          ratios[m] = median(ms[0]) / median(ms[1]);
          console.log(`${ID} ${m}: ${median(ms[0]).toFixed(1)} ms against the merge base's ${median(ms[1]).toFixed(1)} ms, ${ratios[m].toFixed(3)} times`);
        }
        return ratios as Record<MapName, number>;
      };
      await run();
      const runs: Record<MapName, number>[] = [];
      const loads: Load[] = [];
      for (let k = 0; k < RUNS; k++) { const start = load(); runs.push(await run()); loads.push({ start, end: load() }); }
      const judged = MAPS.map((m): [string, JsonObject] => [`the ${m} map, times the merge base's (limit ${LIMITS[m]})`, judgeLimit(LIMITS[m], runs.map((r) => r[m]), loads)]);
      for (const [name, v] of judged) console.log(`${ID} ${name}: ${String(v['status'])} ${shown(v['runs'] ?? null)}${v['reason'] ? ` (${String(v['reason'])})` : ''}`);
      expect(judged.filter(([, v]) => v['status'] === 'FAIL').map(([n, v]) => `${n}: ${shown(v)}`), 'no budget fails').toEqual([]);
      const open = judged.filter(([, v]) => v['status'] !== 'PASS');
      if (open.length) inconclusive(open.map(([n, v]) => `${n}: ${String(v['status'])} ${String(v['reason'] ?? '')}`).join('; '));
    } finally {
      for (const w of workers) w.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 3 * TIMEOUT);
});
