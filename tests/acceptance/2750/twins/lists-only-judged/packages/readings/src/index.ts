// Twin lists-only-judged (tests/acceptance/2750/twins/README.md), a planted wrong reader: only the commits with a verdict
// are listed, so every commit it lists is judged.
// It is this file alone, laid over packages/readings/src/index.ts, which is exactly `export * from './impl.js'`: the
// real panelRows runs, and the rows it gives for the reading `landed.none` are changed on their way out, so the fault
// holds whatever builds the reading. Fails landed.test.ts (AC1 #2750.8eb13c6b).
export * from './impl.js';
import { panelRows as right } from './impl.js';

type Rows = ReturnType<typeof right>;
type Detail = Record<string, unknown>;
/** The share with none over the commit rows left, as the reading's value is. */
const share = (detail: Detail[]): number | null => {
  const commits = detail.filter((r) => typeof r.commit === 'string');
  return commits.length ? commits.filter((r) => r.judged === 'none').length / commits.length : null;
};

export function panelRows(...given: Parameters<typeof right>): Rows {
  return right(...given).map((row) => {
    if (row.id !== 'landed.none' || !row.detail) return row;
    const detail = row.detail.filter((r) => typeof r.commit !== 'string' || r.judged !== 'none');
    return { ...row, detail, value: share(detail) };
  });
}
