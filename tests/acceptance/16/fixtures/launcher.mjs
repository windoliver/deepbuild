// Stands in for launchd (macOS) or `systemctl --user` (Linux) when `deep hub start` installs the hub's
// login service: `deep hub start` runs `$DEEP_HUB_LAUNCHER <service definition file>` instead of the real
// service manager (README, The service). Like the real one, it starts the program the definition names in
// a session of its own, not as a child of the terminal that ran `deep hub start`, and returns at once. It
// appends each PID it started to $DEEP_TEST_LAUNCHER_LOG, so the test can stop it by PID.
import { spawn } from 'node:child_process';
import { appendFileSync, openSync, readFileSync } from 'node:fs';

const file = process.argv[2];
const text = readFileSync(file, 'utf8');
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
let argv = [];
const env = {};
if (file.endsWith('.plist')) {
  const args = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text);
  argv = args ? [...args[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unxml(m[1])) : [];
  const vars = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(text);
  if (vars) for (const m of vars[1].matchAll(/<key>([\s\S]*?)<\/key>\s*<string>([\s\S]*?)<\/string>/g)) env[unxml(m[1])] = unxml(m[2]);
} else {
  // A systemd unit: ExecStart= with shell-style quoting, Environment= lines.
  const words = (line) => [...line.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] ?? m[3]));
  const exec = /^ExecStart=(.*)$/m.exec(text);
  argv = exec ? words(exec[1]) : [];
  for (const m of text.matchAll(/^Environment=(.*)$/gm)) for (const pair of words(m[1])) { const i = pair.indexOf('='); if (i > 0) env[pair.slice(0, i)] = pair.slice(i + 1); }
}
if (!argv.length) {
  process.stderr.write(`launcher: no program in ${file}\n`);
  process.exit(1);
}
const log = process.env.DEEP_TEST_LAUNCHER_LOG;
const output = log ? openSync(`${log}.out`, 'a') : 'ignore';
const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: ['ignore', output, output], env: { ...process.env, ...env } });
if (log) appendFileSync(log, `${child.pid}\n`);
child.unref();
process.exit(0);
