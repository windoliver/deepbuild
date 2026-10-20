// Preload for a perf run: holds the run between reading the lock and acting on it, and after
// moving the lock aside, for as long as the test says, so an interleaving that needs the machine
// to be busy happens on demand.
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const hold = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const isLock = (path) => String(path).endsWith('/lock');
const readMs = Number(process.env.SLOW_LOCK_READ_MS ?? 0);
const renameMs = Number(process.env.SLOW_LOCK_RENAME_MS ?? 0);
const read = fs.readFileSync;
fs.readFileSync = function (path, ...rest) {
  const result = read.call(this, path, ...rest);
  if (isLock(path)) hold(readMs);
  return result;
};
const rename = fs.renameSync;
fs.renameSync = function (from, to) {
  const result = rename.call(this, from, to);
  if (isLock(from)) hold(renameMs);
  return result;
};
syncBuiltinESMExports();
