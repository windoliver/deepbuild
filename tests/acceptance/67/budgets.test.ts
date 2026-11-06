// #67 AC10: budgets, on the reference Mac in the local preflight, compared with the merge base: a workspace is created
// in under 1 s. Timed as you'd meet it, `deep workspace new` end to end against a running hub, five runs, each of a new
// topic. The merge base has no workspaces, so there's nothing there to compare with, the reading #68's suite makes. Judged by
// #304's timing rule: PASS when all five are within 1 s, FAIL when all are over it by more than the margin, otherwise
// INCONCLUSIVE. The numbers are always measured and printed; they count only on a reference Mac in a fit state and not
// loaded past its core count, and anywhere else the test is skipped as INCONCLUSIVE with the reading.
import { execFileSync } from 'node:child_process';
import { cpus, loadavg } from 'node:os';
import { afterAll, describe, expect, it, type TestContext } from 'vitest';
import { AC10, cleanup, deep, makeWorld, must, shown, startHub } from './hub.ts';

afterAll(cleanup, 60_000);
const RUNS = 5;
const LIMIT_MS = 1000;
const REFERENCE_MACS = [{ model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 }, { model: 'Mac15,12', chip: 'Apple M3', gib: 16 }];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's timings are a reading only, or null on a reference Mac not loaded past its cores. */
function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  const [model, chip, gib] = [read('sysctl', '-n', 'hw.model'), read('sysctl', '-n', 'machdep.cpu.brand_string'), Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30)];
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  const load = loadavg()[0]!;
  return load > cpus().length ? `load ${load.toFixed(1)} is past the ${cpus().length} cores` : null;
}

describe(`${AC10} a workspace is created in under 1 s`, () => {
  it(`${AC10} deep workspace new answers within 1 s on each of five runs`, async (ctx: TestContext) => {
    const w = makeWorld();
    await startHub(w);
    const runs: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await deep(w, ['workspace', 'new', `Budget topic ${i}`]);
      must(r.code === 0, `\`deep workspace new\` must make a workspace: ${shown(r)}`);
      runs.push(r.ms);
    }
    const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
    const margin = Math.max(0.05, spread);
    const text = `deep workspace new: ${runs.map((r) => r.toFixed(0)).join(', ')} ms against ${LIMIT_MS} ms (margin ${(margin * 100).toFixed(0)}%)`;
    console.log(text);
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE ${problem}: ${text}`);
    if (runs.every((r) => r <= LIMIT_MS)) return;
    expect(runs.every((r) => r > LIMIT_MS * (1 + margin)), `FAIL ${text}`).toBe(false);
    ctx.skip(`INCONCLUSIVE ${text}`);
  }, 120_000);
});
