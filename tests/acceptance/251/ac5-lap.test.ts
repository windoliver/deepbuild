// #251.eadd341f: "A lap of a small course, 1,200 steps of drive, steer and brake inputs from a logic item, gives the
// same full-state hash at every checkpoint and the same step hashes when seeked from each checkpoint as a straight run,
// and its golden recorded on macOS matches on Linux; a planted checkpoint that leaves out the steer it holds fails,
// naming the first step and that field; and the physics module passes the conformance kit's carried-state and
// late-entry parts (#138) on that course"
//
// The course (README: The lap): level ground with four posts, the kart settled at the origin, its drive, steer and brake
// declared `on: {logic: "driver"}`, and the 1,200 steps of entries that logic item fires, given as the track a bake
// keeps (#522: a kept entry replays through deep-physics whatever its `on`). Seek: the straight bake with its
// checkpoints (every 60 steps); from each checkpoint before step 1,200, a restore stepped to 1,200 on the same track,
// whose step hashes must be the straight run's from that checkpoint on and whose own checkpoints' full-state (deep)
// hashes must be the straight run's at the same steps. Where they differ, the judge names the first step, and there
// the first field of the kart's own state (`vehicles`) or of its body that differs. Golden: recorded on this Mac with the
// track, verified in #2012's linux/amd64 lane. Kit: #138's `kit` in `deep-show run` (the full build), its
// `carried_state` and `late_entry` parts over the physics module's fixture of this course, `parity/physics/vehicle-lap.*`.
import { describe, expect, it } from 'vitest';
import {
  CONTAINER_TIMEOUT, CRITERIA, LAP_STEPS, LAP_TRACK, LINUX_X86, TIMEOUT, arr, ask, bakeRun, caught, checkCall, errorsOf, goldenOf, hashesOf, kartOf, kit,
  lapWorld, matchFailures, moduleOf, naming, none, num, obj, onLane, partIn, prebuild, prebuildShows, recordGolden, referenceMac, scratch,
  show, showWith, str, useTemp, vehicleDifferences, vehiclesOf, verifyGolden, type JsonObject, type Planted, type State,
} from './helpers.ts';

prebuild();
prebuildShows([]);
const temp = useTemp();

const ID = CRITERIA[5];
const FIXTURE = 'parity/physics/vehicle-lap.';
const FIELDS = ['pos', 'rot', 'linear', 'angular'] as const;

interface Checkpoint { step: number; deepHash: string; raw: JsonObject }
const checkpointsOf = (reply: JsonObject, what: string): Checkpoint[] => arr(reply['checkpoints'], `${what}: checkpoints`).map((c, i) => {
  const o = obj(c, `${what}: checkpoints[${i}]`);
  return { step: num(o['step'], `${what}: checkpoints[${i}].step`), deepHash: str(o['deep_hash'], `${what}: checkpoints[${i}].deep_hash`), raw: o };
});

/** The first field of the kart that differs between two states of one step, its own state first, then its body's. */
function fieldsAt(a: State, b: State, av: Parameters<typeof vehicleDifferences>[0], bv: Parameters<typeof vehicleDifferences>[0]): string[] {
  const out = vehicleDifferences(av, bv);
  for (const f of FIELDS) a[f].forEach((x, i) => { if (!Object.is(x, b[f][i])) out.push(`${f}.${'xyzw'[i]} is ${b[f][i]} after the seek and ${x} in the straight run`); });
  return out;
}

/** Seeking from each checkpoint equals the straight run: step hashes, checkpoints' full-state hashes, naming the first step and field that differ. */
function seekFailures(planted?: Planted): string[] {
  const w = lapWorld();
  const [straight] = ask([bakeRun(w, LAP_STEPS, LAP_TRACK, { checkpoints: true })], planted, 'the lap, straight');
  const hashes = hashesOf(straight, 'the lap, straight');
  expect(hashes.length, 'the straight lap holds a step hash for the built state and each of its 1,200 steps').toBe(LAP_STEPS + 1);
  const states = kartOf(straight!, LAP_STEPS + 1, 'the lap, straight');
  const vehicles = vehiclesOf(straight!, 'kart', LAP_STEPS + 1, 'the lap, straight');
  const cps = checkpointsOf(straight!, 'the lap, straight');
  const at = new Map(cps.map((c) => [c.step, c.deepHash]));
  const from = cps.filter((c) => c.step < LAP_STEPS);
  expect(from.map((c) => c.step), 'the straight lap keeps a checkpoint every 60 steps before step 1,200').toEqual(Array.from({ length: LAP_STEPS / 60 - 1 }, (_, i) => 60 * (i + 1)));
  const replies = ask(from.map((c) => ({ call: 'restore', world: w, track: LAP_TRACK, checkpoint: c.raw, steps: LAP_STEPS - c.step, read: ['kart'], checkpoints: true })), planted, 'the lap, seeked');
  const f: string[] = [];
  from.forEach((c, j) => {
    const what = `the seek from the checkpoint at step ${c.step}`;
    const n = LAP_STEPS - c.step + 1;
    const r = replies[j]!;
    const sought = hashesOf(r, what);
    const s = kartOf(r, n, what);
    const v = vehiclesOf(r, 'kart', n, what);
    for (let i = 0; i < n; i++) {
      const k = c.step + i;
      const fields = fieldsAt(states[k]!, s[i]!, vehicles[k]!, v[i]!);
      if (sought[i] !== hashes[k] || fields.length) {
        f.push(`${what}: step ${k}: ${fields.length ? `kart ${fields[0]}` : `its step hash ${sought[i]} isn't the straight run's ${hashes[k]}, though no state field differs`}`);
        break;
      }
    }
    for (const x of checkpointsOf(r, what).filter((x) => x.step > c.step)) {
      if (at.get(x.step) !== x.deepHash) f.push(`${what}: its checkpoint at step ${x.step} has full-state hash ${x.deepHash}, the straight run's ${show(at.get(x.step))}`);
    }
  });
  return f;
}

describe(`${ID} a 1,200-step lap seeks equal to playing, its golden matches on Linux, and the kit's carried-state and late-entry parts pass on it`, () => {
  it(`${ID} seeked from each checkpoint, the lap gives the straight run's step hashes and the same full-state hash at every checkpoint`, () => {
    none(seekFailures(), 'the lap seeked from each checkpoint');
  }, TIMEOUT);

  it(`${ID} the lap's golden recorded on macOS matches on Linux x86_64 step for step`, () => {
    referenceMac();
    const w = lapWorld();
    const golden = goldenOf(ask([{ ...recordGolden(w, LAP_STEPS, scratch('lap-golden'), [LINUX_X86]), track: LAP_TRACK }], undefined, 'recording the lap on this Mac')[0]!, 'the lap\'s golden');
    expect(obj(golden['machine'], 'the golden\'s machine')['os'], 'the golden is recorded on macOS').toBe('macos');
    const [linux] = onLane('linux/amd64', [verifyGolden(golden, w, LAP_STEPS, { track: LAP_TRACK })]);
    none(matchFailures(linux!, golden, { target: LINUX_X86, arch: 'x86_64', os: 'linux', machines: 'different' }, 'the lap replayed on Linux x86_64'), 'the lap\'s golden recorded on macOS matches on Linux');
  }, CONTAINER_TIMEOUT);

  it(`${ID} (twin: checkpoint_drops_steer) a checkpoint that leaves out the steer it holds fails, naming the first step and that field`, () => {
    const failures = seekFailures('checkpoint_drops_steer');
    caught(failures, 'checkpoint_drops_steer');
    naming(failures.slice(0, 1), /^the seek from the checkpoint at step \d+: step \d+: kart steer is /, 'checkpoint_drops_steer\'s first failure names the first step and the field steer');
  }, TIMEOUT);

  it(`${ID} the physics module passes the conformance kit's carried-state and late-entry parts on the course`, () => {
    const [checked] = ask([checkCall(lapWorld())], undefined, 'the course');
    expect(errorsOf(checked, 'the course'), 'the course is admitted').toEqual([]);
    const m = moduleOf(kit(showWith([]), temp(), { modules: ['physics'], parts: ['carried_state', 'late_entry'] }), 'physics');
    const f: string[] = [];
    for (const part of ['carried_state', 'late_entry'] as const) {
      const p = partIn(m, part);
      const cases = p.cases.filter((c) => c.fixture?.startsWith(FIXTURE));
      if (!cases.length) f.push(`${part}: no case runs the course's fixture ${FIXTURE}*; its cases: ${show(p.cases.map((c) => c.fixture ?? c.case) as unknown as JsonObject[])}`);
      for (const c of cases.filter((x) => x.verdict !== 'PASS')) f.push(`${part}: ${c.case} on ${c.fixture} reads ${c.verdict}: ${show(c.raw)}`);
      if (p.verdict !== 'PASS') f.push(`${part}: the part reads ${p.verdict}: ${show(p.failures as unknown as JsonObject[])}`);
    }
    none(f, 'the kit\'s carried-state and late-entry parts on the course');
  }, TIMEOUT);
});
