// The suite's own reader, written from issue #2698 alone on fixtures/probe.c, with the exports surface.mjs assumes of
// the real one. Left as it is, it is the clean twin that selfcheck.mjs holds the assertions against. Three of the
// planted readers are this one with a single fault each (resident-memory.mjs, parent-only.mjs, returns-zero.mjs); no
// test compares the real reader with it.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The probe, built once a process into a directory removed when the process ends. */
let probe;
export function builtProbe() {
  if (probe) return probe;
  const directory = mkdtempSync(join(tmpdir(), 'deep-2698-probe-'));
  process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
  const built = spawnSync('cc', ['-O2', '-Wall', '-Werror', '-o', join(directory, 'probe'), fileURLToPath(new URL('../fixtures/probe.c', import.meta.url))], { encoding: 'utf8' });
  if (built.error || built.status !== 0) throw Error(`BLOCKED: cc can't build fixtures/probe.c for the planted readers (${built.error?.message ?? built.stderr.trim().split('\n')[0]})`);
  return (probe = join(directory, 'probe'));
}

const FOUR = ['instructions', 'cpuMs', 'wakeups', 'footprintBytes'];

/**
 * startReading(pid) on the probe at `binary`. The faults, each off unless asked for:
 *   children: false       reads only the process itself
 *   footprint: resident   gives resident memory as the footprint
 *   failure: 0            gives 0, not null, for a reading the kernel refuses
 *   instead: pid          reads that process in place of the one asked for, and reports it under the PID asked for
 */
export function twin({ binary = builtProbe(), children = true, footprint = 'footprintBytes', failure = null, instead } = {}) {
  const read = (pid) => {
    try {
      const counted = JSON.parse(execFileSync(binary, [String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
      // A kernel that keeps no instruction count gives 0 for it: missing, not none retired.
      return { ...counted, instructions: counted.instructions || null };
    } catch {
      return null;
    }
  };
  const look = (pid) => {
    const own = read(instead ?? pid);
    return { at: performance.now(), own, below: own && children ? own.children.map(read).filter(Boolean) : [] };
  };
  return function startReading(pid) {
    const before = look(pid);
    return {
      stop() {
        const after = look(pid);
        const spanMs = after.at - before.at;
        const none = Object.fromEntries(FOUR.map((name) => [name, failure]));
        if (!before.own || !after.own) return { spanMs, processes: [{ pid, ...none }], total: none };
        const earlier = new Map([before.own, ...before.below].map((process) => [process.pid, process]));
        // A child that started inside the span counts from its start; one that ended inside it is not read again.
        const over = (now) => {
          const then = earlier.get(now.pid) ?? { instructions: 0, cpuNs: 0, wakeups: 0 };
          return {
            pid: now.pid === after.own.pid ? pid : now.pid,
            instructions: now.instructions === null || then.instructions === null ? failure : now.instructions - then.instructions,
            cpuMs: (now.cpuNs - then.cpuNs) / 1e6,
            wakeups: now.wakeups - then.wakeups,
            footprintBytes: now[footprint],
          };
        };
        const processes = [after.own, ...after.below].map(over);
        const total = Object.fromEntries(FOUR.map((name) => [name, processes.some((process) => process[name] === null) ? null : processes.reduce((sum, process) => sum + process[name], 0)]));
        return { spanMs, processes, total };
      },
    };
  };
}

export const startReading = (pid) => twin()(pid);
