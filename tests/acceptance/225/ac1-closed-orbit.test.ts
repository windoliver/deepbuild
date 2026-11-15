// AC1 #225.e195f5ff: "F = (−y, x): the stream from (1, 0) for time 2π at step 0.05 returns within 1e-4 of its start; a
// planted Euler integrator ends more than 0.1 away and fails"
//
// The film: `swirl`, a vector_field@1 with `fn: {x: "-y", y: "x"}` and `streams: {starts: {points: [[1, 0, 0]]}, step:
// 0.05, time: 2π}` (pad 3, no arrows, no scales). Through `deep show` and `{"call": "vector_field", item: "swirl"}`
// (README: The surface under test), on the full build:
// - the field answers one stream, `swirl#s0`, its first point (1, 0) within 1e-12 and its last within 1e-4 of (1, 0);
// - the stream goes round: some point lies at least 1.9 from the start, and every point within 1e-6 of the unit circle
//   (RK4 at 0.05 keeps the radius far closer), so a stream that stops early or never moves fails.
// The planted program, the scenario's `planted: "streams_euler"` (README: The planted programs): every stream the data
// module integrates at check is stepped by forward Euler at the same step, all else as shipped. Under it the same
// stream ends 0.17 from its start (the radius grows by (1 + h²)^(n/2)); the test reads more than 0.1 and the judge
// fails, naming `swirl#s0`.
// Wrong programs: the base (no vector_field@1, no `vector_field` call); the plant; a stream that stops a step short of
// 2π (0.03 off); a stream read in a y-down frame or integrated in f32 (the circle check).
import { describe, expect, it } from 'vitest';
import { AC, SWIRL, TIMEOUT, dist, failsNaming, field, fieldCall, fieldOf, film, none, present, presented, run, scenario, useBins, useFolders, type Field } from './helpers.ts';

const bin = useBins(['show']);
const folder = useFolders();
const DOC = film('closed orbit', [640, 480], [field('swirl', 'a0', { fn: SWIRL, streams: { starts: { points: [[1, 0, 0]] }, step: 0.05, time: 2 * Math.PI } })]);

function answer(planted?: string): Field {
  const [shown, f] = run(bin('show'), scenario(folder(), [present(DOC), fieldCall('swirl')], planted));
  presented(shown!, `the swirl film${planted ? ` under ${planted}` : ''}`);
  return fieldOf(f!, `vector_field swirl${planted ? ` under ${planted}` : ''}`);
}
/** The judge: the stream from (1, 0) closes on its start within 1e-4, having gone round the unit circle. */
function judge(f: Field): string[] {
  const s = f.streams[0];
  if (f.streams.length !== 1 || !s) return [`the field answers ${f.streams.length} streams, not the one from (1, 0)`];
  const name = s.id;
  const first = s.points[0]!; const last = s.points[s.points.length - 1]!;
  const out: string[] = [];
  if (dist(first.slice(0, 2), [1, 0]) > 1e-12) out.push(`${name} starts at (${first.join(', ')}), not (1, 0)`);
  const end = dist(last.slice(0, 2), [1, 0]);
  if (!(end <= 1e-4)) out.push(`${name} ends ${end.toExponential(3)} from its start (1, 0), more than 1e-4`);
  if (Math.max(...s.points.map((p) => dist(p.slice(0, 2), [1, 0]))) < 1.9) out.push(`${name} never reaches the far side of the circle`);
  const off = s.points.findIndex((p) => Math.abs(Math.hypot(p[0]!, p[1]!) - 1) > 1e-6);
  if (off >= 0) out.push(`${name} leaves the unit circle at point ${off}: (${s.points[off]!.join(', ')})`);
  return out;
}

describe(`${AC[1]} the stream of (−y, x) from (1, 0) closes after 2π`, () => {
  it(`${AC[1]} the stream from (1, 0) for time 2π at step 0.05 returns within 1e-4 of its start`, () => {
    const f = answer();
    expect(f.dims, 'a 2D fn').toBe(2);
    expect(f.streams.map((s) => s.id), 'one stream, named <id>#s<i>').toEqual(['swirl#s0']);
    none(judge(f), 'the closed orbit');
  }, TIMEOUT);

  it(`${AC[1]} a planted Euler integrator ends more than 0.1 away and fails`, () => {
    const f = answer('streams_euler');
    const s = f.streams[0]!;
    const end = dist(s.points[s.points.length - 1]!.slice(0, 2), [1, 0]);
    expect(end, 'the Euler stream ends more than 0.1 from its start').toBeGreaterThan(0.1);
    failsNaming(judge(f), ['swirl#s0'], 'the judge under streams_euler');
  }, TIMEOUT);
});
