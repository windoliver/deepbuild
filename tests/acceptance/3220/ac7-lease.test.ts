// #3220 AC7: an agent's `cargo test --workspace` under `deep lease` records its peak and CPU seconds on its lease's run,
// and its next run is admitted on its entry's number; a planted admission on its last run's peak fails. The workspace
// is a tiny one (one crate, one test that holds 400 MiB for about 2.5 s); the repo's heavy_commands entry for `cargo
// test` gives 1,500 MB (README, Seams). Real cargo and rustc, offline, on the pinned toolchain; the hub's `mem` pool is
// 16,000 MB. A lease's run is the `run:LEASE…` its lease.acquired events name; what it used is on the event that ends
// it, whichever event of the record names that run and carries `used`; what it was admitted on is its `mem` lease's
// units (#3218).
import { describe, expect, it } from 'vitest';
import { afterAll } from 'vitest';
import { AC7, cleanup, memLeases, mustFail, PLANTS, said, sleep, World, type Ev } from './helpers.ts';

afterAll(cleanup, 120_000);

const ENTRY_MB = 1500;
const HELD_MIB = 400;
const COMMAND = ['cargo', 'test', '--workspace'];
const LIB = `/// Fills \`mib\` MiB of words with pseudo-random values, so the memory is resident and can't be compressed.
pub fn fill(mib: usize, mut x: u64) -> Vec<Vec<u64>> {
    let mut blocks = Vec::with_capacity(mib);
    for _ in 0..mib {
        let mut block = vec![0u64; 131_072];
        for word in block.iter_mut() {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            *word = x;
        }
        blocks.push(block);
    }
    blocks
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    #[test]
    fn holds_its_memory() {
        let blocks = super::fill(${HELD_MIB}, 88_172_645_463_325_252);
        let mut x = blocks[7][7];
        let t0 = Instant::now();
        while t0.elapsed() < Duration::from_millis(1000) {
            for _ in 0..100_000 {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
            }
        }
        std::thread::sleep(Duration::from_millis(1500));
        assert_ne!(blocks.iter().fold(x, |a, b| a ^ b[3]), 1);
    }
}
`;
const FILES: Record<string, string> = {
  'Cargo.toml': '[workspace]\nmembers = ["memtest"]\nresolver = "2"\n\n[profile.dev]\nopt-level = 1\ndebug = 0\nincremental = false\n',
  'memtest/Cargo.toml': '[package]\nname = "memtest"\nversion = "0.1.0"\nedition = "2021"\n',
  'memtest/src/lib.rs': LIB,
  '.gitignore': 'target/\n',
  '.deepbuild/done.yaml': ['heavy_commands:', '  - name: cargo test', '    argv_prefix: [cargo, test]', '    kinds: []', '    jobs: none', `    memory_mb: ${ENTRY_MB}`, ''].join('\n'),
};

interface Reading { runs: string[]; events: Ev[] }
/** Two `deep lease -- cargo test --workspace` runs, one after the other, through a hub with `plant`. */
async function twoLeasedRuns(plant?: string): Promise<Reading> {
  const w = new World({ files: FILES, memMb: 16_000, ...(plant ? { plant } : {}) });
  await w.startHub();
  try {
    for (const n of [1, 2]) {
      const leased = w.lease(['--', ...COMMAND], w.repo);
      const end = await Promise.race([leased.done, sleep(1_500_000).then(() => undefined)]);
      if (end?.code !== 0) throw Error(`BLOCKED: the ${n === 1 ? 'first' : 'second'} \`deep lease -- ${COMMAND.join(' ')}\` must pass (exit 0): ${end ? `exit ${end.code}` : 'it never ended'}: ${leased.output().slice(-2000)}`);
    }
    await sleep(3000);
    const events = await w.events();
    const runs = [...new Set(events.filter((e) => e.kind === 'lease.acquired' && typeof e.data.run === 'string' && e.data.run.startsWith('run:LEASE')).map((e) => String(e.data.run)))];
    if (runs.length !== 2) throw Error(`BLOCKED: the two leased commands must each hold leases for a run of their own: the record names ${JSON.stringify(runs)}`);
    return { runs, events };
  } finally {
    await w.stopHub();
  }
}
/** The event that ends a lease's run with what it used: one naming the run in data.run and carrying data.used. */
const usedOn = (events: readonly Ev[], run: string): Ev | undefined => events.find((e) => e.data?.run === run && typeof e.data.used === 'object' && e.data.used !== null);

/** AC7: each leased run records its peak and CPU seconds, and each is admitted on its entry's 1,500 MB, the second too. */
function recordsAndAdmitsOnEntry({ runs, events }: Reading): void {
  const mem = memLeases(events);
  for (const [i, run] of runs.entries()) {
    const ended = usedOn(events, run);
    expect(ended, `the ${i ? 'second' : 'first'} \`deep lease -- ${COMMAND.join(' ')}\`'s run, ${run}, must record what it used (used: {memory_peak_mb, cpu_s}) on the event that ends it; the record's events naming it: ${events.filter((e) => e.data?.run === run).map(said).join('; ')}`).toBeDefined();
    const { memory_peak_mb: peak, cpu_s: cpu } = ended!.data.used;
    expect(peak, `${run}'s peak must be a number of MB: ${said(ended)}`).toBeTypeOf('number');
    expect(peak, `${run}'s test held ${HELD_MIB} MiB: its tree's peak, ${peak} MB, can't be less than 90% of that: ${said(ended)}`).toBeGreaterThanOrEqual(HELD_MIB * 0.9);
    expect(peak, `${run}'s peak, ${peak}, must be MB, not bytes or KB: ${said(ended)}`).toBeLessThanOrEqual(8000);
    expect(cpu, `${run}'s CPU seconds must be a number: ${said(ended)}`).toBeTypeOf('number');
    expect(cpu > 0 && cpu <= 600, `${run}'s CPU seconds, ${cpu}, must be more than 0 (cargo and its test ran) and seconds, not ms: ${said(ended)}`).toBe(true);
  }
  for (const [i, run] of runs.entries()) {
    const units = mem.get(run)?.units;
    expect(units, `the ${i ? 'second' : 'first'} run, ${run}, must be admitted on its entry's number, ${ENTRY_MB} MB of \`mem\` (its lease.acquired's units), never on what its last run used: it holds ${units ?? 'no mem lease'}; its leases: ${events.filter((e) => e.kind === 'lease.acquired' && e.data.run === run).map(said).join('; ')}`).toBe(ENTRY_MB);
  }
}

describe(`${AC7} an agent's heavy command records what it used, and is admitted on its entry's number`, () => {
  it(`${AC7} \`deep lease -- ${COMMAND.join(' ')}\` records its peak and CPU seconds on its lease's run, and its next run is admitted on ${ENTRY_MB} MB`, async () => {
    recordsAndAdmitsOnEntry(await twoLeasedRuns());
  }, 3_600_000);

  it(`${AC7} (wrong program ${PLANTS.lastPeak}) an admission on its last run's peak fails`, async () => {
    const r = await twoLeasedRuns(PLANTS.lastPeak);
    const second = memLeases(r.events).get(r.runs[1]!)?.units;
    const lastPeak = usedOn(r.events, r.runs[0]!)?.data.used?.memory_peak_mb;
    expect(typeof second === 'number' && typeof lastPeak === 'number' && Math.abs(second - lastPeak) <= Math.max(2, lastPeak * 0.05), `${PLANTS.lastPeak}: the planted admission must take the first run's peak, ${lastPeak}, as the second's units: it took ${second}`).toBe(true);
    await mustFail(`${PLANTS.lastPeak} on AC7`, () => recordsAndAdmitsOnEntry(r), [r.runs[1]!]);
  }, 3_600_000);
});
