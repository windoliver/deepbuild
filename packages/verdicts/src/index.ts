// @deepbuild/verdicts: the verdict engine (#28). A claim's run records, coverage and definition become one of
// five verdicts, or pending; run counts, carried results, open items, send-backs and the record's verdict rows.
export type * from './types.js';
export { openItemId, predictionContradictions, selectReruns, staleReason, verdict, verdictHash } from './engine.js';
export { moreRuns, runsNeeded } from './runs.js';
export { conductRun } from './conduct.js';
export { runContract } from './contract.js';
export { markStale, recordVerdict } from './record.js';
