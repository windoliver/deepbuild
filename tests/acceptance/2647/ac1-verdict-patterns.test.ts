// #2647 AC1 #2647.c40dfa9f: for a claim that changed 300 files under 20 test-runner configs, a stop's verdict reads
// compile each pattern once, counted by a preload that wraps RegExp. On the merge base the count rises with every
// verdict read, and the test fails, naming the count.
//
// The gate runner on #2118's bench (gate.ts). The merge base holds 20 packages, each with its own vitest.config.ts; the
// session's worktree adds 15 files under each package's src/, 300 in all, each with a name no other has (nNNxKK.ts).
// pkg00's config names one of them (`./src/n00x00.ts`), so the claim's check counts as the agent's own, naming it:
// the patterns are read. The claim stops; its check runs and ends; then its verdict is read ten times, as a stop reads
// it five to ten times. The preload (regexp-count.ts, imported first) sees every RegExp the process constructs; a
// construction is the claim's own-change pattern when its source names one of the 300 files (every pattern that asks
// whether a config names a changed file holds that file's name). Each such pattern must be compiled at most once over
// the whole stop and the ten reads, and the reads after the first must compile none. On the merge base `ownChanges`
// compiles two patterns per changed file at every verdict read (about 600 a read), and the test fails naming the count.
import './regexp-count.ts';
import { afterAll, describe, expect, it } from 'vitest';
import { countRegExps } from './regexp-count.ts';
import { CHECK, openBench, type Bench } from './gate.ts';
import { write } from '../31/helpers.ts';

const AC1 = '#2647.c40dfa9f';
const READS = 10;
const pad = (n: number): string => String(n).padStart(2, '0');
const PACKAGES = Array.from({ length: 20 }, (_, n) => `pkg${pad(n)}`);
/** The 300 changed files: 15 under each package's src/, each name its own. */
const STEMS = PACKAGES.flatMap((_, p) => Array.from({ length: 15 }, (_, k) => `n${pad(p)}x${pad(k)}`));
const CHANGED = STEMS.map((stem) => `pkg${stem.slice(1, 3)}/src/${stem}.ts`);
const NAMED = CHANGED[0]!;
/** The merge base's 20 runner configs: each names a setup file of its own; pkg00's also names one changed file. */
const CONFIGS: Record<string, string> = Object.fromEntries(PACKAGES.map((p, n) => [
  `${p}/vitest.config.ts`,
  `import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { setupFiles: ['./test/setup.ts'${n === 0 ? `, './src/${NAMED.split('/').pop()}'` : ''}] } });\n`,
]));

let bench: Bench | undefined;
afterAll(async () => { countRegExps(undefined); await bench?.close(); }, 60_000);

describe(`${AC1} a claim that changed 300 files under 20 test-runner configs: a stop's verdict reads compile each pattern once, counted by a preload that wraps RegExp`, () => {
  it(`${AC1} a stop and ten verdict reads compile each of the claim's own-change patterns at most once, and the reads after the first none`, async () => {
    bench = await openBench(CONFIGS);
    write(bench.repo, Object.fromEntries(CHANGED.map((path) => [path, `export const ${path.split('/').pop()!.slice(0, -3)} = 1;\n`])));

    const bySource = new Map<string, number>();
    let ours = 0;
    countRegExps((source) => {
      if (!STEMS.some((stem) => source.includes(stem))) return;
      ours++;
      bySource.set(source, (bySource.get(source) ?? 0) + 1);
    });
    const claim = 'claim:2647-ac1';
    await bench.stop({ session: 'S2647', claim, checks: [CHECK] });
    const atStop = ours;
    const perRead: number[] = [];
    const verdicts: string[] = [];
    for (let i = 0; i < READS; i++) {
      const before = ours;
      const v = bench.gate.verdictOf(claim);
      perRead.push(ours - before);
      verdicts.push(JSON.stringify(v ? { outcome: v.outcome, reasons: v.reasons } : null));
    }
    countRegExps(undefined);

    // The claim's changes reached ownChanges and its patterns: its verdict names the file pkg00's config loads.
    const last = verdicts.at(-1)!;
    if (!last.includes(NAMED) || !last.includes("counts as the agent's own")) throw Error(`BLOCKED: the claim's verdict doesn't name ${NAMED} as a file its check loads, so its patterns were never read: ${last.slice(0, 600)}`);
    if (bench.outcomes.join() !== 'passed') throw Error(`BLOCKED: the claim's check ran as ${bench.outcomes.join(', ') || 'nothing'}, not one passing run`);
    expect(new Set(verdicts).size, 'every verdict read gives the same verdict').toBe(1);

    const twice = [...bySource.values()].filter((n) => n > 1).length;
    const afterFirst = perRead.slice(1).reduce((a, b) => a + b, 0);
    expect({ compiledMoreThanOnce: twice, compiledInReadsAfterTheFirst: afterFirst },
      `the claim's own-change patterns were compiled ${ours} times over its stop and ${READS} verdict reads (${atStop} at the stop, then ${perRead.join(', ')} at each read), `
      + `for ${bySource.size} distinct patterns: ${twice} of them more than once, and ${afterFirst} compilations in the reads after the first`,
    ).toEqual({ compiledMoreThanOnce: 0, compiledInReadsAfterTheFirst: 0 });
  }, 60_000);
});
