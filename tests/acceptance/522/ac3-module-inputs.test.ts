// #522.80128e91: "A test canvas module that contributes a launch input for step 240 launches the ball at that step, and
// a replay gives the same step hashes; that input and a control-derived input on the same step apply in (kind, target
// ID) order whichever module wrote first"
//
// The test canvas module is `test.launch` (README: deep-show), in deep-show's full set under `test-launch-module`, and
// under `test-launch-module-first`, the same module writing its entries on the core's input track before the input
// module's of the same step instead of after. The scene lists the lab as `lab` with its ball at rest at the kick spot,
// an item `launcher` of kind `test.launch@1` firing a launch at (6, 3, 0.4) m/s for step 240, and a press control
// `nudge`; the world's input `kick` takes `on: {"test.launch": "launcher"}`, and `nudge`, a poke of +2 m/s along z, takes
// `on: {control: "nudge"}`. The track holds one press of `nudge` at 2 s (step 240's time). `physics_bake` (README) reads
// the world's bake in its scene: its step hashes and the entries it keeps, in the order they apply, each with the
// module or control it came from and the order it was written. The replay is `deep-physics`'s bake of the same world
// with the kept entries as its track: the same step hashes, and the ball at rest after step 240 and launched after 241.
// Order: the two builds write in opposite orders and give the same applied order and step hashes; `deep-physics` gives
// them too with the kept entries in either order on its track; and the ball's z velocity after step 241 shows the two
// applied one after the other in that order (launch then poke: 0.4 + 2 m/s; poke then launch: 0.4 m/s).
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DOC, STEP, TIMEOUT, arr, ask, bakeCall, camera, hashesOf, lab, markBox, obj, presented, prebuild, prebuildShows, runShow,
  scenario, sceneDoc, show, showCall, showWith, statesOf, useTemp, type JsonObject, type JsonValue,
} from './helpers.ts';

prebuild();
const LAUNCH = ['test-launch-module'];
const FIRST = ['test-launch-module-first'];
prebuildShows([LAUNCH, FIRST]);

const ID = CRITERIA[3];
const temp = useTemp();
const AT = 240;
const STEPS = 480;
const LINEAR: [number, number, number] = [6, 3, 0.4];
const PUSH: [number, number, number] = [0, 0, 2];
const TOL = 0.15;

/** The lab with its ball at rest, the launch the test module contributes and the poke a press of `nudge` derives. */
function launchWorld(outputs: JsonObject): JsonObject {
  const w = lab();
  const bodies = obj(w['bodies'], 'bodies');
  return {
    ...w,
    bodies: { ...bodies, ball: { ...obj(bodies['ball'], 'ball'), velocity: { linear: [0, 0, 0] } } },
    inputs: {
      kick: { kind: 'launch', targets: ['ball'], on: { 'test.launch': 'launcher' } },
      nudge: { kind: 'poke', targets: ['ball'], on: { control: 'nudge', each: 'entry' }, data: { push: PUSH } },
    },
    outputs,
  };
}
const SCENE = sceneDoc('Ball and goal, launched', '4s', {
  cam: camera([4, 3, 12], [4, 0.5, 0]),
  ball: markBox([0.22, 0.22, 0.22]),
  launcher: { kind: 'test.launch@1', params: { step: AT, linear: LINEAR } },
}, {
  requires: { modules: { scene3d: '^1', 'test.launch': '^1' } },
  controls: { nudge: { kind: 'press', class: 'document', label: 'Nudge', role: 'button' } },
  worlds: { lab: launchWorld({ ball: { from: 'ball', read: 'pose', to: 'items/ball/at' } }) },
});
/** The replay's world: the same, its ball's position an output of its own (no scene to bind it to). */
const REPLAY = launchWorld({ ball: { from: 'ball', read: 'position' } });
const PRESS: JsonObject = { t: AT * STEP, seq: 0, control: 'nudge', value: 1, writer: 'you', player: 1 };

interface Kept { step: number; kind: string; target: string; input: string; from: string; written: number; data: JsonObject }
interface Baked { key: string; hashes: string[]; kept: Kept[] }
function bakedIn(features: string[], what: string): Baked {
  const doc = DOC(30);
  const [shown, baked] = runShow(showWith(features), scenario(temp(), [doc], [showCall(doc, SCENE), { call: 'physics_bake', doc, world: 'lab', track: [PRESS] }]), what);
  presented(shown, `${what}: the scene`);
  expect(baked?.['ok'], `${what}: physics_bake answers the lab's bake: ${show(baked)}`).toBe(true);
  const hashes = hashesOf(baked, `${what}: the lab's bake`);
  expect(hashes.length, `${what}: the bake runs the scene's 4 s, 480 steps`).toBe(STEPS + 1);
  const kept = arr(baked!['inputs'], `${what}: the entries the bake keeps`).map((v: JsonValue, i) => {
    const o = obj(v, `${what}: inputs[${i}]`);
    return { step: o['step'] as number, kind: String(o['kind']), target: String(o['target']), input: String(o['input']), from: String(o['from']), written: o['written'] as number, data: obj(o['data'] ?? {}, `${what}: inputs[${i}].data`) };
  });
  return { key: String(baked!['key']), hashes, kept };
}
const asTrack = (kept: readonly Kept[]): JsonObject[] => kept.map((k) => ({ step: k.step, kind: k.kind, target: k.target, data: k.data }));
const both = (kept: readonly Kept[]): string => kept.map((k) => `${k.kind}/${k.target} from ${k.from}`).join(', ');

describe(`${ID} a test canvas module's launch input reaches the world at its step, replays the same, and orders with a control's input by (kind, target ID)`, () => {
  it(`${ID} the test module's launch for step ${AT} launches the ball at that step, kept in the bake, and a replay of the kept entries gives the same step hashes`, () => {
    const a = bakedIn(LAUNCH, 'test-launch-module');
    const launch = a.kept.find((k) => k.kind === 'launch');
    const poke = a.kept.find((k) => k.kind === 'poke');
    expect(a.kept.length, `the bake keeps the two entries of step ${AT}: ${both(a.kept)}`).toBe(2);
    expect(launch && [launch.step, launch.target, launch.input, launch.from, launch.data['linear']], 'the test module\'s launch, for step 240, to the input kick').toEqual([AT, 'ball', 'kick', 'test.launch:launcher', LINEAR]);
    expect(poke && [poke.step, poke.target, poke.input, poke.from, poke.data['push']], 'and the poke the press of nudge derives, at the same step').toEqual([AT, 'ball', 'nudge', 'control:nudge', PUSH]);

    const [replay] = ask([bakeCall(REPLAY, asTrack(a.kept), STEPS)]);
    expect(hashesOf(replay, 'the replay'), 'a replay of the kept entries gives the same step hashes').toEqual(a.hashes);
    const ball = statesOf(replay!, 'ball', STEPS + 1, 'the replay');
    const rest = ball[AT]!;
    expect(Math.hypot(...rest.linear) < 0.05 && Math.abs(rest.pos[0]) < 0.01, `after step ${AT} the ball still rests at the kick spot: ${show(rest as unknown as JsonValue)}`).toBe(true);
    const off = ball[AT + 1]!;
    expect(Math.abs(off.linear[0] - LINEAR[0]) <= TOL && Math.abs(off.pos[0] - rest.pos[0] - LINEAR[0] / 120) <= 0.01, `after step ${AT + 1} it is launched at 6 m/s along x: ${show(off as unknown as JsonValue)}`).toBe(true);
  }, TIMEOUT);

  it(`${ID} that launch and the control-derived poke on the same step apply in (kind, target ID) order whichever module wrote first`, () => {
    const a = bakedIn(LAUNCH, 'test-launch-module');
    const b = bakedIn(FIRST, 'test-launch-module-first');
    const order = (x: Baked, what: string): number => {
      const l = x.kept.find((k) => k.kind === 'launch');
      const p = x.kept.find((k) => k.kind === 'poke');
      expect(l && p, `${what}: the bake keeps the launch and the poke: ${both(x.kept)}`).toBeTruthy();
      return Math.sign(l!.written - p!.written);
    };
    expect([order(a, 'test-launch-module'), order(b, 'test-launch-module-first')], 'the test module writes its launch after the control\'s entry in one build and before it in the other').toEqual([1, -1]);
    expect(b.kept.map((k) => k.kind), 'the entries apply in the same order whichever wrote first').toEqual(a.kept.map((k) => k.kind));
    expect(b.hashes, 'and give the same step hashes').toEqual(a.hashes);

    const track = asTrack(a.kept);
    const [same, reversed] = ask([bakeCall(REPLAY, track, STEPS), bakeCall(REPLAY, [...track].reverse(), STEPS)]);
    expect(hashesOf(same, 'the entries in the order kept'), 'the physics module applies them so too').toEqual(a.hashes);
    expect(hashesOf(reversed, 'the entries the other way round on the track'), 'whatever their order on its track').toEqual(a.hashes);
    const vz = statesOf(same!, 'ball', STEPS + 1, 'the replay')[AT + 1]!.linear[2];
    const launchFirst = a.kept[0]!.kind === 'launch';
    const want = launchFirst ? LINEAR[2] + PUSH[2] : LINEAR[2];
    expect(Math.abs(vz - want) <= TOL, `applied one after the other, ${launchFirst ? 'the launch then the poke' : 'the poke then the launch'}: the ball's z velocity after step ${AT + 1} is ${vz}, want ${want}`).toBe(true);
  }, TIMEOUT);
});
