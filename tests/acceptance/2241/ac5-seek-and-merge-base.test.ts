// Criterion 5: the first world sought to 1 s and played on gives the same step hashes as a straight run, and a world
// with no `tangent_speed` gives step hashes byte-identical to the merge base's.
import { describe, expect, test } from 'vitest';
import {
  AC, BOX, RATE, STEPS, TIMEOUT, ask, askBase, bake, drop, hashesOf, levelBelt, plainSurface, prebuild, sameFailures, scratch, seek,
  seekFailures, slidingBox, withBase, type JsonObject,
} from './helpers.ts';

prebuild(['release']);
withBase();

/** 1 s: step 120. The seek plays on to the bake's end, 2 s. */
const TO = RATE;
const baked = (w: JsonObject, extra: JsonObject = {}): JsonObject => bake(w, { read: [BOX], ...extra });

describe(`${AC[5]} a belt's world seeks as it plays, and a world with no tangent_speed steps as the merge base steps it`, () => {
  test(`${AC[5]} the first world sought to 1 s and played on to 2 s gives the straight run's step hashes`, () => {
    const store = scratch();
    try {
      const run = ask([baked(levelBelt(), { store }), seek(levelBelt(), store, TO, STEPS - TO)]);
      expect(run.problem, `${run.what} answers`).toBe('');
      const [straight, sought] = [hashesOf(run.replies[0]!, 'the first world'), run.replies[1]!];
      expect(typeof straight === 'string' ? straight : '', 'the first world is baked 2 s into a store, a step hash after each step').toBe('');
      const hashes = straight as string[];
      const what = `the seek to step ${TO} (1 s), played on to step ${STEPS}`;
      const failures = [...(hashes.length === STEPS + 1 ? [] : [`the straight run holds ${hashes.length} step hashes, not the built state's and one for each of ${STEPS} steps`]), ...seekFailures(hashes, sought, TO, STEPS, what)];
      const got = Array.isArray(sought['step_hashes']) ? sought['step_hashes'] : [];
      console.log(`${what}: from step ${String(sought['from'])}, ${got.length} step hashes; the last ${String(got.at(-1))} after the seek and ${String(hashes.at(-1))} in the straight run`);
      expect(failures, `${what}, against the straight run:\n  ${failures.join('\n  ')}`).toEqual([]);
      // The comparison isn't vacuous. The belt carries the box on after the seek, so no step's hash repeats the one
      // before it; and the same judge fails on the same seek with its last hash swapped for its first.
      expect(got.filter((h, i) => i > 0 && h === got[i - 1]).length, 'steps after the seek whose hash repeats the step before: the box is carried on, so none').toBe(0);
      const swapped = { ...sought, step_hashes: got.map((h, i) => (i === got.length - 1 ? got[0]! : h)) };
      expect(seekFailures(hashes, swapped, TO, STEPS, what).length, 'the judge catches a seek whose last step hash is another step\'s').toBeGreaterThan(0);
    } finally {
      drop(store);
    }
  }, TIMEOUT);

  test(`${AC[5]} a world with no tangent_speed gives step hashes byte-identical to the merge base's, and the first world's differ from them`, () => {
    const worlds: [string, JsonObject][] = [
      ['the first world with tangent_speed left out', plainSurface()],
      ['the same with its box sliding from 2 m/s', slidingBox()],
    ];
    const here = ask([...worlds.map(([, w]) => baked(w)), baked(levelBelt())]);
    expect(here.problem, `${here.what} answers`).toBe('');
    const there = askBase(worlds.map(([, w]) => baked(w)));
    expect(there.problem, `${there.what} answers`).toBe('');
    const on = `on the merge base ${there.sha.slice(0, 12)}`;
    const failures: string[] = [];
    const plain: string[][] = [];
    worlds.forEach(([name], i) => {
      const [a, b] = [hashesOf(here.replies[i]!, `${name}, here`), hashesOf(there.replies[i]!, `${name}, ${on}`)];
      if (typeof a === 'string' || typeof b === 'string') { failures.push(...[a, b].filter((x): x is string => typeof x === 'string')); return; }
      console.log(`${name}: ${a.length} step hashes here, ${b.length} ${on}; the last ${String(a.at(-1))} and ${String(b.at(-1))}`);
      failures.push(...sameFailures(a, b, STEPS, name, on));
      plain.push(a);
    });
    // The comparison isn't vacuous: these hashes see a belt. The first world's, its belt at tangent_speed 1, differ from
    // the same world's with the field left out.
    const belt = hashesOf(here.replies[worlds.length]!, 'the first world, its belt at tangent_speed 1,');
    if (typeof belt === 'string') failures.push(`nothing shows these step hashes see a belt: ${belt}`);
    else if (plain[0] && sameFailures(belt, plain[0], STEPS, 'the first world', 'with tangent_speed left out').length === 0) failures.push('the first world\'s step hashes are those of the same world with tangent_speed left out: the hash doesn\'t see the belt carry the box');
    expect(failures, `step hashes against the merge base's:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, 4 * TIMEOUT);
});
