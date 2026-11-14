// AC5 #213.38e13b08: "A crowd item writing 100,000 vec3 positions, 1,000 of them changed a step in 10 runs of 100, and a
// rules item mirroring them: at every step of 600 the mirror's bytes equal a plain read's, and the read region lists
// the changed ranges; after a seek to each of 10 seeded times the next step's range list and mirror equal play's; and a
// planted mirror that copies whole after a restore, with the count 0xFFFFFFFF, fails logic.determinism, naming the
// step and the region"
//
// Through `deep-logic` (README): `crowd` writes the runs; `rules` mirrors crowd.positions and copies its list out of its
// read region into `rules.list` and its checksum of the mirror into `rules.sum`; `plain` reads crowd.positions plainly
// and writes the same checksum of its read into `plain.sum`. Every item checkpoints every 60 steps. A seek to a seeded
// step s is #531's restore of the checkpoint at or before it, run through s ("the next step" is s, the first the seek
// runs at its time). logic.determinism samples 2.55 s (step 153), so its seek runs restore checkpoints 0, 60 and 120.

import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, WHOLE, arr, bakeCall, bakeSteps, checkCall, determinismCall, ints, isObject, layoutOf, listText, logic, none, obj,
  piece, rangeList, readEntry, seededSteps, show, stepsOf, useBuilds, type JsonObject, type JsonValue, type LogicStep,
} from './helpers.ts';
import { MIRROR_WRITES, PLAIN_WRITES, crowd, crowdRuns, mirrorReader, plainReader, sumOf } from './programs.ts';

const ID = CRITERIA[5];
useBuilds(['logic']);

const STEPS = 600;
const BYTES = 100_000 * 24;
const AT = 1_048_576;
const EVERY = { every: 60, budget: 268_435_456 };
const ARRAYS = ['rules.list', 'rules.sum', 'plain.sum'];
const MIRROR = 'crowd.positions';

/** The crowd, its mirror reader and its plain reader; `listAt` is where rules' list sits in its read region. */
function crowdPiece(listAt: number): JsonObject {
  return piece({
    seed: 213,
    items: {
      crowd: { program: crowd(), writes: { positions: { type: 'vec3', count: 100_000 } }, checkpoint: EVERY },
      rules: {
        program: mirrorReader({ name: 'rules', pages: 64, global: 'crowd_at', mirrorAt: AT, bytes: BYTES, listAt }), writes: MIRROR_WRITES,
        mirrors: [{ array: MIRROR, at: 'crowd_at' }], budget: { fuel: 8_000_000 }, checkpoint: EVERY,
      },
      plain: { program: plainReader({ name: 'plain', pages: 64, readsAt: AT, bytes: BYTES }), reads: [MIRROR], writes: PLAIN_WRITES, budget: { fuel: 8_000_000 }, checkpoint: EVERY },
    },
  });
}
/** rules' list offset, read from `check` (README: The read region), and plain's read at 0, as plainReader assumes. */
function listOffset(): number {
  const [checked] = logic([checkCall(crowdPiece(0))]);
  const l = layoutOf(checked!, 'rules', 'the crowd piece');
  expect(readEntry(layoutOf(checked!, 'plain', 'the crowd piece'), MIRROR, null, 'plain').offset, 'plain\'s read of crowd.positions is its first read entry, at 0').toBe(0);
  return readEntry(l, MIRROR, 'ranges', 'rules').offset;
}
const listOf = (s: LogicStep, what: string) => rangeList(ints(s.arrays['rules.list'], `${what}: rules.list`), `${what}: rules.list`);
const sumAt = (s: LogicStep, path: string, what: string): bigint => sumOf(ints(s.arrays[path], `${what}: ${path}`));

describe(`${ID} a mirror of 100,000 positions equals a plain read at every step, lists its writer's changed runs, and keeps them across a seek`, () => {
  it(`${ID} over 600 steps rules' mirror equals plain's read and its list holds crowd's 10 runs of the step before; seeks to 10 seeded times give play's list and mirror at the next step`, () => {
    const p = crowdPiece(listOffset());
    const seeds = seededSteps(213, 10, 1, STEPS - 1);
    const restores = seeds.map((s) => ({ from: 60 * Math.floor(s / 60), steps: s - 60 * Math.floor(s / 60) + 1 }));
    const [baked] = logic([bakeCall(p, STEPS, { restores, arrays: ARRAYS })]);
    const steps = bakeSteps(baked!, STEPS, 'the crowd');
    const fails: string[] = [];
    for (const s of steps) {
      const k = s.step;
      const what = `step ${k}`;
      if (sumAt(s, 'rules.sum', what) !== sumAt(s, 'plain.sum', what)) fails.push(`${what}: rules' mirror differs from plain's read (checksums ${sumAt(s, 'rules.sum', what)} and ${sumAt(s, 'plain.sum', what)})`);
      const list = listOf(s, what);
      if (k === 0) {
        if (list.count !== 0 && list.count !== WHOLE) fails.push(`${what}: before crowd's first step the list is ${listText(list)}, neither empty nor a whole copy`);
      } else if (show(list.ranges as unknown as JsonValue) !== show(crowdRuns(k - 1) as unknown as JsonValue) || list.count !== 10) {
        fails.push(`${what}: the list is ${listText(list)}, not crowd's 10 runs of step ${k - 1}, ${crowdRuns(k - 1).map(([f, c]) => `${f}+${c}`).join(', ')}`);
      }
    }
    const done = arr(baked!['restores'], 'the crowd: restores').map((r, i) => obj(r, `the crowd: restores[${i}]`));
    expect(done.length, 'every seek answered').toBe(seeds.length);
    seeds.forEach((s, i) => {
      const r = done[i]!;
      const what = `the seek to ${s} (${(s / 60).toFixed(3)} s), from checkpoint ${String(r['from'])}`;
      const at = stepsOf(r['steps'], `${what}: steps`).find((x) => x.step === s);
      if (!at) { fails.push(`${what}: no step record for step ${s}`); return; }
      const want = steps[s]!;
      if (show(listOf(at, what) as unknown as JsonValue) !== show(listOf(want, 'play') as unknown as JsonValue)) fails.push(`${what}: step ${s}'s list is ${listText(listOf(at, what))}, play's ${listText(listOf(want, 'play'))}`);
      for (const path of ['rules.sum', 'plain.sum']) if (sumAt(at, path, what) !== sumAt(want, path, 'play')) fails.push(`${what}: step ${s}'s ${path} is ${sumAt(at, path, what)}, play's ${sumAt(want, path, 'play')}`);
    });
    none(fails, 'the mirror, step by step and after the seeks');
  }, TIMEOUT);

  it(`${ID} (planted mirror_whole_after_restore) logic.determinism passes the real mirror and fails the one that copies whole after a restore, naming the restored step and the read region`, () => {
    const p = crowdPiece(listOffset());
    const [real] = logic([determinismCall(p, STEPS, [2.55])]);
    expect([real?.['verdict'], real?.['failures']], `logic.determinism passes the real mirror: ${show(real)}`).toEqual(['PASS', []]);
    const [planted] = logic([determinismCall(p, STEPS, [2.55])], { planted: 'mirror_whole_after_restore' });
    expect(planted?.['verdict'], `logic.determinism fails the planted mirror: ${show(planted)}`).toBe('FAIL');
    const failures = arr(planted!['failures'], 'the planted mirror: failures').filter(isObject);
    const named = failures.filter((f) => f['run'] === 'seek' && typeof f['from'] === 'number' && f['from'] > 0 && f['step'] === f['from'] && f['region'] === 'reads');
    expect(named.length, `a seek failure from checkpoint 60 or 120 names its first step and the read region: ${show(failures as JsonValue)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});
