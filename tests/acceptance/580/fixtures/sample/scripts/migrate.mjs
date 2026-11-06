// npm run db:migrate: applies db/migrations in order to the database $DATABASE_URL names.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pg, retry } from 'dh-wire';
import { logged } from './step.mjs';

const db = await retry(() => pg(process.env.DATABASE_URL));
for (const file of readdirSync('db/migrations').sort()) await db.query(readFileSync(join('db/migrations', file), 'utf8'));
db.close();
logged('migrate');
