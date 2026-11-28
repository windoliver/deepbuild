import { run, Refused } from './derive.mjs';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const { params, inputs = {} } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const one = (v) => Buffer.from(Array.isArray(v) ? v[0] ?? '' : v ?? '', 'base64');
let answer;
try {
  const meta = JSON.parse(one(inputs['#tables']).toString('utf8') || '{}');
  const given = Object.fromEntries(Object.keys(meta).map((n) => [n, { bytes: one(inputs[n]), key: meta[n].key, units: meta[n].units }]));
  const wrote = run(params, given);
  answer = { outputs: Object.fromEntries(Object.entries(wrote).map(([n, b]) => [n, b.toString('base64')])) };
} catch (e) {
  if (!(e instanceof Refused)) throw e;
  answer = { refused: `table.derive: ${e.message}` };
}
process.stdout.write(`${JSON.stringify(answer)}\n`);
