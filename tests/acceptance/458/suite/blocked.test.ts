// #458 criterion 2: a fixture that can't run, a missing golden or a waiver reports BLOCKED with a reason, an owner
// and an age, never PASS; nothing is retried, and two different results on one machine are INCONCLUSIVE with both
// attached. Stub lanes and a temporary store (README: The surface under test). The wrong programs are the base and
// any suite that passes or drops what didn't run, restarts a block's age on each run, asks a runner again after a
// failure, or lets a later pass replace an earlier failure of the same commit on the same machine.
import { describe, expect, it } from 'vitest';
import { AC, T0, TIMEOUT, after, answers, arr, cantRun, commit, digest, fail, obj, pass, removeTool, requests, rowOf, runLane, says, world, type Fixture, type JsonObject } from './helpers.ts';

const needsGpu: Fixture = { name: 'parity/scene/needs-gpu.scene', lanes: ['full'], backends: ['gpu'], owner: 'alpha', twins: [{ name: 'dropped-light' }] };
const unblessed: Fixture = { name: 'parity/marks2d/unblessed.board', lanes: ['quick'], backends: ['vello_cpu'], owner: 'bravo', twins: [{ name: 'dropped-fill' }] };
const waived: Fixture = { name: 'parity/marks2d/waived.board', lanes: ['quick'], backends: ['vello_cpu'], owner: 'charlie', twins: [{ name: 'dropped-fill' }] };
const steady: Fixture = { name: 'parity/marks2d/steady.board', lanes: ['quick'], backends: ['vello_cpu'], owner: 'you', twins: [{ name: 'dropped-fill' }] };
const flaky: Fixture = { name: 'parity/marks2d/flaky.board', lanes: ['quick'], backends: ['vello_cpu'], owner: 'you', twins: [{ name: 'dropped-fill' }] };
const outside: Fixture = { name: 'parity/scene3d/white-room.scene', lanes: ['oracle'], backends: ['gpu'], owner: 'delta', twins: [{ name: 'second-light' }] };
const WAIVER = 'the join of two strokes changes with the next stroker';

/** A BLOCKED row with its reason, its owner and its age: when the block began and the whole days since. */
function blockedRow(row: JsonObject, want: { reason: string; owner: string; since: string; age_days: number }, what: string): void {
  expect(row['verdict'], `${what} reads BLOCKED, never PASS: ${says(row)}`).toBe('BLOCKED');
  expect(row['reason'], `${what}: its reason: ${says(row)}`).toBe(want.reason);
  expect(row['owner'], `${what}: its owner: ${says(row)}`).toBe(want.owner);
  expect(typeof row['since'] === 'string' ? Date.parse(row['since']) : NaN, `${what}: since, the time of the run where the block began: ${says(row)}`).toBe(Date.parse(want.since));
  expect(row['age_days'], `${what}: its age in whole days: ${says(row)}`).toBe(want.age_days);
}
const own = (list: { fixture: string; twin: string | null }[], fixture: string): number => list.filter((r) => r.fixture === fixture && r.twin === null).length;

describe(`${AC[2]} what can't run is BLOCKED with a reason, an owner and an age; nothing is retried; two different results are INCONCLUSIVE`, () => {
  it(`${AC[2]} a fixture that can't run, a lane with no tool, a missing golden and a waiver each read BLOCKED with their reason, owner and age, which grows from the first blocked run; each fixture is asked for once a run; and a FAIL then a PASS of one commit on this machine read INCONCLUSIVE with both results`, () => {
    const w = world([needsGpu, unblessed, waived, steady, flaky, outside], { waivers: [{ fixture: waived.name, reason: WAIVER }] });
    answers(w, 'full', { [needsGpu.name]: { run: cantRun('no_gpu') } });
    const quickPlan = (flakyRun = fail('the first frame')): void => answers(w, 'quick', {
      [unblessed.name]: { run: cantRun('no_golden') },
      [waived.name]: { run: fail() },
      [steady.name]: { run: pass() },
      [flaky.name]: { run: flakyRun },
    });
    quickPlan();
    // The oracle lane's tool isn't installed.
    removeTool(w, 'oracle');

    // The first run of each lane, on commit 1.
    const first = { commit: commit(1), now: T0 };
    const quick1 = runLane(w, 'quick', first);
    const full1 = runLane(w, 'full', first);
    const oracle1 = runLane(w, 'oracle', first);
    blockedRow(rowOf(full1, needsGpu.name), { reason: 'no_gpu', owner: 'alpha', since: T0, age_days: 0 }, 'a fixture its runner can\'t run');
    blockedRow(rowOf(oracle1, outside.name), { reason: 'no_runner', owner: 'delta', since: T0, age_days: 0 }, 'a fixture whose lane\'s tool is missing');
    blockedRow(rowOf(quick1, unblessed.name), { reason: 'no_golden', owner: 'bravo', since: T0, age_days: 0 }, 'a fixture with no golden');
    blockedRow(rowOf(quick1, waived.name), { reason: WAIVER, owner: 'charlie', since: T0, age_days: 0 }, 'a waived fixture that fails');
    const s = rowOf(quick1, steady.name);
    expect(s['verdict'], `${steady.name}: the control passes`).toBe('PASS');
    expect(s['since'] ?? null, `${steady.name}: a PASS has no age`).toBeNull();
    const f1 = rowOf(quick1, flaky.name);
    expect(f1['verdict'], `${flaky.name}: its first result on this commit`).toBe('FAIL');
    // Nothing is retried: one request for each fixture's own run, the failed ones included.
    const asked1 = requests(w, 'quick');
    for (const f of [unblessed, waived, steady, flaky]) expect(own(asked1, f.name), `${f.name}: asked for once in the quick lane's run`).toBe(1);
    expect(own(requests(w, 'full'), needsGpu.name), `${needsGpu.name}: asked for once in the full lane's run`).toBe(1);

    // The same commit again on the same machine, an hour later: the flaky fixture now passes.
    quickPlan(pass('the second frame'));
    const quick2 = runLane(w, 'quick', { commit: commit(1), now: after(0, 1) });
    const f2 = rowOf(quick2, flaky.name);
    expect(f2['verdict'], `${flaky.name}: a FAIL and a PASS of one commit on one machine: ${says(f2)}`).toBe('INCONCLUSIVE');
    expect(f2['reason'], `${flaky.name}: the reason`).toBe('two_results');
    const attached = arr(f2['results'], `${flaky.name}: both results attached`).map((r) => ({ verdict: obj(r, 'a result')['verdict'], digest: obj(r, 'a result')['digest'] }));
    expect(attached, `${flaky.name}: both results attached, the earlier first`).toEqual([
      { verdict: 'FAIL', digest: digest('the first frame') },
      { verdict: 'PASS', digest: digest('the second frame') },
    ]);
    expect(rowOf(quick2, steady.name)['verdict'], `${steady.name}: the same result twice is still PASS`).toBe('PASS');
    expect(own(requests(w, 'quick'), flaky.name), `${flaky.name}: asked for once in each of the two runs`).toBe(2);
    blockedRow(rowOf(quick2, waived.name), { reason: WAIVER, owner: 'charlie', since: T0, age_days: 0 }, 'the waived fixture, an hour on');

    // Three days later, on the next commit: the blocks are three days old, and counted from the first run.
    const third = { commit: commit(2), now: after(3) };
    const quick3 = runLane(w, 'quick', third);
    const full3 = runLane(w, 'full', third);
    const oracle3 = runLane(w, 'oracle', third);
    blockedRow(rowOf(full3, needsGpu.name), { reason: 'no_gpu', owner: 'alpha', since: T0, age_days: 3 }, 'three days on, the fixture its runner can\'t run');
    blockedRow(rowOf(oracle3, outside.name), { reason: 'no_runner', owner: 'delta', since: T0, age_days: 3 }, 'three days on, the fixture whose lane\'s tool is missing');
    blockedRow(rowOf(quick3, unblessed.name), { reason: 'no_golden', owner: 'bravo', since: T0, age_days: 3 }, 'three days on, the fixture with no golden');
    blockedRow(rowOf(quick3, waived.name), { reason: WAIVER, owner: 'charlie', since: T0, age_days: 3 }, 'three days on, the waived fixture');
    expect(rowOf(quick3, flaky.name)['verdict'], `${flaky.name}: one result on the next commit`).toBe('PASS');
  }, TIMEOUT);
});
