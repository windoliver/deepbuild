// AC1 #552.1b7a8fff: In a two-player test piece whose logic writes each player's sight as an array and whose enemy
// instancer's seen column reads that array, bit i set where player i + 1 sees the enemy, player 1's frames, pick tests
// and accessibility tree omit an enemy outside player 1's sight that player 2's show, while both copies' full-state
// hashes agree at every hash interval; a planted logic item that reads match.me is refused at check, naming the item; a
// planted net module that puts match.me into its messages fails on the relay's log, naming the field; and a planted
// column that reads player 1's bit on every copy hides from player 2 what player 1 can't see and fails, naming the copy
// and the enemy
//
// The piece is fixtures.ts's fog piece: `sight` writes four enemies and `seen` (enemy 0 both, enemy 1 player 2 only
// before step 200 and both from it, enemy 2 player 1 only, enemy 3 neither); `enemies` is fed by it, its `seen` column
// reading `sight.seen`. Both copies play 600 match steps through `match` over the test relay with its log, and each
// copy's view is asked for after steps 100 and 300: its frame, a pick test at each enemy's centre and its accessibility
// tree (README: `match`'s views). Wrong programs it fails: the merge base (no seen column, no match.me); a view that
// draws, picks or announces every row, or player 1's rows on every copy (the planted column); match.me in a copy's
// state (the hashes part) or in a message (the planted net module); a logic item let read match.me.
import { describe, it } from 'vitest';
import { DOC, FOG_SIZE, SIGHT, fogDoc, sightProgram } from './fixtures.ts';
import {
  AC, ENEMY_PROBES, FULL, Script, TIMEOUT, failsNaming, hashFailures, macOnly, matchCall, messageFailures, none, pairOf, presented, putEvidence,
  refusedNaming, run, scenario, useBuilds, useChildren, useTemp, viewFailures, viewsOf, type View,
} from './helpers.ts';
import type { JsonObject, Planted } from './fixtures.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 600;
const VIEWS: View[] = [1, 2].flatMap((player) => [100, 300].map((step) => ({ player, step, probes: ENEMY_PROBES })));

/** The fog piece presented and its match played, every copy in this process, with the relay's log and the views. */
async function fogMatch(what: string, planted?: Planted): Promise<{ reply: JsonObject; evidence: string }> {
  const evidence = temp();
  const program = sightProgram();
  putEvidence(evidence, program.bytes);
  const s = new Script();
  const shown = s.present(DOC.fog, fogDoc(program));
  const m = s.add(matchCall(DOC.fog, STEPS, { relay: { seed: 552, log: true }, views: VIEWS }));
  const r = await run(builds.show(), scenario(evidence, [{ id: DOC.fog, size: FOG_SIZE }], s.calls, planted ? { planted } : {}), what);
  presented(r[shown], `${what}: the fog piece`);
  return { reply: r[m]!, evidence };
}

describe(`${AC[1]} each copy's courtesy fog through a seen column`, () => {
  it(`${AC[1]} player 1's frames, picks and accessibility tree omit the enemy only player 2 sees, player 2's show it, both copies share every full-state hash, and no message holds anything but the design's members`, async () => {
    macOnly();
    const { reply, evidence } = await fogMatch('AC1 the fog piece');
    const [one, two] = pairOf(reply, 'AC1');
    none([
      ...viewFailures(viewsOf(reply, evidence, 'AC1'), VIEWS, 'AC1'),
      ...hashFailures(one, two, 'AC1', 9),
      ...[one, two].flatMap((c) => (c.end === null && c.ran === STEPS ? [] : [`AC1: copy ${c.player} ran ${c.ran} match steps and ended ${String(c.end)}, not ${STEPS} and none`])),
      ...messageFailures(reply, 'AC1 the relay\'s log'),
    ], 'each copy draws, picks and announces its own player\'s sight; the copies agree; messages carry no view value');
  }, TIMEOUT);

  it(`${AC[1]} a planted logic item that reads match.me is refused at check, naming the item, where the same piece without that read is presented`, async () => {
    const evidence = temp();
    const program = sightProgram();
    putEvidence(evidence, program.bytes);
    const s = new Script();
    const honest = s.present(DOC.fog, fogDoc(program));
    const planted = s.present(DOC.probe, fogDoc(program, { reads: ['match.me'], id: DOC.probe }));
    const r = await run(builds.show(), scenario(evidence, [{ id: DOC.fog, size: FOG_SIZE }, { id: DOC.probe, size: FOG_SIZE }], s.calls), 'AC1 the logic item that reads match.me');
    presented(r[honest], 'AC1 the fog piece');
    none(refusedNaming(r[planted], SIGHT, 'AC1 the fog piece whose logic item reads match.me'), 'the logic item that reads match.me is refused at check, naming it');
  }, TIMEOUT);

  it(`${AC[1]} a planted net module that puts match.me into its messages fails on the relay's log, naming the field`, async () => {
    macOnly();
    const { reply } = await fogMatch('AC1 the net module that sends match.me', 'net_sends_match_me');
    failsNaming(messageFailures(reply, 'AC1 planted: the relay\'s log'), [/the field me\b/], 'the net module that sends match.me');
  }, TIMEOUT);

  it(`${AC[1]} a planted column that reads player 1's bit on every copy hides from player 2 what player 1 can't see and fails, naming the copy and the enemy`, async () => {
    macOnly();
    const { reply, evidence } = await fogMatch('AC1 the column that reads player 1\'s bit', 'seen_reads_player_one');
    failsNaming(viewFailures(viewsOf(reply, evidence, 'AC1 planted'), VIEWS, 'AC1 planted'), [/copy 2 at step 100\b/, /hides enemies#1\.1\b/], 'the column that reads player 1\'s bit on every copy');
  }, TIMEOUT);
});
