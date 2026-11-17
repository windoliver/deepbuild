// #458 criterion 8: a waiver or expected failure whose fixture passes again ends itself and is reported, naming the
// fixture; a GPU expected failure is keyed by backend, adapter and driver, with its reason, so the same fixture on
// another driver is judged as usual; and a fixture becomes must-pass only after clean runs on every backend it
// names. Each of the three checks below runs on the suite as it is, where it must find nothing, and on the planted
// suite its criterion names (`--planted`), where it must fail, naming the fixture (README: The planted programs).
import { describe, it } from 'vitest';
import {
  AC, STUB_GPU, STUB_GPU_NEW_DRIVER, TIMEOUT, after, answers, arr, commit, entryOf, fail, failsNaming, none, obj, pass, promote, report, rowOf, runLane, says, world,
  type At, type ExpectedFailure, type Fixture, type JsonObject,
} from './helpers.ts';

const waived: Fixture = { name: 'parity/marks2d/waived.board', lanes: ['quick'], backends: ['vello_cpu'], owner: 'alpha', twins: [{ name: 'dropped-fill' }] };
const expected: Fixture = { name: 'parity/scene3d/expected.scene', lanes: ['full'], backends: ['gpu'], owner: 'bravo', twins: [{ name: 'dropped-light' }] };
const both: Fixture = { name: 'parity/scene/two-backends.scene', lanes: ['quick', 'full'], backends: ['vello_cpu', 'gpu'], owner: 'charlie', twins: [{ name: 'dropped-light' }] };
const WAIVER = 'the join of two strokes changes with the next stroker';
const DRIVER_BUG = 'this driver rounds the shadow map\'s edge texels down';
/** The GPU expected failure: keyed by backend, adapter and driver, with its reason. */
const ENTRY: ExpectedFailure = { fixture: expected.name, backend: 'gpu', adapter: STUB_GPU.name, driver: STUB_GPU.driver, reason: DRIVER_BUG };

const at = (n: number, planted: string | undefined): At => ({ commit: commit(n), now: after(n), ...(planted ? { planted } : {}) });
const ended = (record: JsonObject): string[] => arr(record['ended'], `the ${String(record['lane'])} lane's ended list`).map((e) => `${String(obj(e, 'an ended entry')['kind'])} ${String(obj(e, 'an ended entry')['fixture'])}`);
/** One line per difference between a row and what it should read, naming the fixture. */
function differs(row: JsonObject, want: { verdict: string; reason?: string }, when: string): string[] {
  const fixture = String(row['fixture']);
  const out: string[] = [];
  if (row['verdict'] !== want.verdict) out.push(`${fixture} ${when}: reads ${says(row)}, not ${want.verdict}`);
  if (want.reason !== undefined && row['reason'] !== want.reason) out.push(`${fixture} ${when}: its reason is ${JSON.stringify(row['reason'] ?? null)}, not ${JSON.stringify(want.reason)}`);
  return out;
}

/** A waiver and an expected failure hold while their fixtures fail, end themselves when they pass, and stay ended. */
function endsItself(planted?: string): string[] {
  const w = world([waived, expected], { waivers: [{ fixture: waived.name, reason: WAIVER }], expected_failures: [ENTRY] });
  const plans = (result: 'fails' | 'passes'): void => {
    answers(w, 'quick', { [waived.name]: { run: result === 'fails' ? fail() : pass() } });
    answers(w, 'full', { [expected.name]: { run: result === 'fails' ? fail() : pass() } });
  };
  const failures: string[] = [];
  // Commit 1: both fail, as the waiver and the expected failure say.
  plans('fails');
  const quick1 = runLane(w, 'quick', at(1, planted)), full1 = runLane(w, 'full', at(1, planted));
  failures.push(...differs(rowOf(quick1, waived.name), { verdict: 'BLOCKED', reason: WAIVER }, 'failing under its waiver'));
  failures.push(...differs(rowOf(full1, expected.name), { verdict: 'BLOCKED', reason: DRIVER_BUG }, 'failing as expected on its backend, adapter and driver'));
  for (const record of [quick1, full1]) if (ended(record).length) failures.push(`${ended(record).join(', ')}: reported as ended while the fixture still fails`);
  // Commit 2: both pass again, so each entry ends itself and the run reports it, naming the fixture.
  plans('passes');
  const quick2 = runLane(w, 'quick', at(2, planted)), full2 = runLane(w, 'full', at(2, planted));
  failures.push(...differs(rowOf(quick2, waived.name), { verdict: 'PASS' }, 'passing again'));
  failures.push(...differs(rowOf(full2, expected.name), { verdict: 'PASS' }, 'passing again'));
  if (!ended(quick2).includes(`waiver ${waived.name}`)) failures.push(`${waived.name}: its waiver isn't reported as ended in the run where it passed (ended: ${ended(quick2).join(', ') || 'none'})`);
  if (!ended(full2).includes(`expected_failure ${expected.name}`)) failures.push(`${expected.name}: its expected failure isn't reported as ended in the run where it passed (ended: ${ended(full2).join(', ') || 'none'})`);
  // Commit 3: both fail again. The entries ended, so each failure is judged as usual.
  plans('fails');
  const quick3 = runLane(w, 'quick', at(3, planted)), full3 = runLane(w, 'full', at(3, planted));
  failures.push(...differs(rowOf(quick3, waived.name), { verdict: 'FAIL' }, 'failing after its waiver ended'));
  failures.push(...differs(rowOf(full3, expected.name), { verdict: 'FAIL' }, 'failing after its expected failure ended'));
  return failures;
}

/** The expected failure covers its own backend, adapter and driver; the same fixture on a second driver is judged as usual. */
function keyedByDriver(planted?: string): string[] {
  const w = world([expected], { expected_failures: [ENTRY] });
  const failures: string[] = [];
  answers(w, 'full', { [expected.name]: { run: fail() } });
  failures.push(...differs(rowOf(runLane(w, 'full', at(1, planted)), expected.name), { verdict: 'BLOCKED', reason: DRIVER_BUG }, `failing on driver ${STUB_GPU.driver}, the entry's`));
  // The same adapter after a driver update, as the device reports it.
  answers(w, 'full', { [expected.name]: { run: fail() } }, { backend: 'gpu', adapter: STUB_GPU_NEW_DRIVER });
  failures.push(...differs(rowOf(runLane(w, 'full', at(2, planted)), expected.name), { verdict: 'FAIL' }, `failing on driver ${STUB_GPU_NEW_DRIVER.driver}, a second driver`));
  return failures;
}

/** A fixture that names two backends is promoted only after a clean run on each. */
function promotedAfterBoth(planted?: string): string[] {
  const w = world([both]);
  const failures: string[] = [];
  const when = at(1, planted);
  const mustPass = (): boolean => entryOf(report(w, when).report, both.name)['must_pass'] === true;
  answers(w, 'quick', { [both.name]: { run: pass() } });
  answers(w, 'full', { [both.name]: { run: pass() } });
  // A clean run on Vello CPU alone.
  failures.push(...differs(rowOf(runLane(w, 'quick', when), both.name), { verdict: 'PASS' }, 'on vello_cpu'));
  const early = promote(w, both.name, when);
  if (early['outcome'] !== 'refused' || early['code'] !== 'clean_runs_missing') failures.push(`${both.name}: promoted after a clean run on one of its two backends (${JSON.stringify(early)})`);
  else if (JSON.stringify(early['missing']) !== JSON.stringify(['gpu'])) failures.push(`${both.name}: the refusal names the backends with no clean run as ${JSON.stringify(early['missing'])}, not ["gpu"]`);
  if (mustPass()) failures.push(`${both.name}: the release report reads it must-pass after a clean run on one of its two backends`);
  // And one on the GPU.
  failures.push(...differs(rowOf(runLane(w, 'full', when), both.name), { verdict: 'PASS' }, 'on gpu'));
  const late = promote(w, both.name, when);
  if (late['outcome'] !== 'promoted') failures.push(`${both.name}: not promoted after clean runs on both its backends (${JSON.stringify(late)})`);
  if (!mustPass()) failures.push(`${both.name}: the release report doesn't read it must-pass after its promotion`);
  return failures;
}

describe(`${AC[8]} waivers and expected failures end themselves, a GPU expected failure is keyed by backend, adapter and driver, and must-pass needs clean runs on every backend`, () => {
  it(`${AC[8]} a waiver and an expected failure read BLOCKED with their reason while the fixture fails, end themselves and are reported, naming the fixture, when it passes, and a later failure is a FAIL; a planted expected failure kept after its fixture passes fails this check, naming the fixture`, () => {
    none(endsItself(), 'the suite as it is');
    failsNaming(endsItself('expected_failure_kept'), expected.name, 'the planted suite that keeps an expected failure after its fixture passes');
  }, TIMEOUT);

  it(`${AC[8]} a GPU expected failure covers its backend, adapter and driver, and the same fixture failing on a second driver is a FAIL; a planted expected failure keyed by backend alone hides that failure and fails this check, naming the fixture`, () => {
    none(keyedByDriver(), 'the suite as it is');
    failsNaming(keyedByDriver('expected_failure_by_backend'), expected.name, 'the planted suite that keys an expected failure by backend alone');
  }, TIMEOUT);

  it(`${AC[8]} a fixture that names two backends is refused must-pass after a clean run on one, naming the other, and promoted after clean runs on both; a planted suite that promotes it after one fails this check, naming the fixture`, () => {
    none(promotedAfterBoth(), 'the suite as it is');
    failsNaming(promotedAfterBoth('promoted_on_one_backend'), both.name, 'the planted suite that promotes a fixture after runs on one of its two backends');
  }, TIMEOUT);
});
