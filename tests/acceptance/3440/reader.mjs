// #3440: the second process of held-read.test.ts. It opens the record's file on a read-only connection of its own, as
// code beside the hub does, and holds one read open: it takes the first row of a SELECT over the log and leaves the
// rest, so its read transaction stays open. It says `reading <log_pos>` once the read is open, and ends the read when
// its stdin gets a line or closes, says `ended`, and exits 0.
//   node tests/acceptance/3440/reader.mjs <the record's file>
import Database from 'better-sqlite3';

const db = new Database(process.argv[2], { readonly: true, fileMustExist: true });
const rows = db.prepare('SELECT log_pos FROM events ORDER BY log_pos').iterate();
const first = rows.next();
if (first.done) {
  process.stderr.write('the log holds no event to read\n');
  process.exit(2);
}
let over = false;
function end() {
  if (over) return;
  over = true;
  rows.return();
  db.close();
  process.stdout.write('ended\n', () => process.exit(0));
}
process.stdin.once('data', end);
process.stdin.once('end', end);
process.stdout.write(`reading ${first.value.log_pos}\n`);
