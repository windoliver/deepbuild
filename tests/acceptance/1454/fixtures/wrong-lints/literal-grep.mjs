// A wrong lint: it looks for the issue's one spelling, in any file, so a renamed variable or a fixture read in another
// view's render goes through.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[process.argv.indexOf('--root') + 1];
const source = join(root, 'crates/deep-app/src');
let found = 0;
for (const file of readdirSync(source).filter((f) => f.endsWith('.rs'))) {
  readFileSync(join(source, file), 'utf8').split('\n').forEach((line, i) => {
    if (line.includes('decorations.is_none()')) { console.log(`FAIL render: crates/deep-app/src/${file}:${i + 1}: a branch on fixture state`); found++; }
  });
}
if (!found) console.log('PASS render');
process.exitCode = found ? 1 : 0;
