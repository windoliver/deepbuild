// #2060: through a real hub, deep-hook and the Claude Code stand-in, sessions A and B claim the same files of one fixture
// repo, from worktrees of their own, on a check whose command names `fixture-tool`, a Node script on the hub's PATH
// outside the system's folders. Each claim's verdict, its line and the runs it names come from the record (README). A hub
// that can't start, the planted ones on a base that lacks them included, is BLOCKED (the test throws), never a pass.
import { afterEach, describe, expect, it } from 'vitest';
import { LIMIT, mustFail } from '../3229/helpers.ts';
import { AC, baseRuns, carried, cleanup, endedItself, FIX_CHECK, headRuns, install, PLANTS, shownReading, TOOL, TOOL_CHECK, twoSessions, uninstall, V2, V2_EXITS_0, type Reading } from './helpers.ts';

afterEach(cleanup, 120_000);

const leftAsItIs = (): void => undefined;
const CHECK = TOOL_CHECK.check;
const FIX = FIX_CHECK.check;

/** AC1: B's result is not carried, names B's own run, and is not PASS. */
function runsAgain(r: Reading): void {
  expect(carried(r.b), `${TOOL} was replaced by version 2 after A's PASS, so nothing of B's claim is marked carried: ${shownReading(r)}`).toEqual([]);
  const own = headRuns(r, r.b, CHECK);
  expect(own.length, `${TOOL} was replaced by version 2, so ${CHECK} runs again for B's claim: ${shownReading(r)}`).toBeGreaterThan(0);
  for (const x of own) endedItself(x, 'a run of version 2 ends on its own', r);
  expect(own.some((x) => r.b.said.some((s) => s.includes(x.run))), `B's result names B's own run (one of ${own.map((x) => x.run).join(', ')}): ${shownReading(r)}`).toBe(true);
  expect(r.b.outcomes, `version 2 of ${TOOL} exits 1, so B's verdict is never PASS: ${shownReading(r)}`).not.toContain('PASS');
}

describe(`${AC[1]} fixture-tool is replaced by version 2, a longer file that exits 1, between A's PASS and B's claim on the same files: B's check runs again, its result names B's own run, nothing is marked carried, and its verdict is not PASS`, () => {
  it(`${AC[1]} B's result is not carried: it names B's own run and is not PASS`, async () => {
    runsAgain(await twoSessions(TOOL_CHECK, (w) => install(w, V2)));
  }, LIMIT);

  it(`${AC[1]} (wrong program ${PLANTS.leavesOut}) a key that leaves the program readings out carries A's PASS and fails, naming fixture-tool`, async () => {
    const r = await twoSessions(TOOL_CHECK, (w) => install(w, V2), PLANTS.leavesOut);
    expect(r.b.outcome, `${PLANTS.leavesOut}: the planted key carries A's PASS to B: ${shownReading(r)}`).toBe('PASS');
    await mustFail(`${PLANTS.leavesOut} on AC1`, () => runsAgain(r), [TOOL, 'carried']);
  }, LIMIT);
});

/** AC2: one run between the two claims, A's, which B's result marks carried and names. */
function oneRun(r: Reading): void {
  const all = r.runs.filter((x) => x.check === CHECK);
  expect(all.map((x) => x.claim), `${TOOL} was left as it is and the two claims hold the same files, so they read one run of ${CHECK} between them, A's: ${shownReading(r)}`).toEqual([r.a.claim]);
  expect(carried(r.b).some((s) => s.includes(all[0]!.run)), `B's result is marked carried and names A's run ${all[0]!.run}: ${shownReading(r)}`).toBe(true);
}

describe(`${AC[2]} With the file left as it is, sessions A and B with the same files read one run between them, and B's result is marked carried and names A's run`, () => {
  it(`${AC[2]} one run between A and B, carried to B by name`, async () => {
    oneRun(await twoSessions(TOOL_CHECK, leftAsItIs));
  }, LIMIT);

  it(`${AC[2]} (wrong program ${PLANTS.holdsLink}) a key that holds the path of the run's own link to the program never carries and fails`, async () => {
    const r = await twoSessions(TOOL_CHECK, leftAsItIs, PLANTS.holdsLink);
    for (const x of headRuns(r, r.b, CHECK)) endedItself(x, 'the planted key only adds a path', r);
    expect(carried(r.b), `${PLANTS.holdsLink}: the planted key never carries: ${shownReading(r)}`).toEqual([]);
    await mustFail(`${PLANTS.holdsLink} on AC2`, () => oneRun(r), [TOOL]);
  }, LIMIT);
});

/** AC3, the file left as it is: the one base run is A's, which B's result marks carried and names. */
function baseCarries(r: Reading): void {
  const [source] = baseRuns(r, r.a, FIX);
  expect(baseRuns(r, r.b, FIX), `${TOOL} was left as it is, so ${FIX}'s base run carries from A and B runs none: ${shownReading(r)}`).toEqual([]);
  expect(carried(r.b).some((s) => s.includes(source!.run)), `B's result marks A's base run ${source!.run} carried, naming it: ${shownReading(r)}`).toBe(true);
}
/** AC3, the file replaced: B's claim runs the check on the merge base itself, and A's base run is not carried to it. */
function baseRunsAgain(r: Reading): void {
  for (const x of headRuns(r, r.b, FIX)) if (x.outcome !== 'passed') throw Error(`BLOCKED: B's own run ${x.run} on its snapshot ended ${x.outcome}, so no base run was due: ${shownReading(r)}`);
  const [source] = baseRuns(r, r.a, FIX);
  expect(carried(r.b).filter((s) => s.includes(source!.run)), `${TOOL} was replaced by version 2, so A's base run ${source!.run} of ${FIX} is not carried to B: ${shownReading(r)}`).toEqual([]);
  expect(baseRuns(r, r.b, FIX).length, `${TOOL} was replaced by version 2, so ${FIX}'s base run runs again for B's claim: ${shownReading(r)}`).toBeGreaterThan(0);
}

describe(`${AC[3]} A fix check's base run under version 1 in session A carries to session B while the file is left as it is; after the file is replaced by version 2, B's base run runs again`, () => {
  it(`${AC[3]} the file left as it is: A's base run carries to B, which runs none`, async () => {
    baseCarries(await twoSessions(FIX_CHECK, leftAsItIs));
  }, LIMIT);

  it(`${AC[3]} the file replaced by version 2: B's base run runs again`, async () => {
    baseRunsAgain(await twoSessions(FIX_CHECK, (w) => install(w, V2_EXITS_0)));
  }, LIMIT);

  it(`${AC[3]} (wrong program ${PLANTS.headOnly}) a hub that adds the readings to head keys only carries the base run and fails, naming the check`, async () => {
    const r = await twoSessions(FIX_CHECK, (w) => install(w, V2_EXITS_0), PLANTS.headOnly);
    expect(headRuns(r, r.b, FIX).length, `${PLANTS.headOnly}: the planted hub's head keys hold the readings, so B's own run of ${FIX} runs again: ${shownReading(r)}`).toBeGreaterThan(0);
    await mustFail(`${PLANTS.headOnly} on AC3`, () => baseRunsAgain(r), [FIX]);
  }, LIMIT);
});

/** AC4: B reads no carried result, and its verdict is not PASS. */
function readsNothing(r: Reading): void {
  expect(carried(r.b), `${TOOL} was removed after A's PASS, so B reads no carried result: ${shownReading(r)}`).toEqual([]);
  expect(r.b.outcomes, `${TOOL} was removed, so B's verdict is never PASS: ${shownReading(r)}`).not.toContain('PASS');
}

describe(`${AC[4]} With fixture-tool removed after A's PASS, B reads no carried result and its verdict is not PASS`, () => {
  it(`${AC[4]} B reads no carried result and is not PASS`, async () => {
    readsNothing(await twoSessions(TOOL_CHECK, uninstall));
  }, LIMIT);

  it(`${AC[4]} (wrong program ${PLANTS.skips}) a reader that skips a program it can't find carries A's PASS and fails, naming fixture-tool`, async () => {
    const r = await twoSessions(TOOL_CHECK, uninstall, PLANTS.skips);
    expect(r.b.outcome, `${PLANTS.skips}: the planted reader carries A's PASS to B: ${shownReading(r)}`).toBe('PASS');
    await mustFail(`${PLANTS.skips} on AC4`, () => readsNothing(r), [TOOL, 'carried']);
  }, LIMIT);
});
