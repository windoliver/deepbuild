// #1411, the Proof's real build under a planted level: a cold `cargo build --workspace` of a 64-crate workspace
// (README, The real build) under `deep lease`, matched by the shipped `cargo build` entry (`jobs: jobserver`), with the
// hub's 8 tokens. The level is planted at `warn` before the build starts and turned `critical` while it runs. Its jobs,
// each rustc (one codegen unit, so one token each) and each linker no rustc started, are sampled every 100 ms by #1016's
// sampler: the token counts over time. AC1: once the jobs running at the start have ended, and 20 jobs have ended in
// all (each ending gives a token back for the pool to hold), no sample at warn counts more than 4 until 12 more have
// ended and 3 s have passed; then the level turns critical, and once the jobs running at the switch have ended, and 16
// since it, no sample of the rest of the build counts more than 1. Every window is counted in jobs ended, not seconds,
// so a faster or slower machine reads the same part of the build. AC3: on what the held-back pool leaves it, the build
// finishes, exit 0, while the level is still critical. A window with fewer than 10 samples taken while the build ran is
// INCONCLUSIVE, never a pass.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cadence, most, noSampleOver, sample, toolchain, type Sample } from '../1016/helpers.ts';
import { AC1, AC3, CORES, OUT_AT, sleep, TOKENS, until, World, writeCargoWorkspace } from './helpers.ts';

const LEAVES = 64;
/** Jobs ended before the warn bound is read: the first ones and enough after for the pool to win back 4 of the 8 tokens. */
const WARN_ENDED = 20;
/** The warn window: until 12 more jobs have ended and 3 s have passed. */
const WINDOW_ENDED = 12;
const WINDOW_MS = 3000;
/** Jobs ended after the switch before the critical bound is read, those running at the switch among them. */
const CRITICAL_ENDED = 16;
const MIN_SAMPLES = 10;

const pids = (s: Sample | undefined): Set<number> => new Set((s?.who ?? []).map((w) => Number(w.split(' ').at(-1))));
/** How many jobs ended between consecutive samples, from sample `from` on. */
function ended(samples: readonly Sample[], from: number): number {
  let n = 0;
  for (let i = Math.max(1, from + 1); i < samples.length; i++) {
    const now = pids(samples[i]);
    for (const pid of pids(samples[i - 1])) if (!now.has(pid)) n++;
  }
  return n;
}
/** Whether every job in `wave` has ended by the newest sample. */
function gone(samples: readonly Sample[], wave: ReadonlySet<number>): boolean {
  const last = pids(samples.at(-1));
  return ![...wave].some((pid) => last.has(pid));
}
/** The token counts over time: the most jobs in any sample of each second, with the level. */
function perSecond(samples: readonly Sample[], switchMs: number): string {
  const rows = new Map<number, number>();
  for (const x of samples) rows.set(Math.floor(x.ms / 1000), Math.max(rows.get(Math.floor(x.ms / 1000)) ?? 0, x.jobs));
  return [...rows].map(([sec, n]) => `+${sec} s ${sec * 1000 >= switchMs ? 'critical' : 'warn'} ${n}`).join(', ');
}

describe(`${AC1} ${AC3} the Proof's real build under a planted level`, () => {
  it(`${AC1} ${AC3} a cold \`cargo build\` under \`deep lease\`, the level planted at \`warn\` and then turned \`critical\`, runs no more than 4 jobs at warn and 1 at critical once running jobs return their tokens, and finishes`, async (ctx) => {
    const tc = toolchain();
    const w = new World({ cores: CORES });
    await w.startHub();
    let samples: Sample[] = [];
    let warnAt: [number, number] = [0, 0];
    let criticalFrom = Infinity;
    let switchMs = Infinity;
    let end: { code: number | null; ms: number } | undefined;
    let endMs = Infinity;
    let output = '';
    try {
      const { repo } = w.repo((dir) => writeCargoWorkspace(dir, LEAVES));
      w.setLevel('warn');
      await sleep(1500);
      const t0 = Date.now();
      const leased = w.lease(['--', 'cargo', 'build', '--workspace'], repo, { CARGO_TARGET_DIR: join(w.dir, 'target'), CARGO_INCREMENTAL: '0' });
      const s = sample([leased.pid], t0);
      samples = s.samples;
      // Warn: the jobs that started first end, and 20 jobs end in all, before the bound is read.
      await until(() => samples.some((x) => x.jobs > 0) || leased.finished(), 600_000);
      const first = samples.findIndex((x) => x.jobs > 0);
      await sleep(1000);
      const wave = new Set(samples.filter((x, i) => first >= 0 && i >= first && x.ms <= samples[first]!.ms + 1000).flatMap((x) => [...pids(x)]));
      await until(() => leased.finished() || (gone(samples, wave) && ended(samples, first) >= WARN_ENDED), 1_200_000);
      const warnFrom = samples.length;
      const warnFromAt = Date.now();
      await until(() => leased.finished() || (Date.now() - warnFromAt >= WINDOW_MS && ended(samples, warnFrom - 1) >= WINDOW_ENDED), 1_200_000);
      // Critical: the jobs running at the switch end, and 16 jobs end in all after it, before the bound is read.
      const switchAt = samples.length;
      warnAt = [warnFrom, switchAt];
      switchMs = Date.now() - t0;
      w.setLevel('critical');
      await sleep(500);
      const atSwitch = new Set(samples.slice(Math.max(0, switchAt - 1)).flatMap((x) => [...pids(x)]));
      await until(() => leased.finished() || (gone(samples, atSwitch) && ended(samples, switchAt - 1) >= CRITICAL_ENDED), 1_200_000);
      criticalFrom = samples.length;
      end = await Promise.race([leased.done, sleep(1_800_000).then(() => undefined)]);
      endMs = end ? end.ms - t0 : Infinity;
      await s.stop();
      output = leased.output();
      // The Proof's reading: the real build's token counts over time.
      console.log(`Real build (${tc.version}, ${LEAVES} crates and app, the hub's ${TOKENS} tokens): jobs per second, the most in any sample: ${perSecond(samples.filter((x) => x.ms <= endMs), switchMs)}. ${cadence(samples)}; exit ${end ? `${end.code} at +${(endMs / 1000).toFixed(1)} s, the level critical from +${(switchMs / 1000).toFixed(1)} s` : 'none in 30 min'}`);
    } finally {
      w.setLevel('normal');
      await w.stopHub();
    }
    const running = (x: Sample) => x.ms < endMs;
    const warnWindow = samples.slice(warnAt[0], warnAt[1]).filter(running);
    const criticalWindow = samples.slice(criticalFrom).filter(running);
    console.log(`Real build windows: warn ${warnWindow.length} samples, at most ${most(warnWindow)} jobs at once; critical ${criticalWindow.length} samples, at most ${most(criticalWindow)}`);
    expect(most(samples), `the build's rustc processes must be seen at all (${cadence(samples)})`).toBeGreaterThan(0);
    if (warnWindow.length < MIN_SAMPLES) ctx.skip(`INCONCLUSIVE: only ${warnWindow.length} samples at warn while the build ran, once the jobs running at the start had returned their tokens`);
    noSampleOver(warnWindow, OUT_AT.warn, 'the build at `warn`, once the jobs running at the start had returned their tokens,');
    if (criticalWindow.length < MIN_SAMPLES) ctx.skip(`INCONCLUSIVE: only ${criticalWindow.length} samples at critical while the build ran, once the jobs running at the switch had returned their tokens`);
    noSampleOver(criticalWindow, OUT_AT.critical, 'the build at `critical`, once the jobs running at the switch had returned their tokens,');
    expect(end?.code, `a running build always finishes: on what the held-back pool leaves it, \`deep lease -- cargo build --workspace\` must exit 0 while the level is still critical: ${end ? `exit ${end.code}` : 'it was still running after 30 min'}: ${output.slice(-1200)}`).toBe(0);
  }, 3_600_000);
});
