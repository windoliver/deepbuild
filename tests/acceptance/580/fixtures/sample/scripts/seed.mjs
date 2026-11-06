// npm run db:seed: fills the database $DATABASE_URL names and the stack's Redis, then leaves its completion record at
// $DEEP_SEED_RECORD (#332). With "seed_mb" in obs.json it pads the database to that many megabytes of random text.
import { readFileSync, writeFileSync } from 'node:fs';
import { pg, redis, retry } from 'dh-wire';
import { logged } from './step.mjs';

const { seed_mb: mb = 0 } = JSON.parse(readFileSync('obs.json', 'utf8'));
const db = await retry(() => pg(process.env.DATABASE_URL));
await db.query("INSERT INTO products (sku) VALUES ('tea'), ('mug'), ('pot') ON CONFLICT DO NOTHING");
if (mb) await db.query(`INSERT INTO padding SELECT g, (SELECT string_agg(md5(random()::text || g::text || i::text), '') FROM generate_series(1, 25) i) FROM generate_series(1, ${mb * 1250}) g`);
db.close();
const kv = await retry(() => redis(process.env.redis));
await kv.command('SET', 'seeded', '1');
await kv.command('SAVE');
kv.close();
writeFileSync(process.env.DEEP_SEED_RECORD, JSON.stringify({ source: 'fixtures://shop/snapshot-2026-10-01.sql', copied_at: '2026-10-01T04:00:00.000Z', migration: '001-orders' }));
logged('seed');
