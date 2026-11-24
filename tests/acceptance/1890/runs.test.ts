// #1890: packages/hub/test/background.test.ts, the hub's own test that a failing background job is named in hub.health
// (#909), passes on main in three runs in a row on a loaded machine and fails on a planted hub that drops a job's
// failure (AC1); until it passes, scripts/known-failures.json lists it with this issue, so scripts/affected.mjs sets it
// apart (AC2). The test file runs unchanged, by itself, as its own vitest run (README: Surface choices).
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, type Baseline, classify, copyOfCheckout, FILE, loaded, passes, PLANT, ROOT, runFile, summary, told, unload } from './helpers.ts';

const own = (id: string): boolean => id.startsWith(`${FILE} › `);

describe('#1890 the background-job test', () => {
  it(`${AC[1]} AC1 ${FILE} passes in three runs in a row on a loaded machine, and fails on a planted hub that drops a job's failure`, async () => {
    try {
      for (const n of [1, 2, 3]) {
        await loaded();
        const run = await runFile(ROOT);
        console.log(`run ${n} of 3 in the checkout: ${summary(run)}`);
        expect(passes(run), `run ${n} of 3 in a row of ${FILE} on a loaded machine: every test in it ran and passed\n${told(run)}`).toBe(true);
      }
    } finally {
      const added = unload();
      if (added) console.log(`the machine was not loaded, so this suite ran ${added} busy processes through the three runs`);
    }
    // The same file in a copy of the checkout: as built, it passes there as in the checkout, so the copy runs it as the
    // checkout does; with the hub there planted, it fails.
    for (const plant of [undefined, PLANT]) {
      const copy = copyOfCheckout(plant);
      try {
        const run = await runFile(copy);
        console.log(`${plant ? `planted hub ${plant}` : 'copy of the checkout as built'}: ${summary(run)}`);
        if (!plant) expect(passes(run), `${FILE} in a copy of the checkout, its hub as built: every test in it ran and passed\n${told(run)}`).toBe(true);
        else expect(run.failures.filter((f) => own(f.id) && f.state === 'FAIL').map((f) => f.id), `${FILE} on the planted hub ${plant}, which drops a job's failure: a test in it fails\n${told(run)}`).not.toEqual([]);
      } finally {
        rmSync(copy, { recursive: true, force: true });
      }
    }
  }, 1_800_000);

  it(`${AC[2]} AC2 until ${FILE} passes, scripts/known-failures.json lists it with #1890, so affected.mjs sets it apart`, async () => {
    const run = await runFile(ROOT);
    const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts/known-failures.json'), 'utf8')) as Baseline;
    const failed = run.failures.filter((f) => own(f.id));
    console.log(`${FILE} in the checkout: ${summary(run)}`);
    if (failed.length) {
      for (const failure of failed) {
        expect(baseline.failures[failure.id] ?? '(not listed)', `${failure.id} fails on this checkout, so known-failures.json lists it, its note ending "(#1890, added <YYYY-MM-DD>)"\n${told(run)}`)
          .toMatch(/\(#1890, added \d{4}-\d{2}-\d{2}\)$/);
        expect(classify([failure], [], baseline).known.map((k) => k.id), `affected.mjs reads ${failure.id}'s failure as already failing on main, not new`).toEqual([failure.id]);
      }
    } else {
      expect(passes(run), `${FILE} on this checkout: every test in it ran and passed\n${told(run)}`).toBe(true);
      expect(Object.keys(baseline.failures).filter(own), `${FILE} passes on this checkout, so known-failures.json lists none of its tests`).toEqual([]);
    }
  }, 600_000);
});
