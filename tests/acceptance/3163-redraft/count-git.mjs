// The spawnSync/execFileSync preload #3163's criterion 1 names: loaded with --import (through NODE_OPTIONS, so a node
// child of the guard loads it too), it appends one line to $DEEP_3163_GIT_LOG for each `git` process started through
// node:child_process, before starting it. One line per start, written at once, so a run stopped at its limit still
// leaves its count.
import { appendFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { basename } from 'node:path';

const log = process.env.DEEP_3163_GIT_LOG;
const childProcess = createRequire(import.meta.url)('node:child_process');
const note = (how, args) => appendFileSync(log, `${process.pid} ${how} ${JSON.stringify(args).slice(0, 300)}\n`);
const isGit = (file) => typeof file === 'string' && basename(file) === 'git';
const shellGit = (command) => typeof command === 'string' && /^\s*(?:\S*\/)?git(?:\s|$)/.test(command);

if (log) {
  // By file name: spawnSync, execFileSync, spawn, execFile.
  for (const name of ['spawnSync', 'execFileSync', 'spawn', 'execFile']) {
    const original = childProcess[name];
    childProcess[name] = function (file, ...rest) {
      if (isGit(file)) note(name, Array.isArray(rest[0]) ? rest[0] : []);
      return original.call(this, file, ...rest);
    };
  }
  // By shell command line: execSync, exec.
  for (const name of ['execSync', 'exec']) {
    const original = childProcess[name];
    childProcess[name] = function (command, ...rest) {
      if (shellGit(command)) note(name, [command]);
      return original.call(this, command, ...rest);
    };
  }
  // The ES module named exports (`import { spawnSync } from 'node:child_process'`) read the patched functions.
  syncBuiltinESMExports();
}
