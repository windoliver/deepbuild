import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { recount } from '../packages/jobs/asset-tools/check/recount.mjs';
import { Refused, run } from '../packages/jobs/asset-tools/tool/derive.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const tableInput = (csv, key, units = {}) => {
  const bytes = Buffer.from(csv, 'utf8');
  return { bytes, key, units, sha: sha(bytes) };
};

function runAndRecount(inputs, steps, key) {
  const params = {
    inputs: Object.fromEntries(Object.entries(inputs).map(([n, t]) => [n, t.sha])),
    steps,
    key,
  };
  const given = Object.fromEntries(Object.entries(inputs).map(([n, t]) => [n, { bytes: t.bytes, key: t.key, units: t.units }]));
  const wrote = run(params, given);
  const forCheck = Object.fromEntries(Object.entries(inputs).map(([n, t]) => [n, { bytes: t.bytes, key: t.key }]));
  const issues = recount(params, forCheck, wrote);
  return { params, wrote, issues };
}

test('closed-list special scalar functions erf, erfc, gamma, lgamma, factorial, binom match across tool and recount', () => {
  const rows = [
    'id,x,n,k',
    '1,0.5,5,2',
    '2,-1.25,0,0',
    '3,4.25,10,3',
    '4,1.5,171,2',
    '5,0,1.5,1',
  ].join('\n') + '\n';
  const t = tableInput(rows, 'id');
  const { wrote, issues } = runAndRecount({ t }, [{
    derive: {
      e: { expr: 'erf(x)', unit: null },
      ec: { expr: 'erfc(x)', unit: null },
      g: { expr: 'gamma(x + 2.5)', unit: null },
      lg: { expr: 'lgamma(x + 2.5)', unit: null },
      f: { expr: 'factorial(n)', unit: null },
      b: { expr: 'binom(n, k)', unit: null },
    },
  }], 'id');
  assert.deepEqual(issues, []);
  const lines = wrote.table.toString('utf8').trim().split('\n').map((l) => l.split(','));
  const header = lines[0];
  const at = (id, col) => lines.find((r) => r[0] === id)[header.indexOf(col)];
  assert.ok(Math.abs(Number(at('1', 'e')) - 0.5204998778130465) < 1e-12);
  assert.ok(Math.abs(Number(at('1', 'ec')) - 0.4795001221869535) < 1e-12);
  assert.ok(Math.abs(Number(at('3', 'ec')) - 1.8505741373867423e-9) / 1.8505741373867423e-9 < 1e-12);
  assert.ok(Math.abs(Number(at('1', 'g')) - 2.0) < 1e-12);
  assert.ok(Math.abs(Number(at('1', 'lg')) - Math.log(2.0)) < 1e-12);
  assert.equal(Number(at('1', 'f')), 120);
  assert.equal(Number(at('2', 'f')), 1);
  assert.equal(Number(at('1', 'b')), 10);
  assert.equal(Number(at('3', 'b')), 120);
  assert.equal(at('4', 'f'), '');
  assert.equal(at('5', 'f'), '');
  assert.equal(at('5', 'b'), '');
  const receipt = JSON.parse(wrote.receipt.toString('utf8'));
  assert.equal(receipt.nonfinite.f, 2);
  assert.equal(receipt.nonfinite.b, 1);
});

test('unit mismatches in smoothstep, remap, hypot, atan2 and mod are refused naming both units', () => {
  const t = tableInput('id,a,b\n1,10,20\n', 'id', { a: 'workers', b: 'dollars' });
  for (const expr of ['smoothstep(a, b, a)', 'remap(a, a, b, 0, 1)', 'hypot(a, b)', 'atan2(a, b)', 'mod(a, b)']) {
    assert.throws(
      () => run({ inputs: { t: t.sha }, steps: [{ derive: { out: { expr, unit: null } } }], key: 'id' }, { t: { bytes: t.bytes, key: t.key, units: t.units } }),
      (err) => err instanceof Refused && /\bworkers\b/.test(err.message) && /\bdollars\b/.test(err.message),
      `expected unit refusal for ${expr}`,
    );
  }
});

test('group on empty table after filter matches between tool and recount', () => {
  const t = tableInput('id,grp,v\n1,A,10\n2,B,20\n', 'id', { v: 'workers' });
  const { wrote, issues } = runAndRecount({ t }, [
    { filter: { where: 'v > 100' } },
    { group: { by: ['grp'], agg: { total: 'sum(v)', n: 'count', avg: 'mean(v)' } } },
  ], 'grp');
  assert.deepEqual(issues, []);
  assert.equal(wrote.table.toString('utf8'), 'grp,total,n,avg\n');
  assert.equal(JSON.parse(wrote.receipt.toString('utf8')).dropped, 2);
});

test('select dropping a summed column and filter after group both pass recount', () => {
  const t = tableInput('id,grp,v,w\n1,A,10,2\n2,A,20,3\n3,B,5,1\n', 'id', { v: 'workers', w: 'hours' });
  const selected = runAndRecount({ t }, [
    { group: { by: ['grp'], agg: { total: 'sum(v)', n: 'count', avg: 'mean(v, weight: w)' } } },
    { select: { columns: ['grp', 'n', 'avg'] } },
  ], 'grp');
  assert.deepEqual(selected.issues, []);
  const filtered = runAndRecount({ t }, [
    { group: { by: ['grp'], agg: { total: 'sum(v)', n: 'count' } } },
    { filter: { where: 'total >= 10' } },
  ], 'grp');
  assert.deepEqual(filtered.issues, []);
  assert.equal(filtered.wrote.table.toString('utf8'), 'grp,total,n\nA,30,2\n');
});

test('rank compares large i64 and string values accurately in both tool and recount', () => {
  const t = tableInput('id,big,label\na,9007199254740992,z\nb,9007199254740993,a\n', 'id');
  const { wrote, issues } = runAndRecount({ t }, [
    { rank: { by: 'big', desc: true, into: 'r_big' } },
    { rank: { by: 'label', desc: false, into: 'r_label' } },
  ], 'id');
  assert.deepEqual(issues, []);
  assert.equal(wrote.table.toString('utf8'), 'id,big,label,r_big,r_label\na,9007199254740992,z,2,2\nb,9007199254740993,a,1,1\n');
});

test('left join, one_to_one refusal, i64 overflow refusal and non-finite f64 sum', () => {
  const left = tableInput('id,k,v\n1,x,10\n2,y,20\n', 'id');
  const right = tableInput('rid,k,tag\n1,x,hit\n', 'rid');
  const leftJoin = runAndRecount({ left, right }, [
    { join: { with: 'right', on: ['k'], kind: 'left', expect: 'many_to_one' } },
  ], 'id');
  assert.deepEqual(leftJoin.issues, []);
  assert.equal(leftJoin.wrote.table.toString('utf8'), 'id,k,v,rid,tag\n1,x,10,1,hit\n2,y,20,,\n');

  const dupLeft = tableInput('id,k,v\n1,x,10\n2,x,20\n', 'id');
  assert.throws(
    () => run({ inputs: { dupLeft: dupLeft.sha, right: right.sha }, steps: [{ join: { with: 'right', on: ['k'], kind: 'inner', expect: 'one_to_one' } }], key: 'id' }, { dupLeft: { bytes: dupLeft.bytes, key: 'id', units: {} }, right: { bytes: right.bytes, key: 'rid', units: {} } }),
    (err) => err instanceof Refused && /\bx\b/.test(err.message),
  );

  const over = tableInput('id,grp,v\n1,big,9223372036854775800\n2,big,100\n', 'id');
  assert.throws(
    () => run({ inputs: { over: over.sha }, steps: [{ group: { by: ['grp'], agg: { s: 'sum(v)' } } }], key: 'grp' }, { over: { bytes: over.bytes, key: 'id', units: {} } }),
    (err) => err instanceof Refused && /\bbig\b/.test(err.message),
  );

  const infSum = tableInput('id,grp,v\n1,g,1e308\n2,g,1e308\n', 'id');
  const infRes = runAndRecount({ infSum }, [{ group: { by: ['grp'], agg: { s: 'sum(v)' } } }], 'grp');
  assert.deepEqual(infRes.issues, []);
  assert.equal(infRes.wrote.table.toString('utf8'), 'grp,s\ng,\n');
  assert.equal(JSON.parse(infRes.wrote.receipt.toString('utf8')).nonfinite.s, 1);
});

test('recount catches a rogue tool that ignores duplicate join keys or i64 overflow', () => {
  const c = tableInput('id,k,v\n1,x,10\n', 'id');
  const dup = tableInput('rid,k,m\n1,x,A\n2,x,B\n', 'rid');
  const params = {
    inputs: { c: c.sha, dup: dup.sha },
    steps: [{ join: { with: 'dup', on: ['k'], kind: 'inner', expect: 'many_to_one' } }],
    key: 'id',
  };
  const issues = recount(
    params,
    { c: { bytes: c.bytes, key: 'id' }, dup: { bytes: dup.bytes, key: 'rid' } },
    {
      table: Buffer.from('id,k,v,rid,m\n1,x,10,2,B\n'),
      receipt: Buffer.from('{"rows_in":1,"rows_out":1,"dropped":0,"skipped":{},"nonfinite":{}}\n'),
      lineage: Buffer.from('{"format":1,"key":"id","inputs":{},"columns":{},"rows":{"1":{"c":["1"],"dup":["2"]}}}\n'),
    },
  );
  assert.ok(issues.some((m) => /\bx\b/.test(m)), `expected duplicate key failure, got ${JSON.stringify(issues)}`);
});
