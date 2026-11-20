// The read meter: how many bytes of a set of files this process reads while it is on. It wraps every entry of
// `node:fs` and `node:fs/promises` that reads a file, and every reading method of a FileHandle, then calls
// syncBuiltinESMExports() so that named imports (`import { readFile } from 'node:fs/promises'`), default imports and
// `fs.promises` all see the wrapped functions; it restores them on stop. A file's descriptors and handles are followed
// from their open to their close, so a recycled descriptor is never counted against it. Operations that read a whole
// file without returning its bytes here (copyFile, cp, openAsBlob, readableWebStream) are listed, not counted, and
// the tests treat any of them as a read. What it can't see: reads in worker threads, child processes or native
// addons (README, Gaps). `meter.test.ts` shows it sees each way of reading it wraps.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Meter {
  /** Bytes read of each watched file, by its path as watched. */
  bytes: Map<string, number>;
  /** Whole-file operations on a watched file that return no bytes to count: `copyFile <path>` and the like. */
  whole: string[];
  stop(): Map<string, number>;
}

type Fn = (...args: any[]) => any;
const canonical = (p: string): string => {
  try { return fs.realpathSync.native(p); } catch { return resolve(p); }
};

export async function meterReads(paths: readonly string[]): Promise<Meter> {
  const watched = new Map<string, string>(paths.map((p) => [canonical(p), p]));
  const bytes = new Map<string, number>(paths.map((p) => [p, 0]));
  const whole: string[] = [];
  const fds = new Map<number, string>();
  const handles = new WeakMap<object, string>();
  const streams: { path: string; stream: { bytesRead?: number } }[] = [];
  const restore: (() => void)[] = [];

  const which = (arg: unknown): string | undefined => {
    if (typeof arg === 'number') return fds.get(arg);
    if (typeof arg === 'string') return watched.get(canonical(arg));
    if (arg instanceof URL && arg.protocol === 'file:') return watched.get(canonical(fileURLToPath(arg)));
    if (Buffer.isBuffer(arg)) return watched.get(canonical(arg.toString()));
    if (arg && typeof arg === 'object') return handles.get(arg);
    return undefined;
  };
  const add = (path: string | undefined, n: unknown): void => {
    if (path === undefined) return;
    const count = typeof n === 'number' ? n : typeof n === 'string' ? Buffer.byteLength(n) : n instanceof Uint8Array ? n.byteLength : 0;
    bytes.set(path, (bytes.get(path) ?? 0) + count);
  };
  const patch = (target: Record<string, unknown>, name: string, wrap: (original: Fn) => Fn): void => {
    const original = target[name] as Fn | undefined;
    if (typeof original !== 'function') return;
    target[name] = wrap(original);
    restore.push(() => { target[name] = original; });
  };
  /** Wraps a callback-style function's last-argument callback. */
  const withCallback = (args: unknown[], wrap: (cb: Fn) => Fn): unknown[] => {
    const last = args.length - 1;
    if (last >= 0 && typeof args[last] === 'function') args[last] = wrap(args[last] as Fn);
    return args;
  };
  const F = fs as unknown as Record<string, unknown>;
  const P = fsp as unknown as Record<string, unknown>;

  // Opening and closing: descriptors and handles of a watched file.
  patch(F, 'open', (o) => function (this: unknown, path: unknown, ...rest: unknown[]) {
    const p = which(path);
    return o.call(this, path, ...withCallback(rest, (cb) => (err: unknown, fd: number) => { if (!err && p !== undefined) fds.set(fd, p); cb(err, fd); }));
  });
  patch(F, 'openSync', (o) => function (this: unknown, path: unknown, ...rest: unknown[]) {
    const fd = o.call(this, path, ...rest) as number;
    const p = which(path);
    if (p !== undefined) fds.set(fd, p);
    return fd;
  });
  patch(F, 'close', (o) => function (this: unknown, fd: number, ...rest: unknown[]) { fds.delete(fd); return o.call(this, fd, ...rest); });
  patch(F, 'closeSync', (o) => function (this: unknown, fd: number, ...rest: unknown[]) { fds.delete(fd); return o.call(this, fd, ...rest); });
  patch(P, 'open', (o) => async function (this: unknown, path: unknown, ...rest: unknown[]) {
    const handle = await o.call(this, path, ...rest);
    const p = which(path);
    if (p !== undefined) { handles.set(handle, p); fds.set(handle.fd, p); }
    return handle;
  });

  // Reading by descriptor.
  patch(F, 'read', (o) => function (this: unknown, fd: number, ...rest: unknown[]) {
    const p = fds.get(fd);
    return o.call(this, fd, ...withCallback(rest, (cb) => (err: unknown, n: number, ...more: unknown[]) => { if (!err) add(p, n); cb(err, n, ...more); }));
  });
  patch(F, 'readSync', (o) => function (this: unknown, fd: number, ...rest: unknown[]) { const n = o.call(this, fd, ...rest); add(fds.get(fd), n); return n; });
  patch(F, 'readv', (o) => function (this: unknown, fd: number, ...rest: unknown[]) {
    const p = fds.get(fd);
    return o.call(this, fd, ...withCallback(rest, (cb) => (err: unknown, n: number, ...more: unknown[]) => { if (!err) add(p, n); cb(err, n, ...more); }));
  });
  patch(F, 'readvSync', (o) => function (this: unknown, fd: number, ...rest: unknown[]) { const n = o.call(this, fd, ...rest); add(fds.get(fd), n); return n; });

  // Reading a whole file by path or descriptor.
  patch(F, 'readFile', (o) => function (this: unknown, path: unknown, ...rest: unknown[]) {
    const p = which(path);
    return o.call(this, path, ...withCallback(rest, (cb) => (err: unknown, data: unknown) => { if (!err) add(p, data); cb(err, data); }));
  });
  patch(F, 'readFileSync', (o) => function (this: unknown, path: unknown, ...rest: unknown[]) { const data = o.call(this, path, ...rest); add(which(path), data); return data; });
  patch(P, 'readFile', (o) => async function (this: unknown, path: unknown, ...rest: unknown[]) { const data = await o.call(this, path, ...rest); add(which(path), data); return data; });

  // Streams: their own reads go through fs.open/fs.read above; their bytesRead is added at stop as well.
  patch(F, 'createReadStream', (o) => function (this: unknown, path: unknown, ...rest: unknown[]) {
    const stream = o.call(this, path, ...rest);
    const options = rest[0] as { fd?: unknown } | undefined;
    const p = which(path) ?? (options && typeof options === 'object' ? which(options.fd) : undefined);
    if (p !== undefined) streams.push({ path: p, stream });
    return stream;
  });

  // Whole-file operations that hand no bytes back here.
  for (const [target, names] of [[F, ['copyFile', 'copyFileSync', 'cp', 'cpSync', 'openAsBlob']], [P, ['copyFile', 'cp']]] as const) {
    for (const name of names) {
      patch(target, name, (o) => function (this: unknown, path: unknown, ...rest: unknown[]) {
        const p = which(path);
        if (p !== undefined) whole.push(`${name} ${p}`);
        return o.call(this, path, ...rest);
      });
    }
  }

  // FileHandle's own methods.
  const probe = await fsp.open(process.execPath, 'r');
  const FH = Object.getPrototypeOf(probe) as Record<string, unknown>;
  await probe.close();
  patch(FH, 'read', (o) => async function (this: object, ...args: unknown[]) { const r = await o.apply(this, args); add(handles.get(this), r?.bytesRead); return r; });
  patch(FH, 'readv', (o) => async function (this: object, ...args: unknown[]) { const r = await o.apply(this, args); add(handles.get(this), r?.bytesRead); return r; });
  patch(FH, 'readFile', (o) => async function (this: object, ...args: unknown[]) { const data = await o.apply(this, args); add(handles.get(this), data); return data; });
  patch(FH, 'createReadStream', (o) => function (this: object, ...args: unknown[]) {
    const stream = o.apply(this, args);
    const p = handles.get(this);
    if (p !== undefined) streams.push({ path: p, stream });
    return stream;
  });
  patch(FH, 'readableWebStream', (o) => function (this: object, ...args: unknown[]) {
    const p = handles.get(this);
    if (p !== undefined) whole.push(`readableWebStream ${p}`);
    return o.apply(this, args);
  });
  patch(FH, 'close', (o) => function (this: object & { fd: number }, ...args: unknown[]) { fds.delete(this.fd); return o.apply(this, args); });

  syncBuiltinESMExports();
  let stopped = false;
  return {
    bytes,
    whole,
    stop() {
      if (!stopped) {
        stopped = true;
        for (const undo of restore.reverse()) undo();
        syncBuiltinESMExports();
        for (const { path, stream } of streams) add(path, stream.bytesRead ?? 0);
      }
      return bytes;
    },
  };
}
