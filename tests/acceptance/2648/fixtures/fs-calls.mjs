// The test's counter of the hub's file-system calls (#2648 AC1), loaded into every thread of the hub:
// `node --import <this file> packages/cli/dist/main.js hub run`. Node runs an --import module in the main thread and in
// each worker thread (the core's, children.ts's), and each thread has its own node:fs, so each thread records its own
// calls. Every call a thread makes through node:fs or node:fs/promises that names a path, or a descriptor or file handle
// opened on one, is one JSON line appended to $DH2648_FS_LOG: {t, thread, fn, path, open?, every?}. `open` marks a call
// that opens the file (a read or write of it by name, an open, a watch); `every` is a watchFile's poll interval, since
// its stats run in libuv where no wrapper sees them. A thread's first line says it loaded, so a test can tell a quiet
// thread from a counter that never ran. Lines are written with the module's own functions, taken before any is wrapped.
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, threadId } from 'node:worker_threads';

const LOG = process.env.DH2648_FS_LOG;
if (LOG) {
  const require = createRequire(import.meta.url);
  const fs = require('node:fs');
  const fsp = fs.promises;
  const { openSync, writeSync, constants } = fs;
  const out = openSync(LOG, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT, 0o600);
  const put = (line) => { writeSync(out, `${JSON.stringify({ t: Date.now(), pid: process.pid, thread: threadId, ...line })}\n`); };
  const pathOf = (p) => {
    try {
      if (typeof p === 'string') return resolve(p);
      if (Buffer.isBuffer(p)) return resolve(p.toString('utf8'));
      if (p instanceof URL) return fileURLToPath(p);
    } catch { /* not a path */ }
    return undefined;
  };
  /** The path each descriptor and file handle this thread opened by name is on. */
  const fds = new Map();
  const handles = new WeakMap();
  const record = (fn, path, more = {}) => { if (path !== undefined) put({ fn, path, ...more }); };
  // A wrapper keeps what callers read off the function itself: realpathSync.native, a promisify symbol.
  const wrap = (target, key, make) => {
    const original = target[key];
    if (typeof original !== 'function') return;
    const wrapper = make(original);
    for (const own of Reflect.ownKeys(original)) {
      if (!['length', 'name', 'prototype', 'caller', 'arguments'].includes(own)) Object.defineProperty(wrapper, own, Object.getOwnPropertyDescriptor(original, own));
    }
    target[key] = wrapper;
  };
  const lastFn = (args) => (typeof args[args.length - 1] === 'function' ? args.length - 1 : -1);

  // Calls by name. `opens` names those that open the file; `second` those that name a second path.
  const opens = new Set(['readFile', 'readFileSync', 'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'truncate', 'truncateSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync', 'watch', 'openAsBlob']);
  const second = new Set(['rename', 'renameSync', 'copyFile', 'copyFileSync', 'link', 'linkSync', 'symlink', 'symlinkSync', 'cp', 'cpSync']);
  const byName = ['access', 'accessSync', 'exists', 'existsSync', 'stat', 'statSync', 'lstat', 'lstatSync', 'statfs', 'statfsSync', 'readFile', 'writeFile', 'appendFile', 'appendFileSync',
    'readdir', 'readdirSync', 'opendir', 'opendirSync', 'readlink', 'readlinkSync', 'realpath', 'realpathSync', 'mkdir', 'mkdirSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync',
    'unlink', 'unlinkSync', 'rename', 'renameSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync', 'link', 'linkSync', 'symlink', 'symlinkSync', 'chmod', 'chmodSync', 'lchmod', 'lchmodSync',
    'chown', 'chownSync', 'lchown', 'lchownSync', 'utimes', 'utimesSync', 'lutimes', 'lutimesSync', 'truncate', 'truncateSync', 'mkdtemp', 'mkdtempSync', 'watch', 'unwatchFile', 'openAsBlob'];
  for (const key of byName) {
    wrap(fs, key, (original) => function (...args) {
      record(key, pathOf(args[0]), opens.has(key) ? { open: true } : {});
      if (second.has(key)) record(key, pathOf(args[1]), opens.has(key) ? { open: true } : {});
      return original.apply(this, args);
    });
  }
  // realpathSync.native and realpath.native are calls of their own.
  for (const key of ['realpathSync', 'realpath']) wrap(fs[key], 'native', (original) => function (...args) { record(`${key}.native`, pathOf(args[0])); return original.apply(this, args); });
  // A whole-file read or write takes a path or a descriptor.
  for (const key of ['readFileSync', 'writeFileSync']) {
    wrap(fs, key, (original) => function (...args) {
      if (typeof args[0] === 'number') record(key, fds.get(args[0]));
      else record(key, pathOf(args[0]), { open: true });
      return original.apply(this, args);
    });
  }
  wrap(fs, 'watchFile', (original) => function (...args) {
    const options = typeof args[1] === 'object' && args[1] !== null ? args[1] : {};
    record('watchFile', pathOf(args[0]), { every: Number.isFinite(options.interval) ? options.interval : 5007 });
    return original.apply(this, args);
  });
  wrap(fs, 'openSync', (original) => function (...args) {
    const path = pathOf(args[0]);
    record('openSync', path, { open: true });
    const fd = original.apply(this, args);
    if (path !== undefined) fds.set(fd, path);
    return fd;
  });
  wrap(fs, 'open', (original) => function (...args) {
    const path = pathOf(args[0]);
    record('open', path, { open: true });
    const at = lastFn(args);
    if (at >= 0 && path !== undefined) {
      const done = args[at];
      args[at] = (error, fd) => { if (!error) fds.set(fd, path); done(error, fd); };
    }
    return original.apply(this, args);
  });
  // Calls on a descriptor: counted when the descriptor was opened on a path by name.
  for (const key of ['readSync', 'writeSync', 'readvSync', 'writevSync', 'fstatSync', 'fsyncSync', 'fdatasyncSync', 'ftruncateSync', 'fchmodSync', 'fchownSync', 'futimesSync',
    'read', 'write', 'readv', 'writev', 'fstat', 'fsync', 'fdatasync', 'ftruncate', 'fchmod', 'fchown', 'futimes']) {
    wrap(fs, key, (original) => function (...args) {
      if (typeof args[0] === 'number') record(key, fds.get(args[0]));
      return original.apply(this, args);
    });
  }
  for (const key of ['closeSync', 'close']) {
    wrap(fs, key, (original) => function (...args) {
      if (typeof args[0] === 'number') { record(key, fds.get(args[0])); fds.delete(args[0]); }
      return original.apply(this, args);
    });
  }

  // node:fs/promises, and the FileHandle every promise call on an open file goes through.
  const fileHandleCalls = ['read', 'readv', 'readFile', 'readLines', 'write', 'writev', 'writeFile', 'appendFile', 'stat', 'truncate', 'sync', 'datasync', 'chmod', 'chown', 'utimes', 'close', 'createReadStream', 'createWriteStream'];
  let handlesWrapped = false;
  const wrapHandles = (handle) => {
    if (handlesWrapped) return;
    handlesWrapped = true;
    const proto = Object.getPrototypeOf(handle);
    for (const key of fileHandleCalls) wrap(proto, key, (original) => function (...args) { record(`FileHandle.${key}`, handles.get(this)); return original.apply(this, args); });
  };
  for (const key of ['access', 'stat', 'lstat', 'statfs', 'readFile', 'writeFile', 'appendFile', 'readdir', 'opendir', 'readlink', 'realpath', 'mkdir', 'rm', 'rmdir', 'unlink',
    'rename', 'copyFile', 'cp', 'link', 'symlink', 'chmod', 'lchmod', 'chown', 'lchown', 'utimes', 'lutimes', 'truncate', 'mkdtemp', 'watch']) {
    wrap(fsp, key, (original) => function (...args) {
      const isHandle = typeof args[0] === 'object' && args[0] !== null && !(args[0] instanceof URL) && !Buffer.isBuffer(args[0]);
      if (isHandle) record(`promises.${key}`, handles.get(args[0]));
      else record(`promises.${key}`, pathOf(args[0]), opens.has(key) ? { open: true } : {});
      if (second.has(key)) record(`promises.${key}`, pathOf(args[1]));
      return original.apply(this, args);
    });
  }
  wrap(fsp, 'open', (original) => async function (...args) {
    const path = pathOf(args[0]);
    record('promises.open', path, { open: true });
    const handle = await original.apply(this, args);
    wrapHandles(handle);
    if (path !== undefined) handles.set(handle, path);
    return handle;
  });
  syncBuiltinESMExports();
  put({ loaded: true, main: isMainThread });
}
