// Twin revert-as-escape (tests/acceptance/2750/twins/README.md), a planted wrong reader: a revert of a commit that read
// none is counted as an escape after PASS, where it must be counted apart, as never judged.
// It is this file alone, laid over packages/readings/src/index.ts, which is exactly `export * from './impl.js'`: the
// real panelRows runs, and the rows it gives for the reading `landed.none` are changed on their way out, so the fault
// holds whatever builds the reading. Fails revert.test.ts (AC2 #2750.230902ce).
export * from './impl.js';
import { panelRows as right } from './impl.js';

type Rows = ReturnType<typeof right>;
type Detail = Record<string, unknown>;

export function panelRows(...given: Parameters<typeof right>): Rows {
  return right(...given).map((row) => {
    if (row.id !== 'landed.none' || !row.detail) return row;
    return { ...row, detail: row.detail.map((r): Detail => (r.counted === 'never_judged' ? { ...r, counted: 'escape' } : r)) };
  });
}
