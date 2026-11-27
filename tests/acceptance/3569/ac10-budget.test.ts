// #3569.1d1485e8: "Budget, on the reference Mac in the local preflight: 3,200 rows of 40 columns joined to a 2,000-row
// table and grouped into 1,000 groups finish in under 2 s (estimate; the first measurement may move it once)"
//
// Made here, truth by construction: `big`, 3,200 rows of 40 columns (id, link and c01 to c38, integers in workers),
// row i linking to ((i − 1) mod 2,000) + 1; `links`, 2,000 rows (link, grp), link l in group ((l − 1) mod 1,000) + 1.
// The job joins links onto big by link (inner, many to one) and groups by grp, summing each of the 38 columns and
// counting rows: 1,000 groups. Six copies of big differ in their numbers (an offset each), so each run is a miss with a
// key of its own: one warm-up, then five timed runs. What is timed is the deep_job call, from the request to the
// reply that says done: the tool's run and the kind's output check, data.derived, which the job finishes with.
// The judge is the design's (#397's and #855's): PASS when all five are within 2,000 ms, FAIL when all are over it by
// more than the margin (the larger of 5% and their spread), else INCONCLUSIVE. Off a reference Mac (Mac15,7 or
// Mac15,12), in Low Power Mode, under a thermal warning or a 1-minute load above half the cores, the five readings are
// taken and printed and the test reads INCONCLUSIVE (a skip), never PASS; mains power never gates.
// Wrong programs it fails on: the merge base; a job that doesn't finish, or writes other than 1,000 groups; on a
// reference Mac, a job that takes 2 s or more every time.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, brief, derive, derivedOf, environmentProblem, importTables, int, judge, keysOf, openHub, proof, show, type DeriveParams, type TableSpec } from './helpers.ts';

const ID = AC[10];
const LIMIT_MS = 2000;
const ROWS = 3200;
const LINKS = 2000;
const GROUPS = 1000;
const COLUMNS = Array.from({ length: 38 }, (_, k) => `c${String(k + 1).padStart(2, '0')}`);

function big(offset: number): Buffer {
  const lines = [['id', 'link', ...COLUMNS].join(',')];
  for (let i = 1; i <= ROWS; i++) lines.push([i, ((i - 1) % LINKS) + 1, ...COLUMNS.map((_, k) => (i * (k + 1) + offset) % 997)].join(','));
  return Buffer.from(`${lines.join('\n')}\n`);
}
function links(): Buffer {
  const lines = ['link,grp'];
  for (let l = 1; l <= LINKS; l++) lines.push(`${l},${((l - 1) % GROUPS) + 1}`);
  return Buffer.from(`${lines.join('\n')}\n`);
}
const UNITS = Object.fromEntries(COLUMNS.map((c) => [c, 'workers']));
const params = (bigSha: string, linksSha: string): DeriveParams => ({
  inputs: { big: bigSha, links: linksSha },
  steps: [
    { join: { with: 'links', on: ['link'], kind: 'inner', expect: 'many_to_one' } },
    { group: { by: ['grp'], agg: { ...Object.fromEntries(COLUMNS.map((c) => [`s${c.slice(1)}`, `sum(${c})`])), n: 'count' } } },
  ],
  key: 'grp',
});

describe(`${ID} a 3,200-row, 40-column table joined to 2,000 rows and grouped into 1,000 groups finishes within 2 s`, () => {
  it(`${ID} 3,200 rows of 40 columns joined to a 2,000-row table and grouped into 1,000 groups finish in under 2 s on the reference Mac`, async (ctx) => {
    const hub = await openHub();
    expect(typeof hub === 'string' ? hub : '', 'a hub with packages/jobs/asset-tools installed and its table.derive tool listed').toBe('');
    if (typeof hub === 'string') return;
    const specs: TableSpec[] = [{ name: 'links.csv', bytes: links(), key: 'link' }, ...Array.from({ length: 6 }, (_, r): TableSpec => ({ name: `big-${r}.csv`, bytes: big(r), key: 'id', units: UNITS }))];
    const tables = await importTables(hub, specs);
    expect(typeof tables === 'string' ? tables : '', 'the seven tables fetched into the hub\'s evidence store').toBe('');
    if (typeof tables === 'string') return;

    const readings: number[] = [];
    const seen: unknown[] = [];
    for (let r = 0; r < 6; r++) {
      const d = derivedOf(hub, await derive(hub, params(tables.sha[`big-${r}.csv`]!, tables.sha['links.csv']!)), `run ${r}`);
      expect(typeof d === 'string' ? d : '', `run ${r} (${r === 0 ? 'warm-up' : 'timed'}) is done`).toBe('');
      if (typeof d === 'string') return;
      expect(d.run.outcome.value.receipt?.cache, `run ${r} is a miss: ${brief(d.run)}`).toBe('miss');
      expect(d.table.rows.length, `run ${r} writes 1,000 groups: ${show(d.table.text.slice(0, 300))}`).toBe(GROUPS);
      expect(new Set(keysOf(d.table, 'grp')).size, `run ${r}: each group once`).toBe(GROUPS);
      const one = int(d.table.rows[0]?.[d.table.header.indexOf('n')]);
      expect(typeof one === 'number' && one >= 3 && one <= 4, `run ${r}: each group counts 3 or 4 rows: ${show(d.table.rows[0])}`).toBe(true);
      seen.push({ run: r, ms: d.run.ms, outputs: d.outputs, receipt: d.receipt });
      if (r > 0) readings.push(d.run.ms);
    }
    const problem = environmentProblem();
    proof('ac10.json', { readings, problem, load: (await import('node:os')).loadavg(), runs: seen });
    if (problem) {
      console.log(`${ID} readings (ms): ${readings.map((m) => m.toFixed(1)).join(', ')}; ${problem}`);
      ctx.skip(`INCONCLUSIVE: ${problem}; readings ${readings.map((m) => m.toFixed(0)).join(', ')} ms against ${LIMIT_MS} ms`);
      return;
    }
    judge(ctx, `${ID} deep_job table.derive, ms`, readings, LIMIT_MS);
  }, TIMEOUT);
});
