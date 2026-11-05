// #1016 AC2 and AC5: four worktrees of the sample repo start a cold `cargo build --workspace` together under `deep
// lease`, each holding its own build slot, with the hub told the reference Mac's 12 cores (so the pool is 11 tokens).
// Their processes are sampled every 100 ms (rustc and linkers, README: Counting jobs) and their combined resident memory
// once a second. The same four builds run first without the pool: under `deep lease` too, through `/usr/bin/env -u
// MAKEFLAGS -u CARGO_MAKEFLAGS -u MFLAGS`, so cargo gets no jobserver, as the merge base's `deep lease` runs it (README,
// Open points). AC2: no sample over 11; all four finish no later than without the pool (INCONCLUSIVE on a machine
// loaded past its cores); its wrong program gives each build its own jobserver and must fail naming the sample. AC5:
// both memory peaks are reported.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC2, AC5, cadence, CORES, loaded, logEnd, most, mustFail, noSampleOver, peakMb, sample, slotsAtOnce, TOKENS, World, writeWorkspace, type MemorySample, type Sample } from './helpers.ts';

const BUILD = ['cargo', 'build', '--workspace'];
const NO_POOL = ['/usr/bin/env', '-u', 'MAKEFLAGS', '-u', 'CARGO_MAKEFLAGS', '-u', 'MFLAGS', ...BUILD];

interface Round { label: string; samples: Sample[]; memory: MemorySample[]; wallMs: number; codes: (number | null)[]; slots: number; outputs: string[]; load: string | null }

/** Four cold builds, one per worktree, started together under `deep lease`; sampled until all four have ended. */
async function round(w: World, worktrees: readonly string[], command: readonly string[], label: string): Promise<Round> {
  const since = await logEnd(w.hub!);
  const load = loaded();
  const t0 = Date.now();
  const builds = worktrees.map((wt, i) => w.lease(['--', ...command], wt, { CARGO_TARGET_DIR: join(w.dir, `target-${label}-${i + 1}`) }));
  const s = sample(builds.map((b) => b.pid), t0);
  const ends = await Promise.all(builds.map((b) => Promise.race([b.done, new Promise<undefined>((r) => setTimeout(() => r(undefined), 1_200_000))])));
  await s.stop();
  const wallMs = Math.max(...ends.map((e) => (e ? e.ms : Date.now()))) - t0;
  const r: Round = { label, samples: s.samples, memory: s.memory, wallMs, codes: ends.map((e) => e?.code ?? null), slots: await slotsAtOnce(w.hub!, since), outputs: builds.map((b) => b.output().slice(-600)), load: load ?? loaded() };
  // The Proof's reading: process samples from the four builds.
  console.log(`AC2 ${label}: four builds ended in ${(wallMs / 1000).toFixed(1)} s (exits ${r.codes.join(', ')}); at most ${most(r.samples)} rustc and linker processes at once (${cadence(r.samples)}); ${r.slots} cpu.slot leases at once; combined peak memory ${peakMb(r.memory)} MB (${r.memory.length} one-second reads)`);
  return r;
}

async function fourBuilds(plant?: string, withBaseline = true): Promise<{ pooled: Round; baseline?: Round }> {
  const w = new World({ cores: CORES, ...(plant ? { plant } : {}) });
  await w.startHub();
  try {
    const { worktrees } = w.repo((dir) => writeWorkspace(dir), 4);
    const baseline = withBaseline ? await round(w, worktrees, NO_POOL, 'without the pool') : undefined;
    const pooled = await round(w, worktrees, BUILD, plant ? `with DEEP_HUB_PLANT=${plant}` : 'with the pool');
    return { pooled, ...(baseline ? { baseline } : {}) };
  } finally {
    await w.stopHub();
  }
}

/** The functional limit: each build ran leased, in its own slot, to exit 0, and no sample was over the pool's 11. */
function withinPool(r: Round): void {
  expect(r.codes.every((c) => c === 0), `each of the four \`deep lease -- ${BUILD.join(' ')}\` must build and exit 0 (${r.codes.join(', ')}): ${r.outputs.join(' || ')}`).toBe(true);
  expect(r.slots, 'the four builds must each hold their own build slot (cpu.slot) at once').toBeGreaterThanOrEqual(4);
  expect(most(r.samples), `the builds' rustc processes must be seen at all (${cadence(r.samples)})`).toBeGreaterThan(0);
  noSampleOver(r.samples, TOKENS, 'the four builds');
}

let shared: Promise<{ pooled: Round; baseline?: Round }> | undefined;
const asBuilt = () => (shared ??= fourBuilds());

describe(`${AC2} four builds share one pool of 11 tokens`, () => {
  it(`${AC2} four worktrees' cold \`cargo build --workspace\` under \`deep lease\`: rustc and linker processes together never exceed the pool's 11 tokens in any 100 ms sample, and all four finish no later than without the pool`, async (ctx) => {
    const { pooled, baseline } = await asBuilt();
    withinPool(pooled);
    expect(baseline!.codes.every((c) => c === 0), `the same four builds without the pool must build: ${baseline!.outputs.join(' || ')}`).toBe(true);
    const reading = `with the pool ${(pooled.wallMs / 1000).toFixed(1)} s, without ${(baseline!.wallMs / 1000).toFixed(1)} s`;
    const why = pooled.load ?? baseline!.load ?? loaded();
    if (why) ctx.skip(`INCONCLUSIVE (reading only: ${why}): ${reading}`);
    expect(pooled.wallMs <= baseline!.wallMs, `all four builds must finish no later than the same four builds without the pool: ${reading}`).toBe(true);
  }, 3_600_000);

  it(`${AC2} (wrong program) a pool that gives each build its own jobserver (DEEP_HUB_PLANT=jobserver-per-build) goes over 11 and fails, naming the sample`, async () => {
    const { pooled } = await fourBuilds('jobserver-per-build', false);
    await mustFail('jobserver-per-build', () => withinPool(pooled), ['sample', `over the ${TOKENS} tokens`]);
  }, 3_600_000);
});

describe(`${AC5} the four builds' combined peak memory, as a reading`, () => {
  it(`${AC5} the four builds' combined peak memory, read from the system once a second, is reported beside the same four builds without the pool`, async () => {
    const { pooled, baseline } = await asBuilt();
    expect(pooled.memory.length && baseline!.memory.length, 'memory must be read once a second in both runs').toBeGreaterThan(0);
    expect(peakMb(pooled.memory) > 0 && peakMb(baseline!.memory) > 0, 'both peaks must be read from the builds\' processes').toBe(true);
    // The reading, reported (no threshold: the criterion asks for a reading).
    console.log(`AC5 reading: the four builds' combined peak memory with the pool ${peakMb(pooled.memory)} MB (${pooled.memory.length} reads), without the pool ${peakMb(baseline!.memory)} MB (${baseline!.memory.length} reads)`);
  }, 3_600_000);
});
