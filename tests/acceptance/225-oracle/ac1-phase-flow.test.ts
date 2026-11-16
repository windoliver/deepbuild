// Oracle port for criteria 1 and 3 (AC1 #225.e195f5ff, AC3 #225.174320e5): the upstream tests'
// test_a_phase_flow_is_its_fields_flow (the oracle page: tests/unit/animation/test_motion.py:207-229, pinned at
// cfd33af5aa), run against our output.
//
// Upstream: a point at (1, 0.5) carried along a field for virtual time 2π over a one-second play, at 10 and 60 fps,
// ends on the field's exact flow within 1e-4, for the turn (−y, x) (back on its start) and the growth 0.5 p (e^π times
// its start). Ours: a film of 1 s at frame rate 10/1 or 60/1 holding `f`, a vector_field@1 of that fn with `streams:
// {starts: {points: [[1, 0.5, 0]]}, step: 0.05, time: 6.3, pad: 30}` (the pad keeps the growth's stream in its box),
// and `dot` riding it, `follow_stream {vector_field: f, from: [1, 0.5, 0], speed: 2π}`, so field time is 2π at 1 s,
// as upstream's virtual time is at its play's end (speed is f32, so the expected flow is taken at f32(2π)). The film is
// played in one session, every frame evaluated; at 1 s the dot's `at.pos` lies within 1e-4 of the exact flow.
// The planted fault: the #225 suite's `streams_euler` (every stream the data module integrates by forward Euler), on
// which each case must fail, naming the field.
import { describe, expect, it } from 'vitest';
import {
  FLICKS, TIMEOUT, dist, dot, evalAt, failsNaming, field, film, followStream, frameTimes, none, posOf, present, presented, run, scenario, turn, useBins, useFolders,
  type JsonObject, type Pt,
} from './helpers.ts';

const bin = useBins(['show']);
const folder = useFolders();
const START: Pt = [1, 0.5];
const TAU = Math.fround(2 * Math.PI);
const FLOWS: Record<string, { fn: JsonObject; exact: (p: Pt, t: number) => Pt }> = {
  turn: { fn: { x: '-y', y: 'x' }, exact: turn },
  growth: { fn: { x: '0.5 * x', y: '0.5 * y' }, exact: (p, t) => [p[0] * Math.exp(0.5 * t), p[1] * Math.exp(0.5 * t)] },
};

function filmOf(name: string, fps: number): JsonObject {
  return film(`the ${name} flow`, [640, 480], [
    field('f', 'a0', { fn: FLOWS[name]!.fn, streams: { starts: { points: [[...START, 0]] }, step: 0.05, time: 6.3, pad: 30 } }),
    dot('dot', 'a1'),
  ], { transport: { span: '1s', frame_rate: `${fps}/1` }, constraints: { ride: followStream('dot', 'f', [...START, 0], { speed: 2 * Math.PI }) } });
}
/** One case: the play's last frame, its dot against the exact flow; the failure names the field and the case. */
function judge(name: string, fps: number, planted?: string): string[] {
  const times = frameTimes(fps, 1);
  const replies = run(bin('show'), scenario(folder(), [present(filmOf(name, fps)), ...times.map((t) => evalAt(t, { paths: ['items/dot/at/pos'] }))], planted));
  presented(replies[0]!, `the ${name} film at ${fps} fps`);
  expect(times[times.length - 1], 'the play ends at 1 s').toBe(FLICKS);
  const p = posOf(replies[replies.length - 1]!, 'dot', `the ${name} film at ${fps} fps, 1 s`);
  const want = FLOWS[name]!.exact(START, TAU);
  const d = dist(p.slice(0, 2), want);
  return d <= 1e-4 ? [] : [`the dot on f (${name}, ${fps} fps) ends at (${p.join(', ')}), ${d.toExponential(3)} from the exact flow (${want.join(', ')})`];
}

describe('oracle: test_a_phase_flow_is_its_fields_flow (criteria 1 and 3)', () => {
  it('AC1 #225.e195f5ff AC3 #225.174320e5 a point carried along (−y, x) and 0.5 p for field time 2π, at 10 and 60 fps, ends on the exact flow within 1e-4', () => {
    none(['turn', 'growth'].flatMap((name) => [10, 60].flatMap((fps) => judge(name, fps))), 'the field\'s own flow');
  }, TIMEOUT);

  it('AC1 #225.e195f5ff AC3 #225.174320e5 the same cases fail under the planted Euler integrator, naming the field', () => {
    for (const name of ['turn', 'growth']) failsNaming(judge(name, 60, 'streams_euler'), ['dot on f'], `the ${name} case under streams_euler`);
  }, TIMEOUT);
});
