// A numbers check's queries (#87), in a process of its own so the runner's deadline can end a query whatever it
// waits on. It reads {spec, checkout} as JSON on stdin and writes one line of JSON: {outcome, testsRun, failures,
// read}. A failure at the check's assertion is a number that doesn't hold or a term that changes nothing; a query
// that errors leaves this process with its error on stderr, which the runner keeps as the crash's output.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const { spec, checkout } = JSON.parse(readFileSync(0, 'utf8'));
const failures = [];
const read = new Set();
const open = new Map();
const at = (test, file, message) => failures.push({ test, file, line: 1, stack: null, assertion: true, message });

/** Every row of a query on a SQLite file of the checkout, opened read-only. */
function rows(database, sql) {
  read.add(database);
  if (!open.has(database)) open.set(database, new DatabaseSync(join(checkout, database), { readOnly: true }));
  return open.get(database).prepare(sql).all();
}
/** The number a query returns: its one row's first column. */
function value(q) {
  const [row] = rows(q.database, q.sql);
  const v = row === undefined ? undefined : Object.values(row)[0];
  if (typeof v !== 'number') throw new Error(`the query on ${q.database} returned ${row === undefined ? 'no row' : JSON.stringify(v)}, not a number: ${q.sql}`);
  return v;
}
const shown = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 6 });
/** A number as people write it: digits, optionally grouped by commas in threes, and a decimal part. */
const WRITTEN = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;

for (const n of spec.numbers) {
  const stated = WRITTEN.test(n.stated) ? Number(n.stated.replace(/,/g, '')) : NaN;
  if (!Number.isFinite(stated)) throw new Error(`${n.where}: ${JSON.stringify(n.stated)} isn't a number`);
  // Held to the decimals written: 1.8 holds for 1.79, 1,500 doesn't for 1499.
  const decimals = n.stated.split('.')[1]?.length ?? 0;
  const round = (v) => Number(v.toFixed(decimals));
  const got = value(n.query);
  if (round(got) !== stated) at(`numbers: ${n.where}`, n.query.database, `${n.where} states ${n.stated}, and its query returns ${shown(got)}: a difference of ${shown(got - stated)}`);
  if (n.recount) {
    const recount = value(n.recount);
    if (round(recount) !== stated) at(`numbers: ${n.where}`, n.recount.database, `${n.where} states ${n.stated}, and its recount returns ${shown(recount)}: a difference of ${shown(recount - stated)}`);
  }
}
for (const t of spec.added) {
  const kept = JSON.stringify(rows(t.sample, t.with));
  if (kept === JSON.stringify(rows(t.sample, t.without))) {
    at(`numbers: ${t.kind} ${t.term}`, t.sample, `the ${t.kind} ${t.term} changes no result on the sample ${t.sample}: ${kept} with it and without it`);
  }
}
for (const db of open.values()) db.close();
const testsRun = spec.numbers.length + spec.added.length;
process.stdout.write(`${JSON.stringify({ outcome: testsRun === 0 ? 'ran_nothing' : failures.length ? 'failed' : 'passed', testsRun, failures, read: [...read] })}\n`);
