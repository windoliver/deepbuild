// The lease table's workload, for the perf lane's budgets (issue #237): node benchmarks/lease.mjs.
// One process opens a record and the lease table in a temp folder, declares a port kind, grants 1,000 leases on
// ports one after another, refuses a second holder on each, and lets every holder end and its lease go.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLeases } from '../packages/leases/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';

const T0 = 1_760_013_451_000;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let counter = 0n;
/** A ULID at `ms`, with a counter for its random part: unique, ordered, and the same on every run. */
function ulidAt(ms) {
  let s = '';
  let value = (BigInt(ms) << 80n) | counter++;
  for (let i = 0; i < 26; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}

const root = mkdtempSync(join(tmpdir(), 'deep-lease-bench-'));
try {
  const record = await openRecord({ path: join(root, 'record.db'), now: () => T0 });
  const table = await openLeases({ record, now: () => T0, cores: 4 });
  await table.declare('env-local', { name: 'port', match: 'exact', cap: 1000, cooldown: 0, cost: 0 });
  const holders = [];
  for (let n = 0; n < 1000; n++) {
    const [a, b] = [`session:${ulidAt(T0)}`, `session:${ulidAt(T0)}`];
    const port = { host: 'local', kind: 'port', key: String(3000 + n) };
    if ((await table.lease({ holder: a }, port, 'exclusive')).status !== 'granted') throw Error(`port ${port.key} is granted`);
    if ((await table.lease({ holder: b }, port, 'exclusive')).status !== 'refused') throw Error(`a second holder on port ${port.key} is refused`);
    holders.push(a);
  }
  for (const holder of holders) {
    const session = holder.slice('session:'.length);
    await record.append({ writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' }, { v: 1, id: ulidAt(T0), kind: 'session.end', subject: holder, ts: T0, data: { reason: 'prompt_input_exit' } });
  }
  await table.tick();
  if ((await table.leases()).length) throw Error('every ended holder\'s lease is released');
  await record.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}
