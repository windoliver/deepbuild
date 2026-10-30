// A journey: a check that needs the app running and its database. It asks the stack's app (GET /db on 127.0.0.1
// at the port in `web`) which database it serves and what it holds, writes journey.json in its folder with that
// answer and its own $DATABASE, and exits 0 only when the app serves a seeded database.
import { writeFileSync } from 'node:fs';

const port = process.env.web;
let db = null;
let error = null;
try {
  const res = await fetch(`http://127.0.0.1:${port}/db`, { signal: AbortSignal.timeout(3000) });
  db = await res.json();
} catch (e) {
  error = String(e?.cause?.code ?? e?.message ?? e);
}
writeFileSync('journey.json', JSON.stringify({ web: port ?? null, database: process.env.DATABASE ?? null, db, error }));
process.exit(db?.content?.includes('seeded-by=dh332-fixture') ? 0 : 1);
