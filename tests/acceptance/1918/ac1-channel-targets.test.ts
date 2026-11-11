// #1918.adfa6a63: a kinematic body following a channel, a motor with a channel target and a kinematic solve's drivers
// read their channels at each step's time, inside the step: the body's pose at every step equals its channel at that
// step's time, a seek reproduces every pose, and a channel physics reads that depends on a physics pose is refused as a
// cycle (parity/physics/channel-targets.scene).
//
// The fixture (fixtures/parity/physics/channel-targets.scene, README: The fixture) is a scene with two worlds: `rig`
// (dynamic: the kinematic paddle following items/paddle/at/pos, and the wheel on the hinge `spin` whose velocity motor
// reads items/dial/at/pos/0) and `linkage` (kinematic mode: the solve drives the slider `rail` from
// items/slider/at/pos/0). Step k's time is k ÷ 120 s; every expected value is the fixture's own channel keys evaluated
// here at that time, or the behavior kit's motor answer (90°/s within 1%, 0.5 s after it's set).
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, STEP, TIMEOUT, arr, channelAt, clone, errorsOf, fixture, keysOf, none, obj, physics, prebuild, sOf, sceneBake, sceneCheck,
  sceneRestore, show, statesOf, type JsonObject, type State,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[1];
const SCENE = fixture('parity/physics/channel-targets.scene');
/** 2 s at 120 Hz: the scene's span. */
const N = 240;
const channels = obj(SCENE['channels'], 'the fixture\'s channels');
const PADDLE = keysOf(channels['paddle'], 'channels.paddle');
const DIAL = keysOf(channels['dial'], 'channels.dial');
const SLIDER = keysOf(channels['slider'], 'channels.slider');
/** f32 of a channel value read in f64 is within 1e-7 m at these sizes; a step's travel on the slowest segment is 2 mm. */
const POSE_TOL = 1e-6;
/** The kinematic solve's own tolerance (Kinematic solve: `tolerance: m = 1e-5`, the fixture's). */
const SOLVE_TOL = 1e-5;

const at = (k: number): string => `step ${k} (${sOf(k * STEP)})`;

describe(`${ID} channels physics reads are read at each step's time, inside the step; a seek reproduces every pose; a channel that depends on a physics pose is refused as a cycle`, () => {
  it(`${ID} (steps) the paddle's position at every step is its channel's at that step's time, the wheel's motor first turns it in the step that ends at its key, and the solve holds the slider on its channel at every step`, () => {
    const [checkRig, checkLinkage, rig, linkage] = physics([sceneCheck(SCENE, 'rig'), sceneCheck(SCENE, 'linkage'), sceneBake(SCENE, 'rig', N), sceneBake(SCENE, 'linkage', N)]);
    none(errorsOf(checkRig, 'check of the rig').map((i) => show(i)), 'the fixture\'s rig world checks with no error');
    none(errorsOf(checkLinkage, 'check of the linkage').map((i) => show(i)), 'the fixture\'s linkage world checks with no error');
    const fails: string[] = [];

    // The kinematic paddle: its position after step k is items/paddle/at/pos at k ÷ 120 s.
    const paddle = statesOf(rig!, 'paddle', N + 1, 'the rig\'s bake');
    paddle.forEach((s, k) => {
      const want = channelAt(PADDLE, k * STEP);
      if (s.pos.some((x, i) => Math.abs(x - want[i]!) > POSE_TOL)) fails.push(`paddle: at ${at(k)} its position is ${show(s.pos)}, its channel there is ${show(want)}`);
    });

    // The motor: its target is 0 until the dial's key, then that key's value in deg/s. Read at each step's own time,
    // the step that ends at the key's time is the first to turn the wheel; 0.5 s later it turns at the target (the
    // behavior kit's hinge motor, within 1%).
    const key = DIAL.find((k) => k.value[0] !== 0);
    expect(key && Number.isInteger(key.t / STEP), 'the fixture\'s dial channel steps to its target at a step\'s time').toBe(true);
    const on = key!.t / STEP;
    const target = key!.value[0]!;
    const wheel = statesOf(rig!, 'wheel', N + 1, 'the rig\'s bake');
    const spin = (s: State): number => s.angular[1];
    for (let k = 0; k < on; k++) if (Math.abs(spin(wheel[k]!)) > 1e-3) fails.push(`spin: the wheel turns at ${spin(wheel[k]!)} deg/s at ${at(k)}, before the step that reads the dial's ${target} deg/s (${at(on)})`);
    if (!(spin(wheel[on]!) > 1)) fails.push(`spin: the step ending at the dial's key (${at(on)}) doesn't turn the wheel (${spin(wheel[on]!)} deg/s): the motor didn't read its target at that step's time`);
    const later = wheel[on + 60]!;
    if (Math.abs(spin(later) - target) > 0.01 * target) fails.push(`spin: 0.5 s after the dial's key (${at(on + 60)}) the wheel turns at ${spin(later)} deg/s, not within 1% of its target ${target}`);

    // The kinematic solve: the slider's coordinate after step k is items/slider/at/pos/0 at k ÷ 120 s, within the solve's tolerance.
    const slide = statesOf(linkage!, 'slide', N + 1, 'the linkage\'s bake');
    slide.forEach((s, k) => {
      const want = channelAt(SLIDER, k * STEP)[0]!;
      if (Math.abs(s.pos[0] - want) > SOLVE_TOL || Math.abs(s.pos[1]) > SOLVE_TOL || Math.abs(s.pos[2]) > SOLVE_TOL) fails.push(`rail: at ${at(k)} the slider is at ${show(s.pos)}, its channel there is [${want}, 0, 0]`);
    });
    none(fails, 'every step reads its channels at its own time');
  }, TIMEOUT);

  it(`${ID} (seek) a seek reproduces every pose: each world restored from each of its checkpoints and stepped to 2 s gives the straight bake's pose at every step`, () => {
    const worlds = ['rig', 'linkage'] as const;
    const bakes = physics(worlds.map((w) => sceneBake(SCENE, w, N, { checkpoints: true })));
    const fails: string[] = [];
    worlds.forEach((w, wi) => {
      const straight = bakes[wi]!;
      const ids = Object.keys(obj(straight['bodies'], `the ${w} bake: bodies`));
      const states = Object.fromEntries(ids.map((id) => [id, statesOf(straight, id, N + 1, `the ${w} bake`)]));
      const cps = arr(straight['checkpoints'], `the ${w} bake: checkpoints`).map((c) => obj(c, `the ${w} bake: a checkpoint`)).filter((c) => (c['step'] as number) < N);
      expect(cps.map((c) => c['step']), `the ${w} bake takes a checkpoint every 60 steps`).toEqual([60, 120, 180]);
      const restored = physics(cps.map((c) => sceneRestore(SCENE, w, c, N - (c['step'] as number))));
      cps.forEach((c, ci) => {
        const from = c['step'] as number;
        for (const id of ids) {
          statesOf(restored[ci]!, id, N - from + 1, `${w} restored at step ${from}`).forEach((s, i) => {
            const want = states[id]![from + i]!;
            if (JSON.stringify([s.pos, s.rot]) !== JSON.stringify([want.pos, want.rot])) fails.push(`${w}: ${id} restored at step ${from} is at ${show([s.pos, s.rot])} after step ${from + i}, the straight bake's pose there is ${show([want.pos, want.rot])}`);
          });
        }
      });
    });
    none(fails, 'every pose after a seek is the straight bake\'s');
  }, TIMEOUT);

  it(`${ID} (cycle) a channel physics reads that depends on a physics pose is refused as a cycle: the motor's target written by a driver that reads the wheel's own output`, () => {
    // The fixture with the dial's channel replaced by a driver of the same path that reads items/wheel/at/pos/1, which
    // the rig's output writes from the wheel's pose: the motor's target then depends on the pose it moves.
    const looped = clone(SCENE);
    delete obj(looped['channels'], 'channels')['dial'];
    looped['drivers'] = { dial: { target: 'items/dial/at/pos/0', expr: '30 * y', vars: { y: 'items/wheel/at/pos/1' } } } as JsonObject;
    const [clean, refused] = physics([sceneCheck(SCENE, 'rig'), sceneCheck(looped, 'rig')]);
    none(errorsOf(clean, 'check of the fixture').map((i) => show(i)), 'the fixture itself checks with no error');
    const cycles = errorsOf(refused, 'check of the looped scene').filter((i) => i['code'] === 'cycle');
    expect(cycles.length, `the looped scene is refused with an error issue of code cycle: ${show(errorsOf(refused, 'check of the looped scene'))}`).toBeGreaterThan(0);
    expect(cycles.some((i) => JSON.stringify(i).includes('items/dial/at/pos/0')), `the cycle names the path physics reads, items/dial/at/pos/0: ${show(cycles)}`).toBe(true);
  }, TIMEOUT);
});
