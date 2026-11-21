// #2310.648e6d3e: "The 10 kg chain's bake, seeked from each checkpoint, gives the same step hashes as a straight run,
// its golden recorded on macOS arm64 matches on Linux x86_64 and in wasm32, and a world with no articulated joint gives
// step hashes byte-identical to the merge base's. A planted checkpoint that leaves the joints' coordinates out fails,
// naming the first step and the body"
//
// The 10 kg chain here is the one let go level (README: The worlds; Readings): every joint turns at every step, so a
// joint's coordinates are in every checkpoint and every step hash differs from the one before.
//
// The seek is #522's: the chain is baked 4 s into a store with its checkpoints (one every 60 steps), then `seek`
// restores each checkpoint in turn and plays on to step 480. Each seek's states and step hashes must be the straight
// run's from its checkpoint on; a failure names the first step that differs and, there, the first body in canonical
// order. The same judge runs on `--planted checkpoint_drops_joint_coordinates`.
//
// The golden is #2010's, recorded here by the release build and replayed as #2012's suite replays one: on this Mac, in
// wasm32 through `node scripts/physics-wasm32.mjs`, and on Linux x86_64 in the lane's pinned image run as linux/amd64
// (`../2012/helpers.ts`, imported read only). Each replay answers its own step hashes, held to the golden's at every
// step, and a second replay on each leg, shifted one ulp at step 240, must differ first at step 240, so a leg that
// echoed the golden is caught. The golden is recorded and replayed here before either leg is built.
//
// The merge base's step hashes are #2241's comparison: the release build of `git merge-base HEAD origin/main`, built
// apart by #191's `mergeBasePhysics`, bakes four worlds with no articulated joint, and this checkout's hashes must be
// the same strings. The comparison is not vacuous: the chain on articulated joints has other step hashes than the
// same chain on separate joints, so these hashes see an articulation; that is asserted first, before the merge base
// is built.
import { describe, expect, it } from 'vitest';
import { CONTAINER_TIMEOUT, LINUX_X86, WASM32, matchFailures, onLane, onWasm32, shiftedFailures } from '../2012/helpers.ts';
import {
  AC, BOB, STEPS, TIMEOUT, ask, askBase, bake, chain, checkpointsOf, goldenOf, handAndTorso, hingeLimit, hingeMotor, prebuild, repeats, runOf,
  sameFailures, seek, seekFailures, useTemp, withBase, type JsonObject, type Planted, type Run,
} from './helpers.ts';

prebuild(['release']);
withBase();
const temp = useTemp();

const ID = AC[7];
const TWIN: Planted = 'checkpoint_drops_joint_coordinates';
const CHAIN = 'the 10 kg chain let go level';
/** The step a replay is shifted at: 2 s, mid-swing. */
const AT = STEPS / 2;

interface Sought { straight: Run | string; checkpoints: number[] | string; failures: string[]; problem: string }
/** The chain baked into a store with its checkpoints, then sought from each of them, in one process. */
function sought(planted?: Planted): Sought {
  const [w, store] = [chain({ bob: 10, level: true }), temp()];
  const baked = ask([bake(w, STEPS, { store, checkpoints: true })], planted ? { planted } : {});
  if (baked.problem !== '') return { straight: '', checkpoints: '', failures: [], problem: baked.problem };
  const straight = runOf(w, baked.replies[0], `${CHAIN}, on articulated joints`);
  const checkpoints = checkpointsOf(baked.replies[0], 'the bake');
  if (typeof straight === 'string' || typeof checkpoints === 'string') return { straight, checkpoints, failures: [], problem: '' };
  const seeks = ask(checkpoints.map((c) => seek(w, store, c)), planted ? { planted } : {});
  return { straight, checkpoints, failures: checkpoints.flatMap((c, i) => seekFailures(w, straight, seeks.replies[i], c)), problem: seeks.problem };
}

describe(`${ID} the 10 kg chain seeks as it plays, its golden matches on Linux x86_64 and in wasm32, and a world with no articulated joint steps as the merge base steps it`, () => {
  it(`${ID} the 10 kg chain's bake, seeked from each checkpoint, gives the same step hashes as a straight run`, () => {
    const s = sought();
    expect(s.problem, 'deep-physics answers the bake and the seeks').toBe('');
    expect(typeof s.straight === 'string' ? s.straight : '', `${CHAIN} bakes 4 s into a store, on articulated joints`).toBe('');
    expect(typeof s.checkpoints === 'string' ? s.checkpoints : '', 'the bake lists the checkpoints it keeps').toBe('');
    const [straight, checkpoints] = [s.straight as Run, s.checkpoints as number[]];
    // Not vacuous: more than one checkpoint inside the run to seek from, and a hash that follows the chain.
    const hollow: string[] = [];
    if (checkpoints.filter((c) => c > 0 && c < STEPS).length < 2) hollow.push(`INCONCLUSIVE: the bake keeps fewer than two checkpoints inside its 4 s to seek from (${checkpoints.join(', ')}); this is not a pass`);
    if (repeats(straight.hashes).length) hollow.push(`INCONCLUSIVE: the swinging chain's step hash repeats the step before's at ${repeats(straight.hashes).length} steps (first at step ${repeats(straight.hashes)[0]!}), so equal hashes would prove little; this is not a pass`);
    const failures = [...hollow, ...s.failures];
    expect(failures, `${CHAIN}, sought from each of its checkpoints (${checkpoints.join(', ')}) and played on, against the straight run:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: ${TWIN}) a planted checkpoint that leaves the joints' coordinates out fails, naming the first step and the body`, () => {
    const s = sought(TWIN);
    expect(s.problem, `deep-physics --planted ${TWIN} runs and answers the bake and the seeks`).toBe('');
    expect(typeof s.straight === 'string' ? s.straight : '', `--planted ${TWIN} bakes ${CHAIN} into a store`).toBe('');
    expect(typeof s.checkpoints === 'string' ? s.checkpoints : '', 'the bake lists the checkpoints it keeps').toBe('');
    expect(s.failures.length, `${TWIN} is caught: the judge that passes the real program finds a seek that isn't the straight run`).toBeGreaterThan(0);
    const named = /^the seek from the checkpoint at step \d+: step \d+: (link_\d\d|bob) (pos|rot|linear|angular) is /.test(s.failures[0] ?? '');
    expect(named, `the first failure names the first step that differs and the body:\n  ${s.failures.slice(0, 4).join('\n  ')}`).toBe(true);
  }, TIMEOUT);

  it(`${ID} the 10 kg chain's golden recorded on macOS arm64 matches on Linux x86_64 and in wasm32, step for step`, () => {
    expect(`${process.platform} ${process.arch}`, 'BLOCKED: the golden is recorded on macOS arm64, and this host is another; this is not a pass').toBe('darwin arm64');
    const w = chain({ bob: 10, level: true });
    const recorded = ask([{ call: 'golden', world: w, steps: STEPS, store: temp(), verify_on: [LINUX_X86, WASM32] }]);
    expect(recorded.problem, `${recorded.what} answers the golden call`).toBe('');
    const g = goldenOf(recorded.replies[0], `the golden of ${CHAIN}, on articulated joints,`);
    expect(typeof g === 'string' ? g : '', 'the golden is recorded on this Mac').toBe('');
    const golden = g as JsonObject;
    const machine = golden['machine'] as JsonObject | undefined;
    expect([machine?.['os'], machine?.['arch'], golden['verify_on']], 'the golden is recorded on macOS arm64, to verify on Linux x86_64 and in wasm32').toEqual(['macos', 'aarch64', [LINUX_X86, WASM32]]);

    const replays: JsonObject[] = [
      { call: 'golden_verify', golden, world: w, steps: STEPS },
      { call: 'golden_verify', golden, world: w, steps: STEPS, shift: { step: AT, id: BOB, field: 'linear.x', ulps: 1 } },
    ];
    const here = ask(replays);
    expect(here.problem, `${here.what} answers the replays on this Mac`).toBe('');
    const local = [
      ...matchFailures(here.replies[0]!, golden, { target: String(golden['record_on']), arch: 'aarch64', os: 'macos', machines: 'same' }, 'this Mac\'s replay'),
      ...shiftedFailures(here.replies[1]!, golden, AT, `this Mac's replay shifted one ulp at step ${AT}`),
    ];
    expect(local, `this Mac replays its own golden step for step, and a replay shifted at step ${AT} differs there:\n  ${local.join('\n  ')}`).toEqual([]);

    const [wasm, wasmShifted] = onWasm32(replays);
    const inWasm = [
      ...matchFailures(wasm!, golden, { target: WASM32, arch: 'wasm32', machines: 'different' }, 'the wasm32 replay'),
      ...shiftedFailures(wasmShifted!, golden, AT, `the wasm32 replay shifted one ulp at step ${AT}`),
    ];
    expect(inWasm, `the golden matches in wasm32 step for step, and that leg steps the world itself:\n  ${inWasm.join('\n  ')}`).toEqual([]);

    const [linux, linuxShifted] = onLane('linux/amd64', replays);
    const onLinux = [
      ...matchFailures(linux!, golden, { target: LINUX_X86, arch: 'x86_64', os: 'linux', machines: 'different' }, 'the Linux x86_64 replay'),
      ...shiftedFailures(linuxShifted!, golden, AT, `the Linux x86_64 replay shifted one ulp at step ${AT}`),
    ];
    expect(onLinux, `the golden matches on Linux x86_64 step for step, and that leg steps the world itself:\n  ${onLinux.join('\n  ')}`).toEqual([]);
  }, CONTAINER_TIMEOUT);

  it(`${ID} a world with no articulated joint gives step hashes byte-identical to the merge base's, and the chain on articulated joints has other step hashes than the same chain on separate ones`, () => {
    const worlds: [string, JsonObject, number][] = [
      [`${CHAIN}, on separate joints`, chain({ bob: 10, level: true, articulated: false }), STEPS],
      ['the hand and the torso, on separate joints', handAndTorso(false), STEPS],
      ['the hinge limited to ±30°, on a separate joint', hingeLimit(false), STEPS / 2],
      ['the hinge motor, on a separate joint', hingeMotor(false), STEPS / 4],
    ];
    const articulated = chain({ bob: 10, level: true });
    const here = ask([...worlds.map(([, w, n]) => bake(w, n)), bake(articulated)]);
    expect(here.problem, `${here.what} answers the bakes`).toBe('');
    const mine = worlds.map(([name, w, n], i) => runOf(w, here.replies[i], name, n + 1));
    const unread = mine.filter((r): r is string => typeof r === 'string');
    expect(unread, 'each world with no articulated joint bakes here').toEqual([]);
    const runs = mine as Run[];

    // Not vacuous: these step hashes see an articulation, and follow the bodies.
    const on = runOf(articulated, here.replies[worlds.length], `${CHAIN}, on articulated joints,`);
    const seen: string[] = [];
    if (typeof on === 'string') seen.push(`nothing shows these step hashes see an articulation: ${on}`);
    else if (sameFailures(on.hashes, runs[0]!.hashes, CHAIN, 'on separate joints').length === 0) seen.push(`${CHAIN} has the same step hashes on articulated joints as on separate ones, so nothing shows the wrapper builds it another way`);
    if (repeats(runs[0]!.hashes).length) seen.push(`INCONCLUSIVE: ${worlds[0]![0]}: its step hash repeats the step before's at ${repeats(runs[0]!.hashes).length} steps, so equal hashes would prove little; this is not a pass`);
    expect(seen, `the comparison with the merge base is of hashes that see an articulation:\n  ${seen.join('\n  ')}`).toEqual([]);

    const there = askBase(worlds.map(([, w, n]) => bake(w, n)));
    expect(there.problem, `${there.what} answers the bakes`).toBe('');
    const other = `on the merge base ${there.sha.slice(0, 12)}`;
    const failures = worlds.flatMap(([name, w, n], i) => {
      const base = runOf(w, there.replies[i], `${name}, ${other}`, n + 1);
      return typeof base === 'string' ? [base] : sameFailures(runs[i]!.hashes, base.hashes, name, other);
    });
    expect(failures, `step hashes of worlds with no articulated joint, against the merge base's:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, 4 * TIMEOUT);
});
