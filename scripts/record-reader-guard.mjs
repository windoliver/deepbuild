// The preflight's record-reader guard (#326): the app has one record reader, crates/deep-app/src/record.rs, which
// holds the hub's stream and its log_pos and feeds every view. Any other module of the app that names the stream's
// subscribe or one of the App API's reads, as a string the hub's methods go by, would read the record for itself and
// can show a view at another log_pos. One `FAIL record reader: <path>: ...` line per such module, or one `PASS record
// reader` line; exit 1 on a finding. `--root <dir>` checks the app's source under another checkout.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'crates/deep-app/src';
const READER = `${SOURCE}/record.rs`;
/** The stream and the reads: the hub methods the record reader calls, and the App API's other reads. */
const METHODS = ['stream.subscribe', 'events.read', 'inbox.read', 'sessions.read', 'changes.read', 'evidence.read', 'numbers.read'];

const at = process.argv.indexOf('--root');
if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) {
  console.log('BLOCKED record reader: --root takes a folder\n  Fix: node scripts/record-reader-guard.mjs [--root <checkout>]');
  process.exit(2);
}
const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : process.argv[at + 1];

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : name.endsWith('.rs') ? [path] : [];
});

const findings = [];
for (const file of files(join(root, SOURCE))) {
  const path = relative(root, file).replaceAll('\\', '/');
  if (path === READER) continue;
  const text = readFileSync(file, 'utf8');
  const named = METHODS.filter((method) => text.includes(`"${method}"`));
  if (named.length) findings.push(`FAIL record reader: ${path}: it names ${named.join(', ')}, so it reads the record for itself; read it through ${READER}'s one reader (record::with_view) instead`);
}
for (const line of findings) console.log(line);
if (!findings.length) console.log(`PASS record reader: only ${READER} subscribes to the stream or calls the reads`);
process.exitCode = findings.length ? 1 : 0;
