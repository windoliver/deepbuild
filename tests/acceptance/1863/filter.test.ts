// AC2: a claim whose diff adds a filter that changes no row of its definition's sample fails, showing the sample
// (issue Scope: the hub hands the numbers check each filter the claim's diff adds, with the read-only sample the
// claim's definition names; #87: "one that changes no result there fails, showing the sample"). Wrong program it
// fails on: the merge base, where the filter never runs on the sample, so the claim passes and the failure names the
// filter.
//
// The repo holds queries/paid-orders.sql and data/orders-sample.db (40 orders, every one paid). The definition names
// the sample (helpers.ts: SAMPLE_FIELD). The session adds `AND status <> 'void'` to the query: no sample row is void.
import { afterAll, describe, it } from 'vitest';
import { AC2, FILTER, FILTER_EDIT, FILTER_WORDS, SAMPLE_FILE, SAMPLE_ROWS, addToBase, claimWorld, claimed, cleanup, must, outcomeOf, queryFiles, sayVerdicts, startHub, stopHub, trustRepo, writeSample } from './helpers.ts';

afterAll(cleanup, 60_000);

describe(`${AC2} a filter the diff adds that changes no row of the sample fails`, () => {
  it(`${AC2} the added filter ${FILTER} changes none of the ${SAMPLE_ROWS} rows of ${SAMPLE_FILE}: FAIL, showing the sample`, async () => {
    const world = claimWorld({ files: queryFiles(), deliverables: [FILTER_EDIT.file], sample: SAMPLE_FILE });
    const rows = writeSample(world.repo);
    must(rows.with === SAMPLE_ROWS && rows.without === SAMPLE_ROWS, `BLOCKED: ${AC2} the fixture's filter must change no row of its sample: ${JSON.stringify(rows)}`);
    const w = addToBase(world, {});
    await trustRepo(w, true);
    const hub = await startHub(w);
    try {
      const { claim, verdicts } = await claimed(hub, w, AC2, FILTER_EDIT, FILTER_WORDS, 300_000);
      must(verdicts.length > 0, `${AC2} ${claim}, whose diff adds the filter ${FILTER}, must be judged: no verdict was recorded`);
      const last = verdicts.at(-1)!;
      must(outcomeOf(last) === 'FAIL', `${AC2} ${claim}'s diff adds the filter ${FILTER}, which changes no row of ${SAMPLE_FILE}, so it is FAIL; the filter never ran on the sample: ${sayVerdicts(verdicts)}`);
      const shown = JSON.stringify(last.data);
      must(shown.includes(SAMPLE_FILE) && shown.includes(FILTER), `${AC2} the FAIL on ${claim} names the filter ${FILTER} and shows the sample ${SAMPLE_FILE}: ${sayVerdicts([last])}`);
    } finally {
      await stopHub(hub);
    }
  }, 600_000);
});
