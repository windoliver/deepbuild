import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [file, ...rest] = process.argv.slice(2);
const { T2570R5_LAUNCHER: launcher, T2570R5_CONFIRM: confirm, T2570R5_PRELOAD: preload } = process.env;
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const quoted = (s) => `"${s.replace(/(["\\])/g, '\\$1')}"`;

if (file && confirm) {
  let text = readFileSync(file, 'utf8');
  if (!text.includes('DEEP_HUB_TEST_CONFIRM')) {
    const option = preload ? `--import=${preload}` : '';
    if (/<plist/.test(text)) {
      text = text.replace(/(<key>EnvironmentVariables<\/key>\s*<dict>)/, `$1\n    <key>DEEP_HUB_TEST_CONFIRM</key>\n    <string>${xml(confirm)}</string>`);
      if (option) text = text.replace(/(<key>ProgramArguments<\/key>\s*<array>\s*<string>[\s\S]*?<\/string>)/, `$1\n    <string>${xml(option)}</string>`);
    } else {
      text = text.replace(/^(Environment=.*)$/m, `$1 ${quoted(`DEEP_HUB_TEST_CONFIRM=${confirm}`)}`);
      if (option) text = text.replace(/^(ExecStart=(?:"(?:[^"\\]|\\.)*"|\S+))/m, `$1 ${quoted(option)}`);
    }
    writeFileSync(file, text);
  }
}
const run = spawnSync(launcher, [file, ...rest].filter((a) => a !== undefined), { stdio: 'inherit' });
process.exit(run.status ?? 1);
