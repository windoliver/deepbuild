'use strict';
// #3179's git-counting preload, loaded into the guard with NODE_OPTIONS=--require. Every git process a node process
// of the run starts through child_process (spawnSync, execFileSync and the rest, sync or not) appends one line to
// the file $DEEP_3179_COUNT names. NODE_OPTIONS is inherited, so node processes the guard starts count theirs too.
// A wrapped call that reaches another wrapped one (execFileSync calling spawnSync) counts once.
const childProcess = require('node:child_process');
const { appendFileSync } = require('node:fs');
const { basename } = require('node:path');
const { syncBuiltinESMExports } = require('node:module');

const out = process.env.DEEP_3179_COUNT;
let depth = 0;
const isGit = (name, rest, shell) => {
  if (typeof name !== 'string') return false;
  if (shell) return /^\s*(?:\S*\/)?git(?:\s|$)/.test(name);
  return name === 'git' || basename(name) === 'git';
};
if (out) {
  for (const [method, shell] of [['spawn', false], ['spawnSync', false], ['execFile', false], ['execFileSync', false], ['exec', true], ['execSync', true]]) {
    const original = childProcess[method];
    childProcess[method] = function (name, ...rest) {
      if (depth === 0 && isGit(name, rest, shell)) {
        const args = Array.isArray(rest[0]) ? rest[0].slice(0, 2).join(' ') : '';
        appendFileSync(out, `${method} ${String(name)} ${args}\n`);
      }
      depth += 1;
      try {
        return original.call(this, name, ...rest);
      } finally {
        depth -= 1;
      }
    };
  }
  // The guard imports these by name from node:child_process; this makes those bindings the wrapped ones.
  syncBuiltinESMExports();
}
