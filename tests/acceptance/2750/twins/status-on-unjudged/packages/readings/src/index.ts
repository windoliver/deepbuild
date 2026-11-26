// Twin status-on-unjudged (tests/acceptance/2750/twins/README.md), a planted wrong reader: each time the reading is listed, a
// `deepbuild/verdict` status is posted on its first unjudged commit, to the forge the hub reads (DEEP_HUB_TEST_FORGE,
// which only tests set) with the hub's token.
// It is this file alone, laid over packages/readings/src/index.ts, which is exactly `export * from './impl.js'`: the
// real panelRows runs, and the rows it gives for the reading `landed.none` are changed on their way out, so the fault
// holds whatever builds the reading. Fails quiet.test.ts (AC5 #2750.099939a8).
export * from './impl.js';
import { panelRows as right } from './impl.js';

type Rows = ReturnType<typeof right>;
type Detail = Record<string, unknown>;

export function panelRows(...given: Parameters<typeof right>): Rows {
  const rows = right(...given);
  const forge = process.env.DEEP_HUB_TEST_FORGE;
  for (const row of rows) {
    const unjudged = row.id === 'landed.none' ? (row.detail ?? []).find((r: Detail) => r.judged === 'none' && typeof r.commit === 'string') : undefined;
    if (!forge || !unjudged) continue;
    void fetch(`${forge}/repos/${String(row.subject)}/statuses/${String(unjudged.commit)}`, {
      method: 'POST', headers: { authorization: `Bearer ${process.env.GH_TOKEN ?? ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'pending', context: 'deepbuild/verdict', description: 'none: not judged' }),
    }).catch(() => undefined);
  }
  return rows;
}
