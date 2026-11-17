// #458 criterion 3: the release report applies the bar to the release commit: every must-pass fixture PASS, every
// other PASS or BLOCKED with an owner and a reason, and none FAIL, INVALID or INCONCLUSIVE, apart from the cross
// lane's pixel comparisons within the loose ceiling and the IoU floor, which are readings and count neither way; a
// FAIL a lane reported on that commit stands when the lane later can't run there, so a fixture whose oracle lane
// failed still fails the bar after that lane's tool is removed. Four stub lanes, a temporary store and a stub tool
// the test removes (README: The surface under test). The wrong programs are the base and any report that reads
// another commit's results, passes what didn't run, counts every cross-lane INCONCLUSIVE as a reading, or lets a
// lane's later BLOCKED run replace the FAIL it reported on the same commit.
import { describe, expect, it } from 'vitest';
import {
  AC, LANES, T0, TIMEOUT, after, answers, arr, cantRun, commit, entryOf, fail, failed, obj, pass, promote, removeTool, report, rowOf, runLane, world, writeSuite,
  type Answer, type At, type Fixture, type JsonObject, type Reply, type World,
} from './helpers.ts';

const must: Fixture = { name: 'parity/kernel/must.board', lanes: ['quick'], backends: ['vello_cpu'], owner: 'alpha', twins: [{ name: 'dropped-fill' }] };
const gpuOnly: Fixture = { name: 'parity/scene/gpu-only.scene', lanes: ['full'], backends: ['gpu'], owner: 'bravo', twins: [{ name: 'dropped-light' }] };
const across: Fixture = { name: 'parity/effects/across.scene', lanes: ['cross'], backends: ['gpu'], owner: 'charlie', twins: [{ name: 'dropped-light' }], pixels: { loose_ceiling: 0.3, iou_floor: 0.9 } };
const room: Fixture = { name: 'parity/scene3d/white-room.scene', lanes: ['oracle'], backends: ['gpu'], owner: 'delta', twins: [{ name: 'second-light' }] };
const FIXTURES = [must, gpuOnly, across, room];

/** A pixel comparison's numbers from another machine: a reading, whatever they are, until the suite judges them. */
const numbers = (flip: number, iou: number): Reply => ({ verdict: 'INCONCLUSIVE', pixels: { flip, iou } });
/** What the four stubs answer: by default the must-pass fixture passes, the GPU one can't run here, the cross-lane
 * comparison sits inside its ceiling and floor, and the oracle lane's passes. */
function plans(w: World, change: { must?: Answer; gpuOnly?: Reply; across?: Reply; room?: Reply } = {}): void {
  answers(w, 'quick', { [must.name]: change.must ?? { run: pass() } });
  answers(w, 'full', { [gpuOnly.name]: { run: change.gpuOnly ?? cantRun('no_gpu') } });
  answers(w, 'cross', { [across.name]: { run: change.across ?? numbers(0.12, 0.97) } });
  answers(w, 'oracle', { [room.name]: { run: change.room ?? pass() } });
}
/** The nth commit after the promotion's, a day apart. */
const at = (n: number, hours = 0): At => ({ commit: commit(n), now: after(n, hours) });
const runAll = (w: World, when: At): Record<string, JsonObject> => Object.fromEntries(LANES.map((lane) => [lane, runLane(w, lane, when)]));
/** A world whose `must` fixture ran clean on its one backend and was promoted to must-pass, on commit 0. */
function release(): World {
  const w = world(FIXTURES);
  plans(w);
  runLane(w, 'quick', { commit: commit(0), now: T0 });
  expect(promote(w, must.name, { commit: commit(0), now: T0 })['outcome'], `${must.name} is promoted after a clean run on its one backend`).toBe('promoted');
  return w;
}
/** The report of a commit the bar fails: FAIL, a non-zero exit, and exactly these fixtures named. */
function barFails(w: World, when: At, fixtures: string[], what: string): JsonObject {
  const r = report(w, when);
  expect(r.report['bar'], `${what}: the bar`).toBe('FAIL');
  expect(r.status, `${what}: the report exits non-zero`).not.toBe(0);
  expect(failed(r.report), `${what}: the fixtures the bar names`).toEqual([...fixtures].sort());
  return r.report;
}

describe(`${AC[3]} the release report applies the bar to the release commit`, () => {
  it(`${AC[3]} the bar holds when the must-pass fixture passes and the others are PASS or BLOCKED with an owner and a reason; it fails, naming the fixture, on a commit no lane ran, on a must-pass fixture that is BLOCKED, on a BLOCKED fixture with no owner, and on a FAIL, an INVALID and an INCONCLUSIVE`, () => {
    const w = release();

    // The release commit: every lane ran on it.
    runAll(w, at(1));
    const r1 = report(w, at(1));
    expect(r1.report['commit'], 'the report names the commit it judged').toBe(commit(1));
    expect(r1.report['bar'], `the bar on the release commit: ${JSON.stringify(r1.report['failures'])}`).toBe('PASS');
    expect(r1.status, 'the report exits 0 when the bar holds').toBe(0);
    expect(failed(r1.report), 'no fixture fails the bar').toEqual([]);
    expect(arr(r1.report['fixtures'], 'fixtures').map((f) => obj(f, 'an entry')['fixture']).sort(), 'the report lists every fixture of the suite').toEqual(FIXTURES.map((f) => f.name).sort());
    const m = entryOf(r1.report, must.name);
    expect({ must_pass: m['must_pass'], verdict: m['verdict'], category: m['category'] }, `${must.name}: must-pass, PASS, in its category`).toEqual({ must_pass: true, verdict: 'PASS', category: 'kernel' });
    const g = entryOf(r1.report, gpuOnly.name);
    expect({ must_pass: g['must_pass'], verdict: g['verdict'], reason: g['reason'], owner: g['owner'], category: g['category'] }, `${gpuOnly.name}: not must-pass, BLOCKED with its reason and owner`)
      .toEqual({ must_pass: false, verdict: 'BLOCKED', reason: 'no_gpu', owner: 'bravo', category: 'scene' });
    const o = entryOf(r1.report, room.name);
    expect({ must_pass: o['must_pass'], verdict: o['verdict'], category: o['category'] }, `${room.name}: not must-pass, PASS`).toEqual({ must_pass: false, verdict: 'PASS', category: 'scene3d' });

    // A commit no lane ran on: the results of commit 1 don't count for it, and nothing unrun passes.
    const r2 = report(w, at(2));
    expect(r2.report['bar'], 'the bar on a commit no lane ran on').toBe('FAIL');
    expect(r2.status, 'the report exits non-zero').not.toBe(0);
    expect(failed(r2.report), `the bar names ${must.name}, a must-pass fixture with no PASS on this commit`).toContain(must.name);
    expect(entryOf(r2.report, must.name)['verdict'], `${must.name} on a commit it never ran on`).not.toBe('PASS');

    // A must-pass fixture that is BLOCKED fails the bar; the BLOCKED fixture with an owner and a reason still doesn't.
    plans(w, { must: { run: cantRun('no_golden') } });
    runAll(w, at(3));
    expect(entryOf(barFails(w, at(3), [must.name], 'a must-pass fixture BLOCKED'), must.name)['verdict'], `${must.name}`).toBe('BLOCKED');

    // A BLOCKED fixture with no owner fails the bar.
    const ownerless: Fixture = { name: gpuOnly.name, lanes: gpuOnly.lanes, backends: gpuOnly.backends, twins: gpuOnly.twins };
    writeSuite(w, [must, ownerless, across, room]);
    plans(w);
    runAll(w, at(4));
    expect(entryOf(barFails(w, at(4), [gpuOnly.name], 'a BLOCKED fixture with no owner'), gpuOnly.name)['verdict'], `${gpuOnly.name}`).toBe('BLOCKED');
    writeSuite(w, FIXTURES);

    // A FAIL, on a fixture that isn't must-pass.
    plans(w, { gpuOnly: fail() });
    runAll(w, at(5));
    expect(entryOf(barFails(w, at(5), [gpuOnly.name], 'a FAIL'), gpuOnly.name)['verdict'], `${gpuOnly.name}`).toBe('FAIL');

    // An INVALID: the must-pass fixture's twin passes.
    plans(w, { must: { run: pass(), twins: { 'dropped-fill': pass('the twin draws the same') } } });
    runAll(w, at(6));
    expect(entryOf(barFails(w, at(6), [must.name], 'an INVALID'), must.name)['verdict'], `${must.name}`).toBe('INVALID');

    // An INCONCLUSIVE that is no reading: two different results of one commit on this machine.
    plans(w, { room: fail('the first frame') });
    runAll(w, at(7));
    plans(w, { room: pass('the second frame') });
    runLane(w, 'oracle', at(7, 1));
    expect(entryOf(barFails(w, at(7, 2), [room.name], 'an INCONCLUSIVE'), room.name)['verdict'], `${room.name}`).toBe('INCONCLUSIVE');
  }, TIMEOUT);

  it(`${AC[3]} a cross-lane pixel comparison within the loose ceiling and the IoU floor is a reading that counts neither way; one past the ceiling or under the floor fails, and a cross-lane INCONCLUSIVE with no pixel numbers is no reading`, () => {
    const w = release();
    const readings = (rep: JsonObject): { fixture: JsonObject[string]; lane: JsonObject[string] }[] =>
      arr(rep['readings'], 'the report\'s readings').map((r) => ({ fixture: obj(r, 'a reading')['fixture'] ?? null, lane: obj(r, 'a reading')['lane'] ?? null }));

    // FLIP 0.12 under the ceiling of 0.3, IoU 0.97 over the floor of 0.9.
    const row1 = rowOf(runAll(w, at(1))['cross']!, across.name);
    expect({ verdict: row1['verdict'], reading: row1['reading'] }, `${across.name} in the cross lane: a reading, INCONCLUSIVE`).toEqual({ verdict: 'INCONCLUSIVE', reading: true });
    const r1 = report(w, at(1));
    expect(r1.report['bar'], `the reading doesn't fail the bar: ${JSON.stringify(r1.report['failures'])}`).toBe('PASS');
    expect(r1.status, 'the report exits 0').toBe(0);
    expect(readings(r1.report), 'the report lists it among its readings').toEqual([{ fixture: across.name, lane: 'cross' }]);
    expect(entryOf(r1.report, across.name)['verdict'], `${across.name}: a reading is no PASS`).not.toBe('PASS');

    // Past the loose ceiling: a FAIL in any lane.
    plans(w, { across: numbers(0.31, 0.97) });
    const row2 = rowOf(runAll(w, at(2))['cross']!, across.name);
    expect({ verdict: row2['verdict'], reason: row2['reason'] }, `${across.name} at FLIP 0.31 over a ceiling of 0.3`).toEqual({ verdict: 'FAIL', reason: 'past_loose_ceiling' });
    expect(readings(barFails(w, at(2), [across.name], 'a frame past the loose ceiling')), 'a failure is no reading').toEqual([]);

    // Under the IoU floor.
    plans(w, { across: numbers(0.12, 0.89) });
    const row3 = rowOf(runAll(w, at(3))['cross']!, across.name);
    expect({ verdict: row3['verdict'], reason: row3['reason'] }, `${across.name} at IoU 0.89 under a floor of 0.9`).toEqual({ verdict: 'FAIL', reason: 'under_iou_floor' });
    barFails(w, at(3), [across.name], 'a frame under the IoU floor');

    // INCONCLUSIVE in the cross lane with no pixel comparison behind it.
    plans(w, { across: { verdict: 'INCONCLUSIVE', reason: 'the second machine stopped answering' } });
    runAll(w, at(4));
    expect(readings(barFails(w, at(4), [across.name], 'a cross-lane INCONCLUSIVE that is no pixel comparison')), 'it is no reading').toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} a fixture whose oracle lane failed on the release commit still fails the bar after that lane's tool is removed and the lane is run there again; on the next commit, with the tool still gone, it is BLOCKED and the bar holds`, () => {
    const w = release();
    plans(w, { room: fail() });
    runAll(w, at(1));
    expect(entryOf(barFails(w, at(1), [room.name], 'the oracle lane failed'), room.name)['verdict'], `${room.name} with its tool installed`).toBe('FAIL');

    // The tool is removed, and the lane is run again on the same commit: it can't run there.
    removeTool(w, 'oracle');
    runLane(w, 'oracle', at(1, 1));
    expect(entryOf(barFails(w, at(1, 2), [room.name], 'the oracle lane failed, then its tool was removed'), room.name)['verdict'], `${room.name}: the FAIL the lane reported on this commit stands`).toBe('FAIL');

    // The next commit: the lane never ran there, so its fixture is BLOCKED with its owner and a reason.
    plans(w);
    const blockedRow = rowOf(runAll(w, at(2))['oracle']!, room.name);
    expect({ verdict: blockedRow['verdict'], reason: blockedRow['reason'], owner: blockedRow['owner'] }, `${room.name} on the next commit, with no tool`).toEqual({ verdict: 'BLOCKED', reason: 'no_runner', owner: 'delta' });
    const r2 = report(w, at(2));
    expect(r2.report['bar'], `the bar on the next commit: ${JSON.stringify(r2.report['failures'])}`).toBe('PASS');
    expect(r2.status, 'the report exits 0').toBe(0);
    expect(entryOf(r2.report, room.name)['verdict'], `${room.name} on the next commit`).toBe('BLOCKED');
  }, TIMEOUT);
});
