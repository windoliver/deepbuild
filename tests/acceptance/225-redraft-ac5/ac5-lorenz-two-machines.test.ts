// AC5 #225.eb041fdb: "The Lorenz system (σ 10, ρ 28, β 8/3) from (1, 1, 1) at step 0.005 for time 40 gives
// byte-identical points on two machines, at most 16,384 points"
//
// The document (helpers.ts, `lorenzDocument`): one `vector_field@1`, `lorenz`, with fn {x: 10 * (y - x), y: x * (28 -
// z) - y, z: x * y - 8 / 3 * z}, one stream from the point (1, 1, 1) by RK4 at step 0.005 for time 40, `max_points`
// 16,384, inside its arrows' grid box x, y −30..30, z 0..60. Your shell shows it with `deep show`; then deep-show's
// `streams` call (README: The surface under test) gives the stream `lorenz#s0` and its points.
//
// The two machines: this arm64 Mac, and Linux x86_64 in a linux/amd64 container on it (canvas primitives: Golden: a
// golden verifies on the other CPU architecture, and an emulated linux/amd64 container counts for CPU checks). Each
// runs `deep-show` built `full` from this checkout; the container runs with no network.
//
// The judge: on each machine the film is presented with no error and its one stream is the Lorenz system's: at most
// 16,384 points, 8,001 ± 1 of them (time 40 ÷ step 0.005 steps after the start), the first (1, 1, 1) exactly, and
// within 1e-6 of a classic RK4 written here from the criterion's numbers up to field time 10. Then the points' bytes,
// each x, y and z as little-endian f64, are the same on both machines (SHA-256 equal); a difference names its first
// point and axis with both values and their ulps.
//
// Not decidable here is never a pass: off an arm64 Mac, without Docker, or without the build image (README: Linux
// x86_64), the test fails BLOCKED with one unblock ask; no digest is recorded or read from a file.
//
// Wrong programs: the base (no `vector_field@1`, no `streams` call); points that differ in one bit between the two
// architectures (an fma or a platform libm on one of them), shown failing below as a twin made in test code; equal
// points that aren't the Lorenz stream (an Euler integrator, a stream cut short), the twins below; more than 16,384
// points.
import { describe, expect, it } from 'vitest';
import {
  AC5, LORENZ, STEPS, STREAM, TIMEOUT, blocked, buildHere, buildLinux, failsNaming, linuxBlocked, lorenzEuler, lorenzRk4, none,
  runHere, runLinux, sameBytesFailures, scenario, sha256, bytesOf, streamFailures, streamOf, useFolders, type Vec3,
} from './helpers.ts';

const folder = useFolders();
const MAC = 'macOS arm64';
const LINUX = 'Linux x86_64';

describe(`AC5 ${AC5} the Lorenz system's stream is the same bytes on two machines`, () => {
  it(`AC5 ${AC5} the Lorenz system (σ 10, ρ 28, β 8/3) from (1, 1, 1) at step 0.005 for time 40 gives byte-identical points on macOS arm64 and Linux x86_64, at most 16,384 points`, () => {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
      blocked(`this is ${process.platform} ${process.arch}; the first machine is the arm64 reference Mac`, 'run this file on the reference Mac');
    }

    const built = buildHere(folder());
    expect(built.error, 'deep-show builds `full` on this Mac').toBe('');
    const here = streamOf(runHere(built.bin, scenario(folder())), MAC);
    none(here.failures, `the Lorenz film gives ${STREAM} on ${MAC}`);
    none(streamFailures(here.points!, MAC), `${STREAM} on ${MAC} is the Lorenz system's stream`);

    const missing = linuxBlocked();
    if (missing) blocked(`${MAC} decided ${STREAM} (${here.points!.length} points), but ${LINUX} can't run here: ${missing.reason}`, missing.ask);
    const linuxBuild = buildLinux();
    if (linuxBuild.error && linuxBuild.crashes === 2) blocked(`the emulated ${LINUX} build crashed three times on a signal: ${linuxBuild.error}`, 'run this file again when the machine is less loaded; cargo resumes from the crates already built');
    expect(linuxBuild.error, `deep-show builds \`full\` for ${LINUX}`).toBe('');
    const linux = runLinux(scenario(folder()), folder());
    expect(linux.arch, `the second machine is x86_64, as the container reports it`).toBe('x86_64');
    const there = streamOf(linux.replies, LINUX);
    none(there.failures, `the Lorenz film gives ${STREAM} on ${LINUX}`);
    none(streamFailures(there.points!, LINUX), `${STREAM} on ${LINUX} is the Lorenz system's stream`);

    none(sameBytesFailures(here.points!, there.points!, [MAC, LINUX]), `${STREAM}'s points are byte-identical on ${MAC} and ${LINUX}`);
    console.log(`#225 AC5 ${STREAM}: ${here.points!.length} points, SHA-256 ${sha256(bytesOf(here.points!))} on ${MAC} and ${sha256(bytesOf(there.points!))} on ${LINUX}`);
  }, TIMEOUT);

  it(`AC5 ${AC5} the judge fails twins: one bit apart on the second machine, an Euler stream on both, a stream cut short, and more than 16,384 points`, () => {
    // The clean twin: the reference RK4's whole stream, on both machines, passes every judge.
    const clean = lorenzRk4(STEPS);
    none(streamFailures(clean, MAC), 'the reference RK4 stream is the Lorenz system\'s');
    none(sameBytesFailures(clean, clean.map((p) => [...p] as Vec3), [MAC, LINUX]), 'the same stream on both machines is byte-identical');

    // One bit apart: point 4,000's z on the second machine is the next f64 up, as an fma on one architecture gives.
    const nudged = clean.map((p) => [...p] as Vec3);
    const b = Buffer.alloc(8);
    b.writeDoubleLE(nudged[4_000]![2]);
    b.writeBigInt64LE(b.readBigInt64LE() + 1n);
    nudged[4_000]![2] = b.readDoubleLE();
    none(streamFailures(nudged, LINUX), 'the nudged stream is still the Lorenz system\'s by its tolerance, so only the bytes can catch it');
    failsNaming(sameBytesFailures(clean, nudged, [MAC, LINUX]), ['point 4000, z', '1 ulps apart', MAC, LINUX], 'points one bit apart on the second machine');

    // Equal on both machines but not the Lorenz system's stream: forward Euler at the same step.
    const euler = lorenzEuler(STEPS);
    none(sameBytesFailures(euler, euler, [MAC, LINUX]), 'the Euler stream is the same on both machines');
    failsNaming(streamFailures(euler, MAC), ['point 1 ', 'RK4'], 'an Euler stream');

    // Cut short at field time 20, and run past the cap: each fails on its count.
    failsNaming(streamFailures(clean.slice(0, STEPS / 2 + 1), MAC), [`${STEPS / 2 + 1} points`, `time ${LORENZ.time}`], 'a stream cut short');
    const long = lorenzRk4(LORENZ.maxPoints);
    failsNaming(streamFailures(long, MAC), [`${LORENZ.maxPoints + 1} points, more than ${LORENZ.maxPoints}`], 'a stream past 16,384 points');
  });
});
