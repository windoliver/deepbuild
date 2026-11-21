// AC5's count of file opens (README): while a call runs, every way node:fs opens a file by its path to read it is
// wrapped (readFileSync, openSync, readFile, createReadStream, and fs/promises' readFile and open), and each open of a
// watched path is counted. `syncBuiltinESMExports` carries the wrappers to every module's named imports of node:fs,
// so code that imported `readFileSync` by name opens through them too. The wrappers call the originals, and are taken
// out when the call returns.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';

type Fn = (...args: unknown[]) => unknown;
const SYNC = ['readFileSync', 'openSync', 'readFile', 'open', 'createReadStream'] as const;
const PROMISED = ['readFile', 'open'] as const;

export function countOpens<T>(watched: readonly string[], call: () => T): { value: T; opens: Map<string, number> } {
  const paths = new Set(watched.map((p) => resolve(p)));
  const opens = new Map<string, number>();
  const seen = (target: unknown): void => {
    if (typeof target !== 'string' && !(target instanceof URL) && !Buffer.isBuffer(target)) return;
    const path = resolve(target instanceof URL ? target.pathname : String(target));
    if (paths.has(path)) opens.set(path, (opens.get(path) ?? 0) + 1);
  };
  const host = fs as unknown as Record<string, Fn>;
  const promised = fs.promises as unknown as Record<string, Fn>;
  const originals = new Map<string, Fn>();
  for (const name of SYNC) {
    const original = host[name]!;
    originals.set(name, original);
    host[name] = function (this: unknown, ...args: unknown[]) { seen(args[0]); return original.apply(this, args); };
  }
  for (const name of PROMISED) {
    const original = promised[name]!;
    originals.set(`promises.${name}`, original);
    promised[name] = function (this: unknown, ...args: unknown[]) { seen(args[0]); return original.apply(this, args); };
  }
  syncBuiltinESMExports();
  try {
    return { value: call(), opens };
  } finally {
    for (const name of SYNC) host[name] = originals.get(name)!;
    for (const name of PROMISED) promised[name] = originals.get(`promises.${name}`)!;
    syncBuiltinESMExports();
  }
}
