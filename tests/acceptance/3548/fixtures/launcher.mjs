// Stands in for launchd where `deep hub start` installs the hub's login service on macOS (README: The login service).
// `deep hub start` runs `$DEEP_HUB_LAUNCHER <the service's definition>` in place of launchctl, so no real service is
// touched (packages/hub/src/service.ts, as tests/acceptance/16's launcher is run). This one does what launchd does
// with the keys the definition holds:
//   - ProgramArguments, EnvironmentVariables: the program started in a session of its own, with the definition's
//     variables over this process's own, which carry what the test set (the planted writer, a planted program);
//   - StandardOutPath, StandardErrorPath: each opened for append and made if it is missing, so what the job writes
//     goes after what the file holds; a key the definition leaves out is /dev/null, as launchd's default is;
//   - a job that still runs is left alone, as a loaded job is: `deep hub start` asks again every second while no hub
//     answers.
// It returns at once. The job's PID is kept in $DEEP_3548_JOB, which is how it knows a job that still runs. The test
// plays KeepAlive itself: once the hub has exited, it runs this again.
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const fail = (why) => {
  process.stderr.write(`launcher: ${why}\n`);
  process.exit(1);
};
const [file] = process.argv.slice(2);
const job = process.env.DEEP_3548_JOB;
if (!file || !job) fail('run as DEEP_3548_JOB=<pid file> launcher.mjs <the definition>');
let text = '';
try {
  text = readFileSync(file, 'utf8');
} catch (error) {
  fail(`can't read ${file}: ${error.message}`);
}
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const valueOf = (key) => {
  const found = new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`).exec(text);
  return found ? unxml(found[1]) : undefined;
};
const program = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text);
const argv = program ? [...program[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unxml(m[1])) : [];
if (!argv.length) fail(`no ProgramArguments in ${file}`);
const env = {};
const variables = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(text);
if (variables) for (const m of variables[1].matchAll(/<key>([\s\S]*?)<\/key>\s*<string>([\s\S]*?)<\/string>/g)) env[unxml(m[1])] = unxml(m[2]);

let running = 0;
try {
  running = Number(readFileSync(job, 'utf8').trim());
} catch { /* no job yet */ }
if (running > 0) {
  try {
    process.kill(running, 0);
    process.exit(0);
  } catch (error) {
    if (error.code === 'EPERM') process.exit(0);
  }
}

const open = (path) => {
  if (!path) return 'ignore';
  mkdirSync(dirname(path), { recursive: true });
  return openSync(path, 'a', 0o600);
};
const outPath = valueOf('StandardOutPath');
const errPath = valueOf('StandardErrorPath');
const out = open(outPath);
const err = errPath !== undefined && errPath === outPath ? out : open(errPath);
const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: ['ignore', out, err], env: { ...process.env, ...env } });
if (!child.pid) fail(`${argv[0]} didn't start`);
writeFileSync(job, `${child.pid}\n`);
child.unref();
process.exit(0);
