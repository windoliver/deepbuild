// AC5 #225.eb041fdb: "The Lorenz system (σ 10, ρ 28, β 8/3) from (1, 1, 1) at step 0.005 for time 40 gives
// byte-identical points on two machines, at most 16,384 points"
//
// The film: `lorenz`, a vector_field@1 with `fn: {x: "10 * (y - x)", y: "x * (28 - z) - y", z: "x * y - 8 / 3 * z"}`,
// `arrows: {grid: {x: [−30, 30, 10], y: [−30, 30, 10], z: [0, 60, 10]}}` (343 arrows, the box the stream lives in) and
// `streams: {starts: {points: [[1, 1, 1]]}, step: 0.005, time: 40, pad: 60, max_points: 16384}` (one start, so up to
// 16,384 points; the wide pad keeps the attractor inside the box whichever box the stream is held to). Through
// `{"call": "vector_field", item: "lorenz"}` on the full build (README: The surface under test):
// - on this Mac: one stream `lorenz#s0`, 3D, 8,000 to 8,002 points (40 ÷ 0.005 steps and its start; at most 16,384);
//   its `bytes` are its points as little-endian f64, point after point; its first 1,000 points (field time 5) follow
//   this test's own RK4 within 1e-6 (later points part ways chaotically under any change of operation order, so only
//   the machines are compared there); and it fills the attractor: both lobes (x below −5 and above 5), z within (0, 55);
// - on the second machine, the same build for linux/amd64 in a Docker container (#408's way, README: Run): the same
//   scenario's stream, byte for byte.
// The comparison must be able to fail: run on this Mac's bytes with one bit flipped in point 4,000's z, it fails,
// naming that point. Without Docker or its image the second half can't run: BLOCKED with one ask, never a pass.
// Wrong programs: the base (no vector_field@1); a platform-dependent function or summation order in the integrator (the
// bytes differ, naming the first point); a stream cut at 512 points or past 16,384; Euler or another step (the RK4
// comparison).
import { describe, expect, it } from 'vitest';
import {
  AC, LORENZ, TIMEOUT, blocked, buildLinux, f64s, failsNaming, field, fieldCall, fieldOf, film, linuxImage, linuxMissing, lorenz, none, present, presented, rk4, run,
  runLinux, scenario, useBins, useFolders, type JsonObject, type Stream,
} from './helpers.ts';

const bin = useBins(['show']);
const folder = useFolders();
const DOC: JsonObject = film('the Lorenz attractor', [640, 480], [field('lorenz', 'a0', {
  fn: LORENZ,
  arrows: { grid: { x: [-30, 30, 10], y: [-30, 30, 10], z: [0, 60, 10] } },
  streams: { starts: { points: [[1, 1, 1]] }, step: 0.005, time: 40, pad: 60, max_points: 16384 },
})]);
const CALLS = [present(DOC), fieldCall('lorenz')];

/** The one stream on this machine, with its bytes checked against its points. */
function streamOf(replies: JsonObject[], where: string): Stream {
  presented(replies[0]!, `the Lorenz film on ${where}`);
  const f = fieldOf(replies[1]!, `vector_field lorenz on ${where}`);
  expect(f.dims, `${where}: a 3D fn`).toBe(3);
  expect(f.streams.map((s) => s.id), `${where}: one stream from the one start`).toEqual(['lorenz#s0']);
  const s = f.streams[0]!;
  expect(f64s(s.bytes), `${where}: the stream's bytes are its points as little-endian f64`).toEqual(s.points.flat());
  return s;
}
/** The two machines' streams byte for byte; each failure names the first point that differs. */
function compare(mac: string, linux: string): string[] {
  if (mac === linux) return [];
  const a = Buffer.from(mac, 'base64'); const b = Buffer.from(linux, 'base64');
  if (a.length !== b.length) return [`lorenz#s0 holds ${a.length / 24} points on this Mac and ${b.length / 24} on linux/amd64`];
  const at = a.findIndex((v, i) => v !== b[i]);
  return [`lorenz#s0 differs from point ${Math.floor(at / 24)} on (byte ${at}): this Mac ${a.readDoubleLE(Math.floor(at / 8) * 8)}, linux/amd64 ${b.readDoubleLE(Math.floor(at / 8) * 8)}`];
}

describe(`${AC[5]} the Lorenz trajectory, byte for byte on two machines`, () => {
  it(`${AC[5]} the Lorenz system (σ 10, ρ 28, β 8/3) from (1, 1, 1) at step 0.005 for time 40 gives byte-identical points on this Mac and on linux/amd64, at most 16,384 points`, () => {
    const mac = streamOf(run(bin('show'), scenario(folder(), CALLS)), 'this Mac');
    const failures: string[] = [];
    const n = mac.points.length;
    if (n < 8000 || n > 8002 || n > 16384) failures.push(`lorenz#s0 holds ${n} points, not the 8,000 steps of 0.005 over 40 and its start (at most 16,384)`);
    const ref = rk4(lorenz, [1, 1, 1], 0.005, 1000);
    const off = ref.findIndex((p, i) => { const q = mac.points[i]; return !q || Math.hypot(...p.map((v, k) => v - q[k]!)) > 1e-6; });
    if (off >= 0) failures.push(`lorenz#s0's point ${off} (${mac.points[off]?.join(', ')}) is more than 1e-6 from RK4's (${ref[off]!.join(', ')})`);
    const xs = mac.points.map((p) => p[0]!); const zs = mac.points.map((p) => p[2]!);
    if (!(Math.min(...xs) < -5 && Math.max(...xs) > 5)) failures.push(`lorenz#s0 visits one lobe only: x in [${Math.min(...xs)}, ${Math.max(...xs)}]`);
    if (!(Math.min(...zs) > 0 && Math.max(...zs) < 55)) failures.push(`lorenz#s0 leaves the attractor: z in [${Math.min(...zs)}, ${Math.max(...zs)}]`);
    none(failures, 'the Lorenz stream on this Mac');

    // The comparison fails on a planted twin: this Mac's bytes with one bit flipped in point 4,000's z.
    const twin = Buffer.from(mac.bytes, 'base64');
    twin[4000 * 24 + 16] = twin[4000 * 24 + 16]! ^ 1;
    failsNaming(compare(mac.bytes, twin.toString('base64')), ['point 4000'], 'the comparison on a twin one bit off');

    const missing = linuxMissing();
    if (missing) blocked(`the second machine, linux/amd64 in Docker, can't run here: ${missing}`, `start Docker and run: docker pull --platform linux/amd64 ${linuxImage()}`);
    const built = buildLinux();
    expect(built, 'deep-show builds for linux/amd64').toBe('');
    const linux = streamOf(runLinux(scenario('/evidence', CALLS), folder()), 'linux/amd64');
    none(compare(mac.bytes, linux.bytes), 'this Mac against linux/amd64, byte for byte');
  }, 4 * TIMEOUT);
});
