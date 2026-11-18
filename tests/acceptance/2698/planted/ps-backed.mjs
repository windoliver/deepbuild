// AC1's wrong program: a reader backed by `ps`, as benchmarks/hub.mjs idle reads the hub today (its CPU time and
// its resident memory). `ps` has no column for wakeups or for instructions retired, so it gives none: the assertions
// must fail it, naming the wakeups.
import { execFileSync } from 'node:child_process';

const ps = (pid, field) => execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8' }).trim();
// ps's time column, minutes:seconds.hundredths with hours in front when there are any, as hub.mjs reads it.
const cpuMs = (pid) => ps(pid, 'time').split(/[:.]/).map(Number).reduce((total, part, index, all) => (index === all.length - 1 ? total + part / 100 : total * 60 + part), 0) * 1000;

export function startReading(pid) {
  const began = performance.now(), cpu = cpuMs(pid);
  return {
    stop() {
      const own = { instructions: null, cpuMs: cpuMs(pid) - cpu, wakeups: null, footprintBytes: Number(ps(pid, 'rss')) * 1024 };
      return { spanMs: performance.now() - began, processes: [{ pid, ...own }], total: own };
    },
  };
}
