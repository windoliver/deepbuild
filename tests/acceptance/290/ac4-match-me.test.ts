// AC4 #290.fba001a7: Two copies in a 2-player match, each setting opacity from `match.me` and a logic array of the
// players' characters, each show only their own character through the wall while their full-state hashes match; a
// planted opacity that ignores `match.me` shows both characters on both copies and fails, naming the copy
//
// The piece is helpers.ts's characters' piece: `hero_1` and `hero_2` stand behind one wall; the logic item `cast`
// writes `owner`, the player each character belongs to, [1, 2] before step 100 and [2, 1] from it; a driver sets each
// character's `hidden_view/opacity` to 0.4 · max(0, 1 − |who − me|), `who` reading `cast.owner[i]` and `me` reading
// `match.me`. Both copies play 200 match steps through `match` over the test relay, and each copy's view is asked
// for after steps 60 and 160 (#552's `views`), so the judge sees each copy before and after the characters are traded:
// a view that keys the hidden view to the item and not to the array fails at 160.
//
// Each view's frame is read at each character's centre and 10 px to each side of it, against the wall alone 36 px
// above (helpers.ts, `heroFailures`): copy p shows through the wall the character `cast.owner` gives player p (every
// such pixel more than 12 codes from the wall alone), and only the wall where the other player's character stands
// (every such pixel within 2 codes of it). Both copies run all 200 steps with no end and share every full-state hash,
// taken every 60 steps (at least 3).
//
// Wrong programs it fails: the merge base (the check refuses `hidden_view` as no field of an item, and a driver var
// written `match.me` as unresolved); a hidden view every copy draws alike; `match.me` let into a copy's state (the
// hashes part); the scenario's `planted: "hidden_view_opacity_ignores_match_me"` (a driver on a hidden view's opacity
// takes its largest value over every player's `match.me`), under which each copy shows both characters and the judge
// names each copy and the character that isn't its own.
import { describe, expect, it } from 'vitest';
import { requireMetal } from '../424/helpers.ts';
import { AC, DOC, HASH_EVERY, TIMEOUT, castProgram, heroFailures, heroesDoc } from './helpers.ts';
import { FULL, hashFailures, play, playedOnFailures, useBuilds, useChildren, useTemp, type Played, type ShowPlanted } from './match.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 200;
const ASKS = [60, 160].flatMap((step) => [1, 2].map((player) => ({ player, step })));

function heroes(planted?: ShowPlanted): Promise<Played> {
  const program = castProgram();
  return play(builds.show(), temp(), { doc: DOC.heroes, document: heroesDoc(program), program, steps: STEPS, views: ASKS, what: 'AC4 the characters\' piece', ...(planted ? { planted } : {}) });
}

describe(`${AC[4]} each copy of a 2-player match shows only its own player's character through the wall`, () => {
  it(`${AC[4]} two copies, each setting opacity from match.me and a logic array of the players' characters, each show only their own character through the wall while their full-state hashes match`, async () => {
    requireMetal();
    const p = await heroes();
    expect(p.blocked, 'the characters\' piece is presented and its match plays (README: The surface under test)').toEqual([]);
    expect(heroFailures(p.views, ASKS), 'each copy shows its own player\'s character through the wall, and only the wall where the other\'s stands').toEqual([]);
    expect(p.copies.map((c) => c.player), 'the match has one copy a player').toEqual([1, 2]);
    expect([
      ...playedOnFailures(p.copies, STEPS, 'AC4'),
      ...hashFailures(p.copies[0]!, p.copies[1]!, 'AC4', Math.floor((STEPS - 1) / HASH_EVERY)),
    ], 'both copies play the whole match and share every full-state hash').toEqual([]);
  }, TIMEOUT);

  it(`${AC[4]} a planted opacity that ignores match.me shows both characters on both copies and fails, naming the copy`, async () => {
    requireMetal();
    const p = await heroes('hidden_view_opacity_ignores_match_me');
    expect(p.blocked, 'the planted program presents the piece and plays its match').toEqual([]);
    const failures = heroFailures(p.views, ASKS);
    expect(failures.length, 'the planted opacity fails the judge of the copies\' views').toBeGreaterThan(0);
    for (const named of [/^copy 1 at step 60 shows hero_2, player 2's character, through the wall/, /^copy 2 at step 60 shows hero_1, player 1's character, through the wall/]) {
      expect(failures.some((f) => named.test(f)), `a failure names the copy and the character that isn't its own (${named.source}); the failures:\n  ${failures.join('\n  ')}`).toBe(true);
    }
  }, TIMEOUT);
});
