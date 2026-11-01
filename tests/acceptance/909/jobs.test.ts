// #909 AC2: a job failing twice reads failing with 2 and its start in the hub's health reply and `deep doctor` stays
// quiet; the third failure shows in `deep doctor`; a clean run clears both. The hub is `deep hub run` on a temp home's
// installed root, so `deep doctor` there reaches it; the job is the test job DEEP_HUB_TEST_FAIL_JOB adds, one run per
// line this test writes (README, Surface choices).
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, type Conn, control, deep, health, type Line, makeHome, startHub, tempDir, waitFor } from '../16/helpers.ts';

afterEach(cleanup, 60_000);

/** The test job's name in hub.health's jobs (README, Surface choices). */
const JOB = 'test';
/** The doctor item and code a failing job shows as (README, Surface choices). */
const ITEM = 'hub.jobs';
const CODE = 'job_failing';
/** How long one written line may take to become one run the health reply shows. */
const RUN_MS = 10_000;

const jobOf = async (cli: Conn): Promise<Line | undefined> => (await health(cli)).jobs?.[JOB] as Line | undefined;
/** Waits until the test job's entry passes `ok`, failing with the last entry read. */
async function jobUntil(cli: Conn, ok: (job: Line | undefined) => boolean, what: string): Promise<Line> {
  let last: Line | undefined;
  try {
    return await waitFor(async () => { last = await jobOf(cli); return ok(last) ? last! : undefined; }, RUN_MS, what);
  } catch {
    throw Error(`${what}: after ${RUN_MS / 1000} s hub.health's jobs.${JOB} reads ${JSON.stringify(last)}`);
  }
}

/** `deep doctor --json` in the hub's home, from a folder outside any repo, with no agent on PATH: its items. */
async function doctor(home: string, cwd: string): Promise<Line[]> {
  const r = await deep(home, ['doctor', '--json'], { cwd, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, timeoutMs: 60_000 });
  const items = r.stdout.split('\n').flatMap((raw) => { try { return [JSON.parse(raw) as Line]; } catch { return []; } });
  const socket = items.find((i) => i.item === 'hub.socket');
  expect(socket?.level, `deep doctor reached the hub (exit ${r.code}; stderr ${r.stderr.slice(0, 500)}): ${JSON.stringify(socket)}`).toBe('ok');
  return items;
}
/** The doctor's items reporting a failing job: the job item at any level but ok, or the failing code on any item. */
const jobReports = (items: Line[]) => items.filter((i) => (i.item === ITEM && i.level !== 'ok') || i.code === CODE);

describe('AC2 #909 a failing job is counted in a row; deep doctor reports it at the third', () => {
  it('AC2 two failures read failing with 2 and their start, doctor quiet; the third shows in doctor; a clean run clears both', async () => {
    const home = makeHome();
    const dir = tempDir();
    const work = join(dir, 'work');
    mkdirSync(work);
    const runs = join(dir, 'job-runs');
    writeFileSync(runs, '');
    const hub = await startHub({ home, env: { DEEP_HUB_TEST_FAIL_JOB: runs } });
    const cli = await control(hub);

    const atStart = await jobOf(cli);
    console.log(`AC2 hub.health jobs at start: ${JSON.stringify((await health(cli)).jobs)}`);
    expect(atStart, `hub.health lists the ${JOB} job from the start`).toBeDefined();
    expect(atStart!.failing, 'the job reads not failing before it ran').toBeNull();

    // First failure: counted 1, its start the time of this failure.
    const t0 = Date.now();
    appendFileSync(runs, 'fail\n');
    const one = await jobUntil(cli, (j) => !!j?.failing, 'the first failure reads failing');
    const t1 = Date.now();
    console.log(`AC2 after 1 failure, hub.health jobs.${JOB}: ${JSON.stringify(one)}`);
    expect(one.failing.failures, 'one failure reads failing with 1').toBe(1);
    expect(typeof one.failing.since, 'the failing job gives when its failures began').toBe('number');
    expect(one.failing.since, 'the row began at the first failure, not before this test wrote it').toBeGreaterThanOrEqual(t0 - 1000);
    expect(one.failing.since, 'the row began at the first failure').toBeLessThanOrEqual(t1 + 1000);
    const since = one.failing.since as number;

    // Second failure: counted 2, the start unchanged; deep doctor stays quiet.
    appendFileSync(runs, 'fail\n');
    const two = await jobUntil(cli, (j) => j?.failing?.failures === 2, 'the second failure in a row reads failing with 2');
    console.log(`AC2 after 2 failures, hub.health jobs.${JOB}: ${JSON.stringify(two)}`);
    expect(two.failing.since, 'the second failure keeps the row\'s start').toBe(since);
    const quiet = await doctor(home, work);
    expect((await jobOf(cli))?.failing?.failures, 'the job still read 2 failures after deep doctor ran').toBe(2);
    expect(jobReports(quiet), 'deep doctor stays quiet about a job at its second failure in a row').toEqual([]);

    // Third failure: deep doctor shows it.
    appendFileSync(runs, 'fail\n');
    const three = await jobUntil(cli, (j) => j?.failing?.failures === 3, 'the third failure in a row reads failing with 3');
    console.log(`AC2 after 3 failures, hub.health jobs.${JOB}: ${JSON.stringify(three)}`);
    expect(three.failing.since, 'the third failure keeps the row\'s start').toBe(since);
    const loud = await doctor(home, work);
    const reports = jobReports(loud);
    console.log(`AC2 deep doctor at the third failure: ${JSON.stringify(reports)}`);
    expect(reports.length, `deep doctor reports the failing job once: ${JSON.stringify(reports)}`).toBe(1);
    const [report] = reports;
    expect(report!.item, 'the report is the hub\'s jobs item').toBe(ITEM);
    expect(report!.code, 'the report\'s code').toBe(CODE);
    expect(['warn', 'fail'], `the report reads as a problem, not ${report!.level}`).toContain(report!.level);
    expect(String(report!.evidence), 'the report names the job').toMatch(new RegExp(`\\b${JOB}\\b`));
    expect(String(report!.evidence), 'the report gives its failures in a row, 3').toMatch(/\b3\b/);

    // A clean run clears both: the count and the start in the health reply, and the doctor's report.
    const tClean = Date.now();
    appendFileSync(runs, 'ok\n');
    const clean = await jobUntil(cli, (j) => j !== undefined && j.failing === null, 'a clean run clears the job\'s failing');
    console.log(`AC2 after a clean run, hub.health jobs.${JOB}: ${JSON.stringify(clean)}`);
    expect(jobReports(await doctor(home, work)), 'deep doctor is quiet again after a clean run').toEqual([]);

    // The count starts over: the next failure is the first of a new row, with a new start.
    appendFileSync(runs, 'fail\n');
    const again = await jobUntil(cli, (j) => !!j?.failing, 'a failure after the clean run reads failing');
    console.log(`AC2 a failure after the clean run, hub.health jobs.${JOB}: ${JSON.stringify(again)}`);
    expect(again.failing.failures, 'the clean run cleared the count: the next failure reads 1').toBe(1);
    expect(again.failing.since, 'the clean run cleared the start: the new row began after it').toBeGreaterThanOrEqual(tClean - 1000);
    cli.close();
  }, 180_000);
});
