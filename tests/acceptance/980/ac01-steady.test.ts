// Criterion 1: "One source every 60 s into one resource of capacity 1 that holds each entity 45 s, at a 1/60 s step: over
// 10 simulated hours the busy share is 0.75 exactly, nothing ever waits, every time in system is 45 s, and
// `process.little` passes with mean work in progress 0.75."
//
// Through `deep-logic first_party`, `bake` and `judge` (README: The surface): the steady scene (scenes.ts: STEADY) at a
// tick of 1/60 s, a minute (3,600 ticks) a step, 600 steps, linking process@1's reference library through the interface.
// fixtures.ts (steadyRun) works the run out: one order a minute, granted in its own tick, out 2,700 ticks later. The
// busy share is the resource's busy area over its capacity times the run's time, both written as ticks × tick, so it is
// 27,000 ÷ 36,000 = 0.75 exactly (README: Time); "nothing ever waits" reads the queue's dwell, 0 at every step, and its
// count, 0 at every step end; every record of the 600 holds 45 s; process.little, judged at the last step over the
// window's last hour, passes with the request station's mean work in progress 0.75. The wrong programs shown failing
// in node: a share accumulated by adding the tick, and a hold rounded up a tick.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, bakeCall, bakeOf, logicBin, num, onHost, prebuild } from '../190/helpers.ts';
import { steadyFixture, steadyRun, ticks } from './fixtures.ts';
import { AC, INTERFACE, carry, fixtureDiffers, fixturePiece, judgeCall, judged, layout, numbers, passes, piece, processLib, rule, series } from './helpers.ts';
import { processWrites, sceneProgram } from './programs.ts';
import { STEADY, STEADY_ST, STEADY_STEPS } from './scenes.ts';

prebuild(() => { logicBin(); });

describe(`${AC[1]} one source into one resource: a share of 0.75, no waits, 45 s in system, Little's law`, () => {
  it(`${AC[1]} over 10 simulated hours at a 1/60 s step the busy share is 0.75 exactly, nothing ever waits, every time in system is 45 s, and process.little passes with mean work in progress 0.75`, () => {
    const r = steadyRun();
    expect([r.busyShare, ticks(STEADY, 45), ticks(STEADY, 60), (1 / 60) * 45], 'by the schedule: 45 s busy of every 60 s; Little: (1/60 s⁻¹) × 45 s = 0.75').toEqual([0.75, 2700, 3600, 0.75]);
    // Wrong programs the exactness reads: seconds summed tick by tick, and a hold one tick long.
    let busy = 0, run = 0;
    for (let i = 0; i < 2_160_000; i++) { run += STEADY.tick; if (i % 3600 < 2700) busy += STEADY.tick; }
    expect(busy / run, 'a share summed from the tick 2,160,000 times is not 0.75 exactly').not.toBe(0.75);
    expect((2701 * 600) / (3600 * 600), 'a hold of 2,701 ticks is not 0.75').not.toBe(0.75);

    const L = processLib();
    const writes = processWrites(STEADY);
    layout(writes);
    const program = sceneProgram(STEADY, INTERFACE);
    const f = steadyFixture(program, writes);
    const assets = carry({ ...L.assets }, program);
    const [bake, judge] = onHost([
      bakeCall(fixturePiece(f as never, L.ref, assets), STEADY_STEPS),
      judgeCall(piece({ steady: { program, scene: STEADY, writes, links: [L.ref] } }, [], assets), STEADY_STEPS),
    ]);
    const b = bakeOf(bake!, 'the steady run\'s bake');
    expect(fixtureDiffers(b, f as never), 'the steady fixture\'s arrays hold within 1e-9 at steps 0, 1, 59, 60 and 599').toEqual([]);

    const last = b.steps.at(-1)!.arrays;
    const busyArea = num((last['fixture.busy_area'] as number[])[0], 'busy_area[0]'), now = num((last['fixture.clock'] as number[])[0], 'clock[0]');
    expect([now, busyArea / (1 * now)], 'after 10 hours (36,000 s) the busy share is 0.75 exactly').toEqual([36000, 0.75]);

    const q = STEADY_ST.queue;
    const dwell = numbers(series(b, 'fixture', 'dwell'), 'dwell').map((d) => d[q]!);
    const count = numbers(series(b, 'fixture', 'count'), 'count').map((c) => c[q]!);
    expect([dwell.every((d) => d === 0), count.every((c) => c === 0)], 'nothing ever waits: the queue\'s dwell stays 0 and it holds nothing at any step').toEqual([true, true]);
    const recN = numbers(series(b, 'fixture', 'rec_n'), 'rec_n').map((x) => x[0]!);
    const recW = numbers(series(b, 'fixture', 'rec_w'), 'rec_w');
    const times: number[] = [];
    recN.forEach((n, k) => { for (let i = k ? recN[k - 1]! : 0; i < n; i++) times.push(recW[k]![i % STEADY.ring]!); });
    expect(times.length, 'one record a minute: 600').toBe(600);
    expect(times.filter((w) => Math.abs(w - 45) > 1e-9), 'every time in system is 45 s').toEqual([]);

    const j = judged(judge!, 'steady');
    passes(rule(j, 'process.conserve'), 'process.conserve', STEADY_STEPS);
    passes(rule(j, 'process.busy'), 'process.busy', STEADY_STEPS);
    const little = rule(j, 'process.little');
    passes(little, 'process.little', 1);
    const at = little.values.find((v) => v['station'] === STEADY_ST.request);
    const all = little.values.find((v) => v['station'] === 'all');
    expect([at, all].map((v) => (v ? Math.abs(num(v['wip'], 'wip') - 0.75) <= 1e-9 : v)), `process.little reads mean work in progress 0.75 at the resource and in all: ${JSON.stringify(little.values)}`).toEqual([true, true]);
  }, TIMEOUT);
});
