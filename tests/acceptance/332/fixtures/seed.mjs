// The repo's seed step, as the environment block's `seed.run` names it (README, The surface under test). It writes
// the seeded database, a file database, at the path the environment hands it in the variable `seed.database` names
// (DATABASE): the template. Then, unless --no-record, it leaves its completion record: JSON {source, copied_at,
// migration} at the path in DEEP_SEED_RECORD. It also writes seed.json in its folder with the path it was given,
// so a test can tell the template from a run's clone. Every value is a fixed fake, so the template's bytes, and
// their digest, are known to the test (seed.test.ts).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const DATABASE = process.env.DATABASE;
writeFileSync('seed.json', JSON.stringify({ database: DATABASE ?? null, record: process.env.DEEP_SEED_RECORD ?? null }));
if (!DATABASE) { console.error('seed: no database path in $DATABASE'); process.exit(64); }
mkdirSync(dirname(DATABASE), { recursive: true });
writeFileSync(DATABASE, 'orders=0\nproducts=3\nseeded-by=dh332-fixture\n');
if (!process.argv.includes('--no-record')) {
  const at = process.env.DEEP_SEED_RECORD;
  if (!at) { console.error('seed: no record path in $DEEP_SEED_RECORD'); process.exit(65); }
  writeFileSync(at, JSON.stringify({ source: 'fixtures://shop/snapshot-2026-10-01.sql', copied_at: '2026-10-01T04:00:00.000Z', migration: '20261015120000_add_orders' }));
}
