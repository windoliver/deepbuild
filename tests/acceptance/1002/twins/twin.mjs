// The planted `deep` commands (README: Wrong programs), built from merged code: `node twin.mjs <mode> <deep args…>`,
// run through the shell files beside it. Each does setup's steps itself, with `deep setup` (which no first-command
// path wraps), keeps its own finished record, and then runs a first command's own job through the hub package's
// public entry (`statusCommand` from @deepbuild/hub), never through `deep status`. So the CLI under test never runs
// its own first-command setup inside a twin, and can't repair the fault the twin plants.
//
//   finishes-once  the positive control: setup while ~/.deepbuild/setup-finished.json is missing; the record, with
//                  `deep --version`, written once setup exits 0, its last step; one line on stderr
//   record-first   writes the record before setup plans any file, and keeps it whatever setup does (puts it back if
//                  setup removed it)
//   folder-check   the bug: setup only while ~/.deepbuild is missing; the record written on success
//   no-version     the control, but its record names no version
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [mode, ...args] = process.argv.slice(2);
if (!['finishes-once', 'record-first', 'folder-check', 'no-version'].includes(mode)) {
  process.stderr.write(`deep twin: unknown mode ${mode}\n`);
  process.exit(2);
}
const FIRST = ['status', 'inbox', 'off', 'on', 'env', 'install', 'guard', 'memory'];
const root = join(homedir(), '.deepbuild');
const record = join(root, 'setup-finished.json');
const deep = (argv) => spawnSync('deep', argv, { encoding: 'utf8', env: process.env });
const write = () => {
  mkdirSync(root, { recursive: true });
  writeFileSync(record, mode === 'no-version' ? '{"finished": true}\n' : `${JSON.stringify({ version: deep(['--version']).stdout.trim() })}\n`);
};

if (FIRST.includes(args[0] ?? '')) {
  if (mode === 'folder-check' ? !existsSync(root) : !existsSync(record)) {
    if (mode === 'record-first') write();
    const setup = deep(['setup']);
    if (mode === 'record-first' && !existsSync(record)) write();
    if (setup.status !== 0) {
      process.stderr.write(`${setup.stdout}${setup.stderr}`);
      process.exit(setup.status ?? 1);
    }
    if (mode !== 'record-first') write();
    process.stderr.write('DeepBuild added its hooks in watch-only mode and started the hub; deep setup --undo removes it.\n');
  }
}
if (args[0] === 'status') {
  const { statusCommand } = await import('@deepbuild/hub');
  process.exitCode = await statusCommand(args.slice(1));
} else {
  const r = spawnSync('deep', args, { stdio: 'inherit', env: process.env });
  process.exitCode = r.status ?? 1;
}
