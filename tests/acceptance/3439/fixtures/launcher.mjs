// The login service's stand-in (README: The login service), behind the DEEP_HUB_LAUNCHER seam the service code has:
// where the hub would hand its definition to launchd (`launchctl bootstrap`) or systemd (`enable --now`), it runs
// `$DEEP_HUB_LAUNCHER <definition file>`. This starts the job as the service manager would, once: the definition's
// program arguments, exactly as written, with the definition's environment and nothing of the caller's, in a session
// of its own, its output in the definition's log. It keeps nothing alive and restarts nothing.
//
// One thing is added that launchd would not: $T3439_JOB_OPTIONS joins the job's NODE_OPTIONS after the definition's
// own. The suite passes `--inspect-port=0`, which opens nothing by itself and lets the test read each thread's
// collector through Node's inspector (README: Reading a collector).
//
// What it started is $T3439_STATE/job.json: the PID, the program arguments, the definition's environment, the log.
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [file] = process.argv.slice(2);
const state = process.env.T3439_STATE;
const text = readFileSync(file, 'utf8');
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const unquoted = (s) => [...s.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));

let program, env, log;
if (text.includes('<plist')) {
  // launchd's property list: ProgramArguments is an array of strings, EnvironmentVariables a dict of strings.
  const under = (key, tag) => RegExp(`<key>${key}</key>\\s*<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1] ?? '';
  program = [...under('ProgramArguments', 'array').matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unxml(m[1]));
  env = Object.fromEntries([...under('EnvironmentVariables', 'dict').matchAll(/<key>([\s\S]*?)<\/key>\s*<string>([\s\S]*?)<\/string>/g)].map((m) => [unxml(m[1]), unxml(m[2])]));
  log = under('StandardErrorPath', 'string') ? unxml(under('StandardErrorPath', 'string')) : undefined;
} else {
  // systemd's unit: ExecStart is a line of quoted words, Environment a line of quoted NAME=value.
  program = unquoted(/^ExecStart=(.*)$/m.exec(text)?.[1] ?? '');
  env = Object.fromEntries(unquoted(/^Environment=(.*)$/m.exec(text)?.[1] ?? '').map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));
}
log ??= join(state, 'job.log');
if (!program.length) {
  process.stderr.write(`the launcher stand-in read no program arguments in ${file}\n`);
  process.exit(1);
}
mkdirSync(dirname(log), { recursive: true });
const out = openSync(log, 'a', 0o600);
const options = [env.NODE_OPTIONS, process.env.T3439_JOB_OPTIONS].filter(Boolean).join(' ');
const child = spawn(program[0], program.slice(1), { cwd: '/', detached: true, stdio: ['ignore', out, out], env: { ...env, ...(options ? { NODE_OPTIONS: options } : {}) } });
child.on('error', (error) => {
  process.stderr.write(`the launcher stand-in couldn't start ${program[0]}: ${error.message}\n`);
  process.exit(1);
});
child.on('spawn', () => {
  writeFileSync(join(state, 'job.json'), `${JSON.stringify({ pid: child.pid, program, env, log, definition: file })}\n`);
  child.unref();
  process.exit(0);
});
