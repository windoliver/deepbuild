// Criterion 5: "Six cases packed onto a pallet, the pallet carried through a queue and unpacked, give back the same six
// entities with their generations, and `process.conserve` holds while they're packed."
//
// Through `deep-logic first_party`, `bake` and `judge` (README: The surface): the pallet scene (scenes.ts: PALLET) at a
// 1/60 s tick, one step a tick, 4,300 steps. Three cases go straight out at t = 0 so the six reuse rows 0 to 2 at
// generation 2 (rows 4 to 6 at generation 1); a blocker holds the forklift for 40 s, so the packed pallet waits in a
// queue until step 2,400, is held 30 s and unpacked at step 4,200. fixtures.ts (palletRun) works out every row. The
// wrong programs this fails on: an unpack that makes new entities or reuses rows at new generations, one that drops or
// adds members, packed members counted nowhere (process.conserve) and a pack that loads other rows.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, bakeCall, bakeOf, logicBin, onHost, prebuild } from '../190/helpers.ts';
import { palletFixture, palletRun } from './fixtures.ts';
import { AC, INTERFACE, carry, fixtureDiffers, fixturePiece, judgeCall, judged, layout, numbers, passes, piece, processLib, rule, series } from './helpers.ts';
import { processWrites, sceneProgram } from './programs.ts';
import { PALLET, PALLET_ST, PALLET_STEPS } from './scenes.ts';

prebuild(() => { logicBin(); });

describe(`${AC[5]} six cases packed, carried through a queue and unpacked`, () => {
  it(`${AC[5]} six cases packed onto a pallet, carried through a queue and unpacked give back the same six entities with their generations, and process.conserve holds while they're packed`, () => {
    const r = palletRun();
    const L = processLib();
    const writes = processWrites(PALLET);
    layout(writes);
    const program = sceneProgram(PALLET, INTERFACE);
    const f = palletFixture(program, writes);
    const assets = carry({ ...L.assets }, program);
    const [bake, judge] = onHost([
      bakeCall(fixturePiece(f as never, L.ref, assets), PALLET_STEPS),
      judgeCall(piece({ pallet: { program, scene: PALLET, writes, links: [L.ref] } }, [], assets), PALLET_STEPS),
    ]);
    const b = bakeOf(bake!, 'the pallet run\'s bake');
    expect(fixtureDiffers(b, f as never), 'the pallet fixture\'s arrays hold at steps 0, 59, 60, 61, 2,399, 2,400, 4,199, 4,200 and 4,299').toEqual([]);

    const kind = numbers(series(b, 'fixture', 'kind'), 'kind');
    const gen = numbers(series(b, 'fixture', 'gen'), 'gen');
    const batch = numbers(series(b, 'fixture', 'batch'), 'batch');
    const at = numbers(series(b, 'fixture', 'at'), 'at');
    const six = (k: number): string => JSON.stringify(r.cases.map((row) => [row, kind[k]![row], gen[k]![row]]));
    expect(six(r.unpackedAt), 'the same six rows, still cases, at the same generations (2, 2, 2, 1, 1, 1) after the unpack as when they were packed').toBe(six(r.packedFrom));
    expect(r.cases.map((row) => gen[r.packedFrom]![row]), 'the six carry generations 2, 2, 2, 1, 1, 1').toEqual([2, 2, 2, 1, 1, 1]);
    expect(r.cases.every((row) => at[r.unpackedAt]![row] === PALLET_ST.qout && batch[r.unpackedAt]![row] === -1), 'unpacked, they are in the out queue').toBe(true);
    const loose = Array.from({ length: r.unpackedAt - r.packedFrom }, (_, i) => r.packedFrom + i).filter((k) => !r.cases.every((row) => batch[k]![row] === 7));
    expect(loose.slice(0, 5), 'from step 60 to 4,199 all six ride on the pallet (row 7)').toEqual([]);
    const inQueue = Array.from({ length: r.takenAt - r.waitsFrom }, (_, i) => r.waitsFrom + i).filter((k) => at[k]![7] !== PALLET_ST.qmid);
    expect(inQueue.slice(0, 5), 'the pallet waits in the middle queue from step 60 to 2,399').toEqual([]);

    const j = judged(judge!, 'pallet');
    passes(rule(j, 'process.conserve'), 'process.conserve', PALLET_STEPS);
  }, TIMEOUT);
});
