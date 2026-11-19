// #1411 AC1: the pool holds tokens back as running jobs return them. The hub has 8 tokens (DEEP_HUB_TEST_CORES=9) and
// the memory-pressure level is the test's script (DEEP_TEST_MEMORY_PRESSURE_FILE). A leased stand-in build (README:
// `jobbuild`, `jobs: jobserver`) runs jobs of 100 to 300 ms without end, each further job on a token it reads from the
// pool's pipe, and wants every token there is, so at `normal` all 8 are out. The level turns `warn`: within 15 s no
// more than 4 may be out, and none of the next 5 s of readings more; then `critical`: no more than 1, the same way. The
// base never holds a token back, so 8 stay out at both levels.
import { describe, it } from 'vitest';
import { AC1, CORES, entriesRepo, fullAtNormal, heldBack, joinedPool, pressed, sleep, startBuild, timeline, World, type Phase } from './helpers.ts';

describe(`${AC1} the pool holds back half its tokens at warn and all but one at critical as running jobs return them`, () => {
  it(`${AC1} with 8 tokens and a simulated \`warn\`, no more than 4 are out once running jobs return theirs; at \`critical\`, no more than 1`, async () => {
    const w = new World({ cores: CORES });
    await w.startHub();
    let warn: Phase;
    let critical: Phase;
    try {
      const repo = entriesRepo(w);
      const t0 = Date.now();
      const { build, full } = await startBuild(w, repo);
      joinedPool(w, build);
      fullAtNormal(w, full);
      warn = await pressed(w, 'warn');
      critical = await pressed(w, 'critical');
      const goAt = Date.now();
      w.go('build');
      await Promise.race([build.done, sleep(60_000)]);
      // The Proof's reading: the pool driven by the scripted level, its tokens out over time.
      console.log(`AC1 tokens out over time (level in brackets): ${timeline(w, t0, goAt)}`);
    } finally {
      w.setLevel('normal');
      await w.stopHub();
    }
    heldBack(w, warn);
    heldBack(w, critical);
  }, 600_000);
});
