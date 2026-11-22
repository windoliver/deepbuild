// AC6 #552.5d140522: In a two-player match with a 128 × 128 fog grid, copy 1 draws fog over the cells player 1 doesn't
// see and copy 2 over its own; a grenade occurrence in player 1's fog draws no burst and starts no voice on copy 1, and
// does both on copy 2; full-state hashes agree at every interval; a planted overlay that reads player 1's bits on every
// copy fails, naming the copy and the cell; and a planted burst that ignores the gate fails, naming the occurrence and
// the step
//
// The piece is fixtures.ts's war piece: `war` declares `fog: {grid: "war.fog", …}` and writes the grid row by row over
// steps 0 to 127 (README: The war piece: rows 0 to 15 seen by both, 16 to 103 split between the players with radar
// between, 104 to 111 radar for both, 112 on seen by neither); its terrain plate's overlay reads the grid through
// `match.me`; it emits a grenade at step 150 at cell (100, 64), in player 1's fog and player 2's sight, and one at step
// 170 at cell (20, 8), which both see; the burst `sparks` and the spawn `boom` read its occurrences. Both copies play
// 300 match steps by `match` over the test relay; each copy's view after step 140 gives its frame, judged at every
// fourth cell against the colors of the rows every side shares, and each copy's report lists its bursts and voices
// (README: A copy's report, `effects`). Wrong programs it fails: the merge base (no fog grid, no gate); an overlay of
// player 1's bits or of the whole value on every copy (the planted overlay); a burst or a voice that ignores the gate
// (the planted burst), or a gate that silences every grenade; a grid or a gate that enters a hash.
import { describe, it } from 'vitest';
import { DOC, WAR_SIZE, WAR_STEPS, WAR_VIEW_STEP, toneWav, warDoc, warProgram, type JsonObject, type Planted } from './fixtures.ts';
import {
  AC, FULL, Script, TIMEOUT, effectFailures, failsNaming, fogFailures, hashFailures, macOnly, matchCall, none, pairOf, playedOnFailures, presented,
  putEvidence, run, scenario, show, useBuilds, useChildren, useTemp, viewsOf, type CopyView,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const VIEWS = [1, 2].map((player) => ({ player, step: WAR_VIEW_STEP }));

async function warMatch(what: string, planted?: Planted): Promise<{ reply: JsonObject; views: CopyView[] }> {
  const evidence = temp();
  const program = warProgram();
  putEvidence(evidence, program.bytes);
  const tone = putEvidence(evidence, toneWav());
  const s = new Script();
  const p = s.present(DOC.war, warDoc(program, tone));
  const m = s.add(matchCall(DOC.war, WAR_STEPS, { relay: { seed: 552 }, views: VIEWS }));
  const r = await run(builds.show(), scenario(evidence, [{ id: DOC.war, size: WAR_SIZE }], s.calls, planted ? { planted } : {}), what);
  presented(r[p], `${what}: the war piece`);
  return { reply: r[m]!, views: viewsOf(r[m], evidence, what) };
}
const viewOf = (views: CopyView[], player: 1 | 2): CopyView | undefined => views.find((v) => v.player === player && v.step === WAR_VIEW_STEP);

describe(`${AC[6]} courtesy fog over a 128 × 128 grid, gating what each copy shows and plays`, () => {
  it(`${AC[6]} copy 1 fogs the cells player 1 doesn't see and copy 2 its own; the grenade in player 1's fog bursts and sounds on copy 2 alone; every full-state hash agrees`, async () => {
    macOnly();
    const { reply, views } = await warMatch('AC6 the war piece');
    const [one, two] = pairOf(reply, 'AC6');
    none([
      ...([1, 2] as const).flatMap((p) => { const v = viewOf(views, p); return v?.me === p ? [] : [`AC6: copy ${p}'s view reads match.me as ${show(v?.me ?? null)}, not ${p}`]; }),
      ...fogFailures(viewOf(views, 1)?.image ?? null, 1, 'AC6'),
      ...fogFailures(viewOf(views, 2)?.image ?? null, 2, 'AC6'),
      ...effectFailures([one, two], 'AC6'),
      ...playedOnFailures([one, two], WAR_STEPS, 'AC6'),
      ...hashFailures(one, two, 'AC6', 4),
    ], 'each copy draws its own player\'s fog and gates the grenades by it, and the copies agree');
  }, TIMEOUT);

  it(`${AC[6]} a planted overlay that reads player 1's bits on every copy fails, naming the copy and the cell`, async () => {
    macOnly();
    const { views } = await warMatch('AC6 the overlay that reads player 1\'s bits', 'fog_overlay_reads_player_one');
    failsNaming(fogFailures(viewOf(views, 2)?.image ?? null, 2, 'AC6 planted'), [/copy 2 draws cell \(\d+, \d+\)/], 'the overlay that reads player 1\'s bits on every copy');
  }, TIMEOUT);

  it(`${AC[6]} a planted burst that ignores the gate fails, naming the occurrence and the step`, async () => {
    macOnly();
    const { reply } = await warMatch('AC6 the burst that ignores the gate', 'burst_ignores_fog');
    failsNaming(effectFailures(pairOf(reply, 'AC6 planted'), 'AC6 planted'), [/copy 1 makes a burst of sparks for the grenade occurrence \(a 1, b 0\) at step 150\b/], 'the burst that ignores the gate');
  }, TIMEOUT);
});
