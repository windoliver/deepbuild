// #2627 AC1 (a failed start leaves nothing): the process table, a throttle table of the test's own whose build slots
// are held, and the run of the test under scrutiny. Written here; nothing is imported from the code under test.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Every reading of ps asks for one zone and language, so a start time reads the same at each look.
const psEnv = () => {
  const env = { ...process.env, TZ: 'UTC', LC_ALL: 'C' };
  delete env.COLUMNS;
  return env;
};
const ROW = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d+:\d+:\d+\s+\d{4})\s?(.*)$/;

/** Every process now: pid -> { ppid, stat, start, args }. Null when ps couldn't run. */
export function listing() {
  const r = spawnSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,stat=,lstart=,args='], { encoding: 'utf8', env: psEnv(), maxBuffer: 1 << 26 });
  if (r.status !== 0) return null;
  const procs = new Map();
  for (const line of r.stdout.split('\n')) {
    const m = line.match(ROW);
    if (m) procs.set(Number(m[1]), { ppid: Number(m[2]), stat: m[3], start: m[4].replace(/\s+/g, ' '), args: m[5].trim() });
  }
  return procs;
}

/** Whether `pid` still runs as the process that started at `start`: listed by `ps -o stat= -o lstart=`, not a zombie. */
export function alive({ pid, start }) {
  const r = spawnSync('ps', ['-o', 'stat=', '-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: psEnv() });
  const m = r.status === 0 && r.stdout.trim().match(/^(\S+)\s+(.+)$/);
  return Boolean(m) && !m[1].startsWith('Z') && m[2].replace(/\s+/g, ' ') === start;
}

/** SIGKILL to `pid` only while it is still the process that started at `start`. */
export function kill(entry) {
  if (entry?.pid && alive(entry)) try { process.kill(entry.pid, 'SIGKILL'); } catch {}
}

/**
 * The processes of one run, kept as they appear: the root, every process whose parent is one already kept (by number and
 * start, so a reused number isn't followed), and every process whose command line names `mark`, the run's own temporary
 * folder (so a stage whose parent died before a look, reparented away, is still found). Keyed by pid and start.
 */
export function tracker(mark) {
  const kept = new Map();
  const key = (pid, start) => `${pid}@${start}`;
  const has = (procs, pid) => procs.has(pid) && kept.has(key(pid, procs.get(pid).start));
  return {
    kept,
    root(pid) {
      const procs = listing();
      if (procs?.has(pid)) kept.set(key(pid, procs.get(pid).start), { pid, start: procs.get(pid).start, args: procs.get(pid).args });
    },
    look() {
      const procs = listing();
      if (!procs) return;
      for (let grew = true; grew;) {
        grew = false;
        for (const [pid, p] of procs) {
          if (kept.has(key(pid, p.start)) || pid === process.pid) continue;
          if (has(procs, p.ppid) || p.args.includes(mark)) {
            kept.set(key(pid, p.start), { pid, start: p.start, args: p.args });
            grew = true;
          }
        }
      }
    },
    // Each kept process that runs still, read one by one, with its command line as first seen.
    // One listing narrows them; each is then read by itself.
    left() {
      const procs = listing();
      return [...kept.values()].filter((p) => !procs || procs.get(p.pid)?.start === p.start).filter(alive);
    },
  };
}

/** A scratch folder: the child's TMPDIR (where its sandbox lands), the throttle table and the holders' marks. */
export function scratch() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2627fs-')));
  const box = { dir, tmp: join(dir, 'tmp'), table: join(dir, 'throttle'), marks: join(dir, 'holders') };
  for (const folder of [box.tmp, box.table, box.marks]) mkdirSync(folder);
  return box;
}

/** The environment every process of the test gets: its own table and TMPDIR, and no grant or wait of the caller's. */
export function environment(box) {
  const env = { ...process.env, DEEP_THROTTLE_TABLE: box.table, TMPDIR: box.tmp, TMP: box.tmp, TEMP: box.tmp };
  for (const name of ['DEEP_THROTTLE', 'DEEP_THROTTLE_READINGS', 'DEEP_THROTTLE_RUN', 'DEEP_LEASE_WAIT', 'DEEP_PERF_LOCK',
    'DEEP_WINDOW', 'DEEP_WINDOW_DRAIN', 'CARGO_MAKEFLAGS', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_HUB_PLANT']) delete env[name];
  return env;
}

// The build class's ceiling in scripts/throttle.mjs at the base: 4 on the Mac, 6 elsewhere.
export const BUILD_SLOTS = process.platform === 'darwin' ? 4 : 6;

/**
 * Holds every build slot of the test's own table through the throttle's own command line, each holder running a
 * process that notes its pid and then idles. Resolves once all hold, or throws after `limitMs`. The table must be the
 * test's own: a holder that wrote anywhere else is stopped at once and the test reads BLOCKED.
 */
export async function holdBuildSlots(box, env, holders, limitMs) {
  for (let k = 0; k < BUILD_SLOTS; k++) {
    const mark = join(box.marks, String(k));
    const idle = `require('node:fs').writeFileSync(${JSON.stringify(mark)},String(process.pid));setInterval(()=>{},1000)`;
    const child = spawn(process.execPath, [join(ROOT, 'scripts/throttle.mjs'), 'build', '--wait', '10', '--', process.execPath, '-e', idle],
      { cwd: ROOT, env, stdio: 'ignore', detached: true });
    holders.push({ pid: child.pid, mark, child });
  }
  const end = Date.now() + limitMs;
  while (Date.now() < end) {
    // A grant written anywhere but the test's own table (the machine's) is never kept.
    if (holders.every((h) => existsSync(h.mark)) && existsSync(join(box.table, 'table.json'))) {
      for (const h of holders) {
        const pid = Number(readFileSync(h.mark, 'utf8'));
        h.worker = { pid, start: listing()?.get(pid)?.start };
      }
      return holders;
    }
    if (holders.some((h) => existsSync(h.mark)) && !existsSync(join(box.table, 'table.json'))) break;
    if (holders.some((h) => h.child.exitCode !== null)) break;
    await sleep(250);
  }
  release(holders);
  throw new Error(`BLOCKED: the ${BUILD_SLOTS} build slots of the test's own table at ${box.table} weren't all held within ${limitMs / 1000} s ` +
    `(table.json there: ${existsSync(join(box.table, 'table.json'))}; holders exited: ${holders.filter((h) => h.child.exitCode !== null).length}; marks: ${readdirSync(box.marks).length})`);
}

/** Ends the holders: their idle commands, then the throttles, so the slots go back. */
export function release(holders) {
  for (const h of holders) kill(h.worker);
  // A child of this process not yet reaped keeps its number, so it is killed by its handle.
  for (const h of holders) if (h.child.exitCode === null && h.child.signalCode === null) try { h.child.kill('SIGKILL'); } catch {}
}

/**
 * The test file's result in node --test's TAP: 'pass' only for an ok line with no SKIP or TODO and a zero exit,
 * 'fail' for any not ok, 'skip' for an ok marked SKIP or TODO, else 'none'.
 */
export function verdict(tap, code) {
  if (/^\s*not ok \d+/m.test(tap)) return 'fail';
  const oks = tap.match(/^\s*ok \d+ .*$/gm) ?? [];
  if (oks.some((line) => / # (SKIP|TODO)\b/i.test(line))) return 'skip';
  if (oks.length && code === 0) return 'pass';
  return 'none';
}
export const reported = (tap) => /^\s*(not )?ok \d+/m.test(tap);
