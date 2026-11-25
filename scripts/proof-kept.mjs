// The unit lane's finished jobs, kept by tree (#3296; docs/parallel-proof.md, section 7b). scripts/preflight appends each
// job's results as the job ends, and its next run reads them in place of running the job again, for the same tree,
// machine, tools and DEEP_* environment alone. A FAIL or INVALID row stands; a BLOCKED or INCONCLUSIVE row no `skips`
// entry covers makes its file run again; a job that was cut, killed or refused a grant is never kept.
import { createHmac, randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeSync } from 'node:fs';
import { homedir, hostname, release, version } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const folder = () => join(homedir(), '.deepbuild', 'preflight');
// What a run sets for itself, never a person: a result can't turn on it.
const RUN_SETS = /^DEEP_(?:THROTTLE|THROTTLE_RUN|AFFECTED_HELD|OPEN_ISSUES|BIN_DIR|PERF_LOCK|PROOF_VITEST_REPORT)$/;
const KEY = ['tree', 'host', 'platform', 'os', 'node', 'rust', 'env'];

/** The machine's secret, so a digest of the environment can't be turned back into what it named. */
function secret() {
  mkdirSync(folder(), { recursive: true, mode: 0o700 });
  const file = join(folder(), 'secret');
  try {
    const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeSync(fd, randomBytes(32));
    closeSync(fd);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return readFileSync(file);
}

/** What a kept result must match to count: the tree and the machine, tools and environment its job ran in. */
export function runKey(tree) {
  const set = Object.entries(process.env).filter(([name]) => /^DEEP(?:BUILD)?_/.test(name) && !RUN_SETS.test(name)).sort(([a], [b]) => (a < b ? -1 : 1));
  const rust = spawnSync('rustc', ['-V'], { encoding: 'utf8' });
  const build = process.platform === 'darwin' ? spawnSync('sw_vers', ['-buildVersion'], { encoding: 'utf8' }).stdout?.trim() : version();
  return {
    tree,
    host: hostname(),
    platform: `${process.platform}-${process.arch}`,
    os: `${release()} ${build}`,
    node: process.version,
    rust: rust.status === 0 ? rust.stdout.trim() : 'none',
    env: createHmac('sha256', secret()).update(JSON.stringify(set)).digest('hex'),
  };
}

const rowsOf = ({ passed = [], failures = [], skips = [] }) => [
  ...passed.map((id) => ({ id, state: 'PASS' })),
  ...failures.map(({ id, state, message }) => ({ id, state, note: message })),
  ...skips.map(({ id, note }) => ({ id, state: note.startsWith('BLOCKED') ? 'BLOCKED' : 'INCONCLUSIVE', note, skipped: true })),
];
const resultsOf = (rows) => ({
  passed: rows.filter(({ state }) => state === 'PASS').map(({ id }) => id),
  failures: rows.filter(({ state, skipped }) => state !== 'PASS' && !skipped).map(({ id, state, note }) => ({ id, state, message: note ?? '' })),
  skips: rows.filter(({ skipped }) => skipped).map(({ id, note }) => ({ id, note: note ?? '' })),
});
const stands = ({ state }) => state === 'FAIL' || state === 'INVALID';

/** What the kept jobs of `key` took, all runs of them: their count, their machine time and the preflights that ran them. */
export function keptTime(key) {
  const lines = [];
  try {
    for (const line of readFileSync(join(folder(), `${key.tree}.jsonl`), 'utf8').split('\n')) {
      let kept;
      try { kept = JSON.parse(line); } catch { continue; }
      if (kept?.key && KEY.every((part) => kept.key[part] === key[part]) && typeof kept.ms === 'number') lines.push(kept);
    }
  } catch {}
  return { jobs: lines.length, ms: lines.reduce((sum, { ms }) => sum + ms, 0), runs: new Set(lines.map(({ run }) => run)).size };
}

/** Whether a job ended with its results whole, so nothing of them is missing. `results` is what its report reads as. */
export function wholeJob({ label, status, idle, output, results }) {
  return typeof status === 'number' && status < 128 && !idle && results && !results.noGrant && !results.cut
    && !/^(?:INCONCLUSIVE|BLOCKED) (?:no grant|throttle): /m.test(output ?? '')
    && !results.failures.some(({ id }) => id === `${label} report` || id === 'vitest › unhandled error')
    && (status === 0 || results.failures.length > 0);
}

/**
 * The kept results of `key`, and what keeps more of them. `covers({ id, note })` says whether a `skips` entry covers a
 * skip. A file's rows are its test's, its own and no other job's; a job with no files, as `cargo test`, answers for all of its rows.
 */
export function openKept({ run, ...key }, covers) {
  const path = join(folder(), `${key.tree}.jsonl`);
  const files = new Map(), jobs = new Map();
  const merge = (rows, row) => { if (!rows.has(row.id) || !stands(rows.get(row.id))) rows.set(row.id, row); };
  const take = ({ job, files: own, tests }) => {
    for (const row of tests) {
      const file = own.find((path) => row.id.startsWith(`${path} › `));
      const map = file === undefined ? jobs : files, at = file ?? job;
      if (!map.has(at)) map.set(at, new Map());
      merge(map.get(at), row);
    }
  };
  let text = '';
  try { text = readFileSync(path, 'utf8'); } catch {}
  for (const line of text.split('\n')) {
    let kept;
    try { kept = JSON.parse(line); } catch { continue; }
    if (kept?.key && KEY.every((part) => kept.key[part] === key[part]) && typeof kept.job === 'string' && Array.isArray(kept.files) && Array.isArray(kept.tests)) take(kept);
  }
  const settled = (rows) => rows !== undefined && rows.length > 0
    && (rows.some(stands) || rows.every((row) => (row.state === 'PASS') || (row.skipped && covers(row))));
  const ofFile = (file) => (files.has(file) ? [...files.get(file).values()] : undefined);
  const ofJob = (job) => (jobs.has(job) ? [...jobs.get(job).values()] : undefined);
  const rowsFor = (names, job) => [...names.flatMap((file) => ofFile(file) ?? []), ...ofJob(job) ?? []];
  return {
    path,
    /** Whether `file` is done: it has kept rows, and either a standing failure or nothing left to run. */
    done: (file) => settled(ofFile(file)),
    /** Whether a job with no files of its own, or the whole of `names`, is done. */
    jobDone: (job, names) => (names.length ? names.every((file) => settled(ofFile(file))) : settled(ofJob(job))),
    results: (names, job) => resultsOf(rowsFor(names, job)),
    /** `results` with what is kept of its files that it doesn't hold, and every standing failure in place of a later row. */
    overlay(results, names, job) {
      const rows = new Map(rowsOf(results ?? {}).map((row) => [row.id, row]));
      for (const row of rowsFor(names, job)) if (!rows.has(row.id) || stands(row)) rows.set(row.id, row);
      return { ...results, ...resultsOf([...rows.values()]) };
    },
    /** Keeps one job's results, whole, as it ends. One that can't be kept is run again, and says so. */
    keep(job, names, results, ms) {
      let fd;
      try {
        mkdirSync(folder(), { recursive: true, mode: 0o700 });
        fd = openSync(path, 'a+', 0o600);
        const { size } = fstatSync(fd), last = Buffer.alloc(1);
        const torn = size > 0 && readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 10;
        const line = { key, run, job, ms: Math.round(ms), files: names, tests: rowsOf(results) };
        // One write, so a line another process appends never falls inside it, and a line cut short stays its own.
        writeSync(fd, `${torn ? '\n' : ''}${JSON.stringify(line)}\n`);
        take(line);
      } catch (error) {
        console.log(`NOTE ${job}: its results were not kept: ${error.message}`);
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    },
  };
}
