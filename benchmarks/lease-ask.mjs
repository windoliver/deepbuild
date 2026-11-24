// The lease table's ask for several resources, for the perf lane's budgets (issue #3218): node benchmarks/lease-ask.mjs.
// One process opens a record and the lease table in a temp folder, declares two pools and a port kind, holds 1,000
// leases from 250 asks of four (a cpu.slot, units of each pool and a port), then makes 1,000 asks of four that are
// refused on their fourth resource, the pool those 250 filled, so each is read and decided and appends nothing.
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

const root = mkdtempSync(join(tmpdir(), 'deep-lease-ask-bench-'));
try {
  const record = await openRecord({ path: join(root, 'record.db'), now: () => T0 });
  const table = await openLeases({ record, now: () => T0, cores: 4096 });
  await table.declare('bench', { name: 'bench.pa', match: 'pool(100000)', cap: 100_000, cooldown: 0, cost: 0 });
  await table.declare('bench', { name: 'bench.pb', match: 'pool(2500)', cap: 100_000, cooldown: 0, cost: 0 });
  await table.declare('bench', { name: 'bench.port', match: 'exact', cap: 100_000, cooldown: 0, cost: 0 });
  const slot = { host: 'local', kind: 'cpu.slot', key: 'slot' };
  const pa = { host: 'local', kind: 'bench.pa', key: 'pa' };
  const pb = { host: 'local', kind: 'bench.pb', key: 'pb' };
  const port = (key) => ({ host: 'local', kind: 'bench.port', key });
  for (let n = 0; n < 250; n++) {
    const r = await table.ask({ holder: `session:${ulidAt(T0)}` }, [
      { resource: slot, mode: 'exclusive' }, { resource: pa, mode: 'exclusive', units: 10 },
      { resource: pb, mode: 'exclusive', units: 10 }, { resource: port(`held-${n}`), mode: 'exclusive' },
    ]);
    if (r.status !== 'granted') throw Error(`held ask ${n + 1} is granted: ${r.message}`);
  }
  for (let n = 0; n < 1000; n++) {
    const r = await table.ask({ holder: `session:${ulidAt(T0)}` }, [
      { resource: slot, mode: 'exclusive' }, { resource: pa, mode: 'exclusive', units: 5 },
      { resource: port(`free-${n}`), mode: 'exclusive' }, { resource: pb, mode: 'exclusive', units: 1 },
    ]);
    if (r.status !== 'refused' || r.resource.kind !== 'bench.pb') throw Error(`ask ${n + 1} is refused on its fourth resource`);
  }
  if ((await table.leases()).length !== 1000) throw Error('the 1,000 leases are still held');
  await record.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}
