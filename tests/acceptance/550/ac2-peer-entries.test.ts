// AC2 #550.ba2d6c1f: A peer's entry for a control the piece doesn't declare, and one that sets a slider outside its
// range, are refused on both copies at the same step, naming the player, and the match plays on with equal full-state
// hashes
//
// The paddle piece's match, both copies in one process over the test relay: an honest rally, and player 2's copy also
// sends an entry on `warp`, which the piece doesn't declare, made at step 96 (it lands at 100), and `paddle2` set to 25,
// outside the slider's −10 to 10, made at step 196 (it lands at 200). `plays` is what each player's copy sends: every
// copy checks a peer's entry where its own are checked, at the step it lands, the sender's copy included (README:
// `match`). Wrong programs it fails: the merge base (it lists no refusal, and lets `warp` onto the track); a copy that
// takes a peer's entry unchecked; a check that refuses on the receiving copy alone or at another step; a refusal that
// names no player or another.
import { describe, it } from 'vitest';
import { DELAY, rally, withEntries } from './fixtures.ts';
import { AC, FULL, TIMEOUT, hashFailures, none, play, playedOnFailures, players, useBuilds, useChildren, useTemp, type NetCopy } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 600;
/** The two entries player 2's copy sends that the module must refuse, and the steps they land on. */
const BAD = [
  { step: 96, control: 'warp', value: 1 },
  { step: 196, control: 'paddle2', value: 25 },
];

function refusalFailures(c: NetCopy, what: string): string[] {
  if (c.refused === null) return [`${what}: copy ${c.player}'s report lists no refused entries (refused; README: A copy's report): it holds ${Object.keys(c.raw).join(', ')}`];
  const f: string[] = [];
  const got = c.refused.map((r) => `step ${r.step} player ${r.player} ${r.control}=${JSON.stringify(r.value)}`).sort();
  const want = BAD.map((b) => `step ${b.step + DELAY} player 2 ${b.control}=${JSON.stringify(b.value)}`).sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) f.push(`${what}: copy ${c.player} refused ${JSON.stringify(got)}, not exactly ${JSON.stringify(want)}`);
  for (const e of c.record?.track ?? []) if (BAD.some((b) => b.control === e.control && b.value === e.value && e.player === 2)) f.push(`${what}: copy ${c.player}'s record keeps the refused entry ${e.control}=${JSON.stringify(e.value)} of player 2`);
  return f;
}

describe(`${AC[2]} a peer's undeclared and out-of-range entries, refused alike`, () => {
  it(`${AC[2]} both copies refuse player 2's entry on an undeclared control at step 100 and its out-of-range slider at step 200, naming player 2, and play on with equal full-state hashes`, async () => {
    const plays = withEntries(rally(2, STEPS), 2, BAD);
    const { copies } = await play(builds.show(), temp(), 'AC2 a peer\'s bad entries', { steps: STEPS, plays });
    const [one, two] = players(copies, 2, 'AC2');
    none([
      ...refusalFailures(one, 'AC2'), ...refusalFailures(two, 'AC2'),
      ...playedOnFailures(copies, STEPS, 'AC2'),
      ...hashFailures(one, two, 'AC2', STEPS / 60 - 1),
    ], 'a peer\'s undeclared and out-of-range entries are refused alike, and the match plays on');
  }, TIMEOUT);
});
