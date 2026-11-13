// #522.07ad2783: "A test build with the physics module and without the logic module seals and plays the ball-and-goal
// lab; in it a document whose world input takes `on: {logic: ID}` is refused with module_missing, naming the logic
// module, and no other document is; and a planted physics module that declares logic among its dependencies is refused
// at that build's seal, naming logic"
//
// The build is deep-show's full set without logic (#403's `test-leave-out-logic`); the lab is a scene listing the
// ball-and-goal lab as `lab`, taking its grab and release (README: Worlds), its ball's pose an output to the scene's
// ball. "Plays": `eval` of the scene's ball at frames 0, 30, 60, 90 and 120 equals the ball's state after steps 0, 60,
// 120, 180 and 240 in `deep-physics`'s bake of the same scene. The refused document is the lab whose world also declares
// `relaunch`, a launch taking `on: {logic: "coach"}`; it holds no logic item and requires no logic module, so the world
// input alone names logic. The documents that aren't refused: the lab, and the lab whose world also takes a launch
// derived from a press control (`on: {control: "kick"}`). The planted module is `test-physics-needs-logic` (README:
// deep-show), built with `test-leave-out-logic`: the seal refuses at startup, its `modules` naming logic and physics.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DOC, LAB_INPUTS, TIMEOUT, arr, camera, evalCall, issuesIn, lab, markBox, names, none, obj, physics, prebuild, prebuildShows,
  presented, runShow, scenario, sceneBake, sceneDoc, sealRefusalOf, show, showCall, showWith, startShow, statesOf, useTemp, valuesOf,
  type JsonObject,
} from './helpers.ts';

prebuild();
const NO_LOGIC = ['test-leave-out-logic'];
const NEEDS_LOGIC = ['test-leave-out-logic', 'test-physics-needs-logic'];
prebuildShows([NO_LOGIC, NEEDS_LOGIC]);

const ID = CRITERIA[2];
const temp = useTemp();
const BALL = 'items/ball/at/pos';
const FRAMES = [0, 30, 60, 90, 120];
const POSE_TOL = 1e-6;

/** The lab as a scene: its world `lab` with the given extra inputs, its ball's pose bound to the scene's ball. */
function labScene(inputs: JsonObject = {}, extra: JsonObject = {}): JsonObject {
  const w: JsonObject = { ...lab(), inputs: { ...LAB_INPUTS, ...inputs }, outputs: { ball: { from: 'ball', read: 'pose', to: 'items/ball/at' } } };
  return sceneDoc('Ball and goal', '2s', { cam: camera([4, 3, 12], [4, 0.5, 0]), ball: markBox([0.22, 0.22, 0.22]) }, { worlds: { lab: w }, ...extra });
}
const RELAUNCH: JsonObject = { relaunch: { kind: 'launch', targets: ['ball'], on: { logic: 'coach' } } };
const KICK: JsonObject = { kick: { kind: 'launch', targets: ['ball'], on: { control: 'kick', each: 'entry' }, data: { linear: [6, 3, 0.4] } } };
const KICK_CONTROL: JsonObject = { controls: { kick: { kind: 'press', class: 'document', label: 'Kick', role: 'button' } } };

describe(`${ID} a build with physics and without logic seals and plays the lab, refuses only the world input on logic, and refuses a physics module that depends on logic`, () => {
  it(`${ID} the build without the logic module seals with the physics module and plays the ball-and-goal lab`, () => {
    const scene = labScene();
    const [baked] = physics([sceneBake(scene, 'lab', 240)]);
    const ball = statesOf(baked!, 'ball', 241, 'deep-physics\'s bake of the lab');
    const doc = DOC(1);
    const [reg, shown, ...frames] = runShow(showWith(NO_LOGIC), scenario(temp(), [doc], [{ call: 'registry' }, showCall(doc, scene), ...FRAMES.map((f) => evalCall(doc, f, [BALL]))]), 'the lab without logic');
    const modules = arr(reg!['modules'], 'registry: modules').map(String);
    expect(modules, 'the build holds the physics module').toContain('physics');
    expect(modules, 'and no logic module').not.toContain('logic');
    presented(shown, 'the ball-and-goal lab');
    const fails: string[] = [];
    FRAMES.forEach((f, i) => {
      const pos = valuesOf(frames[i], `the lab at frame ${f}`)[BALL];
      const want = ball[2 * f]!.pos;
      if (!Array.isArray(pos) || pos.length !== 3 || pos.some((x, j) => typeof x !== 'number' || Math.abs(x - want[j]!) > POSE_TOL)) fails.push(`frame ${f}: the scene's ball is at ${show(pos)}, the lab's ball after step ${2 * f} at ${show(want)}`);
    });
    none(fails, 'the lab played in the build without logic');
    expect(ball[240]!.pos[0], 'the ball moves as kicked').toBeGreaterThan(1);
  }, TIMEOUT);

  it(`${ID} in that build a document whose world input takes on: {logic: ID} is refused with module_missing, naming the logic module, and no other document is`, () => {
    const [onLogic, plain, onControl] = [DOC(2), DOC(3), DOC(4)];
    const [refused, shownPlain, shownControl] = runShow(showWith(NO_LOGIC), scenario(temp(), [onLogic, plain, onControl], [
      showCall(onLogic, labScene(RELAUNCH)), showCall(plain, labScene()), showCall(onControl, labScene(KICK, KICK_CONTROL)),
    ]), 'the three labs without logic');
    expect(refused!['outcome'], `the lab whose world input takes on: {logic: "coach"} is refused: ${show(refused)}`).toBe('refused');
    const errors = issuesIn(refused, 'the refused lab').filter((i) => i['severity'] === 'error');
    const missing = errors.filter((i) => i['code'] === 'module_missing' && names(i, 'logic'));
    expect(missing.length, `with module_missing, naming the logic module: ${show(errors)}`).toBeGreaterThan(0);
    presented(shownPlain, 'the lab');
    presented(shownControl, 'the lab whose world takes a launch from a press control');
    for (const r of [shownPlain, shownControl]) expect(issuesIn(r, 'a presented lab').filter((i) => i['severity'] === 'error').map((i) => obj(i, 'issue')), 'no error issue').toEqual([]);
  }, TIMEOUT);

  it(`${ID} a planted physics module that declares logic among its dependencies (test-physics-needs-logic) is refused at that build's seal, naming logic`, () => {
    const s = startShow(showWith(NEEDS_LOGIC), scenario(temp(), [], [{ call: 'registry' }]));
    const refusal = sealRefusalOf(s, 'the build whose physics module depends on logic');
    expect(refusal.modules, `the refusal names logic, and the physics module that needs it: ${show(refusal.raw)}`).toEqual(expect.arrayContaining(['logic', 'physics']));
  }, TIMEOUT);
});
