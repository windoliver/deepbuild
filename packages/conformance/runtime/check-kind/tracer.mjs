// The reference check runner's read tracer (#314): loaded into every Node process of the run through
// NODE_OPTIONS, it records every file the process opens through node:fs and every module it loads from a file,
// one path per line in the file DEEP_CHECK_READS names, so the run's read set holds what the suite read,
// declared or not. The ESM bindings are synced after the patch, so `import { readFileSync } from 'node:fs'` in
// a suite is traced too. It sees Node processes only: a file a shell tool in the command reads is not traced.
// The evidence files are the runner's, not the suite's: their names leave the process's environment once the
// tracer holds them (and reach a child this process starts through the tracer, not the environment), and each
// file ends in a trailer counting the lines this process wrote, so a suite that finds and truncates a file is
// found out when the lines fall short of the count.
import child_process from 'node:child_process';
import fs from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The run's variables: taken from the environment, then removed from it. */
const HIDDEN = ['DEEP_CHECK_READS', 'DEEP_CHECK_SPAWNS', 'NODE_OPTIONS'];
const hidden = Object.fromEntries(HIDDEN.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
for (const name of HIDDEN) delete process.env[name];
const out = hidden.DEEP_CHECK_READS;
const spawns = hidden.DEEP_CHECK_SPAWNS;
const append = fs.appendFileSync;
const realpath = fs.realpathSync;
const counts = { reads: 0, spawns: 0 };
// A relative path is resolved here, against this process's working directory at the call, which the suite may have
// changed: the runner sees only absolute paths, so no relative read lands on the wrong file of the checkout.
const asPath = (p) => {
  try {
    if (p instanceof URL) return fileURLToPath(p);
    if (typeof p === 'string') return p.startsWith('file:') ? fileURLToPath(p) : resolve(p);
    if (Buffer.isBuffer(p)) return resolve(p.toString());
  } catch { /* an unreadable path is not a read */ }
  return null;
};
// A read through a symbolic link is a read of the file the link points to as well: both paths are recorded, so a
// change to either makes the PASS stale.
const log = (p) => {
  const path = asPath(p);
  if (!out || path === null) return;
  const paths = [path];
  try { const real = realpath(path); if (real !== path) paths.push(real); } catch { /* not there, or not a link to follow */ }
  for (const line of paths) {
    try { append(out, `${line}\n`); counts.reads += 1; } catch { /* the trace file is the runner's; a failed write loses one line */ }
  }
};
const trace = (holder, name) => {
  const original = holder[name];
  if (typeof original !== 'function') return;
  holder[name] = function traced(p, ...rest) { log(p); return original.call(this, p, ...rest); };
};
// What opens a file for its contents, and what carries a file's contents to another name (a copy, a link, a move)
// where a read of them would fall outside the checkout: the source is the file read.
const READERS = ['readFileSync', 'openSync', 'createReadStream', 'readFile', 'open', 'openAsBlob', 'copyFileSync', 'copyFile', 'cpSync', 'cp', 'linkSync', 'link', 'renameSync', 'rename', 'symlinkSync', 'symlink'];
for (const name of READERS) trace(fs, name);
for (const name of ['readFile', 'open', 'copyFile', 'cp', 'link', 'rename', 'symlink']) trace(fs.promises, name);
// Every module loaded from a file is a file the run read: a changed import makes the PASS stale too.
registerHooks({ load(url, context, nextLoad) { if (url.startsWith('file:')) log(url); return nextLoad(url, context); } });

// Every child this process starts is recorded for the runner, which refuses to count a run that started a program
// the tracer can't see into (anything but Node): its reads would never reach the read set; or a detached child,
// which leaves the run's process group and so outlives the deadline that kills the group. The child gets the run's
// variables back, so a Node child loads this tracer too.
const record = (file, args, options) => {
  if (!spawns) return;
  try { append(spawns, `${JSON.stringify({ file: String(file), args: Array.isArray(args) ? args.map(String) : [], shell: Boolean(options.shell), detached: Boolean(options.detached) })}\n`); counts.spawns += 1; } catch { /* the runner's file */ }
};
const isOptions = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** The call's arguments with the run's variables in the child's environment: the options found, or added before a trailing callback. */
const withRun = (args) => {
  const list = [...args];
  let at = list.findIndex((v, i) => i > 0 && isOptions(v));
  if (at < 0) { at = typeof list[list.length - 1] === 'function' ? list.length - 1 : list.length; list.splice(at, 0, {}); }
  list[at] = { ...list[at], env: { ...(list[at].env ?? process.env), ...hidden } };
  return { list, options: list[at] };
};
const traceSpawn = (name, shellByDefault) => {
  const original = child_process[name];
  if (typeof original !== 'function') return;
  child_process[name] = function tracedSpawn(file, args) {
    const { list, options } = withRun(arguments);
    record(file, Array.isArray(args) ? args : [], shellByDefault ? { ...options, shell: true } : options);
    return original.apply(this, list);
  };
};
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) traceSpawn(name, false);
for (const name of ['exec', 'execSync']) traceSpawn(name, true);
child_process.fork = ((original) => function tracedFork(modulePath) {
  const { list, options } = withRun(arguments);
  record(process.execPath, [String(modulePath)], options);
  return original.apply(this, list);
})(child_process.fork);
syncBuiltinESMExports();

// The trailers: how many lines this process wrote to each file, so the runner can tell a truncated file.
process.on('exit', () => {
  for (const [file, lines] of [[out, counts.reads], [spawns, counts.spawns]]) {
    if (!file) continue;
    try { append(file, `${JSON.stringify({ deep: 'end', lines })}\n`); } catch { /* the runner's file */ }
  }
});
