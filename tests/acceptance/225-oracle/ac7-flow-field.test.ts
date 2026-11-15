// Oracle port for criterion 7 (AC7 #225.57b5ccba): the upstream tests' test_a_phase_flow_is_its_fields_flow (the
// oracle page: tests/unit/animation/test_motion.py:207-229, pinned at cfd33af5aa), run against a group's warp flowing
// along our vector field.
//
// Upstream: a point at (1, 0.5) carried along the field for time 2π, at 10 and 60 fps, lands on the exact flow within
// 1e-4, for the turn (−y, x) and the growth 0.5 p. Ours: a film of 1 s at frame rate 10/1 or 60/1 holding `f`, a
// vector_field@1 of that fn with `streams: {starts: {points: [[1, 0.5, 0]]}, step: 0.05, time: 1, pad: 30}`, and
// group `g` on the plane of origin (320, 240) u, unit 100 u, y up, its identity linear warp flowing along `f` for time
// 2π (#223's spelling; f32, so the exact flow is taken at f32(2π)); its child `mark`, the path from the plane's (1, 0.5)
// to (1, 0.6). Played in one session, every frame evaluated; deep-show's `path` at 1 s draws the mark's first point
// within 1e-4 in the plane (0.01 u) of the exact flow of (1, 0.5).
// The planted fault, a fixture written the wrong way: the same group with no flow must fail, naming the mark.
import { describe, it } from 'vitest';
import {
  TIMEOUT, dist, evalAt, failsNaming, field, film, fl, flowGroup, frameTimes, none, pathCall, pathItem, present, presented, run, scenario, subpathsOf, toPlane,
  toScreen, turn, useBins, useFolders, type JsonObject, type Plane, type Pt,
} from './helpers.ts';

const bin = useBins(['show']);
const folder = useFolders();
const PLANE: Plane = { origin: [320, 240], unit: 100 };
const START: Pt = [1, 0.5];
const TAU = Math.fround(2 * Math.PI);
const FLOWS: Record<string, { fn: JsonObject; exact: (p: Pt, t: number) => Pt }> = {
  turn: { fn: { x: '-y', y: 'x' }, exact: turn },
  growth: { fn: { x: '0.5 * x', y: '0.5 * y' }, exact: (p, t) => [p[0] * Math.exp(0.5 * t), p[1] * Math.exp(0.5 * t)] },
};

function judge(name: string, fps: number, flow: boolean): string[] {
  const doc = film(`a mark flowing along the ${name} field`, [640, 480], [
    field('f', 'a0', { fn: FLOWS[name]!.fn, streams: { starts: { points: [[...START, 0]] }, step: 0.05, time: 1, pad: 30 } }),
    flowGroup('g', 'a1', PLANE, 'f', flow ? 2 * Math.PI : null),
    pathItem('mark', 'a2', `M ${toScreen(PLANE, START).join(' ')} L ${toScreen(PLANE, [1, 0.6]).join(' ')}`, { parent: 'g' }),
  ], { transport: { span: '1s', frame_rate: `${fps}/1` } });
  const replies = run(bin('show'), scenario(folder(), [present(doc), ...frameTimes(fps, 1).map((t) => evalAt(t)), pathCall('mark', fl(1))]));
  presented(replies[0]!, `the ${name} film at ${fps} fps`);
  const drawn = subpathsOf(replies[replies.length - 1]!, `the mark (${name}, ${fps} fps)`);
  const first = drawn[0]?.[0];
  if (!first) return [`the mark (${name}, ${fps} fps) draws nothing`];
  const at = toPlane(PLANE, first);
  const want = FLOWS[name]!.exact(START, TAU);
  const d = dist(at, want);
  return d <= 1e-4 ? [] : [`the mark (${name}, ${fps} fps) starts at (${at.join(', ')}) in the plane, ${d.toExponential(3)} from the exact flow (${want.join(', ')})`];
}

describe('oracle: test_a_phase_flow_is_its_fields_flow, for a group\'s flow (criterion 7)', () => {
  it('AC7 #225.57b5ccba a point flowed along (−y, x) and 0.5 p for time 2π, at 10 and 60 fps, lands on the exact flow within 1e-4', () => {
    none(['turn', 'growth'].flatMap((name) => [10, 60].flatMap((fps) => judge(name, fps, true))), 'the warp\'s flow along the field');
  }, TIMEOUT);

  it('AC7 #225.57b5ccba the same check fails on the group written without its flow, naming the mark', () => {
    failsNaming(judge('turn', 60, false), ['the mark (turn, 60 fps)'], 'the group without flow');
  }, TIMEOUT);
});
