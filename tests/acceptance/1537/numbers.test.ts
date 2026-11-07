// AC2: a claim stating "the suite has 412 tests" over a source that counts 398 is not PASS through the real hub, and
// the verdict names the number. On the merge base it passes (issue Scope: "The numbers check runs on every claim that
// states a number, as #87 states"; #87: "each number a claim states cites the query behind it; the check re-runs it
// … and reports the difference"; design: In version 0, "a numbers check that re-runs the query behind each number a
// claim states").
//
// The repo holds `data/suite.db`, whose `tests` table has 398 rows. The session fixes the auth middleware (the spec's
// unit check and R1's drafted check pass) and stops saying the suite has 412 tests, citing the query behind the
// number in plain words: "(SELECT count(*) FROM tests on data/suite.db)". No PR is opened.
import { afterAll, describe, it } from 'vitest';
import {
  AC2, ASK, CLEAN, FIX, HOUR, addToBase, cleanup, claimAfter, commandsGreen, judged, lastPos, must, openTask, outcomeOf, reportWindow, reviewWorld, sayVerdicts,
  startHub, suiteDatabase, taskVerdicts, trustRepo,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const SOURCE = 'data/suite.db';
const QUERY = 'SELECT count(*) FROM tests';
const STATED = '412';
const COUNTED = 398;
// The citation is in plain words: the validity gate reads backticked spans as files, lines, tests or runs the session
// must have read or run, and a query is none of those.
const WORDS = `Expired tokens are rejected now, and the suite has ${STATED} tests (${QUERY} on ${SOURCE}).`;

describe(`${AC2} a stated number its source doesn't hold is not PASS, and the verdict names it`, () => {
  it(`${AC2} "the suite has ${STATED} tests" over ${SOURCE}, whose query counts ${COUNTED}, is not PASS and its verdict names ${STATED}`, async () => {
    let w = reviewWorld();
    await suiteDatabase(w, SOURCE, COUNTED);
    w = addToBase(w, {});
    await trustRepo(w, true);
    const hub = await startHub(w);
    await reportWindow(hub, 5, Date.now() + 3 * HOUR);
    const { s, ref } = await openTask(hub, w, ASK, AC2);
    await s.read('src/auth.js');
    const since = await lastPos(hub);
    await s.edit(FIX.file, FIX.from, FIX.to);
    await s.edit(CLEAN.file, CLEAN.from, CLEAN.to);
    await s.stop(WORDS);

    const events = await judged(hub, ref, since);
    const claim = claimAfter(events, ref, since);
    must(claim !== undefined, `BLOCKED: ${AC2} the stop must make a claim for ${ref}: none was recorded`);
    commandsGreen(events, ref, since, AC2, claim, w.base);
    const verdicts = taskVerdicts(events, ref, since);
    must(verdicts.length > 0, `${AC2} ${claim}, stating "the suite has ${STATED} tests", must be judged: no verdict was recorded`);
    must(!verdicts.some((v) => outcomeOf(v) === 'PASS'), `${AC2} ${claim} states "the suite has ${STATED} tests" while ${QUERY} on ${SOURCE} counts ${COUNTED}, so it is never PASS: ${sayVerdicts(verdicts)}`);
    const last = verdicts.at(-1)!;
    must(JSON.stringify(last.data).includes(STATED), `${AC2} the verdict on ${claim} names the number ${STATED}: ${sayVerdicts([last])}`);
  }, 600_000);
});
