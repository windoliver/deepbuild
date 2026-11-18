// AC4 #1490.90194dfc: "A 2D piece played in `figure` and in `full` gives equal step hashes through `probe()`"
//
// The piece is the 2D slider fixture (#172's 2D piece: a dot whose x a driver moves with time and whose y a driver takes
// from the slider `year`) on a recorded track that sets the slider to 1950 at step 180 and 2050 at step 540. It has no
// world and no logic item, so its probe() holds no world's or logic item's hash; its per-step state is its evaluated
// data, read with the step and the hashes (README: Readings).
//
// asserts:
//   - exported plainly, the piece bundles `figure`; exported under the planted picker `web_picks_full_set` (chosen: it
//     always takes `full`), it bundles `full`; the two bundles carry two players;
//   - each bundle, served and played in headless Chrome with WebGPU, loads only its receipt's files by hash (its own
//     set's player among them), plays from the start to `ended`, and is then seeked to step 0, step 960 and 20 steps
//     drawn by a generator seeded 1490, in a seeded order;
//   - at the end of the play and at every sampled step, probe() in `figure` and in `full` give the same step, the same
//     step hashes and checkpoints' full-state hashes, and the same evaluated data, value by value;
//   - the comparison has something to compare: every probe holds the dot's x and y and the slider's value, the slider
//     reads 2000 at the start and 2050 at the end in both (the track reached both players), and pairing each sampled
//     step of `figure` with the next sampled step of `full` fails, naming the dot's x (a twin made in test code).
// Wrong programs it fails: the merge base (no `figure` set: the piece bundles the one player); a `figure` player that
// evaluates, steps or plays the track differently from `full` (names the step and the value).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FULL, TIMEOUT, done, failsNaming, none, play, rng, seededSteps, servedFailures, useBrowsers, useShow, useTemp, type Probe,
} from '../172/helpers.ts';
import {
  AC, FIGURE, FULL_SET, SLIDER_ENTRIES, SLIDER_STEPS, SLIDER_VALUES, YEAR_DEFAULT, exportPiece, moduleSetOf, parityFailures, sliderDoc, sliderTrack,
  valueFailures, type Exported,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();
const PLANTED = 'web_picks_full_set';
const SAMPLED = [...new Set([0, ...seededSteps(1490, 20, SLIDER_STEPS), SLIDER_STEPS])].sort((a, b) => a - b);
const SETS: [string, string] = [FIGURE, FULL_SET];

/** One bundle played: probe() at the end of a play from the start, then at each sampled step after a seek. */
async function played(e: Exported, set: string): Promise<{ end: Probe; at: Map<number, Probe> }> {
  const p = browsers(await play(e.out));
  await p.tab.mustBeReady(`the 2D piece in ${set}`);
  await p.tab.playToEnd(`the 2D piece in ${set}`);
  const end = await p.tab.probe(`the 2D piece in ${set}, played to its end`);
  const next = rng(1491);
  const order = SAMPLED.map((k) => ({ k, r: next() })).sort((a, b) => a.r - b.r).map((x) => x.k);
  const at = new Map<number, Probe>();
  for (const k of order) at.set(k, await p.tab.seekStep(k, `the 2D piece in ${set}, a seek to step ${k}`));
  none(servedFailures(p.server, e.receipt, `the 2D piece's page in ${set}`), `the page in ${set} loaded only its receipt's files, by hash, its own player among them`);
  await done(p);
  return { end, at };
}

describe(`${AC[4]} a 2D piece plays the same in figure and in full, by probe()`, () => {
  it(`${AC[4]} the 2D slider fixture played in ${FIGURE} and in ${FULL_SET} gives equal step hashes and evaluated data through probe() at the end of a play and at 22 sampled steps`, async () => {
    const small = exportPiece(shows(FULL), temp(), sliderDoc(), join(temp(), 'bundle'), 'the 2D piece', { track: sliderTrack() });
    expect(moduleSetOf(small.receipt), `the 2D piece bundles ${FIGURE}`).toBe(FIGURE);
    const big = exportPiece(shows(FULL), temp(), sliderDoc(), join(temp(), 'bundle'), `the 2D piece (planted ${PLANTED})`, { track: sliderTrack(), planted: PLANTED });
    expect(moduleSetOf(big.receipt), `under the planted picker ${PLANTED} the 2D piece bundles ${FULL_SET}`).toBe(FULL_SET);
    expect(big.receipt.player.hash, `the ${FIGURE} and ${FULL_SET} bundles carry two players`).not.toBe(small.receipt.player.hash);

    const a = await played(small, FIGURE);
    const b = await played(big, FULL_SET);

    const vacuous: string[] = [];
    for (const [set, run] of [[FIGURE, a], [FULL_SET, b]] as const) {
      const probes: [string, Probe][] = [...[...run.at].map(([k, p]): [string, Probe] => [`step ${k}`, p]), ['the end of the play', run.end]];
      for (const [where, p] of probes) for (const id of SLIDER_VALUES) if (!(id in p.values)) vacuous.push(`${set}, ${where}: probe().values holds no ${id}`);
      const start = run.at.get(0)?.values['controls/year/value'];
      const last = run.end.values['controls/year/value'];
      if (start !== YEAR_DEFAULT) vacuous.push(`${set}: the slider reads ${String(start)} at the start, not its default ${YEAR_DEFAULT}`);
      if (last !== SLIDER_ENTRIES[SLIDER_ENTRIES.length - 1]![1]) vacuous.push(`${set}: the slider reads ${String(last)} at the end, not the track's last entry ${SLIDER_ENTRIES[SLIDER_ENTRIES.length - 1]![1]}`);
    }
    none(vacuous, 'both players read the piece\'s evaluated data, and the track reached both');

    const failures = parityFailures('played to the end', a.end, b.end, SETS);
    for (const k of SAMPLED) failures.push(...parityFailures(`step ${k}`, a.at.get(k)!, b.at.get(k)!, SETS));
    none(failures, `the 2D piece played in ${FIGURE} and in ${FULL_SET} gives equal step hashes and evaluated data through probe()`);

    const shifted = SAMPLED.slice(0, -1).flatMap((k, i) => valueFailures(`${FIGURE}'s step ${k} against ${FULL_SET}'s step ${SAMPLED[i + 1]}`, a.at.get(k)!, b.at.get(SAMPLED[i + 1]!)!, SETS));
    failsNaming(shifted, 'items/dot/at/pos/0', 'the same comparison, pairing each sampled step with the next one');
  }, TIMEOUT);
});
