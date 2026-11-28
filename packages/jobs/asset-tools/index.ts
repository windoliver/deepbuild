import { createHash } from 'node:crypto';
import { recount } from './check/recount.mjs';

const PARAMS = {
  type: 'object',
  properties: {
    inputs: { type: 'object' },
    steps: { type: 'array', items: { type: 'object' } },
    key: { type: 'string' },
  },
  required: ['inputs', 'steps', 'key'],
  additionalProperties: false,
};
const OUTPUTS = { table: { media: 'text/csv' }, lineage: { media: 'application/json' }, receipt: { media: 'application/json' }, record: { media: 'application/json' } };

const FIXTURE_TABLE = 'site,region,staff,hours\nn1,north,3,12.5\nn2,north,4,30\ns1,south,2,8\n';
const FIXTURE_SHA = createHash('sha256').update(FIXTURE_TABLE).digest('hex');
const FIXTURE_META = JSON.stringify({ sites: { key: 'site', units: { staff: 'people', hours: 'hours' } } });
const FIXTURE_PARAMS = {
  inputs: { sites: FIXTURE_SHA },
  steps: [
    { derive: { per: { expr: 'hours / staff', unit: 'hours/people' } } },
    { group: { by: ['region'], agg: { staff: 'sum(staff)', hours: 'sum(hours)', sites: 'count', per: 'max(per)' } } },
    { rank: { by: 'hours', into: 'place' } },
  ],
  key: 'region',
};
const FIXTURE_LINEAGE = JSON.stringify({
  format: 1, key: 'region', inputs: { sites: { sha256: FIXTURE_SHA, key: 'site' } },
  columns: {
    region: { unit: null, reads: [{ input: 'sites', column: 'region' }] }, staff: { unit: 'people', reads: [{ input: 'sites', column: 'staff' }] },
    hours: { unit: 'hours', reads: [{ input: 'sites', column: 'hours' }] }, sites: { unit: 'count', reads: [{ input: 'sites', column: 'region' }] },
    per: { unit: 'hours/people', reads: [{ input: 'sites', column: 'hours' }, { input: 'sites', column: 'staff' }] },
    place: { unit: null, reads: [{ input: 'sites', column: 'hours' }] },
  },
  rows: { north: { sites: ['n1', 'n2'] }, south: { sites: ['s1'] } },
});

interface Spec { outputs?: Record<string, string>; job?: { params?: Record<string, unknown>; inputs?: Record<string, string | string[]> } }
const bytes = (v: unknown): Buffer => Buffer.from(String(Array.isArray(v) ? v[0] ?? '' : v ?? ''), 'base64');

export default async function (deep: any): Promise<void> {
  await deep.registerCheck('data.derived', async (spec: Spec) => {
    let found: string[];
    try {
      const inputs = spec?.job?.inputs ?? {};
      const meta = JSON.parse(bytes(inputs['#tables']).toString('utf8') || 'null') as Record<string, { key: string }> | null;
      if (!meta || !spec?.job?.params) throw Error('the job\'s params and input tables are missing');
      const tables = Object.fromEntries(Object.entries(meta).map(([n, m]) => [n, { bytes: bytes(inputs[n]), key: m.key }]));
      const out = Object.fromEntries(['table', 'lineage', 'receipt'].map((n) => [n, bytes(spec.outputs?.[n])]));
      found = recount(spec.job.params, tables, out);
    } catch (e) {
      found = [`data.derived: the recount can't read the job: ${e instanceof Error ? e.message : String(e)}`];
    }
    return {
      outcome: found.length ? 'failed' : 'passed', testsRun: 1, evidence: [], read: [], mask: null,
      failures: found.map((message) => ({ test: 'data.derived', file: 'check/recount.mjs', line: 1, stack: null, assertion: true, message })),
    };
  });
  await deep.registerJob('table.derive', {
    schema: { params: PARAMS, inputs: {}, tables: 'inputs' },
    outputs: OUTPUTS,
    key: ['tool', 'params', 'inputs'],
    output_checks: ['data.derived'],
    qualification: {
      fixtures: [{
        name: 'sites-by-region',
        params: FIXTURE_PARAMS,
        inputs: { sites: FIXTURE_TABLE, '#tables': FIXTURE_META },
        expect: {
          table: 'region,staff,hours,sites,per,place\nnorth,7,42.5,2,7.5,1\nsouth,2,8,1,4,2\n',
          lineage: `${FIXTURE_LINEAGE}\n`,
          receipt: '{"rows_in":3,"rows_out":2,"dropped":0,"skipped":{},"nonfinite":{}}\n',
        },
      }],
    },
  });
  await deep.registerJobTool('table.derive', {
    tool: 'table-derive@1.0.0',
    params: PARAMS,
    run: { dir: 'tool', entry: 'run.mjs' },
    qualification: { same_bytes: true },
  });
}
