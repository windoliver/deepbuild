// Stands in for launchd when `deep setup` starts the hub through its login service: setup runs
// `$DEEP_HUB_LAUNCHER <plist>` instead of launchctl (#16's seam). It starts the program the plist names in a session of
// its own, with this process's environment plus the plist's, appends its PID to $DEEP_TEST_LAUNCHER_LOG so the test
// stops it by PID, and returns at once.
import { spawn } from 'node:child_process';
import { appendFileSync, openSync, readFileSync } from 'node:fs';

const text = readFileSync(process.argv[2], 'utf8');
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const program = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text);
const argv = program ? [...program[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unxml(m[1])) : [];
const env = {};
const vars = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(text);
if (vars) for (const m of vars[1].matchAll(/<key>([\s\S]*?)<\/key>\s*<string>([\s\S]*?)<\/string>/g)) env[unxml(m[1])] = unxml(m[2]);
if (!argv.length) {
  process.stderr.write(`launchd stand-in: no program in ${process.argv[2]}\n`);
  process.exit(1);
}
const log = process.env.DEEP_TEST_LAUNCHER_LOG;
const out = log ? openSync(`${log}.out`, 'a') : 'ignore';
const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: ['ignore', out, out], env: { ...process.env, ...env } });
if (log) appendFileSync(log, `${child.pid}\n`);
child.unref();
process.exit(0);
