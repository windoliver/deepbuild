// AC3 #550.b639481c: In the two-player piece, an entry from player 2 that moves player 1's paddle, a serve from the
// player who isn't serving and a paddle move past the wall are each refused by the piece's rules on both copies at the
// same step, naming player 2 and the rule, and the match plays on with equal full-state hashes; a planted copy that
// stamps a peer's entries with its own viewer's player number lets the first through on that copy alone, and the match
// stops with net.desync, naming that step
//
// The paddle piece's rules are its own logic's (fixtures.ts, README: The paddle piece): each step `court.refused` holds
// a (player, rule) pair for every entry they turned down. Player 1 serves at step 196 (it lands at 200) and moves its
// paddle; player 2's copy sends, while the ball still waits for player 1's serve, `paddle1` = 3 made at step 96 (lands at
// 100: own_paddle), a serve made at 156 (lands at 160: not_serving) and `paddle2` = 9.5 made at 216 (lands at 220, inside
// the slider's range but past the wall at 8: wall), then honest moves of its own paddle from step 300. The planted copy
// is `net_stamps_own_player`, copy 1 of the match (README: Planted twins). Wrong programs it fails: the merge base (the
// planted copy isn't there, so nothing is let through and no desync stops the match); a module that gives a peer's
// entry the viewer's player (the planted copy itself, on both copies), or none; a copy that plays on past the mismatch.
import { describe, it } from 'vitest';
import { RULE, rally, withEntries, type Rule } from './fixtures.ts';
import { AC, FULL, TIMEOUT, arrayAt, hashFailures, namedFailures, none, play, playedOnFailures, players, useBuilds, useChildren, useTemp, type NetCopy } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 600;
/** Player 2's three entries the rules must refuse, the step each lands on and the rule. */
const BAD: { step: number; control: string; value: number; lands: number; rule: Rule }[] = [
  { step: 96, control: 'paddle1', value: 3, lands: 100, rule: 'own_paddle' },
  { step: 156, control: 'serve', value: 1, lands: 160, rule: 'not_serving' },
  { step: 216, control: 'paddle2', value: 9.5, lands: 220, rule: 'wall' },
];
const plays = withEntries(rally(2, STEPS, { serveAt: 196, from: { 2: 300 } }), 2, BAD.map(({ step, control, value }) => ({ step, control, value })));

/** The (player, rule) pairs a copy's rules refused at each step, from its `court.refused` arrays. */
function refusals(c: NetCopy): Map<number, string> {
  const out = new Map<number, string>();
  for (const r of c.rows) {
    const a = arrayAt(c, r.step, 'refused') ?? [];
    const pairs: string[] = [];
    for (let i = 0; i + 1 < a.length; i += 2) if (a[i] !== 0) pairs.push(`player ${a[i]} rule ${a[i + 1]}`);
    if (pairs.length) out.set(r.step, pairs.join(', '));
  }
  return out;
}

describe(`${AC[3]} the piece's rules judge every player's entries on every copy`, () => {
  it(`${AC[3]} player 2's move of player 1's paddle, its serve out of turn and its paddle past the wall are each refused on both copies at the same step and the match plays on, and a planted copy that stamps a peer's entries with its own player lets the first through there alone, stopping the match with net.desync at step 100`, async () => {
    const { copies } = await play(builds.show(), temp(), 'AC3 player 2 breaks the rules', { steps: STEPS, plays });
    let [one, two] = players(copies, 2, 'AC3');
    const f: string[] = [];
    const want = new Map(BAD.map((b) => [b.lands, `player 2 rule ${RULE[b.rule]}`]));
    for (const c of [one, two]) {
      if (c.rows.length < STEPS) f.push(`AC3: copy ${c.player} reports ${c.rows.length} step rows, not ${STEPS}`);
      const got = refusals(c);
      for (const [step, pair] of want) if (got.get(step) !== pair) f.push(`AC3: at step ${step} copy ${c.player}'s rules refused ${String(got.get(step) ?? 'nothing')}, not ${pair} (${BAD.find((b) => b.lands === step)!.rule})`);
      for (const [step, pair] of got) if (!want.has(step)) f.push(`AC3: at step ${step} copy ${c.player}'s rules refused ${pair}, an entry the scripts make legally`);
    }
    f.push(...playedOnFailures(copies, STEPS, 'AC3'), ...hashFailures(one, two, 'AC3', STEPS / 60 - 1));

    // The planted copy 1 stamps player 2's entries with its own player: the first is let through there alone.
    const planted = await play(builds.show(), temp(), 'AC3 the planted copy 1', { steps: STEPS, plays, planted: 'net_stamps_own_player' });
    [one, two] = players(planted.copies, 2, 'AC3 planted');
    if (refusals(one).has(100)) f.push(`AC3 planted: copy 1, which stamps player 2's entries with its own player, still refused ${refusals(one).get(100)} at step 100: nothing was let through`);
    if (refusals(two).get(100) !== `player 2 rule ${RULE.own_paddle}`) f.push(`AC3 planted: copy 2 refused ${String(refusals(two).get(100) ?? 'nothing')} at step 100, not player 2 rule ${RULE.own_paddle}`);
    for (const c of [one, two]) {
      if (c.end !== 'desync') f.push(`AC3 planted: copy ${c.player}'s match ended ${String(c.end)}, not desync`);
      f.push(...namedFailures(c, 'AC3 planted', { step: 100, module: 'logic', field: /./ }));
      if (c.ran >= STEPS) f.push(`AC3 planted: copy ${c.player} played on to step ${c.ran}`);
    }
    none(f, 'the piece\'s rules refuse player 2\'s three entries on both copies at the same steps and the match plays on; the planted copy lets the first through on its own copy, and the match stops with net.desync naming that step');
  }, TIMEOUT);
});
