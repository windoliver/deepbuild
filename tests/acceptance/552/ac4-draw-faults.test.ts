// AC4 #552.6bdf52ad: A planted copy whose bits differ from its commitment ends the match as faulted on both copies,
// with net.fault naming that player, the step and the kind draw; a planted copy that never sends its bits ends the
// match as timeout, naming the player; and a planted logic module that delivers a draw from the bits that arrived
// first, before every player's are on the track, makes the copies part, and the match stops with net.desync, naming
// the step
//
// Each test plays criterion 3's dice piece with draw_after and its 200 attacks by `match` over the test relay (700 steps,
// `secure` seed 1), with one planted twin (README: Planted twins): `net_reveals_other_bits` (copy 2 sends bits other
// than those it committed to), `net_withholds_bits` (copy 2 commits and never sends its bits) and
// `draws_from_first_bits` (each copy's logic module delivers a step's draw as soon as it holds any player's bits, from
// those). The first drawn step is 14, where the first attack lands. "Naming the step" for the parted copies is the
// first step at which their step rows' arrays differ. Wrong programs it fails: the merge base (no draws); a copy that
// plays on past a bad reveal or a missing one; a fault or a timeout that names another player, step or kind; a desync
// that names another step, or none.
import { describe, it } from 'vitest';
import { DOC, FIRST_DRAWN, FOG_SIZE, MATCH_STEPS, attacks, diceDoc, diceProgram, type Planted } from './fixtures.ts';
import {
  AC, FULL, Script, TIMEOUT, diceRows, isObject, matchCall, none, pairOf, presented, putEvidence, run, scenario, show, useBuilds, useChildren, useTemp,
  type NetCopy,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();

async function planted(name: Planted, what: string): Promise<[NetCopy, NetCopy]> {
  const evidence = temp();
  const program = diceProgram();
  putEvidence(evidence, program.bytes);
  const s = new Script();
  const p = s.present(DOC.dice, diceDoc(program));
  const m = s.add(matchCall(DOC.dice, MATCH_STEPS, { plays: attacks(), relay: { seed: 1 }, secure: 1 }));
  const r = await run(builds.show(), scenario(evidence, [{ id: DOC.dice, size: FOG_SIZE }], s.calls, { planted: name }), what);
  presented(r[p], `${what}: the dice piece`);
  return pairOf(r[m], what);
}
/** Both copies and both records end `how`. */
const ended = (copies: NetCopy[], how: string, what: string): string[] => copies.flatMap((c) => [
  ...(c.end === how ? [] : [`${what}: copy ${c.player}'s match ended ${String(c.end)}, not ${how}`]),
  ...(c.record?.end === how ? [] : [`${what}: copy ${c.player}'s record ends ${String(c.record?.end)}, not ${how}`]),
]);

describe(`${AC[4]} bits that break their commitment, bits withheld, and a draw delivered early`, () => {
  it(`${AC[4]} a planted copy whose bits differ from its commitment ends the match as faulted on both copies, net.fault naming player 2, step ${FIRST_DRAWN} and the kind draw`, async () => {
    const copies = await planted('net_reveals_other_bits', 'AC4 the copy whose bits break its commitment');
    none([
      ...ended(copies, 'faulted', 'AC4'),
      ...copies.flatMap((c) => {
        const f = c.fault;
        if (!f) return [`AC4: copy ${c.player} reports no net.fault (${show(c.raw['fault'] ?? null)})`];
        return f.raw['player'] === 2 && f.step === FIRST_DRAWN && f.kind === 'draw' ? [] : [`AC4: copy ${c.player}'s net.fault is ${show(f.raw)}, not player 2, step ${FIRST_DRAWN}, kind draw`];
      }),
    ], 'both copies end faulted, naming player 2, the drawn step and the kind draw');
  }, TIMEOUT);

  it(`${AC[4]} a planted copy that never sends its bits ends the match as timeout, naming player 2`, async () => {
    const [one, two] = await planted('net_withholds_bits', 'AC4 the copy that withholds its bits');
    const named = isObject(one.raw['ended']) ? one.raw['ended']['player'] : undefined;
    none([
      ...ended([one, two], 'timeout', 'AC4'),
      ...(named === 2 ? [] : [`AC4: copy 1's timeout names ${show(one.raw['ended'] ?? null)}, not player 2`]),
    ], 'the match ends as timeout on both copies, naming player 2');
  }, TIMEOUT);

  it(`${AC[4]} a planted logic module that delivers a draw from the bits that arrived first makes the copies part, and the match stops with net.desync naming the first step that differs`, async () => {
    const [one, two] = await planted('draws_from_first_bits', 'AC4 the module that draws from the first bits');
    const a = diceRows(one.raw['steps'], 'AC4 copy 1');
    const b = diceRows(two.raw['steps'], 'AC4 copy 2');
    const both = [...a.keys()].filter((k) => b.has(k)).sort((x, y) => x - y);
    const parted = both.find((k) => a.get(k) !== b.get(k));
    const f = [...ended([one, two], 'desync', 'AC4')];
    if (parted === undefined) f.push(`AC4: the copies' arrays never differ over the ${both.length} steps both give: they didn't part`);
    else if (parted < FIRST_DRAWN) f.push(`AC4: the copies' arrays differ first at step ${parted}, before the first drawn step ${FIRST_DRAWN}`);
    for (const c of [one, two]) {
      if (!c.desync) f.push(`AC4: copy ${c.player} reports no net.desync (${show(c.raw['desync'] ?? null)})`);
      else if (parted !== undefined && c.desync.firstStep !== parted) f.push(`AC4: copy ${c.player}'s net.desync names step ${String(c.desync.firstStep)}, not ${parted}, where the copies part: ${show(c.desync.raw, 400)}`);
    }
    none(f, 'the copies part where a draw came early, and net.desync names that step');
  }, TIMEOUT);
});
