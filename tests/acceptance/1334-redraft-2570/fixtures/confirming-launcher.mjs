import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [frozen, confirm, file] = process.argv.slice(2);
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let given = file;
try {
  const text = readFileSync(file, 'utf8');
  const named = /<plist/.test(text)
    ? text.replace(/(<key>EnvironmentVariables<\/key>\s*<dict>)/, `$1\n    <key>DEEP_HUB_TEST_CONFIRM</key>\n    <string>${xml(confirm)}</string>`)
    : text.replace(/^(Environment=.*)$/m, `$1 "DEEP_HUB_TEST_CONFIRM=${confirm.replace(/(["\\])/g, '\\$1')}"`);
  if (named !== text) {
    given = `${confirm}.definition`;
    writeFileSync(given, named);
  }
} catch {
  given = file;
}
const run = spawnSync(frozen, [given], { stdio: 'inherit' });
process.exit(run.status ?? 1);
