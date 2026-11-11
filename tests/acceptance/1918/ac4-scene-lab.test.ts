// #1918.1b4ea358: in a scene that lists a world as lab, the world's output to items/ball/at moves the scene's ball, a
// driver that counts the hits in lab.occurrences whose tags include wood equals the number of such hits up to each
// frame's t, and editing the scene channel a kinematic paddle follows changes the bake's key and replays the new motion.
//
// The rally (below): a scene listing a world as `lab`, in which a ball kicked at (6, 3, 0) m/s bounces on turf (tag
// grass) into an oak board (tag wood), a kinematic paddle that follows the scene's channel on items/paddle/at/pos,
// creeping 0.4 m toward the kick over 2 s; the world's output binds the ball's pose to items/ball/at, and the driver
// `wood` writes count(hits tagged wood) into the tally's x. The same scene goes to `deep-physics` (its bake: the ball's
// states and the occurrence list) and to `deep-show run` (the scene's evaluated values, README: `eval`'s `paths`). The
// edit moves the paddle's channel 1 m back, so the ball meets the board later.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DOC, STEP, TIMEOUT, box, camera, channelAt, dynamic, evalCall, floor, keyOf, keysOf, markBox, none, obj, physics, prebuild,
  prebuildShow, presented, rowText, rowsOf, runShow, scenario, sceneBake, sceneDoc, show, showBin, showCall, sphere, statesOf, useTemp,
  valuesOf, world, type JsonObject, type Row,
} from './helpers.ts';

prebuild();
prebuildShow(['full']);

const ID = CRITERIA[4];
const temp = useTemp();
/** 2 s at 120 Hz, and its 60 fps frames 0 to 120; frame f sits at step 2f exactly (α = 0). */
const N = 240;
const LAST = 120;
const BALL = 'items/ball/at/pos';
const TALLY = 'items/tally/at/pos/0';
/** The ball's item against its body: the same f32 pose, read through the output. */
const POSE_TOL = 1e-6;

/** The rally with the paddle's channel starting at x0 (m). */
function rally(x0: number): JsonObject {
  const lab = world({
    contact_materials: {
      turf: { friction: 0.6, restitution: 0.1, density: 1000, tag: 'grass' },
      leather: { friction: 0.5, restitution: 0.4, density: 80, tag: 'leather' },
      oak: { friction: 0.4, restitution: 0.5, density: 700, tag: 'wood' },
    },
    shapes: { floor: box([30, 0.1, 30]), ball: sphere(0.11), board: box([0.05, 0.6, 1]) },
    bodies: {
      floor: floor('turf'),
      ball: dynamic('ball', 'leather', [0, 0.11, 0], { mass: 0.43, velocity: { linear: [6, 3, 0] } }),
      paddle: { kind: 'kinematic', shapes: [{ shape: 'board', contact_material: 'oak' }], pose: { pos: [x0, 0.65, 0] }, follow: 'items/paddle/at/pos' },
    },
    outputs: { ball: { from: 'ball', read: 'pose', to: 'items/ball/at' } },
  });
  return sceneDoc('Rally', '2s', {
    cam: camera([3, 3, 12], [3, 0.5, 0]),
    ball: markBox([0.22, 0.22, 0.22]),
    paddle: markBox([0.1, 1.2, 2], [x0, 0.65, 0]),
    tally: markBox([0.1, 0.1, 0.1], [0, 4, 0]),
  }, {
    channels: { paddle: { target: 'items/paddle/at/pos', type: 'vec3', keys: { k0: { t: '0s', value: [x0, 0.65, 0], interp: 'linear' }, k1: { t: '2s', value: [x0 - 0.4, 0.65, 0], interp: 'hold' } } } },
    drivers: { wood: { target: TALLY, expr: 'count(h)', vars: { h: { list: 'lab.occurrences', kinds: ['hit'], tags: ['wood'] } } } },
    worlds: { lab },
  });
}
const tagsOf = (r: Row): string[] => (Array.isArray(r.raw['tags']) ? r.raw['tags'].map(String) : []);
const vec3 = (v: unknown, what: string): number[] => {
  expect(Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number'), `${what} is a position [x, y, z], got ${show(v as never)}`).toBe(true);
  return v as number[];
};

describe(`${ID} a scene that lists a world as lab: its output moves the scene's ball, a driver counts its wood hits, and an edited channel the paddle follows rebakes`, () => {
  it(`${ID} (scene) the world's output to items/ball/at moves the scene's ball, and the driver counting lab.occurrences' hits tagged wood equals the number of such hits up to each frame's t`, () => {
    const scene = rally(5);
    const [baked] = physics([sceneBake(scene, 'lab', N)]);
    const ball = statesOf(baked!, 'ball', N + 1, 'the lab\'s bake');
    const hits = rowsOf(baked, 'the lab\'s bake').filter((r) => r.kind === 'hit');
    const wood = hits.filter((r) => tagsOf(r).includes('wood'));
    expect(wood.length, `the ball hits the oak board: the lab's hits are ${hits.map((r) => `${rowText(r)} ${show(r.raw['tags'])}`).join('; ') || 'none'}`).toBeGreaterThan(0);
    expect(hits.length, `and the turf, untagged wood: ${hits.map((r) => `${rowText(r)} ${show(r.raw['tags'])}`).join('; ')}`).toBeGreaterThan(wood.length);

    const doc = DOC(41);
    const frames = Array.from({ length: LAST + 1 }, (_, f) => f);
    const replies = runShow(showBin('full'), scenario(temp(), [doc], [showCall(doc, scene), ...frames.map((f) => evalCall(doc, f, [BALL, TALLY]))]), 'the rally, played');
    presented(replies[0], 'the rally');
    const fails: string[] = [];
    let moved: number[] = [];
    frames.forEach((f) => {
      const values = valuesOf(replies[1 + f], `the rally at frame ${f}`);
      const pos = vec3(values[BALL], `${BALL} at frame ${f}`);
      if (f === 30) moved = pos;
      const want = ball[2 * f]!.pos;
      if (pos.some((x, i) => Math.abs(x - want[i]!) > POSE_TOL)) fails.push(`frame ${f}: the scene's ball is at ${show(pos)}, the lab's ball after step ${2 * f} is at ${show(want)}`);
      const count = wood.filter((r) => r.step <= 2 * f).length;
      if (values[TALLY] !== count) fails.push(`frame ${f}: the driver reads ${show(values[TALLY])} wood hits, the list holds ${count} up to step ${2 * f}`);
    });
    none(fails, 'the scene\'s ball and the wood-hit count at every frame');
    expect(Math.abs(moved[0]! - 3) <= 0.03, `the ball moves as kicked: at 0.5 s its x is ${show(moved)}, 6 m/s × 0.5 s = 3 m within 1%`).toBe(true);
  }, TIMEOUT);

  it(`${ID} (edit) editing the scene channel the kinematic paddle follows changes the bake's key and replays the new motion`, () => {
    const [before, after] = [rally(5), rally(6)];
    const store = temp();
    const [a, again, b] = physics([sceneBake(before, 'lab', N, { store }), sceneBake(before, 'lab', N, { store }), sceneBake(after, 'lab', N, { store })]);
    const [ka, kb] = [keyOf(a!, 'the bake before the edit'), keyOf(b!, 'the bake after the edit')];
    expect([keyOf(again!, 'the same scene baked again'), again!['reused']], 'the same scene keys the same bake and reuses it').toEqual([ka, true]);
    expect(kb, 'the edited channel changes the bake\'s key').not.toBe(ka);
    expect(b!['reused'], 'and the edited scene is baked again, not read from the store').toBe(false);

    const keys = keysOf(obj(after['channels'], 'channels')['paddle'], 'the edited channels.paddle');
    const fails: string[] = [];
    statesOf(b!, 'paddle', N + 1, 'the bake after the edit').forEach((s, k) => {
      const want = channelAt(keys, k * STEP);
      if (s.pos.some((x, i) => Math.abs(x - want[i]!) > POSE_TOL)) fails.push(`the paddle after step ${k} is at ${show(s.pos)}, its edited channel there is ${show(want)}`);
    });
    none(fails, 'the paddle follows the edited channel');
    const ballA = statesOf(a!, 'ball', N + 1, 'the bake before the edit');
    const ballB = statesOf(b!, 'ball', N + 1, 'the bake after the edit');
    expect(ballB.some((s, k) => s.pos.some((x, i) => Math.abs(x - ballA[k]!.pos[i]!) > 1e-3)), 'the ball meets the moved board: its motion changes').toBe(true);

    const doc = DOC(42);
    const replies = runShow(showBin('full'), scenario(temp(), [doc], [showCall(doc, before), evalCall(doc, LAST, [BALL]), showCall(doc, after), evalCall(doc, LAST, [BALL])]), 'the rally, edited');
    presented(replies[0], 'the rally');
    presented(replies[2], 'the edited rally');
    const end = [vec3(valuesOf(replies[1], 'the rally at 2 s')[BALL], `${BALL} at 2 s`), vec3(valuesOf(replies[3], 'the edited rally at 2 s')[BALL], `${BALL} at 2 s, edited`)];
    const want = [ballA[N]!.pos, ballB[N]!.pos];
    end.forEach((pos, i) => expect(pos.every((x, j) => Math.abs(x - want[i]![j]!) <= POSE_TOL), `${i ? 'after' : 'before'} the edit the scene's ball at 2 s is at ${show(pos)}, that bake's ball is at ${show(want[i])}`).toBe(true));
  }, TIMEOUT);
});
