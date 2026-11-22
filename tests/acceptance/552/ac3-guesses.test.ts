// AC3 #552.18ec780d: In a two-player dice piece with draw_after on its attack control, whose logic resolves each attack
// from the draw for the attack's step, played with each copy's secure random source replaced by a seeded test source, a
// planted copy that guesses each six-sided roll from the document's seed and the step before its attack is confirmed
// is right on at most 50 of 200 in each of 5 seeded matches, while against the same piece without draw_after, rolling
// from the step's seed, it is right on all 200; and each recorded match replays from either copy's merged track, with
// the network off, to the same 200 rolls and full-state hashes
//
// The piece is fixtures.ts's dice piece: `dice` reads the slider `attack` and `net.draws`; each attack is first rolled
// from its step's seed and then, when its draw comes, from the draw (README: The dice piece), so with draw_after every
// roll ends drawn and without it every roll is the step's seed's. Players 1 and 2 alternate 200 attacks, one landing
// every 3 match steps from step 14. Each match runs 700 steps by `match` over the test relay, with `secure` (README:
// `match`) seeding each copy's secure source, 1 to 5 for the five matches, and with the planted guesser
// `net_guesses_from_seed` as copy 2, whose report lists its guesses (README: Planted twins). Each copy's record is then
// replayed by `logic` (#548's `track`), which opens no connection, and read with its full-state hashes (README: `logic`).
// Wrong programs it fails: the merge base (no draw_after, no net.draws); a roll taken from the seed or the step with
// draw_after (the guesser is right on all of them); a draw kept off the track, or a replay that draws again (the
// replay's rolls differ); a guesser that can't guess (it would miss the piece without draw_after too).
import { describe, expect, it } from 'vitest';
import { ATTACKS, DOC, FOG_SIZE, MATCH_STEPS, attacks, diceDoc, diceProgram } from './fixtures.ts';
import {
  AC, FULL, Script, TIMEOUT, diceOf, guessesOf, hashFailures, lastDice, matchCall, none, obj, pairOf, playedOnFailures, presented, putEvidence,
  replayCall, replayHashes, run, scenario, useBuilds, useChildren, useTemp, type Dice, type NetCopy,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const SEEDS = [1, 2, 3, 4, 5];
const AT_MOST = 50;
const shown = [{ id: DOC.dice, size: FOG_SIZE }];

/** One seeded match of the dice piece (with draw_after unless `drawAfter` is false), copy 2 the planted guesser. */
async function guessed(evidence: string, seed: number, drawAfter: boolean, what: string): Promise<[NetCopy, NetCopy]> {
  const program = diceProgram();
  putEvidence(evidence, program.bytes);
  const s = new Script();
  const p = s.present(DOC.dice, diceDoc(program, { drawAfter }));
  const m = s.add(matchCall(DOC.dice, MATCH_STEPS, { plays: attacks(), relay: { seed }, secure: seed }));
  const r = await run(builds.show(), scenario(evidence, shown, s.calls, { planted: 'net_guesses_from_seed' }), what);
  presented(r[p], `${what}: the dice piece`);
  return pairOf(r[m], what);
}
const same = (a: Dice, b: Dice): boolean => JSON.stringify(a) === JSON.stringify(b);
/** The guesser's score: how many of the 200 rolls copy 2 guessed right, each attack's guess found by its step. */
function score(one: NetCopy, two: NetCopy, what: string, drawn: boolean): { right: number; failures: string[] } {
  const f: string[] = [...playedOnFailures([one, two], MATCH_STEPS, what), ...hashFailures(one, two, what, 10)];
  const d = lastDice(one, what);
  if (!same(d, lastDice(two, what))) f.push(`${what}: the two copies end with other rolls`);
  if (d.count !== ATTACKS) f.push(`${what}: the piece counts ${d.count} attacks, not ${ATTACKS}`);
  const undrawn = d.drawn.filter((x) => x !== (drawn ? 1 : 0)).length;
  if (undrawn) f.push(`${what}: ${undrawn} attacks are ${drawn ? 'not resolved by a draw' : 'resolved by a draw, though no control takes one'}`);
  const guesses = guessesOf(two, what);
  let right = 0;
  for (let n = 0; n < ATTACKS; n++) {
    const g = guesses.get(d.step[n]!);
    if (g === undefined) { f.push(`${what}: the guesser made no guess for attack ${n + 1}, at step ${d.step[n]}`); continue; }
    if (g === d.roll[n]) right += 1;
  }
  return { right, failures: f };
}

describe(`${AC[3]} rolls drawn after commit, which no copy reads ahead`, () => {
  it(`${AC[3]} in each of 5 seeded matches the planted guesser is right on at most 50 of 200, and each match replays from either copy's merged track to the same 200 rolls and full-state hashes`, async () => {
    const failures: string[] = [];
    const scores: number[] = [];
    for (const seed of SEEDS) {
      const evidence = temp();
      const what = `AC3 match ${seed}`;
      const [one, two] = await guessed(evidence, seed, true, what);
      const { right, failures: f } = score(one, two, what, true);
      scores.push(right);
      failures.push(...f);
      if (right > AT_MOST) failures.push(`${what}: the guesser is right on ${right} of ${ATTACKS} rolls, more than ${AT_MOST}`);
      // Each copy's record, replayed with no match: the same rolls and full-state hashes.
      const s = new Script();
      const p = s.present(DOC.dice, diceDoc(diceProgram()));
      const replays = [one, two].map((c) => s.add(replayCall(DOC.dice, MATCH_STEPS, obj(c.raw['record'], `${what}: copy ${c.player}'s record`)['track']!)));
      const r = await run(builds.show(), scenario(evidence, shown, s.calls), `${what}: the replays`);
      presented(r[p], `${what}: the dice piece for the replays`);
      [one, two].forEach((c, i) => {
        const tag = `${what}: copy ${c.player}'s record replayed`;
        const reply = obj(r[replays[i]!], tag);
        expect(reply['code'], `${tag}: logic answers, not refuses: ${JSON.stringify(reply).slice(0, 800)}`).toBeUndefined();
        const rows = Array.isArray(reply['steps']) ? reply['steps'] : [];
        const last = diceOf(obj(rows[rows.length - 1], `${tag}: its last step row`)['arrays'], tag);
        if (!same(last, lastDice(c, what))) failures.push(`${tag}: rolls other values than the match did`);
        const theirs = new Map(c.hashes.map((h) => [h.step, h.hash]));
        const ours = replayHashes(reply, tag);
        const shared = ours.filter((h) => theirs.has(h.step));
        if (shared.length < 10) failures.push(`${tag}: gives ${shared.length} full-state hashes at the match's hash steps, fewer than 10`);
        const off = shared.find((h) => theirs.get(h.step) !== h.hash);
        if (off) failures.push(`${tag}: its full-state hash at step ${off.step} is ${off.hash}, the match's ${theirs.get(off.step)}`);
      });
    }
    none(failures, `the guesser is right at most ${AT_MOST} of ${ATTACKS} times (scores ${scores.join(', ')}), and every record replays to the same rolls and hashes`);
  }, 2 * TIMEOUT);

  it(`${AC[3]} against the same piece without draw_after, rolling from the step's seed, the planted guesser is right on all 200`, async () => {
    const [one, two] = await guessed(temp(), 1, false, 'AC3 the piece without draw_after');
    const { right, failures } = score(one, two, 'AC3 the piece without draw_after', false);
    none([...failures, ...(right === ATTACKS ? [] : [`AC3: the guesser is right on ${right} of ${ATTACKS} rolls drawn from the step's seed, not all`])], 'the guesser reads every roll of the piece without draw_after ahead');
  }, TIMEOUT);
});
