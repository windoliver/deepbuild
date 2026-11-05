// #1016 AC1: first, the toolchain. The pinned Rust toolchain (rust-toolchain.toml) is probed on its own: a cold `cargo
// build` of the sample workspace given a named pipe of this test's own with 3 tokens must run at most 4 `rustc` at once
// (the make protocol's one implicit job, plus the 3), else the toolchain doesn't honor `--jobserver-auth=fifo:` and the
// test is BLOCKED, naming the toolchain. Then the criterion itself: a cold `deep lease -- cargo build` of the sample
// repo, given the hub's jobserver with 4 tokens (DEEP_HUB_TEST_CORES=5: one token per core less one), runs at most 4
// `rustc` processes in every 100 ms sample.
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, constants, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC1, cadence, groups, most, noSampleOver, sample, tempDir, toolchain, World, writeWorkspace, type Sample } from './helpers.ts';

const PROBE_TOKENS = 3;
const HUB_TOKENS = 4;

/** A cold build of a fresh sample workspace by the pinned cargo, given this test's own named pipe of 3 tokens. */
async function probe(): Promise<{ samples: Sample[]; code: number | null; stderr: string }> {
  const tc = toolchain();
  const dir = tempDir();
  writeWorkspace(join(dir, 'ws'));
  const fifo = join(dir, 'jobserver');
  execFileSync('/usr/bin/mkfifo', [fifo]);
  const fd = openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK);
  writeSync(fd, Buffer.from('+'.repeat(PROBE_TOKENS)));
  const flags = `-j --jobserver-auth=fifo:${fifo}`;
  const w = new World({ cores: 12 });
  const child = spawn(join(tc.bin, 'cargo'), ['build'], { cwd: join(dir, 'ws'), env: w.env({ CARGO_TARGET_DIR: join(dir, 'target'), MAKEFLAGS: flags, CARGO_MAKEFLAGS: flags }), stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  groups.add(child.pid!);
  let stderr = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  const s = sample([child.pid!]);
  const code = await new Promise<number | null>((resolve) => child.on('exit', (c) => resolve(c)));
  await s.stop();
  closeSync(fd);
  return { samples: s.samples, code, stderr };
}

describe(`${AC1} the pinned toolchain honors the named-pipe jobserver, and a build given the hub's 4 tokens runs at most 4 rustc`, () => {
  it(`${AC1} a cold \`cargo build\` of the sample repo given the hub's jobserver with 4 tokens runs at most 4 \`rustc\` processes in every 100 ms sample; BLOCKED, naming the toolchain, if it doesn't honor the named-pipe form`, async () => {
    const tc = toolchain();
    const p = await probe();
    const peak = most(p.samples);
    const over = p.samples.findIndex((s) => s.jobs > PROBE_TOKENS + 1);
    const warned = p.stderr.split('\n').filter((l) => /jobserver|warning|error/i.test(l)).slice(0, 5).join(' | ');
    // The Proof's reading: the toolchain probe.
    console.log(`AC1 probe: ${tc.version}; ${PROBE_TOKENS} tokens in a named pipe: at most ${peak} rustc at once (${cadence(p.samples)}); exit ${p.code}${warned ? `; cargo said: ${warned}` : ''}`);
    if (p.code !== 0) expect.fail(`BLOCKED: the probe build by ${tc.version} failed (exit ${p.code}): ${p.stderr.slice(-800)}`);
    if (over >= 0) expect.fail(`BLOCKED: ${tc.version} doesn't honor the named-pipe jobserver (--jobserver-auth=fifo:): given ${PROBE_TOKENS} tokens, it ran ${p.samples[over]!.jobs} rustc at once in sample ${over + 1} (${p.samples[over]!.who.join(', ')})${warned ? `; cargo said: ${warned}` : ''}. Work on #1016 stops here.`);
    expect(peak, `the probe must see the build at all: no rustc of it was sampled (${cadence(p.samples)})`).toBeGreaterThan(0);

    // The criterion: the hub's jobserver with 4 tokens, through `deep lease`.
    const w = new World({ cores: HUB_TOKENS + 1 });
    await w.startHub();
    try {
      const { repo } = w.repo((dir) => writeWorkspace(dir));
      const leased = w.lease(['--', 'cargo', 'build'], repo, { CARGO_TARGET_DIR: join(w.dir, 'target') });
      const s = sample([leased.pid]);
      const end = await Promise.race([leased.done, new Promise<undefined>((r) => setTimeout(() => r(undefined), 900_000))]);
      await s.stop();
      console.log(`AC1 hub: \`deep lease -- cargo build\` with the hub's ${HUB_TOKENS} tokens: at most ${most(s.samples)} rustc at once (${cadence(s.samples)}); exit ${end?.code ?? 'none in 15 min'}`);
      expect(end?.code, `\`deep lease -- cargo build\` must build the sample repo and exit 0: ${leased.output().slice(-1200)}`).toBe(0);
      expect(most(s.samples), `the build's rustc processes must be seen at all (${cadence(s.samples)})`).toBeGreaterThan(0);
      noSampleOver(s.samples, HUB_TOKENS, 'the build given the hub\'s jobserver');
    } finally {
      await w.stopHub();
    }
  }, 1_800_000);
});
