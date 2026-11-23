// #3220 AC4: with the pool free and the test's reading of available memory at 500 MB, a run that expects 600 MB waits,
// its line naming memory outside DeepBuild's runs, and starts within 5 s of the reading passing 600 MB; a planted
// admission that reads only the pool starts it at once and fails. The run is `deep lease -- memjob` in a repo whose
// heavy_commands entry for memjob gives 600 MB (README, Seams): an agent's heavy command is admitted on its entry's
// number. The hub's `mem` pool is 2,000 MB with nothing held; the test writes the reading of available memory the hub
// reads in place of the kernel's (DEEP_TEST_MEMORY_AVAILABLE_FILE), 500 and then 700.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, type TestContext } from 'vitest';
import { AC4, cleanup, Inconclusive, loaded, mustFail, PLANTS, sleep, until, verdict, World } from './helpers.ts';

afterAll(cleanup, 120_000);

const EXPECTS = 600;
const DONE_YAML = ['heavy_commands:', '  - name: memjob', '    argv_prefix: [memjob]', '    kinds: []', '    jobs: none', `    memory_mb: ${EXPECTS}`, ''].join('\n');
const WITHIN_MS = 5000;

interface Reading {
  /** When the test wrote 700 MB as the reading, or undefined when the command had started before it did. */
  raised: number | undefined;
  /** When memjob started, by its own `S` line. */
  started: number | undefined;
  /** What `deep lease` printed. */
  output: string;
  code: number | null;
}
const startOf = (log: string): number | undefined => {
  const m = existsSync(log) ? /^S (\d+)/m.exec(readFileSync(log, 'utf8')) : null;
  return m ? Number(m[1]) : undefined;
};
/** `deep lease -- memjob` while the reading is 500 MB, then 700 MB once it has waited (or not). */
async function scenario(plant?: string): Promise<Reading> {
  const w = new World({ files: { 'README.md': '# sample\n', '.deepbuild/done.yaml': DONE_YAML }, memMb: 2000, availableMb: 500, ...(plant ? { plant } : {}) });
  const log = join(w.tmp, 'memjob.log');
  writeFileSync(log, '');
  await w.startHub();
  try {
    const leased = w.lease(['--', 'memjob'], w.repo, { DH3220_LOG: log });
    // Until `deep lease` says what it waits for, or memjob has started; then 3 s more, in which it must not start.
    await until(() => /deep lease: waiting/.test(leased.output()) || startOf(log) !== undefined || leased.finished(), 120_000);
    await sleep(3000);
    let raised: number | undefined;
    if (startOf(log) === undefined && !leased.finished()) {
      raised = Date.now();
      w.setAvailable(700);
      await until(() => startOf(log) !== undefined || leased.finished(), 120_000, 50);
    }
    const end = await Promise.race([leased.done, sleep(120_000).then(() => undefined)]);
    if (!end) throw Error(`BLOCKED: \`deep lease -- memjob\` never ended: ${leased.output().slice(-1500)}`);
    return { raised, started: startOf(log), output: leased.output(), code: end.code };
  } finally {
    await w.stopHub();
  }
}

/** AC4: the command waited while the reading was 500 MB, saying memory outside DeepBuild's runs holds it, and started within 5 s of 700. */
function waitsForMemoryOutside(r: Reading): void {
  expect(r.raised, `with 500 MB available and the pool free, \`deep lease -- memjob\`, which expects ${EXPECTS} MB, must wait: memjob started at once, ${r.started ?? 'never'}, before the reading passed ${EXPECTS} MB; deep lease printed ${JSON.stringify(r.output.slice(-1200))}`).toBeDefined();
  const lines = r.output.split('\n');
  const line = lines.find((l) => /memory/i.test(l) && /outside DeepBuild/i.test(l));
  expect(line, `while it waits, its line must name memory and say it is in use outside DeepBuild's runs: deep lease printed ${JSON.stringify(r.output.slice(-1200))}`).toBeDefined();
  expect(r.started, `once the reading passed ${EXPECTS} MB, memjob must start: deep lease printed ${JSON.stringify(r.output.slice(-1200))}`).toBeDefined();
  expect(r.code, `\`deep lease -- memjob\` ends as memjob does, exit 0: ${JSON.stringify(r.output.slice(-1200))}`).toBe(0);
  const after = r.started! - r.raised!;
  if (after > WITHIN_MS) {
    const load = loaded();
    if (load) throw new Inconclusive(`memjob started ${after} ms after the reading passed ${EXPECTS} MB, over ${WITHIN_MS} ms, while the ${load}`);
  }
  expect(after, `memjob must start within ${WITHIN_MS} ms of the reading passing ${EXPECTS} MB: it started ${after} ms after`).toBeLessThanOrEqual(WITHIN_MS);
}

describe(`${AC4} a run starts only while the host's available memory is at least its expected peak`, () => {
  it(`${AC4} with the pool free and 500 MB available, a run that expects ${EXPECTS} MB waits naming memory outside DeepBuild's runs, and starts within 5 s of 700 MB`, async (ctx: TestContext) => {
    const r = await scenario();
    await verdict(ctx, () => waitsForMemoryOutside(r));
  }, 900_000);

  it(`${AC4} (wrong program ${PLANTS.poolOnly}) an admission that reads only the pool starts it at once and fails`, async () => {
    const r = await scenario(PLANTS.poolOnly);
    expect(r.raised, `${PLANTS.poolOnly}: the planted admission, reading only the free pool, must start memjob at once, with 500 MB available: ${JSON.stringify(r.output.slice(-1200))}`).toBeUndefined();
    await mustFail(`${PLANTS.poolOnly} on AC4`, () => waitsForMemoryOutside(r));
  }, 900_000);
});
