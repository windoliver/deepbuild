// Twin uncovered-as-zero (tests/acceptance/2750/twins/README.md), a planted wrong reader: a span the push readings don't
// cover is left out, so it reads as a span in which no commit landed: zero unjudged commits.
// It is this file alone, laid over packages/readings/src/index.ts, which is exactly `export * from './impl.js'`: the
// real panelRows runs, and the rows it gives for the reading `landed.none` are changed on their way out, so the fault
// holds whatever builds the reading. Fails missing.test.ts (AC3 #2750.8f4da496).
export * from './impl.js';
import { panelRows as right } from './impl.js';

type Rows = ReturnType<typeof right>;
type Detail = Record<string, unknown>;

export function panelRows(...given: Parameters<typeof right>): Rows {
  return right(...given).map((row) => {
    if (row.id !== 'landed.none' || !row.detail) return row;
    return { ...row, detail: row.detail.filter((r: Detail) => r.missing !== true) };
  });
}
