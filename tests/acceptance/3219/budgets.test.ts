// AC7 #3219.018fc9c7: "Budgets, on the reference Mac in the local preflight, compared with the merge base: taking the
// lease adds under 5 ms to a kit's first case (drafted)"
//
// First, on any machine: with a hub running, a kit on the GPU backend (`test.kit.gpu`'s fixtures) run as a session's
// command takes the table's gpu lease, so there is a lease whose taking is timed; at the base there is none, and the test
// fails there. Then, only on a reference Mac on mains with Low Power Mode off, a nominal thermal state and the load under
// its cores (environmentProblem): the same kit, as the same session's command beside the same hub, timed from its
// shell's start to its end, by this build and by the merge base's deep-show (built from the pinned merge base under
// target/base-3219/), which takes the lease file. Five runs; each run is the p50 of 20 samples a side, interleaved, the
// change's less the merge base's (README: Readings). Judged by #1097's rule: PASS when all five are under 5 ms, FAIL
// when all five are over it by more than the margin, otherwise INCONCLUSIVE. Anywhere else the budget reads
// INCONCLUSIVE with why, never PASS, and the merge base isn't built, to spare the shared machine.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, type TestContext } from 'vitest';
import {
  AC, deepShow, ended, environmentProblem, gpuRows, judge, kitOf, kitScenario, loadNow, p50, REPO, Session, showIn, shownRows, Table, World,
} from './helpers.ts';

/** The merge base this suite was written on, pinned, so the comparison stays with the pre-#3219 deep-show after it merges. */
const BASE = 'f8c6cff822b5b960d35312d75d44769616a95516';
const LIMIT_MS = 5;
const RUNS = 5;
const SAMPLES = 20;

/** The merge base's deep-show (SHOW_FEATURES), from `git archive` of BASE (never a copy of .git), built under target/base-3219. */
function baseShow(): string {
  const dir = join(REPO, 'target', 'base-3219', BASE.slice(0, 12));
  const binary = join(dir, 'target', 'debug', 'deep-show');
  if (existsSync(binary)) return binary;
  const src = join(dir, 'src');
  rmSync(src, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_') && k !== 'CARGO_TARGET_DIR') env[k] = v;
  const unpacked = spawnSync('/bin/sh', ['-c', 'git -C "$1" archive --format=tar "$2" | tar -x -C "$3"', 'sh', REPO, BASE, src], { env, encoding: 'utf8', timeout: 1_800_000 });
  if (unpacked.status !== 0) throw Error(`BLOCKED: git archive of the merge base ${BASE} failed: ${unpacked.stderr.slice(-2000)}`);
  const built = spawnSync('cargo', ['build', '--locked', '--offline', '--bin', 'deep-show', '--no-default-features', '--features', 'full,test-kit-gpu-pass', '--target-dir', join(dir, 'target')], { cwd: src, env, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 64 * 1024 * 1024 });
  if (built.status !== 0 || !existsSync(binary)) throw Error(`BLOCKED: the merge base's deep-show didn't build: ${String(built.stderr).slice(-3000)}`);
  return binary;
}

describe(`${AC[7]} taking the lease adds under ${LIMIT_MS} ms to a kit's first case, compared with the merge base`, () => {
  it(`${AC[7]} with a hub, a kit takes the table's gpu lease; on a fit reference Mac, its run is within ${LIMIT_MS} ms of the merge base's at p50`, async (ctx: TestContext) => {
    const bin = await deepShow();
    const w = new World();
    await w.startHub();
    const s = new Session(w, 'kit');
    const table = new Table(w.hub!);
    try {
      await s.begin();
      const ev = w.folder('evidence');
      const first = await ended(showIn(s, bin, kitScenario(ev), 'the kit'), 900_000);
      await table.until((rows) => gpuRows(rows).filter((r) => r.holder === s.holder).every((r) => r.released !== undefined), 30_000);
      const mine = gpuRows(await table.read()).filter((r) => r.holder === s.holder);
      const kit = kitOf(first);
      console.log(`AC7 the kit with a hub (${loadNow()}): ran ${first.t1 - first.t0} ms; GPU cases ${typeof kit === 'string' ? kit.slice(0, 300) : kit.gpu.map((c) => `${c.case} ${c.verdict}`).join(', ')}; its gpu leases: ${shownRows(mine)}`);
      expect(mine.length, `with a hub running, the kit takes the table's gpu lease under its session ${s.holder}, so there is a lease whose taking the budget times; the table's gpu leases: ${shownRows(gpuRows(await table.read()))}`).toBeGreaterThan(0);

      const problem = environmentProblem();
      if (problem) {
        console.log(`AC7 the time taking the lease adds to a kit: not measured: ${problem}`);
        ctx.skip(`INCONCLUSIVE (not measured: ${problem})`);
      }
      const base = baseShow();
      const timed = async (b: string): Promise<number> => { const e = await ended(showIn(s, b, kitScenario(ev), 'a timed kit'), 900_000); return e.t1 - e.t0; };
      const runs: number[] = [];
      for (let r = 0; r < RUNS; r++) {
        const now: number[] = [];
        const then: number[] = [];
        for (let i = 0; i < SAMPLES; i++) { now.push(await timed(bin)); then.push(await timed(base)); }
        runs.push(p50(now) - p50(then));
        console.log(`AC7 run ${r + 1}: p50 ${p50(now)} ms with the table's lease, ${p50(then)} ms at the merge base (${loadNow()})`);
      }
      const late = environmentProblem();
      if (late) ctx.skip(`INCONCLUSIVE (reading only: ${late}): ${runs.map((x) => x.toFixed(2)).join(', ')} ms`);
      judge(ctx, `AC7 taking the lease, p50 added to a kit on the GPU, ms`, runs, LIMIT_MS);
    } finally {
      table.close();
      s.stop();
      await w.stopHub();
    }
  }, 7_200_000);
});
