// Test-only scheduling at Node boundaries. No hub module is imported or replaced.
import fs from 'node:fs';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { isMainThread, threadId } from 'node:worker_threads';

const root = join(process.env.HOME, '.deepbuild');
const gate = join(process.env.HOME, '.2594-listening');
const coreReport = join(process.env.HOME, '.2594-core.json');
const socketReport = join(process.env.HOME, '.2594-socket.json');
const mkdir = fs.mkdirSync;
const pause = new Int32Array(new SharedArrayBuffer(4));
function waitFor(file) {
  const end = Date.now() + 20_000;
  while (!fs.existsSync(file)) {
    if (Date.now() >= end) throw Error(`BLOCKED: #2594 boundary handshake timed out: ${file}`);
    Atomics.wait(pause, 0, 0, 5);
  }
}
function publish(file, value) {
  const temporary = `${file}.${threadId}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.renameSync(temporary, file);
}
function metadata(path) {
  try {
    const st = fs.statSync(path);
    return { path, mode: st.mode & 0o777, uid: st.uid, directory: st.isDirectory(), socket: st.isSocket() };
  } catch (error) {
    return { path, error: error.code ?? String(error) };
  }
}

if (!isMainThread) {
  fs.mkdirSync = function (path, options) {
    // This is the real Agents mkdir named by the issue, not a surrogate mkdir.
    if (typeof path !== 'string' || resolve(path) !== join(root, 'agents', 'syncs')) {
      return Reflect.apply(mkdir, this, arguments);
    }
    waitFor(gate); // If the core got here first, it cannot create agents yet.
    let failure;
    try {
      return Reflect.apply(mkdir, this, arguments);
    } catch (error) {
      failure = { code: error.code, message: error.message };
      throw error; // Preserve the real failure, including EACCES.
    } finally {
      publish(coreReport, {
        pid: process.pid, threadId, requested: options?.mode,
        failure: failure ?? null,
        agents: metadata(join(root, 'agents')),
        syncs: metadata(join(root, 'agents', 'syncs')),
      });
    }
  };
  syncBuiltinESMExports();
} else {
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    const path = typeof args[0] === 'string' ? args[0] : args[0]?.path;
    if (typeof path !== 'string' || !resolve(path).startsWith(`${root}/`)) {
      return Reflect.apply(listen, this, args);
    }
    // Node binds a Unix pathname synchronously. Observe before returning to ANY
    // hub code (including its listen callback or subsequent chmod), not by polling.
    const result = Reflect.apply(listen, this, args);
    const parents = [];
    for (let dir = dirname(path); ; dir = dirname(dir)) {
      parents.push(metadata(dir));
      if (dir === root) break;
    }
    publish(socketReport, { pid: process.pid, threadId, socket: metadata(path), parents });
    fs.writeFileSync(gate, 'bound');
    // Keep the caller's socket-creation window open until the real worker's
    // mkdir has completed, even if it throws. No umask is changed by this test.
    waitFor(coreReport);
    return result;
  };
}
