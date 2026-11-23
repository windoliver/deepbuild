// Criterion 4: "Two resources of capacity 1 and three requests at the same step: the two lowest entity IDs are granted,
// the third waits and is granted at the step the first release happens. `process.busy` passes at every step."
//
// Through `deep-logic first_party`, `bake` and `judge` (README: The surface): the grant scene (scenes.ts: GRANT) at a
// 1/60 s tick, one step a tick: three sources make one order each at tick 0 (rows 0, 1, 2), each into its own queue,
// the queues built in the reverse order, so a library that grants in station order or in the order its queues ask
// grants entity 2 first. All three feed one request station for either resource, held until released; the program
// releases entity 1 at step 30, entity 0 at step 50, entity 2 at step 70 (README: Exports: release). fixtures.ts
// (grantRun) works it out: 0 and 1 granted at step 0, 2 waits at its queue's head and takes resource 1 at step 30. The
// wrong programs this fails on: a grant by station or queue order, a waiting request granted a step after the release
// or before it, and busy counts that don't follow the holders (process.busy).
import { describe, expect, it } from 'vitest';
import { TIMEOUT, bakeCall, bakeOf, logicBin, onHost, prebuild } from '../190/helpers.ts';
import { grantFixture, grantRun } from './fixtures.ts';
import { AC, INTERFACE, carry, fixtureDiffers, fixturePiece, judgeCall, judged, layout, numbers, passes, piece, processLib, rule, series } from './helpers.ts';
import { processWrites, sceneProgram } from './programs.ts';
import { GRANT, GRANT_ST, GRANT_STEPS } from './scenes.ts';

prebuild(() => { logicBin(); });

describe(`${AC[4]} three requests on two resources of capacity 1`, () => {
  it(`${AC[4]} three requests at one step on two resources of capacity 1: the two lowest entity IDs are granted, the third is granted at the step the first release happens, and process.busy passes at every step`, () => {
    const L = processLib();
    const writes = processWrites(GRANT);
    layout(writes);
    const program = sceneProgram(GRANT, INTERFACE);
    const f = grantFixture(program, writes);
    const assets = carry({ ...L.assets }, program);
    const [bake, judge] = onHost([
      bakeCall(fixturePiece(f as never, L.ref, assets), GRANT_STEPS),
      judgeCall(piece({ grant: { program, scene: GRANT, writes, links: [L.ref] } }, [], assets), GRANT_STEPS),
    ]);
    const b = bakeOf(bake!, 'the grant run\'s bake');
    expect(fixtureDiffers(b, f as never), 'the grant fixture\'s arrays hold at steps 0, 29, 30, 49, 50, 69, 70 and 99').toEqual([]);

    const holds = numbers(series(b, 'fixture', 'holds'), 'holds');
    const at = numbers(series(b, 'fixture', 'at'), 'at');
    expect(holds[0]!.slice(0, 3).map((h) => h >= 0), 'at step 0 entities 0 and 1 hold a unit and entity 2 holds none').toEqual([true, true, false]);
    expect(at[0]![2], 'entity 2 waits at the head of its queue').toBe(GRANT_ST.q2);
    const released = holds.findIndex((h) => h[1]! < 0);
    const granted = holds.findIndex((h) => h[2]! >= 0);
    expect([released, granted, grantRun().grantedAt], 'entity 2 is granted at the step entity 1\'s release happens, step 30').toEqual([30, 30, 30]);
    expect(holds.slice(0, granted).every((h) => h[2] === -1), 'entity 2 holds nothing before then').toBe(true);

    const j = judged(judge!, 'grant');
    passes(rule(j, 'process.busy'), 'process.busy', GRANT_STEPS);
  }, TIMEOUT);
});
