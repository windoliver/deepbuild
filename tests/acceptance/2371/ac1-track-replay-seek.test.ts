// #2371.7fae183d: "A world with one input of each of `set`, `activate`, `deactivate` and `blast`, played from a track,
// gives the same step hashes on a replay and after a seek from a checkpoint; a second `set` on one step replaces the
// first; a planted `set` that applies both fails, naming the step"
//
// The yard (README: The worlds): `sleeper`, built inactive, which an `activate` stamped step 70 lets fall; `puck`,
// floating at rest under the force `push`, whose strength a `set` stamped step 80 sets to 3; `faller`, falling from
// the start, which a `deactivate` stamped step 90 stops; `chip`, floating at rest 0.9 m from where a `blast` of
// radius 1 m goes off at step 100. It is played 240 steps from that track, a checkpoint every 60 steps. The replay
// is the same bake in a second process. The seeks read the bake kept in a store: one to step 65, which restores the
// checkpoint at step 60 and then applies all four entries, and one to step 130, which restores the checkpoint at
// step 120 holding what all four did; each plays on to step 240. No comparison is vacuous: the track without any one
// of its four entries gives other step hashes, from after that entry's step on.
//
// The second `set`: two sets of the force's strength stamped step 40, to 9 and to 2, written either way round, each
// give the step hashes of the one written second alone. `--planted set_applies_both` applies both, so the one written
// first still holds where the track applies it last, and the same judge fails, naming the step.
import { describe, expect, test } from 'vitest';
import {
  AC, HASHES_ONLY, SEEK_EARLY, SEEK_LATE, SET_APPLIES_BOTH, STEPS, TIMEOUT, YARD_TRACK, ask, bake, drop, entryFailures, entryText, firstDifference,
  hashesOf, prebuild, replacedFailures, sameFailures, scratch, seek, seekFailures, setAt, yard, type Asked, type Planted,
} from './helpers.ts';

prebuild();

/** Two `set`s of the force's strength on one step, and how long the yard is played with them. */
const AT = 40;
const [NINE, TWO] = [setAt(AT, 9), setAt(AT, 2)];
const SHORT = 120;

/** The yard played from four tracks in one process: the two sets written each way round, and each alone. */
function doubleSets(planted?: Planted): Asked {
  return ask([[NINE, TWO], [TWO], [TWO, NINE], [NINE]].map((track) => bake(yard(), track, SHORT, HASHES_ONLY)), planted);
}
/** Everything wrong with "a second set on one step replaces the first", written either way round; each failure names the step. */
function doubleSetFailures(run: Asked): string[] {
  const read = [
    hashesOf(run.replies[0], SHORT, `the yard with the set to 9 and then the set to 2 on step ${AT}`),
    hashesOf(run.replies[1], SHORT, 'the yard with the set to 2 alone'),
    hashesOf(run.replies[2], SHORT, `the yard with the set to 2 and then the set to 9 on step ${AT}`),
    hashesOf(run.replies[3], SHORT, 'the yard with the set to 9 alone'),
  ];
  const unread = read.filter((x): x is string => typeof x === 'string');
  if (unread.length) return [`${unread[0]!}${unread.length > 1 ? ` (and ${unread.length - 1} more of the four tracks aren't played)` : ''}`];
  const [nineTwo, two, twoNine, nine] = read as [string[], string[], string[], string[]];
  // Which set holds is visible: the two alone give other step hashes from the step after theirs.
  const apart = firstDifference(two, nine);
  if (apart !== AT + 1) return [`the set to 2 and the set to 9, each alone on step ${AT}, first differ at step ${String(apart)}, not at step ${AT + 1}: which of two sets holds can't be told`];
  return [...replacedFailures(nineTwo, two, NINE, TWO), ...replacedFailures(twoNine, nine, TWO, NINE)];
}

describe(`${AC[1]} a world with one input of each of set, activate, deactivate and blast replays and seeks by step hash; a second set on one step replaces the first`, () => {
  test(`${AC[1]} the yard played from its track of one set, one activate, one deactivate and one blast gives the same step hashes on a replay and after a seek from the checkpoint at step ${SEEK_EARLY.from} and from the one at step ${SEEK_LATE.from}, and each of the four entries changes the world`, () => {
    const store = scratch();
    try {
      const without = YARD_TRACK.map((e) => YARD_TRACK.filter((x) => x !== e));
      const first = ask([
        bake(yard(), YARD_TRACK, STEPS, { ...HASHES_ONLY, store }),
        seek(yard(), YARD_TRACK, STEPS, store, SEEK_EARLY.to),
        seek(yard(), YARD_TRACK, STEPS, store, SEEK_LATE.to),
        ...without.map((t) => bake(yard(), t, STEPS, HASHES_ONLY)),
      ]);
      expect(first.problem, `${first.what} answers`).toBe('');
      const played = hashesOf(first.replies[0], STEPS, 'the yard, played from its track');
      expect(typeof played === 'string' ? played : '', 'the world with one input of each of set, activate, deactivate and blast is played from its track, a step hash after each step').toBe('');
      const straight = played as string[];

      // Each entry is seen to change the world, so a replay or a seek that ignored one couldn't pass.
      const seen = YARD_TRACK.flatMap((e, i) => {
        const h = hashesOf(first.replies[3 + i], STEPS, `the yard without its ${entryText(e)}`);
        return typeof h === 'string' ? [h] : entryFailures(straight, h, e);
      });
      expect(seen, `each of the four entries changes the world after its step:\n  ${seen.join('\n  ')}`).toEqual([]);

      // The replay: the same world and track in a second process.
      const again = ask([bake(yard(), YARD_TRACK, STEPS, HASHES_ONLY)]);
      expect(again.problem, `${again.what} answers the replay`).toBe('');
      const replayed = hashesOf(again.replies[0], STEPS, 'the replay');
      const replay = typeof replayed === 'string' ? [replayed] : sameFailures(straight, replayed, 'the replay', 'on the replay');
      expect(replay, `a replay of the track gives the same step hashes:\n  ${replay.join('\n  ')}`).toEqual([]);

      // The seeks: from the checkpoint at step 60, before the four entries, which the seek then applies; and from the
      // one at step 120, which holds the activated body, the set strength, the deactivated body and the blast's push.
      const sought = [SEEK_EARLY, SEEK_LATE].flatMap((s, i) => seekFailures(straight, first.replies[1 + i], s, `the seek to step ${s.to}, played on to step ${STEPS}`));
      expect(sought, `the seeks, against the straight run:\n  ${sought.join('\n  ')}`).toEqual([]);
    } finally {
      drop(store);
    }
  }, TIMEOUT);

  test(`${AC[1]} a second set on one step replaces the first: two sets of one strength stamped step ${AT} give the step hashes of the one written second alone, written either way round`, () => {
    const run = doubleSets();
    expect(run.problem, `${run.what} answers`).toBe('');
    const failures = doubleSetFailures(run);
    expect(failures, `two sets on step ${AT}:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[1]} a planted set that applies both (${SET_APPLIES_BOTH}) fails, naming the step`, () => {
    const run = doubleSets(SET_APPLIES_BOTH);
    expect(run.problem, `${run.what} answers: the planted program runs`).toBe('');
    const failures = doubleSetFailures(run);
    expect(failures.length, `${SET_APPLIES_BOTH}: the judge that passes the real program finds nothing wrong with a set that applies both`).toBeGreaterThan(0);
    const naming = new RegExp(`^the two sets stamped step ${AT} .* the step hash at step ${AT + 1} `);
    expect(failures.some((f) => naming.test(f)), `a failure names the step, the two sets' step ${AT} and step ${AT + 1} where the hash first differs:\n  ${failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
