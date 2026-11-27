// #3507 criterion 4's recorder: a vitest setup file, as #3016's frames/record.ts is, that leaves the suite it runs
// beside as it is and has every frame the suite draws drawn again by the merge base's build. Each `spawnSync` the
// suite makes still runs as the suite asked, and its result goes back to the suite untouched. When the child's output
// holds `pixel_hash` values and the child is this checkout's own debug build of `deep-gpu` or `deep-show`, run without
// `--planted`, the same command line and the same input are given once more to the merge base's build of that name,
// and both lists of hashes are appended, in the order each child gave them, to the JSON-lines file
// `DEEP_3507_FRAMES` names. Nothing is recorded without the three variables, which ac4.mjs sets and nothing else
// does: `DEEP_3507_FRAMES` (the file), `DEEP_3507_OWN_BIN` (a folder of copies of this checkout's own debug builds,
// taken before the suite ran) and `DEEP_3507_TWIN_BIN` (the merge base checkout's target/debug). Each carries a path;
// none selects a program. A fourth, `DEEP_3507_LEASE_PID`, is the ID of the process that holds the GPU lease for the
// run: a `deep-show` child may take the lease's file itself, so it is lent the file and the file is taken back after.
import cp from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, join } from 'node:path';
import { holder, release, take } from './lease.mjs';

const LOG = process.env.DEEP_3507_FRAMES;
const OWN = process.env.DEEP_3507_OWN_BIN;
const TWIN = process.env.DEEP_3507_TWIN_BIN;
const NAMES = ['deep-gpu', 'deep-show'];
/** The process that holds the GPU lease for this run (the ac4 file's), NaN when none is named. */
const LENDER = Number(process.env.DEEP_3507_LEASE_PID);

/**
 * Runs a child. `deep-gpu` takes no lease, so it draws under the one the run holds. A `deep-show` child, under any
 * name a suite copies it to (`deep-show-full`), may take the lease's file itself (a kit does) and would wait on the
 * run that holds it: the file is let go for that child and taken back for the same holder after. A lease that can't be taken back is written down, and the suite's test reads
 * BLOCKED.
 */
function lent(name, run) {
  if (!name.startsWith('deep-show') || !Number.isInteger(LENDER) || holder() !== LENDER) return run();
  release(LENDER);
  try { return run(); } finally {
    const back = take(LENDER);
    if (!back.held) appendFileSync(LOG, `${JSON.stringify({ file: '?', child: -1, command: name, args: [], kind: 'lease_lost', own: [], base: [], note: `the GPU lease, lent to a deep-show child that takes it itself, could not be taken back: ${back.why}` })}\n`);
  }
}

/** Every `pixel_hash` string in `v`, depth first, in document order. */
function hashes(v, out) {
  if (Array.isArray(v)) for (const x of v) hashes(x, out);
  else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'pixel_hash' && typeof x === 'string') out.push(x);
      else hashes(x, out);
    }
  }
  return out;
}
const text = (b) => (typeof b === 'string' ? b : Buffer.isBuffer(b) ? b.toString('utf8') : '');
/** The hashes a child printed: those of each of its output lines that is JSON. */
function printed(stdout) {
  const found = [];
  for (const line of stdout.split('\n')) {
    if (!line.includes('pixel_hash')) continue;
    try { hashes(JSON.parse(line), found); } catch { /* a line that isn't JSON holds no reply */ }
  }
  return found;
}
/** The suite's test file whose code started the child, by its path under the suite's folder. */
function testFile() {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 64;
  const stack = new Error().stack ?? '';
  Error.stackTraceLimit = limit;
  return /tests\/acceptance\/[\w-]+\/((?:[\w.-]+\/)*[\w.-]+\.test\.ts)/.exec(stack)?.[1] ?? '?';
}

if (LOG && OWN && TWIN) {
  const real = cp.spawnSync;
  const children = new Map();
  const digests = new Map();
  /** A file's SHA-256, read once for each size and time of change. */
  const digest = (path) => {
    const s = statSync(path);
    const key = `${path}:${s.size}:${s.mtimeMs}`;
    if (!digests.has(key)) digests.set(key, createHash('sha256').update(readFileSync(path)).digest('hex'));
    return digests.get(key);
  };
  const wrapped = function spawnSync(...args) {
    const r = lent(basename(String(args[0])), () => real.apply(cp, args));
    const stdout = text(r?.stdout);
    if (!stdout.includes('pixel_hash')) return r;
    const drawn = printed(stdout);
    // Output that only mentions the words, such as a process listing, holds no frame.
    if (drawn.length === 0) return r;
    const file = testFile();
    const child = children.get(file) ?? 0;
    children.set(file, child + 1);
    const command = String(args[0]);
    const spawned = basename(command);
    const argv = Array.isArray(args[1]) ? args[1].map(String) : [];
    const row = { file, child, command: spawned, args: argv, kind: 'paired', own: drawn, base: [], note: '' };
    try {
      // Which of this checkout's own builds the child is, by its bytes: a suite copies a build under a name of its own.
      const bytes = argv.includes('--planted') || !existsSync(command) ? null : digest(command);
      const name = bytes === null ? undefined : NAMES.find((n) => existsSync(join(OWN, n)) && digest(join(OWN, n)) === bytes);
      const twin = name === undefined ? '' : join(TWIN, name);
      if (argv.includes('--planted')) row.kind = 'planted';
      else if (name === undefined) { row.kind = 'other_build'; row.note = `${spawned} isn't a copy of this checkout's own debug deep-gpu or deep-show (cargo build --locked --bin <name>)`; }
      else if (!existsSync(twin)) { row.kind = 'no_twin'; row.note = `the merge base's target/debug holds no ${name}`; }
      else {
        const again = lent(spawned, () => real.call(cp, twin, argv, Array.isArray(args[1]) ? args[2] : args[1]));
        if (again?.error) { row.kind = 'no_twin'; row.note = `the merge base's ${name} could not run: ${again.error.message}`; }
        else { row.base = printed(text(again?.stdout)); if (again?.status !== r?.status) row.note = `this checkout's ${name} exited ${r?.status}, the merge base's ${again?.status}`; }
      }
    } catch (error) { row.kind = 'no_twin'; row.note = `the recorder could not draw it again: ${error.message}`; }
    appendFileSync(LOG, `${JSON.stringify(row)}\n`);
    return r;
  };
  cp.spawnSync = wrapped;
  syncBuiltinESMExports();
}
