// A wrong lint: it fails any `.is_none()` or `.is_some()` in a file, so a view's own state fails it too, and it names the
// file, not the line.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[process.argv.indexOf('--root') + 1];
const source = join(root, 'crates/deep-app/src');
let found = 0;
for (const file of readdirSync(source).filter((f) => f.endsWith('.rs'))) {
  if (/\.is_(none|some)\(\)/.test(readFileSync(join(source, file), 'utf8'))) { console.log(`FAIL render: crates/deep-app/src/${file}: a branch on fixture state`); found++; }
}
if (!found) console.log('PASS render');
process.exitCode = found ? 1 : 0;
