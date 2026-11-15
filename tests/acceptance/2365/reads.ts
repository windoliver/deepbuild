// Generic instrumentation of reads from source files, for "a second pass over an unchanged transcript reads none of
// it" (#2365 AC5). It knows nothing of the archive: it wraps Node's file-reading entry points (node:fs and
// node:fs/promises, and FileHandle's methods) for this process, counts the bytes each call returns from one of the
// watched paths, and updates the ES module bindings (`syncBuiltinESMExports`), so a module that imported
// `readFile` by name is seen too. Opening or stat-ing a file is no read; only bytes returned count.
//
// What it can't see: a read made in another thread or process, or through a native addon. The README says so.

import * as fsNs from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// The CommonJS objects whose properties the ES bindings mirror.
const fs = require('node:fs') as typeof fsNs;
const fsp = fs.promises;

export interface Read { path: string; how: string; bytes: number }
export interface Watch {
  reads: Read[];
  /** Bytes read from a watched path while watching. */
  bytes(path: string): number;
  stop(): void;
}

type Fn = (...args: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
let active = false;

/** Starts counting reads of `paths` (real paths). One watch at a time. */
export async function watchReads(paths: readonly string[]): Promise<Watch> {
  if (active) throw Error('one read watch at a time');
  active = true;
  const wanted = new Set(paths.map((p) => fs.realpathSync(p)));
  const reads: Read[] = [];
  const fds = new Map<number, string>();
  const handles = new WeakMap<object, string>();
  const restore: (() => void)[] = [];

  const nameOf = (p: unknown): string | undefined => {
    try {
      const s = p instanceof URL ? fileURLToPath(p) : Buffer.isBuffer(p) ? p.toString('utf8') : typeof p === 'string' ? p : undefined;
      if (s === undefined) return undefined;
      const abs = resolve(s);
      if (wanted.has(abs)) return abs;
      return fs.existsSync(abs) && wanted.has(fs.realpathSync(abs)) ? fs.realpathSync(abs) : undefined;
    } catch {
      return undefined;
    }
  };
  const record = (path: string | undefined, how: string, bytes: unknown): void => {
    if (path === undefined) return;
    const n = typeof bytes === 'number' ? bytes : typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes instanceof Uint8Array ? bytes.byteLength : 0;
    reads.push({ path, how, bytes: n });
  };
  const patch = (target: Record<string, unknown>, key: string, make: (orig: Fn) => Fn): void => {
    const orig = target[key] as Fn | undefined;
    if (typeof orig !== 'function') return;
    target[key] = make(orig);
    restore.push(() => { target[key] = orig; });
  };
  const lastCb = (args: unknown[]): number => (typeof args[args.length - 1] === 'function' ? args.length - 1 : -1);
  const f = fs as unknown as Record<string, unknown>;

  patch(f, 'openSync', (orig) => function (this: unknown, ...args) {
    const fd = orig.apply(this, args) as number;
    const n = nameOf(args[0]);
    if (n) fds.set(fd, n); else fds.delete(fd);
    return fd;
  });
  patch(f, 'open', (orig) => function (this: unknown, ...args) {
    const i = lastCb(args);
    const n = nameOf(args[0]);
    if (i >= 0) {
      const cb = args[i] as Fn;
      args[i] = (err: unknown, fd: number) => { if (!err) { if (n) fds.set(fd, n); else fds.delete(fd); } cb(err, fd); };
    }
    return orig.apply(this, args);
  });
  patch(f, 'closeSync', (orig) => function (this: unknown, ...args) { fds.delete(args[0] as number); return orig.apply(this, args); });
  patch(f, 'close', (orig) => function (this: unknown, ...args) { fds.delete(args[0] as number); return orig.apply(this, args); });
  for (const key of ['readSync', 'readvSync']) {
    patch(f, key, (orig) => function (this: unknown, ...args) {
      const r = orig.apply(this, args) as number;
      record(fds.get(args[0] as number), key, r);
      return r;
    });
  }
  for (const key of ['read', 'readv']) {
    patch(f, key, (orig) => function (this: unknown, ...args) {
      const i = lastCb(args);
      const path = fds.get(args[0] as number);
      if (i >= 0 && path) {
        const cb = args[i] as Fn;
        args[i] = (err: unknown, n: number, ...rest: unknown[]) => { if (!err) record(path, key, n); cb(err, n, ...rest); };
      }
      return orig.apply(this, args);
    });
  }
  patch(f, 'readFileSync', (orig) => function (this: unknown, ...args) {
    const r = orig.apply(this, args) as unknown;
    record(typeof args[0] === 'number' ? fds.get(args[0]) : nameOf(args[0]), 'readFileSync', r);
    return r;
  });
  patch(f, 'readFile', (orig) => function (this: unknown, ...args) {
    const i = lastCb(args);
    const path = typeof args[0] === 'number' ? fds.get(args[0]) : nameOf(args[0]);
    if (i >= 0 && path) {
      const cb = args[i] as Fn;
      args[i] = (err: unknown, data: unknown) => { if (!err) record(path, 'readFile', data); cb(err, data); };
    }
    return orig.apply(this, args);
  });

  // node:fs/promises, and the FileHandle every promise read goes through.
  const p = fsp as unknown as Record<string, unknown>;
  const probe = await fsp.open(fileURLToPath(import.meta.url), 'r');
  const proto = Object.getPrototypeOf(probe) as Record<string, unknown>;
  await probe.close();
  patch(p, 'open', (orig) => async function (this: unknown, ...args) {
    const h = (await orig.apply(this, args)) as object;
    const n = nameOf(args[0]);
    if (n) handles.set(h, n);
    return h;
  });
  patch(p, 'readFile', (orig) => async function (this: unknown, ...args) {
    const r = (await orig.apply(this, args)) as unknown;
    record(args[0] && typeof args[0] === 'object' && !(args[0] instanceof URL) && !Buffer.isBuffer(args[0]) ? handles.get(args[0]) : nameOf(args[0]), 'fs/promises.readFile', r);
    return r;
  });
  for (const key of ['read', 'readv']) {
    patch(proto, key, (orig) => async function (this: object, ...args) {
      const r = (await orig.apply(this, args)) as { bytesRead: number };
      record(handles.get(this), `FileHandle.${key}`, r.bytesRead);
      return r;
    });
  }
  patch(proto, 'readFile', (orig) => async function (this: object, ...args) {
    const r = (await orig.apply(this, args)) as unknown;
    record(handles.get(this), 'FileHandle.readFile', r);
    return r;
  });
  syncBuiltinESMExports();

  return {
    reads,
    bytes: (path) => reads.filter((r) => r.path === fs.realpathSync(path)).reduce((s, r) => s + r.bytes, 0),
    stop() {
      for (const undo of restore.reverse()) undo();
      syncBuiltinESMExports();
      active = false;
    },
  };
}
