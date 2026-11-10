// #2010.45fbb8dc: with no second machine configured, a cross-machine golden is BLOCKED with one unblock ask naming the
// target, never PASS or INCONCLUSIVE, and with one configured it is pending until that machine has run it.
//
// A golden recorded on this machine verifies on the other CPU architecture (Golden): Linux x86_64 for this arm64 Mac.
// `golden_cross` judges it from the second machines configured (README: `machines`, the hosts block's entries) and the
// runs given; a run on this machine's own architecture never counts. The configured machine's run is real: the same
// checkout built for linux/amd64 in Docker (helpers: onLinux), as #532's suite builds its second host.
import { describe, expect, it } from 'vitest';
import {
  ARCH, CRITERIA, LINUX_TIMEOUT, OTHER, TIMEOUT, answered, arr, ask, blocked, crossGolden, goldenOf, hostTriple, obj, onLinux, pileAndFlyer,
  prebuild, recordGolden, scratch, show, str, verifyGolden, type JsonObject,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[3];
const N = 240;
const MACHINE: JsonObject = { name: 'linux-amd64', target: OTHER };

function recorded(): { golden: JsonObject; w: JsonObject } {
  const w = pileAndFlyer();
  const golden = goldenOf(ask([recordGolden(w, N, scratch('ac3-store'), [OTHER])])[0]!, 'golden');
  expect(golden['verify_on'], `the golden verifies on ${OTHER}`).toEqual([OTHER]);
  expect(golden['record_on'], 'the golden names the target that recorded it').toBe(hostTriple());
  expect(obj(golden['machine'], 'golden: machine')['arch'], 'the golden names this machine\'s architecture').toBe(ARCH);
  return { golden, w };
}
/** BLOCKED with exactly one unblock ask, naming the target. */
function blockedFailures(reply: JsonObject): string[] {
  const f: string[] = [];
  if (reply['verdict'] !== 'BLOCKED') f.push(`the verdict is ${show(reply['verdict'])}, not BLOCKED`);
  const asks = Array.isArray(reply['asks']) ? reply['asks'] : [];
  if (asks.length !== 1) f.push(`${asks.length} asks, not one: ${show(reply['asks'])}`);
  const a = asks[0];
  if (typeof a !== 'object' || a === null || Array.isArray(a) || a['kind'] !== 'unblock' || a['target'] !== OTHER) f.push(`the ask isn't an unblock ask naming ${OTHER}: ${show(a)}`);
  return f;
}

describe(`${ID} a cross-machine golden is BLOCKED with no second machine, and pending until the configured one has run it`, () => {
  it(`${ID} with no second machine configured, a golden recorded here that verifies on ${OTHER} is BLOCKED with one unblock ask naming ${OTHER}, never PASS or INCONCLUSIVE, even after this machine has verified it`, () => {
    const { golden, w } = recorded();
    const [none0, here] = ask([crossGolden(golden, [], []), verifyGolden(golden, w, N)]);
    expect(blockedFailures(answered(none0, 'golden_cross with no machine and no run')), `no second machine: ${show(none0)}`).toEqual([]);
    expect(answered(here, 'this machine\'s run')['verdict'], `this machine's run matches its own golden: ${show(here)}`).toBe('PASS');
    expect(here!['target'], 'this machine\'s run names its target').toBe(hostTriple());
    const [sameArch] = ask([crossGolden(golden, [], [here!])]);
    expect(blockedFailures(answered(sameArch, 'golden_cross with this machine\'s run')), `a run on the recording architecture doesn't satisfy cross-machine: ${show(sameArch)}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} with ${OTHER} configured as a second machine, the golden is pending until that machine has run it, then takes that run's verdict`, () => {
    const { golden, w } = recorded();
    const [pending, here] = ask([crossGolden(golden, [MACHINE], []), verifyGolden(golden, w, N)]);
    expect(answered(pending, 'golden_cross with the machine configured')['verdict'], `configured, not yet run: ${show(pending)}`).toBe('PENDING');
    expect(arr(pending!['asks'], 'asks'), 'pending asks nothing').toEqual([]);
    const [stillPending] = ask([crossGolden(golden, [MACHINE], [answered(here, 'this machine\'s run')])]);
    expect(answered(stillPending, 'golden_cross with this machine\'s run')['verdict'], `this machine's run isn't the configured machine's: ${show(stillPending)}`).toBe('PENDING');
    if (OTHER !== 'x86_64-unknown-linux-gnu') blocked(`the configured machine here is ${OTHER}, which this suite can't run (it runs Linux x86_64 in Docker on an arm64 Mac)`);
    const [linux] = onLinux([verifyGolden(golden, w, N)]);
    const run = answered(linux, 'the configured machine\'s run');
    expect(str(run['target'], 'its target'), 'the run is the configured machine\'s target').toBe(OTHER);
    expect(obj(run['machine'], 'its machine')['arch'], 'the run names the other architecture').toBe('x86_64');
    expect(['PASS', 'FAIL'], `the configured machine's run has a verdict: ${show(run)}`).toContain(run['verdict']);
    const [done] = ask([crossGolden(golden, [MACHINE], [here!, run])]);
    expect(answered(done, 'golden_cross after the configured machine ran it')['verdict'], `once that machine has run it, the golden takes its run's verdict, no longer pending: ${show(done)}`).toBe(run['verdict']);
  }, LINUX_TIMEOUT);
});
