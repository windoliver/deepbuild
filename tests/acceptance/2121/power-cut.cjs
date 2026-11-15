// Storage-boundary fault only: real fsync first, then power cut. No production module is replaced.
// The stock VFS has no point between the status-file and journal-file durable writes.
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const paths = new Map();
const open = fs.openSync, close = fs.closeSync, sync = fs.fsyncSync;
const dirs = JSON.parse(process.env.AC2121_CUT_DIRS);
fs.openSync = function (path, ...args) { const fd = open.call(this, path, ...args); paths.set(fd, String(path)); return fd; };
fs.closeSync = function (fd) { paths.delete(fd); return close.call(this, fd); };
fs.fsyncSync = function (fd) {
  sync.call(this, fd);
  if (dirs.includes(paths.get(fd)) && fs.existsSync(process.env.AC2121_ARM)) {
    fs.writeFileSync(process.env.AC2121_CUT, paths.get(fd));
    process.kill(process.pid, 'SIGKILL');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
};
syncBuiltinESMExports();
