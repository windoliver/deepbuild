// A main-thread preload for the hub (AC14): `node --import <this file> packages/cli/dist/main.js hub run`.
// On the main thread only, it records every child_process call, every directory read (readdir, opendir,
// sync, callback and promise forms, which is also how a process listing reads /proc on Linux) and, since a
// process listing elsewhere runs `ps` or `pgrep`, those land under child_process too. Each call is one JSON
// line appended to $DEEP_TEST_PRELOAD_LOG: {at, call, args, stack}. Its first line says it loaded, with the
// PID, so a test can tell an empty log from a preload that never ran.
import { appendFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { isMainThread } from 'node:worker_threads';

const require = createRequire(import.meta.url);
const LOG = process.env.DEEP_TEST_PRELOAD_LOG;
if (isMainThread && LOG) {
  const show = (a) => (typeof a === 'string' ? a : Array.isArray(a) ? a.map(String).join(' ') : typeof a);
  const record = (call, args) => {
    const stack = (new Error().stack ?? '').split('\n').slice(3, 9).map((l) => l.trim()).join(' | ');
    appendFileSync(LOG, `${JSON.stringify({ at: Date.now(), call, args: args.map(show), stack })}\n`);
  };
  const wrap = (module, name, label) => {
    const original = module[name];
    if (typeof original !== 'function') return;
    module[name] = function (...args) {
      record(`${label}.${name}`, args);
      return original.apply(this, args);
    };
  };
  const cp = require('node:child_process');
  const fs = require('node:fs');
  const fsp = require('node:fs/promises');
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) wrap(cp, name, 'child_process');
  for (const name of ['readdir', 'readdirSync', 'opendir', 'opendirSync']) wrap(fs, name, 'fs');
  for (const name of ['readdir', 'opendir']) wrap(fsp, name, 'fs/promises');
  syncBuiltinESMExports();
  appendFileSync(LOG, `${JSON.stringify({ loaded: true, pid: process.pid })}\n`);
}
