// Throwaway measurement (round 2, Defect 1). Not part of the acceptance suite; it judges nothing and only prints.
// It runs heavy/run.ts's `measuredPass`, as it stands, on the two throwaway archives beside this file, three times
// each, in a fresh empty home under /tmp/dh2365-r2-home-* that is removed after each run. The child runs under the
// Node that runs vitest (run.ts's NODE is process.execPath). From the repo root:
//   NO_COLOR=1 node node_modules/vitest/vitest.mjs run --configLoader runner --config repair-evidence/round2/measured-pass.config.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, it } from 'vitest';
import { removeTemps } from '../../tests/acceptance/2365/helpers.ts';
import { mb, measuredPass } from '../../tests/acceptance/2365/heavy/run.ts';

// #20's helpers make a temp HOME when they load; without this each run left an empty /tmp/dh20-home-* behind (the
// five runs saved in this folder did; their five empty folders were removed by hand).
afterAll(removeTemps);

// The third case was added after the before-runs (before-measured-pass-*.txt have the first two); its before and
// after at the probe are before-/after-probe-100mb-transient.txt.
const CASES = [
  ['a pass that waits 300 ms and allocates almost nothing', 'alloc-nothing.mjs'],
  ['a pass that holds a touched 100 MB buffer for 300 ms', 'alloc-100mb.mjs'],
  ['a pass that holds a touched 100 MB only inside one synchronous step', 'alloc-100mb-transient.mjs'],
] as const;

describe(`round 2, Defect 1: measuredPass (heavy/run.ts) under Node ${process.version}`, () => {
  for (const [what, module] of CASES) {
    it(what, async () => {
      for (let k = 1; k <= 3; k++) {
        const home = mkdtempSync('/tmp/dh2365-r2-home-');
        try {
          const r = await measuredPass(home, 'pass', 1791190800000, { archive: fileURLToPath(new URL(module, import.meta.url)) });
          console.log(`Node ${process.version}, ${what}, run ${k}: peak resident memory ${mb(r.peakRss)} from ${mb(r.rssStart)} (+${mb(r.rise)}); the highest \`ps\` reading ${mb(r.outsidePeak)}; error ${r.error}`);
        } finally {
          rmSync(home, { recursive: true, force: true });
        }
      }
    }, 600_000);
  }
});
